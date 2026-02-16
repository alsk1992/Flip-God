/**
 * Returns/Refund Automation
 *
 * Handles the full return lifecycle: request creation, inspection,
 * restocking, and refund processing. Provides analytics on return
 * rates, top reasons, and refund totals.
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import type {
  ReturnRequest,
  ReturnStatus,
  ReturnCondition,
  ReturnReason,
  ReturnMetrics,
  ReturnMetricsOptions,
  CreateReturnParams,
  InspectReturnParams,
  ProcessRefundParams,
} from './return-types.js';

const logger = createLogger('returns');

// ---------------------------------------------------------------------------
// Table bootstrap (idempotent)
// ---------------------------------------------------------------------------

export function ensureReturnsTable(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS returns (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'other',
      condition TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      refund_amount REAL,
      restocked INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      resolved_at INTEGER
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_returns_order ON returns(order_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_returns_status ON returns(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_returns_category ON returns(category)');
  db.run('CREATE INDEX IF NOT EXISTS idx_returns_platform ON returns(platform)');
  db.run('CREATE INDEX IF NOT EXISTS idx_returns_created ON returns(created_at)');
}

// ---------------------------------------------------------------------------
// Reason categorisation
// ---------------------------------------------------------------------------

const REASON_KEYWORDS: Record<ReturnReason, string[]> = {
  not_as_described: [
    'not as described', 'different', 'misleading', 'inaccurate', 'wrong description',
    'doesn\'t match', 'not what', 'mismatch',
  ],
  damaged_in_shipping: [
    'damaged', 'broken', 'crushed', 'cracked', 'shipping damage', 'dented',
    'arrived broken', 'in transit',
  ],
  wrong_item: [
    'wrong item', 'wrong product', 'incorrect item', 'sent wrong', 'not what i ordered',
    'different item', 'wrong color', 'wrong size',
  ],
  changed_mind: [
    'changed mind', 'no longer need', 'don\'t want', 'don\'t need', 'buyer\'s remorse',
    'impulse', 'regret', 'not needed', 'found better', 'found cheaper',
  ],
  defective: [
    'defective', 'doesn\'t work', 'malfunction', 'faulty', 'not working',
    'broken on arrival', 'dead on arrival', 'doa', 'not functional',
  ],
  other: [],
};

export function categorizeReturnReason(reason: string): ReturnReason {
  const lower = reason.toLowerCase();

  for (const [category, keywords] of Object.entries(REASON_KEYWORDS) as Array<[ReturnReason, string[]]>) {
    if (category === 'other') continue;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        return category;
      }
    }
  }

  return 'other';
}

// ---------------------------------------------------------------------------
// Row parser
// ---------------------------------------------------------------------------

function parseReturnRow(row: Record<string, unknown>): ReturnRequest {
  return {
    id: row.id as string,
    orderId: row.order_id as string,
    userId: (row.user_id as string) ?? '',
    platform: (row.platform as string) ?? '',
    reason: row.reason as string,
    category: (row.category as ReturnReason) ?? 'other',
    condition: (row.condition as ReturnCondition) ?? undefined,
    status: (row.status as ReturnStatus) ?? 'pending',
    refundAmount: row.refund_amount != null ? (row.refund_amount as number) : undefined,
    restocked: Boolean(row.restocked),
    notes: (row.notes as string) ?? undefined,
    createdAt: new Date(row.created_at as number),
    resolvedAt: row.resolved_at ? new Date(row.resolved_at as number) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Create a new return request for an order.
 */
