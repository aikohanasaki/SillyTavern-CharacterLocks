# SillyTavern Character Locks - Specification

## Functional Specification

### Extension Purpose & Intent
The Character Locks extension has two primary intents:

1. **Main Extension Intent**: Save specific model-preset-prompt combinations for characters
   - Remember complete AI configuration triplets (model + generation settings + prompts) per character/chat context
   - Automatically restore the exact combination when switching between characters or chats
   - Eliminate repetitive manual reconfiguration of the full AI generation stack

2. **Optional Model-Prompt Links**: If model changes, automatically change prompts (but not presets)
   - Conditional prompt switching based on active model selection
   - Boolean logic rules for automatic prompt adaptation
   - Allows prompts to adapt to different models while keeping generation settings stable

### Core Functionality

#### Settings Memory System
The extension remembers and automatically restores complete AI configuration combinations:
- **Model Selection**: Specific AI model within the chosen service
- **API Profiles** (Connection/Completion Source): Which AI service to use (OpenAI, Claude, Kobold, etc.)
- **Generation Presets**: Parameter bundles controlling how AI generates text (temperature, top_p, etc.)
- **Prompt Configurations**: Instructions and context sent to the AI (varies by API type)

These form **model-preset-prompt triplets** that define the complete AI generation behavior for each context.

#### Context Types & Memory Domains
- **Character Memory**: Per-character settings for individual characters in single chats
- **Chat Memory**: Per-conversation settings for specific chat sessions
- **Group Memory**: Default settings for entire group chats
- **Individual Character in Groups**: Character-specific settings that persist even within group contexts

#### Priority & Conflict Resolution
The extension implements configurable priority systems to resolve conflicts when multiple memory domains contain settings:
- **Single Chats**: User chooses whether character or chat settings take precedence
- **Group Chats**: User chooses whether group or chat-specific settings take precedence
- **Individual Override**: Optionally give highest priority to individual character settings within groups

#### Model-Prompt Linking (Optional Feature)
- Automatic prompt switching when model changes (presets remain unchanged)
- **Default State**: Opted in by default (enabled), users must opt out to disable
- **Model Filter System**: Boolean logic rules for conditional prompt adaptation using AND/NOT/AND NOT/OR operations
  - Uses existing JavaScript Boolean logic library for expression evaluation
  - Filter expressions match against model names to determine when to activate specific prompts
  - Examples: `gpt-4 AND NOT gpt-4-turbo`, `claude OR anthropic`, `llama AND 70b`
  - **Text Input Interface**: Text input with syntax validation (no visual builder needed)
  - **Export/Import Capability**: Boolean filter expressions must be exportable for sharing configurations
- Allows prompts to be optimized for specific models while maintaining consistent generation settings
- Independent of the main character memory system

### Key Behaviors

#### Context Detection
- Automatically detects single character chats vs group chats
- Adapts UI and functionality based on chat context and API type
- Maintains separate settings storage for different context types

#### Cross-Session Persistence
- Character and group settings persist in extension configuration
- Chat-specific settings persist in SillyTavern's chat metadata
- Settings survive application restarts and chat navigation

#### API Compatibility
- Supports both Chat Completion APIs (message-based with roles) and Text Completion APIs (raw text with formatting templates)
- Automatically adapts prompt handling based on active API type

#### Integration Philosophy
- Works transparently with SillyTavern's existing systems
- Does not replace built-in preset or prompt managers
- Enhances workflow by adding memory and automation layers
- **SillyTavern Standards Compliance**:
  - Must follow SillyTavern standards for CSS styling and class naming
  - Must use SillyTavern's event system and event handling patterns
  - Must follow SillyTavern conventions for slash command implementation
  - Must prioritize existing SillyTavern styles and functions over custom implementations
  - Any exceptions to standard patterns must be technically justified and documented

#### Error Handling Philosophy
- **Critical Errors**: Require user intervention for data integrity issues
- **Implementation Details**: Error handling patterns will be detailed during implementation phase
- **User Experience**: Maintain extension functionality even when individual features fail

