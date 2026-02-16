/**
 * Workflow Builder Types - Multi-Step Automation
 */

// =============================================================================
// STEP TYPES
// =============================================================================

export type StepType =
  | 'scan'
  | 'filter'
  | 'list'
  | 'reprice'
  | 'monitor'
  | 'alert'
  | 'export'
  | 'wait';

export type ConditionType =
  | 'if_margin_above'
  | 'if_price_below'
  | 'if_in_stock'
  | 'if_category_match'
  | 'if_platform_match'
  | 'always'
  | 'never';

export type WorkflowStatus = 'active' | 'disabled' | 'deleted';
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

// =============================================================================
// WORKFLOW DEFINITION
// =============================================================================

export interface StepCondition {
  type: ConditionType;
  value?: number | string | string[];
}

export interface WorkflowStep {
  type: StepType;
  params: Record<string, unknown>;
  condition?: StepCondition;
}

export interface Workflow {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  steps: WorkflowStep[];
  schedule: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateWorkflowParams {
  userId?: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  schedule?: string;
}

// =============================================================================
// WORKFLOW EXECUTION
// =============================================================================

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  status: ExecutionStatus;
  currentStep: number;
  totalSteps: number;
  dryRun: boolean;
  context: Record<string, unknown>;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
}

export interface StepResult {
  id: string;
  executionId: string;
  stepIndex: number;
  stepType: StepType;
  status: StepStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  skipped: boolean;
  skipReason: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

export interface WorkflowStatusReport {
  execution: WorkflowExecution;
  workflow: Workflow | null;
  stepResults: StepResult[];
  summary: string;
}
