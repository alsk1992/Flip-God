/**
 * Price Intelligence Tools - Tool definitions and handler for the agent tool registry.
 *
 * Exposes price history analysis, drop/spike detection, trend analysis,
 * buy/sell opportunity ranking, price distribution, and cross-platform comparison.
 */

import type { Database } from '../db/index.js';
import {
  analyzePriceHistory,
  detectPriceDrops,
  detectPriceSpikes,
  getPriceTrends,
  findBuyOpportunities,
  findSellOpportunities,
  getPriceDistribution,
  comparePlatformPrices,
} from './price-intelligence.js';

// =============================================================================
// Tool Definitions
// =============================================================================

export const priceIntelligenceTools = [
  {
    name: 'price_history_analyze',
    description:
      'Full price history analysis for a product: current vs avg vs min/max, trend direction, buy/sell signal, volatility, and price change over 7/30/90 days',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: {
          type: 'string' as const,
          description: 'Product ID to analyze',
        },
        days: {
          type: 'number' as const,
          description: 'Number of days of history to analyze (default 90, max 730)',
        },
      },
      required: ['product_id'] as const,
    },
    metadata: {
      category: 'analytics',
      categories: ['analytics', 'pricing'],
      tags: ['price', 'history', 'analysis', 'trend', 'buy', 'sell', 'signal'],
    },
  },
  {
    name: 'price_drops_detect',
    description:
      'Find products where the current price dropped significantly from recent average. Good for finding buying opportunities.',
    input_schema: {
      type: 'object' as const,
      properties: {
        min_drop_pct: {
          type: 'number' as const,
          description: 'Minimum price drop percentage to include (default 15)',
        },
        max_days_back: {
          type: 'number' as const,
          description: 'How far back to look in days (default 30)',
        },
        platforms: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Filter by platforms (e.g. amazon, ebay)',
        },
        categories: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Filter by product categories',
        },
        limit: {
          type: 'number' as const,
          description: 'Maximum results to return (default 50)',
        },
      },
    },
    metadata: {
      category: 'analytics',
      categories: ['analytics', 'pricing', 'sourcing'],
      tags: ['price', 'drop', 'deal', 'discount', 'buy', 'opportunity'],
    },
  },
  {
    name: 'price_spikes_detect',
    description:
      'Find products where the current price spiked significantly above recent average. Good for identifying selling windows.',
    input_schema: {
      type: 'object' as const,
      properties: {
        min_spike_pct: {
          type: 'number' as const,
          description: 'Minimum price spike percentage to include (default 15)',
        },
        max_days_back: {
          type: 'number' as const,
          description: 'How far back to look in days (default 30)',
        },
        platforms: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Filter by platforms',
        },
        categories: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Filter by product categories',
        },
        limit: {
          type: 'number' as const,
          description: 'Maximum results to return (default 50)',
        },
      },
    },
    metadata: {
      category: 'analytics',
      categories: ['analytics', 'pricing', 'selling'],
      tags: ['price', 'spike', 'increase', 'sell', 'window', 'opportunity'],
    },
  },
  {
    name: 'price_trends',
    description:
      'Aggregate price trends by category and/or platform. Shows which categories are getting cheaper (good for sourcing) vs more expensive (good for selling).',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string' as const,
          description: 'Product category to filter by',
        },
        platform: {
          type: 'string' as const,
          description: 'Platform to filter by',
        },
        days: {
          type: 'number' as const,
          description: 'Number of days to analyze (default 30, max 365)',
        },
      },
    },
    metadata: {
      category: 'analytics',
      categories: ['analytics', 'pricing'],
      tags: ['price', 'trend', 'category', 'market', 'direction'],
    },
  },
  {
    name: 'buy_opportunities',
    description:
      'Ranked list of best buying opportunities based on price position (closeness to all-time low), recent drops, downtrend strength, and price stability. Score 0-100.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platforms: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Filter by platforms',
        },
        categories: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Filter by product categories',
        },
        min_data_points: {
          type: 'number' as const,
          description: 'Minimum price snapshots required (default 5)',
        },
        limit: {
          type: 'number' as const,
          description: 'Maximum results (default 50)',
        },
      },
    },
    metadata: {
      category: 'analytics',
      categories: ['analytics', 'pricing', 'sourcing'],
      tags: ['buy', 'opportunity', 'deal', 'score', 'rank', 'sourcing'],
    },
  },
  {
    name: 'sell_opportunities',
    description:
      'Ranked list of best selling opportunities based on price position (closeness to all-time high), recent spikes, uptrend strength, and demand. Score 0-100.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platforms: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Filter by platforms',
        },
        categories: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Filter by product categories',
        },
        min_data_points: {
          type: 'number' as const,
          description: 'Minimum price snapshots required (default 5)',
        },
        limit: {
          type: 'number' as const,
          description: 'Maximum results (default 50)',
        },
      },
    },
    metadata: {
      category: 'analytics',
      categories: ['analytics', 'pricing', 'selling'],
      tags: ['sell', 'opportunity', 'score', 'rank', 'listing', 'profit'],
    },
  },
  {
    name: 'price_distribution',
    description:
      'Price histogram for a product: 10 equal-width buckets showing where prices cluster. Helps visualize normal vs outlier pricing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: {
          type: 'string' as const,
          description: 'Product ID to analyze',
        },
      },
      required: ['product_id'] as const,
    },
    metadata: {
      category: 'analytics',
      categories: ['analytics', 'pricing'],
      tags: ['price', 'distribution', 'histogram', 'range', 'bucket'],
    },
  },
  {
    name: 'price_compare_platforms',
    description:
      'Cross-platform price comparison for a product. Shows current price, average, trend per platform and identifies cheapest/most expensive platforms with spread.',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: {
          type: 'string' as const,
          description: 'Product ID to compare across platforms',
        },
      },
      required: ['product_id'] as const,
    },
    metadata: {
      category: 'analytics',
      categories: ['analytics', 'pricing', 'arbitrage'],
      tags: ['price', 'compare', 'platform', 'cross-platform', 'arbitrage', 'spread'],
    },
  },
];

