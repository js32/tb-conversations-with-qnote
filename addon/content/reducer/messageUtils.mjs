/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export let messageUtils = new (class {
  /** @type {Intl.PluralRules} */
  #pluralRules;

  constructor() {
    this.timeFormatter = new Intl.DateTimeFormat(undefined, {
      timeStyle: "short",
    });
    this.dateAndTimeFormatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
    this.dateFormatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: "short",
    });
  }

  /**
   * Returns the best identity to use when replying to a message.
   *
   * @param {object} msg
   *   The message data from the store to respond to.
   * @returns {Promise<string>}
   *   The identity id to use for the message.
   */
  async getBestIdentityForReply(msg) {
    let identityId = "";
    for (let contact of [...msg.to, ...msg.cc, ...msg.bcc]) {
      if (contact.identityId) {
        identityId = contact.identityId;
        break;
      }
    }

    if (!identityId) {
      let account = await browser.accounts.get(msg.folderAccountId);
      if (!account?.identities.length) {
        let defaultAccount = await browser.accounts.getDefault();
        let identityDetail = await browser.identities.getDefault(
          defaultAccount.id
        );
        identityId = identityDetail.id;
      } else {
        identityId = (await browser.identities.getDefault(account.id)).id;
      }
    }

    return identityId;
  }

  getPlural(stringPrefix, quantity) {
    if (!this.#pluralRules) {
      this.#pluralRules = new Intl.PluralRules(browser.i18n.getUILanguage());
    }
    return browser.i18n.getMessage(
      `${stringPrefix}_${this.#pluralRules.select(quantity)}`,
      [quantity]
    );
  }

  /**
   * Gets the attachments for a message. If the user wants to see as many
   * attachments as possible, this also adds anything the WebExtension API
   * knows about that the MIME emitter didn't report.
   *
   * @param {number} id
   *   The id of the message to get the attachments for.
   * @param {boolean} [extraAttachments]
   *   Whether or not the user wants to display extra attachments.
   * @returns {Promise<object[]>}
   */
  async getAttachments(id, extraAttachments) {
    let [attachments, listed] = await Promise.all([
      browser.conversations.getLateAttachments(id, !!extraAttachments),
      extraAttachments
        ? browser.messages.listAttachments(id).catch((ex) => {
            console.error("Could not list attachments:", ex);
            return [];
          })
        : [],
    ]);

    let seenParts = new Set(attachments.map((a) => a.partName));
    for (let att of listed) {
      if (seenParts.has(att.partName)) {
        continue;
      }
      seenParts.add(att.partName);
      attachments.push({
        size: att.size ?? -1,
        contentType: att.contentType,
        name: att.name,
        partName: att.partName,
        anchor: "msg" + id + "att" + attachments.length,
      });
    }
    return attachments;
  }
})();
