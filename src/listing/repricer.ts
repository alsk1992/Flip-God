/**
 * Dynamic Repricing Engine - Automatically adjust listing prices
 *
 * Strategies:
 * - match_lowest: Match the lowest competitor price
 * - beat_lowest: Beat the lowest competitor by amount/percentage
 * - target_margin: Maintain target profit margin over COGS
 * - velocity: Adjust based on sales velocity and days-on-market
 * - competitive: Scan and undercut competitors (only reprices if competitor changed)
 * - margin_target: Maintain target profit margin accounting for fees
 * - time_decay: Linear or exponential decay from initial price to floor
 * - cost_plus: Fixed markup over cost (COGS + markup)
 */

import { createLogger } from '../utils/logger';
import { generateId } from '../utils/id';
import type { Platform, Listing } from '../types';
import type { Database } from '../db';

const logger = createLogger('repricer');

// =============================================================================
// TYPES
// =============================================================================

export type RepricingStrategy =
  | 'match_lowest'
  | 'beat_lowest'
  | 'target_margin'
  | 'velocity'
  | 'competitive'
  | 'margin_target'
  | 'time_decay'
  | 'cost_plus';

export interface RepricingRule {
  id: string;
  listingId: string;
  strategy: RepricingStrategy;
  params: Record<string, number | string>;
  minPrice: number;
  maxPrice: number;
  enabled: boolean;
  lastRun?: number;
  runIntervalMs: number; // how often to check
  createdAt?: number;
}

export interface RepricingResult {
  listingId: string;
  ruleId?: string;
  oldPrice: number;
  newPrice: number;
  reason: string;
  competitorPrice?: number;
  applied: boolean;
}

export interface CompetitorPrice {
  platform: Platform;
  price: number;
  shipping: number;
  seller: string;
  fetchedAt: Date;
}

export interface SalesVelocityData {
  listingId: string;
  daysOnMarket: number;
  totalSales: number;
  salesLast7Days: number;
  salesLast14Days: number;
  views?: number;
}

// =============================================================================
// REPRICER (BASIC -- BACKWARD COMPATIBLE)
// =============================================================================

/** Legacy repricer interface kept for backward compatibility */
export interface Repricer {
  evaluate(listing: Listing, competitors: CompetitorPrice[], rule: LegacyRepricingRule): RepricingResult;
  evaluateAll(listings: Listing[], rules: Map<string, LegacyRepricingRule>, getCompetitors: (l: Listing) => CompetitorPrice[]): RepricingResult[];
}

/** Legacy rule type (pre-existing) */
export interface LegacyRepricingRule {
  id: string;
  platform: Platform;
  strategy: 'match_lowest' | 'beat_lowest' | 'target_margin' | 'velocity';
  minPrice: number;
  maxPrice: number;
  targetMarginPct?: number;
  beatByAmount?: number;
  beatByPct?: number;
}

