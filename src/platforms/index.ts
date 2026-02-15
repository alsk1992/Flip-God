/**
 * Platform Registry - Manages e-commerce platform adapters
 */

import { createLogger } from '../utils/logger';
import type { Platform, AmazonCredentials, EbayCredentials, WalmartCredentials, AliExpressCredentials } from '../types';

const logger = createLogger('platforms');

export interface ProductSearchResult {
  platformId: string;
  platform: Platform;
  title: string;
  price: number;
  shipping: number;
  currency: string;
  inStock: boolean;
  seller?: string;
  url: string;
  imageUrl?: string;
  upc?: string;
  asin?: string;
  brand?: string;
  category?: string;
  rating?: number;
  reviewCount?: number;
  msrp?: number;
}

export interface SearchOptions {
  query: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  maxResults?: number;
}

export interface PlatformAdapter {
  platform: Platform;
  search(options: SearchOptions): Promise<ProductSearchResult[]>;
  getProduct(productId: string): Promise<ProductSearchResult | null>;
  checkStock(productId: string): Promise<{ inStock: boolean; quantity?: number }>;
}

export { createAmazonAdapter } from './amazon/scraper';
export { createEbayAdapter } from './ebay/scraper';
export { createWalmartAdapter } from './walmart/scraper';
export { createAliExpressAdapter } from './aliexpress/scraper';

// Re-import under internal aliases so createAllAdapters uses static imports
// instead of require() calls.
import { createAmazonAdapter as _createAmazonAdapter } from './amazon/scraper';
import { createEbayAdapter as _createEbayAdapter } from './ebay/scraper';
import { createWalmartAdapter as _createWalmartAdapter } from './walmart/scraper';
import { createAliExpressAdapter as _createAliExpressAdapter } from './aliexpress/scraper';
import { createBestBuyAdapter } from './bestbuy/scraper';
import { createTargetAdapter } from './target/scraper';
import { createCostcoAdapter } from './costco/scraper';
import { createHomeDepotAdapter } from './homedepot/scraper';
import { createPoshmarkAdapter } from './poshmark/scraper';
import { createMercariAdapter } from './mercari/scraper';
import { createFacebookAdapter } from './facebook/scraper';
import { createFaireAdapter } from './faire/scraper';
import { createBStockAdapter } from './bstock/scraper';
import { createBulqAdapter } from './bulq/scraper';
import { createLiquidationAdapter } from './liquidation/scraper';

/**
 * Create all platform adapters given credentials per platform.
 */
export function createAllAdapters(credentials: {
  amazon?: AmazonCredentials;
  ebay?: EbayCredentials;
  walmart?: WalmartCredentials;
  aliexpress?: AliExpressCredentials;
}): Map<Platform, PlatformAdapter> {
  const adapters = new Map<Platform, PlatformAdapter>();
  adapters.set('amazon', _createAmazonAdapter(credentials.amazon));
  adapters.set('ebay', _createEbayAdapter(credentials.ebay));
  adapters.set('walmart', _createWalmartAdapter(credentials.walmart));
  adapters.set('aliexpress', _createAliExpressAdapter(credentials.aliexpress));
  adapters.set('bestbuy', createBestBuyAdapter());
  adapters.set('target', createTargetAdapter());
  adapters.set('costco', createCostcoAdapter());
  adapters.set('homedepot', createHomeDepotAdapter());
  adapters.set('poshmark', createPoshmarkAdapter());
  adapters.set('mercari', createMercariAdapter());
  adapters.set('facebook', createFacebookAdapter());
  adapters.set('faire', createFaireAdapter());
  adapters.set('bstock', createBStockAdapter());
  adapters.set('bulq', createBulqAdapter());
  adapters.set('liquidation', createLiquidationAdapter());
  return adapters;
}
