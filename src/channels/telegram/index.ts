/**
 * Telegram Channel Adapter
 *
 * Uses raw HTTPS calls to the Telegram Bot API (no npm dependencies).
 * Implements the ChannelAdapter interface from base-adapter.ts.
 *
 * Features:
 * - Long polling for incoming messages
 * - Markdown formatting for outgoing messages
 * - Message chunking for >4096 char messages
 * - /start, /new, /help command handling
 * - Edit and delete message support
 * - Allowed chat ID filtering
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../../utils/logger';
import {
  BaseAdapter,
  chunkMessage,
  type IncomingMessage,
  type SendMessageOptions,
} from '../base-adapter';

const logger = createLogger('telegram');

// =============================================================================
// TYPES
// =============================================================================

export interface TelegramConfig {
  token: string;
  allowedChatIds?: string[];
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: {
      id: number;
      is_bot: boolean;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: 'private' | 'group' | 'supergroup' | 'channel';
      title?: string;
    };
    date: number;
    text?: string;
    reply_to_message?: {
      message_id: number;
    };
    entities?: Array<{
      offset: number;
      length: number;
      type: string;
    }>;
  };
}

interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const MAX_MESSAGE_LENGTH = 4096;
const POLL_TIMEOUT_SEC = 30;
const POLL_ERROR_DELAY_MS = 5000;
const MAX_POLL_ERRORS = 10;

// =============================================================================
// TELEGRAM ADAPTER
// =============================================================================

class TelegramAdapter extends BaseAdapter {
  private token: string;
  private allowedChatIds: Set<string> | null;
  private lastUpdateId: number = 0;
  private polling: boolean = false;
  private pollAbort: AbortController | null = null;
  private consecutiveErrors: number = 0;
  private commandHandlers: Map<string, (chatId: string, args: string, msg: IncomingMessage) => Promise<void>>;

  constructor(config: TelegramConfig) {
    super('telegram');
    this.token = config.token;
    this.allowedChatIds = config.allowedChatIds
      ? new Set(config.allowedChatIds)
      : null;

    // Built-in command handlers
    this.commandHandlers = new Map();
    this.commandHandlers.set('/start', async (chatId) => {
      await this.doSend(chatId,
        'Welcome to FlipAgent! I help you find e-commerce arbitrage opportunities.\n\n' +
        'Commands:\n' +
        '/new - Start a new conversation\n' +
        '/help - Show available commands\n\n' +
        'Just type a message to get started!',
      );
    });
    this.commandHandlers.set('/help', async (chatId) => {
      await this.doSend(chatId,
        'FlipAgent Commands:\n\n' +
        '/new - Clear conversation and start fresh\n' +
        '/help - Show this help message\n\n' +
        'You can ask me to:\n' +
        '- Scan products across platforms\n' +
        '- Compare prices and find arbitrage\n' +
        '- Create and manage listings\n' +
        '- Track orders and fulfillment\n' +
        '- Calculate profits and fees',
      );
    });
  }

  // ---- BaseAdapter abstract implementations ----

  protected async doStart(): Promise<void> {
    // Verify the token works by calling getMe
    const me = await this.apiCall<{ id: number; first_name: string; username: string }>('getMe');
    if (!me) {
      throw new Error('Failed to verify Telegram bot token');
    }
    logger.info({ botId: me.id, username: me.username }, 'Telegram bot authenticated');

    // Start long polling
    this.polling = true;
    this.pollLoop();
  }

  protected async doStop(): Promise<void> {
    this.polling = false;
    if (this.pollAbort) {
      this.pollAbort.abort();
      this.pollAbort = null;
    }
  }

  protected async doSend(
    chatId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<string | null> {
    // Handle edit mode
    if (options?.edit && options.messageId) {
      const success = await this.doEdit(chatId, options.messageId, text);
      return success ? options.messageId : null;
    }

    // Chunk long messages
    const chunks = chunkMessage(text, MAX_MESSAGE_LENGTH);
    let lastMessageId: string | null = null;

    for (const chunk of chunks) {
      const body: Record<string, unknown> = {
        chat_id: chatId,
        text: chunk,
        parse_mode: 'Markdown',
      };

      if (options?.replyTo) {
        body.reply_to_message_id = parseInt(options.replyTo, 10);
      }

      const result = await this.apiCall<{ message_id: number }>('sendMessage', body);
      if (result) {
        lastMessageId = String(result.message_id);
      }
    }

    return lastMessageId;
  }

  protected isReady(): boolean {
    return this._started && this.polling;
  }

  // ---- Edit and delete ----

  protected async doEdit(chatId: string, messageId: string, text: string): Promise<boolean> {
    const result = await this.apiCall('editMessageText', {
      chat_id: chatId,
      message_id: parseInt(messageId, 10),
      text: text.slice(0, MAX_MESSAGE_LENGTH),
      parse_mode: 'Markdown',
    });
    return result !== null;
  }

  protected async doDelete(chatId: string, messageId: string): Promise<boolean> {
    const result = await this.apiCall('deleteMessage', {
      chat_id: chatId,
      message_id: parseInt(messageId, 10),
    });
    return result !== null;
  }

  // ---- Long polling ----

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        this.pollAbort = new AbortController();

        const updates = await this.apiCall<TelegramUpdate[]>('getUpdates', {
          offset: this.lastUpdateId + 1,
          timeout: POLL_TIMEOUT_SEC,
          allowed_updates: ['message'],
        }, this.pollAbort.signal);

        if (!updates || !Array.isArray(updates)) {
          continue;
        }

        this.consecutiveErrors = 0;

        for (const update of updates) {
          this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
          await this.processUpdate(update);
        }
      } catch (err: unknown) {
        if (!this.polling) break; // Expected on stop

        const isAbortError = err instanceof Error && err.name === 'AbortError';
        if (isAbortError) break;

        this.consecutiveErrors++;
        logger.error(
          { err, consecutiveErrors: this.consecutiveErrors },
          'Telegram poll error',
        );

        if (this.consecutiveErrors >= MAX_POLL_ERRORS) {
          logger.error('Too many consecutive poll errors, stopping polling');
          this.polling = false;
          break;
        }

        // Backoff on errors
        await new Promise((resolve) => setTimeout(resolve, POLL_ERROR_DELAY_MS));
      }
    }
  }

  private async processUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg || !msg.text || !msg.from) return;

    const chatId = String(msg.chat.id);

    // Filter by allowed chat IDs
    if (this.allowedChatIds && !this.allowedChatIds.has(chatId)) {
      logger.debug({ chatId }, 'Message from non-allowed chat, ignoring');
      return;
    }

    const userId = String(msg.from.id);
    const text = msg.text.trim();

    // Check for bot commands
    if (text.startsWith('/')) {
      const spaceIdx = text.indexOf(' ');
      const command = spaceIdx > 0 ? text.slice(0, spaceIdx).toLowerCase() : text.toLowerCase();
      const args = spaceIdx > 0 ? text.slice(spaceIdx + 1).trim() : '';

      // Strip @botname from commands (e.g., /help@mybotname)
      const cleanCommand = command.split('@')[0];

      const handler = this.commandHandlers.get(cleanCommand);
      if (handler) {
        const incoming = this.toIncomingMessage(msg, chatId, userId, text);
        await handler(chatId, args, incoming);

        // For /new, also dispatch to the message handler so the session can be reset
        if (cleanCommand === '/new') {
          this.handleIncoming(incoming);
        }
        return;
      }
    }

    // Normal message -- dispatch to handler
    const incoming = this.toIncomingMessage(msg, chatId, userId, text);
    this.handleIncoming(incoming);
  }

  private toIncomingMessage(
    msg: NonNullable<TelegramUpdate['message']>,
    chatId: string,
    userId: string,
    text: string,
  ): IncomingMessage {
    return {
      id: String(msg.message_id),
      platform: 'telegram',
      chatId,
      chatType: msg.chat.type === 'private' ? 'dm' : 'group',
      userId,
      username: msg.from?.username,
      displayName: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' '),
      text,
      replyToMessageId: msg.reply_to_message
        ? String(msg.reply_to_message.message_id)
        : undefined,
      timestamp: new Date(msg.date * 1000),
    };
  }

  // ---- API helper ----

  private async apiCall<T>(
    method: string,
    body?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T | null> {
    const url = `${TELEGRAM_API_BASE}/bot${this.token}/${method}`;

    const options: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    };

    try {
      const res = await fetch(url, options);
      const data = (await res.json()) as TelegramApiResponse<T>;

      if (!data.ok) {
        logger.error(
          { method, errorCode: data.error_code, description: data.description },
          'Telegram API error',
        );
        return null;
      }

      return data.result ?? null;
    } catch (err: unknown) {
      // Re-throw AbortError for poll loop handling
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      logger.error({ err, method }, 'Telegram API request failed');
      return null;
    }
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a Telegram channel adapter.
 *
 * @param config - Token and optional allowed chat IDs
 * @returns ChannelAdapter implementation for Telegram
 */
export function createTelegramAdapter(config: TelegramConfig): TelegramAdapter {
  return new TelegramAdapter(config);
}
