/**
 * Job Queue Worker - Processes bulk operation jobs for FlipAgent
 *
 * Handles each job type:
 * - bulk_list: Create listings for an array of products
 * - bulk_reprice: Reprice an array of listings
 * - bulk_scan: Scan multiple platforms for a query
 * - bulk_inventory_sync: Sync inventory across platforms
 * - bulk_import: Import products from wholesale CSV
 *
 * Features:
 * - Configurable per-item concurrency (default 3)
 * - Per-item retry (up to 3 attempts)
 * - Progress reporting to the job queue
 * - Error collection per item
 */

import { createLogger } from '../utils/logger';
import type { Job, JobQueue, JobError } from './job-queue';
import type { Database } from '../db';

const logger = createLogger('job-worker');

// =============================================================================
// TYPES
// =============================================================================

export interface WorkerConfig {
  /** Max concurrent items to process within a single job. Default: 3 */
  itemConcurrency: number;
  /** Max retry attempts per item. Default: 3 */
  maxRetries: number;
  /** Delay between retries in ms. Default: 1000 */
  retryDelayMs: number;
}

export interface WorkerDeps {
  db: Database;
  queue: JobQueue;
}

// =============================================================================
// HELPERS
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Process an array of items with limited concurrency.
 * Reports progress back to the job queue after each item completes.
 */
async function processItemsConcurrently<T>(
  items: T[],
  job: Job,
  queue: JobQueue,
  concurrency: number,
  maxRetries: number,
  retryDelayMs: number,
  processFn: (item: T, index: number) => Promise<void>,
): Promise<{ completedItems: number; failedItems: number; errors: JobError[] }> {
  let completedItems = 0;
  let failedItems = 0;
  const errors: JobError[] = [];
  let nextIndex = 0;

  async function processOne(): Promise<void> {
    while (nextIndex < items.length) {
      // Check if job was cancelled
      const current = queue.getJob(job.id);
      if (current && current.status === 'cancelled') {
        return;
      }

      const idx = nextIndex++;
      const item = items[idx];
      let succeeded = false;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await processFn(item, idx);
          succeeded = true;
          break;
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          if (attempt < maxRetries) {
            logger.debug(
              { jobId: job.id, itemIndex: idx, attempt, error: errMsg },
              'Item failed, retrying',
            );
            await sleep(retryDelayMs * attempt);
          } else {
            logger.warn(
              { jobId: job.id, itemIndex: idx, error: errMsg },
              'Item failed after max retries',
            );
            errors.push({
              item: typeof item === 'object' && item !== null
                ? JSON.stringify(item).slice(0, 200)
                : String(idx),
              error: errMsg,
            });
          }
        }
      }

      if (succeeded) {
        completedItems++;
      } else {
        failedItems++;
      }

      // Report progress
      queue.updateProgress(job.id, completedItems, failedItems, errors);
    }
  }

  // Launch concurrent workers
  const workers: Promise<void>[] = [];
  const effectiveConcurrency = Math.min(concurrency, items.length);
  for (let i = 0; i < effectiveConcurrency; i++) {
    workers.push(processOne());
  }

  await Promise.all(workers);

  return { completedItems, failedItems, errors };
}

// =============================================================================
// JOB HANDLERS
// =============================================================================

async function handleBulkList(
  job: Job,
  deps: WorkerDeps,
  config: WorkerConfig,
): Promise<Record<string, unknown>> {
  const items = (job.payload.items as Array<Record<string, unknown>>) ?? [];
  if (items.length === 0) {
    return { message: 'No items to list' };
  }

  const results: Array<{ index: number; status: string; listingId?: string; error?: string }> = [];

  const { completedItems, failedItems, errors } = await processItemsConcurrently(
    items,
    job,
    deps.queue,
    config.itemConcurrency,
    config.maxRetries,
    config.retryDelayMs,
    async (item, index) => {
      // In a real implementation, this would call createListing on the platform adapter.
      // For now we log it and store in the listings table if possible.
      const productId = (item.productId as string) ?? `product_${index}`;
      const platform = (item.platform as string) ?? 'ebay';
      const price = (item.price as number) ?? 0;
      const title = (item.title as string) ?? `Item ${index}`;

      if (price <= 0) {
        throw new Error('Price must be positive');
      }

      logger.debug({ jobId: job.id, productId, platform, price }, 'Listing item');

      results.push({ index, status: 'created', listingId: productId });
    },
  );

  return {
    totalProcessed: completedItems + failedItems,
    created: completedItems,
    failed: failedItems,
    errors: errors.length > 0 ? errors : undefined,
    results,
  };
}

async function handleBulkReprice(
  job: Job,
  deps: WorkerDeps,
  config: WorkerConfig,
): Promise<Record<string, unknown>> {
  const items = (job.payload.items as Array<Record<string, unknown>>) ?? [];
  if (items.length === 0) {
    return { message: 'No items to reprice' };
  }

  const results: Array<{ listingId: string; oldPrice: number; newPrice: number; status: string }> = [];

  const { completedItems, failedItems, errors } = await processItemsConcurrently(
    items,
    job,
    deps.queue,
    config.itemConcurrency,
    config.maxRetries,
    config.retryDelayMs,
    async (item, _index) => {
      const listingId = item.listingId as string;
      const newPrice = item.newPrice as number;
      const oldPrice = item.oldPrice as number | undefined;

      if (!listingId || newPrice == null || newPrice <= 0) {
        throw new Error('Invalid reprice item: missing listingId or valid newPrice');
      }

      logger.debug({ jobId: job.id, listingId, newPrice }, 'Repricing item');

      results.push({
        listingId,
        oldPrice: oldPrice ?? 0,
        newPrice,
        status: 'repriced',
      });
    },
  );

  return {
    totalProcessed: completedItems + failedItems,
    repriced: completedItems,
    failed: failedItems,
    errors: errors.length > 0 ? errors : undefined,
    results,
  };
}

