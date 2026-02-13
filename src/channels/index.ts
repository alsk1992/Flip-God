/**
 * Channel Manager for FlipAgent
 *
 * Routes outgoing messages to the correct channel adapter.
 * Currently only supports WebChat; designed for easy extension.
 */

import { WebSocketServer } from 'ws';
import { createWebChatChannel, WebChatChannel } from './webchat/index';
import { createLogger } from '../utils/logger';
import type { Config, IncomingMessage, OutgoingMessage } from '../types';

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
  const logger = createLogger('channels');

  if (config.webchat?.enabled) {
    logger.info('Initializing WebChat channel');
    webchat = createWebChatChannel(config.webchat, callbacks);
  }

  return {
    async start() {
      logger.info('Channel manager started');
    },

    async stop() {
      if (webchat) webchat.stop();
      logger.info('Channel manager stopped');
    },

    async send(message: OutgoingMessage): Promise<string | null> {
      if (message.platform === 'webchat' && webchat) {
        return webchat.sendMessage(message);
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
