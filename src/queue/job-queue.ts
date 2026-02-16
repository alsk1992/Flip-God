/**
 * Job Queue - Persistent job queue for bulk operations in FlipAgent
 *
 * Features:
 * - In-memory queue backed by SQLite persistence (survives restart)
 * - Concurrency control (1 job at a time, configurable per-item parallelism)
 * - Progress tracking with real-time updates
 * - Per-item error collection without failing the whole job
 * - Supports: bulk_list, bulk_reprice, bulk_scan, bulk_inventory_sync, bulk_import
 */

import { createLogger } from '../utils/logger';
import { generateId } from '../utils/id';
import type { Database } from '../db';

const logger = createLogger('job-queue');

// =============================================================================
// TYPES
// =============================================================================

export type JobType =
  | 'bulk_list'
  | 'bulk_reprice'
  | 'bulk_scan'
  | 'bulk_inventory_sync'
  | 'bulk_import';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface JobError {
  item: string;
  error: string;
}

export interface Job {
  id: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  result?: Record<string, unknown>;
  progress: number; // 0-100
  totalItems: number;
  completedItems: number;
  failedItems: number;
  errors: JobError[];
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  userId: string;
}

export interface JobEnqueueInput {
  type: JobType;
  payload: Record<string, unknown>;
  totalItems: number;
  userId: string;
}

export interface JobQueue {
  /** Add a job to the queue. Returns the generated job ID. */
  enqueue(input: JobEnqueueInput): string;

  /** Get a specific job by ID. */
  getJob(jobId: string): Job | undefined;

  /** Get jobs for a user, optionally filtered by status. */
  getJobs(userId: string, status?: JobStatus): Job[];

  /** Cancel a pending or running job. Returns true if cancelled. */
  cancelJob(jobId: string): boolean;

  /** Update job progress (called by the worker). */
  updateProgress(jobId: string, completedItems: number, failedItems: number, errors: JobError[]): void;

  /** Mark a job as running. */
  markRunning(jobId: string): void;

  /** Mark a job as completed or failed. */
  markFinished(jobId: string, status: 'completed' | 'failed', result?: Record<string, unknown>): void;

  /** Get next pending job (FIFO). */
  getNextPending(): Job | undefined;

  /** Start the queue (begin processing). */
  start(): void;

  /** Stop the queue (stop processing, does not cancel running jobs). */
  stop(): void;

  /** Whether the queue is currently processing. */
  isRunning(): boolean;
}

// =============================================================================
// IMPLEMENTATION
// =============================================================================

