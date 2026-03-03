/**
 * Doubao (豆包) Channel Implementation
 * https://www.doubao.com/chat/
 */

import type { WebAIConfig } from '@/types';
import type { ChannelHandler, ChannelParams } from './types';
import { BrowserEngine } from '@/browser/engine';
import { logger } from '@/utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

const log = logger().createModuleLogger('DOUBAO');

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
        log.info(`找到输入框: ${sel}`);
        return;
      } catch { continue; }
    }
    
    log.warn('未找到输入框，等待fallback');
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  /**
   * Send text query to doubao
   */
  async query(page: import('puppeteer').Page, text: string): Promise<string> {
    log.debug(`发送查询: ${text.slice(0, 50)}...`);
    
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

    try {
      await page.click(foundSelector);
    } catch {
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) (el as HTMLElement).focus();
      }, foundSelector);
    }

    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');

    const client = await page.createCDPSession();
    await client.send('Input.insertText', { text });
    await client.detach();

    await new Promise(resolve => setTimeout(resolve, 500));
    await page.keyboard.press('Enter');
    log.debug('已发送消息，等待响应');

    return this.waitForResponse(page);
  }

  /**
   * Query with image - Doubao uses attachment button menu
   */
  async queryWithImage(page: import('puppeteer').Page, imagePath: string, query: string): Promise<string> {
    log.info(`图片上传流程: ${imagePath}`);

    let uploaded = false;
    const attachmentBtn = await this.findAttachmentButton(page);
    
    if (attachmentBtn) {
      await attachmentBtn.click();
      log.info('已点击附件图标');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      uploaded = await this.clickUploadMenu(page, imagePath);
    }

    if (!uploaded) {
      uploaded = await this.uploadViaFileInput(page, imagePath);
    }

    if (!uploaded) {
      uploaded = await this.uploadViaDragDrop(page, imagePath);
    }

    if (!uploaded) {
      log.error('图片上传失败');
      throw new Error('[豆包] 图片上传失败');
    }

    log.info('图片上传成功，等待处理');
    await new Promise(resolve => setTimeout(resolve, 2000));

    return this.query(page, query);
  }

  /**
   * Upload via drag and drop
   */
  private async uploadViaDragDrop(page: import('puppeteer').Page, imagePath: string): Promise<boolean> {
    try {
      const imageBuffer = await fs.readFile(imagePath);
      const fileName = path.basename(imagePath);
      const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

      const dragTargets = ['textarea', '[contenteditable="true"]', '[class*="input"]'];

      for (const targetSel of dragTargets) {
        const target = await page.$(targetSel);
        if (!target) continue;

        log.debug(`尝试拖拽上传到: ${targetSel}`);

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
          await new Promise(resolve => setTimeout(resolve, 1500));
          const uploadIndicator = await page.$('[class*="uploading"], [class*="preview"], img[src*="blob"], [class*="image"]');
          if (uploadIndicator) {
            log.info('拖拽上传成功');
            return true;
          }
        }
      }
    } catch (err) {
      log.warn(`拖拽上传失败: ${err}`);
    }
    return false;
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
            log.debug(`找到附件按钮: ${sel}`);
            return btn;
          }
        }
      } catch { continue; }
    }

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
          log.debug('找到附件按钮 (遍历)');
          return btn;
        }
      } catch { continue; }
    }

    log.debug('未找到附件按钮');
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
          log.debug(`点击上传菜单项: ${text.slice(0, 20)}`);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const fileInputs = await page.$$('input[type="file"]');
          if (fileInputs.length > 0) {
            await (fileInputs[0] as import('puppeteer').ElementHandle<HTMLInputElement>).uploadFile(imagePath);
            log.info('菜单上传成功');
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
        log.info('文件输入上传成功');
        return true;
      } catch { continue; }
    }
    return false;
  }

  /**
   * Wait for AI response with per-second status check
   */
  private async waitForResponse(page: import('puppeteer').Page): Promise<string> {
    const maxWaitMs = this.config.responseTimeout || 60000;
    const startTime = Date.now();
    let lastContent = '';
    let lastLength = 0;
    let stableCount = 0;
    let responseStarted = false;

    log.debug('等待AI响应...');

    while (Date.now() - startTime < maxWaitMs) {
      const status = await page.evaluate(() => {
        const typingSelectors = [
          '[class*="typing"]', '[class*="loading"]', '[class*="generating"]', 
          '[class*="thinking"]', '[class*="streaming"]', '[class*="cursor"]'
        ];
        let isGenerating = false;
        for (const sel of typingSelectors) {
          const els = document.querySelectorAll(sel);
          for (const el of Array.from(els)) {
            const style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden' && 
                (el as HTMLElement).offsetWidth > 0) {
              isGenerating = true;
              break;
            }
          }
          if (isGenerating) break;
        }

        const contentSelectors = [
          '[class*="message"]', '[class*="response"]', '[class*="answer"]',
          '[class*="markdown"]', '[class*="assistant"]', '[class*="reply"]'
        ];
        let content = '';
        for (const sel of contentSelectors) {
          const els = document.querySelectorAll(sel);
          if (els.length > 0) {
            const text = els[els.length - 1]?.textContent?.trim() || '';
            if (text.length > content.length) content = text;
          }
        }

        return { isGenerating, content, contentLength: content.length };
      });

      if (status.contentLength > 0 && !responseStarted) {
        responseStarted = true;
        log.info(`AI开始响应 (${status.contentLength}字)`);
      }

      if (status.contentLength > 10) {
        if (status.content === lastContent || status.contentLength === lastLength) {
          stableCount++;
          if (stableCount >= 2 && !status.isGenerating) {
            log.info(`AI响应完成 (${status.contentLength}字)`);
            lastContent = status.content;
            break;
          }
        } else {
          stableCount = 0;
        }
      }
      
      lastContent = status.content;
      lastLength = status.contentLength;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return lastContent;
  }
}

/**
 * Create doubao channel instance
 */
export function createDoubaoChannel(params: ChannelParams): DoubaoChannel {
  return new DoubaoChannel(params);
}
