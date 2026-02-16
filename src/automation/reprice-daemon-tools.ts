/**
 * Reprice Daemon Tools - Tool definitions and handler for the agent tool registry.
 *
 * Exposes CRUD, start/stop, manual run, history, and stats as agent tools.
 */

import type { Database } from '../db/index.js';
import {
  createRepriceDaemonConfig,
  updateRepriceDaemonConfig,
  getRepriceDaemonConfigs,
  getRepriceDaemonConfigById,
  deleteRepriceDaemonConfig,
  startRepriceDaemon,
  stopRepriceDaemon,
  isDaemonRunning,
  runRepriceCycle,
  getRepriceHistory,
  getRepriceStats,
  getRepriceSummary,
} from './reprice-daemon.js';
import type {
  RepriceDaemonConfig,
  RepriceFn,
  RepriceResult,
} from './reprice-daemon.js';
import { calculateDynamicPrice } from '../pricing/dynamic-pricer.js';

// =============================================================================
// Tool Definitions
// =============================================================================

export const repriceDaemonTools = [
  {
    name: 'reprice_daemon_create',
    description: 'Create a repricing daemon configuration with strategies and scheduling',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Human-readable name for this config' },
        interval_minutes: {
          type: 'number' as const,
          description: 'How often to run repricing cycles in minutes (default 5)',
        },
        batch_size: {
          type: 'number' as const,
          description: 'Max listings to check per cycle (default 50)',
        },
        strategies: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description:
            'Strategies to apply: competitive, velocity_based, time_decay, competition_reactive, inventory_pressure',
        },
        min_price: { type: 'number' as const, description: 'Global price floor' },
        max_price: { type: 'number' as const, description: 'Global price ceiling' },
        max_change_pct: {
          type: 'number' as const,
          description: 'Max % price change per cycle (default 5)',
        },
        cooldown_minutes: {
          type: 'number' as const,
          description: 'Min minutes between reprices of same listing (default 30)',
        },
        platforms: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Only reprice listings on these platforms (empty = all)',
        },
        only_active: {
          type: 'boolean' as const,
          description: 'Only reprice active listings (default true)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'reprice_daemon_list',
    description: 'List all repricing daemon configurations with their status and stats',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'reprice_daemon_update',
    description: 'Update a repricing daemon configuration',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const, description: 'Daemon config ID to update' },
        name: { type: 'string' as const },
        enabled: { type: 'boolean' as const },
        interval_minutes: { type: 'number' as const },
        batch_size: { type: 'number' as const },
        strategies: { type: 'array' as const, items: { type: 'string' as const } },
        min_price: { type: 'number' as const },
        max_price: { type: 'number' as const },
        max_change_pct: { type: 'number' as const },
        cooldown_minutes: { type: 'number' as const },
        platforms: { type: 'array' as const, items: { type: 'string' as const } },
        only_active: { type: 'boolean' as const },
      },
      required: ['id'],
    },
  },
  {
    name: 'reprice_daemon_delete',
    description: 'Disable (soft-delete) a repricing daemon configuration',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const, description: 'Daemon config ID to delete' },
      },
      required: ['id'],
    },
  },
  {
    name: 'reprice_daemon_start',
    description: 'Start the repricing daemon (runs all enabled configs on their intervals)',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'reprice_daemon_stop',
    description: 'Stop the running repricing daemon',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'reprice_daemon_run',
    description: 'Manually run a single repricing cycle for a specific config',
    input_schema: {
      type: 'object' as const,
      properties: {
        config_id: { type: 'string' as const, description: 'Daemon config ID to run' },
      },
      required: ['config_id'],
    },
  },
  {
    name: 'reprice_daemon_history',
    description: 'View repricing history with optional filters',
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_id: { type: 'string' as const, description: 'Filter by listing ID' },
        config_id: { type: 'string' as const, description: 'Filter by daemon config ID' },
        strategy: { type: 'string' as const, description: 'Filter by strategy name' },
        days: { type: 'number' as const, description: 'Number of days of history (default 30)' },
        limit: { type: 'number' as const, description: 'Max results (default 100)' },
      },
    },
  },
  {
    name: 'reprice_daemon_stats',
    description: 'Get aggregate repricing statistics (total reprices, avg change, by strategy, by day)',
    input_schema: {
      type: 'object' as const,
      properties: {
        config_id: { type: 'string' as const, description: 'Filter by daemon config ID (optional)' },
        days: { type: 'number' as const, description: 'Number of days to analyze (default 30)' },
      },
    },
  },
] as const;

