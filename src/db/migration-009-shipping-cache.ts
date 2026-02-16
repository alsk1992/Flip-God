/**
 * Migration 009 - Shipping Rate Cache
 *
 * Creates table for caching shipping rate lookups with TTL-based expiration.
 */

export const MIGRATION_009_UP = `
  -- Shipping rate cache with TTL
  CREATE TABLE IF NOT EXISTS shipping_rate_cache (
    id TEXT PRIMARY KEY,
    origin_zip TEXT NOT NULL,
    dest_zip TEXT NOT NULL,
    weight_oz REAL NOT NULL,
    dimensions TEXT,
    carrier TEXT NOT NULL,
    service TEXT NOT NULL,
    rate_cents INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_shipping_cache_lookup ON shipping_rate_cache(origin_zip, dest_zip, weight_oz, carrier);
  CREATE INDEX IF NOT EXISTS idx_shipping_cache_expires ON shipping_rate_cache(expires_at);
`;

export const MIGRATION_009_DOWN = `
  DROP TABLE IF EXISTS shipping_rate_cache;
`;
