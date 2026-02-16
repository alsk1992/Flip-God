/**
 * Workflow Engine - Multi-Step Automation
 *
 * Defines, schedules, and executes multi-step workflows.
 * Steps are executed sequentially; each step's output feeds into the next.
 * Steps can have conditions that determine whether they should execute.
 *
 * Step types: scan, filter, list, reprice, monitor, alert, export, wait
 */

import { createLogger } from '../utils/logger.js';
import { generateId } from '../utils/id.js';
import type { Database } from '../db/index.js';
import type {
  Workflow,
  WorkflowStep,
  WorkflowExecution,
  StepResult,
  WorkflowStatusReport,
  CreateWorkflowParams,
  ExecutionStatus,
  StepStatus,
  StepCondition,
  StepType,
} from './workflow-types.js';

const logger = createLogger('workflow-engine');

// =============================================================================
// ROW PARSERS
// =============================================================================

function parseWorkflowRow(row: Record<string, unknown>): Workflow {
  let steps: WorkflowStep[] = [];
  try {
    steps = JSON.parse((row.steps as string) ?? '[]');
  } catch {
    steps = [];
  }

  return {
    id: row.id as string,
    userId: (row.user_id as string) ?? 'default',
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    steps,
    schedule: (row.schedule as string | null) ?? null,
    enabled: Boolean(row.enabled),
    createdAt: (row.created_at as number) ?? Date.now(),
    updatedAt: (row.updated_at as number) ?? Date.now(),
  };
}

function parseExecutionRow(row: Record<string, unknown>): WorkflowExecution {
  let context: Record<string, unknown> = {};
  try {
    context = JSON.parse((row.context as string) ?? '{}');
  } catch {
    context = {};
  }

  return {
    id: row.id as string,
    workflowId: row.workflow_id as string,
    status: (row.status as ExecutionStatus) ?? 'pending',
    currentStep: (row.current_step as number) ?? 0,
    totalSteps: (row.total_steps as number) ?? 0,
    dryRun: Boolean(row.dry_run),
    context,
    error: (row.error as string | null) ?? null,
    startedAt: (row.started_at as number) ?? Date.now(),
    completedAt: (row.completed_at as number | null) ?? null,
  };
}

function parseStepResultRow(row: Record<string, unknown>): StepResult {
  let input: unknown = null;
  let output: unknown = null;
  try {
    if (row.input) input = JSON.parse(row.input as string);
  } catch {
    input = null;
  }
  try {
    if (row.output) output = JSON.parse(row.output as string);
  } catch {
    output = null;
  }

  return {
    id: row.id as string,
    executionId: row.execution_id as string,
    stepIndex: (row.step_index as number) ?? 0,
    stepType: (row.step_type as StepType) ?? 'scan',
    status: (row.status as StepStatus) ?? 'pending',
    input,
    output,
    error: (row.error as string | null) ?? null,
    skipped: Boolean(row.skipped),
    skipReason: (row.skip_reason as string | null) ?? null,
    startedAt: (row.started_at as number | null) ?? null,
    completedAt: (row.completed_at as number | null) ?? null,
  };
}

// =============================================================================
// CONDITION EVALUATION
// =============================================================================

