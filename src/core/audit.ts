/**
 * Audit logging system for OpenMan
 */

import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import type { AuditLog } from '@/types';

export class AuditLogger {
  private logDir: string;
  private currentLogFile: string;

  constructor() {
    this.logDir = path.join(homedir(), '.openman', 'logs');
    this.currentLogFile = this.getLogFileName();
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    fs.mkdir(this.logDir, { recursive: true }).catch(console.error);
  }

  private getLogFileName(): string {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    return path.join(this.logDir, `audit-${date}.jsonl`);
  }

  public async log(entry: AuditLog): Promise<void> {
    const logEntry = {
      ...entry,
      timestamp: entry.timestamp.toISOString(),
    };

    const logLine = JSON.stringify(logEntry) + '\n';

    try {
      await fs.appendFile(this.currentLogFile, logLine, 'utf-8');
    } catch (error) {
      console.error('Failed to write audit log:', error);
    }

    // Also log to console if debug mode
    if (process.env.DEBUG === 'true') {
      console.log(`[AUDIT] ${entry.action} - ${entry.result}`);
    }
  }

  public async getLogs(
    startDate?: Date,
    endDate?: Date
  ): Promise<AuditLog[]> {
    try {
      const content = await fs.readFile(this.currentLogFile, 'utf-8');
      const logs = content
        .split('\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));

      if (startDate || endDate) {
        return logs.filter((log: AuditLog) => {
          const logDate = new Date(log.timestamp);
          if (startDate && logDate < startDate) return false;
          if (endDate && logDate > endDate) return false;
          return true;
        });
      }

      return logs;
    } catch (error) {
      console.error('Failed to read audit logs:', error);
      return [];
    }
  }

  public async searchLogs(action?: string, riskLevel?: string): Promise<AuditLog[]> {
    const logs = await this.getLogs();

    return logs.filter((log: AuditLog) => {
      if (action && !log.action.includes(action)) return false;
      if (riskLevel && log.riskLevel !== riskLevel) return false;
      return true;
    });
  }
}

// Singleton instance
export const auditLogger = new AuditLogger();
