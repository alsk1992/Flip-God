/**
 * Profit Calculator - Calculates fees, shipping, and net profit
 */

import { createLogger } from '../utils/logger';
import type { Platform } from '../types';
import type { FeeStructure, ProfitCalculation } from './types';

const logger = createLogger('calculator');

// Category-specific fee rates (major categories)
const AMAZON_CATEGORY_FEES: Record<string, number> = {
  'electronics': 8, 'computers': 8, 'video_games': 15,
  'clothing': 17, 'shoes': 15, 'jewelry': 20, 'watches': 16,
  'books': 15, 'music': 15, 'dvd': 15,
  'toys': 15, 'sports': 15, 'outdoors': 15,
  'home': 15, 'kitchen': 15, 'garden': 15,
  'beauty': 8, 'health': 8, 'grocery': 8,
  'automotive': 12, 'tools': 15,
  'baby': 8, 'pet': 15, 'office': 15,
};

const EBAY_CATEGORY_FEES: Record<string, number> = {
  'electronics': 9.9, 'computers': 9.9, 'phones': 9.9,
  'clothing': 12.9, 'shoes': 12.9, 'jewelry': 15, 'watches': 15,
  'books': 14.6, 'music': 14.6, 'movies': 14.6,
  'toys': 12.9, 'sports': 12.9, 'collectibles': 12.9,
  'home': 12.9, 'garden': 12.9, 'kitchen': 12.9,
  'automotive': 12.9, 'parts': 12.9,
  'beauty': 12.9, 'health': 12.9,
  'business': 12.9, 'industrial': 12.9,
};

const WALMART_CATEGORY_FEES: Record<string, number> = {
  'electronics': 8, 'computers': 8, 'cameras': 8,
  'clothing': 15, 'shoes': 15, 'accessories': 15,
  'home': 15, 'furniture': 10, 'garden': 15,
  'toys': 15, 'sports': 15, 'outdoors': 15,
  'beauty': 15, 'health': 15, 'grocery': 15,
  'automotive': 12, 'jewelry': 20,
};

function getCategoryFee(platform: Platform, category?: string): number {
  if (!category) return DEFAULT_FEE_SCHEDULES[platform].sellerFeePct;
  const cat = category.toLowerCase().replace(/[^a-z_]/g, '');
  switch (platform) {
    case 'amazon': return AMAZON_CATEGORY_FEES[cat] ?? 15;
    case 'ebay': return EBAY_CATEGORY_FEES[cat] ?? 12.9;
    case 'walmart': return WALMART_CATEGORY_FEES[cat] ?? 15;
    case 'aliexpress': return 8;
    default: return DEFAULT_FEE_SCHEDULES[platform].sellerFeePct;
  }
}

