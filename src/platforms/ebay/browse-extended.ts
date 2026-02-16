/**
 * eBay Browse API — Extended methods (batch, legacy, item group, image search)
 *
 * Endpoints:
 * - GET /buy/browse/v1/item?item_ids={ids} — batch fetch up to 20 items
 * - GET /buy/browse/v1/item/get_item_by_legacy_id — resolve legacy item ID
 * - GET /buy/browse/v1/item/get_items_by_item_group — get all variations in group
 * - POST /buy/browse/v1/item_summary/search_by_image — visual similarity search
 */

import { createLogger } from '../../utils/logger';
import type { EbayCredentials } from '../../types';
import type { EbayItemDetail, EbayItemSummary } from './types';
import { getAccessToken, API_BASE } from './auth';

const logger = createLogger('ebay-browse-extended');

export interface EbayItemGroupResponse {
  items: EbayItemDetail[];
  commonDescription?: string;
}

export interface EbayImageSearchParams {
  query?: string;
  limit?: number;
  filter?: string;
}

export interface EbayBrowseExtendedApi {
  getItems(itemIds: string[]): Promise<EbayItemDetail[]>;
  getItemByLegacyId(legacyId: string): Promise<EbayItemDetail | null>;
  getItemsByItemGroup(itemGroupId: string): Promise<EbayItemGroupResponse | null>;
  searchByImage(imageUrl: string, params?: EbayImageSearchParams): Promise<EbayItemSummary[]>;
}

export function createEbayBrowseExtendedApi(credentials: EbayCredentials): EbayBrowseExtendedApi {
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

  return {
    async getItems(itemIds) {
      if (itemIds.length === 0) return [];
      if (itemIds.length > 20) {
        logger.warn({ count: itemIds.length }, 'getItems limited to 20 items, truncating');
        itemIds = itemIds.slice(0, 20);
      }

      try {
        const token = await getToken();
        const ids = itemIds.map(id => encodeURIComponent(id)).join(',');
        const response = await fetch(
          `${baseUrl}/buy/browse/v1/item?item_ids=${ids}`,
          { headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': marketplaceId } },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'Failed to batch get items');
          return [];
        }

        const data = await response.json() as { items?: EbayItemDetail[]; warnings?: unknown[] };
        return data.items ?? [];
      } catch (err) {
        logger.error({ err }, 'Error in getItems');
        return [];
      }
    },

    async getItemByLegacyId(legacyId) {
      try {
        const token = await getToken();
        const response = await fetch(
          `${baseUrl}/buy/browse/v1/item/get_item_by_legacy_id?legacy_item_id=${encodeURIComponent(legacyId)}`,
          { headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': marketplaceId } },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, legacyId, error: errorText }, 'Failed to get item by legacy ID');
          return null;
        }

        return await response.json() as EbayItemDetail;
      } catch (err) {
        logger.error({ err, legacyId }, 'Error in getItemByLegacyId');
        return null;
      }
    },

    async getItemsByItemGroup(itemGroupId) {
      try {
        const token = await getToken();
        const response = await fetch(
          `${baseUrl}/buy/browse/v1/item/get_items_by_item_group?item_group_id=${encodeURIComponent(itemGroupId)}`,
          { headers: { 'Authorization': `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': marketplaceId } },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, itemGroupId, error: errorText }, 'Failed to get items by item group');
          return null;
        }

        return await response.json() as EbayItemGroupResponse;
      } catch (err) {
        logger.error({ err, itemGroupId }, 'Error in getItemsByItemGroup');
        return null;
      }
    },

    async searchByImage(imageUrl, params?) {
      try {
        const token = await getToken();
        const url = new URL(`${baseUrl}/buy/browse/v1/item_summary/search_by_image`);
        if (params?.query) url.searchParams.set('q', params.query);
        if (params?.limit) url.searchParams.set('limit', String(params.limit));
        if (params?.filter) url.searchParams.set('filter', params.filter);

        const response = await fetch(
          url.toString(),
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
            },
            body: JSON.stringify({ image: { imageUrl } }),
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'Failed to search by image');
          return [];
        }

        const data = await response.json() as { itemSummaries?: EbayItemSummary[] };
        return data.itemSummaries ?? [];
      } catch (err) {
        logger.error({ err }, 'Error in searchByImage');
        return [];
      }
    },
  };
}
