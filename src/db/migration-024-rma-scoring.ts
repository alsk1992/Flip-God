export const MIGRATION_024_UP = `
  CREATE TABLE IF NOT EXISTS rma_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rma_number TEXT NOT NULL UNIQUE,
    order_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reason TEXT,
    approved INTEGER,
    restocking_fee_pct REAL DEFAULT 0,
    notes TEXT,
    items_json TEXT,
    received_items_json TEXT,
    condition_verified INTEGER DEFAULT 0,
    refund_amount REAL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_rma_number ON rma_requests(rma_number);
  CREATE INDEX IF NOT EXISTS idx_rma_order ON rma_requests(order_id);
  CREATE INDEX IF NOT EXISTS idx_rma_status ON rma_requests(status);

  CREATE TABLE IF NOT EXISTS product_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    overall_score REAL,
    demand_score REAL,
    competition_score REAL,
    margin_score REAL,
    trend_score REAL,
    risk_score REAL,
    scored_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_scores_product ON product_scores(product_id);
  CREATE INDEX IF NOT EXISTS idx_scores_overall ON product_scores(overall_score);

  CREATE TABLE IF NOT EXISTS niche_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    keywords_json TEXT,
    saturation_index REAL,
    niche_score REAL,
    avg_bsr REAL,
    avg_price REAL,
    seller_count INTEGER,
    monthly_revenue_est REAL,
    recommendation TEXT,
    analyzed_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_niche_category ON niche_analyses(category);
`;

export const MIGRATION_024_DOWN = `
  DROP TABLE IF EXISTS niche_analyses;
  DROP TABLE IF EXISTS product_scores;
  DROP TABLE IF EXISTS rma_requests;
`;
