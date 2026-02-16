/**
 * Demand Forecasting & Trend Prediction
 *
 * Forecasts future demand using moving averages and seasonal decomposition.
 * Detects seasonal patterns, estimates price elasticity, and identifies
 * trending/stalling products.
 */

import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import type {
  ForecastMethod,
  TrendDirection,
  DemandForecast,
  SeasonalPattern,
  PriceElasticity,
  TrendingCategory,
  StallingProduct,
} from './forecasting-types.js';

const logger = createLogger('analytics-forecasting');

// =============================================================================
// HELPERS
// =============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(denominator) || denominator === 0) return fallback;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : fallback;
}

function detectTrend(values: number[]): TrendDirection {
  if (values.length < 4) return 'stable';
  const mid = Math.floor(values.length / 2);
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);
  const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;

  if (avgFirst === 0 && avgSecond === 0) return 'stable';
  const changePct = safeDiv(avgSecond - avgFirst, Math.max(avgFirst, 0.001)) * 100;
  if (changePct > 10) return 'rising';
  if (changePct < -10) return 'falling';
  return 'stable';
}

// =============================================================================
// forecastDemand
// =============================================================================

/**
 * Predict future daily sales for a product using historical order data.
 */
export function forecastDemand(
  db: Database,
  productId: string,
  daysAhead = 14,
  method: ForecastMethod = 'wma',
): DemandForecast {
  const safeDaysAhead = Math.max(1, Math.min(daysAhead, 90));

  // Get daily order counts for this product over the last 90 days
  const cutoff = Date.now() - 90 * MS_PER_DAY;

  const rows = db.query<Record<string, unknown>>(
    `SELECT
       date(o.ordered_at / 1000, 'unixepoch') AS day,
       COUNT(*) AS order_count
     FROM orders o
     JOIN listings l ON o.listing_id = l.id
     WHERE l.product_id = ?
       AND o.ordered_at >= ?
       AND o.status IN ('purchased', 'shipped', 'delivered')
     GROUP BY day
     ORDER BY day ASC`,
    [productId, cutoff],
  );

  // Build a complete daily series (fill missing days with 0)
  const dailyCounts = fillDailySeries(rows, 90);
  const dataPointsUsed = dailyCounts.length;

  if (dataPointsUsed === 0) {
    return {
      productId,
      method,
      forecast: new Array(safeDaysAhead).fill(0),
      confidence: 0,
      trend: 'stable',
      historicalAvgDaily: 0,
      seasonality: { dayOfWeek: new Array(7).fill(1), monthOfYear: new Array(12).fill(1) },
      dataPointsUsed: 0,
    };
  }

  const historicalAvg = dailyCounts.reduce((s, v) => s + v, 0) / dailyCounts.length;
  const trend = detectTrend(dailyCounts);

  let forecast: number[];
  let confidence: number;

  switch (method) {
    case 'sma':
      ({ forecast, confidence } = simpleMovingAverage(dailyCounts, safeDaysAhead));
      break;
    case 'seasonal':
      ({ forecast, confidence } = seasonalForecast(dailyCounts, safeDaysAhead));
      break;
    case 'wma':
    default:
      ({ forecast, confidence } = weightedMovingAverage(dailyCounts, safeDaysAhead));
      break;
  }

  // Compute seasonality multipliers
  const seasonality = computeSeasonalityMultipliers(db, productId);

  return {
    productId,
    method,
    forecast: forecast.map((v) => round2(Math.max(0, v))),
    confidence: round2(confidence),
    trend,
    historicalAvgDaily: round2(historicalAvg),
    seasonality,
    dataPointsUsed,
  };
}

// =============================================================================
// detectSeasonalPatterns
// =============================================================================

/**
 * Detect day-of-week and monthly seasonal patterns for a category.
 */
