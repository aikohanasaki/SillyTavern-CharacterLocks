import { eventSource, event_types, getRequestHeaders } from '../../../../script.js';
import { getContext } from '../../../extensions.js';

const MODULE_NAME = 'STChatModelTemp';
const SAVE_DEBOUNCE_TIME = 1000;

// Supported Chat Completion sources - all available sources from SillyTavern
const SUPPORTED_COMPLETION_SOURCES = [
    'openai', 'claude', 'windowai', 'openrouter', 'ai21', 'scale', 'makersuite', 
    'mistralai', 'custom', 'cohere', 'perplexity', 'groq', '01ai', 'nanogpt', 
    'deepseek', 'blockentropy'
];

// Extension settings (stored locally)
let extensionSettings = {
    moduleSettings: {
        enableCharacterMemory: true,
        enableChatMemory: true,
        preferCharacterOverChat: true,
        autoSave: true,
        showNotifications: false
    },
    characterSettings: {}, // { characterId: { model, temperature, completionSource, savedAt } }
    chatSettings: {} // { chatId: { model, temperature, completionSource, savedAt } }
};

// Current cached settings for active character/chat
let currentCharacterSettings = null;
let currentChatSettings = null;
let isExtensionEnabled = false;

// Debounced save function
let saveTimeout = null;

/**
 * Inject CSS styles into the document
 */
function injectStyles() {
    const css = `
        #stchatmodeltemp-container {
            margin: 10px 0;
            border: 1px solid var(--SmartThemeBorderColor);
            border-radius: 5px;
            background-color: var(--SmartThemeBodyColor);
        }

        #stchatmodeltemp-container .inline-drawer-header {
            background-color: var(--SmartThemeBlurTintColor);
            padding: 10px;
            cursor: pointer;
            user-select: none;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-radius: 5px 5px 0 0;
        }

        #stchatmodeltemp-container .inline-drawer-header:hover {
            background-color: var(--SmartThemeBlurTintColorLighter);
        }

        #stchatmodeltemp-container .inline-drawer-content {
            padding: 15px;
            display: none;
        }

        #stchatmodeltemp-container .inline-drawer-icon {
            transition: transform 0.3s ease;
        }

        #stchatmodeltemp-container .inline-drawer-icon.up {
            transform: rotate(180deg);
        }

        #stcmt-character-info,
        #stcmt-chat-info {
            font-family: monospace;
            font-size: 12px;
            color: var(--SmartThemeQuoteColor);
            background-color: var(--SmartThemeQuoteBackgroundColor);
            padding: 5px;
            border-radius: 3px;
            border-left: 3px solid var(--SmartThemeQuoteColor);
        }

        #stchatmodeltemp-container .checkbox_label {
            display: flex;
            align-items: center;
            gap: 8px;
            margin: 0;
        }

        #stchatmodeltemp-container .checkbox_label input[type="checkbox"] {
            margin: 0;
        }

        #stchatmodeltemp-container .menu_button {
            flex: 1;
            padding: 6px 12px;
            font-size: 12px;
            min-height: auto;
        }

        #stchatmodeltemp-container .margin-bot-10px {
            margin-bottom: 10px;
        }

        #stchatmodeltemp-container .margin-5px {
            margin: 5px 0;
        }

        #stchatmodeltemp-container .flex-container {
            display: flex;
            flex-wrap: wrap;
        }

        #stchatmodeltemp-container .flexGap5 {
            gap: 5px;
        }

        #stchatmodeltemp-container.extension-disabled {
            opacity: 0.6;
        }

        #stchatmodeltemp-container.extension-disabled .inline-drawer-content {
            background-color: #333;
        }
    `;

    $('<style>').prop('type', 'text/css').html(css).appendTo('head');
}

