/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { messageUtils } from "./messageUtils.mjs";

const RE_BZ_BUG_LINK = /^https:\/\/.*?\/show_bug.cgi\?id=[0-9]*/;
const RE_BZ_COMMENT = /^--- Comment #\d+ from .* \d{4}.*? ---([\s\S]*)/m;
const RE_LIST_POST = /<mailto:([^>]+)>/;

const kExpandNone = 1;
const kExpandAll = 3;
const kExpandAuto = 4;

// This is high because we want enough snippet to extract relevant data from
// bugzilla snippets.
const kSnippetLength = 700;

/**
 * @typedef FullMessageDetails
 * @property {number} id
 * @property {number} initialPosition
 * @property {string} type
 * @property {string} headerMessageId
 * @property {boolean} detailsShowing
 * @property {boolean} recipientsIncludeLists
 * @property {boolean} needsLateAttachments
 * @property {boolean} [invalid]
 * @property {string} [realFrom]
 * @property {number} [rawDate]
 * @property {boolean} [hasRemoteContent]
 * @property {boolean} [smimeReload]
 * @property {boolean} [isPhishing]
 * @property {number} [folderAccountId]
 * @property {string} [folderPath]
 * @property {boolean} [isArchives]
 * @property {boolean} [isDraft]
 * @property {boolean} [isInbox]
 * @property {boolean} [isJunk]
 * @property {boolean} [isSent]
 * @property {string} [qnote]
 * @property {boolean} [isTemplate]
 * @property {boolean} [isOutbox]
 * @property {boolean} [read]
 * @property {string} [subject]
 * @property {boolean} [starred]
 * @property {object[]} [tags]
 * @property {boolean} [inView]
 * @property {string} [folderName]
 * @property {string} [shortFolderName]
 */

/**
 * Used to enrich basic message data with additional information for display.
 *
 * Some of these actions happen async, or are potentially expensive, which
 * is why there are here, rather than in the individual message display functions.
 */
export class MessageEnricher {
  constructor() {
    this.sizeUnknownString = browser.i18n.getMessage("attachments.sizeUnknown");
  }

  /**
   * Walk through each message in `msgData`, fetch and extend details about
   * each message. When the details are fetched, merge them into the
   * message object itself.
   *
   * @param {object[]} msgData
   *   The message details.
   * @param {object} summary
   *   The current state summary section from the store.
   * @param {number[]} selectedMessages
   *   The messages that are currently selected.
   */
  async enrich(msgData, summary, selectedMessages) {
    this.loggingEnabled = summary.prefs.loggingEnabled;

    const userTags = await browser.messages.tags.list();

    const folderNameCache = new Map(); // folder.id -> Promise<string>
    // Start tab info fetch once for all messages (same tabId throughout)
    const tabInfoPromise = Promise.resolve(
      browser.mailTabs.get(summary.tabId)
    ).catch(() => null);

    let msgs = await Promise.all(
      msgData.map(async (message) => {
        /** @type {FullMessageDetails} */
        let msg = {};
        try {
          msg = await this._addDetailsFromHeader(
            message,
            userTags,
            selectedMessages,
            folderNameCache,
            tabInfoPromise
          );

          await Promise.all([
            message.getFullRequired
              ? this._getFullDetails(message, msg)
              : this._addDetailsFromAttachments(
                  message,
                  msg,
                  summary.prefs.extraAttachments
                ),
            (async () => browser.conversations.getQNoteForMessage(message.id))()
              .then((t) => {
                if (t) {
                  msg.qnote = t;
                }
              })
              .catch((e) =>
                console.error("QNote: Error in messageEnricher:", e)
              ),
            this._setDates(msg, summary),
          ]);

          this._adjustSnippetForBugzilla(message, msg);
        } catch (ex) {
          console.error("Could not process message:", ex);
          msg.invalid = true;
        }
        return msg;
      })
    );
    return msgs;
  }

  /**
   * Used to determine which messages should be expanded and which one should
   * be scrolled to.
   *
   * @param {object[]} msgs
   *   The message details.
   * @param {number} expandWho
   *   The value of the expandWho preference.
   * @param {number[]} selectedMessages
   *   The messages that are currently selected.
   */
  determineExpansion(msgs, expandWho, selectedMessages) {
    this._filterOutDuplicatesAndInvalids(msgs);

    this._expandAndScroll(msgs, selectedMessages, expandWho);
  }

