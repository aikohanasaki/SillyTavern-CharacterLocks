import { eventSource, event_types } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { Popup, POPUP_TYPE, POPUP_RESULT } from '../../../../popup.js';

const MODULE_NAME = 'STChatModelTemp';
const SAVE_DEBOUNCE_TIME = 1000;

// Centralized DOM selectors - single source of truth
const SELECTORS = {
    mainApi: '#main_api',
    completionSource: '#chat_completion_source',
    characterSelect: '#rm_button_selected_ch',
    altCharacterSelect: '.character_select.selected, .selected_character',
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

// Current context cache
let currentContext = {
    characterId: null,
    chatId: null,
    groupId: null,
    characterName: null,
    chatName: null
};

/**
 * Get extension settings from SillyTavern's settings system
 */
function getExtensionSettings() {
    if (!extension_settings.STChatModelTemp) {
        extension_settings.STChatModelTemp = JSON.parse(JSON.stringify(defaultSettings));
        console.log('STChatModelTemp: Created new settings with defaults');
    }
    return extension_settings.STChatModelTemp;
}

// === Context Detection - Refactored into smaller functions ===

/**
 * Method 1 & 2: Get context from DOM elements
 */
function _getContextFromDom() {
    let characterId = null;
    let characterName = null;

    // Method 1: Try primary character selector
    const characterSelect = $(SELECTORS.characterSelect);
    if (characterSelect.length > 0) {
        characterId = characterSelect.attr('chid');
        characterName = characterSelect.text().trim();
    }
    
    // Method 2: Try alternative character selectors if primary failed
    if (!characterId) {
        const altCharSelect = $(SELECTORS.altCharacterSelect);
        if (altCharSelect.length > 0) {
            characterId = altCharSelect.data('chid') || altCharSelect.attr('chid');
            characterName = altCharSelect.text().trim() || altCharSelect.attr('title');
        }
    }

    return { characterId, characterName };
}

/**
 * Method 3: Get chat info from page title
 */
function _getContextFromPageTitle() {
    const pageTitle = document.title;
    return (pageTitle && pageTitle !== 'SillyTavern') ? pageTitle : null;
}

/**
 * Method 4: Get chat ID from URL hash
 */
function _getContextFromUrl() {
    const urlHash = window.location.hash;
    if (urlHash.includes('chat=')) {
        const chatMatch = urlHash.match(/chat=([^&]+)/);
        return chatMatch ? chatMatch[1] : null;
    }
    return null;
}

/**
 * Method 5: Use cached values as fallback
 */
function _getContextFromCache() {
    return {
        characterId: currentContext.characterId,
        characterName: currentContext.characterName,
        chatId: currentContext.chatId
    };
}

/**
 * Generate fallback IDs when needed
 */
function _generateFallbackIds(context) {
    // Generate fallback character ID from name
    if (context.characterName && !context.characterId) {
        context.characterId = context.characterName.toLowerCase().replace(/[^a-z0-9]/g, '');
    }
    
    // Generate fallback chat ID from character
    if (context.characterId && !context.chatId) {
        context.chatId = `chat_${context.characterId}_${Date.now()}`;
    }
    
    return context;
}

/**
 * Get current context using DOM inspection and cached values - now refactored
 */
function getCurrentContext() {
    try {
        let context = {
            characterId: null,
            chatId: null,
            groupId: null,
            characterName: null,
            chatName: null
        };

        // Method 1 & 2: Get from DOM elements
        const domContext = _getContextFromDom();
        context.characterId = domContext.characterId;
        context.characterName = domContext.characterName;

        // Method 3: Get chat info from title
        context.chatName = _getContextFromPageTitle();
        
        // Method 4: Get chat ID from URL
        const urlChatId = _getContextFromUrl();
        if (urlChatId) {
            context.chatId = urlChatId;
        }
        
        // Method 5: Use cached values if current attempt failed
        if (!context.characterId || !context.chatId) {
            const cachedContext = _getContextFromCache();
            context.characterId = context.characterId || cachedContext.characterId;
            context.characterName = context.characterName || cachedContext.characterName;
            context.chatId = context.chatId || cachedContext.chatId;
        }
        
        // Generate fallback IDs if needed
        context = _generateFallbackIds(context);
        
        // Update cache
        currentContext = { ...context };
        
        console.log('STChatModelTemp: Context resolved:', context);
        return context;
        
    } catch (e) {
        console.warn('STChatModelTemp: Error getting context:', e);
        return { ...currentContext }; // Return last known good context
    }
}

/**
 * Enhanced event handlers that extract context from events
 */
function onCharacterChangedEnhanced(eventData) {
    console.log('STChatModelTemp: Character changed event:', eventData);
    
    // Update context cache from event if available
    if (eventData && typeof eventData === 'object') {
        if (eventData.characterId || eventData.chid) {
            currentContext.characterId = eventData.characterId || eventData.chid;
        }
        if (eventData.characterName || eventData.name) {
            currentContext.characterName = eventData.characterName || eventData.name;
        }
    }
    
    // Call original handler
    onCharacterChanged();
}

function onChatChangedEnhanced(eventData) {
    console.log('STChatModelTemp: Chat changed event:', eventData);
    
    // Extract chat info from event or current state
    if (eventData) {
        if (typeof eventData === 'string') {
            // Event data is chat name
            currentContext.chatName = eventData;
            currentContext.chatId = eventData.toLowerCase().replace(/[^a-z0-9]/g, '_');
        } else if (typeof eventData === 'object') {
            if (eventData.chatId) currentContext.chatId = eventData.chatId;
            if (eventData.chatName) currentContext.chatName = eventData.chatName;
        }
    }
    
    // Also update context from DOM
    getCurrentContext();
    
    // Call original handler
    onChatChanged();
}

/**
 * Check API compatibility
 */
function checkApiCompatibility() {
    const mainApi = $(SELECTORS.mainApi).val();
    const completionSource = $(SELECTORS.completionSource).val();
    
    const isCompatible = mainApi === 'openai' && SUPPORTED_COMPLETION_SOURCES.includes(completionSource);
    
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
 * Generate popup HTML content using ST's popup system
 */
function getPopupContent() {
    const settings = getExtensionSettings();
    const mainApi = $(SELECTORS.mainApi).val();
    const completionSource = $(SELECTORS.completionSource).val();
    
    const statusText = isExtensionEnabled 
        ? `Active (${completionSource})` 
        : `Requires Chat Completion API (current: ${mainApi})`;
    
    const characterInfo = currentCharacterSettings 
        ? `Model: ${currentCharacterSettings.model || 'N/A'}
Temp: ${currentCharacterSettings.temperature || 'N/A'}
Source: ${currentCharacterSettings.completionSource || 'N/A'}
Saved: ${new Date(currentCharacterSettings.savedAt).toLocaleString()}`
        : isExtensionEnabled ? 'No saved settings' : 'Requires Chat Completion API';
    
    const chatInfo = currentChatSettings 
        ? `Model: ${currentChatSettings.model || 'N/A'}
Temp: ${currentChatSettings.temperature || 'N/A'}
Source: ${currentChatSettings.completionSource || 'N/A'}
Saved: ${new Date(currentChatSettings.savedAt).toLocaleString()}`
        : isExtensionEnabled ? 'No saved settings' : 'Requires Chat Completion API';

    return `
        <div class="stcmt-popup-content">
            <div class="info-block ${isExtensionEnabled ? 'hint' : 'warning'}">
                <span>API Status: <strong>${statusText}</strong></span>
            </div>
            
            <div class="stcmt-settings-section">
                <label class="checkbox_label">
                    <input type="checkbox" id="stcmt-enable-character" ${settings.moduleSettings.enableCharacterMemory ? 'checked' : ''} ${!isExtensionEnabled ? 'disabled' : ''}>
                    <span>Remember per character</span>
                </label>
                
                <label class="checkbox_label">
                    <input type="checkbox" id="stcmt-enable-chat" ${settings.moduleSettings.enableChatMemory ? 'checked' : ''} ${!isExtensionEnabled ? 'disabled' : ''}>
                    <span>Remember per chat</span>
                </label>
                
                <label class="checkbox_label">
                    <input type="checkbox" id="stcmt-prefer-character" ${settings.moduleSettings.preferCharacterOverChat ? 'checked' : ''} ${!isExtensionEnabled ? 'disabled' : ''}>
                    <span>Prefer character settings over chat</span>
                </label>
                
                <label class="checkbox_label">
                    <input type="checkbox" id="stcmt-auto-save" ${settings.moduleSettings.autoSave ? 'checked' : ''} ${!isExtensionEnabled ? 'disabled' : ''}>
                    <span>Auto-save settings</span>
                </label>
                
                <label class="checkbox_label">
                    <input type="checkbox" id="stcmt-show-notifications" ${settings.moduleSettings.showNotifications ? 'checked' : ''}>
                    <span>Show notifications</span>
                </label>
            </div>
            
            <div class="stcmt-info-section">
                <h5>Current Character Settings:</h5>
                <div class="info-block stcmt-character-info">${characterInfo}</div>
                
                <h5>Current Chat Settings:</h5>
                <div class="info-block stcmt-chat-info">${chatInfo}</div>
            </div>
        </div>
    `;
}

/**
 * Create UI elements using SillyTavern's popup system
 */
function createUI() {
    // Add menu item to extensions dropdown
    const menuItem = $(`
        <div class="list-group-item" id="stcmt-menu-item">
            <div class="flex alignItemsCenter gap5px">
                <i class="fa-solid fa-brain"></i>
                <span>Model Memory</span>
            </div>
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
                // Re-show popup to reflect changes
                setTimeout(() => showPopup(), 100);
                break;
            case POPUP_RESULT.CUSTOM2:
                await clearCharacterSettings();
                // Re-show popup to reflect changes
                setTimeout(() => showPopup(), 100);
                break;
            case POPUP_RESULT.CUSTOM3:
                await clearChatSettings();
                // Re-show popup to reflect changes
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
        
        // Update settings from checkboxes
        const enableCharacter = popupElement.querySelector('#stcmt-enable-character')?.checked ?? settings.moduleSettings.enableCharacterMemory;
        const enableChat = popupElement.querySelector('#stcmt-enable-chat')?.checked ?? settings.moduleSettings.enableChatMemory;
        const preferCharacter = popupElement.querySelector('#stcmt-prefer-character')?.checked ?? settings.moduleSettings.preferCharacterOverChat;
        const autoSave = popupElement.querySelector('#stcmt-auto-save')?.checked ?? settings.moduleSettings.autoSave;
        const showNotifications = popupElement.querySelector('#stcmt-show-notifications')?.checked ?? settings.moduleSettings.showNotifications;
        
        // Only update if values changed
        let changed = false;
        if (settings.moduleSettings.enableCharacterMemory !== enableCharacter) {
            settings.moduleSettings.enableCharacterMemory = enableCharacter;
            changed = true;
        }
        if (settings.moduleSettings.enableChatMemory !== enableChat) {
            settings.moduleSettings.enableChatMemory = enableChat;
            changed = true;
        }
        if (settings.moduleSettings.preferCharacterOverChat !== preferCharacter) {
            settings.moduleSettings.preferCharacterOverChat = preferCharacter;
            changed = true;
        }
        if (settings.moduleSettings.autoSave !== autoSave) {
            settings.moduleSettings.autoSave = autoSave;
            changed = true;
        }
        if (settings.moduleSettings.showNotifications !== showNotifications) {
            settings.moduleSettings.showNotifications = showNotifications;
            changed = true;
        }
        
        if (changed) {
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

    // ENHANCED SillyTavern event handlers
    try {
        eventSource.on(event_types.CHARACTER_SELECTED, onCharacterChangedEnhanced);
        eventSource.on(event_types.CHAT_CHANGED, onChatChangedEnhanced);
        
        // Also listen for other relevant events
        eventSource.on(event_types.CHAT_LOADED, () => {
            console.log('STChatModelTemp: Chat loaded event');
            setTimeout(() => {
                getCurrentContext();
                updateCachedSettings();
            }, 500);
        });
        
        eventSource.on(event_types.MESSAGE_SENT, () => {
            // Update context on message sent (in case auto-save is enabled)
            if (getExtensionSettings().moduleSettings.autoSave) {
                onModelSettingsChanged();
            }
        });
        
        console.log('STChatModelTemp: Event listeners registered successfully');
    } catch (e) {
        console.warn('STChatModelTemp: Could not bind to SillyTavern events:', e);
    }

    // API change handlers (debounced)
    $(document).on('change', `${SELECTORS.mainApi}, ${SELECTORS.completionSource}`, function() {
        checkApiCompatibility();
        if (isExtensionEnabled) {
            setTimeout(() => {
                getCurrentContext();
                onCharacterChanged();
            }, 100);
        }
    });

    // Model settings change handlers (debounced for performance)
    let modelChangeTimeout;
    const modelSelectors = [
        SELECTORS.modelOpenai, SELECTORS.modelClaude, SELECTORS.modelWindowai,
        SELECTORS.modelOpenrouter, SELECTORS.modelAi21, SELECTORS.modelScale,
        SELECTORS.modelGoogle, SELECTORS.modelMistralai, SELECTORS.customModelId,
        SELECTORS.modelCohere, SELECTORS.modelPerplexity, SELECTORS.modelGroq,
        SELECTORS.model01ai, SELECTORS.modelNanogpt, SELECTORS.modelDeepseek,
        SELECTORS.modelBlockentropy, SELECTORS.tempOpenai, SELECTORS.tempCounterOpenai
    ].join(', ');
    
    $(document).on('change input', modelSelectors, function() {
        clearTimeout(modelChangeTimeout);
        modelChangeTimeout = setTimeout(onModelSettingsChanged, SAVE_DEBOUNCE_TIME);
    });

    // Periodic context refresh (fallback)
    setInterval(() => {
        if (isExtensionEnabled) {
            const newContext = getCurrentContext();
            const contextChanged = JSON.stringify(newContext) !== JSON.stringify(currentContext);
            if (contextChanged) {
                console.log('STChatModelTemp: Context changed via polling');
                onCharacterChanged();
            }
        }
    }, 2000); // Check every 2 seconds
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
    if (!isExtensionEnabled || (!extensionSettings.moduleSettings.enableCharacterMemory && !extensionSettings.moduleSettings.enableChatMemory)) return;

    const context = getCurrentContext();
    if (!context.characterId) return;

    updateCachedSettings();
    applySettings();
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

    // Load character settings
    if (extensionSettings.moduleSettings.enableCharacterMemory && context.characterId) {
        const characterKey = String(context.characterId);
        currentCharacterSettings = extensionSettings.characterSettings[characterKey] || null;
    }

    // Load chat settings
    if (extensionSettings.moduleSettings.enableChatMemory && context.chatId) {
        const chatKey = String(context.chatId);
        currentChatSettings = extensionSettings.chatSettings[chatKey] || null;
    }
}

/**
 * Apply the appropriate settings based on priority
 */
function applySettings() {
    if (!isExtensionEnabled) return;

    const extensionSettings = getExtensionSettings();
    let settingsToApply = null;

    if (extensionSettings.moduleSettings.preferCharacterOverChat) {
        settingsToApply = currentCharacterSettings || currentChatSettings;
    } else {
        settingsToApply = currentChatSettings || currentCharacterSettings;
    }

    if (!settingsToApply) return;

    const selectors = getApiSelectors();
    const currentCompletionSource = $(SELECTORS.completionSource).val();

    if (settingsToApply.completionSource && settingsToApply.completionSource !== currentCompletionSource) {
        if (extensionSettings.moduleSettings.showNotifications) {
            toastr.warning(`Saved settings for ${settingsToApply.completionSource}, current source is ${currentCompletionSource}`, 'STChatModelTemp');
        }
        return;
    }

    if (settingsToApply.model && $(selectors.model).length) {
        $(selectors.model).val(settingsToApply.model).trigger('change');
    }

    if (settingsToApply.temperature !== undefined) {
        if ($(selectors.temp).length) {
            $(selectors.temp).val(settingsToApply.temperature);
        }
        if ($(selectors.tempCounter).length) {
            $(selectors.tempCounter).val(settingsToApply.temperature);
        }
    }

    if (extensionSettings.moduleSettings.showNotifications) {
        const source = extensionSettings.moduleSettings.preferCharacterOverChat && currentCharacterSettings ? 'character' : 'chat';
        toastr.info(`Applied ${source} settings for ${settingsToApply.completionSource}`, 'STChatModelTemp');
    }
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
    const completionSource = $(SELECTORS.completionSource).val();
    
    const currentModel = $(selectors.model).val();
    const currentTemp = parseFloat($(selectors.temp).val() || $(selectors.tempCounter).val() || 0.7);
    
    const settingsData = {
        model: currentModel,
        temperature: currentTemp,
        completionSource: completionSource,
        savedAt: new Date().toISOString()
    };

    if (extensionSettings.moduleSettings.enableCharacterMemory && context.characterId) {
        const characterKey = String(context.characterId);
        extensionSettings.characterSettings[characterKey] = settingsData;
        currentCharacterSettings = { ...settingsData };
        
        if (extensionSettings.moduleSettings.showNotifications) {
            toastr.success(`Character settings saved for ${completionSource}`, 'STChatModelTemp');
        }
    }

    if (extensionSettings.moduleSettings.enableChatMemory && context.chatId) {
        const chatKey = String(context.chatId);
        extensionSettings.chatSettings[chatKey] = settingsData;
        currentChatSettings = { ...settingsData };
        
        if (extensionSettings.moduleSettings.showNotifications) {
            toastr.success(`Chat settings saved for ${completionSource}`, 'STChatModelTemp');
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
    delete extensionSettings.characterSettings[characterKey];
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
    delete extensionSettings.chatSettings[chatKey];
    currentChatSettings = null;
    
    saveSettingsDebounced();
    
    if (extensionSettings.moduleSettings.showNotifications) {
        toastr.info('Chat settings cleared', 'STChatModelTemp');
    }
}

/**
 * Inject minimal CSS styles for popup-specific elements
 */
function injectStyles() {
    const css = `
        .stcmt-popup-content .stcmt-character-info,
        .stcmt-popup-content .stcmt-chat-info {
            font-family: var(--monoFontFamily);
            white-space: pre-line;
            font-size: 0.9em;
        }
        
        .stcmt-popup-content .stcmt-settings-section {
            margin: 1em 0;
        }
        
        .stcmt-popup-content .stcmt-info-section {
            margin-top: 1.5em;
        }
        
        .stcmt-popup-content .info-block {
            margin: 0.5em 0;
            padding: 0.5em;
            border-radius: 4px;
        }
        
        .stcmt-popup-content .info-block.hint {
            background-color: var(--SmartThemeBodyColor);
            border: 1px solid var(--SmartThemeBorderColor);
        }
        
        .stcmt-popup-content .info-block.warning {
            background-color: var(--ac-style-color-matchingText);
            border: 1px solid orange;
        }
        
        .stcmt-popup-content h5 {
            margin: 1em 0 0.5em 0;
            font-weight: bold;
        }
    `;

    $('<style>').prop('type', 'text/css').html(css).appendTo('head');
}

// Initialization flag to prevent duplicate calls
let hasInitialized = false;

/**
 * Initialize the extension with enhanced context detection
 */
async function init() {
    if (hasInitialized) return;
    hasInitialized = true;
    console.log('STChatModelTemp: Initializing with ST popup system');
    
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
    
    // Inject minimal CSS styles
    injectStyles();

    // Initialize extension settings using SillyTavern's system
    const settings = getExtensionSettings();
    console.log('STChatModelTemp: Settings ready:', Object.keys(settings));

    // Create UI elements
    createUI();

    // Set up event listeners
    setupEventListeners();

    // Check initial API compatibility
    checkApiCompatibility();

    // Initial context detection
    setTimeout(() => {
        getCurrentContext();
        onCharacterChanged();
        console.log('STChatModelTemp: Initial context loaded');
    }, 1000);

    console.log('STChatModelTemp: Extension loaded successfully with ST popup system');
}

// Initialize when the extension loads
$(document).ready(() => {
    if (eventSource && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, init);
    }
    
    // Fallback initialization - increased timeout slightly
    setTimeout(init, 1500);
    
    console.log('STChatModelTemp: Ready to initialize');
});