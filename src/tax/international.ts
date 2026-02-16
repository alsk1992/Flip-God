/**
 * International Tax Compliance Module
 *
 * Provides VAT calculation for EU cross-border sales, GST for AU/NZ/CA/IN,
 * import duty estimation by HS code, and VAT reporting.
 */

import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import type {
  VatRate,
  VatCalculation,
  VatReport,
  VatReportEntry,
  GstCalculation,
  ImportDutyEstimate,
  HsCodeInfo,
} from './international-types.js';

const logger = createLogger('international-tax');

// =============================================================================
// EU VAT Standard Rates (2025)
// =============================================================================

const EU_VAT_RATES: Record<string, VatRate> = {
  AT: { country: 'Austria', countryCode: 'AT', standardRate: 20, reducedRate: 10, superReducedRate: null, parkingRate: 13 },
  BE: { country: 'Belgium', countryCode: 'BE', standardRate: 21, reducedRate: 6, superReducedRate: null, parkingRate: 12 },
  BG: { country: 'Bulgaria', countryCode: 'BG', standardRate: 20, reducedRate: 9, superReducedRate: null, parkingRate: null },
  HR: { country: 'Croatia', countryCode: 'HR', standardRate: 25, reducedRate: 5, superReducedRate: null, parkingRate: 13 },
  CY: { country: 'Cyprus', countryCode: 'CY', standardRate: 19, reducedRate: 5, superReducedRate: null, parkingRate: null },
  CZ: { country: 'Czech Republic', countryCode: 'CZ', standardRate: 21, reducedRate: 12, superReducedRate: null, parkingRate: null },
  DK: { country: 'Denmark', countryCode: 'DK', standardRate: 25, reducedRate: 0, superReducedRate: null, parkingRate: null },
  EE: { country: 'Estonia', countryCode: 'EE', standardRate: 22, reducedRate: 9, superReducedRate: null, parkingRate: null },
  FI: { country: 'Finland', countryCode: 'FI', standardRate: 25.5, reducedRate: 10, superReducedRate: null, parkingRate: null },
  FR: { country: 'France', countryCode: 'FR', standardRate: 20, reducedRate: 5.5, superReducedRate: 2.1, parkingRate: null },
  DE: { country: 'Germany', countryCode: 'DE', standardRate: 19, reducedRate: 7, superReducedRate: null, parkingRate: null },
  GR: { country: 'Greece', countryCode: 'GR', standardRate: 24, reducedRate: 6, superReducedRate: null, parkingRate: null },
  HU: { country: 'Hungary', countryCode: 'HU', standardRate: 27, reducedRate: 5, superReducedRate: null, parkingRate: null },
  IE: { country: 'Ireland', countryCode: 'IE', standardRate: 23, reducedRate: 9, superReducedRate: 4.8, parkingRate: 13.5 },
  IT: { country: 'Italy', countryCode: 'IT', standardRate: 22, reducedRate: 5, superReducedRate: 4, parkingRate: null },
  LV: { country: 'Latvia', countryCode: 'LV', standardRate: 21, reducedRate: 12, superReducedRate: null, parkingRate: null },
  LT: { country: 'Lithuania', countryCode: 'LT', standardRate: 21, reducedRate: 9, superReducedRate: null, parkingRate: null },
  LU: { country: 'Luxembourg', countryCode: 'LU', standardRate: 17, reducedRate: 8, superReducedRate: 3, parkingRate: 14 },
  MT: { country: 'Malta', countryCode: 'MT', standardRate: 18, reducedRate: 5, superReducedRate: null, parkingRate: null },
  NL: { country: 'Netherlands', countryCode: 'NL', standardRate: 21, reducedRate: 9, superReducedRate: null, parkingRate: null },
  PL: { country: 'Poland', countryCode: 'PL', standardRate: 23, reducedRate: 8, superReducedRate: null, parkingRate: null },
  PT: { country: 'Portugal', countryCode: 'PT', standardRate: 23, reducedRate: 6, superReducedRate: null, parkingRate: 13 },
  RO: { country: 'Romania', countryCode: 'RO', standardRate: 19, reducedRate: 9, superReducedRate: null, parkingRate: null },
  SK: { country: 'Slovakia', countryCode: 'SK', standardRate: 23, reducedRate: 10, superReducedRate: null, parkingRate: null },
  SI: { country: 'Slovenia', countryCode: 'SI', standardRate: 22, reducedRate: 9.5, superReducedRate: null, parkingRate: null },
  ES: { country: 'Spain', countryCode: 'ES', standardRate: 21, reducedRate: 10, superReducedRate: 4, parkingRate: null },
  SE: { country: 'Sweden', countryCode: 'SE', standardRate: 25, reducedRate: 6, superReducedRate: null, parkingRate: null },
};

