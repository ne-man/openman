/**
 * Logger Module - Structured logging with file output and compression
 * 
 * Log format: [级别 时间 序号 线程 模块 文件:行号 函数] 实际内容
 * Example: [D 2026-02-28 22:39:02:631 8140 25270 IF bd_map.cpp:1928 operator()] message
 * 
 * Features:
 * - Structured logging with file/line/func tracking
 * - Auto-compression of old log files on startup
 * - Maximum 10 compressed log archives
 * - Console and file output with level filtering
 */

import fs from 'fs';
import path from 'path';
import { homedir } from 'os';
import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);
const rename = promisify(fs.rename);

// Log levels
export type LogLevel = 'D' | 'I' | 'W' | 'E' | 'F';

const LOG_LEVELS: Record<LogLevel, { priority: number; name: string; color: string }> = {
  D: { priority: 0, name: 'DEBUG', color: '\x1b[36m' },    // Cyan
  I: { priority: 1, name: 'INFO', color: '\x1b[32m' },     // Green
  W: { priority: 2, name: 'WARN', color: '\x1b[33m' },     // Yellow
  E: { priority: 3, name: 'ERROR', color: '\x1b[31m' },    // Red
  F: { priority: 4, name: 'FATAL', color: '\x1b[35m' },    // Magenta
};

export interface LogOptions {
  level?: LogLevel;
  module?: string;
  file?: string;
  line?: number;
  func?: string;
}

export interface LoggerConfig {
  logDir: string;
  consoleLevel: LogLevel;
  fileLevel: LogLevel;
  enableConsole: boolean;
  enableFile: boolean;
  moduleName?: string;
  maxArchives: number;  // Maximum number of compressed archives to keep
}

// Default configuration
const DEFAULT_CONFIG: LoggerConfig = {
  logDir: path.join(homedir(), '.openman', 'logs'),
  consoleLevel: 'D',
  fileLevel: 'D',
  enableConsole: true,
  enableFile: true,
  moduleName: 'APP',
  maxArchives: 10,
};

/**
 * Get caller location from stack trace
 */
export function getCallerLocation(stackOffset: number = 3): { file: string; line: number; func: string } {
  const stack = new Error('getCaller').stack?.split('\n') || [];
  
  for (let i = stackOffset; i < stack.length; i++) {
    const line = stack[i];
    const match = line.match(/at\s+(?:(\S+)\s+\()?(.+):(\d+):(\d+)\)?/);
    if (match) {
      const func = match[1] || 'anonymous';
      const filePath = match[2];
      const lineNum = parseInt(match[3], 10);
      
      if (filePath.includes('logger.ts')) {
        continue;
      }
      
      const file = path.basename(filePath);
      return { file, line: lineNum, func };
    }
  }
  
  return { file: 'unknown', line: 0, func: 'unknown' };
}

export function LOC(): { file: string; line: number; func: string } {
  return getCallerLocation(3);
}

export function LOC_HERE(module?: string): { file: string; line: number; func: string; module?: string } {
  const loc = getCallerLocation(3);
  return module ? { ...loc, module } : loc;
}

/**
 * Logger class - Singleton pattern
 */
export class Logger {
  private static instance: Logger | null = null;
  private config: LoggerConfig;
  private logFile: string | null = null;
  private logCount: number = 0;
  private pid: number;

  private constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.pid = process.pid;
    
