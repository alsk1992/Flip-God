/**
 * Demand Scoring Model - Score products by demand using multiple signals
 *
 * Combines sales velocity, price stability, competitor count, review sentiment,
 * search interest (scan frequency), and margin health into a weighted 0-100 score.
 * Results stored in demand_scores table for historical tracking and trend analysis.
 */

import { createLogger } from '../utils/logger.js';
import { generateId } from '../utils/id.js';
import type { Database } from '../db/index.js';

const logger = createLogger('demand-scoring');

// =============================================================================
// TYPES
// =============================================================================

export interface DemandSignals {
  salesVelocity: number;    // 0-100 (orders per day relative to category avg)
  priceStability: number;   // 0-100 (low volatility = high stability = good)
  competitorCount: number;  // 0-100 (fewer sellers = less competition = good)
  reviewSentiment: number;  // 0-100 (if available)
  searchInterest: number;   // 0-100 (based on how often it appears in scans)
  marginHealth: number;     // 0-100 (healthy margins = sustainable demand)
}

export type DemandRecommendation = 'high_demand' | 'moderate_demand' | 'low_demand' | 'avoid';

export interface DemandScore {
  productId: string;
  productName: string;
  overallScore: number; // 0-100
  signals: DemandSignals;
  recommendation: DemandRecommendation;
  confidence: number; // 0-1 based on data completeness
  insights: string[]; // Human-readable insights
  calculatedAt: number;
}

export interface DemandTrendPoint {
  date: string;    // ISO date (YYYY-MM-DD)
  score: number;
}

export type TrendDirection = 'improving' | 'declining' | 'stable';

export interface DemandTrend {
  productId: string;
  productName: string;
  points: DemandTrendPoint[];
  direction: TrendDirection;
  changePercent: number;
  periodDays: number;
}

export interface DemandScoreFilter {
  minScore?: number;
  maxScore?: number;
  recommendation?: DemandRecommendation;
  category?: string;
  limit?: number;
  offset?: number;
}

export interface CategoryDemandRanking {
  category: string;
  avgScore: number;
  productCount: number;
  topProduct: string | null;
}

// =============================================================================
// WEIGHTS
// =============================================================================

const WEIGHTS = {
  salesVelocity: 0.30,
  priceStability: 0.15,
  competitorCount: 0.20,
  reviewSentiment: 0.10,
  searchInterest: 0.10,
  marginHealth: 0.15,
} as const;

const SIGNAL_COUNT = Object.keys(WEIGHTS).length;
const CONFIDENCE_PER_SIGNAL = 1 / SIGNAL_COUNT;

// =============================================================================
// HELPERS
// =============================================================================

/** Safe division: returns fallback when denominator is zero or result is non-finite. */
function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  if (denominator === 0) return fallback;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : fallback;
}

