import { eventSource, event_types, saveSettingsDebounced, chat_metadata, name2, systemUserName, neutralCharacterName } from '../../../../script.js';
import { extension_settings, saveMetadataDebounced, getContext } from '../../../extensions.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { lodash, moment, Handlebars, DOMPurify, morphdom } from '../../../../lib.js';
import { selected_group, groups } from '../../../group-chats.js';

const MODULE_NAME = 'STMTL';
const SAVE_DEBOUNCE_TIME = 1000;

// Centralized DOM selectors - single source of truth
const SELECTORS = {
    mainApi: '#main_api',
    completionSource: '#chat_completion_source',
    menuItem: '#stmtl-menu-item',
    extensionsMenu: '#extensionsMenu .list-group',
    // Model selectors
    modelOpenai: '#model_openai_select',
    modelClaude: '#model_claude_select',
    modelWindowai: '#model_windowai_select',
    modelOpenrouter: '#model_openrouter_select',
    modelAi21: '#model_ai21_select',
    modelScale: '#model_scale_select',
    modelGoogle: '#model_google_select',
    modelMistralai: '#model_mistralai_select',
    customModelId: '#custom_model_id',
    modelCustomSelect: '#model_custom_select',
    modelCohere: '#model_cohere_select',
    modelPerplexity: '#model_perplexity_select',
    modelGroq: '#model_groq_select',
    model01ai: '#model_01ai_select',
    modelNanogpt: '#model_nanogpt_select',
    modelDeepseek: '#model_deepseek_select',
    modelBlockentropy: '#model_blockentropy_select',
    tempOpenai: '#temp_openai',
    tempCounterOpenai: '#temp_counter_openai'
};

// Supported Chat Completion sources
const SUPPORTED_COMPLETION_SOURCES = [
    'openai', 'claude', 'windowai', 'openrouter', 'ai21', 'scale', 'makersuite',
    'mistralai', 'custom', 'cohere', 'perplexity', 'groq', '01ai', 'nanogpt',
    'deepseek', 'blockentropy'
];

// Default settings structure
const defaultSettings = {
    moduleSettings: {
        enableCharacterMemory: true,
        enableChatMemory: true,
        enableGroupMemory: true,
        preferCharacterOverChat: true,
        preferGroupOverChat: true,
        preferIndividualCharacterInGroup: false,
        autoSaveCharacter: false,
        autoSaveChat: false,
        autoSaveGroup: false,
        showAutoSaveNotifications: false,
        showOtherNotifications: false
    },
    characterSettings: {},
    groupSettings: {},
    migrationVersion: 0
};

// Current cached settings for active character/chat
let currentCharacterSettings = null;
let currentChatSettings = null;
let currentGroupSettings = null;
let currentIndividualCharacterSettings = null;
let isExtensionEnabled = false;

// Cache for the current popup instance to allow content refresh
let currentPopupInstance = null;

function getCharacterNameForSettings() {
    // Primary: Use name2 variable from script.js
    let rawCharacterName = name2;
    let source = 'name2';

    // Fallback: Use chat_metadata.character_name if name2 is not available
    if (!rawCharacterName || rawCharacterName === systemUserName || rawCharacterName === neutralCharacterName) {
        rawCharacterName = getCharacterNameFromChatMetadata();
        source = 'chat_metadata';

        if (!rawCharacterName) {
            console.warn('STMTL: No character name available in name2 or chat_metadata');
            return null;
        }
    }

    let characterName = String(rawCharacterName).trim();

    // Normalize unicode characters to handle special characters consistently
    if (characterName.normalize) {
        characterName = characterName.normalize('NFC');
    }

    console.log(`STMTL: Raw character name from ${source}:`, rawCharacterName);
    console.log('STMTL: Normalized character name:', characterName);

    return characterName;
}

/**
 * Get the current active character name in a group chat (from last message or selected character)
 */
function getCurrentActiveCharacterInGroup() {
    try {
        // Try to get the character name from the most recent non-user message
        if (window.chat && window.chat.length > 0) {
            for (let i = window.chat.length - 1; i >= 0; i--) {
                const message = window.chat[i];
                if (message && !message.is_user && message.name) {
                    return message.name;
                }
            }
        }

        // Fallback: use the currently selected character if available
        if (selected_group && groups) {
            const group = groups.find(x => x.id === selected_group);
            if (group && group.members && group.members.length > 0) {
                // Return the first member as a fallback
                return group.members[0];
            }
        }

        return null;
    } catch (error) {
        console.warn('STMTL: Error getting active character in group:', error);
        return null;
    }
}

/**
 * Safe set function using direct object access to handle special characters in names
 */
function safeSetCharacterSettings(characterName, settings) {
    const extensionSettings = getExtensionSettings();

    if (!characterName) {
        console.warn('STMTL: Cannot save settings - invalid character name');
        return false;
    }

    // Normalize the character name before using as key
    let normalizedName = String(characterName).trim();
    if (normalizedName.normalize) {
        normalizedName = normalizedName.normalize('NFC');
    }

    // Use direct object assignment to handle special characters properly
    if (!extensionSettings.characterSettings) {
        extensionSettings.characterSettings = {};
    }

    extensionSettings.characterSettings[normalizedName] = settings;
    console.log(`STMTL: Saved character settings for normalized name "${normalizedName}"`);
    console.log('STMTL: Settings saved:', settings);
    return true;
}

function safeSetGroupSettings(groupId, settings) {
    const extensionSettings = getExtensionSettings();
    
    if (!groupId) {
        console.warn('STMTL: Cannot save group settings - invalid group ID');
        return false;
    }

    if (!extensionSettings.groupSettings) {
        extensionSettings.groupSettings = {};
    }

    extensionSettings.groupSettings[groupId] = settings;
    console.log(`STMTL: Saved group settings for group ID "${groupId}"`);
    return true;
}

/**
 * Safe get function using direct object access
 */
function safeGetCharacterSettings(characterName) {
    const extensionSettings = getExtensionSettings();

    if (!characterName || !extensionSettings.characterSettings) {
        return null;
    }

    // Normalize the character name before looking it up
    let normalizedName = String(characterName).trim();
    if (normalizedName.normalize) {
        normalizedName = normalizedName.normalize('NFC');
    }

    const settings = extensionSettings.characterSettings[normalizedName];
    if (settings) {
        console.log(`STMTL: Retrieved character settings for normalized name "${normalizedName}"`);
        console.log('STMTL: Settings retrieved:', settings);
    } else {
        console.log(`STMTL: No settings found for normalized name "${normalizedName}"`);
        // Debug: show all available character keys
        const availableKeys = Object.keys(extensionSettings.characterSettings || {});
        console.log('STMTL: Available character keys:', availableKeys);
    }
    return settings || null;
}

function safeGetGroupSettings(groupId) {
    const extensionSettings = getExtensionSettings();
    
    if (!groupId || !extensionSettings.groupSettings) {
        return null;
    }

    const settings = extensionSettings.groupSettings[groupId];
    if (settings) {
        console.log(`STMTL: Retrieved group settings for group ID "${groupId}"`);
    }
    return settings || null;
}

/**
 * Safe delete function using direct object access
 */
function safeDeleteCharacterSettings(characterName) {
    const extensionSettings = getExtensionSettings();

    if (!characterName || !extensionSettings.characterSettings) {
        return false;
    }

    // Normalize the character name before deleting
    let normalizedName = String(characterName).trim();
    if (normalizedName.normalize) {
        normalizedName = normalizedName.normalize('NFC');
    }

    if (extensionSettings.characterSettings[normalizedName]) {
        delete extensionSettings.characterSettings[normalizedName];
        console.log(`STMTL: Deleted character settings for normalized name "${normalizedName}"`);
        return true;
    }

    console.log(`STMTL: No settings to delete for normalized name "${normalizedName}"`);
    return false;
}

function safeDeleteGroupSettings(groupId) {
    const extensionSettings = getExtensionSettings();
    
    if (!groupId || !extensionSettings.groupSettings) {
        return false;
    }

    if (extensionSettings.groupSettings[groupId]) {
        delete extensionSettings.groupSettings[groupId];
        console.log(`STMTL: Deleted group settings for group ID "${groupId}"`);
        return true;
    }

    return false;
}

