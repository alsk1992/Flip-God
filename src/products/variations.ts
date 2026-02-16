/**
 * Product Variation Management
 *
 * Groups products as variations (size, color, material, etc.) and provides
 * platform-specific format conversion for eBay, Amazon, and Walmart.
 */

import { createLogger } from '../utils/logger';
import { generateId } from '../utils/id';
import type { Database } from '../db';
import type {
  VariationGroup,
  VariationItem,
  VariationGroupWithItems,
  VariationTheme,
  VariantAttribute,
  PlatformVariationMapping,
  PlatformVariationFormat,
} from './variation-types';

const logger = createLogger('variations');

// =============================================================================
// CREATE VARIATION GROUP
// =============================================================================

export interface CreateVariationInput {
  parent_product_id: string;
  theme: VariationTheme;
  variants: Array<{
    product_id: string;
    size?: string;
    color?: string;
    style?: string;
    material?: string;
    pattern?: string;
    bundle_qty?: number;
    sku?: string;
  }>;
}

/**
 * Create a variation group and add variant items.
 */
export function createVariationGroup(
  db: Database,
  input: CreateVariationInput,
): VariationGroupWithItems {
  const groupId = generateId('vg');
  const now = Date.now();

  const group: VariationGroup = {
    id: groupId,
    parent_product_id: input.parent_product_id,
    theme: input.theme,
    created_at: now,
  };

  try {
    db.run(
      `INSERT INTO variation_groups (id, parent_product_id, theme, created_at)
       VALUES (?, ?, ?, ?)`,
      [group.id, group.parent_product_id, group.theme, group.created_at],
    );
  } catch (err) {
    logger.error({ err, groupId }, 'Failed to create variation group');
    throw err;
  }

  const items: VariationItem[] = [];

  for (const variant of input.variants) {
    const itemId = generateId('vi');
    const attributes: VariantAttribute = {};

    if (variant.size !== undefined) attributes.size = variant.size;
    if (variant.color !== undefined) attributes.color = variant.color;
    if (variant.style !== undefined) attributes.style = variant.style;
    if (variant.material !== undefined) attributes.material = variant.material;
    if (variant.pattern !== undefined) attributes.pattern = variant.pattern;
    if (variant.bundle_qty !== undefined) attributes.bundle_qty = variant.bundle_qty;

    const sku = variant.sku ?? `${groupId}-${itemId.slice(-8)}`;

    const item: VariationItem = {
      id: itemId,
      group_id: groupId,
      product_id: variant.product_id,
      attributes,
      sku,
      created_at: now,
    };

    try {
      db.run(
        `INSERT INTO variation_items (id, group_id, product_id, attributes, sku, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [item.id, item.group_id, item.product_id, JSON.stringify(item.attributes), item.sku, item.created_at],
      );
      items.push(item);
    } catch (err) {
      logger.error({ err, itemId, productId: variant.product_id }, 'Failed to add variation item');
    }
  }

  logger.info({ groupId, theme: group.theme, variantCount: items.length }, 'Variation group created');
  return { ...group, items };
}

// =============================================================================
// GET VARIATION GROUP
// =============================================================================

/**
 * Get a variation group with all its variant items.
 */
export function getVariationGroup(
  db: Database,
  groupId: string,
): VariationGroupWithItems | null {
  try {
    const groupRows = db.query<Record<string, unknown>>(
      'SELECT * FROM variation_groups WHERE id = ?',
      [groupId],
    );

    if (groupRows.length === 0) return null;

    const group = parseGroupRow(groupRows[0]);
    const itemRows = db.query<Record<string, unknown>>(
      'SELECT * FROM variation_items WHERE group_id = ? ORDER BY created_at ASC',
      [groupId],
    );

    const items = itemRows.map(parseItemRow);
    return { ...group, items };
  } catch (err) {
    logger.error({ err, groupId }, 'Failed to get variation group');
    return null;
  }
}

// =============================================================================
// LIST VARIATION GROUPS
// =============================================================================

export interface ListVariationOptions {
  limit?: number;
  offset?: number;
  parent_product_id?: string;
}

/**
 * List variation groups with optional filtering.
 */
export function listVariationGroups(
  db: Database,
  options?: ListVariationOptions,
): VariationGroupWithItems[] {
  const limit = Math.min(options?.limit ?? 20, 100);
  const offset = options?.offset ?? 0;

  try {
    let sql: string;
    let params: unknown[];

    if (options?.parent_product_id) {
      sql = 'SELECT * FROM variation_groups WHERE parent_product_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params = [options.parent_product_id, limit, offset];
    } else {
      sql = 'SELECT * FROM variation_groups ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params = [limit, offset];
    }

    const groupRows = db.query<Record<string, unknown>>(sql, params);
    const results: VariationGroupWithItems[] = [];

    for (const row of groupRows) {
      const group = parseGroupRow(row);
      const itemRows = db.query<Record<string, unknown>>(
        'SELECT * FROM variation_items WHERE group_id = ? ORDER BY created_at ASC',
        [group.id],
      );
      const items = itemRows.map(parseItemRow);
      results.push({ ...group, items });
    }

    return results;
  } catch (err) {
    logger.error({ err }, 'Failed to list variation groups');
    return [];
  }
}

// =============================================================================
// DELETE VARIATION GROUP
// =============================================================================

/**
 * Delete a variation group and all its items.
 */
export function deleteVariationGroup(db: Database, groupId: string): boolean {
  try {
    db.run('DELETE FROM variation_items WHERE group_id = ?', [groupId]);
    db.run('DELETE FROM variation_groups WHERE id = ?', [groupId]);
    logger.info({ groupId }, 'Variation group deleted');
    return true;
  } catch (err) {
    logger.error({ err, groupId }, 'Failed to delete variation group');
    return false;
  }
}

// =============================================================================
// PLATFORM MAPPING
// =============================================================================

/**
 * Convert an internal variation item to a platform-specific format.
 */
export function mapVariationToPlatform(
  variant: VariationItem,
  platform: PlatformVariationFormat,
  groupTheme: VariationTheme,
  groupId: string,
): PlatformVariationMapping {
  const attrs = variant.attributes;

  switch (platform) {
    case 'ebay': {
      // eBay uses Item Specifics for variations
      const itemSpecifics: Record<string, string> = {};
      const variationSpecifics: Record<string, string> = {};

      if (attrs.size) {
        itemSpecifics['Size'] = attrs.size;
        variationSpecifics['Size'] = attrs.size;
      }
      if (attrs.color) {
        itemSpecifics['Color'] = attrs.color;
        variationSpecifics['Color'] = attrs.color;
      }
      if (attrs.style) {
        itemSpecifics['Style'] = attrs.style;
        variationSpecifics['Style'] = attrs.style;
      }
      if (attrs.material) {
        itemSpecifics['Material'] = attrs.material;
        variationSpecifics['Material'] = attrs.material;
      }
      if (attrs.pattern) {
        itemSpecifics['Pattern'] = attrs.pattern;
      }

      return {
        platform: 'ebay',
        itemSpecifics,
        variationSpecifics,
        sku: variant.sku,
      };
    }

    case 'amazon': {
      // Amazon uses variation themes with child ASINs
      const attributes: Record<string, string> = {};

      // Map theme to Amazon variation theme naming
      const amazonTheme = mapThemeToAmazon(groupTheme);

      if (attrs.size) attributes['size_name'] = attrs.size;
      if (attrs.color) attributes['color_name'] = attrs.color;
      if (attrs.style) attributes['style_name'] = attrs.style;
      if (attrs.material) attributes['material_type'] = attrs.material;

      return {
        platform: 'amazon',
        variationTheme: amazonTheme,
        attributes,
        sku: variant.sku,
      };
    }

    case 'walmart': {
      // Walmart uses variant groups
      const attributes: Record<string, string> = {};

      if (attrs.size) attributes['size'] = attrs.size;
      if (attrs.color) attributes['color'] = attrs.color;
      if (attrs.style) attributes['clothingStyle'] = attrs.style;
      if (attrs.material) attributes['material'] = attrs.material;

      return {
        platform: 'walmart',
        variantGroupId: groupId,
        attributes,
        sku: variant.sku,
      };
    }

    default: {
      // Fallback to eBay format
      logger.warn({ platform }, 'Unknown platform for variation mapping, using eBay format');
      return {
        platform: 'ebay',
        itemSpecifics: {},
        variationSpecifics: {},
        sku: variant.sku,
      };
    }
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function mapThemeToAmazon(theme: VariationTheme): string {
  switch (theme) {
    case 'Size': return 'Size';
    case 'Color': return 'Color';
    case 'SizeColor': return 'SizeColor';
    case 'Style': return 'StyleName';
    case 'Material': return 'MaterialType';
    default: return 'Size';
  }
}

function parseGroupRow(row: Record<string, unknown>): VariationGroup {
  return {
    id: row.id as string,
    parent_product_id: row.parent_product_id as string,
    theme: row.theme as VariationTheme,
    created_at: (row.created_at as number) ?? Date.now(),
  };
}

function parseItemRow(row: Record<string, unknown>): VariationItem {
  let attributes: VariantAttribute = {};
  try {
    attributes = JSON.parse((row.attributes as string) ?? '{}');
  } catch {
    attributes = {};
  }

  return {
    id: row.id as string,
    group_id: row.group_id as string,
    product_id: row.product_id as string,
    attributes,
    sku: row.sku as string,
    created_at: (row.created_at as number) ?? Date.now(),
  };
}
