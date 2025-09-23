// IMPORTANT: Please refer to vocab.md for terminology definitions and understanding
// of the distinction between Chat Completion (CCPrompts) and Text Completion (TCPrompts) systems.

// This file contains all Text Completion (TC) related functionality
// Handles TC prompt management, settings, and application

// ===== IMPORTS FROM SILLYTAVERN CORE =====
import { power_user } from '../../../power-user.js';

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
    logSettingsApplication
} from './stcl-utils.js';
import { moment } from '../../../../lib.js';

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
    getCurrentApiInfo = fn;
}

/**
 * Gets the current preset selector based on API type
 * @returns {string} jQuery selector for the current preset dropdown
 */
async function getCurrentPresetSelector() {
    const apiInfo = await getCurrentApiInfo();
    return PRESET_SELECTOR_MAP[apiInfo.completionSource] || SELECTORS.ccPreset;
}

// ===== TEXT COMPLETION FUNCTIONS =====

/**
 * Captures the current state of Text Completion prompts
 * @returns {Object} The current TCPrompt state
 */
function tcGetPromptState() {
    let tcPrompts = {};
    let promptsCount = 0;

    try {
        // Context Template (only if available and has value)
        const contextSelector = $(SELECTORS.tcContext);
        if (contextSelector.length) {
            const contextVal = contextSelector.val();
            if (contextVal && contextVal?.toString?.()?.trim?.()) {
                tcPrompts.contextTemplate = contextVal?.toString?.()?.trim?.() || '';
                promptsCount++;
            }
        }

        // Instruct Mode (only if enabled and has value)
        if (power_user.instruct?.enabled) {
            const instructSelector = $(SELECTORS.tcInstruct);
            if (instructSelector.length) {
                const instructVal = instructSelector.val();
                if (instructVal && instructVal?.toString?.()?.trim?.()) {
                    tcPrompts.instructPreset = instructVal?.toString?.()?.trim?.() || '';
                    promptsCount++;
                }
            }
        }

        // System Prompt (only if enabled and has value)
        if (power_user.sysprompt?.enabled) {
            const syspromptSelector = $(SELECTORS.tcSysprompt);
            if (syspromptSelector.length) {
                const syspromptVal = syspromptSelector.val();
                if (syspromptVal && syspromptVal?.toString?.()?.trim?.()) {
                    tcPrompts.systemPrompt = syspromptVal?.toString?.()?.trim?.() || '';
                    promptsCount++;
                }
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
    // Apply Context Template
    if (tcPrompts.contextTemplate) {
        const contextSelector = $(SELECTORS.tcContext);
        if (contextSelector.length) {
            const currentContext = contextSelector.val();
            if (currentContext !== tcPrompts.contextTemplate && tcPrompts.contextTemplate?.toString?.()) {
                console.log('STCL: Applying context template:', tcPrompts.contextTemplate);
                contextSelector.val(tcPrompts.contextTemplate).trigger('change');
            }
        }
    }

    // Apply Instruct Preset (only if instruct mode is enabled)
    if (tcPrompts.instructPreset && power_user.instruct?.enabled) {
        const instructSelector = $(SELECTORS.tcInstruct);
        if (instructSelector.length) {
            const currentInstruct = instructSelector.val();
            if (currentInstruct !== tcPrompts.instructPreset && tcPrompts.instructPreset?.toString?.()) {
                console.log('STCL: Applying instruct preset:', tcPrompts.instructPreset);
                instructSelector.val(tcPrompts.instructPreset).trigger('change');
            }
        }
    }

    // Apply System Prompt (only if sysprompt is enabled)
    if (tcPrompts.systemPrompt && power_user.sysprompt?.enabled) {
        const syspromptSelector = $(SELECTORS.tcSysprompt);
        if (syspromptSelector.length) {
            const currentSysprompt = syspromptSelector.val();
            if (currentSysprompt !== tcPrompts.systemPrompt && tcPrompts.systemPrompt?.toString?.()) {
                console.log('STCL: Applying system prompt:', tcPrompts.systemPrompt);
                syspromptSelector.val(tcPrompts.systemPrompt).trigger('change');
            }
        }
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
    const tcPreset = (settings.tcPreset && typeof settings.tcPreset === 'string') ? settings.tcPreset.trim() || 'N/A' : 'N/A';

    // Build TCPrompts description
    let tcPromptsDesc = [];
    if (settings.tcPrompts && typeof settings.tcPrompts === 'object') {
        if (settings.tcPrompts.contextTemplate) tcPromptsDesc.push('Context');
        if (settings.tcPrompts.instructPreset) tcPromptsDesc.push('Instruct');
        if (settings.tcPrompts.systemPrompt) tcPromptsDesc.push('SysPrompt');
    }
    const tcPromptsDisplay = tcPromptsDesc.length > 0 ? tcPromptsDesc.join('+') : 'Default';

    return `Profile: ${completionSource}
TCPreset: ${tcPreset}
TCPrompts: ${tcPromptsDisplay}
Saved: ${saved}`;
}

/**
 * Applies Text Completion settings including presets and prompts
 * @param {Object} settings - The TC settings to apply
 * @returns {Promise<boolean>} True if successful
 */
async function tcApplySettings(settings) {
    logSettingsApplication('Text Completion', settings);

    // Apply TCPreset
    if (settings.tcPreset) {
        const presetSelector = $(await getCurrentPresetSelector());
        await applyPreset(presetSelector, settings.tcPreset, 'TC');
    }

    // Apply TCPrompts
    if (settings.tcPrompts) {
        tcApplyPrompts(settings.tcPrompts);
    }

    return true;
}

/**
 * Gets current Text Completion settings including presets and prompts
 * @param {Object} apiInfo - API information
 * @returns {Promise<Object>} Current TC settings
 */
async function tcGetSettings(apiInfo) {
    // Validate API info
    if (!validateApiInfo(apiInfo, 'TC')) {
        return null;
    }

    // Get current TCPreset
    let tcPreset = '';
    try {
        const presetSelector = $(await getCurrentPresetSelector());
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