// Supports ALL Chat Completion sources available in SillyTavernvas of June 8, 2025
function checkApiCompatibility() {
    const mainApi = $('#main_api').val();
    const completionSource = $('#chat_completion_source').val();
    
    const isCompatible = mainApi === 'openai' && SUPPORTED_COMPLETION_SOURCES.includes(completionSource);
    
    if (isCompatible !== isExtensionEnabled) {
        isExtensionEnabled = isCompatible;
        updateExtensionState();
        
        if (extensionSettings.moduleSettings.showNotifications) {
            if (isCompatible) {
                                        toastr.info('STChatModelTemp extension enabled for Chat Completion API', 'STChatModelTemp');
            } else {
                toastr.warning('STChatModelTemp STChatModelTemp requires Chat Completion API', 'STChatModelTemp');
            }
        }
    }
    
    return isCompatible;
}

/**
 * Update extension UI state based on compatibility
 */
function updateExtensionState() {
    const container = $('#stchatmodeltemp-container');
    const content = container.find('.inline-drawer-content');
    
    if (isExtensionEnabled) {
        container.removeClass('extension-disabled');
        content.find('input, button, select').prop('disabled', false);
        updateUI();
    } else {
        container.addClass('extension-disabled');
        content.find('input, button, select').prop('disabled', true);
        
        // Update info displays
        $('#stcmt-character-info').text('STChatModelTemp requires Chat Completion API');
        $('#stcmt-chat-info').text('STChatModelTemp requires Chat Completion API');
    }
}

/**
 * Get the correct model selector based on completion source
 * Temperature controls are shared across all completion sources
 * Model selectors found by examining the HTML forms for each completion source
 */
function getApiSelectors() {
    const completionSource = $('#chat_completion_source').val();
    
    // Map completion sources to their respective model selector IDs
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
        temp: '#temp_openai',  // Shared across all completion sources
        tempCounter: '#temp_counter_openai'  // Shared across all completion sources
    };
}

/**
 * Load settings from local settings.json file
 */
async function loadSettings() {
    try {
        const response = await fetch('/scripts/extensions/STChatModelTemp/settings.json');
        if (response.ok) {
            const data = await response.json();
            // Merge with defaults to ensure all properties exist
            extensionSettings = {
                moduleSettings: { ...extensionSettings.moduleSettings, ...data.moduleSettings },
                characterSettings: { ...data.characterSettings },
                chatSettings: { ...data.chatSettings }
            };
            console.log('STChatModelTemp: Settings loaded from file');
        } else if (response.status === 404) {
            console.log('STChatModelTemp: No settings file found, creating with defaults');
            await saveSettings(); // Create the file with defaults
        }
    } catch (error) {
        console.log('STChatModelTemp: Error loading settings, using defaults:', error);
        // Don't try to save here in case of network issues
    }
}

/**
 * Save settings to local settings.json file with backup protection
 */
async function saveSettings() {
    try {
        // First, try to create a backup if the file exists
        try {
            const backupResponse = await fetch('/scripts/extensions/STChatModelTemp/settings.json');
            if (backupResponse.ok) {
                const backupData = await backupResponse.text();
                await fetch('/api/files/write', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({
                        path: 'scripts/extensions/STChatModelTemp/settings.json.bak',
                        content: backupData
                    })
                });
            }
        } catch (backupError) {
            // Backup failed, but continue with save
            console.warn('STChatModelTemp: Could not create backup:', backupError);
        }

        // Save the current settings
        const response = await fetch('/api/files/write', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                path: 'scripts/extensions/STChatModelTemp/settings.json',
                content: JSON.stringify(extensionSettings, null, 2)
            })
        });
        
        if (!response.ok) {
            console.error('STChatModelTemp: Failed to save settings:', response.statusText);
            toastr.warning('Failed to save extension settings', 'STChatModelTemp');
        }
    } catch (error) {
        console.error('STChatModelTemp: Error saving settings:', error);
        toastr.error('Error saving extension settings', 'STChatModelTemp');
    }
}

/**
 * Debounced save function
 */
function saveSettingsDebounced() {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    
    saveTimeout = setTimeout(() => {
        saveSettings();
    }, SAVE_DEBOUNCE_TIME);
}

/**
 * Initialize the extension
 */
async function init() {
    // Inject CSS styles
    injectStyles();

    // Load extension settings from file
    await loadSettings();

    // Create UI elements
    createUI();

    // Set up event listeners
    setupEventListeners();

    // Check initial API compatibility
    checkApiCompatibility();

    console.log('STChatModelTemp extension loaded');
}

