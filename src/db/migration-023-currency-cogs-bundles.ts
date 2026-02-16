export const MIGRATION_023_UP = `
  CREATE TABLE IF NOT EXISTS cogs_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL,
    unit_cost REAL NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    supplier TEXT,
    purchase_date TEXT,
    shipping_cost REAL DEFAULT 0,
    import_duty REAL DEFAULT 0,
    other_costs REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_cogs_product ON cogs_records(product_id);

  CREATE TABLE IF NOT EXISTS product_conditions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id TEXT NOT NULL UNIQUE,
    cosmetic_score INTEGER,
    functional_score INTEGER,
    packaging TEXT,
    accessories_complete INTEGER DEFAULT 1,
    overall_grade TEXT,
    notes TEXT,
    graded_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_condition_grade ON product_conditions(overall_grade);

  CREATE TABLE IF NOT EXISTS bundles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    bundle_price REAL,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bundle_components (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bundle_id INTEGER NOT NULL REFERENCES bundles(id),
    product_id TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_bundle_comp ON bundle_components(bundle_id);

  CREATE TABLE IF NOT EXISTS currency_preferences (
    user_id TEXT PRIMARY KEY,
    currency_code TEXT NOT NULL DEFAULT 'USD',
    updated_at TEXT DEFAULT (datetime('now'))
  );
`;

export const MIGRATION_023_DOWN = `
  DROP TABLE IF EXISTS bundle_components;
  DROP TABLE IF EXISTS bundles;
  DROP TABLE IF EXISTS product_conditions;
  DROP TABLE IF EXISTS cogs_records;
  DROP TABLE IF EXISTS currency_preferences;
`;
