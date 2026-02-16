/**
 * Price Intelligence - Historical price analysis for buy/sell timing
 *
 * Analyzes price_snapshots data to determine optimal buying and selling
 * windows. Detects drops, spikes, trends, and scores opportunities based
 * on where the current price sits within the historical range.
 */

import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';

const logger = createLogger('price-intelligence');

// =============================================================================
// HELPERS
// =============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(denominator) || denominator === 0) return fallback;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : fallback;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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

function computeStdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((s, d) => s + d, 0) / values.length;
  return Math.sqrt(variance);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// =============================================================================
// TYPES
// =============================================================================

export type TrendDirection = 'falling' | 'rising' | 'stable';
export type BuySignal = 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';

export interface PriceHistoryAnalysis {
  productId: string;
  productName: string | null;
  dataPoints: number;
  currentPrice: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  medianPrice: number;
  /** 0 = all-time low, 100 = all-time high */
  pricePosition: number;
  trend: TrendDirection;
  /** Coefficient of variation: stdDev / mean */
  volatility: number;
  signal: BuySignal;
  daysSinceLowest: number;
  daysSinceHighest: number;
  priceChange7d: number | null;
  priceChange30d: number | null;
  priceChange90d: number | null;
  analyzedAt: number;
}

export interface PriceDrop {
  productId: string;
  productName: string | null;
  platform: string;
  currentPrice: number;
  previousAvgPrice: number;
  dropPct: number;
  droppedSince: number;
}

export interface PriceSpike {
  productId: string;
  productName: string | null;
  platform: string;
  currentPrice: number;
  previousAvgPrice: number;
  spikePct: number;
  spikedSince: number;
}

export interface CategoryPriceTrend {
  category: string | null;
  platform: string | null;
  productCount: number;
  avgCurrentPrice: number;
  avgPreviousPrice: number;
  changePct: number;
  trend: TrendDirection;
}

export interface BuyOpportunity {
  productId: string;
  productName: string | null;
  platform: string;
  currentPrice: number;
  minPrice: number;
  avgPrice: number;
  pricePosition: number;
  recentDropPct: number;
  trend: TrendDirection;
  volatility: number;
  score: number;
}

export interface SellOpportunity {
  productId: string;
  productName: string | null;
  platform: string;
  currentPrice: number;
  maxPrice: number;
  avgPrice: number;
  pricePosition: number;
  recentSpikePct: number;
  trend: TrendDirection;
  demandScore: number;
  score: number;
}

export interface PriceDistribution {
  productId: string;
  productName: string | null;
  bucketCount: number;
  minPrice: number;
  maxPrice: number;
  bucketWidth: number;
  buckets: Array<{
    rangeMin: number;
    rangeMax: number;
    count: number;
    pct: number;
  }>;
  totalSnapshots: number;
}

export interface PlatformPriceComparison {
  platform: string;
  currentPrice: number | null;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  dataPoints: number;
  trend: TrendDirection;
  lastUpdated: number;
}

export interface CrossPlatformComparison {
  productId: string;
  productName: string | null;
  platforms: PlatformPriceComparison[];
  cheapestPlatform: string | null;
  mostExpensivePlatform: string | null;
  spreadPct: number | null;
}

// =============================================================================
// OPTIONS TYPES
// =============================================================================

export interface DetectDropsOptions {
  minDropPct?: number;
  maxDaysBack?: number;
  platforms?: string[];
  categories?: string[];
  limit?: number;
}

export interface DetectSpikesOptions {
  minSpikePct?: number;
  maxDaysBack?: number;
  platforms?: string[];
  categories?: string[];
  limit?: number;
}

export interface FindBuyOpportunitiesOptions {
  platforms?: string[];
  categories?: string[];
  minDataPoints?: number;
  limit?: number;
}

export interface FindSellOpportunitiesOptions {
  platforms?: string[];
  categories?: string[];
  minDataPoints?: number;
  limit?: number;
}

// =============================================================================
// analyzePriceHistory
// =============================================================================

/**
 * Full price history analysis for a single product.
 */
