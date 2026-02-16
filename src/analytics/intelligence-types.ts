/**
 * Competitive Intelligence Types
 */

// =============================================================================
// PRICE CHART DATA
// =============================================================================

export interface PriceChartPoint {
  timestamp: number;
  date: string;               // ISO date string
  price: number;
  seller: string | null;
}

export interface CompetitorPriceChart {
  productId: string;
  platform: string | null;
  days: number;
  series: Array<{
    seller: string;
    dataPoints: PriceChartPoint[];
    avgPrice: number;
    minPrice: number;
    maxPrice: number;
    currentPrice: number | null;
  }>;
  overallAvgPrice: number;
  priceSpread: number;        // max - min across all sellers
}

// =============================================================================
// STOCKOUT PREDICTION
// =============================================================================

export interface StockoutPrediction {
  productId: string;
  platform: string;
  seller: string;
  estimatedDaysUntilStockout: number | null;
  confidence: number;         // 0-1
  currentVelocity: number;    // estimated sales per day
  priceTrajectory: 'rising' | 'falling' | 'stable';
  reasoning: string;
}

// =============================================================================
// MARKET SHARE ESTIMATE
// =============================================================================

export interface MarketShareEstimate {
  category: string;
  platform: string | null;
  totalSellers: number;
  totalListings: number;
  avgPrice: number;
  priceSpread: number;
  sellerShares: Array<{
    seller: string;
    listingCount: number;
    estimatedSharePct: number;
    avgPrice: number;
    pricePosition: 'below_avg' | 'at_avg' | 'above_avg';
  }>;
}

// =============================================================================
// PRICING STRATEGY CLASSIFICATION
// =============================================================================

export type PricingStrategy =
  | 'cost_plus'
  | 'penetration'
  | 'skimming'
  | 'competitive'
  | 'loss_leader'
  | 'unknown';

export interface PricingStrategyAnalysis {
  productId: string;
  platform: string | null;
  strategies: Array<{
    seller: string;
    strategy: PricingStrategy;
    confidence: number;       // 0-1
    reasoning: string;
    avgPrice: number;
    priceVsMarket: number;   // % above/below market average
    priceVolatility: number;  // coefficient of variation
  }>;
}

// =============================================================================
// COMPETITOR ALERTS
// =============================================================================

export type AlertType =
  | 'new_entrant'
  | 'price_war'
  | 'price_increase'
  | 'stockout'
  | 'new_listing'
  | 'price_undercut';

export interface CompetitorAlert {
  type: AlertType;
  severity: 'low' | 'medium' | 'high';
  message: string;
  productId: string | null;
  category: string | null;
  platform: string | null;
  seller: string | null;
  detectedAt: number;
  data: Record<string, unknown>;
}

// =============================================================================
// MARKET OVERVIEW
// =============================================================================

export interface MarketOverview {
  category: string;
  platform: string | null;
  sellerCount: number;
  listingCount: number;
  avgPrice: number;
  medianPrice: number;
  priceSpread: number;        // max - min
  priceStdDev: number;
  listingDensity: number;     // listings per seller
  recentActivity: {
    newListings7d: number;
    priceChanges7d: number;
    avgPriceChange7dPct: number;
  };
  generatedAt: number;
}