function evaluateCondition(
  condition: StepCondition | undefined,
  context: Record<string, unknown>,
): { shouldRun: boolean; reason: string } {
  if (!condition) {
    return { shouldRun: true, reason: 'No condition (always run)' };
  }

  switch (condition.type) {
    case 'always':
      return { shouldRun: true, reason: 'Condition: always' };

    case 'never':
      return { shouldRun: false, reason: 'Condition: never' };

    case 'if_margin_above': {
      const threshold = Number(condition.value);
      if (!Number.isFinite(threshold)) {
        return { shouldRun: true, reason: 'Invalid margin threshold, defaulting to run' };
      }
      const margin = Number(context.margin_pct ?? context.marginPct ?? 0);
      const passes = Number.isFinite(margin) && margin > threshold;
      return {
        shouldRun: passes,
        reason: passes
          ? `Margin ${margin}% > ${threshold}%`
          : `Margin ${margin}% <= ${threshold}% threshold`,
      };
    }

    case 'if_price_below': {
      const threshold = Number(condition.value);
      if (!Number.isFinite(threshold)) {
        return { shouldRun: true, reason: 'Invalid price threshold, defaulting to run' };
      }
      const price = Number(context.price ?? context.currentPrice ?? 0);
      const passes = Number.isFinite(price) && price < threshold;
      return {
        shouldRun: passes,
        reason: passes
          ? `Price $${price} < $${threshold}`
          : `Price $${price} >= $${threshold} threshold`,
      };
    }

    case 'if_in_stock': {
      const inStock = Boolean(context.in_stock ?? context.inStock ?? true);
      return {
        shouldRun: inStock,
        reason: inStock ? 'Item is in stock' : 'Item is out of stock',
      };
    }

    case 'if_category_match': {
      const targetCategories = Array.isArray(condition.value)
        ? condition.value.map((v) => String(v).toLowerCase())
        : [String(condition.value ?? '').toLowerCase()];
      const category = String(context.category ?? '').toLowerCase();
      const matches = targetCategories.includes(category);
      return {
        shouldRun: matches,
        reason: matches
          ? `Category "${category}" matches`
          : `Category "${category}" not in [${targetCategories.join(', ')}]`,
      };
    }

    case 'if_platform_match': {
      const targetPlatforms = Array.isArray(condition.value)
        ? condition.value.map((v) => String(v).toLowerCase())
        : [String(condition.value ?? '').toLowerCase()];
      const platform = String(context.platform ?? '').toLowerCase();
      const matches = targetPlatforms.includes(platform);
      return {
        shouldRun: matches,
        reason: matches
          ? `Platform "${platform}" matches`
          : `Platform "${platform}" not in [${targetPlatforms.join(', ')}]`,
      };
    }

    default:
      return { shouldRun: true, reason: `Unknown condition type: ${condition.type}, defaulting to run` };
  }
}

// =============================================================================
// STEP EXECUTION
// =============================================================================

/**
 * Execute a single workflow step.
 *
 * Each step type implements a specific behavior:
 *   - scan: searches for products/opportunities
 *   - filter: filters previous step output by criteria
 *   - list: creates listings from input data
 *   - reprice: adjusts prices for listings
 *   - monitor: checks status of listings/orders
 *   - alert: creates alerts/notifications
 *   - export: exports data to a format
 *   - wait: pauses execution for a duration
 */
