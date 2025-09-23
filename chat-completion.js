// IMPORTANT: Please refer to vocab.md for terminology definitions and understanding
// of the distinction between Chat Completion (CCPrompts) and Text Completion (TCPrompts) systems.

// This file contains all Chat Completion (CC) related functionality
// Handles CC prompt management, settings, and application

// ===== IMPORTS FROM SILLYTAVERN CORE =====
import { moment } from '../../../../lib.js';

// ===== IMPORTS FROM EXTENSION UTILS =====
import {
    GLOBAL_DUMMY_CHARACTER_ID,
    SELECTORS,
    validateApiInfo,
    applyPreset,
    createTimestampedSettings,
    extractPresetValue,
    logNoPresetWarning,
    logSettingsCapture,
    logSettingsApplication
} from './stcl-utils.js';
import { getPromptManager, waitForPromptManager } from './templates.js';

// ===== CHAT COMPLETION FUNCTIONS =====

/**
 * Captures the current state of Chat Completion prompts
 * @returns {Object} The current CCPrompt state
 */
function ccGetPromptState() {
    try {
        const promptManager = getPromptManager();
        if (!promptManager || !promptManager.serviceSettings) {
            console.warn('STCL: PromptManager not available for state capture');
            return {};
        }

        // Get the current active character for prompt ordering (or use global)
        const activeCharacter = promptManager.activeCharacter || GLOBAL_DUMMY_CHARACTER_ID;

        // Collect essential prompt state
        const promptState = {
            // Save prompt definitions (focusing on user-customizable content)
            prompts: promptManager.serviceSettings.prompts
                .filter(prompt => {
                    // Include system prompts that users commonly modify
                    const systemPrompts = ['main', 'nsfw', 'jailbreak', 'enhanceDefinitions'];
                    // Include custom prompts (non-system, non-marker)
                    return systemPrompts.includes(prompt.identifier) ||
                           (!prompt.system_prompt && !prompt.marker);
                })
                .map(prompt => ({
                    identifier: prompt.identifier,
                    name: prompt.name,
                    role: prompt.role,
                    content: prompt.content,
                    system_prompt: prompt.system_prompt,
                    injection_position: prompt.injection_position,
                    injection_depth: prompt.injection_depth,
                    injection_order: prompt.injection_order,
                    injection_trigger: prompt.injection_trigger || [],
                    forbid_overrides: prompt.forbid_overrides,
                    marker: prompt.marker,
                    extension: prompt.extension
                })),

            // Save prompt ordering and enable states
            prompt_order: promptManager.getPromptOrderForCharacter
                ? promptManager.getPromptOrderForCharacter(activeCharacter)
                : promptManager.serviceSettings.prompt_order || [],

            // Metadata
            version: promptManager.configuration?.version || 1,
            activeCharacter: activeCharacter,
            capturedAt: moment().toISOString()
        };

        console.log(`STCL: Captured CCPrompt state with ${promptState.prompts.length} prompts and ${promptState.prompt_order.length} order entries`);
        return promptState;

    } catch (error) {
        console.error('STCL: Error capturing Chat Completion prompt state:', error);
        return {};
    }
}

