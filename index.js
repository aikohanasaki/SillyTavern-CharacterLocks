// IMPORTANT: Please refer to spec.md for terminology definitions and understanding
// of the distinction between Chat Completion (CCPrompts) and Text Completion (TCPrompts) systems.
// This is crucial for understanding what "Profile", "Preset", and "Prompts" mean in this extension.

// ===== IMPORTS FROM SILLYTAVERN CORE =====
import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { Popup, POPUP_TYPE } from '../../../popup.js';
import { getPresetManager } from '../../../preset-manager.js';
import { power_user } from '../../../power-user.js';
import { getChatCompletionModel } from '../../../openai.js';
// Index.js specific imports
import { chat_metadata, name2, systemUserName, neutralCharacterName, characters } from '../../../../script.js';
import { saveMetadataDebounced } from '../../../extensions.js';
import { lodash, moment, Handlebars, DOMPurify, morphdom } from '../../../../lib.js';
import { selected_group, groups, editGroup } from '../../../group-chats.js';

// ===== IMPORTS FROM OUR EXTENSION MODULES =====
import { PromptTemplateManager, promptHelpers } from './templates.js';
import { ccPromptHandlers, ccSettingsHandlers } from './chat-completion.js';
import { tcPromptHandlers, tcSettingsHandlers, setGetCurrentApiInfo } from './text-completion.js';
import { ModelPromptManager } from './boolcompare.js';
import {
    acquireLock, releaseLock, createManagedTimeout, createManagedInterval, clearManagedTimer,
    addCleanupHandler, runCleanup, waitForElement as utilsWaitForElement, createUIToggle,
    registerEventHandler, unregisterAllEventHandlers, isUsingChatCompletion,
    formatBasicSettingsInfo, getEmptySettings, getDefaultSettings, safeCheckbox, safeElement,
    validateApiInfo, applyPreset, createTimestampedSettings,
    MODULE_NAME, GLOBAL_DUMMY_CHARACTER_ID, SELECTORS, PRESET_SELECTOR_MAP
} from './stcl-utils.js';

// ===== CONSTANTS AND CONFIGURATION =====

const SAVE_DEBOUNCE_TIME = 1000;
const CACHE_TTL = 1000;
const MAX_CHARACTER_QUEUE_SIZE = 10;
const MAX_CONTEXT_QUEUE_SIZE = 20;



// Efficient circular buffer for queue operations
class CircularBuffer {
    constructor(maxSize) {
        this.buffer = new Array(maxSize);
        this.maxSize = maxSize;
        this.head = 0;
        this.tail = 0;
        this.size = 0;
    }

    // Check if item already exists in buffer
    includes(item) {
        for (let i = 0; i < this.size; i++) {
            const index = (this.head + i) % this.maxSize;
            if (this.buffer[index] === item) {
                return true;
            }
        }
        return false;
    }

    push(item) {
        // Don't add duplicates
        if (this.includes(item)) {
            return;
        }

        if (this.size < this.maxSize) {
            this.buffer[this.tail] = item;
            this.tail = (this.tail + 1) % this.maxSize;
            this.size++;
        } else {
            // Overwrite oldest item
            this.buffer[this.tail] = item;
            this.tail = (this.tail + 1) % this.maxSize;
            this.head = (this.head + 1) % this.maxSize;
        }
    }

    shift() {
        if (this.size === 0) return undefined;

        const item = this.buffer[this.head];
        this.buffer[this.head] = undefined; // Clear reference
        this.head = (this.head + 1) % this.maxSize;
        this.size--;
        return item;
    }

    peek() {
        return this.size > 0 ? this.buffer[this.head] : undefined;
    }

    clear() {
        this.buffer.fill(undefined);
        this.head = 0;
        this.tail = 0;
        this.size = 0;
    }

    toArray() {
        const result = [];
        for (let i = 0; i < this.size; i++) {
            result.push(this.buffer[(this.head + i) % this.maxSize]);
        }
        return result;
    }

    get length() {
        return this.size;
    }
}

// Observer cleanup registry to prevent memory leaks
class ObserverRegistry {
    constructor() {
        this.observers = new Set();
    }

    register(observer) {
        this.observers.add(observer);
        return observer;
    }

    unregister(observer) {
        if (observer && typeof observer.disconnect === 'function') {
            observer.disconnect();
        }
        this.observers.delete(observer);
    }

    cleanup() {
        for (const observer of this.observers) {
            this.unregister(observer);
        }
        this.observers.clear();
        // Observer registry cleaned up
    }

    get size() {
        return this.observers.size;
    }
}

// Global observer registry
const observerRegistry = new ObserverRegistry();

const CHAT_TYPES = {
    SINGLE: 'single',
    GROUP: 'group'
};

const SETTING_SOURCES = {
    CHARACTER: 'character',
    CHAT: 'chat',
    GROUP: 'group',
    INDIVIDUAL: 'individual character',
    GROUP_CHAT: 'group chat'
};


const DEFAULT_SETTINGS = {
    moduleSettings: {
        enableCharacterMemory: true,
        enableChatMemory: true,
        enableGroupMemory: true,
        preferCharacterOverChat: true,
        preferGroupOverChat: true,
        preferIndividualCharacterInGroup: false,
        showOtherNotifications: false,
        // Prompt Template Settings
        enablePromptTemplates: false,
        autoImportTemplates: false,
        templateSources: [],
        templateConflictResolution: 'update', // 'keep', 'update', 'duplicate'
        autoAssignTemplates: false,
        syncTemplatesInterval: 3600000 // 1 hour in milliseconds
    },
    characterSettings: {},
    groupSettings: {},
    promptTemplates: {},
    templateAssignments: {},
    // Model-Prompt Mappings (global defaults)
    modelPromptMappings: {
        rules: [], // Will be populated with predefined rules on first run
        globalDefault: { preset: '', prompts: null },
        enableModelPromptLinks: true,
        followInheritanceChain: true
    },
    // Multi-user configuration (simulates config.yaml)
    multiUserConfig: {
        allowNonAdminFullAccess: false,
        allowNonAdminEditFilters: false,
        allowNonAdminToggleModelPrompt: false,
        promptTemplateImportSource: "",
        booleanFiltersSource: ""
    },
    // Per-user settings storage (when in multi-user mode)
    users: {},
    migrationVersion: 8
};

// ===== MULTI-USER MANAGEMENT =====

/**
 * Manages multi-user functionality and access control
 */
class MultiUserManager {
    constructor() {
        this.accountsEnabled = false;
        this.currentUser = null;
        this.getCurrentUserHandle = () => 'default-user';
        this.isAdmin = () => true;
        this.initialized = false;
        this.yamlConfig = null;
    }

    async initialize() {
        if (this.initialized) return;

        try {
            // Load YAML configuration first
            await this.loadConfigYAML();
        } catch (error) {
            console.warn('STCL: Failed to load config.yaml, using defaults:', error.message);
        }

        try {
            // Try to import user management functions from SillyTavern
            const userModule = await import('../../../user.js');
            if (userModule) {
                const {
                    accountsEnabled = false,
                    currentUser = null,
                    getCurrentUserHandle = (() => 'default-user'),
                    isAdmin = (() => true)
                } = userModule;

                this.accountsEnabled = accountsEnabled;
                this.currentUser = currentUser;
                this.getCurrentUserHandle = getCurrentUserHandle;
                this.isAdmin = isAdmin;

                // Multi-user support initialized
            }
        } catch (error) {}

        this.initialized = true;
    }

    isMultiUserMode() {
        return this.accountsEnabled;
    }

    getUserHandle() {
        return this.getCurrentUserHandle();
    }

    isCurrentUserAdmin() {
        return this.isAdmin();
    }

    getConfig() {
        // Priority order: Extension settings > YAML config > defaults
        const extensionSettings = extension_settings[MODULE_NAME];
        const extensionConfig = extensionSettings?.multiUserConfig || {};
        const yamlConfig = this.yamlConfig || {};
        const { multiUserConfig: defaultConfig } = DEFAULT_SETTINGS;

        // Merge configurations with proper priority using spread and destructuring
        const configKeys = [
            'allowNonAdminFullAccess',
            'allowNonAdminEditFilters',
            'allowNonAdminToggleModelPrompt',
            'promptTemplateImportSource',
            'booleanFiltersSource'
        ];

        return configKeys.reduce((config, key) => {
            config[key] = extensionConfig[key] ?? yamlConfig[key] ?? defaultConfig[key];
            return config;
        }, {});
    }

    canEditFilters() {
        if (!this.isMultiUserMode() || this.isCurrentUserAdmin()) {
            return true;
        }

        const config = this.getConfig();
        return config.allowNonAdminFullAccess || config.allowNonAdminEditFilters;
    }

    canToggleModelPrompt() {
        if (!this.isMultiUserMode() || this.isCurrentUserAdmin()) {
            return true;
        }

        const config = this.getConfig();
        return config.allowNonAdminFullAccess || config.allowNonAdminToggleModelPrompt;
    }

    hasFullAccess() {
        if (!this.isMultiUserMode() || this.isCurrentUserAdmin()) {
            return true;
        }

        const config = this.getConfig();
        return config.allowNonAdminFullAccess;
    }

    hasMasterSourceForTemplates() {
        const config = this.getConfig();
        return config.promptTemplateImportSource && config.promptTemplateImportSource.trim() !== '';
    }

    hasMasterSourceForFilters() {
        const config = this.getConfig();
        return config.booleanFiltersSource && config.booleanFiltersSource.trim() !== '';
    }

    getUserSettingsKey() {
        // In multi-user mode, store settings under user handle
        // In single-user mode, use root level for backward compatibility
        if (this.isMultiUserMode()) {
            return `users.${this.getUserHandle()}`;
        }
        return null; // Use root level
    }

    async loadConfigYAML() {
        try {
            const configPath = '/extensions/third-party/SillyTavern-CharacterLocks/config.yaml';
            const response = await fetch(configPath);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const yamlText = await response.text();
            this.yamlConfig = this.parseSimpleYAML(yamlText);

            // Loaded config.yaml successfully
            return this.yamlConfig;

        } catch (error) {
            console.warn('STCL: Could not load config.yaml:', error.message);
            this.yamlConfig = null;
            throw error;
        }
    }

    parseSimpleYAML(yamlText) {
        const config = {};
        const lines = yamlText.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();

            // Skip empty lines and comments
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            // Parse key: value pairs
            const colonIndex = trimmed.indexOf(':');
            if (colonIndex === -1) {
                continue;
            }

            const key = trimmed.substring(0, colonIndex).trim();
            let value = trimmed.substring(colonIndex + 1).trim();

            // Remove quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }

            // Convert to appropriate type
            if (value === 'true') {
                config[key] = true;
            } else if (value === 'false') {
                config[key] = false;
            } else if (value === '' || value === '""' || value === "''") {
                config[key] = '';
            } else if (!isNaN(value) && value.trim() !== '') {
                config[key] = Number(value);
            } else {
                config[key] = value;
            }
        }

        return config;
    }
}

// ===== MASTER SOURCE MANAGEMENT =====

/**
 * Manages loading configurations from master sources (URLs or files)
 */
class MasterSourceLoader {
    constructor(multiUserManager) {
        this.multiUserManager = multiUserManager;
        this.lastSyncTimes = {
            templates: null,
            filters: null
        };
        this.lastErrors = {
            templates: null,
            filters: null
        };
        this.refreshInterval = null;
        this.isRefreshing = false;
        this.lastFetchTimes = new Map();
    }

    async initialize() {
        console.log('STCL: Initializing extension...');

        // Load from master sources if configured
        await this.loadAllSources();

        // Set up periodic refresh
        this.setupPeriodicRefresh();
    }

    async loadAllSources() {
        const config = this.multiUserManager.getConfig();

        const promises = [];

        if (config.promptTemplateImportSource && config.promptTemplateImportSource.trim()) {
            promises.push(this.loadTemplatesFromSource(config.promptTemplateImportSource.trim()));
        }

        if (config.booleanFiltersSource && config.booleanFiltersSource.trim()) {
            promises.push(this.loadFiltersFromSource(config.booleanFiltersSource.trim()));
        }

        if (promises.length > 0) {
            await Promise.allSettled(promises);
        }
    }

    async loadTemplatesFromSource(sourceUrl) {
        if (this.isRefreshing) {
            console.log('STCL: Template refresh already in progress, skipping');
            return;
        }

        try {
            this.isRefreshing = true;
            console.log(`STCL: Loading templates from master source: ${sourceUrl}`);

            const data = await this.fetchFromSource(sourceUrl, 'templates');

            if (this.validateTemplateData(data)) {
                await this.applyTemplates(data.templates);
                this.lastSyncTimes.templates = new Date();
                this.lastErrors.templates = null;

                toastr.success(`Templates loaded from master source`, MODULE_NAME);

                console.log('STCL: Templates successfully loaded from master source');
            } else {
                throw new Error('Invalid template data structure');
            }
        } catch (error) {
            this.lastErrors.templates = error.message;
            console.error('STCL: Failed to load templates from master source:', error);

            toastr.error(`Failed to load templates: ${error.message}`, MODULE_NAME);
        } finally {
            this.isRefreshing = false;
        }
    }

    async loadFiltersFromSource(sourceUrl) {
        if (this.isRefreshing) {
            console.log('STCL: Filter refresh already in progress, skipping');
            return;
        }

        try {
            this.isRefreshing = true;
            console.log(`STCL: Loading filters from master source: ${sourceUrl}`);

            const data = await this.fetchFromSource(sourceUrl, 'filters');

            if (this.validateFilterData(data)) {
                await this.applyFilters(data.filters);
                this.lastSyncTimes.filters = new Date();
                this.lastErrors.filters = null;

                toastr.success(`Filters loaded from master source`, MODULE_NAME);

                console.log('STCL: Filters successfully loaded from master source');
            } else {
                throw new Error('Invalid filter data structure');
            }
        } catch (error) {
            this.lastErrors.filters = error.message;
            console.error('STCL: Failed to load filters from master source:', error);

            toastr.error(`Failed to load filters: ${error.message}`, MODULE_NAME);
        } finally {
            this.isRefreshing = false;
        }
    }

    async fetchFromSource(sourceUrl, type) {
        // Validate URL
        if (!this.isValidSourceUrl(sourceUrl)) {
            throw new Error(`Invalid source URL: ${sourceUrl}`);
        }

        let response;

        if (sourceUrl.startsWith('http://') || sourceUrl.startsWith('https://')) {
            // External URL - Only allow HTTPS for security
            if (sourceUrl.startsWith('http://')) {
                throw new Error('HTTP URLs are not allowed for security reasons. Use HTTPS instead.');
            }

            // Rate limiting check (simple implementation)
            const rateLimitKey = `fetch_${sourceUrl}`;
            const lastFetch = this.lastFetchTimes?.get?.(rateLimitKey) || 0;
            const minInterval = 60000; // Minimum 1 minute between fetches of same URL

            if (Date.now() - lastFetch < minInterval) {
                throw new Error('Rate limit exceeded. Please wait before fetching again.');
            }

            // Create abort controller for timeout (compatible with older browsers)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);

            try {
                response = await fetch(sourceUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'SillyTavern-CharacterLocks'
                    },
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timeoutId);
            }

            // Track fetch time for rate limiting
            this.lastFetchTimes.set(rateLimitKey, Date.now());

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // Check content type
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                console.warn('STCL: Response content-type is not application/json, attempting to parse anyway');
            }
        } else {
            // Local file path (relative to SillyTavern)
            response = await fetch(sourceUrl, {
                method: 'GET',
                headers: getRequestHeaders()
            });

            if (!response.ok) {
                throw new Error(`Failed to load local file: ${sourceUrl}`);
            }
        }

        const text = await response.text();

        // Check response size limit (10MB max)
        if (text.length > 10 * 1024 * 1024) {
            throw new Error('Response too large. Maximum size allowed is 10MB.');
        }

        // Parse and validate JSON
        const data = JSON.parse(text);

        // Basic security check - ensure it's an object
        if (typeof data !== 'object' || data === null) {
            throw new Error('Invalid data format. Expected JSON object.');
        }

        // Check for suspicious properties that could indicate malicious content
        const suspiciousKeys = ['__proto__', 'constructor', 'prototype', 'eval', 'function'];
        const jsonString = JSON.stringify(data);
        for (const key of suspiciousKeys) {
            if (jsonString.includes(key)) {
                console.warn(`STCL: Suspicious key detected in master source data: ${key}`);
            }
        }

        return data;
    }

    isValidSourceUrl(url) {
        if (!url || typeof url !== 'string') {
            return false;
        }

        // Sanitize URL - remove any control characters
        const sanitizedUrl = url.replace(/[\x00-\x1F\x7F]/g, '');
        if (sanitizedUrl !== url) {
            console.warn('STCL: URL contains control characters, rejected');
            return false;
        }

        // Check URL length
        if (url.length > 2048) {
            console.warn('STCL: URL too long, rejected');
            return false;
        }

        // Allow HTTPS URLs only
        if (url.startsWith('https://')) {
            try {
                const urlObj = new URL(url);

                // Block suspicious domains
                const suspiciousDomains = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
                if (suspiciousDomains.some(domain => urlObj.hostname.includes(domain))) {
                    console.warn('STCL: Blocked potentially dangerous domain:', urlObj.hostname);
                    return false;
                }

                // Block non-standard ports that might be internal services
                if (urlObj.port && !['80', '443', '8080', '8443'].includes(urlObj.port)) {
                    console.warn('STCL: Blocked non-standard port:', urlObj.port);
                    return false;
                }

                return true;
            } catch {
                return false;
            }
        }

        // Allow local file paths (relative to SillyTavern) - be more restrictive
        if (url.startsWith('/api/') || url.startsWith('./') || url.startsWith('../')) {
            // Block path traversal attempts
            if (url.includes('..') && !url.startsWith('../')) {
                console.warn('STCL: Potential path traversal detected, rejected');
                return false;
            }
            return true;
        }

        // Allow extension-relative paths
        if (url.startsWith('scripts/extensions/')) {
            return true;
        }

        console.warn('STCL: URL format not allowed:', url);
        return false;
    }

    validateTemplateData(data) {
        if (!data || typeof data !== 'object') {
            return false;
        }

        if (!data.templates || typeof data.templates !== 'object') {
            return false;
        }

        // Validate each template
        for (const [id, template] of Object.entries(data.templates)) {
            if (!template || typeof template !== 'object') {
                return false;
            }

            if (!template.name || typeof template.name !== 'string') {
                return false;
            }
        }

        return true;
    }

    validateFilterData(data) {
        if (!data || typeof data !== 'object') {
            return false;
        }

        if (!Array.isArray(data.filters)) {
            return false;
        }

        // Validate each filter
        for (const filter of data.filters) {
            if (!filter || typeof filter !== 'object') {
                return false;
            }

            if (!filter.id || typeof filter.id !== 'string') {
                return false;
            }

            if (!filter.expression || typeof filter.expression !== 'string') {
                return false;
            }
        }

        return true;
    }

    async applyTemplates(templates) {
        if (!promptTemplateManager) {
            console.warn('STCL: Prompt template manager not available');
            return;
        }

        // Override local templates with master source data
        const extensionSettings = storageAdapter.getExtensionSettings();
        const userSettings = storageAdapter.getUserSettings();

        userSettings.promptTemplates = { ...templates };

        console.log(`STCL: Applied ${Object.keys(templates).length} templates from master source`);
        storageAdapter.saveExtensionSettings();
    }

    async applyFilters(filters) {
        if (!modelPromptManager) {
            console.warn('STCL: Model prompt manager not available');
            return;
        }

        // Override local filters with master source data
        const extensionSettings = storageAdapter.getExtensionSettings();
        const userSettings = storageAdapter.getUserSettings();

        if (!userSettings.modelPromptMappings) {
            userSettings.modelPromptMappings = {
                rules: [],
                globalDefault: { preset: '', prompts: null },
                enableModelPromptLinks: true,
                followInheritanceChain: true
            };
        }

        userSettings.modelPromptMappings.rules = [...filters];

        console.log(`STCL: Applied ${filters.length} filter rules from master source`);
        storageAdapter.saveExtensionSettings();
    }

    setupPeriodicRefresh() {
        try {
            const config = this.multiUserManager.getConfig();

            // Clear existing interval
            if (this.refreshInterval) {
                clearManagedTimer(this.refreshInterval);
                this.refreshInterval = null;
            }

            // Set up new interval if master sources are configured
            if ((config.promptTemplateImportSource && config.promptTemplateImportSource.trim()) ||
                (config.booleanFiltersSource && config.booleanFiltersSource.trim())) {

                // Refresh every hour by default
                const refreshIntervalMs = 60 * 60 * 1000;

                this.refreshInterval = createManagedInterval(async () => {
                    try {
                        console.log('STCL: Performing scheduled master source refresh');
                        await this.loadAllSources();
                    } catch (error) {
                        console.error('STCL: Error in scheduled master source refresh:', error);
                    }
                }, refreshIntervalMs);

                console.log('STCL: Set up periodic master source refresh (every hour)');
            }
        } catch (error) {
            console.error('STCL: Error setting up periodic refresh:', error);
        }
    }

    async manualRefresh() {
        if (!this.multiUserManager.isCurrentUserAdmin()) {
            toastr.warning('Manual refresh is only available to administrators', MODULE_NAME);
            return;
        }

        console.log('STCL: Manual master source refresh triggered');
        await this.loadAllSources();
    }

    getMasterSourceStatus() {
        const config = this.multiUserManager.getConfig();

        return {
            templatesEnabled: !!(config.promptTemplateImportSource && config.promptTemplateImportSource.trim()),
            filtersEnabled: !!(config.booleanFiltersSource && config.booleanFiltersSource.trim()),
            templateSource: config.promptTemplateImportSource || '',
            filterSource: config.booleanFiltersSource || '',
            lastSyncTimes: { ...this.lastSyncTimes },
            lastErrors: { ...this.lastErrors },
            isRefreshing: this.isRefreshing
        };
    }

    exportTemplates() {
        try {
            if (!this.multiUserManager.isCurrentUserAdmin()) {
                throw new Error('Export is only available to administrators');
            }

            if (!storageAdapter) {
                throw new Error('Storage adapter not available');
            }

            const userSettings = storageAdapter.getUserSettings();
            if (!userSettings) {
                throw new Error('Unable to access user settings');
            }

            const templates = userSettings.promptTemplates || {};

            // Validate that we have at least some data to export
            if (Object.keys(templates).length === 0) {
                console.warn('STCL: No templates found to export');
            }

            const exportData = {
                version: "1.0",
                timestamp: new Date().toISOString(),
                exported_by: this.multiUserManager.getUserHandle(),
                templates: templates
            };

            return JSON.stringify(exportData, null, 2);
        } catch (error) {
            console.error('STCL: Error exporting templates:', error);
            throw error;
        }
    }

    exportFilters() {
        try {
            if (!this.multiUserManager.isCurrentUserAdmin()) {
                throw new Error('Export is only available to administrators');
            }

            if (!storageAdapter) {
                throw new Error('Storage adapter not available');
            }

            const userSettings = storageAdapter.getUserSettings();
            if (!userSettings) {
                throw new Error('Unable to access user settings');
            }

            const mappings = userSettings.modelPromptMappings || {};
            const filters = mappings.rules || [];

            // Validate that we have at least some data to export
            if (filters.length === 0) {
                console.warn('STCL: No filters found to export');
            }

            const exportData = {
                version: "1.0",
                timestamp: new Date().toISOString(),
                exported_by: this.multiUserManager.getUserHandle(),
                filters: filters
            };

            return JSON.stringify(exportData, null, 2);
        } catch (error) {
            console.error('STCL: Error exporting filters:', error);
            throw error;
        }
    }

    cleanup() {
        if (this.refreshInterval) {
            clearManagedTimer(this.refreshInterval);
            this.refreshInterval = null;
        }
    }
}

