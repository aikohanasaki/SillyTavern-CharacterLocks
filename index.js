import { eventSource, event_types, saveSettingsDebounced, chat_metadata, name2, systemUserName, neutralCharacterName, characters } from '../../../../script.js';
import { extension_settings, saveMetadataDebounced, getContext } from '../../../extensions.js';
import { Popup, POPUP_TYPE, POPUP_RESULT, callGenericPopup } from '../../../popup.js';
import { lodash, moment, Handlebars, DOMPurify, morphdom } from '../../../../lib.js';
import { selected_group, groups, editGroup } from '../../../group-chats.js';
import { getPresetManager } from '../../../preset-manager.js';
import { executeSlashCommandsWithOptions } from '../../../slash-commands.js';

// ===== CONSTANTS AND CONFIGURATION =====

const MODULE_NAME = 'STCL';
const CACHE_TTL = 1000;
const MAX_CONTEXT_QUEUE_SIZE = 20;
const DEBUG_MODE = false;

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

const AUTO_APPLY_MODES = {
    NEVER: 'never',
    ASK: 'ask',
    ALWAYS: 'always'
};

const SELECTORS = {
    menuItem: '#stcl-menu-item'
};


const DEFAULT_SETTINGS = {
    moduleSettings: {
        enableCharacterMemory: true,
        enableChatMemory: true,
        enableGroupMemory: true,
        preferCharacterOverChat: true,
        preferGroupOverChat: true,
        preferIndividualCharacterInGroup: false,
        showNotifications: true,
        autoApplyOnContextChange: AUTO_APPLY_MODES.ASK  // Default to ask
    },
    characterSettings: {},
    migrationVersion: 9
};

// ===== CORE CLASSES =====

/**
 * Centralized chat context detection and management
 */
class ChatContext {
    constructor() {
        this.cache = new Map();
        this.cacheTime = 0;
    }

