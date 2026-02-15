/**
 * AliExpress Discovery & Order Management API
 *
 * Covers affiliate order tracking, DS product recommendations,
 * image search, DS order placement, bulk order queries, and dispute management.
 */

import { createLogger } from '../../utils/logger.js';
import { callAliExpressApi, type AliExpressAuthConfig } from './auth.js';

const logger = createLogger('aliexpress-discovery');

// ─── Response Interfaces ───

interface AffiliateOrderItem {
  order_id: number;
  order_number: string;
  paid_amount: string;
  paid_time: string;
  effect_status: string;
  is_new_buyer: boolean;
  commission: string;
  estimated_finished_commission: string;
  sub_order_id?: number;
  product_id?: number;
  product_title?: string;
  product_count?: number;
}

interface AffiliateOrdersResponse {
  resp_result?: {
    resp_code: number;
    resp_msg: string;
    result?: {
      current_page_no: number;
      current_record_count: number;
      total_record_count: number;
      orders?: { order: AffiliateOrderItem[] };
    };
  };
}

interface AffiliateOrdersByIndexResponse {
  resp_result?: {
    resp_code: number;
    resp_msg: string;
    result?: {
      current_record_count: number;
      orders?: { order: AffiliateOrderItem[] };
      max_query_index_id?: string;
    };
  };
}

interface DsRecommendFeedProduct {
  product_id: number;
  product_title: string;
  app_sale_price?: string;
  app_sale_price_currency?: string;
  original_price?: string;
  original_price_currency?: string;
  sale_price?: string;
  sale_price_currency?: string;
  product_main_image_url?: string;
  product_detail_url?: string;
  promotion_link?: string;
  evaluate_rate?: string;
  latest_volume?: number;
  discount?: string;
  first_level_category_id?: number;
  first_level_category_name?: string;
  second_level_category_id?: number;
  second_level_category_name?: string;
}

interface DsRecommendFeedResponse {
  resp_result?: {
    resp_code: number;
    resp_msg: string;
    result?: {
      current_page_no: number;
      current_record_count: number;
      total_record_count: number;
      products?: { product: DsRecommendFeedProduct[] };
    };
  };
}

interface DsCategoriesResponse {
  result?: {
    categories?: Array<{
      category_id: number;
      category_name: string;
      parent_category_id?: number;
      is_leaf_category?: boolean;
    }>;
  };
}

interface ImageSearchResponse {
  result?: {
    products?: Array<{
      product_id: number;
      product_title: string;
      product_price: string;
      product_price_currency: string;
      product_main_image_url?: string;
      product_detail_url?: string;
      evaluate_rate?: string;
      latest_volume?: number;
    }>;
    total_record_count?: number;
  };
}

interface DsMemberOrderResponse {
  result?: {
    is_success: boolean;
    order_list?: Array<{ order_id: number }>;
    error_code?: string;
    error_msg?: string;
  };
}

interface BulkOrderQueryResponse {
  result?: {
    total_count: number;
    order_list?: Array<{
      order_id: number;
      order_status: string;
      logistics_status?: string;
      order_amount?: { amount: string; currency_code: string };
      gmt_create?: string;
      gmt_modified?: string;
      product_list?: Array<{
        product_id: number;
        product_name: string;
        product_count: number;
        product_price: string;
      }>;
    }>;
  };
}

interface DisputeCreateResponse {
  result?: {
    is_success: boolean;
    issue_id?: number;
    error_code?: string;
    error_msg?: string;
  };
}

interface DisputeDetailResponse {
  result?: {
    issue_id: number;
    issue_status: string;
    order_id: number;
    reason?: string;
    description?: string;
    refund_amount?: string;
    gmt_create?: string;
    gmt_modified?: string;
    buyer_solution?: string;
    seller_solution?: string;
  };
}

interface DisputeCancelResponse {
  result?: {
    is_success: boolean;
    error_code?: string;
    error_msg?: string;
  };
}

// ─── Public Types ───

