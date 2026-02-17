/**
 * Production Utilities
 *
 * Health checks, error tracking, request metrics, and graceful shutdown handling.
 * Ported from Clodds, simplified for FlipGod.
 */

import v8 from 'v8';
import { createLogger } from './logger';
import type { Database } from '../db';

const logger = createLogger('production');

// =============================================================================
// HEALTH CHECK
// =============================================================================

export interface CheckResult {
  status: 'pass' | 'warn' | 'fail';
  message?: string;
  latencyMs?: number;
}

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  uptime: number;
  version: string;
  checks: {
    database: CheckResult;
    memory: CheckResult;
  };
}

/**
 * HealthChecker - validates database connectivity and memory usage.
 */
export class HealthChecker {
  private readonly startTime = Date.now();

  /**
   * Check database health by running `SELECT 1` and measuring latency.
   */
  checkDatabase(db: Database): CheckResult {
    const start = Date.now();
    try {
      db.query('SELECT 1');
      return {
        status: 'pass',
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        status: 'fail',
        message: err instanceof Error ? err.message : 'Database check failed',
        latencyMs: Date.now() - start,
      };
    }
  }

  /**
   * Check memory usage against V8 heap limit.
   * Warns at 75% usage, fails at 90%.
   */
  checkMemory(): CheckResult {
    const used = process.memoryUsage();
    const heapLimit = v8.getHeapStatistics().heap_size_limit;
    const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(heapLimit / 1024 / 1024);
    const usagePercent = (used.heapUsed / heapLimit) * 100;

    if (usagePercent > 90) {
      return {
        status: 'fail',
        message: `Heap usage critical: ${heapUsedMB}MB / ${heapTotalMB}MB (${usagePercent.toFixed(1)}%)`,
      };
    }

    if (usagePercent > 75) {
      return {
        status: 'warn',
        message: `Heap usage high: ${heapUsedMB}MB / ${heapTotalMB}MB (${usagePercent.toFixed(1)}%)`,
      };
    }

    return {
      status: 'pass',
      message: `${heapUsedMB}MB / ${heapTotalMB}MB (${usagePercent.toFixed(1)}%)`,
    };
  }

  /**
   * Run all health checks and return an aggregate status.
   */
  checkAll(db: Database): HealthStatus {
    const dbCheck = this.checkDatabase(db);
    const memoryCheck = this.checkMemory();

    const allChecks = [dbCheck, memoryCheck];

    let status: HealthStatus['status'] = 'healthy';
    if (allChecks.some((c) => c.status === 'fail')) {
      status = 'unhealthy';
    } else if (allChecks.some((c) => c.status === 'warn')) {
      status = 'degraded';
    }

    return {
      status,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      version: process.env.npm_package_version ?? '0.1.0',
      checks: {
        database: dbCheck,
        memory: memoryCheck,
      },
    };
  }
}

// =============================================================================
// ERROR TRACKING
// =============================================================================

interface ErrorEvent {
  timestamp: number;
  error: string;
  stack?: string;
  context?: Record<string, unknown>;
  handler?: string;
  userId?: string;
}

/**
 * ErrorTracker - ring buffer of recent errors with frequency counting.
 */
export class ErrorTracker {
  private readonly maxSize: number;
  private readonly errors: ErrorEvent[] = [];
  private readonly errorCounts = new Map<string, number>();

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  /**
   * Track an error.
   */
  track(
    err: Error | string,
    context?: {
      handler?: string;
      userId?: string;
      extra?: Record<string, unknown>;
    }
  ): void {
    const error = err instanceof Error ? err : new Error(err);
    const errorKey = `${error.name}:${error.message.slice(0, 100)}`;

    // Increment frequency count
    this.errorCounts.set(errorKey, (this.errorCounts.get(errorKey) ?? 0) + 1);

    // Add to ring buffer
    const event: ErrorEvent = {
      timestamp: Date.now(),
      error: error.message,
      stack: this.sanitizePath(error.stack ?? ''),
      handler: context?.handler,
      userId: context?.userId,
      context: context?.extra,
    };

    this.errors.push(event);
    if (this.errors.length > this.maxSize) {
      this.errors.shift();
    }

    // Structured log
    logger.error(
      {
        err: error,
        handler: context?.handler,
        userId: context?.userId,
        ...context?.extra,
      },
      'Tracked error'
    );
  }

  /**
   * Get the last N errors.
   */
  getRecent(n = 20): ErrorEvent[] {
    return this.errors.slice(-n);
  }

  /**
   * Get error frequency counts, sorted by most frequent.
   */
  getErrorCounts(): Array<{ error: string; count: number }> {
    return Array.from(this.errorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([error, count]) => ({ error, count }));
  }

  /**
   * Remove absolute paths from stack traces to avoid leaking filesystem info.
   */
  sanitizePath(str: string): string {
    return str
      .replace(/\(\/[^)]+\)/g, '(<path>)')
      .replace(/at \/[^\s]+/g, 'at <path>');
  }

  /**
   * Clear all tracked errors.
   */
  clear(): void {
    this.errors.length = 0;
    this.errorCounts.clear();
  }
}

