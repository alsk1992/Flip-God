/**
 * Accounting P&L Report - Profit/Loss statements, SKU profitability,
 * tax summaries, monthly trends, cash flow, and CSV/QuickBooks exports.
 *
 * All data is sourced from existing DB tables: orders, listings, products,
 * cogs_records, returns, opportunities. No new migrations required.
 */

import type { Database } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { generateCSV, formatCurrency, formatDate, round2 } from '../export/formats.js';

const logger = createLogger('pnl-report');

// =============================================================================
// TYPES
// =============================================================================

export interface PLReport {
  periodStart: number;
  periodEnd: number;
  periodLabel: string;
  revenue: PLSection;
  costOfGoods: PLSection;
  grossProfit: number;
  grossMarginPct: number;
  expenses: PLSection;
  netProfit: number;
  netMarginPct: number;
  summary: PLSummary;
}

export interface PLSection {
  total: number;
  breakdown: PLLineItem[];
}

export interface PLLineItem {
  label: string;
  amount: number;
  count?: number;
  pctOfRevenue?: number;
}

export interface PLSummary {
  totalOrders: number;
  avgOrderValue: number;
  avgProfitPerOrder: number;
  topProfitableProducts: { productId: string; name: string; profit: number; units: number }[];
  topLossProducts: { productId: string; name: string; loss: number; units: number }[];
  profitByPlatform: { platform: string; revenue: number; profit: number; orders: number }[];
  profitByCategory: { category: string; revenue: number; profit: number; orders: number }[];
}

export interface SKUProfitability {
  sku: string;
  productName: string;
  unitsSold: number;
  revenue: number;
  cogs: number;
  platformFees: number;
  shippingCost: number;
  otherCosts: number;
  grossProfit: number;
  grossMarginPct: number;
  roi: number;
}

export interface TaxSummary {
  period: string;
  totalRevenue: number;
  totalCOGS: number;
  totalExpenses: number;
  taxableIncome: number;
  estimatedTax: number;
  quarterlyPayment: number;
}

export interface MonthlyTrend {
  month: string;
  revenue: number;
  cogs: number;
  profit: number;
  margin: number;
  orders: number;
}

export interface CashFlowSummary {
  periodStart: number;
  periodEnd: number;
  periodLabel: string;
  inflows: CashFlowSection;
  outflows: CashFlowSection;
  netCashFlow: number;
}

interface CashFlowSection {
  total: number;
  breakdown: PLLineItem[];
}

// =============================================================================
// INTERNAL ROW TYPES
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
  ordered_at: number;
}

interface ListingRow {
  id: string;
  product_id: string;
  platform: string;
  title: string | null;
  price: number;
  source_platform: string;
  source_price: number;
}

interface ProductRow {
  id: string;
  title: string;
  category: string | null;
}

interface COGSRow {
  product_id: string;
  unit_cost: number;
  quantity: number;
  shipping_cost: number | null;
  import_duty: number | null;
  other_costs: number | null;
}

interface ReturnRow {
  order_id: string;
  refund_amount: number | null;
  status: string;
}

// =============================================================================
// HELPERS
// =============================================================================

/** Safe division — returns 0 when divisor is 0 or non-finite. */
function safeDiv(numerator: number, denominator: number): number {
  if (!denominator || !Number.isFinite(denominator)) return 0;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : 0;
}

/** Default platform fee rates when orders.platform_fees is NULL. */
const DEFAULT_FEE_RATES: Record<string, number> = {
  ebay: 0.13,
  amazon: 0.15,
  walmart: 0.12,
  mercari: 0.10,
  poshmark: 0.20,
  etsy: 0.065,
};

function estimatePlatformFee(sellPrice: number, platform: string): number {
  const rate = DEFAULT_FEE_RATES[platform.toLowerCase()] ?? 0.13;
  return round2(sellPrice * rate);
}

