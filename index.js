import { eventSource, event_types } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced, chat_metadata } from '../../../../script.js';
import { saveMetadataDebounced } from '../../../extensions.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { lodash, moment, Handlebars, DOMPurify, morphdom } from '../../../../lib.js';

const MODULE_NAME = 'STChatModelTemp';
const SAVE_DEBOUNCE_TIME = 1000;

// Centralized DOM selectors - single source of truth
const SELECTORS = {
    mainApi: '#main_api',
    completionSource: '#chat_completion_source',
    menuItem: '#stcmt-menu-item',
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
        preferCharacterOverChat: true,
        autoSave: true,
        showNotifications: false
    },
    characterSettings: {},
    migrationVersion: 0
};

// Current cached settings for active character/chat
let currentCharacterSettings = null;
let currentChatSettings = null;
let isExtensionEnabled = false;

// Cache for the current popup instance to allow content refresh
let currentPopupInstance = null;

/**
 * Safe set function using direct object access (no lodash path interpretation)
 */
function safeSetCharacterSettings(characterName, settings) {
    const extensionSettings = getExtensionSettings();
    
    if (!characterName) {
        console.warn('STChatModelTemp: Cannot save settings - invalid character name');
        return false;
    }
    
    // Normalize the character name before using as key
    let normalizedName = String(characterName).trim();
    if (normalizedName.normalize) {
        normalizedName = normalizedName.normalize('NFC');
    }
    
    // Use direct object assignment - no path interpretation issues
    if (!extensionSettings.characterSettings) {
        extensionSettings.characterSettings = {};
    }
    
    extensionSettings.characterSettings[normalizedName] = settings;
    console.log(`STChatModelTemp: Saved character settings for normalized name "${normalizedName}"`);
    console.log('STChatModelTemp: Settings saved:', settings);
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
        console.log(`STChatModelTemp: Retrieved character settings for normalized name "${normalizedName}"`);
        console.log('STChatModelTemp: Settings retrieved:', settings);
    } else {
        console.log(`STChatModelTemp: No settings found for normalized name "${normalizedName}"`);
        // Debug: show all available character keys
        const availableKeys = Object.keys(extensionSettings.characterSettings || {});
        console.log('STChatModelTemp: Available character keys:', availableKeys);
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
        console.log(`STChatModelTemp: Deleted character settings for normalized name "${normalizedName}"`);
        return true;
    }
    
    console.log(`STChatModelTemp: No settings to delete for normalized name "${normalizedName}"`);
    return false;
}