// Enhanced debounced function with logging
const debouncedModelSettingsChanged = lodash.debounce(function() {
    console.log('STMTL: Debounced save triggered');
    onModelSettingsChanged();
}, SAVE_DEBOUNCE_TIME);

// Handlebars templates for better HTML generation
const popupTemplate = Handlebars.compile(`
<div class="completion_prompt_manager_popup_entry">
    <div class="completion_prompt_manager_error {{#unless isExtensionEnabled}}caution{{/unless}}">
        <span>API Status: <strong>{{statusText}}</strong></span>
    </div>

    <div class="completion_prompt_manager_popup_entry_form_control">
        {{#each checkboxes}}
        <label class="checkbox_label">
            <input type="checkbox" id="{{id}}" {{#if checked}}checked{{/if}} {{#unless ../isExtensionEnabled}}{{#if requiresApi}}disabled{{/if}}{{/unless}}>
            <span>{{label}}</span>
        </label>
        {{/each}}
    </div>

    <div class="completion_prompt_manager_popup_entry_form_control">
        <h4>Current {{groupOrCharLabel}} Settings:</h4>
        <div class="info_block" style="background: #2a2a2a; border-radius: 5px; margin-top: 10px;">
            <pre style="margin: 0; white-space: pre-line;">{{characterInfo}}</pre>
        </div>

        {{#if isGroupChat}}
        <h4>Current Individual Character Settings:</h4>
        <div class="info_block" style="background: #2a2a2a; border-radius: 5px; margin-top: 10px;">
            <pre style="margin: 0; white-space: pre-line;">{{individualCharacterInfo}}</pre>
        </div>
        {{/if}}

        <h4>Current Chat Settings:</h4>
        <div class="info_block" style="background: #2a2a2a; border-radius: 5px; margin-top: 10px;">
            <pre style="margin: 0; white-space: pre-line;">{{chatInfo}}</pre>
        </div>
    </div>
</div>
`);

/**
 * Get extension settings from SillyTavern's settings system
 */
function getExtensionSettings() {
    if (!extension_settings.STMTL) {
        extension_settings.STMTL = lodash.cloneDeep(defaultSettings);
        console.log('STMTL: Created new settings with defaults');
    }
    return extension_settings.STMTL;
}

/**
 * Get current context - leverages ST's context but augments with extension-specific needs
 */
function getCurrentExtensionContext() {
    try {
        // Get base context from SillyTavern's context system
        const baseContext = getContext();

        let characterName = null;
        let chatId = null;
        let chatName = null;

        // EXPLICIT GROUP DETECTION
        const isGroupChat = !!selected_group;
        const groupId = selected_group || null;
        let groupName = null;

        if (isGroupChat) {
            console.log('STMTL: Group chat detected, groupId:', groupId);
            // Group chat context
            const group = groups?.find(x => x.id === groupId);
            if (group) {
                groupName = group.name;
                chatId = group.chat_id;
                chatName = chatId;
                // For group chats, use the group name as the "character" identifier
                characterName = groupName;
            }
        } else {
            console.log('STMTL: Single character chat detected');
            // Single character chat context
            characterName = getCharacterNameForSettings();

            // Get chat information from base context or fallback methods
            if (baseContext?.chatId) {
                chatId = baseContext.chatId;
                chatName = chatId;
            } else if (typeof window.getCurrentChatId === 'function') {
                chatId = window.getCurrentChatId();
                chatName = chatId;
            }
        }

        const result = {
            characterName,
            chatId,
            groupId: groupId,
            chatName,
            isGroupChat: isGroupChat
        };

        // Add properties for group support
        if (isGroupChat) {
            result.groupName = groupName;
            result.activeCharacterInGroup = getCurrentActiveCharacterInGroup();
        }

        console.log('STMTL: Enhanced context resolved:', result);
        return result;

    } catch (e) {
        console.warn('STMTL: Error getting context:', e);
        return {
            characterName: null,
            chatId: null,
            groupId: null,
            chatName: null,
            isGroupChat: false
        };
    }
}

/**
 * Check API compatibility using SillyTavern's built-in functions
 */
function checkApiCompatibility() {
    let isCompatible = false;

    try {
        if (typeof window.getGeneratingApi === 'function') {
            const currentApi = window.getGeneratingApi();
            isCompatible = window.main_api === 'openai' && lodash.includes(SUPPORTED_COMPLETION_SOURCES, currentApi);
        } else {
            const mainApi = $(SELECTORS.mainApi).val();
            const completionSource = $(SELECTORS.completionSource).val();
            isCompatible = mainApi === 'openai' && lodash.includes(SUPPORTED_COMPLETION_SOURCES, completionSource);
        }
    } catch (e) {
        console.warn('STMTL: Error checking API compatibility:', e);
        const mainApi = $(SELECTORS.mainApi).val();
        const completionSource = $(SELECTORS.completionSource).val();
        isCompatible = mainApi === 'openai' && lodash.includes(SUPPORTED_COMPLETION_SOURCES, completionSource);
    }

    if (isCompatible !== isExtensionEnabled) {
        isExtensionEnabled = isCompatible;

        const extensionSettings = getExtensionSettings();
        if (extensionSettings.moduleSettings.showOtherNotifications) {
            if (isCompatible) {
                toastr.info('STMTL extension enabled for Chat Completion API', 'STMTL');
            } else {
                toastr.warning('STMTL requires Chat Completion API', 'STMTL');
            }
        }
    }

    return isCompatible;
}

/**
 * Get current API and model information using SillyTavern's functions
 */
function getCurrentApiInfo() {
    try {
        let api = 'unknown';
        let model = 'unknown';
        let completionSource = 'unknown';

        if (typeof window.getGeneratingApi === 'function') {
            api = window.getGeneratingApi();
        } else {
            api = $(SELECTORS.mainApi).val() || 'unknown';
        }

        if (typeof window.getGeneratingModel === 'function') {
            model = window.getGeneratingModel();
        }

        completionSource = $(SELECTORS.completionSource).val() || api;

        return { api, model, completionSource };
    } catch (e) {
        console.warn('STMTL: Error getting API info:', e);
        return {
            api: $(SELECTORS.mainApi).val() || 'unknown',
            model: 'unknown',
            completionSource: $(SELECTORS.completionSource).val() || 'unknown'
        };
    }
}

/**
 * Format settings info using moment.js for better date formatting
 */
function formatSettingsInfo(settings) {
    if (!settings) {
        return isExtensionEnabled ? 'No saved settings' : 'Requires Chat Completion API';
    }

    const formattedDate = moment(settings.savedAt).format('MMM D, YYYY [at] h:mm A');
    return `Model: ${settings.model || 'N/A'}
Temp: ${settings.temperature || 'N/A'}
Source: ${settings.completionSource || 'N/A'}
Saved: ${formattedDate}`;
}

/**
 * Injects CSS to fix popup button wrapping on mobile.
 */
function addPopupWrapStyle() {
    // Prevents adding the style more than once
    if (document.getElementById('stmtl-popup-fix')) return;

    const css = `
        .popup-controls {
            flex-wrap: wrap !important;
            justify-content: center !important;
        }
    `;
    const style = document.createElement('style');
    style.id = 'stmtl-popup-fix';
    style.textContent = css;
    document.head.appendChild(style);
}

/**
 * Generate popup HTML content using Handlebars template - FIXED GROUP DETECTION
 */