// =============================================================================
// Tool Handler
// =============================================================================

/**
 * Handle price intelligence tool invocations from the agent.
 */
export function handlePriceIntelligenceTool(
  name: string,
  input: Record<string, unknown>,
  context: { db: Database },
): unknown {
  const { db } = context;

  try {
    switch (name) {
      // ── price_history_analyze ──────────────────────────────────────
      case 'price_history_analyze': {
        const productId = input.product_id as string | undefined;
        if (!productId?.trim()) {
          return { status: 'error', message: 'product_id is required' };
        }

        const days = Number.isFinite(input.days) ? (input.days as number) : 90;
        const result = analyzePriceHistory(db, productId.trim(), days);

        if (!result) {
          return {
            status: 'ok',
            message: 'No price history data found for this product',
            productId,
          };
        }

        return {
          status: 'ok',
          data: {
            ...result,
            analyzedAt: new Date(result.analyzedAt).toISOString(),
          },
        };
      }

      // ── price_drops_detect ────────────────────────────────────────
      case 'price_drops_detect': {
        const drops = detectPriceDrops(db, {
          minDropPct: Number.isFinite(input.min_drop_pct) ? (input.min_drop_pct as number) : undefined,
          maxDaysBack: Number.isFinite(input.max_days_back) ? (input.max_days_back as number) : undefined,
          platforms: Array.isArray(input.platforms) ? (input.platforms as string[]) : undefined,
          categories: Array.isArray(input.categories) ? (input.categories as string[]) : undefined,
          limit: Number.isFinite(input.limit) ? (input.limit as number) : undefined,
        });

        return {
          status: 'ok',
          count: drops.length,
          data: drops.map((d) => ({
            ...d,
            droppedSince: new Date(d.droppedSince).toISOString(),
          })),
        };
      }

      // ── price_spikes_detect ───────────────────────────────────────
      case 'price_spikes_detect': {
        const spikes = detectPriceSpikes(db, {
          minSpikePct: Number.isFinite(input.min_spike_pct) ? (input.min_spike_pct as number) : undefined,
          maxDaysBack: Number.isFinite(input.max_days_back) ? (input.max_days_back as number) : undefined,
          platforms: Array.isArray(input.platforms) ? (input.platforms as string[]) : undefined,
          categories: Array.isArray(input.categories) ? (input.categories as string[]) : undefined,
          limit: Number.isFinite(input.limit) ? (input.limit as number) : undefined,
        });

        return {
          status: 'ok',
          count: spikes.length,
          data: spikes.map((s) => ({
            ...s,
            spikedSince: new Date(s.spikedSince).toISOString(),
          })),
        };
      }

      // ── price_trends ──────────────────────────────────────────────
      case 'price_trends': {
        const category = typeof input.category === 'string' ? input.category : undefined;
        const platform = typeof input.platform === 'string' ? input.platform : undefined;
        const days = Number.isFinite(input.days) ? (input.days as number) : 30;

        const trends = getPriceTrends(db, category, platform, days);

        return {
          status: 'ok',
          count: trends.length,
          data: trends,
        };
      }

      // ── buy_opportunities ─────────────────────────────────────────
      case 'buy_opportunities': {
        const opportunities = findBuyOpportunities(db, {
          platforms: Array.isArray(input.platforms) ? (input.platforms as string[]) : undefined,
          categories: Array.isArray(input.categories) ? (input.categories as string[]) : undefined,
          minDataPoints: Number.isFinite(input.min_data_points) ? (input.min_data_points as number) : undefined,
          limit: Number.isFinite(input.limit) ? (input.limit as number) : undefined,
        });

        return {
          status: 'ok',
          count: opportunities.length,
          data: opportunities,
        };
      }

      // ── sell_opportunities ────────────────────────────────────────
      case 'sell_opportunities': {
        const opportunities = findSellOpportunities(db, {
          platforms: Array.isArray(input.platforms) ? (input.platforms as string[]) : undefined,
          categories: Array.isArray(input.categories) ? (input.categories as string[]) : undefined,
          minDataPoints: Number.isFinite(input.min_data_points) ? (input.min_data_points as number) : undefined,
          limit: Number.isFinite(input.limit) ? (input.limit as number) : undefined,
        });

        return {
          status: 'ok',
          count: opportunities.length,
          data: opportunities,
        };
      }

      // ── price_distribution ────────────────────────────────────────
      case 'price_distribution': {
        const productId = input.product_id as string | undefined;
        if (!productId?.trim()) {
          return { status: 'error', message: 'product_id is required' };
        }

        const result = getPriceDistribution(db, productId.trim());

        if (!result) {
          return {
            status: 'ok',
            message: 'No price data found for this product',
            productId,
          };
        }

        return { status: 'ok', data: result };
      }

      // ── price_compare_platforms ───────────────────────────────────
      case 'price_compare_platforms': {
        const productId = input.product_id as string | undefined;
        if (!productId?.trim()) {
          return { status: 'error', message: 'product_id is required' };
        }

        const result = comparePlatformPrices(db, productId.trim());

        if (!result) {
          return {
            status: 'ok',
            message: 'No cross-platform price data found for this product',
            productId,
          };
        }

        return {
          status: 'ok',
          data: {
            ...result,
            platforms: result.platforms.map((p) => ({
              ...p,
              lastUpdated: new Date(p.lastUpdated).toISOString(),
            })),
          },
        };
      }

      default:
        return { status: 'error', message: `Unknown price intelligence tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'error', message: `Price intelligence tool failed: ${message}` };
  }
}
