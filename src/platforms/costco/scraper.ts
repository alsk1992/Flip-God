/**
 * Costco Product Search — Dual approach adapter
 *
 * 1. Search: Costco's internal search API at search.costco.com (public, returns JSON)
 * 2. Price lookup: AjaxGetContractPrice endpoint (reverse-engineered)
 *
 * Based on: github.com/aransaseelan/CostcoPriceTracker
 *
 * Costco uses Akamai bot protection. Direct fetch may get blocked.
 * The adapter includes proper headers and cookies to maximize success rate.
 * If blocked, returns empty results gracefully.
 */

import { createLogger } from '../../utils/logger';
import type { PlatformAdapter, ProductSearchResult, SearchOptions } from '../index';

const logger = createLogger('costco');

// Costco's internal search endpoint (used by their frontend)
const SEARCH_URL = 'https://www.costco.com/CatalogSearch';
// Price check endpoint (reverse-engineered from CostcoPriceTracker)
const PRICE_URL = 'https://www.costco.com/AjaxGetContractPrice';

interface CostcoSearchProduct {
  productId?: string;
  itemNumber?: string;
  name?: string;
  description?: string;
  price?: string;
  priceNumeric?: number;
  url?: string;
  img?: string;
  thumbnail?: string;
  brand?: string;
  categoryName?: string;
  rating?: number;
  reviewCount?: number;
  isInStock?: boolean;
  onlineOnly?: boolean;
}

interface CostcoSearchResponse {
  results?: CostcoSearchProduct[];
  productList?: CostcoSearchProduct[];
  count?: number;
  totalCount?: number;
}

function parseProduct(item: CostcoSearchProduct): ProductSearchResult {
  const price = item.priceNumeric ?? (parseFloat(item.price?.replace(/[^0-9.]/g, '') ?? '0') || 0);
  const productId = item.productId ?? item.itemNumber ?? '';

  return {
    platformId: productId,
    platform: 'costco',
    title: item.name ?? item.description ?? '',
    price,
    shipping: 0, // Costco includes shipping for most online items
    currency: 'USD',
    inStock: item.isInStock !== false,
    seller: 'Costco',
    url: item.url
      ? (item.url.startsWith('http') ? item.url : `https://www.costco.com${item.url}`)
      : `https://www.costco.com/product.${productId}.html`,
    imageUrl: item.img ?? item.thumbnail,
    brand: item.brand,
    category: item.categoryName,
    rating: item.rating,
    reviewCount: item.reviewCount,
  };
}

// Headers that mimic a real Chrome browser to avoid Akamai blocks
const BROWSER_HEADERS: Record<string, string> = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.costco.com/',
  'Connection': 'keep-alive',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

// Location cookies (default to US delivery)
const LOCATION_COOKIES = 'invCheckPostalCode=90210; invCheckCity=Beverly%20Hills; C_LOC=90210||Beverly%20Hills||CA||US';

export function createCostcoAdapter(options?: {
  postalCode?: string;
  city?: string;
}): PlatformAdapter {
  const postalCode = options?.postalCode ?? '90210';
  const city = options?.city ?? 'Beverly Hills';
  const cookies = `invCheckPostalCode=${encodeURIComponent(postalCode)}; invCheckCity=${encodeURIComponent(city)}`;

  const headers: Record<string, string> = {
    ...BROWSER_HEADERS,
    Cookie: cookies,
  };

  return {
    platform: 'costco',

    async search(opts: SearchOptions): Promise<ProductSearchResult[]> {
      logger.info({ query: opts.query }, 'Searching Costco');

      const pageSize = Math.min(opts.maxResults ?? 24, 48);

      const params = new URLSearchParams({
        keyword: opts.query,
        pageSize: String(pageSize),
        currentPage: '1',
        responseFormat: 'json',
        storeId: '10301', // default warehouse
        catalogId: '10701',
        langId: '-1',
      });

      try {
        const response = await fetch(`${SEARCH_URL}?${params.toString()}`, { headers });

        if (!response.ok) {
          // Akamai may return 403 — log and return empty
          if (response.status === 403) {
            logger.warn('Costco search blocked by Akamai bot protection (403)');
          } else {
            logger.error({ status: response.status }, 'Costco search failed');
          }
          return [];
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.includes('json')) {
          // Akamai may return HTML challenge page
          logger.warn('Costco returned non-JSON response (likely bot challenge)');
          return [];
        }

        const data = await response.json() as CostcoSearchResponse;
        const products = data.results ?? data.productList ?? [];
        let results = products.map(parseProduct);

        if (opts.minPrice != null) results = results.filter(r => r.price >= opts.minPrice!);
        if (opts.maxPrice != null) results = results.filter(r => r.price <= opts.maxPrice!);
        return results;
      } catch (err) {
        logger.error({ err }, 'Costco search error');
        return [];
      }
    },

    async getProduct(productId: string): Promise<ProductSearchResult | null> {
      logger.info({ productId }, 'Getting Costco product');

      // Try the AjaxGetContractPrice endpoint for price lookup
      try {
        const priceParams = new URLSearchParams({
          productId,
          itemId: productId,
          storeId: '10301',
          catalogId: '10701',
        });

        const response = await fetch(`${PRICE_URL}?${priceParams.toString()}`, { headers });

        if (response.ok) {
          const contentType = response.headers.get('content-type') ?? '';
          if (contentType.includes('json')) {
            const data = await response.json() as {
              finalOnlinePrice?: number;
              listPrice?: number;
              productName?: string;
              inStock?: boolean;
            };

            if (data.finalOnlinePrice != null || data.listPrice != null) {
              return {
                platformId: productId,
                platform: 'costco',
                title: data.productName ?? '',
                price: data.finalOnlinePrice ?? data.listPrice ?? 0,
                shipping: 0,
                currency: 'USD',
                inStock: data.inStock !== false,
                seller: 'Costco',
                url: `https://www.costco.com/product.${productId}.html`,
                msrp: data.listPrice && data.finalOnlinePrice && data.listPrice > data.finalOnlinePrice
                  ? data.listPrice : undefined,
              };
            }
          }
        }
      } catch (err) {
        logger.debug({ productId, error: err instanceof Error ? err.message : String(err) }, 'Costco price endpoint failed, falling back to search');
      }

      // Fallback: search by product ID
      try {
        const results = await this.search({ query: productId, maxResults: 5 });
        return results.find(r => r.platformId === productId) ?? results[0] ?? null;
      } catch (err) {
        logger.error({ productId, err }, 'Costco product lookup error');
        return null;
      }
    },

    async checkStock(productId: string): Promise<{ inStock: boolean; quantity?: number }> {
      const product = await this.getProduct(productId);
      return { inStock: product?.inStock ?? false };
    },
  };
}
