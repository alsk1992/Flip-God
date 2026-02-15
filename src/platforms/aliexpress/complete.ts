/**
 * AliExpress Complete API - Remaining methods
 *
 * Covers affiliate link generation, categories, hot products,
 * dropshipping product/order/freight details, and trade/logistics queries.
 *
 * All methods not already present in scraper.ts or discovery.ts.
 */

import { createLogger } from '../../utils/logger.js';
import { callAliExpressApi, type AliExpressAuthConfig } from './auth.js';

const logger = createLogger('aliexpress-complete');

// ─── Response Interfaces (raw API shapes) ───

interface AffiliateLinkRawResponse {
  resp_result?: {
    resp_code: number;
    resp_msg: string;
    result?: {
      total_result_count: number;
      promotion_links?: {
        promotion_link: Array<{
          source_value: string;
          promotion_link: string;
        }>;
      };
    };
  };
}

interface AffiliateCategoryRawResponse {
  resp_result?: {
    resp_code: number;
    resp_msg: string;
    result?: {
      categories?: {
        category: Array<{
          category_id: number;
          category_name: string;
          parent_category_id?: number;
        }>;
      };
    };
  };
}

interface HotProductRawItem {
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
  shop_id?: number;
  shop_url?: string;
}

interface HotProductDownloadRawResponse {
  resp_result?: {
    resp_code: number;
    resp_msg: string;
    result?: {
      current_page_no: number;
      current_record_count: number;
      total_record_count: number;
      products?: { product: HotProductRawItem[] };
    };
  };
}

interface HotProductQueryRawResponse {
  resp_result?: {
    resp_code: number;
    resp_msg: string;
    result?: {
      current_page_no: number;
      current_record_count: number;
      total_record_count: number;
      products?: { product: HotProductRawItem[] };
    };
  };
}

interface DsProductSkuVariant {
  sku_id: string;
  sku_price: string;
  sku_stock: boolean;
  currency_code?: string;
  sku_attr?: string;
  ipm_sku_stock?: number;
  offer_sale_price?: string;
  offer_bulk_sale_price?: string;
  id?: string;
}

interface DsProductShippingOption {
  service_name: string;
  estimated_delivery_time?: string;
  freight?: { amount: string; currency_code: string };
  tracking_available?: boolean;
}

interface DsProductDetailRawResponse {
  result?: {
    product_id: number;
    product_title: string;
    product_main_image_url?: string;
    product_image_urls?: string[];
    product_video_url?: string;
    category_id?: number;
    currency_code?: string;
    target_sale_price?: string;
    target_original_price?: string;
    sale_price?: string;
    original_price?: string;
    evaluate_rate?: string;
    sku_info_list?: { sku_info: DsProductSkuVariant[] };
    shipping_info_list?: { shipping_info: DsProductShippingOption[] };
    package_height?: number;
    package_width?: number;
    package_length?: number;
    package_weight?: string;
    error_code?: string;
    error_msg?: string;
  };
}

interface DsOrderStatusRawResponse {
  result?: {
    order_id: number;
    order_status: string;
    logistics_status?: string;
    order_amount?: string;
    order_amount_currency?: string;
    gmt_create?: string;
    gmt_modified?: string;
    child_order_list?: Array<{
      child_order_id: number;
      product_id: number;
      product_count: number;
      logistics_tracking_number?: string;
      logistics_service_name?: string;
    }>;
    error_code?: string;
    error_msg?: string;
  };
}

interface DsOrderTrackingRawResponse {
  result?: {
    tracking_available: boolean;
    tracking_number?: string;
    service_name?: string;
    details?: Array<{
      event_desc: string;
      event_date: string;
      address?: string;
      status?: string;
    }>;
    error_code?: string;
    error_msg?: string;
  };
}

interface DsFreightRawResponse {
  result?: {
    freight_list?: Array<{
      service_name: string;
      estimated_delivery_time?: string;
      freight?: { amount: string; cent: number; currency_code: string };
      tracking_available?: boolean;
    }>;
    error_code?: string;
    error_msg?: string;
  };
}

