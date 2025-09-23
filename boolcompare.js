// ===== IMPORTS FROM SILLYTAVERN CORE =====
import { deepMerge } from '../../../utils.js';
// ===== IMPORTS FROM EXTENSION UTILS =====
import {
    getEntitySettings,
    setEntitySettings,
    validateEntityId,
    ENTITY_TYPES
} from './stcl-utils.js';

const PREDEFINED_RULES = [
    { id: 'global_default', condition: '', preset: '', prompts: null, priority: 0, description: 'Global default/fallback' },
    { id: 'gpt_4o_mini', condition: 'gpt AND 4o AND mini', preset: '', prompts: null, priority: 20, description: 'GPT-4o mini' },
    { id: 'gpt_4o_not_mini', condition: 'gpt AND 4o NOT mini', preset: '', prompts: null, priority: 10, description: 'GPT-4o (not mini)' },
    { id: 'gpt_41', condition: 'gpt AND 4.1', preset: '', prompts: null, priority: 25, description: 'GPT-4.1' },
    { id: 'gpt_5_not_mini', condition: 'gpt AND 5 NOT mini', preset: '', prompts: null, priority: 30, description: 'GPT-5 (not mini)' },
    { id: 'gpt_5_mini', condition: 'gpt AND 5 AND mini', preset: '', prompts: null, priority: 40, description: 'GPT-5 mini' },
    { id: 'gemini_25_pro_thinking', condition: 'gemini AND 2.5 AND pro AND thinking', preset: '', prompts: null, priority: 50, description: 'Gemini 2.5 Pro (thinking)' },
    { id: 'gemini_25_pro_not_thinking', condition: 'gemini AND 2.5 AND pro NOT thinking', preset: '', prompts: null, priority: 55, description: 'Gemini 2.5 Pro (not thinking)' },
    { id: 'gemini_25_flash', condition: 'gemini AND 2.5 AND flash', preset: '', prompts: null, priority: 60, description: 'Gemini 2.5 Flash' },
    { id: 'deepseek_0324', condition: 'deepseek AND 0324', preset: '', prompts: null, priority: 70, description: 'DeepSeek 0324' },
    { id: 'deepseek_31', condition: 'deepseek AND 3.1', preset: '', prompts: null, priority: 80, description: 'DeepSeek 3.1' },
    { id: 'deepseek_0528', condition: 'deepseek AND 0528', preset: '', prompts: null, priority: 90, description: 'DeepSeek 0528' },
    { id: 'sonnet_4_not_thinking', condition: 'sonnet AND 4 NOT thinking', preset: '', prompts: null, priority: 100, description: 'Claude 3.5 Sonnet 4 (not thinking)' },
    { id: 'sonnet_4_thinking', condition: 'sonnet AND 4 AND thinking', preset: '', prompts: null, priority: 110, description: 'Claude 3.5 Sonnet 4 (thinking)' },
    { id: 'sonnet_37_not_thinking', condition: 'sonnet AND 3.7 NOT thinking', preset: '', prompts: null, priority: 120, description: 'Claude 3.7 Sonnet (not thinking)' },
    { id: 'sonnet_37_thinking', condition: 'sonnet AND 3.7 AND thinking', preset: '', prompts: null, priority: 130, description: 'Claude 3.7 Sonnet (thinking)' },
    { id: 'opus_4_not_41_not_thinking', condition: 'opus AND 4 NOT 4.1 NOT thinking', preset: '', prompts: null, priority: 140, description: 'Claude Opus 4 (not 4.1, not thinking)' },
    { id: 'opus_4_not_41_thinking', condition: 'opus AND 4 NOT 4.1 AND thinking', preset: '', prompts: null, priority: 150, description: 'Claude Opus 4 (not 4.1, thinking)' },
    { id: 'opus_41_not_thinking', condition: 'opus AND 4.1 NOT thinking', preset: '', prompts: null, priority: 160, description: 'Claude Opus 4.1 (not thinking)' },
    { id: 'opus_41_thinking', condition: 'opus AND 4.1 AND thinking', preset: '', prompts: null, priority: 170, description: 'Claude Opus 4.1 (thinking)' },
    { id: 'grok_3', condition: 'grok AND 3', preset: '', prompts: null, priority: 180, description: 'Grok 3' },
    { id: 'grok_4', condition: 'grok AND 4', preset: '', prompts: null, priority: 190, description: 'Grok 4' }
];

