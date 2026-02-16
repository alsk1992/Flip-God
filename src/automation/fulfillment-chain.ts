/**
 * Fulfillment Chain - Order-to-Fulfillment Automation
 *
 * When a sale is detected on a selling platform, this module automates:
 * 1. Detecting new orders across selling platforms
 * 2. Finding the cheapest source to purchase from
 * 3. Auto-purchasing from the source (with safety caps)
 * 4. Tracking shipment from source
 * 5. Pushing tracking info to the selling platform
 *
 * Each order flows through a state machine:
 *   new_order → source_identified → purchasing → purchased →
 *   tracking_received → tracking_pushed → delivered → complete
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';

const logger = createLogger('fulfillment-chain');

// =============================================================================
// TYPES
// =============================================================================

export interface FulfillmentChainConfig {
  enabled: boolean;
  pollIntervalMs: number;
  autoPurchase: boolean;
  autoTrackingPush: boolean;
  maxAutoPurchaseAmount: number;
  notifyOnNewOrder: boolean;
  notifyOnPurchase: boolean;
  notifyOnShipped: boolean;
  platforms: string[];
  sourcePriorityOrder: string[];
}

export type FulfillmentStatus =
  | 'new_order'
  | 'source_identified'
  | 'purchasing'
  | 'purchased'
  | 'tracking_received'
  | 'tracking_pushed'
  | 'delivered'
  | 'complete'
  | 'purchase_failed'
  | 'tracking_failed'
  | 'manual_needed'
  | 'cancelled';

export interface FulfillmentChainEntry {
  id: string;
  sellOrderId: string;
  sellPlatform: string;
  sellListingId: string | null;
  buyerName: string | null;
  buyerAddress: string | null;
  itemName: string | null;
  itemSku: string | null;
  sellPrice: number | null;
  sourcePlatform: string | null;
  sourceProductId: string | null;
  sourceOrderId: string | null;
  sourcePrice: number | null;
  estimatedProfit: number | null;
  trackingNumber: string | null;
  carrier: string | null;
  status: FulfillmentStatus;
  errorMessage: string | null;
  autoPurchased: boolean;
  autoTracked: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface FulfillmentChainLogEntry {
  id: string;
  chainId: string;
  action: string;
  details: string | null;
  createdAt: number;
}

export interface ChainEntryFilters {
  status?: FulfillmentStatus | FulfillmentStatus[];
  sellPlatform?: string;
  sourcePlatform?: string;
  dateFrom?: number;
  dateTo?: number;
  limit?: number;
  offset?: number;
}

/** Detected order from a selling platform */
export interface DetectedOrder {
  sellOrderId: string;
  sellPlatform: string;
  sellListingId?: string;
  buyerName?: string;
  buyerAddress?: string;
  itemName?: string;
  itemSku?: string;
  sellPrice?: number;
}

/** Source lookup result */
export interface SourceResult {
  platform: string;
  productId: string;
  price: number;
}

/** Purchase result from source */
export interface PurchaseResult {
  orderId: string;
  estimatedDelivery?: string;
}

/** Tracking info from source */
export interface TrackingInfo {
  trackingNumber: string;
  carrier: string;
}

/** Dependencies injected into the fulfillment cycle */
export interface FulfillmentDeps {
  checkOrders: (platform: string) => Promise<DetectedOrder[]>;
  findSource: (productId: string, sku: string | null) => Promise<SourceResult | null>;
  purchaseFromSource: (source: SourceResult, buyerAddress: string) => Promise<PurchaseResult>;
  pushTracking: (sellPlatform: string, sellOrderId: string, tracking: TrackingInfo) => Promise<boolean>;
  checkTracking?: (sourcePlatform: string, sourceOrderId: string) => Promise<TrackingInfo | null>;
}

/** Summary of actions taken in one cycle */
export interface CycleSummary {
  ordersDetected: number;
  sourcesFound: number;
  purchasesInitiated: number;
  purchasesFailed: number;
  trackingReceived: number;
  trackingPushed: number;
  trackingFailed: number;
  errors: string[];
}

/** Daemon handle */
export interface FulfillmentDaemon {
  stop: () => void;
}

/** Pipeline counts */
export interface PipelineCounts {
  new_order: number;
  source_identified: number;
  purchasing: number;
  purchased: number;
  tracking_received: number;
  tracking_pushed: number;
  delivered: number;
  complete: number;
  purchase_failed: number;
  tracking_failed: number;
  manual_needed: number;
  cancelled: number;
  total: number;
}

