# Thunderbird Conversations with QNote Integration

This is a fork of [Thunderbird Conversations](https://github.com/thunderbird-conversations/thunderbird-conversations) with integrated [QNote](https://github.com/mlazdans/qnote) support.

## What's Different?

This version adds QNote integration, allowing you to see your QNote notes directly in the conversation view.

## Features

- All features from the original Thunderbird Conversations
- **NEW**: Display QNote notes in conversation view
- **NEW**: Notes appear in a yellow box between message tags and message body
- **NEW**: Easy configuration via preferences

## Installation

1. Download the latest `conversations.xpi` from releases
2. Install in Thunderbird via Add-ons → Install Add-on From File
3. Configure the QNote folder path in preferences

## Configuration

1. Open Thunderbird Conversations preferences
2. Scroll down to "QNote Folder Path"
3. Enter the path where QNote stores notes (e.g., `/Users/username/qnote`)
4. Restart Thunderbird

## How It Works

QNote stores notes as JSON files named `<message-id>.qnote`. This addon:

1. Reads the QNote folder path from preferences
2. For each message, looks for a corresponding `.qnote` file
3. Parses the JSON and extracts the note text
4. Displays the note in a highlighted box in the conversation view

## Requirements

- Thunderbird 140+
- QNote addon configured to use folder-based storage

## Building

```bash
npm ci
npm run build
```

The built addon will be in `dist/` and `conversations.xpi`.

## Credits

- Original Thunderbird Conversations by Jonathan Protzenko and contributors
- QNote integration added by js32
- QNote addon by mlazdans

## License

MPL-2.0 (same as original Thunderbird Conversations)
