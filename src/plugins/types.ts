/**
 * Plugin Registry Types - DB-backed plugin management
 */

// =============================================================================
// PLUGIN ENTITY
// =============================================================================

export interface PluginRecord {
  id: string;
  name: string;
  version: string;
  description: string | null;
  author: string | null;
  hooks: Record<string, unknown>;
  config: Record<string, unknown>;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
}

export type PluginHookName =
  | 'before_list'
  | 'after_sale'
  | 'before_reprice'
  | 'on_new_order'
  | 'on_return'
  | 'daily_summary';

export interface PluginDefinition {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  hooks: Partial<Record<PluginHookName, PluginHookHandler>>;
  config?: Record<string, unknown>;
}

export type PluginHookHandler = (context: PluginHookContext) => unknown;

export interface PluginHookContext {
  pluginId: string;
  pluginConfig: Record<string, unknown>;
  data: Record<string, unknown>;
}

// =============================================================================
// SHARED RULE PACKS
// =============================================================================

export interface RepricingRule {
  id: string;
  listingId: string;
  strategy: string;
  params: Record<string, unknown>;
  minPrice: number;
  maxPrice: number;
}

export interface RulePack {
  id: string;
  name: string;
  description: string | null;
  version: string;
  author: string | null;
  rules: RepricingRule[];
  createdAt: number;
}

export interface RulePackInput {
  name: string;
  description?: string;
  version?: string;
  author?: string;
  rules: RepricingRule[];
}
