/**
 * Cron Scheduler - Scheduled job execution for FlipGod
 *
 * Features:
 * - Interval jobs (run every N milliseconds)
 * - Daily jobs (run at specific UTC hour)
 * - Cron expression jobs (simple built-in parser, no dependencies)
 * - Add/remove/pause/resume jobs
 * - 30-second scheduler loop
 * - Built-in jobs for FlipGod domain tasks
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('cron');

// =============================================================================
// TYPES
// =============================================================================

export type CronJobType = 'interval' | 'daily' | 'cron';

export type CronJobStatus = 'ok' | 'error' | 'pending';

export interface CronJobSchedule {
  /** Job type */
  type: CronJobType;
  /** Interval in milliseconds (for 'interval' type) */
  intervalMs?: number;
  /** UTC hour to run (0-23, for 'daily' type) */
  utcHour?: number;
  /** Cron expression (for 'cron' type): "minute hour dayOfMonth month dayOfWeek" */
  cronExpr?: string;
}

export type CronJobHandler = () => Promise<void> | void;

export interface CronJob {
  id: string;
  name: string;
  type: CronJobType;
  schedule: CronJobSchedule;
  handler: CronJobHandler;
  enabled: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  lastStatus: CronJobStatus;
  lastError?: string;
  lastDurationMs?: number;
}

export interface CronJobInput {
  id: string;
  name: string;
  schedule: CronJobSchedule;
  handler: CronJobHandler;
  enabled?: boolean;
}

// =============================================================================
// SIMPLE CRON PARSER
// =============================================================================

/**
 * Parse a simple cron expression and return the next run time.
 * Supports: minute hour dayOfMonth month dayOfWeek
 * Only handles numeric values and '*' (wildcards).
 * Does not support ranges, steps, or lists.
 */
function getNextCronTime(expr: string): Date | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return null;

  const [minuteStr, hourStr, dayOfMonthStr, monthStr, dayOfWeekStr] = parts;
  const now = new Date();
  const next = new Date(now);
  next.setUTCSeconds(0);
  next.setUTCMilliseconds(0);

  // Start from the next minute
  next.setUTCMinutes(next.getUTCMinutes() + 1);

  // Try up to 366 days ahead to find a match
  for (let attempts = 0; attempts < 366 * 24 * 60; attempts++) {
    const matches =
      matchesCronField(minuteStr, next.getUTCMinutes()) &&
      matchesCronField(hourStr, next.getUTCHours()) &&
      matchesCronField(dayOfMonthStr, next.getUTCDate()) &&
      matchesCronField(monthStr, next.getUTCMonth() + 1) && // cron months are 1-12
      matchesCronField(dayOfWeekStr, next.getUTCDay()); // 0=Sunday

    if (matches) return next;

    // Advance one minute
    next.setUTCMinutes(next.getUTCMinutes() + 1);
  }

  return null;
}

function matchesCronField(field: string, value: number): boolean {
  if (field === '*') return true;

  // Handle comma-separated values: "1,15,30"
  if (field.includes(',')) {
    return field.split(',').some((part) => matchesCronField(part.trim(), value));
  }

  // Handle step values: "*/5"
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    if (!Number.isFinite(step) || step <= 0) return false;
    return value % step === 0;
  }

  // Handle ranges: "1-5"
  if (field.includes('-')) {
    const [startStr, endStr] = field.split('-');
    const start = parseInt(startStr, 10);
    const end = parseInt(endStr, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
    return value >= start && value <= end;
  }

  // Simple numeric match
  const num = parseInt(field, 10);
  return Number.isFinite(num) && num === value;
}

// =============================================================================
// CALCULATE NEXT RUN
// =============================================================================