    if (this.config.enableFile) {
      this.initLogFile();
    }
  }

  /**
   * Initialize log file and compress old logs
   */
  private async initLogFile(): Promise<void> {
    // Ensure log directory exists
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }

    // Compress old log files
    await this.compressOldLogs();

    // Generate filename: YYYY-MM-DD-HH-mm-ss-PID.log
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    
    const filename = `${year}-${month}-${day}-${hour}-${minute}-${second}-${this.pid}.log`;
    this.logFile = path.join(this.config.logDir, filename);

    fs.writeFileSync(this.logFile, '', 'utf8');
    
    this.logAt('I', `Logger initialized: ${this.logFile}`, {
      module: 'LOG',
      file: 'logger.ts',
      line: 130,
      func: 'initLogFile',
    });
  }

  /**
   * Compress old log files to .gz archives
   */
  private async compressOldLogs(): Promise<void> {
    try {
      const files = await readdir(this.config.logDir);
      const logFiles = files.filter(f => f.endsWith('.log') && !f.includes(String(this.pid)));
      
      if (logFiles.length === 0) return;

      console.log(`  📦 压缩 ${logFiles.length} 个旧日志文件...`);

      for (const logFile of logFiles) {
        const logPath = path.join(this.config.logDir, logFile);
        const gzPath = logPath + '.gz';
        
        try {
          // Check if gz already exists
          if (!fs.existsSync(gzPath)) {
            const content = await fs.promises.readFile(logPath);
            if (content.length > 0) {
              const compressed = await gzip(content);
              await fs.promises.writeFile(gzPath, compressed);
              await unlink(logPath);
              console.log(`    ✓ 压缩: ${logFile} -> ${logFile}.gz`);
            } else {
              await unlink(logPath);
            }
          }
        } catch (err) {
          // Ignore compression errors
        }
      }

      // Clean up old archives (keep only maxArchives)
      await this.cleanupOldArchives();
    } catch (err) {
      // Ignore errors
    }
  }

  /**
   * Remove old archives beyond maxArchives limit
   */
  private async cleanupOldArchives(): Promise<void> {
    try {
      const files = await readdir(this.config.logDir);
      const gzFiles = files.filter(f => f.endsWith('.log.gz'));
      
      if (gzFiles.length <= this.config.maxArchives) return;

      // Get file stats and sort by modification time (oldest first)
      const fileStats = await Promise.all(
        gzFiles.map(async (f) => {
          const filePath = path.join(this.config.logDir, f);
          const stats = await stat(filePath);
          return { name: f, path: filePath, mtime: stats.mtime };
        })
      );

      fileStats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

      // Delete oldest files
      const toDelete = fileStats.slice(0, fileStats.length - this.config.maxArchives);
      
      for (const file of toDelete) {
        try {
          await unlink(file.path);
          console.log(`    🗑️ 删除旧归档: ${file.name}`);
        } catch {
          // Ignore deletion errors
        }
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Get singleton instance
   */
  public static getInstance(config?: Partial<LoggerConfig>): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(config);
    }
    return Logger.instance;
  }

  /**
   * Reset instance (for testing)
   */
  public static reset(): void {
    if (Logger.instance) {
      Logger.instance.close();
      Logger.instance = null;
    }
  }

  /**
   * Get current log file path
   */
  public getLogFile(): string | null {
    return this.logFile;
  }

  /**
   * Format timestamp: YYYY-MM-DD HH:mm:ss:SSS
   */
  private formatTimestamp(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    
    return `${year}-${month}-${day} ${hour}:${minute}:${second}:${ms}`;
  }

  /**
   * Format log entry
   */
  private formatEntry(
    level: LogLevel,
    message: string,
    file: string,
    line: number,
    func: string,
    module: string
  ): string {
    const now = new Date();
    const timestamp = this.formatTimestamp(now);
    const logNum = String(++this.logCount).padStart(5, '0');
    const threadId = String(this.pid).padStart(5, ' ');
    
    const header = `[${level} ${timestamp} ${logNum} ${threadId} ${module} ${file}:${line} ${func}()]`;
    
    return `${header} ${message}`;
  }

  /**
   * Core logging method with explicit location
   */
  public logAt(
    level: LogLevel,
    message: string,
    location: { file: string; line: number; func: string; module?: string }
  ): void {
    const levelInfo = LOG_LEVELS[level];
    const formattedEntry = this.formatEntry(
      level,
      message,
      location.file,
      location.line,
      location.func,
      location.module || this.config.moduleName || 'APP'
    );

    // Console output
    if (this.config.enableConsole && LOG_LEVELS[level].priority >= LOG_LEVELS[this.config.consoleLevel].priority) {
      const reset = '\x1b[0m';
      const levelColor = levelInfo.color;
      const coloredEntry = `[${levelColor}${level}${reset}]${formattedEntry.substring(3)}`;
      console.log(coloredEntry);
    }

    // File output
    if (this.config.enableFile && this.logFile && LOG_LEVELS[level].priority >= LOG_LEVELS[this.config.fileLevel].priority) {
      try {
        fs.appendFileSync(this.logFile, formattedEntry + '\n', 'utf8');
      } catch {
        // Ignore write errors
      }
    }
  }

  /**
   * Legacy logging method
   */
  public log(level: LogLevel, message: string, options?: LogOptions): void {
    const callerInfo = options?.file
      ? { file: options.file, line: options.line || 0, func: options.func || '' }
      : getCallerLocation(4);
    
    this.logAt(level, message, {
      ...callerInfo,
      module: options?.module || this.config.moduleName,
    });
  }

  /**
   * Convenience methods
   */
  public debug(message: string, options?: LogOptions): void {
    this.log('D', message, options);
  }

  public info(message: string, options?: LogOptions): void {
    this.log('I', message, options);
  }

  public warn(message: string, options?: LogOptions): void {
    this.log('W', message, options);
  }

  public error(message: string, options?: LogOptions): void {
    this.log('E', message, options);
  }

  public fatal(message: string, options?: LogOptions): void {
    this.log('F', message, options);
  }

  /**
   * Create a module logger
   */
  public createModuleLogger(moduleName: string): ModuleLogger {
    return new ModuleLogger(this, moduleName);
  }

  /**
   * Close log file
   */
  public close(): void {
    if (this.logFile) {
      this.logAt('I', 'Logger shutting down', {
        module: 'LOG',
        file: 'logger.ts',
        line: 300,
        func: 'close',
      });
    }
  }
}

