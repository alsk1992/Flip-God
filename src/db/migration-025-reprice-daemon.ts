export const MIGRATION_025_UP = `
  CREATE TABLE IF NOT EXISTS reprice_daemon_config (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    last_run_at INTEGER,
    total_cycles INTEGER DEFAULT 0,
    total_reprices INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reprice_history (
    id TEXT PRIMARY KEY,
    daemon_config_id TEXT,
    listing_id TEXT NOT NULL,
    old_price REAL NOT NULL,
    new_price REAL NOT NULL,
    change_pct REAL NOT NULL,
    strategy TEXT NOT NULL,
    reason TEXT,
    platform TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_reprice_history_listing ON reprice_history(listing_id);
  CREATE INDEX IF NOT EXISTS idx_reprice_history_created ON reprice_history(created_at);
`;

export const MIGRATION_025_DOWN = `
  DROP INDEX IF EXISTS idx_reprice_history_created;
  DROP INDEX IF EXISTS idx_reprice_history_listing;
  DROP TABLE IF EXISTS reprice_history;
  DROP TABLE IF EXISTS reprice_daemon_config;
`;
