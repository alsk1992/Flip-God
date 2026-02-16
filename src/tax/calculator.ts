/**
 * Tax Calculator - Sales tax lookup and liability calculation
 *
 * Provides:
 * - US state sales tax rate lookup (from DB or hardcoded fallback)
 * - Tax liability aggregation by state over date ranges
 * - Economic nexus threshold checking
 */

import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import type { SalesTaxRate, TaxLiability, NexusStatus } from './types.js';

const logger = createLogger('tax-calculator');

// =============================================================================
// Hardcoded Fallback Rates (if DB table not yet migrated)
// =============================================================================

const FALLBACK_STATE_RATES: Record<string, SalesTaxRate> = {
  AL: { state: 'Alabama', stateCode: 'AL', rate: 4.00, hasLocalTax: true },
  AK: { state: 'Alaska', stateCode: 'AK', rate: 0.00, hasLocalTax: true },
  AZ: { state: 'Arizona', stateCode: 'AZ', rate: 5.60, hasLocalTax: true },
  AR: { state: 'Arkansas', stateCode: 'AR', rate: 6.50, hasLocalTax: true },
  CA: { state: 'California', stateCode: 'CA', rate: 7.25, hasLocalTax: true },
  CO: { state: 'Colorado', stateCode: 'CO', rate: 2.90, hasLocalTax: true },
  CT: { state: 'Connecticut', stateCode: 'CT', rate: 6.35, hasLocalTax: false },
  DE: { state: 'Delaware', stateCode: 'DE', rate: 0.00, hasLocalTax: false },
  FL: { state: 'Florida', stateCode: 'FL', rate: 6.00, hasLocalTax: true },
  GA: { state: 'Georgia', stateCode: 'GA', rate: 4.00, hasLocalTax: true },
  HI: { state: 'Hawaii', stateCode: 'HI', rate: 4.00, hasLocalTax: true },
  ID: { state: 'Idaho', stateCode: 'ID', rate: 6.00, hasLocalTax: true },
  IL: { state: 'Illinois', stateCode: 'IL', rate: 6.25, hasLocalTax: true },
  IN: { state: 'Indiana', stateCode: 'IN', rate: 7.00, hasLocalTax: false },
  IA: { state: 'Iowa', stateCode: 'IA', rate: 6.00, hasLocalTax: true },
  KS: { state: 'Kansas', stateCode: 'KS', rate: 6.50, hasLocalTax: true },
  KY: { state: 'Kentucky', stateCode: 'KY', rate: 6.00, hasLocalTax: false },
  LA: { state: 'Louisiana', stateCode: 'LA', rate: 4.45, hasLocalTax: true },
  ME: { state: 'Maine', stateCode: 'ME', rate: 5.50, hasLocalTax: false },
  MD: { state: 'Maryland', stateCode: 'MD', rate: 6.00, hasLocalTax: false },
  MA: { state: 'Massachusetts', stateCode: 'MA', rate: 6.25, hasLocalTax: false },
  MI: { state: 'Michigan', stateCode: 'MI', rate: 6.00, hasLocalTax: false },
  MN: { state: 'Minnesota', stateCode: 'MN', rate: 6.875, hasLocalTax: true },
  MS: { state: 'Mississippi', stateCode: 'MS', rate: 7.00, hasLocalTax: false },
  MO: { state: 'Missouri', stateCode: 'MO', rate: 4.225, hasLocalTax: true },
  MT: { state: 'Montana', stateCode: 'MT', rate: 0.00, hasLocalTax: false },
  NE: { state: 'Nebraska', stateCode: 'NE', rate: 5.50, hasLocalTax: true },
  NV: { state: 'Nevada', stateCode: 'NV', rate: 6.85, hasLocalTax: true },
  NH: { state: 'New Hampshire', stateCode: 'NH', rate: 0.00, hasLocalTax: false },
  NJ: { state: 'New Jersey', stateCode: 'NJ', rate: 6.625, hasLocalTax: false },
  NM: { state: 'New Mexico', stateCode: 'NM', rate: 4.875, hasLocalTax: true },
  NY: { state: 'New York', stateCode: 'NY', rate: 4.00, hasLocalTax: true },
  NC: { state: 'North Carolina', stateCode: 'NC', rate: 4.75, hasLocalTax: true },
  ND: { state: 'North Dakota', stateCode: 'ND', rate: 5.00, hasLocalTax: true },
  OH: { state: 'Ohio', stateCode: 'OH', rate: 5.75, hasLocalTax: true },
  OK: { state: 'Oklahoma', stateCode: 'OK', rate: 4.50, hasLocalTax: true },
  OR: { state: 'Oregon', stateCode: 'OR', rate: 0.00, hasLocalTax: false },
  PA: { state: 'Pennsylvania', stateCode: 'PA', rate: 6.00, hasLocalTax: true },
  RI: { state: 'Rhode Island', stateCode: 'RI', rate: 7.00, hasLocalTax: false },
  SC: { state: 'South Carolina', stateCode: 'SC', rate: 6.00, hasLocalTax: true },
  SD: { state: 'South Dakota', stateCode: 'SD', rate: 4.20, hasLocalTax: true },
  TN: { state: 'Tennessee', stateCode: 'TN', rate: 7.00, hasLocalTax: true },
  TX: { state: 'Texas', stateCode: 'TX', rate: 6.25, hasLocalTax: true },
  UT: { state: 'Utah', stateCode: 'UT', rate: 6.10, hasLocalTax: true },
  VT: { state: 'Vermont', stateCode: 'VT', rate: 6.00, hasLocalTax: true },
  VA: { state: 'Virginia', stateCode: 'VA', rate: 5.30, hasLocalTax: true },
  WA: { state: 'Washington', stateCode: 'WA', rate: 6.50, hasLocalTax: true },
  WV: { state: 'West Virginia', stateCode: 'WV', rate: 6.00, hasLocalTax: true },
  WI: { state: 'Wisconsin', stateCode: 'WI', rate: 5.00, hasLocalTax: true },
  WY: { state: 'Wyoming', stateCode: 'WY', rate: 4.00, hasLocalTax: true },
  DC: { state: 'District of Columbia', stateCode: 'DC', rate: 6.00, hasLocalTax: false },
};

