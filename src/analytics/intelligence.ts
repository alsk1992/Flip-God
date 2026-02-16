/**
 * Competitive Intelligence Dashboard
 *
 * Extends the existing competitor-tracker with deeper analysis:
 * price chart data, stockout prediction, market share estimation,
 * pricing strategy classification, competitor alerts, and market overview.
 */

import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import type {
  CompetitorPriceChart,
  PriceChartPoint,
  StockoutPrediction,
  MarketShareEstimate,
  PricingStrategy,
  PricingStrategyAnalysis,
  AlertType,
  CompetitorAlert,
  MarketOverview,
} from './intelligence-types.js';

const logger = createLogger('analytics-intelligence');

// =============================================================================
// HELPERS
// =============================================================================

const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

function stdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const squaredDiffs = values.map((v) => (v - mean) ** 2);
  const variance = squaredDiffs.reduce((s, d) => s + d, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// =============================================================================
// getCompetitorPriceCharts
// =============================================================================

/**
 * Get historical price data for a product, grouped by seller, for charting.
 */
export function getCompetitorPriceCharts(
  db: Database,
  productId: string,
  days = 30,
  platform?: string,
): CompetitorPriceChart {
  const safeDays = Math.max(1, Math.min(days, 365));
  const cutoff = Date.now() - safeDays * MS_PER_DAY;

  const conditions: string[] = ['product_id = ?', 'timestamp >= ?'];
  const params: unknown[] = [productId, cutoff];

  if (platform) {
    conditions.push('platform = ?');
    params.push(platform);
  }

  const rows = db.query<Record<string, unknown>>(
    `SELECT price, timestamp, seller, platform
     FROM price_snapshots
     WHERE ${conditions.join(' AND ')}
     ORDER BY timestamp ASC`,
    params,
  );

  // Group by seller
  const sellerMap = new Map<string, PriceChartPoint[]>();

  for (const row of rows) {
    const seller = (row.seller as string) ?? 'Unknown';
    const price = Number(row.price);
    if (!Number.isFinite(price) || price <= 0) continue;

    const point: PriceChartPoint = {
      timestamp: Number(row.timestamp),
      date: new Date(Number(row.timestamp)).toISOString(),
      price,
      seller,
    };

    if (!sellerMap.has(seller)) {
      sellerMap.set(seller, []);
    }
    sellerMap.get(seller)!.push(point);
  }

  const allPrices: number[] = [];
  const series = Array.from(sellerMap.entries()).map(([seller, points]) => {
    const prices = points.map((p) => p.price);
    allPrices.push(...prices);

    const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const current = points.length > 0 ? points[points.length - 1].price : null;

    return {
      seller,
      dataPoints: points,
      avgPrice: round2(avg),
      minPrice: round2(min),
      maxPrice: round2(max),
      currentPrice: current != null ? round2(current) : null,
    };
  });

  const overallAvg = allPrices.length > 0
    ? allPrices.reduce((s, p) => s + p, 0) / allPrices.length
    : 0;
  const priceSpread = allPrices.length > 0
    ? Math.max(...allPrices) - Math.min(...allPrices)
    : 0;

  return {
    productId,
    platform: platform ?? null,
    days: safeDays,
    series,
    overallAvgPrice: round2(overallAvg),
    priceSpread: round2(priceSpread),
  };
}

// =============================================================================
// predictStockout
// =============================================================================

/**
 * Estimate when a competitor might sell out based on price/velocity trends.
 *
 * This uses observable signals (price increases, listing disappearances)
 * as proxies since we cannot see actual inventory levels.
 */
export function predictStockout(
  db: Database,
  productId: string,
  platform?: string,
): StockoutPrediction[] {
  const cutoff = Date.now() - 30 * MS_PER_DAY;

  const conditions: string[] = ['product_id = ?', 'timestamp >= ?', 'seller IS NOT NULL'];
  const params: unknown[] = [productId, cutoff];

  if (platform) {
    conditions.push('platform = ?');
    params.push(platform);
  }

  // Get price snapshots grouped by seller
  const rows = db.query<Record<string, unknown>>(
    `SELECT seller, platform, price, timestamp
     FROM price_snapshots
     WHERE ${conditions.join(' AND ')}
     ORDER BY seller, timestamp ASC`,
    params,
  );

  const sellerData = new Map<string, Array<{ price: number; timestamp: number; platform: string }>>();

  for (const row of rows) {
    const seller = row.seller as string;
    if (!sellerData.has(seller)) sellerData.set(seller, []);
    sellerData.get(seller)!.push({
      price: Number(row.price),
      timestamp: Number(row.timestamp),
      platform: row.platform as string,
    });
  }

  const predictions: StockoutPrediction[] = [];

  for (const [seller, snapshots] of sellerData.entries()) {
    if (snapshots.length < 3) continue;

    const prices = snapshots.map((s) => s.price).filter(Number.isFinite);
    if (prices.length < 3) continue;

    const firstHalf = prices.slice(0, Math.floor(prices.length / 2));
    const secondHalf = prices.slice(Math.floor(prices.length / 2));

    const avgFirst = firstHalf.reduce((s, p) => s + p, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, p) => s + p, 0) / secondHalf.length;

    // Price trajectory
    const pricePctChange = safeDiv(avgSecond - avgFirst, avgFirst) * 100;
    let priceTrajectory: 'rising' | 'falling' | 'stable';
    if (pricePctChange > 5) priceTrajectory = 'rising';
    else if (pricePctChange < -5) priceTrajectory = 'falling';
    else priceTrajectory = 'stable';

    // Check for snapshot frequency as velocity proxy
    const timeSpan = (snapshots[snapshots.length - 1].timestamp - snapshots[0].timestamp) / MS_PER_DAY;
    const snapshotsPerDay = safeDiv(snapshots.length, timeSpan);

    // Heuristic: rising prices + decreasing snapshot frequency suggests approaching stockout
    let estimatedDays: number | null = null;
    let confidence = 0;
    let reasoning: string;

    if (priceTrajectory === 'rising' && pricePctChange > 15) {
      // Aggressively rising prices suggest stock running low
      estimatedDays = Math.round(safeDiv(30, pricePctChange) * 10);
      confidence = Math.min(0.6, pricePctChange / 50);
      reasoning = `Price increased ${round2(pricePctChange)}% over 30 days, suggesting diminishing supply.`;
    } else if (priceTrajectory === 'rising') {
      estimatedDays = null;
      confidence = 0.2;
      reasoning = `Modest price increase of ${round2(pricePctChange)}%. Stockout unlikely in near term.`;
    } else {
      estimatedDays = null;
      confidence = 0.1;
      reasoning = `Stable/falling prices suggest adequate supply.`;
    }

    predictions.push({
      productId,
      platform: snapshots[0].platform,
      seller,
      estimatedDaysUntilStockout: estimatedDays,
      confidence: round2(confidence),
      currentVelocity: round2(snapshotsPerDay),
      priceTrajectory,
      reasoning,
    });
  }

  return predictions;
}

