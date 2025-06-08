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
- **Update-Safe**: Your settings survive extension updates via Git

## Installation

1. Place this extension folder in `scripts/extensions/STChatModelTemp/`
2. Restart SillyTavern or reload the page
3. Find "STChatModelTemp" in the Extensions menu (wand icon)

## How It Works

The extension stores all data in a local `settings.json` file within the extension folder. This file:

- **Auto-creates** on first use
- **Never gets overwritten** during updates (protected by `.gitignore`)
- **Backs up automatically** before each save (creates `settings.json.bak`)
- **Travels with the extension** if you copy/move the folder

## Usage

1. **Configure** your preferences in the extension panel
2. **Set your desired model/temperature** for a character or chat
3. **Save manually** or let auto-save handle it
4. **Switch characters/chats** - settings restore automatically
5. **Update the extension** worry-free - your data is protected!

## Data Storage

Settings are stored in JSON format:

```json
{
  "moduleSettings": {
    "enableCharacterMemory": true,
    "enableChatMemory": true,
    "preferCharacterOverChat": true,
    "autoSave": true,
    "showNotifications": false
  },
  "characterSettings": {
    "characterId": {
      "model": "gpt-4",
      "temperature": 0.7,
      "savedAt": "2025-06-08T10:30:00.000Z"
    }
  },
  "chatSettings": {
    "chatId": {
      "model": "claude-3-sonnet", 
      "temperature": 0.9,
      "savedAt": "2025-06-08T11:15:00.000Z"
    }
  }
}
```

## File Structure

```
STChatModelTemp/
├── manifest.json          # Extension metadata
├── index.js              # Main extension code
├── style.css             # Styling
├── .gitignore            # Protects user settings from Git
├── README.md             # This file
├── settings.json         # Your settings (auto-created)
└── settings.json.bak     # Automatic backup (auto-created)
```

## Backup & Recovery

- Settings are automatically backed up before each save
- To restore: rename `settings.json.bak` to `settings.json`
- To reset: delete `settings.json` and restart - defaults will be recreated
- To migrate: copy the entire extension folder (settings travel with it)

## Development Notes

Vibe coded with Claude Sonnet 4.
This extension is designed to be completely self-contained and update-safe:

- All user data stored locally in the extension folder
- `.gitignore` prevents settings from being tracked in version control
- Robust error handling for file operations
- Graceful fallbacks when settings file is missing or corrupted