/** Fulfillment statistics */
export interface FulfillmentStats {
  totalOrders: number;
  autoPurchased: number;
  autoTracked: number;
  avgProfit: number | null;
  totalProfit: number;
  byPlatform: Record<string, { orders: number; avgProfit: number; totalProfit: number }>;
  byStatus: Record<string, number>;
  successRate: number;
}

// =============================================================================
// DEFAULT CONFIG
// =============================================================================

const DEFAULT_CONFIG: FulfillmentChainConfig = {
  enabled: false,
  pollIntervalMs: 300_000, // 5 minutes
  autoPurchase: false,
  autoTrackingPush: false,
  maxAutoPurchaseAmount: 50,
  notifyOnNewOrder: true,
  notifyOnPurchase: true,
  notifyOnShipped: true,
  platforms: ['ebay', 'amazon', 'poshmark', 'mercari'],
  sourcePriorityOrder: ['aliexpress', 'amazon', 'walmart'],
};

// =============================================================================
// MIGRATION SQL
// =============================================================================

export const MIGRATION_027_UP = `
  CREATE TABLE IF NOT EXISTS fulfillment_chain (
    id TEXT PRIMARY KEY,
    sell_order_id TEXT NOT NULL,
    sell_platform TEXT NOT NULL,
    sell_listing_id TEXT,
    buyer_name TEXT,
    buyer_address TEXT,
    item_name TEXT,
    item_sku TEXT,
    sell_price REAL,
    source_platform TEXT,
    source_product_id TEXT,
    source_order_id TEXT,
    source_price REAL,
    estimated_profit REAL,
    tracking_number TEXT,
    carrier TEXT,
    status TEXT NOT NULL DEFAULT 'new_order',
    error_message TEXT,
    auto_purchased INTEGER DEFAULT 0,
    auto_tracked INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_fulfillment_chain_status ON fulfillment_chain(status);
  CREATE INDEX IF NOT EXISTS idx_fulfillment_chain_sell_order ON fulfillment_chain(sell_order_id);

  CREATE TABLE IF NOT EXISTS fulfillment_chain_config (
    id TEXT PRIMARY KEY,
    config TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS fulfillment_chain_log (
    id TEXT PRIMARY KEY,
    chain_id TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_fulfillment_chain_log_chain ON fulfillment_chain_log(chain_id);
`;

export const MIGRATION_027_DOWN = `
  DROP TABLE IF EXISTS fulfillment_chain_log;
  DROP TABLE IF EXISTS fulfillment_chain_config;
  DROP TABLE IF EXISTS fulfillment_chain;
`;

// =============================================================================
// BOOTSTRAP (idempotent)
// =============================================================================

export function ensureFulfillmentChainTables(db: Database): void {
  const rows = db.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='fulfillment_chain'",
  );
  if (rows.length === 0) {
    db.run(MIGRATION_027_UP);
    logger.info('Created fulfillment_chain tables');
  }
}

// =============================================================================
// CONFIG
// =============================================================================

export function saveFulfillmentConfig(db: Database, config: Partial<FulfillmentChainConfig>): FulfillmentChainConfig {
  ensureFulfillmentChainTables(db);

  const existing = getFulfillmentConfig(db);
  const merged: FulfillmentChainConfig = { ...existing, ...config };

  const id = 'default';
  const now = Date.now();

  // Upsert: delete + insert for sql.js compatibility
  db.run('DELETE FROM fulfillment_chain_config WHERE id = ?', [id]);
  db.run(
    'INSERT INTO fulfillment_chain_config (id, config, enabled, created_at) VALUES (?, ?, ?, ?)',
    [id, JSON.stringify(merged), merged.enabled ? 1 : 0, now],
  );

  logger.info({ config: merged }, 'Saved fulfillment chain config');
  return merged;
}

export function getFulfillmentConfig(db: Database): FulfillmentChainConfig {
  ensureFulfillmentChainTables(db);

  const rows = db.query<{ config: string }>(
    'SELECT config FROM fulfillment_chain_config WHERE id = ? LIMIT 1',
    ['default'],
  );

  if (rows.length === 0) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const parsed = JSON.parse(rows[0].config) as Partial<FulfillmentChainConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    logger.warn('Failed to parse fulfillment config, using defaults');
    return { ...DEFAULT_CONFIG };
  }
}