// EU One-Stop Shop (OSS) threshold: EUR 10,000 total cross-border B2C sales
const OSS_THRESHOLD_EUR = 10_000;

// =============================================================================
// GST Rates
// =============================================================================

const GST_RATES: Record<string, { rate: number; country: string; lowValueThreshold: number }> = {
  AU: { rate: 10, country: 'Australia', lowValueThreshold: 1000 },
  NZ: { rate: 15, country: 'New Zealand', lowValueThreshold: 1000 },
  CA: { rate: 5, country: 'Canada', lowValueThreshold: 20 },
  IN: { rate: 18, country: 'India', lowValueThreshold: 0 },
};

// Canadian provincial sales taxes
const CA_HST_RATES: Record<string, number> = {
  ON: 13, NB: 15, NS: 15, PE: 15, NL: 15,
};
const CA_PST_RATES: Record<string, number> = {
  BC: 7, SK: 6, MB: 7, QC: 9.975,
};

// =============================================================================
// Import Duty Data
// =============================================================================

// De minimis thresholds by country (below this, no duty)
const DE_MINIMIS: Record<string, { threshold: number; currency: string }> = {
  US: { threshold: 800, currency: 'USD' },
  CA: { threshold: 20, currency: 'CAD' },
  AU: { threshold: 1000, currency: 'AUD' },
  GB: { threshold: 135, currency: 'GBP' },
  EU: { threshold: 150, currency: 'EUR' },
  NZ: { threshold: 1000, currency: 'NZD' },
  JP: { threshold: 10000, currency: 'JPY' },
  CN: { threshold: 50, currency: 'CNY' },
};

// Common HS code chapters with typical duty rates
const HS_CODE_DATA: Record<string, HsCodeInfo> = {
  '61': { code: '61', description: 'Knitted or crocheted clothing', chapter: 'Textiles & Apparel', defaultDutyRate: 12 },
  '62': { code: '62', description: 'Non-knitted clothing', chapter: 'Textiles & Apparel', defaultDutyRate: 12 },
  '63': { code: '63', description: 'Textile articles (bedding, curtains)', chapter: 'Textiles & Apparel', defaultDutyRate: 8 },
  '64': { code: '64', description: 'Footwear', chapter: 'Footwear', defaultDutyRate: 10 },
  '71': { code: '71', description: 'Jewelry and precious metals', chapter: 'Jewelry', defaultDutyRate: 6.5 },
  '84': { code: '84', description: 'Machinery and mechanical appliances', chapter: 'Machinery', defaultDutyRate: 3 },
  '85': { code: '85', description: 'Electrical machinery and electronics', chapter: 'Electronics', defaultDutyRate: 2.5 },
  '87': { code: '87', description: 'Vehicles and parts', chapter: 'Automotive', defaultDutyRate: 2.5 },
  '90': { code: '90', description: 'Optical, photographic, medical instruments', chapter: 'Instruments', defaultDutyRate: 3.5 },
  '91': { code: '91', description: 'Clocks and watches', chapter: 'Watches', defaultDutyRate: 4.6 },
  '94': { code: '94', description: 'Furniture, lamps, prefab buildings', chapter: 'Furniture', defaultDutyRate: 3.2 },
  '95': { code: '95', description: 'Toys, games, sporting goods', chapter: 'Toys & Games', defaultDutyRate: 0 },
  '96': { code: '96', description: 'Miscellaneous manufactured articles', chapter: 'Miscellaneous', defaultDutyRate: 3.9 },
  '42': { code: '42', description: 'Leather articles, handbags, travel goods', chapter: 'Leather', defaultDutyRate: 8 },
  '39': { code: '39', description: 'Plastics and articles thereof', chapter: 'Plastics', defaultDutyRate: 4 },
  '73': { code: '73', description: 'Iron or steel articles', chapter: 'Metals', defaultDutyRate: 3.5 },
  '69': { code: '69', description: 'Ceramic products', chapter: 'Ceramics', defaultDutyRate: 6 },
  '33': { code: '33', description: 'Essential oils, perfumery, cosmetics', chapter: 'Cosmetics', defaultDutyRate: 2.5 },
};

