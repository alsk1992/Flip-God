/**
 * Auth middleware — JWT bearer and X-API-Key header
 */
import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../utils/logger';
import { hashApiKey } from '../utils/crypto';
import type { JwtService } from './jwt';
import type { Db } from '../db';

const logger = createLogger('auth-middleware');

// LRU cache for API key validation
interface CacheEntry {
  userId: string;
  plan: string;
  expiresAt: number;
}

const apiKeyCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000; // 60 seconds
const CACHE_MAX_SIZE = 10_000;

function cleanupCache() {
  if (apiKeyCache.size <= CACHE_MAX_SIZE) return;
  const now = Date.now();
  for (const [key, entry] of apiKeyCache) {
    if (entry.expiresAt < now) apiKeyCache.delete(key);
  }
  // If still over limit, delete oldest entries
  if (apiKeyCache.size > CACHE_MAX_SIZE) {
    const entries = Array.from(apiKeyCache.entries());
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toRemove = entries.slice(0, entries.length - CACHE_MAX_SIZE);
    for (const [key] of toRemove) apiKeyCache.delete(key);
  }
}

// Periodic cleanup
setInterval(cleanupCache, 5 * 60_000).unref();

/** Middleware: require JWT Bearer token */
export function requireAuth(jwtService: JwtService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.slice(7);
    try {
      const payload = jwtService.verifyAccessToken(token);
      (req as unknown as Record<string, unknown>).userId = payload.userId;
      (req as unknown as Record<string, unknown>).userEmail = payload.email;
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

/** Middleware: require X-API-Key header */
export function requireApiKey(db: Db) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'];
    if (typeof apiKey !== 'string' || !apiKey.startsWith('fg_live_')) {
      res.status(401).json({ error: 'Missing or invalid API key' });
      return;
    }

    const keyHash = hashApiKey(apiKey);

    // Check cache first
    const cached = apiKeyCache.get(keyHash);
    if (cached && cached.expiresAt > Date.now()) {
      (req as unknown as Record<string, unknown>).userId = cached.userId;
      (req as unknown as Record<string, unknown>).userPlan = cached.plan;
      (req as unknown as Record<string, unknown>).apiKeyHash = keyHash;
      next();
      return;
    }

    try {
      const row = await db.queryOne<{
        id: string;
        user_id: string;
        status: string;
      }>(
        'SELECT ak.id, ak.user_id, ak.status FROM api_keys ak WHERE ak.key_hash = $1',
        [keyHash],
      );

      if (!row || row.status !== 'active') {
        res.status(401).json({ error: 'Invalid or revoked API key' });
        return;
      }

      const user = await db.queryOne<{ plan: string; status: string; solana_wallet: string | null }>(
        'SELECT plan, status, solana_wallet FROM billing_users WHERE id = $1',
        [row.user_id],
      );

      if (!user || user.status !== 'active') {
        res.status(403).json({ error: 'Account suspended' });
        return;
      }

      // Effective plan: token_holder and premium both grant full access
      const effectivePlan = user.plan === 'token_holder' ? 'premium' : user.plan;

      // Update last_used_at (fire-and-forget)
      db.query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [row.id]).catch((err) => {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Failed to update last_used_at');
      });

      // Cache the result
      apiKeyCache.set(keyHash, {
        userId: row.user_id,
        plan: effectivePlan,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      (req as unknown as Record<string, unknown>).userId = row.user_id;
      (req as unknown as Record<string, unknown>).userPlan = effectivePlan;
      (req as unknown as Record<string, unknown>).userPlanSource = user.plan === 'token_holder' ? 'token' : 'free';
      (req as unknown as Record<string, unknown>).apiKeyHash = keyHash;
      next();
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'API key validation error');
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
