# 🌡️ Model Temp Locks (STMTL Extension for SillyTavern)

![Status: Feature Complete](https://img.shields.io/badge/Status-Feature%20Complete-brightgreen)
![Maintenance: Active](https://img.shields.io/badge/Maintenance-Active-blue)

A SillyTavern extension that automatically remembers and applies your preferred model and temperature settings for different characters, chats, and group conversations. No more constantly tweaking settings - just set them once and let the extension handle the rest.

> **📋 Project Status**: This extension is considered feature-complete and stable as of version 3.0.1. While major new features are not planned, bug reports and compatibility updates are welcome!

## ⚠️ Requirements

- **Chat Completion API only**: Works with OpenAI API-compatible chat completion endpoints
- **Supported providers**: OpenAI, Claude, WindowAI, OpenRouter, AI21, Scale, Google (Makersuite), Mistral AI, Custom, Cohere, Perplexity, Groq, 01.AI, NanoGPT, DeepSeek, BlockEntropy
- **What it saves**: Model selection and temperature only (if you need more comprehensive presets, use SillyTavern's built-in character preset matching)

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

**Notification Options:**
- ✅ **Show auto-save notifications** - Get notified when settings are auto-saved
- ✅ **Show other notifications** - Get notified about API status, settings applied, etc.

### Saving Settings

**Manual Saving (Recommended for initial setup):**
- **Set Character** / **Set Group** - Save current model/temp for this character or group
- **Set Chat** - Save current model/temp for this specific conversation
- **Set Both** / **Set All** - Save to both character/group and chat
- **Set Active Char** (group chats only) - Save settings for the currently active character

**Auto-Saving (Recommended for ongoing use):**
- Enable auto-save options and your settings will be remembered automatically as you chat
- Settings are saved when you send messages or generate responses

### Managing Saved Settings

**Viewing Current Settings:**
The panel shows you what's currently saved for:
- Character/Group settings
- Individual character settings (in group chats)
- Chat settings
- When each was last saved

**Clearing Settings:**
- **Clear Character** / **Clear Group** - Remove saved character or group settings
- **Clear Chat** - Remove saved chat settings
- **Clear Active Char** (group chats only) - Remove settings for the active character
- **Clear All** - Remove all saved settings for the current context

## 🎯 Common Use Cases

### Character-Focused Setup
1. Enable "Remember per character" and "Auto-save character settings"
2. Set up each character with their preferred model and temperature
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

**API Compatibility Check**: The extension automatically detects if you're using a compatible API and shows status in the settings panel.

**Settings Storage**: 
- Character and group settings are stored in extension settings
- Chat settings are stored in chat metadata
- All settings include model, temperature, completion source, and timestamp

**Group Chat Detection**: Automatically detects group chats and shows appropriate options.

---

*Made with love (and Claude Sonnet 4)* 🤖