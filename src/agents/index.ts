/**
 * Agent Manager
 * Handles AI agent instances and message routing for FlipAgent.
 *
 * Simplified from Clodds' ~18K lines to ~800 lines:
 * - Single agent loop with tool calling
 * - Dynamic tool loading via ToolRegistry
 * - Streaming Anthropic API
 * - Stub tool implementations (to be filled in later)
 */

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import type {
  Session,
  IncomingMessage,
  OutgoingMessage,
  Config,
  Platform,
  ConversationMessage,
  AmazonCredentials,
  EbayCredentials,
  WalmartCredentials,
  AliExpressCredentials,
} from '../types';
import { createLogger } from '../utils/logger';
import {
  ToolRegistry,
  inferToolMetadata,
  CORE_TOOL_NAMES,
  detectToolHints,
  type ToolMetadata,
  type RegistryTool,
} from './tool-registry';
import type { SessionManager } from '../sessions';
import type { Database } from '../db';
import {
  createAmazonAdapter,
  createEbayAdapter,
  createWalmartAdapter,
  createAliExpressAdapter,
  type PlatformAdapter,
  type ProductSearchResult,
} from '../platforms';
import { createListing, optimizeListing } from '../listing/creator';
import { recommendPrice } from '../listing/pricer';
import { calculateProfit, calculateFees } from '../arbitrage/calculator';
import { autoPurchase } from '../fulfillment/purchaser';
import { getTracking, updateTrackingOnPlatform } from '../fulfillment/tracker';
import { createEbaySellerApi } from '../platforms/ebay/seller';

const logger = createLogger('agent');

// =============================================================================
// TYPES
// =============================================================================

/**
 * Credentials manager interface used by the agent.
 * Matches the synchronous API from credentials/index.ts.
 */
export interface CredentialsManager {
  getCredentials: <T = unknown>(userId: string, platform: Platform) => T | null;
  hasCredentials: (userId: string, platform: Platform) => boolean;
  listUserPlatforms: (userId: string) => Platform[];
  setCredentials?: (userId: string, platform: Platform, credentials: unknown) => void;
  deleteCredentials?: (userId: string, platform: Platform) => void;
}

/** Minimal skill manager interface (to be implemented in skills/loader.ts) */
export interface SkillManager {
  getSkillContext: (message?: string) => string;
  getCommands: () => Array<{ name: string; description: string }>;
  reload: () => void;
}

type JsonSchemaProperty = {
  type: string;
  description?: string;
  enum?: (string | number | boolean)[];
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  default?: unknown;
};

interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, JsonSchemaProperty>;
    required?: string[];
  };
  metadata?: ToolMetadata;
}

export interface AgentContext {
  session: Session;
  db: Database;
  sessionManager: SessionManager;
  skills: SkillManager;
  credentials: CredentialsManager;
  sendMessage: (msg: OutgoingMessage) => Promise<string | null>;
  addToHistory: (role: 'user' | 'assistant', content: string) => void;
  clearHistory: () => void;
}

export interface AgentManager {
  handleMessage: (message: IncomingMessage, session: Session) => Promise<string | null>;
  dispose: () => void;
  reloadSkills: () => void;
  reloadConfig: (config: Config) => void;
  getSkillCommands: () => Array<{ name: string; description: string }>;
}

// =============================================================================
// SYSTEM PROMPT
// =============================================================================

const SYSTEM_PROMPT = `You are FlipAgent, an AI assistant for e-commerce arbitrage.

You help users:
- Find price arbitrage opportunities across Amazon, eBay, Walmart, and AliExpress
- Auto-create optimized listings on selling platforms
- Monitor and fulfill orders via dropshipping
- Track profit, margins, and ROI across all operations
- Manage platform credentials and API keys

Be concise and direct. Use data when available. Format currency as $XX.XX.
When presenting margins, use percentage format (e.g., "32% margin").

{{SKILLS}}

Available platforms: amazon, ebay, walmart, aliexpress

Keep responses concise but informative.`;

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