/**
 * US state name to state code mapping (case-insensitive lookup).
 * Supports both full names and common abbreviations.
 */
const STATE_NAME_TO_CODE: Record<string, string> = {};
for (const [code, info] of Object.entries(FALLBACK_STATE_RATES)) {
  STATE_NAME_TO_CODE[info.state.toLowerCase()] = code;
  STATE_NAME_TO_CODE[code.toLowerCase()] = code;
}

// =============================================================================
// Tax Rate Lookup
// =============================================================================

/**
 * Look up the state sales tax rate.
 * Tries the DB first (tax_rates table), falls back to hardcoded rates.
 *
 * @param db - Database instance
 * @param state - State code (e.g., 'CA') or state name (e.g., 'California')
 * @returns SalesTaxRate or undefined if state not found
 */
export function getSalesTaxRate(db: Database, state: string): SalesTaxRate | undefined {
  // Normalize to state code
  const stateCode = resolveStateCode(state);
  if (!stateCode) return undefined;

  // Try DB first
  try {
    const rows = db.query<{
      state_code: string;
      state_name: string;
      rate_pct: number;
      has_local_tax: number;
    }>(
      'SELECT state_code, state_name, rate_pct, has_local_tax FROM tax_rates WHERE state_code = ?',
      [stateCode],
    );

    if (rows.length > 0) {
      const row = rows[0];
      return {
        state: row.state_name,
        stateCode: row.state_code,
        rate: row.rate_pct,
        hasLocalTax: Boolean(row.has_local_tax),
      };
    }
  } catch {
    // tax_rates table may not exist yet; fall through to hardcoded
  }

  return FALLBACK_STATE_RATES[stateCode];
}

