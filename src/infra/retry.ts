/**
 * Retry Infrastructure - Exponential backoff with jitter
 *
 * Ported from Clodds, simplified for FlipAgent.
 *
 * Features:
 * - Exponential backoff with configurable min/max delays
 * - Jitter support to prevent thundering herd
 * - Custom retry predicates per error type
 * - Server-provided retry-after extraction
 * - Per-provider retry policies
 * - onRetry callbacks for observability
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('retry');

// =============================================================================
// TYPES
// =============================================================================

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts?: number;
  /** Minimum delay in ms (default: 1000) */
  minDelay?: number;
  /** Maximum delay in ms (default: 30000) */
  maxDelay?: number;
  /** Jitter factor 0-1 (default: 0.1 = +/-10%) */
  jitter?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Custom predicate to determine if error is retryable */
  retryPredicate?: (error: Error, attempt: number) => boolean;
  /** Callback on each retry attempt */
  onRetry?: (info: RetryInfo) => void;
  /** Timeout per attempt in ms */
  timeout?: number;
}

export interface RetryInfo {
  attempt: number;
  maxAttempts: number;
  delay: number;
  error: Error;
  willRetry: boolean;
}

export interface RetryPolicy {
  name: string;
  config: RetryOptions;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

/**
 * An error that should be retried.
 */
export class RetryableError extends Error {
  readonly retryable = true;
  readonly retryAfter?: number;

  constructor(message: string, retryAfter?: number) {
    super(message);
    this.name = 'RetryableError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Rate-limit error (HTTP 429). Always retryable with optional retry-after hint.
 */
export class RateLimitError extends RetryableError {
  readonly statusCode: number;

  constructor(message: string, statusCode = 429, retryAfter?: number) {
    super(message, retryAfter);
    this.name = 'RateLimitError';
    this.statusCode = statusCode;
  }
}

/**
 * An error that should NOT be retried (e.g. 4xx client errors, validation errors).
 */
export class NonRetryableError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

/**
 * A transient/network error. Retryable by default.
 */
export class TransientError extends RetryableError {
  readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'TransientError';
    this.statusCode = statusCode;
  }
}

// =============================================================================
// TRANSIENT ERROR DETECTION
// =============================================================================

/** Common transient error message patterns */
const TRANSIENT_PATTERNS = [
  'econnreset',
  'econnrefused',
  'etimedout',
  'econnaborted',
  'epipe',
  'enetunreach',
  'ehostunreach',
  'socket hang up',
  'network error',
  'failed to fetch',
  'connection reset',
  'service unavailable',
  'bad gateway',
  'gateway timeout',
  'request timeout',
];

/**
 * Detect transient/network errors that are safe to retry.
 */
export function isTransientError(err: Error): boolean {
  // Explicitly marked
  if ('retryable' in err) {
    return (err as RetryableError).retryable;
  }

  // Network-level error names
  if (err.name === 'FetchError' || err.name === 'AbortError') {
    return true;
  }

  // HTTP status code on the error object
  const errRecord = err as unknown as Record<string, unknown>;
  const statusCode =
    (errRecord.status as number | undefined) ??
    (errRecord.statusCode as number | undefined) ??
    ((errRecord.response as Record<string, unknown> | undefined)?.status as number | undefined);
  if (typeof statusCode === 'number') {
    if (statusCode === 429 || (statusCode >= 500 && statusCode <= 504)) {
      return true;
    }
  }

  // Message-based detection
  const message = err.message.toLowerCase();
  if (TRANSIENT_PATTERNS.some((p) => message.includes(p))) {
    return true;
  }

  // Status code patterns embedded in message text
  const statusPatterns = /\b(status\s*[:=]?\s*|http\s+)(429|50[0-4])\b/i;
  if (statusPatterns.test(err.message)) {
    return true;
  }

  return false;
}

// =============================================================================
// RETRY-AFTER PARSING
// =============================================================================

/**
 * Extract a retry-after hint (in milliseconds) from a Response's headers.
 * Returns null if no header is present or it cannot be parsed.
 */
export function parseRetryAfter(response: { headers?: { get?: (name: string) => string | null } }): number | null {
  if (!response?.headers?.get) return null;

  const header = response.headers.get('retry-after');
  if (!header) return null;

  // Try numeric seconds first
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // Try HTTP-date format
  const dateMs = Date.parse(header);
  if (!isNaN(dateMs)) {
    const delayMs = dateMs - Date.now();
    return delayMs > 0 ? delayMs : null;
  }

  return null;
}

/**
 * Extract retry-after from an error object (e.g. retryAfter property or message text).
 */
export function extractRetryAfterFromError(error: Error): number | null {
  // Explicit retryAfter property
  if ('retryAfter' in error && typeof (error as RetryableError).retryAfter === 'number') {
    return (error as RetryableError).retryAfter!;
  }

  // Pattern: "retry after X seconds" or "retry_after: X"
  const retryMatch = error.message.match(/retry[_\s-]?after[:\s]+(\d+)/i);
  if (retryMatch) {
    const value = parseInt(retryMatch[1], 10);
    // Assume seconds if < 1000, ms if >= 1000
    return value < 1000 ? value * 1000 : value;
  }

  return null;
}

// =============================================================================
// DELAY CALCULATION
// =============================================================================

/**
 * Calculate delay with exponential backoff and jitter.
 */
export function calculateDelay(
  attempt: number,
  config: Required<Pick<RetryOptions, 'minDelay' | 'maxDelay' | 'jitter' | 'backoffMultiplier'>>
): number {
  // Exponential backoff: minDelay * (multiplier ^ (attempt - 1))
  const exponentialDelay = config.minDelay * Math.pow(config.backoffMultiplier, attempt - 1);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelay);

