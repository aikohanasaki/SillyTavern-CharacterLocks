import { eventSource, event_types } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../popup.js';
import { lodash, moment, Handlebars, DOMPurify } from '../../../../lib.js';

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
    chatSettings: {}
};

// Current cached settings for active character/chat
let currentCharacterSettings = null;
let currentChatSettings = null;
let isExtensionEnabled = false;

// Create debounced functions using lodash
const debouncedModelSettingsChanged = lodash.debounce(onModelSettingsChanged, SAVE_DEBOUNCE_TIME);

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
 * Get current context using SillyTavern's built-in functions
 */
function getCurrentContext() {
    try {
        // Use SillyTavern's global context function
        const context = window.SillyTavern?.getContext?.() || {};
        
        let characterId = null;
        let characterName = null;
        let chatId = null;
        let chatName = null;

        // Get character information from SillyTavern's global state
        if (typeof window.this_chid !== 'undefined' && window.characters?.[window.this_chid]) {
            const chid = window.this_chid;
            characterId = window.characters[chid].avatar || String(chid);
            characterName = window.characters[chid].name || window.name2;
        } else if (window.name2) {
            characterName = window.name2;
            characterId = characterName;
        }

        // Get chat information using SillyTavern's function
        if (typeof window.getCurrentChatId === 'function') {
            chatId = window.getCurrentChatId();
            chatName = chatId;
        }

        // Fallback to context data if available
        if (!characterId && context.characterId !== undefined) {
            characterId = context.characterId;
        }
        if (!characterName && context.characterName) {
            characterName = context.characterName;
        }
        if (!chatId && context.chatId) {
            chatId = context.chatId;
        }

        // Generate fallback IDs if needed
        if (characterName && !characterId) {
            characterId = lodash.kebabCase(characterName);
        }
        if (characterId && !chatId) {
            chatId = `chat_${characterId}_${Date.now()}`;
        }

        const result = {
            characterId,
            chatId,
            groupId: window.selected_group || null,
            characterName,
            chatName
        };

        console.log('STChatModelTemp: Context resolved:', result);
        return result;
        
    } catch (e) {
        console.warn('STChatModelTemp: Error getting context:', e);
        return {
            characterId: null,
            chatId: null,
            groupId: null,
            characterName: null,
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
        // Use SillyTavern's API detection functions if available
        if (typeof window.getGeneratingApi === 'function') {
            const currentApi = window.getGeneratingApi();
            isCompatible = window.main_api === 'openai' && lodash.includes(SUPPORTED_COMPLETION_SOURCES, currentApi);
        } else {
            // Fallback to DOM reading
            const mainApi = $(SELECTORS.mainApi).val();
            const completionSource = $(SELECTORS.completionSource).val();
            isCompatible = mainApi === 'openai' && lodash.includes(SUPPORTED_COMPLETION_SOURCES, completionSource);
        }
    } catch (e) {
        console.warn('STChatModelTemp: Error checking API compatibility:', e);
        // Fallback to DOM reading
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

        // Use SillyTavern's built-in functions if available
        if (typeof window.getGeneratingApi === 'function') {
            api = window.getGeneratingApi();
        } else {
            api = $(SELECTORS.mainApi).val() || 'unknown';
        }

        if (typeof window.getGeneratingModel === 'function') {
            model = window.getGeneratingModel();
        }

        // Get completion source
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
 * Create UI elements using SillyTavern's existing styles
 */
function createUI() {
    // Add menu item to extensions dropdown using existing list-group-item class
    const menuItem = $(`
        <div class="list-group-item flex alignItemsCenter gap5px" id="stcmt-menu-item">
            <i class="fa-solid fa-brain"></i>
            <span>Model Memory</span>
        </div>
    `);
    
    // Find the list-group in extensions menu or create it
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
    
    const customButtons = [
        {
            text: '💾 Update Settings',
            result: POPUP_RESULT.CUSTOM1,
            classes: ['menu_button']
        },
        {
            text: '🗑️ Clear Character Settings',
            result: POPUP_RESULT.CUSTOM2,
            classes: ['menu_button']
        },
        {
            text: '🗑️ Clear Chat Settings',
            result: POPUP_RESULT.CUSTOM3,
            classes: ['menu_button']
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
        const result = await Popup.show.text('🧠 Model & Temperature Settings', content, popupOptions);
        
        // Handle button results
        switch (result) {
            case POPUP_RESULT.CUSTOM1:
                await saveCurrentSettings();
                setTimeout(() => showPopup(), 100);
                break;
            case POPUP_RESULT.CUSTOM2:
                await clearCharacterSettings();
                setTimeout(() => showPopup(), 100);
                break;
            case POPUP_RESULT.CUSTOM3:
                await clearChatSettings();
                setTimeout(() => showPopup(), 100);
                break;
        }
    } catch (error) {
        console.error('STChatModelTemp: Error showing popup:', error);
    }
}

/**
 * Handle popup close event to save settings
 */
function handlePopupClose(popup) {
    try {
        const popupElement = popup.dlg;
        const settings = getExtensionSettings();
        
        // Define checkbox mappings
        const checkboxMappings = {
            'stcmt-enable-character': 'enableCharacterMemory',
            'stcmt-enable-chat': 'enableChatMemory',
            'stcmt-prefer-character': 'preferCharacterOverChat',
            'stcmt-auto-save': 'autoSave',
            'stcmt-show-notifications': 'showNotifications'
        };
        
        // Get new values from checkboxes
        const newValues = lodash.mapValues(checkboxMappings, (settingKey, checkboxId) => {
            return popupElement.querySelector(`#${checkboxId}`)?.checked ?? settings.moduleSettings[settingKey];
        });
        
        // Check if any values changed
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
 * Set up event listeners
 */
function setupEventListeners() {
    // Menu item click handler
    $(document).on('click', SELECTORS.menuItem, function() {
        showPopup();
    });

    // Enhanced SillyTavern event handlers
    try {
        eventSource.on(event_types.CHARACTER_SELECTED, onCharacterChanged);
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
        
        eventSource.on(event_types.CHAT_LOADED, () => {
            console.log('STChatModelTemp: Chat loaded event');
            setTimeout(() => {
                updateCachedSettings();
            }, 500);
        });
        
        eventSource.on(event_types.MESSAGE_SENT, () => {
            if (getExtensionSettings().moduleSettings.autoSave) {
                debouncedModelSettingsChanged();
            }
        });
        
        console.log('STChatModelTemp: Event listeners registered successfully');
    } catch (e) {
        console.warn('STChatModelTemp: Could not bind to SillyTavern events:', e);
    }

    // API change handlers
    $(document).on('change', `${SELECTORS.mainApi}, ${SELECTORS.completionSource}`, function() {
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
        'modelScale', 'modelGoogle', 'modelMistralai', 'customModelId', 'modelCohere', 
        'modelPerplexity', 'modelGroq', 'model01ai', 'modelNanogpt', 'modelDeepseek',
        'modelBlockentropy', 'tempOpenai', 'tempCounterOpenai'
    ])).join(', ');
    
    $(document).on('change input', modelSelectors, debouncedModelSettingsChanged);
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
    if (!context.characterId) {
        console.log('STChatModelTemp: Character change ignored - no character ID');
        return;
    }

    console.log('STChatModelTemp: Character changed to:', {
        characterId: context.characterId,
        characterName: context.characterName,
        chatId: context.chatId
    });

    // Clear any existing cached settings and load new ones
    updateCachedSettings();
    
    // Apply settings for the new character/chat context
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
 * Handle model/temperature changes
 */
function onModelSettingsChanged() {
    const extensionSettings = getExtensionSettings();
    if (!isExtensionEnabled || !extensionSettings.moduleSettings.autoSave) return;

    saveCurrentSettings();
}

/**
 * Update cached settings for current character/chat
 */
function updateCachedSettings() {
    const extensionSettings = getExtensionSettings();
    const context = getCurrentContext();

    // Always clear cached settings first to avoid stale data
    currentCharacterSettings = null;
    currentChatSettings = null;

    // Load character settings only if enabled and character exists
    if (extensionSettings.moduleSettings.enableCharacterMemory && context.characterId) {
        const characterKey = String(context.characterId);
        currentCharacterSettings = lodash.get(extensionSettings.characterSettings, characterKey, null);
    }

    // Load chat settings only if enabled and chat exists
    if (extensionSettings.moduleSettings.enableChatMemory && context.chatId) {
        const chatKey = String(context.chatId);
        currentChatSettings = lodash.get(extensionSettings.chatSettings, chatKey, null);
    }

    // Debug logging to help troubleshoot
    console.log('STChatModelTemp: Cached settings updated', {
        characterId: context.characterId,
        chatId: context.chatId,
        hasCharacterSettings: !!currentCharacterSettings,
        hasChatSettings: !!currentChatSettings
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

    // Apply model setting
    if (settingsToApply.model && $(selectors.model).length) {
        const currentModel = $(selectors.model).val();
        if (currentModel !== settingsToApply.model) {
            $(selectors.model).val(settingsToApply.model).trigger('change');
            console.log(`STChatModelTemp: Model changed from ${currentModel} to ${settingsToApply.model}`);
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
 * Save current model and temperature settings
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
    
    const currentModel = $(selectors.model).val();
    const currentTemp = parseFloat($(selectors.temp).val() || $(selectors.tempCounter).val() || 0.7);
    
    const settingsData = {
        model: currentModel,
        temperature: currentTemp,
        completionSource: apiInfo.completionSource,
        savedAt: moment().toISOString()
    };

    if (extensionSettings.moduleSettings.enableCharacterMemory && context.characterId) {
        const characterKey = String(context.characterId);
        lodash.set(extensionSettings.characterSettings, characterKey, settingsData);
        currentCharacterSettings = lodash.cloneDeep(settingsData);
        
        if (extensionSettings.moduleSettings.showNotifications) {
            toastr.success(`Character settings saved for ${apiInfo.completionSource}`, 'STChatModelTemp');
        }
    }

    if (extensionSettings.moduleSettings.enableChatMemory && context.chatId) {
        const chatKey = String(context.chatId);
        lodash.set(extensionSettings.chatSettings, chatKey, settingsData);
        currentChatSettings = lodash.cloneDeep(settingsData);
        
        if (extensionSettings.moduleSettings.showNotifications) {
            toastr.success(`Chat settings saved for ${apiInfo.completionSource}`, 'STChatModelTemp');
        }
    }

    saveSettingsDebounced();
}

/**
 * Clear character-specific settings
 */
async function clearCharacterSettings() {
    const extensionSettings = getExtensionSettings();
    const context = getCurrentContext();
    if (!context.characterId) return;

    const characterKey = String(context.characterId);
    lodash.unset(extensionSettings.characterSettings, characterKey);
    currentCharacterSettings = null;
    
    saveSettingsDebounced();
    
    if (extensionSettings.moduleSettings.showNotifications) {
        toastr.info('Character settings cleared', 'STChatModelTemp');
    }
}

/**
 * Clear chat-specific settings
 */
async function clearChatSettings() {
    const extensionSettings = getExtensionSettings();
    const context = getCurrentContext();
    if (!context.chatId) return;

    const chatKey = String(context.chatId);
    lodash.unset(extensionSettings.chatSettings, chatKey);
    currentChatSettings = null;
    
    saveSettingsDebounced();
    
    if (extensionSettings.moduleSettings.showNotifications) {
        toastr.info('Chat settings cleared', 'STChatModelTemp');
    }
}

// Initialization flag to prevent duplicate calls
let hasInitialized = false;

/**
 * Initialize the extension with enhanced context detection
 */
async function init() {
    if (hasInitialized) return;
    hasInitialized = true;
    console.log('STChatModelTemp: Initializing with enhanced SillyTavern integration');
    
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

    // Create UI elements
    createUI();

    // Set up event listeners
    setupEventListeners();

    // Check initial API compatibility
    checkApiCompatibility();

    // Initial context detection and settings load
    setTimeout(() => {
        onCharacterChanged();
        console.log('STChatModelTemp: Initial context loaded');
    }, 1000);

    console.log('STChatModelTemp: Extension loaded successfully with enhanced SillyTavern integration');
}

// Initialize when the extension loads
$(document).ready(() => {
    if (eventSource && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, init);
    }
    
    // Fallback initialization
    setTimeout(init, 1500);
    
    console.log('STChatModelTemp: Ready to initialize');
});