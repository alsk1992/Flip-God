/**
 * Arbitrage Scanner - Finds cross-platform price differences
 */

import { createLogger } from '../utils/logger';
import type { Platform } from '../types';
import type { ArbitrageOpportunity } from './types';
import { calculateProfit } from './calculator';
import type { ProductSearchResult, PlatformAdapter } from '../platforms/index';

const logger = createLogger('scanner');

export interface ScanOptions {
  query?: string;
  category?: string;
  minMarginPct?: number;
  maxResults?: number;
  platforms?: Platform[];
}

export async function scanForArbitrage(
  adapters: Map<Platform, PlatformAdapter>,
  options: ScanOptions = {},
): Promise<ArbitrageOpportunity[]> {
  const {
    query = 'electronics',
    category,
    minMarginPct = 15,
    maxResults = 20,
    platforms,
  } = options;

  const activePlatforms = platforms || Array.from(adapters.keys());
  logger.info({ query, platforms: activePlatforms, minMarginPct }, 'Starting arbitrage scan');

  // 1. Search all platforms in parallel
  const searchPromises = activePlatforms.map(async (platform) => {
    const adapter = adapters.get(platform);
    if (!adapter) return [];
    try {
      return await adapter.search({ query, category, maxResults: 20 });
    } catch (err) {
      logger.error({ platform, err }, 'Search failed');
      return [];
    }
  });

  const allResults = await Promise.all(searchPromises);
  const flatResults = allResults.flat();

  // 2. Group by product similarity (simple title matching for now)
  // In production, use UPC/ASIN matching
  const opportunities: ArbitrageOpportunity[] = [];

  // Compare every pair of results across different platforms
  for (let i = 0; i < flatResults.length; i++) {
    for (let j = i + 1; j < flatResults.length; j++) {
      const a = flatResults[i];
      const b = flatResults[j];

      if (a.platform === b.platform) continue;

      // Determine buy/sell sides
      const totalA = a.price + a.shipping;
      const totalB = b.price + b.shipping;

      let buy: ProductSearchResult, sell: ProductSearchResult;
      if (totalA < totalB) {
        buy = a; sell = b;
      } else {
        buy = b; sell = a;
      }

      const calc = calculateProfit(
        sell.platform,
        sell.price,
        buy.platform,
        buy.price,
        buy.shipping,
      );

      if (calc.marginPct >= minMarginPct && calc.netProfit > 0) {
        opportunities.push({
          productId: buy.platformId,
          productTitle: buy.title,
          buyPlatform: buy.platform,
          buyPrice: buy.price,
          buyShipping: buy.shipping,
          buyUrl: buy.url,
          sellPlatform: sell.platform,
          sellPrice: sell.price,
          sellShipping: sell.shipping,
          estimatedFees: calc.platformFees + calc.paymentFees,
          estimatedProfit: calc.netProfit,
          marginPct: calc.marginPct,
          score: calc.marginPct * Math.log(calc.netProfit + 1),
        });
      }
    }
  }

  // 3. Sort by score and limit
  opportunities.sort((a, b) => b.score - a.score);
  const limited = opportunities.slice(0, maxResults);

  logger.info({ found: limited.length, total: opportunities.length }, 'Arbitrage scan complete');
  return limited;
}
