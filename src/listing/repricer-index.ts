/**
 * Repricer Tool Definitions & Handler
 *
 * Exports tool definitions and a handler function for the smart auto-repricer.
 * Wire these into the agent tool registry.
 */

import type { Database } from '../db';
import {
  createRule,
  getRules,
  deleteRule,
  updateRule,
  evaluateRule,
  applyRules,
  recordRepricingHistory,
  getRepricingHistory,
} from './rule-engine';
import type { MarketData } from './rule-types';
import { createLogger } from '../utils/logger';

const logger = createLogger('repricer-tools');

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const repricerTools = [
  {
    name: 'create_repricing_rule',
    description: 'Create an automated repricing rule',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Rule name' },
        type: {
          type: 'string' as const,
          enum: ['beat_lowest', 'match_buybox', 'floor_ceiling', 'margin_target', 'velocity_based', 'time_decay'],
          description: 'Rule type',
        },
        platform: { type: 'string' as const, description: 'Target platform (or "all")' },
        category: { type: 'string' as const, description: 'Category filter' },
        sku_pattern: { type: 'string' as const, description: 'SKU pattern match (glob)' },
        params: { type: 'object' as const, description: 'Rule parameters (varies by type)' },
        priority: { type: 'number' as const, default: 50, description: 'Priority (lower = higher priority)' },
      },
      required: ['name', 'type', 'params'],
    },
  },
  {
    name: 'list_repricing_rules',
    description: 'List all repricing rules',
    input_schema: {
      type: 'object' as const,
      properties: {
        enabled_only: { type: 'boolean' as const, default: false },
        type: { type: 'string' as const, description: 'Filter by rule type' },
      },
    },
  },
  {
    name: 'run_repricer',
    description: 'Run the auto-repricer engine now (normally runs on schedule)',
    input_schema: {
      type: 'object' as const,
      properties: {
        dry_run: { type: 'boolean' as const, default: true, description: 'Preview changes without applying' },
        listing_ids: { type: 'array' as const, items: { type: 'string' as const }, description: 'Specific listings to reprice (empty = all)' },
      },
    },
  },
  {
    name: 'repricing_history',
    description: 'View repricing change history',
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_id: { type: 'string' as const },
        days: { type: 'number' as const, default: 7 },
        limit: { type: 'number' as const, default: 50 },
      },
    },
  },
];

// =============================================================================
// HANDLER
// =============================================================================

export interface RepricerHandlerContext {
  db: Database;
  userId?: string;
  /** Callback to fetch market data for a listing. Without this, run_repricer cannot evaluate rules. */
  getMarketData?: (listingId: string) => MarketData;
}

/**
 * Handle repricer tool calls.
 *
 * @returns A string result suitable for returning to the agent.
 */