interface TradeOrderDetailRawResponse {
  result?: {
    order_id: number;
    order_status: string;
    pay_amount?: string;
    pay_amount_currency?: string;
    gmt_create?: string;
    gmt_pay_success?: string;
    gmt_trade_end?: string;
    logistics_status?: string;
    buyer_info?: {
      name?: string;
      country?: string;
      address?: string;
    };
    child_order_list?: Array<{
      product_id: number;
      product_name?: string;
      product_count: number;
      product_price?: string;
      logistics_tracking_number?: string;
      logistics_service_name?: string;
    }>;
    error_code?: string;
    error_msg?: string;
  };
}

interface LogisticsFreightRawResponse {
  result?: {
    freight_list?: Array<{
      service_name: string;
      estimated_delivery_time?: string;
      freight_amount?: { amount: string; currency_code: string };
      tracking_available?: boolean;
    }>;
    error_code?: string;
    error_msg?: string;
  };
}

// ─── Public Types ───

export interface AffiliateLink {
  sourceValue: string;
  promotionLink: string;
}

export interface AffiliateCategory {
  categoryId: number;
  categoryName: string;
  parentCategoryId?: number;
}

export interface HotProduct {
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

export interface DsProductDetail {
  productId: number;
  title: string;
  mainImageUrl?: string;
  imageUrls?: string[];
  videoUrl?: string;
  categoryId?: number;
  currencyCode?: string;
  salePrice?: string;
  originalPrice?: string;
  evaluateRate?: string;
  skuVariants: DsSkuVariant[];
  shippingOptions: DsShippingOption[];
  packageHeight?: number;
  packageWidth?: number;
  packageLength?: number;
  packageWeight?: string;
}

export interface DsSkuVariant {
  skuId: string;
  skuPrice: string;
  inStock: boolean;
  currencyCode?: string;
  skuAttr?: string;
  stockQuantity?: number;
  offerSalePrice?: string;
  offerBulkSalePrice?: string;
}

export interface DsShippingOption {
  serviceName: string;
  estimatedDeliveryTime?: string;
  freight?: { amount: string; currencyCode: string };
  trackingAvailable?: boolean;
}

export interface DsOrderStatus {
  orderId: number;
  orderStatus: string;
  logisticsStatus?: string;
  orderAmount?: string;
  orderAmountCurrency?: string;
  createdAt?: string;
  modifiedAt?: string;
  childOrders?: Array<{
    childOrderId: number;
    productId: number;
    productCount: number;
    trackingNumber?: string;
    serviceName?: string;
  }>;
}

export interface DsOrderTracking {
  trackingAvailable: boolean;
  trackingNumber?: string;
  serviceName?: string;
  details: Array<{
    eventDesc: string;
    eventDate: string;
    address?: string;
    status?: string;
  }>;
}

export interface FreightOption {
  serviceName: string;
  estimatedDeliveryTime?: string;
  freightAmount?: string;
  freightCurrency?: string;
  trackingAvailable?: boolean;
}

export interface TradeOrderDetail {
  orderId: number;
  orderStatus: string;
  payAmount?: string;
  payAmountCurrency?: string;
  createdAt?: string;
  paidAt?: string;
  completedAt?: string;
  logisticsStatus?: string;
  buyerInfo?: {
    name?: string;
    country?: string;
    address?: string;
  };
  childOrders?: Array<{
    productId: number;
    productName?: string;
    productCount: number;
    productPrice?: string;
    trackingNumber?: string;
    serviceName?: string;
  }>;
}

// ─── Helper ───

function mapHotProduct(item: HotProductRawItem): HotProduct {
  return {
    productId: item.product_id,
    title: item.product_title,
    salePrice: item.app_sale_price ?? item.sale_price,
    salePriceCurrency: item.app_sale_price_currency ?? item.sale_price_currency,
    originalPrice: item.original_price,
    originalPriceCurrency: item.original_price_currency,
    imageUrl: item.product_main_image_url,
    detailUrl: item.product_detail_url,
    promotionLink: item.promotion_link,
    evaluateRate: item.evaluate_rate,
    latestVolume: item.latest_volume,
    discount: item.discount,
    categoryId: item.first_level_category_id ?? item.second_level_category_id,
    categoryName: item.first_level_category_name ?? item.second_level_category_name,
  };
}

// ─── Affiliate Methods ───

/**
 * Generate affiliate promotion links for given source URLs or product IDs.
 */
export async function generateAffiliateLink(
  config: AliExpressAuthConfig,
  params: {
    sourceValues: string;
    promotionLinkType?: number;
    trackingId?: string;
  },
): Promise<AffiliateLink[]> {
  try {
    const response = await callAliExpressApi<AffiliateLinkRawResponse>(
      'aliexpress.affiliate.link.generate',
      {
        source_values: params.sourceValues,
        promotion_link_type: params.promotionLinkType ?? 0,
        tracking_id: params.trackingId,
      },
      config,
    );

    const links = response.resp_result?.result?.promotion_links?.promotion_link;
    if (!links) {
      logger.debug('No affiliate links generated');
      return [];
    }

    return links.map((l) => ({
      sourceValue: l.source_value,
      promotionLink: l.promotion_link,
    }));
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Failed to generate affiliate links',
    );
    throw err;
  }
}

