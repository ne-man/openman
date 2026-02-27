/**
 * Configuration manager for OpenMan
 */

import dotenv from 'dotenv';
import { conf } from 'pkg-types';
import type { OpenManConfig, AIProvider } from '@/types';

dotenv.config();

export class ConfigManager {
  private config: OpenManConfig;

  constructor() {
    this.config = this.loadConfig();
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

  public get<K extends keyof OpenManConfig>(key: K): OpenManConfig[K] {
    return this.config[key];
  }

  public set<K extends keyof OpenManConfig>(
    key: K,
    value: OpenManConfig[K]
  ): void {
    this.config[key] = value;
  }

  public getAll(): OpenManConfig {
    return { ...this.config };
  }

  public getAIProvider(provider: AIProvider) {
    const providerKey = provider as keyof typeof this.config.ai;
    return this.config.ai[providerKey];
  }
}

// Singleton instance
export const config = new ConfigManager();
