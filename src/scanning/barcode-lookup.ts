/**
 * Barcode/UPC Lookup - Local DB cache + UPCitemdb.com API fallback
 *
 * Flow:
 * 1. Validate barcode format (UPC-A 12-digit, EAN-13, UPC-E 8-digit)
 * 2. Check local DB cache (barcode_cache table)
 * 3. If miss, query UPCitemdb.com free API
 * 4. Parse and cache result
 * 5. Optionally trigger price scans
 */

import { createLogger } from '../utils/logger';
import type { Database } from '../db/index';
import type {
  BarcodeResult,
  BarcodeStore,
  BarcodeLookupOptions,
  UpcApiResponse,
  UpcApiItem,
} from './types';

const logger = createLogger('barcode-lookup');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UPC_API_BASE = 'https://api.upcitemdb.com/prod/trial/lookup';

/** Rate limit: UPCitemdb free tier allows 100 requests/day */
const RATE_LIMIT_MS = 1500; // 1.5s between requests to stay safe

/** Cache TTL: 7 days in milliseconds */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Module-level rate limiter
let lastApiCallMs = 0;

// ---------------------------------------------------------------------------
// Barcode validation
// ---------------------------------------------------------------------------

/**
 * Validate and classify a barcode string.
 * @returns format type or null if invalid
 */
export function validateBarcode(barcode: string): 'UPC-A' | 'EAN-13' | 'UPC-E' | null {
  const cleaned = barcode.replace(/[\s-]/g, '');

  if (/^\d{12}$/.test(cleaned)) return 'UPC-A';
  if (/^\d{13}$/.test(cleaned)) return 'EAN-13';
  if (/^\d{8}$/.test(cleaned)) return 'UPC-E';

  return null;
}

/**
 * Calculate UPC/EAN check digit validity.
 */
function isValidCheckDigit(barcode: string): boolean {
  const digits = barcode.replace(/[\s-]/g, '').split('').map(Number);
  const originalLength = digits.length;
  if (originalLength !== 12 && originalLength !== 13) return true; // Skip for UPC-E

  const checkDigit = digits.pop()!;
  let sum = 0;

  if (originalLength === 12) {
    // UPC-A (12 digits total, 11 after pop)
    for (let i = 0; i < digits.length; i++) {
      sum += i % 2 === 0 ? digits[i] * 3 : digits[i];
    }
  } else {
    // EAN-13 (13 digits total, 12 after pop)
    for (let i = 0; i < digits.length; i++) {
      sum += i % 2 === 0 ? digits[i] : digits[i] * 3;
    }
  }

  const calculated = (10 - (sum % 10)) % 10;
  return calculated === checkDigit;
}

// ---------------------------------------------------------------------------
// DB cache helpers
// ---------------------------------------------------------------------------

const CACHE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS barcode_cache (
    barcode TEXT PRIMARY KEY,
    format TEXT NOT NULL,
    found INTEGER NOT NULL DEFAULT 0,
    title TEXT,
    brand TEXT,
    category TEXT,
    description TEXT,
    images TEXT,
    stores TEXT,
    cached_at INTEGER NOT NULL
  )
`;

function ensureCacheTable(db: Database): void {
  db.run(CACHE_TABLE_SQL);
}

function getCachedResult(db: Database, barcode: string): BarcodeResult | null {
  ensureCacheTable(db);

  const rows = db.query<Record<string, unknown>>(
    'SELECT * FROM barcode_cache WHERE barcode = ? AND cached_at > ?',
    [barcode, Date.now() - CACHE_TTL_MS],
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  let images: string[] | undefined;
  let stores: BarcodeStore[] | undefined;

  try {
    if (row.images) images = JSON.parse(row.images as string);
  } catch { /* ignore */ }

  try {
    if (row.stores) stores = JSON.parse(row.stores as string);
  } catch { /* ignore */ }

  return {
    barcode: row.barcode as string,
    format: row.format as BarcodeResult['format'],
    found: Boolean(row.found),
    title: (row.title as string) ?? undefined,
    brand: (row.brand as string) ?? undefined,
    category: (row.category as string) ?? undefined,
    description: (row.description as string) ?? undefined,
    images,
    stores,
    cachedAt: new Date(row.cached_at as number),
  };
}

function cacheResult(db: Database, result: BarcodeResult): void {
  ensureCacheTable(db);

  db.run(
    `INSERT INTO barcode_cache (barcode, format, found, title, brand, category, description, images, stores, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(barcode) DO UPDATE SET
       found = excluded.found,
       title = excluded.title,
       brand = excluded.brand,
       category = excluded.category,
       description = excluded.description,
       images = excluded.images,
       stores = excluded.stores,
       cached_at = excluded.cached_at`,
    [
      result.barcode,
      result.format,
      result.found ? 1 : 0,
      result.title ?? null,
      result.brand ?? null,
      result.category ?? null,
      result.description ?? null,
      result.images ? JSON.stringify(result.images) : null,
      result.stores ? JSON.stringify(result.stores) : null,
      Date.now(),
    ],
  );
}

// ---------------------------------------------------------------------------
// API call with rate limiting
// ---------------------------------------------------------------------------

async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastApiCallMs;
  if (elapsed < RATE_LIMIT_MS) {
    const waitMs = RATE_LIMIT_MS - elapsed;
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
  }
  lastApiCallMs = Date.now();
}

async function fetchFromApi(barcode: string): Promise<UpcApiItem | null> {
  await waitForRateLimit();

  const url = `${UPC_API_BASE}?upc=${encodeURIComponent(barcode)}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'FlipGod/1.0',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      if (response.status === 429) {
        logger.warn('UPCitemdb rate limit hit. Back off.');
        return null;
      }
      logger.warn({ status: response.status }, 'UPCitemdb API error');
      return null;
    }

    const data: UpcApiResponse = await response.json();

    if (!data.items || data.items.length === 0) {
      return null;
    }

    return data.items[0];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ barcode, error: msg }, 'UPCitemdb API call failed');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up a single UPC/EAN barcode.
 * Checks local DB cache first, falls back to UPCitemdb.com API.
 */
