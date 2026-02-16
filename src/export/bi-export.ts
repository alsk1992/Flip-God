/**
 * BI Tool Integration - Export denormalized flat tables for analysis
 *
 * Generates data in formats optimized for Tableau, Power BI, Looker, etc.
 * Supports CSV and JSON Lines (JSONL) output.
 */

import type { Database } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { generateCSV, formatDate, round2 } from './formats.js';
import type {
  OrderFlat,
  InventoryFlat,
  PricingFlat,
  PerformanceFlat,
  BIExportOptions,
  BIExportFormat,
  DashboardData,
  TableSchema,
  ColumnSchema,
} from './bi-types.js';

const logger = createLogger('bi-export');

// =============================================================================
// HELPERS
// =============================================================================

function parseDateRange(
  startDate?: string,
  endDate?: string,
): { startMs: number; endMs: number } {
  const now = Date.now();
  let startMs = now - 30 * 24 * 60 * 60 * 1000;
  let endMs = now;

  if (startDate) {
    const parsed = new Date(startDate).getTime();
    if (Number.isFinite(parsed)) startMs = parsed;
  }

  if (endDate) {
    const parsed = new Date(endDate).getTime();
    if (Number.isFinite(parsed)) endMs = parsed;
  }

  return { startMs, endMs };
}

function toJSONL(rows: Array<Record<string, unknown>>): string {
  return rows.map((row) => JSON.stringify(row)).join('\n');
}

function safeMargin(profit: number | null, sellPrice: number): number | null {
  if (profit === null || !Number.isFinite(profit)) return null;
  if (!Number.isFinite(sellPrice) || sellPrice === 0) return null;
  return round2((profit / sellPrice) * 100);
}

// =============================================================================
// FLAT TABLE GENERATORS
// =============================================================================

function exportOrdersFlat(
  db: Database,
  startMs: number,
  endMs: number,
): OrderFlat[] {
  const rows = db.query<Record<string, unknown>>(
    `SELECT
       o.id as order_id,
       o.ordered_at,
       o.status as order_status,
       o.sell_platform,
       o.sell_price,
       o.buy_platform,
       o.buy_price,
       o.shipping_cost,
       o.platform_fees,
       o.profit,
       o.tracking_number,
       o.shipped_at,
       o.delivered_at,
       l.product_id,
       p.title as product_title,
       p.brand as product_brand,
       p.category as product_category
     FROM orders o
     LEFT JOIN listings l ON o.listing_id = l.id
     LEFT JOIN products p ON l.product_id = p.id
     WHERE o.ordered_at >= ? AND o.ordered_at <= ?
     ORDER BY o.ordered_at ASC`,
    [startMs, endMs],
  );

  return rows.map((r) => {
    const sellPrice = Number(r.sell_price) || 0;
    const profit = r.profit !== null && r.profit !== undefined ? Number(r.profit) : null;

    return {
      order_id: String(r.order_id ?? ''),
      order_date: formatDate(Number(r.ordered_at), 'iso'),
      order_status: String(r.order_status ?? ''),
      sell_platform: String(r.sell_platform ?? ''),
      sell_price: round2(sellPrice),
      buy_platform: String(r.buy_platform ?? ''),
      buy_price: r.buy_price !== null && r.buy_price !== undefined ? round2(Number(r.buy_price)) : null,
      shipping_cost: r.shipping_cost !== null && r.shipping_cost !== undefined ? round2(Number(r.shipping_cost)) : null,
      platform_fees: r.platform_fees !== null && r.platform_fees !== undefined ? round2(Number(r.platform_fees)) : null,
      profit: profit !== null ? round2(profit) : null,
      profit_margin_pct: safeMargin(profit, sellPrice),
      product_id: r.product_id !== null && r.product_id !== undefined ? String(r.product_id) : null,
      product_title: r.product_title !== null && r.product_title !== undefined ? String(r.product_title) : null,
      product_brand: r.product_brand !== null && r.product_brand !== undefined ? String(r.product_brand) : null,
      product_category: r.product_category !== null && r.product_category !== undefined ? String(r.product_category) : null,
      tracking_number: r.tracking_number !== null && r.tracking_number !== undefined ? String(r.tracking_number) : null,
      shipped_at: r.shipped_at ? formatDate(Number(r.shipped_at), 'iso') : null,
      delivered_at: r.delivered_at ? formatDate(Number(r.delivered_at), 'iso') : null,
    };
  });
}

