/**
 * FBA Multi-Channel Fulfillment (MCF)
 *
 * Uses Amazon SP-API to create outbound fulfillment orders from FBA inventory.
 * Enables fulfilling orders from other channels (eBay, Walmart, etc.)
 * using inventory stored at Amazon FBA warehouses.
 */

import { createLogger } from '../utils/logger';
import type { SpApiAuthConfig } from '../platforms/amazon/sp-auth';
import { getSpApiToken, SP_API_ENDPOINTS, MARKETPLACE_IDS } from '../platforms/amazon/sp-auth';

const logger = createLogger('fba-mcf');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FbaAddress {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateOrRegion: string;
  postalCode: string;
  countryCode: string;
  phone?: string;
}

export interface FbaFulfillmentItem {
  sellerSku: string;
  sellerFulfillmentOrderItemId: string;
  quantity: number;
  perUnitDeclaredValue?: { currencyCode: string; value: string };
}

export type FbaShippingSpeed = 'Standard' | 'Expedited' | 'Priority';

export interface CreateFbaFulfillmentOrderParams {
  sellerFulfillmentOrderId: string;
  displayableOrderId: string;
  displayableOrderDate: string;
  displayableOrderComment: string;
  shippingSpeedCategory: FbaShippingSpeed;
  destinationAddress: FbaAddress;
  items: FbaFulfillmentItem[];
  notificationEmails?: string[];
}

export interface FbaFulfillmentOrder {
  sellerFulfillmentOrderId: string;
  displayableOrderId: string;
  displayableOrderDate: string;
  shippingSpeedCategory: string;
  fulfillmentOrderStatus: string;
  statusUpdatedDate: string;
  destinationAddress: FbaAddress;
  fulfillmentAction?: string;
  receivedDate?: string;
}

export interface FbaFulfillmentShipment {
  amazonShipmentId: string;
  fulfillmentCenterId: string;
  fulfillmentShipmentStatus: string;
  shippingDate?: string;
  estimatedArrivalDate?: string;
  trackingNumber?: string;
  fulfillmentShipmentPackage?: Array<{
    packageNumber: number;
    carrierCode: string;
    trackingNumber?: string;
  }>;
}

export interface FbaFulfillmentOrderResult {
  fulfillmentOrder: FbaFulfillmentOrder;
  fulfillmentOrderItems: Array<{
    sellerSku: string;
    sellerFulfillmentOrderItemId: string;
    quantity: number;
    cancelledQuantity: number;
    unfulfillableQuantity: number;
  }>;
  fulfillmentShipments: FbaFulfillmentShipment[];
}

export interface FbaInventorySummary {
  asin: string;
  fnSku: string;
  sellerSku: string;
  condition: string;
  totalQuantity: number;
  inventoryDetails?: {
    fulfillableQuantity?: number;
    inboundWorkingQuantity?: number;
    inboundShippedQuantity?: number;
    inboundReceivingQuantity?: number;
    reservedQuantity?: number;
  };
}

// ---------------------------------------------------------------------------
// API Client
// ---------------------------------------------------------------------------

export interface FbaMcfApi {
  /**
   * Create an outbound MCF fulfillment order from FBA inventory.
   * This ships from Amazon FBA warehouse to the destination address.
   */
  createFulfillmentOrder(params: CreateFbaFulfillmentOrderParams): Promise<{ status: string }>;

  /**
   * Get the status of an existing MCF fulfillment order.
   */
  getFulfillmentOrder(sellerFulfillmentOrderId: string): Promise<FbaFulfillmentOrderResult | null>;

  /**
   * Check FBA inventory levels for given seller SKUs.
   */
  getInventory(sellerSkus?: string[]): Promise<{
    summaries: FbaInventorySummary[];
    nextToken?: string;
  }>;
}

