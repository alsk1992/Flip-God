/**
 * Restriction Checker - Detect gated/restricted products before listing
 *
 * Checks products against known restricted brands, gated categories,
 * hazmat keywords, counterfeit indicators, and other restriction signals.
 * Results are cached with a 7-day TTL.
 */

import { randomUUID } from 'node:crypto';
import type { Database } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('restriction-checker');

// =============================================================================
// Types
// =============================================================================

export type RestrictionType =
  | 'category_gated'
  | 'brand_restricted'
  | 'approval_required'
  | 'ip_risk'
  | 'hazmat'
  | 'recalled'
  | 'counterfeit_risk'
  | 'age_restricted'
  | 'region_restricted'
  | 'license_required';

export type RestrictionSeverity = 'info' | 'warning' | 'block';

export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'blocked';

export interface Restriction {
  type: RestrictionType;
  severity: RestrictionSeverity;
  description: string;
  source: string;
}

export interface RestrictionResult {
  productId: string;
  platform: string;
  canSell: boolean;
  restrictions: Restriction[];
  riskLevel: RiskLevel;
  recommendations: string[];
  checkedAt: number;
}

export interface ProductInfo {
  name?: string;
  brand?: string;
  category?: string;
  asin?: string;
  upc?: string;
}

interface RestrictedBrandRow {
  id: string;
  brand_name: string;
  platform: string;
  restriction_type: string;
  notes: string | null;
  added_at: number;
}

interface RestrictedCategoryRow {
  id: string;
  category_name: string;
  platform: string;
  restriction_type: string;
  notes: string | null;
  added_at: number;
}