function exportInventoryFlat(db: Database): InventoryFlat[] {
  const rows = db.query<Record<string, unknown>>(
    `SELECT
       l.id as listing_id,
       l.product_id,
       p.title as product_title,
       p.brand as product_brand,
       p.category as product_category,
       l.platform,
       l.price as current_price,
       l.source_platform,
       l.source_price,
       l.status as listing_status,
       l.created_at as listing_created_at
     FROM listings l
     LEFT JOIN products p ON l.product_id = p.id
     WHERE l.status = 'active'
     ORDER BY l.created_at DESC`,
  );

  return rows.map((r) => ({
    product_id: String(r.product_id ?? ''),
    product_title: String(r.product_title ?? ''),
    product_brand: r.product_brand !== null && r.product_brand !== undefined ? String(r.product_brand) : null,
    product_category: r.product_category !== null && r.product_category !== undefined ? String(r.product_category) : null,
    platform: String(r.platform ?? ''),
    current_price: round2(Number(r.current_price) || 0),
    source_platform: String(r.source_platform ?? ''),
    source_price: round2(Number(r.source_price) || 0),
    listing_status: String(r.listing_status ?? ''),
    listing_created_at: formatDate(Number(r.listing_created_at), 'iso'),
  }));
}

function exportPricingFlat(
  db: Database,
  startMs: number,
  endMs: number,
): PricingFlat[] {
  const rows = db.query<Record<string, unknown>>(
    `SELECT
       pr.product_id,
       p.title as product_title,
       pr.platform,
       pr.price,
       pr.shipping,
       pr.in_stock,
       pr.seller,
       pr.fetched_at
     FROM prices pr
     LEFT JOIN products p ON pr.product_id = p.id
     WHERE pr.fetched_at >= ? AND pr.fetched_at <= ?
     ORDER BY pr.fetched_at ASC`,
    [startMs, endMs],
  );

  return rows.map((r) => {
    const price = round2(Number(r.price) || 0);
    const shipping = round2(Number(r.shipping) || 0);

    return {
      product_id: String(r.product_id ?? ''),
      product_title: String(r.product_title ?? ''),
      platform: String(r.platform ?? ''),
      price,
      shipping,
      total_price: round2(price + shipping),
      in_stock: Boolean(r.in_stock),
      seller: r.seller !== null && r.seller !== undefined ? String(r.seller) : null,
      fetched_at: formatDate(Number(r.fetched_at), 'iso'),
    };
  });
}

function exportPerformanceFlat(
  db: Database,
  startMs: number,
  endMs: number,
): PerformanceFlat[] {
  // Aggregate by date + platform
  const rows = db.query<Record<string, unknown>>(
    `SELECT
       date(ordered_at / 1000, 'unixepoch') as day,
       sell_platform as platform,
       COUNT(*) as orders_count,
       COALESCE(SUM(sell_price), 0) as total_revenue,
       COALESCE(SUM(buy_price), 0) as total_cost,
       COALESCE(SUM(shipping_cost), 0) as total_shipping,
       COALESCE(SUM(platform_fees), 0) as total_fees,
       COALESCE(SUM(profit), 0) as total_profit
     FROM orders
     WHERE ordered_at >= ? AND ordered_at <= ?
       AND status NOT IN ('cancelled', 'refunded')
     GROUP BY day, sell_platform
     ORDER BY day ASC, sell_platform ASC`,
    [startMs, endMs],
  );

  return rows.map((r) => {
    const revenue = round2(Number(r.total_revenue) || 0);
    const profit = round2(Number(r.total_profit) || 0);
    const avgMargin = revenue > 0 ? round2((profit / revenue) * 100) : 0;

    return {
      date: String(r.day ?? ''),
      platform: String(r.platform ?? ''),
      orders_count: Number(r.orders_count) || 0,
      total_revenue: revenue,
      total_cost: round2(Number(r.total_cost) || 0),
      total_shipping: round2(Number(r.total_shipping) || 0),
      total_fees: round2(Number(r.total_fees) || 0),
      total_profit: profit,
      avg_profit_margin: avgMargin,
    };
  });
}

