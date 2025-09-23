// IMPORTANT: Please refer to vocab.md for terminology definitions and understanding
// of the distinction between Chat Completion (CCPrompts) and Text Completion (TCPrompts) systems.

// This file contains all Text Completion (TC) related functionality
// Handles TC prompt management, settings, and application

// ===== IMPORTS FROM SILLYTAVERN CORE =====
import { power_user } from '../../../power-user.js';
import { debounce } from '../../../utils.js';
import { DOMPurify } from '../../../../lib.js';

// ===== IMPORTS FROM EXTENSION UTILS =====
import {
    SELECTORS,
    PRESET_SELECTOR_MAP,
    validateApiInfo,
    applyPreset,
    createTimestampedSettings,
    extractPresetValue,
    logNoPresetWarning,
    logSettingsCapture,
    logSettingsApplication,
    formatSettings,
    formatTCPrompts
} from './stcl-utils.js';

// ===== HELPER FUNCTIONS =====

// This function will be set by the main module
let getCurrentApiInfo = function() {
    throw new Error('getCurrentApiInfo must be provided by the main module');
};

/**
 * Sets the getCurrentApiInfo function (called by main module)
 * @param {Function} fn - The function to get current API info
 */
export function setGetCurrentApiInfo(fn) {
    if (typeof fn !== 'function') {
        throw new Error('setGetCurrentApiInfo requires a function parameter');
    }
    getCurrentApiInfo = fn;
}

/**
 * Gets the current preset selector based on API type
 * @returns {string} jQuery selector for the current preset dropdown
 */
async function getCurrentPresetSelector() {
    try {
        const apiInfo = await getCurrentApiInfo();
        if (!apiInfo || typeof apiInfo !== 'object' || !apiInfo.completionSource) {
            console.warn('STCL: Invalid apiInfo received in getCurrentPresetSelector');
            return SELECTORS.ccPreset;
        }
        return PRESET_SELECTOR_MAP[apiInfo.completionSource] || SELECTORS.ccPreset;
    } catch (error) {
        console.error('STCL: Error getting current preset selector:', error);
        return SELECTORS.ccPreset;
    }
}

// ===== TEXT COMPLETION FUNCTIONS =====

/**
 * Captures the current state of Text Completion prompts
 * @returns {Object} The current TCPrompt state
 */
