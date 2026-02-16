/**
 * Repricing Rule Types - Type definitions for the smart auto-repricer rule engine
 */

// =============================================================================
// RULE TYPES
// =============================================================================

export type RuleType =
  | 'beat_lowest'
  | 'match_buybox'
  | 'floor_ceiling'
  | 'margin_target'
  | 'velocity_based'
  | 'time_decay';

/** Parameters for beat_lowest rule */
export interface BeatLowestParams {
  /** Percentage to undercut lowest competitor (e.g. 2 = 2%) */
  undercut_pct?: number;
  /** Absolute amount to undercut (e.g. 0.01 = $0.01) */
  undercut_abs?: number;
  /** Minimum price floor */
  min_price?: number;
}

/** Parameters for match_buybox rule */
export interface MatchBuyboxParams {
  /** Maximum premium above Buy Box price to still match (default 0) */
  max_premium_pct?: number;
  /** If true, only match when our price is higher */
  only_when_higher?: boolean;
}

/** Parameters for floor_ceiling rule */
export interface FloorCeilingParams {
  /** Minimum allowed price */
  floor_price: number;
  /** Maximum allowed price */
  ceiling_price: number;
}

/** Parameters for margin_target rule */
export interface MarginTargetParams {
  /** Minimum profit margin percentage */
  min_margin_pct: number;
  /** Target (ideal) margin percentage */
  target_margin_pct?: number;
  /** Which field to use as cost basis */
  source_price_field?: 'buy_price' | 'source_price' | 'cost';
  /** Platform fee percentage (e.g. 13 for eBay) */
  fee_pct?: number;
}

/** Parameters for velocity_based rule */
export interface VelocityBasedParams {
  /** Sales count threshold for "fast" (increase price) */
  sales_threshold?: number;
  /** Percentage to increase price when selling fast */
  increase_pct?: number;
  /** Percentage to decrease price when selling slow */
  decrease_pct?: number;
  /** Number of days to look back for sales data */
  lookback_days?: number;
}

/** Parameters for time_decay rule */
export interface TimeDecayParams {
  /** Number of days listed before decay starts */
  days_listed?: number;
  /** Percentage to decay per day after threshold */
  decay_pct_per_day?: number;
  /** Absolute floor price (never go below this) */
  floor_price?: number;
}

/** Union of all rule parameter types */
export type RuleParams =
  | BeatLowestParams
  | MatchBuyboxParams
  | FloorCeilingParams
  | MarginTargetParams
  | VelocityBasedParams
  | TimeDecayParams;

// =============================================================================
// REPRICING RULE
// =============================================================================

export interface RepricingRuleRecord {
  id: string;
  user_id: string;
  name: string;
  type: RuleType;
  platform: string;
  category: string | null;
  sku_pattern: string | null;
  params: RuleParams;
  priority: number;
  enabled: boolean;
  created_at: number;
}

// =============================================================================
// RULE EVALUATION
// =============================================================================

export interface RuleEvalResult {
  /** The calculated new price, or null if rule did not trigger */
  newPrice: number | null;
  /** Human-readable reason for the price change (or why it didn't trigger) */
  reason: string;
  /** Whether this rule was triggered */
  triggered: boolean;
}

// =============================================================================
// MARKET DATA
// =============================================================================

export interface MarketData {
  /** Competitor prices (total including shipping) sorted ascending */
  competitorPrices: number[];
  /** Current Buy Box price (if available) */
  buyBoxPrice?: number;
  /** Sales velocity data */
  salesData?: SalesData;
  /** Days since the listing was created */
  daysListed?: number;
  /** Cost of goods / source price */
  costPrice?: number;
}

export interface SalesData {
  /** Total sales in the lookback period */
  totalSales: number;
  /** Sales in the last 7 days */
  salesLast7Days: number;
  /** Sales in the last 14 days */
  salesLast14Days: number;
  /** Average daily sales rate */
  avgDailySales: number;
  /** Number of days in the lookback period */
  lookbackDays: number;
}

// =============================================================================
// REPRICING HISTORY
// =============================================================================

export interface RepricingHistoryRecord {
  id: string;
  listing_id: string;
  rule_id: string | null;
  rule_name: string | null;
  old_price: number;
  new_price: number;
  reason: string;
  dry_run: boolean;
  created_at: number;
}