// =============================================================================
// MAIN EXPORT FUNCTION
// =============================================================================

/**
 * Export data in BI-tool-friendly format.
 */
export function exportForBI(
  db: Database,
  options: BIExportOptions,
): Record<string, string> {
  const { startMs, endMs } = parseDateRange(options.startDate, options.endDate);
  const format: BIExportFormat = options.format ?? 'csv';
  const table = options.table ?? 'all';

  const results: Record<string, string> = {};

  function formatOutput(
    tableName: string,
    data: Array<Record<string, unknown>>,
  ): void {
    if (data.length === 0) {
      results[tableName] = format === 'jsonl' ? '' : '';
      return;
    }

    if (format === 'jsonl') {
      results[tableName] = toJSONL(data);
    } else {
      const headers = Object.keys(data[0]);
      const rows = data.map((row) =>
        headers.map((h) => {
          const v = row[h];
          if (v === null || v === undefined) return null;
          if (typeof v === 'boolean') return v ? 'true' : 'false';
          if (typeof v === 'number') return v;
          return String(v);
        }),
      );
      results[tableName] = generateCSV(headers, rows);
    }
  }

  if (table === 'orders_flat' || table === 'all') {
    const data = exportOrdersFlat(db, startMs, endMs);
    formatOutput('orders_flat', data as unknown as Array<Record<string, unknown>>);
    logger.debug({ rows: data.length }, 'orders_flat exported');
  }

  if (table === 'inventory_flat' || table === 'all') {
    const data = exportInventoryFlat(db);
    formatOutput('inventory_flat', data as unknown as Array<Record<string, unknown>>);
    logger.debug({ rows: data.length }, 'inventory_flat exported');
  }

  if (table === 'pricing_flat' || table === 'all') {
    const data = exportPricingFlat(db, startMs, endMs);
    formatOutput('pricing_flat', data as unknown as Array<Record<string, unknown>>);
    logger.debug({ rows: data.length }, 'pricing_flat exported');
  }

  if (table === 'performance_flat' || table === 'all') {
    const data = exportPerformanceFlat(db, startMs, endMs);
    formatOutput('performance_flat', data as unknown as Array<Record<string, unknown>>);
    logger.debug({ rows: data.length }, 'performance_flat exported');
  }

  return results;
}

// =============================================================================
// SCHEMA DOCUMENTATION
// =============================================================================