export async function lookupUPC(
  barcode: string,
  db: Database,
  options: BarcodeLookupOptions = {},
): Promise<BarcodeResult> {
  const { useCache = true } = options;
  const cleaned = barcode.replace(/[\s-]/g, '');

  // Validate format
  const format = validateBarcode(cleaned);
  if (!format) {
    return {
      barcode: cleaned,
      format: 'unknown',
      found: false,
    };
  }

  // Check digit validation (soft warning, don't block)
  if (!isValidCheckDigit(cleaned)) {
    logger.warn({ barcode: cleaned }, 'Barcode check digit may be invalid');
  }

  const resultFormat = format === 'UPC-E' ? 'UPC-A' : format as BarcodeResult['format'];

  // Check local cache
  if (useCache) {
    const cached = getCachedResult(db, cleaned);
    if (cached) {
      logger.info({ barcode: cleaned, cached: true }, 'Barcode found in cache');
      return cached;
    }
  }

  // Also check if we already have this product in the products table
  const existingProduct = db.findProductByUPC(cleaned);
  if (existingProduct) {
    logger.info({ barcode: cleaned, productId: existingProduct.id }, 'Barcode found in products table');
    const result: BarcodeResult = {
      barcode: cleaned,
      format: resultFormat,
      found: true,
      title: existingProduct.title,
      brand: existingProduct.brand,
      category: existingProduct.category,
    };
    cacheResult(db, result);
    return result;
  }

  // Query external API
  logger.info({ barcode: cleaned }, 'Looking up barcode via UPCitemdb');
  const apiItem = await fetchFromApi(cleaned);

  if (!apiItem) {
    const notFound: BarcodeResult = {
      barcode: cleaned,
      format: resultFormat,
      found: false,
    };
    // Cache the miss to avoid repeated API calls
    cacheResult(db, notFound);
    return notFound;
  }

  // Parse API response
  const stores: BarcodeStore[] = (apiItem.offers ?? []).map((offer) => ({
    name: offer.merchant,
    price: Number.isFinite(offer.price) ? offer.price : undefined,
    currency: offer.currency ?? 'USD',
    url: offer.link,
    lastUpdated: offer.updated_t ? new Date(offer.updated_t * 1000).toISOString() : undefined,
  }));

  const result: BarcodeResult = {
    barcode: cleaned,
    format: resultFormat,
    found: true,
    title: apiItem.title,
    brand: apiItem.brand,
    category: apiItem.category,
    description: apiItem.description,
    images: apiItem.images,
    stores: stores.length > 0 ? stores : undefined,
  };

  // Cache the result
  cacheResult(db, result);

  logger.info(
    { barcode: cleaned, title: result.title, storeCount: stores.length },
    'Barcode lookup complete',
  );

  return result;
}

/**
 * Look up multiple barcodes with rate limiting.
 * Returns results in the same order as the input barcodes.
 */
export async function batchLookupUPC(
  barcodes: string[],
  db: Database,
  options: BarcodeLookupOptions = {},
): Promise<BarcodeResult[]> {
  logger.info({ count: barcodes.length }, 'Starting batch barcode lookup');

  const results: BarcodeResult[] = [];

  for (const barcode of barcodes) {
    const result = await lookupUPC(barcode, db, options);
    results.push(result);
  }

  const found = results.filter((r) => r.found).length;
  logger.info({ total: barcodes.length, found, notFound: barcodes.length - found }, 'Batch lookup complete');

  return results;
}
