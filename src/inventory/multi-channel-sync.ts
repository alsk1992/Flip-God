/**
 * Multi-Channel Inventory Sync
 *
 * Real-time inventory synchronization across selling platforms (Amazon, eBay,
 * Walmart, etc.) to prevent overselling. Builds on the existing sync-engine
 * with a cross-platform distribution loop.
 *
 * Core capabilities:
 *   - SKU-level channel mappings linking one inventory pool to N platform listings
 *   - Automatic quantity distribution with buffer stock and per-channel caps
 *   - Sale/restock recording with full event audit trail
 *   - Background sync daemon with configurable interval
 *   - Oversell protection: never push more than available
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger.js';
import { generateId } from '../utils/id.js';
import type { Database } from '../db/index.js';

const logger = createLogger('multi-channel-sync');

// =============================================================================
// Types
// =============================================================================

export interface ChannelMapping {
  id: string;
  sku: string;
  productId: string | null;
  channels: ChannelEntry[];
  totalQuantity: number;
  reservedQuantity: number;
  availableQuantity: number;
  syncEnabled: boolean;
  lastSyncAt: number | null;
  createdAt: number;
}

export interface ChannelEntry {
  id: string;
  platform: string;
  listingId: string;
  platformSku: string | null;
  quantity: number;
  lastPushedQuantity: number;
  lastPushAt: number | null;
}

export type SyncEventType =
  | 'sale'
  | 'restock'
  | 'adjustment'
  | 'sync_push'
  | 'sync_pull'
  | 'error';

export interface SyncEvent {
  id: string;
  sku: string;
  eventType: SyncEventType;
  platform: string;
  quantityChange: number;
  previousQuantity: number;
  newQuantity: number;
  details: string | null;
  createdAt: number;
}

export interface SyncDaemonConfig {
  enabled: boolean;
  intervalMs: number;
  platforms: string[];
  bufferStock: number;
  oversellProtection: boolean;
  maxQuantityPerChannel: number | null;
}

export type PushFn = (
  platform: string,
  listingId: string,
  quantity: number,
) => boolean;

export interface SyncToChannelsResult {
  synced: number;
  failed: number;
  channels: {
    platform: string;
    listingId: string;
    quantity: number;
    success: boolean;
  }[];
}

export interface SyncCycleResult {
  mappingsChecked: number;
  mappingsSynced: number;
  totalPushes: number;
}

export interface SyncStats {
  totalSyncs: number;
  totalSales: number;
  totalRestocks: number;
  totalErrors: number;
  oversellIncidents: number;
  eventsByDay: { date: string; count: number }[];
}

// =============================================================================
// Default daemon config
// =============================================================================

const DEFAULT_DAEMON_CONFIG: SyncDaemonConfig = {
  enabled: true,
  intervalMs: 60_000,
  platforms: [],
  bufferStock: 0,
  oversellProtection: true,
  maxQuantityPerChannel: null,
};

// =============================================================================
// Helpers
// =============================================================================

/** Load the persisted daemon config or return defaults. */
function loadDaemonConfig(db: Database): SyncDaemonConfig {
  const rows = db.query<{ config: string }>(
    "SELECT config FROM sync_daemon_config WHERE id = 'default'",
  );
  if (rows.length === 0) {
    return { ...DEFAULT_DAEMON_CONFIG };
  }
  try {
    return { ...DEFAULT_DAEMON_CONFIG, ...JSON.parse(rows[0].config) } as SyncDaemonConfig;
  } catch {
    return { ...DEFAULT_DAEMON_CONFIG };
  }
}