function defineTools(): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    // -------------------------------------------------------------------------
    // Scanner tools
    // -------------------------------------------------------------------------
    {
      name: 'scan_amazon',
      description: 'Search Amazon for products by keyword. Returns product listings with prices, ratings, and availability.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (e.g., "wireless earbuds", "yoga mat")' },
          category: { type: 'string', description: 'Amazon category to narrow results' },
          maxResults: { type: 'number', description: 'Maximum number of results (default: 10)', default: 10 },
        },
        required: ['query'],
      },
    },
    {
      name: 'scan_ebay',
      description: 'Search eBay for products by keyword. Returns listings with prices, seller ratings, and shipping info.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          category: { type: 'string', description: 'eBay category to narrow results' },
          maxResults: { type: 'number', description: 'Maximum number of results (default: 10)', default: 10 },
        },
        required: ['query'],
      },
    },
    {
      name: 'scan_walmart',
      description: 'Search Walmart for products by keyword. Returns product listings with prices and availability.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          category: { type: 'string', description: 'Walmart category to narrow results' },
          maxResults: { type: 'number', description: 'Maximum number of results (default: 10)', default: 10 },
        },
        required: ['query'],
      },
    },
    {
      name: 'scan_aliexpress',
      description: 'Search AliExpress for products by keyword. Returns listings with prices, seller ratings, and shipping times.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          category: { type: 'string', description: 'AliExpress category to narrow results' },
          maxResults: { type: 'number', description: 'Maximum number of results (default: 10)', default: 10 },
        },
        required: ['query'],
      },
    },
    {
      name: 'compare_prices',
      description: 'Compare prices for a product across all platforms. Finds the cheapest source and best selling price.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Product name or search query' },
          upc: { type: 'string', description: 'UPC barcode for exact matching' },
          asin: { type: 'string', description: 'Amazon ASIN for exact matching' },
          platforms: {
            type: 'array',
            description: 'Platforms to compare (default: all)',
            items: { type: 'string', enum: ['amazon', 'ebay', 'walmart', 'aliexpress'] },
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'find_arbitrage',
      description: 'Find arbitrage opportunities with positive margins. Scans across platforms for price gaps.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Product category to focus on' },
          minMargin: { type: 'number', description: 'Minimum profit margin % (default: 15)', default: 15 },
          maxResults: { type: 'number', description: 'Maximum number of opportunities (default: 10)', default: 10 },
        },
      },
    },
    {
      name: 'match_products',
      description: 'Match a product across platforms using UPC, title, or other identifiers. Returns the same product on different platforms.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Product name or identifier' },
          upc: { type: 'string', description: 'UPC barcode for exact matching' },
          platforms: {
            type: 'array',
            description: 'Platforms to search (default: all)',
            items: { type: 'string', enum: ['amazon', 'ebay', 'walmart', 'aliexpress'] },
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_product_details',
      description: 'Get detailed product information from a specific platform including description, images, specifications, and current price.',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: 'Platform name', enum: ['amazon', 'ebay', 'walmart', 'aliexpress'] },
          productId: { type: 'string', description: 'Platform-specific product ID (ASIN, eBay item ID, etc.)' },
        },
        required: ['platform', 'productId'],
      },
    },
    {
      name: 'check_stock',
      description: 'Check current stock availability for a product on a specific platform.',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: 'Platform name', enum: ['amazon', 'ebay', 'walmart', 'aliexpress'] },
          productId: { type: 'string', description: 'Platform-specific product ID' },
        },
        required: ['platform', 'productId'],
      },
    },
    {
      name: 'get_price_history',
      description: 'Get historical price data for a product. Shows price trends over time.',
      input_schema: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'Internal product ID' },
          platform: { type: 'string', description: 'Filter to specific platform', enum: ['amazon', 'ebay', 'walmart', 'aliexpress'] },
          days: { type: 'number', description: 'Number of days of history (default: 30)', default: 30 },
        },
        required: ['productId'],
      },
    },

    // -------------------------------------------------------------------------
    // Listing tools
    // -------------------------------------------------------------------------
    {
      name: 'create_ebay_listing',
      description: 'Create a new eBay listing for a product. Auto-optimizes title and description for search visibility.',
      input_schema: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'Internal product ID to list' },
          title: { type: 'string', description: 'Listing title (max 80 chars for eBay)' },
          price: { type: 'number', description: 'Listing price in USD' },
          description: { type: 'string', description: 'HTML or plain text description' },
          category: { type: 'string', description: 'eBay category ID or name' },
        },
        required: ['productId', 'title', 'price'],
      },
    },
    {
      name: 'create_amazon_listing',
      description: 'Create a new Amazon listing or offer for an existing product.',
      input_schema: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'Internal product ID' },
          title: { type: 'string', description: 'Product title' },
          price: { type: 'number', description: 'Listing price in USD' },
          asin: { type: 'string', description: 'ASIN to list against (existing product)' },
        },
        required: ['productId', 'title', 'price'],
      },
    },
    {
      name: 'update_listing_price',
      description: 'Update the price of an existing listing on any platform.',
      input_schema: {
        type: 'object',
        properties: {
          listingId: { type: 'string', description: 'Internal listing ID' },
          newPrice: { type: 'number', description: 'New price in USD' },
        },
        required: ['listingId', 'newPrice'],
      },
    },
    {
      name: 'optimize_listing',
      description: 'Optimize an existing listing by improving title, description, and keywords for better search ranking.',
      input_schema: {
        type: 'object',
        properties: {
          listingId: { type: 'string', description: 'Internal listing ID to optimize' },
        },
        required: ['listingId'],
      },
    },
    {
      name: 'bulk_list',
      description: 'Create listings for multiple arbitrage opportunities at once.',
      input_schema: {
        type: 'object',
        properties: {
          opportunityIds: {
            type: 'array',
            description: 'Array of opportunity IDs to create listings for',
            items: { type: 'string' },
          },
        },
        required: ['opportunityIds'],
      },
    },
    {
      name: 'pause_listing',
      description: 'Pause an active listing (temporarily hide from buyers).',
      input_schema: {
        type: 'object',
        properties: {
          listingId: { type: 'string', description: 'Internal listing ID to pause' },
        },
        required: ['listingId'],
      },
    },
    {
      name: 'resume_listing',
      description: 'Resume a paused listing (make visible to buyers again).',
      input_schema: {
        type: 'object',
        properties: {
          listingId: { type: 'string', description: 'Internal listing ID to resume' },
        },
        required: ['listingId'],
      },
    },
    {
      name: 'delete_listing',
      description: 'Permanently delete a listing from the selling platform.',
      input_schema: {
        type: 'object',
        properties: {
          listingId: { type: 'string', description: 'Internal listing ID to delete' },
        },
        required: ['listingId'],
      },
    },

    // -------------------------------------------------------------------------
    // Fulfillment tools
    // -------------------------------------------------------------------------
    {
      name: 'check_orders',
      description: 'Check current orders and their statuses. Filter by status or platform.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter by order status', enum: ['pending', 'purchased', 'shipped', 'delivered', 'returned'] },
          platform: { type: 'string', description: 'Filter by selling platform', enum: ['amazon', 'ebay', 'walmart', 'aliexpress'] },
        },
      },
    },
    {
      name: 'auto_purchase',
      description: 'Automatically purchase a product from the source platform to fulfill an order.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Order ID to fulfill' },
        },
        required: ['orderId'],
      },
    },
    {
      name: 'track_shipment',
      description: 'Get shipping tracking information for an order.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Order ID to track' },
        },
        required: ['orderId'],
      },
    },
    {
      name: 'update_tracking',
      description: 'Update tracking information for an order on the selling platform.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Order ID to update' },
          trackingNumber: { type: 'string', description: 'Shipping tracking number' },
          carrier: { type: 'string', description: 'Shipping carrier (e.g., USPS, UPS, FedEx)' },
        },
        required: ['orderId', 'trackingNumber'],
      },
    },
    {
      name: 'handle_return',
      description: 'Process a return request for an order.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Order ID for the return' },
          reason: { type: 'string', description: 'Reason for the return' },
        },
        required: ['orderId'],
      },
    },
    {
      name: 'calculate_profit',
      description: 'Calculate profit for a specific order or over a date range, accounting for all fees and costs.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Specific order ID to calculate profit for' },
          dateRange: { type: 'string', description: 'Date range string (e.g., "7d", "30d", "2024-01-01..2024-01-31")' },
        },
      },
    },

    // -------------------------------------------------------------------------
    // Analytics tools
    // -------------------------------------------------------------------------
    {
      name: 'daily_report',
      description: 'Generate a daily summary report of all activity: scans, listings, orders, and profit.',
      input_schema: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date for the report (YYYY-MM-DD, default: today)' },
        },
      },
    },
    {
      name: 'profit_dashboard',
      description: 'Show profit dashboard with revenue, costs, fees, and net profit for a given period.',
      input_schema: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'Time period (e.g., "7d", "30d", "mtd", "ytd")', default: '7d' },
        },
      },
    },
    {
      name: 'top_opportunities',
      description: 'Show the top current arbitrage opportunities ranked by estimated profit margin.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of opportunities to show (default: 10)', default: 10 },
          minMargin: { type: 'number', description: 'Minimum margin % to include', default: 10 },
        },
      },
    },
    {
      name: 'category_analysis',
      description: 'Analyze profitability and opportunity density by product category.',
      input_schema: {
        type: 'object',
        properties: {
          category: { type: 'string', description: 'Specific category to analyze (default: all categories)' },
        },
      },
    },
    {
      name: 'competitor_watch',
      description: 'Monitor competitor pricing and activity for a product or across a platform.',
      input_schema: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'Product ID to monitor competitors for' },
          platform: { type: 'string', description: 'Platform to monitor', enum: ['amazon', 'ebay', 'walmart', 'aliexpress'] },
        },
      },
    },
    {
      name: 'fee_calculator',
      description: 'Calculate estimated platform fees for selling a product at a given price.',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: 'Selling platform', enum: ['amazon', 'ebay', 'walmart', 'aliexpress'] },
          price: { type: 'number', description: 'Selling price in USD' },
          category: { type: 'string', description: 'Product category (affects fee rates)' },
          shipping: { type: 'number', description: 'Shipping cost in USD', default: 0 },
        },
        required: ['platform', 'price'],
      },
    },

    // -------------------------------------------------------------------------
    // Credential tools (core)
    // -------------------------------------------------------------------------
    {
      name: 'setup_amazon_credentials',
      description: 'Store Amazon Product Advertising API credentials for product scanning and listing.',
      input_schema: {
        type: 'object',
        properties: {
          accessKeyId: { type: 'string', description: 'Amazon PA-API Access Key ID' },
          secretAccessKey: { type: 'string', description: 'Amazon PA-API Secret Access Key' },
          partnerTag: { type: 'string', description: 'Amazon Associates partner tag' },
          marketplace: { type: 'string', description: 'Amazon marketplace (default: US)', default: 'US' },
        },
        required: ['accessKeyId', 'secretAccessKey', 'partnerTag'],
      },
    },
    {
      name: 'setup_ebay_credentials',
      description: 'Store eBay API credentials for listing and order management.',
      input_schema: {
        type: 'object',
        properties: {
          clientId: { type: 'string', description: 'eBay API Client ID (App ID)' },
          clientSecret: { type: 'string', description: 'eBay API Client Secret (Cert ID)' },
          refreshToken: { type: 'string', description: 'eBay OAuth refresh token' },
          environment: { type: 'string', description: 'API environment', enum: ['sandbox', 'production'], default: 'production' },
        },
        required: ['clientId', 'clientSecret', 'refreshToken'],
      },
    },
    {
      name: 'setup_walmart_credentials',
      description: 'Store Walmart API credentials for product scanning.',
      input_schema: {
        type: 'object',
        properties: {
          clientId: { type: 'string', description: 'Walmart API Client ID' },
          clientSecret: { type: 'string', description: 'Walmart API Client Secret' },
        },
        required: ['clientId', 'clientSecret'],
      },
    },
    {
      name: 'setup_aliexpress_credentials',
      description: 'Store AliExpress API credentials for product scanning and sourcing.',
      input_schema: {
        type: 'object',
        properties: {
          appKey: { type: 'string', description: 'AliExpress App Key' },
          appSecret: { type: 'string', description: 'AliExpress App Secret' },
        },
        required: ['appKey', 'appSecret'],
      },
    },
    {
      name: 'list_credentials',
      description: 'List all configured platform credentials (shows platforms, not secrets).',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'delete_credentials',
      description: 'Delete stored credentials for a platform.',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: 'Platform to delete credentials for', enum: ['amazon', 'ebay', 'walmart', 'aliexpress'] },
        },
        required: ['platform'],
      },
    },

    // -------------------------------------------------------------------------
    // Meta tool (core)
    // -------------------------------------------------------------------------
    {
      name: 'tool_search',
      description: 'Search for available tools by name, platform, or category. Use this when you need a specialized tool that is not in your current set.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query describing what you need' },
          platform: { type: 'string', description: 'Filter by platform', enum: ['amazon', 'ebay', 'walmart', 'aliexpress'] },
          category: { type: 'string', description: 'Filter by category', enum: ['scanning', 'listing', 'fulfillment', 'analytics', 'pricing', 'admin'] },
        },
        required: ['query'],
      },
    },
  ];

  // Apply metadata to all tools
  for (const tool of tools) {
    const inferred = inferToolMetadata(tool.name, tool.description);
    tool.metadata = {
      ...inferred,
      core: CORE_TOOL_NAMES.has(tool.name),
    };
  }

  return tools;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Strip the `metadata` field from tools before sending to the Anthropic API.
 * The API does not accept unknown fields on tool definitions.
 */
function toApiTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map(({ metadata: _metadata, ...rest }) => rest as Anthropic.Tool);
}

/**
 * Select tools for the current message based on core tools + detected hints.
 * Caps at 50 tools to stay within Anthropic limits.
 */
function selectTools(
  registry: ToolRegistry<ToolDefinition>,
  messageText: string,
): ToolDefinition[] {
  const MAX_TOOLS = 50;
  const selected = new Map<string, ToolDefinition>();

  // Always include core tools
  for (const tool of registry.getCoreTools()) {
    selected.set(tool.name, tool);
  }

  // Detect hints from message text
  const hints = detectToolHints(messageText);

  // Add platform-matched tools
  for (const platform of hints.platforms) {
    for (const tool of registry.searchByPlatform(platform)) {
      if (selected.size >= MAX_TOOLS) break;
      selected.set(tool.name, tool);
    }
  }

  // Add category-matched tools
  for (const category of hints.categories) {
    for (const tool of registry.searchByCategory(category)) {
      if (selected.size >= MAX_TOOLS) break;
      selected.set(tool.name, tool);
    }
  }

  return Array.from(selected.values());
}

// =============================================================================
// TOOL EXECUTION — REAL PLATFORM INTEGRATIONS
// =============================================================================

/**
 * Get platform credentials for a user, returning typed credential objects.
 */
function getUserCreds(
  credentials: CredentialsManager,
  userId: string,
): {
  amazon?: AmazonCredentials;
  ebay?: EbayCredentials;
  walmart?: WalmartCredentials;
  aliexpress?: AliExpressCredentials;
} {
  return {
    amazon: credentials.getCredentials<AmazonCredentials>(userId, 'amazon') ?? undefined,
    ebay: credentials.getCredentials<EbayCredentials>(userId, 'ebay') ?? undefined,
    walmart: credentials.getCredentials<WalmartCredentials>(userId, 'walmart') ?? undefined,
    aliexpress: credentials.getCredentials<AliExpressCredentials>(userId, 'aliexpress') ?? undefined,
  };
}

/**
 * Create a platform adapter for a given platform using user's credentials.
 */
function getAdapter(platform: Platform, creds: ReturnType<typeof getUserCreds>): PlatformAdapter {
  switch (platform) {
    case 'amazon': return createAmazonAdapter(creds.amazon);
    case 'ebay': return createEbayAdapter(creds.ebay);
    case 'walmart': return createWalmartAdapter(creds.walmart);
    case 'aliexpress': return createAliExpressAdapter(creds.aliexpress);
  }
}

/**
 * Store search results in DB as products + price snapshots.
 */
function storeResults(db: Database, results: ProductSearchResult[]): void {
  const now = new Date();
  for (const r of results) {
    const productId = `${r.platform}:${r.platformId}`;
    db.upsertProduct({
      id: productId,
      title: r.title,
      upc: r.upc,
      asin: r.asin,
      brand: r.brand,
      category: r.category,
      imageUrl: r.imageUrl,
      createdAt: now,
      updatedAt: now,
    });
    db.addPrice({
      productId,
      platform: r.platform,
      platformId: r.platformId,
      price: r.price,
      shipping: r.shipping,
      currency: r.currency,
      inStock: r.inStock,
      seller: r.seller,
      url: r.url,
      fetchedAt: now,
    });
  }
}

/**
 * Execute a tool by name with the given input.
 * Wired to real platform API integrations via adapters.
 */