function getPopupContent() {
    const settings = getExtensionSettings();
    const apiInfo = getCurrentApiInfo();
    
    // EXPLICIT GROUP DETECTION
    const isGroupChat = !!selected_group;
    
    console.log('STMTL: getPopupContent - isGroupChat:', isGroupChat);

    if (isGroupChat) {
        // --- GROUP CHAT PATH ---
        const statusText = isExtensionEnabled
            ? `Active (${apiInfo.completionSource}) - Group Chat`
            : `Requires Chat Completion API (current: ${apiInfo.api}) - Group Chat`;

        const templateData = {
            isExtensionEnabled,
            statusText,
            isGroupChat: true,
            groupOrCharLabel: 'Group',
            characterInfo: formatSettingsInfo(currentGroupSettings),
            individualCharacterInfo: formatSettingsInfo(currentIndividualCharacterSettings),
            chatInfo: formatSettingsInfo(currentChatSettings),
            checkboxes: [
                {
                    id: 'stmtl-enable-character',
                    label: 'Remember per group',
                    checked: settings.moduleSettings.enableGroupMemory,
                    requiresApi: true
                },
                {
                    id: 'stmtl-enable-chat',
                    label: 'Remember per chat',
                    checked: settings.moduleSettings.enableChatMemory,
                    requiresApi: true
                },
                {
                    id: 'stmtl-prefer-group-over-chat',
                    label: 'Prefer group settings over chat',
                    checked: settings.moduleSettings.preferGroupOverChat,
                    requiresApi: true
                },
                {
                    id: 'stmtl-prefer-individual-character',
                    label: 'Prefer individual character settings',
                    checked: settings.moduleSettings.preferIndividualCharacterInGroup,
                    requiresApi: true
                },
                {
                    id: 'stmtl-auto-save-character',
                    label: 'Auto-save group settings',
                    checked: settings.moduleSettings.autoSaveGroup,
                    requiresApi: true
                },
                {
                    id: 'stmtl-auto-save-chat',
                    label: 'Auto-save chat settings',
                    checked: settings.moduleSettings.autoSaveChat,
                    requiresApi: true
                },
                {
                    id: 'stmtl-show-autosave-notifications',
                    label: 'Show auto-save notifications',
                    checked: settings.moduleSettings.showAutoSaveNotifications,
                    requiresApi: false
                },
                {
                    id: 'stmtl-show-other-notifications',
                    label: 'Show other notifications',
                    checked: settings.moduleSettings.showOtherNotifications,
                    requiresApi: false
                }
            ]
        };

        return DOMPurify.sanitize(popupTemplate(templateData));

    } else {
        // --- SINGLE CHARACTER PATH ---
        const statusText = isExtensionEnabled
            ? `Active (${apiInfo.completionSource})`
            : `Requires Chat Completion API (current: ${apiInfo.api})`;

        const templateData = {
            isExtensionEnabled,
            statusText,
            isGroupChat: false,
            groupOrCharLabel: 'Character',
            characterInfo: formatSettingsInfo(currentCharacterSettings),
            chatInfo: formatSettingsInfo(currentChatSettings),
            checkboxes: [
                {
                    id: 'stmtl-enable-character',
                    label: 'Remember per character',
                    checked: settings.moduleSettings.enableCharacterMemory,
                    requiresApi: true
                },
                {
                    id: 'stmtl-enable-chat',
                    label: 'Remember per chat',
                    checked: settings.moduleSettings.enableChatMemory,
                    requiresApi: true
                },
                {
                    id: 'stmtl-prefer-character',
                    label: 'Prefer character settings over chat',
                    checked: settings.moduleSettings.preferCharacterOverChat,
                    requiresApi: true
                },
                {
                    id: 'stmtl-auto-save-character',
                    label: 'Auto-save character settings',
                    checked: settings.moduleSettings.autoSaveCharacter,
                    requiresApi: true
                },
                {
                    id: 'stmtl-auto-save-chat',
                    label: 'Auto-save chat settings',
                    checked: settings.moduleSettings.autoSaveChat,
                    requiresApi: true
                },
                {
                    id: 'stmtl-show-autosave-notifications',
                    label: 'Show auto-save notifications',
                    checked: settings.moduleSettings.showAutoSaveNotifications,
                    requiresApi: false
                },
                {
                    id: 'stmtl-show-other-notifications',
                    label: 'Show other notifications',
                    checked: settings.moduleSettings.showOtherNotifications,
                    requiresApi: false
                }
            ]
        };

        return DOMPurify.sanitize(popupTemplate(templateData));
    }
}

/**
 * Refreshes the content of the currently open popup without closing it
 */
function refreshPopupContent() {
    if (!currentPopupInstance || !currentPopupInstance.dlg.hasAttribute('open')) {
        console.warn('STMTL: Cannot refresh popup - no popup currently open');
        return;
    }

    try {
        const content = getPopupContent();
        const header = '🌡️ Model & Temperature Settings';
        const newContent = `<h3>${header}</h3>${content}`;

        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = newContent;

        morphdom(currentPopupInstance.content, tempContainer);

        console.log('STMTL: Popup content refreshed - UI now reflects current data state');
    } catch (error) {
        console.error('STMTL: Error refreshing popup content:', error);
        currentPopupInstance.completeCancelled();
        setTimeout(() => showPopup(), 100);
    }
}

/**
 * Create UI elements using SillyTavern's existing styles
 */
function createUI() {
    const menuItem = $(`
        <div id="stmtl-menu-item-container" class="extension_container interactable" tabindex="0">
            <div id="stmtl-menu-item" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
                <div class="fa-fw fa-solid fa-temperature-half extensionsMenuExtensionButton"></div>
                <span>Model/Temp Settings</span>
            </div>
        </div>
    `);

    $('#extensionsMenu').append(menuItem);
}

/**
 * Show the popup using ST's popup system with proper button handling
 */
async function showPopup() {
    const content = getPopupContent();
    const header = '🌡️ Model & Temperature Settings';
    const contentWithHeader = `<h3>${header}</h3>${content}`;
    const isGroupChat = !!selected_group;

    const customButtons = [
        {
            // Use a ternary operator to set the text
            text: isGroupChat ? '✔️ Set Group' : '✔️ Set Character',
            classes: ['menu_button'],
            action: async () => {
                await saveCurrentSettings(true, false, false);
                refreshPopupContent();
            }
        },
        {
            text: '✔️ Set Chat',
            classes: ['menu_button'],
            action: async () => {
                await saveCurrentSettings(false, true, false);
                refreshPopupContent();
            }
        },
        {
            text: isGroupChat ? '✔️ Set All' : '✔️ Set Both',
            classes: ['menu_button'],
            action: async () => {
                await saveCurrentSettings(true, true, false);

                // Add save character settings when in group chat.
                if (isGroupChat) {
                    const context = getCurrentExtensionContext();
                    if (context.activeCharacterInGroup) {
                        await saveCurrentSettingsForCharacter(context.activeCharacterInGroup, false);
                    }
                }

                refreshPopupContent();
            }
        },
        {
            text: isGroupChat ? '❌ Clear Group' : '❌ Clear Character',
            classes: ['menu_button'],
            action: async () => {
                await clearCharacterSettings();
                refreshPopupContent();
            }
        },
        {
            text: '❌ Clear Chat',
            classes: ['menu_button'],
            action: async () => {
                await clearChatSettings();
                refreshPopupContent();
            }
        },
        {
            text: '❌ Clear All',
            classes: ['menu_button'],
            action: async () => {
                await clearAllSettings();
                refreshPopupContent();
            }
        }
    ];

if (isGroupChat) {
        // "Set Active Char" button
        const setActiveCharButton = {
            text: '✔️ Set Active Char',
            classes: ['menu_button'],
            action: async () => {
                const context = getCurrentExtensionContext();
                if (context.activeCharacterInGroup) {
                    await saveCurrentSettingsForCharacter(context.activeCharacterInGroup, false);
                    updateCachedSettings(); // Update cache to reflect new settings
                    toastr.success(`Saved settings for active character: ${context.activeCharacterInGroup}`, 'STMTL');
                } else {
                    toastr.warning('No active character detected in the group to save settings for.', 'STMTL');
                }
                refreshPopupContent();
            }
        };
        // Insert "Set Active Char" before "Set Chat"
        customButtons.splice(1, 0, setActiveCharButton);

        // "Clear Active Char" button
        const clearActiveCharButton = {
            text: '❌ Clear Active Char',
            classes: ['menu_button'],
            action: async () => {
                const context = getCurrentExtensionContext();
                if (context.activeCharacterInGroup) {
                    if (safeDeleteCharacterSettings(context.activeCharacterInGroup)) {
                        saveSettingsDebounced();
                        updateCachedSettings();
                        toastr.info(`Cleared individual settings for ${context.activeCharacterInGroup}`, 'STMTL');
                    }
                } else {
                    toastr.warning('No active character detected to clear settings for.', 'STMTL');
                }
                refreshPopupContent();
            }
        };
        // insert "Clear Active Char" before "Clear Chat"
        customButtons.splice(5, 0, clearActiveCharButton);
    }

    const popupOptions = {
        wide: true,
        customButtons: customButtons,
        cancelButton: 'Close',
        okButton: false,
        onClose: handlePopupClose
    };

    try {
        currentPopupInstance = new Popup(contentWithHeader, POPUP_TYPE.TEXT, '', popupOptions);
        await currentPopupInstance.show();
        currentPopupInstance = null;
    } catch (error) {
        console.error('STMTL: Error showing popup:', error);
        currentPopupInstance = null;
    }
}

