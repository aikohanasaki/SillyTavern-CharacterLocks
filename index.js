import { eventSource, event_types } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';

const MODULE_NAME = 'STChatModelTemp';
const SAVE_DEBOUNCE_TIME = 1000;

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

/**
 * Get current context using DOM inspection and cached values
 */
function getCurrentContext() {
    let characterId = null;
    let chatId = null;
    let groupId = null;
    let characterName = null;
    let chatName = null;
    
    try {
        // Method 1: Try to get from DOM elements (most reliable)
        const characterSelect = $('#rm_button_selected_ch');
        if (characterSelect.length > 0) {
            characterId = characterSelect.attr('chid');
            characterName = characterSelect.text().trim();
        }
        
        // Method 2: Try alternative character selectors
        if (!characterId) {
            const altCharSelect = $('.character_select.selected, .selected_character');
            if (altCharSelect.length > 0) {
                characterId = altCharSelect.data('chid') || altCharSelect.attr('chid');
                characterName = altCharSelect.text().trim() || altCharSelect.attr('title');
            }
        }
        
        // Method 3: Get chat info from title or URL
        const pageTitle = document.title;
        if (pageTitle && pageTitle !== 'SillyTavern') {
            chatName = pageTitle;
        }
        
        // Method 4: Try to get chat ID from URL hash or other sources
        const urlHash = window.location.hash;
        if (urlHash.includes('chat=')) {
            const chatMatch = urlHash.match(/chat=([^&]+)/);
            if (chatMatch) {
                chatId = chatMatch[1];
            }
        }
        
        // Method 5: Use cached values if available
        if (!characterId && currentContext.characterId) {
            characterId = currentContext.characterId;
            characterName = currentContext.characterName;
        }
        if (!chatId && currentContext.chatId) {
            chatId = currentContext.chatId;
        }
        
        // Generate fallback IDs if needed
        if (characterName && !characterId) {
            characterId = characterName.toLowerCase().replace(/[^a-z0-9]/g, '');
        }
        if (characterId && !chatId) {
            chatId = `chat_${characterId}_${Date.now()}`;
        }
        
    } catch (e) {
        console.warn('STChatModelTemp: Error getting context:', e);
    }
    
    const context = {
        characterId,
        chatId,
        groupId,
        characterName,
        chatName
    };
    
    // Update cache
    currentContext = { ...context };
    
    console.log('STChatModelTemp: Context resolved:', context);
    return context;
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
    const mainApi = $('#main_api').val();
    const completionSource = $('#chat_completion_source').val();
    
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
    const popup = $('#stcmt-popup');
    
    if (isExtensionEnabled) {
        popup.removeClass('extension-disabled');
        popup.find('input, button, select').prop('disabled', false);
        updateUI();
    } else {
        popup.addClass('extension-disabled');
        popup.find('input, button, select').prop('disabled', true);
        
        $('#stcmt-character-info').text('STChatModelTemp requires Chat Completion API');
        $('#stcmt-chat-info').text('STChatModelTemp requires Chat Completion API');
    }
}

// ... (rest of your existing functions remain the same: injectStyles, getApiSelectors, showPopup, hidePopup, createUI) ...

/**
 * Set up event listeners with enhanced event handling
 */