export function createRepricer(): Repricer {
  return {
    evaluate(listing: Listing, competitors: CompetitorPrice[], rule: LegacyRepricingRule): RepricingResult {
      const lowestCompetitor = competitors.reduce<CompetitorPrice | null>((min, c) => {
        const total = c.price + c.shipping;
        if (!min || total < min.price + min.shipping) return c;
        return min;
      }, null);

      const lowestTotal = lowestCompetitor ? lowestCompetitor.price + lowestCompetitor.shipping : null;
      let newPrice = listing.price;
      let reason = 'No change';

      switch (rule.strategy) {
        case 'match_lowest':
          if (lowestTotal != null && lowestTotal < listing.price) {
            newPrice = lowestTotal;
            reason = `Matched lowest at $${lowestTotal.toFixed(2)}`;
          }
          break;

        case 'beat_lowest':
          if (lowestTotal != null) {
            const beatAmt = rule.beatByAmount ?? 0;
            const beatPct = rule.beatByPct ?? 0;
            newPrice = Math.min(lowestTotal - beatAmt, lowestTotal * (1 - beatPct / 100));
            reason = `Beat lowest ($${lowestTotal.toFixed(2)})`;
          }
          break;

        case 'target_margin':
          if (rule.targetMarginPct != null) {
            const target = listing.sourcePrice * (1 + rule.targetMarginPct / 100);
            newPrice = target;
            reason = `Target margin ${rule.targetMarginPct}%`;
            if (lowestTotal != null && lowestTotal < target) {
              const floor = listing.sourcePrice * 1.05;
              newPrice = Math.max(lowestTotal - 0.01, floor);
              reason = 'Adjusted to beat competitor at floor';
            }
          }
          break;

        case 'velocity':
          newPrice = listing.price * 0.98;
          reason = 'Velocity decrease 2%';
          break;
      }

      if (newPrice <= 0) newPrice = rule.minPrice ?? listing.price;
      newPrice = Math.round(newPrice * 100) / 100;
      if (newPrice < rule.minPrice) { newPrice = rule.minPrice; reason += ' (floor)'; }
      if (newPrice > rule.maxPrice) { newPrice = rule.maxPrice; reason += ' (ceiling)'; }

      const changed = Math.abs(newPrice - listing.price) > 0.005;
      if (changed) {
        logger.info({ listingId: listing.id, oldPrice: listing.price, newPrice, reason }, 'Price adjusted');
      }

      return {
        listingId: listing.id,
        oldPrice: listing.price,
        newPrice,
        reason,
        competitorPrice: lowestTotal ?? undefined,
        applied: changed,
      };
    },

    evaluateAll(listings: Listing[], rules: Map<string, LegacyRepricingRule>, getCompetitors: (l: Listing) => CompetitorPrice[]): RepricingResult[] {
      const results: RepricingResult[] = [];
      for (const listing of listings) {
        if (listing.status !== 'active') continue;
        const rule = rules.get(listing.platform);
        if (!rule) continue;
        results.push(this.evaluate(listing, getCompetitors(listing), rule));
      }
      const adjusted = results.filter(r => r.applied).length;
      logger.info({ total: results.length, adjusted }, 'Repricing cycle complete');
      return results;
    },
  };
}

// =============================================================================
// ADVANCED STRATEGY EVALUATORS
// =============================================================================

function clampPrice(price: number, min: number, max: number): number {
  let p = Math.round(price * 100) / 100;
  if (p < min) p = min;
  if (p > max) p = max;
  return p;
}

/**
 * competitive -- Match or beat lowest competitor price.
 * Only reprices if the competitor price actually changed.
 */
function evaluateCompetitive(
  listing: Listing,
  competitors: CompetitorPrice[],
  rule: RepricingRule,
): RepricingResult {
  const beatAmount = Number(rule.params.beatAmount ?? 0.01);

  const lowestCompetitor = competitors.reduce<CompetitorPrice | null>((min, c) => {
    const total = c.price + c.shipping;
    if (!min || total < min.price + min.shipping) return c;
    return min;
  }, null);

  if (!lowestCompetitor) {
    return {
      listingId: listing.id,
      ruleId: rule.id,
      oldPrice: listing.price,
      newPrice: listing.price,
      reason: 'No competitor data',
      applied: false,
    };
  }

  const lowestTotal = lowestCompetitor.price + lowestCompetitor.shipping;
  const lastCompetitorPrice = Number(rule.params._lastCompetitorPrice ?? 0);

  // Only reprice if competitor price changed
  if (lastCompetitorPrice > 0 && Math.abs(lowestTotal - lastCompetitorPrice) < 0.005) {
    return {
      listingId: listing.id,
      ruleId: rule.id,
      oldPrice: listing.price,
      newPrice: listing.price,
      reason: 'Competitor price unchanged',
      competitorPrice: lowestTotal,
      applied: false,
    };
  }

  let newPrice = lowestTotal - beatAmount;
  newPrice = clampPrice(newPrice, rule.minPrice, rule.maxPrice);

  const changed = Math.abs(newPrice - listing.price) > 0.005;

  return {
    listingId: listing.id,
    ruleId: rule.id,
    oldPrice: listing.price,
    newPrice,
    reason: changed
      ? `Beat competitor $${lowestTotal.toFixed(2)} by $${beatAmount.toFixed(2)}`
      : 'Already at competitive price',
    competitorPrice: lowestTotal,
    applied: changed,
  };
}

/**
 * velocity -- Adjust price based on sales velocity and days-on-market.
 * - No sales in 7 days: reduce by slowReduction% (default 5%)
 * - No sales in 14 days: reduce by staleReduction% (default 10%)
 * - Selling fast (>fastThreshold/day): increase by fastIncrease% (default 3%)
 */
