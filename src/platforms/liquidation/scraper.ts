/**
 * Liquidation.com — Web scraping adapter
 *
 * Liquidation.com runs surplus/returned merchandise auctions.
 * No public API exists. Zero open-source scrapers on GitHub.
 * Site uses Cloudflare protection (may return 403 on direct fetch).
 *
 * Approach: Fetch auction listing/search pages, extract data from
 * JSON-LD, __NEXT_DATA__, or HTML structure.
 */

import { createLogger } from '../../utils/logger';
import type { PlatformAdapter, ProductSearchResult, SearchOptions } from '../index';

const logger = createLogger('liquidation');

const BASE_URL = 'https://www.liquidation.com';

const HEADERS: Record<string, string> = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.liquidation.com/',
  'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
};

interface LiquidationAuction {
  id: string;
  title: string;
  currentBid: number;
  retailValue?: number;
  category?: string;
  condition?: string;
  imageUrl?: string;
  seller?: string;
  endTime?: string;
  itemCount?: number;
  url?: string;
}

function parseAuction(item: LiquidationAuction): ProductSearchResult {
  return {
    platformId: item.id,
    platform: 'liquidation',
    title: item.title,
    price: item.currentBid,
    shipping: 0,
    currency: 'USD',
    inStock: true, // open auctions are available
    seller: item.seller ?? 'Liquidation.com',
    url: item.url ?? `${BASE_URL}/auction/${item.id}`,
    imageUrl: item.imageUrl,
    category: item.category,
    msrp: item.retailValue,
  };
}

function extractAuctionsFromHtml(html: string): LiquidationAuction[] {
  const auctions: LiquidationAuction[] = [];

  // JSON-LD structured data
  const jsonLdMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  for (const match of jsonLdMatches) {
    try {
      const ld = JSON.parse(match[1]) as any;
      const items = ld['@type'] === 'ItemList' ? (ld.itemListElement ?? []) :
                    ld['@type'] === 'Product' ? [ld] : [];
      for (const item of items) {
        if (item.name) {
          auctions.push({
            id: item.url?.split('/').pop() ?? item.sku ?? '',
            title: item.name,
            currentBid: parseFloat(item.offers?.price ?? '0') || 0,
            imageUrl: item.image,
            url: item.url,
            category: item.category,
          });
        }
      }
    } catch { /* skip */ }
  }

  // __NEXT_DATA__
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextMatch?.[1]) {
    try {
      const data = JSON.parse(nextMatch[1]) as any;
      const items = data?.props?.pageProps?.auctions ??
                    data?.props?.pageProps?.results ??
                    data?.props?.pageProps?.lots ?? [];
      for (const item of items) {
        auctions.push({
          id: item.id ?? item.auctionId ?? item.slug ?? '',
          title: item.title ?? item.name ?? '',
          currentBid: item.currentBid ?? item.currentPrice ?? item.price ?? 0,
          retailValue: item.retailValue ?? item.estimatedRetailValue ?? item.msrp,
          category: item.category ?? item.categoryName,
          condition: item.condition,
          imageUrl: item.imageUrl ?? item.image ?? item.thumbnailUrl,
          seller: item.seller ?? item.source,
          itemCount: item.itemCount ?? item.quantity,
          url: item.url,
        });
      }
    } catch { /* skip */ }
  }

  // Fallback: Extract from HTML auction cards
  if (auctions.length === 0) {
    // Look for common auction page patterns
    const auctionPattern = /href="\/auction\/([^"]+)"[\s\S]*?class="[^"]*(?:title|name|lot-title)[^"]*"[^>]*>([^<]+)/g;
    let m;
    while ((m = auctionPattern.exec(html)) !== null) {
      auctions.push({
        id: m[1],
        title: m[2].trim(),
        currentBid: 0,
      });
    }

    // Try alternate pattern with data attributes
    const dataPattern = /data-(?:auction|lot)-id="([^"]+)"/g;
    let dm;
    while ((dm = dataPattern.exec(html)) !== null) {
      if (!auctions.find(a => a.id === dm![1])) {
        auctions.push({ id: dm[1], title: '', currentBid: 0 });
      }
    }
  }

  return auctions;
}

export function createLiquidationAdapter(): PlatformAdapter {
  return {
    platform: 'liquidation',

    async search(options: SearchOptions): Promise<ProductSearchResult[]> {
      logger.info({ query: options.query }, 'Searching Liquidation.com');

      try {
        const url = `${BASE_URL}/auction/search?flag=new&query=${encodeURIComponent(options.query)}`;
        const response = await fetch(url, { headers: HEADERS });

        if (!response.ok) {
          if (response.status === 403) {
            logger.warn('Liquidation.com blocked by Cloudflare (403) — browser automation required');
          } else {
            logger.error({ status: response.status }, 'Liquidation.com search failed');
          }
          return [];
        }

        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('json')) {
          // Lucky — direct JSON response
          const data = await response.json() as { auctions?: any[] };
          return (data.auctions ?? []).map((a: any) => parseAuction({
            id: a.id ?? a.auctionId ?? '',
            title: a.title ?? a.name ?? '',
            currentBid: a.currentBid ?? a.price ?? 0,
            retailValue: a.retailValue,
            category: a.category,
            imageUrl: a.imageUrl ?? a.image,
            url: a.url,
          })).slice(0, options.maxResults ?? 24);
        }

        // HTML response — parse it
        const html = await response.text();
        const items = extractAuctionsFromHtml(html);
        let results = items.map(parseAuction);

        if (options.minPrice != null) results = results.filter(r => r.price >= options.minPrice!);
        if (options.maxPrice != null) results = results.filter(r => r.price <= options.maxPrice!);
        return results.slice(0, options.maxResults ?? 24);
      } catch (err) {
        logger.error({ err }, 'Liquidation.com search error');
        return [];
      }
    },

    async getProduct(productId: string): Promise<ProductSearchResult | null> {
      logger.info({ productId }, 'Getting Liquidation.com auction');

      try {
        const response = await fetch(`${BASE_URL}/auction/${encodeURIComponent(productId)}`, {
          headers: HEADERS,
        });
        if (!response.ok) return null;

        const html = await response.text();
        const items = extractAuctionsFromHtml(html);
        return items[0] ? parseAuction(items[0]) : null;
      } catch (err) {
        logger.error({ productId, err }, 'Liquidation.com auction lookup error');
        return null;
      }
    },

    async checkStock(productId: string): Promise<{ inStock: boolean; quantity?: number }> {
      const product = await this.getProduct(productId);
      return { inStock: product?.inStock ?? false };
    },
  };
}
