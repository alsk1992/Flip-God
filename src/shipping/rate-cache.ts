/**
 * Shipping Rate Cache - Cache and estimate shipping rates
 *
 * Features:
 * - Rate caching with TTL (4h domestic, 24h international)
 * - Heuristic weight-based rate estimation when no cached rate exists
 * - Multi-carrier support: USPS, UPS, FedEx, Amazon (FBA)
 * - Automatic cache expiration cleanup
 */

import { createLogger } from '../utils/logger';
import { generateId } from '../utils/id';
import type { Database } from '../db/index';
import type { ShippingRateParams, ShippingRate, Carrier, CachedShippingRate } from './types';

const logger = createLogger('shipping-cache');

// =============================================================================
// CONSTANTS
// =============================================================================

/** 4 hours in milliseconds (domestic TTL) */
const DOMESTIC_TTL_MS = 4 * 60 * 60 * 1000;

/** 24 hours in milliseconds (international TTL) */
const INTERNATIONAL_TTL_MS = 24 * 60 * 60 * 1000;

/** Maximum weight in ounces for each carrier/service */
const CARRIER_SERVICES: Array<{
  carrier: Carrier;
  service: string;
  displayName: string;
  maxWeightOz: number;
  domestic: boolean;
}> = [
  // USPS
  { carrier: 'usps', service: 'first_class', displayName: 'USPS First Class', maxWeightOz: 13 * 16, domestic: true },
  { carrier: 'usps', service: 'priority', displayName: 'USPS Priority Mail', maxWeightOz: 70 * 16, domestic: true },
  { carrier: 'usps', service: 'priority_express', displayName: 'USPS Priority Express', maxWeightOz: 70 * 16, domestic: true },
  { carrier: 'usps', service: 'ground_advantage', displayName: 'USPS Ground Advantage', maxWeightOz: 70 * 16, domestic: true },
  // UPS
  { carrier: 'ups', service: 'ground', displayName: 'UPS Ground', maxWeightOz: 150 * 16, domestic: true },
  { carrier: 'ups', service: 'three_day', displayName: 'UPS 3 Day Select', maxWeightOz: 150 * 16, domestic: true },
  { carrier: 'ups', service: 'second_day', displayName: 'UPS 2nd Day Air', maxWeightOz: 150 * 16, domestic: true },
  { carrier: 'ups', service: 'next_day', displayName: 'UPS Next Day Air', maxWeightOz: 150 * 16, domestic: true },
  // FedEx
  { carrier: 'fedex', service: 'ground', displayName: 'FedEx Ground', maxWeightOz: 150 * 16, domestic: true },
  { carrier: 'fedex', service: 'express_saver', displayName: 'FedEx Express Saver', maxWeightOz: 150 * 16, domestic: true },
  { carrier: 'fedex', service: 'two_day', displayName: 'FedEx 2Day', maxWeightOz: 150 * 16, domestic: true },
  { carrier: 'fedex', service: 'overnight', displayName: 'FedEx Standard Overnight', maxWeightOz: 150 * 16, domestic: true },
  // Amazon FBA
  { carrier: 'amazon', service: 'fba_standard', displayName: 'Amazon FBA Standard', maxWeightOz: 20 * 16, domestic: true },
  { carrier: 'amazon', service: 'fba_oversize', displayName: 'Amazon FBA Oversize', maxWeightOz: 150 * 16, domestic: true },
];

// =============================================================================
// WEIGHT-BASED RATE TABLES (cents)
// =============================================================================

/**
 * Heuristic rate tables by carrier and service.
 * Rates are in CENTS for common weight brackets.
 * These are approximate 2025-2026 rates for domestic US shipping.
 */
