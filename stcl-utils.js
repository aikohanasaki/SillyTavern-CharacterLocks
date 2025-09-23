// IMPORTANT: Please refer to vocab.md for terminology definitions and understanding
// of the distinction between Chat Completion (CCPrompts) and Text Completion (TCPrompts) systems.

// SillyTavern core imports - only what's needed for utility functions
import { eventSource } from '../../../../script.js';
import { moment } from '../../../../lib.js';

const MODULE_NAME = 'STCL';
const GLOBAL_DUMMY_CHARACTER_ID = 100001; // SillyTavern's dummy character ID for global settings
const SELECTORS = {
    mainApi: '#main_api',
    completionSource: '#chat_completion_source',
    menuItem: '#stcl-menu-item',
    // CCPresets (Chat Completion Presets)
    ccPreset: '#settings_preset_openai',
    // TCPresets (Text Completion Presets)
    tcPresetTextgen: '#settings_preset_textgenerationwebui',
    tcPresetKobold: '#settings_preset',
    // CCPrompts (Chat Completion Prompts)
    ccPrompts: '#completion_prompt_manager',
    // TCPrompts (Text Completion Prompts)
    tcContext: '#context_presets',
    tcInstruct: '#instruct_presets',
    tcSysprompt: '#sysprompt_select',
    // Other
    presetReasoning: '#reasoning_select',
    // NovelAI
    tcPresetNovel: '#settings_preset_novel',
    modelNovelSelect: '#model_novel_select'
};

const PRESET_SELECTOR_MAP = {
    'openai': SELECTORS.ccPreset,
    'claude': SELECTORS.ccPreset, // Claude uses OpenAI interface
    'openrouter': SELECTORS.ccPreset, // OpenRouter uses OpenAI interface
    'ai21': SELECTORS.ccPreset, // AI21 uses OpenAI interface
    'makersuite': SELECTORS.ccPreset, // Google uses OpenAI interface
    'mistralai': SELECTORS.ccPreset, // Mistral uses OpenAI interface
    'cohere': SELECTORS.ccPreset, // Cohere uses OpenAI interface
    'perplexity': SELECTORS.ccPreset, // Perplexity uses OpenAI interface
    'groq': SELECTORS.ccPreset, // Groq uses OpenAI interface
    'nanogpt': SELECTORS.ccPreset, // NanoGPT uses OpenAI interface
    'deepseek': SELECTORS.ccPreset, // DeepSeek uses OpenAI interface
    'vertexai': SELECTORS.ccPreset, // VertexAI uses OpenAI interface
    'aimlapi': SELECTORS.ccPreset, // AIMLAPI uses OpenAI interface
    'xai': SELECTORS.ccPreset, // xAI uses OpenAI interface
    'pollinations': SELECTORS.ccPreset, // Pollinations uses OpenAI interface
    'moonshot': SELECTORS.ccPreset, // Moonshot uses OpenAI interface
    'fireworks': SELECTORS.ccPreset, // Fireworks uses OpenAI interface
    'cometapi': SELECTORS.ccPreset, // CometAPI uses OpenAI interface
    'azure_openai': SELECTORS.ccPreset, // Azure OpenAI uses OpenAI interface
    'electronhub': SELECTORS.ccPreset, // ElectronHub uses OpenAI interface
    'textgenerationwebui': SELECTORS.tcPresetTextgen,
    'kobold': SELECTORS.tcPresetKobold,
    'koboldhorde': SELECTORS.tcPresetKobold,
    'novel': SELECTORS.tcPresetNovel,
    'custom': SELECTORS.tcPresetTextgen // Custom typically uses TextGen interface
};

// ===== GLOBAL STATE =====

// Lock management for thread safety
const stateLocks = {};

// Timer and event handler tracking for cleanup
const activeTimers = new Map();
const registeredEventHandlers = [];
const cleanupHandlers = [];

// ===== LOCK MANAGEMENT =====

export async function acquireLock(lockName, timeout = 5000) {
    const startTime = Date.now();
    let delay = 10;

    while (stateLocks[lockName] && (Date.now() - startTime) < timeout) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 1.2, 100); // Exponential backoff
    }

    if (stateLocks[lockName]) {
        throw new Error(`Failed to acquire lock '${lockName}' within ${timeout}ms`);
    }

    stateLocks[lockName] = true;
}

export function releaseLock(lockName) {
    stateLocks[lockName] = false;
}

// ===== TIMER MANAGEMENT =====

export function createManagedTimeout(callback, delay) {
    const timeoutId = setTimeout(() => {
        activeTimers.delete(timeoutId);
        callback();
    }, delay);
    activeTimers.set(timeoutId, 'timeout');
    return timeoutId;
}

