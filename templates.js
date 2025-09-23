// IMPORTANT: Please refer to spec.md for terminology definitions and understanding
// of the distinction between Chat Completion (CCPrompts) and Text Completion (TCPrompts) systems.
// This is crucial for understanding what "Profile", "Preset", and "Prompts" mean in this extension.

// ===== IMPORTS FROM SILLYTAVERN CORE =====
import { getPresetManager } from '../../../preset-manager.js';
import { power_user } from '../../../power-user.js';
// ===== IMPORTS FROM EXTENSION UTILS =====
import { GLOBAL_DUMMY_CHARACTER_ID, SELECTORS, PRESET_SELECTOR_MAP } from './stcl-utils.js';
import { moment } from '../../../../lib.js';

// ===== CONSTANTS =====

// ===== HELPER FUNCTIONS =====

/**
 * Gets the current preset selector based on API type
 * @returns {string} jQuery selector for the current preset dropdown
 */
async function getCurrentPresetSelector() {
    const apiInfo = await getCurrentApiInfo();
    return PRESET_SELECTOR_MAP[apiInfo.completionSource] || SELECTORS.ccPreset;
}

/**
 * Safely gets the prompt manager instance with fallbacks
 * @returns {Object|null} The prompt manager instance or null if not available
 */
function getPromptManager() {
    try {
        return window.promptManager ||
               window.SillyTavern?.getContext?.()?.promptManager ||
               null;
    } catch (error) {
        console.warn('STCL: Error accessing prompt manager:', error);
        return null;
    }
}

/**
 * Waits for the prompt manager to be available
 * @param {number} timeout - Maximum time to wait in milliseconds
 * @returns {Promise<Object|null>} The prompt manager or null if timeout
 */
