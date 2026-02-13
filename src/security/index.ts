/**
 * Security Module - Rate limiting, input sanitization, injection detection, access control
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('security');

// =============================================================================
// TYPES
// =============================================================================

export interface RateLimitConfig {
  /** Max requests per window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
}

export interface SanitizeOptions {
  /** Maximum string length (default: 10000) */
  maxLength?: number;
  /** Allow HTML tags (default: false) */
  allowHtml?: boolean;
}

export interface AccessControlConfig {
  /** Allowed user IDs (if non-empty, only these are allowed) */
  allowlist?: string[];
  /** Blocked user IDs (always denied) */
  blocklist?: string[];
}

export interface AuthResult {
  allowed: boolean;
  reason?: string;
  userId?: string;
}

// =============================================================================
// RATE LIMITER
// =============================================================================

interface SlidingWindowEntry {
  timestamps: number[];
}

const MAX_ENTRIES = 1000;

/**
 * Sliding window rate limiter.
 *
 * Tracks request timestamps per key and enforces a maximum number of
 * requests within a rolling time window. Uses LRU eviction when the
 * number of tracked keys exceeds MAX_ENTRIES to prevent unbounded memory
 * growth.
 */
export class RateLimiter {
  private windows: Map<string, SlidingWindowEntry> = new Map();
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(config: RateLimitConfig) {
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
  }

  /**
   * Check if a request for the given key is allowed.
   * Returns remaining quota and time until oldest entry expires.
   */
  check(key: string): { allowed: boolean; remaining: number; resetIn: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let entry = this.windows.get(key);

    if (!entry) {
      entry = { timestamps: [] };
      this.windows.set(key, entry);
    }

    // Evict timestamps outside the current window
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    const count = entry.timestamps.length;
    const remaining = Math.max(0, this.maxRequests - count);

    // Time until the oldest timestamp in the window expires
    const resetIn =
      entry.timestamps.length > 0
        ? Math.max(0, entry.timestamps[0] + this.windowMs - now)
        : 0;

    if (count >= this.maxRequests) {
      return { allowed: false, remaining: 0, resetIn };
    }

    // Record this request
    entry.timestamps.push(now);

    // LRU eviction: delete the oldest-accessed entry when over limit.
    // Map iteration order is insertion order, so re-insert the accessed key
    // to move it to the end (most recently used).
    this.windows.delete(key);
    this.windows.set(key, entry);

    if (this.windows.size > MAX_ENTRIES) {
      // Delete the least-recently-used entry (first key in iteration order)
      const firstKey = this.windows.keys().next().value as string;
      this.windows.delete(firstKey);
    }

    return { allowed: true, remaining: remaining - 1, resetIn };
  }

  /** Reset rate limit for a specific key */
  reset(key: string): void {
    this.windows.delete(key);
  }

  /** Remove all entries with no timestamps in the current window */
  cleanup(): void {
    const windowStart = Date.now() - this.windowMs;
    for (const [key, entry] of this.windows) {
      entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
      if (entry.timestamps.length === 0) {
        this.windows.delete(key);
      }
    }
  }

  /** Number of tracked keys (for monitoring) */
  get size(): number {
    return this.windows.size;
  }
}

// =============================================================================
// INPUT SANITIZER
// =============================================================================

export class InputSanitizer {
  /**
   * Sanitize a string by stripping dangerous content.
   *
   * - Removes null bytes
   * - Strips HTML tags (unless allowHtml)
   * - Normalizes whitespace (CRLF -> LF)
   * - Enforces max length
   */
  static sanitize(input: string, options: SanitizeOptions = {}): string {
    const maxLength = options.maxLength ?? 10_000;
    let result = input;

    // Remove null bytes
    result = result.replace(/\0/g, '');

    // Strip HTML unless allowed
    if (!options.allowHtml) {
      result = result.replace(/<[^>]*>/g, '');
    }

    // Normalize whitespace
    result = result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Enforce max length
    if (result.length > maxLength) {
      result = result.slice(0, maxLength);
    }

    return result.trim();
  }
}

