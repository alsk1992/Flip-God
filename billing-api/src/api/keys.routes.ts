/**
 * API Key routes — /keys CRUD (create, list, revoke, rotate)
 */
import { Router, Request, Response } from 'express';
import { generateApiKey } from '../utils/crypto';
import type { Db } from '../db';

export function createKeysRoutes(db: Db): Router {
  const router = Router();

  // POST /keys — Create a new API key (returns full key ONCE)
  router.post('/', async (req: Request, res: Response) => {
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const { name } = req.body as { name?: string };

    // Limit to 5 active keys per user
    const existing = await db.query<{ cnt: string }>(
      "SELECT COUNT(*) as cnt FROM api_keys WHERE user_id = $1 AND status = 'active'",
      [userId],
    );
    if (parseInt(existing[0]?.cnt ?? '0', 10) >= 5) {
      res.status(400).json({ error: 'Maximum 5 active API keys per account' });
      return;
    }

    const { fullKey, prefix, hash } = generateApiKey();

    await db.query(
      'INSERT INTO api_keys (user_id, key_prefix, key_hash, name) VALUES ($1, $2, $3, $4)',
      [userId, prefix, hash, name ?? 'Default'],
    );

    // Audit log
    db.query(
      "INSERT INTO audit_log (user_id, action, ip_address, metadata) VALUES ($1, 'api_key_created', $2, $3)",
      [userId, req.ip ?? '', JSON.stringify({ prefix })],
    ).catch(() => {});

    res.status(201).json({
      key: fullKey,
      prefix,
      name: name ?? 'Default',
      message: 'Save this key — it will not be shown again.',
    });
  });

  // GET /keys — List keys (prefix only)
  router.get('/', async (req: Request, res: Response) => {
    const userId = (req as unknown as Record<string, unknown>).userId as string;

    const keys = await db.query<{
      id: string;
      key_prefix: string;
      name: string;
      status: string;
      last_used_at: string | null;
      created_at: string;
    }>(
      'SELECT id, key_prefix, name, status, last_used_at, created_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );

    res.json({
      keys: keys.map((k) => ({
        id: k.id,
        prefix: k.key_prefix,
        name: k.name,
        status: k.status,
        lastUsedAt: k.last_used_at,
        createdAt: k.created_at,
      })),
    });
  });

  // DELETE /keys/:id — Revoke key
  router.delete('/:id', async (req: Request, res: Response) => {
    const userId = (req as unknown as Record<string, unknown>).userId as string;

    const result = await db.query(
      "UPDATE api_keys SET status = 'revoked' WHERE id = $1 AND user_id = $2 AND status = 'active' RETURNING id",
      [req.params.id, userId],
    );

    if (result.length === 0) {
      res.status(404).json({ error: 'Key not found or already revoked' });
      return;
    }

    // Audit log
    db.query(
      "INSERT INTO audit_log (user_id, action, ip_address, metadata) VALUES ($1, 'api_key_revoked', $2, $3)",
      [userId, req.ip ?? '', JSON.stringify({ keyId: req.params.id })],
    ).catch(() => {});

    res.json({ status: 'revoked' });
  });

  // POST /keys/:id/rotate — Revoke old + create new atomically
  router.post('/:id/rotate', async (req: Request, res: Response) => {
    const userId = (req as unknown as Record<string, unknown>).userId as string;

    try {
      const result = await db.transaction(async (client) => {
        // Revoke old key
        const old = await client.query(
          "UPDATE api_keys SET status = 'revoked' WHERE id = $1 AND user_id = $2 AND status = 'active' RETURNING name",
          [req.params.id, userId],
        );

        if (old.rows.length === 0) {
          throw Object.assign(new Error('Key not found or already revoked'), { status: 404 });
        }

        const keyName = old.rows[0].name;
        const { fullKey, prefix, hash } = generateApiKey();

        await client.query(
          'INSERT INTO api_keys (user_id, key_prefix, key_hash, name) VALUES ($1, $2, $3, $4)',
          [userId, prefix, hash, keyName],
        );

        return { fullKey, prefix, name: keyName };
      });

      // Audit log
      db.query(
        "INSERT INTO audit_log (user_id, action, ip_address, metadata) VALUES ($1, 'api_key_rotated', $2, $3)",
        [userId, req.ip ?? '', JSON.stringify({ oldKeyId: req.params.id, newPrefix: result.prefix })],
      ).catch(() => {});

      res.status(201).json({
        key: result.fullKey,
        prefix: result.prefix,
        name: result.name,
        message: 'Old key revoked. Save this new key — it will not be shown again.',
      });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status ?? 500;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Rotation failed' });
    }
  });

  return router;
}
