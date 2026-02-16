/**
 * Migration 014 - FBA Inbound Shipments
 *
 * Creates tables for managing inbound shipments to Amazon FBA warehouses,
 * including shipment plans, items, and tracking data.
 */

export const MIGRATION_014_UP = `
  -- FBA inbound shipment plans / shipments
  CREATE TABLE IF NOT EXISTS fba_inbound_shipments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT '',
    plan_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planning',
    destination_fc TEXT NOT NULL DEFAULT '',
    item_count INTEGER NOT NULL DEFAULT 0,
    total_units INTEGER NOT NULL DEFAULT 0,
    box_count INTEGER NOT NULL DEFAULT 0,
    weight_lbs REAL NOT NULL DEFAULT 0,
    tracking_number TEXT,
    carrier TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    shipped_at INTEGER,
    received_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_fba_inbound_status ON fba_inbound_shipments(status);
  CREATE INDEX IF NOT EXISTS idx_fba_inbound_plan ON fba_inbound_shipments(plan_id);
  CREATE INDEX IF NOT EXISTS idx_fba_inbound_user ON fba_inbound_shipments(user_id);
  CREATE INDEX IF NOT EXISTS idx_fba_inbound_created ON fba_inbound_shipments(created_at);

  -- FBA inbound shipment items (individual SKUs per shipment)
  CREATE TABLE IF NOT EXISTS fba_inbound_items (
    id TEXT PRIMARY KEY,
    shipment_id TEXT NOT NULL,
    sku TEXT NOT NULL,
    fnsku TEXT,
    asin TEXT,
    quantity INTEGER NOT NULL DEFAULT 0,
    prep_type TEXT NOT NULL DEFAULT 'none',
    condition TEXT NOT NULL DEFAULT 'new',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    FOREIGN KEY (shipment_id) REFERENCES fba_inbound_shipments(id)
  );
  CREATE INDEX IF NOT EXISTS idx_fba_inbound_items_shipment ON fba_inbound_items(shipment_id);
  CREATE INDEX IF NOT EXISTS idx_fba_inbound_items_sku ON fba_inbound_items(sku);
  CREATE INDEX IF NOT EXISTS idx_fba_inbound_items_asin ON fba_inbound_items(asin);
`;

export const MIGRATION_014_DOWN = `
  DROP TABLE IF EXISTS fba_inbound_items;
  DROP TABLE IF EXISTS fba_inbound_shipments;
`;
