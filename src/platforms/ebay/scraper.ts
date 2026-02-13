/**
 * eBay Product Search - Browse API adapter
 *
 * Uses eBay's Browse API for product search and item detail.
 * Requires: clientId, clientSecret (and optionally refreshToken for sell APIs).
 */

import { createLogger } from '../../utils/logger';
import type { Platform, EbayCredentials } from '../../types';
import type { PlatformAdapter, ProductSearchResult, SearchOptions } from '../index';
import type { EbaySearchResponse, EbayItemDetail, EbayItemSummary } from './types';
import { getAccessToken, API_BASE } from './auth';

const logger = createLogger('ebay');

function parseItemSummary(item: EbayItemSummary): ProductSearchResult {
  const price = item.price ? parseFloat(item.price.value) : 0;
  const shippingOption = item.shippingOptions?.[0];
  const shippingCost = shippingOption?.shippingCost
    ? parseFloat(shippingOption.shippingCost.value)
    : shippingOption?.shippingCostType === 'FREE' ? 0 : 4.99;

  return {
    platformId: item.itemId,
    platform: 'ebay',
    title: item.title,
    price,
    shipping: shippingCost,
    currency: item.price?.currency ?? 'USD',
    inStock: true,
    seller: item.seller?.username ?? 'Unknown',
    url: item.itemWebUrl ?? `https://ebay.com/itm/${item.itemId}`,
    imageUrl: item.image?.imageUrl ?? item.thumbnailImages?.[0]?.imageUrl,
    category: item.categories?.[0]?.categoryName,
    rating: item.seller?.feedbackPercentage
      ? parseFloat(item.seller.feedbackPercentage) / 20 // Convert 0-100% to 0-5 scale
      : undefined,
    reviewCount: item.seller?.feedbackScore,
  };
}

export function createEbayAdapter(credentials?: EbayCredentials): PlatformAdapter {
  return {
    platform: 'ebay' as Platform,

    async search(options: SearchOptions): Promise<ProductSearchResult[]> {
      if (!credentials) {
        logger.warn('eBay credentials not configured');
        return [];
      }

      logger.info({ query: options.query }, 'Searching eBay via Browse API');

      const accessToken = await getAccessToken({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        environment: credentials.environment,
      });

      const env = credentials.environment ?? 'production';
      const baseUrl = API_BASE[env];

      const params = new URLSearchParams({
        q: options.query,
        limit: String(Math.min(options.maxResults ?? 10, 50)),
      });

      if (options.category) {
        params.set('category_ids', options.category);
      }

      // Price filter
      const priceFilters: string[] = [];
      if (options.minPrice != null) {
        priceFilters.push(`price:[${options.minPrice}..`);
      }
      if (options.maxPrice != null) {
        if (priceFilters.length > 0) {
          priceFilters[0] = `price:[${options.minPrice}..${options.maxPrice}]`;
        } else {
          priceFilters.push(`price:[..${options.maxPrice}]`);
        }
      }
      if (priceFilters.length > 0) {
        params.set('filter', priceFilters[0]);
      }

      const response = await fetch(
        `${baseUrl}/buy/browse/v1/item_summary/search?${params.toString()}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'eBay Browse API search failed');
        throw new Error(`eBay Browse API search failed (${response.status})`);
      }

      const data = await response.json() as EbaySearchResponse;
      const items = data.itemSummaries ?? [];
      return items.map(parseItemSummary);
    },

    async getProduct(productId: string): Promise<ProductSearchResult | null> {
      if (!credentials) {
        logger.warn('eBay credentials not configured');
        return null;
      }

      logger.info({ productId }, 'Getting eBay product via Browse API');

      const accessToken = await getAccessToken({
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        environment: credentials.environment,
      });

      const env = credentials.environment ?? 'production';
      const baseUrl = API_BASE[env];

      // eBay item IDs include a | separator in v1 format
      const encodedId = encodeURIComponent(productId);
      const response = await fetch(
        `${baseUrl}/buy/browse/v1/item/${encodedId}`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          },
        },
      );

      if (!response.ok) {
        if (response.status === 404) return null;
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'eBay Browse API getItem failed');
        return null;
      }

      const item = await response.json() as EbayItemDetail;
      const price = item.price ? parseFloat(item.price.value) : 0;
      const shippingOption = item.shippingOptions?.[0];
      const shippingCost = shippingOption?.shippingCost
        ? parseFloat(shippingOption.shippingCost.value)
        : 0;

      const availability = item.estimatedAvailabilities?.[0];
      const inStock = availability?.estimatedAvailabilityStatus !== 'OUT_OF_STOCK';

      return {
        platformId: item.itemId,
        platform: 'ebay',
        title: item.title,
        price,
        shipping: shippingCost,
        currency: item.price?.currency ?? 'USD',
        inStock,
        seller: item.seller?.username ?? 'Unknown',
        url: item.itemWebUrl ?? `https://ebay.com/itm/${item.itemId}`,
        imageUrl: item.image?.imageUrl,
        brand: item.brand,
        category: item.categoryPath,
        upc: item.gtin ?? item.upc?.[0],
        rating: item.seller?.feedbackPercentage
          ? parseFloat(item.seller.feedbackPercentage) / 20
          : undefined,
        reviewCount: item.seller?.feedbackScore,
      };
    },

    async checkStock(productId: string): Promise<{ inStock: boolean; quantity?: number }> {
      const product = await this.getProduct(productId);
      if (!product) {
        return { inStock: false };
      }
      return { inStock: product.inStock };
    },
  };
}
