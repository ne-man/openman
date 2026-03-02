/**
 * Memory System for OpenMan
 * Implements episodic and semantic memory with importance scoring
 */

import fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import type { MemoryEntry } from '@/types';
import { generateId, formatDate } from '@/utils';
import { auditLogger } from '@/core/audit';
import { Logger } from '@/utils/logger';

const log = Logger.getInstance({ moduleName: 'MEM' }).createModuleLogger('MEM');

export interface MemoryQuery {
  type?: 'episodic' | 'semantic' | 'preference';
  tags?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  minImportance?: number;
  limit?: number;
}

export class MemorySystem {
  private memoryFile: string;
  private memories: Map<string, MemoryEntry> = new Map();
  private maxMemories: number = 10000;
  private forgettingThreshold: number = 0.3;

  constructor() {
    const dataDir = path.join(homedir(), '.openman', 'memory');
    this.memoryFile = path.join(dataDir, 'memories.jsonl');
    this.ensureDataDir();
    this.loadMemories();
  }

  private async ensureDataDir(): Promise<void> {
    const dir = path.dirname(this.memoryFile);
    await fs.mkdir(dir, { recursive: true });
  }

  private async loadMemories(): Promise<void> {
    try {
      const content = await fs.readFile(this.memoryFile, 'utf-8');
      const lines = content.split('\n').filter(line => line.trim());

      for (const line of lines) {
        try {
          const memory: MemoryEntry = JSON.parse(line);
          memory.timestamp = new Date(memory.timestamp);
          this.memories.set(memory.id, memory);
        } catch (error) {
          log.warn('Failed to parse memory entry');
        }
      }

      log.info(`Loaded ${this.memories.size} memories`);
    } catch (error) {
      // File doesn't exist yet, that's ok
      log.debug('No existing memories found');
    }
  }

  private async saveMemories(): Promise<void> {
    const lines: string[] = [];

    for (const memory of this.memories.values()) {
      lines.push(JSON.stringify(memory));
    }

    await fs.writeFile(this.memoryFile, lines.join('\n') + '\n', 'utf-8');
    log.debug(`Saved ${this.memories.size} memories to file`);
  }

