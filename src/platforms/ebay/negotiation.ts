/**
 * eBay Negotiation API — Send offers to interested buyers
 *
 * Find items eligible for seller-initiated offers and send price offers
 * to buyers who have shown interest (watchers, best-offer candidates).
 */

import { createLogger } from '../../utils/logger';
import type { EbayCredentials } from '../../types';
import { getAccessToken, API_BASE } from './auth';

const logger = createLogger('ebay-negotiation');

export interface EligibleItem {
  listingId: string;
  title?: string;
  currentPrice?: { value: string; currency: string };
  eligibleItemQuantity?: number;
  interestedBuyerCount?: number;
}

export interface EligibleItemsResponse {
  href?: string;
  limit: number;
  offset: number;
  total: number;
  eligibleItems?: EligibleItem[];
}

export interface OfferedItem {
  listingId: string;
  price: { value: string; currency: string };
  quantity: number;
}

export interface SendOfferParams {
  offeredItems: OfferedItem[];
  message?: string;
  allowCounterOffer?: boolean;
  validityPeriod?: { value: number; unit: 'HOUR' | 'DAY' };
}

export interface SendOfferResponse {
  sendOfferToInterestedBuyersCollectionResponse?: Array<{
    listingId: string;
    statusCode: number;
    offerId?: string;
    errors?: Array<{ errorId: number; message: string }>;
  }>;
}

export interface EbayNegotiationApi {
  findEligibleItems(params?: { limit?: number; offset?: number }): Promise<EligibleItemsResponse>;
  sendOfferToInterestedBuyers(params: SendOfferParams): Promise<SendOfferResponse>;
}

export function createEbayNegotiationApi(credentials: EbayCredentials): EbayNegotiationApi {
  const env = credentials.environment ?? 'production';
  const baseUrl = API_BASE[env];
  const ebayMarketplace = credentials.marketplace ?? 'EBAY_US';

  async function getToken(): Promise<string> {
    return getAccessToken({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      environment: env,
    });
  }

  return {
    async findEligibleItems(params?): Promise<EligibleItemsResponse> {
      const token = await getToken();
      const queryParams = new URLSearchParams();
      if (params?.limit !== undefined) {
        queryParams.set('limit', String(params.limit));
      }
      if (params?.offset !== undefined) {
        queryParams.set('offset', String(params.offset));
      }
      const url = `${baseUrl}/sell/negotiation/v1/find_eligible_items?${queryParams.toString()}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': ebayMarketplace,
        },
      });
      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'Failed to find eligible items');
        throw new Error(`eBay find eligible items failed (${response.status}): ${errorText}`);
      }
      return await response.json() as EligibleItemsResponse;
    },

    async sendOfferToInterestedBuyers(params: SendOfferParams): Promise<SendOfferResponse> {
      const token = await getToken();
      const response = await fetch(
        `${baseUrl}/sell/negotiation/v1/send_offer_to_interested_buyers`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'X-EBAY-C-MARKETPLACE-ID': ebayMarketplace,
          },
          body: JSON.stringify(params),
        },
      );
      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'Failed to send offer to interested buyers');
        throw new Error(`eBay send offer to interested buyers failed (${response.status}): ${errorText}`);
      }
      const data = await response.json() as SendOfferResponse;
      logger.info({ itemCount: params.offeredItems.length }, 'Offer sent to interested buyers');
      return data;
    },
  };
}