/**
 * Create UI elements for the extension
 */
async function createUI() {
    const container = $(`
        <div id="stchatmodeltemp-container" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>STChatModelTemp</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div id="stcmt-api-status" class="margin-bot-10px">
                    <small class="text-muted">
                        API Status: <span id="stcmt-api-status-text">Checking...</span>
                    </small>
                </div>
                <div class="flex-container flexGap5 margin-bot-10px">
                    <label class="checkbox_label" for="stcmt-enable-character">
                        <input type="checkbox" id="stcmt-enable-character" ${extensionSettings.moduleSettings.enableCharacterMemory ? 'checked' : ''}>
                        <span>Remember per character</span>
                    </label>
                </div>
                <div class="flex-container flexGap5 margin-bot-10px">
                    <label class="checkbox_label" for="stcmt-enable-chat">
                        <input type="checkbox" id="stcmt-enable-chat" ${extensionSettings.moduleSettings.enableChatMemory ? 'checked' : ''}>
                        <span>Remember per chat</span>
                    </label>
                </div>
                <div class="flex-container flexGap5 margin-bot-10px">
                    <label class="checkbox_label" for="stcmt-prefer-character">
                        <input type="checkbox" id="stcmt-prefer-character" ${extensionSettings.moduleSettings.preferCharacterOverChat ? 'checked' : ''}>
                        <span>Prefer character settings over chat</span>
                    </label>
                </div>
                <div class="flex-container flexGap5 margin-bot-10px">
                    <label class="checkbox_label" for="stcmt-auto-save">
                        <input type="checkbox" id="stcmt-auto-save" ${extensionSettings.moduleSettings.autoSave ? 'checked' : ''}>
                        <span>Auto-save settings</span>
                    </label>
                </div>
                <div class="flex-container flexGap5 margin-bot-10px">
                    <label class="checkbox_label" for="stcmt-notifications">
                        <input type="checkbox" id="stcmt-notifications" ${extensionSettings.moduleSettings.showNotifications ? 'checked' : ''}>
                        <span>Show notifications</span>
                    </label>
                </div>
                <div class="margin-bot-10px">
                    <strong>Current Character Settings:</strong>
                    <div id="stcmt-character-info" class="margin-5px">No character selected</div>
                </div>
                <div class="margin-bot-10px">
                    <strong>Current Chat Settings:</strong>
                    <div id="stcmt-chat-info" class="margin-5px">No chat selected</div>
                </div>
                <div class="flex-container flexGap5">
                    <button id="stcmt-save-now" class="menu_button">Save Current Settings</button>
                    <button id="stcmt-clear-character" class="menu_button">Clear Character Settings</button>
                    <button id="stcmt-clear-chat" class="menu_button">Clear Chat Settings</button>
                </div>
            </div>
        </div>
    `);

    // Add to extensions menu
    $('#extensionsMenu').append(container);

    // Make it collapsible
    $('#stchatmodeltemp-container .inline-drawer-toggle').on('click', function() {
        const content = $(this).siblings('.inline-drawer-content');
        const icon = $(this).find('.inline-drawer-icon');
        
        content.slideToggle();
        icon.toggleClass('down up');
    });
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Extension settings change handlers
    $('#stcmt-enable-character').on('change', function() {
        extensionSettings.moduleSettings.enableCharacterMemory = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#stcmt-enable-chat').on('change', function() {
        extensionSettings.moduleSettings.enableChatMemory = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#stcmt-prefer-character').on('change', function() {
        extensionSettings.moduleSettings.preferCharacterOverChat = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#stcmt-auto-save').on('change', function() {
        extensionSettings.moduleSettings.autoSave = $(this).prop('checked');
        saveSettingsDebounced();
    });

    $('#stcmt-notifications').on('change', function() {
        extensionSettings.moduleSettings.showNotifications = $(this).prop('checked');
        saveSettingsDebounced();
    });

    // Manual action buttons
    $('#stcmt-save-now').on('click', saveCurrentSettings);
    $('#stcmt-clear-character').on('click', clearCharacterSettings);
    $('#stcmt-clear-chat').on('click', clearChatSettings);

    // Character/chat change events
    eventSource.on(event_types.CHARACTER_SELECTED, onCharacterChanged);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);

    // API change events - monitor for API type changes
    $(document).on('change', '#main_api, #chat_completion_source', function() {
        checkApiCompatibility();
        if (isExtensionEnabled) {
            onCharacterChanged();
        }
    });

    // Model/temperature change events - monitor all completion source model selectors
    $(document).on('change', [
        '#model_openai_select', '#model_claude_select', '#model_windowai_select', 
        '#model_openrouter_select', '#model_ai21_select', '#model_scale_select', 
        '#model_google_select', '#model_mistralai_select', '#custom_model_id', 
        '#model_cohere_select', '#model_perplexity_select', '#model_groq_select', 
        '#model_01ai_select', '#model_nanogpt_select', '#model_deepseek_select', 
        '#model_blockentropy_select', '#temp_openai', '#temp_counter_openai'
    ].join(', '), onModelSettingsChanged);
    $(document).on('input', '#temp_openai', onModelSettingsChanged);
}

