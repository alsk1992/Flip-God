/**
 * ROI/Profit Analytics Dashboard
 *
 * Provides daily profit trends, category/platform profitability,
 * top/bottom products, inventory turnover, and overall business stats.
 * Queries from orders, listings, prices, and products tables.
 */

import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import type {
  DashboardPeriod,
  DailyProfit,
  CategoryProfit,
  PlatformROI,
  ProductPerformance,
  InventoryTurnover,
  TimeOfDayProfit,
  DayOfWeekProfit,
  OverallStats,
} from './dashboard-types.js';

const logger = createLogger('analytics-dashboard');

// =============================================================================
// HELPERS
// =============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function periodToCutoff(period: DashboardPeriod): number {
  const now = Date.now();
  switch (period) {
    case '7d':
      return now - 7 * MS_PER_DAY;
    case '30d':
      return now - 30 * MS_PER_DAY;
    case '90d':
      return now - 90 * MS_PER_DAY;
    case 'ytd': {
      const d = new Date();
      d.setMonth(0, 1);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    case 'all':
      return 0;
    default:
      return now - 30 * MS_PER_DAY;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(denominator) || denominator === 0) return fallback;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : fallback;
}

function daysBetween(start: number, end: number): number {
  const diff = Math.abs(end - start);
  return diff / MS_PER_DAY;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// =============================================================================
// getDailyProfitTrend
// =============================================================================

/**
 * Get daily revenue, cost, profit, and margin for the last N days.
 */
export function getDailyProfitTrend(
  db: Database,
  days = 30,
  platform?: string,
): DailyProfit[] {
  const safeDays = Math.max(1, Math.min(days, 365));
  const cutoff = Date.now() - safeDays * MS_PER_DAY;

  const conditions: string[] = ['o.ordered_at >= ?'];
  const params: unknown[] = [cutoff];

  if (platform) {
    conditions.push('o.sell_platform = ?');
    params.push(platform);
  }

  // Only count completed orders (purchased, shipped, delivered)
  conditions.push("o.status IN ('purchased', 'shipped', 'delivered')");

  const rows = db.query<Record<string, unknown>>(
    `SELECT
       date(o.ordered_at / 1000, 'unixepoch') AS day,
       SUM(o.sell_price) AS revenue,
       SUM(COALESCE(o.buy_price, 0) + COALESCE(o.shipping_cost, 0)) AS cost,
       SUM(COALESCE(o.platform_fees, 0)) AS fees,
       SUM(COALESCE(o.profit, o.sell_price - COALESCE(o.buy_price, 0) - COALESCE(o.shipping_cost, 0) - COALESCE(o.platform_fees, 0))) AS profit,
       COUNT(*) AS order_count
     FROM orders o
     WHERE ${conditions.join(' AND ')}
     GROUP BY day
     ORDER BY day ASC`,
    params,
  );

  return rows.map((row) => {
    const revenue = Number(row.revenue) || 0;
    const cost = Number(row.cost) || 0;
    const fees = Number(row.fees) || 0;
    const profit = Number(row.profit) || 0;
    const marginPct = safeDiv(profit, revenue) * 100;

    return {
      date: row.day as string,
      revenue: round2(revenue),
      cost: round2(cost),
      fees: round2(fees),
      profit: round2(profit),
      marginPct: round2(marginPct),
      orderCount: Number(row.order_count) || 0,
    };
  });
}

// =============================================================================
// getCategoryProfitability
// =============================================================================

/**
 * Profit breakdown by product category.
 */
export function getCategoryProfitability(
  db: Database,
  options: { period?: DashboardPeriod; minOrders?: number } = {},
): CategoryProfit[] {
  const { period = '30d', minOrders = 3 } = options;
  const cutoff = periodToCutoff(period);
  const safeMinOrders = Math.max(0, Math.min(minOrders, 1000));

  const rows = db.query<Record<string, unknown>>(
    `SELECT
       COALESCE(p.category, 'Uncategorized') AS category,
       SUM(o.sell_price) AS revenue,
       SUM(COALESCE(o.buy_price, 0) + COALESCE(o.shipping_cost, 0)) AS cost,
       SUM(COALESCE(o.platform_fees, 0)) AS fees,
       SUM(COALESCE(o.profit, o.sell_price - COALESCE(o.buy_price, 0) - COALESCE(o.shipping_cost, 0) - COALESCE(o.platform_fees, 0))) AS profit,
       COUNT(*) AS order_count
     FROM orders o
     JOIN listings l ON o.listing_id = l.id
     JOIN products p ON l.product_id = p.id
     WHERE o.ordered_at >= ?
       AND o.status IN ('purchased', 'shipped', 'delivered')
     GROUP BY category
     HAVING COUNT(*) >= ?
     ORDER BY profit DESC`,
    [cutoff, safeMinOrders],
  );

  return rows.map((row) => {
    const revenue = Number(row.revenue) || 0;
    const cost = Number(row.cost) || 0;
    const fees = Number(row.fees) || 0;
    const profit = Number(row.profit) || 0;
    const orderCount = Number(row.order_count) || 0;

    return {
      category: row.category as string,
      revenue: round2(revenue),
      cost: round2(cost),
      fees: round2(fees),
      profit: round2(profit),
      marginPct: round2(safeDiv(profit, revenue) * 100),
      orderCount,
      avgOrderValue: round2(safeDiv(revenue, orderCount)),
    };
  });
}

// =============================================================================
// getPlatformROI
// =============================================================================

/**
 * ROI per selling platform (revenue, cost, fees, net profit, ROI %).
 */
export function getPlatformROI(
  db: Database,
  options: { period?: DashboardPeriod } = {},
): PlatformROI[] {
  const { period = '30d' } = options;
  const cutoff = periodToCutoff(period);

  const rows = db.query<Record<string, unknown>>(
    `SELECT
       o.sell_platform AS platform,
       SUM(o.sell_price) AS revenue,
       SUM(COALESCE(o.buy_price, 0) + COALESCE(o.shipping_cost, 0)) AS cost,
       SUM(COALESCE(o.platform_fees, 0)) AS fees,
       SUM(COALESCE(o.profit, o.sell_price - COALESCE(o.buy_price, 0) - COALESCE(o.shipping_cost, 0) - COALESCE(o.platform_fees, 0))) AS net_profit,
       COUNT(*) AS order_count
     FROM orders o
     WHERE o.ordered_at >= ?
       AND o.status IN ('purchased', 'shipped', 'delivered')
     GROUP BY o.sell_platform
     ORDER BY net_profit DESC`,
    [cutoff],
  );

  return rows.map((row) => {
    const revenue = Number(row.revenue) || 0;
    const cost = Number(row.cost) || 0;
    const fees = Number(row.fees) || 0;
    const netProfit = Number(row.net_profit) || 0;
    const orderCount = Number(row.order_count) || 0;

    return {
      platform: row.platform as string,
      revenue: round2(revenue),
      cost: round2(cost),
      fees: round2(fees),
      netProfit: round2(netProfit),
      roiPct: round2(safeDiv(netProfit, cost) * 100),
      orderCount,
      avgProfit: round2(safeDiv(netProfit, orderCount)),
    };
  });
}

// =============================================================================
// getTopProducts
// =============================================================================

/**
 * Top N products by profit, revenue, margin, or velocity.
 */
export function getTopProducts(
  db: Database,
  options: {
    metric?: 'profit' | 'revenue' | 'margin' | 'velocity';
    limit?: number;
    period?: DashboardPeriod;
  } = {},
): ProductPerformance[] {
  const { metric = 'profit', limit = 10, period = '30d' } = options;
  const cutoff = periodToCutoff(period);
  const safeLimit = Math.max(1, Math.min(limit, 100));

  let orderBy: string;
  switch (metric) {
    case 'revenue':
      orderBy = 'revenue DESC';
      break;
    case 'margin':
      orderBy = 'margin_pct DESC';
      break;
    case 'velocity':
      orderBy = 'order_count DESC';
      break;
    case 'profit':
    default:
      orderBy = 'profit DESC';
      break;
  }

  const rows = db.query<Record<string, unknown>>(
    `SELECT
       l.product_id,
       p.title,
       p.category,
       SUM(o.sell_price) AS revenue,
       SUM(COALESCE(o.buy_price, 0) + COALESCE(o.shipping_cost, 0)) AS cost,
       SUM(COALESCE(o.platform_fees, 0)) AS fees,
       SUM(COALESCE(o.profit, o.sell_price - COALESCE(o.buy_price, 0) - COALESCE(o.shipping_cost, 0) - COALESCE(o.platform_fees, 0))) AS profit,
       COUNT(*) AS order_count,
       CASE WHEN SUM(o.sell_price) > 0
         THEN (SUM(COALESCE(o.profit, 0)) * 100.0 / SUM(o.sell_price))
         ELSE 0
       END AS margin_pct,
       AVG(CASE WHEN o.shipped_at IS NOT NULL THEN (o.shipped_at - l.created_at) / ${MS_PER_DAY}.0 ELSE NULL END) AS avg_days_to_sell
     FROM orders o
     JOIN listings l ON o.listing_id = l.id
     JOIN products p ON l.product_id = p.id
     WHERE o.ordered_at >= ?
       AND o.status IN ('purchased', 'shipped', 'delivered')
     GROUP BY l.product_id
     ORDER BY ${orderBy}
     LIMIT ?`,
    [cutoff, safeLimit],
  );

  return rows.map((row) => {
    const revenue = Number(row.revenue) || 0;
    const cost = Number(row.cost) || 0;
    const fees = Number(row.fees) || 0;
    const profit = Number(row.profit) || 0;
    const avgDays = Number(row.avg_days_to_sell);

    return {
      productId: row.product_id as string,
      title: (row.title as string) ?? 'Unknown',
      category: (row.category as string) ?? null,
      revenue: round2(revenue),
      cost: round2(cost),
      fees: round2(fees),
      profit: round2(profit),
      marginPct: round2(safeDiv(profit, revenue) * 100),
      orderCount: Number(row.order_count) || 0,
      avgDaysToSell: Number.isFinite(avgDays) ? round2(avgDays) : null,
    };
  });
}

// =============================================================================
// getBottomProducts
// =============================================================================

/**
 * Worst performing products (candidates for removal).
 */
export function getBottomProducts(
  db: Database,
  options: {
    limit?: number;
    period?: DashboardPeriod;
  } = {},
): ProductPerformance[] {
  const { limit = 10, period = '30d' } = options;
  const cutoff = periodToCutoff(period);
  const safeLimit = Math.max(1, Math.min(limit, 100));

  const rows = db.query<Record<string, unknown>>(
    `SELECT
       l.product_id,
       p.title,
       p.category,
       SUM(o.sell_price) AS revenue,
       SUM(COALESCE(o.buy_price, 0) + COALESCE(o.shipping_cost, 0)) AS cost,
       SUM(COALESCE(o.platform_fees, 0)) AS fees,
       SUM(COALESCE(o.profit, o.sell_price - COALESCE(o.buy_price, 0) - COALESCE(o.shipping_cost, 0) - COALESCE(o.platform_fees, 0))) AS profit,
       COUNT(*) AS order_count,
       AVG(CASE WHEN o.shipped_at IS NOT NULL THEN (o.shipped_at - l.created_at) / ${MS_PER_DAY}.0 ELSE NULL END) AS avg_days_to_sell
     FROM orders o
     JOIN listings l ON o.listing_id = l.id
     JOIN products p ON l.product_id = p.id
     WHERE o.ordered_at >= ?
       AND o.status IN ('purchased', 'shipped', 'delivered')
     GROUP BY l.product_id
     ORDER BY profit ASC
     LIMIT ?`,
    [cutoff, safeLimit],
  );

  return rows.map((row) => {
    const revenue = Number(row.revenue) || 0;
    const cost = Number(row.cost) || 0;
    const fees = Number(row.fees) || 0;
    const profit = Number(row.profit) || 0;
    const avgDays = Number(row.avg_days_to_sell);

    return {
      productId: row.product_id as string,
      title: (row.title as string) ?? 'Unknown',
      category: (row.category as string) ?? null,
      revenue: round2(revenue),
      cost: round2(cost),
      fees: round2(fees),
      profit: round2(profit),
      marginPct: round2(safeDiv(profit, revenue) * 100),
      orderCount: Number(row.order_count) || 0,
      avgDaysToSell: Number.isFinite(avgDays) ? round2(avgDays) : null,
    };
  });
}

// =============================================================================
// getInventoryTurnover
// =============================================================================

/**
 * Average days-to-sell by category/platform.
 */
export function getInventoryTurnover(
  db: Database,
  options: { category?: string; platform?: string } = {},
): InventoryTurnover[] {
  const { category, platform } = options;

  const conditions: string[] = ["l.status = 'sold'"];
  const params: unknown[] = [];

  if (category) {
    conditions.push('p.category = ?');
    params.push(category);
  }
  if (platform) {
    conditions.push('l.platform = ?');
    params.push(platform);
  }

  // Get listings that have a corresponding order for the sold_at timestamp
  const rows = db.query<Record<string, unknown>>(
    `SELECT
       COALESCE(p.category, 'Uncategorized') AS category,
       l.platform,
       COUNT(*) AS total_sold,
       AVG((o.ordered_at - l.created_at) / ${MS_PER_DAY}.0) AS avg_days,
       MIN((o.ordered_at - l.created_at) / ${MS_PER_DAY}.0) AS min_days,
       MAX((o.ordered_at - l.created_at) / ${MS_PER_DAY}.0) AS max_days
     FROM listings l
     JOIN products p ON l.product_id = p.id
     JOIN orders o ON o.listing_id = l.id
     WHERE ${conditions.join(' AND ')}
     GROUP BY p.category, l.platform
     ORDER BY avg_days ASC`,
    params,
  );

  // Also count total listed per group
  const listedConditions: string[] = [];
  const listedParams: unknown[] = [];

  if (category) {
    listedConditions.push('p.category = ?');
    listedParams.push(category);
  }
  if (platform) {
    listedConditions.push('l.platform = ?');
    listedParams.push(platform);
  }

  const listedWhere = listedConditions.length > 0
    ? `WHERE ${listedConditions.join(' AND ')}`
    : '';

  const listedRows = db.query<Record<string, unknown>>(
    `SELECT
       COALESCE(p.category, 'Uncategorized') AS category,
       l.platform,
       COUNT(*) AS total_listed
     FROM listings l
     JOIN products p ON l.product_id = p.id
     ${listedWhere}
     GROUP BY p.category, l.platform`,
    listedParams,
  );

  const listedMap = new Map<string, number>();
  for (const row of listedRows) {
    const key = `${row.category}|${row.platform}`;
    listedMap.set(key, Number(row.total_listed) || 0);
  }

  return rows.map((row) => {
    const cat = row.category as string;
    const plat = row.platform as string;
    const totalSold = Number(row.total_sold) || 0;
    const avgDays = Number(row.avg_days);
    const minDays = Number(row.min_days);
    const maxDays = Number(row.max_days);
    const totalListed = listedMap.get(`${cat}|${plat}`) ?? totalSold;

    // Compute median via separate query for this group
    const medianRows = db.query<Record<string, unknown>>(
      `SELECT (o.ordered_at - l.created_at) / ${MS_PER_DAY}.0 AS days
       FROM listings l
       JOIN products p ON l.product_id = p.id
       JOIN orders o ON o.listing_id = l.id
       WHERE l.status = 'sold' AND COALESCE(p.category, 'Uncategorized') = ? AND l.platform = ?
       ORDER BY days ASC`,
      [cat, plat],
    );
    const dayValues = medianRows.map((r) => Number(r.days)).filter(Number.isFinite);
    const medianDays = computeMedian(dayValues);

    return {
      category: cat,
      platform: plat ?? null,
      avgDaysToSell: Number.isFinite(avgDays) ? round2(avgDays) : 0,
      medianDaysToSell: round2(medianDays),
      minDaysToSell: Number.isFinite(minDays) ? round2(minDays) : 0,
      maxDaysToSell: Number.isFinite(maxDays) ? round2(maxDays) : 0,
      totalSold,
      totalListed,
      turnoverRate: round2(safeDiv(totalSold, totalListed)),
    };
  });
}

// =============================================================================
// getProfitByTimeOfDay
// =============================================================================

/**
 * What time of day and day of week sells most profitably.
 */
export function getProfitByTimeOfDay(db: Database): {
  byHour: TimeOfDayProfit[];
  byDayOfWeek: DayOfWeekProfit[];
} {
  // By hour
  const hourRows = db.query<Record<string, unknown>>(
    `SELECT
       CAST(strftime('%H', o.ordered_at / 1000, 'unixepoch') AS INTEGER) AS hour,
       COUNT(*) AS order_count,
       SUM(COALESCE(o.profit, 0)) AS total_profit
     FROM orders o
     WHERE o.status IN ('purchased', 'shipped', 'delivered')
     GROUP BY hour
     ORDER BY hour ASC`,
  );

  const byHour: TimeOfDayProfit[] = hourRows.map((row) => {
    const orderCount = Number(row.order_count) || 0;
    const totalProfit = Number(row.total_profit) || 0;
    return {
      hour: Number(row.hour) || 0,
      orderCount,
      totalProfit: round2(totalProfit),
      avgProfit: round2(safeDiv(totalProfit, orderCount)),
    };
  });

  // By day of week (strftime %w: 0=Sunday, 6=Saturday)
  const dowRows = db.query<Record<string, unknown>>(
    `SELECT
       CAST(strftime('%w', o.ordered_at / 1000, 'unixepoch') AS INTEGER) AS dow,
       COUNT(*) AS order_count,
       SUM(COALESCE(o.profit, 0)) AS total_profit
     FROM orders o
     WHERE o.status IN ('purchased', 'shipped', 'delivered')
     GROUP BY dow
     ORDER BY dow ASC`,
  );

  const byDayOfWeek: DayOfWeekProfit[] = dowRows.map((row) => {
    const dayOfWeek = Number(row.dow) || 0;
    const orderCount = Number(row.order_count) || 0;
    const totalProfit = Number(row.total_profit) || 0;
    return {
      dayOfWeek,
      dayName: DAY_NAMES[dayOfWeek] ?? 'Unknown',
      orderCount,
      totalProfit: round2(totalProfit),
      avgProfit: round2(safeDiv(totalProfit, orderCount)),
    };
  });

  return { byHour, byDayOfWeek };
}

// =============================================================================
// getOverallStats
// =============================================================================

/**
 * Summary dashboard stats for a given period.
 */
export function getOverallStats(
  db: Database,
  period: DashboardPeriod = '30d',
): OverallStats {
  const cutoff = periodToCutoff(period);

  // Order stats
  const orderRows = db.query<Record<string, unknown>>(
    `SELECT
       SUM(o.sell_price) AS revenue,
       SUM(COALESCE(o.buy_price, 0) + COALESCE(o.shipping_cost, 0)) AS cogs,
       SUM(COALESCE(o.platform_fees, 0)) AS fees,
       SUM(COALESCE(o.profit, o.sell_price - COALESCE(o.buy_price, 0) - COALESCE(o.shipping_cost, 0) - COALESCE(o.platform_fees, 0))) AS net_profit,
       COUNT(*) AS order_count
     FROM orders o
     WHERE o.ordered_at >= ?
       AND o.status IN ('purchased', 'shipped', 'delivered')`,
    [cutoff],
  );

  const stats = orderRows[0] ?? {};
  const totalRevenue = Number(stats.revenue) || 0;
  const totalCOGS = Number(stats.cogs) || 0;
  const totalFees = Number(stats.fees) || 0;
  const netProfit = Number(stats.net_profit) || 0;
  const orderCount = Number(stats.order_count) || 0;
  const grossProfit = totalRevenue - totalCOGS;

  // Returns count
  let returnCount = 0;
  try {
    const returnRows = db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS cnt FROM returns WHERE created_at >= ?`,
      [cutoff],
    );
    returnCount = Number(returnRows[0]?.cnt) || 0;
  } catch {
    // returns table may not exist (migration not run)
    logger.debug('returns table not available for stats');
  }

  // Active listings
  const listingRows = db.query<Record<string, unknown>>(
    `SELECT COUNT(*) AS cnt FROM listings WHERE status = 'active'`,
  );
  const activeListings = Number(listingRows[0]?.cnt) || 0;

  return {
    period,
    totalRevenue: round2(totalRevenue),
    totalCOGS: round2(totalCOGS),
    totalFees: round2(totalFees),
    grossProfit: round2(grossProfit),
    netProfit: round2(netProfit),
    orderCount,
    avgOrderValue: round2(safeDiv(totalRevenue, orderCount)),
    avgProfit: round2(safeDiv(netProfit, orderCount)),
    grossMarginPct: round2(safeDiv(grossProfit, totalRevenue) * 100),
    netMarginPct: round2(safeDiv(netProfit, totalRevenue) * 100),
    returnCount,
    returnRate: round2(safeDiv(returnCount, orderCount) * 100),
    activeListings,
  };
}

// =============================================================================
// INTERNAL UTILITIES
// =============================================================================

function computeMedian(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}
