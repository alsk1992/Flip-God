/**
 * Database — Postgres pool + typed query helpers
 */
import { Pool, PoolClient } from 'pg';
import { createLogger } from '../utils/logger';

const logger = createLogger('db');

export interface Db {
  pool: Pool;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  queryOne<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T | null>;
  transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createDb(connectionString: string): Db {
  const pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  pool.on('error', (err) => {
    logger.error({ err: err.message }, 'Unexpected pool error');
  });

  return {
    pool,

    async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      const result = await pool.query(sql, params);
      return result.rows as T[];
    },

    async queryOne<T extends Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
      const result = await pool.query(sql, params);
      return (result.rows[0] as T) ?? null;
    },

    async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },

    async close() {
      await pool.end();
      logger.info('Database pool closed');
    },
  };
}
