/**
 * Session Management System for OpenMan
 */

import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import { generateId } from '@/utils';
import type { AIMessage, AIProvider } from '@/types';
import { auditLogger } from '@/core/audit';

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

  constructor() {
    this.sessionsDir = path.join(homedir(), '.openman', 'sessions');
    this.ensureSessionsDir();
    this.loadSessions();
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
          console.error(`Failed to load session ${file}:`, error);
        }
      }

      console.log(`Loaded ${this.sessions.size} sessions`);
    } catch (error) {
      console.log('No existing sessions found');
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
    const session: Session = {
      id: generateId('session-'),
      name,
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [],
      provider,
      model,
      metadata: {},
    };

    this.sessions.set(session.id, session);
    this.currentSessionId = session.id;
    await this.saveSession(session);

    await auditLogger.log({
      timestamp: new Date(),
      action: 'session.create',
      details: { sessionId: session.id, name, provider },
      result: 'success',
      riskLevel: 'low',
    });

    return session;
  }

  /**
   * Get a session
   */
  public getSession(id: string): Session | undefined {
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
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const message: AIMessage = {
      role,
      content,
      timestamp: new Date(),
    };

    session.messages.push(message);
    session.updatedAt = new Date();

    await this.saveSession(session);

    await auditLogger.log({
      timestamp: new Date(),
      action: 'session.addMessage',
      details: { sessionId, role },
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
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }

    Object.assign(session, updates);
    session.updatedAt = new Date();

    await this.saveSession(session);

    return session;
  }

  /**
   * Delete a session
   */
  public async deleteSession(id: string): Promise<boolean> {
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
    try {
      const session: Session = JSON.parse(data);
      session.id = generateId('session-'); // Generate new ID
      session.createdAt = new Date(session.createdAt);
      session.updatedAt = new Date(session.updatedAt);

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
    const results: Session[] = [];
    const queryLower = query.toLowerCase();

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
    const session = this.sessions.get(id);
    if (!session) {
      return null;
    }

    session.name = name;
    session.updatedAt = new Date();

    await this.saveSession(session);

    return session;
  }
}

// Singleton instance
export const sessionManager = new SessionManager();