    getCurrent() {
        const now = Date.now();
        if (now - this.cacheTime < CACHE_TTL && this.cache.has('current')) {
            return this.cache.get('current');
        }

        try {
            const context = this._buildContext();
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
            chatName: group?.name || null,
            characterName: group?.name || null,
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
            primaryId: characterName,
            secondaryId: chatId
        };
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
            if (DEBUG_MODE) console.warn('STCL: Error getting character name from chat metadata:', error);
            return null;
        }
    }

    _getCurrentChatId() {
        try {
            const context = getContext();
            return context?.chatId || null;
        } catch (error) {
            if (DEBUG_MODE) console.warn('STCL: Error getting chat ID:', error);
            return null;
        }
    }

    _getCurrentChatMetadata() {
        return chat_metadata;
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
    getCharacterSettings(characterKey) {
        if (characterKey === undefined || characterKey === null) {
            if (DEBUG_MODE) console.warn('STCL: Cannot get character settings - invalid key');
            return null;
        }

        const extensionSettings = this.getExtensionSettings();
        let settings = null;

        if (typeof characterKey === 'number') {
            // New system: Use chId as key
            const chIdKey = String(characterKey);
            settings = extensionSettings.characterSettings?.[chIdKey] || null;

            if (!settings && characters?.[characterKey]?.name) {
                // Fallback: Try to find by character name from old STCL/STMTL system
                const characterName = characters[characterKey].name;
                const nameKey = this._normalizeCharacterName(characterName);
                settings = extensionSettings.characterSettings?.[nameKey] || null;

                if (DEBUG_MODE && settings) {
                    console.log(`STCL: Found legacy name-based settings for chId ${characterKey}, character: ${characterName}`);
                }
            }

            if (DEBUG_MODE) {
                if (settings) {
                    console.log(`STCL: Retrieved character settings for chId "${chIdKey}"`);
                } else {
                    console.log(`STCL: No settings found for chId "${chIdKey}"`);
                }
            }
        } else {
            // Backward compatibility: character name lookup (for old STCL/STMTL)
            const nameKey = this._normalizeCharacterName(characterKey);
            settings = extensionSettings.characterSettings?.[nameKey] || null;

            if (DEBUG_MODE) {
                if (settings) {
                    console.log(`STCL: Retrieved legacy character settings for name "${nameKey}"`);
                } else {
                    console.log(`STCL: No legacy settings found for name "${nameKey}"`);
                }
            }
        }

        return settings;
    }

    setCharacterSettings(characterKey, settings) {
        if (characterKey === undefined || characterKey === null) {
            if (DEBUG_MODE) console.warn('STCL: Cannot save character settings - invalid key');
            return false;
        }

        const extensionSettings = this.getExtensionSettings();

        if (!extensionSettings.characterSettings) {
            extensionSettings.characterSettings = {};
        }

        // Always save with chId going forward
        let saveKey;
        if (typeof characterKey === 'number') {
            // New system: Use chId as key
            saveKey = String(characterKey);
        } else {
            // Backward compatibility: still allow saving by name (for migration/old code)
            saveKey = this._normalizeCharacterName(characterKey);
            if (DEBUG_MODE) console.log('STCL: Warning - saving by character name instead of chId');
        }

        extensionSettings.characterSettings[saveKey] = settings;

        if (DEBUG_MODE) console.log('STCL: Settings saved for key:', saveKey);

        this.saveExtensionSettings();
        return true;
    }

    deleteCharacterSettings(characterKey) {
        if (characterKey === undefined || characterKey === null) {
            if (DEBUG_MODE) console.warn('STCL: Cannot delete character settings - invalid key');
            return false;
        }

        const extensionSettings = this.getExtensionSettings();
        let deleted = false;

        if (typeof characterKey === 'number') {
            // Delete chId-based settings
            const chIdKey = String(characterKey);
            if (extensionSettings.characterSettings?.[chIdKey]) {
                delete extensionSettings.characterSettings[chIdKey];
                deleted = true;
                if (DEBUG_MODE) console.log(`STCL: Deleted chId-based character settings for "${chIdKey}"`);
            }

            // Also delete any legacy name-based settings for this character
            if (characters?.[characterKey]?.name) {
                const characterName = characters[characterKey].name;
                const nameKey = this._normalizeCharacterName(characterName);
                if (extensionSettings.characterSettings?.[nameKey]) {
                    delete extensionSettings.characterSettings[nameKey];
                    deleted = true;
                    if (DEBUG_MODE) console.log(`STCL: Also deleted legacy name-based settings for "${nameKey}"`);
                }
            }
        } else {
            // Delete name-based settings (backward compatibility)
            const nameKey = this._normalizeCharacterName(characterKey);
            if (extensionSettings.characterSettings?.[nameKey]) {
                delete extensionSettings.characterSettings[nameKey];
                deleted = true;
                if (DEBUG_MODE) console.log(`STCL: Deleted legacy character settings for name "${nameKey}"`);
            }
        }

        if (deleted) {
            this.saveExtensionSettings();
        } else {
            if (DEBUG_MODE) console.log(`STCL: No settings to delete for key "${characterKey}"`);
        }

        return deleted;
    }

    // Group settings (stored directly on group object)
    getGroupSettings(groupId) {
        if (!groupId) {
            if (DEBUG_MODE) console.warn('STCL: Cannot get group settings - invalid ID');
            return null;
        }

        try {
            const group = groups?.find(x => x.id === groupId);
            const settings = group?.stcl_settings || null;

            if (DEBUG_MODE) {
                if (settings) {
                    console.log(`STCL: Retrieved group settings for group ID "${groupId}"`);
                } else {
                    console.log(`STCL: No group settings found for group ID "${groupId}"`);
                }
            }

            return settings;
        } catch (error) {
            console.warn('STCL: Error getting group settings:', error);
            return null;
        }
    }

    async setGroupSettings(groupId, settings) {
        if (!groupId) {
            if (DEBUG_MODE) console.warn('STCL: Cannot save group settings - invalid ID');
            return false;
        }

        try {
            const group = groups?.find(x => x.id === groupId);
            if (!group) {
                console.warn('STCL: Cannot save group settings - group not found');
                return false;
            }

            group.stcl_settings = settings;
            if (DEBUG_MODE) console.log(`STCL: Saved group settings for group ID "${groupId}"`);

            // Save the group using ST's editGroup function
            try {
                await editGroup(groupId, false, false);
                return true;
            } catch (error) {
                console.warn('STCL: Error calling editGroup:', error);
                return false;
            }
        } catch (error) {
            console.error('STCL: Error saving group settings:', error);
            return false;
        }
    }

    async deleteGroupSettings(groupId) {
        if (!groupId) {
            if (DEBUG_MODE) console.warn('STCL: Cannot delete group settings - invalid ID');
            return false;
        }

        try {
            const group = groups?.find(x => x.id === groupId);
            if (group?.stcl_settings) {
                delete group.stcl_settings;
                if (DEBUG_MODE) console.log(`STCL: Deleted group settings for group ID "${groupId}"`);

                try {
                    await editGroup(groupId, false, false);
                    return true;
                } catch (error) {
                    console.warn('STCL: Error calling editGroup after delete:', error);
                    return false;
                }
            }

            if (DEBUG_MODE) console.log(`STCL: No group settings to delete for group ID "${groupId}"`);
            return false;
        } catch (error) {
            console.error('STCL: Error deleting group settings:', error);
            return false;
        }
    }

    // Chat settings
    getChatSettings() {
        try {
            const metadata = this._getCurrentChatMetadata();
            const settings = metadata?.[this.EXTENSION_KEY] || null;

            if (DEBUG_MODE) {
                if (settings) {
                    console.log('STCL: Retrieved chat settings:', settings);
                } else {
                    console.log('STCL: No chat settings found');
                }
            }

            return settings;
        } catch (error) {
            console.warn('STCL: Error getting chat settings:', error);
            return null;
        }
    }

    setChatSettings(settings) {
        try {
            const metadata = this._getCurrentChatMetadata();
            if (!metadata) {
                console.warn('STCL: Cannot save chat settings - no chat metadata available');
                return false;
            }

            metadata[this.EXTENSION_KEY] = settings;
            if (DEBUG_MODE) console.log('STCL: Saved chat settings:', settings);

            this._triggerMetadataSave();
            return true;
        } catch (error) {
            console.error('STCL: Error saving chat settings:', error);
            return false;
        }
    }

    deleteChatSettings() {
        try {
            const metadata = this._getCurrentChatMetadata();
            if (metadata?.[this.EXTENSION_KEY]) {
                delete metadata[this.EXTENSION_KEY];
                if (DEBUG_MODE) console.log('STCL: Deleted chat settings');
                this._triggerMetadataSave();
                return true;
            }

            if (DEBUG_MODE) console.log('STCL: No chat settings to delete');
            return false;
        } catch (error) {
            console.error('STCL: Error deleting chat settings:', error);
            return false;
        }
    }

    // Group chat settings
    getGroupChatSettings(groupId) {
        if (!groupId) {
            if (DEBUG_MODE) console.warn('STCL: Cannot get group chat settings - invalid group ID');
            return null;
        }

        try {
            // For group chats, read from the global chat_metadata instead of group.chat_metadata
            const settings = (typeof chat_metadata !== 'undefined') ? chat_metadata[this.EXTENSION_KEY] || null : null;

            if (DEBUG_MODE) {
                if (settings) {
                    console.log('STCL: Retrieved group chat settings:', settings);
                } else {
                    console.log('STCL: No group chat settings found');
                }
            }

            return settings;
        } catch (error) {
            console.warn('STCL: Error getting group chat settings:', error);
            return null;
        }
    }

    async setGroupChatSettings(groupId, settings) {
        if (!groupId) {
            if (DEBUG_MODE) console.warn('STCL: Cannot save group chat settings - invalid group ID');
            return false;
        }

        try {
            // For group chats, save to the global chat_metadata instead of group.chat_metadata
            // The global chat_metadata gets automatically persisted by SillyTavern
            if (typeof chat_metadata !== 'undefined') {
                chat_metadata[this.EXTENSION_KEY] = settings;
                if (DEBUG_MODE) console.log('STCL: Saved group chat settings to chat_metadata:', settings);
                return true;
            } else {
                if (DEBUG_MODE) console.warn('STCL: chat_metadata not available');
                return false;
            }
        } catch (error) {
            console.error('STCL: Error saving group chat settings:', error);
            return false;
        }
    }

    async deleteGroupChatSettings(groupId) {
        if (!groupId) {
            if (DEBUG_MODE) console.warn('STCL: Cannot delete group chat settings - invalid group ID');
            return false;
        }

        try {
            // For group chats, delete from the global chat_metadata instead of group.chat_metadata
            if (typeof chat_metadata !== 'undefined' && chat_metadata[this.EXTENSION_KEY]) {
                delete chat_metadata[this.EXTENSION_KEY];
                if (DEBUG_MODE) console.log('STCL: Deleted group chat settings from chat_metadata');
                return true;
            }

            if (DEBUG_MODE) console.log('STCL: No group chat settings to delete');
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

    _getCurrentChatMetadata() {
        return chat_metadata;
    }

    _triggerMetadataSave() {
        try {
            saveMetadataDebounced();
        } catch (error) {
            console.error('STCL: Error triggering metadata save:', error);
        }
    }

    // ===== OLD STMTL SETTINGS DETECTION =====

    hasOldCharacterSettings(characterName) {
        if (!characterName) return false;
        try {
            const normalizedName = this._normalizeCharacterName(characterName);
            return !!extension_settings.STMTL?.characterSettings?.[normalizedName];
        } catch (error) {
            if (DEBUG_MODE) console.warn('STCL: Error checking old character settings:', error);
            return false;
        }
    }

    hasOldChatSettings() {
        try {
            const metadata = this._getCurrentChatMetadata();
            return !!metadata?.STMTL;
        } catch (error) {
            if (DEBUG_MODE) console.warn('STCL: Error checking old chat settings:', error);
            return false;
        }
    }

    hasOldGroupSettings(groupId) {
        if (!groupId) return false;
        try {
            const group = groups?.find(x => x.id === groupId);
            return !!group?.stmtl_settings || !!extension_settings.STMTL?.groupSettings?.[groupId];
        } catch (error) {
            if (DEBUG_MODE) console.warn('STCL: Error checking old group settings:', error);
            return false;
        }
    }

    hasOldGroupChatSettings(groupId) {
        if (!groupId) return false;
        try {
            const group = groups?.find(x => x.id === groupId);
            return !!group?.chat_metadata?.STMTL;
        } catch (error) {
            if (DEBUG_MODE) console.warn('STCL: Error checking old group chat settings:', error);
            return false;
        }
    }

    getOldCharacterSettings(characterName) {
        if (!characterName) return null;
        try {
            const normalizedName = this._normalizeCharacterName(characterName);
            return extension_settings.STMTL?.characterSettings?.[normalizedName] || null;
        } catch (error) {
            if (DEBUG_MODE) console.warn('STCL: Error getting old character settings:', error);
            return null;
        }
    }

    getOldChatSettings() {
        try {
            const metadata = this._getCurrentChatMetadata();
            return metadata?.STMTL || null;
        } catch (error) {
            if (DEBUG_MODE) console.warn('STCL: Error getting old chat settings:', error);
            return null;
        }
    }

    getOldGroupSettings(groupId) {
        if (!groupId) return null;
        try {
            const group = groups?.find(x => x.id === groupId);
            return group?.stmtl_settings || extension_settings.STMTL?.groupSettings?.[groupId] || null;
        } catch (error) {
            if (DEBUG_MODE) console.warn('STCL: Error getting old group settings:', error);
            return null;
        }
    }

    getOldGroupChatSettings(groupId) {
        if (!groupId) return null;
        try {
            const group = groups?.find(x => x.id === groupId);
            return group?.chat_metadata?.STMTL || null;
        } catch (error) {
            if (DEBUG_MODE) console.warn('STCL: Error getting old group chat settings:', error);
            return null;
        }
    }

    // ===== OLD STMTL SETTINGS CLEANUP =====

    deleteOldCharacterSettings(characterName) {
        if (!characterName) return false;
        try {
            const normalizedName = this._normalizeCharacterName(characterName);
            if (extension_settings.STMTL?.characterSettings?.[normalizedName]) {
                delete extension_settings.STMTL.characterSettings[normalizedName];
                if (DEBUG_MODE) console.log(`STCL: Removed old STMTL character settings for "${normalizedName}"`);
                this.saveExtensionSettings();
                return true;
            }
            return false;
        } catch (error) {
            console.error('STCL: Error deleting old character settings:', error);
            return false;
        }
    }

    deleteOldChatSettings() {
        try {
            const metadata = this._getCurrentChatMetadata();
            if (metadata?.STMTL) {
                delete metadata.STMTL;
                if (DEBUG_MODE) console.log('STCL: Removed old STMTL chat settings');
                this._triggerMetadataSave();
                return true;
            }
            return false;
        } catch (error) {
            console.error('STCL: Error deleting old chat settings:', error);
            return false;
        }
    }

    async deleteOldGroupSettings(groupId) {
        if (!groupId) return false;
        try {
            let deleted = false;

            // Delete from group object
            const group = groups?.find(x => x.id === groupId);
            if (group?.stmtl_settings) {
                delete group.stmtl_settings;
                deleted = true;
                try {
                    await editGroup(groupId, false, false);
                } catch (error) {
                    console.warn('STCL: Error saving group after STMTL cleanup:', error);
                }
            }

            // Delete from extension settings
            if (extension_settings.STMTL?.groupSettings?.[groupId]) {
                delete extension_settings.STMTL.groupSettings[groupId];
                deleted = true;
                this.saveExtensionSettings();
            }

            if (deleted && DEBUG_MODE) {
                console.log(`STCL: Removed old STMTL group settings for group "${groupId}"`);
            }
            return deleted;
        } catch (error) {
            console.error('STCL: Error deleting old group settings:', error);
            return false;
        }
    }

    async deleteOldGroupChatSettings(groupId) {
        if (!groupId) return false;
        try {
            const group = groups?.find(x => x.id === groupId);
            if (group?.chat_metadata?.STMTL) {
                delete group.chat_metadata.STMTL;
                if (DEBUG_MODE) console.log(`STCL: Removed old STMTL group chat settings for group "${groupId}"`);
                try {
                    await editGroup(groupId, false, false);
                    return true;
                } catch (error) {
                    console.warn('STCL: Error saving group after STMTL cleanup:', error);
                    return false;
                }
            }
            return false;
        } catch (error) {
            console.error('STCL: Error deleting old group chat settings:', error);
            return false;
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
        const context = this.chatContext.getCurrent();
        if (DEBUG_MODE) console.log('STCL: Loading settings for context:', context);

        this.currentSettings = this._getEmptySettings();

        if (context.isGroupChat) {
            this._loadGroupSettings(context);
        } else {
            this._loadSingleSettings(context);
        }

        if (DEBUG_MODE) console.log('STCL: Loaded settings:', this.currentSettings);
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
                    // Find character index (chId) for this member
                    const chId = characters?.findIndex(x => x.avatar === memberAvatar);
                    if (chId !== -1 && characters[chId]?.name) {
                        const memberSettings = this.storage.getCharacterSettings(chId);
                        this.currentSettings.groupMembers.push({
                            name: characters[chId].name,
                            avatar: memberAvatar,
                            chId: chId,
                            settings: memberSettings
                        });
                    }
                }
            }
        }

        // Individual character settings are no longer loaded here - they are applied on-demand during GROUP_MEMBER_DRAFTED
    }

    _loadSingleSettings(context) {
        const prefs = this.storage.getExtensionSettings().moduleSettings;

        if (prefs.enableCharacterMemory && context.characterName) {
            // Try to find chId for this character
            const chId = characters?.findIndex(x => x.name === context.characterName);
            if (chId !== -1) {
                // Use chId as key
                this.currentSettings.character = this.storage.getCharacterSettings(chId);
            } else {
                // Fallback to character name for backward compatibility
                this.currentSettings.character = this.storage.getCharacterSettings(context.characterName);
            }
        }

        if (prefs.enableChatMemory && context.chatId) {
            this.currentSettings.chat = this.storage.getChatSettings();
        }
    }

    async getSettingsToApply() {
        const context = this.chatContext.getCurrent();
        this.priorityResolver = new SettingsPriorityResolver(this.storage.getExtensionSettings());
        return this.priorityResolver.resolve(context, this.currentSettings);
    }

    onContextChanged() {
        // Add to queue and process asynchronously to prevent race conditions
        const timestamp = Date.now();

        // Add bounds checking to prevent memory issues
        if (contextChangeQueue.length >= MAX_CONTEXT_QUEUE_SIZE) {
            const removed = contextChangeQueue.shift(); // Remove oldest
            if (DEBUG_MODE) console.warn('STCL: Context change queue full, removed oldest:', new Date(removed).toISOString());
        }

        contextChangeQueue.push(timestamp);
        if (DEBUG_MODE) console.log('STCL: Context change queued', `(queue size: ${contextChangeQueue.length})`);
        this._processContextChangeQueue();
    }

    async _processContextChangeQueue() {
        if (processingContext) {
            if (DEBUG_MODE) console.log('STCL: Context change already in progress, queued');
            return;
        }

        if (contextChangeQueue.length === 0) {
            return;
        }

        processingContext = true;
        try {
            // Process the latest context change (discard duplicates)
            const latestTimestamp = contextChangeQueue[contextChangeQueue.length - 1];
            const queueSize = contextChangeQueue.length;
            contextChangeQueue.length = 0;

            if (DEBUG_MODE) console.log(`STCL: Processing context change (processed ${queueSize} queued items)`);
            this.chatContext.invalidate();
            await this.loadCurrentSettings();

            // Check for old STMTL settings and show migration popup if needed
            await checkAndShowMigrationPopup();

            // Only apply settings automatically if enabled by user
            const shouldApplySettings = await this._shouldApplySettingsAutomatically();
            if (DEBUG_MODE) console.log('STCL: shouldApplySettings:', shouldApplySettings, 'isApplyingSettings:', isApplyingSettings);
            if (shouldApplySettings && !isApplyingSettings) {
                if (DEBUG_MODE) console.log('STCL: Applying settings automatically on context change');
                await this.applySettings();
            } else {
                if (DEBUG_MODE) console.log('STCL: Skipping automatic settings application - auto-apply disabled or currently applying');
            }
        } catch (error) {
            console.error('STCL: Error processing context change queue:', error);
        } finally {
            processingContext = false;

            // Schedule processing of any additional changes that came in while we were processing
            if (contextChangeQueue.length > 0) {
                // Use debounced approach instead of immediate setTimeout
                this._scheduleQueueProcessing();
            }
        }
    }

    _scheduleQueueProcessing() {
        // Cancel any existing scheduled processing
        if (this._queueProcessingTimeout) {
            clearTimeout(this._queueProcessingTimeout);
        }

        // Schedule new processing with debounce
        this._queueProcessingTimeout = setTimeout(() => {
            this._queueProcessingTimeout = null;
            this._processContextChangeQueue();
        }, 100); // 100ms debounce
    }

    async applySettings() {
        if (isApplyingSettings) {
            if (DEBUG_MODE) console.log('STCL: Already applying settings, skipping');
            return false;
        }

        try {
            isApplyingSettings = true;
            const resolved = await this.getSettingsToApply();

            if (!resolved.settings) {
                if (DEBUG_MODE) console.log('STCL: No settings to apply');
                return false;
            }

            if (DEBUG_MODE) console.log(`STCL: Applying ${resolved.source} settings:`, resolved.settings);
            const result = await this._applySettingsToUI(resolved.settings);
            if (DEBUG_MODE) console.log('STCL: Settings application result:', result);
            return result;
        } finally {
            isApplyingSettings = false;
        }
    }

    async _applySettingsToUI(settings) {
        if (DEBUG_MODE) console.log('STCL: _applySettingsToUI called with:', settings);

        // Apply preset first if available
        if (settings.preset) {
            const presetManager = getPresetManager();
            if (presetManager) {
                const currentPreset = presetManager.getSelectedPresetName();
                if (currentPreset !== settings.preset) {
                    const presetValue = presetManager.findPreset(settings.preset);
                    if (presetValue !== undefined && presetValue !== null) {
                        if (DEBUG_MODE) console.log(`STCL: Applying saved preset: ${settings.preset}`);
                        presetManager.selectPreset(presetValue);
                    } else {
                        console.warn(`STCL: Saved preset "${settings.preset}" not found`);
                    }
                }
            }
        }

        // Apply the connection profile (which handles completion source automatically)
        return await this._applyConnectionProfile(settings);
    }

    async _applyConnectionProfile(settings) {
        // Apply connection profile setting
        if (settings.connectionProfile) {
            try {
                if (DEBUG_MODE) console.log(`STCL: Applying saved connection profile: ${settings.connectionProfile}`);
                // Use ST's executeSlashCommandsWithOptions to apply the connection profile
                await executeSlashCommandsWithOptions(`/profile ${settings.connectionProfile}`);
            } catch (error) {
                console.warn(`STCL: Failed to apply connection profile "${settings.connectionProfile}":`, error);
                return false;
            }
        }

        return true;
    }

    async saveCurrentUISettings(targets = {}) {
        const context = this.chatContext.getCurrent();
        const uiSettings = this._getCurrentUISettings();
        
        let savedCount = 0;
        const savedTypes = [];

        if (context.isGroupChat) {
            if (targets.character && context.groupId) {
                if (await this.storage.setGroupSettings(context.groupId, uiSettings)) {
                    this.currentSettings.group = lodash.cloneDeep(uiSettings);
                    savedCount++;
                    savedTypes.push(SETTING_SOURCES.GROUP);
                }
            }
            if (targets.chat && context.groupId) {
                if (await this.storage.setGroupChatSettings(context.groupId, uiSettings)) {
                    this.currentSettings.chat = lodash.cloneDeep(uiSettings);
                    savedCount++;
                    savedTypes.push(SETTING_SOURCES.GROUP_CHAT);
                }
            }
        } else {
            if (targets.character && context.characterName) {
                // Try to find chId for this character
                const chId = characters?.findIndex(x => x.name === context.characterName);
                const characterKey = chId !== -1 ? chId : context.characterName;

                if (this.storage.setCharacterSettings(characterKey, uiSettings)) {
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

        // Clean up old STMTL settings for what was just saved
        await this._cleanupOldSTMTLSettings(context, targets, savedTypes);

        this._showSaveNotification(savedCount, savedTypes);
        return savedCount > 0;
    }

    async _cleanupOldSTMTLSettings(context, targets, savedTypes) {
        try {
            if (context.isGroupChat) {
                // Group chat context
                if (targets.character && savedTypes.includes(SETTING_SOURCES.GROUP)) {
                    await this.storage.deleteOldGroupSettings(context.groupId);
                }
                if (targets.chat && savedTypes.includes(SETTING_SOURCES.GROUP_CHAT)) {
                    await this.storage.deleteOldGroupChatSettings(context.groupId);
                }
            } else {
                // Single chat context
                if (targets.character && savedTypes.includes(SETTING_SOURCES.CHARACTER)) {
                    // deleteOldCharacterSettings always needs character name, not chId
                    this.storage.deleteOldCharacterSettings(context.characterName);
                }
                if (targets.chat && savedTypes.includes(SETTING_SOURCES.CHAT)) {
                    this.storage.deleteOldChatSettings();
                }
            }
        } catch (error) {
            console.error('STCL: Error cleaning up old STMTL settings:', error);
        }
    }


    async clearAllSettings() {
        const context = this.chatContext.getCurrent();
        let clearedCount = 0;
        const clearedTypes = [];

        if (context.isGroupChat) {
            if (context.groupId && await this.storage.deleteGroupSettings(context.groupId)) {
                this.currentSettings.group = null;
                clearedCount++;
                clearedTypes.push(SETTING_SOURCES.GROUP);
            }
            if (context.chatId && await this.storage.deleteGroupChatSettings(context.groupId)) {
                this.currentSettings.chat = null;
                clearedCount++;
                clearedTypes.push(SETTING_SOURCES.GROUP_CHAT);
            }
        } else {
            if (context.characterName) {
                // Use chId if available, fall back to character name
                const chId = characters?.findIndex(x => x.name === context.characterName);
                const characterKey = chId !== -1 ? chId : context.characterName;

                if (this.storage.deleteCharacterSettings(characterKey)) {
                    this.currentSettings.character = null;
                    clearedCount++;
                    clearedTypes.push(SETTING_SOURCES.CHARACTER);
                }
            }
            if (context.chatId && this.storage.deleteChatSettings()) {
                this.currentSettings.chat = null;
                clearedCount++;
                clearedTypes.push(SETTING_SOURCES.CHAT);
            }
        }

        // Note: Individual clear buttons handle their own STMTL cleanup

        if (clearedCount > 0) {
            const typeText = clearedTypes.join(' & ');
            this._showToastr(`${typeText} settings cleared`, 'info');
        }

        return clearedCount;
    }

    _getCurrentUISettings() {
        try {
            // Get current preset name
            const presetManager = getPresetManager();
            const currentPreset = presetManager ? presetManager.getSelectedPresetName() : '';

            // Get current connection profile
            const selectedProfileId = extension_settings.connectionManager.selectedProfile;
            const currentProfile = selectedProfileId ?
                extension_settings.connectionManager.profiles.find(p => p.id === selectedProfileId)?.name || '' : '';

            return {
                connectionProfile: currentProfile,
                preset: currentPreset,
                savedAt: moment().toISOString()
            };
        } catch (error) {
            console.error('STCL: Error getting current UI settings:', error);
            // Return safe defaults
            return {
                connectionProfile: '',
                preset: '',
                savedAt: moment().toISOString()
            };
        }
    }

    _showSaveNotification(savedCount, savedTypes) {
        if (savedCount === 0) return;

        const extensionSettings = this.storage.getExtensionSettings();
        if (extensionSettings.moduleSettings.showNotifications) {
            const typeText = savedTypes.join(' & ');
            this._showToastr(`Saved ${typeText} settings`, 'success');
        }
    }

    _showToastr(message, type) {
        if (typeof toastr !== 'undefined') {
            toastr[type](message, MODULE_NAME);
        } else {
            console.log(`STCL: ${message}`);
        }
    }

    async _shouldApplySettingsAutomatically() {
        const extensionSettings = this.storage.getExtensionSettings();
        const context = this.chatContext.getCurrent();
        const autoApplyMode = extensionSettings.moduleSettings.autoApplyOnContextChange;

        // Check if we have any memory enabled first
        const hasMemoryEnabled = context.isGroupChat ?
            (extensionSettings.moduleSettings.enableGroupMemory || extensionSettings.moduleSettings.enableChatMemory) :
            (extensionSettings.moduleSettings.enableCharacterMemory || extensionSettings.moduleSettings.enableChatMemory);

        if (!hasMemoryEnabled) {
            return false;
        }

        // Check if current settings already match saved settings
        const resolved = await this.getSettingsToApply();
        if (!resolved || !resolved.settings) {
            if (DEBUG_MODE) console.log('STCL: No saved settings to apply, skipping auto-apply');
            return false;
        }

        // Compare current UI settings with saved settings
        const currentUISettings = this._getCurrentUISettings();
        const settingsMatch = this._compareSettings(currentUISettings, resolved.settings);

        if (settingsMatch) {
            return false;
        }

        // Handle different auto-apply modes
        switch (autoApplyMode) {
            case AUTO_APPLY_MODES.NEVER:
                return false;

            case AUTO_APPLY_MODES.ALWAYS:
                return true;

            case AUTO_APPLY_MODES.ASK:
                return await this._askUserToApplySettings(context);

            default:
                return false;
        }
    }

    _compareSettings(current, saved) {
        try {
            // Compare connection profiles
            if (current.connectionProfile !== saved.connectionProfile) {
                return false;
            }

            // Compare presets
            if (current.preset !== saved.preset) {
                return false;
            }

            return true;
        } catch (error) {
            return false; // If we can't compare, assume they don't match
        }
    }

    async _askUserToApplySettings(context) {
        try {
            // Get the settings that would be applied
            const resolved = await this.getSettingsToApply();

            if (!resolved.settings) {
                return false; // No settings to apply
            }

            const contextType = context.isGroupChat ? 'group chat' : 'character';
            const sourceName = context.isGroupChat ?
                (context.groupName || 'Unnamed Group') :
                (context.characterName || 'Unknown Character');

            const message = `Apply saved ${resolved.source} settings for ${contextType} "${sourceName}"?`;

            // Use SillyTavern's popup system
            const result = await callGenericPopup(message, POPUP_TYPE.CONFIRM, '', { okButton: 'Apply', cancelButton: 'Skip' });

            return result === POPUP_RESULT.AFFIRMATIVE;
        } catch (error) {
            console.error('STCL: Error asking user to apply settings:', error);
            return false;
        }
    }
}


// ===== GLOBAL STATE =====

let settingsManager = null;
let storageAdapter = null;
let currentPopupInstance = null;
let isApplyingSettings = false;
let eventListenersRegistered = false;
let contextChangeQueue = [];
let processingContext = false;
let processingCharacter = false;
let registeredEventHandlers = [];

// ===== UTILITY FUNCTIONS =====

function registerEventHandler(eventType, handler, description = '') {
    try {
        eventSource.on(eventType, handler);
        registeredEventHandlers.push({ eventType, handler, description });
        if (DEBUG_MODE) console.log(`STCL: Registered event handler for ${eventType}${description ? ': ' + description : ''}`);
        return true;
    } catch (error) {
        console.error(`STCL: Failed to register event handler for ${eventType}:`, error);
        return false;
    }
}

function unregisterAllEventHandlers() {
    if (eventSource && registeredEventHandlers.length > 0) {
        if (DEBUG_MODE) console.log(`STCL: Unregistering ${registeredEventHandlers.length} event handlers`);
        registeredEventHandlers.forEach(({ eventType, handler, description }) => {
            try {
                eventSource.removeListener(eventType, handler);
                if (DEBUG_MODE) console.log(`STCL: Unregistered ${eventType}${description ? ': ' + description : ''}`);
            } catch (error) {
                console.warn(`STCL: Error unregistering ${eventType}:`, error);
            }
        });
        registeredEventHandlers = [];
    }
}

function cleanupExtension() {
    if (DEBUG_MODE) console.log('STCL: Cleaning up extension resources');

    // Clear queues
    contextChangeQueue.length = 0;

    // Reset flags
    processingContext = false;
    processingCharacter = false;
    isApplyingSettings = false;

    // Clear cache
    if (settingsManager?.chatContext) {
        settingsManager.chatContext.invalidate();
    }

    if (settingsManager?._queueProcessingTimeout) {
        clearTimeout(settingsManager._queueProcessingTimeout);
        settingsManager._queueProcessingTimeout = null;
    }

    // Unregister events
    unregisterAllEventHandlers();
    eventListenersRegistered = false;

    // Close popup if open
    if (currentPopupInstance && typeof currentPopupInstance.completeCancelled === 'function') {
        currentPopupInstance.completeCancelled();
        currentPopupInstance = null;
    }

    if (DEBUG_MODE) console.log('STCL: Cleanup completed');
}




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
            if (DEBUG_MODE) console.warn('STCL: Error formatting date:', dateError);
            saved = 'Unknown';
        }
    }

    // Validate and sanitize values
    const connectionProfile = (settings.connectionProfile && typeof settings.connectionProfile === 'string') ? settings.connectionProfile.trim() || 'N/A' : 'N/A';
    const preset = (settings.preset && typeof settings.preset === 'string') ? settings.preset.trim() || 'N/A' : 'N/A';

    return `Profile: ${connectionProfile}
Preset: ${preset}
Saved: ${saved}`;
}

