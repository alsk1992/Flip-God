/**
 * Home Depot Product Search - GraphQL API adapter
 *
 * Uses Home Depot's internal federation-gateway GraphQL endpoint.
 * Real endpoint: apionline.homedepot.com/federation-gateway/graphql
 */

import { createLogger } from '../../utils/logger';
import type { PlatformAdapter, ProductSearchResult, SearchOptions } from '../index';

const logger = createLogger('homedepot');

const SEARCH_URL = 'https://apionline.homedepot.com/federation-gateway/graphql?opname=searchModel';

interface HDProduct {
  itemId: string;
  identifiers?: { storeSkuNumber?: string; upc?: string; productLabel?: string };
  pricing?: { value?: number; original?: number };
  media?: { images?: Array<{ url?: string }> };
  availabilityType?: { type?: string };
  brandName?: string;
  modelNumber?: string;
  canonicalUrl?: string;
  ratings?: { averageOverall?: number; totalReviews?: number };
}

function parseProduct(item: HDProduct): ProductSearchResult {
  const price = item.pricing?.value ?? 0;
  return {
    platformId: item.itemId,
    platform: 'homedepot',
    title: item.identifiers?.productLabel ?? '',
    price,
    shipping: price >= 45 ? 0 : 7.99,
    currency: 'USD',
    inStock: item.availabilityType?.type !== 'Unavailable',
    seller: 'Home Depot',
    url: item.canonicalUrl
      ? `https://www.homedepot.com${item.canonicalUrl}`
      : `https://www.homedepot.com/p/${item.itemId}`,
    imageUrl: item.media?.images?.[0]?.url,
    upc: item.identifiers?.upc,
    brand: item.brandName,
    rating: item.ratings?.averageOverall,
    reviewCount: item.ratings?.totalReviews,
  };
}

const SEARCH_QUERY = `query searchModel($keyword: String, $storeId: String, $startIndex: Int, $pageSize: Int, $orderBy: ProductSort, $storefilter: StoreFilter, $channel: Channel) {
  searchModel(keyword: $keyword, storeId: $storeId, storefilter: $storefilter, channel: $channel) {
    products(startIndex: $startIndex, pageSize: $pageSize, orderBy: $orderBy) {
      itemId
      brandName
      modelNumber
      canonicalUrl
      identifiers { storeSkuNumber upc productLabel }
      pricing { value original }
      media { images { url } }
      availabilityType { type }
      ratings { averageOverall totalReviews }
    }
  }
}`;

export function createHomeDepotAdapter(): PlatformAdapter {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': '*/*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0',
    'Origin': 'https://www.homedepot.com',
    'Referer': 'https://www.homedepot.com/',
    'x-experience-name': 'general-merchandise',
    'x-hd-dc': 'origin',
    'x-debug': 'false',
  };

  return {
    platform: 'homedepot',

    async search(options: SearchOptions): Promise<ProductSearchResult[]> {
      logger.info({ query: options.query }, 'Searching Home Depot');

      const pageSize = Math.min(options.maxResults ?? 10, 24);
      const body = JSON.stringify({
        operationName: 'searchModel',
        variables: {
          keyword: options.query,
          storeId: '1710',
          startIndex: 0,
          pageSize,
          orderBy: { field: 'BEST_MATCH', order: 'ASC' },
          storefilter: 'ALL',
          channel: 'DESKTOP',
        },
        query: SEARCH_QUERY,
      });

      try {
        const response = await fetch(SEARCH_URL, { method: 'POST', headers, body });
        if (!response.ok) {
          logger.error({ status: response.status }, 'Home Depot search failed');
          return [];
        }
        const data = await response.json() as {
          data?: { searchModel?: { products?: HDProduct[] } };
        };
        const products = data?.data?.searchModel?.products ?? [];
        let results = products.map(parseProduct);
        if (options.minPrice != null) results = results.filter(r => r.price >= options.minPrice!);
        if (options.maxPrice != null) results = results.filter(r => r.price <= options.maxPrice!);
        return results;
      } catch (err) {
        logger.error({ err }, 'Home Depot search error');
        return [];
      }
    },

    async getProduct(productId: string): Promise<ProductSearchResult | null> {
      logger.info({ productId }, 'Getting Home Depot product');
      try {
        const results = await this.search({ query: productId, maxResults: 5 });
        return results.find(r => r.platformId === productId) ?? results[0] ?? null;
      } catch (err) {
        logger.error({ productId, err }, 'Home Depot product lookup error');
        return null;
      }
    },

    async checkStock(productId: string): Promise<{ inStock: boolean; quantity?: number }> {
      const product = await this.getProduct(productId);
      return { inStock: product?.inStock ?? false };
    },
  };
}
