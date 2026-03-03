/**
 * WebAI Channel Exports
 * 优先使用 yuanbao 通道
 */

export * from './types';
export * from './yuanbao';
export * from './doubao';

import type { ChannelHandler, ChannelParams } from './types';
import { createYuanbaoChannel, YuanbaoChannel, YUANBAO_CONFIG } from './yuanbao';
import { createDoubaoChannel, DoubaoChannel, DOUBAO_CONFIG } from './doubao';

/**
 * Channel factory map
 */
export const channelFactories: Record<string, (params: ChannelParams) => ChannelHandler> = {
  yuanbao: createYuanbaoChannel,
  doubao: createDoubaoChannel,
};

/**
 * Channel default configs
 */
export const channelConfigs: Record<string, Partial<import('@/types').WebAIConfig>> = {
  yuanbao: YUANBAO_CONFIG,
  doubao: DOUBAO_CONFIG,
};

/**
 * Default channel order (yuanbao first)
 */
export const DEFAULT_CHANNEL_ORDER = ['yuanbao', 'doubao'] as const;

/**
 * Create a channel by name
 */
export function createChannel(name: string, params: ChannelParams): ChannelHandler | null {
  const factory = channelFactories[name];
  if (!factory) return null;
  return factory(params);
}

/**
 * Get all available channel names
 */
export function getAvailableChannels(): string[] {
  return [...DEFAULT_CHANNEL_ORDER];
}
