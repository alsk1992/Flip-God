/**
 * Base Channel Adapter
 *
 * Ported from Clodds base-adapter.ts. Provides:
 * - ChannelAdapter interface for all channel implementations
 * - BaseAdapter abstract class with common infrastructure:
 *   - Offline message queue (max 200 messages, 15 min max age)
 *   - Auto-retry sending (3 attempts)
 *   - Message formatting (markdown to platform-specific)
 * - IncomingMessage type for normalized incoming messages
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('base-adapter');

// =============================================================================
// TYPES
// =============================================================================

export interface IncomingMessage {
  id: string;
  platform: string;
  chatId: string;
  chatType: 'dm' | 'group';
  userId: string;
  username?: string;
  displayName?: string;
  text: string;
  replyToMessageId?: string;
  timestamp: Date;
}

export interface SendMessageOptions {
  replyTo?: string;
  edit?: boolean;
  messageId?: string;
}

export interface ChannelAdapter {
  readonly platform: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(
    chatId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<string | null>;
  editMessage?(chatId: string, messageId: string, text: string): Promise<boolean>;
  deleteMessage?(chatId: string, messageId: string): Promise<boolean>;
  onMessage?: (handler: (msg: IncomingMessage) => Promise<void>) => void;
}

// =============================================================================
// OFFLINE QUEUE
// =============================================================================

interface QueuedMessage {
  chatId: string;
  text: string;
  options?: SendMessageOptions;
  queuedAt: number;
}

const MAX_QUEUE_SIZE = 200;
const MAX_QUEUE_AGE_MS = 15 * 60 * 1000; // 15 minutes
const SEND_RETRY_ATTEMPTS = 3;
const SEND_RETRY_BASE_DELAY_MS = 500;

// =============================================================================
// MARKDOWN FORMATTING
// =============================================================================

/**
 * Convert generic markdown to platform-specific formatting.
 * Base implementation passes through. Override in subclasses for Telegram/Discord.
 */
export function formatMarkdown(text: string, _platform: string): string {
  return text;
}

/**
 * Escape markdown special characters for platforms that need it.
 */
export function escapeMarkdown(text: string, chars: string[] = ['_', '*', '`', '[', ']']): string {
  let escaped = text;
  for (const char of chars) {
    escaped = escaped.replace(new RegExp(`\\${char}`, 'g'), `\\${char}`);
  }
  return escaped;
}

/**
 * Chunk a long message into parts that fit within a platform's limit.
 * Tries to split on newlines first, then on spaces, then hard-cuts.
 */
