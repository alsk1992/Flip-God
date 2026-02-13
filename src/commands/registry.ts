/**
 * Slash Command Registry - shared command registration and handling
 *
 * Provides a single source of truth for commands across channels and
 * supports platform-level registration (e.g., Telegram setMyCommands).
 *
 * FlipAgent commands: /scan, /compare, /list, /orders, /track, /profit,
 * /help, /settings, /credentials, /status, /new, /reset, /model
 */

import type { IncomingMessage, OutgoingMessage, Platform, Session } from '../types';
import type { SessionManager } from '../sessions/index';
import type { Database } from '../db/index';
import { createLogger } from '../utils/logger';

const logger = createLogger('commands');

// =============================================================================
// Types
// =============================================================================

export interface CommandContext {
  session: Session;
  message: IncomingMessage;
  sessions: SessionManager;
  db: Database;
  commands: CommandRegistry;
  send: (message: OutgoingMessage) => Promise<string | null>;
}

export interface CommandDefinition {
  /** Command name without leading slash, e.g. "help" */
  name: string;
  /** Short human-readable description */
  description: string;
  /** Usage string including slash */
  usage: string;
  /** Optional aliases without leading slash */
  aliases?: string[];
  /** Whether this should be registered with platform UIs */
  register?: boolean;
  /** Handle a command invocation */
  handler: (args: string, ctx: CommandContext) => Promise<string> | string;
}

export interface CommandInfo {
  name: string;
  description: string;
  usage: string;
  register: boolean;
}

export interface CommandListEntry {
  name: string;
  description: string;
  category: string;
  subcommands?: Array<{ name: string; description: string; category: string }>;
}

// =============================================================================
// Category mapping
// =============================================================================

export const COMMAND_CATEGORIES: Record<string, string | string[]> = {
  // Core
  help: 'Core',
  new: 'Core',
  reset: 'Core',
  status: 'Core',
  model: 'Core',

  // Scanning & Research
  scan: 'Research',
  compare: 'Research',
  search: 'Research',

  // Listings & Inventory
  list: 'Inventory',
  listings: 'Inventory',
  track: 'Inventory',

  // Orders & Profit
  orders: 'Orders',
  profit: 'Orders',

  // Configuration
  settings: 'Config',
  credentials: 'Config',
};

// =============================================================================
// Command Registry
// =============================================================================

export interface CommandRegistry {
  register(command: CommandDefinition): void;
  registerMany(commands: CommandDefinition[]): void;
  list(): CommandInfo[];
  /** Return all commands with category labels for UI display */
  listAll(): CommandListEntry[];
  /**
   * Handle a command message. Returns null when not handled.
   */
  handle(
    message: IncomingMessage,
    ctx: Omit<CommandContext, 'message' | 'commands'>,
  ): Promise<string | null>;
}

