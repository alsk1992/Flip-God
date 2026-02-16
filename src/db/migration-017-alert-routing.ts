/**
 * Migration 017 - Alert Routing Rules
 *
 * Creates table for per-channel alert routing configuration.
 * Routes alert types to specific notification channels (email, webhook, discord, slack, console).
 */

export const MIGRATION_017_UP = `
  CREATE TABLE IF NOT EXISTS alert_routing_rules (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    channel TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    priority INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_routing_rules_user ON alert_routing_rules(user_id);
  CREATE INDEX IF NOT EXISTS idx_routing_rules_user_enabled ON alert_routing_rules(user_id, enabled);
  CREATE INDEX IF NOT EXISTS idx_routing_rules_alert_type ON alert_routing_rules(alert_type);
`;

export const MIGRATION_017_DOWN = `
  DROP TABLE IF EXISTS alert_routing_rules;
`;
