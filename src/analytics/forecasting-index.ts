/**
 * Demand Forecasting - Tool Definitions & Handler
 *
 * Exports tool definitions and a handler function for demand forecasting,
 * seasonal analysis, and trend detection.
 */

import type { Database } from '../db/index.js';
import {
  forecastDemand,
  detectSeasonalPatterns,
  estimatePriceElasticity,
  getTrendingCategories,
  getStallingProducts,
} from './forecasting.js';
import type { ForecastMethod } from './forecasting-types.js';

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const forecastingTools = [
  {
    name: 'demand_forecast',
    description: 'Forecast future demand for a product based on historical sales',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const, description: 'Product ID to forecast' },
        days_ahead: { type: 'number' as const, description: 'Days to forecast ahead (default: 14)' },
        method: {
          type: 'string' as const,
          enum: ['sma', 'wma', 'seasonal'] as const,
          description: 'Forecast method: sma (simple moving avg), wma (weighted), seasonal (default: wma)',
        },
      },
      required: ['product_id'] as const,
    },
  },
  {
    name: 'seasonal_analysis',
    description: 'Detect seasonal demand patterns for a category',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string' as const, description: 'Product category to analyze' },
        platform: { type: 'string' as const, description: 'Platform to filter by' },
      },
      required: ['category'] as const,
    },
  },
  {
    name: 'price_elasticity',
    description: 'Estimate how price changes affect demand for a product',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const, description: 'Product ID to analyze' },
      },
      required: ['product_id'] as const,
    },
  },
  {
    name: 'trending_categories',
    description: 'Find categories with rising or falling demand',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string' as const,
          enum: ['7d', '14d', '30d'] as const,
          description: 'Comparison period (default: 14d)',
        },
        direction: {
          type: 'string' as const,
          enum: ['rising', 'falling', 'both'] as const,
          description: 'Filter by trend direction (default: both)',
        },
        limit: { type: 'number' as const, description: 'Max results (default: 10)' },
      },
    },
  },
  {
    name: 'stalling_products',
    description: 'Find products with declining sales velocity (markdown candidates)',
    input_schema: {
      type: 'object' as const,
      properties: {
        min_days_listed: {
          type: 'number' as const,
          description: 'Minimum days listed to include (default: 14)',
        },
        limit: { type: 'number' as const, description: 'Max results (default: 20)' },
      },
    },
  },
];

// =============================================================================
// TOOL HANDLER
// =============================================================================

/**
 * Handle forecasting tool invocations.
 */
export function handleForecastingTool(
  toolName: string,
  input: Record<string, unknown>,
  db: Database,
): unknown {
  switch (toolName) {
    case 'demand_forecast': {
      const productId = input.product_id as string;
      if (!productId) return { error: 'product_id is required' };

      const daysAhead = Math.max(1, Math.min(Number(input.days_ahead) || 14, 90));
      const method = (input.method as ForecastMethod) ?? 'wma';
      const forecast = forecastDemand(db, productId, daysAhead, method);

      return {
        success: true,
        ...forecast,
      };
    }

    case 'seasonal_analysis': {
      const category = input.category as string;
      if (!category) return { error: 'category is required' };

      const platform = input.platform as string | undefined;
      const patterns = detectSeasonalPatterns(db, category, platform);

      return {
        success: true,
        ...patterns,
      };
    }

    case 'price_elasticity': {
      const productId = input.product_id as string;
      if (!productId) return { error: 'product_id is required' };

      const elasticity = estimatePriceElasticity(db, productId);

      return {
        success: true,
        ...elasticity,
      };
    }

    case 'trending_categories': {
      const period = (input.period as '7d' | '14d' | '30d') ?? '14d';
      const direction = (input.direction as 'rising' | 'falling' | 'both') ?? 'both';
      const limit = Math.max(1, Math.min(Number(input.limit) || 10, 100));

      const categories = getTrendingCategories(db, { period, direction, limit });

      return {
        success: true,
        period,
        direction,
        count: categories.length,
        categories,
      };
    }

    case 'stalling_products': {
      const minDaysListed = Math.max(1, Math.min(Number(input.min_days_listed) || 14, 365));
      const limit = Math.max(1, Math.min(Number(input.limit) || 20, 200));

      const products = getStallingProducts(db, { minDaysListed, limit });

      return {
        success: true,
        minDaysListed,
        count: products.length,
        products,
      };
    }

    default:
      return { error: `Unknown forecasting tool: ${toolName}` };
  }
}
