/**
 * Audit logging system for OpenMan
 * Refactored to use async initialization pattern
 */

import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import type { AuditLog } from '@/types';

export class AuditLogger {
  private logDir: string;
  private currentLogFile: string;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.logDir = path.join(homedir(), '.openman', 'logs');
    this.currentLogFile = this.getLogFileName();
    // Start async initialization
    this.initPromise = this.initialize();
  }

  /**
   * Ensure initialization is complete
   */
  public async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  /**
   * Async initialization
   */
  private async initialize(): Promise<void> {
    await this.ensureLogDir();
    this.initialized = true;
  }

  private async ensureLogDir(): Promise<void> {
    await fs.mkdir(this.logDir, { recursive: true });
  }

  private getLogFileName(): string {
    const now = new Date();
    const date = now.toISOString().split('T')[0];
    return path.join(this.logDir, `audit-${date}.jsonl`);
  }

  /**
   * Log an audit entry
   */
  public async log(entry: AuditLog): Promise<void> {
    // Update log file name if date changed
    const todayLogFile = this.getLogFileName();
    if (todayLogFile !== this.currentLogFile) {
      this.currentLogFile = todayLogFile;
    }

    // Sanitize entry
    const logEntry = {
      timestamp: entry.timestamp.toISOString(),
      action: this.sanitizeAction(entry.action),
      details: this.sanitizeDetails(entry.details),
      result: entry.result === 'success' ? 'success' : 'failure',
      userApproved: entry.userApproved,
      riskLevel: this.validateRiskLevel(entry.riskLevel),
    };

    const logLine = JSON.stringify(logEntry) + '\n';

    try {
      await fs.appendFile(this.currentLogFile, logLine, 'utf-8');
    } catch (error) {
      console.error('Failed to write audit log:', error);
    }

    // Also log to console if debug mode
    if (process.env.DEBUG === 'true') {
      console.log(`[AUDIT] ${logEntry.action} - ${logEntry.result}`);
    }
  }

  /**
   * Get logs with optional date filter
   */
  public async getLogs(
    startDate?: Date,
    endDate?: Date
  ): Promise<AuditLog[]> {
    await this.ensureInitialized();
    
    try {
      const content = await fs.readFile(this.currentLogFile, 'utf-8');
      const logs = content
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter((log): log is AuditLog => log !== null);

      if (startDate || endDate) {
        return logs.filter((log: AuditLog) => {
          const logDate = new Date(log.timestamp);
          if (startDate && logDate < startDate) return false;
          if (endDate && logDate > endDate) return false;
          return true;
        });
      }

      return logs;
    } catch {
      console.error('Failed to read audit logs');
      return [];
    }
  }

  /**
   * Search logs by action or risk level
   */
  public async searchLogs(action?: string, riskLevel?: string): Promise<AuditLog[]> {
    const logs = await this.getLogs();
    
    const sanitizedAction = action ? this.sanitizeAction(action) : undefined;
    const validatedRiskLevel = riskLevel ? this.validateRiskLevel(riskLevel as 'low' | 'medium' | 'high') : undefined;

    return logs.filter((log: AuditLog) => {
      if (sanitizedAction && !log.action.includes(sanitizedAction)) return false;
      if (validatedRiskLevel && log.riskLevel !== validatedRiskLevel) return false;
      return true;
    });
  }

  /**
   * Get log statistics
   */
  public async getStatistics(): Promise<{
    total: number;
    byAction: Record<string, number>;
    byRiskLevel: Record<string, number>;
    errorCount: number;
  }> {
    const logs = await this.getLogs();
    const byAction: Record<string, number> = {};
    const byRiskLevel: Record<string, number> = {};
    let errorCount = 0;

    for (const log of logs) {
      byAction[log.action] = (byAction[log.action] || 0) + 1;
      byRiskLevel[log.riskLevel] = (byRiskLevel[log.riskLevel] || 0) + 1;
      if (log.result === 'failure') errorCount++;
    }

    return {
      total: logs.length,
      byAction,
      byRiskLevel,
      errorCount,
    };
  }

  // ============================================================================
  // Validation & Sanitization Helpers
  // ============================================================================

  /**
   * Sanitize action string
   */
  private sanitizeAction(action: string): string {
    if (typeof action !== 'string') return 'unknown';
    // Only allow alphanumeric, dots, and underscores
    return action.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 100);
  }

  /**
   * Sanitize details object
   */
  private sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
    if (typeof details !== 'object' || details === null) return {};
    
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details)) {
      const sanitizedKey = this.sanitizeAction(key);
      // Limit string values
      if (typeof value === 'string') {
        sanitized[sanitizedKey] = value.slice(0, 1000);
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        sanitized[sanitizedKey] = value;
      } else if (value === null) {
        sanitized[sanitizedKey] = null;
      } else {
        sanitized[sanitizedKey] = '[Object]';
      }
    }
    return sanitized;
  }

  /**
   * Validate risk level
   */
  private validateRiskLevel(level: string): 'low' | 'medium' | 'high' {
    const validLevels = ['low', 'medium', 'high'];
    return validLevels.includes(level) ? (level as 'low' | 'medium' | 'high') : 'low';
  }
}

// Singleton instance
let auditLoggerInstance: AuditLogger | null = null;

/**
 * Get audit logger instance
 */
export function getAuditLogger(): AuditLogger {
  if (!auditLoggerInstance) {
    auditLoggerInstance = new AuditLogger();
  }
  return auditLoggerInstance;
}

/**
 * Initialize audit logger and wait for ready
 */
export async function initAuditLogger(): Promise<AuditLogger> {
  const instance = getAuditLogger();
  await instance.ensureInitialized();
  return instance;
}

// Export for backward compatibility
export const auditLogger = new AuditLogger();