/**
 * Handle character change
 */
async function onCharacterChanged() {
    if (!isExtensionEnabled || (!extensionSettings.moduleSettings.enableCharacterMemory && !extensionSettings.moduleSettings.enableChatMemory)) return;

    const context = getContext();
    if (!context.characterId) return;

    // Load character settings
    if (extensionSettings.moduleSettings.enableCharacterMemory) {
        loadCharacterSettings(context.characterId);
    }

    // Load chat settings
    if (extensionSettings.moduleSettings.enableChatMemory) {
        loadChatSettings();
    }

    // Apply the appropriate settings
    applySettings();
    updateUI();
}

/**
 * Handle chat change
 */
async function onChatChanged() {
    if (!isExtensionEnabled || !extensionSettings.moduleSettings.enableChatMemory) return;

    loadChatSettings();
    applySettings();
    updateUI();
}

/**
 * Handle model/temperature changes
 */
function onModelSettingsChanged() {
    if (!isExtensionEnabled || !extensionSettings.moduleSettings.autoSave) return;

    // Debounce the save operation
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }

    saveTimeout = setTimeout(() => {
        saveCurrentSettings();
    }, SAVE_DEBOUNCE_TIME);
}

/**
 * Load character-specific settings
 */
function loadCharacterSettings(characterId) {
    const characterKey = String(characterId);
    currentCharacterSettings = extensionSettings.characterSettings[characterKey] || null;
}

/**
 * Load chat-specific settings
 */
function loadChatSettings() {
    const context = getContext();
    if (!context.chatId) return;

    const chatKey = String(context.chatId);
    currentChatSettings = extensionSettings.chatSettings[chatKey] || null;
}

/**
 * Apply the appropriate settings based on priority
 */
