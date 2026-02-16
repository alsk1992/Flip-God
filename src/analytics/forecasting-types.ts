/**
 * Demand Forecasting & Trend Prediction Types
 */

// =============================================================================
// FORECAST
// =============================================================================

export type ForecastMethod = 'sma' | 'wma' | 'seasonal';

export type TrendDirection = 'rising' | 'falling' | 'stable';

export interface DemandForecast {
  productId: string;
  method: ForecastMethod;
  forecast: number[];          // Predicted daily units for each future day
  confidence: number;          // 0-1 confidence score
  trend: TrendDirection;
  historicalAvgDaily: number;
  seasonality: {
    dayOfWeek: number[];       // Index 0=Sun, multipliers relative to mean
    monthOfYear: number[];     // Index 0=Jan, multipliers relative to mean
  };
  dataPointsUsed: number;
}

// =============================================================================
// SEASONAL PATTERN
// =============================================================================

export interface SeasonalPattern {
  category: string;
  platform: string | null;
  dayOfWeekPattern: Array<{
    dayOfWeek: number;
    dayName: string;
    avgOrders: number;
    relativeStrength: number;  // multiplier vs overall average
  }>;
  monthPattern: Array<{
    month: number;
    monthName: string;
    avgOrders: number;
    relativeStrength: number;
  }>;
  peakPeriods: string[];       // e.g. ["Friday", "Saturday", "December"]
  troughPeriods: string[];     // e.g. ["Tuesday", "June"]
  dataPointsUsed: number;
}

// =============================================================================
// PRICE ELASTICITY
// =============================================================================

export interface PriceElasticity {
  productId: string;
  elasticity: number;          // negative = normal good, positive = Giffen good
  confidence: number;          // 0-1
  interpretation: string;      // human-readable interpretation
  priceChanges: number;        // number of observed price changes
  avgPriceChangePct: number;
  avgVelocityChangePct: number;
}

// =============================================================================
// TRENDING CATEGORIES
// =============================================================================

export interface TrendingCategory {
  category: string;
  direction: TrendDirection;
  currentVelocity: number;     // orders per day in recent period
  previousVelocity: number;    // orders per day in prior period
  velocityChangePct: number;   // % change
  orderCount: number;
  revenue: number;
}

// =============================================================================
// STALLING PRODUCTS
// =============================================================================

export interface StallingProduct {
  productId: string;
  title: string;
  category: string | null;
  platform: string;
  daysListed: number;
  currentPrice: number;
  recentVelocity: number;     // sales/day in last 7 days
  priorVelocity: number;      // sales/day in prior period
  velocityDeclinePct: number;
  suggestedAction: 'markdown' | 'remove' | 'reprice' | 'monitor';
}