export interface AffiliateOrder {
  orderId: number;
  orderNumber: string;
  paidAmount: string;
  paidTime: string;
  effectStatus: string;
  isNewBuyer: boolean;
  commission: string;
  estimatedFinishedCommission: string;
  subOrderId?: number;
  productId?: number;
  productTitle?: string;
  productCount?: number;
}

export interface DsRecommendProduct {
  productId: number;
  title: string;
  salePrice?: string;
  salePriceCurrency?: string;
  originalPrice?: string;
  originalPriceCurrency?: string;
  imageUrl?: string;
  detailUrl?: string;
  promotionLink?: string;
  evaluateRate?: string;
  latestVolume?: number;
  discount?: string;
  categoryId?: number;
  categoryName?: string;
}

export interface DsCategory {
  categoryId: number;
  categoryName: string;
  parentCategoryId?: number;
  isLeaf?: boolean;
}

export interface ImageSearchProduct {
  productId: number;
  title: string;
  price: string;
  currency: string;
  imageUrl?: string;
  detailUrl?: string;
  evaluateRate?: string;
  latestVolume?: number;
}

export interface BulkOrder {
  orderId: number;
  orderStatus: string;
  logisticsStatus?: string;
  orderAmount?: { amount: string; currencyCode: string };
  createdAt?: string;
  modifiedAt?: string;
  products?: Array<{
    productId: number;
    productName: string;
    productCount: number;
    productPrice: string;
  }>;
}

export interface DisputeDetail {
  issueId: number;
  issueStatus: string;
  orderId: number;
  reason?: string;
  description?: string;
  refundAmount?: string;
  createdAt?: string;
  modifiedAt?: string;
  buyerSolution?: string;
  sellerSolution?: string;
}

// ─── API Interface ───

export interface AliExpressDiscoveryApi {
  /** Get affiliate orders with commission info */
  getAffiliateOrders(params?: {
    start_time?: string;
    end_time?: string;
    status?: string;
    page_no?: number;
    page_size?: number;
  }): Promise<AffiliateOrder[]>;

  /** Get affiliate orders paginated by index (for large result sets) */
  getAffiliateOrdersByIndex(params?: {
    start_query_index_id?: string;
    page_size?: number;
    status?: string;
  }): Promise<{ orders: AffiliateOrder[]; maxQueryIndexId?: string }>;

  /** Get curated DS product recommendations */
  getDsRecommendFeed(params?: {
    category_id?: string;
    page_no?: number;
    page_size?: number;
    country?: string;
    target_currency?: string;
    target_language?: string;
    sort?: string;
  }): Promise<DsRecommendProduct[]>;

  /** Get DS-specific category tree */
  getDsCategories(): Promise<DsCategory[]>;

  /** Reverse image search for cheaper suppliers */
  imageSearch(imageUrl: string): Promise<ImageSearchProduct[]>;

  /** Place a DS member order */
  placeDsMemberOrder(params: {
    product_id: string;
    product_count: number;
    logistics_address: {
      name: string;
      phone_country: string;
      mobile_no: string;
      address: string;
      address2?: string;
      city: string;
      province: string;
      country: string;
      zip: string;
    };
    shipping_method?: string;
  }): Promise<{ success: boolean; orderIds: number[]; error?: string }>;

  /** List all trade orders in bulk */
  bulkOrderQuery(params?: {
    page_no?: number;
    page_size?: number;
    order_status?: string;
  }): Promise<BulkOrder[]>;

  /** Open a dispute for an order */
  createDispute(params: {
    order_id: number;
    reason: string;
    description: string;
    image_urls?: string[];
  }): Promise<{ success: boolean; issueId?: number; error?: string }>;

  /** Get dispute status */
  getDisputeDetail(disputeId: number): Promise<DisputeDetail | null>;

  /** Cancel an open dispute */
  cancelDispute(disputeId: number): Promise<{ success: boolean; error?: string }>;
}

// ─── Factory ───

