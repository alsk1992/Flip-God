/**
 * HTTP utilities with rate limiting + retry for API calls.
 * Self-contained - no external rate limiter or retry imports.
 */

import { createLogger } from './logger';

const logger = createLogger('http');

// =============================================================================
// Types
// =============================================================================

export interface HttpRetryConfig {
  enabled?: boolean;
  maxAttempts?: number;
  minDelay?: number;
  maxDelay?: number;
  jitter?: number;
  backoffMultiplier?: number;
  methods?: string[];
}

export interface HttpRateLimitConfig {
  enabled?: boolean;
  defaultRateLimit?: { maxRequests: number; windowMs: number };
  perHost?: Record<string, { maxRequests: number; windowMs: number }>;
  retry?: HttpRetryConfig;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_RATE_LIMIT = {
  maxRequests: 60,
  windowMs: 60_000,
};

const DEFAULT_RETRY: Required<HttpRetryConfig> = {
  enabled: true,
  maxAttempts: 3,
  minDelay: 500,
  maxDelay: 30_000,
  jitter: 0.1,
  backoffMultiplier: 2,
  methods: ['GET', 'HEAD', 'OPTIONS'],
};

/** Default per-request timeout (30 seconds) to prevent hanging requests */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Max host entries to prevent memory leaks */
const MAX_HOST_ENTRIES = 500;

// =============================================================================
// In-file rate limiter (simple sliding window counter)
// =============================================================================

interface HostBucket {
  count: number;
  resetAt: number;
}

const hostBuckets = new Map<string, HostBucket>();
const hostCooldowns = new Map<string, number>();

function checkRateLimit(
  host: string,
  config: { maxRequests: number; windowMs: number }
): { allowed: boolean; resetIn: number } {
  const now = Date.now();
  let bucket = hostBuckets.get(host);

  // Evict oldest entries if over limit
  if (!bucket && hostBuckets.size >= MAX_HOST_ENTRIES) {
    const firstKey = hostBuckets.keys().next().value;
    if (firstKey) hostBuckets.delete(firstKey);
  }

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + config.windowMs };
    hostBuckets.set(host, bucket);
  }

  bucket.count++;
  if (bucket.count > config.maxRequests) {
    return { allowed: false, resetIn: bucket.resetAt - now };
  }
  return { allowed: true, resetIn: 0 };
}

// =============================================================================
// Helpers
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateDelay(
  attempt: number,
  opts: {
    minDelay: number;
    maxDelay: number;
    jitter: number;
    backoffMultiplier: number;
  }
): number {
  const base = opts.minDelay * Math.pow(opts.backoffMultiplier, attempt - 1);
  const capped = Math.min(base, opts.maxDelay);
  const jitterRange = capped * opts.jitter;
  const jitterValue = (Math.random() * 2 - 1) * jitterRange;
  return Math.max(0, Math.round(capped + jitterValue));
}

type FetchInput = string | URL | Request;

let originalFetch: typeof fetch | null = null;
let httpConfig: HttpRateLimitConfig = {
  enabled: true,
  defaultRateLimit: DEFAULT_RATE_LIMIT,
  perHost: {},
  retry: DEFAULT_RETRY,
};

function normalizeMethod(method?: string): string {
  return (method ?? 'GET').toUpperCase();
}

function getHostKey(input: FetchInput): string | null {
  const urlText =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  try {
    const parsed = new URL(urlText);
    return parsed.host;
  } catch {
    return null;
  }
}

function resolveRateLimit(
  host: string
): { maxRequests: number; windowMs: number } | null {
  if (httpConfig.enabled === false) return null;
  return httpConfig.perHost?.[host] ?? httpConfig.defaultRateLimit ?? null;
}

function parseRetryAfter(headerValue: string | null): number | null {
  if (!headerValue) return null;
  const seconds = Number.parseInt(headerValue, 10);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const parsed = Date.parse(headerValue);
  if (!Number.isNaN(parsed)) {
    const delta = parsed - Date.now();
    return delta > 0 ? delta : null;
  }
  return null;
}

function shouldRetryMethod(
  method: string,
  config?: HttpRetryConfig
): boolean {
  const retryConfig = config ?? DEFAULT_RETRY;
  if (retryConfig.enabled === false) return false;
  const methods =
    retryConfig.methods?.length ? retryConfig.methods : DEFAULT_RETRY.methods;
  return methods.includes(method);
}