export function analyzePriceHistory(
  db: Database,
  productId: string,
  days = 90,
): PriceHistoryAnalysis | null {
  const safeDays = Math.max(1, Math.min(days, 730));
  const cutoff = Date.now() - safeDays * MS_PER_DAY;

  const rows = db.query<Record<string, unknown>>(
    `SELECT price, timestamp
     FROM price_snapshots
     WHERE product_id = ? AND timestamp >= ?
     ORDER BY timestamp ASC`,
    [productId, cutoff],
  );

  if (rows.length === 0) {
    logger.debug({ productId }, 'No price snapshots found');
    return null;
  }

  // Get product name
  const productRow = db.query<Record<string, unknown>>(
    'SELECT title FROM products WHERE id = ?',
    [productId],
  );
  const productName = productRow.length > 0 ? (productRow[0].title as string) ?? null : null;

  const prices = rows
    .map((r) => Number(r.price))
    .filter((p) => Number.isFinite(p) && p > 0);

  if (prices.length === 0) return null;

  const timestamps = rows.map((r) => Number(r.timestamp));

  const currentPrice = prices[prices.length - 1];
  const avgPrice = prices.reduce((s, p) => s + p, 0) / prices.length;
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const medianPrice = computeMedian(prices);
  const range = maxPrice - minPrice;
  const pricePosition = range > 0 ? round2(((currentPrice - minPrice) / range) * 100) : 50;

  // Trend: compare last 7d avg to prior 7d avg
  const now = Date.now();
  const sevenDaysAgo = now - 7 * MS_PER_DAY;
  const fourteenDaysAgo = now - 14 * MS_PER_DAY;

  const recent7d = prices.filter((_, i) => timestamps[i] >= sevenDaysAgo);
  const prior7d = prices.filter(
    (_, i) => timestamps[i] >= fourteenDaysAgo && timestamps[i] < sevenDaysAgo,
  );

  let trend: TrendDirection = 'stable';
  if (recent7d.length > 0 && prior7d.length > 0) {
    const recentAvg = recent7d.reduce((s, p) => s + p, 0) / recent7d.length;
    const priorAvg = prior7d.reduce((s, p) => s + p, 0) / prior7d.length;
    const changePct = safeDiv(recentAvg - priorAvg, priorAvg, 0) * 100;
    if (changePct < -3) trend = 'falling';
    else if (changePct > 3) trend = 'rising';
  }

  // Volatility: coefficient of variation
  const stdDev = computeStdDev(prices, avgPrice);
  const volatility = round2(safeDiv(stdDev, avgPrice, 0));

  // Buy signal
  const signal = determineBuySignal(pricePosition, trend);

  // Days since lowest / highest
  let lowestTimestamp = timestamps[0];
  let highestTimestamp = timestamps[0];
  for (let i = 0; i < prices.length; i++) {
    if (prices[i] <= minPrice) lowestTimestamp = timestamps[i];
    if (prices[i] >= maxPrice) highestTimestamp = timestamps[i];
  }
  const daysSinceLowest = Math.floor((now - lowestTimestamp) / MS_PER_DAY);
  const daysSinceHighest = Math.floor((now - highestTimestamp) / MS_PER_DAY);

  // Price changes over periods
  const priceChange7d = computePriceChange(prices, timestamps, 7);
  const priceChange30d = computePriceChange(prices, timestamps, 30);
  const priceChange90d = computePriceChange(prices, timestamps, 90);

  return {
    productId,
    productName,
    dataPoints: prices.length,
    currentPrice: round2(currentPrice),
    avgPrice: round2(avgPrice),
    minPrice: round2(minPrice),
    maxPrice: round2(maxPrice),
    medianPrice: round2(medianPrice),
    pricePosition: clamp(pricePosition, 0, 100),
    trend,
    volatility,
    signal,
    daysSinceLowest,
    daysSinceHighest,
    priceChange7d: priceChange7d !== null ? round2(priceChange7d) : null,
    priceChange30d: priceChange30d !== null ? round2(priceChange30d) : null,
    priceChange90d: priceChange90d !== null ? round2(priceChange90d) : null,
    analyzedAt: Date.now(),
  };
}

function determineBuySignal(pricePosition: number, trend: TrendDirection): BuySignal {
  if (pricePosition <= 20 && trend === 'falling') return 'strong_buy';
  if (pricePosition <= 40) return 'buy';
  if (pricePosition >= 80 && trend === 'rising') return 'strong_sell';
  if (pricePosition >= 60) return 'sell';
  return 'hold';
}

