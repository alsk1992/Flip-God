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

// ---- API Interface ----

export interface WalmartSellerApi {
  // Items
  getItem(sku: string): Promise<WalmartSellerItem | null>;
  getAllItems(params?: { limit?: number; offset?: number }): Promise<{ items: WalmartSellerItem[]; totalItems: number; nextCursor?: string }>;
  retireItem(sku: string): Promise<boolean>;

  // Pricing
  updatePrice(sku: string, price: number, currency?: string): Promise<WalmartFeedResponse>;
  bulkUpdatePrices(updates: Array<{ sku: string; price: number }>): Promise<WalmartFeedResponse>;

  // Inventory
  getInventory(sku: string): Promise<WalmartInventoryItem | null>;
  updateInventory(sku: string, quantity: number): Promise<WalmartFeedResponse>;

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

  // Feed status
  getFeedStatus(feedId: string): Promise<WalmartFeedResponse>;

  cancelOrder(purchaseOrderId: string, lineItems: WalmartCancelLineItem[]): Promise<boolean>;
  refundOrder(purchaseOrderId: string, lineItems: WalmartRefundLineItem[]): Promise<boolean>;

  // Returns
  getReturns(params?: { returnCreationStartDate?: string; limit?: number }): Promise<WalmartReturn[]>;
  getReturnOrder(returnOrderId: string): Promise<WalmartReturn | null>;

  // Bulk upload
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
      'Authorization': `Bearer ${accessToken}`,
      'WM_SVC.NAME': 'FlipAgent',
      'WM_QOS.CORRELATION_ID': `flipagent-${Date.now()}`,
      'Accept': 'application/json',
    };

    const init: RequestInit = { method: options?.method ?? 'GET', headers };
    if (options?.body) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, init);
    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, path, error: errorText }, 'Walmart Marketplace API request failed');
      throw new Error(`Walmart Marketplace API (${response.status}): ${errorText}`);
    }
    return response.json() as Promise<T>;
  }

  return {
    // --- Items ---
    async getItem(sku: string): Promise<WalmartSellerItem | null> {
      try {
        return await walmartFetch<WalmartSellerItem>(`/items/${encodeURIComponent(sku)}`);
      } catch (err) {
        logger.error({ sku, error: err instanceof Error ? err.message : String(err) }, 'Get item failed');
        return null;
      }
    },

    async getAllItems(params?): Promise<{ items: WalmartSellerItem[]; totalItems: number; nextCursor?: string }> {
      const query = new URLSearchParams();
      if (params?.limit) query.set('limit', String(params.limit));
      if (params?.offset) query.set('offset', String(params.offset));
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

    async bulkUpdatePrices(updates: Array<{ sku: string; price: number }>): Promise<WalmartFeedResponse> {
      const payload = {
        PriceFeed: {
          PriceHeader: { version: '1.5.1' },
          Price: updates.map(u => ({
            itemIdentifier: { sku: u.sku },
            pricingList: {
              pricing: [{
                currentPrice: { currency: 'USD', amount: u.price },
              }],
            },
          })),
        },
      };
      return walmartFetch<WalmartFeedResponse>('/price', { method: 'PUT', body: payload });
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

    // --- Orders ---
    async getOrders(params?): Promise<WalmartOrder[]> {
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

    async shipOrder(purchaseOrderId: string, shipment): Promise<boolean> {
      const payload = {
        orderShipment: {
          orderLines: {
            orderLine: shipment.lineItems.map((li: { lineNumber: string; quantity: number }) => ({
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