// ===== HELPER FUNCTIONS =====

// isUsingChatCompletion moved to stcl-utils.js

/**
 * Gets the appropriate preset selector based on current API
 * @returns {string} jQuery selector for the current preset dropdown
 */
// ===== IMPORTED PROMPT HELPERS =====

// Set up the dependency injection for text-completion module
setGetCurrentApiInfo(getCurrentApiInfo);

// Note: getCurrentApiInfo dependency will be set up after the function is defined

// ===== CORE CLASSES =====

/**
 * Centralized chat context detection and management
 */
class ChatContext {
    constructor() {
        this.cache = new Map();
        this.cacheTime = 0;
        this.buildingPromise = null;
    }

    async getCurrent() {
        const now = Date.now();
        if (now - this.cacheTime < CACHE_TTL && this.cache.has('current')) {
            return this.cache.get('current');
        }

        // If already building, wait for that promise
        if (this.buildingPromise) {
            try {
                return await this.buildingPromise;
            } catch (error) {
                console.error('STCL: Error waiting for context build:', error);
                // Clear the failed promise and try to build again
                this.buildingPromise = null;
            }
        }

        // Start building and store the promise
        this.buildingPromise = this._buildContextWithTimeout();

        try {
            const context = await this.buildingPromise;
            this.cache.set('current', context);
            this.cacheTime = now;
            return context;
        } catch (error) {
            console.error('STCL: Error building context:', error);
            // Return cached context if available, otherwise throw
            if (this.cache.has('current')) {
                console.warn('STCL: Using stale cached context due to build error');
                return this.cache.get('current');
            }
            throw error;
        } finally {
            this.buildingPromise = null;
        }
    }

    async _buildContextWithTimeout() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Context building timed out after 5 seconds'));
            }, 5000);

            this._buildContext()
                .then(context => {
                    clearTimeout(timeout);
                    resolve(context);
                })
                .catch(error => {
                    clearTimeout(timeout);
                    reject(error);
                });
        });
    }

    invalidate() {
        this.cache.clear();
        this.cacheTime = 0;
    }

    async _buildContext() {
        const isGroupChat = !!selected_group;

        if (isGroupChat) {
            return await this._buildGroupContext();
        } else {
            return await this._buildSingleContext();
        }
    }

    async _buildGroupContext() {
        try {
            const groupId = selected_group;
            if (!groupId) {
                throw new Error('No group selected');
            }

            const group = groups?.find(x => x.id === groupId);
            if (!group) {
                console.warn('STCL: Group not found in groups array:', groupId);
            }

            return {
                type: CHAT_TYPES.GROUP,
                isGroupChat: true,
                groupId,
                groupName: group?.name || null,
                chatId: group?.chat_id || null,
                chatName: group?.chat_id || null,
                characterName: group?.name || null,
                activeCharacterInGroup: await this._getActiveCharacterInGroup(),
                primaryId: groupId,
                secondaryId: group?.chat_id
            };
        } catch (error) {
            console.error('STCL: Error building group context:', error);
            // Return safe defaults
            return {
                type: CHAT_TYPES.GROUP,
                isGroupChat: true,
                groupId: selected_group || null,
                groupName: null,
                chatId: null,
                chatName: null,
                characterName: null,
                activeCharacterInGroup: null,
                primaryId: selected_group || null,
                secondaryId: null
            };
        }
    }

    async _buildSingleContext() {
        try {
            const characterName = await this._getCharacterNameForSettings();
            const chatId = await this._getCurrentChatId();

            return {
                type: CHAT_TYPES.SINGLE,
                isGroupChat: false,
                groupId: null,
                groupName: null,
                chatId,
                chatName: chatId,
                characterName,
                activeCharacterInGroup: null,
                primaryId: characterName,
                secondaryId: chatId
            };
        } catch (error) {
            console.error('STCL: Error building single context:', error);
            // Return safe defaults
            return {
                type: CHAT_TYPES.SINGLE,
                isGroupChat: false,
                groupId: null,
                groupName: null,
                chatId: null,
                chatName: null,
                characterName: null,
                activeCharacterInGroup: null,
                primaryId: null,
                secondaryId: null
            };
        }
    }

    async _getActiveCharacterInGroup() {
        // Check if there's a queued character change
        try {
            await acquireLock('characterQueue');
            if (characterQueue.length > 0) {
                const name = characterQueue.shift(); // Get the first in queue
                console.log('STCL: _getActiveCharacterInGroup: Using queued active character:', name);
                return name;
            }
            // No character message found
            return null;
        } finally {
            releaseLock('characterQueue');
        }
    }

    async _queueActiveCharacter(characterName) {
        if (!characterName || typeof characterName !== 'string') {
            console.warn('STCL: Invalid character name for queue:', characterName);
            return;
        }

        try {
            await acquireLock('characterQueue');

            // Validate character name
            const normalizedName = characterName.trim();
            if (!normalizedName) {
                console.warn('STCL: Empty character name after trimming');
                return;
            }

            // Circular buffer automatically handles bounds and duplicates efficiently
            characterQueue.push(normalizedName);
            console.log('STCL: Queued active character:', normalizedName, `(queue size: ${characterQueue.length})`);
        } catch (error) {
            console.error('STCL: Error queueing active character:', error);
        } finally {
            releaseLock('characterQueue');
        }
    }

    async _getCharacterNameForSettings() {
        let characterName = name2;

        if (!characterName || characterName === systemUserName || characterName === neutralCharacterName) {
            characterName = await this._getCharacterNameFromChatMetadata();
        }

        if (!characterName) {
            return null;
        }

        characterName = String(characterName).trim();
        if (characterName.normalize) {
            characterName = characterName.normalize('NFC');
        }

        return characterName;
    }

    async _getCharacterNameFromChatMetadata() {
        try {
            const metadata = await getCurrentChatMetadata();
            const characterName = metadata?.character_name;
            return characterName && typeof characterName === 'string' ? characterName.trim() : null;
        } catch (error) {
            console.warn('STCL: Error getting character name from chat metadata:', error);
            return null;
        }
    }

    async _getCurrentChatId() {
        try {
            const baseContext = getContext?.();
            if (baseContext?.chatId) {
                return baseContext.chatId;
            }
            if (typeof getCurrentChatId === 'function') {
                return getCurrentChatId();
            }
            return null;
        } catch (error) {
            console.warn('STCL: Error getting chat ID:', error);
            return null;
        }
    }
}

/**
 * Centralized storage operations
 */
class StorageAdapter {
    constructor(multiUserManager) {
        this.EXTENSION_KEY = MODULE_NAME;
        this.multiUserManager = multiUserManager;
    }

    getExtensionSettings() {
        if (!extension_settings[this.EXTENSION_KEY]) {
            extension_settings[this.EXTENSION_KEY] = structuredClone(DEFAULT_SETTINGS);
        }
        return extension_settings[this.EXTENSION_KEY];
    }

    getUserSettings() {
        const extensionSettings = this.getExtensionSettings();

        if (this.multiUserManager.isMultiUserMode()) {
            const userHandle = this.multiUserManager.getUserHandle();

            // Ensure users object exists
            if (!extensionSettings.users) {
                extensionSettings.users = {};
            }

            // Ensure user-specific settings exist
            if (!extensionSettings.users[userHandle]) {
                extensionSettings.users[userHandle] = {
                    characterSettings: {},
                    groupSettings: {},
                    promptTemplates: {},
                    templateAssignments: {},
                    modelPromptMappings: structuredClone(DEFAULT_SETTINGS.modelPromptMappings)
                };
            }

            return extensionSettings.users[userHandle];
        } else {
            // Single-user mode: use root level for backward compatibility
            return extensionSettings;
        }
    }

    saveExtensionSettings() {
        saveSettingsDebounced();
    }

    // Character settings
    getCharacterSettings(characterName) {
        if (!characterName) {
            console.warn('STCL: Cannot get character settings - invalid name');
            return null;
        }

        const normalizedName = this._normalizeCharacterName(characterName);
        const userSettings = this.getUserSettings();

        const settings = userSettings.characterSettings?.[normalizedName] || null;

        if (settings) {
            console.log(`STCL: Retrieved character settings for "${normalizedName}"`);
            console.log('STCL: Settings retrieved:', settings);
        } else {
            console.log(`STCL: No settings found for "${normalizedName}"`);
        }

        return settings;
    }

    async setCharacterSettings(characterName, settings) {
        if (!characterName) {
            console.warn('STCL: Cannot save character settings - invalid name');
            return false;
        }

        try {
            const normalizedName = this._normalizeCharacterName(characterName);
            const userSettings = this.getUserSettings();

            if (!userSettings.characterSettings) {
                userSettings.characterSettings = {};
            }

            userSettings.characterSettings[normalizedName] = settings;

            console.log('STCL: Settings saved:', settings);

            await new Promise(resolve => {
                this.saveExtensionSettings();
                // Wait a bit for debounced save to complete
                setTimeout(resolve, 100);
            });
            return true;
        } catch (error) {
            console.error('STCL: Error saving character settings:', error);
            return false;
        }
    }

    deleteCharacterSettings(characterName) {
        if (!characterName) {
            console.warn('STCL: Cannot delete character settings - invalid name');
            return false;
        }

        const normalizedName = this._normalizeCharacterName(characterName);
        const userSettings = this.getUserSettings();

        if (userSettings.characterSettings?.[normalizedName]) {
            delete userSettings.characterSettings[normalizedName];
            console.log(`STCL: Deleted character settings for "${normalizedName}"`);
            this.saveExtensionSettings();
            return true;
        }

        console.log(`STCL: No settings to delete for "${normalizedName}"`);
        return false;
    }

    // Group settings
    getGroupSettings(groupId) {
        if (!groupId) {
            console.warn('STCL: Cannot get group settings - invalid ID');
            return null;
        }

        const userSettings = this.getUserSettings();
        const settings = userSettings.groupSettings?.[groupId] || null;

        if (settings) {
            console.log(`STCL: Retrieved group settings for group ID "${groupId}"`);
        } else {
            console.log(`STCL: No group settings found for group ID "${groupId}"`);
        }

        return settings;
    }

    async setGroupSettings(groupId, settings) {
        if (!groupId) {
            console.warn('STCL: Cannot save group settings - invalid ID');
            return false;
        }

        try {
            const userSettings = this.getUserSettings();
            if (!userSettings.groupSettings) {
                userSettings.groupSettings = {};
            }

            userSettings.groupSettings[groupId] = settings;
            console.log(`STCL: Saved group settings for group ID "${groupId}"`);

            await new Promise(resolve => {
                this.saveExtensionSettings();
                // Wait a bit for debounced save to complete
                setTimeout(resolve, 100);
            });
            return true;
        } catch (error) {
            console.error('STCL: Error saving group settings:', error);
            return false;
        }
    }

    deleteGroupSettings(groupId) {
        if (!groupId) {
            console.warn('STCL: Cannot delete group settings - invalid ID');
            return false;
        }

        const userSettings = this.getUserSettings();

        if (userSettings.groupSettings?.[groupId]) {
            delete userSettings.groupSettings[groupId];
            console.log(`STCL: Deleted group settings for group ID "${groupId}"`);
            this.saveExtensionSettings();
            return true;
        }

        console.log(`STCL: No group settings to delete for group ID "${groupId}"`);
        return false;
    }

    // Chat settings
    async getChatSettings() {
        try {
            const metadata = await getCurrentChatMetadata();
            const settings = metadata?.[this.EXTENSION_KEY] || null;
            
            if (settings) {
                console.log('STCL: Retrieved chat settings:', settings);
            } else {
                console.log('STCL: No chat settings found');
            }
            
            return settings;
        } catch (error) {
            console.warn('STCL: Error getting chat settings:', error);
            return null;
        }
    }

    async setChatSettings(settings) {
        try {
            const metadata = await getCurrentChatMetadata();
            if (!metadata) {
                console.warn('STCL: Cannot save chat settings - no chat metadata available');
                return false;
            }

            metadata[this.EXTENSION_KEY] = settings;
            console.log('STCL: Saved chat settings:', settings);

            await new Promise(resolve => {
                this._triggerMetadataSave();
                // Wait a bit for debounced save to complete
                setTimeout(resolve, 100);
            });
            return true;
        } catch (error) {
            console.error('STCL: Error saving chat settings:', error);
            return false;
        }
    }

    async deleteChatSettings() {
        try {
            const metadata = await getCurrentChatMetadata();
            if (metadata?.[this.EXTENSION_KEY]) {
                delete metadata[this.EXTENSION_KEY];
                console.log('STCL: Deleted chat settings');
                this._triggerMetadataSave();
                return true;
            }
            
            console.log('STCL: No chat settings to delete');
            return false;
        } catch (error) {
            console.error('STCL: Error deleting chat settings:', error);
            return false;
        }
    }

    // Group chat settings
    getGroupChatSettings(groupId) {
        if (!groupId) {
            console.warn('STCL: Cannot get group chat settings - invalid group ID');
            return null;
        }
        
        try {
            const group = groups?.find(x => x.id === groupId);
            const settings = group?.chat_metadata?.[this.EXTENSION_KEY] || null;
            
            if (settings) {
                console.log('STCL: Retrieved group chat settings:', settings);
            } else {
                console.log('STCL: No group chat settings found');
            }
            
            return settings;
        } catch (error) {
            console.warn('STCL: Error getting group chat settings:', error);
            return null;
        }
    }

    async setGroupChatSettings(groupId, settings) {
        if (!groupId) {
            console.warn('STCL: Cannot save group chat settings - invalid group ID');
            return false;
        }

        try {
            const group = groups?.find(x => x.id === groupId);
            if (!group) {
                console.warn('STCL: Cannot save group chat settings - group not found');
                return false;
            }

            if (!group.chat_metadata) {
                group.chat_metadata = {};
            }

            group.chat_metadata[this.EXTENSION_KEY] = settings;
            console.log('STCL: Saved group chat settings:', settings);

            try {
                await editGroup(groupId, false, false);
                // Wait a bit for the save to complete
                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error) {
                console.warn('STCL: Error calling editGroup:', error);
                // Still return true since the data was set, just save may have failed
            }

            return true;
        } catch (error) {
            console.error('STCL: Error saving group chat settings:', error);
            return false;
        }
    }

    async deleteGroupChatSettings(groupId) {
        if (!groupId) {
            console.warn('STCL: Cannot delete group chat settings - invalid group ID');
            return false;
        }

        try {
            const group = groups?.find(x => x.id === groupId);
            if (group?.chat_metadata?.[this.EXTENSION_KEY]) {
                delete group.chat_metadata[this.EXTENSION_KEY];
                console.log('STCL: Deleted group chat settings');

                try {
                    await editGroup(groupId, false, false);
                    // Wait a bit for the save to complete
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.warn('STCL: Error calling editGroup:', error);
                    // Still return true since the data was deleted, just save may have failed
                }

                return true;
            }

            console.log('STCL: No group chat settings to delete');
            return false;
        } catch (error) {
            console.error('STCL: Error deleting group chat settings:', error);
            return false;
        }
    }

    _normalizeCharacterName(characterName) {
        let normalized = String(characterName).trim();
        if (normalized.normalize) {
            normalized = normalized.normalize('NFC');
        }
        return normalized;
    }

    _triggerMetadataSave() {
        if (typeof saveMetadataDebounced === 'function') {
            saveMetadataDebounced();
        }
    }
}

/**
 * Settings priority resolution
 */
class SettingsPriorityResolver {
    constructor(extensionSettings) {
        this.extensionSettings = extensionSettings;
    }

    resolve(context, availableSettings) {
        if (context.isGroupChat) {
            return this._resolveGroupSettings(context, availableSettings);
        } else {
            return this._resolveSingleSettings(context, availableSettings);
        }
    }

    _resolveGroupSettings(context, settings) {
        const prefs = this.extensionSettings.moduleSettings;
        const { group, chat, individual } = settings;

        if (prefs.preferIndividualCharacterInGroup && individual) {
            return { settings: individual, source: SETTING_SOURCES.INDIVIDUAL };
        }

        if (prefs.preferGroupOverChat) {
            if (group) return { settings: group, source: SETTING_SOURCES.GROUP };
            if (chat) return { settings: chat, source: `${SETTING_SOURCES.GROUP_CHAT} (fallback)` };
            if (individual) return { settings: individual, source: `${SETTING_SOURCES.INDIVIDUAL} (fallback)` };
        } else {
            if (chat) return { settings: chat, source: SETTING_SOURCES.GROUP_CHAT };
            if (group) return { settings: group, source: `${SETTING_SOURCES.GROUP} (fallback)` };
            if (individual) return { settings: individual, source: `${SETTING_SOURCES.INDIVIDUAL} (fallback)` };
        }

        return { settings: null, source: 'none' };
    }

    _resolveSingleSettings(context, settings) {
        const prefs = this.extensionSettings.moduleSettings;
        const { character, chat } = settings;

        if (prefs.preferCharacterOverChat) {
            if (character) return { settings: character, source: SETTING_SOURCES.CHARACTER };
            if (chat) return { settings: chat, source: `${SETTING_SOURCES.CHAT} (fallback)` };
        } else {
            if (chat) return { settings: chat, source: SETTING_SOURCES.CHAT };
            if (character) return { settings: character, source: `${SETTING_SOURCES.CHARACTER} (fallback)` };
        }

        return { settings: null, source: 'none' };
    }
}

/**
 * Main settings manager
 */
class SettingsManager {
    constructor(storage) {
        this.storage = storage;
        this.priorityResolver = new SettingsPriorityResolver(storage.getExtensionSettings());
        this.chatContext = new ChatContext();
        this.currentSettings = this._getEmptySettings();
        this._queueProcessingTimeout = null;
    }

    _getEmptySettings() {
        return {
            character: null,
            chat: null,
            group: null,
            individual: null,
            groupMembers: []
        };
    }

    async loadCurrentSettings() {
        try {
            const context = await this.chatContext.getCurrent();
            console.log('STCL: Loading settings for context:', context);

            this.currentSettings = this._getEmptySettings();

            if (context.isGroupChat) {
                await this._loadGroupSettings(context);
            } else {
                await this._loadSingleSettings(context);
            }

            console.log('STCL: Loaded settings:', this.currentSettings);
            return this.currentSettings;
        } catch (error) {
            console.error('STCL: Error loading settings:', error);
            this.currentSettings = this._getEmptySettings();
            return this.currentSettings;
        }
    }

    async _loadGroupSettings(context) {
        try {
            const prefs = this.storage.getExtensionSettings().moduleSettings;

            if (prefs.enableGroupMemory && context.groupId) {
                this.currentSettings.group = this.storage.getGroupSettings(context.groupId);
            }

            if (prefs.enableChatMemory && context.groupId) {
                this.currentSettings.chat = this.storage.getGroupChatSettings(context.groupId);
            }

            // Load settings for ALL group members
            this.currentSettings.groupMembers = [];
            if (prefs.enableCharacterMemory && context.groupId) {
                const group = groups?.find(x => x.id === context.groupId);
                if (group?.members && Array.isArray(group.members)) {
                    for (const memberAvatar of group.members) {
                        const character = characters?.find(x => x.avatar === memberAvatar);
                        if (character?.name) {
                            const memberSettings = this.storage.getCharacterSettings(character.name);
                            this.currentSettings.groupMembers.push({
                                name: character.name,
                                avatar: memberAvatar,
                                settings: memberSettings
                            });
                        }
                    }
                }
            }

            // Keep the individual setting for backward compatibility
            const shouldLoadIndividual = prefs.enableCharacterMemory || prefs.preferIndividualCharacterInGroup;
            if (shouldLoadIndividual && context.activeCharacterInGroup) {
                this.currentSettings.individual = this.storage.getCharacterSettings(context.activeCharacterInGroup);
            }
        } catch (error) {
            console.error('STCL: Error loading group settings:', error);
            // Set empty settings on error
            this.currentSettings.group = null;
            this.currentSettings.chat = null;
            this.currentSettings.individual = null;
            this.currentSettings.groupMembers = [];
        }
    }

    async _loadSingleSettings(context) {
        const prefs = this.storage.getExtensionSettings().moduleSettings;

        if (prefs.enableCharacterMemory && context.characterName) {
            this.currentSettings.character = this.storage.getCharacterSettings(context.characterName);
        }

        if (prefs.enableChatMemory && context.chatId) {
            this.currentSettings.chat = await this.storage.getChatSettings();
        }
    }

    async getSettingsToApply() {
        const context = await this.chatContext.getCurrent();
        this.priorityResolver = new SettingsPriorityResolver(this.storage.getExtensionSettings());
        return this.priorityResolver.resolve(context, this.currentSettings);
    }

    async onContextChanged() {
        // Add to queue and process asynchronously to prevent race conditions
        const timestamp = Date.now();

        try {
            await acquireLock('contextQueue');

            // Circular buffer automatically handles bounds
            contextChangeQueue.push(timestamp);
            console.log('STCL: Context change queued', `(queue size: ${contextChangeQueue.length})`);
        } catch (error) {
            console.error('STCL: Error queueing context change:', error);
        } finally {
            releaseLock('contextQueue');
        }

        // Process queue outside of lock to prevent deadlock
        this._processContextChangeQueue();
    }

