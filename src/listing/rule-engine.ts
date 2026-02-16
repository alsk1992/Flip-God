/**
 * Smart Auto-Repricer Rule Engine
 *
 * Evaluates repricing rules against current market data to determine
 * optimal listing prices. Supports multiple rule types applied in
 * priority order (first match wins).
 *
 * Rule types:
 * - beat_lowest: Undercut lowest competitor by X%/amount
 * - match_buybox: Match the Buy Box price
 * - floor_ceiling: Keep price within a fixed range
 * - margin_target: Maintain minimum profit margin
 * - velocity_based: Adjust based on sales velocity
 * - time_decay: Lower price over time if unsold
 */

import { createLogger } from '../utils/logger';
import { generateId } from '../utils/id';
import type { Database } from '../db';
import type {
  RuleType,
  RuleParams,
  RuleEvalResult,
  RepricingRuleRecord,
  RepricingHistoryRecord,
  MarketData,
  BeatLowestParams,
  MatchBuyboxParams,
  FloorCeilingParams,
  MarginTargetParams,
  VelocityBasedParams,
  TimeDecayParams,
} from './rule-types';

const logger = createLogger('rule-engine');

// =============================================================================
// HELPERS
// =============================================================================

/** Round to 2 decimal places */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Safely parse a number, returning null if invalid */
function safeNum(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// =============================================================================
// RULE EVALUATORS
// =============================================================================

function evaluateBeatLowest(
  currentPrice: number,
  competitorPrices: number[],
  params: BeatLowestParams,
): RuleEvalResult {
  if (competitorPrices.length === 0) {
    return { newPrice: null, reason: 'No competitor prices available', triggered: false };
  }

  const lowest = Math.min(...competitorPrices);
  if (!Number.isFinite(lowest) || lowest <= 0) {
    return { newPrice: null, reason: 'Invalid competitor price data', triggered: false };
  }

  const undercutPct = safeNum(params.undercut_pct) ?? 2;
  const undercutAbs = safeNum(params.undercut_abs) ?? 0.01;
  const minPrice = safeNum(params.min_price) ?? 0.01;

  // Calculate undercut price: use whichever method produces a lower price
  const priceByPct = round2(lowest * (1 - undercutPct / 100));
  const priceByAbs = round2(lowest - undercutAbs);
  let newPrice = Math.min(priceByPct, priceByAbs);

  // Enforce minimum
  if (newPrice < minPrice) {
    newPrice = minPrice;
  }

  if (Math.abs(newPrice - currentPrice) < 0.005) {
    return { newPrice: null, reason: `Already at competitive price ($${currentPrice.toFixed(2)})`, triggered: false };
  }

  return {
    newPrice: round2(newPrice),
    reason: `Beat lowest competitor ($${lowest.toFixed(2)}) -> $${newPrice.toFixed(2)}`,
    triggered: true,
  };
}

function evaluateMatchBuybox(
  currentPrice: number,
  _competitorPrices: number[],
  params: MatchBuyboxParams,
  marketData: MarketData,
): RuleEvalResult {
  const buyBoxPrice = marketData.buyBoxPrice;
  if (buyBoxPrice === undefined || !Number.isFinite(buyBoxPrice) || buyBoxPrice <= 0) {
    return { newPrice: null, reason: 'Buy Box price not available', triggered: false };
  }

  const onlyWhenHigher = params.only_when_higher ?? false;
  if (onlyWhenHigher && currentPrice <= buyBoxPrice) {
    return { newPrice: null, reason: `Current price ($${currentPrice.toFixed(2)}) already at or below Buy Box ($${buyBoxPrice.toFixed(2)})`, triggered: false };
  }

  const maxPremiumPct = safeNum(params.max_premium_pct) ?? 0;
  const adjustedPrice = round2(buyBoxPrice * (1 + maxPremiumPct / 100));

  if (Math.abs(adjustedPrice - currentPrice) < 0.005) {
    return { newPrice: null, reason: `Already at Buy Box price ($${currentPrice.toFixed(2)})`, triggered: false };
  }

  return {
    newPrice: adjustedPrice,
    reason: `Matched Buy Box price ($${buyBoxPrice.toFixed(2)})${maxPremiumPct > 0 ? ` +${maxPremiumPct}%` : ''}`,
    triggered: true,
  };
}

function evaluateFloorCeiling(
  currentPrice: number,
  _competitorPrices: number[],
  params: FloorCeilingParams,
): RuleEvalResult {
  const floor = safeNum(params.floor_price);
  const ceiling = safeNum(params.ceiling_price);

  if (floor === null || ceiling === null) {
    return { newPrice: null, reason: 'Invalid floor/ceiling configuration', triggered: false };
  }

  if (floor >= ceiling) {
    return { newPrice: null, reason: 'Floor must be less than ceiling', triggered: false };
  }

  if (currentPrice < floor) {
    return {
      newPrice: round2(floor),
      reason: `Price ($${currentPrice.toFixed(2)}) below floor ($${floor.toFixed(2)})`,
      triggered: true,
    };
  }

  if (currentPrice > ceiling) {
    return {
      newPrice: round2(ceiling),
      reason: `Price ($${currentPrice.toFixed(2)}) above ceiling ($${ceiling.toFixed(2)})`,
      triggered: true,
    };
  }

  return { newPrice: null, reason: `Price within floor/ceiling range ($${floor.toFixed(2)}-$${ceiling.toFixed(2)})`, triggered: false };
}

function evaluateMarginTarget(
  currentPrice: number,
  _competitorPrices: number[],
  params: MarginTargetParams,
  marketData: MarketData,
): RuleEvalResult {
  const costPrice = marketData.costPrice;
  if (costPrice === undefined || !Number.isFinite(costPrice) || costPrice <= 0) {
    return { newPrice: null, reason: 'Cost price not available for margin calculation', triggered: false };
  }

  const minMarginPct = safeNum(params.min_margin_pct);
  if (minMarginPct === null) {
    return { newPrice: null, reason: 'min_margin_pct not configured', triggered: false };
  }

  const targetMarginPct = safeNum(params.target_margin_pct) ?? minMarginPct;
  const feePct = safeNum(params.fee_pct) ?? 13; // default eBay + payment processing

  const feeMultiplier = 1 - feePct / 100;
  if (feeMultiplier <= 0) {
    return { newPrice: null, reason: 'Fee percentage too high (>=100%)', triggered: false };
  }

  // Target price: costPrice * (1 + targetMarginPct/100) / (1 - feePct/100)
  const targetPrice = round2((costPrice * (1 + targetMarginPct / 100)) / feeMultiplier);

  // Minimum acceptable price (enforces min margin)
  const minPrice = round2((costPrice * (1 + minMarginPct / 100)) / feeMultiplier);

  // Current effective margin: (price * (1 - feePct/100) - cost) / cost * 100
  const currentMargin = ((currentPrice * feeMultiplier) - costPrice) / costPrice * 100;

  if (currentMargin < minMarginPct) {
    // Price is too low, need to raise to at least minimum margin
    return {
      newPrice: minPrice,
      reason: `Margin ${currentMargin.toFixed(1)}% below minimum ${minMarginPct}% (cost $${costPrice.toFixed(2)}, fees ${feePct}%)`,
      triggered: true,
    };
  }

  // If current price is significantly different from target, adjust
  if (Math.abs(targetPrice - currentPrice) > 0.005 && currentPrice !== targetPrice) {
    return {
      newPrice: targetPrice,
      reason: `Adjusted to target margin ${targetMarginPct}% (cost $${costPrice.toFixed(2)}, fees ${feePct}%)`,
      triggered: true,
    };
  }

  return { newPrice: null, reason: `Margin ${currentMargin.toFixed(1)}% meets target`, triggered: false };
}

function evaluateVelocityBased(
  currentPrice: number,
  _competitorPrices: number[],
  params: VelocityBasedParams,
  marketData: MarketData,
): RuleEvalResult {
  const salesData = marketData.salesData;
  if (!salesData) {
    return { newPrice: null, reason: 'No sales data available', triggered: false };
  }

  const salesThreshold = safeNum(params.sales_threshold) ?? 5;
  const increasePct = safeNum(params.increase_pct) ?? 3;
  const decreasePct = safeNum(params.decrease_pct) ?? 5;
  const lookbackDays = safeNum(params.lookback_days) ?? 7;

  // Calculate sales in the lookback period
  const recentSales = lookbackDays <= 7
    ? salesData.salesLast7Days
    : salesData.salesLast14Days;

  if (recentSales >= salesThreshold) {
    // Selling fast -- increase price
    const newPrice = round2(currentPrice * (1 + increasePct / 100));
    return {
      newPrice,
      reason: `High velocity (${recentSales} sales in ${lookbackDays}d) -- increased ${increasePct}%`,
      triggered: true,
    };
  }

  if (recentSales === 0 && (marketData.daysListed ?? 0) >= lookbackDays) {
    // No sales in lookback period -- decrease price
    const newPrice = round2(currentPrice * (1 - decreasePct / 100));
    return {
      newPrice,
      reason: `No sales in ${lookbackDays}d -- decreased ${decreasePct}%`,
      triggered: true,
    };
  }

  return { newPrice: null, reason: `Sales velocity normal (${recentSales} in ${lookbackDays}d)`, triggered: false };
}

function evaluateTimeDecay(
  currentPrice: number,
  _competitorPrices: number[],
  params: TimeDecayParams,
  marketData: MarketData,
): RuleEvalResult {
  const daysListed = marketData.daysListed ?? 0;
  const thresholdDays = safeNum(params.days_listed) ?? 14;
  const decayPctPerDay = safeNum(params.decay_pct_per_day) ?? 0.5;
  const floorPrice = safeNum(params.floor_price) ?? 0.99;

  if (daysListed < thresholdDays) {
    return {
      newPrice: null,
      reason: `Listed ${daysListed}d, decay starts at ${thresholdDays}d`,
      triggered: false,
    };
  }

  const daysOverThreshold = daysListed - thresholdDays;
  const totalDecayPct = daysOverThreshold * decayPctPerDay;
  let newPrice = round2(currentPrice * (1 - totalDecayPct / 100));

  if (newPrice < floorPrice) {
    newPrice = floorPrice;
  }

  if (Math.abs(newPrice - currentPrice) < 0.005) {
    return { newPrice: null, reason: `Price already at decay floor ($${floorPrice.toFixed(2)})`, triggered: false };
  }

  return {
    newPrice: round2(newPrice),
    reason: `Time decay: ${daysOverThreshold}d past threshold, -${totalDecayPct.toFixed(1)}% -> $${newPrice.toFixed(2)}`,
    triggered: true,
  };
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Evaluate a single rule against current price and market data.
 */
export function evaluateRule(
  rule: RepricingRuleRecord,
  currentPrice: number,
  competitorPrices: number[],
  marketData: MarketData,
): RuleEvalResult {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    return { newPrice: null, reason: 'Invalid current price', triggered: false };
  }

  const params = rule.params ?? {};

  try {
    switch (rule.type) {
      case 'beat_lowest':
        return evaluateBeatLowest(currentPrice, competitorPrices, params as BeatLowestParams);
      case 'match_buybox':
        return evaluateMatchBuybox(currentPrice, competitorPrices, params as MatchBuyboxParams, marketData);
      case 'floor_ceiling':
        return evaluateFloorCeiling(currentPrice, competitorPrices, params as FloorCeilingParams);
      case 'margin_target':
        return evaluateMarginTarget(currentPrice, competitorPrices, params as MarginTargetParams, marketData);
      case 'velocity_based':
        return evaluateVelocityBased(currentPrice, competitorPrices, params as VelocityBasedParams, marketData);
      case 'time_decay':
        return evaluateTimeDecay(currentPrice, competitorPrices, params as TimeDecayParams, marketData);
      default:
        return { newPrice: null, reason: `Unknown rule type: ${rule.type}`, triggered: false };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, ruleId: rule.id, ruleType: rule.type }, 'Rule evaluation failed');
    return { newPrice: null, reason: `Rule evaluation error: ${msg}`, triggered: false };
  }
}

