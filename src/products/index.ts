/**
 * Product Variation Tool Definitions & Handler
 *
 * Exports tool definitions and a handler function for variation management.
 * Wire these into the agent tool registry.
 */

import type { Database } from '../db';
import {
  createVariationGroup,
  getVariationGroup,
  listVariationGroups,
  deleteVariationGroup,
  mapVariationToPlatform,
} from './variations';
import type { VariationTheme, PlatformVariationFormat } from './variation-types';
import { createLogger } from '../utils/logger';

const logger = createLogger('variation-tools');

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const variationTools = [
  {
    name: 'create_variation_group',
    description: 'Group products as variations (size/color variants)',
    input_schema: {
      type: 'object' as const,
      properties: {
        parent_product_id: { type: 'string' as const, description: 'Main/parent product ID' },
        theme: {
          type: 'string' as const,
          enum: ['Size', 'Color', 'SizeColor', 'Style', 'Material'],
          description: 'Variation theme',
        },
        variants: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              product_id: { type: 'string' as const },
              size: { type: 'string' as const },
              color: { type: 'string' as const },
              style: { type: 'string' as const },
              material: { type: 'string' as const },
              sku: { type: 'string' as const },
            },
          },
        },
      },
      required: ['parent_product_id', 'theme', 'variants'],
    },
  },
  {
    name: 'list_variation_groups',
    description: 'List all variation groups',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number' as const, default: 20 },
      },
    },
  },
  {
    name: 'get_variation_group',
    description: 'Get details of a variation group and its variants',
    input_schema: {
      type: 'object' as const,
      properties: {
        group_id: { type: 'string' as const },
      },
      required: ['group_id'],
    },
  },
];

// =============================================================================
// HANDLER
// =============================================================================

export interface VariationHandlerContext {
  db: Database;
  userId?: string;
}

/**
 * Handle variation tool calls.
 *
 * @returns A string result suitable for returning to the agent.
 */
export async function handleVariationTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: VariationHandlerContext,
): Promise<string> {
  const { db } = ctx;

  try {
    switch (toolName) {
      case 'create_variation_group': {
        const parentProductId = input.parent_product_id as string;
        const theme = input.theme as VariationTheme;
        const variants = input.variants as Array<{
          product_id: string;
          size?: string;
          color?: string;
          style?: string;
          material?: string;
          sku?: string;
        }>;

        if (!parentProductId) {
          return JSON.stringify({ success: false, error: 'parent_product_id is required' });
        }
        if (!theme) {
          return JSON.stringify({ success: false, error: 'theme is required' });
        }
        if (!variants || variants.length === 0) {
          return JSON.stringify({ success: false, error: 'At least one variant is required' });
        }

        const group = createVariationGroup(db, {
          parent_product_id: parentProductId,
          theme,
          variants,
        });

        return JSON.stringify({
          success: true,
          group: {
            id: group.id,
            parent_product_id: group.parent_product_id,
            theme: group.theme,
            variant_count: group.items.length,
            variants: group.items.map(item => ({
              id: item.id,
              product_id: item.product_id,
              sku: item.sku,
              attributes: item.attributes,
            })),
          },
          message: `Variation group created with ${group.items.length} variants`,
        });
      }

      case 'list_variation_groups': {
        const limit = input.limit != null ? Number(input.limit) : 20;
        const groups = listVariationGroups(db, { limit });

        return JSON.stringify({
          success: true,
          count: groups.length,
          groups: groups.map(g => ({
            id: g.id,
            parent_product_id: g.parent_product_id,
            theme: g.theme,
            variant_count: g.items.length,
            variants: g.items.map(item => ({
              id: item.id,
              product_id: item.product_id,
              sku: item.sku,
              attributes: item.attributes,
            })),
            created_at: new Date(g.created_at).toISOString(),
          })),
        });
      }

      case 'get_variation_group': {
        const groupId = input.group_id as string;
        if (!groupId) {
          return JSON.stringify({ success: false, error: 'group_id is required' });
        }

        const group = getVariationGroup(db, groupId);
        if (!group) {
          return JSON.stringify({ success: false, error: `Variation group ${groupId} not found` });
        }

        // Also generate platform mappings for reference
        const platformMappings: Record<string, unknown[]> = {};
        for (const platform of ['ebay', 'amazon', 'walmart'] as PlatformVariationFormat[]) {
          platformMappings[platform] = group.items.map(item =>
            mapVariationToPlatform(item, platform, group.theme, group.id),
          );
        }

        return JSON.stringify({
          success: true,
          group: {
            id: group.id,
            parent_product_id: group.parent_product_id,
            theme: group.theme,
            variant_count: group.items.length,
            variants: group.items.map(item => ({
              id: item.id,
              product_id: item.product_id,
              sku: item.sku,
              attributes: item.attributes,
            })),
            created_at: new Date(group.created_at).toISOString(),
          },
          platform_mappings: platformMappings,
        });
      }

      default:
        return JSON.stringify({ success: false, error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, toolName }, 'Variation tool handler error');
    return JSON.stringify({ success: false, error: msg });
  }
}
