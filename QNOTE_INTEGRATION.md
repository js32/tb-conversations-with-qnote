# QNote Integration for Thunderbird Conversations

This document describes how to enable QNote integration in Thunderbird Conversations so that notes from the QNote addon are displayed directly in the conversation view.

## Prerequisites

- QNote addon must be installed and configured to use folder-based storage
- QNote must be storing notes in a filesystem folder (not internal storage)

## Setup

### Step 1: Configure QNote to use folder storage

1. Open QNote settings
2. Select "Folder" as storage option (not "Internal storage")
3. Choose or note the folder path where QNote stores notes

### Step 2: Configure Thunderbird Conversations

The recommended way is via the add-on's own options page:

1. Open Thunderbird Conversations' options (Add-ons Manager → Thunderbird
   Conversations → Preferences)
2. Enter the path in the "QNote Folder Path" field

   Example: `/Users/play/syncthing/7L-GF/_qnote`

Alternatively, you can set the underlying preference directly via the Config
Editor:

1. Open Thunderbird
2. Go to Settings → General → Config Editor (at the bottom)
3. Click "I accept the risk!"
4. Search for: `extensions.thunderbirdconversations.qnote_folder`
5. If it doesn't exist, click "String" and "+" to create it
6. Set the value to your QNote storage folder path
7. Restart Thunderbird

## How it works

Once configured, Thunderbird Conversations will:

1. Read the folder path from the preference `extensions.thunderbirdconversations.qnote_folder`
2. For each message in a conversation, look for a file named `<message-id>.qnote` in that folder
3. Parse the JSON file and extract the note text
4. Display the note in a yellow box between the message tags and the message body

## QNote file format

QNote stores notes as JSON files with the following structure:

```json
{
  "text": "The actual note text",
  "height": 500,
  "left": 706,
  "top": 302,
  "width": 500,
  "ts": 1752055830795
}
```

The filename is the URL-encoded message ID with `.qnote` extension.
Example: `10aa54c6-7007-4c5f-9cb4-d2e46eebfb44%40fk.siebenlinden.org.qnote`

## Troubleshooting

- **Notes not showing up**: Check that:
  - The folder path is correct
  - QNote is using folder storage (not internal storage)
  - The .qnote files exist in the configured folder
  - You've re-opened the conversation — note lookups are cached for up to
    30 seconds

- **Check the Browser Console** (Ctrl+Shift+J) for messages starting with
  "QNote" (enable the "Debug" log level to see the informational ones)

## Technical Details

### Implementation

The integration works by:

1. **API Method** (`addon/experiment-api/api.js:320`): `getQNoteForMessage(messageId)`
   - Reads the folder path from preferences
   - Constructs the filename using URL-encoded message ID
   - Reads and parses the JSON file asynchronously via `IOUtils`
   - Returns the note text
   - Results are cached per message ID for 30 seconds, so re-renders of the
     same conversation don't re-read the files; the cache is cleared when the
     folder path is changed via the options page

2. **Message Enrichment** (`addon/content/reducer/messageEnricher.mjs:109`)
   - Calls `getQNoteForMessage()` during message enrichment
   - Stores the note text in `msg.qnote`

3. **UI Display** (`addon/content/components/message/message.mjs:418`)
   - Renders notes in a yellow box if `message.qnote` is present
   - Styled with light yellow background (#fffacd)
   - Positioned between message tags and message body

### Preference Fallback

The system tries to read the folder path in this order:

1. `extensions.thunderbirdconversations.qnote_folder` (our custom preference)
2. `extensions.qnote.folder` (QNote's own preference, if exposed)

## Future Enhancements

The folder path can now be configured directly from the Thunderbird
Conversations options page (see "Setup" above), so this is no longer needed.

Remaining potential improvements:

- Auto-detect QNote's folder path from QNote's settings
- Support for editing notes directly from the conversation view
- Icon/indicator showing which messages have notes
