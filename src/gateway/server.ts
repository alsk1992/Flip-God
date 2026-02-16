/**
 * HTTP + WebSocket Server for FlipAgent
 *
 * Security middleware:
 * - CORS (configurable allowlist or wildcard)
 * - IP-based rate limiting (sliding window)
 * - Security headers (nosniff, DENY, XSS protection, optional HSTS)
 * - Request logging (method, path, status, duration)
 * - Error-handling middleware
 * - Request timeout (30s default)
 */

import crypto from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '../utils/logger';
import { RateLimiter } from '../security';
import { HealthChecker, ErrorTracker, RequestMetrics, getMemorySnapshot } from '../utils/production';
import type { Database } from '../db';

const logger = createLogger('server');

// =============================================================================
// CONFIG TYPES
// =============================================================================

export interface CorsConfig {
  /** List of allowed origins, or true for wildcard '*', or false to disable */
  origins: string[] | boolean;
}

export interface ServerConfig {
  port: number;
  authToken?: string;
  /** CORS configuration. Defaults to disabled. */
  cors?: CorsConfig;
  /** Max requests per minute per IP. Defaults to 100. */
  rateLimitPerMinute?: number;
  /** Enable HSTS header. Defaults to false. */
  hstsEnabled?: boolean;
  /** Force HTTPS redirects. Defaults to false. */
  forceHttps?: boolean;
  /** Request timeout in milliseconds. Defaults to 30000 (30s). */
  requestTimeoutMs?: number;
}

export interface ServerCallbacks {
  onChatConnection?: (ws: WebSocket, req: http.IncomingMessage) => void;
  db?: Database;
}

// =============================================================================
// SERVER FACTORY
// =============================================================================