function computePriceChange(
  prices: number[],
  timestamps: number[],
  periodDays: number,
): number | null {
  if (prices.length < 2) return null;
  const now = Date.now();
  const cutoff = now - periodDays * MS_PER_DAY;

  // Find the earliest price on or after the cutoff
  let basePrice: number | null = null;
  for (let i = 0; i < timestamps.length; i++) {
    if (timestamps[i] >= cutoff) {
      basePrice = prices[i];
      break;
    }
  }

  if (basePrice === null || basePrice === 0) return null;
  const currentPrice = prices[prices.length - 1];
  return safeDiv(currentPrice - basePrice, basePrice, 0) * 100;
}

// =============================================================================
// detectPriceDrops
// =============================================================================

/**
 * Find products where current price dropped significantly from recent average.
 */
export function detectPriceDrops(
  db: Database,
  opts: DetectDropsOptions = {},
): PriceDrop[] {
  const {
    minDropPct = 15,
    maxDaysBack = 30,
    platforms,
    categories,
    limit = 50,
  } = opts;

  const now = Date.now();
  const cutoff = now - maxDaysBack * MS_PER_DAY;
  // "Recent" = last 3 days for current price, rest of window for average
  const recentCutoff = now - 3 * MS_PER_DAY;

  const conditions: string[] = ['ps.timestamp >= ?'];
  const params: unknown[] = [cutoff];

  if (platforms && platforms.length > 0) {
    const placeholders = platforms.map(() => '?').join(',');
    conditions.push(`ps.platform IN (${placeholders})`);
    params.push(...platforms);
  }

  if (categories && categories.length > 0) {
    const placeholders = categories.map(() => '?').join(',');
    conditions.push(`p.category IN (${placeholders})`);
    params.push(...categories);
  }

  const needsJoin = (categories && categories.length > 0) ? true : false;

  // Two-phase: get recent avg vs older avg per product+platform
  const sql = `
    SELECT
      ps.product_id,
      p.title AS product_name,
      ps.platform,
      AVG(CASE WHEN ps.timestamp >= ? THEN ps.price ELSE NULL END) AS recent_avg,
      AVG(CASE WHEN ps.timestamp < ? THEN ps.price ELSE NULL END) AS older_avg,
      COUNT(CASE WHEN ps.timestamp >= ? THEN 1 ELSE NULL END) AS recent_count,
      COUNT(CASE WHEN ps.timestamp < ? THEN 1 ELSE NULL END) AS older_count
    FROM price_snapshots ps
    JOIN products p ON ps.product_id = p.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY ps.product_id, ps.platform
    HAVING recent_count > 0 AND older_count >= 2
    ORDER BY (recent_avg - older_avg) / older_avg ASC
    LIMIT ?`;

  const fullParams = [recentCutoff, recentCutoff, recentCutoff, recentCutoff, ...params, limit];

  const rows = db.query<Record<string, unknown>>(sql, fullParams);

  const drops: PriceDrop[] = [];
  for (const row of rows) {
    const recentAvg = Number(row.recent_avg) || 0;
    const olderAvg = Number(row.older_avg) || 0;
    if (olderAvg <= 0 || recentAvg <= 0) continue;

    const dropPct = safeDiv(olderAvg - recentAvg, olderAvg, 0) * 100;
    if (dropPct < minDropPct) continue;

    drops.push({
      productId: row.product_id as string,
      productName: (row.product_name as string) ?? null,
      platform: row.platform as string,
      currentPrice: round2(recentAvg),
      previousAvgPrice: round2(olderAvg),
      dropPct: round2(dropPct),
      droppedSince: cutoff,
    });
  }

  // Already sorted by biggest drop (ASC recent-older diff, so most negative first)
  logger.info({ dropCount: drops.length, minDropPct }, 'Price drops detected');
  return drops;
}

// =============================================================================
// detectPriceSpikes
// =============================================================================

/**
 * Find products where current price spiked significantly above recent average.
 */
