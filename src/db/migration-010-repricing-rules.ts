/**
 * Migration 010: Smart Repricing Rules (v2) and History
 *
 * Creates repricing_rules_v2 table (separate from the existing repricing_rules
 * in migration 5) with user-level rules, priority, SKU pattern matching,
 * and category/platform filters.
 *
 * Also creates repricing_history table for audit trail.
 */

export const MIGRATION_010_UP = `
  -- Smart repricing rules (v2) with user-scoped, priority-ordered rules
  CREATE TABLE IF NOT EXISTS repricing_rules_v2 (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'all',
    category TEXT,
    sku_pattern TEXT,
    params TEXT NOT NULL DEFAULT '{}',
    priority INTEGER NOT NULL DEFAULT 50,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_repricing_rules_v2_user ON repricing_rules_v2(user_id);
  CREATE INDEX IF NOT EXISTS idx_repricing_rules_v2_type ON repricing_rules_v2(type);
  CREATE INDEX IF NOT EXISTS idx_repricing_rules_v2_platform ON repricing_rules_v2(platform);
  CREATE INDEX IF NOT EXISTS idx_repricing_rules_v2_enabled ON repricing_rules_v2(enabled);
  CREATE INDEX IF NOT EXISTS idx_repricing_rules_v2_priority ON repricing_rules_v2(priority);

  -- Repricing change history (audit trail)
  CREATE TABLE IF NOT EXISTS repricing_history (
    id TEXT PRIMARY KEY,
    listing_id TEXT NOT NULL,
    rule_id TEXT,
    rule_name TEXT,
    old_price REAL NOT NULL,
    new_price REAL NOT NULL,
    reason TEXT NOT NULL,
    dry_run INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_repricing_history_listing ON repricing_history(listing_id);
  CREATE INDEX IF NOT EXISTS idx_repricing_history_rule ON repricing_history(rule_id);
  CREATE INDEX IF NOT EXISTS idx_repricing_history_created ON repricing_history(created_at);
`;

export const MIGRATION_010_DOWN = `
  DROP TABLE IF EXISTS repricing_history;
  DROP TABLE IF EXISTS repricing_rules_v2;
`;