export function createAliExpressDiscoveryApi(config: AliExpressAuthConfig): AliExpressDiscoveryApi {
  function mapAffiliateOrder(o: AffiliateOrderItem): AffiliateOrder {
    return {
      orderId: o.order_id,
      orderNumber: o.order_number,
      paidAmount: o.paid_amount,
      paidTime: o.paid_time,
      effectStatus: o.effect_status,
      isNewBuyer: o.is_new_buyer,
      commission: o.commission,
      estimatedFinishedCommission: o.estimated_finished_commission,
      subOrderId: o.sub_order_id,
      productId: o.product_id,
      productTitle: o.product_title,
      productCount: o.product_count,
    };
  }

  return {
    async getAffiliateOrders(params?) {
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const response = await callAliExpressApi<AffiliateOrdersResponse>(
        'aliexpress.affiliate.order.list',
        {
          start_time: params?.start_time ?? oneDayAgo.toISOString().replace('T', ' ').slice(0, 19),
          end_time: params?.end_time ?? now.toISOString().replace('T', ' ').slice(0, 19),
          status: params?.status,
          page_no: params?.page_no ?? 1,
          page_size: params?.page_size ?? 50,
        },
        config,
      );

      const orders = response.resp_result?.result?.orders?.order;
      if (!orders) {
        logger.debug('No affiliate orders returned');
        return [];
      }
      return orders.map(mapAffiliateOrder);
    },

    async getAffiliateOrdersByIndex(params?) {
      const response = await callAliExpressApi<AffiliateOrdersByIndexResponse>(
        'aliexpress.affiliate.order.listbyindex',
        {
          start_query_index_id: params?.start_query_index_id,
          page_size: params?.page_size ?? 50,
          status: params?.status,
        },
        config,
      );

      const orders = response.resp_result?.result?.orders?.order;
      if (!orders) {
        logger.debug('No affiliate orders returned by index');
        return { orders: [], maxQueryIndexId: undefined };
      }

      return {
        orders: orders.map(mapAffiliateOrder),
        maxQueryIndexId: response.resp_result?.result?.max_query_index_id,
      };
    },

    async getDsRecommendFeed(params?) {
      const response = await callAliExpressApi<DsRecommendFeedResponse>(
        'aliexpress.ds.recommend.feed.get',
        {
          category_id: params?.category_id,
          page_no: params?.page_no ?? 1,
          page_size: params?.page_size ?? 20,
          country: params?.country ?? 'US',
          target_currency: params?.target_currency ?? 'USD',
          target_language: params?.target_language ?? 'en',
          sort: params?.sort,
        },
        config,
      );

      const products = response.resp_result?.result?.products?.product;
      if (!products) {
        logger.debug('No DS recommend feed products returned');
        return [];
      }

      return products.map((p) => ({
        productId: p.product_id,
        title: p.product_title,
        salePrice: p.app_sale_price ?? p.sale_price,
        salePriceCurrency: p.app_sale_price_currency ?? p.sale_price_currency,
        originalPrice: p.original_price,
        originalPriceCurrency: p.original_price_currency,
        imageUrl: p.product_main_image_url,
        detailUrl: p.product_detail_url,
        promotionLink: p.promotion_link,
        evaluateRate: p.evaluate_rate,
        latestVolume: p.latest_volume,
        discount: p.discount,
        categoryId: p.first_level_category_id ?? p.second_level_category_id,
        categoryName: p.first_level_category_name ?? p.second_level_category_name,
      }));
    },

    async getDsCategories() {
      const response = await callAliExpressApi<DsCategoriesResponse>(
        'aliexpress.ds.category.get',
        {},
        config,
      );

      const categories = response.result?.categories;
      if (!categories) {
        logger.debug('No DS categories returned');
        return [];
      }

      return categories.map((c) => ({
        categoryId: c.category_id,
        categoryName: c.category_name,
        parentCategoryId: c.parent_category_id,
        isLeaf: c.is_leaf_category,
      }));
    },

    async imageSearch(imageUrl: string) {
      const response = await callAliExpressApi<ImageSearchResponse>(
        'aliexpress.ds.image.search',
        {
          image_url: imageUrl,
          target_currency: 'USD',
          country: 'US',
        },
        config,
      );

      const products = response.result?.products;
      if (!products) {
        logger.debug('No image search results returned');
        return [];
      }

      return products.map((p) => ({
        productId: p.product_id,
        title: p.product_title,
        price: p.product_price,
        currency: p.product_price_currency,
        imageUrl: p.product_main_image_url,
        detailUrl: p.product_detail_url,
        evaluateRate: p.evaluate_rate,
        latestVolume: p.latest_volume,
      }));
    },

    async placeDsMemberOrder(params) {
      const response = await callAliExpressApi<DsMemberOrderResponse>(
        'aliexpress.ds.member.orderdata.submit',
        {
          product_id: params.product_id,
          product_count: params.product_count,
          logistics_address: JSON.stringify(params.logistics_address),
          shipping_method: params.shipping_method,
        },
        config,
      );

      if (!response.result) {
        return { success: false, orderIds: [], error: 'No response from API' };
      }

      return {
        success: response.result.is_success,
        orderIds: response.result.order_list?.map((o) => o.order_id) ?? [],
        error: response.result.error_msg,
      };
    },

    async bulkOrderQuery(params?) {
      const response = await callAliExpressApi<BulkOrderQueryResponse>(
        'aliexpress.trade.redefining.findorderlistquery',
        {
          page_no: params?.page_no ?? 1,
          page_size: params?.page_size ?? 50,
          order_status: params?.order_status,
        },
        config,
      );

      const orders = response.result?.order_list;
      if (!orders) {
        logger.debug('No bulk orders returned');
        return [];
      }

      return orders.map((o) => ({
        orderId: o.order_id,
        orderStatus: o.order_status,
        logisticsStatus: o.logistics_status,
        orderAmount: o.order_amount
          ? { amount: o.order_amount.amount, currencyCode: o.order_amount.currency_code }
          : undefined,
        createdAt: o.gmt_create,
        modifiedAt: o.gmt_modified,
        products: o.product_list?.map((p) => ({
          productId: p.product_id,
          productName: p.product_name,
          productCount: p.product_count,
          productPrice: p.product_price,
        })),
      }));
    },

    async createDispute(params) {
      const response = await callAliExpressApi<DisputeCreateResponse>(
        'aliexpress.trade.complaint.create',
        {
          order_id: params.order_id,
          reason: params.reason,
          description: params.description,
          image_urls: params.image_urls?.join(','),
        },
        config,
      );

      if (!response.result) {
        return { success: false, error: 'No response from API' };
      }

      return {
        success: response.result.is_success,
        issueId: response.result.issue_id,
        error: response.result.error_msg,
      };
    },

    async getDisputeDetail(disputeId: number) {
      try {
        const response = await callAliExpressApi<DisputeDetailResponse>(
          'aliexpress.trade.complaint.detail.query',
          { issue_id: disputeId },
          config,
        );

        if (!response.result) return null;

        const r = response.result;
        return {
          issueId: r.issue_id,
          issueStatus: r.issue_status,
          orderId: r.order_id,
          reason: r.reason,
          description: r.description,
          refundAmount: r.refund_amount,
          createdAt: r.gmt_create,
          modifiedAt: r.gmt_modified,
          buyerSolution: r.buyer_solution,
          sellerSolution: r.seller_solution,
        };
      } catch (err) {
        logger.error(
          { disputeId, error: err instanceof Error ? err.message : String(err) },
          'Failed to get dispute detail',
        );
        return null;
      }
    },

    async cancelDispute(disputeId: number) {
      const response = await callAliExpressApi<DisputeCancelResponse>(
        'aliexpress.trade.complaint.cancel',
        { issue_id: disputeId },
        config,
      );

      if (!response.result) {
        return { success: false, error: 'No response from API' };
      }

      return {
        success: response.result.is_success,
        error: response.result.error_msg,
      };
    },
  };
}