  /**
   * Add a new memory
   */
  public async addMemory(
    content: string,
    type: 'episodic' | 'semantic' | 'preference',
    options: {
      importance?: number;
      tags?: string[];
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<MemoryEntry> {
    const memory: MemoryEntry = {
      id: generateId('mem-'),
      type,
      content,
      timestamp: new Date(),
      importance: options.importance || this.calculateImportance(content, type),
      tags: options.tags || [],
    };

    this.memories.set(memory.id, memory);
    await this.saveMemories();

    log.debug(`Added memory: ${memory.id} (type=${type}, importance=${(memory.importance ?? 0).toFixed(2)})`);

    await auditLogger.log({
      timestamp: new Date(),
      action: 'memory.add',
      details: { memoryId: memory.id, type, importance: memory.importance },
      result: 'success',
      riskLevel: 'low',
    });

    // Check if we need to forget old memories
    if (this.memories.size > this.maxMemories) {
      await this.forgetOldMemories();
    }

    return memory;
  }

  /**
   * Get a specific memory
   */
  public getMemory(id: string): MemoryEntry | undefined {
    return this.memories.get(id);
  }

  /**
   * Query memories
   */
  public async queryMemories(query: MemoryQuery = {}): Promise<MemoryEntry[]> {
    let results = Array.from(this.memories.values());

    // Filter by type
    if (query.type) {
      results = results.filter(m => m.type === query.type);
    }

    // Filter by tags
    if (query.tags && query.tags.length > 0) {
      results = results.filter(m =>
        query.tags!.some(tag => m.tags?.includes(tag))
      );
    }

    // Filter by date range
    if (query.dateFrom) {
      results = results.filter(m => m.timestamp >= query.dateFrom!);
    }
    if (query.dateTo) {
      results = results.filter(m => m.timestamp <= query.dateTo!);
    }

    // Filter by importance
    if (query.minImportance) {
      results = results.filter(m => (m.importance || 0) >= query.minImportance!);
    }

    // Sort by importance and date
    results.sort((a, b) => {
      const importanceDiff = (b.importance || 0) - (a.importance || 0);
      if (importanceDiff !== 0) return importanceDiff;
      return b.timestamp.getTime() - a.timestamp.getTime();
    });

    // Limit results
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Search memories by content
   */
  public searchMemories(query: string, limit: number = 10): MemoryEntry[] {
    const results: MemoryEntry[] = [];
    const queryLower = query.toLowerCase();

    for (const memory of this.memories.values()) {
      const contentLower = memory.content.toLowerCase();
      if (contentLower.includes(queryLower)) {
        results.push(memory);
      }
    }

    // Sort by relevance (simple approach: count matches)
    results.sort((a, b) => {
      const aMatches = (a.content.match(new RegExp(query, 'gi')) || []).length;
      const bMatches = (b.content.match(new RegExp(query, 'gi')) || []).length;
      return bMatches - aMatches;
    });

    return results.slice(0, limit);
  }

  /**
   * Update a memory
   */
  public async updateMemory(
    id: string,
    updates: Partial<MemoryEntry>
  ): Promise<MemoryEntry | null> {
    const memory = this.memories.get(id);
    if (!memory) {
      return null;
    }

    const updated = { ...memory, ...updates };
    this.memories.set(id, updated);
    await this.saveMemories();

    await auditLogger.log({
      timestamp: new Date(),
      action: 'memory.update',
      details: { memoryId: id, updates },
      result: 'success',
      riskLevel: 'low',
    });

    return updated;
  }

  /**
   * Delete a memory
   */
  public async deleteMemory(id: string): Promise<boolean> {
    const memory = this.memories.get(id);
    if (!memory) {
      return false;
    }

    this.memories.delete(id);
    await this.saveMemories();

    await auditLogger.log({
      timestamp: new Date(),
      action: 'memory.delete',
      details: { memoryId: id, type: memory.type },
      result: 'success',
      riskLevel: 'low',
    });

    return true;
  }

  /**
   * Forget old/less important memories
   */
  private async forgetOldMemories(): Promise<void> {
    const memories = Array.from(this.memories.values());

    // Sort by importance and date
    memories.sort((a, b) => {
      const importanceDiff = (a.importance || 0) - (b.importance || 0);
      if (importanceDiff !== 0) return importanceDiff;
      return a.timestamp.getTime() - b.timestamp.getTime();
    });

    // Keep only top 90%
    const keepCount = Math.floor(this.maxMemories * 0.9);
    const toForget = memories.slice(keepCount);

    for (const memory of toForget) {
      if (memory.importance !== undefined && memory.importance < this.forgettingThreshold) {
        this.memories.delete(memory.id);
      }
    }

    await this.saveMemories();

    await auditLogger.log({
      timestamp: new Date(),
      action: 'memory.forget',
      details: { forgottenCount: toForget.length },
      result: 'success',
      riskLevel: 'low',
    });
  }

  /**
   * Calculate importance score for a memory
   */
  private calculateImportance(content: string, type: string): number {
    let importance = 0.5;

    // Episodic memories from recent interactions are more important
    if (type === 'episodic') {
      importance += 0.2;
    }

    // Semantic knowledge is valuable
    if (type === 'semantic') {
      importance += 0.3;
    }

    // User preferences are very important
    if (type === 'preference') {
      importance += 0.4;
    }

    // Longer content might be more important
    if (content.length > 100) {
      importance += 0.1;
    }

    // Keywords that suggest importance
    const importantKeywords = [
      'important', 'critical', 'urgent', 'must', 'always', 'never',
      'prefer', 'like', 'dislike', 'remember'
    ];

    const lowerContent = content.toLowerCase();
    const keywordCount = importantKeywords.filter(kw =>
      lowerContent.includes(kw)
    ).length;

    importance += keywordCount * 0.05;

    // Normalize to 0-1 range
    return Math.min(Math.max(importance, 0), 1);
  }

  /**
   * Get memory statistics
   */
  public getStatistics(): {
    total: number;
    byType: Record<string, number>;
    averageImportance: number;
    oldestDate: Date | null;
    newestDate: Date | null;
  } {
    const memories = Array.from(this.memories.values());

    const byType: Record<string, number> = {};
    let totalImportance = 0;
    let oldestDate: Date | null = null;
    let newestDate: Date | null = null;

    for (const memory of memories) {
      byType[memory.type] = (byType[memory.type] || 0) + 1;
      totalImportance += memory.importance || 0;

      if (!oldestDate || memory.timestamp < oldestDate) {
        oldestDate = memory.timestamp;
      }
      if (!newestDate || memory.timestamp > newestDate) {
        newestDate = memory.timestamp;
      }
    }

    return {
      total: memories.length,
      byType,
      averageImportance: memories.length > 0 ? totalImportance / memories.length : 0,
      oldestDate,
      newestDate,
    };
  }

  /**
   * Get recent memories
   */
  public getRecentMemories(count: number = 10, type?: string): MemoryEntry[] {
    let results = Array.from(this.memories.values());

    if (type) {
      results = results.filter(m => m.type === type);
    }

    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return results.slice(0, count);
  }

  /**
   * Export memories
   */
  public async exportMemories(filePath?: string): Promise<string> {
    const exportPath = filePath || path.join(
      path.dirname(this.memoryFile),
      `memory-export-${Date.now()}.jsonl`
    );

    const lines: string[] = [];
    for (const memory of this.memories.values()) {
      lines.push(JSON.stringify(memory));
    }

    await fs.writeFile(exportPath, lines.join('\n') + '\n', 'utf-8');

    return exportPath;
  }

  /**
   * Import memories
   */
  public async importMemories(filePath: string): Promise<number> {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    let imported = 0;
    for (const line of lines) {
      try {
        const memory: MemoryEntry = JSON.parse(line);
        memory.timestamp = new Date(memory.timestamp);
        this.memories.set(memory.id, memory);
        imported++;
      } catch (error) {
        console.error('Failed to import memory:', error);
      }
    }

    await this.saveMemories();

    await auditLogger.log({
      timestamp: new Date(),
      action: 'memory.import',
      details: { filePath, imported },
      result: 'success',
      riskLevel: 'low',
    });

    return imported;
  }

  /**
   * Clear all memories
   */
  public async clearMemories(): Promise<void> {
    this.memories.clear();
    await this.saveMemories();

    await auditLogger.log({
      timestamp: new Date(),
      action: 'memory.clear',
      details: {},
      result: 'success',
      riskLevel: 'medium',
    });
  }
}

// Singleton instance
export const memorySystem = new MemorySystem();
