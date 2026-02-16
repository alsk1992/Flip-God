/**
 * Demand Scoring Tools - Tool definitions and handler for AI agent integration
 *
 * Provides tool definitions for demand scoring operations and a handler function
 * that dispatches tool calls to the underlying demand-scoring module.
 */

import type { Database } from '../db/index.js';
import {
  calculateDemandScore,
  batchScoreDemand,
  getDemandScores,
  getTopDemandProducts,
  getDemandTrends,
  getCategoryDemandRanking,
} from './demand-scoring.js';
import type { DemandRecommendation } from './demand-scoring.js';

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const demandScoringTools = [
  {
    name: 'demand_score',
    description:
      'Calculate demand score for a single product based on sales velocity, price stability, competition, reviews, search interest, and margin health',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: {
          type: 'string' as const,
          description: 'Product ID to score',
        },
      },
      required: ['product_id'] as const,
    },
  },
  {
    name: 'demand_batch_score',
    description:
      'Batch score multiple products for demand (or all products if none specified). Results are saved for trend tracking.',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_ids: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Product IDs to score (empty = all products, max 500)',
        },
      },
    },
  },
  {
    name: 'demand_top_products',
    description: 'Get top products ranked by demand score',
    input_schema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number' as const,
          description: 'Number of top products to return (default: 20, max: 200)',
        },
        category: {
          type: 'string' as const,
          description: 'Filter by product category',
        },
      },
    },
  },
  {
    name: 'demand_trends',
    description:
      'Show how demand score has changed over time for a product, including trend direction',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: {
          type: 'string' as const,
          description: 'Product ID to analyze',
        },
        days: {
          type: 'number' as const,
          description: 'Number of days to look back (default: 30, max: 365)',
        },
      },
      required: ['product_id'] as const,
    },
  },
  {
    name: 'demand_category_ranking',
    description:
      'Rank product categories by average demand score to identify the strongest niches',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'demand_scores_list',
    description:
      'List saved demand scores with filters (min/max score, recommendation level, category)',
    input_schema: {
      type: 'object' as const,
      properties: {
        min_score: {
          type: 'number' as const,
          description: 'Minimum overall score (0-100)',
        },
        max_score: {
          type: 'number' as const,
          description: 'Maximum overall score (0-100)',
        },
        recommendation: {
          type: 'string' as const,
          enum: ['high_demand', 'moderate_demand', 'low_demand', 'avoid'] as const,
          description: 'Filter by recommendation level',
        },
        category: {
          type: 'string' as const,
          description: 'Filter by product category',
        },
        limit: {
          type: 'number' as const,
          description: 'Max results (default: 100, max: 1000)',
        },
        offset: {
          type: 'number' as const,
          description: 'Pagination offset (default: 0)',
        },
      },
    },
  },
];

// =============================================================================
// TOOL HANDLER
// =============================================================================

/**
 * Handle demand scoring tool invocations.
 *
 * @param toolName - The name of the tool being called
 * @param input - The tool input parameters
 * @param db - Database instance
 */
export function handleDemandScoringTool(
  toolName: string,
  input: Record<string, unknown>,
  db: Database,
): unknown {
  switch (toolName) {
    case 'demand_score': {
      const productId = input.product_id as string;
      if (!productId) {
        return { error: 'product_id is required' };
      }

      try {
        const score = calculateDemandScore(db, productId);
        return {
          success: true,
          productId: score.productId,
          productName: score.productName,
          overallScore: score.overallScore,
          recommendation: score.recommendation,
          confidence: score.confidence,
          signals: score.signals,
          insights: score.insights,
          calculatedAt: new Date(score.calculatedAt).toISOString(),
        };
      } catch (err) {
        return { error: `Failed to score product: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case 'demand_batch_score': {
      const productIds = input.product_ids as string[] | undefined;

      try {
        const scores = batchScoreDemand(
          db,
          productIds && productIds.length > 0 ? productIds : undefined,
        );

        return {
          success: true,
          scored: scores.length,
          results: scores.map((s) => ({
            productId: s.productId,
            productName: s.productName,
            overallScore: s.overallScore,
            recommendation: s.recommendation,
            confidence: s.confidence,
          })),
          topProduct: scores.length > 0
            ? {
                productId: scores[0].productId,
                productName: scores[0].productName,
                overallScore: scores[0].overallScore,
              }
            : null,
        };
      } catch (err) {
        return { error: `Batch scoring failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case 'demand_top_products': {
      const limit = Math.max(1, Math.min(Number(input.limit) || 20, 200));
      const category = input.category as string | undefined;

      try {
        const scores = getTopDemandProducts(db, limit, category);
        return {
          success: true,
          count: scores.length,
          category: category ?? 'all',
          products: scores.map((s) => ({
            productId: s.productId,
            productName: s.productName,
            overallScore: s.overallScore,
            recommendation: s.recommendation,
            confidence: s.confidence,
            signals: s.signals,
            insights: s.insights,
          })),
        };
      } catch (err) {
        return { error: `Failed to get top products: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case 'demand_trends': {
      const productId = input.product_id as string;
      if (!productId) {
        return { error: 'product_id is required' };
      }

      const days = Math.max(1, Math.min(Number(input.days) || 30, 365));

      try {
        const trend = getDemandTrends(db, productId, days);
        return {
          success: true,
          productId: trend.productId,
          productName: trend.productName,
          direction: trend.direction,
          changePercent: trend.changePercent,
          periodDays: trend.periodDays,
          dataPoints: trend.points.length,
          points: trend.points,
        };
      } catch (err) {
        return { error: `Failed to get demand trends: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case 'demand_category_ranking': {
      try {
        const rankings = getCategoryDemandRanking(db);
        return {
          success: true,
          count: rankings.length,
          rankings: rankings.map((r) => ({
            category: r.category,
            avgScore: r.avgScore,
            productCount: r.productCount,
            topProduct: r.topProduct,
          })),
        };
      } catch (err) {
        return { error: `Failed to get category ranking: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case 'demand_scores_list': {
      const minScore = input.min_score != null ? Number(input.min_score) : undefined;
      const maxScore = input.max_score != null ? Number(input.max_score) : undefined;
      const recommendation = input.recommendation as DemandRecommendation | undefined;
      const category = input.category as string | undefined;
      const limit = Number(input.limit) || 100;
      const offset = Number(input.offset) || 0;

      try {
        const scores = getDemandScores(db, {
          minScore: minScore != null && Number.isFinite(minScore) ? minScore : undefined,
          maxScore: maxScore != null && Number.isFinite(maxScore) ? maxScore : undefined,
          recommendation,
          category,
          limit,
          offset,
        });

        return {
          success: true,
          count: scores.length,
          offset,
          scores: scores.map((s) => ({
            productId: s.productId,
            productName: s.productName,
            overallScore: s.overallScore,
            recommendation: s.recommendation,
            confidence: s.confidence,
            signals: s.signals,
            insights: s.insights,
            calculatedAt: new Date(s.calculatedAt).toISOString(),
          })),
        };
      } catch (err) {
        return { error: `Failed to list demand scores: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    default:
      return { error: `Unknown demand scoring tool: ${toolName}` };
  }
}