/**
 * Get all available affiliate product categories.
 */
export async function getAffiliateCategories(
  config: AliExpressAuthConfig,
): Promise<AffiliateCategory[]> {
  try {
    const response = await callAliExpressApi<AffiliateCategoryRawResponse>(
      'aliexpress.affiliate.category.get',
      {},
      config,
    );

    const categories = response.resp_result?.result?.categories?.category;
    if (!categories) {
      logger.debug('No affiliate categories returned');
      return [];
    }

    return categories.map((c) => ({
      categoryId: c.category_id,
      categoryName: c.category_name,
      parentCategoryId: c.parent_category_id,
    }));
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Failed to get affiliate categories',
    );
    throw err;
  }
}

/**
 * Download hot products from the affiliate program (batch/offline style).
 */
export async function getHotProductsDownload(
  config: AliExpressAuthConfig,
  params?: {
    categoryId?: string;
    pageNo?: number;
    pageSize?: number;
  },
): Promise<HotProduct[]> {
  try {
    const response = await callAliExpressApi<HotProductDownloadRawResponse>(
      'aliexpress.affiliate.hotproduct.download',
      {
        category_id: params?.categoryId,
        page_no: params?.pageNo ?? 1,
        page_size: params?.pageSize ?? 50,
      },
      config,
    );

    const products = response.resp_result?.result?.products?.product;
    if (!products) {
      logger.debug('No hot products returned from download');
      return [];
    }

    return products.map(mapHotProduct);
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Failed to download hot products',
    );
    throw err;
  }
}

/**
 * Query hot products with keyword/category/price filters.
 */
export async function queryHotProducts(
  config: AliExpressAuthConfig,
  params?: {
    keywords?: string;
    categoryId?: string;
    minPrice?: number;
    maxPrice?: number;
    sort?: string;
    pageNo?: number;
  },
): Promise<HotProduct[]> {
  try {
    const response = await callAliExpressApi<HotProductQueryRawResponse>(
      'aliexpress.affiliate.hotproduct.query',
      {
        keywords: params?.keywords,
        category_ids: params?.categoryId,
        min_sale_price: params?.minPrice,
        max_sale_price: params?.maxPrice,
        sort: params?.sort ?? 'LAST_VOLUME_DESC',
        page_no: params?.pageNo ?? 1,
        page_size: 50,
      },
      config,
    );

    const products = response.resp_result?.result?.products?.product;
    if (!products) {
      logger.debug('No hot products returned from query');
      return [];
    }

    return products.map(mapHotProduct);
  } catch (err) {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Failed to query hot products',
    );
    throw err;
  }
}

// ─── Dropshipping Methods ───

/**
 * Get full DS product details including SKU variants, inventory, and shipping.
 */
