/**
 * Oversell Detection Module - Tool Definitions & Handler
 *
 * Detects and mitigates overselling risk across platforms.
 */

import type { Database } from '../db/index.js';
import {
  checkOversellRisk,
  getOversellReport,
  autoReduceListings,
  setupOversellMonitor,
  runOversellCheck,
} from './oversell-detector.js';
import type {
  OversellSeverity,
  ReductionStrategy,
  OversellMonitorConfig,
} from './oversell-types.js';

// =============================================================================
// Tool Definitions
// =============================================================================

export const oversellTools = [
  {
    name: 'check_oversell_risk',
    description: 'Check for products at risk of overselling across platforms',
    input_schema: {
      type: 'object' as const,
      properties: {
        severity: {
          type: 'string' as const,
          enum: ['critical', 'warning', 'all'],
          description: 'Filter by severity level (default all)',
        },
      },
    },
  },
  {
    name: 'oversell_report',
    description: 'Generate detailed oversell risk report',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string' as const, description: 'Filter by platform' },
        category: { type: 'string' as const, description: 'Filter by product category' },
      },
    },
  },
  {
    name: 'auto_reduce_listings',
    description: 'Automatically reduce listed quantities to match available inventory',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const },
        strategy: {
          type: 'string' as const,
          enum: ['proportional', 'lowest_margin_first', 'newest_first'],
          description: 'Reduction strategy (default proportional)',
        },
        dry_run: {
          type: 'boolean' as const,
          description: 'If true, simulate without making changes (default true)',
        },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'setup_oversell_monitor',
    description: 'Configure automatic oversell monitoring',
    input_schema: {
      type: 'object' as const,
      properties: {
        check_interval_minutes: {
          type: 'number' as const,
          description: 'How often to check (in minutes, default 5)',
        },
        auto_reduce_threshold: {
          type: 'string' as const,
          enum: ['critical', 'warning'],
          description: 'Severity level that triggers auto-reduction (default critical)',
        },
        notify_on_detection: {
          type: 'boolean' as const,
          description: 'Create alerts when oversell risk detected (default true)',
        },
        reduction_strategy: {
          type: 'string' as const,
          enum: ['proportional', 'lowest_margin_first', 'newest_first'],
          description: 'Strategy for auto-reduction (default proportional)',
        },
      },
    },
  },
  {
    name: 'run_oversell_check',
    description: 'Run a single oversell check cycle (alerts + auto-reduce critical items)',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
] as const;

// =============================================================================
// Tool Handler
// =============================================================================

export interface OversellToolInput {
  severity?: string;
  platform?: string;
  category?: string;
  product_id?: string;
  strategy?: string;
  dry_run?: boolean;
  check_interval_minutes?: number;
  auto_reduce_threshold?: string;
  notify_on_detection?: boolean;
  reduction_strategy?: string;
}

/**
 * Handle oversell detection tool calls.
 */
export function handleOversellTool(
  db: Database,
  toolName: string,
  input: OversellToolInput,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'check_oversell_risk': {
        const severity = (input.severity as OversellSeverity | 'all') ?? 'all';
        const risks = checkOversellRisk(db, severity);
        return {
          success: true,
          data: {
            risks,
            count: risks.length,
            critical: risks.filter((r) => r.severity === 'critical').length,
            warning: risks.filter((r) => r.severity === 'warning').length,
            info: risks.filter((r) => r.severity === 'info').length,
          },
        };
      }

      case 'oversell_report': {
        const report = getOversellReport(db, input.platform, input.category);
        return { success: true, data: report };
      }

      case 'auto_reduce_listings': {
        if (!input.product_id) return { success: false, error: 'product_id is required' };

        const plan = autoReduceListings(db, input.product_id, {
          strategy: (input.strategy as ReductionStrategy) ?? 'proportional',
          dryRun: input.dry_run ?? true,
        });

        return { success: true, data: plan };
      }

      case 'setup_oversell_monitor': {
        const config: Partial<OversellMonitorConfig> = {};

        if (Number.isFinite(input.check_interval_minutes) && input.check_interval_minutes! > 0) {
          config.checkIntervalMs = input.check_interval_minutes! * 60 * 1000;
        }
        if (input.auto_reduce_threshold) {
          config.autoReduceThreshold = input.auto_reduce_threshold as OversellSeverity;
        }
        if (input.notify_on_detection !== undefined) {
          config.notifyOnDetection = input.notify_on_detection;
        }
        if (input.reduction_strategy) {
          config.reductionStrategy = input.reduction_strategy as ReductionStrategy;
        }

        const result = setupOversellMonitor(db, config);
        return { success: true, data: result };
      }

      case 'run_oversell_check': {
        const result = runOversellCheck(db);
        return { success: true, data: result };
      }

      default:
        return { success: false, error: `Unknown oversell tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// Re-export core functions
export {
  checkOversellRisk,
  getOversellReport,
  autoReduceListings,
  setupOversellMonitor,
  runOversellCheck,
} from './oversell-detector.js';

export type {
  OversellRisk,
  OversellReport,
  OversellSeverity,
  OversellPlatformDetail,
  ReductionPlan,
  ReductionAction,
  ReductionStrategy,
  OversellMonitorConfig,
} from './oversell-types.js';