interface RestrictionCacheRow {
  id: string;
  product_id: string;
  platform: string;
  can_sell: number;
  restrictions: string;
  risk_level: string;
  recommendations: string;
  checked_at: number;
  expires_at: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Cache TTL: 7 days in milliseconds */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Hazmat indicator keywords (case-insensitive matching) */
const HAZMAT_KEYWORDS: string[] = [
  'lithium',
  'battery',
  'batteries',
  'flammable',
  'aerosol',
  'pesticide',
  'insecticide',
  'herbicide',
  'propane',
  'butane',
  'acetone',
  'bleach',
  'ammonia',
  'corrosive',
  'oxidizer',
  'explosive',
  'compressed gas',
  'fuel',
  'gasoline',
  'kerosene',
  'paint thinner',
  'nail polish remover',
  'lighter fluid',
  'fireworks',
  'matches',
];

/** Counterfeit/replica risk keywords */
const COUNTERFEIT_KEYWORDS: string[] = [
  'replica',
  'knockoff',
  'knock-off',
  'copy',
  'imitation',
  'dupe',
  'inspired by',
  'style of',
  'look alike',
  'lookalike',
  'fake',
  'counterfeit',
  'bootleg',
  'unauthorized',
  'unbranded',
];

/** Age-restricted product keywords */
const AGE_RESTRICTED_KEYWORDS: string[] = [
  'alcohol',
  'wine',
  'beer',
  'spirits',
  'liquor',
  'bourbon',
  'whiskey',
  'vodka',
  'rum',
  'tequila',
  'tobacco',
  'cigarette',
  'cigar',
  'vape',
  'e-cigarette',
  'e-liquid',
  'nicotine',
  'cbd',
  'thc',
  'cannabis',
  'marijuana',
  'hemp',
  'delta-8',
  'delta-9',
  'kratom',
];

/** License-required product keywords */
const LICENSE_KEYWORDS: string[] = [
  'medical device',
  'pharmaceutical',
  'fda approved',
  'fda cleared',
  'prescription',
  'rx only',
  'controlled substance',
  'dea schedule',
  'class ii medical',
  'class iii medical',
  'diagnostic test',
  'surgical instrument',
  'defibrillator',
  'pacemaker',
  'insulin pump',
  'hearing aid',
  'contact lens',
];

// =============================================================================
// Seed Data
// =============================================================================

interface SeedBrand {
  brand: string;
  platform: string;
  type: RestrictionType;
  notes?: string;
}

interface SeedCategory {
  category: string;
  platform: string;
  type: RestrictionType;
  notes?: string;
}

const SEED_BRANDS: SeedBrand[] = [
  // Amazon gated brands
  { brand: 'Nike', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'Adidas', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'Under Armour', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'New Balance', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'Hasbro', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'LEGO', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'Disney', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'Apple', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'Samsung', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'Sony', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'Bose', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'Dyson', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'Chanel', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'Gucci', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'Louis Vuitton', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'Rolex', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'Yeti', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },
  { brand: 'Patagonia', platform: 'amazon', type: 'brand_restricted', notes: 'Amazon Brand Registry gated' },

  // General IP-risk brands (all platforms)
  { brand: 'Supreme', platform: '*', type: 'ip_risk', notes: 'High counterfeit risk — authentication often required' },
  { brand: 'Off-White', platform: '*', type: 'ip_risk', notes: 'High counterfeit risk — authentication often required' },
  { brand: 'Fear of God', platform: '*', type: 'ip_risk', notes: 'High counterfeit risk — authentication often required' },
  { brand: 'Balenciaga', platform: '*', type: 'ip_risk', notes: 'High counterfeit risk — authentication often required' },
];

const SEED_CATEGORIES: SeedCategory[] = [
  // Amazon gated categories
  { category: 'Grocery & Gourmet', platform: 'amazon', type: 'category_gated', notes: 'Requires approval to sell on Amazon' },
  { category: 'Watches', platform: 'amazon', type: 'category_gated', notes: 'Requires approval to sell on Amazon' },
  { category: 'Fine Jewelry', platform: 'amazon', type: 'category_gated', notes: 'Requires approval to sell on Amazon' },
  { category: 'Collectible Coins', platform: 'amazon', type: 'category_gated', notes: 'Requires approval to sell on Amazon' },
  { category: 'Sports Collectibles', platform: 'amazon', type: 'category_gated', notes: 'Requires approval to sell on Amazon' },
  { category: 'Entertainment Collectibles', platform: 'amazon', type: 'category_gated', notes: 'Requires approval to sell on Amazon' },
  { category: 'Music & DVD', platform: 'amazon', type: 'category_gated', notes: 'Requires approval to sell on Amazon' },
  { category: 'Beauty (Topical)', platform: 'amazon', type: 'category_gated', notes: 'Requires approval to sell on Amazon — topical products' },
  { category: 'Automotive Parts', platform: 'amazon', type: 'category_gated', notes: 'Requires approval to sell on Amazon' },

  // eBay restricted categories
  { category: 'Alcohol', platform: 'ebay', type: 'category_gated', notes: 'Prohibited on eBay with limited exceptions' },
  { category: 'Tobacco', platform: 'ebay', type: 'category_gated', notes: 'Prohibited on eBay' },
  { category: 'Firearms', platform: 'ebay', type: 'category_gated', notes: 'Prohibited on eBay' },
  { category: 'Prescription Drugs', platform: 'ebay', type: 'category_gated', notes: 'Prohibited on eBay' },
];

// =============================================================================
// Seed Function
// =============================================================================

/**
 * Populate known_restricted_brands and known_restricted_categories with
 * default data.  Runs only when the tables are empty.
 */
export function seedDefaultRestrictions(db: Database): void {
  try {
    const brandCount = db.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM known_restricted_brands',
    );
    const catCount = db.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM known_restricted_categories',
    );

    const hasBrands = (brandCount[0]?.cnt ?? 0) > 0;
    const hasCats = (catCount[0]?.cnt ?? 0) > 0;

    if (hasBrands && hasCats) {
      logger.debug('Restriction seed data already present — skipping');
      return;
    }

    const now = Date.now();

    if (!hasBrands) {
      for (const entry of SEED_BRANDS) {
        db.run(
          `INSERT OR IGNORE INTO known_restricted_brands
            (id, brand_name, platform, restriction_type, notes, added_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [randomUUID(), entry.brand, entry.platform, entry.type, entry.notes ?? null, now],
        );
      }
      logger.info({ count: SEED_BRANDS.length }, 'Seeded restricted brands');
    }

    if (!hasCats) {
      for (const entry of SEED_CATEGORIES) {
        db.run(
          `INSERT OR IGNORE INTO known_restricted_categories
            (id, category_name, platform, restriction_type, notes, added_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [randomUUID(), entry.category, entry.platform, entry.type, entry.notes ?? null, now],
        );
      }
      logger.info({ count: SEED_CATEGORIES.length }, 'Seeded restricted categories');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ error: msg }, 'Failed to seed restriction data');
  }
}

// =============================================================================
// Keyword matching helpers
// =============================================================================

function containsKeyword(text: string, keywords: string[]): string | null {
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) {
      return kw;
    }
  }
  return null;
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Check a product for restrictions on a given platform.
 *
 * Checks brand, category, hazmat keywords, counterfeit risk, age restrictions,
 * and license requirements.  Results are cached for 7 days.
 */
