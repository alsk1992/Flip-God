import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import type {
  Product,
  PriceSnapshot,
  Opportunity,
  Listing,
  Order,
  Session,
  Platform,
} from '../types';
import type { Database } from './index';

// =============================================================================
// In-memory database helper
// =============================================================================

/**
 * We cannot use createDatabase() directly because it:
 * 1. Writes to disk (~/.flipagent/)
 * 2. Sets up backup intervals
 * 3. Is a singleton
 *
 * Instead, we create a minimal in-memory Database implementation
 * that matches the interface and runs the same schema DDL.
 */

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

  CREATE INDEX IF NOT EXISTS idx_prices_product ON prices(product_id);
  CREATE INDEX IF NOT EXISTS idx_prices_platform ON prices(platform);
  CREATE INDEX IF NOT EXISTS idx_opportunities_status ON opportunities(status);
  CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_sessions_key ON sessions(key);
`;

async function createTestDb(): Promise<{ db: Database; raw: SqlJsDatabase }> {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  raw.run(SCHEMA_SQL);

  const db: Database = {
    close() { raw.close(); },
    save() { /* no-op for in-memory */ },

    run(sql: string, params: unknown[] = []): void {
      raw.run(sql, params as any);
    },

    query<T>(sql: string, params: unknown[] = []): T[] {
      const stmt = raw.prepare(sql);
      try {
        stmt.bind(params as any);
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
      const rows = db.query<Record<string, unknown>>(
        'SELECT * FROM sessions WHERE key = ?', [key],
      );
      if (rows.length === 0) return undefined;
      const row = rows[0];
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
        lastActivity: new Date(row.last_activity as number),
        createdAt: new Date(row.created_at as number),
        updatedAt: new Date(row.updated_at as number),
      };
    },

    createSession(session: Session): void {
      db.run(
        'INSERT INTO sessions (id, key, user_id, platform, chat_id, chat_type, context, last_activity, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          session.id, session.key, session.userId, session.platform,
          session.chatId, session.chatType, JSON.stringify(session.context),
          session.lastActivity.getTime(), session.createdAt.getTime(),
          session.updatedAt.getTime(),
        ],
      );
    },

    updateSession(session: Session): void {
      db.run(
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
      db.run('DELETE FROM sessions WHERE key = ?', [key]);
    },

    listSessions(): Session[] {
      const rows = db.query<Record<string, unknown>>(
        'SELECT * FROM sessions ORDER BY updated_at DESC',
      );
      return rows.map((row) => {
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
          lastActivity: new Date(row.last_activity as number),
          createdAt: new Date(row.created_at as number),
          updatedAt: new Date(row.updated_at as number),
        };
      });
    },

    // Stubs for credential methods (not tested in detail here)
    getTradingCredentials() { return null; },
    createTradingCredentials() {},
    updateTradingCredentials() {},
    deleteTradingCredentials() {},

    // -- Products --
    getProduct(id: string): Product | undefined {
      const rows = db.query<Record<string, unknown>>(
        'SELECT * FROM products WHERE id = ?', [id],
      );
      if (rows.length === 0) return undefined;
      const row = rows[0];
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
    },

    upsertProduct(product: Product): void {
      db.run(
        `INSERT INTO products (id, upc, asin, title, brand, category, image_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           upc = excluded.upc, asin = excluded.asin, title = excluded.title,
           brand = excluded.brand, category = excluded.category,
           image_url = excluded.image_url, updated_at = excluded.updated_at`,
        [
          product.id, product.upc ?? null, product.asin ?? null,
          product.title, product.brand ?? null, product.category ?? null,
          product.imageUrl ?? null, product.createdAt.getTime(),
          product.updatedAt.getTime(),
        ],
      );
    },

    findProductByUPC(upc: string): Product | undefined {
      const rows = db.query<Record<string, unknown>>(
        'SELECT * FROM products WHERE upc = ?', [upc],
      );
      if (rows.length === 0) return undefined;
      const row = rows[0];
      return {
        id: row.id as string,
        upc: (row.upc as string) ?? undefined,
        asin: (row.asin as string) ?? undefined,
        title: row.title as string,
        brand: (row.brand as string) ?? undefined,
        category: (row.category as string) ?? undefined,
        createdAt: new Date(row.created_at as number),
        updatedAt: new Date(row.updated_at as number),
      };
    },

    findProductByASIN(asin: string): Product | undefined {
      const rows = db.query<Record<string, unknown>>(
        'SELECT * FROM products WHERE asin = ?', [asin],
      );
      if (rows.length === 0) return undefined;
      const row = rows[0];
      return {
        id: row.id as string,
        upc: (row.upc as string) ?? undefined,
        asin: (row.asin as string) ?? undefined,
        title: row.title as string,
        createdAt: new Date(row.created_at as number),
        updatedAt: new Date(row.updated_at as number),
      };
    },

    // -- Prices --
    addPrice(snapshot: PriceSnapshot): void {
      db.run(
        'INSERT INTO prices (product_id, platform, platform_id, price, shipping, currency, in_stock, seller, url, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          snapshot.productId, snapshot.platform, snapshot.platformId ?? null,
          snapshot.price, snapshot.shipping, snapshot.currency,
          snapshot.inStock ? 1 : 0, snapshot.seller ?? null,
          snapshot.url ?? null, snapshot.fetchedAt.getTime(),
        ],
      );
    },

    getLatestPrices(productId: string): PriceSnapshot[] {
      return db.query<Record<string, unknown>>(
        `SELECT p.* FROM prices p
         INNER JOIN (
           SELECT platform, MAX(fetched_at) as max_fetched
           FROM prices WHERE product_id = ?
           GROUP BY platform
         ) latest ON p.platform = latest.platform AND p.fetched_at = latest.max_fetched
         WHERE p.product_id = ?
         ORDER BY p.price ASC`,
        [productId, productId],
      ).map((row) => ({
        id: row.id as number,
        productId: row.product_id as string,
        platform: row.platform as Platform,
        price: row.price as number,
        shipping: (row.shipping as number) ?? 0,
        currency: (row.currency as string) ?? 'USD',
        inStock: Boolean(row.in_stock),
        fetchedAt: new Date(row.fetched_at as number),
      }));
    },

    getPriceHistory(productId: string, platform?: Platform): PriceSnapshot[] {
      const sql = platform
        ? 'SELECT * FROM prices WHERE product_id = ? AND platform = ? ORDER BY fetched_at DESC LIMIT 100'
        : 'SELECT * FROM prices WHERE product_id = ? ORDER BY fetched_at DESC LIMIT 500';
      const params = platform ? [productId, platform] : [productId];
      return db.query<Record<string, unknown>>(sql, params).map((row) => ({
        id: row.id as number,
        productId: row.product_id as string,
        platform: row.platform as Platform,
        price: row.price as number,
        shipping: (row.shipping as number) ?? 0,
        currency: (row.currency as string) ?? 'USD',
        inStock: Boolean(row.in_stock),
        fetchedAt: new Date(row.fetched_at as number),
      }));
    },

    // -- Opportunities --
    addOpportunity(opp: Opportunity): void {
      db.run(
        `INSERT INTO opportunities (id, product_id, buy_platform, buy_price, buy_shipping, sell_platform, sell_price, estimated_fees, estimated_profit, margin_pct, score, status, found_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          opp.id, opp.productId, opp.buyPlatform, opp.buyPrice, opp.buyShipping,
          opp.sellPlatform, opp.sellPrice, opp.estimatedFees, opp.estimatedProfit,
          opp.marginPct, opp.score, opp.status, opp.foundAt.getTime(),
          opp.expiresAt?.getTime() ?? null,
        ],
      );
    },

    getActiveOpportunities(limit = 50): Opportunity[] {
      return db.query<Record<string, unknown>>(
        `SELECT * FROM opportunities WHERE status = 'active' AND (expires_at IS NULL OR expires_at > ?) ORDER BY score DESC LIMIT ?`,
        [Date.now(), limit],
      ).map((row) => ({
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
      }));
    },

    updateOpportunityStatus(id: string, status: Opportunity['status']): void {
      db.run('UPDATE opportunities SET status = ? WHERE id = ?', [status, id]);
    },

    // -- Listings --
    addListing(listing: Listing): void {
      db.run(
        `INSERT INTO listings (id, opportunity_id, product_id, platform, platform_listing_id, title, price, source_platform, source_price, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          listing.id, listing.opportunityId ?? null, listing.productId,
          listing.platform, listing.platformListingId ?? null, listing.title ?? null,
          listing.price, listing.sourcePlatform, listing.sourcePrice,
          listing.status, listing.createdAt.getTime(), listing.updatedAt.getTime(),
        ],
      );
    },

    getActiveListings(): Listing[] {
      return db.query<Record<string, unknown>>(
        "SELECT * FROM listings WHERE status = 'active' ORDER BY created_at DESC",
      ).map((row) => ({
        id: row.id as string,
        productId: row.product_id as string,
        platform: row.platform as Platform,
        price: row.price as number,
        sourcePlatform: row.source_platform as Platform,
        sourcePrice: row.source_price as number,
        status: (row.status as Listing['status']) ?? 'active',
        createdAt: new Date(row.created_at as number),
        updatedAt: new Date(row.updated_at as number),
      }));
    },

    updateListingStatus(id: string, status: Listing['status']): void {
      db.run('UPDATE listings SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), id]);
    },

    // -- Orders --
    addOrder(order: Order): void {
      db.run(
        `INSERT INTO orders (id, listing_id, sell_platform, sell_order_id, sell_price, buy_platform, buy_order_id, buy_price, shipping_cost, platform_fees, profit, status, buyer_address, tracking_number, ordered_at, shipped_at, delivered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          order.id, order.listingId, order.sellPlatform, order.sellOrderId ?? null,
          order.sellPrice, order.buyPlatform, order.buyOrderId ?? null,
          order.buyPrice ?? null, order.shippingCost ?? null,
          order.platformFees ?? null, order.profit ?? null, order.status,
          order.buyerAddress ?? null, order.trackingNumber ?? null,
          order.orderedAt.getTime(), order.shippedAt?.getTime() ?? null,
          order.deliveredAt?.getTime() ?? null,
        ],
      );
    },

    getOrder(id: string): Order | undefined {
      const rows = db.query<Record<string, unknown>>('SELECT * FROM orders WHERE id = ?', [id]);
      if (rows.length === 0) return undefined;
      const row = rows[0];
      return {
        id: row.id as string,
        listingId: row.listing_id as string,
        sellPlatform: row.sell_platform as Platform,
        sellPrice: row.sell_price as number,
        buyPlatform: row.buy_platform as Platform,
        status: (row.status as Order['status']) ?? 'pending',
        orderedAt: new Date(row.ordered_at as number),
        buyPrice: row.buy_price != null ? (row.buy_price as number) : undefined,
        shippingCost: row.shipping_cost != null ? (row.shipping_cost as number) : undefined,
        platformFees: row.platform_fees != null ? (row.platform_fees as number) : undefined,
        profit: row.profit != null ? (row.profit as number) : undefined,
        trackingNumber: (row.tracking_number as string) ?? undefined,
        shippedAt: row.shipped_at ? new Date(row.shipped_at as number) : undefined,
        deliveredAt: row.delivered_at ? new Date(row.delivered_at as number) : undefined,
      };
    },

    updateOrderStatus(
      id: string,
      status: Order['status'],
      fields?: Partial<Pick<Order, 'buyOrderId' | 'buyPrice' | 'shippingCost' | 'platformFees' | 'profit' | 'trackingNumber' | 'shippedAt' | 'deliveredAt'>>,
    ): void {
      const setClauses: string[] = ['status = ?'];
      const params: unknown[] = [status];
      if (fields) {
        if (fields.buyPrice !== undefined) { setClauses.push('buy_price = ?'); params.push(fields.buyPrice); }
        if (fields.shippingCost !== undefined) { setClauses.push('shipping_cost = ?'); params.push(fields.shippingCost); }
        if (fields.trackingNumber !== undefined) { setClauses.push('tracking_number = ?'); params.push(fields.trackingNumber); }
        if (fields.shippedAt !== undefined) { setClauses.push('shipped_at = ?'); params.push(fields.shippedAt.getTime()); }
      }
      params.push(id);
      db.run(`UPDATE orders SET ${setClauses.join(', ')} WHERE id = ?`, params);
    },
  };

  return { db, raw };
}

