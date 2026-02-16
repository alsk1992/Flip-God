/**
 * Auto-Scout Pipeline - Autonomous daemon that continuously scans source
 * platforms for arbitrage opportunities, scores them, and queues them for
 * review or auto-listing.
 *
 * Tables: scout_configs, scout_queue (migration 026)
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';

const logger = createLogger('auto-scout');

// =============================================================================
// Types
// =============================================================================

/** Configuration for a single scout profile. */
export interface ScoutConfig {
  /** Whether this scout is active. */
  enabled: boolean;
  /** Scan frequency in milliseconds (default 15 min = 900_000). */
  intervalMs: number;
  /** Source platforms to scan (default: all known). */
  platforms: string[];
  /** Product categories to focus on. */
  categories: string[];
  /** Minimum profit margin percentage to qualify (default 20). */
  minMarginPct: number;
  /** Maximum source price in USD (default 100). */
  maxSourcePrice: number;
  /** Minimum source price in USD (default 5). */
  minSourcePrice: number;
  /** Max results to fetch per platform per keyword (default 50). */
  maxResults: number;
  /** Automatically create listings for qualifying items, or queue for review. */
  autoList: boolean;
  /** Target selling platform (default 'ebay'). */
  targetPlatform: string;
  /** Search terms to rotate through per scan. */
  keywords: string[];
  /** Brands to exclude (IP/legal risk). */
  excludeBrands: string[];
  /** Categories to exclude. */
  excludeCategories: string[];
}

/** A persisted scout config row. */
export interface ScoutConfigRow {
  id: string;
  name: string;
  config: ScoutConfig;
  enabled: boolean;
  lastRunAt: number | null;
  totalRuns: number;
  totalOpportunitiesFound: number;
  createdAt: number;
}

/** A single product returned by a platform scan function. */
export interface ScannedProduct {
  productId?: string;
  name: string;
  price: number;
  url?: string;
  imageUrl?: string;
  category?: string;
  platform: string;
  brand?: string;
}

/** Type signature for the platform scan callback. */
export type ScanFn = (
  platform: string,
  keyword: string,
  maxResults: number,
) => Promise<ScannedProduct[]>;

/** A queued opportunity row. */
export interface ScoutQueueItem {
  id: string;
  scoutConfigId: string;
  productId: string | null;
  sourcePlatform: string;
  targetPlatform: string;
  sourcePrice: number;
  targetPrice: number | null;
  estimatedMarginPct: number | null;
  estimatedProfit: number | null;
  productName: string | null;
  productUrl: string | null;
  imageUrl: string | null;
  category: string | null;
  status: string;
  reviewedAt: number | null;
  listedAt: number | null;
  listingId: string | null;
  createdAt: number;
}

/** Summary returned after a single scan cycle. */
export interface ScanSummary {
  scanned: number;
  qualified: number;
  queued: number;
  skipped: number;
}

/** Options for filtering the queue. */
export interface QueueFilterOptions {
  status?: string;
  configId?: string;
  limit?: number;
  offset?: number;
}

/** Aggregate stats for scout reporting. */
export interface ScoutStats {
  totalScanned: number;
  totalQueued: number;
  totalApproved: number;
  totalListed: number;
  totalRejected: number;
  totalExpired: number;
  byDay: Array<{
    day: string;
    queued: number;
    approved: number;
    listed: number;
  }>;
}

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_CONFIG: ScoutConfig = {
  enabled: true,
  intervalMs: 900_000, // 15 min
  platforms: [],
  categories: [],
  minMarginPct: 20,
  maxSourcePrice: 100,
  minSourcePrice: 5,
  maxResults: 50,
  autoList: false,
  targetPlatform: 'ebay',
  keywords: [],
  excludeBrands: [],
  excludeCategories: [],
};

// =============================================================================
// DB helpers (raw row shapes)
// =============================================================================

interface ScoutConfigDbRow {
  id: string;
  name: string;
  config: string;
  enabled: number;
  last_run_at: number | null;
  total_runs: number;
  total_opportunities_found: number;
  created_at: number;
}