// ===== BOOLEAN EXPRESSION EVALUATOR =====

/**
 * Evaluates Boolean expressions with AND, AND NOT, and NOT operators
 */
class BooleanExpressionEvaluator {
    constructor() {
        this.tokens = [];
        this.position = 0;
    }

    /**
     * Evaluates a Boolean expression against a target string
     * @param {string} condition - The Boolean condition (e.g., "gpt AND 4o NOT mini")
     * @param {string} target - The target string to evaluate against
     * @returns {boolean} True if the condition matches the target
     */
    evaluate(condition, target) {
        if (!condition || typeof condition !== 'string' || condition.trim() === '') {
            return true; // Empty condition matches everything (global default)
        }
        if (!target || typeof target !== 'string') {
            return false;
        }

        try {
            const normalizedTarget = target.toLowerCase();
            this.tokens = this.tokenize(condition.toLowerCase());
            this.position = 0;

            return this.parseExpression(normalizedTarget);
        } catch (error) {
            console.warn('STCL: Error evaluating Boolean expression:', error);
            return false;
        }
    }

    /**
     * Tokenizes the condition string into operators and terms
     * @param {string} condition - The condition to tokenize
     * @returns {Array} Array of tokens
     */
    tokenize(condition) {
        if (!condition || typeof condition !== 'string') {
            return [];
        }

        const tokens = [];
        const regex = /\b(and\s+not|and|or|not)\b|\b\w+(?:\.\w+)*\b/gi;
        let match;

        while ((match = regex.exec(condition)) !== null) {
            const token = match[0].trim().toLowerCase();
            if (token === 'and not') {
                tokens.push('AND_NOT');
            } else if (token === 'and') {
                tokens.push('AND');
            } else if (token === 'or') {
                tokens.push('OR');
            } else if (token === 'not') {
                tokens.push('NOT');
            } else {
                tokens.push(token);
            }
        }

        return tokens;
    }

    /**
     * Parses the full expression
     * @param {string} target - The target string
     * @returns {boolean} Evaluation result
     */
    parseExpression(target) {
        if (!target || typeof target !== 'string') {
            return false;
        }

        let result = this.parseAndExpression(target);

        while (this.position < this.tokens.length) {
            const operator = this.tokens[this.position];

            if (operator === 'OR') {
                this.position++;
                const rightOperand = this.parseAndExpression(target);
                result = result || rightOperand;
            } else {
                break;
            }
        }

        return result;
    }

    /**
     * Parses AND expressions (higher precedence than OR)
     * @param {string} target - The target string
     * @returns {boolean} Evaluation result
     */
    parseAndExpression(target) {
        if (!target || typeof target !== 'string') {
            return false;
        }

        let result = this.parseTerm(target);

        while (this.position < this.tokens.length) {
            const operator = this.tokens[this.position];

            if (operator === 'AND') {
                this.position++;
                const rightOperand = this.parseTerm(target);
                result = result && rightOperand;
            } else if (operator === 'AND_NOT') {
                this.position++;
                const rightOperand = this.parseTerm(target);
                result = result && !rightOperand;
            } else if (operator === 'NOT') {
                // Treat standalone NOT as implicit AND NOT
                this.position++;
                if (this.position >= this.tokens.length) {
                    throw new Error('Expected term after NOT');
                }
                const nextToken = this.tokens[this.position];
                this.position++;
                const rightOperand = this.matchesTerm(nextToken, target);
                result = result && !rightOperand;
            } else {
                break;
            }
        }

        return result;
    }