// =============================================================================
// Tests
// =============================================================================

describe('Database CRUD Operations', () => {
  let db: Database;
  let raw: SqlJsDatabase;

  beforeEach(async () => {
    const result = await createTestDb();
    db = result.db;
    raw = result.raw;
  });

  afterEach(() => {
    try { raw.close(); } catch { /* ignore double-close */ }
  });

  // -- Products --

  describe('Products', () => {
    const now = new Date();

    it('creates and retrieves a product', () => {
      const product: Product = {
        id: 'prod-1',
        title: 'Test Widget',
        upc: '123456789',
        asin: 'B0001',
        brand: 'TestBrand',
        category: 'electronics',
        createdAt: now,
        updatedAt: now,
      };

      db.upsertProduct(product);
      const found = db.getProduct('prod-1');

      expect(found).toBeDefined();
      expect(found!.id).toBe('prod-1');
      expect(found!.title).toBe('Test Widget');
      expect(found!.upc).toBe('123456789');
      expect(found!.asin).toBe('B0001');
      expect(found!.brand).toBe('TestBrand');
    });

    it('returns undefined for non-existent product', () => {
      const found = db.getProduct('non-existent');
      expect(found).toBeUndefined();
    });

    it('upserts (updates existing) product', () => {
      const product: Product = {
        id: 'prod-1',
        title: 'Original',
        createdAt: now,
        updatedAt: now,
      };
      db.upsertProduct(product);

      const updated: Product = {
        id: 'prod-1',
        title: 'Updated',
        createdAt: now,
        updatedAt: new Date(),
      };
      db.upsertProduct(updated);

      const found = db.getProduct('prod-1');
      expect(found!.title).toBe('Updated');
    });

    it('finds product by UPC', () => {
      db.upsertProduct({
        id: 'prod-upc',
        title: 'UPC Product',
        upc: '999888777',
        createdAt: now,
        updatedAt: now,
      });

      const found = db.findProductByUPC('999888777');
      expect(found).toBeDefined();
      expect(found!.id).toBe('prod-upc');
    });

    it('finds product by ASIN', () => {
      db.upsertProduct({
        id: 'prod-asin',
        title: 'ASIN Product',
        asin: 'B00TEST',
        createdAt: now,
        updatedAt: now,
      });

      const found = db.findProductByASIN('B00TEST');
      expect(found).toBeDefined();
      expect(found!.id).toBe('prod-asin');
    });
  });

  // -- Prices --

  describe('Prices', () => {
    const now = new Date();

    beforeEach(() => {
      db.upsertProduct({
        id: 'prod-1',
        title: 'Test Product',
        createdAt: now,
        updatedAt: now,
      });
    });

    it('adds and retrieves price snapshots', () => {
      db.addPrice({
        productId: 'prod-1',
        platform: 'amazon',
        price: 29.99,
        shipping: 3.99,
        currency: 'USD',
        inStock: true,
        fetchedAt: now,
      });

      const prices = db.getPriceHistory('prod-1');
      expect(prices.length).toBe(1);
      expect(prices[0].price).toBe(29.99);
      expect(prices[0].shipping).toBe(3.99);
      expect(prices[0].platform).toBe('amazon');
    });

    it('gets latest prices per platform', () => {
      const t1 = new Date('2025-01-01');
      const t2 = new Date('2025-01-02');

      db.addPrice({
        productId: 'prod-1', platform: 'amazon', price: 30,
        shipping: 0, currency: 'USD', inStock: true, fetchedAt: t1,
      });
      db.addPrice({
        productId: 'prod-1', platform: 'amazon', price: 25,
        shipping: 0, currency: 'USD', inStock: true, fetchedAt: t2,
      });
      db.addPrice({
        productId: 'prod-1', platform: 'ebay', price: 35,
        shipping: 5, currency: 'USD', inStock: true, fetchedAt: t2,
      });

      const latest = db.getLatestPrices('prod-1');
      expect(latest.length).toBe(2); // One per platform

      const amazonLatest = latest.find(p => p.platform === 'amazon');
      expect(amazonLatest!.price).toBe(25); // Latest Amazon price
    });

    it('filters price history by platform', () => {
      db.addPrice({
        productId: 'prod-1', platform: 'amazon', price: 30,
        shipping: 0, currency: 'USD', inStock: true, fetchedAt: now,
      });
      db.addPrice({
        productId: 'prod-1', platform: 'ebay', price: 35,
        shipping: 0, currency: 'USD', inStock: true, fetchedAt: now,
      });

      const amazonPrices = db.getPriceHistory('prod-1', 'amazon');
      expect(amazonPrices.length).toBe(1);
      expect(amazonPrices[0].platform).toBe('amazon');
    });
  });

  // -- Opportunities --

  describe('Opportunities', () => {
    const now = new Date();

    beforeEach(() => {
      db.upsertProduct({
        id: 'prod-1', title: 'Test', createdAt: now, updatedAt: now,
      });
    });

    it('creates and retrieves active opportunities', () => {
      const opp: Opportunity = {
        id: 'opp-1',
        productId: 'prod-1',
        buyPlatform: 'amazon',
        buyPrice: 20,
        buyShipping: 0,
        sellPlatform: 'ebay',
        sellPrice: 40,
        estimatedFees: 5.5,
        estimatedProfit: 14.5,
        marginPct: 36.25,
        score: 50,
        status: 'active',
        foundAt: now,
      };

      db.addOpportunity(opp);
      const active = db.getActiveOpportunities();

      expect(active.length).toBe(1);
      expect(active[0].id).toBe('opp-1');
      expect(active[0].buyPlatform).toBe('amazon');
      expect(active[0].sellPlatform).toBe('ebay');
      expect(active[0].estimatedProfit).toBe(14.5);
    });

    it('updates opportunity status', () => {
      db.addOpportunity({
        id: 'opp-1', productId: 'prod-1', buyPlatform: 'amazon',
        buyPrice: 20, buyShipping: 0, sellPlatform: 'ebay',
        sellPrice: 40, estimatedFees: 5, estimatedProfit: 15,
        marginPct: 37.5, score: 50, status: 'active', foundAt: now,
      });

      db.updateOpportunityStatus('opp-1', 'listed');

      const active = db.getActiveOpportunities();
      expect(active.length).toBe(0); // No longer active
    });

    it('excludes expired opportunities', () => {
      const pastDate = new Date(Date.now() - 86400000); // Yesterday
      db.addOpportunity({
        id: 'opp-expired', productId: 'prod-1', buyPlatform: 'amazon',
        buyPrice: 20, buyShipping: 0, sellPlatform: 'ebay',
        sellPrice: 40, estimatedFees: 5, estimatedProfit: 15,
        marginPct: 37.5, score: 50, status: 'active', foundAt: pastDate,
        expiresAt: pastDate, // Expired yesterday
      });

      const active = db.getActiveOpportunities();
      expect(active.length).toBe(0);
    });
  });

  // -- Listings --

  describe('Listings', () => {
    const now = new Date();

    beforeEach(() => {
      db.upsertProduct({
        id: 'prod-1', title: 'Test', createdAt: now, updatedAt: now,
      });
    });

    it('creates and retrieves active listings', () => {
      const listing: Listing = {
        id: 'list-1',
        productId: 'prod-1',
        platform: 'ebay',
        price: 45,
        sourcePlatform: 'amazon',
        sourcePrice: 25,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };

      db.addListing(listing);
      const active = db.getActiveListings();

      expect(active.length).toBe(1);
      expect(active[0].id).toBe('list-1');
      expect(active[0].price).toBe(45);
    });

    it('updates listing status', () => {
      db.addListing({
        id: 'list-1', productId: 'prod-1', platform: 'ebay',
        price: 45, sourcePlatform: 'amazon', sourcePrice: 25,
        status: 'active', createdAt: now, updatedAt: now,
      });

      db.updateListingStatus('list-1', 'sold');

      const active = db.getActiveListings();
      expect(active.length).toBe(0);
    });
  });

  // -- Orders --

  describe('Orders', () => {
    const now = new Date();

    beforeEach(() => {
      db.upsertProduct({
        id: 'prod-1', title: 'Test', createdAt: now, updatedAt: now,
      });
      db.addListing({
        id: 'list-1', productId: 'prod-1', platform: 'ebay',
        price: 45, sourcePlatform: 'amazon', sourcePrice: 25,
        status: 'active', createdAt: now, updatedAt: now,
      });
    });

    it('creates and retrieves an order', () => {
      const order: Order = {
        id: 'order-1',
        listingId: 'list-1',
        sellPlatform: 'ebay',
        sellPrice: 45,
        buyPlatform: 'amazon',
        status: 'pending',
        orderedAt: now,
      };

      db.addOrder(order);
      const found = db.getOrder('order-1');

      expect(found).toBeDefined();
      expect(found!.id).toBe('order-1');
      expect(found!.sellPrice).toBe(45);
      expect(found!.status).toBe('pending');
    });

    it('returns undefined for non-existent order', () => {
      const found = db.getOrder('non-existent');
      expect(found).toBeUndefined();
    });

    it('updates order status and fields', () => {
      db.addOrder({
        id: 'order-1', listingId: 'list-1', sellPlatform: 'ebay',
        sellPrice: 45, buyPlatform: 'amazon', status: 'pending',
        orderedAt: now,
      });

      db.updateOrderStatus('order-1', 'shipped', {
        trackingNumber: 'TRACK123',
        shippedAt: now,
        buyPrice: 25,
      });

      const found = db.getOrder('order-1');
      expect(found!.status).toBe('shipped');
      expect(found!.trackingNumber).toBe('TRACK123');
      expect(found!.buyPrice).toBe(25);
    });

    it('transitions order through full lifecycle', () => {
      db.addOrder({
        id: 'order-1', listingId: 'list-1', sellPlatform: 'ebay',
        sellPrice: 45, buyPlatform: 'amazon', status: 'pending',
        orderedAt: now,
      });

      // pending -> purchased
      db.updateOrderStatus('order-1', 'purchased', { buyPrice: 25 });
      let order = db.getOrder('order-1');
      expect(order!.status).toBe('purchased');

      // purchased -> shipped
      db.updateOrderStatus('order-1', 'shipped', {
        trackingNumber: 'TRACK123',
        shippedAt: now,
      });
      order = db.getOrder('order-1');
      expect(order!.status).toBe('shipped');

      // shipped -> delivered
      db.updateOrderStatus('order-1', 'delivered');
      order = db.getOrder('order-1');
      expect(order!.status).toBe('delivered');
    });
  });

  // -- Sessions --

  describe('Sessions', () => {
    const now = new Date();

    it('creates and retrieves a session', () => {
      const session: Session = {
        id: 'sess-1',
        key: 'discord:user1:chan1',
        userId: 'user1',
        platform: 'discord',
        chatId: 'chan1',
        chatType: 'dm',
        context: {
          messageCount: 0,
          preferences: {},
          conversationHistory: [],
        },
        history: [],
        lastActivity: now,
        createdAt: now,
        updatedAt: now,
      };

      db.createSession(session);
      const found = db.getSession('discord:user1:chan1');

      expect(found).toBeDefined();
      expect(found!.id).toBe('sess-1');
      expect(found!.userId).toBe('user1');
      expect(found!.platform).toBe('discord');
    });

    it('updates session context', () => {
      const session: Session = {
        id: 'sess-1',
        key: 'test:key',
        userId: 'user1',
        platform: 'test',
        chatId: 'chat1',
        chatType: 'dm',
        context: { messageCount: 0, preferences: {}, conversationHistory: [] },
        history: [],
        lastActivity: now,
        createdAt: now,
        updatedAt: now,
      };

      db.createSession(session);

      session.context.messageCount = 5;
      session.updatedAt = new Date();
      db.updateSession(session);

      const found = db.getSession('test:key');
      expect(found!.context.messageCount).toBe(5);
    });

    it('deletes a session', () => {
      db.createSession({
        id: 'sess-1', key: 'test:key', userId: 'user1',
        platform: 'test', chatId: 'chat1', chatType: 'dm',
        context: { messageCount: 0, preferences: {}, conversationHistory: [] },
        history: [], lastActivity: now, createdAt: now, updatedAt: now,
      });

      db.deleteSession('test:key');
      const found = db.getSession('test:key');
      expect(found).toBeUndefined();
    });

    it('lists all sessions', () => {
      db.createSession({
        id: 'sess-1', key: 'key:1', userId: 'user1',
        platform: 'test', chatId: 'chat1', chatType: 'dm',
        context: { messageCount: 0, preferences: {}, conversationHistory: [] },
        history: [], lastActivity: now, createdAt: now, updatedAt: now,
      });
      db.createSession({
        id: 'sess-2', key: 'key:2', userId: 'user2',
        platform: 'test', chatId: 'chat2', chatType: 'group',
        context: { messageCount: 0, preferences: {}, conversationHistory: [] },
        history: [], lastActivity: now, createdAt: now, updatedAt: now,
      });

      const sessions = db.listSessions();
      expect(sessions.length).toBe(2);
    });
  });

  // -- Raw SQL --

  describe('Raw SQL', () => {
    it('executes raw SQL with run()', () => {
      db.run("INSERT INTO products (id, title) VALUES ('raw-1', 'Raw Product')");
      const found = db.getProduct('raw-1');
      expect(found).toBeDefined();
      expect(found!.title).toBe('Raw Product');
    });

    it('queries with query()', () => {
      db.run("INSERT INTO products (id, title) VALUES ('q-1', 'Query Product')");
      const rows = db.query<{ id: string; title: string }>(
        'SELECT id, title FROM products WHERE id = ?',
        ['q-1'],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].title).toBe('Query Product');
    });
  });
});
