/**
 * Migration 030 - Multi-Channel Inventory Sync
 *
 * Adds channel_mappings, channel_entries, sync_events, and sync_daemon_config
 * tables to support real-time inventory synchronization across selling platforms
 * (Amazon, eBay, Walmart, etc.) to prevent overselling.
 */

export const MIGRATION_030_UP = `
  -- Channel mappings: SKU-level inventory mapping across platforms
  CREATE TABLE IF NOT EXISTS channel_mappings (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL,
    product_id TEXT,
    total_quantity INTEGER NOT NULL DEFAULT 0,
    reserved_quantity INTEGER NOT NULL DEFAULT 0,
    sync_enabled INTEGER DEFAULT 1,
    last_sync_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_mappings_sku ON channel_mappings(sku);

  -- Channel entries: individual platform listings linked to a SKU mapping
  CREATE TABLE IF NOT EXISTS channel_entries (
    id TEXT PRIMARY KEY,
    mapping_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    platform_sku TEXT,
    quantity INTEGER NOT NULL DEFAULT 0,
    last_pushed_quantity INTEGER DEFAULT 0,
    last_push_at INTEGER,
    FOREIGN KEY (mapping_id) REFERENCES channel_mappings(id)
  );
  CREATE INDEX IF NOT EXISTS idx_channel_entries_mapping ON channel_entries(mapping_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_entries_platform_listing ON channel_entries(platform, listing_id);

  -- Sync events: audit log of all inventory changes
  CREATE TABLE IF NOT EXISTS sync_events (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL,
    event_type TEXT NOT NULL,
    platform TEXT NOT NULL,
    quantity_change INTEGER NOT NULL,
    previous_quantity INTEGER NOT NULL,
    new_quantity INTEGER NOT NULL,
    details TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sync_events_sku ON sync_events(sku);
  CREATE INDEX IF NOT EXISTS idx_sync_events_created ON sync_events(created_at);

  -- Sync daemon configuration (singleton row keyed by 'default')
  CREATE TABLE IF NOT EXISTS sync_daemon_config (
    id TEXT PRIMARY KEY DEFAULT 'default',
    config TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    last_run_at INTEGER,
    total_syncs INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`;

export const MIGRATION_030_DOWN = `
  DROP TABLE IF EXISTS sync_daemon_config;
  DROP INDEX IF EXISTS idx_sync_events_created;
  DROP INDEX IF EXISTS idx_sync_events_sku;
  DROP TABLE IF EXISTS sync_events;
  DROP INDEX IF EXISTS idx_channel_entries_platform_listing;
  DROP INDEX IF EXISTS idx_channel_entries_mapping;
  DROP TABLE IF EXISTS channel_entries;
  DROP INDEX IF EXISTS idx_channel_mappings_sku;
  DROP TABLE IF EXISTS channel_mappings;
`;