function evaluateVelocity(
  listing: Listing,
  rule: RepricingRule,
  velocityData?: SalesVelocityData,
): RepricingResult {
  const slowReduction = Number(rule.params.slowReductionPct ?? 5);
  const staleReduction = Number(rule.params.staleReductionPct ?? 10);
  const fastIncrease = Number(rule.params.fastIncreasePct ?? 3);
  const fastThreshold = Number(rule.params.fastThresholdPerDay ?? 1);

  if (!velocityData) {
    return {
      listingId: listing.id,
      ruleId: rule.id,
      oldPrice: listing.price,
      newPrice: listing.price,
      reason: 'No velocity data available',
      applied: false,
    };
  }

  let newPrice = listing.price;
  let reason = 'No change';

  const dailySales = velocityData.daysOnMarket > 0
    ? velocityData.totalSales / velocityData.daysOnMarket
    : 0;

  if (velocityData.salesLast14Days === 0 && velocityData.daysOnMarket >= 14) {
    // No sales in 14 days -- aggressive reduction
    newPrice = listing.price * (1 - staleReduction / 100);
    reason = `No sales in 14 days, reducing ${staleReduction}%`;
  } else if (velocityData.salesLast7Days === 0 && velocityData.daysOnMarket >= 7) {
    // No sales in 7 days -- moderate reduction
    newPrice = listing.price * (1 - slowReduction / 100);
    reason = `No sales in 7 days, reducing ${slowReduction}%`;
  } else if (dailySales >= fastThreshold) {
    // Selling fast -- increase price
    newPrice = listing.price * (1 + fastIncrease / 100);
    reason = `Selling fast (${dailySales.toFixed(1)}/day), increasing ${fastIncrease}%`;
  }

  newPrice = clampPrice(newPrice, rule.minPrice, rule.maxPrice);
  const changed = Math.abs(newPrice - listing.price) > 0.005;

  return {
    listingId: listing.id,
    ruleId: rule.id,
    oldPrice: listing.price,
    newPrice,
    reason,
    applied: changed,
  };
}

/**
 * margin_target -- Maintain target profit margin over COGS, accounting for fees.
 * Given: COGS, target margin %, platform fee %
 * Price = COGS / (1 - feePct/100) * (1 + targetMarginPct/100)
 */
function evaluateMarginTarget(
  listing: Listing,
  rule: RepricingRule,
): RepricingResult {
  const cogs = Number(rule.params.cogs ?? listing.sourcePrice);
  const targetMarginPct = Number(rule.params.targetMarginPct ?? 20);
  const feePct = Number(rule.params.feePct ?? 13); // typical eBay+PayPal fee

  if (cogs <= 0) {
    return {
      listingId: listing.id,
      ruleId: rule.id,
      oldPrice: listing.price,
      newPrice: listing.price,
      reason: 'Invalid COGS',
      applied: false,
    };
  }

  // Target price: cover COGS, fees, and desired margin
  // price * (1 - feePct/100) = COGS * (1 + targetMarginPct/100)
  // price = COGS * (1 + targetMarginPct/100) / (1 - feePct/100)
  const feeMultiplier = 1 - feePct / 100;
  if (feeMultiplier <= 0) {
    return {
      listingId: listing.id,
      ruleId: rule.id,
      oldPrice: listing.price,
      newPrice: listing.price,
      reason: 'Fee percentage too high',
      applied: false,
    };
  }

  let newPrice = (cogs * (1 + targetMarginPct / 100)) / feeMultiplier;
  newPrice = clampPrice(newPrice, rule.minPrice, rule.maxPrice);
  const changed = Math.abs(newPrice - listing.price) > 0.005;

  return {
    listingId: listing.id,
    ruleId: rule.id,
    oldPrice: listing.price,
    newPrice,
    reason: changed
      ? `Target margin ${targetMarginPct}% over COGS $${cogs.toFixed(2)} (fees ${feePct}%)`
      : 'Already at target margin',
    applied: changed,
  };
}

/**
 * time_decay -- Reduce price over time from initial price toward a floor.
 * Supports linear or exponential decay.
 * params: initialPrice, decayType ('linear'|'exponential'), decayRatePct, floorPrice, startedAt
 */