function parseDateRange(
  startDate?: string | number,
  endDate?: string | number,
): { startMs: number; endMs: number } {
  const now = Date.now();
  let startMs = now - 30 * 24 * 60 * 60 * 1000;
  let endMs = now;

  if (startDate != null) {
    const parsed = typeof startDate === 'number' ? startDate : new Date(startDate).getTime();
    if (Number.isFinite(parsed)) startMs = parsed;
  }

  if (endDate != null) {
    const parsed = typeof endDate === 'number' ? endDate : new Date(endDate).getTime();
    if (Number.isFinite(parsed)) endMs = parsed;
  }

  return { startMs, endMs };
}

function buildPeriodLabel(startMs: number, endMs: number): string {
  const s = new Date(startMs);
  const e = new Date(endMs);
  return `${s.toISOString().slice(0, 10)} to ${e.toISOString().slice(0, 10)}`;
}

function getOrdersInRange(db: Database, startMs: number, endMs: number): OrderRow[] {
  return db.query<OrderRow>(
    `SELECT id, listing_id, sell_platform, sell_order_id, sell_price,
            buy_platform, buy_order_id, buy_price, shipping_cost,
            platform_fees, profit, status, ordered_at
     FROM orders
     WHERE ordered_at >= ? AND ordered_at <= ?
       AND status NOT IN ('cancelled')
     ORDER BY ordered_at ASC`,
    [startMs, endMs],
  );
}

function getReturnsInRange(db: Database, startMs: number, endMs: number): ReturnRow[] {
  try {
    return db.query<ReturnRow>(
      `SELECT order_id, refund_amount, status
       FROM returns
       WHERE created_at >= ? AND created_at <= ?`,
      [startMs, endMs],
    );
  } catch {
    // Table may not exist if migration hasn't run
    return [];
  }
}