    /**
     * Parses a single term (with optional NOT prefix)
     * @param {string} target - The target string
     * @returns {boolean} Evaluation result
     */
    parseTerm(target) {
        if (!target || typeof target !== 'string') {
            return false;
        }
        if (this.position >= this.tokens.length) {
            return true;
        }

        const token = this.tokens[this.position];

        if (token === 'NOT') {
            this.position++;
            if (this.position >= this.tokens.length) {
                throw new Error('Expected term after NOT');
            }
            const nextToken = this.tokens[this.position];
            this.position++;
            return !this.matchesTerm(nextToken, target);
        } else {
            this.position++;
            return this.matchesTerm(token, target);
        }
    }

    /**
     * Checks if a term matches the target string
     * @param {string} term - The term to match
     * @param {string} target - The target string
     * @returns {boolean} True if the term is found in the target
     */
    matchesTerm(term, target) {
        if (!term || typeof term !== 'string') {
            return false;
        }
        if (!target || typeof target !== 'string') {
            return false;
        }
        return target.includes(term);
    }
}

// ===== MODEL PROMPT MANAGER =====

/**
 * Manages model-to-prompt/preset mappings with Boolean logic
 */
export class ModelPromptManager {
    constructor(storageAdapter) {
        if (!storageAdapter || typeof storageAdapter !== 'object') {
            throw new Error('Storage adapter is required');
        }
        if (typeof storageAdapter.getExtensionSettings !== 'function') {
            throw new Error('Storage adapter must have getExtensionSettings method');
        }
        this.storage = storageAdapter;
        this.evaluator = new BooleanExpressionEvaluator();
    }

    /**
     * Gets the default model-prompt mappings structure
     * @returns {Object} Default mappings configuration
     */
    getDefaultMappings() {
        return {
            rules: PREDEFINED_RULES.map(rule => deepMerge({}, rule)), // Deep copy using ST utility
            globalDefault: { preset: '', prompts: null },
            enableModelPromptLinks: true,
            followInheritanceChain: true
        };
    }

    /**
     * Gets model-prompt mappings from settings
     * @param {string} context - 'character', 'chat', 'group', or 'global'
     * @param {string} id - The character name or group ID (if applicable)
     * @returns {Object|null} The mappings object or null if not found
     */
    getMappings(context = 'global', id = null) {
        if (!this.storage || typeof this.storage.getExtensionSettings !== 'function') {
            throw new Error('Storage adapter not properly initialized');
        }

        try {
            switch (context) {
                case 'character':
                    if (!validateEntityId(id, ENTITY_TYPES.CHARACTER)) return null;
                    const charSettings = getEntitySettings(this.storage.getUserSettings(), ENTITY_TYPES.CHARACTER, id);
                    return charSettings?.modelPromptMappings || null;

                case 'chat':
                    const chatSettings = getEntitySettings(this.storage.getUserSettings(), ENTITY_TYPES.CHAT, 'current');
                    return chatSettings?.modelPromptMappings || null;

                case 'group':
                    if (!validateEntityId(id, ENTITY_TYPES.GROUP)) return null;
                    const groupSettings = getEntitySettings(this.storage.getUserSettings(), ENTITY_TYPES.GROUP, id);
                    return groupSettings?.modelPromptMappings || null;

                case 'global':
                default:
                    const extensionSettings = this.storage.getExtensionSettings();
                    return extensionSettings.modelPromptMappings || this.getDefaultMappings();
            }
        } catch (error) {
            console.error('STCL: Error getting mappings:', error);
            return null;
        }
    }

