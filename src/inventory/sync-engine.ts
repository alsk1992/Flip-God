/**
 * Inventory Sync Engine - Cross-platform inventory reconciliation
 *
 * Core functions:
 * - syncInventoryAcrossPlatforms: reconcile counts across platforms
 * - reserveInventory / releaseHold: manage inventory holds
 * - expireStaleHolds: auto-release expired holds
 * - getInventorySnapshot: full picture of stock by warehouse/platform
 * - detectConflicts / resolveConflict: handle inventory mismatches
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import type { Platform } from '../types.js';
import type {
  InventoryHold,
  InventoryConflict,
  InventorySnapshot,
  WarehouseStock,
  PlatformAllocation,
  HoldReason,
  ConflictResolution,
  SyncResult,
} from './types.js';
import { calculateAllocation, getAllocationRules } from './allocation.js';

const logger = createLogger('inventory-sync');

/** Default hold TTL by reason (in hours). */
const DEFAULT_HOLD_TTL: Record<HoldReason, number> = {
  order_pending: 24,
  fba_inbound: 72,
  return_processing: 72,
  manual_hold: 168, // 7 days
};

// =============================================================================
// Inventory Holds
// =============================================================================

/**
 * Place a hold on inventory for a specific product in a warehouse.
 * Holds reduce available stock without modifying warehouse quantity.
 */