// ===== TEMPLATE AND UI =====

const popupTemplate = Handlebars.compile(`
<div class="completion_prompt_manager_popup_entry">
    <div class="completion_prompt_manager_error {{#unless isExtensionEnabled}}caution{{/unless}} marginBot10">
        <span>API Status: <strong>{{statusText}}</strong></span>
    </div>

    <div class="completion_prompt_manager_popup_entry_form_control flex-container flexFlowColumn justifyCenter" style="text-align: center;">
        {{#each checkboxes}}
        <label class="checkbox_label">
            <input type="checkbox" id="{{id}}" {{#if checked}}checked{{/if}} {{#unless ../isExtensionEnabled}}{{#if requiresApi}}disabled{{/if}}{{/unless}}>
            <span>{{label}}</span>
        </label>
        {{/each}}
    </div>

    <div class="completion_prompt_manager_popup_entry_form_control flex-container flexFlowColumn justifyCenter">
        <h4 class="standoutHeader">⚙️ Auto-apply Settings:</h4>
        <div class="marginTop10">
            {{#each autoApplyOptions}}
            <label class="radio_label">
                <input type="radio" name="stcl-auto-apply-mode" value="{{value}}" {{#if checked}}checked{{/if}} {{#unless ../isExtensionEnabled}}disabled{{/unless}}>
                <span>{{label}}</span>
            </label>
            {{/each}}
        </div>
    </div>

    {{#if hasActiveChat}}
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

        <h4 class="standoutHeader">Group Members:</h4>
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
    {{/if}}
</div>
`);