export function detectPriceSpikes(
  db: Database,
  opts: DetectSpikesOptions = {},
): PriceSpike[] {
  const {
    minSpikePct = 15,
    maxDaysBack = 30,
    platforms,
    categories,
    limit = 50,
  } = opts;

  const now = Date.now();
  const cutoff = now - maxDaysBack * MS_PER_DAY;
  const recentCutoff = now - 3 * MS_PER_DAY;

  const conditions: string[] = ['ps.timestamp >= ?'];
  const params: unknown[] = [cutoff];

  if (platforms && platforms.length > 0) {
    const placeholders = platforms.map(() => '?').join(',');
    conditions.push(`ps.platform IN (${placeholders})`);
    params.push(...platforms);
  }

  if (categories && categories.length > 0) {
    const placeholders = categories.map(() => '?').join(',');
    conditions.push(`p.category IN (${placeholders})`);
    params.push(...categories);
  }

  const sql = `
    SELECT
      ps.product_id,
      p.title AS product_name,
      ps.platform,
      AVG(CASE WHEN ps.timestamp >= ? THEN ps.price ELSE NULL END) AS recent_avg,
      AVG(CASE WHEN ps.timestamp < ? THEN ps.price ELSE NULL END) AS older_avg,
      COUNT(CASE WHEN ps.timestamp >= ? THEN 1 ELSE NULL END) AS recent_count,
      COUNT(CASE WHEN ps.timestamp < ? THEN 1 ELSE NULL END) AS older_count
    FROM price_snapshots ps
    JOIN products p ON ps.product_id = p.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY ps.product_id, ps.platform
    HAVING recent_count > 0 AND older_count >= 2
    ORDER BY (recent_avg - older_avg) / older_avg DESC
    LIMIT ?`;

  const fullParams = [recentCutoff, recentCutoff, recentCutoff, recentCutoff, ...params, limit];

  const rows = db.query<Record<string, unknown>>(sql, fullParams);

  const spikes: PriceSpike[] = [];
  for (const row of rows) {
    const recentAvg = Number(row.recent_avg) || 0;
    const olderAvg = Number(row.older_avg) || 0;
    if (olderAvg <= 0 || recentAvg <= 0) continue;

    const spikePct = safeDiv(recentAvg - olderAvg, olderAvg, 0) * 100;
    if (spikePct < minSpikePct) continue;

    spikes.push({
      productId: row.product_id as string,
      productName: (row.product_name as string) ?? null,
      platform: row.platform as string,
      currentPrice: round2(recentAvg),
      previousAvgPrice: round2(olderAvg),
      spikePct: round2(spikePct),
      spikedSince: cutoff,
    });
  }

  logger.info({ spikeCount: spikes.length, minSpikePct }, 'Price spikes detected');
  return spikes;
}

// =============================================================================
// getPriceTrends
// =============================================================================

/**
 * Aggregate price trends by category and/or platform.
 */
export function getPriceTrends(
  db: Database,
  category?: string,
  platform?: string,
  days = 30,
): CategoryPriceTrend[] {
  const safeDays = Math.max(1, Math.min(days, 365));
  const now = Date.now();
  const cutoff = now - safeDays * MS_PER_DAY;
  const midpoint = now - Math.floor(safeDays / 2) * MS_PER_DAY;

  const conditions: string[] = ['ps.timestamp >= ?'];
  const params: unknown[] = [cutoff];

  if (category) {
    conditions.push('p.category = ?');
    params.push(category);
  }
  if (platform) {
    conditions.push('ps.platform = ?');
    params.push(platform);
  }

  // Compare first half avg to second half avg, grouped by category + platform
  const sql = `
    SELECT
      p.category,
      ps.platform,
      COUNT(DISTINCT ps.product_id) AS product_count,
      AVG(CASE WHEN ps.timestamp >= ? THEN ps.price ELSE NULL END) AS recent_avg,
      AVG(CASE WHEN ps.timestamp < ? THEN ps.price ELSE NULL END) AS earlier_avg
    FROM price_snapshots ps
    JOIN products p ON ps.product_id = p.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY p.category, ps.platform
    HAVING recent_avg IS NOT NULL AND earlier_avg IS NOT NULL
    ORDER BY (recent_avg - earlier_avg) / earlier_avg ASC`;

  const fullParams = [midpoint, midpoint, ...params];

  const rows = db.query<Record<string, unknown>>(sql, fullParams);

  const trends: CategoryPriceTrend[] = [];
  for (const row of rows) {
    const recentAvg = Number(row.recent_avg) || 0;
    const earlierAvg = Number(row.earlier_avg) || 0;
    if (earlierAvg <= 0) continue;

    const changePct = safeDiv(recentAvg - earlierAvg, earlierAvg, 0) * 100;

    let trend: TrendDirection = 'stable';
    if (changePct < -3) trend = 'falling';
    else if (changePct > 3) trend = 'rising';

    trends.push({
      category: (row.category as string) ?? null,
      platform: (row.platform as string) ?? null,
      productCount: Number(row.product_count) || 0,
      avgCurrentPrice: round2(recentAvg),
      avgPreviousPrice: round2(earlierAvg),
      changePct: round2(changePct),
      trend,
    });
  }

  logger.info({ trendCount: trends.length, category, platform, days: safeDays }, 'Price trends computed');
  return trends;
}

