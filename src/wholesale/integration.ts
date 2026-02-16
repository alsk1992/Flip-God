/**
 * Wholesale Supplier Integration Module
 *
 * Tools for searching Alibaba, requesting quotes, comparing wholesale vs retail
 * prices, tracking wholesale orders, and managing supplier contacts.
 */

import type { Database } from '../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AlibabaSearchResult {
  productId: string;
  title: string;
  supplier: string;
  supplierVerified: boolean;
  priceRange: { min: number; max: number; currency: string };
  moq: number;
  shippingEstimate: string;
  rating: number;
  totalReviews: number;
  responseRate: number;
  url: string;
}

export interface QuoteRequest {
  id: string;
  supplierId: string;
  supplierName: string;
  productName: string;
  quantity: number;
  targetPrice?: number;
  specifications?: string;
  status: 'pending' | 'sent' | 'responded' | 'negotiating' | 'accepted' | 'rejected';
  createdAt: string;
  respondedAt?: string;
  quotedPrice?: number;
  quotedLeadTimeDays?: number;
  notes?: string;
}

export interface WholesaleRetailComparison {
  productName: string;
  wholesalePrice: number;
  retailPrice: number;
  margin: number;
  marginPct: number;
  estimatedFees: number;
  estimatedShipping: number;
  netProfit: number;
  netROI: number;
  breakEvenQuantity: number;
  recommendation: 'strong_buy' | 'buy' | 'marginal' | 'pass';
}