function getCOGSForProduct(db: Database, productId: string): COGSRow | null {
  try {
    const rows = db.query<COGSRow>(
      `SELECT product_id, unit_cost, quantity,
              shipping_cost, import_duty, other_costs
       FROM cogs_records
       WHERE product_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
      [productId],
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

function getListingForOrder(db: Database, listingId: string): ListingRow | null {
  const rows = db.query<ListingRow>(
    `SELECT id, product_id, platform, title, price, source_platform, source_price
     FROM listings WHERE id = ?`,
    [listingId],
  );
  return rows[0] ?? null;
}

function getProduct(db: Database, productId: string): ProductRow | null {
  const rows = db.query<ProductRow>(
    `SELECT id, title, category FROM products WHERE id = ?`,
    [productId],
  );
  return rows[0] ?? null;
}

// =============================================================================
// GENERATE P&L REPORT
// =============================================================================

/**
 * Generate a full P&L report for the given date range.
 *
 * Revenue comes from the orders table (sell_price). COGS come from
 * cogs_records when available, falling back to the order's buy_price or
 * the listing's source_price. Expenses are broken out into platform fees,
 * shipping, and returns/refunds.
 */
export function generatePLReport(
  db: Database,
  startDate?: string | number,
  endDate?: string | number,
): PLReport {
  const { startMs, endMs } = parseDateRange(startDate, endDate);
  const orders = getOrdersInRange(db, startMs, endMs);
  const returns = getReturnsInRange(db, startMs, endMs);

  logger.info(
    { orderCount: orders.length, period: buildPeriodLabel(startMs, endMs) },
    'Generating P&L report',
  );

  // ---- Revenue ----
  const revenueByPlatform: Record<string, { amount: number; count: number }> = {};
  let totalRevenue = 0;

  for (const order of orders) {
    const price = order.sell_price ?? 0;
    totalRevenue += price;
    const plat = order.sell_platform || 'unknown';
    if (!revenueByPlatform[plat]) revenueByPlatform[plat] = { amount: 0, count: 0 };
    revenueByPlatform[plat].amount += price;
    revenueByPlatform[plat].count += 1;
  }

  const revenueBreakdown: PLLineItem[] = Object.entries(revenueByPlatform).map(
    ([platform, data]) => ({
      label: `${platform} sales`,
      amount: round2(data.amount),
      count: data.count,
      pctOfRevenue: round2(safeDiv(data.amount, totalRevenue) * 100),
    }),
  );

  totalRevenue = round2(totalRevenue);

  // ---- COGS ----
  let totalCOGS = 0;
  const cogsBySource: Record<string, { amount: number; count: number }> = {};

  // Track per-product aggregation for summary
  const productProfit: Record<
    string,
    {
      productId: string;
      name: string;
      revenue: number;
      cogs: number;
      fees: number;
      shipping: number;
      units: number;
      category: string;
    }
  > = {};

  for (const order of orders) {
    const listing = getListingForOrder(db, order.listing_id);
    const productId = listing?.product_id ?? order.listing_id;
    const product = listing ? getProduct(db, productId) : null;
    const productName = product?.title ?? listing?.title ?? 'Unknown Product';
    const category = product?.category ?? 'Uncategorized';

    // Determine unit COGS
    let unitCost = 0;
    let cogsSource = 'estimated';

    const cogsRecord = getCOGSForProduct(db, productId);
    if (cogsRecord) {
      unitCost =
        cogsRecord.unit_cost +
        (cogsRecord.shipping_cost ?? 0) +
        (cogsRecord.import_duty ?? 0) +
        (cogsRecord.other_costs ?? 0);
      cogsSource = 'cogs_records';
    } else if (order.buy_price != null && order.buy_price > 0) {
      unitCost = order.buy_price;
      cogsSource = 'order_buy_price';
    } else if (listing) {
      unitCost = listing.source_price;
      cogsSource = 'listing_source_price';
    }

    totalCOGS += unitCost;

    if (!cogsBySource[cogsSource]) cogsBySource[cogsSource] = { amount: 0, count: 0 };
    cogsBySource[cogsSource].amount += unitCost;
    cogsBySource[cogsSource].count += 1;

    // Per-product tracking
    const fees =
      order.platform_fees ?? estimatePlatformFee(order.sell_price, order.sell_platform);
    const shipping = order.shipping_cost ?? 0;

    if (!productProfit[productId]) {
      productProfit[productId] = {
        productId,
        name: productName,
        revenue: 0,
        cogs: 0,
        fees: 0,
        shipping: 0,
        units: 0,
        category,
      };
    }
    productProfit[productId].revenue += order.sell_price;
    productProfit[productId].cogs += unitCost;
    productProfit[productId].fees += fees;
    productProfit[productId].shipping += shipping;
    productProfit[productId].units += 1;
  }

  totalCOGS = round2(totalCOGS);

  const cogsBreakdown: PLLineItem[] = Object.entries(cogsBySource).map(([source, data]) => ({
    label: `Cost of goods (${source.replace(/_/g, ' ')})`,
    amount: round2(data.amount),
    count: data.count,
    pctOfRevenue: round2(safeDiv(data.amount, totalRevenue) * 100),
  }));

  // ---- Expenses ----
  let totalPlatformFees = 0;
  let totalShipping = 0;

  for (const order of orders) {
    totalPlatformFees +=
      order.platform_fees ?? estimatePlatformFee(order.sell_price, order.sell_platform);
    totalShipping += order.shipping_cost ?? 0;
  }

  // Returns / refunds
  let totalRefunds = 0;
  let refundCount = 0;
  for (const ret of returns) {
    totalRefunds += ret.refund_amount ?? 0;
    refundCount += 1;
  }

  // Also count orders with refunded status in the period
  const refundedOrders = orders.filter((o) => o.status === 'refunded');
  for (const order of refundedOrders) {
    totalRefunds += order.sell_price;
    refundCount += 1;
  }

  totalPlatformFees = round2(totalPlatformFees);
  totalShipping = round2(totalShipping);
  totalRefunds = round2(totalRefunds);

  const totalExpenses = round2(totalPlatformFees + totalShipping + totalRefunds);

  const expensesBreakdown: PLLineItem[] = [
    {
      label: 'Platform fees',
      amount: totalPlatformFees,
      pctOfRevenue: round2(safeDiv(totalPlatformFees, totalRevenue) * 100),
    },
    {
      label: 'Shipping costs',
      amount: totalShipping,
      pctOfRevenue: round2(safeDiv(totalShipping, totalRevenue) * 100),
    },
    {
      label: 'Returns & refunds',
      amount: totalRefunds,
      count: refundCount,
      pctOfRevenue: round2(safeDiv(totalRefunds, totalRevenue) * 100),
    },
  ];

  // ---- Profit calculations ----
  const grossProfit = round2(totalRevenue - totalCOGS);
  const grossMarginPct = round2(safeDiv(grossProfit, totalRevenue) * 100);
  const netProfit = round2(grossProfit - totalExpenses);
  const netMarginPct = round2(safeDiv(netProfit, totalRevenue) * 100);

  // ---- Summary ----
  const productEntries = Object.values(productProfit);

  // Top profitable products
  const sortedByProfit = [...productEntries]
    .map((p) => ({
      ...p,
      netProfit: round2(p.revenue - p.cogs - p.fees - p.shipping),
    }))
    .sort((a, b) => b.netProfit - a.netProfit);

  const topProfitable = sortedByProfit
    .filter((p) => p.netProfit > 0)
    .slice(0, 10)
    .map((p) => ({
      productId: p.productId,
      name: p.name,
      profit: p.netProfit,
      units: p.units,
    }));

  const topLoss = sortedByProfit
    .filter((p) => p.netProfit < 0)
    .sort((a, b) => a.netProfit - b.netProfit)
    .slice(0, 10)
    .map((p) => ({
      productId: p.productId,
      name: p.name,
      loss: round2(Math.abs(p.netProfit)),
      units: p.units,
    }));

  // By platform
  const platformMap: Record<string, { revenue: number; profit: number; orders: number }> = {};
  for (const order of orders) {
    const plat = order.sell_platform || 'unknown';
    if (!platformMap[plat]) platformMap[plat] = { revenue: 0, profit: 0, orders: 0 };
    platformMap[plat].revenue += order.sell_price;
    platformMap[plat].orders += 1;

    const listing = getListingForOrder(db, order.listing_id);
    const pid = listing?.product_id ?? order.listing_id;
    const pp = productProfit[pid];
    if (pp && pp.units > 0) {
      // Per-order share of that product's profit
      const perUnit = (pp.revenue - pp.cogs - pp.fees - pp.shipping) / pp.units;
      platformMap[plat].profit += perUnit;
    }
  }

  const profitByPlatform = Object.entries(platformMap).map(([platform, data]) => ({
    platform,
    revenue: round2(data.revenue),
    profit: round2(data.profit),
    orders: data.orders,
  }));

  // By category
  const categoryMap: Record<string, { revenue: number; profit: number; orders: number }> = {};
  for (const p of productEntries) {
    const cat = p.category || 'Uncategorized';
    if (!categoryMap[cat]) categoryMap[cat] = { revenue: 0, profit: 0, orders: 0 };
    categoryMap[cat].revenue += p.revenue;
    categoryMap[cat].profit += p.revenue - p.cogs - p.fees - p.shipping;
    categoryMap[cat].orders += p.units;
  }

  const profitByCategory = Object.entries(categoryMap).map(([category, data]) => ({
    category,
    revenue: round2(data.revenue),
    profit: round2(data.profit),
    orders: data.orders,
  }));

  const totalOrders = orders.length;

  const report: PLReport = {
    periodStart: startMs,
    periodEnd: endMs,
    periodLabel: buildPeriodLabel(startMs, endMs),
    revenue: { total: totalRevenue, breakdown: revenueBreakdown },
    costOfGoods: { total: totalCOGS, breakdown: cogsBreakdown },
    grossProfit,
    grossMarginPct,
    expenses: { total: totalExpenses, breakdown: expensesBreakdown },
    netProfit,
    netMarginPct,
    summary: {
      totalOrders,
      avgOrderValue: round2(safeDiv(totalRevenue, totalOrders)),
      avgProfitPerOrder: round2(safeDiv(netProfit, totalOrders)),
      topProfitableProducts: topProfitable,
      topLossProducts: topLoss,
      profitByPlatform,
      profitByCategory,
    },
  };

  logger.info(
    { revenue: totalRevenue, cogs: totalCOGS, netProfit, orders: totalOrders },
    'P&L report generated',
  );

  return report;
}

// =============================================================================
// SKU PROFITABILITY
// =============================================================================

/**
 * Per-SKU profitability breakdown for a date range.
 * Returns data sorted by gross profit descending.
 */
export function generateSKUProfitability(
  db: Database,
  startDate?: string | number,
  endDate?: string | number,
  limit: number = 100,
): SKUProfitability[] {
  const { startMs, endMs } = parseDateRange(startDate, endDate);
  const orders = getOrdersInRange(db, startMs, endMs);

  logger.info({ orderCount: orders.length }, 'Generating SKU profitability');

  const skuMap: Record<
    string,
    {
      sku: string;
      productName: string;
      unitsSold: number;
      revenue: number;
      cogs: number;
      platformFees: number;
      shippingCost: number;
      otherCosts: number;
    }
  > = {};

  for (const order of orders) {
    const listing = getListingForOrder(db, order.listing_id);
    const productId = listing?.product_id ?? order.listing_id;
    const product = listing ? getProduct(db, productId) : null;
    const productName = product?.title ?? listing?.title ?? 'Unknown';

    if (!skuMap[productId]) {
      skuMap[productId] = {
        sku: productId,
        productName,
        unitsSold: 0,
        revenue: 0,
        cogs: 0,
        platformFees: 0,
        shippingCost: 0,
        otherCosts: 0,
      };
    }

    const entry = skuMap[productId];
    entry.unitsSold += 1;
    entry.revenue += order.sell_price;

    // COGS
    const cogsRecord = getCOGSForProduct(db, productId);
    if (cogsRecord) {
      entry.cogs += cogsRecord.unit_cost;
      entry.otherCosts += (cogsRecord.import_duty ?? 0) + (cogsRecord.other_costs ?? 0);
      // COGS shipping is sourcing cost, separate from fulfillment shipping
      entry.shippingCost += cogsRecord.shipping_cost ?? 0;
    } else if (order.buy_price != null && order.buy_price > 0) {
      entry.cogs += order.buy_price;
    } else if (listing) {
      entry.cogs += listing.source_price;
    }

    // Fees & fulfillment shipping from order
    entry.platformFees +=
      order.platform_fees ?? estimatePlatformFee(order.sell_price, order.sell_platform);
    entry.shippingCost += order.shipping_cost ?? 0;
  }

  const results: SKUProfitability[] = Object.values(skuMap).map((entry) => {
    const totalCost =
      entry.cogs + entry.platformFees + entry.shippingCost + entry.otherCosts;
    const grossProfit = round2(entry.revenue - totalCost);
    return {
      sku: entry.sku,
      productName: entry.productName,
      unitsSold: entry.unitsSold,
      revenue: round2(entry.revenue),
      cogs: round2(entry.cogs),
      platformFees: round2(entry.platformFees),
      shippingCost: round2(entry.shippingCost),
      otherCosts: round2(entry.otherCosts),
      grossProfit,
      grossMarginPct: round2(safeDiv(grossProfit, entry.revenue) * 100),
      roi: round2(safeDiv(grossProfit, entry.cogs) * 100),
    };
  });

  results.sort((a, b) => b.grossProfit - a.grossProfit);

  const safeLimit = Math.max(1, Math.min(limit, 10000));
  return results.slice(0, safeLimit);
}

// =============================================================================
// TAX SUMMARY
// =============================================================================

/**
 * Generate quarterly tax summary for a given year.
 * Uses a configurable estimated tax rate (default 25%).
 */
export function generateTaxSummary(
  db: Database,
  year?: number,
  taxRate: number = 0.25,
): TaxSummary[] {
  const targetYear = year ?? new Date().getFullYear();
  const safeTaxRate = Math.max(0, Math.min(taxRate, 1));
  const quarters: TaxSummary[] = [];

  for (let q = 1; q <= 4; q++) {
    const startMonth = (q - 1) * 3; // 0, 3, 6, 9
    const endMonth = startMonth + 3;

    const startMs = new Date(targetYear, startMonth, 1).getTime();
    // Last ms of last day in quarter
    const endMs = new Date(targetYear, endMonth, 0, 23, 59, 59, 999).getTime();

    const report = generatePLReport(db, startMs, endMs);

    const taxableIncome = Math.max(0, report.netProfit);
    const estimatedTax = round2(taxableIncome * safeTaxRate);

    quarters.push({
      period: `Q${q} ${targetYear}`,
      totalRevenue: report.revenue.total,
      totalCOGS: report.costOfGoods.total,
      totalExpenses: report.expenses.total,
      taxableIncome: round2(taxableIncome),
      estimatedTax,
      quarterlyPayment: round2(estimatedTax),
    });
  }

  logger.info({ year: targetYear, taxRate: safeTaxRate }, 'Tax summary generated');

  return quarters;
}

// =============================================================================
// MONTHLY TREND
// =============================================================================

/**
 * Monthly P&L trend for the last N months.
 */
export function generateMonthlyTrend(
  db: Database,
  months: number = 12,
): MonthlyTrend[] {
  const safeMonths = Math.max(1, Math.min(months, 120));
  const now = new Date();
  const results: MonthlyTrend[] = [];

  for (let i = safeMonths - 1; i >= 0; i--) {
    const year = now.getFullYear();
    const month = now.getMonth() - i;

    // new Date handles negative months by rolling back the year
    const d = new Date(year, month, 1);
    const startMs = d.getTime();
    const endMs = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime();

    const report = generatePLReport(db, startMs, endMs);

    const monthLabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    results.push({
      month: monthLabel,
      revenue: report.revenue.total,
      cogs: report.costOfGoods.total,
      profit: report.netProfit,
      margin: report.netMarginPct,
      orders: report.summary.totalOrders,
    });
  }

  logger.info({ months: results.length }, 'Monthly trend generated');

  return results;
}

// =============================================================================
// CASH FLOW SUMMARY
// =============================================================================

/**
 * Cash inflows and outflows for a date range.
 */
export function generateCashFlowSummary(
  db: Database,
  startDate?: string | number,
  endDate?: string | number,
): CashFlowSummary {
  const { startMs, endMs } = parseDateRange(startDate, endDate);
  const orders = getOrdersInRange(db, startMs, endMs);
  const returns = getReturnsInRange(db, startMs, endMs);

  logger.info({ orderCount: orders.length }, 'Generating cash flow summary');

  // ---- Inflows ----
  let salesRevenue = 0;
  for (const order of orders) {
    salesRevenue += order.sell_price;
  }
  salesRevenue = round2(salesRevenue);

  const inflowBreakdown: PLLineItem[] = [
    {
      label: 'Sales revenue',
      amount: salesRevenue,
      count: orders.length,
    },
  ];

  const totalInflows = salesRevenue;

  // ---- Outflows ----
  let inventoryPurchases = 0;
  let platformFees = 0;
  let shippingCosts = 0;
  let refunds = 0;

  for (const order of orders) {
    const listing = getListingForOrder(db, order.listing_id);
    const productId = listing?.product_id ?? order.listing_id;

    const cogsRecord = getCOGSForProduct(db, productId);
    if (cogsRecord) {
      inventoryPurchases +=
        cogsRecord.unit_cost +
        (cogsRecord.shipping_cost ?? 0) +
        (cogsRecord.import_duty ?? 0) +
        (cogsRecord.other_costs ?? 0);
    } else if (order.buy_price != null && order.buy_price > 0) {
      inventoryPurchases += order.buy_price;
    } else if (listing) {
      inventoryPurchases += listing.source_price;
    }

    platformFees +=
      order.platform_fees ?? estimatePlatformFee(order.sell_price, order.sell_platform);
    shippingCosts += order.shipping_cost ?? 0;
  }

  for (const ret of returns) {
    refunds += ret.refund_amount ?? 0;
  }

  // Refunded orders
  const refundedOrders = orders.filter((o) => o.status === 'refunded');
  for (const order of refundedOrders) {
    refunds += order.sell_price;
  }

  inventoryPurchases = round2(inventoryPurchases);
  platformFees = round2(platformFees);
  shippingCosts = round2(shippingCosts);
  refunds = round2(refunds);

  const totalOutflows = round2(inventoryPurchases + platformFees + shippingCosts + refunds);

  const outflowBreakdown: PLLineItem[] = [
    { label: 'Inventory purchases', amount: inventoryPurchases },
    { label: 'Platform fees', amount: platformFees },
    { label: 'Shipping costs', amount: shippingCosts },
    { label: 'Returns & refunds', amount: refunds },
  ];

  const netCashFlow = round2(totalInflows - totalOutflows);

  return {
    periodStart: startMs,
    periodEnd: endMs,
    periodLabel: buildPeriodLabel(startMs, endMs),
    inflows: { total: round2(totalInflows), breakdown: inflowBreakdown },
    outflows: { total: totalOutflows, breakdown: outflowBreakdown },
    netCashFlow,
  };
}

// =============================================================================
// CSV EXPORTS
// =============================================================================

/**
 * Export a PLReport as a CSV string suitable for QuickBooks or Excel.
 */
export function exportPLToCSV(report: PLReport): string {
  const headers = ['Category', 'Line Item', 'Amount', 'Count', '% of Revenue'];
  const rows: Array<Array<string | number | null>> = [];

  // Title
  rows.push(['PROFIT & LOSS STATEMENT', report.periodLabel, '', '', '']);
  rows.push(['', '', '', '', '']);

  // Revenue
  rows.push([
    'REVENUE',
    '',
    report.revenue.total,
    '',
    '100.00',
  ]);
  for (const item of report.revenue.breakdown) {
    rows.push(['', item.label, item.amount, item.count ?? '', item.pctOfRevenue ?? '']);
  }
  rows.push(['', '', '', '', '']);

  // COGS
  rows.push([
    'COST OF GOODS SOLD',
    '',
    report.costOfGoods.total,
    '',
    round2(safeDiv(report.costOfGoods.total, report.revenue.total) * 100),
  ]);
  for (const item of report.costOfGoods.breakdown) {
    rows.push(['', item.label, item.amount, item.count ?? '', item.pctOfRevenue ?? '']);
  }
  rows.push(['', '', '', '', '']);

  // Gross Profit
  rows.push(['GROSS PROFIT', '', report.grossProfit, '', report.grossMarginPct]);
  rows.push(['', '', '', '', '']);

  // Expenses
  rows.push([
    'OPERATING EXPENSES',
    '',
    report.expenses.total,
    '',
    round2(safeDiv(report.expenses.total, report.revenue.total) * 100),
  ]);
  for (const item of report.expenses.breakdown) {
    rows.push(['', item.label, item.amount, item.count ?? '', item.pctOfRevenue ?? '']);
  }
  rows.push(['', '', '', '', '']);

  // Net Profit
  rows.push(['NET PROFIT', '', report.netProfit, '', report.netMarginPct]);

  return generateCSV(headers, rows);
}

/**
 * Export SKU profitability data as CSV.
 */
export function exportSKUProfitToCSV(skuData: SKUProfitability[]): string {
  const headers = [
    'SKU',
    'Product Name',
    'Units Sold',
    'Revenue',
    'COGS',
    'Platform Fees',
    'Shipping Cost',
    'Other Costs',
    'Gross Profit',
    'Gross Margin %',
    'ROI %',
  ];

  const rows: Array<Array<string | number>> = skuData.map((s) => [
    s.sku,
    s.productName,
    s.unitsSold,
    s.revenue,
    s.cogs,
    s.platformFees,
    s.shippingCost,
    s.otherCosts,
    s.grossProfit,
    s.grossMarginPct,
    s.roi,
  ]);

  return generateCSV(headers, rows);
}

/**
 * Export transactions in QuickBooks-compatible journal entry format.
 *
 * Columns: Date, Transaction Type, Num, Name, Memo, Account, Debit, Credit
 *
 * Account mappings:
 * - Sales            -> Income:Sales (Credit)
 * - COGS             -> COGS:Inventory (Debit) / Inventory Asset (Credit)
 * - Platform fees    -> Expense:Platform Fees (Debit) / Accounts Receivable (Credit)
 * - Shipping         -> Expense:Shipping (Debit) / Cash (Credit)
 * - Cash received    -> Accounts Receivable (Debit) / Income:Sales (Credit)
 */
export function exportToQuickBooksCSV(
  db: Database,
  startDate?: string | number,
  endDate?: string | number,
): string {
  const { startMs, endMs } = parseDateRange(startDate, endDate);
  const orders = getOrdersInRange(db, startMs, endMs);

  const headers = [
    'Date',
    'Transaction Type',
    'Num',
    'Name',
    'Memo',
    'Account',
    'Debit',
    'Credit',
  ];
  const rows: Array<Array<string | number>> = [];

  for (const order of orders) {
    const dateStr = formatDate(order.ordered_at, 'us');
    const ref = order.sell_order_id ?? order.id;
    const listing = getListingForOrder(db, order.listing_id);
    const productId = listing?.product_id ?? order.listing_id;
    const product = listing ? getProduct(db, productId) : null;
    const name = product?.title ?? listing?.title ?? 'Product';
    const platform = order.sell_platform || 'unknown';
    const memo = `${platform} sale - ${name}`;

    const sellPrice = round2(order.sell_price);

    // Determine COGS
    let unitCost = 0;
    const cogsRecord = getCOGSForProduct(db, productId);
    if (cogsRecord) {
      unitCost =
        cogsRecord.unit_cost +
        (cogsRecord.shipping_cost ?? 0) +
        (cogsRecord.import_duty ?? 0) +
        (cogsRecord.other_costs ?? 0);
    } else if (order.buy_price != null && order.buy_price > 0) {
      unitCost = order.buy_price;
    } else if (listing) {
      unitCost = listing.source_price;
    }
    unitCost = round2(unitCost);

    const fees = round2(
      order.platform_fees ?? estimatePlatformFee(order.sell_price, order.sell_platform),
    );
    const shipping = round2(order.shipping_cost ?? 0);

    // Revenue entry (Credit to Income:Sales)
    rows.push([dateStr, 'Journal', ref, name, memo, 'Income:Sales', '', sellPrice]);

    // Accounts Receivable (Debit — cash coming in)
    rows.push([
      dateStr,
      'Journal',
      ref,
      name,
      memo,
      'Accounts Receivable',
      sellPrice,
      '',
    ]);

    // COGS entry (Debit to COGS:Inventory, Credit to Inventory Asset)
    if (unitCost > 0) {
      rows.push([
        dateStr,
        'Journal',
        ref,
        name,
        `COGS - ${memo}`,
        'COGS:Inventory',
        unitCost,
        '',
      ]);
      rows.push([
        dateStr,
        'Journal',
        ref,
        name,
        `COGS - ${memo}`,
        'Inventory Asset',
        '',
        unitCost,
      ]);
    }

    // Platform fees (Debit to Expense:Platform Fees)
    if (fees > 0) {
      rows.push([
        dateStr,
        'Journal',
        ref,
        name,
        `Fees - ${memo}`,
        'Expense:Platform Fees',
        fees,
        '',
      ]);
      rows.push([
        dateStr,
        'Journal',
        ref,
        name,
        `Fees - ${memo}`,
        'Accounts Receivable',
        '',
        fees,
      ]);
    }

    // Shipping (Debit to Expense:Shipping)
    if (shipping > 0) {
      rows.push([
        dateStr,
        'Journal',
        ref,
        name,
        `Shipping - ${memo}`,
        'Expense:Shipping',
        shipping,
        '',
      ]);
      rows.push([
        dateStr,
        'Journal',
        ref,
        name,
        `Shipping - ${memo}`,
        'Cash',
        '',
        shipping,
      ]);
    }
  }

  return generateCSV(headers, rows);
}