export function checkProductRestrictions(
  db: Database,
  productId: string,
  platform: string,
  productInfo?: ProductInfo,
): RestrictionResult {
  // Try cache first
  const cached = checkCachedRestriction(db, productId, platform);
  if (cached) {
    return cached;
  }

  const restrictions: Restriction[] = [];
  const now = Date.now();

  // ── Check 1: Brand match ───────────────────────────────────────────────
  if (productInfo?.brand) {
    const brandRows = db.query<RestrictedBrandRow>(
      `SELECT * FROM known_restricted_brands
       WHERE LOWER(brand_name) = LOWER(?) AND (platform = ? OR platform = '*')`,
      [productInfo.brand, platform],
    );

    for (const row of brandRows) {
      const severity: RestrictionSeverity =
        row.restriction_type === 'brand_restricted' ? 'warning' : 'info';
      restrictions.push({
        type: row.restriction_type as RestrictionType,
        severity,
        description: `Brand "${row.brand_name}" is restricted on ${row.platform === '*' ? 'all platforms' : row.platform}${row.notes ? `: ${row.notes}` : ''}`,
        source: 'known_restricted_brands',
      });
    }
  }

  // ── Check 2: Category match ────────────────────────────────────────────
  if (productInfo?.category) {
    const catRows = db.query<RestrictedCategoryRow>(
      `SELECT * FROM known_restricted_categories
       WHERE LOWER(category_name) = LOWER(?) AND (platform = ? OR platform = '*')`,
      [productInfo.category, platform],
    );

    for (const row of catRows) {
      const severity: RestrictionSeverity =
        row.restriction_type === 'category_gated' ? 'warning' : 'info';
      restrictions.push({
        type: row.restriction_type as RestrictionType,
        severity,
        description: `Category "${row.category_name}" is restricted on ${row.platform === '*' ? 'all platforms' : row.platform}${row.notes ? `: ${row.notes}` : ''}`,
        source: 'known_restricted_categories',
      });
    }

    // Also do fuzzy category matching (partial match)
    const fuzzyRows = db.query<RestrictedCategoryRow>(
      `SELECT * FROM known_restricted_categories
       WHERE INSTR(LOWER(?), LOWER(category_name)) > 0 AND (platform = ? OR platform = '*')`,
      [productInfo.category, platform],
    );

    for (const row of fuzzyRows) {
      // Avoid duplicate if exact match already found
      const alreadyFound = restrictions.some(
        (r) => r.source === 'known_restricted_categories' && r.description.includes(row.category_name),
      );
      if (!alreadyFound) {
        restrictions.push({
          type: row.restriction_type as RestrictionType,
          severity: 'info',
          description: `Category "${productInfo.category}" may overlap with restricted category "${row.category_name}"${row.notes ? `: ${row.notes}` : ''}`,
          source: 'known_restricted_categories',
        });
      }
    }
  }

  const productName = productInfo?.name ?? '';

  // ── Check 3: Hazmat keywords ───────────────────────────────────────────
  if (productName) {
    const hazmatMatch = containsKeyword(productName, HAZMAT_KEYWORDS);
    if (hazmatMatch) {
      restrictions.push({
        type: 'hazmat',
        severity: 'warning',
        description: `Product name contains hazmat indicator "${hazmatMatch}" — may require special handling/labeling`,
        source: 'keyword_detection',
      });
    }
  }

  // ── Check 4: Counterfeit/replica keywords ──────────────────────────────
  if (productName) {
    const counterfeitMatch = containsKeyword(productName, COUNTERFEIT_KEYWORDS);
    if (counterfeitMatch) {
      restrictions.push({
        type: 'counterfeit_risk',
        severity: 'block',
        description: `Product name contains counterfeit indicator "${counterfeitMatch}" — listing may be removed and account suspended`,
        source: 'keyword_detection',
      });
    }
  }

  // ── Check 5: Age-restricted keywords ───────────────────────────────────
  if (productName) {
    const ageMatch = containsKeyword(productName, AGE_RESTRICTED_KEYWORDS);
    if (ageMatch) {
      restrictions.push({
        type: 'age_restricted',
        severity: 'warning',
        description: `Product name contains age-restricted keyword "${ageMatch}" — may require seller verification`,
        source: 'keyword_detection',
      });
    }
  }

  // ── Check 6: License-required keywords ─────────────────────────────────
  if (productName) {
    const licenseMatch = containsKeyword(productName, LICENSE_KEYWORDS);
    if (licenseMatch) {
      restrictions.push({
        type: 'license_required',
        severity: 'block',
        description: `Product name contains license-required keyword "${licenseMatch}" — professional credentials may be needed`,
        source: 'keyword_detection',
      });
    }
  }

  // ── Aggregate risk level ───────────────────────────────────────────────
  const riskLevel = computeRiskLevel(restrictions);
  const canSell = riskLevel !== 'blocked';
  const recommendations = generateRecommendations(restrictions, platform);

  const result: RestrictionResult = {
    productId,
    platform,
    canSell,
    restrictions,
    riskLevel,
    recommendations,
    checkedAt: now,
  };

  // Cache the result
  cacheResult(db, result);

  return result;
}