const RATE_TABLES: Record<string, Array<{ maxOz: number; rateCents: number; estimatedDays: number }>> = {
  // USPS First Class (up to 13oz)
  'usps:first_class': [
    { maxOz: 1, rateCents: 355, estimatedDays: 3 },
    { maxOz: 2, rateCents: 355, estimatedDays: 3 },
    { maxOz: 3, rateCents: 390, estimatedDays: 3 },
    { maxOz: 4, rateCents: 425, estimatedDays: 3 },
    { maxOz: 8, rateCents: 475, estimatedDays: 3 },
    { maxOz: 12, rateCents: 530, estimatedDays: 3 },
    { maxOz: 13 * 16, rateCents: 580, estimatedDays: 3 },
  ],
  // USPS Priority Mail
  'usps:priority': [
    { maxOz: 16, rateCents: 795, estimatedDays: 2 },
    { maxOz: 32, rateCents: 895, estimatedDays: 2 },
    { maxOz: 48, rateCents: 995, estimatedDays: 2 },
    { maxOz: 80, rateCents: 1195, estimatedDays: 2 },
    { maxOz: 160, rateCents: 1495, estimatedDays: 2 },
    { maxOz: 320, rateCents: 1895, estimatedDays: 2 },
    { maxOz: 70 * 16, rateCents: 2495, estimatedDays: 2 },
  ],
  // USPS Priority Express
  'usps:priority_express': [
    { maxOz: 16, rateCents: 2695, estimatedDays: 1 },
    { maxOz: 32, rateCents: 2895, estimatedDays: 1 },
    { maxOz: 48, rateCents: 3295, estimatedDays: 1 },
    { maxOz: 80, rateCents: 3995, estimatedDays: 1 },
    { maxOz: 160, rateCents: 4995, estimatedDays: 1 },
    { maxOz: 70 * 16, rateCents: 6995, estimatedDays: 1 },
  ],
  // USPS Ground Advantage
  'usps:ground_advantage': [
    { maxOz: 4, rateCents: 395, estimatedDays: 5 },
    { maxOz: 8, rateCents: 450, estimatedDays: 5 },
    { maxOz: 16, rateCents: 595, estimatedDays: 5 },
    { maxOz: 32, rateCents: 695, estimatedDays: 5 },
    { maxOz: 48, rateCents: 795, estimatedDays: 5 },
    { maxOz: 160, rateCents: 995, estimatedDays: 5 },
    { maxOz: 70 * 16, rateCents: 1495, estimatedDays: 5 },
  ],
  // UPS Ground
  'ups:ground': [
    { maxOz: 16, rateCents: 895, estimatedDays: 5 },
    { maxOz: 32, rateCents: 995, estimatedDays: 5 },
    { maxOz: 80, rateCents: 1295, estimatedDays: 5 },
    { maxOz: 160, rateCents: 1595, estimatedDays: 5 },
    { maxOz: 320, rateCents: 1995, estimatedDays: 5 },
    { maxOz: 150 * 16, rateCents: 2995, estimatedDays: 5 },
  ],
  // UPS 3 Day Select
  'ups:three_day': [
    { maxOz: 16, rateCents: 1495, estimatedDays: 3 },
    { maxOz: 32, rateCents: 1695, estimatedDays: 3 },
    { maxOz: 80, rateCents: 1995, estimatedDays: 3 },
    { maxOz: 160, rateCents: 2495, estimatedDays: 3 },
    { maxOz: 150 * 16, rateCents: 3495, estimatedDays: 3 },
  ],
  // UPS 2nd Day Air
  'ups:second_day': [
    { maxOz: 16, rateCents: 1995, estimatedDays: 2 },
    { maxOz: 32, rateCents: 2295, estimatedDays: 2 },
    { maxOz: 80, rateCents: 2795, estimatedDays: 2 },
    { maxOz: 160, rateCents: 3495, estimatedDays: 2 },
    { maxOz: 150 * 16, rateCents: 4995, estimatedDays: 2 },
  ],
  // UPS Next Day Air
  'ups:next_day': [
    { maxOz: 16, rateCents: 3295, estimatedDays: 1 },
    { maxOz: 32, rateCents: 3795, estimatedDays: 1 },
    { maxOz: 80, rateCents: 4995, estimatedDays: 1 },
    { maxOz: 160, rateCents: 6495, estimatedDays: 1 },
    { maxOz: 150 * 16, rateCents: 8995, estimatedDays: 1 },
  ],
  // FedEx Ground
  'fedex:ground': [
    { maxOz: 16, rateCents: 895, estimatedDays: 5 },
    { maxOz: 32, rateCents: 995, estimatedDays: 5 },
    { maxOz: 80, rateCents: 1295, estimatedDays: 5 },
    { maxOz: 160, rateCents: 1595, estimatedDays: 5 },
    { maxOz: 320, rateCents: 1995, estimatedDays: 5 },
    { maxOz: 150 * 16, rateCents: 2895, estimatedDays: 5 },
  ],
  // FedEx Express Saver
  'fedex:express_saver': [
    { maxOz: 16, rateCents: 1495, estimatedDays: 3 },
    { maxOz: 32, rateCents: 1695, estimatedDays: 3 },
    { maxOz: 80, rateCents: 1995, estimatedDays: 3 },
    { maxOz: 160, rateCents: 2495, estimatedDays: 3 },
    { maxOz: 150 * 16, rateCents: 3495, estimatedDays: 3 },
  ],
  // FedEx 2Day
  'fedex:two_day': [
    { maxOz: 16, rateCents: 1995, estimatedDays: 2 },
    { maxOz: 32, rateCents: 2295, estimatedDays: 2 },
    { maxOz: 80, rateCents: 2795, estimatedDays: 2 },
    { maxOz: 160, rateCents: 3495, estimatedDays: 2 },
    { maxOz: 150 * 16, rateCents: 4995, estimatedDays: 2 },
  ],
  // FedEx Standard Overnight
  'fedex:overnight': [
    { maxOz: 16, rateCents: 3295, estimatedDays: 1 },
    { maxOz: 32, rateCents: 3795, estimatedDays: 1 },
    { maxOz: 80, rateCents: 4995, estimatedDays: 1 },
    { maxOz: 160, rateCents: 6495, estimatedDays: 1 },
    { maxOz: 150 * 16, rateCents: 8995, estimatedDays: 1 },
  ],
  // Amazon FBA Standard (includes pick/pack + weight handling)
  'amazon:fba_standard': [
    { maxOz: 6, rateCents: 337, estimatedDays: 3 },
    { maxOz: 10, rateCents: 356, estimatedDays: 3 },
    { maxOz: 16, rateCents: 394, estimatedDays: 3 },
    { maxOz: 32, rateCents: 563, estimatedDays: 3 },
    { maxOz: 48, rateCents: 633, estimatedDays: 3 },
    { maxOz: 80, rateCents: 744, estimatedDays: 3 },
    { maxOz: 160, rateCents: 895, estimatedDays: 3 },
    { maxOz: 20 * 16, rateCents: 1095, estimatedDays: 3 },
  ],
  // Amazon FBA Oversize
  'amazon:fba_oversize': [
    { maxOz: 320, rateCents: 1095, estimatedDays: 3 },
    { maxOz: 640, rateCents: 1695, estimatedDays: 3 },
    { maxOz: 150 * 16, rateCents: 2895, estimatedDays: 3 },
  ],
};