/** Persist daemon config to the database. */
function saveDaemonConfig(db: Database, config: SyncDaemonConfig): void {
  const now = Date.now();
  const json = JSON.stringify(config);

  const existing = db.query<{ id: string }>(
    "SELECT id FROM sync_daemon_config WHERE id = 'default'",
  );

  if (existing.length > 0) {
    db.run(
      "UPDATE sync_daemon_config SET config = ?, enabled = ? WHERE id = 'default'",
      [json, config.enabled ? 1 : 0],
    );
  } else {
    db.run(
      'INSERT INTO sync_daemon_config (id, config, enabled, total_syncs, created_at) VALUES (?, ?, ?, 0, ?)',
      ['default', json, config.enabled ? 1 : 0, now],
    );
  }
}

/** Record a sync event in the audit log. */
function logSyncEvent(
  db: Database,
  sku: string,
  eventType: SyncEventType,
  platform: string,
  quantityChange: number,
  previousQuantity: number,
  newQuantity: number,
  details?: string,
): SyncEvent {
  const id = generateId('sev');
  const now = Date.now();

  db.run(
    `INSERT INTO sync_events (id, sku, event_type, platform, quantity_change, previous_quantity, new_quantity, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, sku, eventType, platform, quantityChange, previousQuantity, newQuantity, details ?? null, now],
  );

  return {
    id,
    sku,
    eventType,
    platform,
    quantityChange,
    previousQuantity,
    newQuantity,
    details: details ?? null,
    createdAt: now,
  };
}

/** Get all channel entries for a mapping ID. */
function getEntriesForMapping(db: Database, mappingId: string): ChannelEntry[] {
  const rows = db.query<{
    id: string;
    platform: string;
    listing_id: string;
    platform_sku: string | null;
    quantity: number;
    last_pushed_quantity: number;
    last_push_at: number | null;
  }>(
    'SELECT id, platform, listing_id, platform_sku, quantity, last_pushed_quantity, last_push_at FROM channel_entries WHERE mapping_id = ?',
    [mappingId],
  );

  return rows.map((row) => ({
    id: row.id,
    platform: row.platform,
    listingId: row.listing_id,
    platformSku: row.platform_sku,
    quantity: row.quantity,
    lastPushedQuantity: row.last_pushed_quantity ?? 0,
    lastPushAt: row.last_push_at,
  }));
}

/** Build a full ChannelMapping from a DB row + entries, computing availableQuantity with daemon config buffer. */
function buildMapping(
  row: {
    id: string;
    sku: string;
    product_id: string | null;
    total_quantity: number;
    reserved_quantity: number;
    sync_enabled: number;
    last_sync_at: number | null;
    created_at: number;
  },
  entries: ChannelEntry[],
  bufferStock: number = 0,
): ChannelMapping {
  const available = Math.max(0, row.total_quantity - row.reserved_quantity - bufferStock);
  return {
    id: row.id,
    sku: row.sku,
    productId: row.product_id,
    channels: entries,
    totalQuantity: row.total_quantity,
    reservedQuantity: row.reserved_quantity,
    availableQuantity: available,
    syncEnabled: row.sync_enabled === 1,
    lastSyncAt: row.last_sync_at,
    createdAt: row.created_at,
  };
}

// =============================================================================
// Channel Mapping CRUD
// =============================================================================

/**
 * Create a channel mapping for a SKU.
 * Links one inventory pool (by SKU) that can be distributed to multiple platforms.
 */
export function createChannelMapping(
  db: Database,
  sku: string,
  productId?: string,
  totalQuantity?: number,
): ChannelMapping {
  if (!sku || typeof sku !== 'string') {
    throw new Error('sku is required');
  }

  // Check for duplicate SKU
  const existing = db.query<{ id: string }>(
    'SELECT id FROM channel_mappings WHERE sku = ?',
    [sku],
  );
  if (existing.length > 0) {
    throw new Error(`Channel mapping already exists for SKU: ${sku}`);
  }

  const id = generateId('cmap');
  const now = Date.now();
  const qty = Number.isFinite(totalQuantity) ? totalQuantity! : 0;

  db.run(
    `INSERT INTO channel_mappings (id, sku, product_id, total_quantity, reserved_quantity, sync_enabled, created_at)
     VALUES (?, ?, ?, ?, 0, 1, ?)`,
    [id, sku, productId ?? null, qty, now],
  );

  logger.info({ id, sku, totalQuantity: qty }, 'Channel mapping created');

  return {
    id,
    sku,
    productId: productId ?? null,
    channels: [],
    totalQuantity: qty,
    reservedQuantity: 0,
    availableQuantity: qty,
    syncEnabled: true,
    lastSyncAt: null,
    createdAt: now,
  };
}

/**
 * Link a platform listing to a SKU's channel mapping.
 */
export function addChannelEntry(
  db: Database,
  sku: string,
  platform: string,
  listingId: string,
  platformSku?: string,
): ChannelEntry {
  if (!sku) throw new Error('sku is required');
  if (!platform) throw new Error('platform is required');
  if (!listingId) throw new Error('listingId is required');

  // Find mapping
  const mappings = db.query<{ id: string }>(
    'SELECT id FROM channel_mappings WHERE sku = ?',
    [sku],
  );
  if (mappings.length === 0) {
    throw new Error(`No channel mapping found for SKU: ${sku}`);
  }
  const mappingId = mappings[0].id;

  // Check for duplicate
  const dup = db.query<{ id: string }>(
    'SELECT id FROM channel_entries WHERE platform = ? AND listing_id = ?',
    [platform, listingId],
  );
  if (dup.length > 0) {
    throw new Error(`Channel entry already exists for ${platform}/${listingId}`);
  }

  const id = generateId('cent');

  db.run(
    `INSERT INTO channel_entries (id, mapping_id, platform, listing_id, platform_sku, quantity, last_pushed_quantity)
     VALUES (?, ?, ?, ?, ?, 0, 0)`,
    [id, mappingId, platform, listingId, platformSku ?? null],
  );

  logger.info({ id, sku, platform, listingId }, 'Channel entry added');

  return {
    id,
    platform,
    listingId,
    platformSku: platformSku ?? null,
    quantity: 0,
    lastPushedQuantity: 0,
    lastPushAt: null,
  };
}

/**
 * Remove (unlink) a platform listing from its channel mapping.
 */
export function removeChannelEntry(
  db: Database,
  platform: string,
  listingId: string,
): boolean {
  if (!platform) throw new Error('platform is required');
  if (!listingId) throw new Error('listingId is required');

  const rows = db.query<{ id: string; mapping_id: string }>(
    'SELECT id, mapping_id FROM channel_entries WHERE platform = ? AND listing_id = ?',
    [platform, listingId],
  );

  if (rows.length === 0) {
    logger.warn({ platform, listingId }, 'Channel entry not found');
    return false;
  }

  db.run(
    'DELETE FROM channel_entries WHERE platform = ? AND listing_id = ?',
    [platform, listingId],
  );

  logger.info({ platform, listingId }, 'Channel entry removed');
  return true;
}

/**
 * Get a channel mapping by SKU, including all linked channel entries.
 */
export function getChannelMapping(db: Database, sku: string): ChannelMapping | null {
  const rows = db.query<{
    id: string;
    sku: string;
    product_id: string | null;
    total_quantity: number;
    reserved_quantity: number;
    sync_enabled: number;
    last_sync_at: number | null;
    created_at: number;
  }>(
    'SELECT id, sku, product_id, total_quantity, reserved_quantity, sync_enabled, last_sync_at, created_at FROM channel_mappings WHERE sku = ?',
    [sku],
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  const entries = getEntriesForMapping(db, row.id);
  const config = loadDaemonConfig(db);

  return buildMapping(row, entries, config.bufferStock);
}

/**
 * List all channel mappings, optionally filtered.
 */
export function getAllChannelMappings(
  db: Database,
  opts?: { syncEnabledOnly?: boolean; limit?: number; offset?: number },
): ChannelMapping[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.syncEnabledOnly) {
    conditions.push('sync_enabled = 1');
  }

  let sql = 'SELECT id, sku, product_id, total_quantity, reserved_quantity, sync_enabled, last_sync_at, created_at FROM channel_mappings';
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  sql += ' ORDER BY created_at DESC';

  if (Number.isFinite(opts?.limit)) {
    sql += ` LIMIT ${Math.max(1, opts!.limit!)}`;
  }
  if (Number.isFinite(opts?.offset)) {
    sql += ` OFFSET ${Math.max(0, opts!.offset!)}`;
  }

  const rows = db.query<{
    id: string;
    sku: string;
    product_id: string | null;
    total_quantity: number;
    reserved_quantity: number;
    sync_enabled: number;
    last_sync_at: number | null;
    created_at: number;
  }>(sql, params);

  const config = loadDaemonConfig(db);

  return rows.map((row) => {
    const entries = getEntriesForMapping(db, row.id);
    return buildMapping(row, entries, config.bufferStock);
  });
}

// =============================================================================
// Inventory Adjustments
// =============================================================================

/**
 * Adjust total inventory quantity for a SKU. Positive = restock, negative = sale/shrinkage.
 * Logs a sync event and recalculates available quantity.
 */
export function updateInventory(
  db: Database,
  sku: string,
  quantityChange: number,
  reason: string,
  platform?: string,
): ChannelMapping {
  if (!Number.isFinite(quantityChange)) {
    throw new Error('quantityChange must be a finite number');
  }

  const mapping = getChannelMapping(db, sku);
  if (!mapping) {
    throw new Error(`No channel mapping found for SKU: ${sku}`);
  }

  const previousQty = mapping.totalQuantity;
  const newQty = Math.max(0, previousQty + quantityChange);

  // Update mapping
  db.run(
    'UPDATE channel_mappings SET total_quantity = ? WHERE sku = ?',
    [newQty, sku],
  );

  // Determine event type from the direction
  let eventType: SyncEventType = 'adjustment';
  if (quantityChange < 0) {
    eventType = 'sale';
  } else if (quantityChange > 0) {
    eventType = 'restock';
  }

  logSyncEvent(
    db,
    sku,
    eventType,
    platform ?? 'system',
    quantityChange,
    previousQty,
    newQty,
    reason,
  );

  logger.info(
    { sku, quantityChange, previousQty, newQty, reason, platform },
    'Inventory updated',
  );

  // Return refreshed mapping
  return getChannelMapping(db, sku)!;
}

/**
 * Convenience: record a sale (negative adjustment) for a SKU on a given platform.
 */
export function recordSale(
  db: Database,
  sku: string,
  platform: string,
  quantity: number,
): ChannelMapping {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('quantity must be a positive number');
  }
  return updateInventory(db, sku, -quantity, `Sale of ${quantity} units`, platform);
}

/**
 * Convenience: record a restock (positive adjustment) for a SKU.
 */
export function recordRestock(
  db: Database,
  sku: string,
  quantity: number,
): ChannelMapping {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('quantity must be a positive number');
  }
  return updateInventory(db, sku, quantity, `Restock of ${quantity} units`, 'warehouse');
}

// =============================================================================
// Sync to Channels
// =============================================================================

/**
 * Distribute available inventory across all linked channels for a SKU.
 *
 * Distribution logic:
 *   1. Compute available = total - reserved - bufferStock
 *   2. If oversellProtection is on and available <= 0, push 0 to all channels
 *   3. Distribute evenly across channels (floor division + remainder to first channels)
 *   4. Cap each channel at maxQuantityPerChannel if configured
 *   5. Call pushFn for each channel; track success/failure
 *   6. Log sync_push events for each push
 *
 * @param pushFn Callback to push quantity to a platform listing. Return true on success.
 */
export function syncToChannels(
  db: Database,
  sku: string,
  pushFn: PushFn,
  config?: Partial<SyncDaemonConfig>,
): SyncToChannelsResult {
  const daemonConfig = { ...loadDaemonConfig(db), ...config };
  const mapping = getChannelMapping(db, sku);

  if (!mapping) {
    throw new Error(`No channel mapping found for SKU: ${sku}`);
  }

  const channels = mapping.channels;
  if (channels.length === 0) {
    logger.debug({ sku }, 'No channels to sync');
    return { synced: 0, failed: 0, channels: [] };
  }

  // Filter channels by platform if config specifies platforms
  const activeChannels = daemonConfig.platforms.length > 0
    ? channels.filter((ch) => daemonConfig.platforms.includes(ch.platform))
    : channels;

  if (activeChannels.length === 0) {
    logger.debug({ sku, configuredPlatforms: daemonConfig.platforms }, 'No matching channels for configured platforms');
    return { synced: 0, failed: 0, channels: [] };
  }

  // Calculate available with buffer
  const available = Math.max(
    0,
    mapping.totalQuantity - mapping.reservedQuantity - daemonConfig.bufferStock,
  );

  // Oversell protection: if nothing available, push 0 to all
  const effectiveAvailable = daemonConfig.oversellProtection && available <= 0 ? 0 : available;

  // Distribute evenly
  const channelCount = activeChannels.length;
  const perChannel = Math.floor(effectiveAvailable / channelCount);
  let remainder = effectiveAvailable - perChannel * channelCount;

  const results: SyncToChannelsResult['channels'] = [];
  let synced = 0;
  let failed = 0;
  const now = Date.now();

  for (const channel of activeChannels) {
    // Give remainder units to first channels (round-robin)
    let qty = perChannel + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder--;

    // Apply per-channel cap
    if (daemonConfig.maxQuantityPerChannel !== null && Number.isFinite(daemonConfig.maxQuantityPerChannel)) {
      qty = Math.min(qty, daemonConfig.maxQuantityPerChannel!);
    }

    // Skip push if quantity hasn't changed
    if (qty === channel.lastPushedQuantity) {
      results.push({
        platform: channel.platform,
        listingId: channel.listingId,
        quantity: qty,
        success: true,
      });
      synced++;
      continue;
    }

    let success = false;
    try {
      success = pushFn(channel.platform, channel.listingId, qty);
    } catch (err) {
      logger.error(
        { err, sku, platform: channel.platform, listingId: channel.listingId },
        'Push function threw an error',
      );

      logSyncEvent(
        db,
        sku,
        'error',
        channel.platform,
        0,
        channel.lastPushedQuantity,
        channel.lastPushedQuantity,
        `Push error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (success) {
      // Update channel entry
      db.run(
        'UPDATE channel_entries SET quantity = ?, last_pushed_quantity = ?, last_push_at = ? WHERE id = ?',
        [qty, qty, now, channel.id],
      );

      logSyncEvent(
        db,
        sku,
        'sync_push',
        channel.platform,
        qty - channel.lastPushedQuantity,
        channel.lastPushedQuantity,
        qty,
        `Pushed ${qty} units to ${channel.platform}/${channel.listingId}`,
      );

      synced++;
    } else {
      failed++;
    }

    results.push({
      platform: channel.platform,
      listingId: channel.listingId,
      quantity: qty,
      success,
    });
  }

  // Update mapping last_sync_at
  db.run(
    'UPDATE channel_mappings SET last_sync_at = ? WHERE sku = ?',
    [now, sku],
  );

  logger.info({ sku, synced, failed, available: effectiveAvailable }, 'Sync to channels complete');

  return { synced, failed, channels: results };
}

