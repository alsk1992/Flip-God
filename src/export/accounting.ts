/**
 * Accounting Export - QuickBooks, Xero, P&L, Balance Sheet
 *
 * Generates CSV exports in formats compatible with major accounting tools,
 * plus financial statements derived from the FlipAgent database.
 */

import type { Database } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { generateCSV, formatCurrency, formatDate, round2 } from './formats.js';
import type {
  QuickBooksExportOptions,
  XeroExportOptions,
  GenericExportOptions,
  ProfitLossOptions,
  BalanceSheetOptions,
  ProfitLossStatement,
  BalanceSheet,
} from './types.js';

const logger = createLogger('accounting-export');

// =============================================================================
// HELPERS
// =============================================================================

interface OrderRow {
  id: string;
  listing_id: string;
  sell_platform: string;
  sell_order_id: string | null;
  sell_price: number;
  buy_platform: string;
  buy_order_id: string | null;
  buy_price: number | null;
  shipping_cost: number | null;
  platform_fees: number | null;
  profit: number | null;
  status: string;
  buyer_address: string | null;
  tracking_number: string | null;
  ordered_at: number;
  shipped_at: number | null;
  delivered_at: number | null;
}

interface ListingRow {
  id: string;
  product_id: string;
  platform: string;
  title: string | null;
  price: number;
  source_platform: string;
  source_price: number;
  status: string;
}

function parseDateRange(
  startDate?: string,
  endDate?: string,
): { startMs: number; endMs: number } {
  const now = Date.now();
  // Default: last 30 days
  let startMs = now - 30 * 24 * 60 * 60 * 1000;
  let endMs = now;

  if (startDate) {
    const parsed = new Date(startDate).getTime();
    if (Number.isFinite(parsed)) {
      startMs = parsed;
    }
  }

  if (endDate) {
    const parsed = new Date(endDate).getTime();
    if (Number.isFinite(parsed)) {
      endMs = parsed;
    }
  }

  return { startMs, endMs };
}

function getOrdersInRange(
  db: Database,
  startMs: number,
  endMs: number,
): OrderRow[] {
  return db.query<OrderRow>(
    `SELECT id, listing_id, sell_platform, sell_order_id, sell_price,
            buy_platform, buy_order_id, buy_price, shipping_cost,
            platform_fees, profit, status, buyer_address, tracking_number,
            ordered_at, shipped_at, delivered_at
     FROM orders
     WHERE ordered_at >= ? AND ordered_at <= ?
     ORDER BY ordered_at ASC`,
    [startMs, endMs],
  );
}

// =============================================================================
// QUICKBOOKS CSV EXPORT
// =============================================================================

/**
 * Export transactions in QuickBooks-compatible CSV format.
 */