function evaluateTimeDecay(
  listing: Listing,
  rule: RepricingRule,
): RepricingResult {
  const initialPrice = Number(rule.params.initialPrice ?? listing.price);
  const floorPrice = Number(rule.params.floorPrice ?? rule.minPrice);
  const decayType = String(rule.params.decayType ?? 'linear');
  const decayRatePct = Number(rule.params.decayRatePctPerDay ?? 1); // % per day
  const startedAt = Number(rule.params.startedAt ?? listing.createdAt.getTime());

  const daysElapsed = Math.max(0, (Date.now() - startedAt) / (24 * 60 * 60 * 1000));

  let newPrice: number;
  let reason: string;

  if (decayType === 'exponential') {
    // Exponential: price = initialPrice * (1 - rate/100)^days
    newPrice = initialPrice * Math.pow(1 - decayRatePct / 100, daysElapsed);
    reason = `Exponential decay: ${decayRatePct}%/day for ${daysElapsed.toFixed(1)} days`;
  } else {
    // Linear: price = initialPrice - (initialPrice - floor) * (rate/100 * days)
    const totalRange = initialPrice - floorPrice;
    const decayed = totalRange * (decayRatePct / 100) * daysElapsed;
    newPrice = initialPrice - decayed;
    reason = `Linear decay: ${decayRatePct}%/day for ${daysElapsed.toFixed(1)} days`;
  }

  // Never go below floor
  if (newPrice < floorPrice) newPrice = floorPrice;
  newPrice = clampPrice(newPrice, rule.minPrice, rule.maxPrice);
  const changed = Math.abs(newPrice - listing.price) > 0.005;

  return {
    listingId: listing.id,
    ruleId: rule.id,
    oldPrice: listing.price,
    newPrice,
    reason: changed ? reason : 'Price unchanged',
    applied: changed,
  };
}

/**
 * cost_plus -- Fixed markup over COGS.
 * params: cogs, markupAmount or markupPct
 */
function evaluateCostPlus(
  listing: Listing,
  rule: RepricingRule,
): RepricingResult {
  const cogs = Number(rule.params.cogs ?? listing.sourcePrice);
  const markupAmount = Number(rule.params.markupAmount ?? 0);
  const markupPct = Number(rule.params.markupPct ?? 0);

  let newPrice: number;
  let reason: string;

  if (markupAmount > 0) {
    newPrice = cogs + markupAmount;
    reason = `Cost plus $${markupAmount.toFixed(2)}`;
  } else if (markupPct > 0) {
    newPrice = cogs * (1 + markupPct / 100);
    reason = `Cost plus ${markupPct}%`;
  } else {
    newPrice = listing.price;
    reason = 'No markup configured';
  }

  newPrice = clampPrice(newPrice, rule.minPrice, rule.maxPrice);
  const changed = Math.abs(newPrice - listing.price) > 0.005;

  return {
    listingId: listing.id,
    ruleId: rule.id,
    oldPrice: listing.price,
    newPrice,
    reason: changed ? reason : 'Price unchanged',
    applied: changed,
  };
}

// =============================================================================
// REPRICING ENGINE
// =============================================================================

export interface RepricingEngine {
  /** Add a repricing rule. */
  addRule(rule: RepricingRule): void;

  /** Remove a repricing rule by ID. */
  removeRule(ruleId: string): void;

  /** Get all rules, optionally filtered by listingId. */
  getRules(listingId?: string): RepricingRule[];

  /** Get a single rule by ID. */
  getRule(ruleId: string): RepricingRule | undefined;

  /** Enable or disable a rule. */
  setEnabled(ruleId: string, enabled: boolean): void;

  /** Run all due rules. Returns results for rules that were evaluated. */
  runAll(): Promise<RepricingResult[]>;

  /** Run a specific rule by ID. */
  runRule(ruleId: string): Promise<RepricingResult>;
}

export interface RepricingEngineConfig {
  /** Function to get a listing by ID from the DB. */
  getListing: (listingId: string) => Listing | undefined;

  /** Function to get competitor prices for a listing. */
  getCompetitors: (listing: Listing) => CompetitorPrice[];

  /** Function to get sales velocity data for a listing. */
  getVelocityData?: (listingId: string) => SalesVelocityData | undefined;

  /** Callback when a price change is applied. */
  onPriceChange?: (result: RepricingResult) => void;
}