export async function getDsProductDetails(
  config: AliExpressAuthConfig,
  productId: string,
): Promise<DsProductDetail | null> {
  try {
    const response = await callAliExpressApi<DsProductDetailRawResponse>(
      'aliexpress.ds.product.get',
      {
        product_id: productId,
        ship_to_country: 'US',
        target_currency: 'USD',
        target_language: 'en',
      },
      config,
    );

    const r = response.result;
    if (!r) {
      logger.debug({ productId }, 'No DS product detail returned');
      return null;
    }

    if (r.error_code) {
      logger.warn({ productId, errorCode: r.error_code, errorMsg: r.error_msg }, 'DS product detail API error');
      return null;
    }

    return {
      productId: r.product_id,
      title: r.product_title,
      mainImageUrl: r.product_main_image_url,
      imageUrls: r.product_image_urls,
      videoUrl: r.product_video_url,
      categoryId: r.category_id,
      currencyCode: r.currency_code,
      salePrice: r.target_sale_price ?? r.sale_price,
      originalPrice: r.target_original_price ?? r.original_price,
      evaluateRate: r.evaluate_rate,
      skuVariants: (r.sku_info_list?.sku_info ?? []).map((s) => ({
        skuId: s.sku_id,
        skuPrice: s.sku_price,
        inStock: s.sku_stock,
        currencyCode: s.currency_code,
        skuAttr: s.sku_attr,
        stockQuantity: s.ipm_sku_stock,
        offerSalePrice: s.offer_sale_price,
        offerBulkSalePrice: s.offer_bulk_sale_price,
      })),
      shippingOptions: (r.shipping_info_list?.shipping_info ?? []).map((s) => ({
        serviceName: s.service_name,
        estimatedDeliveryTime: s.estimated_delivery_time,
        freight: s.freight
          ? { amount: s.freight.amount, currencyCode: s.freight.currency_code }
          : undefined,
        trackingAvailable: s.tracking_available,
      })),
      packageHeight: r.package_height,
      packageWidth: r.package_width,
      packageLength: r.package_length,
      packageWeight: r.package_weight,
    };
  } catch (err) {
    logger.error(
      { productId, error: err instanceof Error ? err.message : String(err) },
      'Failed to get DS product details',
    );
    throw err;
  }
}

/**
 * Get DS order status and child order details.
 */
export async function getDsOrderStatus(
  config: AliExpressAuthConfig,
  orderId: string,
): Promise<DsOrderStatus | null> {
  try {
    const response = await callAliExpressApi<DsOrderStatusRawResponse>(
      'aliexpress.ds.order.get',
      { order_id: orderId },
      config,
    );

    const r = response.result;
    if (!r) {
      logger.debug({ orderId }, 'No DS order status returned');
      return null;
    }

    if (r.error_code) {
      logger.warn({ orderId, errorCode: r.error_code, errorMsg: r.error_msg }, 'DS order status API error');
      return null;
    }

    return {
      orderId: r.order_id,
      orderStatus: r.order_status,
      logisticsStatus: r.logistics_status,
      orderAmount: r.order_amount,
      orderAmountCurrency: r.order_amount_currency,
      createdAt: r.gmt_create,
      modifiedAt: r.gmt_modified,
      childOrders: r.child_order_list?.map((c) => ({
        childOrderId: c.child_order_id,
        productId: c.product_id,
        productCount: c.product_count,
        trackingNumber: c.logistics_tracking_number,
        serviceName: c.logistics_service_name,
      })),
    };
  } catch (err) {
    logger.error(
      { orderId, error: err instanceof Error ? err.message : String(err) },
      'Failed to get DS order status',
    );
    throw err;
  }
}

/**
 * Get DS order tracking/logistics info.
 */
export async function getDsOrderTracking(
  config: AliExpressAuthConfig,
  orderId: string,
): Promise<DsOrderTracking | null> {
  try {
    const response = await callAliExpressApi<DsOrderTrackingRawResponse>(
      'aliexpress.ds.order.tracking.get',
      { order_id: orderId },
      config,
    );

    const r = response.result;
    if (!r) {
      logger.debug({ orderId }, 'No DS order tracking returned');
      return null;
    }

    if (r.error_code) {
      logger.warn({ orderId, errorCode: r.error_code, errorMsg: r.error_msg }, 'DS order tracking API error');
      return null;
    }

    return {
      trackingAvailable: r.tracking_available,
      trackingNumber: r.tracking_number,
      serviceName: r.service_name,
      details: (r.details ?? []).map((d) => ({
        eventDesc: d.event_desc,
        eventDate: d.event_date,
        address: d.address,
        status: d.status,
      })),
    };
  } catch (err) {
    logger.error(
      { orderId, error: err instanceof Error ? err.message : String(err) },
      'Failed to get DS order tracking',
    );
    throw err;
  }
}

/**
 * Query DS shipping freight options for a product.
 */
