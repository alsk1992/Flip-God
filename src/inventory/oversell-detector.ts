/**
 * Real-Time Oversell Detection
 *
 * Detects products at risk of overselling by comparing total listed quantity
 * across all platforms vs available inventory. Provides automatic reduction
 * strategies and alerting.
 *
 * Severity levels:
 *   critical: listed > total stock (guaranteed oversell)
 *   warning:  listed > available after holds (likely oversell)
 *   info:     listed within 90% of available (close to threshold)
 */

import { createLogger } from '../utils/logger.js';
import { generateId } from '../utils/id.js';
import type { Database } from '../db/index.js';
import type {
  OversellRisk,
  OversellReport,
  OversellSeverity,
  OversellPlatformDetail,
  ReductionPlan,
  ReductionAction,
  ReductionStrategy,
  OversellMonitorConfig,
} from './oversell-types.js';

const logger = createLogger('oversell-detector');

// =============================================================================
// HELPERS
// =============================================================================

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// =============================================================================
// CORE DETECTION
// =============================================================================

/**
 * Check all active listings for oversell risk.
 *
 * Compares total listed quantity across all platforms against available
 * warehouse inventory (total stock - reserved - holds).
 */
export function checkOversellRisk(
  db: Database,
  severityFilter?: OversellSeverity | 'all',
): OversellRisk[] {
  const risks: OversellRisk[] = [];

  try {
    // Get all products that have active listings
    const products = db.query<{
      product_id: string;
      title: string;
    }>(
      `SELECT DISTINCT l.product_id, COALESCE(p.title, 'Unknown Product') as title
       FROM listings l
       LEFT JOIN products p ON l.product_id = p.id
       WHERE l.status = 'active'`,
    );

    for (const product of products) {
      const risk = assessProductRisk(db, product.product_id, product.title);
      if (risk) {
        // Apply severity filter
        if (severityFilter && severityFilter !== 'all' && risk.severity !== severityFilter) {
          continue;
        }
        risks.push(risk);
      }
    }

    // Sort: critical first, then warning, then info
    const severityOrder: Record<OversellSeverity, number> = {
      critical: 0,
      warning: 1,
      info: 2,
    };
    risks.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  } catch (err) {
    logger.error({ err }, 'Failed to check oversell risk');
  }

  return risks;
}

/**
 * Assess oversell risk for a single product.
 */
function assessProductRisk(
  db: Database,
  productId: string,
  productTitle: string,
): OversellRisk | null {
  // Get total warehouse stock
  const stockRows = db.query<{ total: number; reserved: number }>(
    `SELECT
       COALESCE(SUM(quantity), 0) as total,
       COALESCE(SUM(reserved), 0) as reserved
     FROM warehouse_inventory
     WHERE product_id = ?`,
    [productId],
  );

  const totalStock = stockRows[0]?.total ?? 0;
  const totalReserved = stockRows[0]?.reserved ?? 0;

  // Get total holds
  const holdRows = db.query<{ holds: number }>(
    `SELECT COALESCE(SUM(quantity), 0) as holds
     FROM inventory_holds
     WHERE product_id = ? AND expires_at > ?`,
    [productId, Date.now()],
  );
  const totalHolds = holdRows[0]?.holds ?? 0;

  const availableStock = Math.max(0, totalStock - totalReserved - totalHolds);

  // Get all active listings across platforms
  const listingRows = db.query<{
    id: string;
    platform: string;
    price: number;
    source_price: number;
    created_at: number;
  }>(
    "SELECT id, platform, price, source_price, created_at FROM listings WHERE product_id = ? AND status = 'active'",
    [productId],
  );

  if (listingRows.length === 0) return null;

  // Group by platform
  const platformMap = new Map<string, OversellPlatformDetail>();
  let totalListed = 0;

  for (const listing of listingRows) {
    const platform = listing.platform;
    totalListed += 1; // Each listing = 1 unit in this model

    const existing = platformMap.get(platform);
    if (existing) {
      existing.listedQty += 1;
      existing.listingIds.push(listing.id);
    } else {
      // Calculate margin if we have source price
      let marginPct: number | null = null;
      if (Number.isFinite(listing.source_price) && listing.source_price > 0 && Number.isFinite(listing.price)) {
        marginPct = round2(((listing.price - listing.source_price) / listing.source_price) * 100);
      }

      platformMap.set(platform, {
        platform,
        listedQty: 1,
        listingIds: [listing.id],
        marginPct,
        createdAt: listing.created_at,
      });
    }
  }

  const platforms = Array.from(platformMap.values());
  const overlistAmount = Math.max(0, totalListed - availableStock);

  // Determine severity
  let severity: OversellSeverity;
  let message: string;

  if (totalListed > totalStock) {
    severity = 'critical';
    message = `CRITICAL: ${totalListed} listed across ${platforms.length} platform(s) but only ${totalStock} total stock (${overlistAmount} unit(s) oversold)`;
  } else if (totalListed > availableStock) {
    severity = 'warning';
    message = `WARNING: ${totalListed} listed but only ${availableStock} available (${totalReserved} reserved, ${totalHolds} held)`;
  } else if (availableStock > 0 && totalListed >= availableStock * 0.9) {
    severity = 'info';
    message = `INFO: ${totalListed} listed of ${availableStock} available (${round2((totalListed / availableStock) * 100)}% utilization)`;
  } else {
    // Not at risk
    return null;
  }

  return {
    productId,
    productTitle,
    severity,
    totalStock,
    totalListed,
    totalReserved,
    availableStock,
    overlistAmount,
    platforms,
    message,
  };
}

