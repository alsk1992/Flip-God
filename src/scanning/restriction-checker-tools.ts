/**
 * Restriction Checker Tools - LLM-callable tool definitions and handler
 *
 * Provides tools to check product restrictions, manage restricted brands
 * and categories, and view restriction statistics.
 */

import type { Database } from '../db/index.js';
import {
  checkProductRestrictions,
  batchCheckRestrictions,
  getRestrictedBrands,
  addRestrictedBrand,
  removeRestrictedBrand,
  getRestrictedCategories,
  addRestrictedCategory,
  removeRestrictedCategory,
  getRestrictionStats,
  seedDefaultRestrictions,
} from './restriction-checker.js';
import type { RestrictionType, ProductInfo } from './restriction-checker.js';

// =============================================================================
// Tool Definitions
// =============================================================================

export const restrictionCheckerTools = [
  {
    name: 'check_restrictions',
    description:
      'Check if a product can be sold on a platform — detects gated brands, restricted categories, hazmat, counterfeit risk, and more',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: {
          type: 'string' as const,
          description: 'Product ID to check',
        },
        platform: {
          type: 'string' as const,
          description: 'Target selling platform (e.g. amazon, ebay, walmart)',
        },
        name: {
          type: 'string' as const,
          description: 'Product name/title (for keyword detection)',
        },
        brand: {
          type: 'string' as const,
          description: 'Product brand name',
        },
        category: {
          type: 'string' as const,
          description: 'Product category',
        },
        asin: {
          type: 'string' as const,
          description: 'Amazon ASIN (optional)',
        },
        upc: {
          type: 'string' as const,
          description: 'UPC barcode (optional)',
        },
      },
      required: ['product_id', 'platform'] as const,
    },
    metadata: {
      category: 'scanning',
      tags: ['restriction', 'gated', 'brand', 'check', 'compliance'],
    },
  },
  {
    name: 'batch_check_restrictions',
    description:
      'Check restrictions for multiple products at once on a target platform',
    input_schema: {
      type: 'object' as const,
      properties: {
        products: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              product_id: { type: 'string' as const, description: 'Product ID' },
              name: { type: 'string' as const, description: 'Product name' },
              brand: { type: 'string' as const, description: 'Brand name' },
              category: { type: 'string' as const, description: 'Category' },
              asin: { type: 'string' as const, description: 'ASIN' },
              upc: { type: 'string' as const, description: 'UPC' },
            },
            required: ['product_id'] as const,
          },
          description: 'Array of products to check',
        },
        platform: {
          type: 'string' as const,
          description: 'Target selling platform',
        },
      },
      required: ['products', 'platform'] as const,
    },
    metadata: {
      category: 'scanning',
      tags: ['restriction', 'batch', 'check', 'compliance'],
    },
  },
  {
    name: 'restricted_brands_list',
    description: 'List known restricted/gated brands, optionally filtered by platform',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string' as const,
          description: 'Filter by platform (optional — shows all if omitted)',
        },
      },
    },
    metadata: {
      category: 'scanning',
      tags: ['restriction', 'brand', 'list', 'gated'],
    },
  },
  {
    name: 'restricted_brands_add',
    description: 'Add a brand to the restricted brands list',
    input_schema: {
      type: 'object' as const,
      properties: {
        brand: {
          type: 'string' as const,
          description: 'Brand name to restrict',
        },
        platform: {
          type: 'string' as const,
          description: 'Platform this restriction applies to (use * for all)',
        },
        restriction_type: {
          type: 'string' as const,
          enum: [
            'brand_restricted',
            'ip_risk',
            'approval_required',
            'counterfeit_risk',
          ],
          description: 'Type of restriction',
        },
        notes: {
          type: 'string' as const,
          description: 'Optional notes about this restriction',
        },
      },
      required: ['brand', 'platform', 'restriction_type'] as const,
    },
    metadata: {
      category: 'scanning',
      tags: ['restriction', 'brand', 'add', 'manage'],
    },
  },
  {
    name: 'restricted_brands_remove',
    description: 'Remove a brand from the restricted brands list',
    input_schema: {
      type: 'object' as const,
      properties: {
        brand: {
          type: 'string' as const,
          description: 'Brand name to remove',
        },
        platform: {
          type: 'string' as const,
          description: 'Platform to remove restriction from',
        },
      },
      required: ['brand', 'platform'] as const,
    },
    metadata: {
      category: 'scanning',
      tags: ['restriction', 'brand', 'remove', 'manage'],
    },
  },
  {
    name: 'restricted_categories_list',
    description: 'List known restricted/gated categories, optionally filtered by platform',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string' as const,
          description: 'Filter by platform (optional — shows all if omitted)',
        },
      },
    },
    metadata: {
      category: 'scanning',
      tags: ['restriction', 'category', 'list', 'gated'],
    },
  },
  {
    name: 'restricted_categories_add',
    description: 'Add a category to the restricted categories list',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string' as const,
          description: 'Category name to restrict',
        },
        platform: {
          type: 'string' as const,
          description: 'Platform this restriction applies to (use * for all)',
        },
        restriction_type: {
          type: 'string' as const,
          enum: [
            'category_gated',
            'approval_required',
            'age_restricted',
            'region_restricted',
          ],
          description: 'Type of restriction',
        },
        notes: {
          type: 'string' as const,
          description: 'Optional notes about this restriction',
        },
      },
      required: ['category', 'platform', 'restriction_type'] as const,
    },
    metadata: {
      category: 'scanning',
      tags: ['restriction', 'category', 'add', 'manage'],
    },
  },
  {
    name: 'restriction_stats',
    description:
      'Get restriction checking statistics — total checked, % blocked, most common restriction types',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
    metadata: {
      category: 'scanning',
      tags: ['restriction', 'stats', 'analytics'],
    },
  },
  {
    name: 'seed_restrictions',
    description:
      'Manually seed the default restricted brands and categories (Nike, LEGO, Chanel, etc.)',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
    metadata: {
      category: 'scanning',
      tags: ['restriction', 'seed', 'setup', 'initialize'],
    },
  },
];

