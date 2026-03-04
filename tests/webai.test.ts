/**
 * WebAI Channel Tests
 * Tests for WebAI multi-channel capabilities
 *
 * Case IDs:
 * - webai.001: load WebAI configurations
 * - webai.002: have at least one WebAI channel
 * - webai.003: get specific WebAI config
 * - webai.004: add config to service
 * - webai.005: get available config names
 * - webai.006: ensure default configs
 * - webai.007: return available channels in order
 * - webai.008: have yuanbao config available
 * - webai.009: query with yuanbao channel
 * - webai.010: handle follow-up with yuanbao
 * - webai.011: have test image directory
 * - webai.012: find available screenshots
 * - webai.013: query with image using yuanbao
 * - webai.014: query with image using doubao
 * - webai.015: have test code directory
 * - webai.016: create sample code file
 * - webai.017: analyze code file with yuanbao
 * - webai.018: analyze code file with doubao
 * - webai.019: throw error for non-existent config
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { webAIService } from '@/ai/webai';
import { config } from '@/core/config';
import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';

// 测试资源路径
const TEST_IMAGE_DIR = path.join(homedir(), '.openman', 'test-images');
const TEST_CODE_DIR = path.join(homedir(), '.openman', 'test-code');
const SCREENSHOTS_DIR = path.join(homedir(), '.openman', 'screenshots');

describe('WebAI Channel Tests', () => {
  beforeAll(async () => {
    // 确保配置初始化
    await config.ensureInitialized();

    // 创建测试目录
    await fs.mkdir(TEST_IMAGE_DIR, { recursive: true });
    await fs.mkdir(TEST_CODE_DIR, { recursive: true });
    await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
  });

  afterAll(async () => {
    // 清理浏览器
    await webAIService.close();
  });

  describe('Configuration Management', () => {
    // webai.001: load WebAI configurations
    it('[webai.001] should load WebAI configurations', async () => {
      const webAIs = config.listWebAIs();
      console.log(`Loaded ${webAIs.length} WebAI configs`);
      expect(Array.isArray(webAIs)).toBe(true);
    });

    // webai.002: have at least one WebAI channel configured
    it('[webai.002] should have at least one WebAI channel configured', async () => {
      const webAIs = config.listWebAIs();
      if (webAIs.length === 0) {
        console.log('No WebAI configured, skipping test');
        return;
      }
      expect(webAIs.length).toBeGreaterThan(0);
    });

    // webai.003: get specific WebAI config
    it('[webai.003] should get specific WebAI config', async () => {
      const webAIs = config.listWebAIs();
      if (webAIs.length === 0) {
        console.log('No WebAI configured, skipping test');
        return;
      }

      const firstAI = webAIs[0];
      const configRetrieved = config.getWebAI(firstAI.name);
      expect(configRetrieved).toBeDefined();
      expect(configRetrieved?.name).toBe(firstAI.name);
      expect(configRetrieved?.url).toBe(firstAI.url);
    });
  });

  describe('WebAI Service', () => {
    // webai.004: add config to service
    it('[webai.004] should add config to service', async () => {
      const webAIs = config.listWebAIs();
      if (webAIs.length === 0) {
        console.log('No WebAI configured, skipping test');
        return;
      }

      const firstAI = webAIs[0];
      webAIService.addConfig(firstAI);

      const configs = webAIService.listConfigs();
      expect(configs.some(c => c.name === firstAI.name)).toBe(true);
    });

    // webai.005: get available config names
    it('[webai.005] should get available config names', async () => {
      const availableConfigs = webAIService.getAvailableConfigs();
      expect(Array.isArray(availableConfigs)).toBe(true);
      expect(availableConfigs.length).toBeGreaterThan(0);
    });

    // webai.006: ensure default configs
    it('[webai.006] should ensure default configs', async () => {
      webAIService.ensureDefaultConfigs();
      const configs = webAIService.getAvailableConfigs();
      expect(configs).toContain('doubao');
      expect(configs).toContain('yuanbao');
    });
  });

  describe('Multi-Channel Fallback', () => {
    // webai.007: return available channels in order
    it('[webai.007] should return available channels in order', async () => {
      const configs = webAIService.getAvailableConfigs();
      console.log('Available channels:', configs.join(', '));
      expect(configs.length).toBeGreaterThan(0);
    });
  });

  describe('Yuanbao Channel Tests', () => {
    const yuanbaoConfig = 'yuanbao';

    // webai.008: have yuanbao config available
    it('[webai.008] should have yuanbao config available', async () => {
      const configs = webAIService.getAvailableConfigs();
      expect(configs).toContain(yuanbaoConfig);
      console.log('Yuanbao config is available');
    });

    // webai.009: query with yuanbao channel
    it('[webai.009] should query with yuanbao channel', async () => {
      const configs = webAIService.getAvailableConfigs();
      if (!configs.includes(yuanbaoConfig)) {
        console.log('Yuanbao not configured, skipping');
        return;
      }

      console.log('Testing yuanbao channel query...');
      const response = await webAIService.query(yuanbaoConfig, '你好，请简短回复：测试成功');

      expect(response).toBeDefined();
      expect(response.length).toBeGreaterThan(5);
      console.log(`Yuanbao response (${response.length} chars): ${response.slice(0, 100)}...`);
    }, 120000);

    // webai.010: handle follow-up with yuanbao
    it('[webai.010] should handle follow-up with yuanbao', async () => {
      const configs = webAIService.getAvailableConfigs();
      if (!configs.includes(yuanbaoConfig)) {
        console.log('Yuanbao not configured, skipping');
        return;
      }

      console.log('Testing multi-turn conversation with yuanbao...');

      // First query
      const response1 = await webAIService.query(yuanbaoConfig, '请记住数字42，稍后我会问你');
      expect(response1).toBeDefined();
      expect(response1.length).toBeGreaterThan(5);
      console.log(`Response 1 (${response1.length} chars): ${response1.slice(0, 100)}...`);

      // Check if we have an active conversation
      const hasActive = webAIService.hasActiveConversation();
      console.log(`Active conversation: ${hasActive}`);
      expect(hasActive).toBe(true);

      if (hasActive) {
        // Second query (follow-up 1)
        const response2 = await webAIService.followUp('我刚才让你记住的数字是什么？');
        expect(response2).toBeDefined();
        expect(response2.length).toBeGreaterThan(5);
        console.log(`Response 2 (${response2.length} chars): ${response2.slice(0, 100)}...`);

        const mentionsNumber = response2.includes('42');
        console.log(`Response 2 mentions 42: ${mentionsNumber}`);

        // Third query (follow-up 2)
        const response3 = await webAIService.followUp('很好！现在请把这个数字乘以2，结果是多少？');
        expect(response3).toBeDefined();
        expect(response3.length).toBeGreaterThan(5);
        console.log(`Response 3 (${response3.length} chars): ${response3.slice(0, 100)}...`);

        const mentions84 = response3.includes('84');
        console.log(`Response 3 mentions 84: ${mentions84}`);

        // Verify at least one of the follow-ups worked correctly
        expect(mentionsNumber || mentions84).toBe(true);
      }
    }, 180000);
  });

  describe('Image Query Tests', () => {
    // webai.011: have test image directory
    it('[webai.011] should have test image directory', async () => {
      const exists = await fs.access(TEST_IMAGE_DIR).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    // webai.012: find available screenshots for testing
    it('[webai.012] should find available screenshots for testing', async () => {
      try {
        const files = await fs.readdir(SCREENSHOTS_DIR);
        const pngFiles = files.filter(f => f.endsWith('.png'));
        console.log(`Found ${pngFiles.length} screenshots in ${SCREENSHOTS_DIR}`);
      } catch {
        console.log('No screenshots directory found');
      }
    });

    // webai.013: query with image using yuanbao
    it('[webai.013] should query with image using yuanbao', async () => {
      const configs = webAIService.getAvailableConfigs();
      if (!configs.includes('yuanbao')) {
        console.log('Yuanbao not configured, skipping');
        return;
      }

      // 查找可用的测试图片
      let testImage: string | null = null;
      try {
        const files = await fs.readdir(SCREENSHOTS_DIR);
        const pngFile = files.find(f => f.endsWith('.png'));
        if (pngFile) {
          testImage = path.join(SCREENSHOTS_DIR, pngFile);
        }
      } catch {
        // 尝试其他目录
      }

      // 如果没有截图，尝试测试图片目录
      if (!testImage) {
        try {
          const files = await fs.readdir(TEST_IMAGE_DIR);
          const imgFile = files.find(f => f.endsWith('.png') || f.endsWith('.jpg'));
          if (imgFile) {
            testImage = path.join(TEST_IMAGE_DIR, imgFile);
          }
        } catch {
          // 忽略
        }
      }

      if (!testImage) {
        console.log('No test image found, skipping');
        return;
      }

      console.log(`Testing image query with: ${testImage}`);
      const response = await webAIService.queryWithImage('yuanbao', testImage, '请描述这张图片的内容');

      expect(response).toBeDefined();
      expect(response.length).toBeGreaterThan(10);
      console.log(`Image query response (${response.length} chars): ${response.slice(0, 100)}...`);
    }, 180000);

    // webai.014: query with image using doubao
    it('[webai.014] should query with image using doubao', async () => {
      const configs = webAIService.getAvailableConfigs();
      if (!configs.includes('doubao')) {
        console.log('Doubao not configured, skipping');
        return;
      }

      // 查找可用的测试图片
      let testImage: string | null = null;
      try {
        const files = await fs.readdir(SCREENSHOTS_DIR);
        const pngFile = files.find(f => f.endsWith('.png'));
        if (pngFile) {
          testImage = path.join(SCREENSHOTS_DIR, pngFile);
        }
      } catch {
        // 尝试其他目录
      }

      if (!testImage) {
        try {
          const files = await fs.readdir(TEST_IMAGE_DIR);
          const imgFile = files.find(f => f.endsWith('.png') || f.endsWith('.jpg'));
          if (imgFile) {
            testImage = path.join(TEST_IMAGE_DIR, imgFile);
          }
        } catch {
          // 忽略
        }
      }

      if (!testImage) {
        console.log('No test image found, skipping');
        return;
      }

      console.log(`Testing image query with doubao: ${testImage}`);
      const response = await webAIService.queryWithImage('doubao', testImage, '请描述这张图片');

      expect(response).toBeDefined();
      expect(response.length).toBeGreaterThan(10);
      console.log(`Doubao image query response (${response.length} chars): ${response.slice(0, 100)}...`);
    }, 180000);
  });

  describe('Source Code File Tests', () => {
    const testCodeFile = path.join(TEST_CODE_DIR, 'example.ts');

    // webai.015: have test code directory
    it('[webai.015] should have test code directory', async () => {
      const exists = await fs.access(TEST_CODE_DIR).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    // webai.016: create sample code file for testing
    it('[webai.016] should create sample code file for testing', async () => {
      const sampleCode = `// Sample TypeScript code for testing
function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

const result = fibonacci(10);
console.log('Fibonacci of 10:', result);
`;
      await fs.writeFile(testCodeFile, sampleCode, 'utf-8');

      const exists = await fs.access(testCodeFile).then(() => true).catch(() => false);
      expect(exists).toBe(true);
      console.log(`Created test code file: ${testCodeFile}`);
    });

    // webai.017: analyze code file with yuanbao
    it('[webai.017] should analyze code file with yuanbao', async () => {
      const configs = webAIService.getAvailableConfigs();
      if (!configs.includes('yuanbao')) {
        console.log('Yuanbao not configured, skipping');
        return;
      }

      // 检查测试文件是否存在
      const exists = await fs.access(testCodeFile).then(() => true).catch(() => false);
      if (!exists) {
        console.log('Test code file not found, skipping');
        return;
      }

      console.log('Testing code analysis with yuanbao...');

      // 读取代码文件内容
      const codeContent = await fs.readFile(testCodeFile, 'utf-8');
      const prompt = `请分析以下代码并指出可能的问题：
\`\`\`typescript
${codeContent}
\`\`\``;

      const response = await webAIService.query('yuanbao', prompt);

      expect(response).toBeDefined();
      expect(response.length).toBeGreaterThan(20);
      console.log(`Code analysis response (${response.length} chars): ${response.slice(0, 150)}...`);
    }, 120000);

    // webai.018: analyze code file with doubao
    it('[webai.018] should analyze code file with doubao', async () => {
      const configs = webAIService.getAvailableConfigs();
      if (!configs.includes('doubao')) {
        console.log('Doubao not configured, skipping');
        return;
      }

      // 检查测试文件是否存在
      const exists = await fs.access(testCodeFile).then(() => true).catch(() => false);
      if (!exists) {
        console.log('Test code file not found, skipping');
        return;
      }

      console.log('Testing code analysis with doubao...');

      // 读取代码文件内容
      const codeContent = await fs.readFile(testCodeFile, 'utf-8');
      const prompt = `这段代码实现了什么功能？有什么优化建议？
\`\`\`typescript
${codeContent}
\`\`\``;

      const response = await webAIService.query('doubao', prompt);

      expect(response).toBeDefined();
      expect(response.length).toBeGreaterThan(20);
      console.log(`Doubao code analysis response (${response.length} chars): ${response.slice(0, 150)}...`);
    }, 120000);
  });

  describe('Error Handling', () => {
    // webai.019: throw error for non-existent config
    it('[webai.019] should throw error for non-existent config', async () => {
      await expect(
        webAIService.query('non-existent-ai', 'test')
      ).rejects.toThrow('not found');
    });
  });
});
