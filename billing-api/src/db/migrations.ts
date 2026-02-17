/**
 * Sequential migration runner for Postgres
 */
import { createLogger } from '../utils/logger';
import type { Db } from './index';

const logger = createLogger('migrations');

interface Migration {
  id: number;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    id: 1,
    name: 'users_and_api_keys',
    sql: `
      CREATE TABLE IF NOT EXISTS billing_users (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name  TEXT,
        plan          TEXT NOT NULL DEFAULT 'free',
        status        TEXT NOT NULL DEFAULT 'active',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       UUID NOT NULL REFERENCES billing_users(id) ON DELETE CASCADE,
        key_prefix    TEXT NOT NULL,
        key_hash      TEXT NOT NULL UNIQUE,
        name          TEXT DEFAULT 'Default',
        status        TEXT NOT NULL DEFAULT 'active',
        last_used_at  TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    `,
  },
  {
    id: 2,
    name: 'usage_events',
    sql: `
      CREATE TABLE IF NOT EXISTS usage_events (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL REFERENCES billing_users(id),
        api_key_id      UUID REFERENCES api_keys(id),
        event_type      TEXT NOT NULL,
        gmv_cents       BIGINT NOT NULL DEFAULT 0,
        fee_cents       BIGINT NOT NULL DEFAULT 0,
        metadata        JSONB DEFAULT '{}',
        idempotency_key TEXT UNIQUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(user_id);
      CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at);
    `,
  },
  {
    id: 3,
    name: 'audit_log',
    sql: `
      CREATE TABLE IF NOT EXISTS audit_log (
        id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id   UUID REFERENCES billing_users(id),
        action    TEXT NOT NULL,
        ip_address TEXT,
        metadata  JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `,
  },
  {
    id: 4,
    name: 'solana_wallet_token_gate',
    sql: `
      ALTER TABLE billing_users ADD COLUMN IF NOT EXISTS solana_wallet TEXT UNIQUE;
      ALTER TABLE billing_users ADD COLUMN IF NOT EXISTS token_balance NUMERIC;
      ALTER TABLE billing_users ADD COLUMN IF NOT EXISTS token_verified_at TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_billing_users_wallet ON billing_users(solana_wallet) WHERE solana_wallet IS NOT NULL;
    `,
  },
];

export async function runMigrations(db: Db): Promise<void> {
  // Create migrations tracking table
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id   INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const applied = await db.query<{ id: number }>('SELECT id FROM _migrations ORDER BY id');
  const appliedIds = new Set(applied.map((r) => r.id));

  for (const migration of migrations) {
    if (appliedIds.has(migration.id)) continue;

    logger.info({ id: migration.id, name: migration.name }, 'Running migration');
    await db.query(migration.sql);
    await db.query('INSERT INTO _migrations (id, name) VALUES ($1, $2)', [
      migration.id,
      migration.name,
    ]);
    logger.info({ id: migration.id, name: migration.name }, 'Migration applied');
  }

  logger.info('All migrations up to date');
}
