/**
 * Seller Performance Benchmarking Types
 */

// =============================================================================
// SELL-THROUGH RATE
// =============================================================================

export interface SellThroughRate {
  period: string;
  platform: string | null;
  category: string | null;
  totalListed: number;
  totalSold: number;
  sellThroughPct: number;     // (totalSold / totalListed) * 100
}

// =============================================================================
// HOLDING PERIOD
// =============================================================================

export interface HoldingPeriodAnalysis {
  category: string | null;
  platform: string | null;
  avgDays: number;
  medianDays: number;
  minDays: number;
  maxDays: number;
  sampleSize: number;
  buckets: Array<{
    label: string;            // e.g. "0-7 days", "8-14 days"
    count: number;
    pct: number;
  }>;
}

// =============================================================================
// SHIPPING PERFORMANCE
// =============================================================================

export interface ShippingPerformance {
  period: string;
  platform: string | null;
  totalShipped: number;
  avgDaysToShip: number;      // order placed to shipped
  avgDaysToDeliver: number;   // order placed to delivered
  onTimeRate: number;         // % shipped within 2 business days
  fastShipRate: number;       // % shipped same/next day
}

// =============================================================================
// RETURN RATE
// =============================================================================

export interface ReturnRateAnalysis {
  period: string;
  platform: string | null;
  category: string | null;
  totalOrders: number;
  totalReturns: number;
  returnRatePct: number;
  totalRefunded: number;
  topReasons: Array<{
    reason: string;
    count: number;
    pct: number;
  }>;
}

// =============================================================================
// PROFIT PER HOUR
// =============================================================================

export interface ProfitPerHour {
  period: string;
  totalProfit: number;
  orderCount: number;
  estimatedHours: number;     // rough estimate
  profitPerHour: number;
  avgProfitPerOrder: number;
}

// =============================================================================
// SELLER SCORECARD
// =============================================================================

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ScorecardMetric {
  name: string;
  value: number;
  unit: string;
  grade: Grade;
  trend: 'improving' | 'declining' | 'stable';
  previousValue: number | null;
}

export interface SellerScorecard {
  period: string;
  overallGrade: Grade;
  metrics: ScorecardMetric[];
  strengths: string[];
  improvements: string[];
  generatedAt: number;
}
