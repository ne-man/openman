/**
 * Web UI Server for OpenMan
 * Serves static files and provides REST/WebSocket APIs
 */

import express, { Request, Response } from 'express';
import { createServer, Server } from 'http';
import { WebSocketGateway } from '@/gateway/websocket';
import { aiService } from '@/ai/service';
import { streamingAI } from '@/ai/streaming';
import { sessionManager } from '@/core/session';
import { memorySystem } from '@/core/memory';
import { config } from '@/core/config';
import type { AIMessage, AIProvider } from '@/types';
import { auditLogger } from '@/core/audit';

export class WebServer {
  private app: express.Application;
  private server: Server | null = null;
  private gateway: WebSocketGateway;
  private port: number;

  constructor(port: number = 3000) {
    this.app = express();
    this.gateway = new WebSocketGateway(port + 1); // WebSocket on port + 1
    this.port = port;

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocketHandlers();
  }

  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Serve static files
    this.app.use(express.static('src/web/public'));

    // CORS
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      next();
    });

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Configuration
    this.app.get('/api/config', (req, res) => {
      const configData = config.getAll();
      res.json(configData);
    });

    // Sessions
    this.app.get('/api/sessions', async (req, res) => {
      const sessions = sessionManager.listSessions();
      res.json(sessions);
    });

    this.app.post('/api/sessions', async (req, res) => {
      try {
        const { name, provider, model } = req.body;
        const session = await sessionManager.createSession(name, provider, model);
        res.json(session);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/sessions/:id', (req, res) => {
      const session = sessionManager.getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json(session);
    });

    this.app.post('/api/sessions/:id/message', async (req, res) => {
      try {
        const { role, content } = req.body;
        const session = await sessionManager.addMessage(
          req.params.id,
          role,
          content
        );
        res.json(session);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Chat with streaming
    this.app.post('/api/chat', async (req: Request, res: Response) => {
      const { messages, provider, stream = false } = req.body;

      if (!stream) {
        // Non-streaming
        try {
          const response = await aiService.completion(messages, provider);
          res.json(response);
        } catch (error: any) {
          res.status(500).json({ error: error.message });
        }
      } else {
        // Streaming
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const streamOptions = {
          onToken: (token: string) => {
            res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
            // flush if available (requires compression middleware)
            if ((res as any).flush) (res as any).flush();
          },
          onComplete: (response: any) => {
            res.write(`data: ${JSON.stringify({ type: 'complete', response })}\n\n`);
            res.end();
          },
          onError: (error: Error) => {
            res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
            res.end();
          },
        };

        await streamingAI.streamCompletion(messages, provider, streamOptions);
      }
    });

    // Memory
    this.app.get('/api/memory', async (req, res) => {
      const { type, limit, search } = req.query;
      let memories;

      if (search) {
        memories = memorySystem.searchMemories(search as string, parseInt(limit as string) || 10);
      } else {
        memories = await memorySystem.queryMemories({
          type: type as any,
          limit: limit ? parseInt(limit as string) : undefined,
        });
      }

      res.json(memories);
    });

    this.app.post('/api/memory', async (req, res) => {
      try {
        const { content, type, importance, tags } = req.body;
        const memory = await memorySystem.addMemory(content, type, {
          importance,
          tags,
        });
        res.json(memory);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/memory/stats', (req, res) => {
      const stats = memorySystem.getStatistics();
      res.json(stats);
    });

    // Gateway statistics
    this.app.get('/api/gateway/stats', (req, res) => {
      const stats = this.gateway.getStatistics();
      res.json(stats);
    });

    // Broadcast message to all WebSocket clients
    this.app.post('/api/broadcast', async (req, res) => {
      const { message, options } = req.body;
      const sentCount = this.gateway.broadcast(message, options);
      res.json({ sentCount });
    });
  }

  private setupWebSocketHandlers(): void {
    // Handle chat requests from WebSocket
    this.gateway.onMessage('chat', async (message, client) => {
      try {
        const { messages, provider } = message.payload as { messages: AIMessage[], provider: AIProvider };

        // Stream response to client
        const streamOptions = {
          onToken: (token: string) => {
            this.gateway.send(client.id, {
              type: 'chat.token',
              payload: { token },
            });
          },
          onComplete: (response: any) => {
            this.gateway.send(client.id, {
              type: 'chat.complete',
              payload: { response },
            });
          },
          onError: (error: Error) => {
            this.gateway.sendError(client.id, error.message);
          },
        };

        await streamingAI.streamCompletion(messages, provider, streamOptions);
      } catch (error: any) {
        this.gateway.sendError(client.id, error.message);
      }
    });

    // Handle session commands from WebSocket
    this.gateway.onMessage('session.create', async (message, client) => {
      try {
        const payload = message.payload as { name: string; provider: AIProvider; model: string };
        const session = await sessionManager.createSession(payload.name, payload.provider, payload.model);
        this.gateway.send(client.id, {
          type: 'session.created',
          payload: { session },
        });
      } catch (error: any) {
        this.gateway.sendError(client.id, error.message);
      }
    });

    // Handle memory commands from WebSocket
    this.gateway.onMessage('memory.add', async (message, client) => {
      try {
        const payload = message.payload as { content: string; type: 'episodic' | 'semantic' | 'preference'; importance?: number; tags?: string[] };
        const memory = await memorySystem.addMemory(payload.content, payload.type, {
          importance: payload.importance,
          tags: payload.tags,
        });
        this.gateway.send(client.id, {
          type: 'memory.added',
          payload: { memory },
        });
      } catch (error: any) {
        this.gateway.sendError(client.id, error.message);
      }
    });
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer(this.app);

      this.server.listen(this.port, () => {
        console.log(`Web UI server listening on port ${this.port}`);
        console.log(`WebSocket Gateway listening on port ${this.port + 1}`);

        // Start WebSocket gateway
        this.gateway.attach(this.server!).then(() => {
          resolve();
        }).catch(reject);
      });

      this.server.on('error', (error) => {
        console.error('Web server error:', error);
        reject(error);
      });
    });
  }

  /**
   * Stop the server
   */
  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.gateway.close().then(() => {
        this.server!.close((err) => {
          if (err) {
            reject(err);
          } else {
            this.server = null;
            resolve();
          }
        });
      });
    });
  }

  /**
   * Get server info
   */
  public getInfo() {
    return {
      webPort: this.port,
      wsPort: this.port + 1,
      running: this.server !== null,
    };
  }
}