// =============================================================================
// INJECTION DETECTOR
// =============================================================================

export class InjectionDetector {
  private static readonly SQL_PATTERNS: RegExp[] = [
    /'\s*(?:OR|AND)\s*'?\d*'?\s*=\s*'?\d*'?/i,
    /;\s*(?:DROP|DELETE|UPDATE|INSERT)\s/i,
    /UNION\s+(?:ALL\s+)?SELECT/i,
  ];

  private static readonly CMD_PATTERNS: RegExp[] = [
    /;\s*(?:rm|cat|ls|wget|curl|bash|sh|chmod|chown|kill|pkill|dd|nc|ncat)\s/i,
    /`[^`]+`/,
    /\$\([^)]+\)/,
    /\|\s*(?:cat|ls|rm|wget|curl|bash|sh|nc)\s/i,
    /&&\s*(?:rm|cat|wget|curl|bash|sh)\s/i,
  ];

  private static readonly XSS_PATTERNS: RegExp[] = [
    /<script[\s>]/i,
    /javascript:/i,
    /on\w+\s*=/i,
  ];

  private static readonly PATH_TRAVERSAL = /\.\.\/|\.\.\\/;

  /**
   * Scan input for common injection patterns.
   * Returns { safe: true } if no threats found, or a list of detected threat categories.
   */
  static detect(input: string): { safe: boolean; threats: string[] } {
    const threats: string[] = [];

    // SQL injection
    for (const pattern of InjectionDetector.SQL_PATTERNS) {
      if (pattern.test(input)) {
        threats.push('SQL injection');
        break;
      }
    }

    // Command injection
    for (const pattern of InjectionDetector.CMD_PATTERNS) {
      if (pattern.test(input)) {
        threats.push('Command injection');
        break;
      }
    }

    // XSS
    for (const pattern of InjectionDetector.XSS_PATTERNS) {
      if (pattern.test(input)) {
        threats.push('XSS');
        break;
      }
    }

    // Path traversal
    if (InjectionDetector.PATH_TRAVERSAL.test(input)) {
      threats.push('Path traversal');
    }

    return { safe: threats.length === 0, threats };
  }
}

// =============================================================================
// ACCESS CONTROL
// =============================================================================

export class AccessControl {
  private allowlist: Set<string>;
  private blocklist: Set<string>;

  constructor(config: AccessControlConfig = {}) {
    this.allowlist = new Set(config.allowlist ?? []);
    this.blocklist = new Set(config.blocklist ?? []);
  }

  /** Check if a user ID is allowed */
  checkAccess(userId: string): AuthResult {
    // Blocklist takes priority
    if (this.blocklist.has(userId)) {
      return { allowed: false, reason: 'User is blocked', userId };
    }

    // If allowlist is non-empty, only allowlisted users pass
    if (this.allowlist.size > 0 && !this.allowlist.has(userId)) {
      return { allowed: false, reason: 'User not in allowlist', userId };
    }

    return { allowed: true, userId };
  }

  /** Add a user to the allowlist (removes from blocklist) */
  allow(userId: string): void {
    this.allowlist.add(userId);
    this.blocklist.delete(userId);
    logger.info({ userId }, 'User added to allowlist');
  }

  /** Add a user to the blocklist (removes from allowlist) */
  block(userId: string): void {
    this.blocklist.add(userId);
    this.allowlist.delete(userId);
    logger.info({ userId }, 'User added to blocklist');
  }

  /** Remove a user from both lists */
  reset(userId: string): void {
    this.allowlist.delete(userId);
    this.blocklist.delete(userId);
  }

  /** Check if a specific user is on the allowlist */
  isAllowed(userId: string): boolean {
    return this.allowlist.has(userId);
  }

  /** Check if a specific user is on the blocklist */
  isBlocked(userId: string): boolean {
    return this.blocklist.has(userId);
  }
}
