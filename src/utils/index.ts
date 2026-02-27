/**
 * Utility functions for OpenMan
 */

/**
 * Format a date to a human-readable string
 */
export function formatDate(date: Date): string {
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        await sleep(delay);
      }
    }
  }

  throw lastError!;
}

/**
 * Truncate a string to a given length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Sanitize a filename by removing invalid characters
 */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 255);
}

/**
 * Generate a random ID
 */
export function generateId(prefix: string = ''): string {
  return `${prefix}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Parse a duration string to milliseconds
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'ms':
      return value;
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Validate an email address
 */
export function isValidEmail(email: string): boolean {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

/**
 * Validate a URL
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

/**
 * Mask sensitive information in logs
 */
export function maskSensitive(value: string, type: 'email' | 'phone' | 'token'): string {
  switch (type) {
    case 'email':
      const [local, domain] = value.split('@');
      if (!domain) return value;
      const maskedLocal = local.substring(0, 2) + '***';
      return `${maskedLocal}@${domain}`;

    case 'phone':
      if (value.length < 4) return '***';
      return value.substring(0, value.length - 4) + '****';

    case 'token':
      if (value.length < 8) return '***';
      return value.substring(0, 4) + '...' + value.substring(value.length - 4);

    default:
      return value;
  }
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Merge two objects
 */
export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const output = { ...target };

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach((key) => {
      if (isObject(source[key as keyof T])) {
        if (!(key in output)) {
          Object.assign(output, { [key]: source[key as keyof T] });
        } else {
          output[key as keyof T] = deepMerge(
            output[key as keyof T] as object,
            source[key as keyof T] as object
          ) as T[keyof T];
        }
      } else {
        Object.assign(output, { [key]: source[key as keyof T] });
      }
    });
  }

  return output;
}

function isObject(item: unknown): item is object {
  return item && typeof item === 'object' && !Array.isArray(item);
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle a function
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;

  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Create a promise with timeout
 */
export function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutError: Error = new Error('Promise timed out')
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(timeoutError), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Rate limit a function
 */
export class RateLimiter {
  private queue: Array<() => void> = [];
  private activeCount = 0;

  constructor(private maxConcurrent: number) {}

  public async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrent) {
      await new Promise((resolve) => this.queue.push(resolve));
    }

    this.activeCount++;

    try {
      return await fn();
    } finally {
      this.activeCount--;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }
}

/**
 * Parse command output
 */
export function parseCommandOutput(output: string): {
  stdout: string;
  stderr: string;
  exitCode: number | null;
} {
  const parts = output.split('\n');
  const lastLine = parts[parts.length - 1];

  let exitCode: number | null = null;
  if (lastLine.match(/^Exit code: \d+$/)) {
    exitCode = parseInt(lastLine.split(': ')[1], 10);
    parts.pop();
  }

  const stdout = parts.join('\n');
  const stderr = '';

  return { stdout, stderr, exitCode };
}

/**
 * Create a progress bar
 */
export class ProgressBar {
  private current = 0;

  constructor(
    private total: number,
    private width: number = 40
  ) {}

  public update(increment: number = 1): void {
    this.current = Math.min(this.current + increment, this.total);
  }

  public getProgress(): string {
    const percentage = (this.current / this.total) * 100;
    const filled = Math.floor((this.current / this.total) * this.width);
    const empty = this.width - filled;

    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${percentage.toFixed(1)}%`;
  }

  public isComplete(): boolean {
    return this.current >= this.total;
  }

  public reset(): void {
    this.current = 0;
  }
}
