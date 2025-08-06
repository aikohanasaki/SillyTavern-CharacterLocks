# 🌡️ Model Temp Locks (A SillyTavern Extension)

Your AI chat settings, but smarter. This extension remembers what model and temperature you like to use for different characters, chats, and even group conversations, so you don't have to keep tweaking things every time.

## ⚠️ Quick heads up

This only works with Chat Completion APIs (like OpenAI, Claude, OpenRouter). If you're using something else, it'll just sit there doing nothing. Also, it only remembers your model and temperature - nothing else! (If you need to save that many settings, you are better off with ST's built in character preset matching.)

## What it does

**Character Memory** - Remembers model/temp for each character you chat with.
**Chat Memory** - Remembers model/temp for specific conversations.
**Group Memory** - Remembers model/temp for group chats, with smart handling for multiple characters.

You can use any combination of these, and decide which one takes priority when they conflict. Perfect for when you want different vibes for solo chats vs group conversations!

## Setting it up

First, open the extension by clicking "Model/Temp Settings" in your Extensions menu. What you see depends on whether you're in a regular chat or a group chat:

### Single Character Chats

**Notification options:**
- **Show auto-save notifications**: Get a small pop-up confirming when your settings have been auto-saved.
- **Show other notifications**: Get pop-ups for other events, like when settings are applied, cleared, or if there's an API mismatch.

**Memory options:**
- Turn on "Remember per character" if you want different characters to have their own preferred settings
- Turn on "Remember per chat" if you want individual conversations to remember their own settings

**Auto-save options:**
- Auto-save character settings
- Auto-save chat settings
- **DEFAULT**: Neither (manual save only)

**Priority setting:**
- Choose "Prefer character settings over chat" if you want character preferences to take priority
- Leave it off if chat settings should take priority

### Group Chats

**Memory options:**
- Turn on "Remember per group" if you want different group chats to have their own preferred settings
- Turn on "Remember per chat" if you want individual group conversations to remember their own settings

**Auto-save options:**
- Auto-save group settings
- Auto-save chat settings

**Priority settings:**
- Choose "Prefer group settings over chat" if you want group-wide preferences to take priority over individual chat settings
- Turn on "Prefer individual character settings" if you want the extension to remember settings for each character even within groups (this gets the highest priority when enabled)

## How to save your settings

**Save manually** (Aiko recommends this for character setups)
When you've got your model and temperature set how you like them, hit one of these buttons:
- "Set Both" saves to both character/group and chat
- "Set Character" saves just for this character (or group in group chats)
- "Set Chat" saves just for this conversation

**Let it save automatically** (Aiko recommends this for ongoing chats)
Once you turn on auto-save, it'll remember your settings whenever you send a message or generate a response. Just set things how you want and chat normally.

## Managing your saved stuff

**Getting rid of settings:**
- "Clear Character" removes what you saved for this character/group
- "Clear Chat" removes what you saved for this conversation
- "Clear Both" wipes everything clean for the current context

**Seeing what's saved:**
The extension panel shows you what settings are currently saved and when they were last updated. In group chats, you'll see both group-wide settings and individual character settings when available. There's also a little indicator that tells you if everything's working with your current API setup.

## Use Cases

**If you're character-focused:**
Turn on character memory and autosave, then set up each character's preferred model and temperature. When you switch between characters, your settings will automatically change to match.

**If you care more about individual chats:**
Enable chat memory and autosave. Each conversation can have its own vibe, whether it's a solo chat or a group conversation.

**Group chat enthusiast:**
Set up group-wide defaults for your favorite group conversations. Maybe your "Writing Workshop" group uses a creative model while your "Tech Support" group uses something more focused.

**Advanced group management:**
Enable individual character preferences in groups! This lets you have different settings for each character even when they're all in the same group chat. Perfect for when you want your serious advisor character to use a different model than your silly comic relief character, even in the same conversation.

**Mix and match everything:**
Use all the features! Set up character defaults, override them with group settings, then fine-tune individual chats when you need something completely different. Model Temp Locks handles all the priority logic based on your preferences.

## Technical Requirements/Details

**Works with these APIs:** OpenAI, Claude, WindowAI, OpenRouter, AI21, Scale, Google (Makersuite), Mistral AI, Custom, Cohere, Perplexity, Groq, 01.AI, NanoGPT, DeepSeek, BlockEntropy

**What you need:** Your main API has to be set to "Chat Completion" mode

**Group chat detection:** Automatically detects when you're in a group chat and switches to group-appropriate options

**Updates:** If you're upgrading from earlier versions, your existing settings will carry over automatically. New group features are added seamlessly alongside your existing character and chat preferences.

---

*Made with love (and Claude Sonnet 4)* 🤖