const SCHEMAS: Record<string, TableSchema> = {
  orders_flat: {
    tableName: 'orders_flat',
    description: 'Denormalized orders with joined listing and product data. One row per order.',
    columns: [
      { name: 'order_id', type: 'string', description: 'Unique order identifier', nullable: false },
      { name: 'order_date', type: 'date', description: 'Date the order was placed (YYYY-MM-DD)', nullable: false },
      { name: 'order_status', type: 'string', description: 'Order status (pending, shipped, delivered, etc.)', nullable: false },
      { name: 'sell_platform', type: 'string', description: 'Platform where item was sold', nullable: false },
      { name: 'sell_price', type: 'number', description: 'Sale price in USD', nullable: false },
      { name: 'buy_platform', type: 'string', description: 'Platform where item was sourced', nullable: false },
      { name: 'buy_price', type: 'number', description: 'Purchase price in USD', nullable: true },
      { name: 'shipping_cost', type: 'number', description: 'Shipping cost in USD', nullable: true },
      { name: 'platform_fees', type: 'number', description: 'Platform fees in USD', nullable: true },
      { name: 'profit', type: 'number', description: 'Net profit in USD', nullable: true },
      { name: 'profit_margin_pct', type: 'number', description: 'Profit margin percentage', nullable: true },
      { name: 'product_id', type: 'string', description: 'Product identifier', nullable: true },
      { name: 'product_title', type: 'string', description: 'Product title', nullable: true },
      { name: 'product_brand', type: 'string', description: 'Product brand', nullable: true },
      { name: 'product_category', type: 'string', description: 'Product category', nullable: true },
      { name: 'tracking_number', type: 'string', description: 'Shipping tracking number', nullable: true },
      { name: 'shipped_at', type: 'date', description: 'Ship date', nullable: true },
      { name: 'delivered_at', type: 'date', description: 'Delivery date', nullable: true },
    ],
    rowEstimate: 'One row per order',
  },
  inventory_flat: {
    tableName: 'inventory_flat',
    description: 'Current inventory state: active listings with product metadata.',
    columns: [
      { name: 'product_id', type: 'string', description: 'Product identifier', nullable: false },
      { name: 'product_title', type: 'string', description: 'Product title', nullable: false },
      { name: 'product_brand', type: 'string', description: 'Product brand', nullable: true },
      { name: 'product_category', type: 'string', description: 'Product category', nullable: true },
      { name: 'platform', type: 'string', description: 'Platform where listed', nullable: false },
      { name: 'current_price', type: 'number', description: 'Current listing price in USD', nullable: false },
      { name: 'source_platform', type: 'string', description: 'Source platform for product', nullable: false },
      { name: 'source_price', type: 'number', description: 'Source cost in USD', nullable: false },
      { name: 'listing_status', type: 'string', description: 'Listing status', nullable: false },
      { name: 'listing_created_at', type: 'date', description: 'When listing was created', nullable: false },
    ],
    rowEstimate: 'One row per active listing',
  },
  pricing_flat: {
    tableName: 'pricing_flat',
    description: 'Historical price snapshots across all platforms and products.',
    columns: [
      { name: 'product_id', type: 'string', description: 'Product identifier', nullable: false },
      { name: 'product_title', type: 'string', description: 'Product title', nullable: false },
      { name: 'platform', type: 'string', description: 'Platform name', nullable: false },
      { name: 'price', type: 'number', description: 'Product price in USD', nullable: false },
      { name: 'shipping', type: 'number', description: 'Shipping cost in USD', nullable: false },
      { name: 'total_price', type: 'number', description: 'Price + shipping', nullable: false },
      { name: 'in_stock', type: 'boolean', description: 'Whether item is in stock', nullable: false },
      { name: 'seller', type: 'string', description: 'Seller name/ID', nullable: true },
      { name: 'fetched_at', type: 'date', description: 'When price was captured', nullable: false },
    ],
    rowEstimate: 'One row per price snapshot per product per platform',
  },
  performance_flat: {
    tableName: 'performance_flat',
    description: 'Daily aggregated performance metrics per platform.',
    columns: [
      { name: 'date', type: 'date', description: 'Date (YYYY-MM-DD)', nullable: false },
      { name: 'platform', type: 'string', description: 'Sell platform', nullable: false },
      { name: 'orders_count', type: 'number', description: 'Number of orders', nullable: false },
      { name: 'total_revenue', type: 'number', description: 'Total revenue in USD', nullable: false },
      { name: 'total_cost', type: 'number', description: 'Total product cost in USD', nullable: false },
      { name: 'total_shipping', type: 'number', description: 'Total shipping cost in USD', nullable: false },
      { name: 'total_fees', type: 'number', description: 'Total platform fees in USD', nullable: false },
      { name: 'total_profit', type: 'number', description: 'Total profit in USD', nullable: false },
      { name: 'avg_profit_margin', type: 'number', description: 'Average profit margin %', nullable: false },
    ],
    rowEstimate: 'One row per day per platform',
  },
};

/**
 * Return schema documentation for export tables.
 */
export function getDataSchema(tableName?: string): TableSchema | TableSchema[] {
  if (tableName && SCHEMAS[tableName]) {
    return SCHEMAS[tableName];
  }
  return Object.values(SCHEMAS);
}

// =============================================================================
// DASHBOARD DATA
// =============================================================================

/**
 * Pre-aggregated data for dashboard consumption.
 */
