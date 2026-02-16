/**
 * Scout Tools - Tool definitions and handler for the auto-scout pipeline.
 *
 * Provides LLM-callable tools to create, manage, and operate scout configs,
 * review the opportunity queue, and control the daemon lifecycle.
 */

import type { Database } from '../db/index.js';
import {
  createScoutConfig,
  updateScoutConfig,
  getScoutConfigs,
  getScoutConfig,
  deleteScoutConfig,
  getScoutQueue,
  approveScoutItem,
  rejectScoutItem,
  runScoutScan,
  startScoutDaemon,
  getScoutStats,
  expireStaleItems,
} from './auto-scout.js';
import type {
  ScoutConfig,
  ScanFn,
  DaemonHandle,
  QueueFilterOptions,
} from './auto-scout.js';

// =============================================================================
// Module-level daemon state
// =============================================================================

let daemon: DaemonHandle | null = null;

// =============================================================================
// Tool Definitions
// =============================================================================

export const scoutTools = [
  {
    name: 'scout_create',
    description: 'Create a new auto-scout config for scanning source platforms',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string' as const,
          description: 'Human-readable name for this scout profile',
        },
        platforms: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Source platforms to scan (e.g. amazon, walmart, target)',
        },
        keywords: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Search keywords to rotate through each scan',
        },
        categories: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Product categories to focus on',
        },
        min_margin_pct: {
          type: 'number' as const,
          description: 'Minimum profit margin % to qualify (default 20)',
        },
        max_source_price: {
          type: 'number' as const,
          description: 'Maximum source price in USD (default 100)',
        },
        min_source_price: {
          type: 'number' as const,
          description: 'Minimum source price in USD (default 5)',
        },
        max_results: {
          type: 'number' as const,
          description: 'Max results per platform per keyword (default 50)',
        },
        auto_list: {
          type: 'boolean' as const,
          description: 'Auto-create listings or queue for review (default false)',
        },
        target_platform: {
          type: 'string' as const,
          description: 'Where to sell (default ebay)',
        },
        interval_minutes: {
          type: 'number' as const,
          description: 'Scan interval in minutes (default 15)',
        },
        exclude_brands: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Brands to skip (IP risk)',
        },
        exclude_categories: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Categories to exclude',
        },
      },
      required: ['name'] as const,
    },
    metadata: {
      category: 'automation',
      tags: ['scout', 'scan', 'arbitrage', 'create'],
    },
  },
  {
    name: 'scout_list',
    description: 'List all auto-scout configs',
    input_schema: {
      type: 'object' as const,
      properties: {
        enabled_only: {
          type: 'boolean' as const,
          description: 'Only show enabled configs (default false)',
        },
      },
    },
    metadata: {
      category: 'automation',
      tags: ['scout', 'list', 'config'],
    },
  },
  {
    name: 'scout_update',
    description: 'Update an existing auto-scout config',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string' as const,
          description: 'Scout config ID to update',
        },
        name: {
          type: 'string' as const,
          description: 'New name',
        },
        enabled: {
          type: 'boolean' as const,
          description: 'Enable or disable',
        },
        platforms: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Source platforms to scan',
        },
        keywords: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Search keywords',
        },
        min_margin_pct: {
          type: 'number' as const,
          description: 'Minimum profit margin %',
        },
        max_source_price: {
          type: 'number' as const,
          description: 'Maximum source price',
        },
        min_source_price: {
          type: 'number' as const,
          description: 'Minimum source price',
        },
        auto_list: {
          type: 'boolean' as const,
          description: 'Auto-list or queue for review',
        },
        target_platform: {
          type: 'string' as const,
          description: 'Where to sell',
        },
        interval_minutes: {
          type: 'number' as const,
          description: 'Scan interval in minutes',
        },
        exclude_brands: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Brands to skip',
        },
        exclude_categories: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Categories to exclude',
        },
      },
      required: ['id'] as const,
    },
    metadata: {
      category: 'automation',
      tags: ['scout', 'update', 'config'],
    },
  },
  {
    name: 'scout_delete',
    description: 'Disable/soft-delete a scout config',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string' as const,
          description: 'Scout config ID to disable',
        },
      },
      required: ['id'] as const,
    },
    metadata: {
      category: 'automation',
      tags: ['scout', 'delete', 'config'],
    },
  },
  {
    name: 'scout_run',
    description: 'Manually trigger a single scan cycle for a specific scout config',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string' as const,
          description: 'Scout config ID to run',
        },
      },
      required: ['id'] as const,
    },
    metadata: {
      category: 'automation',
      tags: ['scout', 'run', 'scan', 'manual'],
    },
  },
  {
    name: 'scout_queue',
    description: 'View queued scout opportunities with optional filters',
    input_schema: {
      type: 'object' as const,
      properties: {
        status: {
          type: 'string' as const,
          enum: ['pending', 'approved', 'listed', 'rejected', 'expired'],
          description: 'Filter by status',
        },
        config_id: {
          type: 'string' as const,
          description: 'Filter by scout config ID',
        },
        limit: {
          type: 'number' as const,
          description: 'Max items to return (default 50)',
        },
      },
    },
    metadata: {
      category: 'automation',
      tags: ['scout', 'queue', 'opportunities', 'review'],
    },
  },
  {
    name: 'scout_approve',
    description: 'Approve a queued scout item for listing',
    input_schema: {
      type: 'object' as const,
      properties: {
        item_id: {
          type: 'string' as const,
          description: 'Queue item ID to approve',
        },
      },
      required: ['item_id'] as const,
    },
    metadata: {
      category: 'automation',
      tags: ['scout', 'approve', 'review'],
    },
  },
  {
    name: 'scout_reject',
    description: 'Reject a queued scout item',
    input_schema: {
      type: 'object' as const,
      properties: {
        item_id: {
          type: 'string' as const,
          description: 'Queue item ID to reject',
        },
      },
      required: ['item_id'] as const,
    },
    metadata: {
      category: 'automation',
      tags: ['scout', 'reject', 'review'],
    },
  },
  {
    name: 'scout_start',
    description: 'Start the auto-scout daemon (scans all enabled configs on their intervals)',
    input_schema: {
      type: 'object' as const,
      properties: {
        interval_override_minutes: {
          type: 'number' as const,
          description: 'Override scan interval for all configs (minutes)',
        },
      },
    },
    metadata: {
      category: 'automation',
      tags: ['scout', 'daemon', 'start'],
    },
  },
  {
    name: 'scout_stop',
    description: 'Stop the running auto-scout daemon',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
    metadata: {
      category: 'automation',
      tags: ['scout', 'daemon', 'stop'],
    },
  },
  {
    name: 'scout_stats',
    description: 'Get scout statistics (total scanned, queued, approved, listed, by day)',
    input_schema: {
      type: 'object' as const,
      properties: {
        config_id: {
          type: 'string' as const,
          description: 'Filter stats to a specific config (optional)',
        },
      },
    },
    metadata: {
      category: 'automation',
      tags: ['scout', 'stats', 'analytics'],
    },
  },
];

