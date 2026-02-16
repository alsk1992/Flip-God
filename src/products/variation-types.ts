/**
 * Product Variation Types
 */

// =============================================================================
// VARIATION THEME
// =============================================================================

export type VariationTheme = 'Size' | 'Color' | 'SizeColor' | 'Style' | 'Material';

// =============================================================================
// VARIANT ATTRIBUTE
// =============================================================================

export interface VariantAttribute {
  size?: string;
  color?: string;
  style?: string;
  material?: string;
  pattern?: string;
  bundle_qty?: number;
}

// =============================================================================
// VARIATION GROUP
// =============================================================================

export interface VariationGroup {
  id: string;
  parent_product_id: string;
  theme: VariationTheme;
  created_at: number;
}

// =============================================================================
// VARIATION ITEM
// =============================================================================

export interface VariationItem {
  id: string;
  group_id: string;
  product_id: string;
  attributes: VariantAttribute;
  sku: string;
  created_at: number;
}

// =============================================================================
// PLATFORM MAPPING
// =============================================================================

export type PlatformVariationFormat = 'ebay' | 'amazon' | 'walmart';

/** eBay variation mapping */
export interface EbayVariationMapping {
  platform: 'ebay';
  itemSpecifics: Record<string, string>;
  variationSpecifics: Record<string, string>;
  /** Variation-level SKU */
  sku: string;
}

/** Amazon variation mapping */
export interface AmazonVariationMapping {
  platform: 'amazon';
  /** Variation theme (e.g. SizeColor, Size, Color) */
  variationTheme: string;
  /** Child ASIN relationship attributes */
  attributes: Record<string, string>;
  sku: string;
}

/** Walmart variation mapping */
export interface WalmartVariationMapping {
  platform: 'walmart';
  /** Variant group ID */
  variantGroupId: string;
  /** Variant attributes */
  attributes: Record<string, string>;
  sku: string;
}

export type PlatformVariationMapping =
  | EbayVariationMapping
  | AmazonVariationMapping
  | WalmartVariationMapping;

// =============================================================================
// VARIATION GROUP WITH ITEMS (for queries)
// =============================================================================

export interface VariationGroupWithItems extends VariationGroup {
  items: VariationItem[];
}