// Destination-specific duty rate multipliers
const DUTY_MULTIPLIERS: Record<string, number> = {
  US: 1.0,
  CA: 0.9,
  GB: 1.1,
  AU: 0.8,
  EU: 1.0,
  JP: 0.7,
  CN: 1.5,
  IN: 2.0,
  BR: 2.5,
};

// =============================================================================
// VAT Calculation
// =============================================================================

export function calculateVat(input: {
  amount: number;
  countryCode: string;
  rateType?: 'standard' | 'reduced' | 'super_reduced' | 'parking';
  sellerCountry?: string;
  buyerIsBusinessB2B?: boolean;
}): VatCalculation {
  const code = input.countryCode.toUpperCase();
  const vatInfo = EU_VAT_RATES[code];

  if (!vatInfo) {
    throw new Error(`VAT rate not found for country code: ${code}. Supported: ${Object.keys(EU_VAT_RATES).join(', ')}`);
  }

  if (input.amount < 0 || !Number.isFinite(input.amount)) {
    throw new Error('amount must be a non-negative finite number');
  }

  const rateType = input.rateType ?? 'standard';
  let vatRate: number;

  switch (rateType) {
    case 'standard':
      vatRate = vatInfo.standardRate;
      break;
    case 'reduced':
      vatRate = vatInfo.reducedRate;
      break;
    case 'super_reduced':
      if (vatInfo.superReducedRate === null) {
        throw new Error(`${vatInfo.country} does not have a super-reduced VAT rate`);
      }
      vatRate = vatInfo.superReducedRate;
      break;
    case 'parking':
      if (vatInfo.parkingRate === null) {
        throw new Error(`${vatInfo.country} does not have a parking VAT rate`);
      }
      vatRate = vatInfo.parkingRate;
      break;
    default:
      vatRate = vatInfo.standardRate;
  }

  // Reverse charge: B2B cross-border sales within EU
  const sellerCountry = input.sellerCountry?.toUpperCase() ?? '';
  const reverseCharge = input.buyerIsBusinessB2B === true && sellerCountry !== '' && sellerCountry !== code;

  const effectiveRate = reverseCharge ? 0 : vatRate;
  const vatAmount = round2(input.amount * effectiveRate / 100);
  const grossAmount = round2(input.amount + vatAmount);

  // OSS applies if seller ships cross-border B2C and exceeds threshold
  const ossApplicable = sellerCountry !== '' && sellerCountry !== code && input.buyerIsBusinessB2B !== true;

  return {
    country: vatInfo.country,
    countryCode: code,
    netAmount: input.amount,
    vatRate: effectiveRate,
    vatAmount,
    grossAmount,
    rateType,
    reverseCharge,
    ossApplicable,
  };
}

// =============================================================================
// GST Calculation
// =============================================================================

export function calculateGst(input: {
  amount: number;
  countryCode: string;
  province?: string;
}): GstCalculation {
  const code = input.countryCode.toUpperCase();
  const gstInfo = GST_RATES[code];

  if (!gstInfo) {
    throw new Error(`GST rate not found for country code: ${code}. Supported: ${Object.keys(GST_RATES).join(', ')}`);
  }

  if (input.amount < 0 || !Number.isFinite(input.amount)) {
    throw new Error('amount must be a non-negative finite number');
  }

  let gstRate = gstInfo.rate;
  let pstRate = 0;
  let hstRate = 0;
  let province = input.province?.toUpperCase();

  // Canada has complex provincial taxes
  if (code === 'CA' && province) {
    if (CA_HST_RATES[province] !== undefined) {
      // HST provinces: GST + PST combined into HST (replaces federal GST)
      hstRate = CA_HST_RATES[province];
      gstRate = 0; // HST replaces GST
    } else if (CA_PST_RATES[province] !== undefined) {
      pstRate = CA_PST_RATES[province];
    }
    // Alberta, Yukon, NWT, Nunavut: GST only (5%)
  }

  const gstAmount = round2(input.amount * gstRate / 100);
  const pstAmount = round2(input.amount * pstRate / 100);
  const hstAmount = round2(input.amount * hstRate / 100);
  const totalTax = round2(gstAmount + pstAmount + hstAmount);
  const grossAmount = round2(input.amount + totalTax);
  const thresholdExceeded = input.amount > gstInfo.lowValueThreshold && gstInfo.lowValueThreshold > 0;

  return {
    country: gstInfo.country,
    countryCode: code,
    province,
    netAmount: input.amount,
    gstRate,
    gstAmount,
    pstRate,
    pstAmount,
    hstRate,
    hstAmount,
    totalTax,
    grossAmount,
    lowValueThreshold: gstInfo.lowValueThreshold,
    thresholdExceeded,
  };
}

