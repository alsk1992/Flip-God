/**
 * BI Export Types - Data structures for BI tool integration
 */

// =============================================================================
// FLAT TABLE SCHEMAS
// =============================================================================

export interface OrderFlat {
  order_id: string;
  order_date: string;
  order_status: string;
  sell_platform: string;
  sell_price: number;
  buy_platform: string;
  buy_price: number | null;
  shipping_cost: number | null;
  platform_fees: number | null;
  profit: number | null;
  profit_margin_pct: number | null;
  product_id: string | null;
  product_title: string | null;
  product_brand: string | null;
  product_category: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
}

export interface InventoryFlat {
  product_id: string;
  product_title: string;
  product_brand: string | null;
  product_category: string | null;
  platform: string;
  current_price: number;
  source_platform: string;
  source_price: number;
  listing_status: string;
  listing_created_at: string;
}

export interface PricingFlat {
  product_id: string;
  product_title: string;
  platform: string;
  price: number;
  shipping: number;
  total_price: number;
  in_stock: boolean;
  seller: string | null;
  fetched_at: string;
}

export interface PerformanceFlat {
  date: string;
  platform: string;
  orders_count: number;
  total_revenue: number;
  total_cost: number;
  total_shipping: number;
  total_fees: number;
  total_profit: number;
  avg_profit_margin: number;
}

// =============================================================================
// EXPORT OPTIONS
// =============================================================================

export type BITableName =
  | 'orders_flat'
  | 'inventory_flat'
  | 'pricing_flat'
  | 'performance_flat'
  | 'all';

export type BIExportFormat = 'csv' | 'jsonl';

export interface BIExportOptions {
  table: BITableName;
  format?: BIExportFormat;
  startDate?: string;
  endDate?: string;
}

// =============================================================================
// DASHBOARD DATA
// =============================================================================

export interface DashboardData {
  period: string;
  summary: {
    totalOrders: number;
    totalRevenue: number;
    totalProfit: number;
    avgProfitMargin: number;
    activeListings: number;
  };
  revenueByPlatform: Record<string, number>;
  profitByPlatform: Record<string, number>;
  ordersByDay: Array<{ date: string; count: number; revenue: number; profit: number }>;
  topProducts: Array<{ productId: string; title: string; orders: number; revenue: number; profit: number }>;
  generatedAt: string;
}

// =============================================================================
// SCHEMA DOCUMENTATION
// =============================================================================

export interface ColumnSchema {
  name: string;
  type: string;
  description: string;
  nullable: boolean;
}

export interface TableSchema {
  tableName: string;
  description: string;
  columns: ColumnSchema[];
  rowEstimate: string;
}
