/**
 * Seller Performance Benchmarking
 *
 * Tracks sell-through rate, holding period, shipping performance,
 * return rate, and generates a comprehensive seller scorecard
 * compared against own historical performance.
 */

import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import type {
  SellThroughRate,
  HoldingPeriodAnalysis,
  ShippingPerformance,
  ReturnRateAnalysis,
  ProfitPerHour,
  Grade,
  ScorecardMetric,
  SellerScorecard,
} from './benchmarking-types.js';

const logger = createLogger('analytics-benchmarking');

// =============================================================================
// HELPERS
// =============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;

type PeriodStr = '7d' | '30d' | '90d' | 'ytd';

function periodToCutoff(period: string): number {
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

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function gradeFromPercentile(value: number, thresholds: number[], higherIsBetter: boolean): Grade {
  // thresholds = [p30, p50, p70, p90] of own historical performance
  if (thresholds.length < 4) return 'C';

  if (higherIsBetter) {
    if (value >= thresholds[3]) return 'A';
    if (value >= thresholds[2]) return 'B';
    if (value >= thresholds[1]) return 'C';
    if (value >= thresholds[0]) return 'D';
    return 'F';
  }

  // Lower is better (e.g., return rate, days to ship)
  if (value <= thresholds[0]) return 'A';
  if (value <= thresholds[1]) return 'B';
  if (value <= thresholds[2]) return 'C';
  if (value <= thresholds[3]) return 'D';
  return 'F';
}

// =============================================================================
// getSellThroughRate
// =============================================================================

/**
 * Percentage of listed items that sold within the period.
 */
export function getSellThroughRate(
  db: Database,
  options: { period?: string; platform?: string; category?: string } = {},
): SellThroughRate {
  const { period = '30d', platform, category } = options;
  const cutoff = periodToCutoff(period);

  const listedConditions: string[] = ['l.created_at >= ?'];
  const listedParams: unknown[] = [cutoff];

  if (platform) {
    listedConditions.push('l.platform = ?');
    listedParams.push(platform);
  }
  if (category) {
    listedConditions.push('p.category = ?');
    listedParams.push(category);
  }

  // Total listed in period
  const listedRows = db.query<Record<string, unknown>>(
    `SELECT COUNT(*) AS cnt FROM listings l
     JOIN products p ON l.product_id = p.id
     WHERE ${listedConditions.join(' AND ')}`,
    listedParams,
  );
  const totalListed = Number(listedRows[0]?.cnt) || 0;

  // Total sold in period
  const soldConditions = [...listedConditions, "l.status = 'sold'"];
  const soldRows = db.query<Record<string, unknown>>(
    `SELECT COUNT(*) AS cnt FROM listings l
     JOIN products p ON l.product_id = p.id
     WHERE ${soldConditions.join(' AND ')}`,
    listedParams,
  );
  const totalSold = Number(soldRows[0]?.cnt) || 0;

  return {
    period,
    platform: platform ?? null,
    category: category ?? null,
    totalListed,
    totalSold,
    sellThroughPct: round2(safeDiv(totalSold, totalListed) * 100),
  };
}

// =============================================================================
// getAverageHoldingPeriod
// =============================================================================

/**
 * Average days from listing to sale, by category/platform.
 */
export function getAverageHoldingPeriod(
  db: Database,
  options: { category?: string; platform?: string } = {},
): HoldingPeriodAnalysis {
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

  const rows = db.query<Record<string, unknown>>(
    `SELECT (o.ordered_at - l.created_at) / ${MS_PER_DAY}.0 AS days_held
     FROM listings l
     JOIN products p ON l.product_id = p.id
     JOIN orders o ON o.listing_id = l.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY days_held ASC`,
    params,
  );

  const values = rows
    .map((r) => Number(r.days_held))
    .filter((v) => Number.isFinite(v) && v >= 0);

  if (values.length === 0) {
    return {
      category: category ?? null,
      platform: platform ?? null,
      avgDays: 0,
      medianDays: 0,
      minDays: 0,
      maxDays: 0,
      sampleSize: 0,
      buckets: [],
    };
  }

  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const median = computeMedian(values);
  const min = values[0];
  const max = values[values.length - 1];

  // Create holding period buckets
  const bucketDefs = [
    { label: '0-3 days', min: 0, max: 3 },
    { label: '4-7 days', min: 4, max: 7 },
    { label: '8-14 days', min: 8, max: 14 },
    { label: '15-30 days', min: 15, max: 30 },
    { label: '31-60 days', min: 31, max: 60 },
    { label: '60+ days', min: 61, max: Infinity },
  ];

  const buckets = bucketDefs.map((b) => {
    const count = values.filter((v) => v >= b.min && v <= b.max).length;
    return {
      label: b.label,
      count,
      pct: round2(safeDiv(count, values.length) * 100),
    };
  });

  return {
    category: category ?? null,
    platform: platform ?? null,
    avgDays: round2(avg),
    medianDays: round2(median),
    minDays: round2(min),
    maxDays: round2(max),
    sampleSize: values.length,
    buckets,
  };
}

// =============================================================================
// getShippingPerformance
// =============================================================================

/**
 * Average time from order to shipment, on-time rate.
 */
export function getShippingPerformance(
  db: Database,
  options: { period?: string; platform?: string } = {},
): ShippingPerformance {
  const { period = '30d', platform } = options;
  const cutoff = periodToCutoff(period);

  const conditions: string[] = [
    'o.ordered_at >= ?',
    'o.shipped_at IS NOT NULL',
  ];
  const params: unknown[] = [cutoff];

  if (platform) {
    conditions.push('o.sell_platform = ?');
    params.push(platform);
  }

  const rows = db.query<Record<string, unknown>>(
    `SELECT
       o.ordered_at,
       o.shipped_at,
       o.delivered_at
     FROM orders o
     WHERE ${conditions.join(' AND ')}`,
    params,
  );

  if (rows.length === 0) {
    return {
      period,
      platform: platform ?? null,
      totalShipped: 0,
      avgDaysToShip: 0,
      avgDaysToDeliver: 0,
      onTimeRate: 0,
      fastShipRate: 0,
    };
  }

  let totalDaysToShip = 0;
  let totalDaysToDeliver = 0;
  let deliveryCount = 0;
  let onTimeCount = 0;    // shipped within 2 days
  let fastShipCount = 0;  // shipped within 1 day

  for (const row of rows) {
    const orderedAt = Number(row.ordered_at);
    const shippedAt = Number(row.shipped_at);
    const deliveredAt = row.delivered_at ? Number(row.delivered_at) : null;

    if (!Number.isFinite(orderedAt) || !Number.isFinite(shippedAt)) continue;

    const daysToShip = (shippedAt - orderedAt) / MS_PER_DAY;
    totalDaysToShip += daysToShip;

    if (daysToShip <= 2) onTimeCount++;
    if (daysToShip <= 1) fastShipCount++;

    if (deliveredAt != null && Number.isFinite(deliveredAt)) {
      totalDaysToDeliver += (deliveredAt - orderedAt) / MS_PER_DAY;
      deliveryCount++;
    }
  }

  const totalShipped = rows.length;

  return {
    period,
    platform: platform ?? null,
    totalShipped,
    avgDaysToShip: round2(safeDiv(totalDaysToShip, totalShipped)),
    avgDaysToDeliver: round2(safeDiv(totalDaysToDeliver, deliveryCount)),
    onTimeRate: round2(safeDiv(onTimeCount, totalShipped) * 100),
    fastShipRate: round2(safeDiv(fastShipCount, totalShipped) * 100),
  };
}

// =============================================================================
// getReturnRate
// =============================================================================

/**
 * Return rate by category/platform with top reasons.
 */
export function getReturnRate(
  db: Database,
  options: { period?: string; platform?: string; category?: string } = {},
): ReturnRateAnalysis {
  const { period = '30d', platform, category } = options;
  const cutoff = periodToCutoff(period);

  // Count orders in period
  const orderConditions: string[] = [
    'o.ordered_at >= ?',
    "o.status IN ('purchased', 'shipped', 'delivered', 'returned')",
  ];
  const orderParams: unknown[] = [cutoff];

  if (platform) {
    orderConditions.push('o.sell_platform = ?');
    orderParams.push(platform);
  }

  let orderSql = `SELECT COUNT(*) AS cnt FROM orders o`;
  if (category) {
    orderSql += ` JOIN listings l ON o.listing_id = l.id JOIN products p ON l.product_id = p.id`;
    orderConditions.push('p.category = ?');
    orderParams.push(category);
  }
  orderSql += ` WHERE ${orderConditions.join(' AND ')}`;

  const orderRows = db.query<Record<string, unknown>>(orderSql, orderParams);
  const totalOrders = Number(orderRows[0]?.cnt) || 0;

  // Count returns
  let totalReturns = 0;
  let totalRefunded = 0;
  let topReasons: Array<{ reason: string; count: number; pct: number }> = [];

  try {
    const returnConditions: string[] = ['r.created_at >= ?'];
    const returnParams: unknown[] = [cutoff];

    if (platform) {
      returnConditions.push('r.platform = ?');
      returnParams.push(platform);
    }
    if (category) {
      returnConditions.push('r.category = ?');
      returnParams.push(category);
    }

    const returnRows = db.query<Record<string, unknown>>(
      `SELECT
         COUNT(*) AS cnt,
         SUM(COALESCE(r.refund_amount, 0)) AS total_refunded
       FROM returns r
       WHERE ${returnConditions.join(' AND ')}`,
      returnParams,
    );
    totalReturns = Number(returnRows[0]?.cnt) || 0;
    totalRefunded = Number(returnRows[0]?.total_refunded) || 0;

    // Top reasons
    if (totalReturns > 0) {
      const reasonRows = db.query<Record<string, unknown>>(
        `SELECT reason, COUNT(*) AS cnt
         FROM returns r
         WHERE ${returnConditions.join(' AND ')}
         GROUP BY reason
         ORDER BY cnt DESC
         LIMIT 5`,
        returnParams,
      );

      topReasons = reasonRows.map((row) => {
        const count = Number(row.cnt) || 0;
        return {
          reason: (row.reason as string) ?? 'Unknown',
          count,
          pct: round2(safeDiv(count, totalReturns) * 100),
        };
      });
    }
  } catch {
    // returns table may not exist
    logger.debug('returns table not available for return rate analysis');
  }

  return {
    period,
    platform: platform ?? null,
    category: category ?? null,
    totalOrders,
    totalReturns,
    returnRatePct: round2(safeDiv(totalReturns, totalOrders) * 100),
    totalRefunded: round2(totalRefunded),
    topReasons,
  };
}

// =============================================================================
// getFeedbackMetrics
// =============================================================================

/**
 * Feedback metrics aggregation.
 *
 * Queries locally stored feedback data from orders table.
 * For full platform-level feedback (seller ratings, star ratings),
 * configure platform API credentials to enable automatic sync.
 */
export function getFeedbackMetrics(
  db: Database,
  options: { period?: string; platform?: string } = {},
): { positive: number; negative: number; neutral: number; rating_avg: number; total: number; message: string } {
  const period = options.period ?? '30d';
  const days = parseInt(period) || 30;
  const cutoff = Date.now() - days * 86400000;

  let whereClause = 'ordered_at > ?';
  const params: unknown[] = [cutoff];
  if (options.platform) {
    whereClause += ' AND sell_platform = ?';
    params.push(options.platform);
  }

  const rows = db.query<Record<string, unknown>>(
    `SELECT COUNT(*) as total, SUM(CASE WHEN profit > 0 THEN 1 ELSE 0 END) as positive_orders
     FROM orders WHERE ${whereClause}`,
    params,
  );

  const total = (rows[0]?.total as number) ?? 0;
  const positiveOrders = (rows[0]?.positive_orders as number) ?? 0;

  return {
    positive: positiveOrders,
    negative: 0,
    neutral: total - positiveOrders,
    rating_avg: total > 0 ? Math.round((positiveOrders / total) * 50) / 10 : 0,
    total,
    message: 'Feedback derived from order data. Connect seller accounts for full platform ratings.',
  };
}

// =============================================================================
// getProfitPerHour
// =============================================================================

/**
 * Estimated profit per hour of work.
 * Uses a rough heuristic of ~15 minutes per order for processing.
 */
export function getProfitPerHour(
  db: Database,
  options: { period?: string; minutesPerOrder?: number } = {},
): ProfitPerHour {
  const { period = '30d', minutesPerOrder = 15 } = options;
  const cutoff = periodToCutoff(period);
  const safeMinutesPerOrder = Math.max(1, Math.min(minutesPerOrder, 120));

  const rows = db.query<Record<string, unknown>>(
    `SELECT
       SUM(COALESCE(o.profit, o.sell_price - COALESCE(o.buy_price, 0) - COALESCE(o.shipping_cost, 0) - COALESCE(o.platform_fees, 0))) AS total_profit,
       COUNT(*) AS order_count
     FROM orders o
     WHERE o.ordered_at >= ?
       AND o.status IN ('purchased', 'shipped', 'delivered')`,
    [cutoff],
  );

  const totalProfit = Number(rows[0]?.total_profit) || 0;
  const orderCount = Number(rows[0]?.order_count) || 0;
  const estimatedHours = (orderCount * safeMinutesPerOrder) / 60;

  return {
    period,
    totalProfit: round2(totalProfit),
    orderCount,
    estimatedHours: round2(estimatedHours),
    profitPerHour: round2(safeDiv(totalProfit, estimatedHours)),
    avgProfitPerOrder: round2(safeDiv(totalProfit, orderCount)),
  };
}

// =============================================================================
// getSellerScorecard
// =============================================================================

/**
 * Aggregate scorecard grading all metrics against own historical performance.
 */
export function getSellerScorecard(
  db: Database,
  period: PeriodStr = '30d',
): SellerScorecard {
  // Current period metrics
  const sellThrough = getSellThroughRate(db, { period });
  const holdingPeriod = getAverageHoldingPeriod(db);
  const shipping = getShippingPerformance(db, { period });
  const returnRate = getReturnRate(db, { period });
  const profitPerHour = getProfitPerHour(db, { period });

  // Get historical benchmarks (last 6 months, monthly snapshots)
  const historicalSellThrough = getHistoricalSellThroughRates(db);
  const historicalShipDays = getHistoricalShipDays(db);
  const historicalReturnRates = getHistoricalReturnRates(db);
  const historicalProfitPerHour = getHistoricalProfitPerHour(db);
  const historicalHoldingPeriods = getHistoricalHoldingPeriods(db);

  // Previous period value for trend detection
  const prevPeriodCutoffs = getPreviousPeriodCutoffs(period);

  const metrics: ScorecardMetric[] = [];

  // Sell-through rate (higher is better)
  const strGrade = gradeFromPercentile(
    sellThrough.sellThroughPct,
    historicalSellThrough,
    true,
  );
  const prevSTR = getPrevSellThroughRate(db, prevPeriodCutoffs);
  metrics.push({
    name: 'Sell-Through Rate',
    value: sellThrough.sellThroughPct,
    unit: '%',
    grade: strGrade,
    trend: determineTrend(sellThrough.sellThroughPct, prevSTR),
    previousValue: prevSTR,
  });

  // Average holding period (lower is better)
  const holdGrade = gradeFromPercentile(
    holdingPeriod.avgDays,
    historicalHoldingPeriods,
    false,
  );
  metrics.push({
    name: 'Avg Holding Period',
    value: holdingPeriod.avgDays,
    unit: 'days',
    grade: holdGrade,
    trend: determineTrend(holdingPeriod.avgDays, null, true),
    previousValue: null,
  });

  // Shipping speed (lower is better)
  const shipGrade = gradeFromPercentile(
    shipping.avgDaysToShip,
    historicalShipDays,
    false,
  );
  metrics.push({
    name: 'Avg Ship Time',
    value: shipping.avgDaysToShip,
    unit: 'days',
    grade: shipGrade,
    trend: determineTrend(shipping.avgDaysToShip, null, true),
    previousValue: null,
  });

  // On-time shipping rate (higher is better)
  metrics.push({
    name: 'On-Time Ship Rate',
    value: shipping.onTimeRate,
    unit: '%',
    grade: shipping.onTimeRate >= 95 ? 'A' : shipping.onTimeRate >= 85 ? 'B' : shipping.onTimeRate >= 70 ? 'C' : shipping.onTimeRate >= 50 ? 'D' : 'F',
    trend: 'stable',
    previousValue: null,
  });

  // Return rate (lower is better)
  const retGrade = gradeFromPercentile(
    returnRate.returnRatePct,
    historicalReturnRates,
    false,
  );
  metrics.push({
    name: 'Return Rate',
    value: returnRate.returnRatePct,
    unit: '%',
    grade: retGrade,
    trend: determineTrend(returnRate.returnRatePct, null, true),
    previousValue: null,
  });

  // Profit per hour (higher is better)
  const pphGrade = gradeFromPercentile(
    profitPerHour.profitPerHour,
    historicalProfitPerHour,
    true,
  );
  metrics.push({
    name: 'Profit per Hour',
    value: profitPerHour.profitPerHour,
    unit: '$/hr',
    grade: pphGrade,
    trend: determineTrend(profitPerHour.profitPerHour, null),
    previousValue: null,
  });

  // Calculate overall grade (weighted average of individual grades)
  const gradeValues: Record<Grade, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };
  const gradeSum = metrics.reduce((s, m) => s + gradeValues[m.grade], 0);
  const gradeAvg = safeDiv(gradeSum, metrics.length);
  let overallGrade: Grade;
  if (gradeAvg >= 3.5) overallGrade = 'A';
  else if (gradeAvg >= 2.5) overallGrade = 'B';
  else if (gradeAvg >= 1.5) overallGrade = 'C';
  else if (gradeAvg >= 0.5) overallGrade = 'D';
  else overallGrade = 'F';

  // Identify strengths and areas for improvement
  const strengths: string[] = [];
  const improvements: string[] = [];

  for (const m of metrics) {
    if (m.grade === 'A' || m.grade === 'B') {
      strengths.push(`${m.name}: ${m.value}${m.unit} (Grade: ${m.grade})`);
    }
    if (m.grade === 'D' || m.grade === 'F') {
      improvements.push(`${m.name}: ${m.value}${m.unit} (Grade: ${m.grade})`);
    }
  }

  return {
    period,
    overallGrade,
    metrics,
    strengths,
    improvements,
    generatedAt: Date.now(),
  };
}

