/**
 * Message Queue - Message batching and debouncing for FlipAgent
 *
 * Features:
 * - Immediate mode: no queuing, process immediately
 * - Debounce mode: wait for typing to stop before processing
 * - Collect mode: batch rapid messages within a time window
 * - Per-chat queues (keyed by platform:chatId)
 * - Configurable debounce timing, batch size, and max wait
 * - Auto-cleanup of stale queues (no activity for 5 minutes)
 */

import { createLogger } from '../utils/logger';
import type { IncomingMessage } from '../types';

const logger = createLogger('queue');

// =============================================================================
// TYPES
// =============================================================================

export type QueueMode = 'immediate' | 'debounce' | 'collect';

export interface QueueConfig {
  /** Queue mode */
  mode: QueueMode;
  /** Debounce delay in milliseconds (how long to wait after last message) */
  debounceMs: number;
  /** Maximum messages to collect before forcing processing */
  maxBatchSize: number;
  /** Maximum time in ms to wait before processing a batch (collect mode) */
  maxWaitMs: number;
}

export interface QueuedItem {
  message: IncomingMessage;
  queuedAt: number;
}

interface ChatQueue {
  items: QueuedItem[];
  /** Debounce timer (resets on each new message in debounce mode) */
  debounceTimer: NodeJS.Timeout | null;
  /** Max-wait timer (fires after maxWaitMs in collect mode) */
  maxWaitTimer: NodeJS.Timeout | null;
  /** Last activity timestamp for stale detection */
  lastActivity: number;
}

export type QueueHandler = (messages: IncomingMessage[]) => Promise<void> | void;

// =============================================================================
// DEFAULTS
// =============================================================================

const DEFAULT_CONFIG: QueueConfig = {
  mode: 'immediate',
  debounceMs: 1500,
  maxBatchSize: 5,
  maxWaitMs: 10_000,
};

const STALE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000;   // check for stale queues every minute

// =============================================================================
// HELPERS
// =============================================================================

function getChatKey(message: IncomingMessage): string {
  return `${message.platform}:${message.chatId}`;
}

/**
 * Combine multiple messages into one by concatenating their text.
 * Uses the last message as the base (for metadata like userId, timestamp, etc.).
 */
export function combineMessages(messages: IncomingMessage[]): IncomingMessage {
  if (messages.length === 0) {
    throw new Error('Cannot combine empty message array');
  }
  if (messages.length === 1) {
    return messages[0];
  }

  const base = messages[messages.length - 1];
  const combinedText = messages.map((m) => m.text).join('\n\n');

  return {
    ...base,
    text: combinedText,
  };
}

// =============================================================================
// MESSAGE QUEUE
// =============================================================================

export class MessageQueue {
  private queues = new Map<string, ChatQueue>();
  private handler: QueueHandler | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly config: QueueConfig;

