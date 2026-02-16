/**
 * Alert Engine - Scans products for price/stock changes and triggers alerts
 *
 * Supports alert types: price_drop, price_increase, stock_low, stock_out,
 * back_in_stock, new_opportunity.
 */

import { createLogger } from '../utils/logger';
import { generateId } from '../utils/id';
import type { Database } from '../db/index';
import type { Alert, AlertRule, AlertType, AlertCheckResult } from './types';
import { checkStockLevels } from './stock-checker';

const logger = createLogger('alert-engine');

// =============================================================================
// ALERT CRUD
// =============================================================================

/**
 * Create and persist a new alert.
 */
export function createAlert(db: Database, alert: Omit<Alert, 'id' | 'createdAt' | 'read'>): Alert {
  const fullAlert: Alert = {
    id: generateId('alert'),
    read: false,
    createdAt: Date.now(),
    ...alert,
  };

  db.run(
    `INSERT INTO alerts (id, user_id, type, product_id, platform, old_value, new_value, threshold, message, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fullAlert.id,
      fullAlert.userId,
      fullAlert.type,
      fullAlert.productId ?? null,
      fullAlert.platform ?? null,
      fullAlert.oldValue ?? null,
      fullAlert.newValue ?? null,
      fullAlert.threshold ?? null,
      fullAlert.message,
      fullAlert.read ? 1 : 0,
      fullAlert.createdAt,
    ],
  );

  logger.info({ alertId: fullAlert.id, type: fullAlert.type }, 'Alert created');
  return fullAlert;
}

/**
 * Get alerts for a user with filtering options.
 */
export function getAlerts(
  db: Database,
  userId: string,
  options: { unreadOnly?: boolean; type?: AlertType; limit?: number; offset?: number } = {},
): Alert[] {
  const { unreadOnly = false, type, limit = 50, offset = 0 } = options;

  const conditions: string[] = ['user_id = ?'];
  const params: unknown[] = [userId];

  if (unreadOnly) {
    conditions.push('read = 0');
  }
  if (type) {
    conditions.push('type = ?');
    params.push(type);
  }

  const safeLimit = Math.max(1, Math.min(limit, 200));
  const safeOffset = Math.max(0, offset);
  params.push(safeLimit, safeOffset);

  const rows = db.query<Record<string, unknown>>(
    `SELECT id, user_id, type, product_id, platform, old_value, new_value, threshold, message, read, created_at
     FROM alerts
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    params,
  );

  return rows.map(parseAlertRow);
}

/**
 * Mark a single alert as read.
 */
export function markRead(db: Database, alertId: string): void {
  db.run('UPDATE alerts SET read = 1 WHERE id = ?', [alertId]);
}

/**
 * Mark all alerts as read for a user.
 */
export function markAllRead(db: Database, userId: string): void {
  db.run('UPDATE alerts SET read = 1 WHERE user_id = ? AND read = 0', [userId]);
}

// =============================================================================
// ALERT RULES CRUD
// =============================================================================

/**
 * Create a new alert rule for a user.
 */