export function exportToQuickBooksCSV(
  db: Database,
  options: QuickBooksExportOptions = {},
): { invoicesCSV?: string; expensesCSV?: string } {
  const { startMs, endMs } = parseDateRange(options.startDate, options.endDate);
  const orders = getOrdersInRange(db, startMs, endMs);
  const exportType = options.type ?? 'both';

  const result: { invoicesCSV?: string; expensesCSV?: string } = {};

  // Invoice format (sales)
  if (exportType === 'invoices' || exportType === 'both') {
    const invoiceHeaders = [
      'Date', 'Invoice No', 'Customer', 'Item', 'Description',
      'Quantity', 'Rate', 'Amount', 'Tax',
    ];

    const invoiceRows: Array<Array<string | number | null>> = [];

    for (const order of orders) {
      // Look up listing for product info
      const listings = db.query<ListingRow>(
        'SELECT id, product_id, platform, title, price, source_platform, source_price, status FROM listings WHERE id = ?',
        [order.listing_id],
      );
      const listing = listings[0];
      const title = listing?.title ?? 'Product';

      invoiceRows.push([
        formatDate(order.ordered_at, 'us'),
        order.sell_order_id ?? order.id,
        order.buyer_address ?? 'Customer',
        title,
        `${order.sell_platform} sale`,
        1,
        round2(order.sell_price),
        round2(order.sell_price),
        0, // Tax placeholder
      ]);
    }

    result.invoicesCSV = generateCSV(invoiceHeaders, invoiceRows);
    logger.debug({ rows: invoiceRows.length }, 'QuickBooks invoices CSV generated');
  }

  // Expense format (purchases/costs)
  if (exportType === 'expenses' || exportType === 'both') {
    const expenseHeaders = ['Date', 'Payee', 'Account', 'Amount', 'Memo'];
    const expenseRows: Array<Array<string | number | null>> = [];

    for (const order of orders) {
      const buyPrice = order.buy_price ?? 0;
      const shippingCost = order.shipping_cost ?? 0;
      const platformFees = order.platform_fees ?? 0;

      // Product cost
      if (Number.isFinite(buyPrice) && buyPrice > 0) {
        expenseRows.push([
          formatDate(order.ordered_at, 'us'),
          order.buy_platform,
          'Cost of Goods Sold',
          round2(buyPrice),
          `Purchase for order ${order.id}`,
        ]);
      }

      // Shipping cost
      if (Number.isFinite(shippingCost) && shippingCost > 0) {
        expenseRows.push([
          formatDate(order.ordered_at, 'us'),
          'Shipping',
          'Shipping Expense',
          round2(shippingCost),
          `Shipping for order ${order.id}`,
        ]);
      }

      // Platform fees
      if (Number.isFinite(platformFees) && platformFees > 0) {
        expenseRows.push([
          formatDate(order.ordered_at, 'us'),
          order.sell_platform,
          'Platform Fees',
          round2(platformFees),
          `${order.sell_platform} fees for order ${order.id}`,
        ]);
      }
    }

    result.expensesCSV = generateCSV(expenseHeaders, expenseRows);
    logger.debug({ rows: expenseRows.length }, 'QuickBooks expenses CSV generated');
  }

  return result;
}

// =============================================================================
// XERO CSV EXPORT
// =============================================================================

/**
 * Export transactions in Xero-compatible CSV format.
 */
export function exportToXeroCSV(
  db: Database,
  options: XeroExportOptions = {},
): string {
  const { startMs, endMs } = parseDateRange(options.startDate, options.endDate);
  const orders = getOrdersInRange(db, startMs, endMs);

  const headers = [
    'ContactName', 'EmailAddress', 'InvoiceNumber', 'InvoiceDate',
    'DueDate', 'Total', 'TaxAmount',
  ];

  const rows: Array<Array<string | number | null>> = [];

  for (const order of orders) {
    const invoiceDate = formatDate(order.ordered_at, 'us');
    // Due date = 30 days after invoice
    const dueDate = formatDate(order.ordered_at + 30 * 24 * 60 * 60 * 1000, 'us');

    rows.push([
      order.buyer_address ?? 'Customer',
      '', // email not tracked
      order.sell_order_id ?? order.id,
      invoiceDate,
      dueDate,
      round2(order.sell_price),
      0, // tax placeholder
    ]);
  }

  logger.debug({ rows: rows.length }, 'Xero CSV generated');
  return generateCSV(headers, rows);
}

// =============================================================================
// GENERIC CSV EXPORT
// =============================================================================

/**
 * Export all transactions as a standard accounting CSV.
 */
