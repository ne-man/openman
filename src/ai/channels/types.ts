/**
 * WebAI Channel Types and Interfaces
 */

import type { WebAIConfig } from '@/types';

/**
 * Channel handler interface
 */
export interface ChannelHandler {
  /**
   * Channel name identifier
   */
  name: string;

  /**
   * Channel URL
   */
  url: string;

  /**
   * Channel config
   */
  config: WebAIConfig;

  /**
   * Send a text query
   */
  query(page: import('puppeteer').Page, text: string): Promise<string>;

  /**
   * Send a query with an image
   */
  queryWithImage(page: import('puppeteer').Page, imagePath: string, query: string): Promise<string>;

  /**
   * Wait for page ready
   */
  waitForReady(page: import('puppeteer').Page): Promise<void>;
}

/**
 * Channel constructor parameters
 */
export interface ChannelParams {
  config: WebAIConfig;
  browserEngine: import('@/browser/engine').BrowserEngine;
}
