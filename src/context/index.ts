/**
 * Context Management - Token-aware context window management
 *
 * Ported from Clodds context system. Provides:
 * - Token estimation (simple char-based, no external tokenizer)
 * - Context compaction when approaching limits
 * - System prompt composition with token tracking
 * - Actual API usage tracking from response.usage.input_tokens
 * - Usage statistics for monitoring
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('context');

// =============================================================================
// TYPES
// =============================================================================

export interface ContextConfig {
  /** Maximum tokens for context window (default: 128000 for Claude) */
  maxTokens?: number;
  /** Reserve tokens for response (default: 4096) */
  reservedForResponse?: number;
  /** Warning threshold percentage (default: 0.8) */
  warningThreshold?: number;
  /** Auto-compact threshold percentage (default: 0.9) */
  compactThreshold?: number;
}

export interface ContextMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: Date;
  tokens?: number;
}

export interface UsageStats {
  estimatedTokens: number;
  actualInputTokens: number;
  compactionCount: number;
  messagesDropped: number;
}

export interface CompactionResult {
  success: boolean;
  messagesBefore: number;
  messagesAfter: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  summary: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_MAX_TOKENS = 128000;
const DEFAULT_RESERVED_FOR_RESPONSE = 4096;
const DEFAULT_WARNING_THRESHOLD = 0.8;
const DEFAULT_COMPACT_THRESHOLD = 0.9;

// Simple estimate: ~3.5 chars per token for English text.
// This is intentionally conservative (slightly over-estimates token count)
// so we compact before actually hitting the limit.
const CHARS_PER_TOKEN = 3.5;

const MAX_SUMMARY_CHARS = 3000;

// =============================================================================
// TOKEN ESTIMATION
// =============================================================================

/**
 * Estimate token count for text using simple char-based heuristic.
 * No external tokenizer needed -- this is intentionally approximate.
 * Over-estimates slightly to be safe (better to compact early than hit limit).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate tokens for a message (content + role overhead).
 */
function estimateMessageTokens(message: ContextMessage): number {
  if (message.tokens) return message.tokens;
  // Role/formatting adds ~4 tokens overhead
  return estimateTokens(message.content) + 4;
}

/**
 * Estimate total tokens across an array of messages.
 */
function estimateTotalTokens(messages: ContextMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

// =============================================================================
// CONTEXT MANAGER
// =============================================================================

export class ContextManager {
  private config: Required<ContextConfig>;
  private _lastInputTokens: number = 0;
  private _compactionCount: number = 0;
  private _messagesDropped: number = 0;

  constructor(config: ContextConfig = {}) {
    this.config = {
      maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
      reservedForResponse: config.reservedForResponse ?? DEFAULT_RESERVED_FOR_RESPONSE,
      warningThreshold: config.warningThreshold ?? DEFAULT_WARNING_THRESHOLD,
      compactThreshold: config.compactThreshold ?? DEFAULT_COMPACT_THRESHOLD,
    };
  }

  /**
   * The effective token budget for input (maxTokens - reservedForResponse).
   */
  get effectiveMax(): number {
    return Math.max(1, this.config.maxTokens - this.config.reservedForResponse);
  }

  /**
   * Track the last actual input token count from the API response.
   * Call this after every API response with `response.usage.input_tokens`.
   */
  get lastInputTokens(): number {
    return this._lastInputTokens;
  }

  set lastInputTokens(value: number) {
    this._lastInputTokens = value;
  }

  /**
   * Estimate token count for a piece of text.
   */
  estimateTokens(text: string): number {
    return estimateTokens(text);
  }

  /**
   * Check if the messages array needs compaction.
   * Returns true when estimated tokens exceed compactThreshold * effectiveMax.
   */
  shouldCompact(messages: ContextMessage[]): boolean {
    const totalTokens = estimateTotalTokens(messages);
    const threshold = this.config.compactThreshold * this.effectiveMax;
    return totalTokens > threshold;
  }

  /**
   * Check if we're in the warning zone (above warningThreshold but below compactThreshold).
   */
  isWarning(messages: ContextMessage[]): boolean {
    const totalTokens = estimateTotalTokens(messages);
    const warningAt = this.config.warningThreshold * this.effectiveMax;
    return totalTokens > warningAt;
  }

  /**
   * Compact messages by summarizing older messages and keeping the N most recent.
   *
   * Strategy: extractive summary of older messages, keep `keepRecent` recent messages.
   * The summary is capped at MAX_SUMMARY_CHARS to avoid bloat.
   *
   * Returns a CompactionResult with the new message array embedded in `summary`.
   * The caller should replace their messages array with the compacted version.
   */
  compact(messages: ContextMessage[], keepRecent: number = 10): {
    result: CompactionResult;
    compacted: ContextMessage[];
  } {
    const messagesBefore = messages.length;
    const estimatedTokensBefore = estimateTotalTokens(messages);

    if (messages.length <= keepRecent) {
      return {
        result: {
          success: false,
          messagesBefore,
          messagesAfter: messages.length,
          estimatedTokensBefore,
          estimatedTokensAfter: estimatedTokensBefore,
          summary: '',
        },
        compacted: messages,
      };
    }

    const olderMessages = messages.slice(0, messages.length - keepRecent);
    const recentMessages = messages.slice(-keepRecent);

    // Build extractive summary from older messages
    const summaryParts: string[] = [];
    let summaryLen = 0;

    for (const msg of olderMessages) {
      // Extract key content from each message
      const prefix = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
      // Take first 200 chars of each message for the summary
      const excerpt = msg.content.length > 200
        ? msg.content.slice(0, 200) + '...'
        : msg.content;
      const line = `${prefix}: ${excerpt}`;

      if (summaryLen + line.length > MAX_SUMMARY_CHARS) {
        summaryParts.push(`[...${olderMessages.length - summaryParts.length} more messages omitted]`);
        break;
      }

      summaryParts.push(line);
      summaryLen += line.length;
    }

    const summaryText = summaryParts.join('\n');
    const droppedCount = olderMessages.length;

    // Build compacted message array: summary + recent messages
    const summaryMessage: ContextMessage = {
      role: 'system',
      content: `[Previous conversation summary (${droppedCount} messages compacted)]:\n${summaryText}`,
      timestamp: new Date(),
    };
    summaryMessage.tokens = estimateMessageTokens(summaryMessage);

    const compacted = [summaryMessage, ...recentMessages];
    const estimatedTokensAfter = estimateTotalTokens(compacted);

    this._compactionCount++;
    this._messagesDropped += droppedCount;

    logger.info({
      messagesBefore,
      messagesAfter: compacted.length,
      tokensBefore: estimatedTokensBefore,
      tokensAfter: estimatedTokensAfter,
      dropped: droppedCount,
    }, 'Context compacted');

    return {
      result: {
        success: true,
        messagesBefore,
        messagesAfter: compacted.length,
        estimatedTokensBefore,
        estimatedTokensAfter,
        summary: summaryText,
      },
      compacted,
    };
  }

  /**
   * Build a system prompt from base prompt + optional skill context + optional memory.
   * Returns the composed prompt and its estimated token count.
   */
  buildSystemPrompt(
    base: string,
    skillContext?: string,
    memory?: string,
  ): { prompt: string; estimatedTokens: number } {
    const parts: string[] = [base];

    if (skillContext) {
      parts.push(`\n## Skills Reference\n${skillContext}`);
    }

    if (memory) {
      parts.push(`\n## Memory\n${memory}`);
    }

    const prompt = parts.join('\n');
    const tokens = estimateTokens(prompt);

    return { prompt, estimatedTokens: tokens };
  }

  /**
   * Get usage statistics for monitoring and debugging.
   */
  getUsageStats(): UsageStats {
    return {
      estimatedTokens: 0, // Caller should pass messages to get this
      actualInputTokens: this._lastInputTokens,
      compactionCount: this._compactionCount,
      messagesDropped: this._messagesDropped,
    };
  }

  /**
   * Get usage stats with a specific messages array for accurate estimation.
   */
  getUsageStatsForMessages(messages: ContextMessage[]): UsageStats {
    return {
      estimatedTokens: estimateTotalTokens(messages),
      actualInputTokens: this._lastInputTokens,
      compactionCount: this._compactionCount,
      messagesDropped: this._messagesDropped,
    };
  }

  /**
   * Reset statistics (e.g., on session clear).
   */
  resetStats(): void {
    this._lastInputTokens = 0;
    this._compactionCount = 0;
    this._messagesDropped = 0;
  }
}
