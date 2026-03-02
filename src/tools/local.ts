/**
 * Local tools manager for OpenMan
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import type { ToolResult, ToolPermission } from '@/types';
import { config } from '@/core/config';
import { auditLogger } from '@/core/audit';

const execAsync = promisify(exec);

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error occurred';
}

function getErrorStdout(error: unknown): string {
  if (error && typeof error === 'object' && 'stdout' in error) {
    return String((error as { stdout?: string }).stdout ?? '').trim();
  }
  return '';
}

function getErrorStderr(error: unknown): string {
  if (error && typeof error === 'object' && 'stderr' in error) {
    return String((error as { stderr?: string }).stderr ?? '').trim();
  }
  return '';
}

export class LocalTools {
  private permissions = config.get('permissions');

  public async executeCommand(
    command: string,
    args: string[] = []
  ): Promise<ToolResult> {
    const permission = this.permissions.local.execute;

    if (permission === 'never') {
      return {
        success: false,
        error: 'Command execution is disabled by permission settings',
      };
    }

    if (permission === 'ask') {
      // TODO: Implement user approval flow
      return {
        success: false,
        error: 'Command execution requires user approval',
      };
    }

    try {
      await auditLogger.log({
        timestamp: new Date(),
        action: 'local.execute',
        details: { command, args },
        result: 'success',
        riskLevel: 'medium',
      });

      const { stdout, stderr } = await execAsync(command, {
        cwd: process.cwd(),
      });

      return {
        success: true,
        data: {
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error),
        data: {
          stdout: getErrorStdout(error),
          stderr: getErrorStderr(error),
        },
      };
    }
  }

  public async readFile(filePath: string): Promise<ToolResult> {
    const permission = this.permissions.local.read;

    if (permission === 'never') {
      return {
        success: false,
        error: 'File reading is disabled by permission settings',
      };
    }

    if (permission === 'workspace') {
      const cwd = process.cwd();
      const resolvedPath = path.resolve(filePath);
      if (!resolvedPath.startsWith(cwd)) {
        return {
          success: false,
          error: 'File is outside of workspace directory',
        };
      }
    }

    try {
      await auditLogger.log({
        timestamp: new Date(),
        action: 'local.readFile',
        details: { filePath },
        result: 'success',
        riskLevel: 'low',
      });

      const content = await fs.readFile(filePath, 'utf-8');
      return {
        success: true,
        data: { content },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  public async writeFile(
    filePath: string,
    content: string
  ): Promise<ToolResult> {
    const permission = this.permissions.local.write;

    if (permission === 'never') {
      return {
        success: false,
        error: 'File writing is disabled by permission settings',
      };
    }

    if (permission === 'ask') {
      // TODO: Implement user approval flow
      return {
        success: false,
        error: 'File writing requires user approval',
      };
    }

    try {
      await auditLogger.log({
        timestamp: new Date(),
        action: 'local.writeFile',
        details: { filePath },
        result: 'success',
        riskLevel: 'medium',
      });

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');

      return {
        success: true,
        data: { filePath },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  public async listFiles(
    directory: string,
    recursive: boolean = false
  ): Promise<ToolResult> {
    const permission = this.permissions.local.read;

    if (permission === 'never') {
      return {
        success: false,
        error: 'File listing is disabled by permission settings',
      };
    }

    try {
      const files: string[] = [];
      const entries = await fs.readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (recursive) {
            const subFiles = await this.listFiles(fullPath, recursive);
            if (subFiles.data) {
              files.push(...(subFiles.data as string[]));
            }
          } else {
            files.push(`${entry.name}/`);
          }
        } else {
          files.push(entry.name);
        }
      }

      return {
        success: true,
        data: { files },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  public async searchFiles(
    directory: string,
    pattern: string
  ): Promise<ToolResult> {
    const permission = this.permissions.local.read;

    if (permission === 'never') {
      return {
        success: false,
        error: 'File searching is disabled by permission settings',
      };
    }

    try {
      // Escape shell special characters to prevent command injection
      const escapeShellArg = (arg: string) => {
        return "'" + arg.replace(/'/g, "'\\''") + "'";
      };

      const safePattern = escapeShellArg(pattern);
      const safeDirectory = escapeShellArg(directory);

      const { stdout } = await execAsync(
        `grep -r ${safePattern} ${safeDirectory} --include="*.ts" --include="*.js" --include="*.json" -l`
      );

      const files = stdout.trim().split('\n').filter(Boolean);

      return {
        success: true,
        data: { files },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error) || 'No matches found',
        data: { files: [] },
      };
    }
  }

  public async getSystemInfo(): Promise<ToolResult> {
    const permission = this.permissions.local.system;

    if (permission === 'never') {
      return {
        success: false,
        error: 'System information access is disabled',
      };
    }

    try {
      const { stdout: osInfo } = await execAsync('uname -a');
      const { stdout: memInfo } = await execAsync('free -h');
      const { stdout: cpuInfo } = await execAsync('nproc');

      return {
        success: true,
        data: {
          os: osInfo.trim(),
          memory: memInfo.trim(),
          cpu: `${cpuInfo.trim()} cores`,
        },
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: getErrorMessage(error),
      };
    }
  }

  public async checkPermission(
    category: 'web' | 'local' | 'ai',
    action: string
  ): Promise<boolean> {
    const perms = this.permissions[category];
    const permission = (perms as Record<string, ToolPermission>)[action];

    if (permission === 'never') return false;
    if (permission === 'always') return true;
    if (permission === 'ask' || permission === 'explicit') {
      // TODO: Implement user approval
      return false;
    }

    return false;
  }
}

// Singleton instance
export const localTools = new LocalTools();
