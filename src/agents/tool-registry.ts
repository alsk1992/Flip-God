/**
 * Tool Registry - Dynamic tool management for cost-optimized tool loading.
 *
 * Instead of sending all tools on every API call,
 * the registry enables sending only core tools + a `tool_search` meta-tool.
 * When the LLM needs specialized tools, it calls `tool_search` to discover them.
 *
 * Expected savings: ~80% reduction in tool token costs per message.
 */

export interface ToolMetadata {
  platform?: string;
  /** Primary category (first/best match). Use `categories` for multi-category tools. */
  category?: string;
  /** All matching categories for this tool (supports intersection queries). */
  categories?: string[];
  tags?: string[];
  core?: boolean;
}

/** Minimal shape required by the registry -- compatible with any ToolDefinition */
export interface RegistryTool {
  name: string;
  description: string;
  input_schema: unknown;
  metadata?: ToolMetadata;
}

export interface SearchQuery {
  platform?: string;
  category?: string;
  query?: string;
}

export class ToolRegistry<T extends RegistryTool = RegistryTool> {
  private tools: Map<string, T> = new Map();
  private byPlatform: Map<string, Set<string>> = new Map();
  private byCategory: Map<string, Set<string>> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();

  register(tool: T): void {
    this.tools.set(tool.name, tool);

    const meta = tool.metadata;
    if (meta?.platform) {
      let set = this.byPlatform.get(meta.platform);
      if (!set) {
        set = new Set();
        this.byPlatform.set(meta.platform, set);
      }
      set.add(tool.name);
    }

    // Index by ALL categories (multi-category support)
    const cats = meta?.categories ?? (meta?.category ? [meta.category] : []);
    for (const cat of cats) {
      let set = this.byCategory.get(cat);
      if (!set) {
        set = new Set();
        this.byCategory.set(cat, set);
      }
      set.add(tool.name);
    }

    if (meta?.tags) {
      for (const tag of meta.tags) {
        const lower = tag.toLowerCase();
        let set = this.tagIndex.get(lower);
        if (!set) {
          set = new Set();
          this.tagIndex.set(lower, set);
        }
        set.add(tool.name);
      }
    }
  }

