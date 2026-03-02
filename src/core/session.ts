/**
 * Session Management System for OpenMan
 * Refactored to use async initialization pattern
 */

import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import { generateId } from '@/utils';
import type { AIMessage, AIProvider } from '@/types';
import { auditLogger } from '@/core/audit';
import { Logger } from '@/utils/logger';

const log = Logger.getInstance({ moduleName: 'SES' }).createModuleLogger('SES');

export interface Session {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  messages: AIMessage[];
  provider: AIProvider;
  model: string;
  metadata: Record<string, unknown>;
}

export class SessionManager {
  private sessionsDir: string;
  private sessions: Map<string, Session> = new Map();
  private currentSessionId: string | null = null;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.sessionsDir = path.join(homedir(), '.openman', 'sessions');
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
    log.debug('Initializing session manager...');
    await this.ensureSessionsDir();
    await this.loadSessions();
    this.initialized = true;
    log.info('Session manager initialized');
  }

  private async ensureSessionsDir(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
  }

  private async loadSessions(): Promise<void> {
    try {
      const files = await fs.readdir(this.sessionsDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.sessionsDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const session: Session = JSON.parse(content);
          session.createdAt = new Date(session.createdAt);
          session.updatedAt = new Date(session.updatedAt);

          this.sessions.set(session.id, session);
        } catch (error) {
          log.warn(`Failed to load session ${file}`);
        }
      }

      log.info(`Loaded ${this.sessions.size} sessions`);
    } catch {
      log.debug('No existing sessions found');
    }
  }

  private async saveSession(session: Session): Promise<void> {
    const filePath = path.join(this.sessionsDir, `${session.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  /**
   * Create a new session
   */
  public async createSession(
    name: string,
    provider: AIProvider = 'openai',
    model: string = 'gpt-4'
  ): Promise<Session> {
    await this.ensureInitialized();
    
    // Validate input
    const sanitizedName = this.sanitizeInput(name, 100);
    const validProvider = this.validateProvider(provider);
    const validModel = this.sanitizeInput(model, 50);

    const session: Session = {
      id: generateId('session-'),
      name: sanitizedName,
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [],
      provider: validProvider,
      model: validModel,
      metadata: {},
    };

    this.sessions.set(session.id, session);
    this.currentSessionId = session.id;
    await this.saveSession(session);

    log.info(`Created session: ${session.id} (name=${sanitizedName}, provider=${validProvider})`);

    await auditLogger.log({
      timestamp: new Date(),
      action: 'session.create',
      details: { sessionId: session.id, name: sanitizedName, provider: validProvider },
      result: 'success',
      riskLevel: 'low',
    });

    return session;
  }

  /**
   * Get a session
   */
  public getSession(id: string): Session | undefined {
    if (!this.isValidId(id)) return undefined;
    return this.sessions.get(id);
  }

  /**
   * Get current session
   */
  public getCurrentSession(): Session | undefined {
    if (this.currentSessionId) {
      return this.sessions.get(this.currentSessionId);
    }
    return undefined;
  }

  /**
   * Set current session
   */
  public setCurrentSession(id: string): boolean {
    if (!this.isValidId(id)) return false;
    if (this.sessions.has(id)) {
      this.currentSessionId = id;
      return true;
    }
    return false;
  }

  /**
   * List all sessions
   */
  public listSessions(): Session[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    );
  }

  /**
   * Add message to session
   */
  public async addMessage(
    sessionId: string,
    role: 'system' | 'user' | 'assistant',
    content: string
  ): Promise<Session | null> {
    await this.ensureInitialized();
    
    if (!this.isValidId(sessionId)) return null;
    
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    // Validate and sanitize input
    const validRole = this.validateRole(role);
    const sanitizedContent = this.sanitizeInput(content, 100000); // 100KB max

    const message: AIMessage = {
      role: validRole,
      content: sanitizedContent,
      timestamp: new Date(),
    };

    session.messages.push(message);
    session.updatedAt = new Date();

    await this.saveSession(session);

    await auditLogger.log({
      timestamp: new Date(),
      action: 'session.addMessage',
      details: { sessionId, role: validRole },
      result: 'success',
      riskLevel: 'low',
    });

    return session;
  }

  /**
   * Update session
   */
  public async updateSession(
    id: string,
    updates: Partial<Session>
  ): Promise<Session | null> {
    await this.ensureInitialized();
    
    if (!this.isValidId(id)) return null;
    
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }

    // Only allow specific fields to be updated
    const allowedUpdates: Partial<Session> = {};
    if (updates.name !== undefined) {
      allowedUpdates.name = this.sanitizeInput(updates.name, 100);
    }
    if (updates.provider !== undefined) {
      allowedUpdates.provider = this.validateProvider(updates.provider);
    }
    if (updates.model !== undefined) {
      allowedUpdates.model = this.sanitizeInput(updates.model, 50);
    }

    Object.assign(session, allowedUpdates);
    session.updatedAt = new Date();

    await this.saveSession(session);

    return session;
  }

  /**
   * Delete a session
   */
  public async deleteSession(id: string): Promise<boolean> {
    await this.ensureInitialized();
    
    if (!this.isValidId(id)) return false;
    
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }

    this.sessions.delete(id);

    const filePath = path.join(this.sessionsDir, `${id}.json`);
    await fs.unlink(filePath).catch(() => {});

    if (this.currentSessionId === id) {
      this.currentSessionId = null;
    }

    await auditLogger.log({
      timestamp: new Date(),
      action: 'session.delete',
      details: { sessionId: id, name: session.name },
      result: 'success',
      riskLevel: 'low',
    });

    return true;
  }

  /**
   * Clear messages in a session
   */
  public async clearSession(id: string): Promise<Session | null> {
    await this.ensureInitialized();
    
    if (!this.isValidId(id)) return null;
    
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }

    session.messages = [];
    session.updatedAt = new Date();

    await this.saveSession(session);

    return session;
  }

  /**
   * Export session
   */
  public async exportSession(id: string, format: 'json' | 'txt' = 'json'): Promise<string | null> {
    await this.ensureInitialized();
    
    if (!this.isValidId(id)) return null;
    
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }

    if (format === 'json') {
      return JSON.stringify(session, null, 2);
    } else {
      // Export as readable text
      let output = `Session: ${session.name}\n`;
      output += `Created: ${session.createdAt.toISOString()}\n`;
      output += `Messages:\n\n`;

      for (const message of session.messages) {
        const timestamp = message.timestamp ? message.timestamp.toISOString() : 'N/A';
        output += `[${message.role}] ${timestamp}\n`;
        output += `${message.content}\n\n`;
      }

      return output;
    }
  }

  /**
   * Import session
   */
  public async importSession(data: string): Promise<Session | null> {
    await this.ensureInitialized();
    
    try {
      const session: Session = JSON.parse(data);
      
      // Validate required fields
      if (!session.name || !session.messages) {
        throw new Error('Invalid session data: missing required fields');
      }
      
      session.id = generateId('session-');
      session.createdAt = new Date(session.createdAt);
      session.updatedAt = new Date(session.updatedAt);
      session.name = this.sanitizeInput(session.name, 100);
      session.provider = this.validateProvider(session.provider);

      this.sessions.set(session.id, session);
      await this.saveSession(session);

      await auditLogger.log({
        timestamp: new Date(),
        action: 'session.import',
        details: { sessionId: session.id, name: session.name },
        result: 'success',
        riskLevel: 'low',
      });

      return session;
    } catch (error) {
      console.error('Failed to import session:', error);
      return null;
    }
  }

  /**
   * Get session statistics
   */
  public getStatistics(): {
    total: number;
    totalMessages: number;
    byProvider: Record<string, number>;
    averageMessages: number;
  } {
    const sessions = Array.from(this.sessions.values());
    const totalMessages = sessions.reduce((sum, s) => sum + s.messages.length, 0);
    const byProvider: Record<string, number> = {};

    for (const session of sessions) {
      byProvider[session.provider] = (byProvider[session.provider] || 0) + 1;
    }

    return {
      total: sessions.length,
      totalMessages,
      byProvider,
      averageMessages: sessions.length > 0 ? totalMessages / sessions.length : 0,
    };
  }

  /**
   * Search sessions
   */
  public searchSessions(query: string): Session[] {
    const sanitizedQuery = this.sanitizeInput(query, 200);
    const results: Session[] = [];
    const queryLower = sanitizedQuery.toLowerCase();

    for (const session of this.sessions.values()) {
      // Search in name
      if (session.name.toLowerCase().includes(queryLower)) {
        results.push(session);
        continue;
      }

      // Search in messages
      for (const message of session.messages) {
        if (message.content.toLowerCase().includes(queryLower)) {
          results.push(session);
          break;
        }
      }
    }

    return results;
  }

  /**
   * Rename session
   */
  public async renameSession(id: string, name: string): Promise<Session | null> {
    await this.ensureInitialized();
    
    if (!this.isValidId(id)) return null;
    
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }

    session.name = this.sanitizeInput(name, 100);
    session.updatedAt = new Date();

    await this.saveSession(session);

    return session;
  }

  // ============================================================================
  // Validation & Sanitization Helpers
  // ============================================================================

  /**
   * Validate session ID format
   */
  private isValidId(id: string): boolean {
    return typeof id === 'string' && /^session-\d+-[a-z0-9]+$/.test(id);
  }

  /**
   * Sanitize input string
   */
  private sanitizeInput(input: string, maxLength: number): string {
    if (typeof input !== 'string') return '';
    // Remove control characters and trim
    const sanitized = input.replace(/[\x00-\x1F\x7F]/g, '').trim();
    return sanitized.slice(0, maxLength);
  }

  /**
   * Validate AI provider
   */
  private validateProvider(provider: AIProvider): AIProvider {
    const validProviders: AIProvider[] = ['openai', 'anthropic', 'google', 'custom', 'webai'];
    return validProviders.includes(provider) ? provider : 'openai';
  }

  /**
   * Validate message role
   */
  private validateRole(role: string): 'system' | 'user' | 'assistant' {
    const validRoles = ['system', 'user', 'assistant'];
    return validRoles.includes(role) ? (role as 'system' | 'user' | 'assistant') : 'user';
  }
}

// Singleton instance
let sessionManagerInstance: SessionManager | null = null;

/**
 * Get session manager instance
 */
export function getSessionManager(): SessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager();
  }
  return sessionManagerInstance;
}

/**
 * Initialize session manager and wait for ready
 */
export async function initSessionManager(): Promise<SessionManager> {
  const instance = getSessionManager();
  await instance.ensureInitialized();
  return instance;
}

// Export for backward compatibility
export const sessionManager = new SessionManager();
