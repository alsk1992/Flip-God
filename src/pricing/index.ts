/**
 * Pricing Module - A/B Price Testing & Dynamic Pricing
 *
 * Exports tool definitions and a handler function for wiring into the agent.
 */

import type { Database } from '../db/index.js';
import {
  createPriceTest,
  getPriceTestResults,
  endPriceTest,
  listPriceTests,
  recordTestImpression,
  recordTestSale,
  expireFinishedTests,
} from './ab-testing.js';
import {
  calculateDynamicPrice,
  setDynamicPricingStrategy,
  getDynamicPriceHistory,
  getDynamicPricingConfig,
} from './dynamic-pricer.js';
import type {
  DynamicPricingStrategy,
  DynamicPricingParams,
  TestStatus,
  TestVariant,
  TestWinner,
} from './types.js';

// =============================================================================
// Tool Definitions
// =============================================================================

export const pricingTools = [
  {
    name: 'create_price_test',
    description: 'Create an A/B price test for a listing',
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_id: { type: 'string' as const },
        price_a: { type: 'number' as const, description: 'Control price' },
        price_b: { type: 'number' as const, description: 'Test price' },
        duration_days: { type: 'number' as const, description: 'How many days to run the test (default 7)' },
        max_impressions: { type: 'number' as const, description: 'Max impressions before auto-closing' },
      },
      required: ['listing_id', 'price_a', 'price_b'],
    },
  },
  {
    name: 'price_test_results',
    description: 'Get A/B price test results with statistical analysis',
    input_schema: {
      type: 'object' as const,
      properties: {
        test_id: { type: 'string' as const },
      },
      required: ['test_id'],
    },
  },
  {
    name: 'end_price_test',
    description: 'End an active price test, optionally specifying the winner',
    input_schema: {
      type: 'object' as const,
      properties: {
        test_id: { type: 'string' as const },
        winner: { type: 'string' as const, enum: ['A', 'B', 'inconclusive'], description: 'Override winner (auto-determined if omitted)' },
      },
      required: ['test_id'],
    },
  },
  {
    name: 'list_price_tests',
    description: 'List all price tests (active and completed)',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string' as const, enum: ['active', 'completed', 'all'], description: 'Filter by status (default all)' },
      },
    },
  },
  {
    name: 'record_test_impression',
    description: 'Record a view/impression for a price test variant',
    input_schema: {
      type: 'object' as const,
      properties: {
        test_id: { type: 'string' as const },
        variant: { type: 'string' as const, enum: ['A', 'B'] },
      },
      required: ['test_id', 'variant'],
    },
  },
  {
    name: 'record_test_sale',
    description: 'Record a sale for a price test variant',
    input_schema: {
      type: 'object' as const,
      properties: {
        test_id: { type: 'string' as const },
        variant: { type: 'string' as const, enum: ['A', 'B'] },
        price: { type: 'number' as const },
      },
      required: ['test_id', 'variant', 'price'],
    },
  },
  {
    name: 'set_dynamic_pricing',
    description: 'Enable dynamic pricing strategy for a listing',
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_id: { type: 'string' as const },
        strategy: {
          type: 'string' as const,
          enum: ['demand_based', 'time_decay', 'competition_reactive', 'inventory_pressure'],
        },
        params: {
          type: 'object' as const,
          description: 'Strategy-specific parameters (min_price, max_price, decay_rate, etc.)',
        },
        min_price: { type: 'number' as const },
        max_price: { type: 'number' as const },
      },
      required: ['listing_id', 'strategy'],
    },
  },
  {
    name: 'calculate_dynamic_price',
    description: 'Run dynamic pricing calculation for a listing (does not auto-apply)',
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_id: { type: 'string' as const },
      },
      required: ['listing_id'],
    },
  },
  {
    name: 'dynamic_price_history',
    description: 'View dynamic pricing change history for a listing',
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_id: { type: 'string' as const },
        days: { type: 'number' as const, description: 'Number of days of history (default 30)' },
      },
      required: ['listing_id'],
    },
  },
] as const;

// =============================================================================
// Tool Handler
// =============================================================================