/**
 * Apply rules in priority order to a listing. First triggered rule wins.
 *
 * @param rules - Rules sorted by priority (lower number = higher priority)
 * @param currentPrice - Current listing price
 * @param marketData - Current market data (competitors, velocity, etc.)
 * @returns The result from the first triggered rule, or a no-change result
 */
export function applyRules(
  rules: RepricingRuleRecord[],
  currentPrice: number,
  marketData: MarketData,
): RuleEvalResult & { ruleId?: string; ruleName?: string } {
  // Sort by priority ascending (lower = higher priority)
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    if (!rule.enabled) continue;

    const result = evaluateRule(rule, currentPrice, marketData.competitorPrices, marketData);
    if (result.triggered && result.newPrice !== null) {
      logger.info(
        { ruleId: rule.id, ruleName: rule.name, ruleType: rule.type, oldPrice: currentPrice, newPrice: result.newPrice },
        'Rule triggered',
      );
      return { ...result, ruleId: rule.id, ruleName: rule.name };
    }
  }

  return {
    newPrice: null,
    reason: 'No rules triggered',
    triggered: false,
  };
}

// =============================================================================
// DATABASE CRUD
// =============================================================================

export interface CreateRuleInput {
  user_id?: string;
  name: string;
  type: RuleType;
  platform?: string;
  category?: string;
  sku_pattern?: string;
  params: RuleParams;
  priority?: number;
  enabled?: boolean;
}

