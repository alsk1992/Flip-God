/**
 * Target Product Search - Redsky API adapter
 *
 * Uses Target's internal Redsky API for product data.
 */

import { createLogger } from '../../utils/logger';
import type { PlatformAdapter, ProductSearchResult, SearchOptions } from '../index';

const logger = createLogger('target');

const API_BASE = 'https://redsky.target.com';
const SEARCH_BASE = 'https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v1';

interface TargetProduct {
  tcin: string;
  item?: {
    product_description?: { title?: string };
    enrichment?: { images?: { primary_image_url?: string } };
    product_brand?: { brand?: string };
    product_classification?: { product_type_name?: string };
  };
  price?: {
    current_retail?: number;
    current_retail_min?: number;
  };
  fulfillment?: {
    is_out_of_stock_in_all_store_and_online?: boolean;
  };
  ratings_and_reviews?: {
    statistics?: { rating?: { average?: number; count?: number } };
  };
}

function parseProduct(item: TargetProduct): ProductSearchResult {
  const price = item.price?.current_retail ?? item.price?.current_retail_min ?? 0;
  return {
    platformId: item.tcin,
    platform: 'target',
    title: item.item?.product_description?.title ?? '',
    price,
    shipping: 0,
    currency: 'USD',
    inStock: !item.fulfillment?.is_out_of_stock_in_all_store_and_online,
    seller: 'Target',
    url: `https://www.target.com/p/-/A-${item.tcin}`,
    imageUrl: item.item?.enrichment?.images?.primary_image_url,
    brand: item.item?.product_brand?.brand,
    category: item.item?.product_classification?.product_type_name,
    rating: item.ratings_and_reviews?.statistics?.rating?.average,
    reviewCount: item.ratings_and_reviews?.statistics?.rating?.count,
  };
}

export interface TargetStoreAvailability {
  storeId: string;
  storeName: string;
  available: boolean;
  pickupType?: string;
}

export function createTargetAdapter(): PlatformAdapter & {
  getStoreAvailability(tcin: string, zipCode?: string): Promise<TargetStoreAvailability[]>;
} {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  };

  return {
    platform: 'target',

    async search(options: SearchOptions): Promise<ProductSearchResult[]> {
      logger.info({ query: options.query }, 'Searching Target');

      const params = new URLSearchParams({
        key: 'ff457966e64d5e877fdbad070f276d18ecec4a01',
        keyword: options.query,
        count: String(Math.min(options.maxResults ?? 10, 24)),
        offset: '0',
        channel: 'WEB',
        page: '/s/' + encodeURIComponent(options.query),
        pricing_store_id: '3991',
        visitor_id: 'visitor_' + Date.now(),
      });

      if (options.maxPrice) params.set('max_price', String(options.maxPrice));
      if (options.minPrice) params.set('min_price', String(options.minPrice));

      try {
        const response = await fetch(`${SEARCH_BASE}?${params.toString()}`, { headers });
        if (!response.ok) {
          logger.error({ status: response.status }, 'Target search failed');
          return [];
        }
        const data = await response.json() as {
          data?: { search?: { products?: TargetProduct[] } };
        };
        return (data?.data?.search?.products ?? []).map(parseProduct);
      } catch (err) {
        logger.error({ err }, 'Target search error');
        return [];
      }
    },

    async getProduct(productId: string): Promise<ProductSearchResult | null> {
      logger.info({ productId }, 'Getting Target product');
      const params = new URLSearchParams({
        key: 'ff457966e64d5e877fdbad070f276d18ecec4a01',
        tcin: productId,
        pricing_store_id: '3991',
      });

      try {
        const response = await fetch(
          `${API_BASE}/redsky_aggregations/v1/web/pdp_client_v1?${params.toString()}`,
          { headers },
        );
        if (!response.ok) return null;
        const data = await response.json() as { data?: { product?: TargetProduct } };
        const product = data?.data?.product;
        if (!product) return null;
        return parseProduct(product);
      } catch (err) {
        logger.error({ productId, err }, 'Target product lookup error');
        return null;
      }
    },

    async checkStock(productId: string): Promise<{ inStock: boolean; quantity?: number }> {
      const product = await this.getProduct(productId);
      return { inStock: product?.inStock ?? false };
    },

    async getStoreAvailability(tcin: string, zipCode?: string): Promise<TargetStoreAvailability[]> {
      logger.info({ tcin, zipCode }, 'Checking Target store availability');

      const params = new URLSearchParams({
        key: 'ff457966e64d5e877fdbad070f276d18ecec4a01',
        tcin,
        nearby: zipCode ?? '90210',
        limit: '5',
        include_only_available_stores: 'false',
      });

      try {
        const response = await fetch(
          `${API_BASE}/redsky_aggregations/v1/web/fiats_v1?${params.toString()}`,
          { headers },
        );
        if (!response.ok) {
          logger.error({ status: response.status }, 'Target store availability lookup failed');
          return [];
        }

        const data = await response.json() as {
          data?: {
            fulfillment_fiats?: Array<{
              store_options?: Array<{
                store_id?: string;
                store_name?: string;
                in_store_only?: { availability_status?: string };
                order_pickup?: { availability_status?: string; pickup_type?: string };
              }>;
            }>;
          };
        };

        const storeOptions = data?.data?.fulfillment_fiats?.[0]?.store_options ?? [];
        return storeOptions.map((store) => {
          const pickupStatus = store.order_pickup?.availability_status;
          const inStoreStatus = store.in_store_only?.availability_status;
          const available = pickupStatus === 'IN_STOCK' || inStoreStatus === 'IN_STOCK';
          return {
            storeId: store.store_id ?? '',
            storeName: store.store_name ?? '',
            available,
            pickupType: store.order_pickup?.pickup_type,
          };
        });
      } catch (err) {
        logger.error({ tcin, err }, 'Target store availability error');
        return [];
      }
    },
  };
}