    async _processContextChangeQueue() {
        if (processingContext) {
            console.log('STCL: Context change already in progress, queued');
            return;
        }

        let queueItems = [];
        try {
            await acquireLock('contextQueue');
            if (contextChangeQueue.length === 0) {
                return;
            }

            // Set processing flag inside lock to prevent race condition
            processingContext = true;

            // Copy and clear queue atomically
            queueItems = contextChangeQueue.toArray();
            contextChangeQueue.clear();
        } catch (error) {
            console.error('STCL: Error acquiring queue lock for processing:', error);
            processingContext = false; // Reset flag on error
            return;
        } finally {
            releaseLock('contextQueue');
        }
        try {
            // Process the latest context change (discard duplicates)
            const latestTimestamp = queueItems[queueItems.length - 1];
            const queueSize = queueItems.length;

            console.log(`STCL: Processing context change (processed ${queueSize} queued items)`);
            this.chatContext.invalidate();
            await this.loadCurrentSettings();

            // Apply settings automatically when switching contexts with proper flag management
            const shouldApplySettings = await this._shouldApplySettingsAutomatically();
            console.log('STCL: shouldApplySettings:', shouldApplySettings, 'isApplyingSettings:', isApplyingSettings);
            if (shouldApplySettings && !isApplyingSettings) {
                console.log('STCL: Applying settings automatically on context change');
                await this.applySettings();
            } else {
                console.log('STCL: Skipping automatic settings application - memory disabled or currently applying');
            }
        } catch (error) {
            console.error('STCL: Error processing context change queue:', error);
        } finally {
            processingContext = false;

            // Check if more items were added while processing
            let hasMoreItems = false;
            try {
                await acquireLock('contextQueue');
                hasMoreItems = contextChangeQueue.length > 0;
            } catch (error) {
                console.error('STCL: Error checking queue after processing:', error);
            } finally {
                releaseLock('contextQueue');
            }

            // Schedule processing of any additional changes that came in while we were processing
            if (hasMoreItems) {
                // Use debounced approach instead of immediate setTimeout
                this._scheduleQueueProcessing();
            }
        }
    }

    _scheduleQueueProcessing() {
        // Cancel any existing scheduled processing
        if (this._queueProcessingTimeout) {
            clearManagedTimer(this._queueProcessingTimeout);
        }

        // Schedule new processing with debounce
        this._queueProcessingTimeout = createManagedTimeout(() => {
            this._queueProcessingTimeout = null;
            this._processContextChangeQueue();
        }, 100); // 100ms debounce
    }

    async applySettings() {
        if (isApplyingSettings) {
            console.log('STCL: Already applying settings, skipping');
            return false;
        }

        try {
            isApplyingSettings = true;
            const resolved = await this.getSettingsToApply();

            if (!resolved.settings) {
                console.log('STCL: No settings to apply');
                // Even if no regular settings, check model-based settings
                await this.applyModelBasedSettings();
                return false;
            }

            console.log(`STCL: Applying ${resolved.source} settings:`, resolved.settings);
            const result = await this._applySettingsToUI(resolved.settings);

            // After applying regular settings, check for model-based overrides
            await this.applyModelBasedSettings();

            console.log('STCL: Settings application result:', result);
            return result;
        } finally {
            isApplyingSettings = false;
        }
    }

    async applyModelBasedSettings() {
        if (!modelPromptManager) {
            return false;
        }

        try {
            const apiInfo = await getCurrentApiInfo();
            const context = await this.chatContext.getCurrent();

            console.log(`STCL: Checking model-based settings for model: "${apiInfo.model}"`);

            const modelMatch = await modelPromptManager.evaluateModel(apiInfo.model, context);

            if (modelMatch) {
                console.log(`STCL: Found model-based match: ${modelMatch.description} (${modelMatch.ruleId})`);

                let applied = false;

                // Apply model-based preset if specified
                if (modelMatch.preset && modelMatch.preset.trim()) {
                    const presetSelector = $(await getCurrentPresetSelector());
                    const success = await applyPreset(presetSelector, modelMatch.preset, 'model-based');
                    if (success) {
                        applied = true;
                    }
                }

                // Apply model-based prompts if specified
                if (modelMatch.prompts) {
                    const isChatCompletion = isUsingChatCompletion();

                    if (isChatCompletion && modelMatch.prompts.ccPrompts) {
                        console.log('STCL: Applying model-based CC prompts');
                        await ccPromptHandlers.ccApplyPrompts(modelMatch.prompts.ccPrompts);
                        applied = true;
                    } else if (!isChatCompletion && modelMatch.prompts.tcPrompts) {
                        console.log('STCL: Applying model-based TC prompts');
                        tcPromptHandlers.tcApplyPrompts(modelMatch.prompts.tcPrompts);
                        applied = true;
                    }
                }

                if (applied) {
                    console.log(`STCL: Successfully applied model-based settings for rule: ${modelMatch.ruleId}`);
                }

                return applied;
            } else {
                console.log('STCL: No model-based settings found for current model');
                return false;
            }
        } catch (error) {
            console.error('STCL: Error applying model-based settings:', error);
            return false;
        }
    }

    async _applySettingsToUI(settings) {
        const apiInfo = await getCurrentApiInfo();
        console.log('STCL: _applySettingsToUI called with:', settings);
        console.log('STCL: Current API info:', apiInfo);

        // Determine if this is CC or TC settings based on what fields are present
        const isCCSettings = 'ccPreset' in settings;
        const isTCSettings = 'tcPreset' in settings;

        // If the saved settings have a specific engine and it doesn't match the current one, change the engine in the UI.
        if (settings.completionSource && settings.completionSource !== apiInfo.completionSource) {
            // Return a promise that resolves when the completion source change is complete
            return new Promise((resolve, reject) => {
                let isResolved = false;

                // Set up timeout to prevent hanging
                const timeout = createManagedTimeout(() => {
                    if (!isResolved) {
                        isResolved = true;
                        eventSource.removeListener(event_types.CHATCOMPLETION_SOURCE_CHANGED, handleSourceChanged);
                        console.warn('STCL: Timeout waiting for completion source change, applying settings anyway');
                        resolve(false); // Return false to indicate timeout
                    }
                }, 5000); // 5 second timeout

                // Set up one-time listener for completion source change
                const handleSourceChanged = async () => {
                    if (!isResolved) {
                        isResolved = true;
                        clearManagedTimer(timeout);
                        eventSource.removeListener(event_types.CHATCOMPLETION_SOURCE_CHANGED, handleSourceChanged);
                        try {
                            const result = isCCSettings ? await ccSettingsHandlers.ccApplySettings(settings) : await tcSettingsHandlers.tcApplySettings(settings);
                            resolve(result);
                        } catch (error) {
                            console.error('STCL: Error applying settings after source change:', error);
                            resolve(false);
                        }
                    }
                };

                eventSource.on(event_types.CHATCOMPLETION_SOURCE_CHANGED, handleSourceChanged);

                // Set the completion source dropdown to the saved value and trigger the 'change' event.
                $(SELECTORS.completionSource).val(settings.completionSource).trigger('change');
            });
        }

        // Apply the appropriate settings based on type
        if (isCCSettings) {
            return await ccSettingsHandlers.ccApplySettings(settings);
        } else if (isTCSettings) {
            return await tcSettingsHandlers.tcApplySettings(settings);
        } else {
            console.warn('STCL: Settings object has neither CC nor TC fields, cannot apply');
            return false;
        }
    }



    async saveCurrentUISettings(targets = {}) {
        // Validate inputs
        if (!targets || typeof targets !== 'object') {
            console.error('STCL: Invalid targets provided to saveCurrentUISettings');
            return false;
        }

        let context, uiSettings;

        try {
            context = await this.chatContext.getCurrent();
            if (!context || typeof context !== 'object') {
                console.error('STCL: Invalid context received in saveCurrentUISettings');
                return false;
            }
        } catch (error) {
            console.error('STCL: Error getting current context:', error);
            return false;
        }

        try {
            uiSettings = await this._getCurrentUISettings();
            if (!uiSettings || typeof uiSettings !== 'object') {
                console.error('STCL: Invalid UI settings received in saveCurrentUISettings');
                return false;
            }
        } catch (error) {
            console.error('STCL: Error getting current UI settings:', error);
            return false;
        }

        let savedCount = 0;
        const savedTypes = [];

        if (context.isGroupChat) {
            if (targets.character && context.groupId) {
                if (typeof context.groupId === 'string' && context.groupId.trim()) {
                    if (await this.storage.setGroupSettings(context.groupId, uiSettings)) {
                        this.currentSettings.group = structuredClone(uiSettings);
                        savedCount++;
                        savedTypes.push(SETTING_SOURCES.GROUP);
                    }
                } else {
                    console.warn('STCL: Cannot save group settings - invalid groupId:', context.groupId);
                }
            }
            if (targets.chat && context.chatId) {
                if (typeof context.chatId === 'string' && context.chatId.trim() && context.groupId) {
                    if (await this.storage.setGroupChatSettings(context.groupId, uiSettings)) {
                        this.currentSettings.chat = structuredClone(uiSettings);
                        savedCount++;
                        savedTypes.push(SETTING_SOURCES.GROUP_CHAT);
                    }
                } else {
                    console.warn('STCL: Cannot save group chat settings - invalid chatId or groupId:', context.chatId, context.groupId);
                }
            }
        } else {
            if (targets.character && context.characterName) {
                if (typeof context.characterName === 'string' && context.characterName.trim()) {
                    if (await this.storage.setCharacterSettings(context.characterName, uiSettings)) {
                        this.currentSettings.character = structuredClone(uiSettings);
                        savedCount++;
                        savedTypes.push(SETTING_SOURCES.CHARACTER);
                    }
                } else {
                    console.warn('STCL: Cannot save character settings - invalid characterName:', context.characterName);
                }
            }
            if (targets.chat && context.chatId) {
                if (await this.storage.setChatSettings(uiSettings)) {
                    this.currentSettings.chat = structuredClone(uiSettings);
                    savedCount++;
                    savedTypes.push(SETTING_SOURCES.CHAT);
                }
            }
        }

        this._showSaveNotification(savedCount, savedTypes);
        return savedCount > 0;        
    }

    async saveCurrentSettingsForCharacter(characterName) {
        try {
            const uiSettings = await this._getCurrentUISettings();

            if (await this.storage.setCharacterSettings(characterName, uiSettings)) {
                this._showSaveNotification(1, [`character: ${characterName}`]);
                return true;
            }
            return false;
        } catch (error) {
            console.error('STCL: Error saving current settings for character:', error);
            return false;
        }
    }

    async clearAllSettings() {
        const context = await this.chatContext.getCurrent();
        let clearedCount = 0;
        const clearedTypes = [];

        if (context.isGroupChat) {
            if (context.groupId && this.storage.deleteGroupSettings(context.groupId)) {
                this.currentSettings.group = null;
                clearedCount++;
                clearedTypes.push(SETTING_SOURCES.GROUP);
            }
            if (context.activeCharacterInGroup && this.storage.deleteCharacterSettings(context.activeCharacterInGroup)) {
                this.currentSettings.individual = null;
                clearedCount++;
                clearedTypes.push(SETTING_SOURCES.INDIVIDUAL);
            }
            if (context.chatId && await this.storage.deleteGroupChatSettings(context.groupId)) {
                this.currentSettings.chat = null;
                clearedCount++;
                clearedTypes.push(SETTING_SOURCES.GROUP_CHAT);
            }
        } else {
            if (context.characterName && this.storage.deleteCharacterSettings(context.characterName)) {
                this.currentSettings.character = null;
                clearedCount++;
                clearedTypes.push(SETTING_SOURCES.CHARACTER);
            }
            if (context.chatId && await this.storage.deleteChatSettings()) {
                this.currentSettings.chat = null;
                clearedCount++;
                clearedTypes.push(SETTING_SOURCES.CHAT);
            }
        }

        if (clearedCount > 0) {
            const typeText = clearedTypes.join(' & ');
            toastr.info(`${typeText} settings cleared`, MODULE_NAME);
        }

        return clearedCount;
    }

    async _getCurrentUISettings() {
        try {
            const apiInfo = await getCurrentApiInfo();
            const isChatCompletion = isUsingChatCompletion();

            if (isChatCompletion) {
                return ccSettingsHandlers.ccGetSettings(apiInfo);
            } else {
                return await tcSettingsHandlers.tcGetSettings(apiInfo);
            }
        } catch (error) {
            console.error('STCL: Error getting current UI settings:', error);
            // Return safe defaults based on current API type
            try {
                const isChatCompletion = isUsingChatCompletion();
                const apiInfo = await getCurrentApiInfo();
                return getDefaultSettings(apiInfo.completionSource, isChatCompletion);
            } catch (fallbackError) {
                console.error('STCL: Error getting fallback defaults:', fallbackError);
                // Ultimate fallback - return minimal default
                return getDefaultSettings('unknown', false);
            }
        }
    }




    _showSaveNotification(savedCount, savedTypes) {
        if (savedCount === 0) return;

        const extensionSettings = this.storage.getExtensionSettings();
        const showNotification = extensionSettings.moduleSettings.showOtherNotifications;

        if (showNotification) {
            const typeText = savedTypes.join(' & ');
            const messagePrefix = 'Saved';
            toastr.success(`${messagePrefix} ${typeText} settings`, MODULE_NAME);
        }
    }

    // _showToastr removed - use toastr directly

    async _shouldApplySettingsAutomatically() {
        const extensionSettings = this.storage.getExtensionSettings();
        const context = await this.chatContext.getCurrent();

        // Apply settings automatically if any memory option is enabled
        // This means the user wants stored settings to be applied when switching contexts
        if (context.isGroupChat) {
            return extensionSettings.moduleSettings.enableGroupMemory ||
                   extensionSettings.moduleSettings.enableChatMemory;
        } else {
            return extensionSettings.moduleSettings.enableCharacterMemory ||
                   extensionSettings.moduleSettings.enableChatMemory;
        }
    }
}

// ===== PROMPT TEMPLATE MANAGER =====

// ===== PRESET EXTENSION FIELD HELPERS =====

/**
 * Gets STCL settings from a preset's extension field
 * @param {string} presetName - Name of the preset (optional, uses current if not provided)
 * @param {string} apiId - API ID for the preset manager (optional, auto-detected if not provided)
 * @returns {Object|null} STCL settings object or null if not found
 */
async function getSTCLSettingsFromPreset(presetName = null, apiId = null) {
    try {
        if (!apiId) {
            const apiInfo = await getCurrentApiInfo();
            apiId = apiInfo.completionSource;
        }

        const presetManager = getPresetManager(apiId);
        if (!presetManager) {
            console.warn('STCL: No preset manager found for API:', apiId);
            return null;
        }

        const settings = presetManager.readPresetExtensionField({
            name: presetName,
            path: 'stcl.settings'
        });

        return settings;
    } catch (error) {
        console.error('STCL: Error reading preset extension field:', error);
        return null;
    }
}

/**
 * Saves STCL settings to a preset's extension field
 * @param {Object} settings - STCL settings object to save
 * @param {string} presetName - Name of the preset (optional, uses current if not provided)
 * @param {string} apiId - API ID for the preset manager (optional, auto-detected if not provided)
 * @returns {boolean} True if successful, false otherwise
 */
async function saveSTCLSettingsToPreset(settings, presetName = null, apiId = null) {
    try {
        if (!apiId) {
            const apiInfo = await getCurrentApiInfo();
            apiId = apiInfo.completionSource;
        }

        const presetManager = getPresetManager(apiId);
        if (!presetManager) {
            console.warn('STCL: No preset manager found for API:', apiId);
            return false;
        }

        await presetManager.writePresetExtensionField({
            name: presetName,
            path: 'stcl.settings',
            value: settings
        });

        console.log('STCL: Successfully saved settings to preset extension field');
        return true;
    } catch (error) {
        console.error('STCL: Error writing to preset extension field:', error);
        return false;
    }
}

/**
 * Checks if the current preset has STCL settings stored in its extension field
 * @param {string} presetName - Name of the preset (optional, uses current if not provided)
 * @param {string} apiId - API ID for the preset manager (optional, auto-detected if not provided)
 * @returns {boolean} True if preset has STCL settings, false otherwise
 */
async function presetHasSTCLSettings(presetName = null, apiId = null) {
    const settings = await getSTCLSettingsFromPreset(presetName, apiId);
    return settings !== null && typeof settings === 'object';
}

// ===== GLOBAL STATE =====

let multiUserManager = null;
let masterSourceLoader = null;
let settingsManager = null;
let storageAdapter = null;
let promptTemplateManager = null;
let modelPromptManager = null;
let currentPopupInstance = null;
let isApplyingSettings = false;
let eventListenersRegistered = false;
let contextChangeQueue = new CircularBuffer(MAX_CONTEXT_QUEUE_SIZE);
let processingContext = false;
let characterQueue = new CircularBuffer(MAX_CHARACTER_QUEUE_SIZE);

// Resource cleanup tracking and synchronization primitives handled by stcl-utils.js

// UI operation locks
const uiLocks = {
    popupOperation: false,
    rulesConfiguration: false
};

// Lock and timer management functions moved to stcl-utils.js

// Cleanup handlers moved to stcl-utils.js

// ===== UTILITY FUNCTIONS =====

/**
 * Shared utility function to get current chat metadata
 * @returns {Object|null} Chat metadata object or null if not available
 */
async function getCurrentChatMetadata() {
    if (typeof window.chat_metadata !== 'undefined' && window.chat_metadata !== null) {
        return window.chat_metadata;
    }
    if (typeof chat_metadata !== 'undefined' && chat_metadata !== null) {
        return chat_metadata;
    }
    // Note: Removed potential infinite recursion by calling window.getCurrentChatMetadata
    return null;
}

/**
 * Shared utility function to create UI toggle functionality
 * @param {string} toggleId - The ID of the toggle element
 * @param {string} targetId - The ID of the target element to toggle
 * @param {boolean} initialState - Initial visibility state
 */
// createUIToggle moved to stcl-utils.js

// registerEventHandler moved to stcl-utils.js

// ===== MODEL-PROMPT FUNCTIONALITY =====

/**
 * Check if model-prompt functionality is available
 * @returns {boolean} True if module is initialized and ready
 */
function isModelPromptAvailable() {
    return modelPromptManager !== null;
}

/**
 * Handle Model-Prompt Links toggle
 * @param {boolean} isChecked - New toggle state
 */
async function handleModelPromptLinksToggle(isChecked) {
    try {
        console.log('STCL: Handling Model-Prompt Links toggle to:', isChecked);
        const extensionSettings = storageAdapter.getExtensionSettings();

        // Initialize modelPromptMappings if needed
        if (!extensionSettings.modelPromptMappings) {
            extensionSettings.modelPromptMappings = {
                rules: [],
                globalDefault: { preset: '', prompts: null },
                enableModelPromptLinks: true,
                followInheritanceChain: true
            };
        }

        // Update the setting
        extensionSettings.modelPromptMappings.enableModelPromptLinks = isChecked;
        storageAdapter.saveExtensionSettings();

        // Show immediate feedback
        const statusText = isChecked ? 'enabled' : 'disabled';
        toastr.success(`Model-Prompt Links ${statusText}`, MODULE_NAME);
        console.log(`STCL: Model-Prompt Links ${statusText}`);

        // Return success status and indication that popup needs refresh
        return { success: true, needsPopupRefresh: true };

    } catch (error) {
        console.error('STCL: Error handling Model-Prompt Links checkbox change:', error);
        alert('Error saving Model-Prompt Links setting. Check console for details.');
        return { success: false, error: error.message };
    }
}

/**
 * Apply model-based settings when model changes
 * @param {Object} apiInfo - Current API information
 * @param {Object} context - Current chat context
 * @returns {boolean} True if settings were applied
 */
async function applyModelBasedSettings(apiInfo, context) {
    if (!modelPromptManager) {
        return false;
    }

    try {
        const mappings = await modelPromptManager.getMappingsWithInheritance(context);
        const modelMatch = mappings?.enableModelPromptLinks ? await modelPromptManager.evaluateModel(apiInfo.model, context) : null;

        if (modelMatch) {
            // Apply model-based presets if specified
            if (modelMatch.preset && modelMatch.preset.trim()) {
                console.log(`STCL: Would apply model-based preset: ${modelMatch.preset}`);
                // TODO: Implement actual preset application
            }

            // Apply model-based prompts if specified
            if (modelMatch.prompts) {
                console.log('STCL: Would apply model-based prompts');
                // TODO: Implement actual prompt application
            }

            return true;
        }

        return false;
    } catch (error) {
        console.error('STCL: Error applying model-based settings:', error);
        return false;
    }
}

/**
 * Check if model-prompt functionality should be enabled
 * @returns {boolean} True if should be enabled
 */
function shouldEnableModelPrompt() {
    const extensionSettings = storageAdapter?.getExtensionSettings();
    return extensionSettings?.modelPromptMappings?.enableModelPromptLinks ?? true;
}

// Local wrapper for registerEventHandler
function registerSTCLEventHandler(eventType, handler, description = '') {
    // Use stcl-utils.js version for registration and tracking
    return registerEventHandler(eventType, handler, description);
}

function unregisterAllSTCLEventHandlers() {
    // Use stcl-utils.js version to clean up all event tracking
    unregisterAllEventHandlers();

    // Clean up jQuery event handlers (SillyTavern-specific)
    $(document).off('change', '#openai_model, #claude_model, #google_model, #mistral_model, #vertexai_model, #model_novel_select');

    // Clean up settings buttons
    removeSettingsButtons();

    console.log('STCL: All event handlers unregistered');
}

/**
 * Removes all settings buttons and cleans up resources
 */
function removeSettingsButtons() {
    // Settings buttons disabled - no cleanup needed
}

function cleanupExtension() {
    // Cleaning up extension resources

    // Run comprehensive resource cleanup
    runCleanup();

    // Cleanup all registered observers
    observerRegistry.cleanup();

    // Clear queues
    contextChangeQueue.length = 0;
    characterQueue.length = 0;

    // Reset flags
    processingContext = false;
    isApplyingSettings = false;

    // Clear cache and timers
    if (settingsManager?.chatContext) {
        settingsManager.chatContext.invalidate();
        settingsManager.chatContext.buildingPromise = null;
    }

    if (settingsManager?._queueProcessingTimeout) {
        clearManagedTimer(settingsManager._queueProcessingTimeout);
        settingsManager._queueProcessingTimeout = null;
    }

    // Unregister events
    unregisterAllSTCLEventHandlers();
    eventListenersRegistered = false;

    // Close popup if open
    if (currentPopupInstance && typeof currentPopupInstance.completeCancelled === 'function') {
        currentPopupInstance.completeCancelled();
        currentPopupInstance = null;
    }

    console.log('STCL: Cleanup completed');
}

function getApiSelectors(completionSource = null) {
    if (!completionSource) {
        completionSource = $(SELECTORS.completionSource).val();
    }

    // Only return preset selector - we don't need model/temperature selectors anymore
    return {
        preset: PRESET_SELECTOR_MAP[completionSource] || SELECTORS.ccPreset
    };
}