/**
 * Applies Chat Completion prompts to the current PromptManager
 * @param {Object} ccPrompts - The CCPrompt state to apply
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
async function ccApplyPrompts(ccPrompts) {
    try {
        // Validate input
        if (!ccPrompts || typeof ccPrompts !== 'object') {
            console.warn('STCL: Invalid CCPrompt data provided');
            return false;
        }

        if (!ccPrompts.prompts && !ccPrompts.prompt_order) {
            console.warn('STCL: No CCPrompt data to restore');
            return false;
        }

        // Wait for prompt manager to be available with better timeout handling
        const promptManager = await waitForPromptManager(10000);
        if (!promptManager || !promptManager.serviceSettings) {
            console.error('STCL: PromptManager not available for CCPrompt restoration');
            return false;
        }

        console.log('STCL: Starting CCPrompt restoration...');

        // Restore prompts
        if (ccPrompts.prompts && Array.isArray(ccPrompts.prompts)) {
            console.log(`STCL: Restoring ${ccPrompts.prompts.length} prompts`);

            for (const savedPrompt of ccPrompts.prompts) {
                try {
                    // Find existing prompt by identifier
                    const existingPromptIndex = promptManager.serviceSettings.prompts
                        .findIndex(p => p.identifier === savedPrompt.identifier);

                    if (existingPromptIndex !== -1) {
                        // Update existing prompt
                        const existingPrompt = promptManager.serviceSettings.prompts[existingPromptIndex];

                        // Preserve essential properties while updating content
                        const updatedPrompt = {
                            ...existingPrompt,
                            name: savedPrompt.name || existingPrompt.name,
                            content: savedPrompt.content || existingPrompt.content,
                            role: savedPrompt.role || existingPrompt.role,
                            injection_position: savedPrompt.injection_position ?? existingPrompt.injection_position,
                            injection_depth: savedPrompt.injection_depth ?? existingPrompt.injection_depth,
                            injection_order: savedPrompt.injection_order ?? existingPrompt.injection_order,
                            injection_trigger: savedPrompt.injection_trigger || existingPrompt.injection_trigger || [],
                            forbid_overrides: savedPrompt.forbid_overrides ?? existingPrompt.forbid_overrides
                        };

                        promptManager.serviceSettings.prompts[existingPromptIndex] = updatedPrompt;
                        console.log(`STCL: Updated prompt "${savedPrompt.identifier}"`);
                    } else if (!savedPrompt.system_prompt) {
                        // Add custom prompts that don't exist
                        const newPrompt = {
                            identifier: savedPrompt.identifier,
                            name: savedPrompt.name,
                            role: savedPrompt.role || 'user',
                            content: savedPrompt.content || '',
                            system_prompt: false,
                            injection_position: savedPrompt.injection_position || 0,
                            injection_depth: savedPrompt.injection_depth || 0,
                            injection_order: savedPrompt.injection_order || 100,
                            injection_trigger: savedPrompt.injection_trigger || [],
                            forbid_overrides: savedPrompt.forbid_overrides || false,
                            marker: savedPrompt.marker || false,
                            extension: savedPrompt.extension || 'STCL'
                        };

                        promptManager.serviceSettings.prompts.push(newPrompt);
                        console.log(`STCL: Added new prompt "${savedPrompt.identifier}"`);
                    }
                } catch (promptError) {
                    console.error(`STCL: Error restoring prompt "${savedPrompt.identifier}":`, promptError);
                }
            }
        }

        // Restore prompt order
        if (ccPrompts.prompt_order && Array.isArray(ccPrompts.prompt_order)) {
            console.log(`STCL: Restoring prompt order with ${ccPrompts.prompt_order.length} entries`);

            const targetCharacter = ccPrompts.activeCharacter || promptManager.activeCharacter || GLOBAL_DUMMY_CHARACTER_ID;

            if (promptManager.setPromptOrderForCharacter) {
                // Use character-specific prompt ordering
                try {
                    promptManager.setPromptOrderForCharacter(targetCharacter, ccPrompts.prompt_order);
                    console.log(`STCL: Set prompt order for character ${targetCharacter}`);
                } catch (orderError) {
                    console.error('STCL: Error setting character-specific prompt order:', orderError);
                    // Fallback to global order
                    promptManager.serviceSettings.prompt_order = ccPrompts.prompt_order;
                }
            } else {
                // Map the saved order to current prompts and apply globally
                try {
                    ccPrompts.prompt_order.forEach(savedOrder => {
                        const matchingPrompt = promptManager.serviceSettings.prompts
                            .find(p => p.identifier === savedOrder.identifier);

                        if (matchingPrompt && savedOrder.enabled !== undefined) {
                            // Find corresponding order entry or create one
                            let orderEntry = promptManager.serviceSettings.prompt_order
                                .find(o => o.identifier === savedOrder.identifier);

                            if (orderEntry) {
                                orderEntry.enabled = savedOrder.enabled;
                            } else {
                                promptManager.serviceSettings.prompt_order.push({
                                    identifier: savedOrder.identifier,
                                    enabled: savedOrder.enabled
                                });
                            }
                        }
                    });
                    console.log('STCL: Applied prompt order globally');
                } catch (globalOrderError) {
                    console.error('STCL: Error applying global prompt order:', globalOrderError);
                }
            }
        }

        // Save changes and refresh UI
        try {
            if (promptManager.saveServiceSettings) {
                await promptManager.saveServiceSettings();
            }

            if (promptManager.render) {
                promptManager.render();
            }

            console.log('STCL: CCPrompt restoration completed successfully');
            return true;
        } catch (saveError) {
            console.error('STCL: Error saving CCPrompt changes:', saveError);
            return false;
        }

    } catch (error) {
        console.error('STCL: Error applying Chat Completion prompts:', error);
        return false;
    }
}

/**
 * Formats Chat Completion settings for display
 * @param {Object} settings - The settings object
 * @param {string} completionSource - The completion source
 * @param {boolean} saved - Whether these are saved settings
 * @returns {string} Formatted settings display
 */