export function exportToGenericCSV(
  db: Database,
  options: GenericExportOptions = {},
): string {
  const { startMs, endMs } = parseDateRange(options.startDate, options.endDate);

  let query = `
    SELECT o.id, o.listing_id, o.sell_platform, o.sell_order_id, o.sell_price,
           o.buy_platform, o.buy_order_id, o.buy_price, o.shipping_cost,
           o.platform_fees, o.profit, o.status, o.buyer_address,
           o.tracking_number, o.ordered_at, o.shipped_at, o.delivered_at
    FROM orders o
    WHERE o.ordered_at >= ? AND o.ordered_at <= ?
  `;
  const params: Array<string | number> = [startMs, endMs];

  if (options.platform) {
    query += ' AND (o.sell_platform = ? OR o.buy_platform = ?)';
    params.push(options.platform, options.platform);
  }

  query += ' ORDER BY o.ordered_at ASC';

  const orders = db.query<OrderRow>(query, params);

  const headers = [
    'Order ID', 'Date', 'Status',
    'Sell Platform', 'Sell Price', 'Buy Platform', 'Buy Price',
    'Shipping Cost', 'Platform Fees', 'Profit',
    'Tracking Number',
  ];

  const rows: Array<Array<string | number | null>> = orders.map((o) => [
    o.id,
    formatDate(o.ordered_at, 'iso'),
    o.status,
    o.sell_platform,
    round2(o.sell_price),
    o.buy_platform,
    o.buy_price !== null ? round2(o.buy_price) : null,
    o.shipping_cost !== null ? round2(o.shipping_cost) : null,
    o.platform_fees !== null ? round2(o.platform_fees) : null,
    o.profit !== null ? round2(o.profit) : null,
    o.tracking_number,
  ]);

  logger.debug({ rows: rows.length }, 'Generic CSV generated');
  return generateCSV(headers, rows);
}

// =============================================================================
// PROFIT & LOSS STATEMENT
// =============================================================================

/**
 * Generate a formatted Profit & Loss statement.
 */
export function exportProfitLossStatement(
  db: Database,
  options: ProfitLossOptions = {},
): ProfitLossStatement {
  const period = options.period ?? 'monthly';
  const year = options.year ?? new Date().getFullYear();
  const quarter = options.quarter;

  let startDate: Date;
  let endDate: Date;
  let periodLabel: string;

  if (period === 'quarterly' && quarter) {
    const qStart = (quarter - 1) * 3;
    startDate = new Date(year, qStart, 1);
    endDate = new Date(year, qStart + 3, 0, 23, 59, 59, 999);
    periodLabel = `Q${quarter} ${year}`;
  } else if (period === 'yearly') {
    startDate = new Date(year, 0, 1);
    endDate = new Date(year, 11, 31, 23, 59, 59, 999);
    periodLabel = `FY ${year}`;
  } else {
    // Monthly: current month of given year or most recent month
    const now = new Date();
    const month = year === now.getFullYear() ? now.getMonth() : 0;
    startDate = new Date(year, month, 1);
    endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);
    periodLabel = `${startDate.toLocaleString('en-US', { month: 'long' })} ${year}`;
  }

  const startMs = startDate.getTime();
  const endMs = endDate.getTime();
  const orders = getOrdersInRange(db, startMs, endMs);

  // Revenue
  let grossSales = 0;
  const grossSalesByPlatform: Record<string, number> = {};
  let refunds = 0;

  // COGS
  let productCosts = 0;
  let shippingCosts = 0;

  // Operating expenses
  let platformFees = 0;

  for (const order of orders) {
    const sellPrice = Number.isFinite(order.sell_price) ? order.sell_price : 0;
    const buyPrice = Number.isFinite(order.buy_price ?? NaN) ? (order.buy_price ?? 0) : 0;
    const shipping = Number.isFinite(order.shipping_cost ?? NaN) ? (order.shipping_cost ?? 0) : 0;
    const fees = Number.isFinite(order.platform_fees ?? NaN) ? (order.platform_fees ?? 0) : 0;

    if (order.status === 'refunded' || order.status === 'returned') {
      refunds += sellPrice;
      continue;
    }

    grossSales += sellPrice;
    grossSalesByPlatform[order.sell_platform] =
      (grossSalesByPlatform[order.sell_platform] ?? 0) + sellPrice;

    productCosts += buyPrice;
    shippingCosts += shipping;
    platformFees += fees;
  }

  const netRevenue = grossSales - refunds;
  const totalCOGS = productCosts + shippingCosts;
  const grossProfit = netRevenue - totalCOGS;
  const totalExpenses = platformFees; // advertising, supplies, software tracked separately
  const netIncome = grossProfit - totalExpenses;

  return {
    period: periodLabel,
    startDate: formatDate(startDate, 'iso'),
    endDate: formatDate(endDate, 'iso'),
    revenue: {
      grossSales: round2(grossSales),
      grossSalesByPlatform: Object.fromEntries(
        Object.entries(grossSalesByPlatform).map(([k, v]) => [k, round2(v)]),
      ),
      refunds: round2(refunds),
      netRevenue: round2(netRevenue),
    },
    cogs: {
      productCosts: round2(productCosts),
      shippingCosts: round2(shippingCosts),
      totalCOGS: round2(totalCOGS),
    },
    grossProfit: round2(grossProfit),
    operatingExpenses: {
      platformFees: round2(platformFees),
      advertising: 0,
      supplies: 0,
      software: 0,
      other: 0,
      totalExpenses: round2(totalExpenses),
    },
    netIncome: round2(netIncome),
    generatedAt: new Date().toISOString(),
  };
}