#### Code Structure Requirements

**Module Separation**:
- **modelprompt.js** - Separate file containing all model-prompt linking functionality
  - Only loaded when user enables model-prompt linking features
  - Contains all templates, popups, and functions related to model filtering
  - Includes Boolean logic evaluation and model matching code
  - Completely independent from main extension functionality

- **utils.js** - Shared utility functions file
  - Contains common code used by both main extension and model-prompt linking
  - Utilities for settings management, UI helpers, and common operations
  - Loaded by both index.js and modelprompt.js as needed

**Performance Optimization**:
- Minimal stub loads initially for enabled-by-default model-prompt linking
- Full modelprompt.js loads lazily when feature is actually used
- Clean separation prevents unnecessary code execution for users who don't use advanced features

### User Interface Specifications

#### Panel Organization & Layout
- **Main Settings Panel**: Accessible via Extensions menu with clear section divisions
- **Context-Adaptive UI**: Interface adapts based on single chat vs group chat context
- **Settings Categories**: Logical grouping of related controls (Memory, Priority, Advanced)

#### Control Requirements
- **Checkbox Controls**: Standard SillyTavern checkbox styling and behavior
- **Button Placement**: Save/Clear actions prominently positioned with consistent spacing
- **Status Indicators**: Clear visual feedback for saved settings and API compatibility

#### Interaction Patterns
- **Immediate Feedback**: Settings changes provide instant visual confirmation
- **Context Switching**: Smooth transitions when moving between different chat contexts
- **Keyboard Navigation**: All controls accessible via keyboard for accessibility

#### State Management
- **Visual State**: Clear indication of what settings are currently saved for each context
- **Conflict Resolution**: Visual cues when multiple memory domains contain different settings
- **Loading States**: Appropriate loading indicators during save/restore operations

### UI/UX Flow & Main Popup Structure

#### Popup Trigger
- **Entry Point**: Clicking any thumbtack (📌) option opens the main popup
- **Multiple Triggers**: Preset buttons, prompt manager buttons, connection profile buttons, and menu item all open the same main popup

#### Main Popup Contents
The main popup adapts its content based on context (single chat vs group chat):

**1. Header Section**
- Extension title: "📌 Character Locks"

**2. Configuration Section**
- **Context-Adaptive Checkboxes**: Organized with clear section headers
  - **Memory Settings**: Character/Group/Chat memory enable/disable options
  - **Priority Settings**: Conflict resolution preference controls
  - **Notification Settings**: Auto-save and other notification toggles
  - **Advanced Features**: Model-Prompt Links enable/disable toggle (enabled by default)
- **Logical Grouping**: Related controls grouped under descriptive subheadings

## Multi-User Support & Configuration

### Multi-User Detection
The extension automatically detects SillyTavern's multi-user mode by checking:
- `accountsEnabled` - Boolean indicating if multi-user accounts are enabled
- `currentUser` - Current user object containing handle, name, and admin status
- `getCurrentUserHandle()` - Returns user handle ('default-user' in single-user mode)

### Behavior by Mode
- **Single-User Mode** (`accountsEnabled` = false):
  - User is always admin (`isAdmin()` returns true)
  - User handle is always 'default-user'
  - All access restrictions are bypassed

- **Multi-User Mode** (`accountsEnabled` = true):
  - Admin status depends on user's actual role
  - Each user has a unique handle
  - Access restrictions apply based on config and admin status

### Configuration Options (config.yaml)
These options control extension behavior in multi-user environments:

- **`allowNonAdminFullAccess`** (boolean, default: false)
  - When true: Non-admin users have full access to all extension features
  - When false: Non-admin users have restricted access per other config options

- **`allowNonAdminEditFilters`** (boolean, default: false)
  - When true: Non-admin users can edit Boolean filter expressions
  - When false: Non-admin users have read-only access to Boolean filters

- **`allowNonAdminToggleModelPrompt`** (boolean, default: false)
  - When true: Non-admin users can enable/disable model-prompt linkage
  - When false: Non-admin users cannot modify model-prompt linking settings