  /**
   * Figure out if there are duplicate or invalid messages and filter them out.
   * It decides which messages to keep and which messages to filter out.
   * This is needed because Gloda might return many copies of a single
   * message, each in a different folder.
   *
   * For different candidates for a single message id, we need to pick the
   * best one, giving precedence to those which are selected and/or in the
   * current view.
   *
   * Note: the array is modified in-place to avoid the need to re-update
   * state and dispatch messages. In future, we might want to make this
   * explicit.
   *
   * @param {object[]} msgData
   *   The message details.
   */
  _filterOutDuplicatesAndInvalids(msgData) {
    // First group the messages by the keys.
    let groupedMessages = new Map();
    for (let message of msgData) {
      if (message.invalid) {
        continue;
      }
      let id = message.headerMessageId;
      let items = groupedMessages.get(id);
      if (!items) {
        groupedMessages.set(id, [message]);
      } else {
        items.push(message);
      }
    }

    // Now filter the groups.
    let i = 0;
    msgData.length = groupedMessages.size;
    for (let group of groupedMessages.values()) {
      if (!group.length) {
        console.error("Should not have empty group when filtering duplicates.");
        continue;
      }
      if (group.length == 1) {
        msgData[i++] = group[0];
        continue;
      }

      if (this.loggingEnabled) {
        console.log(
          "Filtering out duplicates:",
          group.map((m) => m.headerMessageId)
        );
      }

      function findForCriterion(criterion) {
        for (let msg of group) {
          if (criterion(msg)) {
            return msg;
          }
        }
        return null;
      }

      let message =
        findForCriterion((msg) => msg.inView) ||
        findForCriterion((msg) => msg.isInbox) ||
        findForCriterion((msg) => msg.isSent) ||
        findForCriterion((msg) => msg.isArchives) ||
        // Worst case, fallback to the first one.
        group[0];

      // The message that's selected has the highest priority to avoid
      //  inconsistencies in case multiple identical messages are present in the
      //  same thread (e.g. message from to me).
      msgData[i++] = message;
    }
  }

  /**
   * Figure out which messages need expanding, and which one we'll scroll to.
   *
   * @param {object[]} msgData
   *   The message details.
   * @param {object[]} selectedMessages
   *   The currently selected messages in the UI.
   * @param {number} expandWho
   *   The value of the expandWho preference.
   */
  _expandAndScroll(msgData, selectedMessages, expandWho) {
    let focusThis = this._whereToScroll(msgData, selectedMessages);
    msgData[focusThis].scrollTo = true;
    this._markMsgsToExpand(msgData, selectedMessages, focusThis, expandWho);
  }

  /**
   * Figure out which messages we should scroll to.
   *
   * @param {object[]} msgData
   *   The message details.
   * @param {object[]} selectedMessages
   *   The currently selected messages in the UI.
   */
  _whereToScroll(msgData, selectedMessages) {
    let needsScroll = -1;

    // Conversations stub UI is only displayed when a thread is selected,
    // or a single message. If different messages across threads are selected,
    // then Thunderbird's multi-select UI is displayed. Hence, if there's more
    // than one selected message, we know that we are in a threaded selection.
    if (selectedMessages.length > 1) {
      needsScroll = msgData.length - 1;
      for (let i = 0; i < msgData.length; ++i) {
        if (!msgData[i].read) {
          needsScroll = i;
          break;
        }
      }
    } else {
      let msgId = selectedMessages[0];
      for (let i = 0; i < msgData.length; ++i) {
        if (msgData[i].id == msgId) {
          needsScroll = i;
          break;
        }
      }
      // I can't see why we wouldn't break at some point in the loop below, but
      //  just in case...
      if (needsScroll < 0) {
        console.error("kScrollSelected && didn't find the selected message");
        needsScroll = msgData.length - 1;
      }
    }
    return needsScroll;
  }

  /**
   * Marks a message to be expanded or not, depending on the state of the
   * expandWho preference.
   *
   * @param {object} msg
   *   The message to set the flag for.
   * @param {number} expandWho
   *   The value of the expandWho preference.
   */
  markExpansionForAddedMsg(msg, expandWho) {
    msg.expanded = !(expandWho == kExpandNone);
  }

