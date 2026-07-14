## Changes

### Fixes

- Fix automatically marking messages as read in Thunderbird 152 and later
- Stop using removed PluralForm functionality (attachment counts now use Intl.PluralRules)
- Add missing qnote_folder default preference, and fix the preference migration check that never backfilled missing preferences
- Clearing the QNote folder path in the options page now also clears the underlying preference
- Reject message IDs containing path separators when looking up QNote files (defense in depth)
- Fix untranslated attachment count in the Bulgarian locale

### Performance

- QNote lookups are cached for 30 seconds and note files are read asynchronously — no more synchronous file system access on the main thread when rendering conversations

Includes all changes since v4.4.1 (v4.4.2 was never published as a release).

## Installation

Download and install `conversations.xpi` in Thunderbird 140+