// =============================================================================
// Import Duty Estimation
// =============================================================================

export function checkImportDuties(input: {
  hsCode: string;
  originCountry: string;
  destinationCountry: string;
  declaredValue: number;
  currency?: string;
}): ImportDutyEstimate {
  if (input.declaredValue < 0 || !Number.isFinite(input.declaredValue)) {
    throw new Error('declaredValue must be a non-negative finite number');
  }

  const hsChapter = input.hsCode.substring(0, 2);
  const hsInfo = HS_CODE_DATA[hsChapter];
  const destCode = input.destinationCountry.toUpperCase();
  const originCode = input.originCountry.toUpperCase();
  const currency = input.currency ?? 'USD';
  const notes: string[] = [];

  // Look up base duty rate from HS code chapter
  let baseDutyRate = hsInfo?.defaultDutyRate ?? 5;
  const multiplier = DUTY_MULTIPLIERS[destCode] ?? 1.0;
  let dutyRate = round2(baseDutyRate * multiplier);

  // Check de minimis threshold
  const deMinimisEntry = DE_MINIMIS[destCode] ?? DE_MINIMIS['US'];
  const deMinimisFree = input.declaredValue <= deMinimisEntry.threshold;

  if (deMinimisFree) {
    notes.push(`Below de minimis threshold of ${deMinimisEntry.threshold} ${deMinimisEntry.currency} - no duty applies`);
    dutyRate = 0;
  }

  // Free trade agreements
  if (originCode === 'US' && destCode === 'CA') {
    notes.push('USMCA/CUSMA: Preferential rates may apply for US-origin goods');
    dutyRate = round2(dutyRate * 0.5);
  } else if (originCode === 'CA' && destCode === 'US') {
    notes.push('USMCA/CUSMA: Preferential rates may apply for CA-origin goods');
    dutyRate = round2(dutyRate * 0.5);
  }

  // EU intra-community: no customs duty
  const euCodes = Object.keys(EU_VAT_RATES);
  if (euCodes.includes(originCode) && euCodes.includes(destCode)) {
    notes.push('EU intra-community trade: No customs duties apply');
    dutyRate = 0;
  }

  const dutyAmount = round2(input.declaredValue * dutyRate / 100);

  // VAT/GST on import (applied to value + duty)
  let vatOrGstRate = 0;
  if (EU_VAT_RATES[destCode]) {
    vatOrGstRate = EU_VAT_RATES[destCode].standardRate;
    notes.push(`Import VAT at ${vatOrGstRate}% applies on (value + duty)`);
  } else if (GST_RATES[destCode]) {
    vatOrGstRate = GST_RATES[destCode].rate;
    notes.push(`Import GST at ${vatOrGstRate}% applies on (value + duty)`);
  } else if (destCode === 'GB') {
    vatOrGstRate = 20;
    notes.push('UK VAT at 20% applies on (value + duty)');
  } else if (destCode === 'US') {
    notes.push('US does not charge import VAT/GST');
  }

  const taxableBase = input.declaredValue + dutyAmount;
  const vatOrGstAmount = deMinimisFree && destCode === 'US' ? 0 : round2(taxableBase * vatOrGstRate / 100);
  const totalImportCost = round2(dutyAmount + vatOrGstAmount);
  const totalLandedCost = round2(input.declaredValue + totalImportCost);

  return {
    hsCode: input.hsCode,
    hsDescription: hsInfo?.description ?? 'Unknown HS code chapter',
    originCountry: originCode,
    destinationCountry: destCode,
    declaredValue: input.declaredValue,
    currency,
    dutyRate,
    dutyAmount,
    vatOrGstRate,
    vatOrGstAmount,
    totalImportCost,
    totalLandedCost,
    deMinimisFree,
    deMinimisThreshold: deMinimisEntry.threshold,
    notes,
  };
}