// =============================================================================
// findBuyOpportunities
// =============================================================================

/**
 * Score and rank best buying opportunities by combining price position,
 * recent drop magnitude, downtrend strength, and stability.
 *
 * Score 0-100:
 *   - Price position closeness to all-time low: 40%
 *   - Recent drop magnitude: 30%
 *   - Downtrend strength: 20%
 *   - Stability (low volatility preferred): 10%
 */
export function findBuyOpportunities(
  db: Database,
  opts: FindBuyOpportunitiesOptions = {},
): BuyOpportunity[] {
  const {
    platforms,
    categories,
    minDataPoints = 5,
    limit = 50,
  } = opts;

  const now = Date.now();
  const cutoff90d = now - 90 * MS_PER_DAY;
  const cutoff3d = now - 3 * MS_PER_DAY;

  const conditions: string[] = ['ps.timestamp >= ?'];
  const params: unknown[] = [cutoff90d];

  if (platforms && platforms.length > 0) {
    const placeholders = platforms.map(() => '?').join(',');
    conditions.push(`ps.platform IN (${placeholders})`);
    params.push(...platforms);
  }
  if (categories && categories.length > 0) {
    const placeholders = categories.map(() => '?').join(',');
    conditions.push(`p.category IN (${placeholders})`);
    params.push(...categories);
  }

  const sql = `
    SELECT
      ps.product_id,
      p.title AS product_name,
      ps.platform,
      COUNT(*) AS data_points,
      MIN(ps.price) AS min_price,
      MAX(ps.price) AS max_price,
      AVG(ps.price) AS avg_price,
      AVG(CASE WHEN ps.timestamp >= ? THEN ps.price ELSE NULL END) AS recent_price,
      AVG(CASE WHEN ps.timestamp < ? AND ps.timestamp >= ? THEN ps.price ELSE NULL END) AS older_price
    FROM price_snapshots ps
    JOIN products p ON ps.product_id = p.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY ps.product_id, ps.platform
    HAVING data_points >= ? AND recent_price IS NOT NULL`;

  const cutoff30d = now - 30 * MS_PER_DAY;
  const fullParams = [cutoff3d, cutoff3d, cutoff30d, ...params, minDataPoints];

  const rows = db.query<Record<string, unknown>>(sql, fullParams);

  const opportunities: BuyOpportunity[] = [];

  for (const row of rows) {
    const minP = Number(row.min_price) || 0;
    const maxP = Number(row.max_price) || 0;
    const avgP = Number(row.avg_price) || 0;
    const recentP = Number(row.recent_price) || 0;
    const olderP = Number(row.older_price) || 0;
    const range = maxP - minP;

    if (range <= 0 || recentP <= 0 || avgP <= 0) continue;

    const pricePosition = clamp(((recentP - minP) / range) * 100, 0, 100);

    // Recent drop: how much did price fall from older average
    let recentDropPct = 0;
    if (olderP > 0) {
      recentDropPct = Math.max(0, safeDiv(olderP - recentP, olderP, 0) * 100);
    }

    // Trend: compare recent to avg
    const trendPct = safeDiv(recentP - avgP, avgP, 0) * 100;
    let trend: TrendDirection = 'stable';
    if (trendPct < -3) trend = 'falling';
    else if (trendPct > 3) trend = 'rising';

    // Compute volatility from all prices for this group
    const allPriceRows = db.query<Record<string, unknown>>(
      `SELECT price FROM price_snapshots
       WHERE product_id = ? AND platform = ? AND timestamp >= ?
       ORDER BY timestamp ASC`,
      [row.product_id, row.platform, cutoff90d],
    );
    const allPrices = allPriceRows.map((r) => Number(r.price)).filter((p) => Number.isFinite(p) && p > 0);
    const stdDev = computeStdDev(allPrices, avgP);
    const volatility = safeDiv(stdDev, avgP, 0);

    // Score components (all normalized 0-100)
    const positionScore = 100 - pricePosition; // Lower position = higher score
    const dropScore = clamp(recentDropPct * 2, 0, 100); // 50% drop = max score
    const trendScore = trend === 'falling' ? 80 : trend === 'stable' ? 40 : 10;
    const stabilityScore = clamp(100 - volatility * 500, 0, 100); // Low vol = high score

    const score = round2(
      positionScore * 0.4 +
      dropScore * 0.3 +
      trendScore * 0.2 +
      stabilityScore * 0.1,
    );

    opportunities.push({
      productId: row.product_id as string,
      productName: (row.product_name as string) ?? null,
      platform: row.platform as string,
      currentPrice: round2(recentP),
      minPrice: round2(minP),
      avgPrice: round2(avgP),
      pricePosition: round2(pricePosition),
      recentDropPct: round2(recentDropPct),
      trend,
      volatility: round2(volatility),
      score,
    });
  }

  // Sort by score descending
  opportunities.sort((a, b) => b.score - a.score);

  const result = opportunities.slice(0, Math.max(1, limit));
  logger.info({ total: opportunities.length, returned: result.length }, 'Buy opportunities ranked');
  return result;
}

