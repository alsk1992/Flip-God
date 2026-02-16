/**
 * Migration 029 - Supplier CRM tables
 *
 * Creates suppliers, supplier_products, supplier_orders, and supplier_order_items
 * tables with indexes for managing wholesale supplier relationships, catalogs,
 * purchase orders, and performance tracking.
 */

export const MIGRATION_029_UP = `
  CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    contact_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    website TEXT DEFAULT '',
    platform TEXT DEFAULT 'direct',
    payment_terms TEXT DEFAULT 'prepaid',
    min_order_amount REAL DEFAULT 0,
    shipping_region TEXT DEFAULT '',
    avg_lead_time_days INTEGER DEFAULT 7,
    rating REAL DEFAULT 3,
    notes TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    total_orders INTEGER DEFAULT 0,
    total_spent REAL DEFAULT 0,
    last_order_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS supplier_products (
    id TEXT PRIMARY KEY,
    supplier_id TEXT NOT NULL,
    product_id TEXT,
    sku TEXT,
    supplier_sku TEXT DEFAULT '',
    unit_cost REAL NOT NULL,
    moq INTEGER DEFAULT 1,
    lead_time_days INTEGER DEFAULT 7,
    is_preferred INTEGER DEFAULT 0,
    last_price_at INTEGER,
    notes TEXT DEFAULT '',
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
  );
  CREATE INDEX IF NOT EXISTS idx_supplier_products_supplier ON supplier_products(supplier_id);
  CREATE INDEX IF NOT EXISTS idx_supplier_products_product ON supplier_products(product_id);

  CREATE TABLE IF NOT EXISTS supplier_orders (
    id TEXT PRIMARY KEY,
    supplier_id TEXT NOT NULL,
    order_number TEXT,
    status TEXT DEFAULT 'draft',
    subtotal REAL DEFAULT 0,
    shipping_cost REAL DEFAULT 0,
    total REAL DEFAULT 0,
    expected_delivery INTEGER,
    actual_delivery INTEGER,
    tracking_number TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
  );
  CREATE INDEX IF NOT EXISTS idx_supplier_orders_supplier ON supplier_orders(supplier_id);
  CREATE INDEX IF NOT EXISTS idx_supplier_orders_status ON supplier_orders(status);

  CREATE TABLE IF NOT EXISTS supplier_order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    product_id TEXT,
    sku TEXT,
    quantity INTEGER NOT NULL,
    unit_cost REAL NOT NULL,
    total REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES supplier_orders(id)
  );
  CREATE INDEX IF NOT EXISTS idx_supplier_order_items_order ON supplier_order_items(order_id);
`;

export const MIGRATION_029_DOWN = `
  DROP TABLE IF EXISTS supplier_order_items;
  DROP TABLE IF EXISTS supplier_orders;
  DROP TABLE IF EXISTS supplier_products;
  DROP TABLE IF EXISTS suppliers;
`;
