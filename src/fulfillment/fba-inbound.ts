/**
 * FBA Inbound Shipments
 *
 * Manages the creation and tracking of inbound shipments to Amazon FBA
 * warehouses using the SP-API Fulfillment Inbound v2024-03-20 API.
 *
 * Workflow:
 * 1. createInboundPlan  -> groups items, estimates costs
 * 2. createInboundShipment -> calls SP-API to create + confirm
 * 3. getInboundShipmentStatus -> poll for status updates
 * 4. generateBoxLabels -> format FNSKU/shipment labels
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import type { SpApiAuthConfig } from '../platforms/amazon/sp-auth.js';
import { getSpApiToken, SP_API_ENDPOINTS, MARKETPLACE_IDS } from '../platforms/amazon/sp-auth.js';
import type {
  InboundPlan,
  InboundShipment,
  InboundItem,
  InboundShipmentStatus,
  BoxLabel,
  InboundFeeEstimate,
  PlanInboundParams,
  CreateShipmentParams,
  EstimateFeeParams,
  PackingOption,
  Carrier,
} from './fba-inbound-types.js';

const logger = createLogger('fba-inbound');

// ---------------------------------------------------------------------------
// SP-API Base Path
// ---------------------------------------------------------------------------

const INBOUND_API_VERSION = '2024-03-20';
const INBOUND_BASE = `/inbound/fba/${INBOUND_API_VERSION}`;

// ---------------------------------------------------------------------------
// Table bootstrap (idempotent)
// ---------------------------------------------------------------------------

export function ensureInboundTables(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS fba_inbound_shipments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT '',
      plan_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planning',
      destination_fc TEXT NOT NULL DEFAULT '',
      item_count INTEGER NOT NULL DEFAULT 0,
      total_units INTEGER NOT NULL DEFAULT 0,
      box_count INTEGER NOT NULL DEFAULT 0,
      weight_lbs REAL NOT NULL DEFAULT 0,
      tracking_number TEXT,
      carrier TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      shipped_at INTEGER,
      received_at INTEGER
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_fba_inbound_status ON fba_inbound_shipments(status)');
  db.run('CREATE INDEX IF NOT EXISTS idx_fba_inbound_plan ON fba_inbound_shipments(plan_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_fba_inbound_user ON fba_inbound_shipments(user_id)');

  db.run(`
    CREATE TABLE IF NOT EXISTS fba_inbound_items (
      id TEXT PRIMARY KEY,
      shipment_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      fnsku TEXT,
      asin TEXT,
      quantity INTEGER NOT NULL DEFAULT 0,
      prep_type TEXT NOT NULL DEFAULT 'none',
      condition TEXT NOT NULL DEFAULT 'new',
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      FOREIGN KEY (shipment_id) REFERENCES fba_inbound_shipments(id)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_fba_inbound_items_shipment ON fba_inbound_items(shipment_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_fba_inbound_items_sku ON fba_inbound_items(sku)');
}

// ---------------------------------------------------------------------------
// SP-API fetch helper (mirrors fba.ts pattern)
// ---------------------------------------------------------------------------

function createSpFetch(config: SpApiAuthConfig) {
  const endpoint = config.endpoint ?? SP_API_ENDPOINTS.NA;

  return async function spFetch<T>(path: string, options?: {
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
  }): Promise<T> {
    const token = await getSpApiToken(config);
    const url = new URL(path, endpoint);
    if (options?.params) {
      for (const [k, v] of Object.entries(options.params)) {
        url.searchParams.set(k, v);
      }
    }

    const headers: Record<string, string> = {
      'x-amz-access-token': token,
      'Content-Type': 'application/json',
    };

    const fetchOptions: RequestInit = {
      method: options?.method ?? 'GET',
      headers,
    };

    if (options?.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, path, error: errorText }, 'FBA Inbound API request failed');
      throw new Error(`FBA Inbound API (${response.status}): ${errorText}`);
    }

    if (response.status === 204 || (response.status === 200 && response.headers.get('content-length') === '0')) {
      return {} as T;
    }
    return response.json() as Promise<T>;
  };
}

// ---------------------------------------------------------------------------
// Row parsers
// ---------------------------------------------------------------------------

function parseShipmentRow(row: Record<string, unknown>): InboundShipment {
  return {
    id: row.id as string,
    userId: (row.user_id as string) ?? '',
    planId: row.plan_id as string,
    status: (row.status as InboundShipmentStatus) ?? 'planning',
    destinationFc: (row.destination_fc as string) ?? '',
    itemCount: (row.item_count as number) ?? 0,
    totalUnits: (row.total_units as number) ?? 0,
    boxCount: (row.box_count as number) ?? 0,
    weightLbs: (row.weight_lbs as number) ?? 0,
    trackingNumber: (row.tracking_number as string) ?? undefined,
    carrier: (row.carrier as Carrier) ?? undefined,
    createdAt: new Date(row.created_at as number),
    shippedAt: row.shipped_at ? new Date(row.shipped_at as number) : undefined,
    receivedAt: row.received_at ? new Date(row.received_at as number) : undefined,
  };
}

function parseItemRow(row: Record<string, unknown>): InboundItem {
  return {
    id: row.id as string,
    shipmentId: (row.shipment_id as string) ?? undefined,
    sku: row.sku as string,
    fnsku: (row.fnsku as string) ?? undefined,
    asin: (row.asin as string) ?? undefined,
    quantity: (row.quantity as number) ?? 0,
    prepType: (row.prep_type as InboundItem['prepType']) ?? 'none',
    condition: (row.condition as InboundItem['condition']) ?? 'new',
    createdAt: row.created_at ? new Date(row.created_at as number) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Fee estimation constants
// ---------------------------------------------------------------------------

/** Per-unit prep fees by type (approximate Amazon charges). */
const PREP_FEES: Record<string, number> = {
  none: 0,
  labeling: 0.55,
  polybagging: 0.80,
  bubble_wrap: 1.50,
  taping: 0.50,
  black_shrink_wrap: 1.00,
  suffocation_sticker: 0.20,
};