/**
 * Return a cached restriction result if it exists and has not expired.
 */
export function checkCachedRestriction(
  db: Database,
  productId: string,
  platform: string,
): RestrictionResult | null {
  try {
    const rows = db.query<RestrictionCacheRow>(
      `SELECT * FROM restriction_cache
       WHERE product_id = ? AND platform = ? AND expires_at > ?`,
      [productId, platform, Date.now()],
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      productId: row.product_id,
      platform: row.platform,
      canSell: row.can_sell === 1,
      restrictions: JSON.parse(row.restrictions) as Restriction[],
      riskLevel: row.risk_level as RiskLevel,
      recommendations: JSON.parse(row.recommendations) as string[],
      checkedAt: row.checked_at,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ error: msg, productId, platform }, 'Failed to read restriction cache');
    return null;
  }
}

/**
 * Check restrictions for multiple products, using cache where available.
 */
export function batchCheckRestrictions(
  db: Database,
  products: Array<{ productId: string; productInfo?: ProductInfo }>,
  platform: string,
): RestrictionResult[] {
  const results: RestrictionResult[] = [];

  for (const item of products) {
    try {
      const result = checkProductRestrictions(db, item.productId, platform, item.productInfo);
      results.push(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ error: msg, productId: item.productId }, 'Batch restriction check failed');
      // Return a blocked result on error so we fail safe
      results.push({
        productId: item.productId,
        platform,
        canSell: false,
        restrictions: [
          {
            type: 'approval_required',
            severity: 'warning',
            description: `Check failed: ${msg}`,
            source: 'error',
          },
        ],
        riskLevel: 'medium',
        recommendations: ['Restriction check encountered an error — review manually'],
        checkedAt: Date.now(),
      });
    }
  }

  return results;
}

// =============================================================================
// Brand CRUD
// =============================================================================

/**
 * Add a brand to the restricted brands list.
 */
export function addRestrictedBrand(
  db: Database,
  brand: string,
  platform: string,
  type: RestrictionType,
  notes?: string,
): { id: string } {
  const id = randomUUID();
  const now = Date.now();

  db.run(
    `INSERT INTO known_restricted_brands
      (id, brand_name, platform, restriction_type, notes, added_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, brand, platform, type, notes ?? null, now],
  );

  logger.info({ brand, platform, type }, 'Added restricted brand');
  return { id };
}

/**
 * Remove a brand restriction.
 */
export function removeRestrictedBrand(
  db: Database,
  brand: string,
  platform: string,
): boolean {
  const rows = db.query<{ id: string }>(
    `SELECT id FROM known_restricted_brands
     WHERE brand_name = ? AND platform = ?`,
    [brand, platform],
  );

  if (rows.length === 0) {
    return false;
  }

  db.run(
    `DELETE FROM known_restricted_brands
     WHERE brand_name = ? AND platform = ?`,
    [brand, platform],
  );

  logger.info({ brand, platform }, 'Removed restricted brand');
  return true;
}

/**
 * List known restricted brands, optionally filtered by platform.
 */
export function getRestrictedBrands(
  db: Database,
  platform?: string,
): RestrictedBrandRow[] {
  if (platform) {
    return db.query<RestrictedBrandRow>(
      `SELECT * FROM known_restricted_brands
       WHERE platform = ? OR platform = '*'
       ORDER BY brand_name COLLATE NOCASE`,
      [platform],
    );
  }
  return db.query<RestrictedBrandRow>(
    `SELECT * FROM known_restricted_brands
     ORDER BY brand_name COLLATE NOCASE`,
  );
}

// =============================================================================
// Category CRUD
// =============================================================================

/**
 * Add a category to the restricted categories list.
 */
export function addRestrictedCategory(
  db: Database,
  category: string,
  platform: string,
  type: RestrictionType,
  notes?: string,
): { id: string } {
  const id = randomUUID();
  const now = Date.now();

  db.run(
    `INSERT INTO known_restricted_categories
      (id, category_name, platform, restriction_type, notes, added_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, category, platform, type, notes ?? null, now],
  );

  logger.info({ category, platform, type }, 'Added restricted category');
  return { id };
}