/** Get all state tax rates (from DB or fallback). */
export function getAllTaxRates(db: Database): SalesTaxRate[] {
  try {
    const rows = db.query<{
      state_code: string;
      state_name: string;
      rate_pct: number;
      has_local_tax: number;
    }>(
      'SELECT state_code, state_name, rate_pct, has_local_tax FROM tax_rates ORDER BY state_code',
    );

    if (rows.length > 0) {
      return rows.map((row) => ({
        state: row.state_name,
        stateCode: row.state_code,
        rate: row.rate_pct,
        hasLocalTax: Boolean(row.has_local_tax),
      }));
    }
  } catch {
    // Fall through
  }

  return Object.values(FALLBACK_STATE_RATES).sort((a, b) =>
    a.stateCode.localeCompare(b.stateCode),
  );
}

/**
 * Calculate sales tax for a given amount in a state.
 *
 * @param db - Database instance
 * @param state - State code or name
 * @param amount - Taxable sale amount
 * @returns Tax amount, or 0 if state not found or has no tax
 */
export function calculateSalesTax(db: Database, state: string, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  const rate = getSalesTaxRate(db, state);
  if (!rate) return 0;

  const tax = (amount * rate.rate) / 100;
  return Math.round(tax * 100) / 100;
}

// =============================================================================
// Tax Liability
// =============================================================================

/**
 * Aggregate tax owed by state for a date range.
 * Sums order amounts by buyer state and applies state tax rates.
 */
export function calculateTaxLiability(
  db: Database,
  options: { startDate?: string; endDate?: string; year?: number },
): TaxLiability[] {
  const { startMs, endMs } = resolveDateRange(options);

  // Query orders grouped by buyer state (extracted from buyer_address)
  // buyer_address format: "Name, Address, City, State ZIP, Country"
  const orders = db.query<{
    buyer_address: string;
    total_sales: number;
    order_count: number;
  }>(
    `SELECT buyer_address, SUM(sell_price) as total_sales, COUNT(*) as order_count
     FROM orders
     WHERE ordered_at >= ? AND ordered_at <= ?
       AND buyer_address IS NOT NULL AND buyer_address != ''
       AND status != 'returned'
     GROUP BY buyer_address`,
    [startMs, endMs],
  );

  // Aggregate by state
  const stateAgg = new Map<string, { totalSales: number; orderCount: number }>();

  for (const order of orders) {
    const stateCode = extractStateFromAddress(order.buyer_address);
    if (!stateCode) continue;

    const existing = stateAgg.get(stateCode) ?? { totalSales: 0, orderCount: 0 };
    existing.totalSales += order.total_sales;
    existing.orderCount += order.order_count;
    stateAgg.set(stateCode, existing);
  }

  // Calculate tax for each state
  const liabilities: TaxLiability[] = [];

  for (const [stateCode, agg] of stateAgg) {
    const rate = getSalesTaxRate(db, stateCode);
    if (!rate) continue;

    const taxOwed = Math.round((agg.totalSales * rate.rate) / 100 * 100) / 100;

    liabilities.push({
      state: rate.state,
      stateCode,
      taxRate: rate.rate,
      totalSales: Math.round(agg.totalSales * 100) / 100,
      taxOwed,
    });
  }

  return liabilities.sort((a, b) => b.totalSales - a.totalSales);
}

// =============================================================================
// Nexus Check
// =============================================================================

/** Default economic nexus thresholds (most states use $100k revenue or 200 transactions). */
const DEFAULT_REVENUE_THRESHOLD = 100_000;
const DEFAULT_TRANSACTION_THRESHOLD = 200;

/** State-specific nexus thresholds that differ from defaults. */
const CUSTOM_NEXUS_THRESHOLDS: Record<string, { revenue: number; transactions: number }> = {
  CA: { revenue: 500_000, transactions: 200 },
  NY: { revenue: 500_000, transactions: 100 },
  TX: { revenue: 500_000, transactions: 200 },
  AL: { revenue: 250_000, transactions: 200 },
};

/**
 * Check if the seller has reached economic nexus thresholds in any US state.
 * Most states trigger nexus at $100k revenue or 200 transactions per year.
 */
