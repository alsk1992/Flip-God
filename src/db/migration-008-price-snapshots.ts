/**
 * Migration 008 - Competitor Price Snapshots
 *
 * Creates table for historical competitor price tracking and trend analysis.
 */

export const MIGRATION_008_UP = `
  -- Competitor price snapshots for trend analysis
  CREATE TABLE IF NOT EXISTS price_snapshots (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    price REAL NOT NULL,
    seller TEXT,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_price_snapshots_product ON price_snapshots(product_id);
  CREATE INDEX IF NOT EXISTS idx_price_snapshots_platform ON price_snapshots(platform);
  CREATE INDEX IF NOT EXISTS idx_price_snapshots_product_platform ON price_snapshots(product_id, platform);
  CREATE INDEX IF NOT EXISTS idx_price_snapshots_timestamp ON price_snapshots(timestamp);
`;

export const MIGRATION_008_DOWN = `
  DROP TABLE IF EXISTS price_snapshots;
`;
