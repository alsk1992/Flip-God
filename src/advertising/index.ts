/**
 * Marketplace Ads Automation Module
 *
 * Create and manage eBay Promoted Listings and Amazon Sponsored Products campaigns.
 * Track performance, optimize bids, and pause underperformers.
 */

import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import type {
  AdCampaign,
  AdPlatform,
  AdPerformance,
  BidOptimization,
  AdRateOptimization,
  PauseRecommendation,
  CampaignStatus,
} from './types.js';

const logger = createLogger('advertising');

// =============================================================================
// Campaign Management
// =============================================================================

function generateCampaignId(platform: AdPlatform): string {
  const prefix = platform === 'ebay' ? 'EB' : 'AZ';
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${ts}-${rand}`;
}

/**
 * Create an eBay Promoted Listings campaign.
 * eBay promoted listings use an ad rate (%) - seller pays that % of sale price when item sells via ad.
 */
export function createEbayPromoted(db: Database, input: {
  name: string;
  adRate: number;
  listingIds: string[];
  startDate?: string;
  endDate?: string;
}): AdCampaign {
  if (input.adRate < 1 || input.adRate > 100) {
    throw new Error('ad_rate must be between 1 and 100 (percentage)');
  }
  if (!input.listingIds.length) {
    throw new Error('At least one listing_id is required');
  }

  const campaign: AdCampaign = {
    id: generateCampaignId('ebay'),
    platform: 'ebay',
    campaignType: 'promoted_listing',
    name: input.name,
    status: 'active',
    adRate: input.adRate,
    listingIds: input.listingIds,
    startDate: input.startDate ?? new Date().toISOString().split('T')[0],
    endDate: input.endDate,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Persist to database
  try {
    db.run(
      `INSERT INTO ad_campaigns (id, platform, campaign_type, name, status, ad_rate, listing_ids, start_date, end_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [campaign.id, campaign.platform, campaign.campaignType, campaign.name, campaign.status,
       campaign.adRate ?? null, JSON.stringify(campaign.listingIds), campaign.startDate,
       campaign.endDate ?? null, campaign.createdAt, campaign.updatedAt]
    );
  } catch {
    logger.warn('ad_campaigns table not found; campaign created in memory only');
  }

  // When eBay Marketing API credentials are configured, this will call:
  // POST https://api.ebay.com/sell/marketing/v1/ad_campaign to create the campaign
  // POST https://api.ebay.com/sell/marketing/v1/ad_campaign/{id}/ad to add listings
  logger.info({ campaignId: campaign.id, adRate: input.adRate }, 'Created eBay promoted listing campaign');

  return campaign;
}

/**
 * Create an Amazon Sponsored Products campaign.
 * Amazon uses CPC (cost per click) bidding with daily budgets.
 */
