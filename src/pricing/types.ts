/**
 * Pricing Module Types - A/B Testing & Dynamic Pricing
 */

// =============================================================================
// A/B PRICE TESTING
// =============================================================================

export type TestStatus = 'active' | 'completed' | 'cancelled';
export type TestVariant = 'A' | 'B';
export type TestWinner = 'A' | 'B' | 'inconclusive' | null;

export interface PriceTest {
  id: string;
  userId: string;
  listingId: string;
  priceA: number;
  priceB: number;
  viewsA: number;
  viewsB: number;
  salesA: number;
  salesB: number;
  revenueA: number;
  revenueB: number;
  status: TestStatus;
  winner: TestWinner;
  startedAt: number;
  endedAt: number | null;
  durationDays: number;
  maxImpressions: number | null;
}

export interface CreatePriceTestParams {
  userId?: string;
  listingId: string;
  priceA: number;
  priceB: number;
  durationDays?: number;
  maxImpressions?: number;
}

export interface PriceTestResults {
  test: PriceTest;
  conversionRateA: number;
  conversionRateB: number;
  conversionRateDiff: number;
  revenuePerViewA: number;
  revenuePerViewB: number;
  revenueImpactPct: number;
  confidenceLevel: number;
  isSignificant: boolean;
  recommendedWinner: TestWinner;
  summary: string;
}

// =============================================================================
// DYNAMIC PRICING
// =============================================================================

export type DynamicPricingStrategy =
  | 'demand_based'
  | 'time_decay'
  | 'competition_reactive'
  | 'inventory_pressure';

export interface DynamicPricingParams {
  min_price?: number;
  max_price?: number;
  // demand_based
  increase_pct?: number;
  decrease_pct?: number;
  high_velocity_threshold?: number;
  low_velocity_threshold?: number;
  lookback_days?: number;
  // time_decay
  decay_rate_pct_per_day?: number;
  decay_start_days?: number;
  // competition_reactive
  undercut_pct?: number;
  price_match?: boolean;
  max_adjustment_pct?: number;
  // inventory_pressure
  high_stock_threshold?: number;
  low_stock_threshold?: number;
  high_stock_discount_pct?: number;
  low_stock_premium_pct?: number;
}

export interface DynamicPricingConfig {
  id: string;
  listingId: string;
  strategy: DynamicPricingStrategy;
  params: DynamicPricingParams;
  minPrice: number | null;
  maxPrice: number | null;
  enabled: boolean;
  lastRunAt: number | null;
  createdAt: number;
}

export interface DynamicPriceChange {
  id: string;
  listingId: string;
  oldPrice: number;
  newPrice: number;
  strategy: string;
  reason: string;
  params: DynamicPricingParams | null;
  createdAt: number;
}

export interface DynamicPriceContext {
  currentPrice: number;
  daysListed: number;
  salesLast7Days: number;
  salesLast30Days: number;
  competitorPrices: number[];
  totalInventory: number;
  listedInventory: number;
}