export async function handleRepricerTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: RepricerHandlerContext,
): Promise<string> {
  const { db, userId } = ctx;

  try {
    switch (toolName) {
      case 'create_repricing_rule': {
        const rule = createRule(db, {
          user_id: userId,
          name: input.name as string,
          type: input.type as 'beat_lowest' | 'match_buybox' | 'floor_ceiling' | 'margin_target' | 'velocity_based' | 'time_decay',
          platform: (input.platform as string) ?? 'all',
          category: input.category as string | undefined,
          sku_pattern: input.sku_pattern as string | undefined,
          params: (input.params as Record<string, unknown>) ?? {},
          priority: input.priority != null ? Number(input.priority) : 50,
        });

        return JSON.stringify({
          success: true,
          rule: {
            id: rule.id,
            name: rule.name,
            type: rule.type,
            platform: rule.platform,
            priority: rule.priority,
            enabled: rule.enabled,
          },
          message: `Repricing rule "${rule.name}" created (ID: ${rule.id})`,
        });
      }

      case 'list_repricing_rules': {
        let rules = getRules(db, userId);

        if (input.enabled_only === true) {
          rules = rules.filter(r => r.enabled);
        }
        if (input.type) {
          rules = rules.filter(r => r.type === input.type);
        }

        return JSON.stringify({
          success: true,
          count: rules.length,
          rules: rules.map(r => ({
            id: r.id,
            name: r.name,
            type: r.type,
            platform: r.platform,
            category: r.category,
            sku_pattern: r.sku_pattern,
            params: r.params,
            priority: r.priority,
            enabled: r.enabled,
          })),
        });
      }

      case 'run_repricer': {
        const dryRun = input.dry_run !== false; // default true
        const listingIds = input.listing_ids as string[] | undefined;

        // Get all active listings to reprice
        let listings: Array<Record<string, unknown>>;
        if (listingIds && listingIds.length > 0) {
          const placeholders = listingIds.map(() => '?').join(',');
          listings = db.query<Record<string, unknown>>(
            `SELECT * FROM listings WHERE id IN (${placeholders}) AND status = 'active'`,
            listingIds,
          );
        } else {
          listings = db.query<Record<string, unknown>>(
            "SELECT * FROM listings WHERE status = 'active'",
          );
        }

        const rules = getRules(db, userId).filter(r => r.enabled);
        if (rules.length === 0) {
          return JSON.stringify({ success: true, message: 'No enabled repricing rules found', changes: [] });
        }

        const changes: Array<{
          listing_id: string;
          old_price: number;
          new_price: number;
          rule_name: string;
          reason: string;
        }> = [];

        for (const listing of listings) {
          const listingId = listing.id as string;
          const currentPrice = listing.price as number;
          const platform = listing.platform as string;

          // Filter rules applicable to this listing
          const applicableRules = rules.filter(r => {
            if (r.platform !== 'all' && r.platform !== platform) return false;
            return true;
          });

          if (applicableRules.length === 0) continue;

          // Get market data (if available)
          const marketData: MarketData = ctx.getMarketData
            ? ctx.getMarketData(listingId)
            : { competitorPrices: [], costPrice: (listing.source_price as number) ?? undefined };

          const result = applyRules(applicableRules, currentPrice, marketData);

          if (result.triggered && result.newPrice !== null) {
            if (!dryRun) {
              // Apply the price change
              try {
                db.run(
                  'UPDATE listings SET price = ?, updated_at = ? WHERE id = ?',
                  [result.newPrice, Date.now(), listingId],
                );
              } catch (err) {
                logger.error({ err, listingId }, 'Failed to apply reprice');
                continue;
              }
            }

            // Record history
            recordRepricingHistory(db, {
              listing_id: listingId,
              rule_id: result.ruleId ?? null,
              rule_name: result.ruleName ?? null,
              old_price: currentPrice,
              new_price: result.newPrice,
              reason: result.reason,
              dry_run: dryRun,
            });

            changes.push({
              listing_id: listingId,
              old_price: currentPrice,
              new_price: result.newPrice,
              rule_name: result.ruleName ?? 'unknown',
              reason: result.reason,
            });
          }
        }

        return JSON.stringify({
          success: true,
          dry_run: dryRun,
          listings_checked: listings.length,
          changes_count: changes.length,
          changes,
          message: dryRun
            ? `Dry run: ${changes.length} price changes would be applied`
            : `Applied ${changes.length} price changes`,
        });
      }

      case 'repricing_history': {
        const history = getRepricingHistory(db, {
          listing_id: input.listing_id as string | undefined,
          days: input.days != null ? Number(input.days) : 7,
          limit: input.limit != null ? Number(input.limit) : 50,
        });

        return JSON.stringify({
          success: true,
          count: history.length,
          history: history.map(h => ({
            id: h.id,
            listing_id: h.listing_id,
            rule_name: h.rule_name,
            old_price: h.old_price,
            new_price: h.new_price,
            reason: h.reason,
            dry_run: h.dry_run,
            created_at: new Date(h.created_at).toISOString(),
          })),
        });
      }

      default:
        return JSON.stringify({ success: false, error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, toolName }, 'Repricer tool handler error');
    return JSON.stringify({ success: false, error: msg });
  }
}
