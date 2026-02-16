/**
 * Inventory Allocation - Distribute stock across platforms
 *
 * Supports multiple allocation strategies:
 * - equal: split evenly across platforms
 * - proportional: based on sales velocity (allocation_value = relative weight)
 * - priority: fill primary platform first, remainder to others
 * - fixed_pct: fixed percentage per platform
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import type { Platform } from '../types.js';
import type { AllocationRule, AllocationInput, AllocationType, PlatformAllocation } from './types.js';

const logger = createLogger('inventory-allocation');

// =============================================================================
// Allocation Calculation
// =============================================================================

export interface AllocationPlatformInput {
  platform: Platform;
  allocationType: AllocationType;
  allocationValue: number;
  priority: number;
}

/**
 * Distribute available stock across platforms based on allocation rules.
 *
 * @param totalAvailable - Total units available for allocation
 * @param platforms - Platform allocation inputs (from rules)
 * @param rules - Allocation type override (if all platforms use the same type)
 * @returns Platform allocation results
 */
export function calculateAllocation(
  totalAvailable: number,
  platforms: AllocationPlatformInput[],
): PlatformAllocation[] {
  if (totalAvailable <= 0 || platforms.length === 0) {
    return platforms.map((p) => ({
      platform: p.platform,
      allocatedQty: 0,
      listedQty: 0,
    }));
  }

  // Group by allocation type - use the first platform's type as the strategy
  // (in practice, all platforms for a product should use the same type)
  const primaryType = platforms[0].allocationType;

  switch (primaryType) {
    case 'equal':
      return allocateEqual(totalAvailable, platforms);
    case 'proportional':
      return allocateProportional(totalAvailable, platforms);
    case 'priority':
      return allocatePriority(totalAvailable, platforms);
    case 'fixed_pct':
      return allocateFixedPct(totalAvailable, platforms);
    default:
      return allocateEqual(totalAvailable, platforms);
  }
}

/** Split stock evenly across all platforms. Remainder goes to first platform. */
function allocateEqual(
  total: number,
  platforms: AllocationPlatformInput[],
): PlatformAllocation[] {
  const count = platforms.length;
  const base = Math.floor(total / count);
  let remainder = total - base * count;

  return platforms.map((p) => {
    const extra = remainder > 0 ? 1 : 0;
    if (extra) remainder--;
    return {
      platform: p.platform,
      allocatedQty: base + extra,
      listedQty: 0,
    };
  });
}

/** Distribute proportionally based on allocation_value weights. */
function allocateProportional(
  total: number,
  platforms: AllocationPlatformInput[],
): PlatformAllocation[] {
  const totalWeight = platforms.reduce((sum, p) => sum + Math.max(0, p.allocationValue), 0);

  if (totalWeight <= 0) {
    return allocateEqual(total, platforms);
  }

  let allocated = 0;
  const results: PlatformAllocation[] = platforms.map((p, i) => {
    const weight = Math.max(0, p.allocationValue);
    const share = i === platforms.length - 1
      ? total - allocated // Last platform gets remainder to avoid rounding loss
      : Math.floor((weight / totalWeight) * total);
    allocated += share;
    return {
      platform: p.platform,
      allocatedQty: Math.max(0, share),
      listedQty: 0,
    };
  });

  return results;
}

/** Fill highest-priority platform first, remainder cascades down. */
function allocatePriority(
  total: number,
  platforms: AllocationPlatformInput[],
): PlatformAllocation[] {
  // Sort by priority (higher value = higher priority)
  const sorted = [...platforms].sort((a, b) => b.priority - a.priority);
  let remaining = total;

  const allocations = new Map<Platform, number>();

  for (const p of sorted) {
    // allocation_value for priority mode = max units this platform wants
    const maxWanted = Number.isFinite(p.allocationValue) && p.allocationValue > 0
      ? Math.floor(p.allocationValue)
      : remaining; // If no limit, take whatever is left
    const give = Math.min(remaining, maxWanted);
    allocations.set(p.platform, give);
    remaining -= give;
    if (remaining <= 0) break;
  }

  return platforms.map((p) => ({
    platform: p.platform,
    allocatedQty: allocations.get(p.platform) ?? 0,
    listedQty: 0,
  }));
}

/** Allocate based on fixed percentages. Values should sum to ~100. */
function allocateFixedPct(
  total: number,
  platforms: AllocationPlatformInput[],
): PlatformAllocation[] {
  const totalPct = platforms.reduce((sum, p) => sum + Math.max(0, p.allocationValue), 0);
  const scaleFactor = totalPct > 0 ? 100 / totalPct : 1;

  let allocated = 0;
  const results: PlatformAllocation[] = platforms.map((p, i) => {
    const pct = Math.max(0, p.allocationValue) * scaleFactor;
    const share = i === platforms.length - 1
      ? total - allocated
      : Math.floor((pct / 100) * total);
    allocated += share;
    return {
      platform: p.platform,
      allocatedQty: Math.max(0, share),
      listedQty: 0,
    };
  });

  return results;
}

// =============================================================================
// Database Operations
// =============================================================================

/** Get allocation rules for a specific product (falls back to 'default' rules). */
export function getAllocationRules(db: Database, productId: string): AllocationRule[] {
  // First try product-specific rules
  let rows = db.query<{
    id: string;
    product_id: string;
    platform: string;
    allocation_type: string;
    allocation_value: number;
    priority: number;
    created_at: number;
  }>(
    'SELECT * FROM inventory_allocation_rules WHERE product_id = ? ORDER BY priority DESC',
    [productId],
  );

  // Fall back to default rules if no product-specific ones
  if (rows.length === 0) {
    rows = db.query<{
      id: string;
      product_id: string;
      platform: string;
      allocation_type: string;
      allocation_value: number;
      priority: number;
      created_at: number;
    }>(
      "SELECT * FROM inventory_allocation_rules WHERE product_id = 'default' ORDER BY priority DESC",
    );
  }

  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    platform: row.platform as Platform,
    allocationType: row.allocation_type as AllocationType,
    allocationValue: row.allocation_value,
    priority: row.priority,
    createdAt: new Date(row.created_at),
  }));
}

/** Set or update an allocation rule for a product + platform. */
export function setAllocationRule(
  db: Database,
  productId: string,
  input: AllocationInput,
): AllocationRule {
  const id = randomUUID().slice(0, 12);
  const now = Date.now();

  // Upsert: replace existing rule for same product + platform
  db.run(
    `INSERT INTO inventory_allocation_rules (id, product_id, platform, allocation_type, allocation_value, priority, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(product_id, platform) DO UPDATE SET
       allocation_type = excluded.allocation_type,
       allocation_value = excluded.allocation_value,
       priority = excluded.priority`,
    [id, productId, input.platform, input.allocationType, input.allocationValue, input.priority, now],
  );

  logger.info(
    { productId, platform: input.platform, type: input.allocationType },
    'Allocation rule set',
  );

  return {
    id,
    productId,
    platform: input.platform,
    allocationType: input.allocationType,
    allocationValue: input.allocationValue,
    priority: input.priority,
    createdAt: new Date(now),
  };
}
