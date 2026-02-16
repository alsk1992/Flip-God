/**
 * Dashboard Analytics Types
 *
 * Structured return types for ROI/profit analytics queries.
 */

// =============================================================================
// PERIOD
// =============================================================================

export type DashboardPeriod = '7d' | '30d' | '90d' | 'ytd' | 'all';

// =============================================================================
// DAILY PROFIT
// =============================================================================

export interface DailyProfit {
  date: string;            // ISO date string (YYYY-MM-DD)
  revenue: number;         // Total sell price
  cost: number;            // Total buy price + shipping
  fees: number;            // Platform fees
  profit: number;          // revenue - cost - fees
  marginPct: number;       // (profit / revenue) * 100
  orderCount: number;
}

// =============================================================================
// CATEGORY PROFITABILITY
// =============================================================================

export interface CategoryProfit {
  category: string;
  revenue: number;
  cost: number;
  fees: number;
  profit: number;
  marginPct: number;
  orderCount: number;
  avgOrderValue: number;
}

// =============================================================================
// PLATFORM ROI
// =============================================================================

export interface PlatformROI {
  platform: string;
  revenue: number;
  cost: number;
  fees: number;
  netProfit: number;
  roiPct: number;          // (netProfit / cost) * 100
  orderCount: number;
  avgProfit: number;
}

// =============================================================================
// PRODUCT PERFORMANCE
// =============================================================================

export interface ProductPerformance {
  productId: string;
  title: string;
  category: string | null;
  revenue: number;
  cost: number;
  fees: number;
  profit: number;
  marginPct: number;
  orderCount: number;
  avgDaysToSell: number | null;
}

// =============================================================================
// INVENTORY TURNOVER
// =============================================================================

export interface InventoryTurnover {
  category: string;
  platform: string | null;
  avgDaysToSell: number;
  medianDaysToSell: number;
  minDaysToSell: number;
  maxDaysToSell: number;
  totalSold: number;
  totalListed: number;
  turnoverRate: number;    // totalSold / totalListed
}

// =============================================================================
// TIME-OF-DAY PROFIT
// =============================================================================

export interface TimeOfDayProfit {
  hour: number;            // 0-23
  orderCount: number;
  totalProfit: number;
  avgProfit: number;
}

export interface DayOfWeekProfit {
  dayOfWeek: number;       // 0=Sunday, 6=Saturday
  dayName: string;
  orderCount: number;
  totalProfit: number;
  avgProfit: number;
}

// =============================================================================
// OVERALL STATS
// =============================================================================

export interface OverallStats {
  period: DashboardPeriod;
  totalRevenue: number;
  totalCOGS: number;       // Cost of goods sold (buy price + shipping)
  totalFees: number;
  grossProfit: number;     // revenue - COGS
  netProfit: number;       // revenue - COGS - fees
  orderCount: number;
  avgOrderValue: number;
  avgProfit: number;
  grossMarginPct: number;
  netMarginPct: number;
  returnCount: number;
  returnRate: number;      // returnCount / orderCount * 100
  activeListings: number;
}
