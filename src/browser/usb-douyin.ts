/**
 * USB Device Douyin Controller - Control Douyin app on connected Android device
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import chalk from 'chalk';

const execAsync = promisify(exec);

export interface DouyinConfig {
  deviceId?: string;
  watchDuration?: {
    min?: number; // 最小观看时长（秒）
    max?: number; // 最大观看时长（秒）
  };
  autoLike?: boolean;
  autoCollect?: boolean;
  autoComment?: boolean;
  commentProbability?: number; // 评论概率 0-1
  likeProbability?: number; // 点赞概率 0-1
  collectProbability?: number; // 收藏概率 0-1
  watchUntilEnd?: boolean; // 是否看完视频
  analyzeWithAI?: boolean; // 是否使用 AI 分析
  webAIName?: string; // Web AI 名称
}

export interface DouyinStats {
  videosWatched: number;
  videosLiked: number;
  videosCollected: number;
  videosCommented: number;
  totalWatchTime: number; // 总观看时间（秒）
  analyses: Array<{
    videoIndex: number;
    aiAnalysis: string;
  }>;
}

export interface VideoInfo {
  author: string;
  content: string;
  likes: string;
  comments: string;
  timestamp: string;
}

export class USBDeviceDouyin {
  private adbPath: string;
  private deviceId: string;
  private screenInfo: { width: number; height: number; density: number } | null = null;
  private stats: DouyinStats = {
    videosWatched: 0,
    videosLiked: 0,
    videosCollected: 0,
    videosCommented: 0,
    totalWatchTime: 0,
    analyses: [],
  };
  private screenshotDir: string;

  constructor(config: DouyinConfig = {}) {
    // Try to find adb in common locations
    this.adbPath = this.findAdb();
    this.deviceId = config.deviceId || '';
    this.screenshotDir = path.join(homedir(), '.openman', 'douyin-screenshots');

    // Create screenshot directory
    fs.mkdir(this.screenshotDir, { recursive: true }).catch(() => {});
  }

  private findAdb(): string {
    const commonPaths = [
      path.join(homedir(), 'Library/Android/sdk/platform-tools/adb'),
      '/opt/homebrew/bin/adb',
      '/usr/local/bin/adb',
      '/usr/bin/adb',
    ];

    for (const adbPath of commonPaths) {
      try {
        if (require('fs').existsSync(adbPath)) {
          return adbPath;
        }
      } catch {
        continue;
      }
    }
    return 'adb'; // Fallback to PATH
  }

  /**
   * Get connected device ID
   */
  private async getDeviceId(): Promise<string> {
    if (this.deviceId) {
      return this.deviceId;
    }

    const { stdout } = await execAsync(`${this.adbPath} devices -l`);
    const lines = stdout.split('\n').slice(1);

    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.split(/\s+/);
      if (parts.length >= 2 && parts[1] === 'device') {
        this.deviceId = parts[0];
        return this.deviceId;
      }
    }

    throw new Error('No connected device found');
  }

  /**
   * Get screen info
   */
  private async getScreenInfo(): Promise<{ width: number; height: number; density: number }> {
    if (this.screenInfo) {
      return this.screenInfo;
    }

    const deviceId = await this.getDeviceId();
    const { stdout } = await execAsync(`${this.adbPath} -s ${deviceId} shell wm size`);
    const match = stdout.match(/Physical size: (\d+)x(\d+)/);

    if (!match) {
      throw new Error('Failed to get screen size');
    }

    this.screenInfo = {
      width: parseInt(match[1]),
      height: parseInt(match[2]),
      density: 320, // Default density
    };

    return this.screenInfo;
  }

  /**
   * Take screenshot and save to file
   */
  private async takeScreenshot(): Promise<string> {
    const deviceId = await this.getDeviceId();
    const timestamp = Date.now();
    const filename = `douyin_${timestamp}.png`;
    const localPath = path.join(this.screenshotDir, filename);
    const devicePath = `/sdcard/${filename}`;

    // Take screenshot on device
    await execAsync(`${this.adbPath} -s ${deviceId} shell screencap -p ${devicePath}`);

    // Pull screenshot to local
    await execAsync(`${this.adbPath} -s ${deviceId} pull ${devicePath} ${localPath}`);

    // Delete from device
    await execAsync(`${this.adbPath} -s ${deviceId} shell rm ${devicePath}`);

    return localPath;
  }

  /**
   * Tap on screen
   */
  private async tap(x: number, y: number): Promise<void> {
    const deviceId = await this.getDeviceId();
    await execAsync(`${this.adbPath} -s ${deviceId} shell input tap ${x} ${y}`);
  }

  /**
   * Swipe on screen
   */
  private async swipe(x1: number, y1: number, x2: number, y2: number, duration: number = 300): Promise<void> {
    const deviceId = await this.getDeviceId();
    await execAsync(`${this.adbPath} -s ${deviceId} shell input swipe ${x1} ${y1} ${x2} ${y2} ${duration}`);
  }

  /**
   * Send text input
   */
  private async inputText(text: string): Promise<void> {
    const deviceId = await this.getDeviceId();
    await execAsync(`${this.adbPath} -s ${deviceId} shell input text "${text.replace(/ /g, '%s')}"`);
  }

  /**
   * Press back key
   */
  private async pressBack(): Promise<void> {
    const deviceId = await this.getDeviceId();
    await execAsync(`${this.adbPath} -s ${deviceId} shell input keyevent KEYCODE_BACK`);
  }

  /**
   * Open Douyin app
   */
  public async openDouyin(): Promise<void> {
    console.log(chalk.yellow('📱 正在打开抖音 App...'));

    const deviceId = await this.getDeviceId();

    // Try to open Douyin using different methods
    try {
      // Method 1: Try by package name
      await execAsync(`${this.adbPath} -s ${deviceId} shell am start -n com.ss.android.ugc.aweme/.main.MainActivity`);
    } catch {
      try {
        // Method 2: Try by action
        await execAsync(`${this.adbPath} -s ${deviceId} shell monkey -p com.ss.android.ugc.aweme -c android.intent.category.LAUNCHER 1`);
      } catch {
        console.log(chalk.yellow('⚠️  无法自动打开抖音，请手动打开抖音 App'));
      }
    }

    // Wait for app to open
    await this.sleep(3000);

    console.log(chalk.green('✅ 抖音已启动'));
  }

  /**
   * Watch current video with random duration
   */
  private async watchVideo(config: DouyinConfig): Promise<number> {
    const { watchDuration = {}, watchUntilEnd = false } = config;
    const minDuration = watchDuration.min || 3; // 最少 3 秒
    const maxDuration = watchDuration.max || 15; // 最多 15 秒

    // Calculate watch duration
    let watchTime: number;
    if (watchUntilEnd && Math.random() > 0.3) {
      // 70% chance to watch full video (simulate 15-60 seconds)
      watchTime = Math.floor(Math.random() * 45) + 15;
    } else {
      // Random duration between min and max
      watchTime = Math.floor(Math.random() * (maxDuration - minDuration)) + minDuration;
    }

    console.log(chalk.gray(`   ⏱️  观看 ${watchTime} 秒`));

    // Simulate watching
    await this.sleep(watchTime * 1000);

    return watchTime;
  }

  /**
   * Like current video
   */
  private async likeVideo(config: DouyinConfig): Promise<boolean> {
    const { autoLike = false, likeProbability = 0.4 } = config;

    if (!autoLike || Math.random() > likeProbability) {
      return false;
    }

    try {
      const screenInfo = await this.getScreenInfo();

      // Like button position (bottom right, typically)
      // Adjust coordinates based on screen size
      const likeX = Math.floor(screenInfo.width * 0.85);
      const likeY = Math.floor(screenInfo.height * 0.75);

      await this.tap(likeX, likeY);

      // Wait a bit
      await this.sleep(500);

      this.stats.videosLiked++;
      console.log(chalk.blue('   💖 已点赞'));
      return true;
    } catch (error) {
      console.log(chalk.gray('   ⚠️  点赞失败'));
      return false;
    }
  }

  /**
   * Collect/Save current video
   */
  private async collectVideo(config: DouyinConfig): Promise<boolean> {
    const { autoCollect = false, collectProbability = 0.2 } = config;

    if (!autoCollect || Math.random() > collectProbability) {
      return false;
    }

    try {
      const screenInfo = await this.getScreenInfo();

      // Collect button position (bottom right, below like)
      const collectX = Math.floor(screenInfo.width * 0.85);
      const collectY = Math.floor(screenInfo.height * 0.82);

      await this.tap(collectX, collectY);

      await this.sleep(500);

      this.stats.videosCollected++;
      console.log(chalk.yellow('   ⭐ 已收藏'));
      return true;
    } catch (error) {
      console.log(chalk.gray('   ⚠️  收藏失败'));
      return false;
    }
  }

  /**
   * Comment on current video
   */
  private async commentVideo(config: DouyinConfig): Promise<boolean> {
    const { autoComment = false, commentProbability = 0.1 } = config;

    if (!autoComment || Math.random() > commentProbability) {
      return false;
    }

    try {
      const screenInfo = await this.getScreenInfo();

      // Tap comment area (bottom center)
      const commentX = Math.floor(screenInfo.width * 0.50);
      const commentY = Math.floor(screenInfo.height * 0.88);

      await this.tap(commentX, commentY);
      await this.sleep(1000);

      // Type a random comment
      const comments = [
        '不错！',
        '加油！',
        '很棒！',
        '👍',
        '哈哈哈',
        '太厉害了',
        '支持一下',
        '学到了',
      ];
      const randomComment = comments[Math.floor(Math.random() * comments.length)];

      await this.inputText(randomComment);
      await this.sleep(500);

      // Submit (tap send button - typically on the right)
      const sendX = Math.floor(screenInfo.width * 0.92);
      const sendY = Math.floor(screenInfo.height * 0.88);
      await this.tap(sendX, sendY);

      await this.sleep(1000);

      this.stats.videosCommented++;
      console.log(chalk.blue(`   💬 已评论: ${randomComment}`));
      return true;
    } catch (error) {
      console.log(chalk.gray('   ⚠️  评论失败'));
      return false;
    }
  }

  /**
   * Analyze video with Web AI
   */
  private async analyzeWithAI(screenshotPath: string, videoIndex: number, config: DouyinConfig): Promise<void> {
    if (!config.analyzeWithAI || !config.webAIName) {
      return;
    }

    try {
      console.log(chalk.gray('   🤖 AI 分析中...'));

      // Import web AI service
      const { webAIService } = await import('@/ai/webai');
      const { config: openmanConfig } = await import('@/core/config');

      const aiConfig = openmanConfig.getWebAI(config.webAIName);
      if (!aiConfig) {
        console.log(chalk.yellow(`   ⚠️  Web AI "${config.webAIName}" 未配置`));
        return;
      }

      webAIService.addConfig(aiConfig);

      const prompt = '分析这个抖音视频截图，描述：1）视频内容 2）作者信息 3）点赞数、评论数 4）建议的评论内容';
      const analysis = await webAIService.queryWithImage(config.webAIName, screenshotPath, prompt);

      this.stats.analyses.push({
        videoIndex,
        aiAnalysis: analysis,
      });

      console.log(chalk.cyan(`   🤖 AI: ${analysis.substring(0, 100)}...`));

      await webAIService.close();
    } catch (error: any) {
      console.log(chalk.red(`   ❌ AI 分析失败: ${error.message}`));
    }
  }

  /**
   * Scroll to next video
   */
  private async scrollToNextVideo(): Promise<void> {
    const screenInfo = await this.getScreenInfo();

    // Swipe up to next video
    const startX = Math.floor(screenInfo.width * 0.5);
    const startY = Math.floor(screenInfo.height * 0.7);
    const endX = Math.floor(screenInfo.width * 0.5);
    const endY = Math.floor(screenInfo.height * 0.3);

    await this.swipe(startX, startY, endX, endY, 300);

    // Wait for next video to load
    await this.sleep(1000);
  }

  /**
   * Browse Douyin automatically
   */
  public async browse(count: number = 10, config: DouyinConfig = {}): Promise<DouyinStats> {
    console.log(chalk.cyan(`\n🎭 OpenMan 开始刷抖音（USB 设备）...`));
    console.log(chalk.gray(`📱 设备 ID: ${await this.getDeviceId()}`));
    console.log(chalk.gray(`📊 计划观看 ${count} 个视频\n`));

    // Apply default config
    const finalConfig: DouyinConfig = {
      watchDuration: { min: 3, max: 15 },
      autoLike: false,
      autoCollect: false,
      autoComment: false,
      likeProbability: 0.4,
      commentProbability: 0.1,
      collectProbability: 0.2,
      watchUntilEnd: true,
      analyzeWithAI: false,
      ...config,
    };

    for (let i = 1; i <= count; i++) {
      console.log(chalk.yellow(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
      console.log(chalk.cyan(`📱 观看第 ${i} 个视频`));

      try {
        // Watch video
        const watchTime = await this.watchVideo(finalConfig);
        this.stats.videosWatched++;
        this.stats.totalWatchTime += watchTime;

        // Screenshot and analyze
        if (finalConfig.analyzeWithAI) {
          const screenshotPath = await this.takeScreenshot();
          await this.analyzeWithAI(screenshotPath, i, finalConfig);
        }

        // Interact with video
        await Promise.all([
          this.likeVideo(finalConfig),
          this.collectVideo(finalConfig),
          this.commentVideo(finalConfig),
        ]);

        // Scroll to next video
        if (i < count) {
          console.log(chalk.gray('   ⬆️  滑动到下一个视频'));
          await this.scrollToNextVideo();
        }
      } catch (error: any) {
        console.log(chalk.red(`   ❌ 处理第 ${i} 个视频失败: ${error.message}`));
      }
    }

    console.log(chalk.yellow(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
    console.log(chalk.cyan(`🎬 浏览完成！`));
    this.printStats();

    return this.stats;
  }

  /**
   * Print browsing statistics
   */
  private printStats(): void {
    const avgWatchTime = (this.stats.totalWatchTime / Math.max(1, this.stats.videosWatched)).toFixed(1);

    console.log(chalk.cyan(`\n📊 浏览统计:`));
    console.log(chalk.gray(`   观看视频: ${this.stats.videosWatched} 个`));
    console.log(chalk.gray(`   点赞: ${this.stats.videosLiked} 个`));
    console.log(chalk.gray(`   收藏: ${this.stats.videosCollected} 个`));
    console.log(chalk.gray(`   评论: ${this.stats.videosCommented} 条`));
    console.log(chalk.gray(`   总观看时间: ${this.stats.totalWatchTime} 秒`));
    console.log(chalk.gray(`   平均每个视频: ${avgWatchTime} 秒`));

    if (this.stats.analyses.length > 0) {
      console.log(chalk.gray(`   AI 分析: ${this.stats.analyses.length} 次`));
    }
  }

  /**
   * Close (cleanup)
   */
  public async close(): Promise<void> {
    // No specific cleanup needed
    console.log(chalk.green('✅ 已完成'));
  }

  /**
   * Helper: Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
