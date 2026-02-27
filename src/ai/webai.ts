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

    let uploaded = false;
    const fs = await import('fs/promises');
    const pathModule = await import('path');

    // Method 1: Drag and drop upload (元宝支持拖拽上传)
    try {
      console.log('  🔄 尝试拖拽上传...');
      
      // Read image file
      const imageBuffer = await fs.readFile(imagePath);
      const fileName = pathModule.basename(imagePath);
      const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
      
      // Find drop target (textarea or input area)
      const inputSelector = config.inputSelector || 'textarea';
      const dropTarget = await page.$(inputSelector);
      
      if (dropTarget) {
        // Create and dispatch drag events with file data
        const uploaded_via_drag = await page.evaluate(async (base64Data: string, fileName: string, mimeType: string) => {
          // Convert base64 to blob
          const byteString = atob(base64Data);
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([ab], { type: mimeType });
          
          // Create File object
          const file = new File([blob], fileName, { type: mimeType });
          
          // Create DataTransfer
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          
          // Find drop target
          const target = document.querySelector('textarea') || document.querySelector('[contenteditable]') || document.body;
          
          // Dispatch drag events
          const dragEnter = new DragEvent('dragenter', { bubbles: true, dataTransfer });
          const dragOver = new DragEvent('dragover', { bubbles: true, dataTransfer });
          const drop = new DragEvent('drop', { bubbles: true, dataTransfer });
          
          target.dispatchEvent(dragEnter);
          target.dispatchEvent(dragOver);
          target.dispatchEvent(drop);
          
          return true;
        }, imageBuffer.toString('base64'), fileName, mimeType);
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if upload succeeded
        const hasImage = await page.evaluate(() => {
          return document.querySelector('img[src*="blob:"]') !== null ||
                 document.querySelector('[class*="preview"] img') !== null ||
                 document.querySelector('[class*="thumbnail"]') !== null ||
                 document.querySelector('[class*="upload"] img') !== null;
        });
        
        if (hasImage) {
          uploaded = true;
          console.log('  ✅ 图片已通过拖拽上传');
        }
      }
    } catch (dragError) {
      console.log('  ⚠️ 拖拽上传失败');
    }

    // Method 2: Try clipboard paste
    if (!uploaded) {
      try {
        console.log('  🔄 尝试粘贴上传...');
        const inputSelector = config.inputSelector || 'textarea';
        await page.click(inputSelector);
        await new Promise(resolve => setTimeout(resolve, 500));

        const imageBuffer = await fs.readFile(imagePath);
        const base64Image = imageBuffer.toString('base64');
        const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
        
        // Use CDP to paste image
        await page.evaluate(async (base64: string, mime: string) => {
          const blob = await fetch(`data:${mime};base64,${base64}`).then(r => r.blob());
          const item = new ClipboardItem({ [mime]: blob });
          await navigator.clipboard.write([item]);
        }, base64Image, mimeType);

        await page.keyboard.down('Control');
        await page.keyboard.press('KeyV');
        await page.keyboard.up('Control');
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const hasImage = await page.evaluate(() => {
          return document.querySelector('img[src*="blob:"]') !== null ||
                 document.querySelector('[class*="preview"] img') !== null ||
                 document.querySelector('[class*="image-preview"]') !== null;
        });
        
        if (hasImage) {
          uploaded = true;
          console.log('  ✅ 图片已通过粘贴上传');
        }
      } catch (pasteError) {
        console.log('  ⚠️ 粘贴上传失败');
      }
    }

    // Method 2: Direct file input (if exists)
    if (!uploaded) {
      const fileInputSelectors = [
        'input[type="file"]',
        '[data-testid="image-upload"]',
        '[class*="upload"] input[type="file"]',
        '[class*="attach"] input[type="file"]',
      ];

      for (const selector of fileInputSelectors) {
        try {
          const fileInput = await page.$(selector);
          if (fileInput) {
            const tagName = await fileInput.evaluate((el: Element) => el.tagName.toLowerCase());
            if (tagName === 'input') {
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
    }

    // Method 3: Click + button, then select "图片" from popup menu (元宝)
    if (!uploaded) {
      console.log('  🔍 尝试查找附件/上传按钮...');
      
      // 元宝的上传按钮特征：输入框旁边，+ 图标或附件图标
      const plusBtn = await page.evaluateHandle(() => {
        const allBtns = document.querySelectorAll('button, [role="button"], div[role="button"]');
        const candidates: Array<{el: Element, score: number, info: string}> = [];
        
        for (const btn of allBtns) {
          const rect = (btn as HTMLElement).getBoundingClientRect();
          if (rect.width < 10 || rect.height < 10) continue;
          
          let score = 0;
          let info = '';
          
          // 检查 aria-label
          const ariaLabel = btn.getAttribute('aria-label') || '';
          if (ariaLabel.includes('上传') || ariaLabel.includes('附件') || ariaLabel.includes('图片') || ariaLabel.includes('添加')) {
            score += 10;
            info += 'aria:' + ariaLabel;
          }
          
          // 检查 class
          const className = btn.className || '';
          if (className.includes('upload') || className.includes('attach') || className.includes('plus') || className.includes('add')) {
            score += 5;
            info += ' class:' + className.slice(0, 30);
          }
          
          // 检查 title
          const title = btn.getAttribute('title') || '';
          if (title.includes('上传') || title.includes('图片')) {
            score += 10;
            info += ' title:' + title;
          }
          
          // 检查位置（底部附近）
          if (rect.bottom > window.innerHeight - 200) {
            score += 2;
          }
          
          // 检查大小（小按钮）
          if (rect.width < 60 && rect.height < 60) {
            score += 1;
          }
          
          // 检查 SVG 内容
          const svg = btn.querySelector('svg');
          if (svg) {
            const svgHtml = svg.outerHTML.toLowerCase();
            // + 号通常有两条线或特定 path
            if (svgHtml.includes('m12') || svgHtml.includes('plus') || svgHtml.includes('add')) {
              score += 3;
              info += ' svg:plus';
            }
          }
          
          if (score > 0) {
            candidates.push({el: btn, score, info});
          }
        }
        
        // 按分数排序，返回最高分的
        candidates.sort((a, b) => b.score - a.score);
        if (candidates.length > 0) {
          console.log('Upload button candidates:', candidates.slice(0, 3).map(c => c.info));
          return candidates[0].el;
        }
        return null;
      });

      // 查找页面上所有可能的上传入口（扩大搜索范围）
      const pageInfo = await page.evaluate(() => {
        const info: string[] = [];
        
        // 查找所有按钮和可点击元素
        const clickables = document.querySelectorAll('button, [role="button"], [class*="btn"], [class*="icon"], svg');
        clickables.forEach((el, i) => {
          const rect = (el as HTMLElement).getBoundingClientRect();
          if (rect.width > 15 && rect.height > 15 && rect.width < 100) {
            const aria = el.getAttribute('aria-label') || '';
            const title = el.getAttribute('title') || '';
            const cls = (el.className?.toString() || '').slice(0, 30);
            const tag = el.tagName;
            // 查找可能的上传相关元素
            if (aria.includes('上传') || aria.includes('图片') || aria.includes('添加') || aria.includes('附件') ||
                title.includes('上传') || title.includes('图片') ||
                cls.includes('upload') || cls.includes('attach') || cls.includes('plus') || cls.includes('add') ||
                tag === 'SVG') {
              info.push(`${tag} ${rect.width.toFixed(0)}x${rect.height.toFixed(0)} y=${rect.top.toFixed(0)} aria="${aria}" title="${title}" class="${cls}"`);
            }
          }
        });
        
        // 查找 input[type="file"]
        const fileInputs = document.querySelectorAll('input[type="file"]');
        fileInputs.forEach((inp, i) => {
          info.push(`INPUT[file] #${i} name="${inp.getAttribute('name')}" accept="${inp.getAttribute('accept')}"`);
        });
        
        return info.slice(0, 20);
      });
      console.log('  📋 上传相关元素:', pageInfo.length > 0 ? pageInfo.join('\n      ') : '无');

      if (plusBtn && (plusBtn as any).asElement()) {
        try {
          await (plusBtn as import('puppeteer').ElementHandle<Element>).click();
          console.log('  📎 点击上传按钮');
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // 查找弹出菜单中的"图片"选项（元宝菜单项通常带图标）
          const menuItems = await page.evaluate(() => {
            // 查找最近出现的弹出层/菜单
            const popups = document.querySelectorAll('[class*="popup"], [class*="menu"], [class*="dropdown"], [class*="modal"], [class*="overlay"], [role="menu"], [role="listbox"]');
            const found: string[] = [];
            
            // 在弹出层中查找
            for (const popup of popups) {
              const rect = (popup as HTMLElement).getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                const items = popup.querySelectorAll('div, span, li, a, button');
                for (const el of items) {
                  const text = el.textContent?.trim();
                  if (text && text.length < 15) {
                    found.push(`${el.tagName}:${text}`);
                  }
                }
              }
            }
            
            // 如果没找到弹出层，查找全局的菜单项
            if (found.length === 0) {
              const items = document.querySelectorAll('div, span, li');
              for (const el of items) {
                const text = el.textContent?.trim();
                const rect = (el as HTMLElement).getBoundingClientRect();
                const style = window.getComputedStyle(el);
                // 查找小尺寸、可见的菜单项
                if (text && text.length < 10 && rect.width > 30 && rect.height > 20 &&
                    style.display !== 'none' && rect.width < 200) {
                  found.push(`${el.tagName}:${text}`);
                }
              }
            }
            return found.slice(0, 15);
          });
          console.log(`  📋 菜单选项: ${menuItems.join(', ')}`);

          // 精确查找"图片"菜单项
          const imageOpt = await page.evaluateHandle(() => {
            // 优先在弹出层中查找
            const popups = document.querySelectorAll('[class*="popup"], [class*="menu"], [class*="dropdown"], [role="menu"]');
            for (const popup of popups) {
              const items = popup.querySelectorAll('div, span, li, a, button');
              for (const el of items) {
                const text = el.textContent?.trim();
                // 精确匹配"图片"（可能带图标所以只有这两个字）
                if (text === '图片') {
                  const rect = (el as HTMLElement).getBoundingClientRect();
                  if (rect.width > 0 && rect.height > 0) {
                    return el;
                  }
                }
              }
            }
            
            // 全局查找
            const items = document.querySelectorAll('div, span, li, a, button');
            for (const el of items) {
              const text = el.textContent?.trim();
              if (text === '图片') {
                const rect = (el as HTMLElement).getBoundingClientRect();
                const parent = el.parentElement;
                // 确保是菜单项（有父容器，尺寸合理）
                if (rect.width > 30 && rect.height > 15 && rect.width < 200 && parent) {
                  return el;
                }
              }
            }
            return null;
          });

          if (imageOpt && (imageOpt as any).asElement()) {
            await (imageOpt as import('puppeteer').ElementHandle<Element>).click();
            console.log('  📷 选择"图片"选项');
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            // 查找 file input 并上传
            const fileInputs = await page.$$('input[type="file"]');
            console.log(`  🔍 找到 ${fileInputs.length} 个文件输入框`);
            for (const fileInput of fileInputs) {
              try {
                await fileInput.uploadFile(imagePath);
                uploaded = true;
                console.log('  ✅ 图片已上传');
                break;
              } catch { continue; }
            }
          } else {
            console.log('  ⚠️ 未找到"图片"选项');
          }
        } catch (e) {
          console.log(`  ⚠️ + 按钮流程失败: ${(e as Error).message?.slice(0, 30)}`);
        }
      } else {
        console.log('  ⚠️ 未找到 + 按钮');
      }
    }

    // Method 4: Try other upload buttons directly
    if (!uploaded) {
      const uploadButtonSelectors = [
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
          
          const isVisible = await btn.evaluate((el: Element) => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' &&
                   (el as HTMLElement).offsetWidth > 0;
          });
          if (!isVisible) continue;

          await btn.click();
          console.log(`  📎 点击上传按钮: ${selector}`);
          await new Promise(resolve => setTimeout(resolve, 1500));
          
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

    // Wait for upload to process and verify
    if (uploaded) {
      console.log('  ⏳ 等待图片处理...');
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Verify image is actually uploaded (look for preview)
      const imageVerified = await page.evaluate(() => {
        // 查找图片预览元素
        const selectors = [
          'img[src*="blob:"]',
          'img[src*="data:"]',
          '[class*="preview"] img',
          '[class*="thumbnail"]',
          '[class*="upload"] img',
          '[class*="image-item"]',
          '[class*="file-item"]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) return sel;
        }
        return null;
      });
      
      if (imageVerified) {
        console.log(`  ✅ 图片预览已显示: ${imageVerified}`);
      } else {
        console.log('  ⚠️ 未检测到图片预览，可能上传未成功');
        uploaded = false;
      }
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
