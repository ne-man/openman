/**
 * AI Service Integrations
 * Supports API-based and Web-based AI services with auto-fallback
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import type {
  AIMessage,
  AIResponse,
  AIProvider,
  WebAIConfig,
} from '@/types';
import { config } from '@/core/config';
import { auditLogger } from '@/core/audit';
import { webAIService } from '@/ai/webai';

/**
 * Default Web AI configurations for fallback
 */
const DEFAULT_WEB_AIS: WebAIConfig[] = [
  {
    name: 'doubao',
    url: 'https://www.doubao.com/chat/',
    inputSelector: 'textarea',
    submitSelector: 'button[data-testid="send-button"], button[type="submit"]',
    responseSelector: '[class*="message"][class*="assistant"], [class*="response"]',
    responseTimeout: 60000,
  },
  {
    name: 'chatgpt',
    url: 'https://chat.openai.com/',
    inputSelector: 'textarea[placeholder*="Message"]',
    submitSelector: 'button[data-testid="send-button"]',
    responseSelector: '[data-message-author-role="assistant"]',
    responseTimeout: 60000,
  },
  {
    name: 'claude',
    url: 'https://claude.ai/chat/',
    inputSelector: 'div[contenteditable="true"]',
    submitSelector: 'button[aria-label="Send Message"]',
    responseSelector: '.prose',
    responseTimeout: 60000,
  },
];

export class AIService {
  private openai: OpenAI | null = null;
  private anthropic: Anthropic | null = null;
  private webAIInitialized = false;

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

  /**
   * Initialize default Web AI configs for fallback
   */
  private initializeWebAI(): void {
    if (this.webAIInitialized) return;

    // Add default web AI configs
    for (const webAIConfig of DEFAULT_WEB_AIS) {
      webAIService.addConfig(webAIConfig);
    }

    // Add user-configured web AIs
    const userWebAIs = config.listWebAIs();
    for (const webAIConfig of userWebAIs) {
      webAIService.addConfig(webAIConfig);
    }

    this.webAIInitialized = true;
  }

  /**
   * Check if any API provider is available
   */
  public hasAPIProvider(): boolean {
    return this.openai !== null || this.anthropic !== null;
  }

  /**
   * Get the best available provider
   */
  public getBestProvider(): AIProvider {
    if (this.openai) return 'openai';
    if (this.anthropic) return 'anthropic';
    return 'webai'; // Fallback to web AI
  }

  public async completion(
    messages: AIMessage[],
    provider?: AIProvider
  ): Promise<AIResponse> {
    // Auto-select provider if not specified
    let targetProvider = provider || config.get('ai').defaultProvider;

    // If specified provider is not available, try to fallback
    if (!this.isProviderAvailable(targetProvider)) {
      if (this.hasAPIProvider()) {
        targetProvider = this.getBestProvider();
        console.log(`Provider ${provider} not available, falling back to ${targetProvider}`);
      } else {
        // No API configured, use Web AI
        targetProvider = 'webai';
        console.log('No API configured, using Web AI');
      }
    }

    await auditLogger.log({
      timestamp: new Date(),
      action: 'ai.completion',
      details: {
        provider: targetProvider,
        messageCount: messages.length,
        autoFallback: provider !== targetProvider,
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
      case 'webai':
        return await this.webAICompletion(messages);
      default:
        throw new Error(`Unsupported provider: ${targetProvider}`);
    }
  }

  /**
   * Web AI completion using browser automation
   */
  private async webAICompletion(messages: AIMessage[]): Promise<AIResponse> {
    this.initializeWebAI();

    // Get available web AI configs
    const webAIs = webAIService.listConfigs();
    if (webAIs.length === 0) {
      throw new Error('No Web AI configured. Use "openman webai add <name> <url>" to add one.');
    }

    // Use the first available Web AI (user can configure priority)
    const webAIConfig = webAIs[0];

    console.log(`Using Web AI: ${webAIConfig.name} (${webAIConfig.url})`);

    return await webAIService.chat(webAIConfig.name, messages);
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
      case 'webai':
        return true; // Web AI is always available (uses browser)
      case 'custom':
      default:
        return false;
    }
  }

  /**
   * Close Web AI browser when done
   */
  public async closeWebAI(): Promise<void> {
    await webAIService.close();
  }
}

// Singleton instance
export const aiService = new AIService();