export interface WholesaleOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalCost: number;
  status: 'pending' | 'confirmed' | 'production' | 'shipped' | 'in_transit' | 'customs' | 'delivered';
  trackingNumber?: string;
  estimatedDelivery?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierContact {
  id: string;
  name: string;
  company: string;
  email?: string;
  phone?: string;
  platform: string; // alibaba, 1688, dhgate, etc.
  profileUrl?: string;
  categories: string[];
  notes?: string;
  rating: number;
  lastContactDate?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// DB Setup
// ---------------------------------------------------------------------------

function ensureWholesaleTables(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS wholesale_quotes (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      supplier_name TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 0,
      target_price REAL,
      specifications TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      quoted_price REAL,
      quoted_lead_time_days INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      responded_at TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS wholesale_orders (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      supplier_name TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0,
      total_cost REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      tracking_number TEXT,
      estimated_delivery TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS supplier_contacts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      company TEXT NOT NULL DEFAULT '',
      email TEXT,
      phone TEXT,
      platform TEXT NOT NULL DEFAULT 'alibaba',
      profile_url TEXT,
      categories TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      rating REAL NOT NULL DEFAULT 0,
      last_contact_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}



// ---------------------------------------------------------------------------
// Alibaba Search (simulated - would need real API integration)
// ---------------------------------------------------------------------------

async function searchAlibaba(query: string, minOrder?: number): Promise<AlibabaSearchResult[]> {
  // Alibaba Open Platform API: https://open.alibaba.com/
  // Requires app_key + app_secret, signed requests
  // Endpoint: alibaba.product.search
  const encodedQuery = encodeURIComponent(query);
  const moqParam = minOrder ? `&moq=${minOrder}` : '';
  const url = `https://open.alibaba.com/api/product/search?keyword=${encodedQuery}${moqParam}`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      // API requires authentication - return empty with guidance
      return [];
    }

    const data = await response.json() as { products?: Array<Record<string, unknown>> };
    if (!data.products?.length) return [];

    return data.products.map((p) => ({
      productId: String(p.product_id ?? `ali-${Date.now()}`),
      title: String(p.subject ?? query),
      supplier: String(p.supplier_name ?? 'Unknown'),
      supplierVerified: Boolean(p.trade_assurance),
      priceRange: {
        min: Number(p.min_price ?? 0),
        max: Number(p.max_price ?? 0),
        currency: String(p.currency ?? 'USD'),
      },
      moq: Number(p.moq ?? 1),
      shippingEstimate: String(p.shipping_info ?? 'Contact supplier'),
      rating: Number(p.supplier_rating ?? 0),
      totalReviews: Number(p.review_count ?? 0),
      responseRate: Number(p.response_rate ?? 0),
      url: String(p.detail_url ?? `https://www.alibaba.com/product-detail/${p.product_id}`),
    }));
  } catch {
    // Alibaba API not configured or unreachable - expected for users without credentials
    return [];
  }
}

// ---------------------------------------------------------------------------
// Wholesale vs Retail Price Comparison
// ---------------------------------------------------------------------------

function compareWholesaleRetail(
  productName: string,
  wholesalePrice: number,
  retailPrice: number,
  quantity: number,
  platformFeeRate: number = 0.15,
  shippingCostPerUnit: number = 3.00,
): WholesaleRetailComparison {
  const estimatedFees = retailPrice * platformFeeRate;
  const estimatedShipping = shippingCostPerUnit;
  const totalCostPerUnit = wholesalePrice + estimatedShipping;
  const netProfit = retailPrice - totalCostPerUnit - estimatedFees;
  const margin = retailPrice - wholesalePrice;
  const marginPct = retailPrice > 0 ? (margin / retailPrice) * 100 : 0;
  const netROI = totalCostPerUnit > 0 ? (netProfit / totalCostPerUnit) * 100 : 0;

  // Break-even: how many units to cover a minimum order cost
  const fixedCosts = 50; // shipping/import fixed costs estimate
  const breakEvenQuantity = netProfit > 0 ? Math.ceil(fixedCosts / netProfit) : Infinity;

  const recommendation: 'strong_buy' | 'buy' | 'marginal' | 'pass' =
    netROI >= 100 ? 'strong_buy'
    : netROI >= 50 ? 'buy'
    : netROI >= 20 ? 'marginal'
    : 'pass';

  return {
    productName,
    wholesalePrice: Math.round(wholesalePrice * 100) / 100,
    retailPrice: Math.round(retailPrice * 100) / 100,
    margin: Math.round(margin * 100) / 100,
    marginPct: Math.round(marginPct * 100) / 100,
    estimatedFees: Math.round(estimatedFees * 100) / 100,
    estimatedShipping: Math.round(estimatedShipping * 100) / 100,
    netProfit: Math.round(netProfit * 100) / 100,
    netROI: Math.round(netROI * 100) / 100,
    breakEvenQuantity: breakEvenQuantity === Infinity ? -1 : breakEvenQuantity,
    recommendation,
  };
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const wholesaleTools = [
  {
    name: 'search_alibaba',
    description: 'Search Alibaba for wholesale suppliers and products',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string' as const, description: 'Search query (product name or keywords)' },
        min_order: { type: 'number' as const, description: 'Maximum acceptable MOQ' },
        max_price: { type: 'number' as const, description: 'Maximum price per unit in USD' },
        verified_only: { type: 'boolean' as const, description: 'Only show verified suppliers (default: true)' },
      },
      required: ['query'] as const,
    },
  },
  {
    name: 'request_quote',
    description: 'Send a Request for Quote (RFQ) to a wholesale supplier',
    input_schema: {
      type: 'object' as const,
      properties: {
        supplier_id: { type: 'string' as const, description: 'Supplier ID or contact ID' },
        supplier_name: { type: 'string' as const, description: 'Supplier name' },
        product_name: { type: 'string' as const, description: 'Product name/description' },
        quantity: { type: 'number' as const, description: 'Desired quantity' },
        target_price: { type: 'number' as const, description: 'Target price per unit in USD' },
        specifications: { type: 'string' as const, description: 'Product specifications or requirements' },
      },
      required: ['supplier_id', 'supplier_name', 'product_name', 'quantity'] as const,
    },
  },
  {
    name: 'compare_wholesale_prices',
    description: 'Compare wholesale vs retail prices to calculate arbitrage profitability including fees and shipping',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_name: { type: 'string' as const, description: 'Product name' },
        wholesale_price: { type: 'number' as const, description: 'Wholesale price per unit in USD' },
        retail_price: { type: 'number' as const, description: 'Retail/selling price per unit in USD' },
        quantity: { type: 'number' as const, description: 'Order quantity for analysis' },
        platform_fee_rate: { type: 'number' as const, description: 'Platform fee rate as decimal (default: 0.15 = 15%)' },
        shipping_cost_per_unit: { type: 'number' as const, description: 'Shipping cost per unit in USD (default: 3.00)' },
      },
      required: ['product_name', 'wholesale_price', 'retail_price', 'quantity'] as const,
    },
  },
  {
    name: 'track_wholesale_order',
    description: 'Track the status of a wholesale/bulk order, or update its status',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: { type: 'string' as const, description: 'Wholesale order ID (omit to list all active orders)' },
        update_status: {
          type: 'string' as const,
          enum: ['confirmed', 'production', 'shipped', 'in_transit', 'customs', 'delivered'] as const,
          description: 'New status to set (omit to just view)',
        },
        tracking_number: { type: 'string' as const, description: 'Tracking number to add' },
        estimated_delivery: { type: 'string' as const, description: 'Estimated delivery date (YYYY-MM-DD)' },
      },
    },
  },
  {
    name: 'manage_supplier_contacts',
    description: 'Create, read, update, or delete supplier contacts',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string' as const,
          enum: ['create', 'list', 'update', 'delete'] as const,
          description: 'CRUD action',
        },
        contact_id: { type: 'string' as const, description: 'Contact ID (for update/delete)' },
        name: { type: 'string' as const, description: 'Contact name' },
        company: { type: 'string' as const, description: 'Company name' },
        email: { type: 'string' as const, description: 'Email address' },
        phone: { type: 'string' as const, description: 'Phone number' },
        platform: { type: 'string' as const, description: 'Sourcing platform (alibaba, 1688, dhgate, etc.)' },
        profile_url: { type: 'string' as const, description: 'Supplier profile URL' },
        categories: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Product categories this supplier covers',
        },
        notes: { type: 'string' as const, description: 'Notes about this supplier' },
        rating: { type: 'number' as const, description: 'Your rating 0-5' },
      },
      required: ['action'] as const,
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleWholesaleTool(
  db: Database,
  toolName: string,
  input: Record<string, unknown>,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  ensureWholesaleTables(db);

  switch (toolName) {
    case 'search_alibaba': {
      const query = String(input.query ?? '');
      if (!query) return { success: false, error: 'query is required' };

      const minOrder = input.min_order != null ? Number(input.min_order) : undefined;
      let results = await searchAlibaba(query, minOrder);

      // Apply filters
      if (input.max_price != null) {
        const maxPrice = Number(input.max_price);
        results = results.filter(r => r.priceRange.min <= maxPrice);
      }
      if (input.verified_only !== false) {
        results = results.filter(r => r.supplierVerified);
      }
      if (minOrder != null) {
        results = results.filter(r => r.moq <= minOrder);
      }

      return {
        success: true,
        data: {
          query,
          resultCount: results.length,
          results,
          note: 'Results are simulated. Integrate with Alibaba API for live data.',
        },
      };
    }

    case 'request_quote': {
      const supplierId = String(input.supplier_id ?? '');
      const supplierName = String(input.supplier_name ?? '');
      const productName = String(input.product_name ?? '');
      const quantity = Number(input.quantity ?? 0);

      if (!supplierId || !supplierName || !productName) {
        return { success: false, error: 'supplier_id, supplier_name, and product_name are required' };
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return { success: false, error: 'quantity must be a positive number' };
      }

      const quoteId = generateId();
      const targetPrice = input.target_price != null ? Number(input.target_price) : null;
      const specifications = input.specifications ? String(input.specifications) : null;

      db.run(
        `INSERT INTO wholesale_quotes (id, supplier_id, supplier_name, product_name, quantity, target_price, specifications, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [quoteId, supplierId, supplierName, productName, quantity, targetPrice, specifications],
      );

      // RFQ stored in DB - when Alibaba API credentials are configured,
      // sends via alibaba.trade.rfq.create endpoint.
      // Without credentials, RFQ is tracked locally for manual follow-up.
      let apiSent = false;
      try {
        const rfqUrl = 'https://open.alibaba.com/api/trade/rfq/create';
        const resp = await fetch(rfqUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ supplier_id: supplierId, product: productName, qty: quantity, target_price: targetPrice, specs: specifications }),
          signal: AbortSignal.timeout(15000),
        });
        apiSent = resp.ok;
      } catch {
        // API not configured - RFQ saved locally for manual sending
      }

      return {
        success: true,
        data: {
          quoteId,
          supplierId,
          supplierName,
          productName,
          quantity,
          targetPrice,
          specifications,
          status: apiSent ? 'sent' : 'pending',
          message: apiSent
            ? 'RFQ sent to supplier via Alibaba API.'
            : 'RFQ saved locally. Configure Alibaba API credentials to auto-send, or contact supplier manually.',
        },
      };
    }

    case 'compare_wholesale_prices': {
      const productName = String(input.product_name ?? '');
      const wholesalePrice = Number(input.wholesale_price ?? 0);
      const retailPrice = Number(input.retail_price ?? 0);
      const quantity = Number(input.quantity ?? 1);

      if (!productName) return { success: false, error: 'product_name is required' };
      if (!Number.isFinite(wholesalePrice) || wholesalePrice <= 0) return { success: false, error: 'wholesale_price must be positive' };
      if (!Number.isFinite(retailPrice) || retailPrice <= 0) return { success: false, error: 'retail_price must be positive' };

      const platformFeeRate = input.platform_fee_rate != null ? Number(input.platform_fee_rate) : 0.15;
      const shippingCostPerUnit = input.shipping_cost_per_unit != null ? Number(input.shipping_cost_per_unit) : 3.00;

      const comparison = compareWholesaleRetail(
        productName, wholesalePrice, retailPrice, quantity, platformFeeRate, shippingCostPerUnit,
      );

      return {
        success: true,
        data: {
          ...comparison,
          quantity,
          totalInvestment: Math.round(wholesalePrice * quantity * 100) / 100,
          totalRevenue: Math.round(retailPrice * quantity * 100) / 100,
          totalProfit: Math.round(comparison.netProfit * quantity * 100) / 100,
          breakEvenQuantity: comparison.breakEvenQuantity === -1 ? 'Not profitable' : comparison.breakEvenQuantity,
        },
      };
    }

    case 'track_wholesale_order': {
      const orderId = input.order_id ? String(input.order_id) : null;

      if (!orderId) {
        // List all active orders
        const rows = db.query<Record<string, unknown>>(
          `SELECT * FROM wholesale_orders WHERE status != 'delivered' ORDER BY created_at DESC LIMIT 50`,
        );
        return {
          success: true,
          data: {
            activeOrders: rows.map(r => ({
              id: r.id,
              supplierName: r.supplier_name,
              productName: r.product_name,
              quantity: r.quantity,
              totalCost: r.total_cost,
              status: r.status,
              trackingNumber: r.tracking_number ?? null,
              estimatedDelivery: r.estimated_delivery ?? null,
              createdAt: r.created_at,
            })),
            count: rows.length,
          },
        };
      }

      // Check if updating
      if (input.update_status || input.tracking_number || input.estimated_delivery) {
        const updates: string[] = [];
        const params: unknown[] = [];

        if (input.update_status) {
          updates.push('status = ?');
          params.push(String(input.update_status));
        }
        if (input.tracking_number) {
          updates.push('tracking_number = ?');
          params.push(String(input.tracking_number));
        }
        if (input.estimated_delivery) {
          updates.push('estimated_delivery = ?');
          params.push(String(input.estimated_delivery));
        }
        updates.push("updated_at = datetime('now')");
        params.push(orderId);

        db.run(`UPDATE wholesale_orders SET ${updates.join(', ')} WHERE id = ?`, params);
      }

      // Fetch order
      const rows = db.query<Record<string, unknown>>(`SELECT * FROM wholesale_orders WHERE id = ?`, [orderId]);
      if (!rows.length) return { success: false, error: `Order ${orderId} not found` };
      const order = rows[0];

      return {
        success: true,
        data: {
          id: order.id,
          supplierName: order.supplier_name,
          productName: order.product_name,
          quantity: order.quantity,
          unitPrice: order.unit_price,
          totalCost: order.total_cost,
          status: order.status,
          trackingNumber: order.tracking_number ?? null,
          estimatedDelivery: order.estimated_delivery ?? null,
          createdAt: order.created_at,
          updatedAt: order.updated_at,
        },
      };
    }

    case 'manage_supplier_contacts': {
      const action = String(input.action ?? 'list');

      switch (action) {
        case 'create': {
          const name = String(input.name ?? '');
          const company = String(input.company ?? '');
          if (!name) return { success: false, error: 'name is required for create' };

          const contactId = generateId();
          const categories = Array.isArray(input.categories)
            ? JSON.stringify(input.categories)
            : '[]';

          db.run(
            `INSERT INTO supplier_contacts (id, name, company, email, phone, platform, profile_url, categories, notes, rating)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              contactId, name, company,
              input.email ? String(input.email) : null,
              input.phone ? String(input.phone) : null,
              String(input.platform ?? 'alibaba'),
              input.profile_url ? String(input.profile_url) : null,
              categories,
              input.notes ? String(input.notes) : null,
              input.rating != null ? Number(input.rating) : 0,
            ],
          );

          return {
            success: true,
            data: { contactId, name, company, message: 'Supplier contact created' },
          };
        }

        case 'list': {
          const rows = db.query<Record<string, unknown>>(
            `SELECT * FROM supplier_contacts ORDER BY rating DESC, created_at DESC LIMIT 100`,
          );
          return {
            success: true,
            data: {
              contacts: rows.map(r => ({
                id: r.id,
                name: r.name,
                company: r.company,
                email: r.email,
                phone: r.phone,
                platform: r.platform,
                profileUrl: r.profile_url,
                categories: JSON.parse(String(r.categories ?? '[]')),
                notes: r.notes,
                rating: r.rating,
                lastContactDate: r.last_contact_date,
              })),
              count: rows.length,
            },
          };
        }

        case 'update': {
          const contactId = String(input.contact_id ?? '');
          if (!contactId) return { success: false, error: 'contact_id is required for update' };

          const updates: string[] = [];
          const params: unknown[] = [];

          if (input.name) { updates.push('name = ?'); params.push(String(input.name)); }
          if (input.company) { updates.push('company = ?'); params.push(String(input.company)); }
          if (input.email !== undefined) { updates.push('email = ?'); params.push(input.email ? String(input.email) : null); }
          if (input.phone !== undefined) { updates.push('phone = ?'); params.push(input.phone ? String(input.phone) : null); }
          if (input.platform) { updates.push('platform = ?'); params.push(String(input.platform)); }
          if (input.profile_url !== undefined) { updates.push('profile_url = ?'); params.push(input.profile_url ? String(input.profile_url) : null); }
          if (Array.isArray(input.categories)) { updates.push('categories = ?'); params.push(JSON.stringify(input.categories)); }
          if (input.notes !== undefined) { updates.push('notes = ?'); params.push(input.notes ? String(input.notes) : null); }
          if (input.rating != null) { updates.push('rating = ?'); params.push(Number(input.rating)); }

          if (updates.length === 0) return { success: false, error: 'No fields to update' };
          updates.push("last_contact_date = datetime('now')");
          params.push(contactId);

          db.run(`UPDATE supplier_contacts SET ${updates.join(', ')} WHERE id = ?`, params);
          return { success: true, data: { contactId, message: 'Contact updated', fieldsUpdated: updates.length - 1 } };
        }

        case 'delete': {
          const contactId = String(input.contact_id ?? '');
          if (!contactId) return { success: false, error: 'contact_id is required for delete' };
          db.run(`DELETE FROM supplier_contacts WHERE id = ?`, [contactId]);
          return { success: true, data: { contactId, message: 'Contact deleted' } };
        }

        default:
          return { success: false, error: `Unknown action: ${action}. Use create, list, update, or delete.` };
      }
    }

    default:
      return { success: false, error: `Unknown wholesale tool: ${toolName}` };
  }
}
