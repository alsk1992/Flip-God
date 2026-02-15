/**
 * Amazon SP-API Extended Methods
 *
 * Additional Selling Partner API endpoints beyond the core set in sp-api.ts:
 * - Listings Restrictions (gating checks for arbitrage)
 * - Listings Item retrieval & search
 * - Order shipment confirmation & address
 * - Multi-Channel Fulfillment (MCF) - preview, create, track, cancel
 * - Notifications - destinations & subscriptions
 * - Reports - create, poll status, download
 * - Feeds - upload documents, create feeds, poll status
 * - Finances - financial events for reconciliation
 * - Shipping v2 - rates, purchase labels, tracking
 * - Product Pricing - list prices, featured offer expected price
 */

import { createLogger } from '../../utils/logger.js';
import type { SpApiAuthConfig } from './sp-auth.js';
import { getSpApiToken, SP_API_ENDPOINTS, MARKETPLACE_IDS } from './sp-auth.js';

const logger = createLogger('amazon-sp-api-extended');

// ---------------------------------------------------------------------------
// Types - Listings Restrictions
// ---------------------------------------------------------------------------

export interface ListingRestrictionReason {
  message: string;
  reasonCode?: string;
  links?: Array<{ resource: string; verb: string; title?: string; type?: string }>;
}

export interface ListingRestriction {
  marketplaceId: string;
  conditionType?: string;
  reasons?: ListingRestrictionReason[];
}

export interface GetListingsRestrictionsResponse {
  restrictions: ListingRestriction[];
}

// ---------------------------------------------------------------------------
// Types - Listings Items
// ---------------------------------------------------------------------------

export interface ListingsItemSummary {
  marketplaceId: string;
  asin?: string;
  productType?: string;
  conditionType?: string;
  status?: string[];
  itemName?: string;
  createdDate?: string;
  lastUpdatedDate?: string;
  mainImage?: { link: string; height: number; width: number };
}

export interface ListingsItemIssue {
  code: string;
  message: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  attributeNames?: string[];
}

export interface ListingsItemOffer {
  marketplaceId: string;
  offerType: string;
  price: { currencyCode: string; amount: number };
  points?: { pointsNumber: number };
}

export interface ListingsItemFulfillmentAvailability {
  fulfillmentChannelCode: string;
  quantity?: number;
}

export interface ListingsItemDetail {
  sku: string;
  summaries?: ListingsItemSummary[];
  attributes?: Record<string, unknown>;
  issues?: ListingsItemIssue[];
  offers?: ListingsItemOffer[];
  fulfillmentAvailability?: ListingsItemFulfillmentAvailability[];
}

export interface SearchListingsItemsResponse {
  items: ListingsItemDetail[];
  numberOfResults?: number;
  pagination?: { nextToken?: string; previousToken?: string };
}

// ---------------------------------------------------------------------------
// Types - Order Shipment Confirmation
// ---------------------------------------------------------------------------

export interface ConfirmShipmentOrderItem {
  orderItemId: string;
  quantity: number;
}

export interface ConfirmShipmentParams {
  packageReferenceId: string;
  carrierCode: string;
  trackingNumber: string;
  shipDate: string;
  shippingMethod?: string;
  orderItems: ConfirmShipmentOrderItem[];
}

// ---------------------------------------------------------------------------
// Types - Order Address
// ---------------------------------------------------------------------------

export interface OrderAddress {
  name?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressLine3?: string;
  city?: string;
  county?: string;
  district?: string;
  stateOrRegion?: string;
  postalCode?: string;
  countryCode?: string;
  phone?: string;
  addressType?: string;
}

export interface GetOrderAddressResponse {
  amazonOrderId: string;
  shippingAddress?: OrderAddress;
}

// ---------------------------------------------------------------------------
// Types - Multi-Channel Fulfillment (MCF)
// ---------------------------------------------------------------------------

export interface McfAddress {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  addressLine3?: string;
  city: string;
  stateOrRegion: string;
  postalCode: string;
  countryCode: string;
  phone?: string;
}

export interface McfPreviewItem {
  sellerSku: string;
  quantity: number;
  sellerFulfillmentOrderItemId?: string;
}

export interface McfFulfillmentPreview {
  shippingSpeedCategory: string;
  isFulfillable: boolean;
  isCODCapable?: boolean;
  estimatedShippingWeight?: { value: number; unit: string };
  estimatedFees?: Array<{ name: string; amount: { currencyCode: string; value: string } }>;
  fulfillmentPreviewShipments?: Array<{
    earliestShipDate?: string;
    latestShipDate?: string;
    earliestArrivalDate?: string;
    latestArrivalDate?: string;
    fulfillmentPreviewItems?: Array<{ sellerSku: string; quantity: number; shippingWeightCalculationMethod?: string }>;
  }>;
  unfulfillablePreviewItems?: Array<{ sellerSku: string; quantity: number; itemUnfulfillableReasons?: string[] }>;
}

export interface GetFulfillmentPreviewResponse {
  fulfillmentPreviews?: McfFulfillmentPreview[];
}

export interface CreateFulfillmentOrderParams {
  sellerFulfillmentOrderId: string;
  displayableOrderId: string;
  displayableOrderDate: string;
  displayableOrderComment: string;
  shippingSpeedCategory: 'Standard' | 'Expedited' | 'Priority';
  destinationAddress: McfAddress;
  items: Array<{
    sellerSku: string;
    sellerFulfillmentOrderItemId: string;
    quantity: number;
  }>;
  fulfillmentAction?: 'Ship' | 'Hold';
  fulfillmentPolicy?: 'FillOrKill' | 'FillAll' | 'FillAllAvailable';
  notificationEmails?: string[];
}

