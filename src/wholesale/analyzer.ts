/**
 * Wholesale Profitability Analyzer
 *
 * Takes matched wholesale items and calculates profitability.
 */

import { createLogger } from '../utils/logger';
import { calculateReferralFee, calculateFulfillmentFee, determineSizeTier } from '../arbitrage/fba-fees';
import type { WholesaleMatch, WholesaleAnalysisResult } from './types';

const logger = createLogger('wholesale-analyzer');

export interface AnalyzerConfig {
  minROI?: number;         // minimum ROI % to consider profitable (default: 30)
  minMarginPct?: number;   // minimum margin % (default: 10)
  maxResults?: number;     // max top opportunities to return (default: 50)
  defaultWeightLbs?: number; // default weight if unknown (default: 1)
  shippingToFBA?: number;  // per-unit cost to ship to FBA warehouse (default: 0.50)
}

function addProfitAnalysis(match: WholesaleMatch, config: AnalyzerConfig): WholesaleMatch {
  if (!match.amazonMatch || match.matchMethod === 'none') return match;

  const salePrice = match.amazonMatch.price;
  const costPerUnit = match.item.wholesalePrice;

  if (salePrice <= 0 || costPerUnit <= 0) return match;

  // Estimate FBA fees
  const category = match.amazonMatch.category ?? match.item.category;
  const referralFee = calculateReferralFee(salePrice, category);

  // Estimate fulfillment fee based on weight
  const weightLbs = match.item.weight ?? config.defaultWeightLbs ?? 1;
  const sizeTier = determineSizeTier({
    lengthInches: 10, widthInches: 8, heightInches: 4,
    weightLbs,
  });
  const fulfillmentFee = calculateFulfillmentFee(sizeTier, weightLbs);

  const shippingToFBA = config.shippingToFBA ?? 0.50;
  const totalFees = referralFee + fulfillmentFee + shippingToFBA;
  const netProfit = salePrice - costPerUnit - totalFees;
  const roi = costPerUnit > 0 ? (netProfit / costPerUnit) * 100 : 0;
  const marginPct = salePrice > 0 ? (netProfit / salePrice) * 100 : 0;

  return {
    ...match,
    amazonMatch: {
      ...match.amazonMatch,
      fbaFees: Math.round(fulfillmentFee * 100) / 100,
      referralFee: Math.round(referralFee * 100) / 100,
    },
    profitAnalysis: {
      salePrice: Math.round(salePrice * 100) / 100,
      costPerUnit: Math.round(costPerUnit * 100) / 100,
      totalFees: Math.round(totalFees * 100) / 100,
      netProfit: Math.round(netProfit * 100) / 100,
      roi: Math.round(roi * 10) / 10,
      marginPct: Math.round(marginPct * 10) / 10,
    },
  };
}

/**
 * Analyze an array of wholesale matches for profitability.
 */
export function analyzeWholesaleMatches(
  matches: WholesaleMatch[],
  config: AnalyzerConfig = {},
): WholesaleAnalysisResult {
  const startTime = Date.now();
  const { minROI = 30, minMarginPct = 10, maxResults = 50 } = config;

  // Add profit analysis to each match
  const analyzed = matches.map(m => addProfitAnalysis(m, config));

  // Filter profitable items
  const profitable = analyzed.filter(m =>
    m.profitAnalysis &&
    m.profitAnalysis.roi >= minROI &&
    m.profitAnalysis.marginPct >= minMarginPct &&
    m.profitAnalysis.netProfit > 0,
  );

  // Sort by ROI descending
  profitable.sort((a, b) => (b.profitAnalysis?.roi ?? 0) - (a.profitAnalysis?.roi ?? 0));

  const topOpportunities = profitable.slice(0, maxResults);

  // Calculate averages
  const allROIs = profitable.map(p => p.profitAnalysis?.roi ?? 0);
  const allMargins = profitable.map(p => p.profitAnalysis?.marginPct ?? 0);
  const averageROI = allROIs.length > 0 ? allROIs.reduce((a, b) => a + b, 0) / allROIs.length : 0;
  const averageMargin = allMargins.length > 0 ? allMargins.reduce((a, b) => a + b, 0) / allMargins.length : 0;

  const result: WholesaleAnalysisResult = {
    totalItems: matches.length,
    matchedItems: analyzed.filter(m => m.matchMethod !== 'none').length,
    profitableItems: profitable.length,
    topOpportunities,
    averageROI: Math.round(averageROI * 10) / 10,
    averageMargin: Math.round(averageMargin * 10) / 10,
    processingTimeMs: Date.now() - startTime,
  };

  logger.info({
    total: result.totalItems,
    matched: result.matchedItems,
    profitable: result.profitableItems,
    avgROI: result.averageROI,
  }, 'Wholesale analysis complete');

  return result;
}