    /**
     * Sets model-prompt mappings in settings
     * @param {Object} mappings - The mappings object to save
     * @param {string} context - 'character', 'chat', 'group', or 'global'
     * @param {string} id - The character name or group ID (if applicable)
     * @returns {boolean} True if successful
     */
    setMappings(mappings, context = 'global', id = null) {
        if (!mappings || typeof mappings !== 'object') {
            throw new Error('Invalid mappings object provided');
        }
        if (!this.storage || typeof this.storage.getExtensionSettings !== 'function') {
            throw new Error('Storage adapter not properly initialized');
        }

        try {
            switch (context) {
                case 'character':
                    if (!validateEntityId(id, ENTITY_TYPES.CHARACTER)) return false;
                    const charSettings = getEntitySettings(this.storage.getUserSettings(), ENTITY_TYPES.CHARACTER, id) || {};
                    charSettings.modelPromptMappings = mappings;
                    return setEntitySettings(this.storage.getUserSettings(), ENTITY_TYPES.CHARACTER, id, charSettings, this.storage);

                case 'chat':
                    const chatSettings = getEntitySettings(this.storage.getUserSettings(), ENTITY_TYPES.CHAT, 'current') || {};
                    chatSettings.modelPromptMappings = mappings;
                    return setEntitySettings(this.storage.getUserSettings(), ENTITY_TYPES.CHAT, 'current', chatSettings, this.storage);

                case 'group':
                    if (!validateEntityId(id, ENTITY_TYPES.GROUP)) return false;
                    const groupSettings = getEntitySettings(this.storage.getUserSettings(), ENTITY_TYPES.GROUP, id) || {};
                    groupSettings.modelPromptMappings = mappings;
                    return setEntitySettings(this.storage.getUserSettings(), ENTITY_TYPES.GROUP, id, groupSettings, this.storage);

                case 'global':
                default:
                    const extensionSettings = this.storage.getExtensionSettings();
                    extensionSettings.modelPromptMappings = mappings;
                    if (typeof this.storage.saveSettings !== 'function') {
                        throw new Error('Storage adapter saveSettings method not available');
                    }
                    this.storage.saveSettings();
                    return true;
            }
        } catch (error) {
            console.error('STCL: Error saving model-prompt mappings:', error);
            return false;
        }
    }

