/**
 * Advanced Rules Module - Tool Definitions & Handler
 *
 * Expression-based pricing, time-conditional rules, and cross-platform
 * reactive pricing rules.
 */

import type { Database } from '../db/index.js';
import {
  evaluateExpression,
  evaluateTimeCondition,
  evaluateCrossPlatformRule,
  createExpressionRule,
  createTimeRule,
  createCrossPlatformRule,
} from './advanced-rules.js';
import type {
  TimeCondition,
  CrossPlatformRule,
  CreateExpressionRuleInput,
  CreateTimeRuleInput,
  CreateCrossPlatformRuleInput,
} from './advanced-rules.js';

// =============================================================================
// Tool Definitions
// =============================================================================

export const advancedRuleTools = [
  {
    name: 'create_expression_rule',
    description: 'Create a repricing rule using math expressions (e.g., "cost * 1.3 + shipping")',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
        expression: {
          type: 'string' as const,
          description: 'Price expression (e.g., "max(cost * 1.25, competitor_min - 0.01)")',
        },
        platform: { type: 'string' as const },
        min_price: { type: 'number' as const },
        max_price: { type: 'number' as const },
      },
      required: ['name', 'expression'],
    },
  },
  {
    name: 'create_time_rule',
    description: 'Create a time-based repricing rule (different prices by time/day)',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
        schedules: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              days: {
                type: 'array' as const,
                items: { type: 'number' as const },
                description: '0=Sun, 1=Mon, ..., 6=Sat',
              },
              hours: {
                type: 'array' as const,
                items: { type: 'number' as const },
                description: 'Hours (0-23)',
              },
              price_adjustment_pct: {
                type: 'number' as const,
                description: 'Price adjustment % during this window',
              },
            },
          },
        },
        platform: { type: 'string' as const },
      },
      required: ['name', 'schedules'],
    },
  },
  {
    name: 'create_cross_platform_rule',
    description: 'Create a rule that reacts to competitor prices on a different platform',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
        watch_platform: { type: 'string' as const, description: 'Platform to monitor for changes' },
        adjust_platform: { type: 'string' as const, description: 'Platform to adjust prices on' },
        trigger: {
          type: 'string' as const,
          enum: ['price_drop', 'price_increase', 'undercut'],
        },
        adjustment_pct: { type: 'number' as const, description: 'How much to adjust by (%)' },
        min_price: { type: 'number' as const },
      },
      required: ['name', 'watch_platform', 'adjust_platform', 'trigger', 'adjustment_pct'],
    },
  },
  {
    name: 'evaluate_expression',
    description: 'Test a pricing expression with sample values',
    input_schema: {
      type: 'object' as const,
      properties: {
        expression: { type: 'string' as const },
        variables: {
          type: 'object' as const,
          description: 'Variable values (cost, competitor_min, etc.)',
        },
      },
      required: ['expression', 'variables'],
    },
  },
  {
    name: 'evaluate_time_condition',
    description: 'Test if a time condition matches right now (or a specific time)',
    input_schema: {
      type: 'object' as const,
      properties: {
        day_of_week: {
          type: 'array' as const,
          items: { type: 'number' as const },
          description: 'Days: 0=Sun, 1=Mon, ..., 6=Sat',
        },
        hour_range: {
          type: 'array' as const,
          items: { type: 'number' as const },
          description: '[startHour, endHour] in 24h format',
        },
        date_range: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: '[startDate, endDate] as YYYY-MM-DD',
        },
        test_time: {
          type: 'string' as const,
          description: 'ISO timestamp to test against (defaults to now)',
        },
      },
    },
  },
] as const;

// =============================================================================
// Tool Handler
// =============================================================================

export interface AdvancedRuleToolInput {
  name?: string;
  expression?: string;
  platform?: string;
  min_price?: number;
  max_price?: number;
  variables?: Record<string, number>;
  schedules?: Array<{
    days?: number[];
    hours?: number[];
    price_adjustment_pct: number;
  }>;
  watch_platform?: string;
  adjust_platform?: string;
  trigger?: string;
  adjustment_pct?: number;
  day_of_week?: number[];
  hour_range?: number[];
  date_range?: string[];
  test_time?: string;
}

