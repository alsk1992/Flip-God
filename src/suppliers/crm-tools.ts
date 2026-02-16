/**
 * Supplier CRM Tools - LLM-callable tool definitions and handler
 *
 * Provides tools to manage suppliers, supplier products, purchase orders,
 * performance scoring, reorder alerts, and price comparison.
 */

import type { Database } from '../db/index.js';
import {
  createSupplier,
  updateSupplier,
  getSupplier,
  getSuppliers,
  deleteSupplier,
  addSupplierProduct,
  updateSupplierProduct,
  getSupplierProducts,
  getProductSuppliers,
  setPreferredSupplier,
  createSupplierOrder,
  updateSupplierOrderStatus,
  getSupplierOrder,
  getSupplierOrders,
  receiveSupplierOrder,
  calculateSupplierPerformance,
  rankSuppliers,
  checkReorderAlerts,
  compareSupplierPrices,
  getSupplierStats,
} from './crm.js';

// =============================================================================
// Tool Definitions
// =============================================================================

export const supplierCrmTools = [
  {
    name: 'supplier_create',
    description:
      'Add a new supplier to the CRM — tracks contact info, platform, payment terms, lead time, and rating',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string' as const,
          description: 'Supplier/company name',
        },
        contact_name: {
          type: 'string' as const,
          description: 'Primary contact person name',
        },
        email: {
          type: 'string' as const,
          description: 'Contact email',
        },
        phone: {
          type: 'string' as const,
          description: 'Contact phone number',
        },
        website: {
          type: 'string' as const,
          description: 'Supplier website URL',
        },
        platform: {
          type: 'string' as const,
          enum: ['aliexpress', 'faire', 'direct', 'wholesale', 'liquidation'] as const,
          description: 'Source platform',
        },
        payment_terms: {
          type: 'string' as const,
          enum: ['net30', 'net60', 'cod', 'prepaid'] as const,
          description: 'Payment terms',
        },
        min_order_amount: {
          type: 'number' as const,
          description: 'Minimum order amount in USD',
        },
        shipping_region: {
          type: 'string' as const,
          description: 'Shipping region/country (e.g. "US", "CN", "EU")',
        },
        avg_lead_time_days: {
          type: 'number' as const,
          description: 'Average lead time in days',
        },
        rating: {
          type: 'number' as const,
          description: 'Initial rating 1-5',
        },
        notes: {
          type: 'string' as const,
          description: 'Free-form notes about the supplier',
        },
        tags: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Tags for categorization (e.g. ["electronics", "fast-shipping"])',
        },
      },
      required: ['name'] as const,
    },
    metadata: {
      category: 'suppliers',
      tags: ['supplier', 'create', 'crm', 'wholesale'],
    },
  },
  {
    name: 'supplier_update',
    description: 'Update an existing supplier\'s details — name, contact, rating, status, tags, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string' as const,
          description: 'Supplier ID to update',
        },
        name: { type: 'string' as const, description: 'New name' },
        contact_name: { type: 'string' as const, description: 'New contact name' },
        email: { type: 'string' as const, description: 'New email' },
        phone: { type: 'string' as const, description: 'New phone' },
        website: { type: 'string' as const, description: 'New website' },
        platform: {
          type: 'string' as const,
          enum: ['aliexpress', 'faire', 'direct', 'wholesale', 'liquidation'] as const,
        },
        payment_terms: {
          type: 'string' as const,
          enum: ['net30', 'net60', 'cod', 'prepaid'] as const,
        },
        min_order_amount: { type: 'number' as const },
        shipping_region: { type: 'string' as const },
        avg_lead_time_days: { type: 'number' as const },
        rating: { type: 'number' as const, description: 'Rating 1-5' },
        notes: { type: 'string' as const },
        tags: {
          type: 'array' as const,
          items: { type: 'string' as const },
        },
        status: {
          type: 'string' as const,
          enum: ['active', 'inactive', 'blacklisted'] as const,
          description: 'Supplier status',
        },
      },
      required: ['id'] as const,
    },
    metadata: {
      category: 'suppliers',
      tags: ['supplier', 'update', 'crm'],
    },
  },
  {
    name: 'supplier_list',
    description:
      'List and search suppliers — filter by status, platform, rating, tags, or search by name/email',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string' as const,
          enum: ['active', 'inactive', 'blacklisted'] as const,
          description: 'Filter by status',
        },
        platform: {
          type: 'string' as const,
          description: 'Filter by platform',
        },
        search: {
          type: 'string' as const,
          description: 'Search by name, contact name, or email',
        },
        min_rating: {
          type: 'number' as const,
          description: 'Minimum rating (1-5)',
        },
        tags: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Filter by tags (matches any)',
        },
        limit: { type: 'number' as const, description: 'Max results (default: 100)' },
        offset: { type: 'number' as const, description: 'Pagination offset' },
      },
    },
    metadata: {
      category: 'suppliers',
      tags: ['supplier', 'list', 'search', 'crm'],
    },
  },
  {
    name: 'supplier_detail',
    description:
      'Get detailed info for a supplier including their product catalog and recent orders',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string' as const,
          description: 'Supplier ID',
        },
      },
      required: ['id'] as const,
    },
    metadata: {
      category: 'suppliers',
      tags: ['supplier', 'detail', 'crm'],
    },
  },
  {
    name: 'supplier_delete',
    description: 'Deactivate a supplier (sets status to inactive, does not delete data)',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string' as const,
          description: 'Supplier ID to deactivate',
        },
      },
      required: ['id'] as const,
    },
    metadata: {
      category: 'suppliers',
      tags: ['supplier', 'delete', 'deactivate', 'crm'],
    },
  },
  {
    name: 'supplier_product_add',
    description:
      'Link a product to a supplier with cost, MOQ, lead time — build a multi-supplier catalog',
    input_schema: {
      type: 'object' as const,
      properties: {
        supplier_id: {
          type: 'string' as const,
          description: 'Supplier ID',
        },
        product_id: {
          type: 'string' as const,
          description: 'Product ID from products table',
        },
        sku: {
          type: 'string' as const,
          description: 'Your internal SKU',
        },
        supplier_sku: {
          type: 'string' as const,
          description: 'Supplier\'s SKU/item number',
        },
        unit_cost: {
          type: 'number' as const,
          description: 'Cost per unit in USD',
        },
        moq: {
          type: 'number' as const,
          description: 'Minimum order quantity (default: 1)',
        },
        lead_time_days: {
          type: 'number' as const,
          description: 'Lead time in days for this product from this supplier',
        },
        is_preferred: {
          type: 'boolean' as const,
          description: 'Set as preferred supplier for this product',
        },
        notes: {
          type: 'string' as const,
          description: 'Notes about this product-supplier link',
        },
      },
      required: ['supplier_id', 'unit_cost'] as const,
    },
    metadata: {
      category: 'suppliers',
      tags: ['supplier', 'product', 'add', 'catalog', 'cost'],
    },
  },
  {
    name: 'supplier_product_list',
    description: 'List all products supplied by a given supplier, or all suppliers for a given product',
    input_schema: {
      type: 'object' as const,
      properties: {
        supplier_id: {
          type: 'string' as const,
          description: 'List products for this supplier',
        },
        product_id: {
          type: 'string' as const,
          description: 'List suppliers for this product (alternative to supplier_id)',
        },
      },
    },
    metadata: {
      category: 'suppliers',
      tags: ['supplier', 'product', 'list', 'catalog'],
    },
  },
  {
    name: 'supplier_set_preferred',
    description:
      'Set a supplier as the preferred (default) source for a specific product',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: {
          type: 'string' as const,
          description: 'Product ID',
        },
        supplier_id: {
          type: 'string' as const,
          description: 'Supplier ID to make preferred',
        },
      },
      required: ['product_id', 'supplier_id'] as const,
    },
    metadata: {
      category: 'suppliers',
      tags: ['supplier', 'product', 'preferred', 'default'],
    },
  },
  {
    name: 'supplier_order_create',
    description:
      'Create a purchase order (PO) to a supplier with line items — tracks cost, shipping, and delivery',
    input_schema: {
      type: 'object' as const,
      properties: {
        supplier_id: {
          type: 'string' as const,
          description: 'Supplier to order from',
        },
        order_number: {
          type: 'string' as const,
          description: 'Custom PO number (auto-generated if omitted)',
        },
        items: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              product_id: { type: 'string' as const, description: 'Product ID' },
              sku: { type: 'string' as const, description: 'SKU' },
              quantity: { type: 'number' as const, description: 'Quantity to order' },
              unit_cost: { type: 'number' as const, description: 'Cost per unit' },
            },
            required: ['quantity', 'unit_cost'] as const,
          },
          description: 'Line items for the purchase order',
        },
        shipping_cost: {
          type: 'number' as const,
          description: 'Shipping cost in USD',
        },
        expected_delivery: {
          type: 'number' as const,
          description: 'Expected delivery date (Unix ms timestamp)',
        },
        notes: {
          type: 'string' as const,
          description: 'Order notes',
        },
      },
      required: ['supplier_id', 'items'] as const,
    },
    metadata: {
      category: 'suppliers',
      tags: ['supplier', 'order', 'purchase', 'po', 'create'],
    },
  },
  {
    name: 'supplier_order_update',
    description:
      'Update a purchase order\'s status (draft → submitted → confirmed → shipped → received/cancelled)',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: {
          type: 'string' as const,
          description: 'Order ID to update',
        },
        status: {
          type: 'string' as const,
          enum: ['draft', 'submitted', 'confirmed', 'shipped', 'received', 'cancelled'] as const,
          description: 'New order status',
        },
        tracking_number: {
          type: 'string' as const,
          description: 'Tracking number (for shipped status)',
        },
        expected_delivery: {
          type: 'number' as const,
          description: 'Updated expected delivery (Unix ms)',
        },
        notes: {
          type: 'string' as const,
          description: 'Updated notes',
        },
      },
      required: ['order_id', 'status'] as const,
    },
    metadata: {
      category: 'suppliers',
      tags: ['supplier', 'order', 'update', 'status', 'po'],
    },
  },
  {
    name: 'supplier_order_receive',
    description:
      'Mark a purchase order as received — updates supplier stats (total orders, total spent, last order date)',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: {
          type: 'string' as const,
          description: 'Order ID to mark received',
        },
        actual_delivery: {
          type: 'number' as const,
          description: 'Actual delivery date (Unix ms, defaults to now)',
        },
      },
      required: ['order_id'] as const,
    },
    metadata: {
      category: 'suppliers',
      tags: ['supplier', 'order', 'receive', 'delivery', 'po'],
    },
  },
  {
    name: 'supplier_order_list',
    description: 'List purchase orders — filter by supplier and/or status',
    input_schema: {
      type: 'object' as const,
      properties: {
        supplier_id: {
          type: 'string' as const,
          description: 'Filter by supplier',
        },
        status: {
          type: 'string' as const,
          enum: ['draft', 'submitted', 'confirmed', 'shipped', 'received', 'cancelled'] as const,
          description: 'Filter by status',
        },
        limit: { type: 'number' as const, description: 'Max results (default: 50)' },
        offset: { type: 'number' as const, description: 'Pagination offset' },
      },
    },
    metadata: {
      category: 'suppliers',
      tags: ['supplier', 'order', 'list', 'po'],
    },
  },
  {
    name: 'supplier_performance',
    description:
      'Calculate a supplier\'s performance score based on on-time delivery, quality, price competitiveness, and rating',
    input_schema: {
      type: 'object' as const,
      properties: {
        supplier_id: {
          type: 'string' as const,
          description: 'Supplier ID to evaluate',
        },
      },
      required: ['supplier_id'] as const,
    },
    metadata: {
      category: 'suppliers',
      tags: ['supplier', 'performance', 'score', 'ranking'],
    },
  },
  {
    name: 'supplier_rankings',
    description:
      'Rank all active suppliers by overall performance score (on-time delivery, quality, price, rating)',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
    metadata: {
      category: 'suppliers',
      tags: ['supplier', 'ranking', 'leaderboard', 'performance'],
    },
  },
  {
    name: 'reorder_alerts',
    description:
      'Check which products need reordering based on current stock vs sales velocity — suggests preferred supplier and quantity',
    input_schema: {
      type: 'object' as const,
      properties: {
        reorder_multiplier: {
          type: 'number' as const,
          description: 'Reorder at N times weekly average sales (default: 2)',
        },
        min_stock: {
          type: 'number' as const,
          description: 'Absolute minimum stock threshold (default: 5)',
        },
      },
    },
    metadata: {
      category: 'suppliers',
      tags: ['reorder', 'alert', 'inventory', 'stock', 'replenish'],
    },
  },
  {
    name: 'supplier_price_compare',
    description:
      'Compare prices across all suppliers for a given product — shows cheapest, fastest, and preferred',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: {
          type: 'string' as const,
          description: 'Product ID to compare supplier prices for',
        },
      },
      required: ['product_id'] as const,
    },
    metadata: {
      category: 'suppliers',
      tags: ['supplier', 'price', 'compare', 'cost', 'sourcing'],
    },
  },
  {
    name: 'supplier_stats',
    description:
      'Get an overview of the supplier CRM — total suppliers, total spend, avg lead time, top suppliers, platform breakdown',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
    metadata: {
      category: 'suppliers',
      tags: ['supplier', 'stats', 'overview', 'dashboard'],
    },
  },
];