export function createCommandRegistry(): CommandRegistry {
  const commands = new Map<string, CommandDefinition>();
  const aliasToName = new Map<string, string>();

  function register(command: CommandDefinition): void {
    commands.set(command.name, command);

    if (command.aliases) {
      for (const alias of command.aliases) {
        aliasToName.set(alias, command.name);
      }
    }
  }

  function registerMany(defs: CommandDefinition[]): void {
    for (const def of defs) register(def);
  }

  function list(): CommandInfo[] {
    return Array.from(commands.values())
      .map((c) => ({
        name: `/${c.name}`,
        description: c.description,
        usage: c.usage,
        register: c.register !== false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function listAll(): CommandListEntry[] {
    const entries: CommandListEntry[] = [];
    for (const c of commands.values()) {
      const cats = COMMAND_CATEGORIES[c.name] || 'Other';
      const catList = Array.isArray(cats) ? cats : [cats];
      for (const category of catList) {
        entries.push({ name: `/${c.name}`, description: c.description, category });
      }
    }
    return entries.sort(
      (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
    );
  }

  async function handle(
    message: IncomingMessage,
    ctx: Omit<CommandContext, 'message' | 'commands'>,
  ): Promise<string | null> {
    const text = message.text.trim();
    if (!text.startsWith('/')) return null;

    const spaceIdx = text.indexOf(' ');
    const rawName = (spaceIdx > 0 ? text.slice(1, spaceIdx) : text.slice(1)).toLowerCase();
    const args = spaceIdx > 0 ? text.slice(spaceIdx + 1).trim() : '';

    const resolvedName = commands.has(rawName) ? rawName : aliasToName.get(rawName);
    if (!resolvedName) return null;

    const command = commands.get(resolvedName);
    if (!command) return null;

    try {
      const response = await command.handler(args, {
        ...ctx,
        commands: registry,
        message,
      });
      logger.info({ command: command.name, userId: message.userId }, 'Command handled');
      return response;
    } catch (error) {
      logger.error({ error, command: command.name }, 'Command handler failed');
      return `Error running /${command.name}: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  const registry: CommandRegistry = {
    register,
    registerMany,
    list,
    listAll,
    handle,
  };

  return registry;
}

// =============================================================================
// Default FlipAgent Commands
// =============================================================================

/** Available models with shortcuts */
const MODEL_ALIASES: Record<string, string> = {
  opus: 'claude-opus-4-6',
  'opus4.6': 'claude-opus-4-6',
  'opus4.5': 'claude-opus-4-5-20250514',
  sonnet: 'claude-sonnet-4-5-20250929',
  'sonnet4.5': 'claude-sonnet-4-5-20250929',
  haiku: 'claude-haiku-4-5-20251001',
  'haiku4.5': 'claude-haiku-4-5-20251001',
  'claude-opus-4': 'claude-opus-4-6',
  'claude-sonnet-4': 'claude-sonnet-4-5-20250929',
  'claude-haiku-4': 'claude-haiku-4-5-20251001',
};

export function createDefaultCommands(): CommandDefinition[] {
  return [
    // ── Core ─────────────────────────────────────────────────────────────────

    {
      name: 'help',
      description: 'Show available commands',
      usage: '/help',
      handler: (_args, ctx) => {
        const lines = ['FlipAgent Commands', ''];
        const allCommands = ctx.commands.listAll();

        // Group by category
        const groups = new Map<string, CommandListEntry[]>();
        for (const entry of allCommands) {
          const list = groups.get(entry.category) || [];
          list.push(entry);
          groups.set(entry.category, list);
        }

        for (const [category, cmds] of groups) {
          lines.push(`--- ${category} ---`);
          for (const cmd of cmds) {
            lines.push(`  ${cmd.name} - ${cmd.description}`);
          }
          lines.push('');
        }

        lines.push('Tip: just chat naturally for most things.');
        lines.push('Ask to scan for deals, compare prices, or track orders.');
        return lines.join('\n');
      },
    },

    {
      name: 'new',
      description: 'Start a fresh conversation',
      usage: '/new',
      aliases: ['reset'],
      handler: (_args, ctx) => {
        ctx.sessions.clearHistory(ctx.session);
        logger.info({ sessionKey: ctx.session.key }, 'Session reset via command');
        return 'Session reset. Starting fresh! How can I help you find deals?';
      },
    },

    {
      name: 'status',
      description: 'Show session status and context usage',
      usage: '/status',
      handler: (_args, ctx) => {
        const history = ctx.session.context.conversationHistory || [];
        const messageCount = history.length;
        const totalChars = history.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
        const estimatedTokens = Math.max(0, Math.round(totalChars / 4));
        const uptime = Math.round(
          (Date.now() - ctx.session.createdAt.getTime()) / 1000 / 60,
        );

        return [
          'Session Status',
          '',
          `Session: ${ctx.session.id.slice(0, 8)}...`,
          `Platform: ${ctx.session.platform}`,
          `Messages: ${messageCount}`,
          `Est. Tokens: ~${estimatedTokens.toLocaleString()}`,
          `Uptime: ${uptime} minutes`,
          `Created: ${ctx.session.createdAt.toISOString().slice(0, 16).replace('T', ' ')}`,
          '',
          'Use /new to reset the conversation.',
        ].join('\n');
      },
    },

    {
      name: 'model',
      description: 'Show or change AI model',
      usage: '/model [sonnet|opus|haiku]',
      handler: (args, ctx) => {
        const defaultModel = process.env.ANTHROPIC_MODEL || 'claude-opus-4-6';
        const currentModel = (ctx.session.context as unknown as Record<string, unknown>).modelOverride as string | undefined || defaultModel;

        if (!args.trim()) {
          const modelList = Object.keys(MODEL_ALIASES)
            .filter((k) => !k.includes('-'))
            .map((k) => k)
            .join(', ');

          return [
            'Current Model',
            '',
            `  ${currentModel}`,
            (ctx.session.context as unknown as Record<string, unknown>).modelOverride
              ? '  (session override)'
              : '  (default)',
            '',
            `Available: ${modelList}`,
            'Usage: /model sonnet',
          ].join('\n');
        }

        const requestedModel = args.trim().toLowerCase();
        const resolvedModel = MODEL_ALIASES[requestedModel] || requestedModel;

        if (!resolvedModel.startsWith('claude-')) {
          return `Unknown model: ${requestedModel}\nAvailable: sonnet, opus, haiku`;
        }

        (ctx.session.context as unknown as Record<string, unknown>).modelOverride = resolvedModel;
        ctx.sessions.updateSession(ctx.session);
        logger.info({ sessionKey: ctx.session.key, model: resolvedModel }, 'Model changed');

        return `Model changed to: ${resolvedModel}`;
      },
    },

    // ── Research ──────────────────────────────────────────────────────────────

    {
      name: 'scan',
      description: 'Scan for arbitrage opportunities across platforms',
      usage: '/scan [category] [minMargin=15]',
      handler: (args, ctx) => {
        const trimmed = args.trim();

        // Parse optional parameters
        let category = '';
        let minMargin = 15;
        const tokens = trimmed.split(/\s+/).filter(Boolean);

        for (const token of tokens) {
          const lower = token.toLowerCase();
          if (lower.startsWith('minmargin=') || lower.startsWith('min=')) {
            const val = Number.parseFloat(lower.split('=')[1]);
            if (Number.isFinite(val) && val > 0) {
              minMargin = val;
            }
            continue;
          }
          category += (category ? ' ' : '') + token;
        }

        // Query active opportunities from DB
        const opportunities = ctx.db.getActiveOpportunities(20);

        if (opportunities.length === 0) {
          return [
            'Scan Results',
            '',
            'No active opportunities found.',
            category ? `Category filter: ${category}` : '',
            `Min margin: ${minMargin}%`,
            '',
            'Try broadening your search or check back later.',
          ]
            .filter(Boolean)
            .join('\n');
        }

        const filtered = opportunities.filter((o) => o.marginPct >= minMargin);

        const lines = [
          `Scan Results (${filtered.length} opportunities)`,
          '',
        ];

        for (const opp of filtered.slice(0, 10)) {
          lines.push(
            `  ${opp.buyPlatform} -> ${opp.sellPlatform} | ` +
              `Buy: $${opp.buyPrice.toFixed(2)} | Sell: $${opp.sellPrice.toFixed(2)} | ` +
              `Profit: $${opp.estimatedProfit.toFixed(2)} (${opp.marginPct.toFixed(1)}%)`,
          );
        }

        if (filtered.length > 10) {
          lines.push(`  ...and ${filtered.length - 10} more`);
        }

        return lines.join('\n');
      },
    },

    {
      name: 'compare',
      description: 'Compare prices for a product across platforms',
      usage: '/compare <product name or UPC>',
      handler: (args, ctx) => {
        const query = args.trim();
        if (!query) {
          return 'Usage: /compare <product name or UPC>\nExample: /compare Bose QC45';
        }

        // Try UPC lookup first
        const isUpc = /^\d{8,14}$/.test(query);
        let product;
        if (isUpc) {
          product = ctx.db.findProductByUPC(query);
        }

        if (!product) {
          return [
            `No product found for: ${query}`,
            '',
            'Try searching with a different term, or use /scan to find opportunities.',
          ].join('\n');
        }

        const prices = ctx.db.getLatestPrices(product.id);

        if (prices.length === 0) {
          return [
            `Product: ${product.title}`,
            '',
            'No price data available. Prices will be fetched on next scan.',
          ].join('\n');
        }

        const lines = [
          `${product.title}`,
          product.brand ? `Brand: ${product.brand}` : '',
          product.upc ? `UPC: ${product.upc}` : '',
          product.asin ? `ASIN: ${product.asin}` : '',
          '',
          'Prices:',
        ].filter(Boolean);

        for (const p of prices) {
          const shipping = p.shipping > 0 ? ` + $${p.shipping.toFixed(2)} shipping` : ' (free ship)';
          const stock = p.inStock ? '' : ' [OUT OF STOCK]';
          lines.push(`  ${p.platform}: $${p.price.toFixed(2)}${shipping}${stock}`);
        }

        if (prices.length >= 2) {
          const lowest = prices[0];
          const highest = prices[prices.length - 1];
          const spread = highest.price - lowest.price;
          if (spread > 0) {
            lines.push('');
            lines.push(
              `Spread: $${spread.toFixed(2)} (${lowest.platform} -> ${highest.platform})`,
            );
          }
        }

        return lines.join('\n');
      },
    },

    // ── Inventory ────────────────────────────────────────────────────────────

    {
      name: 'list',
      description: 'Show active listings',
      usage: '/list',
      aliases: ['listings'],
      handler: (_args, ctx) => {
        const listings = ctx.db.getActiveListings();

        if (listings.length === 0) {
          return 'No active listings. Use /scan to find opportunities.';
        }

        const lines = [`Active Listings (${listings.length})`, ''];

        for (const l of listings.slice(0, 20)) {
          lines.push(
            `  [${l.platform}] ${l.title || l.id.slice(0, 8)} | ` +
              `Price: $${l.price.toFixed(2)} | Source: ${l.sourcePlatform} @ $${l.sourcePrice.toFixed(2)}`,
          );
        }

        if (listings.length > 20) {
          lines.push(`  ...and ${listings.length - 20} more`);
        }

        return lines.join('\n');
      },
    },

    {
      name: 'track',
      description: 'Track price changes for a product',
      usage: '/track <product id or UPC>',
      handler: (args, ctx) => {
        const query = args.trim();
        if (!query) {
          return 'Usage: /track <product id or UPC>';
        }

        // Try to find the product
        let product = ctx.db.getProduct(query);
        if (!product) {
          const isUpc = /^\d{8,14}$/.test(query);
          if (isUpc) {
            product = ctx.db.findProductByUPC(query);
          }
        }

        if (!product) {
          return `Product not found: ${query}`;
        }

        const history = ctx.db.getPriceHistory(product.id);

        if (history.length === 0) {
          return `${product.title}\n\nNo price history available yet.`;
        }

        const lines = [`Price History: ${product.title}`, ''];

        // Group by platform
        const byPlatform = new Map<string, typeof history>();
        for (const p of history) {
          const list = byPlatform.get(p.platform) || [];
          list.push(p);
          byPlatform.set(p.platform, list);
        }

        for (const [platform, prices] of byPlatform) {
          const latest = prices[0];
          const oldest = prices[prices.length - 1];
          const change = latest.price - oldest.price;
          const changePct = oldest.price > 0 ? (change / oldest.price) * 100 : 0;
          const arrow = change > 0 ? '+' : change < 0 ? '' : '=';

          lines.push(
            `  ${platform}: $${latest.price.toFixed(2)} (${arrow}${changePct.toFixed(1)}% over ${prices.length} snapshots)`,
          );
        }

        return lines.join('\n');
      },
    },

    // ── Orders ───────────────────────────────────────────────────────────────

    {
      name: 'orders',
      description: 'Show recent orders',
      usage: '/orders [status]',
      handler: (args, ctx) => {
        const statusFilter = args.trim().toLowerCase() || undefined;

        // Query orders via raw SQL since we don't have a filtered method
        let sql = 'SELECT * FROM orders ORDER BY ordered_at DESC LIMIT 20';
        const params: unknown[] = [];
        if (statusFilter) {
          sql = 'SELECT * FROM orders WHERE status = ? ORDER BY ordered_at DESC LIMIT 20';
          params.push(statusFilter);
        }

        const rows = ctx.db.query<Record<string, unknown>>(sql, params);

        if (rows.length === 0) {
          return statusFilter
            ? `No orders with status: ${statusFilter}`
            : 'No orders yet. Opportunities turn into orders when you act on them.';
        }

        const lines = [`Orders (${rows.length})`, ''];

        for (const row of rows) {
          const profit =
            row.profit != null ? ` | Profit: $${(row.profit as number).toFixed(2)}` : '';
          const tracking = row.tracking_number ? ` | Track: ${row.tracking_number}` : '';
          lines.push(
            `  [${row.status}] ${(row.sell_platform as string)} -> ${(row.buy_platform as string)} | ` +
              `Sell: $${(row.sell_price as number).toFixed(2)}${profit}${tracking}`,
          );
        }

        return lines.join('\n');
      },
    },

    {
      name: 'profit',
      description: 'Show profit summary',
      usage: '/profit [7d|30d|all]',
      handler: (args, ctx) => {
        const period = args.trim().toLowerCase() || '30d';

        let sinceMs: number | undefined;
        const now = Date.now();
        if (period === '7d') {
          sinceMs = now - 7 * 24 * 60 * 60 * 1000;
        } else if (period === '30d') {
          sinceMs = now - 30 * 24 * 60 * 60 * 1000;
        } else if (period === '90d') {
          sinceMs = now - 90 * 24 * 60 * 60 * 1000;
        }
        // 'all' -> no filter

        let sql: string;
        const params: unknown[] = [];
        if (sinceMs) {
          sql =
            'SELECT profit, sell_price, buy_price, platform_fees, shipping_cost, status FROM orders WHERE ordered_at >= ? AND status IN (?, ?)';
          params.push(sinceMs, 'delivered', 'shipped');
        } else {
          sql =
            'SELECT profit, sell_price, buy_price, platform_fees, shipping_cost, status FROM orders WHERE status IN (?, ?)';
          params.push('delivered', 'shipped');
        }

        const rows = ctx.db.query<{
          profit: number | null;
          sell_price: number;
          buy_price: number | null;
          platform_fees: number | null;
          shipping_cost: number | null;
          status: string;
        }>(sql, params);

        if (rows.length === 0) {
          return `No completed orders in the ${period} period.`;
        }

        let totalProfit = 0;
        let totalRevenue = 0;
        let totalCost = 0;
        let totalFees = 0;
        let totalShipping = 0;

        for (const row of rows) {
          totalProfit += row.profit ?? 0;
          totalRevenue += row.sell_price;
          totalCost += row.buy_price ?? 0;
          totalFees += row.platform_fees ?? 0;
          totalShipping += row.shipping_cost ?? 0;
        }

        const marginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

        return [
          `Profit Summary (${period})`,
          '',
          `  Orders: ${rows.length}`,
          `  Revenue: $${totalRevenue.toFixed(2)}`,
          `  Cost: $${totalCost.toFixed(2)}`,
          `  Fees: $${totalFees.toFixed(2)}`,
          `  Shipping: $${totalShipping.toFixed(2)}`,
          `  Net Profit: $${totalProfit.toFixed(2)} (${marginPct.toFixed(1)}% margin)`,
        ].join('\n');
      },
    },

    // ── Config ───────────────────────────────────────────────────────────────

    {
      name: 'settings',
      description: 'Show or update settings',
      usage: '/settings [show]',
      handler: (_args, ctx) => {
        return [
          'FlipAgent Settings',
          '',
          `  Session: ${ctx.session.id.slice(0, 8)}`,
          `  Platform: ${ctx.session.platform}`,
          `  Chat Type: ${ctx.session.chatType}`,
          '',
          'Platform credentials: use /credentials to manage API keys.',
          'Arbitrage settings: configure in ~/.flipagent/flipagent.json',
        ].join('\n');
      },
    },

    {
      name: 'credentials',
      description: 'Manage platform API credentials',
      usage: '/credentials [list|set|remove] [platform]',
      handler: (args, ctx) => {
        const tokens = args.trim().split(/\s+/).filter(Boolean);
        const action = tokens[0]?.toLowerCase() || 'list';
        const platform = tokens[1]?.toLowerCase() as Platform | undefined;

        if (action === 'list') {
          const platforms: Platform[] = ['amazon', 'ebay', 'walmart', 'aliexpress'];
          const lines = ['Platform Credentials', ''];

          for (const p of platforms) {
            const creds = ctx.db.getTradingCredentials(ctx.message.userId, p);
            const status = creds
              ? creds.enabled
                ? 'configured'
                : 'disabled'
              : 'not set';
            lines.push(`  ${p}: ${status}`);
          }

          lines.push('');
          lines.push('Use /credentials set <platform> to configure.');
          lines.push('Use /credentials remove <platform> to remove.');
          return lines.join('\n');
        }

        if (action === 'remove' && platform) {
          ctx.db.deleteTradingCredentials(ctx.message.userId, platform);
          return `Removed credentials for ${platform}.`;
        }

        if (action === 'set' && platform) {
          return [
            `To set ${platform} credentials, send them in a DM:`,
            '',
            'For security, credentials are encrypted at rest.',
            'Never share API keys in group chats.',
          ].join('\n');
        }

        return 'Usage: /credentials [list|set|remove] [platform]';
      },
    },
  ];
}
