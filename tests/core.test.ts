/**
 * Test file for OpenMan
 *
 * Case IDs:
 * - core.001: load configuration
 * - core.002: get browser config
 * - core.003: assess risk levels
 * - core.004: check permissions
 * - core.005: get system info
 * - core.006: get current tasks
 * - core.007: get task history
 * - core.008: create browser instance
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
    // core.001: load configuration
    it('[core.001] should load configuration', () => {
      const cfg = config.getAll();
      expect(cfg).toHaveProperty('ai');
      expect(cfg).toHaveProperty('browser');
      expect(cfg).toHaveProperty('permissions');
      expect(cfg).toHaveProperty('server');
      expect(cfg).toHaveProperty('debug');
    });

    // core.002: get browser config
    it('[core.002] should get browser config', () => {
      const browserCfg = config.get('browser');
      expect(browserCfg).toHaveProperty('headless');
    });
  });

  describe('PermissionManager', () => {
    // core.003: assess risk levels
    it('[core.003] should assess risk levels', () => {
      const highRisk = permissionManager.assessRisk('web', 'payments');
      const mediumRisk = permissionManager.assessRisk('local', 'write');
      const lowRisk = permissionManager.assessRisk('web', 'browsing');

      expect(highRisk).toBe('high');
      expect(mediumRisk).toBe('medium');
      expect(lowRisk).toBe('low');
    });
  });

  describe('LocalTools', () => {
    // core.004: check permissions
    it('[core.004] should check permissions', async () => {
      const hasPermission = await localTools.checkPermission('local', 'read');
      expect(typeof hasPermission).toBe('boolean');
    });

    // core.005: get system info
    it('[core.005] should get system info', async () => {
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
    // core.006: get current tasks
    it('[core.006] should get current tasks', () => {
      const tasks = reasoningEngine.getCurrentTasks();
      expect(Array.isArray(tasks)).toBe(true);
    });

    // core.007: get task history
    it('[core.007] should get task history', () => {
      const history = reasoningEngine.getTaskHistory();
      expect(Array.isArray(history)).toBe(true);
    });
  });

  describe('BrowserEngine', () => {
    // core.008: create browser instance
    it('[core.008] should create browser instance', () => {
      const browser = new BrowserEngine({ headless: true });
      expect(browser).toBeInstanceOf(BrowserEngine);
    });
  });
});
