/**
 * Douyin Browser - Automated TikTok/Douyin browsing tool
 */

import puppeteer, { Page, Browser } from 'puppeteer';
import { BrowserEngine } from './engine';
import { auditLogger } from '@/core/audit';
import chalk from 'chalk';

export interface DouyinOptions {
  headless?: boolean;
  scrollCount?: number;
  scrollDelay?: number;
  autoLike?: boolean;
  autoComment?: boolean;
  device?: 'mobile' | 'desktop';
}

export interface DouyinStats {
  videosWatched: number;
  videosLiked: number;
  videosCommented: number;
  timeSpent: number;
}

export class DouyinBrowser {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private stats: DouyinStats = {
    videosWatched: 0,
    videosLiked: 0,
    videosCommented: 0,
    timeSpent: 0,
  };
  private startTime: Date | null = null;

  constructor(private options: DouyinOptions = {}) {
    this.options = {
      headless: true,
      scrollCount: 10,
      scrollDelay: 3000,
      autoLike: false,
      autoComment: false,
      device: 'mobile',
      ...options,
    };
  }

  /**
   * Initialize browser with mobile viewport
   */
  public async initialize(): Promise<void> {
    if (this.browser) {
      return;
    }

    console.log(chalk.yellow('🎬 正在启动 OpenMan 的抖音浏览器...'));

    const launchOptions: any = {
      headless: this.options.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
      ],
    };

    // Set mobile viewport for better TikTok experience
    if (this.options.device === 'mobile') {
      launchOptions.defaultViewport = {
        width: 375,
        height: 812,
        isMobile: true,
        hasTouch: true,
      };
    } else {
      launchOptions.defaultViewport = {
        width: 1440,
        height: 900,
      };
    }

    this.browser = await puppeteer.launch(launchOptions);
    this.page = await this.browser.newPage();

    // Set user agent to look like a mobile device
    if (this.options.device === 'mobile') {
      await this.page.setUserAgent(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1'
      );
    }

    console.log(chalk.green('✅ 浏览器已启动'));