export function createAmazonSponsored(db: Database, input: {
  name: string;
  dailyBudget: number;
  defaultBid: number;
  targetAcos?: number;
  listingIds: string[];
  startDate?: string;
  endDate?: string;
}): AdCampaign {
  if (input.dailyBudget < 1) {
    throw new Error('daily_budget must be at least 1 (USD)');
  }
  if (input.defaultBid < 0.02) {
    throw new Error('default_bid must be at least 0.02 (USD)');
  }
  if (!input.listingIds.length) {
    throw new Error('At least one listing_id (ASIN) is required');
  }

  const campaign: AdCampaign = {
    id: generateCampaignId('amazon'),
    platform: 'amazon',
    campaignType: 'sponsored_product',
    name: input.name,
    status: 'active',
    dailyBudget: input.dailyBudget,
    defaultBid: input.defaultBid,
    targetAcos: input.targetAcos ?? 30,
    listingIds: input.listingIds,
    startDate: input.startDate ?? new Date().toISOString().split('T')[0],
    endDate: input.endDate,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  try {
    db.run(
      `INSERT INTO ad_campaigns (id, platform, campaign_type, name, status, daily_budget, default_bid, target_acos, listing_ids, start_date, end_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [campaign.id, campaign.platform, campaign.campaignType, campaign.name, campaign.status,
       campaign.dailyBudget ?? null, campaign.defaultBid ?? null, campaign.targetAcos ?? null,
       JSON.stringify(campaign.listingIds), campaign.startDate, campaign.endDate ?? null,
       campaign.createdAt, campaign.updatedAt]
    );
  } catch {
    logger.warn('ad_campaigns table not found; campaign created in memory only');
  }

  // When Amazon Advertising API credentials are configured, this will call:
  // POST https://advertising-api.amazon.com/sp/campaigns to create campaign
  // POST https://advertising-api.amazon.com/sp/adGroups to create ad groups
  logger.info({ campaignId: campaign.id, dailyBudget: input.dailyBudget }, 'Created Amazon sponsored products campaign');

  return campaign;
}

// =============================================================================
// Performance Analytics
// =============================================================================

/**
 * Get ad campaign performance metrics.
 * Queries local DB for tracked metrics, or generates simulated metrics for demo.
 */
export function getAdPerformance(db: Database, input: {
  campaignId: string;
  period?: string;
}): AdPerformance {
  const period = input.period ?? 'last_7_days';

  // Try to query from local tracking table
  try {
    const rows = db.query<{
      impressions: number;
      clicks: number;
      spend: number;
      sales: number;
      orders: number;
      platform: string;
    }>(
      `SELECT
         SUM(impressions) AS impressions,
         SUM(clicks) AS clicks,
         SUM(spend) AS spend,
         SUM(sales) AS sales,
         SUM(orders) AS orders,
         c.platform
       FROM ad_performance p
       JOIN ad_campaigns c ON c.id = p.campaign_id
       WHERE p.campaign_id = ?
       GROUP BY c.platform`,
      [input.campaignId]
    );

    if (rows.length > 0) {
      const row = rows[0];
      const ctr = row.impressions > 0 ? round2(row.clicks / row.impressions * 100) : 0;
      const acos = row.sales > 0 ? round2(row.spend / row.sales * 100) : 0;
      const roas = row.spend > 0 ? round2(row.sales / row.spend) : 0;
      const conversionRate = row.clicks > 0 ? round2(row.orders / row.clicks * 100) : 0;
      const avgCpc = row.clicks > 0 ? round2(row.spend / row.clicks) : 0;

      return {
        campaignId: input.campaignId,
        platform: row.platform as AdPlatform,
        impressions: row.impressions,
        clicks: row.clicks,
        ctr,
        spend: row.spend,
        sales: row.sales,
        orders: row.orders,
        acos,
        roas,
        conversionRate,
        avgCpc,
        period,
      };
    }
  } catch {
    logger.debug('ad_performance table not available');
  }

  // Return empty performance if no data found
  return {
    campaignId: input.campaignId,
    platform: input.campaignId.startsWith('EB') ? 'ebay' : 'amazon',
    impressions: 0,
    clicks: 0,
    ctr: 0,
    spend: 0,
    sales: 0,
    orders: 0,
    acos: 0,
    roas: 0,
    conversionRate: 0,
    avgCpc: 0,
    period,
  };
}

// =============================================================================
// Bid / Rate Optimization
// =============================================================================

/**
 * Auto-optimize bids/ad rates based on performance targets.
 *
 * For Amazon: Adjusts CPC bids to hit target ACOS.
 * For eBay: Adjusts ad rate % to optimize impression share vs cost.
 */
export function optimizeAdSpend(db: Database, input: {
  campaignId: string;
  targetAcos?: number;
  targetRoas?: number;
}): BidOptimization | AdRateOptimization {
  const perf = getAdPerformance(db, { campaignId: input.campaignId });

  if (perf.platform === 'amazon') {
    return optimizeAmazonBid(db, input.campaignId, perf, input.targetAcos ?? 30);
  } else {
    return optimizeEbayRate(db, input.campaignId, perf, input.targetRoas ?? 3);
  }
}

function optimizeAmazonBid(
  db: Database,
  campaignId: string,
  perf: AdPerformance,
  targetAcos: number,
): BidOptimization {
  // Query current bid
  let currentBid = 0.75; // default
  try {
    const rows = db.query<{ default_bid: number }>(
      'SELECT default_bid FROM ad_campaigns WHERE id = ?',
      [campaignId]
    );
    if (rows.length > 0 && rows[0].default_bid) {
      currentBid = rows[0].default_bid;
    }
  } catch { /* table may not exist */ }

  let recommendedBid = currentBid;
  let reason: string;
  let confidence: 'high' | 'medium' | 'low' = 'medium';

  if (perf.clicks < 10) {
    // Not enough data
    reason = 'Insufficient click data (<10 clicks). Keeping current bid.';
    confidence = 'low';
  } else if (perf.acos > targetAcos * 1.2) {
    // ACOS too high - reduce bid
    const reduction = Math.min(0.5, (perf.acos - targetAcos) / targetAcos);
    recommendedBid = round2(Math.max(0.02, currentBid * (1 - reduction)));
    reason = `ACOS (${perf.acos}%) exceeds target (${targetAcos}%) by ${round2(perf.acos - targetAcos)}%. Reducing bid by ${round2(reduction * 100)}%.`;
    confidence = perf.clicks > 50 ? 'high' : 'medium';
  } else if (perf.acos < targetAcos * 0.7 && perf.conversionRate > 5) {
    // ACOS well below target with good conversion - room to increase
    const increase = Math.min(0.3, (targetAcos - perf.acos) / targetAcos * 0.5);
    recommendedBid = round2(currentBid * (1 + increase));
    reason = `ACOS (${perf.acos}%) is well below target (${targetAcos}%) with ${perf.conversionRate}% conversion. Increasing bid by ${round2(increase * 100)}% to capture more impressions.`;
    confidence = perf.clicks > 50 ? 'high' : 'medium';
  } else {
    reason = `ACOS (${perf.acos}%) is within acceptable range of target (${targetAcos}%). No change needed.`;
    confidence = 'high';
  }

  const expectedAcos = perf.acos > 0
    ? round2(perf.acos * (recommendedBid / currentBid))
    : targetAcos;
  const expectedRoas = expectedAcos > 0 ? round2(100 / expectedAcos) : 0;

  return {
    campaignId,
    currentBid,
    recommendedBid,
    reason,
    expectedAcos,
    expectedRoas,
    confidence,
  };
}

function optimizeEbayRate(
  db: Database,
  campaignId: string,
  perf: AdPerformance,
  targetRoas: number,
): AdRateOptimization {
  let currentRate = 5; // default 5%
  try {
    const rows = db.query<{ ad_rate: number }>(
      'SELECT ad_rate FROM ad_campaigns WHERE id = ?',
      [campaignId]
    );
    if (rows.length > 0 && rows[0].ad_rate) {
      currentRate = rows[0].ad_rate;
    }
  } catch { /* table may not exist */ }

  let recommendedRate = currentRate;
  let reason: string;
  let expectedImpressionLift = 0;
  let confidence: 'high' | 'medium' | 'low' = 'medium';

  if (perf.impressions < 100) {
    // Low impressions - consider increasing rate for more visibility
    recommendedRate = Math.min(20, currentRate + 2);
    reason = `Low impressions (${perf.impressions}). Increasing ad rate to boost visibility.`;
    expectedImpressionLift = 30;
    confidence = 'low';
  } else if (perf.roas < targetRoas * 0.5) {
    // Very poor ROAS - reduce rate significantly
    recommendedRate = Math.max(1, round2(currentRate * 0.6));
    reason = `ROAS (${perf.roas}x) is far below target (${targetRoas}x). Reducing ad rate to cut costs.`;
    expectedImpressionLift = -20;
    confidence = 'medium';
  } else if (perf.roas >= targetRoas && perf.ctr > 1) {
    // Good performance - could increase rate for more impressions
    recommendedRate = Math.min(20, round2(currentRate * 1.15));
    reason = `Strong ROAS (${perf.roas}x) and CTR (${perf.ctr}%). Slight rate increase to capture more sales.`;
    expectedImpressionLift = 15;
    confidence = 'high';
  } else {
    reason = `Current performance is acceptable. ROAS: ${perf.roas}x, target: ${targetRoas}x.`;
    confidence = 'medium';
  }

  return {
    campaignId,
    currentRate,
    recommendedRate,
    reason,
    expectedImpressionLift,
    confidence,
  };
}

// =============================================================================
// Pause Underperformers
// =============================================================================

export function pauseUnderperformingAds(db: Database, input: {
  minRoas?: number;
  minClicks?: number;
  dryRun?: boolean;
}): PauseRecommendation[] {
  const minRoas = input.minRoas ?? 2;
  const minClicks = input.minClicks ?? 20; // Need enough data to judge
  const recommendations: PauseRecommendation[] = [];

  // Query all active campaigns
  let campaigns: Array<{ id: string; name: string; platform: string }> = [];
  try {
    campaigns = db.query<{ id: string; name: string; platform: string }>(
      "SELECT id, name, platform FROM ad_campaigns WHERE status = 'active'"
    );
  } catch {
    logger.warn('ad_campaigns table not found');
    return [];
  }

  for (const campaign of campaigns) {
    const perf = getAdPerformance(db, { campaignId: campaign.id });

    let recommendation: 'pause' | 'reduce_bid' | 'keep';
    let reason: string;

    if (perf.clicks < minClicks) {
      recommendation = 'keep';
      reason = `Only ${perf.clicks} clicks - not enough data to evaluate (min: ${minClicks}).`;
    } else if (perf.roas < minRoas * 0.3) {
      recommendation = 'pause';
      reason = `ROAS (${perf.roas}x) is critically low vs target (${minRoas}x). Recommend pausing immediately.`;
    } else if (perf.roas < minRoas) {
      recommendation = 'reduce_bid';
      reason = `ROAS (${perf.roas}x) is below target (${minRoas}x). Recommend reducing bid/rate before pausing.`;
    } else {
      recommendation = 'keep';
      reason = `ROAS (${perf.roas}x) meets or exceeds target (${minRoas}x).`;
    }

    // Execute pause if not dry run
    if (recommendation === 'pause' && !input.dryRun) {
      try {
        db.run(
          "UPDATE ad_campaigns SET status = 'paused', updated_at = ? WHERE id = ?",
          [new Date().toISOString(), campaign.id]
        );
        logger.info({ campaignId: campaign.id }, 'Paused underperforming campaign');
      } catch {
        logger.warn({ campaignId: campaign.id }, 'Could not update campaign status');
      }
    }

    recommendations.push({
      campaignId: campaign.id,
      campaignName: campaign.name,
      platform: campaign.platform as AdPlatform,
      currentRoas: perf.roas,
      targetRoas: minRoas,
      spend: perf.spend,
      sales: perf.sales,
      recommendation,
      reason,
    });
  }

  return recommendations;
}

// =============================================================================
// Tool Definitions
// =============================================================================

export const advertisingTools = [
  {
    name: 'create_ebay_promoted',
    description: 'Create an eBay Promoted Listings campaign. Seller pays an ad rate (%) of the sale price only when an item sells via the promoted listing.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Campaign name' },
        ad_rate: { type: 'number' as const, description: 'Ad rate percentage (1-100). eBay suggests 2-20% for most categories.' },
        listing_ids: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Array of eBay listing IDs to promote',
        },
        start_date: { type: 'string' as const, description: 'Start date (YYYY-MM-DD). Default: today.' },
        end_date: { type: 'string' as const, description: 'End date (YYYY-MM-DD). Optional.' },
      },
      required: ['name', 'ad_rate', 'listing_ids'] as const,
    },
  },
  {
    name: 'create_amazon_sponsored',
    description: 'Create an Amazon Sponsored Products campaign with CPC bidding and daily budget.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Campaign name' },
        daily_budget: { type: 'number' as const, description: 'Daily budget in USD (min: 1)' },
        default_bid: { type: 'number' as const, description: 'Default CPC bid in USD (min: 0.02)' },
        target_acos: { type: 'number' as const, description: 'Target ACOS percentage (default: 30)' },
        listing_ids: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Array of ASINs to advertise',
        },
        start_date: { type: 'string' as const, description: 'Start date (YYYY-MM-DD). Default: today.' },
        end_date: { type: 'string' as const, description: 'End date (YYYY-MM-DD). Optional.' },
      },
      required: ['name', 'daily_budget', 'default_bid', 'listing_ids'] as const,
    },
  },
  {
    name: 'get_ad_performance',
    description: 'Get ad campaign performance metrics including impressions, clicks, CTR, spend, sales, ACOS, and ROAS.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string' as const, description: 'Campaign ID' },
        period: {
          type: 'string' as const,
          enum: ['today', 'last_7_days', 'last_30_days', 'last_90_days', 'lifetime'],
          description: 'Reporting period (default: last_7_days)',
        },
      },
      required: ['campaign_id'] as const,
    },
  },
  {
    name: 'optimize_ad_spend',
    description: 'Auto-optimize campaign bids (Amazon) or ad rates (eBay) based on ACOS/ROAS targets. Analyzes performance data and recommends bid adjustments.',
    input_schema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'string' as const, description: 'Campaign ID to optimize' },
        target_acos: { type: 'number' as const, description: 'Target ACOS % for Amazon campaigns (default: 30)' },
        target_roas: { type: 'number' as const, description: 'Target ROAS for eBay campaigns (default: 3)' },
      },
      required: ['campaign_id'] as const,
    },
  },
  {
    name: 'pause_underperforming_ads',
    description: 'Evaluate all active campaigns and pause those below ROAS threshold. Returns recommendations for each campaign.',
    input_schema: {
      type: 'object' as const,
      properties: {
        min_roas: { type: 'number' as const, description: 'Minimum acceptable ROAS (default: 2). Campaigns below this may be paused.' },
        min_clicks: { type: 'number' as const, description: 'Minimum clicks before evaluating (default: 20). Campaigns with fewer clicks are kept.' },
        dry_run: { type: 'boolean' as const, description: 'If true, only return recommendations without actually pausing (default: false)' },
      },
    },
  },
] as const;

// =============================================================================
// Handler
// =============================================================================

export function handleAdvertisingTool(
  db: Database,
  toolName: string,
  input: Record<string, unknown>,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'create_ebay_promoted': {
        const name = input.name as string;
        const adRate = input.ad_rate as number;
        const listingIds = input.listing_ids as string[];
        if (!name) return { success: false, error: 'name is required' };
        if (typeof adRate !== 'number' || !Number.isFinite(adRate)) {
          return { success: false, error: 'ad_rate must be a finite number' };
        }
        if (!Array.isArray(listingIds) || listingIds.length === 0) {
          return { success: false, error: 'listing_ids must be a non-empty array' };
        }
        const result = createEbayPromoted(db, {
          name,
          adRate,
          listingIds,
          startDate: input.start_date as string | undefined,
          endDate: input.end_date as string | undefined,
        });
        return { success: true, data: result };
      }

      case 'create_amazon_sponsored': {
        const name = input.name as string;
        const dailyBudget = input.daily_budget as number;
        const defaultBid = input.default_bid as number;
        const listingIds = input.listing_ids as string[];
        if (!name) return { success: false, error: 'name is required' };
        if (typeof dailyBudget !== 'number' || !Number.isFinite(dailyBudget)) {
          return { success: false, error: 'daily_budget must be a finite number' };
        }
        if (typeof defaultBid !== 'number' || !Number.isFinite(defaultBid)) {
          return { success: false, error: 'default_bid must be a finite number' };
        }
        if (!Array.isArray(listingIds) || listingIds.length === 0) {
          return { success: false, error: 'listing_ids must be a non-empty array' };
        }
        const result = createAmazonSponsored(db, {
          name,
          dailyBudget,
          defaultBid,
          targetAcos: input.target_acos as number | undefined,
          listingIds,
          startDate: input.start_date as string | undefined,
          endDate: input.end_date as string | undefined,
        });
        return { success: true, data: result };
      }

      case 'get_ad_performance': {
        const campaignId = input.campaign_id as string;
        if (!campaignId) return { success: false, error: 'campaign_id is required' };
        const result = getAdPerformance(db, {
          campaignId,
          period: input.period as string | undefined,
        });
        return { success: true, data: result };
      }

      case 'optimize_ad_spend': {
        const campaignId = input.campaign_id as string;
        if (!campaignId) return { success: false, error: 'campaign_id is required' };
        const result = optimizeAdSpend(db, {
          campaignId,
          targetAcos: input.target_acos as number | undefined,
          targetRoas: input.target_roas as number | undefined,
        });
        return { success: true, data: result };
      }

      case 'pause_underperforming_ads': {
        const result = pauseUnderperformingAds(db, {
          minRoas: input.min_roas as number | undefined,
          minClicks: input.min_clicks as number | undefined,
          dryRun: input.dry_run as boolean | undefined,
        });
        return { success: true, data: result };
      }

      default:
        return { success: false, error: `Unknown advertising tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// =============================================================================
// Helpers
// =============================================================================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Re-export types
export type {
  AdCampaign,
  AdPlatform,
  AdPerformance,
  BidOptimization,
  AdRateOptimization,
  PauseRecommendation,
  CampaignStatus,
  CampaignType,
} from './types.js';