function applySettings() {
    if (!isExtensionEnabled) return;

    let settingsToApply = null;

    if (extensionSettings.moduleSettings.preferCharacterOverChat) {
        settingsToApply = currentCharacterSettings || currentChatSettings;
    } else {
        settingsToApply = currentChatSettings || currentCharacterSettings;
    }

    if (!settingsToApply) return;

    const selectors = getApiSelectors();
    const currentCompletionSource = $('#chat_completion_source').val();

    // Only apply if the completion source matches
    if (settingsToApply.completionSource && settingsToApply.completionSource !== currentCompletionSource) {
        if (extensionSettings.moduleSettings.showNotifications) {
            toastr.warning(`Saved settings for ${settingsToApply.completionSource}, current source is ${currentCompletionSource}`, 'STChatModelTemp');
        }
        return;
    }

    // Apply model setting
    if (settingsToApply.model && $(selectors.model).length) {
        $(selectors.model).val(settingsToApply.model).trigger('change');
    }

    // Apply temperature setting
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
        toastr.warning('Cannot save engine/temp settings - STChatModelTemp is only compatible with Chat Completion API', 'STChatModelTemp');
        return;
    }

    const context = getContext();
    const selectors = getApiSelectors();
    const completionSource = $('#chat_completion_source').val();
    
    // Get current model and temperature
    const currentModel = $(selectors.model).val();
    const currentTemp = parseFloat($(selectors.temp).val() || $(selectors.tempCounter).val() || 0.7);
    
    const settingsData = {
        model: currentModel,
        temperature: currentTemp,
        completionSource: completionSource,
        savedAt: new Date().toISOString()
    };

    // Save to character if enabled and character is selected
    if (extensionSettings.moduleSettings.enableCharacterMemory && context.characterId) {
        const characterKey = String(context.characterId);
        extensionSettings.characterSettings[characterKey] = settingsData;
        currentCharacterSettings = { ...settingsData };
        
        if (extensionSettings.moduleSettings.showNotifications) {
            toastr.success(`Character settings saved for ${completionSource}`, 'STChatModelTemp');
        }
    }

    // Save to chat if enabled and chat is active
    if (extensionSettings.moduleSettings.enableChatMemory && context.chatId) {
        const chatKey = String(context.chatId);
        extensionSettings.chatSettings[chatKey] = settingsData;
        currentChatSettings = { ...settingsData };
        
        if (extensionSettings.moduleSettings.showNotifications) {
            toastr.success(`Chat settings saved for ${completionSource}`, 'STChatModelTemp');
        }
    }

    // Save to file
    await saveSettings();
    updateUI();
}

/**
 * Clear character-specific settings
 */
async function clearCharacterSettings() {
    const context = getContext();
    if (!context.characterId) return;

    const characterKey = String(context.characterId);
    delete extensionSettings.characterSettings[characterKey];
    currentCharacterSettings = null;
    
    await saveSettings();
    updateUI();
    
    if (extensionSettings.moduleSettings.showNotifications) {
        toastr.info('Character settings cleared', 'STChatModelTemp');
    }
}

/**
 * Clear chat-specific settings
 */
async function clearChatSettings() {
    const context = getContext();
    if (!context.chatId) return;

    const chatKey = String(context.chatId);
    delete extensionSettings.chatSettings[chatKey];
    currentChatSettings = null;
    
    await saveSettings();
    updateUI();
    
    if (extensionSettings.moduleSettings.showNotifications) {
        toastr.info('Chat settings cleared', 'STChatModelTemp');
    }
}

/**
 * Update UI with current settings info
 */
function updateUI() {
    // Update API status
    const statusText = $('#stcmt-api-status-text');
    const completionSource = $('#chat_completion_source').val();
    const mainApi = $('#main_api').val();
    
    if (isExtensionEnabled) {
                            statusText.text(`Active (${completionSource})`).css('color', '#4CAF50');
    } else {
        statusText.text(`STChatModelTemp is only compatible with Chat Completion API, current: ${mainApi})`).css('color', '#f44336');
    }

    if (!isExtensionEnabled) {
        $('#stcmt-character-info').text('STChatModelTemp is only compatible with Chat Completion API');
        $('#stcmt-chat-info').text('STChatModelTemp is only compatible with Chat Completion API');
        return;
    }

    const characterInfo = currentCharacterSettings 
        ? `Model: ${currentCharacterSettings.model || 'N/A'}, Temp: ${currentCharacterSettings.temperature || 'N/A'}, Source: ${currentCharacterSettings.completionSource || 'N/A'} (saved ${new Date(currentCharacterSettings.savedAt).toLocaleString()})`
        : 'No saved settings';
    
    const chatInfo = currentChatSettings 
        ? `Model: ${currentChatSettings.model || 'N/A'}, Temp: ${currentChatSettings.temperature || 'N/A'}, Source: ${currentChatSettings.completionSource || 'N/A'} (saved ${new Date(currentChatSettings.savedAt).toLocaleString()})`
        : 'No saved settings';
    
    $('#stcmt-character-info').text(characterInfo);
    $('#stcmt-chat-info').text(chatInfo);
}

// Initialize when the extension loads
$(document).ready(() => {
    eventSource.on(event_types.APP_READY, init);
    if (window.SillyTavern?.isReady) {
        init();
    }
});