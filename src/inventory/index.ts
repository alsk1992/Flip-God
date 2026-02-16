/**
 * Inventory Module - Cross-platform inventory sync, holds, conflicts, allocation
 *
 * Exports tool definitions and a handler function for wiring into the agent.
 */

import type { Database } from '../db/index.js';
import {
  syncInventoryAcrossPlatforms,
  reserveInventory,
  releaseHold,
  getInventorySnapshot,
  listConflicts,
  resolveConflict,
  expireStaleHolds,
} from './sync-engine.js';
import { setAllocationRule } from './allocation.js';
import type { HoldReason, ConflictResolution, AllocationType } from './types.js';
import type { Platform } from '../types.js';

// =============================================================================
// Tool Definitions
// =============================================================================

export const inventoryTools = [
  {
    name: 'sync_inventory',
    description: 'Sync inventory counts across all platforms for a product',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const },
        platform: { type: 'string' as const, description: 'Sync specific platform only' },
        dry_run: { type: 'boolean' as const, default: true },
      },
    },
  },
  {
    name: 'inventory_snapshot',
    description: 'Get full inventory breakdown (warehouse, reserved, holds, available)',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'hold_inventory',
    description: 'Place a hold on inventory (reserve without creating an order)',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const },
        warehouse_id: { type: 'string' as const },
        quantity: { type: 'number' as const },
        reason: {
          type: 'string' as const,
          enum: ['order_pending', 'fba_inbound', 'return_processing', 'manual_hold'],
        },
        expires_hours: {
          type: 'number' as const,
          default: 24,
          description: 'Hold expiry in hours',
        },
        reference_id: { type: 'string' as const, description: 'Related order/shipment ID' },
      },
      required: ['product_id', 'quantity', 'reason'],
    },
  },
  {
    name: 'release_hold',
    description: 'Release an inventory hold',
    input_schema: {
      type: 'object' as const,
      properties: {
        hold_id: { type: 'string' as const },
      },
      required: ['hold_id'],
    },
  },
  {
    name: 'list_inventory_conflicts',
    description: 'List inventory discrepancies between local records and platforms',
    input_schema: {
      type: 'object' as const,
      properties: {
        unresolved_only: { type: 'boolean' as const, default: true },
        platform: { type: 'string' as const },
      },
    },
  },
  {
    name: 'resolve_inventory_conflict',
    description: 'Resolve an inventory mismatch',
    input_schema: {
      type: 'object' as const,
      properties: {
        conflict_id: { type: 'string' as const },
        resolution: {
          type: 'string' as const,
          enum: ['accept_platform', 'accept_local', 'manual'],
        },
        manual_qty: {
          type: 'number' as const,
          description: 'Only needed if resolution is manual',
        },
      },
      required: ['conflict_id', 'resolution'],
    },
  },
  {
    name: 'set_allocation_rule',
    description: 'Set inventory allocation rules for distributing stock across platforms',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: {
          type: 'string' as const,
          description: 'Product ID (or "default" for global rule)',
        },
        platform: { type: 'string' as const },
        allocation_type: {
          type: 'string' as const,
          enum: ['equal', 'proportional', 'priority', 'fixed_pct'],
        },
        allocation_value: {
          type: 'number' as const,
          description: 'Priority number or fixed percentage',
        },
      },
      required: ['platform', 'allocation_type'],
    },
  },
] as const;

// =============================================================================
// Tool Handler
// =============================================================================

export interface InventoryToolInput {
  product_id?: string;
  warehouse_id?: string;
  quantity?: number;
  reason?: string;
  expires_hours?: number;
  reference_id?: string;
  hold_id?: string;
  platform?: string;
  dry_run?: boolean;
  unresolved_only?: boolean;
  conflict_id?: string;
  resolution?: string;
  manual_qty?: number;
  allocation_type?: string;
  allocation_value?: number;
}

/**
 * Handle inventory tool calls.
 *
 * @param db - Database instance
 * @param toolName - Name of the tool being called
 * @param input - Tool input parameters
 * @returns Tool result object
 */
