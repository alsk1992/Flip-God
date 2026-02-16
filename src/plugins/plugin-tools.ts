/**
 * Plugin Tools Module - Tool definitions and handler for DB-backed plugin system
 *
 * NOTE: This is separate from the existing `index.ts` which contains the
 * in-memory PluginService. These tools operate on the DB-backed registry
 * and shared rule packs.
 *
 * Exports tool definitions and a handler function for wiring into the agent.
 */

import type { Database } from '../db/index.js';
import {
  listPlugins,
  enablePlugin,
  disablePlugin,
  configurePlugin,
  uninstallPlugin,
} from './registry.js';
import {
  exportRulePack,
  importRulePack,
  listSharedRulePacks,
} from './shared-rules.js';

// =============================================================================
// Re-exports
// =============================================================================

export {
  registerPlugin,
  getPlugin,
  listPlugins,
  enablePlugin,
  disablePlugin,
  configurePlugin,
  uninstallPlugin,
  executePluginHook,
} from './registry.js';

export {
  exportRulePack,
  importRulePack,
  listSharedRulePacks,
  getRulePack,
} from './shared-rules.js';

export type {
  PluginRecord,
  PluginHookName,
  PluginDefinition,
  PluginHookHandler,
  PluginHookContext,
  RepricingRule,
  RulePack,
  RulePackInput,
} from './types.js';

// =============================================================================
// Tool Definitions
// =============================================================================

export const pluginTools = [
  {
    name: 'list_plugins',
    description: 'List installed plugins and extensions',
    input_schema: {
      type: 'object' as const,
      properties: {
        enabled_only: {
          type: 'boolean' as const,
          description: 'Only show enabled plugins (default: false)',
        },
      },
    },
  },
  {
    name: 'manage_plugin',
    description: 'Enable, disable, configure, or uninstall a plugin',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string' as const,
          enum: ['enable', 'disable', 'configure', 'uninstall'],
          description: 'Action to perform',
        },
        plugin_id: {
          type: 'string' as const,
          description: 'Plugin ID',
        },
        config: {
          type: 'object' as const,
          description: 'Plugin configuration (for configure action)',
        },
      },
      required: ['action', 'plugin_id'] as const,
    },
  },
  {
    name: 'export_rule_pack',
    description: 'Export repricing rules as a shareable pack',
    input_schema: {
      type: 'object' as const,
      properties: {
        rule_ids: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'IDs of repricing rules to include',
        },
        pack_name: {
          type: 'string' as const,
          description: 'Name for the rule pack',
        },
        description: {
          type: 'string' as const,
          description: 'Description of the rule pack',
        },
      },
      required: ['rule_ids', 'pack_name'] as const,
    },
  },
  {
    name: 'import_rule_pack',
    description: 'Import a shared repricing rule pack',
    input_schema: {
      type: 'object' as const,
      properties: {
        pack_data: {
          type: 'string' as const,
          description: 'JSON string of the rule pack',
        },
      },
      required: ['pack_data'] as const,
    },
  },
];

// =============================================================================
// Tool Handler
// =============================================================================

export interface PluginToolInput {
  // list_plugins
  enabled_only?: boolean;
  // manage_plugin
  action?: string;
  plugin_id?: string;
  config?: Record<string, unknown>;
  // export_rule_pack
  rule_ids?: string[];
  pack_name?: string;
  description?: string;
  // import_rule_pack
  pack_data?: string;
}

/**
 * Handle plugin tool calls.
 */
export function handlePluginTool(
  db: Database,
  toolName: string,
  input: PluginToolInput,
  context: { userId: string },
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'list_plugins': {
        const plugins = listPlugins(db, {
          enabledOnly: input.enabled_only ?? false,
        });

        return {
          success: true,
          data: {
            plugins: plugins.map((p) => ({
              id: p.id,
              name: p.name,
              version: p.version,
              description: p.description,
              author: p.author,
              enabled: p.enabled,
              hooks: Object.keys(p.hooks),
              installedAt: new Date(p.installedAt).toISOString(),
            })),
            count: plugins.length,
          },
        };
      }

      case 'manage_plugin': {
        const pluginId = input.plugin_id;
        if (!pluginId) {
          return { success: false, error: 'plugin_id is required' };
        }

        switch (input.action) {
          case 'enable': {
            enablePlugin(db, pluginId);
            return {
              success: true,
              data: { pluginId, status: 'enabled' },
            };
          }

          case 'disable': {
            disablePlugin(db, pluginId);
            return {
              success: true,
              data: { pluginId, status: 'disabled' },
            };
          }

          case 'configure': {
            if (!input.config || typeof input.config !== 'object') {
              return { success: false, error: 'config object is required for configure action' };
            }
            configurePlugin(db, pluginId, input.config);
            return {
              success: true,
              data: { pluginId, configUpdated: true },
            };
          }

          case 'uninstall': {
            uninstallPlugin(db, pluginId);
            return {
              success: true,
              data: { pluginId, status: 'uninstalled' },
            };
          }

          default:
            return {
              success: false,
              error: `Unknown action: ${input.action}. Must be enable, disable, configure, or uninstall.`,
            };
        }
      }

      case 'export_rule_pack': {
        if (!input.rule_ids || input.rule_ids.length === 0) {
          return { success: false, error: 'rule_ids array is required' };
        }
        if (!input.pack_name?.trim()) {
          return { success: false, error: 'pack_name is required' };
        }

        const pack = exportRulePack(db, input.rule_ids, {
          name: input.pack_name,
          description: input.description,
          author: context.userId,
        });

        return {
          success: true,
          data: {
            packId: pack.id,
            name: pack.name,
            ruleCount: pack.rules.length,
            json: JSON.stringify(pack, null, 2),
          },
        };
      }

      case 'import_rule_pack': {
        if (!input.pack_data) {
          return { success: false, error: 'pack_data JSON string is required' };
        }

        const result = importRulePack(db, input.pack_data, context.userId);
        return {
          success: true,
          data: {
            imported: result.imported,
            skipped: result.skipped,
            errors: result.errors.length > 0 ? result.errors : undefined,
          },
        };
      }

      default:
        return { success: false, error: `Unknown plugin tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
