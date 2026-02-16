/**
 * Migration 015 - Inventory Sync tables
 *
 * Adds inventory_holds, inventory_conflicts, and inventory_allocation_rules
 * tables to support cross-platform inventory synchronization, hold management,
 * conflict detection, and stock allocation.
 */

export const MIGRATION_015_UP = `
  -- Inventory holds (reserved/pending stock)
  CREATE TABLE IF NOT EXISTS inventory_holds (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    warehouse_id TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    reason TEXT NOT NULL,
    reference_id TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
  );
  CREATE INDEX IF NOT EXISTS idx_inventory_holds_product ON inventory_holds(product_id);
  CREATE INDEX IF NOT EXISTS idx_inventory_holds_warehouse ON inventory_holds(warehouse_id);
  CREATE INDEX IF NOT EXISTS idx_inventory_holds_expires ON inventory_holds(expires_at);
  CREATE INDEX IF NOT EXISTS idx_inventory_holds_reason ON inventory_holds(reason);

  -- Inventory conflicts (discrepancies between local and platform counts)
  CREATE TABLE IF NOT EXISTS inventory_conflicts (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    local_qty INTEGER NOT NULL,
    platform_qty INTEGER NOT NULL,
    resolution TEXT,
    manual_qty INTEGER,
    resolved_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
  CREATE INDEX IF NOT EXISTS idx_inventory_conflicts_product ON inventory_conflicts(product_id);
  CREATE INDEX IF NOT EXISTS idx_inventory_conflicts_resolution ON inventory_conflicts(resolution);

  -- Inventory allocation rules (how stock is distributed across platforms)
  CREATE TABLE IF NOT EXISTS inventory_allocation_rules (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL DEFAULT 'default',
    platform TEXT NOT NULL,
    allocation_type TEXT NOT NULL,
    allocation_value REAL NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    UNIQUE(product_id, platform)
  );
  CREATE INDEX IF NOT EXISTS idx_allocation_rules_product ON inventory_allocation_rules(product_id);
`;

export const MIGRATION_015_DOWN = `
  DROP TABLE IF EXISTS inventory_allocation_rules;
  DROP TABLE IF EXISTS inventory_conflicts;
  DROP TABLE IF EXISTS inventory_holds;
`;