function ccFormatSettings(settings, completionSource, saved = false) {
    const presetDisplay = settings.ccPreset || 'Default';

    let ccPromptsDisplay = 'Default';
    if (settings.ccPrompts && typeof settings.ccPrompts === 'object') {
        const promptCount = settings.ccPrompts.prompts ? settings.ccPrompts.prompts.length : 0;
        const orderCount = settings.ccPrompts.prompt_order ? settings.ccPrompts.prompt_order.length : 0;

        if (promptCount > 0 || orderCount > 0) {
            ccPromptsDisplay = `${promptCount} prompts, ${orderCount} order entries`;
        }
    }

    return `API: ${completionSource}
Preset: ${presetDisplay}
CCPrompts: ${ccPromptsDisplay}
${saved ? 'Status: Saved ✓' : 'Status: Current UI State'}`;
}

/**
 * Applies Chat Completion settings including presets and prompts
 * @param {Object} settings - The CC settings to apply
 * @returns {Promise<boolean>} True if successful
 */
async function ccApplySettings(settings) {
    logSettingsApplication('Chat Completion', settings);

    // Apply CCPreset
    if (settings.ccPreset) {
        const presetSelector = $(SELECTORS.ccPreset);
        await applyPreset(presetSelector, settings.ccPreset, 'CC');
    }

    // Apply CCPrompts state
    if (settings.ccPrompts) {
        await ccApplyPrompts(settings.ccPrompts);
    }

    return true;
}

/**
 * Gets current Chat Completion settings including presets and prompts
 * @param {Object} apiInfo - API information
 * @returns {Object} Current CC settings
 */
function ccGetSettings(apiInfo) {
    // Validate API info
    if (!validateApiInfo(apiInfo, 'CC')) {
        return null;
    }

    // Get current CCPreset
    const presetSelector = $(SELECTORS.ccPreset);
    const ccPreset = extractPresetValue(presetSelector);

    if (!ccPreset) {
        logNoPresetWarning('CC');
        // Still continue, but note this in logs
    }

    // Get CCPrompts state
    const ccPrompts = ccGetPromptState();

    // Create settings object
    const settings = createTimestampedSettings(apiInfo.completionSource, {
        ccPreset: ccPreset,
        ccPrompts: ccPrompts || {}
    });

    const promptsInfo = ccPrompts && ccPrompts.prompts ? `${ccPrompts.prompts.length} items` : '0 items';
    logSettingsCapture('CC', ccPreset, promptsInfo);

    return settings;
}

// ===== EXPORTS =====

export const ccPromptHandlers = {
    ccGetPromptState,
    ccApplyPrompts,
    ccFormatSettings
};

export const ccSettingsHandlers = {
    ccApplySettings,
    ccGetSettings
};

export {
    getPromptManager,
    waitForPromptManager
};