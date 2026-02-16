/**
 * AliExpress Product Search - Affiliate API adapter
 *
 * Uses AliExpress Affiliate API with HMAC-SHA256 request signing.
 * Requires: appKey, appSecret credentials.
 */

import { createLogger } from '../../utils/logger';
import type { Platform, AliExpressCredentials } from '../../types';
import type { PlatformAdapter, ProductSearchResult, SearchOptions } from '../index';
import type { AliExpressProductQueryResponse, AliExpressProductDetailResponse, AliExpressApiProduct } from './types';
import { callAliExpressApi, type AliExpressAuthConfig } from './auth';
import { createAliExpressShippingApi } from './shipping';

const logger = createLogger('aliexpress');

/**
 * Estimate shipping cost based on product price when real shipping data
 * is not available. AliExpress sellers frequently offer free shipping on
 * higher-priced items; conservative defaults prevent overstating margins.
 */
function estimateShipping(price: number): number {
  if (price >= 20) return 0;       // Free shipping common for $20+
  if (price >= 5)  return 4.99;    // $5-20 range: standard shipping
  return 2.99;                     // Under $5: small packet rate
}

function parseProduct(item: AliExpressApiProduct): ProductSearchResult {
  const price = parseFloat(
    item.target_app_sale_price
    ?? item.app_sale_price
    ?? item.sale_price
    ?? item.original_price
    ?? '0'
  ) || 0;

  return {
    platformId: String(item.product_id),
    platform: 'aliexpress',
    title: item.product_title,
    price,
    shipping: estimateShipping(price),
    currency: item.target_app_sale_price_currency
      ?? item.app_sale_price_currency
      ?? item.sale_price_currency
      ?? 'USD',
    inStock: true,
    seller: item.shop_url ? `shop_${item.shop_id}` : 'AliExpress Seller',
    url: item.promotion_link ?? item.product_detail_url ?? `https://aliexpress.com/item/${item.product_id}.html`,
    imageUrl: item.product_main_image_url,
    category: item.second_level_category_name ?? item.first_level_category_name,
    rating: item.evaluate_rate
      ? (parseFloat(item.evaluate_rate.replace('%', '')) || 0) / 20 // Convert 0-100% to 0-5 scale
      : undefined,
    reviewCount: item.latest_volume,
  };
}

export interface AliExpressAdapterWithShipping extends PlatformAdapter {
  /**
   * Fetch real shipping cost for a specific product from the AliExpress
   * logistics API. Falls back to the price-based estimate when the API
   * call fails or credentials lack an access token.
   */
  getShippingCost(productId: string, countryCode?: string): Promise<number>;
}

export function createAliExpressAdapter(credentials?: AliExpressCredentials): AliExpressAdapterWithShipping {
  function getAuthConfig(): AliExpressAuthConfig | null {
    if (!credentials) return null;
    return {
      appKey: credentials.appKey,
      appSecret: credentials.appSecret,
      accessToken: credentials.accessToken,
    };
  }

  /**
   * Try to resolve the real cheapest shipping cost via the logistics API.
   * Returns null when the call cannot be made or returns no results.
   */
  async function fetchRealShippingCost(
    productId: string,
    countryCode: string,
    authConfig: AliExpressAuthConfig,
  ): Promise<number | null> {
    try {
      const shippingApi = createAliExpressShippingApi(authConfig);
      const cheapest = await shippingApi.getCheapestShipping(productId, countryCode);
      if (cheapest) {
        return parseFloat(cheapest.freightAmount.amount) || 0;
      }
      return null;
    } catch (err) {
      logger.debug(
        { productId, error: err instanceof Error ? err.message : String(err) },
        'Failed to fetch real shipping cost, will use estimate',
      );
      return null;
    }
  }

  return {
    platform: 'aliexpress' as Platform,

    async search(options: SearchOptions): Promise<ProductSearchResult[]> {
      const authConfig = getAuthConfig();
      if (!authConfig) {
        logger.warn('AliExpress credentials not configured');
        return [];
      }

      logger.info({ query: options.query }, 'Searching AliExpress via Affiliate API');

      const params: Record<string, unknown> = {
        keywords: options.query,
        page_no: 1,
        page_size: Math.min(options.maxResults ?? 10, 50),
        target_currency: 'USD',
        target_language: 'en',
        sort: 'SALE_PRICE_ASC',
      };

      if (options.category) {
        params.category_ids = options.category;
      }
      if (options.minPrice != null) {
        params.min_sale_price = options.minPrice;
      }
      if (options.maxPrice != null) {
        params.max_sale_price = options.maxPrice;
      }

      const response = await callAliExpressApi<AliExpressProductQueryResponse>(
        'aliexpress.affiliate.product.query',
        params,
        authConfig,
      );

      const products = response.resp_result?.result?.products?.product ?? [];
      return products.map(parseProduct);
    },

    async getProduct(productId: string): Promise<ProductSearchResult | null> {
      const authConfig = getAuthConfig();
      if (!authConfig) {
        logger.warn('AliExpress credentials not configured');
        return null;
      }

      logger.info({ productId }, 'Getting AliExpress product via Affiliate API');

      const response = await callAliExpressApi<AliExpressProductDetailResponse>(
        'aliexpress.affiliate.product.detail.get',
        {
          product_ids: productId,
          target_currency: 'USD',
          target_language: 'en',
        },
        authConfig,
      );

      const products = response.resp_result?.result?.products?.product ?? [];
      if (products.length === 0) return null;

      const product = parseProduct(products[0]);

      // Attempt to resolve real shipping cost when credentials include an access token
      if (authConfig.accessToken) {
        const realCost = await fetchRealShippingCost(productId, 'US', authConfig);
        if (realCost !== null) {
          product.shipping = realCost;
        }
      }

      return product;
    },

    async getShippingCost(productId: string, countryCode = 'US'): Promise<number> {
      const authConfig = getAuthConfig();
      if (!authConfig) {
        logger.warn('AliExpress credentials not configured, returning estimate');
        return estimateShipping(0);
      }

      const realCost = await fetchRealShippingCost(productId, countryCode, authConfig);
      if (realCost !== null) {
        return realCost;
      }

      // Fall back to price-based estimate; fetch product price for better accuracy
      try {
        const response = await callAliExpressApi<AliExpressProductDetailResponse>(
          'aliexpress.affiliate.product.detail.get',
          {
            product_ids: productId,
            target_currency: 'USD',
            target_language: 'en',
          },
          authConfig,
        );
        const items = response.resp_result?.result?.products?.product ?? [];
        if (items.length > 0) {
          const price = parseFloat(
            items[0].target_app_sale_price
            ?? items[0].app_sale_price
            ?? items[0].sale_price
            ?? items[0].original_price
            ?? '0'
          ) || 0;
          return estimateShipping(price);
        }
      } catch {
        // ignore — return generic estimate below
      }

      return estimateShipping(0);
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