// =============================================================================
// CHAIN ENTRIES (CRUD)
// =============================================================================

export function createChainEntry(db: Database, order: DetectedOrder): FulfillmentChainEntry {
  ensureFulfillmentChainTables(db);

  // Check if this sell_order_id already exists to prevent duplicates
  const existing = db.query<{ id: string }>(
    'SELECT id FROM fulfillment_chain WHERE sell_order_id = ? AND sell_platform = ?',
    [order.sellOrderId, order.sellPlatform],
  );

  if (existing.length > 0) {
    logger.info({ sellOrderId: order.sellOrderId }, 'Chain entry already exists, skipping');
    return getChainEntry(db, existing[0].id)!;
  }

  const id = randomUUID();
  const now = Date.now();

  db.run(
    `INSERT INTO fulfillment_chain
      (id, sell_order_id, sell_platform, sell_listing_id, buyer_name, buyer_address,
       item_name, item_sku, sell_price, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new_order', ?, ?)`,
    [
      id,
      order.sellOrderId,
      order.sellPlatform,
      order.sellListingId ?? null,
      order.buyerName ?? null,
      order.buyerAddress ?? null,
      order.itemName ?? null,
      order.itemSku ?? null,
      Number.isFinite(order.sellPrice) ? order.sellPrice! : null,
      now,
      now,
    ],
  );

  logChainAction(db, id, 'order_detected', {
    sellOrderId: order.sellOrderId,
    sellPlatform: order.sellPlatform,
    sellPrice: order.sellPrice,
    itemName: order.itemName,
  });

  logger.info({ chainId: id, sellOrderId: order.sellOrderId, platform: order.sellPlatform }, 'Created chain entry');

  return getChainEntry(db, id)!;
}

export function updateChainStatus(
  db: Database,
  chainId: string,
  status: FulfillmentStatus,
  details?: Record<string, unknown>,
): void {
  ensureFulfillmentChainTables(db);

  const now = Date.now();
  const updates: string[] = ['status = ?', 'updated_at = ?'];
  const params: (string | number | null)[] = [status, now];

  if (details?.sourcePlatform !== undefined) {
    updates.push('source_platform = ?');
    params.push(details.sourcePlatform as string);
  }
  if (details?.sourceProductId !== undefined) {
    updates.push('source_product_id = ?');
    params.push(details.sourceProductId as string);
  }
  if (details?.sourcePrice !== undefined) {
    updates.push('source_price = ?');
    params.push(Number.isFinite(details.sourcePrice) ? (details.sourcePrice as number) : null);
  }
  if (details?.sourceOrderId !== undefined) {
    updates.push('source_order_id = ?');
    params.push(details.sourceOrderId as string);
  }
  if (details?.estimatedProfit !== undefined) {
    updates.push('estimated_profit = ?');
    params.push(Number.isFinite(details.estimatedProfit) ? (details.estimatedProfit as number) : null);
  }
  if (details?.trackingNumber !== undefined) {
    updates.push('tracking_number = ?');
    params.push(details.trackingNumber as string);
  }
  if (details?.carrier !== undefined) {
    updates.push('carrier = ?');
    params.push(details.carrier as string);
  }
  if (details?.errorMessage !== undefined) {
    updates.push('error_message = ?');
    params.push(details.errorMessage as string | null);
  }
  if (details?.autoPurchased !== undefined) {
    updates.push('auto_purchased = ?');
    params.push(details.autoPurchased ? 1 : 0);
  }
  if (details?.autoTracked !== undefined) {
    updates.push('auto_tracked = ?');
    params.push(details.autoTracked ? 1 : 0);
  }

  params.push(chainId);

  db.run(`UPDATE fulfillment_chain SET ${updates.join(', ')} WHERE id = ?`, params);

  logChainAction(db, chainId, `status_${status}`, { status, ...details });

  logger.info({ chainId, status }, 'Updated chain status');
}