export function detectSeasonalPatterns(
  db: Database,
  category: string,
  platform?: string,
): SeasonalPattern {
  const conditions: string[] = [
    'p.category = ?',
    "o.status IN ('purchased', 'shipped', 'delivered')",
  ];
  const params: unknown[] = [category];

  if (platform) {
    conditions.push('o.sell_platform = ?');
    params.push(platform);
  }

  // Day-of-week pattern
  const dowRows = db.query<Record<string, unknown>>(
    `SELECT
       CAST(strftime('%w', o.ordered_at / 1000, 'unixepoch') AS INTEGER) AS dow,
       COUNT(*) AS order_count
     FROM orders o
     JOIN listings l ON o.listing_id = l.id
     JOIN products p ON l.product_id = p.id
     WHERE ${conditions.join(' AND ')}
     GROUP BY dow
     ORDER BY dow ASC`,
    params,
  );

  const totalDowOrders = dowRows.reduce((s, r) => s + (Number(r.order_count) || 0), 0);
  const avgDowOrders = safeDiv(totalDowOrders, 7);

  const dayOfWeekPattern = Array.from({ length: 7 }, (_, i) => {
    const row = dowRows.find((r) => Number(r.dow) === i);
    const avgOrders = Number(row?.order_count) || 0;
    return {
      dayOfWeek: i,
      dayName: DAY_NAMES[i],
      avgOrders: round2(avgOrders),
      relativeStrength: round2(safeDiv(avgOrders, avgDowOrders, 1)),
    };
  });

  // Month pattern
  const monthRows = db.query<Record<string, unknown>>(
    `SELECT
       CAST(strftime('%m', o.ordered_at / 1000, 'unixepoch') AS INTEGER) AS month,
       COUNT(*) AS order_count
     FROM orders o
     JOIN listings l ON o.listing_id = l.id
     JOIN products p ON l.product_id = p.id
     WHERE ${conditions.join(' AND ')}
     GROUP BY month
     ORDER BY month ASC`,
    params,
  );

  const totalMonthOrders = monthRows.reduce((s, r) => s + (Number(r.order_count) || 0), 0);
  const avgMonthOrders = safeDiv(totalMonthOrders, 12);

  const monthPattern = Array.from({ length: 12 }, (_, i) => {
    const row = monthRows.find((r) => Number(r.month) === i + 1);
    const avgOrders = Number(row?.order_count) || 0;
    return {
      month: i + 1,
      monthName: MONTH_NAMES[i],
      avgOrders: round2(avgOrders),
      relativeStrength: round2(safeDiv(avgOrders, avgMonthOrders, 1)),
    };
  });

  // Identify peak/trough periods (>1.2x or <0.8x average)
  const peakPeriods: string[] = [];
  const troughPeriods: string[] = [];

  for (const d of dayOfWeekPattern) {
    if (d.relativeStrength > 1.2) peakPeriods.push(d.dayName);
    if (d.relativeStrength < 0.8) troughPeriods.push(d.dayName);
  }
  for (const m of monthPattern) {
    if (m.relativeStrength > 1.2) peakPeriods.push(m.monthName);
    if (m.relativeStrength < 0.8) troughPeriods.push(m.monthName);
  }

  const dataPointsUsed = totalDowOrders + totalMonthOrders;

  return {
    category,
    platform: platform ?? null,
    dayOfWeekPattern,
    monthPattern,
    peakPeriods,
    troughPeriods,
    dataPointsUsed,
  };
}

// =============================================================================
// estimatePriceElasticity
// =============================================================================

/**
 * Estimate how price changes affect demand for a product.
 * Correlates price changes with subsequent sales velocity changes.
 */