interface ScoutQueueDbRow {
  id: string;
  scout_config_id: string;
  product_id: string | null;
  source_platform: string;
  target_platform: string;
  source_price: number;
  target_price: number | null;
  estimated_margin_pct: number | null;
  estimated_profit: number | null;
  product_name: string | null;
  product_url: string | null;
  image_url: string | null;
  category: string | null;
  status: string;
  reviewed_at: number | null;
  listed_at: number | null;
  listing_id: string | null;
  created_at: number;
}

function rowToConfig(row: ScoutConfigDbRow): ScoutConfigRow {
  let config: ScoutConfig;
  try {
    config = { ...DEFAULT_CONFIG, ...JSON.parse(row.config) };
  } catch {
    config = { ...DEFAULT_CONFIG };
  }
  return {
    id: row.id,
    name: row.name,
    config,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    totalRuns: row.total_runs,
    totalOpportunitiesFound: row.total_opportunities_found,
    createdAt: row.created_at,
  };
}

function rowToQueueItem(row: ScoutQueueDbRow): ScoutQueueItem {
  return {
    id: row.id,
    scoutConfigId: row.scout_config_id,
    productId: row.product_id,
    sourcePlatform: row.source_platform,
    targetPlatform: row.target_platform,
    sourcePrice: row.source_price,
    targetPrice: row.target_price,
    estimatedMarginPct: row.estimated_margin_pct,
    estimatedProfit: row.estimated_profit,
    productName: row.product_name,
    productUrl: row.product_url,
    imageUrl: row.image_url,
    category: row.category,
    status: row.status,
    reviewedAt: row.reviewed_at,
    listedAt: row.listed_at,
    listingId: row.listing_id,
    createdAt: row.created_at,
  };
}

// =============================================================================
// CRUD — Scout Configs
// =============================================================================

/** Create a new scout config. Returns the created row. */
export function createScoutConfig(
  db: Database,
  name: string,
  config: Partial<ScoutConfig>,
): ScoutConfigRow {
  const id = randomUUID();
  const now = Date.now();
  const merged: ScoutConfig = { ...DEFAULT_CONFIG, ...config };

  db.run(
    `INSERT INTO scout_configs (id, name, config, enabled, last_run_at, total_runs, total_opportunities_found, created_at)
     VALUES (?, ?, ?, ?, NULL, 0, 0, ?)`,
    [id, name, JSON.stringify(merged), merged.enabled ? 1 : 0, now],
  );

  logger.info({ id, name }, 'Scout config created');
  return {
    id,
    name,
    config: merged,
    enabled: merged.enabled,
    lastRunAt: null,
    totalRuns: 0,
    totalOpportunitiesFound: 0,
    createdAt: now,
  };
}

/** Update an existing scout config (partial update). */
export function updateScoutConfig(
  db: Database,
  id: string,
  updates: Partial<ScoutConfig> & { name?: string },
): ScoutConfigRow | null {
  const existing = getScoutConfig(db, id);
  if (!existing) return null;

  const { name, ...configUpdates } = updates;
  const merged: ScoutConfig = { ...existing.config, ...configUpdates };
  const newName = name ?? existing.name;

  db.run(
    `UPDATE scout_configs SET name = ?, config = ?, enabled = ? WHERE id = ?`,
    [newName, JSON.stringify(merged), merged.enabled ? 1 : 0, id],
  );

  logger.info({ id }, 'Scout config updated');
  return { ...existing, name: newName, config: merged, enabled: merged.enabled };
}

/** List all scout configs. */
export function getScoutConfigs(db: Database): ScoutConfigRow[] {
  const rows = db.query<ScoutConfigDbRow>('SELECT * FROM scout_configs ORDER BY created_at DESC');
  return rows.map(rowToConfig);
}

/** Get a single scout config by ID. */
export function getScoutConfig(db: Database, id: string): ScoutConfigRow | null {
  const rows = db.query<ScoutConfigDbRow>('SELECT * FROM scout_configs WHERE id = ?', [id]);
  return rows.length > 0 ? rowToConfig(rows[0]) : null;
}

/** Soft-delete a scout config (sets enabled = 0). */
export function deleteScoutConfig(db: Database, id: string): boolean {
  const existing = getScoutConfig(db, id);
  if (!existing) return false;

  db.run('UPDATE scout_configs SET enabled = 0 WHERE id = ?', [id]);
  logger.info({ id }, 'Scout config disabled (soft-deleted)');
  return true;
}