/** Clamp a number to 0-100 range. */
function clamp100(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Round to 2 decimal places. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// =============================================================================
// SIGNAL CALCULATORS
// =============================================================================

/**
 * Sales velocity signal (weight 30%).
 *
 * Counts orders for this product in the last 30 days and compares to the
 * category average. A product with 3x the category average scores ~100.
 *
 * Returns { score, hasData, insight }.
 */
function calcSalesVelocity(
  db: Database,
  productId: string,
  category: string | null,
): { score: number; hasData: boolean; insight: string | null } {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  // Count orders for this product in the last 30 days
  const productRows = db.query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM orders o
     JOIN listings l ON l.id = o.listing_id
     WHERE l.product_id = ? AND o.ordered_at >= ?`,
    [productId, cutoff],
  );
  const productOrders = productRows[0]?.cnt ?? 0;

  if (productOrders === 0) {
    return { score: 0, hasData: false, insight: null };
  }

  const productVelocity = safeDiv(productOrders, 30); // orders per day

  // Category average velocity
  let categoryVelocity = 0;
  if (category) {
    const catRows = db.query<{ cnt: number; product_count: number }>(
      `SELECT COUNT(*) AS cnt,
              COUNT(DISTINCT l.product_id) AS product_count
       FROM orders o
       JOIN listings l ON l.id = o.listing_id
       JOIN products p ON p.id = l.product_id
       WHERE p.category = ? AND o.ordered_at >= ?`,
      [category, cutoff],
    );
    const totalCatOrders = catRows[0]?.cnt ?? 0;
    const catProductCount = catRows[0]?.product_count ?? 1;
    categoryVelocity = safeDiv(totalCatOrders, catProductCount * 30);
  }

  // Ratio: product velocity vs category average
  const ratio = categoryVelocity > 0
    ? safeDiv(productVelocity, categoryVelocity)
    : productVelocity > 0 ? 2.0 : 0; // If no category data, decent velocity = 2x

  // Map ratio to 0-100: 0x=0, 1x=50, 2x=80, 3x+=100
  let score: number;
  if (ratio <= 1) {
    score = ratio * 50;
  } else if (ratio <= 3) {
    score = 50 + ((ratio - 1) / 2) * 50;
  } else {
    score = 100;
  }

  const insight = categoryVelocity > 0
    ? `Sales velocity ${round2(ratio)}x category average (${round2(productVelocity)} orders/day vs ${round2(categoryVelocity)})`
    : `Sales velocity: ${round2(productVelocity)} orders/day (${productOrders} orders in 30 days)`;

  return { score: clamp100(score), hasData: true, insight };
}

/**
 * Price stability signal (weight 15%).
 *
 * Calculates the coefficient of variation (CV) of price snapshots.
 * Low CV = high stability = high score. CV of 0% = 100, CV of 30%+ = 0.
 */
function calcPriceStability(
  db: Database,
  productId: string,
): { score: number; hasData: boolean; insight: string | null } {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const rows = db.query<{ price: number }>(
    `SELECT price FROM price_snapshots
     WHERE product_id = ? AND timestamp >= ?
     ORDER BY timestamp ASC`,
    [productId, cutoff],
  );

  const prices = rows
    .map((r) => r.price)
    .filter((p) => Number.isFinite(p) && p > 0);

  if (prices.length < 2) {
    return { score: 50, hasData: false, insight: null }; // neutral default
  }

  const mean = prices.reduce((s, p) => s + p, 0) / prices.length;
  const variance = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / (prices.length - 1);
  const stdDev = Math.sqrt(variance);
  const cv = safeDiv(stdDev, mean) * 100; // Coefficient of variation in %

  // Map CV to score: 0% = 100, 10% = 67, 20% = 33, 30%+ = 0
  const score = clamp100(100 - (cv / 30) * 100);

  let insight: string;
  if (cv < 5) {
    insight = `Very stable pricing (CV ${round2(cv)}%) - reliable margin expectations`;
  } else if (cv < 15) {
    insight = `Moderate price fluctuation (CV ${round2(cv)}%) - watch for trend shifts`;
  } else {
    insight = `High price volatility (CV ${round2(cv)}%) - margin risk from price swings`;
  }

  return { score, hasData: true, insight };
}

/**
 * Competitor count signal (weight 20%).
 *
 * Counts distinct sellers in price_snapshots for this product.
 * Fewer sellers = less competition = higher score.
 * 1 seller = 100, 5 = 60, 10+ = 20.
 */
function calcCompetitorCount(
  db: Database,
  productId: string,
): { score: number; hasData: boolean; insight: string | null } {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

  const rows = db.query<{ cnt: number }>(
    `SELECT COUNT(DISTINCT seller) AS cnt
     FROM price_snapshots
     WHERE product_id = ? AND timestamp >= ? AND seller IS NOT NULL`,
    [productId, cutoff],
  );

  const sellerCount = rows[0]?.cnt ?? 0;

  if (sellerCount === 0) {
    return { score: 50, hasData: false, insight: null }; // neutral when no data
  }

  // Map seller count to score: 1=100, 2=90, 3=80, 5=60, 10=20, 15+=10
  let score: number;
  if (sellerCount <= 1) {
    score = 100;
  } else if (sellerCount <= 5) {
    // Linear from 90 to 60 for 2-5 sellers
    score = 90 - ((sellerCount - 2) / 3) * 30;
  } else if (sellerCount <= 10) {
    // Linear from 60 to 20 for 5-10 sellers
    score = 60 - ((sellerCount - 5) / 5) * 40;
  } else {
    // 10+ sellers: diminishing returns, floor at 10
    score = Math.max(10, 20 - (sellerCount - 10) * 2);
  }

  let insight: string;
  if (sellerCount <= 2) {
    insight = `Low competition - only ${sellerCount} seller(s) found`;
  } else if (sellerCount <= 5) {
    insight = `Moderate competition with ${sellerCount} sellers`;
  } else {
    insight = `High competition - ${sellerCount} sellers competing on price`;
  }

  return { score: clamp100(score), hasData: true, insight };
}

/**
 * Review sentiment signal (weight 10%).
 *
 * Uses product rating if available in the products table (via product_scores
 * or any rating column). Falls back to neutral 50 if no data.
 * 4.5+ = 100, 4.0 = 80, 3.0 = 50, 2.0 = 20, <2 = 0.
 */
function calcReviewSentiment(
  db: Database,
  productId: string,
): { score: number; hasData: boolean; insight: string | null } {
  // Check product_scores for existing scored data
  const scoreRows = db.query<{ demand_score: number | null }>(
    `SELECT demand_score FROM product_scores WHERE product_id = ? ORDER BY scored_at DESC LIMIT 1`,
    [productId],
  );

  // If we have a demand_score from the older product_scores table, use as proxy
  const existingScore = scoreRows[0]?.demand_score;
  if (existingScore != null && Number.isFinite(existingScore)) {
    // product_scores.demand_score is 0-100 already
    const score = clamp100(existingScore);
    return {
      score,
      hasData: true,
      insight: `Product quality score: ${round2(score)}/100 from prior analysis`,
    };
  }

  // No review data available
  return { score: 50, hasData: false, insight: null };
}

/**
 * Search interest signal (weight 10%).
 *
 * Based on scan_frequency table - how often this product appears across scans.
 * Normalizes against the maximum scan count in the database.
 */
function calcSearchInterest(
  db: Database,
  productId: string,
): { score: number; hasData: boolean; insight: string | null } {
  const rows = db.query<{ scan_count: number }>(
    `SELECT scan_count FROM scan_frequency WHERE product_id = ?`,
    [productId],
  );

  const scanCount = rows[0]?.scan_count ?? 0;

  if (scanCount === 0) {
    return { score: 0, hasData: false, insight: null };
  }

  // Get max scan count for normalization
  const maxRows = db.query<{ max_count: number }>(
    `SELECT MAX(scan_count) AS max_count FROM scan_frequency`,
  );
  const maxCount = maxRows[0]?.max_count ?? 1;

  // Normalize to 0-100 using square root scaling (diminishing returns for very high counts)
  const ratio = safeDiv(scanCount, maxCount);
  const score = clamp100(Math.sqrt(ratio) * 100);

  let insight: string;
  if (score >= 70) {
    insight = `High search interest - appeared in ${scanCount} scans (top product)`;
  } else if (score >= 30) {
    insight = `Moderate search interest - appeared in ${scanCount} scans`;
  } else {
    insight = `Low search interest - only ${scanCount} scan appearances`;
  }

  return { score, hasData: true, insight };
}

/**
 * Margin health signal (weight 15%).
 *
 * Looks at opportunities table for this product's margin data.
 * Products with consistent 20%+ margin score high.
 */
function calcMarginHealth(
  db: Database,
  productId: string,
): { score: number; hasData: boolean; insight: string | null } {
  const rows = db.query<{ margin_pct: number }>(
    `SELECT margin_pct FROM opportunities
     WHERE product_id = ? AND status IN ('active', 'listed', 'sold')
     ORDER BY found_at DESC LIMIT 20`,
    [productId],
  );

  const margins = rows
    .map((r) => r.margin_pct)
    .filter((m) => Number.isFinite(m));

  if (margins.length === 0) {
    return { score: 0, hasData: false, insight: null };
  }

  const avgMargin = margins.reduce((s, m) => s + m, 0) / margins.length;

  // Map margin to score: <5% = 10, 10% = 40, 15% = 60, 20% = 80, 30%+ = 100
  let score: number;
  if (avgMargin <= 5) {
    score = safeDiv(avgMargin, 5) * 20;
  } else if (avgMargin <= 20) {
    score = 20 + ((avgMargin - 5) / 15) * 60;
  } else if (avgMargin <= 35) {
    score = 80 + ((avgMargin - 20) / 15) * 20;
  } else {
    score = 100;
  }

  // Check margin consistency (lower std dev = bonus)
  if (margins.length >= 3) {
    const meanM = margins.reduce((s, m) => s + m, 0) / margins.length;
    const variance = margins.reduce((s, m) => s + (m - meanM) ** 2, 0) / (margins.length - 1);
    const stdDev = Math.sqrt(variance);
    const cv = safeDiv(stdDev, meanM) * 100;
    // Consistent margins (low CV) get up to +10 bonus
    if (cv < 20) {
      score = Math.min(100, score + 10);
    }
  }

  let insight: string;
  if (avgMargin >= 20) {
    insight = `Healthy margins averaging ${round2(avgMargin)}% across ${margins.length} opportunities`;
  } else if (avgMargin >= 10) {
    insight = `Moderate margins at ${round2(avgMargin)}% average - watch for fee changes`;
  } else {
    insight = `Thin margins (${round2(avgMargin)}% avg) - high risk of unprofitable trades`;
  }

  return { score: clamp100(score), hasData: true, insight };
}

// =============================================================================
// RECOMMENDATION & CONFIDENCE
// =============================================================================

function getRecommendation(overallScore: number): DemandRecommendation {
  if (overallScore >= 75) return 'high_demand';
  if (overallScore >= 50) return 'moderate_demand';
  if (overallScore >= 25) return 'low_demand';
  return 'avoid';
}

function calcConfidence(hasDataFlags: boolean[]): number {
  const signalsWithData = hasDataFlags.filter(Boolean).length;
  return round2(signalsWithData * CONFIDENCE_PER_SIGNAL);
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Calculate demand score for a single product.
 *
 * Combines six weighted signals into an overall 0-100 score with a
 * recommendation, confidence level, and human-readable insights.
 */
export function calculateDemandScore(db: Database, productId: string): DemandScore {
  // Fetch product info
  const productRows = db.query<{ title: string; category: string | null }>(
    `SELECT title, category FROM products WHERE id = ?`,
    [productId],
  );

  const product = productRows[0];
  if (!product) {
    logger.warn({ productId }, 'Product not found for demand scoring');
    return {
      productId,
      productName: 'Unknown Product',
      overallScore: 0,
      signals: {
        salesVelocity: 0,
        priceStability: 0,
        competitorCount: 0,
        reviewSentiment: 0,
        searchInterest: 0,
        marginHealth: 0,
      },
      recommendation: 'avoid',
      confidence: 0,
      insights: ['Product not found in database'],
      calculatedAt: Date.now(),
    };
  }

  const category = product.category ?? null;

  // Calculate each signal
  const velocity = calcSalesVelocity(db, productId, category);
  const stability = calcPriceStability(db, productId);
  const competition = calcCompetitorCount(db, productId);
  const sentiment = calcReviewSentiment(db, productId);
  const interest = calcSearchInterest(db, productId);
  const margin = calcMarginHealth(db, productId);

  const signals: DemandSignals = {
    salesVelocity: velocity.score,
    priceStability: stability.score,
    competitorCount: competition.score,
    reviewSentiment: sentiment.score,
    searchInterest: interest.score,
    marginHealth: margin.score,
  };

  // Weighted overall score
  const overallScore = clamp100(
    signals.salesVelocity * WEIGHTS.salesVelocity +
    signals.priceStability * WEIGHTS.priceStability +
    signals.competitorCount * WEIGHTS.competitorCount +
    signals.reviewSentiment * WEIGHTS.reviewSentiment +
    signals.searchInterest * WEIGHTS.searchInterest +
    signals.marginHealth * WEIGHTS.marginHealth,
  );

  const recommendation = getRecommendation(overallScore);

  const confidence = calcConfidence([
    velocity.hasData,
    stability.hasData,
    competition.hasData,
    sentiment.hasData,
    interest.hasData,
    margin.hasData,
  ]);

  // Collect insights (2-4 human-readable)
  const allInsights: string[] = [];
  if (velocity.insight) allInsights.push(velocity.insight);
  if (stability.insight) allInsights.push(stability.insight);
  if (competition.insight) allInsights.push(competition.insight);
  if (sentiment.insight) allInsights.push(sentiment.insight);
  if (interest.insight) allInsights.push(interest.insight);
  if (margin.insight) allInsights.push(margin.insight);

  // Sort by signal weight importance, pick top 4
  const insights = allInsights.slice(0, 4);

  if (insights.length === 0) {
    insights.push('Insufficient data to generate detailed insights');
  }

  if (confidence < 0.5) {
    insights.push(`Low confidence (${round2(confidence * 100)}%) - more data needed for reliable scoring`);
  }

  return {
    productId,
    productName: product.title,
    overallScore,
    signals,
    recommendation,
    confidence,
    insights,
    calculatedAt: Date.now(),
  };
}

/**
 * Batch score multiple products (or all products if no IDs given).
 *
 * Saves results to the demand_scores table and returns sorted by score descending.
 */
export function batchScoreDemand(
  db: Database,
  productIds?: string[],
): DemandScore[] {
  let ids: string[];

  if (productIds && productIds.length > 0) {
    ids = productIds;
  } else {
    const rows = db.query<{ id: string }>(
      `SELECT id FROM products ORDER BY updated_at DESC LIMIT 500`,
    );
    ids = rows.map((r) => r.id);
  }

  if (ids.length === 0) {
    logger.info('No products to score');
    return [];
  }

  logger.info({ count: ids.length }, 'Batch scoring products for demand');

  const scores: DemandScore[] = [];

  for (const id of ids) {
    try {
      const score = calculateDemandScore(db, id);
      scores.push(score);

      // Persist to demand_scores table
      const recordId = generateId('ds');
      db.run(
        `INSERT INTO demand_scores (id, product_id, overall_score, signals, recommendation, confidence, insights, calculated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          recordId,
          score.productId,
          score.overallScore,
          JSON.stringify(score.signals),
          score.recommendation,
          score.confidence,
          JSON.stringify(score.insights),
          score.calculatedAt,
        ],
      );
    } catch (err) {
      logger.error({ productId: id, err }, 'Failed to score product');
    }
  }

  // Sort by overall score descending
  scores.sort((a, b) => b.overallScore - a.overallScore);

  logger.info({ scored: scores.length }, 'Batch demand scoring complete');
  return scores;
}

