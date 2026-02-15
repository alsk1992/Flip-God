/**
 * Restriction Database — Known gated brands, restricted categories, hazmat keywords
 *
 * This is a built-in database of commonly known restrictions. In production,
 * this should be supplemented with real-time API checks (e.g., Amazon SP-API
 * Product Type Definitions API or third-party services like IP Alert).
 */

import type { BrandRecord, CategoryRestriction, HazmatKeyword } from './types';

// =============================================================================
// KNOWN GATED BRANDS (frequently reported, as of 2025)
// =============================================================================

const GATED_BRANDS: BrandRecord[] = [
  // Tech
  { brand: 'Apple', ipComplaintCount: 500, isGated: true, gatingDifficulty: 'hard', lastUpdated: new Date('2025-01-01') },
  { brand: 'Samsung', ipComplaintCount: 300, isGated: true, gatingDifficulty: 'medium', lastUpdated: new Date('2025-01-01') },
  { brand: 'Sony', ipComplaintCount: 200, isGated: true, gatingDifficulty: 'medium', lastUpdated: new Date('2025-01-01') },
  { brand: 'Microsoft', ipComplaintCount: 150, isGated: true, gatingDifficulty: 'medium', lastUpdated: new Date('2025-01-01') },
  { brand: 'Nintendo', ipComplaintCount: 400, isGated: true, gatingDifficulty: 'hard', lastUpdated: new Date('2025-01-01') },
  { brand: 'Bose', ipComplaintCount: 250, isGated: true, gatingDifficulty: 'hard', lastUpdated: new Date('2025-01-01') },
  { brand: 'JBL', ipComplaintCount: 100, isGated: true, gatingDifficulty: 'medium', lastUpdated: new Date('2025-01-01') },
  { brand: 'Beats', ipComplaintCount: 300, isGated: true, gatingDifficulty: 'hard', lastUpdated: new Date('2025-01-01') },
  { brand: 'DJI', ipComplaintCount: 150, isGated: true, gatingDifficulty: 'hard', lastUpdated: new Date('2025-01-01') },
  { brand: 'GoPro', ipComplaintCount: 100, isGated: true, gatingDifficulty: 'medium', lastUpdated: new Date('2025-01-01') },
  
  // Fashion/Luxury
  { brand: 'Nike', ipComplaintCount: 800, isGated: true, gatingDifficulty: 'hard', lastUpdated: new Date('2025-01-01') },
  { brand: 'Adidas', ipComplaintCount: 500, isGated: true, gatingDifficulty: 'hard', lastUpdated: new Date('2025-01-01') },
  { brand: 'Under Armour', ipComplaintCount: 200, isGated: true, gatingDifficulty: 'medium', lastUpdated: new Date('2025-01-01') },
  { brand: 'North Face', ipComplaintCount: 150, isGated: true, gatingDifficulty: 'medium', lastUpdated: new Date('2025-01-01') },
  { brand: 'Ray-Ban', ipComplaintCount: 300, isGated: true, gatingDifficulty: 'hard', lastUpdated: new Date('2025-01-01') },
  { brand: 'Oakley', ipComplaintCount: 200, isGated: true, gatingDifficulty: 'hard', lastUpdated: new Date('2025-01-01') },
  { brand: 'Calvin Klein', ipComplaintCount: 150, isGated: true, gatingDifficulty: 'medium', lastUpdated: new Date('2025-01-01') },
  
  // Toys
  { brand: 'LEGO', ipComplaintCount: 600, isGated: true, gatingDifficulty: 'hard', lastUpdated: new Date('2025-01-01') },
  { brand: 'Hasbro', ipComplaintCount: 400, isGated: true, gatingDifficulty: 'hard', lastUpdated: new Date('2025-01-01') },
  { brand: 'Mattel', ipComplaintCount: 300, isGated: true, gatingDifficulty: 'medium', lastUpdated: new Date('2025-01-01') },
  { brand: 'Disney', ipComplaintCount: 700, isGated: true, gatingDifficulty: 'hard', lastUpdated: new Date('2025-01-01') },
  
  // Beauty/Health
  { brand: 'Chanel', ipComplaintCount: 500, isGated: true, gatingDifficulty: 'impossible', lastUpdated: new Date('2025-01-01') },
  { brand: 'Dior', ipComplaintCount: 400, isGated: true, gatingDifficulty: 'impossible', lastUpdated: new Date('2025-01-01') },
  { brand: 'MAC Cosmetics', ipComplaintCount: 200, isGated: true, gatingDifficulty: 'hard', lastUpdated: new Date('2025-01-01') },
  { brand: 'Olay', ipComplaintCount: 100, isGated: true, gatingDifficulty: 'medium', lastUpdated: new Date('2025-01-01') },
  
  // Home
  { brand: 'Dyson', ipComplaintCount: 300, isGated: true, gatingDifficulty: 'hard', lastUpdated: new Date('2025-01-01') },
  { brand: 'KitchenAid', ipComplaintCount: 100, isGated: true, gatingDifficulty: 'medium', lastUpdated: new Date('2025-01-01') },
  { brand: 'Yeti', ipComplaintCount: 200, isGated: true, gatingDifficulty: 'medium', lastUpdated: new Date('2025-01-01') },
  { brand: 'Vitamix', ipComplaintCount: 100, isGated: true, gatingDifficulty: 'medium', lastUpdated: new Date('2025-01-01') },
];

// =============================================================================
// RESTRICTED CATEGORIES
// =============================================================================