/**
 * Handle advanced rule tool calls.
 */
export function handleAdvancedRuleTool(
  db: Database,
  toolName: string,
  input: AdvancedRuleToolInput,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'create_expression_rule': {
        if (!input.name?.trim()) return { success: false, error: 'name is required' };
        if (!input.expression?.trim()) return { success: false, error: 'expression is required' };

        const rule = createExpressionRule(db, {
          name: input.name,
          expression: input.expression,
          platform: input.platform,
          minPrice: input.min_price,
          maxPrice: input.max_price,
        } as CreateExpressionRuleInput);

        return { success: true, data: rule };
      }

      case 'create_time_rule': {
        if (!input.name?.trim()) return { success: false, error: 'name is required' };
        if (!Array.isArray(input.schedules) || input.schedules.length === 0) {
          return { success: false, error: 'schedules array is required' };
        }

        // Normalize field names
        const schedules = input.schedules.map((s) => ({
          days: s.days,
          hours: s.hours,
          priceAdjustmentPct: s.price_adjustment_pct,
        }));

        const rule = createTimeRule(db, {
          name: input.name,
          schedules,
          platform: input.platform,
        } as CreateTimeRuleInput);

        return { success: true, data: rule };
      }

      case 'create_cross_platform_rule': {
        if (!input.name?.trim()) return { success: false, error: 'name is required' };
        if (!input.watch_platform) return { success: false, error: 'watch_platform is required' };
        if (!input.adjust_platform) return { success: false, error: 'adjust_platform is required' };
        if (!input.trigger) return { success: false, error: 'trigger is required' };
        if (!Number.isFinite(input.adjustment_pct)) return { success: false, error: 'adjustment_pct must be a number' };

        const rule = createCrossPlatformRule(db, {
          name: input.name,
          watchPlatform: input.watch_platform,
          adjustPlatform: input.adjust_platform,
          trigger: input.trigger as 'price_drop' | 'price_increase' | 'undercut',
          adjustmentPct: input.adjustment_pct!,
          minPrice: input.min_price,
        } as CreateCrossPlatformRuleInput);

        return { success: true, data: rule };
      }

      case 'evaluate_expression': {
        if (!input.expression?.trim()) return { success: false, error: 'expression is required' };

        const variables = input.variables ?? {};
        // Validate all variable values are numbers
        for (const [key, val] of Object.entries(variables)) {
          if (!Number.isFinite(val)) {
            return { success: false, error: `Variable '${key}' must be a finite number, got: ${val}` };
          }
        }

        const result = evaluateExpression(input.expression, variables);
        return {
          success: true,
          data: {
            expression: input.expression,
            variables,
            result: Math.round(result * 100) / 100,
          },
        };
      }

      case 'evaluate_time_condition': {
        const condition: TimeCondition = {};
        if (input.day_of_week) condition.dayOfWeek = input.day_of_week;
        if (input.hour_range && input.hour_range.length === 2) {
          condition.hourRange = [input.hour_range[0], input.hour_range[1]];
        }
        if (input.date_range && input.date_range.length === 2) {
          condition.dateRange = [input.date_range[0], input.date_range[1]];
        }

        const testTime = input.test_time ? new Date(input.test_time) : new Date();
        if (isNaN(testTime.getTime())) {
          return { success: false, error: 'Invalid test_time format' };
        }

        const matches = evaluateTimeCondition(condition, testTime);
        return {
          success: true,
          data: {
            condition,
            test_time: testTime.toISOString(),
            matches,
            current_day: testTime.getDay(),
            current_hour: testTime.getHours(),
          },
        };
      }

      default:
        return { success: false, error: `Unknown advanced rule tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// Re-export core functions
export {
  evaluateExpression,
  evaluateTimeCondition,
  evaluateCrossPlatformRule,
  createExpressionRule,
  createTimeRule,
  createCrossPlatformRule,
} from './advanced-rules.js';

export type {
  TimeCondition,
  CrossPlatformRule,
  CrossPlatformEvalResult,
  CreateExpressionRuleInput,
  CreateTimeRuleInput,
  CreateCrossPlatformRuleInput,
} from './advanced-rules.js';
