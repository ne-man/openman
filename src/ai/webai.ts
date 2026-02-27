/**
 * Web AI Service - Interact with AI services through browser automation
 */

import type { WebAIConfig, AIMessage, AIResponse, AIProvider } from '@/types';
import { BrowserEngine } from '@/browser/engine';
import { auditLogger } from '@/core/audit';
import path from 'path';
import { homedir } from 'os';

/**
 * Default selectors for popular AI services
 */
const DEFAULT_SELECTORS: Record<string, Partial<WebAIConfig>> = {
  'chat.openai.com': {
    inputSelector: 'textarea[placeholder*="Message"]',
    submitSelector: 'button[data-testid="send-button"]',
    responseSelector: '[data-message-author-role="assistant"]',
    responseTimeout: 60000,
  },
  'claude.ai': {
    inputSelector: 'div[contenteditable="true"]',
    submitSelector: 'button[aria-label="Send Message"]',
    responseSelector: '.prose',
    responseTimeout: 60000,
  },
  'gemini.google.com': {
    inputSelector: 'textarea',
    submitSelector: 'button[aria-label="Send message"]',
    responseSelector: '.response-content',
    responseTimeout: 60000,
  },
  'copilot.microsoft.com': {
    inputSelector: 'textarea',
    submitSelector: 'button[type="submit"]',
    responseSelector: '.answer-content',
    responseTimeout: 60000,
  },
  'poe.com': {
    inputSelector: 'textarea',
    submitSelector: 'button[aria-label="Send"]',
    responseSelector: '.message-content',
    responseTimeout: 60000,
  },
  'doubao.com': {
    inputSelector: 'textarea',
    submitSelector: 'button, [class*="send"], [class*="submit"]',
    responseSelector: '[class*="message"], [class*="response"], [class*="answer"]',
    responseTimeout: 60000,
  },
};

export class WebAIService {
  private configs: Map<string, WebAIConfig> = new Map();
  private browserEngine: BrowserEngine | null = null;
  private initialized = false;
  private chromeUserDataDir: string;

  constructor() {
    // Chrome user data directory on Linux
    this.chromeUserDataDir = path.join(homedir(), '.config', 'google-chrome', 'Default');
  }

  /**
   * Ensure browser is initialized with Chrome session
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized || !this.browserEngine) {
      // Try to use Chrome's user data directory to preserve login
      const launchOptions: any = {
        headless: false, // Need non-headless to see browser
        args: [
          `--user-data-dir=${this.chromeUserDataDir}`,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
        ],
      };

      // Try to connect to existing Chrome instance first
      try {
        // Check if Chrome is running with remote debugging
        const { execSync } = require('child_process');
        const isChromeRunning = execSync('pgrep -x "chrome" || pgrep -x "google-chrome" || echo "not running"', {
          encoding: 'utf-8',
        }).includes('chrome');

        if (isChromeRunning) {
          launchOptions.headless = false;
        }
      } catch {
        // Chrome not running, will start new instance
      }

      this.browserEngine = new BrowserEngine({
        headless: launchOptions.headless,
        userDataDir: this.chromeUserDataDir,
      });
      
      await this.browserEngine.initialize();
      this.initialized = true;
    }
  }

  /**
   * Add a Web AI configuration
   */
  public addConfig(config: WebAIConfig): void {
    // Merge with default selectors if available
    const domain = this.extractDomain(config.url);
    const defaultConfig = DEFAULT_SELECTORS[domain];

    const mergedConfig: WebAIConfig = {
      ...defaultConfig,
      ...config,
    };

    this.configs.set(config.name, mergedConfig);
  }

  /**
   * Remove a Web AI configuration
   */
  public removeConfig(name: string): boolean {
    return this.configs.delete(name);
  }

  /**
   * Get a Web AI configuration
   */
  public getConfig(name: string): WebAIConfig | undefined {
    return this.configs.get(name);
  }

  /**
   * List all Web AI configurations
   */
  public listConfigs(): WebAIConfig[] {
    return Array.from(this.configs.values());
  }

  /**
   * Send a message to a Web AI and get response
   */
  public async chat(
    configName: string,
    messages: AIMessage[]
  ): Promise<AIResponse> {
    await this.ensureInitialized();

    const config = this.configs.get(configName);
    if (!config) {
      throw new Error(`Web AI config not found: ${configName}`);
    }

    // Log the action
    await auditLogger.log({
      timestamp: new Date(),
      action: 'webai.chat',
      details: {
        configName,
        url: config.url,
        messageCount: messages.length,
      },
      result: 'success',
      riskLevel: 'low',
    });

    // Get the last user message
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUserMessage) {
      throw new Error('No user message found');
    }

    // Navigate to the AI service
    const { page } = await this.browserEngine!.navigate(config.url);

    // Wait for page to load
    const inputSelector = config.inputSelector || 'textarea';
    await page.waitForSelector(inputSelector, {
      timeout: 15000,
    });

    // Type the message
    await page.type(inputSelector, lastUserMessage.content, {
      delay: 30,
    });

    // Press Enter to submit
    await page.keyboard.press('Enter');

    // Wait for response - poll for new content
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Get page content for response
    const responseText = await page.evaluate(() => {
      // Try to find response content
      const selectors = [
        '[class*="message"]',
        '[class*="response"]', 
        '[class*="answer"]',
        '[class*="content"]',
        '.prose',
        'body'
      ];
      
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent && el.textContent.length > 50) {
          return el.textContent;
        }
      }
      return document.body.innerText;
    });

    return {
      content: responseText.trim(),
      model: config.name,
      provider: 'webai' as AIProvider,
    };
  }

  /**
   * Send a simple query to a Web AI
   */
  public async query(configName: string, query: string): Promise<string> {
    const response = await this.chat(configName, [
      { role: 'user', content: query, timestamp: new Date() },
    ]);
    return response.content;
  }

  /**
   * Close browser
   */
  public async close(): Promise<void> {
    if (this.browserEngine) {
      await this.browserEngine.close();
      this.browserEngine = null;
      this.initialized = false;
    }
  }

  /**
   * Extract domain from URL
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return '';
    }
  }
}

// Singleton instance
export const webAIService = new WebAIService();
