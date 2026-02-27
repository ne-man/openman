/**
 * AI Service Integrations
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type {
  AIMessage,
  AIResponse,
  AIProvider,
} from '@/types';
import { config } from '@/core/config';
import { auditLogger } from '@/core/audit';

export class AIService {
  private openai: OpenAI | null = null;
  private anthropic: Anthropic | null = null;

  constructor() {
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

  public async completion(
    messages: AIMessage[],
    provider?: AIProvider
  ): Promise<AIResponse> {
    const targetProvider = provider || config.get('ai').defaultProvider;

    await auditLogger.log({
      timestamp: new Date(),
      action: 'ai.completion',
      details: {
        provider: targetProvider,
        messageCount: messages.length,
      },
      result: 'success',
      riskLevel: 'low',
    });

    switch (targetProvider) {
      case 'openai':
        return await this.openaiCompletion(messages);
      case 'anthropic':
        return await this.anthropicCompletion(messages);
      case 'google':
        return await this.googleCompletion(messages);
      default:
        throw new Error(`Unsupported provider: ${targetProvider}`);
    }
  }

  private async openaiCompletion(
    messages: AIMessage[]
  ): Promise<AIResponse> {
    if (!this.openai) {
      throw new Error('OpenAI not configured');
    }

    const aiConfig = config.getAIProvider('openai');
    if (!aiConfig) {
      throw new Error('OpenAI configuration not found');
    }

    const response = await this.openai.chat.completions.create({
      model: aiConfig.model || 'gpt-4',
      messages: messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })),
      max_tokens: aiConfig.maxTokens || 4000,
      temperature: aiConfig.temperature || 0.7,
    });

    const choice = response.choices[0];
    if (!choice?.message?.content) {
      throw new Error('Invalid response from OpenAI');
    }

    return {
      content: choice.message.content,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
      },
      model: response.model,
      provider: 'openai',
    };
  }

  private async anthropicCompletion(
    messages: AIMessage[]
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

    const response = await this.anthropic.messages.create({
      model: aiConfig.model || 'claude-3-opus-20240229',
      max_tokens: aiConfig.maxTokens || 4000,
      system: systemMessage?.content,
      messages: conversationMessages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    });

    const content = response.content[0];
    if (!content || content.type !== 'text') {
      throw new Error('Invalid response from Anthropic');
    }

    return {
      content: content.text,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens:
          response.usage.input_tokens + response.usage.output_tokens,
      },
      model: response.model,
      provider: 'anthropic',
    };
  }

  private async googleCompletion(
    _messages: AIMessage[]
  ): Promise<AIResponse> {
    // TODO: Implement Google AI integration
    throw new Error('Google AI integration not yet implemented');
  }

  public async generateImage(
    prompt: string,
    provider: AIProvider = 'openai'
  ): Promise<Buffer> {
    if (provider !== 'openai') {
      throw new Error('Image generation only supported for OpenAI');
    }

    if (!this.openai) {
      throw new Error('OpenAI not configured');
    }

    const response = await this.openai.images.generate({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    });

    if (!response.data || response.data.length === 0) {
      throw new Error('Invalid image response');
    }
    const data = response.data[0];
    if (!data?.b64_json) {
      throw new Error('Invalid image response: no b64_json data');
    }

    return Buffer.from(data.b64_json, 'base64');
  }

  public isProviderAvailable(provider: AIProvider): boolean {
    switch (provider) {
      case 'openai':
        return this.openai !== null;
      case 'anthropic':
        return this.anthropic !== null;
      case 'google':
        return false; // Not yet implemented
      case 'custom':
      case 'webai':
      default:
        return false;
    }
  }
}

// Singleton instance
export const aiService = new AIService();