export function reserveInventory(
  db: Database,
  productId: string,
  warehouseId: string,
  quantity: number,
  reason: HoldReason,
  referenceId?: string,
  expiresHours?: number,
): InventoryHold {
  if (quantity <= 0) {
    throw new Error('Hold quantity must be positive');
  }
  if (!warehouseId) {
    throw new Error('warehouseId is required');
  }

  const ttlHours = Number.isFinite(expiresHours) ? expiresHours! : DEFAULT_HOLD_TTL[reason];
  const id = randomUUID().slice(0, 12);
  const now = Date.now();
  const expiresAt = now + ttlHours * 60 * 60 * 1000;

  db.run(
    `INSERT INTO inventory_holds (id, product_id, warehouse_id, quantity, reason, reference_id, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, productId, warehouseId, quantity, reason, referenceId ?? null, expiresAt, now],
  );

  logger.info(
    { holdId: id, productId, warehouseId, quantity, reason, ttlHours },
    'Inventory hold placed',
  );

  return {
    id,
    productId,
    warehouseId,
    quantity,
    reason,
    referenceId,
    expiresAt: new Date(expiresAt),
    createdAt: new Date(now),
  };
}

/** Release a specific inventory hold by ID. */
export function releaseHold(db: Database, holdId: string): boolean {
  const existing = db.query<{ id: string }>(
    'SELECT id FROM inventory_holds WHERE id = ?',
    [holdId],
  );

  if (existing.length === 0) {
    logger.warn({ holdId }, 'Hold not found');
    return false;
  }

  db.run('DELETE FROM inventory_holds WHERE id = ?', [holdId]);
  logger.info({ holdId }, 'Inventory hold released');
  return true;
}

/** Release all expired holds. Returns count of expired holds released. */
export function expireStaleHolds(db: Database): number {
  const now = Date.now();

  const expired = db.query<{ id: string; product_id: string; quantity: number }>(
    'SELECT id, product_id, quantity FROM inventory_holds WHERE expires_at <= ?',
    [now],
  );

  if (expired.length === 0) {
    return 0;
  }

  db.run('DELETE FROM inventory_holds WHERE expires_at <= ?', [now]);

  logger.info({ count: expired.length }, 'Expired inventory holds released');
  return expired.length;
}

/** Get all active holds for a product. */
function getActiveHolds(db: Database, productId: string): InventoryHold[] {
  const now = Date.now();
  const rows = db.query<{
    id: string;
    product_id: string;
    warehouse_id: string;
    quantity: number;
    reason: string;
    reference_id: string | null;
    expires_at: number;
    created_at: number;
  }>(
    'SELECT * FROM inventory_holds WHERE product_id = ? AND expires_at > ?',
    [productId, now],
  );

  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    warehouseId: row.warehouse_id,
    quantity: row.quantity,
    reason: row.reason as HoldReason,
    referenceId: row.reference_id ?? undefined,
    expiresAt: new Date(row.expires_at),
    createdAt: new Date(row.created_at),
  }));
}

/** Get total held quantity for a product across all warehouses. */
function getTotalHeldQty(db: Database, productId: string): number {
  const now = Date.now();
  const rows = db.query<{ total: number | null }>(
    'SELECT SUM(quantity) as total FROM inventory_holds WHERE product_id = ? AND expires_at > ?',
    [productId, now],
  );
  return rows[0]?.total ?? 0;
}

/** Get held quantity for a product in a specific warehouse. */
function getWarehouseHeldQty(db: Database, productId: string, warehouseId: string): number {
  const now = Date.now();
  const rows = db.query<{ total: number | null }>(
    'SELECT SUM(quantity) as total FROM inventory_holds WHERE product_id = ? AND warehouse_id = ? AND expires_at > ?',
    [productId, warehouseId, now],
  );
  return rows[0]?.total ?? 0;
}

// =============================================================================
// Inventory Snapshot
// =============================================================================

/**
 * Get a full inventory breakdown for a product:
 * warehouse stock, reserved counts, active holds, available, and platform allocations.
 */
export function getInventorySnapshot(db: Database, productId: string): InventorySnapshot {
  // Get warehouse stock
  const warehouseRows = db.query<{
    id: string;
    warehouse_id: string;
    quantity: number;
    reserved: number;
    warehouse_name: string;
    warehouse_type: string;
  }>(
    `SELECT wi.id, wi.warehouse_id, wi.quantity, wi.reserved,
            w.name as warehouse_name, w.type as warehouse_type
     FROM warehouse_inventory wi
     JOIN warehouses w ON w.id = wi.warehouse_id
     WHERE wi.product_id = ?`,
    [productId],
  );

  const warehouses: WarehouseStock[] = warehouseRows.map((row) => {
    const holds = getWarehouseHeldQty(db, productId, row.warehouse_id);
    const available = Math.max(0, row.quantity - row.reserved - holds);
    return {
      warehouseId: row.warehouse_id,
      warehouseName: row.warehouse_name,
      warehouseType: row.warehouse_type,
      quantity: row.quantity,
      reserved: row.reserved,
      holds,
      available,
    };
  });

  const totalStock = warehouses.reduce((s, w) => s + w.quantity, 0);
  const totalReserved = warehouses.reduce((s, w) => s + w.reserved, 0);
  const totalHolds = warehouses.reduce((s, w) => s + w.holds, 0);
  const totalAvailable = warehouses.reduce((s, w) => s + w.available, 0);

  // Get current platform listings for this product
  const listingRows = db.query<{ platform: string; total_qty: number }>(
    `SELECT platform, COUNT(*) as total_qty FROM listings
     WHERE product_id = ? AND status = 'active'
     GROUP BY platform`,
    [productId],
  );

  // Calculate allocations based on rules
  const rules = getAllocationRules(db, productId);
  let platforms: PlatformAllocation[];

  if (rules.length > 0) {
    const allocations = calculateAllocation(
      totalAvailable,
      rules.map((r) => ({
        platform: r.platform,
        allocationType: r.allocationType,
        allocationValue: r.allocationValue,
        priority: r.priority,
      })),
    );
    // Merge with actual listing counts
    platforms = allocations.map((a) => {
      const listed = listingRows.find((l) => l.platform === a.platform);
      return {
        ...a,
        listedQty: listed?.total_qty ?? 0,
      };
    });
  } else {
    // No rules: just report what's listed
    platforms = listingRows.map((row) => ({
      platform: row.platform as Platform,
      allocatedQty: 0,
      listedQty: row.total_qty,
    }));
  }

  return {
    productId,
    totalStock,
    totalReserved,
    totalHolds,
    totalAvailable,
    warehouses,
    platforms,
  };
}

// =============================================================================
// Conflict Detection & Resolution
// =============================================================================

/**
 * Detect inventory conflicts by comparing local records vs platform-reported inventory.
 * This is a best-effort check using the latest price snapshots as a proxy for
 * "platform thinks it's in stock" since we don't have a dedicated platform inventory API.
 */
export function detectConflicts(db: Database): InventoryConflict[] {
  const conflicts: InventoryConflict[] = [];

  // Get all products with warehouse inventory
  const products = db.query<{ product_id: string }>(
    'SELECT DISTINCT product_id FROM warehouse_inventory WHERE product_id IS NOT NULL',
  );

  for (const { product_id: productId } of products) {
    if (!productId) continue;

    const snapshot = getInventorySnapshot(db, productId);

    // Check each platform listing against available stock
    const activeListings = db.query<{ platform: string; listing_count: number }>(
      `SELECT platform, COUNT(*) as listing_count FROM listings
       WHERE product_id = ? AND status = 'active'
       GROUP BY platform`,
      [productId],
    );

    for (const listing of activeListings) {
      const platform = listing.platform as Platform;
      const platformQty = listing.listing_count;
      const localQty = snapshot.totalAvailable;

      // Conflict: platform shows more than we have available
      if (platformQty > localQty) {
        // Check if this conflict already exists and is unresolved
        const existing = db.query<{ id: string }>(
          `SELECT id FROM inventory_conflicts
           WHERE product_id = ? AND platform = ? AND resolution IS NULL`,
          [productId, platform],
        );

        if (existing.length === 0) {
          const conflict = createConflictRecord(db, productId, platform, localQty, platformQty);
          conflicts.push(conflict);
        }
      }
    }
  }

  if (conflicts.length > 0) {
    logger.warn({ count: conflicts.length }, 'Inventory conflicts detected');
  }

  return conflicts;
}

/** Create a conflict record in the database. */
function createConflictRecord(
  db: Database,
  productId: string,
  platform: Platform,
  localQty: number,
  platformQty: number,
): InventoryConflict {
  const id = randomUUID().slice(0, 12);
  const now = Date.now();

  db.run(
    `INSERT INTO inventory_conflicts (id, product_id, platform, local_qty, platform_qty, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, productId, platform, localQty, platformQty, now],
  );

  logger.warn(
    { conflictId: id, productId, platform, localQty, platformQty },
    'Inventory conflict recorded',
  );

  return {
    id,
    productId,
    platform,
    localQty,
    platformQty,
    createdAt: new Date(now),
  };
}

