/**
 * WebSocket Gateway for OpenMan
 * Real-time communication server for web UI and other clients
 */

import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import type { Server } from 'http';
import { auditLogger } from '@/core/audit';
import { generateId } from '@/utils';

export interface GatewayClient {
  id: string;
  type: 'web' | 'cli' | 'mobile' | 'plugin';
  ws: WebSocket;
  metadata: Record<string, unknown>;
  connectedAt: Date;
  lastActivity: Date;
}

export interface GatewayMessage {
  id: string;
  type: string;
  payload: unknown;
  timestamp: Date;
  from?: string;
  to?: string | string[];
}

export interface BroadcastOptions {
  excludeClient?: string;
  clientTypes?: string[];
}

export class WebSocketGateway extends EventEmitter {
  private server: WebSocketServer | null = null;
  private clients: Map<string, GatewayClient> = new Map();
  private messageHandlers: Map<string, (message: GatewayMessage, client: GatewayClient) => Promise<void>> = new Map();
  private port: number;

  constructor(port: number = 8765) {
    super();
    this.port = port;
  }

  /**
   * Start the WebSocket server
   */
  public async attach(httpServer?: Server): Promise<void> {
    if (this.server) {
      throw new Error('Gateway is already running');
    }

    this.server = new WebSocketServer({ server: httpServer, port: this.port });

    this.server.on('connection', (ws: WebSocket, req) => {
      this.handleConnection(ws, req);
    });

    this.server.on('error', (error) => {
      this.emit('error', error);
      console.error('WebSocket Gateway error:', error);
    });

    await auditLogger.log({
      timestamp: new Date(),
      action: 'gateway.start',
      details: { port: this.port },
      result: 'success',
      riskLevel: 'low',
    });

    console.log(`WebSocket Gateway listening on port ${this.port}`);
  }

