/**
 * OpenMan - Main Entry Point
 */

export { BrowserEngine } from '@/browser/engine';
export { aiService } from '@/ai/service';
export { localTools } from '@/tools/local';
export { reasoningEngine } from '@/core/reasoning';
export { permissionManager } from '@/permissions/manager';
export { config } from '@/core/config';
export { auditLogger } from '@/core/audit';
export { memorySystem } from '@/core/memory';
export { sessionManager } from '@/core/session';

// Error handling
export {
  OpenManError,
  AIError,
  BrowserError,
  PermissionError,
  ConfigError,
  NetworkError,
  CircuitBreaker,
  CircuitBreakerOpenError,
  TimeoutError,
  RetryQueue,
  retry,
  withTimeout,
  sleep,
  createErrorHandler,
} from '@/utils/errors';

// Re-export types
export * from '@/types';

// Re-export from config
export type { Session, MemoryQuery } from '@/types';