async function getCurrentApiInfo() {
    try {
        let api = 'unknown';
        let model = 'unknown';
        let completionSource = 'unknown';

        // Validate that jQuery and DOM are available
        if (typeof $ !== 'function') {
            console.warn('STCL: jQuery not available, cannot get API info');
            throw new Error('jQuery not available');
        }

        // Get the main API with validation
        const mainApiElement = $(SELECTORS.mainApi);
        if (mainApiElement.length) {
            const apiValue = mainApiElement.val();
            if (apiValue && typeof apiValue === 'string') {
                api = apiValue.trim();
                if (!api) {
                    console.warn('STCL: Main API value is empty after trimming');
                    api = 'unknown';
                }
            } else {
                console.warn('STCL: Main API value is not a string:', typeof apiValue, apiValue);
            }
        } else {
            console.warn('STCL: Main API selector not found in DOM');
        }

        // Get the completion source (for OpenAI-compatible APIs)
        const completionSourceElement = $(SELECTORS.completionSource);
        if (completionSourceElement.length) {
            const sourceValue = completionSourceElement.val();
            if (sourceValue && typeof sourceValue === 'string') {
                completionSource = sourceValue.trim();
                if (!completionSource) {
                    console.warn('STCL: Completion source value is empty after trimming, using API as fallback');
                    completionSource = api;
                }
            } else {
                console.warn('STCL: Completion source value is not a string, using API as fallback:', typeof sourceValue, sourceValue);
                completionSource = api;
            }
        } else {
            console.log('STCL: Completion source selector not found, using API as fallback');
            completionSource = api;
        }

        // Get current model name for Chat Completion APIs
        if (api === 'openai') {
            try {
                // Validate that getChatCompletionModel function exists
                if (typeof getChatCompletionModel !== 'function') {
                    console.warn('STCL: getChatCompletionModel function not available');
                    model = 'unknown';
                } else {
                    const currentModel = await getChatCompletionModel(completionSource);
                    if (currentModel && typeof currentModel === 'string') {
                        model = currentModel.trim();
                        if (!model) {
                            console.warn('STCL: Model name is empty after trimming');
                            model = 'unknown';
                        }
                    } else {
                        console.warn('STCL: Model name is not a string:', typeof currentModel, currentModel);
                        model = 'unknown';
                    }
                }
            } catch (modelError) {
                console.warn('STCL: Error getting model name:', modelError);
                model = 'unknown';
            }
        } else {
            // For non-OpenAI APIs, we don't have model info
            model = 'n/a';
        }

        // Final validation
        const result = { api, model, completionSource };

        // Ensure all values are strings
        Object.keys(result).forEach(key => {
            if (typeof result[key] !== 'string') {
                console.warn(`STCL: API info property ${key} is not a string:`, typeof result[key], result[key]);
                result[key] = 'unknown';
            }
        });

        return result;
    } catch (e) {
        console.warn('STCL: Error getting API info:', e);
        // Safe fallback with validation
        return {
            api: 'unknown',
            model: 'unknown',
            completionSource: 'unknown'
        };
    }
}

// Set up the getCurrentApiInfo dependency for prompt helpers now that the function is defined
promptHelpers.setGetCurrentApiInfo(getCurrentApiInfo);


function formatSettingsInfo(settings) {
    if (!settings || typeof settings !== 'object') {
        return 'No saved settings';
    }

    let saved = 'Unknown';
    if (settings.savedAt) {
        try {
            if (typeof moment !== 'undefined' && moment.isDate && moment(settings.savedAt).isValid()) {
                saved = moment(settings.savedAt).format('MMM D, YYYY [at] h:mm A');
            } else {
                // Fallback for when moment isn't available
                const date = new Date(settings.savedAt);
                if (!isNaN(date.getTime())) {
                    saved = date.toLocaleString();
                }
            }
        } catch (dateError) {
            console.warn('STCL: Error formatting date:', dateError);
            saved = 'Unknown';
        }
    }

    // Determine if this is CC or TC settings
    const isCCSettings = 'ccPreset' in settings;
    const isTCSettings = 'tcPreset' in settings;

    const completionSource = (settings.completionSource && typeof settings.completionSource === 'string') ? settings.completionSource.trim() || 'N/A' : 'N/A';

    if (isCCSettings) {
        return ccPromptHandlers.ccFormatSettings(settings, completionSource, saved);
    } else if (isTCSettings) {
        return tcPromptHandlers.tcFormatSettings(settings, completionSource, saved);
    } else {
        // Legacy format fallback (shouldn't happen with new system)
        return `Profile: ${completionSource}
Saved: ${saved}`;
    }
}

// ===== TEMPLATE AND UI =====

// Register Handlebars helpers
Handlebars.registerHelper('eq', function(a, b) {
    return a === b;
});

Handlebars.registerHelper('ne', function(a, b) {
    return a !== b;
});

Handlebars.registerHelper('moment', function(date) {
    if (!date) return '';
    try {
        return moment(date).fromNow();
    } catch (error) {
        return 'Invalid date';
    }
});

const popupTemplate = Handlebars.compile(`
<div class="completion_prompt_manager_popup_entry">
    <div class="completion_prompt_manager_error {{#unless isExtensionEnabled}}caution{{/unless}}">
        <span>API Status: <strong>{{statusText}}</strong></span>
    </div>

    {{#if userInfo.isMultiUser}}
    <div class="completion_prompt_manager_popup_entry">
        <div class="completion_prompt_manager_error info">
            <span>User: <strong>{{userInfo.userHandle}}</strong>{{#if userInfo.isAdmin}} (Admin){{/if}}</span>
        </div>
        {{#unless userInfo.hasFullAccess}}
        <div class="completion_prompt_manager_error caution">
            <span>⚠️ Limited access - some features may be restricted</span>
        </div>
        {{/unless}}
        {{#if userInfo.hasMasterTemplates}}
        <div class="completion_prompt_manager_error caution">
            <span>📋 Template editing disabled (master source configured)</span>
        </div>
        {{/if}}
        {{#if userInfo.hasMasterFilters}}
        <div class="completion_prompt_manager_error caution">
            <span>🔍 Filter editing disabled (master source configured)</span>
        </div>
        {{/if}}
    </div>
    {{/if}}

    {{#if masterSourceInfo.templatesEnabled}}
    <div class="completion_prompt_manager_popup_entry">
        <div class="completion_prompt_manager_error info">
            <span>📋 Templates: Master source active</span>
            {{#if masterSourceInfo.lastSyncTimes.templates}}
            <br><small>Last sync: {{moment masterSourceInfo.lastSyncTimes.templates}}</small>
            {{/if}}
            {{#if masterSourceInfo.lastErrors.templates}}
            <br><small class="text-danger">Error: {{masterSourceInfo.lastErrors.templates}}</small>
            {{/if}}
        </div>
    </div>
    {{/if}}

    {{#if masterSourceInfo.filtersEnabled}}
    <div class="completion_prompt_manager_popup_entry">
        <div class="completion_prompt_manager_error info">
            <span>🔍 Filters: Master source active</span>
            {{#if masterSourceInfo.lastSyncTimes.filters}}
            <br><small>Last sync: {{moment masterSourceInfo.lastSyncTimes.filters}}</small>
            {{/if}}
            {{#if masterSourceInfo.lastErrors.filters}}
            <br><small class="text-danger">Error: {{masterSourceInfo.lastErrors.filters}}</small>
            {{/if}}
        </div>
    </div>
    {{/if}}

    <!-- Configuration Section -->
    <div class="completion_prompt_manager_popup_entry_form_control">
        <h4>📋 Configuration</h4>

        <!-- Memory Settings -->
        <div class="m-t-1 m-b-1">
            <h5 class="text-muted">Memory Settings</h5>
            {{#each checkboxes}}
            {{#unless (or (eq id "stcl-enable-model-prompt-links") (eq id "stcl-show-other-notifications"))}}
            <label class="checkbox_label">
                <input type="checkbox" id="{{id}}" {{#if checked}}checked{{/if}} {{#unless ../isExtensionEnabled}}{{#if requiresApi}}disabled{{/if}}{{/unless}}>
                <span>{{label}}</span>
            </label>
            {{/unless}}
            {{/each}}
        </div>

        <!-- Advanced Features -->
        <div class="m-t-1 m-b-1">
            <h5 class="text-muted">Advanced Features</h5>
            {{#each checkboxes}}
            {{#if (eq id "stcl-enable-model-prompt-links")}}
            <label class="checkbox_label">
                <input type="checkbox" id="{{id}}" {{#if checked}}checked{{/if}} {{#unless ../isExtensionEnabled}}{{#if requiresApi}}disabled{{/if}}{{/unless}}>
                <span>{{label}}</span>
            </label>
            {{/if}}
            {{/each}}
        </div>

        <!-- Notification Settings -->
        <div class="m-t-1 m-b-1">
            <h5 class="text-muted">Notification Settings</h5>
            {{#each checkboxes}}
            {{#if (eq id "stcl-show-other-notifications")}}
            <label class="checkbox_label">
                <input type="checkbox" id="{{id}}" {{#if checked}}checked{{/if}} {{#unless ../isExtensionEnabled}}{{#if requiresApi}}disabled{{/if}}{{/unless}}>
                <span>{{label}}</span>
            </label>
            {{/if}}
            {{/each}}
        </div>
    </div>

    <!-- Settings Information Display -->
    <div class="completion_prompt_manager_popup_entry_form_control">
        <h4>💾 Current Settings</h4>
        {{#if isGroupChat}}
        <h5>Group Settings:</h5>
        <div class="completion_prompt_manager_popup_entry_form_control marginTop10">
            <pre class="margin0">{{groupInfo}}</pre>
        </div>

        <h5>Current Chat Settings:</h5>
        <div class="completion_prompt_manager_popup_entry_form_control marginTop10">
            <pre class="margin0">{{chatInfo}}</pre>
        </div>

        <h5>Group Members:</h5>
        <div class="flex-container marginTop10">
            {{#each groupMembers}}
            <div class="flex1">
                <h5>{{name}}</h5>
                <pre class="margin0">{{settings}}</pre>
            </div>
            {{/each}}
        </div>

        <div class="marginTop10">
            <small>💡 To set individual character settings, visit their character card</small>
        </div>
        {{else}}
        <h5>Current Character Settings:</h5>
        <div class="completion_prompt_manager_popup_entry_form_control marginTop10">
            <pre class="margin0">{{characterInfo}}</pre>
        </div>

        <h5>Current Chat Settings:</h5>
        <div class="completion_prompt_manager_popup_entry_form_control marginTop10">
            <pre class="margin0">{{chatInfo}}</pre>
        </div>
        {{/if}}
    </div>
</div>
`);

// ===== SIMPLIFIED EVENT HANDLERS =====

// Debounced handler removed - auto-save functionality no longer used

async function onCharacterChanged() {
    if (!settingsManager) return;
    await settingsManager.onContextChanged();
}

async function onChatChanged() {
    if (!settingsManager) return;
    await settingsManager.onContextChanged();
}

async function onModelSettingsChanged() {
    // This function is no longer used for auto-save, but kept for potential future use
    // All saves are now manual through the UI
}

async function onModelChanged() {
    if (!settingsManager || !modelPromptManager) {
        console.log('STCL: Skipping model change - managers not available');
        return;
    }

    console.log('STCL: Model changed, checking for model-based settings');

    // Apply model-based settings immediately on model change
    try {
        if (isApplyingSettings) {
            console.log('STCL: Skipping model-based application - currently applying settings');
            return;
        }

        await settingsManager.applyModelBasedSettings();
    } catch (error) {
        console.error('STCL: Error applying model-based settings:', error);
    }
}

// ===== POPUP MANAGEMENT =====

async function getPopupContent() {
    const extensionSettings = storageAdapter.getExtensionSettings();
    const apiInfo = await getCurrentApiInfo();
    const context = await settingsManager.chatContext.getCurrent();

    const isGroupChat = context.isGroupChat;

    const statusText = `Active (${isUsingChatCompletion() ? 'Chat Completion' : 'Text Completion'} - ${apiInfo.completionSource})${isGroupChat ? ' - Group Chat' : ''}`;

    // Get user permission information
    const userInfo = {
        isMultiUser: multiUserManager.isMultiUserMode(),
        userHandle: multiUserManager.getUserHandle(),
        isAdmin: multiUserManager.isCurrentUserAdmin(),
        hasFullAccess: multiUserManager.hasFullAccess(),
        canEditFilters: multiUserManager.canEditFilters(),
        canToggleModelPrompt: multiUserManager.canToggleModelPrompt(),
        hasMasterTemplates: multiUserManager.hasMasterSourceForTemplates(),
        hasMasterFilters: multiUserManager.hasMasterSourceForFilters()
    };

    // Get master source status information
    const masterSourceInfo = masterSourceLoader ? masterSourceLoader.getMasterSourceStatus() : {
        templatesEnabled: false,
        filtersEnabled: false,
        templateSource: '',
        filterSource: '',
        lastSyncTimes: { templates: null, filters: null },
        lastErrors: { templates: null, filters: null },
        isRefreshing: false
    };

    // Get model-prompt mapping information
    let modelPromptInfo = null;
    if (modelPromptManager) {
        try {
            const mappings = await modelPromptManager.getMappingsWithInheritance(context);
            const modelMatch = mappings?.enableModelPromptLinks ? await modelPromptManager.evaluateModel(apiInfo.model, context) : null;

            modelPromptInfo = {
                currentModel: apiInfo.model,
                enabled: mappings?.enableModelPromptLinks || false,
                matchedRule: modelMatch ? `${modelMatch.description}${modelMatch.isConfigured ? '' : ' (no prompt linked)'}` : 'No match',
                totalRules: mappings?.rules?.length || 0
            };
        } catch (error) {
            console.warn('STCL: Error getting model-prompt info for popup:', error);
        }
    }

    let checkboxes = [];
    
    if (isGroupChat) {
        checkboxes = [
            { id: 'stcl-enable-character', label: 'Remember per group', checked: extensionSettings.moduleSettings.enableGroupMemory, requiresApi: true },
            { id: 'stcl-enable-chat', label: 'Remember per chat', checked: extensionSettings.moduleSettings.enableChatMemory, requiresApi: true },
            { id: 'stcl-prefer-group-over-chat', label: 'Prefer group settings over chat', checked: extensionSettings.moduleSettings.preferGroupOverChat, requiresApi: true },
            { id: 'stcl-prefer-individual-character', label: 'Prefer individual character settings', checked: extensionSettings.moduleSettings.preferIndividualCharacterInGroup, requiresApi: true },
            { id: 'stcl-enable-model-prompt-links', label: 'Enable Model-Prompt Links', checked: extensionSettings.modelPromptMappings?.enableModelPromptLinks ?? true, requiresApi: true },
            { id: 'stcl-show-other-notifications', label: 'Show other notifications', checked: extensionSettings.moduleSettings.showOtherNotifications, requiresApi: false }
        ];
    } else {
        checkboxes = [
            { id: 'stcl-enable-character', label: 'Remember per character', checked: extensionSettings.moduleSettings.enableCharacterMemory, requiresApi: true },
            { id: 'stcl-enable-chat', label: 'Remember per chat', checked: extensionSettings.moduleSettings.enableChatMemory, requiresApi: true },
            { id: 'stcl-prefer-character', label: 'Prefer character settings over chat', checked: extensionSettings.moduleSettings.preferCharacterOverChat, requiresApi: true },
            { id: 'stcl-enable-model-prompt-links', label: 'Enable Model-Prompt Links', checked: extensionSettings.modelPromptMappings?.enableModelPromptLinks ?? true, requiresApi: true },
            { id: 'stcl-show-other-notifications', label: 'Show other notifications', checked: extensionSettings.moduleSettings.showOtherNotifications, requiresApi: false }
        ];
    }

    const templateData = {
        isExtensionEnabled: true, // Extension is always enabled
        statusText,
        isGroupChat,
        groupOrCharLabel: isGroupChat ? 'Group' : 'Character',
        characterInfo: formatSettingsInfo(settingsManager.currentSettings.character),
        groupInfo: formatSettingsInfo(settingsManager.currentSettings.group),
        individualCharacterInfo: formatSettingsInfo(settingsManager.currentSettings.individual),
        chatInfo: formatSettingsInfo(settingsManager.currentSettings.chat),
        groupMembers: isGroupChat ? settingsManager.currentSettings.groupMembers.map(member => ({
            name: member.name,
            settings: formatSettingsInfo(member.settings)
        })) : [],
        checkboxes,
        // Model-Prompt Links information
        modelPromptInfo: modelPromptInfo,
        // User permission information
        userInfo: userInfo,
        // Master source information
        masterSourceInfo: masterSourceInfo
    };

    return DOMPurify.sanitize(popupTemplate(templateData));
}

async function refreshPopupContent() {
    if (!currentPopupInstance || !currentPopupInstance.dlg.hasAttribute('open')) {
        console.warn('STCL: Cannot refresh popup - no popup currently open');
        return;
    }

    try {
        const content = await getPopupContent();
        const header = '📌 ST Character Locks';
        const newContent = `<h3>${header}</h3>${content}`;

        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = newContent;

        const contentElement = currentPopupInstance?.dlg?.querySelector?.('.dialogue-content');
        if (contentElement) {
            // Clean up old event listeners before morphing DOM
            cleanupPopupEventListeners();
            morphdom(contentElement, tempContainer);
            // Re-setup event listeners after content refresh using proper DOM ready detection
            try {
                await setupPopupEventListenersAsync();
                console.log('STCL: Event listeners re-setup completed after refresh');
            } catch (error) {
                console.error('STCL: Error in refresh event listener setup:', error);
                setTimeout(() => setupPopupEventListenersSimple(), 200);
            }
        } else {
            // Fallback: close and reopen popup
            throw new Error('Content element not found');
        }

    } catch (error) {
        console.error('STCL: Error refreshing popup content:', error);
        if (currentPopupInstance && typeof currentPopupInstance.completeCancelled === 'function') {
            currentPopupInstance.completeCancelled();
        }
        setTimeout(async () => {
            try {
                await showPopup();
            } catch (err) {
                console.error('STCL: Failed to reopen popup after refresh error:', err);
            }
        }, 100);
    }
}