// ===== SIMPLIFIED EVENT HANDLERS =====


function onContextChanged() {
    if (!settingsManager) return;
    settingsManager.onContextChanged();
}


// ===== POPUP MANAGEMENT =====

async function getPopupContent() {
    const extensionSettings = storageAdapter.getExtensionSettings();
    const context = settingsManager.chatContext.getCurrent();

    const isGroupChat = context.isGroupChat;

    const statusText = `Active${isGroupChat ? ' - Group Chat' : ''}`;

    let checkboxes = [];
    
    if (isGroupChat) {
        checkboxes = [
            { id: 'stcl-enable-character', label: 'Remember per group', checked: extensionSettings.moduleSettings.enableGroupMemory, requiresApi: true },
            { id: 'stcl-enable-chat', label: 'Remember per chat', checked: extensionSettings.moduleSettings.enableChatMemory, requiresApi: true },
            { id: 'stcl-prefer-group-over-chat', label: 'Prefer group settings over chat', checked: extensionSettings.moduleSettings.preferGroupOverChat, requiresApi: true },
            { id: 'stcl-prefer-individual-character', label: 'Prefer character settings over group or chat', checked: extensionSettings.moduleSettings.preferIndividualCharacterInGroup, requiresApi: true },
            { id: 'stcl-show-notifications', label: 'Show notifications', checked: extensionSettings.moduleSettings.showNotifications, requiresApi: false }
        ];
    } else {
        checkboxes = [
            { id: 'stcl-enable-character', label: 'Remember per character', checked: extensionSettings.moduleSettings.enableCharacterMemory, requiresApi: true },
            { id: 'stcl-enable-chat', label: 'Remember per chat', checked: extensionSettings.moduleSettings.enableChatMemory, requiresApi: true },
            { id: 'stcl-prefer-character', label: 'Prefer character settings over chat', checked: extensionSettings.moduleSettings.preferCharacterOverChat, requiresApi: true },
            { id: 'stcl-show-notifications', label: 'Show notifications', checked: extensionSettings.moduleSettings.showNotifications, requiresApi: false }
        ];
    }

    const autoApplyOptions = [
        { value: AUTO_APPLY_MODES.NEVER, label: 'Never auto-apply', checked: extensionSettings.moduleSettings.autoApplyOnContextChange === AUTO_APPLY_MODES.NEVER },
        { value: AUTO_APPLY_MODES.ASK, label: 'Ask before applying', checked: extensionSettings.moduleSettings.autoApplyOnContextChange === AUTO_APPLY_MODES.ASK },
        { value: AUTO_APPLY_MODES.ALWAYS, label: 'Always auto-apply', checked: extensionSettings.moduleSettings.autoApplyOnContextChange === AUTO_APPLY_MODES.ALWAYS }
    ];

    // Use SillyTavern's getContext() to determine if there's an active chat
    const stContext = getContext();
    const hasActiveChat = !!(stContext?.chatId);

    const templateData = {
        isExtensionEnabled: true,
        statusText,
        isGroupChat,
        hasActiveChat,
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
        autoApplyOptions
    };

    return DOMPurify.sanitize(popupTemplate(templateData));
}

