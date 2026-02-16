export const MIGRATION_028_UP = `
  CREATE TABLE IF NOT EXISTS restriction_cache (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    can_sell INTEGER NOT NULL,
    restrictions TEXT NOT NULL,
    risk_level TEXT NOT NULL,
    recommendations TEXT NOT NULL,
    checked_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_restriction_cache_product_platform ON restriction_cache(product_id, platform);

  CREATE TABLE IF NOT EXISTS known_restricted_brands (
    id TEXT PRIMARY KEY,
    brand_name TEXT NOT NULL COLLATE NOCASE,
    platform TEXT NOT NULL,
    restriction_type TEXT NOT NULL,
    notes TEXT,
    added_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_restricted_brands_name ON known_restricted_brands(brand_name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS known_restricted_categories (
    id TEXT PRIMARY KEY,
    category_name TEXT NOT NULL COLLATE NOCASE,
    platform TEXT NOT NULL,
    restriction_type TEXT NOT NULL,
    notes TEXT,
    added_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_restricted_categories_name ON known_restricted_categories(category_name COLLATE NOCASE);
`;

export const MIGRATION_028_DOWN = `
  DROP TABLE IF EXISTS known_restricted_categories;
  DROP TABLE IF EXISTS known_restricted_brands;
  DROP TABLE IF EXISTS restriction_cache;
`;