// =============================================================================
// findSellOpportunities
// =============================================================================

/**
 * Score and rank best selling opportunities.
 *
 * Score 0-100:
 *   - Price position closeness to all-time high: 40%
 *   - Recent spike magnitude: 30%
 *   - Uptrend strength: 20%
 *   - Demand proxy (order count): 10%
 */
export function findSellOpportunities(
  db: Database,
  opts: FindSellOpportunitiesOptions = {},
): SellOpportunity[] {
  const {
    platforms,
    categories,
    minDataPoints = 5,
    limit = 50,
  } = opts;

  const now = Date.now();
  const cutoff90d = now - 90 * MS_PER_DAY;
  const cutoff3d = now - 3 * MS_PER_DAY;
  const cutoff30d = now - 30 * MS_PER_DAY;

  const conditions: string[] = ['ps.timestamp >= ?'];
  const params: unknown[] = [cutoff90d];

  if (platforms && platforms.length > 0) {
    const placeholders = platforms.map(() => '?').join(',');
    conditions.push(`ps.platform IN (${placeholders})`);
    params.push(...platforms);
  }
  if (categories && categories.length > 0) {
    const placeholders = categories.map(() => '?').join(',');
    conditions.push(`p.category IN (${placeholders})`);
    params.push(...categories);
  }

  const sql = `
    SELECT
      ps.product_id,
      p.title AS product_name,
      ps.platform,
      COUNT(*) AS data_points,
      MIN(ps.price) AS min_price,
      MAX(ps.price) AS max_price,
      AVG(ps.price) AS avg_price,
      AVG(CASE WHEN ps.timestamp >= ? THEN ps.price ELSE NULL END) AS recent_price,
      AVG(CASE WHEN ps.timestamp < ? AND ps.timestamp >= ? THEN ps.price ELSE NULL END) AS older_price
    FROM price_snapshots ps
    JOIN products p ON ps.product_id = p.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY ps.product_id, ps.platform
    HAVING data_points >= ? AND recent_price IS NOT NULL`;

  const fullParams = [cutoff3d, cutoff3d, cutoff30d, ...params, minDataPoints];

  const rows = db.query<Record<string, unknown>>(sql, fullParams);

  const opportunities: SellOpportunity[] = [];

  for (const row of rows) {
    const minP = Number(row.min_price) || 0;
    const maxP = Number(row.max_price) || 0;
    const avgP = Number(row.avg_price) || 0;
    const recentP = Number(row.recent_price) || 0;
    const olderP = Number(row.older_price) || 0;
    const range = maxP - minP;

    if (range <= 0 || recentP <= 0 || avgP <= 0) continue;

    const pricePosition = clamp(((recentP - minP) / range) * 100, 0, 100);

    // Recent spike: how much did price rise from older average
    let recentSpikePct = 0;
    if (olderP > 0) {
      recentSpikePct = Math.max(0, safeDiv(recentP - olderP, olderP, 0) * 100);
    }

    // Trend
    const trendPct = safeDiv(recentP - avgP, avgP, 0) * 100;
    let trend: TrendDirection = 'stable';
    if (trendPct < -3) trend = 'falling';
    else if (trendPct > 3) trend = 'rising';

    // Demand proxy: count of orders for this product in last 30 days
    const orderRows = db.query<Record<string, unknown>>(
      `SELECT COUNT(*) AS cnt FROM orders o
       JOIN listings l ON o.listing_id = l.id
       WHERE l.product_id = ? AND o.ordered_at >= ?`,
      [row.product_id, cutoff30d],
    );
    const orderCount = Number(orderRows[0]?.cnt) || 0;
    // Normalize order count: 10+ orders = max score
    const demandScore = clamp(orderCount * 10, 0, 100);

    // Score components
    const positionScore = pricePosition; // Higher position = higher sell score
    const spikeScore = clamp(recentSpikePct * 2, 0, 100);
    const trendScore = trend === 'rising' ? 80 : trend === 'stable' ? 40 : 10;

    const score = round2(
      positionScore * 0.4 +
      spikeScore * 0.3 +
      trendScore * 0.2 +
      demandScore * 0.1,
    );

    opportunities.push({
      productId: row.product_id as string,
      productName: (row.product_name as string) ?? null,
      platform: row.platform as string,
      currentPrice: round2(recentP),
      maxPrice: round2(maxP),
      avgPrice: round2(avgP),
      pricePosition: round2(pricePosition),
      recentSpikePct: round2(recentSpikePct),
      trend,
      demandScore: round2(demandScore),
      score,
    });
  }

  // Sort by score descending
  opportunities.sort((a, b) => b.score - a.score);

  const result = opportunities.slice(0, Math.max(1, limit));
  logger.info({ total: opportunities.length, returned: result.length }, 'Sell opportunities ranked');
  return result;
}

