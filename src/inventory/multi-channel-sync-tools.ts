/**
 * Multi-Channel Sync Tools - Tool definitions and handler for the agent tool registry.
 *
 * Exposes channel mapping CRUD, inventory adjustments, sync operations,
 * daemon start/stop, event log, and statistics as agent tools.
 */

import type { Database } from '../db/index.js';
import {
  createChannelMapping,
  addChannelEntry,
  removeChannelEntry,
  getChannelMapping,
  getAllChannelMappings,
  updateInventory,
  recordSale,
  recordRestock,
  syncToChannels,
  startSyncDaemon,
  stopSyncDaemon,
  isSyncDaemonRunning,
  getSyncEvents,
  getSyncStats,
  getDaemonConfig,
  updateDaemonConfig,
} from './multi-channel-sync.js';
import type { PushFn, SyncEventType } from './multi-channel-sync.js';

// =============================================================================
// Tool Definitions
// =============================================================================

export const multiChannelSyncTools = [
  {
    name: 'channel_mapping_create',
    description: 'Create a SKU-level channel mapping for multi-platform inventory sync',
    input_schema: {
      type: 'object' as const,
      properties: {
        sku: { type: 'string' as const, description: 'Unique SKU identifier for this product' },
        product_id: { type: 'string' as const, description: 'Optional product ID to link' },
        total_quantity: {
          type: 'number' as const,
          description: 'Initial total inventory quantity (default 0)',
        },
      },
      required: ['sku'],
    },
  },
  {
    name: 'channel_mapping_list',
    description: 'List all channel mappings with their linked platform channels',
    input_schema: {
      type: 'object' as const,
      properties: {
        sync_enabled_only: {
          type: 'boolean' as const,
          description: 'Only show mappings with sync enabled (default false)',
        },
        limit: { type: 'number' as const, description: 'Max results (default all)' },
      },
    },
  },
  {
    name: 'channel_mapping_detail',
    description: 'Get one channel mapping by SKU with all linked channels and quantities',
    input_schema: {
      type: 'object' as const,
      properties: {
        sku: { type: 'string' as const, description: 'SKU to look up' },
      },
      required: ['sku'],
    },
  },
  {
    name: 'channel_add',
    description: 'Link a platform listing to a SKU channel mapping (e.g., link an eBay listing to SKU-123)',
    input_schema: {
      type: 'object' as const,
      properties: {
        sku: { type: 'string' as const, description: 'SKU to link the listing to' },
        platform: {
          type: 'string' as const,
          description: 'Platform name: amazon, ebay, walmart, etc.',
        },
        listing_id: { type: 'string' as const, description: 'Platform-specific listing ID' },
        platform_sku: {
          type: 'string' as const,
          description: 'Platform-specific SKU/MSKU (optional)',
        },
      },
      required: ['sku', 'platform', 'listing_id'],
    },
  },
  {
    name: 'channel_remove',
    description: 'Unlink a platform listing from its channel mapping',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string' as const, description: 'Platform name' },
        listing_id: { type: 'string' as const, description: 'Platform listing ID to unlink' },
      },
      required: ['platform', 'listing_id'],
    },
  },
  {
    name: 'inventory_adjust',
    description: 'Manually adjust inventory quantity for a SKU (positive = add, negative = remove)',
    input_schema: {
      type: 'object' as const,
      properties: {
        sku: { type: 'string' as const, description: 'SKU to adjust' },
        quantity_change: {
          type: 'number' as const,
          description: 'Amount to adjust (positive to add, negative to remove)',
        },
        reason: {
          type: 'string' as const,
          description: 'Reason for adjustment (e.g., "Shrinkage", "Count correction")',
        },
        platform: {
          type: 'string' as const,
          description: 'Platform associated with this adjustment (optional)',
        },
      },
      required: ['sku', 'quantity_change', 'reason'],
    },
  },
  {
    name: 'inventory_sale',
    description: 'Record a sale for a SKU on a platform (decreases inventory)',
    input_schema: {
      type: 'object' as const,
      properties: {
        sku: { type: 'string' as const, description: 'SKU that was sold' },
        platform: { type: 'string' as const, description: 'Platform where the sale occurred' },
        quantity: {
          type: 'number' as const,
          description: 'Number of units sold (positive number)',
        },
      },
      required: ['sku', 'platform', 'quantity'],
    },
  },
  {
    name: 'inventory_restock',
    description: 'Record a restock for a SKU (increases inventory)',
    input_schema: {
      type: 'object' as const,
      properties: {
        sku: { type: 'string' as const, description: 'SKU being restocked' },
        quantity: {
          type: 'number' as const,
          description: 'Number of units received (positive number)',
        },
      },
      required: ['sku', 'quantity'],
    },
  },
  {
    name: 'sync_channels',
    description: 'Manually sync a SKU\'s inventory to all linked channels (distributes available stock evenly)',
    input_schema: {
      type: 'object' as const,
      properties: {
        sku: { type: 'string' as const, description: 'SKU to sync' },
      },
      required: ['sku'],
    },
  },
  {
    name: 'sync_daemon_start',
    description: 'Start the background inventory sync daemon (periodically syncs all enabled SKUs)',
    input_schema: {
      type: 'object' as const,
      properties: {
        interval_minutes: {
          type: 'number' as const,
          description: 'Sync interval in minutes (default 1)',
        },
        buffer_stock: {
          type: 'number' as const,
          description: 'Safety buffer: units to hold back from listings (default 0)',
        },
        oversell_protection: {
          type: 'boolean' as const,
          description: 'Prevent pushing inventory when available is 0 (default true)',
        },
        max_per_channel: {
          type: 'number' as const,
          description: 'Max quantity to list on any single channel (optional cap)',
        },
        platforms: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Only sync to these platforms (empty = all)',
        },
      },
    },
  },
  {
    name: 'sync_daemon_stop',
    description: 'Stop the running inventory sync daemon',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'sync_events',
    description: 'View the inventory sync event audit log (sales, restocks, pushes, errors)',
    input_schema: {
      type: 'object' as const,
      properties: {
        sku: { type: 'string' as const, description: 'Filter by SKU (optional)' },
        event_type: {
          type: 'string' as const,
          description: 'Filter by type: sale, restock, adjustment, sync_push, sync_pull, error',
        },
        days: {
          type: 'number' as const,
          description: 'Number of days of history (default 30)',
        },
        limit: { type: 'number' as const, description: 'Max results (default 200)' },
      },
    },
  },
  {
    name: 'sync_stats',
    description: 'Get aggregate inventory sync statistics (sales/day, syncs/day, oversell incidents)',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: {
          type: 'number' as const,
          description: 'Number of days to analyze (default 30)',
        },
      },
    },
  },
] as const;

