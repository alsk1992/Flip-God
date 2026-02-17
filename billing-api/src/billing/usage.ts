/**
 * Usage event recording and aggregation (analytics only — no billing)
 */
import { createLogger } from '../utils/logger';
import type { Db } from '../db';

const logger = createLogger('usage');

export interface UsageService {
  reportSale(params: {
    userId: string;
    apiKeyHash?: string;
    gmvCents: number;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ recorded: boolean }>;
  getUsageStats(userId: string, periodStart?: Date): Promise<{
    totalGmvCents: number;
    eventCount: number;
  }>;
}

export function createUsageService(db: Db): UsageService {
  return {
    async reportSale({ userId, apiKeyHash, gmvCents, idempotencyKey, metadata }) {
      // Find api_key_id from hash
      let apiKeyId: string | null = null;
      if (apiKeyHash) {
        const key = await db.queryOne<{ id: string }>(
          'SELECT id FROM api_keys WHERE key_hash = $1',
          [apiKeyHash],
        );
        apiKeyId = key?.id ?? null;
      }

      // Insert usage event (idempotency_key prevents duplicates)
      try {
        await db.query(
          `INSERT INTO usage_events (user_id, api_key_id, event_type, gmv_cents, fee_cents, metadata, idempotency_key)
           VALUES ($1, $2, 'sale_completed', $3, 0, $4, $5)`,
          [userId, apiKeyId, gmvCents, JSON.stringify(metadata ?? {}), idempotencyKey],
        );
      } catch (err: unknown) {
        // Duplicate idempotency key — already recorded
        if (err instanceof Error && err.message.includes('unique')) {
          logger.info({ idempotencyKey }, 'Duplicate usage event — already recorded');
          return { recorded: true };
        }
        throw err;
      }

      logger.info({ userId, gmvCents, idempotencyKey }, 'Sale usage recorded');
      return { recorded: true };
    },

    async getUsageStats(userId: string, periodStart?: Date) {
      const since = periodStart ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1); // Start of current month

      const result = await db.queryOne<{
        total_gmv: string;
        event_count: string;
      }>(
        `SELECT
           COALESCE(SUM(gmv_cents), 0) as total_gmv,
           COUNT(*) as event_count
         FROM usage_events
         WHERE user_id = $1 AND created_at >= $2`,
        [userId, since.toISOString()],
      );

      return {
        totalGmvCents: parseInt(result?.total_gmv ?? '0', 10),
        eventCount: parseInt(result?.event_count ?? '0', 10),
      };
    },
  };
}
