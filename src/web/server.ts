/**
 * Web UI Server for OpenMan
 * Serves static files and provides REST/WebSocket APIs
 * Enhanced with input validation and security improvements
 */

import express, { Request, Response, NextFunction } from 'express';
import { createServer, Server } from 'http';
import { WebSocketGateway } from '@/gateway/websocket';
import { aiService } from '@/ai/service';
import { streamingAI } from '@/ai/streaming';
import { sessionManager } from '@/core/session';
import { memorySystem } from '@/core/memory';
import { config } from '@/core/config';
import type { AIMessage, AIProvider } from '@/types';
import { auditLogger } from '@/core/audit';
import { Logger } from '@/utils/logger';

const log = Logger.getInstance({ moduleName: 'WEB' }).createModuleLogger('WEB');

// ============================================================================
// Types & Constants
// ============================================================================

interface ChatRequest {
  messages: AIMessage[];
  provider?: AIProvider;
  stream?: boolean;
}

interface CreateSessionRequest {
  name: string;
  provider?: AIProvider;
  model?: string;
}

interface AddMessageRequest {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AddMemoryRequest {
  content: string;
  type: 'episodic' | 'semantic' | 'preference';
  importance?: number;
  tags?: string[];
}

// Configuration constants
const MAX_MESSAGE_LENGTH = 100000; // 100KB
const MAX_SESSION_NAME_LENGTH = 100;
const MAX_MEMORY_CONTENT_LENGTH = 50000;
const MAX_MESSAGES_PER_REQUEST = 100;
const REQUEST_TIMEOUT_MS = 120000; // 2 minutes

// CORS configuration - use environment variable or strict default
const CORS_ORIGINS = process.env.CORS_ORIGINS 
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

// ============================================================================
// Validation Functions
// ============================================================================

function validateMessages(messages: unknown): { valid: boolean; error?: string; data?: AIMessage[] } {
  if (!Array.isArray(messages)) {
    return { valid: false, error: 'Messages must be an array' };
  }
  
  if (messages.length === 0) {
    return { valid: false, error: 'Messages array cannot be empty' };
  }
  
  if (messages.length > MAX_MESSAGES_PER_REQUEST) {
    return { valid: false, error: `Too many messages (max ${MAX_MESSAGES_PER_REQUEST})` };
  }
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || typeof msg !== 'object') {
      return { valid: false, error: `Message ${i} is invalid` };
    }
    
    if (!['system', 'user', 'assistant'].includes(msg.role)) {
      return { valid: false, error: `Message ${i} has invalid role` };
    }
    
    if (typeof msg.content !== 'string') {
      return { valid: false, error: `Message ${i} content must be a string` };
    }
    
    if (msg.content.length > MAX_MESSAGE_LENGTH) {
      return { valid: false, error: `Message ${i} content exceeds maximum length` };
    }
  }
  
  return { valid: true, data: messages as AIMessage[] };
}

function validateProvider(provider: unknown): { valid: boolean; error?: string; data?: AIProvider } {
  if (provider === undefined) {
    return { valid: true, data: undefined };
  }
  
  const validProviders: AIProvider[] = ['openai', 'anthropic', 'google', 'custom', 'webai'];
  if (!validProviders.includes(provider as AIProvider)) {
    return { valid: false, error: `Invalid provider. Valid: ${validProviders.join(', ')}` };
  }
  
  return { valid: true, data: provider as AIProvider };
}

function validateSessionName(name: unknown): { valid: boolean; error?: string; data?: string } {
  if (typeof name !== 'string') {
    return { valid: false, error: 'Session name must be a string' };
  }
  
  const sanitized = name.trim().replace(/[\x00-\x1F\x7F]/g, '');
  
  if (sanitized.length === 0) {
    return { valid: false, error: 'Session name cannot be empty' };
  }
  
  if (sanitized.length > MAX_SESSION_NAME_LENGTH) {
    return { valid: false, error: `Session name too long (max ${MAX_SESSION_NAME_LENGTH})` };
  }
  
  return { valid: true, data: sanitized };
}

function validateMemoryType(type: unknown): { valid: boolean; error?: string; data?: 'episodic' | 'semantic' | 'preference' } {
  const validTypes = ['episodic', 'semantic', 'preference'];
  if (!validTypes.includes(type as string)) {
    return { valid: false, error: `Invalid memory type. Valid: ${validTypes.join(', ')}` };
  }
  return { valid: true, data: type as 'episodic' | 'semantic' | 'preference' };
}

