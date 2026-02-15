/**
 * Best Buy Product Search - Products API adapter
 *
 * Uses Best Buy's Products API (requires API key from developer.bestbuy.com).
 */

import { createLogger } from '../../utils/logger';
import type { PlatformAdapter, ProductSearchResult, SearchOptions } from '../index';

const logger = createLogger('bestbuy');

const API_BASE = 'https://api.bestbuy.com/v1';

interface BestBuyProduct {
  sku: number;
  name: string;
  salePrice: number;
  regularPrice: number;
  onSale: boolean;
  freeShipping: boolean;
  shippingCost?: number;
  inStoreAvailability: boolean;
  onlineAvailability: boolean;
  url: string;
  image?: string;
  largeFrontImage?: string;
  upc: string;
  manufacturer?: string;
  categoryPath?: Array<{ id: string; name: string }>;
  customerReviewAverage?: number;
  customerReviewCount?: number;
  condition?: string;
}

function parseProduct(item: BestBuyProduct): ProductSearchResult {
  const price = item.salePrice ?? item.regularPrice ?? 0;
  return {
    platformId: String(item.sku),
    platform: 'amazon' as any,
    title: item.name,
    price,
    shipping: item.freeShipping ? 0 : (item.shippingCost ?? 5.99),
    currency: 'USD',
    inStock: item.onlineAvailability || item.inStoreAvailability,
    seller: 'Best Buy',
    url: item.url || `https://www.bestbuy.com/site/${item.sku}.p`,
    imageUrl: item.largeFrontImage ?? item.image,
    upc: item.upc,
    brand: item.manufacturer,
    category: item.categoryPath?.[item.categoryPath.length - 1]?.name,
    rating: item.customerReviewAverage,
    reviewCount: item.customerReviewCount,
  };
}

export interface BestBuyConfig {
  apiKey: string;
}

export function createBestBuyAdapter(config?: BestBuyConfig): PlatformAdapter {
  const apiKey = config?.apiKey ?? process.env.BESTBUY_API_KEY;

  return {
    platform: 'amazon' as any,

    async search(options: SearchOptions): Promise<ProductSearchResult[]> {
      if (!apiKey) { logger.warn('Best Buy API key not configured'); return []; }
      logger.info({ query: options.query }, 'Searching Best Buy');

      const pageSize = Math.min(options.maxResults ?? 10, 100);
      const filters: string[] = [`search=${encodeURIComponent(options.query)}`];
      if (options.minPrice != null) filters.push(`salePrice>=${options.minPrice}`);
      if (options.maxPrice != null) filters.push(`salePrice<=${options.maxPrice}`);
      const filter = `(${filters.join('&')})`;

      try {
        const url = `${API_BASE}/products${filter}?apiKey=${apiKey}&format=json&pageSize=${pageSize}&show=sku,name,salePrice,regularPrice,onSale,freeShipping,shippingCost,inStoreAvailability,onlineAvailability,url,image,largeFrontImage,upc,manufacturer,categoryPath,customerReviewAverage,customerReviewCount`;
        const response = await fetch(url);
        if (!response.ok) {
          logger.error({ status: response.status }, 'Best Buy search failed');
          return [];
        }
        const data = await response.json() as { products?: BestBuyProduct[] };
        return (data.products ?? []).map(parseProduct);
      } catch (err) {
        logger.error({ err }, 'Best Buy search error');
        return [];
      }
    },

    async getProduct(productId: string): Promise<ProductSearchResult | null> {
      if (!apiKey) return null;
      logger.info({ productId }, 'Getting Best Buy product');

      try {
        const url = `${API_BASE}/products/${encodeURIComponent(productId)}.json?apiKey=${apiKey}&show=sku,name,salePrice,regularPrice,onSale,freeShipping,shippingCost,inStoreAvailability,onlineAvailability,url,image,largeFrontImage,upc,manufacturer,categoryPath,customerReviewAverage,customerReviewCount`;
        const response = await fetch(url);
        if (!response.ok) return null;
        const item = await response.json() as BestBuyProduct;
        return parseProduct(item);
      } catch (err) {
        logger.error({ productId, err }, 'Best Buy product lookup error');
        return null;
      }
    },

    async checkStock(productId: string): Promise<{ inStock: boolean; quantity?: number }> {
      const product = await this.getProduct(productId);
      return { inStock: product?.inStock ?? false };
    },
  };
}