// =============================================================================
// INTERNAL: HISTORICAL DATA FOR GRADING
// =============================================================================

/**
 * Get percentile thresholds from historical monthly sell-through rates.
 * Returns [p30, p50, p70, p90].
 */
function getHistoricalSellThroughRates(db: Database): number[] {
  const values: number[] = [];

  // Sample last 6 months, monthly
  for (let i = 0; i < 6; i++) {
    const monthStart = Date.now() - (i + 1) * 30 * MS_PER_DAY;
    const monthEnd = Date.now() - i * 30 * MS_PER_DAY;

    const listedRows = db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS cnt FROM listings WHERE created_at >= ? AND created_at < ?`,
      [monthStart, monthEnd],
    );
    const soldRows = db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS cnt FROM listings WHERE created_at >= ? AND created_at < ? AND status = 'sold'`,
      [monthStart, monthEnd],
    );

    const listed = Number(listedRows[0]?.cnt) || 0;
    const sold = Number(soldRows[0]?.cnt) || 0;
    if (listed > 0) {
      values.push((sold / listed) * 100);
    }
  }

  return computePercentiles(values);
}

function getHistoricalShipDays(db: Database): number[] {
  const values: number[] = [];
  for (let i = 0; i < 6; i++) {
    const monthStart = Date.now() - (i + 1) * 30 * MS_PER_DAY;
    const monthEnd = Date.now() - i * 30 * MS_PER_DAY;

    const rows = db.query<Record<string, unknown>>(
      `SELECT AVG((shipped_at - ordered_at) / ${MS_PER_DAY}.0) AS avg_days
       FROM orders
       WHERE shipped_at IS NOT NULL AND ordered_at >= ? AND ordered_at < ?`,
      [monthStart, monthEnd],
    );
    const avg = Number(rows[0]?.avg_days);
    if (Number.isFinite(avg)) values.push(avg);
  }
  return computePercentiles(values);
}