async function refreshPopupContent() {
    if (!currentPopupInstance || !currentPopupInstance.dlg.hasAttribute('open')) {
        if (DEBUG_MODE) console.warn('STCL: Cannot refresh popup - no popup currently open');
        return;
    }

    try {
        const content = await getPopupContent();
        const header = '📌 Character Locks';
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
        console.error('STCL: Error refreshing popup content:', error);
        if (currentPopupInstance && typeof currentPopupInstance.completeCancelled === 'function') {
            currentPopupInstance.completeCancelled();
        }
        setTimeout(() => showPopup(), 100);
    }
}

async function refreshPopupAfterSave() {
    await settingsManager.loadCurrentSettings();
    if (currentPopupInstance && typeof currentPopupInstance.completeCancelled === 'function') {
        currentPopupInstance.completeCancelled();
        currentPopupInstance = null;
    }
    setTimeout(async () => {
        currentPopupInstance = null;
        await showPopup();
    }, 200);
}

async function showPopup() {
    // Prevent multiple popups from opening simultaneously
    if (currentPopupInstance && currentPopupInstance.dlg && currentPopupInstance.dlg.hasAttribute('open')) {
        if (DEBUG_MODE) console.log('STCL: Popup already open, bringing to front');
        currentPopupInstance.dlg.focus();
        return;
    }

    const content = await getPopupContent();
    const header = '📌 Character Locks';
    const contentWithHeader = `<h3>${header}</h3>${content}`;
    const context = settingsManager.chatContext.getCurrent();
    const isGroupChat = context.isGroupChat;

    // Check if there's an active chat using SillyTavern's getContext()
    const stContext = getContext();
    const hasActiveChat = !!(stContext?.chatId);

    const customButtons = [];

    // Only show save/clear buttons when there's an active chat
    if (hasActiveChat) {
        // For single character chats, show character and both buttons
        if (!isGroupChat) {
        customButtons.push(
            {
                text: '✔️ Set Character',
                classes: ['menu_button'],
                action: async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    try {
                        const targets = { character: true, chat: false };
                        await settingsManager.saveCurrentUISettings(targets);
                        await refreshPopupAfterSave();
                    } catch (error) {
                        console.error('STCL: Error in Set Character action:', error);
                        if (typeof toastr !== 'undefined') {
                            toastr.error('Failed to save character settings', MODULE_NAME);
                        }
                    }
                }
            },
            {
                text: '✔️ Set Both',
                classes: ['menu_button'],
                action: async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    try {
                        const targets = { character: true, chat: true };
                        await settingsManager.saveCurrentUISettings(targets);
                        await refreshPopupAfterSave();
                    } catch (error) {
                        console.error('STCL: Error in Set Both action:', error);
                        if (typeof toastr !== 'undefined') {
                            toastr.error('Failed to save both settings', MODULE_NAME);
                        }
                    }
                }
            }
        );
    } else {
        // For group chats, only show group and all buttons (no individual character button)
        customButtons.push(
            {
                text: '✔️ Set Group',
                classes: ['menu_button'],
                action: async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    try {
                        const targets = { character: true, chat: false };
                        await settingsManager.saveCurrentUISettings(targets);
                        await refreshPopupAfterSave();
                    } catch (error) {
                        console.error('STCL: Error in Set Group action:', error);
                        if (typeof toastr !== 'undefined') {
                            toastr.error('Failed to save group settings', MODULE_NAME);
                        }
                    }
                }
            },
            {
                text: '✔️ Set All',
                classes: ['menu_button'],
                action: async (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    try {
                        const targets = { character: true, chat: true };
                        await settingsManager.saveCurrentUISettings(targets);
                        await refreshPopupAfterSave();
                    } catch (error) {
                        console.error('STCL: Error in Set All action:', error);
                        if (typeof toastr !== 'undefined') {
                            toastr.error('Failed to save all settings', MODULE_NAME);
                        }
                    }
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
                try {
                    const targets = { character: false, chat: true };
                    await settingsManager.saveCurrentUISettings(targets);
                    await refreshPopupAfterSave();
                } catch (error) {
                    console.error('STCL: Error in Set Chat action:', error);
                    if (typeof toastr !== 'undefined') {
                        toastr.error('Failed to save chat settings', MODULE_NAME);
                    }
                }
            }
        },
        {
            text: isGroupChat ? '❌ Clear Group' : '❌ Clear Character',
            classes: ['menu_button'],
            action: async () => {
                try {
                    if (isGroupChat) {
                        if (context.groupId && await storageAdapter.deleteGroupSettings(context.groupId)) {
                            settingsManager.currentSettings.group = null;
                            // Also clean up old STMTL group settings
                            await storageAdapter.deleteOldGroupSettings(context.groupId);
                            if (typeof toastr !== 'undefined') {
                                toastr.info('Group settings cleared', MODULE_NAME);
                            }
                        }
                    } else {
                        if (context.characterName) {
                            // Use chId if available, fall back to character name
                            const chId = characters?.findIndex(x => x.name === context.characterName);
                            const characterKey = chId !== -1 ? chId : context.characterName;

                            if (storageAdapter.deleteCharacterSettings(characterKey)) {
                                settingsManager.currentSettings.character = null;
                                // Also clean up old STMTL character settings
                                storageAdapter.deleteOldCharacterSettings(context.characterName);
                                if (typeof toastr !== 'undefined') {
                                    toastr.info('Character settings cleared', MODULE_NAME);
                                }
                            }
                        }
                    }
                    await refreshPopupAfterSave();
                } catch (error) {
                    console.error('STCL: Error in Clear Character/Group action:', error);
                }
            }
        },
        {
            text: '❌ Clear Chat',
            classes: ['menu_button'],
            action: async () => {
                try {
                    if (isGroupChat) {
                        if (await storageAdapter.deleteGroupChatSettings(context.groupId)) {
                            settingsManager.currentSettings.chat = null;
                            // Also clean up old STMTL group chat settings
                            await storageAdapter.deleteOldGroupChatSettings(context.groupId);
                            if (typeof toastr !== 'undefined') {
                                toastr.info('Group chat settings cleared', MODULE_NAME);
                            }
                        }
                    } else {
                        if (storageAdapter.deleteChatSettings()) {
                            settingsManager.currentSettings.chat = null;
                            // Also clean up old STMTL chat settings
                            storageAdapter.deleteOldChatSettings();
                            if (typeof toastr !== 'undefined') {
                                toastr.info('Chat settings cleared', MODULE_NAME);
                            }
                        }
                    }
                    await refreshPopupAfterSave();
                } catch (error) {
                    console.error('STCL: Error in Clear Chat action:', error);
                }
            }
        },
        {
            text: '❌ Clear All',
            classes: ['menu_button'],
            action: async () => {
                try {
                    await settingsManager.clearAllSettings();
                    await refreshPopupAfterSave();
                } catch (error) {
                    console.error('STCL: Error in Clear All action:', error);
                    if (typeof toastr !== 'undefined') {
                        toastr.error('Failed to clear all settings', MODULE_NAME);
                    }
                }
            }
        },
        {
            text: '🔄 Apply Settings',
            classes: ['menu_button'],
            action: async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await settingsManager.applySettings();
                // No need to refresh popup content for apply
            }
        }
    );
    }

    const popupOptions = {
        allowVerticalScrolling: true,
        customButtons: customButtons,
        cancelButton: 'Close',
        okButton: false,
        onClose: handlePopupClose
    };

    try {
        currentPopupInstance = new Popup(contentWithHeader, POPUP_TYPE.TEXT, '', popupOptions);
        await currentPopupInstance.show();
    } catch (error) {
        console.error('STCL: Error showing popup:', error);
        currentPopupInstance = null;
    }
}