export async function queryDsFreight(
  config: AliExpressAuthConfig,
  params: {
    productId: string;
    quantity: number;
    shipToCountry?: string;
  },
): Promise<FreightOption[]> {
  try {
    const response = await callAliExpressApi<DsFreightRawResponse>(
      'aliexpress.ds.freight.query',
      {
        product_id: params.productId,
        product_num: params.quantity,
        ship_to_country: params.shipToCountry ?? 'US',
      },
      config,
    );

    const r = response.result;
    if (!r) {
      logger.debug({ productId: params.productId }, 'No DS freight options returned');
      return [];
    }

    if (r.error_code) {
      logger.warn(
        { productId: params.productId, errorCode: r.error_code, errorMsg: r.error_msg },
        'DS freight query API error',
      );
      return [];
    }

    return (r.freight_list ?? []).map((f) => ({
      serviceName: f.service_name,
      estimatedDeliveryTime: f.estimated_delivery_time,
      freightAmount: f.freight?.amount,
      freightCurrency: f.freight?.currency_code,
      trackingAvailable: f.tracking_available,
    }));
  } catch (err) {
    logger.error(
      { productId: params.productId, error: err instanceof Error ? err.message : String(err) },
      'Failed to query DS freight',
    );
    throw err;
  }
}

// ─── Trade / Logistics Methods ───

/**
 * Get full trade order details (buyer-side trade order).
 */
export async function getTradeOrderDetails(
  config: AliExpressAuthConfig,
  orderId: string,
): Promise<TradeOrderDetail | null> {
  try {
    const response = await callAliExpressApi<TradeOrderDetailRawResponse>(
      'aliexpress.trade.order.get',
      { order_id: orderId },
      config,
    );

    const r = response.result;
    if (!r) {
      logger.debug({ orderId }, 'No trade order detail returned');
      return null;
    }

    if (r.error_code) {
      logger.warn({ orderId, errorCode: r.error_code, errorMsg: r.error_msg }, 'Trade order detail API error');
      return null;
    }

    return {
      orderId: r.order_id,
      orderStatus: r.order_status,
      payAmount: r.pay_amount,
      payAmountCurrency: r.pay_amount_currency,
      createdAt: r.gmt_create,
      paidAt: r.gmt_pay_success,
      completedAt: r.gmt_trade_end,
      logisticsStatus: r.logistics_status,
      buyerInfo: r.buyer_info
        ? {
            name: r.buyer_info.name,
            country: r.buyer_info.country,
            address: r.buyer_info.address,
          }
        : undefined,
      childOrders: r.child_order_list?.map((c) => ({
        productId: c.product_id,
        productName: c.product_name,
        productCount: c.product_count,
        productPrice: c.product_price,
        trackingNumber: c.logistics_tracking_number,
        serviceName: c.logistics_service_name,
      })),
    };
  } catch (err) {
    logger.error(
      { orderId, error: err instanceof Error ? err.message : String(err) },
      'Failed to get trade order details',
    );
    throw err;
  }
}

/**
 * Get logistics/freight options for a product (buyer-side).
 */
export async function getLogisticsFreight(
  config: AliExpressAuthConfig,
  params: {
    productId: string;
    quantity: number;
    countryCode?: string;
  },
): Promise<FreightOption[]> {
  try {
    const response = await callAliExpressApi<LogisticsFreightRawResponse>(
      'aliexpress.logistics.buyer.freight.get',
      {
        product_id: params.productId,
        product_num: params.quantity,
        country_code: params.countryCode ?? 'US',
      },
      config,
    );

    const r = response.result;
    if (!r) {
      logger.debug({ productId: params.productId }, 'No logistics freight returned');
      return [];
    }

    if (r.error_code) {
      logger.warn(
        { productId: params.productId, errorCode: r.error_code, errorMsg: r.error_msg },
        'Logistics freight API error',
      );
      return [];
    }

    return (r.freight_list ?? []).map((f) => ({
      serviceName: f.service_name,
      estimatedDeliveryTime: f.estimated_delivery_time,
      freightAmount: f.freight_amount?.amount,
      freightCurrency: f.freight_amount?.currency_code,
      trackingAvailable: f.tracking_available,
    }));
  } catch (err) {
    logger.error(
      { productId: params.productId, error: err instanceof Error ? err.message : String(err) },
      'Failed to get logistics freight',
    );
    throw err;
  }
}