    /**
     * Evaluates model name against all rules and returns the best match
     * @param {string} modelName - The current model name
     * @param {Object} context - Chat context with character/group info
     * @returns {Object|null} Matched rule with preset/prompts or null if no match
     */
    async evaluateModel(modelName, context) {
        // Validate inputs
        if (!modelName || typeof modelName !== 'string') {
            console.warn('STCL: Invalid model name for evaluation:', modelName);
            return null;
        }

        const normalizedModelName = modelName.trim().toLowerCase();
        if (!normalizedModelName) {
            console.warn('STCL: Model name is empty after normalization:', modelName);
            return null;
        }

        if (context && typeof context !== 'object') {
            console.warn('STCL: Invalid context provided for model evaluation:', typeof context);
            return null;
        }

        try {
            // Get mappings based on inheritance chain
            const mappings = await this.getMappingsWithInheritance(context);

            if (!mappings || typeof mappings !== 'object') {
                console.warn('STCL: Invalid mappings object received');
                return null;
            }

            if (!mappings.enableModelPromptLinks) {
                console.log('STCL: Model-prompt links are disabled');
                return null; // Feature disabled
            }

            console.log(`STCL: Evaluating model "${modelName}" against ${mappings.rules?.length || 0} rules`);

            // Find all matching rules
            const matchingRules = [];

            if (mappings.rules && Array.isArray(mappings.rules)) {
                for (const rule of mappings.rules) {
                    if (!rule || typeof rule !== 'object') {
                        console.warn('STCL: Skipping invalid rule:', rule);
                        continue;
                    }

                    if (!rule.id || typeof rule.id !== 'string') {
                        console.warn('STCL: Skipping rule without valid ID:', rule);
                        continue;
                    }

                    if (rule.condition) {
                        try {
                            if (this.evaluator.evaluate(rule.condition, normalizedModelName)) {
                                // Check if rule is configured for application
                                const hasPreset = rule.preset && typeof rule.preset === 'string' && rule.preset.trim();
                                const hasPrompts = rule.prompts && typeof rule.prompts === 'object';
                                const isConfigured = hasPreset || hasPrompts;

                                // Always add matching rules, regardless of configuration
                                matchingRules.push(deepMerge({}, {
                                    ...rule,
                                    priority: typeof rule.priority === 'number' ? rule.priority : 0,
                                    isConfigured: isConfigured
                                }));

                                console.log(`STCL: Rule "${rule.id}" matched model "${modelName}" - ${isConfigured ? 'configured' : 'not configured'}`);
                            }
                        } catch (evaluationError) {
                            console.warn(`STCL: Error evaluating rule "${rule.id}":`, evaluationError);
                        }
                    } else {
                        console.log(`STCL: Skipping rule "${rule.id}" with empty condition`);
                    }
                }
            } else {
                console.log('STCL: No rules array found in mappings');
            }

            // Sort by priority (higher priority = higher number = more specific)
            matchingRules.sort((a, b) => (b.priority || 0) - (a.priority || 0));

            // Return the highest priority match
            if (matchingRules.length > 0) {
                const bestMatch = matchingRules[0];
                console.log(`STCL: Selected best match: "${bestMatch.id}" (priority: ${bestMatch.priority})`);

                // Validate the result before returning
                const result = {
                    ruleId: bestMatch.id,
                    preset: bestMatch.preset || '',
                    prompts: bestMatch.prompts || null,
                    description: bestMatch.description || bestMatch.id,
                    priority: bestMatch.priority || 0,
                    isConfigured: bestMatch.isConfigured || false
                };

                // Additional validation for preset existence
                if (result.preset && typeof result.preset === 'string') {
                    result.preset = result.preset.trim();
                }

                return result;
            }

            // Check global default if no rules matched
            if (mappings.globalDefault && typeof mappings.globalDefault === 'object') {
                const hasDefaultPreset = mappings.globalDefault.preset &&
                                       typeof mappings.globalDefault.preset === 'string' &&
                                       mappings.globalDefault.preset.trim();
                const hasDefaultPrompts = mappings.globalDefault.prompts &&
                                        typeof mappings.globalDefault.prompts === 'object';

                if (hasDefaultPreset || hasDefaultPrompts) {
                    console.log('STCL: Using global default for model:', modelName);
                    return {
                        ruleId: 'global_default',
                        preset: mappings.globalDefault.preset || '',
                        prompts: mappings.globalDefault.prompts || null,
                        description: 'Global default',
                        priority: 0
                    };
                }
            }

            console.log('STCL: No matching rules found for model:', modelName);
            return null;

        } catch (error) {
            console.error('STCL: Error evaluating model against rules:', error);
            return null;
        }
    }

