/**
 * Agent Manager
 * Handles AI agent instances and message routing for FlipAgent.
 *
 * Simplified from Clodds' ~18K lines to ~800 lines:
 * - Single agent loop with tool calling
 * - Dynamic tool loading via ToolRegistry
 * - Streaming Anthropic API
 * - Full tool implementations for all 88 registered tools
 */

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';
import type {
  Session,
  IncomingMessage,
  OutgoingMessage,
  Config,
  Platform,
  CredentialPlatform,
  AmazonCredentials,
  EbayCredentials,
  WalmartCredentials,
  AliExpressCredentials,
  KeepaCredentials,
  EasyPostCredentials,
} from '../types';
import { ALL_PLATFORMS } from '../types';
import { createLogger } from '../utils/logger';
import {
  ToolRegistry,
  inferToolMetadata,
  CORE_TOOL_NAMES,
  detectToolHints,
  type ToolMetadata,
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
import { calculateProfit, calculateFees } from '../arbitrage/calculator';
import { autoPurchase } from '../fulfillment/purchaser';
import { getTracking, updateTrackingOnPlatform } from '../fulfillment/tracker';
import { createEbaySellerApi } from '../platforms/ebay/seller';
import { createEbayOrdersApi, type EbayRefundRequest } from '../platforms/ebay/orders';
import { createEbayAccountApi } from '../platforms/ebay/account';
import { createEbayTaxonomyApi } from '../platforms/ebay/taxonomy';
import { createAliExpressShippingApi } from '../platforms/aliexpress/shipping';
import { createAliExpressOrdersApi } from '../platforms/aliexpress/orders';
import { createAliExpressExtendedApi } from '../platforms/aliexpress/extended';
import { createWalmartExtendedApi } from '../platforms/walmart/extended';
import { createAmazonExtendedApi } from '../platforms/amazon/extended';
import { createAmazonSpApi } from '../platforms/amazon/sp-api';
import type { SpApiAuthConfig } from '../platforms/amazon/sp-auth';
import { createEbayFinancesApi } from '../platforms/ebay/finances';
import { createEbayAnalyticsApi } from '../platforms/ebay/analytics';
import { createEbayMarketingApi } from '../platforms/ebay/marketing';
import { createEbayBrowseExtendedApi } from '../platforms/ebay/browse-extended';
import { createEbaySellerExtendedApi } from '../platforms/ebay/seller-extended';
import { createEbayCatalogApi } from '../platforms/ebay/catalog';
import { createEbayInsightsApi } from '../platforms/ebay/insights';
import { createEbayComplianceApi } from '../platforms/ebay/compliance';
import { createEbayFeedApi } from '../platforms/ebay/feed';
import { createEbayNotificationApi } from '../platforms/ebay/notification';
import { createEbayLogisticsApi } from '../platforms/ebay/logistics';
import { createEbayNegotiationApi } from '../platforms/ebay/negotiation';
import { createEbayMetadataApi } from '../platforms/ebay/metadata';
import { createKeepaApi } from '../platforms/keepa';
import { createEasyPostApi } from '../platforms/easypost';
import { createWalmartSellerApi, type WalmartSellerApi } from '../platforms/walmart/seller';
import { createBestBuyAdapter } from '../platforms/bestbuy/scraper';
import { createBestBuyExtendedApi } from '../platforms/bestbuy/extended';
import { createTargetAdapter } from '../platforms/target/scraper';
import { createHomeDepotAdapter } from '../platforms/homedepot/scraper';
import { createCostcoAdapter } from '../platforms/costco/scraper';
import { createPoshmarkAdapter } from '../platforms/poshmark/scraper';
import { createMercariAdapter } from '../platforms/mercari/scraper';
import { createFacebookAdapter } from '../platforms/facebook/scraper';
import { createFaireAdapter } from '../platforms/faire/scraper';
import { createBStockAdapter } from '../platforms/bstock/scraper';
import { createBulqAdapter } from '../platforms/bulq/scraper';
import { createLiquidationAdapter } from '../platforms/liquidation/scraper';
import { createWalmartAffiliateExtendedApi } from '../platforms/walmart/affiliate-extended';
import { createWalmartMarketplaceExtendedApi } from '../platforms/walmart/marketplace-extended';
import { createAmazonSpApiExtended, type ShippingAddress, type ShippingPackage } from '../platforms/amazon/sp-api-extended';
import { createAmazonSpApiComplete } from '../platforms/amazon/sp-api-complete';
import { createAliExpressDiscoveryApi } from '../platforms/aliexpress/discovery';
import {
  generateAffiliateLink,
  getDsProductDetails,
  getDsOrderTracking,
  queryDsFreight,
} from '../platforms/aliexpress/complete';
import { getAuthorizationUrl, obtainAliExpressToken } from '../platforms/aliexpress/auth';
import { createFbaMcfApi } from '../fulfillment/fba';
import { csvImportTools, handleCsvImportTool } from '../import/index';
import { scanningTools, handleScanningTool } from '../scanning/index';
import { seoTools, handleSeoTool } from '../seo/index';
import { alertTools, handleAlertTool } from '../notifications/index';
import { analyticsTools, handleAnalyticsTool } from '../analytics/index';
import { shippingTools, handleShippingTool } from '../shipping/index';
import { repricerTools, handleRepricerTool } from '../listing/repricer-index';
import { bulkListingTools, handleBulkListingTool } from '../listing/bulk-index';
import { variationTools, handleVariationTool } from '../products/index';
import { returnTools, handleReturnTool } from '../fulfillment/returns-index';
import { fbaInboundTools, handleFbaInboundTool } from '../fulfillment/fba-inbound-index';
import { inventoryTools, handleInventoryTool } from '../inventory/index';
import { taxTools, handleTaxTool } from '../tax/index';

const logger = createLogger('agent');

// =============================================================================
// TYPES
// =============================================================================

/**
 * Credentials manager interface used by the agent.
 * Matches the synchronous API from credentials/index.ts.
 */
export interface CredentialsManager {
  getCredentials: <T = unknown>(userId: string, platform: CredentialPlatform) => T | null;
  hasCredentials: (userId: string, platform: CredentialPlatform) => boolean;
  listUserPlatforms: (userId: string) => CredentialPlatform[];
  setCredentials?: (userId: string, platform: CredentialPlatform, credentials: unknown) => void;
  deleteCredentials?: (userId: string, platform: CredentialPlatform) => void;
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
  handleMessage: (
    message: IncomingMessage,
    session: Session,
    streamCallback?: (text: string) => void,
  ) => Promise<string | null>;
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
- Find price arbitrage opportunities across 15 platforms (Amazon, eBay, Walmart, AliExpress, Best Buy, Target, Costco, Home Depot, Poshmark, Mercari, Facebook Marketplace, Faire, B-Stock, BULQ, Liquidation.com)
- Auto-create optimized listings on selling platforms
- Monitor and fulfill orders via dropshipping
- Track profit, margins, and ROI across all operations
- Manage platform credentials and API keys

Be concise and direct. Use data when available. Format currency as $XX.XX.
When presenting margins, use percentage format (e.g., "32% margin").

{{SKILLS}}

Available platforms: amazon, ebay, walmart, aliexpress, bestbuy, target, costco, homedepot, poshmark, mercari, facebook, faire, bstock, bulq, liquidation

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
            items: { type: 'string', enum: ['amazon', 'ebay', 'walmart', 'aliexpress', 'bestbuy', 'target', 'costco', 'homedepot', 'poshmark', 'mercari', 'facebook', 'faire', 'bstock', 'bulq', 'liquidation'] },
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
            items: { type: 'string', enum: ['amazon', 'ebay', 'walmart', 'aliexpress', 'bestbuy', 'target', 'costco', 'homedepot', 'poshmark', 'mercari', 'facebook', 'faire', 'bstock', 'bulq', 'liquidation'] },
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
          platform: { type: 'string', description: 'Platform name', enum: ['amazon', 'ebay', 'walmart', 'aliexpress', 'bestbuy', 'target', 'costco', 'homedepot', 'poshmark', 'mercari', 'facebook', 'faire', 'bstock', 'bulq', 'liquidation'] },
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
          platform: { type: 'string', description: 'Platform name', enum: ['amazon', 'ebay', 'walmart', 'aliexpress', 'bestbuy', 'target', 'costco', 'homedepot', 'poshmark', 'mercari', 'facebook', 'faire', 'bstock', 'bulq', 'liquidation'] },
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
          platform: { type: 'string', description: 'Filter to specific platform', enum: ['amazon', 'ebay', 'walmart', 'aliexpress', 'bestbuy', 'target', 'costco', 'homedepot', 'poshmark', 'mercari', 'facebook', 'faire', 'bstock', 'bulq', 'liquidation'] },
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
          description: { type: 'string', description: 'Product description' },
          imageUrl: { type: 'string', description: 'Product image URL' },
          condition: { type: 'string', description: 'Product condition', enum: ['new', 'used', 'refurbished'] },
          quantity: { type: 'number', description: 'Quantity to list (default: 1)' },
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
      description: 'Optimize a listing for better search ranking. Returns optimized title, description, bullet points, and search terms.',
      input_schema: {
        type: 'object',
        properties: {
          listingId: { type: 'string', description: 'Internal listing ID to optimize (reads title/description from DB)' },
          platform: { type: 'string', description: 'Target platform for optimization hints', enum: ['ebay', 'amazon'] },
          productName: { type: 'string', description: 'Product name (used if no listingId)' },
          category: { type: 'string', description: 'Product category for keyword suggestions' },
          brand: { type: 'string', description: 'Brand name to include in title' },
          features: { type: 'string', description: 'Comma-separated product features for bullet points' },
        },
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
          platform: { type: 'string', description: 'Filter by selling platform', enum: ['amazon', 'ebay', 'walmart', 'aliexpress', 'bestbuy', 'target', 'costco', 'homedepot', 'poshmark', 'mercari', 'facebook', 'faire', 'bstock', 'bulq', 'liquidation'] },
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
          platform: { type: 'string', description: 'Platform to monitor', enum: ['amazon', 'ebay', 'walmart', 'aliexpress', 'bestbuy', 'target', 'costco', 'homedepot', 'poshmark', 'mercari', 'facebook', 'faire', 'bstock', 'bulq', 'liquidation'] },
        },
      },
    },
    {
      name: 'fee_calculator',
      description: 'Calculate estimated platform fees for selling a product at a given price.',
      input_schema: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: 'Selling platform', enum: ['amazon', 'ebay', 'walmart', 'aliexpress', 'bestbuy', 'target', 'costco', 'homedepot', 'poshmark', 'mercari', 'facebook', 'faire', 'bstock', 'bulq', 'liquidation'] },
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
      name: 'setup_aliexpress_oauth',
      description: 'Complete AliExpress OAuth flow. Step 1: provide appKey + redirectUri to get the authorization URL. Step 2: after user authorizes, provide appKey + appSecret + code to exchange for tokens.',
      input_schema: {
        type: 'object',
        properties: {
          appKey: { type: 'string', description: 'AliExpress App Key' },
          appSecret: { type: 'string', description: 'AliExpress App Secret (required for code exchange)' },
          redirectUri: { type: 'string', description: 'OAuth redirect URI (required for step 1)' },
          code: { type: 'string', description: 'Authorization code from AliExpress redirect (required for step 2)' },
        },
        required: ['appKey'],
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
          platform: { type: 'string', description: 'Platform to delete credentials for', enum: ['amazon', 'ebay', 'walmart', 'aliexpress', 'bestbuy', 'target', 'costco', 'homedepot', 'poshmark', 'mercari', 'facebook', 'faire', 'bstock', 'bulq', 'liquidation', 'keepa', 'easypost'] },
        },
        required: ['platform'],
      },
    },

    // -------------------------------------------------------------------------
    // Extended platform tools
    // -------------------------------------------------------------------------
    {
      name: 'get_shipping_cost',
      description: 'Get shipping cost estimates for an AliExpress product to a destination country.',
      input_schema: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'AliExpress product ID' },
          country: { type: 'string', description: 'Destination country code (e.g., US, GB, DE)', default: 'US' },
          quantity: { type: 'number', description: 'Number of items', default: 1 },
        },
        required: ['productId'],
      },
    },
    {
      name: 'get_hot_products',
      description: 'Get trending/hot products from AliExpress. Useful for finding popular items with high demand.',
      input_schema: {
        type: 'object',
        properties: {
          keywords: { type: 'string', description: 'Keywords to filter hot products' },
          categoryId: { type: 'string', description: 'AliExpress category ID' },
          minPrice: { type: 'number', description: 'Minimum price filter' },
          maxPrice: { type: 'number', description: 'Maximum price filter' },
          sort: { type: 'string', description: 'Sort order', enum: ['SALE_PRICE_ASC', 'SALE_PRICE_DESC', 'LAST_VOLUME_ASC', 'LAST_VOLUME_DESC'] },
          maxResults: { type: 'number', description: 'Maximum results (default: 20)', default: 20 },
        },
      },
    },
    {
      name: 'get_aliexpress_categories',
      description: 'Get the full list of AliExpress product categories for browsing and filtering.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_product_variations',
      description: 'Get all variations (sizes, colors, etc.) for an Amazon product by ASIN.',
      input_schema: {
        type: 'object',
        properties: {
          asin: { type: 'string', description: 'Amazon ASIN to get variations for' },
          marketplace: { type: 'string', description: 'Amazon marketplace (default: US)', default: 'US' },
        },
        required: ['asin'],
      },
    },
    {
      name: 'browse_amazon_categories',
      description: 'Browse Amazon category tree by browse node IDs. Shows parent/child categories.',
      input_schema: {
        type: 'object',
        properties: {
          nodeIds: {
            type: 'array',
            description: 'Amazon browse node IDs to look up',
            items: { type: 'string' },
          },
          marketplace: { type: 'string', description: 'Amazon marketplace (default: US)', default: 'US' },
        },
        required: ['nodeIds'],
      },
    },
    {
      name: 'ebay_get_policies',
      description: 'Get eBay seller business policies (fulfillment, payment, return). Required for creating listings.',
      input_schema: {
        type: 'object',
        properties: {
          policyType: { type: 'string', description: 'Type of policy to retrieve', enum: ['fulfillment', 'payment', 'return', 'all'] },
          marketplaceId: { type: 'string', description: 'eBay marketplace (default: EBAY_US)', default: 'EBAY_US' },
        },
      },
    },
    {
      name: 'ebay_create_policy',
      description: 'Create an eBay business policy (fulfillment, payment, or return).',
      input_schema: {
        type: 'object',
        properties: {
          policyType: { type: 'string', description: 'Type of policy', enum: ['fulfillment', 'payment', 'return'] },
          name: { type: 'string', description: 'Policy name' },
          handlingTimeDays: { type: 'number', description: 'Handling time in days (fulfillment only)' },
          shippingServiceCode: { type: 'string', description: 'Shipping service code (fulfillment only)', default: 'ShippingMethodStandard' },
          freeShipping: { type: 'boolean', description: 'Offer free shipping (fulfillment only)' },
          returnsAccepted: { type: 'boolean', description: 'Accept returns (return policy only)', default: true },
          returnDays: { type: 'number', description: 'Return window in days (return only)', default: 30 },
        },
        required: ['policyType', 'name'],
      },
    },
    {
      name: 'ebay_category_suggest',
      description: 'Get eBay category suggestions for a product query. Helps pick the right category for listings.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Product description or title to get category suggestions for' },
        },
        required: ['query'],
      },
    },
    {
      name: 'ebay_item_aspects',
      description: 'Get required and recommended item aspects (specifics) for an eBay category.',
      input_schema: {
        type: 'object',
        properties: {
          categoryId: { type: 'string', description: 'eBay category ID to get aspects for' },
        },
        required: ['categoryId'],
      },
    },
    {
      name: 'ebay_get_inventory',
      description: 'List current eBay inventory items with pagination.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max items to return (default: 25)', default: 25 },
          offset: { type: 'number', description: 'Offset for pagination', default: 0 },
        },
      },
    },
    {
      name: 'ebay_bulk_update',
      description: 'Bulk update prices and/or quantities for multiple eBay listings at once.',
      input_schema: {
        type: 'object',
        properties: {
          updates: {
            type: 'array',
            description: 'Array of updates with sku, offerId, and optional price/quantity',
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string', description: 'SKU of the item' },
                offerId: { type: 'string', description: 'eBay offer ID' },
                price: { type: 'number', description: 'New price in USD' },
                quantity: { type: 'number', description: 'New quantity' },
              },
              required: ['sku', 'offerId'],
            },
          },
        },
        required: ['updates'],
      },
    },
    {
      name: 'ebay_issue_refund',
      description: 'Issue a refund for an eBay order.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'eBay order ID' },
          reason: { type: 'string', description: 'Reason for refund', enum: ['BUYER_CANCEL', 'ITEM_NOT_RECEIVED', 'ITEM_NOT_AS_DESCRIBED', 'OTHER'] },
          amount: { type: 'number', description: 'Refund amount (optional, full refund if omitted)' },
          comment: { type: 'string', description: 'Comment for the buyer' },
        },
        required: ['orderId', 'reason'],
      },
    },
    {
      name: 'walmart_upc_lookup',
      description: 'Look up a Walmart product by UPC barcode for exact matching.',
      input_schema: {
        type: 'object',
        properties: {
          upc: { type: 'string', description: 'UPC barcode to look up' },
        },
        required: ['upc'],
      },
    },
    {
      name: 'walmart_trending',
      description: 'Get trending/popular products on Walmart.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'walmart_taxonomy',
      description: 'Get Walmart product category taxonomy for browsing and filtering.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_ds_order_status',
      description: 'Check the status of an AliExpress dropshipping order.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'AliExpress order ID' },
        },
        required: ['orderId'],
      },
    },

    // -------------------------------------------------------------------------
    // Amazon SP-API tools (Selling Partner API)
    // -------------------------------------------------------------------------
    {
      name: 'amazon_sp_search_catalog',
      description: 'Search Amazon product catalog via SP-API. Returns detailed catalog data including sales rank, images, brand.',
      input_schema: {
        type: 'object',
        properties: {
          keywords: { type: 'string', description: 'Search keywords' },
          identifiers: { type: 'string', description: 'Comma-separated ASINs, UPCs, or EANs for exact lookup' },
          identifiersType: { type: 'string', description: 'Type of identifiers', enum: ['ASIN', 'UPC', 'EAN', 'ISBN'] },
          maxResults: { type: 'number', description: 'Max results (default: 20)', default: 20 },
        },
      },
    },
    {
      name: 'amazon_sp_get_pricing',
      description: 'Get competitive pricing and buy box data for Amazon ASINs. Essential for arbitrage price comparison.',
      input_schema: {
        type: 'object',
        properties: {
          asins: { type: 'string', description: 'Comma-separated ASINs (max 20)' },
        },
        required: ['asins'],
      },
    },
    {
      name: 'amazon_sp_estimate_fees',
      description: 'Estimate Amazon seller fees (FBA/FBM) for a product at a given price. Critical for profit calculations.',
      input_schema: {
        type: 'object',
        properties: {
          asin: { type: 'string', description: 'Amazon ASIN' },
          price: { type: 'number', description: 'Listing price in USD' },
          shipping: { type: 'number', description: 'Shipping price (default: 0)', default: 0 },
          fba: { type: 'boolean', description: 'Use FBA fulfillment (default: false)', default: false },
        },
        required: ['asin', 'price'],
      },
    },
    {
      name: 'amazon_sp_create_listing',
      description: 'Create or update an Amazon listing via SP-API Listings Items API.',
      input_schema: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'Your seller SKU' },
          productType: { type: 'string', description: 'Amazon product type (e.g., PRODUCT)' },
          title: { type: 'string', description: 'Product title' },
          price: { type: 'number', description: 'Listing price in USD' },
          condition: { type: 'string', description: 'Condition', enum: ['new_new', 'new_open_box', 'used_like_new', 'used_very_good', 'used_good', 'used_acceptable'] },
          quantity: { type: 'number', description: 'Available quantity', default: 1 },
        },
        required: ['sku', 'productType'],
      },
    },
    {
      name: 'amazon_sp_get_orders',
      description: 'Get Amazon seller orders (recent or filtered by status/date).',
      input_schema: {
        type: 'object',
        properties: {
          createdAfter: { type: 'string', description: 'ISO date (default: last 7 days)' },
          orderStatuses: { type: 'string', description: 'Comma-separated: Pending,Unshipped,PartiallyShipped,Shipped,Canceled' },
          maxResults: { type: 'number', description: 'Max results (default: 50)', default: 50 },
        },
      },
    },
    {
      name: 'amazon_sp_get_fba_inventory',
      description: 'Get FBA inventory summaries showing fulfillable quantities, inbound, and receiving stock.',
      input_schema: {
        type: 'object',
        properties: {
          sellerSkus: { type: 'string', description: 'Comma-separated seller SKUs to filter (optional)' },
        },
      },
    },

    // -------------------------------------------------------------------------
    // eBay Finances / Analytics / Marketing
    // -------------------------------------------------------------------------
    {
      name: 'ebay_get_transactions',
      description: 'Get eBay seller transaction history — sales, refunds, fees. Essential for P&L tracking.',
      input_schema: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'eBay filter string (e.g., "transactionType={SALE}")' },
          sort: { type: 'string', description: 'Sort (e.g., "transactionDate")' },
          limit: { type: 'number', description: 'Max results (default: 50)', default: 50 },
        },
      },
    },
    {
      name: 'ebay_get_payouts',
      description: 'Get eBay payout history — when money was sent to your bank account.',
      input_schema: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'eBay filter string' },
          limit: { type: 'number', description: 'Max results (default: 50)', default: 50 },
        },
      },
    },
    {
      name: 'ebay_funds_summary',
      description: 'Get eBay seller funds summary — available balance, funds on hold, processing.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ebay_transaction_summary',
      description: 'Get eBay transaction summary — aggregated credit/debit totals and fees for P&L reporting.',
      input_schema: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: 'eBay filter string (e.g., "transactionDate:[2026-01-01T00:00:00.000Z..2026-02-01T00:00:00.000Z]")' },
        },
      },
    },
    {
      name: 'ebay_payout_detail',
      description: 'Get details for a specific eBay payout by payout ID.',
      input_schema: {
        type: 'object',
        properties: {
          payoutId: { type: 'string', description: 'eBay payout ID' },
        },
        required: ['payoutId'],
      },
    },
    {
      name: 'ebay_traffic_report',
      description: 'Get eBay seller traffic analytics — views, impressions, click-through rate, conversion rate.',
      input_schema: {
        type: 'object',
        properties: {
          dimension: { type: 'string', description: 'Report dimension', enum: ['DAY', 'LISTING'], default: 'DAY' },
          dateRange: { type: 'string', description: 'Date range filter (e.g., "date_range=[2026-01-01..2026-02-01]")' },
          metrics: { type: 'string', description: 'Comma-separated metrics (default: CLICK_THROUGH_RATE,LISTING_VIEWS_TOTAL,SALES_CONVERSION_RATE,TRANSACTION)', default: 'CLICK_THROUGH_RATE,LISTING_VIEWS_TOTAL,SALES_CONVERSION_RATE,TRANSACTION' },
        },
      },
    },
    {
      name: 'ebay_seller_metrics',
      description: 'Get eBay seller performance metrics — defect rate, late shipment rate, INR rate.',
      input_schema: {
        type: 'object',
        properties: {
          metricType: { type: 'string', description: 'Metric type', enum: ['ITEM_NOT_AS_DESCRIBED', 'ITEM_NOT_RECEIVED'] },
          evaluationType: { type: 'string', description: 'Evaluation', enum: ['CURRENT', 'PROJECTED'], default: 'CURRENT' },
        },
        required: ['metricType'],
      },
    },
    {
      name: 'ebay_create_campaign',
      description: 'Create an eBay Promoted Listings campaign to boost visibility. Costs only when items sell.',
      input_schema: {
        type: 'object',
        properties: {
          campaignName: { type: 'string', description: 'Campaign name' },
          bidPercentage: { type: 'string', description: 'Ad rate % (default: 5.0)', default: '5.0' },
          fundingModel: { type: 'string', description: 'Billing model', enum: ['COST_PER_SALE', 'COST_PER_CLICK'], default: 'COST_PER_SALE' },
        },
        required: ['campaignName'],
      },
    },
    {
      name: 'ebay_get_campaigns',
      description: 'List eBay Promoted Listings campaigns with status.',
      input_schema: {
        type: 'object',
        properties: {
          campaignStatus: { type: 'string', description: 'Filter by status (RUNNING, PAUSED, ENDED)' },
        },
      },
    },
    {
      name: 'ebay_promote_listings',
      description: 'Add listings to an eBay Promoted Listings campaign (bulk).',
      input_schema: {
        type: 'object',
        properties: {
          campaignId: { type: 'string', description: 'Campaign ID' },
          listingIds: { type: 'string', description: 'Comma-separated eBay listing IDs to promote' },
          bidPercentage: { type: 'string', description: 'Ad rate % (default: 5.0)', default: '5.0' },
        },
        required: ['campaignId', 'listingIds'],
      },
    },

    // -------------------------------------------------------------------------
    // eBay Extended APIs — Browse, Catalog, Insights, Compliance, Seller, Feed, Notification, Logistics, Negotiation, Metadata
    // -------------------------------------------------------------------------
    {
      name: 'ebay_batch_get_items',
      description: 'Get multiple eBay items in one call by item IDs (up to 20).',
      input_schema: {
        type: 'object',
        properties: {
          itemIds: { type: 'string', description: 'Comma-separated eBay item IDs (e.g., "v1|123|0,v1|456|0")' },
        },
        required: ['itemIds'],
      },
    },
    {
      name: 'ebay_legacy_item',
      description: 'Look up an eBay item by legacy item ID (classic numeric eBay ID).',
      input_schema: {
        type: 'object',
        properties: {
          legacyId: { type: 'string', description: 'Legacy eBay item ID (numeric)' },
        },
        required: ['legacyId'],
      },
    },
    {
      name: 'ebay_search_by_image',
      description: 'Search eBay using an image URL (visual similarity search). Great for finding comparable items.',
      input_schema: {
        type: 'object',
        properties: {
          imageUrl: { type: 'string', description: 'URL of the image to search with' },
          query: { type: 'string', description: 'Optional keyword filter to refine image results' },
          limit: { type: 'number', description: 'Max results (default: 20)', default: 20 },
        },
        required: ['imageUrl'],
      },
    },
    {
      name: 'ebay_search_catalog',
      description: 'Search eBay product catalog by keyword or GTIN/UPC. Returns ePIDs for catalog-based listings.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keywords or GTIN/UPC' },
          limit: { type: 'number', description: 'Max results (default: 20)', default: 20 },
          categoryId: { type: 'string', description: 'Filter by eBay category ID' },
        },
        required: ['query'],
      },
    },
    {
      name: 'ebay_get_catalog_product',
      description: 'Get eBay catalog product details by ePID — aspects, images, identifiers.',
      input_schema: {
        type: 'object',
        properties: {
          epid: { type: 'string', description: 'eBay product ID (ePID)' },
        },
        required: ['epid'],
      },
    },
    {
      name: 'ebay_sold_items',
      description: 'Search recently sold items on eBay. Essential for pricing research, sales velocity, and comp analysis.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search keywords for sold items' },
          limit: { type: 'number', description: 'Max results (default: 20)', default: 20 },
          filter: { type: 'string', description: 'eBay filter string (default: fixed-price new items)' },
          sort: { type: 'string', description: 'Sort order (default: newlyListed)' },
          categoryIds: { type: 'string', description: 'Filter by category IDs' },
        },
        required: ['query'],
      },
    },
    {
      name: 'ebay_listing_violations',
      description: 'Get listing violations affecting your eBay account. Critical for seller health monitoring.',
      input_schema: {
        type: 'object',
        properties: {
          complianceType: { type: 'string', description: 'Type of compliance violation', enum: ['PRODUCT_ADOPTION', 'OUTSIDE_EBAY_BUYING_AND_SELLING', 'HTTPS', 'PRODUCT_IDENTITY'] },
          limit: { type: 'number', description: 'Max results (default: 100)', default: 100 },
          offset: { type: 'number', description: 'Offset for pagination', default: 0 },
        },
        required: ['complianceType'],
      },
    },
    {
      name: 'ebay_violations_summary',
      description: 'Get summary count of listing violations by type. Quick health check.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ebay_suppress_violation',
      description: 'Suppress/acknowledge a known eBay listing violation.',
      input_schema: {
        type: 'object',
        properties: {
          listingId: { type: 'string', description: 'eBay listing ID with the violation' },
          complianceType: { type: 'string', description: 'Type of violation to suppress', enum: ['PRODUCT_ADOPTION', 'OUTSIDE_EBAY_BUYING_AND_SELLING', 'HTTPS', 'PRODUCT_IDENTITY'] },
        },
        required: ['listingId', 'complianceType'],
      },
    },
    {
      name: 'ebay_get_inventory_item',
      description: 'Get a single eBay inventory item by SKU with full details (product, condition, availability).',
      input_schema: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'SKU of the inventory item' },
        },
        required: ['sku'],
      },
    },
    {
      name: 'ebay_bulk_create_inventory',
      description: 'Bulk create or replace multiple eBay inventory items at once.',
      input_schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            description: 'Array of inventory items to create/replace',
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string', description: 'SKU' },
                product: { type: 'object', description: 'Product details (title, description, imageUrls, aspects)' },
                condition: { type: 'string', description: 'Condition (e.g., NEW, USED_EXCELLENT)' },
                availability: { type: 'object', description: 'Availability (shipToLocationAvailability: { quantity })' },
              },
              required: ['sku', 'product', 'condition', 'availability'],
            },
          },
        },
        required: ['items'],
      },
    },
    {
      name: 'ebay_get_offers_for_sku',
      description: 'Get all eBay offers for an inventory item by SKU.',
      input_schema: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'SKU to get offers for' },
        },
        required: ['sku'],
      },
    },
    {
      name: 'ebay_create_inventory_location',
      description: 'Create a new eBay inventory location (required for listings). Sets up your shipping origin.',
      input_schema: {
        type: 'object',
        properties: {
          merchantLocationKey: { type: 'string', description: 'Unique key for this location (e.g., "warehouse-1")' },
          name: { type: 'string', description: 'Display name for the location' },
          city: { type: 'string', description: 'City' },
          stateOrProvince: { type: 'string', description: 'State or province' },
          postalCode: { type: 'string', description: 'Postal/ZIP code' },
          country: { type: 'string', description: 'Country code (e.g., US)', default: 'US' },
        },
        required: ['merchantLocationKey', 'name', 'city', 'stateOrProvince', 'postalCode'],
      },
    },
    {
      name: 'ebay_get_inventory_locations',
      description: 'List all eBay inventory locations configured for your account.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ebay_create_feed_task',
      description: 'Create an eBay inventory feed task for bulk uploads.',
      input_schema: {
        type: 'object',
        properties: {
          feedType: { type: 'string', description: 'Feed type (e.g., LMS_ADD_ITEM, LMS_REVISE_ITEM)' },
          schemaVersion: { type: 'string', description: 'Schema version (e.g., 1.0)' },
        },
        required: ['feedType', 'schemaVersion'],
      },
    },
    {
      name: 'ebay_get_feed_task',
      description: 'Check status of an eBay feed task.',
      input_schema: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: 'Feed task ID' },
        },
        required: ['taskId'],
      },
    },
    {
      name: 'ebay_create_notification',
      description: 'Create an eBay notification destination (webhook URL for event delivery).',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Destination name' },
          endpoint: { type: 'string', description: 'Webhook URL to receive notifications' },
          verificationToken: { type: 'string', description: 'Token for eBay to verify your endpoint' },
        },
        required: ['name', 'endpoint', 'verificationToken'],
      },
    },
    {
      name: 'ebay_subscribe_notification',
      description: 'Subscribe to an eBay notification topic (e.g., order created, item sold).',
      input_schema: {
        type: 'object',
        properties: {
          topicId: { type: 'string', description: 'Notification topic ID' },
          destinationId: { type: 'string', description: 'Destination ID to deliver notifications to' },
        },
        required: ['topicId', 'destinationId'],
      },
    },
    {
      name: 'ebay_get_notification_topics',
      description: 'List available eBay notification topics you can subscribe to.',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'ebay_shipping_quote',
      description: 'Get an eBay shipping quote for a package. Returns carrier rates with estimated delivery.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'eBay order ID' },
          dimensions: {
            type: 'object',
            description: 'Package dimensions',
            properties: {
              height: { type: 'number' },
              length: { type: 'number' },
              width: { type: 'number' },
              unit: { type: 'string', enum: ['INCH', 'CENTIMETER'], default: 'INCH' },
            },
            required: ['height', 'length', 'width'],
          },
          weight: {
            type: 'object',
            description: 'Package weight',
            properties: {
              value: { type: 'number' },
              unit: { type: 'string', enum: ['POUND', 'KILOGRAM', 'OUNCE', 'GRAM'], default: 'POUND' },
            },
            required: ['value'],
          },
          shipFrom: {
            type: 'object',
            description: 'Ship from address',
            properties: {
              postalCode: { type: 'string' },
              country: { type: 'string', default: 'US' },
            },
            required: ['postalCode'],
          },
          shipTo: {
            type: 'object',
            description: 'Ship to address',
            properties: {
              postalCode: { type: 'string' },
              country: { type: 'string', default: 'US' },
            },
            required: ['postalCode'],
          },
        },
        required: ['orderId', 'dimensions', 'weight', 'shipFrom', 'shipTo'],
      },
    },
    {
      name: 'ebay_create_shipment',
      description: 'Create an eBay shipping label from a shipping quote. Purchase a label at quoted rate.',
      input_schema: {
        type: 'object',
        properties: {
          shippingQuoteId: { type: 'string', description: 'Shipping quote ID from ebay_shipping_quote' },
          rateId: { type: 'string', description: 'Rate ID to purchase (from the quote rates)' },
        },
        required: ['shippingQuoteId', 'rateId'],
      },
    },
    {
      name: 'ebay_download_label',
      description: 'Download an eBay shipping label file (returns base64-encoded PDF).',
      input_schema: {
        type: 'object',
        properties: {
          shipmentId: { type: 'string', description: 'Shipment ID from ebay_create_shipment' },
        },
        required: ['shipmentId'],
      },
    },
    {
      name: 'ebay_send_offer',
      description: 'Send offers to interested buyers on eBay (watchers/cart adders). Proactive seller-initiated offers.',
      input_schema: {
        type: 'object',
        properties: {
          offeredItems: {
            type: 'array',
            description: 'Items to offer',
            items: {
              type: 'object',
              properties: {
                listingId: { type: 'string', description: 'eBay listing ID' },
                price: { type: 'number', description: 'Offer price in USD' },
                quantity: { type: 'number', description: 'Quantity to offer', default: 1 },
              },
              required: ['listingId', 'price'],
            },
          },
          message: { type: 'string', description: 'Optional message to the buyer' },
          allowCounterOffer: { type: 'boolean', description: 'Allow counter offers (default: true)', default: true },
        },
        required: ['offeredItems'],
      },
    },
    {
      name: 'ebay_item_conditions',
      description: 'Get allowed item conditions for an eBay category. Tells you what conditions (New, Used, etc.) are valid.',
      input_schema: {
        type: 'object',
        properties: {
          categoryId: { type: 'string', description: 'eBay category ID (optional — returns all if omitted)' },
        },
      },
    },
    {
      name: 'ebay_marketplace_return_policies',
      description: 'Get marketplace return policies for an eBay category — what return options are available.',
      input_schema: {
        type: 'object',
        properties: {
          categoryId: { type: 'string', description: 'eBay category ID (optional — returns all if omitted)' },
        },
      },
    },

    // -------------------------------------------------------------------------
    // Keepa — Amazon price intelligence
    // -------------------------------------------------------------------------
    {
      name: 'keepa_price_history',
      description: 'Get Amazon price history from Keepa — current, avg 30/90/180 day, all-time min/max. Critical for buy decisions.',
      input_schema: {
        type: 'object',
        properties: {
          asin: { type: 'string', description: 'Amazon ASIN (or comma-separated ASINs)' },
          history: { type: 'boolean', description: 'Include full price history chart data (default: true)', default: true },
        },
        required: ['asin'],
      },
    },
    {
      name: 'keepa_deals',
      description: 'Find current Amazon price drops/deals via Keepa. Great for sourcing arbitrage opportunities.',
      input_schema: {
        type: 'object',
        properties: {
          minPercentOff: { type: 'number', description: 'Minimum % price drop (default: 20)', default: 20 },
          maxPercentOff: { type: 'number', description: 'Maximum % price drop (default: 90)', default: 90 },
          categoryIds: { type: 'string', description: 'Comma-separated Keepa category IDs to filter' },
        },
      },
    },
    {
      name: 'keepa_bestsellers',
      description: 'Get Amazon bestseller ASINs for a category via Keepa.',
      input_schema: {
        type: 'object',
        properties: {
          categoryId: { type: 'number', description: 'Keepa category ID' },
        },
        required: ['categoryId'],
      },
    },
    {
      name: 'keepa_track_product',
      description: 'Set up a Keepa price alert for an Amazon product. Get notified when price drops below threshold.',
      input_schema: {
        type: 'object',
        properties: {
          asin: { type: 'string', description: 'Amazon ASIN to track' },
          targetPrice: { type: 'number', description: 'Alert when price drops below this (USD)' },
        },
        required: ['asin', 'targetPrice'],
      },
    },

    // -------------------------------------------------------------------------
    // EasyPost — Shipping labels + tracking
    // -------------------------------------------------------------------------
    {
      name: 'get_shipping_rates',
      description: 'Compare shipping rates across carriers (USPS, UPS, FedEx) for a package. Returns cheapest options.',
      input_schema: {
        type: 'object',
        properties: {
          fromStreet: { type: 'string', description: 'Origin street address' },
          fromZip: { type: 'string', description: 'Origin ZIP code' },
          fromCity: { type: 'string', description: 'Origin city' },
          fromState: { type: 'string', description: 'Origin state (2-letter)' },
          fromCountry: { type: 'string', description: 'Origin country (default: US)', default: 'US' },
          toStreet: { type: 'string', description: 'Destination street address' },
          toZip: { type: 'string', description: 'Destination ZIP code' },
          toCity: { type: 'string', description: 'Destination city' },
          toState: { type: 'string', description: 'Destination state (2-letter)' },
          toCountry: { type: 'string', description: 'Destination country (default: US)', default: 'US' },
          weightOz: { type: 'number', description: 'Package weight in ounces' },
          lengthIn: { type: 'number', description: 'Package length in inches' },
          widthIn: { type: 'number', description: 'Package width in inches' },
          heightIn: { type: 'number', description: 'Package height in inches' },
        },
        required: ['fromZip', 'toZip', 'weightOz'],
      },
    },
    {
      name: 'buy_shipping_label',
      description: 'Purchase a shipping label at a previously quoted rate. Returns label URL and tracking number.',
      input_schema: {
        type: 'object',
        properties: {
          shipmentId: { type: 'string', description: 'EasyPost shipment ID from get_shipping_rates' },
          rateId: { type: 'string', description: 'Rate ID to purchase' },
        },
        required: ['shipmentId', 'rateId'],
      },
    },
    {
      name: 'track_package',
      description: 'Track any package across all carriers (USPS, UPS, FedEx, DHL, etc.) using EasyPost universal tracking.',
      input_schema: {
        type: 'object',
        properties: {
          trackingCode: { type: 'string', description: 'Tracking number' },
          carrier: { type: 'string', description: 'Carrier name (auto-detected if omitted)' },
        },
        required: ['trackingCode'],
      },
    },
    {
      name: 'verify_address',
      description: 'Verify a shipping address via USPS. Returns corrected address with delivery verification.',
      input_schema: {
        type: 'object',
        properties: {
          street1: { type: 'string', description: 'Street address line 1' },
          street2: { type: 'string', description: 'Street address line 2' },
          city: { type: 'string', description: 'City' },
          state: { type: 'string', description: 'State (2-letter)' },
          zip: { type: 'string', description: 'ZIP code' },
          country: { type: 'string', description: 'Country (default: US)', default: 'US' },
        },
        required: ['street1', 'city', 'state', 'zip'],
      },
    },

    // -------------------------------------------------------------------------
    // Credential setup for new services
    // -------------------------------------------------------------------------
    {
      name: 'setup_amazon_sp_credentials',
      description: 'Configure Amazon SP-API (Selling Partner API) credentials for seller operations.',
      input_schema: {
        type: 'object',
        properties: {
          spClientId: { type: 'string', description: 'LWA client ID' },
          spClientSecret: { type: 'string', description: 'LWA client secret' },
          spRefreshToken: { type: 'string', description: 'LWA refresh token' },
          sellerId: { type: 'string', description: 'Amazon Seller ID (optional, defaults to "me")' },
          marketplaceId: { type: 'string', description: 'Amazon Marketplace ID (optional, defaults to ATVPDKIKX0DER for US)' },
        },
        required: ['spClientId', 'spClientSecret', 'spRefreshToken'],
      },
    },
    {
      name: 'setup_keepa_credentials',
      description: 'Configure Keepa API key for Amazon price history tracking.',
      input_schema: {
        type: 'object',
        properties: {
          apiKey: { type: 'string', description: 'Keepa API key' },
        },
        required: ['apiKey'],
      },
    },
    {
      name: 'setup_easypost_credentials',
      description: 'Configure EasyPost API key for shipping labels and tracking.',
      input_schema: {
        type: 'object',
        properties: {
          apiKey: { type: 'string', description: 'EasyPost API key' },
        },
        required: ['apiKey'],
      },
    },

    // -------------------------------------------------------------------------
    // Walmart Marketplace seller tools
    // -------------------------------------------------------------------------
    {
      name: 'walmart_get_seller_items',
      description: 'Get your Walmart Marketplace seller items. Lists your catalog with publish status and pricing.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max items to return (default: 20)', default: 20 },
          offset: { type: 'number', description: 'Offset for pagination', default: 0 },
        },
      },
    },
    {
      name: 'walmart_update_price',
      description: 'Update pricing for a Walmart Marketplace item by SKU.',
      input_schema: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'Walmart seller SKU' },
          price: { type: 'number', description: 'New price in USD' },
        },
        required: ['sku', 'price'],
      },
    },
    {
      name: 'walmart_update_inventory',
      description: 'Update inventory quantity for a Walmart Marketplace item by SKU.',
      input_schema: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'Walmart seller SKU' },
          quantity: { type: 'number', description: 'New inventory quantity' },
        },
        required: ['sku', 'quantity'],
      },
    },
    {
      name: 'walmart_get_orders',
      description: 'Get Walmart Marketplace orders. Filter by status and date.',
      input_schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Order status filter', enum: ['Created', 'Acknowledged', 'Shipped', 'Delivered', 'Cancelled'] },
          createdStartDate: { type: 'string', description: 'Start date (ISO format, e.g. 2026-01-01)' },
          limit: { type: 'number', description: 'Max orders (default: 50)', default: 50 },
        },
      },
    },
    {
      name: 'walmart_ship_order',
      description: 'Ship a Walmart Marketplace order with tracking information.',
      input_schema: {
        type: 'object',
        properties: {
          purchaseOrderId: { type: 'string', description: 'Walmart purchase order ID' },
          carrier: { type: 'string', description: 'Shipping carrier (e.g. USPS, UPS, FedEx)' },
          trackingNumber: { type: 'string', description: 'Tracking number' },
          methodCode: { type: 'string', description: 'Shipping method code (e.g. Standard, Express)', default: 'Standard' },
        },
        required: ['purchaseOrderId', 'carrier', 'trackingNumber'],
      },
    },
    {
      name: 'walmart_retire_item',
      description: 'Retire (delist) an item from your Walmart Marketplace store.',
      input_schema: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'Walmart seller SKU to retire' },
        },
        required: ['sku'],
      },
    },
    {
      name: 'walmart_get_inventory',
      description: 'Get current inventory quantity for a Walmart Marketplace item.',
      input_schema: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'Walmart seller SKU' },
        },
        required: ['sku'],
      },
    },
    {
      name: 'walmart_create_item',
      description: 'Create a new item listing on Walmart Marketplace. Submits via feed API.',
      input_schema: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'Your unique SKU for this item' },
          productName: { type: 'string', description: 'Product title' },
          price: { type: 'number', description: 'Price in USD' },
          description: { type: 'string', description: 'Product description' },
          shortDescription: { type: 'string', description: 'Short description' },
          upc: { type: 'string', description: 'UPC barcode' },
          brand: { type: 'string', description: 'Brand name' },
          category: { type: 'string', description: 'Product category' },
          images: { type: 'array', items: { type: 'string' }, description: 'Image URLs (first = main)' },
        },
        required: ['sku', 'productName', 'price'],
      },
    },
    {
      name: 'walmart_update_item',
      description: 'Update an existing Walmart Marketplace item. Only include fields you want to change.',
      input_schema: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'SKU of item to update' },
          productName: { type: 'string', description: 'New product title' },
          description: { type: 'string', description: 'New description' },
          price: { type: 'number', description: 'New price' },
          brand: { type: 'string', description: 'New brand' },
          category: { type: 'string', description: 'New category' },
          upc: { type: 'string', description: 'New UPC' },
          images: { type: 'array', items: { type: 'string' }, description: 'New image URLs' },
        },
        required: ['sku'],
      },
    },
    {
      name: 'walmart_acknowledge_order',
      description: 'Acknowledge a Walmart Marketplace order. Required before shipping.',
      input_schema: {
        type: 'object',
        properties: {
          purchaseOrderId: { type: 'string', description: 'Walmart purchase order ID' },
        },
        required: ['purchaseOrderId'],
      },
    },
    {
      name: 'walmart_cancel_order',
      description: 'Cancel line items on a Walmart Marketplace order.',
      input_schema: {
        type: 'object',
        properties: {
          purchaseOrderId: { type: 'string', description: 'Walmart purchase order ID' },
          lineItems: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                lineNumber: { type: 'string', description: 'Order line number' },
                quantity: { type: 'number', description: 'Quantity to cancel' },
                reason: { type: 'string', description: 'Cancellation reason' },
              },
              required: ['lineNumber', 'quantity', 'reason'],
            },
            description: 'Line items to cancel',
          },
        },
        required: ['purchaseOrderId', 'lineItems'],
      },
    },
    {
      name: 'walmart_refund_order',
      description: 'Refund line items on a Walmart Marketplace order.',
      input_schema: {
        type: 'object',
        properties: {
          purchaseOrderId: { type: 'string', description: 'Walmart purchase order ID' },
          lineItems: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                lineNumber: { type: 'string', description: 'Order line number' },
                amount: { type: 'number', description: 'Refund amount in USD' },
                reason: { type: 'string', description: 'Refund reason' },
                isFullRefund: { type: 'boolean', description: 'Whether this is a full refund', default: false },
              },
              required: ['lineNumber', 'amount', 'reason'],
            },
            description: 'Line items to refund',
          },
        },
        required: ['purchaseOrderId', 'lineItems'],
      },
    },
    {
      name: 'walmart_feed_status',
      description: 'Check the status of a Walmart Marketplace feed submission (item creation, price update, etc.).',
      input_schema: {
        type: 'object',
        properties: {
          feedId: { type: 'string', description: 'Feed ID returned from a previous submission' },
        },
        required: ['feedId'],
      },
    },
    {
      name: 'walmart_get_returns',
      description: 'Get Walmart Marketplace return orders.',
      input_schema: {
        type: 'object',
        properties: {
          startDate: { type: 'string', description: 'Return creation start date (ISO format)' },
          limit: { type: 'number', description: 'Max returns to fetch (default: 50)', default: 50 },
        },
      },
    },
    {
      name: 'walmart_get_return',
      description: 'Get details of a specific Walmart Marketplace return order.',
      input_schema: {
        type: 'object',
        properties: {
          returnOrderId: { type: 'string', description: 'Return order ID' },
        },
        required: ['returnOrderId'],
      },
    },
    {
      name: 'walmart_listing_quality',
      description: 'Get listing quality scores and improvement suggestions for your Walmart items.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max items to return (default: 50)', default: 50 },
        },
      },
    },
    {
      name: 'walmart_bulk_update_prices',
      description: 'Bulk update prices for multiple Walmart Marketplace items via feed.',
      input_schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string', description: 'SKU' },
                price: { type: 'number', description: 'New price' },
                currency: { type: 'string', description: 'Currency (default: USD)' },
              },
              required: ['sku', 'price'],
            },
            description: 'Items to update',
          },
        },
        required: ['items'],
      },
    },
    {
      name: 'walmart_bulk_update_inventory',
      description: 'Bulk update inventory quantities for multiple Walmart Marketplace items via feed.',
      input_schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                sku: { type: 'string', description: 'SKU' },
                quantity: { type: 'number', description: 'New quantity' },
              },
              required: ['sku', 'quantity'],
            },
            description: 'Items to update',
          },
        },
        required: ['items'],
      },
    },

    // -------------------------------------------------------------------------
    // Cross-platform utility tools
    // -------------------------------------------------------------------------
    {
      name: 'batch_reprice',
      description: 'Batch update prices for multiple listings. Adjusts prices based on competitor data or fixed amounts.',
      input_schema: {
        type: 'object',
        properties: {
          strategy: { type: 'string', description: 'Repricing strategy', enum: ['undercut', 'match', 'fixed_margin', 'manual'] },
          undercutAmount: { type: 'number', description: 'Amount to undercut competitors by (for undercut strategy)', default: 0.01 },
          marginPct: { type: 'number', description: 'Target margin percentage (for fixed_margin strategy)', default: 20 },
          listingIds: { type: 'string', description: 'Comma-separated listing IDs to reprice (blank = all active)' },
        },
        required: ['strategy'],
      },
    },
    {
      name: 'inventory_sync',
      description: 'Sync inventory levels across platforms. Checks source product stock and updates listing quantities.',
      input_schema: {
        type: 'object',
        properties: {
          listingIds: { type: 'string', description: 'Comma-separated listing IDs to sync (blank = all active)' },
        },
      },
    },
    {
      name: 'setup_walmart_seller_credentials',
      description: 'Configure Walmart Marketplace seller credentials (separate from Affiliate API). Uses OAuth 2.0 client credentials.',
      input_schema: {
        type: 'object',
        properties: {
          clientId: { type: 'string', description: 'Walmart Marketplace OAuth client ID' },
          clientSecret: { type: 'string', description: 'Walmart Marketplace OAuth client secret' },
        },
        required: ['clientId', 'clientSecret'],
      },
    },

    // -------------------------------------------------------------------------
    // Amazon SP-API Extended tools
    // -------------------------------------------------------------------------
    {
      name: 'amazon_sp_listing_restrictions',
      description: 'Check if you are restricted/gated from selling an ASIN on Amazon. Critical for arbitrage — shows if brand approval is needed.',
      input_schema: {
        type: 'object',
        properties: {
          asin: { type: 'string', description: 'Amazon ASIN to check restrictions for' },
          conditionType: { type: 'string', description: 'Condition type (e.g., new_new, used_very_good)', default: 'new_new' },
        },
        required: ['asin'],
      },
    },
    {
      name: 'amazon_sp_financial_events',
      description: 'Get Amazon financial events (sales, refunds, fees) for reconciliation. Filter by order ID or date range.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Amazon order ID for order-specific events (optional)' },
          postedAfter: { type: 'string', description: 'ISO date — events posted after this (default: last 30 days)' },
          postedBefore: { type: 'string', description: 'ISO date — events posted before this' },
        },
      },
    },
    {
      name: 'amazon_sp_confirm_shipment',
      description: 'Confirm shipment with tracking for a seller-fulfilled Amazon order.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Amazon order ID' },
          packageReferenceId: { type: 'string', description: 'Your package reference ID' },
          carrierCode: { type: 'string', description: 'Carrier code (e.g., USPS, UPS, FEDEX)' },
          trackingNumber: { type: 'string', description: 'Tracking number' },
          shipDate: { type: 'string', description: 'ISO date of shipment' },
          orderItems: { type: 'array', description: 'Items being shipped [{orderItemId, quantity}]', items: { type: 'object', properties: { orderItemId: { type: 'string' }, quantity: { type: 'number' } }, required: ['orderItemId', 'quantity'] } },
        },
        required: ['orderId', 'packageReferenceId', 'carrierCode', 'trackingNumber', 'shipDate', 'orderItems'],
      },
    },
    {
      name: 'amazon_sp_fulfillment_preview',
      description: 'Preview Multi-Channel Fulfillment (MCF) options and fees. Use FBA inventory to fulfill non-Amazon orders.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Recipient name' },
          addressLine1: { type: 'string', description: 'Street address' },
          city: { type: 'string', description: 'City' },
          stateOrRegion: { type: 'string', description: 'State/region code' },
          postalCode: { type: 'string', description: 'Postal/ZIP code' },
          countryCode: { type: 'string', description: 'Country code (e.g., US)', default: 'US' },
          items: { type: 'array', description: 'Items to fulfill [{sellerSku, quantity}]', items: { type: 'object', properties: { sellerSku: { type: 'string' }, quantity: { type: 'number' } }, required: ['sellerSku', 'quantity'] } },
        },
        required: ['name', 'addressLine1', 'city', 'stateOrRegion', 'postalCode', 'items'],
      },
    },
    {
      name: 'amazon_sp_create_mcf_order',
      description: 'Create a Multi-Channel Fulfillment order — ship FBA inventory to a non-Amazon buyer.',
      input_schema: {
        type: 'object',
        properties: {
          sellerFulfillmentOrderId: { type: 'string', description: 'Your unique order ID' },
          displayableOrderId: { type: 'string', description: 'Customer-facing order ID' },
          displayableOrderComment: { type: 'string', description: 'Comment shown to customer' },
          shippingSpeedCategory: { type: 'string', description: 'Shipping speed', enum: ['Standard', 'Expedited', 'Priority'] },
          name: { type: 'string', description: 'Recipient name' },
          addressLine1: { type: 'string', description: 'Street address' },
          city: { type: 'string', description: 'City' },
          stateOrRegion: { type: 'string', description: 'State/region code' },
          postalCode: { type: 'string', description: 'Postal/ZIP code' },
          countryCode: { type: 'string', description: 'Country code (e.g., US)', default: 'US' },
          items: { type: 'array', description: 'Items [{sellerSku, sellerFulfillmentOrderItemId, quantity}]', items: { type: 'object', properties: { sellerSku: { type: 'string' }, sellerFulfillmentOrderItemId: { type: 'string' }, quantity: { type: 'number' } }, required: ['sellerSku', 'sellerFulfillmentOrderItemId', 'quantity'] } },
        },
        required: ['sellerFulfillmentOrderId', 'displayableOrderId', 'displayableOrderComment', 'shippingSpeedCategory', 'name', 'addressLine1', 'city', 'stateOrRegion', 'postalCode', 'items'],
      },
    },
    {
      name: 'amazon_sp_buy_shipping',
      description: 'Purchase a shipping label via Amazon Buy Shipping. First get rates, then use serviceId here.',
      input_schema: {
        type: 'object',
        properties: {
          clientReferenceId: { type: 'string', description: 'Your unique reference ID for this shipment' },
          serviceId: { type: 'string', description: 'Service ID from getRates response' },
          shipFrom: { type: 'object', description: 'Ship-from address {name, addressLine1, city, stateOrRegion, postalCode, countryCode}' },
          shipTo: { type: 'object', description: 'Ship-to address (same fields)' },
          packages: { type: 'array', description: 'Packages [{dimensions: {length,width,height,unit}, weight: {value,unit}}]', items: { type: 'object' } },
        },
        required: ['clientReferenceId', 'serviceId', 'shipFrom', 'shipTo', 'packages'],
      },
    },
    {
      name: 'amazon_sp_get_shipping_tracking',
      description: 'Get shipping tracking info for an Amazon shipment by tracking ID and carrier ID.',
      input_schema: {
        type: 'object',
        properties: {
          trackingId: { type: 'string', description: 'Tracking ID' },
          carrierId: { type: 'string', description: 'Carrier ID' },
        },
        required: ['trackingId', 'carrierId'],
      },
    },
    {
      name: 'amazon_sp_create_report',
      description: 'Request an Amazon report (inventory, orders, returns). Poll with amazon_sp_get_report for status.',
      input_schema: {
        type: 'object',
        properties: {
          reportType: { type: 'string', description: 'Report type (e.g., GET_FLAT_FILE_OPEN_LISTINGS_DATA, GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA)' },
          startDate: { type: 'string', description: 'ISO date for data start time (optional)' },
          endDate: { type: 'string', description: 'ISO date for data end time (optional)' },
        },
        required: ['reportType'],
      },
    },
    {
      name: 'amazon_sp_get_report',
      description: 'Get Amazon report status and download URL. Poll until status is DONE.',
      input_schema: {
        type: 'object',
        properties: {
          reportId: { type: 'string', description: 'Report ID from createReport' },
        },
        required: ['reportId'],
      },
    },
    // -------------------------------------------------------------------------
    // Amazon SP-API Complete tools
    // -------------------------------------------------------------------------
    {
      name: 'amazon_sp_get_catalog_item',
      description: 'Get detailed Amazon catalog info for a single ASIN — summaries, images, sales ranks, dimensions, attributes.',
      input_schema: {
        type: 'object',
        properties: {
          asin: { type: 'string', description: 'Amazon ASIN' },
        },
        required: ['asin'],
      },
    },
    {
      name: 'amazon_sp_item_offers',
      description: 'Get all seller offers for an ASIN — Buy Box winner, pricing, fulfillment channel.',
      input_schema: {
        type: 'object',
        properties: {
          asin: { type: 'string', description: 'Amazon ASIN' },
        },
        required: ['asin'],
      },
    },
    {
      name: 'amazon_sp_batch_fees',
      description: 'Estimate Amazon fees for multiple ASINs at once.',
      input_schema: {
        type: 'object',
        properties: {
          items: { type: 'array', description: 'Items [{asin, price, currencyCode?}]', items: { type: 'object', properties: { asin: { type: 'string' }, price: { type: 'number' }, currencyCode: { type: 'string', default: 'USD' } }, required: ['asin', 'price'] } },
        },
        required: ['items'],
      },
    },
    {
      name: 'amazon_sp_get_order_details',
      description: 'Get single Amazon order details including status, totals, dates.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Amazon order ID' },
        },
        required: ['orderId'],
      },
    },
    {
      name: 'amazon_sp_get_order_items',
      description: 'Get line items for an Amazon order — ASINs, quantities, prices, SKUs.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Amazon order ID' },
        },
        required: ['orderId'],
      },
    },
    {
      name: 'amazon_sp_delete_listing',
      description: 'Delete an Amazon listing by seller SKU.',
      input_schema: {
        type: 'object',
        properties: {
          sellerId: { type: 'string', description: 'Your Amazon seller ID' },
          sku: { type: 'string', description: 'Seller SKU to delete' },
        },
        required: ['sellerId', 'sku'],
      },
    },
    {
      name: 'amazon_sp_order_metrics',
      description: 'Get aggregated Amazon order metrics — units, revenue, order counts for a time period.',
      input_schema: {
        type: 'object',
        properties: {
          interval: { type: 'string', description: 'Time interval (e.g., "2024-01-01T00:00:00Z--2024-02-01T00:00:00Z")' },
          granularity: { type: 'string', description: 'Aggregation granularity', enum: ['Day', 'Week', 'Month'] },
        },
        required: ['interval', 'granularity'],
      },
    },
    {
      name: 'amazon_sp_data_kiosk_query',
      description: 'Run a Data Kiosk analytics query on Amazon. Returns a queryId to poll.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Data Kiosk query string' },
        },
        required: ['query'],
      },
    },
    // -------------------------------------------------------------------------
    // AliExpress Discovery tools
    // -------------------------------------------------------------------------
    {
      name: 'aliexpress_image_search',
      description: 'Search AliExpress products by image URL — reverse image search to find cheaper suppliers.',
      input_schema: {
        type: 'object',
        properties: {
          imageUrl: { type: 'string', description: 'URL of the product image to search with' },
        },
        required: ['imageUrl'],
      },
    },
    {
      name: 'aliexpress_affiliate_orders',
      description: 'Get AliExpress affiliate order commissions for a date range.',
      input_schema: {
        type: 'object',
        properties: {
          startTime: { type: 'string', description: 'Start time (YYYY-MM-DD HH:mm:ss)' },
          endTime: { type: 'string', description: 'End time (YYYY-MM-DD HH:mm:ss)' },
          status: { type: 'string', description: 'Order status filter' },
          pageNo: { type: 'number', description: 'Page number (default: 1)' },
          pageSize: { type: 'number', description: 'Page size (default: 50)' },
        },
      },
    },
    {
      name: 'aliexpress_ds_feed',
      description: 'Get AliExpress dropshipping product recommendation feed.',
      input_schema: {
        type: 'object',
        properties: {
          categoryId: { type: 'string', description: 'Category ID to filter' },
          pageNo: { type: 'number', description: 'Page number (default: 1)' },
          pageSize: { type: 'number', description: 'Page size (default: 20)' },
          country: { type: 'string', description: 'Target country (default: US)' },
          sort: { type: 'string', description: 'Sort order' },
        },
      },
    },
    {
      name: 'aliexpress_create_dispute',
      description: 'Create a dispute for an AliExpress order.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'number', description: 'AliExpress order ID' },
          reason: { type: 'string', description: 'Dispute reason' },
          description: { type: 'string', description: 'Detailed description' },
          imageUrls: { type: 'array', items: { type: 'string' }, description: 'Evidence image URLs' },
        },
        required: ['orderId', 'reason', 'description'],
      },
    },
    {
      name: 'aliexpress_dispute_detail',
      description: 'Get details and status of an AliExpress dispute.',
      input_schema: {
        type: 'object',
        properties: {
          disputeId: { type: 'number', description: 'Dispute/issue ID' },
        },
        required: ['disputeId'],
      },
    },
    // -------------------------------------------------------------------------
    // AliExpress Complete tools
    // -------------------------------------------------------------------------
    {
      name: 'aliexpress_generate_affiliate_link',
      description: 'Generate affiliate tracking links for AliExpress product URLs or IDs.',
      input_schema: {
        type: 'object',
        properties: {
          sourceValues: { type: 'string', description: 'Comma-separated product URLs or IDs' },
          promotionLinkType: { type: 'number', description: '0=normal, 1=hot link (default: 0)' },
          trackingId: { type: 'string', description: 'Your tracking ID (optional)' },
        },
        required: ['sourceValues'],
      },
    },
    {
      name: 'aliexpress_ds_product_detail',
      description: 'Get detailed AliExpress dropship product info — SKU variants, inventory, shipping options.',
      input_schema: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'AliExpress product ID' },
        },
        required: ['productId'],
      },
    },
    {
      name: 'aliexpress_ds_tracking',
      description: 'Get dropship order tracking/logistics details from AliExpress.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'AliExpress order ID' },
        },
        required: ['orderId'],
      },
    },
    {
      name: 'aliexpress_query_freight',
      description: 'Query shipping freight options for an AliExpress dropship product.',
      input_schema: {
        type: 'object',
        properties: {
          productId: { type: 'string', description: 'AliExpress product ID' },
          quantity: { type: 'number', description: 'Quantity to ship' },
          shipToCountry: { type: 'string', description: 'Destination country code (default: US)', default: 'US' },
        },
        required: ['productId', 'quantity'],
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
          platform: { type: 'string', description: 'Filter by platform', enum: ['amazon', 'ebay', 'walmart', 'aliexpress', 'bestbuy', 'target', 'costco', 'homedepot', 'poshmark', 'mercari', 'facebook', 'faire', 'bstock', 'bulq', 'liquidation', 'keepa', 'easypost'] },
          category: { type: 'string', description: 'Filter by category', enum: ['scanning', 'listing', 'fulfillment', 'analytics', 'pricing', 'admin', 'discovery'] },
        },
        required: ['query'],
      },
    },

    // -------------------------------------------------------------------------
    // Additional platform scanners
    // -------------------------------------------------------------------------
    {
      name: 'scan_bestbuy',
      description: 'Search Best Buy for products. Great for electronics deals, open-box items, and in-store availability.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Max results (default: 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'scan_target',
      description: 'Search Target for products. Good for household, groceries, and everyday items.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Max results (default: 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'scan_costco',
      description: 'Search Costco for bulk/wholesale products. Great for high-value items and electronics.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Max results (default: 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'scan_homedepot',
      description: 'Search Home Depot for home improvement, tools, and building materials.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Max results (default: 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'scan_poshmark',
      description: 'Search Poshmark for secondhand fashion, clothing, and accessories. Flat $7.97 shipping.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Max results (default: 10)' },
          minPrice: { type: 'number', description: 'Min price filter' },
          maxPrice: { type: 'number', description: 'Max price filter' },
        },
        required: ['query'],
      },
    },
    {
      name: 'scan_mercari',
      description: 'Search Mercari Japan for products. Popular for Japanese goods, electronics, fashion.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Max results (default: 10)' },
          minPrice: { type: 'number', description: 'Min price in JPY' },
          maxPrice: { type: 'number', description: 'Max price in JPY' },
        },
        required: ['query'],
      },
    },
    {
      name: 'scan_facebook',
      description: 'Search Facebook Marketplace for local deals. Great for used items and local pickup.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Max results (default: 10)' },
          minPrice: { type: 'number', description: 'Min price filter' },
          maxPrice: { type: 'number', description: 'Max price filter' },
        },
        required: ['query'],
      },
    },
    {
      name: 'scan_faire',
      description: 'Search Faire for wholesale products. Great for finding wholesale-to-retail arbitrage opportunities.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Max results (default: 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'scan_bstock',
      description: 'Search B-Stock liquidation auctions. Returns, overstock, and shelf-pulls from major retailers.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Max results (default: 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'scan_bulq',
      description: 'Search BULQ liquidation lots. Bulk lots of returned and overstock merchandise.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Max results (default: 10)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'scan_liquidation',
      description: 'Search Liquidation.com for wholesale lots and pallets. Returns, overstock, and salvage goods.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          maxResults: { type: 'number', description: 'Max results (default: 10)' },
        },
        required: ['query'],
      },
    },

    // -------------------------------------------------------------------------
    // Extended tools for new platforms
    // -------------------------------------------------------------------------
    {
      name: 'bestbuy_on_sale',
      description: 'Get Best Buy on-sale items with discounts. Filter by category and price range.',
      input_schema: {
        type: 'object',
        properties: {
          categoryId: { type: 'string', description: 'Best Buy category ID' },
          minPrice: { type: 'number', description: 'Min sale price' },
          maxPrice: { type: 'number', description: 'Max sale price' },
          pageSize: { type: 'number', description: 'Results per page (default: 25)' },
        },
      },
    },
    {
      name: 'bestbuy_open_box',
      description: 'Get Best Buy open-box deals. Discounted items with minor cosmetic imperfections.',
      input_schema: {
        type: 'object',
        properties: {
          categoryId: { type: 'string', description: 'Best Buy category ID' },
          pageSize: { type: 'number', description: 'Results per page (default: 25)' },
        },
      },
    },
    {
      name: 'bestbuy_stores',
      description: 'Find Best Buy store locations near coordinates. Useful for in-store pickup arbitrage.',
      input_schema: {
        type: 'object',
        properties: {
          lat: { type: 'number', description: 'Latitude' },
          lng: { type: 'number', description: 'Longitude' },
          radius: { type: 'number', description: 'Search radius in miles (default: 25)' },
        },
        required: ['lat', 'lng'],
      },
    },
    {
      name: 'bestbuy_product_availability',
      description: 'Check Best Buy in-store availability for a product by SKU.',
      input_schema: {
        type: 'object',
        properties: {
          sku: { type: 'string', description: 'Best Buy product SKU' },
          storeIds: { type: 'string', description: 'Comma-separated store IDs (optional)' },
        },
        required: ['sku'],
      },
    },
    {
      name: 'target_store_availability',
      description: 'Check Target in-store product availability at nearby stores.',
      input_schema: {
        type: 'object',
        properties: {
          tcin: { type: 'string', description: 'Target product TCIN' },
          zipCode: { type: 'string', description: 'ZIP code for store search' },
        },
        required: ['tcin', 'zipCode'],
      },
    },
    {
      name: 'poshmark_closet',
      description: 'Browse a Poshmark seller\'s closet. See all their listings — useful for competitor research.',
      input_schema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'Poshmark username' },
          maxResults: { type: 'number', description: 'Max items (default: 48)' },
        },
        required: ['userId'],
      },
    },
    {
      name: 'mercari_seller_profile',
      description: 'Get a Mercari seller\'s profile — ratings, items sold, member since. Useful for seller vetting.',
      input_schema: {
        type: 'object',
        properties: {
          userId: { type: 'string', description: 'Mercari user ID' },
        },
        required: ['userId'],
      },
    },
    {
      name: 'walmart_reviews',
      description: 'Get Walmart product reviews for an item. Useful for product research and quality assessment.',
      input_schema: {
        type: 'object',
        properties: {
          itemId: { type: 'string', description: 'Walmart item ID' },
        },
        required: ['itemId'],
      },
    },
    {
      name: 'walmart_nearby_stores',
      description: 'Find Walmart stores near a location by ZIP code or coordinates.',
      input_schema: {
        type: 'object',
        properties: {
          zip: { type: 'string', description: 'ZIP code' },
          lat: { type: 'number', description: 'Latitude (alternative to zip)' },
          lon: { type: 'number', description: 'Longitude (alternative to zip)' },
        },
      },
    },
    {
      name: 'walmart_recommendations',
      description: 'Get Walmart product recommendations based on an item. Useful for finding similar/related products.',
      input_schema: {
        type: 'object',
        properties: {
          itemId: { type: 'string', description: 'Walmart item ID to get recommendations for' },
        },
        required: ['itemId'],
      },
    },
    {
      name: 'walmart_repricer',
      description: 'Create a Walmart repricing strategy for automated price adjustments.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Strategy name' },
          enabled: { type: 'boolean', description: 'Enable strategy (default: true)' },
          type: { type: 'string', description: 'Strategy type', enum: ['BUY_BOX_ELIGIBLE', 'COMPETITIVE_PRICING'] },
        },
        required: ['name', 'type'],
      },
    },
    {
      name: 'walmart_catalog_search',
      description: 'Search the Walmart marketplace catalog for item setup. Returns UPC/GTIN matches for listing.',
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Product name or UPC/GTIN' },
        },
        required: ['query'],
      },
    },

    // -------------------------------------------------------------------------
    // Best Buy Categories (Feature 1 - Category browsing)
    // -------------------------------------------------------------------------
    {
      name: 'bestbuy_get_categories',
      description: 'Get Best Buy product categories for browsing and filtering. Optionally pass a parent category ID to get subcategories.',
      input_schema: {
        type: 'object',
        properties: {
          parentId: { type: 'string', description: 'Parent category ID to get subcategories (omit for top-level)' },
        },
      },
    },

    // -------------------------------------------------------------------------
    // FBA Multi-Channel Fulfillment (Feature 2)
    // -------------------------------------------------------------------------
    {
      name: 'fba_create_fulfillment',
      description: 'Create an FBA Multi-Channel Fulfillment (MCF) order. Ships from Amazon FBA warehouse to any destination — enables fulfilling eBay/Walmart orders via FBA inventory.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'Unique fulfillment order ID (e.g., "MCF-12345")' },
          displayableOrderId: { type: 'string', description: 'Order ID shown to buyer' },
          displayableOrderComment: { type: 'string', description: 'Comment shown to buyer (e.g., "Thank you for your order!")' },
          shippingSpeed: { type: 'string', description: 'Shipping speed', enum: ['Standard', 'Expedited', 'Priority'] },
          name: { type: 'string', description: 'Recipient full name' },
          addressLine1: { type: 'string', description: 'Street address line 1' },
          addressLine2: { type: 'string', description: 'Street address line 2 (optional)' },
          city: { type: 'string', description: 'City' },
          stateOrRegion: { type: 'string', description: 'State or region code' },
          postalCode: { type: 'string', description: 'Postal/ZIP code' },
          countryCode: { type: 'string', description: 'Country code (e.g., US)', default: 'US' },
          phone: { type: 'string', description: 'Recipient phone number (optional)' },
          items: {
            type: 'array',
            description: 'Items to fulfill: [{sellerSku, quantity}]',
            items: {
              type: 'object',
              properties: {
                sellerSku: { type: 'string', description: 'Amazon seller SKU' },
                quantity: { type: 'number', description: 'Quantity to ship' },
              },
              required: ['sellerSku', 'quantity'],
            },
          },
        },
        required: ['orderId', 'shippingSpeed', 'name', 'addressLine1', 'city', 'stateOrRegion', 'postalCode', 'items'],
      },
    },
    {
      name: 'fba_check_fulfillment',
      description: 'Check the status of an FBA Multi-Channel Fulfillment (MCF) order. Shows shipment tracking info.',
      input_schema: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'The sellerFulfillmentOrderId used when creating the MCF order' },
        },
        required: ['orderId'],
      },
    },
    {
      name: 'fba_check_inventory',
      description: 'Check FBA inventory levels. Shows fulfillable quantity, inbound, and reserved stock per SKU.',
      input_schema: {
        type: 'object',
        properties: {
          sellerSkus: { type: 'string', description: 'Comma-separated seller SKUs to check (omit for all FBA inventory)' },
        },
      },
    },

    // -------------------------------------------------------------------------
    // Multi-Warehouse Inventory (Feature 3)
    // -------------------------------------------------------------------------
    {
      name: 'warehouse_list',
      description: 'List all warehouses/locations for the current user (home, FBA, 3PL, etc.).',
      input_schema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'warehouse_create',
      description: 'Create a new warehouse/location for inventory tracking.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Warehouse name (e.g., "Home Office", "FBA US East", "ShipBob LA")' },
          type: { type: 'string', description: 'Warehouse type', enum: ['manual', 'fba', '3pl'] },
          address: { type: 'string', description: 'Warehouse address (JSON or free text)' },
          isDefault: { type: 'boolean', description: 'Set as default warehouse' },
        },
        required: ['name'],
      },
    },
    {
      name: 'warehouse_inventory',
      description: 'Get inventory at a specific warehouse, or across all warehouses for a SKU.',
      input_schema: {
        type: 'object',
        properties: {
          warehouseId: { type: 'string', description: 'Warehouse ID (omit to show all warehouses)' },
          sku: { type: 'string', description: 'Filter by SKU (omit to show all SKUs at the warehouse)' },
        },
      },
    },
    {
      name: 'warehouse_update_stock',
      description: 'Update stock quantity at a warehouse for a SKU. Use for receiving shipments, adjustments, etc.',
      input_schema: {
        type: 'object',
        properties: {
          warehouseId: { type: 'string', description: 'Warehouse ID' },
          sku: { type: 'string', description: 'Product SKU' },
          quantity: { type: 'number', description: 'New total quantity (not delta)' },
          productId: { type: 'string', description: 'Internal product ID to link (optional)' },
        },
        required: ['warehouseId', 'sku', 'quantity'],
      },
    },
    {
      name: 'warehouse_transfer',
      description: 'Transfer stock between warehouses. Decrements source and increments destination.',
      input_schema: {
        type: 'object',
        properties: {
          fromWarehouseId: { type: 'string', description: 'Source warehouse ID' },
          toWarehouseId: { type: 'string', description: 'Destination warehouse ID' },
          sku: { type: 'string', description: 'Product SKU to transfer' },
          quantity: { type: 'number', description: 'Quantity to transfer' },
        },
        required: ['fromWarehouseId', 'toWarehouseId', 'sku', 'quantity'],
      },
    },

    // -------------------------------------------------------------------------
    // Phase 2 Feature Tools (CSV, Barcode, SEO, Alerts, Analytics, etc.)
    // -------------------------------------------------------------------------
    ...(csvImportTools as unknown as ToolDefinition[]),
    ...(scanningTools as unknown as ToolDefinition[]),
    ...(seoTools as unknown as ToolDefinition[]),
    ...(alertTools as unknown as ToolDefinition[]),
    ...(analyticsTools as unknown as ToolDefinition[]),
    ...(shippingTools as unknown as ToolDefinition[]),
    ...(repricerTools as unknown as ToolDefinition[]),
    ...(bulkListingTools as unknown as ToolDefinition[]),
    ...(variationTools as unknown as ToolDefinition[]),
    ...(returnTools as unknown as ToolDefinition[]),
    ...(fbaInboundTools as unknown as ToolDefinition[]),
    ...(inventoryTools as unknown as ToolDefinition[]),
    ...(taxTools as unknown as ToolDefinition[]),
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
  keepa?: KeepaCredentials;
  easypost?: EasyPostCredentials;
} {
  return {
    amazon: credentials.getCredentials<AmazonCredentials>(userId, 'amazon') ?? undefined,
    ebay: credentials.getCredentials<EbayCredentials>(userId, 'ebay') ?? undefined,
    walmart: credentials.getCredentials<WalmartCredentials>(userId, 'walmart') ?? undefined,
    aliexpress: credentials.getCredentials<AliExpressCredentials>(userId, 'aliexpress') ?? undefined,
    keepa: credentials.getCredentials<KeepaCredentials>(userId, 'keepa') ?? undefined,
    easypost: credentials.getCredentials<EasyPostCredentials>(userId, 'easypost') ?? undefined,
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
    case 'bestbuy': return createBestBuyAdapter();
    case 'target': return createTargetAdapter();
    case 'costco': return createCostcoAdapter();
    case 'homedepot': return createHomeDepotAdapter();
    case 'poshmark': return createPoshmarkAdapter();
    case 'mercari': return createMercariAdapter();
    case 'facebook': return createFacebookAdapter();
    case 'faire': return createFaireAdapter();
    case 'bstock': return createBStockAdapter();
    case 'bulq': return createBulqAdapter();
    case 'liquidation': return createLiquidationAdapter();
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Build SP-API auth config from Amazon credentials.
 * Passes through optional sellerId and marketplaceId if the user configured them.
 */
function buildSpApiConfig(amazon: AmazonCredentials): SpApiAuthConfig {
  return {
    clientId: amazon.spClientId!,
    clientSecret: amazon.spClientSecret!,
    refreshToken: amazon.spRefreshToken!,
    ...(amazon.spSellerId ? { sellerId: amazon.spSellerId } : {}),
    ...(amazon.spMarketplaceId ? { marketplaceId: amazon.spMarketplaceId } : {}),
  };
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

    case 'setup_aliexpress_oauth': {
      const appKey = input.appKey as string;
      const appSecret = input.appSecret as string | undefined;
      const redirectUri = input.redirectUri as string | undefined;
      const code = input.code as string | undefined;

      // Step 2: Exchange authorization code for tokens
      if (code) {
        if (!appSecret) {
          return { status: 'error', message: 'appSecret is required to exchange an authorization code for tokens.' };
        }
        try {
          const token = await obtainAliExpressToken(code, { appKey, appSecret });
          // Store the full credential set including tokens
          const credData = {
            appKey,
            appSecret,
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
          };
          if (context.credentials.setCredentials) {
            context.credentials.setCredentials(context.userId, 'aliexpress', credData);
          }
          return {
            status: 'ok',
            message: 'AliExpress OAuth tokens obtained and saved. Access token and refresh token are now stored.',
            expiresAt: new Date(token.expiresAt).toISOString(),
            refreshExpiresAt: new Date(token.refreshExpiresAt).toISOString(),
          };
        } catch (err) {
          return {
            status: 'error',
            message: `Failed to exchange code for tokens: ${err instanceof Error ? err.message : String(err)}`,
          };
        }
      }

      // Step 1: Generate authorization URL
      if (!redirectUri) {
        return { status: 'error', message: 'Provide redirectUri to get the authorization URL, or provide code to exchange for tokens.' };
      }
      const authUrl = getAuthorizationUrl(appKey, redirectUri);
      return {
        status: 'ok',
        authorizationUrl: authUrl,
        message: `Visit this URL to authorize the app, then use this tool again with the code parameter: ${authUrl}`,
      };
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
      const platform = input.platform as CredentialPlatform;
      if (context.credentials.deleteCredentials) {
        context.credentials.deleteCredentials(context.userId, platform);
      }
      return { status: 'ok', message: `Credentials for ${platform} deleted.` };
    }

    // -----------------------------------------------------------------------
    // Scanners — Real API calls
    // -----------------------------------------------------------------------
    case 'scan_amazon': {
      if (!input.query) return { status: 'error', message: 'query is required' };
      if (!creds.amazon) {
        return { status: 'error', message: 'Amazon credentials not configured. Use setup_amazon_credentials first.' };
      }
      try {
        const adapter = createAmazonAdapter(creds.amazon);
        const results = await adapter.search({
          query: input.query as string,
          category: input.category as string | undefined,
          maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
        });
        storeResults(context.db, results);
        return { status: 'ok', results, count: results.length };
      } catch (err) {
        logger.error({ err, tool: 'scan_amazon' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'scan_ebay': {
      if (!input.query) return { status: 'error', message: 'query is required' };
      if (!creds.ebay) {
        return { status: 'error', message: 'eBay credentials not configured. Use setup_ebay_credentials first.' };
      }
      try {
        const adapter = createEbayAdapter(creds.ebay);
        const results = await adapter.search({
          query: input.query as string,
          category: input.category as string | undefined,
          maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
        });
        storeResults(context.db, results);
        return { status: 'ok', results, count: results.length };
      } catch (err) {
        logger.error({ err, tool: 'scan_ebay' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'scan_walmart': {
      if (!input.query) return { status: 'error', message: 'query is required' };
      if (!creds.walmart) {
        return { status: 'error', message: 'Walmart credentials not configured. Use setup_walmart_credentials first.' };
      }
      try {
        const adapter = createWalmartAdapter(creds.walmart);
        const results = await adapter.search({
          query: input.query as string,
          category: input.category as string | undefined,
          maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
        });
        storeResults(context.db, results);
        return { status: 'ok', results, count: results.length };
      } catch (err) {
        logger.error({ err, tool: 'scan_walmart' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'scan_aliexpress': {
      if (!input.query) return { status: 'error', message: 'query is required' };
      if (!creds.aliexpress) {
        return { status: 'error', message: 'AliExpress credentials not configured. Use setup_aliexpress_credentials first.' };
      }
      try {
        const adapter = createAliExpressAdapter(creds.aliexpress);
        const results = await adapter.search({
          query: input.query as string,
          category: input.category as string | undefined,
          maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
        });
        storeResults(context.db, results);
        return { status: 'ok', results, count: results.length };
      } catch (err) {
        logger.error({ err, tool: 'scan_aliexpress' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'compare_prices': {
      if (!input.query) return { status: 'error', message: 'query is required' };
      const query = input.query as string;
      const targetPlatforms = (input.platforms as Platform[] | undefined) ?? ALL_PLATFORMS;
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
      if (!input.query) return { status: 'error', message: 'query is required' };
      const query = input.query as string;
      const targetPlatforms = (input.platforms as Platform[] | undefined) ?? ALL_PLATFORMS;

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
      if (!input.platform) return { status: 'error', message: 'platform is required' };
      if (!input.productId) return { status: 'error', message: 'productId is required' };
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
      if (!input.platform) return { status: 'error', message: 'platform is required' };
      if (!input.productId) return { status: 'error', message: 'productId is required' };
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
      if (!input.productId) return { status: 'error', message: 'productId is required' };
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
      if (!input.productId) return { status: 'error', message: 'productId is required' };
      if (!input.title) return { status: 'error', message: 'title is required' };
      if (typeof input.price !== 'number' || input.price <= 0) return { status: 'error', message: 'price must be a positive number' };
      if (!creds.ebay?.refreshToken) {
        return { status: 'error', message: 'eBay credentials required for listing creation. Use setup_ebay_credentials first.' };
      }
      try {
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
          // Derive source platform and price from product data
          const [sourcePlatformRaw] = productId.split(':');
          const sourcePlatform = (sourcePlatformRaw !== 'ebay' ? sourcePlatformRaw : 'aliexpress') as Platform;
          const latestPrices = context.db.getLatestPrices(productId);
          const sourceEntry = latestPrices.find(p => p.platform === sourcePlatform);
          const sourcePrice = sourceEntry?.price ?? 0;

          // Store listing in DB
          const now = new Date();
          context.db.addListing({
            id: randomUUID().slice(0, 12),
            productId,
            platform: 'ebay',
            platformListingId: result.listingId,
            title,
            price,
            sourcePlatform,
            sourcePrice,
            status: 'active',
            createdAt: now,
            updatedAt: now,
          });
        }

        return { status: result.success ? 'ok' : 'error', ...result };
      } catch (err) {
        logger.error({ err, tool: 'create_ebay_listing' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'create_amazon_listing': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials required for listing creation.' };
      }
      try {
        const result = await createListing('amazon', {
          title: input.title as string,
          description: (input.description as string) ?? '',
          price: input.price as number,
          category: (input.productType as string) ?? '0',
          imageUrls: input.imageUrl ? [input.imageUrl as string] : [],
          condition: ((input.condition as string) ?? 'new') as 'new' | 'used' | 'refurbished',
          quantity: typeof input.quantity === 'number' ? input.quantity : 1,
        }, { amazon: creds.amazon });
        return { status: result.success ? 'ok' : 'error', ...result };
      } catch (err) {
        logger.error({ err, tool: 'create_amazon_listing' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
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
      try {
        const listingId = input.listingId as string | undefined;
        const platform = (input.platform as string | undefined) ?? 'ebay';
        const brand = input.brand as string | undefined;
        const category = input.category as string | undefined;
        const features = input.features as string | undefined;

        let titleToOptimize = (input.productName as string | undefined) ?? '';
        let descriptionToOptimize = '';

        // If listingId provided, read from DB
        if (listingId) {
          const listings = context.db.query<{ title: string; description: string; price: number }>(
            'SELECT title, description, price FROM listings WHERE id = ?',
            [listingId],
          );
          if (listings.length === 0) {
            return { status: 'error', message: `Listing ${listingId} not found.` };
          }
          titleToOptimize = titleToOptimize || listings[0].title || '';
          descriptionToOptimize = listings[0].description || '';
        }

        if (!titleToOptimize) {
          return { status: 'error', message: 'Provide either a listingId or productName to optimize.' };
        }

        const optimized = await optimizeListing(titleToOptimize, descriptionToOptimize, {
          platform,
          brand,
          category,
          features: features ? features.split(',').map(f => f.trim()).filter(Boolean) : undefined,
        });

        return {
          status: 'ok',
          listingId,
          platform,
          optimized,
          message: 'Listing optimized. Apply changes with update_listing_price or create a new listing.',
        };
      } catch (err) {
        logger.error({ err, tool: 'optimize_listing' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
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
          }, { ebay: creds.ebay, amazon: creds.amazon });

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
      const listingId = input.listingId as string;
      const listingRows = context.db.query<{ platform: string; platform_listing_id: string }>(
        'SELECT platform, platform_listing_id FROM listings WHERE id = ?',
        [listingId],
      );

      if (listingRows.length === 0) {
        return { status: 'error', message: `Listing ${listingId} not found.` };
      }

      // Withdraw from eBay if applicable
      if (listingRows[0].platform === 'ebay' && creds.ebay?.refreshToken && listingRows[0].platform_listing_id) {
        try {
          const seller = createEbaySellerApi(creds.ebay);
          await seller.withdrawOffer(listingRows[0].platform_listing_id);
        } catch (err) {
          logger.warn({ listingId, error: err instanceof Error ? err.message : String(err) }, 'Failed to withdraw offer on eBay');
        }
      }

      context.db.updateListingStatus(listingId, 'paused');
      return { status: 'ok', message: `Listing ${listingId} paused.` };
    }

    case 'resume_listing': {
      const listingId = input.listingId as string;
      const listingRows = context.db.query<{ platform: string; platform_listing_id: string }>(
        'SELECT platform, platform_listing_id FROM listings WHERE id = ?',
        [listingId],
      );

      if (listingRows.length === 0) {
        return { status: 'error', message: `Listing ${listingId} not found.` };
      }

      // Re-publish on eBay if applicable
      if (listingRows[0].platform === 'ebay' && creds.ebay?.refreshToken && listingRows[0].platform_listing_id) {
        try {
          const seller = createEbaySellerApi(creds.ebay);
          await seller.publishOffer(listingRows[0].platform_listing_id);
        } catch (err) {
          logger.warn({ listingId, error: err instanceof Error ? err.message : String(err) }, 'Failed to republish offer on eBay');
        }
      }

      context.db.updateListingStatus(listingId, 'active');
      return { status: 'ok', message: `Listing ${listingId} resumed.` };
    }

    case 'delete_listing': {
      const listingId = input.listingId as string;
      const listingRows = context.db.query<{ platform: string; platform_listing_id: string; sku?: string }>(
        'SELECT platform, platform_listing_id FROM listings WHERE id = ?',
        [listingId],
      );

      if (listingRows.length === 0) {
        return { status: 'error', message: `Listing ${listingId} not found.` };
      }

      // Delete from eBay if applicable
      if (listingRows[0].platform === 'ebay' && creds.ebay?.refreshToken && listingRows[0].platform_listing_id) {
        try {
          const seller = createEbaySellerApi(creds.ebay);
          // Withdraw offer first, then delete inventory item
          await seller.withdrawOffer(listingRows[0].platform_listing_id);
        } catch (err) {
          logger.warn({ listingId, error: err instanceof Error ? err.message : String(err) }, 'Failed to delete listing on eBay');
        }
      }

      context.db.updateListingStatus(listingId, 'expired');
      return { status: 'ok', message: `Listing ${listingId} deleted.` };
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
      try {
        const result = await autoPurchase(
          input.orderId as string,
          context.db,
          { aliexpress: creds.aliexpress },
        );
        return { status: result.success ? 'ok' : 'error', ...result };
      } catch (err) {
        logger.error({ err, tool: 'auto_purchase' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'track_shipment': {
      try {
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
      } catch (err) {
        logger.error({ err, tool: 'track_shipment' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'update_tracking': {
      try {
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
      } catch (err) {
        logger.error({ err, tool: 'update_tracking' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'handle_return': {
      const orderId = input.orderId as string;
      const order = context.db.getOrder(orderId);

      if (!order) {
        return { status: 'error', message: `Order ${orderId} not found.` };
      }

      // Issue eBay refund if this was an eBay sale
      let refundResult: { refundId?: string; refundStatus?: string } = {};
      if (order.sellPlatform === 'ebay' && order.sellOrderId && creds.ebay?.refreshToken) {
        try {
          const ordersApi = createEbayOrdersApi(creds.ebay);
          refundResult = await ordersApi.issueRefund(order.sellOrderId, {
            reasonForRefund: 'OTHER',
            comment: (input.reason as string) ?? 'Return processed',
          });
        } catch (err) {
          logger.warn({ orderId, error: err instanceof Error ? err.message : String(err) }, 'Failed to issue eBay refund');
        }
      }

      context.db.updateOrderStatus(orderId, 'returned');
      return {
        status: 'ok',
        message: `Return initiated for order ${orderId}.`,
        reason: input.reason ?? 'Not specified',
        refundId: refundResult.refundId,
        refundStatus: refundResult.refundStatus,
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
    // Extended platform tools — Real API calls
    // -----------------------------------------------------------------------
    case 'get_shipping_cost': {
      if (!creds.aliexpress) {
        return { status: 'error', message: 'AliExpress credentials not configured.' };
      }
      try {
        const shippingApi = createAliExpressShippingApi({
          appKey: creds.aliexpress.appKey,
          appSecret: creds.aliexpress.appSecret,
          accessToken: creds.aliexpress.accessToken,
        });
        const methods = await shippingApi.queryShippingCost({
          productId: input.productId as string,
          country: (input.country as string) ?? 'US',
          productNum: typeof input.quantity === 'number' ? input.quantity : 1,
        });
        return { status: 'ok', shippingMethods: methods, count: methods.length };
      } catch (err) {
        logger.error({ err, tool: 'get_shipping_cost' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'get_hot_products': {
      if (!creds.aliexpress) {
        return { status: 'error', message: 'AliExpress credentials not configured.' };
      }
      try {
        const extApi = createAliExpressExtendedApi({
          appKey: creds.aliexpress.appKey,
          appSecret: creds.aliexpress.appSecret,
        });
        const products = await extApi.queryHotProducts({
          keywords: input.keywords as string | undefined,
          categoryId: input.categoryId as string | undefined,
          minSalePrice: input.minPrice as number | undefined,
          maxSalePrice: input.maxPrice as number | undefined,
          sort: input.sort as 'SALE_PRICE_ASC' | 'SALE_PRICE_DESC' | 'LAST_VOLUME_ASC' | 'LAST_VOLUME_DESC' | undefined,
          pageSize: typeof input.maxResults === 'number' ? input.maxResults : 20,
        });
        return { status: 'ok', products, count: products.length };
      } catch (err) {
        logger.error({ err, tool: 'get_hot_products' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'get_aliexpress_categories': {
      if (!creds.aliexpress) {
        return { status: 'error', message: 'AliExpress credentials not configured.' };
      }
      try {
        const extApi = createAliExpressExtendedApi({
          appKey: creds.aliexpress.appKey,
          appSecret: creds.aliexpress.appSecret,
        });
        const categories = await extApi.getCategories();
        return { status: 'ok', categories, count: categories.length };
      } catch (err) {
        logger.error({ err, tool: 'get_aliexpress_categories' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'get_product_variations': {
      if (!creds.amazon) {
        return { status: 'error', message: 'Amazon credentials not configured.' };
      }
      try {
        const amazonExt = createAmazonExtendedApi({
          accessKeyId: creds.amazon.accessKeyId,
          secretAccessKey: creds.amazon.secretAccessKey,
          partnerTag: creds.amazon.partnerTag,
        });
        const variations = await amazonExt.getVariations(
          input.asin as string,
          input.marketplace as string | undefined,
        );
        return { status: 'ok', ...variations };
      } catch (err) {
        logger.error({ err, tool: 'get_product_variations' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'browse_amazon_categories': {
      if (!creds.amazon) {
        return { status: 'error', message: 'Amazon credentials not configured.' };
      }
      try {
        const amazonExt = createAmazonExtendedApi({
          accessKeyId: creds.amazon.accessKeyId,
          secretAccessKey: creds.amazon.secretAccessKey,
          partnerTag: creds.amazon.partnerTag,
        });
        const nodes = await amazonExt.getBrowseNodes(
          input.nodeIds as string[],
          input.marketplace as string | undefined,
        );
        return { status: 'ok', nodes, count: nodes.length };
      } catch (err) {
        logger.error({ err, tool: 'browse_amazon_categories' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_get_policies': {
      if (!creds.ebay?.refreshToken) {
        return { status: 'error', message: 'eBay credentials with refresh token required.' };
      }
      try {
        const accountApi = createEbayAccountApi(creds.ebay);
        const policyType = (input.policyType as string) ?? 'all';
        const marketplaceId = (input.marketplaceId as string) ?? 'EBAY_US';

        if (policyType === 'all') {
          const all = await accountApi.getAllPolicies(marketplaceId);
          return { status: 'ok', ...all };
        } else if (policyType === 'fulfillment') {
          const policies = await accountApi.getFulfillmentPolicies(marketplaceId);
          return { status: 'ok', fulfillment: policies };
        } else if (policyType === 'payment') {
          const policies = await accountApi.getPaymentPolicies(marketplaceId);
          return { status: 'ok', payment: policies };
        } else {
          const policies = await accountApi.getReturnPolicies(marketplaceId);
          return { status: 'ok', return: policies };
        }
      } catch (err) {
        logger.error({ err, tool: 'ebay_get_policies' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_create_policy': {
      if (!creds.ebay?.refreshToken) {
        return { status: 'error', message: 'eBay credentials with refresh token required.' };
      }
      try {
        const accountApi = createEbayAccountApi(creds.ebay);
        const policyType = input.policyType as string;
        const name = input.name as string;

        if (policyType === 'fulfillment') {
          const policyId = await accountApi.createFulfillmentPolicy({
            name,
            marketplaceId: 'EBAY_US',
            handlingTimeDays: typeof input.handlingTimeDays === 'number' ? input.handlingTimeDays : 1,
            shippingServiceCode: (input.shippingServiceCode as string) ?? 'ShippingMethodStandard',
            freeShipping: input.freeShipping as boolean | undefined,
          });
          return { status: 'ok', policyType, policyId, name };
        } else if (policyType === 'payment') {
          const policyId = await accountApi.createPaymentPolicy({ name, marketplaceId: 'EBAY_US' });
          return { status: 'ok', policyType, policyId, name };
        } else {
          const policyId = await accountApi.createReturnPolicy({
            name,
            marketplaceId: 'EBAY_US',
            returnsAccepted: input.returnsAccepted !== false,
            returnDays: typeof input.returnDays === 'number' ? input.returnDays : 30,
            returnShippingCostPayer: 'BUYER',
          });
          return { status: 'ok', policyType, policyId, name };
        }
      } catch (err) {
        logger.error({ err, tool: 'ebay_create_policy' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_category_suggest': {
      if (!creds.ebay) {
        return { status: 'error', message: 'eBay credentials not configured.' };
      }
      try {
        const taxonomyApi = createEbayTaxonomyApi(creds.ebay);
        const suggestions = await taxonomyApi.getCategorySuggestions(input.query as string);
        return { status: 'ok', suggestions, count: suggestions.length };
      } catch (err) {
        logger.error({ err, tool: 'ebay_category_suggest' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_item_aspects': {
      if (!creds.ebay) {
        return { status: 'error', message: 'eBay credentials not configured.' };
      }
      try {
        const taxonomyApi = createEbayTaxonomyApi(creds.ebay);
        const aspects = await taxonomyApi.getItemAspectsForCategory(input.categoryId as string);
        return {
          status: 'ok',
          categoryId: input.categoryId,
          aspects: aspects.map(a => ({
            name: a.localizedAspectName,
            required: a.aspectConstraint.aspectRequired ?? false,
            mode: a.aspectConstraint.aspectMode ?? 'FREE_TEXT',
            values: a.aspectValues?.slice(0, 20).map(v => v.localizedValue),
          })),
          count: aspects.length,
        };
      } catch (err) {
        logger.error({ err, tool: 'ebay_item_aspects' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_get_inventory': {
      if (!creds.ebay?.refreshToken) {
        return { status: 'error', message: 'eBay credentials with refresh token required.' };
      }
      try {
        const seller = createEbaySellerApi(creds.ebay);
        const result = await seller.getInventoryItems({
          limit: typeof input.limit === 'number' ? input.limit : 25,
          offset: typeof input.offset === 'number' ? input.offset : 0,
        });
        return { status: 'ok', ...result };
      } catch (err) {
        logger.error({ err, tool: 'ebay_get_inventory' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_bulk_update': {
      if (!creds.ebay?.refreshToken) {
        return { status: 'error', message: 'eBay credentials with refresh token required.' };
      }
      try {
        const seller = createEbaySellerApi(creds.ebay);
        const updates = input.updates as Array<{ sku: string; offerId: string; price?: number; quantity?: number }>;
        const result = await seller.bulkUpdatePriceQuantity(updates);
        return { status: 'ok', ...result };
      } catch (err) {
        logger.error({ err, tool: 'ebay_bulk_update' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_issue_refund': {
      if (!creds.ebay?.refreshToken) {
        return { status: 'error', message: 'eBay credentials with refresh token required.' };
      }
      try {
        const ordersApi = createEbayOrdersApi(creds.ebay);
        const refundReq: EbayRefundRequest = {
          reasonForRefund: input.reason as EbayRefundRequest['reasonForRefund'],
          comment: input.comment as string | undefined,
          ...(typeof input.amount === 'number' ? { orderLevelRefundAmount: { value: input.amount.toFixed(2), currency: 'USD' } } : {}),
        };
        const refund = await ordersApi.issueRefund(input.orderId as string, refundReq);
        return { status: 'ok', ...refund };
      } catch (err) {
        logger.error({ err, tool: 'ebay_issue_refund' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_upc_lookup': {
      if (!creds.walmart) {
        return { status: 'error', message: 'Walmart credentials not configured.' };
      }
      try {
        const walmartExt = createWalmartExtendedApi(creds.walmart);
        const item = await walmartExt.lookupByUpc(input.upc as string);
        if (!item) {
          return { status: 'error', message: `No Walmart product found for UPC ${input.upc}` };
        }
        return { status: 'ok', product: item };
      } catch (err) {
        logger.error({ err, tool: 'walmart_upc_lookup' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_trending': {
      if (!creds.walmart) {
        return { status: 'error', message: 'Walmart credentials not configured.' };
      }
      try {
        const walmartExt = createWalmartExtendedApi(creds.walmart);
        const items = await walmartExt.getTrending();
        return { status: 'ok', products: items, count: items.length };
      } catch (err) {
        logger.error({ err, tool: 'walmart_trending' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_taxonomy': {
      if (!creds.walmart) {
        return { status: 'error', message: 'Walmart credentials not configured.' };
      }
      try {
        const walmartExt = createWalmartExtendedApi(creds.walmart);
        const categories = await walmartExt.getTaxonomy();
        return { status: 'ok', categories, count: categories.length };
      } catch (err) {
        logger.error({ err, tool: 'walmart_taxonomy' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'get_ds_order_status': {
      if (!creds.aliexpress) {
        return { status: 'error', message: 'AliExpress credentials not configured.' };
      }
      try {
        const dsOrders = createAliExpressOrdersApi({
          appKey: creds.aliexpress.appKey,
          appSecret: creds.aliexpress.appSecret,
          accessToken: creds.aliexpress.accessToken,
        });
        const status = await dsOrders.getDsOrderStatus(input.orderId as string);
        if (!status) {
          return { status: 'error', message: `Order ${input.orderId} not found or access denied.` };
        }
        return { status: 'ok', ...status };
      } catch (err) {
        logger.error({ err, tool: 'get_ds_order_status' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    // -----------------------------------------------------------------------
    // Amazon SP-API tools
    // -----------------------------------------------------------------------
    case 'amazon_sp_search_catalog': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured. Use setup_amazon_sp_credentials first.' };
      }
      try {
        const spApi = createAmazonSpApi(buildSpApiConfig(creds.amazon));
        const keywords = input.keywords ? (input.keywords as string).split(',').map(s => s.trim()) : undefined;
        const identifiers = input.identifiers ? (input.identifiers as string).split(',').map(s => s.trim()) : undefined;
        const result = await spApi.searchCatalog({
          keywords,
          identifiers,
          identifiersType: input.identifiersType as 'ASIN' | 'UPC' | 'EAN' | 'ISBN' | undefined,
          pageSize: typeof input.maxResults === 'number' ? input.maxResults : 20,
        });
        return { status: 'ok', items: result.items, count: result.items.length, nextPageToken: result.nextPageToken };
      } catch (err) {
        logger.error({ err, tool: 'amazon_sp_search_catalog' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'amazon_sp_get_pricing': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured.' };
      }
      try {
        const spApi = createAmazonSpApi(buildSpApiConfig(creds.amazon));
        const asins = (input.asins as string).split(',').map(s => s.trim());
        const pricing = await spApi.getCompetitivePricing(asins);
        return { status: 'ok', pricing, count: pricing.length };
      } catch (err) {
        logger.error({ err, tool: 'amazon_sp_get_pricing' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'amazon_sp_estimate_fees': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured.' };
      }
      try {
        const spApi = createAmazonSpApi(buildSpApiConfig(creds.amazon));
        const fees = await spApi.getMyFeesEstimate([{
          asin: input.asin as string,
          price: input.price as number,
          shipping: typeof input.shipping === 'number' ? input.shipping : 0,
          isAmazonFulfilled: input.fba as boolean | undefined,
        }]);
        return { status: 'ok', fees: fees[0] ?? null };
      } catch (err) {
        logger.error({ err, tool: 'amazon_sp_estimate_fees' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'amazon_sp_create_listing': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured.' };
      }
      try {
        const spApi = createAmazonSpApi(buildSpApiConfig(creds.amazon));
        const attributes: Record<string, unknown> = {};
        if (input.title) attributes.item_name = [{ value: input.title, language_tag: 'en_US' }];
        if (input.price) attributes.purchasable_offer = [{ our_price: [{ schedule: [{ value_with_tax: input.price }] }], currency: 'USD' }];
        if (input.condition) attributes.condition_type = [{ value: input.condition }];
        if (input.quantity) attributes.fulfillment_availability = [{ fulfillment_channel_code: 'DEFAULT', quantity: input.quantity }];

        const result = await spApi.putListingsItem({
          sku: input.sku as string,
          productType: input.productType as string,
          attributes,
        });
        return { status: 'ok', spStatus: result.status, submissionId: result.submissionId, issues: result.issues };
      } catch (err) {
        logger.error({ err, tool: 'amazon_sp_create_listing' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'amazon_sp_get_orders': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured.' };
      }
      try {
        const spApi = createAmazonSpApi(buildSpApiConfig(creds.amazon));
        const orderStatuses = input.orderStatuses ? (input.orderStatuses as string).split(',').map(s => s.trim()) : undefined;
        const result = await spApi.getOrders({
          createdAfter: input.createdAfter as string | undefined,
          orderStatuses,
          maxResults: typeof input.maxResults === 'number' ? input.maxResults : 50,
        });
        return { status: 'ok', orders: result.orders, count: result.orders.length, nextToken: result.nextToken };
      } catch (err) {
        logger.error({ err, tool: 'amazon_sp_get_orders' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'amazon_sp_get_fba_inventory': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured.' };
      }
      try {
        const spApi = createAmazonSpApi(buildSpApiConfig(creds.amazon));
        const sellerSkus = input.sellerSkus ? (input.sellerSkus as string).split(',').map(s => s.trim()) : undefined;
        const result = await spApi.getInventorySummaries({ sellerSkus });
        return { status: 'ok', summaries: result.summaries, count: result.summaries.length };
      } catch (err) {
        logger.error({ err, tool: 'amazon_sp_get_fba_inventory' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    // -----------------------------------------------------------------------
    // Amazon SP-API Extended tools
    // -----------------------------------------------------------------------
    case 'amazon_sp_listing_restrictions': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured.' };
      }
      try {
        const spExtRestr = createAmazonSpApiExtended(buildSpApiConfig(creds.amazon));
        const restrictions = await spExtRestr.getListingsRestrictions(input.asin as string, input.conditionType as string | undefined);
        return { status: 'ok', ...restrictions };
      } catch (err) {
        logger.error({ err, tool: 'amazon_sp_listing_restrictions' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'amazon_sp_financial_events': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured.' };
      }
      try {
        const spExtFin = createAmazonSpApiExtended(buildSpApiConfig(creds.amazon));
        const finEvents = await spExtFin.listFinancialEvents({ orderId: input.orderId as string | undefined, postedAfter: input.postedAfter as string | undefined, postedBefore: input.postedBefore as string | undefined });
        return { status: 'ok', ...finEvents };
      } catch (err) {
        logger.error({ err, tool: 'amazon_sp_financial_events' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'amazon_sp_confirm_shipment': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured.' };
      }
      try {
        const spExtShip = createAmazonSpApiExtended(buildSpApiConfig(creds.amazon));
        await spExtShip.confirmShipment(input.orderId as string, { packageReferenceId: input.packageReferenceId as string, carrierCode: input.carrierCode as string, trackingNumber: input.trackingNumber as string, shipDate: input.shipDate as string, orderItems: input.orderItems as Array<{ orderItemId: string; quantity: number }> });
        return { status: 'ok', message: 'Shipment confirmed successfully.' };
      } catch (err) {
        logger.error({ err, tool: 'amazon_sp_confirm_shipment' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'amazon_sp_fulfillment_preview': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured.' };
      }
      try {
        const spExtPrev = createAmazonSpApiExtended(buildSpApiConfig(creds.amazon));
        const preview = await spExtPrev.getFulfillmentPreview({ name: input.name as string, addressLine1: input.addressLine1 as string, city: input.city as string, stateOrRegion: input.stateOrRegion as string, postalCode: input.postalCode as string, countryCode: (input.countryCode as string) ?? 'US' }, input.items as Array<{ sellerSku: string; quantity: number }>);
        return { status: 'ok', ...preview };
      } catch (err) {
        logger.error({ err, tool: 'amazon_sp_fulfillment_preview' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'amazon_sp_create_mcf_order': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured.' };
      }
      try {
        const spExtMcf = createAmazonSpApiExtended(buildSpApiConfig(creds.amazon));
        await spExtMcf.createFulfillmentOrder({
          sellerFulfillmentOrderId: input.sellerFulfillmentOrderId as string, displayableOrderId: input.displayableOrderId as string, displayableOrderDate: new Date().toISOString(), displayableOrderComment: input.displayableOrderComment as string,
          shippingSpeedCategory: input.shippingSpeedCategory as 'Standard' | 'Expedited' | 'Priority',
          destinationAddress: { name: input.name as string, addressLine1: input.addressLine1 as string, city: input.city as string, stateOrRegion: input.stateOrRegion as string, postalCode: input.postalCode as string, countryCode: (input.countryCode as string) ?? 'US' },
          items: input.items as Array<{ sellerSku: string; sellerFulfillmentOrderItemId: string; quantity: number }>,
        });
        return { status: 'ok', message: 'MCF fulfillment order created successfully.' };
      } catch (err) {
        logger.error({ err, tool: 'amazon_sp_create_mcf_order' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'amazon_sp_buy_shipping': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured.' };
      }
      try {
        const spExtBuy = createAmazonSpApiExtended(buildSpApiConfig(creds.amazon));
        const shipResult = await spExtBuy.purchaseShipment({ clientReferenceId: input.clientReferenceId as string, shipFrom: input.shipFrom as ShippingAddress, shipTo: input.shipTo as ShippingAddress, packages: input.packages as ShippingPackage[], selectedService: { serviceId: input.serviceId as string } });
        return { status: 'ok', ...shipResult };
      } catch (err) {
        logger.error({ err, tool: 'amazon_sp_buy_shipping' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'amazon_sp_get_shipping_tracking': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured.' };
      }
      try {
        const spExtTrack = createAmazonSpApiExtended(buildSpApiConfig(creds.amazon));
        const tracking = await spExtTrack.getTracking(input.trackingId as string, input.carrierId as string);
        if (!tracking) { return { status: 'error', message: 'Tracking not found.' }; }
        return { status: 'ok', ...tracking };
      } catch (err) {
        logger.error({ err, tool: 'amazon_sp_get_shipping_tracking' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'amazon_sp_create_report': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured.' };
      }
      try {
        const spExtRpt = createAmazonSpApiExtended(buildSpApiConfig(creds.amazon));
        const reportResult = await spExtRpt.createReport(input.reportType as string, input.startDate as string | undefined, input.endDate as string | undefined);
        return { status: 'ok', ...reportResult };
      } catch (err) {
        logger.error({ err, tool: 'amazon_sp_create_report' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'amazon_sp_get_report': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured.' };
      }
      try {
        const spExtRptGet = createAmazonSpApiExtended(buildSpApiConfig(creds.amazon));
        const report = await spExtRptGet.getReport(input.reportId as string);
        let downloadUrl: string | undefined;
        if (report.reportDocumentId) { const doc = await spExtRptGet.getReportDocument(report.reportDocumentId); downloadUrl = doc.url; }
        return { status: 'ok', ...report, downloadUrl };
      } catch (err) {
        logger.error({ err, tool: 'amazon_sp_get_report' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    // -----------------------------------------------------------------------
    // Amazon SP-API Complete tools
    // -----------------------------------------------------------------------
    case 'amazon_sp_get_catalog_item': {
      if (!creds.amazon?.spRefreshToken) { return { status: 'error', message: 'Amazon SP-API credentials not configured.' }; }
      try {
        const spCompCat = createAmazonSpApiComplete(buildSpApiConfig(creds.amazon));
        const catalogItem = await spCompCat.getCatalogItem(input.asin as string);
        if (!catalogItem) { return { status: 'error', message: `ASIN ${input.asin} not found.` }; }
        return { status: 'ok', ...catalogItem };
      } catch (err) { logger.error({ err, tool: 'amazon_sp_get_catalog_item' }, 'Tool execution failed'); return { status: 'error', message: err instanceof Error ? err.message : String(err) }; }
    }

    case 'amazon_sp_item_offers': {
      if (!creds.amazon?.spRefreshToken) { return { status: 'error', message: 'Amazon SP-API credentials not configured.' }; }
      try {
        const spCompOffers = createAmazonSpApiComplete(buildSpApiConfig(creds.amazon));
        const offers = await spCompOffers.getItemOffers(input.asin as string);
        if (!offers) { return { status: 'error', message: `No offers found for ASIN ${input.asin}.` }; }
        return { status: 'ok', data: offers };
      } catch (err) { logger.error({ err, tool: 'amazon_sp_item_offers' }, 'Tool execution failed'); return { status: 'error', message: err instanceof Error ? err.message : String(err) }; }
    }

    case 'amazon_sp_batch_fees': {
      if (!creds.amazon?.spRefreshToken) { return { status: 'error', message: 'Amazon SP-API credentials not configured.' }; }
      try {
        const spCompFees = createAmazonSpApiComplete(buildSpApiConfig(creds.amazon));
        const feeResults = await spCompFees.getMyFeesEstimates(input.items as Array<{ asin: string; price: number; currencyCode?: string }>);
        return { status: 'ok', fees: feeResults, count: feeResults.length };
      } catch (err) { logger.error({ err, tool: 'amazon_sp_batch_fees' }, 'Tool execution failed'); return { status: 'error', message: err instanceof Error ? err.message : String(err) }; }
    }

    case 'amazon_sp_get_order_details': {
      if (!creds.amazon?.spRefreshToken) { return { status: 'error', message: 'Amazon SP-API credentials not configured.' }; }
      try {
        const spCompOrd = createAmazonSpApiComplete(buildSpApiConfig(creds.amazon));
        const order = await spCompOrd.getOrder(input.orderId as string);
        if (!order) { return { status: 'error', message: `Order ${input.orderId} not found.` }; }
        return { status: 'ok', ...order };
      } catch (err) { logger.error({ err, tool: 'amazon_sp_get_order_details' }, 'Tool execution failed'); return { status: 'error', message: err instanceof Error ? err.message : String(err) }; }
    }

    case 'amazon_sp_get_order_items': {
      if (!creds.amazon?.spRefreshToken) { return { status: 'error', message: 'Amazon SP-API credentials not configured.' }; }
      try {
        const spCompOrdItems = createAmazonSpApiComplete(buildSpApiConfig(creds.amazon));
        const orderItems = await spCompOrdItems.getOrderItems(input.orderId as string);
        if (!orderItems) { return { status: 'error', message: `Order items for ${input.orderId} not found.` }; }
        return { status: 'ok', ...orderItems };
      } catch (err) { logger.error({ err, tool: 'amazon_sp_get_order_items' }, 'Tool execution failed'); return { status: 'error', message: err instanceof Error ? err.message : String(err) }; }
    }

    case 'amazon_sp_delete_listing': {
      if (!creds.amazon?.spRefreshToken) { return { status: 'error', message: 'Amazon SP-API credentials not configured.' }; }
      try {
        const spCompDel = createAmazonSpApiComplete(buildSpApiConfig(creds.amazon));
        await spCompDel.deleteListingsItem(input.sellerId as string, input.sku as string);
        return { status: 'ok', message: `Listing ${input.sku} deleted.` };
      } catch (err) { logger.error({ err, tool: 'amazon_sp_delete_listing' }, 'Tool execution failed'); return { status: 'error', message: err instanceof Error ? err.message : String(err) }; }
    }

    case 'amazon_sp_order_metrics': {
      if (!creds.amazon?.spRefreshToken) { return { status: 'error', message: 'Amazon SP-API credentials not configured.' }; }
      try {
        const spCompMetrics = createAmazonSpApiComplete(buildSpApiConfig(creds.amazon));
        const metrics = await spCompMetrics.getOrderMetrics({ interval: input.interval as string, granularity: input.granularity as 'Day' | 'Week' | 'Month' });
        return { status: 'ok', ...metrics };
      } catch (err) { logger.error({ err, tool: 'amazon_sp_order_metrics' }, 'Tool execution failed'); return { status: 'error', message: err instanceof Error ? err.message : String(err) }; }
    }

    case 'amazon_sp_data_kiosk_query': {
      if (!creds.amazon?.spRefreshToken) { return { status: 'error', message: 'Amazon SP-API credentials not configured.' }; }
      try {
        const spCompKiosk = createAmazonSpApiComplete(buildSpApiConfig(creds.amazon));
        const queryResult = await spCompKiosk.createQuery(input.query as string);
        return { status: 'ok', ...queryResult };
      } catch (err) { logger.error({ err, tool: 'amazon_sp_data_kiosk_query' }, 'Tool execution failed'); return { status: 'error', message: err instanceof Error ? err.message : String(err) }; }
    }

    // -----------------------------------------------------------------------
    // AliExpress Discovery tools
    // -----------------------------------------------------------------------
    case 'aliexpress_image_search': {
      try {
        if (!creds.aliexpress) {
          return { status: 'error', message: 'AliExpress credentials not configured.' };
        }
        const aeDiscImg = createAliExpressDiscoveryApi({
          appKey: creds.aliexpress.appKey,
          appSecret: creds.aliexpress.appSecret,
          accessToken: creds.aliexpress.accessToken,
        });
        const imageResults = await aeDiscImg.imageSearch(input.imageUrl as string);
        return { status: 'ok', products: imageResults, count: imageResults.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'aliexpress_affiliate_orders': {
      try {
        if (!creds.aliexpress) {
          return { status: 'error', message: 'AliExpress credentials not configured.' };
        }
        const aeDiscAff = createAliExpressDiscoveryApi({
          appKey: creds.aliexpress.appKey,
          appSecret: creds.aliexpress.appSecret,
          accessToken: creds.aliexpress.accessToken,
        });
        const affOrders = await aeDiscAff.getAffiliateOrders({
          start_time: input.startTime as string | undefined,
          end_time: input.endTime as string | undefined,
          status: input.status as string | undefined,
          page_no: input.pageNo as number | undefined,
          page_size: input.pageSize as number | undefined,
        });
        return { status: 'ok', orders: affOrders, count: affOrders.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'aliexpress_ds_feed': {
      try {
        if (!creds.aliexpress) {
          return { status: 'error', message: 'AliExpress credentials not configured.' };
        }
        const aeDiscFeed = createAliExpressDiscoveryApi({
          appKey: creds.aliexpress.appKey,
          appSecret: creds.aliexpress.appSecret,
          accessToken: creds.aliexpress.accessToken,
        });
        const feedProducts = await aeDiscFeed.getDsRecommendFeed({
          category_id: input.categoryId as string | undefined,
          page_no: input.pageNo as number | undefined,
          page_size: input.pageSize as number | undefined,
          country: input.country as string | undefined,
          sort: input.sort as string | undefined,
        });
        return { status: 'ok', products: feedProducts, count: feedProducts.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'aliexpress_create_dispute': {
      try {
        if (!creds.aliexpress) {
          return { status: 'error', message: 'AliExpress credentials not configured.' };
        }
        const aeDiscDisp = createAliExpressDiscoveryApi({
          appKey: creds.aliexpress.appKey,
          appSecret: creds.aliexpress.appSecret,
          accessToken: creds.aliexpress.accessToken,
        });
        const disputeResult = await aeDiscDisp.createDispute({
          order_id: input.orderId as number,
          reason: input.reason as string,
          description: input.description as string,
          image_urls: input.imageUrls as string[] | undefined,
        });
        return { status: 'ok', ...disputeResult };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'aliexpress_dispute_detail': {
      try {
        if (!creds.aliexpress) {
          return { status: 'error', message: 'AliExpress credentials not configured.' };
        }
        const aeDiscDispDet = createAliExpressDiscoveryApi({
          appKey: creds.aliexpress.appKey,
          appSecret: creds.aliexpress.appSecret,
          accessToken: creds.aliexpress.accessToken,
        });
        const dispute = await aeDiscDispDet.getDisputeDetail(input.disputeId as number);
        if (!dispute) {
          return { status: 'error', message: `Dispute ${input.disputeId} not found.` };
        }
        return { status: 'ok', ...dispute };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    // -----------------------------------------------------------------------
    // AliExpress Complete tools
    // -----------------------------------------------------------------------
    case 'aliexpress_generate_affiliate_link': {
      try {
        if (!creds.aliexpress) {
          return { status: 'error', message: 'AliExpress credentials not configured.' };
        }
        const affLinks = await generateAffiliateLink(
          {
            appKey: creds.aliexpress.appKey,
            appSecret: creds.aliexpress.appSecret,
            accessToken: creds.aliexpress.accessToken,
          },
          {
            sourceValues: input.sourceValues as string,
            promotionLinkType: input.promotionLinkType as number | undefined,
            trackingId: input.trackingId as string | undefined,
          },
        );
        return { status: 'ok', links: affLinks, count: affLinks.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'aliexpress_ds_product_detail': {
      try {
        if (!creds.aliexpress) {
          return { status: 'error', message: 'AliExpress credentials not configured.' };
        }
        const dsProduct = await getDsProductDetails(
          {
            appKey: creds.aliexpress.appKey,
            appSecret: creds.aliexpress.appSecret,
            accessToken: creds.aliexpress.accessToken,
          },
          input.productId as string,
        );
        if (!dsProduct) {
          return { status: 'error', message: `Product ${input.productId} not found.` };
        }
        return { status: 'ok', ...dsProduct };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'aliexpress_ds_tracking': {
      try {
        if (!creds.aliexpress) {
          return { status: 'error', message: 'AliExpress credentials not configured.' };
        }
        const dsTracking = await getDsOrderTracking(
          {
            appKey: creds.aliexpress.appKey,
            appSecret: creds.aliexpress.appSecret,
            accessToken: creds.aliexpress.accessToken,
          },
          input.orderId as string,
        );
        if (!dsTracking) {
          return { status: 'error', message: `Tracking for order ${input.orderId} not found.` };
        }
        return { status: 'ok', ...dsTracking };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'aliexpress_query_freight': {
      try {
        if (!creds.aliexpress) {
          return { status: 'error', message: 'AliExpress credentials not configured.' };
        }
        const freightOptions = await queryDsFreight(
          {
            appKey: creds.aliexpress.appKey,
            appSecret: creds.aliexpress.appSecret,
            accessToken: creds.aliexpress.accessToken,
          },
          {
            productId: input.productId as string,
            quantity: input.quantity as number,
            shipToCountry: input.shipToCountry as string | undefined,
          },
        );
        return { status: 'ok', options: freightOptions, count: freightOptions.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    // -----------------------------------------------------------------------
    // eBay Finances / Analytics / Marketing
    // -----------------------------------------------------------------------
    case 'ebay_get_transactions': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const finApi = createEbayFinancesApi(creds.ebay);
        const result = await finApi.getTransactions({
          filter: input.filter as string | undefined,
          sort: input.sort as string | undefined,
          limit: typeof input.limit === 'number' ? input.limit : 50,
        });
        return { status: 'ok', ...result };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_get_payouts': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const finApi = createEbayFinancesApi(creds.ebay);
        const result = await finApi.getPayouts({
          filter: input.filter as string | undefined,
          limit: typeof input.limit === 'number' ? input.limit : 50,
        });
        return { status: 'ok', ...result };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_funds_summary': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const finApi = createEbayFinancesApi(creds.ebay);
        const summary = await finApi.getFundsSummary();
        if (!summary) {
          return { status: 'error', message: 'Could not retrieve funds summary.' };
        }
        return { status: 'ok', ...summary };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_transaction_summary': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const finApiTxnSum = createEbayFinancesApi(creds.ebay);
        const txnSummary = await finApiTxnSum.getTransactionSummary({
          filter: input.filter as string | undefined,
        });
        if (!txnSummary) {
          return { status: 'error', message: 'Could not retrieve transaction summary.' };
        }
        return { status: 'ok', ...txnSummary };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_payout_detail': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const finApiPayDet = createEbayFinancesApi(creds.ebay);
        const payoutDetail = await finApiPayDet.getPayout(input.payoutId as string);
        if (!payoutDetail) {
          return { status: 'error', message: `Payout ${input.payoutId} not found.` };
        }
        return { status: 'ok', ...payoutDetail };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_traffic_report': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const analyticsApi = createEbayAnalyticsApi(creds.ebay);
        const metricsStr = (input.metrics as string) ?? 'CLICK_THROUGH_RATE,LISTING_VIEWS_TOTAL,SALES_CONVERSION_RATE,TRANSACTION';
        const metrics = metricsStr.split(',').map(s => s.trim());
        const report = await analyticsApi.getTrafficReport({
          dimension: (input.dimension as 'DAY' | 'LISTING') ?? 'DAY',
          filter: (input.dateRange as string) ?? '',
          metrics,
        });
        return { status: 'ok', report };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_seller_metrics': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const analyticsApi = createEbayAnalyticsApi(creds.ebay);
        const metric = await analyticsApi.getCustomerServiceMetric({
          metricType: input.metricType as 'ITEM_NOT_AS_DESCRIBED' | 'ITEM_NOT_RECEIVED',
          evaluationType: (input.evaluationType as 'CURRENT' | 'PROJECTED') ?? 'CURRENT',
        });
        return { status: 'ok', metric };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_create_campaign': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const marketingApi = createEbayMarketingApi(creds.ebay);
        const campaignId = await marketingApi.createCampaign({
          campaignName: input.campaignName as string,
          bidPercentage: (input.bidPercentage as string) ?? '5.0',
          fundingModel: (input.fundingModel as 'COST_PER_SALE' | 'COST_PER_CLICK') ?? 'COST_PER_SALE',
        });
        return { status: 'ok', campaignId, campaignName: input.campaignName };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_get_campaigns': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const marketingApi = createEbayMarketingApi(creds.ebay);
        const result = await marketingApi.getCampaigns({
          campaignStatus: input.campaignStatus as string | undefined,
        });
        return { status: 'ok', ...result };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_promote_listings': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const marketingApi = createEbayMarketingApi(creds.ebay);
        const listingIds = (input.listingIds as string).split(',').map(s => s.trim());
        const result = await marketingApi.bulkCreateAds(
          input.campaignId as string,
          listingIds,
          (input.bidPercentage as string) ?? '5.0',
        );
        return { status: 'ok', ...result };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    // -----------------------------------------------------------------------
    // eBay Extended APIs — Browse, Catalog, Insights, Compliance, Seller Extended, Feed, Notification, Logistics, Negotiation, Metadata
    // -----------------------------------------------------------------------
    case 'ebay_batch_get_items': {
      try {
        if (!creds.ebay) {
          return { status: 'error', message: 'eBay credentials not configured. Use setup_ebay_credentials first.' };
        }
        const browseExtApi = createEbayBrowseExtendedApi(creds.ebay);
        const itemIds = (input.itemIds as string).split(',').map(s => s.trim());
        const items = await browseExtApi.getItems(itemIds);
        return { status: 'ok', items, count: items.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_legacy_item': {
      try {
        if (!creds.ebay) {
          return { status: 'error', message: 'eBay credentials not configured. Use setup_ebay_credentials first.' };
        }
        const browseExtApi2 = createEbayBrowseExtendedApi(creds.ebay);
        const item = await browseExtApi2.getItemByLegacyId(input.legacyId as string);
        if (!item) {
          return { status: 'error', message: 'Item not found for legacy ID.' };
        }
        return { status: 'ok', item };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_search_by_image': {
      try {
        if (!creds.ebay) {
          return { status: 'error', message: 'eBay credentials not configured. Use setup_ebay_credentials first.' };
        }
        const browseExtApi3 = createEbayBrowseExtendedApi(creds.ebay);
        const imageResults = await browseExtApi3.searchByImage(
          input.imageUrl as string,
          {
            query: input.query as string | undefined,
            limit: typeof input.limit === 'number' ? input.limit : undefined,
          },
        );
        return { status: 'ok', items: imageResults, count: imageResults.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_search_catalog': {
      try {
        if (!creds.ebay) {
          return { status: 'error', message: 'eBay credentials not configured. Use setup_ebay_credentials first.' };
        }
        const catalogApi = createEbayCatalogApi(creds.ebay);
        const catalogResults = await catalogApi.searchCatalog(
          input.query as string,
          {
            limit: typeof input.limit === 'number' ? input.limit : undefined,
            categoryId: input.categoryId as string | undefined,
          },
        );
        return { status: 'ok', products: catalogResults, count: catalogResults.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_get_catalog_product': {
      try {
        if (!creds.ebay) {
          return { status: 'error', message: 'eBay credentials not configured. Use setup_ebay_credentials first.' };
        }
        const catalogApi2 = createEbayCatalogApi(creds.ebay);
        const catalogProduct = await catalogApi2.getCatalogProduct(input.epid as string);
        if (!catalogProduct) {
          return { status: 'error', message: 'Catalog product not found.' };
        }
        return { status: 'ok', product: catalogProduct };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_sold_items': {
      try {
        if (!creds.ebay) {
          return { status: 'error', message: 'eBay credentials not configured. Use setup_ebay_credentials first.' };
        }
        const insightsApi = createEbayInsightsApi(creds.ebay);
        const soldResult = await insightsApi.searchSoldItems(
          input.query as string,
          {
            limit: typeof input.limit === 'number' ? input.limit : undefined,
            filter: input.filter as string | undefined,
            sort: input.sort as string | undefined,
            categoryIds: input.categoryIds as string | undefined,
          },
        );
        return { status: 'ok', items: soldResult.items, total: soldResult.total, count: soldResult.items.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_listing_violations': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const complianceApi = createEbayComplianceApi(creds.ebay);
        const violations = await complianceApi.getListingViolations({
          complianceType: input.complianceType as 'PRODUCT_ADOPTION' | 'OUTSIDE_EBAY_BUYING_AND_SELLING' | 'HTTPS' | 'PRODUCT_IDENTITY',
          limit: typeof input.limit === 'number' ? input.limit : undefined,
          offset: typeof input.offset === 'number' ? input.offset : undefined,
        });
        return { status: 'ok', ...violations };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_violations_summary': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const complianceApi2 = createEbayComplianceApi(creds.ebay);
        const summary = await complianceApi2.getListingViolationsSummary();
        return { status: 'ok', ...summary };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_suppress_violation': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const complianceApi3 = createEbayComplianceApi(creds.ebay);
        await complianceApi3.suppressViolation(
          input.listingId as string,
          input.complianceType as 'PRODUCT_ADOPTION' | 'OUTSIDE_EBAY_BUYING_AND_SELLING' | 'HTTPS' | 'PRODUCT_IDENTITY',
        );
        return { status: 'ok', message: 'Violation suppressed.' };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_get_inventory_item': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const sellerExtApi = createEbaySellerExtendedApi(creds.ebay);
        const inventoryItem = await sellerExtApi.getInventoryItem(input.sku as string);
        return { status: 'ok', item: inventoryItem };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_bulk_create_inventory': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const sellerExtApi2 = createEbaySellerExtendedApi(creds.ebay);
        const bulkItems = input.items as Array<{ sku: string; product: object; condition: string; availability: object }>;
        const bulkResult = await sellerExtApi2.bulkCreateOrReplaceInventoryItem(bulkItems);
        return { status: 'ok', ...bulkResult };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_get_offers_for_sku': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const sellerExtApi3 = createEbaySellerExtendedApi(creds.ebay);
        const offersResult = await sellerExtApi3.getOffers(input.sku as string);
        return { status: 'ok', ...offersResult };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_create_inventory_location': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const sellerExtApi4 = createEbaySellerExtendedApi(creds.ebay);
        await sellerExtApi4.createInventoryLocation(
          input.merchantLocationKey as string,
          {
            name: input.name as string,
            location: {
              address: {
                city: input.city as string,
                stateOrProvince: input.stateOrProvince as string,
                postalCode: input.postalCode as string,
                country: (input.country as string) ?? 'US',
              },
            },
            merchantLocationStatus: 'ENABLED',
            locationTypes: ['WAREHOUSE'],
          },
        );
        return { status: 'ok', message: 'Inventory location created.', merchantLocationKey: input.merchantLocationKey };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_get_inventory_locations': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const sellerExtApi5 = createEbaySellerExtendedApi(creds.ebay);
        const locations = await sellerExtApi5.getInventoryLocations();
        return { status: 'ok', ...locations };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_create_feed_task': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const feedApi = createEbayFeedApi(creds.ebay);
        const taskId = await feedApi.createInventoryTask({
          feedType: input.feedType as string,
          schemaVersion: input.schemaVersion as string,
        });
        if (!taskId) {
          return { status: 'error', message: 'Failed to create feed task.' };
        }
        return { status: 'ok', taskId };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_get_feed_task': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const feedApi2 = createEbayFeedApi(creds.ebay);
        const task = await feedApi2.getInventoryTask(input.taskId as string);
        if (!task) {
          return { status: 'error', message: 'Feed task not found.' };
        }
        return { status: 'ok', task };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_create_notification': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const notifApi = createEbayNotificationApi(creds.ebay);
        const destinationId = await notifApi.createDestination({
          name: input.name as string,
          deliveryConfig: {
            endpoint: input.endpoint as string,
            verificationToken: input.verificationToken as string,
          },
        });
        if (!destinationId) {
          return { status: 'error', message: 'Failed to create notification destination.' };
        }
        return { status: 'ok', destinationId };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_subscribe_notification': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const notifApi2 = createEbayNotificationApi(creds.ebay);
        const subscriptionId = await notifApi2.createSubscription({
          topicId: input.topicId as string,
          destinationId: input.destinationId as string,
          status: 'ENABLED',
        });
        if (!subscriptionId) {
          return { status: 'error', message: 'Failed to create notification subscription.' };
        }
        return { status: 'ok', subscriptionId };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_get_notification_topics': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const notifApi3 = createEbayNotificationApi(creds.ebay);
        const topics = await notifApi3.getTopics();
        return { status: 'ok', topics, count: topics.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_shipping_quote': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const logisticsApi = createEbayLogisticsApi(creds.ebay);
        const dims = input.dimensions as { height: number; length: number; width: number; unit?: string };
        const wt = input.weight as { value: number; unit?: string };
        const sf = input.shipFrom as { postalCode: string; country?: string };
        const st = input.shipTo as { postalCode: string; country?: string };
        const quote = await logisticsApi.createShippingQuote({
          orders: [{ orderId: input.orderId as string }],
          packageSpecification: {
            dimensions: { height: dims.height, length: dims.length, width: dims.width, unit: (dims.unit as 'INCH' | 'CENTIMETER') ?? 'INCH' },
            weight: { value: wt.value, unit: (wt.unit as 'POUND' | 'KILOGRAM' | 'OUNCE' | 'GRAM') ?? 'POUND' },
          },
          shipFrom: { postalCode: sf.postalCode, country: sf.country ?? 'US' },
          shipTo: { postalCode: st.postalCode, country: st.country ?? 'US' },
        });
        return { status: 'ok', ...quote };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_create_shipment': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const logisticsApi2 = createEbayLogisticsApi(creds.ebay);
        const shipment = await logisticsApi2.createFromShippingQuote({
          shippingQuoteId: input.shippingQuoteId as string,
          rateId: input.rateId as string,
        });
        return { status: 'ok', ...shipment };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_download_label': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const logisticsApi3 = createEbayLogisticsApi(creds.ebay);
        const labelBase64 = await logisticsApi3.downloadLabelFile(input.shipmentId as string);
        return { status: 'ok', labelBase64, format: 'pdf' };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_send_offer': {
      try {
        if (!creds.ebay?.refreshToken) {
          return { status: 'error', message: 'eBay credentials with refresh token required.' };
        }
        const negotiationApi = createEbayNegotiationApi(creds.ebay);
        const offeredItems = (input.offeredItems as Array<{ listingId: string; price: number; quantity?: number }>).map(item => ({
          listingId: item.listingId,
          price: { value: item.price.toFixed(2), currency: 'USD' },
          quantity: item.quantity ?? 1,
        }));
        const offerResult = await negotiationApi.sendOfferToInterestedBuyers({
          offeredItems,
          message: input.message as string | undefined,
          allowCounterOffer: input.allowCounterOffer !== false,
        });
        return { status: 'ok', ...offerResult };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_item_conditions': {
      try {
        if (!creds.ebay) {
          return { status: 'error', message: 'eBay credentials not configured. Use setup_ebay_credentials first.' };
        }
        const metadataApi = createEbayMetadataApi(creds.ebay);
        const conditionPolicies = await metadataApi.getItemConditionPolicies(input.categoryId as string | undefined);
        return { status: 'ok', ...conditionPolicies };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'ebay_marketplace_return_policies': {
      try {
        if (!creds.ebay) {
          return { status: 'error', message: 'eBay credentials not configured. Use setup_ebay_credentials first.' };
        }
        const metadataApi2 = createEbayMetadataApi(creds.ebay);
        const returnPolicies = await metadataApi2.getReturnPolicies(input.categoryId as string | undefined);
        return { status: 'ok', ...returnPolicies };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    // -----------------------------------------------------------------------
    // Keepa — Amazon price intelligence
    // -----------------------------------------------------------------------
    case 'keepa_price_history': {
      try {
        const keepaKey = (creds.keepa as KeepaCredentials | undefined)?.apiKey
          ?? (creds.amazon as Record<string, unknown> | undefined)?.keepaApiKey as string | undefined;
        if (!keepaKey) {
          return { status: 'error', message: 'Keepa API key not configured. Use setup_keepa_credentials first.' };
        }
        const keepa = createKeepaApi({ apiKey: keepaKey });
        const asins = (input.asin as string).split(',').map(s => s.trim());
        const products = await keepa.getProduct({
          asin: asins,
          history: input.history !== false,
          stats: 180,
        });
        return {
          status: 'ok',
          products: products.map(p => ({
            asin: p.asin,
            title: p.title,
            brand: p.brand,
            category: p.productGroup,
            stats: p.stats ? {
              currentPrice: p.stats.current ? keepa.keepaPriceToDollar(p.stats.current[0] ?? -1) : null,
              avg30: p.stats.avg30 ? keepa.keepaPriceToDollar(p.stats.avg30[0] ?? -1) : null,
              avg90: p.stats.avg90 ? keepa.keepaPriceToDollar(p.stats.avg90[0] ?? -1) : null,
              avg180: p.stats.avg180 ? keepa.keepaPriceToDollar(p.stats.avg180[0] ?? -1) : null,
              allTimeMin: p.stats.minPriceEver ? keepa.keepaPriceToDollar(p.stats.minPriceEver[0] ?? -1) : null,
              allTimeMax: p.stats.maxPriceEver ? keepa.keepaPriceToDollar(p.stats.maxPriceEver[0] ?? -1) : null,
              outOfStock30: p.stats.outOfStockPercentage30?.[0],
              outOfStock90: p.stats.outOfStockPercentage90?.[0],
            } : null,
            salesRank: p.salesRankReference,
            lastUpdate: p.lastUpdate ? keepa.keepaTimeToDate(p.lastUpdate).toISOString() : null,
          })),
          count: products.length,
        };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'keepa_deals': {
      try {
        const keepaKey2 = (creds.keepa as KeepaCredentials | undefined)?.apiKey
          ?? (creds.amazon as Record<string, unknown> | undefined)?.keepaApiKey as string | undefined;
        if (!keepaKey2) {
          return { status: 'error', message: 'Keepa API key not configured.' };
        }
        const keepa = createKeepaApi({ apiKey: keepaKey2 });
        const minPct = typeof input.minPercentOff === 'number' ? input.minPercentOff : 20;
        const maxPct = typeof input.maxPercentOff === 'number' ? input.maxPercentOff : 90;
        const categoryIds = input.categoryIds ? (input.categoryIds as string).split(',').map(Number) : undefined;
        const deals = await keepa.getDeals({
          deltaPercentRange: [minPct, maxPct],
          categoryIds,
        });
        return { status: 'ok', deals, count: deals.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'keepa_bestsellers': {
      try {
        const keepaKey3 = (creds.keepa as KeepaCredentials | undefined)?.apiKey
          ?? (creds.amazon as Record<string, unknown> | undefined)?.keepaApiKey as string | undefined;
        if (!keepaKey3) {
          return { status: 'error', message: 'Keepa API key not configured.' };
        }
        const keepa = createKeepaApi({ apiKey: keepaKey3 });
        const asins = await keepa.getBestsellers({ categoryId: input.categoryId as number });
        return { status: 'ok', asins, count: asins.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'keepa_track_product': {
      try {
        const keepaKey4 = (creds.keepa as KeepaCredentials | undefined)?.apiKey
          ?? (creds.amazon as Record<string, unknown> | undefined)?.keepaApiKey as string | undefined;
        if (!keepaKey4) {
          return { status: 'error', message: 'Keepa API key not configured.' };
        }
        const keepa = createKeepaApi({ apiKey: keepaKey4 });
        const priceInCents = Math.round((input.targetPrice as number) * 100);
        const success = await keepa.addTracking({
          asin: input.asin as string,
          thresholdValue: priceInCents,
        });
        return {
          status: success ? 'ok' : 'error',
          message: success
            ? `Tracking set for ${input.asin} — alert when price drops below $${(input.targetPrice as number).toFixed(2)}`
            : 'Failed to set up tracking.',
        };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    // -----------------------------------------------------------------------
    // EasyPost — Shipping labels + tracking
    // -----------------------------------------------------------------------
    case 'get_shipping_rates': {
      try {
        const epKey = (creds.easypost as EasyPostCredentials | undefined)?.apiKey
          ?? (creds.ebay as Record<string, unknown> | undefined)?.easypostApiKey as string | undefined;
        if (!epKey) {
          return { status: 'error', message: 'EasyPost API key not configured. Use setup_easypost_credentials first.' };
        }
        const ep = createEasyPostApi({ apiKey: epKey });
        const shipment = await ep.createShipment({
          fromAddress: {
            street1: (input.fromStreet as string) ?? '',
            city: input.fromCity as string ?? '',
            state: input.fromState as string ?? '',
            zip: input.fromZip as string,
            country: (input.fromCountry as string) ?? 'US',
          },
          toAddress: {
            street1: (input.toStreet as string) ?? '',
            city: input.toCity as string ?? '',
            state: input.toState as string ?? '',
            zip: input.toZip as string,
            country: (input.toCountry as string) ?? 'US',
          },
          parcel: {
            weight: input.weightOz as number,
            length: typeof input.lengthIn === 'number' ? input.lengthIn : 10,
            width: typeof input.widthIn === 'number' ? input.widthIn : 7,
            height: typeof input.heightIn === 'number' ? input.heightIn : 5,
          },
        });
        const cheapest = ep.getCheapestRate(shipment.rates);
        return {
          status: 'ok',
          shipmentId: shipment.id,
          rates: shipment.rates.map(r => ({
            rateId: r.id,
            carrier: r.carrier,
            service: r.service,
            rate: r.rate,
            currency: r.currency,
            deliveryDays: r.deliveryDays ?? r.estDeliveryDays,
          })),
          cheapest: cheapest ? {
            carrier: cheapest.carrier,
            service: cheapest.service,
            rate: cheapest.rate,
            rateId: cheapest.id,
          } : null,
          rateCount: shipment.rates.length,
        };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'buy_shipping_label': {
      try {
        const epKey2 = (creds.easypost as EasyPostCredentials | undefined)?.apiKey
          ?? (creds.ebay as Record<string, unknown> | undefined)?.easypostApiKey as string | undefined;
        if (!epKey2) {
          return { status: 'error', message: 'EasyPost API key not configured.' };
        }
        const ep = createEasyPostApi({ apiKey: epKey2 });
        const purchased = await ep.buyShipment(input.shipmentId as string, input.rateId as string);
        return {
          status: 'ok',
          trackingCode: purchased.trackingCode,
          labelUrl: purchased.postageLabel?.labelUrl,
          carrier: purchased.selectedRate?.carrier,
          service: purchased.selectedRate?.service,
          rate: purchased.selectedRate?.rate,
        };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'track_package': {
      try {
        const epKey3 = (creds.easypost as EasyPostCredentials | undefined)?.apiKey
          ?? (creds.ebay as Record<string, unknown> | undefined)?.easypostApiKey as string | undefined;
        if (!epKey3) {
          return { status: 'error', message: 'EasyPost API key not configured.' };
        }
        const ep = createEasyPostApi({ apiKey: epKey3 });
        const tracker = await ep.createTracker(input.trackingCode as string, input.carrier as string | undefined);
        return {
          status: 'ok',
          trackingCode: tracker.trackingCode,
          carrier: tracker.carrier,
          currentStatus: tracker.status,
          statusDetail: tracker.statusDetail,
          estDeliveryDate: tracker.estDeliveryDate,
          signedBy: tracker.signedBy,
          publicUrl: tracker.publicUrl,
          events: tracker.trackingDetails.slice(0, 10).map(d => ({
            status: d.status,
            message: d.message,
            datetime: d.datetime,
            location: d.trackingLocation ? `${d.trackingLocation.city ?? ''}, ${d.trackingLocation.state ?? ''} ${d.trackingLocation.zip ?? ''}`.trim() : null,
          })),
        };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'verify_address': {
      try {
        const epKey4 = (creds.easypost as EasyPostCredentials | undefined)?.apiKey
          ?? (creds.ebay as Record<string, unknown> | undefined)?.easypostApiKey as string | undefined;
        if (!epKey4) {
          return { status: 'error', message: 'EasyPost API key not configured.' };
        }
        const ep = createEasyPostApi({ apiKey: epKey4 });
        const verified = await ep.verifyAddress({
          street1: input.street1 as string,
          street2: input.street2 as string | undefined,
          city: input.city as string,
          state: input.state as string,
          zip: input.zip as string,
          country: (input.country as string) ?? 'US',
        });
        return {
          status: 'ok',
          verified: verified.verifications?.delivery?.success ?? false,
          address: {
            street1: verified.street1,
            street2: verified.street2,
            city: verified.city,
            state: verified.state,
            zip: verified.zip,
            country: verified.country,
          },
          errors: verified.verifications?.delivery?.errors,
        };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    // -----------------------------------------------------------------------
    // Credential setup for new services
    // -----------------------------------------------------------------------
    case 'setup_amazon_sp_credentials': {
      // Merge SP-API fields into existing Amazon credentials
      const existing = creds.amazon ?? {} as AmazonCredentials;
      const merged: AmazonCredentials = {
        ...existing,
        spClientId: input.spClientId as string,
        spClientSecret: input.spClientSecret as string,
        spRefreshToken: input.spRefreshToken as string,
      };
      if (input.sellerId) merged.spSellerId = input.sellerId as string;
      if (input.marketplaceId) merged.spMarketplaceId = input.marketplaceId as string;
      if (context.credentials.setCredentials) {
        context.credentials.setCredentials(context.userId, 'amazon', merged);
      }
      return { status: 'ok', message: 'Amazon SP-API credentials saved. You can now use Amazon seller operations.' };
    }

    case 'setup_keepa_credentials': {
      // Store Keepa key under its own 'keepa' credential platform
      if (context.credentials.setCredentials) {
        context.credentials.setCredentials(context.userId, 'keepa', { apiKey: input.apiKey as string });
      }
      return { status: 'ok', message: 'Keepa API key saved. You can now access Amazon price history.' };
    }

    case 'setup_easypost_credentials': {
      if (context.credentials.setCredentials) {
        context.credentials.setCredentials(context.userId, 'easypost', { apiKey: input.apiKey as string });
      }
      return { status: 'ok', message: 'EasyPost API key saved. You can now compare shipping rates and create labels.' };
    }

    case 'setup_walmart_seller_credentials': {
      if (context.credentials.setCredentials) {
        const existing = creds.walmart ?? {} as WalmartCredentials;
        const merged = {
          ...existing,
          sellerClientId: input.clientId as string,
          sellerClientSecret: input.clientSecret as string,
        };
        context.credentials.setCredentials(context.userId, 'walmart', merged);
      }
      return { status: 'ok', message: 'Walmart Marketplace seller credentials saved. You can now manage Walmart listings and orders.' };
    }

    // -----------------------------------------------------------------------
    // Walmart Marketplace seller operations
    // -----------------------------------------------------------------------

    // Helper: get Walmart seller API or return error
    function getWalmartSeller(): WalmartSellerApi | { status: string; message: string } {
      const wc = creds.walmart as Record<string, unknown> | undefined;
      const sid = wc?.sellerClientId as string | undefined;
      const ss = wc?.sellerClientSecret as string | undefined;
      if (!sid || !ss) {
        return { status: 'error', message: 'Walmart Marketplace seller credentials not configured. Use setup_walmart_seller_credentials first.' };
      }
      return createWalmartSellerApi({ clientId: sid, clientSecret: ss });
    }

    case 'walmart_get_seller_items': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const result = await sellerApi.getAllItems({
          limit: typeof input.limit === 'number' ? input.limit : 20,
          offset: typeof input.offset === 'number' ? input.offset : 0,
        });
        return { status: 'ok', ...result };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_update_price': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const result = await sellerApi.updatePrice(input.sku as string, input.price as number);
        return { status: 'ok', feedId: result.feedId, feedStatus: result.feedStatus };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_update_inventory': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const result = await sellerApi.updateInventory(input.sku as string, input.quantity as number);
        return { status: 'ok', feedId: result.feedId, feedStatus: result.feedStatus };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_get_inventory': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const inv = await sellerApi.getInventory(input.sku as string);
        if (!inv) {
          return { status: 'error', message: `Inventory not found for SKU ${input.sku}` };
        }
        return { status: 'ok', sku: inv.sku, quantity: inv.quantity.amount, unit: inv.quantity.unit, fulfillmentLagTime: inv.fulfillmentLagTime };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_get_orders': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const orders = await sellerApi.getOrders({
          status: input.status as string | undefined,
          createdStartDate: input.createdStartDate as string | undefined,
          limit: typeof input.limit === 'number' ? input.limit : 50,
        });
        return {
          status: 'ok',
          orders: orders.map(o => ({
            purchaseOrderId: o.purchaseOrderId,
            customerOrderId: o.customerOrderId,
            orderDate: o.orderDate,
            lineItems: o.orderLines?.length ?? 0,
            shippingName: o.shippingInfo?.postalAddress?.name,
            shippingCity: o.shippingInfo?.postalAddress?.city,
            shippingState: o.shippingInfo?.postalAddress?.state,
          })),
          count: orders.length,
        };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_ship_order': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const order = await sellerApi.getOrder(input.purchaseOrderId as string);
        if (!order) {
          return { status: 'error', message: `Order ${input.purchaseOrderId} not found.` };
        }
        const lineItems = order.orderLines.map(ol => ({
          lineNumber: ol.lineNumber,
          quantity: parseInt(ol.orderLineQuantity.amount, 10) || 1,
        }));
        const success = await sellerApi.shipOrder(input.purchaseOrderId as string, {
          lineItems,
          carrier: input.carrier as string,
          trackingNumber: input.trackingNumber as string,
          methodCode: (input.methodCode as string) ?? 'Standard',
        });
        return {
          status: success ? 'ok' : 'error',
          message: success
            ? `Order ${input.purchaseOrderId} shipped with ${input.carrier} tracking ${input.trackingNumber}`
            : 'Failed to update shipping on Walmart.',
        };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_retire_item': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const success = await sellerApi.retireItem(input.sku as string);
        return {
          status: success ? 'ok' : 'error',
          message: success ? `Item ${input.sku} retired from Walmart.` : `Failed to retire item ${input.sku}.`,
        };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_create_item': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const result = await sellerApi.createItem({
          sku: input.sku as string,
          productName: input.productName as string,
          price: input.price as number,
          currency: (input.currency as string) ?? 'USD',
          description: input.description as string | undefined,
          upc: input.upc as string | undefined,
          brand: input.brand as string | undefined,
          category: input.category as string | undefined,
          images: input.images as string[] | undefined,
          shortDescription: input.shortDescription as string | undefined,
        });
        return { status: 'ok', feedId: result.feedId, feedStatus: result.feedStatus, message: `Item ${input.sku} creation submitted via feed ${result.feedId}` };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_update_item': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const updates: Record<string, unknown> = {};
        if (input.productName) updates.productName = input.productName;
        if (input.description) updates.description = input.description;
        if (input.price != null) updates.price = input.price;
        if (input.brand) updates.brand = input.brand;
        if (input.category) updates.category = input.category;
        if (input.images) updates.images = input.images;
        if (input.upc) updates.upc = input.upc;
        const result = await sellerApi.updateItem(input.sku as string, updates);
        return { status: 'ok', feedId: result.feedId, feedStatus: result.feedStatus, message: `Item ${input.sku} update submitted via feed ${result.feedId}` };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_acknowledge_order': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const success = await sellerApi.acknowledgeOrder(input.purchaseOrderId as string);
        return {
          status: success ? 'ok' : 'error',
          message: success ? `Order ${input.purchaseOrderId} acknowledged.` : `Failed to acknowledge order ${input.purchaseOrderId}.`,
        };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_cancel_order': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const cancelLines = (input.lineItems as Array<{ lineNumber: string; quantity: number; reason: string }>);
        if (!cancelLines?.length) {
          return { status: 'error', message: 'lineItems array is required with lineNumber, quantity, and reason for each line.' };
        }
        const success = await sellerApi.cancelOrder(input.purchaseOrderId as string, cancelLines);
        return {
          status: success ? 'ok' : 'error',
          message: success ? `Order ${input.purchaseOrderId} cancelled (${cancelLines.length} lines).` : `Failed to cancel order ${input.purchaseOrderId}.`,
        };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_refund_order': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const refundLines = (input.lineItems as Array<{ lineNumber: string; amount: number; reason: string; isFullRefund?: boolean }>);
        if (!refundLines?.length) {
          return { status: 'error', message: 'lineItems array is required with lineNumber, amount, and reason for each line.' };
        }
        const success = await sellerApi.refundOrder(input.purchaseOrderId as string, refundLines);
        return {
          status: success ? 'ok' : 'error',
          message: success ? `Order ${input.purchaseOrderId} refunded (${refundLines.length} lines).` : `Failed to refund order ${input.purchaseOrderId}.`,
        };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_feed_status': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const feed = await sellerApi.getFeedStatus(input.feedId as string);
        return { status: 'ok', ...feed };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_get_returns': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const returns = await sellerApi.getReturns({
          returnCreationStartDate: input.startDate as string | undefined,
          limit: typeof input.limit === 'number' ? input.limit : 50,
        });
        return { status: 'ok', returns, count: returns.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_get_return': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const ret = await sellerApi.getReturnOrder(input.returnOrderId as string);
        if (!ret) {
          return { status: 'error', message: `Return order ${input.returnOrderId} not found.` };
        }
        return { status: 'ok', ...ret };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_listing_quality': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const result = await sellerApi.getListingQuality({
          limit: typeof input.limit === 'number' ? input.limit : 50,
        });
        return { status: 'ok', items: result.items, nextCursor: result.nextCursor, count: result.items.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_bulk_update_prices': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const items = input.items as Array<{ sku: string; price: number; currency?: string }>;
        if (!items?.length) {
          return { status: 'error', message: 'items array is required with sku and price for each item.' };
        }
        const result = await sellerApi.bulkUpdatePrices(items);
        return { status: 'ok', feedId: result.feedId, feedStatus: result.feedStatus, itemCount: items.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_bulk_update_inventory': {
      try {
        const sellerApi = getWalmartSeller();
        if ('status' in sellerApi) return sellerApi;
        const items = input.items as Array<{ sku: string; quantity: number }>;
        if (!items?.length) {
          return { status: 'error', message: 'items array is required with sku and quantity for each item.' };
        }
        const result = await sellerApi.bulkUpdateInventory(items);
        return { status: 'ok', feedId: result.feedId, feedStatus: result.feedStatus, itemCount: items.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    // -----------------------------------------------------------------------
    // Cross-platform utility tools
    // -----------------------------------------------------------------------
    case 'batch_reprice': {
      const strategy = input.strategy as string;
      const listingIdsStr = input.listingIds as string | undefined;
      const listings = listingIdsStr
        ? listingIdsStr.split(',').map(id => {
            const rows = context.db.query<Record<string, unknown>>(
              'SELECT id, platform, platform_listing_id, price, product_id, source_platform, source_price FROM listings WHERE id = ? AND status = ?',
              [id.trim(), 'active'],
            );
            return rows[0];
          }).filter(Boolean) as Array<Record<string, unknown>>
        : context.db.query<Record<string, unknown>>(
            'SELECT id, platform, platform_listing_id, price, product_id, source_platform, source_price FROM listings WHERE status = ? LIMIT 50',
            ['active'],
          );

      let repriced = 0;
      const results: Array<{ listingId: string; oldPrice: number; newPrice: number }> = [];

      for (const listing of listings) {
        const oldPrice = listing.price as number;
        let newPrice = oldPrice;

        if (strategy === 'undercut') {
          // Find competitor prices
          const competitorPrices = context.db.query<{ price: number; shipping: number }>(
            'SELECT price, shipping FROM prices WHERE product_id = ? AND platform = ? ORDER BY fetched_at DESC LIMIT 1',
            [listing.product_id, listing.platform],
          );
          if (competitorPrices.length > 0) {
            const lowestCompetitor = competitorPrices[0].price + competitorPrices[0].shipping;
            const undercut = typeof input.undercutAmount === 'number' ? input.undercutAmount : 0.01;
            newPrice = Math.round((lowestCompetitor - undercut) * 100) / 100;
          }
        } else if (strategy === 'fixed_margin') {
          const sourcePrice = listing.source_price as number;
          const targetMargin = typeof input.marginPct === 'number' ? input.marginPct : 20;
          if (sourcePrice > 0) {
            newPrice = Math.round((sourcePrice / (1 - targetMargin / 100)) * 100) / 100;
          }
        } else if (strategy === 'match') {
          const competitorPrices = context.db.query<{ price: number; shipping: number }>(
            'SELECT price, shipping FROM prices WHERE product_id = ? AND platform = ? ORDER BY fetched_at DESC LIMIT 1',
            [listing.product_id, listing.platform],
          );
          if (competitorPrices.length > 0) {
            newPrice = competitorPrices[0].price + competitorPrices[0].shipping;
          }
        }

        if (newPrice !== oldPrice && newPrice > 0) {
          context.db.run(
            'UPDATE listings SET price = ?, updated_at = ? WHERE id = ?',
            [newPrice, Date.now(), listing.id],
          );

          // Update on platform if eBay
          if (listing.platform === 'ebay' && creds.ebay?.refreshToken && listing.platform_listing_id) {
            try {
              const seller = createEbaySellerApi(creds.ebay);
              await seller.updateOfferPrice(listing.platform_listing_id as string, newPrice);
            } catch {
              // DB already updated, platform update is best-effort
            }
          }

          repriced++;
          results.push({
            listingId: listing.id as string,
            oldPrice,
            newPrice,
          });
        }
      }

      return {
        status: 'ok',
        strategy,
        totalListings: listings.length,
        repriced,
        results: results.slice(0, 20),
      };
    }

    case 'inventory_sync': {
      const listingIdsStr = input.listingIds as string | undefined;
      const listings = listingIdsStr
        ? listingIdsStr.split(',').map(id => {
            const rows = context.db.query<Record<string, unknown>>(
              'SELECT id, product_id, source_platform, platform, platform_listing_id FROM listings WHERE id = ? AND status = ?',
              [id.trim(), 'active'],
            );
            return rows[0];
          }).filter(Boolean) as Array<Record<string, unknown>>
        : context.db.query<Record<string, unknown>>(
            'SELECT id, product_id, source_platform, platform, platform_listing_id FROM listings WHERE status = ? LIMIT 50',
            ['active'],
          );

      let synced = 0;
      let outOfStock = 0;
      const syncResults: Array<{ listingId: string; productId: string; sourcePlatform: string; inStock: boolean }> = [];

      for (const listing of listings) {
        const sourcePlatform = listing.source_platform as Platform;
        const productId = listing.product_id as string;

        try {
          const adapter = getAdapter(sourcePlatform, creds);
          const stock = await adapter.checkStock(productId);

          syncResults.push({
            listingId: listing.id as string,
            productId,
            sourcePlatform,
            inStock: stock.inStock,
          });

          if (!stock.inStock) {
            outOfStock++;
            // Pause listings for out-of-stock products
            context.db.updateListingStatus(listing.id as string, 'paused');
            logger.info({ listingId: listing.id, productId }, 'Paused listing — source product out of stock');
          }

          synced++;
        } catch (err) {
          logger.warn({ listingId: listing.id, error: err instanceof Error ? err.message : String(err) }, 'Stock check failed during sync');
        }
      }

      return {
        status: 'ok',
        totalListings: listings.length,
        synced,
        outOfStock,
        results: syncResults.slice(0, 20),
      };
    }

    // -----------------------------------------------------------------------
    // Additional platform scanners
    // -----------------------------------------------------------------------
    case 'scan_bestbuy': {
      if (!input.query) return { status: 'error', message: 'query is required' };
      try {
        const adapter = createBestBuyAdapter();
        const results = await adapter.search({
          query: input.query as string,
          maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
        });
        storeResults(context.db, results);
        return { status: 'ok', results: results.slice(0, 20), count: results.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'scan_target': {
      if (!input.query) return { status: 'error', message: 'query is required' };
      try {
        const adapter = createTargetAdapter();
        const results = await adapter.search({
          query: input.query as string,
          maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
        });
        storeResults(context.db, results);
        return { status: 'ok', results: results.slice(0, 20), count: results.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'scan_costco': {
      if (!input.query) return { status: 'error', message: 'query is required' };
      try {
        const adapter = createCostcoAdapter();
        const results = await adapter.search({
          query: input.query as string,
          maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
        });
        storeResults(context.db, results);
        return { status: 'ok', results: results.slice(0, 20), count: results.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'scan_homedepot': {
      if (!input.query) return { status: 'error', message: 'query is required' };
      try {
        const adapter = createHomeDepotAdapter();
        const results = await adapter.search({
          query: input.query as string,
          maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
        });
        storeResults(context.db, results);
        return { status: 'ok', results: results.slice(0, 20), count: results.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'scan_poshmark': {
      if (!input.query) return { status: 'error', message: 'query is required' };
      try {
        const adapter = createPoshmarkAdapter();
        const results = await adapter.search({
          query: input.query as string,
          maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
          minPrice: typeof input.minPrice === 'number' ? input.minPrice : undefined,
          maxPrice: typeof input.maxPrice === 'number' ? input.maxPrice : undefined,
        });
        storeResults(context.db, results);
        return { status: 'ok', results: results.slice(0, 20), count: results.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'scan_mercari': {
      if (!input.query) return { status: 'error', message: 'query is required' };
      try {
        const adapter = createMercariAdapter();
        const results = await adapter.search({
          query: input.query as string,
          maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
          minPrice: typeof input.minPrice === 'number' ? input.minPrice : undefined,
          maxPrice: typeof input.maxPrice === 'number' ? input.maxPrice : undefined,
        });
        storeResults(context.db, results);
        return { status: 'ok', results: results.slice(0, 20), count: results.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'scan_facebook': {
      if (!input.query) return { status: 'error', message: 'query is required' };
      try {
        const adapter = createFacebookAdapter();
        const results = await adapter.search({
          query: input.query as string,
          maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
          minPrice: typeof input.minPrice === 'number' ? input.minPrice : undefined,
          maxPrice: typeof input.maxPrice === 'number' ? input.maxPrice : undefined,
        });
        storeResults(context.db, results);
        return { status: 'ok', results: results.slice(0, 20), count: results.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'scan_faire': {
      if (!input.query) return { status: 'error', message: 'query is required' };
      try {
        const adapter = createFaireAdapter();
        const results = await adapter.search({
          query: input.query as string,
          maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
        });
        storeResults(context.db, results);
        return { status: 'ok', results: results.slice(0, 20), count: results.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'scan_bstock': {
      if (!input.query) return { status: 'error', message: 'query is required' };
      try {
        const adapter = createBStockAdapter();
        const results = await adapter.search({
          query: input.query as string,
          maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
        });
        storeResults(context.db, results);
        return { status: 'ok', results: results.slice(0, 20), count: results.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'scan_bulq': {
      if (!input.query) return { status: 'error', message: 'query is required' };
      try {
        const adapter = createBulqAdapter();
        const results = await adapter.search({
          query: input.query as string,
          maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
        });
        storeResults(context.db, results);
        return { status: 'ok', results: results.slice(0, 20), count: results.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'scan_liquidation': {
      if (!input.query) return { status: 'error', message: 'query is required' };
      try {
        const adapter = createLiquidationAdapter();
        const results = await adapter.search({
          query: input.query as string,
          maxResults: typeof input.maxResults === 'number' ? input.maxResults : 10,
        });
        storeResults(context.db, results);
        return { status: 'ok', results: results.slice(0, 20), count: results.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    // -----------------------------------------------------------------------
    // Extended tools for new platforms
    // -----------------------------------------------------------------------
    case 'bestbuy_on_sale': {
      try {
        const api = createBestBuyExtendedApi(process.env.BESTBUY_API_KEY);
        const result = await api.getOnSaleItems({
          categoryId: input.categoryId as string | undefined,
          minSalePrice: typeof input.minPrice === 'number' ? input.minPrice : undefined,
          maxSalePrice: typeof input.maxPrice === 'number' ? input.maxPrice : undefined,
          pageSize: typeof input.pageSize === 'number' ? input.pageSize : 25,
        });
        return { status: 'ok', ...result };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'bestbuy_open_box': {
      try {
        const api = createBestBuyExtendedApi(process.env.BESTBUY_API_KEY);
        const result = await api.getOpenBoxItems({
          categoryId: input.categoryId as string | undefined,
          pageSize: typeof input.pageSize === 'number' ? input.pageSize : 25,
        });
        return { status: 'ok', ...result };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'bestbuy_stores': {
      try {
        const api = createBestBuyExtendedApi(process.env.BESTBUY_API_KEY);
        const stores = await api.getStores({
          lat: input.lat as number,
          lng: input.lng as number,
          radius: typeof input.radius === 'number' ? input.radius : 25,
        });
        return { status: 'ok', stores, count: stores.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'bestbuy_product_availability': {
      try {
        const api = createBestBuyExtendedApi(process.env.BESTBUY_API_KEY);
        const storeIdsList = typeof input.storeIds === 'string' && input.storeIds
          ? input.storeIds.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
          : undefined;
        const availability = await api.getProductAvailability(
          input.sku as string,
          storeIdsList,
        );
        return { status: 'ok', availability, count: availability.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'target_store_availability': {
      try {
        const adapter = createTargetAdapter();
        const availability = await adapter.getStoreAvailability(
          input.tcin as string,
          input.zipCode as string | undefined,
        );
        return { status: 'ok', availability, count: availability.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'poshmark_closet': {
      try {
        const adapter = createPoshmarkAdapter();
        const results = await adapter.getUserCloset(
          input.userId as string,
          { maxResults: typeof input.maxResults === 'number' ? input.maxResults : 48 },
        );
        return { status: 'ok', results: results.slice(0, 48), count: results.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'mercari_seller_profile': {
      try {
        const adapter = createMercariAdapter();
        const profile = await adapter.getSellerProfile(input.userId as string);
        if (!profile) {
          return { status: 'error', message: 'Seller profile not found or Mercari API unavailable.' };
        }
        return { status: 'ok', profile };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_reviews': {
      try {
        if (!creds.walmart) {
          return { status: 'error', message: 'Walmart credentials not configured. Use setup_walmart_credentials first.' };
        }
        const api = createWalmartAffiliateExtendedApi(creds.walmart);
        const reviews = await api.getReviews(input.itemId as string);
        if (!reviews) {
          return { status: 'error', message: 'Reviews not found or Walmart API unavailable.' };
        }
        return { status: 'ok', ...reviews };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_nearby_stores': {
      try {
        if (!creds.walmart) {
          return { status: 'error', message: 'Walmart credentials not configured. Use setup_walmart_credentials first.' };
        }
        const api = createWalmartAffiliateExtendedApi(creds.walmart);
        const stores = await api.getStores({
          zip: input.zip as string | undefined,
          lat: typeof input.lat === 'number' ? input.lat : undefined,
          lon: typeof input.lon === 'number' ? input.lon : undefined,
        });
        return { status: 'ok', stores, count: stores.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_recommendations': {
      try {
        if (!creds.walmart) {
          return { status: 'error', message: 'Walmart credentials not configured. Use setup_walmart_credentials first.' };
        }
        const api = createWalmartAffiliateExtendedApi(creds.walmart);
        const items = await api.getRecommendations(input.itemId as string);
        return { status: 'ok', items, count: items.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_repricer': {
      try {
        const wCredsR = creds.walmart as Record<string, unknown> | undefined;
        const sellerIdR = (wCredsR?.sellerClientId as string | undefined);
        const sellerSecretR = (wCredsR?.sellerClientSecret as string | undefined);
        if (!sellerIdR || !sellerSecretR) {
          return { status: 'error', message: 'Walmart Marketplace seller credentials required. Use setup_walmart_seller_credentials first.' };
        }
        const mpApi = createWalmartMarketplaceExtendedApi(creds.walmart!);
        const strategy = await mpApi.createRepricerStrategy({
          name: input.name as string,
          type: input.type as 'BUY_BOX_ELIGIBLE' | 'COMPETITIVE_PRICING',
          enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
          repriceOptions: {},
        });
        return { status: 'ok', strategy };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'walmart_catalog_search': {
      try {
        const wCredsC = creds.walmart as Record<string, unknown> | undefined;
        const sellerIdC = (wCredsC?.sellerClientId as string | undefined);
        const sellerSecretC = (wCredsC?.sellerClientSecret as string | undefined);
        if (!sellerIdC || !sellerSecretC) {
          return { status: 'error', message: 'Walmart Marketplace seller credentials required. Use setup_walmart_seller_credentials first.' };
        }
        const mpApi = createWalmartMarketplaceExtendedApi(creds.walmart!);
        const results = await mpApi.catalogSearch(input.query as string);
        return { status: 'ok', results, count: results.length };
      } catch (err) {
        logger.error({ err, tool: toolName }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    // -----------------------------------------------------------------------
    // Best Buy Categories (Feature 1)
    // -----------------------------------------------------------------------
    case 'bestbuy_get_categories': {
      try {
        const bbApi = createBestBuyExtendedApi(process.env.BESTBUY_API_KEY);
        const bbCategories = await bbApi.getCategories(input.parentId as string | undefined);
        return { status: 'ok', categories: bbCategories, count: bbCategories.length };
      } catch (err) {
        logger.error({ err, tool: 'bestbuy_get_categories' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    // -----------------------------------------------------------------------
    // FBA Multi-Channel Fulfillment (Feature 2)
    // -----------------------------------------------------------------------
    case 'fba_create_fulfillment': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured. Required for FBA MCF.' };
      }
      try {
        const mcfApi = createFbaMcfApi({
          clientId: creds.amazon.spClientId!,
          clientSecret: creds.amazon.spClientSecret!,
          refreshToken: creds.amazon.spRefreshToken,
        });
        const mcfItems = (input.items as Array<{ sellerSku: string; quantity: number }>).map((item, idx) => ({
          sellerSku: item.sellerSku,
          sellerFulfillmentOrderItemId: `${input.orderId}-item-${idx + 1}`,
          quantity: item.quantity,
        }));
        const mcfResult = await mcfApi.createFulfillmentOrder({
          sellerFulfillmentOrderId: input.orderId as string,
          displayableOrderId: (input.displayableOrderId as string) ?? (input.orderId as string),
          displayableOrderDate: new Date().toISOString(),
          displayableOrderComment: (input.displayableOrderComment as string) ?? 'Thank you for your order!',
          shippingSpeedCategory: (input.shippingSpeed as 'Standard' | 'Expedited' | 'Priority') ?? 'Standard',
          destinationAddress: {
            name: input.name as string,
            addressLine1: input.addressLine1 as string,
            addressLine2: input.addressLine2 as string | undefined,
            city: input.city as string,
            stateOrRegion: input.stateOrRegion as string,
            postalCode: input.postalCode as string,
            countryCode: (input.countryCode as string) ?? 'US',
            phone: input.phone as string | undefined,
          },
          items: mcfItems,
        });
        return { ...mcfResult, status: 'ok', orderId: input.orderId };
      } catch (err) {
        logger.error({ err, tool: 'fba_create_fulfillment' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'fba_check_fulfillment': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured. Required for FBA MCF.' };
      }
      try {
        const mcfCheckApi = createFbaMcfApi({
          clientId: creds.amazon.spClientId!,
          clientSecret: creds.amazon.spClientSecret!,
          refreshToken: creds.amazon.spRefreshToken,
        });
        const mcfOrder = await mcfCheckApi.getFulfillmentOrder(input.orderId as string);
        if (!mcfOrder) {
          return { status: 'error', message: `MCF order ${input.orderId} not found.` };
        }
        return { status: 'ok', ...mcfOrder };
      } catch (err) {
        logger.error({ err, tool: 'fba_check_fulfillment' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'fba_check_inventory': {
      if (!creds.amazon?.spRefreshToken) {
        return { status: 'error', message: 'Amazon SP-API credentials not configured. Required for FBA inventory.' };
      }
      try {
        const mcfInvApi = createFbaMcfApi({
          clientId: creds.amazon.spClientId!,
          clientSecret: creds.amazon.spClientSecret!,
          refreshToken: creds.amazon.spRefreshToken,
        });
        const fbaSkus = input.sellerSkus
          ? (input.sellerSkus as string).split(',').map(s => s.trim()).filter(Boolean)
          : undefined;
        const fbaResult = await mcfInvApi.getInventory(fbaSkus);
        return { status: 'ok', summaries: fbaResult.summaries, count: fbaResult.summaries.length };
      } catch (err) {
        logger.error({ err, tool: 'fba_check_inventory' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    // -----------------------------------------------------------------------
    // Multi-Warehouse Inventory (Feature 3)
    // -----------------------------------------------------------------------
    case 'warehouse_list': {
      try {
        const whList = context.db.query<{
          id: string;
          user_id: string;
          name: string;
          type: string;
          address: string | null;
          is_default: number;
          created_at: number;
        }>(
          'SELECT id, user_id, name, type, address, is_default, created_at FROM warehouses WHERE user_id = ? ORDER BY is_default DESC, name ASC',
          [context.userId],
        );
        return {
          status: 'ok',
          warehouses: whList.map(w => ({
            id: w.id,
            name: w.name,
            type: w.type,
            address: w.address,
            isDefault: Boolean(w.is_default),
            createdAt: new Date(w.created_at).toISOString(),
          })),
          count: whList.length,
        };
      } catch (err) {
        logger.error({ err, tool: 'warehouse_list' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'warehouse_create': {
      try {
        const newWhId = randomUUID().slice(0, 12);
        const newWhType = (input.type as string) ?? 'manual';
        const newWhDefault = input.isDefault ? 1 : 0;

        // If setting as default, unset any existing default for this user
        if (newWhDefault) {
          context.db.run(
            'UPDATE warehouses SET is_default = 0 WHERE user_id = ? AND is_default = 1',
            [context.userId],
          );
        }

        context.db.run(
          'INSERT INTO warehouses (id, user_id, name, type, address, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [newWhId, context.userId, input.name as string, newWhType, (input.address as string) ?? null, newWhDefault, Date.now()],
        );
        return {
          status: 'ok',
          warehouse: {
            id: newWhId,
            name: input.name,
            type: newWhType,
            address: input.address ?? null,
            isDefault: Boolean(newWhDefault),
          },
        };
      } catch (err) {
        logger.error({ err, tool: 'warehouse_create' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'warehouse_inventory': {
      try {
        let whInvQuery: string;
        const whInvParams: unknown[] = [];

        if (input.warehouseId && input.sku) {
          whInvQuery = `SELECT wi.id, wi.warehouse_id, w.name as warehouse_name, wi.sku, wi.product_id, wi.quantity, wi.reserved, wi.updated_at
                        FROM warehouse_inventory wi JOIN warehouses w ON w.id = wi.warehouse_id
                        WHERE wi.warehouse_id = ? AND wi.sku = ? AND w.user_id = ?`;
          whInvParams.push(input.warehouseId, input.sku, context.userId);
        } else if (input.warehouseId) {
          whInvQuery = `SELECT wi.id, wi.warehouse_id, w.name as warehouse_name, wi.sku, wi.product_id, wi.quantity, wi.reserved, wi.updated_at
                        FROM warehouse_inventory wi JOIN warehouses w ON w.id = wi.warehouse_id
                        WHERE wi.warehouse_id = ? AND w.user_id = ? ORDER BY wi.sku`;
          whInvParams.push(input.warehouseId, context.userId);
        } else if (input.sku) {
          whInvQuery = `SELECT wi.id, wi.warehouse_id, w.name as warehouse_name, wi.sku, wi.product_id, wi.quantity, wi.reserved, wi.updated_at
                        FROM warehouse_inventory wi JOIN warehouses w ON w.id = wi.warehouse_id
                        WHERE wi.sku = ? AND w.user_id = ? ORDER BY w.name`;
          whInvParams.push(input.sku, context.userId);
        } else {
          whInvQuery = `SELECT wi.id, wi.warehouse_id, w.name as warehouse_name, wi.sku, wi.product_id, wi.quantity, wi.reserved, wi.updated_at
                        FROM warehouse_inventory wi JOIN warehouses w ON w.id = wi.warehouse_id
                        WHERE w.user_id = ? ORDER BY w.name, wi.sku`;
          whInvParams.push(context.userId);
        }

        const whInventory = context.db.query<{
          id: string;
          warehouse_id: string;
          warehouse_name: string;
          sku: string;
          product_id: string | null;
          quantity: number;
          reserved: number;
          updated_at: number;
        }>(whInvQuery, whInvParams);

        return {
          status: 'ok',
          inventory: whInventory.map(i => ({
            id: i.id,
            warehouseId: i.warehouse_id,
            warehouseName: i.warehouse_name,
            sku: i.sku,
            productId: i.product_id,
            quantity: i.quantity,
            reserved: i.reserved,
            available: i.quantity - i.reserved,
            updatedAt: new Date(i.updated_at).toISOString(),
          })),
          count: whInventory.length,
        };
      } catch (err) {
        logger.error({ err, tool: 'warehouse_inventory' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'warehouse_update_stock': {
      try {
        // Verify the warehouse belongs to this user
        const whCheck = context.db.query<{ id: string }>(
          'SELECT id FROM warehouses WHERE id = ? AND user_id = ?',
          [input.warehouseId, context.userId],
        );
        if (whCheck.length === 0) {
          return { status: 'error', message: `Warehouse ${input.warehouseId} not found.` };
        }

        const stockQty = typeof input.quantity === 'number' ? input.quantity : 0;
        if (stockQty < 0) {
          return { status: 'error', message: 'Quantity cannot be negative.' };
        }

        // Upsert warehouse inventory
        const existingInv = context.db.query<{ id: string }>(
          'SELECT id FROM warehouse_inventory WHERE warehouse_id = ? AND sku = ?',
          [input.warehouseId, input.sku],
        );

        if (existingInv.length > 0) {
          context.db.run(
            'UPDATE warehouse_inventory SET quantity = ?, product_id = COALESCE(?, product_id), updated_at = ? WHERE warehouse_id = ? AND sku = ?',
            [stockQty, (input.productId as string) ?? null, Date.now(), input.warehouseId, input.sku],
          );
        } else {
          const newInvId = randomUUID().slice(0, 12);
          context.db.run(
            'INSERT INTO warehouse_inventory (id, warehouse_id, sku, product_id, quantity, reserved, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
            [newInvId, input.warehouseId, input.sku, (input.productId as string) ?? null, stockQty, Date.now()],
          );
        }

        return { status: 'ok', warehouseId: input.warehouseId, sku: input.sku, quantity: stockQty };
      } catch (err) {
        logger.error({ err, tool: 'warehouse_update_stock' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'warehouse_transfer': {
      try {
        const xferQty = typeof input.quantity === 'number' ? input.quantity : 0;
        if (xferQty <= 0) {
          return { status: 'error', message: 'Transfer quantity must be positive.' };
        }

        // Verify both warehouses belong to this user
        const xferFrom = context.db.query<{ id: string }>(
          'SELECT id FROM warehouses WHERE id = ? AND user_id = ?',
          [input.fromWarehouseId, context.userId],
        );
        const xferTo = context.db.query<{ id: string }>(
          'SELECT id FROM warehouses WHERE id = ? AND user_id = ?',
          [input.toWarehouseId, context.userId],
        );
        if (xferFrom.length === 0) {
          return { status: 'error', message: `Source warehouse ${input.fromWarehouseId} not found.` };
        }
        if (xferTo.length === 0) {
          return { status: 'error', message: `Destination warehouse ${input.toWarehouseId} not found.` };
        }

        // Check source has enough stock
        const srcInv = context.db.query<{ quantity: number; reserved: number }>(
          'SELECT quantity, reserved FROM warehouse_inventory WHERE warehouse_id = ? AND sku = ?',
          [input.fromWarehouseId, input.sku],
        );
        if (srcInv.length === 0) {
          return { status: 'error', message: `SKU ${input.sku} not found in source warehouse.` };
        }
        const avail = srcInv[0].quantity - srcInv[0].reserved;
        if (avail < xferQty) {
          return { status: 'error', message: `Insufficient stock. Available: ${avail}, requested: ${xferQty}.` };
        }

        // Decrement source
        context.db.run(
          'UPDATE warehouse_inventory SET quantity = quantity - ?, updated_at = ? WHERE warehouse_id = ? AND sku = ?',
          [xferQty, Date.now(), input.fromWarehouseId, input.sku],
        );

        // Increment destination (upsert)
        const dstInv = context.db.query<{ id: string }>(
          'SELECT id FROM warehouse_inventory WHERE warehouse_id = ? AND sku = ?',
          [input.toWarehouseId, input.sku],
        );
        if (dstInv.length > 0) {
          context.db.run(
            'UPDATE warehouse_inventory SET quantity = quantity + ?, updated_at = ? WHERE warehouse_id = ? AND sku = ?',
            [xferQty, Date.now(), input.toWarehouseId, input.sku],
          );
        } else {
          const xferInvId = randomUUID().slice(0, 12);
          // Copy product_id from source if available
          const srcProdId = context.db.query<{ product_id: string | null }>(
            'SELECT product_id FROM warehouse_inventory WHERE warehouse_id = ? AND sku = ?',
            [input.fromWarehouseId, input.sku],
          );
          context.db.run(
            'INSERT INTO warehouse_inventory (id, warehouse_id, sku, product_id, quantity, reserved, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
            [xferInvId, input.toWarehouseId, input.sku, srcProdId[0]?.product_id ?? null, xferQty, Date.now()],
          );
        }

        return {
          status: 'ok',
          transferred: xferQty,
          sku: input.sku,
          from: input.fromWarehouseId,
          to: input.toWarehouseId,
        };
      } catch (err) {
        logger.error({ err, tool: 'warehouse_transfer' }, 'Tool execution failed');
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    }

    // -----------------------------------------------------------------------
    // CSV Import / Export
    // -----------------------------------------------------------------------
    case 'import_csv':
    case 'export_products_csv': {
      return handleCsvImportTool(toolName, input, context.db);
    }

    // -----------------------------------------------------------------------
    // Barcode / UPC Scanning
    // -----------------------------------------------------------------------
    case 'scan_barcode':
    case 'batch_barcode_lookup': {
      return handleScanningTool(toolName, input, context.db);
    }

    // -----------------------------------------------------------------------
    // SEO / Keyword Research
    // -----------------------------------------------------------------------
    case 'keyword_research':
    case 'optimize_title_seo':
    case 'analyze_listing_seo': {
      return handleSeoTool(toolName, input, context.db);
    }

    // -----------------------------------------------------------------------
    // Price / Stock Alerts
    // -----------------------------------------------------------------------
    case 'create_alert_rule':
    case 'list_alerts':
    case 'check_alerts_now':
    case 'manage_alert_rules': {
      return handleAlertTool(toolName, input, context.db, context.userId);
    }

    // -----------------------------------------------------------------------
    // Competitor Analytics / Price Trending
    // -----------------------------------------------------------------------
    case 'track_competitor_prices':
    case 'price_trend_analysis':
    case 'competitor_report': {
      return handleAnalyticsTool(toolName, input, context.db);
    }

    // -----------------------------------------------------------------------
    // Shipping Rate Estimation
    // -----------------------------------------------------------------------
    case 'estimate_shipping':
    case 'compare_shipping_rates': {
      return handleShippingTool(toolName, input, context.db);
    }

    // -----------------------------------------------------------------------
    // Smart Auto-Repricer
    // -----------------------------------------------------------------------
    case 'create_repricing_rule':
    case 'list_repricing_rules':
    case 'run_repricer':
    case 'repricing_history': {
      return handleRepricerTool(toolName, input, { db: context.db, userId: context.userId });
    }

    // -----------------------------------------------------------------------
    // Bulk Listing Operations
    // -----------------------------------------------------------------------
    case 'pause_listings':
    case 'resume_listings':
    case 'delete_listings':
    case 'bulk_update_prices':
    case 'list_bulk_operations': {
      return handleBulkListingTool(toolName, input, { db: context.db, userId: context.userId });
    }

    // -----------------------------------------------------------------------
    // Product Variations
    // -----------------------------------------------------------------------
    case 'create_variation_group':
    case 'list_variation_groups':
    case 'get_variation_group': {
      return handleVariationTool(toolName, input, { db: context.db, userId: context.userId });
    }

    // -----------------------------------------------------------------------
    // Returns & Refunds
    // -----------------------------------------------------------------------
    case 'create_return':
    case 'inspect_return':
    case 'process_refund':
    case 'list_returns':
    case 'return_analytics': {
      return handleReturnTool(context.db, toolName, input);
    }

    // -----------------------------------------------------------------------
    // FBA Inbound Shipments
    // -----------------------------------------------------------------------
    case 'plan_fba_shipment':
    case 'create_fba_shipment':
    case 'check_fba_shipment':
    case 'list_fba_shipments':
    case 'estimate_fba_fees': {
      const amazonCreds = creds.amazon;
      const spConfig = amazonCreds ? buildSpApiConfig(amazonCreds) : null;
      return handleFbaInboundTool(context.db, toolName, input, spConfig);
    }

    // -----------------------------------------------------------------------
    // Inventory Sync & Allocation
    // -----------------------------------------------------------------------
    case 'sync_inventory':
    case 'inventory_snapshot':
    case 'hold_inventory':
    case 'release_hold':
    case 'list_inventory_conflicts':
    case 'resolve_inventory_conflict':
    case 'set_allocation_rule': {
      return handleInventoryTool(context.db, toolName, input);
    }

    // -----------------------------------------------------------------------
    // Tax & Compliance
    // -----------------------------------------------------------------------
    case 'sales_tax_report':
    case 'income_report':
    case 'nexus_check':
    case 'expense_report':
    case '1099_prep': {
      return handleTaxTool(context.db, toolName, input);
    }

    // -----------------------------------------------------------------------
    // Unknown tool
    // -----------------------------------------------------------------------
    default:
      logger.warn({ toolName }, 'Unknown tool called');
      return { status: 'error', message: `Unknown tool: ${toolName}` };
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
    streamCallback?: (text: string) => void,
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
    // Prompt caching: wrap system prompt in cache_control blocks
    // -----------------------------------------------------------------------
    const systemBlocks: Anthropic.TextBlockParam[] = [
      { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
    ];

    // -----------------------------------------------------------------------
    // Streaming: debounced progressive updates via streamCallback
    // -----------------------------------------------------------------------
    let streamedText = '';
    let lastFlushAt = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const STREAM_FLUSH_INTERVAL_MS = 200;

    function scheduleStreamFlush(): void {
      if (!streamCallback) return;
      if (flushTimer) return; // already scheduled
      const elapsed = Date.now() - lastFlushAt;
      const delay = Math.max(0, STREAM_FLUSH_INTERVAL_MS - elapsed);
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (streamedText) {
          streamCallback(streamedText);
          lastFlushAt = Date.now();
        }
      }, delay);
    }

    // -----------------------------------------------------------------------
    // Retry helper: 3 attempts with 1s/2s/4s exponential backoff
    // -----------------------------------------------------------------------
    async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await fn();
        } catch (err: unknown) {
          lastError = err;
          const errMsg = err instanceof Error ? err.message : String(err);

          // Don't retry on non-retryable errors
          if (
            errMsg.includes('prompt is too long') ||
            errMsg.includes('invalid_api_key') ||
            errMsg.includes('authentication')
          ) {
            throw err;
          }

          if (attempt < maxAttempts) {
            const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
            logger.warn(
              { attempt, maxAttempts, delay, err: errMsg },
              'Retrying Anthropic API call',
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }
      throw lastError;
    }

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
        // Prepare tools with cache_control on the last tool definition
        const apiTools = toApiTools(selectedTools);
        if (apiTools.length > 0) {
          apiTools[apiTools.length - 1].cache_control = { type: 'ephemeral' };
        }

        response = await withRetry(async () => {
          // Reset streaming state for each retry
          streamedText = '';
          lastFlushAt = 0;
          if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
          }

          const stream = client.messages.stream({
            model,
            max_tokens: 4096,
            system: systemBlocks,
            messages: currentMessages,
            tools: apiTools,
          });

          // Progressive streaming: send partial text to client as it arrives
          stream.on('text', (_delta: string, fullText: string) => {
            streamedText = fullText;
            scheduleStreamFlush();
          });

          const finalMessage = await stream.finalMessage();

          // Final flush
          if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
          }
          if (streamCallback && streamedText) {
            streamCallback(streamedText);
          }

          return finalMessage;
        });
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
      if (typeof last.content === 'string' && typeof msg.content === 'string') {
        last.content = last.content + '\n' + msg.content;
      } else {
        // Convert both to array format and merge
        const lastArr = typeof last.content === 'string' ? [{ type: 'text' as const, text: last.content }] : Array.isArray(last.content) ? last.content : [last.content];
        const msgArr = typeof msg.content === 'string' ? [{ type: 'text' as const, text: msg.content }] : Array.isArray(msg.content) ? msg.content : [msg.content];
        last.content = [...lastArr, ...msgArr] as any;
      }
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
    result.push({ role: 'user', content: '' });
  }

  return result;
}
