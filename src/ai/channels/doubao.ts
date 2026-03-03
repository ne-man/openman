/**
 * Doubao (豆包) Channel Implementation
 * https://www.doubao.com/chat/
 */

import type { WebAIConfig } from '@/types';
import type { ChannelHandler, ChannelParams } from './types';
import { BrowserEngine } from '@/browser/engine';

/**
 * Doubao channel default config
 */
export const DOUBAO_CONFIG: Partial<WebAIConfig> = {
  inputSelector: 'textarea',
  submitSelector: 'button, [class*="send"], [class*="submit"]',
  responseSelector: '[class*="message"], [class*="response"], [class*="answer"]',
  responseTimeout: 60000,
};

/**
 * Doubao channel handler
 */
export class DoubaoChannel implements ChannelHandler {
  name = 'doubao';
  url = 'https://www.doubao.com/chat/';
  config: WebAIConfig;
  private browserEngine: BrowserEngine;

  constructor(params: ChannelParams) {
    this.config = {
      ...DOUBAO_CONFIG,
      ...params.config,
      url: this.url,
    };
    this.browserEngine = params.browserEngine;
  }

  /**
   * Wait for doubao page ready
   */
  async waitForReady(page: import('puppeteer').Page): Promise<void> {
    const inputSelectors = (this.config.inputSelector || 'textarea').split(',').map(s => s.trim());
    
    for (const sel of inputSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 10000 });
        console.log(`  ✓ [豆包] 找到输入框: ${sel}`);
        return;
      } catch { continue; }
    }
    
    // Fallback wait
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  /**
   * Send text query to doubao
   */
  async query(page: import('puppeteer').Page, text: string): Promise<string> {
    // Find and click input
    const inputSelectors = (this.config.inputSelector || 'textarea').split(',').map(s => s.trim());
    let foundSelector = '';
    
    for (const sel of inputSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 5000 });
        foundSelector = sel;
        break;
      } catch { continue; }
    }
    
    if (!foundSelector) {
      foundSelector = 'textarea';
    }

    // Click and clear
    try {
      await page.click(foundSelector);
    } catch {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) (el as HTMLElement).focus();
      }, foundSelector);
    }

    // Clear existing content
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');

    // Insert text via CDP
    const client = await page.createCDPSession();
    await client.send('Input.insertText', { text });
    await client.detach();

    // Wait and submit
    await new Promise(resolve => setTimeout(resolve, 500));
    await page.keyboard.press('Enter');

    // Wait for response
    return this.waitForResponse(page);
  }

  /**
   * Query with image - Doubao uses attachment button menu
   */
  async queryWithImage(page: import('puppeteer').Page, imagePath: string, query: string): Promise<string> {
    console.log('  🔍 [豆包] 图片上传流程...');

    // Step 1: Find and click attachment button
    let uploaded = false;
    const attachmentBtn = await this.findAttachmentButton(page);
    
    if (attachmentBtn) {
      await attachmentBtn.click();
      console.log('  📎 [豆包] 已点击附件图标');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Step 2: Click upload menu item
      uploaded = await this.clickUploadMenu(page, imagePath);
    }

    // Fallback: direct file input
    if (!uploaded) {
      uploaded = await this.uploadViaFileInput(page, imagePath);
    }

    if (!uploaded) {
      throw new Error('[豆包] 图片上传失败');
    }

    // Wait for upload to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Send query
    return this.query(page, query);
  }

  /**
   * Find doubao attachment button
   */
  private async findAttachmentButton(page: import('puppeteer').Page): Promise<import('puppeteer').ElementHandle | null> {
    const selectors = [
      'button[aria-label*="附件"]',
      'button[aria-label*="attachment"]',
      '[class*="attach"] button',
    ];

    for (const sel of selectors) {
      try {
        const btns = await page.$$(sel);
        for (const btn of btns) {
          const isVisible = await btn.evaluate((el: Element) => {
            const style = window.getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.display !== 'none' && 
                   style.visibility !== 'hidden' && 
                   rect.width > 0 && rect.height > 0;
          });
          if (isVisible) {
            console.log(`  📎 [豆包] 找到附件按钮: ${sel}`);
            return btn;
          }
        }
      } catch { continue; }
    }

    // Iterate all buttons
    const allButtons = await page.$$('button');
    for (const btn of allButtons) {
      try {
        const isAttachment = await btn.evaluate((el: Element) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const ariaLabel = el.getAttribute('aria-label') || '';
          const text = el.textContent || '';
          
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (rect.width < 20 || rect.height > 60) return false;
          
          return ariaLabel.includes('附件') || ariaLabel.includes('attach') || 
                 text.includes('附件') || text.includes('添加');
        });
        if (isAttachment) {
          console.log('  📎 [豆包] 找到附件按钮 (遍历)');
          return btn;
        }
      } catch { continue; }
    }

    return null;
  }

  /**
   * Click doubao upload menu item
   */
  private async clickUploadMenu(page: import('puppeteer').Page, imagePath: string): Promise<boolean> {
    const menuItems = await page.$$('[class*="menu-item"], [class*="dropdown-item"], [role="menuitem"]');
    
    for (const item of menuItems) {
      try {
        const text = await item.evaluate((el: Element) => el.textContent || '');
        if (text.includes('上传') || text.includes('图片') || text.includes('文件')) {
          await item.click();
          console.log(`  ✅ [豆包] 已点击上传菜单项: ${text.slice(0, 20)}`);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const fileInputs = await page.$$('input[type="file"]');
          if (fileInputs.length > 0) {
            await (fileInputs[0] as import('puppeteer').ElementHandle<HTMLInputElement>).uploadFile(imagePath);
            console.log('  ✅ [豆包] 上传成功');
            return true;
          }
        }
      } catch { continue; }
    }
    return false;
  }

  /**
   * Upload via file input (fallback)
   */
  private async uploadViaFileInput(page: import('puppeteer').Page, imagePath: string): Promise<boolean> {
    const fileInputs = await page.$$('input[type="file"]');
    for (const input of fileInputs) {
      try {
        await (input as import('puppeteer').ElementHandle<HTMLInputElement>).uploadFile(imagePath);
        console.log('  ✅ [豆包] 文件输入上传成功');
        return true;
      } catch { continue; }
    }
    return false;
  }

  /**
   * Wait for AI response
   */
  private async waitForResponse(page: import('puppeteer').Page): Promise<string> {
    const responseSelectors = (this.config.responseSelector || '.response').split(',').map(s => s.trim());
    
    // Get initial count
    let foundSelector = '';
    let initialCount = 0;
    
    for (const sel of responseSelectors) {
      try {
        const count = await page.$$eval(sel, els => els.length);
        foundSelector = sel;
        initialCount = count;
        break;
      } catch { continue; }
    }

    // Wait for new response
    if (foundSelector) {
      try {
        await page.waitForFunction(
          (selector: string, count: number) => {
            const elements = document.querySelectorAll(selector);
            return elements.length > count;
          },
          { timeout: this.config.responseTimeout || 60000 },
          foundSelector,
          initialCount
        );
      } catch {
        console.log('  ⚠️ [豆包] 主选择器超时，尝试备选...');
      }
    }

    // Wait for streaming to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get response text
    for (const sel of responseSelectors) {
      try {
        const text = await page.$$eval(sel, (els) => {
          const lastEl = els[els.length - 1];
          return lastEl ? lastEl.textContent || '' : '';
        });
        if (text && text.trim().length > 10) {
          console.log(`  ✓ [豆包] 获取响应成功`);
          return text.trim();
        }
      } catch { continue; }
    }

    // Fallback
    const responseText = await page.evaluate(() => {
      const selectors = [
        '[class*="message"]',
        '[class*="response"]',
        '[class*="answer"]',
        '[class*="markdown"]',
      ];
      
      for (const sel of selectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          const lastEl = els[els.length - 1];
          const text = lastEl?.textContent?.trim() || '';
          if (text.length > 20) return text;
        }
      }
      return '';
    });

    return responseText.trim();
  }
}

/**
 * Create doubao channel instance
 */
export function createDoubaoChannel(params: ChannelParams): DoubaoChannel {
  return new DoubaoChannel(params);
}
