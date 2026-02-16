/**
 * Supply Chain Module - Tool Definitions & Handler
 */

import type { Database } from '../db/index.js';
import type { Supplier } from './types.js';
import {
  calculateReorderPoint,
  generateSupplierScorecard,
  analyzeSupplyChain,
  compareAlternativeSuppliers,
} from './calculations.js';

export type {
  Supplier,
  SupplierScorecard,
  SupplyChainAnalysis,
  AlternativeSupplier,
  ReorderPointResult,
} from './types.js';

// ---------------------------------------------------------------------------
// SQL: Ensure tables exist
// ---------------------------------------------------------------------------

function ensureSupplyChainTables(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'US',
      lead_time_days INTEGER NOT NULL DEFAULT 7,
      moq INTEGER NOT NULL DEFAULT 1,
      price_per_unit REAL NOT NULL DEFAULT 0,
      reliability_score INTEGER NOT NULL DEFAULT 70,
      on_time_delivery_rate REAL NOT NULL DEFAULT 0.90,
      defect_rate REAL NOT NULL DEFAULT 0.02,
      communication_score INTEGER NOT NULL DEFAULT 70,
      certifications TEXT NOT NULL DEFAULT '[]',
      last_order_date TEXT,
      total_orders INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS supplier_orders (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      product_id TEXT,
      ordered_at TEXT NOT NULL,
      expected_delivery_at TEXT NOT NULL,
      delivered_at TEXT,
      unit_count INTEGER NOT NULL DEFAULT 0,
      price_per_unit REAL NOT NULL DEFAULT 0,
      defect_count INTEGER NOT NULL DEFAULT 0,
      issues TEXT NOT NULL DEFAULT '[]',
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS product_suppliers (
      product_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      avg_monthly_cost REAL NOT NULL DEFAULT 0,
      avg_monthly_units REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (product_id, supplier_id),
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    )
  `);
}

// ---------------------------------------------------------------------------
// DB Helpers
// ---------------------------------------------------------------------------

function rowToSupplier(row: Record<string, unknown>): Supplier {
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    country: String(row.country ?? 'US'),
    leadTimeDays: Number(row.lead_time_days ?? 7),
    moq: Number(row.moq ?? 1),
    pricePerUnit: Number(row.price_per_unit ?? 0),
    reliabilityScore: Number(row.reliability_score ?? 70),
    onTimeDeliveryRate: Number(row.on_time_delivery_rate ?? 0.9),
    defectRate: Number(row.defect_rate ?? 0.02),
    communicationScore: Number(row.communication_score ?? 70),
    certifications: JSON.parse(String(row.certifications ?? '[]')),
    lastOrderDate: row.last_order_date ? String(row.last_order_date) : undefined,
    totalOrders: Number(row.total_orders ?? 0),
    createdAt: String(row.created_at ?? ''),
  };
}



function getProductSupplier(
  db: Database, productId: string,
): { supplier: Supplier; avgMonthlyCost: number; avgMonthlyUnits: number } | null {
  const rows = db.query<Record<string, unknown>>(
    `SELECT s.*, ps.avg_monthly_cost, ps.avg_monthly_units
     FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id
     WHERE ps.product_id = ? AND ps.is_primary = 1 LIMIT 1`, [productId],
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    supplier: rowToSupplier(row),
    avgMonthlyCost: Number(row.avg_monthly_cost ?? 0),
    avgMonthlyUnits: Number(row.avg_monthly_units ?? 0),
  };
}

function getAlternativeSuppliers(db: Database, _productId: string, currentSupplierId?: string): Supplier[] {
  const whereClause = currentSupplierId ? `WHERE s.id != ?` : `WHERE 1=1`;
  const params = currentSupplierId ? [currentSupplierId] : [];
  return db.query<Record<string, unknown>>(`SELECT s.* FROM suppliers s ${whereClause} ORDER BY s.reliability_score DESC LIMIT 20`, params,
  ).map(rowToSupplier);
}

function getSupplierById(db: Database, supplierId: string): Supplier | null {
  const rows = db.query<Record<string, unknown>>(`SELECT * FROM suppliers WHERE id = ? LIMIT 1`, [supplierId]);
  return rows.length ? rowToSupplier(rows[0]) : null;
}

function getSupplierOrders(db: Database, supplierId: string, days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return db.query<Record<string, unknown>>(
    `SELECT * FROM supplier_orders WHERE supplier_id = ? AND ordered_at >= ? ORDER BY ordered_at DESC`,
    [supplierId, cutoff],
  ).map((row) => ({
    orderedAt: String(row.ordered_at ?? ''),
    deliveredAt: row.delivered_at ? String(row.delivered_at) : undefined,
    expectedDeliveryAt: String(row.expected_delivery_at ?? ''),
    unitCount: Number(row.unit_count ?? 0),
    pricePerUnit: Number(row.price_per_unit ?? 0),
    defectCount: Number(row.defect_count ?? 0),
    issues: JSON.parse(String(row.issues ?? '[]')) as string[],
  }));
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const supplyChainTools = [
  {
    name: 'analyze_supply_chain',
    description: 'Analyze supply chain efficiency for a product including lead times, costs, reliability scores, and bottleneck identification',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const, description: 'Product ID to analyze' },
        product_name: { type: 'string' as const, description: 'Product name for display' },
        include_recommendations: { type: 'boolean' as const, description: 'Include improvement recommendations (default: true)' },
      },
      required: ['product_id'] as const,
    },
  },
  {
    name: 'find_alternative_suppliers',
    description: 'Find and compare alternative suppliers for a product. Compares MOQ, price, lead time, and reliability against current supplier.',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const, description: 'Product ID' },
        product_name: { type: 'string' as const, description: 'Product name for search context' },
        current_supplier_id: { type: 'string' as const, description: 'Current supplier ID to compare against' },
        max_results: { type: 'number' as const, description: 'Max alternatives to return (default: 5)' },
        max_lead_time_days: { type: 'number' as const, description: 'Filter: max acceptable lead time in days' },
        max_price_per_unit: { type: 'number' as const, description: 'Filter: max acceptable price per unit' },
        country_preference: { type: 'string' as const, description: 'Preferred supplier country (e.g. US, CN)' },
      },
      required: ['product_id', 'product_name'] as const,
    },
  },
  {
    name: 'calculate_reorder_point',
    description: 'Calculate optimal reorder point, safety stock, and economic order quantity based on lead time, demand variability, and service level targets',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const, description: 'Product ID' },
        avg_daily_demand: { type: 'number' as const, description: 'Average daily demand (units)' },
        demand_std_dev: { type: 'number' as const, description: 'Standard deviation of daily demand (default: 20% of avg)' },
        lead_time_days: { type: 'number' as const, description: 'Supplier lead time in days' },
        lead_time_std_dev: { type: 'number' as const, description: 'Standard deviation of lead time in days (default: 1)' },
        service_level: { type: 'number' as const, description: 'Target service level 0-1 (default: 0.95 = 95%)' },
        current_stock: { type: 'number' as const, description: 'Current stock quantity' },
        unit_cost: { type: 'number' as const, description: 'Cost per unit in dollars' },
        holding_cost_pct: { type: 'number' as const, description: 'Annual holding cost as fraction of unit cost (default: 0.25)' },
        order_cost: { type: 'number' as const, description: 'Fixed cost per order in dollars (default: 50)' },
      },
      required: ['product_id', 'avg_daily_demand', 'lead_time_days', 'current_stock', 'unit_cost'] as const,
    },
  },
  {
    name: 'supplier_scorecard',
    description: 'Generate a supplier performance scorecard covering on-time delivery, defect rate, cost trends, and overall recommendation',
    input_schema: {
      type: 'object' as const,
      properties: {
        supplier_id: { type: 'string' as const, description: 'Supplier ID to score' },
        days: { type: 'number' as const, description: 'Look-back period in days (default: 90)' },
      },
      required: ['supplier_id'] as const,
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function handleSupplyChainTool(
  db: Database,
  toolName: string,
  input: Record<string, unknown>,
): { success: boolean; data?: unknown; error?: string } {
  ensureSupplyChainTables(db);

  switch (toolName) {
    case 'analyze_supply_chain': {
      const productId = String(input.product_id ?? '');
      if (!productId) return { success: false, error: 'product_id is required' };
      const productName = String(input.product_name ?? productId);
      const supplierData = getProductSupplier(db, productId);
      const analysis = analyzeSupplyChain(
        productId, productName,
        supplierData?.supplier ?? null,
        supplierData?.avgMonthlyCost ?? 0,
        supplierData?.avgMonthlyUnits ?? 0,
      );
      return {
        success: true,
        data: {
          productId: analysis.productId,
          productName: analysis.productName,
          currentSupplier: analysis.currentSupplier ? {
            id: analysis.currentSupplier.id, name: analysis.currentSupplier.name,
            country: analysis.currentSupplier.country,
            leadTimeDays: analysis.currentSupplier.leadTimeDays,
            reliabilityScore: analysis.currentSupplier.reliabilityScore,
          } : null,
          leadTimeDays: analysis.leadTimeDays,
          avgCostPerUnit: analysis.avgCostPerUnit,
          totalMonthlyCost: analysis.totalCost,
          reliabilityScore: analysis.reliabilityScore,
          bottlenecks: analysis.bottlenecks,
          recommendations: input.include_recommendations !== false ? analysis.recommendations : undefined,
        },
      };
    }

    case 'find_alternative_suppliers': {
      const productId = String(input.product_id ?? '');
      const productName = String(input.product_name ?? '');
      if (!productId || !productName) return { success: false, error: 'product_id and product_name are required' };
      const currentSupplierId = input.current_supplier_id ? String(input.current_supplier_id) : undefined;
      const maxResults = input.max_results != null ? Number(input.max_results) : 5;
      let currentSupplier: Supplier | null = null;
      if (currentSupplierId) {
        currentSupplier = getSupplierById(db, currentSupplierId);
      } else {
        currentSupplier = getProductSupplier(db, productId)?.supplier ?? null;
      }
      let alternatives = getAlternativeSuppliers(db, productId, currentSupplier?.id);
      if (input.max_lead_time_days != null) alternatives = alternatives.filter(s => s.leadTimeDays <= Number(input.max_lead_time_days));
      if (input.max_price_per_unit != null) alternatives = alternatives.filter(s => s.pricePerUnit <= Number(input.max_price_per_unit));
      if (input.country_preference) {
        const pref = String(input.country_preference).toUpperCase();
        alternatives.sort((a, b) => (a.country.toUpperCase() === pref ? 0 : 1) - (b.country.toUpperCase() === pref ? 0 : 1));
      }
      const compared = compareAlternativeSuppliers(currentSupplier, alternatives, maxResults);
      return {
        success: true,
        data: {
          productId, productName,
          currentSupplier: currentSupplier ? {
            id: currentSupplier.id, name: currentSupplier.name,
            pricePerUnit: currentSupplier.pricePerUnit,
            leadTimeDays: currentSupplier.leadTimeDays, moq: currentSupplier.moq,
          } : null,
          alternatives: compared.map(a => ({
            supplierId: a.supplier.id, supplierName: a.supplier.name,
            country: a.supplier.country, pricePerUnit: a.supplier.pricePerUnit,
            leadTimeDays: a.supplier.leadTimeDays, moq: a.supplier.moq,
            reliabilityScore: a.supplier.reliabilityScore,
            costComparisonPct: a.comparisonToCurrentCostPct,
            leadTimeComparisonDays: a.comparisonToCurrentLeadTimeDays,
            overallFitScore: a.overallFitScore, pros: a.pros, cons: a.cons,
          })),
          totalFound: compared.length,
        },
      };
    }

    case 'calculate_reorder_point': {
      const productId = String(input.product_id ?? '');
      const avgDailyDemand = Number(input.avg_daily_demand);
      const leadTimeDays = Number(input.lead_time_days);
      const currentStock = Number(input.current_stock);
      const unitCost = Number(input.unit_cost);
      if (!productId) return { success: false, error: 'product_id is required' };
      if (!Number.isFinite(avgDailyDemand) || avgDailyDemand <= 0) return { success: false, error: 'avg_daily_demand must be a positive number' };
      if (!Number.isFinite(leadTimeDays) || leadTimeDays <= 0) return { success: false, error: 'lead_time_days must be a positive number' };
      if (!Number.isFinite(currentStock) || currentStock < 0) return { success: false, error: 'current_stock must be a non-negative number' };
      if (!Number.isFinite(unitCost) || unitCost <= 0) return { success: false, error: 'unit_cost must be a positive number' };
      const serviceLevel = input.service_level != null ? Number(input.service_level) : 0.95;
      if (!Number.isFinite(serviceLevel) || serviceLevel <= 0 || serviceLevel >= 1) return { success: false, error: 'service_level must be between 0 and 1 exclusive' };
      const demandStdDev = input.demand_std_dev != null ? Number(input.demand_std_dev) : avgDailyDemand * 0.2;
      const leadTimeStdDev = input.lead_time_std_dev != null ? Number(input.lead_time_std_dev) : 1;
      const result = calculateReorderPoint({
        productId, avgDailyDemand, demandStdDev, leadTimeDays, leadTimeStdDev,
        serviceLevel, currentStock, unitCost,
        holdingCostPct: input.holding_cost_pct != null ? Number(input.holding_cost_pct) : undefined,
        orderCost: input.order_cost != null ? Number(input.order_cost) : undefined,
      });
      return {
        success: true,
        data: {
          productId, reorderPoint: result.reorderPoint, safetyStock: result.safetyStock,
          economicOrderQuantity: result.economicOrderQuantity,
          needsReorder: result.needsReorder, currentStock,
          daysOfStockRemaining: result.daysOfStockRemaining === Infinity ? 'N/A (zero demand)' : result.daysOfStockRemaining,
          inputs: { avgDailyDemand, demandStdDev, leadTimeDays, leadTimeStdDev, serviceLevel: `${(serviceLevel * 100).toFixed(1)}%`, unitCost },
          annualCostEstimate: { holdingCost: result.estimatedAnnualHoldingCost, orderCost: result.estimatedAnnualOrderCost, totalCost: result.estimatedTotalAnnualCost },
          recommendation: result.needsReorder
            ? `REORDER NOW: Stock (${currentStock}) is at or below reorder point (${result.reorderPoint}). Order ${result.economicOrderQuantity} units.`
            : `Stock OK: ${result.daysOfStockRemaining === Infinity ? 'N/A' : result.daysOfStockRemaining} days remaining. Reorder when stock reaches ${result.reorderPoint} units.`,
        },
      };
    }

    case 'supplier_scorecard': {
      const supplierId = String(input.supplier_id ?? '');
      if (!supplierId) return { success: false, error: 'supplier_id is required' };
      const days = input.days != null ? Number(input.days) : 90;
      if (!Number.isFinite(days) || days <= 0) return { success: false, error: 'days must be a positive number' };
      const supplier = getSupplierById(db, supplierId);
      if (!supplier) return { success: false, error: `Supplier ${supplierId} not found` };
      const orderHistory = getSupplierOrders(db, supplierId, days);
      if (orderHistory.length === 0) {
        return {
          success: true,
          data: {
            supplierId: supplier.id, supplierName: supplier.name,
            message: `No orders found in the last ${days} days. Scorecard based on supplier profile only.`,
            profileScore: supplier.reliabilityScore, onTimeDeliveryRate: supplier.onTimeDeliveryRate, defectRate: supplier.defectRate,
          },
        };
      }
      const scorecard = generateSupplierScorecard(supplier, orderHistory);
      return {
        success: true,
        data: {
          supplierId: scorecard.supplierId, supplierName: scorecard.supplierName,
          overallScore: scorecard.overallScore, recommendation: scorecard.recommendation,
          metrics: {
            onTimeDeliveryRate: `${(scorecard.onTimeDeliveryRate * 100).toFixed(1)}%`,
            defectRate: `${(scorecard.defectRate * 100).toFixed(2)}%`,
            costTrend: scorecard.costTrend,
            costTrendPct: `${scorecard.costTrendPct > 0 ? '+' : ''}${scorecard.costTrendPct}%`,
            avgLeadTimeDays: scorecard.avgLeadTimeDays, leadTimeVarianceDays: scorecard.leadTimeVarianceDays,
          },
          volume: { totalOrders: scorecard.totalOrders, totalUnits: scorecard.totalUnits, issueCount: scorecard.issueCount },
          period: `Last ${days} days`,
        },
      };
    }

    default:
      return { success: false, error: `Unknown supply chain tool: ${toolName}` };
  }
}
