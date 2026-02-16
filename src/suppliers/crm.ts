/**
 * Supplier CRM - Manage wholesale suppliers, catalogs, orders, and performance
 *
 * Provides CRUD for suppliers, product-supplier linkage, purchase orders,
 * supplier performance scoring, reorder alerts, and price comparison.
 */

import { randomUUID } from 'node:crypto';
import type { Database } from '../db/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('supplier-crm');

// =============================================================================
// Types
// =============================================================================

export interface Supplier {
  id: string;
  name: string;
  contactName: string;
  email: string;
  phone: string;
  website: string;
  platform: string; // 'aliexpress' | 'faire' | 'direct' | 'wholesale' | 'liquidation'
  paymentTerms: string; // 'net30' | 'net60' | 'cod' | 'prepaid'
  minOrderAmount: number;
  shippingRegion: string;
  avgLeadTimeDays: number;
  rating: number; // 1-5
  notes: string;
  tags: string[]; // JSON array
  status: 'active' | 'inactive' | 'blacklisted';
  totalOrders: number;
  totalSpent: number;
  lastOrderAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SupplierProduct {
  id: string;
  supplierId: string;
  productId: string;
  sku: string;
  supplierSku: string;
  unitCost: number;
  moq: number; // minimum order quantity
  leadTimeDays: number;
  isPreferred: boolean; // preferred supplier for this product
  lastPriceAt: number;
  notes: string;
}

export interface SupplierOrder {
  id: string;
  supplierId: string;
  orderNumber: string;
  status: 'draft' | 'submitted' | 'confirmed' | 'shipped' | 'received' | 'cancelled';
  items: SupplierOrderItem[];
  subtotal: number;
  shippingCost: number;
  total: number;
  expectedDelivery: number | null;
  actualDelivery: number | null;
  trackingNumber: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface SupplierOrderItem {
  id: string;
  orderId: string;
  productId: string;
  sku: string;
  quantity: number;
  unitCost: number;
  total: number;
}

export interface SupplierPerformance {
  supplierId: string;
  supplierName: string;
  totalOrders: number;
  onTimeDeliveryPct: number;
  avgLeadTimeDays: number;
  qualityScore: number; // based on returns/defects
  priceCompetitiveness: number; // vs other suppliers for same products
  overallScore: number;
}

export interface ReorderAlert {
  productId: string;
  productName: string;
  currentStock: number;
  reorderPoint: number;
  suggestedQuantity: number;
  preferredSupplier: { id: string; name: string; unitCost: number; leadTime: number };
  estimatedCost: number;
  urgency: 'critical' | 'soon' | 'planned';
}

export interface SupplierPriceComparison {
  productId: string;
  productName: string;
  suppliers: Array<{
    supplierId: string;
    supplierName: string;
    unitCost: number;
    moq: number;
    leadTimeDays: number;
    isPreferred: boolean;
    lastPriceAt: number | null;
  }>;
  cheapest: { supplierId: string; supplierName: string; unitCost: number } | null;
  fastest: { supplierId: string; supplierName: string; leadTimeDays: number } | null;
}

export interface SupplierStats {
  totalSuppliers: number;
  activeSuppliers: number;
  totalSpent: number;
  totalOrders: number;
  avgLeadTimeDays: number;
  avgRating: number;
  topSuppliersBySpend: Array<{ id: string; name: string; totalSpent: number }>;
  topSuppliersByOrders: Array<{ id: string; name: string; totalOrders: number }>;
  platformBreakdown: Array<{ platform: string; count: number }>;
}

export interface SupplierFilters {
  status?: string;
  platform?: string;
  search?: string;
  minRating?: number;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export interface OrderFilters {
  supplierId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

// =============================================================================
// Row types (DB shape)
// =============================================================================

interface SupplierRow {
  id: string;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  website: string;
  platform: string;
  payment_terms: string;
  min_order_amount: number;
  shipping_region: string;
  avg_lead_time_days: number;
  rating: number;
  notes: string;
  tags: string;
  status: string;
  total_orders: number;
  total_spent: number;
  last_order_at: number | null;
  created_at: number;
  updated_at: number;
}

interface SupplierProductRow {
  id: string;
  supplier_id: string;
  product_id: string | null;
  sku: string | null;
  supplier_sku: string;
  unit_cost: number;
  moq: number;
  lead_time_days: number;
  is_preferred: number;
  last_price_at: number | null;
  notes: string;
}

interface SupplierOrderRow {
  id: string;
  supplier_id: string;
  order_number: string | null;
  status: string;
  subtotal: number;
  shipping_cost: number;
  total: number;
  expected_delivery: number | null;
  actual_delivery: number | null;
  tracking_number: string;
  notes: string;
  created_at: number;
  updated_at: number;
}

interface SupplierOrderItemRow {
  id: string;
  order_id: string;
  product_id: string | null;
  sku: string | null;
  quantity: number;
  unit_cost: number;
  total: number;
}

// =============================================================================
// Row mappers
// =============================================================================

function mapSupplierRow(row: SupplierRow): Supplier {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.tags || '[]');
    tags = Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    tags = [];
  }