// =============================================================================
// Sync Cycle (one full pass)
// =============================================================================

/**
 * Run a single sync cycle: iterate all enabled mappings where quantity may have
 * changed since the last push, and sync each to its channels.
 */
export function runSyncCycle(
  db: Database,
  pushFn: PushFn,
  config?: Partial<SyncDaemonConfig>,
): SyncCycleResult {
  const daemonConfig = { ...loadDaemonConfig(db), ...config };

  // Get all enabled mappings
  const mappings = getAllChannelMappings(db, { syncEnabledOnly: true });

  let mappingsChecked = 0;
  let mappingsSynced = 0;
  let totalPushes = 0;

  for (const mapping of mappings) {
    mappingsChecked++;

    // Check if any channel's last_pushed_quantity differs from what we'd push
    const available = Math.max(
      0,
      mapping.totalQuantity - mapping.reservedQuantity - daemonConfig.bufferStock,
    );

    const channelCount = mapping.channels.length;
    if (channelCount === 0) continue;

    // Quick check: does any channel need updating?
    const perChannel = Math.floor(available / channelCount);
    const needsSync = mapping.channels.some((ch) => {
      let expectedQty = perChannel;
      if (daemonConfig.maxQuantityPerChannel !== null && Number.isFinite(daemonConfig.maxQuantityPerChannel)) {
        expectedQty = Math.min(expectedQty, daemonConfig.maxQuantityPerChannel!);
      }
      return ch.lastPushedQuantity !== expectedQty;
    });

    if (!needsSync) continue;

    try {
      const result = syncToChannels(db, mapping.sku, pushFn, daemonConfig);
      mappingsSynced++;
      totalPushes += result.synced + result.failed;
    } catch (err) {
      logger.error({ err, sku: mapping.sku }, 'Failed to sync mapping in cycle');
    }
  }

  // Update daemon stats
  db.run(
    "UPDATE sync_daemon_config SET last_run_at = ?, total_syncs = total_syncs + 1 WHERE id = 'default'",
    [Date.now()],
  );

  logger.info(
    { mappingsChecked, mappingsSynced, totalPushes },
    'Sync cycle complete',
  );

  return { mappingsChecked, mappingsSynced, totalPushes };
}