export interface PricingToolInput {
  listing_id?: string;
  test_id?: string;
  price_a?: number;
  price_b?: number;
  duration_days?: number;
  max_impressions?: number;
  status?: string;
  winner?: string;
  variant?: string;
  price?: number;
  strategy?: string;
  params?: Record<string, unknown>;
  min_price?: number;
  max_price?: number;
  days?: number;
}

/**
 * Handle pricing tool calls.
 */
export function handlePricingTool(
  db: Database,
  toolName: string,
  input: PricingToolInput,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'create_price_test': {
        if (!input.listing_id) return { success: false, error: 'listing_id is required' };
        if (!Number.isFinite(input.price_a) || !Number.isFinite(input.price_b)) {
          return { success: false, error: 'price_a and price_b must be valid numbers' };
        }

        const test = createPriceTest(db, {
          listingId: input.listing_id,
          priceA: input.price_a!,
          priceB: input.price_b!,
          durationDays: input.duration_days,
          maxImpressions: input.max_impressions,
        });

        return { success: true, data: test };
      }

      case 'price_test_results': {
        if (!input.test_id) return { success: false, error: 'test_id is required' };
        const results = getPriceTestResults(db, input.test_id);
        if (!results) return { success: false, error: 'Price test not found' };
        return { success: true, data: results };
      }

      case 'end_price_test': {
        if (!input.test_id) return { success: false, error: 'test_id is required' };
        const ended = endPriceTest(db, input.test_id, input.winner as TestWinner | undefined);
        if (!ended) return { success: false, error: 'Price test not found' };
        return { success: true, data: ended };
      }

      case 'list_price_tests': {
        const tests = listPriceTests(db, undefined, (input.status as TestStatus | 'all') ?? 'all');
        return { success: true, data: tests };
      }

      case 'record_test_impression': {
        if (!input.test_id) return { success: false, error: 'test_id is required' };
        if (!input.variant || (input.variant !== 'A' && input.variant !== 'B')) {
          return { success: false, error: 'variant must be A or B' };
        }
        recordTestImpression(db, input.test_id, input.variant as TestVariant);
        return { success: true, data: { recorded: true } };
      }

      case 'record_test_sale': {
        if (!input.test_id) return { success: false, error: 'test_id is required' };
        if (!input.variant || (input.variant !== 'A' && input.variant !== 'B')) {
          return { success: false, error: 'variant must be A or B' };
        }
        if (!Number.isFinite(input.price)) return { success: false, error: 'price must be a valid number' };
        recordTestSale(db, input.test_id, input.variant as TestVariant, input.price!);
        return { success: true, data: { recorded: true } };
      }

      case 'set_dynamic_pricing': {
        if (!input.listing_id) return { success: false, error: 'listing_id is required' };
        if (!input.strategy) return { success: false, error: 'strategy is required' };

        const config = setDynamicPricingStrategy(
          db,
          input.listing_id,
          input.strategy as DynamicPricingStrategy,
          input.params as DynamicPricingParams | undefined,
          input.min_price,
          input.max_price,
        );
        return { success: true, data: config };
      }

      case 'calculate_dynamic_price': {
        if (!input.listing_id) return { success: false, error: 'listing_id is required' };
        const result = calculateDynamicPrice(db, input.listing_id);
        return { success: true, data: result };
      }

      case 'dynamic_price_history': {
        if (!input.listing_id) return { success: false, error: 'listing_id is required' };
        const history = getDynamicPriceHistory(db, input.listing_id, input.days ?? 30);
        return { success: true, data: history };
      }

      default:
        return { success: false, error: `Unknown pricing tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// Re-export core functions for direct usage
export {
  createPriceTest,
  getPriceTestResults,
  endPriceTest,
  listPriceTests,
  recordTestImpression,
  recordTestSale,
  expireFinishedTests,
} from './ab-testing.js';

export {
  calculateDynamicPrice,
  setDynamicPricingStrategy,
  getDynamicPriceHistory,
  getDynamicPricingConfig,
} from './dynamic-pricer.js';

export type {
  PriceTest,
  PriceTestResults,
  CreatePriceTestParams,
  TestStatus,
  TestVariant,
  TestWinner,
  DynamicPricingStrategy,
  DynamicPricingParams,
  DynamicPricingConfig,
  DynamicPriceChange,
  DynamicPriceContext,
} from './types.js';