/**
 * Handle popup close event to save settings properly
 */
function handlePopupClose(popup) {
    try {
        const popupElement = popup.dlg;
        const settings = getExtensionSettings();
        const isGroupChat = !!selected_group;
        
        console.log('STMTL: handlePopupClose - isGroupChat:', isGroupChat);

        let checkboxMappings = {};

        if (isGroupChat) {
            // --- GROUP CHAT CHECKBOX MAPPINGS ---
            checkboxMappings = {
                'stmtl-enable-character': 'enableGroupMemory',
                'stmtl-enable-chat': 'enableChatMemory',
                'stmtl-prefer-group-over-chat': 'preferGroupOverChat',
                'stmtl-prefer-individual-character': 'preferIndividualCharacterInGroup',
                'stmtl-auto-save-character': 'autoSaveGroup',
                'stmtl-auto-save-chat': 'autoSaveChat',
                'stmtl-show-autosave-notifications': 'showAutoSaveNotifications',
                'stmtl-show-other-notifications': 'showOtherNotifications'
            };
        } else {
            // --- SINGLE CHARACTER CHECKBOX MAPPINGS ---
            checkboxMappings = {
                'stmtl-enable-character': 'enableCharacterMemory',
                'stmtl-enable-chat': 'enableChatMemory',
                'stmtl-prefer-character': 'preferCharacterOverChat',
                'stmtl-auto-save-character': 'autoSaveCharacter',
                'stmtl-auto-save-chat': 'autoSaveChat',
                'stmtl-show-autosave-notifications': 'showAutoSaveNotifications',
                'stmtl-show-other-notifications': 'showOtherNotifications'
            };
        }

        const newValues = lodash.mapValues(checkboxMappings, (settingKey, checkboxId) => {
            return popupElement.querySelector(`#${checkboxId}`)?.checked ?? settings.moduleSettings[settingKey];
        });

        const oldValues = lodash.pick(settings.moduleSettings, lodash.values(checkboxMappings));
        const valuesMap = lodash.invert(checkboxMappings);
        const newValuesForComparison = lodash.mapKeys(newValues, (value, key) => valuesMap[key]);

        const changed = !lodash.isEqual(oldValues, newValuesForComparison);

        if (changed) {
            lodash.merge(settings.moduleSettings, lodash.mapKeys(newValues, (value, key) => checkboxMappings[key]));
            saveSettingsDebounced();
            console.log('STMTL: Settings updated from popup');
        }
    } catch (error) {
        console.error('STMTL: Error handling popup close:', error);
    }
}

/**
 * Helper functions for safely accessing and modifying chat metadata
 */

function getCurrentChatMetadata() {
    try {
        // Try multiple sources for chat metadata
        if (typeof window.chat_metadata !== 'undefined' && window.chat_metadata !== null) {
            return window.chat_metadata;
        }

        // Fallback: try to get from global scope without window
        if (typeof chat_metadata !== 'undefined' && chat_metadata !== null) {
            return chat_metadata;
        }

        // Additional fallback: check if there's a function to get current chat metadata
        if (typeof window.getCurrentChatMetadata === 'function') {
            return window.getCurrentChatMetadata();
        }

        console.warn('STMTL: chat_metadata not available from any known source');
        return null;
    } catch (error) {
        console.warn('STMTL: Error accessing chat metadata:', error);
        return null;
    }
}

function getChatMetadataProperty(key) {
    const metadata = getCurrentChatMetadata();
    if (!metadata || !key) {
        return null;
    }

    try {
        return metadata[key] || null;
    } catch (error) {
        console.warn(`STMTL: Error getting chat metadata property '${key}':`, error);
        return null;
    }
}

function setChatMetadataProperty(key, value) {
    if (!key) {
        console.warn('STMTL: Cannot set chat metadata property - invalid key');
        return false;
    }

    try {
        // Try to get existing metadata
        let metadata = getCurrentChatMetadata();
        
        // If no metadata exists, try to create it
        if (!metadata) {
            // Try to initialize window.chat_metadata
            if (typeof window !== 'undefined') {
                window.chat_metadata = {};
                metadata = window.chat_metadata;
            } else {
                // Fallback: try global scope
                if (typeof global !== 'undefined') {
                    global.chat_metadata = {};
                    metadata = global.chat_metadata;
                } else {
                    console.warn('STMTL: Cannot create chat metadata - no global scope available');
                    return false;
                }
            }
        }

        metadata[key] = value;
        console.log(`STMTL: Set chat metadata property '${key}':`, value);
        return true;
    } catch (error) {
        console.error(`STMTL: Error setting chat metadata property '${key}':`, error);
        return false;
    }
}

function deleteChatMetadataProperty(key) {
    if (!key) {
        console.warn('STMTL: Cannot delete chat metadata property - invalid key');
        return false;
    }

    try {
        const metadata = getCurrentChatMetadata();
        if (!metadata) {
            console.log(`STMTL: No chat metadata to delete property '${key}' from`);
            return true; // Consider this success since the property effectively doesn't exist
        }

        if (metadata.hasOwnProperty(key)) {
            delete metadata[key];
            console.log(`STMTL: Deleted chat metadata property '${key}'`);
        } else {
            console.log(`STMTL: Chat metadata property '${key}' did not exist`);
        }
        return true;
    } catch (error) {
        console.error(`STMTL: Error deleting chat metadata property '${key}':`, error);
        return false;
    }
}

function isChatMetadataAvailable() {
    return getCurrentChatMetadata() !== null;
}

function getCharacterNameFromChatMetadata() {
    try {
        const characterName = getChatMetadataProperty('character_name');
        if (characterName && typeof characterName === 'string') {
            return characterName.trim();
        }
        return null;
    } catch (error) {
        console.warn('STMTL: Error getting character name from chat metadata:', error);
        return null;
    }
}

/**
 * Event listener setup with auto-save during specific generation events
 */
function setupEventListeners() {
    $(document).on('click', SELECTORS.menuItem, function() {
        showPopup();
    });

    // SillyTavern event handlers
    function registerSillyTavernEvents() {
        try {
            if (!eventSource || !event_types) {
                console.warn('STMTL: eventSource or event_types not available, retrying...');
                setTimeout(registerSillyTavernEvents, 1000);
                return;
            }

            console.log('STMTL: Setting up event listeners');

            // Character and chat change events
            eventSource.on(event_types.CHARACTER_SELECTED, onCharacterChanged);
            eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
            eventSource.on(event_types.GROUP_CHAT_CREATED, onGroupChatCreated);
            
            eventSource.on(event_types.CHAT_LOADED, () => {
                console.log('STMTL: Chat loaded event');
                setTimeout(() => {
                    updateCachedSettings();
                }, 500);
            });

            const setupAutoSaveEvent = (eventType, eventName) => {
                if (eventType) {
                    eventSource.on(eventType, () => {
                        const extensionSettings = getExtensionSettings();
                        const isGroupChat = !!selected_group;
                        
                        let isAutoSaveActive = false;
                        if (isGroupChat) {
                            isAutoSaveActive = extensionSettings.moduleSettings.autoSaveGroup || extensionSettings.moduleSettings.autoSaveChat;
                        } else {
                            isAutoSaveActive = extensionSettings.moduleSettings.autoSaveCharacter || extensionSettings.moduleSettings.autoSaveChat;
                        }

                        // Only enforce stored settings on generation if an auto-save option is enabled.
                        if (isAutoSaveActive) {
                            console.log(`STMTL: ${eventName} - Auto-save is active, applying stored settings.`);
                            updateCachedSettings();
                            applySettings();
                        }

                        // trigger a save if settings are changed in the UI
                        if (isAutoSaveActive && isExtensionEnabled) {
                            console.log(`STMTL: ${eventName} - Checking for changes to auto-save.`);
                            debouncedModelSettingsChanged();
                        }
                    });
                }
            };

            // Set up auto-save for simple generation events
            setupAutoSaveEvent(event_types.GENERATION_STARTED, 'GENERATION_STARTED');
            setupAutoSaveEvent(event_types.CHAT_COMPLETION_PROMPT_READY, 'CHAT_COMPLETION_PROMPT_READY');

            eventSource.on(event_types.MESSAGE_RECEIVED, (message) => {
                // This event provides the message object, which contains the speaker's name
                if (message && !message.is_user) {
                    const speakerName = message.name;
                    const extensionSettings = getExtensionSettings();

                    // Check if autosave for the speaking character should happen
                    if (extensionSettings.moduleSettings.autoSaveCharacter && isExtensionEnabled) {
                        console.log(`STMTL: Auto-saving settings for speaker: ${speakerName}`);
                        saveCurrentSettingsForCharacter(speakerName, true); 
                    }
                }
            });

            console.log('STMTL: Event listeners registered successfully');
        } catch (e) {
            console.warn('STMTL: Could not bind to SillyTavern events:', e);
            setTimeout(registerSillyTavernEvents, 2000);
        }
    }

    registerSillyTavernEvents();

    $(document).on('change', `${SELECTORS.mainApi}, ${SELECTORS.completionSource}`, function() {
        console.log('STMTL: API change detected');
        checkApiCompatibility();
        if (isExtensionEnabled) {
            setTimeout(() => {
                onCharacterChanged();
            }, 100);
        }
    });

    const modelSelectors = lodash.values(lodash.pick(SELECTORS, [
        'modelOpenai', 'modelClaude', 'modelWindowai', 'modelOpenrouter', 'modelAi21',
        'modelScale', 'modelGoogle', 'modelMistralai', 'customModelId', 'modelCustomSelect',
        'modelCohere', 'modelPerplexity', 'modelGroq', 'model01ai', 'modelNanogpt', 'modelDeepseek',
        'modelBlockentropy', 'tempOpenai', 'tempCounterOpenai'
    ])).join(', ');

    $(document).on('change input', modelSelectors, function(e) {
        console.log('STMTL: Model/temp setting changed:', e.target.id);
        debouncedModelSettingsChanged();
    });
}