async function handlePopupClose(popup) {
    try {
        const popupElement = popup.dlg;
        const extensionSettings = storageAdapter.getExtensionSettings();
        const context = settingsManager.chatContext.getCurrent();
        const isGroupChat = context.isGroupChat;

        let checkboxMappings = {};

        if (isGroupChat) {
            checkboxMappings = {
                'stcl-enable-character': 'enableGroupMemory',
                'stcl-enable-chat': 'enableChatMemory',
                'stcl-prefer-group-over-chat': 'preferGroupOverChat',
                'stcl-prefer-individual-character': 'preferIndividualCharacterInGroup',
                'stcl-show-notifications': 'showNotifications'
            };
        } else {
            checkboxMappings = {
                'stcl-enable-character': 'enableCharacterMemory',
                'stcl-enable-chat': 'enableChatMemory',
                'stcl-prefer-character': 'preferCharacterOverChat',
                'stcl-show-notifications': 'showNotifications'
            };
        }

        // Build newValues keyed by checkboxId
        const newValues = lodash.mapValues(checkboxMappings, (settingKey, checkboxId) => {
            const checkbox = popupElement.querySelector(`#${checkboxId}`);
            return checkbox ? checkbox.checked : extensionSettings.moduleSettings[settingKey];
        });

        // Map newValues keys to setting keys for a fair comparison
        const newValuesMapped = lodash.mapKeys(newValues, (value, checkboxId) => checkboxMappings[checkboxId]);

        // Handle radio button for auto-apply mode
        const autoApplyRadio = popupElement.querySelector('input[name="stcl-auto-apply-mode"]:checked');
        const newAutoApplyMode = autoApplyRadio ? autoApplyRadio.value : extensionSettings.moduleSettings.autoApplyOnContextChange;

        // Compare to old values (also keyed by setting keys)
        const oldValues = lodash.pick(extensionSettings.moduleSettings, Object.values(checkboxMappings));
        const oldAutoApplyMode = extensionSettings.moduleSettings.autoApplyOnContextChange;

        const checkboxChanged = !lodash.isEqual(oldValues, newValuesMapped);
        const autoApplyChanged = oldAutoApplyMode !== newAutoApplyMode;

        if (checkboxChanged || autoApplyChanged) {
            lodash.merge(extensionSettings.moduleSettings, newValuesMapped);
            extensionSettings.moduleSettings.autoApplyOnContextChange = newAutoApplyMode;
            storageAdapter.saveExtensionSettings();
        }
    } catch (error) {
        console.error('STCL: Error handling popup close:', error);
    }
}

// ===== MIGRATION POPUP =====

// Track which contexts have already shown the migration popup this session
const shownMigrationPopups = new Set();

async function checkAndShowMigrationPopup() {
    try {
        const context = settingsManager.chatContext.getCurrent();
        const contextKey = context.isGroupChat ?
            `group_${context.groupId}` :
            `char_${context.characterName}_${context.chatId}`;

        // Don't show popup if already shown for this context this session
        if (shownMigrationPopups.has(contextKey)) {
            return;
        }

        const oldSettings = detectOldSettings(context);
        if (oldSettings.hasAny) {
            // Check if we already have new STCL settings for this context
            const hasNewSettings = checkForExistingSTCLSettings(context);

            if (!hasNewSettings) {
                // Only show migration popup if no new STCL settings exist
                await showMigrationPopup(context, oldSettings);
                shownMigrationPopups.add(contextKey);
            } else {
                if (DEBUG_MODE) console.log('STCL: Old settings detected but new STCL settings already exist, skipping migration popup');
            }
        }
    } catch (error) {
        console.error('STCL: Error checking for migration popup:', error);
    }
}