// =============================================================================
// Core fetch wrapper
// =============================================================================

async function waitForCooldown(host: string): Promise<void> {
  const until = hostCooldowns.get(host);
  if (!until) return;
  const now = Date.now();
  if (until <= now) {
    hostCooldowns.delete(host);
    return;
  }
  const delay = until - now;
  logger.warn({ host, delay }, 'HTTP cooldown active; waiting');
  await sleep(delay);
}

async function applyRateLimit(host: string): Promise<void> {
  const config = resolveRateLimit(host);
  if (!config) return;
  const result = checkRateLimit(host, config);
  if (!result.allowed) {
    const waitMs = Math.max(0, result.resetIn);
    logger.warn({ host, waitMs }, 'HTTP rate limit hit; waiting');
    await sleep(waitMs);
  }
}

async function fetchWithControl(
  input: FetchInput,
  init?: RequestInit
): Promise<Response> {
  if (!originalFetch) {
    return fetch(input, init);
  }

  const host = getHostKey(input);
  if (!host) {
    return originalFetch(input, init);
  }

  await waitForCooldown(host);
  await applyRateLimit(host);

  const method = normalizeMethod(
    init?.method ??
      (input instanceof Request ? input.method : undefined)
  );
  const retryConfig = httpConfig.retry ?? DEFAULT_RETRY;
  const allowRetry = shouldRetryMethod(method, retryConfig);
  const maxAttempts = allowRetry
    ? (retryConfig.maxAttempts ?? DEFAULT_RETRY.maxAttempts)
    : 1;
  const minDelay = retryConfig.minDelay ?? DEFAULT_RETRY.minDelay;
  const maxDelay = retryConfig.maxDelay ?? DEFAULT_RETRY.maxDelay;
  const jitter = retryConfig.jitter ?? DEFAULT_RETRY.jitter;
  const backoffMultiplier =
    retryConfig.backoffMultiplier ?? DEFAULT_RETRY.backoffMultiplier;

  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Add default timeout if caller hasn't provided an AbortSignal
      const fetchInit = init?.signal
        ? init
        : {
            ...init,
            signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
          };
      const response = await originalFetch(input, fetchInit);
      lastResponse = response;
      if (!allowRetry) return response;

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxAttempts) return response;

        // Consume response body to free the underlying connection and
        // prevent memory leaks in Node.  We don't need the content.
        try { await response.body?.cancel(); } catch { /* ignore */ }

        const retryAfter = parseRetryAfter(
          response.headers.get('retry-after')
        );
        if (retryAfter) {
          hostCooldowns.set(host, Date.now() + retryAfter);
        }
        const delay =
          retryAfter ??
          calculateDelay(attempt, {
            minDelay,
            maxDelay,
            jitter,
            backoffMultiplier,
          });
        logger.warn(
          { host, status: response.status, delay },
          'HTTP retry scheduled'
        );
        await sleep(delay);
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;
      if (!allowRetry || attempt >= maxAttempts) {
        throw error;
      }
      const delay = calculateDelay(attempt, {
        minDelay,
        maxDelay,
        jitter,
        backoffMultiplier,
      });
      logger.warn({ host, delay, error }, 'HTTP request failed; retrying');
      await sleep(delay);
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError;
}

// =============================================================================
// Public API
// =============================================================================

/** Merge additional rate-limit / retry settings into the HTTP client config. */
export function configureHttpClient(config?: HttpRateLimitConfig): void {
  if (!config) return;
  httpConfig = {
    ...httpConfig,
    ...config,
    perHost: { ...(httpConfig.perHost ?? {}), ...(config.perHost ?? {}) },
    retry: { ...(httpConfig.retry ?? {}), ...(config.retry ?? {}) },
  };
  hostBuckets.clear();
}

/** Install the rate-limited / retrying fetch wrapper as the global `fetch`. */
export function installHttpClient(config?: HttpRateLimitConfig): void {
  if (!originalFetch) {
    originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = fetchWithControl;
  }
  if (config) configureHttpClient(config);
}

/** Return the current HTTP client configuration (rate limits + retry). */
export function getHttpClientConfig(): HttpRateLimitConfig {
  return httpConfig;
}