// =============================================================================
// REPORTING
// =============================================================================

/**
 * Generate a detailed oversell risk report.
 */
export function getOversellReport(
  db: Database,
  platform?: string,
  category?: string,
): OversellReport {
  const now = Date.now();
  let risks = checkOversellRisk(db, 'all');

  // Filter by platform if specified
  if (platform) {
    risks = risks.filter((r) =>
      r.platforms.some((p) => p.platform.toLowerCase() === platform.toLowerCase()),
    );
  }

  // Filter by category if specified
  if (category) {
    const categoryLower = category.toLowerCase();
    risks = risks.filter((r) => {
      const rows = db.query<{ category: string }>(
        'SELECT category FROM products WHERE id = ?',
        [r.productId],
      );
      const productCategory = rows[0]?.category ?? '';
      return productCategory.toLowerCase().includes(categoryLower);
    });
  }

  const criticalCount = risks.filter((r) => r.severity === 'critical').length;
  const warningCount = risks.filter((r) => r.severity === 'warning').length;
  const infoCount = risks.filter((r) => r.severity === 'info').length;

  // Count total distinct products with active listings
  const totalProductRows = db.query<{ cnt: number }>(
    "SELECT COUNT(DISTINCT product_id) as cnt FROM listings WHERE status = 'active'",
  );
  const totalProducts = totalProductRows[0]?.cnt ?? 0;

  let summary: string;
  if (risks.length === 0) {
    summary = `All ${totalProducts} product(s) are within safe inventory levels. No oversell risk detected.`;
  } else {
    const parts: string[] = [];
    if (criticalCount > 0) parts.push(`${criticalCount} CRITICAL`);
    if (warningCount > 0) parts.push(`${warningCount} WARNING`);
    if (infoCount > 0) parts.push(`${infoCount} INFO`);
    summary = `${risks.length} of ${totalProducts} product(s) at risk: ${parts.join(', ')}.`;
    if (criticalCount > 0) {
      summary += ' Immediate action required for critical items.';
    }
  }

  return {
    generatedAt: now,
    totalProducts,
    atRiskCount: risks.length,
    criticalCount,
    warningCount,
    infoCount,
    risks,
    summary,
  };
}

// =============================================================================
// AUTO-REDUCTION
// =============================================================================

/**
 * Automatically reduce listed quantities to match available inventory.
 *
 * Strategies:
 *   - proportional: reduce evenly across all platforms
 *   - lowest_margin_first: remove from lowest-margin platform first
 *   - newest_first: remove most recently created listings first
 */
