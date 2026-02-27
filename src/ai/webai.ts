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
      // Check if CHROME_DEBUG_PORT is set to connect to existing Chrome
      const debugPort = process.env.CHROME_DEBUG_PORT 
        ? parseInt(process.env.CHROME_DEBUG_PORT, 10) 
        : undefined;

      if (debugPort) {
        // Connect to existing Chrome with remote debugging
        this.browserEngine = new BrowserEngine({
          headless: false,
          debuggingPort: debugPort,
        });
      } else {
        // Launch new browser with persistent data
        this.browserEngine = new BrowserEngine({
          headless: false,
          userDataDir: process.env.BROWSER_DATA_DIR || '~/.openman/browser',
        });
      }
      await this.browserEngine.initialize();
      this.initialized = true;
    }
  }

  /**
   * Check for and handle verification/captcha dialogs
   */
  private async handleVerificationDialog(page: import('puppeteer').Page): Promise<void> {
    // Common verification dialog selectors
    const verificationSelectors = [
      '[class*="captcha"]',
      '[class*="verify"]',
      '[class*="verification"]',
      '[id*="captcha"]',
      '[id*="verify"]',
      'iframe[src*="captcha"]',
      '[class*="slider"]',
      '[class*="puzzle"]',
      '.modal[class*="security"]',
      '[data-testid*="captcha"]',
    ];

    for (const selector of verificationSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const isVisible = await element.evaluate((el: Element) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
          });

          if (isVisible) {
            console.log('\n⚠️  验证弹框检测到，请在浏览器中完成验证...');
            console.log('   完成后程序将自动继续\n');

            // Wait for verification to be completed (dialog disappears)
            await page.waitForFunction(
              (sel: string) => {
                const el = document.querySelector(sel);
                if (!el) return true;
                const style = window.getComputedStyle(el);
                return style.display === 'none' || style.visibility === 'hidden';
              },
              { timeout: 300000 }, // 5 minutes for manual verification
              selector
            );

            console.log('✓ 验证完成，继续执行...\n');
            await new Promise(resolve => setTimeout(resolve, 1000));
            return;
          }
        }
      } catch {
        // Selector not found or timeout, continue
      }
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

    // Wait for page to fully load
    await page.waitForSelector(config.inputSelector || 'textarea', {
      timeout: 15000,
    });
    
    // Extra wait for dynamic content
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check for verification/captcha dialogs
    await this.handleVerificationDialog(page);

    // Focus and type the message
    const inputSelector = config.inputSelector || 'textarea';
    await page.click(inputSelector);
    await page.type(inputSelector, lastUserMessage.content, {
      delay: 30,
    });

    // Wait a bit before clicking submit
    await new Promise(resolve => setTimeout(resolve, 500));

    // Try to submit - use keyboard Enter as fallback
    try {
      const submitSelector = config.submitSelector || 'button[type="submit"]';
      await page.waitForSelector(submitSelector, { timeout: 3000 });
      await page.click(submitSelector);
    } catch {
      // Fallback: press Enter to submit
      await page.keyboard.press('Enter');
    }

    // Wait for AI response
    const responseSelector = config.responseSelector || '.response';
    
    // Count existing messages before waiting
    const initialCount = await page.$$eval(responseSelector, els => els.length);
    
    // Wait for a new response to appear (more elements than before)
    await page.waitForFunction(
      (selector: string, count: number) => {
        const elements = document.querySelectorAll(selector);
        return elements.length > count;
      },
      { timeout: config.responseTimeout || 60000 },
      responseSelector,
      initialCount
    );

    // Wait a bit for response to finish streaming
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get the last response element (AI's reply)
    const responseText = await page.$$eval(responseSelector, (els) => {
      const lastEl = els[els.length - 1];
      return lastEl ? lastEl.textContent || '' : '';
    });

    if (!responseText) {
      throw new Error('Response element not found');
    }

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
