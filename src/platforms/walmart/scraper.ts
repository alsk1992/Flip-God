/**
 * Walmart Product Search - Affiliate API adapter
 *
 * Uses Walmart's Affiliate API for product search and lookup.
 * Requires: clientId (API key), clientSecret (consumer ID).
 */

import { createLogger } from '../../utils/logger';
import type { Platform, WalmartCredentials } from '../../types';
import type { PlatformAdapter, ProductSearchResult, SearchOptions } from '../index';
import type { WalmartSearchResponse, WalmartApiItem } from './types';

const logger = createLogger('walmart');

const API_BASE = 'https://developer.api.walmart.com';

function parseItem(item: WalmartApiItem): ProductSearchResult {
  const price = item.salePrice ?? item.msrp ?? 0;
  const shippingCost = item.standardShipRate ?? 0;
  const inStock = item.availableOnline !== false && item.stock !== 'Not available';

  return {
    platformId: String(item.itemId),
    platform: 'walmart',
    title: item.name,
    price,
    shipping: shippingCost,
    currency: 'USD',
    inStock,
    seller: item.sellerInfo ?? 'Walmart.com',
    url: item.productUrl ?? `https://walmart.com/ip/${item.itemId}`,
    imageUrl: item.largeImage ?? item.mediumImage ?? item.thumbnailImage,
    upc: item.upc,
    brand: item.brandName,
    category: item.categoryPath,
    rating: item.customerRating ? (parseFloat(item.customerRating) || undefined) : undefined,
    reviewCount: item.numReviews,
  };
}

export function createWalmartAdapter(credentials?: WalmartCredentials): PlatformAdapter {
  function getHeaders(): Record<string, string> {
    if (!credentials) return {};
    return {
      'apiKey': credentials.clientId,
      'Accept': 'application/json',
    };
  }

  return {
    platform: 'walmart' as Platform,

    async search(options: SearchOptions): Promise<ProductSearchResult[]> {
      if (!credentials) {
        logger.warn('Walmart credentials not configured');
        return [];
      }

      logger.info({ query: options.query }, 'Searching Walmart via Affiliate API');

      const params = new URLSearchParams({
        query: options.query,
        numItems: String(Math.min(options.maxResults ?? 10, 25)),
        format: 'json',
      });

      if (options.category) {
        params.set('categoryId', options.category);
      }

      const response = await fetch(
        `${API_BASE}/api-proxy/service/affil/product/v2/search?${params.toString()}`,
        { headers: getHeaders() },
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'Walmart search failed');
        throw new Error(`Walmart API search failed (${response.status})`);
      }

      const data = await response.json() as WalmartSearchResponse;
      const items = data.items ?? [];

      let results = items.map(parseItem);

      // Apply price filters client-side (Walmart API doesn't support price range)
      if (options.minPrice != null) {
        results = results.filter(r => r.price >= (options.minPrice ?? 0));
      }
      if (options.maxPrice != null) {
        results = results.filter(r => r.price <= (options.maxPrice ?? Infinity));
      }

      return results;
    },

    async getProduct(productId: string): Promise<ProductSearchResult | null> {
      if (!credentials) {
        logger.warn('Walmart credentials not configured');
        return null;
      }

      logger.info({ productId }, 'Getting Walmart product via Affiliate API');

      const response = await fetch(
        `${API_BASE}/api-proxy/service/affil/product/v2/items/${encodeURIComponent(productId)}?format=json`,
        { headers: getHeaders() },
      );

      if (!response.ok) {
        if (response.status === 404) return null;
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'Walmart item lookup failed');
        return null;
      }

      const data = await response.json() as { items?: WalmartApiItem[] };
      const item = data.items?.[0];
      if (!item) return null;
      return parseItem(item);
    },

    async checkStock(productId: string): Promise<{ inStock: boolean; quantity?: number }> {
      const product = await this.getProduct(productId);
      if (!product) {
        return { inStock: false };
      }
      return { inStock: product.inStock };
    },
  };
}
