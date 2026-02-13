/**
 * Arbitrage Engine Types
 */

import type { Platform } from '../types';

export interface ArbitrageOpportunity {
  productId: string;
  productTitle: string;
  buyPlatform: Platform;
  buyPrice: number;
  buyShipping: number;
  buyUrl: string;
  sellPlatform: Platform;
  sellPrice: number;
  sellShipping: number;
  estimatedFees: number;
  estimatedProfit: number;
  marginPct: number;
  score: number;
}

export interface FeeStructure {
  platform: Platform;
  sellerFeePct: number;
  fixedFee: number;
  paymentProcessingPct: number;
  shippingEstimate: number;
}

export interface ProfitCalculation {
  sellPrice: number;
  buyPrice: number;
  buyShipping: number;
  platformFees: number;
  paymentFees: number;
  shippingCost: number;
  totalCost: number;
  grossProfit: number;
  netProfit: number;
  marginPct: number;
  roi: number;
}