// =============================================================================
// Default reprice function (delegates to dynamic-pricer strategies)
// =============================================================================

/**
 * Build a default repriceFn that delegates to the existing dynamic pricing
 * strategy implementations. Can be overridden by callers of startRepriceDaemon.
 */
function buildDefaultRepriceFn(db: Database): RepriceFn {
  return (listing: Record<string, unknown>, strategy: string): RepriceResult => {
    const listingId = listing.id as string;

    // Map daemon strategy names to dynamic pricer strategy names
    const strategyMap: Record<string, string> = {
      competitive: 'competition_reactive',
      velocity_based: 'demand_based',
      time_decay: 'time_decay',
      competition_reactive: 'competition_reactive',
      inventory_pressure: 'inventory_pressure',
    };

    const pricerStrategy = strategyMap[strategy] ?? strategy;

    try {
      const result = calculateDynamicPrice(
        db,
        listingId,
        pricerStrategy as 'demand_based' | 'time_decay' | 'competition_reactive' | 'inventory_pressure',
      );

      return {
        newPrice: result.newPrice,
        reason: result.reason,
        strategy: strategy,
      };
    } catch (err) {
      return {
        newPrice: null,
        reason: `Strategy ${strategy} error: ${err instanceof Error ? err.message : String(err)}`,
        strategy,
      };
    }
  };
}

// =============================================================================
// Tool Handler
// =============================================================================

export interface RepriceDaemonToolInput {
  name?: string;
  id?: string;
  config_id?: string;
  enabled?: boolean;
  interval_minutes?: number;
  batch_size?: number;
  strategies?: string[];
  min_price?: number;
  max_price?: number;
  max_change_pct?: number;
  cooldown_minutes?: number;
  platforms?: string[];
  only_active?: boolean;
  listing_id?: string;
  strategy?: string;
  days?: number;
  limit?: number;
}

/**
 * Handle reprice daemon tool calls from the agent.
 */