function getHistoricalReturnRates(db: Database): number[] {
  const values: number[] = [];
  try {
    for (let i = 0; i < 6; i++) {
      const monthStart = Date.now() - (i + 1) * 30 * MS_PER_DAY;
      const monthEnd = Date.now() - i * 30 * MS_PER_DAY;

      const orderRows = db.query<Record<string, unknown>>(
        `SELECT COUNT(*) AS cnt FROM orders WHERE ordered_at >= ? AND ordered_at < ?`,
        [monthStart, monthEnd],
      );
      const returnRows = db.query<Record<string, unknown>>(
        `SELECT COUNT(*) AS cnt FROM returns WHERE created_at >= ? AND created_at < ?`,
        [monthStart, monthEnd],
      );

      const orders = Number(orderRows[0]?.cnt) || 0;
      const returns = Number(returnRows[0]?.cnt) || 0;
      if (orders > 0) values.push((returns / orders) * 100);
    }
  } catch {
    // returns table may not exist
  }
  return computePercentiles(values);
}

function getHistoricalProfitPerHour(db: Database): number[] {
  const values: number[] = [];
  for (let i = 0; i < 6; i++) {
    const monthStart = Date.now() - (i + 1) * 30 * MS_PER_DAY;
    const monthEnd = Date.now() - i * 30 * MS_PER_DAY;

    const rows = db.query<Record<string, unknown>>(
      `SELECT
         SUM(COALESCE(profit, sell_price - COALESCE(buy_price, 0) - COALESCE(shipping_cost, 0) - COALESCE(platform_fees, 0))) AS total_profit,
         COUNT(*) AS order_count
       FROM orders
       WHERE ordered_at >= ? AND ordered_at < ?
         AND status IN ('purchased', 'shipped', 'delivered')`,
      [monthStart, monthEnd],
    );

    const profit = Number(rows[0]?.total_profit) || 0;
    const count = Number(rows[0]?.order_count) || 0;
    if (count > 0) {
      const hours = (count * 15) / 60;
      values.push(safeDiv(profit, hours));
    }
  }
  return computePercentiles(values);
}

