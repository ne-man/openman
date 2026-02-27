/**
 * Enhanced Configuration Manager with Persistence
 */

import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import type { OpenManConfig, AIProvider } from '@/types';

dotenv.config();

const CONFIG_FILE = path.join(homedir(), '.openman', 'config.json');

export class ConfigManager {
  private config: OpenManConfig;
  private persistedConfig: Partial<OpenManConfig> = {};

  constructor() {
    this.config = this.loadConfig();
    this.loadPersistedConfig();
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
    } catch (error) {
      // File doesn't exist yet, that's ok
      console.log('No persisted configuration found');
    }
  }

  private mergeConfigs(base: OpenManConfig, override: Partial<OpenManConfig>): OpenManConfig {
    const result = { ...base };

    for (const key in override) {
      const overrideValue = (override as any)[key];
      const baseValue = (base as any)[key];

      if (typeof overrideValue === 'object' && overrideValue !== null && !Array.isArray(overrideValue)) {
        result[key as keyof OpenManConfig] = { ...baseValue, ...overrideValue };
      } else {
        result[key as keyof OpenManConfig] = overrideValue as any;
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
    return permissions.includes(value) ? (value as any) : undefined;
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
  public getAIProvider(provider: AIProvider) {
    const providerKey = provider as keyof typeof this.config.ai;
    return this.config.ai[providerKey];
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
    (this.config.permissions[category] as any)[action] = permission;
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
    console.log(`Configuration saved to ${CONFIG_FILE}`);
  }

  /**
   * Reset configuration to defaults
   */
  public async reset(): Promise<void> {
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
    } catch (error) {
      throw new Error('Invalid configuration data');
    }
  }

  /**
   * Get configuration file path
   */
  public getConfigPath(): string {
    return CONFIG_FILE;
  }
}

// Singleton instance
export const config = new ConfigManager();