    /**
     * Gets mappings following the inheritance chain
     * @param {Object} context - Chat context
     * @returns {Promise<Object|null>} Mappings object following inheritance preferences
     */
    async getMappingsWithInheritance(context) {
        if (!this.storage || typeof this.storage.getExtensionSettings !== 'function') {
            throw new Error('Storage adapter not properly initialized');
        }

        try {
            const extensionSettings = this.storage.getExtensionSettings();
            if (!extensionSettings || typeof extensionSettings !== 'object') {
                console.warn('STCL: Invalid extension settings');
                return null;
            }

            const moduleSettings = extensionSettings.moduleSettings;
            if (!moduleSettings || typeof moduleSettings !== 'object') {
                console.warn('STCL: Invalid module settings');
                return null;
            }

            const globalMappings = this.getMappings('global');
            if (!globalMappings || typeof globalMappings !== 'object') {
                console.warn('STCL: Invalid global mappings');
                return null;
            }

            if (!context || typeof context !== 'object') {
                console.log('STCL: No context provided, using global mappings');
                return globalMappings;
            }

            // Check if the feature is enabled globally first
            const isGloballyEnabled = globalMappings?.enableModelPromptLinks || false;

            let bestMappings = null;

            if (context.isGroupChat) {
                // Group chat inheritance chain - prefer more specific settings for rules
                if (moduleSettings.preferIndividualCharacterInGroup && context.activeCharacterInGroup) {
                    try {
                        const charMappings = this.getMappings('character', context.activeCharacterInGroup);
                        if (charMappings && typeof charMappings === 'object') {
                            if (charMappings.enableModelPromptLinks ||
                                (isGloballyEnabled && charMappings.rules && Array.isArray(charMappings.rules) && charMappings.rules.length > 0)) {
                                bestMappings = charMappings;
                            }
                        }
                    } catch (error) {
                        console.warn('STCL: Error getting character mappings for group chat:', error);
                    }
                }

                if (!bestMappings) {
                    if (moduleSettings.preferGroupOverChat) {
                        if (context.groupId) {
                            try {
                                const groupMappings = this.getMappings('group', context.groupId);
                                if (groupMappings && typeof groupMappings === 'object') {
                                    if (groupMappings.enableModelPromptLinks ||
                                        (isGloballyEnabled && groupMappings.rules && Array.isArray(groupMappings.rules) && groupMappings.rules.length > 0)) {
                                        bestMappings = groupMappings;
                                    }
                                }
                            } catch (error) {
                                console.warn('STCL: Error getting group mappings:', error);
                            }
                        }
                        if (!bestMappings) {
                            try {
                                const chatMappings = this.getMappings('chat');
                                if (chatMappings && typeof chatMappings === 'object') {
                                    if (chatMappings.enableModelPromptLinks ||
                                        (isGloballyEnabled && chatMappings.rules && Array.isArray(chatMappings.rules) && chatMappings.rules.length > 0)) {
                                        bestMappings = chatMappings;
                                    }
                                }
                            } catch (error) {
                                console.warn('STCL: Error getting chat mappings:', error);
                            }
                        }
                    } else {
                        try {
                            const chatMappings = this.getMappings('chat');
                            if (chatMappings && typeof chatMappings === 'object') {
                                if (chatMappings.enableModelPromptLinks ||
                                    (isGloballyEnabled && chatMappings.rules && Array.isArray(chatMappings.rules) && chatMappings.rules.length > 0)) {
                                    bestMappings = chatMappings;
                                } else if (context.groupId) {
                                    const groupMappings = this.getMappings('group', context.groupId);
                                    if (groupMappings && typeof groupMappings === 'object') {
                                        if (groupMappings.enableModelPromptLinks ||
                                            (isGloballyEnabled && groupMappings.rules && Array.isArray(groupMappings.rules) && groupMappings.rules.length > 0)) {
                                            bestMappings = groupMappings;
                                        }
                                    }
                                }
                            }
                        } catch (error) {
                            console.warn('STCL: Error getting chat/group mappings:', error);
                        }
                    }
                }
            } else {
                // Single chat inheritance chain - prefer more specific settings for rules
                if (moduleSettings.preferCharacterOverChat) {
                    if (context.characterName) {
                        try {
                            const charMappings = this.getMappings('character', context.characterName);
                            if (charMappings && typeof charMappings === 'object') {
                                if (charMappings.enableModelPromptLinks ||
                                    (isGloballyEnabled && charMappings.rules && Array.isArray(charMappings.rules) && charMappings.rules.length > 0)) {
                                    bestMappings = charMappings;
                                }
                            }
                        } catch (error) {
                            console.warn('STCL: Error getting character mappings:', error);
                        }
                    }
                    if (!bestMappings) {
                        try {
                            const chatMappings = this.getMappings('chat');
                            if (chatMappings && typeof chatMappings === 'object') {
                                if (chatMappings.enableModelPromptLinks ||
                                    (isGloballyEnabled && chatMappings.rules && Array.isArray(chatMappings.rules) && chatMappings.rules.length > 0)) {
                                    bestMappings = chatMappings;
                                }
                            }
                        } catch (error) {
                            console.warn('STCL: Error getting chat mappings:', error);
                        }
                    }
                } else {
                    try {
                        const chatMappings = this.getMappings('chat');
                        if (chatMappings && typeof chatMappings === 'object') {
                            if (chatMappings.enableModelPromptLinks ||
                                (isGloballyEnabled && chatMappings.rules && Array.isArray(chatMappings.rules) && chatMappings.rules.length > 0)) {
                                bestMappings = chatMappings;
                            } else if (context.characterName) {
                                const charMappings = this.getMappings('character', context.characterName);
                                if (charMappings && typeof charMappings === 'object') {
                                    if (charMappings.enableModelPromptLinks ||
                                        (isGloballyEnabled && charMappings.rules && Array.isArray(charMappings.rules) && charMappings.rules.length > 0)) {
                                        bestMappings = charMappings;
                                    }
                                }
                            }
                        }
                    } catch (error) {
                        console.warn('STCL: Error getting chat/character mappings:', error);
                    }
                }
            }

            // If we found scope-specific mappings, use them but ensure enableModelPromptLinks reflects global state
            if (bestMappings) {
                const resultMappings = deepMerge({}, bestMappings);
                // If globally enabled, override local disable
                if (isGloballyEnabled && !resultMappings.enableModelPromptLinks) {
                    resultMappings.enableModelPromptLinks = true;
                }
                return resultMappings;
            }

            // Fall back to global mappings
            return globalMappings;

        } catch (error) {
            console.error('STCL: Error in getMappingsWithInheritance:', error);
            // Return a safe fallback
            return this.getDefaultMappings();
        }
    }

