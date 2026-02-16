/**
 * BULQ Liquidation — Web scraping adapter
 *
 * BULQ (owned by Optoro) sells fixed-price liquidation lots from retailers.
 * No public API exists. Zero open-source scrapers exist on GitHub.
 *
 * This adapter scrapes bulq.com listing pages, extracting data from:
 * 1. JSON-LD structured data (schema.org Product markup)
 * 2. __NEXT_DATA__ (if they use Next.js)
 * 3. HTML parsing as fallback
 *
 * BULQ lots contain: retail value, lot price, item count, condition, category, manifest.
 */

import { createLogger } from '../../utils/logger';
import type { PlatformAdapter, ProductSearchResult, SearchOptions } from '../index';

const logger = createLogger('bulq');

const BASE_URL = 'https://www.bulq.com';

const HEADERS: Record<string, string> = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.bulq.com/',
};

interface BulqLot {
  id: string;
  title: string;
  price: number;
  retailValue?: number;
  category?: string;
  condition?: string;
  imageUrl?: string;
  itemCount?: number;
  source?: string; // retailer name
  url?: string;
}

function parseLot(item: BulqLot): ProductSearchResult {
  return {
    platformId: item.id,
    platform: 'bulq',
    title: item.title,
    price: item.price,
    shipping: 0, // BULQ shipping varies but often included
    currency: 'USD',
    inStock: true, // listed lots are available
    seller: item.source ?? 'BULQ',
    url: item.url ?? `${BASE_URL}/lot/${item.id}`,
    imageUrl: item.imageUrl,
    category: item.category,
    msrp: item.retailValue,
  };
}

function extractLotsFromHtml(html: string): BulqLot[] {
  const lots: BulqLot[] = [];

  // Try JSON-LD
  const jsonLdMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  for (const match of jsonLdMatches) {
    try {
      const ld = JSON.parse(match[1]) as any;
      const items = ld['@type'] === 'ItemList' ? (ld.itemListElement ?? []) :
                    ld['@type'] === 'Product' ? [ld] : [];
      for (const item of items) {
        if (item.name) {
          lots.push({
            id: item.url?.split('/').pop() ?? item.sku ?? '',
            title: item.name,
            price: parseFloat(item.offers?.price ?? '0') || 0,
            imageUrl: item.image,
            url: item.url,
            category: item.category,
          });
        }
      }
    } catch { /* skip */ }
  }

  // Try __NEXT_DATA__
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextMatch?.[1]) {
    try {
      const data = JSON.parse(nextMatch[1]) as any;
      const items = data?.props?.pageProps?.lots ??
                    data?.props?.pageProps?.results ??
                    data?.props?.pageProps?.products ?? [];
      for (const item of items) {
        lots.push({
          id: item.id ?? item.lotId ?? item.slug ?? '',
          title: item.title ?? item.name ?? '',
          price: item.price ?? item.lotPrice ?? 0,
          retailValue: item.retailValue ?? item.estimatedRetailValue ?? item.msrp,
          category: item.category ?? item.categoryName,
          condition: item.condition,
          imageUrl: item.imageUrl ?? item.image ?? item.thumbnailUrl,
          itemCount: item.itemCount ?? item.quantity ?? item.unitCount,
          source: item.source ?? item.retailer,
          url: item.url,
        });
      }
    } catch { /* skip */ }
  }

  // Fallback: try to extract from HTML patterns
  if (lots.length === 0) {
    // Look for lot cards with price and title
    const lotPattern = /href="\/lot\/([^"]+)"[\s\S]*?class="[^"]*(?:title|name)[^"]*"[^>]*>([^<]+)/g;
    let m;
    while ((m = lotPattern.exec(html)) !== null) {
      lots.push({
        id: m[1],
        title: m[2].trim(),
        price: 0,
      });
    }
  }

  return lots;
}

export function createBulqAdapter(): PlatformAdapter {
  return {
    platform: 'bulq',

    async search(options: SearchOptions): Promise<ProductSearchResult[]> {
      logger.info({ query: options.query }, 'Searching BULQ');

      try {
        // BULQ search URL pattern
        const url = `${BASE_URL}/search?q=${encodeURIComponent(options.query)}`;
        const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30_000) });

        if (!response.ok) {
          if (response.status === 403) {
            logger.warn('BULQ blocked request (403)');
          } else {
            logger.error({ status: response.status }, 'BULQ search failed');
          }
          return [];
        }

        const html = await response.text();
        const lots = extractLotsFromHtml(html);
        let results = lots.map(parseLot);

        if (options.minPrice != null) results = results.filter(r => r.price >= options.minPrice!);
        if (options.maxPrice != null) results = results.filter(r => r.price <= options.maxPrice!);
        return results.slice(0, options.maxResults ?? 24);
      } catch (err) {
        logger.error({ err }, 'BULQ search error');
        return [];
      }
    },

    async getProduct(productId: string): Promise<ProductSearchResult | null> {
      logger.info({ productId }, 'Getting BULQ lot');

      try {
        const response = await fetch(`${BASE_URL}/lot/${encodeURIComponent(productId)}`, {
          headers: HEADERS,
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) return null;

        const html = await response.text();
        const lots = extractLotsFromHtml(html);
        return lots[0] ? parseLot(lots[0]) : null;
      } catch (err) {
        logger.error({ productId, err }, 'BULQ lot lookup error');
        return null;
      }
    },

    async checkStock(productId: string): Promise<{ inStock: boolean; quantity?: number }> {
      const product = await this.getProduct(productId);
      return { inStock: product?.inStock ?? false };
    },
  };
}
