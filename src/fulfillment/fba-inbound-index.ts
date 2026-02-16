/**
 * FBA Inbound Tool Definitions & Handler
 *
 * Standalone module exporting Anthropic-style tool definitions and a handler
 * function for FBA inbound shipment management. Wire into agents/index.ts as needed.
 */

import type { Database } from '../db/index.js';
import type { SpApiAuthConfig } from '../platforms/amazon/sp-auth.js';
import {
  ensureInboundTables,
  createInboundPlan,
  createInboundShipment,
  getInboundShipmentStatus,
  generateBoxLabels,
  estimateInboundFees,
  listInboundShipments,
} from './fba-inbound.js';
import type { Carrier, ItemCondition } from './fba-inbound-types.js';

// ---------------------------------------------------------------------------
// Tool definitions (Anthropic tool_use schema)
// ---------------------------------------------------------------------------

export const fbaInboundTools = [
  {
    name: 'plan_fba_shipment',
    description: 'Plan an FBA inbound shipment with items to send to Amazon warehouse',
    input_schema: {
      type: 'object' as const,
      properties: {
        items: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              sku: { type: 'string' as const },
              asin: { type: 'string' as const },
              quantity: { type: 'number' as const },
              condition: {
                type: 'string' as const,
                enum: ['new', 'refurbished', 'used_like_new', 'used_good'] as const,
                default: 'new',
              },
            },
            required: ['sku', 'quantity'],
          },
        },
        ship_from_zip: { type: 'string' as const, description: 'Origin ZIP code' },
        ship_from_country: { type: 'string' as const, default: 'US' },
      },
      required: ['items'],
    },
  },
  {
    name: 'create_fba_shipment',
    description: 'Create and confirm an FBA inbound shipment from a plan',
    input_schema: {
      type: 'object' as const,
      properties: {
        plan_id: { type: 'string' as const, description: 'Inbound plan ID' },
        packing_option: { type: 'string' as const, description: 'Packing option ID (from plan)' },
        carrier: {
          type: 'string' as const,
          enum: ['ups', 'fedex', 'usps', 'amazon_partnered'] as const,
          default: 'amazon_partnered',
        },
      },
      required: ['plan_id'],
    },
  },
  {
    name: 'check_fba_shipment',
    description: 'Check status of an FBA inbound shipment',
    input_schema: {
      type: 'object' as const,
      properties: {
        shipment_id: { type: 'string' as const },
      },
      required: ['shipment_id'],
    },
  },
  {
    name: 'list_fba_shipments',
    description: 'List all FBA inbound shipments',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string' as const,
          enum: ['planning', 'ready', 'shipped', 'receiving', 'received', 'all'] as const,
          default: 'all',
        },
        limit: { type: 'number' as const, default: 20 },
      },
    },
  },
  {
    name: 'estimate_fba_fees',
    description: 'Estimate FBA prep, labeling, and inbound shipping fees',
    input_schema: {
      type: 'object' as const,
      properties: {
        items: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              asin: { type: 'string' as const },
              quantity: { type: 'number' as const },
              weight_oz: { type: 'number' as const },
              is_oversize: { type: 'boolean' as const, default: false },
            },
          },
        },
        ship_from_zip: { type: 'string' as const },
      },
      required: ['items'],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface FbaInboundToolInput {
  // plan_fba_shipment
  items?: Array<{
    sku?: string;
    asin?: string;
    quantity?: number;
    condition?: string;
    weight_oz?: number;
    is_oversize?: boolean;
  }>;
  ship_from_zip?: string;
  ship_from_country?: string;

  // create_fba_shipment
  plan_id?: string;
  packing_option?: string;
  carrier?: string;

  // check_fba_shipment
  shipment_id?: string;

  // list_fba_shipments
  status?: string;
  limit?: number;
}

/**
 * Handle an FBA inbound tool call. Ensures the inbound tables exist, then
 * dispatches to the appropriate function.
 *
 * @param spConfig - Required for SP-API calls (create_fba_shipment, check_fba_shipment).
 *                   Can be null for local-only operations (plan, list, estimate).
 * @returns A JSON-serialisable result object.
 */