- **`promptTemplateImportSource`** (string, default: "")
  - URL or file path for importing prompt templates in JSON format
  - If non-blank: Automatically imports/overrides templates on extension load
  - **Master Source Behavior**: When configured, disables template editing UI with warning message
  - Allows centralized template management with export/import functionality

- **`booleanFiltersSource`** (string, default: "")
  - URL or file path for importing Boolean filter configurations in JSON format
  - If non-blank: Automatically imports/overrides filter rules on extension load
  - **Master Source Behavior**: When configured, disables filter editing UI with warning message
  - Enables centralized filter rule management with export/import functionality

### Implementation Notes
- Extension checks these configuration options regardless of single/multi-user mode
- In single-user mode, all restrictions are automatically bypassed due to admin status
- Settings are stored per user handle when in multi-user mode
- Admin users always have full access regardless of configuration settings

**3. Settings Information Display**
- **Context-Conditional Display**: Only shows when in appropriate context
  - Only appears when a chat, character, or group is active
  - Hidden on startup or when no context is loaded
- **Current Context Information**: Shows what settings are currently saved
  - Character/Group settings with timestamps
  - Chat-specific settings with timestamps
  - Individual character settings (group chats only)
- **Formatted Display**: Settings shown in readable format with save dates

**4. Action Buttons Section**
- **Save Actions**: Set Character/Group, Set Chat, Set Both/All buttons
- **Clear Actions**: Clear Character/Group, Clear Chat, Clear All buttons
- **Context-Adaptive**: Button labels change based on single vs group chat context
- **Context-Conditional Display**: Buttons only display when in appropriate context
  - Chat buttons only appear when a chat is loaded
  - Character buttons only appear when a character is active
  - Group buttons only appear when in a group chat
  - No action buttons shown on startup when no chats/characters are loaded

**5. Advanced Features Section** (if enabled)
- **Custom Buttons**: Use customButtons to link to secondary popups
  - "Configure Model-Prompt Links" → Opens Model-Prompt Configuration Window
  - **Button State**: Disabled when Model-Prompt Links toggle (in Configuration Section) is unchecked
  - **Note**: <small>Only enabled when Model-Prompt Links is checked</small>
  - Additional custom buttons for other advanced features as needed

#### Secondary Popups (Accessed from Main Popup)

**1. Model-Prompt Configuration Window**
- **Trigger**: "Configure Model-Prompt Links" custom button in Advanced Features section
- **Window Header**: "Model-Prompt Links Configuration"
- **Required Property**: Must include `allowVerticalScrolling: true` in popup options

**Core Interface Elements:**

- **Enable/Disable Section**:
  - Status: "Model-Prompt Links Enabled/Disabled" (enabled by default)
  - Description: "Automatically switch prompts when model changes (presets remain unchanged)"

- **Active Status Section**:
  - Current model display showing active AI model name
  - Matching rules indicator showing which rules currently apply
  - Rule priority indicator when multiple rules match

- **Boolean Filter Configuration**:
  - Text input field for Boolean expressions with validation
  - Placeholder: "e.g., gpt-4 AND NOT turbo"
  - Supported operators reference: AND, OR, NOT, AND NOT (list in small text)
  - Real-time syntax validation feedback
  - **Available Models Info Block**: Displays existing connection model list applicable to current rule
    - Populated based on #model_x_select (where x is the completion source)
    - **Display Format**: Models listed with comma separation (e.g., "gpt-4, gpt-4-turbo, gpt-3.5-turbo")
    - **Large Model Lists**: When more than 10 models, displays "Too many models to display in this box, click popout to view"
    - **Popout Window**: Info-only popup showing full model list with close/X button
    - Always updating based on current source selection for real-time filter testing
  - **Scope Toggle**: Checkbox to assign Boolean filters globally vs this source only
    - When checked: Filter applies globally across all API sources
    - When unchecked: Filter applies only to selected completion source
    - **Source Selection Info Block**: Appears when "this source only" is selected
      - Displays current completion source (not a dropdown)
      - Updates automatically based on current active completion source
      - Shows which source the filters are being configured for
    - **Dual-List Filter Management**: Appears when "this source only" is selected
      - **Left List**: "Filters for this source" - Shows rules specific to selected completion source
      - **Right List**: "Global filters (not for this source)" - Shows global rules not applied to this source
      - **Transfer Buttons** (using Font Awesome icons with tooltips):
        - `fa-angles-right` (>>): "Add all" - Move all global filters to source-specific
        - `fa-chevron-right` (>): "Add this one" - Move selected global filter to source-specific
        - `fa-chevron-left` (<): "Remove this one" - Move selected source filter back to global
        - `fa-angles-left` (<<): "Remove all" - Move all source filters back to global
      - **Implementation**: Uses existing SillyTavern `.list-group` classes and jQuery UI `.sortable()` functionality