/**
 * Remove a category restriction.
 */
export function removeRestrictedCategory(
  db: Database,
  category: string,
  platform: string,
): boolean {
  const rows = db.query<{ id: string }>(
    `SELECT id FROM known_restricted_categories
     WHERE category_name = ? AND platform = ?`,
    [category, platform],
  );

  if (rows.length === 0) {
    return false;
  }

  db.run(
    `DELETE FROM known_restricted_categories
     WHERE category_name = ? AND platform = ?`,
    [category, platform],
  );

  logger.info({ category, platform }, 'Removed restricted category');
  return true;
}

/**
 * List known restricted categories, optionally filtered by platform.
 */
export function getRestrictedCategories(
  db: Database,
  platform?: string,
): RestrictedCategoryRow[] {
  if (platform) {
    return db.query<RestrictedCategoryRow>(
      `SELECT * FROM known_restricted_categories
       WHERE platform = ? OR platform = '*'
       ORDER BY category_name COLLATE NOCASE`,
      [platform],
    );
  }
  return db.query<RestrictedCategoryRow>(
    `SELECT * FROM known_restricted_categories
     ORDER BY category_name COLLATE NOCASE`,
  );
}

// =============================================================================
// Statistics
// =============================================================================

export interface RestrictionStats {
  totalChecked: number;
  blocked: number;
  blockedPct: number;
  highRisk: number;
  highRiskPct: number;
  mediumRisk: number;
  lowRisk: number;
  noRisk: number;
  topRestrictionTypes: Array<{ type: string; count: number }>;
  cachedResults: number;
  expiredResults: number;
  totalBrands: number;
  totalCategories: number;
}

/**
 * Get aggregate restriction checking statistics.
 */
export function getRestrictionStats(db: Database): RestrictionStats {
  try {
    const now = Date.now();

    const totalRows = db.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM restriction_cache',
    );
    const totalChecked = totalRows[0]?.cnt ?? 0;

    const blockedRows = db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM restriction_cache WHERE risk_level = 'blocked'",
    );
    const blocked = blockedRows[0]?.cnt ?? 0;

    const highRows = db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM restriction_cache WHERE risk_level = 'high'",
    );
    const highRisk = highRows[0]?.cnt ?? 0;

    const medRows = db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM restriction_cache WHERE risk_level = 'medium'",
    );
    const mediumRisk = medRows[0]?.cnt ?? 0;

    const lowRows = db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM restriction_cache WHERE risk_level = 'low'",
    );
    const lowRisk = lowRows[0]?.cnt ?? 0;

    const noneRows = db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM restriction_cache WHERE risk_level = 'none'",
    );
    const noRisk = noneRows[0]?.cnt ?? 0;

    const cachedRows = db.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM restriction_cache WHERE expires_at > ?',
      [now],
    );
    const cachedResults = cachedRows[0]?.cnt ?? 0;

    const expiredRows = db.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM restriction_cache WHERE expires_at <= ?',
      [now],
    );
    const expiredResults = expiredRows[0]?.cnt ?? 0;

    const brandRows = db.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM known_restricted_brands',
    );
    const totalBrands = brandRows[0]?.cnt ?? 0;

    const catRows = db.query<{ cnt: number }>(
      'SELECT COUNT(*) as cnt FROM known_restricted_categories',
    );
    const totalCategories = catRows[0]?.cnt ?? 0;

    // Top restriction types from cache
    // Parse the JSON restrictions column to count types
    const allCache = db.query<{ restrictions: string }>(
      'SELECT restrictions FROM restriction_cache',
    );

    const typeCounts = new Map<string, number>();
    for (const row of allCache) {
      try {
        const restrictions = JSON.parse(row.restrictions) as Restriction[];
        for (const r of restrictions) {
          typeCounts.set(r.type, (typeCounts.get(r.type) ?? 0) + 1);
        }
      } catch {
        // skip malformed JSON
      }
    }

    const topRestrictionTypes = Array.from(typeCounts.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalChecked,
      blocked,
      blockedPct: totalChecked > 0 ? Math.round((blocked / totalChecked) * 10000) / 100 : 0,
      highRisk,
      highRiskPct: totalChecked > 0 ? Math.round((highRisk / totalChecked) * 10000) / 100 : 0,
      mediumRisk,
      lowRisk,
      noRisk,
      topRestrictionTypes,
      cachedResults,
      expiredResults,
      totalBrands,
      totalCategories,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ error: msg }, 'Failed to get restriction stats');
    return {
      totalChecked: 0,
      blocked: 0,
      blockedPct: 0,
      highRisk: 0,
      highRiskPct: 0,
      mediumRisk: 0,
      lowRisk: 0,
      noRisk: 0,
      topRestrictionTypes: [],
      cachedResults: 0,
      expiredResults: 0,
      totalBrands: 0,
      totalCategories: 0,
    };
  }
}

