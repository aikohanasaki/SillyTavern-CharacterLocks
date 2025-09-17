import { eventSource, event_types, saveSettingsDebounced, chat_metadata, name2, systemUserName, neutralCharacterName, characters } from '../../../../script.js';
import { extension_settings, saveMetadataDebounced, getContext } from '../../../extensions.js';
import { Popup, POPUP_TYPE } from '../../../popup.js';
import { lodash, moment, Handlebars, DOMPurify, morphdom } from '../../../../lib.js';
import { selected_group, groups } from '../../../group-chats.js';

// ===== CONSTANTS AND CONFIGURATION =====

const MODULE_NAME = 'STMTL';
const SAVE_DEBOUNCE_TIME = 1000;
const CACHE_TTL = 1000;

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

const SELECTORS = {
    mainApi: '#main_api',
    completionSource: '#chat_completion_source',
    menuItem: '#stmtl-menu-item',
    modelOpenai: '#model_openai_select',
    modelClaude: '#model_claude_select',
    modelOpenrouter: '#model_openrouter_select',
    modelAi21: '#model_ai21_select',
    modelGoogle: '#model_google_select',
    modelMistralai: '#model_mistralai_select',
    customModelId: '#custom_model_id',
    modelCustomSelect: '#model_custom_select',
    modelCohere: '#model_cohere_select',
    modelPerplexity: '#model_perplexity_select',
    modelGroq: '#model_groq_select',
    model01ai: '#model_01ai_select',
    modelNanogpt: '#model_nanogpt_select',
    modelDeepseek: '#model_deepseek_select',
    modelVertexai: '#model_vertexai_select',
    modelAimlapi: '#model_aimlapi_select',
    modelXai: '#model_xai_select',
    modelPollinations: '#model_pollinations_select',
    modelMoonshot: '#model_moonshot_select',
    modelFireworks: '#model_fireworks_select',
    modelCometapi: '#model_cometapi_select',
    modelAzureOpenai: '#model_azure_openai_select',
    modelElectronhub: '#model_electronhub_select',
    tempOpenai: '#temp_openai',
    tempCounterOpenai: '#temp_counter_openai'
};


const MODEL_SELECTOR_MAP = {
    'openai': SELECTORS.modelOpenai,
    'claude': SELECTORS.modelClaude,
    'openrouter': SELECTORS.modelOpenrouter,
    'ai21': SELECTORS.modelAi21,
    'makersuite': SELECTORS.modelGoogle,
    'mistralai': SELECTORS.modelMistralai,
    'custom': SELECTORS.customModelId,
    'cohere': SELECTORS.modelCohere,
    'perplexity': SELECTORS.modelPerplexity,
    'groq': SELECTORS.modelGroq,
    '01ai': SELECTORS.model01ai,
    'nanogpt': SELECTORS.modelNanogpt,
    'deepseek': SELECTORS.modelDeepseek,
    'vertexai': SELECTORS.modelVertexai,
    'aimlapi': SELECTORS.modelAimlapi,
    'xai': SELECTORS.modelXai,
    'pollinations': SELECTORS.modelPollinations,
    'moonshot': SELECTORS.modelMoonshot,
    'fireworks': SELECTORS.modelFireworks,
    'cometapi': SELECTORS.modelCometapi,
    'azure_openai': SELECTORS.modelAzureOpenai,
    'electronhub': SELECTORS.modelElectronhub
};

const DEFAULT_SETTINGS = {
    moduleSettings: {
        enableCharacterMemory: true,
        enableChatMemory: true,
        enableGroupMemory: true,
        preferCharacterOverChat: true,
        preferGroupOverChat: true,
        preferIndividualCharacterInGroup: false,
        autoSaveCharacter: false,
        autoSaveChat: false,
        autoSaveGroup: false,
        showAutoSaveNotifications: false,
        showOtherNotifications: false
    },
    characterSettings: {},
    groupSettings: {},
    migrationVersion: 6
};

// ===== CORE CLASSES =====

/**
 * Centralized chat context detection and management
 */
class ChatContext {
    constructor() {
        this.cache = new Map();
        this.cacheTime = 0;
        this.buildingContext = false;
    }

    async getCurrent() {
        const now = Date.now();
        if (now - this.cacheTime < CACHE_TTL && this.cache.has('current')) {
            return this.cache.get('current');
        }

        // Prevent concurrent context building
        if (this.buildingContext) {
            // Wait for the current build to complete
            while (this.buildingContext) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            // Return the newly built context if available
            if (this.cache.has('current')) {
                return this.cache.get('current');
            }
        }

        this.buildingContext = true;
        try {
            const context = this._buildContext();
            this.cache.set('current', context);
            this.cacheTime = now;
            return context;
        } finally {
            this.buildingContext = false;
        }
    }

    invalidate() {
        this.cache.clear();
        this.cacheTime = 0;
    }

    _buildContext() {
        const isGroupChat = !!selected_group;
        
        if (isGroupChat) {
            return this._buildGroupContext();
        } else {
            return this._buildSingleContext();
        }
    }

    _buildGroupContext() {
        const groupId = selected_group;
        const group = groups?.find(x => x.id === groupId);
        
        return {
            type: CHAT_TYPES.GROUP,
            isGroupChat: true,
            groupId,
            groupName: group?.name || null,
            chatId: group?.chat_id || null,
            chatName: group?.chat_id || null,
            characterName: group?.name || null,
            activeCharacterInGroup: this._getActiveCharacterInGroup(),
            primaryId: groupId,
            secondaryId: group?.chat_id
        };
    }

    _buildSingleContext() {
        const characterName = this._getCharacterNameForSettings();
        const chatId = this._getCurrentChatId();

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
    }

    _getActiveCharacterInGroup() {
        // Check if there's a queued character change
        if (characterQueue.length > 0) {
            const name = characterQueue.shift(); // Get the first in queue
            console.log('STMTL: _getActiveCharacterInGroup: Using queued active character:', name);
            return name;
        }
        // No character message found
        return null;
    }

    _queueActiveCharacter(characterName) {
        if (characterName && typeof characterName === 'string') {
            characterQueue.push(characterName);
            console.log('STMTL: Queued active character:', characterName);
        }
    }

