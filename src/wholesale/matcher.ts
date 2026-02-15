/**
 * Wholesale Product Matcher
 *
 * Matches wholesale items to Amazon products using UPC, ASIN, or title+brand.
 * Uses the Amazon PA-API for lookups.
 */

import { createLogger } from '../utils/logger';
import type { PlatformAdapter, ProductSearchResult } from '../platforms/index';
import type { WholesaleItem, WholesaleMatch } from './types';

const logger = createLogger('wholesale-matcher');

export interface MatcherConfig {
  amazonAdapter: PlatformAdapter;
  maxConcurrency?: number;
  delayBetweenRequestsMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Match a single wholesale item to an Amazon product.
 */
async function matchSingleItem(
  item: WholesaleItem,
  adapter: PlatformAdapter,
): Promise<WholesaleMatch> {
  // Strategy 1: Direct ASIN lookup
  if (item.asin) {
    try {
      const product = await adapter.getProduct(item.asin);
      if (product) {
        return {
          item,
          amazonMatch: {
            asin: product.asin ?? item.asin,
            title: product.title,
            price: product.price,
            category: product.category,
          },
          matchConfidence: 0.99,
          matchMethod: 'asin',
        };
      }
    } catch (err) {
      logger.debug({ asin: item.asin, err }, 'ASIN lookup failed');
    }
  }

  // Strategy 2: UPC lookup (search by UPC barcode)
  if (item.upc && item.upc.length >= 10) {
    try {
      const results = await adapter.search({ query: item.upc, maxResults: 3 });
      const match = results.find(r => r.upc === item.upc);
      if (match) {
        return {
          item,
          amazonMatch: {
            asin: match.asin ?? match.platformId,
            title: match.title,
            price: match.price,
            category: match.category,
          },
          matchConfidence: 0.95,
          matchMethod: 'upc',
        };
      }
      // Even without exact UPC match, first result might be right
      if (results.length > 0) {
        return {
          item,
          amazonMatch: {
            asin: results[0].asin ?? results[0].platformId,
            title: results[0].title,
            price: results[0].price,
            category: results[0].category,
          },
          matchConfidence: 0.6,
          matchMethod: 'upc',
        };
      }
    } catch (err) {
      logger.debug({ upc: item.upc, err }, 'UPC search failed');
    }
  }

  // Strategy 3: EAN lookup
  if (item.ean && item.ean.length >= 10) {
    try {
      const results = await adapter.search({ query: item.ean, maxResults: 3 });
      if (results.length > 0) {
        return {
          item,
          amazonMatch: {
            asin: results[0].asin ?? results[0].platformId,
            title: results[0].title,
            price: results[0].price,
            category: results[0].category,
          },
          matchConfidence: 0.7,
          matchMethod: 'ean',
        };
      }
    } catch (err) {
      logger.debug({ ean: item.ean, err }, 'EAN search failed');
    }
  }

  // Strategy 4: Title + Brand search
  if (item.title) {
    const query = item.brand ? `${item.brand} ${item.title}` : item.title;
    try {
      const results = await adapter.search({ query: query.slice(0, 100), maxResults: 5 });
      if (results.length > 0) {
        // Score results by title similarity
        const scored = results.map(r => ({
          result: r,
          score: titleSimilarity(item.title, r.title, item.brand, r.brand),
        })).sort((a, b) => b.score - a.score);

        if (scored[0].score > 0.3) {
          return {
            item,
            amazonMatch: {
              asin: scored[0].result.asin ?? scored[0].result.platformId,
              title: scored[0].result.title,
              price: scored[0].result.price,
              category: scored[0].result.category,
            },
            matchConfidence: Math.min(scored[0].score, 0.85),
            matchMethod: 'title_brand',
          };
        }
      }
    } catch (err) {
      logger.debug({ title: item.title, err }, 'Title search failed');
    }
  }

  return { item, matchConfidence: 0, matchMethod: 'none' };
}

function titleSimilarity(title1: string, title2: string, brand1?: string, brand2?: string): number {
  const words1 = new Set(title1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = new Set(title2.toLowerCase().split(/\s+/).filter(w => w.length > 2));

  let overlap = 0;
  for (const w of words1) {
    if (words2.has(w)) overlap++;
  }

  const total = Math.max(words1.size, words2.size);
  let score = total > 0 ? overlap / total : 0;

  // Brand match bonus
  if (brand1 && brand2 && brand1.toLowerCase() === brand2.toLowerCase()) {
    score = Math.min(score + 0.2, 1);
  }

  return score;
}

/**
 * Match an array of wholesale items to Amazon products in bulk.
 */
export async function matchWholesaleItems(
  items: WholesaleItem[],
  config: MatcherConfig,
): Promise<WholesaleMatch[]> {
  const { amazonAdapter, maxConcurrency = 3, delayBetweenRequestsMs = 300 } = config;
  const results: WholesaleMatch[] = [];

  logger.info({ count: items.length, concurrency: maxConcurrency }, 'Starting wholesale matching');

  // Process in batches
  for (let i = 0; i < items.length; i += maxConcurrency) {
    const batch = items.slice(i, i + maxConcurrency);
    const batchResults = await Promise.all(
      batch.map(item => matchSingleItem(item, amazonAdapter)),
    );
    results.push(...batchResults);

    // Rate limit delay between batches
    if (i + maxConcurrency < items.length) {
      await sleep(delayBetweenRequestsMs);
    }

    // Progress logging
    if ((i + maxConcurrency) % 50 === 0 || i + maxConcurrency >= items.length) {
      const matched = results.filter(r => r.matchMethod !== 'none').length;
      logger.info({ processed: Math.min(i + maxConcurrency, items.length), matched, total: items.length }, 'Matching progress');
    }
  }

  return results;
}