  /**
   * Figure out which messages we should expand and mark them.
   *
   * @param {object[]} msgData
   *   The message details.
   * @param {object[]} selectedMessages
   *   The currently selected messages in the UI.
   * @param {number} focusIndex
   *   The message in the array to focus.
   * @param {number} expandWho
   *   The value of the expandWho preference.
   */
  _markMsgsToExpand(msgData, selectedMessages, focusIndex, expandWho) {
    switch (expandWho) {
      default:
        console.error(
          false,
          `Unknown value '${expandWho}' for pref expandWho, try changing in the add-on preferences.`
        );
      // Falls through so we can default to the same as the pref and keep going.
      case kExpandAuto: {
        if (selectedMessages.length > 1) {
          // In this mode, we scroll to the first unread message (or the last
          //  message if all messages are read), and we expand all unread messages
          //  + the last one (which will probably be unread as well).
          for (let i = 0; i < msgData.length; i++) {
            msgData[i].expanded = !msgData[i].read || i == msgData.length - 1;
          }
        } else {
          // In this mode, we scroll to the selected message, and we only expand
          //  the selected message.
          for (let i = 0; i < msgData.length; i++) {
            msgData[i].expanded = i == focusIndex;
          }
        }
        break;
      }
      case kExpandAll: {
        for (const msg of msgData) {
          msg.expanded = true;
        }
        break;
      }
      case kExpandNone: {
        for (const msg of msgData) {
          msg.expanded = false;
        }
        break;
      }
    }
  }

  /**
   * Obtains the message header and adds the details of the message to it.
   *
   * @param {object} message
   *   The message to get the additional details for.
   * @param {Array} userTags
   *   An array of the current tags the user has defined in Thunderbird.
   * @param {number[]} selectedMessages
   *   An array of the currently selected messages.
   * @param {Map} folderNameCache
   *   A cache of folder id to resolved folder name promises.
   * @param {Promise} tabInfoPromise
   *   A shared promise resolving to the current mail tab (or null).
   */
  async _addDetailsFromHeader(
    message,
    userTags,
    selectedMessages,
    folderNameCache,
    tabInfoPromise
  ) {
    // TODO: Maybe only clone msg & start using more fields directly.
    /** @type {FullMessageDetails} */
    let msg = {
      id: message.id,
      initialPosition: message.initialPosition,
      type: message.type,
      // Needed to avoid de-duplicating at the wrong times.
      headerMessageId: message.headerMessageId,
      detailsShowing: message.detailsShowing,
      recipientsIncludeLists: message.recipientsIncludeLists,
      needsLateAttachments: message.needsLateAttachments,
    };
    const messageFolderType = message.folder.type;

    const [, realFromParsed] = await Promise.all([
      this._parseContactLines(
        {
          from: message.author,
          to: message.recipients,
          cc: message.ccList,
          bcc: message.bccList,
          alternativeSender: message.alternativeSender,
        },
        msg
      ),
      message.realFrom
        ? browser.messengerUtilities.parseMailboxString(message.realFrom)
        : Promise.resolve(null),
    ]);
    if (realFromParsed) {
      msg.realFrom = realFromParsed[0]?.email;
    }

    msg.rawDate = message.date.getTime();
    // We don't actually know until we load the message, so default to false,
    // we'll get notified if it should be true.
    msg.hasRemoteContent = false;
    msg.smimeReload = false;
    msg.isPhishing = false;

    msg.folderAccountId = message.folder.accountId;
    msg.folderPath = message.folder.path;
    msg.isArchives = messageFolderType == "archives";
    msg.isDraft = messageFolderType == "drafts";
    msg.isInbox = messageFolderType == "inbox";
    msg.isJunk = message.junk;
    msg.isSent = messageFolderType == "sent";
    msg.isTemplate = messageFolderType == "templates";
    msg.isOutbox = messageFolderType == "outbox";
    msg.read = message.read;
    msg.subject = message.subject;
    msg.starred = message.flagged;

    msg.tags = message.tags.map((tagKey) => {
      // The fallback here shouldn't ever happen, but just in case...
      const tagDetails = userTags.find((t) => t.key == tagKey) || {
        color: "#FFFFFF",
        name: "unknown",
      };
      return {
        color: tagDetails.color,
        key: tagDetails.key,
        name: tagDetails.tag,
      };
    });

    // Only need to do this if the message is not in the current view.
    msg.inView = selectedMessages.some((id) => id == message.id);
    if (!msg.inView) {
      const currentTab = await tabInfoPromise;
      if (currentTab) {
        msg.inView =
          currentTab.displayedFolder.accountId == message.folder.accountId &&
          currentTab.displayedFolder.path == message.folder.path;
      }
    }

    if (!folderNameCache.has(message.folder.id)) {
      folderNameCache.set(
        message.folder.id,
        browser.folders.getParentFolders(message.folder.id).then((parents) => {
          let name = message.folder.name;
          for (let folder of parents) {
            name = folder.name + "/" + name;
          }
          return name;
        })
      );
    }
    msg.folderName = await folderNameCache.get(message.folder.id);
    msg.shortFolderName = message.folder.name;

    return msg;
  }

