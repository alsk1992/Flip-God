/**
 * Migration 027 - Demand Scoring
 *
 * Creates tables for demand scoring model and scan frequency tracking.
 */

export const MIGRATION_027_UP = `
  CREATE TABLE IF NOT EXISTS demand_scores (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    overall_score REAL NOT NULL,
    signals TEXT NOT NULL,
    recommendation TEXT NOT NULL,
    confidence REAL NOT NULL,
    insights TEXT NOT NULL,
    calculated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_demand_scores_product ON demand_scores(product_id);
  CREATE INDEX IF NOT EXISTS idx_demand_scores_score ON demand_scores(overall_score);

  CREATE TABLE IF NOT EXISTS scan_frequency (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL UNIQUE,
    scan_count INTEGER DEFAULT 0,
    last_seen_at INTEGER,
    first_seen_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_scan_frequency_product ON scan_frequency(product_id);
`;

export const MIGRATION_027_DOWN = `
  DROP TABLE IF EXISTS scan_frequency;
  DROP TABLE IF EXISTS demand_scores;
`;