export function estimatePriceElasticity(
  db: Database,
  productId: string,
): PriceElasticity {
  // Get price history for this product's listings
  const priceRows = db.query<Record<string, unknown>>(
    `SELECT l.price, l.created_at, l.updated_at
     FROM listings l
     WHERE l.product_id = ?
     ORDER BY l.created_at ASC`,
    [productId],
  );

  // Get order history
  const orderRows = db.query<Record<string, unknown>>(
    `SELECT o.ordered_at, o.sell_price
     FROM orders o
     JOIN listings l ON o.listing_id = l.id
     WHERE l.product_id = ?
       AND o.status IN ('purchased', 'shipped', 'delivered')
     ORDER BY o.ordered_at ASC`,
    [productId],
  );

  if (priceRows.length < 2 || orderRows.length < 3) {
    return {
      productId,
      elasticity: 0,
      confidence: 0,
      interpretation: 'Insufficient data to estimate price elasticity. Need at least 2 price points and 3 orders.',
      priceChanges: 0,
      avgPriceChangePct: 0,
      avgVelocityChangePct: 0,
    };
  }

  // Detect price change events
  const priceChanges: Array<{
    priceBefore: number;
    priceAfter: number;
    changePct: number;
    velocityBefore: number;
    velocityAfter: number;
    velocityChangePct: number;
  }> = [];

  for (let i = 1; i < priceRows.length; i++) {
    const prevPrice = Number(priceRows[i - 1].price);
    const currPrice = Number(priceRows[i].price);
    if (!Number.isFinite(prevPrice) || !Number.isFinite(currPrice) || prevPrice === 0) continue;
    if (prevPrice === currPrice) continue;

    const changeTime = Number(priceRows[i].created_at);
    const pricePct = ((currPrice - prevPrice) / prevPrice) * 100;

    // Measure velocity (orders/day) in 7 days before and after change
    const windowMs = 7 * MS_PER_DAY;
    const ordersBefore = orderRows.filter((r) => {
      const t = Number(r.ordered_at);
      return t >= changeTime - windowMs && t < changeTime;
    }).length;
    const ordersAfter = orderRows.filter((r) => {
      const t = Number(r.ordered_at);
      return t >= changeTime && t < changeTime + windowMs;
    }).length;

    const velBefore = ordersBefore / 7;
    const velAfter = ordersAfter / 7;
    const velChangePct = velBefore > 0 ? ((velAfter - velBefore) / velBefore) * 100 : 0;

    priceChanges.push({
      priceBefore: prevPrice,
      priceAfter: currPrice,
      changePct: pricePct,
      velocityBefore: velBefore,
      velocityAfter: velAfter,
      velocityChangePct: velChangePct,
    });
  }

  if (priceChanges.length === 0) {
    return {
      productId,
      elasticity: 0,
      confidence: 0,
      interpretation: 'No meaningful price changes detected.',
      priceChanges: 0,
      avgPriceChangePct: 0,
      avgVelocityChangePct: 0,
    };
  }

  // Calculate average elasticity: % change in quantity / % change in price
  const elasticities = priceChanges
    .filter((pc) => Math.abs(pc.changePct) > 0.5)
    .map((pc) => safeDiv(pc.velocityChangePct, pc.changePct));

  const avgElasticity = elasticities.length > 0
    ? elasticities.reduce((s, e) => s + e, 0) / elasticities.length
    : 0;

  const avgPriceChangePct = priceChanges.reduce((s, pc) => s + Math.abs(pc.changePct), 0) / priceChanges.length;
  const avgVelocityChangePct = priceChanges.reduce((s, pc) => s + pc.velocityChangePct, 0) / priceChanges.length;

  // Confidence based on sample size
  const confidence = Math.min(1, priceChanges.length / 10);

  let interpretation: string;
  if (avgElasticity < -1) {
    interpretation = 'Highly elastic: demand is very sensitive to price changes. Small price increases significantly reduce sales.';
  } else if (avgElasticity < -0.5) {
    interpretation = 'Moderately elastic: demand responds noticeably to price changes.';
  } else if (avgElasticity < 0) {
    interpretation = 'Inelastic: demand is relatively insensitive to price changes. Price increases have minimal impact on sales.';
  } else if (avgElasticity === 0) {
    interpretation = 'No clear relationship detected between price changes and demand.';
  } else {
    interpretation = 'Unusual positive elasticity: higher prices may correlate with higher demand (possible prestige/quality signal).';
  }

  return {
    productId,
    elasticity: round2(avgElasticity),
    confidence: round2(confidence),
    interpretation,
    priceChanges: priceChanges.length,
    avgPriceChangePct: round2(avgPriceChangePct),
    avgVelocityChangePct: round2(avgVelocityChangePct),
  };
}

// =============================================================================
// getTrendingCategories
// =============================================================================

/**
 * Find categories with rising or falling sales velocity.
 */