export function getChainEntries(db: Database, filters?: ChainEntryFilters): FulfillmentChainEntry[] {
  ensureFulfillmentChainTables(db);

  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filters?.status) {
    if (Array.isArray(filters.status)) {
      const placeholders = filters.status.map(() => '?').join(', ');
      conditions.push(`status IN (${placeholders})`);
      params.push(...filters.status);
    } else {
      conditions.push('status = ?');
      params.push(filters.status);
    }
  }

  if (filters?.sellPlatform) {
    conditions.push('sell_platform = ?');
    params.push(filters.sellPlatform);
  }

  if (filters?.sourcePlatform) {
    conditions.push('source_platform = ?');
    params.push(filters.sourcePlatform);
  }

  if (filters?.dateFrom !== undefined && Number.isFinite(filters.dateFrom)) {
    conditions.push('created_at >= ?');
    params.push(filters.dateFrom);
  }

  if (filters?.dateTo !== undefined && Number.isFinite(filters.dateTo)) {
    conditions.push('created_at <= ?');
    params.push(filters.dateTo);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Number.isFinite(filters?.limit) ? filters!.limit! : 100;
  const offset = Number.isFinite(filters?.offset) ? filters!.offset! : 0;

  const rows = db.query<RawChainRow>(
    `SELECT * FROM fulfillment_chain ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows.map(mapChainRow);
}

export function getChainEntry(db: Database, chainId: string): FulfillmentChainEntry | null {
  ensureFulfillmentChainTables(db);

  const rows = db.query<RawChainRow>(
    'SELECT * FROM fulfillment_chain WHERE id = ? LIMIT 1',
    [chainId],
  );

  if (rows.length === 0) return null;
  return mapChainRow(rows[0]);
}

export function getChainEntryWithLog(
  db: Database,
  chainId: string,
): { entry: FulfillmentChainEntry; log: FulfillmentChainLogEntry[] } | null {
  const entry = getChainEntry(db, chainId);
  if (!entry) return null;

  const logRows = db.query<RawLogRow>(
    'SELECT * FROM fulfillment_chain_log WHERE chain_id = ? ORDER BY created_at ASC',
    [chainId],
  );

  return {
    entry,
    log: logRows.map(mapLogRow),
  };
}

// =============================================================================
// LOGGING
// =============================================================================

export function logChainAction(
  db: Database,
  chainId: string,
  action: string,
  details?: Record<string, unknown>,
): void {
  ensureFulfillmentChainTables(db);

  const id = randomUUID();
  const now = Date.now();

  db.run(
    'INSERT INTO fulfillment_chain_log (id, chain_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, chainId, action, details ? JSON.stringify(details) : null, now],
  );
}

// =============================================================================
// FULFILLMENT CYCLE
// =============================================================================

export async function runFulfillmentCycle(
  db: Database,
  deps: FulfillmentDeps,
): Promise<CycleSummary> {
  const config = getFulfillmentConfig(db);
  const summary: CycleSummary = {
    ordersDetected: 0,
    sourcesFound: 0,
    purchasesInitiated: 0,
    purchasesFailed: 0,
    trackingReceived: 0,
    trackingPushed: 0,
    trackingFailed: 0,
    errors: [],
  };

  logger.info({ platforms: config.platforms }, 'Starting fulfillment cycle');

  // ── Step 1: Poll selling platforms for new orders ─────────────────────
  for (const platform of config.platforms) {
    try {
      const orders = await deps.checkOrders(platform);
      for (const order of orders) {
        const entry = createChainEntry(db, order);
        if (entry.status === 'new_order') {
          summary.ordersDetected++;
        }
      }
    } catch (err) {
      const msg = `Failed to check orders on ${platform}: ${err instanceof Error ? err.message : String(err)}`;
      logger.error({ platform, err }, msg);
      summary.errors.push(msg);
    }
  }

  // ── Step 2: Find sources for new_order entries ────────────────────────
  const newOrders = getChainEntries(db, { status: 'new_order' });
  for (const entry of newOrders) {
    try {
      const source = await deps.findSource(
        entry.sourceProductId ?? entry.itemSku ?? entry.sellListingId ?? '',
        entry.itemSku,
      );

      if (source) {
        const profit = entry.sellPrice != null && Number.isFinite(entry.sellPrice)
          ? entry.sellPrice - source.price
          : null;

        updateChainStatus(db, entry.id, 'source_identified', {
          sourcePlatform: source.platform,
          sourceProductId: source.productId,
          sourcePrice: source.price,
          estimatedProfit: profit,
        });
        summary.sourcesFound++;
      } else {
        updateChainStatus(db, entry.id, 'manual_needed', {
          errorMessage: 'No automated source found. Manual purchase required.',
        });
      }
    } catch (err) {
      const msg = `Failed to find source for chain ${entry.id}: ${err instanceof Error ? err.message : String(err)}`;
      logger.error({ chainId: entry.id, err }, msg);
      summary.errors.push(msg);
    }
  }

  // ── Step 3: Auto-purchase from source ─────────────────────────────────
  if (config.autoPurchase) {
    const sourcedEntries = getChainEntries(db, { status: 'source_identified' });
    for (const entry of sourcedEntries) {
      // Safety cap check
      if (
        entry.sourcePrice != null &&
        Number.isFinite(entry.sourcePrice) &&
        entry.sourcePrice > config.maxAutoPurchaseAmount
      ) {
        updateChainStatus(db, entry.id, 'manual_needed', {
          errorMessage: `Source price $${entry.sourcePrice.toFixed(2)} exceeds auto-purchase cap of $${config.maxAutoPurchaseAmount.toFixed(2)}`,
        });
        continue;
      }

      try {
        updateChainStatus(db, entry.id, 'purchasing');

        const result = await deps.purchaseFromSource(
          {
            platform: entry.sourcePlatform!,
            productId: entry.sourceProductId!,
            price: entry.sourcePrice!,
          },
          entry.buyerAddress ?? '',
        );

        updateChainStatus(db, entry.id, 'purchased', {
          sourceOrderId: result.orderId,
          autoPurchased: true,
        });
        summary.purchasesInitiated++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateChainStatus(db, entry.id, 'purchase_failed', {
          errorMessage: msg,
        });
        summary.purchasesFailed++;
        summary.errors.push(`Purchase failed for chain ${entry.id}: ${msg}`);
      }
    }
  }

  // ── Step 4: Check for tracking on purchased entries ───────────────────
  if (deps.checkTracking) {
    const purchasedEntries = getChainEntries(db, { status: 'purchased' });
    for (const entry of purchasedEntries) {
      if (!entry.sourcePlatform || !entry.sourceOrderId) continue;

      try {
        const tracking = await deps.checkTracking(entry.sourcePlatform, entry.sourceOrderId);
        if (tracking) {
          updateChainStatus(db, entry.id, 'tracking_received', {
            trackingNumber: tracking.trackingNumber,
            carrier: tracking.carrier,
          });
          summary.trackingReceived++;
        }
      } catch (err) {
        const msg = `Failed to check tracking for chain ${entry.id}: ${err instanceof Error ? err.message : String(err)}`;
        logger.warn({ chainId: entry.id, err }, msg);
        // Don't fail the entry; tracking may not be available yet
      }
    }
  }

  // ── Step 5: Push tracking to selling platform ─────────────────────────
  if (config.autoTrackingPush) {
    const trackingEntries = getChainEntries(db, { status: 'tracking_received' });
    for (const entry of trackingEntries) {
      if (!entry.trackingNumber || !entry.carrier) continue;

      try {
        const pushed = await deps.pushTracking(
          entry.sellPlatform,
          entry.sellOrderId,
          { trackingNumber: entry.trackingNumber, carrier: entry.carrier },
        );

        if (pushed) {
          updateChainStatus(db, entry.id, 'tracking_pushed', {
            autoTracked: true,
          });
          summary.trackingPushed++;
        } else {
          updateChainStatus(db, entry.id, 'tracking_failed', {
            errorMessage: 'Platform rejected tracking push',
          });
          summary.trackingFailed++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateChainStatus(db, entry.id, 'tracking_failed', {
          errorMessage: msg,
        });
        summary.trackingFailed++;
        summary.errors.push(`Tracking push failed for chain ${entry.id}: ${msg}`);
      }
    }
  }

  logger.info({ summary }, 'Fulfillment cycle complete');
  return summary;
}

// =============================================================================
// DAEMON (poll loop)
// =============================================================================

let activeDaemon: { timer: ReturnType<typeof setInterval>; running: boolean } | null = null;

export function startFulfillmentDaemon(
  db: Database,
  deps: FulfillmentDeps,
): FulfillmentDaemon {
  if (activeDaemon?.running) {
    logger.warn('Fulfillment daemon already running, stopping previous');
    stopFulfillmentDaemon();
  }

  const config = getFulfillmentConfig(db);
  const intervalMs = config.pollIntervalMs > 0 ? config.pollIntervalMs : 300_000;

  logger.info({ intervalMs }, 'Starting fulfillment daemon');

  const daemon = {
    timer: setInterval(async () => {
      try {
        const currentConfig = getFulfillmentConfig(db);
        if (!currentConfig.enabled) {
          logger.info('Fulfillment chain disabled, skipping cycle');
          return;
        }
        await runFulfillmentCycle(db, deps);
      } catch (err) {
        logger.error({ err }, 'Fulfillment cycle failed');
      }
    }, intervalMs),
    running: true,
  };

  activeDaemon = daemon;

  // Run first cycle immediately
  (async () => {
    try {
      const currentConfig = getFulfillmentConfig(db);
      if (currentConfig.enabled) {
        await runFulfillmentCycle(db, deps);
      }
    } catch (err) {
      logger.error({ err }, 'Initial fulfillment cycle failed');
    }
  })();

  return {
    stop: () => stopFulfillmentDaemon(),
  };
}

export function stopFulfillmentDaemon(): void {
  if (activeDaemon) {
    clearInterval(activeDaemon.timer);
    activeDaemon.running = false;
    activeDaemon = null;
    logger.info('Fulfillment daemon stopped');
  }
}

export function isDaemonRunning(): boolean {
  return activeDaemon?.running === true;
}

// =============================================================================
// STATISTICS & PIPELINE
// =============================================================================

export function getFulfillmentPipeline(db: Database): PipelineCounts {
  ensureFulfillmentChainTables(db);

  const rows = db.query<{ status: string; cnt: number }>(
    'SELECT status, COUNT(*) as cnt FROM fulfillment_chain GROUP BY status',
  );

  const counts: PipelineCounts = {
    new_order: 0,
    source_identified: 0,
    purchasing: 0,
    purchased: 0,
    tracking_received: 0,
    tracking_pushed: 0,
    delivered: 0,
    complete: 0,
    purchase_failed: 0,
    tracking_failed: 0,
    manual_needed: 0,
    cancelled: 0,
    total: 0,
  };

  for (const row of rows) {
    const key = row.status as keyof Omit<PipelineCounts, 'total'>;
    if (key in counts) {
      counts[key] = row.cnt;
    }
    counts.total += row.cnt;
  }

  return counts;
}

export function getFulfillmentStats(db: Database, days?: number): FulfillmentStats {
  ensureFulfillmentChainTables(db);

  let whereClause = '';
  const params: number[] = [];

  if (days != null && Number.isFinite(days) && days > 0) {
    const cutoff = Date.now() - days * 86_400_000;
    whereClause = 'WHERE created_at >= ?';
    params.push(cutoff);
  }

  // Total orders
  const totalRows = db.query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM fulfillment_chain ${whereClause}`,
    params,
  );
  const totalOrders = totalRows[0]?.cnt ?? 0;

  // Auto-purchased count
  const autoRows = db.query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM fulfillment_chain ${whereClause ? whereClause + ' AND' : 'WHERE'} auto_purchased = 1`,
    params,
  );
  const autoPurchased = autoRows[0]?.cnt ?? 0;

  // Auto-tracked count
  const trackRows = db.query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM fulfillment_chain ${whereClause ? whereClause + ' AND' : 'WHERE'} auto_tracked = 1`,
    params,
  );
  const autoTracked = trackRows[0]?.cnt ?? 0;

  // Profit aggregates
  const profitRows = db.query<{ avg_profit: number | null; total_profit: number | null }>(
    `SELECT AVG(estimated_profit) as avg_profit, SUM(estimated_profit) as total_profit
     FROM fulfillment_chain ${whereClause ? whereClause + ' AND' : 'WHERE'} estimated_profit IS NOT NULL`,
    params,
  );
  const avgProfit = profitRows[0]?.avg_profit ?? null;
  const totalProfit = profitRows[0]?.total_profit ?? 0;

  // By platform
  const platformRows = db.query<{ sell_platform: string; cnt: number; avg_p: number | null; total_p: number | null }>(
    `SELECT sell_platform, COUNT(*) as cnt,
            AVG(estimated_profit) as avg_p, SUM(estimated_profit) as total_p
     FROM fulfillment_chain ${whereClause}
     GROUP BY sell_platform`,
    params,
  );
  const byPlatform: Record<string, { orders: number; avgProfit: number; totalProfit: number }> = {};
  for (const row of platformRows) {
    byPlatform[row.sell_platform] = {
      orders: row.cnt,
      avgProfit: row.avg_p ?? 0,
      totalProfit: row.total_p ?? 0,
    };
  }

  // By status
  const statusRows = db.query<{ status: string; cnt: number }>(
    `SELECT status, COUNT(*) as cnt FROM fulfillment_chain ${whereClause} GROUP BY status`,
    params,
  );
  const byStatus: Record<string, number> = {};
  for (const row of statusRows) {
    byStatus[row.status] = row.cnt;
  }

  // Success rate: complete / (complete + failed + cancelled)
  const completedCount = byStatus['complete'] ?? 0;
  const failedCount = (byStatus['purchase_failed'] ?? 0) + (byStatus['tracking_failed'] ?? 0) + (byStatus['cancelled'] ?? 0);
  const successRate = completedCount + failedCount > 0
    ? completedCount / (completedCount + failedCount)
    : 0;

  return {
    totalOrders,
    autoPurchased,
    autoTracked,
    avgProfit,
    totalProfit,
    byPlatform,
    byStatus,
    successRate,
  };
}