// Enhanced debounced function with logging
const debouncedModelSettingsChanged = lodash.debounce(function() {
    console.log('STChatModelTemp: Debounced save triggered');
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
        <h5>Current Character Settings:</h5>
        <div class="mes_file_container">
            <pre style="margin: 0; white-space: pre-line;">{{characterInfo}}</pre>
        </div>
        
        <h5>Current Chat Settings:</h5>
        <div class="mes_file_container">
            <pre style="margin: 0; white-space: pre-line;">{{chatInfo}}</pre>
        </div>
    </div>
</div>
`);

/**
 * Get extension settings from SillyTavern's settings system
 */
function getExtensionSettings() {
    if (!extension_settings.STChatModelTemp) {
        extension_settings.STChatModelTemp = lodash.cloneDeep(defaultSettings);
        console.log('STChatModelTemp: Created new settings with defaults');
    }
    return extension_settings.STChatModelTemp;
}

/**
 * Get current context - simplified to only use chat_metadata
 */
function getCurrentContext() {
    try {
        let characterName = null;
        let chatId = null;
        let chatName = null;

        // ONLY use chat_metadata.character_name with proper normalization
        const rawCharacterName = chat_metadata?.character_name;
        if (rawCharacterName) {
            characterName = String(rawCharacterName).trim();
            // Normalize unicode characters
            if (characterName.normalize) {
                characterName = characterName.normalize('NFC');
            }
        }

        // Get chat information
        if (typeof window.getCurrentChatId === 'function') {
            chatId = window.getCurrentChatId();
            chatName = chatId;
        }

        const result = {
            characterName,
            chatId,
            groupId: window.selected_group || null,
            chatName
        };

        console.log('STChatModelTemp: Context resolved (chat_metadata only, normalized):', result);
        return result;
        
    } catch (e) {
        console.warn('STChatModelTemp: Error getting context:', e);
        return {
            characterName: null,
            chatId: null,
            groupId: null,
            chatName: null
        };
    }
}

/**
 * Get character name for settings - only from chat_metadata
 */
function getCharacterNameForSettings() {
    // Try multiple sources for character name
    const rawCharacterName = name2 || 
                            characters[this_chid]?.name || 
                            characters[this_chid]?.avatar;
    
    if (!rawCharacterName) {
        console.warn('STChatModelTemp: No character name available');
        return null;
    }
    
    let characterName = String(rawCharacterName).trim();
    
    if (characterName.normalize) {
        characterName = characterName.normalize('NFC');
    }
    
    console.log('STChatModelTemp: Raw character name:', rawCharacterName);
    console.log('STChatModelTemp: Normalized character name:', characterName);
    
    return characterName;
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
        console.warn('STChatModelTemp: Error checking API compatibility:', e);
        const mainApi = $(SELECTORS.mainApi).val();
        const completionSource = $(SELECTORS.completionSource).val();
        isCompatible = mainApi === 'openai' && lodash.includes(SUPPORTED_COMPLETION_SOURCES, completionSource);
    }
    
    if (isCompatible !== isExtensionEnabled) {
        isExtensionEnabled = isCompatible;
        
        const extensionSettings = getExtensionSettings();
        if (extensionSettings.moduleSettings.showNotifications) {
            if (isCompatible) {
                toastr.info('STChatModelTemp extension enabled for Chat Completion API', 'STChatModelTemp');
            } else {
                toastr.warning('STChatModelTemp requires Chat Completion API', 'STChatModelTemp');
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
        console.warn('STChatModelTemp: Error getting API info:', e);
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
 * Generate popup HTML content using Handlebars template
 */
function getPopupContent() {
    const settings = getExtensionSettings();
    const apiInfo = getCurrentApiInfo();
    
    const statusText = isExtensionEnabled 
        ? `Active (${apiInfo.completionSource})` 
        : `Requires Chat Completion API (current: ${apiInfo.api})`;
    
    const templateData = {
        isExtensionEnabled,
        statusText,
        characterInfo: formatSettingsInfo(currentCharacterSettings),
        chatInfo: formatSettingsInfo(currentChatSettings),
        checkboxes: [
            {
                id: 'stcmt-enable-character',
                label: 'Remember per character',
                checked: settings.moduleSettings.enableCharacterMemory,
                requiresApi: true
            },
            {
                id: 'stcmt-enable-chat',
                label: 'Remember per chat',
                checked: settings.moduleSettings.enableChatMemory,
                requiresApi: true
            },
            {
                id: 'stcmt-prefer-character',
                label: 'Prefer character settings over chat',
                checked: settings.moduleSettings.preferCharacterOverChat,
                requiresApi: true
            },
            {
                id: 'stcmt-auto-save',
                label: 'Auto-save settings',
                checked: settings.moduleSettings.autoSave,
                requiresApi: true
            },
            {
                id: 'stcmt-show-notifications',
                label: 'Show notifications',
                checked: settings.moduleSettings.showNotifications,
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
        console.warn('STChatModelTemp: Cannot refresh popup - no popup currently open');
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
        
        console.log('STChatModelTemp: Popup content refreshed using morphdom');
    } catch (error) {
        console.error('STChatModelTemp: Error refreshing popup content:', error);
        currentPopupInstance.completeCancelled();
        setTimeout(() => showPopup(), 100);
    }
}

/**
 * Create UI elements using SillyTavern's existing styles
 */
function createUI() {
    const menuItem = $(`
        <div class="list-group-item flex alignItemsCenter gap5px" id="stcmt-menu-item">
            <i class="fa-solid fa-brain"></i>
            <span>Model Memory</span>
        </div>
    `);
    
    let extensionsList = $(SELECTORS.extensionsMenu);
    if (extensionsList.length === 0) {
        extensionsList = $('<div class="list-group"></div>');
        $('#extensionsMenu').append(extensionsList);
    }
    extensionsList.append(menuItem);
}

/**
 * Show the popup using ST's popup system
 */
async function showPopup() {
    const content = getPopupContent();
    const header = '🧠 Model & Temperature Settings';
    const contentWithHeader = `<h3>${header}</h3>${content}`;
    
    const customButtons = [
        {
            text: '💾 Update Settings',
            result: null,
            classes: ['menu_button'],
            action: async (popup) => {
                await saveCurrentSettings();
                refreshPopupContent();
                // Return false to prevent the popup from closing
                return false;
            }
        },
        {
            text: '🗑️ Clear Character Settings',
            result: null,
            classes: ['menu_button'],
            action: async (popup) => {
                await clearCharacterSettings();
                refreshPopupContent();
                // Return false to prevent the popup from closing
                return false;
            }
        },
        {
            text: '🗑️ Clear Chat Settings',
            result: null,
            classes: ['menu_button'],
            action: async (popup) => {
                await clearChatSettings();
                refreshPopupContent();
                // Return false to prevent the popup from closing
                return false;
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
        console.error('STChatModelTemp: Error showing popup:', error);
        currentPopupInstance = null;
    }
}

/**
 * Handle popup close event to save settings
 */
function handlePopupClose(popup) {
    try {
        const popupElement = popup.dlg;
        const settings = getExtensionSettings();
        
        const checkboxMappings = {
            'stcmt-enable-character': 'enableCharacterMemory',
            'stcmt-enable-chat': 'enableChatMemory',
            'stcmt-prefer-character': 'preferCharacterOverChat',
            'stcmt-auto-save': 'autoSave',
            'stcmt-show-notifications': 'showNotifications'
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
            console.log('STChatModelTemp: Settings updated from popup');
        }
    } catch (error) {
        console.error('STChatModelTemp: Error handling popup close:', error);
    }
}

/**
 * SIMPLIFIED: Event listener setup with only 2 reliable events
 */
function setupEventListeners() {
    // Menu item click handler
    $(document).on('click', SELECTORS.menuItem, function() {
        showPopup();
    });

    // Simplified SillyTavern event handlers - only 2 events
    function registerSillyTavernEvents() {
        try {
            if (!eventSource || !event_types) {
                console.warn('STChatModelTemp: eventSource or event_types not available, retrying...');
                setTimeout(registerSillyTavernEvents, 1000);
                return;
            }

            console.log('STChatModelTemp: Setting up simplified event listeners');

            // Character and chat change events
            eventSource.on(event_types.CHARACTER_SELECTED, onCharacterChanged);
            eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
            
            eventSource.on(event_types.CHAT_LOADED, () => {
                console.log('STChatModelTemp: Chat loaded event');
                setTimeout(() => {
                    updateCachedSettings();
                }, 500);
            });
            
            // SIMPLIFIED AUTO-SAVE: Only 2 events
            const extensionSettings = getExtensionSettings();
            
            if (extensionSettings.moduleSettings.autoSave) {
                console.log('STChatModelTemp: Setting up simplified auto-save (2 events only)');
                
                // Primary event - GENERATION_STARTED
                if (event_types.GENERATION_STARTED) {
                    eventSource.on(event_types.GENERATION_STARTED, () => {
                        console.log('STChatModelTemp: GENERATION_STARTED event detected');
                        if (getExtensionSettings().moduleSettings.autoSave && isExtensionEnabled) {
                            console.log('STChatModelTemp: Triggering auto-save from GENERATION_STARTED...');
                            debouncedModelSettingsChanged();
                        }
                    });
                }
                
                // Secondary event - CHAT_COMPLETION_PROMPT_READY (more reliable)
                if (event_types.CHAT_COMPLETION_PROMPT_READY) {
                    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, () => {
                        console.log('STChatModelTemp: CHAT_COMPLETION_PROMPT_READY event detected');
                        if (getExtensionSettings().moduleSettings.autoSave && isExtensionEnabled) {
                            console.log('STChatModelTemp: Triggering auto-save from CHAT_COMPLETION_PROMPT_READY...');
                            debouncedModelSettingsChanged();
                        }
                    });
                }
            }
            
            console.log('STChatModelTemp: Simplified event listeners registered successfully');
        } catch (e) {
            console.warn('STChatModelTemp: Could not bind to SillyTavern events:', e);
            setTimeout(registerSillyTavernEvents, 2000);
        }
    }

    registerSillyTavernEvents();

    // API change handlers
    $(document).on('change', `${SELECTORS.mainApi}, ${SELECTORS.completionSource}`, function() {
        console.log('STChatModelTemp: API change detected');
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
        console.log('STChatModelTemp: Model/temp setting changed:', e.target.id);
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
        console.log('STChatModelTemp: Character change ignored - extension disabled or no memory features enabled');
        return;
    }

    const context = getCurrentContext();
    if (!context.characterName) {
        console.log('STChatModelTemp: Character change ignored - no character name in chat_metadata');
        return;
    }

    console.log('STChatModelTemp: Character changed to:', context.characterName);

    updateCachedSettings();
    applySettings();
    
    console.log('STChatModelTemp: Character change handling complete');
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

/**
 * Enhanced model settings change handler with better logging
 */
function onModelSettingsChanged() {
    console.log('STChatModelTemp: onModelSettingsChanged() called');
    
    const extensionSettings = getExtensionSettings();
    console.log('STChatModelTemp: Auto-save enabled:', extensionSettings.moduleSettings.autoSave);
    console.log('STChatModelTemp: Extension enabled:', isExtensionEnabled);
    
    if (!isExtensionEnabled) {
        console.log('STChatModelTemp: Skipping save - extension not enabled');
        return;
    }
    
    if (!extensionSettings.moduleSettings.autoSave) {
        console.log('STChatModelTemp: Skipping save - auto-save disabled');
        return;
    }

    console.log('STChatModelTemp: Proceeding with auto-save...');
    saveCurrentSettings();
}

/**
 * Update cached settings for current character/chat - using direct object access
 */
function updateCachedSettings() {
    const extensionSettings = getExtensionSettings();
    const context = getCurrentContext();

    // Always clear cached settings first to avoid stale data
    currentCharacterSettings = null;
    currentChatSettings = null;

    // Get normalized character name from chat_metadata ONLY
    const characterName = getCharacterNameForSettings();

    // Load character settings only if enabled and character exists
    if (extensionSettings.moduleSettings.enableCharacterMemory && characterName) {
        currentCharacterSettings = safeGetCharacterSettings(characterName);
        console.log(`STChatModelTemp: Loaded character settings for "${characterName}":`, currentCharacterSettings);
    } else if (extensionSettings.moduleSettings.enableCharacterMemory) {
        console.log('STChatModelTemp: Character memory enabled but no character name available');
    }

    // Load chat settings from chat metadata only if enabled and chat exists
    if (extensionSettings.moduleSettings.enableChatMemory && context.chatId && chat_metadata) {
        currentChatSettings = chat_metadata.STChatModelTemp || null;
        console.log('STChatModelTemp: Loaded chat settings:', currentChatSettings);
    } else if (extensionSettings.moduleSettings.enableChatMemory) {
        console.log('STChatModelTemp: Chat memory enabled but no chat context available');
    }

    console.log('STChatModelTemp: Cached settings updated', {
        characterName: characterName,
        chatId: context.chatId,
        hasCharacterSettings: !!currentCharacterSettings,
        hasChatSettings: !!currentChatSettings,
        characterMemoryEnabled: extensionSettings.moduleSettings.enableCharacterMemory,
        chatMemoryEnabled: extensionSettings.moduleSettings.enableChatMemory
    });
}

/**
 * Apply the appropriate settings based on priority
 */
function applySettings() {
    if (!isExtensionEnabled) {
        console.log('STChatModelTemp: Settings not applied - extension not enabled');
        return;
    }

    const extensionSettings = getExtensionSettings();
    let settingsToApply = null;
    let settingsSource = null;

    // Determine which settings to apply based on preference
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

    if (!settingsToApply) {
        console.log('STChatModelTemp: No settings to apply for current context');
        return;
    }

    console.log(`STChatModelTemp: Applying ${settingsSource} settings:`, settingsToApply);

    const selectors = getApiSelectors();
    const apiInfo = getCurrentApiInfo();

    // Check if the saved settings match the current completion source
    if (settingsToApply.completionSource && settingsToApply.completionSource !== apiInfo.completionSource) {
        if (extensionSettings.moduleSettings.showNotifications) {
            toastr.warning(`Saved settings for ${settingsToApply.completionSource}, current source is ${apiInfo.completionSource}`, 'STChatModelTemp');
        }
        console.log(`STChatModelTemp: Settings not applied - completion source mismatch (saved: ${settingsToApply.completionSource}, current: ${apiInfo.completionSource})`);
        return;
    }

    // Apply model setting - handle both custom fields for custom completion source
    if (settingsToApply.model) {
        if (apiInfo.completionSource === 'custom') {
            if ($(SELECTORS.customModelId).length) {
                const currentCustomId = $(SELECTORS.customModelId).val();
                if (currentCustomId !== settingsToApply.model) {
                    $(SELECTORS.customModelId).val(settingsToApply.model).trigger('change');
                    console.log(`STChatModelTemp: Custom model ID changed from ${currentCustomId} to ${settingsToApply.model}`);
                }
            }
            
            if ($(SELECTORS.modelCustomSelect).length) {
                const currentCustomSelect = $(SELECTORS.modelCustomSelect).val();
                if (currentCustomSelect !== settingsToApply.model) {
                    $(SELECTORS.modelCustomSelect).val(settingsToApply.model).trigger('change');
                    console.log(`STChatModelTemp: Custom model select changed from ${currentCustomSelect} to ${settingsToApply.model}`);
                }
            }
        } else {
            if ($(selectors.model).length) {
                const currentModel = $(selectors.model).val();
                if (currentModel !== settingsToApply.model) {
                    $(selectors.model).val(settingsToApply.model).trigger('change');
                    console.log(`STChatModelTemp: Model changed from ${currentModel} to ${settingsToApply.model}`);
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
            console.log(`STChatModelTemp: Temperature changed from ${currentTemp} to ${settingsToApply.temperature}`);
        }
    }

    if (extensionSettings.moduleSettings.showNotifications) {
        toastr.info(`Applied ${settingsSource} settings for ${settingsToApply.completionSource}`, 'STChatModelTemp');
    }
    
    console.log(`STChatModelTemp: Successfully applied ${settingsSource} settings`);
}

/**
 * Save current model and temperature settings - using direct object access
 */
async function saveCurrentSettings() {
    if (!isExtensionEnabled) {
        toastr.warning('Cannot save settings - STChatModelTemp requires Chat Completion API', 'STChatModelTemp');
        return;
    }

    const extensionSettings = getExtensionSettings();
    const context = getCurrentContext();
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

    // Save character settings using direct access
    const characterName = getCharacterNameForSettings();
    if (extensionSettings.moduleSettings.enableCharacterMemory && characterName) {
        const success = safeSetCharacterSettings(characterName, settingsData);
        if (success) {
            currentCharacterSettings = lodash.cloneDeep(settingsData);
            
            console.log(`STChatModelTemp: Saved character settings for "${characterName}":`, settingsData);
            
            if (extensionSettings.moduleSettings.showNotifications) {
                toastr.success(`Character settings saved for ${characterName} (${apiInfo.completionSource})`, 'STChatModelTemp');
            }
        } else {
            console.error(`STChatModelTemp: Failed to save character settings for "${characterName}"`);
            if (extensionSettings.moduleSettings.showNotifications) {
                toastr.error(`Failed to save character settings for ${characterName}`, 'STChatModelTemp');
            }
        }
    }

    // Save chat settings to chat metadata
    if (extensionSettings.moduleSettings.enableChatMemory && context.chatId) {
        if (!chat_metadata) {
            window.chat_metadata = {};
        }
        
        chat_metadata.STChatModelTemp = settingsData;
        currentChatSettings = lodash.cloneDeep(settingsData);
        
        console.log('STChatModelTemp: Saved chat settings:', settingsData);
        
        saveMetadataDebounced();
        
        if (extensionSettings.moduleSettings.showNotifications) {
            toastr.success(`Chat settings saved for ${apiInfo.completionSource}`, 'STChatModelTemp');
        }
    }

    saveSettingsDebounced();
}

/**
 * Clear character-specific settings - using direct object access
 */
async function clearCharacterSettings() {
    const extensionSettings = getExtensionSettings();
    const characterName = getCharacterNameForSettings();
    if (!characterName) return;

    const success = safeDeleteCharacterSettings(characterName);
    if (success) {
        currentCharacterSettings = null;
        console.log(`STChatModelTemp: Cleared character settings for "${characterName}"`);
        
        saveSettingsDebounced();
        
        if (extensionSettings.moduleSettings.showNotifications) {
            toastr.info(`Character settings cleared for ${characterName}`, 'STChatModelTemp');
        }
    }
}

/**
 * Clear chat-specific settings from chat metadata
 */
async function clearChatSettings() {
    const extensionSettings = getExtensionSettings();
    const context = getCurrentContext();
    if (!context.chatId || !chat_metadata) return;

    delete chat_metadata.STChatModelTemp;
    currentChatSettings = null;
    
    saveMetadataDebounced();
    
    if (extensionSettings.moduleSettings.showNotifications) {
        toastr.info('Chat settings cleared', 'STChatModelTemp');
    }
}

/**
 * Migrates old data structures to new format using direct object access
 */
function migrateOldData() {
    const extensionSettings = getExtensionSettings();
    
    if (extensionSettings.migrationVersion >= 2) {
        console.log('STChatModelTemp: Migration already completed');
        return;
    }
    
    console.log('STChatModelTemp: Starting data migration...');
    
    // Migrate character settings - convert any escaped keys back to original names
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
                        .replace(/\\\\/g, '\\')  // Unescape backslashes
                        .replace(/\\\./g, '.')   // Unescape dots
                        .replace(/\\\]/g, ']')   // Unescape closing brackets
                        .replace(/\\\[/g, '[');  // Unescape opening brackets
                    console.log(`STChatModelTemp: Unescaped character key "${characterKey}" to "${characterName}"`);
                } catch (e) {
                    console.warn(`STChatModelTemp: Could not unescape key "${characterKey}", using as-is`);
                }
            }
            
            // Try to find character by old key format for legacy support
            if (!window.characters?.find(char => char.name === characterName)) {
                const character = window.characters?.find(char => 
                    char.avatar === characterKey || 
                    String(window.characters.indexOf(char)) === characterKey
                );
                
                if (character && character.name) {
                    characterName = character.name;
                    console.log(`STChatModelTemp: Found character name "${characterName}" for old key "${characterKey}"`);
                }
            }
            
            // Store with the final character name (no escaping needed)
            newCharacterSettings[characterName] = settings;
            migratedCount++;
            console.log(`STChatModelTemp: Migrated settings for "${characterName}"`);
        }
        
        extensionSettings.characterSettings = newCharacterSettings;
        console.log(`STChatModelTemp: Migrated ${migratedCount} character settings to direct access format`);
    }
    
    // Remove old chatSettings from extension settings
    if (extensionSettings.chatSettings) {
        console.log('STChatModelTemp: Removing old chatSettings from extension settings (now stored in chat metadata)');
        delete extensionSettings.chatSettings;
    }
    
    extensionSettings.migrationVersion = 2;
    saveSettingsDebounced();
    
    console.log('STChatModelTemp: Data migration completed');
}

// Initialization flag to prevent duplicate calls
let hasInitialized = false;

/**
 * Initialize the extension
 */
async function init() {
    if (hasInitialized) return;
    hasInitialized = true;
    console.log('STChatModelTemp: Initializing optimized version with direct object access');
    
    // Wait for SillyTavern to be ready
    let attempts = 0;
    const maxAttempts = 20;
    
    while (attempts < maxAttempts) {
        if ($(SELECTORS.mainApi).length > 0 && eventSource && typeof Popup !== 'undefined') {
            console.log('STChatModelTemp: SillyTavern UI and Popup system detected');
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
    }

    // Initialize extension settings
    const settings = getExtensionSettings();
    console.log('STChatModelTemp: Settings ready:', lodash.keys(settings));

    // Run data migration if needed
    migrateOldData();

    // Create UI elements
    createUI();

    // Set up simplified event listeners
    setupEventListeners();

    // Check initial API compatibility
    checkApiCompatibility();

    // Initial context detection and settings load
    setTimeout(() => {
        onCharacterChanged();
        console.log('STChatModelTemp: Initial context loaded');
    }, 1000);

    console.log('STChatModelTemp: Optimized extension loaded successfully with direct object access');
}

// Initialize when the extension loads
$(document).ready(() => {
    if (eventSource && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, init);
    }
    
    // Fallback initialization
    setTimeout(init, 1500);
    
    console.log('STChatModelTemp: Ready to initialize (optimized with direct object access)');
});