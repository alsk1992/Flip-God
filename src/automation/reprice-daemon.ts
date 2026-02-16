/**
 * Smart Repricing Daemon
 *
 * Autonomous loop that runs configurable repricing strategies on active listings.
 *
 * Features:
 *   - Multiple named daemon configs (each with its own interval, strategies, filters)
 *   - Per-listing cooldown to prevent over-repricing
 *   - Max % change per cycle safety rail
 *   - Global price floor/ceiling
 *   - Full reprice history with aggregate stats
 *   - Pluggable repriceFn for strategy execution
 */

import { createLogger } from '../utils/logger.js';
import { generateId } from '../utils/id.js';
import type { Database } from '../db/index.js';

const logger = createLogger('reprice-daemon');

// =============================================================================
// Types
// =============================================================================

export interface RepriceDaemonConfig {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  strategies: string[];
  minPrice: number | null;
  maxPrice: number | null;
  maxChangePerCyclePct: number;
  cooldownMs: number;
  platformFilter: string[];
  onlyActiveListings: boolean;
}

export interface RepriceDaemonRecord {
  id: string;
  name: string;
  config: RepriceDaemonConfig;
  enabled: boolean;
  lastRunAt: number | null;
  totalCycles: number;
  totalReprices: number;
  createdAt: number;
}

export interface RepriceHistoryEntry {
  id: string;
  daemonConfigId: string | null;
  listingId: string;
  oldPrice: number;
  newPrice: number;
  changePct: number;
  strategy: string;
  reason: string | null;
  platform: string | null;
  createdAt: number;
}

export interface RepriceCycleResult {
  checked: number;
  repriced: number;
  skipped: number;
  errors: number;
}

export interface RepriceResult {
  newPrice: number | null;
  reason: string;
  strategy: string;
}

export type RepriceFn = (
  listing: Record<string, unknown>,
  strategy: string,
) => RepriceResult;

export interface RepriceHistoryFilter {
  listingId?: string;
  startDate?: number;
  endDate?: number;
  strategy?: string;
  daemonConfigId?: string;
  limit?: number;
  offset?: number;
}

export interface RepriceStats {
  totalReprices: number;
  avgChangePct: number;
  avgAbsChangePct: number;
  byStrategy: Array<{
    strategy: string;
    count: number;
    avgChangePct: number;
  }>;
  byDay: Array<{
    day: string;
    count: number;
    avgChangePct: number;
  }>;
}

export interface RepriceSummary {
  repricesToday: number;
  repricesThisPeriod: number;
  avgMarginChange: number;
  topMovers: Array<{
    listingId: string;
    totalChangePct: number;
    repriceCount: number;
  }>;
}

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_CONFIG: RepriceDaemonConfig = {
  enabled: true,
  intervalMs: 300_000,
  batchSize: 50,
  strategies: ['competitive'],
  minPrice: null,
  maxPrice: null,
  maxChangePerCyclePct: 5,
  cooldownMs: 1_800_000,
  platformFilter: [],
  onlyActiveListings: true,
};

// =============================================================================
// Helpers
// =============================================================================

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseConfigJson(raw: string): RepriceDaemonConfig {
  try {
    const parsed = JSON.parse(raw);
    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_CONFIG.enabled,
      intervalMs: Number.isFinite(parsed.intervalMs) ? parsed.intervalMs : DEFAULT_CONFIG.intervalMs,
      batchSize: Number.isFinite(parsed.batchSize) ? parsed.batchSize : DEFAULT_CONFIG.batchSize,
      strategies: Array.isArray(parsed.strategies) ? parsed.strategies : DEFAULT_CONFIG.strategies,
      minPrice: Number.isFinite(parsed.minPrice) ? parsed.minPrice : null,
      maxPrice: Number.isFinite(parsed.maxPrice) ? parsed.maxPrice : null,
      maxChangePerCyclePct: Number.isFinite(parsed.maxChangePerCyclePct)
        ? parsed.maxChangePerCyclePct
        : DEFAULT_CONFIG.maxChangePerCyclePct,
      cooldownMs: Number.isFinite(parsed.cooldownMs) ? parsed.cooldownMs : DEFAULT_CONFIG.cooldownMs,
      platformFilter: Array.isArray(parsed.platformFilter) ? parsed.platformFilter : [],
      onlyActiveListings:
        typeof parsed.onlyActiveListings === 'boolean'
          ? parsed.onlyActiveListings
          : DEFAULT_CONFIG.onlyActiveListings,
    };
  } catch (err) {
    logger.warn({ err }, 'Corrupted daemon config JSON, using defaults');
    return { ...DEFAULT_CONFIG };
  }
}