// =============================================================================
// RETRY / CANCEL
// =============================================================================

export function retryChainEntry(db: Database, chainId: string): FulfillmentChainEntry | null {
  const entry = getChainEntry(db, chainId);
  if (!entry) return null;

  const retryableStatuses: FulfillmentStatus[] = ['purchase_failed', 'tracking_failed', 'manual_needed'];
  if (!retryableStatuses.includes(entry.status)) {
    logger.warn({ chainId, status: entry.status }, 'Cannot retry entry in this status');
    return null;
  }

  updateChainStatus(db, chainId, 'new_order', {
    errorMessage: null,
  });

  logChainAction(db, chainId, 'retry', {
    previousStatus: entry.status,
    previousError: entry.errorMessage,
  });

  return getChainEntry(db, chainId);
}

export function cancelChainEntry(db: Database, chainId: string, reason?: string): FulfillmentChainEntry | null {
  const entry = getChainEntry(db, chainId);
  if (!entry) return null;

  if (entry.status === 'complete' || entry.status === 'cancelled') {
    logger.warn({ chainId, status: entry.status }, 'Cannot cancel entry in this status');
    return null;
  }

  updateChainStatus(db, chainId, 'cancelled', {
    errorMessage: reason ?? 'Cancelled by user',
  });

  return getChainEntry(db, chainId);
}

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