function getApiSelectors() {
    const completionSource = $(SELECTORS.completionSource).val();

    const modelSelectorMap = {
        'openai': SELECTORS.modelOpenai,
        'claude': SELECTORS.modelClaude,
        'windowai': SELECTORS.modelWindowai,
        'openrouter': SELECTORS.modelOpenrouter,
        'ai21': SELECTORS.modelAi21,
        'scale': SELECTORS.modelScale,
        'makersuite': SELECTORS.modelGoogle,
        'mistralai': SELECTORS.modelMistralai,
        'custom': SELECTORS.customModelId,
        'cohere': SELECTORS.modelCohere,
        'perplexity': SELECTORS.modelPerplexity,
        'groq': SELECTORS.modelGroq,
        '01ai': SELECTORS.model01ai,
        'nanogpt': SELECTORS.modelNanogpt,
        'deepseek': SELECTORS.modelDeepseek,
        'blockentropy': SELECTORS.modelBlockentropy
    };

    return {
        model: modelSelectorMap[completionSource] || SELECTORS.modelOpenai,
        temp: SELECTORS.tempOpenai,
        tempCounter: SELECTORS.tempCounterOpenai
    };
}

/**
 * Saves current settings specifically for a given character name.
 */
async function saveCurrentSettingsForCharacter(characterName, isAutoSave = false) {
    if (!isExtensionEnabled) return;

    const apiInfo = getCurrentApiInfo();
    const selectors = getApiSelectors();
    let currentModel = $(selectors.model).val() || '';
    const currentTemp = parseFloat($(selectors.temp).val() || $(selectors.tempCounter).val() || 0.7);

    const settingsData = {
        model: currentModel,
        temperature: currentTemp,
        completionSource: apiInfo.completionSource,
        savedAt: moment().toISOString()
    };

    // Use the existing safe function to save settings for the character by name
    if (safeSetCharacterSettings(characterName, settingsData)) {
        saveSettingsDebounced(); // Save all extension settings

        const showNotification = (isAutoSave && getExtensionSettings().moduleSettings.showAutoSaveNotifications) ||
                                 (!isAutoSave && getExtensionSettings().moduleSettings.showOtherNotifications);
        if (showNotification) {
            toastr.success(`Saved settings for character: ${characterName}`, 'STMTL');
        }
    }
}

/**
 * Handle character change - FIXED GROUP DETECTION
 */
function onCharacterChanged() {
    const extensionSettings = getExtensionSettings();
    
    // EXPLICIT GROUP DETECTION
    const isGroupChat = !!selected_group;
    
    console.log('STMTL: onCharacterChanged - isGroupChat:', isGroupChat);

    if (isGroupChat) {
        // --- GROUP CHAT PATH ---
        if (!isExtensionEnabled || (!extensionSettings.moduleSettings.enableGroupMemory && !extensionSettings.moduleSettings.enableChatMemory)) {
            console.log('STMTL: Character change ignored - extension disabled or no group memory features enabled');
            return;
        }
    } else {
        // --- SINGLE CHARACTER PATH ---
        if (!isExtensionEnabled || (!extensionSettings.moduleSettings.enableCharacterMemory && !extensionSettings.moduleSettings.enableChatMemory)) {
            console.log('STMTL: Character change ignored - extension disabled or no memory features enabled');
            return;
        }

        const context = getCurrentExtensionContext();
        if (!context.characterName) {
            console.log('STMTL: Character change ignored - no character name in context');
            return;
        }

        console.log('STMTL: Character changed to:', context.characterName);
    }

    updateCachedSettings();
    applySettings();

    console.log('STMTL: Character change handling complete');
}

/**
 * Handle chat change - FIXED GROUP DETECTION
 */
function onChatChanged() {
    const extensionSettings = getExtensionSettings();
    
    // EXPLICIT GROUP DETECTION
    const isGroupChat = !!selected_group;
    
    console.log('STMTL: onChatChanged - isGroupChat:', isGroupChat);

    if (!isExtensionEnabled || !extensionSettings.moduleSettings.enableChatMemory) return;

    updateCachedSettings();
    applySettings();
}

function onGroupChatCreated() {
    console.log('STMTL: Group chat created event');
    setTimeout(() => {
        updateCachedSettings();
        applySettings();
    }, 500);
}

/**
 * Handle model settings change - FIXED GROUP DETECTION
 */
function onModelSettingsChanged() {
    console.log('STMTL: onModelSettingsChanged() called');

    const extensionSettings = getExtensionSettings();
    
    // EXPLICIT GROUP DETECTION
    const isGroupChat = !!selected_group;
    
    console.log('STMTL: onModelSettingsChanged - isGroupChat:', isGroupChat);
    console.log('STMTL: Extension enabled:', isExtensionEnabled);

    if (!isExtensionEnabled) {
        console.log('STMTL: Skipping save - extension not enabled');
        return;
    }

    let shouldAutoSave = false;

    if (isGroupChat) {
        // --- GROUP CHAT AUTO-SAVE LOGIC ---
        const shouldAutoSaveGroup = extensionSettings.moduleSettings.autoSaveGroup;
        const shouldAutoSaveChat = extensionSettings.moduleSettings.autoSaveChat;
        
        console.log('STMTL: Group auto-save enabled:', shouldAutoSaveGroup);
        console.log('STMTL: Chat auto-save enabled:', shouldAutoSaveChat);
        
        shouldAutoSave = shouldAutoSaveGroup || shouldAutoSaveChat;
        
        if (shouldAutoSave) {
            console.log('STMTL: Proceeding with group auto-save...');
            saveCurrentSettings(shouldAutoSaveGroup, shouldAutoSaveChat, true);
        }
    } else {
        // --- SINGLE CHARACTER AUTO-SAVE LOGIC ---
        const shouldAutoSaveCharacter = extensionSettings.moduleSettings.autoSaveCharacter;
        const shouldAutoSaveChat = extensionSettings.moduleSettings.autoSaveChat;
        
        console.log('STMTL: Character auto-save enabled:', shouldAutoSaveCharacter);
        console.log('STMTL: Chat auto-save enabled:', shouldAutoSaveChat);
        
        shouldAutoSave = shouldAutoSaveCharacter || shouldAutoSaveChat;
        
        if (shouldAutoSave) {
            console.log('STMTL: Proceeding with character auto-save...');
            saveCurrentSettings(shouldAutoSaveCharacter, shouldAutoSaveChat, true);
        }
    }

    if (!shouldAutoSave) {
        console.log('STMTL: Skipping save - all auto-saves disabled');
    }
}