export async function handleFbaInboundTool(
  db: Database,
  toolName: string,
  input: FbaInboundToolInput,
  spConfig?: SpApiAuthConfig | null,
): Promise<unknown> {
  // Ensure schema on first call
  ensureInboundTables(db);

  switch (toolName) {
    case 'plan_fba_shipment': {
      if (!input.items || input.items.length === 0) {
        return { error: 'items array is required and must not be empty' };
      }

      const planItems = input.items
        .filter(item => item.sku && item.quantity != null)
        .map(item => ({
          sku: item.sku!,
          asin: item.asin,
          quantity: item.quantity!,
          condition: (item.condition as ItemCondition) ?? 'new',
        }));

      if (planItems.length === 0) {
        return { error: 'No valid items provided (each needs sku and quantity)' };
      }

      const plan = createInboundPlan(db, {
        items: planItems,
        shipFromZip: input.ship_from_zip,
        shipFromCountry: input.ship_from_country,
      });

      return {
        success: true,
        plan: {
          planId: plan.planId,
          itemCount: plan.items.length,
          totalUnits: plan.totalUnits,
          boxCount: plan.boxCount,
          estimatedWeightLbs: plan.estimatedWeightLbs,
          estimatedShippingCost: plan.estimatedShippingCost,
          status: plan.status,
          items: plan.items.map(i => ({
            sku: i.sku,
            asin: i.asin,
            quantity: i.quantity,
            condition: i.condition,
          })),
        },
      };
    }

    case 'create_fba_shipment': {
      if (!input.plan_id) {
        return { error: 'plan_id is required' };
      }
      if (!spConfig) {
        return { error: 'Amazon SP-API credentials are required to create FBA shipments' };
      }

      const shipment = await createInboundShipment(spConfig, db, {
        planId: input.plan_id,
        packingOption: input.packing_option,
        carrier: (input.carrier as Carrier) ?? 'amazon_partnered',
      });

      if (!shipment) {
        return { error: `Plan ${input.plan_id} not found` };
      }

      return {
        success: true,
        shipment: {
          id: shipment.id,
          planId: shipment.planId,
          status: shipment.status,
          destinationFc: shipment.destinationFc,
          carrier: shipment.carrier,
          itemCount: shipment.itemCount,
          totalUnits: shipment.totalUnits,
          boxCount: shipment.boxCount,
          weightLbs: shipment.weightLbs,
        },
      };
    }

    case 'check_fba_shipment': {
      if (!input.shipment_id) {
        return { error: 'shipment_id is required' };
      }

      if (spConfig) {
        // Try SP-API first for live status
        const shipment = await getInboundShipmentStatus(spConfig, db, input.shipment_id);
        if (!shipment) {
          return { error: `Shipment ${input.shipment_id} not found` };
        }
        return {
          success: true,
          shipment: {
            id: shipment.id,
            planId: shipment.planId,
            status: shipment.status,
            destinationFc: shipment.destinationFc,
            trackingNumber: shipment.trackingNumber,
            carrier: shipment.carrier,
            itemCount: shipment.itemCount,
            totalUnits: shipment.totalUnits,
            boxCount: shipment.boxCount,
            weightLbs: shipment.weightLbs,
            createdAt: shipment.createdAt.toISOString(),
            shippedAt: shipment.shippedAt?.toISOString() ?? null,
            receivedAt: shipment.receivedAt?.toISOString() ?? null,
          },
        };
      }

      // Fall back to local data
      const shipments = listInboundShipments(db, { limit: 100 });
      const found = shipments.find(s => s.id === input.shipment_id || s.planId === input.shipment_id);
      if (!found) {
        return { error: `Shipment ${input.shipment_id} not found` };
      }
      return {
        success: true,
        shipment: {
          id: found.id,
          planId: found.planId,
          status: found.status,
          destinationFc: found.destinationFc,
          trackingNumber: found.trackingNumber,
          carrier: found.carrier,
          itemCount: found.itemCount,
          totalUnits: found.totalUnits,
          boxCount: found.boxCount,
          weightLbs: found.weightLbs,
          createdAt: found.createdAt.toISOString(),
          shippedAt: found.shippedAt?.toISOString() ?? null,
          receivedAt: found.receivedAt?.toISOString() ?? null,
        },
        note: 'Status from local database only (no SP-API credentials provided)',
      };
    }

    case 'list_fba_shipments': {
      const shipments = listInboundShipments(db, {
        status: input.status,
        limit: input.limit,
      });

      return {
        success: true,
        count: shipments.length,
        shipments: shipments.map(s => ({
          id: s.id,
          planId: s.planId,
          status: s.status,
          destinationFc: s.destinationFc,
          carrier: s.carrier,
          itemCount: s.itemCount,
          totalUnits: s.totalUnits,
          boxCount: s.boxCount,
          weightLbs: s.weightLbs,
          trackingNumber: s.trackingNumber,
          createdAt: s.createdAt.toISOString(),
          shippedAt: s.shippedAt?.toISOString() ?? null,
          receivedAt: s.receivedAt?.toISOString() ?? null,
        })),
      };
    }

    case 'estimate_fba_fees': {
      if (!input.items || input.items.length === 0) {
        return { error: 'items array is required and must not be empty' };
      }

      const feeItems = input.items.map(item => ({
        asin: item.asin,
        quantity: item.quantity ?? 1,
        weightOz: item.weight_oz,
        isOversize: item.is_oversize ?? false,
      }));

      const estimate = estimateInboundFees({
        items: feeItems,
        shipFromZip: input.ship_from_zip,
      });

      return {
        success: true,
        estimate: {
          items: estimate.items.map(i => ({
            asin: i.asin,
            quantity: i.quantity,
            prepFee: i.prepFee,
            labelingFee: i.labelingFee,
            inboundShippingFee: i.inboundShippingFee,
            totalFee: i.totalFee,
          })),
          totalPrepFees: estimate.totalPrepFees,
          totalLabelingFees: estimate.totalLabelingFees,
          totalShippingFees: estimate.totalShippingFees,
          grandTotal: estimate.grandTotal,
        },
      };
    }

    default:
      return { error: `Unknown FBA inbound tool: ${toolName}` };
  }
}