// =============================================================================
// CACHE OPERATIONS
// =============================================================================

/**
 * Look up a cached shipping rate that hasn't expired.
 */
export function getCachedRate(
  db: Database,
  params: ShippingRateParams,
): ShippingRate[] {
  const now = Date.now();

  // Clean expired entries opportunistically
  cleanExpiredCache(db);

  const originZip = params.originZip ?? '10001';
  const destZip = params.destZip ?? '10001';
  const dimensions = formatDimensions(params.lengthIn, params.widthIn, params.heightIn);

  const conditions: string[] = [
    'origin_zip = ?',
    'dest_zip = ?',
    'weight_oz = ?',
    'expires_at > ?',
  ];
  const sqlParams: unknown[] = [originZip, destZip, params.weightOz, now];

  if (dimensions) {
    conditions.push('dimensions = ?');
    sqlParams.push(dimensions);
  }

  if (params.carrier && params.carrier !== 'any') {
    conditions.push('carrier = ?');
    sqlParams.push(params.carrier);
  }

  const rows = db.query<Record<string, unknown>>(
    `SELECT id, origin_zip, dest_zip, weight_oz, dimensions, carrier, service, rate_cents, fetched_at, expires_at
     FROM shipping_rate_cache
     WHERE ${conditions.join(' AND ')}
     ORDER BY rate_cents ASC`,
    sqlParams,
  );

  return rows.map((row) => ({
    carrier: row.carrier as Carrier,
    service: row.service as string,
    rateCents: row.rate_cents as number,
    estimatedDays: null,
    source: 'cache' as const,
    expiresAt: row.expires_at as number,
  }));
}

/**
 * Store a shipping rate in the cache.
 */
export function cacheRate(
  db: Database,
  params: ShippingRateParams,
  rate: { carrier: Carrier; service: string; rateCents: number },
): void {
  const originZip = params.originZip ?? '10001';
  const destZip = params.destZip ?? '10001';
  const isDomestic = isZipDomestic(originZip) && isZipDomestic(destZip);
  const ttl = isDomestic ? DOMESTIC_TTL_MS : INTERNATIONAL_TTL_MS;
  const dimensions = formatDimensions(params.lengthIn, params.widthIn, params.heightIn);
  const now = Date.now();

  const id = generateId('ship');

  db.run(
    `INSERT INTO shipping_rate_cache (id, origin_zip, dest_zip, weight_oz, dimensions, carrier, service, rate_cents, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       rate_cents = excluded.rate_cents,
       fetched_at = excluded.fetched_at,
       expires_at = excluded.expires_at`,
    [
      id,
      originZip,
      destZip,
      params.weightOz,
      dimensions,
      rate.carrier,
      rate.service,
      rate.rateCents,
      now,
      now + ttl,
    ],
  );

  logger.debug(
    { carrier: rate.carrier, service: rate.service, rateCents: rate.rateCents, ttlMs: ttl },
    'Rate cached',
  );
}

