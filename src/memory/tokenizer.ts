/**
 * Tokenizer utilities (Anthropic + OpenAI)
 *
 * Attempts to use @anthropic-ai/tokenizer for Claude models and tiktoken
 * for OpenAI models. Both are optional -- falls back to a char/3.5 estimation
 * if neither is available.
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('tokenizer');

// ---------------------------------------------------------------------------
// Optional dynamic imports -- these packages may not be installed.
// ---------------------------------------------------------------------------

type CountClaudeFn = (text: string) => number;
type EncodingForModelFn = (model: string) => { encode: (text: string) => { length: number }; free: () => void };
type GetEncodingFn = (name: string) => { encode: (text: string) => { length: number }; free: () => void };

let countClaudeTokens: CountClaudeFn | null = null;
let encoding_for_model: EncodingForModelFn | null = null;
let get_encoding: GetEncodingFn | null = null;

// Try loading @anthropic-ai/tokenizer
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('@anthropic-ai/tokenizer');
  countClaudeTokens = mod.countTokens as CountClaudeFn;
} catch {
  logger.debug('Optional @anthropic-ai/tokenizer not available, using fallback estimation');
}

// Try loading tiktoken
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('tiktoken');
  encoding_for_model = mod.encoding_for_model as EncodingForModelFn;
  get_encoding = mod.get_encoding as GetEncodingFn;
} catch {
  logger.debug('Optional tiktoken not available, using fallback estimation');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeModel(model?: string): string {
  if (!model) return '';
  return model.replace(/^anthropic\//, '').trim().toLowerCase();
}

function isAnthropicModel(model?: string): boolean {
  const m = normalizeModel(model);
  return m.startsWith('claude');
}

function isOpenAIModel(model?: string): boolean {
  const m = normalizeModel(model);
  return m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3');
}

function getDefaultModel(): string | undefined {
  return (
    process.env.FLIPAGENT_TOKENIZER_MODEL ||
    process.env.FLIPAGENT_MODEL ||
    process.env.ANTHROPIC_MODEL ||
    process.env.OPENAI_MODEL ||
    undefined
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Count tokens as accurately as possible for a given text and model.
 *
 * Resolution order:
 * 1. @anthropic-ai/tokenizer for Claude models (if installed)
 * 2. tiktoken encoding_for_model for OpenAI models (if installed)
 * 3. tiktoken cl100k_base as generic fallback (if installed)
 * 4. Rough char / 3.5 estimate
 */
export function countTokensAccurate(text: string, model?: string): number {
  if (!text) return 0;

  const resolvedModel = model || getDefaultModel();

  // Prefer Anthropic tokenizer for Claude-family models.
  if (countClaudeTokens && isAnthropicModel(resolvedModel)) {
    try {
      return countClaudeTokens(text);
    } catch {
      // fall through
    }
  }

  // Use tiktoken for OpenAI-like models.
  if (encoding_for_model && resolvedModel && isOpenAIModel(resolvedModel)) {
    try {
      const enc = encoding_for_model(resolvedModel);
      const tokens = enc.encode(text).length;
      enc.free();
      return tokens;
    } catch {
      // fall through to base encoding
    }
  }

  // Fallback: tiktoken cl100k_base
  if (get_encoding) {
    try {
      const enc = get_encoding('cl100k_base');
      const tokens = enc.encode(text).length;
      enc.free();
      return tokens;
    } catch {
      // fall through
    }
  }

  // Last resort: rough estimate (chars / 3.5)
  return Math.ceil(text.length / 3.5);
}
