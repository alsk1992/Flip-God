/**
 * B-Stock Liquidation Auctions — Web scraping adapter
 *
 * B-Stock runs liquidation auction sites for major retailers:
 *   - bstock.com (main marketplace)
 *   - bstocksolutions.com (individual retailer storefronts)
 *   - Individual: amazonauctions.bstock.com, bulkbuys.bstock.com, etc.
 *
 * No public API exists. Enterprise API requires partnership agreement.
 * This adapter scrapes the public auction listing pages.
 */

import { createLogger } from '../../utils/logger';
import type { PlatformAdapter, ProductSearchResult, SearchOptions } from '../index';

const logger = createLogger('bstock');

// B-Stock's main search page — returns HTML with embedded JSON data
const SEARCH_BASE = 'https://bstock.com/search';

const HEADERS: Record<string, string> = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://bstock.com/',
};

interface BStockLot {
  id: string;
  title: string;
  currentBid?: number;
  msrp?: number;
  retailValue?: number;
  category?: string;
  condition?: string;
  imageUrl?: string;
  marketplace?: string; // amazon, walmart, target, etc.
  endTime?: string;
  itemCount?: number;
  url?: string;
}

function parseLot(item: BStockLot): ProductSearchResult {
  return {
    platformId: item.id,
    platform: 'bstock',
    title: item.title,
    price: item.currentBid ?? 0,
    shipping: 0,
    currency: 'USD',
    inStock: true, // active auctions are always "available"
    seller: item.marketplace ?? 'B-Stock',
    url: item.url ?? `https://bstock.com/auction/${item.id}`,
    imageUrl: item.imageUrl,
    category: item.category,
    msrp: item.retailValue ?? item.msrp,
  };
}

/**
 * Extract auction data from B-Stock HTML.
 * B-Stock uses server-rendered HTML with structured data in JSON-LD
 * and auction cards with data attributes.
 */
function extractAuctionsFromHtml(html: string): BStockLot[] {
  const lots: BStockLot[] = [];

  // Try JSON-LD structured data first
  const jsonLdMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  for (const match of jsonLdMatches) {
    try {
      const ld = JSON.parse(match[1]) as any;
      if (ld['@type'] === 'Product' || ld['@type'] === 'ItemList') {
        const items = ld.itemListElement ?? [ld];
        for (const item of items) {
          if (item.name && item.url) {
            lots.push({
              id: item.url?.split('/').pop() ?? '',
              title: item.name,
              currentBid: parseFloat(item.offers?.price ?? '0') || undefined,
              imageUrl: item.image,
              url: item.url,
              category: item.category,
            });
          }
        }
      }
    } catch { /* not valid JSON-LD */ }
  }

  // Also try __NEXT_DATA__ if B-Stock uses Next.js
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextMatch?.[1]) {
    try {
      const data = JSON.parse(nextMatch[1]) as any;
      const auctions = data?.props?.pageProps?.auctions ??
                        data?.props?.pageProps?.results ??
                        data?.props?.pageProps?.lots ?? [];
      for (const a of auctions) {
        lots.push({
          id: a.id ?? a.auctionId ?? a.slug ?? '',
          title: a.title ?? a.name ?? '',
          currentBid: a.currentBid ?? a.currentPrice ?? a.price,
          msrp: a.msrp ?? a.retailValue,
          retailValue: a.retailValue ?? a.estimatedRetailValue,
          category: a.category ?? a.categoryName,
          condition: a.condition,
          imageUrl: a.imageUrl ?? a.image ?? a.thumbnailUrl,
          marketplace: a.marketplace ?? a.source ?? a.seller,
          itemCount: a.itemCount ?? a.quantity,
          url: a.url,
        });
      }
    } catch { /* not valid JSON */ }
  }

  // Fallback: extract from HTML auction cards using regex
  if (lots.length === 0) {
    const cardPattern = /data-auction-id="([^"]+)"[\s\S]*?<[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\//g;
    let cardMatch;
    while ((cardMatch = cardPattern.exec(html)) !== null) {
      lots.push({
        id: cardMatch[1],
        title: cardMatch[2].replace(/<[^>]+>/g, '').trim(),
      });
    }
  }

  return lots;
}

export function createBStockAdapter(): PlatformAdapter {
  return {
    platform: 'bstock',

    async search(options: SearchOptions): Promise<ProductSearchResult[]> {
      logger.info({ query: options.query }, 'Searching B-Stock');

      try {
        const params = new URLSearchParams({ q: options.query });
        if (options.category) params.set('category', options.category);

        const response = await fetch(`${SEARCH_BASE}?${params.toString()}`, { headers: HEADERS });

        if (!response.ok) {
          if (response.status === 403) {
            logger.warn('B-Stock blocked request (403)');
          } else {
            logger.error({ status: response.status }, 'B-Stock search failed');
          }
          return [];
        }

        const html = await response.text();
        const lots = extractAuctionsFromHtml(html);
        let results = lots.map(parseLot);

        if (options.minPrice != null) results = results.filter(r => r.price >= options.minPrice!);
        if (options.maxPrice != null) results = results.filter(r => r.price <= options.maxPrice!);
        return results.slice(0, options.maxResults ?? 24);
      } catch (err) {
        logger.error({ err }, 'B-Stock search error');
        return [];
      }
    },

    async getProduct(productId: string): Promise<ProductSearchResult | null> {
      logger.info({ productId }, 'Getting B-Stock auction');

      try {
        const response = await fetch(`https://bstock.com/auction/${encodeURIComponent(productId)}`, {
          headers: HEADERS,
        });
        if (!response.ok) return null;

        const html = await response.text();
        const lots = extractAuctionsFromHtml(html);
        return lots[0] ? parseLot(lots[0]) : null;
      } catch (err) {
        logger.error({ productId, err }, 'B-Stock auction lookup error');
        return null;
      }
    },

    async checkStock(productId: string): Promise<{ inStock: boolean; quantity?: number }> {
      const product = await this.getProduct(productId);
      return { inStock: product?.inStock ?? false };
    },
  };
}
