/**
 * eBay Sell Metadata API - Category policies and constraints
 *
 * Retrieves marketplace-specific policies for item conditions, listing
 * structures, negotiated pricing, and return policies by category.
 *
 * API docs: https://developer.ebay.com/api-docs/sell/metadata/resources/marketplace/methods
 */

import { createLogger } from '../../utils/logger';
import type { EbayCredentials } from '../../types';
import { getAccessToken, API_BASE } from './auth';

const logger = createLogger('ebay-metadata');

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface EbayItemConditionPolicy {
  categoryId: string;
  categoryTreeNodeLevel?: number;
  itemConditions?: Array<{
    conditionId: string;
    conditionDescription?: string;
    conditionDescriptorConstraint?: string;
  }>;
  itemConditionRequired?: boolean;
}

export interface EbayItemConditionPoliciesResponse {
  itemConditionPolicies?: EbayItemConditionPolicy[];
}

export interface EbayListingStructurePolicy {
  categoryId: string;
  categoryTreeNodeLevel?: number;
  itemToListingRelationships?: Array<{
    listingType: string;
    variationSupported?: boolean;
  }>;
}

export interface EbayListingStructurePoliciesResponse {
  listingStructurePolicies?: EbayListingStructurePolicy[];
}

export interface EbayNegotiatedPricePolicy {
  categoryId: string;
  categoryTreeNodeLevel?: number;
  bestOfferAutoAcceptEnabled?: boolean;
  bestOfferAutoDeclineEnabled?: boolean;
  bestOfferCounterOfferEnabled?: boolean;
}

export interface EbayNegotiatedPricePoliciesResponse {
  negotiatedPricePolicies?: EbayNegotiatedPricePolicy[];
}

export interface EbayReturnPolicy {
  categoryId: string;
  categoryTreeNodeLevel?: number;
  domestic?: {
    returnsAccepted?: boolean;
    refundMethods?: string[];
    returnMethods?: string[];
    returnPeriods?: Array<{ value: number; unit: string }>;
    returnShippingCostPayers?: string[];
  };
  international?: {
    returnsAccepted?: boolean;
    refundMethods?: string[];
    returnMethods?: string[];
    returnPeriods?: Array<{ value: number; unit: string }>;
    returnShippingCostPayers?: string[];
  };
}

export interface EbayReturnPoliciesResponse {
  returnPolicies?: EbayReturnPolicy[];
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface EbayMetadataApi {
  getItemConditionPolicies(
    categoryId?: string,
  ): Promise<EbayItemConditionPoliciesResponse>;

  getListingStructurePolicies(
    categoryId?: string,
  ): Promise<EbayListingStructurePoliciesResponse>;

  getNegotiatedPricePolicies(
    categoryId?: string,
  ): Promise<EbayNegotiatedPricePoliciesResponse>;

  getReturnPolicies(
    categoryId?: string,
  ): Promise<EbayReturnPoliciesResponse>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEbayMetadataApi(
  credentials: EbayCredentials,
): EbayMetadataApi {
  const env = credentials.environment ?? 'production';
  const baseUrl = API_BASE[env];
  const marketplaceId = credentials.marketplace ?? 'EBAY_US';

  async function getToken(): Promise<string> {
    return getAccessToken({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      environment: env,
    });
  }

  /**
   * Build the metadata endpoint URL, optionally filtering by categoryId.
   */
  function buildUrl(method: string, categoryId?: string): string {
    let url = `${baseUrl}/sell/metadata/v1/marketplace/${marketplaceId}/${method}`;
    if (categoryId) {
      url += `?filter=categoryIds:{${encodeURIComponent(categoryId)}}`;
    }
    return url;
  }

  return {
    // -----------------------------------------------------------------------
    // 1. Item condition policies
    // -----------------------------------------------------------------------
    async getItemConditionPolicies(
      categoryId?: string,
    ): Promise<EbayItemConditionPoliciesResponse> {
      try {
        const token = await getToken();

        const response = await fetch(
          buildUrl('get_item_condition_policies', categoryId),
          {
            headers: { 'Authorization': `Bearer ${token}` },
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(
            { status: response.status, categoryId, error: errorText },
            'Failed to get item condition policies',
          );
          throw new Error(
            `eBay get item condition policies failed (${response.status}): ${errorText}`,
          );
        }

        const data =
          (await response.json()) as EbayItemConditionPoliciesResponse;
        logger.info({ categoryId: categoryId ?? 'all' }, 'Item condition policies retrieved');
        return data;
      } catch (err) {
        logger.error({ categoryId, err }, 'getItemConditionPolicies error');
        throw err;
      }
    },

    // -----------------------------------------------------------------------
    // 2. Listing structure policies
    // -----------------------------------------------------------------------
    async getListingStructurePolicies(
      categoryId?: string,
    ): Promise<EbayListingStructurePoliciesResponse> {
      try {
        const token = await getToken();

        const response = await fetch(
          buildUrl('get_listing_structure_policies', categoryId),
          {
            headers: { 'Authorization': `Bearer ${token}` },
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(
            { status: response.status, categoryId, error: errorText },
            'Failed to get listing structure policies',
          );
          throw new Error(
            `eBay get listing structure policies failed (${response.status}): ${errorText}`,
          );
        }

        const data =
          (await response.json()) as EbayListingStructurePoliciesResponse;
        logger.info(
          { categoryId: categoryId ?? 'all' },
          'Listing structure policies retrieved',
        );
        return data;
      } catch (err) {
        logger.error({ categoryId, err }, 'getListingStructurePolicies error');
        throw err;
      }
    },

    // -----------------------------------------------------------------------
    // 3. Negotiated price policies (Best Offer)
    // -----------------------------------------------------------------------
    async getNegotiatedPricePolicies(
      categoryId?: string,
    ): Promise<EbayNegotiatedPricePoliciesResponse> {
      try {
        const token = await getToken();

        const response = await fetch(
          buildUrl('get_negotiated_price_policies', categoryId),
          {
            headers: { 'Authorization': `Bearer ${token}` },
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(
            { status: response.status, categoryId, error: errorText },
            'Failed to get negotiated price policies',
          );
          throw new Error(
            `eBay get negotiated price policies failed (${response.status}): ${errorText}`,
          );
        }

        const data =
          (await response.json()) as EbayNegotiatedPricePoliciesResponse;
        logger.info(
          { categoryId: categoryId ?? 'all' },
          'Negotiated price policies retrieved',
        );
        return data;
      } catch (err) {
        logger.error(
          { categoryId, err },
          'getNegotiatedPricePolicies error',
        );
        throw err;
      }
    },

    // -----------------------------------------------------------------------
    // 4. Return policies
    // -----------------------------------------------------------------------
    async getReturnPolicies(
      categoryId?: string,
    ): Promise<EbayReturnPoliciesResponse> {
      try {
        const token = await getToken();

        const response = await fetch(
          buildUrl('get_return_policies', categoryId),
          {
            headers: { 'Authorization': `Bearer ${token}` },
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(
            { status: response.status, categoryId, error: errorText },
            'Failed to get return policies',
          );
          throw new Error(
            `eBay get return policies failed (${response.status}): ${errorText}`,
          );
        }

        const data = (await response.json()) as EbayReturnPoliciesResponse;
        logger.info({ categoryId: categoryId ?? 'all' }, 'Return policies retrieved');
        return data;
      } catch (err) {
        logger.error({ categoryId, err }, 'getReturnPolicies error');
        throw err;
      }
    },
  };
}