  /**
   * Get full details of a message. We typically need to do this for messages
   * not indexed by gloda, or for getting extra details for display (e.g.
   * headers).
   *
   * @param {object} message
   *   The message to get the full details for.
   * @param {object} msg
   *   The new message to put the details into.
   */
  async _getFullDetails(message, msg) {
    // Fetch full message content and late attachments in parallel
    const [fullMsg, lateAttachments] = await Promise.all([
      browser.messages.getFull(message.id),
      // TODO: Attachment display currently relies on having the URI for the
      // preview of the attachment. Since listAttachments doesn't give us that,
      // then we use getLateAttachments for now. If we can delay load the image
      // and insert it later, that'd probably be good enough.
      browser.conversations.getLateAttachments(message.id, false),
    ]);

    if (
      "list-post" in fullMsg.headers &&
      RE_LIST_POST.exec(fullMsg.headers["list-post"].toString())
    ) {
      msg.recipientsIncludeLists = true;
    }

    // Parse bugzilla-who and reply-to headers in parallel
    const [bugzillaFrom, replyTo] = await Promise.all([
      "x-bugzilla-who" in fullMsg.headers
        ? browser.messengerUtilities.parseMailboxString(
            fullMsg.headers["x-bugzilla-who"][0]
          )
        : Promise.resolve(null),
      "reply-to" in fullMsg.headers
        ? browser.messengerUtilities.parseMailboxString(
            fullMsg.headers["reply-to"][0]
          )
        : Promise.resolve(null),
    ]);

    if (bugzillaFrom) {
      msg.realFrom = msg.parsedLines.from[0]?.email;
      msg.parsedLines.from = bugzillaFrom;
    }
    if (replyTo) {
      msg.replyTo = replyTo;
    }

    function checkPart(msgPart) {
      switch (msgPart.contentType) {
        case "text/html":
          return { body: msgPart.body, html: true };
        case "text/plain":
          return { body: msgPart.body, html: false };
        case "multipart/alternative":
        case "multipart/related":
        case "multipart/mixed":
          // Sometimes we have seen that msgPart.parts might not exist when
          // initially loading a message. HAndle the error and continue so that
          // we can hopefully display something of the message even if we don't
          // have a summary.
          if (!msgPart.parts) {
            console.error("msgPart did not contain sub-parts");
            return { body: "", html: false };
          }
          for (let part of msgPart.parts.reverse()) {
            let info = checkPart(part);
            if (info.body?.length) {
              return info;
            }
          }
          break;
      }
      return { body: msgPart.body, html: true };
    }

    let info = checkPart(fullMsg.parts[0]);

    // Run snippet conversion and attachment processing in parallel
    const [snippet] = await Promise.all([
      info.html && info.body
        ? browser.messengerUtilities.convertToPlainText(info.body)
        : Promise.resolve(info.body ?? ""),
      this._addDetailsFromAttachments(
        {
          attachments: lateAttachments,
          initialPosition: message.initialPosition,
        },
        msg
      ),
    ]);

    msg.snippet = snippet.substring(0, kSnippetLength);
  }

