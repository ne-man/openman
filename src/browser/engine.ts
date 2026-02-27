/**
 * Browser engine for OpenMan
 */

import puppeteer, { Browser, Page, PuppeteerLaunchOptions } from 'puppeteer';
import type { BrowserConfig, NavigationOptions, PageSnapshot, FormField } from '@/types';
import { config } from '@/core/config';
import { auditLogger } from '@/core/audit';

export class BrowserEngine {
  private browser: Browser | null = null;
  private pages: Map<string, Page> = new Map();

  constructor(private options?: BrowserConfig) {
    this.options = options || config.get('browser');
  }

  public async initialize(): Promise<void> {
    if (this.browser) {
      return;
    }

    // Try to connect to existing Chrome first
    if (this.options?.browserWSEndpoint || this.options?.debuggingPort) {
      await this.connectToExisting();
      return;
    }

    const headlessMode = this.options?.headless ?? true;
    const launchOptions: PuppeteerLaunchOptions = {
      headless: headlessMode,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
      ],
    };

    if (this.options?.executablePath) {
      launchOptions.executablePath = this.options.executablePath;
    }

    // Use user data directory for persistent login sessions
    if (this.options?.userDataDir) {
      const userDataDir = this.options.userDataDir.replace(/^~/, process.env.HOME || '');
      launchOptions.userDataDir = userDataDir;
    }

    this.browser = await puppeteer.launch(launchOptions);

    await auditLogger.log({
      timestamp: new Date(),
      action: 'browser.initialize',
      details: { headless: headlessMode, userDataDir: this.options?.userDataDir },
      result: 'success',
      riskLevel: 'low',
    });
  }

  /**
   * Connect to an existing Chrome instance with remote debugging enabled
   */
  private async connectToExisting(): Promise<void> {
    let browserWSEndpoint = this.options?.browserWSEndpoint;

    // If only port provided, fetch the WebSocket endpoint
    if (!browserWSEndpoint && this.options?.debuggingPort) {
      const port = this.options.debuggingPort;
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const data = await response.json() as { webSocketDebuggerUrl: string };
      browserWSEndpoint = data.webSocketDebuggerUrl;
    }

    if (!browserWSEndpoint) {
      throw new Error('Could not determine browser WebSocket endpoint');
    }

    this.browser = await puppeteer.connect({ browserWSEndpoint });

    await auditLogger.log({
      timestamp: new Date(),
      action: 'browser.connect',
      details: { endpoint: browserWSEndpoint },
      result: 'success',
      riskLevel: 'low',
    });
  }

  public async newPage(id?: string): Promise<Page> {
    if (!this.browser) {
      throw new Error('Browser not initialized. Call initialize() first.');
    }

    const page = await this.browser.newPage();
    const pageId = id || `page-${Date.now()}`;

    // Set viewport
    if (this.options?.viewport) {
      await page.setViewport(this.options.viewport);
    }

    // Set user agent if provided
    if (this.options?.userAgent) {
      await page.setUserAgent(this.options.userAgent);
    }

    this.pages.set(pageId, page);
    return page;
  }

  public async navigate(
    url: string,
    options?: NavigationOptions
  ): Promise<PageSnapshot & { page: Page }> {
    const page = await this.newPage();

    await auditLogger.log({
      timestamp: new Date(),
      action: 'browser.navigate',
      details: { url, options },
      result: 'success',
      riskLevel: 'low',
    });

    await page.goto(url, {
      waitUntil: options?.waitUntil || 'networkidle2',
      timeout: options?.timeout || 30000,
    });

    const snapshot = await this.snapshot(page);
    return { ...snapshot, page };
  }

  public async snapshot(page: Page): Promise<PageSnapshot> {
    return {
      url: page.url(),
      title: await page.title(),
      text: await page.evaluate(() => document.body.innerText),
      timestamp: new Date(),
    };
  }

  public async screenshot(page: Page, path?: string): Promise<Buffer | void> {
    const screenshot = await page.screenshot({
      fullPage: true,
      encoding: 'binary',
    });

    if (path) {
      await page.screenshot({ path, fullPage: true });
      return;
    }

    return screenshot as Buffer;
  }

  public async fillForm(page: Page, fields: FormField[]): Promise<void> {
    for (const field of fields) {
      const selector = `[name="${field.name}"]`;
      await page.waitForSelector(selector);
      await page.type(selector, field.value || '');
    }
  }

  public async click(page: Page, selector: string): Promise<void> {
    await page.waitForSelector(selector);
    await page.click(selector);
  }

  public async search(
    query: string,
    searchEngine: 'google' | 'bing' | 'duckduckgo' = 'google'
  ): Promise<PageSnapshot> {
    const searchUrls = {
      google: 'https://www.google.com/search',
      bing: 'https://www.bing.com/search',
      duckduckgo: 'https://duckduckgo.com/',
    };

    const page = await this.newPage();
    const url = searchUrls[searchEngine];

    if (searchEngine === 'duckduckgo') {
      await page.goto(url);
      await page.type('#search_form_input_homepage', query);
      await page.click('#search_button_homepage');
    } else {
      await page.goto(`${url}?q=${encodeURIComponent(query)}`);
    }

    return await this.snapshot(page);
  }

  public async closePage(id: string): Promise<void> {
    const page = this.pages.get(id);
    if (page) {
      await page.close();
      this.pages.delete(id);
    }
  }

  public async close(): Promise<void> {
    for (const [id, page] of this.pages) {
      await page.close();
    }
    this.pages.clear();

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    await auditLogger.log({
      timestamp: new Date(),
      action: 'browser.close',
      details: {},
      result: 'success',
      riskLevel: 'low',
    });
  }
}