export function autoReduceListings(
  db: Database,
  productId: string,
  options?: {
    strategy?: ReductionStrategy;
    dryRun?: boolean;
  },
): ReductionPlan {
  const strategy = options?.strategy ?? 'proportional';
  const dryRun = options?.dryRun ?? true;

  // Assess current risk
  const productRows = db.query<{ title: string }>(
    "SELECT COALESCE(title, 'Unknown') as title FROM products WHERE id = ?",
    [productId],
  );
  const title = productRows[0]?.title ?? 'Unknown';
  const risk = assessProductRisk(db, productId, title);

  if (!risk || risk.overlistAmount <= 0) {
    return {
      productId,
      strategy,
      dryRun,
      currentOverlist: 0,
      reductions: [],
      totalReduced: 0,
      remainingOverlist: 0,
    };
  }

  let toReduce = risk.overlistAmount;
  const reductions: ReductionAction[] = [];

  // Get all active listings sorted by strategy
  const listings = db.query<{
    id: string;
    platform: string;
    price: number;
    source_price: number;
    created_at: number;
  }>(
    "SELECT id, platform, price, source_price, created_at FROM listings WHERE product_id = ? AND status = 'active'",
    [productId],
  );

  if (listings.length === 0) {
    return {
      productId,
      strategy,
      dryRun,
      currentOverlist: risk.overlistAmount,
      reductions: [],
      totalReduced: 0,
      remainingOverlist: risk.overlistAmount,
    };
  }

  // Sort by strategy
  let sortedListings = [...listings];

  switch (strategy) {
    case 'lowest_margin_first': {
      sortedListings.sort((a, b) => {
        const marginA = (Number.isFinite(a.source_price) && a.source_price > 0)
          ? (a.price - a.source_price) / a.source_price
          : Infinity;
        const marginB = (Number.isFinite(b.source_price) && b.source_price > 0)
          ? (b.price - b.source_price) / b.source_price
          : Infinity;
        return marginA - marginB; // Lowest margin first
      });
      break;
    }

    case 'newest_first': {
      sortedListings.sort((a, b) => b.created_at - a.created_at); // Newest first
      break;
    }

    case 'proportional':
    default: {
      // For proportional, we'll spread reductions across all platforms
      // Sort by platform for consistency
      sortedListings.sort((a, b) => a.platform.localeCompare(b.platform));
      break;
    }
  }

  if (strategy === 'proportional') {
    // Proportional: distribute reductions evenly
    // Group by platform
    const platformListings = new Map<string, typeof listings>();
    for (const listing of sortedListings) {
      const arr = platformListings.get(listing.platform) ?? [];
      arr.push(listing);
      platformListings.set(listing.platform, arr);
    }

    const platformCount = platformListings.size;
    if (platformCount > 0) {
      let remaining = toReduce;

      // Round-robin reduction
      const platformKeys = Array.from(platformListings.keys());
      let idx = 0;
      while (remaining > 0) {
        const platformKey = platformKeys[idx % platformKeys.length];
        const pListings = platformListings.get(platformKey)!;

        if (pListings.length > 0) {
          const listing = pListings.shift()!;

          const action: ReductionAction = {
            listingId: listing.id,
            platform: listing.platform,
            currentQty: 1,
            newQty: 0,
            reducedBy: 1,
            reason: `Proportional reduction across ${platformCount} platform(s)`,
            applied: false,
          };

          if (!dryRun) {
            try {
              db.run(
                "UPDATE listings SET status = 'paused', updated_at = ? WHERE id = ?",
                [Date.now(), listing.id],
              );
              action.applied = true;
            } catch (err) {
              logger.error({ err, listingId: listing.id }, 'Failed to pause listing');
            }
          }

          reductions.push(action);
          remaining--;
        }

        idx++;
        // Safety: break if we've cycled through all platforms without finding listings
        if (idx > toReduce + platformKeys.length) break;
      }
    }
  } else {
    // Sequential: remove from sorted list
    for (const listing of sortedListings) {
      if (toReduce <= 0) break;

      const marginPct = (Number.isFinite(listing.source_price) && listing.source_price > 0)
        ? round2(((listing.price - listing.source_price) / listing.source_price) * 100)
        : null;

      const reason = strategy === 'lowest_margin_first'
        ? `Lowest margin first (${marginPct !== null ? marginPct + '%' : 'unknown margin'})`
        : `Newest first (created ${new Date(listing.created_at).toISOString()})`;

      const action: ReductionAction = {
        listingId: listing.id,
        platform: listing.platform,
        currentQty: 1,
        newQty: 0,
        reducedBy: 1,
        reason,
        applied: false,
      };

      if (!dryRun) {
        try {
          db.run(
            "UPDATE listings SET status = 'paused', updated_at = ? WHERE id = ?",
            [Date.now(), listing.id],
          );
          action.applied = true;
        } catch (err) {
          logger.error({ err, listingId: listing.id }, 'Failed to pause listing');
        }
      }

      reductions.push(action);
      toReduce--;
    }
  }

  const totalReduced = reductions.length;
  const remainingOverlist = Math.max(0, risk.overlistAmount - totalReduced);

  // Create alert if we detected oversell
  if (risk.severity === 'critical' || risk.severity === 'warning') {
    try {
      const alertId = generateId('alert');
      db.run(
        `INSERT INTO alerts (id, user_id, type, product_id, message, created_at)
         VALUES (?, 'default', 'oversell_detected', ?, ?, ?)`,
        [alertId, productId, risk.message, Date.now()],
      );
    } catch {
      // Alert table might not exist or have different schema; graceful degradation
    }
  }

  logger.info(
    { productId, strategy, dryRun, totalReduced, remainingOverlist, severity: risk.severity },
    'Auto-reduce listings completed',
  );

  return {
    productId,
    strategy,
    dryRun,
    currentOverlist: risk.overlistAmount,
    reductions,
    totalReduced,
    remainingOverlist,
  };
}