// =============================================================================
// Default push function (dry-run / stub)
// =============================================================================

/**
 * Build a stub push function for manual sync triggers.
 * In production, this would be replaced with actual API calls to each platform.
 * The stub always returns true (simulates successful push).
 */
function buildStubPushFn(): PushFn {
  return (_platform: string, _listingId: string, _quantity: number): boolean => {
    // Stub: always succeeds. Replace with real platform API calls.
    return true;
  };
}

// =============================================================================
// Tool Input Type
// =============================================================================

export interface MultiChannelSyncToolInput {
  sku?: string;
  product_id?: string;
  total_quantity?: number;
  sync_enabled_only?: boolean;
  limit?: number;
  platform?: string;
  listing_id?: string;
  platform_sku?: string;
  quantity_change?: number;
  reason?: string;
  quantity?: number;
  interval_minutes?: number;
  buffer_stock?: number;
  oversell_protection?: boolean;
  max_per_channel?: number;
  platforms?: string[];
  event_type?: string;
  days?: number;
}

// =============================================================================
// Tool Handler
// =============================================================================

/**
 * Handle multi-channel sync tool calls from the agent.
 */
export function handleMultiChannelSyncTool(
  db: Database,
  toolName: string,
  input: MultiChannelSyncToolInput,
): { status: 'ok' | 'error'; data?: unknown; message?: string } {
  try {
    switch (toolName) {
      // ── Create Mapping ──────────────────────────────────────────────
      case 'channel_mapping_create': {
        if (!input.sku) {
          return { status: 'error', message: 'sku is required' };
        }
        const mapping = createChannelMapping(
          db,
          input.sku,
          input.product_id,
          input.total_quantity,
        );
        return { status: 'ok', data: mapping };
      }

      // ── List Mappings ───────────────────────────────────────────────
      case 'channel_mapping_list': {
        const mappings = getAllChannelMappings(db, {
          syncEnabledOnly: input.sync_enabled_only ?? false,
          limit: input.limit,
        });
        return {
          status: 'ok',
          data: {
            count: mappings.length,
            daemonRunning: isSyncDaemonRunning(),
            config: getDaemonConfig(db),
            mappings,
          },
        };
      }

      // ── Mapping Detail ──────────────────────────────────────────────
      case 'channel_mapping_detail': {
        if (!input.sku) {
          return { status: 'error', message: 'sku is required' };
        }
        const mapping = getChannelMapping(db, input.sku);
        if (!mapping) {
          return { status: 'error', message: `No mapping found for SKU: ${input.sku}` };
        }
        return { status: 'ok', data: mapping };
      }

      // ── Add Channel ─────────────────────────────────────────────────
      case 'channel_add': {
        if (!input.sku) return { status: 'error', message: 'sku is required' };
        if (!input.platform) return { status: 'error', message: 'platform is required' };
        if (!input.listing_id) return { status: 'error', message: 'listing_id is required' };

        const entry = addChannelEntry(
          db,
          input.sku,
          input.platform,
          input.listing_id,
          input.platform_sku,
        );
        return { status: 'ok', data: entry };
      }

      // ── Remove Channel ──────────────────────────────────────────────
      case 'channel_remove': {
        if (!input.platform) return { status: 'error', message: 'platform is required' };
        if (!input.listing_id) return { status: 'error', message: 'listing_id is required' };

        const removed = removeChannelEntry(db, input.platform, input.listing_id);
        if (!removed) {
          return {
            status: 'error',
            message: `Channel entry not found: ${input.platform}/${input.listing_id}`,
          };
        }
        return { status: 'ok', data: { removed: true, platform: input.platform, listingId: input.listing_id } };
      }

      // ── Inventory Adjust ────────────────────────────────────────────
      case 'inventory_adjust': {
        if (!input.sku) return { status: 'error', message: 'sku is required' };
        if (!Number.isFinite(input.quantity_change)) {
          return { status: 'error', message: 'quantity_change is required (number)' };
        }
        if (!input.reason) return { status: 'error', message: 'reason is required' };

        const mapping = updateInventory(
          db,
          input.sku,
          input.quantity_change!,
          input.reason,
          input.platform,
        );
        return { status: 'ok', data: mapping };
      }

      // ── Record Sale ─────────────────────────────────────────────────
      case 'inventory_sale': {
        if (!input.sku) return { status: 'error', message: 'sku is required' };
        if (!input.platform) return { status: 'error', message: 'platform is required' };
        if (!Number.isFinite(input.quantity) || input.quantity! <= 0) {
          return { status: 'error', message: 'quantity must be a positive number' };
        }

        const mapping = recordSale(db, input.sku, input.platform, input.quantity!);
        return { status: 'ok', data: mapping };
      }

      // ── Record Restock ──────────────────────────────────────────────
      case 'inventory_restock': {
        if (!input.sku) return { status: 'error', message: 'sku is required' };
        if (!Number.isFinite(input.quantity) || input.quantity! <= 0) {
          return { status: 'error', message: 'quantity must be a positive number' };
        }

        const mapping = recordRestock(db, input.sku, input.quantity!);
        return { status: 'ok', data: mapping };
      }

      // ── Manual Sync ─────────────────────────────────────────────────
      case 'sync_channels': {
        if (!input.sku) return { status: 'error', message: 'sku is required' };

        const pushFn = buildStubPushFn();
        const result = syncToChannels(db, input.sku, pushFn);
        return { status: 'ok', data: result };
      }

      // ── Start Daemon ────────────────────────────────────────────────
      case 'sync_daemon_start': {
        if (isSyncDaemonRunning()) {
          return { status: 'error', message: 'Sync daemon is already running' };
        }

        const daemonConfig: Record<string, unknown> = {};
        if (Number.isFinite(input.interval_minutes)) {
          daemonConfig.intervalMs = input.interval_minutes! * 60_000;
        }
        if (Number.isFinite(input.buffer_stock)) {
          daemonConfig.bufferStock = input.buffer_stock!;
        }
        if (typeof input.oversell_protection === 'boolean') {
          daemonConfig.oversellProtection = input.oversell_protection;
        }
        if (Number.isFinite(input.max_per_channel)) {
          daemonConfig.maxQuantityPerChannel = input.max_per_channel!;
        }
        if (Array.isArray(input.platforms)) {
          daemonConfig.platforms = input.platforms;
        }

        // Save config updates before starting
        if (Object.keys(daemonConfig).length > 0) {
          updateDaemonConfig(db, daemonConfig as Record<string, unknown>);
        }

        const pushFn = buildStubPushFn();
        startSyncDaemon(db, pushFn, daemonConfig);

        const config = getDaemonConfig(db);
        const mappings = getAllChannelMappings(db, { syncEnabledOnly: true });

        return {
          status: 'ok',
          data: {
            started: true,
            enabledMappings: mappings.length,
            config,
          },
        };
      }

      // ── Stop Daemon ─────────────────────────────────────────────────
      case 'sync_daemon_stop': {
        const stopped = stopSyncDaemon();
        return {
          status: 'ok',
          data: { stopped, wasRunning: stopped },
        };
      }

      // ── Sync Events ─────────────────────────────────────────────────
      case 'sync_events': {
        const VALID_EVENT_TYPES = new Set(['sale', 'restock', 'adjustment', 'sync_push', 'sync_pull', 'error']);
        if (input.event_type && !VALID_EVENT_TYPES.has(input.event_type as string)) {
          return { status: 'error' as const, message: `Invalid event_type. Valid: ${[...VALID_EVENT_TYPES].join(', ')}` };
        }

        const events = getSyncEvents(db, {
          sku: input.sku,
          eventType: input.event_type as SyncEventType | undefined,
          days: input.days,
          limit: input.limit,
        });
        return {
          status: 'ok',
          data: { count: events.length, events },
        };
      }

      // ── Sync Stats ──────────────────────────────────────────────────
      case 'sync_stats': {
        const stats = getSyncStats(db, input.days);
        const config = getDaemonConfig(db);
        return {
          status: 'ok',
          data: {
            daemonRunning: isSyncDaemonRunning(),
            config,
            stats,
          },
        };
      }

      default:
        return { status: 'error', message: `Unknown multi-channel sync tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 'error', message };
  }
}