  constructor(config?: Partial<QueueConfig>) {
    this.config = {
      mode: config?.mode ?? DEFAULT_CONFIG.mode,
      debounceMs: config?.debounceMs ?? DEFAULT_CONFIG.debounceMs,
      maxBatchSize: config?.maxBatchSize ?? DEFAULT_CONFIG.maxBatchSize,
      maxWaitMs: config?.maxWaitMs ?? DEFAULT_CONFIG.maxWaitMs,
    };

    // Start stale queue cleanup
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleQueues();
    }, CLEANUP_INTERVAL_MS);

    logger.info({ config: this.config }, 'Message queue initialized');
  }

  /**
   * Set the handler function that processes batched messages.
   * The handler receives an array of messages (concatenated from the queue).
   */
  setHandler(fn: QueueHandler): void {
    this.handler = fn;
  }

  /**
   * Enqueue a message. Behavior depends on the queue mode:
   *
   * - immediate: calls handler right away with [message], returns true
   * - debounce: resets timer on each message; fires after debounceMs of silence
   * - collect: starts timer on first message; collects until timer or batch cap
   *
   * Returns true if the message was processed immediately (immediate mode).
   * Returns false if the message was queued for batch processing.
   */
  enqueue(chatKey: string, message: IncomingMessage): boolean {
    // Immediate mode - process right away
    if (this.config.mode === 'immediate') {
      this.processMessages(chatKey, [message]);
      return true;
    }

    // Get or create queue for this chat
    let queue = this.queues.get(chatKey);
    if (!queue) {
      queue = {
        items: [],
        debounceTimer: null,
        maxWaitTimer: null,
        lastActivity: Date.now(),
      };
      this.queues.set(chatKey, queue);
    }

    queue.items.push({ message, queuedAt: Date.now() });
    queue.lastActivity = Date.now();

    // Check batch size cap
    if (queue.items.length >= this.config.maxBatchSize) {
      logger.debug({ chatKey, batchSize: queue.items.length }, 'Batch cap reached, flushing');
      this.flush(chatKey);
      return false;
    }

    if (this.config.mode === 'debounce') {
      // Reset debounce timer on every message
      if (queue.debounceTimer) {
        clearTimeout(queue.debounceTimer);
      }
      queue.debounceTimer = setTimeout(() => {
        this.flush(chatKey);
      }, this.config.debounceMs);
    } else if (this.config.mode === 'collect') {
      // Start timers on first message only
      if (queue.items.length === 1) {
        // Debounce timer (fires after debounceMs of no new messages)
        queue.debounceTimer = setTimeout(() => {
          this.flush(chatKey);
        }, this.config.debounceMs);

        // Max-wait timer (absolute cap on how long to collect)
        queue.maxWaitTimer = setTimeout(() => {
          logger.debug({ chatKey }, 'Max wait reached, flushing');
          this.flush(chatKey);
        }, this.config.maxWaitMs);
      } else {
        // Reset debounce on subsequent messages, but keep maxWait
        if (queue.debounceTimer) {
          clearTimeout(queue.debounceTimer);
        }
        queue.debounceTimer = setTimeout(() => {
          this.flush(chatKey);
        }, this.config.debounceMs);
      }
    }

    return false;
  }

  /**
   * Convenience: enqueue using message fields to derive chatKey
   */
  enqueueMessage(message: IncomingMessage): boolean {
    return this.enqueue(getChatKey(message), message);
  }

  /**
   * Flush a specific chat queue: clears timers, extracts messages, calls handler
   */
  flush(chatKey: string): IncomingMessage[] {
    const queue = this.queues.get(chatKey);
    if (!queue || queue.items.length === 0) return [];

    // Clear timers
    if (queue.debounceTimer) {
      clearTimeout(queue.debounceTimer);
      queue.debounceTimer = null;
    }
    if (queue.maxWaitTimer) {
      clearTimeout(queue.maxWaitTimer);
      queue.maxWaitTimer = null;
    }

    // Extract messages
    const messages = queue.items.map((item) => item.message);
    queue.items = [];

    // Clean up empty queue
    this.queues.delete(chatKey);

    // Process
    this.processMessages(chatKey, messages);

    return messages;
  }

  /**
   * Get current queue config
   */
  getConfig(): Readonly<QueueConfig> {
    return this.config;
  }

  /**
   * Get the number of active queues
   */
  activeQueueCount(): number {
    return this.queues.size;
  }

  /**
   * Get pending message count for a specific chat
   */
  pendingCount(chatKey: string): number {
    return this.queues.get(chatKey)?.items.length ?? 0;
  }

  /**
   * Stop the queue system (clears all timers and queues)
   */
  dispose(): void {
    // Clear all queue timers
    const allQueues = Array.from(this.queues.values());
    for (const queue of allQueues) {
      if (queue.debounceTimer) clearTimeout(queue.debounceTimer);
      if (queue.maxWaitTimer) clearTimeout(queue.maxWaitTimer);
    }
    this.queues.clear();

    // Clear cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    logger.info('Message queue disposed');
  }

  // ===========================================================================
  // PRIVATE
  // ===========================================================================

  private processMessages(chatKey: string, messages: IncomingMessage[]): void {
    if (messages.length === 0) return;

    logger.debug({ chatKey, messageCount: messages.length }, 'Processing queued messages');

    if (this.handler) {
      const result = this.handler(messages);
      // If the handler returns a promise, catch errors
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch((error) => {
          logger.error({ chatKey, error }, 'Error in queue handler');
        });
      }
    } else {
      logger.warn({ chatKey }, 'No handler set, dropping messages');
    }
  }

  /**
   * Clean up queues that have had no activity for STALE_TIMEOUT_MS
   */
  private cleanupStaleQueues(): void {
    const now = Date.now();
    const staleKeys: string[] = [];

    const entries = Array.from(this.queues.entries());
    for (const [key, queue] of entries) {
      if (now - queue.lastActivity > STALE_TIMEOUT_MS) {
        staleKeys.push(key);
        // Clear timers before removing
        if (queue.debounceTimer) clearTimeout(queue.debounceTimer);
        if (queue.maxWaitTimer) clearTimeout(queue.maxWaitTimer);
      }
    }

    for (const key of staleKeys) {
      this.queues.delete(key);
    }

    if (staleKeys.length > 0) {
      logger.debug({ count: staleKeys.length }, 'Cleaned up stale queues');
    }
  }
}