export function createFbaMcfApi(config: SpApiAuthConfig): FbaMcfApi {
  const endpoint = config.endpoint ?? SP_API_ENDPOINTS.NA;
  const marketplaceId = config.marketplaceId ?? MARKETPLACE_IDS.US;

  async function spFetch<T>(path: string, options?: {
    method?: string;
    body?: unknown;
    params?: Record<string, string>;
  }): Promise<T> {
    const token = await getSpApiToken(config);
    const url = new URL(path, endpoint);
    if (options?.params) {
      for (const [k, v] of Object.entries(options.params)) {
        url.searchParams.set(k, v);
      }
    }

    const headers: Record<string, string> = {
      'x-amz-access-token': token,
      'Content-Type': 'application/json',
    };

    const fetchOptions: RequestInit = {
      method: options?.method ?? 'GET',
      headers,
    };

    if (options?.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, path, error: errorText }, 'FBA MCF API request failed');
      throw new Error(`FBA MCF API (${response.status}): ${errorText}`);
    }

    if (response.status === 204 || response.status === 200 && response.headers.get('content-length') === '0') {
      return {} as T;
    }
    return response.json() as Promise<T>;
  }

  return {
    async createFulfillmentOrder(params: CreateFbaFulfillmentOrderParams): Promise<{ status: string }> {
      logger.info(
        { orderId: params.sellerFulfillmentOrderId, itemCount: params.items.length, speed: params.shippingSpeedCategory },
        'Creating FBA MCF fulfillment order',
      );

      const body = {
        sellerFulfillmentOrderId: params.sellerFulfillmentOrderId,
        displayableOrderId: params.displayableOrderId,
        displayableOrderDate: params.displayableOrderDate,
        displayableOrderComment: params.displayableOrderComment,
        shippingSpeedCategory: params.shippingSpeedCategory,
        destinationAddress: {
          name: params.destinationAddress.name,
          addressLine1: params.destinationAddress.addressLine1,
          addressLine2: params.destinationAddress.addressLine2,
          city: params.destinationAddress.city,
          stateOrRegion: params.destinationAddress.stateOrRegion,
          postalCode: params.destinationAddress.postalCode,
          countryCode: params.destinationAddress.countryCode,
          phone: params.destinationAddress.phone,
        },
        items: params.items.map(item => ({
          sellerSku: item.sellerSku,
          sellerFulfillmentOrderItemId: item.sellerFulfillmentOrderItemId,
          quantity: item.quantity,
          perUnitDeclaredValue: item.perUnitDeclaredValue,
        })),
        notificationEmails: params.notificationEmails,
        fulfillmentAction: 'Ship',
        marketplaceId,
      };

      await spFetch<void>('/fba/outbound/2020-07-01/fulfillmentOrders', {
        method: 'POST',
        body,
      });

      logger.info({ orderId: params.sellerFulfillmentOrderId }, 'FBA MCF fulfillment order created');
      return { status: 'created' };
    },

    async getFulfillmentOrder(sellerFulfillmentOrderId: string): Promise<FbaFulfillmentOrderResult | null> {
      logger.info({ orderId: sellerFulfillmentOrderId }, 'Getting FBA MCF fulfillment order');

      try {
        const data = await spFetch<{
          payload?: {
            fulfillmentOrder?: {
              sellerFulfillmentOrderId: string;
              displayableOrderId: string;
              displayableOrderDate: string;
              shippingSpeedCategory: string;
              fulfillmentOrderStatus: string;
              statusUpdatedDate: string;
              destinationAddress: FbaAddress;
              fulfillmentAction?: string;
              receivedDate?: string;
            };
            fulfillmentOrderItems?: Array<{
              sellerSku: string;
              sellerFulfillmentOrderItemId: string;
              quantity: number;
              cancelledQuantity: number;
              unfulfillableQuantity: number;
            }>;
            fulfillmentShipments?: Array<{
              amazonShipmentId: string;
              fulfillmentCenterId: string;
              fulfillmentShipmentStatus: string;
              shippingDate?: string;
              estimatedArrivalDate?: string;
              fulfillmentShipmentPackage?: Array<{
                packageNumber: number;
                carrierCode: string;
                trackingNumber?: string;
              }>;
            }>;
          };
        }>(`/fba/outbound/2020-07-01/fulfillmentOrders/${encodeURIComponent(sellerFulfillmentOrderId)}`);

        const payload = data.payload;
        if (!payload?.fulfillmentOrder) return null;

        const order = payload.fulfillmentOrder;
        const shipments: FbaFulfillmentShipment[] = (payload.fulfillmentShipments ?? []).map(s => ({
          amazonShipmentId: s.amazonShipmentId,
          fulfillmentCenterId: s.fulfillmentCenterId,
          fulfillmentShipmentStatus: s.fulfillmentShipmentStatus,
          shippingDate: s.shippingDate,
          estimatedArrivalDate: s.estimatedArrivalDate,
          fulfillmentShipmentPackage: s.fulfillmentShipmentPackage,
        }));

        return {
          fulfillmentOrder: {
            sellerFulfillmentOrderId: order.sellerFulfillmentOrderId,
            displayableOrderId: order.displayableOrderId,
            displayableOrderDate: order.displayableOrderDate,
            shippingSpeedCategory: order.shippingSpeedCategory,
            fulfillmentOrderStatus: order.fulfillmentOrderStatus,
            statusUpdatedDate: order.statusUpdatedDate,
            destinationAddress: order.destinationAddress,
            fulfillmentAction: order.fulfillmentAction,
            receivedDate: order.receivedDate,
          },
          fulfillmentOrderItems: payload.fulfillmentOrderItems ?? [],
          fulfillmentShipments: shipments,
        };
      } catch (err) {
        logger.error(
          { orderId: sellerFulfillmentOrderId, error: err instanceof Error ? err.message : String(err) },
          'getFulfillmentOrder failed',
        );
        return null;
      }
    },

    async getInventory(sellerSkus?: string[]): Promise<{
      summaries: FbaInventorySummary[];
      nextToken?: string;
    }> {
      logger.info({ skuCount: sellerSkus?.length ?? 'all' }, 'Getting FBA inventory');

      const queryParams: Record<string, string> = {
        granularityType: 'Marketplace',
        granularityId: marketplaceId,
        marketplaceIds: marketplaceId,
        details: 'true',
      };

      if (sellerSkus?.length) {
        queryParams.sellerSkus = sellerSkus.join(',');
      }

      const data = await spFetch<{
        payload?: {
          inventorySummaries?: Array<{
            asin: string;
            fnSku: string;
            sellerSku: string;
            condition: string;
            totalQuantity: number;
            inventoryDetails?: {
              fulfillableQuantity?: number;
              inboundWorkingQuantity?: number;
              inboundShippedQuantity?: number;
              inboundReceivingQuantity?: number;
              reservedQuantity?: number;
            };
          }>;
        };
        pagination?: { nextToken?: string };
      }>('/fba/inventory/v1/summaries', { params: queryParams });

      const summaries: FbaInventorySummary[] = (data.payload?.inventorySummaries ?? []).map(s => ({
        asin: s.asin,
        fnSku: s.fnSku,
        sellerSku: s.sellerSku,
        condition: s.condition,
        totalQuantity: s.totalQuantity,
        inventoryDetails: s.inventoryDetails,
      }));

      return {
        summaries,
        nextToken: data.pagination?.nextToken,
      };
    },
  };
}
