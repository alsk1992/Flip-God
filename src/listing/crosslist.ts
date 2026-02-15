/**
 * Cross-Listing Sync - Manage listings across multiple platforms
 */

import { createLogger } from '../utils/logger';
import type { Platform, Listing } from '../types';

const logger = createLogger('crosslist');

export interface CrossListConfig {
  sourcePlatform: Platform;
  targetPlatforms: Platform[];
  pricingRules: PricingRule[];
  autoSync: boolean;
  syncIntervalMs: number;
}

export interface PricingRule {
  platform: Platform;
  type: 'fixed_markup' | 'percentage_markup' | 'match_price' | 'custom';
  value?: number;
  minPrice?: number;
  maxPrice?: number;
}

export interface CrossListResult {
  productId: string;
  listings: Array<{
    platform: Platform;
    status: 'created' | 'updated' | 'failed' | 'skipped';
    listingId?: string;
    price?: number;
    error?: string;
  }>;
}

export interface CrossListManager {
  crossList(productId: string, sourcePrice: number, config: CrossListConfig): CrossListResult;
  calculateTargetPrice(sourcePrice: number, rule: PricingRule): number;
  syncAll(listings: Listing[], config: CrossListConfig): CrossListResult[];
}

export function createCrossListManager(): CrossListManager {
  return {
    crossList(productId: string, sourcePrice: number, config: CrossListConfig): CrossListResult {
      const result: CrossListResult = { productId, listings: [] };

      for (const target of config.targetPlatforms) {
        const rule = config.pricingRules.find(r => r.platform === target);
        if (!rule) {
          result.listings.push({ platform: target, status: 'skipped', error: 'No pricing rule' });
          continue;
        }

        const price = this.calculateTargetPrice(sourcePrice, rule);
        if (price <= 0) {
          result.listings.push({ platform: target, status: 'skipped', error: 'Price too low' });
          continue;
        }

        result.listings.push({ platform: target, status: 'created', price });
        logger.info({ productId, platform: target, price }, 'Cross-listed product');
      }

      return result;
    },

    calculateTargetPrice(sourcePrice: number, rule: PricingRule): number {
      let price: number;
      switch (rule.type) {
        case 'fixed_markup':
          price = sourcePrice + (rule.value ?? 5);
          break;
        case 'percentage_markup':
          price = sourcePrice * (1 + (rule.value ?? 15) / 100);
          break;
        case 'match_price':
          price = sourcePrice;
          break;
        case 'custom':
          price = rule.value ?? sourcePrice;
          break;
        default:
          price = sourcePrice;
      }

      price = Math.round(price * 100) / 100;
      if (rule.minPrice != null && price < rule.minPrice) price = rule.minPrice;
      if (rule.maxPrice != null && price > rule.maxPrice) price = rule.maxPrice;
      return price;
    },

    syncAll(listings: Listing[], config: CrossListConfig): CrossListResult[] {
      const results: CrossListResult[] = [];
      for (const listing of listings) {
        if (listing.platform !== config.sourcePlatform) continue;
        if (listing.status !== 'active') continue;
        results.push(this.crossList(listing.productId, listing.price, config));
      }
      logger.info({ count: results.length }, 'Cross-list sync complete');
      return results;
    },
  };
}