    /**
     * Tests a Boolean condition against a model name
     * @param {string} condition - The Boolean condition to test
     * @param {string} modelName - The model name to test against
     * @returns {boolean} True if condition matches
     */
    testCondition(condition, modelName) {
        if (!condition || typeof condition !== 'string') {
            return false;
        }
        if (!modelName || typeof modelName !== 'string') {
            return false;
        }

        try {
            return this.evaluator.evaluate(condition, modelName);
        } catch (error) {
            console.warn('STCL: Error testing condition:', error);
            return false;
        }
    }

    /**
     * Gets predefined rule templates for UI
     * @returns {Array} Array of predefined rule templates
     */
    getPredefinedRules() {
        return PREDEFINED_RULES.map(rule => deepMerge({}, rule)); // Deep copy using ST utility
    }

    /**
     * Adds or updates a custom rule
     * @param {Object} rule - The rule to add/update
     * @param {string} context - The context to save to
     * @param {string} id - The character/group ID if applicable
     * @returns {boolean} True if successful
     */
    addOrUpdateRule(rule, context = 'global', id = null) {
        if (!rule || typeof rule !== 'object') {
            throw new Error('Invalid rule object provided');
        }
        if (!rule.id || typeof rule.id !== 'string') {
            throw new Error('Rule must have a valid ID');
        }

        try {
            const mappings = this.getMappings(context, id) || this.getDefaultMappings();

            if (!mappings.rules) {
                mappings.rules = [];
            }

            // Find existing rule by ID
            const existingIndex = mappings.rules.findIndex(r => r.id === rule.id);

            if (existingIndex >= 0) {
                // Update existing rule
                mappings.rules[existingIndex] = deepMerge({}, rule);
            } else {
                // Add new rule
                mappings.rules.push(deepMerge({}, rule));
            }

            return this.setMappings(mappings, context, id);
        } catch (error) {
            console.error('STCL: Error adding/updating rule:', error);
            return false;
        }
    }

    /**
     * Removes a rule by ID
     * @param {string} ruleId - The ID of the rule to remove
     * @param {string} context - The context to remove from
     * @param {string} id - The character/group ID if applicable
     * @returns {boolean} True if successful
     */
    removeRule(ruleId, context = 'global', id = null) {
        if (!ruleId || typeof ruleId !== 'string') {
            throw new Error('Invalid rule ID provided');
        }

        try {
            const mappings = this.getMappings(context, id);
            if (!mappings || !mappings.rules) {
                return false;
            }

            const initialLength = mappings.rules.length;
            mappings.rules = mappings.rules.filter(rule => rule.id !== ruleId);

            if (mappings.rules.length < initialLength) {
                return this.setMappings(mappings, context, id);
            }

            return false; // Rule not found
        } catch (error) {
            console.error('STCL: Error removing rule:', error);
            return false;
        }
    }
}