// =============================================================================
// Sync Daemon (background loop)
// =============================================================================

/** Module-level singleton handle for the running sync daemon. */
let syncDaemon: { stop: () => void } | null = null;

/**
 * Start the background sync daemon. Runs sync cycles at the configured interval.
 * Returns a handle with a `stop()` method.
 */
export function startSyncDaemon(
  db: Database,
  pushFn: PushFn,
  config?: Partial<SyncDaemonConfig>,
): { stop: () => void } {
  if (syncDaemon) {
    logger.warn('Sync daemon already running, stopping previous instance');
    syncDaemon.stop();
  }

  const merged = { ...loadDaemonConfig(db), ...config };

  // Persist the config
  saveDaemonConfig(db, merged);

  const intervalMs = Math.max(merged.intervalMs, 5_000); // Min 5s safety
  let stopped = false;

  // Run first cycle immediately
  try {
    runSyncCycle(db, pushFn, merged);
  } catch (err) {
    logger.error({ err }, 'Initial sync cycle failed');
  }

  const timer = setInterval(() => {
    if (stopped) return;
    try {
      runSyncCycle(db, pushFn, merged);
    } catch (err) {
      logger.error({ err }, 'Sync daemon cycle error');
    }
  }, intervalMs);

  logger.info({ intervalMs, platforms: merged.platforms, bufferStock: merged.bufferStock }, 'Sync daemon started');

  const handle = {
    stop() {
      stopped = true;
      clearInterval(timer);
      syncDaemon = null;
      logger.info('Sync daemon stopped');
    },
  };

  syncDaemon = handle;
  return handle;
}

