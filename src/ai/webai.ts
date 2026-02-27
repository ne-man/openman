/**
 * Web AI Service - Interact with AI services through browser automation
 */

import type { WebAIConfig, AIMessage, AIResponse, AIProvider } from '@/types';
import { BrowserEngine } from '@/browser/engine';
import { auditLogger } from '@/core/audit';
import chalk from 'chalk';
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
  'yuanbao.tencent.com': {
    inputSelector: 'textarea, [contenteditable="true"]',
    submitSelector: 'button[class*="send"], button[type="submit"], [class*="submit"]',
    responseSelector: '[class*="message"], [class*="response"], [class*="answer"], [class*="content"]',
    responseTimeout: 60000,
    // 元宝用 + 号按钮上传图片
    imageUploadButton: '[class*="plus"], [class*="add"], button[aria-label*="+"], [class*="upload"]',
  },
};

/**
 * Default WebAI configurations
 */
const DEFAULT_WEBAIS: Array<{ name: string; url: string }> = [
  { name: 'doubao', url: 'https://www.doubao.com/chat/' },
  { name: 'yuanbao', url: 'https://yuanbao.tencent.com/chat' },
];

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
    if (this.initialized && this.browserEngine) {
      return; // Already initialized
    }

    // Try to initialize with retry logic
    const maxRetries = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        // Clean up any existing instance first
        if (this.browserEngine) {
          try {
            await this.browserEngine.close();
          } catch {
            // Ignore close errors
          }
          this.browserEngine = null;
          this.initialized = false;
        }

        // Check if CHROME_DEBUG_PORT is set
        const debugPort = process.env.CHROME_DEBUG_PORT 
          ? parseInt(process.env.CHROME_DEBUG_PORT, 10) 
          : undefined;

        if (debugPort) {
          this.browserEngine = new BrowserEngine({
            headless: false,
            debuggingPort: debugPort,
          });
        } else {
          this.browserEngine = new BrowserEngine({
            headless: false,
            userDataDir: process.env.BROWSER_DATA_DIR || '~/.openman/browser',
          });
        }

        await this.browserEngine.initialize();
        this.initialized = true;
        return; // Success

      } catch (error) {
        lastError = error as Error;
        console.log(`  ⚠️ Browser init attempt ${attempt + 1} failed, retrying...`);
        
        // Kill any stuck browser processes before retry
        if (attempt < maxRetries) {
          try {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);
            await execAsync('pkill -f "chromium|chrome" 2>/dev/null || true');
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    }

    throw lastError || new Error('Failed to initialize browser after retries');
  }

  /**
   * Check for and handle verification/captcha dialogs
   * Will try to ask another AI for help solving the verification
   */
  private async handleVerificationDialog(
    page: import('puppeteer').Page, 
    currentChannel?: string
  ): Promise<{ solved: boolean; method: 'ai' | 'human' | 'none' }> {
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

    let verificationDetected = false;
    let detectedSelector = '';

    for (const selector of verificationSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const isVisible = await element.evaluate((el: Element) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' &&
                   (el as HTMLElement).offsetWidth > 0 && (el as HTMLElement).offsetHeight > 0;
          });

          if (isVisible) {
            verificationDetected = true;
            detectedSelector = selector;
            break;
          }
        }
      } catch {
        continue;
      }
    }

    if (!verificationDetected) {
      return { solved: true, method: 'none' };
    }

    console.log(chalk.yellow('\n' + '='.repeat(50)));
    console.log(chalk.yellow('🔐 验证弹框检测到！'));
    console.log(chalk.yellow('='.repeat(50)));

    // Step 1: Take screenshot of verification dialog
    const screenshotDir = path.join(homedir(), '.openman', 'screenshots');
    const fs = await import('fs/promises');
    await fs.mkdir(screenshotDir, { recursive: true });
    const verifyScreenshotPath = path.join(screenshotDir, `verify-${Date.now()}.png`);
    
    await page.screenshot({ path: verifyScreenshotPath, fullPage: false });
    console.log(chalk.gray(`   📸 验证截图已保存: ${verifyScreenshotPath}`));

    // Step 2: Try to get help from another AI channel
    const otherChannels = this.getAvailableConfigs().filter(c => c !== currentChannel);
    
    if (otherChannels.length > 0) {
      console.log(chalk.cyan(`   🤖 请求 ${otherChannels[0]} 帮助分析验证...`));
      
      try {
        // Create a new browser instance for the helper AI
        const helperBrowser = new BrowserEngine({
          headless: false,
          userDataDir: process.env.BROWSER_DATA_DIR || path.join(homedir(), '.openman', 'browser-helper'),
        });
        await helperBrowser.initialize();

        const helperConfig = this.configs.get(otherChannels[0]);
        if (helperConfig) {
          const { page: helperPage } = await helperBrowser.navigate(helperConfig.url);
          
          await helperPage.waitForSelector(helperConfig.inputSelector || 'textarea', { timeout: 15000 });
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Upload verification screenshot and ask for help
          const helpPrompt = `这是一个验证弹框的截图，请分析并告诉我如何完成验证。
返回JSON格式:
{
  "type": "slider/puzzle/text/click",
  "description": "验证类型描述",
  "solution": "解决步骤",
  "canAutomate": true/false,
  "actions": [
    {"action": "drag", "from": {"x": 10, "y": 50}, "to": {"x": 90, "y": 50}},
    {"action": "click", "position": {"x": 50, "y": 50}}
  ]
}`;

          // Try to upload image
          const fileInputs = await helperPage.$$('input[type="file"]');
          let uploaded = false;
          for (const input of fileInputs) {
            try {
              await (input as import('puppeteer').ElementHandle<HTMLInputElement>).uploadFile(verifyScreenshotPath);
              uploaded = true;
              console.log(chalk.gray('   📷 验证截图已上传到帮助AI'));
              break;
            } catch { continue; }
          }

          if (uploaded) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }

          // Input help request
          const inputSelector = helperConfig.inputSelector || 'textarea';
          await helperPage.click(inputSelector);
          const client = await helperPage.createCDPSession();
          await client.send('Input.insertText', { text: helpPrompt });
          await client.detach();
          await new Promise(resolve => setTimeout(resolve, 1000));
          await helperPage.keyboard.press('Enter');

          // Wait for response
          const responseSelector = helperConfig.responseSelector || '.response';
          const initialCount = await helperPage.$$eval(responseSelector, els => els.length);
          
          await helperPage.waitForFunction(
            (sel: string, count: number) => document.querySelectorAll(sel).length > count,
            { timeout: 60000 },
            responseSelector,
            initialCount
          );

          await new Promise(resolve => setTimeout(resolve, 5000));

          const helpResponse = await helperPage.$$eval(responseSelector, (els) => {
            const lastEl = els[els.length - 1];
            return lastEl ? lastEl.textContent || '' : '';
          });

          console.log(chalk.cyan('\n   💡 AI 分析结果:'));
          
          // Try to parse and execute solution
          try {
            const jsonMatch = helpResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const solution = JSON.parse(jsonMatch[0]);
              console.log(chalk.white(`      类型: ${solution.type}`));
              console.log(chalk.white(`      描述: ${solution.description}`));
              console.log(chalk.white(`      可自动化: ${solution.canAutomate ? '是' : '否'}`));
              
              if (solution.canAutomate && solution.actions?.length > 0) {
                console.log(chalk.cyan('\n   🤖 尝试自动完成验证...'));
                
                for (const action of solution.actions) {
                  if (action.action === 'drag' && action.from && action.to) {
                    // Get viewport size
                    const viewport = page.viewport();
                    const width = viewport?.width || 1280;
                    const height = viewport?.height || 800;
                    
                    const fromX = (action.from.x / 100) * width;
                    const fromY = (action.from.y / 100) * height;
                    const toX = (action.to.x / 100) * width;
                    const toY = (action.to.y / 100) * height;
                    
                    await page.mouse.move(fromX, fromY);
                    await page.mouse.down();
                    await page.mouse.move(toX, toY, { steps: 20 });
                    await page.mouse.up();
                    console.log(chalk.gray(`      ↔️ 拖拽: (${fromX},${fromY}) -> (${toX},${toY})`));
                  } else if (action.action === 'click' && action.position) {
                    const viewport = page.viewport();
                    const width = viewport?.width || 1280;
                    const height = viewport?.height || 800;
                    
                    const x = (action.position.x / 100) * width;
                    const y = (action.position.y / 100) * height;
                    await page.click(`body`, { offset: { x, y } });
                    console.log(chalk.gray(`      👆 点击: (${x},${y})`));
                  }
                  await new Promise(resolve => setTimeout(resolve, 500));
                }

                // Check if verification is gone
                await new Promise(resolve => setTimeout(resolve, 2000));
                const stillVisible = await this.isVerificationRequired(page);
                
                if (!stillVisible) {
                  console.log(chalk.green('\n   ✅ AI 成功帮助完成验证！\n'));
                  await helperBrowser.close();
                  return { solved: true, method: 'ai' };
                }
              }
              
              // If can't automate, show solution for human
              console.log(chalk.yellow(`\n   📝 解决方案: ${solution.solution}`));
            }
          } catch (parseError) {
            console.log(chalk.gray(`      ${helpResponse.slice(0, 200)}...`));
          }

          await helperBrowser.close();
        }
      } catch (helperError: any) {
        console.log(chalk.yellow(`   ⚠️ 帮助AI失败: ${helperError.message?.slice(0, 50)}`));
      }
    }

    // Step 3: If AI couldn't solve, wait for human
    console.log(chalk.yellow('\n   ⏳ 需要人工完成验证...'));
    console.log(chalk.white('      请在浏览器中完成验证后，程序将自动继续\n'));

    try {
      await page.waitForFunction(
        (sel: string) => {
          const el = document.querySelector(sel);
          if (!el) return true;
          const style = window.getComputedStyle(el);
          return style.display === 'none' || style.visibility === 'hidden';
        },
        { timeout: 300000 }, // 5 minutes for manual verification
        detectedSelector
      );

      console.log(chalk.green('   ✅ 验证完成，继续执行...\n'));
      return { solved: true, method: 'human' };
    } catch {
      console.log(chalk.red('   ❌ 验证超时\n'));
      return { solved: false, method: 'human' };
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

    // Check for verification/captcha dialogs - pass configName for fallback
    await this.handleVerificationDialog(page, configName);

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

    // Check for verification dialogs - pass configName for fallback
    await this.handleVerificationDialog(page, configName);

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
      // 元宝用 + 号按钮，豆包用图片按钮
      const uploadButtonSelectors = [
        // 元宝 + 号按钮
        '[class*="plus"]',
        '[class*="add-btn"]',
        'button[class*="add"]',
        'svg[class*="plus"]',
        '[data-testid*="plus"]',
        // 通用图片上传按钮
        'button[aria-label*="图片"]',
        'button[aria-label*="上传"]',
        'button[aria-label*="image"]',
        'button[aria-label*="upload"]',
        '[class*="image-upload"]',
        '[class*="upload-btn"]',
        '[class*="attach"]',
        '[data-testid*="upload"]',
        '[data-testid*="attach"]',
      ];

      for (const selector of uploadButtonSelectors) {
        try {
          const btn = await page.$(selector);
          if (!btn) continue;
          
          // Check if visible
          const isVisible = await btn.evaluate((el: Element) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' &&
                   (el as HTMLElement).offsetWidth > 0;
          });
          if (!isVisible) continue;

          await btn.click();
          console.log(`  📎 点击上传按钮: ${selector}`);
          await new Promise(resolve => setTimeout(resolve, 1500));
          
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

    // Check for verification dialogs - pass config name for fallback
    await this.handleVerificationDialog(page, config.name);

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
   * Ensure default WebAI configurations are loaded
   */
  public ensureDefaultConfigs(): void {
    for (const defaultAI of DEFAULT_WEBAIS) {
      if (!this.configs.has(defaultAI.name)) {
        this.addConfig({
          name: defaultAI.name,
          url: defaultAI.url,
        });
      }
    }
  }

  /**
   * Get list of available config names (for fallback)
   */
  public getAvailableConfigs(): string[] {
    this.ensureDefaultConfigs();
    return Array.from(this.configs.keys());
  }

  /**
   * Check if verification is required on current page
   */
  private async isVerificationRequired(page: import('puppeteer').Page): Promise<boolean> {
    const verificationSelectors = [
      '[class*="captcha"]', '[class*="verify"]', '[class*="verification"]',
      '[id*="captcha"]', '[id*="verify"]', 'iframe[src*="captcha"]',
      '[class*="slider"]', '[class*="puzzle"]', '.modal[class*="security"]',
      '[data-testid*="captcha"]', '[class*="login"]', '[class*="登录"]',
    ];

    for (const selector of verificationSelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          const isVisible = await element.evaluate((el: Element) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && 
                   (el as HTMLElement).offsetWidth > 0 && (el as HTMLElement).offsetHeight > 0;
          });
          if (isVisible) return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  /**
   * Wait for human intervention with timeout
   */
  private async waitForHumanIntervention(page: import('puppeteer').Page, maxWaitMinutes: number = 5): Promise<boolean> {
    console.log(chalk.yellow('\n' + '='.repeat(50)));
    console.log(chalk.yellow('⚠️  需要人工干预'));
    console.log(chalk.yellow('='.repeat(50)));
    console.log(chalk.white(`   请在浏览器中完成验证或登录`));
    console.log(chalk.white(`   等待时间: ${maxWaitMinutes} 分钟`));
    console.log(chalk.yellow('='.repeat(50) + '\n'));

    const startTime = Date.now();
    const maxWaitMs = maxWaitMinutes * 60 * 1000;

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const stillNeedsVerification = await this.isVerificationRequired(page);
      if (!stillNeedsVerification) {
        console.log(chalk.green('✅ 验证完成，继续执行...\n'));
        return true;
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      process.stdout.write(`\r   ⏳ 等待中... ${elapsed}s / ${maxWaitMinutes * 60}s`);
    }

    console.log(chalk.red('\n\n❌ 等待超时，人工干预未完成\n'));
    return false;
  }

  /**
   * Query with automatic fallback to other WebAI channels
   */
  public async queryWithFallback(query: string, preferredConfig?: string): Promise<{ response: string; usedConfig: string }> {
    this.ensureDefaultConfigs();
    
    const configs = this.getAvailableConfigs();
    if (configs.length === 0) {
      throw new Error('No WebAI configurations available');
    }

    // Order configs with preferred first
    const orderedConfigs = preferredConfig && configs.includes(preferredConfig)
      ? [preferredConfig, ...configs.filter(c => c !== preferredConfig)]
      : configs;

    let lastError: Error | null = null;
    let failedConfigs: string[] = [];

    for (const configName of orderedConfigs) {
      try {
        console.log(chalk.cyan(`\n🔄 尝试通道: ${configName}`));
        
        const response = await this.query(configName, query);
        
        // Check if we got a valid response
        if (response && response.length > 10) {
          return { response, usedConfig: configName };
        }
        
        console.log(chalk.yellow(`   ⚠️ ${configName} 响应无效，切换通道...`));
        failedConfigs.push(configName);
        
      } catch (error: any) {
        lastError = error;
        failedConfigs.push(configName);
        console.log(chalk.yellow(`   ⚠️ ${configName} 失败: ${error.message?.slice(0, 50)}`));
        
        // Check if verification is needed
        if (this.activePage && await this.isVerificationRequired(this.activePage)) {
          console.log(chalk.yellow(`   🔐 ${configName} 需要验证，尝试切换通道...`));
          continue;
        }
      }
    }

    // All channels failed, wait for human intervention on the last channel
    if (failedConfigs.length >= orderedConfigs.length && this.activePage) {
      console.log(chalk.red('\n❌ 所有通道都失败了'));
      
      const humanHelped = await this.waitForHumanIntervention(this.activePage);
      if (humanHelped) {
        // Retry with the last config
        const lastConfig = orderedConfigs[orderedConfigs.length - 1];
        try {
          const response = await this.query(lastConfig, query);
          return { response, usedConfig: lastConfig };
        } catch (retryError) {
          throw new Error(`人工干预后仍然失败: ${(retryError as Error).message}`);
        }
      }
    }

    throw lastError || new Error('All WebAI channels failed');
  }

  /**
   * Query with image and automatic fallback
   */
  public async queryWithImageFallback(
    imagePath: string, 
    query: string, 
    preferredConfig?: string
  ): Promise<{ response: string; usedConfig: string }> {
    this.ensureDefaultConfigs();
    
    const configs = this.getAvailableConfigs();
    if (configs.length === 0) {
      throw new Error('No WebAI configurations available');
    }

    const orderedConfigs = preferredConfig && configs.includes(preferredConfig)
      ? [preferredConfig, ...configs.filter(c => c !== preferredConfig)]
      : configs;

    let lastError: Error | null = null;
    let failedConfigs: string[] = [];

    for (const configName of orderedConfigs) {
      try {
        console.log(chalk.cyan(`\n🔄 尝试通道: ${configName}`));
        
        const response = await this.queryWithImage(configName, imagePath, query);
        
        if (response && response.length > 10) {
          return { response, usedConfig: configName };
        }
        
        console.log(chalk.yellow(`   ⚠️ ${configName} 响应无效，切换通道...`));
        failedConfigs.push(configName);
        
      } catch (error: any) {
        lastError = error;
        failedConfigs.push(configName);
        console.log(chalk.yellow(`   ⚠️ ${configName} 失败: ${error.message?.slice(0, 50)}`));
        
        if (this.activePage && await this.isVerificationRequired(this.activePage)) {
          console.log(chalk.yellow(`   🔐 ${configName} 需要验证，尝试切换通道...`));
          continue;
        }
      }
    }

    // All failed, wait for human
    if (failedConfigs.length >= orderedConfigs.length && this.activePage) {
      console.log(chalk.red('\n❌ 所有通道都失败了'));
      
      const humanHelped = await this.waitForHumanIntervention(this.activePage);
      if (humanHelped) {
        const lastConfig = orderedConfigs[orderedConfigs.length - 1];
        try {
          const response = await this.queryWithImage(lastConfig, imagePath, query);
          return { response, usedConfig: lastConfig };
        } catch (retryError) {
          throw new Error(`人工干预后仍然失败: ${(retryError as Error).message}`);
        }
      }
    }

    throw lastError || new Error('All WebAI channels failed');
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
