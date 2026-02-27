/**
 * Error Handling and Retry Mechanisms
 */

export class OpenManError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'OpenManError';
  }
}

export class AIError extends OpenManError {
  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message, code, details);
    this.name = 'AIError';
  }
}

export class BrowserError extends OpenManError {
  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message, code, details);
    this.name = 'BrowserError';
  }
}

export class PermissionError extends OpenManError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'PERMISSION_DENIED', details);
    this.name = 'PermissionError';
  }
}

export class ConfigError extends OpenManError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', details);
    this.name = 'ConfigError';
  }
}

export class NetworkError extends OpenManError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'NETWORK_ERROR', details);
    this.name = 'NetworkError';
  }
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  shouldRetry?: (error: Error) => boolean;
  onRetry?: (attempt: number, error: Error) => void;
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    shouldRetry = defaultShouldRetry,
    onRetry,
  } = options;

  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry
      if (attempt === maxRetries || !shouldRetry(lastError)) {
        throw lastError;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

      // Call onRetry callback if provided
      if (onRetry) {
        onRetry(attempt + 1, lastError);
      }

      // Wait before retrying
      await sleep(delay);
    }
  }

  throw lastError!;
}

function defaultShouldRetry(error: Error): boolean {
  // Retry on network errors
  if (error instanceof NetworkError) {
    return true;
  }

  // Retry on specific error codes
  if (error instanceof OpenManError) {
    const retryableCodes = ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT'];
    return retryableCodes.includes(error.code);
  }

  // Retry on specific error messages
  const retryableMessages = [
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'timeout',
    'rate limit',
  ];

  const message = error.message.toLowerCase();
  return retryableMessages.some(msg => message.includes(msg));
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class CircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  constructor(
    private threshold: number = 5,
    private timeout: number = 60000
  ) {}

  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new CircuitBreakerOpenError('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }

  public reset(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  public getState(): 'closed' | 'open' | 'half-open' {
    return this.state;
  }
}

export class CircuitBreakerOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string = 'Operation timed out'
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new TimeoutError(timeoutMessage)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

export class RetryQueue {
  private queue: Array<() => Promise<any>> = [];
  private processing: boolean = false;

  constructor(
    private concurrency: number = 1,
    private retryOptions: RetryOptions = {}
  ) {}

  public async add<T>(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const wrappedTask = async () => {
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };

      this.queue.push(wrappedTask);
      this.process();
    });
  }

  private async process(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    const tasksToProcess = this.queue.splice(0, this.concurrency);
    const results = await Promise.allSettled(
      tasksToProcess.map(task =>
        retry(task, this.retryOptions)
      )
    );

    this.processing = false;

    // Process any errors
    results.forEach(result => {
      if (result.status === 'rejected') {
        console.error('Task failed:', result.reason);
      }
    });

    // Continue processing if there are more tasks
    if (this.queue.length > 0) {
      this.process();
    }
  }

  public getQueueSize(): number {
    return this.queue.length;
  }
}

export function handleAsyncError<T>(
  fn: () => Promise<T>,
  defaultValue?: T
): T | undefined {
  fn().catch(error => {
    console.error('Async error:', error);
  });

  return defaultValue;
}

export function createErrorHandler(
  context: string
) {
  return (error: unknown): OpenManError => {
    if (error instanceof OpenManError) {
      return error;
    }

    if (error instanceof Error) {
      return new OpenManError(
        `[${context}] ${error.message}`,
        'UNKNOWN_ERROR',
        { originalError: error.name, stack: error.stack }
      );
    }

    return new OpenManError(
      `[${context}] Unknown error occurred`,
      'UNKNOWN_ERROR',
      { originalError: String(error) }
    );
  };
}