  /**
   * Stop the WebSocket server
   */
  public async close(): Promise<void> {
    if (!this.server) {
      return;
    }

    // Close all client connections
    for (const [clientId, client] of this.clients) {
      try {
        client.ws.close(1000, 'Server shutting down');
      } catch (error) {
        console.error(`Error closing client ${clientId}:`, error);
      }
    }

    this.clients.clear();

    // Close the server
    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });

    this.server = null;

    await auditLogger.log({
      timestamp: new Date(),
      action: 'gateway.stop',
      details: {},
      result: 'success',
      riskLevel: 'low',
    });
  }

  /**
   * Handle new client connection
   */
  private async handleConnection(ws: WebSocket, req: any): Promise<void> {
    const clientId = generateId('client-');
    const clientType = req.headers['x-client-type'] as string || 'web';
    const clientMetadata = this.parseClientMetadata(req);

    const client: GatewayClient = {
      id: clientId,
      type: clientType as any,
      ws,
      metadata: clientMetadata,
      connectedAt: new Date(),
      lastActivity: new Date(),
    };

    this.clients.set(clientId, client);

    // Setup message handler
    ws.on('message', (data: Buffer) => {
      this.handleClientMessage(client, data);
    });

    // Setup close handler
    ws.on('close', (code: number, reason: Buffer) => {
      this.handleClientDisconnection(clientId, code, reason?.toString());
    });

    // Setup error handler
    ws.on('error', (error) => {
      console.error(`Client ${clientId} error:`, error);
    });

    // Send welcome message
    this.send(clientId, {
      type: 'welcome',
      payload: {
        clientId,
        serverTime: new Date().toISOString(),
      },
    });

    this.emit('connection', client);

    await auditLogger.log({
      timestamp: new Date(),
      action: 'gateway.client.connect',
      details: { clientId, clientType },
      result: 'success',
      riskLevel: 'low',
    });
  }

  /**
   * Handle incoming message from client
   */
  private async handleClientMessage(client: GatewayClient, data: Buffer): Promise<void> {
    try {
      const message: GatewayMessage = JSON.parse(data.toString());
      message.timestamp = new Date();

      // Update client activity
      client.lastActivity = new Date();

      // Route message to handler
      const handler = this.messageHandlers.get(message.type);
      if (handler) {
        await handler(message, client);
      } else {
        // No handler found, emit event
        this.emit(message.type, message, client);
      }

      await auditLogger.log({
        timestamp: new Date(),
        action: 'gateway.message',
        details: {
          messageId: message.id,
          type: message.type,
          clientId: client.id,
        },
        result: 'success',
        riskLevel: 'low',
      });
    } catch (error) {
      console.error(`Error handling message from ${client.id}:`, error);
      this.sendError(client.id, 'Invalid message format');
    }
  }

  /**
   * Handle client disconnection
   */
  private async handleClientDisconnection(
    clientId: string,
    code: number,
    reason?: string
  ): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    this.clients.delete(clientId);
    this.emit('disconnection', client);

    await auditLogger.log({
      timestamp: new Date(),
      action: 'gateway.client.disconnect',
      details: { clientId, code, reason },
      result: 'success',
      riskLevel: 'low',
    });
  }

  /**
   * Send message to specific client
   */
  public send(clientId: string, message: Omit<GatewayMessage, 'id' | 'timestamp'>): boolean {
    const client = this.clients.get(clientId);
    if (!client) {
      return false;
    }

    const fullMessage: GatewayMessage = {
      ...message,
      id: generateId('msg-'),
      timestamp: new Date(),
      from: 'gateway',
    };

    try {
      client.ws.send(JSON.stringify(fullMessage));
      return true;
    } catch (error) {
      console.error(`Error sending to client ${clientId}:`, error);
      return false;
    }
  }

  /**
   * Broadcast message to multiple clients
   */
  public broadcast(
    message: Omit<GatewayMessage, 'id' | 'timestamp'>,
    options: BroadcastOptions = {}
  ): number {
    const fullMessage: GatewayMessage = {
      ...message,
      id: generateId('msg-'),
      timestamp: new Date(),
      from: 'gateway',
    };

    let sentCount = 0;

    for (const [clientId, client] of this.clients) {
      // Check exclusion
      if (options.excludeClient && clientId === options.excludeClient) {
        continue;
      }

      // Check client type filter
      if (options.clientTypes && !options.clientTypes.includes(client.type)) {
        continue;
      }

      if (this.send(clientId, fullMessage)) {
        sentCount++;
      }
    }

    return sentCount;
  }

  /**
   * Send error to client
   */
  public sendError(clientId: string, error: string, details?: unknown): boolean {
    return this.send(clientId, {
      type: 'error',
      payload: { error, details },
    });
  }

  /**
   * Register message handler
   */
  public onMessage(
    type: string,
    handler: (message: GatewayMessage, client: GatewayClient) => Promise<void>
  ): void {
    this.messageHandlers.set(type, handler);
  }

  /**
   * Get connected clients
   */
  public getClients(): GatewayClient[] {
    return Array.from(this.clients.values());
  }

  /**
   * Get client by ID
   */
  public getClient(id: string): GatewayClient | undefined {
    return this.clients.get(id);
  }

  /**
   * Get clients by type
   */
  public getClientsByType(type: string): GatewayClient[] {
    return this.getClients().filter(client => client.type === type);
  }

  /**
   * Get gateway statistics
   */
  public getStatistics(): {
    total: number;
    byType: Record<string, number>;
    connectedNow: number;
  } {
    const clients = this.getClients();
    const byType: Record<string, number> = {};

    for (const client of clients) {
      byType[client.type] = (byType[client.type] || 0) + 1;
    }

    return {
      total: clients.length,
      byType,
      connectedNow: clients.length,
    };
  }

  /**
   * Send keepalive ping to all clients
   */
  public async keepalive(): Promise<number> {
    const sentCount = this.broadcast({
      type: 'ping',
      payload: { timestamp: new Date().toISOString() },
    });

    // Check for stale connections
    const timeout = 30000; // 30 seconds
    const now = Date.now();
    const staleClients: string[] = [];

    for (const [clientId, client] of this.clients) {
      if (now - client.lastActivity.getTime() > timeout) {
        staleClients.push(clientId);
      }
    }

    // Disconnect stale clients
    for (const clientId of staleClients) {
      const client = this.clients.get(clientId);
      if (client) {
        client.ws.terminate();
      }
    }

    return sentCount;
  }

  /**
   * Parse client metadata from request
   */
  private parseClientMetadata(req: any): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};

    // Extract headers as metadata
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.startsWith('x-') && key !== 'x-client-type') {
        metadata[key.substring(2)] = value;
      }
    }

    // Extract query parameters
    if (req.url) {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        url.searchParams.forEach((value, key) => {
          metadata[key] = value;
        });
      } catch (error) {
        // Invalid URL, skip
      }
    }

    return metadata;
  }

  /**
   * Is server running?
   */
  public isRunning(): boolean {
    return this.server !== null;
  }
}

// Singleton instance
export const gateway = new WebSocketGateway();