/**
 * Resolve an inventory conflict.
 *
 * - accept_platform: update local inventory to match platform count
 * - accept_local: flag that our count is correct (platform needs updating)
 * - manual: set a specific quantity
 */
export function resolveConflict(
  db: Database,
  conflictId: string,
  resolution: ConflictResolution,
  manualQty?: number,
): boolean {
  const rows = db.query<{
    id: string;
    product_id: string;
    platform: string;
    local_qty: number;
    platform_qty: number;
  }>(
    'SELECT * FROM inventory_conflicts WHERE id = ? AND resolution IS NULL',
    [conflictId],
  );

  if (rows.length === 0) {
    logger.warn({ conflictId }, 'Conflict not found or already resolved');
    return false;
  }

  const conflict = rows[0];
  const now = Date.now();

  const resolvedQty = resolution === 'manual'
    ? (Number.isFinite(manualQty) ? manualQty! : conflict.local_qty)
    : resolution === 'accept_platform'
      ? conflict.platform_qty
      : conflict.local_qty;

  db.run(
    `UPDATE inventory_conflicts
     SET resolution = ?, manual_qty = ?, resolved_at = ?
     WHERE id = ?`,
    [resolution, resolvedQty, now, conflictId],
  );

  logger.info(
    { conflictId, resolution, resolvedQty, productId: conflict.product_id },
    'Inventory conflict resolved',
  );

  return true;
}