export interface FulfillmentOrder {
  sellerFulfillmentOrderId: string;
  displayableOrderId: string;
  displayableOrderDate: string;
  displayableOrderComment: string;
  shippingSpeedCategory: string;
  destinationAddress: McfAddress;
  fulfillmentOrderStatus: string;
  statusUpdatedDate?: string;
  receivedDate?: string;
  fulfillmentOrderItems?: Array<{
    sellerSku: string;
    sellerFulfillmentOrderItemId: string;
    quantity: number;
    cancelledQuantity?: number;
    unfulfillableQuantity?: number;
    estimatedShipDate?: string;
    estimatedArrivalDate?: string;
  }>;
  fulfillmentShipments?: Array<{
    amazonShipmentId: string;
    fulfillmentCenterId: string;
    fulfillmentShipmentStatus: string;
    shippingDate?: string;
    estimatedArrivalDate?: string;
    fulfillmentShipmentPackages?: Array<{
      packageNumber: number;
      carrierCode: string;
      trackingNumber?: string;
    }>;
  }>;
}

export interface GetFulfillmentOrderResponse {
  fulfillmentOrder?: FulfillmentOrder;
  fulfillmentOrderItems?: FulfillmentOrder['fulfillmentOrderItems'];
  fulfillmentShipments?: FulfillmentOrder['fulfillmentShipments'];
}