// =============================================================================
// estimateMarketShare
// =============================================================================

/**
 * Estimate market share in a category based on visible listing counts.
 */
export function estimateMarketShare(
  db: Database,
  category: string,
  platform?: string,
): MarketShareEstimate {
  const conditions: string[] = ['p.category = ?'];
  const params: unknown[] = [category];

  if (platform) {
    conditions.push('ps.platform = ?');
    params.push(platform);
  }

  // Get recent snapshots (last 7 days) grouped by seller
  const cutoff = Date.now() - 7 * MS_PER_DAY;
  conditions.push('ps.timestamp >= ?');
  params.push(cutoff);

  const rows = db.query<Record<string, unknown>>(
    `SELECT
       ps.seller,
       COUNT(DISTINCT ps.product_id) AS listing_count,
       AVG(ps.price) AS avg_price
     FROM price_snapshots ps
     JOIN products p ON ps.product_id = p.id
     WHERE ${conditions.join(' AND ')}
       AND ps.seller IS NOT NULL
     GROUP BY ps.seller
     ORDER BY listing_count DESC`,
    params,
  );

  const totalListings = rows.reduce((s, r) => s + (Number(r.listing_count) || 0), 0);
  const allAvgPrices = rows.map((r) => Number(r.avg_price)).filter(Number.isFinite);
  const overallAvg = allAvgPrices.length > 0
    ? allAvgPrices.reduce((s, p) => s + p, 0) / allAvgPrices.length
    : 0;

  const sellerShares = rows.map((row) => {
    const listingCount = Number(row.listing_count) || 0;
    const avgPrice = Number(row.avg_price) || 0;
    const sharePct = safeDiv(listingCount, totalListings) * 100;

    let pricePosition: 'below_avg' | 'at_avg' | 'above_avg';
    if (overallAvg === 0) pricePosition = 'at_avg';
    else if (avgPrice < overallAvg * 0.95) pricePosition = 'below_avg';
    else if (avgPrice > overallAvg * 1.05) pricePosition = 'above_avg';
    else pricePosition = 'at_avg';

    return {
      seller: (row.seller as string) ?? 'Unknown',
      listingCount,
      estimatedSharePct: round2(sharePct),
      avgPrice: round2(avgPrice),
      pricePosition,
    };
  });

  const allPrices = rows.map((r) => Number(r.avg_price)).filter(Number.isFinite);
  const priceSpread = allPrices.length > 0
    ? Math.max(...allPrices) - Math.min(...allPrices)
    : 0;

  return {
    category,
    platform: platform ?? null,
    totalSellers: rows.length,
    totalListings,
    avgPrice: round2(overallAvg),
    priceSpread: round2(priceSpread),
    sellerShares,
  };
}

