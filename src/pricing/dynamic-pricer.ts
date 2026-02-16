/**
 * Dynamic Pricing Module
 *
 * Computes prices based on configurable strategies:
 *   - demand_based: raise price when sales velocity is high, lower when slow
 *   - time_decay: progressive markdown over days listed
 *   - competition_reactive: auto-adjust based on competitor price changes
 *   - inventory_pressure: lower price when stock is high, raise when low
 */

import { createLogger } from '../utils/logger.js';
import { generateId } from '../utils/id.js';
import type { Database } from '../db/index.js';
import type {
  DynamicPricingStrategy,
  DynamicPricingParams,
  DynamicPricingConfig,
  DynamicPriceChange,
  DynamicPriceContext,
} from './types.js';

const logger = createLogger('dynamic-pricer');

// =============================================================================
// HELPERS
// =============================================================================

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampPrice(price: number, min: number | null, max: number | null): number {
  let result = price;
  if (min !== null && Number.isFinite(min) && result < min) {
    result = min;
  }
  if (max !== null && Number.isFinite(max) && result > max) {
    result = max;
  }
  return round2(result);
}

function parseConfigRow(row: Record<string, unknown>): DynamicPricingConfig {
  let params: DynamicPricingParams = {};
  try {
    params = JSON.parse((row.params as string) ?? '{}');
  } catch {
    params = {};
  }

  return {
    id: row.id as string,
    listingId: row.listing_id as string,
    strategy: row.strategy as DynamicPricingStrategy,
    params,
    minPrice: (row.min_price as number | null) ?? null,
    maxPrice: (row.max_price as number | null) ?? null,
    enabled: Boolean(row.enabled),
    lastRunAt: (row.last_run_at as number | null) ?? null,
    createdAt: (row.created_at as number) ?? Date.now(),
  };
}

function parsePriceLogRow(row: Record<string, unknown>): DynamicPriceChange {
  let params: DynamicPricingParams | null = null;
  try {
    if (row.params) {
      params = JSON.parse(row.params as string);
    }
  } catch {
    params = null;
  }

  return {
    id: row.id as string,
    listingId: row.listing_id as string,
    oldPrice: row.old_price as number,
    newPrice: row.new_price as number,
    strategy: row.strategy as string,
    reason: row.reason as string,
    params,
    createdAt: (row.created_at as number) ?? Date.now(),
  };
}

// =============================================================================
// STRATEGY IMPLEMENTATIONS
// =============================================================================

function applyDemandBased(
  currentPrice: number,
  context: DynamicPriceContext,
  params: DynamicPricingParams,
): { newPrice: number; reason: string } | null {
  const increasePct = params.increase_pct ?? 5;
  const decreasePct = params.decrease_pct ?? 10;
  const highThreshold = params.high_velocity_threshold ?? 5;
  const lowThreshold = params.low_velocity_threshold ?? 0;
  const lookbackDays = params.lookback_days ?? 7;

  const sales = lookbackDays <= 7 ? context.salesLast7Days : context.salesLast30Days;

  if (sales >= highThreshold) {
    const newPrice = round2(currentPrice * (1 + increasePct / 100));
    return {
      newPrice,
      reason: `High demand (${sales} sales in ${lookbackDays}d, threshold ${highThreshold}): +${increasePct}%`,
    };
  }

  if (sales <= lowThreshold && context.daysListed >= lookbackDays) {
    const newPrice = round2(currentPrice * (1 - decreasePct / 100));
    return {
      newPrice,
      reason: `Low demand (${sales} sales in ${lookbackDays}d): -${decreasePct}%`,
    };
  }

  return null;
}