export function createRule(db: Database, input: CreateRuleInput): RepricingRuleRecord {
  const id = generateId('rr');
  const now = Date.now();

  const record: RepricingRuleRecord = {
    id,
    user_id: input.user_id ?? 'default',
    name: input.name,
    type: input.type,
    platform: input.platform ?? 'all',
    category: input.category ?? null,
    sku_pattern: input.sku_pattern ?? null,
    params: input.params,
    priority: input.priority ?? 50,
    enabled: input.enabled ?? true,
    created_at: now,
  };

  try {
    db.run(
      `INSERT INTO repricing_rules_v2 (id, user_id, name, type, platform, category, sku_pattern, params, priority, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.id,
        record.user_id,
        record.name,
        record.type,
        record.platform,
        record.category,
        record.sku_pattern,
        JSON.stringify(record.params),
        record.priority,
        record.enabled ? 1 : 0,
        record.created_at,
      ],
    );
    logger.info({ ruleId: id, name: record.name, type: record.type }, 'Repricing rule created');
  } catch (err) {
    logger.error({ err, input }, 'Failed to create repricing rule');
    throw err;
  }

  return record;
}

export function getRules(db: Database, userId?: string): RepricingRuleRecord[] {
  try {
    const sql = userId
      ? 'SELECT * FROM repricing_rules_v2 WHERE user_id = ? ORDER BY priority ASC, created_at ASC'
      : 'SELECT * FROM repricing_rules_v2 ORDER BY priority ASC, created_at ASC';
    const params = userId ? [userId] : [];
    const rows = db.query<Record<string, unknown>>(sql, params);
    return rows.map(parseRuleRow);
  } catch (err) {
    logger.error({ err }, 'Failed to get repricing rules');
    return [];
  }
}

export function getRule(db: Database, ruleId: string): RepricingRuleRecord | null {
  try {
    const rows = db.query<Record<string, unknown>>(
      'SELECT * FROM repricing_rules_v2 WHERE id = ?',
      [ruleId],
    );
    if (rows.length === 0) return null;
    return parseRuleRow(rows[0]);
  } catch (err) {
    logger.error({ err, ruleId }, 'Failed to get repricing rule');
    return null;
  }
}

export function updateRule(
  db: Database,
  ruleId: string,
  updates: Partial<Pick<RepricingRuleRecord, 'name' | 'type' | 'platform' | 'category' | 'sku_pattern' | 'params' | 'priority' | 'enabled'>>,
): boolean {
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    setClauses.push('name = ?');
    values.push(updates.name);
  }
  if (updates.type !== undefined) {
    setClauses.push('type = ?');
    values.push(updates.type);
  }
  if (updates.platform !== undefined) {
    setClauses.push('platform = ?');
    values.push(updates.platform);
  }
  if (updates.category !== undefined) {
    setClauses.push('category = ?');
    values.push(updates.category);
  }
  if (updates.sku_pattern !== undefined) {
    setClauses.push('sku_pattern = ?');
    values.push(updates.sku_pattern);
  }
  if (updates.params !== undefined) {
    setClauses.push('params = ?');
    values.push(JSON.stringify(updates.params));
  }
  if (updates.priority !== undefined) {
    setClauses.push('priority = ?');
    values.push(updates.priority);
  }
  if (updates.enabled !== undefined) {
    setClauses.push('enabled = ?');
    values.push(updates.enabled ? 1 : 0);
  }

  if (setClauses.length === 0) return false;

  values.push(ruleId);

  try {
    db.run(
      `UPDATE repricing_rules_v2 SET ${setClauses.join(', ')} WHERE id = ?`,
      values,
    );
    logger.info({ ruleId, updates: Object.keys(updates) }, 'Repricing rule updated');
    return true;
  } catch (err) {
    logger.error({ err, ruleId }, 'Failed to update repricing rule');
    return false;
  }
}

export function deleteRule(db: Database, ruleId: string): boolean {
  try {
    db.run('DELETE FROM repricing_rules_v2 WHERE id = ?', [ruleId]);
    logger.info({ ruleId }, 'Repricing rule deleted');
    return true;
  } catch (err) {
    logger.error({ err, ruleId }, 'Failed to delete repricing rule');
    return false;
  }
}

// =============================================================================
// REPRICING HISTORY
// =============================================================================

export function recordRepricingHistory(
  db: Database,
  entry: Omit<RepricingHistoryRecord, 'id' | 'created_at'>,
): void {
  const id = generateId('rh');
  try {
    db.run(
      `INSERT INTO repricing_history (id, listing_id, rule_id, rule_name, old_price, new_price, reason, dry_run, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.listing_id,
        entry.rule_id,
        entry.rule_name,
        entry.old_price,
        entry.new_price,
        entry.reason,
        entry.dry_run ? 1 : 0,
        Date.now(),
      ],
    );
  } catch (err) {
    logger.error({ err, listingId: entry.listing_id }, 'Failed to record repricing history');
  }
}