// =============================================================================
// classifyPricingStrategy
// =============================================================================

/**
 * Detect pricing strategy for each seller of a product.
 */
export function classifyPricingStrategy(
  db: Database,
  productId: string,
  platform?: string,
): PricingStrategyAnalysis {
  const cutoff = Date.now() - 30 * MS_PER_DAY;

  const conditions: string[] = ['product_id = ?', 'timestamp >= ?', 'seller IS NOT NULL'];
  const params: unknown[] = [productId, cutoff];

  if (platform) {
    conditions.push('platform = ?');
    params.push(platform);
  }

  // Get market average
  const avgRows = db.query<Record<string, unknown>>(
    `SELECT AVG(price) AS avg_price FROM price_snapshots
     WHERE ${conditions.join(' AND ')}`,
    params,
  );
  const marketAvg = Number(avgRows[0]?.avg_price) || 0;

  // Get per-seller stats
  const sellerRows = db.query<Record<string, unknown>>(
    `SELECT
       seller,
       AVG(price) AS avg_price,
       MIN(price) AS min_price,
       MAX(price) AS max_price,
       COUNT(*) AS snapshot_count
     FROM price_snapshots
     WHERE ${conditions.join(' AND ')}
     GROUP BY seller
     ORDER BY avg_price ASC`,
    params,
  );

  const strategies = sellerRows.map((row) => {
    const seller = row.seller as string;
    const avgPrice = Number(row.avg_price) || 0;
    const minPrice = Number(row.min_price) || 0;
    const maxPrice = Number(row.max_price) || 0;
    const snapshotCount = Number(row.snapshot_count) || 0;

    const priceVsMarket = marketAvg > 0 ? ((avgPrice - marketAvg) / marketAvg) * 100 : 0;
    const priceRange = maxPrice - minPrice;
    const volatility = avgPrice > 0 ? (priceRange / avgPrice) * 100 : 0;

    // Classification logic
    let strategy: PricingStrategy;
    let confidence: number;
    let reasoning: string;

    if (priceVsMarket < -15 && volatility < 10) {
      strategy = 'penetration';
      confidence = Math.min(0.8, Math.abs(priceVsMarket) / 30);
      reasoning = `Consistently ${round2(Math.abs(priceVsMarket))}% below market average with low volatility. Likely using penetration pricing to gain market share.`;
    } else if (priceVsMarket < -15 && volatility >= 10) {
      strategy = 'loss_leader';
      confidence = 0.5;
      reasoning = `Significantly below market (${round2(Math.abs(priceVsMarket))}%) with variable pricing. May be a loss-leader strategy or aggressive promotions.`;
    } else if (priceVsMarket > 15 && volatility < 10) {
      strategy = 'skimming';
      confidence = Math.min(0.7, priceVsMarket / 30);
      reasoning = `Consistently ${round2(priceVsMarket)}% above market average. Likely price skimming, relying on brand/quality perception.`;
    } else if (Math.abs(priceVsMarket) <= 5 && volatility < 10) {
      strategy = 'competitive';
      confidence = 0.7;
      reasoning = `Within 5% of market average with low volatility. Classic competitive/market-matching pricing.`;
    } else if (volatility < 5 && snapshotCount >= 5) {
      strategy = 'cost_plus';
      confidence = 0.5;
      reasoning = `Very stable pricing (${round2(volatility)}% volatility). Consistent with cost-plus pricing model.`;
    } else {
      strategy = 'unknown';
      confidence = 0.3;
      reasoning = `Mixed signals: ${round2(priceVsMarket)}% vs market, ${round2(volatility)}% volatility. No clear dominant strategy detected.`;
    }

    return {
      seller,
      strategy,
      confidence: round2(confidence),
      reasoning,
      avgPrice: round2(avgPrice),
      priceVsMarket: round2(priceVsMarket),
      priceVolatility: round2(volatility),
    };
  });

  return {
    productId,
    platform: platform ?? null,
    strategies,
  };
}