export function createReturnRequest(db: Database, params: CreateReturnParams): ReturnRequest {
  const id = randomUUID().slice(0, 12);
  const category = categorizeReturnReason(params.reason);
  const now = Date.now();

  // Look up the order for platform/user info if not provided
  let platform = params.platform ?? '';
  let userId = params.userId ?? '';

  if (!platform || !userId) {
    const orderRows = db.query<{ sell_platform: string; listing_id: string }>(
      'SELECT sell_platform, listing_id FROM orders WHERE id = ?',
      [params.orderId],
    );
    if (orderRows.length > 0) {
      platform = platform || orderRows[0].sell_platform;
    }
  }

  db.run(
    `INSERT INTO returns (id, order_id, user_id, platform, reason, category, status, restocked, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
    [id, params.orderId, userId, platform, params.reason, category, params.notes ?? null, now],
  );

  logger.info({ returnId: id, orderId: params.orderId, category }, 'Return request created');

  return {
    id,
    orderId: params.orderId,
    userId,
    platform,
    reason: params.reason,
    category,
    status: 'pending',
    restocked: false,
    notes: params.notes,
    createdAt: new Date(now),
  };
}

/**
 * Record inspection results for a returned item.
 * Optionally restocks the item if condition is like_new or good.
 */
export function inspectReturn(
  db: Database,
  returnId: string,
  condition: ReturnCondition,
  options?: { restock?: boolean; notes?: string },
): ReturnRequest | null {
  const rows = db.query<Record<string, unknown>>(
    'SELECT * FROM returns WHERE id = ?',
    [returnId],
  );
  if (rows.length === 0) {
    logger.warn({ returnId }, 'Return not found for inspection');
    return null;
  }

  const existing = parseReturnRow(rows[0]);

  const shouldRestock = options?.restock ?? (condition === 'like_new' || condition === 'good');
  const newStatus: ReturnStatus = shouldRestock ? 'restocked' : 'inspected';
  const now = Date.now();

  const updatedNotes = options?.notes
    ? existing.notes
      ? `${existing.notes}\nInspection: ${options.notes}`
      : `Inspection: ${options.notes}`
    : existing.notes;

  db.run(
    `UPDATE returns SET condition = ?, status = ?, restocked = ?, notes = ?, resolved_at = ?
     WHERE id = ?`,
    [condition, newStatus, shouldRestock ? 1 : 0, updatedNotes ?? null, now, returnId],
  );

  // If restocking, add inventory back
  if (shouldRestock) {
    autoRestock(db, returnId);
  }

  logger.info({ returnId, condition, restocked: shouldRestock, status: newStatus }, 'Return inspected');

  return {
    ...existing,
    condition,
    status: newStatus,
    restocked: shouldRestock,
    notes: updatedNotes,
    resolvedAt: new Date(now),
  };
}

/**
 * Auto-restock a returned item by incrementing warehouse inventory.
 * Looks up the order -> listing -> product chain to find the right SKU.
 */
export function autoRestock(db: Database, returnId: string): boolean {
  const returnRows = db.query<{ order_id: string }>(
    'SELECT order_id FROM returns WHERE id = ?',
    [returnId],
  );
  if (returnRows.length === 0) return false;

  const orderRows = db.query<{ listing_id: string }>(
    'SELECT listing_id FROM orders WHERE id = ?',
    [returnRows[0].order_id],
  );
  if (orderRows.length === 0) return false;

  const listingRows = db.query<{ product_id: string }>(
    'SELECT product_id FROM listings WHERE id = ?',
    [orderRows[0].listing_id],
  );
  if (listingRows.length === 0) return false;

  const productId = listingRows[0].product_id;

  // Find existing warehouse inventory for this product and increment
  const invRows = db.query<{ id: string; warehouse_id: string; quantity: number }>(
    'SELECT id, warehouse_id, quantity FROM warehouse_inventory WHERE product_id = ? LIMIT 1',
    [productId],
  );

  if (invRows.length > 0) {
    db.run(
      'UPDATE warehouse_inventory SET quantity = quantity + 1, updated_at = ? WHERE id = ?',
      [Date.now(), invRows[0].id],
    );
    logger.info({ returnId, productId, warehouseId: invRows[0].warehouse_id }, 'Item restocked');
    return true;
  }

  logger.info({ returnId, productId }, 'No warehouse inventory found to restock into');
  return false;
}

/**
 * Process a refund for a return request.
 * If amount is not provided, uses the original sell price from the order.
 */
export function processRefund(
  db: Database,
  returnId: string,
  amount?: number,
  reason?: string,
): ReturnRequest | null {
  const rows = db.query<Record<string, unknown>>(
    'SELECT * FROM returns WHERE id = ?',
    [returnId],
  );
  if (rows.length === 0) {
    logger.warn({ returnId }, 'Return not found for refund');
    return null;
  }

  const existing = parseReturnRow(rows[0]);

  // Determine refund amount
  let refundAmount = amount;
  if (refundAmount == null || !Number.isFinite(refundAmount)) {
    // Look up original sell price
    const orderRows = db.query<{ sell_price: number }>(
      'SELECT sell_price FROM orders WHERE id = ?',
      [existing.orderId],
    );
    refundAmount = orderRows.length > 0 ? orderRows[0].sell_price : 0;
  }

  const now = Date.now();
  const updatedNotes = reason
    ? existing.notes
      ? `${existing.notes}\nRefund: ${reason}`
      : `Refund: ${reason}`
    : existing.notes;

  db.run(
    `UPDATE returns SET status = 'refunded', refund_amount = ?, notes = ?, resolved_at = ?
     WHERE id = ?`,
    [refundAmount, updatedNotes ?? null, now, returnId],
  );

  logger.info({ returnId, refundAmount, reason }, 'Refund processed');

  return {
    ...existing,
    status: 'refunded',
    refundAmount,
    notes: updatedNotes,
    resolvedAt: new Date(now),
  };
}

/**
 * Process a full return end-to-end: receive, inspect, restock/dispose, refund.
 */
export function processReturn(
  db: Database,
  returnRequest: ReturnRequest,
): ReturnRequest | null {
  // Mark as received
  db.run(
    "UPDATE returns SET status = 'received' WHERE id = ?",
    [returnRequest.id],
  );

  // Inspect based on existing condition or default to 'good'
  const condition = returnRequest.condition ?? 'good';
  const inspected = inspectReturn(db, returnRequest.id, condition);
  if (!inspected) return null;

  // Process refund
  const refunded = processRefund(db, returnRequest.id);
  return refunded;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * List return requests with optional filters.
 */
export function listReturns(
  db: Database,
  options?: {
    status?: string;
    platform?: string;
    days?: number;
    limit?: number;
  },
): ReturnRequest[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.status && options.status !== 'all') {
    conditions.push('status = ?');
    params.push(options.status);
  }

  if (options?.platform) {
    conditions.push('platform = ?');
    params.push(options.platform);
  }

  const days = options?.days ?? 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  conditions.push('created_at >= ?');
  params.push(cutoff);

  const limit = options?.limit ?? 20;
  params.push(limit);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM returns ${where} ORDER BY created_at DESC LIMIT ?`;

  const rows = db.query<Record<string, unknown>>(sql, params);
  return rows.map(parseReturnRow);
}

/**
 * Get return analytics and metrics.
 */
export function getReturnMetrics(db: Database, options?: ReturnMetricsOptions): ReturnMetrics {
  const conditions: string[] = [];
  const params: unknown[] = [];

  const days = options?.days ?? 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  conditions.push('r.created_at >= ?');
  params.push(cutoff);

  if (options?.platform) {
    conditions.push('r.platform = ?');
    params.push(options.platform);
  }

  if (options?.category) {
    conditions.push('r.category = ?');
    params.push(options.category);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Total returns and refund stats
  const summaryRows = db.query<{
    total_returns: number;
    avg_refund: number;
    total_refunded: number;
    restocked_count: number;
  }>(
    `SELECT
       COUNT(*) as total_returns,
       COALESCE(AVG(r.refund_amount), 0) as avg_refund,
       COALESCE(SUM(r.refund_amount), 0) as total_refunded,
       SUM(CASE WHEN r.restocked = 1 THEN 1 ELSE 0 END) as restocked_count
     FROM returns r
     ${where}`,
    params,
  );

  const summary = summaryRows[0] ?? { total_returns: 0, avg_refund: 0, total_refunded: 0, restocked_count: 0 };
  const totalReturns = summary.total_returns;

  // Total orders in the same period for return rate calculation
  const orderCountRows = db.query<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM orders WHERE ordered_at >= ?',
    [cutoff],
  );
  const totalOrders = orderCountRows[0]?.cnt ?? 0;
  const returnRate = totalOrders > 0 ? totalReturns / totalOrders : 0;

  // By category
  const categoryRows = db.query<{ category: ReturnReason; count: number }>(
    `SELECT r.category, COUNT(*) as count
     FROM returns r
     ${where}
     GROUP BY r.category
     ORDER BY count DESC`,
    params,
  );
  const byCategory = categoryRows.map(row => ({
    category: row.category,
    count: row.count,
    pct: totalReturns > 0 ? row.count / totalReturns : 0,
  }));

  // By condition
  const conditionRows = db.query<{ condition: ReturnCondition; count: number }>(
    `SELECT r.condition, COUNT(*) as count
     FROM returns r
     ${where} ${where ? 'AND' : 'WHERE'} r.condition IS NOT NULL
     GROUP BY r.condition
     ORDER BY count DESC`,
    params,
  );
  const byCondition = conditionRows.map(row => ({
    condition: row.condition,
    count: row.count,
    pct: totalReturns > 0 ? row.count / totalReturns : 0,
  }));

  // By status
  const statusRows = db.query<{ status: ReturnStatus; count: number }>(
    `SELECT r.status, COUNT(*) as count
     FROM returns r
     ${where}
     GROUP BY r.status
     ORDER BY count DESC`,
    params,
  );
  const byStatus = statusRows.map(row => ({
    status: row.status,
    count: row.count,
  }));

  const restockRate = totalReturns > 0 ? summary.restocked_count / totalReturns : 0;

  return {
    totalReturns,
    returnRate,
    avgRefundAmount: Number.isFinite(summary.avg_refund) ? summary.avg_refund : 0,
    totalRefunded: Number.isFinite(summary.total_refunded) ? summary.total_refunded : 0,
    byCategory,
    byCondition,
    byStatus,
    restockRate,
  };
}
