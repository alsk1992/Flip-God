/**
 * eBay Marketplace Insights API — Recently sold items
 *
 * Endpoints:
 * - GET /buy/marketplace_insights/v1_beta/item_sales/search — search recently sold items
 *
 * Crucial for pricing: returns actual sale prices, not just listing prices.
 */

import { createLogger } from '../../utils/logger';
import type { EbayCredentials } from '../../types';
import { getAccessToken, API_BASE } from './auth';

const logger = createLogger('ebay-insights');

export interface EbaySoldItem {
  itemId?: string;
  title?: string;
  lastSoldDate?: string;
  lastSoldPrice?: { value: string; currency: string };
  totalSoldQuantity?: number;
  image?: { imageUrl: string };
  condition?: string;
  conditionId?: string;
  categories?: Array<{ categoryId: string; categoryName: string }>;
  buyingOptions?: string[];
  seller?: { username: string; feedbackPercentage: string; feedbackScore: number };
  itemLocation?: { city?: string; stateOrProvince?: string; country?: string };
  itemGroupHref?: string;
  epid?: string;
}

export interface EbaySoldSearchParams {
  limit?: number;
  offset?: number;
  filter?: string;
  sort?: string;
  categoryIds?: string;
}

export interface EbayInsightsApi {
  searchSoldItems(query: string, params?: EbaySoldSearchParams): Promise<{ items: EbaySoldItem[]; total: number }>;
}

export function createEbayInsightsApi(credentials: EbayCredentials): EbayInsightsApi {
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
    async searchSoldItems(query, params?) {
      try {
        const token = await getToken();
        const qp = new URLSearchParams();
        qp.set('q', query);
        qp.set('limit', String(params?.limit ?? 20));
        qp.set('sort', params?.sort ?? 'newlyListed');

        // Default filters for fixed-price new items; override with params.filter
        if (params?.filter) {
          qp.set('filter', params.filter);
        } else {
          qp.set('filter', 'buyingOptions:{FIXED_PRICE},conditions:{NEW}');
        }

        if (params?.offset) qp.set('offset', String(params.offset));
        if (params?.categoryIds) qp.set('category_ids', params.categoryIds);

        const response = await fetch(
          `${baseUrl}/buy/marketplace_insights/v1_beta/item_sales/search?${qp.toString()}`,
          { headers: { 'Authorization': `Bearer ${token}` } },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, query, error: errorText }, 'Failed to search sold items');
          return { items: [], total: 0 };
        }

        const data = await response.json() as { itemSales?: EbaySoldItem[]; total?: number };
        return {
          items: data.itemSales ?? [],
          total: data.total ?? 0,
        };
      } catch (err) {
        logger.error({ err, query }, 'Error in searchSoldItems');
        return { items: [], total: 0 };
      }
    },
  };
}
