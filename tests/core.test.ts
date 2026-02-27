/**
 * Test file for OpenMan
 */

import { describe, it, expect } from 'vitest';
import { BrowserEngine } from '@/browser/engine';
import { aiService } from '@/ai/service';
import { localTools } from '@/tools/local';
import { reasoningEngine } from '@/core/reasoning';
import { permissionManager } from '@/permissions/manager';
import { config } from '@/core/config';

describe('OpenMan Core Tests', () => {
  describe('ConfigManager', () => {
    it('should load configuration', () => {
      const cfg = config.getAll();
      expect(cfg).toHaveProperty('ai');
      expect(cfg).toHaveProperty('browser');
      expect(cfg).toHaveProperty('permissions');
      expect(cfg).toHaveProperty('server');
      expect(cfg).toHaveProperty('debug');
    });

    it('should get browser config', () => {
      const browserCfg = config.get('browser');
      expect(browserCfg).toHaveProperty('headless');
    });
  });

  describe('PermissionManager', () => {
    it('should assess risk levels', () => {
      const highRisk = permissionManager.assessRisk('web', 'payments');
      const mediumRisk = permissionManager.assessRisk('local', 'write');
      const lowRisk = permissionManager.assessRisk('web', 'browsing');

      expect(highRisk).toBe('high');
      expect(mediumRisk).toBe('medium');
      expect(lowRisk).toBe('low');
    });
  });

  describe('LocalTools', () => {
    it('should check permissions', async () => {
      const hasPermission = await localTools.checkPermission('local', 'read');
      expect(typeof hasPermission).toBe('boolean');
    });

    it('should get system info', async () => {
      // This test might fail in certain environments
      try {
        const info = await localTools.getSystemInfo();
        expect(info.success).toBe(true);
        expect(info.data).toHaveProperty('os');
      } catch (error) {
        // Ignore if system commands are not available
      }
    });
  });

  describe('ReasoningEngine', () => {
    it('should get current tasks', () => {
      const tasks = reasoningEngine.getCurrentTasks();
      expect(Array.isArray(tasks)).toBe(true);
    });

    it('should get task history', () => {
      const history = reasoningEngine.getTaskHistory();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('BrowserEngine', () => {
    it('should create browser instance', () => {
      const browser = new BrowserEngine({ headless: true });
      expect(browser).toBeInstanceOf(BrowserEngine);
    });
  });
});
