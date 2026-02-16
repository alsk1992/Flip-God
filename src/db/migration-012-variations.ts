/**
 * Migration 012: Product Variation Groups
 *
 * Creates variation_groups and variation_items tables for grouping
 * products as size/color/material/style variations.
 */

export const MIGRATION_012_UP = `
  -- Variation groups (parent-level grouping)
  CREATE TABLE IF NOT EXISTS variation_groups (
    id TEXT PRIMARY KEY,
    parent_product_id TEXT NOT NULL,
    theme TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_variation_groups_parent ON variation_groups(parent_product_id);
  CREATE INDEX IF NOT EXISTS idx_variation_groups_theme ON variation_groups(theme);

  -- Variation items (individual variants within a group)
  CREATE TABLE IF NOT EXISTS variation_items (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    attributes TEXT NOT NULL DEFAULT '{}',
    sku TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (group_id) REFERENCES variation_groups(id)
  );

  CREATE INDEX IF NOT EXISTS idx_variation_items_group ON variation_items(group_id);
  CREATE INDEX IF NOT EXISTS idx_variation_items_product ON variation_items(product_id);
  CREATE INDEX IF NOT EXISTS idx_variation_items_sku ON variation_items(sku);
`;

export const MIGRATION_012_DOWN = `
  DROP TABLE IF EXISTS variation_items;
  DROP TABLE IF EXISTS variation_groups;
`;
