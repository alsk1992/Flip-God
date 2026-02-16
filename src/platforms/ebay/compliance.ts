/**
 * eBay Compliance API — Listing violations monitoring
 *
 * Monitors listing compliance issues and allows suppression of known violations.
 */

import { createLogger } from '../../utils/logger';
import type { EbayCredentials } from '../../types';
import { getAccessToken, API_BASE } from './auth';

const logger = createLogger('ebay-compliance');

export type ComplianceType =
  | 'PRODUCT_ADOPTION'
  | 'OUTSIDE_EBAY_BUYING_AND_SELLING'
  | 'HTTPS'
  | 'PRODUCT_IDENTITY';

export interface ListingViolation {
  complianceType: ComplianceType;
  listingId: string;
  reasonCode: string;
  message: string;
  variation?: { sku: string; variationAspects?: Array<{ name: string; value: string }> };
  violationData?: Array<{ violationType: string; message: string }>;
}

export interface ListingViolationsResponse {
  offset: number;
  limit: number;
  total: number;
  listingViolations?: ListingViolation[];
}

export interface ViolationSummary {
  complianceType: ComplianceType;
  marketplaceId: string;
  listingCount: number;
}

export interface ViolationsSummaryResponse {
  violationSummaries?: ViolationSummary[];
}

export interface EbayComplianceApi {
  getListingViolations(params: { complianceType: ComplianceType; offset?: number; limit?: number }): Promise<ListingViolationsResponse>;
  getListingViolationsSummary(): Promise<ViolationsSummaryResponse>;
  suppressViolation(listingId: string, complianceType: ComplianceType): Promise<void>;
}

export function createEbayComplianceApi(credentials: EbayCredentials): EbayComplianceApi {
  const env = credentials.environment ?? 'production';
  const baseUrl = API_BASE[env];

  async function getToken(): Promise<string> {
    return getAccessToken({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      environment: env,
    });
  }

  return {
    async getListingViolations(params): Promise<ListingViolationsResponse> {
      const token = await getToken();
      const queryParams = new URLSearchParams();
      queryParams.set('compliance_type', params.complianceType);
      if (params?.offset !== undefined) {
        queryParams.set('offset', String(params.offset));
      }
      if (params?.limit !== undefined) {
        queryParams.set('limit', String(params.limit));
      }
      const url = `${baseUrl}/sell/compliance/v1/listing_violation?${queryParams.toString()}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 200);
        logger.error({ status: response.status }, 'Failed to get listing violations');
        throw new Error(`eBay get listing violations failed (${response.status}): ${errorText}`);
      }
      return await response.json() as ListingViolationsResponse;
    },

    async getListingViolationsSummary(): Promise<ViolationsSummaryResponse> {
      const token = await getToken();
      const response = await fetch(
        `${baseUrl}/sell/compliance/v1/listing_violation_summary`,
        { headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
      );
      if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 200);
        logger.error({ status: response.status }, 'Failed to get violations summary');
        throw new Error(`eBay get violations summary failed (${response.status}): ${errorText}`);
      }
      return await response.json() as ViolationsSummaryResponse;
    },

    async suppressViolation(listingId: string, complianceType: ComplianceType): Promise<void> {
      const token = await getToken();
      const response = await fetch(
        `${baseUrl}/sell/compliance/v1/listing_violation`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ listingId, complianceType }),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok && response.status !== 204) {
        const errorText = (await response.text().catch(() => '')).slice(0, 200);
        logger.error({ status: response.status, listingId, complianceType }, 'Failed to suppress violation');
        throw new Error(`eBay suppress violation failed (${response.status}): ${errorText}`);
      }
      logger.info({ listingId, complianceType }, 'Listing violation suppressed');
    },
  };
}