function parseRow(row: Record<string, unknown>): RepriceDaemonRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    config: parseConfigJson(row.config as string),
    enabled: Boolean(row.enabled),
    lastRunAt: (row.last_run_at as number | null) ?? null,
    totalCycles: (row.total_cycles as number) ?? 0,
    totalReprices: (row.total_reprices as number) ?? 0,
    createdAt: (row.created_at as number) ?? Date.now(),
  };
}

function parseHistoryRow(row: Record<string, unknown>): RepriceHistoryEntry {
  return {
    id: row.id as string,
    daemonConfigId: (row.daemon_config_id as string | null) ?? null,
    listingId: row.listing_id as string,
    oldPrice: row.old_price as number,
    newPrice: row.new_price as number,
    changePct: row.change_pct as number,
    strategy: row.strategy as string,
    reason: (row.reason as string | null) ?? null,
    platform: (row.platform as string | null) ?? null,
    createdAt: (row.created_at as number) ?? Date.now(),
  };
}

// =============================================================================
// CRUD Operations
// =============================================================================

/**
 * Create a new repricing daemon configuration.
 */
export function createRepriceDaemonConfig(
  db: Database,
  name: string,
  config: Partial<RepriceDaemonConfig> = {},
): RepriceDaemonRecord {
  if (!name || typeof name !== 'string') {
    throw new Error('name is required');
  }

  const merged: RepriceDaemonConfig = {
    ...DEFAULT_CONFIG,
    ...config,
  };

  const id = generateId('rpd');
  const now = Date.now();

  db.run(
    `INSERT INTO reprice_daemon_config (id, name, config, enabled, last_run_at, total_cycles, total_reprices, created_at)
     VALUES (?, ?, ?, ?, NULL, 0, 0, ?)`,
    [id, name, JSON.stringify(merged), merged.enabled ? 1 : 0, now],
  );

  logger.info({ id, name, strategies: merged.strategies }, 'Reprice daemon config created');

  return {
    id,
    name,
    config: merged,
    enabled: merged.enabled,
    lastRunAt: null,
    totalCycles: 0,
    totalReprices: 0,
    createdAt: now,
  };
}

/**
 * Update an existing repricing daemon configuration.
 */
export function updateRepriceDaemonConfig(
  db: Database,
  id: string,
  updates: Partial<RepriceDaemonConfig> & { name?: string; enabled?: boolean },
): RepriceDaemonRecord | null {
  if (!id) throw new Error('id is required');

  const rows = db.query<Record<string, unknown>>(
    'SELECT * FROM reprice_daemon_config WHERE id = ?',
    [id],
  );
  if (rows.length === 0) return null;

  const existing = parseRow(rows[0]);

  // Merge config updates — strip non-config fields before spreading
  const { name: _n, enabled: _e, ...configUpdates } = updates;
  const newConfig: RepriceDaemonConfig = {
    ...existing.config,
    ...configUpdates,
  };

  const newName = updates.name ?? existing.name;
  const newEnabled = typeof updates.enabled === 'boolean' ? updates.enabled : existing.enabled;

  db.run(
    'UPDATE reprice_daemon_config SET name = ?, config = ?, enabled = ? WHERE id = ?',
    [newName, JSON.stringify(newConfig), newEnabled ? 1 : 0, id],
  );

  logger.info({ id, name: newName }, 'Reprice daemon config updated');

  return {
    ...existing,
    name: newName,
    config: newConfig,
    enabled: newEnabled,
  };
}

/**
 * List all repricing daemon configurations.
 */
export function getRepriceDaemonConfigs(db: Database): RepriceDaemonRecord[] {
  const rows = db.query<Record<string, unknown>>(
    'SELECT * FROM reprice_daemon_config ORDER BY created_at DESC',
  );
  return rows.map(parseRow);
}

/**
 * Get a single repricing daemon configuration by ID.
 */
export function getRepriceDaemonConfigById(
  db: Database,
  id: string,
): RepriceDaemonRecord | null {
  const rows = db.query<Record<string, unknown>>(
    'SELECT * FROM reprice_daemon_config WHERE id = ?',
    [id],
  );
  if (rows.length === 0) return null;
  return parseRow(rows[0]);
}

/**
 * Soft-delete a repricing daemon configuration (disable it).
 */
