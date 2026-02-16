/**
 * Bulk Listing Operations
 *
 * Provides batch operations for listing management:
 * - Pause/resume listings
 * - Delete listings
 * - Bulk price updates
 * - Filter-based listing queries
 *
 * All operations are tracked in the bulk_operations table.
 */

import { createLogger } from '../utils/logger';
import { generateId } from '../utils/id';
import type { Database } from '../db';
import type {
  BulkOperation,
  BulkOpType,
  BulkFilter,
  BulkResult,
  BulkItemResult,
  BulkError,
  PriceUpdate,
} from './bulk-types';

const logger = createLogger('bulk-ops');

// =============================================================================
// HELPERS
// =============================================================================

function createBulkOp(
  db: Database,
  type: BulkOpType,
  total: number,
  userId?: string,
): BulkOperation {
  const op: BulkOperation = {
    id: generateId('bulk'),
    user_id: userId ?? 'default',
    type,
    status: 'running',
    total,
    completed: 0,
    failed: 0,
    errors: [],
    created_at: Date.now(),
    completed_at: null,
  };

  try {
    db.run(
      `INSERT INTO bulk_operations (id, user_id, type, status, total, completed, failed, errors, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        op.id,
        op.user_id,
        op.type,
        op.status,
        op.total,
        op.completed,
        op.failed,
        JSON.stringify(op.errors),
        op.created_at,
        op.completed_at,
      ],
    );
  } catch (err) {
    logger.error({ err }, 'Failed to create bulk operation record');
  }

  return op;
}

function completeBulkOp(db: Database, op: BulkOperation): void {
  op.status = op.failed > 0 && op.completed === 0 ? 'failed' : 'completed';
  op.completed_at = Date.now();

  try {
    db.run(
      `UPDATE bulk_operations SET status = ?, completed = ?, failed = ?, errors = ?, completed_at = ? WHERE id = ?`,
      [
        op.status,
        op.completed,
        op.failed,
        JSON.stringify(op.errors),
        op.completed_at,
        op.id,
      ],
    );
  } catch (err) {
    logger.error({ err, opId: op.id }, 'Failed to update bulk operation record');
  }
}

// =============================================================================
// PAUSE LISTINGS
// =============================================================================

/**
 * Pause (deactivate) listings. Sets status to 'paused' in DB.
 */
export function pauseListings(
  db: Database,
  listingIds: string[],
  _platform?: string,
  userId?: string,
): BulkResult {
  const results: BulkItemResult[] = [];
  const op = createBulkOp(db, 'pause', listingIds.length, userId);

  for (const id of listingIds) {
    try {
      // Get current status
      const rows = db.query<Record<string, unknown>>(
        'SELECT id, status FROM listings WHERE id = ?',
        [id],
      );

      if (rows.length === 0) {
        op.failed++;
        const error = `Listing ${id} not found`;
        op.errors.push({ listing_id: id, error });
        results.push({ listing_id: id, success: false, error });
        continue;
      }

      const oldStatus = rows[0].status as string;
      if (oldStatus === 'paused') {
        // Already paused, count as success but note it
        op.completed++;
        results.push({ listing_id: id, success: true, old_value: oldStatus, new_value: 'paused' });
        continue;
      }

      db.run(
        'UPDATE listings SET status = ?, updated_at = ? WHERE id = ?',
        ['paused', Date.now(), id],
      );
      op.completed++;
      results.push({ listing_id: id, success: true, old_value: oldStatus, new_value: 'paused' });
      logger.debug({ listingId: id }, 'Listing paused');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      op.failed++;
      op.errors.push({ listing_id: id, error: msg });
      results.push({ listing_id: id, success: false, error: msg });
      logger.error({ err, listingId: id }, 'Failed to pause listing');
    }
  }

  completeBulkOp(db, op);
  logger.info({ opId: op.id, total: op.total, completed: op.completed, failed: op.failed }, 'Pause operation complete');
  return { operation: op, results };
}

// =============================================================================
// RESUME LISTINGS
// =============================================================================

/**
 * Resume (reactivate) paused listings. Sets status back to 'active'.
 */
export function resumeListings(
  db: Database,
  listingIds: string[],
  _platform?: string,
  userId?: string,
): BulkResult {
  const results: BulkItemResult[] = [];
  const op = createBulkOp(db, 'resume', listingIds.length, userId);

  for (const id of listingIds) {
    try {
      const rows = db.query<Record<string, unknown>>(
        'SELECT id, status FROM listings WHERE id = ?',
        [id],
      );

      if (rows.length === 0) {
        op.failed++;
        const error = `Listing ${id} not found`;
        op.errors.push({ listing_id: id, error });
        results.push({ listing_id: id, success: false, error });
        continue;
      }

      const oldStatus = rows[0].status as string;
      if (oldStatus === 'active') {
        op.completed++;
        results.push({ listing_id: id, success: true, old_value: oldStatus, new_value: 'active' });
        continue;
      }

      if (oldStatus === 'deleted') {
        op.failed++;
        const error = `Cannot resume deleted listing ${id}`;
        op.errors.push({ listing_id: id, error });
        results.push({ listing_id: id, success: false, error });
        continue;
      }

      db.run(
        'UPDATE listings SET status = ?, updated_at = ? WHERE id = ?',
        ['active', Date.now(), id],
      );
      op.completed++;
      results.push({ listing_id: id, success: true, old_value: oldStatus, new_value: 'active' });
      logger.debug({ listingId: id }, 'Listing resumed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      op.failed++;
      op.errors.push({ listing_id: id, error: msg });
      results.push({ listing_id: id, success: false, error: msg });
      logger.error({ err, listingId: id }, 'Failed to resume listing');
    }
  }

  completeBulkOp(db, op);
  logger.info({ opId: op.id, total: op.total, completed: op.completed, failed: op.failed }, 'Resume operation complete');
  return { operation: op, results };
}

// =============================================================================
// DELETE LISTINGS
// =============================================================================

/**
 * Mark listings as deleted in the DB. Does not physically remove rows.
 */
export function deleteListings(
  db: Database,
  listingIds: string[],
  _platform?: string,
  userId?: string,
): BulkResult {
  const results: BulkItemResult[] = [];
  const op = createBulkOp(db, 'delete', listingIds.length, userId);

  for (const id of listingIds) {
    try {
      const rows = db.query<Record<string, unknown>>(
        'SELECT id, status FROM listings WHERE id = ?',
        [id],
      );

      if (rows.length === 0) {
        op.failed++;
        const error = `Listing ${id} not found`;
        op.errors.push({ listing_id: id, error });
        results.push({ listing_id: id, success: false, error });
        continue;
      }

      const oldStatus = rows[0].status as string;
      if (oldStatus === 'deleted') {
        op.completed++;
        results.push({ listing_id: id, success: true, old_value: oldStatus, new_value: 'deleted' });
        continue;
      }

      db.run(
        'UPDATE listings SET status = ?, updated_at = ? WHERE id = ?',
        ['deleted', Date.now(), id],
      );
      op.completed++;
      results.push({ listing_id: id, success: true, old_value: oldStatus, new_value: 'deleted' });
      logger.debug({ listingId: id }, 'Listing deleted');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      op.failed++;
      op.errors.push({ listing_id: id, error: msg });
      results.push({ listing_id: id, success: false, error: msg });
      logger.error({ err, listingId: id }, 'Failed to delete listing');
    }
  }

  completeBulkOp(db, op);
  logger.info({ opId: op.id, total: op.total, completed: op.completed, failed: op.failed }, 'Delete operation complete');
  return { operation: op, results };
}

// =============================================================================
// BULK PRICE UPDATE
// =============================================================================

/**
 * Batch price updates for multiple listings.
 */
export function bulkUpdatePrice(
  db: Database,
  updates: PriceUpdate[],
  userId?: string,
): BulkResult {
  const results: BulkItemResult[] = [];
  const op = createBulkOp(db, 'price_update', updates.length, userId);

  for (const update of updates) {
    try {
      if (!Number.isFinite(update.new_price) || update.new_price <= 0) {
        op.failed++;
        const error = `Invalid price: ${update.new_price}`;
        op.errors.push({ listing_id: update.listing_id, error });
        results.push({ listing_id: update.listing_id, success: false, error });
        continue;
      }

      const rows = db.query<Record<string, unknown>>(
        'SELECT id, price, status FROM listings WHERE id = ?',
        [update.listing_id],
      );

      if (rows.length === 0) {
        op.failed++;
        const error = `Listing ${update.listing_id} not found`;
        op.errors.push({ listing_id: update.listing_id, error });
        results.push({ listing_id: update.listing_id, success: false, error });
        continue;
      }

      const oldPrice = rows[0].price as number;
      const newPrice = Math.round(update.new_price * 100) / 100;

      db.run(
        'UPDATE listings SET price = ?, updated_at = ? WHERE id = ?',
        [newPrice, Date.now(), update.listing_id],
      );
      op.completed++;
      results.push({
        listing_id: update.listing_id,
        success: true,
        old_value: oldPrice,
        new_value: newPrice,
      });
      logger.debug({ listingId: update.listing_id, oldPrice, newPrice }, 'Price updated');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      op.failed++;
      op.errors.push({ listing_id: update.listing_id, error: msg });
      results.push({ listing_id: update.listing_id, success: false, error: msg });
      logger.error({ err, listingId: update.listing_id }, 'Failed to update price');
    }
  }

  completeBulkOp(db, op);
  logger.info({ opId: op.id, total: op.total, completed: op.completed, failed: op.failed }, 'Price update operation complete');
  return { operation: op, results };
}

// =============================================================================
// FILTER LISTINGS
// =============================================================================

/**
 * Query listings by various filter criteria.
 */
export function getListingsByFilter(
  db: Database,
  filter: BulkFilter,
): Array<Record<string, unknown>> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  if (filter.platform) {
    conditions.push('platform = ?');
    params.push(filter.platform);
  }
  if (filter.category) {
    // Join with products table for category filter
    conditions.push('product_id IN (SELECT id FROM products WHERE category = ?)');
    params.push(filter.category);
  }
  if (filter.created_after !== undefined && Number.isFinite(filter.created_after)) {
    conditions.push('created_at >= ?');
    params.push(filter.created_after);
  }
  if (filter.created_before !== undefined && Number.isFinite(filter.created_before)) {
    conditions.push('created_at <= ?');
    params.push(filter.created_before);
  }
  if (filter.min_price !== undefined && Number.isFinite(filter.min_price)) {
    conditions.push('price >= ?');
    params.push(filter.min_price);
  }
  if (filter.max_price !== undefined && Number.isFinite(filter.max_price)) {
    conditions.push('price <= ?');
    params.push(filter.max_price);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const limit = Math.min(filter.limit ?? 100, 1000);
  const offset = filter.offset ?? 0;

  try {
    const sql = `SELECT * FROM listings ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    return db.query<Record<string, unknown>>(sql, params);
  } catch (err) {
    logger.error({ err, filter }, 'Failed to filter listings');
    return [];
  }
}

// =============================================================================
// GET BULK OPERATIONS
// =============================================================================

/**
 * List bulk operation records.
 */
export function getBulkOperations(
  db: Database,
  options?: { status?: string; limit?: number },
): BulkOperation[] {
  const limit = options?.limit ?? 10;

  try {
    let sql: string;
    let params: unknown[];

    if (options?.status) {
      sql = 'SELECT * FROM bulk_operations WHERE status = ? ORDER BY created_at DESC LIMIT ?';
      params = [options.status, limit];
    } else {
      sql = 'SELECT * FROM bulk_operations ORDER BY created_at DESC LIMIT ?';
      params = [limit];
    }

    const rows = db.query<Record<string, unknown>>(sql, params);
    return rows.map(parseBulkOpRow);
  } catch (err) {
    logger.error({ err }, 'Failed to get bulk operations');
    return [];
  }
}

// =============================================================================
// HELPERS: Resolve listing IDs from platform/category filters
// =============================================================================

/**
 * Get listing IDs matching a platform or category filter.
 * Used to resolve filter-based operations (e.g., "pause all eBay listings").
 */
export function resolveListingIds(
  db: Database,
  options: { listing_ids?: string[]; platform?: string; category?: string },
): string[] {
  // If explicit IDs are provided, use them
  if (options.listing_ids && options.listing_ids.length > 0) {
    return options.listing_ids;
  }

  const conditions: string[] = ["status != 'deleted'"];
  const params: unknown[] = [];

  if (options.platform) {
    conditions.push('platform = ?');
    params.push(options.platform);
  }
  if (options.category) {
    conditions.push('product_id IN (SELECT id FROM products WHERE category = ?)');
    params.push(options.category);
  }

  if (conditions.length <= 1 && params.length === 0) {
    // No filter specified, refuse to operate on all listings
    logger.warn('No filter specified for resolveListingIds, returning empty');
    return [];
  }

  try {
    const sql = `SELECT id FROM listings WHERE ${conditions.join(' AND ')}`;
    const rows = db.query<{ id: string }>(sql, params);
    return rows.map(r => r.id);
  } catch (err) {
    logger.error({ err }, 'Failed to resolve listing IDs');
    return [];
  }
}

// =============================================================================
// ROW PARSER
// =============================================================================

function parseBulkOpRow(row: Record<string, unknown>): BulkOperation {
  let errors: BulkError[] = [];
  try {
    errors = JSON.parse((row.errors as string) ?? '[]');
  } catch {
    errors = [];
  }

  return {
    id: row.id as string,
    user_id: row.user_id as string,
    type: row.type as BulkOpType,
    status: row.status as BulkOperation['status'],
    total: (row.total as number) ?? 0,
    completed: (row.completed as number) ?? 0,
    failed: (row.failed as number) ?? 0,
    errors,
    created_at: (row.created_at as number) ?? Date.now(),
    completed_at: (row.completed_at as number) ?? null,
  };
}
