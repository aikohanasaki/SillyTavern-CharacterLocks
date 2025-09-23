// IMPORTANT: Please refer to vocab.md for terminology definitions and understanding
// of the distinction between Chat Completion (CCPrompts) and Text Completion (TCPrompts) systems.

// SillyTavern core imports - only what's needed for utility functions
import { eventSource } from '../../../../script.js';
import { moment } from '../../../../lib.js';
import {
    waitUntilCondition,
    sanitizeSelector,
    debounce,
    uuidv4,
    isValidUrl,
    deepMerge
} from '../../../utils.js';

const MODULE_NAME = 'STCL';

// ===== COMMON STRING CONSTANTS =====

// Error message prefixes
const ERROR_PREFIXES = {
    ERROR_SAVING: 'Error saving',
    ERROR_LOADING: 'Error loading',
    ERROR_APPLYING: 'Error applying',
    ERROR_GETTING: 'Error getting',
    ERROR_DELETING: 'Error deleting',
    CANNOT_SAVE: 'Cannot save',
    CANNOT_GET: 'Cannot get',
    CANNOT_DELETE: 'Cannot delete'
};

// Operation context strings
const OPERATION_CONTEXTS = {
    CHARACTER_SETTINGS: 'character settings',
    GROUP_SETTINGS: 'group settings',
    CHAT_SETTINGS: 'chat settings',
    GROUP_CHAT_SETTINGS: 'group chat settings',
    MODEL_BASED_SETTINGS: 'model-based settings',
    SETTINGS: 'settings',
    CURRENT_SETTINGS: 'current settings',
    UI_SETTINGS: 'UI settings'
};

// Validation error reasons
const VALIDATION_ERRORS = {
    INVALID_NAME: 'invalid name',
    INVALID_ID: 'invalid ID',
    INVALID_GROUP_ID: 'invalid group ID',
    INVALID_CHARACTER_NAME: 'invalid characterName',
    NO_METADATA: 'no chat metadata available',
    GROUP_NOT_FOUND: 'group not found'
};

// Status messages
const STATUS_MESSAGES = {
    RETRIEVED: 'Retrieved',
    SAVED: 'Saved',
    DELETED: 'Deleted',
    APPLIED: 'Applied',
    LOADED: 'Loaded',
    NO_SETTINGS_FOUND: 'No settings found',
    NO_SETTINGS_TO_DELETE: 'No settings to delete'
};
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

    // Critical section: Check and set atomically
    if (stateLocks[lockName]) {
        throw new Error(`Failed to acquire lock '${lockName}' within ${timeout}ms`);
    }

    // Set the lock immediately after check to minimize race condition window
    stateLocks[lockName] = true;
}

export function releaseLock(lockName) {
    delete stateLocks[lockName];
}

// ===== TIMER MANAGEMENT =====

export function createManagedTimeout(callback, delay) {
    if (typeof callback !== 'function') {
        console.warn('STCL: Timeout callback must be a function');
        return null;
    }
    if (typeof delay !== 'number' || delay < 0) {
        console.warn('STCL: Timeout delay must be a positive number');
        return null;
    }

    const timeoutId = setTimeout(() => {
        activeTimers.delete(timeoutId);
        callback();
    }, delay);
    activeTimers.set(timeoutId, 'timeout');
    return timeoutId;
}

/**
 * Creates a debounced function using SillyTavern's debounce utility
 * @param {Function} func - The function to debounce
 * @param {number} timeout - The debounce timeout in milliseconds
 * @returns {Function} The debounced function
 */
export function createDebouncedFunction(func, timeout = 300) {
    if (typeof func !== 'function') {
        throw new Error('STCL: First argument must be a function');
    }
    return debounce(func, timeout);
}