function checkForExistingSTCLSettings(context) {
    try {
        if (context.isGroupChat) {
            // Check for group settings
            if (storageAdapter.getGroupSettings(context.groupId)) {
                return true;
            }
            // Check for group chat settings
            if (storageAdapter.getGroupChatSettings(context.groupId)) {
                return true;
            }
            // Check for individual character settings in groups
            const group = groups?.find(x => x.id === context.groupId);
            if (group?.members && Array.isArray(group.members)) {
                for (const memberAvatar of group.members) {
                    const chId = characters?.findIndex(x => x.avatar === memberAvatar);
                    if (chId !== -1 && storageAdapter.getCharacterSettings(chId)) {
                        return true;
                    }
                }
            }
        } else {
            // Check for character settings (try chId first, then name fallback)
            const chId = characters?.findIndex(x => x.name === context.characterName);
            const characterKey = chId !== -1 ? chId : context.characterName;
            if (storageAdapter.getCharacterSettings(characterKey)) {
                return true;
            }
            // Check for chat settings
            if (storageAdapter.getChatSettings()) {
                return true;
            }
        }
        return false;
    } catch (error) {
        if (DEBUG_MODE) console.warn('STCL: Error checking for existing STCL settings:', error);
        return false;
    }
}

function detectOldSettings(context) {
    const result = {
        hasAny: false,
        character: null,
        chat: null,
        group: null,
        groupChat: null
    };

    try {
        if (context.isGroupChat) {
            // Group chat context
            if (storageAdapter.hasOldGroupSettings(context.groupId)) {
                result.group = storageAdapter.getOldGroupSettings(context.groupId);
                result.hasAny = true;
            }
            if (storageAdapter.hasOldGroupChatSettings(context.groupId)) {
                result.groupChat = storageAdapter.getOldGroupChatSettings(context.groupId);
                result.hasAny = true;
            }
            // Individual character settings in groups - check all members
            const group = groups?.find(x => x.id === context.groupId);
            if (group?.members && Array.isArray(group.members)) {
                for (const memberAvatar of group.members) {
                    const character = characters?.find(x => x.avatar === memberAvatar);
                    if (character && storageAdapter.hasOldCharacterSettings(character.name)) {
                        if (!result.character) result.character = [];
                        result.character.push({
                            name: character.name,
                            settings: storageAdapter.getOldCharacterSettings(character.name)
                        });
                        result.hasAny = true;
                    }
                }
            }
        } else {
            // Single chat context
            if (context.characterName && storageAdapter.hasOldCharacterSettings(context.characterName)) {
                result.character = storageAdapter.getOldCharacterSettings(context.characterName);
                result.hasAny = true;
            }
            if (storageAdapter.hasOldChatSettings()) {
                result.chat = storageAdapter.getOldChatSettings();
                result.hasAny = true;
            }
        }
    } catch (error) {
        console.error('STCL: Error detecting old settings:', error);
    }

    return result;
}

function formatOldSettings(settings, label) {
    if (!settings) return '';

    const formatted = [];
    formatted.push(`**${label}:**`);
    formatted.push(`- Model: ${settings.model || 'Unknown'}`);
    formatted.push(`- Temperature: ${settings.temperature ?? 'Unknown'}`);
    formatted.push(`- Completion Source: ${settings.completionSource || 'Unknown'}`);

    if (settings.savedAt) {
        try {
            const saved = moment(settings.savedAt).format('MMM D, YYYY [at] h:mm A');
            formatted.push(`- Saved: ${saved}`);
        } catch {
            formatted.push(`- Saved: ${settings.savedAt}`);
        }
    }

    return formatted.join('\n');
}

function formatOldSettingsHTML(settings, label) {
    if (!settings) return '';

    let html = `<div class="info-block">`;
    html += `<strong>${label}:</strong><br>`;
    html += `<small>Model: ${settings.model || 'Unknown'}<br>`;
    html += `Temperature: ${settings.temperature ?? 'Unknown'}<br>`;
    html += `Completion Source: ${settings.completionSource || 'Unknown'}<br>`;

    if (settings.savedAt) {
        try {
            const saved = moment(settings.savedAt).format('MMM D, YYYY [at] h:mm A');
            html += `Saved: ${saved}<br>`;
        } catch {
            html += `Saved: ${settings.savedAt}<br>`;
        }
    }

    html += `</small></div>`;
    return html;
}

async function showMigrationPopup(context, oldSettings) {
    try {
        let message = `<h3>⚠️ Old Model/Temperature Lock Settings Found</h3>`;

        message += `<p>Previous settings for <strong>Model/Temperature Locks (STMTL)</strong> were found but are not applicable to the new <strong>Character Locks (STCL)</strong> system.</p>`;

        message += `<p>The new system uses <strong>Connection Profiles</strong> and <strong>Presets</strong> instead of individual model and temperature settings.</p>`;

        if (context.isGroupChat) {
            message += `<h4>Found in this group chat:</h4>`;

            if (oldSettings.group) {
                message += formatOldSettingsHTML(oldSettings.group, 'Group Settings');
            }
            if (oldSettings.groupChat) {
                message += formatOldSettingsHTML(oldSettings.groupChat, 'Group Chat Settings');
            }
            if (oldSettings.character && Array.isArray(oldSettings.character)) {
                oldSettings.character.forEach(char => {
                    message += formatOldSettingsHTML(char.settings, `Character: ${char.name}`);
                });
            }
        } else {
            message += `<h4>Found in this chat:</h4>`;

            if (oldSettings.character) {
                message += formatOldSettingsHTML(oldSettings.character, `Character: ${context.characterName}`);
            }
            if (oldSettings.chat) {
                message += formatOldSettingsHTML(oldSettings.chat, 'Chat Settings');
            }
        }

        message += `<h4>To continue:</h4>`;
        message += `<p>Configure your new Connection Profiles and Presets in SillyTavern, then use Character Locks to save your new settings. Old settings will be automatically removed when you save new ones.</p>`;
        message += `<p><small>This message will only appear once per chat/character.</small></p>`;

        const result = await callGenericPopup(message, POPUP_TYPE.CONFIRM, '', {
            okButton: 'Configure Now',
            cancelButton: 'Understood'
        });

        if (result === POPUP_RESULT.AFFIRMATIVE) {
            // User clicked "Configure Now" - open STCL settings
            await showPopup();
        }
    } catch (error) {
        console.error('STCL: Error showing migration popup:', error);
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

function addPopupWrapStyle() {
    if (document.getElementById('stcl-popup-fix')) return;

    const css = `
        .popup-controls {
            flex-wrap: wrap !important;
            justify-content: center !important;
        }
        .radio_label {
            display: block !important;
            margin: 5px 0 !important;
            cursor: pointer !important;
        }
        .radio_label input[type="radio"] {
            margin-right: 8px !important;
        }
    `;
    const style = document.createElement('style');
    style.id = 'stcl-popup-fix';
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
            if (DEBUG_MODE) console.log('STCL: Event listeners already registered, cleaning up first');
            unregisterAllEventHandlers();
        }

        try {
            if (!eventSource || !event_types) {
                if (DEBUG_MODE) console.warn('STCL: eventSource or event_types not available, retrying...');
                setTimeout(registerSillyTavernEvents, 1000);
                return;
            }

            eventListenersRegistered = true;

            // Note: CHARACTER_SELECTED event doesn't exist in SillyTavern - using CHAT_CHANGED instead
            // CHAT_CHANGED fires when characters are selected/changed, covering both scenarios
            registerEventHandler(event_types.CHAT_CHANGED, onContextChanged, 'character/chat change');
            registerEventHandler(event_types.GROUP_CHAT_CREATED, () => {
                // Use the GROUP_UPDATED event instead of timeout for proper synchronization
                onContextChanged();
            }, 'group chat creation');

            registerEventHandler(event_types.GROUP_MEMBER_DRAFTED, async (chId) => {
                try {
                    // Check if individual character preference is enabled
                    const extensionSettings = storageAdapter.getExtensionSettings();
                    const prefs = extensionSettings.moduleSettings;
                    if (!prefs.preferIndividualCharacterInGroup) {
                        return;
                    }

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
                    if (!charObj || !charObj.name) {
                        console.error('STCL: Character object is null, undefined, or missing name at index:', chId);
                        return;
                    }

                    if (DEBUG_MODE) {
                        console.log('STCL: group_member_drafted - applying individual character settings:', {
                            chId,
                            draftedCharacter: charObj,
                            name: charObj.name,
                            avatar: charObj.avatar,
                        });
                    }

                    // Apply character-specific connection profile and preset before generation
                    // Use chId for storage lookup
                    const context = settingsManager.chatContext.getCurrent();

                    if (context?.type === CHAT_TYPES.GROUP) {
                        // Get individual character settings using chId as key
                        const individual = storageAdapter.getCharacterSettings(chId);
                        if (individual) {
                            if (DEBUG_MODE) console.log(`STCL: Found individual character settings for ${charObj.name} in group chat`);

                            // Respect the auto-apply mode setting
                            const autoApplyMode = prefs.autoApplyOnContextChange;
                            if (autoApplyMode === AUTO_APPLY_MODES.NEVER) {
                                if (DEBUG_MODE) console.log('STCL: Auto-apply disabled, skipping character settings application');
                                return;
                            } else if (autoApplyMode === AUTO_APPLY_MODES.ASK) {
                                const shouldApply = await settingsManager._askUserToApplySettings(context);
                                if (!shouldApply) {
                                    if (DEBUG_MODE) console.log('STCL: User declined to apply character settings');
                                    return;
                                }
                            }

                            if (DEBUG_MODE) console.log(`STCL: Applying individual character settings for ${charObj.name} in group chat`);
                            await settingsManager._applySettingsToUI(individual);
                        }
                    }
                } catch (error) {
                    console.error('STCL: Error in GROUP_MEMBER_DRAFTED handler:', error);
                }
            });


            if (DEBUG_MODE) console.log('STCL: Event listeners registered successfully');
        } catch (e) {
            console.warn('STCL: Could not bind to SillyTavern events:', e);
            setTimeout(registerSillyTavernEvents, 2000);
        }
    }

    registerSillyTavernEvents();

    // Connection profiles handle API changes automatically
}

