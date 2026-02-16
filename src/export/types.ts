/**
 * Accounting Export Types
 */

// =============================================================================
// EXPORT OPTIONS
// =============================================================================

export interface DateRangeOptions {
  startDate?: string;
  endDate?: string;
}

export interface QuickBooksExportOptions extends DateRangeOptions {
  type?: 'invoices' | 'expenses' | 'both';
}

export interface XeroExportOptions extends DateRangeOptions {}

export interface GenericExportOptions extends DateRangeOptions {
  platform?: string;
  format?: 'csv' | 'excel_xml';
}

export interface ProfitLossOptions {
  period?: 'monthly' | 'quarterly' | 'yearly';
  year?: number;
  quarter?: 1 | 2 | 3 | 4;
}

export interface BalanceSheetOptions {
  asOfDate?: string;
}

// =============================================================================
// REPORT DATA
// =============================================================================

export interface ProfitLossStatement {
  period: string;
  startDate: string;
  endDate: string;
  revenue: {
    grossSales: number;
    grossSalesByPlatform: Record<string, number>;
    refunds: number;
    netRevenue: number;
  };
  cogs: {
    productCosts: number;
    shippingCosts: number;
    totalCOGS: number;
  };
  grossProfit: number;
  operatingExpenses: {
    platformFees: number;
    advertising: number;
    supplies: number;
    software: number;
    other: number;
    totalExpenses: number;
  };
  netIncome: number;
  generatedAt: string;
}

export interface BalanceSheet {
  asOfDate: string;
  assets: {
    inventoryValue: number;
    accountsReceivable: number;
    totalAssets: number;
  };
  liabilities: {
    estimatedTaxOwed: number;
    pendingRefunds: number;
    totalLiabilities: number;
  };
  equity: number;
  generatedAt: string;
}

export interface CSVOptions {
  delimiter?: string;
  quoteChar?: string;
  includeHeader?: boolean;
}

export interface ExcelSheet {
  name: string;
  headers: string[];
  rows: Array<Array<string | number | null>>;
}