// Default fee schedules (used when no category is specified)
const DEFAULT_FEE_SCHEDULES: Record<Platform, FeeStructure> = {
  amazon: {
    platform: 'amazon',
    sellerFeePct: 15,
    fixedFee: 0.99,
    paymentProcessingPct: 0,
    shippingEstimate: 5.99,
  },
  ebay: {
    platform: 'ebay',
    sellerFeePct: 12.9,
    fixedFee: 0.30,
    paymentProcessingPct: 0,
    shippingEstimate: 5.99,
  },
  walmart: {
    platform: 'walmart',
    sellerFeePct: 15,
    fixedFee: 0,
    paymentProcessingPct: 0,
    shippingEstimate: 5.49,
  },
  aliexpress: {
    platform: 'aliexpress',
    sellerFeePct: 8,
    fixedFee: 0,
    paymentProcessingPct: 0,
    shippingEstimate: 0,
  },
  bestbuy: {
    platform: 'bestbuy',
    sellerFeePct: 0,
    fixedFee: 0,
    paymentProcessingPct: 0,
    shippingEstimate: 5.99,
  },
  target: {
    platform: 'target',
    sellerFeePct: 0,
    fixedFee: 0,
    paymentProcessingPct: 0,
    shippingEstimate: 5.99,
  },
  costco: {
    platform: 'costco',
    sellerFeePct: 0,
    fixedFee: 0,
    paymentProcessingPct: 0,
    shippingEstimate: 0,
  },
  homedepot: {
    platform: 'homedepot',
    sellerFeePct: 0,
    fixedFee: 0,
    paymentProcessingPct: 0,
    shippingEstimate: 5.99,
  },
  poshmark: {
    platform: 'poshmark',
    sellerFeePct: 20,
    fixedFee: 0,
    paymentProcessingPct: 0,
    shippingEstimate: 7.97,
  },
  mercari: {
    platform: 'mercari',
    sellerFeePct: 10,
    fixedFee: 0,
    paymentProcessingPct: 0,
    shippingEstimate: 0,
  },
  facebook: {
    platform: 'facebook',
    sellerFeePct: 5,
    fixedFee: 0,
    paymentProcessingPct: 0,
    shippingEstimate: 0,
  },
  faire: {
    platform: 'faire',
    sellerFeePct: 15,
    fixedFee: 0,
    paymentProcessingPct: 0,
    shippingEstimate: 0,
  },
  bstock: {
    platform: 'bstock',
    sellerFeePct: 0,
    fixedFee: 0,
    paymentProcessingPct: 0,
    shippingEstimate: 0,
  },
  bulq: {
    platform: 'bulq',
    sellerFeePct: 0,
    fixedFee: 0,
    paymentProcessingPct: 0,
    shippingEstimate: 0,
  },
  liquidation: {
    platform: 'liquidation',
    sellerFeePct: 0,
    fixedFee: 0,
    paymentProcessingPct: 0,
    shippingEstimate: 0,
  },
};

// Alias for backward compat
const FEE_SCHEDULES = DEFAULT_FEE_SCHEDULES;

export function getFeeSchedule(platform: Platform): FeeStructure {
  return FEE_SCHEDULES[platform];
}

export function calculateProfit(
  sellPlatform: Platform,
  sellPrice: number,
  buyPlatform: Platform,
  buyPrice: number,
  buyShipping: number = 0,
  sellShipping: number = 0,
): ProfitCalculation {
  const fees = FEE_SCHEDULES[sellPlatform];

  const platformFees = (sellPrice * fees.sellerFeePct) / 100 + fees.fixedFee;
  const paymentFees = (sellPrice * fees.paymentProcessingPct) / 100;
  const shippingCost = sellShipping || fees.shippingEstimate;

  const totalCost = buyPrice + buyShipping + platformFees + paymentFees + shippingCost;
  const grossProfit = sellPrice - buyPrice - buyShipping;
  const netProfit = sellPrice - totalCost;
  const marginPct = sellPrice > 0 ? (netProfit / sellPrice) * 100 : 0;
  const roi = totalCost > 0 ? (netProfit / (buyPrice + buyShipping)) * 100 : 0;

  return {
    sellPrice,
    buyPrice,
    buyShipping,
    platformFees,
    paymentFees,
    shippingCost,
    totalCost,
    grossProfit,
    netProfit,
    marginPct,
    roi,
  };
}

export function calculateFees(platform: Platform, price: number, category?: string): {
  sellerFee: number;
  fixedFee: number;
  paymentFee: number;
  totalFees: number;
  netAfterFees: number;
} {
  const fees = FEE_SCHEDULES[platform];
  const feePct = getCategoryFee(platform, category);
  const sellerFee = (price * feePct) / 100;
  const fixedFee = fees.fixedFee;
  const paymentFee = (price * fees.paymentProcessingPct) / 100;
  const totalFees = sellerFee + fixedFee + paymentFee;
  return {
    sellerFee: Math.round(sellerFee * 100) / 100,
    fixedFee,
    paymentFee: Math.round(paymentFee * 100) / 100,
    totalFees: Math.round(totalFees * 100) / 100,
    netAfterFees: Math.round((price - totalFees) * 100) / 100,
  };
}
