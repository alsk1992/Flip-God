/**
 * Dashboard API Routes
 *
 * Express router providing JSON endpoints for the FlipAgent web dashboard.
 * All routes query the SQLite database via req.app.locals.db.
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import type { Database } from '../db';

const logger = createLogger('dashboard-api');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely extract a number from a DB row field, defaulting to 0. */
function num(value: unknown): number {
  return Number(value) || 0;
}

/** Get the Database instance from Express app locals, or null. */
function getDb(req: Request): Database | null {
  return (req.app.locals.db as Database) ?? null;
}

/** Epoch ms for the start of today (UTC). */
function todayStartMs(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

/** Epoch ms for N days ago (UTC midnight). */
function daysAgoMs(n: number): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.getTime();
}

/** Epoch ms for start of this week (Monday UTC). */
function weekStartMs(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1; // shift so Monday=0
  d.setUTCDate(d.getUTCDate() - diff);
  return d.getTime();
}

/** Epoch ms for start of this month (UTC). */
function monthStartMs(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(1);
  return d.getTime();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createDashboardRouter(): Router {
  const router = Router();

  // -------------------------------------------------------------------------
  // GET /overview — key metrics
  // -------------------------------------------------------------------------
  router.get('/overview', (req: Request, res: Response) => {
    const db = getDb(req);
    if (!db) return res.status(503).json({ error: 'Database not available' });

    try {
      const totalProducts = num(
        db.query<{ cnt: number }>('SELECT COUNT(*) as cnt FROM products')[0]?.cnt,
      );
      const activeListings = num(
        db.query<{ cnt: number }>("SELECT COUNT(*) as cnt FROM listings WHERE status = 'active'")[0]
          ?.cnt,
      );
      const openOrders = num(
        db.query<{ cnt: number }>(
          "SELECT COUNT(*) as cnt FROM orders WHERE status IN ('pending','ordered','shipped')",
        )[0]?.cnt,
      );
      const pendingArbitrage = num(
        db.query<{ cnt: number }>(
          "SELECT COUNT(*) as cnt FROM opportunities WHERE status = 'active'",
        )[0]?.cnt,
      );

      // Revenue & profit time windows
      const todayMs = todayStartMs();
      const weekMs = weekStartMs();
      const mthMs = monthStartMs();

      const revenueToday = num(
        db.query<{ v: number | null }>(
          'SELECT SUM(sell_price) as v FROM orders WHERE ordered_at >= ?',
          [todayMs],
        )[0]?.v,
      );
      const revenueWeek = num(
        db.query<{ v: number | null }>(
          'SELECT SUM(sell_price) as v FROM orders WHERE ordered_at >= ?',
          [weekMs],
        )[0]?.v,
      );
      const revenueMonth = num(
        db.query<{ v: number | null }>(
          'SELECT SUM(sell_price) as v FROM orders WHERE ordered_at >= ?',
          [mthMs],
        )[0]?.v,
      );

      const profitToday = num(
        db.query<{ v: number | null }>(
          'SELECT SUM(profit) as v FROM orders WHERE profit IS NOT NULL AND ordered_at >= ?',
          [todayMs],
        )[0]?.v,
      );
      const profitWeek = num(
        db.query<{ v: number | null }>(
          'SELECT SUM(profit) as v FROM orders WHERE profit IS NOT NULL AND ordered_at >= ?',
          [weekMs],
        )[0]?.v,
      );
      const profitMonth = num(
        db.query<{ v: number | null }>(
          'SELECT SUM(profit) as v FROM orders WHERE profit IS NOT NULL AND ordered_at >= ?',
          [mthMs],
        )[0]?.v,
      );

      // Active scout configs
      let activeScouts = 0;
      try {
        activeScouts = num(
          db.query<{ cnt: number }>(
            "SELECT COUNT(*) as cnt FROM scout_configs WHERE enabled = 1",
          )[0]?.cnt,
        );
      } catch {
        // table may not exist yet
      }

      // Active repricing configs
      let activeRepricingConfigs = 0;
      try {
        activeRepricingConfigs = num(
          db.query<{ cnt: number }>(
            "SELECT COUNT(*) as cnt FROM repricing_rules_v2 WHERE enabled = 1",
          )[0]?.cnt,
        );
      } catch {
        // table may not exist yet
      }

      res.json({
        totalProducts,
        activeListings,
        openOrders,
        pendingArbitrage,
        revenueToday,
        revenueWeek,
        revenueMonth,
        profitToday,
        profitWeek,
        profitMonth,
        activeScouts,
        activeRepricingConfigs,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch overview');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /orders/recent — last 20 orders
  // -------------------------------------------------------------------------
  router.get('/orders/recent', (req: Request, res: Response) => {
    const db = getDb(req);
    if (!db) return res.status(503).json({ error: 'Database not available' });

    try {
      const orders = db.query<Record<string, unknown>>(
        `SELECT id, listing_id, sell_platform, sell_order_id, sell_price,
                buy_platform, buy_price, shipping_cost, platform_fees, profit,
                status, tracking_number, ordered_at, shipped_at, delivered_at
         FROM orders ORDER BY ordered_at DESC LIMIT 20`,
      );
      res.json({ orders });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch recent orders');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /listings/active — active listings
  // -------------------------------------------------------------------------
  router.get('/listings/active', (req: Request, res: Response) => {
    const db = getDb(req);
    if (!db) return res.status(503).json({ error: 'Database not available' });

    try {
      const listings = db.query<Record<string, unknown>>(
        `SELECT l.id, l.product_id, l.platform, l.platform_listing_id,
                l.title, l.price, l.source_platform, l.source_price,
                l.status, l.created_at, l.updated_at,
                p.title as product_title, p.image_url
         FROM listings l
         LEFT JOIN products p ON l.product_id = p.id
         WHERE l.status = 'active'
         ORDER BY l.updated_at DESC
         LIMIT 50`,
      );
      res.json({ listings });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch active listings');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /arbitrage/pipeline — scout queue grouped by status
  // -------------------------------------------------------------------------
  router.get('/arbitrage/pipeline', (req: Request, res: Response) => {
    const db = getDb(req);
    if (!db) return res.status(503).json({ error: 'Database not available' });

    try {
      let statusCounts: Array<{ status: string; cnt: number }> = [];
      try {
        statusCounts = db.query<{ status: string; cnt: number }>(
          'SELECT status, COUNT(*) as cnt FROM scout_queue GROUP BY status ORDER BY cnt DESC',
        );
      } catch {
        // scout_queue table may not exist
      }

      let recentItems: Array<Record<string, unknown>> = [];
      try {
        recentItems = db.query<Record<string, unknown>>(
          `SELECT id, source_platform, target_platform, product_name,
                  source_price, target_price, estimated_margin_pct,
                  estimated_profit, status, created_at
           FROM scout_queue
           ORDER BY created_at DESC
           LIMIT 20`,
        );
      } catch {
        // scout_queue table may not exist
      }

      // Also include active opportunities
      const opportunities = db.query<Record<string, unknown>>(
        `SELECT id, product_id, buy_platform, buy_price, sell_platform,
                sell_price, estimated_profit, margin_pct, score, status, found_at
         FROM opportunities
         WHERE status = 'active'
         ORDER BY score DESC
         LIMIT 20`,
      );

      res.json({
        scoutStatusCounts: statusCounts,
        recentScoutItems: recentItems,
        activeOpportunities: opportunities,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch arbitrage pipeline');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /inventory/low-stock — products below reorder point
  // -------------------------------------------------------------------------
  router.get('/inventory/low-stock', (req: Request, res: Response) => {
    const db = getDb(req);
    if (!db) return res.status(503).json({ error: 'Database not available' });

    try {
      // warehouse_inventory tracks quantity per SKU per warehouse
      // Low stock = available quantity (quantity - reserved) <= 2
      let lowStock: Array<Record<string, unknown>> = [];
      try {
        lowStock = db.query<Record<string, unknown>>(
          `SELECT wi.id, wi.sku, wi.product_id, wi.quantity, wi.reserved,
                  w.name as warehouse_name, p.title as product_title
           FROM warehouse_inventory wi
           LEFT JOIN warehouses w ON wi.warehouse_id = w.id
           LEFT JOIN products p ON wi.product_id = p.id
           WHERE wi.quantity > 0 AND (wi.quantity - wi.reserved) <= 2
           ORDER BY (wi.quantity - wi.reserved) ASC
           LIMIT 20`,
        );
      } catch {
        // warehouse tables may not exist
      }

      // Also flag active listings with no inventory backing
      let unbacked: Array<Record<string, unknown>> = [];
      try {
        unbacked = db.query<Record<string, unknown>>(
          `SELECT l.id, l.title, l.platform, l.price, l.product_id
           FROM listings l
           WHERE l.status = 'active'
             AND l.product_id NOT IN (
               SELECT DISTINCT product_id FROM warehouse_inventory
               WHERE product_id IS NOT NULL AND quantity > 0
             )
           LIMIT 10`,
        );
      } catch {
        // may not have warehouse tables
      }

      res.json({ lowStock, unbackedListings: unbacked });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch low stock');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /revenue/chart — daily revenue for last 30 days
  // -------------------------------------------------------------------------
  router.get('/revenue/chart', (req: Request, res: Response) => {
    const db = getDb(req);
    if (!db) return res.status(503).json({ error: 'Database not available' });

    try {
      const thirtyDaysAgo = daysAgoMs(30);

      // ordered_at is stored as epoch ms; divide by 86400000 for day bucket
      const rows = db.query<{ day_bucket: number; revenue: number; order_count: number }>(
        `SELECT (ordered_at / 86400000) as day_bucket,
                SUM(sell_price) as revenue,
                COUNT(*) as order_count
         FROM orders
         WHERE ordered_at >= ?
         GROUP BY day_bucket
         ORDER BY day_bucket ASC`,
        [thirtyDaysAgo],
      );

      const data = rows.map((r) => ({
        date: new Date(num(r.day_bucket) * 86400000).toISOString().slice(0, 10),
        revenue: num(r.revenue),
        orders: num(r.order_count),
      }));

      res.json({ data });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch revenue chart');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /profit/chart — daily profit for last 30 days
  // -------------------------------------------------------------------------
  router.get('/profit/chart', (req: Request, res: Response) => {
    const db = getDb(req);
    if (!db) return res.status(503).json({ error: 'Database not available' });

    try {
      const thirtyDaysAgo = daysAgoMs(30);

      const rows = db.query<{ day_bucket: number; profit: number; order_count: number }>(
        `SELECT (ordered_at / 86400000) as day_bucket,
                SUM(profit) as profit,
                COUNT(*) as order_count
         FROM orders
         WHERE profit IS NOT NULL AND ordered_at >= ?
         GROUP BY day_bucket
         ORDER BY day_bucket ASC`,
        [thirtyDaysAgo],
      );

      const data = rows.map((r) => ({
        date: new Date(num(r.day_bucket) * 86400000).toISOString().slice(0, 10),
        profit: num(r.profit),
        orders: num(r.order_count),
      }));

      res.json({ data });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch profit chart');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /alerts/recent — last 20 alerts
  // -------------------------------------------------------------------------
  router.get('/alerts/recent', (req: Request, res: Response) => {
    const db = getDb(req);
    if (!db) return res.status(503).json({ error: 'Database not available' });

    try {
      let alerts: Array<Record<string, unknown>> = [];
      try {
        alerts = db.query<Record<string, unknown>>(
          `SELECT id, user_id, type, product_id, platform,
                  old_value, new_value, threshold, message, read, created_at
           FROM alerts
           ORDER BY created_at DESC
           LIMIT 20`,
        );
      } catch {
        // alerts table may not exist
      }

      res.json({ alerts });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch recent alerts');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /fulfillment/pipeline — order status counts (fulfillment chain)
  // -------------------------------------------------------------------------
  router.get('/fulfillment/pipeline', (req: Request, res: Response) => {
    const db = getDb(req);
    if (!db) return res.status(503).json({ error: 'Database not available' });

    try {
      const statusCounts = db.query<{ status: string; cnt: number }>(
        'SELECT status, COUNT(*) as cnt FROM orders GROUP BY status ORDER BY cnt DESC',
      );

      const recentShipments = db.query<Record<string, unknown>>(
        `SELECT id, listing_id, sell_platform, buy_platform, status,
                tracking_number, ordered_at, shipped_at, delivered_at
         FROM orders
         WHERE status IN ('shipped', 'delivered')
         ORDER BY shipped_at DESC
         LIMIT 10`,
      );

      res.json({
        statusCounts: statusCounts.map((r) => ({
          status: r.status,
          count: num(r.cnt),
        })),
        recentShipments,
      });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch fulfillment pipeline');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /suppliers/top — top 5 suppliers by spend
  // -------------------------------------------------------------------------
  router.get('/suppliers/top', (req: Request, res: Response) => {
    const db = getDb(req);
    if (!db) return res.status(503).json({ error: 'Database not available' });

    try {
      let suppliers: Array<Record<string, unknown>> = [];
      try {
        suppliers = db.query<Record<string, unknown>>(
          `SELECT id, name, platform, total_orders, total_spent, rating, status,
                  last_order_at
           FROM suppliers
           WHERE status = 'active'
           ORDER BY total_spent DESC
           LIMIT 5`,
        );
      } catch {
        // suppliers table may not exist
      }

      res.json({ suppliers });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch top suppliers');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // -------------------------------------------------------------------------
  // GET /demand/top — top 10 products by demand score
  // -------------------------------------------------------------------------
  router.get('/demand/top', (req: Request, res: Response) => {
    const db = getDb(req);
    if (!db) return res.status(503).json({ error: 'Database not available' });

    try {
      let demandItems: Array<Record<string, unknown>> = [];
      try {
        demandItems = db.query<Record<string, unknown>>(
          `SELECT ds.id, ds.product_id, ds.overall_score, ds.recommendation,
                  ds.confidence, ds.calculated_at,
                  p.title as product_title, p.category, p.image_url
           FROM demand_scores ds
           LEFT JOIN products p ON ds.product_id = p.id
           ORDER BY ds.overall_score DESC
           LIMIT 10`,
        );
      } catch {
        // demand_scores table may not exist
      }

      res.json({ items: demandItems });
    } catch (err) {
      logger.error({ err }, 'Failed to fetch top demand');
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
