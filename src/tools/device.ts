/**
 * Device Tools - Screenshot and device management
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { homedir } from 'os';
import type { ToolResult } from '@/types';

const execAsync = promisify(exec);

export interface DeviceInfo {
  id: string;
  model: string;
  androidVersion: string;
  status: 'device' | 'offline' | 'unauthorized';
}

export interface ScreenshotOptions {
  deviceId?: string;
  outputDir?: string;
  filename?: string;
}

export class DeviceTools {
  private adbPath: string;
  private defaultOutputDir: string;

  constructor() {
    // Try to find adb in common locations
    this.adbPath = this.findAdb();
    this.defaultOutputDir = path.join(homedir(), '.openman', 'screenshots');
  }

  private findAdb(): string {
    const commonPaths = [
      // macOS paths
      path.join(homedir(), 'Library/Android/sdk/platform-tools/adb'),
      '/opt/homebrew/bin/adb',
      // Linux paths
      path.join(homedir(), 'Android/Sdk/platform-tools/adb'),
      '/usr/bin/adb',
      '/usr/local/bin/adb',
      // Windows path
      path.join(homedir(), 'AppData/Local/Android/Sdk/platform-tools/adb.exe'),
    ];

    for (const adbPath of commonPaths) {
      try {
        if (existsSync(adbPath)) {
          return adbPath;
        }
      } catch {
        continue;
      }
    }
    return 'adb'; // Fallback to PATH
  }

  /**
   * List connected devices
   */
  public async listDevices(): Promise<DeviceInfo[]> {
    try {
      const { stdout } = await execAsync(`${this.adbPath} devices -l`);
      const lines = stdout.split('\n').slice(1); // Skip header
      const devices: DeviceInfo[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;

        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          const id = parts[0];
          const status = parts[1] as DeviceInfo['status'];

          if (status === 'device') {
            // Get device info
            let model = 'Unknown';
            let androidVersion = 'Unknown';

            try {
              const { stdout: modelOut } = await execAsync(
                `${this.adbPath} -s ${id} shell getprop ro.product.model`
              );
              model = modelOut.trim();

              const { stdout: versionOut } = await execAsync(
                `${this.adbPath} -s ${id} shell getprop ro.build.version.release`
              );
              androidVersion = versionOut.trim();
            } catch {
              // Ignore errors getting device info
            }

            devices.push({ id, model, androidVersion, status });
          }
        }
      }

      return devices;
    } catch (error) {
      throw new Error(`Failed to list devices: ${(error as Error).message}`);
    }
  }

  /**
   * Take a screenshot from device
   */
  public async takeScreenshot(options: ScreenshotOptions = {}): Promise<ToolResult> {
    const devices = await this.listDevices();

    if (devices.length === 0) {
      return {
        success: false,
        error: 'No devices connected. Please connect a device via USB.',
      };
    }

    const device = options.deviceId
      ? devices.find(d => d.id === options.deviceId)
      : devices[0];

    if (!device) {
      return {
        success: false,
        error: `Device ${options.deviceId} not found`,
      };
    }

    // Create output directory
    const outputDir = options.outputDir || this.defaultOutputDir;
    await fs.mkdir(outputDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = options.filename || `screenshot-${timestamp}.png`;
    const localPath = path.join(outputDir, filename);
    const devicePath = '/sdcard/screenshot.png';

    try {
      // Take screenshot on device
      await execAsync(
        `${this.adbPath} -s ${device.id} shell screencap -p ${devicePath}`
      );

      // Pull to local
      await execAsync(
        `${this.adbPath} -s ${device.id} pull ${devicePath} "${localPath}"`
      );

      // Clean up device
      await execAsync(
        `${this.adbPath} -s ${device.id} shell rm ${devicePath}`
      );

      // Get file info
      const stats = await fs.stat(localPath);

      return {
        success: true,
        data: {
          path: localPath,
          filename,
          size: stats.size,
          device: device.model,
          deviceId: device.id,
          androidVersion: device.androidVersion,
          timestamp: new Date(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Screenshot failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Get device screen info
   */
  public async getScreenInfo(deviceId?: string): Promise<ToolResult> {
    const devices = await this.listDevices();

    if (devices.length === 0) {
      return { success: false, error: 'No devices connected' };
    }

    const device = deviceId
      ? devices.find(d => d.id === deviceId)
      : devices[0];

    if (!device) {
      return { success: false, error: `Device ${deviceId} not found` };
    }

    try {
      const { stdout } = await execAsync(
        `${this.adbPath} -s ${device.id} shell wm size`
      );
      const sizeMatch = stdout.match(/Physical size: (\d+x\d+)/);

      const { stdout: densityOut } = await execAsync(
        `${this.adbPath} -s ${device.id} shell wm density`
      );
      const densityMatch = densityOut.match(/Physical density: (\d+)/);

      return {
        success: true,
        data: {
          device: device.model,
          deviceId: device.id,
          resolution: sizeMatch ? sizeMatch[1] : 'Unknown',
          density: densityMatch ? parseInt(densityMatch[1]) : 'Unknown',
          androidVersion: device.androidVersion,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to get screen info: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Tap on screen at coordinates
   */
  public async tap(x: number, y: number, deviceId?: string): Promise<ToolResult> {
    const devices = await this.listDevices();
    if (devices.length === 0) {
      return { success: false, error: 'No devices connected' };
    }

    const device = deviceId
      ? devices.find(d => d.id === deviceId)
      : devices[0];

    if (!device) {
      return { success: false, error: `Device ${deviceId} not found` };
    }

    try {
      await execAsync(
        `${this.adbPath} -s ${device.id} shell input tap ${x} ${y}`
      );
      return {
        success: true,
        data: { action: 'tap', x, y, device: device.model },
      };
    } catch (error) {
      return {
        success: false,
        error: `Tap failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Send text to device (supports Chinese via broadcast)
   */
  public async sendText(text: string, deviceId?: string): Promise<ToolResult> {
    const devices = await this.listDevices();
    if (devices.length === 0) {
      return { success: false, error: 'No devices connected' };
    }

    const device = deviceId
      ? devices.find(d => d.id === deviceId)
      : devices[0];

    if (!device) {
      return { success: false, error: `Device ${deviceId} not found` };
    }

    try {
      // Check if text contains non-ASCII (Chinese, etc.)
      const hasNonAscii = /[^\x00-\x7F]/.test(text);
      
      if (hasNonAscii) {
        // Use ADB broadcast for Chinese text (requires ADBKeyboard app)
        // Fallback: use base64 encoding with am broadcast
        const base64Text = Buffer.from(text).toString('base64');
        try {
          // Try ADBKeyboard first
          await execAsync(
            `${this.adbPath} -s ${device.id} shell am broadcast -a ADB_INPUT_B64 --es msg '${base64Text}'`
          );
        } catch {
          // Fallback: input each character via clipboard
          // This requires the device to support clipboard
          await execAsync(
            `${this.adbPath} -s ${device.id} shell "echo '${text}' | am broadcast -a clipper.set"`
          );
          // Paste from clipboard (Ctrl+V)
          await execAsync(
            `${this.adbPath} -s ${device.id} shell input keyevent 279`
          ); // KEYCODE_PASTE
        }
      } else {
        // ASCII text - use standard input text
        const escapedText = text.replace(/\s/g, '%s').replace(/'/g, "\\'");
        await execAsync(
          `${this.adbPath} -s ${device.id} shell input text '${escapedText}'`
        );
      }
      
      return {
        success: true,
        data: { action: 'input', text, device: device.model },
      };
    } catch (error) {
      return {
        success: false,
        error: `Text input failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Press key
   */
  public async pressKey(keyCode: string, deviceId?: string): Promise<ToolResult> {
    const devices = await this.listDevices();
    if (devices.length === 0) {
      return { success: false, error: 'No devices connected' };
    }

    const device = deviceId
      ? devices.find(d => d.id === deviceId)
      : devices[0];

    if (!device) {
      return { success: false, error: `Device ${deviceId} not found` };
    }

    const keyMap: Record<string, string> = {
      home: 'KEYCODE_HOME',
      back: 'KEYCODE_BACK',
      menu: 'KEYCODE_MENU',
      enter: 'KEYCODE_ENTER',
      search: 'KEYCODE_SEARCH',
      volume_up: 'KEYCODE_VOLUME_UP',
      volume_down: 'KEYCODE_VOLUME_DOWN',
      power: 'KEYCODE_POWER',
    };

    const key = keyMap[keyCode.toLowerCase()] || keyCode;

    try {
      await execAsync(
        `${this.adbPath} -s ${device.id} shell input keyevent ${key}`
      );
      return {
        success: true,
        data: { action: 'keyevent', key, device: device.model },
      };
    } catch (error) {
      return {
        success: false,
        error: `Key press failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Input text (wrapper for sendText with deviceId first)
   */
  public async inputText(deviceId: string, text: string): Promise<ToolResult> {
    return this.sendText(text, deviceId);
  }

  /**
   * Swipe on device screen
   */
  public async swipe(
    deviceId: string,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    duration: number = 300
  ): Promise<ToolResult> {
    const devices = await this.listDevices();
    if (devices.length === 0) {
      return { success: false, error: 'No devices connected' };
    }

    const device = devices.find(d => d.id === deviceId) || devices[0];
    if (!device) {
      return { success: false, error: `Device ${deviceId} not found` };
    }

    try {
      await execAsync(
        `${this.adbPath} -s ${device.id} shell input swipe ${startX} ${startY} ${endX} ${endY} ${duration}`
      );
      return {
        success: true,
        data: { action: 'swipe', from: { x: startX, y: startY }, to: { x: endX, y: endY }, device: device.model },
      };
    } catch (error) {
      return {
        success: false,
        error: `Swipe failed: ${(error as Error).message}`,
      };
    }
  }
}

// Singleton instance
export const deviceTools = new DeviceTools();
