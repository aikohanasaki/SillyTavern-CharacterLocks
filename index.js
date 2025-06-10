import { eventSource, event_types, this_chid, characters } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { selected_group, groups } from '../../../../script.js';

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

/**
 * Get current context information using SillyTavern globals
 */
function getCurrentContext() {
    let characterId = null;
    let chatId = null;
    let groupId = null;
    
    // Get character ID (this_chid is exported from script.js)
    if (this_chid !== undefined && this_chid !== null) {
        characterId = this_chid;
    }
    
    // Get chat ID using the same logic as the exported getCurrentChatId function
    if (selected_group) {
        // For group chats
        groupId = selected_group;
        const group = groups.find(x => x.id == selected_group);
        chatId = group?.chat_id;
    } else if (this_chid !== undefined) {
        // For character chats
        chatId = characters[this_chid]?.chat;
    }
    
    return {
        characterId,
        chatId,
        groupId
    };
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
 * Initialize the extension
 */
async function init() {
    console.log('STChatModelTemp: Initializing with SillyTavern settings system');
    
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

    console.log('STChatModelTemp: Extension loaded successfully');
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
 * Set up event listeners with debouncing
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

    // Settings change handlers
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

    // SillyTavern event handlers
    eventSource.on(event_types.CHARACTER_SELECTED, onCharacterChanged);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    // API change handlers (debounced)
    $(document).on('change', '#main_api, #chat_completion_source', function() {
        checkApiCompatibility();
        if (isExtensionEnabled) {
            setTimeout(onCharacterChanged, 100);
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

console.log('STChatModelTemp Context Test:', getCurrentContextRobust());

// Initialize when the extension loads
$(document).ready(() => {
    eventSource.on(event_types.APP_READY, init);
    if (window.SillyTavern?.isReady) {
        init();
    }
});