// =============================================================================
// Tool Handler
// =============================================================================

interface ScoutToolContext {
  db: Database;
  /** Optional scan function injected by the host. If not provided, scout_run
   *  and scout_start will return an error explaining no scan function is
   *  configured. */
  scanFn?: ScanFn;
}

/**
 * Handle a scout tool call. Returns a result object with `status` and
 * either `data` or `message`.
 */
export function handleScoutTool(
  name: string,
  input: Record<string, unknown>,
  context: ScoutToolContext,
): unknown {
  const { db } = context;

  try {
    switch (name) {
      // ── scout_create ─────────────────────────────────────────────────
      case 'scout_create': {
        const configName = input.name as string | undefined;
        if (!configName?.trim()) {
          return { status: 'error', message: 'name is required' };
        }

        const partial: Partial<ScoutConfig> = {};
        if (Array.isArray(input.platforms)) partial.platforms = input.platforms as string[];
        if (Array.isArray(input.keywords)) partial.keywords = input.keywords as string[];
        if (Array.isArray(input.categories)) partial.categories = input.categories as string[];
        if (Number.isFinite(input.min_margin_pct)) partial.minMarginPct = input.min_margin_pct as number;
        if (Number.isFinite(input.max_source_price)) partial.maxSourcePrice = input.max_source_price as number;
        if (Number.isFinite(input.min_source_price)) partial.minSourcePrice = input.min_source_price as number;
        if (Number.isFinite(input.max_results)) partial.maxResults = input.max_results as number;
        if (typeof input.auto_list === 'boolean') partial.autoList = input.auto_list;
        if (typeof input.target_platform === 'string') partial.targetPlatform = input.target_platform;
        if (Array.isArray(input.exclude_brands)) partial.excludeBrands = input.exclude_brands as string[];
        if (Array.isArray(input.exclude_categories)) partial.excludeCategories = input.exclude_categories as string[];
        if (Number.isFinite(input.interval_minutes)) {
          partial.intervalMs = (input.interval_minutes as number) * 60_000;
        }

        const row = createScoutConfig(db, configName.trim(), partial);
        return { status: 'ok', data: row };
      }

      // ── scout_list ───────────────────────────────────────────────────
      case 'scout_list': {
        let configs = getScoutConfigs(db);
        if (input.enabled_only === true) {
          configs = configs.filter((c) => c.enabled);
        }
        return { status: 'ok', data: { configs, count: configs.length } };
      }

      // ── scout_update ─────────────────────────────────────────────────
      case 'scout_update': {
        const id = input.id as string | undefined;
        if (!id?.trim()) {
          return { status: 'error', message: 'id is required' };
        }

        const updates: Partial<ScoutConfig> & { name?: string } = {};
        if (typeof input.name === 'string') updates.name = input.name;
        if (typeof input.enabled === 'boolean') updates.enabled = input.enabled;
        if (Array.isArray(input.platforms)) updates.platforms = input.platforms as string[];
        if (Array.isArray(input.keywords)) updates.keywords = input.keywords as string[];
        if (Number.isFinite(input.min_margin_pct)) updates.minMarginPct = input.min_margin_pct as number;
        if (Number.isFinite(input.max_source_price)) updates.maxSourcePrice = input.max_source_price as number;
        if (Number.isFinite(input.min_source_price)) updates.minSourcePrice = input.min_source_price as number;
        if (typeof input.auto_list === 'boolean') updates.autoList = input.auto_list;
        if (typeof input.target_platform === 'string') updates.targetPlatform = input.target_platform;
        if (Array.isArray(input.exclude_brands)) updates.excludeBrands = input.exclude_brands as string[];
        if (Array.isArray(input.exclude_categories)) updates.excludeCategories = input.exclude_categories as string[];
        if (Number.isFinite(input.interval_minutes)) {
          updates.intervalMs = (input.interval_minutes as number) * 60_000;
        }

        const updated = updateScoutConfig(db, id.trim(), updates);
        if (!updated) {
          return { status: 'error', message: `Scout config ${id} not found` };
        }
        return { status: 'ok', data: updated };
      }

      // ── scout_delete ─────────────────────────────────────────────────
      case 'scout_delete': {
        const id = input.id as string | undefined;
        if (!id?.trim()) {
          return { status: 'error', message: 'id is required' };
        }

        const deleted = deleteScoutConfig(db, id.trim());
        if (!deleted) {
          return { status: 'error', message: `Scout config ${id} not found` };
        }
        return { status: 'ok', data: { id, disabled: true } };
      }

      // ── scout_run ────────────────────────────────────────────────────
      case 'scout_run': {
        const id = input.id as string | undefined;
        if (!id?.trim()) {
          return { status: 'error', message: 'id is required' };
        }
        if (!context.scanFn) {
          return { status: 'error', message: 'No scan function configured. Cannot run scan.' };
        }

        const config = getScoutConfig(db, id.trim());
        if (!config) {
          return { status: 'error', message: `Scout config ${id} not found` };
        }

        // runScoutScan is async — return a promise-wrapped result
        // The tool handler framework should await this.
        return runScoutScan(db, config, context.scanFn)
          .then((summary) => ({ status: 'ok', data: summary }))
          .catch((err) => ({ status: 'error', message: err instanceof Error ? err.message : String(err) }));
      }

      // ── scout_queue ──────────────────────────────────────────────────
      case 'scout_queue': {
        const opts: QueueFilterOptions = {};
        if (typeof input.status === 'string') opts.status = input.status;
        if (typeof input.config_id === 'string') opts.configId = input.config_id;
        if (Number.isFinite(input.limit)) opts.limit = input.limit as number;

        const items = getScoutQueue(db, opts);
        return { status: 'ok', data: { items, count: items.length } };
      }

      // ── scout_approve ────────────────────────────────────────────────
      case 'scout_approve': {
        const itemId = input.item_id as string | undefined;
        if (!itemId?.trim()) {
          return { status: 'error', message: 'item_id is required' };
        }

        const approved = approveScoutItem(db, itemId.trim());
        if (!approved) {
          return { status: 'error', message: `Item ${itemId} not found or not in pending status` };
        }
        return { status: 'ok', data: { itemId, status: 'approved' } };
      }

      // ── scout_reject ─────────────────────────────────────────────────
      case 'scout_reject': {
        const itemId = input.item_id as string | undefined;
        if (!itemId?.trim()) {
          return { status: 'error', message: 'item_id is required' };
        }

        const rejected = rejectScoutItem(db, itemId.trim());
        if (!rejected) {
          return { status: 'error', message: `Item ${itemId} not found or not in pending status` };
        }
        return { status: 'ok', data: { itemId, status: 'rejected' } };
      }

      // ── scout_start ──────────────────────────────────────────────────
      case 'scout_start': {
        if (daemon) {
          return { status: 'error', message: 'Scout daemon is already running. Stop it first.' };
        }
        if (!context.scanFn) {
          return { status: 'error', message: 'No scan function configured. Cannot start daemon.' };
        }

        const overrideMin = input.interval_override_minutes;
        const opts = Number.isFinite(overrideMin)
          ? { intervalOverrideMs: (overrideMin as number) * 60_000 }
          : undefined;

        daemon = startScoutDaemon(db, context.scanFn, opts);
        return { status: 'ok', data: { message: 'Scout daemon started' } };
      }

      // ── scout_stop ───────────────────────────────────────────────────
      case 'scout_stop': {
        if (!daemon) {
          return { status: 'error', message: 'Scout daemon is not running' };
        }
        daemon.stop();
        daemon = null;
        return { status: 'ok', data: { message: 'Scout daemon stopped' } };
      }

      // ── scout_stats ──────────────────────────────────────────────────
      case 'scout_stats': {
        const configId = typeof input.config_id === 'string' ? input.config_id : undefined;
        const stats = getScoutStats(db, configId);
        return { status: 'ok', data: stats };
      }

      default:
        return { status: 'error', message: `Unknown scout tool: ${name}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'error', message };
  }
}

/**
 * Check whether the scout daemon is currently running.
 */
export function isScoutDaemonRunning(): boolean {
  return daemon !== null;
}

/**
 * Expire stale pending items (convenience wrapper for tool use).
 */
export function expireStaleScoutItems(db: Database, maxAgeDays: number): number {
  return expireStaleItems(db, maxAgeDays);
}
