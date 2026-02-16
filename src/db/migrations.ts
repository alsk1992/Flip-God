/**
 * Database Migrations - Versioned schema management for FlipAgent
 *
 * Features:
 * - Sequential migration execution
 * - Up/down migrations (string SQL or programmatic)
 * - Migration tracking via _migrations table
 * - Automatic migration on startup
 * - Rollback support (single, to-version, full reset)
 */

import type { Database } from './index';
import { createLogger } from '../utils/logger';
import { MIGRATION_007_UP, MIGRATION_007_DOWN } from './migration-007-alerts';
import { MIGRATION_008_UP, MIGRATION_008_DOWN } from './migration-008-price-snapshots';
import { MIGRATION_009_UP, MIGRATION_009_DOWN } from './migration-009-shipping-cache';
import { MIGRATION_010_UP, MIGRATION_010_DOWN } from './migration-010-repricing-rules';
import { MIGRATION_011_UP, MIGRATION_011_DOWN } from './migration-011-bulk-ops';
import { MIGRATION_012_UP, MIGRATION_012_DOWN } from './migration-012-variations';
import { MIGRATION_013_UP, MIGRATION_013_DOWN } from './migration-013-returns';
import { MIGRATION_014_UP, MIGRATION_014_DOWN } from './migration-014-fba-inbound';
import { MIGRATION_015_UP, MIGRATION_015_DOWN } from './migration-015-inventory-sync';
import { MIGRATION_016_UP, MIGRATION_016_DOWN } from './migration-016-tax';
import { MIGRATION_017_UP, MIGRATION_017_DOWN } from './migration-017-alert-routing';
import { MIGRATION_018_UP, MIGRATION_018_DOWN } from './migration-018-messaging';
import { MIGRATION_019_UP, MIGRATION_019_DOWN } from './migration-019-pricing';
import { MIGRATION_020_UP, MIGRATION_020_DOWN } from './migration-020-workflows';
import { MIGRATION_021_UP, MIGRATION_021_DOWN } from './migration-021-teams';
import { MIGRATION_022_UP, MIGRATION_022_DOWN } from './migration-022-plugins';
import { MIGRATION_023_UP, MIGRATION_023_DOWN } from './migration-023-currency-cogs-bundles';
import { MIGRATION_024_UP, MIGRATION_024_DOWN } from './migration-024-rma-scoring';

const logger = createLogger('migrations');

/** Migration definition */
export type MigrationStep = string | ((db: Database) => void);

export interface Migration {
  /** Migration version (sequential number) */
  version: number;
  /** Migration name for display */
  name: string;
  /** SQL or function to apply migration */
  up: MigrationStep;
  /** SQL or function to revert migration */
  down: MigrationStep;
}

/** Migration status record */
export interface MigrationStatus {
  version: number;
  name: string;
  appliedAt: Date;
}