// =============================================================================
// Tool Handler
// =============================================================================

/**
 * Handle supplier CRM tool invocations.
 *
 * @param toolName - The name of the tool being called
 * @param input - The tool input parameters
 * @param db - Database instance
 */
export function handleSupplierCrmTool(
  toolName: string,
  input: Record<string, unknown>,
  db: Database,
): unknown {
  try {
    switch (toolName) {
      // ── supplier_create ─────────────────────────────────────────────────
      case 'supplier_create': {
        const name = input.name as string | undefined;
        if (!name?.trim()) {
          return { error: 'name is required' };
        }

        const supplier = createSupplier(db, {
          name: name.trim(),
          contactName: (input.contact_name as string) ?? undefined,
          email: (input.email as string) ?? undefined,
          phone: (input.phone as string) ?? undefined,
          website: (input.website as string) ?? undefined,
          platform: (input.platform as string) ?? undefined,
          paymentTerms: (input.payment_terms as string) ?? undefined,
          minOrderAmount: input.min_order_amount != null ? Number(input.min_order_amount) : undefined,
          shippingRegion: (input.shipping_region as string) ?? undefined,
          avgLeadTimeDays: input.avg_lead_time_days != null ? Number(input.avg_lead_time_days) : undefined,
          rating: input.rating != null ? Number(input.rating) : undefined,
          notes: (input.notes as string) ?? undefined,
          tags: input.tags as string[] | undefined,
        });

        return {
          success: true,
          supplier: {
            id: supplier.id,
            name: supplier.name,
            platform: supplier.platform,
            paymentTerms: supplier.paymentTerms,
            rating: supplier.rating,
            status: supplier.status,
          },
        };
      }

      // ── supplier_update ─────────────────────────────────────────────────
      case 'supplier_update': {
        const id = input.id as string | undefined;
        if (!id?.trim()) {
          return { error: 'id is required' };
        }

        const updated = updateSupplier(db, id.trim(), {
          name: input.name as string | undefined,
          contactName: input.contact_name as string | undefined,
          email: input.email as string | undefined,
          phone: input.phone as string | undefined,
          website: input.website as string | undefined,
          platform: input.platform as string | undefined,
          paymentTerms: input.payment_terms as string | undefined,
          minOrderAmount: input.min_order_amount != null ? Number(input.min_order_amount) : undefined,
          shippingRegion: input.shipping_region as string | undefined,
          avgLeadTimeDays: input.avg_lead_time_days != null ? Number(input.avg_lead_time_days) : undefined,
          rating: input.rating != null ? Number(input.rating) : undefined,
          notes: input.notes as string | undefined,
          tags: input.tags as string[] | undefined,
          status: input.status as 'active' | 'inactive' | 'blacklisted' | undefined,
        });

        if (!updated) {
          return { error: `Supplier not found: ${id}` };
        }

        return {
          success: true,
          supplier: {
            id: updated.id,
            name: updated.name,
            platform: updated.platform,
            rating: updated.rating,
            status: updated.status,
            updatedAt: new Date(updated.updatedAt).toISOString(),
          },
        };
      }

      // ── supplier_list ───────────────────────────────────────────────────
      case 'supplier_list': {
        const suppliers = getSuppliers(db, {
          status: input.status as string | undefined,
          platform: input.platform as string | undefined,
          search: input.search as string | undefined,
          minRating: input.min_rating != null ? Number(input.min_rating) : undefined,
          tags: input.tags as string[] | undefined,
          limit: input.limit != null ? Number(input.limit) : undefined,
          offset: input.offset != null ? Number(input.offset) : undefined,
        });

        return {
          success: true,
          count: suppliers.length,
          suppliers: suppliers.map((s) => ({
            id: s.id,
            name: s.name,
            platform: s.platform,
            paymentTerms: s.paymentTerms,
            rating: s.rating,
            status: s.status,
            totalOrders: s.totalOrders,
            totalSpent: s.totalSpent,
            avgLeadTimeDays: s.avgLeadTimeDays,
            tags: s.tags,
          })),
        };
      }

      // ── supplier_detail ─────────────────────────────────────────────────
      case 'supplier_detail': {
        const id = input.id as string | undefined;
        if (!id?.trim()) {
          return { error: 'id is required' };
        }

        const supplier = getSupplier(db, id.trim());
        if (!supplier) {
          return { error: `Supplier not found: ${id}` };
        }

        const products = getSupplierProducts(db, id.trim());
        const orders = getSupplierOrders(db, { supplierId: id.trim(), limit: 10 });

        return {
          success: true,
          supplier: {
            ...supplier,
            createdAt: new Date(supplier.createdAt).toISOString(),
            updatedAt: new Date(supplier.updatedAt).toISOString(),
            lastOrderAt: supplier.lastOrderAt ? new Date(supplier.lastOrderAt).toISOString() : null,
          },
          products: products.map((p) => ({
            id: p.id,
            productId: p.productId,
            sku: p.sku,
            supplierSku: p.supplierSku,
            unitCost: p.unitCost,
            moq: p.moq,
            leadTimeDays: p.leadTimeDays,
            isPreferred: p.isPreferred,
          })),
          recentOrders: orders.map((o) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            status: o.status,
            total: o.total,
            itemCount: o.items.length,
            createdAt: new Date(o.createdAt).toISOString(),
          })),
        };
      }

      // ── supplier_delete ─────────────────────────────────────────────────
      case 'supplier_delete': {
        const id = input.id as string | undefined;
        if (!id?.trim()) {
          return { error: 'id is required' };
        }

        const deleted = deleteSupplier(db, id.trim());
        if (!deleted) {
          return { error: `Supplier not found: ${id}` };
        }

        return { success: true, message: 'Supplier deactivated', id: id.trim() };
      }

      // ── supplier_product_add ────────────────────────────────────────────
      case 'supplier_product_add': {
        const supplierId = input.supplier_id as string | undefined;
        if (!supplierId?.trim()) {
          return { error: 'supplier_id is required' };
        }

        const unitCost = Number(input.unit_cost);
        if (!Number.isFinite(unitCost) || unitCost < 0) {
          return { error: 'unit_cost must be a non-negative number' };
        }

        const product = addSupplierProduct(db, {
          supplierId: supplierId.trim(),
          productId: (input.product_id as string) ?? undefined,
          sku: (input.sku as string) ?? undefined,
          supplierSku: (input.supplier_sku as string) ?? undefined,
          unitCost,
          moq: input.moq != null ? Number(input.moq) : undefined,
          leadTimeDays: input.lead_time_days != null ? Number(input.lead_time_days) : undefined,
          isPreferred: input.is_preferred === true,
          notes: (input.notes as string) ?? undefined,
        });

        return {
          success: true,
          supplierProduct: {
            id: product.id,
            supplierId: product.supplierId,
            productId: product.productId,
            unitCost: product.unitCost,
            moq: product.moq,
            leadTimeDays: product.leadTimeDays,
            isPreferred: product.isPreferred,
          },
        };
      }

      // ── supplier_product_list ───────────────────────────────────────────
      case 'supplier_product_list': {
        const supplierId = input.supplier_id as string | undefined;
        const productId = input.product_id as string | undefined;

        if (!supplierId && !productId) {
          return { error: 'Either supplier_id or product_id is required' };
        }

        let products;
        if (supplierId) {
          products = getSupplierProducts(db, supplierId.trim());
        } else {
          products = getProductSuppliers(db, productId!.trim());
        }

        return {
          success: true,
          count: products.length,
          products: products.map((p) => ({
            id: p.id,
            supplierId: p.supplierId,
            productId: p.productId,
            sku: p.sku,
            supplierSku: p.supplierSku,
            unitCost: p.unitCost,
            moq: p.moq,
            leadTimeDays: p.leadTimeDays,
            isPreferred: p.isPreferred,
            notes: p.notes,
          })),
        };
      }

      // ── supplier_set_preferred ──────────────────────────────────────────
      case 'supplier_set_preferred': {
        const productId = input.product_id as string | undefined;
        const supplierId = input.supplier_id as string | undefined;

        if (!productId?.trim()) {
          return { error: 'product_id is required' };
        }
        if (!supplierId?.trim()) {
          return { error: 'supplier_id is required' };
        }

        const ok = setPreferredSupplier(db, productId.trim(), supplierId.trim());
        if (!ok) {
          return { error: 'No supplier-product link found for that combination' };
        }

        return {
          success: true,
          message: 'Preferred supplier set',
          productId: productId.trim(),
          supplierId: supplierId.trim(),
        };
      }

      // ── supplier_order_create ───────────────────────────────────────────
      case 'supplier_order_create': {
        const supplierId = input.supplier_id as string | undefined;
        if (!supplierId?.trim()) {
          return { error: 'supplier_id is required' };
        }

        const items = input.items as Array<{
          product_id?: string;
          sku?: string;
          quantity: number;
          unit_cost: number;
        }> | undefined;

        if (!items || !Array.isArray(items) || items.length === 0) {
          return { error: 'items array is required and must not be empty' };
        }

        const order = createSupplierOrder(db, {
          supplierId: supplierId.trim(),
          orderNumber: (input.order_number as string) ?? undefined,
          items: items.map((item) => ({
            productId: item.product_id,
            sku: item.sku,
            quantity: Number(item.quantity) || 1,
            unitCost: Number(item.unit_cost) || 0,
          })),
          shippingCost: input.shipping_cost != null ? Number(input.shipping_cost) : undefined,
          expectedDelivery: input.expected_delivery != null ? Number(input.expected_delivery) : undefined,
          notes: (input.notes as string) ?? undefined,
        });

        return {
          success: true,
          order: {
            id: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
            itemCount: order.items.length,
            subtotal: order.subtotal,
            shippingCost: order.shippingCost,
            total: order.total,
            createdAt: new Date(order.createdAt).toISOString(),
          },
        };
      }

      // ── supplier_order_update ───────────────────────────────────────────
      case 'supplier_order_update': {
        const orderId = input.order_id as string | undefined;
        const status = input.status as string | undefined;

        if (!orderId?.trim()) {
          return { error: 'order_id is required' };
        }
        if (!status?.trim()) {
          return { error: 'status is required' };
        }

        const order = updateSupplierOrderStatus(db, orderId.trim(), status.trim(), {
          trackingNumber: input.tracking_number as string | undefined,
          expectedDelivery: input.expected_delivery != null ? Number(input.expected_delivery) : undefined,
          notes: input.notes as string | undefined,
        });

        if (!order) {
          return { error: `Order not found: ${orderId}` };
        }

        return {
          success: true,
          order: {
            id: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
            total: order.total,
            trackingNumber: order.trackingNumber,
            updatedAt: new Date(order.updatedAt).toISOString(),
          },
        };
      }

      // ── supplier_order_receive ──────────────────────────────────────────
      case 'supplier_order_receive': {
        const orderId = input.order_id as string | undefined;
        if (!orderId?.trim()) {
          return { error: 'order_id is required' };
        }

        const delivery = input.actual_delivery != null ? Number(input.actual_delivery) : undefined;
        const order = receiveSupplierOrder(db, orderId.trim(), delivery);

        if (!order) {
          return { error: `Order not found: ${orderId}` };
        }

        return {
          success: true,
          order: {
            id: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
            total: order.total,
            actualDelivery: order.actualDelivery ? new Date(order.actualDelivery).toISOString() : null,
          },
          message: 'Order received — supplier stats updated',
        };
      }

      // ── supplier_order_list ─────────────────────────────────────────────
      case 'supplier_order_list': {
        const orders = getSupplierOrders(db, {
          supplierId: input.supplier_id as string | undefined,
          status: input.status as string | undefined,
          limit: input.limit != null ? Number(input.limit) : undefined,
          offset: input.offset != null ? Number(input.offset) : undefined,
        });

        return {
          success: true,
          count: orders.length,
          orders: orders.map((o) => ({
            id: o.id,
            supplierId: o.supplierId,
            orderNumber: o.orderNumber,
            status: o.status,
            itemCount: o.items.length,
            subtotal: o.subtotal,
            shippingCost: o.shippingCost,
            total: o.total,
            trackingNumber: o.trackingNumber,
            expectedDelivery: o.expectedDelivery ? new Date(o.expectedDelivery).toISOString() : null,
            actualDelivery: o.actualDelivery ? new Date(o.actualDelivery).toISOString() : null,
            createdAt: new Date(o.createdAt).toISOString(),
          })),
        };
      }

      // ── supplier_performance ────────────────────────────────────────────
      case 'supplier_performance': {
        const supplierId = input.supplier_id as string | undefined;
        if (!supplierId?.trim()) {
          return { error: 'supplier_id is required' };
        }

        const perf = calculateSupplierPerformance(db, supplierId.trim());
        if (!perf) {
          return { error: `Supplier not found: ${supplierId}` };
        }

        return {
          success: true,
          performance: {
            supplierId: perf.supplierId,
            supplierName: perf.supplierName,
            totalOrders: perf.totalOrders,
            onTimeDeliveryPct: perf.onTimeDeliveryPct,
            avgLeadTimeDays: perf.avgLeadTimeDays,
            qualityScore: perf.qualityScore,
            priceCompetitiveness: perf.priceCompetitiveness,
            overallScore: perf.overallScore,
          },
        };
      }

      // ── supplier_rankings ───────────────────────────────────────────────
      case 'supplier_rankings': {
        const rankings = rankSuppliers(db);

        return {
          success: true,
          count: rankings.length,
          rankings: rankings.map((r, idx) => ({
            rank: idx + 1,
            supplierId: r.supplierId,
            supplierName: r.supplierName,
            overallScore: r.overallScore,
            totalOrders: r.totalOrders,
            onTimeDeliveryPct: r.onTimeDeliveryPct,
            qualityScore: r.qualityScore,
            priceCompetitiveness: r.priceCompetitiveness,
          })),
        };
      }

      // ── reorder_alerts ──────────────────────────────────────────────────
      case 'reorder_alerts': {
        const alerts = checkReorderAlerts(db, {
          reorderPointMultiplier: input.reorder_multiplier != null ? Number(input.reorder_multiplier) : undefined,
          minStockThreshold: input.min_stock != null ? Number(input.min_stock) : undefined,
        });

        return {
          success: true,
          count: alerts.length,
          alerts: alerts.map((a) => ({
            productId: a.productId,
            productName: a.productName,
            currentStock: a.currentStock,
            reorderPoint: a.reorderPoint,
            suggestedQuantity: a.suggestedQuantity,
            preferredSupplier: a.preferredSupplier,
            estimatedCost: a.estimatedCost,
            urgency: a.urgency,
          })),
        };
      }

      // ── supplier_price_compare ──────────────────────────────────────────
      case 'supplier_price_compare': {
        const productId = input.product_id as string | undefined;
        if (!productId?.trim()) {
          return { error: 'product_id is required' };
        }

        const comparison = compareSupplierPrices(db, productId.trim());
        if (!comparison) {
          return { error: `Product not found: ${productId}` };
        }

        return {
          success: true,
          productId: comparison.productId,
          productName: comparison.productName,
          supplierCount: comparison.suppliers.length,
          suppliers: comparison.suppliers.map((s) => ({
            supplierId: s.supplierId,
            supplierName: s.supplierName,
            unitCost: s.unitCost,
            moq: s.moq,
            leadTimeDays: s.leadTimeDays,
            isPreferred: s.isPreferred,
            lastPriceAt: s.lastPriceAt ? new Date(s.lastPriceAt).toISOString() : null,
          })),
          cheapest: comparison.cheapest,
          fastest: comparison.fastest,
        };
      }

      // ── supplier_stats ──────────────────────────────────────────────────
      case 'supplier_stats': {
        const stats = getSupplierStats(db);

        return {
          success: true,
          stats: {
            totalSuppliers: stats.totalSuppliers,
            activeSuppliers: stats.activeSuppliers,
            totalSpent: stats.totalSpent,
            totalOrders: stats.totalOrders,
            avgLeadTimeDays: stats.avgLeadTimeDays,
            avgRating: stats.avgRating,
            topSuppliersBySpend: stats.topSuppliersBySpend,
            topSuppliersByOrders: stats.topSuppliersByOrders,
            platformBreakdown: stats.platformBreakdown,
          },
        };
      }

      default:
        return { error: `Unknown supplier CRM tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Supplier CRM error: ${message}` };
  }
}
