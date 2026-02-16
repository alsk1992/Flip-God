/**
 * Opportunity Scoring - Ranks arbitrage opportunities
 */

import type { ArbitrageOpportunity } from './types';

export interface ScoringWeights {
  margin: number;       // Weight for margin percentage
  profit: number;       // Weight for absolute profit
  reliability: number;  // Weight for platform reliability
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  margin: 0.4,
  profit: 0.35,
  reliability: 0.25,
};

const PLATFORM_RELIABILITY: Record<string, number> = {
  amazon: 0.95,
  ebay: 0.85,
  walmart: 0.90,
  aliexpress: 0.70,
  bestbuy: 0.9,
  target: 0.9,
  costco: 0.9,
  homedepot: 0.85,
  poshmark: 0.65,
  mercari: 0.6,
  facebook: 0.55,
  faire: 0.75,
  bstock: 0.7,
  bulq: 0.7,
  liquidation: 0.65,
};

export function scoreOpportunity(
  opp: ArbitrageOpportunity,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
): number {
  // Normalize margin (0-100% → 0-1)
  const marginScore = Math.min(opp.marginPct / 50, 1);

  // Normalize profit ($0-$50 → 0-1)
  const profitScore = Math.min(opp.estimatedProfit / 50, 1);

  // Platform reliability
  const buyReliability = PLATFORM_RELIABILITY[opp.buyPlatform] ?? 0.5;
  const sellReliability = PLATFORM_RELIABILITY[opp.sellPlatform] ?? 0.5;
  const reliabilityScore = (buyReliability + sellReliability) / 2;

  const score = (marginScore * weights.margin) +
                (profitScore * weights.profit) +
                (reliabilityScore * weights.reliability);

  return Math.round(score * 100) / 100;
}

export function rankOpportunities(
  opportunities: ArbitrageOpportunity[],
  weights?: ScoringWeights,
): ArbitrageOpportunity[] {
  return opportunities
    .map(opp => ({
      ...opp,
      score: scoreOpportunity(opp, weights),
    }))
    .sort((a, b) => b.score - a.score);
}
