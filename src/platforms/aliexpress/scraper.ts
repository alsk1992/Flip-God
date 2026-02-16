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

const logger = createLogger('aliexpress');

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
    shipping: 0, // AliExpress typically offers free shipping; actual rates vary by seller and destination
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

export function createAliExpressAdapter(credentials?: AliExpressCredentials): PlatformAdapter {
  function getAuthConfig(): AliExpressAuthConfig | null {
    if (!credentials) return null;
    return {
      appKey: credentials.appKey,
      appSecret: credentials.appSecret,
      accessToken: credentials.accessToken,
    };
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
      return products.length > 0 ? parseProduct(products[0]) : null;
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
