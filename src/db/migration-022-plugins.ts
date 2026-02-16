/**
 * Migration 022 - Plugin Registry (DB-backed)
 *
 * Creates a table for persisting installed plugins and their configuration,
 * complementing the in-memory plugin service with durable state.
 */

export const MIGRATION_022_UP = `
  -- Installed plugins registry
  CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0.0',
    description TEXT,
    author TEXT,
    hooks TEXT NOT NULL DEFAULT '{}',
    config TEXT NOT NULL DEFAULT '{}',
    enabled INTEGER NOT NULL DEFAULT 0,
    installed_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_plugins_enabled ON plugins(enabled);

  -- Shared repricing rule packs
  CREATE TABLE IF NOT EXISTS shared_rule_packs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    version TEXT NOT NULL DEFAULT '1.0.0',
    author TEXT,
    rules TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
`;

export const MIGRATION_022_DOWN = `
  DROP TABLE IF EXISTS shared_rule_packs;
  DROP TABLE IF EXISTS plugins;
`;
