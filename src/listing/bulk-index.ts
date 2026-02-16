/**
 * Bulk Listing Tool Definitions & Handler
 *
 * Exports tool definitions and a handler function for bulk listing operations.
 * Wire these into the agent tool registry.
 */

import type { Database } from '../db';
import {
  pauseListings,
  resumeListings,
  deleteListings,
  bulkUpdatePrice,
  getListingsByFilter,
  getBulkOperations,
  resolveListingIds,
} from './bulk-ops';
import type { PriceUpdate } from './bulk-types';
import { createLogger } from '../utils/logger';

const logger = createLogger('bulk-tools');

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const bulkListingTools = [
  {
    name: 'pause_listings',
    description: 'Pause/deactivate listings (keeps them in DB but removes from sale)',
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_ids: { type: 'array' as const, items: { type: 'string' as const }, description: 'Specific listing IDs' },
        platform: { type: 'string' as const, description: 'Pause all listings on this platform' },
        category: { type: 'string' as const, description: 'Pause all in this category' },
      },
    },
  },
  {
    name: 'resume_listings',
    description: 'Resume/reactivate paused listings',
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_ids: { type: 'array' as const, items: { type: 'string' as const } },
        platform: { type: 'string' as const },
      },
    },
  },
  {
    name: 'delete_listings',
    description: 'Delete listings (removes from platform and marks deleted in DB)',
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_ids: { type: 'array' as const, items: { type: 'string' as const } },
        platform: { type: 'string' as const },
        confirm: { type: 'boolean' as const, description: 'Must be true to actually delete' },
      },
      required: ['confirm'],
    },
  },
  {
    name: 'bulk_update_prices',
    description: 'Update prices for multiple listings at once',
    input_schema: {
      type: 'object' as const,
      properties: {
        updates: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              listing_id: { type: 'string' as const },
              new_price: { type: 'number' as const },
            },
          },
        },
        adjustment_pct: { type: 'number' as const, description: 'Instead of specific prices, adjust all by this percentage' },
        platform: { type: 'string' as const, description: 'Apply adjustment to all listings on this platform' },
      },
    },
  },
  {
    name: 'list_bulk_operations',
    description: 'View status of bulk operations',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string' as const, enum: ['running', 'completed', 'failed'] },
        limit: { type: 'number' as const, default: 10 },
      },
    },
  },
];

// =============================================================================
// HANDLER
// =============================================================================

export interface BulkHandlerContext {
  db: Database;
  userId?: string;
}

/**
 * Handle bulk listing tool calls.
 *
 * @returns A string result suitable for returning to the agent.
 */
