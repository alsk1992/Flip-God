/**
 * Migration 011: Bulk Operations Tracking
 *
 * Creates bulk_operations table to track batch listing operations
 * (pause, resume, delete, price updates).
 */

export const MIGRATION_011_UP = `
  -- Bulk operation tracking
  CREATE TABLE IF NOT EXISTS bulk_operations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    total INTEGER NOT NULL DEFAULT 0,
    completed INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    errors TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_bulk_ops_user ON bulk_operations(user_id);
  CREATE INDEX IF NOT EXISTS idx_bulk_ops_status ON bulk_operations(status);
  CREATE INDEX IF NOT EXISTS idx_bulk_ops_type ON bulk_operations(type);
  CREATE INDEX IF NOT EXISTS idx_bulk_ops_created ON bulk_operations(created_at);
`;

export const MIGRATION_011_DOWN = `
  DROP TABLE IF EXISTS bulk_operations;
`;
