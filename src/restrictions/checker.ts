/**
 * Restriction Checker — Evaluates products for IP risk, gating, and hazmat
 */

import { createLogger } from '../utils/logger';
import { lookupBrand, lookupCategory, checkHazmat } from './database';
import type { RestrictionCheckResult } from './types';

const logger = createLogger('restriction-checker');

export interface CheckInput {
  productId?: string;
  asin?: string;
  title: string;
  brand?: string;
  category?: string;
  description?: string;
}

/**
 * Run a full restriction check on a product.
 */
export function checkRestrictions(input: CheckInput): RestrictionCheckResult {
  const restrictions: string[] = [];
  const reasons: string[] = [];

  // 1. Brand gating check
  let isGated = false;
  let gatingType: RestrictionCheckResult['gatingType'] | undefined;
  let ungatingDifficulty: RestrictionCheckResult['ungatingDifficulty'] | undefined;
  let ipRisk: RestrictionCheckResult['ipRisk'] = 'none';
  let ipComplaints = 0;
  let ipDetails: string | undefined;

  if (input.brand) {
    const brandRecord = lookupBrand(input.brand);
    if (brandRecord) {
      isGated = brandRecord.isGated;
      ipComplaints = brandRecord.ipComplaintCount;
      ungatingDifficulty = brandRecord.gatingDifficulty;

      if (isGated) {
        gatingType = 'brand_gated';
        restrictions.push(`Brand "${input.brand}" is gated on Amazon`);
        reasons.push(`Gated brand (difficulty: ${ungatingDifficulty})`);
      }

      // IP risk level based on complaint count
      if (ipComplaints >= 500) { ipRisk = 'critical'; ipDetails = `${ipComplaints}+ IP complaints reported`; }
      else if (ipComplaints >= 200) { ipRisk = 'high'; ipDetails = `${ipComplaints}+ IP complaints reported`; }
      else if (ipComplaints >= 100) { ipRisk = 'medium'; ipDetails = `${ipComplaints}+ IP complaints reported`; }
      else if (ipComplaints > 0) { ipRisk = 'low'; ipDetails = `${ipComplaints} IP complaints reported`; }

      if (ipRisk !== 'none') {
        reasons.push(`IP risk: ${ipRisk} (${ipComplaints} complaints)`);
      }
    }
  }

  // 2. Category restriction check
  if (input.category) {
    const catRestriction = lookupCategory(input.category);
    if (catRestriction) {
      if (catRestriction.isRestricted) {
        if (!gatingType) gatingType = 'category_gated';
        restrictions.push(`Category "${input.category}" is restricted`);
        reasons.push(`Restricted category${catRestriction.requiresInvoice ? ' (requires invoice)' : ''}`);
      }
      if (catRestriction.requiresApproval) {
        if (!gatingType) gatingType = 'approval_required';
        restrictions.push(`Category requires approval to sell in`);
      }
    }
  }

  // 3. Hazmat check
  const hazmat = checkHazmat(input.title, input.description);
  const isHazmat = hazmat !== null;
  if (isHazmat) {
    restrictions.push(`Product may be classified as hazmat: ${hazmat!.hazmatClass}`);
    reasons.push(`Hazmat detected (${hazmat!.keyword})`);
  }

  // 4. Overall recommendation
  let recommendation: RestrictionCheckResult['recommendation'];
  if (ipRisk === 'critical' || ungatingDifficulty === 'impossible') {
    recommendation = 'blocked';
  } else if (ipRisk === 'high' || ungatingDifficulty === 'hard') {
    recommendation = 'avoid';
  } else if (ipRisk === 'medium' || isGated || isHazmat) {
    recommendation = 'caution';
  } else {
    recommendation = 'safe';
  }

  const result: RestrictionCheckResult = {
    productId: input.productId ?? '',
    asin: input.asin,
    brand: input.brand,
    category: input.category,
    ipRisk,
    ipComplaints,
    ipDetails,
    isGated,
    gatingType,
    ungatingDifficulty,
    isHazmat,
    hazmatClass: hazmat?.hazmatClass,
    hazmatFee: hazmat?.additionalFee,
    restrictions,
    recommendation,
    reasons,
  };

  logger.debug({ productId: input.productId, recommendation, restrictions: restrictions.length }, 'Restriction check complete');
  return result;
}

/**
 * Quick check — just returns the recommendation without full details.
 */
export function quickCheck(brand?: string, category?: string, title?: string): 'safe' | 'caution' | 'avoid' | 'blocked' {
  const result = checkRestrictions({
    title: title ?? '',
    brand,
    category,
  });
  return result.recommendation;
}