// =============================================================================
// REQUEST METRICS
// =============================================================================

interface RequestEntry {
  timestamp: number;
}

/**
 * RequestMetrics - tracks request counts by route and user, with a sliding
 * 60-second window for requests-per-minute calculation.
 */
export class RequestMetrics {
  private total = 0;
  private errorCount = 0;
  private readonly byRoute = new Map<string, number>();
  private readonly byUser = new Map<string, number>();
  private recentRequests: RequestEntry[] = [];

  /**
   * Record a request. Pass an error to also count it as an error.
   */
  record(route: string, userId?: string, error?: Error | null): void {
    this.total++;

    // By route
    this.byRoute.set(route, (this.byRoute.get(route) ?? 0) + 1);

    // By user
    if (userId) {
      this.byUser.set(userId, (this.byUser.get(userId) ?? 0) + 1);
    }

    // Error tracking
    if (error) {
      this.errorCount++;
    }

    // Sliding window for RPM
    const now = Date.now();
    this.recentRequests.push({ timestamp: now });

    // Prune entries older than 60s
    const cutoff = now - 60_000;
    this.recentRequests = this.recentRequests.filter((r) => r.timestamp > cutoff);

    // Prevent unbounded growth of by-route and by-user maps
    if (this.byRoute.size > 500) {
      this.pruneMap(this.byRoute, 250);
    }
    if (this.byUser.size > 500) {
      this.pruneMap(this.byUser, 250);
    }
  }

  /**
   * Get a snapshot of current metrics.
   */
  getMetrics(): {
    total: number;
    errors: number;
    requestsPerMinute: number;
    topRoutes: Array<{ route: string; count: number }>;
    topUsers: Array<{ userId: string; count: number }>;
  } {
    // Prune stale RPM entries on read
    const cutoff = Date.now() - 60_000;
    this.recentRequests = this.recentRequests.filter((r) => r.timestamp > cutoff);

    const topRoutes = Array.from(this.byRoute.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([route, count]) => ({ route, count }));

    const topUsers = Array.from(this.byUser.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([userId, count]) => ({ userId, count }));

    return {
      total: this.total,
      errors: this.errorCount,
      requestsPerMinute: this.recentRequests.length,
      topRoutes,
      topUsers,
    };
  }

  /**
   * Prune a map to keep only the top N entries by value.
   */
  private pruneMap(map: Map<string, number>, keep: number): void {
    const sorted = Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, keep);
    map.clear();
    for (const [key, value] of sorted) {
      map.set(key, value);
    }
  }
}

// =============================================================================
// GRACEFUL SHUTDOWN
// =============================================================================

/**
 * Setup graceful shutdown handlers for SIGTERM, SIGINT, uncaughtException,
 * and unhandledRejection.
 *
 * @param shutdownFn - Async function to run during shutdown (e.g. close DB, stop server).
 *                     Called exactly once even if multiple signals arrive.
 */
export function setupShutdownHandlers(shutdownFn: () => Promise<void>): void {
  let isShuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) {
      logger.warn({ signal }, 'Shutdown already in progress, ignoring duplicate signal');
      return;
    }
    isShuttingDown = true;
    logger.info({ signal }, 'Starting graceful shutdown');

    // Force exit after 30 seconds if shutdown hangs
    const forceTimer = setTimeout(() => {
      logger.error('Shutdown timeout (30s) - forcing exit');
      process.exit(1);
    }, 30_000);
    // Don't let this timer keep the process alive
    if (forceTimer && typeof forceTimer === 'object' && 'unref' in forceTimer) {
      (forceTimer as NodeJS.Timeout).unref();
    }

    try {
      await shutdownFn();
      clearTimeout(forceTimer);
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      clearTimeout(forceTimer);
      logger.error({ err }, 'Shutdown failed');
      process.exit(1);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception - shutting down');
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    logger.error({ err }, 'Unhandled rejection');
    // Log but don't shutdown on unhandled rejections (Node 22 default behavior)
  });
}

// =============================================================================
// MEMORY SNAPSHOT (for /metrics)
// =============================================================================

/**
 * Get a snapshot of current memory usage, suitable for JSON serialization.
 */
export function getMemorySnapshot(): {
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
  heapLimitMB: number;
  usagePercent: number;
} {
  const mem = process.memoryUsage();
  const heapLimit = v8.getHeapStatistics().heap_size_limit;

  return {
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
    rssMB: Math.round(mem.rss / 1024 / 1024),
    externalMB: Math.round(mem.external / 1024 / 1024),
    heapLimitMB: Math.round(heapLimit / 1024 / 1024),
    usagePercent: parseFloat(((mem.heapUsed / heapLimit) * 100).toFixed(1)),
  };
}
