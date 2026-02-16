/**
 * FBA Fee Calculator - Exact Amazon FBA fee calculations
 *
 * Implements Amazon's FBA fee structure including:
 * - Fulfillment fees (size tier + weight based)
 * - Referral fees (category based)
 * - Monthly storage fees (standard vs long-term)
 * - Variable closing fees (media items)
 */

// =============================================================================
// SIZE TIERS
// =============================================================================

export type SizeTier = 'small_standard' | 'large_standard' | 'small_oversize' | 'medium_oversize' | 'large_oversize' | 'special_oversize';

export interface ProductDimensions {
  lengthInches: number;
  widthInches: number;
  heightInches: number;
  weightLbs: number;
}

export function determineSizeTier(dims: ProductDimensions): SizeTier {
  const { lengthInches: l, widthInches: w, heightInches: h, weightLbs } = dims;
  const longest = Math.max(l, w, h);
  const median = [l, w, h].sort((a, b) => a - b)[1];
  const shortest = Math.min(l, w, h);
  const girth = 2 * (median + shortest);
  const lengthPlusGirth = longest + girth;
  const _dimWeight = (l * w * h) / 139; // dimensional weight (reserved for future oversize tier checks)

  // Small standard: max 15" x 12" x 0.75", up to 1 lb
  if (longest <= 15 && median <= 12 && shortest <= 0.75 && weightLbs <= 1) {
    return 'small_standard';
  }

  // Large standard: max 18" x 14" x 8", up to 20 lbs
  if (longest <= 18 && median <= 14 && shortest <= 8 && weightLbs <= 20) {
    return 'large_standard';
  }

  // Small oversize: max 60" longest, 30" median, 130" L+G, up to 70 lbs
  if (longest <= 60 && median <= 30 && lengthPlusGirth <= 130 && weightLbs <= 70) {
    return 'small_oversize';
  }

  // Medium oversize: max 108" longest, 130" L+G, up to 150 lbs
  if (longest <= 108 && lengthPlusGirth <= 130 && weightLbs <= 150) {
    return 'medium_oversize';
  }

  // Large oversize: max 108" longest, 165" L+G, up to 150 lbs
  if (longest <= 108 && lengthPlusGirth <= 165 && weightLbs <= 150) {
    return 'large_oversize';
  }

  return 'special_oversize';
}

// =============================================================================
// FULFILLMENT FEES (per unit)
// =============================================================================

export function calculateFulfillmentFee(sizeTier: SizeTier, weightLbs: number): number {
  // Shipping weight includes packaging
  const shippingWeight = weightLbs + getPackagingWeight(sizeTier);

  switch (sizeTier) {
    case 'small_standard':
      if (shippingWeight <= 0.25) return 3.22;
      if (shippingWeight <= 0.5) return 3.40;
      if (shippingWeight <= 0.75) return 3.58;
      return 3.77;

    case 'large_standard':
      if (shippingWeight <= 0.25) return 3.86;
      if (shippingWeight <= 0.5) return 4.08;
      if (shippingWeight <= 0.75) return 4.24;
      if (shippingWeight <= 1) return 4.75;
      if (shippingWeight <= 1.5) return 5.40;
      if (shippingWeight <= 2) return 5.69;
      if (shippingWeight <= 2.5) return 6.10;
      if (shippingWeight <= 3) return 6.39;
      // Over 3 lbs: $6.39 + $0.16 per half-lb above 3
      return 6.39 + Math.ceil((shippingWeight - 3) * 2) * 0.16;

    case 'small_oversize':
      // Base: $9.73 + $0.42 per lb above first lb
      return 9.73 + Math.max(0, Math.ceil(shippingWeight - 1)) * 0.42;

    case 'medium_oversize':
      return 19.05 + Math.max(0, Math.ceil(shippingWeight - 1)) * 0.42;

    case 'large_oversize':
      return 89.98 + Math.max(0, Math.ceil(shippingWeight - 90)) * 0.83;

    case 'special_oversize':
      return 158.49 + Math.max(0, Math.ceil(shippingWeight - 90)) * 0.83;
  }
}

function getPackagingWeight(sizeTier: SizeTier): number {
  switch (sizeTier) {
    case 'small_standard':
    case 'large_standard':
      return 0.25; // quarter pound for packaging
    default:
      return 1.0; // 1 lb for oversize
  }
}

// =============================================================================
// REFERRAL FEES (category-based percentage of sale price)
// =============================================================================

