/**
 * Express server factory — assembles middleware stack and routes
 */
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { createLogger } from './utils/logger';
import type { AppConfig } from './config';
import type { Db } from './db';
import type { AuthService } from './auth';
import type { JwtService } from './auth/jwt';
import type { UsageService } from './billing/usage';
import { requireAuth, requireApiKey } from './auth/middleware';
import { createAuthRoutes } from './api/auth.routes';
import { createKeysRoutes } from './api/keys.routes';
import { createValidateRoutes } from './api/validate.routes';
import { createBillingRoutes } from './api/billing.routes';
import { createPremiumRoutes } from './api/premium.routes';
import { createWalletRoutes } from './api/wallet.routes';
import type { SolanaTokenGate } from './billing/solana';

const logger = createLogger('server');

export interface ServerDeps {
  config: AppConfig;
  db: Db;
  authService: AuthService;
  jwtService: JwtService;
  usageService: UsageService;
  tokenGate?: SolanaTokenGate;
}

export function createServer(deps: ServerDeps) {
  const { config, db, authService, jwtService, usageService, tokenGate } = deps;
  const app = express();

  // ---------------------------------------------------------------------------
  // CORS
  // ---------------------------------------------------------------------------
  const allowedOrigins = config.corsOrigins
    ? config.corsOrigins.split(',').map((s) => s.trim()).filter(Boolean)
    : [];

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (allowedOrigins.length === 0) {
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // ---------------------------------------------------------------------------
  // Security headers
  // ---------------------------------------------------------------------------
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  // ---------------------------------------------------------------------------
  // Request logging (strip API keys from logs)
  // ---------------------------------------------------------------------------
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[level](
        { method: req.method, path: req.path, status: res.statusCode, duration },
        '%s %s %d %dms',
        req.method, req.path, res.statusCode, duration,
      );
    });
    next();
  });

  // ---------------------------------------------------------------------------
  // Health check (open, no auth)
  // ---------------------------------------------------------------------------
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      await db.query('SELECT 1');
      res.json({ status: 'healthy', service: 'flipgod-billing', timestamp: Date.now() });
    } catch {
      res.status(503).json({ status: 'unhealthy', service: 'flipgod-billing', timestamp: Date.now() });
    }
  });

  // ---------------------------------------------------------------------------
  // JSON body parser
  // ---------------------------------------------------------------------------
  app.use(express.json({ limit: '1mb' }));

  // ---------------------------------------------------------------------------
  // Public routes (no auth)
  // ---------------------------------------------------------------------------
  app.use('/auth', createAuthRoutes(authService, db));

  // ---------------------------------------------------------------------------
  // API key-authenticated routes
  // ---------------------------------------------------------------------------
  const apiKeyAuth = requireApiKey(db);
  app.use('/validate', apiKeyAuth, createValidateRoutes());
  app.use('/premium', apiKeyAuth, createPremiumRoutes(usageService));

  // ---------------------------------------------------------------------------
  // JWT-authenticated routes
  // ---------------------------------------------------------------------------
  const jwtAuth = requireAuth(jwtService);
  app.use('/keys', jwtAuth, createKeysRoutes(db));
  app.use('/billing', jwtAuth, createBillingRoutes(usageService));

  // Wallet routes (token-gated access via Solana)
  if (tokenGate) {
    app.use('/wallet', jwtAuth, createWalletRoutes(tokenGate, db));
  }

  // ---------------------------------------------------------------------------
  // Error handler (must be last)
  // ---------------------------------------------------------------------------
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: err.message, method: req.method, path: req.path }, 'Unhandled error');
    if (res.headersSent) return;
    const status = (err as unknown as { status?: number }).status ?? 500;
    res.status(status).json({
      error: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
    });
  });

  // ---------------------------------------------------------------------------
  // Create HTTP server
  // ---------------------------------------------------------------------------
  const server = http.createServer(app);

  return {
    app,
    server,
    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(config.port, '0.0.0.0', () => {
          logger.info({ port: config.port }, 'FlipGod billing API started');
          resolve();
        });
      });
    },
    async stop(): Promise<void> {
      return new Promise((resolve) => {
        server.close(() => {
          logger.info('FlipGod billing API stopped');
          resolve();
        });
      });
    },
  };
}