  /**
   * Handles parsing of the mime (to/cc/bcc/from) lines of a message.
   *
   * @param {object} contactData
   *   The contact data for the message.
   * @param {object} msg
   *   The new message to put the details into.
   */
  async _parseContactLines(contactData, msg) {
    async function parseAll(items) {
      if (!items?.length) {
        return [];
      }
      const parts = await Promise.all(
        items.map((i) =>
          i
            ? browser.messengerUtilities.parseMailboxString(i)
            : Promise.resolve([])
        )
      );
      return parts.flat();
    }

    const [fromParsed, toParsed, ccParsed, bccParsed, altParsed] =
      await Promise.all([
        contactData.from
          ? browser.messengerUtilities.parseMailboxString(contactData.from)
          : Promise.resolve([]),
        parseAll(contactData.to),
        parseAll(contactData.cc),
        parseAll(contactData.bcc),
        parseAll(contactData.alternativeSender),
      ]);

    msg.parsedLines = {
      from: fromParsed,
      to: toParsed,
      cc: ccParsed,
      bcc: bccParsed,
      alternativeSender: altParsed,
    };

    // TODO: Drop realFrom, and use alternativeSender in the UI where
    // we need to differentiate.
    // The from can be overridden, e.g. in the case of bugzilla, so this field
    // is always the email address this was originally from.
    msg.realFrom = msg.parsedLines.from[0]?.email;

    if (msg.parsedLines.alternativeSender?.length) {
      msg.parsedLines.from = msg.parsedLines.alternativeSender;
    }
  }

  /**
   * Obtains attachment details and adds them to the message.
   *
   * @param {object} message
   *   The message to get the additional details for.
   * @param {number} message.initialPosition
   *   The initial position of the message.
   * @param {string} [message.source]
   *   The source of the message (gloda or standard).
   * @param {object[]} message.attachments
   *   The attachment data already extracted for the message.
   * @param {object} msg
   *   The new message to put the details into.
   * @param {boolean} [extraAttachments]
   *   Whether or not the user wants to display extra attachments.
   */
  async _addDetailsFromAttachments(
    { initialPosition, source, attachments },
    msg,
    extraAttachments
  ) {
    if (source && extraAttachments) {
      msg.needsLateAttachments = true;
    }

    let l = attachments.length;

    // This is bug 630011, remove when fixed (-1 means size unknown)
    msg.attachments = await Promise.all(
      attachments.map(async (att, i) => ({
        size: att.size,
        contentType: att.contentType,
        formattedSize:
          att.size != -1
            ? await browser.messengerUtilities.formatFileSize(att.size)
            : this.sizeUnknownString,
        name: att.name,
        partName: att.partName,
        anchor: "msg" + initialPosition + "att" + i,
      }))
    );
    msg.attachmentsPlural = l
      ? messageUtils.getPlural("attachments.numAttachments", l)
      : "";
  }

  /**
   * Adjusts a message snippet for bugzilla - this removes information which
   * isn't very useful in the summary, and simplifies it.
   *
   * @param {object} message
   *   The message for which to simplify the snippet.
   * @param {object} msg
   *   The new message to put the details into.
   */
  _adjustSnippetForBugzilla(message, msg) {
    if (msg.snippet) {
      // If we already have a snippet, we probably got it whilst looking at
      // the full message, or from gloda.
      return;
    }
    if (message.type != "bugzilla") {
      msg.snippet = message.snippet;
      return;
    }

    let snippet = message.snippet;

    let m = snippet.match(RE_BZ_BUG_LINK);
    if (m?.[0]) {
      snippet = snippet.substring(m[0].trim().length);
    }
    m = snippet.match(RE_BZ_COMMENT);
    if (m?.length && m[1].trim().length) {
      snippet = m[1];
    }

    msg.snippet = snippet;
  }

  /**
   * A formatting function that uses Services.intl
   * to format a date just like in the message list
   *
   * @param {Date} date a javascript Date object
   * @returns {string} a string containing the formatted date
   */
  dateAsInMessageList(date) {
    const now = new Date();
    // Is it today?
    const isToday =
      now.getFullYear() == date.getFullYear() &&
      now.getMonth() == date.getMonth() &&
      now.getDate() == date.getDate();

    const formatter = isToday
      ? messageUtils.timeFormatter
      : messageUtils.dateAndTimeFormatter;
    return formatter.format(date);
  }

  /**
   * Sets dates in a message for display, setting according to the
   * no_friendly_date preference.
   *
   * @param {object} msg
   *   The new message to put the details into.
   * @param {object} summary
   *   The current summary details from the store state.
   */
  async _setDates(msg, summary) {
    let date = new Date(msg.rawDate);
    if (summary.prefs.noFriendlyDate) {
      msg.date = this.dateAsInMessageList(date);
      msg.fullDate = "";
    } else {
      msg.date = await browser.conversations.makeFriendlyDateAgo(
        date.getTime()
      );
      msg.fullDate = this.dateAsInMessageList(date);
    }
  }
}