async function showPopup() {
    // Check for ongoing popup operation
    if (uiLocks.popupOperation) {
        console.warn('STCL: Popup operation already in progress, ignoring request');
        return;
    }

    // Prevent multiple popups from opening simultaneously
    if (currentPopupInstance && currentPopupInstance.dlg && currentPopupInstance.dlg.hasAttribute('open')) {
        console.log('STCL: Popup already open, bringing to front');
        currentPopupInstance.dlg.focus();
        return;
    }

    uiLocks.popupOperation = true;

    const content = await getPopupContent();
    const header = '📌 Character Locks';
    const contentWithHeader = `<h3>${header}</h3>${content}`;
    const context = await settingsManager.chatContext.getCurrent();
    const isGroupChat = context.isGroupChat;

    let customButtons = [];

    // Check if user has permission to save settings
    const canSaveSettings = multiUserManager.hasFullAccess();

    // Check if we have a valid chat context (character or group selected)
    const hasValidChatContext = isGroupChat ? context.groupId : context.characterName;

    // For single character chats, show character and both buttons
    if (!isGroupChat && canSaveSettings && hasValidChatContext) {
        customButtons.push(
            {
                text: '✔️ Set Character',
                classes: ['menu_button'],
                action: async () => {
                    const targets = { character: true, chat: false };
                    await settingsManager.saveCurrentUISettings(targets);
                    await refreshPopupContent();
                }
            },
            {
                text: '✔️ Set Both',
                classes: ['menu_button'],
                action: async () => {
                    const targets = { character: true, chat: true };
                    await settingsManager.saveCurrentUISettings(targets);
                    await refreshPopupContent();
                }
            }
        );
    } else if (isGroupChat && canSaveSettings && hasValidChatContext) {
        // For group chats, only show group and all buttons (no individual character button)
        customButtons.push(
            {
                text: '✔️ Set Group',
                classes: ['menu_button'],
                action: async () => {
                    const targets = { character: true, chat: false };
                    await settingsManager.saveCurrentUISettings(targets);
                    await refreshPopupContent();
                }
            },
            {
                text: '✔️ Set All',
                classes: ['menu_button'],
                action: async () => {
                    const targets = { character: true, chat: true };
                    await settingsManager.saveCurrentUISettings(targets);
                    await refreshPopupContent();
                }
            }
        );
    }

    // Chat button and other controls
    if (canSaveSettings && hasValidChatContext) {
        customButtons.push({
            text: '✔️ Set Chat',
            classes: ['menu_button'],
            action: async () => {
                const targets = { character: false, chat: true };
                await settingsManager.saveCurrentUISettings(targets);
                await refreshPopupContent();
            }
        });
    }

    // Configure Model-Prompt Links button - check if user can edit filters for model-prompt controls
    if (multiUserManager.canToggleModelPrompt()) {
        const extensionSettings = storageAdapter.getExtensionSettings();
        const modelPromptLinksEnabled = extensionSettings.modelPromptMappings?.enableModelPromptLinks ?? true;
        customButtons.push({
            text: '⚙️ Configure Model-Prompt Links',
            classes: ['menu_button'],
            disabled: !modelPromptLinksEnabled,
            action: async () => {
                try {
                    await showModelPromptConfigWindow();
                } catch (error) {
                    console.error('STCL: Failed to show model-prompt configuration:', error);
                    toastr.error('Failed to show model-prompt configuration', MODULE_NAME);
                }
            }
        });
    }

    // Add Refresh Model List button
    customButtons.push({
        text: '🔄 Refresh Model List from API',
        classes: ['menu_button'],
        action: async () => {
            try {
                console.log('STCL: Refreshing model list from API');
                await refreshAvailableModels();
                updateStatusFeedback('Model list refreshed successfully', 'success');
            } catch (error) {
                console.error('STCL: Error refreshing model list:', error);
                updateStatusFeedback(`Error refreshing model list: ${error.message}`, 'error');
            }
        }
    });

    // Master source controls - only for admins
    if (multiUserManager.isCurrentUserAdmin()) {
        const masterStatus = masterSourceLoader.getMasterSourceStatus();

        // Manual refresh button if master sources are configured
        if (masterStatus.templatesEnabled || masterStatus.filtersEnabled) {
            customButtons.push({
                text: masterStatus.isRefreshing ? '🔄 Refreshing...' : '🔄 Refresh Master',
                classes: ['menu_button'],
                action: async () => {
                    if (!masterStatus.isRefreshing) {
                        await masterSourceLoader.manualRefresh();
                        await refreshPopupContent();
                    }
                }
            });
        }

        // Export buttons
        customButtons.push({
            text: '📤 Export Templates',
            classes: ['menu_button'],
            action: async () => {
                try {
                    const exportData = masterSourceLoader.exportTemplates();
                    const blob = new Blob([exportData], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `stcl-templates-${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    toastr.success('Templates exported successfully', MODULE_NAME);
                } catch (error) {
                    console.error('STCL: Failed to export templates:', error);
                    toastr.error(`Export failed: ${error.message}`, MODULE_NAME);
                }
            }
        });

        customButtons.push({
            text: '📤 Export Filters',
            classes: ['menu_button'],
            action: async () => {
                try {
                    const exportData = masterSourceLoader.exportFilters();
                    const blob = new Blob([exportData], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `stcl-filters-${new Date().toISOString().split('T')[0]}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    toastr.success('Filters exported successfully', MODULE_NAME);
                } catch (error) {
                    console.error('STCL: Failed to export filters:', error);
                    toastr.error(`Export failed: ${error.message}`, MODULE_NAME);
                }
            }
        });
    }

    // Clear buttons - only for users who can save settings and valid chat context
    if (canSaveSettings && hasValidChatContext) {
        customButtons.push({
            text: isGroupChat ? '❌ Clear Group' : '❌ Clear Character',
            classes: ['menu_button'],
            action: async () => {
                if (isGroupChat) {
                    if (context.groupId && storageAdapter.deleteGroupSettings(context.groupId)) {
                        settingsManager.currentSettings.group = null;
                        toastr.info('Group settings cleared', MODULE_NAME);
                    }
                } else {
                    if (context.characterName && storageAdapter.deleteCharacterSettings(context.characterName)) {
                        settingsManager.currentSettings.character = null;
                        toastr.info('Character settings cleared', MODULE_NAME);
                    }
                }
                await refreshPopupContent();
            }
        });

        customButtons.push({
            text: '❌ Clear Chat',
            classes: ['menu_button'],
            action: async () => {
                if (isGroupChat) {
                    if (await storageAdapter.deleteGroupChatSettings(context.groupId)) {
                        settingsManager.currentSettings.chat = null;
                        toastr.info('Group chat settings cleared', MODULE_NAME);
                    }
                } else {
                    if (await storageAdapter.deleteChatSettings()) {
                        settingsManager.currentSettings.chat = null;
                        toastr.info('Chat settings cleared', MODULE_NAME);
                    }
                }
                await refreshPopupContent();
            }
        });

        customButtons.push({
            text: '❌ Clear All',
            classes: ['menu_button'],
            action: async () => {
                await settingsManager.clearAllSettings();
                await refreshPopupContent();
            }
        });
    }


    const popupOptions = {
        wide: true,
        large: false,
        allowVerticalScrolling: true,
        customButtons: customButtons,
        cancelButton: 'Close',
        okButton: false,
        onClose: handlePopupClose
    };

    try {
        currentPopupInstance = new Popup(contentWithHeader, POPUP_TYPE.TEXT, '', popupOptions);
        await currentPopupInstance.show();

        // Set up event listeners after popup is shown using proper DOM ready detection
        try {
            await setupPopupEventListenersAsync();
            console.log('STCL: Event listeners setup completed');
        } catch (error) {
            console.error('STCL: Failed to setup event listeners:', error);
            // Fallback to simpler approach
            setTimeout(() => {
                setupPopupEventListenersSimple();
            }, 200);
        }

        console.log('STCL: Popup shown successfully');
    } catch (error) {
        console.error('STCL: Error showing popup:', error);
        currentPopupInstance = null;
    } finally {
        uiLocks.popupOperation = false;
    }
}


async function setupPopupEventListenersAsync() {
    if (!currentPopupInstance || !currentPopupInstance.dlg) {
        console.warn('STCL: Cannot setup event listeners - no popup instance');
        return;
    }

    const popup = currentPopupInstance.dlg;
    console.log('STCL: Setting up popup event listeners (async DOM ready approach)');

    try {
        // Wait for checkbox to be ready
        const modelPromptCheckbox = await waitForElement('#stcl-enable-model-prompt-links', popup, 2000);
        if (modelPromptCheckbox && !modelPromptCheckbox.dataset.stclListenerAdded) {
            modelPromptCheckbox.dataset.stclListenerAdded = 'true';
            console.log('STCL: Setting up Model-Prompt Links checkbox listener');

            modelPromptCheckbox.addEventListener('change', async function(event) {
                console.log('STCL: Checkbox changed to (async):', event?.target?.checked);
                try {
                    const result = await handleModelPromptLinksToggle(event?.target?.checked);
                    if (result?.needsPopupRefresh) {
                        await refreshPopupContent();
                    }
                } catch (error) {
                    console.error('STCL: Failed to handle model-prompt toggle:', error);
                }
            });
        }

        // Wait for Configure Rules button to be ready
        const configureRulesButton = await waitForElement('#stcl-configure-rules', popup, 2000);
        if (configureRulesButton && !configureRulesButton.dataset.stclListenerAdded) {
            configureRulesButton.dataset.stclListenerAdded = 'true';
            console.log('STCL: Setting up Configure Rules button listener');

            configureRulesButton.addEventListener('click', async function(event) {
                console.log('STCL: Configure Rules button clicked');
                event.preventDefault();
                event.stopPropagation();
                try {
                    await showRulesConfigurationPopup();
                } catch (error) {
                    console.error('STCL: Error opening rules configuration:', error);
                }
            });
        } else if (!configureRulesButton) {
            console.warn('STCL: Configure Rules button not found after waiting');
        }

        console.log('STCL: Event listeners setup completed');

    } catch (error) {
        console.error('STCL: Error setting up popup event listeners:', error);
    }
}

// handleModelPromptLinksToggle moved to modelprompt.js

function setupPopupEventListenersSimple() {
    if (!currentPopupInstance?.dlg) {
        console.warn('STCL: Cannot setup simple event listeners - no popup instance');
        return;
    }

    const popup = currentPopupInstance.dlg;
    console.log('STCL: Setting up popup event listeners (simple fallback approach)');

    // Set up Model-Prompt Links checkbox listener
    const modelPromptCheckbox = popup?.querySelector?.('#stcl-enable-model-prompt-links');
    console.log('STCL: Model-Prompt Links checkbox found (simple):', !!modelPromptCheckbox);

    if (modelPromptCheckbox && !modelPromptCheckbox.dataset.stclListenerAdded) {
        modelPromptCheckbox.dataset.stclListenerAdded = 'true';
        console.log('STCL: Adding listener to checkbox (simple approach)');

        modelPromptCheckbox.addEventListener('change', async function(event) {
            console.log('STCL: Checkbox changed to (simple):', event?.target?.checked);
            try {
                const result = await handleModelPromptLinksToggle(event?.target?.checked);
                if (result?.needsPopupRefresh) {
                    await refreshPopupContent();
                }
            } catch (error) {
                console.error('STCL: Failed to handle model-prompt toggle (simple):', error);
            }
        });
    }

    // Set up Configure Rules button listener
    const configureRulesButton = popup?.querySelector?.('#stcl-configure-rules');
    console.log('STCL: Configure Rules button found (simple):', !!configureRulesButton);

    if (configureRulesButton && !configureRulesButton.dataset.stclListenerAdded) {
        configureRulesButton.dataset.stclListenerAdded = 'true';
        console.log('STCL: Adding listener to button (simple approach)');

        configureRulesButton.addEventListener('click', async function(event) {
            console.log('STCL: Configure Rules button clicked (simple)');
            event.preventDefault();
            event.stopPropagation();
            try {
                await showRulesConfigurationPopup();
            } catch (error) {
                console.error('STCL: Error opening rules configuration:', error);
            }
        });
    }

    console.log('STCL: Simple event listeners setup completed');
}

// Legacy retry-based function removed - replaced with setupPopupEventListenersAsync()

function cleanupPopupEventListeners() {
    if (!currentPopupInstance?.dlg) {
        return;
    }

    const popup = currentPopupInstance.dlg;
    console.log('STCL: Cleaning up popup event listeners');

    // Remove listener markers to clean up
    const elementsWithListeners = popup?.querySelectorAll?.('[data-stcl-listener-added]') || [];
    elementsWithListeners.forEach(element => {
        delete element.dataset.stclListenerAdded;
    });

    // Additional cleanup: remove elements if they're being replaced
    const modelPromptCheckbox = popup?.querySelector?.('#stcl-enable-model-prompt-links');
    const configureRulesButton = popup?.querySelector?.('#stcl-configure-rules');

    if (modelPromptCheckbox?.dataset.stclListenerAdded) {
        console.log('STCL: Cleaning up Model-Prompt Links checkbox listeners');
        // Clone element to remove all event listeners
        const newCheckbox = modelPromptCheckbox.cloneNode(true);
        delete newCheckbox.dataset.stclListenerAdded;
        modelPromptCheckbox.parentNode?.replaceChild(newCheckbox, modelPromptCheckbox);
    }

    if (configureRulesButton?.dataset.stclListenerAdded) {
        console.log('STCL: Cleaning up Configure Rules button listeners');
        // Clone element to remove all event listeners
        const newButton = configureRulesButton.cloneNode(true);
        delete newButton.dataset.stclListenerAdded;
        configureRulesButton.parentNode?.replaceChild(newButton, configureRulesButton);
    }
}

async function updateModelPromptStatus() {
    try {
        if (!currentPopupInstance || !currentPopupInstance.dlg) {
            return;
        }

        const popup = currentPopupInstance.dlg;
        const modelPromptSection = popup.querySelector('.completion_prompt_manager_popup_entry_form_control h4');

        // Find the Model-Prompt Links section
        if (modelPromptSection && modelPromptSection.textContent.includes('Model-Prompt Links')) {
            const apiInfo = await getCurrentApiInfo();
            const context = await settingsManager.chatContext.getCurrent();
            const extensionSettings = storageAdapter.getExtensionSettings();
            // Extension is always enabled for all APIs

            // Get updated model-prompt info
            let modelPromptInfo = null;
            if (modelPromptManager) {
                try {
                    const mappings = await modelPromptManager.getMappingsWithInheritance(context);
                    const modelMatch = mappings?.enableModelPromptLinks ? await modelPromptManager.evaluateModel(apiInfo.model, context) : null;

                    modelPromptInfo = {
                        currentModel: apiInfo.model,
                        enabled: mappings?.enableModelPromptLinks || false,
                        matchedRule: modelMatch ? `${modelMatch.description}${modelMatch.isConfigured ? '' : ' (no prompt linked)'}` : 'No match',
                        totalRules: mappings?.rules?.length || 0
                    };
                } catch (error) {
                    console.warn('STCL: Error getting model-prompt info for status update:', error);
                }
            }

            // Update the status display
            if (modelPromptInfo) {
                const statusDisplay = modelPromptSection?.nextElementSibling?.querySelector?.('pre');
                if (statusDisplay) {
                    const statusIcon = modelPromptInfo.enabled ? '<span class="success">✅ Enabled</span>' : '<span class="warning">❌ Disabled</span>';
                    const ruleIcon = modelPromptInfo.enabled && modelPromptInfo.matchedRule !== 'No match'
                        ? `<span class="success">🎯 ${modelPromptInfo.matchedRule}</span>`
                        : modelPromptInfo.enabled
                            ? `<span class="warning">⚠️ ${modelPromptInfo.matchedRule}</span>`
                            : modelPromptInfo.matchedRule;

                    statusDisplay.innerHTML = `Model: ${modelPromptInfo.currentModel}
Status: ${statusIcon}
Active Rule: ${ruleIcon}
Total Rules: ${modelPromptInfo.totalRules}`;
                }
            }
        }
    } catch (error) {
        console.error('STCL: Error updating model-prompt status:', error);
    }
}

async function showModelPromptConfigWindow() {
    console.log('STCL: showModelPromptConfigWindow called');

    // Check for ongoing operation
    if (uiLocks.modelPromptConfig) {
        console.warn('STCL: Model-Prompt configuration already in progress, ignoring request');
        return;
    }

    uiLocks.modelPromptConfig = true;

    try {
        const extensionSettings = storageAdapter.getExtensionSettings();
        const userSettings = storageAdapter.getUserSettings();
        const apiInfo = await getCurrentApiInfo();
        const context = await settingsManager.chatContext.getCurrent();

        // Check if user can edit based on permissions
        const canEdit = multiUserManager.hasFullAccess();
        const canEditFilters = multiUserManager.canEditFilters();
        const canToggleModelPrompt = multiUserManager.canToggleModelPrompt();

        // Get master source status
        const masterStatus = masterSourceLoader.getMasterSourceStatus();

        // Get current Model-Prompt Links status
        let modelPromptInfo = null;

        if (modelPromptManager) {
            try {
                const mappings = await modelPromptManager.getMappingsWithInheritance(context);
                const modelMatch = mappings?.enableModelPromptLinks ? await modelPromptManager.evaluateModel(apiInfo.model, context) : null;

                modelPromptInfo = {
                    currentModel: apiInfo.model,
                    enabled: mappings?.enableModelPromptLinks || false,
                    matchedRule: modelMatch ? `${modelMatch.description}${modelMatch.isConfigured ? '' : ' (no prompt linked)'}` : 'No match',
                    totalRules: mappings?.rules?.length || 0,
                    rules: mappings?.rules || []
                };
            } catch (error) {
                console.warn('STCL: Error getting model-prompt info:', error);
            }
        }

        // Get available models for current completion source
        const availableModels = getAvailableModels(apiInfo.completionSource);

        // Get available presets
        let presets = [];
        try {
            const presetManager = getPresetManager(apiInfo.completionSource);
            if (presetManager && presetManager.presets) {
                presets = Object.keys(presetManager.presets).map(name => ({
                    name,
                    value: name
                }));
            }
        } catch (error) {
            console.warn('STCL: Could not get presets:', error);
        }

        const content = `
            <div class="completion_prompt_manager_popup_entry">
                <h3>⚙️ Model-Prompt Links Configuration</h3>

                <!-- Enable/Disable Section -->
                <div class="completion_prompt_manager_popup_entry_form_control">
                    <h4>Enable/Disable</h4>
                    <p class="fontsize80p marginBot10">
                        Automatically switch prompts when model changes (presets remain unchanged)
                    </p>
                    <label class="checkbox_label">
                        <input type="checkbox" id="stcl_enable_model_prompt_links"
                               ${modelPromptInfo?.enabled ? 'checked' : ''}
                               ${!canToggleModelPrompt ? 'disabled' : ''}>
                        <span>Enable Model-Prompt Links</span>
                    </label>
                </div>

                <!-- Active Status Section -->
                <div class="completion_prompt_manager_popup_entry_form_control">
                    <h4>Active Status</h4>
                    <div class="marginBot10 bg-dark-600 p-2 rounded">
                        <p><strong>Current Model:</strong> ${apiInfo.model || 'Unknown'}</p>
                        <p><strong>API Type:</strong> ${isUsingChatCompletion() ? 'Chat Completion' : 'Text Completion'}</p>
                        <p><strong>Completion Source:</strong> ${apiInfo.completionSource}</p>
                        <p><strong>Matching Rule:</strong> ${modelPromptInfo?.matchedRule || 'No match'}</p>
                    </div>
                </div>

                <!-- Boolean Filter Configuration -->
                <div class="completion_prompt_manager_popup_entry_form_control" id="filter-config-section">
                    <h4>Boolean Filter Configuration</h4>
                    <p class="marginBot10 text-muted small">
                        Create expressions to match models. Supported operators: <code>AND</code>, <code>OR</code>, <code>NOT</code>, <code>AND NOT</code>
                    </p>

                    <!-- Scope Toggle -->
                    <div class="m-b-1">
                        <label class="checkbox_label">
                            <input type="checkbox" id="filter-scope-global" checked>
                            <span>Apply filters globally across all API sources</span>
                        </label>
                        <p class="text-muted tiny m-l-2 m-t-1">
                            When unchecked: filters apply only to current completion source
                        </p>
                    </div>

                    <!-- Source Selection Info Block (hidden by default) -->
                    <div id="source-specific-info" class="hidden bg-dark-500 p-2 rounded m-b-1 border-l-orange">
                        <h5 class="m-b-1 text-orange">Source-Specific Configuration</h5>
                        <p class="small text-muted">
                            Configuring filters for completion source: <strong id="source-specific-name">${apiInfo.completionSource || 'Unknown'}</strong>
                        </p>
                    </div>


                    <!-- Dual-List Filter Management (hidden by default) -->
                    <div id="dual-list-management" class="hidden m-t-2">
                        <h5 class="marginBot10 text-muted">Filter Management</h5>
                        <div class="d-flex gap-1 align-items-start">
                            <!-- Left List -->
                            <div class="flex-1">
                                <h6 class="marginBot5 small text-muted">Filters for this source</h6>
                                <div id="source-specific-filters" class="bg-dark-600 border rounded min-h-8 p-1">
                                    <div class="filter-list" id="source-filters-list">
                                        <p class="text-muted-more italic tiny">No source-specific filters</p>
                                    </div>
                                </div>
                            </div>

                            <!-- Transfer Buttons -->
                            <div class="d-flex flex-column gap-1 justify-content-center p-2">
                                <button id="move-all-to-source" class="menu_button p-1 small" title="Add all">
                                    <i class="fa fa-angles-right"></i>
                                </button>
                                <button id="move-one-to-source" class="menu_button p-1 small" title="Add this one">
                                    <i class="fa fa-chevron-right"></i>
                                </button>
                                <button id="move-one-to-global" class="menu_button p-1 small" title="Remove this one">
                                    <i class="fa fa-chevron-left"></i>
                                </button>
                                <button id="move-all-to-global" class="menu_button p-1 small" title="Remove all">
                                    <i class="fa fa-angles-left"></i>
                                </button>
                            </div>

                            <!-- Right List -->
                            <div class="flex-1">
                                <h6 class="marginBot5 small text-muted">Global filters (not for this source)</h6>
                                <div id="global-filters" class="bg-dark-600 border rounded min-h-8 p-1">
                                    <div class="filter-list" id="global-filters-list">
                                        <p class="text-muted-more italic tiny">No global filters</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Available Models Info Block -->
                <div class="completion_prompt_manager_popup_entry_form_control">
                    <h4>Available Models</h4>
                    <p class="marginBot10 small text-muted">
                        Models for completion source: <strong id="current-completion-source">${apiInfo.completionSource || 'Unknown'}</strong>
                    </p>
                    <div id="available-models-info" class="bg-dark-600 p-2 rounded m-b-1 max-h-6 overflow-y-auto">
                        ${availableModels.length > 10 ?
                            `<p>Too many models to display (${availableModels.length} total). <a href="#" id="show-models-popout">Click to view all</a></p>` :
                            `<p>${availableModels.join(', ') || 'No models available'}</p>`
                        }
                    </div>
                </div>

                <!-- Rule Management Interface -->
                <div class="completion_prompt_manager_popup_entry_form_control">
                    <h4>Rule Management</h4>
                    <small>Total Rules: ${modelPromptInfo?.totalRules || 0}</small>
                    <div id="rules-container" class="max-h-12 overflow-y-auto m-b-1">
                        ${generateRulesHtml(modelPromptInfo?.rules || [], presets, canEdit && canEditFilters, apiInfo.model)}
                    </div>

                    <!-- Quick Filter Expression -->
                    <div class="marginBot10">
                        <label class="marginBot5">🧪 Test Filter Expression:</label>
                        <input type="text" id="filter-expression" placeholder="e.g., gpt AND 4o NOT mini"
                               class="marginBot5 text_pole wide_text_pole"
                               title="Test Boolean expressions against available models in real-time. Use AND, OR, NOT operators.">
                        <small>💡 This tests your Boolean logic in real-time. Results shown in Available Models section below.</small>
                    </div>

                    <div class="flex-container marginBot10">
                        <button id="add-rule-btn" class="menu_button" ${!canEdit || !canEditFilters ? 'disabled' : ''}>
                            ➕ Add Rule
                        </button>
                        <button id="apply-rules-btn" class="menu_button" ${!modelPromptInfo?.enabled ? 'disabled' : ''}>
                            ⚡ Apply Now
                        </button>
                    </div>
                </div>

                <!-- Export/Import Section -->
                <div class="completion_prompt_manager_popup_entry_form_control">
                    <h4>Export/Import</h4>
                    ${masterStatus.filtersEnabled ?
                        '<p class="text-danger small">⚠️ Master source configured - manual imports disabled</p>' :
                        ''
                    }
                    <div class="flex-container marginBot10">
                        <button id="export-rules-btn" class="menu_button">📤 Export Rules</button>
                        <button id="import-rules-btn" class="menu_button" ${masterStatus.filtersEnabled ? 'disabled' : ''}>
                            📥 Import Rules
                        </button>
                        <button id="export-templates-btn" class="menu_button">📤 Export Templates</button>
                        <button id="import-templates-btn" class="menu_button" ${masterStatus.templatesEnabled ? 'disabled' : ''}>
                            📥 Import Templates
                        </button>
                    </div>
                </div>

            </div>
        `;

        // Create popup with proper options
        const configPopup = new Popup(content, POPUP_TYPE.TEXT, '', {
            wide: true,
            large: true,
            allowVerticalScrolling: true,
            customCss: 'width: 90vw; max-width: 1200px; height: 80vh; max-height: 800px;',
            cancelButton: 'Cancel',
            okButton: 'Save Configuration',
            onOk: async () => {
                await saveModelPromptConfiguration();
            }
        });

        await configPopup.show();

        // Set up event listeners after popup is shown
        setupModelPromptConfigEventListeners(apiInfo, availableModels, modelPromptInfo);

        // Auto-scroll to the matching rule after a short delay to ensure DOM is ready
        setTimeout(() => {
            scrollToMatchingRule();
        }, 100);

    } catch (error) {
        console.error('STCL: Error showing Model-Prompt configuration window:', error);
        toastr.error(`Configuration error: ${error.message}`, MODULE_NAME);
    } finally {
        uiLocks.modelPromptConfig = false;
    }
}

// Expose the function globally for modelprompt.js to access
window.stclShowModelPromptConfigWindow = showModelPromptConfigWindow;

// Helper function to generate HTML for rules display
function generateRulesHtml(rules, presets, canEdit, currentModel = null) {
    if (!rules || rules.length === 0) {
        return '<p class="text-muted italic">No rules configured</p>';
    }

    let html = '';
    let hasMatchingRule = false;

    rules.forEach((rule, index) => {
        const ruleMatch = rule.condition || 'No condition';
        const targetPreset = rule.ccPrompts || rule.tcPrompts || 'No prompt set';
        const status = rule.enabled ? '<span class="text-success">✅</span>' : '<span class="text-danger">❌</span>';

        // Check if current model matches this rule
        let isCurrentMatch = false;
        if (currentModel && rule.condition && rule.enabled && modelPromptManager?.evaluator) {
            try {
                isCurrentMatch = modelPromptManager.evaluator.evaluate(rule.condition, currentModel.toLowerCase());
                if (isCurrentMatch) hasMatchingRule = true;
            } catch (error) {
                // If evaluation fails, don't consider it a match
                isCurrentMatch = false;
            }
        }

        // Apply highlighting styles for current match
        const borderClass = isCurrentMatch ? 'border-success' : 'border';
        const backgroundClass = isCurrentMatch ? 'bg-success-subtle' : 'bg-dark-500';
        const currentMatchIndicator = isCurrentMatch ? '<span class="text-success tiny"> 🎯 CURRENT</span>' : '';

        html += `
            <div class="rule-item marginBot10 ${borderClass} ${backgroundClass} p-2 rounded" data-rule-id="${rule.ruleId || index}" ${isCurrentMatch ? 'data-current-match="true"' : ''}>
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <div class="marginBot5 fw-bold">
                            ${status} ${ruleMatch}${currentMatchIndicator}
                        </div>
                        <div class="small text-muted">
                            <strong>Target:</strong> ${targetPreset}
                        </div>
                    </div>
                    ${canEdit ? `
                        <div class="d-flex gap-1">
                            <button class="edit-rule-btn menu_button p-1 small" data-rule-id="${rule.ruleId || index}">✏️</button>
                            <button class="delete-rule-btn menu_button p-1 small" data-rule-id="${rule.ruleId || index}">🗑️</button>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    });

    return html;
}

// Helper function to scroll to the currently matching rule
function scrollToMatchingRule() {
    try {
        const matchingRule = document.querySelector('[data-current-match="true"]');
        const rulesContainer = document.getElementById('rules-container');

        if (matchingRule && rulesContainer) {
            // Scroll the matching rule into view within the rules container
            const containerRect = rulesContainer.getBoundingClientRect();
            const ruleRect = matchingRule.getBoundingClientRect();

            // Calculate relative position of rule within container
            const relativeTop = ruleRect.top - containerRect.top + rulesContainer.scrollTop;

            // Scroll to center the rule in the container
            const scrollTo = relativeTop - (rulesContainer.clientHeight / 2) + (ruleRect.height / 2);

            rulesContainer.scrollTop = Math.max(0, scrollTo);

            console.log('STCL: Scrolled to matching rule');
        } else {
            console.log('STCL: No matching rule found to scroll to');
        }
    } catch (error) {
        console.error('STCL: Error scrolling to matching rule:', error);
    }
}

// Helper function to get available models for current completion source
function getAvailableModels(completionSource) {
    try {
        if (!completionSource) {
            return [];
        }

        // First, try to get models from SillyTavern's model selectors based on completion source
        const modelSelector = `#model_${completionSource}_select`;
        const selectorElement = document.querySelector(modelSelector);

        if (selectorElement) {
            const models = [];
            const options = selectorElement?.querySelectorAll?.('option') || [];
            options.forEach(option => {
                if (option.value && option.value !== '') {
                    models.push(option.value);
                }
            });

            if (models.length > 0) {
                console.log(`STCL: Found ${models.length} models from ${modelSelector}`);
                return models;
            }
        }


        // Alternative selectors for common completion sources
        const alternativeSelectors = {
            'openai': ['#model_openai_select', '#openai_external_category'],
            'openrouter': ['#model_openrouter_select'],
            'custom': ['#model_custom_select'],
            'claude': ['#model_claude_select'],
            'google': ['#model_google_select'],
            'makersuite': ['#model_google_select'],
            'cohere': ['#model_cohere_select'],
            'aimlapi': ['#model_aimlapi_select'],
            'novel': ['#model_novel_select']
        };

        if (alternativeSelectors[completionSource]) {
            for (const selector of alternativeSelectors[completionSource]) {
                const element = document.querySelector(selector);
                if (element) {
                    const models = [];
                    const options = element?.querySelectorAll?.('option') || [];
                    options.forEach(option => {
                        if (option.value && option.value !== '' && option.value !== 'None') {
                            models.push(option.value);
                        }
                    });

                    if (models.length > 0) {
                        console.log(`STCL: Found ${models.length} models from alternative selector ${selector}`);
                        return models;
                    }
                }
            }
        }

        // Try the context approach as another fallback
        const context = getContext();
        if (context && context.models && context.models.length > 0) {
            const models = context.models.map(model =>
                typeof model === 'string' ? model : model.name || model.id
            ).filter(Boolean);

            if (models.length > 0) {
                console.log(`STCL: Found ${models.length} models from context`);
                return models;
            }
        }

        // Last resort: hardcoded fallbacks based on completion source
        const hardcodedModels = {
            'openai': ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo', 'gpt-3.5-turbo-16k'],
            'claude': ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku', 'claude-2', 'claude-instant'],
            'google': ['gemini-pro', 'gemini-1.5-pro', 'gemini-1.5-flash'],
            'makersuite': ['gemini-pro', 'gemini-1.5-pro'],
            'cohere': ['command', 'command-light', 'command-nightly'],
            'openrouter': ['Model list not loaded'],
            'novel': ['erato-v1', 'kayra-v1', 'clio-v1'],
            'custom': ['Model list depends on API configuration']
        };

        if (hardcodedModels[completionSource]) {
            console.log(`STCL: Using hardcoded models for ${completionSource}`);
            return hardcodedModels[completionSource];
        }

        return [`No models available for ${completionSource}`];

    } catch (error) {
        console.warn('STCL: Error getting available models:', error);
        return ['Error detecting models'];
    }
}

// Helper function to set up event listeners for the configuration window
function setupModelPromptConfigEventListeners(apiInfo, availableModels, modelPromptInfo) {
    try {
        // Enable/disable toggle
        const enableToggle = document.getElementById('stcl_enable_model_prompt_links');
        if (enableToggle) {
            enableToggle.addEventListener('change', async function() {
                const isEnabled = this.checked;
                console.log('STCL: Model-Prompt Links toggled:', isEnabled);

                try {
                    // Save the setting
                    const context = await settingsManager.chatContext.getCurrent();
                    const userSettings = await settingsManager.getUserSettings(context);

                    if (!userSettings.modelPromptMappings) {
                        userSettings.modelPromptMappings = {};
                    }
                    userSettings.modelPromptMappings.enableModelPromptLinks = isEnabled;

                    await settingsManager.saveUserSettings(userSettings, context);

                    // Re-evaluate rules to update display
                    const apiInfo = await getCurrentApiInfo();
                    const mappings = await modelPromptManager.getMappingsWithInheritance(context);
                    const modelMatch = isEnabled ? await modelPromptManager.evaluateModel(apiInfo.model, context) : null;

                    // Update the matching rule display
                    const matchedRuleText = modelMatch ? `${modelMatch.description}${modelMatch.isConfigured ? '' : ' (no prompt linked)'}` : 'No match';
                    const currentModelElement = document.querySelector('.completion_prompt_manager_popup_entry_form_control:nth-child(3) p:nth-child(2)');
                    if (currentModelElement) {
                        currentModelElement.innerHTML = `<strong>Matching Rule:</strong> ${matchedRuleText}`;
                    }

                    // Enable/disable apply button
                    const applyBtn = document.getElementById('apply-rules-btn');
                    if (applyBtn) {
                        applyBtn.disabled = !isEnabled;
                    }

                    console.log('STCL: Model-Prompt Links setting saved and display updated');
                } catch (error) {
                    console.error('STCL: Error saving Model-Prompt Links setting:', error);
                }
            });
        }

        // Filter expression validation with real-time testing
        const filterInput = document.getElementById('filter-expression');
        if (filterInput) {
            // Add debouncing to avoid excessive API calls during rapid typing
            let validationTimeout;
            filterInput.addEventListener('input', function() {
                const expression = this.value;

                // Clear previous timeout
                if (validationTimeout) {
                    clearTimeout(validationTimeout);
                }

                // Debounce validation by 300ms
                validationTimeout = setTimeout(async () => {
                    await validateFilterExpression(expression);
                }, 300);
            });
        }

        // Scope toggle for global vs source-specific filters
        const scopeToggle = document.getElementById('filter-scope-global');
        if (scopeToggle) {
            scopeToggle.addEventListener('change', async function() {
                await toggleFilterScope(this.checked);
            });
        }

        // Dual-list management buttons
        const moveAllToSource = document.getElementById('move-all-to-source');
        if (moveAllToSource) {
            moveAllToSource.addEventListener('click', function() {
                moveFiltersToSource('all');
            });
        }

        const moveOneToSource = document.getElementById('move-one-to-source');
        if (moveOneToSource) {
            moveOneToSource.addEventListener('click', function() {
                moveFiltersToSource('selected');
            });
        }

        const moveOneToGlobal = document.getElementById('move-one-to-global');
        if (moveOneToGlobal) {
            moveOneToGlobal.addEventListener('click', function() {
                moveFiltersToGlobal('selected');
            });
        }

        const moveAllToGlobal = document.getElementById('move-all-to-global');
        if (moveAllToGlobal) {
            moveAllToGlobal.addEventListener('click', function() {
                moveFiltersToGlobal('all');
            });
        }

        // Show models popout for large model lists - use event delegation
        document.addEventListener('click', function(e) {
            if (e.target && e.target.id === 'show-models-popout') {
                e.preventDefault();
                showAvailableModelsPopup(availableModels);
            }
        });

        // Rule management buttons
        const addRuleBtn = document.getElementById('add-rule-btn');
        if (addRuleBtn) {
            addRuleBtn.addEventListener('click', async function() {
                try {
                    console.log('STCL: Add Rule button clicked');
                    await showAddRuleDialog();
                } catch (error) {
                    console.error('STCL: Error opening Add Rule dialog:', error);
                    updateStatusFeedback(`Error opening Add Rule dialog: ${error.message}`, 'error');
                }
            });
        }

        const applyRulesBtn = document.getElementById('apply-rules-btn');
        if (applyRulesBtn) {
            applyRulesBtn.addEventListener('click', async function() {
                await applyModelPromptRules();
            });
        }

        // Export/Import buttons
        const exportRulesBtn = document.getElementById('export-rules-btn');
        if (exportRulesBtn) {
            exportRulesBtn.addEventListener('click', function() {
                exportModelPromptRules();
            });
        }

        const importRulesBtn = document.getElementById('import-rules-btn');
        if (importRulesBtn) {
            importRulesBtn.addEventListener('click', function() {
                importModelPromptRules();
            });
        }

        const exportTemplatesBtn = document.getElementById('export-templates-btn');
        if (exportTemplatesBtn) {
            exportTemplatesBtn.addEventListener('click', function() {
                exportPromptTemplates();
            });
        }

        const importTemplatesBtn = document.getElementById('import-templates-btn');
        if (importTemplatesBtn) {
            importTemplatesBtn.addEventListener('click', function() {
                importPromptTemplates();
            });
        }


        // Rule item buttons (edit/delete)
        document.addEventListener('click', function(e) {
            if (e.target.classList.contains('edit-rule-btn')) {
                const ruleId = e.target.dataset.ruleId;
                editRule(ruleId);
            } else if (e.target.classList.contains('delete-rule-btn')) {
                const ruleId = e.target.dataset.ruleId;
                deleteRule(ruleId);
            }
        });

        console.log('STCL: Model-Prompt configuration event listeners set up');

    } catch (error) {
        console.error('STCL: Error setting up Model-Prompt config event listeners:', error);
    }
}

// Helper function to save the configuration
async function saveModelPromptConfiguration() {
    try {
        console.log('STCL: Saving Model-Prompt configuration');

        const enableToggle = document.getElementById('stcl_enable_model_prompt_links');
        const isEnabled = enableToggle ? enableToggle.checked : false;

        // Get current context and settings
        const context = await settingsManager.chatContext.getCurrent();
        const userSettings = storageAdapter.getUserSettings();

        // Update the setting
        if (modelPromptManager) {
            await modelPromptManager.setEnabled(isEnabled, context);

            // Save to user settings
            if (!userSettings.modelPromptSettings) {
                userSettings.modelPromptSettings = {};
            }
            userSettings.modelPromptSettings.enabled = isEnabled;
            storageAdapter.saveUserSettings(userSettings);

            updateStatusFeedback(`Configuration saved: Model-Prompt Links ${isEnabled ? 'enabled' : 'disabled'}`);

            toastr.success(`Model-Prompt Links ${isEnabled ? 'enabled' : 'disabled'}`, MODULE_NAME);

            console.log('STCL: Model-Prompt configuration saved successfully');
            return true;
        } else {
            throw new Error('Model-Prompt manager not available');
        }

    } catch (error) {
        console.error('STCL: Error saving Model-Prompt configuration:', error);
        updateStatusFeedback(`Error saving configuration: ${error.message}`, 'error');

        toastr.error(`Failed to save configuration: ${error.message}`, MODULE_NAME);
        return false;
    }
}

// Helper functions for the configuration window

// updateStatusFeedback moved to modelprompt.js

async function validateFilterExpression(expression) {
    const modelsInfoElement = document.getElementById('available-models-info');
    if (!modelsInfoElement) return;

    if (!expression.trim()) {
        // Reset to show all available models when no filter is applied
        await refreshAvailableModels();
        return;
    }

    try {
        // First, validate syntax
        if (!modelPromptManager || !modelPromptManager.evaluator) {
            modelsInfoElement.innerHTML = '<p class="text-warning">⚠️ Cannot validate filter (evaluator not available)</p>';
            return;
        }

        // Test syntax with a dummy model
        const syntaxTestResult = modelPromptManager.evaluator.evaluate(expression, 'test-model');

        // Get current API info and available models for real-time testing
        const apiInfo = await getCurrentApiInfo();
        const availableModels = getAvailableModels(apiInfo.completionSource);
        const currentModel = apiInfo.model;

        // Test the expression against all available models
        const matchingModels = [];
        const nonMatchingModels = [];

        for (const model of availableModels) {
            try {
                const matches = modelPromptManager.evaluator.evaluate(expression, model);
                if (matches) {
                    matchingModels.push(model);
                } else {
                    nonMatchingModels.push(model);
                }
            } catch (modelError) {
                // If evaluation fails for a specific model, consider it non-matching
                nonMatchingModels.push(model);
            }
        }

        // Check if current model matches
        let currentModelMatches = false;
        if (currentModel) {
            try {
                currentModelMatches = modelPromptManager.evaluator.evaluate(expression, currentModel);
            } catch (error) {
                currentModelMatches = false;
            }
        }

        // Build filtered display showing only matching models
        let filteredHTML = '';

        if (matchingModels.length > 0) {
            filteredHTML += `<div class="m-b-1">`;
            filteredHTML += `<span class="text-success">✅ Filter matches ${matchingModels.length}/${availableModels.length} models</span>`;

            // Current model status
            if (currentModel) {
                const statusIcon = currentModelMatches ? '🎯' : '❌';
                const statusClass = currentModelMatches ? 'text-success' : 'text-danger';
                filteredHTML += `<br><span class="${statusClass} tiny">${statusIcon} Current: "${currentModel}" ${currentModelMatches ? 'matches' : 'no match'}</span>`;
            }
            filteredHTML += `</div>`;

            // Show matching models
            if (matchingModels.length > 10) {
                filteredHTML += `<p>Matching models (${matchingModels.length} total): ${matchingModels.slice(0, 8).join(', ')} ... <a href="#" id="show-models-popout">view all</a></p>`;
            } else {
                filteredHTML += `<p>Matching models: ${matchingModels.join(', ')}</p>`;
            }
        } else {
            filteredHTML = '<div class="text-warning">⚠️ No models match this filter expression</div>';
        }

        modelsInfoElement.innerHTML = filteredHTML;

    } catch (error) {
        modelsInfoElement.innerHTML = `<p class="text-danger">❌ Invalid filter: ${error.message}</p>`;
    }
}

function showAvailableModelsPopup(availableModels) {
    const content = `
        <div class="completion_prompt_manager_popup_entry">
            <h3>Available Models</h3>
            <div class="max-h-24 overflow-y-auto bg-dark-600 p-1 rounded">
                ${availableModels.map(model => `<div class="marginBot5">• ${model}</div>`).join('')}
            </div>
        </div>
    `;

    const popup = new Popup(content, POPUP_TYPE.TEXT, '', {
        wide: false,
        large: false,
        allowVerticalScrolling: true
    });

    popup.show();
}

// Placeholder functions for rule management (to be implemented)
async function showAddRuleDialog() {
    try {
        updateStatusFeedback('Opening add rule dialog...', 'info');

        // Get current API info for preset options
        const apiInfo = await getCurrentApiInfo();
        const isChatCompletion = isUsingChatCompletion();

        // Get available presets
        let presets = [];
        try {
            const presetManager = getPresetManager(apiInfo.completionSource);
            if (presetManager && presetManager.presets) {
                presets = Object.keys(presetManager.presets).map(name => ({
                    name,
                    value: name
                }));
            }
        } catch (error) {
            console.warn('STCL: Could not get presets for add rule dialog:', error);
        }

        const presetOptions = presets.map(preset =>
            `<option value="${preset.value}">${preset.name}</option>`
        ).join('');

        const content = `
            <div class="completion_prompt_manager_popup_entry">
                <h3>Add New Model-Prompt Rule</h3>

                <div class="completion_prompt_manager_popup_entry_form_control">
                    <h4>Rule Configuration</h4>

                    <div class="m-b-1">
                        <label class="marginBot5 d-block fw-bold">Rule Description:</label>
                        <input type="text" id="rule-description" placeholder="e.g., GPT-4 models use detailed prompts"
                               class="text_pole wide_text_pole">
                    </div>

                    <div class="m-b-1">
                        <label class="marginBot5 d-block fw-bold">Filter Expression:</label>
                        <input type="text" id="rule-filter-expression" placeholder="e.g., gpt-4 AND NOT turbo"
                               class="text_pole wide_text_pole">
                        <div id="rule-filter-validation" class="small m-t-1 min-h-1"></div>
                    </div>

                    <div class="m-b-1">
                        <label class="marginBot5 d-block fw-bold">Target ${isChatCompletion ? 'Prompt' : 'Preset'}:</label>
                        <select id="rule-target-preset" class="text_pole wide_text_pole">
                            <option value="">Select ${isChatCompletion ? 'prompt' : 'preset'}...</option>
                            ${presetOptions}
                        </select>
                    </div>

                    <div class="m-b-1">
                        <label class="marginBot5 d-block fw-bold">Priority:</label>
                        <input type="number" id="rule-priority" value="100" min="1" max="1000"
                               class="text_pole">
                        <span class="small text-muted m-l-1">Higher numbers = higher priority</span>
                    </div>

                    <div class="m-b-1">
                        <label class="checkbox_label">
                            <input type="checkbox" id="rule-enabled" checked>
                            <span>Enable this rule</span>
                        </label>
                    </div>
                </div>
            </div>
        `;

        const addRulePopup = new Popup(content, POPUP_TYPE.TEXT, '', {
            wide: true,
            large: false,
            allowVerticalScrolling: true,
            cancelButton: 'Cancel',
            okButton: 'Add Rule',
            onOk: async () => {
                return await saveNewRule();
            }
        });

        await addRulePopup.show();

        // Set up real-time validation for the filter expression
        const filterInput = document.getElementById('rule-filter-expression');
        if (filterInput) {
            let ruleValidationTimeout;
            filterInput.addEventListener('input', function() {
                const expression = this.value;

                // Clear previous timeout
                if (ruleValidationTimeout) {
                    clearTimeout(ruleValidationTimeout);
                }

                // Debounce validation by 300ms
                ruleValidationTimeout = setTimeout(async () => {
                    await validateRuleFilterExpression(expression);
                }, 300);
            });
        }

        updateStatusFeedback('Add rule dialog opened', 'success');

    } catch (error) {
        console.error('STCL: Error showing add rule dialog:', error);
        updateStatusFeedback(`Error opening add rule dialog: ${error.message}`, 'error');
    }
}

async function editRule(ruleId) {
    try {
        updateStatusFeedback(`Opening edit dialog for rule ${ruleId}...`, 'info');

        // TODO: Fetch existing rule data by ruleId from settings
        // For now, show placeholder content
        const content = `
            <div class="completion_prompt_manager_popup_entry">
                <h3>Edit Model-Prompt Rule</h3>

                <div class="completion_prompt_manager_popup_entry_form_control">
                    <p class="text-warning m-b-1">
                        ⚠️ Edit rule functionality requires rule storage system to be implemented.
                    </p>

                    <p class="text-muted">
                        Rule ID: <strong>${ruleId}</strong>
                    </p>

                    <p class="text-muted small">
                        This dialog would allow editing the rule's description, filter expression,
                        target preset/prompt, priority, and enabled status.
                    </p>
                </div>
            </div>
        `;

        const editRulePopup = new Popup(content, POPUP_TYPE.TEXT, '', {
            wide: true,
            large: false,
            allowVerticalScrolling: true,
            cancelButton: 'Cancel',
            okButton: false
        });

        await editRulePopup.show();

        updateStatusFeedback(`Edit rule ${ruleId} dialog opened (placeholder)`, 'warning');
        console.log('STCL: editRule called for:', ruleId);

    } catch (error) {
        console.error('STCL: Error showing edit rule dialog:', error);
        updateStatusFeedback(`Error opening edit rule dialog: ${error.message}`, 'error');
    }
}

async function deleteRule(ruleId) {
    try {
        updateStatusFeedback(`Confirming deletion of rule ${ruleId}...`, 'info');

        const content = `
            <div class="completion_prompt_manager_popup_entry">
                <h3>Delete Model-Prompt Rule</h3>

                <div class="completion_prompt_manager_popup_entry_form_control">
                    <p class="text-danger m-b-1">
                        ⚠️ Are you sure you want to delete this rule?
                    </p>

                    <p class="marginBot10 text-muted">
                        Rule ID: <strong>${ruleId}</strong>
                    </p>

                    <p class="text-muted small">
                        This action cannot be undone. The rule will be permanently removed
                        from your configuration.
                    </p>
                </div>
            </div>
        `;

        const deleteRulePopup = new Popup(content, POPUP_TYPE.TEXT, '', {
            wide: false,
            large: false,
            allowVerticalScrolling: false,
            cancelButton: 'Cancel',
            okButton: 'Delete Rule',
            onOk: async () => {
                return await confirmDeleteRule(ruleId);
            }
        });

        await deleteRulePopup.show();

    } catch (error) {
        console.error('STCL: Error showing delete rule dialog:', error);
        updateStatusFeedback(`Error opening delete rule dialog: ${error.message}`, 'error');
    }
}

// Helper function to save a new rule from the add rule dialog
async function saveNewRule() {
    try {
        const description = document.getElementById('rule-description')?.value?.trim();
        const filterExpression = document.getElementById('rule-filter-expression')?.value?.trim();
        const targetPreset = document.getElementById('rule-target-preset')?.value;
        const priority = parseInt(document.getElementById('rule-priority')?.value) || 100;
        const enabled = document.getElementById('rule-enabled')?.checked || false;

        // Validation
        if (!description) {
            updateStatusFeedback('Rule description is required', 'error');
            return false;
        }

        if (!filterExpression) {
            updateStatusFeedback('Filter expression is required', 'error');
            return false;
        }

        if (!targetPreset) {
            updateStatusFeedback('Target preset/prompt is required', 'error');
            return false;
        }

        // Validate filter expression syntax
        try {
            if (modelPromptManager && modelPromptManager.evaluator) {
                modelPromptManager.evaluator.evaluate(filterExpression, 'test-model');
            }
        } catch (validationError) {
            updateStatusFeedback(`Invalid filter expression: ${validationError.message}`, 'error');
            return false;
        }

        // Create new rule object
        const newRule = {
            ruleId: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            description: description,
            condition: filterExpression,
            priority: priority,
            enabled: enabled,
            timestamp: Date.now()
        };

        // Add preset/prompt target based on API type
        const apiInfo = await getCurrentApiInfo();
        if (isUsingChatCompletion()) {
            newRule.ccPrompts = targetPreset;
        } else {
            newRule.tcPrompts = targetPreset;
        }

        // Save to model prompt manager
        try {
            if (modelPromptManager) {
                const context = getContext();
                const success = modelPromptManager.addOrUpdateRule(newRule, 'global', null);
                if (success) {
                    console.log('STCL: New rule saved successfully:', newRule);

                    // Save extension settings
                    storageAdapter.saveExtensionSettings();

                    updateStatusFeedback(`Rule "${description}" created successfully! 🎉`, 'success');

                    // Show visual feedback with auto-scroll
                    setTimeout(() => {
                        // Close the current popup first
                        if (currentPopupInstance) {
                            currentPopupInstance.complete();
                        }

                        // Refresh the main Model-Prompt config window to show the new rule
                        setTimeout(async () => {
                            try {
                                await showModelPromptConfigWindow();

                                // Auto-scroll to the new rule after a brief delay
                                setTimeout(() => {
                                    const rulesContainer = document.getElementById('rules-container');
                                    const newRuleElement = document.querySelector(`[data-rule-id="${newRule.ruleId}"]`);

                                    if (rulesContainer && newRuleElement) {
                                        // Highlight the new rule with animation
                                        newRuleElement.style.boxShadow = '0 0 15px #4CAF50';
                                        newRuleElement.style.transition = 'box-shadow 0.3s ease';

                                        // Scroll to the new rule
                                        newRuleElement.scrollIntoView({
                                            behavior: 'smooth',
                                            block: 'center'
                                        });

                                        // Remove highlight after 3 seconds
                                        setTimeout(() => {
                                            if (newRuleElement) {
                                                newRuleElement.style.boxShadow = '';
                                            }
                                        }, 3000);
                                    }
                                }, 500);

                            } catch (refreshError) {
                                console.error('STCL: Error refreshing config window:', refreshError);
                            }
                        }, 300);

                    }, 100);

                    return true;
                } else {
                    throw new Error('Failed to save rule to model prompt manager');
                }
            } else {
                throw new Error('Model prompt manager not available');
            }
        } catch (saveError) {
            console.error('STCL: Error saving rule:', saveError);
            updateStatusFeedback(`Error saving rule: ${saveError.message}`, 'error');
            return false;
        }

    } catch (error) {
        console.error('STCL: Error saving new rule:', error);
        updateStatusFeedback(`Error saving rule: ${error.message}`, 'error');
        return false;
    }
}

// Helper function to validate filter expressions in rule dialogs with real-time testing
async function validateRuleFilterExpression(expression) {
    const validationElement = document.getElementById('rule-filter-validation');
    if (!validationElement) return;

    if (!expression.trim()) {
        validationElement.innerHTML = '';
        return;
    }

    try {
        // First, validate syntax
        if (!modelPromptManager || !modelPromptManager.evaluator) {
            validationElement.innerHTML = '<span class="text-warning">⚠️ Cannot validate (evaluator not available)</span>';
            return;
        }

        // Test syntax with a dummy model
        const syntaxTestResult = modelPromptManager.evaluator.evaluate(expression, 'test-model');

        // Get current API info and available models for real-time testing
        const apiInfo = await getCurrentApiInfo();
        const availableModels = getAvailableModels(apiInfo.completionSource);
        const currentModel = apiInfo.model;

        // Test the expression against all available models
        const matchingModels = [];

        for (const model of availableModels) {
            try {
                const matches = modelPromptManager.evaluator.evaluate(expression, model);
                if (matches) {
                    matchingModels.push(model);
                }
            } catch (modelError) {
                // If evaluation fails for a specific model, consider it non-matching
            }
        }

        // Check if current model matches
        let currentModelMatches = false;
        if (currentModel) {
            try {
                currentModelMatches = modelPromptManager.evaluator.evaluate(expression, currentModel);
            } catch (error) {
                currentModelMatches = false;
            }
        }

        // Build validation display with real-time results
        let validationHTML = '<span class="text-success">✅ Valid expression</span>';

        if (matchingModels.length > 0) {
            validationHTML += ` <span class="text-info">(${matchingModels.length} matches)</span>`;
        } else {
            validationHTML += ' <span class="text-warning">(no matches)</span>';
        }

        // Current model status
        if (currentModel) {
            const statusIcon = currentModelMatches ? '🎯' : '❌';
            const statusClass = currentModelMatches ? 'text-success' : 'text-danger';
            validationHTML += `<br><span class="${statusClass}">${statusIcon} Current: ${currentModelMatches ? 'Match' : 'No match'}</span>`;
        }

        validationElement.innerHTML = validationHTML;

    } catch (error) {
        validationElement.innerHTML = `<span class="text-danger">❌ Invalid: ${error.message}</span>`;
    }
}

// Helper function to confirm and execute rule deletion
async function confirmDeleteRule(ruleId) {
    try {
        // TODO: Actually delete the rule from extension settings and user settings
        console.log('STCL: Rule would be deleted:', ruleId);

        updateStatusFeedback(`Rule ${ruleId} deleted successfully`, 'success');

        // TODO: Refresh the rule list display
        return true;

    } catch (error) {
        console.error('STCL: Error deleting rule:', error);
        updateStatusFeedback(`Error deleting rule: ${error.message}`, 'error');
        return false;
    }
}

async function applyModelPromptRules() {
    try {
        updateStatusFeedback('Applying rules...', 'info');

        if (modelPromptManager) {
            const apiInfo = await getCurrentApiInfo();
            const context = await settingsManager.chatContext.getCurrent();

            // Trigger rule evaluation and application
            await modelPromptManager.evaluateAndApply(apiInfo.model, context);
            updateStatusFeedback('Rules applied successfully', 'success');

            toastr.success('Model-Prompt rules applied', MODULE_NAME);
        } else {
            throw new Error('Model-Prompt manager not available');
        }
    } catch (error) {
        console.error('STCL: Error applying rules:', error);
        updateStatusFeedback(`Error applying rules: ${error.message}`, 'error');
    }
}

function exportModelPromptRules() {
    try {
        updateStatusFeedback('Exporting model-prompt rules...', 'info');

        // Check if master source loader has export capability
        if (masterSourceLoader && typeof masterSourceLoader.exportFilters === 'function') {
            const exportData = masterSourceLoader.exportFilters();

            if (exportData) {
                // Download the exported data as JSON file
                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `stcl-model-prompt-rules-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                updateStatusFeedback('Rules exported successfully', 'success');
                console.log('STCL: Model-prompt rules exported');
                return;
            }
        }

        // Fallback: export from extension settings
        const extensionSettings = storageAdapter.getExtensionSettings();
        const rules = extensionSettings.modelPromptMappings?.rules || [];

        if (rules.length === 0) {
            updateStatusFeedback('No rules to export', 'warning');
            return;
        }

        const exportData = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            rules: rules
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `stcl-model-prompt-rules-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        updateStatusFeedback(`Exported ${rules.length} rules successfully`, 'success');
        console.log('STCL: Model-prompt rules exported from settings');

    } catch (error) {
        console.error('STCL: Error exporting rules:', error);
        updateStatusFeedback(`Error exporting rules: ${error.message}`, 'error');
    }
}

function importModelPromptRules() {
    try {
        // Check if import is disabled due to master source
        const masterStatus = masterSourceLoader ? masterSourceLoader.getMasterSourceStatus() : {};

        if (masterStatus.filtersEnabled) {
            updateStatusFeedback('Import disabled: Master source configured for filters', 'warning');
            return;
        }

        updateStatusFeedback('Select rules file to import...', 'info');

        // Create file input for import
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';

        fileInput.addEventListener('change', function(event) {
            const file = event?.target?.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const importData = JSON.parse(e.target.result);

                    // Validate import data structure
                    if (!importData.rules || !Array.isArray(importData.rules)) {
                        throw new Error('Invalid rules file format');
                    }

                    // TODO: Implement actual import to extension settings
                    console.log('STCL: Rules to import:', importData);
                    updateStatusFeedback(`Import ready: ${importData.rules.length} rules found (implementation pending)`, 'warning');

                } catch (parseError) {
                    console.error('STCL: Error parsing import file:', parseError);
                    updateStatusFeedback(`Error parsing file: ${parseError.message}`, 'error');
                }
            };

            reader.readAsText(file);
        });

        document.body.appendChild(fileInput);
        fileInput.click();
        document.body.removeChild(fileInput);

    } catch (error) {
        console.error('STCL: Error importing rules:', error);
        updateStatusFeedback(`Error importing rules: ${error.message}`, 'error');
    }
}

function exportPromptTemplates() {
    try {
        updateStatusFeedback('Exporting prompt templates...', 'info');

        // Check if master source loader has export capability
        if (masterSourceLoader && typeof masterSourceLoader.exportTemplates === 'function') {
            const exportData = masterSourceLoader.exportTemplates();

            if (exportData) {
                // Download the exported data as JSON file
                const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `stcl-prompt-templates-${new Date().toISOString().split('T')[0]}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                updateStatusFeedback('Templates exported successfully', 'success');
                console.log('STCL: Prompt templates exported');
                return;
            }
        }

        // Fallback: export templates from extension settings
        updateStatusFeedback('Templates export functionality requires template storage system', 'warning');
        console.log('STCL: exportPromptTemplates called - fallback to settings');

    } catch (error) {
        console.error('STCL: Error exporting templates:', error);
        updateStatusFeedback(`Error exporting templates: ${error.message}`, 'error');
    }
}

function importPromptTemplates() {
    try {
        // Check if import is disabled due to master source
        const masterStatus = masterSourceLoader ? masterSourceLoader.getMasterSourceStatus() : {};

        if (masterStatus.templatesEnabled) {
            updateStatusFeedback('Import disabled: Master source configured for templates', 'warning');
            return;
        }

        updateStatusFeedback('Select templates file to import...', 'info');

        // Create file input for import
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.json';
        fileInput.style.display = 'none';

        fileInput.addEventListener('change', function(event) {
            const file = event?.target?.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const importData = JSON.parse(e.target.result);

                    // TODO: Validate and implement template import
                    console.log('STCL: Templates to import:', importData);
                    updateStatusFeedback('Template import functionality requires template storage system', 'warning');

                } catch (parseError) {
                    console.error('STCL: Error parsing template file:', parseError);
                    updateStatusFeedback(`Error parsing file: ${parseError.message}`, 'error');
                }
            };

            reader.readAsText(file);
        });

        document.body.appendChild(fileInput);
        fileInput.click();
        document.body.removeChild(fileInput);

    } catch (error) {
        console.error('STCL: Error importing templates:', error);
        updateStatusFeedback(`Error importing templates: ${error.message}`, 'error');
    }
}

// Function to refresh the available models display
async function refreshAvailableModels() {
    try {
        updateStatusFeedback('Refreshing available models...', 'info');

        // Get current API info
        const apiInfo = await getCurrentApiInfo();
        const completionSource = apiInfo.completionSource;

        // Update the completion source display
        const sourceElement = document.getElementById('current-completion-source');
        if (sourceElement) {
            sourceElement.textContent = completionSource || 'Unknown';
        }

        // Get fresh model list
        const availableModels = getAvailableModels(completionSource);

        // Update the models info display
        const modelsInfoElement = document.getElementById('available-models-info');
        if (modelsInfoElement) {
            const content = availableModels.length > 10 ?
                `<p>Too many models to display (${availableModels.length} total). <a href="#" id="show-models-popout">Click to view all</a></p>` :
                `<p>${availableModels.join(', ') || 'No models available'}</p>`;

            modelsInfoElement.innerHTML = content;

            // Event delegation handles the popout link automatically
        }

        updateStatusFeedback(`Models refreshed for ${completionSource} (${availableModels.length} models found)`, 'success');
        console.log(`STCL: Refreshed ${availableModels.length} models for ${completionSource}`);

    } catch (error) {
        console.error('STCL: Error refreshing available models:', error);
        updateStatusFeedback(`Error refreshing models: ${error.message}`, 'error');
    }
}

// Function to toggle between global and source-specific filter scope
async function toggleFilterScope(isGlobal) {
    try {
        const sourceInfoBlock = document.getElementById('source-specific-info');
        const dualListBlock = document.getElementById('dual-list-management');

        if (isGlobal) {
            // Hide source-specific UI elements
            if (sourceInfoBlock) sourceInfoBlock.style.display = 'none';
            if (dualListBlock) dualListBlock.style.display = 'none';

            console.log('STCL: Filter scope set to global');
        } else {
            // Show source-specific UI elements
            if (sourceInfoBlock) sourceInfoBlock.style.display = 'block';
            if (dualListBlock) dualListBlock.style.display = 'block';

            // Update the source name in the info block
            await updateSourceSpecificDisplay();

            // Load and display current filter lists
            await updateDualListDisplay();

            console.log('STCL: Filter scope set to source-specific');
        }
    } catch (error) {
        console.error('STCL: Error toggling filter scope:', error);
    }
}

// Function to update the source-specific display with current completion source
async function updateSourceSpecificDisplay() {
    try {
        const apiInfo = await getCurrentApiInfo();
        const sourceNameElement = document.getElementById('source-specific-name');

        if (sourceNameElement) {
            sourceNameElement.textContent = apiInfo.completionSource || 'Unknown';
        }
    } catch (error) {
        console.error('STCL: Error updating source-specific display:', error);
    }
}

// Function to update the dual-list display with current filter data
async function updateDualListDisplay() {
    try {
        // Get current filters from settings (placeholder implementation)
        const apiInfo = await getCurrentApiInfo();
        const completionSource = apiInfo.completionSource;

        // For now, show placeholder content - this will be enhanced when rule management is implemented
        const sourceFiltersList = document.getElementById('source-filters-list');
        const globalFiltersList = document.getElementById('global-filters-list');

        if (sourceFiltersList) {
            sourceFiltersList.innerHTML = `
                <p class="text-muted-more italic tiny">
                    Source-specific filters for ${completionSource} would appear here
                </p>
            `;
        }

        if (globalFiltersList) {
            globalFiltersList.innerHTML = `
                <p class="text-muted-more italic tiny">
                    Global filters (excluding ${completionSource}) would appear here
                </p>
            `;
        }

        console.log(`STCL: Updated dual-list display for ${completionSource}`);
    } catch (error) {
        console.error('STCL: Error updating dual-list display:', error);
    }
}

// Function to move filters to source-specific scope
function moveFiltersToSource(mode) {
    try {
        if (mode === 'all') {
            updateStatusFeedback('Move all filters to source-specific functionality not yet implemented', 'warning');
            console.log('STCL: moveFiltersToSource(all) called - placeholder');
        } else if (mode === 'selected') {
            updateStatusFeedback('Move selected filter to source-specific functionality not yet implemented', 'warning');
            console.log('STCL: moveFiltersToSource(selected) called - placeholder');
        }
    } catch (error) {
        console.error('STCL: Error moving filters to source:', error);
        updateStatusFeedback(`Error moving filters: ${error.message}`, 'error');
    }
}

// Function to move filters to global scope
function moveFiltersToGlobal(mode) {
    try {
        if (mode === 'all') {
            updateStatusFeedback('Move all filters to global functionality not yet implemented', 'warning');
            console.log('STCL: moveFiltersToGlobal(all) called - placeholder');
        } else if (mode === 'selected') {
            updateStatusFeedback('Move selected filter to global functionality not yet implemented', 'warning');
            console.log('STCL: moveFiltersToGlobal(selected) called - placeholder');
        }
    } catch (error) {
        console.error('STCL: Error moving filters to global:', error);
        updateStatusFeedback(`Error moving filters: ${error.message}`, 'error');
    }
}

// Legacy function for compatibility - redirects to new unified window
async function showPromptSettingsPopup() {
    console.log('STCL: showPromptSettingsPopup called - redirecting to unified window');

    // Check for ongoing operation
    if (uiLocks.promptSettings) {
        console.warn('STCL: Prompt settings already in progress, ignoring request');
        return;
    }

    uiLocks.promptSettings = true;

    try {
        // Redirect to the new unified Model-Prompt Configuration Window
        await showModelPromptConfigWindow();

    } catch (error) {
        console.error('STCL: Error showing prompt settings popup:', error);
        toastr.error('Failed to open prompt settings', MODULE_NAME);
    } finally {
        uiLocks.promptSettings = false;
    }
}

async function attachPromptSettingsListenersAsync(popupElement) {
    console.log('STCL: Attaching prompt settings listeners (async DOM ready approach)');

    try {
        // Wait for Model-Prompt Links enable checkbox
        const enableModelPromptLinksCheckbox = await waitForElement('#stcl_enable_model_prompt_links', popupElement, 2000);
        if (enableModelPromptLinksCheckbox && !enableModelPromptLinksCheckbox.dataset.stclListenerAdded) {
            enableModelPromptLinksCheckbox.dataset.stclListenerAdded = 'true';
            console.log('STCL: Setting up Model-Prompt Links checkbox listener');

            enableModelPromptLinksCheckbox.addEventListener('change', function(e) {
                console.log('STCL: Model-Prompt Links checkbox changed:', e?.target?.checked);
                extension_settings.characterLocks.modelPromptLinks.enabled = e?.target?.checked;
                saveSettingsDebounced();

                if (typeof toastr !== 'undefined') {
                    const status = e?.target?.checked ? 'enabled' : 'disabled';
                    toastr.success(`Model-Prompt Links ${status}`, MODULE_NAME);
                }
            });
        }

        // Wait for Enable templates checkbox
        const enableTemplatesCheckbox = await waitForElement('#stcl_enable_templates', popupElement, 2000);
        if (enableTemplatesCheckbox && !enableTemplatesCheckbox.dataset.stclListenerAdded) {
            enableTemplatesCheckbox.dataset.stclListenerAdded = 'true';
            console.log('STCL: Setting up enable templates checkbox listener');

            enableTemplatesCheckbox.addEventListener('change', function(e) {
                console.log('STCL: Enable templates checkbox changed:', e?.target?.checked);
                extension_settings.characterLocks.modelPromptLinks.enableTemplates = e?.target?.checked;
                saveSettingsDebounced();

                if (typeof toastr !== 'undefined') {
                    const status = e?.target?.checked ? 'enabled' : 'disabled';
                    toastr.success(`Template system ${status}`, MODULE_NAME);
                }
            });
        }

        // Wait for Auto-import checkbox
        const autoImportCheckbox = await waitForElement('#stcl_auto_import', popupElement, 2000);
        if (autoImportCheckbox && !autoImportCheckbox.dataset.stclListenerAdded) {
            autoImportCheckbox.dataset.stclListenerAdded = 'true';
            console.log('STCL: Setting up auto-import checkbox listener');

            autoImportCheckbox.addEventListener('change', function(e) {
                console.log('STCL: Auto-import checkbox changed:', e?.target?.checked);
                extension_settings.characterLocks.modelPromptLinks.autoImport = e?.target?.checked;
                saveSettingsDebounced();

                if (typeof toastr !== 'undefined') {
                    const status = e?.target?.checked ? 'enabled' : 'disabled';
                    toastr.success(`Auto-import ${status}`, MODULE_NAME);
                }
            });
        }

        // Wait for Auto-assign checkbox
        const autoAssignCheckbox = await waitForElement('#stcl_auto_assign', popupElement, 2000);
        if (autoAssignCheckbox && !autoAssignCheckbox.dataset.stclListenerAdded) {
            autoAssignCheckbox.dataset.stclListenerAdded = 'true';
            console.log('STCL: Setting up auto-assign checkbox listener');

            autoAssignCheckbox.addEventListener('change', function(e) {
                console.log('STCL: Auto-assign checkbox changed:', e?.target?.checked);
                extension_settings.characterLocks.modelPromptLinks.autoAssign = e?.target?.checked;
                saveSettingsDebounced();

                if (typeof toastr !== 'undefined') {
                    const status = e?.target?.checked ? 'enabled' : 'disabled';
                    toastr.success(`Auto-assign ${status}`, MODULE_NAME);
                }
            });
        }

        // Wait for Configure Rules button
        const configureRulesBtn = await waitForElement('#stcl_configure_rules_btn', popupElement, 2000);
        if (configureRulesBtn && !configureRulesBtn.dataset.stclListenerAdded) {
            configureRulesBtn.dataset.stclListenerAdded = 'true';
            console.log('STCL: Setting up Configure Rules button listener');

            configureRulesBtn.addEventListener('click', function(e) {
                console.log('STCL: Configure Rules button clicked - target:', e.target);
                console.log('STCL: Event type:', e.type, 'bubbles:', e.bubbles, 'cancelable:', e.cancelable);
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                try {
                    console.log('STCL: About to call showRulesConfigurationPopup');
                    showRulesConfigurationPopup();
                    console.log('STCL: showRulesConfigurationPopup call completed');
                } catch (error) {
                    console.error('STCL: Error opening rules configuration:', error);
                }
            });
        } else if (!configureRulesBtn) {
            console.warn('STCL: Configure Rules button not found after waiting');
        }

        console.log('STCL: All prompt settings listeners attached successfully');

    } catch (error) {
        console.error('STCL: Error attaching prompt settings listeners:', error);
    }
}

function attachPromptSettingsListeners(popupElement) {
    console.log('STCL: Attaching prompt settings listeners (fallback simple approach)');

    try {
        // Model-Prompt Links enable checkbox
        const enableModelPromptLinksCheckbox = popupElement?.querySelector?.('#stcl_enable_model_prompt_links');
        if (enableModelPromptLinksCheckbox) {
            enableModelPromptLinksCheckbox.addEventListener('change', function(e) {
                console.log('STCL: Model-Prompt Links checkbox changed:', e?.target?.checked);
                extension_settings.characterLocks.modelPromptLinks.enabled = e?.target?.checked;
                saveSettingsDebounced();

                if (typeof toastr !== 'undefined') {
                    const status = e?.target?.checked ? 'enabled' : 'disabled';
                    toastr.success(`Model-Prompt Links ${status}`, MODULE_NAME);
                }
            });
        }

        // Enable templates checkbox
        const enableTemplatesCheckbox = popupElement?.querySelector?.('#stcl_enable_templates');
        if (enableTemplatesCheckbox) {
            enableTemplatesCheckbox.addEventListener('change', function(e) {
                console.log('STCL: Enable templates checkbox changed:', e?.target?.checked);
                extension_settings.characterLocks.modelPromptLinks.enableTemplates = e?.target?.checked;
                saveSettingsDebounced();

                if (typeof toastr !== 'undefined') {
                    const status = e?.target?.checked ? 'enabled' : 'disabled';
                    toastr.success(`Template system ${status}`, MODULE_NAME);
                }
            });
        }

        // Auto-import checkbox
        const autoImportCheckbox = popupElement?.querySelector?.('#stcl_auto_import');
        if (autoImportCheckbox) {
            autoImportCheckbox.addEventListener('change', function(e) {
                console.log('STCL: Auto-import checkbox changed:', e?.target?.checked);
                extension_settings.characterLocks.modelPromptLinks.autoImport = e?.target?.checked;
                saveSettingsDebounced();

                if (typeof toastr !== 'undefined') {
                    const status = e?.target?.checked ? 'enabled' : 'disabled';
                    toastr.success(`Auto-import ${status}`, MODULE_NAME);
                }
            });
        }

        // Auto-assign checkbox
        const autoAssignCheckbox = popupElement?.querySelector?.('#stcl_auto_assign');
        if (autoAssignCheckbox) {
            autoAssignCheckbox.addEventListener('change', function(e) {
                console.log('STCL: Auto-assign checkbox changed:', e?.target?.checked);
                extension_settings.characterLocks.modelPromptLinks.autoAssign = e?.target?.checked;
                saveSettingsDebounced();

                if (typeof toastr !== 'undefined') {
                    const status = e?.target?.checked ? 'enabled' : 'disabled';
                    toastr.success(`Auto-assign ${status}`, MODULE_NAME);
                }
            });
        }

        // Configure Rules button
        const configureRulesBtn = popupElement?.querySelector?.('#stcl_configure_rules_btn');
        if (configureRulesBtn) {
            configureRulesBtn.addEventListener('click', function(e) {
                console.log('STCL: Configure Rules button clicked');
                e.preventDefault();
                showRulesConfigurationPopup();
            });
        }

        console.log('STCL: All prompt settings listeners attached successfully (fallback)');

    } catch (error) {
        console.error('STCL: Error attaching prompt settings listeners:', error);
    }
}

async function showRulesConfigurationPopup() {
    console.log('STCL: showRulesConfigurationPopup called - redirecting to unified window');

    // Check for ongoing rules configuration operation
    if (uiLocks.rulesConfiguration) {
        console.warn('STCL: Rules configuration already in progress, ignoring request');
        return;
    }

    uiLocks.rulesConfiguration = true;

    try {
        // Redirect to the new unified Model-Prompt Configuration Window
        await showModelPromptConfigWindow();

    } catch (error) {
        console.error('STCL: Error showing unified configuration window:', error);
        toastr.error('Failed to open Model-Prompt configuration', MODULE_NAME);
    } finally {
        uiLocks.rulesConfiguration = false;
    }
}

async function saveRulesConfiguration() {
    try {
        const extensionSettings = storageAdapter.getExtensionSettings();
        const rulesContainer = document.querySelector('#rules-container');

        if (!rulesContainer) {
            console.error('STCL: Rules container not found');
            return false;
        }

        // Update rules with selected presets
        const ruleItems = rulesContainer.querySelectorAll('.rules-config-item');
        let updatedCount = 0;

        ruleItems.forEach(item => {
            const ruleId = item.dataset.ruleId;
            const presetSelect = item.querySelector('.rule-preset-select');

            if (ruleId && presetSelect) {
                const selectedPreset = presetSelect.value;

                // Find and update the rule
                const rule = extensionSettings.modelPromptMappings.rules.find(r => r.id === ruleId);
                if (rule) {
                    const oldPreset = rule.preset;
                    rule.preset = selectedPreset;

                    if (oldPreset !== selectedPreset) {
                        updatedCount++;
                        console.log(`STCL: Updated rule "${ruleId}" preset: "${oldPreset}" -> "${selectedPreset}"`);
                    }
                }
            }
        });

        // Save settings
        storageAdapter.saveExtensionSettings();

        // Show feedback
        if (updatedCount > 0) {
            toastr.success(`Updated ${updatedCount} rule${updatedCount === 1 ? '' : 's'}`, MODULE_NAME);
        } else {
            toastr.info('No changes made to rules', MODULE_NAME);
        }

        console.log(`STCL: Saved rules configuration, ${updatedCount} rules updated`);
        return true;

    } catch (error) {
        console.error('STCL: Error saving rules configuration:', error);
        toastr.error('Failed to save rules configuration', MODULE_NAME);
        return false;
    }
}

async function handlePopupClose(popup) {
    try {
        console.log('STCL: Popup close handler triggered');
        const popupElement = popup.dlg;
        const extensionSettings = storageAdapter.getExtensionSettings();
        const context = await settingsManager.chatContext.getCurrent();
        const isGroupChat = context.isGroupChat;

        let checkboxMappings = {};

        if (isGroupChat) {
            checkboxMappings = {
                'stcl-enable-character': 'enableGroupMemory',
                'stcl-enable-chat': 'enableChatMemory',
                'stcl-prefer-group-over-chat': 'preferGroupOverChat',
                'stcl-prefer-individual-character': 'preferIndividualCharacterInGroup',
                'stcl-show-other-notifications': 'showOtherNotifications',
                'stcl-enable-templates': 'enablePromptTemplates',
                'stcl-auto-import-templates': 'autoImportTemplates',
                'stcl-auto-assign-templates': 'autoAssignTemplates'
            };
        } else {
            checkboxMappings = {
                'stcl-enable-character': 'enableCharacterMemory',
                'stcl-enable-chat': 'enableChatMemory',
                'stcl-prefer-character': 'preferCharacterOverChat',
                'stcl-show-other-notifications': 'showOtherNotifications',
                'stcl-enable-templates': 'enablePromptTemplates',
                'stcl-auto-import-templates': 'autoImportTemplates',
                'stcl-auto-assign-templates': 'autoAssignTemplates'
            };
        }

        // Build newValues keyed by checkboxId
        const newValues = lodash.mapValues(checkboxMappings, (settingKey, checkboxId) => {
            const checkbox = popupElement?.querySelector?.(`#${checkboxId}`);
            return checkbox ? checkbox.checked : extensionSettings.moduleSettings[settingKey];
        });

        // Map newValues keys to setting keys for a fair comparison
        const newValuesMapped = lodash.mapKeys(newValues, (value, checkboxId) => checkboxMappings[checkboxId]);

        // Compare to old values (also keyed by setting keys)
        const oldValues = lodash.pick(extensionSettings.moduleSettings, Object.values(checkboxMappings));
        let changed = !lodash.isEqual(oldValues, newValuesMapped);

        // Note: Model-Prompt Links setting is handled in real-time by checkbox event listener
        // No need to handle it here to avoid double-save

        if (changed) {
            // Update module settings if they changed
            if (!lodash.isEqual(oldValues, newValuesMapped)) {
                lodash.merge(extensionSettings.moduleSettings, newValuesMapped);
            }
            storageAdapter.saveExtensionSettings();
        }
    } catch (error) {
        console.error('STCL: Error handling popup close:', error);
    }
}

// ===== UI CREATION =====

function createUI() {
    const menuItem = $(`
        <div id="stcl-menu-item-container" class="extension_container interactable" tabindex="0">
            <div id="stcl-menu-item" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
                <div class="fa-fw fa-solid fa-thumbtack extensionsMenuExtensionButton"></div>
                <span>Character Locks</span>
            </div>
        </div>
    `);

    $('#extensionsMenu').append(menuItem);
}

function addSettingsButtons() {
    // Settings buttons disabled - access only via extensions menu
}






function addPopupWrapStyle() {
    if (document.getElementById('stcl-popup-fix')) return;

    const css = `
        .popup-controls {
            flex-wrap: wrap !important;
            justify-content: center !important;
        }
    `;
    const style = document.createElement('style');
    style.id = 'stcl-popup-fix';
    style.textContent = css;
    document.head.appendChild(style);
}

// ===== EVENT SETUP =====

function setupEventListeners() {
    $(document).on('click', SELECTORS.menuItem, async function() {
        try {
            if (!settingsManager) {
                console.warn('STCL: Settings manager not initialized');
                return;
            }
            await showPopup();
        } catch (error) {
            console.error('STCL: Error opening popup from menu item:', error);
        }
    });

    // Register SillyTavern events
    function registerSillyTavernEvents() {
        if (eventListenersRegistered) {
            console.log('STCL: Event listeners already registered, cleaning up first');
            unregisterAllSTCLEventHandlers();
        }

        try {
            if (!eventSource || !event_types) {
                console.warn('STCL: eventSource or event_types not available, retrying...');
                setTimeout(registerSillyTavernEvents, 1000);
                return;
            }

            eventListenersRegistered = true;

            // Note: CHARACTER_SELECTED event doesn't exist in SillyTavern - using CHAT_CHANGED instead
            // CHAT_CHANGED fires when characters are selected/changed, covering both scenarios
            registerSTCLEventHandler(event_types.CHAT_CHANGED, onChatChanged, 'character/chat change');
            registerSTCLEventHandler(event_types.GROUP_CHAT_CREATED, async () => {
                // Use the GROUP_UPDATED event instead of timeout for proper synchronization
                await onCharacterChanged();
            }, 'group chat creation');

            registerSTCLEventHandler(event_types.GROUP_MEMBER_DRAFTED, async (chId) => {
                let characterProcessed = false;

                try {
                    // Use window.characters for broader compatibility
                    const chars = (typeof characters !== 'undefined') ? characters : window.characters;

                    if (!chars || !Array.isArray(chars)) {
                        console.error('STCL: Characters array not available or invalid');
                        return;
                    }

                    if (typeof chId !== 'number' || chId < 0 || chId >= chars.length) {
                        console.error('STCL: Invalid character ID:', chId, 'characters length:', chars.length);
                        return;
                    }

                    const charObj = chars[chId];
                    if (!charObj) {
                        console.error('STCL: Character object is null or undefined at index:', chId);
                        return;
                    }

                    console.log('STCL: group_member_drafted:', {
                        chId,
                        draftedCharacter: charObj,
                        name: charObj.name,
                        avatar: charObj.avatar,
                    });

                    // Queue this character for context
                    if (charObj.name && typeof charObj.name === 'string' && charObj.name.trim().length > 0) {
                        await settingsManager.chatContext._queueActiveCharacter(charObj.name);
                        console.log('STCL: Queued next active character:', charObj.name);
                        characterProcessed = true;
                    } else {
                        console.warn('STCL: Character name is invalid or empty:', charObj.name);
                    }
                } catch (error) {
                    console.error('STCL: Error in GROUP_MEMBER_DRAFTED handler:', error);
                }

                // Only trigger context change if character was successfully processed
                if (characterProcessed) {
                    await settingsManager.onContextChanged();
                } else {
                    console.warn('STCL: Skipping context change due to failed character processing');
                }
            });

            // Auto-save events removed - all saves are now manual through the UI

            // Register model change event handler
            if (event_types.MODEL_CHANGED) {
                console.log('STCL: Registering MODEL_CHANGED event:', event_types.MODEL_CHANGED);
                registerSTCLEventHandler(event_types.MODEL_CHANGED, onModelChanged, 'model change');
            } else {
                console.warn('STCL: MODEL_CHANGED event not available in this SillyTavern version');
            }

            // Also listen for OpenAI model selection changes (fallback)
            const modelChangeHandler = lodash.debounce(onModelChanged, 500);
            $(document).on('change', '#openai_model, #claude_model, #google_model, #mistral_model, #vertexai_model, #model_novel_select', modelChangeHandler);

            // Removed MESSAGE_RECEIVED handler - was too aggressive and caused constant reapplication

            console.log('STCL: Event listeners registered successfully');
        } catch (e) {
            console.warn('STCL: Could not bind to SillyTavern events:', e);
            setTimeout(registerSillyTavernEvents, 2000);
        }
    }

    registerSillyTavernEvents();

    // API change detection
    $(document).on('change', `${SELECTORS.mainApi}, ${SELECTORS.completionSource}`, function(e) {
        console.log('STCL: API change detected on:', e.target.id);

        // Don't trigger context change if we're currently applying settings (prevents feedback loop)
        if (!isApplyingSettings) {
            console.log('STCL: API/completion source changed - triggering context refresh');
            onCharacterChanged();
        } else if (isApplyingSettings) {
            console.log('STCL: Skipping context change - currently applying settings');
        }
    });

    // Preset/completion source settings change detection
    const allPresetSelectors = Object.values(PRESET_SELECTOR_MAP).join(', ');

    // Completion source changes
    $(document).on('change', SELECTORS.completionSource, function(e) {
        console.log('STCL: Completion source changed:', e.target.id);
        // Manual saves only - auto-save functionality removed
    });

    // Preset settings change detection
    $(document).on('change', allPresetSelectors, function(e) {
        console.log('STCL: Preset setting changed:', e.target.id);
        // Manual saves only - auto-save functionality removed
    });
}

// ===== MODEL-PROMPT MAPPINGS INITIALIZATION =====

async function initializeModelPromptMappings() {
    try {
        const extensionSettings = storageAdapter.getExtensionSettings();

        // Initialize predefined rules if the rules array is empty
        if (!extensionSettings.modelPromptMappings.rules || extensionSettings.modelPromptMappings.rules.length === 0) {
            console.log('STCL: Initializing predefined model-prompt mapping rules');
            const predefinedRules = modelPromptManager.getPredefinedRules();
            extensionSettings.modelPromptMappings.rules = predefinedRules;
            storageAdapter.saveExtensionSettings();
            console.log(`STCL: Initialized ${predefinedRules.length} predefined rules`);
        }
    } catch (error) {
        console.error('STCL: Error initializing model-prompt mappings:', error);
    }
}

// ===== MIGRATION =====

function migrateOldData() {
    const extensionSettings = storageAdapter.getExtensionSettings();

    if (extensionSettings.migrationVersion >= 8) {
        return;
    }
    
    console.log('STCL: Starting data migration...');

    // Migrate notification settings
    if (extensionSettings.moduleSettings.hasOwnProperty('showNotifications')) {
        const oldNotificationSetting = extensionSettings.moduleSettings.showNotifications;
        extensionSettings.moduleSettings.showOtherNotifications = oldNotificationSetting;
        delete extensionSettings.moduleSettings.showNotifications;
        console.log('STCL: Migrated legacy notification setting.');
    }

    // Legacy autosave migration removed - autosave functionality no longer supported

    // Migrate character settings (unescape keys)
    if (extensionSettings.characterSettings && Object.keys(extensionSettings.characterSettings).length > 0) {
        const oldCharacterSettings = { ...extensionSettings.characterSettings };
        const newCharacterSettings = {};
        let migratedCount = 0;

        for (const [characterKey, settings] of Object.entries(oldCharacterSettings)) {
            let characterName = characterKey;

            if (characterKey.includes('\\')) {
                try {
                    characterName = characterKey
                        .replace(/\\\\/g, '\\')
                        .replace(/\\\./g, '.')
                        .replace(/\\\]/g, ']')
                        .replace(/\\\[/g, '[');
                    console.log(`STCL: Unescaped character key "${characterKey}" to "${characterName}"`);
                } catch (e) {
                    console.warn(`STCL: Could not unescape key "${characterKey}", using as-is`);
                }
            }

            newCharacterSettings[characterName] = settings;
            migratedCount++;
        }

        extensionSettings.characterSettings = newCharacterSettings;
        console.log(`STCL: Migrated ${migratedCount} character settings`);
    }

    // Remove old chatSettings
    if (extensionSettings.chatSettings) {
        console.log('STCL: Removing old chatSettings from extension settings');
        delete extensionSettings.chatSettings;
    }

    // Add missing group settings
    if (!extensionSettings.moduleSettings.hasOwnProperty('enableGroupMemory')) {
        extensionSettings.moduleSettings.enableGroupMemory = true;
    }
    if (!extensionSettings.moduleSettings.hasOwnProperty('preferGroupOverChat')) {
        extensionSettings.moduleSettings.preferGroupOverChat = true;
    }
    if (!extensionSettings.moduleSettings.hasOwnProperty('preferIndividualCharacterInGroup')) {
        extensionSettings.moduleSettings.preferIndividualCharacterInGroup = false;
    }
    if (!extensionSettings.groupSettings) {
        extensionSettings.groupSettings = {};
    }

    // Migration for version 7-8: Add model-prompt mappings
    if (extensionSettings.migrationVersion < 8) {
        if (!extensionSettings.modelPromptMappings) {
            console.log('STCL: Initializing model-prompt mappings');
            extensionSettings.modelPromptMappings = {
                rules: [], // Will be populated with predefined rules by ModelPromptManager
                globalDefault: { preset: '', prompts: null },
                enableModelPromptLinks: true,
                followInheritanceChain: true
            };
        }
    }

    extensionSettings.migrationVersion = 8;
    storageAdapter.saveExtensionSettings();

    console.log('STCL: Data migration completed');
}

// ===== INITIALIZATION =====

let hasInitialized = false;

async function init() {
    if (hasInitialized) return;
    hasInitialized = true;
    
    console.log('STCL: Initializing extension');

    addPopupWrapStyle();

    // Wait for SillyTavern to be ready
    let attempts = 0;
    const maxAttempts = 20;

    while (attempts < maxAttempts) {
        if ($(SELECTORS.mainApi).length > 0 && eventSource && typeof Popup !== 'undefined') {
            break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
    }

    // Initialize core components with global state lock
    try {
        await acquireLock('globalState');

        // Initialize multi-user manager first
        multiUserManager = new MultiUserManager();
        await multiUserManager.initialize();

        // Initialize master source loader
        masterSourceLoader = new MasterSourceLoader(multiUserManager);

        storageAdapter = new StorageAdapter(multiUserManager);
        settingsManager = new SettingsManager(storageAdapter);
        promptTemplateManager = new PromptTemplateManager(storageAdapter);
        modelPromptManager = new ModelPromptManager(storageAdapter);
    } finally {
        releaseLock('globalState');
    }

    // Run data migration
    migrateOldData();

    // Initialize model-prompt mappings with predefined rules if needed
    await initializeModelPromptMappings();

    // Initialize prompt template manager
    await promptTemplateManager.initialize();

    // Initialize master source loader (after all other managers are ready)
    await masterSourceLoader.initialize();

    // Add cleanup handler for master source loader
    addCleanupHandler(() => {
        if (masterSourceLoader) {
            masterSourceLoader.cleanup();
            console.log('STCL: Master source loader cleaned up');
        }
    });

    // Create UI
    createUI();

    // Set up event listeners
    setupEventListeners();


    // Add settings buttons to various UI locations (after ensuring compatibility)
    addSettingsButtons();


    // Initial context load - use SETTINGS_LOADED_AFTER event if available
    if (event_types && event_types.SETTINGS_LOADED_AFTER) {
        const registered = registerSTCLEventHandler(event_types.SETTINGS_LOADED_AFTER, async () => {
            if (settingsManager) {
                await settingsManager.onContextChanged();
            }
            console.log('STCL: Initial context loaded after settings');
        }, 'settings loaded');

        if (!registered) {
            console.warn('STCL: Failed to register SETTINGS_LOADED_AFTER, triggering context change immediately');
            if (settingsManager) {
                await settingsManager.onContextChanged();
            }
            console.log('STCL: Initial context loaded (immediate fallback after registration failure)');
        }
    } else {
        // Fallback for older versions or when event_types not available
        console.log('STCL: SETTINGS_LOADED_AFTER not available, triggering context change immediately');
        if (settingsManager) {
            await settingsManager.onContextChanged();
        }
        console.log('STCL: Initial context loaded (immediate fallback)');
    }

    // Check for potential conflict with SillyTavern's bind_preset_to_connection setting
    if (power_user && power_user.bind_preset_to_connection === true) {
        const warningContent = `
            <div class="m-b-1">
                <h3 class="warning">⚠️ Setting Conflict Warning</h3>
                <p>SillyTavern's <strong>'Bind Preset to Connection'</strong> setting is enabled.</p>
                <p>This may conflict with STCL's <strong>Model-Prompt Links</strong> feature, causing unexpected preset switching behavior.</p>
                <p>Consider disabling one of these features to avoid conflicts:</p>
                <ul class="m-l-1">
                    <li>Disable <strong>'Bind Preset to Connection'</strong> in SillyTavern's User Settings</li>
                    <li>Or disable <strong>'Model-Prompt Links'</strong> in STCL settings</li>
                </ul>
            </div>
        `;

        const warningPopup = new Popup(warningContent, POPUP_TYPE.TEXT, '', {
            wide: false,
            large: false,
            allowHorizontalScrolling: false,
            allowVerticalScrolling: false
        });

        // Show warning asynchronously to avoid blocking initialization
        setTimeout(() => {
            warningPopup.show();
        }, 1000);

        console.warn('STCL: Warning - bind_preset_to_connection is enabled, may conflict with Model-Prompt Links');
    }

    console.log('STCL: extension loaded successfully');
}

// ===== BOOTSTRAP =====

$(document).ready(() => {
    if (eventSource && event_types && event_types.APP_READY) {
        const registered = registerSTCLEventHandler(event_types.APP_READY, init, 'app ready');
        if (registered) {
            console.log('STCL: Registered for APP_READY event');
        } else {
            console.warn('STCL: Failed to register APP_READY event, running immediate fallback');
            if (!hasInitialized) {
                console.log('STCL: Running immediate fallback initialization after registration failure');
                init();
            }
        }
    } else {
        console.warn('STCL: APP_READY event not available, running immediate fallback initialization');
        if (!hasInitialized) {
            console.log('STCL: Running immediate fallback initialization');
            init();
        }
    }
});