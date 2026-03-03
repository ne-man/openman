/**
 * Yuanbao (元宝) Channel Implementation
 * https://yuanbao.tencent.com/chat
 */

import type { WebAIConfig } from '@/types';
import type { ChannelHandler, ChannelParams } from './types';
import { BrowserEngine } from '@/browser/engine';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Yuanbao channel default config
 */
export const YUANBAO_CONFIG: Partial<WebAIConfig> = {
  inputSelector: '[contenteditable="true"], textarea, [class*="editor"], [class*="input"]',
  submitSelector: 'button[class*="send"]',
  responseSelector: '[class*="markdown"], [class*="message-content"], [class*="answer"]',
  responseTimeout: 120000,
};

/**
 * Yuanbao channel handler
 */
export class YuanbaoChannel implements ChannelHandler {
  name = 'yuanbao';
  url = 'https://yuanbao.tencent.com/chat';
  config: WebAIConfig;
  private browserEngine: BrowserEngine;

  constructor(params: ChannelParams) {
    this.config = {
      ...YUANBAO_CONFIG,
      ...params.config,
      url: this.url,
    };
    this.browserEngine = params.browserEngine;
  }

  /**
   * Wait for yuanbao page ready
   */
  async waitForReady(page: import('puppeteer').Page): Promise<void> {
    const inputSelectors = (this.config.inputSelector || 'textarea').split(',').map(s => s.trim());
    
    for (const sel of inputSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 10000 });
        console.log(`  ✓ [元宝] 找到输入框: ${sel}`);
        return;
      } catch { continue; }
    }
    
    // Fallback wait
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  /**
   * Send text query to yuanbao
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
      foundSelector = '[contenteditable="true"]';
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
   * Query with image - Yuanbao uses drag-and-drop
   */
  async queryWithImage(page: import('puppeteer').Page, imagePath: string, query: string): Promise<string> {
    console.log('  🔍 [元宝] 图片上传流程...');

    // Try drag-and-drop first (yuanbao's preferred method)
    let uploaded = await this.uploadViaDragDrop(page, imagePath);

    // Fallback to file input
    if (!uploaded) {
      uploaded = await this.uploadViaFileInput(page, imagePath);
    }

    if (!uploaded) {
      throw new Error('[元宝] 图片上传失败');
    }

    // Wait for upload to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Send query
    return this.query(page, query);
  }

  /**
   * Upload via drag-and-drop (preferred for yuanbao)
   */
  private async uploadViaDragDrop(page: import('puppeteer').Page, imagePath: string): Promise<boolean> {
    const imageBuffer = await fs.readFile(imagePath);
    const fileName = path.basename(imagePath);
    const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

    const dragTargets = [
      '[contenteditable="true"]',
      'textarea',
      '[class*="editor"]',
      '[class*="input"]',
    ];

    for (const targetSel of dragTargets) {
      const target = await page.$(targetSel);
      if (!target) continue;

      console.log(`  📷 [元宝] 尝试拖拽上传到: ${targetSel}`);

      const dragSuccess = await page.evaluate(async (base64Data: string, fName: string, mime: string, sel: string) => {
        try {
          const byteString = atob(base64Data);
          const ab = new ArrayBuffer(byteString.length);
          const ia = new Uint8Array(ab);
          for (let i = 0; i < byteString.length; i++) {
            ia[i] = byteString.charCodeAt(i);
          }
          const blob = new Blob([ab], { type: mime });
          const file = new File([blob], fName, { type: mime });
          const dataTransfer = new DataTransfer();
          dataTransfer.items.add(file);
          
          const el = document.querySelector(sel);
          if (!el) return false;
          
          el.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer }));
          el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
          el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
          return true;
        } catch {
          return false;
        }
      }, imageBuffer.toString('base64'), fileName, mimeType, targetSel);

      if (dragSuccess) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check for upload indicator
        const uploadIndicator = await page.$(`
          [class*="uploading"], 
          [class*="preview"], 
          [class*="image-preview"],
          img[src*="blob"],
          [class*="file"]
        `);
        
        if (uploadIndicator) {
          console.log('  ✅ [元宝] 拖拽上传成功');
          return true;
        }
      }
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
        console.log('  ✅ [元宝] 文件输入上传成功');
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
        // Timeout - try alternative selectors
        console.log('  ⚠️ [元宝] 主选择器超时，尝试备选...');
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
          console.log(`  ✓ [元宝] 获取响应成功`);
          return text.trim();
        }
      } catch { continue; }
    }

    // Fallback: get any large text block
    const responseText = await page.evaluate(() => {
      const selectors = [
        '[class*="markdown"]',
        '[class*="message-content"]',
        '[class*="answer"]',
        '[class*="response"]',
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
 * Create yuanbao channel instance
 */
export function createYuanbaoChannel(params: ChannelParams): YuanbaoChannel {
  return new YuanbaoChannel(params);
}