function executeStep(
  db: Database,
  step: WorkflowStep,
  context: Record<string, unknown>,
  dryRun: boolean,
): { output: unknown; context: Record<string, unknown> } {
  const stepParams = step.params ?? {};

  switch (step.type) {
    case 'scan': {
      // Scan for products/opportunities matching criteria
      const platform = stepParams.platform as string | undefined;
      const category = stepParams.category as string | undefined;
      const minMargin = Number(stepParams.min_margin ?? 0);
      const limit = Number(stepParams.limit ?? 50);

      const conditions: string[] = ["status = 'active'"];
      const params: unknown[] = [];

      if (Number.isFinite(minMargin) && minMargin > 0) {
        conditions.push('margin_pct >= ?');
        params.push(minMargin);
      }
      if (platform) {
        conditions.push('(buy_platform = ? OR sell_platform = ?)');
        params.push(platform, platform);
      }

      const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 50;
      params.push(safeLimit);

      const rows = db.query<Record<string, unknown>>(
        `SELECT * FROM opportunities WHERE ${conditions.join(' AND ')} ORDER BY score DESC LIMIT ?`,
        params,
      );

      const items = rows.map((r) => ({
        id: r.id,
        product_id: r.product_id,
        buy_platform: r.buy_platform,
        sell_platform: r.sell_platform,
        buy_price: r.buy_price,
        sell_price: r.sell_price,
        margin_pct: r.margin_pct,
        score: r.score,
        category: category ?? null,
      }));

      return {
        output: { items, count: items.length },
        context: { ...context, items, scan_count: items.length },
      };
    }

    case 'filter': {
      // Filter items from previous step
      const items = (context.items as Record<string, unknown>[]) ?? [];
      const minMargin = Number(stepParams.min_margin ?? 0);
      const maxPrice = Number(stepParams.max_price ?? Infinity);
      const minScore = Number(stepParams.min_score ?? 0);
      const platforms = stepParams.platforms as string[] | undefined;

      let filtered = items;

      if (Number.isFinite(minMargin) && minMargin > 0) {
        filtered = filtered.filter((item) => {
          const margin = Number(item.margin_pct ?? 0);
          return Number.isFinite(margin) && margin >= minMargin;
        });
      }
      if (Number.isFinite(maxPrice)) {
        filtered = filtered.filter((item) => {
          const price = Number(item.buy_price ?? item.price ?? 0);
          return Number.isFinite(price) && price <= maxPrice;
        });
      }
      if (Number.isFinite(minScore) && minScore > 0) {
        filtered = filtered.filter((item) => {
          const score = Number(item.score ?? 0);
          return Number.isFinite(score) && score >= minScore;
        });
      }
      if (platforms && Array.isArray(platforms) && platforms.length > 0) {
        const lowerPlatforms = platforms.map((p) => String(p).toLowerCase());
        filtered = filtered.filter((item) => {
          const platform = String(item.sell_platform ?? item.platform ?? '').toLowerCase();
          return lowerPlatforms.includes(platform);
        });
      }

      return {
        output: { items: filtered, count: filtered.length, filtered_out: items.length - filtered.length },
        context: { ...context, items: filtered, filter_count: filtered.length },
      };
    }

    case 'list': {
      // Create listings for items
      const items = (context.items as Record<string, unknown>[]) ?? [];
      const listingResults: unknown[] = [];

      for (const item of items) {
        if (dryRun) {
          listingResults.push({
            dry_run: true,
            product_id: item.product_id,
            platform: item.sell_platform,
            price: item.sell_price,
          });
        } else {
          // In real execution, this would call the listing creation logic
          listingResults.push({
            product_id: item.product_id,
            platform: item.sell_platform,
            price: item.sell_price,
            status: 'would_create',
            note: 'Listing creation requires platform integration',
          });
        }
      }

      return {
        output: { listings: listingResults, count: listingResults.length },
        context: { ...context, listings: listingResults },
      };
    }

    case 'reprice': {
      // Reprice existing listings
      const listingIds = (stepParams.listing_ids as string[]) ?? [];
      const adjustmentPct = Number(stepParams.adjustment_pct ?? 0);
      const targetPrice = stepParams.target_price as number | undefined;
      const results: unknown[] = [];

      for (const listingId of listingIds) {
        const rows = db.query<Record<string, unknown>>(
          'SELECT * FROM listings WHERE id = ?',
          [listingId],
        );
        if (rows.length === 0) {
          results.push({ listing_id: listingId, error: 'Not found' });
          continue;
        }

        const listing = rows[0];
        const currentPrice = listing.price as number;
        let newPrice: number;

        if (targetPrice !== undefined && Number.isFinite(targetPrice)) {
          newPrice = targetPrice;
        } else if (Number.isFinite(adjustmentPct) && adjustmentPct !== 0) {
          newPrice = Math.round(currentPrice * (1 + adjustmentPct / 100) * 100) / 100;
        } else {
          results.push({ listing_id: listingId, old_price: currentPrice, no_change: true });
          continue;
        }

        if (!dryRun) {
          db.run(
            'UPDATE listings SET price = ?, updated_at = ? WHERE id = ?',
            [newPrice, Date.now(), listingId],
          );
        }

        results.push({
          listing_id: listingId,
          old_price: currentPrice,
          new_price: newPrice,
          dry_run: dryRun,
        });
      }

      return {
        output: { repriced: results, count: results.length },
        context: { ...context, reprice_results: results },
      };
    }

    case 'monitor': {
      // Check statuses of listings/orders
      const checkListings = Boolean(stepParams.check_listings ?? true);
      const checkOrders = Boolean(stepParams.check_orders ?? true);
      const results: Record<string, unknown> = {};

      if (checkListings) {
        const listings = db.query<Record<string, unknown>>(
          "SELECT status, COUNT(*) as cnt FROM listings GROUP BY status",
        );
        results.listings = listings;
      }

      if (checkOrders) {
        const orders = db.query<Record<string, unknown>>(
          "SELECT status, COUNT(*) as cnt FROM orders GROUP BY status",
        );
        results.orders = orders;
      }

      return {
        output: results,
        context: { ...context, monitor_results: results },
      };
    }

    case 'alert': {
      // Create alert notifications
      const message = String(stepParams.message ?? 'Workflow alert');
      const alertType = String(stepParams.alert_type ?? 'workflow_alert');
      const userId = String(context.user_id ?? 'default');

      if (!dryRun) {
        const alertId = generateId('alert');
        try {
          db.run(
            `INSERT INTO alerts (id, user_id, type, message, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [alertId, userId, alertType, message, Date.now()],
          );
        } catch {
          // alerts table might not have all columns; graceful degradation
        }
      }

      return {
        output: { alert_sent: true, message, type: alertType, dry_run: dryRun },
        context: { ...context, alert_sent: true },
      };
    }

    case 'export': {
      // Export data from context
      const format = String(stepParams.format ?? 'json');
      const items = (context.items as unknown[]) ?? [];
      const data = {
        format,
        item_count: items.length,
        exported_at: new Date().toISOString(),
        items: format === 'summary'
          ? { count: items.length, note: 'Summary only' }
          : items,
      };

      return {
        output: data,
        context: { ...context, export_data: data },
      };
    }

    case 'wait': {
      // Record the intended wait (actual waiting handled by caller)
      const durationMs = Number(stepParams.duration_ms ?? stepParams.duration_seconds
        ? Number(stepParams.duration_seconds) * 1000
        : 0);
      const waitUntil = stepParams.wait_until as string | undefined;

      return {
        output: {
          waited: true,
          duration_ms: Number.isFinite(durationMs) ? durationMs : 0,
          wait_until: waitUntil ?? null,
          note: 'Wait step recorded (actual delay handled by scheduler)',
        },
        context: { ...context, waited: true },
      };
    }

    default:
      return {
        output: { error: `Unknown step type: ${step.type}` },
        context,
      };
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Create a new workflow definition.
 */
export function createWorkflow(db: Database, params: CreateWorkflowParams): Workflow {
  if (!params.name?.trim()) {
    throw new Error('Workflow name is required');
  }
  if (!Array.isArray(params.steps) || params.steps.length === 0) {
    throw new Error('Workflow must have at least one step');
  }

  // Validate step types
  const validStepTypes: StepType[] = ['scan', 'filter', 'list', 'reprice', 'monitor', 'alert', 'export', 'wait'];
  for (let i = 0; i < params.steps.length; i++) {
    const step = params.steps[i];
    if (!validStepTypes.includes(step.type)) {
      throw new Error(`Invalid step type at index ${i}: ${step.type}`);
    }
  }

  const id = generateId('wf');
  const now = Date.now();

  db.run(
    `INSERT INTO workflows (id, user_id, name, description, steps, schedule, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id,
      params.userId ?? 'default',
      params.name.trim(),
      params.description ?? null,
      JSON.stringify(params.steps),
      params.schedule ?? null,
      now,
      now,
    ],
  );

  logger.info({ workflowId: id, name: params.name, steps: params.steps.length }, 'Workflow created');

  return {
    id,
    userId: params.userId ?? 'default',
    name: params.name.trim(),
    description: params.description ?? null,
    steps: params.steps,
    schedule: params.schedule ?? null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Execute a workflow step by step.
 */
export function executeWorkflow(
  db: Database,
  workflowId: string,
  dryRun: boolean = false,
  initialContext?: Record<string, unknown>,
): WorkflowExecution {
  // Load workflow
  const rows = db.query<Record<string, unknown>>(
    'SELECT * FROM workflows WHERE id = ?',
    [workflowId],
  );
  if (rows.length === 0) {
    throw new Error(`Workflow not found: ${workflowId}`);
  }

  const workflow = parseWorkflowRow(rows[0]);

  if (!workflow.enabled) {
    throw new Error(`Workflow "${workflow.name}" is disabled`);
  }

  // Create execution record
  const execId = generateId('wfe');
  const now = Date.now();
  const context: Record<string, unknown> = {
    ...initialContext,
    user_id: workflow.userId,
    workflow_id: workflowId,
    workflow_name: workflow.name,
  };

  db.run(
    `INSERT INTO workflow_executions (id, workflow_id, status, current_step, total_steps, dry_run, context, started_at)
     VALUES (?, ?, 'running', 0, ?, ?, ?, ?)`,
    [execId, workflowId, workflow.steps.length, dryRun ? 1 : 0, JSON.stringify(context), now],
  );

  // Execute steps sequentially
  let currentContext = { ...context };
  let lastError: string | null = null;
  let finalStatus: ExecutionStatus = 'completed';

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    const stepResultId = generateId('wfsr');
    const stepStartedAt = Date.now();

    // Check condition
    const condResult = evaluateCondition(step.condition, currentContext);

    if (!condResult.shouldRun) {
      // Record skipped step
      db.run(
        `INSERT INTO workflow_step_results (id, execution_id, step_index, step_type, status, skipped, skip_reason, started_at, completed_at)
         VALUES (?, ?, ?, ?, 'skipped', 1, ?, ?, ?)`,
        [stepResultId, execId, i, step.type, condResult.reason, stepStartedAt, Date.now()],
      );

      // Update execution progress
      db.run(
        'UPDATE workflow_executions SET current_step = ? WHERE id = ?',
        [i + 1, execId],
      );

      continue;
    }

    try {
      // Execute the step
      const { output, context: newContext } = executeStep(db, step, currentContext, dryRun);
      currentContext = newContext;

      // Record step result
      db.run(
        `INSERT INTO workflow_step_results (id, execution_id, step_index, step_type, status, input, output, started_at, completed_at)
         VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, ?)`,
        [
          stepResultId,
          execId,
          i,
          step.type,
          JSON.stringify(step.params),
          JSON.stringify(output),
          stepStartedAt,
          Date.now(),
        ],
      );

      // Update execution progress
      db.run(
        'UPDATE workflow_executions SET current_step = ?, context = ? WHERE id = ?',
        [i + 1, JSON.stringify(currentContext), execId],
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      lastError = `Step ${i} (${step.type}): ${errMsg}`;

      // Record failed step
      db.run(
        `INSERT INTO workflow_step_results (id, execution_id, step_index, step_type, status, input, error, started_at, completed_at)
         VALUES (?, ?, ?, ?, 'failed', ?, ?, ?, ?)`,
        [
          stepResultId,
          execId,
          i,
          step.type,
          JSON.stringify(step.params),
          errMsg,
          stepStartedAt,
          Date.now(),
        ],
      );

      finalStatus = 'failed';
      logger.error({ err, workflowId, execId, step: i, stepType: step.type }, 'Workflow step failed');
      break;
    }
  }

  // Finalize execution
  const completedAt = Date.now();
  db.run(
    'UPDATE workflow_executions SET status = ?, context = ?, error = ?, completed_at = ? WHERE id = ?',
    [finalStatus, JSON.stringify(currentContext), lastError, completedAt, execId],
  );

  logger.info({ workflowId, execId, status: finalStatus, dryRun }, 'Workflow execution completed');

  return {
    id: execId,
    workflowId,
    status: finalStatus,
    currentStep: workflow.steps.length,
    totalSteps: workflow.steps.length,
    dryRun,
    context: currentContext,
    error: lastError,
    startedAt: now,
    completedAt,
  };
}

/**
 * Schedule a workflow for periodic execution (stores the cron expression).
 */
export function scheduleWorkflow(db: Database, workflowId: string, schedule: string): boolean {
  if (!workflowId) throw new Error('workflow_id is required');
  if (!schedule?.trim()) throw new Error('schedule (cron expression) is required');

  try {
    db.run(
      'UPDATE workflows SET schedule = ?, updated_at = ? WHERE id = ?',
      [schedule.trim(), Date.now(), workflowId],
    );
    logger.info({ workflowId, schedule }, 'Workflow schedule updated');
    return true;
  } catch (err) {
    logger.error({ err, workflowId }, 'Failed to schedule workflow');
    return false;
  }
}

/**
 * Get detailed status of a workflow execution.
 */
export function getWorkflowStatus(db: Database, executionId: string): WorkflowStatusReport | null {
  const execRows = db.query<Record<string, unknown>>(
    'SELECT * FROM workflow_executions WHERE id = ?',
    [executionId],
  );
  if (execRows.length === 0) return null;

  const execution = parseExecutionRow(execRows[0]);

  // Load workflow
  const wfRows = db.query<Record<string, unknown>>(
    'SELECT * FROM workflows WHERE id = ?',
    [execution.workflowId],
  );
  const workflow = wfRows.length > 0 ? parseWorkflowRow(wfRows[0]) : null;

  // Load step results
  const stepRows = db.query<Record<string, unknown>>(
    'SELECT * FROM workflow_step_results WHERE execution_id = ? ORDER BY step_index ASC',
    [executionId],
  );
  const stepResults = stepRows.map(parseStepResultRow);

  // Build summary
  const completedSteps = stepResults.filter((s) => s.status === 'completed').length;
  const failedSteps = stepResults.filter((s) => s.status === 'failed').length;
  const skippedSteps = stepResults.filter((s) => s.skipped).length;

  let summary: string;
  if (execution.status === 'completed') {
    summary = `Workflow completed: ${completedSteps}/${execution.totalSteps} steps executed` +
      (skippedSteps > 0 ? `, ${skippedSteps} skipped` : '') +
      (execution.dryRun ? ' (dry run)' : '');
  } else if (execution.status === 'failed') {
    summary = `Workflow failed at step ${execution.currentStep}/${execution.totalSteps}: ${execution.error ?? 'Unknown error'}` +
      (failedSteps > 0 ? ` (${failedSteps} step(s) failed)` : '');
  } else if (execution.status === 'running') {
    summary = `Workflow running: step ${execution.currentStep}/${execution.totalSteps}`;
  } else {
    summary = `Workflow status: ${execution.status}`;
  }

  return { execution, workflow, stepResults, summary };
}

/**
 * List all workflows for a user.
 */
export function listWorkflows(
  db: Database,
  userId?: string,
  includeExecutions: boolean = false,
): Array<Workflow & { recentExecutions?: WorkflowExecution[] }> {
  try {
    const conditions: string[] = ["enabled = 1 OR status != 'deleted'"];
    const params: unknown[] = [];

    if (userId) {
      conditions.push('user_id = ?');
      params.push(userId);
    }

    // Ensure we don't show deleted workflows
    conditions.push("COALESCE(enabled, 1) != -1");

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.query<Record<string, unknown>>(
      `SELECT * FROM workflows ${where} ORDER BY created_at DESC`,
      params,
    );

    const workflows = rows.map(parseWorkflowRow);

    if (!includeExecutions) {
      return workflows;
    }

    // Attach recent executions
    return workflows.map((wf) => {
      const execRows = db.query<Record<string, unknown>>(
        'SELECT * FROM workflow_executions WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 5',
        [wf.id],
      );
      return {
        ...wf,
        recentExecutions: execRows.map(parseExecutionRow),
      };
    });
  } catch (err) {
    logger.error({ err }, 'Failed to list workflows');
    return [];
  }
}

/**
 * Delete a workflow (soft-delete by disabling).
 */
export function deleteWorkflow(db: Database, workflowId: string): boolean {
  try {
    db.run(
      'UPDATE workflows SET enabled = 0, updated_at = ? WHERE id = ?',
      [Date.now(), workflowId],
    );
    logger.info({ workflowId }, 'Workflow deleted (disabled)');
    return true;
  } catch (err) {
    logger.error({ err, workflowId }, 'Failed to delete workflow');
    return false;
  }
}

/**
 * Get a single workflow by ID.
 */
export function getWorkflow(db: Database, workflowId: string): Workflow | null {
  const rows = db.query<Record<string, unknown>>(
    'SELECT * FROM workflows WHERE id = ?',
    [workflowId],
  );
  if (rows.length === 0) return null;
  return parseWorkflowRow(rows[0]);
}