function tcGetPromptState() {
    let tcPrompts = {};
    let promptsCount = 0;

    /**
     * Helper function to safely extract and validate value from selector
     * @param {string} selectorKey - The key in SELECTORS object
     * @returns {string|null} Cleaned value or null
     */
    function safeExtractValue(selectorKey) {
        if (!selectorKey || typeof selectorKey !== 'string') {
            console.warn('STCL: Invalid selector key provided');
            return null;
        }

        if (!SELECTORS || typeof SELECTORS !== 'object') {
            console.warn('STCL: SELECTORS object not available');
            return null;
        }

        if (!SELECTORS[selectorKey]) {
            console.warn(`STCL: Selector ${selectorKey} not defined`);
            return null;
        }

        if (typeof $ !== 'function') {
            console.warn('STCL: jQuery not available');
            return null;
        }

        const selector = $(SELECTORS[selectorKey]);
        if (selector.length === 0) {
            return null;
        }

        const value = selector.val();
        if (!value || typeof value !== 'string') {
            return null;
        }

        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    try {
        // Validate power_user availability
        if (!power_user || typeof power_user !== 'object') {
            console.warn('STCL: power_user not available');
            return tcPrompts;
        }

        // Context Template (only if available and has value)
        const contextVal = safeExtractValue('tcContext');
        if (contextVal) {
            tcPrompts.contextTemplate = contextVal;
            promptsCount++;
        }

        // Instruct Mode (only if enabled and has value)
        if (power_user.instruct?.enabled) {
            const instructVal = safeExtractValue('tcInstruct');
            if (instructVal) {
                tcPrompts.instructPreset = instructVal;
                promptsCount++;
            }
        }

        // System Prompt (only if enabled and has value)
        if (power_user.sysprompt?.enabled) {
            const syspromptVal = safeExtractValue('tcSysprompt');
            if (syspromptVal) {
                tcPrompts.systemPrompt = syspromptVal;
                promptsCount++;
            }
        }
    } catch (error) {
        console.warn('STCL: Error capturing TC prompts:', error);
    }

    console.log(`STCL: Captured TC prompts - ${promptsCount} active`);
    return tcPrompts;
}

/**
 * Applies Text Completion prompts
 * @param {Object} tcPrompts - The TCPrompt state to apply
 */
function tcApplyPrompts(tcPrompts) {
    if (!tcPrompts || typeof tcPrompts !== 'object') {
        console.warn('STCL: Invalid tcPrompts provided to tcApplyPrompts');
        return false;
    }

    if (!power_user || typeof power_user !== 'object') {
        console.warn('STCL: power_user not available for TC prompt application');
        return false;
    }

    /**
     * Helper function to safely apply a value to a selector
     * @param {string} selectorKey - The key in SELECTORS object
     * @param {string} value - The value to apply
     * @param {string} label - Label for logging
     * @returns {boolean} Success status
     */
    function safeApplyValue(selectorKey, value, label) {
        if (!selectorKey || typeof selectorKey !== 'string') {
            console.warn('STCL: Invalid selector key provided');
            return false;
        }

        if (!label || typeof label !== 'string') {
            console.warn('STCL: Invalid label provided');
            return false;
        }

        if (!SELECTORS || typeof SELECTORS !== 'object') {
            console.warn('STCL: SELECTORS object not available');
            return false;
        }

        if (!SELECTORS[selectorKey]) {
            console.warn(`STCL: Selector ${selectorKey} not defined`);
            return false;
        }

        if (!value || typeof value !== 'string') {
            return false;
        }

        if (typeof $ !== 'function') {
            console.warn('STCL: jQuery not available');
            return false;
        }

        const selector = $(SELECTORS[selectorKey]);
        if (selector.length === 0) {
            console.warn(`STCL: ${label} selector not found in DOM`);
            return false;
        }

        const currentValue = selector.val();
        if (currentValue !== value) {
            console.log(`STCL: Applying ${label}:`, value);
            selector.val(value).trigger('change');
            return true;
        }
        // Return true when no change needed - this is success, not failure
        return true;
    }

    try {
        let appliedCount = 0;

        // Apply Context Template
        if (tcPrompts.contextTemplate) {
            if (safeApplyValue('tcContext', tcPrompts.contextTemplate, 'context template')) {
                appliedCount++;
            }
        }

        // Apply Instruct Preset (only if instruct mode is enabled)
        if (tcPrompts.instructPreset && power_user.instruct?.enabled) {
            if (safeApplyValue('tcInstruct', tcPrompts.instructPreset, 'instruct preset')) {
                appliedCount++;
            }
        }

        // Apply System Prompt (only if sysprompt is enabled)
        if (tcPrompts.systemPrompt && power_user.sysprompt?.enabled) {
            if (safeApplyValue('tcSysprompt', tcPrompts.systemPrompt, 'system prompt')) {
                appliedCount++;
            }
        }

        console.log(`STCL: Applied ${appliedCount} TC prompts`);
        return true;
    } catch (error) {
        console.error('STCL: Error applying TC prompts:', error);
        return false;
    }
}

/**
 * Formats Text Completion settings for display
 * @param {Object} settings - The settings object
 * @param {string} completionSource - The completion source
 * @param {string} saved - The save timestamp
 * @returns {string} Formatted settings string
 */
function tcFormatSettings(settings, completionSource, saved) {
    if (!settings || typeof settings !== 'object') {
        return 'Invalid settings provided';
    }
    if (!completionSource || typeof completionSource !== 'string') {
        return 'Invalid completion source provided';
    }

    return formatSettings(settings, completionSource, saved, {
        apiLabel: 'Profile',
        presetField: 'tcPreset',
        presetLabel: 'TCPreset',
        defaultPreset: 'N/A',
        promptsLabel: 'TCPrompts',
        formatPrompts: formatTCPrompts,
        formatStatus: (saved) => `Saved: ${saved}`
    });
}

/**
 * Applies Text Completion settings including presets and prompts
 * @param {Object} settings - The TC settings to apply
 * @returns {Promise<boolean>} True if successful
 */
async function tcApplySettings(settings) {
    if (!settings || typeof settings !== 'object') {
        console.warn('STCL: Invalid settings provided to tcApplySettings');
        return false;
    }

    logSettingsApplication('Text Completion', settings);

    try {
        // Apply TCPreset
        if (settings.tcPreset && typeof settings.tcPreset === 'string') {
            const presetSelectorString = await getCurrentPresetSelector();
            if (!presetSelectorString) {
                console.error('STCL: Could not get TC preset selector');
                return false;
            }

            if (typeof $ !== 'function') {
                console.error('STCL: jQuery not available');
                return false;
            }

            const presetSelector = $(presetSelectorString);
            if (presetSelector.length === 0) {
                console.error('STCL: TC preset selector not found in DOM');
                return false;
            }

            await applyPreset(presetSelector, settings.tcPreset, 'TC');
        }

        // Apply TCPrompts
        if (settings.tcPrompts && typeof settings.tcPrompts === 'object') {
            const result = tcApplyPrompts(settings.tcPrompts);
            if (!result) {
                console.warn('STCL: Failed to apply TC prompts');
                return false;
            }
        }

        return true;
    } catch (error) {
        console.error('STCL: Error applying TC settings:', error);
        return false;
    }
}

/**
 * Gets current Text Completion settings including presets and prompts
 * @param {Object} apiInfo - API information
 * @returns {Promise<Object>} Current TC settings
 */
async function tcGetSettings(apiInfo) {
    // Validate API info
    if (!apiInfo || typeof apiInfo !== 'object') {
        console.warn('STCL: Invalid apiInfo provided to tcGetSettings');
        return null;
    }

    if (!validateApiInfo(apiInfo, 'TC')) {
        return null;
    }

    try {
        // Get current TCPreset
        let tcPreset = '';
        try {
            const presetSelectorString = await getCurrentPresetSelector();
            if (!presetSelectorString) {
                console.error('STCL: Could not get TC preset selector');
                return null;
            }

            if (typeof $ !== 'function') {
                console.error('STCL: jQuery not available');
                return null;
            }

            const presetSelector = $(presetSelectorString);
            if (presetSelector.length === 0) {
                console.error('STCL: TC preset selector not found in DOM');
                return null;
            }

            tcPreset = extractPresetValue(presetSelector);
        } catch (error) {
            console.warn('STCL: Error getting TC preset:', error);
        }

        if (!tcPreset) {
            logNoPresetWarning('TC');
            // Still continue, but note this in logs
        }

        // Get TCPrompts state
        const tcPrompts = tcGetPromptState();

        // Create settings object
        const settings = createTimestampedSettings(apiInfo.completionSource, {
            tcPreset: tcPreset,
            tcPrompts: tcPrompts
        });

        const promptsCount = Object.keys(tcPrompts).length;
        logSettingsCapture('TC', tcPreset, `${promptsCount} active`);

        return settings;
    } catch (error) {
        console.error('STCL: Error getting TC settings:', error);
        return null;
    }
}

// ===== EXPORTS =====

export const tcPromptHandlers = {
    tcGetPromptState,
    tcApplyPrompts,
    tcFormatSettings
};

export const tcSettingsHandlers = {
    tcApplySettings,
    tcGetSettings
};