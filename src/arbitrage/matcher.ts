/**
 * Product Matcher - Matches products across platforms using UPC/ASIN/title
 */

import { createLogger } from '../utils/logger';
import type { ProductSearchResult } from '../platforms/index';

const logger = createLogger('matcher');

export interface MatchResult {
  confidence: number;  // 0-1
  matchType: 'upc' | 'asin' | 'title';
  products: ProductSearchResult[];
}

/**
 * Calculate title similarity using Jaccard index on word tokens
 */
function titleSimilarity(a: string, b: string): number {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  const wordsA = new Set(normalize(a));
  const wordsB = new Set(normalize(b));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Match products across platforms
 */
export function matchProducts(results: ProductSearchResult[]): MatchResult[] {
  const matches: MatchResult[] = [];
  const used = new Set<number>();

  // Pass 1: UPC exact match
  for (let i = 0; i < results.length; i++) {
    if (used.has(i) || !results[i].upc) continue;
    const group: ProductSearchResult[] = [results[i]];
    for (let j = i + 1; j < results.length; j++) {
      if (used.has(j)) continue;
      if (results[j].upc && results[j].upc === results[i].upc && results[j].platform !== results[i].platform) {
        group.push(results[j]);
        used.add(j);
      }
    }
    if (group.length > 1) {
      used.add(i);
      matches.push({ confidence: 1.0, matchType: 'upc', products: group });
    }
  }

  // Pass 2: ASIN match (Amazon-specific but sometimes shared)
  for (let i = 0; i < results.length; i++) {
    if (used.has(i) || !results[i].asin) continue;
    const group: ProductSearchResult[] = [results[i]];
    for (let j = i + 1; j < results.length; j++) {
      if (used.has(j)) continue;
      if (results[j].asin && results[j].asin === results[i].asin && results[j].platform !== results[i].platform) {
        group.push(results[j]);
        used.add(j);
      }
    }
    if (group.length > 1) {
      used.add(i);
      matches.push({ confidence: 0.95, matchType: 'asin', products: group });
    }
  }

  // Pass 3: Title similarity
  for (let i = 0; i < results.length; i++) {
    if (used.has(i)) continue;
    const group: ProductSearchResult[] = [results[i]];
    for (let j = i + 1; j < results.length; j++) {
      if (used.has(j)) continue;
      if (results[j].platform === results[i].platform) continue;
      const sim = titleSimilarity(results[i].title, results[j].title);
      if (sim >= 0.6) {
        group.push(results[j]);
        used.add(j);
      }
    }
    if (group.length > 1) {
      used.add(i);
      matches.push({ confidence: 0.7, matchType: 'title', products: group });
    }
  }

  return matches;
}