- **Rule Management Interface**:
  - Add Rule button (always visible)
  - Edit/Delete Rule buttons (visible when rules exist)
  - Rule list displaying all configured rules with:
    - Filter expression text
    - Associated prompt configuration
    - Individual rule enable/disable toggles
    - Priority controls (move up/down for ordering)

- **Export/Import Section**:
  - Export Rules button - exports all filter configurations in JSON format
  - Import Rules button - imports filter configurations from JSON format (disabled when `booleanFiltersSource` configured)
  - Export Templates button - exports all prompt templates in JSON format
  - Import Templates button - imports prompt templates from JSON format (disabled when `promptTemplateImportSource` configured)
  - JSON format only for portability and ease of sharing
  - **Master Source Warning**: When master source is configured, display warning that manual imports are disabled

- **Action Controls**:
  - Apply Now button - immediately applies matching rules
  - Save/Cancel buttons for configuration changes
  - **Note**: Real-time filter testing is always active (no separate test button needed)

- **Status Feedback Area**:
  - Validation messages for filter expressions
  - Success/error feedback for import/export operations
  - Current rule match status and activity indicators

**Visibility Rules:**
- Always visible: Enable toggle, current model status, rule list, Add Rule, Export/Import, Available Models Info Block
- Conditionally visible: Edit/Delete (when rules exist), Apply (when rules configured), Models Popout (when >10 models)
- Disabled when feature off: All configuration options below enable toggle
- **Master Source Mode**: When `promptTemplateImportSource` or `booleanFiltersSource` is configured:
  - Disable respective editing controls (Add/Edit/Delete buttons for affected items)
  - Disable respective import buttons (manual imports would be overridden)
  - Display warning message: "Master source configured - manual edits and imports disabled"
  - Keep export functionality available for reference

**2. Legacy Note**
- The previous "Rules Configuration Popup" functionality has been consolidated into the main Model-Prompt Configuration Window above
- All Boolean filter configuration is now handled in the unified interface

#### Navigation Flow
```
Any 📌 Button → Main Popup
                     ↓
              Advanced Features Section
                     ↓
              "Configure Model-Prompt Links" Button → Model-Prompt Configuration Window
                                                           ↓
                                                   All Boolean filter configuration
                                                   and rule management in one interface
```

### Configuration Options

#### Checkbox Settings (Current Implementation)

**Memory Enable/Disable:**
- `enableCharacterMemory` - Remember per character (single chats)
- `enableChatMemory` - Remember per chat
- `enableGroupMemory` - Remember per group (group chats)

**Priority Settings:**
- `preferCharacterOverChat` - Prefer character settings over chat (single chats)
- `preferGroupOverChat` - Prefer group settings over chat (group chats)
- `preferIndividualCharacterInGroup` - Prefer individual character settings (group chats)

**Notification Controls:**
- `showOtherNotifications` - Show other notifications (API status, settings applied, etc.)

**Note**: Auto-save functionality was removed in favor of explicit manual save actions for better user control.

**Advanced Features:**
- `enablePromptTemplates` - Enable prompt template system

