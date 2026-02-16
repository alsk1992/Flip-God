/**
 * Migration 018 - Messaging, Templates, and Auto-Responder
 *
 * Creates tables for:
 * - messages: buyer/seller communication across platforms
 * - message_templates: reusable message templates
 * - auto_responder_rules: keyword-based automatic replies
 */

export const MIGRATION_018_UP = `
  -- Buyer/seller messages
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT,
    order_id TEXT,
    direction TEXT NOT NULL DEFAULT 'inbound',
    sender TEXT,
    recipient TEXT,
    subject TEXT,
    body TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
  CREATE INDEX IF NOT EXISTS idx_messages_order ON messages(order_id);
  CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(user_id, read);
  CREATE INDEX IF NOT EXISTS idx_messages_platform ON messages(platform);
  CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

  -- Reusable message templates
  CREATE TABLE IF NOT EXISTS message_templates (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    subject TEXT,
    body TEXT NOT NULL,
    variables TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_templates_user ON message_templates(user_id);
  CREATE INDEX IF NOT EXISTS idx_templates_name ON message_templates(user_id, name);

  -- Auto-responder keyword rules
  CREATE TABLE IF NOT EXISTS auto_responder_rules (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    keywords TEXT NOT NULL DEFAULT '[]',
    template_id TEXT,
    template_name TEXT,
    delay_minutes INTEGER NOT NULL DEFAULT 5,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_auto_responder_user ON auto_responder_rules(user_id);
  CREATE INDEX IF NOT EXISTS idx_auto_responder_enabled ON auto_responder_rules(user_id, enabled);
`;

export const MIGRATION_018_DOWN = `
  DROP TABLE IF EXISTS auto_responder_rules;
  DROP TABLE IF EXISTS message_templates;
  DROP TABLE IF EXISTS messages;
`;
