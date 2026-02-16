/**
 * Dashboard Analytics - Tool Definitions & Handler
 *
 * Exports tool definitions for the agent system and a handler function
 * for dashboard analytics queries.
 */

import type { Database } from '../db/index.js';
import {
  getDailyProfitTrend,
  getCategoryProfitability,
  getPlatformROI,
  getTopProducts,
  getBottomProducts,
  getInventoryTurnover,
  getProfitByTimeOfDay,
  getOverallStats,
} from './dashboard.js';
import type { DashboardPeriod } from './dashboard-types.js';

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const dashboardTools = [
  {
    name: 'profit_trend',
    description: 'Get daily profit trend over time',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: { type: 'number' as const, description: 'Number of days to analyze (default: 30)' },
        platform: { type: 'string' as const, description: 'Filter by selling platform' },
      },
    },
  },
  {
    name: 'category_profitability',
    description: 'Analyze profitability by product category',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string' as const,
          enum: ['7d', '30d', '90d', 'ytd', 'all'] as const,
          description: 'Time period to analyze (default: 30d)',
        },
        min_orders: {
          type: 'number' as const,
          description: 'Minimum orders to include category (default: 3)',
        },
      },
    },
  },
  {
    name: 'platform_roi',
    description: 'Compare ROI across selling platforms',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string' as const,
          enum: ['7d', '30d', '90d', 'ytd', 'all'] as const,
          description: 'Time period to analyze (default: 30d)',
        },
      },
    },
  },
  {
    name: 'top_products',
    description: 'Get top performing products by profit, revenue, or margin',
    input_schema: {
      type: 'object' as const,
      properties: {
        metric: {
          type: 'string' as const,
          enum: ['profit', 'revenue', 'margin', 'velocity'] as const,
          description: 'Metric to rank by (default: profit)',
        },
        limit: { type: 'number' as const, description: 'Number of results (default: 10)' },
        period: {
          type: 'string' as const,
          enum: ['7d', '30d', '90d', 'ytd', 'all'] as const,
          description: 'Time period (default: 30d)',
        },
      },
    },
  },
  {
    name: 'bottom_products',
    description: 'Get worst performing products (candidates for removal)',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number' as const, description: 'Number of results (default: 10)' },
        period: {
          type: 'string' as const,
          enum: ['7d', '30d', '90d', 'ytd', 'all'] as const,
          description: 'Time period (default: 30d)',
        },
      },
    },
  },
  {
    name: 'inventory_turnover',
    description: 'Analyze inventory turnover rates (days to sell)',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string' as const, description: 'Filter by product category' },
        platform: { type: 'string' as const, description: 'Filter by platform' },
      },
    },
  },
  {
    name: 'profit_by_time',
    description: 'Analyze profitability by time of day and day of week',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'business_overview',
    description: 'Get comprehensive business overview dashboard',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string' as const,
          enum: ['7d', '30d', '90d', 'ytd', 'all'] as const,
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
 * Handle dashboard tool invocations.
 */
export function handleDashboardTool(
  toolName: string,
  input: Record<string, unknown>,
  db: Database,
): unknown {
  switch (toolName) {
    case 'profit_trend': {
      const days = Math.max(1, Math.min(Number(input.days) || 30, 365));
      const platform = input.platform as string | undefined;
      const trend = getDailyProfitTrend(db, days, platform);
      return {
        success: true,
        days,
        platform: platform ?? null,
        dataPoints: trend.length,
        trend,
      };
    }

    case 'category_profitability': {
      const period = (input.period as DashboardPeriod) ?? '30d';
      const minOrders = Math.max(0, Number(input.min_orders) || 3);
      const categories = getCategoryProfitability(db, { period, minOrders });
      return {
        success: true,
        period,
        categoryCount: categories.length,
        categories,
      };
    }

    case 'platform_roi': {
      const period = (input.period as DashboardPeriod) ?? '30d';
      const platforms = getPlatformROI(db, { period });
      return {
        success: true,
        period,
        platformCount: platforms.length,
        platforms,
      };
    }

    case 'top_products': {
      const metric = (input.metric as 'profit' | 'revenue' | 'margin' | 'velocity') ?? 'profit';
      const limit = Math.max(1, Math.min(Number(input.limit) || 10, 100));
      const period = (input.period as DashboardPeriod) ?? '30d';
      const products = getTopProducts(db, { metric, limit, period });
      return {
        success: true,
        metric,
        period,
        count: products.length,
        products,
      };
    }

    case 'bottom_products': {
      const limit = Math.max(1, Math.min(Number(input.limit) || 10, 100));
      const period = (input.period as DashboardPeriod) ?? '30d';
      const products = getBottomProducts(db, { limit, period });
      return {
        success: true,
        period,
        count: products.length,
        products,
      };
    }

    case 'inventory_turnover': {
      const category = input.category as string | undefined;
      const platform = input.platform as string | undefined;
      const turnover = getInventoryTurnover(db, { category, platform });
      return {
        success: true,
        filters: { category: category ?? null, platform: platform ?? null },
        groupCount: turnover.length,
        turnover,
      };
    }

    case 'profit_by_time': {
      const result = getProfitByTimeOfDay(db);
      return {
        success: true,
        byHour: result.byHour,
        byDayOfWeek: result.byDayOfWeek,
      };
    }

    case 'business_overview': {
      const period = (input.period as DashboardPeriod) ?? '30d';
      const stats = getOverallStats(db, period);
      return {
        success: true,
        ...stats,
      };
    }

    default:
      return { error: `Unknown dashboard tool: ${toolName}` };
  }
}