export function exportDashboardData(
  db: Database,
  options: { period?: '7d' | '30d' | '90d' | 'ytd'; metrics?: string[] } = {},
): DashboardData {
  const periodLabel = options.period ?? '30d';
  const now = Date.now();

  let startMs: number;
  switch (periodLabel) {
    case '7d':
      startMs = now - 7 * 24 * 60 * 60 * 1000;
      break;
    case '90d':
      startMs = now - 90 * 24 * 60 * 60 * 1000;
      break;
    case 'ytd': {
      const yearStart = new Date(new Date().getFullYear(), 0, 1);
      startMs = yearStart.getTime();
      break;
    }
    case '30d':
    default:
      startMs = now - 30 * 24 * 60 * 60 * 1000;
      break;
  }

  // Summary
  const summaryRows = db.query<Record<string, unknown>>(
    `SELECT
       COUNT(*) as total_orders,
       COALESCE(SUM(sell_price), 0) as total_revenue,
       COALESCE(SUM(profit), 0) as total_profit
     FROM orders
     WHERE ordered_at >= ? AND ordered_at <= ?
       AND status NOT IN ('cancelled', 'refunded')`,
    [startMs, now],
  );

  const summary = summaryRows[0] ?? {};
  const totalOrders = Number(summary.total_orders) || 0;
  const totalRevenue = round2(Number(summary.total_revenue) || 0);
  const totalProfit = round2(Number(summary.total_profit) || 0);
  const avgProfitMargin = totalRevenue > 0 ? round2((totalProfit / totalRevenue) * 100) : 0;

  // Active listings count
  const listingRows = db.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM listings WHERE status = 'active'",
  );
  const activeListings = listingRows[0]?.cnt ?? 0;

  // Revenue by platform
  const platformRows = db.query<{ platform: string; revenue: number; profit: number }>(
    `SELECT sell_platform as platform,
            COALESCE(SUM(sell_price), 0) as revenue,
            COALESCE(SUM(profit), 0) as profit
     FROM orders
     WHERE ordered_at >= ? AND ordered_at <= ?
       AND status NOT IN ('cancelled', 'refunded')
     GROUP BY sell_platform`,
    [startMs, now],
  );

  const revenueByPlatform: Record<string, number> = {};
  const profitByPlatform: Record<string, number> = {};
  for (const row of platformRows) {
    revenueByPlatform[row.platform] = round2(row.revenue);
    profitByPlatform[row.platform] = round2(row.profit);
  }

  // Orders by day
  const dailyRows = db.query<{ day: string; cnt: number; revenue: number; profit: number }>(
    `SELECT date(ordered_at / 1000, 'unixepoch') as day,
            COUNT(*) as cnt,
            COALESCE(SUM(sell_price), 0) as revenue,
            COALESCE(SUM(profit), 0) as profit
     FROM orders
     WHERE ordered_at >= ? AND ordered_at <= ?
       AND status NOT IN ('cancelled', 'refunded')
     GROUP BY day
     ORDER BY day ASC`,
    [startMs, now],
  );

  const ordersByDay = dailyRows.map((r) => ({
    date: r.day,
    count: r.cnt,
    revenue: round2(r.revenue),
    profit: round2(r.profit),
  }));

  // Top products
  const topRows = db.query<Record<string, unknown>>(
    `SELECT l.product_id, p.title,
            COUNT(*) as order_count,
            COALESCE(SUM(o.sell_price), 0) as revenue,
            COALESCE(SUM(o.profit), 0) as profit
     FROM orders o
     JOIN listings l ON o.listing_id = l.id
     LEFT JOIN products p ON l.product_id = p.id
     WHERE o.ordered_at >= ? AND o.ordered_at <= ?
       AND o.status NOT IN ('cancelled', 'refunded')
     GROUP BY l.product_id
     ORDER BY revenue DESC
     LIMIT 10`,
    [startMs, now],
  );

  const topProducts = topRows.map((r) => ({
    productId: String(r.product_id ?? ''),
    title: String(r.title ?? 'Unknown'),
    orders: Number(r.order_count) || 0,
    revenue: round2(Number(r.revenue) || 0),
    profit: round2(Number(r.profit) || 0),
  }));

  return {
    period: periodLabel,
    summary: {
      totalOrders,
      totalRevenue,
      totalProfit,
      avgProfitMargin,
      activeListings,
    },
    revenueByPlatform,
    profitByPlatform,
    ordersByDay,
    topProducts,
    generatedAt: new Date().toISOString(),
  };
}
