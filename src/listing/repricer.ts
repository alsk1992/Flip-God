/**
 * Dynamic Repricing Engine - Automatically adjust listing prices
 */

import { createLogger } from '../utils/logger';
import type { Platform, Listing } from '../types';

const logger = createLogger('repricer');

export interface RepricingRule {
  id: string;
  platform: Platform;
  strategy: 'match_lowest' | 'beat_lowest' | 'target_margin' | 'velocity';
  minPrice: number;
  maxPrice: number;
  targetMarginPct?: number;
  beatByAmount?: number;
  beatByPct?: number;
}

export interface RepricingResult {
  listingId: string;
  oldPrice: number;
  newPrice: number;
  reason: string;
  competitorPrice?: number;
  applied: boolean;
}

export interface CompetitorPrice {
  platform: Platform;
  price: number;
  shipping: number;
  seller: string;
  fetchedAt: Date;
}

export interface Repricer {
  evaluate(listing: Listing, competitors: CompetitorPrice[], rule: RepricingRule): RepricingResult;
  evaluateAll(listings: Listing[], rules: Map<string, RepricingRule>, getCompetitors: (l: Listing) => CompetitorPrice[]): RepricingResult[];
}

export function createRepricer(): Repricer {
  return {
    evaluate(listing: Listing, competitors: CompetitorPrice[], rule: RepricingRule): RepricingResult {
      const lowestCompetitor = competitors.reduce<CompetitorPrice | null>((min, c) => {
        const total = c.price + c.shipping;
        if (!min || total < min.price + min.shipping) return c;
        return min;
      }, null);

      const lowestTotal = lowestCompetitor ? lowestCompetitor.price + lowestCompetitor.shipping : null;
      let newPrice = listing.price;
      let reason = 'No change';

      switch (rule.strategy) {
        case 'match_lowest':
          if (lowestTotal != null && lowestTotal < listing.price) {
            newPrice = lowestTotal;
            reason = `Matched lowest at $${lowestTotal.toFixed(2)}`;
          }
          break;

        case 'beat_lowest':
          if (lowestTotal != null) {
            const beatAmt = rule.beatByAmount ?? 0;
            const beatPct = rule.beatByPct ?? 0;
            newPrice = Math.min(lowestTotal - beatAmt, lowestTotal * (1 - beatPct / 100));
            reason = `Beat lowest ($${lowestTotal.toFixed(2)})`;
          }
          break;

        case 'target_margin':
          if (rule.targetMarginPct != null) {
            const target = listing.sourcePrice * (1 + rule.targetMarginPct / 100);
            newPrice = target;
            reason = `Target margin ${rule.targetMarginPct}%`;
            if (lowestTotal != null && lowestTotal < target) {
              const floor = listing.sourcePrice * 1.05;
              newPrice = Math.max(lowestTotal - 0.01, floor);
              reason = 'Adjusted to beat competitor at floor';
            }
          }
          break;

        case 'velocity':
          newPrice = listing.price * 0.98;
          reason = 'Velocity decrease 2%';
          break;
      }

      newPrice = Math.round(newPrice * 100) / 100;
      if (newPrice < rule.minPrice) { newPrice = rule.minPrice; reason += ' (floor)'; }
      if (newPrice > rule.maxPrice) { newPrice = rule.maxPrice; reason += ' (ceiling)'; }

      const changed = Math.abs(newPrice - listing.price) > 0.005;
      if (changed) {
        logger.info({ listingId: listing.id, oldPrice: listing.price, newPrice, reason }, 'Price adjusted');
      }

      return {
        listingId: listing.id,
        oldPrice: listing.price,
        newPrice,
        reason,
        competitorPrice: lowestTotal ?? undefined,
        applied: changed,
      };
    },

    evaluateAll(listings: Listing[], rules: Map<string, RepricingRule>, getCompetitors: (l: Listing) => CompetitorPrice[]): RepricingResult[] {
      const results: RepricingResult[] = [];
      for (const listing of listings) {
        if (listing.status !== 'active') continue;
        const rule = rules.get(listing.platform);
        if (!rule) continue;
        results.push(this.evaluate(listing, getCompetitors(listing), rule));
      }
      const adjusted = results.filter(r => r.applied).length;
      logger.info({ total: results.length, adjusted }, 'Repricing cycle complete');
      return results;
    },
  };
}