// =============================================================================
// MONITOR SETUP
// =============================================================================

/**
 * Set up oversell monitoring configuration.
 *
 * Note: The actual periodic check is handled by the cron scheduler.
 * This function stores the configuration for it.
 */
export function setupOversellMonitor(
  db: Database,
  config: Partial<OversellMonitorConfig>,
): OversellMonitorConfig {
  const fullConfig: OversellMonitorConfig = {
    checkIntervalMs: config.checkIntervalMs ?? 300_000, // 5 minutes default
    autoReduceThreshold: config.autoReduceThreshold ?? 'critical',
    notifyOnDetection: config.notifyOnDetection ?? true,
    reductionStrategy: config.reductionStrategy ?? 'proportional',
  };

  // Store in a simple key-value manner using alert_rules table
  // (reuses existing infrastructure)
  try {
    // Upsert the monitor config as a special alert rule
    const existing = db.query<{ id: string }>(
      "SELECT id FROM alert_rules WHERE user_id = 'system' AND type = 'oversell_monitor'",
    );

    if (existing.length > 0) {
      db.run(
        "UPDATE alert_rules SET threshold_pct = ?, enabled = 1 WHERE user_id = 'system' AND type = 'oversell_monitor'",
        [fullConfig.checkIntervalMs],
      );
    } else {
      const ruleId = generateId('ar');
      db.run(
        `INSERT INTO alert_rules (id, user_id, type, platform, category, threshold_pct, enabled, created_at)
         VALUES (?, 'system', 'oversell_monitor', ?, ?, ?, 1, ?)`,
        [
          ruleId,
          fullConfig.reductionStrategy,
          fullConfig.autoReduceThreshold,
          fullConfig.checkIntervalMs,
          Date.now(),
        ],
      );
    }
  } catch (err) {
    logger.warn({ err }, 'Could not persist oversell monitor config');
  }

  logger.info(
    { interval: fullConfig.checkIntervalMs, threshold: fullConfig.autoReduceThreshold },
    'Oversell monitor configured',
  );

  return fullConfig;
}

/**
 * Run a single oversell check cycle (called by cron or manually).
 */
export function runOversellCheck(db: Database): {
  checked: number;
  alerts: number;
  reduced: number;
} {
  let alerts = 0;
  let reduced = 0;

  const risks = checkOversellRisk(db, 'all');

  for (const risk of risks) {
    if (risk.severity === 'critical') {
      // Auto-reduce critical items
      const plan = autoReduceListings(db, risk.productId, {
        strategy: 'lowest_margin_first',
        dryRun: false,
      });
      reduced += plan.totalReduced;
      alerts++;
    } else if (risk.severity === 'warning') {
      // Create alert for warnings
      try {
        const alertId = generateId('alert');
        db.run(
          `INSERT INTO alerts (id, user_id, type, product_id, message, created_at)
           VALUES (?, 'default', 'oversell_detected', ?, ?, ?)`,
          [alertId, risk.productId, risk.message, Date.now()],
        );
        alerts++;
      } catch {
        // Graceful degradation
      }
    }
  }

  return {
    checked: risks.length,
    alerts,
    reduced,
  };
}
