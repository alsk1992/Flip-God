/**
 * Database - SQLite (sql.js WASM) for local persistence
 *
 * In-memory WASM database that auto-saves to ~/.flipagent/flipagent.db
 * on mutations. Creates backups on startup and at intervals.
 */

import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { join } from 'path';
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'fs';
import { createLogger } from '../utils/logger';
import { resolveStateDir } from '../utils/config';
import type {
  Product,
  PriceSnapshot,
  Opportunity,
  Listing,
  Order,
  Session,
  User,
  UserCredentials,
  Platform,
} from '../types';

const logger = createLogger('db');

/**
 * Values that can be bound to SQL parameters in sql.js.
 */
export type SqlBindValue = string | number | boolean | null | undefined;

/**
 * Parameter array accepted by Database.run() / Database.query().
 */
type SqlParams = SqlBindValue[] | unknown[];

const DB_DIR = resolveStateDir();
const DB_FILE = join(DB_DIR, 'flipagent.db');
const BACKUP_DIR = join(DB_DIR, 'backups');

// ---------------------------------------------------------------------------
// Database interface
// ---------------------------------------------------------------------------

export interface Database {
  close(): void;
  save(): void;

  // Raw SQL access
  run(sql: string, params?: SqlParams): void;
  query<T>(sql: string, params?: SqlParams): T[];

  // Sessions
  getSession(key: string): Session | undefined;
  createSession(session: Session): void;
  updateSession(session: Session): void;
  deleteSession(key: string): void;
  listSessions(): Session[];

  // Trading credentials
  getTradingCredentials(userId: string, platform: Platform): UserCredentials | null;
  createTradingCredentials(creds: UserCredentials): void;
  updateTradingCredentials(creds: UserCredentials): void;
  deleteTradingCredentials(userId: string, platform: Platform): void;

  // Products
  getProduct(id: string): Product | undefined;
  upsertProduct(product: Product): void;
  findProductByUPC(upc: string): Product | undefined;
  findProductByASIN(asin: string): Product | undefined;

  // Prices
  addPrice(snapshot: PriceSnapshot): void;
  getLatestPrices(productId: string): PriceSnapshot[];
  getPriceHistory(productId: string, platform?: Platform): PriceSnapshot[];

  // Opportunities
  addOpportunity(opp: Opportunity): void;
  getActiveOpportunities(limit?: number): Opportunity[];
  updateOpportunityStatus(id: string, status: Opportunity['status']): void;

  // Listings
  addListing(listing: Listing): void;
  getActiveListings(): Listing[];
  updateListingStatus(id: string, status: Listing['status']): void;

  // Orders
  addOrder(order: Order): void;
  getOrder(id: string): Order | undefined;
  updateOrderStatus(
    id: string,
    status: Order['status'],
    fields?: Partial<Pick<Order, 'buyOrderId' | 'buyPrice' | 'shippingCost' | 'platformFees' | 'profit' | 'trackingNumber' | 'shippedAt' | 'deliveredAt'>>
  ): void;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let dbInstance: Database | null = null;
let sqlJsDb: SqlJsDatabase | null = null;
let dbInitPromise: Promise<Database> | null = null;
let backupInterval: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
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

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    display_name TEXT,
    platform TEXT,
    platform_user_id TEXT,
    created_at INTEGER DEFAULT (strftime('%s','now') * 1000),
    updated_at INTEGER DEFAULT (strftime('%s','now') * 1000)
  );

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

  CREATE INDEX IF NOT EXISTS idx_prices_product ON prices(product_id);
  CREATE INDEX IF NOT EXISTS idx_prices_platform ON prices(platform);
  CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
  CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(key);
