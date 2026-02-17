/**
 * Auth routes — /auth/register, /auth/login, /auth/refresh
 */
import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import type { AuthService } from '../auth';
import type { Db } from '../db';

const logger = createLogger('auth-routes');

export function createAuthRoutes(authService: AuthService, db: Db): Router {
  const router = Router();

  router.post('/register', async (req: Request, res: Response) => {
    try {
      const result = await authService.register(req.body);

      // Audit log
      db.query(
        'INSERT INTO audit_log (user_id, action, ip_address) VALUES ($1, $2, $3)',
        [result.user.id, 'register', req.ip ?? ''],
      ).catch(() => {});

      res.status(201).json(result);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status ?? 500;
      const message = err instanceof Error ? err.message : 'Registration failed';
      logger.error({ err: message, stack: err instanceof Error ? err.stack : undefined }, 'Registration error');
      res.status(status).json({ error: message });
    }
  });

  router.post('/login', async (req: Request, res: Response) => {
    try {
      const result = await authService.login(req.body);

      // Audit log
      db.query(
        'INSERT INTO audit_log (user_id, action, ip_address) VALUES ($1, $2, $3)',
        [result.user.id, 'login', req.ip ?? ''],
      ).catch(() => {});

      res.json(result);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status ?? 401;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Login failed' });
    }
  });

  router.post('/refresh', async (req: Request, res: Response) => {
    try {
      const { refreshToken } = req.body as { refreshToken?: string };
      if (!refreshToken || typeof refreshToken !== 'string') {
        res.status(400).json({ error: 'refreshToken is required' });
        return;
      }
      const tokens = await authService.refresh(refreshToken);
      res.json(tokens);
    } catch (err: unknown) {
      const status = (err as { status?: number }).status ?? 401;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Token refresh failed' });
    }
  });

  return router;
}
