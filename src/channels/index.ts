/**
 * Channel Manager for FlipAgent
 *
 * Routes outgoing messages to the correct channel adapter.
 * Supports: WebChat, Telegram, Discord (designed for easy extension).
 */

import { WebSocketServer } from 'ws';
import { createWebChatChannel, WebChatChannel } from './webchat/index';
import { createTelegramAdapter } from './telegram';
import { createDiscordAdapter } from './discord';
import { createLogger } from '../utils/logger';
import type { Config, IncomingMessage, OutgoingMessage } from '../types';
import type { ChannelAdapter as BaseChannelAdapter } from './base-adapter';

// =============================================================================
// Types
// =============================================================================

export interface DraftStream {
  start(initialText?: string): Promise<string | null>;
  update(newText: string): Promise<void>;
  finish(finalText?: string): Promise<string | null>;
  cancel(): Promise<void>;
}

export interface ChannelAdapter {
  platform: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(message: OutgoingMessage): Promise<string | null>;
  isConnected?: (message?: OutgoingMessage) => boolean;
}

export interface ChannelManager {
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: OutgoingMessage): Promise<string | null>;
  attachWebSocket(wss: WebSocketServer): void;
  getChatConnectionHandler(): ((ws: import('ws').WebSocket, req: import('http').IncomingMessage) => void) | null;
}

export interface ChannelCallbacks {
  onMessage: (message: IncomingMessage) => Promise<void>;
}

// =============================================================================
// Factory
// =============================================================================

export async function createChannelManager(
  config: Config['channels'],
  callbacks: ChannelCallbacks,
): Promise<ChannelManager> {
  let webchat: WebChatChannel | null = null;
  const adapters: BaseChannelAdapter[] = [];
  const logger = createLogger('channels');

  // WebChat (WebSocket-based)
  if (config.webchat?.enabled) {
    logger.info('Initializing WebChat channel');
    webchat = createWebChatChannel(config.webchat, callbacks);
  }

  // Telegram (long polling, no dependencies)
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      logger.info('Initializing Telegram channel');
      const telegram = createTelegramAdapter({
        token: process.env.TELEGRAM_BOT_TOKEN,
        allowedChatIds: process.env.TELEGRAM_ALLOWED_CHATS?.split(',').filter(Boolean),
      });
      telegram.onMessage?.(callbacks.onMessage);
      adapters.push(telegram);
    } catch (err) {
      logger.error({ err }, 'Failed to initialize Telegram channel');
    }
  }

  // Discord (Gateway WebSocket, no dependencies)
  if (process.env.DISCORD_BOT_TOKEN) {
    try {
      logger.info('Initializing Discord channel');
      const discord = createDiscordAdapter({
        token: process.env.DISCORD_BOT_TOKEN,
        allowedGuildIds: process.env.DISCORD_ALLOWED_GUILDS?.split(',').filter(Boolean),
      });
      discord.onMessage?.(callbacks.onMessage);
      adapters.push(discord);
    } catch (err) {
      logger.error({ err }, 'Failed to initialize Discord channel');
    }
  }

  return {
    async start() {
      // Start all adapters in parallel, isolated so one failure doesn't block others
      for (const adapter of adapters) {
        try {
          await adapter.start();
          logger.info({ platform: adapter.platform }, 'Channel started');
        } catch (err) {
          logger.error({ platform: adapter.platform, err }, 'Channel start failed');
        }
      }
      logger.info({ channels: ['webchat', ...adapters.map(a => a.platform)].filter(Boolean).length }, 'Channel manager started');
    },

    async stop() {
      if (webchat) webchat.stop();
      for (const adapter of adapters) {
        try {
          await adapter.stop();
        } catch (err) {
          logger.error({ platform: adapter.platform, err }, 'Channel stop error');
        }
      }
      logger.info('Channel manager stopped');
    },

    async send(message: OutgoingMessage): Promise<string | null> {
      if (message.platform === 'webchat' && webchat) {
        return webchat.sendMessage(message);
      }

      // Try external channel adapters
      const adapter = adapters.find(a => a.platform === message.platform);
      if (adapter) {
        return adapter.sendMessage(message.chatId, message.text);
      }

      logger.warn({ platform: message.platform }, 'No adapter for platform');
      return null;
    },

    attachWebSocket(wss: WebSocketServer): void {
      if (webchat) webchat.start(wss);
    },

    getChatConnectionHandler(): ((ws: import('ws').WebSocket, req: import('http').IncomingMessage) => void) | null {
      return webchat?.getConnectionHandler() ?? null;
    },
  };
}
