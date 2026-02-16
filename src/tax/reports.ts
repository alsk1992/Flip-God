/**
 * Tax Reports - Generate various tax and financial reports
 *
 * Reports:
 * - Sales tax report: tax collected/owed by state for a date range
 * - Income report: P&L summary for tax filing (revenue, COGS, expenses, net)
 * - 1099-K report: gross payment amounts by platform
 * - Expense report: categorized expense breakdown
 */

import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import type {
  SalesTaxReport,
  StateTaxSummary,
  IncomeReport,
  MonthlyBreakdown,
  ExpenseReport,
  ExpenseCategory,
  ExpenseEntry,
  Report1099,
  Platform1099,
  TaxReportOptions,
} from './types.js';
import { getSalesTaxRate, getAllTaxRates, extractStateFromAddress } from './calculator.js';

const logger = createLogger('tax-reports');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// =============================================================================
// Sales Tax Report
// =============================================================================

/**
 * Generate a sales tax report by state for a date range.
 * Shows total sales, taxable amount, and estimated tax owed per state.
 */
export function generateSalesTaxReport(
  db: Database,
  options: TaxReportOptions = {},
): SalesTaxReport {
  const { startMs, endMs, startDate, endDate } = resolveDateRange(options);

  logger.info({ startDate, endDate }, 'Generating sales tax report');

  // Get all completed orders in the date range
  const orders = db.query<{
    buyer_address: string;
    sell_price: number;
  }>(
    `SELECT buyer_address, sell_price
     FROM orders
     WHERE ordered_at >= ? AND ordered_at <= ?
       AND buyer_address IS NOT NULL AND buyer_address != ''
       AND status != 'returned'`,
    [startMs, endMs],
  );

  // Aggregate by state
  const stateAgg = new Map<string, { totalSales: number; orderCount: number }>();

  for (const order of orders) {
    const stateCode = extractStateFromAddress(order.buyer_address);
    if (!stateCode) continue;

    const existing = stateAgg.get(stateCode) ?? { totalSales: 0, orderCount: 0 };
    const sellPrice = Number.isFinite(order.sell_price) ? order.sell_price : 0;
    existing.totalSales += sellPrice;
    existing.orderCount += 1;
    stateAgg.set(stateCode, existing);
  }

  // Build state summaries
  const states: StateTaxSummary[] = [];
  let totalSales = 0;
  let totalTaxOwed = 0;
  let totalOrders = 0;

  for (const [stateCode, agg] of stateAgg) {
    const rate = getSalesTaxRate(db, stateCode);
    if (!rate) continue;

    const taxOwed = Math.round((agg.totalSales * rate.rate) / 100 * 100) / 100;
    const roundedSales = Math.round(agg.totalSales * 100) / 100;

    states.push({
      state: rate.state,
      stateCode,
      taxRate: rate.rate,
      totalSales: roundedSales,
      taxableAmount: roundedSales, // Simplified: all sales are taxable
      taxOwed,
      orderCount: agg.orderCount,
    });

    totalSales += roundedSales;
    totalTaxOwed += taxOwed;
    totalOrders += agg.orderCount;
  }

  // Sort by tax owed descending
  states.sort((a, b) => b.taxOwed - a.taxOwed);

  return {
    startDate,
    endDate,
    states,
    totalSales: Math.round(totalSales * 100) / 100,
    totalTaxOwed: Math.round(totalTaxOwed * 100) / 100,
    totalOrders,
  };
}

// =============================================================================
// Income Report
// =============================================================================

/**
 * Generate a profit/loss income report for tax filing.
 * Calculates revenue, COGS, gross profit, expenses, and net income.
 */
