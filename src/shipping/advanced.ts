/**
 * Advanced Shipping Module
 *
 * Batch label creation, auto carrier selection, delivery estimation,
 * cross-carrier cost comparison, shipping rules management, and
 * international shipping with customs/duties calculations.
 */

import type { Database } from '../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ShipCarrier = 'usps' | 'ups' | 'fedex' | 'dhl';

export interface BatchLabelResult {
  orderId: string;
  labelId: string;
  trackingNumber: string;
  carrier: ShipCarrier;
  rateCents: number;
  status: 'created' | 'error';
  error?: string;
}

export interface CarrierSelection {
  carrier: ShipCarrier;
  service: string;
  rateCents: number;
  estimatedDays: number;
  reason: string;
}

export interface DeliveryEstimate {
  carrier: ShipCarrier;
  service: string;
  estimatedDeliveryDate: string;
  businessDays: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface ShippingCostEntry {
  carrier: ShipCarrier;
  service: string;
  rateCents: number;
  estimatedDays: number;
  features: string[];
}

export interface ShippingRule {
  id: string;
  name: string;
  ruleType: 'free_shipping_threshold' | 'carrier_preference' | 'weight_surcharge' | 'region_override' | 'flat_rate';
  config: Record<string, unknown>;
  enabled: boolean;
  priority: number;
  createdAt: string;
}

export interface InternationalShippingEstimate {
  carrier: ShipCarrier;
  service: string;
  shippingCost: number;
  estimatedDuties: number;
  estimatedTaxes: number;
  totalLandedCost: number;
  estimatedDays: number;
  restrictionsApply: boolean;
  restrictions: string[];
}

// ---------------------------------------------------------------------------
// Carrier Rate Tables (built-in estimates)
// ---------------------------------------------------------------------------

interface RateEntry {
  service: string;
  maxWeightOz: number;
  baseRateCents: number;
  perOzCents: number;
  estimatedDays: number;
  features: string[];
  domestic: boolean;
  international: boolean;
}

const CARRIER_RATES: Record<ShipCarrier, RateEntry[]> = {
  usps: [
    { service: 'First Class', maxWeightOz: 13 * 16, baseRateCents: 350, perOzCents: 5, estimatedDays: 5, features: ['tracking'], domestic: true, international: false },
    { service: 'Priority Mail', maxWeightOz: 70 * 16, baseRateCents: 795, perOzCents: 8, estimatedDays: 3, features: ['tracking', 'insurance_50'], domestic: true, international: false },
    { service: 'Priority Mail Express', maxWeightOz: 70 * 16, baseRateCents: 2695, perOzCents: 12, estimatedDays: 1, features: ['tracking', 'insurance_100', 'overnight'], domestic: true, international: false },
    { service: 'Priority Mail International', maxWeightOz: 70 * 16, baseRateCents: 2995, perOzCents: 15, estimatedDays: 10, features: ['tracking', 'insurance_200'], domestic: false, international: true },
    { service: 'First Class Intl', maxWeightOz: 4 * 16, baseRateCents: 1395, perOzCents: 10, estimatedDays: 15, features: ['tracking'], domestic: false, international: true },
  ],
  ups: [
    { service: 'Ground', maxWeightOz: 150 * 16, baseRateCents: 895, perOzCents: 6, estimatedDays: 5, features: ['tracking', 'insurance_100'], domestic: true, international: false },
    { service: '3 Day Select', maxWeightOz: 150 * 16, baseRateCents: 1495, perOzCents: 10, estimatedDays: 3, features: ['tracking', 'insurance_100'], domestic: true, international: false },
    { service: '2nd Day Air', maxWeightOz: 150 * 16, baseRateCents: 2295, perOzCents: 14, estimatedDays: 2, features: ['tracking', 'insurance_100'], domestic: true, international: false },
    { service: 'Next Day Air', maxWeightOz: 150 * 16, baseRateCents: 3995, perOzCents: 20, estimatedDays: 1, features: ['tracking', 'insurance_100', 'overnight'], domestic: true, international: false },
    { service: 'Worldwide Express', maxWeightOz: 150 * 16, baseRateCents: 4995, perOzCents: 25, estimatedDays: 5, features: ['tracking', 'insurance_100'], domestic: false, international: true },
  ],
  fedex: [
    { service: 'Ground', maxWeightOz: 150 * 16, baseRateCents: 895, perOzCents: 6, estimatedDays: 5, features: ['tracking'], domestic: true, international: false },
    { service: 'Express Saver', maxWeightOz: 150 * 16, baseRateCents: 1595, perOzCents: 10, estimatedDays: 3, features: ['tracking', 'money_back'], domestic: true, international: false },
    { service: '2Day', maxWeightOz: 150 * 16, baseRateCents: 2195, perOzCents: 13, estimatedDays: 2, features: ['tracking', 'money_back'], domestic: true, international: false },
    { service: 'Overnight', maxWeightOz: 150 * 16, baseRateCents: 3795, perOzCents: 18, estimatedDays: 1, features: ['tracking', 'money_back', 'overnight'], domestic: true, international: false },
    { service: 'International Economy', maxWeightOz: 150 * 16, baseRateCents: 3995, perOzCents: 20, estimatedDays: 7, features: ['tracking'], domestic: false, international: true },
    { service: 'International Priority', maxWeightOz: 150 * 16, baseRateCents: 5995, perOzCents: 30, estimatedDays: 4, features: ['tracking', 'money_back'], domestic: false, international: true },
  ],
  dhl: [
    { service: 'eCommerce', maxWeightOz: 70 * 16, baseRateCents: 995, perOzCents: 7, estimatedDays: 7, features: ['tracking'], domestic: true, international: false },
    { service: 'Express Worldwide', maxWeightOz: 150 * 16, baseRateCents: 4495, perOzCents: 22, estimatedDays: 4, features: ['tracking', 'insurance_100'], domestic: false, international: true },
    { service: 'Express 12:00', maxWeightOz: 150 * 16, baseRateCents: 5995, perOzCents: 30, estimatedDays: 2, features: ['tracking', 'insurance_100', 'morning_delivery'], domestic: false, international: true },
  ],
};

// Zone-based surcharge multipliers (simplified domestic US zones)
function getZoneMultiplier(originZip: string, destZip: string): number {
  if (!originZip || !destZip) return 1.0;
  const originRegion = parseInt(originZip.charAt(0), 10);
  const destRegion = parseInt(destZip.charAt(0), 10);
  if (isNaN(originRegion) || isNaN(destRegion)) return 1.0;
  const distance = Math.abs(originRegion - destRegion);
  if (distance <= 1) return 1.0;   // Local/adjacent
  if (distance <= 3) return 1.15;  // Regional
  if (distance <= 5) return 1.3;   // Cross-country
  return 1.45;                      // Coast-to-coast
}

// Dimensional weight calculation
function getDimWeight(lengthIn: number, widthIn: number, heightIn: number, divisor: number = 139): number {
  return (lengthIn * widthIn * heightIn) / divisor;
}

function calculateRate(
  carrier: ShipCarrier,
  service: string,
  weightOz: number,
  originZip?: string,
  destZip?: string,
  lengthIn?: number,
  widthIn?: number,
  heightIn?: number,
): number {
  const entries = CARRIER_RATES[carrier];
  const entry = entries.find(e => e.service === service);
  if (!entry) return 0;

  // Use dimensional weight if larger
  let effectiveWeightOz = weightOz;
  if (lengthIn && widthIn && heightIn) {
    const dimWeightLbs = getDimWeight(lengthIn, widthIn, heightIn);
    const dimWeightOz = dimWeightLbs * 16;
    effectiveWeightOz = Math.max(weightOz, dimWeightOz);
  }

  const baseCost = entry.baseRateCents + (effectiveWeightOz * entry.perOzCents);
  const zoneMultiplier = (originZip && destZip) ? getZoneMultiplier(originZip, destZip) : 1.0;

  return Math.round(baseCost * zoneMultiplier);
}

function getAllRates(
  weightOz: number,
  originZip?: string,
  destZip?: string,
  lengthIn?: number,
  widthIn?: number,
  heightIn?: number,
  international: boolean = false,
): ShippingCostEntry[] {
  const results: ShippingCostEntry[] = [];

  for (const [carrier, entries] of Object.entries(CARRIER_RATES)) {
    for (const entry of entries) {
      if (international && !entry.international) continue;
      if (!international && !entry.domestic) continue;
      if (weightOz > entry.maxWeightOz) continue;

      const rateCents = calculateRate(
        carrier as ShipCarrier, entry.service, weightOz,
        originZip, destZip, lengthIn, widthIn, heightIn,
      );

      results.push({
        carrier: carrier as ShipCarrier,
        service: entry.service,
        rateCents,
        estimatedDays: entry.estimatedDays,
        features: entry.features,
      });
    }
  }

  results.sort((a, b) => a.rateCents - b.rateCents);
  return results;
}

// ---------------------------------------------------------------------------
// International Customs/Duties Estimation
// ---------------------------------------------------------------------------

// Simplified duty rate by HS code category
const DUTY_RATES: Record<string, number> = {
  electronics: 0.0,      // Most consumer electronics are duty-free
  clothing: 0.12,         // 12% average
  toys: 0.0,              // Most toys duty-free
  food: 0.05,             // 5% average
  cosmetics: 0.03,        // 3% average
  furniture: 0.035,       // 3.5% average
  auto_parts: 0.025,      // 2.5% average
  general: 0.05,          // 5% default
};

// VAT/GST rates by country
const TAX_RATES: Record<string, number> = {
  US: 0,       // No federal import tax, varies by state
  CA: 0.05,    // GST
  GB: 0.20,    // UK VAT
  DE: 0.19,    // Germany VAT
  FR: 0.20,    // France VAT
  AU: 0.10,    // Australia GST
  JP: 0.10,    // Japan consumption tax
  CN: 0.13,    // China VAT
  default: 0.10,
};

function estimateCustomsDuties(
  declaredValueUsd: number,
  category: string,
  destCountry: string,
): { duties: number; taxes: number; restrictions: string[] } {
  const dutyRate = DUTY_RATES[category] ?? DUTY_RATES['general'];
  const taxRate = TAX_RATES[destCountry] ?? TAX_RATES['default'];
  const restrictions: string[] = [];

  const duties = Math.round(declaredValueUsd * dutyRate * 100) / 100;
  const dutiableValue = declaredValueUsd + duties;
  const taxes = Math.round(dutiableValue * taxRate * 100) / 100;

  // De minimis thresholds
  if (destCountry === 'US' && declaredValueUsd <= 800) {
    return { duties: 0, taxes: 0, restrictions };
  }
  if (destCountry === 'CA' && declaredValueUsd <= 20) {
    return { duties: 0, taxes: 0, restrictions };
  }
  if (destCountry === 'AU' && declaredValueUsd <= 1000) {
    return { duties: 0, taxes: 0, restrictions };
  }

  // Common restrictions
  if (category === 'food') restrictions.push('May require FDA/CFIA import permits');
  if (category === 'cosmetics') restrictions.push('May require ingredient declaration');
  if (destCountry === 'AU') restrictions.push('Strict biosecurity - natural materials may be held');

  return { duties, taxes, restrictions };
}

// ---------------------------------------------------------------------------
// DB Setup
// ---------------------------------------------------------------------------

function ensureAdvancedShippingTables(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS shipping_labels (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      tracking_number TEXT NOT NULL,
      carrier TEXT NOT NULL,
      service TEXT NOT NULL DEFAULT '',
      rate_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'created',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS advanced_shipping_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rule_type TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      priority INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}



// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const advancedShippingTools = [
  {
    name: 'batch_create_labels',
    description: 'Create shipping labels in batch for multiple orders at once. Auto-selects cheapest carrier per order.',
    input_schema: {
      type: 'object' as const,
      properties: {
        orders: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              order_id: { type: 'string' as const },
              origin_zip: { type: 'string' as const },
              dest_zip: { type: 'string' as const },
              weight_oz: { type: 'number' as const },
              length: { type: 'number' as const },
              width: { type: 'number' as const },
              height: { type: 'number' as const },
            },
            required: ['order_id', 'dest_zip', 'weight_oz'] as const,
          },
          description: 'Array of orders to create labels for',
        },
        preferred_carrier: {
          type: 'string' as const,
          enum: ['usps', 'ups', 'fedex', 'dhl', 'cheapest'] as const,
          description: 'Preferred carrier or cheapest (default: cheapest)',
        },
      },
      required: ['orders'] as const,
    },
  },
  {
    name: 'auto_select_carrier',
    description: 'Auto-select the cheapest or fastest carrier based on package dimensions, weight, and destination',
    input_schema: {
      type: 'object' as const,
      properties: {
        origin_zip: { type: 'string' as const, description: 'Origin ZIP code' },
        dest_zip: { type: 'string' as const, description: 'Destination ZIP code' },
        weight_oz: { type: 'number' as const, description: 'Package weight in ounces' },
        length: { type: 'number' as const, description: 'Length in inches' },
        width: { type: 'number' as const, description: 'Width in inches' },
        height: { type: 'number' as const, description: 'Height in inches' },
        priority: {
          type: 'string' as const,
          enum: ['cheapest', 'fastest', 'balanced'] as const,
          description: 'Selection priority (default: cheapest)',
        },
        max_days: { type: 'number' as const, description: 'Max acceptable delivery days' },
      },
      required: ['dest_zip', 'weight_oz'] as const,
    },
  },
  {
    name: 'estimate_delivery_date',
    description: 'Estimate delivery date for a given carrier, origin, and destination',
    input_schema: {
      type: 'object' as const,
      properties: {
        carrier: { type: 'string' as const, enum: ['usps', 'ups', 'fedex', 'dhl'] as const },
        service: { type: 'string' as const, description: 'Service level (e.g. Ground, Priority Mail)' },
        origin_zip: { type: 'string' as const, description: 'Origin ZIP code' },
        dest_zip: { type: 'string' as const, description: 'Destination ZIP code' },
        ship_date: { type: 'string' as const, description: 'Ship date (YYYY-MM-DD, default: today)' },
      },
      required: ['carrier', 'service'] as const,
    },
  },
  {
    name: 'shipping_cost_comparison',
    description: 'Compare shipping costs across USPS, UPS, FedEx, and DHL for a package',
    input_schema: {
      type: 'object' as const,
      properties: {
        origin_zip: { type: 'string' as const, description: 'Origin ZIP code (default: 10001)' },
        dest_zip: { type: 'string' as const, description: 'Destination ZIP code' },
        weight_oz: { type: 'number' as const, description: 'Weight in ounces' },
        length: { type: 'number' as const, description: 'Length in inches' },
        width: { type: 'number' as const, description: 'Width in inches' },
        height: { type: 'number' as const, description: 'Height in inches' },
        international: { type: 'boolean' as const, description: 'International shipment (default: false)' },
      },
      required: ['dest_zip', 'weight_oz'] as const,
    },
  },
  {
    name: 'manage_shipping_rules',
    description: 'Create, read, update, or delete shipping rules (free shipping thresholds, carrier preferences, region overrides)',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string' as const,
          enum: ['create', 'list', 'update', 'delete'] as const,
          description: 'CRUD action',
        },
        rule_id: { type: 'string' as const, description: 'Rule ID (for update/delete)' },
        name: { type: 'string' as const, description: 'Rule name' },
        rule_type: {
          type: 'string' as const,
          enum: ['free_shipping_threshold', 'carrier_preference', 'weight_surcharge', 'region_override', 'flat_rate'] as const,
          description: 'Rule type',
        },
        config: {
          type: 'object' as const,
          description: 'Rule configuration (varies by rule_type)',
        },
        enabled: { type: 'boolean' as const, description: 'Enable/disable rule' },
        priority: { type: 'number' as const, description: 'Rule priority (higher = applied first)' },
      },
      required: ['action'] as const,
    },
  },
  {
    name: 'international_shipping_calculator',
    description: 'Calculate international shipping costs including estimated customs duties and import taxes',
    input_schema: {
      type: 'object' as const,
      properties: {
        origin_country: { type: 'string' as const, description: 'Origin country code (default: US)' },
        dest_country: { type: 'string' as const, description: 'Destination country code' },
        weight_oz: { type: 'number' as const, description: 'Package weight in ounces' },
        declared_value: { type: 'number' as const, description: 'Declared value in USD' },
        category: {
          type: 'string' as const,
          enum: ['electronics', 'clothing', 'toys', 'food', 'cosmetics', 'furniture', 'auto_parts', 'general'] as const,
          description: 'Product category for customs classification',
        },
        length: { type: 'number' as const, description: 'Length in inches' },
        width: { type: 'number' as const, description: 'Width in inches' },
        height: { type: 'number' as const, description: 'Height in inches' },
      },
      required: ['dest_country', 'weight_oz', 'declared_value', 'category'] as const,
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function handleAdvancedShippingTool(
  db: Database,
  toolName: string,
  input: Record<string, unknown>,
): { success: boolean; data?: unknown; error?: string } {
  ensureAdvancedShippingTables(db);

  switch (toolName) {
    case 'batch_create_labels': {
      const orders = input.orders;
      if (!Array.isArray(orders) || orders.length === 0) {
        return { success: false, error: 'orders array is required and must not be empty' };
      }

      const preferredCarrier = String(input.preferred_carrier ?? 'cheapest');
      const results: BatchLabelResult[] = [];
      let totalCostCents = 0;

      for (const order of orders) {
        const o = order as Record<string, unknown>;
        const orderId = String(o.order_id ?? '');
        const destZip = String(o.dest_zip ?? '');
        const weightOz = Number(o.weight_oz ?? 0);
        const originZip = String(o.origin_zip ?? '10001');

        if (!orderId || !destZip || !Number.isFinite(weightOz) || weightOz <= 0) {
          results.push({ orderId, labelId: '', trackingNumber: '', carrier: 'usps', rateCents: 0, status: 'error', error: 'Invalid order data' });
          continue;
        }

        const lengthIn = o.length != null ? Number(o.length) : undefined;
        const widthIn = o.width != null ? Number(o.width) : undefined;
        const heightIn = o.height != null ? Number(o.height) : undefined;

        // Find best rate
        let rates = getAllRates(weightOz, originZip, destZip, lengthIn, widthIn, heightIn);
        if (preferredCarrier !== 'cheapest') {
          rates = rates.filter(r => r.carrier === preferredCarrier);
        }

        if (rates.length === 0) {
          results.push({ orderId, labelId: '', trackingNumber: '', carrier: 'usps', rateCents: 0, status: 'error', error: 'No rates available' });
          continue;
        }

        const best = rates[0];
        const labelId = generateId();
        const trackingNumber = `${best.carrier.toUpperCase()}${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

        // TODO: Create actual label via carrier API (EasyPost, Shippo, ShipStation)
        db.run(
          `INSERT INTO shipping_labels (id, order_id, tracking_number, carrier, service, rate_cents, status)
           VALUES (?, ?, ?, ?, ?, ?, 'created')`,
          [labelId, orderId, trackingNumber, best.carrier, best.service, best.rateCents],
        );

        totalCostCents += best.rateCents;
        results.push({ orderId, labelId, trackingNumber, carrier: best.carrier, rateCents: best.rateCents, status: 'created' });
      }

      return {
        success: true,
        data: {
          totalLabels: results.filter(r => r.status === 'created').length,
          failedLabels: results.filter(r => r.status === 'error').length,
          totalCost: (totalCostCents / 100).toFixed(2),
          labels: results.map(r => ({
            ...r,
            rateDollars: (r.rateCents / 100).toFixed(2),
          })),
        },
      };
    }

    case 'auto_select_carrier': {
      const destZip = String(input.dest_zip ?? '');
      const weightOz = Number(input.weight_oz ?? 0);
      const originZip = String(input.origin_zip ?? '10001');
      const priority = String(input.priority ?? 'cheapest');

      if (!destZip) return { success: false, error: 'dest_zip is required' };
      if (!Number.isFinite(weightOz) || weightOz <= 0) return { success: false, error: 'weight_oz must be positive' };

      const lengthIn = input.length != null ? Number(input.length) : undefined;
      const widthIn = input.width != null ? Number(input.width) : undefined;
      const heightIn = input.height != null ? Number(input.height) : undefined;
      const maxDays = input.max_days != null ? Number(input.max_days) : undefined;

      let rates = getAllRates(weightOz, originZip, destZip, lengthIn, widthIn, heightIn);

      if (maxDays != null) {
        rates = rates.filter(r => r.estimatedDays <= maxDays);
      }

      if (rates.length === 0) {
        return { success: false, error: 'No carriers available for these specifications' };
      }

      let selected: ShippingCostEntry;
      let reason: string;

      if (priority === 'fastest') {
        rates.sort((a, b) => a.estimatedDays - b.estimatedDays || a.rateCents - b.rateCents);
        selected = rates[0];
        reason = `Fastest delivery (${selected.estimatedDays} days)`;
      } else if (priority === 'balanced') {
        // Score = cost_rank + speed_rank (lower is better)
        const byPrice = [...rates].sort((a, b) => a.rateCents - b.rateCents);
        const bySpeed = [...rates].sort((a, b) => a.estimatedDays - b.estimatedDays);
        const scores = rates.map(r => ({
          rate: r,
          score: byPrice.indexOf(r) + bySpeed.indexOf(r),
        }));
        scores.sort((a, b) => a.score - b.score);
        selected = scores[0].rate;
        reason = `Best balance of cost ($${(selected.rateCents / 100).toFixed(2)}) and speed (${selected.estimatedDays} days)`;
      } else {
        selected = rates[0]; // Already sorted by cost
        reason = `Cheapest option at $${(selected.rateCents / 100).toFixed(2)}`;
      }

      return {
        success: true,
        data: {
          selected: {
            carrier: selected.carrier,
            service: selected.service,
            rateDollars: (selected.rateCents / 100).toFixed(2),
            estimatedDays: selected.estimatedDays,
            features: selected.features,
            reason,
          },
          alternatives: rates.slice(0, 5).map(r => ({
            carrier: r.carrier,
            service: r.service,
            rateDollars: (r.rateCents / 100).toFixed(2),
            estimatedDays: r.estimatedDays,
          })),
          totalOptionsConsidered: rates.length,
        },
      };
    }

    case 'estimate_delivery_date': {
      const carrier = String(input.carrier ?? '');
      const service = String(input.service ?? '');
      const originZip = String(input.origin_zip ?? '10001');
      const destZip = String(input.dest_zip ?? '');
      const shipDateStr = String(input.ship_date ?? new Date().toISOString().split('T')[0]);

      if (!carrier) return { success: false, error: 'carrier is required' };
      if (!service) return { success: false, error: 'service is required' };

      const entries = CARRIER_RATES[carrier as ShipCarrier];
      if (!entries) return { success: false, error: `Unknown carrier: ${carrier}` };

      const entry = entries.find(e => e.service.toLowerCase() === service.toLowerCase());
      if (!entry) {
        const available = entries.map(e => e.service).join(', ');
        return { success: false, error: `Unknown service "${service}" for ${carrier}. Available: ${available}` };
      }

      // Calculate delivery date (skip weekends for non-express)
      const shipDate = new Date(shipDateStr);
      if (isNaN(shipDate.getTime())) return { success: false, error: 'Invalid ship_date' };

      let businessDays = entry.estimatedDays;
      // Zone adjustment
      if (originZip && destZip) {
        const mult = getZoneMultiplier(originZip, destZip);
        if (mult > 1.2) businessDays = Math.ceil(businessDays * 1.2);
        if (mult > 1.35) businessDays = Math.ceil(businessDays * 1.1);
      }

      // Add business days
      const deliveryDate = new Date(shipDate);
      let daysAdded = 0;
      while (daysAdded < businessDays) {
        deliveryDate.setDate(deliveryDate.getDate() + 1);
        const dow = deliveryDate.getDay();
        if (dow !== 0 && dow !== 6) daysAdded++;
      }

      const confidence: 'high' | 'medium' | 'low' =
        entry.features.includes('money_back') ? 'high'
        : entry.estimatedDays <= 3 ? 'medium' : 'low';

      return {
        success: true,
        data: {
          carrier,
          service: entry.service,
          shipDate: shipDateStr,
          estimatedDeliveryDate: deliveryDate.toISOString().split('T')[0],
          businessDays,
          calendarDays: Math.ceil((deliveryDate.getTime() - shipDate.getTime()) / (1000 * 60 * 60 * 24)),
          confidence,
          note: confidence === 'high'
            ? 'Carrier offers money-back guarantee on delivery date'
            : 'Estimate based on typical transit times. Actual delivery may vary.',
        },
      };
    }

    case 'shipping_cost_comparison': {
      const destZip = String(input.dest_zip ?? '');
      const weightOz = Number(input.weight_oz ?? 0);
      const originZip = String(input.origin_zip ?? '10001');
      const international = input.international === true;

      if (!destZip) return { success: false, error: 'dest_zip is required' };
      if (!Number.isFinite(weightOz) || weightOz <= 0) return { success: false, error: 'weight_oz must be positive' };

      const lengthIn = input.length != null ? Number(input.length) : undefined;
      const widthIn = input.width != null ? Number(input.width) : undefined;
      const heightIn = input.height != null ? Number(input.height) : undefined;

      const rates = getAllRates(weightOz, originZip, destZip, lengthIn, widthIn, heightIn, international);

      // Group by carrier
      const byCarrier: Record<string, Array<{ service: string; rateDollars: string; estimatedDays: number; features: string[] }>> = {};
      for (const rate of rates) {
        if (!byCarrier[rate.carrier]) byCarrier[rate.carrier] = [];
        byCarrier[rate.carrier].push({
          service: rate.service,
          rateDollars: (rate.rateCents / 100).toFixed(2),
          estimatedDays: rate.estimatedDays,
          features: rate.features,
        });
      }

      // Cheapest per carrier
      const cheapestPerCarrier = Object.entries(byCarrier).map(([carrier, services]) => ({
        carrier,
        cheapestService: services[0].service,
        rateDollars: services[0].rateDollars,
        estimatedDays: services[0].estimatedDays,
      })).sort((a, b) => parseFloat(a.rateDollars) - parseFloat(b.rateDollars));

      return {
        success: true,
        data: {
          summary: cheapestPerCarrier,
          details: byCarrier,
          totalOptions: rates.length,
          package: {
            originZip,
            destZip,
            weightOz,
            weightLbs: Math.round((weightOz / 16) * 100) / 100,
            dimensions: (lengthIn && widthIn && heightIn) ? `${lengthIn}" x ${widthIn}" x ${heightIn}"` : 'not specified',
            international,
          },
          cheapestOverall: rates.length > 0 ? {
            carrier: rates[0].carrier,
            service: rates[0].service,
            rateDollars: (rates[0].rateCents / 100).toFixed(2),
            estimatedDays: rates[0].estimatedDays,
          } : null,
        },
      };
    }

    case 'manage_shipping_rules': {
      const action = String(input.action ?? 'list');

      switch (action) {
        case 'create': {
          const name = String(input.name ?? '');
          const ruleType = String(input.rule_type ?? '');
          if (!name || !ruleType) return { success: false, error: 'name and rule_type are required' };

          const ruleId = generateId();
          const config = input.config ? JSON.stringify(input.config) : '{}';
          const enabled = input.enabled !== false ? 1 : 0;
          const priority = input.priority != null ? Number(input.priority) : 0;

          db.run(
            `INSERT INTO advanced_shipping_rules (id, name, rule_type, config, enabled, priority)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [ruleId, name, ruleType, config, enabled, priority],
          );

          return { success: true, data: { ruleId, name, ruleType, enabled: enabled === 1, priority, message: 'Shipping rule created' } };
        }

        case 'list': {
          const rows = db.query<Record<string, unknown>>(
            `SELECT * FROM advanced_shipping_rules ORDER BY priority DESC, created_at DESC`,
          );
          return {
            success: true,
            data: {
              rules: rows.map(r => ({
                id: r.id,
                name: r.name,
                ruleType: r.rule_type,
                config: JSON.parse(String(r.config ?? '{}')),
                enabled: r.enabled === 1,
                priority: r.priority,
                createdAt: r.created_at,
              })),
              count: rows.length,
            },
          };
        }

        case 'update': {
          const ruleId = String(input.rule_id ?? '');
          if (!ruleId) return { success: false, error: 'rule_id is required for update' };

          const updates: string[] = [];
          const params: unknown[] = [];

          if (input.name) { updates.push('name = ?'); params.push(String(input.name)); }
          if (input.rule_type) { updates.push('rule_type = ?'); params.push(String(input.rule_type)); }
          if (input.config) { updates.push('config = ?'); params.push(JSON.stringify(input.config)); }
          if (input.enabled !== undefined) { updates.push('enabled = ?'); params.push(input.enabled ? 1 : 0); }
          if (input.priority != null) { updates.push('priority = ?'); params.push(Number(input.priority)); }

          if (updates.length === 0) return { success: false, error: 'No fields to update' };
          params.push(ruleId);

          db.run(`UPDATE advanced_shipping_rules SET ${updates.join(', ')} WHERE id = ?`, params);
          return { success: true, data: { ruleId, message: 'Rule updated' } };
        }

        case 'delete': {
          const ruleId = String(input.rule_id ?? '');
          if (!ruleId) return { success: false, error: 'rule_id is required for delete' };
          db.run(`DELETE FROM advanced_shipping_rules WHERE id = ?`, [ruleId]);
          return { success: true, data: { ruleId, message: 'Rule deleted' } };
        }

        default:
          return { success: false, error: `Unknown action: ${action}` };
      }
    }

    case 'international_shipping_calculator': {
      const destCountry = String(input.dest_country ?? '');
      const weightOz = Number(input.weight_oz ?? 0);
      const declaredValue = Number(input.declared_value ?? 0);
      const category = String(input.category ?? 'general');

      if (!destCountry) return { success: false, error: 'dest_country is required' };
      if (!Number.isFinite(weightOz) || weightOz <= 0) return { success: false, error: 'weight_oz must be positive' };
      if (!Number.isFinite(declaredValue) || declaredValue <= 0) return { success: false, error: 'declared_value must be positive' };

      const originCountry = String(input.origin_country ?? 'US');
      const lengthIn = input.length != null ? Number(input.length) : undefined;
      const widthIn = input.width != null ? Number(input.width) : undefined;
      const heightIn = input.height != null ? Number(input.height) : undefined;

      // Get international shipping rates
      const rates = getAllRates(weightOz, undefined, undefined, lengthIn, widthIn, heightIn, true);

      // Calculate customs/duties
      const customs = estimateCustomsDuties(declaredValue, category, destCountry);

      const options = rates.map(rate => {
        const shippingCost = rate.rateCents / 100;
        const totalLandedCost = shippingCost + customs.duties + customs.taxes + declaredValue;

        return {
          carrier: rate.carrier,
          service: rate.service,
          shippingCost: Math.round(shippingCost * 100) / 100,
          estimatedDuties: customs.duties,
          estimatedTaxes: customs.taxes,
          totalLandedCost: Math.round(totalLandedCost * 100) / 100,
          estimatedDays: rate.estimatedDays,
          features: rate.features,
        };
      });

      return {
        success: true,
        data: {
          route: `${originCountry} -> ${destCountry}`,
          declaredValue,
          category,
          customs: {
            estimatedDuties: customs.duties,
            estimatedTaxes: customs.taxes,
            restrictionsApply: customs.restrictions.length > 0,
            restrictions: customs.restrictions,
          },
          shippingOptions: options,
          cheapestOption: options.length > 0 ? options[0] : null,
          note: 'Duty and tax estimates are approximate. Actual amounts determined by customs at destination.',
        },
      };
    }

    default:
      return { success: false, error: `Unknown advanced shipping tool: ${toolName}` };
  }
}