// =============================================================================
// VAT Report Generation
// =============================================================================

export function generateVatReport(db: Database, input: {
  startDate: string;
  endDate: string;
  sellerCountry: string;
}): VatReport {
  const sellerCode = input.sellerCountry.toUpperCase();

  // Query orders with EU destination countries from the database
  let entries: VatReportEntry[];
  try {
    const rows = db.query<{
      country_code: string;
      total_sales: number;
      order_count: number;
    }>(
      `SELECT
         buyer_country AS country_code,
         SUM(total_price) AS total_sales,
         COUNT(*) AS order_count
       FROM orders
       WHERE created_at >= ? AND created_at <= ?
         AND buyer_country IN (${Object.keys(EU_VAT_RATES).map(() => '?').join(',')})
       GROUP BY buyer_country
       ORDER BY total_sales DESC`,
      [input.startDate, input.endDate, ...Object.keys(EU_VAT_RATES)]
    );

    entries = rows.map((row) => {
      const vatInfo = EU_VAT_RATES[row.country_code];
      const vatRate = vatInfo?.standardRate ?? 0;
      const totalVat = round2(row.total_sales * vatRate / 100);
      return {
        countryCode: row.country_code,
        country: vatInfo?.country ?? row.country_code,
        totalSales: row.total_sales,
        totalVat,
        orderCount: row.order_count,
        vatRate,
      };
    });
  } catch {
    // Table may not exist yet or have different schema
    logger.warn('Could not query orders for VAT report, returning empty report');
    entries = [];
  }

  const totalSales = entries.reduce((sum, e) => sum + e.totalSales, 0);
  const totalVat = entries.reduce((sum, e) => sum + e.totalVat, 0);
  const totalOrders = entries.reduce((sum, e) => sum + e.orderCount, 0);

  // Check if OSS threshold exceeded (cross-border sales only)
  const crossBorderSales = entries
    .filter((e) => e.countryCode !== sellerCode)
    .reduce((sum, e) => sum + e.totalSales, 0);
  const ossExceeded = crossBorderSales > OSS_THRESHOLD_EUR;

  return {
    startDate: input.startDate,
    endDate: input.endDate,
    sellerCountry: sellerCode,
    entries,
    totalSales: round2(totalSales),
    totalVat: round2(totalVat),
    totalOrders,
    ossThreshold: OSS_THRESHOLD_EUR,
    ossExceeded,
    generatedAt: new Date().toISOString(),
  };
}

// =============================================================================
// Tool Definitions
// =============================================================================

