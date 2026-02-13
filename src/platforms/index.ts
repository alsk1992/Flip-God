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

/**
 * Create all platform adapters given credentials per platform.
 */
export function createAllAdapters(credentials: {
  amazon?: AmazonCredentials;
  ebay?: EbayCredentials;
  walmart?: WalmartCredentials;
  aliexpress?: AliExpressCredentials;
}): Map<Platform, PlatformAdapter> {
  // Dynamic imports to avoid circular deps
  const { createAmazonAdapter } = require('./amazon/scraper');
  const { createEbayAdapter } = require('./ebay/scraper');
  const { createWalmartAdapter } = require('./walmart/scraper');
  const { createAliExpressAdapter } = require('./aliexpress/scraper');

  const adapters = new Map<Platform, PlatformAdapter>();
  adapters.set('amazon', createAmazonAdapter(credentials.amazon));
  adapters.set('ebay', createEbayAdapter(credentials.ebay));
  adapters.set('walmart', createWalmartAdapter(credentials.walmart));
  adapters.set('aliexpress', createAliExpressAdapter(credentials.aliexpress));
  return adapters;
}
