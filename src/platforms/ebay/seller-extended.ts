/**
 * eBay Sell API - Extended Inventory + Offer management
 *
 * Additional methods not covered in seller.ts:
 * - Single inventory item GET
 * - Bulk create/replace inventory items
 * - Get offers by SKU
 * - Bulk create offers
 * - Bulk publish offers
 * - Inventory locations (create + list)
 * - Inventory item groups (create + get)
 */

import { createLogger } from '../../utils/logger';
import type { EbayCredentials } from '../../types';
import { getAccessToken, API_BASE } from './auth';

const logger = createLogger('ebay-seller-extended');

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface EbayBulkInventoryItemResponse {
  responses: Array<{
    statusCode: number;
    sku: string;
    errors?: Array<{ errorId?: number; message?: string }>;
    warnings?: Array<{ errorId?: number; message?: string }>;
  }>;
}

export interface EbayOfferListResponse {
  href?: string;
  total: number;
  size: number;
  limit: number;
  offset: number;
  offers?: Array<{
    offerId: string;
    sku: string;
    marketplaceId: string;
    format: string;
    listingDescription?: string;
    pricingSummary?: { price?: { value: string; currency: string } };
    status?: string;
    categoryId?: string;
  }>;
}

export interface EbayBulkCreateOfferResponse {
  responses: Array<{
    statusCode: number;
    offerId?: string;
    sku?: string;
    errors?: Array<{ errorId?: number; message?: string }>;
    warnings?: Array<{ errorId?: number; message?: string }>;
  }>;
}

export interface EbayBulkPublishOfferResponse {
  responses: Array<{
    statusCode: number;
    offerId: string;
    listingId?: string;
    errors?: Array<{ errorId?: number; message?: string }>;
  }>;
}

export interface EbayInventoryLocation {
  merchantLocationKey?: string;
  name?: string;
  location?: {
    address?: {
      city?: string;
      stateOrProvince?: string;
      postalCode?: string;
      country?: string;
    };
  };
  merchantLocationStatus?: string;
  locationTypes?: string[];
}

export interface EbayInventoryLocationListResponse {
  href?: string;
  total: number;
  limit: number;
  offset: number;
  locations?: EbayInventoryLocation[];
}

export interface EbayInventoryItemGroup {
  title: string;
  aspects: Record<string, string[]>;
  description: string;
  imageUrls: string[];
  variantSKUs: string[];
}