export function generateIncomeReport(
  db: Database,
  options: { year: number; quarter?: number; includeMonthly?: boolean },
): IncomeReport {
  const { year, quarter, includeMonthly } = options;

  let startMs: number;
  let endMs: number;

  if (quarter) {
    const startMonth = (quarter - 1) * 3;
    startMs = new Date(year, startMonth, 1).getTime();
    endMs = new Date(year, startMonth + 3, 0, 23, 59, 59, 999).getTime();
  } else {
    startMs = new Date(`${year}-01-01`).getTime();
    endMs = new Date(`${year}-12-31T23:59:59.999Z`).getTime();
  }

  logger.info({ year, quarter }, 'Generating income report');

  // Get all orders in the period
  const orders = db.query<{
    sell_price: number;
    buy_price: number | null;
    shipping_cost: number | null;
    platform_fees: number | null;
    profit: number | null;
    ordered_at: number;
    sell_platform: string;
  }>(
    `SELECT sell_price, buy_price, shipping_cost, platform_fees, profit, ordered_at, sell_platform
     FROM orders
     WHERE ordered_at >= ? AND ordered_at <= ?
       AND status != 'returned'`,
    [startMs, endMs],
  );

  // Calculate totals
  let revenue = 0;
  let cogs = 0;
  let shippingCosts = 0;
  let platformFees = 0;

  // Monthly tracking
  const monthlyData = new Map<number, {
    revenue: number;
    cogs: number;
    shippingCosts: number;
    platformFees: number;
    orderCount: number;
  }>();

  for (const order of orders) {
    const sellPrice = Number.isFinite(order.sell_price) ? order.sell_price : 0;
    const buyPrice = Number.isFinite(order.buy_price) ? order.buy_price! : 0;
    const shipping = Number.isFinite(order.shipping_cost) ? order.shipping_cost! : 0;
    const fees = Number.isFinite(order.platform_fees) ? order.platform_fees! : 0;

    revenue += sellPrice;
    cogs += buyPrice;
    shippingCosts += shipping;
    platformFees += fees;

    // Track monthly
    if (includeMonthly !== false) {
      const orderDate = new Date(order.ordered_at);
      const month = orderDate.getMonth(); // 0-indexed
      const existing = monthlyData.get(month) ?? {
        revenue: 0,
        cogs: 0,
        shippingCosts: 0,
        platformFees: 0,
        orderCount: 0,
      };
      existing.revenue += sellPrice;
      existing.cogs += buyPrice;
      existing.shippingCosts += shipping;
      existing.platformFees += fees;
      existing.orderCount += 1;
      monthlyData.set(month, existing);
    }
  }

  const grossProfit = revenue - cogs;
  const totalExpenses = shippingCosts + platformFees;
  const netIncome = grossProfit - totalExpenses;

  // Build monthly breakdown
  let monthlyBreakdown: MonthlyBreakdown[] | undefined;
  if (includeMonthly !== false) {
    const startMonth = quarter ? (quarter - 1) * 3 : 0;
    const endMonth = quarter ? startMonth + 3 : 12;

    monthlyBreakdown = [];
    for (let m = startMonth; m < endMonth; m++) {
      const data = monthlyData.get(m);
      const mRevenue = data?.revenue ?? 0;
      const mCogs = data?.cogs ?? 0;
      const mGross = mRevenue - mCogs;
      const mShipping = data?.shippingCosts ?? 0;
      const mFees = data?.platformFees ?? 0;

      monthlyBreakdown.push({
        month: m + 1,
        monthName: MONTH_NAMES[m],
        revenue: round2(mRevenue),
        cogs: round2(mCogs),
        grossProfit: round2(mGross),
        shippingCosts: round2(mShipping),
        platformFees: round2(mFees),
        otherExpenses: 0,
        netIncome: round2(mGross - mShipping - mFees),
        orderCount: data?.orderCount ?? 0,
      });
    }
  }

  return {
    year,
    quarter,
    revenue: round2(revenue),
    cogs: round2(cogs),
    grossProfit: round2(grossProfit),
    expenses: {
      shipping: round2(shippingCosts),
      platformFees: round2(platformFees),
      advertising: 0, // Not tracked in orders table
      supplies: 0,
      software: 0,
      other: 0,
      total: round2(totalExpenses),
    },
    netIncome: round2(netIncome),
    orderCount: orders.length,
    monthlyBreakdown,
  };
}

// =============================================================================
// 1099-K Report
// =============================================================================

/**
 * Prepare 1099-K data for tax filing.
 * Aggregates gross payment amounts by platform for the year.
 *
 * 1099-K reporting threshold: $600 for 2024+ (was $20,000 / 200 transactions prior).
 */