function calculateNextRun(schedule: CronJobSchedule, lastRunAt: Date | null): Date | null {
  const now = new Date();

  switch (schedule.type) {
    case 'interval': {
      if (!schedule.intervalMs || schedule.intervalMs <= 0) return null;
      const base = lastRunAt ? lastRunAt.getTime() : now.getTime();
      const nextMs = base + schedule.intervalMs;
      // If next run is in the past, schedule from now
      return new Date(Math.max(nextMs, now.getTime()));
    }

    case 'daily': {
      const hour = schedule.utcHour ?? 0;
      if (hour < 0 || hour > 23) return null;

      const next = new Date(now);
      next.setUTCHours(hour, 0, 0, 0);
      // If today's run time has passed, schedule for tomorrow
      if (next.getTime() <= now.getTime()) {
        next.setUTCDate(next.getUTCDate() + 1);
      }
      return next;
    }

    case 'cron': {
      if (!schedule.cronExpr) return null;
      return getNextCronTime(schedule.cronExpr);
    }

    default:
      return null;
  }
}

// =============================================================================
// CRON SCHEDULER
// =============================================================================

export class CronScheduler {
  private jobs = new Map<string, CronJob>();
  private tickTimer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly tickIntervalMs: number;

  constructor(tickIntervalMs: number = 30_000) {
    this.tickIntervalMs = tickIntervalMs;
  }

  /**
   * Add a job to the scheduler
   */
  addJob(input: CronJobInput): CronJob {
    if (this.jobs.has(input.id)) {
      logger.warn({ jobId: input.id }, 'Job already exists, replacing');
      this.removeJob(input.id);
    }

    const job: CronJob = {
      id: input.id,
      name: input.name,
      type: input.schedule.type,
      schedule: input.schedule,
      handler: input.handler,
      enabled: input.enabled !== false,
      lastRunAt: null,
      nextRunAt: null,
      lastStatus: 'pending',
    };

    // Calculate initial next run
    job.nextRunAt = calculateNextRun(job.schedule, null);

    this.jobs.set(job.id, job);
    logger.info({ jobId: job.id, name: job.name, type: job.type, nextRunAt: job.nextRunAt }, 'Cron job added');
    return job;
  }

  /**
   * Remove a job by ID
   */
  removeJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    this.jobs.delete(id);
    logger.info({ jobId: id, name: job.name }, 'Cron job removed');
    return true;
  }

  /**
   * Pause a job (disable without removing)
   */
  pauseJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.enabled = false;
    logger.info({ jobId: id, name: job.name }, 'Cron job paused');
    return true;
  }

  /**
   * Resume a paused job
   */
  resumeJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    job.enabled = true;
    // Recalculate next run if needed
    if (!job.nextRunAt || job.nextRunAt.getTime() <= Date.now()) {
      job.nextRunAt = calculateNextRun(job.schedule, job.lastRunAt);
    }
    logger.info({ jobId: id, name: job.name, nextRunAt: job.nextRunAt }, 'Cron job resumed');
    return true;
  }

  /**
   * Start the scheduler loop (checks every tickIntervalMs)
   */
  start(): void {
    if (this.running) {
      logger.warn('Cron scheduler already running');
      return;
    }

    this.running = true;
    logger.info({ tickIntervalMs: this.tickIntervalMs, jobCount: this.jobs.size }, 'Cron scheduler started');

    // Run an initial tick immediately
    this.tick();

    // Then run on interval
    this.tickTimer = setInterval(() => {
      this.tick();
    }, this.tickIntervalMs);
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    logger.info('Cron scheduler stopped');
  }

  /**
   * Get all jobs with their current status
   */
  getJobs(): CronJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get a specific job by ID
   */
  getJob(id: string): CronJob | undefined {
    return this.jobs.get(id);
  }

  /**
   * Whether the scheduler is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Force-run a specific job immediately (ignoring schedule)
   */
  async runNow(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) return false;
    await this.executeJob(job);
    return true;
  }

  // ===========================================================================
  // PRIVATE
  // ===========================================================================

  /**
   * Tick: check all jobs and execute any that are due
   */
  private tick(): void {
    const now = Date.now();

    const jobs = Array.from(this.jobs.values());
    for (const job of jobs) {
      if (!job.enabled) continue;
      if (!job.nextRunAt) continue;
      if (job.nextRunAt.getTime() > now) continue;

      // Job is due - execute async, don't block the tick loop
      this.executeJob(job).catch((error) => {
        logger.error({ jobId: job.id, name: job.name, error }, 'Unexpected error in job execution wrapper');
      });
    }
  }

  /**
   * Execute a single job and update its state
   */
  private async executeJob(job: CronJob): Promise<void> {
    const startedAt = Date.now();
    logger.info({ jobId: job.id, name: job.name }, 'Running cron job');

    try {
      await job.handler();
      const durationMs = Date.now() - startedAt;

      job.lastRunAt = new Date(startedAt);
      job.lastStatus = 'ok';
      job.lastError = undefined;
      job.lastDurationMs = durationMs;
      job.nextRunAt = calculateNextRun(job.schedule, job.lastRunAt);

      logger.info({ jobId: job.id, name: job.name, durationMs, nextRunAt: job.nextRunAt }, 'Cron job completed');
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const errorMsg = error instanceof Error ? error.message : String(error);

      job.lastRunAt = new Date(startedAt);
      job.lastStatus = 'error';
      job.lastError = errorMsg;
      job.lastDurationMs = durationMs;
      job.nextRunAt = calculateNextRun(job.schedule, job.lastRunAt);

      logger.error({ jobId: job.id, name: job.name, error: errorMsg, durationMs }, 'Cron job failed');
    }
  }
}

