/**
 * Poshmark Product Search — Internal REST API adapter
 *
 * Uses Poshmark's internal vm-rest API (reverse-engineered).
 * Based on: github.com/michaelbutler/phposh (PHP SDK) + github.com/joshdk/posh (Go client)
 *
 * Endpoints:
 *   GET  https://poshmark.com/vm-rest/posts/{itemId}       — single item
 *   GET  https://poshmark.com/vm-rest/users/{userId}/posts  — user's closet (paginated)
 *
 * Search uses the public web search page (no auth needed for browsing).
 * Item details use the vm-rest API (no auth needed for public items).
 * Cookie-based auth needed only for seller operations (update, orders).
 */

import { createLogger } from '../../utils/logger';
import type { PlatformAdapter, ProductSearchResult, SearchOptions } from '../index';

const logger = createLogger('poshmark');

const VM_REST_BASE = 'https://poshmark.com/vm-rest';

interface PoshmarkPost {
  id: string;
  title: string;
  description?: string;
  price_amount?: { val?: string; currency_code?: string };
  original_price_amount?: { val?: string; currency_code?: string };
  brand?: string;
  size?: string;
  color?: string;
  category?: string;
  department?: string;
  cover_shot?: { url_small?: string; url_large?: string };
  first_image_url?: string;
  creator_username?: string;
  creator_id?: string;
  inventory?: { status?: string; size_quantity_revision?: Array<{ size_obj?: { display?: string }; quantity_available?: number }> };
  status?: string;
  condition?: string;
  nwt?: boolean; // new with tags
  like_count?: number;
  comment_count?: number;
}

function parsePost(item: PoshmarkPost): ProductSearchResult {
  const price = parseFloat(item.price_amount?.val ?? '0');
  const originalPrice = parseFloat(item.original_price_amount?.val ?? '0');

  return {
    platformId: item.id,
    platform: 'amazon' as any,
    title: item.title,
    price,
    shipping: 7.97, // Poshmark flat rate shipping
    currency: item.price_amount?.currency_code ?? 'USD',
    inStock: item.inventory?.status !== 'sold_out' && item.status !== 'sold',
    seller: item.creator_username,
    url: `https://poshmark.com/listing/${item.id}`,
    imageUrl: item.cover_shot?.url_large ?? item.cover_shot?.url_small ?? item.first_image_url,
    brand: item.brand,
    category: item.category ?? item.department,
    msrp: originalPrice > price ? originalPrice : undefined,
  };
}

const HEADERS: Record<string, string> = {
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://poshmark.com/',
};

export function createPoshmarkAdapter(cookies?: string): PlatformAdapter {
  const headers: Record<string, string> = {
    ...HEADERS,
    ...(cookies ? { Cookie: cookies } : {}),
  };

  return {
    platform: 'amazon' as any,

    async search(options: SearchOptions): Promise<ProductSearchResult[]> {
      logger.info({ query: options.query }, 'Searching Poshmark');

      // Poshmark's vm-rest doesn't have a search endpoint.
      // Use their public search results page which returns JSON when
      // accessed with the right Accept header, or fall back to web scraping.
      // The most reliable approach: hit their web search and parse the
      // __NEXT_DATA__ JSON embedded in the page, OR use their mobile-like API.

      const pageSize = Math.min(options.maxResults ?? 24, 48);

      // Try the summarized search endpoint (used by their web frontend)
      const params = new URLSearchParams({
        query: options.query,
        summarize: 'true',
        pm_version: '250.0.0',
        max_id: '',
        count: String(pageSize),
      });

      if (options.minPrice != null) params.set('price[min]', String(Math.round(options.minPrice)));
      if (options.maxPrice != null) params.set('price[max]', String(Math.round(options.maxPrice)));
      if (options.category) params.set('department', options.category);

      try {
        // Primary: Try vm-rest/posts endpoint with search params
        const response = await fetch(`${VM_REST_BASE}/posts?${params.toString()}`, {
          headers,
        });

        if (response.ok) {
          const data = await response.json() as { data?: PoshmarkPost[] };
          if (data.data?.length) {
            return data.data.map(parsePost).slice(0, pageSize);
          }
        }

        // Fallback: Hit the public search page and extract __NEXT_DATA__
        logger.debug('vm-rest search returned no results, trying web fallback');
        const webUrl = `https://poshmark.com/search?query=${encodeURIComponent(options.query)}&type=listings`;
        const webResponse = await fetch(webUrl, {
          headers: {
            ...HEADERS,
            'Accept': 'text/html',
          },
        });

        if (!webResponse.ok) {
          logger.error({ status: webResponse.status }, 'Poshmark web search failed');
          return [];
        }

        const html = await webResponse.text();
        const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
        if (!nextDataMatch?.[1]) {
          logger.warn('No __NEXT_DATA__ found in Poshmark search page');
          return [];
        }

        try {
          const nextData = JSON.parse(nextDataMatch[1]) as any;
          const posts: PoshmarkPost[] =
            nextData?.props?.pageProps?.listings ??
            nextData?.props?.pageProps?.searchData?.listings ??
            nextData?.props?.pageProps?.data ??
            [];

          let results = posts.map(parsePost);
          if (options.minPrice != null) results = results.filter(r => r.price >= options.minPrice!);
          if (options.maxPrice != null) results = results.filter(r => r.price <= options.maxPrice!);
          return results.slice(0, pageSize);
        } catch (parseErr) {
          logger.error({ parseErr }, 'Failed to parse Poshmark __NEXT_DATA__');
          return [];
        }
      } catch (err) {
        logger.error({ err }, 'Poshmark search error');
        return [];
      }
    },

    async getProduct(productId: string): Promise<ProductSearchResult | null> {
      logger.info({ productId }, 'Getting Poshmark listing');

      try {
        // vm-rest/posts/{id} returns the full listing JSON
        const response = await fetch(`${VM_REST_BASE}/posts/${encodeURIComponent(productId)}`, {
          headers,
        });

        if (!response.ok) {
          // Fallback: try the listing page __NEXT_DATA__
          const webResponse = await fetch(`https://poshmark.com/listing/${encodeURIComponent(productId)}`, {
            headers: { ...HEADERS, 'Accept': 'text/html' },
          });
          if (!webResponse.ok) return null;

          const html = await webResponse.text();
          const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
          if (!match?.[1]) return null;

          const nextData = JSON.parse(match[1]) as any;
          const post = nextData?.props?.pageProps?.listing ?? nextData?.props?.pageProps?.post;
          if (!post) return null;
          return parsePost(post);
        }

        const data = await response.json() as { data?: PoshmarkPost };
        if (!data.data) return null;
        return parsePost(data.data);
      } catch (err) {
        logger.error({ productId, err }, 'Poshmark listing lookup error');
        return null;
      }
    },

    async checkStock(productId: string): Promise<{ inStock: boolean; quantity?: number }> {
      const product = await this.getProduct(productId);
      return { inStock: product?.inStock ?? false };
    },
  };
}