export function getTrendingCategories(
  db: Database,
  options: {
    period?: '7d' | '14d' | '30d';
    direction?: 'rising' | 'falling' | 'both';
    limit?: number;
  } = {},
): TrendingCategory[] {
  const { period = '14d', direction = 'both', limit = 10 } = options;

  const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 14;
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const now = Date.now();
  const recentCutoff = now - periodDays * MS_PER_DAY;
  const priorCutoff = recentCutoff - periodDays * MS_PER_DAY;

  // Recent period velocity by category
  const recentRows = db.query<Record<string, unknown>>(
    `SELECT
       COALESCE(p.category, 'Uncategorized') AS category,
       COUNT(*) AS order_count,
       SUM(o.sell_price) AS revenue
     FROM orders o
     JOIN listings l ON o.listing_id = l.id
     JOIN products p ON l.product_id = p.id
     WHERE o.ordered_at >= ?
       AND o.status IN ('purchased', 'shipped', 'delivered')
     GROUP BY category`,
    [recentCutoff],
  );

  // Prior period velocity by category
  const priorRows = db.query<Record<string, unknown>>(
    `SELECT
       COALESCE(p.category, 'Uncategorized') AS category,
       COUNT(*) AS order_count
     FROM orders o
     JOIN listings l ON o.listing_id = l.id
     JOIN products p ON l.product_id = p.id
     WHERE o.ordered_at >= ? AND o.ordered_at < ?
       AND o.status IN ('purchased', 'shipped', 'delivered')
     GROUP BY category`,
    [priorCutoff, recentCutoff],
  );

  const priorMap = new Map<string, number>();
  for (const row of priorRows) {
    priorMap.set(row.category as string, Number(row.order_count) || 0);
  }

  const results: TrendingCategory[] = [];

  for (const row of recentRows) {
    const cat = row.category as string;
    const recentCount = Number(row.order_count) || 0;
    const revenue = Number(row.revenue) || 0;
    const priorCount = priorMap.get(cat) ?? 0;

    const currentVelocity = safeDiv(recentCount, periodDays);
    const previousVelocity = safeDiv(priorCount, periodDays);
    const changePct = safeDiv(currentVelocity - previousVelocity, Math.max(previousVelocity, 0.01)) * 100;

    let dir: TrendDirection;
    if (changePct > 10) dir = 'rising';
    else if (changePct < -10) dir = 'falling';
    else dir = 'stable';

    if (direction !== 'both' && dir !== direction) continue;

    results.push({
      category: cat,
      direction: dir,
      currentVelocity: round2(currentVelocity),
      previousVelocity: round2(previousVelocity),
      velocityChangePct: round2(changePct),
      orderCount: recentCount,
      revenue: round2(revenue),
    });
  }

  // Also include categories that appeared only in the prior period (falling to zero)
  if (direction === 'both' || direction === 'falling') {
    for (const [cat, priorCount] of priorMap.entries()) {
      if (results.some((r) => r.category === cat)) continue;
      if (priorCount === 0) continue;

      results.push({
        category: cat,
        direction: 'falling',
        currentVelocity: 0,
        previousVelocity: round2(safeDiv(priorCount, periodDays)),
        velocityChangePct: -100,
        orderCount: 0,
        revenue: 0,
      });
    }
  }

  // Sort by absolute velocity change
  results.sort((a, b) => Math.abs(b.velocityChangePct) - Math.abs(a.velocityChangePct));
  return results.slice(0, safeLimit);
}

// =============================================================================
// getStallingProducts
// =============================================================================

/**
 * Find products with declining velocity (candidates for markdown).
 */