export function createManagedInterval(callback, delay) {
    const intervalId = setInterval(callback, delay);
    activeTimers.set(intervalId, 'interval');
    return intervalId;
}

export function clearManagedTimer(timerId) {
    if (activeTimers.has(timerId)) {
        const type = activeTimers.get(timerId);
        if (type === 'timeout') {
            clearTimeout(timerId);
        } else if (type === 'interval') {
            clearInterval(timerId);
        }
        activeTimers.delete(timerId);
    }
}

// ===== CLEANUP MANAGEMENT =====

export function addCleanupHandler(handler) {
    cleanupHandlers.push(handler);
}

export function runCleanup() {
    // Clean up timers
    for (const [timerId, type] of activeTimers) {
        if (type === 'timeout') {
            clearTimeout(timerId);
        } else if (type === 'interval') {
            clearInterval(timerId);
        }
    }
    activeTimers.clear();

    // Clean up event handlers
    unregisterAllEventHandlers();

    // Run custom cleanup handlers
    for (const handler of cleanupHandlers) {
        try {
            handler();
        } catch (error) {
            console.error('STCL: Error in cleanup handler:', error);
        }
    }
    cleanupHandlers.length = 0;

    console.log('STCL: Cleanup completed');
}

// ===== UI UTILITIES =====

// showToastr removed - use toastr directly as it's universally available in ST