interface RawChainRow {
  id: string;
  sell_order_id: string;
  sell_platform: string;
  sell_listing_id: string | null;
  buyer_name: string | null;
  buyer_address: string | null;
  item_name: string | null;
  item_sku: string | null;
  sell_price: number | null;
  source_platform: string | null;
  source_product_id: string | null;
  source_order_id: string | null;
  source_price: number | null;
  estimated_profit: number | null;
  tracking_number: string | null;
  carrier: string | null;
  status: string;
  error_message: string | null;
  auto_purchased: number;
  auto_tracked: number;
  created_at: number;
  updated_at: number;
}

interface RawLogRow {
  id: string;
  chain_id: string;
  action: string;
  details: string | null;
  created_at: number;
}

function mapChainRow(row: RawChainRow): FulfillmentChainEntry {
  return {
    id: row.id,
    sellOrderId: row.sell_order_id,
    sellPlatform: row.sell_platform,
    sellListingId: row.sell_listing_id,
    buyerName: row.buyer_name,
    buyerAddress: row.buyer_address,
    itemName: row.item_name,
    itemSku: row.item_sku,
    sellPrice: row.sell_price,
    sourcePlatform: row.source_platform,
    sourceProductId: row.source_product_id,
    sourceOrderId: row.source_order_id,
    sourcePrice: row.source_price,
    estimatedProfit: row.estimated_profit,
    trackingNumber: row.tracking_number,
    carrier: row.carrier,
    status: row.status as FulfillmentStatus,
    errorMessage: row.error_message,
    autoPurchased: row.auto_purchased === 1,
    autoTracked: row.auto_tracked === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapLogRow(row: RawLogRow): FulfillmentChainLogEntry {
  return {
    id: row.id,
    chainId: row.chain_id,
    action: row.action,
    details: row.details,
    createdAt: row.created_at,
  };
}