const RESTRICTED_CATEGORIES: CategoryRestriction[] = [
  { category: 'Grocery & Gourmet Food', isRestricted: true, requiresApproval: true, requiresInvoice: true },
  { category: 'Topicals', isRestricted: true, requiresApproval: true, requiresInvoice: true, notes: 'FDA-regulated' },
  { category: 'Supplements', isRestricted: true, requiresApproval: true, requiresInvoice: true, notes: 'FDA-regulated' },
  { category: 'Fine Art', isRestricted: true, requiresApproval: true, requiresInvoice: false },
  { category: 'Collectible Coins', isRestricted: true, requiresApproval: true, requiresInvoice: false },
  { category: 'Jewelry', isRestricted: true, requiresApproval: true, requiresInvoice: true },
  { category: 'Watches', isRestricted: true, requiresApproval: true, requiresInvoice: true },
  { category: 'Music', isRestricted: true, requiresApproval: true, requiresInvoice: false },
  { category: 'DVD & Blu-ray', isRestricted: true, requiresApproval: true, requiresInvoice: false },
  { category: 'Automotive', isRestricted: false, requiresApproval: false, requiresInvoice: false, notes: 'Some subcategories restricted' },
  { category: 'Clothing & Accessories', isRestricted: false, requiresApproval: false, requiresInvoice: false, notes: 'Many brands gated individually' },
  { category: 'Personal Care Appliances', isRestricted: true, requiresApproval: true, requiresInvoice: true },
  { category: 'Sexual Wellness', isRestricted: true, requiresApproval: true, requiresInvoice: true },
  { category: 'Industrial & Scientific', isRestricted: true, requiresApproval: true, requiresInvoice: true },
  { category: 'Alcohol', isRestricted: true, requiresApproval: true, requiresInvoice: true, notes: 'Requires state licenses' },
];

// =============================================================================
// HAZMAT KEYWORDS
// =============================================================================

const HAZMAT_KEYWORDS: HazmatKeyword[] = [
  { keyword: 'lithium battery', hazmatClass: 'Class 9 Miscellaneous', additionalFee: 0.11 },
  { keyword: 'lithium-ion', hazmatClass: 'Class 9 Miscellaneous', additionalFee: 0.11 },
  { keyword: 'li-ion', hazmatClass: 'Class 9 Miscellaneous', additionalFee: 0.11 },
  { keyword: 'lipo', hazmatClass: 'Class 9 Miscellaneous', additionalFee: 0.11 },
  { keyword: 'aerosol', hazmatClass: 'Class 2.1/2.2 Gases', additionalFee: 0.11 },
  { keyword: 'spray paint', hazmatClass: 'Class 2.1 Flammable Gas', additionalFee: 0.11 },
  { keyword: 'nail polish', hazmatClass: 'Class 3 Flammable Liquid', additionalFee: 0.11 },
  { keyword: 'perfume', hazmatClass: 'Class 3 Flammable Liquid', additionalFee: 0.11 },
  { keyword: 'cologne', hazmatClass: 'Class 3 Flammable Liquid', additionalFee: 0.11 },
  { keyword: 'hand sanitizer', hazmatClass: 'Class 3 Flammable Liquid', additionalFee: 0.11 },
  { keyword: 'rubbing alcohol', hazmatClass: 'Class 3 Flammable Liquid', additionalFee: 0.11 },
  { keyword: 'bleach', hazmatClass: 'Class 8 Corrosive', additionalFee: 0.11 },
  { keyword: 'acid', hazmatClass: 'Class 8 Corrosive', additionalFee: 0.11 },
  { keyword: 'pesticide', hazmatClass: 'Class 6.1 Toxic', additionalFee: 0.11 },
  { keyword: 'insecticide', hazmatClass: 'Class 6.1 Toxic', additionalFee: 0.11 },
  { keyword: 'fertilizer', hazmatClass: 'Class 5.1 Oxidizer', additionalFee: 0.11 },
  { keyword: 'propane', hazmatClass: 'Class 2.1 Flammable Gas', additionalFee: 0.11 },
  { keyword: 'butane', hazmatClass: 'Class 2.1 Flammable Gas', additionalFee: 0.11 },
  { keyword: 'lighter', hazmatClass: 'Class 2.1 Flammable Gas', additionalFee: 0.11 },
  { keyword: 'ammunition', hazmatClass: 'Class 1.4 Explosives', additionalFee: 0.11 },
  { keyword: 'fireworks', hazmatClass: 'Class 1.4 Explosives', additionalFee: 0.11 },
];

// =============================================================================
// LOOKUP FUNCTIONS
// =============================================================================

export function lookupBrand(brand: string): BrandRecord | null {
  const lower = brand.toLowerCase();
  return GATED_BRANDS.find(b => b.brand.toLowerCase() === lower) ?? null;
}

export function lookupCategory(category: string): CategoryRestriction | null {
  const lower = category.toLowerCase();
  return RESTRICTED_CATEGORIES.find(c => c.category.toLowerCase() === lower || lower.includes(c.category.toLowerCase())) ?? null;
}

export function checkHazmat(title: string, description?: string): HazmatKeyword | null {
  const text = `${title} ${description ?? ''}`.toLowerCase();
  return HAZMAT_KEYWORDS.find(h => text.includes(h.keyword)) ?? null;
}

export function getAllGatedBrands(): BrandRecord[] {
  return [...GATED_BRANDS];
}

export function getAllRestrictedCategories(): CategoryRestriction[] {
  return [...RESTRICTED_CATEGORIES];
}