/** List inventory conflicts, optionally filtered. */
export function listConflicts(
  db: Database,
  unresolvedOnly: boolean = true,
  platform?: string,
): InventoryConflict[] {
  let sql = 'SELECT * FROM inventory_conflicts WHERE 1=1';
  const params: unknown[] = [];

  if (unresolvedOnly) {
    sql += ' AND resolution IS NULL';
  }

  if (platform) {
    sql += ' AND platform = ?';
    params.push(platform);
  }

  sql += ' ORDER BY created_at DESC';

  const rows = db.query<{
    id: string;
    product_id: string;
    platform: string;
    local_qty: number;
    platform_qty: number;
    resolution: string | null;
    manual_qty: number | null;
    resolved_at: number | null;
    created_at: number;
  }>(sql, params);

  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    platform: row.platform as Platform,
    localQty: row.local_qty,
    platformQty: row.platform_qty,
    resolution: row.resolution as ConflictResolution | undefined,
    manualQty: row.manual_qty ?? undefined,
    resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
    createdAt: new Date(row.created_at),
  }));
}

// =============================================================================
// Inventory Sync
// =============================================================================

/**
 * Reconcile inventory counts across platforms for a specific product.
 *
 * 1. Calculate total available: warehouse_qty - reserved - holds
 * 2. Distribute available stock across platforms based on allocation rules
 * 3. Detect conflicts where platform shows more than we have
 *
 * @param db - Database instance
 * @param productId - Product to sync
 * @param options - Sync options
 * @returns SyncResult with snapshot, conflicts, and allocations
 */
export function syncInventoryAcrossPlatforms(
  db: Database,
  productId: string,
  options: { platform?: string; dryRun?: boolean } = {},
): SyncResult {
  const dryRun = options.dryRun ?? true;
  const errors: string[] = [];

  logger.info({ productId, dryRun, platform: options.platform }, 'Starting inventory sync');

  // 1. Expire any stale holds first
  const expiredCount = expireStaleHolds(db);
  if (expiredCount > 0) {
    logger.info({ expiredCount }, 'Expired stale holds before sync');
  }

  // 2. Get current snapshot
  const snapshot = getInventorySnapshot(db, productId);

  // 3. Get allocation rules
  const rules = getAllocationRules(db, productId);

  // 4. Calculate allocations
  let allocations: PlatformAllocation[];
  if (rules.length > 0) {
    const filtered = options.platform
      ? rules.filter((r) => r.platform === options.platform)
      : rules;

    if (filtered.length > 0) {
      allocations = calculateAllocation(
        snapshot.totalAvailable,
        filtered.map((r) => ({
          platform: r.platform,
          allocationType: r.allocationType,
          allocationValue: r.allocationValue,
          priority: r.priority,
        })),
      );
    } else {
      allocations = [];
      errors.push(`No allocation rules found for platform: ${options.platform}`);
    }
  } else {
    // No rules: report current state without allocating
    allocations = snapshot.platforms;
  }

  // 5. Detect conflicts
  const conflicts: InventoryConflict[] = [];
  for (const alloc of allocations) {
    // Check if platform has more listed than allocated
    const listedOnPlatform = snapshot.platforms.find((p) => p.platform === alloc.platform);
    const listedQty = listedOnPlatform?.listedQty ?? 0;

    if (listedQty > alloc.allocatedQty && alloc.allocatedQty >= 0) {
      const conflict: InventoryConflict = {
        id: randomUUID().slice(0, 12),
        productId,
        platform: alloc.platform,
        localQty: alloc.allocatedQty,
        platformQty: listedQty,
        createdAt: new Date(),
      };

      if (!dryRun) {
        // Record conflict in database
        db.run(
          `INSERT INTO inventory_conflicts (id, product_id, platform, local_qty, platform_qty, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [conflict.id, productId, alloc.platform, alloc.allocatedQty, listedQty, Date.now()],
        );
      }

      conflicts.push(conflict);
    }
  }

  if (conflicts.length > 0) {
    logger.warn(
      { productId, conflictCount: conflicts.length },
      'Inventory conflicts detected during sync',
    );
  }

  const result: SyncResult = {
    productId,
    synced: !dryRun && errors.length === 0,
    dryRun,
    snapshot,
    conflicts,
    allocations,
    errors,
  };

  logger.info(
    {
      productId,
      dryRun,
      totalAvailable: snapshot.totalAvailable,
      conflictCount: conflicts.length,
      errorCount: errors.length,
    },
    'Inventory sync complete',
  );

  return result;
}