/**
 * Update cached settings
 */
function updateCachedSettings() {
    const extensionSettings = getExtensionSettings();
    const context = getCurrentExtensionContext();

    // Always clear cached settings first to avoid stale data
    currentCharacterSettings = null;
    currentChatSettings = null;
    currentGroupSettings = null;
    currentIndividualCharacterSettings = null;

    // group detection
    const isGroupChat = !!selected_group;
    
    console.log('STMTL: updateCachedSettings - isGroupChat:', isGroupChat);

    if (isGroupChat) {
        // Load group chat settings
        if (extensionSettings.moduleSettings.enableGroupMemory && context.groupId) {
            currentGroupSettings = safeGetGroupSettings(context.groupId);
            console.log(`STMTL: Loaded group settings for group ID "${context.groupId}":`, currentGroupSettings);
        }
        
        // Load individual character settings if either character memory is enabled OR the user explicitly prefers individual character settings in groups.
        const shouldLoadIndividual = extensionSettings.moduleSettings.enableCharacterMemory || extensionSettings.moduleSettings.preferIndividualCharacterInGroup;
        if (shouldLoadIndividual && context.activeCharacterInGroup) {
            currentIndividualCharacterSettings = safeGetCharacterSettings(context.activeCharacterInGroup);
            console.log(`STMTL: Loaded individual character settings for "${context.activeCharacterInGroup}":`, currentIndividualCharacterSettings);
        }
        
        if (extensionSettings.moduleSettings.enableChatMemory && context.chatId) {
            const group = groups?.find(x => x.id === context.groupId);
            if (group?.chat_metadata) {
                currentChatSettings = group.chat_metadata.STMTL || null;
                console.log('STMTL: Loaded group chat settings:', currentChatSettings);
            }
        }
    } else {
        // Load single character settings
        const characterName = getCharacterNameForSettings();

        if (extensionSettings.moduleSettings.enableCharacterMemory && characterName) {
            currentCharacterSettings = safeGetCharacterSettings(characterName);
            console.log(`STMTL: Loaded character settings for "${characterName}":`, currentCharacterSettings);
        } else if (extensionSettings.moduleSettings.enableCharacterMemory) {
            console.log('STMTL: Character memory enabled but no character name found');
        }

        if (extensionSettings.moduleSettings.enableChatMemory && context.chatId && isChatMetadataAvailable()) {
            currentChatSettings = getChatMetadataProperty('STMTL');
            console.log('STMTL: Loaded chat settings:', currentChatSettings);
        } else if (extensionSettings.moduleSettings.enableChatMemory) {
            console.log('STMTL: Chat memory enabled but no chat context available');
        }
    }

    console.log('STMTL: Cached settings updated', {
        characterName: context.characterName,
        activeCharacterInGroup: context.activeCharacterInGroup,
        chatId: context.chatId,
        groupId: context.groupId,
        isGroupChat: isGroupChat,
        hasCharacterSettings: !!currentCharacterSettings,
        hasIndividualCharacterSettings: !!currentIndividualCharacterSettings,
        hasChatSettings: !!currentChatSettings,
        hasGroupSettings: !!currentGroupSettings,
        characterMemoryEnabled: extensionSettings.moduleSettings.enableCharacterMemory,
        chatMemoryEnabled: extensionSettings.moduleSettings.enableChatMemory,
        groupMemoryEnabled: extensionSettings.moduleSettings.enableGroupMemory,
        preferIndividualInGroup: extensionSettings.moduleSettings.preferIndividualCharacterInGroup
    });
}


/**
 * Apply the appropriate settings based on priority
 */
function applySettings() {
    if (!isExtensionEnabled) {
        console.log('STMTL: Settings not applied - extension not enabled');
        return;
    }

    const extensionSettings = getExtensionSettings();
    const isGroupChat = !!selected_group;
    
    console.log('STMTL: applySettings - isGroupChat:', isGroupChat);
    
    let settingsToApply = null;
    let settingsSource = null;

    if (isGroupChat) {
        // --- GROUP CHAT PRIORITY LOGIC ---
        const preferIndividual = extensionSettings.moduleSettings.preferIndividualCharacterInGroup;
        const preferGroupOverChat = extensionSettings.moduleSettings.preferGroupOverChat;
        
        if (preferIndividual && currentIndividualCharacterSettings) {
            // Individual character settings have highest priority when enabled
            settingsToApply = currentIndividualCharacterSettings;
            settingsSource = 'individual character';
        } else if (preferGroupOverChat) {
            // Original group vs chat logic
            if (currentGroupSettings) {
                settingsToApply = currentGroupSettings;
                settingsSource = 'group';
            } else if (currentChatSettings) {
                settingsToApply = currentChatSettings;
                settingsSource = 'group chat (fallback)';
            } else if (currentIndividualCharacterSettings) {
                settingsToApply = currentIndividualCharacterSettings;
                settingsSource = 'individual character (fallback)';
            }
        } else {
            // Chat preferred over group
            if (currentChatSettings) {
                settingsToApply = currentChatSettings;
                settingsSource = 'group chat';
            } else if (currentGroupSettings) {
                settingsToApply = currentGroupSettings;
                settingsSource = 'group (fallback)';
            } else if (currentIndividualCharacterSettings) {
                settingsToApply = currentIndividualCharacterSettings;
                settingsSource = 'individual character (fallback)';
            }
        }
    } else {
        // --- SINGLE CHARACTER PRIORITY LOGIC ---
        if (extensionSettings.moduleSettings.preferCharacterOverChat) {
            if (currentCharacterSettings) {
                settingsToApply = currentCharacterSettings;
                settingsSource = 'character';
            } else if (currentChatSettings) {
                settingsToApply = currentChatSettings;
                settingsSource = 'chat (fallback)';
            }
        } else {
            if (currentChatSettings) {
                settingsToApply = currentChatSettings;
                settingsSource = 'chat';
            } else if (currentCharacterSettings) {
                settingsToApply = currentCharacterSettings;
                settingsSource = 'character (fallback)';
            }
        }
    }

    if (!settingsToApply) {
        console.log('STMTL: No settings to apply for current context');
        if (extensionSettings.moduleSettings.showOtherNotifications) {
            toastr.info('No saved settings for this context. Remember to save your model/temperature preferences!', 'STMTL');
        }
        return;
    }

    console.log(`STMTL: Applying ${settingsSource} settings:`, settingsToApply);

    const selectors = getApiSelectors();
    const apiInfo = getCurrentApiInfo();

    // Check if the saved settings match the current completion source
    if (settingsToApply.completionSource && settingsToApply.completionSource !== apiInfo.completionSource) {
        if (extensionSettings.moduleSettings.showOtherNotifications) {
            toastr.warning(`Saved settings for ${settingsToApply.completionSource}, current source is ${apiInfo.completionSource}`, 'STMTL');
        }
        console.log(`STMTL: Settings not applied - completion source mismatch (saved: ${settingsToApply.completionSource}, current: ${apiInfo.completionSource})`);
        return;
    }

    // Apply model setting - handle both custom fields for custom completion source
    if (settingsToApply.model) {
        if (apiInfo.completionSource === 'custom') {
            if ($(SELECTORS.customModelId).length) {
                const currentCustomId = $(SELECTORS.customModelId).val();
                if (currentCustomId !== settingsToApply.model) {
                    $(SELECTORS.customModelId).val(settingsToApply.model).trigger('change');
                    console.log(`STMTL: Custom model ID changed from ${currentCustomId} to ${settingsToApply.model}`);
                }
            }

            if ($(SELECTORS.modelCustomSelect).length) {
                const currentCustomSelect = $(SELECTORS.modelCustomSelect).val();
                if (currentCustomSelect !== settingsToApply.model) {
                    $(SELECTORS.modelCustomSelect).val(settingsToApply.model).trigger('change');
                    console.log(`STMTL: Custom model select changed from ${currentCustomSelect} to ${settingsToApply.model}`);
                }
            }
        } else {
            if ($(selectors.model).length) {
                const currentModel = $(selectors.model).val();
                if (currentModel !== settingsToApply.model) {
                    $(selectors.model).val(settingsToApply.model).trigger('change');
                    console.log(`STMTL: Model changed from ${currentModel} to ${settingsToApply.model}`);
                }
            }
        }
    }

    // Apply temperature setting
    if (lodash.isNumber(settingsToApply.temperature)) {
        const currentTemp = parseFloat($(selectors.temp).val() || $(selectors.tempCounter).val() || 0);
        if (Math.abs(currentTemp - settingsToApply.temperature) > 0.001) {
            if ($(selectors.temp).length) {
                $(selectors.temp).val(settingsToApply.temperature);
            }
            if ($(selectors.tempCounter).length) {
                $(selectors.tempCounter).val(settingsToApply.temperature);
            }
            console.log(`STMTL: Temperature changed from ${currentTemp} to ${settingsToApply.temperature}`);
        }
    }

    if (extensionSettings.moduleSettings.showOtherNotifications) {
        toastr.info(`Applied ${settingsSource} settings for ${settingsToApply.completionSource}`, 'STMTL');
    }

    console.log(`STMTL: Successfully applied ${settingsSource} settings`);
}

