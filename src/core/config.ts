/**
 * Enhanced Configuration Manager with Persistence
 * Refactored to use async initialization pattern
 */

import dotenv from 'dotenv';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { homedir } from 'os';
import type { OpenManConfig, AIProvider, WebAIConfig, AIServiceConfig } from '@/types';
import { Logger } from '@/utils/logger';

dotenv.config();

const log = Logger.getInstance({ moduleName: 'CFG' }).createModuleLogger('CFG');

const CONFIG_FILE = path.join(homedir(), '.openman', 'config.json');
const WEBAI_FILE = path.join(homedir(), '.openman', 'webai.json');

export class ConfigManager {
  private config: OpenManConfig;
  private persistedConfig: Partial<OpenManConfig> = {};
  private webAIs: WebAIConfig[] = [];
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.config = this.loadConfig();
    // Start async initialization but don't wait
    this.initPromise = this.initialize();
  }

  /**
   * Ensure initialization is complete before operations
   */
  public async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  /**
   * Async initialization
   */
  private async initialize(): Promise<void> {
    log.debug('Initializing config manager...');
    await Promise.all([
      this.loadPersistedConfig(),
      this.loadWebAIs(),
    ]);
    this.initialized = true;
    log.info('Config manager initialized');
  }

  private loadConfig(): OpenManConfig {
    return {
      ai: {
        openai: process.env.OPENAI_API_KEY
          ? {
              apiKey: process.env.OPENAI_API_KEY,
              model: 'gpt-4',
              maxTokens: 4000,
              temperature: 0.7,
            }
          : undefined,
        anthropic: process.env.ANTHROPIC_API_KEY
          ? {
              apiKey: process.env.ANTHROPIC_API_KEY,
              model: 'claude-3-opus-20240229',
              maxTokens: 4000,
              temperature: 0.7,
            }
          : undefined,
        google: process.env.GOOGLE_API_KEY
          ? {
              apiKey: process.env.GOOGLE_API_KEY,
              model: 'gemini-pro',
              maxTokens: 4000,
              temperature: 0.7,
            }
          : undefined,
        defaultProvider: this.getProvider(process.env.DEFAULT_PROVIDER),
      },
      browser: {
        headless: process.env.BROWSER_HEADLESS !== 'false',
        executablePath: process.env.BROWSER_EXECUTABLE_PATH,
        userDataDir: process.env.BROWSER_DATA_DIR || '~/.openman/browser',
        viewport: {
          width: 1920,
          height: 1080,
        },
      },
      permissions: {
        web: {
          browsing: this.parsePermission(process.env.PERMISSION_WEB_BROWSING) || 'ask',
          forms: this.parsePermission(process.env.PERMISSION_WEB_FORMS) || 'ask',
          payments: this.parsePermission(process.env.PERMISSION_WEB_PAYMENTS) || 'never',
          sensitive: this.parsePermission(process.env.PERMISSION_WEB_SENSITIVE) || 'explicit',
        },
        local: {
          read: this.parsePermission(process.env.PERMISSION_LOCAL_READ) || 'workspace',
          write: this.parsePermission(process.env.PERMISSION_LOCAL_WRITE) || 'ask',
          execute: this.parsePermission(process.env.PERMISSION_LOCAL_EXECUTE) || 'sandboxed',
          system: this.parsePermission(process.env.PERMISSION_LOCAL_SYSTEM) || 'never',
        },
        ai: {
          openai: 'always',
          anthropic: 'always',
          google: 'ask',
        },
      },
      server: {
        port: parseInt(process.env.PORT || '3000', 10),
        host: process.env.HOST || 'localhost',
      },
      debug: {
        enabled: process.env.DEBUG === 'true',
        verbose: process.env.VERBOSE === 'true',
      },
    };
  }

  private async loadPersistedConfig(): Promise<void> {
    try {
      const content = await fs.readFile(CONFIG_FILE, 'utf-8');
      this.persistedConfig = JSON.parse(content);
      
      // Merge persisted config with default config
      this.config = this.mergeConfigs(this.config, this.persistedConfig);
      log.debug('Loaded persisted config');
    } catch {
      // File doesn't exist yet, that's ok
      log.debug('No persisted configuration found, using defaults');
    }
  }

  private mergeConfigs(base: OpenManConfig, override: Partial<OpenManConfig>): OpenManConfig {
    const result = { ...base };

    for (const key in override) {
      const overrideValue = override[key as keyof OpenManConfig];
      const baseValue = base[key as keyof OpenManConfig];

      if (typeof overrideValue === 'object' && overrideValue !== null && !Array.isArray(overrideValue)) {
        (result as Record<string, unknown>)[key] = { ...(baseValue as object), ...(overrideValue as object) };
      } else if (overrideValue !== undefined) {
        (result as Record<string, unknown>)[key] = overrideValue;
      }
    }

    return result;
  }

  private getProvider(provider?: string): AIProvider {
    const providers: AIProvider[] = ['openai', 'anthropic', 'google', 'custom'];
    return providers.includes(provider as AIProvider)
      ? (provider as AIProvider)
      : 'openai';
  }

  private parsePermission(value?: string): 'always' | 'ask' | 'never' | 'explicit' | undefined {
    const permissions = ['always', 'ask', 'never', 'explicit'];
    if (!value) return undefined;
    return permissions.includes(value) ? (value as 'always' | 'ask' | 'never' | 'explicit') : undefined;
  }

  /**
   * Get configuration value
   */
  public get<K extends keyof OpenManConfig>(key: K): OpenManConfig[K] {
    return this.config[key];
  }

  /**
   * Set configuration value (in-memory)
   */
  public set<K extends keyof OpenManConfig>(
    key: K,
    value: OpenManConfig[K]
  ): void {
    this.config[key] = value;
  }

  /**
   * Get all configuration
   */
  public getAll(): OpenManConfig {
    return { ...this.config };
  }

  /**
   * Get AI provider config
   */
  public getAIProvider(provider: AIProvider): AIServiceConfig | undefined {
    switch (provider) {
      case 'openai':
        return this.config.ai.openai;
      case 'anthropic':
        return this.config.ai.anthropic;
      case 'google':
        return this.config.ai.google;
      default:
        return undefined;
    }
  }

  /**
   * Set default AI provider
   */
  public setDefaultProvider(provider: AIProvider): void {
    this.config.ai.defaultProvider = provider;
  }

  /**
   * Set permission
   */
  public setPermission(
    category: 'web' | 'local' | 'ai',
    action: string,
    permission: 'always' | 'ask' | 'never' | 'explicit'
  ): void {
    (this.config.permissions[category] as Record<string, string>)[action] = permission;
  }

  /**
   * Save configuration to file
   */
  public async save(): Promise<void> {
    const configDir = path.dirname(CONFIG_FILE);
    await fs.mkdir(configDir, { recursive: true });

    const configToSave: Partial<OpenManConfig> = {
      ai: this.config.ai,
      browser: this.config.browser,
      permissions: this.config.permissions,
      server: this.config.server,
      debug: this.config.debug,
    };

    await fs.writeFile(CONFIG_FILE, JSON.stringify(configToSave, null, 2), 'utf-8');
    log.info(`Configuration saved to ${CONFIG_FILE}`);
  }

  /**
   * Reset configuration to defaults
   */
  public async reset(): Promise<void> {
    log.info('Resetting configuration to defaults');
    this.config = this.loadConfig();
    await this.save();
  }

  /**
   * Validate configuration
   */
  public validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check if at least one AI provider is configured
    const hasAIProvider = Object.values(this.config.ai).some(
      (provider) => provider && typeof provider === 'object' && 'apiKey' in provider
    );

    if (!hasAIProvider) {
      errors.push('No AI provider configured. Please set at least one API key.');
    }

    // Check browser config
    if (this.config.browser.headless === undefined) {
      errors.push('Browser headless mode is not configured');
    }

    // Check server config
    if (!this.config.server.port || this.config.server.port <= 0) {
      errors.push('Server port is not valid');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Export configuration
   */
  public export(includeSecrets: boolean = false): string {
    const configToExport = { ...this.config };

    if (!includeSecrets) {
      // Mask API keys
      if (configToExport.ai.openai?.apiKey) {
        configToExport.ai.openai.apiKey = '***MASKED***';
      }
      if (configToExport.ai.anthropic?.apiKey) {
        configToExport.ai.anthropic.apiKey = '***MASKED***';
      }
      if (configToExport.ai.google?.apiKey) {
        configToExport.ai.google.apiKey = '***MASKED***';
      }
    }

    return JSON.stringify(configToExport, null, 2);
  }

  /**
   * Import configuration
   */
  public async import(configData: string, override: boolean = false): Promise<void> {
    try {
      const imported = JSON.parse(configData) as Partial<OpenManConfig>;

      if (override) {
        this.config = this.mergeConfigs(this.loadConfig(), imported);
      } else {
        this.config = this.mergeConfigs(this.config, imported);
      }

      await this.save();
    } catch {
      throw new Error('Invalid configuration data');
    }
  }

  /**
   * Get configuration file path
   */
  public getConfigPath(): string {
    return CONFIG_FILE;
  }

  // ============================================================================
  // Web AI Configuration Management
  // ============================================================================

  /**
   * Load Web AI configurations from file
   */
  private async loadWebAIs(): Promise<void> {
    try {
      if (fsSync.existsSync(WEBAI_FILE)) {
        const content = await fs.readFile(WEBAI_FILE, 'utf-8');
        this.webAIs = JSON.parse(content);
        
        // Also merge into config
        this.config.ai.webAI = this.webAIs;
        log.debug(`Loaded ${this.webAIs.length} Web AI configs`);
      }
    } catch {
      // File doesn't exist or is invalid
      this.webAIs = [];
      log.debug('No Web AI configs found');
    }
  }

  /**
   * Add a Web AI configuration
   */
  public async addWebAI(config: WebAIConfig): Promise<void> {
    // Check for duplicate name
    if (this.webAIs.some(ai => ai.name === config.name)) {
      throw new Error(`Web AI with name "${config.name}" already exists`);
    }

    this.webAIs.push(config);
    this.config.ai.webAI = this.webAIs;
    await this.saveWebAIs();
    log.info(`Added Web AI: ${config.name}`);
  }

  /**
   * Update a Web AI configuration
   */
  public async updateWebAI(name: string, config: Partial<WebAIConfig>): Promise<void> {
    const index = this.webAIs.findIndex(ai => ai.name === name);
    if (index === -1) {
      throw new Error(`Web AI "${name}" not found`);
    }

    this.webAIs[index] = { ...this.webAIs[index], ...config };
    this.config.ai.webAI = this.webAIs;
    await this.saveWebAIs();
    log.info(`Updated Web AI: ${name}`);
  }

  /**
   * Remove a Web AI configuration
   */
  public async removeWebAI(name: string): Promise<void> {
    const index = this.webAIs.findIndex(ai => ai.name === name);
    if (index === -1) {
      throw new Error(`Web AI "${name}" not found`);
    }

    this.webAIs.splice(index, 1);
    this.config.ai.webAI = this.webAIs;
    await this.saveWebAIs();
    log.info(`Removed Web AI: ${name}`);
  }

  /**
   * Get a Web AI configuration
   */
  public getWebAI(name: string): WebAIConfig | undefined {
    return this.webAIs.find(ai => ai.name === name);
  }

  /**
   * List all Web AI configurations
   */
  public listWebAIs(): WebAIConfig[] {
    return [...this.webAIs];
  }

  /**
   * Save Web AI configurations to file
   */
  private async saveWebAIs(): Promise<void> {
    const configDir = path.dirname(WEBAI_FILE);
    await fs.mkdir(configDir, { recursive: true });
    await fs.writeFile(WEBAI_FILE, JSON.stringify(this.webAIs, null, 2), 'utf-8');
  }

  /**
   * Get Web AI config file path
   */
  public getWebAIPath(): string {
    return WEBAI_FILE;
  }
}

// Singleton instance - initialize lazily
let configInstance: ConfigManager | null = null;

/**
 * Get the config instance (creates if not exists)
 */
export function getConfig(): ConfigManager {
  if (!configInstance) {
    configInstance = new ConfigManager();
  }
  return configInstance;
}

/**
 * Initialize config and wait for ready
 */
export async function initConfig(): Promise<ConfigManager> {
  const instance = getConfig();
  await instance.ensureInitialized();
  return instance;
}

// Export for backward compatibility
export const config = new ConfigManager();