/**
 * Module logger - automatically captures caller location
 */
export class ModuleLogger {
  constructor(
    private logger: Logger,
    private module: string
  ) {}

  private getLocation(): { file: string; line: number; func: string } {
    return getCallerLocation(4);
  }

  public debug(message: string): void {
    this.logger.logAt('D', message, { ...this.getLocation(), module: this.module });
  }

  public info(message: string): void {
    this.logger.logAt('I', message, { ...this.getLocation(), module: this.module });
  }

  public warn(message: string): void {
    this.logger.logAt('W', message, { ...this.getLocation(), module: this.module });
  }

  public error(message: string): void {
    this.logger.logAt('E', message, { ...this.getLocation(), module: this.module });
  }

  public fatal(message: string): void {
    this.logger.logAt('F', message, { ...this.getLocation(), module: this.module });
  }

  public logAt(
    level: LogLevel,
    message: string,
    loc: { file: string; line: number; func: string }
  ): void {
    this.logger.logAt(level, message, { ...loc, module: this.module });
  }
}

/**
 * Timer - 可复用的时间统计工具
 */
export class Timer {
  private startTime: number;
  private name: string;
  private moduleLog: ModuleLogger;

  constructor(name: string, moduleLog: ModuleLogger) {
    this.name = name;
    this.moduleLog = moduleLog;
    this.startTime = Date.now();
  }

  /**
   * 获取已消耗时间(ms)
   */
  elapsed(): number {
    return Date.now() - this.startTime;
  }

  /**
   * 记录并返回消耗时间
   */
  log(message?: string): number {
    const ms = this.elapsed();
    const msg = message || `${this.name} 耗时`;
    this.moduleLog.info(`${msg}: ${ms}ms`);
    return ms;
  }

  /**
   * 重置计时器
   */
  reset(): void {
    this.startTime = Date.now();
  }
}

// Convenience exports
export const logger = Logger.getInstance;
export const createLogger = (config?: Partial<LoggerConfig>) => Logger.getInstance(config);

export default Logger;