/**
 * Save current model and temperature settings - FIXED GROUP DETECTION
 */
async function saveCurrentSettings(saveCharacter = true, saveChat = true, isAutoSave = false) {
    const extensionSettings = getExtensionSettings();
    const isGroupChat = !!selected_group;
    
    console.log('STMTL: saveCurrentSettings - isGroupChat:', isGroupChat);

    if (!isExtensionEnabled) {
        if (extensionSettings.moduleSettings.showOtherNotifications) {
            toastr.warning('Cannot save settings - STMTL requires Chat Completion API', 'STMTL');
        }
        return;
    }

    const context = getCurrentExtensionContext();
    const selectors = getApiSelectors();
    const apiInfo = getCurrentApiInfo();

    let currentModel = '';

    // Get the current model based on completion source
    if (apiInfo.completionSource === 'custom') {
        currentModel = $(SELECTORS.customModelId).val() || $(SELECTORS.modelCustomSelect).val() || '';
    } else {
        currentModel = $(selectors.model).val() || '';
    }

    const currentTemp = parseFloat($(selectors.temp).val() || $(selectors.tempCounter).val() || 0.7);

    const settingsData = {
        model: currentModel,
        temperature: currentTemp,
        completionSource: apiInfo.completionSource,
        savedAt: moment().toISOString()
    };

    let savedCount = 0;
    const savedTypes = [];

    if (isGroupChat) {
        // --- GROUP CHAT SAVE LOGIC ---
        if (saveCharacter && extensionSettings.moduleSettings.enableGroupMemory && context.groupId) {
            const success = safeSetGroupSettings(context.groupId, settingsData);
            if (success) {
                currentGroupSettings = lodash.cloneDeep(settingsData);
                savedCount++;
                savedTypes.push('group');
                console.log(`STMTL: Saved group settings for group ID "${context.groupId}":`, settingsData);
            }
        }

        if (saveChat && extensionSettings.moduleSettings.enableChatMemory && context.chatId) {
            const group = groups?.find(x => x.id === context.groupId);
            if (group) {
                if (!group.chat_metadata) {
                    group.chat_metadata = {};
                }
                group.chat_metadata.STMTL = settingsData;
                currentChatSettings = lodash.cloneDeep(settingsData);
                savedCount++;
                savedTypes.push('group chat');
                
                console.log('STMTL: Saved group chat settings:', settingsData);
                
                // Trigger group save if the function exists
                if (typeof window.editGroup === 'function') {
                    window.editGroup(context.groupId, false, false);
                }
            }
        }
    } else {
        // --- SINGLE CHARACTER SAVE LOGIC ---
        const characterName = getCharacterNameForSettings();
        if (saveCharacter && extensionSettings.moduleSettings.enableCharacterMemory && characterName) {
            const success = safeSetCharacterSettings(characterName, settingsData);
            if (success) {
                currentCharacterSettings = lodash.cloneDeep(settingsData);
                savedCount++;
                savedTypes.push('character');
                console.log(`STMTL: Saved character settings for "${characterName}":`, settingsData);
            }
        }

        if (saveChat && extensionSettings.moduleSettings.enableChatMemory && context.chatId) {
            const success = setChatMetadataProperty('STMTL', settingsData);
            if (success) {
                currentChatSettings = lodash.cloneDeep(settingsData);
                savedCount++;
                savedTypes.push('chat');

                console.log('STMTL: Saved chat settings:', settingsData);
                triggerMetadataSave();
            }
        }
    }

    if (savedCount > 0) {
        saveSettingsDebounced();

        const showNotification = (isAutoSave && extensionSettings.moduleSettings.showAutoSaveNotifications) ||
                                 (!isAutoSave && extensionSettings.moduleSettings.showOtherNotifications);

        if (showNotification) {
            const typeText = savedTypes.join(' & ');
            const messagePrefix = isAutoSave ? 'Auto-saved' : 'Saved';
            toastr.success(`${messagePrefix} ${typeText} settings for ${apiInfo.completionSource}`, 'STMTL');
        }
    } else {
        if (extensionSettings.moduleSettings.showOtherNotifications) {
            toastr.warning('No settings were saved (features may be disabled)', 'STMTL');
        }
    }
}

/**
 * Clear all settings function
 */
async function clearAllSettings() {
    const extensionSettings = getExtensionSettings();
    const isGroupChat = !!selected_group;
    
    console.log('STMTL: clearAllSettings - isGroupChat:', isGroupChat);
    
    let clearedCount = 0;
    const clearedTypes = [];

    if (isGroupChat) {
        // --- GROUP CHAT CLEAR LOGIC ---
        const context = getCurrentExtensionContext();
        if (context.groupId) {
            const success = safeDeleteGroupSettings(context.groupId);
            if (success) {
                currentGroupSettings = null;
                clearedCount++;
                clearedTypes.push('group');
            }
        }

        // Clear individual character settings in group chats
        if (context.activeCharacterInGroup) {
            const success = safeDeleteCharacterSettings(context.activeCharacterInGroup);
            if (success) {
                currentIndividualCharacterSettings = null;
                clearedCount++;
                clearedTypes.push('individual character');
            }
        }

        if (context.chatId) {
            const group = groups?.find(x => x.id === context.groupId);
            if (group?.chat_metadata?.STMTL) {
                delete group.chat_metadata.STMTL;
                currentChatSettings = null;
                clearedCount++;
                clearedTypes.push('group chat');
                
                if (typeof window.editGroup === 'function') {
                    window.editGroup(context.groupId, false, false);
                }
            }
        }
    } else {
        // --- SINGLE CHARACTER CLEAR LOGIC ---
        const characterName = getCharacterNameForSettings();
        if (characterName) {
            const success = safeDeleteCharacterSettings(characterName);
            if (success) {
                currentCharacterSettings = null;
                clearedCount++;
                clearedTypes.push('character');
            }
        }

        const context = getCurrentExtensionContext();
        if (context.chatId && getChatMetadataProperty('STMTL')) {
            const success = deleteChatMetadataProperty('STMTL');
            if (success) {
                currentChatSettings = null;
                clearedCount++;
                clearedTypes.push('chat');
                triggerMetadataSave();
            }
        }
    }

    if (clearedCount > 0) {
        saveSettingsDebounced();

        if (extensionSettings.moduleSettings.showOtherNotifications) {
            const typeText = clearedTypes.join(' & ');
            toastr.info(`${typeText} settings cleared`, 'STMTL');
        }
    }

    console.log(`STMTL: Cleared ${clearedCount} setting types: ${clearedTypes.join(', ')}`);
}

/**
 * Clear character-specific settings
 */