export function createJobQueue(db: Database, onProcessJob?: (job: Job) => Promise<void>): JobQueue {
  let running = false;
  let processingJobId: string | null = null;
  let pollTimer: NodeJS.Timeout | null = null;
  const POLL_INTERVAL_MS = 2000;

  // In-memory cache of jobs for fast access
  const jobCache = new Map<string, Job>();

  // Load existing pending/running jobs from DB into cache on creation
  function loadFromDb(): void {
    try {
      const rows = db.query<Record<string, unknown>>(
        "SELECT * FROM jobs WHERE status IN ('pending', 'running') ORDER BY created_at ASC",
      );
      for (const row of rows) {
        const job = parseJobRow(row);
        jobCache.set(job.id, job);
      }
      // Reset any jobs that were 'running' (from a crash) back to 'pending'
      for (const job of jobCache.values()) {
        if (job.status === 'running') {
          job.status = 'pending';
          job.startedAt = undefined;
          persistJob(job);
          logger.warn({ jobId: job.id }, 'Reset crashed job to pending');
        }
      }
      logger.info({ loadedJobs: jobCache.size }, 'Loaded pending jobs from database');
    } catch (err) {
      // Table might not exist yet if migration hasn't run
      logger.debug({ err }, 'Could not load jobs from database (table may not exist yet)');
    }
  }

  function parseJobRow(row: Record<string, unknown>): Job {
    let errors: JobError[] = [];
    try {
      errors = JSON.parse((row.errors as string) || '[]');
    } catch {
      errors = [];
    }

    let result: Record<string, unknown> | undefined;
    try {
      result = row.result ? JSON.parse(row.result as string) : undefined;
    } catch {
      result = undefined;
    }

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse((row.payload as string) || '{}');
    } catch {
      payload = {};
    }

    return {
      id: row.id as string,
      type: row.type as JobType,
      status: row.status as JobStatus,
      payload,
      result,
      progress: (row.progress as number) ?? 0,
      totalItems: (row.total_items as number) ?? 0,
      completedItems: (row.completed_items as number) ?? 0,
      failedItems: (row.failed_items as number) ?? 0,
      errors,
      createdAt: row.created_at as number,
      startedAt: row.started_at as number | undefined,
      completedAt: row.completed_at as number | undefined,
      userId: row.user_id as string,
    };
  }

  function persistJob(job: Job): void {
    try {
      db.run(
        `INSERT INTO jobs (id, user_id, type, status, payload, result, progress, total_items, completed_items, failed_items, errors, created_at, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           result = excluded.result,
           progress = excluded.progress,
           completed_items = excluded.completed_items,
           failed_items = excluded.failed_items,
           errors = excluded.errors,
           started_at = excluded.started_at,
           completed_at = excluded.completed_at`,
        [
          job.id,
          job.userId,
          job.type,
          job.status,
          JSON.stringify(job.payload),
          job.result ? JSON.stringify(job.result) : null,
          job.progress,
          job.totalItems,
          job.completedItems,
          job.failedItems,
          JSON.stringify(job.errors),
          job.createdAt,
          job.startedAt ?? null,
          job.completedAt ?? null,
        ],
      );
    } catch (err) {
      logger.error({ err, jobId: job.id }, 'Failed to persist job to database');
    }
  }

  function processNext(): void {
    if (!running) return;
    if (processingJobId) return; // Already processing a job

    const next = queue.getNextPending();
    if (!next) return;

    if (onProcessJob) {
      processingJobId = next.id;
      queue.markRunning(next.id);

      const job = jobCache.get(next.id);
      if (!job) {
        processingJobId = null;
        return;
      }

      onProcessJob(job)
        .then(() => {
          // Worker should have called markFinished; if not, mark completed now
          const current = jobCache.get(next.id);
          if (current && current.status === 'running') {
            queue.markFinished(next.id, 'completed');
          }
        })
        .catch((err) => {
          logger.error({ err, jobId: next.id }, 'Job processing failed');
          queue.markFinished(next.id, 'failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => {
          processingJobId = null;
          // Try to process next job
          if (running) {
            // Use setImmediate to avoid stack overflow on large queues
            setImmediate(() => processNext());
          }
        });
    }
  }

  const queue: JobQueue = {
    enqueue(input: JobEnqueueInput): string {
      const id = generateId('job');
      const job: Job = {
        id,
        type: input.type,
        status: 'pending',
        payload: input.payload,
        progress: 0,
        totalItems: input.totalItems,
        completedItems: 0,
        failedItems: 0,
        errors: [],
        createdAt: Date.now(),
        userId: input.userId,
      };

      jobCache.set(id, job);
      persistJob(job);
      logger.info({ jobId: id, type: input.type, totalItems: input.totalItems, userId: input.userId }, 'Job enqueued');

      // Kick off processing if idle
      if (running && !processingJobId) {
        setImmediate(() => processNext());
      }

      return id;
    },

    getJob(jobId: string): Job | undefined {
      // Check cache first
      const cached = jobCache.get(jobId);
      if (cached) return cached;

      // Fall back to DB for completed/failed jobs not in cache
      try {
        const rows = db.query<Record<string, unknown>>(
          'SELECT * FROM jobs WHERE id = ?',
          [jobId],
        );
        if (rows.length === 0) return undefined;
        return parseJobRow(rows[0]);
      } catch {
        return undefined;
      }
    },

    getJobs(userId: string, status?: JobStatus): Job[] {
      try {
        const sql = status
          ? 'SELECT * FROM jobs WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 100'
          : 'SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100';
        const params = status ? [userId, status] : [userId];
        const rows = db.query<Record<string, unknown>>(sql, params);
        return rows.map(parseJobRow);
      } catch {
        // If table doesn't exist yet, return from cache
        return Array.from(jobCache.values())
          .filter((j) => j.userId === userId && (!status || j.status === status))
          .sort((a, b) => b.createdAt - a.createdAt);
      }
    },

    cancelJob(jobId: string): boolean {
      const job = jobCache.get(jobId);
      if (!job) return false;
      if (job.status !== 'pending' && job.status !== 'running') return false;

      job.status = 'cancelled';
      job.completedAt = Date.now();
      persistJob(job);

      if (processingJobId === jobId) {
        processingJobId = null;
      }

      logger.info({ jobId }, 'Job cancelled');
      return true;
    },

    updateProgress(jobId: string, completedItems: number, failedItems: number, errors: JobError[]): void {
      const job = jobCache.get(jobId);
      if (!job) return;

      job.completedItems = completedItems;
      job.failedItems = failedItems;
      job.errors = errors;
      job.progress = job.totalItems > 0
        ? Math.round(((completedItems + failedItems) / job.totalItems) * 100)
        : 0;

      persistJob(job);
    },

    markRunning(jobId: string): void {
      const job = jobCache.get(jobId);
      if (!job) return;

      job.status = 'running';
      job.startedAt = Date.now();
      persistJob(job);
      logger.info({ jobId }, 'Job started');
    },

    markFinished(jobId: string, status: 'completed' | 'failed', result?: Record<string, unknown>): void {
      const job = jobCache.get(jobId);
      if (!job) return;

      job.status = status;
      job.completedAt = Date.now();
      if (result) job.result = result;

      // Ensure progress is 100% on completion
      if (status === 'completed') {
        job.progress = 100;
      }

      persistJob(job);

      // Remove from in-memory cache after completion (DB has it)
      jobCache.delete(jobId);

      logger.info(
        { jobId, status, completedItems: job.completedItems, failedItems: job.failedItems },
        'Job finished',
      );
    },

    getNextPending(): Job | undefined {
      // Find oldest pending job
      let oldest: Job | undefined;
      for (const job of jobCache.values()) {
        if (job.status !== 'pending') continue;
        if (!oldest || job.createdAt < oldest.createdAt) {
          oldest = job;
        }
      }
      return oldest;
    },

    start(): void {
      if (running) return;
      running = true;

      // Load persisted jobs
      loadFromDb();

      // Start polling for new jobs
      pollTimer = setInterval(() => {
        if (!processingJobId) {
          processNext();
        }
      }, POLL_INTERVAL_MS);

      // Initial kick
      setImmediate(() => processNext());

      logger.info('Job queue started');
    },

    stop(): void {
      if (!running) return;
      running = false;

      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }

      logger.info('Job queue stopped');
    },

    isRunning(): boolean {
      return running;
    },
  };

  return queue;
}
