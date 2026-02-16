/**
 * Tax & Compliance Types
 */

// =============================================================================
// SALES TAX
// =============================================================================

export interface SalesTaxRate {
  state: string;
  stateCode: string;
  rate: number;
  hasLocalTax: boolean;
}

export interface StateTaxSummary {
  state: string;
  stateCode: string;
  taxRate: number;
  totalSales: number;
  taxableAmount: number;
  taxOwed: number;
  orderCount: number;
}

export interface SalesTaxReport {
  startDate: string;
  endDate: string;
  states: StateTaxSummary[];
  totalSales: number;
  totalTaxOwed: number;
  totalOrders: number;
}

// =============================================================================
// NEXUS
// =============================================================================

export interface NexusStatus {
  state: string;
  stateCode: string;
  revenueThreshold: number;
  transactionThreshold: number;
  currentRevenue: number;
  currentTransactions: number;
  revenueExceeded: boolean;
  transactionsExceeded: boolean;
  nexusTriggered: boolean;
}

// =============================================================================
// INCOME REPORT
// =============================================================================

export interface MonthlyBreakdown {
  month: number;
  monthName: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  shippingCosts: number;
  platformFees: number;
  otherExpenses: number;
  netIncome: number;
  orderCount: number;
}

export interface IncomeReport {
  year: number;
  quarter?: number;
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: {
    shipping: number;
    platformFees: number;
    advertising: number;
    supplies: number;
    software: number;
    other: number;
    total: number;
  };
  netIncome: number;
  orderCount: number;
  monthlyBreakdown?: MonthlyBreakdown[];
}

// =============================================================================
// EXPENSES
// =============================================================================

export type ExpenseCategory =
  | 'shipping'
  | 'platform_fees'
  | 'advertising'
  | 'supplies'
  | 'software'
  | 'other';

export interface ExpenseEntry {
  category: ExpenseCategory;
  amount: number;
  description?: string;
  date: string;
  platform?: string;
}

export interface ExpenseReport {
  year: number;
  category: ExpenseCategory | 'all';
  totalExpenses: number;
  breakdown: Record<ExpenseCategory, number>;
  entries: ExpenseEntry[];
}

// =============================================================================
// 1099 PREP
// =============================================================================

export interface Platform1099 {
  platform: string;
  grossPayments: number;
  transactionCount: number;
  refunds: number;
  netPayments: number;
  meetsThreshold: boolean;
}

export interface Report1099 {
  year: number;
  platforms: Platform1099[];
  totalGrossPayments: number;
  totalTransactions: number;
}

// =============================================================================
// OPTIONS
// =============================================================================

export interface TaxReportOptions {
  startDate?: string;
  endDate?: string;
  year?: number;
  quarter?: number;
}

export interface TaxLiability {
  state: string;
  stateCode: string;
  taxRate: number;
  totalSales: number;
  taxOwed: number;
}