export async function handleBulkListingTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: BulkHandlerContext,
): Promise<string> {
  const { db, userId } = ctx;

  try {
    switch (toolName) {
      case 'pause_listings': {
        const ids = resolveListingIds(db, {
          listing_ids: input.listing_ids as string[] | undefined,
          platform: input.platform as string | undefined,
          category: input.category as string | undefined,
        });

        if (ids.length === 0) {
          return JSON.stringify({
            success: false,
            error: 'No listings found matching the specified criteria. Provide listing_ids, platform, or category.',
          });
        }

        const result = pauseListings(db, ids, input.platform as string | undefined, userId);
        return JSON.stringify({
          success: true,
          operation_id: result.operation.id,
          total: result.operation.total,
          completed: result.operation.completed,
          failed: result.operation.failed,
          message: `Paused ${result.operation.completed} of ${result.operation.total} listings`,
          errors: result.operation.errors.length > 0 ? result.operation.errors : undefined,
        });
      }

      case 'resume_listings': {
        const ids = resolveListingIds(db, {
          listing_ids: input.listing_ids as string[] | undefined,
          platform: input.platform as string | undefined,
        });

        if (ids.length === 0) {
          return JSON.stringify({
            success: false,
            error: 'No listings found matching the specified criteria.',
          });
        }

        const result = resumeListings(db, ids, input.platform as string | undefined, userId);
        return JSON.stringify({
          success: true,
          operation_id: result.operation.id,
          total: result.operation.total,
          completed: result.operation.completed,
          failed: result.operation.failed,
          message: `Resumed ${result.operation.completed} of ${result.operation.total} listings`,
          errors: result.operation.errors.length > 0 ? result.operation.errors : undefined,
        });
      }

      case 'delete_listings': {
        if (input.confirm !== true) {
          return JSON.stringify({
            success: false,
            error: 'Delete requires confirm=true. This action marks listings as deleted.',
          });
        }

        const ids = resolveListingIds(db, {
          listing_ids: input.listing_ids as string[] | undefined,
          platform: input.platform as string | undefined,
        });

        if (ids.length === 0) {
          return JSON.stringify({
            success: false,
            error: 'No listings found matching the specified criteria.',
          });
        }

        const result = deleteListings(db, ids, input.platform as string | undefined, userId);
        return JSON.stringify({
          success: true,
          operation_id: result.operation.id,
          total: result.operation.total,
          completed: result.operation.completed,
          failed: result.operation.failed,
          message: `Deleted ${result.operation.completed} of ${result.operation.total} listings`,
          errors: result.operation.errors.length > 0 ? result.operation.errors : undefined,
        });
      }

      case 'bulk_update_prices': {
        let updates: PriceUpdate[] = [];

        if (input.updates && Array.isArray(input.updates)) {
          // Explicit per-listing price updates
          updates = (input.updates as Array<{ listing_id: string; new_price: number }>).map(u => ({
            listing_id: u.listing_id,
            new_price: u.new_price,
          }));
        } else if (input.adjustment_pct != null) {
          // Percentage-based adjustment for a platform
          const adjustmentPct = Number(input.adjustment_pct);
          if (!Number.isFinite(adjustmentPct)) {
            return JSON.stringify({ success: false, error: 'Invalid adjustment_pct value' });
          }

          const ids = resolveListingIds(db, {
            platform: input.platform as string | undefined,
          });

          if (ids.length === 0) {
            return JSON.stringify({
              success: false,
              error: 'No active listings found for the specified platform. Provide a platform filter or explicit updates.',
            });
          }

          // Get current prices and calculate adjustments
          for (const id of ids) {
            try {
              const rows = db.query<Record<string, unknown>>(
                'SELECT id, price FROM listings WHERE id = ?',
                [id],
              );
              if (rows.length > 0) {
                const currentPrice = rows[0].price as number;
                const newPrice = Math.round(currentPrice * (1 + adjustmentPct / 100) * 100) / 100;
                if (Number.isFinite(newPrice) && newPrice > 0) {
                  updates.push({ listing_id: id, new_price: newPrice });
                }
              }
            } catch (err) {
              logger.error({ err, id }, 'Failed to get listing price for bulk adjustment');
            }
          }
        }

        if (updates.length === 0) {
          return JSON.stringify({
            success: false,
            error: 'No price updates to apply. Provide "updates" array or "adjustment_pct" with "platform".',
          });
        }

        const result = bulkUpdatePrice(db, updates, userId);
        return JSON.stringify({
          success: true,
          operation_id: result.operation.id,
          total: result.operation.total,
          completed: result.operation.completed,
          failed: result.operation.failed,
          message: `Updated prices for ${result.operation.completed} of ${result.operation.total} listings`,
          changes: result.results
            .filter(r => r.success)
            .map(r => ({
              listing_id: r.listing_id,
              old_price: r.old_value,
              new_price: r.new_value,
            })),
          errors: result.operation.errors.length > 0 ? result.operation.errors : undefined,
        });
      }

      case 'list_bulk_operations': {
        const ops = getBulkOperations(db, {
          status: input.status as string | undefined,
          limit: input.limit != null ? Number(input.limit) : 10,
        });

        return JSON.stringify({
          success: true,
          count: ops.length,
          operations: ops.map(op => ({
            id: op.id,
            type: op.type,
            status: op.status,
            total: op.total,
            completed: op.completed,
            failed: op.failed,
            error_count: op.errors.length,
            created_at: new Date(op.created_at).toISOString(),
            completed_at: op.completed_at ? new Date(op.completed_at).toISOString() : null,
          })),
        });
      }

      default:
        return JSON.stringify({ success: false, error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, toolName }, 'Bulk listing tool handler error');
    return JSON.stringify({ success: false, error: msg });
  }
}
