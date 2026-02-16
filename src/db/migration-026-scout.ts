export const MIGRATION_026_UP = `
  CREATE TABLE IF NOT EXISTS scout_configs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    config TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    last_run_at INTEGER,
    total_runs INTEGER DEFAULT 0,
    total_opportunities_found INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scout_queue (
    id TEXT PRIMARY KEY,
    scout_config_id TEXT NOT NULL,
    product_id TEXT,
    source_platform TEXT NOT NULL,
    target_platform TEXT NOT NULL,
    source_price REAL NOT NULL,
    target_price REAL,
    estimated_margin_pct REAL,
    estimated_profit REAL,
    product_name TEXT,
    product_url TEXT,
    image_url TEXT,
    category TEXT,
    status TEXT DEFAULT 'pending',
    reviewed_at INTEGER,
    listed_at INTEGER,
    listing_id TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_scout_queue_status ON scout_queue(status);
  CREATE INDEX IF NOT EXISTS idx_scout_queue_config ON scout_queue(scout_config_id);
`;

export const MIGRATION_026_DOWN = `
  DROP TABLE IF EXISTS scout_queue;
  DROP TABLE IF EXISTS scout_configs;
`;
