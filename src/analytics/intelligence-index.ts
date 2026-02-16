/**
 * Competitive Intelligence - Tool Definitions & Handler
 *
 * Exports tool definitions and a handler function for competitive
 * intelligence analysis: price charts, stockout predictions,
 * market share, pricing strategy detection, and competitor alerts.
 */

import type { Database } from '../db/index.js';
import {
  getCompetitorPriceCharts,
  predictStockout,
  estimateMarketShare,
  classifyPricingStrategy,
  getCompetitorAlerts,
  getMarketOverview,
} from './intelligence.js';

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const intelligenceTools = [
  {
    name: 'competitor_price_chart',
    description: 'Get competitor price history formatted for visualization',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const, description: 'Product ID to analyze' },
        days: { type: 'number' as const, description: 'Days of history (default: 30)' },
        platform: { type: 'string' as const, description: 'Filter by platform' },
      },
      required: ['product_id'] as const,
    },
  },
  {
    name: 'stockout_prediction',
    description: 'Predict when a competitor might sell out based on price/velocity trends',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const, description: 'Product ID to analyze' },
        platform: { type: 'string' as const, description: 'Filter by platform' },
      },
      required: ['product_id'] as const,
    },
  },
  {
    name: 'market_share_estimate',
    description: 'Estimate market share in a category based on listing counts',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string' as const, description: 'Product category to analyze' },
        platform: { type: 'string' as const, description: 'Filter by platform' },
      },
      required: ['category'] as const,
    },
  },
  {
    name: 'market_overview',
    description: 'Get market overview for a category (seller count, price spread, density)',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string' as const, description: 'Product category' },
        platform: { type: 'string' as const, description: 'Filter by platform' },
      },
      required: ['category'] as const,
    },
  },
  {
    name: 'pricing_strategy_detection',
    description: 'Detect competitor pricing strategies (penetration, skimming, cost-plus, etc.)',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const, description: 'Product ID to analyze' },
        platform: { type: 'string' as const, description: 'Filter by platform' },
      },
      required: ['product_id'] as const,
    },
  },
  {
    name: 'competitor_alerts',
    description: 'Get significant competitor changes (new entrants, price wars, stockouts)',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string' as const, description: 'Filter by category' },
        platform: { type: 'string' as const, description: 'Filter by platform' },
        days: { type: 'number' as const, description: 'Lookback window in days (default: 7)' },
      },
    },
  },
];

// =============================================================================
// TOOL HANDLER
// =============================================================================

/**
 * Handle competitive intelligence tool invocations.
 */
export function handleIntelligenceTool(
  toolName: string,
  input: Record<string, unknown>,
  db: Database,
): unknown {
  switch (toolName) {
    case 'competitor_price_chart': {
      const productId = input.product_id as string;
      if (!productId) return { error: 'product_id is required' };

      const days = Math.max(1, Math.min(Number(input.days) || 30, 365));
      const platform = input.platform as string | undefined;
      const chart = getCompetitorPriceCharts(db, productId, days, platform);

      return {
        success: true,
        ...chart,
        sellerCount: chart.series.length,
      };
    }

    case 'stockout_prediction': {
      const productId = input.product_id as string;
      if (!productId) return { error: 'product_id is required' };

      const platform = input.platform as string | undefined;
      const predictions = predictStockout(db, productId, platform);

      return {
        success: true,
        productId,
        predictionCount: predictions.length,
        predictions,
      };
    }

    case 'market_share_estimate': {
      const category = input.category as string;
      if (!category) return { error: 'category is required' };

      const platform = input.platform as string | undefined;
      const estimate = estimateMarketShare(db, category, platform);

      return {
        success: true,
        ...estimate,
      };
    }

    case 'market_overview': {
      const category = input.category as string;
      if (!category) return { error: 'category is required' };

      const platform = input.platform as string | undefined;
      const overview = getMarketOverview(db, category, platform);

      return {
        success: true,
        ...overview,
        generatedAt: new Date(overview.generatedAt).toISOString(),
      };
    }

    case 'pricing_strategy_detection': {
      const productId = input.product_id as string;
      if (!productId) return { error: 'product_id is required' };

      const platform = input.platform as string | undefined;
      const analysis = classifyPricingStrategy(db, productId, platform);

      return {
        success: true,
        ...analysis,
        strategyCount: analysis.strategies.length,
      };
    }

    case 'competitor_alerts': {
      const category = input.category as string | undefined;
      const platform = input.platform as string | undefined;
      const days = Math.max(1, Math.min(Number(input.days) || 7, 90));

      const alerts = getCompetitorAlerts(db, { category, platform, days });

      return {
        success: true,
        filters: { category: category ?? null, platform: platform ?? null, days },
        alertCount: alerts.length,
        alerts: alerts.map((a) => ({
          ...a,
          detectedAt: new Date(a.detectedAt).toISOString(),
        })),
      };
    }

    default:
      return { error: `Unknown intelligence tool: ${toolName}` };
  }
}
