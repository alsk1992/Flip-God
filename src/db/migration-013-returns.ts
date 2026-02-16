/**
 * Migration 013 - Returns & Refunds
 *
 * Creates the returns table for tracking return requests, inspections,
 * restocking, and refund processing.
 */

export const MIGRATION_013_UP = `
  -- Return requests
  CREATE TABLE IF NOT EXISTS returns (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    condition TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    refund_amount REAL,
    restocked INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    resolved_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id);
  CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status);
  CREATE INDEX IF NOT EXISTS idx_returns_category ON returns(category);
  CREATE INDEX IF NOT EXISTS idx_returns_platform ON returns(platform);
  CREATE INDEX IF NOT EXISTS idx_returns_created ON returns(created_at);
  CREATE INDEX IF NOT EXISTS idx_returns_user ON returns(user_id);
`;

export const MIGRATION_013_DOWN = `
  DROP TABLE IF EXISTS returns;
`;