async function clearCharacterSettings() {
    const extensionSettings = getExtensionSettings();
    const isGroupChat = !!selected_group;
    
    console.log('STMTL: clearCharacterSettings - isGroupChat:', isGroupChat);

    if (isGroupChat) {
        // --- GROUP CHAT CLEAR LOGIC ---
        const context = getCurrentExtensionContext();
        if (context.groupId) {
            const success = safeDeleteGroupSettings(context.groupId);
            if (success) {
                currentGroupSettings = null;
                console.log(`STMTL: Cleared group settings for group ID "${context.groupId}"`);

                saveSettingsDebounced();

                if (extensionSettings.moduleSettings.showOtherNotifications) {
                    toastr.info(`Group settings cleared for group ID "${context.groupId}"`, 'STMTL');
                }
            }
        }
    } else {
        // --- SINGLE CHARACTER CLEAR LOGIC ---
        const characterName = getCharacterNameForSettings();
        if (!characterName) return;

        const success = safeDeleteCharacterSettings(characterName);
        if (success) {
            currentCharacterSettings = null;
            console.log(`STMTL: Cleared character settings for "${characterName}"`);

            saveSettingsDebounced();

            if (extensionSettings.moduleSettings.showOtherNotifications) {
                toastr.info(`Character settings cleared for ${characterName}`, 'STMTL');
            }
        }
    }
}

/**
 * Clear chat-specific settings from chat metadata
 */
async function clearChatSettings() {
    const extensionSettings = getExtensionSettings();
    const isGroupChat = !!selected_group;
    
    console.log('STMTL: clearChatSettings - isGroupChat:', isGroupChat);
    
    const context = getCurrentExtensionContext();
    if (!context.chatId) return;

    if (isGroupChat) {
        // --- GROUP CHAT CLEAR LOGIC ---
        const group = groups?.find(x => x.id === context.groupId);
        if (group?.chat_metadata?.STMTL) {
            delete group.chat_metadata.STMTL;
            currentChatSettings = null;
            
            if (typeof window.editGroup === 'function') {
                window.editGroup(context.groupId, false, false);
            }

            if (extensionSettings.moduleSettings.showOtherNotifications) {
                toastr.info('Group chat settings cleared', 'STMTL');
            }
        }
    } else {
        // --- SINGLE CHARACTER CLEAR LOGIC ---
        if (getChatMetadataProperty('STMTL')) {
            const success = deleteChatMetadataProperty('STMTL');
            if (success) {
                currentChatSettings = null;
                triggerMetadataSave(); 

                if (extensionSettings.moduleSettings.showOtherNotifications) {
                    toastr.info('Chat settings cleared', 'STMTL');
                }
            }
        }
    }
}

/**
 * Safely trigger metadata save if the function exists
 */
function triggerMetadataSave() {
    try {
        if (typeof saveMetadataDebounced === 'function') {
            saveMetadataDebounced();
        } else if (typeof window.saveMetadataDebounced === 'function') {
            window.saveMetadataDebounced();
        } else {
            console.warn('STMTL: saveMetadataDebounced function not available');
        }
    } catch (error) {
        console.error('STMTL: Error triggering metadata save:', error);
    }
}

/**
 * Migrates old data structures to new format
 */
function migrateOldData() {
    const extensionSettings = getExtensionSettings();

    if (extensionSettings.migrationVersion >= 6) {
        return;
    }
    
    // Migration for notification settings
    if (extensionSettings.moduleSettings.hasOwnProperty('showNotifications')) {
        const oldNotificationSetting = extensionSettings.moduleSettings.showNotifications;
        extensionSettings.moduleSettings.showAutoSaveNotifications = oldNotificationSetting;
        extensionSettings.moduleSettings.showOtherNotifications = oldNotificationSetting;
        delete extensionSettings.moduleSettings.showNotifications;
        console.log('STMTL: Migrated legacy notification setting.');
    }

    console.log('STMTL: Starting data migration...');

    // First run the autosave migration
    migrateAutoSaveSettings();

    // Existing character settings migration code...
    if (extensionSettings.characterSettings && Object.keys(extensionSettings.characterSettings).length > 0) {
        const oldCharacterSettings = { ...extensionSettings.characterSettings };
        const newCharacterSettings = {};
        let migratedCount = 0;

        for (const [characterKey, settings] of Object.entries(oldCharacterSettings)) {
            let characterName = characterKey;

            // Check if this is an escaped key and unescape it
            if (characterKey.includes('\\')) {
                try {
                    characterName = characterKey
                        .replace(/\\\\/g, '\\')
                        .replace(/\\\./g, '.')
                        .replace(/\\\]/g, ']')
                        .replace(/\\\[/g, '[');
                    console.log(`STMTL: Unescaped character key "${characterKey}" to "${characterName}"`);
                } catch (e) {
                    console.warn(`STMTL: Could not unescape key "${characterKey}", using as-is`);
                }
            }

            newCharacterSettings[characterName] = settings;
            migratedCount++;
            console.log(`STMTL: Migrated settings for "${characterName}"`);
        }

        extensionSettings.characterSettings = newCharacterSettings;
        console.log(`STMTL: Migrated ${migratedCount} character settings to direct access format`);
    }

    // Remove old chatSettings from extension settings
    if (extensionSettings.chatSettings) {
        console.log('STMTL: Removing old chatSettings from extension settings (now stored in chat metadata)');
        delete extensionSettings.chatSettings;
    }

    // Migration for group settings
    if (!extensionSettings.moduleSettings.hasOwnProperty('enableGroupMemory')) {
        extensionSettings.moduleSettings.enableGroupMemory = true;
        console.log('STMTL: Added group memory setting.');
    }

    if (!extensionSettings.moduleSettings.hasOwnProperty('preferGroupOverChat')) {
        extensionSettings.moduleSettings.preferGroupOverChat = true;
        console.log('STMTL: Added group preference setting.');
    }

    if (!extensionSettings.moduleSettings.hasOwnProperty('autoSaveGroup')) {
        extensionSettings.moduleSettings.autoSaveGroup = false;
        console.log('STMTL: Added group auto-save setting.');
    }

    if (!extensionSettings.moduleSettings.hasOwnProperty('preferIndividualCharacterInGroup')) {
        extensionSettings.moduleSettings.preferIndividualCharacterInGroup = false;
        console.log('STMTL: Added individual character preference setting for groups.');
    }

    if (!extensionSettings.groupSettings) {
        extensionSettings.groupSettings = {};
        console.log('STMTL: Added group settings storage.');
    }

    extensionSettings.migrationVersion = 6;
    saveSettingsDebounced();

    console.log('STMTL: Data migration completed with individual character preference support');
}

function migrateAutoSaveSettings() {
    const extensionSettings = getExtensionSettings();

    // Check if we need to migrate the old autoSave setting
    if (extensionSettings.moduleSettings.hasOwnProperty('autoSave')) {
        const oldAutoSave = extensionSettings.moduleSettings.autoSave;

        // Set both new settings to the old value if they don't exist
        if (!extensionSettings.moduleSettings.hasOwnProperty('autoSaveCharacter')) {
            extensionSettings.moduleSettings.autoSaveCharacter = oldAutoSave;
        }
        if (!extensionSettings.moduleSettings.hasOwnProperty('autoSaveChat')) {
            extensionSettings.moduleSettings.autoSaveChat = oldAutoSave;
        }

        // Remove the old setting
        delete extensionSettings.moduleSettings.autoSave;

        console.log('STMTL: Migrated autoSave setting to separate character/chat autosave');
        saveSettingsDebounced();
    }
}

// Initialization flag to prevent duplicate calls
let hasInitialized = false;

/**
 * Initialize the extension
 */
async function init() {
    if (hasInitialized) return;
    hasInitialized = true;
    console.log('STMTL: Initializing');

    addPopupWrapStyle();

    // Wait for SillyTavern to be ready
    let attempts = 0;
    const maxAttempts = 20;

    while (attempts < maxAttempts) {
        if ($(SELECTORS.mainApi).length > 0 && eventSource && typeof Popup !== 'undefined') {
            console.log('STMTL: SillyTavern UI and Popup system detected');
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
    }

    // Initialize extension settings
    const settings = getExtensionSettings();
    console.log('STMTL: Settings ready:', lodash.keys(settings));

    // Run data migration if needed
    migrateOldData();

    // Create UI elements
    createUI();

    // Set up event listeners
    setupEventListeners();

    // Check initial API compatibility
    checkApiCompatibility();

    // Initial context detection and settings load
    setTimeout(() => {
        onCharacterChanged();
        console.log('STMTL: Initial context loaded');
    }, 1000);

    console.log('STMTL: Extension loaded successfully');
}

// Initialize when the extension loads
$(document).ready(() => {
    if (eventSource && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, init);
    }

    // Fallback initialization
    setTimeout(init, 1500);

    console.log('STMTL: Ready to initialize');
});