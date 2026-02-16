/**
 * Competitor Price Tracker - Historical price tracking and trend analysis
 *
 * Snapshots competitor prices, detects trends (rising/falling/stable/volatile),
 * and generates competitor reports with statistical analysis.
 */

import { createLogger } from '../utils/logger';
import { generateId } from '../utils/id';
import type { Database } from '../db/index';
import type {
  CompetitorPriceSnapshot,
  PriceTrend,
  TrendDirection,
  TrendAnalysis,
  CompetitorReport,
} from './types';

const logger = createLogger('competitor-tracker');

// =============================================================================
// SNAPSHOT MANAGEMENT
// =============================================================================

/**
 * Take a snapshot of current prices for the given products.
 *
 * Reads the latest prices from the `prices` table and copies them into
 * `price_snapshots` for historical tracking.
 */
export function snapshotCompetitorPrices(
  db: Database,
  products: Array<{ productId: string; platform?: string }>,
): CompetitorPriceSnapshot[] {
  const snapshots: CompetitorPriceSnapshot[] = [];

  for (const { productId, platform } of products) {
    try {
      const sql = platform
        ? `SELECT product_id, platform, price, seller, fetched_at
           FROM prices
           WHERE product_id = ? AND platform = ?
           ORDER BY fetched_at DESC LIMIT 1`
        : `SELECT product_id, platform, price, seller, fetched_at
           FROM prices
           WHERE product_id = ?
           ORDER BY fetched_at DESC LIMIT 10`;

      const params: unknown[] = platform ? [productId, platform] : [productId];
      const rows = db.query<Record<string, unknown>>(sql, params);

      for (const row of rows) {
        const price = row.price as number;
        if (!Number.isFinite(price) || price <= 0) continue;

        const snapshot: CompetitorPriceSnapshot = {
          id: generateId('snap'),
          productId: row.product_id as string,
          platform: row.platform as string,
          price,
          seller: (row.seller as string) ?? null,
          timestamp: Date.now(),
        };

        db.run(
          `INSERT INTO price_snapshots (id, product_id, platform, price, seller, timestamp)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            snapshot.id,
            snapshot.productId,
            snapshot.platform,
            snapshot.price,
            snapshot.seller,
            snapshot.timestamp,
          ],
        );

        snapshots.push(snapshot);
      }
    } catch (err) {
      logger.error({ productId, platform, err }, 'Failed to snapshot prices');
    }
  }

  logger.info({ snapshotCount: snapshots.length }, 'Price snapshots recorded');
  return snapshots;
}

// =============================================================================
// TREND ANALYSIS
// =============================================================================

/**
 * Get price history for a product over a given number of days.
 */
export function getPriceTrend(
  db: Database,
  productId: string,
  platform?: string,
  days = 30,
): PriceTrend | null {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const conditions: string[] = ['product_id = ?', 'timestamp >= ?'];
  const params: unknown[] = [productId, cutoff];

  if (platform) {
    conditions.push('platform = ?');
    params.push(platform);
  }

  const rows = db.query<Record<string, unknown>>(
    `SELECT price, timestamp, platform
     FROM price_snapshots
     WHERE ${conditions.join(' AND ')}
     ORDER BY timestamp ASC`,
    params,
  );

  if (rows.length === 0) return null;

  const dataPoints = rows.map((row) => ({
    price: row.price as number,
    timestamp: row.timestamp as number,
  }));

  const prices = dataPoints.map((dp) => dp.price).filter(Number.isFinite);
  if (prices.length === 0) return null;

  const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const stdDeviation = calculateStdDeviation(prices, avgPrice);
  const pctChange = calculatePctChange(prices);
  const trendDirection = detectDirection(prices, stdDeviation, avgPrice);

  return {
    productId,
    platform: platform ?? (rows[0].platform as string),
    dataPoints,
    avgPrice,
    minPrice,
    maxPrice,
    stdDeviation,
    trendDirection,
    pctChange,
    periodDays: days,
  };
}

/**
 * Analyze price trends for a product across all platforms.
 */
export function detectPriceTrends(db: Database, productId: string): TrendAnalysis {
  // Get all platforms for this product
  const platformRows = db.query<Record<string, unknown>>(
    'SELECT DISTINCT platform FROM price_snapshots WHERE product_id = ?',
    [productId],
  );

  const trends: PriceTrend[] = [];

  for (const row of platformRows) {
    const platform = row.platform as string;
    const trend = getPriceTrend(db, productId, platform, 30);
    if (trend) {
      trends.push(trend);
    }
  }

  // Determine overall direction from individual platform trends
  const directionCounts: Record<TrendDirection, number> = {
    rising: 0,
    falling: 0,
    stable: 0,
    volatile: 0,
  };

  for (const trend of trends) {
    directionCounts[trend.trendDirection]++;
  }

  let overallDirection: TrendDirection = 'stable';
  let maxCount = 0;
  for (const [dir, count] of Object.entries(directionCounts) as Array<[TrendDirection, number]>) {
    if (count > maxCount) {
      maxCount = count;
      overallDirection = dir;
    }
  }

  // Generate recommendation
  let recommendation: string;
  switch (overallDirection) {
    case 'falling':
      recommendation = 'Prices are declining. Consider waiting before sourcing, or reduce listing prices to remain competitive.';
      break;
    case 'rising':
      recommendation = 'Prices are increasing. Good time to list at current prices. Consider sourcing inventory before further increases.';
      break;
    case 'volatile':
      recommendation = 'Prices are volatile. Monitor closely and set tight alert thresholds. Avoid large inventory commitments.';
      break;
    case 'stable':
    default:
      recommendation = 'Prices are stable. Current pricing strategy is working. Focus on volume and fulfillment efficiency.';
      break;
  }

  return {
    productId,
    platform: null,
    trends,
    overallDirection,
    recommendation,
    analyzedAt: Date.now(),
  };
}

/**
 * Query competitor price history with filters.
 */
export function getCompetitorHistory(
  db: Database,
  options: {
    productId?: string;
    platform?: string;
    seller?: string;
    days?: number;
    limit?: number;
  } = {},
): CompetitorPriceSnapshot[] {
  const { productId, platform, seller, days = 30, limit = 500 } = options;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const conditions: string[] = ['timestamp >= ?'];
  const params: unknown[] = [cutoff];

  if (productId) {
    conditions.push('product_id = ?');
    params.push(productId);
  }
  if (platform) {
    conditions.push('platform = ?');
    params.push(platform);
  }
  if (seller) {
    conditions.push('seller = ?');
    params.push(seller);
  }

  const safeLimit = Math.max(1, Math.min(limit, 2000));
  params.push(safeLimit);

  const rows = db.query<Record<string, unknown>>(
    `SELECT id, product_id, platform, price, seller, timestamp
     FROM price_snapshots
     WHERE ${conditions.join(' AND ')}
     ORDER BY timestamp DESC
     LIMIT ?`,
    params,
  );

  return rows.map(parseSnapshotRow);
}

/**
 * Generate a competitor analysis report for a category.
 */
export function generateCompetitorReport(
  db: Database,
  options: { category: string; platform?: string; topN?: number },
): CompetitorReport {
  const { category, platform, topN = 10 } = options;

  // Get product IDs in this category
  const productRows = db.query<Record<string, unknown>>(
    'SELECT id FROM products WHERE category = ?',
    [category],
  );
  const productIds = productRows.map((row) => row.id as string);

  if (productIds.length === 0) {
    return {
      category,
      platform: platform ?? null,
      competitors: [],
      totalProducts: 0,
      avgCategoryPrice: 0,
      generatedAt: Date.now(),
    };
  }

  // Build query for price snapshots in the last 30 days
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const placeholders = productIds.map(() => '?').join(',');

  const conditions: string[] = [
    `product_id IN (${placeholders})`,
    'timestamp >= ?',
    'seller IS NOT NULL',
  ];
  const params: unknown[] = [...productIds, cutoff];

  if (platform) {
    conditions.push('platform = ?');
    params.push(platform);
  }

  const rows = db.query<Record<string, unknown>>(
    `SELECT
       seller,
       COUNT(DISTINCT product_id) AS product_count,
       AVG(price) AS avg_price,
       MIN(price) AS min_price,
       MAX(price) AS max_price
     FROM price_snapshots
     WHERE ${conditions.join(' AND ')}
     GROUP BY seller
     ORDER BY product_count DESC, avg_price ASC
     LIMIT ?`,
    [...params, Math.max(1, topN)],
  );

  const competitors = rows.map((row) => {
    const avgPrice = row.avg_price as number;
    const minPrice = row.min_price as number;
    const maxPrice = row.max_price as number;
    return {
      seller: row.seller as string,
      productCount: row.product_count as number,
      avgPrice: Number.isFinite(avgPrice) ? avgPrice : 0,
      minPrice: Number.isFinite(minPrice) ? minPrice : 0,
      maxPrice: Number.isFinite(maxPrice) ? maxPrice : 0,
      priceRange: Number.isFinite(maxPrice) && Number.isFinite(minPrice) ? maxPrice - minPrice : 0,
    };
  });

  // Calculate category average
  const allPrices = competitors.map((c) => c.avgPrice).filter(Number.isFinite);
  const avgCategoryPrice = allPrices.length > 0
    ? allPrices.reduce((sum, p) => sum + p, 0) / allPrices.length
    : 0;

  return {
    category,
    platform: platform ?? null,
    competitors,
    totalProducts: productIds.length,
    avgCategoryPrice,
    generatedAt: Date.now(),
  };
}

// =============================================================================
// STATISTICS HELPERS
// =============================================================================

function calculateStdDeviation(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((sum, d) => sum + d, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function calculatePctChange(prices: number[]): number {
  if (prices.length < 2) return 0;
  const first = prices[0];
  const last = prices[prices.length - 1];
  if (!Number.isFinite(first) || first === 0) return 0;
  return ((last - first) / first) * 100;
}

/**
 * Detect trend direction based on price movement and volatility.
 *
 * - rising: consistently increasing (>5% overall change, low relative std dev)
 * - falling: consistently decreasing (<-5% overall change, low relative std dev)
 * - volatile: high standard deviation relative to mean (coefficient of variation >15%)
 * - stable: otherwise
 */
function detectDirection(prices: number[], stdDev: number, mean: number): TrendDirection {
  if (prices.length < 2) return 'stable';

  const pctChange = calculatePctChange(prices);
  const coeffOfVariation = mean > 0 ? (stdDev / mean) * 100 : 0;

  // High volatility overrides directional signals
  if (coeffOfVariation > 15) return 'volatile';

  if (pctChange > 5) return 'rising';
  if (pctChange < -5) return 'falling';

  return 'stable';
}

// =============================================================================
// ROW PARSERS
// =============================================================================

function parseSnapshotRow(row: Record<string, unknown>): CompetitorPriceSnapshot {
  return {
    id: row.id as string,
    productId: row.product_id as string,
    platform: row.platform as string,
    price: row.price as number,
    seller: (row.seller as string) ?? null,
    timestamp: row.timestamp as number,
  };
}