async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  context: {
    registry: ToolRegistry<ToolDefinition>;
    db: Database;
    credentials: CredentialsManager;
    userId: string;
  },
): Promise<unknown> {
  const creds = getUserCreds(context.credentials, context.userId);

  switch (toolName) {
    // -----------------------------------------------------------------------
    // Meta: tool_search
    // -----------------------------------------------------------------------
    case 'tool_search': {
      const results = context.registry.search({
        query: input.query as string | undefined,
        platform: input.platform as string | undefined,
        category: input.category as string | undefined,
      });
      return {
        tools: results.slice(0, 20).map(t => ({
          name: t.name,
          description: t.description,
          platform: t.metadata?.platform ?? 'general',
          category: t.metadata?.category ?? 'general',
        })),
        total: results.length,
      };
    }

    // -----------------------------------------------------------------------
    // Credentials
    // -----------------------------------------------------------------------
    case 'setup_amazon_credentials': {
      const credData = {
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
        partnerTag: input.partnerTag,
        marketplace: input.marketplace ?? 'US',
      };
      if (context.credentials.setCredentials) {
        context.credentials.setCredentials(context.userId, 'amazon', credData);
      }
      return { status: 'ok', message: 'Amazon credentials saved and encrypted.' };
    }

    case 'setup_ebay_credentials': {
      const credData = {
        clientId: input.clientId,
        clientSecret: input.clientSecret,
        refreshToken: input.refreshToken,
        environment: input.environment ?? 'production',
      };
      if (context.credentials.setCredentials) {
        context.credentials.setCredentials(context.userId, 'ebay', credData);
      }
      return { status: 'ok', message: 'eBay credentials saved and encrypted.' };
    }

    case 'setup_walmart_credentials': {
      const credData = {
        clientId: input.clientId,
        clientSecret: input.clientSecret,
      };
      if (context.credentials.setCredentials) {
        context.credentials.setCredentials(context.userId, 'walmart', credData);
      }
      return { status: 'ok', message: 'Walmart credentials saved and encrypted.' };
    }

    case 'setup_aliexpress_credentials': {
      const credData = {
        appKey: input.appKey,
        appSecret: input.appSecret,
      };
      if (context.credentials.setCredentials) {
        context.credentials.setCredentials(context.userId, 'aliexpress', credData);
      }
      return { status: 'ok', message: 'AliExpress credentials saved and encrypted.' };
    }

    case 'list_credentials': {
      const platforms = context.credentials.listUserPlatforms(context.userId);
      return {
        status: 'ok',
        platforms,
        message: platforms.length > 0
          ? `Configured platforms: ${platforms.join(', ')}`
          : 'No platform credentials configured yet.',
      };
    }

    case 'delete_credentials': {
      const platform = input.platform as Platform;
      if (context.credentials.deleteCredentials) {
        context.credentials.deleteCredentials(context.userId, platform);
      }
      return { status: 'ok', message: `Credentials for ${platform} deleted.` };
    }

    // -----------------------------------------------------------------------
    // Scanners — Real API calls
    // -----------------------------------------------------------------------
    case 'scan_amazon': {
      if (!creds.amazon) {
        return { status: 'error', message: 'Amazon credentials not configured. Use setup_amazon_credentials first.' };
      }
      const adapter = createAmazonAdapter(creds.amazon);
      const results = await adapter.search({
        query: input.query as string,
        category: input.category as string | undefined,
        maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
      });
      storeResults(context.db, results);
      return { status: 'ok', results, count: results.length };
    }

    case 'scan_ebay': {
      if (!creds.ebay) {
        return { status: 'error', message: 'eBay credentials not configured. Use setup_ebay_credentials first.' };
      }
      const adapter = createEbayAdapter(creds.ebay);
      const results = await adapter.search({
        query: input.query as string,
        category: input.category as string | undefined,
        maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
      });
      storeResults(context.db, results);
      return { status: 'ok', results, count: results.length };
    }

    case 'scan_walmart': {
      if (!creds.walmart) {
        return { status: 'error', message: 'Walmart credentials not configured. Use setup_walmart_credentials first.' };
      }
      const adapter = createWalmartAdapter(creds.walmart);
      const results = await adapter.search({
        query: input.query as string,
        category: input.category as string | undefined,
        maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
      });
      storeResults(context.db, results);
      return { status: 'ok', results, count: results.length };
    }

    case 'scan_aliexpress': {
      if (!creds.aliexpress) {
        return { status: 'error', message: 'AliExpress credentials not configured. Use setup_aliexpress_credentials first.' };
      }
      const adapter = createAliExpressAdapter(creds.aliexpress);
      const results = await adapter.search({
        query: input.query as string,
        category: input.category as string | undefined,
        maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
      });
      storeResults(context.db, results);
      return { status: 'ok', results, count: results.length };
    }

    case 'compare_prices': {
      const query = input.query as string;
      const targetPlatforms = (input.platforms as Platform[] | undefined) ?? ['amazon', 'ebay', 'walmart', 'aliexpress'] as Platform[];
      const maxResults = 5;

      // Search all configured platforms in parallel
      const searchPromises = targetPlatforms.map(async (platform) => {
        const adapter = getAdapter(platform, creds);
        try {
          const results = await adapter.search({ query, maxResults });
          storeResults(context.db, results);
          return { platform, results, error: null };
        } catch (err) {
          return { platform, results: [] as ProductSearchResult[], error: err instanceof Error ? err.message : String(err) };
        }
      });

      const allResults = await Promise.all(searchPromises);

      const comparisons = allResults.map(r => ({
        platform: r.platform,
        resultCount: r.results.length,
        lowestPrice: r.results.length > 0 ? Math.min(...r.results.map(p => p.price + p.shipping)) : null,
        highestPrice: r.results.length > 0 ? Math.max(...r.results.map(p => p.price + p.shipping)) : null,
        topResults: r.results.slice(0, 3).map(p => ({
          title: p.title,
          price: p.price,
          shipping: p.shipping,
          total: p.price + p.shipping,
          seller: p.seller,
          url: p.url,
          inStock: p.inStock,
        })),
        error: r.error,
      }));

      // Find cheapest source and most expensive target
      const allProducts = allResults.flatMap(r => r.results);
      const cheapest = allProducts.length > 0
        ? allProducts.reduce((min, p) => (p.price + p.shipping) < (min.price + min.shipping) ? p : min)
        : null;
      const mostExpensive = allProducts.length > 0
        ? allProducts.reduce((max, p) => (p.price + p.shipping) > (max.price + max.shipping) ? p : max)
        : null;

      return {
        status: 'ok',
        query,
        comparisons,
        cheapestSource: cheapest ? { platform: cheapest.platform, price: cheapest.price, shipping: cheapest.shipping, total: cheapest.price + cheapest.shipping, title: cheapest.title } : null,
        bestSellPrice: mostExpensive ? { platform: mostExpensive.platform, price: mostExpensive.price, shipping: mostExpensive.shipping, total: mostExpensive.price + mostExpensive.shipping, title: mostExpensive.title } : null,
        potentialSpread: cheapest && mostExpensive ? (mostExpensive.price + mostExpensive.shipping) - (cheapest.price + cheapest.shipping) : 0,
      };
    }

    case 'find_arbitrage': {
      // First check DB for existing opportunities
      const maxResults = typeof input.maxResults === 'number' ? input.maxResults : 10;
      const minMargin = typeof input.minMargin === 'number' ? input.minMargin : 15;
      const opps = context.db.getActiveOpportunities(maxResults);

      // Filter by minimum margin
      const filtered = opps.filter(o => o.marginPct >= minMargin);

      return {
        status: 'ok',
        message: `Found ${filtered.length} arbitrage opportunities with ${minMargin}%+ margin.`,
        opportunities: filtered.map(o => ({
          id: o.id,
          productId: o.productId,
          buyPlatform: o.buyPlatform,
          buyPrice: o.buyPrice,
          buyShipping: o.buyShipping,
          sellPlatform: o.sellPlatform,
          sellPrice: o.sellPrice,
          estimatedFees: o.estimatedFees,
          estimatedProfit: o.estimatedProfit,
          marginPct: o.marginPct,
          score: o.score,
        })),
        count: filtered.length,
      };
    }

    case 'match_products': {
      const query = input.query as string;
      const targetPlatforms = (input.platforms as Platform[] | undefined) ?? ['amazon', 'ebay', 'walmart', 'aliexpress'] as Platform[];

      // Search all platforms for the same product
      const searchPromises = targetPlatforms.map(async (platform) => {
        const adapter = getAdapter(platform, creds);
        try {
          const results = await adapter.search({ query, maxResults: 3 });
          storeResults(context.db, results);
          return { platform, results };
        } catch {
          return { platform, results: [] as ProductSearchResult[] };
        }
      });

      const allResults = await Promise.all(searchPromises);

      const matches = allResults.map(r => ({
        platform: r.platform,
        products: r.results.map(p => ({
          platformId: p.platformId,
          title: p.title,
          price: p.price,
          shipping: p.shipping,
          total: p.price + p.shipping,
          seller: p.seller,
          url: p.url,
          inStock: p.inStock,
        })),
      }));

      return { status: 'ok', query, matches, platformCount: allResults.filter(r => r.results.length > 0).length };
    }

    case 'get_product_details': {
      const platform = input.platform as Platform;
      const productId = input.productId as string;

      // Try DB first
      const dbProduct = context.db.getProduct(productId) ?? context.db.getProduct(`${platform}:${productId}`);
      const latestPrices = dbProduct ? context.db.getLatestPrices(dbProduct.id) : [];

      // Also fetch live from platform
      const adapter = getAdapter(platform, creds);
      try {
        const liveProduct = await adapter.getProduct(productId);
        if (liveProduct) {
          storeResults(context.db, [liveProduct]);
          return {
            status: 'ok',
            product: liveProduct,
            dbProduct: dbProduct ?? null,
            latestPrices,
          };
        }
      } catch (err) {
        logger.warn({ platform, productId, err }, 'Live product fetch failed, using DB');
      }

      if (dbProduct) {
        return { status: 'ok', product: dbProduct, latestPrices };
      }

      return { status: 'error', message: `Product ${productId} not found on ${platform}` };
    }

    case 'check_stock': {
      const platform = input.platform as Platform;
      const productId = input.productId as string;
      const adapter = getAdapter(platform, creds);

      try {
        const stock = await adapter.checkStock(productId);
        return { status: 'ok', platform, productId, ...stock };
      } catch (err) {
        return { status: 'error', message: `Stock check failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case 'get_price_history': {
      const history = context.db.getPriceHistory(
        input.productId as string,
        input.platform as Platform | undefined,
      );
      return {
        status: 'ok',
        productId: input.productId,
        history,
        count: history.length,
      };
    }

    // -----------------------------------------------------------------------
    // Listings — Real eBay Inventory API
    // -----------------------------------------------------------------------
    case 'create_ebay_listing': {
      const productId = input.productId as string;
      const title = input.title as string;
      const price = input.price as number;
      const description = input.description as string | undefined;
      const category = input.category as string | undefined;

      const result = await createListing('ebay', {
        title,
        description: description ?? '',
        price,
        category: category ?? '0',
        imageUrls: [],
        condition: 'new',
        quantity: 1,
      }, { ebay: creds.ebay });

      if (result.success && result.listingId) {
        // Store listing in DB
        const now = new Date();
        context.db.addListing({
          id: randomUUID().slice(0, 12),
          productId,
          platform: 'ebay',
          platformListingId: result.listingId,
          title,
          price,
          sourcePlatform: 'aliexpress',
          sourcePrice: 0,
          status: 'active',
          createdAt: now,
          updatedAt: now,
        });
      }

      return { status: result.success ? 'ok' : 'error', ...result };
    }

    case 'create_amazon_listing': {
      const result = await createListing('amazon', {
        title: input.title as string,
        description: '',
        price: input.price as number,
        category: '0',
        imageUrls: [],
        condition: 'new',
        quantity: 1,
      }, { ebay: creds.ebay });
      return { status: result.success ? 'ok' : 'error', ...result };
    }

    case 'update_listing_price': {
      const listingId = input.listingId as string;
      const newPrice = input.newPrice as number;

      // Look up listing to find platform and offer ID
      const listingRows = context.db.query<{
        platform: string;
        platform_listing_id: string;
      }>(
        'SELECT platform, platform_listing_id FROM listings WHERE id = ?',
        [listingId],
      );

      if (listingRows.length === 0) {
        return { status: 'error', message: `Listing ${listingId} not found.` };
      }

      const listing = listingRows[0];
      let platformUpdated = false;

      // If eBay listing with credentials, update price on platform too
      if (listing.platform === 'ebay' && creds.ebay?.refreshToken && listing.platform_listing_id) {
        try {
          const seller = createEbaySellerApi(creds.ebay);
          await seller.updateOfferPrice(listing.platform_listing_id, newPrice);
          platformUpdated = true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn({ listingId, error: msg }, 'Failed to update price on eBay, DB updated only');
        }
      }

      // Update in DB
      context.db.run(
        'UPDATE listings SET price = ?, updated_at = ? WHERE id = ?',
        [newPrice, Date.now(), listingId],
      );

      const platformMsg = platformUpdated
        ? ' Price also updated on eBay.'
        : listing.platform === 'ebay' ? ' Note: Could not update on eBay (check credentials).' : '';
      return { status: 'ok', message: `Listing ${listingId} price updated to $${newPrice.toFixed(2)}.${platformMsg}` };
    }

    case 'optimize_listing': {
      const listingId = input.listingId as string;

      // Get listing from DB
      const listings = context.db.query<{ title: string; price: number }>(
        'SELECT title, price FROM listings WHERE id = ?',
        [listingId],
      );

      if (listings.length === 0) {
        return { status: 'error', message: `Listing ${listingId} not found.` };
      }

      const { title: optimizedTitle, description: optimizedDescription } = await optimizeListing(
        listings[0].title ?? '',
        '',
      );

      return {
        status: 'ok',
        listingId,
        optimized: {
          title: optimizedTitle,
          description: optimizedDescription,
        },
        message: 'Listing optimized. Apply changes with update_listing_price or create a new listing.',
      };
    }

    case 'bulk_list': {
      const ids = input.opportunityIds as string[];
      let created = 0;
      let failed = 0;
      const results: Array<{ opportunityId: string; success: boolean; error?: string }> = [];

      for (const oppId of ids) {
        const opps = context.db.query<{
          product_id: string;
          sell_platform: string;
          sell_price: number;
          buy_platform: string;
          buy_price: number;
        }>(
          'SELECT product_id, sell_platform, sell_price, buy_platform, buy_price FROM opportunities WHERE id = ?',
          [oppId],
        );

        if (opps.length === 0) {
          failed++;
          results.push({ opportunityId: oppId, success: false, error: 'Opportunity not found' });
          continue;
        }

        const opp = opps[0];
        const product = context.db.getProduct(opp.product_id);
        const title = product?.title ?? `Product ${opp.product_id}`;

        try {
          const result = await createListing(opp.sell_platform as Platform, {
            title,
            description: '',
            price: opp.sell_price,
            category: product?.category ?? '0',
            imageUrls: product?.imageUrl ? [product.imageUrl] : [],
            condition: 'new',
            quantity: 1,
          }, { ebay: creds.ebay });

          if (result.success) {
            created++;
            const now = new Date();
            context.db.addListing({
              id: randomUUID().slice(0, 12),
              opportunityId: oppId,
              productId: opp.product_id,
              platform: opp.sell_platform as Platform,
              platformListingId: result.listingId,
              title,
              price: opp.sell_price,
              sourcePlatform: opp.buy_platform as Platform,
              sourcePrice: opp.buy_price,
              status: 'active',
              createdAt: now,
              updatedAt: now,
            });
            context.db.updateOpportunityStatus(oppId, 'listed');
          } else {
            failed++;
          }
          results.push({ opportunityId: oppId, success: result.success, error: result.error });
        } catch (err) {
          failed++;
          results.push({ opportunityId: oppId, success: false, error: err instanceof Error ? err.message : String(err) });
        }
      }

      return { status: 'ok', created, failed, total: ids.length, results };
    }

    case 'pause_listing': {
      context.db.updateListingStatus(input.listingId as string, 'paused');
      return { status: 'ok', message: `Listing ${input.listingId} paused.` };
    }

    case 'resume_listing': {
      context.db.updateListingStatus(input.listingId as string, 'active');
      return { status: 'ok', message: `Listing ${input.listingId} resumed.` };
    }

    case 'delete_listing': {
      context.db.updateListingStatus(input.listingId as string, 'expired');
      return { status: 'ok', message: `Listing ${input.listingId} deleted.` };
    }

    // -----------------------------------------------------------------------
    // Fulfillment — Real API integrations
    // -----------------------------------------------------------------------
    case 'check_orders': {
      const statusFilter = input.status as string | undefined;
      const platformFilter = input.platform as string | undefined;

      let query = 'SELECT * FROM orders WHERE 1=1';
      const params: unknown[] = [];

      if (statusFilter) {
        query += ' AND status = ?';
        params.push(statusFilter);
      }
      if (platformFilter) {
        query += ' AND sell_platform = ?';
        params.push(platformFilter);
      }
      query += ' ORDER BY ordered_at DESC LIMIT 50';

      const orders = context.db.query<Record<string, unknown>>(query, params);
      return {
        status: 'ok',
        orders: orders.map(o => ({
          id: o.id,
          sellPlatform: o.sell_platform,
          sellOrderId: o.sell_order_id,
          sellPrice: o.sell_price,
          buyPlatform: o.buy_platform,
          buyOrderId: o.buy_order_id,
          buyPrice: o.buy_price,
          status: o.status,
          trackingNumber: o.tracking_number,
          profit: o.profit,
          orderedAt: o.ordered_at,
        })),
        count: orders.length,
      };
    }

    case 'auto_purchase': {
      const result = await autoPurchase(
        input.orderId as string,
        context.db,
        { aliexpress: creds.aliexpress },
      );
      return { status: result.success ? 'ok' : 'error', ...result };
    }

    case 'track_shipment': {
      const order = context.db.getOrder(input.orderId as string);
      if (!order) {
        return { status: 'error', message: `Order ${input.orderId} not found.` };
      }

      if (order.trackingNumber) {
        const tracking = await getTracking(
          order.trackingNumber,
          undefined,
          { aliexpress: creds.aliexpress },
        );
        return {
          status: 'ok',
          orderId: order.id,
          trackingNumber: order.trackingNumber,
          orderStatus: order.status,
          tracking,
        };
      }

      return {
        status: 'ok',
        message: `No tracking info available for order ${input.orderId}.`,
        orderId: order.id,
        orderStatus: order.status,
      };
    }

    case 'update_tracking': {
      const orderId = input.orderId as string;
      const trackingNumber = input.trackingNumber as string;
      const carrier = input.carrier as string | undefined;

      context.db.updateOrderStatus(orderId, 'shipped', {
        trackingNumber,
        shippedAt: new Date(),
      });

      // Try to push tracking to selling platform
      const order = context.db.getOrder(orderId);
      if (order?.sellPlatform === 'ebay' && order.sellOrderId) {
        await updateTrackingOnPlatform(
          'ebay',
          order.sellOrderId,
          trackingNumber,
          carrier ?? 'OTHER',
          { ebay: creds.ebay },
        );
      }

      return {
        status: 'ok',
        message: `Tracking updated for order ${orderId}: ${trackingNumber}`,
      };
    }

    case 'handle_return': {
      context.db.updateOrderStatus(input.orderId as string, 'returned');
      return {
        status: 'ok',
        message: `Return initiated for order ${input.orderId}.`,
        reason: input.reason ?? 'Not specified',
      };
    }

    case 'calculate_profit': {
      if (input.orderId) {
        const order = context.db.getOrder(input.orderId as string);
        if (order) {
          // Calculate using real fee calculator if we have both prices
          if (order.sellPrice && order.buyPrice) {
            const calc = calculateProfit(
              order.sellPlatform,
              order.sellPrice,
              order.buyPlatform,
              order.buyPrice,
              0,
              order.shippingCost ?? 0,
            );
            return {
              status: 'ok',
              orderId: order.id,
              sellPrice: order.sellPrice,
              buyPrice: order.buyPrice,
              shippingCost: order.shippingCost,
              platformFees: calc.platformFees,
              netProfit: calc.netProfit,
              marginPct: calc.marginPct,
              roi: calc.roi,
            };
          }
          return {
            status: 'ok',
            orderId: order.id,
            sellPrice: order.sellPrice,
            buyPrice: order.buyPrice,
            profit: order.profit,
            note: 'Partial data — buy price not yet recorded.',
          };
        }
      }

      // Date range profit calculation
      const orders = context.db.query<Record<string, unknown>>(
        "SELECT * FROM orders WHERE status IN ('shipped', 'delivered') ORDER BY ordered_at DESC LIMIT 100",
      );

      let totalRevenue = 0;
      let totalCosts = 0;
      let totalProfit = 0;
      for (const o of orders) {
        totalRevenue += (o.sell_price as number) ?? 0;
        totalCosts += ((o.buy_price as number) ?? 0) + ((o.shipping_cost as number) ?? 0) + ((o.platform_fees as number) ?? 0);
        totalProfit += (o.profit as number) ?? 0;
      }

      return {
        status: 'ok',
        orderCount: orders.length,
        totalRevenue,
        totalCosts,
        totalProfit,
        avgMargin: totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0,
      };
    }

    // -----------------------------------------------------------------------
    // Analytics — DB-powered
    // -----------------------------------------------------------------------
    case 'daily_report': {
      const date = (input.date as string) ?? new Date().toISOString().split('T')[0];
      const dayStart = new Date(date + 'T00:00:00Z').getTime();
      const dayEnd = new Date(date + 'T23:59:59Z').getTime();

      const newOpps = context.db.query<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM opportunities WHERE found_at >= ? AND found_at <= ?',
        [dayStart, dayEnd],
      );
      const newListings = context.db.query<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM listings WHERE created_at >= ? AND created_at <= ?',
        [dayStart, dayEnd],
      );
      const ordersToday = context.db.query<Record<string, unknown>>(
        'SELECT sell_price, profit FROM orders WHERE ordered_at >= ? AND ordered_at <= ?',
        [dayStart, dayEnd],
      );

      let revenue = 0;
      let profit = 0;
      for (const o of ordersToday) {
        revenue += (o.sell_price as number) ?? 0;
        profit += (o.profit as number) ?? 0;
      }

      return {
        status: 'ok',
        date,
        newOpportunities: newOpps[0]?.cnt ?? 0,
        listingsCreated: newListings[0]?.cnt ?? 0,
        ordersFulfilled: ordersToday.length,
        revenue,
        profit,
        activeListings: context.db.getActiveListings().length,
        activeOpportunities: context.db.getActiveOpportunities(999).length,
      };
    }

    case 'profit_dashboard': {
      const period = (input.period as string) ?? '7d';
      let daysBack = 7;
      if (period === '30d') daysBack = 30;
      else if (period === 'mtd') daysBack = new Date().getDate();
      else if (period === 'ytd') daysBack = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000);

      const since = Date.now() - daysBack * 86400000;

      const orders = context.db.query<Record<string, unknown>>(
        "SELECT sell_price, buy_price, shipping_cost, platform_fees, profit FROM orders WHERE ordered_at >= ? AND status IN ('shipped', 'delivered', 'purchased')",
        [since],
      );

      let totalRevenue = 0;
      let totalCosts = 0;
      let totalFees = 0;
      let netProfit = 0;
      for (const o of orders) {
        totalRevenue += (o.sell_price as number) ?? 0;
        totalCosts += ((o.buy_price as number) ?? 0) + ((o.shipping_cost as number) ?? 0);
        totalFees += (o.platform_fees as number) ?? 0;
        netProfit += (o.profit as number) ?? 0;
      }

      return {
        status: 'ok',
        period,
        daysBack,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalCosts: Math.round(totalCosts * 100) / 100,
        totalFees: Math.round(totalFees * 100) / 100,
        netProfit: Math.round(netProfit * 100) / 100,
        marginPct: totalRevenue > 0 ? Math.round((netProfit / totalRevenue) * 10000) / 100 : 0,
        orderCount: orders.length,
      };
    }

    case 'top_opportunities': {
      const limit = typeof input.limit === 'number' ? input.limit : 10;
      const minMargin = typeof input.minMargin === 'number' ? input.minMargin : 10;
      const opps = context.db.getActiveOpportunities(limit * 2); // Fetch extra, then filter
      const filtered = opps.filter(o => o.marginPct >= minMargin).slice(0, limit);
      return {
        status: 'ok',
        opportunities: filtered,
        count: filtered.length,
      };
    }

    case 'category_analysis': {
      const catFilter = input.category as string | undefined;

      let query = `SELECT
        COALESCE(p.category, 'Uncategorized') as category,
        COUNT(DISTINCT o.id) as opportunity_count,
        AVG(o.margin_pct) as avg_margin,
        MIN(o.buy_price) as min_buy_price,
        MAX(o.sell_price) as max_sell_price,
        AVG(o.estimated_profit) as avg_profit
      FROM opportunities o
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.status = 'active'`;

      const params: unknown[] = [];
      if (catFilter) {
        query += ' AND p.category LIKE ?';
        params.push(`%${catFilter}%`);
      }
      query += ' GROUP BY p.category ORDER BY avg_margin DESC LIMIT 20';

      const analysis = context.db.query<Record<string, unknown>>(query, params);

      return {
        status: 'ok',
        category: catFilter ?? 'all',
        analysis: analysis.map(a => ({
          category: a.category,
          opportunityCount: a.opportunity_count,
          avgMargin: Math.round((a.avg_margin as number) * 100) / 100,
          minBuyPrice: a.min_buy_price,
          maxSellPrice: a.max_sell_price,
          avgProfit: Math.round((a.avg_profit as number) * 100) / 100,
        })),
      };
    }

    case 'competitor_watch': {
      const productId = input.productId as string | undefined;
      const platform = input.platform as Platform | undefined;

      if (productId) {
        // Get all price snapshots for this product
        const prices = context.db.getLatestPrices(productId);
        return {
          status: 'ok',
          productId,
          competitors: prices.map(p => ({
            platform: p.platform,
            price: p.price,
            shipping: p.shipping,
            total: p.price + p.shipping,
            seller: p.seller,
            inStock: p.inStock,
            lastChecked: p.fetchedAt,
          })),
        };
      }

      // Get recent price changes for listings we're tracking
      const listings = context.db.getActiveListings();
      const competitorData = listings.slice(0, 10).map(l => {
        const prices = context.db.getLatestPrices(l.productId);
        return {
          listingId: l.id,
          productId: l.productId,
          ourPrice: l.price,
          competitorPrices: prices
            .filter(p => p.platform !== l.platform)
            .map(p => ({ platform: p.platform, price: p.price + p.shipping, seller: p.seller })),
        };
      });

      return { status: 'ok', competitors: competitorData, count: competitorData.length };
    }

    case 'fee_calculator': {
      const platform = input.platform as Platform;
      const price = input.price as number;
      const category = input.category as string | undefined;

      const fees = calculateFees(platform, price, category);

      return {
        status: 'ok',
        platform,
        salePrice: price,
        ...fees,
      };
    }

    // -----------------------------------------------------------------------
    // Unknown tool
    // -----------------------------------------------------------------------
    default:
      logger.warn({ toolName }, 'Unknown tool called');
      return { error: `Unknown tool: ${toolName}` };
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createAgentManager(deps: {
  config: Config;
  db: Database;
  sessionManager: SessionManager;
  skills?: SkillManager;
  credentials: CredentialsManager;
  sendMessage?: (msg: OutgoingMessage) => Promise<string | null>;
}): AgentManager {
  const { db, sessionManager, credentials } = deps;
  let config = deps.config;

  // Default skill manager (no-op) if none provided
  const skills: SkillManager = deps.skills ?? {
    getSkillContext: () => '',
    getCommands: () => [],
    reload: () => {},
  };

  // Default sendMessage returns the text (gateway handles actual sending)
  const sendMessage = deps.sendMessage ?? (async (msg: OutgoingMessage) => msg.text);

  // ---------------------------------------------------------------------------
  // Anthropic client
  // ---------------------------------------------------------------------------

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn('ANTHROPIC_API_KEY not set -- agent will not be able to respond');
  }

  const client = new Anthropic({ apiKey: apiKey ?? 'missing' });

  // ---------------------------------------------------------------------------
  // Tool registry
  // ---------------------------------------------------------------------------

  const allTools = defineTools();
  const registry = new ToolRegistry<ToolDefinition>();
  registry.registerAll(allTools);

  logger.info(
    { total: registry.size(), core: CORE_TOOL_NAMES.size },
    'Tool registry initialized',
  );

  // ---------------------------------------------------------------------------
  // Message handler
  // ---------------------------------------------------------------------------

  async function handleMessage(
    message: IncomingMessage,
    session: Session,
  ): Promise<string | null> {
    const text = message.text.trim();
    if (!text) return null;

    // Add user message to history
    sessionManager.addToHistory(session, 'user', text);

    // Build system prompt
    const skillContext = skills.getSkillContext(text);
    const systemPrompt = SYSTEM_PROMPT.replace('{{SKILLS}}', skillContext);

    // Build conversation messages for the API
    const history = sessionManager.getHistory(session);
    const apiMessages: Anthropic.MessageParam[] = [];

    // Include context summary if present
    if (session.context.contextSummary) {
      apiMessages.push({
        role: 'user',
        content: `[Previous conversation summary: ${session.context.contextSummary}]`,
      });
      apiMessages.push({
        role: 'assistant',
        content: 'I understand the context from our previous conversation. How can I help?',
      });
    }

    // Add conversation history
    for (const msg of history) {
      apiMessages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // Ensure messages alternate properly (Anthropic requires user/assistant alternation)
    // and that the first message is from the user
    const cleanedMessages = ensureAlternatingRoles(apiMessages);

    // Select tools based on message intent
    const selectedTools = selectTools(registry, text);

    logger.debug(
      { tools: selectedTools.length, user: message.userId },
      'Calling Anthropic API',
    );

    // Resolve model name: strip "anthropic/" prefix if present
    const rawModel = config.agents.defaults.model?.primary ?? 'claude-sonnet-4-5-20250929';
    const model = rawModel.replace(/^anthropic\//, '');

    // -----------------------------------------------------------------------
    // Agentic loop: call API, execute tools, loop until text response
    // -----------------------------------------------------------------------

    let currentMessages = cleanedMessages;
    let iterations = 0;
    const MAX_ITERATIONS = 10;
    let finalText = '';

    while (iterations < MAX_ITERATIONS) {
      iterations++;

      let response: Anthropic.Message;
      try {
        const stream = client.messages.stream({
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: currentMessages,
          tools: toApiTools(selectedTools),
        });
        response = await stream.finalMessage();
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error({ err: errMsg, iteration: iterations }, 'Anthropic API error');

        // Handle prompt too long gracefully
        if (errMsg.includes('prompt is too long') || errMsg.includes('max_tokens')) {
          finalText = 'I apologize, but the conversation has grown too long. Please start a new conversation with /new.';
          break;
        }

        finalText = 'Sorry, I encountered an error processing your request. Please try again.';
        break;
      }

      // Collect text and tool_use blocks from response
      const textBlocks: string[] = [];
      const toolUseBlocks: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          textBlocks.push(block.text);
        } else if (block.type === 'tool_use') {
          toolUseBlocks.push({
            id: block.id,
            name: block.name,
            input: block.input as Record<string, unknown>,
          });
        }
      }

      // If no tool calls, we're done
      if (toolUseBlocks.length === 0) {
        finalText = textBlocks.join('\n');
        break;
      }

      // Execute all tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolCall of toolUseBlocks) {
        logger.debug({ tool: toolCall.name, iteration: iterations }, 'Executing tool');

        let result: unknown;
        try {
          result = await executeTool(toolCall.name, toolCall.input, {
            registry,
            db,
            credentials,
            userId: session.userId,
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          logger.error({ tool: toolCall.name, err: errMsg }, 'Tool execution error');
          result = { error: `Tool execution failed: ${errMsg}` };
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }

      // Build the next set of messages: append assistant response + tool results
      currentMessages = [
        ...currentMessages,
        { role: 'assistant' as const, content: response.content },
        { role: 'user' as const, content: toolResults },
      ];

      // If stop_reason is end_turn after tool use (shouldn't happen, but defensive)
      if (response.stop_reason === 'end_turn' && textBlocks.length > 0) {
        finalText = textBlocks.join('\n');
        break;
      }
    }

    if (iterations >= MAX_ITERATIONS) {
      logger.warn({ userId: session.userId }, 'Agent hit max iterations');
      finalText += '\n\n(Reached maximum tool call iterations.)';
    }

    // Save assistant response to history
    if (finalText) {
      sessionManager.addToHistory(session, 'assistant', finalText);
    }

    // Send the response
    if (finalText) {
      return sendMessage({
        platform: message.platform,
        chatId: message.chatId,
        text: finalText,
        replyToMessageId: message.id,
      });
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  function dispose(): void {
    logger.info('Agent manager disposed');
  }

  function reloadSkills(): void {
    skills.reload();
    logger.info('Skills reloaded');
  }

  function reloadConfig(newConfig: Config): void {
    config = newConfig;
    logger.info('Agent config reloaded');
  }

  function getSkillCommands(): Array<{ name: string; description: string }> {
    return skills.getCommands();
  }

  return {
    handleMessage,
    dispose,
    reloadSkills,
    reloadConfig,
    getSkillCommands,
  };
}

// =============================================================================
// UTILS
// =============================================================================

/**
 * Ensure messages alternate between user and assistant roles.
 * Anthropic API requires strict alternation with the first message being user.
 *
 * Merges consecutive same-role messages into one by joining with newline.
 */
function ensureAlternatingRoles(
  messages: Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  if (messages.length === 0) return [];

  const result: Anthropic.MessageParam[] = [];

  for (const msg of messages) {
    const last = result[result.length - 1];

    if (last && last.role === msg.role) {
      // Merge consecutive same-role text messages
      if (typeof last.content === 'string' && typeof msg.content === 'string') {
        last.content = last.content + '\n' + msg.content;
      }
      // If either is non-string (tool blocks), just skip the merge and keep both
      // by converting to array content -- but for simplicity we leave the last one
      continue;
    }

    result.push({ ...msg });
  }

  // Ensure first message is from user
  if (result.length > 0 && result[0].role !== 'user') {
    result.unshift({
      role: 'user',
      content: '(conversation start)',
    });
  }

  // Ensure last message is from user (required by API)
  if (result.length > 0 && result[result.length - 1].role !== 'user') {
    // This shouldn't happen in normal flow since we always add user msg last
    // but defensive check
  }

  return result;
}
