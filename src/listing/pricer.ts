/**
 * Dynamic Pricing Engine - Determines optimal listing prices
 */

import { createLogger } from '../utils/logger';
import { calculateProfit } from '../arbitrage/calculator';
import type { Platform } from '../types';
import type { PricingRecommendation } from './types';

const logger = createLogger('pricer');

export function recommendPrice(
  buyPlatform: Platform,
  buyPrice: number,
  buyShipping: number,
  sellPlatform: Platform,
  targetMarginPct: number = 25,
  competitorPrices: number[] = [],
): PricingRecommendation {
  // Calculate minimum viable price (breakeven + target margin)
  const totalCost = buyPrice + buyShipping;
  const minViablePrice = totalCost / (1 - targetMarginPct / 100);

  // Factor in competitor pricing
  const avgCompetitor = competitorPrices.length > 0
    ? competitorPrices.reduce((a, b) => a + b, 0) / competitorPrices.length
    : minViablePrice * 1.2;

  // Recommended: slightly below average competitor, but above minimum
  const recommended = Math.max(minViablePrice, avgCompetitor * 0.95);
  const minPrice = minViablePrice;
  const maxPrice = avgCompetitor * 1.1;

  const calc = calculateProfit(sellPlatform, recommended, buyPlatform, buyPrice, buyShipping);

  return {
    recommendedPrice: Math.round(recommended * 100) / 100,
    minPrice: Math.round(minPrice * 100) / 100,
    maxPrice: Math.round(maxPrice * 100) / 100,
    competitorPrices,
    margin: calc.marginPct,
  };
}
