# STChatModelTemp Extension

Remembers model and temperature settings for each character and individual chat, with automatic saving and restoration.

## IMPORTANT NOTE

- Only works with Chat Completion API, will not work with others (will be dormant and do nothing)
- Only saves model and temperature, does not save any other parameters (top_p, etc.)

## Features

- **Per-Character Memory**: Save different model/temperature settings for each character
- **Per-Chat Memory**: Save different settings for individual conversations with the same character
- **Auto-Save**: Automatically saves settings when you change model or temperature
- **Priority Control**: Choose whether character settings override chat settings or vice versa

## Usage

1. **Configure** your preferences in the extension panel
2. **Set your desired model/temperature** for a character or chat
3. **Save manually** or let auto-save handle it
4. **Switch characters/chats** - settings restore automatically

## Development Notes

Vibe coded with Claude Sonnet 4.
This extension is designed to be completely self-contained and update-safe:

- `.gitignore` prevents settings from being tracked in version control
- Robust error handling for file operations
- Graceful fallbacks when settings file is missing or corrupted