export function chunkMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try to split on double newline first (paragraph break)
    let splitAt = remaining.lastIndexOf('\n\n', maxLength);
    if (splitAt < maxLength * 0.3) {
      // Try single newline
      splitAt = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitAt < maxLength * 0.3) {
      // Try space
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt < maxLength * 0.3) {
      // Hard cut
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

// =============================================================================
// BASE ADAPTER
// =============================================================================

export abstract class BaseAdapter implements ChannelAdapter {
  readonly platform: string;
  protected _started: boolean = false;
  protected _messageHandler: ((msg: IncomingMessage) => Promise<void>) | null = null;

  // Offline queue for messages sent while disconnected
  private _queue: QueuedMessage[] = [];
  private _drainTimer: ReturnType<typeof setInterval> | null = null;

  constructor(platform: string) {
    this.platform = platform;
  }

  // ---- Abstract methods for subclasses ----

  /** Platform-specific startup (connect, authenticate, etc.) */
  protected abstract doStart(): Promise<void>;

  /** Platform-specific shutdown */
  protected abstract doStop(): Promise<void>;

  /** Platform-specific message send. Return message ID or null. */
  protected abstract doSend(
    chatId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<string | null>;

  /** Check if the adapter is currently connected/ready to send */
  protected abstract isReady(): boolean;

  // ---- Optional overrides ----

  protected doEdit?(chatId: string, messageId: string, text: string): Promise<boolean>;
  protected doDelete?(chatId: string, messageId: string): Promise<boolean>;

  // ---- Public API ----

  async start(): Promise<void> {
    if (this._started) {
      logger.warn({ platform: this.platform }, 'Adapter already started');
      return;
    }

    await this.doStart();
    this._started = true;

    // Start queue drain timer
    this._drainTimer = setInterval(() => this.drainQueue(), 5000);

    logger.info({ platform: this.platform }, 'Adapter started');
  }

  async stop(): Promise<void> {
    if (!this._started) return;

    if (this._drainTimer) {
      clearInterval(this._drainTimer);
      this._drainTimer = null;
    }

    await this.doStop();
    this._started = false;
    this._queue = [];

    logger.info({ platform: this.platform }, 'Adapter stopped');
  }

  async sendMessage(
    chatId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<string | null> {
    if (!this.isReady()) {
      // Queue for later delivery
      this.enqueue(chatId, text, options);
      return null;
    }

    return this.sendWithRetry(chatId, text, options);
  }

  async editMessage(chatId: string, messageId: string, text: string): Promise<boolean> {
    if (!this.doEdit) {
      logger.warn({ platform: this.platform }, 'Edit not supported');
      return false;
    }
    try {
      return await this.doEdit(chatId, messageId, text);
    } catch (err) {
      logger.error({ err, platform: this.platform, chatId, messageId }, 'Edit failed');
      return false;
    }
  }

  async deleteMessage(chatId: string, messageId: string): Promise<boolean> {
    if (!this.doDelete) {
      logger.warn({ platform: this.platform }, 'Delete not supported');
      return false;
    }
    try {
      return await this.doDelete(chatId, messageId);
    } catch (err) {
      logger.error({ err, platform: this.platform, chatId, messageId }, 'Delete failed');
      return false;
    }
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this._messageHandler = handler;
  }

  // ---- Protected helpers for subclasses ----

  /**
   * Called by subclasses when an incoming message is received.
   * Normalizes and dispatches to the registered handler.
   */
  protected handleIncoming(msg: IncomingMessage): void {
    if (!this._messageHandler) {
      logger.warn({ platform: this.platform }, 'No message handler registered, dropping message');
      return;
    }

    this._messageHandler(msg).catch((err) => {
      logger.error({ err, platform: this.platform }, 'Error handling incoming message');
    });
  }

  // ---- Private helpers ----

  private async sendWithRetry(
    chatId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<string | null> {
    let lastErr: unknown;

    for (let attempt = 1; attempt <= SEND_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.doSend(chatId, text, options);
      } catch (err) {
        lastErr = err;
        logger.warn(
          { err, platform: this.platform, chatId, attempt },
          'Send failed, retrying',
        );

        if (attempt < SEND_RETRY_ATTEMPTS) {
          const delay = SEND_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    logger.error(
      { err: lastErr, platform: this.platform, chatId },
      'Send failed after all retries',
    );

    // Queue for later as last resort
    this.enqueue(chatId, text, options);
    return null;
  }

  private enqueue(chatId: string, text: string, options?: SendMessageOptions): void {
    // Evict old messages
    const now = Date.now();
    this._queue = this._queue.filter((m) => now - m.queuedAt < MAX_QUEUE_AGE_MS);

    // Enforce max queue size
    if (this._queue.length >= MAX_QUEUE_SIZE) {
      const dropped = this._queue.shift();
      if (dropped) {
        logger.warn(
          { platform: this.platform, chatId: dropped.chatId },
          'Offline queue full, dropping oldest message',
        );
      }
    }

    this._queue.push({ chatId, text, options, queuedAt: now });
    logger.debug(
      { platform: this.platform, chatId, queueSize: this._queue.length },
      'Message queued for later delivery',
    );
  }

  private async drainQueue(): Promise<void> {
    if (!this.isReady() || this._queue.length === 0) return;

    const now = Date.now();
    const toSend: QueuedMessage[] = [];
    const remaining: QueuedMessage[] = [];

    for (const msg of this._queue) {
      if (now - msg.queuedAt >= MAX_QUEUE_AGE_MS) {
        // Expired, drop it
        logger.debug(
          { platform: this.platform, chatId: msg.chatId },
          'Dropping expired queued message',
        );
        continue;
      }
      toSend.push(msg);
    }

    this._queue = [];

    for (const msg of toSend) {
      try {
        await this.doSend(msg.chatId, msg.text, msg.options);
      } catch (err) {
        logger.warn(
          { err, platform: this.platform, chatId: msg.chatId },
          'Failed to drain queued message, re-queuing',
        );
        remaining.push(msg);
      }
    }

    // Re-queue failed messages
    this._queue.push(...remaining);
  }
}
