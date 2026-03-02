/**
 * Logger Module - Structured logging with file output
 * 
 * Log format: [级别 时间 序号 线程 模块 文件:行号 函数] 实际内容
 * Example: [D 2026-02-28 22:39:02:631 8140 25270 IF bd_map.cpp:1928 operator()] message
 */

import fs from 'fs';
import path from 'path';
import { homedir } from 'os';

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
}

// Default configuration
const DEFAULT_CONFIG: LoggerConfig = {
  logDir: path.join(homedir(), '.openman', 'logs'),
  consoleLevel: 'D',
  fileLevel: 'D',
  enableConsole: true,
  enableFile: true,
  moduleName: 'APP',
};

/**
 * Get caller location from stack trace
 * This function captures the stack at the call site
 */
export function getCallerLocation(stackOffset: number = 3): { file: string; line: number; func: string } {
  const stack = new Error('getCaller').stack?.split('\n') || [];
  
  // Skip: Error, getCallerLocation, and internal logger methods
  for (let i = stackOffset; i < stack.length; i++) {
    const line = stack[i];
    // Match patterns like "at functionName (file:line:col)" or "at file:line:col"
    const match = line.match(/at\s+(?:(\S+)\s+\()?(.+):(\d+):(\d+)\)?/);
    if (match) {
      const func = match[1] || 'anonymous';
      const filePath = match[2];
      const lineNum = parseInt(match[3], 10);
      
      // Skip internal logger.ts calls
      if (filePath.includes('logger.ts')) {
        continue;
      }
      
      // Extract filename from path
      const file = path.basename(filePath);
      
      return { file, line: lineNum, func };
    }
  }
  
  return { file: 'unknown', line: 0, func: 'unknown' };
}

/**
 * LOC - Get current location for logging
 * Call this function at the log site to capture accurate file/line/func
 * 
 * Usage:
 *   log.info('message', LOC());
 */
export function LOC(): { file: string; line: number; func: string } {
  return getCallerLocation(3);
}

/**
 * LOC_HERE - Get location with module name for convenient destructuring
 * Returns an object that can be spread into log methods
 */
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
   * Initialize log file with timestamp and PID
   */
  private initLogFile(): void {
    // Ensure log directory exists
    if (!fs.existsSync(this.config.logDir)) {
      fs.mkdirSync(this.config.logDir, { recursive: true });
    }

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

    // Create empty log file
    fs.writeFileSync(this.logFile, '', 'utf8');
    
    // Log initialization with explicit location
    this.logAt('I', `Logger initialized: ${this.logFile}`, {
      module: 'LOG',
      file: 'logger.ts',
      line: 113,
      func: 'initLogFile',
    });
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
    
    // Format: [D 2026-02-28 22:39:02:631 8140 25270 IF bd_map.cpp:1928 operator()] message
    const header = `[${level} ${timestamp} ${logNum} ${threadId} ${module} ${file}:${line} ${func}()]`;
    
    return `${header} ${message}`;
  }

  /**
   * Core logging method with explicit location (preferred)
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
      
      // Colorize the level
      const coloredEntry = `[${levelColor}${level}${reset}]${formattedEntry.substring(3)}`;
      
      console.log(coloredEntry);
    }

    // File output - use synchronous write to ensure immediate persistence
    if (this.config.enableFile && this.logFile && LOG_LEVELS[level].priority >= LOG_LEVELS[this.config.fileLevel].priority) {
      try {
        fs.appendFileSync(this.logFile, formattedEntry + '\n', 'utf8');
      } catch {
        // Ignore write errors
      }
    }
  }

  /**
   * Legacy logging method - auto-detects caller (less accurate)
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
   * Convenience methods with auto-detection (convenient but less accurate)
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
   * Create a module logger with accurate location tracking
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
        line: 271,
        func: 'close',
      });
    }
  }
}

/**
 * Module logger - automatically captures caller location
 * 
 * Usage:
 *   const log = logger.createModuleLogger('MY_MODULE');
 *   log.info('message');  // Location is auto-captured
 */
export class ModuleLogger {
  constructor(
    private logger: Logger,
    private module: string
  ) {}

  /**
   * Get caller location with correct stack offset for ModuleLogger methods
   */
  private getLocation(): { file: string; line: number; func: string } {
    // Stack: Error -> getLocation -> debug/info/warn/error/fatal -> [caller]
    return getCallerLocation(4);
  }

  /**
   * Log message - location is automatically captured
   * Usage: log.info('message')
   */
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

  /**
   * Log with explicit location (for special cases)
   */
  public logAt(
    level: LogLevel,
    message: string,
    loc: { file: string; line: number; func: string }
  ): void {
    this.logger.logAt(level, message, { ...loc, module: this.module });
  }
}

// Convenience exports
export const logger = Logger.getInstance;
export const createLogger = (config?: Partial<LoggerConfig>) => Logger.getInstance(config);

// Default export
export default Logger;