/**
 * Query saved demand scores with optional filters.
 */
export function getDemandScores(
  db: Database,
  opts?: DemandScoreFilter,
): DemandScore[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.minScore != null && Number.isFinite(opts.minScore)) {
    conditions.push('ds.overall_score >= ?');
    params.push(opts.minScore);
  }
  if (opts?.maxScore != null && Number.isFinite(opts.maxScore)) {
    conditions.push('ds.overall_score <= ?');
    params.push(opts.maxScore);
  }
  if (opts?.recommendation) {
    conditions.push('ds.recommendation = ?');
    params.push(opts.recommendation);
  }
  if (opts?.category) {
    conditions.push('p.category = ?');
    params.push(opts.category);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const limit = Math.max(1, Math.min(opts?.limit ?? 100, 1000));
  const offset = Math.max(0, opts?.offset ?? 0);

  // Get the latest score per product
  const rows = db.query<{
    product_id: string;
    title: string;
    overall_score: number;
    signals: string;
    recommendation: string;
    confidence: number;
    insights: string;
    calculated_at: number;
  }>(
    `SELECT ds.product_id, p.title, ds.overall_score, ds.signals,
            ds.recommendation, ds.confidence, ds.insights, ds.calculated_at
     FROM demand_scores ds
     JOIN products p ON p.id = ds.product_id
     INNER JOIN (
       SELECT product_id, MAX(calculated_at) AS max_at
       FROM demand_scores
       GROUP BY product_id
     ) latest ON ds.product_id = latest.product_id AND ds.calculated_at = latest.max_at
     ${whereClause}
     ORDER BY ds.overall_score DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows.map(parseScoreRow);
}

/**
 * Convenience: get top N products by demand score.
 */
export function getTopDemandProducts(
  db: Database,
  limit = 20,
  category?: string,
): DemandScore[] {
  return getDemandScores(db, {
    limit: Math.max(1, Math.min(limit, 200)),
    category,
  });
}

/**
 * Demand trend for a product over time.
 *
 * Returns historical demand score snapshots and the overall trend direction.
 */
export function getDemandTrends(
  db: Database,
  productId: string,
  days = 30,
): DemandTrend {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  // Get product name
  const productRows = db.query<{ title: string }>(
    `SELECT title FROM products WHERE id = ?`,
    [productId],
  );
  const productName = productRows[0]?.title ?? 'Unknown Product';

  // Get historical scores
  const rows = db.query<{ overall_score: number; calculated_at: number }>(
    `SELECT overall_score, calculated_at
     FROM demand_scores
     WHERE product_id = ? AND calculated_at >= ?
     ORDER BY calculated_at ASC`,
    [productId, cutoff],
  );

  if (rows.length === 0) {
    return {
      productId,
      productName,
      points: [],
      direction: 'stable',
      changePercent: 0,
      periodDays: days,
    };
  }

  // Group by date (keep latest score per day)
  const byDate = new Map<string, number>();
  for (const row of rows) {
    const date = new Date(row.calculated_at).toISOString().slice(0, 10);
    byDate.set(date, row.overall_score); // last write per day wins
  }

  const points: DemandTrendPoint[] = [];
  for (const [date, score] of Array.from(byDate.entries())) {
    points.push({ date, score });
  }
  points.sort((a, b) => a.date.localeCompare(b.date));

  // Calculate trend direction
  let direction: TrendDirection = 'stable';
  let changePercent = 0;

  if (points.length >= 2) {
    const firstScore = points[0].score;
    const lastScore = points[points.length - 1].score;
    changePercent = round2(safeDiv(lastScore - firstScore, Math.max(firstScore, 1)) * 100);

    if (changePercent > 10) {
      direction = 'improving';
    } else if (changePercent < -10) {
      direction = 'declining';
    } else {
      direction = 'stable';
    }
  }

  return {
    productId,
    productName,
    points,
    direction,
    changePercent,
    periodDays: days,
  };
}

/**
 * Track that a product appeared in a scan (increments scan_frequency).
 *
 * Uses upsert pattern: insert if new, update count if exists.
 */
export function trackScanAppearance(db: Database, productId: string): void {
  const now = Date.now();

  try {
    // Check if already exists
    const existing = db.query<{ id: string; scan_count: number }>(
      `SELECT id, scan_count FROM scan_frequency WHERE product_id = ?`,
      [productId],
    );

    if (existing.length > 0) {
      // Update existing
      db.run(
        `UPDATE scan_frequency
         SET scan_count = scan_count + 1, last_seen_at = ?
         WHERE product_id = ?`,
        [now, productId],
      );
    } else {
      // Insert new
      const id = generateId('sf');
      db.run(
        `INSERT INTO scan_frequency (id, product_id, scan_count, last_seen_at, first_seen_at)
         VALUES (?, ?, 1, ?, ?)`,
        [id, productId, now, now],
      );
    }
  } catch (err) {
    logger.error({ productId, err }, 'Failed to track scan appearance');
  }
}

/**
 * Category demand ranking: which categories have the highest average demand?
 *
 * Uses the latest demand score per product, grouped by category.
 */
export function getCategoryDemandRanking(db: Database): CategoryDemandRanking[] {
  const rows = db.query<{
    category: string;
    avg_score: number;
    product_count: number;
    top_product: string | null;
  }>(
    `SELECT
       p.category,
       AVG(ds.overall_score) AS avg_score,
       COUNT(DISTINCT ds.product_id) AS product_count,
       (
         SELECT ds2.product_id
         FROM demand_scores ds2
         JOIN products p2 ON p2.id = ds2.product_id
         WHERE p2.category = p.category
         ORDER BY ds2.overall_score DESC, ds2.calculated_at DESC
         LIMIT 1
       ) AS top_product
     FROM demand_scores ds
     JOIN products p ON p.id = ds.product_id
     INNER JOIN (
       SELECT product_id, MAX(calculated_at) AS max_at
       FROM demand_scores
       GROUP BY product_id
     ) latest ON ds.product_id = latest.product_id AND ds.calculated_at = latest.max_at
     WHERE p.category IS NOT NULL
     GROUP BY p.category
     ORDER BY avg_score DESC`,
  );

  return rows.map((r) => ({
    category: r.category,
    avgScore: round2(r.avg_score),
    productCount: r.product_count,
    topProduct: r.top_product,
  }));
}

// =============================================================================
// ROW PARSERS
// =============================================================================

function parseScoreRow(row: {
  product_id: string;
  title: string;
  overall_score: number;
  signals: string;
  recommendation: string;
  confidence: number;
  insights: string;
  calculated_at: number;
}): DemandScore {
  let signals: DemandSignals;
  try {
    signals = JSON.parse(row.signals) as DemandSignals;
  } catch {
    signals = {
      salesVelocity: 0,
      priceStability: 0,
      competitorCount: 0,
      reviewSentiment: 0,
      searchInterest: 0,
      marginHealth: 0,
    };
  }

  let insights: string[];
  try {
    insights = JSON.parse(row.insights) as string[];
  } catch {
    insights = [];
  }

  return {
    productId: row.product_id,
    productName: row.title,
    overallScore: row.overall_score,
    signals,
    recommendation: row.recommendation as DemandRecommendation,
    confidence: row.confidence,
    insights,
    calculatedAt: row.calculated_at,
  };
}