export function handleRepriceDaemonTool(
  db: Database,
  toolName: string,
  input: RepriceDaemonToolInput,
): { status: 'ok' | 'error'; data?: unknown; message?: string } {
  try {
    switch (toolName) {
      // ── Create ──────────────────────────────────────────────────────
      case 'reprice_daemon_create': {
        if (!input.name) {
          return { status: 'error', message: 'name is required' };
        }

        const config: Partial<RepriceDaemonConfig> = {};

        if (Number.isFinite(input.interval_minutes)) {
          config.intervalMs = input.interval_minutes! * 60_000;
        }
        if (Number.isFinite(input.batch_size)) {
          config.batchSize = input.batch_size!;
        }
        if (Array.isArray(input.strategies) && input.strategies.length > 0) {
          config.strategies = input.strategies;
        }
        if (Number.isFinite(input.min_price)) {
          config.minPrice = input.min_price!;
        }
        if (Number.isFinite(input.max_price)) {
          config.maxPrice = input.max_price!;
        }
        if (Number.isFinite(input.max_change_pct)) {
          config.maxChangePerCyclePct = input.max_change_pct!;
        }
        if (Number.isFinite(input.cooldown_minutes)) {
          config.cooldownMs = input.cooldown_minutes! * 60_000;
        }
        if (Array.isArray(input.platforms)) {
          config.platformFilter = input.platforms;
        }
        if (typeof input.only_active === 'boolean') {
          config.onlyActiveListings = input.only_active;
        }

        const record = createRepriceDaemonConfig(db, input.name, config);
        return { status: 'ok', data: record };
      }

      // ── List ────────────────────────────────────────────────────────
      case 'reprice_daemon_list': {
        const configs = getRepriceDaemonConfigs(db);
        const running = isDaemonRunning();
        return {
          status: 'ok',
          data: {
            daemonRunning: running,
            configs,
          },
        };
      }

      // ── Update ──────────────────────────────────────────────────────
      case 'reprice_daemon_update': {
        if (!input.id) {
          return { status: 'error', message: 'id is required' };
        }

        const updates: Partial<RepriceDaemonConfig> & { name?: string; enabled?: boolean } = {};

        if (input.name !== undefined) updates.name = input.name;
        if (typeof input.enabled === 'boolean') updates.enabled = input.enabled;
        if (Number.isFinite(input.interval_minutes)) {
          updates.intervalMs = input.interval_minutes! * 60_000;
        }
        if (Number.isFinite(input.batch_size)) {
          updates.batchSize = input.batch_size!;
        }
        if (Array.isArray(input.strategies)) {
          updates.strategies = input.strategies;
        }
        if (Number.isFinite(input.min_price)) {
          updates.minPrice = input.min_price!;
        }
        if (Number.isFinite(input.max_price)) {
          updates.maxPrice = input.max_price!;
        }
        if (Number.isFinite(input.max_change_pct)) {
          updates.maxChangePerCyclePct = input.max_change_pct!;
        }
        if (Number.isFinite(input.cooldown_minutes)) {
          updates.cooldownMs = input.cooldown_minutes! * 60_000;
        }
        if (Array.isArray(input.platforms)) {
          updates.platformFilter = input.platforms;
        }
        if (typeof input.only_active === 'boolean') {
          updates.onlyActiveListings = input.only_active;
        }

        const updated = updateRepriceDaemonConfig(db, input.id, updates);
        if (!updated) {
          return { status: 'error', message: `Config not found: ${input.id}` };
        }
        return { status: 'ok', data: updated };
      }

      // ── Delete ──────────────────────────────────────────────────────
      case 'reprice_daemon_delete': {
        if (!input.id) {
          return { status: 'error', message: 'id is required' };
        }
        const deleted = deleteRepriceDaemonConfig(db, input.id);
        if (!deleted) {
          return { status: 'error', message: `Config not found: ${input.id}` };
        }
        return { status: 'ok', data: { deleted: true, id: input.id } };
      }

      // ── Start ───────────────────────────────────────────────────────
      case 'reprice_daemon_start': {
        if (isDaemonRunning()) {
          return { status: 'error', message: 'Reprice daemon is already running' };
        }

        const repriceFn = buildDefaultRepriceFn(db);
        const handle = startRepriceDaemon(db, repriceFn);

        const configs = getRepriceDaemonConfigs(db).filter((c) => c.enabled);
        return {
          status: 'ok',
          data: {
            started: true,
            enabledConfigs: configs.length,
            configNames: configs.map((c) => c.name),
          },
        };
      }

      // ── Stop ────────────────────────────────────────────────────────
      case 'reprice_daemon_stop': {
        const stopped = stopRepriceDaemon();
        return {
          status: 'ok',
          data: { stopped, wasRunning: stopped },
        };
      }

      // ── Manual Run ──────────────────────────────────────────────────
      case 'reprice_daemon_run': {
        const configId = input.config_id ?? input.id;
        if (!configId) {
          return { status: 'error', message: 'config_id is required' };
        }

        const record = getRepriceDaemonConfigById(db, configId);
        if (!record) {
          return { status: 'error', message: `Config not found: ${configId}` };
        }

        const repriceFn = buildDefaultRepriceFn(db);
        const result = runRepriceCycle(db, record, repriceFn);
        return { status: 'ok', data: result };
      }

      // ── History ─────────────────────────────────────────────────────
      case 'reprice_daemon_history': {
        const daysBack = Number.isFinite(input.days) ? input.days! : 30;
        const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

        const history = getRepriceHistory(db, {
          listingId: input.listing_id,
          daemonConfigId: input.config_id,
          strategy: input.strategy,
          startDate: cutoff,
          limit: Number.isFinite(input.limit) ? input.limit! : 100,
        });

        return { status: 'ok', data: { count: history.length, history } };
      }

      // ── Stats ───────────────────────────────────────────────────────
      case 'reprice_daemon_stats': {
        const days = Number.isFinite(input.days) ? input.days! : 30;
        const stats = getRepriceStats(db, input.config_id, days);
        const summary = getRepriceSummary(db, days);

        return {
          status: 'ok',
          data: {
            stats,
            summary,
          },
        };
      }

      default:
        return { status: 'error', message: `Unknown reprice daemon tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'error', message };
  }
}