// =============================================================================
// getPriceDistribution
// =============================================================================

/**
 * Build a histogram of prices for a product (10 equal-width buckets).
 */
export function getPriceDistribution(
  db: Database,
  productId: string,
): PriceDistribution | null {
  const rows = db.query<Record<string, unknown>>(
    `SELECT price FROM price_snapshots
     WHERE product_id = ?
     ORDER BY price ASC`,
    [productId],
  );

  if (rows.length === 0) return null;

  const productRow = db.query<Record<string, unknown>>(
    'SELECT title FROM products WHERE id = ?',
    [productId],
  );
  const productName = productRow.length > 0 ? (productRow[0].title as string) ?? null : null;

  const prices = rows
    .map((r) => Number(r.price))
    .filter((p) => Number.isFinite(p) && p > 0);

  if (prices.length === 0) return null;

  const minPrice = prices[0]; // Already sorted ASC
  const maxPrice = prices[prices.length - 1];

  const bucketCount = 10;
  const range = maxPrice - minPrice;
  // If all prices are identical, single bucket
  const bucketWidth = range > 0 ? range / bucketCount : 1;

  const bucketCounts = new Array(bucketCount).fill(0);

  for (const price of prices) {
    let idx = range > 0 ? Math.floor((price - minPrice) / bucketWidth) : 0;
    // Clamp the max price into the last bucket
    if (idx >= bucketCount) idx = bucketCount - 1;
    bucketCounts[idx]++;
  }

  const buckets = bucketCounts.map((count, i) => ({
    rangeMin: round2(minPrice + i * bucketWidth),
    rangeMax: round2(minPrice + (i + 1) * bucketWidth),
    count,
    pct: round2(safeDiv(count, prices.length, 0) * 100),
  }));

  return {
    productId,
    productName,
    bucketCount,
    minPrice: round2(minPrice),
    maxPrice: round2(maxPrice),
    bucketWidth: round2(bucketWidth),
    buckets,
    totalSnapshots: prices.length,
  };
}

// =============================================================================
// comparePlatformPrices
// =============================================================================

/**
 * Cross-platform price comparison for a single product.
 * Shows current price, avg, min, max, trend for each platform.
 */
