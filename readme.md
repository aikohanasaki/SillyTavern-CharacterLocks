# 🌡️ Model Temp Locks (A SillyTavern Extension)

Your AI chat settings, but smarter. This extension remembers what model and temperature you like to use for different characters and chats, so you don't have to keep tweaking things every time.

## ⚠️ Quick heads up

This only works with Chat Completion APIs (like OpenAI, Claude, OpenRouter). If you're using something else, it'll just sit there doing nothing. Also, it only remembers your model and temperature - nothing else! (If you need to save that many settings, you are better off with ST's built in character preset matching.)

## What it does

**Character Memory** - Remembers model/temp for each character you chat with.
**Chat Memory** - Remembers model/temp for specific conversations. 

You can use both at the same time, and decide which one takes priority when they conflict.

## Setting it up

First, open the extension by clicking "Model Memory" in your Extensions menu. You'll see some checkboxes:

**NEW: Notification options:**
- **Show auto-save notifications**: Get a small pop-up confirming when your settings have been auto-saved.
- **Show other notifications**: Get pop-ups for other events, like when settings are applied, cleared, or if there's an API mismatch.

**Memory options:**
- Turn on "Remember per character" if you want different characters to have their own preferred settings
- Turn on "Remember per chat" if you want individual conversations to remember their own settings

**Auto-save options:**

If enabled, Model Temp Locks will auto-save whenever messages are generated. Choose between: 
- Auto-save character settings
- Auto-save chat settings
- Both
- **DEFAULT**: Neither (manual save only)

**Priority setting:**
- Choose "Prefer character settings over chat" if you want character preferences to take priority
- Leave it off if chat settings should take priority.

## How to save your settings

**Save manually** (Aiko recommends this setting for characters)
When you've got your model and temperature set how you like them, hit one of these buttons:
- "Update Both" saves to both character and chat
- "Update Character" saves just for this character  
- "Update Chat" saves just for this conversation

**Let it save automatically** (Aiko recommends this setting for chats)
Once you turn on auto-save, it'll remember your settings whenever you send a message or generate a response. Just set things how you want and chat normally.

## Managing your saved stuff

**Getting rid of settings:**
- "Clear Character" removes what you saved for this character
- "Clear Chat" removes what you saved for this conversation
- "Clear All" wipes everything clean

**Seeing what's saved:**
The extension panel shows you what settings are currently saved and when they were last updated. There's also a little indicator that tells you if everything's working with your current API setup.

## Use Cases

**If you're character-focused:**
Turn on character memory and autosave, then set up each character's preferred model and temperature. When you switch between characters, your settings will automatically change to match.

**If you care more about individual chats:**
Enable chat memory and autosave. Each conversation can have its own vibe.

**Mix and match:**
Use both! Set up character defaults, then override them for specific conversations when you need something different. Model Temp Locks handles the priority based on your preferences.

## Technical Requirements/Details

**Works with these APIs:** OpenAI, Claude, WindowAI, OpenRouter, AI21, Scale, Google (Makersuite), Mistral AI, Custom, Cohere, Perplexity, Groq, 01.AI, NanoGPT, DeepSeek, BlockEntropy

**What you need:** Your main API has to be set to "Chat Completion" mode

**Updates:** If you're upgrading from version 1.2.x or lower, your existing settings will carry over automatically.

---

*Made with love (and Claude Sonnet 4)* 🤖