/**
 * Remove expired cache entries.
 */
function cleanExpiredCache(db: Database): void {
  try {
    db.run('DELETE FROM shipping_rate_cache WHERE expires_at <= ?', [Date.now()]);
  } catch (err) {
    logger.debug({ err }, 'Failed to clean expired shipping cache');
  }
}

// =============================================================================
// RATE ESTIMATION
// =============================================================================

/**
 * Estimate shipping rate using heuristic weight-based tables.
 *
 * Returns rates for all applicable services for the given carrier (or all carriers).
 */
export function estimateShippingRate(params: ShippingRateParams): ShippingRate[] {
  const weightOz = params.weightOz;
  if (!Number.isFinite(weightOz) || weightOz <= 0) {
    logger.warn({ weightOz }, 'Invalid weight for shipping estimate');
    return [];
  }

  const targetCarrier = params.carrier ?? 'any';
  const rates: ShippingRate[] = [];

  // Check for dimensional weight (if dimensions provided)
  const dimWeight = calculateDimWeight(params.lengthIn, params.widthIn, params.heightIn);
  const billableWeight = Math.max(weightOz, dimWeight);

  for (const svc of CARRIER_SERVICES) {
    // Filter by carrier if specified
    if (targetCarrier !== 'any' && svc.carrier !== targetCarrier) continue;

    // Skip if weight exceeds service max
    if (billableWeight > svc.maxWeightOz) continue;

    const key = `${svc.carrier}:${svc.service}`;
    const table = RATE_TABLES[key];
    if (!table) continue;

    // Find the appropriate rate bracket
    const bracket = table.find((b) => billableWeight <= b.maxOz);
    if (!bracket) continue;

    rates.push({
      carrier: svc.carrier,
      service: svc.service,
      rateCents: bracket.rateCents,
      estimatedDays: bracket.estimatedDays,
      source: 'estimate',
      expiresAt: null,
    });
  }

  // Sort by rate (cheapest first)
  rates.sort((a, b) => a.rateCents - b.rateCents);

  return rates;
}

/**
 * Get shipping estimate: check cache first, then estimate.
 */
export function getShippingEstimate(
  db: Database,
  params: ShippingRateParams,
): ShippingRate[] {
  // 1. Check cache
  const cached = getCachedRate(db, params);
  if (cached.length > 0) {
    logger.debug({ count: cached.length }, 'Returning cached shipping rates');
    return cached;
  }

  // 2. Fall back to heuristic estimation
  const estimated = estimateShippingRate(params);

  // 3. Cache the estimated rates for future lookups
  for (const rate of estimated) {
    try {
      cacheRate(db, params, {
        carrier: rate.carrier,
        service: rate.service,
        rateCents: rate.rateCents,
      });
    } catch (err) {
      logger.debug({ err, carrier: rate.carrier }, 'Failed to cache estimated rate');
    }
  }

  logger.debug({ count: estimated.length }, 'Returning estimated shipping rates');
  return estimated;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Calculate dimensional weight in ounces.
 * DIM weight = (L x W x H) / DIM factor * 16 (convert lbs to oz)
 * Standard DIM factor: 139 for domestic
 */
function calculateDimWeight(
  lengthIn?: number,
  widthIn?: number,
  heightIn?: number,
): number {
  if (!lengthIn || !widthIn || !heightIn) return 0;
  if (!Number.isFinite(lengthIn) || !Number.isFinite(widthIn) || !Number.isFinite(heightIn)) return 0;
  if (lengthIn <= 0 || widthIn <= 0 || heightIn <= 0) return 0;

  const dimFactor = 139; // domestic DIM divisor
  const dimWeightLbs = (lengthIn * widthIn * heightIn) / dimFactor;
  return Math.ceil(dimWeightLbs * 16); // convert to ounces
}

/**
 * Format dimensions string for cache key.
 */
function formatDimensions(
  lengthIn?: number,
  widthIn?: number,
  heightIn?: number,
): string | null {
  if (!lengthIn || !widthIn || !heightIn) return null;
  if (!Number.isFinite(lengthIn) || !Number.isFinite(widthIn) || !Number.isFinite(heightIn)) return null;
  return `${lengthIn}x${widthIn}x${heightIn}`;
}

/**
 * Simple check if a zip code looks domestic US (5 digits).
 */
function isZipDomestic(zip: string): boolean {
  return /^\d{5}(-\d{4})?$/.test(zip);
}