// =============================================================================
// Validation helpers
// =============================================================================

const VALID_RESTRICTION_TYPES = new Set<string>([
  'category_gated',
  'brand_restricted',
  'approval_required',
  'ip_risk',
  'hazmat',
  'recalled',
  'counterfeit_risk',
  'age_restricted',
  'region_restricted',
  'license_required',
]);

// =============================================================================
// Tool Handler
// =============================================================================

/**
 * Handle a restriction checker tool call. Returns a result object with
 * `status` and either `data` or `message`.
 */
export function handleRestrictionCheckerTool(
  name: string,
  input: Record<string, unknown>,
  db: Database,
): unknown {
  try {
    switch (name) {
      // ── check_restrictions ─────────────────────────────────────────────
      case 'check_restrictions': {
        const productId = input.product_id as string | undefined;
        const platform = input.platform as string | undefined;

        if (!productId?.trim()) {
          return { status: 'error', message: 'product_id is required' };
        }
        if (!platform?.trim()) {
          return { status: 'error', message: 'platform is required' };
        }

        // Ensure seed data is present
        seedDefaultRestrictions(db);

        const productInfo: ProductInfo = {};
        if (typeof input.name === 'string' && input.name.trim()) {
          productInfo.name = input.name.trim();
        }
        if (typeof input.brand === 'string' && input.brand.trim()) {
          productInfo.brand = input.brand.trim();
        }
        if (typeof input.category === 'string' && input.category.trim()) {
          productInfo.category = input.category.trim();
        }
        if (typeof input.asin === 'string' && input.asin.trim()) {
          productInfo.asin = input.asin.trim();
        }
        if (typeof input.upc === 'string' && input.upc.trim()) {
          productInfo.upc = input.upc.trim();
        }

        const hasInfo = Object.keys(productInfo).length > 0;
        const result = checkProductRestrictions(
          db,
          productId.trim(),
          platform.trim(),
          hasInfo ? productInfo : undefined,
        );

        return {
          status: 'ok',
          data: {
            ...result,
            summary: result.canSell
              ? `Product can be sold on ${platform} (risk: ${result.riskLevel})`
              : `Product CANNOT be sold on ${platform} — ${result.restrictions.filter((r) => r.severity === 'block').length} blocking restriction(s)`,
          },
        };
      }

      // ── batch_check_restrictions ───────────────────────────────────────
      case 'batch_check_restrictions': {
        const productsRaw = input.products;
        const platform = input.platform as string | undefined;

        if (!platform?.trim()) {
          return { status: 'error', message: 'platform is required' };
        }

        if (!Array.isArray(productsRaw) || productsRaw.length === 0) {
          return { status: 'error', message: 'products array is required and must not be empty' };
        }

        if (productsRaw.length > 100) {
          return { status: 'error', message: 'Maximum 100 products per batch' };
        }

        // Ensure seed data is present
        seedDefaultRestrictions(db);

        const products = productsRaw.map((p: Record<string, unknown>) => ({
          productId: String(p.product_id ?? ''),
          productInfo: {
            name: typeof p.name === 'string' ? p.name : undefined,
            brand: typeof p.brand === 'string' ? p.brand : undefined,
            category: typeof p.category === 'string' ? p.category : undefined,
            asin: typeof p.asin === 'string' ? p.asin : undefined,
            upc: typeof p.upc === 'string' ? p.upc : undefined,
          } as ProductInfo,
        }));

        const results = batchCheckRestrictions(db, products, platform.trim());

        const blocked = results.filter((r) => !r.canSell).length;
        const highRisk = results.filter((r) => r.riskLevel === 'high').length;

        return {
          status: 'ok',
          data: {
            results,
            summary: {
              total: results.length,
              canSell: results.length - blocked,
              blocked,
              highRisk,
              platform: platform.trim(),
            },
          },
        };
      }

      // ── restricted_brands_list ─────────────────────────────────────────
      case 'restricted_brands_list': {
        // Ensure seed data is present
        seedDefaultRestrictions(db);

        const platform =
          typeof input.platform === 'string' && input.platform.trim()
            ? input.platform.trim()
            : undefined;

        const brands = getRestrictedBrands(db, platform);

        return {
          status: 'ok',
          data: {
            brands: brands.map((b) => ({
              id: b.id,
              brand: b.brand_name,
              platform: b.platform,
              restrictionType: b.restriction_type,
              notes: b.notes,
            })),
            count: brands.length,
            filter: platform ?? 'all',
          },
        };
      }

      // ── restricted_brands_add ──────────────────────────────────────────
      case 'restricted_brands_add': {
        const brand = input.brand as string | undefined;
        const platform = input.platform as string | undefined;
        const restrictionType = input.restriction_type as string | undefined;

        if (!brand?.trim()) {
          return { status: 'error', message: 'brand is required' };
        }
        if (!platform?.trim()) {
          return { status: 'error', message: 'platform is required' };
        }
        if (!restrictionType?.trim() || !VALID_RESTRICTION_TYPES.has(restrictionType)) {
          return {
            status: 'error',
            message: `restriction_type must be one of: ${Array.from(VALID_RESTRICTION_TYPES).join(', ')}`,
          };
        }

        const notes = typeof input.notes === 'string' ? input.notes.trim() : undefined;

        const result = addRestrictedBrand(
          db,
          brand.trim(),
          platform.trim(),
          restrictionType as RestrictionType,
          notes || undefined,
        );

        return {
          status: 'ok',
          data: {
            ...result,
            brand: brand.trim(),
            platform: platform.trim(),
            restrictionType,
          },
        };
      }

      // ── restricted_brands_remove ───────────────────────────────────────
      case 'restricted_brands_remove': {
        const brand = input.brand as string | undefined;
        const platform = input.platform as string | undefined;

        if (!brand?.trim()) {
          return { status: 'error', message: 'brand is required' };
        }
        if (!platform?.trim()) {
          return { status: 'error', message: 'platform is required' };
        }

        const removed = removeRestrictedBrand(db, brand.trim(), platform.trim());

        if (!removed) {
          return {
            status: 'error',
            message: `No restriction found for brand "${brand}" on platform "${platform}"`,
          };
        }

        return {
          status: 'ok',
          data: {
            brand: brand.trim(),
            platform: platform.trim(),
            removed: true,
          },
        };
      }

      // ── restricted_categories_list ─────────────────────────────────────
      case 'restricted_categories_list': {
        // Ensure seed data is present
        seedDefaultRestrictions(db);

        const platform =
          typeof input.platform === 'string' && input.platform.trim()
            ? input.platform.trim()
            : undefined;

        const categories = getRestrictedCategories(db, platform);

        return {
          status: 'ok',
          data: {
            categories: categories.map((c) => ({
              id: c.id,
              category: c.category_name,
              platform: c.platform,
              restrictionType: c.restriction_type,
              notes: c.notes,
            })),
            count: categories.length,
            filter: platform ?? 'all',
          },
        };
      }

      // ── restricted_categories_add ──────────────────────────────────────
      case 'restricted_categories_add': {
        const category = input.category as string | undefined;
        const platform = input.platform as string | undefined;
        const restrictionType = input.restriction_type as string | undefined;

        if (!category?.trim()) {
          return { status: 'error', message: 'category is required' };
        }
        if (!platform?.trim()) {
          return { status: 'error', message: 'platform is required' };
        }
        if (!restrictionType?.trim() || !VALID_RESTRICTION_TYPES.has(restrictionType)) {
          return {
            status: 'error',
            message: `restriction_type must be one of: ${Array.from(VALID_RESTRICTION_TYPES).join(', ')}`,
          };
        }

        const notes = typeof input.notes === 'string' ? input.notes.trim() : undefined;

        const result = addRestrictedCategory(
          db,
          category.trim(),
          platform.trim(),
          restrictionType as RestrictionType,
          notes || undefined,
        );

        return {
          status: 'ok',
          data: {
            ...result,
            category: category.trim(),
            platform: platform.trim(),
            restrictionType,
          },
        };
      }

      // ── restriction_stats ──────────────────────────────────────────────
      case 'restriction_stats': {
        const stats = getRestrictionStats(db);
        return { status: 'ok', data: stats };
      }

      // ── seed_restrictions ──────────────────────────────────────────────
      case 'seed_restrictions': {
        seedDefaultRestrictions(db);
        const brands = getRestrictedBrands(db);
        const categories = getRestrictedCategories(db);

        return {
          status: 'ok',
          data: {
            message: 'Default restrictions seeded successfully',
            brands: brands.length,
            categories: categories.length,
          },
        };
      }

      default:
        return { status: 'error', message: `Unknown restriction tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'error', message };
  }
}