export function getStallingProducts(
  db: Database,
  options: { minDaysListed?: number; limit?: number } = {},
): StallingProduct[] {
  const { minDaysListed = 14, limit = 20 } = options;
  const safeMinDays = Math.max(1, Math.min(minDaysListed, 365));
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const now = Date.now();
  const cutoffListedBefore = now - safeMinDays * MS_PER_DAY;

  // Get active listings that have been listed long enough
  const listingRows = db.query<Record<string, unknown>>(
    `SELECT
       l.id AS listing_id,
       l.product_id,
       l.platform,
       l.price,
       l.created_at,
       p.title,
       p.category
     FROM listings l
     JOIN products p ON l.product_id = p.id
     WHERE l.status = 'active'
       AND l.created_at <= ?
     ORDER BY l.created_at ASC`,
    [cutoffListedBefore],
  );

  const results: StallingProduct[] = [];

  for (const listing of listingRows) {
    const productId = listing.product_id as string;
    const listingId = listing.listing_id as string;
    const createdAt = Number(listing.created_at);
    const daysListed = Math.max(1, (now - createdAt) / MS_PER_DAY);

    // Recent 7 days orders
    const recentOrders = db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS cnt FROM orders o
       WHERE o.listing_id = ?
         AND o.ordered_at >= ?
         AND o.status IN ('purchased', 'shipped', 'delivered')`,
      [listingId, now - 7 * MS_PER_DAY],
    );
    const recentCount = Number(recentOrders[0]?.cnt) || 0;

    // Prior 7 days orders
    const priorOrders = db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS cnt FROM orders o
       WHERE o.listing_id = ?
         AND o.ordered_at >= ? AND o.ordered_at < ?
         AND o.status IN ('purchased', 'shipped', 'delivered')`,
      [listingId, now - 14 * MS_PER_DAY, now - 7 * MS_PER_DAY],
    );
    const priorCount = Number(priorOrders[0]?.cnt) || 0;

    const recentVelocity = recentCount / 7;
    const priorVelocity = priorCount / 7;
    const declinePct = priorVelocity > 0
      ? ((priorVelocity - recentVelocity) / priorVelocity) * 100
      : (recentVelocity === 0 ? 100 : 0);

    // Only include if velocity is actually declining or zero
    if (declinePct <= 0) continue;

    let suggestedAction: StallingProduct['suggestedAction'];
    if (daysListed > 60 && recentVelocity === 0) {
      suggestedAction = 'remove';
    } else if (declinePct > 50) {
      suggestedAction = 'markdown';
    } else if (declinePct > 20) {
      suggestedAction = 'reprice';
    } else {
      suggestedAction = 'monitor';
    }

    results.push({
      productId,
      title: (listing.title as string) ?? 'Unknown',
      category: (listing.category as string) ?? null,
      platform: listing.platform as string,
      daysListed: Math.round(daysListed),
      currentPrice: Number(listing.price) || 0,
      recentVelocity: round2(recentVelocity),
      priorVelocity: round2(priorVelocity),
      velocityDeclinePct: round2(declinePct),
      suggestedAction,
    });
  }

  // Sort by decline severity
  results.sort((a, b) => b.velocityDeclinePct - a.velocityDeclinePct);
  return results.slice(0, safeLimit);
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Fill a daily series from grouped SQL results, zero-filling missing days.
 */
function fillDailySeries(
  rows: Record<string, unknown>[],
  totalDays: number,
): number[] {
  const dayMap = new Map<string, number>();
  for (const row of rows) {
    dayMap.set(row.day as string, Number(row.order_count) || 0);
  }

  const now = new Date();
  const result: number[] = [];

  for (let i = totalDays - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * MS_PER_DAY);
    const key = d.toISOString().slice(0, 10);
    result.push(dayMap.get(key) ?? 0);
  }

  return result;
}

/**
 * Simple Moving Average forecast.
 */
function simpleMovingAverage(
  data: number[],
  daysAhead: number,
  window = 7,
): { forecast: number[]; confidence: number } {
  if (data.length === 0) return { forecast: new Array(daysAhead).fill(0), confidence: 0 };

  const safeWindow = Math.min(window, data.length);
  const tail = data.slice(-safeWindow);
  const avg = tail.reduce((s, v) => s + v, 0) / tail.length;

  const forecast = new Array(daysAhead).fill(round2(avg));

  // Confidence decreases with fewer data points
  const confidence = Math.min(1, data.length / 30) * 0.7; // SMA has lower confidence

  return { forecast, confidence };
}

/**
 * Weighted Moving Average forecast (recent data weighted more).
 */
function weightedMovingAverage(
  data: number[],
  daysAhead: number,
  window = 14,
): { forecast: number[]; confidence: number } {
  if (data.length === 0) return { forecast: new Array(daysAhead).fill(0), confidence: 0 };

  const safeWindow = Math.min(window, data.length);
  const tail = data.slice(-safeWindow);

  // Linearly increasing weights: [1, 2, 3, ..., n]
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < tail.length; i++) {
    const weight = i + 1;
    weightedSum += tail[i] * weight;
    totalWeight += weight;
  }
  const wma = safeDiv(weightedSum, totalWeight);

  // Apply trend adjustment
  const trend = data.length >= 7
    ? (data.slice(-7).reduce((s, v) => s + v, 0) / 7) -
      (data.slice(-14, -7).length > 0 ? data.slice(-14, -7).reduce((s, v) => s + v, 0) / Math.max(data.slice(-14, -7).length, 1) : wma)
    : 0;

  const forecast: number[] = [];
  for (let i = 0; i < daysAhead; i++) {
    // Dampen the trend projection further into the future
    const dampFactor = Math.pow(0.95, i);
    forecast.push(round2(Math.max(0, wma + trend * dampFactor * (i + 1) * 0.1)));
  }

  const confidence = Math.min(1, data.length / 30) * 0.8;

  return { forecast, confidence };
}

