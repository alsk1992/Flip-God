/**
 * A/B Price Testing Module
 *
 * Set up split-traffic price tests for listings to determine which price
 * produces better conversion rates and revenue. Includes statistical
 * significance testing via chi-squared approximation.
 */

import { createLogger } from '../utils/logger.js';
import { generateId } from '../utils/id.js';
import type { Database } from '../db/index.js';
import type {
  PriceTest,
  CreatePriceTestParams,
  PriceTestResults,
  TestVariant,
  TestStatus,
  TestWinner,
} from './types.js';

const logger = createLogger('ab-testing');

// =============================================================================
// HELPERS
// =============================================================================

/** Round to 2 decimal places */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Chi-squared test approximation for 2x2 contingency table.
 *
 * Tests whether the conversion rates of two variants are significantly
 * different. Returns the chi-squared statistic.
 *
 *   |         | Converted | Not Converted | Total |
 *   | A       | salesA    | viewsA-salesA | viewsA|
 *   | B       | salesB    | viewsB-salesB | viewsB|
 */
function chiSquared2x2(
  salesA: number,
  viewsA: number,
  salesB: number,
  viewsB: number,
): number {
  const totalViews = viewsA + viewsB;
  const totalSales = salesA + salesB;
  const totalNoSales = totalViews - totalSales;

  if (totalViews === 0 || totalSales === 0 || totalNoSales === 0) {
    return 0;
  }

  // Expected values
  const eA_sales = (viewsA * totalSales) / totalViews;
  const eA_noSales = (viewsA * totalNoSales) / totalViews;
  const eB_sales = (viewsB * totalSales) / totalViews;
  const eB_noSales = (viewsB * totalNoSales) / totalViews;

  // Guard against zero expected values
  if (eA_sales === 0 || eA_noSales === 0 || eB_sales === 0 || eB_noSales === 0) {
    return 0;
  }

  // Chi-squared statistic
  const chi2 =
    ((salesA - eA_sales) ** 2) / eA_sales +
    ((viewsA - salesA - eA_noSales) ** 2) / eA_noSales +
    ((salesB - eB_sales) ** 2) / eB_sales +
    ((viewsB - salesB - eB_noSales) ** 2) / eB_noSales;

  return chi2;
}

/**
 * Map chi-squared value (1 df) to approximate confidence level.
 *
 * Critical values for 1 degree of freedom:
 *   90% confidence: 2.706
 *   95% confidence: 3.841
 *   99% confidence: 6.635
 */
function chiSquaredToConfidence(chi2: number): number {
  if (!Number.isFinite(chi2) || chi2 < 0) return 0;
  if (chi2 >= 6.635) return 0.99;
  if (chi2 >= 3.841) return 0.95;
  if (chi2 >= 2.706) return 0.90;
  if (chi2 >= 1.642) return 0.80;
  if (chi2 >= 0.455) return 0.50;
  return 0;
}