/** Labeling fee per unit when Amazon applies FNSKU label. */
const LABELING_FEE_PER_UNIT = 0.55;

/** Per-pound inbound shipping rate (Amazon partnered carrier, approximate). */
const INBOUND_SHIPPING_RATE_PER_LB = 0.30;

/** Oversize surcharge per unit. */
const OVERSIZE_SURCHARGE = 3.00;

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Plan an FBA inbound shipment locally. Groups items, estimates box count
 * and weight, and calculates rough shipping costs.
 *
 * Does NOT call SP-API -- that happens in createInboundShipment.
 */
export function createInboundPlan(
  db: Database,
  params: PlanInboundParams,
): InboundPlan {
  ensureInboundTables(db);

  const planId = `PLAN-${randomUUID().slice(0, 8).toUpperCase()}`;
  const items: InboundItem[] = params.items.map(item => ({
    sku: item.sku,
    asin: item.asin,
    quantity: item.quantity,
    condition: item.condition ?? 'new',
    prepType: 'none',
  }));

  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);

  // Estimate box count: ~50 standard-size items per box
  const boxCount = Math.max(1, Math.ceil(totalUnits / 50));

  // Estimate weight: ~1 lb per unit default (conservative)
  const estimatedWeightLbs = totalUnits * 1.0;

  // Estimate shipping cost
  const estimatedShippingCost = Math.round(estimatedWeightLbs * INBOUND_SHIPPING_RATE_PER_LB * 100) / 100;

  const plan: InboundPlan = {
    planId,
    items,
    shipFromAddress: {
      postalCode: params.shipFromZip ?? '00000',
      countryCode: params.shipFromCountry ?? 'US',
    },
    totalUnits,
    boxCount,
    estimatedWeightLbs,
    estimatedShippingCost,
    status: 'planning',
    createdAt: new Date(),
  };

  // Store plan as a shipment record in planning status
  const shipmentId = randomUUID().slice(0, 12);
  db.run(
    `INSERT INTO fba_inbound_shipments
       (id, plan_id, status, destination_fc, item_count, total_units, box_count, weight_lbs, created_at)
     VALUES (?, ?, 'planning', '', ?, ?, ?, ?, ?)`,
    [shipmentId, planId, items.length, totalUnits, boxCount, estimatedWeightLbs, Date.now()],
  );

  // Store items
  for (const item of items) {
    const itemId = randomUUID().slice(0, 12);
    db.run(
      `INSERT INTO fba_inbound_items
         (id, shipment_id, sku, asin, quantity, prep_type, condition, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [itemId, shipmentId, item.sku, item.asin ?? null, item.quantity, item.prepType ?? 'none', item.condition ?? 'new', Date.now()],
    );
  }

  logger.info(
    { planId, itemCount: items.length, totalUnits, boxCount, estimatedShippingCost },
    'Inbound plan created',
  );

  return plan;
}

/**
 * Create an FBA inbound shipment via SP-API.
 *
 * Calls the Inbound Fulfillment API to:
 * 1. Create an inbound plan
 * 2. List packing options
 * 3. Confirm the chosen packing option
 */
export async function createInboundShipment(
  config: SpApiAuthConfig,
  db: Database,
  params: CreateShipmentParams,
): Promise<InboundShipment | null> {
  ensureInboundTables(db);

  const spFetch = createSpFetch(config);
  const marketplaceId = config.marketplaceId ?? MARKETPLACE_IDS.US;

  // Look up local plan
  const shipmentRows = db.query<Record<string, unknown>>(
    'SELECT * FROM fba_inbound_shipments WHERE plan_id = ? ORDER BY created_at DESC LIMIT 1',
    [params.planId],
  );
  if (shipmentRows.length === 0) {
    logger.warn({ planId: params.planId }, 'Inbound plan not found');
    return null;
  }

  const shipment = parseShipmentRow(shipmentRows[0]);
  const itemRows = db.query<Record<string, unknown>>(
    'SELECT * FROM fba_inbound_items WHERE shipment_id = ?',
    [shipment.id],
  );
  const items = itemRows.map(parseItemRow);

  if (items.length === 0) {
    logger.warn({ planId: params.planId }, 'No items found for inbound plan');
    return null;
  }

  // Step 1: Create inbound plan via SP-API
  logger.info({ planId: params.planId, itemCount: items.length }, 'Creating SP-API inbound plan');

  const createPlanBody = {
    destinationMarketplaces: [marketplaceId],
    items: items.map(item => ({
      msku: item.sku,
      asin: item.asin ?? '',
      quantity: item.quantity,
      condition: (item.condition ?? 'new').toUpperCase().replace(/_/g, '_'),
      prepOwner: 'SELLER',
      labelOwner: 'SELLER',
    })),
    sourceAddress: {
      countryCode: 'US',
    },
  };

  const planResult = await spFetch<{
    inboundPlanId?: string;
    packingOptions?: PackingOption[];
  }>(`${INBOUND_BASE}/inboundPlans`, {
    method: 'POST',
    body: createPlanBody,
  });

  const spPlanId = planResult.inboundPlanId;
  if (!spPlanId) {
    logger.error({ planId: params.planId }, 'SP-API did not return inbound plan ID');
    throw new Error('SP-API inbound plan creation failed: no plan ID returned');
  }

  // Step 2: Get packing options
  logger.info({ spPlanId }, 'Fetching packing options');

  const packingResult = await spFetch<{
    packingOptions?: Array<{
      packingOptionId: string;
      packingGroups: Array<{
        packingGroupId: string;
        items: Array<{ sku: string; quantity: number }>;
      }>;
    }>;
  }>(`${INBOUND_BASE}/inboundPlans/${encodeURIComponent(spPlanId)}/packingOptions`);

  const packingOptions = packingResult.packingOptions ?? [];
  const chosenOptionId = params.packingOption
    ?? packingOptions[0]?.packingOptionId
    ?? '';

  if (!chosenOptionId) {
    logger.warn({ spPlanId }, 'No packing options available');
    throw new Error('No packing options returned by SP-API');
  }

  // Step 3: Confirm packing option
  logger.info({ spPlanId, packingOptionId: chosenOptionId }, 'Confirming packing option');

  await spFetch<void>(
    `${INBOUND_BASE}/inboundPlans/${encodeURIComponent(spPlanId)}/packingOptions/${encodeURIComponent(chosenOptionId)}/confirmation`,
    { method: 'POST' },
  );

  // Update local record
  const now = Date.now();
  db.run(
    `UPDATE fba_inbound_shipments SET status = 'ready', plan_id = ?, carrier = ? WHERE id = ?`,
    [spPlanId, params.carrier ?? 'amazon_partnered', shipment.id],
  );

  const updated: InboundShipment = {
    ...shipment,
    planId: spPlanId,
    status: 'ready',
    carrier: params.carrier ?? 'amazon_partnered',
  };

  logger.info(
    { shipmentId: shipment.id, spPlanId, carrier: updated.carrier },
    'FBA inbound shipment created and confirmed',
  );

  return updated;
}

/**
 * Check the status of an FBA inbound shipment via SP-API.
 */
export async function getInboundShipmentStatus(
  config: SpApiAuthConfig,
  db: Database,
  shipmentId: string,
): Promise<InboundShipment | null> {
  ensureInboundTables(db);

  // Look up local record first
  const localRows = db.query<Record<string, unknown>>(
    'SELECT * FROM fba_inbound_shipments WHERE id = ? OR plan_id = ?',
    [shipmentId, shipmentId],
  );

  if (localRows.length === 0) {
    logger.warn({ shipmentId }, 'Inbound shipment not found locally');
    return null;
  }

  const local = parseShipmentRow(localRows[0]);

  // Try to get status from SP-API
  try {
    const spFetch = createSpFetch(config);

    const result = await spFetch<{
      inboundPlanId?: string;
      status?: string;
      destinationFulfillmentCenter?: string;
      shipmentConfirmationId?: string;
    }>(`${INBOUND_BASE}/inboundPlans/${encodeURIComponent(local.planId)}`);

    // Map SP-API status to our status
    const apiStatus = result.status?.toLowerCase() ?? '';
    let newStatus: InboundShipmentStatus = local.status;
    if (apiStatus.includes('receiv')) newStatus = 'receiving';
    if (apiStatus.includes('closed') || apiStatus.includes('complete')) newStatus = 'received';
    if (apiStatus.includes('cancel')) newStatus = 'cancelled';
    if (apiStatus.includes('ship') || apiStatus.includes('transit')) newStatus = 'shipped';

    const destFc = result.destinationFulfillmentCenter ?? local.destinationFc;

    // Update local record if status changed
    if (newStatus !== local.status || destFc !== local.destinationFc) {
      const now = Date.now();
      db.run(
        'UPDATE fba_inbound_shipments SET status = ?, destination_fc = ?, received_at = ? WHERE id = ?',
        [newStatus, destFc, newStatus === 'received' ? now : local.receivedAt?.getTime() ?? null, local.id],
      );
    }

    return {
      ...local,
      status: newStatus,
      destinationFc: destFc,
      receivedAt: newStatus === 'received' && !local.receivedAt ? new Date() : local.receivedAt,
    };
  } catch (err) {
    logger.warn(
      { shipmentId, error: err instanceof Error ? err.message : String(err) },
      'SP-API status check failed, returning local data',
    );
    return local;
  }
}

/**
 * Generate box label data for an inbound shipment.
 */
export function generateBoxLabels(
  db: Database,
  shipmentId: string,
): BoxLabel[] {
  ensureInboundTables(db);

  const shipmentRows = db.query<Record<string, unknown>>(
    'SELECT * FROM fba_inbound_shipments WHERE id = ? OR plan_id = ?',
    [shipmentId, shipmentId],
  );
  if (shipmentRows.length === 0) return [];

  const shipment = parseShipmentRow(shipmentRows[0]);
  const itemRows = db.query<Record<string, unknown>>(
    'SELECT * FROM fba_inbound_items WHERE shipment_id = ?',
    [shipment.id],
  );
  const items = itemRows.map(parseItemRow);

  const labels: BoxLabel[] = [];
  let boxNumber = 1;

  // Distribute items across boxes (~50 units per box)
  let unitsInCurrentBox = 0;
  const MAX_UNITS_PER_BOX = 50;

  for (const item of items) {
    let remainingQty = item.quantity;

    while (remainingQty > 0) {
      const spaceInBox = MAX_UNITS_PER_BOX - unitsInCurrentBox;
      const qtyForThisBox = Math.min(remainingQty, spaceInBox);

      labels.push({
        shipmentId: shipment.planId,
        boxNumber,
        fnsku: item.fnsku ?? item.sku,
        sku: item.sku,
        quantity: qtyForThisBox,
        destinationFc: shipment.destinationFc,
        labelData: [
          `SHIPMENT: ${shipment.planId}`,
          `BOX: ${boxNumber}`,
          `FNSKU: ${item.fnsku ?? item.sku}`,
          `SKU: ${item.sku}`,
          `QTY: ${qtyForThisBox}`,
          `FC: ${shipment.destinationFc || 'TBD'}`,
        ].join('\n'),
      });

      remainingQty -= qtyForThisBox;
      unitsInCurrentBox += qtyForThisBox;

      if (unitsInCurrentBox >= MAX_UNITS_PER_BOX && remainingQty > 0) {
        boxNumber++;
        unitsInCurrentBox = 0;
      }
    }
  }

  logger.info({ shipmentId: shipment.id, labelCount: labels.length }, 'Generated box labels');
  return labels;
}

/**
 * Estimate FBA prep, labeling, and inbound shipping fees for a set of items.
 */
export function estimateInboundFees(params: EstimateFeeParams): InboundFeeEstimate {
  let totalPrepFees = 0;
  let totalLabelingFees = 0;
  let totalShippingFees = 0;

  const itemEstimates = params.items.map(item => {
    const qty = item.quantity;
    const prepFee = 0; // Default: seller-prepped
    const labelingFee = LABELING_FEE_PER_UNIT * qty;

    // Weight-based shipping estimate
    const weightOz = item.weightOz ?? 16; // default 1 lb
    const weightLbs = weightOz / 16;
    let shippingFee = weightLbs * qty * INBOUND_SHIPPING_RATE_PER_LB;

    // Oversize surcharge
    if (item.isOversize) {
      shippingFee += OVERSIZE_SURCHARGE * qty;
    }

    // Validate numeric results
    const safePrepFee = Number.isFinite(prepFee) ? Math.round(prepFee * 100) / 100 : 0;
    const safeLabelingFee = Number.isFinite(labelingFee) ? Math.round(labelingFee * 100) / 100 : 0;
    const safeShippingFee = Number.isFinite(shippingFee) ? Math.round(shippingFee * 100) / 100 : 0;
    const totalFee = safePrepFee + safeLabelingFee + safeShippingFee;

    totalPrepFees += safePrepFee;
    totalLabelingFees += safeLabelingFee;
    totalShippingFees += safeShippingFee;

    return {
      asin: item.asin,
      quantity: qty,
      prepFee: safePrepFee,
      labelingFee: safeLabelingFee,
      inboundShippingFee: safeShippingFee,
      totalFee: Math.round(totalFee * 100) / 100,
    };
  });

  return {
    items: itemEstimates,
    totalPrepFees: Math.round(totalPrepFees * 100) / 100,
    totalLabelingFees: Math.round(totalLabelingFees * 100) / 100,
    totalShippingFees: Math.round(totalShippingFees * 100) / 100,
    grandTotal: Math.round((totalPrepFees + totalLabelingFees + totalShippingFees) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * List FBA inbound shipments with optional status filter.
 */
export function listInboundShipments(
  db: Database,
  options?: { status?: string; limit?: number },
): InboundShipment[] {
  ensureInboundTables(db);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (options?.status && options.status !== 'all') {
    conditions.push('status = ?');
    params.push(options.status);
  }

  const limit = options?.limit ?? 20;
  params.push(limit);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const sql = `SELECT * FROM fba_inbound_shipments ${where} ORDER BY created_at DESC LIMIT ?`;

  const rows = db.query<Record<string, unknown>>(sql, params);
  return rows.map(parseShipmentRow);
}

/**
 * Get items for a specific inbound shipment.
 */
export function getInboundShipmentItems(
  db: Database,
  shipmentId: string,
): InboundItem[] {
  ensureInboundTables(db);

  const rows = db.query<Record<string, unknown>>(
    'SELECT * FROM fba_inbound_items WHERE shipment_id = ?',
    [shipmentId],
  );
  return rows.map(parseItemRow);
}