function validateMemoryContent(content: unknown): { valid: boolean; error?: string; data?: string } {
  if (typeof content !== 'string') {
    return { valid: false, error: 'Memory content must be a string' };
  }
  
  const sanitized = content.trim();
  
  if (sanitized.length === 0) {
    return { valid: false, error: 'Memory content cannot be empty' };
  }
  
  if (sanitized.length > MAX_MEMORY_CONTENT_LENGTH) {
    return { valid: false, error: `Memory content too long (max ${MAX_MEMORY_CONTENT_LENGTH})` };
  }
  
  return { valid: true, data: sanitized };
}

function validateImportance(importance: unknown): { valid: boolean; error?: string; data?: number } {
  if (importance === undefined) {
    return { valid: true, data: undefined };
  }
  
  const num = Number(importance);
  if (isNaN(num)) {
    return { valid: false, error: 'Importance must be a number' };
  }
  
  if (num < 0 || num > 1) {
    return { valid: false, error: 'Importance must be between 0 and 1' };
  }
  
  return { valid: true, data: num };
}

function validateSessionId(id: unknown): { valid: boolean; error?: string; data?: string } {
  if (typeof id !== 'string') {
    return { valid: false, error: 'Session ID must be a string' };
  }
  
  if (!/^session-\d+-[a-z0-9]+$/.test(id)) {
    return { valid: false, error: 'Invalid session ID format' };
  }
  
  return { valid: true, data: id };
}

// ============================================================================
// Error Handler
// ============================================================================

function sendError(res: Response, statusCode: number, message: string): void {
  res.status(statusCode).json({ 
    error: message,
    timestamp: new Date().toISOString()
  });
}

// ============================================================================
// Web Server Class
// ============================================================================

export class WebServer {
  private app: express.Application;
  private server: Server | null = null;
  private gateway: WebSocketGateway;
  private port: number;

  constructor(port: number = 3000) {
    this.app = express();
    this.gateway = new WebSocketGateway(port + 1);
    this.port = port;

    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocketHandlers();
  }

