/**
 * Shipping Module - Rate caching and estimation tools
 *
 * Exports tool definitions for the agent system and handler functions
 * for shipping rate estimation and comparison.
 */

import type { Database } from '../db/index';
import type { Carrier } from './types';
import {
  getCachedRate,
  cacheRate,
  estimateShippingRate,
  getShippingEstimate,
} from './rate-cache';

export { getCachedRate, cacheRate, estimateShippingRate, getShippingEstimate } from './rate-cache';
export type { ShippingRateParams, ShippingRate, Carrier, CarrierService, CachedShippingRate } from './types';

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const shippingTools = [
  {
    name: 'estimate_shipping',
    description: 'Estimate shipping cost for a package',
    input_schema: {
      type: 'object' as const,
      properties: {
        origin_zip: { type: 'string' as const, description: 'Origin ZIP code' },
        dest_zip: { type: 'string' as const, description: 'Destination ZIP code' },
        weight_oz: { type: 'number' as const, description: 'Weight in ounces' },
        length: { type: 'number' as const, description: 'Length in inches' },
        width: { type: 'number' as const, description: 'Width in inches' },
        height: { type: 'number' as const, description: 'Height in inches' },
        carrier: {
          type: 'string' as const,
          enum: ['usps', 'ups', 'fedex', 'amazon', 'any'],
          description: 'Carrier to estimate for (default: any)',
        },
      },
      required: ['weight_oz'] as const,
    },
  },
  {
    name: 'compare_shipping_rates',
    description: 'Compare shipping rates across carriers for a package',
    input_schema: {
      type: 'object' as const,
      properties: {
        origin_zip: { type: 'string' as const, description: 'Origin ZIP code (default: 10001)' },
        dest_zip: { type: 'string' as const, description: 'Destination ZIP code' },
        weight_oz: { type: 'number' as const, description: 'Weight in ounces' },
        length: { type: 'number' as const, description: 'Length in inches' },
        width: { type: 'number' as const, description: 'Width in inches' },
        height: { type: 'number' as const, description: 'Height in inches' },
      },
      required: ['dest_zip', 'weight_oz'] as const,
    },
  },
];

// =============================================================================
// TOOL HANDLER
// =============================================================================

/**
 * Handle shipping tool invocations.
 *
 * @param toolName - The name of the tool being called
 * @param input - The tool input parameters
 * @param db - Database instance
 */
export function handleShippingTool(
  toolName: string,
  input: Record<string, unknown>,
  db: Database,
): unknown {
  switch (toolName) {
    case 'estimate_shipping': {
      const weightOz = Number(input.weight_oz);
      if (!Number.isFinite(weightOz) || weightOz <= 0) {
        return { error: 'weight_oz must be a positive number' };
      }

      const originZip = (input.origin_zip as string) ?? '10001';
      const destZip = (input.dest_zip as string) ?? undefined;
      const lengthIn = input.length != null ? Number(input.length) : undefined;
      const widthIn = input.width != null ? Number(input.width) : undefined;
      const heightIn = input.height != null ? Number(input.height) : undefined;
      const carrier = (input.carrier as Carrier | 'any') ?? 'any';

      // Validate dimensions if provided
      if (lengthIn != null && (!Number.isFinite(lengthIn) || lengthIn <= 0)) {
        return { error: 'length must be a positive number' };
      }
      if (widthIn != null && (!Number.isFinite(widthIn) || widthIn <= 0)) {
        return { error: 'width must be a positive number' };
      }
      if (heightIn != null && (!Number.isFinite(heightIn) || heightIn <= 0)) {
        return { error: 'height must be a positive number' };
      }

      const params = {
        originZip,
        destZip,
        weightOz,
        lengthIn,
        widthIn,
        heightIn,
        carrier,
      };

      const rates = getShippingEstimate(db, params);

      if (rates.length === 0) {
        return {
          message: 'No shipping rates available for this package configuration',
          params: { originZip, destZip, weightOz, carrier },
        };
      }

      const cheapest = rates[0];

      return {
        cheapest: {
          carrier: cheapest.carrier,
          service: cheapest.service,
          rateDollars: centsToDollars(cheapest.rateCents),
          estimatedDays: cheapest.estimatedDays,
          source: cheapest.source,
        },
        allRates: rates.map((r) => ({
          carrier: r.carrier,
          service: r.service,
          rateDollars: centsToDollars(r.rateCents),
          estimatedDays: r.estimatedDays,
          source: r.source,
        })),
        params: {
          originZip,
          destZip: destZip ?? '(not specified)',
          weightOz,
          weightLbs: round2(weightOz / 16),
          carrier,
        },
      };
    }

    case 'compare_shipping_rates': {
      const weightOz = Number(input.weight_oz);
      if (!Number.isFinite(weightOz) || weightOz <= 0) {
        return { error: 'weight_oz must be a positive number' };
      }

      const destZip = input.dest_zip as string;
      if (!destZip) {
        return { error: 'dest_zip is required' };
      }

      const originZip = (input.origin_zip as string) ?? '10001';
      const lengthIn = input.length != null ? Number(input.length) : undefined;
      const widthIn = input.width != null ? Number(input.width) : undefined;
      const heightIn = input.height != null ? Number(input.height) : undefined;

      const params = {
        originZip,
        destZip,
        weightOz,
        lengthIn,
        widthIn,
        heightIn,
        carrier: 'any' as const,
      };

      const rates = getShippingEstimate(db, params);

      // Group by carrier
      const byCarrier: Record<string, Array<{ service: string; rateDollars: string; estimatedDays: number | null }>> = {};
      for (const rate of rates) {
        if (!byCarrier[rate.carrier]) {
          byCarrier[rate.carrier] = [];
        }
        byCarrier[rate.carrier].push({
          service: rate.service,
          rateDollars: centsToDollars(rate.rateCents),
          estimatedDays: rate.estimatedDays,
        });
      }

      // Find cheapest per carrier
      const cheapestPerCarrier: Array<{
        carrier: string;
        cheapestService: string;
        rateDollars: string;
        estimatedDays: number | null;
      }> = [];

      for (const [carrier, services] of Object.entries(byCarrier)) {
        if (services.length > 0) {
          const cheapest = services[0]; // already sorted by rate
          cheapestPerCarrier.push({
            carrier,
            cheapestService: cheapest.service,
            rateDollars: cheapest.rateDollars,
            estimatedDays: cheapest.estimatedDays,
          });
        }
      }

      // Sort cheapest-per-carrier by rate
      cheapestPerCarrier.sort((a, b) => parseFloat(a.rateDollars) - parseFloat(b.rateDollars));

      return {
        summary: cheapestPerCarrier,
        details: byCarrier,
        totalOptions: rates.length,
        package: {
          originZip,
          destZip,
          weightOz,
          weightLbs: round2(weightOz / 16),
          dimensions: lengthIn && widthIn && heightIn
            ? `${lengthIn}" x ${widthIn}" x ${heightIn}"`
            : '(not specified)',
        },
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