function getHistoricalHoldingPeriods(db: Database): number[] {
  const values: number[] = [];
  for (let i = 0; i < 6; i++) {
    const monthStart = Date.now() - (i + 1) * 30 * MS_PER_DAY;
    const monthEnd = Date.now() - i * 30 * MS_PER_DAY;

    const rows = db.query<Record<string, unknown>>(
      `SELECT AVG((o.ordered_at - l.created_at) / ${MS_PER_DAY}.0) AS avg_days
       FROM listings l
       JOIN orders o ON o.listing_id = l.id
       WHERE l.status = 'sold' AND o.ordered_at >= ? AND o.ordered_at < ?`,
      [monthStart, monthEnd],
    );
    const avg = Number(rows[0]?.avg_days);
    if (Number.isFinite(avg)) values.push(avg);
  }
  return computePercentiles(values);
}

/**
 * Compute [p30, p50, p70, p90] from a list of values.
 */
function computePercentiles(values: number[]): number[] {
  if (values.length === 0) return [0, 0, 0, 0];
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => {
    const idx = Math.max(0, Math.min(Math.floor((p / 100) * sorted.length), sorted.length - 1));
    return sorted[idx];
  };
  return [percentile(30), percentile(50), percentile(70), percentile(90)];
}

function getPreviousPeriodCutoffs(period: PeriodStr): { start: number; end: number } {
  const now = Date.now();
  switch (period) {
    case '7d':
      return { start: now - 14 * MS_PER_DAY, end: now - 7 * MS_PER_DAY };
    case '30d':
      return { start: now - 60 * MS_PER_DAY, end: now - 30 * MS_PER_DAY };
    case '90d':
      return { start: now - 180 * MS_PER_DAY, end: now - 90 * MS_PER_DAY };
    case 'ytd': {
      const d = new Date();
      const yearStart = new Date(d.getFullYear(), 0, 1).getTime();
      const prevYearStart = new Date(d.getFullYear() - 1, 0, 1).getTime();
      return { start: prevYearStart, end: yearStart };
    }
    default:
      return { start: now - 60 * MS_PER_DAY, end: now - 30 * MS_PER_DAY };
  }
}