/**
 * Seasonal forecast using day-of-week patterns.
 */
function seasonalForecast(
  data: number[],
  daysAhead: number,
): { forecast: number[]; confidence: number } {
  if (data.length < 14) return weightedMovingAverage(data, daysAhead);

  // Compute day-of-week averages from the data
  const dowTotals: number[] = [0, 0, 0, 0, 0, 0, 0];
  const dowCounts: number[] = [0, 0, 0, 0, 0, 0, 0];

  const now = new Date();
  for (let i = 0; i < data.length; i++) {
    const d = new Date(now.getTime() - (data.length - 1 - i) * MS_PER_DAY);
    const dow = d.getDay();
    dowTotals[dow] += data[i];
    dowCounts[dow]++;
  }

  const dowAvg: number[] = dowTotals.map((t, i) => safeDiv(t, dowCounts[i]));
  const overallAvg = data.reduce((s, v) => s + v, 0) / data.length;

  // Multipliers for each day of week
  const dowMultiplier: number[] = dowAvg.map((a) => safeDiv(a, overallAvg, 1));

  // Base forecast using WMA
  const { forecast: baseForecast } = weightedMovingAverage(data, daysAhead);

  // Apply seasonal multipliers
  const forecast: number[] = [];
  for (let i = 0; i < daysAhead; i++) {
    const futureDate = new Date(now.getTime() + (i + 1) * MS_PER_DAY);
    const dow = futureDate.getDay();
    const base = baseForecast[i] ?? overallAvg;
    forecast.push(round2(Math.max(0, base * dowMultiplier[dow])));
  }

  const confidence = Math.min(1, data.length / 30) * 0.85;

  return { forecast, confidence };
}

/**
 * Compute seasonality multipliers (day of week + month of year) for a product.
 */
function computeSeasonalityMultipliers(
  db: Database,
  productId: string,
): { dayOfWeek: number[]; monthOfYear: number[] } {
  const defaultDow = new Array(7).fill(1);
  const defaultMonth = new Array(12).fill(1);

  const dowRows = db.query<Record<string, unknown>>(
    `SELECT
       CAST(strftime('%w', o.ordered_at / 1000, 'unixepoch') AS INTEGER) AS dow,
       COUNT(*) AS cnt
     FROM orders o
     JOIN listings l ON o.listing_id = l.id
     WHERE l.product_id = ?
       AND o.status IN ('purchased', 'shipped', 'delivered')
     GROUP BY dow`,
    [productId],
  );

  if (dowRows.length === 0) {
    return { dayOfWeek: defaultDow, monthOfYear: defaultMonth };
  }

  const totalDow = dowRows.reduce((s, r) => s + (Number(r.cnt) || 0), 0);
  const avgDow = safeDiv(totalDow, 7);

  const dayOfWeek = Array.from({ length: 7 }, (_, i) => {
    const row = dowRows.find((r) => Number(r.dow) === i);
    return round2(safeDiv(Number(row?.cnt) || 0, avgDow, 1));
  });

  const monthRows = db.query<Record<string, unknown>>(
    `SELECT
       CAST(strftime('%m', o.ordered_at / 1000, 'unixepoch') AS INTEGER) AS month,
       COUNT(*) AS cnt
     FROM orders o
     JOIN listings l ON o.listing_id = l.id
     WHERE l.product_id = ?
       AND o.status IN ('purchased', 'shipped', 'delivered')
     GROUP BY month`,
    [productId],
  );

  const totalMonth = monthRows.reduce((s, r) => s + (Number(r.cnt) || 0), 0);
  const avgMonth = safeDiv(totalMonth, 12);

  const monthOfYear = Array.from({ length: 12 }, (_, i) => {
    const row = monthRows.find((r) => Number(r.month) === i + 1);
    return round2(safeDiv(Number(row?.cnt) || 0, avgMonth, 1));
  });

  return { dayOfWeek, monthOfYear };
}