    _getCharacterNameForSettings() {
        let characterName = name2;
        
        if (!characterName || characterName === systemUserName || characterName === neutralCharacterName) {
            characterName = this._getCharacterNameFromChatMetadata();
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

    _getCharacterNameFromChatMetadata() {
        try {
            const metadata = this._getCurrentChatMetadata();
            const characterName = metadata?.character_name;
            return characterName && typeof characterName === 'string' ? characterName.trim() : null;
        } catch (error) {
            console.warn('STMTL: Error getting character name from chat metadata:', error);
            return null;
        }
    }

    _getCurrentChatId() {
        try {
            const baseContext = getContext?.();
            if (baseContext?.chatId) {
                return baseContext.chatId;
            }
            if (typeof window.getCurrentChatId === 'function') {
                return window.getCurrentChatId();
            }
            return null;
        } catch (error) {
            console.warn('STMTL: Error getting chat ID:', error);
            return null;
        }
    }

    _getCurrentChatMetadata() {
        if (typeof window.chat_metadata !== 'undefined' && window.chat_metadata !== null) {
            return window.chat_metadata;
        }
        if (typeof chat_metadata !== 'undefined' && chat_metadata !== null) {
            return chat_metadata;
        }
        if (typeof window.getCurrentChatMetadata === 'function') {
            return window.getCurrentChatMetadata();
        }
        return null;
    }
}

/**
 * Centralized storage operations
 */
class StorageAdapter {
    constructor() {
        this.EXTENSION_KEY = MODULE_NAME;
    }

    getExtensionSettings() {
        if (!extension_settings[this.EXTENSION_KEY]) {
            extension_settings[this.EXTENSION_KEY] = lodash.cloneDeep(DEFAULT_SETTINGS);
        }
        return extension_settings[this.EXTENSION_KEY];
    }

    saveExtensionSettings() {
        saveSettingsDebounced();
    }

    // Character settings
    getCharacterSettings(characterName) {
        if (!characterName) {
            console.warn('STMTL: Cannot get character settings - invalid name');
            return null;
        }
        
        const normalizedName = this._normalizeCharacterName(characterName);
        const extensionSettings = this.getExtensionSettings();
        
        const settings = extensionSettings.characterSettings?.[normalizedName] || null;
        
        if (settings) {
            console.log(`STMTL: Retrieved character settings for "${normalizedName}"`);
            console.log('STMTL: Settings retrieved:', settings);
        } else {
            console.log(`STMTL: No settings found for "${normalizedName}"`);
        }
        
        return settings;
    }

    setCharacterSettings(characterName, settings) {
        if (!characterName) {
            console.warn('STMTL: Cannot save character settings - invalid name');
            return false;
        }

        const normalizedName = this._normalizeCharacterName(characterName);
        const extensionSettings = this.getExtensionSettings();

        if (!extensionSettings.characterSettings) {
            extensionSettings.characterSettings = {};
        }

        extensionSettings.characterSettings[normalizedName] = settings;
        
        console.log('STMTL: Settings saved:', settings);

        this.saveExtensionSettings();
        return true;
    }

    deleteCharacterSettings(characterName) {
        if (!characterName) {
            console.warn('STMTL: Cannot delete character settings - invalid name');
            return false;
        }

        const normalizedName = this._normalizeCharacterName(characterName);
        const extensionSettings = this.getExtensionSettings();

        if (extensionSettings.characterSettings?.[normalizedName]) {
            delete extensionSettings.characterSettings[normalizedName];
            console.log(`STMTL: Deleted character settings for "${normalizedName}"`);
            this.saveExtensionSettings();
            return true;
        }

        console.log(`STMTL: No settings to delete for "${normalizedName}"`);
        return false;
    }

    // Group settings
    getGroupSettings(groupId) {
        if (!groupId) {
            console.warn('STMTL: Cannot get group settings - invalid ID');
            return null;
        }
        
        const extensionSettings = this.getExtensionSettings();
        const settings = extensionSettings.groupSettings?.[groupId] || null;
        
        if (settings) {
            console.log(`STMTL: Retrieved group settings for group ID "${groupId}"`);
        } else {
            console.log(`STMTL: No group settings found for group ID "${groupId}"`);
        }
        
        return settings;
    }

    setGroupSettings(groupId, settings) {
        if (!groupId) {
            console.warn('STMTL: Cannot save group settings - invalid ID');
            return false;
        }

        const extensionSettings = this.getExtensionSettings();
        if (!extensionSettings.groupSettings) {
            extensionSettings.groupSettings = {};
        }

        extensionSettings.groupSettings[groupId] = settings;
        console.log(`STMTL: Saved group settings for group ID "${groupId}"`);

        this.saveExtensionSettings();
        return true;
    }

    deleteGroupSettings(groupId) {
        if (!groupId) {
            console.warn('STMTL: Cannot delete group settings - invalid ID');
            return false;
        }

        const extensionSettings = this.getExtensionSettings();

        if (extensionSettings.groupSettings?.[groupId]) {
            delete extensionSettings.groupSettings[groupId];
            console.log(`STMTL: Deleted group settings for group ID "${groupId}"`);
            this.saveExtensionSettings();
            return true;
        }

        console.log(`STMTL: No group settings to delete for group ID "${groupId}"`);
        return false;
    }

    // Chat settings
    getChatSettings() {
        try {
            const metadata = this._getCurrentChatMetadata();
            const settings = metadata?.[this.EXTENSION_KEY] || null;
            
            if (settings) {
                console.log('STMTL: Retrieved chat settings:', settings);
            } else {
                console.log('STMTL: No chat settings found');
            }
            
            return settings;
        } catch (error) {
            console.warn('STMTL: Error getting chat settings:', error);
            return null;
        }
    }

    setChatSettings(settings) {
        try {
            const metadata = this._getCurrentChatMetadata();
            if (!metadata) {
                console.warn('STMTL: Cannot save chat settings - no chat metadata available');
                return false;
            }

            metadata[this.EXTENSION_KEY] = settings;
            console.log('STMTL: Saved chat settings:', settings);

            this._triggerMetadataSave();
            return true;
        } catch (error) {
            console.error('STMTL: Error saving chat settings:', error);
            return false;
        }
    }

    deleteChatSettings() {
        try {
            const metadata = this._getCurrentChatMetadata();
            if (metadata?.[this.EXTENSION_KEY]) {
                delete metadata[this.EXTENSION_KEY];
                console.log('STMTL: Deleted chat settings');
                this._triggerMetadataSave();
                return true;
            }
            
            console.log('STMTL: No chat settings to delete');
            return false;
        } catch (error) {
            console.error('STMTL: Error deleting chat settings:', error);
            return false;
        }
    }

    // Group chat settings
    getGroupChatSettings(groupId) {
        if (!groupId) {
            console.warn('STMTL: Cannot get group chat settings - invalid group ID');
            return null;
        }
        
        try {
            const group = groups?.find(x => x.id === groupId);
            const settings = group?.chat_metadata?.[this.EXTENSION_KEY] || null;
            
            if (settings) {
                console.log('STMTL: Retrieved group chat settings:', settings);
            } else {
                console.log('STMTL: No group chat settings found');
            }
            
            return settings;
        } catch (error) {
            console.warn('STMTL: Error getting group chat settings:', error);
            return null;
        }
    }

    setGroupChatSettings(groupId, settings) {
        if (!groupId) {
            console.warn('STMTL: Cannot save group chat settings - invalid group ID');
            return false;
        }

        try {
            const group = groups?.find(x => x.id === groupId);
            if (!group) {
                console.warn('STMTL: Cannot save group chat settings - group not found');
                return false;
            }

            if (!group.chat_metadata) {
                group.chat_metadata = {};
            }

            group.chat_metadata[this.EXTENSION_KEY] = settings;
            console.log('STMTL: Saved group chat settings:', settings);

            if (typeof window.editGroup === 'function') {
                window.editGroup(groupId, false, false);
            } else {
                console.warn('STMTL: window.editGroup function not available');
            }
            
            return true;
        } catch (error) {
            console.error('STMTL: Error saving group chat settings:', error);
            return false;
        }
    }

    deleteGroupChatSettings(groupId) {
        if (!groupId) {
            console.warn('STMTL: Cannot delete group chat settings - invalid group ID');
            return false;
        }

        try {
            const group = groups?.find(x => x.id === groupId);
            if (group?.chat_metadata?.[this.EXTENSION_KEY]) {
                delete group.chat_metadata[this.EXTENSION_KEY];
                console.log('STMTL: Deleted group chat settings');
                
                if (typeof window.editGroup === 'function') {
                    window.editGroup(groupId, false, false);
                } else {
                    console.warn('STMTL: window.editGroup function not available');
                }
                
                return true;
            }
            
            console.log('STMTL: No group chat settings to delete');
            return false;
        } catch (error) {
            console.error('STMTL: Error deleting group chat settings:', error);
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

    _getCurrentChatMetadata() {
        if (typeof window.chat_metadata !== 'undefined' && window.chat_metadata !== null) {
            return window.chat_metadata;
        }
        if (typeof chat_metadata !== 'undefined' && chat_metadata !== null) {
            return chat_metadata;
        }
        if (typeof window.getCurrentChatMetadata === 'function') {
            return window.getCurrentChatMetadata();
        }
        return null;
    }

    _triggerMetadataSave() {
        try {
            if (typeof saveMetadataDebounced === 'function') {
                saveMetadataDebounced();
            } else if (typeof window.saveMetadataDebounced === 'function') {
                window.saveMetadataDebounced();
            }
        } catch (error) {
            console.error('STMTL: Error triggering metadata save:', error);
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
        const context = await this.chatContext.getCurrent();
        console.log('STMTL: Loading settings for context:', context);

        this.currentSettings = this._getEmptySettings();

        if (context.isGroupChat) {
            this._loadGroupSettings(context);
        } else {
            this._loadSingleSettings(context);
        }

        console.log('STMTL: Loaded settings:', this.currentSettings);
        return this.currentSettings;
    }

    _loadGroupSettings(context) {
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
    }

    _loadSingleSettings(context) {
        const prefs = this.storage.getExtensionSettings().moduleSettings;

        if (prefs.enableCharacterMemory && context.characterName) {
            this.currentSettings.character = this.storage.getCharacterSettings(context.characterName);
        }

        if (prefs.enableChatMemory && context.chatId) {
            this.currentSettings.chat = this.storage.getChatSettings();
        }
    }

    async getSettingsToApply() {
        const context = await this.chatContext.getCurrent();
        this.priorityResolver = new SettingsPriorityResolver(this.storage.getExtensionSettings());
        return this.priorityResolver.resolve(context, this.currentSettings);
    }

    onContextChanged() {
        // Add to queue and process asynchronously to prevent race conditions
        contextChangeQueue.push(Date.now());
        this._processContextChangeQueue();
    }

    async _processContextChangeQueue() {
        if (processingContext) {
            console.log('STMTL: Context change already in progress, queued');
            return;
        }

        if (contextChangeQueue.length === 0) {
            return;
        }

        processingContext = true;
        try {
            // Process the latest context change (discard duplicates)
            contextChangeQueue.length = 0;

            console.log('STMTL: Processing context change');
            this.chatContext.invalidate();
            await this.loadCurrentSettings();

            // Apply settings automatically when switching contexts with proper flag management
            const shouldApplySettings = await this._shouldApplySettingsAutomatically();
            console.log('STMTL: shouldApplySettings:', shouldApplySettings, 'isApplyingSettings:', isApplyingSettings);
            if (shouldApplySettings && !isApplyingSettings) {
                console.log('STMTL: Applying settings automatically on context change');
                await this.applySettings();
            } else {
                console.log('STMTL: Skipping automatic settings application - memory disabled or currently applying');
            }
        } finally {
            processingContext = false;

            // Process any additional changes that came in while we were processing
            if (contextChangeQueue.length > 0) {
                setTimeout(() => this._processContextChangeQueue(), 50);
            }
        }
    }

    async applySettings() {
        if (isApplyingSettings) {
            console.log('STMTL: Already applying settings, skipping');
            return false;
        }

        try {
            isApplyingSettings = true;
            const resolved = await this.getSettingsToApply();

            if (!resolved.settings) {
                console.log('STMTL: No settings to apply');
                return false;
            }

            console.log(`STMTL: Applying ${resolved.source} settings:`, resolved.settings);
            const result = await this._applySettingsToUI(resolved.settings);
            console.log('STMTL: Settings application result:', result);
            return result;
        } finally {
            isApplyingSettings = false;
        }
    }

    async _applySettingsToUI(settings) {
        const apiInfo = getCurrentApiInfo();
        console.log('STMTL: _applySettingsToUI called with:', settings);
        console.log('STMTL: Current API info:', apiInfo);

        // If the saved settings have a specific engine and it doesn't match the current one, change the engine in the UI.
        if (settings.completionSource && settings.completionSource !== apiInfo.completionSource) {
            // Return a promise that resolves when the completion source change is complete
            return new Promise((resolve) => {
                // Set up one-time listener for completion source change
                const handleSourceChanged = () => {
                    eventSource.removeListener(event_types.CHATCOMPLETION_SOURCE_CHANGED, handleSourceChanged);
                    const result = this._applyModelAndTemperature(settings);
                    resolve(result);
                };

                eventSource.on(event_types.CHATCOMPLETION_SOURCE_CHANGED, handleSourceChanged);

                // Set the completion source dropdown to the saved value and trigger the 'change' event.
                $(SELECTORS.completionSource).val(settings.completionSource).trigger('change');
            });
        }

        // If we've reached this point, the completion source is correct. Now apply the model and temperature.
        return this._applyModelAndTemperature(settings);
    }

    _applyModelAndTemperature(settings) {
        const apiInfo = getCurrentApiInfo();
        const selectors = getApiSelectors(apiInfo.completionSource);

        // Apply model setting
        if (settings.model) {
            if (apiInfo.completionSource === 'custom') {
                const customModelId = $(SELECTORS.customModelId);
                const modelCustomSelect = $(SELECTORS.modelCustomSelect);
                if (customModelId.length) {
                    customModelId.val(settings.model).trigger('input').trigger('change');
                }
                if (modelCustomSelect.length) {
                    modelCustomSelect.val(settings.model).trigger('change');
                }
            } else {
                const modelSelector = $(selectors.model);
                if (modelSelector.length) {
                    modelSelector.val(settings.model).trigger('change');
                }
            }
        }

        // Apply temperature setting
        if (lodash.isNumber(settings.temperature)) {
            const tempSelector = $(selectors.temp);
            const tempCounterSelector = $(selectors.tempCounter);
            if (tempSelector.length) {
                tempSelector.val(settings.temperature).trigger('input').trigger('change');
            }
            if (tempCounterSelector.length) {
                tempCounterSelector.val(settings.temperature).trigger('change');
            }
        }

        return true;
    }

    async saveCurrentUISettings(targets = {}, isAutoSave = false) {
        const context = await this.chatContext.getCurrent();
        const uiSettings = this._getCurrentUISettings();
        
        let savedCount = 0;
        const savedTypes = [];

        if (context.isGroupChat) {
            if (targets.character && context.groupId) {
                if (this.storage.setGroupSettings(context.groupId, uiSettings)) {
                    this.currentSettings.group = lodash.cloneDeep(uiSettings);
                    savedCount++;
                    savedTypes.push(SETTING_SOURCES.GROUP);
                }
            }
            if (targets.chat && context.chatId) {
                if (this.storage.setGroupChatSettings(context.groupId, uiSettings)) {
                    this.currentSettings.chat = lodash.cloneDeep(uiSettings);
                    savedCount++;
                    savedTypes.push(SETTING_SOURCES.GROUP_CHAT);
                }
            }
        } else {
            if (targets.character && context.characterName) {
                if (this.storage.setCharacterSettings(context.characterName, uiSettings)) {
                    this.currentSettings.character = lodash.cloneDeep(uiSettings);
                    savedCount++;
                    savedTypes.push(SETTING_SOURCES.CHARACTER);
                }
            }
            if (targets.chat && context.chatId) {
                if (this.storage.setChatSettings(uiSettings)) {
                    this.currentSettings.chat = lodash.cloneDeep(uiSettings);
                    savedCount++;
                    savedTypes.push(SETTING_SOURCES.CHAT);
                }
            }
        }

        this._showSaveNotification(savedCount, savedTypes, isAutoSave);
        return savedCount > 0;        
    }

    async saveCurrentSettingsForCharacter(characterName, isAutoSave = false) {
        const uiSettings = this._getCurrentUISettings();

        if (this.storage.setCharacterSettings(characterName, uiSettings)) {
            this._showSaveNotification(1, [`character: ${characterName}`], isAutoSave);
            return true;
        }
        return false;
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
            if (context.chatId && this.storage.deleteGroupChatSettings(context.groupId)) {
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
            if (context.chatId && this.storage.deleteChatSettings()) {
                this.currentSettings.chat = null;
                clearedCount++;
                clearedTypes.push(SETTING_SOURCES.CHAT);
            }
        }

        if (clearedCount > 0) {
            const typeText = clearedTypes.join(' & ');
            this._showToastr(`${typeText} settings cleared`, 'info');
        }

        return clearedCount;
    }

    _getCurrentUISettings() {
        const apiInfo = getCurrentApiInfo();
        const selectors = getApiSelectors(apiInfo.completionSource);
        
        let currentModel = '';
        if (apiInfo.completionSource === 'custom') {
            const customModelId = $(SELECTORS.customModelId);
            const modelCustomSelect = $(SELECTORS.modelCustomSelect);
            currentModel = (customModelId.length ? customModelId.val() : '') ||
                          (modelCustomSelect.length ? modelCustomSelect.val() : '') || '';
        } else {
            const modelSelector = $(selectors.model);
            currentModel = modelSelector.length ? modelSelector.val() || '' : '';
        }

        const tempSelector = $(selectors.temp);
        const tempCounterSelector = $(selectors.tempCounter);
        const currentTemp = parseFloat(
            (tempSelector.length ? tempSelector.val() : '') ||
            (tempCounterSelector.length ? tempCounterSelector.val() : '') ||
            0.7
        );

        return {
            model: currentModel,
            temperature: currentTemp,
            completionSource: apiInfo.completionSource,
            savedAt: moment().toISOString()
        };
    }

    _showSaveNotification(savedCount, savedTypes, isAutoSave) {
        if (savedCount === 0) return;

        const extensionSettings = this.storage.getExtensionSettings();
        const showNotification = (isAutoSave && extensionSettings.moduleSettings.showAutoSaveNotifications) ||
                                 (!isAutoSave && extensionSettings.moduleSettings.showOtherNotifications);

        if (showNotification) {
            const typeText = savedTypes.join(' & ');
            const messagePrefix = isAutoSave ? 'Auto-saved' : 'Saved';
            this._showToastr(`${messagePrefix} ${typeText} settings`, 'success');
        }
    }

    _showToastr(message, type) {
        if (typeof toastr !== 'undefined') {
            toastr[type](message, MODULE_NAME);
        } else {
            console.log(`STMTL: ${message}`);
        }
    }

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

// ===== GLOBAL STATE =====

let settingsManager = null;
let storageAdapter = null;
let isExtensionEnabled = false;
let currentPopupInstance = null;
let isApplyingSettings = false;
let eventListenersRegistered = false;
let contextChangeQueue = [];
let processingContext = false;
let characterQueue = [];
let processingCharacter = false;

// ===== UTILITY FUNCTIONS =====

function getApiSelectors(completionSource = null) {
    if (!completionSource) {
        completionSource = $(SELECTORS.completionSource).val();
    }

    // For chat completion sources, temperature is controlled by the main OpenAI temperature sliders
    // regardless of the specific completion source (openai, claude, openrouter, etc.)
    // This is because they all use the same OpenAI-compatible API interface
    return {
        model: MODEL_SELECTOR_MAP[completionSource] || SELECTORS.modelOpenai,
        temp: SELECTORS.tempOpenai,
        tempCounter: SELECTORS.tempCounterOpenai
    };
}

function getCurrentApiInfo() {
    try {
        let api = 'unknown';
        let model = 'unknown';
        let completionSource = 'unknown';

        // Get the main API
        api = $(SELECTORS.mainApi).val() || 'unknown';

        // Get the completion source (for OpenAI-compatible APIs)
        completionSource = $(SELECTORS.completionSource).val() || api;

        // Get current model based on the completion source
        const selectors = getApiSelectors(completionSource);
        if (completionSource === 'custom') {
            model = $(SELECTORS.customModelId).val() || $(SELECTORS.modelCustomSelect).val() || '';
        } else {
            model = $(selectors.model).val() || '';
        }

        return { api, model, completionSource };
    } catch (e) {
        console.warn('STMTL: Error getting API info:', e);
        return {
            api: $(SELECTORS.mainApi).val() || 'unknown',
            model: 'unknown',
            completionSource: $(SELECTORS.completionSource).val() || 'unknown'
        };
    }
}

function checkApiCompatibility() {
    let isCompatible = false;

    try {
        const mainApi = $(SELECTORS.mainApi).val();
        // Check if main API is 'openai' (which covers all chat completion APIs)
        isCompatible = mainApi === 'openai';
    } catch (e) {
        console.warn('STMTL: Error checking API compatibility:', e);
        const mainApi = $(SELECTORS.mainApi).val();
        isCompatible = mainApi === 'openai';
    }

    if (isCompatible !== isExtensionEnabled) {
        isExtensionEnabled = isCompatible;
        const extensionSettings = storageAdapter?.getExtensionSettings();
        
        if (extensionSettings?.moduleSettings.showOtherNotifications) {
            if (typeof toastr !== 'undefined') {
                if (isCompatible) {
                    toastr.info('STMTL extension enabled for Chat Completion API', MODULE_NAME);
                } else {
                    toastr.warning('STMTL requires Chat Completion API', MODULE_NAME);
                }
            }
        }
    }

    return isCompatible;
}

function formatSettingsInfo(settings) {
    if (!settings) {
        return isExtensionEnabled ? 'No saved settings' : 'Requires Chat Completion API';
    }

    const saved = settings.savedAt ? moment(settings.savedAt).format('MMM D, YYYY [at] h:mm A') : 'Unknown';
    return `Model: ${settings.model || 'N/A'}
Temp: ${settings.temperature || 'N/A'}
Source: ${settings.completionSource || 'N/A'}
Saved: ${saved}`;
}

// ===== TEMPLATE AND UI =====

const popupTemplate = Handlebars.compile(`
<div class="completion_prompt_manager_popup_entry">
    <div class="completion_prompt_manager_error {{#unless isExtensionEnabled}}caution{{/unless}}">
        <span>API Status: <strong>{{statusText}}</strong></span>
    </div>

    <div class="completion_prompt_manager_popup_entry_form_control">
        {{#each checkboxes}}
        <label class="checkbox_label">
            <input type="checkbox" id="{{id}}" {{#if checked}}checked{{/if}} {{#unless ../isExtensionEnabled}}{{#if requiresApi}}disabled{{/if}}{{/unless}}>
            <span>{{label}}</span>
        </label>
        {{/each}}
    </div>

    <div class="completion_prompt_manager_popup_entry_form_control">
        {{#if isGroupChat}}
        <h4>Group Settings:</h4>
        <div class="completion_prompt_manager_popup_entry_form_control marginTop10">
            <pre class="margin0">{{groupInfo}}</pre>
        </div>

        <h4>Current Chat Settings:</h4>
        <div class="completion_prompt_manager_popup_entry_form_control marginTop10">
            <pre class="margin0">{{chatInfo}}</pre>
        </div>

        <h4>Group Members:</h4>
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
        <h4>Current Character Settings:</h4>
        <div class="completion_prompt_manager_popup_entry_form_control marginTop10">
            <pre class="margin0">{{characterInfo}}</pre>
        </div>

        <h4>Current Chat Settings:</h4>
        <div class="completion_prompt_manager_popup_entry_form_control marginTop10">
            <pre class="margin0">{{chatInfo}}</pre>
        </div>
        {{/if}}
    </div>
</div>
`);

// ===== SIMPLIFIED EVENT HANDLERS =====

// Debounced model settings change handler
const debouncedModelSettingsChanged = lodash.debounce(async function() {
    console.log('STMTL: Debounced save triggered');
    await onModelSettingsChanged();
}, SAVE_DEBOUNCE_TIME);

function onCharacterChanged() {
    if (!isExtensionEnabled || !settingsManager) return;
    settingsManager.onContextChanged();
}

function onChatChanged() {
    if (!isExtensionEnabled || !settingsManager) return;
    settingsManager.onContextChanged();
}

async function onModelSettingsChanged() {
    if (!isExtensionEnabled || !settingsManager) {
        console.log('STMTL: Skipping save - extension not enabled');
        return;
    }

    const extensionSettings = storageAdapter.getExtensionSettings();
    const context = await settingsManager.chatContext.getCurrent();

    let shouldAutoSave = false;

    if (context.isGroupChat) {
        shouldAutoSave = extensionSettings.moduleSettings.autoSaveGroup ||
                        extensionSettings.moduleSettings.autoSaveChat;

        if (shouldAutoSave) {
            const targets = {
                character: extensionSettings.moduleSettings.autoSaveGroup,
                chat: extensionSettings.moduleSettings.autoSaveChat
            };
            await settingsManager.saveCurrentUISettings(targets, true);
        }
    } else {
        shouldAutoSave = extensionSettings.moduleSettings.autoSaveCharacter ||
                        extensionSettings.moduleSettings.autoSaveChat;

        if (shouldAutoSave) {
            const targets = {
                character: extensionSettings.moduleSettings.autoSaveCharacter,
                chat: extensionSettings.moduleSettings.autoSaveChat
            };
            await settingsManager.saveCurrentUISettings(targets, true);
        }
    }
}

// ===== POPUP MANAGEMENT =====

async function getPopupContent() {
    const extensionSettings = storageAdapter.getExtensionSettings();
    const apiInfo = getCurrentApiInfo();
    const context = await settingsManager.chatContext.getCurrent();

    const isGroupChat = context.isGroupChat;
    
    const statusText = isExtensionEnabled
        ? `Active (${apiInfo.completionSource})${isGroupChat ? ' - Group Chat' : ''}`
        : `Requires Chat Completion API (current: ${apiInfo.api})${isGroupChat ? ' - Group Chat' : ''}`;

    let checkboxes = [];
    
    if (isGroupChat) {
        checkboxes = [
            { id: 'stmtl-enable-character', label: 'Remember per group', checked: extensionSettings.moduleSettings.enableGroupMemory, requiresApi: true },
            { id: 'stmtl-enable-chat', label: 'Remember per chat', checked: extensionSettings.moduleSettings.enableChatMemory, requiresApi: true },
            { id: 'stmtl-prefer-group-over-chat', label: 'Prefer group settings over chat', checked: extensionSettings.moduleSettings.preferGroupOverChat, requiresApi: true },
            { id: 'stmtl-prefer-individual-character', label: 'Prefer individual character settings', checked: extensionSettings.moduleSettings.preferIndividualCharacterInGroup, requiresApi: true },
            { id: 'stmtl-auto-save-character', label: 'Auto-save group settings', checked: extensionSettings.moduleSettings.autoSaveGroup, requiresApi: true },
            { id: 'stmtl-auto-save-chat', label: 'Auto-save chat settings', checked: extensionSettings.moduleSettings.autoSaveChat, requiresApi: true },
            { id: 'stmtl-show-autosave-notifications', label: 'Show auto-save notifications', checked: extensionSettings.moduleSettings.showAutoSaveNotifications, requiresApi: false },
            { id: 'stmtl-show-other-notifications', label: 'Show other notifications', checked: extensionSettings.moduleSettings.showOtherNotifications, requiresApi: false }
        ];
    } else {
        checkboxes = [
            { id: 'stmtl-enable-character', label: 'Remember per character', checked: extensionSettings.moduleSettings.enableCharacterMemory, requiresApi: true },
            { id: 'stmtl-enable-chat', label: 'Remember per chat', checked: extensionSettings.moduleSettings.enableChatMemory, requiresApi: true },
            { id: 'stmtl-prefer-character', label: 'Prefer character settings over chat', checked: extensionSettings.moduleSettings.preferCharacterOverChat, requiresApi: true },
            { id: 'stmtl-auto-save-character', label: 'Auto-save character settings', checked: extensionSettings.moduleSettings.autoSaveCharacter, requiresApi: true },
            { id: 'stmtl-auto-save-chat', label: 'Auto-save chat settings', checked: extensionSettings.moduleSettings.autoSaveChat, requiresApi: true },
            { id: 'stmtl-show-autosave-notifications', label: 'Show auto-save notifications', checked: extensionSettings.moduleSettings.showAutoSaveNotifications, requiresApi: false },
            { id: 'stmtl-show-other-notifications', label: 'Show other notifications', checked: extensionSettings.moduleSettings.showOtherNotifications, requiresApi: false }
        ];
    }

    const templateData = {
        isExtensionEnabled,
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
        checkboxes
    };

    return DOMPurify.sanitize(popupTemplate(templateData));
}

async function refreshPopupContent() {
    if (!currentPopupInstance || !currentPopupInstance.dlg.hasAttribute('open')) {
        console.warn('STMTL: Cannot refresh popup - no popup currently open');
        return;
    }

    try {
        const content = await getPopupContent();
        const header = '🌡️ Model & Temperature Settings';
        const newContent = `<h3>${header}</h3>${content}`;

        const tempContainer = document.createElement('div');
        tempContainer.innerHTML = newContent;

        const contentElement = currentPopupInstance.dlg.querySelector('.dialogue-content');
        if (contentElement) {
            morphdom(contentElement, tempContainer);
        } else {
            // Fallback: close and reopen popup
            throw new Error('Content element not found');
        }

    } catch (error) {
        console.error('STMTL: Error refreshing popup content:', error);
        if (currentPopupInstance && typeof currentPopupInstance.completeCancelled === 'function') {
            currentPopupInstance.completeCancelled();
        }
        setTimeout(() => showPopup(), 100);
    }
}

async function showPopup() {
    // Prevent multiple popups from opening simultaneously
    if (currentPopupInstance && currentPopupInstance.dlg && currentPopupInstance.dlg.hasAttribute('open')) {
        console.log('STMTL: Popup already open, bringing to front');
        currentPopupInstance.dlg.focus();
        return;
    }

    const content = await getPopupContent();
    const header = '🌡️ Model & Temperature Settings';
    const contentWithHeader = `<h3>${header}</h3>${content}`;
    const context = await settingsManager.chatContext.getCurrent();
    const isGroupChat = context.isGroupChat;

    const customButtons = [];

    // For single character chats, show character and both buttons
    if (!isGroupChat) {
        customButtons.push(
            {
                text: '✔️ Set Character',
                classes: ['menu_button'],
                action: async () => {
                    const targets = { character: true, chat: false };
                    await settingsManager.saveCurrentUISettings(targets, false);
                    await refreshPopupContent();
                }
            },
            {
                text: '✔️ Set Both',
                classes: ['menu_button'],
                action: async () => {
                    const targets = { character: true, chat: true };
                    await settingsManager.saveCurrentUISettings(targets, false);
                    await refreshPopupContent();
                }
            }
        );
    } else {
        // For group chats, only show group and all buttons (no individual character button)
        customButtons.push(
            {
                text: '✔️ Set Group',
                classes: ['menu_button'],
                action: async () => {
                    const targets = { character: true, chat: false };
                    await settingsManager.saveCurrentUISettings(targets, false);
                    await refreshPopupContent();
                }
            },
            {
                text: '✔️ Set All',
                classes: ['menu_button'],
                action: async () => {
                    const targets = { character: true, chat: true };
                    await settingsManager.saveCurrentUISettings(targets, false);
                    await refreshPopupContent();
                }
            }
        );
    }

    // Chat button is common to both
    customButtons.push(
        {
            text: '✔️ Set Chat',
            classes: ['menu_button'],
            action: async () => {
                const targets = { character: false, chat: true };
                await settingsManager.saveCurrentUISettings(targets, false);
                await refreshPopupContent();
            }
        },
        {
            text: isGroupChat ? '❌ Clear Group' : '❌ Clear Character',
            classes: ['menu_button'],
            action: async () => {
                if (isGroupChat) {
                    if (context.groupId && storageAdapter.deleteGroupSettings(context.groupId)) {
                        settingsManager.currentSettings.group = null;
                        if (typeof toastr !== 'undefined') {
                            toastr.info('Group settings cleared', MODULE_NAME);
                        }
                    }
                } else {
                    if (context.characterName && storageAdapter.deleteCharacterSettings(context.characterName)) {
                        settingsManager.currentSettings.character = null;
                        if (typeof toastr !== 'undefined') {
                            toastr.info('Character settings cleared', MODULE_NAME);
                        }
                    }
                }
                await refreshPopupContent();
            }
        },
        {
            text: '❌ Clear Chat',
            classes: ['menu_button'],
            action: async () => {
                if (isGroupChat) {
                    if (storageAdapter.deleteGroupChatSettings(context.groupId)) {
                        settingsManager.currentSettings.chat = null;
                        if (typeof toastr !== 'undefined') {
                            toastr.info('Group chat settings cleared', MODULE_NAME);
                        }
                    }
                } else {
                    if (storageAdapter.deleteChatSettings()) {
                        settingsManager.currentSettings.chat = null;
                        if (typeof toastr !== 'undefined') {
                            toastr.info('Chat settings cleared', MODULE_NAME);
                        }
                    }
                }
                await refreshPopupContent();
            }
        },
        {
            text: '❌ Clear All',
            classes: ['menu_button'],
            action: async () => {
                await settingsManager.clearAllSettings();
                await refreshPopupContent();
            }
        }
    );


    const popupOptions = {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
        customButtons: customButtons,
        cancelButton: 'Close',
        okButton: false,
        onClose: handlePopupClose
    };

    try {
        currentPopupInstance = new Popup(contentWithHeader, POPUP_TYPE.TEXT, '', popupOptions);
        await currentPopupInstance.show();
        currentPopupInstance = null;
    } catch (error) {
        console.error('STMTL: Error showing popup:', error);
        currentPopupInstance = null;
    }
}

async function handlePopupClose(popup) {
    try {
        const popupElement = popup.dlg;
        const extensionSettings = storageAdapter.getExtensionSettings();
        const context = await settingsManager.chatContext.getCurrent();
        const isGroupChat = context.isGroupChat;

        let checkboxMappings = {};

        if (isGroupChat) {
            checkboxMappings = {
                'stmtl-enable-character': 'enableGroupMemory',
                'stmtl-enable-chat': 'enableChatMemory',
                'stmtl-prefer-group-over-chat': 'preferGroupOverChat',
                'stmtl-prefer-individual-character': 'preferIndividualCharacterInGroup',
                'stmtl-auto-save-character': 'autoSaveGroup',
                'stmtl-auto-save-chat': 'autoSaveChat',
                'stmtl-show-autosave-notifications': 'showAutoSaveNotifications',
                'stmtl-show-other-notifications': 'showOtherNotifications'
            };
        } else {
            checkboxMappings = {
                'stmtl-enable-character': 'enableCharacterMemory',
                'stmtl-enable-chat': 'enableChatMemory',
                'stmtl-prefer-character': 'preferCharacterOverChat',
                'stmtl-auto-save-character': 'autoSaveCharacter',
                'stmtl-auto-save-chat': 'autoSaveChat',
                'stmtl-show-autosave-notifications': 'showAutoSaveNotifications',
                'stmtl-show-other-notifications': 'showOtherNotifications'
            };
        }

        // Build newValues keyed by checkboxId
        const newValues = lodash.mapValues(checkboxMappings, (settingKey, checkboxId) => {
            const checkbox = popupElement.querySelector(`#${checkboxId}`);
            return checkbox ? checkbox.checked : extensionSettings.moduleSettings[settingKey];
        });

        // Map newValues keys to setting keys for a fair comparison
        const newValuesMapped = lodash.mapKeys(newValues, (value, checkboxId) => checkboxMappings[checkboxId]);

        // Compare to old values (also keyed by setting keys)
        const oldValues = lodash.pick(extensionSettings.moduleSettings, Object.values(checkboxMappings));
        const changed = !lodash.isEqual(oldValues, newValuesMapped);

        if (changed) {
            lodash.merge(extensionSettings.moduleSettings, newValuesMapped);
            storageAdapter.saveExtensionSettings();
        }
    } catch (error) {
        console.error('STMTL: Error handling popup close:', error);
    }
}

// ===== UI CREATION =====

function createUI() {
    const menuItem = $(`
        <div id="stmtl-menu-item-container" class="extension_container interactable" tabindex="0">
            <div id="stmtl-menu-item" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
                <div class="fa-fw fa-solid fa-temperature-half extensionsMenuExtensionButton"></div>
                <span>Model/Temp Settings</span>
            </div>
        </div>
    `);

    $('#extensionsMenu').append(menuItem);
}

function addPopupWrapStyle() {
    if (document.getElementById('stmtl-popup-fix')) return;

    const css = `
        .popup-controls {
            flex-wrap: wrap !important;
            justify-content: center !important;
        }
    `;
    const style = document.createElement('style');
    style.id = 'stmtl-popup-fix';
    style.textContent = css;
    document.head.appendChild(style);
}

// ===== EVENT SETUP =====

function setupEventListeners() {
    $(document).on('click', SELECTORS.menuItem, function() {
        showPopup();
    });

    // Register SillyTavern events
    function registerSillyTavernEvents() {
        if (eventListenersRegistered) {
            console.log('STMTL: Event listeners already registered, skipping');
            return;
        }

        try {
            if (!eventSource || !event_types) {
                console.warn('STMTL: eventSource or event_types not available, retrying...');
                setTimeout(registerSillyTavernEvents, 1000);
                return;
            }

            eventListenersRegistered = true;

            eventSource.on(event_types.CHARACTER_SELECTED, onCharacterChanged);
            eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
            eventSource.on(event_types.GROUP_CHAT_CREATED, () => {
                // Use the GROUP_UPDATED event instead of timeout for proper synchronization
                onCharacterChanged();
            });

            eventSource.on(event_types.GROUP_MEMBER_DRAFTED, (chId) => {
                try {
                    // Use window.characters for broader compatibility
                    const chars = (typeof characters !== 'undefined') ? characters : window.characters;

                    if (!chars || !Array.isArray(chars)) {
                        console.error('STMTL: Characters array not available or invalid');
                        return;
                    }

                    if (typeof chId !== 'number' || chId < 0 || chId >= chars.length) {
                        console.error('STMTL: Invalid character ID:', chId, 'characters length:', chars.length);
                        return;
                    }

                    const charObj = chars[chId];
                    if (!charObj) {
                        console.error('STMTL: Character object is null or undefined at index:', chId);
                        return;
                    }

                    console.log('STMTL: group_member_drafted:', {
                        chId,
                        draftedCharacter: charObj,
                        name: charObj.name,
                        avatar: charObj.avatar,
                    });

                    // Queue this character for context
                    if (charObj.name && typeof charObj.name === 'string') {
                        settingsManager.chatContext._queueActiveCharacter(charObj.name);
                        console.log('STMTL: Queued next active character:', charObj.name);
                    } else {
                        console.warn('STMTL: Character name is invalid:', charObj.name);
                    }
                } catch (error) {
                    console.error('STMTL: Error in GROUP_MEMBER_DRAFTED handler:', error);
                }

                // Always trigger context change, even if character lookup failed
                settingsManager.onContextChanged();
            });

            const setupAutoSaveEvent = (eventType, eventName) => {
                if (eventType) {
                    eventSource.on(eventType, async () => {
                        const extensionSettings = storageAdapter?.getExtensionSettings();
                        if (!extensionSettings) return;

                        const context = await settingsManager?.chatContext.getCurrent();
                        if (!context) return;

                        let isAutoSaveActive = false;
                        if (context.isGroupChat) {
                            isAutoSaveActive = extensionSettings.moduleSettings.autoSaveGroup || 
                                              extensionSettings.moduleSettings.autoSaveChat;
                        } else {
                            isAutoSaveActive = extensionSettings.moduleSettings.autoSaveCharacter || 
                                              extensionSettings.moduleSettings.autoSaveChat;
                        }

                        if (isAutoSaveActive) {
                            console.log(`STMTL: ${eventName} - Auto-save is active, preparing to save current settings.`);
                            // Don't re-apply stored settings during generation - only save current settings
                        }

                        if (isAutoSaveActive && isExtensionEnabled) {
                            console.log(`STMTL: ${eventName} - Checking for changes to auto-save.`);
                            // Note: debouncedModelSettingsChanged() calls onModelSettingsChanged() which is now async
                            // The debounce wrapper handles this automatically
                            debouncedModelSettingsChanged();
                        }
                    });
                }
            };

            setupAutoSaveEvent(event_types.GENERATION_STARTED, 'GENERATION_STARTED');
            setupAutoSaveEvent(event_types.CHAT_COMPLETION_PROMPT_READY, 'CHAT_COMPLETION_PROMPT_READY');

            // Listen for model changes directly instead of debouncing
            eventSource.on(event_types.CHATCOMPLETION_MODEL_CHANGED, async () => {
                if (!isApplyingSettings && isExtensionEnabled) {
                    console.log('STMTL: Model changed - triggering auto-save');
                    await onModelSettingsChanged();
                }
            });

            eventSource.on(event_types.MESSAGE_RECEIVED, async (message) => {
                if (message && !message.is_user) {
                    const speakerName = message.name;
                    const extensionSettings = storageAdapter?.getExtensionSettings();

                    if (extensionSettings?.moduleSettings.autoSaveCharacter && isExtensionEnabled) {
                        console.log(`STMTL: Auto-saving settings for speaker: ${speakerName}`);
                        await settingsManager?.saveCurrentSettingsForCharacter(speakerName, true);
                    }
                }
            });

            console.log('STMTL: Event listeners registered successfully');
        } catch (e) {
            console.warn('STMTL: Could not bind to SillyTavern events:', e);
            setTimeout(registerSillyTavernEvents, 2000);
        }
    }

    registerSillyTavernEvents();

    // API change detection
    $(document).on('change', `${SELECTORS.mainApi}, ${SELECTORS.completionSource}`, function(e) {
        console.log('STMTL: API change detected on:', e.target.id);
        checkApiCompatibility();

        // Don't trigger context change if we're currently applying settings (prevents feedback loop)
        if (isExtensionEnabled && !isApplyingSettings) {
            console.log('STMTL: API/completion source changed - checking if context refresh needed');
            setTimeout(() => {
                onCharacterChanged();
            }, 100);
        } else if (isApplyingSettings) {
            console.log('STMTL: Skipping context change - currently applying settings');
        }
    });

    // Model/temp/completion source settings change detection
    const allModelSelectors = Object.values(MODEL_SELECTOR_MAP).concat([
        SELECTORS.tempOpenai,
        SELECTORS.tempCounterOpenai,
        SELECTORS.completionSource
    ]).join(', ');

    $(document).on('change input', allModelSelectors, function(e) {
        console.log('STMTL: Model/temp/completion setting changed:', e.target.id);
        // Don't auto-save if we're currently applying settings (prevents feedback loop)
        if (!isApplyingSettings) {
            // Use immediate call instead of debounced for temperature changes
            // Model changes are handled by CHATCOMPLETION_MODEL_CHANGED event
            if (e.target.id === 'temp_openai' || e.target.id === 'temp_counter_openai') {
                debouncedModelSettingsChanged();
            }
        } else {
            console.log('STMTL: Skipping auto-save - currently applying settings');
        }
    });
}

// ===== MIGRATION =====

function migrateOldData() {
    const extensionSettings = storageAdapter.getExtensionSettings();

    if (extensionSettings.migrationVersion >= 6) {
        return;
    }
    
    console.log('STMTL: Starting data migration...');

    // Migrate notification settings
    if (extensionSettings.moduleSettings.hasOwnProperty('showNotifications')) {
        const oldNotificationSetting = extensionSettings.moduleSettings.showNotifications;
        extensionSettings.moduleSettings.showAutoSaveNotifications = oldNotificationSetting;
        extensionSettings.moduleSettings.showOtherNotifications = oldNotificationSetting;
        delete extensionSettings.moduleSettings.showNotifications;
        console.log('STMTL: Migrated legacy notification setting.');
    }

    // Migrate autosave settings
    if (extensionSettings.moduleSettings.hasOwnProperty('autoSave')) {
        const oldAutoSave = extensionSettings.moduleSettings.autoSave;
        
        if (!extensionSettings.moduleSettings.hasOwnProperty('autoSaveCharacter')) {
            extensionSettings.moduleSettings.autoSaveCharacter = oldAutoSave;
        }
        if (!extensionSettings.moduleSettings.hasOwnProperty('autoSaveChat')) {
            extensionSettings.moduleSettings.autoSaveChat = oldAutoSave;
        }
        
        delete extensionSettings.moduleSettings.autoSave;
        console.log('STMTL: Migrated autoSave setting to separate character/chat autosave');
    }

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
                    console.log(`STMTL: Unescaped character key "${characterKey}" to "${characterName}"`);
                } catch (e) {
                    console.warn(`STMTL: Could not unescape key "${characterKey}", using as-is`);
                }
            }

            newCharacterSettings[characterName] = settings;
            migratedCount++;
        }

        extensionSettings.characterSettings = newCharacterSettings;
        console.log(`STMTL: Migrated ${migratedCount} character settings`);
    }

    // Remove old chatSettings
    if (extensionSettings.chatSettings) {
        console.log('STMTL: Removing old chatSettings from extension settings');
        delete extensionSettings.chatSettings;
    }

    // Add missing group settings
    if (!extensionSettings.moduleSettings.hasOwnProperty('enableGroupMemory')) {
        extensionSettings.moduleSettings.enableGroupMemory = true;
    }
    if (!extensionSettings.moduleSettings.hasOwnProperty('preferGroupOverChat')) {
        extensionSettings.moduleSettings.preferGroupOverChat = true;
    }
    if (!extensionSettings.moduleSettings.hasOwnProperty('autoSaveGroup')) {
        extensionSettings.moduleSettings.autoSaveGroup = false;
    }
    if (!extensionSettings.moduleSettings.hasOwnProperty('preferIndividualCharacterInGroup')) {
        extensionSettings.moduleSettings.preferIndividualCharacterInGroup = false;
    }
    if (!extensionSettings.groupSettings) {
        extensionSettings.groupSettings = {};
    }

    extensionSettings.migrationVersion = 6;
    storageAdapter.saveExtensionSettings();

    console.log('STMTL: Data migration completed');
}

// ===== INITIALIZATION =====

let hasInitialized = false;

async function init() {
    if (hasInitialized) return;
    hasInitialized = true;
    
    console.log('STMTL: Initializing extension');

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

    // Initialize core components
    storageAdapter = new StorageAdapter();
    settingsManager = new SettingsManager(storageAdapter);

    // Run data migration
    migrateOldData();

    // Create UI
    createUI();

    // Set up event listeners
    setupEventListeners();

    // Check initial API compatibility
    checkApiCompatibility();

    // Initial context load - use SETTINGS_LOADED_AFTER event if available
    if (event_types.SETTINGS_LOADED_AFTER) {
        eventSource.on(event_types.SETTINGS_LOADED_AFTER, () => {
            if (settingsManager) {
                settingsManager.onContextChanged();
            }
            console.log('STMTL: Initial context loaded after settings');
        });
    } else {
        // Fallback for older versions
        setTimeout(() => {
            if (settingsManager) {
                settingsManager.onContextChanged();
            }
            console.log('STMTL: Initial context loaded (fallback)');
        }, 1000);
    }

    console.log('STMTL: extension loaded successfully');
}

// ===== BOOTSTRAP =====

$(document).ready(() => {
    if (eventSource && event_types && event_types.APP_READY) {
        eventSource.on(event_types.APP_READY, init);
        console.log('STMTL: Registered for APP_READY event');
    } else {
        console.warn('STMTL: APP_READY event not available, using fallback initialization');
        // Fallback initialization after a delay
        setTimeout(() => {
            if (!hasInitialized) {
                console.log('STMTL: Running fallback initialization');
                init();
            }
        }, 2000);
    }
});