### Expected User Benefits
- **Consistency**: Each character maintains their intended "personality" settings
- **Efficiency**: No manual reconfiguration when switching contexts
- **Flexibility**: Multiple memory types accommodate different usage patterns
- **Reliability**: Settings persist across sessions and survive SillyTavern updates

---

## Vocabulary & Terminology Guide

### Purpose
This section defines key terminology used in the Character Locks extension to ensure consistent understanding of SillyTavern's complex prompt and settings systems.

## Core Concepts: The Three Ps

### 1. **Profile** (Connection/API)
The API or service being used for AI generation.
- **Stored as**: `completionSource`
- **Examples**: openai, claude, kobold, textgenerationwebui, novelai
- **UI Selector**: `#chat_completion_source` (for Chat APIs) or `#main_api` (main selector)

### 2. **Preset** (Generation Settings)
A bundle of parameters that control HOW the AI generates text. Like prompts, there are TWO DIFFERENT PRESET SYSTEMS:

#### CCPresets (Chat Completion Presets)
- **Used by**: OpenAI, Claude, OpenRouter, and all Chat Completion APIs
- **UI Selector**: `#settings_preset_openai`
- **Contains**: temperature, top_p, frequency_penalty, presence_penalty, max_tokens, etc.
- **Managed by**: OpenAI preset manager
- **Key characteristic**: Designed for message-based chat APIs with role system

#### TCPresets (Text Completion Presets)
- **Used by**: Kobold, TextGen, NovelAI, and other text completion APIs
- **UI Selectors**:
  - Kobold: `#settings_preset`
  - TextGen: `#settings_preset_textgenerationwebui`
  - NovelAI: Has its own preset system
- **Contains**: temperature, top_p, top_k, rep_pen, typical_p, etc.
- **Managed by**: API-specific preset managers
- **Key characteristic**: Designed for raw text completion with different parameter names

### 3. **Prompts** (Instructions & Context)
The actual text instructions and context sent to the AI. This is where it gets complex because SillyTavern has TWO DIFFERENT SYSTEMS:

---

## Two Distinct Prompt Systems

### CCPrompts (Chat Completion Prompts)
**Used by**: OpenAI, Claude, OpenRouter, Mistral, and all OpenAI-compatible APIs

**Managed by**: `completion_prompt_manager` (a unified prompt management system)
- **UI Location**: Within the Chat Completion settings panel
- **Container ID**: `#completion_prompt_manager`
- **What it manages**:
  - System prompts
  - Main prompts
  - NSFW prompts
  - Jailbreak prompts
  - Impersonation prompts
  - Various other role-based prompts

**Key characteristic**: All prompts are managed through a single, integrated Prompt Manager interface where users can enable/disable, reorder, and edit multiple prompt types.

### TCPrompts (Text Completion Prompts)
**Used by**: Kobold, TextGenerationWebUI, NovelAI, and other traditional text completion APIs

**Managed by**: Three separate systems that work together:

1. **Context Template** (`#context_presets`)
   - Controls overall story/context formatting
   - Defines how the conversation history is structured
   - Location: Advanced Formatting settings
   - Stored in: `power_user.context.preset`

2. **Instruct Mode** (`#instruct_presets`)
   - Controls instruction formatting when enabled
   - Defines input/output sequences, system sequences, etc.
   - Location: Instruct Mode settings panel
   - Only active when: `power_user.instruct.enabled === true`
   - Stored in: `power_user.instruct.preset`

3. **System Prompt** (`#sysprompt_select`)
   - Standalone system prompt management
   - Was migrated out of Instruct Mode to be its own system
   - Location: System Prompt settings panel
   - Only active when: `power_user.sysprompt.enabled === true`
   - Stored in: `power_user.sysprompt.name`

---

## Important Distinctions

### Chat Completion vs Text Completion
- **Chat Completion APIs** use a message-based format with roles (system, user, assistant)
- **Text Completion APIs** use raw text completion with formatting templates

### When Each System is Active
- **CCPrompts**: Active when `main_api === "openai"` (or any Chat Completion API)
- **TCPrompts**: Active when using Kobold, TextGen, NovelAI, etc.