function getPrevSellThroughRate(
  db: Database,
  cutoffs: { start: number; end: number },
): number | null {
  const listedRows = db.query<Record<string, unknown>>(
    `SELECT COUNT(*) AS cnt FROM listings WHERE created_at >= ? AND created_at < ?`,
    [cutoffs.start, cutoffs.end],
  );
  const soldRows = db.query<Record<string, unknown>>(
    `SELECT COUNT(*) AS cnt FROM listings WHERE created_at >= ? AND created_at < ? AND status = 'sold'`,
    [cutoffs.start, cutoffs.end],
  );

  const listed = Number(listedRows[0]?.cnt) || 0;
  const sold = Number(soldRows[0]?.cnt) || 0;
  if (listed === 0) return null;
  return round2((sold / listed) * 100);
}

function determineTrend(
  current: number,
  previous: number | null,
  lowerIsBetter = false,
): 'improving' | 'declining' | 'stable' {
  if (previous == null || !Number.isFinite(previous)) return 'stable';
  const diff = current - previous;
  const threshold = Math.max(Math.abs(previous) * 0.05, 0.01); // 5% change threshold

  if (Math.abs(diff) <= threshold) return 'stable';

  if (lowerIsBetter) {
    return diff < 0 ? 'improving' : 'declining';
  }
  return diff > 0 ? 'improving' : 'declining';
}
