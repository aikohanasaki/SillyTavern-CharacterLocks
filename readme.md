# 📌 Character Locks (STCL Extension for SillyTavern)

A SillyTavern extension that automatically remembers and applies your preferred connection profile and preset settings for different characters, chats, and group conversations. No more constantly tweaking settings - just set them once and let the extension handle the rest.

![STCL Settings](https://github.com/aikohanasaki/imagehost/blob/main/STCL.png)

✨ **Version 4.0.0** is completely redesigned from model/temperature locks to preset and connection profile locks.

**Work In Progress**: currently working on adding chat completion prompt management that is separate from presets

📋 **[View Changelog](changelog.md)** for detailed version history and updates.

## ⚠️ Requirements

- **Connection Manager Extension**: Requires the Connection Manager extension to be enabled (official ST included extension)
- **What it saves**: Connection profiles and presets are saved per chat, character, and/or group chat. 
- **Breaking Change**: Old version (STMTL) profiles are no longer useful and will be converted automatically when you open a the chat. 

## 🚀 Features

### Memory Types
- **Character Memory** - Remembers settings for each character in single chats
- **Chat Memory** - Remembers settings for specific conversations (both single and group)
- **Group Memory** - Remembers settings for entire group chats
- **Individual Character Memory in Groups** - Remembers settings for specific characters even within group chats

### Smart Priority System
- **Single Chats**: Choose whether character settings or chat settings take priority
- **Group Chats**: Choose whether group-wide settings or chat-specific settings take priority
- **Individual Characters in Groups**: Optionally give highest priority to individual character settings within groups

### Auto-Save Options
- Auto-save when you send messages or generate responses
- Separate auto-save controls for character/group settings and chat settings
- Manual save options always available

### Notification Control
- Toggle auto-save notifications
- Toggle other notifications (API status, settings applied, etc.)

## 📖 How to Use

### Opening the Extension
Click **"Model/Temp Settings"** in your Extensions menu to open the settings panel.

### Setting Up Your Preferences

The settings panel adapts based on whether you're in a single chat or group chat:

**Single Character Chats:**
- ✅ **Remember per character** - Each character gets their own model/temp preferences
- ✅ **Remember per chat** - Individual conversations remember their settings
- ✅ **Prefer character settings over chat** - Character preferences override chat preferences
- ✅ **Auto-save character settings** - Automatically save when chatting with characters
- ✅ **Auto-save chat settings** - Automatically save chat-specific preferences

**Group Chats:**
- ✅ **Remember per group** - Each group chat gets its own default settings
- ✅ **Remember per chat** - Individual group conversations remember their settings
- ✅ **Prefer group settings over chat** - Group defaults override chat-specific settings
- ✅ **Prefer individual character settings** - Remember settings for each character in groups (highest priority)
- ✅ **Auto-save group settings** - Automatically save group-wide preferences
- ✅ **Auto-save chat settings** - Automatically save chat-specific preferences

The group chat interface displays all group members with their current settings in a responsive layout. To manage individual character settings, visit their character cards directly.

**Notification Options:**
- ✅ **Show auto-save notifications** - Get notified when settings are auto-saved
- ✅ **Show other notifications** - Get notified about API status, settings applied, etc.

### Saving Settings

**Manual Saving (Recommended for initial setup):**
- **Set Character** / **Set Group** - Save current connection profile/preset for this character or group
- **Set Chat** - Save current connection profile/preset for this specific conversation
- **Set Both** / **Set All** - Save to both character/group and chat

*For individual character settings in group chats, visit each character's card directly.*

**Auto-Saving (Recommended for ongoing use):**
- Enable auto-save options and your settings will be remembered automatically as you chat
- Settings are saved when you send messages or generate responses

### Managing Saved Settings

**Viewing Current Settings:**
The panel shows you what's currently saved for:
- Character/Group settings
- All group member settings (displayed in a responsive grid in group chats)
- Chat settings
- When each was last saved

**Clearing Settings:**
- **Clear Character** / **Clear Group** - Remove saved character or group settings
- **Clear Chat** - Remove saved chat settings
- **Clear All** - Remove all saved settings for the current context

*To clear individual character settings in group chats, visit each character's card directly.*

## 🎯 Common Use Cases

### Character-Focused Setup
1. Enable "Remember per character" and "Auto-save character settings"
2. Set up each character with their preferred connection profile and preset
3. The extension automatically switches settings when you change characters

### Chat-Focused Setup
1. Enable "Remember per chat" and "Auto-save chat settings"
2. Each conversation develops its own preferred settings over time
3. Perfect for when you want different vibes for different conversations

### Group Chat Management
1. Enable "Remember per group" for consistent group defaults
2. Enable "Remember per chat" for conversation-specific overrides
3. Optionally enable "Prefer individual character settings" to have different settings for each character even within the same group

### Advanced Mixed Setup
- Use all features together for maximum flexibility
- Set character defaults, override with group settings, fine-tune with chat settings
- The extension handles all the priority logic based on your preferences

## 🔧 Technical Details

**Connection Manager Integration**: The extension integrates with SillyTavern's Connection Manager for seamless profile management.

**Settings Storage**:
- Character and group settings are stored in extension settings
- Chat settings are stored in chat metadata
- All settings include connection profile, preset, and timestamp

**Group Chat Detection**: Automatically detects group chats and shows appropriate options.

**Major Enhancements (v4.0.0)**:
- **Preset Integration**: Full integration with SillyTavern's preset management system
- **Profile Management**: Complete connection profile switching and management capabilities
- **Streamlined Operations**: Optimized performance with reduced resource usage and improved response times
- **Enhanced Reliability**: Robust error handling with graceful fallbacks and advanced recovery mechanisms
- **Code Quality**: Major refactoring with over 2,300 lines of improvements for better maintainability
- **Improved Compatibility**: Better integration with various SillyTavern versions and configurations

## 📋 Version History

For detailed information about changes, updates, and new features in each version, see the [Changelog](changelog.md).

---

*Made with love (and Claude Sonnet 4)* 🤖