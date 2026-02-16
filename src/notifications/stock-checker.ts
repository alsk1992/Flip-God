/**
 * Stock Level Checker - Check inventory levels against alert rules
 *
 * Queries warehouse_inventory and listings tables to detect:
 * - stock_low: available quantity below threshold
 * - stock_out: available quantity is zero
 * - back_in_stock: previously zero, now positive
 *
 * Tracks last known stock states to detect transitions.
 */

import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import type { Alert, AlertRule, AlertCheckResult } from './types.js';
import { createAlert } from './alert-engine.js';

const logger = createLogger('stock-checker');

// =============================================================================
// TYPES
// =============================================================================

interface StockLevel {
  sku: string;
  productId: string | null;
  warehouseId: string;
  quantity: number;
  reserved: number;
  available: number;
}

interface ListingStock {
  listingId: string;
  productId: string;
  platform: string;
  status: string;
  /** Listing price, used for alert context */
  price: number;
}

/**
 * In-memory cache of last known stock states for back_in_stock detection.
 * Key: productId or sku, Value: last known available quantity.
 */
const lastKnownStock = new Map<string, number>();

// =============================================================================
// STOCK LEVEL QUERIES
// =============================================================================

/**
 * Get current stock levels from warehouse_inventory.
 */
function getWarehouseStockLevels(db: Database): StockLevel[] {
  try {
    const rows = db.query<Record<string, unknown>>(
      `SELECT wi.sku, wi.product_id, wi.warehouse_id, wi.quantity, wi.reserved
       FROM warehouse_inventory wi
       INNER JOIN warehouses w ON wi.warehouse_id = w.id
       ORDER BY wi.sku`,
    );

    return rows.map((row) => {
      const quantity = (row.quantity as number) ?? 0;
      const reserved = (row.reserved as number) ?? 0;
      return {
        sku: row.sku as string,
        productId: (row.product_id as string) ?? null,
        warehouseId: row.warehouse_id as string,
        quantity: Number.isFinite(quantity) ? quantity : 0,
        reserved: Number.isFinite(reserved) ? reserved : 0,
        available: Math.max(0, quantity - reserved),
      };
    });
  } catch (err) {
    logger.debug({ err }, 'warehouse_inventory query failed (table may not exist yet)');
    return [];
  }
}

/**
 * Get active listings to cross-reference stock status.
 */
function getActiveListings(db: Database): ListingStock[] {
  try {
    const rows = db.query<Record<string, unknown>>(
      "SELECT id, product_id, platform, status, price FROM listings WHERE status = 'active'",
    );

    return rows.map((row) => ({
      listingId: row.id as string,
      productId: row.product_id as string,
      platform: row.platform as string,
      status: row.status as string,
      price: (row.price as number) ?? 0,
    }));
  } catch (err) {
    logger.debug({ err }, 'listings query failed');
    return [];
  }
}

/**
 * Aggregate stock across all warehouses for a product.
 */
function aggregateStockByProduct(levels: StockLevel[]): Map<string, number> {
  const productStock = new Map<string, number>();

  for (const level of levels) {
    if (!level.productId) continue;
    const current = productStock.get(level.productId) ?? 0;
    productStock.set(level.productId, current + level.available);
  }

  return productStock;
}

// =============================================================================
// STOCK CHECK ENGINE
// =============================================================================

/**
 * Check stock levels against alert rules and generate stock alerts.
 *
 * This function:
 * 1. Queries warehouse_inventory for current stock levels
 * 2. Aggregates stock by product across warehouses
 * 3. Evaluates stock_low rules (available < threshold)
 * 4. Evaluates stock_out rules (available === 0)
 * 5. Evaluates back_in_stock rules (was 0, now > 0)
 * 6. Updates last known stock state for transition detection
 */
