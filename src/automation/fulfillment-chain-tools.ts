/**
 * Fulfillment Chain Tools - AI Agent tool definitions and handler
 *
 * Exposes fulfillment chain automation as agent tools:
 * - Configure, start/stop daemon, run manual cycles
 * - View pipeline, list/detail entries, retry/cancel
 * - View statistics
 */

import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import {
  saveFulfillmentConfig,
  getFulfillmentConfig,
  getChainEntries,
  getChainEntryWithLog,
  retryChainEntry,
  cancelChainEntry,
  getFulfillmentPipeline,
  getFulfillmentStats,
  startFulfillmentDaemon,
  stopFulfillmentDaemon,
  isDaemonRunning,
  runFulfillmentCycle,
  type FulfillmentChainConfig,
  type FulfillmentDeps,
  type FulfillmentStatus,
  type ChainEntryFilters,
} from './fulfillment-chain.js';

const logger = createLogger('fulfillment-chain-tools');

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const fulfillmentChainTools = [
  {
    name: 'fulfillment_chain_config',
    description: 'View or update the fulfillment chain configuration (auto-purchase, tracking push, platforms, safety caps)',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string' as const,
          enum: ['view', 'update'],
          description: 'Whether to view or update config (default: view)',
        },
        enabled: {
          type: 'boolean' as const,
          description: 'Enable/disable the fulfillment chain',
        },
        auto_purchase: {
          type: 'boolean' as const,
          description: 'Enable auto-purchase from source platforms',
        },
        auto_tracking_push: {
          type: 'boolean' as const,
          description: 'Enable auto-push tracking to selling platforms',
        },
        max_auto_purchase_amount: {
          type: 'number' as const,
          description: 'Maximum price for auto-purchase safety cap (default: $50)',
        },
        poll_interval_ms: {
          type: 'number' as const,
          description: 'Poll interval in milliseconds (default: 300000 = 5 min)',
        },
        platforms: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Selling platforms to monitor for orders',
        },
        source_priority_order: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Source platforms in priority order (e.g., ["aliexpress", "amazon", "walmart"])',
        },
        notify_on_new_order: { type: 'boolean' as const },
        notify_on_purchase: { type: 'boolean' as const },
        notify_on_shipped: { type: 'boolean' as const },
      },
    },
  },
  {
    name: 'fulfillment_chain_start',
    description: 'Start the fulfillment chain daemon (polls for new orders and auto-processes them)',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'fulfillment_chain_stop',
    description: 'Stop the fulfillment chain daemon',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'fulfillment_chain_run',
    description: 'Run a single fulfillment cycle manually (poll orders, find sources, purchase, push tracking)',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'fulfillment_chain_pipeline',
    description: 'View the current fulfillment pipeline (count of orders per status stage)',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'fulfillment_chain_list',
    description: 'List fulfillment chain entries with optional filters (status, platform, date range)',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string' as const,
          description: 'Filter by status (new_order, source_identified, purchasing, purchased, tracking_received, tracking_pushed, delivered, complete, purchase_failed, tracking_failed, manual_needed, cancelled)',
        },
        sell_platform: {
          type: 'string' as const,
          description: 'Filter by selling platform',
        },
        source_platform: {
          type: 'string' as const,
          description: 'Filter by source platform',
        },
        days: {
          type: 'number' as const,
          description: 'Only show entries from the last N days',
        },
        limit: {
          type: 'number' as const,
          description: 'Maximum entries to return (default: 50)',
        },
      },
    },
  },
  {
    name: 'fulfillment_chain_detail',
    description: 'Get detailed view of a single fulfillment chain entry including its full action log',
    input_schema: {
      type: 'object' as const,
      properties: {
        chain_id: {
          type: 'string' as const,
          description: 'The fulfillment chain entry ID',
        },
      },
      required: ['chain_id'],
    },
  },
  {
    name: 'fulfillment_chain_retry',
    description: 'Retry a failed fulfillment chain entry (resets status to new_order for reprocessing)',
    input_schema: {
      type: 'object' as const,
      properties: {
        chain_id: {
          type: 'string' as const,
          description: 'The fulfillment chain entry ID to retry',
        },
      },
      required: ['chain_id'],
    },
  },
  {
    name: 'fulfillment_chain_cancel',
    description: 'Cancel a fulfillment chain entry',
    input_schema: {
      type: 'object' as const,
      properties: {
        chain_id: {
          type: 'string' as const,
          description: 'The fulfillment chain entry ID to cancel',
        },
        reason: {
          type: 'string' as const,
          description: 'Reason for cancellation',
        },
      },
      required: ['chain_id'],
    },
  },
  {
    name: 'fulfillment_chain_stats',
    description: 'View fulfillment chain statistics (orders processed, auto-purchased, avg profit, by platform)',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: {
          type: 'number' as const,
          description: 'Number of days to look back (default: all time)',
        },
      },
    },
  },
] as const;

// =============================================================================
// TOOL INPUT TYPE
// =============================================================================