export function deleteRepriceDaemonConfig(db: Database, id: string): boolean {
  if (!id) return false;

  const rows = db.query<Record<string, unknown>>(
    'SELECT * FROM reprice_daemon_config WHERE id = ?',
    [id],
  );
  if (rows.length === 0) return false;

  db.run('UPDATE reprice_daemon_config SET enabled = 0 WHERE id = ?', [id]);
  logger.info({ id }, 'Reprice daemon config soft-deleted (disabled)');
  return true;
}

// =============================================================================
// Cycle Execution
// =============================================================================

/**
 * Run a single repricing cycle for a given daemon config.
 *
 * Queries eligible listings (active, not in cooldown, matching platform filter),
 * calls repriceFn for each, and applies valid price changes.
 */
export function runRepriceCycle(
  db: Database,
  record: RepriceDaemonRecord,
  repriceFn: RepriceFn,
): RepriceCycleResult {
  const config = record.config;
  const now = Date.now();
  const result: RepriceCycleResult = { checked: 0, repriced: 0, skipped: 0, errors: 0 };

  // Build listing query
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (config.onlyActiveListings) {
    conditions.push("l.status = 'active'");
  }

  if (config.platformFilter.length > 0) {
    const placeholders = config.platformFilter.map(() => '?').join(', ');
    conditions.push(`l.platform IN (${placeholders})`);
    params.push(...config.platformFilter);
  }

  // Cooldown: exclude listings that were repriced recently
  const cooldownCutoff = now - config.cooldownMs;
  conditions.push(`
    l.id NOT IN (
      SELECT DISTINCT rh.listing_id FROM reprice_history rh
      WHERE rh.daemon_config_id = ? AND rh.created_at > ?
    )
  `);
  params.push(record.id, cooldownCutoff);

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const listings = db.query<Record<string, unknown>>(
    `SELECT l.* FROM listings l ${whereClause} LIMIT ?`,
    [...params, config.batchSize],
  );

  for (const listing of listings) {
    result.checked++;

    const currentPrice = listing.price as number;
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      result.skipped++;
      continue;
    }

    // Try each strategy in order; use first one that triggers a change
    let applied = false;

    for (const strategy of config.strategies) {
      try {
        const repriceResult = repriceFn(listing, strategy);

        if (repriceResult.newPrice === null) {
          continue;
        }

        if (!Number.isFinite(repriceResult.newPrice) || repriceResult.newPrice <= 0) {
          logger.warn(
            { listingId: listing.id, strategy, newPrice: repriceResult.newPrice },
            'repriceFn returned invalid price, skipping',
          );
          continue;
        }

        let newPrice = repriceResult.newPrice;

        // Apply global floor/ceiling
        if (config.minPrice !== null && Number.isFinite(config.minPrice) && newPrice < config.minPrice) {
          newPrice = config.minPrice;
        }
        if (config.maxPrice !== null && Number.isFinite(config.maxPrice) && newPrice > config.maxPrice) {
          newPrice = config.maxPrice;
        }

        newPrice = round2(newPrice);

        // Check max change per cycle
        const changePct = ((newPrice - currentPrice) / currentPrice) * 100;
        const absChangePct = Math.abs(changePct);

        if (absChangePct > config.maxChangePerCyclePct) {
          // Clamp to max allowed change
          const direction = newPrice > currentPrice ? 1 : -1;
          newPrice = round2(currentPrice * (1 + (direction * config.maxChangePerCyclePct) / 100));
        }

        // Skip if price didn't actually change
        if (Math.abs(newPrice - currentPrice) < 0.005) {
          continue;
        }

        const finalChangePct = round2(((newPrice - currentPrice) / currentPrice) * 100);

        // Apply the price change to the listing
        db.run('UPDATE listings SET price = ?, updated_at = ? WHERE id = ?', [
          newPrice,
          now,
          listing.id as string,
        ]);

        // Log to reprice_history
        const historyId = generateId('rph');
        db.run(
          `INSERT INTO reprice_history
           (id, daemon_config_id, listing_id, old_price, new_price, change_pct, strategy, reason, platform, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            historyId,
            record.id,
            listing.id as string,
            currentPrice,
            newPrice,
            finalChangePct,
            repriceResult.strategy,
            repriceResult.reason,
            (listing.platform as string) ?? null,
            now,
          ],
        );

        result.repriced++;
        applied = true;

        logger.debug(
          {
            listingId: listing.id,
            strategy: repriceResult.strategy,
            oldPrice: currentPrice,
            newPrice,
            changePct: finalChangePct,
          },
          'Listing repriced',
        );

        break; // Use first matching strategy
      } catch (err) {
        result.errors++;
        logger.error(
          { err, listingId: listing.id, strategy },
          'Error running repriceFn for listing',
        );
      }
    }

    if (!applied) {
      result.skipped++;
    }
  }

  // Update daemon config stats
  db.run(
    `UPDATE reprice_daemon_config
     SET last_run_at = ?, total_cycles = total_cycles + 1, total_reprices = total_reprices + ?
     WHERE id = ?`,
    [now, result.repriced, record.id],
  );

  logger.info(
    { configId: record.id, name: record.name, ...result },
    'Reprice cycle complete',
  );

  return result;
}

// =============================================================================
// Daemon Lifecycle
// =============================================================================

/** Module-level singleton handle for the running daemon. */
let daemon: { stop: () => void } | null = null;

/**
 * Start the repricing daemon. Loads all enabled configs and runs cycles
 * on their configured intervals.
 *
 * Returns a handle with a `stop()` method to shut down the daemon.
 */
export function startRepriceDaemon(
  db: Database,
  repriceFn: RepriceFn,
  opts?: { onCycleComplete?: (configId: string, result: RepriceCycleResult) => void },
): { stop: () => void } {
  if (daemon) {
    logger.warn('Reprice daemon already running, stopping previous instance');
    daemon.stop();
  }

  const timers = new Map<string, ReturnType<typeof setInterval>>();
  let stopped = false;

  function scheduleConfig(record: RepriceDaemonRecord): void {
    if (stopped) return;
    if (timers.has(record.id)) return;

    const intervalMs = Math.max(record.config.intervalMs, 10_000); // Min 10s safety

    const timer = setInterval(() => {
      if (stopped) return;

      try {
        // Re-fetch config in case it was updated
        const fresh = getRepriceDaemonConfigById(db, record.id);
        if (!fresh || !fresh.enabled) {
          const existingTimer = timers.get(record.id);
          if (existingTimer) {
            clearInterval(existingTimer);
            timers.delete(record.id);
          }
          return;
        }

        const result = runRepriceCycle(db, fresh, repriceFn);
        opts?.onCycleComplete?.(record.id, result);
      } catch (err) {
        logger.error({ err, configId: record.id }, 'Reprice daemon cycle error');
      }
    }, intervalMs);

    timers.set(record.id, timer);

    // Run first cycle immediately
    try {
      runRepriceCycle(db, record, repriceFn);
    } catch (err) {
      logger.error({ err, configId: record.id }, 'Initial reprice cycle failed');
    }

    logger.info(
      { configId: record.id, name: record.name, intervalMs },
      'Scheduled reprice daemon config',
    );
  }

  // Load and schedule all enabled configs
  const configs = getRepriceDaemonConfigs(db).filter((c) => c.enabled);
  for (const config of configs) {
    scheduleConfig(config);
  }

  logger.info({ configCount: configs.length }, 'Reprice daemon started');

  const handle = {
    stop() {
      stopped = true;
      for (const [id, timer] of timers) {
        clearInterval(timer);
        logger.debug({ configId: id }, 'Cleared reprice timer');
      }
      timers.clear();
      daemon = null;
      logger.info('Reprice daemon stopped');
    },
  };

  daemon = handle;
  return handle;
}

/**
 * Stop the running repricing daemon (if any).
 */
export function stopRepriceDaemon(): boolean {
  if (!daemon) {
    logger.info('No reprice daemon running');
    return false;
  }
  daemon.stop();
  return true;
}

/**
 * Check whether the daemon is currently running.
 */
export function isDaemonRunning(): boolean {
  return daemon !== null;
}

// =============================================================================
// History & Stats
// =============================================================================

/**
 * Query reprice history with optional filters.
 */
export function getRepriceHistory(
  db: Database,
  opts?: RepriceHistoryFilter,
): RepriceHistoryEntry[] {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (opts?.listingId) {
    conditions.push('listing_id = ?');
    params.push(opts.listingId);
  }

  if (opts?.daemonConfigId) {
    conditions.push('daemon_config_id = ?');
    params.push(opts.daemonConfigId);
  }

  if (opts?.strategy) {
    conditions.push('strategy = ?');
    params.push(opts.strategy);
  }

  if (opts?.startDate !== undefined && Number.isFinite(opts.startDate)) {
    conditions.push('created_at >= ?');
    params.push(opts.startDate);
  }

  if (opts?.endDate !== undefined && Number.isFinite(opts.endDate)) {
    conditions.push('created_at <= ?');
    params.push(opts.endDate);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Number.isFinite(opts?.limit) ? opts!.limit! : 100;
  const offset = Number.isFinite(opts?.offset) ? opts!.offset! : 0;

  const rows = db.query<Record<string, unknown>>(
    `SELECT * FROM reprice_history ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows.map(parseHistoryRow);
}

/**
 * Aggregate repricing stats for a config (or all configs) over a time window.
 */
export function getRepriceStats(
  db: Database,
  configId?: string,
  days: number = 30,
): RepriceStats {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const configFilter = configId ? 'AND daemon_config_id = ?' : '';
  const baseParams: Array<string | number> = configId ? [cutoff, configId] : [cutoff];

  // Total & averages
  const totals = db.query<{
    total: number;
    avg_change: number;
    avg_abs_change: number;
  }>(
    `SELECT
       COUNT(*) as total,
       COALESCE(AVG(change_pct), 0) as avg_change,
       COALESCE(AVG(ABS(change_pct)), 0) as avg_abs_change
     FROM reprice_history
     WHERE created_at >= ? ${configFilter}`,
    baseParams,
  );

  const totalRow = totals[0] ?? { total: 0, avg_change: 0, avg_abs_change: 0 };

  // By strategy
  const byStrategyRows = db.query<{
    strategy: string;
    cnt: number;
    avg_change: number;
  }>(
    `SELECT strategy, COUNT(*) as cnt, AVG(change_pct) as avg_change
     FROM reprice_history
     WHERE created_at >= ? ${configFilter}
     GROUP BY strategy
     ORDER BY cnt DESC`,
    baseParams,
  );

  // By day
  const byDayRows = db.query<{
    day: string;
    cnt: number;
    avg_change: number;
  }>(
    `SELECT
       date(created_at / 1000, 'unixepoch') as day,
       COUNT(*) as cnt,
       AVG(change_pct) as avg_change
     FROM reprice_history
     WHERE created_at >= ? ${configFilter}
     GROUP BY day
     ORDER BY day DESC`,
    baseParams,
  );

  return {
    totalReprices: totalRow.total,
    avgChangePct: round2(totalRow.avg_change),
    avgAbsChangePct: round2(totalRow.avg_abs_change),
    byStrategy: byStrategyRows.map((r) => ({
      strategy: r.strategy,
      count: r.cnt,
      avgChangePct: round2(r.avg_change),
    })),
    byDay: byDayRows.map((r) => ({
      day: r.day,
      count: r.cnt,
      avgChangePct: round2(r.avg_change),
    })),
  };
}

/**
 * Dashboard summary data: reprices today, avg margin change, top movers.
 */
export function getRepriceSummary(
  db: Database,
  days: number = 7,
): RepriceSummary {
  const now = Date.now();
  const todayCutoff = now - 24 * 60 * 60 * 1000;
  const periodCutoff = now - days * 24 * 60 * 60 * 1000;

  // Today's reprices
  const todayRows = db.query<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM reprice_history WHERE created_at >= ?',
    [todayCutoff],
  );
  const repricesToday = todayRows[0]?.cnt ?? 0;

  // Period reprices
  const periodRows = db.query<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM reprice_history WHERE created_at >= ?',
    [periodCutoff],
  );
  const repricesThisPeriod = periodRows[0]?.cnt ?? 0;

  // Avg margin change over period
  const avgRows = db.query<{ avg_change: number }>(
    'SELECT COALESCE(AVG(change_pct), 0) as avg_change FROM reprice_history WHERE created_at >= ?',
    [periodCutoff],
  );
  const avgMarginChange = round2(avgRows[0]?.avg_change ?? 0);

  // Top movers (most repriced listings in the period)
  const moverRows = db.query<{
    listing_id: string;
    total_change: number;
    cnt: number;
  }>(
    `SELECT
       listing_id,
       SUM(change_pct) as total_change,
       COUNT(*) as cnt
     FROM reprice_history
     WHERE created_at >= ?
     GROUP BY listing_id
     ORDER BY cnt DESC
     LIMIT 10`,
    [periodCutoff],
  );

  return {
    repricesToday,
    repricesThisPeriod,
    avgMarginChange,
    topMovers: moverRows.map((r) => ({
      listingId: r.listing_id,
      totalChangePct: round2(r.total_change),
      repriceCount: r.cnt,
    })),
  };
}
