/**
 * Marketplace Advertising Types
 */

export type AdPlatform = 'ebay' | 'amazon';
export type CampaignStatus = 'active' | 'paused' | 'ended' | 'draft';
export type CampaignType = 'promoted_listing' | 'sponsored_product' | 'sponsored_brand';

export interface AdCampaign {
  id: string;
  platform: AdPlatform;
  campaignType: CampaignType;
  name: string;
  status: CampaignStatus;
  budget?: number;
  dailyBudget?: number;
  adRate?: number;           // eBay promoted listing ad rate %
  defaultBid?: number;       // Amazon CPC bid
  targetAcos?: number;       // Amazon target ACOS %
  listingIds: string[];
  startDate: string;
  endDate?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AdPerformance {
  campaignId: string;
  platform: AdPlatform;
  impressions: number;
  clicks: number;
  ctr: number;               // Click-through rate %
  spend: number;
  sales: number;
  orders: number;
  acos: number;              // Advertising cost of sale %
  roas: number;              // Return on ad spend
  conversionRate: number;    // Orders / clicks %
  avgCpc: number;            // Average cost per click
  period: string;
}

export interface BidOptimization {
  campaignId: string;
  currentBid: number;
  recommendedBid: number;
  reason: string;
  expectedAcos: number;
  expectedRoas: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface AdRateOptimization {
  campaignId: string;
  currentRate: number;
  recommendedRate: number;
  reason: string;
  expectedImpressionLift: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface PauseRecommendation {
  campaignId: string;
  campaignName: string;
  platform: AdPlatform;
  currentRoas: number;
  targetRoas: number;
  spend: number;
  sales: number;
  recommendation: 'pause' | 'reduce_bid' | 'keep';
  reason: string;
}
