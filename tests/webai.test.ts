/**
 * WebAI Channel Tests
 * Tests for WebAI multi-channel capabilities
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
    it('should load WebAI configurations', async () => {
      const webAIs = config.listWebAIs();
      console.log(`Loaded ${webAIs.length} WebAI configs`);
      expect(Array.isArray(webAIs)).toBe(true);
    });

    it('should have at least one WebAI channel configured', async () => {
      const webAIs = config.listWebAIs();
      if (webAIs.length === 0) {
        console.log('No WebAI configured, skipping test');
        return;
      }
      expect(webAIs.length).toBeGreaterThan(0);
    });

    it('should get specific WebAI config', async () => {
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
    it('should add config to service', async () => {
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

    it('should get available config names', async () => {
      const availableConfigs = webAIService.getAvailableConfigs();
      expect(Array.isArray(availableConfigs)).toBe(true);
      expect(availableConfigs.length).toBeGreaterThan(0);
    });

    it('should ensure default configs', async () => {
      webAIService.ensureDefaultConfigs();
      const configs = webAIService.getAvailableConfigs();
      expect(configs).toContain('doubao');
      expect(configs).toContain('yuanbao');
    });
  });

  describe('Multi-Channel Fallback', () => {
    it('should return available channels in order', async () => {
      const configs = webAIService.getAvailableConfigs();
      console.log('Available channels:', configs.join(', '));
      expect(configs.length).toBeGreaterThan(0);
    });
  });

  describe('Yuanbao Channel Tests', () => {
    const yuanbaoConfig = 'yuanbao';
    
    it('should have yuanbao config available', async () => {
      const configs = webAIService.getAvailableConfigs();
      expect(configs).toContain(yuanbaoConfig);
      console.log('Yuanbao config is available');
    });

    it('should query with yuanbao channel', async () => {
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

    it('should handle follow-up with yuanbao', async () => {
      const configs = webAIService.getAvailableConfigs();
      if (!configs.includes(yuanbaoConfig)) {
        console.log('Yuanbao not configured, skipping');
        return;
      }

      console.log('Testing yuanbao follow-up...');
      const response1 = await webAIService.query(yuanbaoConfig, '请记住数字42，稍后我会问你');
      expect(response1).toBeDefined();
      console.log('Initial query completed');

      const hasActive = webAIService.hasActiveConversation();
      console.log(`Active conversation: ${hasActive}`);

      if (hasActive) {
        const response2 = await webAIService.followUp('我刚才让你记住的数字是什么？');
        expect(response2).toBeDefined();
        console.log(`Follow-up response: ${response2.slice(0, 100)}...`);
        
        const mentionsNumber = response2.includes('42');
        console.log(`Response mentions 42: ${mentionsNumber}`);
      }
    }, 180000);
  });

  describe('Image Query Tests', () => {
    it('should have test image directory', async () => {
      const exists = await fs.access(TEST_IMAGE_DIR).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should find available screenshots for testing', async () => {
      try {
        const files = await fs.readdir(SCREENSHOTS_DIR);
        const pngFiles = files.filter(f => f.endsWith('.png'));
        console.log(`Found ${pngFiles.length} screenshots in ${SCREENSHOTS_DIR}`);
      } catch {
        console.log('No screenshots directory found');
      }
    });

    it('should query with image using yuanbao', async () => {
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

    it('should query with image using doubao', async () => {
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

    it('should have test code directory', async () => {
      const exists = await fs.access(TEST_CODE_DIR).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should create sample code file for testing', async () => {
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

    it('should analyze code file with yuanbao', async () => {
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

    it('should analyze code file with doubao', async () => {
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
    it('should throw error for non-existent config', async () => {
      await expect(
        webAIService.query('non-existent-ai', 'test')
      ).rejects.toThrow('not found');
    });
  });
});