function parseTestRow(row: Record<string, unknown>): PriceTest {
  return {
    id: row.id as string,
    userId: (row.user_id as string) ?? 'default',
    listingId: row.listing_id as string,
    priceA: row.price_a as number,
    priceB: row.price_b as number,
    viewsA: (row.views_a as number) ?? 0,
    viewsB: (row.views_b as number) ?? 0,
    salesA: (row.sales_a as number) ?? 0,
    salesB: (row.sales_b as number) ?? 0,
    revenueA: (row.revenue_a as number) ?? 0,
    revenueB: (row.revenue_b as number) ?? 0,
    status: (row.status as TestStatus) ?? 'active',
    winner: (row.winner as TestWinner) ?? null,
    startedAt: (row.started_at as number) ?? Date.now(),
    endedAt: (row.ended_at as number | null) ?? null,
    durationDays: (row.duration_days as number) ?? 7,
    maxImpressions: (row.max_impressions as number | null) ?? null,
  };
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Create a new A/B price test for a listing.
 */
export function createPriceTest(db: Database, params: CreatePriceTestParams): PriceTest {
  if (!Number.isFinite(params.priceA) || params.priceA <= 0) {
    throw new Error('price_a must be a positive number');
  }
  if (!Number.isFinite(params.priceB) || params.priceB <= 0) {
    throw new Error('price_b must be a positive number');
  }
  if (!params.listingId) {
    throw new Error('listing_id is required');
  }
  if (params.priceA === params.priceB) {
    throw new Error('price_a and price_b must be different');
  }

  // Check no active test already exists for this listing
  const existing = db.query<Record<string, unknown>>(
    "SELECT id FROM price_tests WHERE listing_id = ? AND status = 'active'",
    [params.listingId],
  );
  if (existing.length > 0) {
    throw new Error(`Active price test already exists for listing ${params.listingId}: ${(existing[0] as { id: string }).id}`);
  }

  const id = generateId('pt');
  const now = Date.now();
  const durationDays = params.durationDays ?? 7;
  const maxImpressions = params.maxImpressions ?? null;

  db.run(
    `INSERT INTO price_tests (id, user_id, listing_id, price_a, price_b, status, started_at, duration_days, max_impressions)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    [
      id,
      params.userId ?? 'default',
      params.listingId,
      params.priceA,
      params.priceB,
      now,
      durationDays,
      maxImpressions,
    ],
  );

  logger.info({ testId: id, listingId: params.listingId, priceA: params.priceA, priceB: params.priceB }, 'Price test created');

  return {
    id,
    userId: params.userId ?? 'default',
    listingId: params.listingId,
    priceA: params.priceA,
    priceB: params.priceB,
    viewsA: 0,
    viewsB: 0,
    salesA: 0,
    salesB: 0,
    revenueA: 0,
    revenueB: 0,
    status: 'active',
    winner: null,
    startedAt: now,
    endedAt: null,
    durationDays,
    maxImpressions,
  };
}

/**
 * Record an impression (view) for a test variant.
 */
export function recordTestImpression(db: Database, testId: string, variant: TestVariant): void {
  const col = variant === 'A' ? 'views_a' : 'views_b';
  db.run(
    `UPDATE price_tests SET ${col} = ${col} + 1 WHERE id = ? AND status = 'active'`,
    [testId],
  );
}

/**
 * Record a sale for a test variant.
 */
export function recordTestSale(db: Database, testId: string, variant: TestVariant, price: number): void {
  if (!Number.isFinite(price) || price < 0) {
    logger.warn({ testId, variant, price }, 'Invalid sale price, skipping');
    return;
  }

  const salesCol = variant === 'A' ? 'sales_a' : 'sales_b';
  const revenueCol = variant === 'A' ? 'revenue_a' : 'revenue_b';

  db.run(
    `UPDATE price_tests SET ${salesCol} = ${salesCol} + 1, ${revenueCol} = ${revenueCol} + ? WHERE id = ? AND status = 'active'`,
    [price, testId],
  );
}

/**
 * Get A/B test results with statistical significance analysis.
 */
export function getPriceTestResults(db: Database, testId: string): PriceTestResults | null {
  const rows = db.query<Record<string, unknown>>(
    'SELECT * FROM price_tests WHERE id = ?',
    [testId],
  );
  if (rows.length === 0) return null;

  const test = parseTestRow(rows[0]);

  // Conversion rates
  const conversionRateA = test.viewsA > 0 ? test.salesA / test.viewsA : 0;
  const conversionRateB = test.viewsB > 0 ? test.salesB / test.viewsB : 0;
  const conversionRateDiff = conversionRateB - conversionRateA;

  // Revenue per view
  const revenuePerViewA = test.viewsA > 0 ? test.revenueA / test.viewsA : 0;
  const revenuePerViewB = test.viewsB > 0 ? test.revenueB / test.viewsB : 0;

  // Revenue impact
  const revenueImpactPct = revenuePerViewA > 0
    ? ((revenuePerViewB - revenuePerViewA) / revenuePerViewA) * 100
    : 0;

  // Statistical significance
  const chi2 = chiSquared2x2(test.salesA, test.viewsA, test.salesB, test.viewsB);
  const confidenceLevel = chiSquaredToConfidence(chi2);
  const isSignificant = confidenceLevel >= 0.95;

  // Determine recommended winner
  let recommendedWinner: TestWinner = 'inconclusive';
  if (isSignificant) {
    // Use revenue per view as primary metric
    if (revenuePerViewB > revenuePerViewA) {
      recommendedWinner = 'B';
    } else if (revenuePerViewA > revenuePerViewB) {
      recommendedWinner = 'A';
    }
  }

  // Summary
  const totalViews = test.viewsA + test.viewsB;
  let summary: string;
  if (totalViews === 0) {
    summary = 'No data collected yet. Need more impressions to determine a winner.';
  } else if (!isSignificant) {
    summary = `Results not yet statistically significant (${(confidenceLevel * 100).toFixed(0)}% confidence). ` +
      `A: ${(conversionRateA * 100).toFixed(1)}% CVR ($${round2(revenuePerViewA)}/view), ` +
      `B: ${(conversionRateB * 100).toFixed(1)}% CVR ($${round2(revenuePerViewB)}/view). ` +
      `Need more data.`;
  } else {
    const winnerLabel = recommendedWinner === 'A' ? `A ($${test.priceA.toFixed(2)})` : `B ($${test.priceB.toFixed(2)})`;
    summary = `Variant ${winnerLabel} wins with ${(confidenceLevel * 100).toFixed(0)}% confidence. ` +
      `A: ${(conversionRateA * 100).toFixed(1)}% CVR ($${round2(revenuePerViewA)}/view), ` +
      `B: ${(conversionRateB * 100).toFixed(1)}% CVR ($${round2(revenuePerViewB)}/view). ` +
      `Revenue impact: ${revenueImpactPct >= 0 ? '+' : ''}${round2(revenueImpactPct)}%.`;
  }

  return {
    test,
    conversionRateA: round2(conversionRateA * 100),
    conversionRateB: round2(conversionRateB * 100),
    conversionRateDiff: round2(conversionRateDiff * 100),
    revenuePerViewA: round2(revenuePerViewA),
    revenuePerViewB: round2(revenuePerViewB),
    revenueImpactPct: round2(revenueImpactPct),
    confidenceLevel: round2(confidenceLevel * 100),
    isSignificant,
    recommendedWinner,
    summary,
  };
}

/**
 * End a price test and optionally apply the winning price.
 */
export function endPriceTest(
  db: Database,
  testId: string,
  winner?: TestWinner,
): PriceTest | null {
  const rows = db.query<Record<string, unknown>>(
    'SELECT * FROM price_tests WHERE id = ?',
    [testId],
  );
  if (rows.length === 0) return null;

  const test = parseTestRow(rows[0]);

  if (test.status !== 'active') {
    logger.warn({ testId, status: test.status }, 'Cannot end non-active test');
    return test;
  }

  // Determine winner if not explicitly provided
  let resolvedWinner = winner ?? null;
  if (!resolvedWinner) {
    const results = getPriceTestResults(db, testId);
    resolvedWinner = results?.recommendedWinner ?? 'inconclusive';
  }

  const now = Date.now();
  db.run(
    'UPDATE price_tests SET status = ?, winner = ?, ended_at = ? WHERE id = ?',
    ['completed', resolvedWinner, now, testId],
  );

  // Apply winning price to the listing if we have a clear winner
  if (resolvedWinner === 'A' || resolvedWinner === 'B') {
    const winningPrice = resolvedWinner === 'A' ? test.priceA : test.priceB;
    try {
      db.run(
        'UPDATE listings SET price = ?, updated_at = ? WHERE id = ?',
        [winningPrice, now, test.listingId],
      );
      logger.info({ testId, winner: resolvedWinner, price: winningPrice, listingId: test.listingId }, 'Applied winning price');
    } catch (err) {
      logger.error({ err, testId, listingId: test.listingId }, 'Failed to apply winning price');
    }
  }

  test.status = 'completed';
  test.winner = resolvedWinner;
  test.endedAt = now;
  return test;
}

/**
 * List all price tests, optionally filtered by status.
 */
export function listPriceTests(
  db: Database,
  userId?: string,
  status?: TestStatus | 'all',
): PriceTest[] {
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (userId) {
      conditions.push('user_id = ?');
      params.push(userId);
    }

    if (status && status !== 'all') {
      conditions.push('status = ?');
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.query<Record<string, unknown>>(
      `SELECT * FROM price_tests ${where} ORDER BY started_at DESC`,
      params,
    );

    return rows.map(parseTestRow);
  } catch (err) {
    logger.error({ err }, 'Failed to list price tests');
    return [];
  }
}

/**
 * Check if any active tests have expired and auto-close them.
 */
export function expireFinishedTests(db: Database): number {
  const now = Date.now();
  let expired = 0;

  try {
    // Find tests past their duration
    const overdue = db.query<Record<string, unknown>>(
      "SELECT * FROM price_tests WHERE status = 'active'",
    );

    for (const row of overdue) {
      const test = parseTestRow(row);
      const expiresAt = test.startedAt + test.durationDays * 24 * 60 * 60 * 1000;

      const maxImpressionsReached = test.maxImpressions !== null &&
        (test.viewsA + test.viewsB) >= test.maxImpressions;

      if (now >= expiresAt || maxImpressionsReached) {
        endPriceTest(db, test.id);
        expired++;
      }
    }
  } catch (err) {
    logger.error({ err }, 'Failed to expire finished tests');
  }

  return expired;
}
