/**
 * Analytics Module - Competitor price tracking tools and handlers
 *
 * Exports tool definitions for the agent system and handler functions
 * for competitor analysis and price trend tracking.
 */

import type { Database } from '../db/index';
import {
  snapshotCompetitorPrices,
  getPriceTrend,
  detectPriceTrends,
  getCompetitorHistory,
  generateCompetitorReport,
} from './competitor-tracker';

export {
  snapshotCompetitorPrices,
  getPriceTrend,
  detectPriceTrends,
  getCompetitorHistory,
  generateCompetitorReport,
} from './competitor-tracker';
export type {
  CompetitorPriceSnapshot,
  PriceTrend,
  TrendDirection,
  TrendAnalysis,
  CompetitorReport,
} from './types';

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const analyticsTools = [
  {
    name: 'track_competitor_prices',
    description: 'Take a snapshot of current competitor prices for tracked products',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_ids: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Product IDs to snapshot (or empty for all tracked)',
        },
        platforms: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Platforms to check',
        },
      },
    },
  },
  {
    name: 'price_trend_analysis',
    description: 'Analyze price trends for a product over time',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const, description: 'Product ID to analyze' },
        platform: { type: 'string' as const, description: 'Platform to filter by' },
        days: { type: 'number' as const, description: 'Number of days to analyze (default: 30)' },
      },
      required: ['product_id'] as const,
    },
  },
  {
    name: 'competitor_report',
    description: 'Generate competitor analysis report for a category or product',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string' as const, description: 'Product category' },
        platform: { type: 'string' as const, description: 'Platform to filter by' },
        top_n: { type: 'number' as const, description: 'Number of top competitors to analyze (default: 10)' },
      },
      required: ['category'] as const,
    },
  },
];

// =============================================================================
// TOOL HANDLER
// =============================================================================

/**
 * Handle analytics tool invocations.
 *
 * @param toolName - The name of the tool being called
 * @param input - The tool input parameters
 * @param db - Database instance
 */
export function handleAnalyticsTool(
  toolName: string,
  input: Record<string, unknown>,
  db: Database,
): unknown {
  switch (toolName) {
    case 'track_competitor_prices': {
      const productIds = input.product_ids as string[] | undefined;
      const platforms = input.platforms as string[] | undefined;

      // If no product IDs given, snapshot all tracked products
      let products: Array<{ productId: string; platform?: string }>;

      if (productIds && productIds.length > 0) {
        if (platforms && platforms.length > 0) {
          // Cross-product of product IDs and platforms
          products = [];
          for (const pid of productIds) {
            for (const plat of platforms) {
              products.push({ productId: pid, platform: plat });
            }
          }
        } else {
          products = productIds.map((pid) => ({ productId: pid }));
        }
      } else {
        // Get all products from database
        const allProducts = db.query<Record<string, unknown>>(
          'SELECT id FROM products ORDER BY updated_at DESC LIMIT 100',
        );
        if (platforms && platforms.length > 0) {
          products = [];
          for (const row of allProducts) {
            for (const plat of platforms) {
              products.push({ productId: row.id as string, platform: plat });
            }
          }
        } else {
          products = allProducts.map((row) => ({ productId: row.id as string }));
        }
      }

      const snapshots = snapshotCompetitorPrices(db, products);

      return {
        success: true,
        snapshotCount: snapshots.length,
        snapshots: snapshots.map((s) => ({
          id: s.id,
          productId: s.productId,
          platform: s.platform,
          price: s.price,
          seller: s.seller,
          timestamp: new Date(s.timestamp).toISOString(),
        })),
      };
    }

    case 'price_trend_analysis': {
      const productId = input.product_id as string;
      const platform = input.platform as string | undefined;
      const days = Math.max(1, Math.min(Number(input.days) || 30, 365));

      if (platform) {
        // Single platform trend
        const trend = getPriceTrend(db, productId, platform, days);
        if (!trend) {
          return {
            productId,
            platform,
            days,
            message: 'No price data available for this product/platform combination',
          };
        }

        return {
          productId,
          platform: trend.platform,
          days: trend.periodDays,
          dataPoints: trend.dataPoints.length,
          avgPrice: round2(trend.avgPrice),
          minPrice: round2(trend.minPrice),
          maxPrice: round2(trend.maxPrice),
          stdDeviation: round2(trend.stdDeviation),
          trendDirection: trend.trendDirection,
          pctChange: round2(trend.pctChange),
        };
      }

      // All platforms -- full analysis
      const analysis = detectPriceTrends(db, productId);

      return {
        productId,
        overallDirection: analysis.overallDirection,
        recommendation: analysis.recommendation,
        platforms: analysis.trends.map((t) => ({
          platform: t.platform,
          avgPrice: round2(t.avgPrice),
          minPrice: round2(t.minPrice),
          maxPrice: round2(t.maxPrice),
          stdDeviation: round2(t.stdDeviation),
          trendDirection: t.trendDirection,
          pctChange: round2(t.pctChange),
          dataPoints: t.dataPoints.length,
        })),
        analyzedAt: new Date(analysis.analyzedAt).toISOString(),
      };
    }

    case 'competitor_report': {
      const category = input.category as string;
      const platform = input.platform as string | undefined;
      const topN = Math.max(1, Math.min(Number(input.top_n) || 10, 50));

      const report = generateCompetitorReport(db, { category, platform, topN });

      return {
        category: report.category,
        platform: report.platform,
        totalProducts: report.totalProducts,
        avgCategoryPrice: round2(report.avgCategoryPrice),
        competitors: report.competitors.map((c) => ({
          seller: c.seller,
          productCount: c.productCount,
          avgPrice: round2(c.avgPrice),
          minPrice: round2(c.minPrice),
          maxPrice: round2(c.maxPrice),
          priceRange: round2(c.priceRange),
        })),
        generatedAt: new Date(report.generatedAt).toISOString(),
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