/** All migrations in order */
const MIGRATIONS: Migration[] = [
  // ── Migration 1: Initial schema ──────────────────────────────────────────
  {
    version: 1,
    name: 'initial_schema',
    up: `
      -- Products table
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        upc TEXT,
        asin TEXT,
        title TEXT NOT NULL,
        brand TEXT,
        category TEXT,
        image_url TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );

      -- Price snapshots
      CREATE TABLE IF NOT EXISTS prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        platform_id TEXT,
        price REAL NOT NULL,
        shipping REAL DEFAULT 0,
        currency TEXT DEFAULT 'USD',
        in_stock INTEGER DEFAULT 1,
        seller TEXT,
        url TEXT,
        fetched_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );

      -- Arbitrage opportunities
      CREATE TABLE IF NOT EXISTS opportunities (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        buy_platform TEXT NOT NULL,
        buy_price REAL NOT NULL,
        buy_shipping REAL DEFAULT 0,
        sell_platform TEXT NOT NULL,
        sell_price REAL NOT NULL,
        estimated_fees REAL,
        estimated_profit REAL,
        margin_pct REAL,
        score REAL,
        status TEXT DEFAULT 'active',
        found_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        expires_at INTEGER,
        FOREIGN KEY (product_id) REFERENCES products(id)
      );

      -- Active listings
      CREATE TABLE IF NOT EXISTS listings (
        id TEXT PRIMARY KEY,
        opportunity_id TEXT,
        product_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        platform_listing_id TEXT,
        title TEXT,
        price REAL NOT NULL,
        source_platform TEXT NOT NULL,
        source_price REAL NOT NULL,
        status TEXT DEFAULT 'active',
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        FOREIGN KEY (product_id) REFERENCES products(id)
      );

      -- Orders (buy-side fulfillment)
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL,
        sell_platform TEXT NOT NULL,
        sell_order_id TEXT,
        sell_price REAL NOT NULL,
        buy_platform TEXT NOT NULL,
        buy_order_id TEXT,
        buy_price REAL,
        shipping_cost REAL,
        platform_fees REAL,
        profit REAL,
        status TEXT DEFAULT 'pending',
        buyer_address TEXT,
        tracking_number TEXT,
        ordered_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        shipped_at INTEGER,
        delivered_at INTEGER,
        FOREIGN KEY (listing_id) REFERENCES listings(id)
      );

      -- Sessions
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        chat_type TEXT DEFAULT 'dm',
        context TEXT DEFAULT '{}',
        last_activity INTEGER DEFAULT (strftime('%s','now') * 1000),
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );

      -- Users
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        display_name TEXT,
        platform TEXT,
        platform_user_id TEXT,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
      );

      -- Trading credentials (encrypted, per-user per-platform)
      CREATE TABLE IF NOT EXISTS trading_credentials (
        user_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        mode TEXT DEFAULT 'api_key',
        encrypted_data TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        failed_attempts INTEGER DEFAULT 0,
        cooldown_until INTEGER,
        created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s','now') * 1000),
        PRIMARY KEY (user_id, platform)
      );

      -- Core indexes
      CREATE INDEX IF NOT EXISTS idx_prices_product ON prices(product_id);
      CREATE INDEX IF NOT EXISTS idx_prices_platform ON prices(platform);
      CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
      CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(key);
    `,
    down: `
      DROP TABLE IF EXISTS trading_credentials;
      DROP TABLE IF EXISTS orders;
      DROP TABLE IF EXISTS listings;
      DROP TABLE IF EXISTS opportunities;
      DROP TABLE IF EXISTS prices;
      DROP TABLE IF EXISTS sessions;
      DROP TABLE IF EXISTS users;
      DROP TABLE IF EXISTS products;
    `,
  },

  // ── Migration 2: Additional indexes for query performance ────────────────
  {
    version: 2,
    name: 'performance_indexes',
    up: `
      -- Product lookups by identifiers
      CREATE INDEX IF NOT EXISTS idx_products_upc ON products(upc);
      CREATE INDEX IF NOT EXISTS idx_products_asin ON products(asin);
      CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);

      -- Price lookups by time
      CREATE INDEX IF NOT EXISTS idx_prices_fetched_at ON prices(fetched_at);
      CREATE INDEX IF NOT EXISTS idx_prices_product_platform ON prices(product_id, platform);

      -- Opportunity lookups
      CREATE INDEX IF NOT EXISTS idx_opportunities_product ON opportunities(product_id);
      CREATE INDEX IF NOT EXISTS idx_opportunities_margin ON opportunities(margin_pct);
      CREATE INDEX IF NOT EXISTS idx_opportunities_found ON opportunities(found_at);

      -- Listing lookups
      CREATE INDEX IF NOT EXISTS idx_listings_product ON listings(product_id);
      CREATE INDEX IF NOT EXISTS idx_listings_platform ON listings(platform);

      -- Order lookups
      CREATE INDEX IF NOT EXISTS idx_orders_listing ON orders(listing_id);
      CREATE INDEX IF NOT EXISTS idx_orders_ordered ON orders(ordered_at);

      -- Session lookups
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_platform ON sessions(platform);

      -- Credential lookups
      CREATE INDEX IF NOT EXISTS idx_credentials_user ON trading_credentials(user_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_products_upc;
      DROP INDEX IF EXISTS idx_products_asin;
      DROP INDEX IF EXISTS idx_products_brand;
      DROP INDEX IF EXISTS idx_prices_fetched_at;
      DROP INDEX IF EXISTS idx_prices_product_platform;
      DROP INDEX IF EXISTS idx_opportunities_product;
      DROP INDEX IF EXISTS idx_opportunities_margin;
      DROP INDEX IF EXISTS idx_opportunities_found;
      DROP INDEX IF EXISTS idx_listings_product;
      DROP INDEX IF EXISTS idx_listings_platform;
      DROP INDEX IF EXISTS idx_orders_listing;
      DROP INDEX IF EXISTS idx_orders_ordered;
      DROP INDEX IF EXISTS idx_sessions_user;
      DROP INDEX IF EXISTS idx_sessions_platform;
      DROP INDEX IF EXISTS idx_credentials_user;
    `,
  },

  // ── Migration 3: Usage tracking and product notes ────────────────────────
  {
    version: 3,
    name: 'usage_and_notes',
    up: (db) => {
      // Usage records for token/cost tracking
      db.run(`
        CREATE TABLE IF NOT EXISTS usage_records (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          model TEXT NOT NULL,
          input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          total_tokens INTEGER NOT NULL,
          estimated_cost REAL NOT NULL,
          timestamp INTEGER NOT NULL
        )
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_usage_session ON usage_records(session_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_records(user_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_records(timestamp)');

      // Product notes / user-added metadata
      db.run(`
        CREATE TABLE IF NOT EXISTS product_notes (
          id TEXT PRIMARY KEY,
          product_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          note TEXT NOT NULL,
          created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
          FOREIGN KEY (product_id) REFERENCES products(id)
        )
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_product_notes_product ON product_notes(product_id)');

      // Add weight/dimensions columns to products for shipping estimates
      const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
      const ensureIdentifier = (name: string) => {
        if (!identifier.test(name)) {
          throw new Error(`Unsafe SQL identifier: ${name}`);
        }
      };

      const getColumns = (table: string): string[] => {
        ensureIdentifier(table);
        const rows = db.query<{ name: string }>(`PRAGMA table_info(${table})`);
        return Array.isArray(rows) ? rows.map((row) => row.name) : [];
      };

      const addColumnIfMissing = (
        table: string,
        column: string,
        type: string,
        defaultSql?: string,
      ) => {
        ensureIdentifier(table);
        ensureIdentifier(column);
        const columns = getColumns(table);
        if (columns.includes(column)) return;
        const defaultClause = defaultSql ? ` DEFAULT ${defaultSql}` : '';
        db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}${defaultClause}`);
      };

      addColumnIfMissing('products', 'weight_oz', 'REAL');
      addColumnIfMissing('products', 'length_in', 'REAL');
      addColumnIfMissing('products', 'width_in', 'REAL');
      addColumnIfMissing('products', 'height_in', 'REAL');

      // Add notes column to opportunities for user annotations
      addColumnIfMissing('opportunities', 'notes', 'TEXT');
    },
    down: `
      DROP TABLE IF EXISTS product_notes;
      DROP TABLE IF EXISTS usage_records;
    `,
  },

  // ── Migration 4: Hot-column performance indexes ─────────────────────────
  {
    version: 4,
    name: 'hot_column_indexes',
    up: `
      -- Products: UPC lookups (idx_products_upc already exists from migration 2,
      -- but IF NOT EXISTS makes this safe / idempotent)
      CREATE INDEX IF NOT EXISTS idx_products_upc ON products(upc);

      -- Prices: product + platform + time lookups
      CREATE INDEX IF NOT EXISTS idx_prices_product_id ON prices(product_id);
      CREATE INDEX IF NOT EXISTS idx_prices_platform ON prices(platform);
      CREATE INDEX IF NOT EXISTS idx_prices_fetched_at ON prices(fetched_at);

      -- Opportunities: status + margin + time filtering
      CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
      CREATE INDEX IF NOT EXISTS idx_opportunities_margin ON opportunities(margin_pct);
      CREATE INDEX IF NOT EXISTS idx_opportunities_found_at ON opportunities(found_at);

      -- Listings: status + platform filtering
      CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
      CREATE INDEX IF NOT EXISTS idx_listings_platform ON listings(platform);

      -- Orders: status + time filtering
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_ordered_at ON orders(ordered_at);
    `,
    down: `
      DROP INDEX IF EXISTS idx_products_upc;
      DROP INDEX IF EXISTS idx_prices_product_id;
      DROP INDEX IF EXISTS idx_prices_platform;
      DROP INDEX IF EXISTS idx_prices_fetched_at;
      DROP INDEX IF EXISTS idx_opportunities_status;
      DROP INDEX IF EXISTS idx_opportunities_margin;
      DROP INDEX IF EXISTS idx_opportunities_found_at;
      DROP INDEX IF EXISTS idx_listings_status;
      DROP INDEX IF EXISTS idx_listings_platform;
      DROP INDEX IF EXISTS idx_orders_status;
      DROP INDEX IF EXISTS idx_orders_ordered_at;
    `,
  },

  // ── Migration 5: Job queue and repricing rules ────────────────────────────
  {
    version: 5,
    name: 'jobs_and_repricing_rules',
    up: `
      -- Job queue for bulk operations
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        payload TEXT NOT NULL,
        result TEXT,
        progress INTEGER DEFAULT 0,
        total_items INTEGER DEFAULT 0,
        completed_items INTEGER DEFAULT 0,
        failed_items INTEGER DEFAULT 0,
        errors TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

      -- Repricing rules for advanced repricing strategies
      CREATE TABLE IF NOT EXISTS repricing_rules (
        id TEXT PRIMARY KEY,
        listing_id TEXT NOT NULL,
        strategy TEXT NOT NULL,
        params TEXT NOT NULL DEFAULT '{}',
        min_price REAL NOT NULL,
        max_price REAL NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run INTEGER,
        run_interval_ms INTEGER NOT NULL DEFAULT 3600000,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_repricing_rules_listing ON repricing_rules(listing_id);
      CREATE INDEX IF NOT EXISTS idx_repricing_rules_enabled ON repricing_rules(enabled);
    `,
    down: `
      DROP TABLE IF EXISTS repricing_rules;
      DROP TABLE IF EXISTS jobs;
    `,
  },

  // ── Migration 6: Multi-warehouse inventory ──────────────────────────────
  {
    version: 6,
    name: 'warehouses_and_inventory',
    up: `
      -- Warehouses (home, FBA, 3PL, etc.)
      CREATE TABLE IF NOT EXISTS warehouses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'manual',
        address TEXT,
        is_default INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_warehouses_user ON warehouses(user_id);

      -- Warehouse inventory per SKU per location
      CREATE TABLE IF NOT EXISTS warehouse_inventory (
        id TEXT PRIMARY KEY,
        warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
        sku TEXT NOT NULL,
        product_id TEXT,
        quantity INTEGER NOT NULL DEFAULT 0,
        reserved INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        UNIQUE(warehouse_id, sku)
      );
      CREATE INDEX IF NOT EXISTS idx_warehouse_inv_sku ON warehouse_inventory(sku);
      CREATE INDEX IF NOT EXISTS idx_warehouse_inv_warehouse ON warehouse_inventory(warehouse_id);
    `,
    down: `
      DROP TABLE IF EXISTS warehouse_inventory;
      DROP TABLE IF EXISTS warehouses;
    `,
  },

  // ── Migration 7: Alerts and alert rules ────────────────────────────────
  {
    version: 7,
    name: 'alerts_and_alert_rules',
    up: MIGRATION_007_UP,
    down: MIGRATION_007_DOWN,
  },

  // ── Migration 8: Competitor price snapshots ────────────────────────────
  {
    version: 8,
    name: 'competitor_price_snapshots',
    up: MIGRATION_008_UP,
    down: MIGRATION_008_DOWN,
  },

  // ── Migration 9: Shipping rate cache ───────────────────────────────────
  {
    version: 9,
    name: 'shipping_rate_cache',
    up: MIGRATION_009_UP,
    down: MIGRATION_009_DOWN,
  },

  // ── Migration 10: Smart repricing rules (v2) and history ──────────────
  {
    version: 10,
    name: 'repricing_rules_v2_and_history',
    up: MIGRATION_010_UP,
    down: MIGRATION_010_DOWN,
  },

  // ── Migration 11: Bulk operations tracking ────────────────────────────
  {
    version: 11,
    name: 'bulk_operations',
    up: MIGRATION_011_UP,
    down: MIGRATION_011_DOWN,
  },

  // ── Migration 12: Product variation groups ────────────────────────────
  {
    version: 12,
    name: 'variation_groups',
    up: MIGRATION_012_UP,
    down: MIGRATION_012_DOWN,
  },

  // ── Migration 13: Returns and refunds ───────────────────────────────
  {
    version: 13,
    name: 'returns_and_refunds',
    up: MIGRATION_013_UP,
    down: MIGRATION_013_DOWN,
  },

  // ── Migration 14: FBA inbound shipments ─────────────────────────────
  {
    version: 14,
    name: 'fba_inbound_shipments',
    up: MIGRATION_014_UP,
    down: MIGRATION_014_DOWN,
  },

  // ── Migration 15: Inventory sync (holds, conflicts, allocation) ─────
  {
    version: 15,
    name: 'inventory_sync',
    up: MIGRATION_015_UP,
    down: MIGRATION_015_DOWN,
  },

  // ── Migration 16: Tax rates seed data ───────────────────────────────
  {
    version: 16,
    name: 'tax_rates',
    up: MIGRATION_016_UP,
    down: MIGRATION_016_DOWN,
  },

  // ── Migration 17: Alert routing rules ─────────────────────────────
  {
    version: 17,
    name: 'alert_routing_rules',
    up: MIGRATION_017_UP,
    down: MIGRATION_017_DOWN,
  },

  // ── Migration 18: Messaging, templates, auto-responder ──────────
  {
    version: 18,
    name: 'messaging_and_templates',
    up: MIGRATION_018_UP,
    down: MIGRATION_018_DOWN,
  },

  // ── Migration 19: Dynamic pricing & A/B price testing ─────────────
  {
    version: 19,
    name: 'dynamic_pricing_and_ab_tests',
    up: MIGRATION_019_UP,
    down: MIGRATION_019_DOWN,
  },

  // ── Migration 20: Workflow builder (multi-step automation) ────────
  {
    version: 20,
    name: 'workflow_builder',
    up: MIGRATION_020_UP,
    down: MIGRATION_020_DOWN,
  },

  // ── Migration 21: Teams, members, invites, audit log ────────────
  {
    version: 21,
    name: 'teams_and_audit_log',
    up: MIGRATION_021_UP,
    down: MIGRATION_021_DOWN,
  },

  // ── Migration 22: Plugin registry and shared rule packs ─────────
  {
    version: 22,
    name: 'plugin_registry',
    up: MIGRATION_022_UP,
    down: MIGRATION_022_DOWN,
  },

  // ── Migration 23: Currency preferences, COGS, bundles, conditions ─
  {
    version: 23,
    name: 'currency_cogs_bundles',
    up: MIGRATION_023_UP,
    down: MIGRATION_023_DOWN,
  },

  // ── Migration 24: RMA requests, product scores, niche analyses ────
  {
    version: 24,
    name: 'rma_scoring',
    up: MIGRATION_024_UP,
    down: MIGRATION_024_DOWN,
  },
];

// =============================================================================
// Migration Runner
// =============================================================================

export interface MigrationRunner {
  /** Get current database version */
  getCurrentVersion(): number;

  /** Get all applied migrations */
  getAppliedMigrations(): MigrationStatus[];

  /** Get pending migrations */
  getPendingMigrations(): Migration[];

  /** Run all pending migrations */
  migrate(): void;

  /** Rollback to a specific version */
  rollbackTo(version: number): void;

  /** Rollback last migration */
  rollbackLast(): void;

  /** Reset database (rollback all) */
  reset(): void;
}

function ensureSchemaVersionTable(db: Database): void {
  db.run(
    'CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER NOT NULL, applied_at INTEGER NOT NULL)',
  );
}

function getLegacySchemaVersion(db: Database): number {
  try {
    const rows = db.query<{ version: number }>(
      'SELECT version FROM _schema_version ORDER BY version DESC LIMIT 1',
    );
    return rows[0]?.version ?? 0;
  } catch {
    return 0;
  }
}

export function createMigrationRunner(db: Database): MigrationRunner {
  ensureSchemaVersionTable(db);

  // Create migrations tracking table
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    )
  `);

  function getCurrentVersion(): number {
    const results = db.query<{ version: number }>(
      'SELECT MAX(version) as version FROM _migrations',
    );
    const current = results[0]?.version ?? 0;
    if (current > 0) return current;
    return getLegacySchemaVersion(db);
  }

  function getAppliedMigrations(): MigrationStatus[] {
    const rows = db.query<{ version: number; name: string; applied_at: number }>(
      'SELECT version, name, applied_at FROM _migrations ORDER BY version',
    );
    return rows.map((row) => ({
      version: row.version,
      name: row.name,
      appliedAt: new Date(row.applied_at),
    }));
  }

  function getPendingMigrations(): Migration[] {
    const currentVersion = getCurrentVersion();
    return MIGRATIONS.filter((m) => m.version > currentVersion);
  }

  function applyMigration(migration: Migration): void {
    logger.info({ version: migration.version, name: migration.name }, 'Applying migration');

    try {
      if (typeof migration.up === 'string') {
        // Execute migration SQL (may contain multiple statements)
        const statements = migration.up
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const sql of statements) {
          db.run(sql);
        }
      } else {
        migration.up(db);
      }

      // Record migration in both tables
      db.run('INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)', [
        migration.version,
        migration.name,
        Date.now(),
      ]);
      ensureSchemaVersionTable(db);
      db.run('INSERT INTO _schema_version (version, applied_at) VALUES (?, ?)', [
        migration.version,
        Date.now(),
      ]);

      logger.info({ version: migration.version }, 'Migration applied');
    } catch (error) {
      logger.error({ error, version: migration.version }, 'Migration failed');
      throw error;
    }
  }

  function revertMigration(migration: Migration): void {
    logger.info({ version: migration.version, name: migration.name }, 'Reverting migration');

    try {
      if (typeof migration.down === 'string') {
        const statements = migration.down
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const sql of statements) {
          db.run(sql);
        }
      } else {
        migration.down(db);
      }

      db.run('DELETE FROM _migrations WHERE version = ?', [migration.version]);
      ensureSchemaVersionTable(db);
      db.run('INSERT INTO _schema_version (version, applied_at) VALUES (?, ?)', [
        migration.version - 1,
        Date.now(),
      ]);

      logger.info({ version: migration.version }, 'Migration reverted');
    } catch (error) {
      logger.error({ error, version: migration.version }, 'Rollback failed');
      throw error;
    }
  }

  return {
    getCurrentVersion,
    getAppliedMigrations,
    getPendingMigrations,

    migrate() {
      const pending = getPendingMigrations();

      if (pending.length === 0) {
        logger.info('Database is up to date');
        return;
      }

      logger.info({ count: pending.length }, 'Running migrations');

      for (const migration of pending) {
        applyMigration(migration);
      }

      logger.info({ version: getCurrentVersion() }, 'Migrations complete');
    },

    rollbackTo(version) {
      const current = getCurrentVersion();
      if (version >= current) {
        logger.info('Nothing to rollback');
        return;
      }

      // Get migrations to revert (in reverse order)
      const toRevert = MIGRATIONS.filter(
        (m) => m.version > version && m.version <= current,
      ).reverse();

      for (const migration of toRevert) {
        revertMigration(migration);
      }
    },

    rollbackLast() {
      const current = getCurrentVersion();
      if (current === 0) {
        logger.info('Nothing to rollback');
        return;
      }

      const migration = MIGRATIONS.find((m) => m.version === current);
      if (migration) {
        revertMigration(migration);
      }
    },

    reset() {
      this.rollbackTo(0);
    },
  };
}

/** Get all defined migrations */
export function getMigrations(): Migration[] {
  return [...MIGRATIONS];
}

/** Add a new migration programmatically */
export function addMigration(migration: Migration): void {
  MIGRATIONS.push(migration);
  MIGRATIONS.sort((a, b) => a.version - b.version);
}