export function generate1099Report(db: Database, year: number): Report1099 {
  const startMs = new Date(`${year}-01-01`).getTime();
  const endMs = new Date(`${year}-12-31T23:59:59.999Z`).getTime();

  logger.info({ year }, 'Generating 1099-K report');

  // Get gross payments by sell platform
  const rows = db.query<{
    sell_platform: string;
    gross_payments: number;
    transaction_count: number;
  }>(
    `SELECT sell_platform,
            SUM(sell_price) as gross_payments,
            COUNT(*) as transaction_count
     FROM orders
     WHERE ordered_at >= ? AND ordered_at <= ?
       AND status != 'returned'
     GROUP BY sell_platform`,
    [startMs, endMs],
  );

  // Get refunds/returns by platform
  const refundRows = db.query<{
    sell_platform: string;
    refund_total: number;
  }>(
    `SELECT sell_platform,
            SUM(sell_price) as refund_total
     FROM orders
     WHERE ordered_at >= ? AND ordered_at <= ?
       AND status = 'returned'
     GROUP BY sell_platform`,
    [startMs, endMs],
  );

  const refundMap = new Map<string, number>();
  for (const row of refundRows) {
    const refund = Number.isFinite(row.refund_total) ? row.refund_total : 0;
    refundMap.set(row.sell_platform, refund);
  }

  const platforms: Platform1099[] = [];
  let totalGross = 0;
  let totalTransactions = 0;

  for (const row of rows) {
    const gross = Number.isFinite(row.gross_payments) ? row.gross_payments : 0;
    const refunds = refundMap.get(row.sell_platform) ?? 0;
    const net = gross - refunds;

    platforms.push({
      platform: row.sell_platform,
      grossPayments: round2(gross),
      transactionCount: row.transaction_count,
      refunds: round2(refunds),
      netPayments: round2(net),
      meetsThreshold: gross >= 600, // 2024+ threshold
    });

    totalGross += gross;
    totalTransactions += row.transaction_count;
  }

  platforms.sort((a, b) => b.grossPayments - a.grossPayments);

  return {
    year,
    platforms,
    totalGrossPayments: round2(totalGross),
    totalTransactions,
  };
}

// =============================================================================
// Expense Report
// =============================================================================

/**
 * Generate a categorized expense report.
 * Pulls data from orders table (shipping, platform fees) and
 * categorizes known expense types.
 */
export function generateExpenseReport(
  db: Database,
  options: { year: number; category?: ExpenseCategory | 'all' },
): ExpenseReport {
  const { year, category } = options;
  const startMs = new Date(`${year}-01-01`).getTime();
  const endMs = new Date(`${year}-12-31T23:59:59.999Z`).getTime();

  logger.info({ year, category }, 'Generating expense report');

  const filterCategory = category ?? 'all';

  // Aggregate shipping costs
  let shippingTotal = 0;
  let platformFeesTotal = 0;

  const orders = db.query<{
    shipping_cost: number | null;
    platform_fees: number | null;
    sell_platform: string;
    ordered_at: number;
  }>(
    `SELECT shipping_cost, platform_fees, sell_platform, ordered_at
     FROM orders
     WHERE ordered_at >= ? AND ordered_at <= ?
       AND status != 'returned'`,
    [startMs, endMs],
  );

  const entries: ExpenseEntry[] = [];

  for (const order of orders) {
    const shipping = Number.isFinite(order.shipping_cost) ? order.shipping_cost! : 0;
    const fees = Number.isFinite(order.platform_fees) ? order.platform_fees! : 0;
    const orderDate = new Date(order.ordered_at).toISOString().slice(0, 10);

    if (shipping > 0) {
      shippingTotal += shipping;
      if (filterCategory === 'all' || filterCategory === 'shipping') {
        entries.push({
          category: 'shipping',
          amount: round2(shipping),
          description: `Shipping cost (${order.sell_platform})`,
          date: orderDate,
          platform: order.sell_platform,
        });
      }
    }

    if (fees > 0) {
      platformFeesTotal += fees;
      if (filterCategory === 'all' || filterCategory === 'platform_fees') {
        entries.push({
          category: 'platform_fees',
          amount: round2(fees),
          description: `Platform fees (${order.sell_platform})`,
          date: orderDate,
          platform: order.sell_platform,
        });
      }
    }
  }

  const breakdown: Record<ExpenseCategory, number> = {
    shipping: round2(shippingTotal),
    platform_fees: round2(platformFeesTotal),
    advertising: 0,
    supplies: 0,
    software: 0,
    other: 0,
  };

  const totalExpenses = Object.values(breakdown).reduce((sum, val) => sum + val, 0);

  // Sort entries by date descending
  entries.sort((a, b) => b.date.localeCompare(a.date));

  return {
    year,
    category: filterCategory,
    totalExpenses: round2(totalExpenses),
    breakdown,
    entries,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/** Round to 2 decimal places. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Resolve date range from options, returning ms timestamps and formatted dates. */
function resolveDateRange(options: TaxReportOptions): {
  startMs: number;
  endMs: number;
  startDate: string;
  endDate: string;
} {
  if (options.year) {
    const startDate = `${options.year}-01-01`;
    const endDate = `${options.year}-12-31`;
    return {
      startMs: new Date(startDate).getTime(),
      endMs: new Date(endDate + 'T23:59:59.999Z').getTime(),
      startDate,
      endDate,
    };
  }

  const now = new Date();
  const startDate = options.startDate ?? `${now.getFullYear()}-01-01`;
  const endDate = options.endDate ?? now.toISOString().slice(0, 10);

  return {
    startMs: new Date(startDate).getTime(),
    endMs: new Date(endDate + 'T23:59:59.999Z').getTime(),
    startDate,
    endDate,
  };
}
