/**
 * Migration 019 - Dynamic Pricing & A/B Price Testing
 *
 * Creates tables for A/B price tests and dynamic pricing change logs.
 */

export const MIGRATION_019_UP = `
  -- A/B price tests
  CREATE TABLE IF NOT EXISTS price_tests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    price_a REAL NOT NULL,
    price_b REAL NOT NULL,
    views_a INTEGER NOT NULL DEFAULT 0,
    views_b INTEGER NOT NULL DEFAULT 0,
    sales_a INTEGER NOT NULL DEFAULT 0,
    sales_b INTEGER NOT NULL DEFAULT 0,
    revenue_a REAL NOT NULL DEFAULT 0,
    revenue_b REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    winner TEXT,
    started_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    ended_at INTEGER,
    duration_days INTEGER NOT NULL DEFAULT 7,
    max_impressions INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_price_tests_user ON price_tests(user_id);
  CREATE INDEX IF NOT EXISTS idx_price_tests_listing ON price_tests(listing_id);
  CREATE INDEX IF NOT EXISTS idx_price_tests_status ON price_tests(status);

  -- Dynamic pricing change log
  CREATE TABLE IF NOT EXISTS dynamic_price_log (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    old_price REAL NOT NULL,
    new_price REAL NOT NULL,
    strategy TEXT NOT NULL,
    reason TEXT NOT NULL,
    params TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_dynamic_price_log_listing ON dynamic_price_log(listing_id);
  CREATE INDEX IF NOT EXISTS idx_dynamic_price_log_strategy ON dynamic_price_log(strategy);
  CREATE INDEX IF NOT EXISTS idx_dynamic_price_log_created ON dynamic_price_log(created_at);

  -- Dynamic pricing strategies (active strategy per listing)
  CREATE TABLE IF NOT EXISTS dynamic_pricing_strategies (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL UNIQUE,
    strategy TEXT NOT NULL,
    params TEXT NOT NULL DEFAULT '{}',
    min_price REAL,
    max_price REAL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_run_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_dynamic_pricing_listing ON dynamic_pricing_strategies(listing_id);
  CREATE INDEX IF NOT EXISTS idx_dynamic_pricing_enabled ON dynamic_pricing_strategies(enabled);
`;

export const MIGRATION_019_DOWN = `
  DROP TABLE IF EXISTS dynamic_pricing_strategies;
  DROP TABLE IF EXISTS dynamic_price_log;
  DROP TABLE IF EXISTS price_tests;
`;