  return {
    id: row.id,
    name: row.name,
    contactName: row.contact_name ?? '',
    email: row.email ?? '',
    phone: row.phone ?? '',
    website: row.website ?? '',
    platform: row.platform ?? 'direct',
    paymentTerms: row.payment_terms ?? 'prepaid',
    minOrderAmount: row.min_order_amount ?? 0,
    shippingRegion: row.shipping_region ?? '',
    avgLeadTimeDays: row.avg_lead_time_days ?? 7,
    rating: row.rating ?? 3,
    notes: row.notes ?? '',
    tags,
    status: (row.status as Supplier['status']) ?? 'active',
    totalOrders: row.total_orders ?? 0,
    totalSpent: row.total_spent ?? 0,
    lastOrderAt: row.last_order_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSupplierProductRow(row: SupplierProductRow): SupplierProduct {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    productId: row.product_id ?? '',
    sku: row.sku ?? '',
    supplierSku: row.supplier_sku ?? '',
    unitCost: row.unit_cost,
    moq: row.moq ?? 1,
    leadTimeDays: row.lead_time_days ?? 7,
    isPreferred: row.is_preferred === 1,
    lastPriceAt: row.last_price_at ?? 0,
    notes: row.notes ?? '',
  };
}

function mapSupplierOrderRow(row: SupplierOrderRow, items: SupplierOrderItem[]): SupplierOrder {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    orderNumber: row.order_number ?? '',
    status: (row.status as SupplierOrder['status']) ?? 'draft',
    items,
    subtotal: row.subtotal ?? 0,
    shippingCost: row.shipping_cost ?? 0,
    total: row.total ?? 0,
    expectedDelivery: row.expected_delivery ?? null,
    actualDelivery: row.actual_delivery ?? null,
    trackingNumber: row.tracking_number ?? '',
    notes: row.notes ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSupplierOrderItemRow(row: SupplierOrderItemRow): SupplierOrderItem {
  return {
    id: row.id,
    orderId: row.order_id,
    productId: row.product_id ?? '',
    sku: row.sku ?? '',
    quantity: row.quantity,
    unitCost: row.unit_cost,
    total: row.total,
  };
}

// =============================================================================
// Supplier CRUD
// =============================================================================

export interface CreateSupplierInput {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  website?: string;
  platform?: string;
  paymentTerms?: string;
  minOrderAmount?: number;
  shippingRegion?: string;
  avgLeadTimeDays?: number;
  rating?: number;
  notes?: string;
  tags?: string[];
}

export function createSupplier(db: Database, input: CreateSupplierInput): Supplier {
  const id = randomUUID();
  const now = Date.now();
  const rating = Number.isFinite(input.rating) ? Math.max(1, Math.min(5, input.rating!)) : 3;
  const minOrder = Number.isFinite(input.minOrderAmount) ? Math.max(0, input.minOrderAmount!) : 0;
  const leadTime = Number.isFinite(input.avgLeadTimeDays) ? Math.max(1, input.avgLeadTimeDays!) : 7;
  const tags = Array.isArray(input.tags) ? JSON.stringify(input.tags) : '[]';

  db.run(
    `INSERT INTO suppliers (
      id, name, contact_name, email, phone, website, platform,
      payment_terms, min_order_amount, shipping_region, avg_lead_time_days,
      rating, notes, tags, status, total_orders, total_spent,
      last_order_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, 0, NULL, ?, ?)`,
    [
      id,
      input.name,
      input.contactName ?? '',
      input.email ?? '',
      input.phone ?? '',
      input.website ?? '',
      input.platform ?? 'direct',
      input.paymentTerms ?? 'prepaid',
      minOrder,
      input.shippingRegion ?? '',
      leadTime,
      rating,
      input.notes ?? '',
      tags,
      now,
      now,
    ],
  );

  logger.info({ id, name: input.name }, 'Supplier created');
  return getSupplier(db, id)!;
}

export interface UpdateSupplierInput {
  name?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  website?: string;
  platform?: string;
  paymentTerms?: string;
  minOrderAmount?: number;
  shippingRegion?: string;
  avgLeadTimeDays?: number;
  rating?: number;
  notes?: string;
  tags?: string[];
  status?: 'active' | 'inactive' | 'blacklisted';
}

export function updateSupplier(db: Database, id: string, input: UpdateSupplierInput): Supplier | null {
  const existing = getSupplier(db, id);
  if (!existing) return null;

  const now = Date.now();
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (input.name !== undefined) {
    setClauses.push('name = ?');
    params.push(input.name);
  }
  if (input.contactName !== undefined) {
    setClauses.push('contact_name = ?');
    params.push(input.contactName);
  }
  if (input.email !== undefined) {
    setClauses.push('email = ?');
    params.push(input.email);
  }
  if (input.phone !== undefined) {
    setClauses.push('phone = ?');
    params.push(input.phone);
  }
  if (input.website !== undefined) {
    setClauses.push('website = ?');
    params.push(input.website);
  }
  if (input.platform !== undefined) {
    setClauses.push('platform = ?');
    params.push(input.platform);
  }
  if (input.paymentTerms !== undefined) {
    setClauses.push('payment_terms = ?');
    params.push(input.paymentTerms);
  }
  if (input.minOrderAmount !== undefined && Number.isFinite(input.minOrderAmount)) {
    setClauses.push('min_order_amount = ?');
    params.push(Math.max(0, input.minOrderAmount));
  }
  if (input.shippingRegion !== undefined) {
    setClauses.push('shipping_region = ?');
    params.push(input.shippingRegion);
  }
  if (input.avgLeadTimeDays !== undefined && Number.isFinite(input.avgLeadTimeDays)) {
    setClauses.push('avg_lead_time_days = ?');
    params.push(Math.max(1, input.avgLeadTimeDays));
  }
  if (input.rating !== undefined && Number.isFinite(input.rating)) {
    setClauses.push('rating = ?');
    params.push(Math.max(1, Math.min(5, input.rating)));
  }
  if (input.notes !== undefined) {
    setClauses.push('notes = ?');
    params.push(input.notes);
  }
  if (input.tags !== undefined) {
    setClauses.push('tags = ?');
    params.push(Array.isArray(input.tags) ? JSON.stringify(input.tags) : '[]');
  }
  if (input.status !== undefined) {
    setClauses.push('status = ?');
    params.push(input.status);
  }

  if (setClauses.length === 0) return existing;

  setClauses.push('updated_at = ?');
  params.push(now);
  params.push(id);

  db.run(`UPDATE suppliers SET ${setClauses.join(', ')} WHERE id = ?`, params);
  logger.info({ id }, 'Supplier updated');
  return getSupplier(db, id);
}

export function getSupplier(db: Database, id: string): Supplier | null {
  const rows = db.query<SupplierRow>('SELECT * FROM suppliers WHERE id = ?', [id]);
  if (rows.length === 0) return null;
  return mapSupplierRow(rows[0]);
}

export function getSuppliers(db: Database, filters?: SupplierFilters): Supplier[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }
  if (filters?.platform) {
    conditions.push('platform = ?');
    params.push(filters.platform);
  }
  if (filters?.search) {
    conditions.push('(name LIKE ? OR contact_name LIKE ? OR email LIKE ?)');
    const like = `%${filters.search}%`;
    params.push(like, like, like);
  }
  if (filters?.minRating !== undefined && Number.isFinite(filters.minRating)) {
    conditions.push('rating >= ?');
    params.push(filters.minRating);
  }
  if (filters?.tags && filters.tags.length > 0) {
    // Match suppliers that have at least one of the given tags
    const tagConditions = filters.tags.map(() => 'tags LIKE ?');
    conditions.push(`(${tagConditions.join(' OR ')})`);
    for (const tag of filters.tags) {
      params.push(`%${tag}%`);
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(Number(filters?.limit) || 100, 1000));
  const offset = Math.max(0, Number(filters?.offset) || 0);

  const rows = db.query<SupplierRow>(
    `SELECT * FROM suppliers ${where} ORDER BY name ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map(mapSupplierRow);
}

export function deleteSupplier(db: Database, id: string): boolean {
  const existing = getSupplier(db, id);
  if (!existing) return false;

  db.run('UPDATE suppliers SET status = ?, updated_at = ? WHERE id = ?', ['inactive', Date.now(), id]);
  logger.info({ id, name: existing.name }, 'Supplier deactivated');
  return true;
}

// =============================================================================
// Supplier Products
// =============================================================================

export interface AddSupplierProductInput {
  supplierId: string;
  productId?: string;
  sku?: string;
  supplierSku?: string;
  unitCost: number;
  moq?: number;
  leadTimeDays?: number;
  isPreferred?: boolean;
  notes?: string;
}

export function addSupplierProduct(db: Database, input: AddSupplierProductInput): SupplierProduct {
  const supplier = getSupplier(db, input.supplierId);
  if (!supplier) {
    throw new Error(`Supplier not found: ${input.supplierId}`);
  }

  const id = randomUUID();
  const now = Date.now();
  const moq = Number.isFinite(input.moq) ? Math.max(1, input.moq!) : 1;
  const leadTime = Number.isFinite(input.leadTimeDays) ? Math.max(1, input.leadTimeDays!) : 7;

  // If marking as preferred, unset any existing preferred for this product
  if (input.isPreferred && input.productId) {
    db.run(
      'UPDATE supplier_products SET is_preferred = 0 WHERE product_id = ? AND is_preferred = 1',
      [input.productId],
    );
  }

  db.run(
    `INSERT INTO supplier_products (
      id, supplier_id, product_id, sku, supplier_sku, unit_cost,
      moq, lead_time_days, is_preferred, last_price_at, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.supplierId,
      input.productId ?? null,
      input.sku ?? null,
      input.supplierSku ?? '',
      input.unitCost,
      moq,
      leadTime,
      input.isPreferred ? 1 : 0,
      now,
      input.notes ?? '',
    ],
  );

  logger.info({ id, supplierId: input.supplierId, productId: input.productId }, 'Supplier product added');

  const rows = db.query<SupplierProductRow>('SELECT * FROM supplier_products WHERE id = ?', [id]);
  return mapSupplierProductRow(rows[0]);
}

export interface UpdateSupplierProductInput {
  supplierSku?: string;
  unitCost?: number;
  moq?: number;
  leadTimeDays?: number;
  isPreferred?: boolean;
  notes?: string;
}

export function updateSupplierProduct(
  db: Database,
  id: string,
  input: UpdateSupplierProductInput,
): SupplierProduct | null {
  const rows = db.query<SupplierProductRow>('SELECT * FROM supplier_products WHERE id = ?', [id]);
  if (rows.length === 0) return null;

  const now = Date.now();
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (input.supplierSku !== undefined) {
    setClauses.push('supplier_sku = ?');
    params.push(input.supplierSku);
  }
  if (input.unitCost !== undefined && Number.isFinite(input.unitCost)) {
    setClauses.push('unit_cost = ?');
    params.push(input.unitCost);
    setClauses.push('last_price_at = ?');
    params.push(now);
  }
  if (input.moq !== undefined && Number.isFinite(input.moq)) {
    setClauses.push('moq = ?');
    params.push(Math.max(1, input.moq));
  }
  if (input.leadTimeDays !== undefined && Number.isFinite(input.leadTimeDays)) {
    setClauses.push('lead_time_days = ?');
    params.push(Math.max(1, input.leadTimeDays));
  }
  if (input.isPreferred !== undefined) {
    // If setting as preferred, unset others for this product
    if (input.isPreferred && rows[0].product_id) {
      db.run(
        'UPDATE supplier_products SET is_preferred = 0 WHERE product_id = ? AND id != ?',
        [rows[0].product_id, id],
      );
    }
    setClauses.push('is_preferred = ?');
    params.push(input.isPreferred ? 1 : 0);
  }
  if (input.notes !== undefined) {
    setClauses.push('notes = ?');
    params.push(input.notes);
  }

  if (setClauses.length === 0) return mapSupplierProductRow(rows[0]);

  params.push(id);
  db.run(`UPDATE supplier_products SET ${setClauses.join(', ')} WHERE id = ?`, params);

  const updated = db.query<SupplierProductRow>('SELECT * FROM supplier_products WHERE id = ?', [id]);
  return mapSupplierProductRow(updated[0]);
}

export function getSupplierProducts(db: Database, supplierId: string): SupplierProduct[] {
  const rows = db.query<SupplierProductRow>(
    'SELECT * FROM supplier_products WHERE supplier_id = ? ORDER BY unit_cost ASC',
    [supplierId],
  );
  return rows.map(mapSupplierProductRow);
}

export function getProductSuppliers(db: Database, productId: string): SupplierProduct[] {
  const rows = db.query<SupplierProductRow>(
    'SELECT * FROM supplier_products WHERE product_id = ? ORDER BY is_preferred DESC, unit_cost ASC',
    [productId],
  );
  return rows.map(mapSupplierProductRow);
}

export function setPreferredSupplier(db: Database, productId: string, supplierId: string): boolean {
  // Verify the supplier_product link exists
  const rows = db.query<SupplierProductRow>(
    'SELECT * FROM supplier_products WHERE product_id = ? AND supplier_id = ?',
    [productId, supplierId],
  );
  if (rows.length === 0) return false;

  // Unset all preferred for this product
  db.run('UPDATE supplier_products SET is_preferred = 0 WHERE product_id = ?', [productId]);

  // Set the new preferred
  db.run(
    'UPDATE supplier_products SET is_preferred = 1 WHERE product_id = ? AND supplier_id = ?',
    [productId, supplierId],
  );

  logger.info({ productId, supplierId }, 'Preferred supplier set');
  return true;
}

// =============================================================================
// Supplier Orders
// =============================================================================

export interface CreateSupplierOrderInput {
  supplierId: string;
  orderNumber?: string;
  items: Array<{
    productId?: string;
    sku?: string;
    quantity: number;
    unitCost: number;
  }>;
  shippingCost?: number;
  expectedDelivery?: number;
  notes?: string;
}

export function createSupplierOrder(db: Database, input: CreateSupplierOrderInput): SupplierOrder {
  const supplier = getSupplier(db, input.supplierId);
  if (!supplier) {
    throw new Error(`Supplier not found: ${input.supplierId}`);
  }

  const orderId = randomUUID();
  const now = Date.now();
  const shippingCost = Number.isFinite(input.shippingCost) ? Math.max(0, input.shippingCost!) : 0;

  // Calculate subtotal from items
  let subtotal = 0;
  const orderItems: SupplierOrderItem[] = [];

  for (const item of input.items) {
    const qty = Math.max(1, item.quantity);
    const cost = Number.isFinite(item.unitCost) ? item.unitCost : 0;
    const itemTotal = qty * cost;
    subtotal += itemTotal;

    const itemId = randomUUID();
    orderItems.push({
      id: itemId,
      orderId,
      productId: item.productId ?? '',
      sku: item.sku ?? '',
      quantity: qty,
      unitCost: cost,
      total: itemTotal,
    });
  }

  const total = subtotal + shippingCost;

  // Insert order
  db.run(
    `INSERT INTO supplier_orders (
      id, supplier_id, order_number, status, subtotal, shipping_cost, total,
      expected_delivery, actual_delivery, tracking_number, notes, created_at, updated_at
    ) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, NULL, '', ?, ?, ?)`,
    [
      orderId,
      input.supplierId,
      input.orderNumber ?? `PO-${Date.now().toString(36).toUpperCase()}`,
      subtotal,
      shippingCost,
      total,
      input.expectedDelivery ?? null,
      input.notes ?? '',
      now,
      now,
    ],
  );

  // Insert items
  for (const item of orderItems) {
    db.run(
      `INSERT INTO supplier_order_items (id, order_id, product_id, sku, quantity, unit_cost, total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [item.id, orderId, item.productId || null, item.sku || null, item.quantity, item.unitCost, item.total],
    );
  }

  logger.info({ orderId, supplierId: input.supplierId, total, items: orderItems.length }, 'Supplier order created');
  return getSupplierOrder(db, orderId)!;
}

const VALID_ORDER_STATUSES = new Set(['draft', 'submitted', 'confirmed', 'shipped', 'received', 'cancelled']);

export function updateSupplierOrderStatus(
  db: Database,
  orderId: string,
  status: string,
  opts?: { trackingNumber?: string; expectedDelivery?: number; notes?: string },
): SupplierOrder | null {
  if (!VALID_ORDER_STATUSES.has(status)) {
    throw new Error(`Invalid order status: ${status}. Valid: ${Array.from(VALID_ORDER_STATUSES).join(', ')}`);
  }

  const existing = getSupplierOrder(db, orderId);
  if (!existing) return null;

  const now = Date.now();
  const setClauses: string[] = ['status = ?', 'updated_at = ?'];
  const params: unknown[] = [status, now];

  if (opts?.trackingNumber !== undefined) {
    setClauses.push('tracking_number = ?');
    params.push(opts.trackingNumber);
  }
  if (opts?.expectedDelivery !== undefined && Number.isFinite(opts.expectedDelivery)) {
    setClauses.push('expected_delivery = ?');
    params.push(opts.expectedDelivery);
  }
  if (opts?.notes !== undefined) {
    setClauses.push('notes = ?');
    params.push(opts.notes);
  }

  params.push(orderId);
  db.run(`UPDATE supplier_orders SET ${setClauses.join(', ')} WHERE id = ?`, params);

  logger.info({ orderId, status }, 'Supplier order status updated');
  return getSupplierOrder(db, orderId);
}

export function getSupplierOrder(db: Database, orderId: string): SupplierOrder | null {
  const rows = db.query<SupplierOrderRow>('SELECT * FROM supplier_orders WHERE id = ?', [orderId]);
  if (rows.length === 0) return null;

  const itemRows = db.query<SupplierOrderItemRow>(
    'SELECT * FROM supplier_order_items WHERE order_id = ?',
    [orderId],
  );
  const items = itemRows.map(mapSupplierOrderItemRow);
  return mapSupplierOrderRow(rows[0], items);
}

export function getSupplierOrders(db: Database, filters?: OrderFilters): SupplierOrder[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.supplierId) {
    conditions.push('supplier_id = ?');
    params.push(filters.supplierId);
  }
  if (filters?.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(Number(filters?.limit) || 50, 500));
  const offset = Math.max(0, Number(filters?.offset) || 0);

  const rows = db.query<SupplierOrderRow>(
    `SELECT * FROM supplier_orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  return rows.map((row) => {
    const itemRows = db.query<SupplierOrderItemRow>(
      'SELECT * FROM supplier_order_items WHERE order_id = ?',
      [row.id],
    );
    return mapSupplierOrderRow(row, itemRows.map(mapSupplierOrderItemRow));
  });
}

export function receiveSupplierOrder(
  db: Database,
  orderId: string,
  actualDelivery?: number,
): SupplierOrder | null {
  const existing = getSupplierOrder(db, orderId);
  if (!existing) return null;

  const now = Date.now();
  const delivery = actualDelivery ?? now;

  db.run(
    'UPDATE supplier_orders SET status = ?, actual_delivery = ?, updated_at = ? WHERE id = ?',
    ['received', delivery, now, orderId],
  );

  // Update supplier stats
  db.run(
    `UPDATE suppliers SET
       total_orders = total_orders + 1,
       total_spent = total_spent + ?,
       last_order_at = ?,
       updated_at = ?
     WHERE id = ?`,
    [existing.total, delivery, now, existing.supplierId],
  );

  logger.info(
    { orderId, supplierId: existing.supplierId, total: existing.total },
    'Supplier order received — supplier stats updated',
  );
  return getSupplierOrder(db, orderId);
}

// =============================================================================
// Performance
// =============================================================================

export function calculateSupplierPerformance(db: Database, supplierId: string): SupplierPerformance | null {
  const supplier = getSupplier(db, supplierId);
  if (!supplier) return null;

  // Get all completed orders for this supplier
  const orders = db.query<SupplierOrderRow>(
    "SELECT * FROM supplier_orders WHERE supplier_id = ? AND status = 'received'",
    [supplierId],
  );

  const totalOrders = orders.length;

  // On-time delivery: orders where actual_delivery <= expected_delivery
  let onTimeCount = 0;
  let totalLeadDays = 0;

  for (const order of orders) {
    if (order.actual_delivery && order.expected_delivery) {
      if (order.actual_delivery <= order.expected_delivery) {
        onTimeCount++;
      }
    } else if (order.actual_delivery) {
      // No expected delivery set — treat as on-time
      onTimeCount++;
    }

    // Calculate lead time from created to delivered
    if (order.actual_delivery && order.created_at) {
      const days = (order.actual_delivery - order.created_at) / (1000 * 60 * 60 * 24);
      totalLeadDays += Math.max(0, days);
    }
  }

  const onTimeDeliveryPct = totalOrders > 0 ? (onTimeCount / totalOrders) * 100 : 100;
  const avgLeadTimeDays = totalOrders > 0 ? totalLeadDays / totalOrders : supplier.avgLeadTimeDays;

  // Quality score: based on return rate for products from this supplier
  // (simplified — check if returns table exists and count returns for supplier products)
  let qualityScore = 85; // default good score
  try {
    const supplierProducts = db.query<{ product_id: string }>(
      'SELECT DISTINCT product_id FROM supplier_products WHERE supplier_id = ? AND product_id IS NOT NULL',
      [supplierId],
    );
    if (supplierProducts.length > 0) {
      const placeholders = supplierProducts.map(() => '?').join(',');
      const productIds = supplierProducts.map((p) => p.product_id);
      const returnRows = db.query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM returns WHERE product_id IN (${placeholders})`,
        productIds,
      );
      const returnCount = returnRows[0]?.cnt ?? 0;
      // Each return deducts 5 from quality, min 0
      qualityScore = Math.max(0, 100 - returnCount * 5);
    }
  } catch {
    // returns table may not exist — keep default score
  }

  // Price competitiveness: compare with other suppliers for same products
  let priceCompetitiveness = 50; // neutral default
  try {
    const supplierProducts = db.query<{ product_id: string; unit_cost: number }>(
      'SELECT product_id, unit_cost FROM supplier_products WHERE supplier_id = ? AND product_id IS NOT NULL',
      [supplierId],
    );

    if (supplierProducts.length > 0) {
      let betterPriceCount = 0;
      let totalComparisons = 0;

      for (const sp of supplierProducts) {
        const others = db.query<{ unit_cost: number }>(
          'SELECT unit_cost FROM supplier_products WHERE product_id = ? AND supplier_id != ?',
          [sp.product_id, supplierId],
        );
        for (const other of others) {
          totalComparisons++;
          if (sp.unit_cost <= other.unit_cost) {
            betterPriceCount++;
          }
        }
      }

      if (totalComparisons > 0) {
        priceCompetitiveness = (betterPriceCount / totalComparisons) * 100;
      }
    }
  } catch {
    // ignore
  }

  // Overall score: weighted average
  const overallScore =
    onTimeDeliveryPct * 0.30 +
    qualityScore * 0.25 +
    priceCompetitiveness * 0.25 +
    (supplier.rating / 5) * 100 * 0.20;

  return {
    supplierId,
    supplierName: supplier.name,
    totalOrders,
    onTimeDeliveryPct: Math.round(onTimeDeliveryPct * 100) / 100,
    avgLeadTimeDays: Math.round(avgLeadTimeDays * 10) / 10,
    qualityScore: Math.round(qualityScore * 100) / 100,
    priceCompetitiveness: Math.round(priceCompetitiveness * 100) / 100,
    overallScore: Math.round(overallScore * 100) / 100,
  };
}

export function rankSuppliers(db: Database): SupplierPerformance[] {
  const suppliers = getSuppliers(db, { status: 'active', limit: 500 });
  const performances: SupplierPerformance[] = [];

  for (const supplier of suppliers) {
    const perf = calculateSupplierPerformance(db, supplier.id);
    if (perf) performances.push(perf);
  }

  performances.sort((a, b) => b.overallScore - a.overallScore);
  return performances;
}

// =============================================================================
// Reorder Alerts
// =============================================================================

export interface ReorderAlertOptions {
  reorderPointMultiplier?: number; // default 2 = reorder at 2x weekly avg
  minStockThreshold?: number; // absolute minimum
}

export function checkReorderAlerts(db: Database, opts?: ReorderAlertOptions): ReorderAlert[] {
  const alerts: ReorderAlert[] = [];
  const multiplier = opts?.reorderPointMultiplier ?? 2;
  const minThreshold = opts?.minStockThreshold ?? 5;

  // Get all products that have supplier links and inventory
  try {
    const products = db.query<{
      id: string;
      title: string;
    }>('SELECT id, title FROM products');

    for (const product of products) {
      // Get current stock across all warehouses
      let currentStock = 0;
      try {
        const stockRows = db.query<{ total: number }>(
          'SELECT COALESCE(SUM(quantity - reserved), 0) as total FROM warehouse_inventory WHERE product_id = ?',
          [product.id],
        );
        currentStock = stockRows[0]?.total ?? 0;
      } catch {
        continue; // warehouse_inventory may not exist
      }

      // Estimate weekly sales from orders
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      let weeklyAvgSales = 0;
      try {
        const salesRows = db.query<{ cnt: number }>(
          "SELECT COUNT(*) as cnt FROM orders WHERE status != 'cancelled' AND ordered_at > ?",
          [thirtyDaysAgo],
        );
        const monthlySales = salesRows[0]?.cnt ?? 0;
        weeklyAvgSales = monthlySales / 4.3; // ~4.3 weeks per month
      } catch {
        continue;
      }

      const reorderPoint = Math.max(minThreshold, Math.ceil(weeklyAvgSales * multiplier));

      if (currentStock < reorderPoint) {
        // Find preferred supplier for this product
        const supplierRows = db.query<SupplierProductRow & { supplier_name: string }>(
          `SELECT sp.*, s.name as supplier_name
           FROM supplier_products sp
           JOIN suppliers s ON s.id = sp.supplier_id
           WHERE sp.product_id = ? AND s.status = 'active'
           ORDER BY sp.is_preferred DESC, sp.unit_cost ASC
           LIMIT 1`,
          [product.id],
        );

        if (supplierRows.length === 0) continue;

        const sp = supplierRows[0];
        const suggestedQty = Math.max(sp.moq, Math.ceil(weeklyAvgSales * 4)); // 4 weeks supply
        const estimatedCost = suggestedQty * sp.unit_cost;

        let urgency: ReorderAlert['urgency'];
        if (currentStock <= 0) {
          urgency = 'critical';
        } else if (currentStock < reorderPoint / 2) {
          urgency = 'soon';
        } else {
          urgency = 'planned';
        }

        alerts.push({
          productId: product.id,
          productName: product.title ?? product.id,
          currentStock,
          reorderPoint,
          suggestedQuantity: suggestedQty,
          preferredSupplier: {
            id: sp.supplier_id,
            name: sp.supplier_name,
            unitCost: sp.unit_cost,
            leadTime: sp.lead_time_days,
          },
          estimatedCost,
          urgency,
        });
      }
    }
  } catch (err) {
    logger.warn({ error: err instanceof Error ? err.message : String(err) }, 'Error checking reorder alerts');
  }

  // Sort: critical first, then soon, then planned
  const urgencyOrder = { critical: 0, soon: 1, planned: 2 };
  alerts.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);

  return alerts;
}

// =============================================================================
// Price Comparison
// =============================================================================

export function compareSupplierPrices(db: Database, productId: string): SupplierPriceComparison | null {
  // Get product info
  const productRows = db.query<{ id: string; title: string }>(
    'SELECT id, title FROM products WHERE id = ?',
    [productId],
  );
  if (productRows.length === 0) return null;

  const product = productRows[0];

  // Get all suppliers for this product
  const rows = db.query<SupplierProductRow & { supplier_name: string }>(
    `SELECT sp.*, s.name as supplier_name
     FROM supplier_products sp
     JOIN suppliers s ON s.id = sp.supplier_id
     WHERE sp.product_id = ? AND s.status = 'active'
     ORDER BY sp.unit_cost ASC`,
    [productId],
  );

  if (rows.length === 0) {
    return {
      productId,
      productName: product.title ?? productId,
      suppliers: [],
      cheapest: null,
      fastest: null,
    };
  }

  const suppliers = rows.map((r) => ({
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    unitCost: r.unit_cost,
    moq: r.moq,
    leadTimeDays: r.lead_time_days,
    isPreferred: r.is_preferred === 1,
    lastPriceAt: r.last_price_at ?? null,
  }));

  // Cheapest by unit cost
  const cheapestRow = rows[0]; // already sorted by unit_cost ASC
  const cheapest = {
    supplierId: cheapestRow.supplier_id,
    supplierName: cheapestRow.supplier_name,
    unitCost: cheapestRow.unit_cost,
  };

  // Fastest by lead time
  const sortedByLead = [...rows].sort((a, b) => a.lead_time_days - b.lead_time_days);
  const fastestRow = sortedByLead[0];
  const fastest = {
    supplierId: fastestRow.supplier_id,
    supplierName: fastestRow.supplier_name,
    leadTimeDays: fastestRow.lead_time_days,
  };

  return {
    productId,
    productName: product.title ?? productId,
    suppliers,
    cheapest,
    fastest,
  };
}

// =============================================================================
// Stats
// =============================================================================

export function getSupplierStats(db: Database): SupplierStats {
  const allSuppliers = db.query<SupplierRow>('SELECT * FROM suppliers');
  const activeSuppliers = allSuppliers.filter((s) => s.status === 'active');

  const totalSpent = allSuppliers.reduce((sum, s) => sum + (s.total_spent ?? 0), 0);
  const totalOrders = allSuppliers.reduce((sum, s) => sum + (s.total_orders ?? 0), 0);

  const activeWithLead = activeSuppliers.filter((s) => s.avg_lead_time_days > 0);
  const avgLeadTimeDays =
    activeWithLead.length > 0
      ? activeWithLead.reduce((sum, s) => sum + s.avg_lead_time_days, 0) / activeWithLead.length
      : 0;

  const activeWithRating = activeSuppliers.filter((s) => s.rating > 0);
  const avgRating =
    activeWithRating.length > 0
      ? activeWithRating.reduce((sum, s) => sum + s.rating, 0) / activeWithRating.length
      : 0;

  // Top suppliers by spend
  const topBySpend = [...allSuppliers]
    .sort((a, b) => (b.total_spent ?? 0) - (a.total_spent ?? 0))
    .slice(0, 5)
    .map((s) => ({ id: s.id, name: s.name, totalSpent: s.total_spent ?? 0 }));

  // Top suppliers by orders
  const topByOrders = [...allSuppliers]
    .sort((a, b) => (b.total_orders ?? 0) - (a.total_orders ?? 0))
    .slice(0, 5)
    .map((s) => ({ id: s.id, name: s.name, totalOrders: s.total_orders ?? 0 }));

  // Platform breakdown
  const platformMap = new Map<string, number>();
  for (const s of allSuppliers) {
    const plat = s.platform || 'direct';
    platformMap.set(plat, (platformMap.get(plat) ?? 0) + 1);
  }
  const platformBreakdown = Array.from(platformMap.entries())
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalSuppliers: allSuppliers.length,
    activeSuppliers: activeSuppliers.length,
    totalSpent: Math.round(totalSpent * 100) / 100,
    totalOrders,
    avgLeadTimeDays: Math.round(avgLeadTimeDays * 10) / 10,
    avgRating: Math.round(avgRating * 100) / 100,
    topSuppliersBySpend: topBySpend,
    topSuppliersByOrders: topByOrders,
    platformBreakdown,
  };
}
