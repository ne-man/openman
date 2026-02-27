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
  private activePage: import('puppeteer').Page | null = null;
  private activeConfig: WebAIConfig | null = null;
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

    // Input content using CDP insertText (paste-like, no key events)
    const inputSelector = config.inputSelector || 'textarea';
    await page.click(inputSelector);
    
    // Clear existing content first
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    
    // Use CDP to insert text at once (like paste)
    const client = await page.createCDPSession();
    await client.send('Input.insertText', { text: lastUserMessage.content });
    await client.detach();

    // Wait for content to be processed
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Press Enter to submit
    await page.keyboard.press('Enter');

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
   * Send a query with an image to a Web AI
   */
  public async queryWithImage(configName: string, imagePath: string, query: string): Promise<string> {
    await this.ensureInitialized();

    const config = this.configs.get(configName);
    if (!config) {
      throw new Error(`Web AI config not found: ${configName}`);
    }

    // Navigate to the AI service
    const { page } = await this.browserEngine!.navigate(config.url);

    // Wait for page to load
    await page.waitForSelector(config.inputSelector || 'textarea', {
      timeout: 15000,
    });
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Check for verification dialogs
    await this.handleVerificationDialog(page);

    // Common image upload selectors for different AI services
    const imageUploadSelectors = [
      'input[type="file"]',
      '[data-testid="image-upload"]',
      '[class*="upload"] input[type="file"]',
      'button[aria-label*="图片"], button[aria-label*="image"], button[aria-label*="上传"]',
      '[class*="attach"] input[type="file"]',
    ];

    let uploaded = false;

    // Try to find and use file input
    for (const selector of imageUploadSelectors) {
      try {
        const fileInput = await page.$(selector);
        if (fileInput) {
          const tagName = await fileInput.evaluate((el: Element) => el.tagName.toLowerCase());
          if (tagName === 'input') {
            // Direct file input
            await (fileInput as import('puppeteer').ElementHandle<HTMLInputElement>).uploadFile(imagePath);
            uploaded = true;
            console.log('  📷 图片已上传');
            break;
          }
        }
      } catch {
        continue;
      }
    }

    // If no file input found, try clicking upload button first
    if (!uploaded) {
      const uploadButtonSelectors = [
        'button[aria-label*="图片"]',
        'button[aria-label*="上传"]',
        'button[aria-label*="image"]',
        'button[aria-label*="upload"]',
        '[class*="image-upload"]',
        '[class*="upload-btn"]',
        '[data-testid*="upload"]',
      ];

      for (const selector of uploadButtonSelectors) {
        try {
          await page.click(selector);
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Now look for file input that may have appeared
          const fileInput = await page.$('input[type="file"]');
          if (fileInput) {
            await (fileInput as import('puppeteer').ElementHandle<HTMLInputElement>).uploadFile(imagePath);
            uploaded = true;
            console.log('  📷 图片已上传');
            break;
          }
        } catch {
          continue;
        }
      }
    }

    if (!uploaded) {
      console.log('  ⚠️ 未找到图片上传入口，将只发送文本');
    }

    // Wait for upload to process
    if (uploaded) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Input query using CDP insertText (paste-like)
    const inputSelector = config.inputSelector || 'textarea';
    await page.click(inputSelector);
    
    // Clear and insert text at once
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    
    const client = await page.createCDPSession();
    await client.send('Input.insertText', { text: query });
    await client.detach();

    // Wait then submit
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.keyboard.press('Enter');

    // Wait for response
    const responseSelector = config.responseSelector || '.response';
    const initialCount = await page.$$eval(responseSelector, els => els.length);

    await page.waitForFunction(
      (selector: string, count: number) => {
        const elements = document.querySelectorAll(selector);
        return elements.length > count;
      },
      { timeout: config.responseTimeout || 120000 },
      responseSelector,
      initialCount
    );

    // Wait for AI to finish responding (check for loading indicators)
    await this.waitForResponseComplete(page, responseSelector);

    // Get response
    const responseText = await page.$$eval(responseSelector, (els) => {
      const lastEl = els[els.length - 1];
      return lastEl ? lastEl.textContent || '' : '';
    });

    // Save page for follow-up questions
    this.activePage = page;
    this.activeConfig = config;

    return responseText.trim();
  }

  /**
   * Wait for AI response to complete (not still generating)
   */
  private async waitForResponseComplete(page: import('puppeteer').Page, responseSelector: string): Promise<void> {
    // Wait initial time for response to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check if still generating by watching for content changes
    let lastContent = '';
    let stableCount = 0;
    const maxWait = 60; // 60 seconds max

    for (let i = 0; i < maxWait; i++) {
      const currentContent = await page.$$eval(responseSelector, (els) => {
        const lastEl = els[els.length - 1];
        return lastEl ? lastEl.textContent || '' : '';
      });

      if (currentContent === lastContent && currentContent.length > 0) {
        stableCount++;
        if (stableCount >= 3) {
          // Content stable for 3 seconds, consider complete
          break;
        }
      } else {
        stableCount = 0;
        lastContent = currentContent;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /**
   * Send a follow-up question in the same conversation
   */
  public async followUp(question: string): Promise<string> {
    if (!this.activePage || !this.activeConfig) {
      throw new Error('No active conversation. Start with queryWithImage first.');
    }

    const page = this.activePage;
    const config = this.activeConfig;

    // Check for verification dialogs
    await this.handleVerificationDialog(page);

    // Input follow-up using CDP insertText (paste-like)
    const inputSelector = config.inputSelector || 'textarea';
    await page.click(inputSelector);
    
    // Clear and insert text at once
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    
    const client = await page.createCDPSession();
    await client.send('Input.insertText', { text: question });
    await client.detach();

    // Get current response count
    const responseSelector = config.responseSelector || '.response';
    const initialCount = await page.$$eval(responseSelector, els => els.length);

    // Wait then submit
    await new Promise(resolve => setTimeout(resolve, 1000));
    await page.keyboard.press('Enter');

    // Wait for new response
    await page.waitForFunction(
      (selector: string, count: number) => {
        const elements = document.querySelectorAll(selector);
        return elements.length > count;
      },
      { timeout: config.responseTimeout || 120000 },
      responseSelector,
      initialCount
    );

    // Wait for response to complete
    await this.waitForResponseComplete(page, responseSelector);

    // Get response
    const responseText = await page.$$eval(responseSelector, (els) => {
      const lastEl = els[els.length - 1];
      return lastEl ? lastEl.textContent || '' : '';
    });

    return responseText.trim();
  }

  /**
   * Check if there's an active conversation
   */
  public hasActiveConversation(): boolean {
    return this.activePage !== null && this.activeConfig !== null;
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