// ===== MIGRATION =====

function migrateOldData() {
    const extensionSettings = storageAdapter.getExtensionSettings();

    if (extensionSettings.migrationVersion >= 9) {
        return;
    }

    if (DEBUG_MODE) console.log('STCL: Starting data migration...');

    // Remove old auto-save settings (v7 migration)
    if (extensionSettings.moduleSettings.hasOwnProperty('autoSaveCharacter')) {
        delete extensionSettings.moduleSettings.autoSaveCharacter;
        if (DEBUG_MODE) console.log('STCL: Removed autoSaveCharacter setting');
    }
    if (extensionSettings.moduleSettings.hasOwnProperty('autoSaveChat')) {
        delete extensionSettings.moduleSettings.autoSaveChat;
        if (DEBUG_MODE) console.log('STCL: Removed autoSaveChat setting');
    }
    if (extensionSettings.moduleSettings.hasOwnProperty('autoSaveGroup')) {
        delete extensionSettings.moduleSettings.autoSaveGroup;
        if (DEBUG_MODE) console.log('STCL: Removed autoSaveGroup setting');
    }
    if (extensionSettings.moduleSettings.hasOwnProperty('autoSave')) {
        delete extensionSettings.moduleSettings.autoSave;
        if (DEBUG_MODE) console.log('STCL: Removed legacy autoSave setting');
    }

    // Consolidate notification settings
    if (extensionSettings.moduleSettings.hasOwnProperty('showAutoSaveNotifications') ||
        extensionSettings.moduleSettings.hasOwnProperty('showOtherNotifications')) {
        const showNotifications = extensionSettings.moduleSettings.showAutoSaveNotifications ||
                                 extensionSettings.moduleSettings.showOtherNotifications || true;
        extensionSettings.moduleSettings.showNotifications = showNotifications;
        delete extensionSettings.moduleSettings.showAutoSaveNotifications;
        delete extensionSettings.moduleSettings.showOtherNotifications;
        if (DEBUG_MODE) console.log('STCL: Consolidated notification settings');
    }

    // Migrate character settings (unescape keys) - only if not done before
    if (extensionSettings.migrationVersion < 6 && extensionSettings.characterSettings && Object.keys(extensionSettings.characterSettings).length > 0) {
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
                    if (DEBUG_MODE) console.log(`STCL: Unescaped character key "${characterKey}" to "${characterName}"`);
                } catch (e) {
                    console.warn(`STCL: Could not unescape key "${characterKey}", using as-is`);
                }
            }

            newCharacterSettings[characterName] = settings;
            migratedCount++;
        }

        extensionSettings.characterSettings = newCharacterSettings;
        if (DEBUG_MODE) console.log(`STCL: Migrated ${migratedCount} character settings`);
    }

    // Remove old chatSettings
    if (extensionSettings.chatSettings) {
        if (DEBUG_MODE) console.log('STCL: Removing old chatSettings from extension settings');
        delete extensionSettings.chatSettings;
    }

    // Add missing settings
    if (!extensionSettings.moduleSettings.hasOwnProperty('enableGroupMemory')) {
        extensionSettings.moduleSettings.enableGroupMemory = true;
    }
    if (!extensionSettings.moduleSettings.hasOwnProperty('preferGroupOverChat')) {
        extensionSettings.moduleSettings.preferGroupOverChat = true;
    }
    if (!extensionSettings.moduleSettings.hasOwnProperty('preferIndividualCharacterInGroup')) {
        extensionSettings.moduleSettings.preferIndividualCharacterInGroup = false;
    }
    if (!extensionSettings.moduleSettings.hasOwnProperty('showNotifications')) {
        extensionSettings.moduleSettings.showNotifications = true;
    }
    // Migrate auto-apply setting from boolean to enum (v9 migration)
    if (extensionSettings.moduleSettings.hasOwnProperty('autoApplyOnContextChange')) {
        const oldValue = extensionSettings.moduleSettings.autoApplyOnContextChange;
        if (typeof oldValue === 'boolean') {
            // Convert boolean to enum
            extensionSettings.moduleSettings.autoApplyOnContextChange = oldValue ? AUTO_APPLY_MODES.ALWAYS : AUTO_APPLY_MODES.ASK;
            if (DEBUG_MODE) console.log(`STCL: Migrated autoApplyOnContextChange from boolean ${oldValue} to enum ${extensionSettings.moduleSettings.autoApplyOnContextChange}`);
        }
    } else {
        // Default to ask for new installations
        extensionSettings.moduleSettings.autoApplyOnContextChange = AUTO_APPLY_MODES.ASK;
    }
    // Group settings are now stored directly on group objects, not in extension settings

    extensionSettings.migrationVersion = 9;
    storageAdapter.saveExtensionSettings();

    if (DEBUG_MODE) console.log('STCL: Data migration completed');
}

// ===== INITIALIZATION =====

let hasInitialized = false;

async function init() {
    if (hasInitialized) return;
    hasInitialized = true;
    
    console.log('STCL: Initializing extension');

    // Check if connection manager extension is enabled (required dependency)
    if (extension_settings.disabledExtensions.includes('connection-manager')) {
        console.error('STCL: Connection Manager extension is required but disabled');
        await Popup.show.alert(
            'STCL Extension Dependency Error',
            'STCL requires the Connection Manager extension to be enabled. Please enable the Connection Manager extension and reload the page.'
        );
        return;
    }
    if (DEBUG_MODE) console.log('STCL: Connection Manager dependency check passed');

    addPopupWrapStyle();

    // Wait for SillyTavern to be ready
    let attempts = 0;
    const maxAttempts = 20;

    while (attempts < maxAttempts) {
        if (eventSource && typeof Popup !== 'undefined') {
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

    // Connection profiles handle API compatibility automatically

    // Initial context load - use SETTINGS_LOADED_AFTER event if available
    if (event_types && event_types.SETTINGS_LOADED_AFTER) {
        const registered = registerEventHandler(event_types.SETTINGS_LOADED_AFTER, () => {
            if (settingsManager) {
                settingsManager.onContextChanged();
            }
            if (DEBUG_MODE) console.log('STCL: Initial context loaded after settings');
        }, 'settings loaded');

        if (!registered) {
            console.warn('STCL: Failed to register SETTINGS_LOADED_AFTER, using fallback');
            setTimeout(() => {
                if (settingsManager) {
                    settingsManager.onContextChanged();
                }
                if (DEBUG_MODE) console.log('STCL: Initial context loaded (fallback after registration failure)');
            }, 1000);
        }
    } else {
        // Fallback for older versions or when event_types not available
        if (DEBUG_MODE) console.log('STCL: SETTINGS_LOADED_AFTER not available, using fallback');
        setTimeout(() => {
            if (settingsManager) {
                settingsManager.onContextChanged();
            }
            if (DEBUG_MODE) console.log('STCL: Initial context loaded (fallback)');
        }, 1000);
    }

    console.log('STCL: extension loaded successfully');
}

// ===== BOOTSTRAP =====

$(document).ready(() => {
    if (eventSource && event_types && event_types.APP_READY) {
        const registered = registerEventHandler(event_types.APP_READY, init, 'app ready');
        if (registered) {
            if (DEBUG_MODE) console.log('STCL: Registered for APP_READY event');
        } else {
            console.warn('STCL: Failed to register APP_READY event, using fallback');
            setTimeout(() => {
                if (!hasInitialized) {
                    if (DEBUG_MODE) console.log('STCL: Running fallback initialization after registration failure');
                    init();
                }
            }, 2000);
        }
    } else {
        console.warn('STCL: APP_READY event not available, using fallback initialization');
        // Fallback initialization after a delay
        setTimeout(() => {
            if (!hasInitialized) {
                if (DEBUG_MODE) console.log('STCL: Running fallback initialization');
                init();
            }
        }, 2000);
    }
});