### What Gets Saved
The extension should save different things depending on the API type:

**For Chat Completion APIs**:
```javascript
{
    completionSource: "openai",  // The Profile (API)
    ccPreset: "Creative-v2",      // The CCPreset (Chat Completion generation settings)
    ccPrompts: {                  // The CCPrompts (Prompt Manager state)
        // State of the completion_prompt_manager
        // This needs to be defined based on what's saveable
    }
}
```

**For Text Completion APIs**:
```javascript
{
    completionSource: "kobold",    // The Profile (API)
    tcPreset: "Godlike",           // The TCPreset (Text Completion generation settings)
    tcPrompts: {                   // The TCPrompts (separate prompt systems)
        contextTemplate: "Default",    // Context formatting (if used)
        instructPreset: "Alpaca",      // Instruct mode (if enabled)
        systemPrompt: "Assistant"      // System prompt (if enabled)
    }
}
```

---

## UI Elements Reference

### Selectors Map
```javascript
// Profile/API Selection
SELECTORS.mainApi = '#main_api'
SELECTORS.completionSource = '#chat_completion_source'

// CCPresets (Chat Completion Presets)
SELECTORS.ccPreset = '#settings_preset_openai'

// TCPresets (Text Completion Presets)
SELECTORS.tcPresetTextgen = '#settings_preset_textgenerationwebui'
SELECTORS.tcPresetKobold = '#settings_preset'

// CCPrompts (Chat Completion Prompts)
SELECTORS.ccPrompts = '#completion_prompt_manager'

// TCPrompts (Text Completion Prompts)
SELECTORS.tcContext = '#context_presets'      // Context Template
SELECTORS.tcInstruct = '#instruct_presets'    // Instruct Mode
SELECTORS.tcSysprompt = '#sysprompt_select'   // System Prompt
```

---

## Related Files

### SillyTavern Core Files
- `C:\Users\ai\Aikobots Code\Aikobots\public\scripts\openai.js` - Chat Completion implementation and CCPrompts system
- `C:\Users\ai\Aikobots Code\Aikobots\public\scripts\PromptManager.js` - CCPrompts management system
- `C:\Users\ai\Aikobots Code\Aikobots\public\scripts\power-user.js` - Contains context_presets and instruct/sysprompt settings
- `C:\Users\ai\Aikobots Code\Aikobots\public\scripts\instruct-mode.js` - TCPrompts instruct system
- `C:\Users\ai\Aikobots Code\Aikobots\public\scripts\sysprompt.js` - TCPrompts system prompt management
- `C:\Users\ai\Aikobots Code\Aikobots\public\scripts\textgen-settings.js` - Text completion API settings
- `C:\Users\ai\Aikobots Code\Aikobots\public\scripts\preset-manager.js` - Preset management for all APIs

### Extension Files
- `index.js` - Main extension implementation
- `vocab.md` - This vocabulary file
- `manifest.json` - Extension metadata

---

## Extension Behavior Notes

### Auto-Save Considerations
- Context Template and Instruct Preset should only be saved if their respective modes are enabled
- System Prompt should only be saved if sysprompt is enabled
- For Chat Completion, need to determine what state of the Prompt Manager can/should be saved

### Priority System
The extension already has a priority system for character vs chat settings. This should apply to all three Ps:
- Character settings can include preferred Profile, Preset, and Prompts
- Chat settings can override with different Profile, Preset, and Prompts
- User preference determines which takes precedence

### Migration Path
When updating the extension:
1. Existing saved `preset` and `completionSource` remain unchanged
2. Add new fields for prompt configurations based on API type
3. Provide sensible defaults for missing prompt data

---

## Why This Matters

SillyTavern's complexity comes from supporting many different AI APIs that work in fundamentally different ways. Chat Completion APIs (like OpenAI) structure conversations as messages with roles, while Text Completion APIs (like Kobold) work with raw text that needs formatting templates.

The Character Locks extension must understand these differences to properly save and restore the complete configuration for each character/chat, ensuring the AI behaves consistently when switching contexts.