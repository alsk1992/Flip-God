/**
 * HTTP + WebSocket Server for FlipAgent
 */

import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { createLogger } from '../utils/logger';
import type { Database } from '../db';

const logger = createLogger('server');

export interface ServerConfig {
  port: number;
  authToken?: string;
}

export interface ServerCallbacks {
  onChatConnection?: (ws: WebSocket, req: http.IncomingMessage) => void;
  db?: Database;
}

export function createServer(config: ServerConfig, callbacks?: ServerCallbacks) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Health check (always open)
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'flipagent', timestamp: new Date().toISOString() });
  });

  // Auth middleware for protected routes
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!config.authToken) return next();
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (token !== config.authToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };

  // API routes
  const db = callbacks?.db;

  app.get('/api/sessions', requireAuth, (_req: Request, res: Response) => {
    if (!db) return res.json({ sessions: [] });
    const sessions = db.listSessions();
    res.json({ sessions: sessions.map(s => ({ id: s.id, key: s.key, platform: s.platform, chatId: s.chatId, lastActivity: s.lastActivity, createdAt: s.createdAt })) });
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
      return res.json({ totalProducts: 0, activeOpportunities: 0, activeListings: 0, pendingOrders: 0, totalProfit: 0 });
    }
    const products = db.query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM products');
    const opps = db.query<{ cnt: number }>("SELECT COUNT(*) as cnt FROM opportunities WHERE status = 'active'");
    const listings = db.query<{ cnt: number }>("SELECT COUNT(*) as cnt FROM listings WHERE status = 'active'");
    const pending = db.query<{ cnt: number }>("SELECT COUNT(*) as cnt FROM orders WHERE status = 'pending'");
    const profitRow = db.query<{ total: number | null }>('SELECT SUM(profit) as total FROM orders WHERE profit IS NOT NULL');
    res.json({
      totalProducts: products[0]?.cnt ?? 0,
      activeOpportunities: opps[0]?.cnt ?? 0,
      activeListings: listings[0]?.cnt ?? 0,
      pendingOrders: pending[0]?.cnt ?? 0,
      totalProfit: profitRow[0]?.total ?? 0,
    });
  });

  // Create HTTP server
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