const REFERRAL_FEE_PCT: Record<string, { pct: number; min: number }> = {
  'amazon_device_accessories': { pct: 45, min: 0.30 },
  'appliances': { pct: 15, min: 0.30 },
  'automotive': { pct: 12, min: 0.30 },
  'baby': { pct: 8, min: 0.30 },
  'backpacks_handbags': { pct: 15, min: 0.30 },
  'beauty': { pct: 8, min: 0.30 },
  'books': { pct: 15, min: 0 },
  'camera': { pct: 8, min: 0.30 },
  'cell_phone_devices': { pct: 8, min: 0.30 },
  'clothing': { pct: 17, min: 0.30 },
  'computers': { pct: 8, min: 0.30 },
  'consumer_electronics': { pct: 8, min: 0.30 },
  'electronics_accessories': { pct: 15, min: 0.30 },
  'everything_else': { pct: 15, min: 0.30 },
  'furniture': { pct: 15, min: 0.30 },
  'grocery': { pct: 8, min: 0.30 },
  'health': { pct: 8, min: 0.30 },
  'home_garden': { pct: 15, min: 0.30 },
  'industrial_scientific': { pct: 12, min: 0.30 },
  'jewelry': { pct: 20, min: 0.30 },
  'kitchen': { pct: 15, min: 0.30 },
  'luggage': { pct: 15, min: 0.30 },
  'media': { pct: 15, min: 0 },
  'music': { pct: 15, min: 0 },
  'musical_instruments': { pct: 15, min: 0.30 },
  'office': { pct: 15, min: 0.30 },
  'outdoors': { pct: 15, min: 0.30 },
  'personal_care': { pct: 8, min: 0.30 },
  'pet': { pct: 15, min: 0.30 },
  'shoes': { pct: 15, min: 0.30 },
  'software': { pct: 15, min: 0 },
  'sports': { pct: 15, min: 0.30 },
  'tires': { pct: 10, min: 0.30 },
  'tools': { pct: 15, min: 0.30 },
  'toys': { pct: 15, min: 0.30 },
  'video_games': { pct: 15, min: 0 },
  'video_games_consoles': { pct: 8, min: 0.30 },
  'watches': { pct: 16, min: 0.30 },
  'default': { pct: 15, min: 0.30 },
};

function normalizeCategory(category?: string): string {
  if (!category) return 'default';
  const lower = category.toLowerCase()
    .replace(/&/g, '_and_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (REFERRAL_FEE_PCT[lower]) return lower;
  for (const key of Object.keys(REFERRAL_FEE_PCT)) {
    if (lower.includes(key) || key.includes(lower)) return key;
  }
  return 'default';
}

export function calculateReferralFee(salePrice: number, category?: string): number {
  const cat = normalizeCategory(category);
  const { pct, min } = REFERRAL_FEE_PCT[cat] ?? REFERRAL_FEE_PCT['default'];
  return Math.max((salePrice * pct) / 100, min);
}

// =============================================================================
// VARIABLE CLOSING FEE (media items only)
// =============================================================================

const MEDIA_CATEGORIES = new Set(['books', 'dvd', 'music', 'software', 'video_games', 'media']);

export function calculateClosingFee(category?: string): number {
  const cat = normalizeCategory(category);
  return MEDIA_CATEGORIES.has(cat) ? 1.80 : 0;
}

// =============================================================================
// MONTHLY STORAGE FEES
// =============================================================================

export function calculateMonthlyStorageFee(
  dims: ProductDimensions,
  month: number, // 1-12
  isHazmat: boolean = false,
): number {
  if (dims.lengthInches <= 0 || dims.widthInches <= 0 || dims.heightInches <= 0) return 0;
  const cubicFeet = (dims.lengthInches * dims.widthInches * dims.heightInches) / 1728;
  const sizeTier = determineSizeTier(dims);
  const isOversize = sizeTier !== 'small_standard' && sizeTier !== 'large_standard';

  // Jan-Sep vs Oct-Dec (peak season)
  const isPeak = month >= 10 && month <= 12;

  let rateCubicFoot: number;
  if (isHazmat) {
    rateCubicFoot = isPeak ? 1.20 : 0.99;
  } else if (isOversize) {
    rateCubicFoot = isPeak ? 2.40 : 0.78;
  } else {
    rateCubicFoot = isPeak ? 2.40 : 0.87;
  }

  return Math.round(cubicFeet * rateCubicFoot * 100) / 100;
}

// Long-term storage fees (365+ days aged inventory)
export function calculateLongTermStorageFee(dims: ProductDimensions, daysInStorage: number): number {
  if (daysInStorage < 271) return 0;
  const cubicFeet = (dims.lengthInches * dims.widthInches * dims.heightInches) / 1728;
  if (daysInStorage >= 365) {
    return Math.max(cubicFeet * 6.90, 0.15); // $6.90/cu ft or $0.15/unit min
  }
  if (daysInStorage >= 271) {
    return Math.max(cubicFeet * 1.50, 0.10); // surcharge for 271-365 day range
  }
  return 0;
}

// =============================================================================
// COMPLETE FBA FEE BREAKDOWN
// =============================================================================

export interface FBAFeeBreakdown {
  sizeTier: SizeTier;
  fulfillmentFee: number;
  referralFee: number;
  closingFee: number;
  monthlyStorageFee: number;
  totalPerUnit: number;
  netAfterFees: number;
}

export function calculateFBAFees(
  salePrice: number,
  dims: ProductDimensions,
  options: {
    category?: string;
    month?: number;
    isHazmat?: boolean;
  } = {},
): FBAFeeBreakdown {
  const sizeTier = determineSizeTier(dims);
  const fulfillmentFee = calculateFulfillmentFee(sizeTier, dims.weightLbs);
  const referralFee = calculateReferralFee(salePrice, options.category);
  const closingFee = calculateClosingFee(options.category);
  const monthlyStorageFee = calculateMonthlyStorageFee(
    dims, options.month ?? new Date().getMonth() + 1, options.isHazmat,
  );
  const totalPerUnit = fulfillmentFee + referralFee + closingFee + monthlyStorageFee;

  return {
    sizeTier,
    fulfillmentFee: Math.round(fulfillmentFee * 100) / 100,
    referralFee: Math.round(referralFee * 100) / 100,
    closingFee,
    monthlyStorageFee,
    totalPerUnit: Math.round(totalPerUnit * 100) / 100,
    netAfterFees: Math.round((salePrice - totalPerUnit) * 100) / 100,
  };
}