// =============================================================================
// getCompetitorAlerts
// =============================================================================

/**
 * Detect significant competitor changes (new entrants, price wars, etc.).
 */
export function getCompetitorAlerts(
  db: Database,
  options: { category?: string; platform?: string; days?: number } = {},
): CompetitorAlert[] {
  const { category, platform, days = 7 } = options;
  const safeDays = Math.max(1, Math.min(days, 90));
  const recentCutoff = Date.now() - safeDays * MS_PER_DAY;
  const priorCutoff = recentCutoff - safeDays * MS_PER_DAY;

  const alerts: CompetitorAlert[] = [];

  // Build base conditions for snapshot queries
  const baseConditions: string[] = ['ps.seller IS NOT NULL'];
  const baseParams: unknown[] = [];

  if (platform) {
    baseConditions.push('ps.platform = ?');
    baseParams.push(platform);
  }

  const productJoin = category
    ? 'JOIN products p ON ps.product_id = p.id'
    : '';
  if (category) {
    baseConditions.push('p.category = ?');
    baseParams.push(category);
  }

  // 1. New entrants: sellers in recent period but not in prior period
  try {
    const recentSellers = db.query<Record<string, unknown>>(
      `SELECT DISTINCT ps.seller
       FROM price_snapshots ps ${productJoin}
       WHERE ${baseConditions.join(' AND ')}
         AND ps.timestamp >= ?`,
      [...baseParams, recentCutoff],
    );

    const priorSellers = new Set(
      db.query<Record<string, unknown>>(
        `SELECT DISTINCT ps.seller
         FROM price_snapshots ps ${productJoin}
         WHERE ${baseConditions.join(' AND ')}
           AND ps.timestamp >= ? AND ps.timestamp < ?`,
        [...baseParams, priorCutoff, recentCutoff],
      ).map((r) => r.seller as string),
    );

    for (const row of recentSellers) {
      const seller = row.seller as string;
      if (!priorSellers.has(seller) && priorSellers.size > 0) {
        alerts.push({
          type: 'new_entrant',
          severity: 'medium',
          message: `New seller "${seller}" entered the market in the last ${safeDays} days.`,
          productId: null,
          category: category ?? null,
          platform: platform ?? null,
          seller,
          detectedAt: Date.now(),
          data: {},
        });
      }
    }
  } catch (err) {
    logger.debug({ err }, 'Error detecting new entrants');
  }

  // 2. Price wars: detect significant price drops (>15%) from any seller
  try {
    const priceDropRows = db.query<Record<string, unknown>>(
      `SELECT
         ps.seller,
         ps.product_id,
         ps.platform,
         MIN(ps.price) AS recent_min,
         (SELECT AVG(ps2.price)
          FROM price_snapshots ps2
          WHERE ps2.seller = ps.seller
            AND ps2.product_id = ps.product_id
            AND ps2.timestamp >= ? AND ps2.timestamp < ?) AS prior_avg
       FROM price_snapshots ps ${productJoin}
       WHERE ${baseConditions.join(' AND ')}
         AND ps.timestamp >= ?
       GROUP BY ps.seller, ps.product_id`,
      [...baseParams, priorCutoff, recentCutoff, ...baseParams.length > 0 ? [] : [], recentCutoff],
    );

    for (const row of priceDropRows) {
      const recentMin = Number(row.recent_min);
      const priorAvg = Number(row.prior_avg);
      if (!Number.isFinite(recentMin) || !Number.isFinite(priorAvg) || priorAvg <= 0) continue;

      const dropPct = ((priorAvg - recentMin) / priorAvg) * 100;
      if (dropPct > 15) {
        alerts.push({
          type: 'price_war',
          severity: dropPct > 30 ? 'high' : 'medium',
          message: `Seller "${row.seller}" dropped price by ${round2(dropPct)}% on product ${row.product_id}.`,
          productId: row.product_id as string,
          category: category ?? null,
          platform: (row.platform as string) ?? platform ?? null,
          seller: row.seller as string,
          detectedAt: Date.now(),
          data: {
            priorAvgPrice: round2(priorAvg),
            recentMinPrice: round2(recentMin),
            dropPct: round2(dropPct),
          },
        });
      }
    }
  } catch (err) {
    logger.debug({ err }, 'Error detecting price wars');
  }

  // 3. Price undercutting: sellers pricing below our listings
  try {
    const undercutRows = db.query<Record<string, unknown>>(
      `SELECT
         ps.seller,
         ps.product_id,
         ps.price AS competitor_price,
         l.price AS our_price,
         l.platform
       FROM price_snapshots ps
       JOIN listings l ON ps.product_id = l.product_id AND ps.platform = l.platform
       ${category ? 'JOIN products p ON ps.product_id = p.id' : ''}
       WHERE l.status = 'active'
         AND ps.timestamp >= ?
         AND ps.price < l.price * 0.95
         ${platform ? 'AND ps.platform = ?' : ''}
         ${category ? 'AND p.category = ?' : ''}
         AND ps.seller IS NOT NULL
       ORDER BY (l.price - ps.price) DESC
       LIMIT 20`,
      [
        recentCutoff,
        ...(platform ? [platform] : []),
        ...(category ? [category] : []),
      ],
    );

    for (const row of undercutRows) {
      const competitorPrice = Number(row.competitor_price);
      const ourPrice = Number(row.our_price);
      if (!Number.isFinite(competitorPrice) || !Number.isFinite(ourPrice) || ourPrice <= 0) continue;

      const undercutPct = ((ourPrice - competitorPrice) / ourPrice) * 100;

      alerts.push({
        type: 'price_undercut',
        severity: undercutPct > 20 ? 'high' : undercutPct > 10 ? 'medium' : 'low',
        message: `Seller "${row.seller}" is undercutting your price by ${round2(undercutPct)}% on product ${row.product_id}.`,
        productId: row.product_id as string,
        category: category ?? null,
        platform: (row.platform as string) ?? platform ?? null,
        seller: row.seller as string,
        detectedAt: Date.now(),
        data: {
          ourPrice: round2(ourPrice),
          competitorPrice: round2(competitorPrice),
          undercutPct: round2(undercutPct),
        },
      });
    }
  } catch (err) {
    logger.debug({ err }, 'Error detecting price undercutting');
  }

  // Sort by severity: high > medium > low
  const severityOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
  alerts.sort((a, b) => (severityOrder[b.severity] ?? 0) - (severityOrder[a.severity] ?? 0));

  return alerts;
}