`;

// ---------------------------------------------------------------------------
// createDatabase / initDatabase
// ---------------------------------------------------------------------------

/**
 * Initialize the database, create tables, and return a Database handle.
 * Calling multiple times returns the same singleton.
 */
export async function createDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    // Ensure directory exists
    if (!existsSync(DB_DIR)) {
      mkdirSync(DB_DIR, { recursive: true });
    }

    logger.info(`Opening database: ${DB_FILE}`);

    // Initialize sql.js WASM
    const SQL = await initSqlJs();

    // Load existing database or create new
    if (existsSync(DB_FILE)) {
      const buffer = readFileSync(DB_FILE);
      sqlJsDb = new SQL.Database(buffer);
    } else {
      sqlJsDb = new SQL.Database();
    }

    const db = sqlJsDb;

    // Run schema DDL
    db.run(SCHEMA_SQL);

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    function saveDb(): void {
      if (!sqlJsDb) return;
      const data = sqlJsDb.export();
      const buffer = Buffer.from(data);
      const tmpPath = DB_FILE + '.tmp';
      writeFileSync(tmpPath, buffer);
      renameSync(tmpPath, DB_FILE);
    }

    function ensureBackupDir(): void {
      if (!existsSync(BACKUP_DIR)) {
        mkdirSync(BACKUP_DIR, { recursive: true });
      }
    }

    function listBackupFiles(): Array<{ name: string; path: string; mtimeMs: number }> {
      if (!existsSync(BACKUP_DIR)) return [];
      return readdirSync(BACKUP_DIR)
        .filter((name) => name.endsWith('.db'))
        .map((name) => {
          const filePath = join(BACKUP_DIR, name);
          const stats = statSync(filePath);
          return { name, path: filePath, mtimeMs: stats.mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
    }

    function pruneBackups(maxFiles: number): void {
      const files = listBackupFiles();
      if (files.length <= maxFiles) return;
      const toDelete = files.slice(maxFiles);
      for (const file of toDelete) {
        try {
          unlinkSync(file.path);
        } catch (error) {
          logger.warn({ error, file: file.name }, 'Failed to delete old backup');
        }
      }
    }

    function createBackup(): void {
      if (!sqlJsDb) return;
      ensureBackupDir();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = join(BACKUP_DIR, `flipagent-${timestamp}.db`);
      const data = sqlJsDb.export();
      writeFileSync(filePath, Buffer.from(data));

      const maxFiles = Math.max(1, Number.parseInt(process.env.FLIPAGENT_DB_BACKUP_MAX || '10', 10));
      pruneBackups(maxFiles);
    }

    /** Coerce params to sql.js BindParams at the boundary */
    function asBindParams(params: SqlParams): import('sql.js').BindParams {
      return params as import('sql.js').BindParams;
    }

    /** Get a single row or undefined */
    function getOne<T>(sql: string, params: SqlParams = []): T | undefined {
      const stmt = db.prepare(sql);
      try {
        stmt.bind(asBindParams(params));
        if (stmt.step()) {
          return stmt.getAsObject() as T;
        }
        return undefined;
      } finally {
        stmt.free();
      }
    }

    /** Get all matching rows */
    function getAll<T>(sql: string, params: SqlParams = []): T[] {
      const stmt = db.prepare(sql);
      try {
        stmt.bind(asBindParams(params));
        const results: T[] = [];
        while (stmt.step()) {
          results.push(stmt.getAsObject() as T);
        }
        return results;
      } finally {
        stmt.free();
      }
    }

    // -----------------------------------------------------------------------
    // Row parsers
    // -----------------------------------------------------------------------

    function parseProduct(row: Record<string, unknown> | undefined): Product | undefined {
      if (!row) return undefined;
      return {
        id: row.id as string,
        upc: (row.upc as string) ?? undefined,
        asin: (row.asin as string) ?? undefined,
        title: row.title as string,
        brand: (row.brand as string) ?? undefined,
        category: (row.category as string) ?? undefined,
        imageUrl: (row.image_url as string) ?? undefined,
        createdAt: new Date(row.created_at as number),
        updatedAt: new Date(row.updated_at as number),
      };
    }

    function parsePriceSnapshot(row: Record<string, unknown>): PriceSnapshot {
      return {
        id: row.id as number,
        productId: row.product_id as string,
        platform: row.platform as Platform,
        platformId: (row.platform_id as string) ?? undefined,
        price: row.price as number,
        shipping: (row.shipping as number) ?? 0,
        currency: (row.currency as string) ?? 'USD',
        inStock: Boolean(row.in_stock),
        seller: (row.seller as string) ?? undefined,
        url: (row.url as string) ?? undefined,
        fetchedAt: new Date(row.fetched_at as number),
      };
    }

    function parseOpportunity(row: Record<string, unknown>): Opportunity {
      return {
        id: row.id as string,
        productId: row.product_id as string,
        buyPlatform: row.buy_platform as Platform,
        buyPrice: row.buy_price as number,
        buyShipping: (row.buy_shipping as number) ?? 0,
        sellPlatform: row.sell_platform as Platform,
        sellPrice: row.sell_price as number,
        estimatedFees: (row.estimated_fees as number) ?? 0,
        estimatedProfit: (row.estimated_profit as number) ?? 0,
        marginPct: (row.margin_pct as number) ?? 0,
        score: (row.score as number) ?? 0,
        status: (row.status as Opportunity['status']) ?? 'active',
        foundAt: new Date(row.found_at as number),
        expiresAt: row.expires_at ? new Date(row.expires_at as number) : undefined,
      };
    }

    function parseListing(row: Record<string, unknown>): Listing {
      return {
        id: row.id as string,
        opportunityId: (row.opportunity_id as string) ?? undefined,
        productId: row.product_id as string,
        platform: row.platform as Platform,
        platformListingId: (row.platform_listing_id as string) ?? undefined,
        title: (row.title as string) ?? undefined,
        price: row.price as number,
        sourcePlatform: row.source_platform as Platform,
        sourcePrice: row.source_price as number,
        status: (row.status as Listing['status']) ?? 'active',
        createdAt: new Date(row.created_at as number),
        updatedAt: new Date(row.updated_at as number),
      };
    }

    function parseOrder(row: Record<string, unknown> | undefined): Order | undefined {
      if (!row) return undefined;
      return {
        id: row.id as string,
        listingId: row.listing_id as string,
        sellPlatform: row.sell_platform as Platform,
        sellOrderId: (row.sell_order_id as string) ?? undefined,
        sellPrice: row.sell_price as number,
        buyPlatform: row.buy_platform as Platform,
        buyOrderId: (row.buy_order_id as string) ?? undefined,
        buyPrice: row.buy_price != null ? (row.buy_price as number) : undefined,
        shippingCost: row.shipping_cost != null ? (row.shipping_cost as number) : undefined,
        platformFees: row.platform_fees != null ? (row.platform_fees as number) : undefined,
        profit: row.profit != null ? (row.profit as number) : undefined,
        status: (row.status as Order['status']) ?? 'pending',
        buyerAddress: (row.buyer_address as string) ?? undefined,
        trackingNumber: (row.tracking_number as string) ?? undefined,
        orderedAt: new Date(row.ordered_at as number),
        shippedAt: row.shipped_at ? new Date(row.shipped_at as number) : undefined,
        deliveredAt: row.delivered_at ? new Date(row.delivered_at as number) : undefined,
      };
    }

    function parseSession(row: Record<string, unknown> | undefined): Session | undefined {
      if (!row) return undefined;
      let context: Session['context'];
      try {
        context = JSON.parse((row.context as string) || '{}');
      } catch {
        context = { messageCount: 0, preferences: {}, conversationHistory: [] };
      }
      context.messageCount ??= 0;
      context.preferences ??= {};
      context.conversationHistory ??= [];
      return {
        id: row.id as string,
        key: row.key as string,
        userId: row.user_id as string,
        platform: row.platform as string,
        chatId: row.chat_id as string,
        chatType: (row.chat_type as 'dm' | 'group') ?? 'dm',
        context,
        history: context.conversationHistory ?? [],
        lastActivity: row.last_activity
          ? new Date(row.last_activity as number)
          : new Date(row.updated_at as number),
        createdAt: new Date(row.created_at as number),
        updatedAt: new Date(row.updated_at as number),
      };
    }

    function parseTradingCredentials(
      row: Record<string, unknown> | undefined,
    ): UserCredentials | null {
      if (!row) return null;
      return {
        userId: row.user_id as string,
        platform: row.platform as Platform,
        mode: (row.mode as string) ?? 'api_key',
        encryptedData: row.encrypted_data as string,
        enabled: Boolean(row.enabled),
        failedAttempts: (row.failed_attempts as number) ?? 0,
        cooldownUntil: row.cooldown_until
          ? new Date(row.cooldown_until as number)
          : undefined,
        createdAt: new Date(row.created_at as number),
        updatedAt: new Date(row.updated_at as number),
      };
    }

    // -----------------------------------------------------------------------
    // Create startup backup
    // -----------------------------------------------------------------------

    if (existsSync(DB_FILE)) {
      try {
        createBackup();
        logger.info('Created startup backup');
      } catch (err) {
        logger.warn({ error: err }, 'Failed to create startup backup');
      }
    }

    // Save after schema creation
    saveDb();

    // Start periodic backup interval (every 60 minutes by default)
    const intervalMinutes = Math.max(
      1,
      Number.parseInt(process.env.FLIPAGENT_DB_BACKUP_INTERVAL_MINUTES || '60', 10),
    );
    backupInterval = setInterval(() => {
      try {
        createBackup();
      } catch (err) {
        logger.warn({ error: err }, 'Periodic backup failed');
      }
    }, intervalMinutes * 60 * 1000);
    // Unref so it doesn't keep the process alive
    if (backupInterval && typeof backupInterval === 'object' && 'unref' in backupInterval) {
      (backupInterval as NodeJS.Timeout).unref();
    }

    // -----------------------------------------------------------------------
    // Build Database instance
    // -----------------------------------------------------------------------

    const instance: Database = {
      // -- Lifecycle --

      close() {
        saveDb();
        db.close();
        sqlJsDb = null;
        dbInstance = null;
        dbInitPromise = null;
        if (backupInterval) {
          clearInterval(backupInterval);
          backupInterval = null;
        }
      },

      save() {
        saveDb();
      },

      // -- Raw SQL --

      run(sql: string, params: SqlParams = []): void {
        db.run(sql, asBindParams(params));
        saveDb();
      },

      query<T>(sql: string, params: SqlParams = []): T[] {
        const stmt = db.prepare(sql);
        try {
          stmt.bind(asBindParams(params));
          const results: T[] = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject() as T);
          }
          return results;
        } finally {
          stmt.free();
        }
      },

      // -- Sessions --

      getSession(key: string): Session | undefined {
        return parseSession(
          getOne(
            'SELECT id, key, user_id, platform, chat_id, chat_type, context, last_activity, created_at, updated_at FROM sessions WHERE key = ?',
            [key],
          ),
        );
      },

      createSession(session: Session): void {
        instance.run(
          'INSERT INTO sessions (id, key, user_id, platform, chat_id, chat_type, context, last_activity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            session.id,
            session.key,
            session.userId,
            session.platform,
            session.chatId,
            session.chatType,
            JSON.stringify(session.context),
            session.lastActivity.getTime(),
            session.createdAt.getTime(),
            session.updatedAt.getTime(),
          ],
        );
      },

      updateSession(session: Session): void {
        instance.run(
          'UPDATE sessions SET context = ?, last_activity = ?, updated_at = ? WHERE key = ?',
          [
            JSON.stringify(session.context),
            session.lastActivity.getTime(),
            session.updatedAt.getTime(),
            session.key,
          ],
        );
      },

      deleteSession(key: string): void {
        instance.run('DELETE FROM sessions WHERE key = ?', [key]);
      },

      listSessions(): Session[] {
        return getAll<Record<string, unknown>>(
          'SELECT id, key, user_id, platform, chat_id, chat_type, context, last_activity, created_at, updated_at FROM sessions ORDER BY updated_at DESC',
        )
          .map(parseSession)
          .filter((s): s is Session => Boolean(s));
      },

      // -- Trading Credentials --

      getTradingCredentials(userId: string, platform: Platform): UserCredentials | null {
        return parseTradingCredentials(
          getOne(
            'SELECT user_id, platform, mode, encrypted_data, enabled, failed_attempts, cooldown_until, created_at, updated_at FROM trading_credentials WHERE user_id = ? AND platform = ?',
            [userId, platform],
          ),
        );
      },

      createTradingCredentials(creds: UserCredentials): void {
        instance.run(
          'INSERT INTO trading_credentials (user_id, platform, mode, encrypted_data, enabled, failed_attempts, cooldown_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            creds.userId,
            creds.platform,
            creds.mode,
            creds.encryptedData,
            creds.enabled ? 1 : 0,
            creds.failedAttempts,
            creds.cooldownUntil?.getTime() ?? null,
            creds.createdAt.getTime(),
            creds.updatedAt.getTime(),
          ],
        );
      },

      updateTradingCredentials(creds: UserCredentials): void {
        instance.run(
          'UPDATE trading_credentials SET mode = ?, encrypted_data = ?, enabled = ?, failed_attempts = ?, cooldown_until = ?, updated_at = ? WHERE user_id = ? AND platform = ?',
          [
            creds.mode,
            creds.encryptedData,
            creds.enabled ? 1 : 0,
            creds.failedAttempts,
            creds.cooldownUntil?.getTime() ?? null,
            creds.updatedAt.getTime(),
            creds.userId,
            creds.platform,
          ],
        );
      },

      deleteTradingCredentials(userId: string, platform: Platform): void {
        instance.run(
          'DELETE FROM trading_credentials WHERE user_id = ? AND platform = ?',
          [userId, platform],
        );
      },

      // -- Products --

      getProduct(id: string): Product | undefined {
        return parseProduct(
          getOne(
            'SELECT id, upc, asin, title, brand, category, image_url, created_at, updated_at FROM products WHERE id = ?',
            [id],
          ),
        );
      },

      upsertProduct(product: Product): void {
        instance.run(
          `INSERT INTO products (id, upc, asin, title, brand, category, image_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             upc = excluded.upc,
             asin = excluded.asin,
             title = excluded.title,
             brand = excluded.brand,
             category = excluded.category,
             image_url = excluded.image_url,
             updated_at = excluded.updated_at`,
          [
            product.id,
            product.upc ?? null,
            product.asin ?? null,
            product.title,
            product.brand ?? null,
            product.category ?? null,
            product.imageUrl ?? null,
            product.createdAt.getTime(),
            product.updatedAt.getTime(),
          ],
        );
      },

      findProductByUPC(upc: string): Product | undefined {
        return parseProduct(
          getOne(
            'SELECT id, upc, asin, title, brand, category, image_url, created_at, updated_at FROM products WHERE upc = ?',
            [upc],
          ),
        );
      },

      findProductByASIN(asin: string): Product | undefined {
        return parseProduct(
          getOne(
            'SELECT id, upc, asin, title, brand, category, image_url, created_at, updated_at FROM products WHERE asin = ?',
            [asin],
          ),
        );
      },

      // -- Prices --

      addPrice(snapshot: PriceSnapshot): void {
        instance.run(
          'INSERT INTO prices (product_id, platform, platform_id, price, shipping, currency, in_stock, seller, url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            snapshot.productId,
            snapshot.platform,
            snapshot.platformId ?? null,
            snapshot.price,
            snapshot.shipping,
            snapshot.currency,
            snapshot.inStock ? 1 : 0,
            snapshot.seller ?? null,
            snapshot.url ?? null,
            snapshot.fetchedAt.getTime(),
          ],
        );
      },

      getLatestPrices(productId: string): PriceSnapshot[] {
        // Latest price per platform for this product
        return getAll<Record<string, unknown>>(
          `SELECT p.* FROM prices p
           INNER JOIN (
             SELECT platform, MAX(fetched_at) as max_fetched
             FROM prices WHERE product_id = ?
             GROUP BY platform
           ) latest ON p.platform = latest.platform AND p.fetched_at = latest.max_fetched
           WHERE p.product_id = ?
           ORDER BY p.price ASC`,
          [productId, productId],
        ).map(parsePriceSnapshot);
      },

      getPriceHistory(productId: string, platform?: Platform): PriceSnapshot[] {
        if (platform) {
          return getAll<Record<string, unknown>>(
            'SELECT * FROM prices WHERE product_id = ? AND platform = ? ORDER BY fetched_at DESC LIMIT 100',
            [productId, platform],
          ).map(parsePriceSnapshot);
        }
        return getAll<Record<string, unknown>>(
          'SELECT * FROM prices WHERE product_id = ? ORDER BY fetched_at DESC LIMIT 500',
          [productId],
        ).map(parsePriceSnapshot);
      },

      // -- Opportunities --

      addOpportunity(opp: Opportunity): void {
        instance.run(
          `INSERT INTO opportunities (id, product_id, buy_platform, buy_price, buy_shipping, sell_platform, sell_price, estimated_fees, estimated_profit, margin_pct, score, status, found_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            opp.id,
            opp.productId,
            opp.buyPlatform,
            opp.buyPrice,
            opp.buyShipping,
            opp.sellPlatform,
            opp.sellPrice,
            opp.estimatedFees,
            opp.estimatedProfit,
            opp.marginPct,
            opp.score,
            opp.status,
            opp.foundAt.getTime(),
            opp.expiresAt?.getTime() ?? null,
          ],
        );
      },

      getActiveOpportunities(limit = 50): Opportunity[] {
        return getAll<Record<string, unknown>>(
          `SELECT * FROM opportunities
           WHERE status = 'active'
             AND (expires_at IS NULL OR expires_at > ?)
           ORDER BY score DESC
           LIMIT ?`,
          [Date.now(), limit],
        ).map(parseOpportunity);
      },

      updateOpportunityStatus(id: string, status: Opportunity['status']): void {
        instance.run('UPDATE opportunities SET status = ? WHERE id = ?', [status, id]);
      },

      // -- Listings --

      addListing(listing: Listing): void {
        instance.run(
          `INSERT INTO listings (id, opportunity_id, product_id, platform, platform_listing_id, title, price, source_platform, source_price, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            listing.id,
            listing.opportunityId ?? null,
            listing.productId,
            listing.platform,
            listing.platformListingId ?? null,
            listing.title ?? null,
            listing.price,
            listing.sourcePlatform,
            listing.sourcePrice,
            listing.status,
            listing.createdAt.getTime(),
            listing.updatedAt.getTime(),
          ],
        );
      },

      getActiveListings(): Listing[] {
        return getAll<Record<string, unknown>>(
          "SELECT * FROM listings WHERE status = 'active' ORDER BY created_at DESC",
        ).map(parseListing);
      },

      updateListingStatus(id: string, status: Listing['status']): void {
        instance.run('UPDATE listings SET status = ?, updated_at = ? WHERE id = ?', [
          status,
          Date.now(),
          id,
        ]);
      },

      // -- Orders --

      addOrder(order: Order): void {
        instance.run(
          `INSERT INTO orders (id, listing_id, sell_platform, sell_order_id, sell_price, buy_platform, buy_order_id, buy_price, shipping_cost, platform_fees, profit, status, buyer_address, tracking_number, ordered_at, shipped_at, delivered_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            order.id,
            order.listingId,
            order.sellPlatform,
            order.sellOrderId ?? null,
            order.sellPrice,
            order.buyPlatform,
            order.buyOrderId ?? null,
            order.buyPrice ?? null,
            order.shippingCost ?? null,
            order.platformFees ?? null,
            order.profit ?? null,
            order.status,
            order.buyerAddress ?? null,
            order.trackingNumber ?? null,
            order.orderedAt.getTime(),
            order.shippedAt?.getTime() ?? null,
            order.deliveredAt?.getTime() ?? null,
          ],
        );
      },

      getOrder(id: string): Order | undefined {
        return parseOrder(
          getOne('SELECT * FROM orders WHERE id = ?', [id]),
        );
      },

      updateOrderStatus(
        id: string,
        status: Order['status'],
        fields?: Partial<Pick<Order, 'buyOrderId' | 'buyPrice' | 'shippingCost' | 'platformFees' | 'profit' | 'trackingNumber' | 'shippedAt' | 'deliveredAt'>>,
      ): void {
        const setClauses: string[] = ['status = ?'];
        const params: unknown[] = [status];

        if (fields) {
          if (fields.buyOrderId !== undefined) {
            setClauses.push('buy_order_id = ?');
            params.push(fields.buyOrderId);
          }
          if (fields.buyPrice !== undefined) {
            setClauses.push('buy_price = ?');
            params.push(fields.buyPrice);
          }
          if (fields.shippingCost !== undefined) {
            setClauses.push('shipping_cost = ?');
            params.push(fields.shippingCost);
          }
          if (fields.platformFees !== undefined) {
            setClauses.push('platform_fees = ?');
            params.push(fields.platformFees);
          }
          if (fields.profit !== undefined) {
            setClauses.push('profit = ?');
            params.push(fields.profit);
          }
          if (fields.trackingNumber !== undefined) {
            setClauses.push('tracking_number = ?');
            params.push(fields.trackingNumber);
          }
          if (fields.shippedAt !== undefined) {
            setClauses.push('shipped_at = ?');
            params.push(fields.shippedAt.getTime());
          }
          if (fields.deliveredAt !== undefined) {
            setClauses.push('delivered_at = ?');
            params.push(fields.deliveredAt.getTime());
          }
        }

        params.push(id);
        instance.run(
          `UPDATE orders SET ${setClauses.join(', ')} WHERE id = ?`,
          params,
        );
      },
    };

    dbInstance = instance;
    return instance;
  })();

  return dbInitPromise;
}

/**
 * Run schema migrations on an existing Database handle.
 * Currently a no-op since createDatabase() runs the schema DDL,
 * but this is the hook for future migration scripts.
 */
export function initDatabase(db: Database): void {
  // Schema is already created in createDatabase().
  // Add future ALTER TABLE / migration logic here.
  logger.info('Database schema verified');
}