export interface EbayInventoryItemDetail {
  sku: string;
  locale?: string;
  product?: {
    title?: string;
    description?: string;
    imageUrls?: string[];
    aspects?: Record<string, string[]>;
    brand?: string;
    mpn?: string;
    upc?: string[];
  };
  condition?: string;
  availability?: {
    shipToLocationAvailability?: {
      quantity?: number;
    };
  };
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface EbaySellerExtendedApi {
  getInventoryItem(sku: string): Promise<EbayInventoryItemDetail>;

  bulkCreateOrReplaceInventoryItem(
    items: Array<{
      sku: string;
      product: object;
      condition: string;
      availability: object;
    }>,
  ): Promise<EbayBulkInventoryItemResponse>;

  getOffers(sku: string): Promise<EbayOfferListResponse>;

  bulkCreateOffer(offers: object[]): Promise<EbayBulkCreateOfferResponse>;

  bulkPublishOffer(offerIds: string[]): Promise<EbayBulkPublishOfferResponse>;

  createInventoryLocation(
    merchantLocationKey: string,
    location: {
      name: string;
      location: {
        address: {
          city: string;
          stateOrProvince: string;
          postalCode: string;
          country: string;
        };
      };
      merchantLocationStatus: 'ENABLED';
      locationTypes: string[];
    },
  ): Promise<void>;

  getInventoryLocations(): Promise<EbayInventoryLocationListResponse>;

  createInventoryItemGroup(
    inventoryItemGroupKey: string,
    group: {
      title: string;
      aspects: object;
      description: string;
      imageUrls: string[];
      variantSKUs: string[];
    },
  ): Promise<void>;

  getInventoryItemGroup(
    inventoryItemGroupKey: string,
  ): Promise<EbayInventoryItemGroup>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEbaySellerExtendedApi(
  credentials: EbayCredentials,
): EbaySellerExtendedApi {
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
    // -----------------------------------------------------------------------
    // 1. GET single inventory item
    // -----------------------------------------------------------------------
    async getInventoryItem(sku: string): Promise<EbayInventoryItemDetail> {
      try {
        const token = await getToken();

        const response = await fetch(
          `${baseUrl}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
          {
            headers: { 'Authorization': `Bearer ${token}` },
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(
            { status: response.status, sku, error: errorText },
            'Failed to get inventory item',
          );
          throw new Error(
            `eBay get inventory item failed (${response.status}): ${errorText}`,
          );
        }

        const data = (await response.json()) as EbayInventoryItemDetail;
        logger.info({ sku }, 'Inventory item retrieved');
        return data;
      } catch (err) {
        logger.error({ sku, err }, 'getInventoryItem error');
        throw err;
      }
    },

    // -----------------------------------------------------------------------
    // 2. Bulk create or replace inventory items
    // -----------------------------------------------------------------------
    async bulkCreateOrReplaceInventoryItem(
      items: Array<{
        sku: string;
        product: object;
        condition: string;
        availability: object;
      }>,
    ): Promise<EbayBulkInventoryItemResponse> {
      try {
        const token = await getToken();

        const response = await fetch(
          `${baseUrl}/sell/inventory/v1/bulk_create_or_replace_inventory_item`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Content-Language': 'en-US',
            },
            body: JSON.stringify({
              requests: items.map((i) => ({
                ...i,
                locale: 'en_US',
              })),
            }),
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(
            { status: response.status, count: items.length, error: errorText },
            'Failed to bulk create/replace inventory items',
          );
          throw new Error(
            `eBay bulk create/replace inventory items failed (${response.status}): ${errorText}`,
          );
        }

        const data = (await response.json()) as EbayBulkInventoryItemResponse;
        logger.info(
          { count: items.length },
          'Bulk inventory item create/replace completed',
        );
        return data;
      } catch (err) {
        logger.error({ count: items.length, err }, 'bulkCreateOrReplaceInventoryItem error');
        throw err;
      }
    },

    // -----------------------------------------------------------------------
    // 3. Get offers (optionally filtered by SKU)
    // -----------------------------------------------------------------------
    async getOffers(sku: string): Promise<EbayOfferListResponse> {
      try {
        const token = await getToken();

        const params = new URLSearchParams();
        params.set('sku', sku);
        params.set('limit', '200');

        const response = await fetch(
          `${baseUrl}/sell/inventory/v1/offer?${params.toString()}`,
          {
            headers: { 'Authorization': `Bearer ${token}` },
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(
            { status: response.status, sku, error: errorText },
            'Failed to get offers',
          );
          throw new Error(
            `eBay get offers failed (${response.status}): ${errorText}`,
          );
        }

        const data = (await response.json()) as EbayOfferListResponse;
        logger.info(
          { sku: sku ?? 'all', total: data.total },
          'Offers retrieved',
        );
        return data;
      } catch (err) {
        logger.error({ sku, err }, 'getOffers error');
        throw err;
      }
    },

    // -----------------------------------------------------------------------
    // 4. Bulk create offers
    // -----------------------------------------------------------------------
    async bulkCreateOffer(
      offers: object[],
    ): Promise<EbayBulkCreateOfferResponse> {
      try {
        const token = await getToken();

        const response = await fetch(
          `${baseUrl}/sell/inventory/v1/bulk_create_offer`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Content-Language': 'en-US',
            },
            body: JSON.stringify({ requests: offers }),
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(
            { status: response.status, count: offers.length, error: errorText },
            'Failed to bulk create offers',
          );
          throw new Error(
            `eBay bulk create offers failed (${response.status}): ${errorText}`,
          );
        }

        const data = (await response.json()) as EbayBulkCreateOfferResponse;
        logger.info({ count: offers.length }, 'Bulk offer creation completed');
        return data;
      } catch (err) {
        logger.error({ count: offers.length, err }, 'bulkCreateOffer error');
        throw err;
      }
    },

    // -----------------------------------------------------------------------
    // 5. Bulk publish offers
    // -----------------------------------------------------------------------
    async bulkPublishOffer(
      offerIds: string[],
    ): Promise<EbayBulkPublishOfferResponse> {
      try {
        const token = await getToken();

        const response = await fetch(
          `${baseUrl}/sell/inventory/v1/bulk_publish_offer`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: offerIds.map((id) => ({ offerId: id })),
            }),
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(
            { status: response.status, count: offerIds.length, error: errorText },
            'Failed to bulk publish offers',
          );
          throw new Error(
            `eBay bulk publish offers failed (${response.status}): ${errorText}`,
          );
        }

        const data = (await response.json()) as EbayBulkPublishOfferResponse;
        logger.info(
          { count: offerIds.length },
          'Bulk offer publish completed',
        );
        return data;
      } catch (err) {
        logger.error({ count: offerIds.length, err }, 'bulkPublishOffer error');
        throw err;
      }
    },

    // -----------------------------------------------------------------------
    // 6. Create inventory location
    // -----------------------------------------------------------------------
    async createInventoryLocation(
      merchantLocationKey: string,
      location: {
        name: string;
        location: {
          address: {
            city: string;
            stateOrProvince: string;
            postalCode: string;
            country: string;
          };
        };
        merchantLocationStatus: 'ENABLED';
        locationTypes: string[];
      },
    ): Promise<void> {
      try {
        const token = await getToken();

        const response = await fetch(
          `${baseUrl}/sell/inventory/v1/location/${encodeURIComponent(merchantLocationKey)}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(location),
          },
        );

        if (!response.ok && response.status !== 204) {
          const errorText = await response.text();
          logger.error(
            { status: response.status, merchantLocationKey, error: errorText },
            'Failed to create inventory location',
          );
          throw new Error(
            `eBay create inventory location failed (${response.status}): ${errorText}`,
          );
        }

        logger.info({ merchantLocationKey }, 'Inventory location created');
      } catch (err) {
        logger.error({ merchantLocationKey, err }, 'createInventoryLocation error');
        throw err;
      }
    },

    // -----------------------------------------------------------------------
    // 7. Get inventory locations
    // -----------------------------------------------------------------------
    async getInventoryLocations(): Promise<EbayInventoryLocationListResponse> {
      try {
        const token = await getToken();

        const response = await fetch(
          `${baseUrl}/sell/inventory/v1/location?limit=100`,
          {
            headers: { 'Authorization': `Bearer ${token}` },
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(
            { status: response.status, error: errorText },
            'Failed to get inventory locations',
          );
          throw new Error(
            `eBay get inventory locations failed (${response.status}): ${errorText}`,
          );
        }

        const data =
          (await response.json()) as EbayInventoryLocationListResponse;
        logger.info({ total: data.total }, 'Inventory locations retrieved');
        return data;
      } catch (err) {
        logger.error({ err }, 'getInventoryLocations error');
        throw err;
      }
    },

    // -----------------------------------------------------------------------
    // 8. Create/update inventory item group (for variations)
    // -----------------------------------------------------------------------
    async createInventoryItemGroup(
      inventoryItemGroupKey: string,
      group: {
        title: string;
        aspects: object;
        description: string;
        imageUrls: string[];
        variantSKUs: string[];
      },
    ): Promise<void> {
      try {
        const token = await getToken();

        const response = await fetch(
          `${baseUrl}/sell/inventory/v1/inventory_item_group/${encodeURIComponent(inventoryItemGroupKey)}`,
          {
            method: 'PUT',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
              'Content-Language': 'en-US',
            },
            body: JSON.stringify(group),
          },
        );

        if (!response.ok && response.status !== 204) {
          const errorText = await response.text();
          logger.error(
            {
              status: response.status,
              inventoryItemGroupKey,
              error: errorText,
            },
            'Failed to create/update inventory item group',
          );
          throw new Error(
            `eBay create inventory item group failed (${response.status}): ${errorText}`,
          );
        }

        logger.info(
          { inventoryItemGroupKey },
          'Inventory item group created/updated',
        );
      } catch (err) {
        logger.error(
          { inventoryItemGroupKey, err },
          'createInventoryItemGroup error',
        );
        throw err;
      }
    },

    // -----------------------------------------------------------------------
    // 9. Get inventory item group
    // -----------------------------------------------------------------------
    async getInventoryItemGroup(
      inventoryItemGroupKey: string,
    ): Promise<EbayInventoryItemGroup> {
      try {
        const token = await getToken();

        const response = await fetch(
          `${baseUrl}/sell/inventory/v1/inventory_item_group/${encodeURIComponent(inventoryItemGroupKey)}`,
          {
            headers: { 'Authorization': `Bearer ${token}` },
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error(
            {
              status: response.status,
              inventoryItemGroupKey,
              error: errorText,
            },
            'Failed to get inventory item group',
          );
          throw new Error(
            `eBay get inventory item group failed (${response.status}): ${errorText}`,
          );
        }

        const data = (await response.json()) as EbayInventoryItemGroup;
        logger.info(
          { inventoryItemGroupKey },
          'Inventory item group retrieved',
        );
        return data;
      } catch (err) {
        logger.error(
          { inventoryItemGroupKey, err },
          'getInventoryItemGroup error',
        );
        throw err;
      }
    },
  };
}