// =============================================================================
// BALANCE SHEET
// =============================================================================

/**
 * Generate a simplified balance sheet as of a given date.
 */
export function exportBalanceSheet(
  db: Database,
  options: BalanceSheetOptions = {},
): BalanceSheet {
  const asOfDate = options.asOfDate
    ? new Date(options.asOfDate)
    : new Date();

  if (isNaN(asOfDate.getTime())) {
    throw new Error('Invalid as_of_date');
  }

  const asOfMs = asOfDate.getTime();

  // Assets: Inventory value (cost basis of active listings)
  const inventoryRows = db.query<{ total: number }>(
    `SELECT COALESCE(SUM(source_price), 0) as total
     FROM listings
     WHERE status = 'active' AND created_at <= ?`,
    [asOfMs],
  );
  const inventoryValue = round2(inventoryRows[0]?.total ?? 0);

  // Assets: Accounts receivable (pending orders not yet paid out)
  const arRows = db.query<{ total: number }>(
    `SELECT COALESCE(SUM(sell_price), 0) as total
     FROM orders
     WHERE status IN ('pending', 'shipped') AND ordered_at <= ?`,
    [asOfMs],
  );
  const accountsReceivable = round2(arRows[0]?.total ?? 0);

  const totalAssets = round2(inventoryValue + accountsReceivable);

  // Liabilities: estimated tax owed (~15% of net profit as a rough estimate)
  const profitRows = db.query<{ total: number }>(
    `SELECT COALESCE(SUM(profit), 0) as total
     FROM orders
     WHERE status = 'delivered' AND ordered_at <= ?`,
    [asOfMs],
  );
  const totalProfit = profitRows[0]?.total ?? 0;
  const estimatedTaxOwed = round2(
    Number.isFinite(totalProfit) ? Math.max(0, totalProfit * 0.15) : 0,
  );

  // Liabilities: pending refunds
  const refundRows = db.query<{ total: number }>(
    `SELECT COALESCE(SUM(sell_price), 0) as total
     FROM orders
     WHERE status = 'refunded' AND ordered_at <= ?`,
    [asOfMs],
  );
  const pendingRefunds = round2(refundRows[0]?.total ?? 0);

  const totalLiabilities = round2(estimatedTaxOwed + pendingRefunds);
  const equity = round2(totalAssets - totalLiabilities);

  return {
    asOfDate: formatDate(asOfDate, 'iso'),
    assets: {
      inventoryValue,
      accountsReceivable,
      totalAssets,
    },
    liabilities: {
      estimatedTaxOwed,
      pendingRefunds,
      totalLiabilities,
    },
    equity,
    generatedAt: new Date().toISOString(),
  };
}