// =============================================================================
// getMarketOverview
// =============================================================================

/**
 * Market overview for a category: seller count, avg price, spread, density.
 */
export function getMarketOverview(
  db: Database,
  category: string,
  platform?: string,
): MarketOverview {
  const cutoff7d = Date.now() - 7 * MS_PER_DAY;
  const cutoff14d = Date.now() - 14 * MS_PER_DAY;

  const conditions: string[] = ['p.category = ?', 'ps.timestamp >= ?'];
  const params: unknown[] = [category, cutoff7d];

  if (platform) {
    conditions.push('ps.platform = ?');
    params.push(platform);
  }

  // Current stats
  const statsRows = db.query<Record<string, unknown>>(
    `SELECT
       COUNT(DISTINCT ps.seller) AS seller_count,
       COUNT(DISTINCT ps.product_id) AS listing_count,
       AVG(ps.price) AS avg_price,
       MIN(ps.price) AS min_price,
       MAX(ps.price) AS max_price
     FROM price_snapshots ps
     JOIN products p ON ps.product_id = p.id
     WHERE ${conditions.join(' AND ')}
       AND ps.seller IS NOT NULL`,
    params,
  );

  const stats = statsRows[0] ?? {};
  const sellerCount = Number(stats.seller_count) || 0;
  const listingCount = Number(stats.listing_count) || 0;
  const avgPrice = Number(stats.avg_price) || 0;
  const minPrice = Number(stats.min_price) || 0;
  const maxPrice = Number(stats.max_price) || 0;
  const priceSpread = maxPrice - minPrice;

  // Get all prices for std dev and median
  const priceRows = db.query<Record<string, unknown>>(
    `SELECT ps.price
     FROM price_snapshots ps
     JOIN products p ON ps.product_id = p.id
     WHERE ${conditions.join(' AND ')}
       AND ps.seller IS NOT NULL`,
    params,
  );

  const allPrices = priceRows.map((r) => Number(r.price)).filter(Number.isFinite);
  const medianPrice = computeMedian(allPrices);
  const priceStdDev = stdDev(allPrices, avgPrice);

  // Recent activity: new listings in last 7 days vs prior 7 days
  const priorConditions: string[] = ['p.category = ?', 'ps.timestamp >= ?', 'ps.timestamp < ?'];
  const priorParams: unknown[] = [category, cutoff14d, cutoff7d];
  if (platform) {
    priorConditions.push('ps.platform = ?');
    priorParams.push(platform);
  }

  const newListings7d = db.query<Record<string, unknown>>(
    `SELECT COUNT(DISTINCT ps.product_id || '|' || ps.seller) AS cnt
     FROM price_snapshots ps
     JOIN products p ON ps.product_id = p.id
     WHERE ${conditions.join(' AND ')}
       AND ps.seller IS NOT NULL`,
    params,
  );

  const priorListings = db.query<Record<string, unknown>>(
    `SELECT COUNT(DISTINCT ps.product_id || '|' || ps.seller) AS cnt
     FROM price_snapshots ps
     JOIN products p ON ps.product_id = p.id
     WHERE ${priorConditions.join(' AND ')}
       AND ps.seller IS NOT NULL`,
    priorParams,
  );

  const recentListingCount = Number(newListings7d[0]?.cnt) || 0;
  const priorListingCount = Number(priorListings[0]?.cnt) || 0;

  // Price changes: count significant price changes (>2%) in last 7 days
  const priceChangeRows = db.query<Record<string, unknown>>(
    `SELECT COUNT(*) AS cnt
     FROM price_snapshots ps1
     JOIN price_snapshots ps2 ON ps1.product_id = ps2.product_id
       AND ps1.seller = ps2.seller
       AND ps1.platform = ps2.platform
     JOIN products p ON ps1.product_id = p.id
     WHERE p.category = ?
       AND ps1.timestamp >= ?
       AND ps2.timestamp >= ? AND ps2.timestamp < ps1.timestamp
       AND ABS(ps1.price - ps2.price) / ps2.price > 0.02
       ${platform ? 'AND ps1.platform = ?' : ''}`,
    [category, cutoff7d, cutoff14d, ...(platform ? [platform] : [])],
  );
  const priceChanges7d = Number(priceChangeRows[0]?.cnt) || 0;

  // Avg price change
  const avgPriceChange = priorListingCount > 0
    ? safeDiv(recentListingCount - priorListingCount, priorListingCount) * 100
    : 0;

  return {
    category,
    platform: platform ?? null,
    sellerCount,
    listingCount,
    avgPrice: round2(avgPrice),
    medianPrice: round2(medianPrice),
    priceSpread: round2(priceSpread),
    priceStdDev: round2(priceStdDev),
    listingDensity: round2(safeDiv(listingCount, sellerCount)),
    recentActivity: {
      newListings7d: recentListingCount,
      priceChanges7d,
      avgPriceChange7dPct: round2(avgPriceChange),
    },
    generatedAt: Date.now(),
  };
}