export const internationalTaxTools = [
  {
    name: 'calculate_vat',
    description: 'Calculate EU VAT for cross-border sales. Supports all 27 EU member states with standard, reduced, super-reduced, and parking rates. Handles reverse charge for B2B and OSS for B2C.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount: { type: 'number' as const, description: 'Net amount (excl. VAT) in EUR' },
        country_code: { type: 'string' as const, description: 'EU country code (e.g., DE, FR, IT)' },
        rate_type: {
          type: 'string' as const,
          enum: ['standard', 'reduced', 'super_reduced', 'parking'],
          description: 'VAT rate type (default: standard)',
        },
        seller_country: { type: 'string' as const, description: 'Seller EU country code (for reverse charge / OSS determination)' },
        buyer_is_business: { type: 'boolean' as const, description: 'True if buyer is a VAT-registered business (B2B reverse charge)' },
      },
      required: ['amount', 'country_code'] as const,
    },
  },
  {
    name: 'calculate_gst',
    description: 'Calculate GST for sales to Australia, New Zealand, Canada, and India. For Canada, supports provincial HST/PST calculations.',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount: { type: 'number' as const, description: 'Net amount before tax' },
        country_code: { type: 'string' as const, enum: ['AU', 'NZ', 'CA', 'IN'], description: 'Destination country code' },
        province: { type: 'string' as const, description: 'Canadian province code (e.g., ON, BC, QC) for provincial tax calculation' },
      },
      required: ['amount', 'country_code'] as const,
    },
  },
  {
    name: 'check_import_duties',
    description: 'Estimate import duties and taxes by HS code and destination country. Includes de minimis checks, free trade agreement adjustments, and landed cost calculation.',
    input_schema: {
      type: 'object' as const,
      properties: {
        hs_code: { type: 'string' as const, description: 'Harmonized System code (min 2-digit chapter, e.g., "85" for electronics, "6109" for t-shirts)' },
        origin_country: { type: 'string' as const, description: 'Country of origin code (e.g., CN, US)' },
        destination_country: { type: 'string' as const, description: 'Destination country code (e.g., US, GB, DE)' },
        declared_value: { type: 'number' as const, description: 'Declared value of goods' },
        currency: { type: 'string' as const, description: 'Currency code (default: USD)' },
      },
      required: ['hs_code', 'origin_country', 'destination_country', 'declared_value'] as const,
    },
  },
  {
    name: 'vat_report',
    description: 'Generate a VAT report for EU sales over a date range. Shows VAT owed by country, total cross-border sales, and OSS threshold status.',
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: { type: 'string' as const, description: 'Start date (YYYY-MM-DD)' },
        end_date: { type: 'string' as const, description: 'End date (YYYY-MM-DD)' },
        seller_country: { type: 'string' as const, description: 'Seller EU country code (e.g., DE)' },
      },
      required: ['start_date', 'end_date', 'seller_country'] as const,
    },
  },
] as const;

// =============================================================================
// Handler
// =============================================================================

export function handleInternationalTaxTool(
  db: Database,
  toolName: string,
  input: Record<string, unknown>,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'calculate_vat': {
        const amount = input.amount as number;
        const countryCode = input.country_code as string;
        if (typeof amount !== 'number' || !Number.isFinite(amount)) {
          return { success: false, error: 'amount must be a finite number' };
        }
        if (!countryCode || typeof countryCode !== 'string') {
          return { success: false, error: 'country_code is required' };
        }
        const result = calculateVat({
          amount,
          countryCode,
          rateType: input.rate_type as VatCalculation['rateType'] | undefined,
          sellerCountry: input.seller_country as string | undefined,
          buyerIsBusinessB2B: input.buyer_is_business as boolean | undefined,
        });
        return { success: true, data: result };
      }

      case 'calculate_gst': {
        const amount = input.amount as number;
        const countryCode = input.country_code as string;
        if (typeof amount !== 'number' || !Number.isFinite(amount)) {
          return { success: false, error: 'amount must be a finite number' };
        }
        if (!countryCode || typeof countryCode !== 'string') {
          return { success: false, error: 'country_code is required' };
        }
        const result = calculateGst({
          amount,
          countryCode,
          province: input.province as string | undefined,
        });
        return { success: true, data: result };
      }

      case 'check_import_duties': {
        const declaredValue = input.declared_value as number;
        if (typeof declaredValue !== 'number' || !Number.isFinite(declaredValue)) {
          return { success: false, error: 'declared_value must be a finite number' };
        }
        const hsCode = input.hs_code as string;
        const originCountry = input.origin_country as string;
        const destinationCountry = input.destination_country as string;
        if (!hsCode || !originCountry || !destinationCountry) {
          return { success: false, error: 'hs_code, origin_country, and destination_country are required' };
        }
        const result = checkImportDuties({
          hsCode,
          originCountry,
          destinationCountry,
          declaredValue,
          currency: input.currency as string | undefined,
        });
        return { success: true, data: result };
      }

      case 'vat_report': {
        const startDate = input.start_date as string;
        const endDate = input.end_date as string;
        const sellerCountry = input.seller_country as string;
        if (!startDate || !endDate || !sellerCountry) {
          return { success: false, error: 'start_date, end_date, and seller_country are required' };
        }
        const result = generateVatReport(db, { startDate, endDate, sellerCountry });
        return { success: true, data: result };
      }

      default:
        return { success: false, error: `Unknown international tax tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// =============================================================================
// Helpers
// =============================================================================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Re-export types
export type {
  VatRate,
  VatCalculation,
  VatReport,
  VatReportEntry,
  GstCalculation,
  ImportDutyEstimate,
  HsCodeInfo,
} from './international-types.js';
