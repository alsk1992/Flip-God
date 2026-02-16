/**
 * Returns Tool Definitions & Handler
 *
 * Standalone module exporting Anthropic-style tool definitions and a handler
 * function for return/refund automation. Wire into agents/index.ts as needed.
 */

import type { Database } from '../db/index.js';
import {
  ensureReturnsTable,
  createReturnRequest,
  inspectReturn,
  processRefund,
  listReturns,
  getReturnMetrics,
} from './returns.js';

// ---------------------------------------------------------------------------
// Tool definitions (Anthropic tool_use schema)
// ---------------------------------------------------------------------------

export const returnTools = [
  {
    name: 'create_return',
    description: 'Create a return request for an order',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: { type: 'string' as const },
        reason: { type: 'string' as const, description: 'Return reason' },
        notes: { type: 'string' as const, description: 'Additional notes' },
      },
      required: ['order_id', 'reason'],
    },
  },
  {
    name: 'inspect_return',
    description: 'Record inspection results for a returned item',
    input_schema: {
      type: 'object' as const,
      properties: {
        return_id: { type: 'string' as const },
        condition: {
          type: 'string' as const,
          enum: ['like_new', 'good', 'damaged', 'defective'] as const,
        },
        restock: {
          type: 'boolean' as const,
          default: false,
          description: 'Add item back to inventory',
        },
        notes: { type: 'string' as const },
      },
      required: ['return_id', 'condition'],
    },
  },
  {
    name: 'process_refund',
    description: 'Issue a refund for a return',
    input_schema: {
      type: 'object' as const,
      properties: {
        return_id: { type: 'string' as const },
        amount: {
          type: 'number' as const,
          description: 'Refund amount (leave empty for full refund)',
        },
        reason: { type: 'string' as const },
      },
      required: ['return_id'],
    },
  },
  {
    name: 'list_returns',
    description: 'List return requests with filters',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string' as const,
          enum: ['pending', 'inspected', 'refunded', 'restocked', 'disposed', 'all'] as const,
        },
        platform: { type: 'string' as const },
        days: { type: 'number' as const, default: 30 },
        limit: { type: 'number' as const, default: 20 },
      },
    },
  },
  {
    name: 'return_analytics',
    description: 'Get return rate metrics and top reasons',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: { type: 'number' as const, default: 30 },
        platform: { type: 'string' as const },
        category: { type: 'string' as const },
      },
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ReturnToolInput {
  order_id?: string;
  return_id?: string;
  reason?: string;
  notes?: string;
  condition?: 'like_new' | 'good' | 'damaged' | 'defective';
  restock?: boolean;
  amount?: number;
  status?: string;
  platform?: string;
  days?: number;
  limit?: number;
  category?: string;
}

/**
 * Handle a return tool call. Ensures the returns table exists, then
 * dispatches to the appropriate function.
 *
 * @returns A JSON-serialisable result object.
 */
export function handleReturnTool(
  db: Database,
  toolName: string,
  input: ReturnToolInput,
): unknown {
  // Ensure schema on first call
  ensureReturnsTable(db);

  switch (toolName) {
    case 'create_return': {
      if (!input.order_id || !input.reason) {
        return { error: 'order_id and reason are required' };
      }
      const result = createReturnRequest(db, {
        orderId: input.order_id,
        reason: input.reason,
        notes: input.notes,
      });
      return {
        success: true,
        return: {
          id: result.id,
          orderId: result.orderId,
          category: result.category,
          status: result.status,
          createdAt: result.createdAt.toISOString(),
        },
      };
    }

    case 'inspect_return': {
      if (!input.return_id || !input.condition) {
        return { error: 'return_id and condition are required' };
      }
      const result = inspectReturn(db, input.return_id, input.condition, {
        restock: input.restock,
        notes: input.notes,
      });
      if (!result) {
        return { error: `Return ${input.return_id} not found` };
      }
      return {
        success: true,
        return: {
          id: result.id,
          condition: result.condition,
          status: result.status,
          restocked: result.restocked,
        },
      };
    }

    case 'process_refund': {
      if (!input.return_id) {
        return { error: 'return_id is required' };
      }
      const parsedAmount = input.amount != null ? Number(input.amount) : undefined;
      const safeAmount = parsedAmount != null && Number.isFinite(parsedAmount) ? parsedAmount : undefined;

      const result = processRefund(db, input.return_id, safeAmount, input.reason);
      if (!result) {
        return { error: `Return ${input.return_id} not found` };
      }
      return {
        success: true,
        return: {
          id: result.id,
          status: result.status,
          refundAmount: result.refundAmount,
        },
      };
    }

    case 'list_returns': {
      const results = listReturns(db, {
        status: input.status,
        platform: input.platform,
        days: input.days,
        limit: input.limit,
      });
      return {
        success: true,
        count: results.length,
        returns: results.map(r => ({
          id: r.id,
          orderId: r.orderId,
          platform: r.platform,
          reason: r.reason,
          category: r.category,
          condition: r.condition,
          status: r.status,
          refundAmount: r.refundAmount,
          restocked: r.restocked,
          createdAt: r.createdAt.toISOString(),
          resolvedAt: r.resolvedAt?.toISOString() ?? null,
        })),
      };
    }

    case 'return_analytics': {
      const metrics = getReturnMetrics(db, {
        days: input.days,
        platform: input.platform,
        category: input.category,
      });
      return {
        success: true,
        metrics: {
          totalReturns: metrics.totalReturns,
          returnRate: Math.round(metrics.returnRate * 10000) / 100, // percentage
          avgRefundAmount: Math.round(metrics.avgRefundAmount * 100) / 100,
          totalRefunded: Math.round(metrics.totalRefunded * 100) / 100,
          restockRate: Math.round(metrics.restockRate * 10000) / 100,
          topReasons: metrics.byCategory.map(c => ({
            reason: c.category,
            count: c.count,
            pct: Math.round(c.pct * 10000) / 100,
          })),
          byCondition: metrics.byCondition.map(c => ({
            condition: c.condition,
            count: c.count,
            pct: Math.round(c.pct * 10000) / 100,
          })),
          byStatus: metrics.byStatus,
        },
      };
    }

    default:
      return { error: `Unknown return tool: ${toolName}` };
  }
}
