import { eventSource, event_types, saveSettingsDebounced, chat_metadata, name2, systemUserName, neutralCharacterName } from '../../../../script.js';
import { extension_settings, saveMetadataDebounced, getContext } from '../../../extensions.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { lodash, moment, Handlebars, DOMPurify, morphdom } from '../../../../lib.js';

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
let isExtensionEnabled = false;

// Cache for the current popup instance to allow content refresh
let currentPopupInstance = null;

function getCharacterNameForSettings() {
    // Primary: Use name2 variable from script.js
    let rawCharacterName = name2;
    let source = 'name2';

    // Fallback: Use chat_metadata.character_name if name2 is not available
    if (!rawCharacterName || rawCharacterName === systemUserName || rawCharacterName === neutralCharacterName) {
        rawCharacterName = chat_metadata?.character_name;
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
        <h4>Current Character Settings:</h4>
        <div class="info_block" style="background: #2a2a2a; border-radius: 5px; margin-top: 10px;">
            <pre style="margin: 0; white-space: pre-line;">{{characterInfo}}</pre>
        </div>

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

        // Check if we're in a group chat
        const isGroupChat = !!window.selected_group;
        const groupId = window.selected_group || null;
        let groupName = null;

        if (isGroupChat) {
            // Group chat context
            const group = window.groups?.find(x => x.id === groupId);
            if (group) {
                groupName = group.name;
                chatId = group.chat_id;
                chatName = chatId;
                // For group chats, use the group name as the "character" identifier
                characterName = groupName;
            }
        } else {
            // Single character chat context (ORIGINAL LOGIC PRESERVED)
            const rawCharacterName = chat_metadata?.character_name;
            if (rawCharacterName) {
                characterName = String(rawCharacterName).trim();
                // Normalize unicode characters
                if (characterName.normalize) {
                    characterName = characterName.normalize('NFC');
                }
            }

            // Get chat information from base context or fallback methods
            if (baseContext?.chatId) {
                chatId = baseContext.chatId;
                chatName = chatId;
            } else if (typeof window.getCurrentChatId === 'function') {
                chatId = window.getCurrentChatId();
                chatName = chatId;
            }
        }

        // PRESERVE ORIGINAL RETURN STRUCTURE
        const result = {
            characterName,
            chatId,
            groupId: baseContext?.groupId || window.selected_group || null,
            chatName
        };

        // ADD PROPERTIES FOR GROUP SUPPORT
        if (isGroupChat) {
            result.groupName = groupName;
            result.isGroupChat = true;
        }

        console.log('STMTL: Enhanced context resolved:', result);
        return result;

    } catch (e) {
        console.warn('STMTL: Error getting context:', e);
        return {
            characterName: null,
            chatId: null,
            groupId: null,
            chatName: null
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
 * Generate popup HTML content using Handlebars template
 */
function getPopupContent() {
    const settings = getExtensionSettings();
    const apiInfo = getCurrentApiInfo();
    const isGroupChat = !!window.selected_group;

    const statusText = isExtensionEnabled
        ? `Active (${apiInfo.completionSource})${isGroupChat ? ' - Group Chat' : ''}`
        : `Requires Chat Completion API (current: ${apiInfo.api})`;

    const templateData = {
        isExtensionEnabled,
        statusText,
        isGroupChat: isGroupChat,
        characterInfo: isGroupChat ? formatSettingsInfo(currentGroupSettings) : formatSettingsInfo(currentCharacterSettings),
        chatInfo: formatSettingsInfo(currentChatSettings),
        groupInfo: formatSettingsInfo(currentGroupSettings),
        checkboxes: [
            {
                id: 'stmtl-enable-character',
                label: isGroupChat ? 'Remember per group' : 'Remember per character',
                checked: isGroupChat ? settings.moduleSettings.enableGroupMemory : settings.moduleSettings.enableCharacterMemory,
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
                label: isGroupChat ? 'Prefer group settings over chat' : 'Prefer character settings over chat',
                checked: isGroupChat ? settings.moduleSettings.preferGroupOverChat : settings.moduleSettings.preferCharacterOverChat,
                requiresApi: true
            },
            {
                id: 'stmtl-auto-save-character',
                label: isGroupChat ? 'Auto-save group settings' : 'Auto-save character settings',
                checked: isGroupChat ? settings.moduleSettings.autoSaveGroup : settings.moduleSettings.autoSaveCharacter,
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
        const header = '🧠 Model & Temperature Settings';
        const newContent = `<h3>${header}</h3>${content}`;

        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = newContent;

        morphdom(currentPopupInstance.content, tempContainer, {
            onBeforeElUpdated: function(fromEl, toEl) {
                if (fromEl.type === 'checkbox' && toEl.type === 'checkbox') {
                    toEl.checked = fromEl.checked;
                }
                if ((fromEl.type === 'text' || fromEl.tagName === 'TEXTAREA') &&
                    (toEl.type === 'text' || toEl.tagName === 'TEXTAREA')) {
                    toEl.value = fromEl.value;
                }
                return true;
            }
        });

        console.log('STMTL: Popup content refreshed using morphdom');
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

    const customButtons = [
        {
            text: '✔️ Set Character',
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
            text: '✔️ Set Both',
            classes: ['menu_button'],
            action: async () => {
                await saveCurrentSettings(true, true, false);
                refreshPopupContent();
            }
        },
        {
            text: '❌ Clear Character',
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
            text: '❌ Clear Both',
            classes: ['menu_button'],
            action: async () => {
                await clearAllSettings();
                refreshPopupContent();
            }
        }
    ];

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

        const checkboxMappings = {
            'stmtl-enable-character': 'enableCharacterMemory',
            'stmtl-enable-chat': 'enableChatMemory',
            'stmtl-prefer-character': 'preferCharacterOverChat',
            'stmtl-auto-save-character': 'autoSaveCharacter',
            'stmtl-auto-save-chat': 'autoSaveChat',
            'stmtl-show-autosave-notifications': 'showAutoSaveNotifications',
            'stmtl-show-other-notifications': 'showOtherNotifications'
        };

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
 * Event listener setup with proper auto-save event handling
 * Auto-save only happens during specific generation events
 */
function setupEventListeners() {
    // Menu item click handler
    $(document).on('click', SELECTORS.menuItem, function() {
        showPopup();
    });

    // SillyTavern event handlers - only essential events
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

            // Group-specific events
            eventSource.on(event_types.GROUP_SELECTED, onGroupChanged);
            eventSource.on(event_types.GROUP_CHAT_CREATED, onGroupChatCreated);
            
            eventSource.on(event_types.CHAT_LOADED, () => {
                console.log('STMTL: Chat loaded event');
                setTimeout(() => {
                    updateCachedSettings();
                }, 500);
            });

            // Auto-save events - check if either autosave is enabled
            const setupAutoSaveEvent = (eventType, eventName) => {
                if (eventType) {
                    eventSource.on(eventType, () => {
                        console.log(`STMTL: ${eventName} - checking auto-save settings`);
                        const extensionSettings = getExtensionSettings();
                        const shouldAutoSave = extensionSettings.moduleSettings.autoSaveCharacter ||
                                             extensionSettings.moduleSettings.autoSaveChat;

                        if (shouldAutoSave && isExtensionEnabled) {
                            debouncedModelSettingsChanged();
                        }
                    });
                }
            };

            // Set up auto-save for various generation events
            setupAutoSaveEvent(event_types.GENERATION_STARTED, 'GENERATION_STARTED');
            setupAutoSaveEvent(event_types.CHAT_COMPLETION_PROMPT_READY, 'CHAT_COMPLETION_PROMPT_READY');
            setupAutoSaveEvent(event_types.MESSAGE_RECEIVED, 'MESSAGE_RECEIVED');

            console.log('STMTL: Event listeners registered successfully');
        } catch (e) {
            console.warn('STMTL: Could not bind to SillyTavern events:', e);
            setTimeout(registerSillyTavernEvents, 2000);
        }
    }

    registerSillyTavernEvents();

    // API change handlers
    $(document).on('change', `${SELECTORS.mainApi}, ${SELECTORS.completionSource}`, function() {
        console.log('STMTL: API change detected');
        checkApiCompatibility();
        if (isExtensionEnabled) {
            setTimeout(() => {
                onCharacterChanged();
            }, 100);
        }
    });

    // Model settings change handlers using lodash.debounce
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
 * Handle character change
 */
function onCharacterChanged() {
    const extensionSettings = getExtensionSettings();
    if (!isExtensionEnabled || (!extensionSettings.moduleSettings.enableCharacterMemory && !extensionSettings.moduleSettings.enableChatMemory)) {
        console.log('STMTL: Character change ignored - extension disabled or no memory features enabled');
        return;
    }

    const context = getCurrentExtensionContext();
    if (!context.characterName) {
        console.log('STMTL: Character change ignored - no character name in chat_metadata');
        return;
    }

    console.log('STMTL: Character changed to:', context.characterName);

    updateCachedSettings();
    applySettings();

    console.log('STMTL: Character change handling complete');
}

/**
 * Handle chat change
 */
function onChatChanged() {
    const extensionSettings = getExtensionSettings();
    if (!isExtensionEnabled || !extensionSettings.moduleSettings.enableChatMemory) return;

    updateCachedSettings();
    applySettings();
}

function onGroupChanged() {
    console.log('STMTL: Group change event triggered');
    onCharacterChanged(); 
}

function onGroupChatCreated() {
    console.log('STMTL: Group chat created event');
    setTimeout(() => {
        updateCachedSettings();
        applySettings();
    }, 500);
}

/**
 * Handle model settings change
 */
function onModelSettingsChanged() {
    console.log('STMTL: onModelSettingsChanged() called');

    const extensionSettings = getExtensionSettings();
    const isGroupChat = !!window.selected_group;
    
    console.log('STMTL: Group auto-save enabled:', isGroupChat && extensionSettings.moduleSettings.autoSaveGroup);
    console.log('STMTL: Character auto-save enabled:', !isGroupChat && extensionSettings.moduleSettings.autoSaveCharacter);
    console.log('STMTL: Chat auto-save enabled:', extensionSettings.moduleSettings.autoSaveChat);
    console.log('STMTL: Extension enabled:', isExtensionEnabled);

    if (!isExtensionEnabled) {
        console.log('STMTL: Skipping save - extension not enabled');
        return;
    }

    // Check if any autosave is enabled
    const shouldAutoSaveGroup = isGroupChat && extensionSettings.moduleSettings.autoSaveGroup;
    const shouldAutoSaveCharacter = !isGroupChat && extensionSettings.moduleSettings.autoSaveCharacter;
    const shouldAutoSaveChat = extensionSettings.moduleSettings.autoSaveChat;

    if (!shouldAutoSaveGroup && !shouldAutoSaveCharacter && !shouldAutoSaveChat) {
        console.log('STMTL: Skipping save - all auto-saves disabled');
        return;
    }

    console.log('STMTL: Proceeding with auto-save...');

    // Save only what's enabled for autosave, and mark as an auto-save event
    saveCurrentSettings(shouldAutoSaveCharacter || shouldAutoSaveGroup, shouldAutoSaveChat, true);
}

/**
 * Update cached settings using only chat_metadata for character name
 */
function updateCachedSettings() {
    const extensionSettings = getExtensionSettings();
    const context = getCurrentExtensionContext();

    // Always clear cached settings first to avoid stale data
    currentCharacterSettings = null;
    currentChatSettings = null;
    currentGroupSettings = null;

    // Check if we're in a group chat
    const isGroupChat = !!window.selected_group;

    if (isGroupChat) {
        // Group chat
        if (extensionSettings.moduleSettings.enableGroupMemory && context.groupId) {
            currentGroupSettings = safeGetGroupSettings(context.groupId);
            console.log(`STMTL: Loaded group settings for group ID "${context.groupId}":`, currentGroupSettings);
        }
        
        if (extensionSettings.moduleSettings.enableChatMemory && context.chatId) {
            const group = window.groups?.find(x => x.id === context.groupId);
            if (group?.chat_metadata) {
                currentChatSettings = group.chat_metadata.STMTL || null;
                console.log('STMTL: Loaded group chat settings:', currentChatSettings);
            }
        }
    } else {
        // Single character
        const characterName = getCharacterNameForSettings();

        if (extensionSettings.moduleSettings.enableCharacterMemory && characterName) {
            currentCharacterSettings = safeGetCharacterSettings(characterName);
            console.log(`STMTL: Loaded character settings for "${characterName}":`, currentCharacterSettings);
        } else if (extensionSettings.moduleSettings.enableCharacterMemory) {
            console.log('STMTL: Character memory enabled but no character name found');
        }

        if (extensionSettings.moduleSettings.enableChatMemory && context.chatId && chat_metadata) {
            currentChatSettings = chat_metadata.STMTL || null;
            console.log('STMTL: Loaded chat settings:', currentChatSettings);
        } else if (extensionSettings.moduleSettings.enableChatMemory) {
            console.log('STMTL: Chat memory enabled but no chat context available');
        }
    }

    console.log('STMTL: Cached settings updated', {
        characterName: context.characterName,
        chatId: context.chatId,
        groupId: context.groupId,
        isGroupChat: isGroupChat,
        hasCharacterSettings: !!currentCharacterSettings,
        hasChatSettings: !!currentChatSettings,
        hasGroupSettings: !!currentGroupSettings,
        characterMemoryEnabled: extensionSettings.moduleSettings.enableCharacterMemory,
        chatMemoryEnabled: extensionSettings.moduleSettings.enableChatMemory,
        groupMemoryEnabled: extensionSettings.moduleSettings.enableGroupMemory
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
    const isGroupChat = !!window.selected_group;
    let settingsToApply = null;
    let settingsSource = null;

    if (isGroupChat) {
        // Group chat priority logic - NEW
        if (extensionSettings.moduleSettings.preferGroupOverChat) {
            if (currentGroupSettings) {
                settingsToApply = currentGroupSettings;
                settingsSource = 'group';
            } else if (currentChatSettings) {
                settingsToApply = currentChatSettings;
                settingsSource = 'group chat (fallback)';
            }
        } else {
            if (currentChatSettings) {
                settingsToApply = currentChatSettings;
                settingsSource = 'group chat';
            } else if (currentGroupSettings) {
                settingsToApply = currentGroupSettings;
                settingsSource = 'group (fallback)';
            }
        }
    } else {
        // Single character priority logic - ORIGINAL LOGIC PRESERVED
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
 * Save current model and temperature settings - using chat_metadata for character name
 * Settings must save and display properly in the popup
 */
async function saveCurrentSettings(saveCharacter = true, saveChat = true, isAutoSave = false) {
    const extensionSettings = getExtensionSettings();
    const isGroupChat = !!window.selected_group;

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
        // Group chat logic - NEW
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
            const group = window.groups?.find(x => x.id === context.groupId);
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
        // Single character logic - ORIGINAL LOGIC PRESERVED
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
            if (!chat_metadata) {
                window.chat_metadata = {};
            }

            chat_metadata.STMTL = settingsData;
            currentChatSettings = lodash.cloneDeep(settingsData);
            savedCount++;
            savedTypes.push('chat');

            console.log('STMTL: Saved chat settings:', settingsData);
            saveMetadataDebounced();
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
    const isGroupChat = !!window.selected_group;
    let clearedCount = 0;
    const clearedTypes = [];

    if (isGroupChat) {
        // Clear group settings - NEW
        const context = getCurrentExtensionContext();
        if (context.groupId) {
            const success = safeDeleteGroupSettings(context.groupId);
            if (success) {
                currentGroupSettings = null;
                clearedCount++;
                clearedTypes.push('group');
            }
        }

        // Clear group chat settings - NEW
        if (context.chatId) {
            const group = window.groups?.find(x => x.id === context.groupId);
            if (group?.chat_metadata?.STMTL) {
                delete group.chat_metadata.STMTL;
                currentChatSettings = null;
                clearedCount++;
                clearedTypes.push('group chat');
                
                // Trigger group save if the function exists
                if (typeof window.editGroup === 'function') {
                    window.editGroup(context.groupId, false, false);
                }
            }
        }
    } else {
        // Clear character settings - ORIGINAL LOGIC PRESERVED
        const characterName = getCharacterNameForSettings();
        if (characterName) {
            const success = safeDeleteCharacterSettings(characterName);
            if (success) {
                currentCharacterSettings = null;
                clearedCount++;
                clearedTypes.push('character');
            }
        }

        // Clear chat settings - ORIGINAL LOGIC PRESERVED
        const context = getCurrentExtensionContext();
        if (context.chatId && chat_metadata && chat_metadata.STMTL) {
            delete chat_metadata.STMTL;
            currentChatSettings = null;
            clearedCount++;
            clearedTypes.push('chat');
            saveMetadataDebounced();
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
 * Clear character-specific settings - using chat_metadata for character name
 */
async function clearCharacterSettings() {
    const extensionSettings = getExtensionSettings();
    const isGroupChat = !!window.selected_group;

    if (isGroupChat) {
        // Clear group settings - NEW
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
        // Clear character settings - ORIGINAL LOGIC PRESERVED
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
    const isGroupChat = !!window.selected_group;
    const context = getCurrentExtensionContext();
    if (!context.chatId) return;

    if (isGroupChat) {
        // Clear group chat settings - NEW
        const group = window.groups?.find(x => x.id === context.groupId);
        if (group?.chat_metadata?.STMTL) {
            delete group.chat_metadata.STMTL;
            currentChatSettings = null;
            
            // Trigger group save if the function exists
            if (typeof window.editGroup === 'function') {
                window.editGroup(context.groupId, false, false);
            }

            if (extensionSettings.moduleSettings.showOtherNotifications) {
                toastr.info('Group chat settings cleared', 'STMTL');
            }
        }
    } else {
        // Clear single character chat settings - ORIGINAL LOGIC PRESERVED
        if (chat_metadata?.STMTL) {
            delete chat_metadata.STMTL;
            currentChatSettings = null;
            saveMetadataDebounced();

            if (extensionSettings.moduleSettings.showOtherNotifications) {
                toastr.info('Chat settings cleared', 'STMTL');
            }
        }
    }
}

/**
 * Migrates old data structures to new format
 */
function migrateOldData() {
    const extensionSettings = getExtensionSettings();

    if (extensionSettings.migrationVersion >= 5) { // Incremented version (group support)
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


    if (extensionSettings.migrationVersion >= 3) {  // Incremented version
        console.log('STMTL: Migration already completed');
        return;
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

    if (!extensionSettings.groupSettings) {
        extensionSettings.groupSettings = {};
        console.log('STMTL: Added group settings storage.');
    }

    extensionSettings.migrationVersion = 5;  // Incremented version for group support
    saveSettingsDebounced();

    console.log('STMTL: Data migration completed with group support');
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

    console.log('STMTL: Ready to initialize with chat_metadata support');
});