  private setupMiddleware(): void {
    // Parse JSON with size limit
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Serve static files
    this.app.use(express.static('src/web/public'));

    // Security headers
    this.app.use((req, res, next) => {
      res.header('X-Content-Type-Options', 'nosniff');
      res.header('X-Frame-Options', 'DENY');
      res.header('X-XSS-Protection', '1; mode=block');
      next();
    });

    // CORS with strict origin checking
    this.app.use((req, res, next) => {
      const origin = req.headers.origin;
      
      if (origin && CORS_ORIGINS.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
      } else if (!origin && CORS_ORIGINS.includes('*')) {
        res.header('Access-Control-Allow-Origin', '*');
      }
      // If origin is not allowed, don't set Access-Control-Allow-Origin
      
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.header('Access-Control-Max-Age', '86400'); // 24 hours
      
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
      
      next();
    });

    // Request timeout
    this.app.use((req, res, next) => {
      req.setTimeout(REQUEST_TIMEOUT_MS);
      res.setTimeout(REQUEST_TIMEOUT_MS);
      next();
    });

    // Request logging (only in debug mode)
    if (process.env.DEBUG === 'true') {
      this.app.use((req, res, next) => {
        console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
        next();
      });
    }
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '0.1.0'
      });
    });

    // Configuration
    this.app.get('/api/config', (req, res) => {
      const configData = config.getAll();
      res.json(configData);
    });

    // Sessions
    this.app.get('/api/sessions', async (req, res) => {
      try {
        await sessionManager.ensureInitialized();
        const sessions = sessionManager.listSessions();
        res.json(sessions);
      } catch (error) {
        sendError(res, 500, 'Failed to list sessions');
      }
    });

    this.app.post('/api/sessions', async (req: Request, res: Response) => {
      try {
        await sessionManager.ensureInitialized();
        
        const body = req.body as CreateSessionRequest;
        
        // Validate session name
        const nameResult = validateSessionName(body.name);
        if (!nameResult.valid) {
          sendError(res, 400, nameResult.error!);
          return;
        }
        
        // Validate provider
        const providerResult = validateProvider(body.provider);
        if (!providerResult.valid) {
          sendError(res, 400, providerResult.error!);
          return;
        }
        
        const session = await sessionManager.createSession(
          nameResult.data!, 
          providerResult.data, 
          body.model
        );
        res.json(session);
      } catch (error) {
        sendError(res, 500, 'Failed to create session');
      }
    });

    this.app.get('/api/sessions/:id', async (req: Request, res: Response) => {
      try {
        await sessionManager.ensureInitialized();
        
        const idResult = validateSessionId(req.params.id);
        if (!idResult.valid) {
          sendError(res, 400, idResult.error!);
          return;
        }
        
        const session = sessionManager.getSession(idResult.data!);
        if (!session) {
          sendError(res, 404, 'Session not found');
          return;
        }
        res.json(session);
      } catch (error) {
        sendError(res, 500, 'Failed to get session');
      }
    });

    this.app.post('/api/sessions/:id/message', async (req: Request, res: Response) => {
      try {
        await sessionManager.ensureInitialized();
        
        const idResult = validateSessionId(req.params.id);
        if (!idResult.valid) {
          sendError(res, 400, idResult.error!);
          return;
        }
        
        const body = req.body as AddMessageRequest;
        
        // Validate role
        const validRoles = ['system', 'user', 'assistant'];
        if (!validRoles.includes(body.role)) {
          sendError(res, 400, 'Invalid role. Valid: system, user, assistant');
          return;
        }
        
        // Validate content
        if (typeof body.content !== 'string' || body.content.length === 0) {
          sendError(res, 400, 'Content is required');
          return;
        }
        
        if (body.content.length > MAX_MESSAGE_LENGTH) {
          sendError(res, 400, `Content too long (max ${MAX_MESSAGE_LENGTH})`);
          return;
        }
        
        const session = await sessionManager.addMessage(
          idResult.data!,
          body.role,
          body.content
        );
        
        if (!session) {
          sendError(res, 404, 'Session not found');
          return;
        }
        
        res.json(session);
      } catch (error) {
        sendError(res, 500, 'Failed to add message');
      }
    });

    // Chat with streaming
    this.app.post('/api/chat', async (req: Request, res: Response) => {
      try {
        const body = req.body as ChatRequest;
        
        // Validate messages
        const messagesResult = validateMessages(body.messages);
        if (!messagesResult.valid) {
          sendError(res, 400, messagesResult.error!);
          return;
        }
        
        // Validate provider
        const providerResult = validateProvider(body.provider);
        if (!providerResult.valid) {
          sendError(res, 400, providerResult.error!);
          return;
        }

        if (!body.stream) {
          // Non-streaming
          try {
            const response = await aiService.completion(messagesResult.data!, providerResult.data);
            res.json(response);
          } catch (error) {
            sendError(res, 500, 'AI completion failed');
          }
        } else {
          // Streaming
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

          const streamOptions = {
            onToken: (token: string) => {
              res.write(`data: ${JSON.stringify({ type: 'token', token })}\n\n`);
              if ((res as unknown as { flush: () => void }).flush) {
                (res as unknown as { flush: () => void }).flush();
              }
            },
            onComplete: (response: unknown) => {
              res.write(`data: ${JSON.stringify({ type: 'complete', response })}\n\n`);
              res.end();
            },
            onError: (error: Error) => {
              res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
              res.end();
            },
          };

          await streamingAI.streamCompletion(messagesResult.data!, providerResult.data, streamOptions);
        }
      } catch (error) {
        sendError(res, 500, 'Chat request failed');
      }
    });

    // Memory
    this.app.get('/api/memory', async (req, res) => {
      try {
        const { type, limit, search } = req.query;
        let memories;

        if (search) {
          const searchStr = String(search).slice(0, 200);
          memories = memorySystem.searchMemories(searchStr, Math.min(Number(limit) || 10, 100));
        } else {
          memories = await memorySystem.queryMemories({
            type: type as 'episodic' | 'semantic' | 'preference' | undefined,
            limit: Math.min(Number(limit) || 10, 100),
          });
        }

        res.json(memories);
      } catch (error) {
        sendError(res, 500, 'Failed to query memories');
      }
    });

    this.app.post('/api/memory', async (req: Request, res: Response) => {
      try {
        const body = req.body as AddMemoryRequest;
        
        // Validate content
        const contentResult = validateMemoryContent(body.content);
        if (!contentResult.valid) {
          sendError(res, 400, contentResult.error!);
          return;
        }
        
        // Validate type
        const typeResult = validateMemoryType(body.type);
        if (!typeResult.valid) {
          sendError(res, 400, typeResult.error!);
          return;
        }
        
        // Validate importance
        const importanceResult = validateImportance(body.importance);
        if (!importanceResult.valid) {
          sendError(res, 400, importanceResult.error!);
          return;
        }
        
        const memory = await memorySystem.addMemory(contentResult.data!, typeResult.data!, {
          importance: importanceResult.data,
          tags: Array.isArray(body.tags) ? body.tags.slice(0, 20).map(String) : undefined,
        });
        
        res.json(memory);
      } catch (error) {
        sendError(res, 500, 'Failed to add memory');
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
    this.app.post('/api/broadcast', async (req: Request, res: Response) => {
      try {
        const { message, options } = req.body;
        
        if (!message || typeof message !== 'object') {
          sendError(res, 400, 'Message is required');
          return;
        }
        
        const sentCount = this.gateway.broadcast(message, options);
        res.json({ sentCount });
      } catch (error) {
        sendError(res, 500, 'Failed to broadcast message');
      }
    });

    // 404 handler
    this.app.use((req, res) => {
      sendError(res, 404, 'Not found');
    });

    // Error handler
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      console.error('Server error:', err);
      sendError(res, 500, 'Internal server error');
    });
  }

  private setupWebSocketHandlers(): void {
    // Handle chat requests from WebSocket
    this.gateway.onMessage('chat', async (message, client) => {
      try {
        const payload = message.payload as ChatRequest;
        
        // Validate
        const messagesResult = validateMessages(payload.messages);
        if (!messagesResult.valid) {
          this.gateway.sendError(client.id, messagesResult.error!);
          return;
        }
        
        const providerResult = validateProvider(payload.provider);
        if (!providerResult.valid) {
          this.gateway.sendError(client.id, providerResult.error!);
          return;
        }

        // Stream response to client
        const streamOptions = {
          onToken: (token: string) => {
            this.gateway.send(client.id, {
              type: 'chat.token',
              payload: { token },
            });
          },
          onComplete: (response: unknown) => {
            this.gateway.send(client.id, {
              type: 'chat.complete',
              payload: { response },
            });
          },
          onError: (error: Error) => {
            this.gateway.sendError(client.id, error.message);
          },
        };

        await streamingAI.streamCompletion(messagesResult.data!, providerResult.data, streamOptions);
      } catch (error) {
        this.gateway.sendError(client.id, 'Chat request failed');
      }
    });

    // Handle session commands from WebSocket
    this.gateway.onMessage('session.create', async (message, client) => {
      try {
        await sessionManager.ensureInitialized();
        
        const payload = message.payload as CreateSessionRequest;
        
        const nameResult = validateSessionName(payload.name);
        if (!nameResult.valid) {
          this.gateway.sendError(client.id, nameResult.error!);
          return;
        }
        
        const providerResult = validateProvider(payload.provider);
        if (!providerResult.valid) {
          this.gateway.sendError(client.id, providerResult.error!);
          return;
        }
        
        const session = await sessionManager.createSession(nameResult.data!, providerResult.data, payload.model);
        this.gateway.send(client.id, {
          type: 'session.created',
          payload: { session },
        });
      } catch (error) {
        this.gateway.sendError(client.id, 'Failed to create session');
      }
    });

    // Handle memory commands from WebSocket
    this.gateway.onMessage('memory.add', async (message, client) => {
      try {
        const payload = message.payload as AddMemoryRequest;
        
        const contentResult = validateMemoryContent(payload.content);
        if (!contentResult.valid) {
          this.gateway.sendError(client.id, contentResult.error!);
          return;
        }
        
        const typeResult = validateMemoryType(payload.type);
        if (!typeResult.valid) {
          this.gateway.sendError(client.id, typeResult.error!);
          return;
        }
        
        const importanceResult = validateImportance(payload.importance);
        if (!importanceResult.valid) {
          this.gateway.sendError(client.id, importanceResult.error!);
          return;
        }
        
        const memory = await memorySystem.addMemory(contentResult.data!, typeResult.data!, {
          importance: importanceResult.data,
          tags: payload.tags,
        });
        
        this.gateway.send(client.id, {
          type: 'memory.added',
          payload: { memory },
        });
      } catch (error) {
        this.gateway.sendError(client.id, 'Failed to add memory');
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
        log.info(`Web UI server listening on port ${this.port}`);
        log.info(`WebSocket Gateway listening on port ${this.port + 1}`);
        log.debug(`Allowed CORS origins: ${CORS_ORIGINS.join(', ')}`);

        // Start WebSocket gateway
        this.gateway.attach(this.server!).then(() => {
          resolve();
        }).catch(reject);
      });

      this.server.on('error', (error) => {
        log.error(`Web server error: ${error.message}`);
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

      log.info('Stopping web server...');
      this.gateway.close().then(() => {
        this.server!.close((err) => {
          if (err) {
            log.error(`Failed to stop server: ${err.message}`);
            reject(err);
          } else {
            this.server = null;
            log.info('Web server stopped');
            resolve();
          }
        });
      });
    });
  }

  /**
   * Get server info
   */
  public getInfo(): { webPort: number; wsPort: number; running: boolean; corsOrigins: string[] } {
    return {
      webPort: this.port,
      wsPort: this.port + 1,
      running: this.server !== null,
      corsOrigins: CORS_ORIGINS,
    };
  }
}
