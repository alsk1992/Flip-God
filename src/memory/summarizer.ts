/**
 * Claude-powered summarization for context compaction
 *
 * Provides a SummarizerFn that uses the Anthropic API to compress
 * conversation history. Falls back to naive truncation if the API
 * key is missing or the call fails.
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('summarizer');

export type SummarizerFn = (text: string, maxTokens: number) => Promise<string>;

interface ClaudeSummarizerOptions {
  apiKey?: string;
  model?: string;
}

const DEFAULT_SUMMARY_MODEL = process.env.FLIPAGENT_SUMMARY_MODEL || 'claude-3-5-haiku-20241022';

/**
 * Create a Claude-powered summarizer function.
 * Returns `undefined` if no API key is available.
 */
export function createClaudeSummarizer(options: ClaudeSummarizerOptions = {}): SummarizerFn | undefined {
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return undefined;

  // Dynamic import to avoid hard dependency if @anthropic-ai/sdk is not installed
  let Anthropic: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Anthropic = require('@anthropic-ai/sdk').default;
  } catch {
    logger.debug('Optional @anthropic-ai/sdk not available for summarizer');
    return undefined;
  }

  const client = new Anthropic({ apiKey });
  const model = options.model || DEFAULT_SUMMARY_MODEL;

  return async (text: string, maxTokens: number): Promise<string> => {
    const targetTokens = Math.max(128, Math.min(1200, Math.floor(maxTokens)));

    try {
      const response = await client.messages.create({
        model,
        max_tokens: targetTokens,
        system:
          'You are a summarizer that compresses conversation history for future context. '
          + 'Preserve key facts, decisions, constraints, and open questions. Be concise and structured.',
        messages: [
          {
            role: 'user',
            content:
              'Summarize the following conversation history for future context. '
              + 'Focus on durable facts and decisions.\n\n'
              + text,
          },
        ],
      });

      const summary = response.content
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n')
        .trim();

      return summary || '[Summary unavailable]';
    } catch (error) {
      logger.warn({ error }, 'Claude summarizer failed, falling back to naive summary');
      // Naive fallback: truncate the input.
      const maxChars = targetTokens * 4;
      return text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[...truncated]` : text;
    }
  };
}
