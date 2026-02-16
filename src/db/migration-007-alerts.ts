/**
 * Migration 007 - Alerts & Alert Rules
 *
 * Creates tables for price/stock alert notifications and user-defined alert rules.
 */

export const MIGRATION_007_UP = `
  -- Alert notifications
  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    product_id TEXT,
    platform TEXT,
    old_value REAL,
    new_value REAL,
    threshold REAL,
    message TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
  CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(type);
  CREATE INDEX IF NOT EXISTS idx_alerts_read ON alerts(user_id, read);
  CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);
  CREATE INDEX IF NOT EXISTS idx_alerts_product ON alerts(product_id);

  -- User-defined alert rules
  CREATE TABLE IF NOT EXISTS alert_rules (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    platform TEXT,
    category TEXT,
    threshold_pct REAL,
    threshold_abs REAL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_alert_rules_user ON alert_rules(user_id);
  CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(user_id, enabled);
`;

export const MIGRATION_007_DOWN = `
  DROP TABLE IF EXISTS alert_rules;
  DROP TABLE IF EXISTS alerts;
`;
