/**
 * Return Merchandise Authorization (RMA) System
 */

import type { Database } from '../db/index.js';

function generateRmaNumber(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `RMA-${ts}-${rand}`;
}

export const rmaTools = [
  {
    name: 'create_rma',
    description: 'Create a Return Merchandise Authorization for an order',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: { type: 'string' as const },
        reason: { type: 'string' as const },
        items: { type: 'array' as const, items: { type: 'object' as const, properties: { sku: { type: 'string' as const }, quantity: { type: 'number' as const }, condition: { type: 'string' as const } } } },
      },
      required: ['order_id', 'reason'],
    },
  },
  {
    name: 'lookup_rma',
    description: 'Look up RMA by number or order ID',
    input_schema: {
      type: 'object' as const,
      properties: {
        rma_number: { type: 'string' as const },
        order_id: { type: 'string' as const },
      },
    },
  },
  {
    name: 'approve_rma',
    description: 'Approve or deny an RMA request',
    input_schema: {
      type: 'object' as const,
      properties: {
        rma_number: { type: 'string' as const },
        approved: { type: 'boolean' as const },
        notes: { type: 'string' as const },
        restocking_fee_pct: { type: 'number' as const, description: '0-100' },
      },
      required: ['rma_number', 'approved'],
    },
  },
  {
    name: 'receive_rma',
    description: 'Mark RMA as received and inspect returned items',
    input_schema: {
      type: 'object' as const,
      properties: {
        rma_number: { type: 'string' as const },
        condition_verified: { type: 'boolean' as const },
        items_received: { type: 'array' as const, items: { type: 'object' as const, properties: { sku: { type: 'string' as const }, quantity: { type: 'number' as const }, condition_actual: { type: 'string' as const } } } },
      },
      required: ['rma_number', 'condition_verified'],
    },
  },
  {
    name: 'rma_report',
    description: 'Generate RMA metrics report for a date range',
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: { type: 'string' as const },
        end_date: { type: 'string' as const },
      },
      required: ['start_date', 'end_date'],
    },
  },
];

export function handleRmaTool(
  db: Database,
  toolName: string,
  input: Record<string, unknown>,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'create_rma': {
        const orderId = input.order_id as string;
        const reason = input.reason as string;
        if (!orderId || !reason) return { success: false, error: 'order_id and reason required' };
        const rmaNumber = generateRmaNumber();
        const items = input.items ? JSON.stringify(input.items) : '[]';

        db.run(
          `INSERT INTO rma_requests (rma_number, order_id, status, reason, items_json) VALUES (?, ?, 'pending', ?, ?)`,
          [rmaNumber, orderId, reason, items],
        );
        return {
          success: true,
          data: {
            rma_number: rmaNumber,
            order_id: orderId,
            status: 'pending',
            instructions: `Return items to our warehouse. Include RMA# ${rmaNumber} on the outside of the package. Ship within 14 days.`,
          },
        };
      }

      case 'lookup_rma': {
        const rmaNum = input.rma_number as string;
        const orderId = input.order_id as string;
        if (!rmaNum && !orderId) return { success: false, error: 'rma_number or order_id required' };

        const where = rmaNum ? 'rma_number = ?' : 'order_id = ?';
        const param = rmaNum ?? orderId;
        const rows = db.query<Record<string, unknown>>(
          `SELECT * FROM rma_requests WHERE ${where}`,
          [param],
        );
        if (rows.length === 0) return { success: false, error: 'RMA not found' };
        return { success: true, data: rows[0] };
      }

      case 'approve_rma': {
        const rmaNum = input.rma_number as string;
        const approved = input.approved as boolean;
        if (!rmaNum) return { success: false, error: 'rma_number required' };

        const status = approved ? 'approved' : 'denied';
        db.run(
          `UPDATE rma_requests SET status = ?, approved = ?, notes = ?, restocking_fee_pct = ?, updated_at = datetime('now') WHERE rma_number = ?`,
          [status, approved ? 1 : 0, (input.notes as string) ?? null, (input.restocking_fee_pct as number) ?? 0, rmaNum],
        );
        return { success: true, data: { rma_number: rmaNum, status, approved } };
      }

      case 'receive_rma': {
        const rmaNum = input.rma_number as string;
        if (!rmaNum) return { success: false, error: 'rma_number required' };

        const received = input.items_received ? JSON.stringify(input.items_received) : '[]';
        const verified = (input.condition_verified as boolean) ? 1 : 0;

        db.run(
          `UPDATE rma_requests SET status = 'received', condition_verified = ?, received_items_json = ?, updated_at = datetime('now') WHERE rma_number = ?`,
          [verified, received, rmaNum],
        );

        // Auto-trigger refund if condition verified and previously approved
        const rows = db.query<Record<string, unknown>>(
          'SELECT approved, restocking_fee_pct, order_id FROM rma_requests WHERE rma_number = ?',
          [rmaNum],
        );
        const rma = rows[0];
        let refundTriggered = false;
        if (rma && rma.approved === 1 && verified) {
          db.run(
            `UPDATE rma_requests SET status = 'refund_pending', updated_at = datetime('now') WHERE rma_number = ?`,
            [rmaNum],
          );
          refundTriggered = true;
        }

        return { success: true, data: { rma_number: rmaNum, condition_verified: !!verified, refund_triggered: refundTriggered } };
      }

      case 'rma_report': {
        const start = input.start_date as string;
        const end = input.end_date as string;
        if (!start || !end) return { success: false, error: 'start_date and end_date required' };

        const total = db.query<Record<string, unknown>>(
          'SELECT COUNT(*) as count FROM rma_requests WHERE created_at >= ? AND created_at <= ?',
          [start, end],
        );
        const byStatus = db.query<Record<string, unknown>>(
          'SELECT status, COUNT(*) as count FROM rma_requests WHERE created_at >= ? AND created_at <= ? GROUP BY status',
          [start, end],
        );
        const topReasons = db.query<Record<string, unknown>>(
          'SELECT reason, COUNT(*) as count FROM rma_requests WHERE created_at >= ? AND created_at <= ? GROUP BY reason ORDER BY count DESC LIMIT 10',
          [start, end],
        );
        const approved = db.query<Record<string, unknown>>(
          'SELECT COUNT(*) as count FROM rma_requests WHERE approved = 1 AND created_at >= ? AND created_at <= ?',
          [start, end],
        );
        const totalCount = (total[0]?.count as number) ?? 0;
        const approvedCount = (approved[0]?.count as number) ?? 0;

        return {
          success: true,
          data: {
            period: { start, end },
            total_rmas: totalCount,
            approval_rate: totalCount > 0 ? Math.round((approvedCount / totalCount) * 10000) / 100 : 0,
            by_status: byStatus,
            top_reasons: topReasons,
          },
        };
      }

      default:
        return { success: false, error: `Unknown RMA tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
