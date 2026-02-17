/**
 * Walmart Marketplace Seller API
 *
 * Provides listing creation, inventory management, order handling,
 * and pricing for Walmart Marketplace sellers.
 *
 * Auth: OAuth 2.0 client_credentials → access token
 * Base: https://marketplace.walmartapis.com/v3/
 */

import { createLogger } from '../../utils/logger';
import { randomUUID } from 'crypto';
import type { WalmartCredentials } from '../../types';
import { getWalmartMarketplaceToken } from './auth';

const logger = createLogger('walmart-seller');

const API_BASE = 'https://marketplace.walmartapis.com/v3';

// ---- Types ----

export interface WalmartSellerItem {
  sku: string;
  productName?: string;
  price?: { currency: string; amount: number };
  publishedStatus?: string;
  lifecycleStatus?: string;
  availabilityStatus?: string;
}

export interface WalmartOrder {
  purchaseOrderId: string;
  customerOrderId: string;
  orderDate: string;
  shippingInfo: {
    phone: string;
    estimatedDeliveryDate: string;
    estimatedShipDate: string;
    methodCode: string;
    postalAddress: {
      name: string;
      address1: string;
      address2?: string;
      city: string;
      state: string;
      postalCode: string;
      country: string;
    };
  };
  orderLines: Array<{
    lineNumber: string;
    item: { productName: string; sku: string };
    charges: Array<{ chargeType: string; chargeAmount: { currency: string; amount: number } }>;
    orderLineQuantity: { unitOfMeasurement: string; amount: string };
    statusDate: number;
    orderLineStatuses: Array<{ status: string; statusQuantity: { unitOfMeasurement: string; amount: string } }>;
  }>;
}

export interface WalmartInventoryItem {
  sku: string;
  quantity: { unit: string; amount: number };
  fulfillmentLagTime?: number;
}

export interface WalmartFeedResponse {
  feedId: string;
  feedStatus?: string;
  itemsReceived?: number;
  itemsSucceeded?: number;
  itemsFailed?: number;
}

export interface WalmartCancelLineItem {
  lineNumber: string;
  quantity: number;
  reason: string;
}

export interface WalmartRefundLineItem {
  lineNumber: string;
  amount: number;
  reason: string;
  isFullRefund?: boolean;
}

export interface WalmartReturn {
  returnOrderId: string;
  customerOrderId?: string;
  returnOrderDate?: string;
  returnOrderLines?: Array<{
    returnOrderLineNumber: string;
    item?: { productName: string; sku: string };
    refundAmount?: { currency: string; amount: number };
    returnReason?: string;
    status?: string;
  }>;
}

export interface WalmartListingQualityItem {
  sku: string;
  productName?: string;
  score?: number;
  issues?: Array<{ issueType: string; issueDescription: string }>;
}

export interface WalmartCreateItemInput {
  sku: string;
  productName: string;
  price: number;
  currency?: string;
  description?: string;
  upc?: string;
  brand?: string;
  category?: string;
  images?: string[];
  shelfName?: string;
  shortDescription?: string;
  weight?: { value: number; unit: string };
  additionalAttributes?: Record<string, unknown>;
}

export interface WalmartFeedListResponse {
  feeds: Array<WalmartFeedResponse & { feedType?: string; feedDate?: string }>;
  totalResults?: number;
}

// ---- API Interface ----

export interface WalmartSellerApi {
  // Items
  createItem(item: WalmartCreateItemInput): Promise<WalmartFeedResponse>;
  updateItem(sku: string, updates: Partial<WalmartCreateItemInput>): Promise<WalmartFeedResponse>;
  getItem(sku: string): Promise<WalmartSellerItem | null>;
  getAllItems(params?: { limit?: number; offset?: number; nextCursor?: string }): Promise<{ items: WalmartSellerItem[]; totalItems: number; nextCursor?: string }>;
  retireItem(sku: string): Promise<boolean>;
  bulkUpdateItems(feedType: string, items: unknown[]): Promise<WalmartFeedResponse>;