function applyTimeDecay(
  currentPrice: number,
  context: DynamicPriceContext,
  params: DynamicPricingParams,
): { newPrice: number; reason: string } | null {
  const decayRate = params.decay_rate_pct_per_day ?? 0.5;
  const decayStartDays = params.decay_start_days ?? 14;

  if (context.daysListed < decayStartDays) {
    return null;
  }

  const daysOverThreshold = context.daysListed - decayStartDays;
  const totalDecayPct = daysOverThreshold * decayRate;
  const newPrice = round2(currentPrice * (1 - totalDecayPct / 100));

  if (Math.abs(newPrice - currentPrice) < 0.005) {
    return null;
  }

  return {
    newPrice,
    reason: `Time decay: ${daysOverThreshold}d past ${decayStartDays}d threshold, -${round2(totalDecayPct)}% total`,
  };
}

function applyCompetitionReactive(
  currentPrice: number,
  context: DynamicPriceContext,
  params: DynamicPricingParams,
): { newPrice: number; reason: string } | null {
  if (context.competitorPrices.length === 0) {
    return null;
  }

  const validPrices = context.competitorPrices.filter(
    (p) => Number.isFinite(p) && p > 0,
  );
  if (validPrices.length === 0) {
    return null;
  }

  const lowestCompetitor = Math.min(...validPrices);
  const undercutPct = params.undercut_pct ?? 2;
  const priceMatch = params.price_match ?? false;
  const maxAdjustmentPct = params.max_adjustment_pct ?? 15;

  let newPrice: number;
  let reason: string;

  if (priceMatch) {
    // Match the lowest competitor exactly
    newPrice = lowestCompetitor;
    reason = `Price matched lowest competitor at $${lowestCompetitor.toFixed(2)}`;
  } else {
    // Undercut by percentage
    newPrice = round2(lowestCompetitor * (1 - undercutPct / 100));
    reason = `Undercut lowest competitor ($${lowestCompetitor.toFixed(2)}) by ${undercutPct}%`;
  }

  // Enforce max adjustment limit
  const maxDelta = currentPrice * (maxAdjustmentPct / 100);
  if (Math.abs(newPrice - currentPrice) > maxDelta) {
    if (newPrice < currentPrice) {
      newPrice = round2(currentPrice - maxDelta);
    } else {
      newPrice = round2(currentPrice + maxDelta);
    }
    reason += ` (capped at ${maxAdjustmentPct}% max adjustment)`;
  }

  if (Math.abs(newPrice - currentPrice) < 0.005) {
    return null;
  }

  return { newPrice, reason };
}