export function createServer(config: ServerConfig, callbacks?: ServerCallbacks) {
  const app = express();

  // Production monitoring singletons
  const healthChecker = new HealthChecker();
  const errorTracker = new ErrorTracker();
  const requestMetrics = new RequestMetrics();

  // ---------------------------------------------------------------------------
  // 1. CORS middleware
  // ---------------------------------------------------------------------------
  const corsConfig = config.cors;
  if (corsConfig) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      const originHeader = req.headers.origin;
      let origin = '';
      let allowCredentials = false;

      if (Array.isArray(corsConfig.origins)) {
        // Specific origin allowlist
        if (originHeader && corsConfig.origins.includes(originHeader)) {
          origin = originHeader;
          allowCredentials = true; // safe with specific origin
        }
      } else if (corsConfig.origins === true) {
        // Wildcard - do NOT allow credentials
        origin = '*';
        allowCredentials = false;
      }

      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        if (allowCredentials) {
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
      }

      // Handle preflight
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }

      next();
    });
  }

  // ---------------------------------------------------------------------------
  // 2. IP-based rate limiting (sliding window)
  // ---------------------------------------------------------------------------
  const ipRateLimit = config.rateLimitPerMinute ?? 100;
  const rateLimiter = new RateLimiter({
    maxRequests: ipRateLimit,
    windowMs: 60 * 1000, // 1 minute
  });

  // Periodic cleanup every 5 minutes
  const rateLimitCleanupInterval = setInterval(() => {
    rateLimiter.cleanup();
  }, 5 * 60 * 1000);
  // Don't prevent process exit
  if (rateLimitCleanupInterval.unref) {
    rateLimitCleanupInterval.unref();
  }

  app.use((req: Request, res: Response, next: NextFunction) => {
    // Skip rate limiting for health checks
    if (req.path === '/health') return next();

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const result = rateLimiter.check(ip);

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', ipRateLimit);
    res.setHeader('X-RateLimit-Remaining', result.remaining);
    res.setHeader('X-RateLimit-Reset', Math.ceil((Date.now() + result.resetIn) / 1000));

    if (!result.allowed) {
      logger.warn({ ip }, 'Rate limit exceeded');
      res.status(429).json({
        error: 'Too many requests',
        retryAfter: Math.ceil(result.resetIn / 1000),
      });
      return;
    }

    next();
  });

  // ---------------------------------------------------------------------------
  // 3. Security headers
  // ---------------------------------------------------------------------------
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Core security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // HSTS (only if explicitly enabled or request is already secure)
    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    if (config.hstsEnabled || isSecure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // HTTPS redirect
    if (config.forceHttps && !isSecure) {
      const host = req.headers.host;
      if (host) {
        res.redirect(301, `https://${host}${req.url}`);
        return;
      }
    }

    next();
  });

  // ---------------------------------------------------------------------------
  // 4. Request timeout
  // ---------------------------------------------------------------------------
  const timeoutMs = config.requestTimeoutMs ?? 30_000;

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setTimeout(timeoutMs, () => {
      if (!res.headersSent) {
        res.status(408).json({ error: 'Request timeout' });
      }
    });
    next();
  });

  // ---------------------------------------------------------------------------
  // Body parser
  // ---------------------------------------------------------------------------
  app.use(express.json({ limit: '1mb' }));

  // ---------------------------------------------------------------------------
  // 5. Request logging
  // ---------------------------------------------------------------------------
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    // Log on response finish and record metrics
    res.on('finish', () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[level](
        {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration,
        },
        '%s %s %d %dms',
        req.method,
        req.path,
        res.statusCode,
        duration
      );

      // Record request metrics
      const userId = (req as unknown as Record<string, unknown>).userId as string | undefined ?? req.headers['x-user-id'] as string | undefined;
      const isError = res.statusCode >= 400 ? new Error(`HTTP ${res.statusCode}`) : null;
      requestMetrics.record(`${req.method} ${req.path}`, userId, isError);
    });

    next();
  });

  // ---------------------------------------------------------------------------
  // Health check (always open, before auth)
  // ---------------------------------------------------------------------------
  app.get('/health', (_req: Request, res: Response) => {
    const db = callbacks?.db;
    if (db) {
      const health = healthChecker.checkAll(db);
      const httpStatus = health.status === 'unhealthy' ? 503 : 200;
      res.status(httpStatus).json({
        ...health,
        service: 'flipagent',
      });
    } else {
      // No DB available - just check memory
      const memCheck = healthChecker.checkMemory();
      res.json({
        status: memCheck.status === 'fail' ? 'unhealthy' : 'healthy',
        service: 'flipagent',
        timestamp: Date.now(),
        uptime: process.uptime() * 1000,
        checks: { memory: memCheck },
      });
    }
  });

  // ---------------------------------------------------------------------------
  // Auth middleware for protected routes
  // ---------------------------------------------------------------------------
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!config.authToken) return next();
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (typeof token !== 'string' || token.length !== config.authToken.length ||
        !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(config.authToken))) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };

  // ---------------------------------------------------------------------------
  // Metrics endpoint (auth-protected)
  // ---------------------------------------------------------------------------
  app.get('/metrics', requireAuth, (_req: Request, res: Response) => {
    res.json({
      requests: requestMetrics.getMetrics(),
      errors: errorTracker.getErrorCounts(),
      recentErrors: errorTracker.getRecent(10),
      memory: getMemorySnapshot(),
      uptime: process.uptime(),
    });
  });

  // ---------------------------------------------------------------------------
  // API routes
  // ---------------------------------------------------------------------------
  const db = callbacks?.db;

  app.get('/api/sessions', requireAuth, (_req: Request, res: Response) => {
    if (!db) return res.json({ sessions: [] });
    const sessions = db.listSessions();
    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        key: s.key,
        platform: s.platform,
        chatId: s.chatId,
        lastActivity: s.lastActivity,
        createdAt: s.createdAt,
      })),
    });
  });

  app.get('/api/opportunities', requireAuth, (req: Request, res: Response) => {
    if (!db) return res.json({ opportunities: [] });
    const limit = Math.min(Math.max(1, parseInt(req.query.limit as string) || 50), 200);
    const opportunities = db.getActiveOpportunities(limit);
    res.json({ opportunities });
  });

  app.get('/api/listings', requireAuth, (_req: Request, res: Response) => {
    if (!db) return res.json({ listings: [] });
    const listings = db.getActiveListings();
    res.json({ listings });
  });

  app.get('/api/orders', requireAuth, (req: Request, res: Response) => {
    if (!db) return res.json({ orders: [] });
    const status = req.query.status as string | undefined;
    const sql = status
      ? 'SELECT * FROM orders WHERE status = ? ORDER BY ordered_at DESC LIMIT 100'
      : 'SELECT * FROM orders ORDER BY ordered_at DESC LIMIT 100';
    const params = status ? [status] : [];
    const orders = db.query(sql, params);
    res.json({ orders });
  });

  app.get('/api/stats', requireAuth, (_req: Request, res: Response) => {
    if (!db) {
      return res.json({
        totalProducts: 0,
        activeOpportunities: 0,
        activeListings: 0,
        pendingOrders: 0,
        totalProfit: 0,
      });
    }
    const products = db.query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM products');
    const opps = db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM opportunities WHERE status = 'active'"
    );
    const listings = db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM listings WHERE status = 'active'"
    );
    const pending = db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM orders WHERE status = 'pending'"
    );
    const profitRow = db.query<{ total: number | null }>(
      'SELECT SUM(profit) as total FROM orders WHERE profit IS NOT NULL'
    );
    res.json({
      totalProducts: products[0]?.cnt ?? 0,
      activeOpportunities: opps[0]?.cnt ?? 0,
      activeListings: listings[0]?.cnt ?? 0,
      pendingOrders: pending[0]?.cnt ?? 0,
      totalProfit: profitRow[0]?.total ?? 0,
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Error-handling middleware (must be last middleware)
  // ---------------------------------------------------------------------------
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    // Track error for /metrics reporting
    errorTracker.track(err, {
      handler: `${req.method} ${req.path}`,
      extra: { method: req.method, path: req.path },
    });

    logger.error(
      { err: err.message, stack: err.stack, method: req.method, path: req.path },
      'Unhandled error in request handler'
    );

    if (res.headersSent) {
      return; // Can't send a response if headers already sent
    }

    const errRecord = err as unknown as Record<string, unknown>;
    const status = (typeof errRecord.status === 'number' ? errRecord.status : undefined) || (typeof errRecord.statusCode === 'number' ? errRecord.statusCode : undefined) || 500;
    res.status(status).json({
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    });
  });

  // ---------------------------------------------------------------------------
  // Create HTTP server
  // ---------------------------------------------------------------------------
  const server = http.createServer(app);

  // Create WebSocket server for chat
  const wss = new WebSocketServer({ server, path: '/chat' });

  wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
    if (callbacks?.onChatConnection) {
      callbacks.onChatConnection(ws, req);
    }
  });

  return {
    app,
    server,
    wss,
    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(config.port, '0.0.0.0', () => {
          logger.info({ port: config.port }, 'FlipAgent server started');
          resolve();
        });
      });
    },
    async stop(): Promise<void> {
      clearInterval(rateLimitCleanupInterval);
      return new Promise((resolve) => {
        wss.close(() => {
          server.close(() => {
            logger.info('FlipAgent server stopped');
            resolve();
          });
        });
      });
    },
  };
}
