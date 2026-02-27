/**
 * Core types for OpenMan
 */

// ============================================================================
// AI Service Types
// ============================================================================

export type AIProvider = 'openai' | 'anthropic' | 'google' | 'custom';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}

export interface AIResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: AIProvider;
}

export interface AIServiceConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

// ============================================================================
// Browser Types
// ============================================================================

export interface BrowserConfig {
  headless: boolean;
  executablePath?: string;
  userDataDir?: string;
  viewport?: {
    width: number;
    height: number;
  };
  userAgent?: string;
}

export interface NavigationOptions {
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  timeout?: number;
}

export interface FormField {
  name: string;
  type: string;
  value?: string;
  required?: boolean;
}

export interface PageSnapshot {
  url: string;
  title: string;
  html?: string;
  text?: string;
  screenshot?: Buffer;
  timestamp: Date;
}

// ============================================================================
// Tool Types
// ============================================================================

export type ToolPermission = 'always' | 'ask' | 'never' | 'explicit';

export interface ToolConfig {
  permissions: {
    web: {
      browsing: ToolPermission;
      forms: ToolPermission;
      payments: ToolPermission;
      sensitive: ToolPermission;
    };
    local: {
      read: ToolPermission;
      write: ToolPermission;
      execute: ToolPermission;
      system: ToolPermission;
    };
    ai: {
      [provider: string]: ToolPermission;
    };
  };
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Core Types
// ============================================================================

export interface Task {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  subtasks?: Task[];
  createdAt: Date;
  completedAt?: Date;
}

export interface MemoryEntry {
  id: string;
  type: 'episodic' | 'semantic' | 'preference';
  content: string;
  timestamp: Date;
  importance?: number;
  tags?: string[];
}

export interface AuditLog {
  timestamp: Date;
  action: string;
  details: Record<string, unknown>;
  result: 'success' | 'failure';
  userApproved?: boolean;
  riskLevel: 'low' | 'medium' | 'high';
}

// ============================================================================
// Config Types
// ============================================================================

export interface OpenManConfig {
  ai: {
    openai?: AIServiceConfig;
    anthropic?: AIServiceConfig;
    google?: AIServiceConfig;
    defaultProvider: AIProvider;
  };
  browser: BrowserConfig;
  permissions: ToolConfig['permissions'];
  server: {
    port: number;
    host: string;
  };
  debug: {
    enabled: boolean;
    verbose: boolean;
  };
}

// ============================================================================
// CLI Types
// ============================================================================

export interface CLIOptions {
  verbose?: boolean;
  debug?: boolean;
  config?: string;
  headless?: boolean;
  provider?: AIProvider;
}
