/**
 * Analytics & Competitor Tracking Types
 */

// =============================================================================
// PRICE SNAPSHOTS & TRENDS
// =============================================================================

export interface CompetitorPriceSnapshot {
  id: string;
  productId: string;
  platform: string;
  price: number;
  seller: string | null;
  timestamp: number;
}

export type TrendDirection = 'rising' | 'falling' | 'stable' | 'volatile';

export interface PriceTrend {
  productId: string;
  platform: string;
  dataPoints: Array<{ price: number; timestamp: number }>;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  stdDeviation: number;
  trendDirection: TrendDirection;
  pctChange: number;
  periodDays: number;
}

export interface TrendAnalysis {
  productId: string;
  platform: string | null;
  trends: PriceTrend[];
  overallDirection: TrendDirection;
  recommendation: string;
  analyzedAt: number;
}

export interface CompetitorReport {
  category: string;
  platform: string | null;
  competitors: Array<{
    seller: string;
    productCount: number;
    avgPrice: number;
    minPrice: number;
    maxPrice: number;
    priceRange: number;
  }>;
  totalProducts: number;
  avgCategoryPrice: number;
  generatedAt: number;
}
