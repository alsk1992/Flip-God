/**
 * Migration 020 - Workflow Builder (Multi-Step Automation)
 *
 * Creates tables for workflow definitions, executions, and per-step results.
 */

export const MIGRATION_020_UP = `
  -- Workflow definitions
  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    steps TEXT NOT NULL DEFAULT '[]',
    schedule TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_workflows_user ON workflows(user_id);
  CREATE INDEX IF NOT EXISTS idx_workflows_enabled ON workflows(enabled);

  -- Workflow executions
  CREATE TABLE IF NOT EXISTS workflow_executions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    current_step INTEGER NOT NULL DEFAULT 0,
    total_steps INTEGER NOT NULL DEFAULT 0,
    dry_run INTEGER NOT NULL DEFAULT 0,
    context TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    started_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    completed_at INTEGER,
    FOREIGN KEY (workflow_id) REFERENCES workflows(id)
  );
  CREATE INDEX IF NOT EXISTS idx_workflow_exec_workflow ON workflow_executions(workflow_id);
  CREATE INDEX IF NOT EXISTS idx_workflow_exec_status ON workflow_executions(status);
  CREATE INDEX IF NOT EXISTS idx_workflow_exec_started ON workflow_executions(started_at);

  -- Per-step results within an execution
  CREATE TABLE IF NOT EXISTS workflow_step_results (
    id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    step_index INTEGER NOT NULL,
    step_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    input TEXT,
    output TEXT,
    error TEXT,
    skipped INTEGER NOT NULL DEFAULT 0,
    skip_reason TEXT,
    started_at INTEGER,
    completed_at INTEGER,
    FOREIGN KEY (execution_id) REFERENCES workflow_executions(id)
  );
  CREATE INDEX IF NOT EXISTS idx_step_results_execution ON workflow_step_results(execution_id);
  CREATE INDEX IF NOT EXISTS idx_step_results_status ON workflow_step_results(status);
`;

export const MIGRATION_020_DOWN = `
  DROP TABLE IF EXISTS workflow_step_results;
  DROP TABLE IF EXISTS workflow_executions;
  DROP TABLE IF EXISTS workflows;
`;