export function waitForElement(selector, parent = document, timeout = 2000) {
    return new Promise((resolve, reject) => {
        const element = parent.querySelector(selector);
        if (element) {
            resolve(element);
            return;
        }

        const observer = new MutationObserver((mutations, obs) => {
            const element = parent.querySelector(selector);
            if (element) {
                obs.disconnect();
                resolve(element);
            }
        });

        observer.observe(parent, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Element ${selector} not found within ${timeout}ms`));
        }, timeout);
    });
}

export function createUIToggle(toggleId, targetId, initialState = false) {
    const toggleElement = $(`#${toggleId}`);
    const targetElement = $(`#${targetId}`);

    if (!toggleElement.length || !targetElement.length) {
        console.warn(`STCL: Toggle elements not found: ${toggleId} or ${targetId}`);
        return;
    }

    // Set initial state
    toggleElement.prop('checked', initialState);
    targetElement.toggle(initialState);

    // Add event handler
    toggleElement.off('click.stcl').on('click.stcl', function() {
        const isChecked = $(this).prop('checked');
        targetElement.toggle(isChecked);
    });
}

// ===== EVENT MANAGEMENT =====

export function registerEventHandler(eventType, handler, description = '') {
    try {
        if (typeof eventSource !== 'undefined' && eventSource.on) {
            eventSource.on(eventType, handler);
            registeredEventHandlers.push({ type: eventType, handler, description });
            console.log(`STCL: Registered event handler for ${eventType} (${description})`);
            return true;
        } else {
            console.warn('STCL: eventSource not available for registration');
            return false;
        }
    } catch (error) {
        console.error(`STCL: Failed to register event handler for ${eventType}:`, error);
        return false;
    }
}

export function unregisterAllEventHandlers() {
    for (const { type, handler, description } of registeredEventHandlers) {
        try {
            if (typeof eventSource !== 'undefined' && eventSource.off) {
                eventSource.off(type, handler);
                console.log(`STCL: Unregistered event handler for ${type} (${description})`);
            }
        } catch (error) {
            console.error(`STCL: Failed to unregister event handler for ${type}:`, error);
        }
    }
    registeredEventHandlers.length = 0;
}

// ===== API DETECTION =====

export function isUsingChatCompletion() {
    const mainApi = $('#main_api').val();
    // All Chat Completion APIs use 'openai' as main_api in SillyTavern
    return mainApi === 'openai';
}

// ===== SETTINGS UTILITIES =====

/**
 * Validates API info object for settings operations
 * @param {Object} apiInfo - API information object
 * @param {string} context - Context description for error messages (e.g., 'CC', 'TC')
 * @returns {boolean} True if valid, false otherwise
 */
export function validateApiInfo(apiInfo, context = '') {
    if (!apiInfo || !apiInfo.completionSource) {
        console.warn(`STCL: Invalid API info for ${context} settings capture`);
        return false;
    }
    return true;
}

/**
 * Validates that a preset exists in the dropdown options
 * @param {jQuery} presetSelector - jQuery selector for the preset dropdown
 * @param {string} presetValue - The preset value to validate
 * @returns {boolean} True if preset exists, false otherwise
 */
export function validatePresetExists(presetSelector, presetValue) {
    return presetSelector.find(`option[value="${presetValue}"]`).length > 0;
}

/**
 * Applies a preset to a dropdown selector with validation and logging
 * @param {jQuery} presetSelector - jQuery selector for the preset dropdown
 * @param {string} presetValue - The preset value to apply
 * @param {string} presetType - Type description for logging (e.g., 'CC', 'TC')
 * @returns {Promise<boolean>} True if successfully applied, false otherwise
 */
export async function applyPreset(presetSelector, presetValue, presetType) {
    if (!presetSelector.length) {
        console.warn(`STCL: No ${presetType} preset selector found`);
        return false;
    }

    const currentPreset = presetSelector.val();
    if (currentPreset === presetValue) {
        // Already set to the correct value
        return true;
    }

    if (validatePresetExists(presetSelector, presetValue)) {
        console.log(`STCL: Applying ${presetType} preset:`, presetValue);
        presetSelector.val(presetValue).trigger('change');
        return true;
    } else {
        console.warn(`STCL: Cannot apply ${presetType} preset "${presetValue}" - preset not found in dropdown`);
        return false;
    }
}

/**
 * Creates a settings object with timestamp and completion source
 * @param {string} completionSource - The completion source identifier
 * @param {Object} additionalFields - Additional fields to include in the settings object
 * @returns {Object} Settings object with timestamp and completion source
 */
export function createTimestampedSettings(completionSource, additionalFields = {}) {
    return {
        completionSource: completionSource,
        savedAt: moment().toISOString(),
        ...additionalFields
    };
}

/**
 * Extracts and trims preset value from a jQuery selector
 * @param {jQuery} presetSelector - jQuery selector for the preset dropdown
 * @returns {string} Trimmed preset value or empty string
 */
export function extractPresetValue(presetSelector) {
    if (!presetSelector.length) {
        return '';
    }

    const presetVal = presetSelector.val();
    return presetVal ? presetVal.toString().trim() : '';
}

/**
 * Logs a warning when no preset is selected
 * @param {string} presetType - Type description for logging (e.g., 'CC', 'TC')
 */
export function logNoPresetWarning(presetType) {
    console.warn(`STCL: No ${presetType} preset selected, cannot save meaningful settings`);
}

/**
 * Logs successful settings capture
 * @param {string} presetType - Type description for logging (e.g., 'CC', 'TC')
 * @param {string} presetValue - The preset value that was captured
 * @param {number|string} promptsInfo - Information about captured prompts (count or description)
 */
export function logSettingsCapture(presetType, presetValue, promptsInfo) {
    console.log(`STCL: Captured ${presetType} settings - Preset: "${presetValue}", Prompts: ${promptsInfo}`);
}

/**
 * Logs successful settings application
 * @param {string} presetType - Type description for logging (e.g., 'CC', 'TC')
 * @param {Object} settings - The settings object being applied
 */
export function logSettingsApplication(presetType, settings) {
    console.log(`STCL: Applying ${presetType} settings:`, settings);
}

export function formatBasicSettingsInfo(settings) {
    if (!settings) return 'None';

    const parts = [];
    if (settings.completionSource) parts.push(`API: ${settings.completionSource}`);
    if (settings.ccPreset) parts.push(`Preset: ${settings.ccPreset}`);
    if (settings.tcPreset) parts.push(`Preset: ${settings.tcPreset}`);

    return parts.length > 0 ? parts.join(', ') : 'Settings available';
}

export function getEmptySettings() {
    return {
        character: null,
        group: null,
        chat: null,
        individual: null,
        groupMembers: []
    };
}

export function getDefaultSettings(completionSource, isChatCompletion) {
    const base = {
        completionSource: completionSource || 'unknown',
        savedAt: moment().toISOString()
    };

    if (isChatCompletion) {
        return {
            ...base,
            ccPreset: '',
            ccPrompts: {}
        };
    } else {
        return {
            ...base,
            tcPreset: '',
            tcPrompts: {}
        };
    }
}

// ===== DOM HELPERS =====

export function safeCheckbox(element, checked) {
    try {
        if (element && typeof element.checked !== 'undefined') {
            element.checked = checked;
        }
    } catch (error) {
        console.warn('STCL: Error setting checkbox state:', error);
    }
}

export function safeElement(selector, parent = document) {
    try {
        return parent.querySelector(selector);
    } catch (error) {
        console.warn(`STCL: Error selecting element ${selector}:`, error);
        return null;
    }
}

// ===== EXPORTS =====

export {
    MODULE_NAME, GLOBAL_DUMMY_CHARACTER_ID, SELECTORS, PRESET_SELECTOR_MAP
};