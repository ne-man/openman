/**
 * Streaming AI Responses
 * Real-time streaming for OpenAI and Anthropic APIs
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { EventEmitter } from 'events';
import type { AIMessage, AIProvider, AIResponse } from '@/types';
import { config } from '@/core/config';

export interface StreamChunk {
  type: 'token' | 'delta' | 'done';
  content?: string;
  delta?: {
    role?: string;
    content?: string;
  };
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: AIProvider;
  finishReason?: string;
}

export interface StreamOptions {
  onToken?: (token: string) => void;
  onChunk?: (chunk: StreamChunk) => void;
  onComplete?: (response: AIResponse) => void;
  onError?: (error: Error) => void;
  onCancel?: () => void;
}

export class StreamingAI extends EventEmitter {
  private openai: OpenAI | null = null;
  private anthropic: Anthropic | null = null;

  constructor() {
    super();
    this.initializeProviders();
  }

  private initializeProviders(): void {
    const aiConfig = config.get('ai');

    if (aiConfig.openai?.apiKey) {
      this.openai = new OpenAI({
        apiKey: aiConfig.openai.apiKey,
      });
    }

    if (aiConfig.anthropic?.apiKey) {
      this.anthropic = new Anthropic({
        apiKey: aiConfig.anthropic.apiKey,
      });
    }
  }

  /**
   * Stream completion with real-time token delivery
   */
  public async streamCompletion(
    messages: AIMessage[],
    provider?: AIProvider,
    options: StreamOptions = {}
  ): Promise<AIResponse> {
    const targetProvider = provider || config.get('ai').defaultProvider;

    this.emit('start', { provider: targetProvider });

    try {
      switch (targetProvider) {
        case 'openai':
          return await this.streamOpenAI(messages, options);
        case 'anthropic':
          return await this.streamAnthropic(messages, options);
        default:
          throw new Error(`Unsupported provider: ${targetProvider}`);
      }
    } catch (error) {
      if (options.onError) {
        options.onError(error as Error);
      }
      throw error;
    }
  }

  /**
   * Stream OpenAI completion
   */
  private async streamOpenAI(
    messages: AIMessage[],
    options: StreamOptions
  ): Promise<AIResponse> {
    if (!this.openai) {
      throw new Error('OpenAI not configured');
    }

    const aiConfig = config.getAIProvider('openai');
    if (!aiConfig) {
      throw new Error('OpenAI configuration not found');
    }

    let fullContent = '';
    const stream = await this.openai.chat.completions.create({
      model: aiConfig.model || 'gpt-4',
      messages: messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })),
      max_tokens: aiConfig.maxTokens || 4000,
      temperature: aiConfig.temperature || 0.7,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      const finishReason = chunk.choices[0]?.finish_reason;

      if (delta?.content) {
        const token = delta.content;
        fullContent += token;

        // Emit token event
        this.emit('token', token);

        // Call callback
        if (options.onToken) {
          options.onToken(token);
        }

        // Send chunk
        const streamChunk: StreamChunk = {
          type: 'delta',
          delta: { content: token },
          model: chunk.model,
          provider: 'openai',
        };

        this.emit('chunk', streamChunk);

        if (options.onChunk) {
          options.onChunk(streamChunk);
        }
      }

      if (finishReason) {
        const response: AIResponse = {
          content: fullContent,
          usage: {
            promptTokens: chunk.usage?.prompt_tokens || 0,
            completionTokens: chunk.usage?.completion_tokens || 0,
            totalTokens: chunk.usage?.total_tokens || 0,
          },
          model: chunk.model,
          provider: 'openai',
        };

        // Emit completion
        this.emit('complete', response);

        if (options.onComplete) {
          options.onComplete(response);
        }

        return response;
      }
    }

    throw new Error('Stream ended without completion');
  }

  /**
   * Stream Anthropic completion
   */
  private async streamAnthropic(
    messages: AIMessage[],
    options: StreamOptions
  ): Promise<AIResponse> {
    if (!this.anthropic) {
      throw new Error('Anthropic not configured');
    }

    const aiConfig = config.getAIProvider('anthropic');
    if (!aiConfig) {
      throw new Error('Anthropic configuration not found');
    }

    // Convert messages to Anthropic format
    const systemMessage = messages.find((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    let fullContent = '';
    const stream = await this.anthropic.messages.create({
      model: aiConfig.model || 'claude-3-opus-20240229',
      max_tokens: aiConfig.maxTokens || 4000,
      system: systemMessage?.content,
      messages: conversationMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      stream: true,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          const token = delta.text;
          fullContent += token;

          // Emit token event
          this.emit('token', token);

          // Call callback
          if (options.onToken) {
            options.onToken(token);
          }

          // Send chunk
          const anthropicEvent = event as { model?: string };
          const streamChunk: StreamChunk = {
            type: 'delta',
            delta: { content: token },
            model: anthropicEvent.model || 'claude-3',
            provider: 'anthropic',
          };

          this.emit('chunk', streamChunk);

          if (options.onChunk) {
            options.onChunk(streamChunk);
          }
        }
      } else if (event.type === 'message_stop') {
        const stopEvent = event as { usage?: { input_tokens?: number; output_tokens?: number }; model?: string };
        const usage = stopEvent.usage || { input_tokens: 0, output_tokens: 0 };
        const response: AIResponse = {
          content: fullContent,
          usage: {
            promptTokens: usage.input_tokens || 0,
            completionTokens: usage.output_tokens || 0,
            totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
          },
          model: stopEvent.model || 'claude-3',
          provider: 'anthropic',
        };

        // Emit completion
        this.emit('complete', response);

        if (options.onComplete) {
          options.onComplete(response);
        }

        return response;
      }
    }

    throw new Error('Stream ended without completion');
  }

  /**
   * Cancel ongoing stream
   */
  public cancel(): void {
    this.emit('cancel');
  }

  /**
   * Check if provider is available
   */
  public isProviderAvailable(provider: AIProvider): boolean {
    switch (provider) {
      case 'openai':
        return this.openai !== null;
      case 'anthropic':
        return this.anthropic !== null;
      default:
        return false;
    }
  }
}

// Singleton instance
export const streamingAI = new StreamingAI();