export function createAlertRule(
  db: Database,
  rule: Omit<AlertRule, 'id' | 'createdAt' | 'enabled'> & { enabled?: boolean },
): AlertRule {
  const fullRule: AlertRule = {
    id: generateId('arule'),
    enabled: true,
    createdAt: Date.now(),
    ...rule,
  };

  db.run(
    `INSERT INTO alert_rules (id, user_id, type, platform, category, threshold_pct, threshold_abs, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fullRule.id,
      fullRule.userId,
      fullRule.type,
      fullRule.platform ?? null,
      fullRule.category ?? null,
      fullRule.thresholdPct ?? null,
      fullRule.thresholdAbs ?? null,
      fullRule.enabled ? 1 : 0,
      fullRule.createdAt,
    ],
  );

  logger.info({ ruleId: fullRule.id, type: fullRule.type }, 'Alert rule created');
  return fullRule;
}

/**
 * Get all alert rules for a user.
 */
export function getAlertRules(db: Database, userId: string, enabledOnly = false): AlertRule[] {
  const sql = enabledOnly
    ? 'SELECT * FROM alert_rules WHERE user_id = ? AND enabled = 1 ORDER BY created_at DESC'
    : 'SELECT * FROM alert_rules WHERE user_id = ? ORDER BY created_at DESC';

  const rows = db.query<Record<string, unknown>>(sql, [userId]);
  return rows.map(parseAlertRuleRow);
}

/**
 * Get a single alert rule by ID.
 */
export function getAlertRule(db: Database, ruleId: string): AlertRule | undefined {
  const rows = db.query<Record<string, unknown>>(
    'SELECT * FROM alert_rules WHERE id = ?',
    [ruleId],
  );
  if (rows.length === 0) return undefined;
  return parseAlertRuleRow(rows[0]);
}

/**
 * Enable or disable an alert rule.
 */
export function setAlertRuleEnabled(db: Database, ruleId: string, enabled: boolean): void {
  db.run('UPDATE alert_rules SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, ruleId]);
}

/**
 * Delete an alert rule.
 */
export function deleteAlertRule(db: Database, ruleId: string): void {
  db.run('DELETE FROM alert_rules WHERE id = ?', [ruleId]);
}

// =============================================================================
// ALERT CHECK ENGINE
// =============================================================================

/**
 * Scan products for price/stock changes that trigger alert rules.
 *
 * Compares latest prices against previous prices for each product/platform
 * combination and evaluates all enabled alert rules against the changes.
 */
export function checkPriceAlerts(db: Database): AlertCheckResult {
  const result: AlertCheckResult = {
    rulesEvaluated: 0,
    alertsTriggered: 0,
    alerts: [],
    errors: [],
  };

  try {
    // Get all enabled rules grouped by user
    const rules = db.query<Record<string, unknown>>(
      'SELECT * FROM alert_rules WHERE enabled = 1',
    ).map(parseAlertRuleRow);

    if (rules.length === 0) {
      logger.debug('No enabled alert rules to evaluate');
      return result;
    }

    // Get price changes: compare two most recent prices per product/platform
    const priceChanges = db.query<Record<string, unknown>>(`
      SELECT
        curr.product_id,
        curr.platform,
        curr.price AS current_price,
        curr.in_stock AS current_stock,
        curr.seller AS current_seller,
        prev.price AS previous_price,
        prev.in_stock AS previous_stock
      FROM prices curr
      INNER JOIN (
        SELECT product_id, platform, MAX(fetched_at) AS max_fetched
        FROM prices
        GROUP BY product_id, platform
      ) latest ON curr.product_id = latest.product_id
        AND curr.platform = latest.platform
        AND curr.fetched_at = latest.max_fetched
      LEFT JOIN (
        SELECT p.product_id, p.platform, p.price, p.in_stock
        FROM prices p
        INNER JOIN (
          SELECT product_id, platform, MAX(fetched_at) AS max_fetched
          FROM prices
          WHERE fetched_at < (
            SELECT MAX(fetched_at) FROM prices p2
            WHERE p2.product_id = prices.product_id AND p2.platform = prices.platform
          )
          GROUP BY product_id, platform
        ) prev_latest ON p.product_id = prev_latest.product_id
          AND p.platform = prev_latest.platform
          AND p.fetched_at = prev_latest.max_fetched
      ) prev ON curr.product_id = prev.product_id AND curr.platform = prev.platform
    `);

    // Get product categories for category-based rules
    const productCategories = new Map<string, string>();
    const productRows = db.query<Record<string, unknown>>(
      'SELECT id, category FROM products WHERE category IS NOT NULL',
    );
    for (const row of productRows) {
      productCategories.set(row.id as string, row.category as string);
    }

    // Get active opportunities for new_opportunity alerts
    const opportunities = db.query<Record<string, unknown>>(
      "SELECT product_id, margin_pct FROM opportunities WHERE status = 'active'",
    );
    const oppMargins = new Map<string, number>();
    for (const opp of opportunities) {
      const margin = opp.margin_pct as number;
      if (Number.isFinite(margin)) {
        oppMargins.set(opp.product_id as string, margin);
      }
    }

    // Evaluate each rule against price changes
    for (const rule of rules) {
      result.rulesEvaluated++;

      try {
        const matchingChanges = priceChanges.filter((change) => {
          // Platform filter
          if (rule.platform && rule.platform !== 'all' && change.platform !== rule.platform) {
            return false;
          }
          // Category filter
          if (rule.category) {
            const productCategory = productCategories.get(change.product_id as string);
            if (!productCategory || productCategory.toLowerCase() !== rule.category.toLowerCase()) {
              return false;
            }
          }
          return true;
        });

        for (const change of matchingChanges) {
          const currentPrice = change.current_price as number;
          const previousPrice = change.previous_price as number | null;
          const currentStock = change.current_stock as number;
          const previousStock = change.previous_stock as number | null;
          const productId = change.product_id as string;
          const platform = change.platform as string;

          if (!Number.isFinite(currentPrice)) continue;

          const alert = evaluateRule(
            rule,
            productId,
            platform,
            currentPrice,
            previousPrice,
            currentStock,
            previousStock,
            oppMargins.get(productId),
          );

          if (alert) {
            const created = createAlert(db, alert);
            result.alerts.push(created);
            result.alertsTriggered++;
          }
        }
      } catch (err) {
        const msg = `Error evaluating rule ${rule.id}: ${err instanceof Error ? err.message : String(err)}`;
        result.errors.push(msg);
        logger.error({ ruleId: rule.id, err }, 'Error evaluating alert rule');
      }
    }
  } catch (err) {
    const msg = `Alert check failed: ${err instanceof Error ? err.message : String(err)}`;
    result.errors.push(msg);
    logger.error({ err }, 'Alert check failed');
  }

  // ── Stock level checks (warehouse_inventory-based) ──────────────────────
  try {
    const allRules = db.query<Record<string, unknown>>(
      'SELECT * FROM alert_rules WHERE enabled = 1',
    ).map(parseAlertRuleRow);

    const stockResult = checkStockLevels(db, allRules);
    result.rulesEvaluated += stockResult.rulesEvaluated;
    result.alertsTriggered += stockResult.alertsTriggered;
    result.alerts.push(...stockResult.alerts);
    result.errors.push(...stockResult.errors);
  } catch (err) {
    const msg = `Stock level check failed: ${err instanceof Error ? err.message : String(err)}`;
    result.errors.push(msg);
    logger.error({ err }, 'Stock level check failed');
  }

  logger.info(
    { rulesEvaluated: result.rulesEvaluated, alertsTriggered: result.alertsTriggered },
    'Alert check complete',
  );

  return result;
}

// =============================================================================
// RULE EVALUATION
// =============================================================================

function evaluateRule(
  rule: AlertRule,
  productId: string,
  platform: string,
  currentPrice: number,
  previousPrice: number | null,
  currentStock: number,
  previousStock: number | null,
  opportunityMargin: number | undefined,
): Omit<Alert, 'id' | 'createdAt' | 'read'> | null {
  switch (rule.type) {
    case 'price_drop': {
      if (previousPrice == null || !Number.isFinite(previousPrice) || previousPrice <= 0) {
        return null;
      }
      const dropPct = ((previousPrice - currentPrice) / previousPrice) * 100;
      const dropAbs = previousPrice - currentPrice;

      if (dropAbs <= 0) return null; // Price didn't actually drop

      const thresholdPct = rule.thresholdPct ?? 5;
      const thresholdAbs = rule.thresholdAbs ?? 0;

      // Trigger if either threshold is met (pct OR abs)
      if (dropPct >= thresholdPct || (thresholdAbs > 0 && dropAbs >= thresholdAbs)) {
        return {
          userId: rule.userId,
          type: 'price_drop',
          productId,
          platform,
          oldValue: previousPrice,
          newValue: currentPrice,
          threshold: rule.thresholdPct ?? rule.thresholdAbs ?? null,
          message: `Price dropped ${dropPct.toFixed(1)}% ($${dropAbs.toFixed(2)}) on ${platform}: $${previousPrice.toFixed(2)} -> $${currentPrice.toFixed(2)}`,
        };
      }
      return null;
    }

    case 'price_increase': {
      if (previousPrice == null || !Number.isFinite(previousPrice) || previousPrice <= 0) {
        return null;
      }
      const increasePct = ((currentPrice - previousPrice) / previousPrice) * 100;
      const increaseAbs = currentPrice - previousPrice;

      if (increaseAbs <= 0) return null;

      const thresholdPct = rule.thresholdPct ?? 10;
      const thresholdAbs = rule.thresholdAbs ?? 0;

      if (increasePct >= thresholdPct || (thresholdAbs > 0 && increaseAbs >= thresholdAbs)) {
        return {
          userId: rule.userId,
          type: 'price_increase',
          productId,
          platform,
          oldValue: previousPrice,
          newValue: currentPrice,
          threshold: rule.thresholdPct ?? rule.thresholdAbs ?? null,
          message: `Price increased ${increasePct.toFixed(1)}% ($${increaseAbs.toFixed(2)}) on ${platform}: $${previousPrice.toFixed(2)} -> $${currentPrice.toFixed(2)}`,
        };
      }
      return null;
    }

    case 'stock_low': {
      // stock_low from prices table: delegates to stock-checker for inventory-based
      // checks. Here we handle the prices-based signal: if in_stock went from 1 to 0,
      // that could indicate low/out stock. The real stock_low logic runs via
      // checkStockLevels() which queries warehouse_inventory. This branch handles
      // the legacy prices-table boolean in_stock field as a fallback.
      if (previousStock == null) return null;
      if (previousStock === 1 && currentStock === 0) {
        return {
          userId: rule.userId,
          type: 'stock_low',
          productId,
          platform,
          oldValue: 1,
          newValue: 0,
          threshold: rule.thresholdAbs ?? null,
          message: `Stock status changed to unavailable on ${platform} (price-based detection)`,
        };
      }
      return null;
    }

    case 'stock_out': {
      if (previousStock == null) return null;
      // Was in stock, now out of stock
      if (previousStock === 1 && currentStock === 0) {
        return {
          userId: rule.userId,
          type: 'stock_out',
          productId,
          platform,
          oldValue: 1,
          newValue: 0,
          threshold: null,
          message: `Product went out of stock on ${platform}`,
        };
      }
      return null;
    }

    case 'back_in_stock': {
      if (previousStock == null) return null;
      // Was out of stock, now back in stock
      if (previousStock === 0 && currentStock === 1) {
        return {
          userId: rule.userId,
          type: 'back_in_stock',
          productId,
          platform,
          oldValue: 0,
          newValue: 1,
          threshold: null,
          message: `Product is back in stock on ${platform} at $${currentPrice.toFixed(2)}`,
        };
      }
      return null;
    }

    case 'new_opportunity': {
      if (opportunityMargin == null || !Number.isFinite(opportunityMargin)) return null;
      const thresholdPct = rule.thresholdPct ?? 15;
      if (opportunityMargin >= thresholdPct) {
        return {
          userId: rule.userId,
          type: 'new_opportunity',
          productId,
          platform,
          oldValue: null,
          newValue: opportunityMargin,
          threshold: thresholdPct,
          message: `New arbitrage opportunity with ${opportunityMargin.toFixed(1)}% margin on ${platform}`,
        };
      }
      return null;
    }

    default:
      return null;
  }
}

// =============================================================================
// ROW PARSERS
// =============================================================================

function parseAlertRow(row: Record<string, unknown>): Alert {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    type: row.type as AlertType,
    productId: (row.product_id as string) ?? null,
    platform: (row.platform as string) ?? null,
    oldValue: row.old_value != null ? (row.old_value as number) : null,
    newValue: row.new_value != null ? (row.new_value as number) : null,
    threshold: row.threshold != null ? (row.threshold as number) : null,
    message: row.message as string,
    read: Boolean(row.read),
    createdAt: row.created_at as number,
  };
}

function parseAlertRuleRow(row: Record<string, unknown>): AlertRule {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    type: row.type as AlertType,
    platform: (row.platform as string) ?? null,
    category: (row.category as string) ?? null,
    thresholdPct: row.threshold_pct != null ? (row.threshold_pct as number) : null,
    thresholdAbs: row.threshold_abs != null ? (row.threshold_abs as number) : null,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at as number,
  };
}