export function nexusCheck(
  db: Database,
  options: { year?: number } = {},
): NexusStatus[] {
  const year = options.year ?? new Date().getFullYear();
  const startMs = new Date(`${year}-01-01`).getTime();
  const endMs = new Date(`${year}-12-31T23:59:59.999Z`).getTime();

  // Get orders grouped by state
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
  const stateAgg = new Map<string, { revenue: number; transactions: number }>();

  for (const order of orders) {
    const stateCode = extractStateFromAddress(order.buyer_address);
    if (!stateCode) continue;

    const existing = stateAgg.get(stateCode) ?? { revenue: 0, transactions: 0 };
    const sellPrice = Number.isFinite(order.sell_price) ? order.sell_price : 0;
    existing.revenue += sellPrice;
    existing.transactions += 1;
    stateAgg.set(stateCode, existing);
  }

  // Check against thresholds
  const results: NexusStatus[] = [];

  for (const [stateCode, agg] of stateAgg) {
    const rate = getSalesTaxRate(db, stateCode);
    if (!rate) continue;

    // Skip states with no sales tax
    if (rate.rate <= 0) continue;

    const thresholds = CUSTOM_NEXUS_THRESHOLDS[stateCode] ?? {
      revenue: DEFAULT_REVENUE_THRESHOLD,
      transactions: DEFAULT_TRANSACTION_THRESHOLD,
    };

    const revenueExceeded = agg.revenue >= thresholds.revenue;
    const transactionsExceeded = agg.transactions >= thresholds.transactions;

    results.push({
      state: rate.state,
      stateCode,
      revenueThreshold: thresholds.revenue,
      transactionThreshold: thresholds.transactions,
      currentRevenue: Math.round(agg.revenue * 100) / 100,
      currentTransactions: agg.transactions,
      revenueExceeded,
      transactionsExceeded,
      nexusTriggered: revenueExceeded || transactionsExceeded,
    });
  }

  // Sort: triggered states first, then by revenue descending
  return results.sort((a, b) => {
    if (a.nexusTriggered !== b.nexusTriggered) {
      return a.nexusTriggered ? -1 : 1;
    }
    return b.currentRevenue - a.currentRevenue;
  });
}

// =============================================================================
// Helpers
// =============================================================================

/** Resolve a state input (code or name) to a 2-letter state code. */
function resolveStateCode(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 2) {
    const upper = trimmed.toUpperCase();
    return FALLBACK_STATE_RATES[upper] ? upper : undefined;
  }
  return STATE_NAME_TO_CODE[trimmed.toLowerCase()];
}

/**
 * Extract state code from buyer_address format:
 * "Name, Address, City, State ZIP, Country"
 */
export function extractStateFromAddress(address: string): string | undefined {
  if (!address) return undefined;

  const parts = address.split(',').map((s) => s.trim());
  // State is usually in the 4th part (index 3): "State ZIP"
  if (parts.length >= 4) {
    const stateZipPart = parts[3].trim();
    // Extract state code: could be "CA 90210" or just "CA"
    const match = stateZipPart.match(/^([A-Za-z]{2})\s/);
    if (match) {
      const code = match[1].toUpperCase();
      if (FALLBACK_STATE_RATES[code]) return code;
    }

    // Try full state name match
    const stateOnly = stateZipPart.replace(/\s*\d+.*$/, '').trim();
    const resolved = STATE_NAME_TO_CODE[stateOnly.toLowerCase()];
    if (resolved) return resolved;
  }

  // Fallback: scan all parts for a state code
  for (const part of parts) {
    const trimmed = part.trim();
    // Look for 2-letter state code followed by ZIP
    const match = trimmed.match(/\b([A-Z]{2})\s+\d{5}/);
    if (match) {
      const code = match[1];
      if (FALLBACK_STATE_RATES[code]) return code;
    }
  }

  return undefined;
}

/** Resolve date range from options. Returns start/end as epoch ms. */
function resolveDateRange(options: {
  startDate?: string;
  endDate?: string;
  year?: number;
}): { startMs: number; endMs: number } {
  if (options.year) {
    return {
      startMs: new Date(`${options.year}-01-01`).getTime(),
      endMs: new Date(`${options.year}-12-31T23:59:59.999Z`).getTime(),
    };
  }

  const now = new Date();
  const startMs = options.startDate
    ? new Date(options.startDate).getTime()
    : new Date(now.getFullYear(), 0, 1).getTime();
  const endMs = options.endDate
    ? new Date(options.endDate + 'T23:59:59.999Z').getTime()
    : now.getTime();

  return { startMs, endMs };
}