/**
 * Stop the running sync daemon (if any).
 */
export function stopSyncDaemon(): boolean {
  if (!syncDaemon) {
    logger.info('No sync daemon running');
    return false;
  }
  syncDaemon.stop();
  return true;
}

/**
 * Check whether the sync daemon is currently running.
 */
export function isSyncDaemonRunning(): boolean {
  return syncDaemon !== null;
}

// =============================================================================
// Event Log Queries
// =============================================================================

/**
 * Query the sync event audit log with optional filters.
 */
export function getSyncEvents(
  db: Database,
  opts?: { sku?: string; eventType?: SyncEventType; days?: number; limit?: number },
): SyncEvent[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts?.sku) {
    conditions.push('sku = ?');
    params.push(opts.sku);
  }

  if (opts?.eventType) {
    conditions.push('event_type = ?');
    params.push(opts.eventType);
  }

  if (Number.isFinite(opts?.days)) {
    const cutoff = Date.now() - opts!.days! * 24 * 60 * 60 * 1000;
    conditions.push('created_at >= ?');
    params.push(cutoff);
  }

  let sql = 'SELECT id, sku, event_type, platform, quantity_change, previous_quantity, new_quantity, details, created_at FROM sync_events';
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  sql += ' ORDER BY created_at DESC';

  const limit = Number.isFinite(opts?.limit) ? Math.max(1, opts!.limit!) : 200;
  sql += ` LIMIT ${limit}`;

  const rows = db.query<{
    id: string;
    sku: string;
    event_type: string;
    platform: string;
    quantity_change: number;
    previous_quantity: number;
    new_quantity: number;
    details: string | null;
    created_at: number;
  }>(sql, params);

  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    eventType: row.event_type as SyncEventType,
    platform: row.platform,
    quantityChange: row.quantity_change,
    previousQuantity: row.previous_quantity,
    newQuantity: row.new_quantity,
    details: row.details,
    createdAt: row.created_at,
  }));
}