export function comparePlatformPrices(
  db: Database,
  productId: string,
): CrossPlatformComparison | null {
  const productRow = db.query<Record<string, unknown>>(
    'SELECT title FROM products WHERE id = ?',
    [productId],
  );
  const productName = productRow.length > 0 ? (productRow[0].title as string) ?? null : null;

  // Get all platforms with data for this product
  const platformRows = db.query<Record<string, unknown>>(
    'SELECT DISTINCT platform FROM price_snapshots WHERE product_id = ?',
    [productId],
  );

  if (platformRows.length === 0) return null;

  const now = Date.now();
  const cutoff90d = now - 90 * MS_PER_DAY;
  const cutoff7d = now - 7 * MS_PER_DAY;
  const cutoff14d = now - 14 * MS_PER_DAY;

  const platforms: PlatformPriceComparison[] = [];

  for (const pRow of platformRows) {
    const platform = pRow.platform as string;

    // Aggregate stats
    const statsRows = db.query<Record<string, unknown>>(
      `SELECT
         AVG(price) AS avg_price,
         MIN(price) AS min_price,
         MAX(price) AS max_price,
         COUNT(*) AS data_points,
         MAX(timestamp) AS last_updated
       FROM price_snapshots
       WHERE product_id = ? AND platform = ? AND timestamp >= ?`,
      [productId, platform, cutoff90d],
    );

    if (statsRows.length === 0) continue;

    const stats = statsRows[0];
    const avgPrice = Number(stats.avg_price) || 0;
    const minPrice = Number(stats.min_price) || 0;
    const maxPrice = Number(stats.max_price) || 0;
    const dataPoints = Number(stats.data_points) || 0;
    const lastUpdated = Number(stats.last_updated) || 0;

    if (dataPoints === 0 || avgPrice <= 0) continue;

    // Current price: most recent snapshot
    const latestRows = db.query<Record<string, unknown>>(
      `SELECT price FROM price_snapshots
       WHERE product_id = ? AND platform = ?
       ORDER BY timestamp DESC LIMIT 1`,
      [productId, platform],
    );
    const currentPrice = latestRows.length > 0 ? Number(latestRows[0].price) || null : null;

    // Trend: recent 7d avg vs prior 7d avg
    const recent7dRows = db.query<Record<string, unknown>>(
      `SELECT AVG(price) AS avg_p FROM price_snapshots
       WHERE product_id = ? AND platform = ? AND timestamp >= ?`,
      [productId, platform, cutoff7d],
    );
    const prior7dRows = db.query<Record<string, unknown>>(
      `SELECT AVG(price) AS avg_p FROM price_snapshots
       WHERE product_id = ? AND platform = ? AND timestamp >= ? AND timestamp < ?`,
      [productId, platform, cutoff14d, cutoff7d],
    );

    const recentAvg = Number(recent7dRows[0]?.avg_p) || 0;
    const priorAvg = Number(prior7dRows[0]?.avg_p) || 0;

    let trend: TrendDirection = 'stable';
    if (recentAvg > 0 && priorAvg > 0) {
      const changePct = safeDiv(recentAvg - priorAvg, priorAvg, 0) * 100;
      if (changePct < -3) trend = 'falling';
      else if (changePct > 3) trend = 'rising';
    }

    platforms.push({
      platform,
      currentPrice: currentPrice !== null ? round2(currentPrice) : null,
      avgPrice: round2(avgPrice),
      minPrice: round2(minPrice),
      maxPrice: round2(maxPrice),
      dataPoints,
      trend,
      lastUpdated,
    });
  }

  if (platforms.length === 0) return null;

  // Identify cheapest and most expensive (by current price, fall back to avg)
  const withCurrent = platforms.filter((p) => p.currentPrice !== null);
  const sortedByPrice = withCurrent.length > 0
    ? [...withCurrent].sort((a, b) => (a.currentPrice ?? a.avgPrice) - (b.currentPrice ?? b.avgPrice))
    : [...platforms].sort((a, b) => a.avgPrice - b.avgPrice);

  const cheapest = sortedByPrice[0];
  const mostExpensive = sortedByPrice[sortedByPrice.length - 1];

  const cheapPrice = cheapest.currentPrice ?? cheapest.avgPrice;
  const expPrice = mostExpensive.currentPrice ?? mostExpensive.avgPrice;
  const spreadPct = cheapPrice > 0 && sortedByPrice.length > 1
    ? round2(safeDiv(expPrice - cheapPrice, cheapPrice, 0) * 100)
    : null;

  return {
    productId,
    productName,
    platforms,
    cheapestPlatform: cheapest.platform,
    mostExpensivePlatform: sortedByPrice.length > 1 ? mostExpensive.platform : null,
    spreadPct,
  };
}
