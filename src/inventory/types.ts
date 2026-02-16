/**
 * Inventory Sync Types
 */

import type { Platform } from '../types.js';

// =============================================================================
// INVENTORY HOLDS
// =============================================================================

export type HoldReason = 'order_pending' | 'fba_inbound' | 'return_processing' | 'manual_hold';

export interface InventoryHold {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  reason: HoldReason;
  referenceId?: string;
  expiresAt: Date;
  createdAt: Date;
}

// =============================================================================
// INVENTORY CONFLICTS
// =============================================================================

export type ConflictResolution = 'accept_platform' | 'accept_local' | 'manual';

export interface InventoryConflict {
  id: string;
  productId: string;
  platform: Platform;
  localQty: number;
  platformQty: number;
  resolution?: ConflictResolution;
  manualQty?: number;
  resolvedAt?: Date;
  createdAt: Date;
}

// =============================================================================
// INVENTORY SNAPSHOT
// =============================================================================

export interface WarehouseStock {
  warehouseId: string;
  warehouseName: string;
  warehouseType: string;
  quantity: number;
  reserved: number;
  holds: number;
  available: number;
}

export interface PlatformAllocation {
  platform: Platform;
  allocatedQty: number;
  listedQty: number;
}

export interface InventorySnapshot {
  productId: string;
  totalStock: number;
  totalReserved: number;
  totalHolds: number;
  totalAvailable: number;
  warehouses: WarehouseStock[];
  platforms: PlatformAllocation[];
}

// =============================================================================
// ALLOCATION RULES
// =============================================================================

export type AllocationType = 'equal' | 'proportional' | 'priority' | 'fixed_pct';

export interface AllocationRule {
  id: string;
  productId: string;
  platform: Platform;
  allocationType: AllocationType;
  allocationValue: number;
  priority: number;
  createdAt: Date;
}

export interface AllocationInput {
  platform: Platform;
  allocationType: AllocationType;
  allocationValue: number;
  priority: number;
}

// =============================================================================
// SYNC RESULT
// =============================================================================

export interface SyncResult {
  productId: string;
  synced: boolean;
  dryRun: boolean;
  snapshot: InventorySnapshot;
  conflicts: InventoryConflict[];
  allocations: PlatformAllocation[];
  errors: string[];
}