  registerAll(tools: T[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  get(name: string): T | undefined {
    return this.tools.get(name);
  }

  size(): number {
    return this.tools.size;
  }

  searchByPlatform(platform: string): T[] {
    const names = this.byPlatform.get(platform.toLowerCase());
    if (!names) return [];
    return Array.from(names)
      .map(n => this.tools.get(n)!)
      .filter(Boolean);
  }

  searchByCategory(category: string): T[] {
    const names = this.byCategory.get(category.toLowerCase());
    if (!names) return [];
    return Array.from(names)
      .map(n => this.tools.get(n)!)
      .filter(Boolean);
  }

  /**
   * Search tools by platform AND category intersection.
   * Returns only tools that match BOTH criteria.
   */
  searchByPlatformAndCategory(platform: string, category: string): T[] {
    const platformTools = this.byPlatform.get(platform.toLowerCase());
    const categoryTools = this.byCategory.get(category.toLowerCase());

    if (!platformTools || !categoryTools) return [];

    const result: T[] = [];
    for (const name of platformTools) {
      if (categoryTools.has(name)) {
        const tool = this.tools.get(name);
        if (tool) result.push(tool);
      }
    }
    return result;
  }

  searchByText(query: string): T[] {
    const lower = query.toLowerCase();
    const terms = lower.split(/\s+/).filter(Boolean);
    const scored = new Map<string, number>();

    // Score by tag matches
    for (const term of terms) {
      const tagHits = this.tagIndex.get(term);
      if (tagHits) {
        for (const name of tagHits) {
          scored.set(name, (scored.get(name) ?? 0) + 3);
        }
      }
    }

    // Score by name/description substring matches
    for (const [name, tool] of this.tools) {
      let score = scored.get(name) ?? 0;
      const nameLower = name.toLowerCase();
      const descLower = tool.description.toLowerCase();

      for (const term of terms) {
        if (nameLower.includes(term)) score += 2;
        if (descLower.includes(term)) score += 1;
      }

      // Platform match via metadata
      const meta = tool.metadata;
      if (meta?.platform) {
        for (const term of terms) {
          if (meta.platform.includes(term)) score += 2;
        }
      }

      if (score > 0) {
        scored.set(name, score);
      }
    }

    return Array.from(scored.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => this.tools.get(name)!)
      .filter(Boolean);
  }

  search(q: SearchQuery): T[] {
    // When both platform and category provided, use intersection
    if (q.platform && q.category) return this.searchByPlatformAndCategory(q.platform, q.category);
    if (q.platform) return this.searchByPlatform(q.platform);
    if (q.category) return this.searchByCategory(q.category);
    if (q.query) return this.searchByText(q.query);
    return [];
  }

  getCoreTools(): T[] {
    return Array.from(this.tools.values()).filter(t => t.metadata?.core === true);
  }

  getAvailablePlatforms(): string[] {
    return Array.from(this.byPlatform.keys());
  }

  getAvailableCategories(): string[] {
    return Array.from(this.byCategory.keys());
  }
}

/**
 * Infer metadata from tool name using prefix conventions.
 * Falls back to reasonable defaults when metadata isn't explicitly set.
 * Assigns MULTIPLE categories when a tool matches more than one.
 */
export function inferToolMetadata(toolName: string, description: string): ToolMetadata {
  const meta: ToolMetadata = {};

  // Platform inference from prefix (longest prefixes first to match correctly)
  const platformPrefixes: [string, string][] = [
    ['amazon_', 'amazon'],
    ['ebay_', 'ebay'],
    ['walmart_', 'walmart'],
    ['aliexpress_', 'aliexpress'],
  ];

  for (const [prefix, platform] of platformPrefixes) {
    if (toolName.startsWith(prefix)) {
      meta.platform = platform;
      break;
    }
  }

  // Exact name matches for tools without prefix convention
  const exactMatches: Record<string, string> = {
    scan_amazon: 'amazon',
    scan_ebay: 'ebay',
    scan_walmart: 'walmart',
    scan_aliexpress: 'aliexpress',
    create_ebay_listing: 'ebay',
    create_amazon_listing: 'amazon',
    setup_amazon_credentials: 'amazon',
    setup_ebay_credentials: 'ebay',
    setup_walmart_credentials: 'walmart',
    setup_aliexpress_credentials: 'aliexpress',
  };
  if (!meta.platform && exactMatches[toolName]) {
    meta.platform = exactMatches[toolName];
  }

  // Multi-category inference: collect ALL matching categories
  // Order matters for primary category (first match = meta.category)
  const combined = (toolName + ' ' + description).toLowerCase();
  const categories: string[] = [];

  const CATEGORY_REGEXES: [RegExp, string][] = [
    [/\b(scan|search|find|compare|match|discover|browse)\b/, 'scanning'],
    [/\b(list|create_listing|optimize|publish|bulk)\b/, 'listing'],
    [/\b(order|purchase|ship|track|fulfill|return)\b/, 'fulfillment'],
    [/\b(report|dashboard|profit|analysis|revenue|margin)\b/, 'analytics'],
    [/\b(prices?|reprice|fee|cost|calculate)\b/, 'pricing'],
    [/\b(credentials?|api[\s._-]?key|config(?:ure)?|connect|setup)\b/, 'admin'],
  ];

  for (const [regex, cat] of CATEGORY_REGEXES) {
    if (regex.test(combined)) {
      categories.push(cat);
    }
  }

  // Discovery: only check tool name (too generic for description matching)
  if (categories.length === 0 && /\b(get|info|status|stats|check|details)\b/.test(toolName.toLowerCase())) {
    categories.push('discovery');
  }

  // Fallback
  if (categories.length === 0) {
    categories.push('general');
  }

  meta.category = categories[0]; // Primary category (backward compat)
  meta.categories = categories;  // All matching categories

  // Tag inference from name parts
  const tags: string[] = [];
  const parts = toolName.split('_');
  for (const part of parts) {
    if (part.length > 2) tags.push(part);
  }
  // Add description-derived tags
  const descLower = description.toLowerCase();
  if (descLower.includes('order')) tags.push('order');
  if (descLower.includes('price')) tags.push('price');
  if (descLower.includes('product')) tags.push('product');
  if (descLower.includes('listing')) tags.push('listing');
  if (descLower.includes('profit')) tags.push('profit');
  if (descLower.includes('ship')) tags.push('shipping');
  meta.tags = tags;

  return meta;
}

/**
 * Core tool names that are always sent with every API call.
 * These cover the most common use cases without needing tool_search.
 */
export const CORE_TOOL_NAMES = new Set([
  // Scanning (4)
  'scan_amazon',
  'scan_ebay',
  'compare_prices',
  'find_arbitrage',

  // Product info (2)
  'get_product_details',
  'check_orders',

  // Analytics (3)
  'profit_dashboard',
  'top_opportunities',
  'daily_report',

  // Credentials (6)
  'setup_amazon_credentials',
  'setup_ebay_credentials',
  'setup_walmart_credentials',
  'setup_aliexpress_credentials',
  'list_credentials',
  'delete_credentials',

  // Meta (1)
  'tool_search',
]);

/**
 * Keyword -> platform mapping for preloading tools from user messages.
 * Matches common ways users refer to platforms, including typos and abbreviations.
 */
const PLATFORM_KEYWORDS: [RegExp, string][] = [
  // Amazon: amzon, amazn, amzn
  [/\bamazon\b|\bamzn\b|\bamzon\b|\bamazn\b/i, 'amazon'],
  // eBay: ebay, e-bay
  [/\be[\s._-]?bay\b/i, 'ebay'],
  // Walmart: wal-mart, wallmart, walmrt
  [/\bwal[\s._-]?ma?r?t\b|\bwallmart\b/i, 'walmart'],
  // AliExpress: aliexpress, ali express, aliexpres, ali
  [/\bali[\s._-]?express?\b|\baliexpres\b/i, 'aliexpress'],
];

/**
 * Category keywords for preloading tools from user messages.
 * Synced with CATEGORY_REGEXES in inferToolMetadata -- keep in sync!
 */
const CATEGORY_KEYWORDS: [RegExp, string][] = [
  [/\b(?:scan|search|find|compare|browse|discover|opportunity|opportunities|arbitrage|arb|deals?)\b/i, 'scanning'],
  [/\b(?:list|create|publish|bulk|optimize|listing)\b/i, 'listing'],
  [/\b(?:order|ship|track|fulfill|purchase|return|delivery|delivered)\b/i, 'fulfillment'],
  [/\b(?:profit|revenue|report|dashboard|analytics?|margin|roi|earnings?)\b/i, 'analytics'],
  [/\b(?:prices?|reprice|fees?|costs?|calculate|calculator)\b/i, 'pricing'],
  [/\b(?:credentials?|api[\s._-]?key|setup|connect|config(?:ure)?|login)\b/i, 'admin'],
];

/**
 * Analyze a user message and return platform/category hints for tool preloading.
 * Returns the detected platforms and categories to preload tools for.
 */
export function detectToolHints(message: string): { platforms: string[]; categories: string[]; hasIntent: boolean } {
  const platforms = new Set<string>();
  const categories = new Set<string>();

  for (const [pattern, platform] of PLATFORM_KEYWORDS) {
    if (pattern.test(message)) {
      platforms.add(platform);
    }
  }

  for (const [pattern, category] of CATEGORY_KEYWORDS) {
    if (pattern.test(message)) {
      categories.add(category);
    }
  }

  return {
    platforms: Array.from(platforms),
    categories: Array.from(categories),
    hasIntent: categories.size > 0,
  };
}