function applyInventoryPressure(
  currentPrice: number,
  context: DynamicPriceContext,
  params: DynamicPricingParams,
): { newPrice: number; reason: string } | null {
  const highStockThreshold = params.high_stock_threshold ?? 20;
  const lowStockThreshold = params.low_stock_threshold ?? 3;
  const highStockDiscountPct = params.high_stock_discount_pct ?? 10;
  const lowStockPremiumPct = params.low_stock_premium_pct ?? 5;

  const stock = context.totalInventory;

  if (stock >= highStockThreshold) {
    const newPrice = round2(currentPrice * (1 - highStockDiscountPct / 100));
    return {
      newPrice,
      reason: `High inventory (${stock} units, threshold ${highStockThreshold}): -${highStockDiscountPct}%`,
    };
  }

  if (stock <= lowStockThreshold && stock > 0) {
    const newPrice = round2(currentPrice * (1 + lowStockPremiumPct / 100));
    return {
      newPrice,
      reason: `Low inventory (${stock} units, threshold ${lowStockThreshold}): +${lowStockPremiumPct}%`,
    };
  }

  return null;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Calculate dynamic price for a listing based on its configured strategy.
 */
export function calculateDynamicPrice(
  db: Database,
  listingId: string,
  strategyOverride?: DynamicPricingStrategy,
  paramsOverride?: DynamicPricingParams,
  contextOverride?: DynamicPriceContext,
): { newPrice: number | null; reason: string; strategy: string } {
  // Get strategy config
  let strategy: DynamicPricingStrategy;
  let params: DynamicPricingParams;
  let minPrice: number | null = null;
  let maxPrice: number | null = null;

  if (strategyOverride) {
    strategy = strategyOverride;
    params = paramsOverride ?? {};
  } else {
    const rows = db.query<Record<string, unknown>>(
      "SELECT * FROM dynamic_pricing_strategies WHERE listing_id = ? AND enabled = 1",
      [listingId],
    );
    if (rows.length === 0) {
      return { newPrice: null, reason: 'No dynamic pricing strategy configured', strategy: 'none' };
    }
    const config = parseConfigRow(rows[0]);
    strategy = config.strategy;
    params = config.params;
    minPrice = config.minPrice;
    maxPrice = config.maxPrice;
  }

  // Build context if not provided
  const context: DynamicPriceContext = contextOverride ?? buildPriceContext(db, listingId);

  if (!Number.isFinite(context.currentPrice) || context.currentPrice <= 0) {
    return { newPrice: null, reason: 'Invalid current price', strategy };
  }

  // Apply strategy
  let result: { newPrice: number; reason: string } | null = null;

  switch (strategy) {
    case 'demand_based':
      result = applyDemandBased(context.currentPrice, context, params);
      break;
    case 'time_decay':
      result = applyTimeDecay(context.currentPrice, context, params);
      break;
    case 'competition_reactive':
      result = applyCompetitionReactive(context.currentPrice, context, params);
      break;
    case 'inventory_pressure':
      result = applyInventoryPressure(context.currentPrice, context, params);
      break;
    default:
      return { newPrice: null, reason: `Unknown strategy: ${strategy}`, strategy };
  }

  if (!result) {
    return { newPrice: null, reason: `Strategy ${strategy} did not trigger a price change`, strategy };
  }

  // Apply min/max bounds from override params or config
  const effectiveMin = params.min_price ?? minPrice;
  const effectiveMax = params.max_price ?? maxPrice;
  const clampedPrice = clampPrice(result.newPrice, effectiveMin, effectiveMax);

  if (clampedPrice !== result.newPrice) {
    result.reason += ` (clamped to bounds $${effectiveMin ?? '-'}/$${effectiveMax ?? '-'})`;
    result.newPrice = clampedPrice;
  }

  // Log the price change
  logPriceChange(db, listingId, context.currentPrice, result.newPrice, strategy, result.reason, params);

  // Update last run time
  db.run(
    'UPDATE dynamic_pricing_strategies SET last_run_at = ? WHERE listing_id = ?',
    [Date.now(), listingId],
  );

  return { newPrice: result.newPrice, reason: result.reason, strategy };
}

/**
 * Set up a dynamic pricing strategy for a listing.
 */
export function setDynamicPricingStrategy(
  db: Database,
  listingId: string,
  strategy: DynamicPricingStrategy,
  params?: DynamicPricingParams,
  minPrice?: number,
  maxPrice?: number,
): DynamicPricingConfig {
  if (!listingId) throw new Error('listing_id is required');

  const existing = db.query<Record<string, unknown>>(
    'SELECT * FROM dynamic_pricing_strategies WHERE listing_id = ?',
    [listingId],
  );

  const effectiveParams = params ?? {};
  const now = Date.now();

  if (existing.length > 0) {
    db.run(
      'UPDATE dynamic_pricing_strategies SET strategy = ?, params = ?, min_price = ?, max_price = ?, enabled = 1 WHERE listing_id = ?',
      [strategy, JSON.stringify(effectiveParams), minPrice ?? null, maxPrice ?? null, listingId],
    );
    logger.info({ listingId, strategy }, 'Dynamic pricing strategy updated');

    const config = parseConfigRow(existing[0]);
    config.strategy = strategy;
    config.params = effectiveParams;
    config.minPrice = minPrice ?? null;
    config.maxPrice = maxPrice ?? null;
    config.enabled = true;
    return config;
  }

  const id = generateId('dps');
  db.run(
    `INSERT INTO dynamic_pricing_strategies (id, listing_id, strategy, params, min_price, max_price, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [id, listingId, strategy, JSON.stringify(effectiveParams), minPrice ?? null, maxPrice ?? null, now],
  );

  logger.info({ listingId, strategy, configId: id }, 'Dynamic pricing strategy created');

  return {
    id,
    listingId,
    strategy,
    params: effectiveParams,
    minPrice: minPrice ?? null,
    maxPrice: maxPrice ?? null,
    enabled: true,
    lastRunAt: null,
    createdAt: now,
  };
}

/**
 * Get dynamic price change history for a listing.
 */
export function getDynamicPriceHistory(
  db: Database,
  listingId: string,
  days: number = 30,
): DynamicPriceChange[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  try {
    const rows = db.query<Record<string, unknown>>(
      'SELECT * FROM dynamic_price_log WHERE listing_id = ? AND created_at >= ? ORDER BY created_at DESC',
      [listingId, cutoff],
    );

    return rows.map(parsePriceLogRow);
  } catch (err) {
    logger.error({ err, listingId }, 'Failed to get dynamic price history');
    return [];
  }
}

/**
 * Get dynamic pricing configuration for a listing.
 */
export function getDynamicPricingConfig(
  db: Database,
  listingId: string,
): DynamicPricingConfig | null {
  const rows = db.query<Record<string, unknown>>(
    'SELECT * FROM dynamic_pricing_strategies WHERE listing_id = ?',
    [listingId],
  );

  if (rows.length === 0) return null;
  return parseConfigRow(rows[0]);
}

// =============================================================================
// INTERNAL
// =============================================================================

function buildPriceContext(db: Database, listingId: string): DynamicPriceContext {
  // Get current listing price and metadata
  const listings = db.query<Record<string, unknown>>(
    'SELECT * FROM listings WHERE id = ?',
    [listingId],
  );

  const listing = listings[0];
  const currentPrice = listing ? (listing.price as number) : 0;
  const createdAt = listing ? (listing.created_at as number) : Date.now();
  const daysListed = Math.max(0, Math.floor((Date.now() - createdAt) / (24 * 60 * 60 * 1000)));
  const productId = listing ? (listing.product_id as string) : '';

  // Sales data from orders
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

  const salesRows7 = db.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM orders WHERE listing_id = ? AND ordered_at >= ? AND status != 'cancelled'",
    [listingId, sevenDaysAgo],
  );
  const salesRows30 = db.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM orders WHERE listing_id = ? AND ordered_at >= ? AND status != 'cancelled'",
    [listingId, thirtyDaysAgo],
  );

  const salesLast7Days = salesRows7[0]?.cnt ?? 0;
  const salesLast30Days = salesRows30[0]?.cnt ?? 0;

  // Competitor prices
  const competitorRows = db.query<{ price: number }>(
    `SELECT price FROM prices
     WHERE product_id = ? AND platform != ?
     ORDER BY fetched_at DESC LIMIT 20`,
    [productId, listing?.platform ?? ''],
  );
  const competitorPrices = competitorRows
    .map((r) => r.price)
    .filter((p) => Number.isFinite(p) && p > 0);

  // Inventory
  const inventoryRows = db.query<{ total: number }>(
    'SELECT COALESCE(SUM(quantity), 0) as total FROM warehouse_inventory WHERE product_id = ?',
    [productId],
  );
  const totalInventory = inventoryRows[0]?.total ?? 0;

  const listedRows = db.query<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM listings WHERE product_id = ? AND status = 'active'",
    [productId],
  );
  const listedInventory = listedRows[0]?.cnt ?? 0;

  return {
    currentPrice,
    daysListed,
    salesLast7Days,
    salesLast30Days,
    competitorPrices,
    totalInventory,
    listedInventory,
  };
}

function logPriceChange(
  db: Database,
  listingId: string,
  oldPrice: number,
  newPrice: number,
  strategy: string,
  reason: string,
  params: DynamicPricingParams,
): void {
  const id = generateId('dpl');
  try {
    db.run(
      `INSERT INTO dynamic_price_log (id, listing_id, old_price, new_price, strategy, reason, params, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, listingId, oldPrice, newPrice, strategy, reason, JSON.stringify(params), Date.now()],
    );
  } catch (err) {
    logger.error({ err, listingId }, 'Failed to log dynamic price change');
  }
}
