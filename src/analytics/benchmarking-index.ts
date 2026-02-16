/**
 * Seller Performance Benchmarking - Tool Definitions & Handler
 *
 * Exports tool definitions and a handler function for seller performance
 * metrics, including sell-through rate, holding period, shipping, returns,
 * and an aggregate scorecard.
 */

import type { Database } from '../db/index.js';
import {
  getSellThroughRate,
  getAverageHoldingPeriod,
  getShippingPerformance,
  getReturnRate,
  getProfitPerHour,
  getSellerScorecard,
} from './benchmarking.js';

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const benchmarkingTools = [
  {
    name: 'sell_through_rate',
    description: 'Calculate sell-through rate (% of listings that sold)',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string' as const,
          enum: ['7d', '30d', '90d', 'ytd'] as const,
          description: 'Time period (default: 30d)',
        },
        platform: { type: 'string' as const, description: 'Filter by platform' },
        category: { type: 'string' as const, description: 'Filter by category' },
      },
    },
  },
  {
    name: 'holding_period_analysis',
    description: 'Analyze average days from listing to sale',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string' as const, description: 'Filter by category' },
        platform: { type: 'string' as const, description: 'Filter by platform' },
      },
    },
  },
  {
    name: 'shipping_performance',
    description: 'Analyze shipping speed and on-time delivery rate',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string' as const,
          enum: ['7d', '30d', '90d', 'ytd'] as const,
          description: 'Time period (default: 30d)',
        },
        platform: { type: 'string' as const, description: 'Filter by platform' },
      },
    },
  },
  {
    name: 'return_rate_analysis',
    description: 'Analyze return rates by category/platform with top reasons',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string' as const,
          enum: ['7d', '30d', '90d', 'ytd'] as const,
          description: 'Time period (default: 30d)',
        },
        platform: { type: 'string' as const, description: 'Filter by platform' },
        category: { type: 'string' as const, description: 'Filter by category' },
      },
    },
  },
  {
    name: 'profit_per_hour',
    description: 'Estimate profit per hour of work based on order volume',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string' as const,
          enum: ['7d', '30d', '90d', 'ytd'] as const,
          description: 'Time period (default: 30d)',
        },
        minutes_per_order: {
          type: 'number' as const,
          description: 'Estimated minutes per order (default: 15)',
        },
      },
    },
  },
  {
    name: 'seller_scorecard',
    description: 'Generate comprehensive seller performance scorecard with grades',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string' as const,
          enum: ['7d', '30d', '90d', 'ytd'] as const,
          description: 'Time period (default: 30d)',
        },
      },
    },
  },
];

// =============================================================================
// TOOL HANDLER
// =============================================================================

/**
 * Handle benchmarking tool invocations.
 */
export function handleBenchmarkingTool(
  toolName: string,
  input: Record<string, unknown>,
  db: Database,
): unknown {
  switch (toolName) {
    case 'sell_through_rate': {
      const period = (input.period as string) ?? '30d';
      const platform = input.platform as string | undefined;
      const category = input.category as string | undefined;
      const result = getSellThroughRate(db, { period, platform, category });
      return { success: true, ...result };
    }

    case 'holding_period_analysis': {
      const category = input.category as string | undefined;
      const platform = input.platform as string | undefined;
      const result = getAverageHoldingPeriod(db, { category, platform });
      return { success: true, ...result };
    }

    case 'shipping_performance': {
      const period = (input.period as string) ?? '30d';
      const platform = input.platform as string | undefined;
      const result = getShippingPerformance(db, { period, platform });
      return { success: true, ...result };
    }

    case 'return_rate_analysis': {
      const period = (input.period as string) ?? '30d';
      const platform = input.platform as string | undefined;
      const category = input.category as string | undefined;
      const result = getReturnRate(db, { period, platform, category });
      return { success: true, ...result };
    }

    case 'profit_per_hour': {
      const period = (input.period as string) ?? '30d';
      const minutesPerOrder = Number(input.minutes_per_order) || 15;
      const result = getProfitPerHour(db, { period, minutesPerOrder });
      return { success: true, ...result };
    }

    case 'seller_scorecard': {
      const period = (input.period as '7d' | '30d' | '90d' | 'ytd') ?? '30d';
      const scorecard = getSellerScorecard(db, period);
      return {
        success: true,
        ...scorecard,
        generatedAt: new Date(scorecard.generatedAt).toISOString(),
      };
    }

    default:
      return { error: `Unknown benchmarking tool: ${toolName}` };
  }
}