  // Pricing
  updatePrice(sku: string, price: number, currency?: string): Promise<WalmartFeedResponse>;
  bulkUpdatePrices(items: Array<{ sku: string; price: number; currency?: string }>): Promise<WalmartFeedResponse>;

  // Inventory
  getInventory(sku: string): Promise<WalmartInventoryItem | null>;
  updateInventory(sku: string, quantity: number): Promise<WalmartFeedResponse>;
  bulkUpdateInventory(items: Array<{ sku: string; quantity: number }>): Promise<WalmartFeedResponse>;

  // Orders
  getOrders(params?: { createdStartDate?: string; status?: string; limit?: number }): Promise<WalmartOrder[]>;
  getOrder(purchaseOrderId: string): Promise<WalmartOrder | null>;
  acknowledgeOrder(purchaseOrderId: string): Promise<boolean>;
  shipOrder(purchaseOrderId: string, shipment: {
    lineItems: Array<{ lineNumber: string; quantity: number }>;
    carrier: string;
    trackingNumber: string;
    trackingUrl?: string;
    methodCode: string;
  }): Promise<boolean>;
  cancelOrder(purchaseOrderId: string, lineItems: WalmartCancelLineItem[]): Promise<boolean>;
  refundOrder(purchaseOrderId: string, lineItems: WalmartRefundLineItem[]): Promise<boolean>;

  // Feed status
  getFeedStatus(feedId: string): Promise<WalmartFeedResponse>;
  getAllFeeds(params?: { feedType?: string; limit?: number; offset?: number }): Promise<WalmartFeedListResponse>;

  // Returns
  getReturns(params?: { returnCreationStartDate?: string; limit?: number }): Promise<WalmartReturn[]>;
  getReturnOrder(returnOrderId: string): Promise<WalmartReturn | null>;

  // Bulk upload (legacy alias — prefer bulkUpdateItems)
  bulkItemUpload(feedType: string, items: unknown[]): Promise<WalmartFeedResponse>;

  // Insights
  getListingQuality(params?: { limit?: number; nextCursor?: string }): Promise<{ items: WalmartListingQualityItem[]; nextCursor?: string }>;
}

// ---- Factory ----

