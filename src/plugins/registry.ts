/**
 * Plugin Registry - DB-backed plugin management
 *
 * Complements the in-memory PluginService with durable state stored in
 * the SQLite database. Plugins are registered, enabled/disabled, and
 * configured here; hooks are executed at defined extension points.
 */

import { randomUUID } from 'crypto';
import type { Database } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import type {
  PluginRecord,
  PluginDefinition,
  PluginHookName,
  PluginHookHandler,
  PluginHookContext,
} from './types.js';

const logger = createLogger('plugin-registry');

// In-memory hook registry (populated from DB + live registrations)
const hookHandlers = new Map<string, Map<PluginHookName, PluginHookHandler>>();

// =============================================================================
// PLUGIN CRUD
// =============================================================================

/**
 * Register a plugin with metadata. Stores in DB and registers hooks in memory.
 */
export function registerPlugin(
  db: Database,
  plugin: PluginDefinition,
): PluginRecord {
  if (!plugin.id || !plugin.name) {
    throw new Error('Plugin id and name are required');
  }

  // Check for duplicates
  const existing = db.query<{ id: string }>(
    'SELECT id FROM plugins WHERE id = ?',
    [plugin.id],
  );
  if (existing.length > 0) {
    throw new Error(`Plugin ${plugin.id} is already registered`);
  }

  const now = Date.now();

  // Serialize hook names (not functions) into DB
  const hookNames = Object.keys(plugin.hooks ?? {});

  const config = plugin.config ?? {};
  // Sanitize config
  const safeConfig: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
      safeConfig[k] = v;
    }
  }

  db.run(
    `INSERT INTO plugins (id, name, version, description, author, hooks, config, enabled, installed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      plugin.id,
      plugin.name,
      plugin.version ?? '1.0.0',
      plugin.description ?? null,
      plugin.author ?? null,
      JSON.stringify(hookNames),
      JSON.stringify(safeConfig),
      0,
      now,
      now,
    ],
  );

  // Register hooks in memory
  if (plugin.hooks) {
    const pluginHooks = new Map<PluginHookName, PluginHookHandler>();
    for (const [hookName, handler] of Object.entries(plugin.hooks)) {
      if (typeof handler === 'function') {
        pluginHooks.set(hookName as PluginHookName, handler);
      }
    }
    hookHandlers.set(plugin.id, pluginHooks);
  }

  logger.info({ pluginId: plugin.id, name: plugin.name }, 'Plugin registered');

  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version ?? '1.0.0',
    description: plugin.description ?? null,
    author: plugin.author ?? null,
    hooks: Object.fromEntries(hookNames.map((h) => [h, true])),
    config: safeConfig,
    enabled: false,
    installedAt: now,
    updatedAt: now,
  };
}

/**
 * Get a plugin's details by ID.
 */
export function getPlugin(
  db: Database,
  pluginId: string,
): PluginRecord | null {
  if (!pluginId) return null;

  const rows = db.query<Record<string, unknown>>(
    'SELECT id, name, version, description, author, hooks, config, enabled, installed_at, updated_at FROM plugins WHERE id = ?',
    [pluginId],
  );

  if (rows.length === 0) return null;
  return parsePluginRow(rows[0]);
}

/**
 * List installed plugins with optional filtering.
 */
export function listPlugins(
  db: Database,
  options: { enabledOnly?: boolean } = {},
): PluginRecord[] {
  let sql = 'SELECT id, name, version, description, author, hooks, config, enabled, installed_at, updated_at FROM plugins';
  const params: unknown[] = [];

  if (options.enabledOnly) {
    sql += ' WHERE enabled = 1';
  }

  sql += ' ORDER BY name ASC';

  const rows = db.query<Record<string, unknown>>(sql, params);
  return rows.map(parsePluginRow);
}

/**
 * Enable a plugin.
 */
export function enablePlugin(
  db: Database,
  pluginId: string,
): void {
  if (!pluginId) throw new Error('Plugin ID is required');

  const existing = db.query<{ id: string }>(
    'SELECT id FROM plugins WHERE id = ?',
    [pluginId],
  );
  if (existing.length === 0) {
    throw new Error(`Plugin ${pluginId} not found`);
  }

  db.run(
    'UPDATE plugins SET enabled = 1, updated_at = ? WHERE id = ?',
    [Date.now(), pluginId],
  );

  logger.info({ pluginId }, 'Plugin enabled');
}

/**
 * Disable a plugin.
 */
export function disablePlugin(
  db: Database,
  pluginId: string,
): void {
  if (!pluginId) throw new Error('Plugin ID is required');

  db.run(
    'UPDATE plugins SET enabled = 0, updated_at = ? WHERE id = ?',
    [Date.now(), pluginId],
  );

  logger.info({ pluginId }, 'Plugin disabled');
}

/**
 * Update plugin configuration.
 */
export function configurePlugin(
  db: Database,
  pluginId: string,
  config: Record<string, unknown>,
): void {
  if (!pluginId) throw new Error('Plugin ID is required');

  const existing = db.query<{ id: string }>(
    'SELECT id FROM plugins WHERE id = ?',
    [pluginId],
  );
  if (existing.length === 0) {
    throw new Error(`Plugin ${pluginId} not found`);
  }

  // Sanitize
  const safeConfig: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(config)) {
    if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
      safeConfig[k] = v;
    }
  }

  db.run(
    'UPDATE plugins SET config = ?, updated_at = ? WHERE id = ?',
    [JSON.stringify(safeConfig), Date.now(), pluginId],
  );

  logger.info({ pluginId }, 'Plugin configured');
}

/**
 * Uninstall a plugin (remove from DB and memory).
 */
export function uninstallPlugin(
  db: Database,
  pluginId: string,
): void {
  if (!pluginId) throw new Error('Plugin ID is required');

  db.run('DELETE FROM plugins WHERE id = ?', [pluginId]);
  hookHandlers.delete(pluginId);

  logger.info({ pluginId }, 'Plugin uninstalled');
}

// =============================================================================
// HOOK EXECUTION
// =============================================================================

/**
 * Execute all registered handlers for a given hook across enabled plugins.
 */
export function executePluginHook(
  db: Database,
  hookName: PluginHookName,
  context: Record<string, unknown>,
): Array<{ pluginId: string; result: unknown; error?: string }> {
  const enabledPlugins = listPlugins(db, { enabledOnly: true });
  const results: Array<{ pluginId: string; result: unknown; error?: string }> = [];

  for (const plugin of enabledPlugins) {
    const pluginHooks = hookHandlers.get(plugin.id);
    if (!pluginHooks) continue;

    const handler = pluginHooks.get(hookName);
    if (!handler) continue;

    try {
      const hookContext: PluginHookContext = {
        pluginId: plugin.id,
        pluginConfig: plugin.config,
        data: context,
      };

      const result = handler(hookContext);
      results.push({ pluginId: plugin.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ pluginId: plugin.id, hookName, error: message }, 'Plugin hook error');
      results.push({ pluginId: plugin.id, result: null, error: message });
    }
  }

  return results;
}

// =============================================================================
// HELPERS
// =============================================================================

function parsePluginRow(row: Record<string, unknown>): PluginRecord {
  let hooks: Record<string, unknown> = {};
  try {
    const raw = row.hooks;
    if (typeof raw === 'string') {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        hooks = Object.fromEntries(parsed.map((h: string) => [h, true]));
      } else {
        hooks = parsed;
      }
    }
  } catch {
    // ignore
  }

  let config: Record<string, unknown> = {};
  try {
    if (typeof row.config === 'string') {
      config = JSON.parse(row.config);
    }
  } catch {
    // ignore
  }

  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    version: String(row.version ?? '1.0.0'),
    description: row.description !== null && row.description !== undefined ? String(row.description) : null,
    author: row.author !== null && row.author !== undefined ? String(row.author) : null,
    hooks,
    config,
    enabled: Boolean(row.enabled),
    installedAt: Number(row.installed_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}