interface FulfillmentChainToolInput {
  action?: string;
  enabled?: boolean;
  auto_purchase?: boolean;
  auto_tracking_push?: boolean;
  max_auto_purchase_amount?: number;
  poll_interval_ms?: number;
  platforms?: string[];
  source_priority_order?: string[];
  notify_on_new_order?: boolean;
  notify_on_purchase?: boolean;
  notify_on_shipped?: boolean;
  chain_id?: string;
  status?: string;
  sell_platform?: string;
  source_platform?: string;
  days?: number;
  limit?: number;
  reason?: string;
}

// =============================================================================
// MODULE-LEVEL DEPS HOLDER
// =============================================================================

let registeredDeps: FulfillmentDeps | null = null;

/**
 * Register fulfillment dependencies so the tool handler can use them.
 * Call once at startup with the real platform adapters.
 */
export function registerFulfillmentDeps(deps: FulfillmentDeps): void {
  registeredDeps = deps;
}

// =============================================================================
// HANDLER
// =============================================================================

export function handleFulfillmentChainTool(
  db: Database,
  toolName: string,
  input: FulfillmentChainToolInput,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      // ── Config ──────────────────────────────────────────────────────
      case 'fulfillment_chain_config': {
        if (input.action === 'update') {
          const updates: Partial<FulfillmentChainConfig> = {};

          if (input.enabled !== undefined) updates.enabled = input.enabled;
          if (input.auto_purchase !== undefined) updates.autoPurchase = input.auto_purchase;
          if (input.auto_tracking_push !== undefined) updates.autoTrackingPush = input.auto_tracking_push;
          if (input.notify_on_new_order !== undefined) updates.notifyOnNewOrder = input.notify_on_new_order;
          if (input.notify_on_purchase !== undefined) updates.notifyOnPurchase = input.notify_on_purchase;
          if (input.notify_on_shipped !== undefined) updates.notifyOnShipped = input.notify_on_shipped;

          if (input.max_auto_purchase_amount !== undefined) {
            if (!Number.isFinite(input.max_auto_purchase_amount) || input.max_auto_purchase_amount < 0) {
              return { success: false, error: 'max_auto_purchase_amount must be a non-negative number' };
            }
            updates.maxAutoPurchaseAmount = input.max_auto_purchase_amount;
          }

          if (input.poll_interval_ms !== undefined) {
            if (!Number.isFinite(input.poll_interval_ms) || input.poll_interval_ms < 10_000) {
              return { success: false, error: 'poll_interval_ms must be at least 10000 (10 seconds)' };
            }
            updates.pollIntervalMs = input.poll_interval_ms;
          }

          if (input.platforms !== undefined) {
            if (!Array.isArray(input.platforms) || input.platforms.length === 0) {
              return { success: false, error: 'platforms must be a non-empty array of platform names' };
            }
            updates.platforms = input.platforms;
          }

          if (input.source_priority_order !== undefined) {
            if (!Array.isArray(input.source_priority_order) || input.source_priority_order.length === 0) {
              return { success: false, error: 'source_priority_order must be a non-empty array' };
            }
            updates.sourcePriorityOrder = input.source_priority_order;
          }

          const config = saveFulfillmentConfig(db, updates);
          return { success: true, data: { message: 'Config updated', config } };
        }

        // Default: view config
        const config = getFulfillmentConfig(db);
        return {
          success: true,
          data: {
            config,
            daemonRunning: isDaemonRunning(),
          },
        };
      }

      // ── Start daemon ────────────────────────────────────────────────
      case 'fulfillment_chain_start': {
        if (isDaemonRunning()) {
          return { success: false, error: 'Fulfillment daemon is already running' };
        }

        if (!registeredDeps) {
          return {
            success: false,
            error: 'Fulfillment dependencies not registered. Platform adapters must be configured first.',
          };
        }

        const config = getFulfillmentConfig(db);
        if (!config.enabled) {
          // Auto-enable on start
          saveFulfillmentConfig(db, { enabled: true });
        }

        startFulfillmentDaemon(db, registeredDeps);

        return {
          success: true,
          data: {
            message: 'Fulfillment daemon started',
            pollIntervalMs: config.pollIntervalMs,
            platforms: config.platforms,
            autoPurchase: config.autoPurchase,
            autoTrackingPush: config.autoTrackingPush,
          },
        };
      }

      // ── Stop daemon ─────────────────────────────────────────────────
      case 'fulfillment_chain_stop': {
        if (!isDaemonRunning()) {
          return { success: false, error: 'Fulfillment daemon is not running' };
        }

        stopFulfillmentDaemon();
        return { success: true, data: { message: 'Fulfillment daemon stopped' } };
      }

      // ── Run single cycle ────────────────────────────────────────────
      case 'fulfillment_chain_run': {
        if (!registeredDeps) {
          return {
            success: false,
            error: 'Fulfillment dependencies not registered. Platform adapters must be configured first.',
          };
        }

        // We cannot await here since the handler is sync; return a note
        // In practice, the agent framework should handle async tool results.
        // For now, kick off the cycle and return immediately.
        runFulfillmentCycle(db, registeredDeps)
          .then((summary) => {
            logger.info({ summary }, 'Manual fulfillment cycle completed');
          })
          .catch((err) => {
            logger.error({ err }, 'Manual fulfillment cycle failed');
          });

        return {
          success: true,
          data: {
            message: 'Fulfillment cycle started. Check pipeline for results.',
            daemonRunning: isDaemonRunning(),
          },
        };
      }

      // ── Pipeline view ───────────────────────────────────────────────
      case 'fulfillment_chain_pipeline': {
        const pipeline = getFulfillmentPipeline(db);
        return { success: true, data: pipeline };
      }

      // ── List entries ────────────────────────────────────────────────
      case 'fulfillment_chain_list': {
        const filters: ChainEntryFilters = {};

        if (input.status) {
          filters.status = input.status as FulfillmentStatus;
        }
        if (input.sell_platform) {
          filters.sellPlatform = input.sell_platform;
        }
        if (input.source_platform) {
          filters.sourcePlatform = input.source_platform;
        }
        if (input.days != null && Number.isFinite(input.days) && input.days > 0) {
          filters.dateFrom = Date.now() - input.days * 86_400_000;
        }
        if (input.limit != null && Number.isFinite(input.limit)) {
          filters.limit = Math.min(Math.max(input.limit, 1), 200);
        } else {
          filters.limit = 50;
        }

        const entries = getChainEntries(db, filters);

        return {
          success: true,
          data: {
            count: entries.length,
            entries: entries.map((e) => ({
              id: e.id,
              sellOrderId: e.sellOrderId,
              sellPlatform: e.sellPlatform,
              itemName: e.itemName,
              sellPrice: e.sellPrice,
              sourcePlatform: e.sourcePlatform,
              sourcePrice: e.sourcePrice,
              estimatedProfit: e.estimatedProfit,
              status: e.status,
              trackingNumber: e.trackingNumber,
              autoPurchased: e.autoPurchased,
              createdAt: new Date(e.createdAt).toISOString(),
            })),
          },
        };
      }

      // ── Detail view ─────────────────────────────────────────────────
      case 'fulfillment_chain_detail': {
        if (!input.chain_id?.trim()) {
          return { success: false, error: 'chain_id is required' };
        }

        const result = getChainEntryWithLog(db, input.chain_id);
        if (!result) {
          return { success: false, error: `Chain entry ${input.chain_id} not found` };
        }

        return {
          success: true,
          data: {
            entry: {
              ...result.entry,
              createdAt: new Date(result.entry.createdAt).toISOString(),
              updatedAt: new Date(result.entry.updatedAt).toISOString(),
            },
            log: result.log.map((l) => ({
              id: l.id,
              action: l.action,
              details: l.details ? JSON.parse(l.details) : null,
              createdAt: new Date(l.createdAt).toISOString(),
            })),
          },
        };
      }

      // ── Retry ───────────────────────────────────────────────────────
      case 'fulfillment_chain_retry': {
        if (!input.chain_id?.trim()) {
          return { success: false, error: 'chain_id is required' };
        }

        const entry = retryChainEntry(db, input.chain_id);
        if (!entry) {
          return {
            success: false,
            error: `Cannot retry chain ${input.chain_id}. Entry not found or not in a retryable status (purchase_failed, tracking_failed, manual_needed).`,
          };
        }

        return {
          success: true,
          data: {
            message: `Chain entry ${input.chain_id} reset to new_order for reprocessing`,
            entry: {
              id: entry.id,
              status: entry.status,
              sellOrderId: entry.sellOrderId,
              sellPlatform: entry.sellPlatform,
            },
          },
        };
      }

      // ── Cancel ──────────────────────────────────────────────────────
      case 'fulfillment_chain_cancel': {
        if (!input.chain_id?.trim()) {
          return { success: false, error: 'chain_id is required' };
        }

        const entry = cancelChainEntry(db, input.chain_id, input.reason);
        if (!entry) {
          return {
            success: false,
            error: `Cannot cancel chain ${input.chain_id}. Entry not found or already complete/cancelled.`,
          };
        }

        return {
          success: true,
          data: {
            message: `Chain entry ${input.chain_id} cancelled`,
            entry: {
              id: entry.id,
              status: entry.status,
              sellOrderId: entry.sellOrderId,
            },
          },
        };
      }

      // ── Stats ───────────────────────────────────────────────────────
      case 'fulfillment_chain_stats': {
        const days = input.days != null && Number.isFinite(input.days) && input.days > 0
          ? input.days
          : undefined;

        const stats = getFulfillmentStats(db, days);

        return {
          success: true,
          data: {
            period: days ? `Last ${days} days` : 'All time',
            ...stats,
            avgProfit: stats.avgProfit != null ? `$${stats.avgProfit.toFixed(2)}` : null,
            totalProfit: `$${stats.totalProfit.toFixed(2)}`,
            successRate: `${(stats.successRate * 100).toFixed(1)}%`,
          },
        };
      }

      default:
        return { success: false, error: `Unknown fulfillment chain tool: ${toolName}` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ toolName, err }, 'Fulfillment chain tool failed');
    return { success: false, error: msg };
  }
}