export function createWalmartSellerApi(credentials: WalmartCredentials): WalmartSellerApi {
  async function walmartFetch<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
    const accessToken = await getWalmartMarketplaceToken({ clientId: credentials.clientId, clientSecret: credentials.clientSecret });
    const url = `${API_BASE}${path}`;
    const headers: Record<string, string> = {
      'WM_SEC.ACCESS_TOKEN': accessToken,
      'WM_SVC.NAME': 'FlipGod',
      'WM_QOS.CORRELATION_ID': randomUUID(),
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };

    const init: RequestInit = { method: options?.method ?? 'GET', headers };
    if (options?.body) {
      init.body = JSON.stringify(options.body);
    }

    init.signal = AbortSignal.timeout(30_000);
    const response = await fetch(url, init);
    if (!response.ok) {
      const errorText = (await response.text().catch(() => '')).slice(0, 200);
      logger.error({ status: response.status, path }, 'Walmart Marketplace API request failed');
      throw new Error(`Walmart Marketplace API (${response.status}): ${errorText}`);
    }
    return response.json() as Promise<T>;
  }

  return {
    // --- Items ---
    async createItem(item: WalmartCreateItemInput): Promise<WalmartFeedResponse> {
      const payload = {
        MPItemFeed: {
          MPItemFeedHeader: { version: '3.2', requestId: randomUUID(), requestBatchId: randomUUID() },
          MPItem: [{
            sku: item.sku,
            productIdentifiers: item.upc ? { productIdType: 'UPC', productId: item.upc } : undefined,
            MPProduct: {
              productName: item.productName,
              shortDescription: item.shortDescription ?? item.description ?? '',
              mainImageUrl: item.images?.[0] ?? '',
              additionalImages: item.images?.slice(1)?.map(url => ({ url })),
              brand: item.brand,
              category: item.category,
              shelfName: item.shelfName ?? item.category,
              ...(item.additionalAttributes ?? {}),
            },
            MPOffer: {
              price: item.price,
              currency: item.currency ?? 'USD',
              StartDate: new Date().toISOString().split('T')[0],
              ShippingWeight: item.weight ? `${item.weight.value} ${item.weight.unit}` : undefined,
            },
          }],
        },
      };
      const result = await walmartFetch<WalmartFeedResponse>('/feeds?feedType=item', { method: 'POST', body: payload });
      logger.info({ sku: item.sku, feedId: result.feedId }, 'Item creation submitted via feed');
      return result;
    },

    async updateItem(sku: string, updates: Partial<WalmartCreateItemInput>): Promise<WalmartFeedResponse> {
      const mpProduct: Record<string, unknown> = {};
      if (updates.productName) mpProduct.productName = updates.productName;
      if (updates.description) mpProduct.shortDescription = updates.description;
      if (updates.shortDescription) mpProduct.shortDescription = updates.shortDescription;
      if (updates.brand) mpProduct.brand = updates.brand;
      if (updates.category) mpProduct.category = updates.category;
      if (updates.images?.length) {
        mpProduct.mainImageUrl = updates.images[0];
        if (updates.images.length > 1) {
          mpProduct.additionalImages = updates.images.slice(1).map(url => ({ url }));
        }
      }
      if (updates.additionalAttributes) {
        Object.assign(mpProduct, updates.additionalAttributes);
      }

      const mpOffer: Record<string, unknown> = {};
      if (updates.price != null) mpOffer.price = updates.price;
      if (updates.currency) mpOffer.currency = updates.currency;
      if (updates.weight) mpOffer.ShippingWeight = `${updates.weight.value} ${updates.weight.unit}`;

      const payload = {
        MPItemFeed: {
          MPItemFeedHeader: { version: '3.2', requestId: randomUUID(), requestBatchId: randomUUID() },
          MPItem: [{
            sku,
            productIdentifiers: updates.upc ? { productIdType: 'UPC', productId: updates.upc } : undefined,
            MPProduct: Object.keys(mpProduct).length > 0 ? mpProduct : undefined,
            MPOffer: Object.keys(mpOffer).length > 0 ? mpOffer : undefined,
          }],
        },
      };
      const result = await walmartFetch<WalmartFeedResponse>('/feeds?feedType=item', { method: 'POST', body: payload });
      logger.info({ sku, feedId: result.feedId }, 'Item update submitted via feed');
      return result;
    },

    async getItem(sku: string): Promise<WalmartSellerItem | null> {
      try {
        return await walmartFetch<WalmartSellerItem>(`/items/${encodeURIComponent(sku)}`);
      } catch (err) {
        logger.error({ sku, error: err instanceof Error ? err.message : String(err) }, 'Get item failed');
        return null;
      }
    },

    async getAllItems(params?: { limit?: number; offset?: number; nextCursor?: string }): Promise<{ items: WalmartSellerItem[]; totalItems: number; nextCursor?: string }> {
      const query = new URLSearchParams();
      if (params?.limit) query.set('limit', String(params.limit));
      if (params?.offset) query.set('offset', String(params.offset));
      if (params?.nextCursor) query.set('nextCursor', params.nextCursor);
      const qs = query.toString() ? `?${query.toString()}` : '';

      try {
        const data = await walmartFetch<{
          ItemResponse?: Array<{ items?: { item: WalmartSellerItem[] }; totalItems?: number; nextCursor?: string }>;
        }>(`/items${qs}`);
        const resp = data.ItemResponse?.[0];
        return {
          items: resp?.items?.item ?? [],
          totalItems: resp?.totalItems ?? 0,
          nextCursor: resp?.nextCursor,
        };
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Get all items failed');
        return { items: [], totalItems: 0 };
      }
    },

    async retireItem(sku: string): Promise<boolean> {
      try {
        await walmartFetch(`/items/${encodeURIComponent(sku)}`, { method: 'DELETE' });
        return true;
      } catch (err) {
        logger.error({ sku, error: err instanceof Error ? err.message : String(err) }, 'Retire item failed');
        return false;
      }
    },

    async bulkUpdateItems(feedType: string, items: unknown[]): Promise<WalmartFeedResponse> {
      try {
        const payload = { items };
        const result = await walmartFetch<WalmartFeedResponse>(
          `/feeds?feedType=${encodeURIComponent(feedType)}`,
          { method: 'POST', body: payload },
        );
        logger.info({ feedType, feedId: result.feedId, itemCount: items.length }, 'Bulk item update submitted');
        return result;
      } catch (err) {
        logger.error({ feedType, error: err instanceof Error ? err.message : String(err) }, 'Bulk item update failed');
        throw err;
      }
    },

    // --- Pricing ---
    async updatePrice(sku: string, price: number, currency = 'USD'): Promise<WalmartFeedResponse> {
      const payload = {
        sku,
        pricing: [{
          currentPrice: { currency, amount: price },
        }],
      };
      return walmartFetch<WalmartFeedResponse>('/price', { method: 'PUT', body: payload });
    },

    async bulkUpdatePrices(items: Array<{ sku: string; price: number; currency?: string }>): Promise<WalmartFeedResponse> {
      const payload = {
        PriceFeed: {
          PriceHeader: { version: '1.5.1' },
          Price: items.map(u => ({
            itemIdentifier: { sku: u.sku },
            pricingList: {
              pricing: [{
                currentPrice: { currency: u.currency ?? 'USD', amount: u.price },
              }],
            },
          })),
        },
      };
      const result = await walmartFetch<WalmartFeedResponse>('/feeds?feedType=price', { method: 'POST', body: payload });
      logger.info({ feedId: result.feedId, itemCount: items.length }, 'Bulk price update submitted via feed');
      return result;
    },

    // --- Inventory ---
    async getInventory(sku: string): Promise<WalmartInventoryItem | null> {
      try {
        const data = await walmartFetch<{ sku: string; quantity: { unit: string; amount: number }; fulfillmentLagTime?: number }>(
          `/inventory?sku=${encodeURIComponent(sku)}`,
        );
        return { sku: data.sku, quantity: data.quantity, fulfillmentLagTime: data.fulfillmentLagTime };
      } catch (err) {
        logger.error({ sku, error: err instanceof Error ? err.message : String(err) }, 'Get inventory failed');
        return null;
      }
    },

    async updateInventory(sku: string, quantity: number): Promise<WalmartFeedResponse> {
      const payload = {
        sku,
        quantity: { unit: 'EACH', amount: quantity },
      };
      return walmartFetch<WalmartFeedResponse>(`/inventory?sku=${encodeURIComponent(sku)}`, { method: 'PUT', body: payload });
    },

    async bulkUpdateInventory(items: Array<{ sku: string; quantity: number }>): Promise<WalmartFeedResponse> {
      const payload = {
        InventoryFeed: {
          InventoryHeader: { version: '1.4' },
          Inventory: items.map(item => ({
            sku: item.sku,
            quantity: { unit: 'EACH', amount: item.quantity },
          })),
        },
      };
      const result = await walmartFetch<WalmartFeedResponse>('/feeds?feedType=inventory', { method: 'POST', body: payload });
      logger.info({ feedId: result.feedId, itemCount: items.length }, 'Bulk inventory update submitted via feed');
      return result;
    },

    // --- Orders ---
    async getOrders(params?: { createdStartDate?: string; status?: string; limit?: number }): Promise<WalmartOrder[]> {
      const query = new URLSearchParams();
      if (params?.createdStartDate) query.set('createdStartDate', params.createdStartDate);
      if (params?.status) query.set('status', params.status);
      query.set('limit', String(params?.limit ?? 50));

      try {
        const data = await walmartFetch<{
          list?: { elements?: { order?: WalmartOrder[] } };
        }>(`/orders?${query.toString()}`);
        return data.list?.elements?.order ?? [];
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Get orders failed');
        return [];
      }
    },

    async getOrder(purchaseOrderId: string): Promise<WalmartOrder | null> {
      try {
        const data = await walmartFetch<{ order?: WalmartOrder[] }>(`/orders/${encodeURIComponent(purchaseOrderId)}`);
        return data.order?.[0] ?? null;
      } catch (err) {
        logger.error({ purchaseOrderId, error: err instanceof Error ? err.message : String(err) }, 'Get order failed');
        return null;
      }
    },

    async acknowledgeOrder(purchaseOrderId: string): Promise<boolean> {
      try {
        await walmartFetch(`/orders/${encodeURIComponent(purchaseOrderId)}/acknowledge`, { method: 'POST' });
        return true;
      } catch (err) {
        logger.error({ purchaseOrderId, error: err instanceof Error ? err.message : String(err) }, 'Acknowledge order failed');
        return false;
      }
    },

    async shipOrder(purchaseOrderId: string, shipment: {
      lineItems: Array<{ lineNumber: string; quantity: number }>;
      carrier: string;
      trackingNumber: string;
      trackingUrl?: string;
      methodCode: string;
    }): Promise<boolean> {
      const payload = {
        orderShipment: {
          orderLines: {
            orderLine: shipment.lineItems.map((li) => ({
              lineNumber: li.lineNumber,
              orderLineStatuses: {
                orderLineStatus: [{
                  status: 'Shipped',
                  statusQuantity: { unitOfMeasurement: 'EACH', amount: String(li.quantity) },
                  trackingInfo: {
                    shipDateTime: new Date().toISOString(),
                    carrierName: { carrier: shipment.carrier },
                    methodCode: shipment.methodCode,
                    trackingNumber: shipment.trackingNumber,
                    trackingURL: shipment.trackingUrl ?? '',
                  },
                }],
              },
            })),
          },
        },
      };
      try {
        await walmartFetch(`/orders/${encodeURIComponent(purchaseOrderId)}/shipping`, { method: 'POST', body: payload });
        return true;
      } catch (err) {
        logger.error({ purchaseOrderId, error: err instanceof Error ? err.message : String(err) }, 'Ship order failed');
        return false;
      }
    },


    async cancelOrder(purchaseOrderId: string, lineItems: WalmartCancelLineItem[]): Promise<boolean> {
      const payload = {
        orderCancellation: {
          orderLines: {
            orderLine: lineItems.map(li => ({
              lineNumber: li.lineNumber,
              orderLineStatuses: {
                orderLineStatus: [{
                  status: 'Cancelled',
                  cancellationReason: li.reason,
                  statusQuantity: { unitOfMeasurement: 'EACH', amount: String(li.quantity) },
                }],
              },
            })),
          },
        },
      };
      try {
        await walmartFetch(`/orders/${encodeURIComponent(purchaseOrderId)}/cancel`, { method: 'POST', body: payload });
        logger.info({ purchaseOrderId, lines: lineItems.length }, 'Order cancelled');
        return true;
      } catch (err) {
        logger.error({ purchaseOrderId, error: err instanceof Error ? err.message : String(err) }, 'Cancel order failed');
        return false;
      }
    },

    async refundOrder(purchaseOrderId: string, lineItems: WalmartRefundLineItem[]): Promise<boolean> {
      const payload = {
        orderRefund: {
          orderLines: {
            orderLine: lineItems.map(li => ({
              lineNumber: li.lineNumber,
              isFullRefund: li.isFullRefund ?? false,
              refunds: {
                refund: [{
                  refundComments: li.reason,
                  refundCharges: {
                    refundCharge: [{
                      refundReason: li.reason,
                      charge: {
                        chargeType: 'PRODUCT',
                        chargeName: 'Item Price',
                        chargeAmount: { currency: 'USD', amount: li.amount },
                      },
                    }],
                  },
                }],
              },
            })),
          },
        },
      };
      try {
        await walmartFetch(`/orders/${encodeURIComponent(purchaseOrderId)}/refund`, { method: 'POST', body: payload });
        logger.info({ purchaseOrderId, lines: lineItems.length }, 'Order refunded');
        return true;
      } catch (err) {
        logger.error({ purchaseOrderId, error: err instanceof Error ? err.message : String(err) }, 'Refund order failed');
        return false;
      }
    },

    // --- Returns ---
    async getReturns(params?: { returnCreationStartDate?: string; limit?: number }): Promise<WalmartReturn[]> {
      const query = new URLSearchParams();
      if (params?.returnCreationStartDate) query.set('returnCreationStartDate', params.returnCreationStartDate);
      query.set('limit', String(params?.limit ?? 50));
      try {
        const data = await walmartFetch<{ returnOrders?: WalmartReturn[] }>(`/returns?${query.toString()}`);
        return data.returnOrders ?? [];
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Get returns failed');
        return [];
      }
    },

    async getReturnOrder(returnOrderId: string): Promise<WalmartReturn | null> {
      try {
        return await walmartFetch<WalmartReturn>(`/returns/${encodeURIComponent(returnOrderId)}`);
      } catch (err) {
        logger.error({ returnOrderId, error: err instanceof Error ? err.message : String(err) }, 'Get return order failed');
        return null;
      }
    },
    // --- Feed Status ---
    async getFeedStatus(feedId: string): Promise<WalmartFeedResponse> {
      return walmartFetch<WalmartFeedResponse>(`/feeds/${encodeURIComponent(feedId)}`);
    },

    async getAllFeeds(params?: { feedType?: string; limit?: number; offset?: number }): Promise<WalmartFeedListResponse> {
      const query = new URLSearchParams();
      if (params?.feedType) query.set('feedType', params.feedType);
      query.set('limit', String(params?.limit ?? 50));
      if (params?.offset) query.set('offset', String(params.offset));
      try {
        const data = await walmartFetch<{
          results?: Array<WalmartFeedResponse & { feedType?: string; feedDate?: string }>;
          totalResults?: number;
        }>(`/feeds?${query.toString()}`);
        return {
          feeds: data.results ?? [],
          totalResults: data.totalResults,
        };
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Get all feeds failed');
        return { feeds: [] };
      }
    },

    async bulkItemUpload(feedType: string, items: unknown[]): Promise<WalmartFeedResponse> {
      try {
        const payload = { items };
        const result = await walmartFetch<WalmartFeedResponse>(
          `/feeds?feedType=${encodeURIComponent(feedType)}`,
          { method: 'POST', body: payload },
        );
        logger.info({ feedType, feedId: result.feedId, itemCount: items.length }, 'Bulk item upload submitted');
        return result;
      } catch (err) {
        logger.error({ feedType, error: err instanceof Error ? err.message : String(err) }, 'Bulk item upload failed');
        throw err;
      }
    },

    // --- Insights ---
    async getListingQuality(params?: { limit?: number; nextCursor?: string }): Promise<{ items: WalmartListingQualityItem[]; nextCursor?: string }> {
      const query = new URLSearchParams();
      query.set('limit', String(params?.limit ?? 50));
      if (params?.nextCursor) query.set('nextCursor', params.nextCursor);
      try {
        const data = await walmartFetch<{
          payload?: WalmartListingQualityItem[];
          nextCursor?: string;
        }>(`/insights/items/listingQuality/score?${query.toString()}`);
        return {
          items: data.payload ?? [],
          nextCursor: data.nextCursor,
        };
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Get listing quality failed');
        return { items: [] };
      }
    },
  };
}

export { clearWalmartMarketplaceTokenCache as clearWalmartSellerTokenCache } from './auth';