export interface PackageTrackingDetails {
  packageNumber: number;
  trackingNumber?: string;
  carrierCode?: string;
  carrierPhoneNumber?: string;
  carrierURL?: string;
  shipDate?: string;
  estimatedArrivalDate?: string;
  shipToAddress?: { city?: string; state?: string; country?: string };
  currentStatus?: string;
  currentStatusDescription?: string;
  signedForBy?: string;
  trackingEvents?: Array<{
    eventDate: string;
    eventAddress?: { city?: string; state?: string; country?: string };
    eventCode: string;
    eventDescription?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Types - Notifications
// ---------------------------------------------------------------------------

export interface NotificationDestination {
  destinationId: string;
  name: string;
  resource: {
    sqs?: { arn: string };
    eventBridge?: { accountId: string; region: string };
  };
}

export interface NotificationSubscription {
  subscriptionId: string;
  payloadVersion: string;
  destinationId: string;
  processingDirective?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Types - Reports
// ---------------------------------------------------------------------------

export interface CreateReportResponse {
  reportId: string;
}

export interface Report {
  reportId: string;
  reportType: string;
  marketplaceIds?: string[];
  reportDocumentId?: string;
  processingStatus: 'CANCELLED' | 'DONE' | 'FATAL' | 'IN_PROGRESS' | 'IN_QUEUE';
  dataStartTime?: string;
  dataEndTime?: string;
  createdTime: string;
  processingStartTime?: string;
  processingEndTime?: string;
}

export interface ReportDocument {
  reportDocumentId: string;
  url: string;
  compressionAlgorithm?: 'GZIP';
}

// ---------------------------------------------------------------------------
// Types - Feeds
// ---------------------------------------------------------------------------

export interface CreateFeedDocumentResponse {
  feedDocumentId: string;
  url: string;
}

export interface CreateFeedResponse {
  feedId: string;
}

export interface Feed {
  feedId: string;
  feedType: string;
  marketplaceIds?: string[];
  processingStatus: 'CANCELLED' | 'DONE' | 'FATAL' | 'IN_PROGRESS' | 'IN_QUEUE';
  resultFeedDocumentId?: string;
  createdTime: string;
  processingStartTime?: string;
  processingEndTime?: string;
}

// ---------------------------------------------------------------------------
// Types - Finances
// ---------------------------------------------------------------------------

export interface MoneyType {
  currencyCode?: string;
  currencyAmount?: number;
}

export interface FinancialEvent {
  shipmentEventList?: Array<{
    amazonOrderId: string;
    sellerOrderId?: string;
    postedDate?: string;
    shipmentItemList?: Array<{
      sellerSku?: string;
      orderItemId?: string;
      quantityShipped?: number;
      itemChargeList?: Array<{ chargeType: string; chargeAmount: MoneyType }>;
      itemFeeList?: Array<{ feeType: string; feeAmount: MoneyType }>;
      promotionList?: Array<{ promotionType?: string; promotionAmount?: MoneyType }>;
    }>;
  }>;
  refundEventList?: Array<{
    amazonOrderId: string;
    postedDate?: string;
    shipmentItemAdjustmentList?: Array<{
      sellerSku?: string;
      orderItemId?: string;
      quantityShipped?: number;
      itemChargeAdjustmentList?: Array<{ chargeType: string; chargeAmount: MoneyType }>;
      itemFeeAdjustmentList?: Array<{ feeType: string; feeAmount: MoneyType }>;
    }>;
  }>;
  serviceProviderCreditEventList?: Array<{
    providerTransactionType?: string;
    sellerOrderId?: string;
    marketplaceId?: string;
    marketplaceCountryCode?: string;
    sellerId?: string;
    sellerStoreName?: string;
    providerId?: string;
    providerStoreName?: string;
  }>;
}

export interface ListFinancialEventsResponse {
  financialEvents?: FinancialEvent;
  nextToken?: string;
}

// ---------------------------------------------------------------------------
// Types - Shipping v2
// ---------------------------------------------------------------------------

export interface ShippingAddress {
  name: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateOrRegion: string;
  postalCode: string;
  countryCode: string;
  phoneNumber?: string;
  email?: string;
}

export interface ShippingPackage {
  dimensions: { length: number; width: number; height: number; unit: 'IN' | 'CM' };
  weight: { value: number; unit: 'LB' | 'KG' | 'G' | 'OZ' };
  insuredValue?: { value: number; unit: string };
  packageClientReferenceId?: string;
}

export interface ShippingRate {
  serviceId: string;
  serviceName: string;
  carrierId: string;
  carrierName: string;
  totalCharge: { value: number; unit: string };
  promise?: { deliveryWindow?: { start: string; end: string } };
  supportedDocumentSpecifications?: Array<{ format: string; size: { length: number; width: number; unit: string } }>;
}

export interface GetRatesResponse {
  requestToken?: string;
  rates?: ShippingRate[];
}

export interface GetRatesParams {
  shipFrom: ShippingAddress;
  shipTo: ShippingAddress;
  packages: ShippingPackage[];
  channelType?: 'AMAZON' | 'EXTERNAL';
}

export interface PurchaseShipmentParams {
  clientReferenceId: string;
  shipFrom: ShippingAddress;
  shipTo: ShippingAddress;
  packages: ShippingPackage[];
  selectedService: { serviceId: string };
  labelSpecification?: { format: string; size: { length: number; width: number; unit: string } };
}

export interface PurchaseShipmentResponse {
  shipmentId: string;
  packageDocumentDetails?: Array<{
    packageClientReferenceId?: string;
    packageDocuments?: Array<{ type: string; format: string; contents: string }>;
    trackingId?: string;
  }>;
}

export interface ShippingTrackingDetail {
  trackingId: string;
  summary?: {
    status?: string;
    promiseDeliveryDate?: string;
  };
  eventHistory?: Array<{
    eventCode: string;
    eventTime: string;
    location?: { city?: string; stateOrRegion?: string; countryCode?: string; postalCode?: string };
  }>;
}

// ---------------------------------------------------------------------------
// Types - Product Pricing
// ---------------------------------------------------------------------------

export interface ProductPriceResult {
  asin: string;
  status: string;
  listPrice?: { amount: number; currencyCode: string };
  offers?: Array<{
    buyingPrice?: { listingPrice: { amount: number; currencyCode: string }; shipping: { amount: number; currencyCode: string } };
    regularPrice?: { amount: number; currencyCode: string };
    fulfillmentChannel: string;
    itemCondition: string;
    itemSubCondition: string;
    sellerSku?: string;
  }>;
}

export interface FeaturedOfferExpectedPriceRequest {
  uri?: string;
  method: 'GET';
  marketplaceId: string;
  itemCondition: 'New' | 'Used';
  asin: string;
}

export interface FeaturedOfferExpectedPriceResult {
  featuredOfferExpectedPriceResults?: Array<{
    featuredOfferExpectedPrice?: {
      listingPrice: { amount: number; currencyCode: string };
      points?: { pointsNumber: number; pointsMonetaryValue: { amount: number; currencyCode: string } };
    };
    resultStatus: string;
    asin: string;
    marketplaceId: string;
  }>;
}

// ---------------------------------------------------------------------------
// Extended API Interface
// ---------------------------------------------------------------------------

export interface AmazonSpApiExtended {
  /** Check if you are restricted from selling an ASIN. Critical for arbitrage gating checks. */
  getListingsRestrictions(asin: string, conditionType?: string): Promise<GetListingsRestrictionsResponse>;

  /** Get a single listing item by SKU with full details including summaries, attributes, issues, offers, and fulfillment availability. */
  getListingsItem(sku: string): Promise<ListingsItemDetail | null>;

  /** Search your listings by ASIN identifiers. Returns matching listing items with summaries. */
  searchListingsItems(params: {
    identifiers: string[];
    identifiersType?: 'ASIN' | 'EAN' | 'GTIN' | 'ISBN' | 'JAN' | 'MINSAN' | 'SKU' | 'UPC';
    pageSize?: number;
    pageToken?: string;
  }): Promise<SearchListingsItemsResponse>;

  /** Confirm shipment for a seller-fulfilled order with carrier and tracking info. */
  confirmShipment(orderId: string, params: ConfirmShipmentParams): Promise<void>;

  /** Get shipping address with PII for an order. Requires restricted data token (RDT) / PII role. */
  getOrderAddress(orderId: string): Promise<GetOrderAddressResponse | null>;

  /** Preview MCF fulfillment options and fees for given items + destination address. */
  getFulfillmentPreview(address: McfAddress, items: McfPreviewItem[]): Promise<GetFulfillmentPreviewResponse>;

  /** Create a Multi-Channel Fulfillment order to ship FBA inventory to a non-Amazon buyer. */
  createFulfillmentOrder(params: CreateFulfillmentOrderParams): Promise<void>;

  /** Get status and details of an MCF fulfillment order including shipments and items. */
  getFulfillmentOrder(sellerFulfillmentOrderId: string): Promise<GetFulfillmentOrderResponse | null>;

  /** Cancel a pending MCF fulfillment order before it ships. */
  cancelFulfillmentOrder(sellerFulfillmentOrderId: string): Promise<void>;

  /** Get package tracking details for an MCF shipment package by package number. */
  getPackageTrackingDetails(packageNumber: number): Promise<PackageTrackingDetails | null>;

  /** Create an SQS destination for SP-API push notifications. */
  createDestination(name: string, sqsArn: string): Promise<NotificationDestination>;

  /** Create a subscription for a notification type (e.g., ANY_OFFER_CHANGED, LISTINGS_ITEM_STATUS_CHANGE). */
  createSubscription(notificationType: string, destinationId: string): Promise<NotificationSubscription>;

  /** Get existing subscriptions for a notification type. */
  getSubscriptions(notificationType: string): Promise<NotificationSubscription[]>;

  /** Request a new report. Common types: GET_FLAT_FILE_OPEN_LISTINGS_DATA, GET_MERCHANT_LISTINGS_ALL_DATA, GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA */
  createReport(reportType: string, startDate?: string, endDate?: string): Promise<CreateReportResponse>;

  /** Get report status. Poll until processingStatus is DONE, then use reportDocumentId to download. */
  getReport(reportId: string): Promise<Report>;

  /** Get presigned URL to download a completed report document. URL is valid for 5 minutes. */
  getReportDocument(reportDocumentId: string): Promise<ReportDocument>;

  /** Create a feed document and get a presigned upload URL. Upload your feed content to the URL before calling createFeed. */
  createFeedDocument(contentType: string): Promise<CreateFeedDocumentResponse>;

  /** Create a feed processing job. Common types: POST_FLAT_FILE_PRICEANDQUANTITYONLY_UPDATE_DATA, POST_PRODUCT_DATA */
  createFeed(feedType: string, feedDocumentId: string): Promise<CreateFeedResponse>;

  /** Get feed processing status. Poll until processingStatus is DONE. Use resultFeedDocumentId for processing report. */
  getFeed(feedId: string): Promise<Feed>;

  /** List financial events for reconciliation. Pass orderId for order-specific events, or date range for bulk. */
  listFinancialEvents(params?: { orderId?: string; postedAfter?: string; postedBefore?: string; nextToken?: string; maxResults?: number }): Promise<ListFinancialEventsResponse>;

  /** Get shipping rates for packages between two addresses. Returns available services with pricing. */
  getRates(params: GetRatesParams): Promise<GetRatesResponse>;

  /** Purchase a shipping label for a selected service. Returns shipment ID, label documents, and tracking. */
  purchaseShipment(params: PurchaseShipmentParams): Promise<PurchaseShipmentResponse>;

  /** Get tracking information for a shipment by tracking ID and carrier ID. */
  getTracking(trackingId: string, carrierId: string): Promise<ShippingTrackingDetail | null>;

  /** Get list prices for ASINs (returns your own offer pricing, different from competitive pricing). Batches by 20. */
  getPricing(asins: string[]): Promise<ProductPriceResult[]>;

  /** Batch request for Buy Box expected price (featured offer expected price) across multiple ASINs. */
  getFeaturedOfferExpectedPrice(requests: FeaturedOfferExpectedPriceRequest[]): Promise<FeaturedOfferExpectedPriceResult>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an extended SP-API client with additional endpoints beyond the core set.
 * Uses the same LWA OAuth token management as the core SP-API client.
 *
 * @example
 * ```ts
 * const spExt = createAmazonSpApiExtended({
 *   clientId: '...',
 *   clientSecret: '...',
 *   refreshToken: '...',
 * });
 *
 * // Check if you can sell an ASIN
 * const restrictions = await spExt.getListingsRestrictions('B08N5WRWNW', 'new_new');
 * if (restrictions.restrictions.length === 0) {
 *   console.log('Ungated - you can sell this item');
 * }
 * ```
 */
export function createAmazonSpApiExtended(config: SpApiAuthConfig): AmazonSpApiExtended {
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
      logger.error({ status: response.status, path, error: errorText }, 'SP-API extended request failed');
      throw new Error(`SP-API (${response.status}): ${errorText}`);
    }

    if (response.status === 204) return {} as T;
    return response.json() as Promise<T>;
  }

  return {
    // 1. Listings Restrictions
    async getListingsRestrictions(asin, conditionType) {
      const params: Record<string, string> = {
        asin,
        marketplaceIds: marketplaceId,
        sellerId: 'me',
      };
      if (conditionType) {
        params.conditionType = conditionType;
      }

      const data = await spFetch<{
        restrictions?: Array<{
          marketplaceId: string;
          conditionType?: string;
          reasons?: Array<{
            message: string;
            reasonCode?: string;
            links?: Array<{ resource: string; verb: string; title?: string; type?: string }>;
          }>;
        }>;
      }>('/listings/2021-08-01/restrictions', { params });

      return {
        restrictions: (data.restrictions ?? []).map(r => ({
          marketplaceId: r.marketplaceId,
          conditionType: r.conditionType,
          reasons: r.reasons,
        })),
      };
    },

    // 2. Get Listings Item
    async getListingsItem(sku) {
      try {
        const data = await spFetch<{
          sku: string;
          summaries?: Array<{
            marketplaceId: string;
            asin?: string;
            productType?: string;
            conditionType?: string;
            status?: string[];
            itemName?: string;
            createdDate?: string;
            lastUpdatedDate?: string;
            mainImage?: { link: string; height: number; width: number };
          }>;
          attributes?: Record<string, unknown>;
          issues?: Array<{ code: string; message: string; severity: 'ERROR' | 'WARNING' | 'INFO'; attributeNames?: string[] }>;
          offers?: Array<{
            marketplaceId: string;
            offerType: string;
            price: { currencyCode: string; amount: number };
            points?: { pointsNumber: number };
          }>;
          fulfillmentAvailability?: Array<{
            fulfillmentChannelCode: string;
            quantity?: number;
          }>;
        }>(`/listings/2021-08-01/items/me/${encodeURIComponent(sku)}`, {
          params: {
            marketplaceIds: marketplaceId,
            includedData: 'summaries,attributes,issues,offers,fulfillmentAvailability',
          },
        });

        return {
          sku: data.sku,
          summaries: data.summaries,
          attributes: data.attributes,
          issues: data.issues,
          offers: data.offers,
          fulfillmentAvailability: data.fulfillmentAvailability,
        };
      } catch {
        return null;
      }
    },

    // 3. Search Listings Items
    async searchListingsItems(params) {
      const queryParams: Record<string, string> = {
        marketplaceIds: marketplaceId,
        pageSize: String(params.pageSize ?? 10),
        identifiers: params.identifiers.join(','),
        identifiersType: params.identifiersType ?? 'ASIN',
        includedData: 'summaries,attributes,issues,offers,fulfillmentAvailability',
      };
      if (params.pageToken) {
        queryParams.pageToken = params.pageToken;
      }

      const data = await spFetch<{
        items?: Array<{
          sku: string;
          summaries?: ListingsItemSummary[];
          attributes?: Record<string, unknown>;
          issues?: ListingsItemIssue[];
          offers?: ListingsItemOffer[];
          fulfillmentAvailability?: ListingsItemFulfillmentAvailability[];
        }>;
        numberOfResults?: number;
        pagination?: { nextToken?: string; previousToken?: string };
      }>('/listings/2021-08-01/items/me', { params: queryParams });

      return {
        items: data.items ?? [],
        numberOfResults: data.numberOfResults,
        pagination: data.pagination,
      };
    },

    // 4. Confirm Shipment
    async confirmShipment(orderId, params) {
      await spFetch<void>(`/orders/v0/orders/${encodeURIComponent(orderId)}/shipment/confirm`, {
        method: 'POST',
        body: {
          marketplaceId,
          packageDetail: {
            packageReferenceId: params.packageReferenceId,
            carrierCode: params.carrierCode,
            trackingNumber: params.trackingNumber,
            shipDate: params.shipDate,
            shippingMethod: params.shippingMethod,
            orderItems: params.orderItems.map(oi => ({
              orderItemId: oi.orderItemId,
              quantity: oi.quantity,
            })),
          },
        },
      });
    },

    // 5. Get Order Address
    async getOrderAddress(orderId) {
      try {
        const data = await spFetch<{
          payload?: {
            AmazonOrderId: string;
            ShippingAddress?: {
              Name?: string;
              AddressLine1?: string;
              AddressLine2?: string;
              AddressLine3?: string;
              City?: string;
              County?: string;
              District?: string;
              StateOrRegion?: string;
              PostalCode?: string;
              CountryCode?: string;
              Phone?: string;
              AddressType?: string;
            };
          };
        }>(`/orders/v0/orders/${encodeURIComponent(orderId)}/address`);

        const p = data.payload;
        if (!p) return null;

        return {
          amazonOrderId: p.AmazonOrderId,
          shippingAddress: p.ShippingAddress ? {
            name: p.ShippingAddress.Name,
            addressLine1: p.ShippingAddress.AddressLine1,
            addressLine2: p.ShippingAddress.AddressLine2,
            addressLine3: p.ShippingAddress.AddressLine3,
            city: p.ShippingAddress.City,
            county: p.ShippingAddress.County,
            district: p.ShippingAddress.District,
            stateOrRegion: p.ShippingAddress.StateOrRegion,
            postalCode: p.ShippingAddress.PostalCode,
            countryCode: p.ShippingAddress.CountryCode,
            phone: p.ShippingAddress.Phone,
            addressType: p.ShippingAddress.AddressType,
          } : undefined,
        };
      } catch {
        return null;
      }
    },

    // 6. MCF - Get Fulfillment Preview
    async getFulfillmentPreview(address, items) {
      const data = await spFetch<{
        payload?: {
          fulfillmentPreviews?: Array<{
            shippingSpeedCategory: string;
            isFulfillable: boolean;
            isCODCapable?: boolean;
            estimatedShippingWeight?: { value: number; unit: string };
            estimatedFees?: Array<{ name: string; amount: { currencyCode: string; value: string } }>;
            fulfillmentPreviewShipments?: Array<{
              earliestShipDate?: string;
              latestShipDate?: string;
              earliestArrivalDate?: string;
              latestArrivalDate?: string;
              fulfillmentPreviewItems?: Array<{ sellerSku: string; quantity: number; shippingWeightCalculationMethod?: string }>;
            }>;
            unfulfillablePreviewItems?: Array<{ sellerSku: string; quantity: number; itemUnfulfillableReasons?: string[] }>;
          }>;
        };
      }>('/fba/outbound/2020-07-01/fulfillmentOrders/preview', {
        method: 'POST',
        body: {
          marketplaceId,
          address: {
            name: address.name,
            addressLine1: address.addressLine1,
            addressLine2: address.addressLine2,
            addressLine3: address.addressLine3,
            city: address.city,
            stateOrRegion: address.stateOrRegion,
            postalCode: address.postalCode,
            countryCode: address.countryCode,
            phone: address.phone,
          },
          items: items.map(i => ({
            sellerSku: i.sellerSku,
            quantity: i.quantity,
            sellerFulfillmentOrderItemId: i.sellerFulfillmentOrderItemId ?? i.sellerSku,
          })),
        },
      });

      return {
        fulfillmentPreviews: data.payload?.fulfillmentPreviews,
      };
    },

    // 7. MCF - Create Fulfillment Order
    async createFulfillmentOrder(params) {
      await spFetch<void>('/fba/outbound/2020-07-01/fulfillmentOrders', {
        method: 'POST',
        body: {
          sellerFulfillmentOrderId: params.sellerFulfillmentOrderId,
          displayableOrderId: params.displayableOrderId,
          displayableOrderDate: params.displayableOrderDate,
          displayableOrderComment: params.displayableOrderComment,
          shippingSpeedCategory: params.shippingSpeedCategory,
          fulfillmentAction: params.fulfillmentAction ?? 'Ship',
          fulfillmentPolicy: params.fulfillmentPolicy ?? 'FillOrKill',
          notificationEmails: params.notificationEmails,
          destinationAddress: {
            name: params.destinationAddress.name,
            addressLine1: params.destinationAddress.addressLine1,
            addressLine2: params.destinationAddress.addressLine2,
            addressLine3: params.destinationAddress.addressLine3,
            city: params.destinationAddress.city,
            stateOrRegion: params.destinationAddress.stateOrRegion,
            postalCode: params.destinationAddress.postalCode,
            countryCode: params.destinationAddress.countryCode,
            phone: params.destinationAddress.phone,
          },
          items: params.items.map(i => ({
            sellerSku: i.sellerSku,
            sellerFulfillmentOrderItemId: i.sellerFulfillmentOrderItemId,
            quantity: i.quantity,
          })),
          marketplaceId,
        },
      });
    },

    // 8. MCF - Get Fulfillment Order
    async getFulfillmentOrder(sellerFulfillmentOrderId) {
      try {
        const data = await spFetch<{
          payload?: {
            fulfillmentOrder?: {
              sellerFulfillmentOrderId: string;
              displayableOrderId: string;
              displayableOrderDate: string;
              displayableOrderComment: string;
              shippingSpeedCategory: string;
              destinationAddress: McfAddress;
              fulfillmentOrderStatus: string;
              statusUpdatedDate?: string;
              receivedDate?: string;
            };
            fulfillmentOrderItems?: Array<{
              sellerSku: string;
              sellerFulfillmentOrderItemId: string;
              quantity: number;
              cancelledQuantity?: number;
              unfulfillableQuantity?: number;
              estimatedShipDate?: string;
              estimatedArrivalDate?: string;
            }>;
            fulfillmentShipments?: Array<{
              amazonShipmentId: string;
              fulfillmentCenterId: string;
              fulfillmentShipmentStatus: string;
              shippingDate?: string;
              estimatedArrivalDate?: string;
              fulfillmentShipmentPackages?: Array<{
                packageNumber: number;
                carrierCode: string;
                trackingNumber?: string;
              }>;
            }>;
          };
        }>(`/fba/outbound/2020-07-01/fulfillmentOrders/${encodeURIComponent(sellerFulfillmentOrderId)}`);

        const p = data.payload;
        if (!p) return null;

        return {
          fulfillmentOrder: p.fulfillmentOrder ? {
            ...p.fulfillmentOrder,
            fulfillmentOrderItems: p.fulfillmentOrderItems,
            fulfillmentShipments: p.fulfillmentShipments,
          } : undefined,
          fulfillmentOrderItems: p.fulfillmentOrderItems,
          fulfillmentShipments: p.fulfillmentShipments,
        };
      } catch {
        return null;
      }
    },

    // 9. MCF - Cancel Fulfillment Order
    async cancelFulfillmentOrder(sellerFulfillmentOrderId) {
      await spFetch<void>(
        `/fba/outbound/2020-07-01/fulfillmentOrders/${encodeURIComponent(sellerFulfillmentOrderId)}/cancel`,
        { method: 'PUT' },
      );
    },

    // 10. MCF - Get Package Tracking Details
    async getPackageTrackingDetails(packageNumber) {
      try {
        const data = await spFetch<{
          payload?: {
            packageNumber: number;
            trackingNumber?: string;
            carrierCode?: string;
            carrierPhoneNumber?: string;
            carrierURL?: string;
            shipDate?: string;
            estimatedArrivalDate?: string;
            shipToAddress?: { city?: string; state?: string; country?: string };
            currentStatus?: string;
            currentStatusDescription?: string;
            signedForBy?: string;
            trackingEvents?: Array<{
              eventDate: string;
              eventAddress?: { city?: string; state?: string; country?: string };
              eventCode: string;
              eventDescription?: string;
            }>;
          };
        }>('/fba/outbound/2020-07-01/tracking', {
          params: { packageNumber: String(packageNumber) },
        });

        return data.payload ?? null;
      } catch {
        return null;
      }
    },

    // 11. Notifications - Create Destination
    async createDestination(name, sqsArn) {
      const data = await spFetch<{
        payload?: {
          destinationId: string;
          name: string;
          resource: { sqs?: { arn: string }; eventBridge?: { accountId: string; region: string } };
        };
      }>('/notifications/v1/destinations', {
        method: 'POST',
        body: {
          name,
          resourceSpecification: {
            sqs: { arn: sqsArn },
          },
        },
      });

      if (!data.payload) {
        throw new Error('SP-API: createDestination returned no payload');
      }
      return data.payload;
    },

    // 12. Notifications - Create Subscription
    async createSubscription(notificationType, destinationId) {
      const data = await spFetch<{
        payload?: {
          subscriptionId: string;
          payloadVersion: string;
          destinationId: string;
          processingDirective?: Record<string, unknown>;
        };
      }>(`/notifications/v1/subscriptions/${encodeURIComponent(notificationType)}`, {
        method: 'POST',
        body: {
          payloadVersion: '1.0',
          destinationId,
        },
      });

      if (!data.payload) {
        throw new Error('SP-API: createSubscription returned no payload');
      }
      return data.payload;
    },

    // 13. Notifications - Get Subscriptions
    async getSubscriptions(notificationType) {
      const data = await spFetch<{
        payload?: {
          subscriptions?: Array<{
            subscriptionId: string;
            payloadVersion: string;
            destinationId: string;
            processingDirective?: Record<string, unknown>;
          }>;
        };
      }>(`/notifications/v1/subscriptions/${encodeURIComponent(notificationType)}`);

      return data.payload?.subscriptions ?? [];
    },

    // 14. Reports - Create Report
    async createReport(reportType, startDate, endDate) {
      const body: Record<string, unknown> = {
        reportType,
        marketplaceIds: [marketplaceId],
      };
      if (startDate) body.dataStartTime = startDate;
      if (endDate) body.dataEndTime = endDate;

      const data = await spFetch<{ reportId: string }>('/reports/2021-06-30/reports', {
        method: 'POST',
        body,
      });
      return data;
    },

    // 15. Reports - Get Report
    async getReport(reportId) {
      const data = await spFetch<{
        reportId: string;
        reportType: string;
        marketplaceIds?: string[];
        reportDocumentId?: string;
        processingStatus: 'CANCELLED' | 'DONE' | 'FATAL' | 'IN_PROGRESS' | 'IN_QUEUE';
        dataStartTime?: string;
        dataEndTime?: string;
        createdTime: string;
        processingStartTime?: string;
        processingEndTime?: string;
      }>(`/reports/2021-06-30/reports/${encodeURIComponent(reportId)}`);
      return data;
    },

    // 16. Reports - Get Report Document
    async getReportDocument(reportDocumentId) {
      const data = await spFetch<{
        reportDocumentId: string;
        url: string;
        compressionAlgorithm?: 'GZIP';
      }>(`/reports/2021-06-30/documents/${encodeURIComponent(reportDocumentId)}`);
      return data;
    },

    // 17. Feeds - Create Feed Document
    async createFeedDocument(contentType) {
      const data = await spFetch<{
        feedDocumentId: string;
        url: string;
      }>('/feeds/2021-06-30/documents', {
        method: 'POST',
        body: { contentType },
      });
      return data;
    },

    // 18. Feeds - Create Feed
    async createFeed(feedType, feedDocumentId) {
      const data = await spFetch<{ feedId: string }>('/feeds/2021-06-30/feeds', {
        method: 'POST',
        body: {
          feedType,
          marketplaceIds: [marketplaceId],
          inputFeedDocumentId: feedDocumentId,
        },
      });
      return data;
    },

    // 19. Feeds - Get Feed
    async getFeed(feedId) {
      const data = await spFetch<{
        feedId: string;
        feedType: string;
        marketplaceIds?: string[];
        processingStatus: 'CANCELLED' | 'DONE' | 'FATAL' | 'IN_PROGRESS' | 'IN_QUEUE';
        resultFeedDocumentId?: string;
        createdTime: string;
        processingStartTime?: string;
        processingEndTime?: string;
      }>(`/feeds/2021-06-30/feeds/${encodeURIComponent(feedId)}`);
      return data;
    },

    // 20. Finances - List Financial Events
    async listFinancialEvents(params) {
      if (params?.orderId) {
        const data = await spFetch<{
          payload?: {
            FinancialEvents?: FinancialEvent;
            NextToken?: string;
          };
        }>(`/finances/v0/orders/${encodeURIComponent(params.orderId)}/financialEvents`);

        return {
          financialEvents: data.payload?.FinancialEvents,
          nextToken: data.payload?.NextToken,
        };
      }

      const queryParams: Record<string, string> = {};
      if (params?.postedAfter) {
        queryParams.PostedAfter = params.postedAfter;
      } else {
        queryParams.PostedAfter = new Date(Date.now() - 30 * 86400000).toISOString();
      }
      if (params?.postedBefore) {
        queryParams.PostedBefore = params.postedBefore;
      }
      if (params?.nextToken) {
        queryParams.NextToken = params.nextToken;
      }
      if (params?.maxResults) {
        queryParams.MaxResultsPerPage = String(params.maxResults);
      }

      const data = await spFetch<{
        payload?: {
          FinancialEvents?: FinancialEvent;
          NextToken?: string;
        };
      }>('/finances/v0/financialEvents', { params: queryParams });

      return {
        financialEvents: data.payload?.FinancialEvents,
        nextToken: data.payload?.NextToken,
      };
    },

    // 21. Shipping v2 - Get Rates
    async getRates(params) {
      const data = await spFetch<{
        payload?: {
          requestToken?: string;
          rates?: Array<{
            serviceId: string;
            serviceName: string;
            carrierId: string;
            carrierName: string;
            totalCharge: { value: number; unit: string };
            promise?: { deliveryWindow?: { start: string; end: string } };
            supportedDocumentSpecifications?: Array<{ format: string; size: { length: number; width: number; unit: string } }>;
          }>;
        };
      }>('/shipping/v2/shipments/rates', {
        method: 'POST',
        body: {
          shipFrom: params.shipFrom,
          shipTo: params.shipTo,
          packages: params.packages,
          channelType: params.channelType ?? 'EXTERNAL',
        },
      });

      return {
        requestToken: data.payload?.requestToken,
        rates: data.payload?.rates,
      };
    },

    // 22. Shipping v2 - Purchase Shipment
    async purchaseShipment(params) {
      const data = await spFetch<{
        payload?: {
          shipmentId: string;
          packageDocumentDetails?: Array<{
            packageClientReferenceId?: string;
            packageDocuments?: Array<{ type: string; format: string; contents: string }>;
            trackingId?: string;
          }>;
        };
      }>('/shipping/v2/shipments', {
        method: 'POST',
        body: {
          clientReferenceId: params.clientReferenceId,
          shipFrom: params.shipFrom,
          shipTo: params.shipTo,
          packages: params.packages,
          selectedService: params.selectedService,
          labelSpecification: params.labelSpecification,
        },
      });

      if (!data.payload) {
        throw new Error('SP-API: purchaseShipment returned no payload');
      }
      return data.payload;
    },

    // 23. Shipping v2 - Get Tracking
    async getTracking(trackingId, carrierId) {
      try {
        const data = await spFetch<{
          payload?: {
            trackingId: string;
            summary?: {
              status?: string;
              promiseDeliveryDate?: string;
            };
            eventHistory?: Array<{
              eventCode: string;
              eventTime: string;
              location?: { city?: string; stateOrRegion?: string; countryCode?: string; postalCode?: string };
            }>;
          };
        }>('/shipping/v2/tracking', {
          params: {
            trackingId,
            carrierId,
          },
        });

        return data.payload ?? null;
      } catch {
        return null;
      }
    },

    // 24. Product Pricing - Get Pricing
    async getPricing(asins) {
      const results: ProductPriceResult[] = [];

      for (let i = 0; i < asins.length; i += 20) {
        const batch = asins.slice(i, i + 20);
        const data = await spFetch<{
          payload?: Array<{
            ASIN: string;
            status: string;
            Product?: {
              Offers?: Array<{
                BuyingPrice?: {
                  ListingPrice: { Amount: number; CurrencyCode: string };
                  Shipping: { Amount: number; CurrencyCode: string };
                };
                RegularPrice?: { Amount: number; CurrencyCode: string };
                FulfillmentChannel: string;
                ItemCondition: string;
                ItemSubCondition: string;
                SellerSKU?: string;
              }>;
            };
          }>;
        }>('/products/pricing/v0/price', {
          params: {
            MarketplaceId: marketplaceId,
            Asins: batch.join(','),
            ItemType: 'Asin',
          },
        });

        for (const item of data.payload ?? []) {
          results.push({
            asin: item.ASIN,
            status: item.status,
            offers: item.Product?.Offers?.map(o => ({
              buyingPrice: o.BuyingPrice ? {
                listingPrice: { amount: o.BuyingPrice.ListingPrice.Amount, currencyCode: o.BuyingPrice.ListingPrice.CurrencyCode },
                shipping: { amount: o.BuyingPrice.Shipping.Amount, currencyCode: o.BuyingPrice.Shipping.CurrencyCode },
              } : undefined,
              regularPrice: o.RegularPrice ? { amount: o.RegularPrice.Amount, currencyCode: o.RegularPrice.CurrencyCode } : undefined,
              fulfillmentChannel: o.FulfillmentChannel,
              itemCondition: o.ItemCondition,
              itemSubCondition: o.ItemSubCondition,
              sellerSku: o.SellerSKU,
            })),
          });
        }
      }

      return results;
    },

    // 25. Product Pricing - Featured Offer Expected Price (Batch)
    async getFeaturedOfferExpectedPrice(requests) {
      const data = await spFetch<{
        responses?: Array<{
          body?: {
            featuredOfferExpectedPriceResults?: Array<{
              featuredOfferExpectedPrice?: {
                listingPrice: { amount: number; currencyCode: string };
                points?: { pointsNumber: number; pointsMonetaryValue: { amount: number; currencyCode: string } };
              };
              resultStatus: string;
              asin: string;
              marketplaceId: string;
            }>;
          };
        }>;
      }>('/batches/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice', {
        method: 'POST',
        body: {
          requests: requests.map(r => ({
            uri: r.uri ?? `/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice?MarketplaceId=${r.marketplaceId}&Asin=${r.asin}&ItemCondition=${r.itemCondition}`,
            method: 'GET',
            MarketplaceId: r.marketplaceId,
            ItemCondition: r.itemCondition,
            Asin: r.asin,
          })),
        },
      });

      const allResults: NonNullable<FeaturedOfferExpectedPriceResult['featuredOfferExpectedPriceResults']> = [];
      for (const resp of data.responses ?? []) {
        if (resp.body?.featuredOfferExpectedPriceResults) {
          allResults.push(...resp.body.featuredOfferExpectedPriceResults);
        }
      }

      return {
        featuredOfferExpectedPriceResults: allResults.length > 0 ? allResults : undefined,
      };
    },
  };
}