  // Apply jitter (+/- jitter%)
  const jitterRange = cappedDelay * config.jitter;
  const jitterValue = (Math.random() * 2 - 1) * jitterRange;

  return Math.round(Math.max(0, cappedDelay + jitterValue));
}

/**
 * Sleep for specified duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// withRetry - GENERIC RETRY WRAPPER
// =============================================================================

/**
 * Execute a function with automatic retry on transient errors.
 *
 * @example
 * ```ts
 * const data = await withRetry(() => fetch(url).then(r => r.json()), {
 *   maxAttempts: 3,
 *   minDelay: 1000,
 * });
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    minDelay = 1000,
    maxDelay = 30000,
    jitter = 0.1,
    backoffMultiplier = 2,
    retryPredicate = isTransientError,
    onRetry,
    timeout,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Execute with optional per-attempt timeout
      if (timeout) {
        return await withTimeout(fn(), timeout);
      }
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const willRetry = attempt < maxAttempts && retryPredicate(lastError, attempt);

      // Calculate delay
      let delay: number;
      const serverRetryAfter = extractRetryAfterFromError(lastError);
      if (serverRetryAfter !== null) {
        delay = Math.min(serverRetryAfter, maxDelay);
      } else {
        delay = calculateDelay(attempt, { minDelay, maxDelay, jitter, backoffMultiplier });
      }

      // Notify via callback
      const retryInfo: RetryInfo = {
        attempt,
        maxAttempts,
        delay,
        error: lastError,
        willRetry,
      };

      if (onRetry) {
        onRetry(retryInfo);
      }

      logger.debug(
        { attempt, maxAttempts, delay, willRetry, error: lastError.message },
        'Retry attempt'
      );

      if (!willRetry) {
        break;
      }

      // Wait before next attempt
      await sleep(delay);
    }
  }

  throw lastError;
}

// =============================================================================
// withTimeout - PROMISE TIMEOUT WRAPPER
// =============================================================================

/**
 * Wrap a promise with a timeout. Rejects with TransientError if the
 * operation does not complete within `timeoutMs` milliseconds.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TransientError(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

// =============================================================================
// PRE-BUILT RETRY POLICIES
// =============================================================================

export const RETRY_POLICIES: Record<string, RetryPolicy> = {
  /** Default policy for most APIs */
  default: {
    name: 'default',
    config: {
      maxAttempts: 3,
      minDelay: 1000,
      maxDelay: 30000,
      jitter: 0.1,
      backoffMultiplier: 2,
    },
  },

  /** Conservative policy for rate-limited or fragile APIs */
  conservative: {
    name: 'conservative',
    config: {
      maxAttempts: 5,
      minDelay: 2000,
      maxDelay: 60000,
      jitter: 0.2,
      backoffMultiplier: 2,
    },
  },

  /** Aggressive policy for critical operations that must succeed */
  aggressive: {
    name: 'aggressive',
    config: {
      maxAttempts: 10,
      minDelay: 100,
      maxDelay: 10000,
      jitter: 0.1,
      backoffMultiplier: 1.5,
    },
  },

  /** Policy tuned for Anthropic API (overloaded, rate limits) */
  anthropic: {
    name: 'anthropic',
    config: {
      maxAttempts: 3,
      minDelay: 1000,
      maxDelay: 60000,
      jitter: 0.1,
      backoffMultiplier: 2,
      retryPredicate: (error) => {
        const msg = error.message.toLowerCase();
        return (
          msg.includes('overloaded') ||
          msg.includes('rate limit') ||
          isTransientError(error)
        );
      },
    },
  },
};

/**
 * Get retry policy by name. Falls back to `default`.
 */
export function getRetryPolicy(name: string): RetryPolicy {
  return RETRY_POLICIES[name] ?? RETRY_POLICIES.default;
}

// =============================================================================
// CONVENIENCE EXPORTS
// =============================================================================

export const retry = {
  withRetry,
  withTimeout,
  calculateDelay,
  sleep,
  isTransient: isTransientError,
  parseRetryAfter,
  extractRetryAfter: extractRetryAfterFromError,
  policies: RETRY_POLICIES,
  getPolicy: getRetryPolicy,
};