function setupEventListeners() {
    // Menu item click handler
    $(document).on('click', '#stcmt-menu-item', function() {
        showPopup();
    });
    
    // Close popup handlers
    $(document).on('click', '#stcmt-close-popup', hidePopup);
    $(document).on('click', '#shadow_popup', hidePopup);
    
    // Prevent popup from closing when clicking inside it
    $(document).on('click', '#stcmt-popup', function(e) {
        e.stopPropagation();
    });
    
    // ESC key to close popup
    $(document).on('keydown', function(e) {
        if (e.key === 'Escape' && $('#stcmt-popup').is(':visible')) {
            hidePopup();
        }
    });

    // Settings change handlers (unchanged)
    $(document).on('change', '#stcmt-enable-character', function() {
        const extensionSettings = getExtensionSettings();
        extensionSettings.moduleSettings.enableCharacterMemory = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $(document).on('change', '#stcmt-enable-chat', function() {
        const extensionSettings = getExtensionSettings();
        extensionSettings.moduleSettings.enableChatMemory = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $(document).on('change', '#stcmt-prefer-character', function() {
        const extensionSettings = getExtensionSettings();
        extensionSettings.moduleSettings.preferCharacterOverChat = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $(document).on('change', '#stcmt-auto-save', function() {
        const extensionSettings = getExtensionSettings();
        extensionSettings.moduleSettings.autoSave = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $(document).on('change', '#stcmt-notifications', function() {
        const extensionSettings = getExtensionSettings();
        extensionSettings.moduleSettings.showNotifications = $(this).prop('checked');
        saveSettingsDebounced();
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
    $(document).on('change', '#main_api, #chat_completion_source', function() {
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
    $(document).on('change input', [
        '#model_openai_select', '#model_claude_select', '#model_windowai_select', 
        '#model_openrouter_select', '#model_ai21_select', '#model_scale_select', 
        '#model_google_select', '#model_mistralai_select', '#custom_model_id', 
        '#model_cohere_select', '#model_perplexity_select', '#model_groq_select', 
        '#model_01ai_select', '#model_nanogpt_select', '#model_deepseek_select', 
        '#model_blockentropy_select', '#temp_openai', '#temp_counter_openai'
    ].join(', '), function() {
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

// ... (rest of your existing functions: onCharacterChanged, onChatChanged, etc.) ...

/**
 * Initialize the extension with enhanced context detection
 */
async function init() {
    console.log('STChatModelTemp: Initializing with enhanced event handling');
    
    // Wait for SillyTavern to be ready
    let attempts = 0;
    const maxAttempts = 20;
    
    while (attempts < maxAttempts) {
        if ($('#main_api').length > 0 && eventSource) {
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

/**
 * Alternative function that recreates getCurrentChatId locally if imports don't work
 */
function getContextFallback() {
    let characterId = null;
    let chatId = null;
    let groupId = null;
    
    // Try to access global variables directly (fallback method)
    try {
        // Access through window object as fallback
        characterId = window.this_chid;
        groupId = window.selected_group;
        
        if (window.selected_group && window.groups) {
            const group = window.groups.find(x => x.id == window.selected_group);
            chatId = group?.chat_id;
        } else if (window.this_chid !== undefined && window.characters) {
            chatId = window.characters[window.this_chid]?.chat;
        }
    } catch (e) {
        console.warn('STChatModelTemp: Could not access context variables:', e);
    }
    
    return {
        characterId,
        chatId,
        groupId
    };
}

/**
 * Robust context getter with import and fallback methods
 */
function getCurrentContextRobust() {
    // Try imports first
    try {
        return getCurrentContext();
    } catch (e) {
        console.warn('STChatModelTemp: Import method failed, trying fallback:', e);
        return getContextFallback();
    }
}

// Test function to verify context access
function testContext() {
    console.log('=== Context Test ===');
    
    // Test imported variables
    console.log('Imported this_chid:', this_chid);
    console.log('Imported characters length:', characters?.length);
    console.log('Imported selected_group:', selected_group);
    
    // Test context function
    const context = getCurrentContextRobust();
    console.log('Context result:', context);
    
    return context;
}
function getApiSelectors() {
    const completionSource = $('#chat_completion_source').val();
    
    const modelSelectorMap = {
        'openai': '#model_openai_select',
        'claude': '#model_claude_select',
        'windowai': '#model_windowai_select',
        'openrouter': '#model_openrouter_select',
        'ai21': '#model_ai21_select',
        'scale': '#model_scale_select',
        'makersuite': '#model_google_select',
        'mistralai': '#model_mistralai_select',
        'custom': '#custom_model_id',
        'cohere': '#model_cohere_select',
        'perplexity': '#model_perplexity_select',
        'groq': '#model_groq_select',
        '01ai': '#model_01ai_select',
        'nanogpt': '#model_nanogpt_select',
        'deepseek': '#model_deepseek_select',
        'blockentropy': '#model_blockentropy_select'
    };
    
    return {
        model: modelSelectorMap[completionSource] || '#model_openai_select',
        temp: '#temp_openai',
        tempCounter: '#temp_counter_openai'
    };
}

/**
 * Show the popup
 */
function showPopup() {
    $('#shadow_popup').fadeIn(200);
    $('#stcmt-popup').fadeIn(200);
    updateUI();
}

/**
 * Hide the popup
 */
function hidePopup() {
    $('#shadow_popup').fadeOut(200);
    $('#stcmt-popup').fadeOut(200);
}

/**
 * Create UI elements using SillyTavern's popup system
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
    let extensionsList = $('#extensionsMenu .list-group');
    if (extensionsList.length === 0) {
        extensionsList = $('<div class="list-group"></div>');
        $('#extensionsMenu').append(extensionsList);
    }
    extensionsList.append(menuItem);
    
    // Create the popup using SillyTavern's popup structure
    const popup = $(`
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
                        <input type="checkbox" id="stcmt-enable-character" ${extensionSettings.moduleSettings.enableCharacterMemory ? 'checked' : ''}>
                        <span>Remember per character</span>
                    </label>
                    
                    <label class="checkbox_label">
                        <input type="checkbox" id="stcmt-enable-chat" ${extensionSettings.moduleSettings.enableChatMemory ? 'checked' : ''}>
                        <span>Remember per chat</span>
                    </label>
                    
                    <label class="checkbox_label">
                        <input type="checkbox" id="stcmt-prefer-character" ${extensionSettings.moduleSettings.preferCharacterOverChat ? 'checked' : ''}>
                        <span>Prefer character settings over chat</span>
                    </label>
                    
                    <label class="checkbox_label">
                        <input type="checkbox" id="stcmt-auto-save" ${extensionSettings.moduleSettings.autoSave ? 'checked' : ''}>
                        <span>Auto-save settings</span>
                    </label>
                    
                    <label class="checkbox_label">
                        <input type="checkbox" id="stcmt-notifications" ${extensionSettings.moduleSettings.showNotifications ? 'checked' : ''}>
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
    `);

    // Add popup to body
    $('body').append(popup);
}

/**
 * Handle character change
 */
async function onCharacterChanged() {
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
async function onChatChanged() {
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
    const currentCompletionSource = $('#chat_completion_source').val();

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
    const completionSource = $('#chat_completion_source').val();
    
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
    const statusText = $('#stcmt-api-status-text');
    const completionSource = $('#chat_completion_source').val();
    const mainApi = $('#main_api').val();
    
    if (isExtensionEnabled) {
        statusText.text(`Active (${completionSource})`).css('color', 'var(--active)');
    } else {
        statusText.text(`Requires Chat Completion API (current: ${mainApi})`).css('color', 'var(--warning)');
    }

    if (!isExtensionEnabled) {
        $('#stcmt-character-info').text('Requires Chat Completion API');
        $('#stcmt-chat-info').text('Requires Chat Completion API');
        return;
    }

    const characterInfo = currentCharacterSettings 
        ? `Model: ${currentCharacterSettings.model || 'N/A'}\nTemp: ${currentCharacterSettings.temperature || 'N/A'}\nSource: ${currentCharacterSettings.completionSource || 'N/A'}\nSaved: ${new Date(currentCharacterSettings.savedAt).toLocaleString()}`
        : 'No saved settings';
    
    const chatInfo = currentChatSettings 
        ? `Model: ${currentChatSettings.model || 'N/A'}\nTemp: ${currentChatSettings.temperature || 'N/A'}\nSource: ${currentChatSettings.completionSource || 'N/A'}\nSaved: ${new Date(currentChatSettings.savedAt).toLocaleString()}`
        : 'No saved settings';
    
    $('#stcmt-character-info').text(characterInfo);
    $('#stcmt-chat-info').text(chatInfo);
}

// Initialize when the extension loads
$(document).ready(() => {
    if (eventSource && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, init);
    }
    
    // Fallback initialization
    setTimeout(init, 1000);
    
    console.log('STChatModelTemp: Ready to initialize');
});