import { eventSource, event_types } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const MODULE_NAME = 'STChatModelTemp';
const SAVE_DEBOUNCE_TIME = 1000;

// Centralized DOM selectors - single source of truth
const SELECTORS = {
    mainApi: '#main_api',
    completionSource: '#chat_completion_source',
    characterSelect: '#rm_button_selected_ch',
    altCharacterSelect: '.character_select.selected, .selected_character',
    popup: '#stcmt-popup',
    shadowPopup: '#shadow_popup',
    popupContent: '#stcmt-popup-content',
    closePopup: '#stcmt-close-popup',
    menuItem: '#stcmt-menu-item',
    extensionsMenu: '#extensionsMenu .list-group',
    apiStatusText: '#stcmt-api-status-text',
    characterInfo: '#stcmt-character-info',
    chatInfo: '#stcmt-chat-info',
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
        updateExtensionState();
        
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
 * Update extension UI state based on compatibility
 */
function updateExtensionState() {
    const popup = $(SELECTORS.popup);
    
    if (isExtensionEnabled) {
        popup.removeClass('extension-disabled');
        popup.find('input, button, select').prop('disabled', false);
        updateUI();
    } else {
        popup.addClass('extension-disabled');
        popup.find('input, button, select').prop('disabled', true);
        
        $(SELECTORS.characterInfo).text('STChatModelTemp requires Chat Completion API');
        $(SELECTORS.chatInfo).text('STChatModelTemp requires Chat Completion API');
    }
}

/**
 * Generate popup HTML template - separated for better readability
 */
function getPopupHtml(settings) {
    return `
        <div id="stcmt-popup" style="display: none; z-index: 9999; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); 
             background-color: var(--SmartThemeBlurTintColor); border: 1px solid var(--SmartThemeBorderColor); 
             border-radius: 10px; backdrop-filter: blur(var(--SmartThemeBlurStrength)); 
             -webkit-backdrop-filter: blur(var(--SmartThemeBlurStrength)); box-shadow: 0px 0px 14px var(--black70a); 
             max-width: 500px; max-height: 80vh; width: 90vw;">
            <div id="stcmt-popup-holder" style="display: flex; flex-direction: column; height: 100%; padding: 20px; overflow: hidden;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3 style="margin: 0; color: var(--SmartThemeBodyColor);">🧠 Model Memory Settings</h3>
                    <div id="stcmt-close-popup" style="cursor: pointer; font-size: 20px; color: var(--SmartThemeBodyColor); opacity: 0.7;">✕</div>
                </div>
                
                <div id="stcmt-popup-content" style="flex-grow: 1; overflow-y: auto;">
                    <div id="stcmt-api-status">
                        <small class="text_muted">
                            API Status: <span id="stcmt-api-status-text">Checking...</span>
                        </small>
                    </div>
                    
                    <label class="checkbox_label">
                        <input type="checkbox" class="stcmt-setting" data-setting="enableCharacterMemory" ${settings.moduleSettings.enableCharacterMemory ? 'checked' : ''}>
                        <span>Remember per character</span>
                    </label>
                    
                    <label class="checkbox_label">
                        <input type="checkbox" class="stcmt-setting" data-setting="enableChatMemory" ${settings.moduleSettings.enableChatMemory ? 'checked' : ''}>
                        <span>Remember per chat</span>
                    </label>
                    
                    <label class="checkbox_label">
                        <input type="checkbox" class="stcmt-setting" data-setting="preferCharacterOverChat" ${settings.moduleSettings.preferCharacterOverChat ? 'checked' : ''}>
                        <span>Prefer character settings over chat</span>
                    </label>
                    
                    <label class="checkbox_label">
                        <input type="checkbox" class="stcmt-setting" data-setting="autoSave" ${settings.moduleSettings.autoSave ? 'checked' : ''}>
                        <span>Auto-save settings</span>
                    </label>
                    
                    <label class="checkbox_label">
                        <input type="checkbox" class="stcmt-setting" data-setting="showNotifications" ${settings.moduleSettings.showNotifications ? 'checked' : ''}>
                        <span>Show notifications</span>
                    </label>
                    
                    <h5>Current Character Settings:</h5>
                    <div id="stcmt-character-info">No character selected</div>
                    
                    <h5>Current Chat Settings:</h5>
                    <div id="stcmt-chat-info">No chat selected</div>
                </div>
                
                <div style="display: flex; gap: 10px; margin-top: 15px; flex-wrap: wrap; justify-content: center;">
                    <button id="stcmt-save-now" class="menu_button">💾 Save Current</button>
                    <button id="stcmt-clear-character" class="menu_button">🗑️ Clear Character</button>
                    <button id="stcmt-clear-chat" class="menu_button">🗑️ Clear Chat</button>
                </div>
            </div>
        </div>
    `;
}

/**
 * Create UI elements using SillyTavern's popup system - now cleaner
 */
function createUI() {
    const extensionSettings = getExtensionSettings();
    
    // Add menu item to extensions dropdown
    const menuItem = $(`
        <div class="list-group-item" id="stcmt-menu-item">
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
    
    // Create the popup using separated HTML template
    const popupHtml = getPopupHtml(extensionSettings);
    $('body').append(popupHtml);
}

/**
 * Set up event listeners - now with consolidated checkbox handling
 */
function setupEventListeners() {
    // Menu item click handler
    $(document).on('click', SELECTORS.menuItem, function() {
        showPopup();
    });
    
    // Close popup handlers
    $(document).on('click', SELECTORS.closePopup, hidePopup);
    $(document).on('click', SELECTORS.shadowPopup, hidePopup);
    
    // Prevent popup from closing when clicking inside it
    $(document).on('click', SELECTORS.popup, function(e) {
        e.stopPropagation();
    });
    
    // ESC key to close popup
    $(document).on('keydown', function(e) {
        if (e.key === 'Escape' && $(SELECTORS.popup).is(':visible')) {
            hidePopup();
        }
    });

    // Consolidated settings change handler using data attributes
    $(document).on('change', '.stcmt-setting', function() {
        const settingName = $(this).data('setting');
        const isChecked = $(this).prop('checked');
        const extensionSettings = getExtensionSettings();

        if (extensionSettings.moduleSettings.hasOwnProperty(settingName)) {
            extensionSettings.moduleSettings[settingName] = isChecked;
            saveSettingsDebounced();
        }
    });

    // Button handlers
    $(document).on('click', '#stcmt-save-now', saveCurrentSettings);
    $(document).on('click', '#stcmt-clear-character', clearCharacterSettings);
    $(document).on('click', '#stcmt-clear-chat', clearChatSettings);

    // ENHANCED SillyTavern event handlers
    try {
        eventSource.on(event_types.CHARACTER_SELECTED, onCharacterChangedEnhanced);
        eventSource.on(event_types.CHAT_CHANGED, onChatChangedEnhanced);
        
        // Also listen for other relevant events
        eventSource.on(event_types.CHAT_LOADED, () => {
            console.log('STChatModelTemp: Chat loaded event');
            setTimeout(() => {
                getCurrentContext();
                updateUI();
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
 * Show the popup
 */
function showPopup() {
    $(SELECTORS.shadowPopup).fadeIn(200);
    $(SELECTORS.popup).fadeIn(200);
    updateUI();
}

/**
 * Hide the popup
 */
function hidePopup() {
    $(SELECTORS.shadowPopup).fadeOut(200);
    $(SELECTORS.popup).fadeOut(200);
}

/**
 * Handle character change
 */
function onCharacterChanged() {
    const extensionSettings = getExtensionSettings();
    if (!isExtensionEnabled || (!extensionSettings.moduleSettings.enableCharacterMemory && !extensionSettings.moduleSettings.enableChatMemory)) return;

    const context = getCurrentContext();
    if (!context.characterId) return;

    if (extensionSettings.moduleSettings.enableCharacterMemory) {
        loadCharacterSettings(context.characterId);
    }

    if (extensionSettings.moduleSettings.enableChatMemory) {
        loadChatSettings();
    }

    applySettings();
    updateUI();
}

/**
 * Handle chat change
 */
function onChatChanged() {
    const extensionSettings = getExtensionSettings();
    if (!isExtensionEnabled || !extensionSettings.moduleSettings.enableChatMemory) return;

    loadChatSettings();
    applySettings();
    updateUI();
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
 * Load character-specific settings
 */
function loadCharacterSettings(characterId) {
    const extensionSettings = getExtensionSettings();
    const characterKey = String(characterId);
    currentCharacterSettings = extensionSettings.characterSettings[characterKey] || null;
}

/**
 * Load chat-specific settings
 */
function loadChatSettings() {
    const extensionSettings = getExtensionSettings();
    const context = getCurrentContext();
    if (!context.chatId) return;

    const chatKey = String(context.chatId);
    currentChatSettings = extensionSettings.chatSettings[chatKey] || null;
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
function saveCurrentSettings() {
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
    updateUI();
}

/**
 * Clear character-specific settings
 */
function clearCharacterSettings() {
    const extensionSettings = getExtensionSettings();
    const context = getCurrentContext();
    if (!context.characterId) return;

    const characterKey = String(context.characterId);
    delete extensionSettings.characterSettings[characterKey];
    currentCharacterSettings = null;
    
    saveSettingsDebounced();
    updateUI();
    
    if (extensionSettings.moduleSettings.showNotifications) {
        toastr.info('Character settings cleared', 'STChatModelTemp');
    }
}

/**
 * Clear chat-specific settings
 */
function clearChatSettings() {
    const extensionSettings = getExtensionSettings();
    const context = getCurrentContext();
    if (!context.chatId) return;

    const chatKey = String(context.chatId);
    delete extensionSettings.chatSettings[chatKey];
    currentChatSettings = null;
    
    saveSettingsDebounced();
    updateUI();
    
    if (extensionSettings.moduleSettings.showNotifications) {
        toastr.info('Chat settings cleared', 'STChatModelTemp');
    }
}

/**
 * Update UI with current settings info
 */
function updateUI() {
    const statusText = $(SELECTORS.apiStatusText);
    const completionSource = $(SELECTORS.completionSource).val();
    const mainApi = $(SELECTORS.mainApi).val();
    
    if (isExtensionEnabled) {
        statusText.text(`Active (${completionSource})`).css('color', 'var(--active)');
    } else {
        statusText.text(`Requires Chat Completion API (current: ${mainApi})`).css('color', 'var(--warning)');
    }

    if (!isExtensionEnabled) {
        $(SELECTORS.characterInfo).text('Requires Chat Completion API');
        $(SELECTORS.chatInfo).text('Requires Chat Completion API');
        return;
    }

    const characterInfo = currentCharacterSettings 
        ? `Model: ${currentCharacterSettings.model || 'N/A'}\nTemp: ${currentCharacterSettings.temperature || 'N/A'}\nSource: ${currentCharacterSettings.completionSource || 'N/A'}\nSaved: ${new Date(currentCharacterSettings.savedAt).toLocaleString()}`
        : 'No saved settings';
    
    const chatInfo = currentChatSettings 
        ? `Model: ${currentChatSettings.model || 'N/A'}\nTemp: ${currentChatSettings.temperature || 'N/A'}\nSource: ${currentChatSettings.completionSource || 'N/A'}\nSaved: ${new Date(currentChatSettings.savedAt).toLocaleString()}`
        : 'No saved settings';
    
    $(SELECTORS.characterInfo).text(characterInfo);
    $(SELECTORS.chatInfo).text(chatInfo);
}

/**
 * Inject minimal CSS styles for popup-specific elements
 */
function injectStyles() {
    const css = `
        #stcmt-character-info,
        #stcmt-chat-info {
            font-family: var(--monoFontFamily);
            font-size: calc(var(--mainFontSize) * 0.85);
            color: var(--SmartThemeEmColor);
            background-color: var(--black30a);
            padding: 8px;
            border-radius: 5px;
            border-left: 3px solid var(--SmartThemeQuoteColor);
            margin: 5px 0;
            word-break: break-all;
            white-space: pre-line;
        }

        #stcmt-popup.extension-disabled #stcmt-popup-content {
            opacity: 0.6;
        }

        #stcmt-api-status {
            font-size: calc(var(--mainFontSize) * 0.9);
            padding: 5px 0;
            text-align: center;
            margin-bottom: 10px;
        }

        #stcmt-api-status-text {
            font-weight: 600;
        }

        #stcmt-popup-content .checkbox_label {
            margin: 8px 0;
        }

        #stcmt-popup-content h5 {
            margin-top: 15px;
            margin-bottom: 5px;
            color: var(--SmartThemeQuoteColor);
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
    console.log('STChatModelTemp: Initializing with enhanced event handling');
    
    // Wait for SillyTavern to be ready
    let attempts = 0;
    const maxAttempts = 20;
    
    while (attempts < maxAttempts) {
        if ($(SELECTORS.mainApi).length > 0 && eventSource) {
            console.log('STChatModelTemp: SillyTavern UI detected');
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

    console.log('STChatModelTemp: Extension loaded successfully');
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