/**
 * Get aggregate sync statistics over a time window.
 */
export function getSyncStats(db: Database, days?: number): SyncStats {
  const daysBack = Number.isFinite(days) ? days! : 30;
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  // Total counts by event type
  const typeCounts = db.query<{ event_type: string; cnt: number }>(
    `SELECT event_type, COUNT(*) as cnt FROM sync_events
     WHERE created_at >= ?
     GROUP BY event_type`,
    [cutoff],
  );

  const countMap = new Map<string, number>();
  for (const row of typeCounts) {
    countMap.set(row.event_type, row.cnt);
  }

  // Oversell incidents: error events containing 'oversell' (case-insensitive)
  const oversellRows = db.query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM sync_events
     WHERE created_at >= ? AND event_type = 'error' AND LOWER(details) LIKE '%oversell%'`,
    [cutoff],
  );
  const oversellIncidents = oversellRows[0]?.cnt ?? 0;

  // Total syncs from daemon config
  const daemonRows = db.query<{ total_syncs: number }>(
    "SELECT total_syncs FROM sync_daemon_config WHERE id = 'default'",
  );
  const totalSyncs = daemonRows[0]?.total_syncs ?? 0;

  // Events by day
  const dailyRows = db.query<{ day: string; cnt: number }>(
    `SELECT DATE(created_at / 1000, 'unixepoch') as day, COUNT(*) as cnt
     FROM sync_events
     WHERE created_at >= ?
     GROUP BY day
     ORDER BY day DESC`,
    [cutoff],
  );

  return {
    totalSyncs,
    totalSales: countMap.get('sale') ?? 0,
    totalRestocks: countMap.get('restock') ?? 0,
    totalErrors: countMap.get('error') ?? 0,
    oversellIncidents,
    eventsByDay: dailyRows.map((r) => ({ date: r.day, count: r.cnt })),
  };
}

/**
 * Get or update the stored daemon configuration.
 */
export function getDaemonConfig(db: Database): SyncDaemonConfig {
  return loadDaemonConfig(db);
}

export function updateDaemonConfig(
  db: Database,
  updates: Partial<SyncDaemonConfig>,
): SyncDaemonConfig {
  const current = loadDaemonConfig(db);
  const merged = { ...current, ...updates };
  saveDaemonConfig(db, merged);
  return merged;
}
