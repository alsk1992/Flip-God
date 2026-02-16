import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { createJobQueue, type JobQueue, type Job, type JobEnqueueInput } from './job-queue';
import type { Database } from '../db';

// =============================================================================
// In-memory Database for Job Queue Tests
// =============================================================================

const JOBS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payload TEXT NOT NULL,
    result TEXT,
    progress INTEGER DEFAULT 0,
    total_items INTEGER DEFAULT 0,
    completed_items INTEGER DEFAULT 0,
    failed_items INTEGER DEFAULT 0,
    errors TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
`;

async function createTestDb(): Promise<{ db: Database; raw: SqlJsDatabase }> {
  const SQL = await initSqlJs();
  const raw = new SQL.Database();
  raw.run(JOBS_SCHEMA);

  const db: Database = {
    close() { raw.close(); },
    save() {},

    run(sql: string, params: unknown[] = []): void {
      raw.run(sql, params as any);
    },

    query<T>(sql: string, params: unknown[] = []): T[] {
      const stmt = raw.prepare(sql);
      try {
        stmt.bind(params as any);
        const results: T[] = [];
        while (stmt.step()) {
          results.push(stmt.getAsObject() as T);
        }
        return results;
      } finally {
        stmt.free();
      }
    },

    // Stubs for non-queue methods
    getSession() { return undefined; },
    createSession() {},
    updateSession() {},
    deleteSession() {},
    listSessions() { return []; },
    getTradingCredentials() { return null; },
    createTradingCredentials() {},
    updateTradingCredentials() {},
    deleteTradingCredentials() {},
    getProduct() { return undefined; },
    upsertProduct() {},
    findProductByUPC() { return undefined; },
    findProductByASIN() { return undefined; },
    addPrice() {},
    getLatestPrices() { return []; },
    getPriceHistory() { return []; },
    addOpportunity() {},
    getActiveOpportunities() { return []; },
    updateOpportunityStatus() {},
    addListing() {},
    getActiveListings() { return []; },
    updateListingStatus() {},
    addOrder() {},
    getOrder() { return undefined; },
    updateOrderStatus() {},
  } as Database;

  return { db, raw };
}

// =============================================================================
// Tests
// =============================================================================

describe('Job Queue', () => {
  let db: Database;
  let raw: SqlJsDatabase;
  let queue: JobQueue;

  beforeEach(async () => {
    const result = await createTestDb();
    db = result.db;
    raw = result.raw;
    queue = createJobQueue(db);
  });

  afterEach(() => {
    queue.stop();
    try { raw.close(); } catch { /* ignore */ }
  });

  // -- Job Creation --

  describe('enqueue', () => {
    it('creates a job and returns an ID', () => {
      const id = queue.enqueue({
        type: 'bulk_scan',
        payload: { query: 'electronics' },
        totalItems: 10,
        userId: 'user-1',
      });

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      expect(id.startsWith('job_')).toBe(true);
    });

    it('job starts with pending status', () => {
      const id = queue.enqueue({
        type: 'bulk_scan',
        payload: {},
        totalItems: 5,
        userId: 'user-1',
      });

      const job = queue.getJob(id);
      expect(job).toBeDefined();
      expect(job!.status).toBe('pending');
      expect(job!.progress).toBe(0);
      expect(job!.completedItems).toBe(0);
      expect(job!.failedItems).toBe(0);
      expect(job!.errors).toEqual([]);
    });

    it('preserves job payload', () => {
      const id = queue.enqueue({
        type: 'bulk_list',
        payload: { platform: 'ebay', products: ['p1', 'p2'] },
        totalItems: 2,
        userId: 'user-1',
      });

      const job = queue.getJob(id);
      expect(job!.payload).toEqual({ platform: 'ebay', products: ['p1', 'p2'] });
    });

    it('persists job to database', () => {
      const id = queue.enqueue({
        type: 'bulk_scan',
        payload: { query: 'test' },
        totalItems: 1,
        userId: 'user-1',
      });

      // Query the raw database directly
      const rows = db.query<{ id: string; status: string }>(
        'SELECT id, status FROM jobs WHERE id = ?',
        [id],
      );
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe('pending');
    });
  });

  // -- Job Retrieval --

  describe('getJob', () => {
    it('returns job by ID', () => {
      const id = queue.enqueue({
        type: 'bulk_scan',
        payload: {},
        totalItems: 1,
        userId: 'user-1',
      });

      const job = queue.getJob(id);
      expect(job).toBeDefined();
      expect(job!.id).toBe(id);
    });

    it('returns undefined for non-existent job', () => {
      const job = queue.getJob('non-existent');
      expect(job).toBeUndefined();
    });
  });

  describe('getJobs', () => {
    it('returns all jobs for a user', () => {
      queue.enqueue({ type: 'bulk_scan', payload: {}, totalItems: 1, userId: 'user-1' });
      queue.enqueue({ type: 'bulk_list', payload: {}, totalItems: 2, userId: 'user-1' });
      queue.enqueue({ type: 'bulk_scan', payload: {}, totalItems: 1, userId: 'user-2' });

      const user1Jobs = queue.getJobs('user-1');
      expect(user1Jobs.length).toBe(2);

      const user2Jobs = queue.getJobs('user-2');
      expect(user2Jobs.length).toBe(1);
    });

    it('filters by status', () => {
      const id1 = queue.enqueue({ type: 'bulk_scan', payload: {}, totalItems: 1, userId: 'user-1' });
      queue.enqueue({ type: 'bulk_list', payload: {}, totalItems: 1, userId: 'user-1' });

      queue.markRunning(id1);

      const runningJobs = queue.getJobs('user-1', 'running');
      expect(runningJobs.length).toBe(1);
      expect(runningJobs[0].id).toBe(id1);
    });
  });

  // -- Job Status Transitions --

  describe('markRunning', () => {
    it('transitions job to running', () => {
      const id = queue.enqueue({
        type: 'bulk_scan',
        payload: {},
        totalItems: 1,
        userId: 'user-1',
      });

      queue.markRunning(id);
      const job = queue.getJob(id);
      expect(job!.status).toBe('running');
      expect(job!.startedAt).toBeDefined();
    });
  });

  describe('markFinished', () => {
    it('transitions to completed with progress 100%', () => {
      const id = queue.enqueue({
        type: 'bulk_scan',
        payload: {},
        totalItems: 10,
        userId: 'user-1',
      });

      queue.markRunning(id);
      queue.markFinished(id, 'completed', { summary: 'done' });

      // After markFinished, job is removed from cache and goes to DB
      const job = queue.getJob(id);
      expect(job).toBeDefined();
      expect(job!.status).toBe('completed');
      expect(job!.progress).toBe(100);
      expect(job!.completedAt).toBeDefined();
      expect(job!.result).toEqual({ summary: 'done' });
    });

    it('transitions to failed', () => {
      const id = queue.enqueue({
        type: 'bulk_scan',
        payload: {},
        totalItems: 1,
        userId: 'user-1',
      });

      queue.markRunning(id);
      queue.markFinished(id, 'failed', { error: 'Something broke' });

      const job = queue.getJob(id);
      expect(job!.status).toBe('failed');
    });
  });

  // -- Job Cancellation --

  describe('cancelJob', () => {
    it('cancels a pending job', () => {
      const id = queue.enqueue({
        type: 'bulk_scan',
        payload: {},
        totalItems: 1,
        userId: 'user-1',
      });

      const cancelled = queue.cancelJob(id);
      expect(cancelled).toBe(true);

      const job = queue.getJob(id);
      expect(job!.status).toBe('cancelled');
    });

    it('cancels a running job', () => {
      const id = queue.enqueue({
        type: 'bulk_scan',
        payload: {},
        totalItems: 1,
        userId: 'user-1',
      });

      queue.markRunning(id);
      const cancelled = queue.cancelJob(id);
      expect(cancelled).toBe(true);
    });

    it('cannot cancel a completed job', () => {
      const id = queue.enqueue({
        type: 'bulk_scan',
        payload: {},
        totalItems: 1,
        userId: 'user-1',
      });

      queue.markRunning(id);
      queue.markFinished(id, 'completed');

      // Job is now in DB only (removed from cache)
      const cancelled = queue.cancelJob(id);
      expect(cancelled).toBe(false);
    });

    it('returns false for non-existent job', () => {
      const cancelled = queue.cancelJob('non-existent');
      expect(cancelled).toBe(false);
    });
  });

  // -- Progress Tracking --

  describe('updateProgress', () => {
    it('updates completed and failed item counts', () => {
      const id = queue.enqueue({
        type: 'bulk_list',
        payload: {},
        totalItems: 10,
        userId: 'user-1',
      });

      queue.markRunning(id);
      queue.updateProgress(id, 5, 2, [
        { item: 'p3', error: 'Failed to list' },
        { item: 'p7', error: 'API timeout' },
      ]);

      const job = queue.getJob(id);
      expect(job!.completedItems).toBe(5);
      expect(job!.failedItems).toBe(2);
      expect(job!.errors.length).toBe(2);
      // Progress = (5+2)/10 * 100 = 70
      expect(job!.progress).toBe(70);
    });

    it('calculates progress percentage correctly', () => {
      const id = queue.enqueue({
        type: 'bulk_scan',
        payload: {},
        totalItems: 4,
        userId: 'user-1',
      });

      queue.updateProgress(id, 1, 0, []);
      expect(queue.getJob(id)!.progress).toBe(25);

      queue.updateProgress(id, 2, 0, []);
      expect(queue.getJob(id)!.progress).toBe(50);

      queue.updateProgress(id, 3, 1, []);
      expect(queue.getJob(id)!.progress).toBe(100);
    });

    it('handles zero totalItems gracefully', () => {
      const id = queue.enqueue({
        type: 'bulk_scan',
        payload: {},
        totalItems: 0,
        userId: 'user-1',
      });

      queue.updateProgress(id, 0, 0, []);
      expect(queue.getJob(id)!.progress).toBe(0);
    });
  });

  // -- FIFO Ordering --

  describe('getNextPending', () => {
    it('returns oldest pending job (FIFO)', () => {
      // Create jobs with slight time gaps
      const id1 = queue.enqueue({
        type: 'bulk_scan',
        payload: { order: 1 },
        totalItems: 1,
        userId: 'user-1',
      });

      const id2 = queue.enqueue({
        type: 'bulk_list',
        payload: { order: 2 },
        totalItems: 1,
        userId: 'user-1',
      });

      const next = queue.getNextPending();
      expect(next).toBeDefined();
      expect(next!.id).toBe(id1); // First created = first processed
    });

    it('returns undefined when no pending jobs', () => {
      const next = queue.getNextPending();
      expect(next).toBeUndefined();
    });

    it('skips running jobs', () => {
      const id1 = queue.enqueue({
        type: 'bulk_scan', payload: {}, totalItems: 1, userId: 'user-1',
      });
      const id2 = queue.enqueue({
        type: 'bulk_list', payload: {}, totalItems: 1, userId: 'user-1',
      });

      queue.markRunning(id1);

      const next = queue.getNextPending();
      expect(next!.id).toBe(id2);
    });
  });

  // -- Queue Start/Stop --

  describe('start/stop', () => {
    it('starts the queue', () => {
      expect(queue.isRunning()).toBe(false);
      queue.start();
      expect(queue.isRunning()).toBe(true);
    });

    it('stops the queue', () => {
      queue.start();
      expect(queue.isRunning()).toBe(true);

      queue.stop();
      expect(queue.isRunning()).toBe(false);
    });

    it('start is idempotent', () => {
      queue.start();
      queue.start(); // Should not throw or create duplicate timers
      expect(queue.isRunning()).toBe(true);
    });

    it('stop is idempotent', () => {
      queue.stop();
      queue.stop(); // Should not throw
      expect(queue.isRunning()).toBe(false);
    });
  });

  // -- Job Types --

  describe('job types', () => {
    it('supports all job types', () => {
      const types: JobEnqueueInput['type'][] = [
        'bulk_list', 'bulk_reprice', 'bulk_scan',
        'bulk_inventory_sync', 'bulk_import',
      ];

      for (const type of types) {
        const id = queue.enqueue({
          type,
          payload: {},
          totalItems: 1,
          userId: 'user-1',
        });
        const job = queue.getJob(id);
        expect(job!.type).toBe(type);
      }
    });
  });
});