export function createRepricingEngine(
  db: Database,
  config: RepricingEngineConfig,
): RepricingEngine {
  // Load rules from DB into memory
  const rulesMap = new Map<string, RepricingRule>();

  function loadRulesFromDb(): void {
    try {
      const rows = db.query<Record<string, unknown>>(
        'SELECT * FROM repricing_rules ORDER BY created_at ASC',
      );
      for (const row of rows) {
        const rule = parseRuleRow(row);
        rulesMap.set(rule.id, rule);
      }
      logger.info({ ruleCount: rulesMap.size }, 'Loaded repricing rules from database');
    } catch (err) {
      logger.debug({ err }, 'Could not load repricing rules (table may not exist yet)');
    }
  }

  function parseRuleRow(row: Record<string, unknown>): RepricingRule {
    let params: Record<string, number | string> = {};
    try {
      params = JSON.parse((row.params as string) || '{}');
    } catch {
      params = {};
    }

    return {
      id: row.id as string,
      listingId: row.listing_id as string,
      strategy: row.strategy as RepricingStrategy,
      params,
      minPrice: row.min_price as number,
      maxPrice: row.max_price as number,
      enabled: Boolean(row.enabled),
      lastRun: (row.last_run as number) ?? undefined,
      runIntervalMs: Math.max(60_000, (row.run_interval_ms as number) ?? 3600000),
      createdAt: (row.created_at as number) ?? undefined,
    };
  }

  function persistRule(rule: RepricingRule): void {
    try {
      db.run(
        `INSERT INTO repricing_rules (id, listing_id, strategy, params, min_price, max_price, enabled, last_run, run_interval_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           listing_id = excluded.listing_id,
           strategy = excluded.strategy,
           params = excluded.params,
           min_price = excluded.min_price,
           max_price = excluded.max_price,
           enabled = excluded.enabled,
           last_run = excluded.last_run,
           run_interval_ms = excluded.run_interval_ms`,
        [
          rule.id,
          rule.listingId,
          rule.strategy,
          JSON.stringify(rule.params),
          rule.minPrice,
          rule.maxPrice,
          rule.enabled ? 1 : 0,
          rule.lastRun ?? null,
          rule.runIntervalMs,
          rule.createdAt ?? Date.now(),
        ],
      );
    } catch (err) {
      logger.error({ err, ruleId: rule.id }, 'Failed to persist repricing rule');
    }
  }

  function deleteRuleFromDb(ruleId: string): void {
    try {
      db.run('DELETE FROM repricing_rules WHERE id = ?', [ruleId]);
    } catch (err) {
      logger.error({ err, ruleId }, 'Failed to delete repricing rule from database');
    }
  }

  function evaluateRule(rule: RepricingRule, listing: Listing): RepricingResult {
    switch (rule.strategy) {
      case 'competitive':
        return evaluateCompetitive(listing, config.getCompetitors(listing), rule);

      case 'velocity':
        return evaluateVelocity(
          listing,
          rule,
          config.getVelocityData?.(listing.id),
        );

      case 'margin_target':
        return evaluateMarginTarget(listing, rule);

      case 'time_decay':
        return evaluateTimeDecay(listing, rule);

      case 'cost_plus':
        return evaluateCostPlus(listing, rule);

      case 'match_lowest': {
        const competitors = config.getCompetitors(listing);
        const lowestTotal = competitors.reduce<number | null>((min, c) => {
          const total = c.price + c.shipping;
          return min === null || total < min ? total : min;
        }, null);

        if (lowestTotal != null && lowestTotal < listing.price) {
          const newPrice = clampPrice(lowestTotal, rule.minPrice, rule.maxPrice);
          const changed = Math.abs(newPrice - listing.price) > 0.005;
          return {
            listingId: listing.id,
            ruleId: rule.id,
            oldPrice: listing.price,
            newPrice,
            reason: `Matched lowest at $${lowestTotal.toFixed(2)}`,
            competitorPrice: lowestTotal,
            applied: changed,
          };
        }
        return {
          listingId: listing.id,
          ruleId: rule.id,
          oldPrice: listing.price,
          newPrice: listing.price,
          reason: 'Already at or below lowest',
          applied: false,
        };
      }

      case 'beat_lowest': {
        const competitors = config.getCompetitors(listing);
        const lowestTotal = competitors.reduce<number | null>((min, c) => {
          const total = c.price + c.shipping;
          return min === null || total < min ? total : min;
        }, null);

        if (lowestTotal != null) {
          const beatAmt = Number(rule.params.beatAmount ?? 0.01);
          let newPrice = lowestTotal - beatAmt;
          newPrice = clampPrice(newPrice, rule.minPrice, rule.maxPrice);
          const changed = Math.abs(newPrice - listing.price) > 0.005;
          return {
            listingId: listing.id,
            ruleId: rule.id,
            oldPrice: listing.price,
            newPrice,
            reason: `Beat lowest ($${lowestTotal.toFixed(2)}) by $${beatAmt.toFixed(2)}`,
            competitorPrice: lowestTotal,
            applied: changed,
          };
        }
        return {
          listingId: listing.id,
          ruleId: rule.id,
          oldPrice: listing.price,
          newPrice: listing.price,
          reason: 'No competitor data',
          applied: false,
        };
      }

      case 'target_margin':
        return evaluateMarginTarget(listing, rule);

      default:
        return {
          listingId: listing.id,
          ruleId: rule.id,
          oldPrice: listing.price,
          newPrice: listing.price,
          reason: `Unknown strategy: ${rule.strategy}`,
          applied: false,
        };
    }
  }

  // Load on creation
  loadRulesFromDb();

  const engine: RepricingEngine = {
    addRule(rule: RepricingRule): void {
      if (!rule.id) {
        rule.id = generateId('rr');
      }
      if (!rule.createdAt) {
        rule.createdAt = Date.now();
      }
      rulesMap.set(rule.id, rule);
      persistRule(rule);
      logger.info({ ruleId: rule.id, strategy: rule.strategy, listingId: rule.listingId }, 'Repricing rule added');
    },

    removeRule(ruleId: string): void {
      rulesMap.delete(ruleId);
      deleteRuleFromDb(ruleId);
      logger.info({ ruleId }, 'Repricing rule removed');
    },

    getRules(listingId?: string): RepricingRule[] {
      const allRules = Array.from(rulesMap.values());
      if (listingId) {
        return allRules.filter((r) => r.listingId === listingId);
      }
      return allRules;
    },

    getRule(ruleId: string): RepricingRule | undefined {
      return rulesMap.get(ruleId);
    },

    setEnabled(ruleId: string, enabled: boolean): void {
      const rule = rulesMap.get(ruleId);
      if (!rule) return;
      rule.enabled = enabled;
      persistRule(rule);
      logger.info({ ruleId, enabled }, 'Repricing rule enabled/disabled');
    },

    async runAll(): Promise<RepricingResult[]> {
      const now = Date.now();
      const results: RepricingResult[] = [];

      for (const rule of rulesMap.values()) {
        if (!rule.enabled) continue;

        // Check if rule is due (based on runIntervalMs)
        if (rule.lastRun && (now - rule.lastRun) < rule.runIntervalMs) {
          continue;
        }

        try {
          const result = await engine.runRule(rule.id);
          results.push(result);

          // Notify on significant price changes (>5%)
          if (result.applied && result.oldPrice > 0) {
            const changePct = Math.abs(result.newPrice - result.oldPrice) / result.oldPrice * 100;
            if (changePct > 5) {
              logger.warn(
                {
                  listingId: result.listingId,
                  ruleId: rule.id,
                  oldPrice: result.oldPrice,
                  newPrice: result.newPrice,
                  changePct: changePct.toFixed(1),
                },
                'Significant price change (>5%)',
              );
            }
          }
        } catch (err) {
          logger.error({ err, ruleId: rule.id }, 'Failed to run repricing rule');
        }
      }

      const adjusted = results.filter((r) => r.applied).length;
      logger.info({ totalRules: results.length, adjusted }, 'Repricing engine cycle complete');

      return results;
    },

    async runRule(ruleId: string): Promise<RepricingResult> {
      const rule = rulesMap.get(ruleId);
      if (!rule) {
        return {
          listingId: '',
          ruleId,
          oldPrice: 0,
          newPrice: 0,
          reason: 'Rule not found',
          applied: false,
        };
      }

      const listing = config.getListing(rule.listingId);
      if (!listing) {
        return {
          listingId: rule.listingId,
          ruleId: rule.id,
          oldPrice: 0,
          newPrice: 0,
          reason: 'Listing not found',
          applied: false,
        };
      }

      const result = evaluateRule(rule, listing);

      // Update lastRun
      rule.lastRun = Date.now();
      persistRule(rule);

      // Call onPriceChange callback if price was adjusted
      if (result.applied && config.onPriceChange) {
        config.onPriceChange(result);
      }

      return result;
    },
  };

  return engine;
}