async function handleBulkScan(
  job: Job,
  deps: WorkerDeps,
  config: WorkerConfig,
): Promise<Record<string, unknown>> {
  const queries = (job.payload.queries as string[]) ?? [];
  const platforms = (job.payload.platforms as string[]) ?? ['amazon', 'ebay', 'walmart'];

  if (queries.length === 0) {
    return { message: 'No queries to scan' };
  }

  const scanResults: Array<{ query: string; platform: string; resultCount: number }> = [];

  const { completedItems, failedItems, errors } = await processItemsConcurrently(
    queries,
    job,
    deps.queue,
    config.itemConcurrency,
    config.maxRetries,
    config.retryDelayMs,
    async (query, _index) => {
      for (const platform of platforms) {
        logger.debug({ jobId: job.id, query, platform }, 'Scanning platform');
        // In a real implementation, this would call the platform adapter's search method
        scanResults.push({ query, platform, resultCount: 0 });
      }
    },
  );

  return {
    totalQueries: completedItems + failedItems,
    scanned: completedItems,
    failed: failedItems,
    errors: errors.length > 0 ? errors : undefined,
    results: scanResults,
  };
}

async function handleBulkInventorySync(
  job: Job,
  deps: WorkerDeps,
  config: WorkerConfig,
): Promise<Record<string, unknown>> {
  const listingIds = (job.payload.listingIds as string[]) ?? [];

  if (listingIds.length === 0) {
    return { message: 'No listings to sync' };
  }

  let synced = 0;
  let outOfStock = 0;

  const { completedItems, failedItems, errors } = await processItemsConcurrently(
    listingIds,
    job,
    deps.queue,
    config.itemConcurrency,
    config.maxRetries,
    config.retryDelayMs,
    async (listingId, _index) => {
      logger.debug({ jobId: job.id, listingId }, 'Syncing inventory for listing');
      // In a real implementation, check source platform stock and update listing status
      synced++;
    },
  );

  return {
    totalChecked: completedItems + failedItems,
    synced,
    outOfStock,
    failed: failedItems,
    errors: errors.length > 0 ? errors : undefined,
  };
}

async function handleBulkImport(
  job: Job,
  deps: WorkerDeps,
  config: WorkerConfig,
): Promise<Record<string, unknown>> {
  const rows = (job.payload.rows as Array<Record<string, unknown>>) ?? [];

  if (rows.length === 0) {
    return { message: 'No rows to import' };
  }

  let imported = 0;

  const { completedItems, failedItems, errors } = await processItemsConcurrently(
    rows,
    job,
    deps.queue,
    config.itemConcurrency,
    config.maxRetries,
    config.retryDelayMs,
    async (row, _index) => {
      const title = (row.title as string) ?? (row.name as string);
      if (!title) {
        throw new Error('Missing title/name field');
      }

      logger.debug({ jobId: job.id, title }, 'Importing product');
      // In a real implementation, this would create a product in the DB
      // and optionally create listings on target platforms
      imported++;
    },
  );

  return {
    totalProcessed: completedItems + failedItems,
    imported,
    failed: failedItems,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// =============================================================================
// WORKER FACTORY
// =============================================================================

const DEFAULT_CONFIG: WorkerConfig = {
  itemConcurrency: 3,
  maxRetries: 3,
  retryDelayMs: 1000,
};

/**
 * Create a job processor function that can be passed to createJobQueue's onProcessJob callback.
 */
export function createJobWorker(
  deps: WorkerDeps,
  workerConfig?: Partial<WorkerConfig>,
): (job: Job) => Promise<void> {
  const config: WorkerConfig = {
    itemConcurrency: workerConfig?.itemConcurrency ?? DEFAULT_CONFIG.itemConcurrency,
    maxRetries: workerConfig?.maxRetries ?? DEFAULT_CONFIG.maxRetries,
    retryDelayMs: workerConfig?.retryDelayMs ?? DEFAULT_CONFIG.retryDelayMs,
  };

  return async (job: Job): Promise<void> => {
    logger.info({ jobId: job.id, type: job.type, totalItems: job.totalItems }, 'Processing job');

    let result: Record<string, unknown>;

    switch (job.type) {
      case 'bulk_list':
        result = await handleBulkList(job, deps, config);
        break;
      case 'bulk_reprice':
        result = await handleBulkReprice(job, deps, config);
        break;
      case 'bulk_scan':
        result = await handleBulkScan(job, deps, config);
        break;
      case 'bulk_inventory_sync':
        result = await handleBulkInventorySync(job, deps, config);
        break;
      case 'bulk_import':
        result = await handleBulkImport(job, deps, config);
        break;
      default:
        result = { error: `Unknown job type: ${job.type}` };
        break;
    }

    // Determine final status based on results
    const currentJob = deps.queue.getJob(job.id);
    if (currentJob && currentJob.status === 'cancelled') {
      // Job was cancelled during processing -- don't overwrite status
      return;
    }

    const hasFailed = (currentJob?.failedItems ?? 0) > 0 && (currentJob?.completedItems ?? 0) === 0;
    deps.queue.markFinished(job.id, hasFailed ? 'failed' : 'completed', result);
  };
}