export function getRepricingHistory(
  db: Database,
  options: { listing_id?: string; days?: number; limit?: number },
): RepricingHistoryRecord[] {
  const { listing_id, days = 7, limit = 50 } = options;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  try {
    let sql: string;
    let params: unknown[];

    if (listing_id) {
      sql = 'SELECT * FROM repricing_history WHERE listing_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?';
      params = [listing_id, cutoff, limit];
    } else {
      sql = 'SELECT * FROM repricing_history WHERE created_at >= ? ORDER BY created_at DESC LIMIT ?';
      params = [cutoff, limit];
    }

    const rows = db.query<Record<string, unknown>>(sql, params);
    return rows.map(parseHistoryRow);
  } catch (err) {
    logger.error({ err }, 'Failed to get repricing history');
    return [];
  }
}

// =============================================================================
// ROW PARSERS
// =============================================================================

function parseRuleRow(row: Record<string, unknown>): RepricingRuleRecord {
  let params: RuleParams = {};
  try {
    params = JSON.parse((row.params as string) ?? '{}');
  } catch {
    params = {};
  }

  return {
    id: row.id as string,
    user_id: row.user_id as string,
    name: row.name as string,
    type: row.type as RuleType,
    platform: (row.platform as string) ?? 'all',
    category: (row.category as string) ?? null,
    sku_pattern: (row.sku_pattern as string) ?? null,
    params,
    priority: (row.priority as number) ?? 50,
    enabled: Boolean(row.enabled),
    created_at: (row.created_at as number) ?? Date.now(),
  };
}

function parseHistoryRow(row: Record<string, unknown>): RepricingHistoryRecord {
  return {
    id: row.id as string,
    listing_id: row.listing_id as string,
    rule_id: (row.rule_id as string) ?? null,
    rule_name: (row.rule_name as string) ?? null,
    old_price: row.old_price as number,
    new_price: row.new_price as number,
    reason: row.reason as string,
    dry_run: Boolean(row.dry_run),
    created_at: (row.created_at as number) ?? Date.now(),
  };
}
