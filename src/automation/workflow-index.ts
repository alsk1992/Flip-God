/**
 * Workflow Builder Module - Tool Definitions & Handler
 *
 * Exports tool definitions and a handler function for wiring into the agent.
 */

import type { Database } from '../db/index.js';
import {
  createWorkflow,
  executeWorkflow,
  scheduleWorkflow,
  getWorkflowStatus,
  listWorkflows,
  deleteWorkflow,
  getWorkflow,
} from './workflow-engine.js';
import type { WorkflowStep, CreateWorkflowParams } from './workflow-types.js';

// =============================================================================
// Tool Definitions
// =============================================================================

export const workflowTools = [
  {
    name: 'create_workflow',
    description: 'Create an automated multi-step workflow (e.g., scan -> filter -> list -> monitor)',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
        description: { type: 'string' as const },
        steps: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              type: {
                type: 'string' as const,
                enum: ['scan', 'filter', 'list', 'reprice', 'monitor', 'alert', 'export', 'wait'],
              },
              params: { type: 'object' as const },
              condition: {
                type: 'object' as const,
                description: 'Optional condition to skip this step (type: if_margin_above, if_price_below, if_in_stock, if_category_match, always, never)',
              },
            },
          },
        },
        schedule: {
          type: 'string' as const,
          description: 'Cron expression for scheduled runs (e.g., "0 */6 * * *")',
        },
      },
      required: ['name', 'steps'],
    },
  },
  {
    name: 'run_workflow',
    description: 'Execute a workflow immediately',
    input_schema: {
      type: 'object' as const,
      properties: {
        workflow_id: { type: 'string' as const },
        dry_run: {
          type: 'boolean' as const,
          description: 'If true, simulate execution without making changes (default false)',
        },
      },
      required: ['workflow_id'],
    },
  },
  {
    name: 'workflow_status',
    description: 'Check status of a running or completed workflow execution',
    input_schema: {
      type: 'object' as const,
      properties: {
        execution_id: { type: 'string' as const },
      },
      required: ['execution_id'],
    },
  },
  {
    name: 'list_workflows',
    description: 'List all defined workflows',
    input_schema: {
      type: 'object' as const,
      properties: {
        include_executions: {
          type: 'boolean' as const,
          description: 'Include recent execution history (default false)',
        },
      },
    },
  },
  {
    name: 'delete_workflow',
    description: 'Delete a workflow definition',
    input_schema: {
      type: 'object' as const,
      properties: {
        workflow_id: { type: 'string' as const },
      },
      required: ['workflow_id'],
    },
  },
  {
    name: 'get_workflow',
    description: 'Get details of a specific workflow',
    input_schema: {
      type: 'object' as const,
      properties: {
        workflow_id: { type: 'string' as const },
      },
      required: ['workflow_id'],
    },
  },
  {
    name: 'schedule_workflow',
    description: 'Set a cron schedule for a workflow',
    input_schema: {
      type: 'object' as const,
      properties: {
        workflow_id: { type: 'string' as const },
        schedule: { type: 'string' as const, description: 'Cron expression (e.g., "0 */6 * * *")' },
      },
      required: ['workflow_id', 'schedule'],
    },
  },
] as const;

// =============================================================================
// Tool Handler
// =============================================================================

export interface WorkflowToolInput {
  name?: string;
  description?: string;
  steps?: WorkflowStep[];
  schedule?: string;
  workflow_id?: string;
  execution_id?: string;
  dry_run?: boolean;
  include_executions?: boolean;
}

/**
 * Handle workflow tool calls.
 */
export function handleWorkflowTool(
  db: Database,
  toolName: string,
  input: WorkflowToolInput,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'create_workflow': {
        if (!input.name?.trim()) return { success: false, error: 'name is required' };
        if (!Array.isArray(input.steps) || input.steps.length === 0) {
          return { success: false, error: 'steps array is required and must not be empty' };
        }

        const workflow = createWorkflow(db, {
          name: input.name,
          description: input.description,
          steps: input.steps,
          schedule: input.schedule,
        } as CreateWorkflowParams);

        return { success: true, data: workflow };
      }

      case 'run_workflow': {
        if (!input.workflow_id) return { success: false, error: 'workflow_id is required' };

        const execution = executeWorkflow(db, input.workflow_id, input.dry_run ?? false);
        return { success: true, data: execution };
      }

      case 'workflow_status': {
        if (!input.execution_id) return { success: false, error: 'execution_id is required' };

        const status = getWorkflowStatus(db, input.execution_id);
        if (!status) return { success: false, error: 'Execution not found' };
        return { success: true, data: status };
      }

      case 'list_workflows': {
        const workflows = listWorkflows(db, undefined, input.include_executions ?? false);
        return { success: true, data: workflows };
      }

      case 'delete_workflow': {
        if (!input.workflow_id) return { success: false, error: 'workflow_id is required' };
        const deleted = deleteWorkflow(db, input.workflow_id);
        return {
          success: deleted,
          data: { deleted },
          error: deleted ? undefined : 'Workflow not found',
        };
      }

      case 'get_workflow': {
        if (!input.workflow_id) return { success: false, error: 'workflow_id is required' };
        const workflow = getWorkflow(db, input.workflow_id);
        if (!workflow) return { success: false, error: 'Workflow not found' };
        return { success: true, data: workflow };
      }

      case 'schedule_workflow': {
        if (!input.workflow_id) return { success: false, error: 'workflow_id is required' };
        if (!input.schedule?.trim()) return { success: false, error: 'schedule is required' };

        const scheduled = scheduleWorkflow(db, input.workflow_id, input.schedule!);
        return {
          success: scheduled,
          data: { scheduled, schedule: input.schedule },
          error: scheduled ? undefined : 'Failed to set schedule',
        };
      }

      default:
        return { success: false, error: `Unknown workflow tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// Re-export core functions
export {
  createWorkflow,
  executeWorkflow,
  scheduleWorkflow,
  getWorkflowStatus,
  listWorkflows,
  deleteWorkflow,
  getWorkflow,
} from './workflow-engine.js';

export type {
  Workflow,
  WorkflowStep,
  WorkflowExecution,
  StepResult,
  WorkflowStatusReport,
  CreateWorkflowParams,
  StepType,
  StepCondition,
  ConditionType,
  ExecutionStatus,
  StepStatus,
  WorkflowStatus,
} from './workflow-types.js';