export function handleInventoryTool(
  db: Database,
  toolName: string,
  input: InventoryToolInput,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'sync_inventory': {
        const productId = input.product_id;
        if (!productId) {
          // Sync all products if no product_id specified
          const products = db.query<{ product_id: string }>(
            'SELECT DISTINCT product_id FROM warehouse_inventory WHERE product_id IS NOT NULL',
          );

          const results = products.map((p) =>
            syncInventoryAcrossPlatforms(db, p.product_id, {
              platform: input.platform,
              dryRun: input.dry_run ?? true,
            }),
          );

          return { success: true, data: results };
        }

        const result = syncInventoryAcrossPlatforms(db, productId, {
          platform: input.platform,
          dryRun: input.dry_run ?? true,
        });

        return { success: true, data: result };
      }

      case 'inventory_snapshot': {
        if (!input.product_id) {
          return { success: false, error: 'product_id is required' };
        }
        const snapshot = getInventorySnapshot(db, input.product_id);
        return { success: true, data: snapshot };
      }

      case 'hold_inventory': {
        if (!input.product_id) {
          return { success: false, error: 'product_id is required' };
        }
        if (!input.quantity || !Number.isFinite(input.quantity) || input.quantity <= 0) {
          return { success: false, error: 'quantity must be a positive number' };
        }
        if (!input.reason) {
          return { success: false, error: 'reason is required' };
        }

        // If no warehouse_id specified, use the first warehouse with available stock
        let warehouseId = input.warehouse_id;
        if (!warehouseId) {
          const warehouses = db.query<{ warehouse_id: string }>(
            `SELECT wi.warehouse_id FROM warehouse_inventory wi
             WHERE wi.product_id = ? AND (wi.quantity - wi.reserved) > 0
             LIMIT 1`,
            [input.product_id],
          );
          if (warehouses.length === 0) {
            return { success: false, error: 'No warehouse with available stock found' };
          }
          warehouseId = warehouses[0].warehouse_id;
        }

        const hold = reserveInventory(
          db,
          input.product_id,
          warehouseId,
          input.quantity,
          input.reason as HoldReason,
          input.reference_id,
          input.expires_hours,
        );

        return { success: true, data: hold };
      }

      case 'release_hold': {
        if (!input.hold_id) {
          return { success: false, error: 'hold_id is required' };
        }
        const released = releaseHold(db, input.hold_id);
        return {
          success: released,
          data: { released },
          error: released ? undefined : 'Hold not found',
        };
      }

      case 'list_inventory_conflicts': {
        const conflicts = listConflicts(
          db,
          input.unresolved_only ?? true,
          input.platform,
        );
        return { success: true, data: conflicts };
      }

      case 'resolve_inventory_conflict': {
        if (!input.conflict_id) {
          return { success: false, error: 'conflict_id is required' };
        }
        if (!input.resolution) {
          return { success: false, error: 'resolution is required' };
        }

        if (input.resolution === 'manual' && !Number.isFinite(input.manual_qty)) {
          return { success: false, error: 'manual_qty is required when resolution is manual' };
        }

        const resolved = resolveConflict(
          db,
          input.conflict_id,
          input.resolution as ConflictResolution,
          input.manual_qty,
        );

        return {
          success: resolved,
          data: { resolved },
          error: resolved ? undefined : 'Conflict not found or already resolved',
        };
      }

      case 'set_allocation_rule': {
        if (!input.platform) {
          return { success: false, error: 'platform is required' };
        }
        if (!input.allocation_type) {
          return { success: false, error: 'allocation_type is required' };
        }

        const rule = setAllocationRule(db, input.product_id ?? 'default', {
          platform: input.platform as Platform,
          allocationType: input.allocation_type as AllocationType,
          allocationValue: Number.isFinite(input.allocation_value) ? input.allocation_value! : 0,
          priority: 0,
        });

        return { success: true, data: rule };
      }

      default:
        return { success: false, error: `Unknown inventory tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// Re-export core functions for direct usage
export {
  syncInventoryAcrossPlatforms,
  reserveInventory,
  releaseHold,
  expireStaleHolds,
  getInventorySnapshot,
  listConflicts,
  resolveConflict,
  detectConflicts,
} from './sync-engine.js';

export { calculateAllocation, getAllocationRules, setAllocationRule } from './allocation.js';

export type {
  InventoryHold,
  InventoryConflict,
  InventorySnapshot,
  AllocationRule,
  SyncResult,
  HoldReason,
  ConflictResolution,
  AllocationType,
  PlatformAllocation,
  WarehouseStock,
} from './types.js';