// =============================================================================
// BUILT-IN JOBS FACTORY
// =============================================================================

/**
 * Register default FlipGod built-in jobs on a scheduler.
 * The gateway should call this after creating the scheduler, passing
 * actual handler implementations.
 */
export interface BuiltInJobHandlers {
  /** Hourly price scanning for tracked products */
  scanPrices?: () => Promise<void>;
  /** Every 5 min eBay order check */
  checkOrders?: () => Promise<void>;
  /** Every 30 min competitive repricing check */
  repriceCheck?: () => Promise<void>;
  /** Hourly stock/inventory sync */
  inventorySync?: () => Promise<void>;
  /** Daily session cleanup */
  sessionCleanup?: () => Promise<void>;
  /** Daily DB backup */
  dbBackup?: () => Promise<void>;
}

export function registerBuiltInJobs(scheduler: CronScheduler, handlers: BuiltInJobHandlers): void {
  if (handlers.scanPrices) {
    scheduler.addJob({
      id: 'scan_prices',
      name: 'Price Scanner',
      schedule: { type: 'interval', intervalMs: 60 * 60 * 1000 }, // hourly
      handler: handlers.scanPrices,
    });
  }

  if (handlers.checkOrders) {
    scheduler.addJob({
      id: 'check_orders',
      name: 'Order Checker',
      schedule: { type: 'interval', intervalMs: 5 * 60 * 1000 }, // every 5 min
      handler: handlers.checkOrders,
    });
  }

  if (handlers.repriceCheck) {
    scheduler.addJob({
      id: 'reprice_check',
      name: 'Reprice Checker',
      schedule: { type: 'interval', intervalMs: 30 * 60 * 1000 }, // every 30 min
      handler: handlers.repriceCheck,
    });
  }

  if (handlers.inventorySync) {
    scheduler.addJob({
      id: 'inventory_sync',
      name: 'Inventory Sync',
      schedule: { type: 'interval', intervalMs: 60 * 60 * 1000 }, // hourly
      handler: handlers.inventorySync,
    });
  }

  if (handlers.sessionCleanup) {
    scheduler.addJob({
      id: 'session_cleanup',
      name: 'Session Cleanup',
      schedule: { type: 'daily', utcHour: 3 }, // 3 AM UTC daily
      handler: handlers.sessionCleanup,
    });
  }

  if (handlers.dbBackup) {
    scheduler.addJob({
      id: 'db_backup',
      name: 'Database Backup',
      schedule: { type: 'daily', utcHour: 4 }, // 4 AM UTC daily
      handler: handlers.dbBackup,
    });
  }

  logger.info('Built-in cron jobs registered');
}
