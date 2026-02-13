/**
 * Profit Calculator - Calculates fees, shipping, and net profit
 */

import { createLogger } from '../utils/logger';
import type { Platform } from '../types';
import type { FeeStructure, ProfitCalculation } from './types';

const logger = createLogger('calculator');

// Platform fee schedules (simplified)
const FEE_SCHEDULES: Record<Platform, FeeStructure> = {
  amazon: {
    platform: 'amazon',
    sellerFeePct: 15,        // 15% referral fee (varies by category, 8-45%)
    fixedFee: 0.99,          // Per-item fee for individual sellers
    paymentProcessingPct: 0, // Included in referral fee
    shippingEstimate: 5.99,
  },
  ebay: {
    platform: 'ebay',
    sellerFeePct: 13.25,     // Final value fee (varies by category)
    fixedFee: 0.30,          // Per-order fee
    paymentProcessingPct: 0, // Included in final value fee
    shippingEstimate: 5.99,
  },
  walmart: {
    platform: 'walmart',
    sellerFeePct: 15,        // Referral fee (varies by category, 6-20%)
    fixedFee: 0,
    paymentProcessingPct: 0,
    shippingEstimate: 5.49,
  },
  aliexpress: {
    platform: 'aliexpress',
    sellerFeePct: 8,         // Commission rate
    fixedFee: 0,
    paymentProcessingPct: 0,
    shippingEstimate: 0,     // Usually free shipping from AliExpress
  },
};

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
  const sellerFee = (price * fees.sellerFeePct) / 100;
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