export function checkStockLevels(db: Database, rules: AlertRule[]): AlertCheckResult {
  const result: AlertCheckResult = {
    rulesEvaluated: 0,
    alertsTriggered: 0,
    alerts: [],
    errors: [],
  };

  if (rules.length === 0) return result;

  const stockRules = rules.filter((r) =>
    r.type === 'stock_low' || r.type === 'stock_out' || r.type === 'back_in_stock',
  );

  if (stockRules.length === 0) return result;

  try {
    const stockLevels = getWarehouseStockLevels(db);
    const productStock = aggregateStockByProduct(stockLevels);
    const activeListings = getActiveListings(db);

    // Build product categories for rule matching
    const productCategories = new Map<string, string>();
    try {
      const productRows = db.query<Record<string, unknown>>(
        'SELECT id, category FROM products WHERE category IS NOT NULL',
      );
      for (const row of productRows) {
        productCategories.set(row.id as string, row.category as string);
      }
    } catch {
      // products table might not be populated
    }

    // Create a set of products with active listings for relevance
    const listedProducts = new Map<string, ListingStock>();
    for (const listing of activeListings) {
      listedProducts.set(listing.productId, listing);
    }

    // Evaluate each stock rule
    for (const rule of stockRules) {
      result.rulesEvaluated++;

      try {
        // Get all products to check (from inventory + listings)
        const productsToCheck = new Set<string>();
        for (const [productId] of productStock) {
          productsToCheck.add(productId);
        }
        for (const [productId] of listedProducts) {
          productsToCheck.add(productId);
        }

        for (const productId of productsToCheck) {
          // Platform filter
          const listing = listedProducts.get(productId);
          if (rule.platform && rule.platform !== 'all') {
            if (!listing || listing.platform !== rule.platform) continue;
          }

          // Category filter
          if (rule.category) {
            const category = productCategories.get(productId);
            if (!category || category.toLowerCase() !== rule.category.toLowerCase()) continue;
          }

          const available = productStock.get(productId) ?? 0;
          const previousAvailable = lastKnownStock.get(productId);
          const platform = listing?.platform ?? 'inventory';

          const alert = evaluateStockRule(rule, productId, platform, available, previousAvailable);

          if (alert) {
            const created = createAlert(db, alert);
            result.alerts.push(created);
            result.alertsTriggered++;
          }

          // Update last known state
          lastKnownStock.set(productId, available);
        }
      } catch (err) {
        const msg = `Error evaluating stock rule ${rule.id}: ${err instanceof Error ? err.message : String(err)}`;
        result.errors.push(msg);
        logger.error({ ruleId: rule.id, err }, 'Error evaluating stock rule');
      }
    }
  } catch (err) {
    const msg = `Stock check failed: ${err instanceof Error ? err.message : String(err)}`;
    result.errors.push(msg);
    logger.error({ err }, 'Stock level check failed');
  }

  if (result.alertsTriggered > 0) {
    logger.info(
      { rulesEvaluated: result.rulesEvaluated, alertsTriggered: result.alertsTriggered },
      'Stock level check complete',
    );
  }

  return result;
}

// =============================================================================
// RULE EVALUATION
// =============================================================================

function evaluateStockRule(
  rule: AlertRule,
  productId: string,
  platform: string,
  available: number,
  previousAvailable: number | undefined,
): Omit<Alert, 'id' | 'createdAt' | 'read'> | null {
  switch (rule.type) {
    case 'stock_low': {
      // Default threshold: 5 units (from thresholdAbs) or percentage-based
      const threshold = rule.thresholdAbs ?? 5;
      if (!Number.isFinite(threshold) || threshold <= 0) return null;

      if (available > 0 && available <= threshold) {
        // Only alert if stock dropped (avoid repeated alerts for same level)
        if (previousAvailable !== undefined && previousAvailable <= threshold && previousAvailable > 0) {
          return null; // Already alerted for this level
        }

        return {
          userId: rule.userId,
          type: 'stock_low',
          productId,
          platform,
          oldValue: previousAvailable ?? null,
          newValue: available,
          threshold,
          message: `Low stock warning: ${available} units remaining on ${platform} (threshold: ${threshold})`,
        };
      }
      return null;
    }

    case 'stock_out': {
      if (available === 0) {
        // Only alert on transition to zero
        if (previousAvailable !== undefined && previousAvailable === 0) {
          return null; // Was already zero
        }

        return {
          userId: rule.userId,
          type: 'stock_out',
          productId,
          platform,
          oldValue: previousAvailable ?? null,
          newValue: 0,
          threshold: null,
          message: `Out of stock on ${platform}`,
        };
      }
      return null;
    }

    case 'back_in_stock': {
      if (available > 0 && previousAvailable !== undefined && previousAvailable === 0) {
        return {
          userId: rule.userId,
          type: 'back_in_stock',
          productId,
          platform,
          oldValue: 0,
          newValue: available,
          threshold: null,
          message: `Back in stock on ${platform}: ${available} units available`,
        };
      }
      return null;
    }

    default:
      return null;
  }
}

/**
 * Clear the last known stock state cache.
 * Useful for testing or when stock data is refreshed externally.
 */
export function clearStockStateCache(): void {
  lastKnownStock.clear();
}

/**
 * Get the current size of the stock state cache.
 */
export function getStockStateCacheSize(): number {
  return lastKnownStock.size;
}