    await auditLogger.log({
      timestamp: new Date(),
      action: 'douyin.initialize',
      details: { options: this.options },
      result: 'success',
      riskLevel: 'low',
    });
  }

  /**
   * Open Douyin/TikTok website
   */
  public async open(url: string = 'https://www.douyin.com'): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    console.log(chalk.yellow(`🌐 正在打开: ${url}`));

    await this.page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    // Wait for page to load
    await this.sleep(2000);

    console.log(chalk.green('✅ 页面已加载'));

    await auditLogger.log({
      timestamp: new Date(),
      action: 'douyin.open',
      details: { url },
      result: 'success',
      riskLevel: 'low',
    });
  }

  /**
   * Scroll to next video
   */
  public async scrollToNextVideo(): Promise<void> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    // Simulate touch scroll (like swipe up on mobile)
    const scrollHeight = this.options.device === 'mobile' ? 800 : 600;

    await this.page.evaluate((height) => {
      window.scrollBy({
        top: height,
        left: 0,
        behavior: 'smooth',
      });
    }, scrollHeight);

    // Wait for video to load
    await this.sleep(this.options.scrollDelay || 3000);

    this.stats.videosWatched++;
  }

  /**
   * Like current video
   */
  public async likeVideo(): Promise<boolean> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    try {
      // Try multiple selectors for like button
      const likeSelectors = [
        '[class*="like"]',
        '[aria-label*="like"]',
        '[data-e2e="like-icon"]',
        'svg[class*="like"]',
      ];

      for (const selector of likeSelectors) {
        try {
          const elements = await this.page.$$(selector);
          if (elements.length > 0) {
            await elements[0].click();
            this.stats.videosLiked++;
            console.log(chalk.blue('💖 已点赞'));
            return true;
          }
        } catch {
          continue;
        }
      }

      console.log(chalk.gray('⚠️  未找到点赞按钮'));
      return false;
    } catch (error) {
      console.log(chalk.red(`❌ 点赞失败: ${error}`));
      return false;
    }
  }

  /**
   * Comment on current video
   */
  public async commentVideo(comment: string): Promise<boolean> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    try {
      // Try to find comment input
      const commentSelectors = [
        'textarea',
        'input[type="text"]',
        '[contenteditable="true"]',
        '[placeholder*="comment" i]',
      ];

      for (const selector of commentSelectors) {
        try {
          const elements = await this.page.$$(selector);
          if (elements.length > 0) {
            await elements[0].click();
            await this.page.keyboard.type(comment);
            await this.page.keyboard.press('Enter');
            this.stats.videosCommented++;
            console.log(chalk.blue(`💬 已评论: ${comment}`));
            return true;
          }
        } catch {
          continue;
        }
      }

      console.log(chalk.gray('⚠️  未找到评论输入框'));
      return false;
    } catch (error) {
      console.log(chalk.red(`❌ 评论失败: ${error}`));
      return false;
    }
  }

  /**
   * Get current video info
   */
  public async getCurrentVideoInfo(): Promise<any> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    try {
      const info = await this.page.evaluate(() => {
        // Try to extract video information from page
        const title = document.querySelector('[class*="title"]')?.textContent ||
                     document.querySelector('h1')?.textContent ||
                     'Unknown';

        const author = document.querySelector('[class*="author"]')?.textContent ||
                      document.querySelector('[class*="user"]')?.textContent ||
                      'Unknown';

        const likes = document.querySelector('[class*="like"] [class*="count"]')?.textContent ||
                      document.querySelector('[class*="like-count"]')?.textContent ||
                      '0';

        const comments = document.querySelector('[class*="comment"] [class*="count"]')?.textContent ||
                         document.querySelector('[class*="comment-count"]')?.textContent ||
                         '0';

        return { title, author, likes, comments };
      });

      return info;
    } catch (error) {
      console.log(chalk.red(`❌ 获取视频信息失败: ${error}`));
      return null;
    }
  }

  /**
   * Browse Douyin automatically
   */
  public async browse(options?: Partial<DouyinOptions>): Promise<DouyinStats> {
    const finalOptions = { ...this.options, ...options };
    this.startTime = new Date();

    console.log(chalk.cyan(`\n🎭 OpenMan 开始刷抖音...`));
    console.log(chalk.gray(`📊 计划观看 ${finalOptions.scrollCount} 个视频\n`));

    for (let i = 1; i <= (finalOptions.scrollCount || 10); i++) {
      console.log(chalk.yellow(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
      console.log(chalk.cyan(`📱 观看第 ${i} 个视频`));

      // Get video info
      const videoInfo = await this.getCurrentVideoInfo();
      if (videoInfo) {
        console.log(chalk.gray(`   标题: ${videoInfo.title}`));
        console.log(chalk.gray(`   作者: ${videoInfo.author}`));
      }

      // Auto like if enabled
      if (finalOptions.autoLike && Math.random() > 0.5) {
        await this.likeVideo();
      }

      // Auto comment if enabled (rarely)
      if (finalOptions.autoComment && Math.random() > 0.9) {
        const comments = [
          '不错！',
          '加油！',
          '很棒！',
          '👍',
          '哈哈哈',
        ];
        const randomComment = comments[Math.floor(Math.random() * comments.length)];
        await this.commentVideo(randomComment);
      }

      // Wait and scroll
      await this.sleep(1000);
      await this.scrollToNextVideo();
    }

    this.stats.timeSpent = Date.now() - (this.startTime?.getTime() || 0);

    console.log(chalk.yellow(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
    console.log(chalk.cyan(`🎬 浏览完成！`));
    this.printStats();

    await auditLogger.log({
      timestamp: new Date(),
      action: 'douyin.browse',
      details: { stats: this.stats },
      result: 'success',
      riskLevel: 'low',
    });

    return this.stats;
  }

  /**
   * Take screenshot
   */
  public async screenshot(path?: string): Promise<Buffer | void> {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    console.log(chalk.yellow('📸 正在截图...'));

    const screenshot = await this.page.screenshot({
      fullPage: false,
      encoding: 'binary',
    });

    if (path) {
      await this.page.screenshot({ path, fullPage: false });
      console.log(chalk.green(`✅ 截图已保存: ${path}`));
      return;
    }

    console.log(chalk.green('✅ 截图已完成'));
    return screenshot as Buffer;
  }

  /**
   * Print browsing statistics
   */
  public printStats(): void {
    const timeSpentSeconds = Math.round(this.stats.timeSpent / 1000);
    const timeSpentMinutes = (timeSpentSeconds / 60).toFixed(1);

    console.log(chalk.cyan(`\n📊 浏览统计:`));
    console.log(chalk.gray(`   观看视频: ${this.stats.videosWatched} 个`));
    console.log(chalk.gray(`   点赞: ${this.stats.videosLiked} 个`));
    console.log(chalk.gray(`   评论: ${this.stats.videosCommented} 条`));
    console.log(chalk.gray(`   用时: ${timeSpentSeconds} 秒 (${timeSpentMinutes} 分钟)`));
    console.log(chalk.gray(`   平均每个视频: ${(timeSpentSeconds / Math.max(1, this.stats.videosWatched)).toFixed(1)} 秒`));
  }

  /**
   * Close browser
   */
  public async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      console.log(chalk.green('✅ 浏览器已关闭'));
    }
  }

  /**
   * Helper: Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