export function createManagedInterval(callback, delay) {
    if (typeof callback !== 'function') {
        console.warn('STCL: Interval callback must be a function');
        return null;
    }
    if (typeof delay !== 'number' || delay <= 0) {
        console.warn('STCL: Interval delay must be a positive number');
        return null;
    }

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
    if (typeof handler !== 'function') {
        console.warn('STCL: Cleanup handler must be a function');
        return;
    }
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

export async function waitForElement(selector, parent = document, timeout = 2000) {
    // Check if element already exists
    const existingElement = parent.querySelector(selector);
    if (existingElement) {
        return existingElement;
    }

    // Use ST's waitUntilCondition with proper error handling
    let foundElement = null;
    try {
        await waitUntilCondition(
            () => {
                foundElement = parent.querySelector(selector);
                return foundElement;
            },
            timeout,
            100 // Check every 100ms
        );
        return foundElement;
    } catch (error) {
        throw new Error(`Element ${selector} not found within ${timeout}ms`);
    }
}

export function createUIToggle(toggleId, targetId, initialState = false) {
    if (!toggleId || typeof toggleId !== 'string') {
        console.warn('STCL: toggleId must be a valid string');
        return;
    }
    if (!targetId || typeof targetId !== 'string') {
        console.warn('STCL: targetId must be a valid string');
        return;
    }

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
    if (typeof handler !== 'function') {
        console.warn('STCL: Event handler must be a function');
        return false;
    }

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
    try {
        if (typeof $ === 'undefined') {
            console.warn('STCL: jQuery not available for API detection');
            return false;
        }
        const mainApi = $('#main_api').val();
        // All Chat Completion APIs use 'openai' as main_api in SillyTavern
        return mainApi === 'openai';
    } catch (error) {
        console.warn('STCL: Error detecting chat completion API:', error);
        return false;
    }
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
    // Use safer attribute selection to prevent XSS while preserving special characters
    return presetSelector.find('option').filter(function() {
        return $(this).attr('value') === presetValue;
    }).length > 0;
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
    if (!presetVal) {
        return '';
    }

    // Handle multi-select case where val() returns an array
    if (Array.isArray(presetVal)) {
        // For multi-select, return the first selected value or empty string
        return presetVal.length > 0 ? presetVal[0].toString().trim() : '';
    }

    return presetVal.toString().trim();
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

// ===== GENERIC CRUD UTILITIES =====

/**
 * Generic CRUD utilities to eliminate duplicate code patterns
 */

// CRUD operation types
const CRUD_OPERATIONS = {
    GET: 'get',
    SET: 'set',
    DELETE: 'delete',
    UPDATE: 'update'
};

// Entity types
const ENTITY_TYPES = {
    CHARACTER: 'character',
    GROUP: 'group',
    CHAT: 'chat',
    INDIVIDUAL: 'individual'
};

/**
 * Logs CRUD operations with consistent format
 * @param {string} operation - The CRUD operation (get, set, delete, update)
 * @param {string} entityType - The entity type (character, group, chat, individual)
 * @param {string} entityName - The entity name/identifier
 * @param {boolean} success - Whether the operation was successful
 * @param {string} reason - Optional reason for failure
 */
export function logCrudOperation(operation, entityType, entityName, success, reason = '') {
    const action = operation.charAt(0).toUpperCase() + operation.slice(1);

    if (success) {
        if (operation === CRUD_OPERATIONS.GET) {
            console.log(`STCL: Retrieved ${entityType} settings for "${entityName}"`);
        } else if (operation === CRUD_OPERATIONS.SET) {
            console.log(`STCL: Saved ${entityType} settings for "${entityName}"`);
        } else if (operation === CRUD_OPERATIONS.DELETE) {
            console.log(`STCL: Deleted ${entityType} settings for "${entityName}"`);
        } else {
            console.log(`STCL: ${action} ${entityType} settings for "${entityName}"`);
        }
    } else {
        if (operation === CRUD_OPERATIONS.GET && reason === 'not_found') {
            console.log(`STCL: No settings found for ${entityType} "${entityName}"`);
        } else {
            const reasonText = reason ? ` - ${reason}` : '';
            console.warn(`STCL: Cannot ${operation} ${entityType} settings${reasonText}`);
        }
    }
}

/**
 * Validates entity identifier for CRUD operations
 * @param {string} entityId - The entity identifier to validate
 * @param {string} entityType - The entity type for error messages
 * @returns {boolean} True if valid, false otherwise
 */
export function validateEntityId(entityId, entityType) {
    if (!entityId || typeof entityId !== 'string' || !entityId.trim()) {
        logCrudOperation(CRUD_OPERATIONS.GET, entityType, entityId || 'undefined', false, 'invalid identifier');
        return false;
    }
    return true;
}

/**
 * Generic getter for entity settings
 * @param {Object} userSettings - The user settings object
 * @param {string} entityType - The entity type (character, group, chat, individual)
 * @param {string} entityId - The entity identifier
 * @param {Function} normalizer - Optional function to normalize the entity ID
 * @returns {Object|null} Settings object or null if not found
 */
export function getEntitySettings(userSettings, entityType, entityId, normalizer = null) {
    if (!validateEntityId(entityId, entityType)) {
        return null;
    }

    const normalizedId = normalizer ? normalizer(entityId) : entityId;
    const settingsKey = `${entityType}Settings`;
    const settings = userSettings[settingsKey]?.[normalizedId] || null;

    logCrudOperation(CRUD_OPERATIONS.GET, entityType, normalizedId, !!settings, settings ? '' : 'not_found');
    return settings;
}

/**
 * Generic setter for entity settings
 * @param {Object} userSettings - The user settings object to modify
 * @param {string} entityType - The entity type (character, group, chat, individual)
 * @param {string} entityId - The entity identifier
 * @param {Object} settings - The settings to save
 * @param {Function} normalizer - Optional function to normalize the entity ID
 * @returns {boolean} True if successful, false otherwise
 */
export function setEntitySettings(userSettings, entityType, entityId, settings, normalizer = null) {
    if (!validateEntityId(entityId, entityType)) {
        return false;
    }

    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        logCrudOperation(CRUD_OPERATIONS.SET, entityType, entityId, false, 'invalid settings object');
        return false;
    }

    const normalizedId = normalizer ? normalizer(entityId) : entityId;
    const settingsKey = `${entityType}Settings`;

    // Ensure the settings container exists
    if (!userSettings[settingsKey]) {
        userSettings[settingsKey] = {};
    }

    userSettings[settingsKey][normalizedId] = settings;
    logCrudOperation(CRUD_OPERATIONS.SET, entityType, normalizedId, true);
    return true;
}

/**
 * Generic deleter for entity settings
 * @param {Object} userSettings - The user settings object to modify
 * @param {string} entityType - The entity type (character, group, chat, individual)
 * @param {string} entityId - The entity identifier
 * @param {Function} normalizer - Optional function to normalize the entity ID
 * @returns {boolean} True if something was deleted, false otherwise
 */
export function deleteEntitySettings(userSettings, entityType, entityId, normalizer = null) {
    if (!validateEntityId(entityId, entityType)) {
        return false;
    }

    const normalizedId = normalizer ? normalizer(entityId) : entityId;
    const settingsKey = `${entityType}Settings`;

    if (!userSettings[settingsKey] || !userSettings[settingsKey][normalizedId]) {
        logCrudOperation(CRUD_OPERATIONS.DELETE, entityType, normalizedId, false, 'not found');
        return false;
    }

    delete userSettings[settingsKey][normalizedId];
    logCrudOperation(CRUD_OPERATIONS.DELETE, entityType, normalizedId, true);
    return true;
}

/**
 * Generic checker to see if entity has settings
 * @param {Object} userSettings - The user settings object
 * @param {string} entityType - The entity type (character, group, chat, individual)
 * @param {string} entityId - The entity identifier
 * @param {Function} normalizer - Optional function to normalize the entity ID
 * @returns {boolean} True if entity has settings, false otherwise
 */
export function hasEntitySettings(userSettings, entityType, entityId, normalizer = null) {
    if (!validateEntityId(entityId, entityType)) {
        return false;
    }

    const normalizedId = normalizer ? normalizer(entityId) : entityId;
    const settingsKey = `${entityType}Settings`;
    return !!(userSettings[settingsKey] && userSettings[settingsKey][normalizedId]);
}

/**
 * Generic application logging utilities
 */

/**
 * Logs settings operations with consistent format
 * @param {string} action - The action being performed (loading, applying, saving, etc.)
 * @param {string} context - The context description
 * @param {Object} data - Optional data to log
 */
export function logSettingsOperation(action, context, data = null) {
    if (data) {
        console.log(`STCL: ${action} ${context}:`, data);
    } else {
        console.log(`STCL: ${action} ${context}`);
    }
}

/**
 * Logs context/model operations
 * @param {string} operation - The operation being performed
 * @param {string} details - Additional details
 */
export function logContextOperation(operation, details) {
    console.log(`STCL: ${operation}${details ? ` - ${details}` : ''}`);
}

/**
 * Logs export/import operations
 * @param {string} operation - export or import
 * @param {string} type - The type of data (templates, rules, etc.)
 * @param {string} source - Optional source description
 */
export function logDataOperation(operation, type, source = '') {
    const sourceText = source ? ` from ${source}` : '';
    console.log(`STCL: ${operation} ${type}${sourceText}`);
}

/**
 * Generic settings formatting utilities
 */

/**
 * Formats settings for display with consistent structure
 * @param {Object} settings - The settings object
 * @param {string} completionSource - The completion source/API
 * @param {boolean|string} saved - Whether these are saved settings or save timestamp
 * @param {Object} formatConfig - Configuration for formatting
 * @returns {string} Formatted settings display
 */
export function formatSettings(settings, completionSource, saved, formatConfig) {
    if (!settings) return 'None';
    if (!formatConfig || typeof formatConfig !== 'object') {
        return 'Invalid format configuration';
    }

    const lines = [];

    // Add API/Profile line
    const apiLabel = formatConfig.apiLabel || 'API';
    lines.push(`${apiLabel}: ${completionSource}`);

    // Add preset line
    const presetValue = settings[formatConfig.presetField] || formatConfig.defaultPreset || 'Default';
    const presetLabel = formatConfig.presetLabel || 'Preset';
    lines.push(`${presetLabel}: ${presetValue}`);

    // Add prompts line
    const promptsDisplay = (formatConfig.formatPrompts && typeof formatConfig.formatPrompts === 'function') ?
        formatConfig.formatPrompts(settings) : 'Default';
    const promptsLabel = formatConfig.promptsLabel || 'Prompts';
    lines.push(`${promptsLabel}: ${promptsDisplay}`);

    // Add status/saved line
    if (formatConfig.includeStatus !== false) {
        const statusText = (formatConfig.formatStatus && typeof formatConfig.formatStatus === 'function') ?
            formatConfig.formatStatus(saved) :
            (saved ? (typeof saved === 'boolean' ? 'Status: Saved ✓' : `Saved: ${saved}`) : 'Status: Current UI State');
        lines.push(statusText);
    }

    return lines.join('\n');
}

/**
 * Chat Completion specific prompt formatter
 * @param {Object} settings - Settings object with ccPrompts
 * @returns {string} Formatted prompts description
 */
export function formatCCPrompts(settings) {
    if (!settings.ccPrompts || typeof settings.ccPrompts !== 'object') {
        return 'Default';
    }

    const promptCount = settings.ccPrompts.prompts ? settings.ccPrompts.prompts.length : 0;
    const orderCount = settings.ccPrompts.prompt_order ? settings.ccPrompts.prompt_order.length : 0;

    return (promptCount > 0 || orderCount > 0) ?
        `${promptCount} prompts, ${orderCount} order entries` : 'Default';
}

/**
 * Text Completion specific prompt formatter
 * @param {Object} settings - Settings object with tcPrompts
 * @returns {string} Formatted prompts description
 */
export function formatTCPrompts(settings) {
    if (!settings.tcPrompts || typeof settings.tcPrompts !== 'object') {
        return 'Default';
    }

    const tcPromptsDesc = [];
    if (settings.tcPrompts.contextTemplate) tcPromptsDesc.push('Context');
    if (settings.tcPrompts.instructPreset) tcPromptsDesc.push('Instruct');
    if (settings.tcPrompts.systemPrompt) tcPromptsDesc.push('SysPrompt');

    return tcPromptsDesc.length > 0 ? tcPromptsDesc.join('+') : 'Default';
}

/**
 * Standardized error handling utilities
 */

/**
 * Logs and handles standard operation errors
 * @param {string} operation - The operation that failed
 * @param {string} context - Additional context about the operation
 * @param {Error} error - The error object
 * @param {boolean} silent - Whether to suppress console output
 * @returns {boolean} Always returns false for convenience
 */
export function handleOperationError(operation, context, error, silent = false) {
    if (!silent) {
        console.error(`STCL: ${operation}${context ? ` ${context}` : ''}:`, error);
    }
    return false;
}

/**
 * Logs warnings for missing/invalid data
 * @param {string} operation - The operation being attempted
 * @param {string} reason - The reason for the warning
 * @param {string} context - Optional additional context
 */
export function logWarning(operation, reason, context = '') {
    const contextText = context ? ` - ${context}` : '';
    console.warn(`STCL: ${operation}${contextText}: ${reason}`);
}

/**
 * Generic try-catch wrapper for async operations
 * @param {Function} operation - The async operation to execute
 * @param {string} operationName - Name of the operation for error logging
 * @param {*} fallbackValue - Value to return on error
 * @returns {Promise<*>} Result of operation or fallback value
 */
export async function safeAsyncOperation(operation, operationName, fallbackValue = null) {
    if (typeof operation !== 'function') {
        handleOperationError('Invalid operation type for', operationName, new Error('Operation must be a function'));
        return fallbackValue;
    }

    try {
        return await operation();
    } catch (error) {
        handleOperationError('Error in', operationName, error);
        return fallbackValue;
    }
}

/**
 * Generic try-catch wrapper for sync operations
 * @param {Function} operation - The operation to execute
 * @param {string} operationName - Name of the operation for error logging
 * @param {*} fallbackValue - Value to return on error
 * @returns {*} Result of operation or fallback value
 */
export function safeSyncOperation(operation, operationName, fallbackValue = null) {
    if (typeof operation !== 'function') {
        handleOperationError('Invalid operation type for', operationName, new Error('Operation must be a function'));
        return fallbackValue;
    }

    try {
        return operation();
    } catch (error) {
        handleOperationError('Error in', operationName, error);
        return fallbackValue;
    }
}

// Export constants for use by other modules
export {
    CRUD_OPERATIONS,
    ENTITY_TYPES,
    ERROR_PREFIXES,
    OPERATION_CONTEXTS,
    VALIDATION_ERRORS,
    STATUS_MESSAGES
};

// ===== DOM HELPERS =====

export function safeCheckbox(element, checked) {
    try {
        if (element && 'checked' in element) {
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

// Export SillyTavern utilities for extension use
export {
    // Our constants
    MODULE_NAME,
    GLOBAL_DUMMY_CHARACTER_ID,
    SELECTORS,
    PRESET_SELECTOR_MAP
};