// =============================================================================
// Private helpers
// =============================================================================

/**
 * Compute the overall risk level from a set of restrictions.
 *
 * - Any block → blocked
 * - 2+ warnings → high
 * - 1 warning → medium
 * - info only → low
 * - no restrictions → none
 */
function computeRiskLevel(restrictions: Restriction[]): RiskLevel {
  if (restrictions.length === 0) {
    return 'none';
  }

  const hasBlock = restrictions.some((r) => r.severity === 'block');
  if (hasBlock) {
    return 'blocked';
  }

  const warningCount = restrictions.filter((r) => r.severity === 'warning').length;
  if (warningCount >= 2) {
    return 'high';
  }
  if (warningCount === 1) {
    return 'medium';
  }

  // Only info-level restrictions
  return 'low';
}

/**
 * Generate human-readable recommendations based on the detected restrictions.
 */
function generateRecommendations(restrictions: Restriction[], platform: string): string[] {
  const recs: string[] = [];

  const types = new Set(restrictions.map((r) => r.type));
  const hasBlock = restrictions.some((r) => r.severity === 'block');

  if (hasBlock) {
    recs.push('DO NOT list this product — it will likely be removed and may result in account suspension');
  }

  if (types.has('brand_restricted')) {
    recs.push(
      `Apply for brand approval on ${platform} before listing (Seller Central > Add a Product > Request Approval)`,
    );
    recs.push('Have invoices from authorized distributors ready for the ungating application');
  }

  if (types.has('category_gated')) {
    recs.push(
      `Apply for category approval on ${platform} — you may need professional selling plan + invoices`,
    );
  }

  if (types.has('ip_risk')) {
    recs.push('High counterfeit risk brand — ensure you have proof of authenticity and authorized distribution');
    recs.push('Consider using an authentication service before listing luxury/hype brands');
  }

  if (types.has('hazmat')) {
    recs.push('Product may be classified as hazardous material — check platform hazmat guidelines');
    recs.push('May require special labeling, packaging, or shipping methods (no air freight for some items)');
  }

  if (types.has('counterfeit_risk')) {
    recs.push('Product appears to be a replica or counterfeit — do not list');
    recs.push('Selling counterfeit goods can result in permanent account ban and legal action');
  }

  if (types.has('age_restricted')) {
    recs.push('Age-restricted product — seller verification and buyer age verification may be required');
    recs.push('Check local regulations for selling this type of product online');
  }

  if (types.has('license_required')) {
    recs.push('This product category may require professional licenses or FDA registration');
    recs.push('Consult with a compliance specialist before listing medical/pharmaceutical products');
  }

  if (types.has('recalled')) {
    recs.push('Product may be subject to a recall — check CPSC.gov before listing');
  }

  if (types.has('region_restricted')) {
    recs.push('Product has regional selling restrictions — verify your selling region is allowed');
  }

  if (types.has('approval_required')) {
    recs.push('Additional approval is required before you can sell this product');
  }

  if (recs.length === 0 && restrictions.length > 0) {
    recs.push('Minor restrictions detected — review details and proceed with caution');
  }

  return recs;
}

/**
 * Store a restriction result in the cache.
 */
function cacheResult(db: Database, result: RestrictionResult): void {
  try {
    const id = randomUUID();
    const expiresAt = result.checkedAt + CACHE_TTL_MS;

    db.run(
      `INSERT OR REPLACE INTO restriction_cache
        (id, product_id, platform, can_sell, restrictions, risk_level, recommendations, checked_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        result.productId,
        result.platform,
        result.canSell ? 1 : 0,
        JSON.stringify(result.restrictions),
        result.riskLevel,
        JSON.stringify(result.recommendations),
        result.checkedAt,
        expiresAt,
      ],
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ error: msg }, 'Failed to cache restriction result');
  }
}