async function waitForPromptManager(timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        const manager = getPromptManager();
        if (manager && manager.serviceSettings) {
            return manager;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.warn('STCL: Prompt manager not available after timeout');
    return null;
}

// This function will be set by the main module
let getCurrentApiInfo = function() {
    throw new Error('getCurrentApiInfo must be provided by the main module');
};

// ===== PROMPT TEMPLATE MANAGER =====

/**
 * Manages prompt template loading, synchronization, and application
 */
class PromptTemplateManager {
    constructor(storageAdapter) {
        this.storage = storageAdapter;
        this.syncTimer = null;
    }

    /**
     * Initialize the template manager and start auto-import if enabled
     */
    async initialize() {
        const settings = this.storage.getExtensionSettings();

        if (settings.moduleSettings.enablePromptTemplates) {
            console.log('STCL: Initializing Prompt Template Manager');

            if (settings.moduleSettings.autoImportTemplates) {
                await this.loadTemplatesOnStartup();
            }

            if (settings.moduleSettings.syncTemplatesInterval > 0) {
                this.startAutoSync();
            }
        }
    }

    /**
     * Load templates from configured sources on startup
     */
    async loadTemplatesOnStartup() {
        const settings = this.storage.getExtensionSettings();
        const sources = settings.moduleSettings.templateSources || [];

        if (sources.length === 0) {
            console.log('STCL: No template sources configured');
            return;
        }

        console.log('STCL: Loading templates from', sources.length, 'sources');
        let allTemplates = {};
        let loadedCount = 0;

        // Sort sources by priority
        const sortedSources = [...sources].sort((a, b) => (a.priority || 0) - (b.priority || 0));

        for (const source of sortedSources) {
            try {
                console.log(`STCL: Loading templates from ${source.type}: ${source.source}`);
                const templates = await this.loadFromSource(source);

                if (templates && templates.templates) {
                    allTemplates = this.mergeTemplates(allTemplates, templates.templates, settings.moduleSettings.templateConflictResolution);
                    loadedCount++;
                }
            } catch (error) {
                console.warn(`STCL: Failed to load templates from ${source.source}:`, error);
            }
        }

        if (loadedCount > 0) {
            await this.saveTemplates(allTemplates);

            if (settings.moduleSettings.autoAssignTemplates) {
                await this.applyAutoAssignments(allTemplates);
            }

            console.log(`STCL: Successfully loaded templates from ${loadedCount}/${sources.length} sources`);
        }
    }

    /**
     * Load templates from a specific source
     */
    async loadFromSource(source) {
        switch (source.type) {
            case 'url':
                return await this.loadFromUrl(source.source);
            case 'file':
                return await this.loadFromFile(source.source);
            case 'github':
                return await this.loadFromGitHub(source.source);
            default:
                throw new Error(`Unsupported source type: ${source.type}`);
        }
    }

    /**
     * Load templates from a URL
     */
    async loadFromUrl(url) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error('Response is not JSON');
            }

            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error('Request timed out after 10 seconds');
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Load templates from a local file path
     */
    async loadFromFile(path) {
        if (!path || typeof path !== 'string' || !path.trim()) {
            throw new Error('Invalid file path provided');
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout for file operations

        try {
            // Note: This would require server-side support to read local files
            const response = await fetch(`/api/stcl/templates/load?path=${encodeURIComponent(path)}`, {
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json'
                }
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                if (response.status === 404) {
                    throw new Error(`File not found: ${path}`);
                } else if (response.status === 403) {
                    throw new Error(`Access denied to file: ${path}`);
                } else {
                    throw new Error(`Failed to load file: ${path} (HTTP ${response.status})`);
                }
            }

            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                throw new Error(`File is not JSON format: ${path}`);
            }

            return await response.json();
        } catch (error) {
            if (error.name === 'AbortError') {
                throw new Error(`File load timed out after 15 seconds: ${path}`);
            }
            throw error;
        } finally {
            clearTimeout(timeoutId);
        }
    }

    /**
     * Load templates from GitHub (raw content)
     */
    async loadFromGitHub(repoPath) {
        // Convert github path to raw URL
        // Format: username/repo/path/to/file.json
        const rawUrl = `https://raw.githubusercontent.com/${repoPath}`;
        return await this.loadFromUrl(rawUrl);
    }

    /**
     * Merge templates with conflict resolution
     */
    mergeTemplates(existing, newTemplates, conflictResolution) {
        const merged = { ...existing };

        for (const [templateId, template] of Object.entries(newTemplates)) {
            if (merged[templateId] && conflictResolution === 'keep') {
                continue; // Skip existing templates
            } else if (merged[templateId] && conflictResolution === 'duplicate') {
                // Create a new ID for the duplicate
                const newId = `${templateId}_${Date.now()}`;
                merged[newId] = template;
            } else {
                // Update or add template
                merged[templateId] = template;
            }
        }

        return merged;
    }

    /**
     * Save templates to storage
     */
    async saveTemplates(templates) {
        const settings = this.storage.getExtensionSettings();
        settings.promptTemplates = templates;
        this.storage.saveSettings();
    }

    /**
     * Apply auto-assignments based on template rules
     */
    async applyAutoAssignments(templates) {
        const settings = this.storage.getExtensionSettings();

        for (const [templateId, template] of Object.entries(templates)) {
            if (template.autoAssign && Array.isArray(template.autoAssign)) {
                for (const pattern of template.autoAssign) {
                    await this.assignTemplateToMatchingPresets(templateId, pattern);
                }
            }
        }
    }

    /**
     * Assign a template to presets matching a pattern
     */
    async assignTemplateToMatchingPresets(templateId, pattern) {
        console.log(`STCL: Auto-assigning template "${templateId}" to presets matching "${pattern}"`);

        try {
            // Get the preset manager
            const presetManager = getPresetManager?.('openai');
            if (!presetManager) {
                console.warn('STCL: Preset manager not available for auto-assignment');
                return;
            }

            // Get all preset names
            const presets = presetManager.getPresets?.() || {};
            const presetNames = Object.keys(presets);

            // Convert pattern to regex (simple wildcard support)
            const regexPattern = pattern.replace(/\*/g, '.*').replace(/\?/g, '.');
            const regex = new RegExp(`^${regexPattern}$`, 'i');

            let assignedCount = 0;

            for (const presetName of presetNames) {
                if (regex.test(presetName)) {
                    this.setTemplateForPreset(presetName, templateId);
                    assignedCount++;
                    console.log(`STCL: Assigned template "${templateId}" to preset "${presetName}"`);
                }
            }

            if (assignedCount > 0) {
                console.log(`STCL: Auto-assigned template "${templateId}" to ${assignedCount} presets matching "${pattern}"`);
            }
        } catch (error) {
            console.error('STCL: Error during auto-assignment:', error);
        }
    }

    /**
     * Get a template by ID
     */
    getTemplate(templateId) {
        const settings = this.storage.getExtensionSettings();
        return settings.promptTemplates?.[templateId] || null;
    }

    /**
     * Get all templates
     */
    getAllTemplates() {
        const settings = this.storage.getExtensionSettings();
        return settings.promptTemplates || {};
    }

    /**
     * Get template assignment for a preset
     */
    getTemplateForPreset(presetName) {
        const settings = this.storage.getExtensionSettings();
        return settings.templateAssignments?.[presetName] || null;
    }

    /**
     * Set template assignment for a preset
     */
    setTemplateForPreset(presetName, templateId) {
        const settings = this.storage.getExtensionSettings();
        if (!settings.templateAssignments) {
            settings.templateAssignments = {};
        }
        settings.templateAssignments[presetName] = templateId;
        this.storage.saveSettings();
    }

    /**
     * Start automatic template synchronization
     */
    startAutoSync() {
        const settings = this.storage.getExtensionSettings();
        const interval = settings.moduleSettings.syncTemplatesInterval;

        if (this.syncTimer) {
            clearInterval(this.syncTimer);
        }

        this.syncTimer = setInterval(async () => {
            console.log('STCL: Auto-syncing prompt templates...');
            await this.loadTemplatesOnStartup();
        }, interval);
    }

    /**
     * Stop automatic template synchronization
     */
    stopAutoSync() {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
        }
    }

    /**
     * Apply template prompts to the current PromptManager
     */
    async applyTemplate(templateId) {
        const template = this.getTemplate(templateId);
        if (!template || !template.prompts) {
            console.warn(`STCL: Template "${templateId}" not found or has no prompts`);
            return false;
        }

        try {
            // Get the global PromptManager instance
            const promptManager = window.promptManager || window.oai?.promptManager;
            if (!promptManager) {
                console.warn('STCL: PromptManager not available');
                return false;
            }

            // Apply each prompt from the template
            for (const [promptType, content] of Object.entries(template.prompts)) {
                const prompt = promptManager.getPromptById(promptType);
                if (prompt) {
                    prompt.content = content;
                    console.log(`STCL: Applied template prompt for "${promptType}"`);
                }
            }

            // Trigger PromptManager update
            promptManager.render();
            promptManager.saveServiceSettings();

            console.log(`STCL: Successfully applied template "${templateId}"`);
            return true;
        } catch (error) {
            console.error('STCL: Error applying template:', error);
            return false;
        }
    }
}

// ===== EXPORTS =====

export { PromptTemplateManager, setGetCurrentApiInfo };

export const promptHelpers = {
    getCurrentPresetSelector,
    getPromptManager,
    waitForPromptManager
};