// =============================================================================
// CRUD — Scout Queue
// =============================================================================

/** Retrieve queued opportunities with optional filters. */
export function getScoutQueue(db: Database, options?: QueueFilterOptions): ScoutQueueItem[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.status) {
    conditions.push('status = ?');
    params.push(options.status);
  }
  if (options?.configId) {
    conditions.push('scout_config_id = ?');
    params.push(options.configId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit && Number.isFinite(options.limit) ? options.limit : 100;
  const offset = options?.offset && Number.isFinite(options.offset) ? options.offset : 0;

  const rows = db.query<ScoutQueueDbRow>(
    `SELECT * FROM scout_queue ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map(rowToQueueItem);
}

/** Approve a queued item for listing. */
export function approveScoutItem(db: Database, itemId: string): boolean {
  const rows = db.query<ScoutQueueDbRow>(
    'SELECT * FROM scout_queue WHERE id = ? AND status = ?',
    [itemId, 'pending'],
  );
  if (rows.length === 0) return false;

  db.run('UPDATE scout_queue SET status = ?, reviewed_at = ? WHERE id = ?', [
    'approved',
    Date.now(),
    itemId,
  ]);
  logger.info({ itemId }, 'Scout queue item approved');
  return true;
}

/** Reject a queued item. */
export function rejectScoutItem(db: Database, itemId: string): boolean {
  const rows = db.query<ScoutQueueDbRow>(
    'SELECT * FROM scout_queue WHERE id = ? AND status = ?',
    [itemId, 'pending'],
  );
  if (rows.length === 0) return false;

  db.run('UPDATE scout_queue SET status = ?, reviewed_at = ? WHERE id = ?', [
    'rejected',
    Date.now(),
    itemId,
  ]);
  logger.info({ itemId }, 'Scout queue item rejected');
  return true;
}

/** Mark old pending items as expired. */
export function expireStaleItems(db: Database, maxAgeDays: number): number {
  if (!Number.isFinite(maxAgeDays) || maxAgeDays <= 0) return 0;

  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  // Count how many will be expired
  const rows = db.query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM scout_queue WHERE status = 'pending' AND created_at < ?`,
    [cutoff],
  );
  const count = rows[0]?.cnt ?? 0;

  if (count > 0) {
    db.run(
      `UPDATE scout_queue SET status = 'expired', reviewed_at = ? WHERE status = 'pending' AND created_at < ?`,
      [Date.now(), cutoff],
    );
    logger.info({ count, maxAgeDays }, 'Expired stale scout queue items');
  }

  return count;
}

// =============================================================================
// Scan Execution
// =============================================================================

/**
 * Estimate a target sell price for a product based on a simple markup model.
 * In production this would call a real pricing API or compare against the
 * target platform's recent sold data. For now we use a configurable margin
 * multiplier as a floor estimate.
 */
function estimateTargetPrice(sourcePrice: number, minMarginPct: number): number {
  // Assume ~15% platform fees on sell side as a conservative baseline
  const feeRate = 0.15;
  // Target price that yields at least minMarginPct after fees
  // profit = sellPrice * (1 - feeRate) - sourcePrice
  // profit / sourcePrice >= minMarginPct / 100
  // sellPrice >= sourcePrice * (1 + minMarginPct / 100) / (1 - feeRate)
  return sourcePrice * (1 + minMarginPct / 100) / (1 - feeRate);
}

/**
 * Run ONE scan cycle for a given scout config.
 *
 * Iterates over each keyword x platform combination, calls the user-provided
 * `scanFn` to fetch products, filters them against the config thresholds,
 * and inserts qualifying items into the scout_queue.
 */
export async function runScoutScan(
  db: Database,
  configRow: ScoutConfigRow,
  scanFn: ScanFn,
): Promise<ScanSummary> {
  const cfg = configRow.config;
  const platforms = cfg.platforms.length > 0 ? cfg.platforms : ['amazon', 'walmart', 'target'];
  const keywords = cfg.keywords.length > 0 ? cfg.keywords : ['clearance'];

  let scanned = 0;
  let qualified = 0;
  let queued = 0;
  let skipped = 0;

  const excludeBrandsLower = new Set(cfg.excludeBrands.map((b) => b.toLowerCase()));
  const excludeCategoriesLower = new Set(cfg.excludeCategories.map((c) => c.toLowerCase()));

  for (const platform of platforms) {
    for (const keyword of keywords) {
      let products: ScannedProduct[];
      try {
        products = await scanFn(platform, keyword, cfg.maxResults);
      } catch (err) {
        logger.warn({ platform, keyword, err }, 'Scan function failed for platform/keyword');
        continue;
      }

      for (const product of products) {
        scanned++;

        // Price range filter
        if (!Number.isFinite(product.price) || product.price < cfg.minSourcePrice || product.price > cfg.maxSourcePrice) {
          skipped++;
          continue;
        }

        // Brand exclusion
        if (product.brand && excludeBrandsLower.has(product.brand.toLowerCase())) {
          skipped++;
          continue;
        }

        // Category exclusion
        if (product.category && excludeCategoriesLower.has(product.category.toLowerCase())) {
          skipped++;
          continue;
        }

        // Estimate target price and margin
        const targetPrice = estimateTargetPrice(product.price, cfg.minMarginPct);
        const feeRate = 0.15;
        const estimatedProfit = targetPrice * (1 - feeRate) - product.price;
        const estimatedMarginPct = (estimatedProfit / product.price) * 100;

        // Margin threshold
        if (estimatedMarginPct < cfg.minMarginPct) {
          skipped++;
          continue;
        }

        qualified++;

        // Check for duplicates: same product URL + source platform + config already pending
        if (product.url) {
          const existing = db.query<{ id: string }>(
            `SELECT id FROM scout_queue
             WHERE product_url = ? AND source_platform = ? AND scout_config_id = ? AND status = 'pending'`,
            [product.url, platform, configRow.id],
          );
          if (existing.length > 0) {
            skipped++;
            continue;
          }
        }

        // Insert into queue
        const itemId = randomUUID();
        const status = cfg.autoList ? 'approved' : 'pending';
        db.run(
          `INSERT INTO scout_queue
           (id, scout_config_id, product_id, source_platform, target_platform,
            source_price, target_price, estimated_margin_pct, estimated_profit,
            product_name, product_url, image_url, category, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            itemId,
            configRow.id,
            product.productId ?? null,
            platform,
            cfg.targetPlatform,
            product.price,
            targetPrice,
            Math.round(estimatedMarginPct * 100) / 100,
            Math.round(estimatedProfit * 100) / 100,
            product.name ?? null,
            product.url ?? null,
            product.imageUrl ?? null,
            product.category ?? null,
            status,
            Date.now(),
          ],
        );
        queued++;
      }
    }
  }

  // Update config counters
  db.run(
    `UPDATE scout_configs
     SET last_run_at = ?, total_runs = total_runs + 1, total_opportunities_found = total_opportunities_found + ?
     WHERE id = ?`,
    [Date.now(), queued, configRow.id],
  );

  logger.info(
    { configId: configRow.id, name: configRow.name, scanned, qualified, queued, skipped },
    'Scout scan cycle complete',
  );

  return { scanned, qualified, queued, skipped };
}

// =============================================================================
// Daemon Lifecycle
// =============================================================================

export interface DaemonHandle {
  /** Stop the daemon loop and clean up all intervals. */
  stop: () => void;
}

interface DaemonOptions {
  /** Override the scan interval for all configs (ms). If unset, uses each config's own interval. */
  intervalOverrideMs?: number;
}

/**
 * Start the scout daemon. Loads all enabled configs and starts an interval
 * timer for each one. Returns a handle with a `stop()` method.
 */
export function startScoutDaemon(
  db: Database,
  scanFn: ScanFn,
  opts?: DaemonOptions,
): DaemonHandle {
  const timers: ReturnType<typeof setInterval>[] = [];
  const configs = getScoutConfigs(db).filter((c) => c.enabled);

  if (configs.length === 0) {
    logger.warn('No enabled scout configs found — daemon started but idle');
    return { stop: () => {} };
  }

  logger.info({ count: configs.length }, 'Starting scout daemon');

  for (const configRow of configs) {
    const intervalMs = opts?.intervalOverrideMs ?? configRow.config.intervalMs;
    const safeInterval = Number.isFinite(intervalMs) && intervalMs >= 10_000
      ? intervalMs
      : 900_000;

    // Run first scan immediately, then on interval
    const runCycle = async () => {
      try {
        // Re-read config in case it was updated between cycles
        const fresh = getScoutConfig(db, configRow.id);
        if (!fresh || !fresh.enabled) {
          logger.info({ configId: configRow.id }, 'Config disabled, skipping cycle');
          return;
        }
        await runScoutScan(db, fresh, scanFn);
      } catch (err) {
        logger.error({ configId: configRow.id, err }, 'Scout scan cycle failed');
      }
    };

    // Fire-and-forget the initial scan
    void runCycle();

    const timer = setInterval(() => {
      void runCycle();
    }, safeInterval);

    // Prevent the timer from keeping the process alive if it's the last ref
    if (typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }

    timers.push(timer);
    logger.info(
      { configId: configRow.id, name: configRow.name, intervalMs: safeInterval },
      'Scout timer started',
    );
  }

  return {
    stop() {
      for (const t of timers) {
        clearInterval(t);
      }
      timers.length = 0;
      logger.info('Scout daemon stopped');
    },
  };
}

// =============================================================================
// Stats / Reporting
// =============================================================================

/** Get aggregate statistics for the scout system (optionally filtered to one config). */
export function getScoutStats(db: Database, configId?: string): ScoutStats {
  const configFilter = configId ? ' WHERE scout_config_id = ?' : '';
  const configParams: unknown[] = configId ? [configId] : [];

  // Overall counts by status
  const countRows = db.query<{ status: string; cnt: number }>(
    `SELECT status, COUNT(*) as cnt FROM scout_queue${configFilter} GROUP BY status`,
    configParams,
  );

  const counts: Record<string, number> = {};
  for (const row of countRows) {
    counts[row.status] = row.cnt;
  }

  // Total scanned comes from config counters
  let totalScanned = 0;
  if (configId) {
    const cfg = getScoutConfig(db, configId);
    totalScanned = cfg?.totalOpportunitiesFound ?? 0;
  } else {
    const rows = db.query<{ total: number }>(
      'SELECT COALESCE(SUM(total_opportunities_found), 0) as total FROM scout_configs',
    );
    totalScanned = rows[0]?.total ?? 0;
  }

  // By-day breakdown (last 30 days)
  const byDayRows = db.query<{ day: string; status: string; cnt: number }>(
    `SELECT
       date(created_at / 1000, 'unixepoch') as day,
       status,
       COUNT(*) as cnt
     FROM scout_queue${configFilter}
     GROUP BY day, status
     ORDER BY day DESC
     LIMIT 300`,
    configParams,
  );

  // Aggregate by day
  const dayMap = new Map<string, { queued: number; approved: number; listed: number }>();
  for (const row of byDayRows) {
    let entry = dayMap.get(row.day);
    if (!entry) {
      entry = { queued: 0, approved: 0, listed: 0 };
      dayMap.set(row.day, entry);
    }
    if (row.status === 'pending' || row.status === 'approved' || row.status === 'rejected' || row.status === 'expired') {
      entry.queued += row.cnt;
    }
    if (row.status === 'approved') {
      entry.approved += row.cnt;
    }
    if (row.status === 'listed') {
      entry.listed += row.cnt;
    }
  }

  const byDay = Array.from(dayMap.entries())
    .map(([day, data]) => ({ day, ...data }))
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 30);

  return {
    totalScanned,
    totalQueued: (counts['pending'] ?? 0) + (counts['approved'] ?? 0) + (counts['listed'] ?? 0) + (counts['rejected'] ?? 0) + (counts['expired'] ?? 0),
    totalApproved: counts['approved'] ?? 0,
    totalListed: counts['listed'] ?? 0,
    totalRejected: counts['rejected'] ?? 0,
    totalExpired: counts['expired'] ?? 0,
    byDay,
  };
}
