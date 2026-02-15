/**
 * Amazon SP-API Complete Methods
 *
 * Additional Selling Partner API endpoints complementing sp-api-extended.ts:
 * - Pricing (competitive pricing, item offers, batch offers, competitive summary)
 * - Product Fees (fee estimates by ASIN, SKU, and batch)
 * - Catalog Items (search and get)
 * - Listings Items (put, patch, delete)
 * - Orders (list, get, get items)
 * - FBA Inventory (summaries)
 * - Product Type Definitions (search and get)
 * - Data Kiosk (create query, get document)
 * - Sales (order metrics)
 * - Tokens (restricted data tokens)
 */

import { createLogger } from '../../utils/logger.js';
import type { SpApiAuthConfig } from './sp-auth.js';
import { getSpApiToken, SP_API_ENDPOINTS, MARKETPLACE_IDS } from './sp-auth.js';

const logger = createLogger('amazon-sp-api');

// ---------------------------------------------------------------------------
// Types - Pricing
// ---------------------------------------------------------------------------

export interface CompetitivePriceEntry {
  competitivePriceId: string;
  price: {
    landedPrice?: { currencyCode: string; amount: number };
    listingPrice?: { currencyCode: string; amount: number };
    shipping?: { currencyCode: string; amount: number };
  };
  condition?: string;
  subcondition?: string;
  belongsToRequester?: boolean;
}

export interface CompetitivePricingResult {
  asin: string;
  status: string;
  marketplaceId: string;
  competitivePrices?: CompetitivePriceEntry[];
  numberOfOfferListings?: Array<{
    condition: string;
    fulfillmentChannel: string;
    count: number;
  }>;
  tradeInValue?: { currencyCode: string; amount: number };
}

export interface ItemOfferListing {
  subCondition: string;
  sellerFeedbackRating?: {
    sellerPositiveFeedbackRating?: number;
    feedbackCount?: number;
  };
  shippingTime?: {
    minimumHours?: number;
    maximumHours?: number;
    availabilityType?: string;
  };
  listingPrice: { currencyCode: string; amount: number };
  shipping?: { currencyCode: string; amount: number };
  isBuyBoxWinner?: boolean;
  isFeaturedMerchant?: boolean;
  isFulfilledByAmazon: boolean;
}

export interface ItemOffersResult {
  asin: string;
  status: string;
  marketplaceId: string;
  itemCondition: string;
  offers?: ItemOfferListing[];
  summary?: {
    totalOfferCount: number;
    numberOfOffers?: Array<{ condition: string; fulfillmentChannel: string; count: number }>;
    lowestPrices?: Array<{ condition: string; fulfillmentChannel: string; landedPrice?: { currencyCode: string; amount: number }; listingPrice?: { currencyCode: string; amount: number }; shipping?: { currencyCode: string; amount: number } }>;
    buyBoxPrices?: Array<{ condition: string; landedPrice?: { currencyCode: string; amount: number }; listingPrice?: { currencyCode: string; amount: number }; shipping?: { currencyCode: string; amount: number } }>;
    buyBoxEligibleOffers?: Array<{ condition: string; fulfillmentChannel: string; count: number }>;
  };
}

export interface ItemOffersBatchResult {
  statusCode: number;
  body: ItemOffersResult;
}

export interface CompetitiveSummaryResult {
  asin: string;
  marketplaceId: string;
  featuredBuyingOptions?: Array<{
    buyingOptionType: string;
    listingPrice?: { currencyCode: string; amount: number };
    shipping?: { currencyCode: string; amount: number };
    condition?: string;
    fulfillmentType?: string;
    sellerId?: string;
  }>;
  lowestPricedOffers?: Array<{
    listingPrice: { currencyCode: string; amount: number };
    shipping?: { currencyCode: string; amount: number };
    condition: string;
    fulfillmentType: string;
    offerCount?: number;
  }>;
}

// ---------------------------------------------------------------------------
// Types - Product Fees
// ---------------------------------------------------------------------------

export interface FeeEstimateResult {
  status: string;
  feesEstimateIdentifier?: {
    marketplaceId: string;
    idType: string;
    idValue: string;
    isAmazonFulfilled: boolean;
    priceToEstimateFees: {
      listingPrice: { currencyCode: string; amount: number };
    };
    sellerInputIdentifier: string;
  };
  feesEstimate?: {
    timeOfFeesEstimation: string;
    totalFeesEstimate: { currencyCode: string; amount: number };
    feeDetailList?: Array<{
      feeType: string;
      feeAmount: { currencyCode: string; amount: number };
      feePromotion?: { currencyCode: string; amount: number };
      finalFee: { currencyCode: string; amount: number };
      includedFeeDetailList?: Array<{
        feeType: string;
        feeAmount: { currencyCode: string; amount: number };
        finalFee: { currencyCode: string; amount: number };
      }>;
    }>;
  };
  error?: {
    type: string;
    code: string;
    message: string;
    detail?: string[];
  };
}

// ---------------------------------------------------------------------------
// Types - Catalog Items
// ---------------------------------------------------------------------------

export interface CatalogItemSummary {
  marketplaceId: string;
  adultProduct?: boolean;
  autographed?: boolean;
  brand?: string;
  browseClassification?: { displayName: string; classificationId: string };
  color?: string;
  itemClassification?: string;
  itemName?: string;
  manufacturer?: string;
  memorabilia?: boolean;
  modelNumber?: string;
  packageQuantity?: number;
  partNumber?: string;
  size?: string;
  style?: string;
  tradeInEligible?: boolean;
  websiteDisplayGroup?: string;
  websiteDisplayGroupName?: string;
}

export interface CatalogItemImage {
  marketplaceId: string;
  images: Array<{
    variant: string;
    link: string;
    height: number;
    width: number;
  }>;
}

export interface CatalogItemSalesRank {
  marketplaceId: string;
  classificationRanks?: Array<{
    classificationId: string;
    title: string;
    link?: string;
    rank: number;
  }>;
  displayGroupRanks?: Array<{
    websiteDisplayGroup: string;
    title: string;
    link?: string;
    rank: number;
  }>;
}

export interface CatalogItemDimensions {
  marketplaceId: string;
  item?: {
    height?: { unit: string; value: number };
    length?: { unit: string; value: number };
    weight?: { unit: string; value: number };
    width?: { unit: string; value: number };
  };
  package?: {
    height?: { unit: string; value: number };
    length?: { unit: string; value: number };
    weight?: { unit: string; value: number };
    width?: { unit: string; value: number };
  };
}

export interface CatalogItem {
  asin: string;
  summaries?: CatalogItemSummary[];
  images?: CatalogItemImage[];
  salesRanks?: CatalogItemSalesRank[];
  dimensions?: CatalogItemDimensions[];
  attributes?: Record<string, unknown>;
  relationships?: Array<Record<string, unknown>>;
}

export interface SearchCatalogItemsResponse {
  numberOfResults: number;
  pagination?: { nextToken?: string; previousToken?: string };
  refinements?: {
    brands?: Array<{ numberOfResults: number; brandName: string }>;
    classifications?: Array<{ numberOfResults: number; displayName: string; classificationId: string }>;
  };
  items: CatalogItem[];
}

export interface SearchCatalogItemsParams {
  keywords?: string;
  identifiers?: string;
  identifiersType?: 'ASIN' | 'UPC' | 'EAN';
}

// ---------------------------------------------------------------------------
// Types - Listings Items (put/patch/delete)
// ---------------------------------------------------------------------------

export interface ListingsItemSubmissionResponse {
  sku: string;
  status: 'ACCEPTED' | 'INVALID';
  submissionId: string;
  issues?: Array<{
    code: string;
    message: string;
    severity: 'ERROR' | 'WARNING' | 'INFO';
    attributeNames?: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Types - Orders
// ---------------------------------------------------------------------------

export interface OrderItem {
  asin: string;
  sellerSku?: string;
  orderItemId: string;
  title?: string;
  quantityOrdered: number;
  quantityShipped?: number;
  itemPrice?: { currencyCode: string; amount: string };
  shippingPrice?: { currencyCode: string; amount: string };
  itemTax?: { currencyCode: string; amount: string };
  promotionDiscount?: { currencyCode: string; amount: string };
  isGift?: boolean;
  conditionId?: string;
  conditionSubtypeId?: string;
  isTransparency?: boolean;
}

export interface Order {
  amazonOrderId: string;
  purchaseDate: string;
  lastUpdateDate: string;
  orderStatus: string;
  fulfillmentChannel?: string;
  salesChannel?: string;
  shipServiceLevel?: string;
  orderTotal?: { currencyCode: string; amount: string };
  numberOfItemsShipped?: number;
  numberOfItemsUnshipped?: number;
  paymentMethod?: string;
  marketplaceId?: string;
  buyerEmail?: string;
  buyerName?: string;
  shipmentServiceLevelCategory?: string;
  orderType?: string;
  earliestShipDate?: string;
  latestShipDate?: string;
  earliestDeliveryDate?: string;
  latestDeliveryDate?: string;
  isBusinessOrder?: boolean;
  isPrime?: boolean;
  isPremiumOrder?: boolean;
  isGlobalExpressEnabled?: boolean;
  isSoldByAB?: boolean;
  isISPU?: boolean;
}

export interface GetOrdersResponse {
  orders: Order[];
  nextToken?: string;
  lastUpdatedBefore?: string;
  createdBefore?: string;
}

export interface GetOrderItemsResponse {
  orderItems: OrderItem[];
  nextToken?: string;
  amazonOrderId: string;
}

export interface GetOrdersParams {
  createdAfter?: string;
  orderStatuses?: string[];
}

// ---------------------------------------------------------------------------
// Types - FBA Inventory
// ---------------------------------------------------------------------------

export interface InventorySummary {
  asin?: string;
  fnSku?: string;
  sellerSku?: string;
  condition?: string;
  inventoryDetails?: {
    fulfillableQuantity?: number;
    inboundWorkingQuantity?: number;
    inboundShippedQuantity?: number;
    inboundReceivingQuantity?: number;
    totalReservedQuantity?: number;
    pendingCustomerOrderQuantity?: number;
    pendingTransshipmentQuantity?: number;
    fcProcessingQuantity?: number;
  };
  lastUpdatedTime?: string;
  productName?: string;
  totalQuantity?: number;
}

export interface GetInventorySummariesResponse {
  inventorySummaries: InventorySummary[];
  granularity: { granularityType: string; granularityId: string };
  nextToken?: string;
}

export interface GetInventorySummariesParams {
  skus?: string[];
  nextToken?: string;
}

// ---------------------------------------------------------------------------
// Types - Product Type Definitions
// ---------------------------------------------------------------------------

export interface ProductTypeDefinitionSummary {
  productType: string;
  displayName?: string;
  marketplaceIds: string[];
}

export interface SearchProductTypesResponse {
  productTypes: ProductTypeDefinitionSummary[];
  productTypeVersion?: string;
}

export interface ProductTypeDefinition {
  productType: string;
  displayName?: string;
  marketplaceIds: string[];
  productTypeVersion: string;
  schema: {
    link: { resource: string; verb: string };
    checksum: string;
  };
  requirements: string;
  requirementsEnforced: string;
  propertyGroups?: Record<string, {
    title?: string;
    description?: string;
    propertyNames?: string[];
  }>;
  locale?: string;
}

// ---------------------------------------------------------------------------
// Types - Data Kiosk
// ---------------------------------------------------------------------------

export interface CreateQueryResponse {
  queryId: string;
}

export interface DataKioskDocument {
  documentId: string;
  documentUrl?: string;
}

// ---------------------------------------------------------------------------
// Types - Sales
// ---------------------------------------------------------------------------

export interface OrderMetric {
  interval: string;
  unitCount: number;
  orderItemCount: number;
  orderCount: number;
  averageUnitPrice: { currencyCode: string; amount: string };
  totalSales: { currencyCode: string; amount: string };
}

export interface GetOrderMetricsResponse {
  orderMetrics: OrderMetric[];
}

export interface GetOrderMetricsParams {
  interval: string;
  granularity: 'Day' | 'Week' | 'Month';
}

// ---------------------------------------------------------------------------
// Types - Tokens
// ---------------------------------------------------------------------------

export interface RestrictedResource {
  method: string;
  path: string;
  dataElements?: string[];
}

export interface CreateRestrictedDataTokenResponse {
  restrictedDataToken: string;
  expiresIn: number;
}

export interface CreateRestrictedDataTokenParams {
  restrictedResources: RestrictedResource[];
}

// ---------------------------------------------------------------------------
// Complete API Interface
// ---------------------------------------------------------------------------

export interface AmazonSpApiComplete {
  // Pricing
  /** Get competitive pricing data for a single ASIN. Returns Buy Box prices, offer counts, trade-in value. */
  getCompetitivePricing(asin: string): Promise<CompetitivePricingResult | null>;

  /** Get all offers for a single ASIN in New condition. Returns individual offer listings with seller info. */
  getItemOffers(asin: string): Promise<ItemOffersResult | null>;

  /** Batch request for item offers across multiple ASINs. More efficient than calling getItemOffers in a loop. */
  getItemOffersBatch(asins: string[]): Promise<ItemOffersBatchResult[]>;

  /** Get competitive summary including featured buying options (Buy Box) and lowest priced offers. Batch API (2022-05-01). */
  getCompetitiveSummary(asins: string[]): Promise<CompetitiveSummaryResult[]>;

  // Product Fees
  /** Estimate Amazon fees for selling an ASIN at a given price. Returns referral fee, FBA fee, etc. */
  getMyFeesEstimateForASIN(asin: string, price: number, currencyCode?: string): Promise<FeeEstimateResult | null>;

  /** Estimate Amazon fees for a SKU at a given price. Same as ASIN version but uses your seller SKU. */
  getMyFeesEstimateForSKU(sku: string, price: number, currencyCode?: string): Promise<FeeEstimateResult | null>;

  /** Batch fee estimates for multiple items. More efficient than individual calls. */
  getMyFeesEstimates(items: Array<{ asin: string; price: number; currencyCode?: string }>): Promise<FeeEstimateResult[]>;

  // Catalog Items
  /** Search the Amazon catalog by keywords or identifiers (ASIN, UPC, EAN). Returns items with summaries, images, sales ranks. */
  searchCatalogItems(params: SearchCatalogItemsParams): Promise<SearchCatalogItemsResponse>;

  /** Get detailed catalog data for a single ASIN including summaries, images, sales ranks, dimensions, attributes, relationships. */
  getCatalogItem(asin: string): Promise<CatalogItem | null>;

  // Listings Items
  /** Create or fully replace a listings item. Used to create new offers on existing ASINs or new products. */
  putListingsItem(sellerId: string, sku: string, body: object): Promise<ListingsItemSubmissionResponse>;

  /** Partially update a listings item with JSON Patch operations. Used for price/quantity updates. */
  patchListingsItem(sellerId: string, sku: string, patches: object[], productType?: string): Promise<ListingsItemSubmissionResponse>;

  /** Delete a listings item (remove your offer for this SKU). */
  deleteListingsItem(sellerId: string, sku: string): Promise<void>;

  // Orders
  /** List orders with optional filters. Defaults to last 7 days if no createdAfter specified. */
  getOrders(params?: GetOrdersParams): Promise<GetOrdersResponse>;

  /** Get a single order by Amazon order ID. */
  getOrder(orderId: string): Promise<Order | null>;

  /** Get line items for an order. */
  getOrderItems(orderId: string): Promise<GetOrderItemsResponse | null>;

  // FBA Inventory
  /** Get FBA inventory summaries with quantity details. Filter by SKUs or paginate with nextToken. */
  getInventorySummaries(params?: GetInventorySummariesParams): Promise<GetInventorySummariesResponse>;

  // Product Type Definitions
  /** Search for product types by keywords. Useful for finding the correct productType when creating listings. */
  searchDefinitionsProductTypes(keywords: string): Promise<SearchProductTypesResponse>;

  /** Get the full product type definition including JSON schema for listing attributes. */
  getDefinitionsProductType(productType: string): Promise<ProductTypeDefinition | null>;

  // Data Kiosk
  /** Create a Data Kiosk analytics query. Returns a queryId to poll for results. */
  createQuery(query: string): Promise<CreateQueryResponse>;

  /** Get a Data Kiosk document by ID. Returns the document URL for download. */
  getDocument(documentId: string): Promise<DataKioskDocument | null>;

  // Sales
  /** Get aggregated order metrics (units, revenue, order count) for a time interval and granularity. */
  getOrderMetrics(params: GetOrderMetricsParams): Promise<GetOrderMetricsResponse>;

  // Tokens
  /** Create a Restricted Data Token (RDT) for accessing PII-protected endpoints like buyer shipping address. */
  createRestrictedDataToken(params: CreateRestrictedDataTokenParams): Promise<CreateRestrictedDataTokenResponse>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a complete SP-API client with pricing, fees, catalog, listings,
 * orders, inventory, product types, data kiosk, sales, and tokens endpoints.
 *
 * Uses the same LWA OAuth token management as the core and extended SP-API clients.
 *
 * @example
 * ```ts
 * const sp = createAmazonSpApiComplete({
 *   clientId: '...',
 *   clientSecret: '...',
 *   refreshToken: '...',
 * });
 *
 * // Get competitive pricing
 * const pricing = await sp.getCompetitivePricing('B08N5WRWNW');
 *
 * // Estimate fees
 * const fees = await sp.getMyFeesEstimateForASIN('B08N5WRWNW', 29.99);
 *
 * // Search catalog
 * const results = await sp.searchCatalogItems({ keywords: 'wireless earbuds' });
 * ```
 */
export function createAmazonSpApiComplete(config: SpApiAuthConfig): AmazonSpApiComplete {
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
        if (v !== undefined && v !== '') {
          url.searchParams.set(k, v);
        }
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
      logger.error({ status: response.status, path, error: errorText }, 'SP-API request failed');
      throw new Error(`SP-API (${response.status}): ${errorText}`);
    }

    if (response.status === 204) return {} as T;
    return response.json() as Promise<T>;
  }

  return {
    // -----------------------------------------------------------------------
    // 1. Pricing - Get Competitive Pricing
    // -----------------------------------------------------------------------
    async getCompetitivePricing(asin) {
      try {
        const data = await spFetch<{
          payload?: Array<{
            ASIN: string;
            status: string;
            Product?: {
              CompetitivePricing?: {
                CompetitivePrices?: Array<{
                  CompetitivePriceId: string;
                  Price: {
                    LandedPrice?: { CurrencyCode: string; Amount: number };
                    ListingPrice?: { CurrencyCode: string; Amount: number };
                    Shipping?: { CurrencyCode: string; Amount: number };
                  };
                  condition?: string;
                  subcondition?: string;
                  belongsToRequester?: boolean;
                }>;
                NumberOfOfferListings?: Array<{
                  condition: string;
                  fulfillmentChannel: string;
                  count: number;
                }>;
                TradeInValue?: { CurrencyCode: string; Amount: number };
              };
            };
          }>;
        }>('/products/pricing/v0/competitivePrice', {
          params: {
            MarketplaceId: marketplaceId,
            Asins: asin,
            ItemType: 'Asin',
          },
        });

        const item = data.payload?.[0];
        if (!item) return null;

        const cp = item.Product?.CompetitivePricing;
        return {
          asin: item.ASIN,
          status: item.status,
          marketplaceId,
          competitivePrices: cp?.CompetitivePrices?.map(p => ({
            competitivePriceId: p.CompetitivePriceId,
            price: {
              landedPrice: p.Price.LandedPrice ? { currencyCode: p.Price.LandedPrice.CurrencyCode, amount: p.Price.LandedPrice.Amount } : undefined,
              listingPrice: p.Price.ListingPrice ? { currencyCode: p.Price.ListingPrice.CurrencyCode, amount: p.Price.ListingPrice.Amount } : undefined,
              shipping: p.Price.Shipping ? { currencyCode: p.Price.Shipping.CurrencyCode, amount: p.Price.Shipping.Amount } : undefined,
            },
            condition: p.condition,
            subcondition: p.subcondition,
            belongsToRequester: p.belongsToRequester,
          })),
          numberOfOfferListings: cp?.NumberOfOfferListings,
          tradeInValue: cp?.TradeInValue ? { currencyCode: cp.TradeInValue.CurrencyCode, amount: cp.TradeInValue.Amount } : undefined,
        };
      } catch (err) {
        logger.error({ asin, error: err }, 'getCompetitivePricing failed');
        return null;
      }
    },

    // -----------------------------------------------------------------------
    // 2. Pricing - Get Item Offers
    // -----------------------------------------------------------------------
    async getItemOffers(asin) {
      try {
        const data = await spFetch<{
          payload?: {
            ASIN: string;
            status: string;
            MarketplaceId: string;
            ItemCondition: string;
            Offers?: Array<{
              SubCondition: string;
              SellerFeedbackRating?: {
                SellerPositiveFeedbackRating?: number;
                FeedbackCount?: number;
              };
              ShippingTime?: {
                minimumHours?: number;
                maximumHours?: number;
                availabilityType?: string;
              };
              ListingPrice: { CurrencyCode: string; Amount: number };
              Shipping?: { CurrencyCode: string; Amount: number };
              IsBuyBoxWinner?: boolean;
              IsFeaturedMerchant?: boolean;
              IsFulfilledByAmazon: boolean;
            }>;
            Summary?: {
              TotalOfferCount: number;
              NumberOfOffers?: Array<{ condition: string; fulfillmentChannel: string; count: number }>;
              LowestPrices?: Array<{
                condition: string;
                fulfillmentChannel: string;
                LandedPrice?: { CurrencyCode: string; Amount: number };
                ListingPrice?: { CurrencyCode: string; Amount: number };
                Shipping?: { CurrencyCode: string; Amount: number };
              }>;
              BuyBoxPrices?: Array<{
                condition: string;
                LandedPrice?: { CurrencyCode: string; Amount: number };
                ListingPrice?: { CurrencyCode: string; Amount: number };
                Shipping?: { CurrencyCode: string; Amount: number };
              }>;
              BuyBoxEligibleOffers?: Array<{ condition: string; fulfillmentChannel: string; count: number }>;
            };
          };
        }>(`/products/pricing/v0/items/${encodeURIComponent(asin)}/offers`, {
          params: {
            MarketplaceId: marketplaceId,
            ItemCondition: 'New',
          },
        });

        const p = data.payload;
        if (!p) return null;

        return {
          asin: p.ASIN,
          status: p.status,
          marketplaceId: p.MarketplaceId,
          itemCondition: p.ItemCondition,
          offers: p.Offers?.map(o => ({
            subCondition: o.SubCondition,
            sellerFeedbackRating: o.SellerFeedbackRating ? {
              sellerPositiveFeedbackRating: o.SellerFeedbackRating.SellerPositiveFeedbackRating,
              feedbackCount: o.SellerFeedbackRating.FeedbackCount,
            } : undefined,
            shippingTime: o.ShippingTime,
            listingPrice: { currencyCode: o.ListingPrice.CurrencyCode, amount: o.ListingPrice.Amount },
            shipping: o.Shipping ? { currencyCode: o.Shipping.CurrencyCode, amount: o.Shipping.Amount } : undefined,
            isBuyBoxWinner: o.IsBuyBoxWinner,
            isFeaturedMerchant: o.IsFeaturedMerchant,
            isFulfilledByAmazon: o.IsFulfilledByAmazon,
          })),
          summary: p.Summary ? {
            totalOfferCount: p.Summary.TotalOfferCount,
            numberOfOffers: p.Summary.NumberOfOffers,
            lowestPrices: p.Summary.LowestPrices?.map(lp => ({
              condition: lp.condition,
              fulfillmentChannel: lp.fulfillmentChannel,
              landedPrice: lp.LandedPrice ? { currencyCode: lp.LandedPrice.CurrencyCode, amount: lp.LandedPrice.Amount } : undefined,
              listingPrice: lp.ListingPrice ? { currencyCode: lp.ListingPrice.CurrencyCode, amount: lp.ListingPrice.Amount } : undefined,
              shipping: lp.Shipping ? { currencyCode: lp.Shipping.CurrencyCode, amount: lp.Shipping.Amount } : undefined,
            })),
            buyBoxPrices: p.Summary.BuyBoxPrices?.map(bp => ({
              condition: bp.condition,
              landedPrice: bp.LandedPrice ? { currencyCode: bp.LandedPrice.CurrencyCode, amount: bp.LandedPrice.Amount } : undefined,
              listingPrice: bp.ListingPrice ? { currencyCode: bp.ListingPrice.CurrencyCode, amount: bp.ListingPrice.Amount } : undefined,
              shipping: bp.Shipping ? { currencyCode: bp.Shipping.CurrencyCode, amount: bp.Shipping.Amount } : undefined,
            })),
            buyBoxEligibleOffers: p.Summary.BuyBoxEligibleOffers,
          } : undefined,
        };
      } catch (err) {
        logger.error({ asin, error: err }, 'getItemOffers failed');
        return null;
      }
    },

    // -----------------------------------------------------------------------
    // 3. Pricing - Get Item Offers Batch
    // -----------------------------------------------------------------------
    async getItemOffersBatch(asins) {
      try {
        const data = await spFetch<{
          responses?: Array<{
            statusCode: number;
            body: {
              payload?: {
                ASIN: string;
                status: string;
                MarketplaceId: string;
                ItemCondition: string;
                Offers?: Array<{
                  SubCondition: string;
                  ListingPrice: { CurrencyCode: string; Amount: number };
                  Shipping?: { CurrencyCode: string; Amount: number };
                  IsBuyBoxWinner?: boolean;
                  IsFulfilledByAmazon: boolean;
                }>;
                Summary?: {
                  TotalOfferCount: number;
                };
              };
            };
          }>;
        }>('/batches/products/pricing/v0/itemOffers', {
          method: 'POST',
          body: {
            requests: asins.map(a => ({
              uri: `/products/pricing/v0/items/${a}/offers`,
              method: 'GET',
              queryParams: {
                MarketplaceId: marketplaceId,
                ItemCondition: 'New',
              },
            })),
          },
        });

        return (data.responses ?? []).map(r => ({
          statusCode: r.statusCode,
          body: {
            asin: r.body.payload?.ASIN ?? '',
            status: r.body.payload?.status ?? String(r.statusCode),
            marketplaceId: r.body.payload?.MarketplaceId ?? marketplaceId,
            itemCondition: r.body.payload?.ItemCondition ?? 'New',
            offers: r.body.payload?.Offers?.map(o => ({
              subCondition: o.SubCondition,
              listingPrice: o.ListingPrice ? { currencyCode: o.ListingPrice.CurrencyCode, amount: o.ListingPrice.Amount } : { currencyCode: 'USD', amount: 0 },
              shipping: o.Shipping ? { currencyCode: o.Shipping.CurrencyCode, amount: o.Shipping.Amount } : undefined,
              isBuyBoxWinner: o.IsBuyBoxWinner,
              isFulfilledByAmazon: o.IsFulfilledByAmazon,
            })),
            summary: r.body.payload?.Summary ? {
              totalOfferCount: r.body.payload.Summary.TotalOfferCount,
            } : undefined,
          },
        }));
      } catch (err) {
        logger.error({ asinCount: asins.length, error: err }, 'getItemOffersBatch failed');
        return [];
      }
    },

    // -----------------------------------------------------------------------
    // 4. Pricing - Get Competitive Summary (2022-05-01)
    // -----------------------------------------------------------------------
    async getCompetitiveSummary(asins) {
      try {
        const data = await spFetch<{
          responses?: Array<{
            status?: { statusCode: number };
            body?: {
              asin: string;
              marketplaceId: string;
              featuredBuyingOptions?: Array<{
                buyingOptionType: string;
                listingPrice?: { currencyCode: string; amount: number };
                shipping?: { currencyCode: string; amount: number };
                condition?: string;
                fulfillmentType?: string;
                sellerId?: string;
              }>;
              lowestPricedOffers?: Array<{
                listingPrice: { currencyCode: string; amount: number };
                shipping?: { currencyCode: string; amount: number };
                condition: string;
                fulfillmentType: string;
                offerCount?: number;
              }>;
            };
          }>;
        }>('/batches/products/pricing/2022-05-01/items/competitiveSummary', {
          method: 'POST',
          body: {
            requests: asins.map(a => ({
              asin: a,
              marketplaceId,
              includedData: ['featuredBuyingOptions', 'lowestPricedOffers'],
            })),
          },
        });

        return (data.responses ?? [])
          .filter(r => r.body != null)
          .map(r => ({
            asin: r.body!.asin,
            marketplaceId: r.body!.marketplaceId,
            featuredBuyingOptions: r.body!.featuredBuyingOptions,
            lowestPricedOffers: r.body!.lowestPricedOffers,
          }));
      } catch (err) {
        logger.error({ asinCount: asins.length, error: err }, 'getCompetitiveSummary failed');
        return [];
      }
    },

    // -----------------------------------------------------------------------
    // 5. Product Fees - Get My Fees Estimate For ASIN
    // -----------------------------------------------------------------------
    async getMyFeesEstimateForASIN(asin, price, currencyCode?) {
      try {
        const data = await spFetch<{
          payload?: {
            FeesEstimateResult?: {
              Status: string;
              FeesEstimateIdentifier?: {
                MarketplaceId: string;
                IdType: string;
                IdValue: string;
                IsAmazonFulfilled: boolean;
                PriceToEstimateFees: {
                  ListingPrice: { CurrencyCode: string; Amount: number };
                };
                SellerInputIdentifier: string;
              };
              FeesEstimate?: {
                TimeOfFeesEstimation: string;
                TotalFeesEstimate: { CurrencyCode: string; Amount: number };
                FeeDetailList?: Array<{
                  FeeType: string;
                  FeeAmount: { CurrencyCode: string; Amount: number };
                  FeePromotion?: { CurrencyCode: string; Amount: number };
                  FinalFee: { CurrencyCode: string; Amount: number };
                  IncludedFeeDetailList?: Array<{
                    FeeType: string;
                    FeeAmount: { CurrencyCode: string; Amount: number };
                    FinalFee: { CurrencyCode: string; Amount: number };
                  }>;
                }>;
              };
              Error?: {
                Type: string;
                Code: string;
                Message: string;
                Detail?: string[];
              };
            };
          };
        }>(`/products/fees/v0/items/${encodeURIComponent(asin)}/feesEstimate`, {
          method: 'POST',
          body: {
            FeesEstimateRequest: {
              MarketplaceId: marketplaceId,
              IsAmazonFulfilled: true,
              PriceToEstimateFees: {
                ListingPrice: {
                  CurrencyCode: currencyCode ?? 'USD',
                  Amount: price,
                },
              },
              Identifier: asin,
            },
          },
        });

        const r = data.payload?.FeesEstimateResult;
        if (!r) return null;

        return mapFeeEstimateResult(r);
      } catch (err) {
        logger.error({ asin, price, error: err }, 'getMyFeesEstimateForASIN failed');
        return null;
      }
    },

    // -----------------------------------------------------------------------
    // 6. Product Fees - Get My Fees Estimate For SKU
    // -----------------------------------------------------------------------
    async getMyFeesEstimateForSKU(sku, price, currencyCode?) {
      try {
        const data = await spFetch<{
          payload?: {
            FeesEstimateResult?: RawFeesEstimateResult;
          };
        }>(`/products/fees/v0/listings/${encodeURIComponent(sku)}/feesEstimate`, {
          method: 'POST',
          body: {
            FeesEstimateRequest: {
              MarketplaceId: marketplaceId,
              IsAmazonFulfilled: true,
              PriceToEstimateFees: {
                ListingPrice: {
                  CurrencyCode: currencyCode ?? 'USD',
                  Amount: price,
                },
              },
              Identifier: sku,
            },
          },
        });

        const r = data.payload?.FeesEstimateResult;
        if (!r) return null;

        return mapFeeEstimateResult(r);
      } catch (err) {
        logger.error({ sku, price, error: err }, 'getMyFeesEstimateForSKU failed');
        return null;
      }
    },

    // -----------------------------------------------------------------------
    // 7. Product Fees - Batch Fee Estimates
    // -----------------------------------------------------------------------
    async getMyFeesEstimates(items) {
      try {
        const data = await spFetch<Array<{
          Status: string;
          FeesEstimateIdentifier?: {
            MarketplaceId: string;
            IdType: string;
            IdValue: string;
            IsAmazonFulfilled: boolean;
            PriceToEstimateFees: {
              ListingPrice: { CurrencyCode: string; Amount: number };
            };
            SellerInputIdentifier: string;
          };
          FeesEstimate?: {
            TimeOfFeesEstimation: string;
            TotalFeesEstimate: { CurrencyCode: string; Amount: number };
            FeeDetailList?: Array<{
              FeeType: string;
              FeeAmount: { CurrencyCode: string; Amount: number };
              FeePromotion?: { CurrencyCode: string; Amount: number };
              FinalFee: { CurrencyCode: string; Amount: number };
            }>;
          };
          Error?: { Type: string; Code: string; Message: string; Detail?: string[] };
        }>>('/products/fees/v0/feesEstimate', {
          method: 'POST',
          body: items.map(item => ({
            FeesEstimateRequest: {
              MarketplaceId: marketplaceId,
              IsAmazonFulfilled: true,
              PriceToEstimateFees: {
                ListingPrice: {
                  CurrencyCode: item.currencyCode ?? 'USD',
                  Amount: item.price,
                },
              },
              Identifier: item.asin,
            },
            IdType: 'Asin',
            IdValue: item.asin,
          })),
        });

        return (Array.isArray(data) ? data : []).map(r => mapFeeEstimateResult(r));
      } catch (err) {
        logger.error({ itemCount: items.length, error: err }, 'getMyFeesEstimates failed');
        return [];
      }
    },

    // -----------------------------------------------------------------------
    // 8. Catalog Items - Search
    // -----------------------------------------------------------------------
    async searchCatalogItems(params) {
      const queryParams: Record<string, string> = {
        marketplaceIds: marketplaceId,
        includedData: 'summaries,images,salesRanks,dimensions',
      };
      if (params.keywords) {
        queryParams.keywords = params.keywords;
      }
      if (params.identifiers) {
        queryParams.identifiers = params.identifiers;
      }
      if (params.identifiersType) {
        queryParams.identifiersType = params.identifiersType;
      }

      const data = await spFetch<{
        numberOfResults?: number;
        pagination?: { nextToken?: string; previousToken?: string };
        refinements?: {
          brands?: Array<{ numberOfResults: number; brandName: string }>;
          classifications?: Array<{ numberOfResults: number; displayName: string; classificationId: string }>;
        };
        items?: CatalogItem[];
      }>('/catalog/2022-04-01/items', { params: queryParams });

      return {
        numberOfResults: data.numberOfResults ?? 0,
        pagination: data.pagination,
        refinements: data.refinements,
        items: data.items ?? [],
      };
    },

    // -----------------------------------------------------------------------
    // 9. Catalog Items - Get Single Item
    // -----------------------------------------------------------------------
    async getCatalogItem(asin) {
      try {
        const data = await spFetch<CatalogItem>(
          `/catalog/2022-04-01/items/${encodeURIComponent(asin)}`,
          {
            params: {
              marketplaceIds: marketplaceId,
              includedData: 'summaries,images,salesRanks,dimensions,attributes,relationships',
            },
          },
        );
        return data;
      } catch (err) {
        logger.error({ asin, error: err }, 'getCatalogItem failed');
        return null;
      }
    },

    // -----------------------------------------------------------------------
    // 10. Listings Items - Put (Create/Replace)
    // -----------------------------------------------------------------------
    async putListingsItem(sellerId, sku, body) {
      const data = await spFetch<{
        sku: string;
        status: 'ACCEPTED' | 'INVALID';
        submissionId: string;
        issues?: Array<{
          code: string;
          message: string;
          severity: 'ERROR' | 'WARNING' | 'INFO';
          attributeNames?: string[];
        }>;
      }>(`/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}`, {
        method: 'PUT',
        params: {
          marketplaceIds: marketplaceId,
        },
        body: (() => {
          const { productType: pt, ...attributes } = body as Record<string, unknown>;
          return {
            productType: pt ?? 'PRODUCT',
            requirements: 'LISTING',
            attributes,
          };
        })(),
      });

      return {
        sku: data.sku,
        status: data.status,
        submissionId: data.submissionId,
        issues: data.issues,
      };
    },

    // -----------------------------------------------------------------------
    // 11. Listings Items - Patch (Partial Update)
    // -----------------------------------------------------------------------
    async patchListingsItem(sellerId, sku, patches, productType?) {
      const data = await spFetch<{
        sku: string;
        status: 'ACCEPTED' | 'INVALID';
        submissionId: string;
        issues?: Array<{
          code: string;
          message: string;
          severity: 'ERROR' | 'WARNING' | 'INFO';
          attributeNames?: string[];
        }>;
      }>(`/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}`, {
        method: 'PATCH',
        params: {
          marketplaceIds: marketplaceId,
        },
        body: {
          productType: productType ?? 'PRODUCT',
          patches,
        },
      });

      return {
        sku: data.sku,
        status: data.status,
        submissionId: data.submissionId,
        issues: data.issues,
      };
    },

    // -----------------------------------------------------------------------
    // 12. Listings Items - Delete
    // -----------------------------------------------------------------------
    async deleteListingsItem(sellerId, sku) {
      await spFetch<void>(
        `/listings/2021-08-01/items/${encodeURIComponent(sellerId)}/${encodeURIComponent(sku)}`,
        {
          method: 'DELETE',
          params: {
            marketplaceIds: marketplaceId,
          },
        },
      );
    },

    // -----------------------------------------------------------------------
    // 13. Orders - Get Orders (List)
    // -----------------------------------------------------------------------
    async getOrders(params) {
      const queryParams: Record<string, string> = {
        MarketplaceIds: marketplaceId,
      };

      if (params?.createdAfter) {
        queryParams.CreatedAfter = params.createdAfter;
      } else {
        // Default to last 7 days
        queryParams.CreatedAfter = new Date(Date.now() - 7 * 86400000).toISOString();
      }

      if (params?.orderStatuses && params.orderStatuses.length > 0) {
        queryParams.OrderStatuses = params.orderStatuses.join(',');
      }

      const data = await spFetch<{
        payload?: {
          Orders?: Array<{
            AmazonOrderId: string;
            PurchaseDate: string;
            LastUpdateDate: string;
            OrderStatus: string;
            FulfillmentChannel?: string;
            SalesChannel?: string;
            ShipServiceLevel?: string;
            OrderTotal?: { CurrencyCode: string; Amount: string };
            NumberOfItemsShipped?: number;
            NumberOfItemsUnshipped?: number;
            PaymentMethod?: string;
            MarketplaceId?: string;
            BuyerEmail?: string;
            BuyerName?: string;
            ShipmentServiceLevelCategory?: string;
            OrderType?: string;
            EarliestShipDate?: string;
            LatestShipDate?: string;
            EarliestDeliveryDate?: string;
            LatestDeliveryDate?: string;
            IsBusinessOrder?: boolean;
            IsPrime?: boolean;
            IsPremiumOrder?: boolean;
            IsGlobalExpressEnabled?: boolean;
            IsSoldByAB?: boolean;
            IsISPU?: boolean;
          }>;
          NextToken?: string;
          LastUpdatedBefore?: string;
          CreatedBefore?: string;
        };
      }>('/orders/v0/orders', { params: queryParams });

      const orders = (data.payload?.Orders ?? []).map(mapOrder);

      return {
        orders,
        nextToken: data.payload?.NextToken,
        lastUpdatedBefore: data.payload?.LastUpdatedBefore,
        createdBefore: data.payload?.CreatedBefore,
      };
    },

    // -----------------------------------------------------------------------
    // 14. Orders - Get Single Order
    // -----------------------------------------------------------------------
    async getOrder(orderId) {
      try {
        const data = await spFetch<{
          payload?: {
            AmazonOrderId: string;
            PurchaseDate: string;
            LastUpdateDate: string;
            OrderStatus: string;
            FulfillmentChannel?: string;
            SalesChannel?: string;
            ShipServiceLevel?: string;
            OrderTotal?: { CurrencyCode: string; Amount: string };
            NumberOfItemsShipped?: number;
            NumberOfItemsUnshipped?: number;
            PaymentMethod?: string;
            MarketplaceId?: string;
            BuyerEmail?: string;
            BuyerName?: string;
            ShipmentServiceLevelCategory?: string;
            OrderType?: string;
            EarliestShipDate?: string;
            LatestShipDate?: string;
            EarliestDeliveryDate?: string;
            LatestDeliveryDate?: string;
            IsBusinessOrder?: boolean;
            IsPrime?: boolean;
            IsPremiumOrder?: boolean;
            IsGlobalExpressEnabled?: boolean;
            IsSoldByAB?: boolean;
            IsISPU?: boolean;
          };
        }>(`/orders/v0/orders/${encodeURIComponent(orderId)}`);

        if (!data.payload) return null;
        return mapOrder(data.payload);
      } catch (err) {
        logger.error({ orderId, error: err }, 'getOrder failed');
        return null;
      }
    },

    // -----------------------------------------------------------------------
    // 15. Orders - Get Order Items
    // -----------------------------------------------------------------------
    async getOrderItems(orderId) {
      try {
        const data = await spFetch<{
          payload?: {
            AmazonOrderId: string;
            OrderItems?: Array<{
              ASIN: string;
              SellerSKU?: string;
              OrderItemId: string;
              Title?: string;
              QuantityOrdered: number;
              QuantityShipped?: number;
              ItemPrice?: { CurrencyCode: string; Amount: string };
              ShippingPrice?: { CurrencyCode: string; Amount: string };
              ItemTax?: { CurrencyCode: string; Amount: string };
              PromotionDiscount?: { CurrencyCode: string; Amount: string };
              IsGift?: boolean;
              ConditionId?: string;
              ConditionSubtypeId?: string;
              IsTransparency?: boolean;
            }>;
            NextToken?: string;
          };
        }>(`/orders/v0/orders/${encodeURIComponent(orderId)}/orderItems`);

        if (!data.payload) return null;

        return {
          amazonOrderId: data.payload.AmazonOrderId,
          orderItems: (data.payload.OrderItems ?? []).map(oi => ({
            asin: oi.ASIN,
            sellerSku: oi.SellerSKU,
            orderItemId: oi.OrderItemId,
            title: oi.Title,
            quantityOrdered: oi.QuantityOrdered,
            quantityShipped: oi.QuantityShipped,
            itemPrice: oi.ItemPrice ? { currencyCode: oi.ItemPrice.CurrencyCode, amount: oi.ItemPrice.Amount } : undefined,
            shippingPrice: oi.ShippingPrice ? { currencyCode: oi.ShippingPrice.CurrencyCode, amount: oi.ShippingPrice.Amount } : undefined,
            itemTax: oi.ItemTax ? { currencyCode: oi.ItemTax.CurrencyCode, amount: oi.ItemTax.Amount } : undefined,
            promotionDiscount: oi.PromotionDiscount ? { currencyCode: oi.PromotionDiscount.CurrencyCode, amount: oi.PromotionDiscount.Amount } : undefined,
            isGift: oi.IsGift,
            conditionId: oi.ConditionId,
            conditionSubtypeId: oi.ConditionSubtypeId,
            isTransparency: oi.IsTransparency,
          })),
          nextToken: data.payload.NextToken,
        };
      } catch (err) {
        logger.error({ orderId, error: err }, 'getOrderItems failed');
        return null;
      }
    },

    // -----------------------------------------------------------------------
    // 16. FBA Inventory - Get Inventory Summaries
    // -----------------------------------------------------------------------
    async getInventorySummaries(params) {
      const queryParams: Record<string, string> = {
        details: 'true',
        granularityType: 'Marketplace',
        granularityId: marketplaceId,
        marketplaceIds: marketplaceId,
      };

      if (params?.skus && params.skus.length > 0) {
        queryParams.sellerSkus = params.skus.join(',');
      }
      if (params?.nextToken) {
        queryParams.nextToken = params.nextToken;
      }

      const data = await spFetch<{
        payload?: {
          inventorySummaries?: Array<{
            asin?: string;
            fnSku?: string;
            sellerSku?: string;
            condition?: string;
            inventoryDetails?: {
              fulfillableQuantity?: number;
              inboundWorkingQuantity?: number;
              inboundShippedQuantity?: number;
              inboundReceivingQuantity?: number;
              totalReservedQuantity?: number;
              pendingCustomerOrderQuantity?: number;
              pendingTransshipmentQuantity?: number;
              fcProcessingQuantity?: number;
            };
            lastUpdatedTime?: string;
            productName?: string;
            totalQuantity?: number;
          }>;
          granularity?: { granularityType: string; granularityId: string };
        };
        pagination?: { nextToken?: string };
      }>('/fba/inventory/v1/summaries', { params: queryParams });

      return {
        inventorySummaries: data.payload?.inventorySummaries ?? [],
        granularity: data.payload?.granularity ?? { granularityType: 'Marketplace', granularityId: marketplaceId },
        nextToken: data.pagination?.nextToken,
      };
    },

    // -----------------------------------------------------------------------
    // 17. Product Type Definitions - Search
    // -----------------------------------------------------------------------
    async searchDefinitionsProductTypes(keywords) {
      const data = await spFetch<{
        productTypes?: Array<{
          name: string;
          displayName?: string;
          marketplaceIds?: string[];
        }>;
        productTypeVersion?: string;
      }>('/definitions/2020-09-01/productTypes', {
        params: {
          marketplaceIds: marketplaceId,
          keywords,
        },
      });

      return {
        productTypes: (data.productTypes ?? []).map(pt => ({
          productType: pt.name,
          displayName: pt.displayName,
          marketplaceIds: pt.marketplaceIds ?? [marketplaceId],
        })),
        productTypeVersion: data.productTypeVersion,
      };
    },

    // -----------------------------------------------------------------------
    // 18. Product Type Definitions - Get
    // -----------------------------------------------------------------------
    async getDefinitionsProductType(productType) {
      try {
        const data = await spFetch<{
          productType: string;
          displayName?: string;
          marketplaceIds?: string[];
          productTypeVersion: string;
          schema: {
            link: { resource: string; verb: string };
            checksum: string;
          };
          requirements: string;
          requirementsEnforced: string;
          propertyGroups?: Record<string, {
            title?: string;
            description?: string;
            propertyNames?: string[];
          }>;
          locale?: string;
        }>(`/definitions/2020-09-01/productTypes/${encodeURIComponent(productType)}`, {
          params: {
            marketplaceIds: marketplaceId,
            requirements: 'LISTING',
            locale: 'en_US',
          },
        });

        return {
          productType: data.productType,
          displayName: data.displayName,
          marketplaceIds: data.marketplaceIds ?? [marketplaceId],
          productTypeVersion: data.productTypeVersion,
          schema: data.schema,
          requirements: data.requirements,
          requirementsEnforced: data.requirementsEnforced,
          propertyGroups: data.propertyGroups,
          locale: data.locale,
        };
      } catch (err) {
        logger.error({ productType, error: err }, 'getDefinitionsProductType failed');
        return null;
      }
    },

    // -----------------------------------------------------------------------
    // 19. Data Kiosk - Create Query
    // -----------------------------------------------------------------------
    async createQuery(query) {
      const data = await spFetch<{
        queryId: string;
      }>('/dataKiosk/2023-11-15/queries', {
        method: 'POST',
        body: { query },
      });

      return { queryId: data.queryId };
    },

    // -----------------------------------------------------------------------
    // 20. Data Kiosk - Get Document
    // -----------------------------------------------------------------------
    async getDocument(documentId) {
      try {
        const data = await spFetch<{
          documentId: string;
          documentUrl?: string;
        }>(`/dataKiosk/2023-11-15/documents/${encodeURIComponent(documentId)}`);

        return {
          documentId: data.documentId,
          documentUrl: data.documentUrl,
        };
      } catch (err) {
        logger.error({ documentId, error: err }, 'getDocument failed');
        return null;
      }
    },

    // -----------------------------------------------------------------------
    // 21. Sales - Get Order Metrics
    // -----------------------------------------------------------------------
    async getOrderMetrics(params) {
      const data = await spFetch<{
        payload?: Array<{
          interval: string;
          unitCount: number;
          orderItemCount: number;
          orderCount: number;
          averageUnitPrice: { currencyCode: string; amount: string };
          totalSales: { currencyCode: string; amount: string };
        }>;
      }>('/sales/v1/orderMetrics', {
        params: {
          marketplaceIds: marketplaceId,
          interval: params.interval,
          granularity: params.granularity,
        },
      });

      return {
        orderMetrics: (data.payload ?? []).map(m => ({
          interval: m.interval,
          unitCount: m.unitCount,
          orderItemCount: m.orderItemCount,
          orderCount: m.orderCount,
          averageUnitPrice: m.averageUnitPrice,
          totalSales: m.totalSales,
        })),
      };
    },

    // -----------------------------------------------------------------------
    // 22. Tokens - Create Restricted Data Token
    // -----------------------------------------------------------------------
    async createRestrictedDataToken(params) {
      const data = await spFetch<{
        restrictedDataToken: string;
        expiresIn: number;
      }>('/tokens/2021-03-01/restrictedDataToken', {
        method: 'POST',
        body: {
          restrictedResources: params.restrictedResources,
        },
      });

      return {
        restrictedDataToken: data.restrictedDataToken,
        expiresIn: data.expiresIn,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Raw API shape for a fee estimate result (PascalCase from Amazon API). */
interface RawFeesEstimateResult {
  Status: string;
  FeesEstimateIdentifier?: {
    MarketplaceId: string;
    IdType: string;
    IdValue: string;
    IsAmazonFulfilled: boolean;
    PriceToEstimateFees: {
      ListingPrice: { CurrencyCode: string; Amount: number };
    };
    SellerInputIdentifier: string;
  };
  FeesEstimate?: {
    TimeOfFeesEstimation: string;
    TotalFeesEstimate: { CurrencyCode: string; Amount: number };
    FeeDetailList?: Array<{
      FeeType: string;
      FeeAmount: { CurrencyCode: string; Amount: number };
      FeePromotion?: { CurrencyCode: string; Amount: number };
      FinalFee: { CurrencyCode: string; Amount: number };
      IncludedFeeDetailList?: Array<{
        FeeType: string;
        FeeAmount: { CurrencyCode: string; Amount: number };
        FinalFee: { CurrencyCode: string; Amount: number };
      }>;
    }>;
  };
  Error?: {
    Type: string;
    Code: string;
    Message: string;
    Detail?: string[];
  };
}

/** Map PascalCase Amazon API fee estimate to our camelCase types. */
function mapFeeEstimateResult(r: RawFeesEstimateResult): FeeEstimateResult {
  return {
    status: r.Status,
    feesEstimateIdentifier: r.FeesEstimateIdentifier ? {
      marketplaceId: r.FeesEstimateIdentifier.MarketplaceId,
      idType: r.FeesEstimateIdentifier.IdType,
      idValue: r.FeesEstimateIdentifier.IdValue,
      isAmazonFulfilled: r.FeesEstimateIdentifier.IsAmazonFulfilled,
      priceToEstimateFees: {
        listingPrice: {
          currencyCode: r.FeesEstimateIdentifier.PriceToEstimateFees.ListingPrice.CurrencyCode,
          amount: r.FeesEstimateIdentifier.PriceToEstimateFees.ListingPrice.Amount,
        },
      },
      sellerInputIdentifier: r.FeesEstimateIdentifier.SellerInputIdentifier,
    } : undefined,
    feesEstimate: r.FeesEstimate ? {
      timeOfFeesEstimation: r.FeesEstimate.TimeOfFeesEstimation,
      totalFeesEstimate: {
        currencyCode: r.FeesEstimate.TotalFeesEstimate.CurrencyCode,
        amount: r.FeesEstimate.TotalFeesEstimate.Amount,
      },
      feeDetailList: r.FeesEstimate.FeeDetailList?.map(fd => ({
        feeType: fd.FeeType,
        feeAmount: { currencyCode: fd.FeeAmount.CurrencyCode, amount: fd.FeeAmount.Amount },
        feePromotion: fd.FeePromotion ? { currencyCode: fd.FeePromotion.CurrencyCode, amount: fd.FeePromotion.Amount } : undefined,
        finalFee: { currencyCode: fd.FinalFee.CurrencyCode, amount: fd.FinalFee.Amount },
        includedFeeDetailList: fd.IncludedFeeDetailList?.map(ifd => ({
          feeType: ifd.FeeType,
          feeAmount: { currencyCode: ifd.FeeAmount.CurrencyCode, amount: ifd.FeeAmount.Amount },
          finalFee: { currencyCode: ifd.FinalFee.CurrencyCode, amount: ifd.FinalFee.Amount },
        })),
      })),
    } : undefined,
    error: r.Error ? {
      type: r.Error.Type,
      code: r.Error.Code,
      message: r.Error.Message,
      detail: r.Error.Detail,
    } : undefined,
  };
}

/** Raw API shape for an order (PascalCase from Amazon API). */
interface RawOrder {
  AmazonOrderId: string;
  PurchaseDate: string;
  LastUpdateDate: string;
  OrderStatus: string;
  FulfillmentChannel?: string;
  SalesChannel?: string;
  ShipServiceLevel?: string;
  OrderTotal?: { CurrencyCode: string; Amount: string };
  NumberOfItemsShipped?: number;
  NumberOfItemsUnshipped?: number;
  PaymentMethod?: string;
  MarketplaceId?: string;
  BuyerEmail?: string;
  BuyerName?: string;
  ShipmentServiceLevelCategory?: string;
  OrderType?: string;
  EarliestShipDate?: string;
  LatestShipDate?: string;
  EarliestDeliveryDate?: string;
  LatestDeliveryDate?: string;
  IsBusinessOrder?: boolean;
  IsPrime?: boolean;
  IsPremiumOrder?: boolean;
  IsGlobalExpressEnabled?: boolean;
  IsSoldByAB?: boolean;
  IsISPU?: boolean;
}

/** Map PascalCase Amazon API order to our camelCase types. */
function mapOrder(o: RawOrder): Order {
  return {
    amazonOrderId: o.AmazonOrderId,
    purchaseDate: o.PurchaseDate,
    lastUpdateDate: o.LastUpdateDate,
    orderStatus: o.OrderStatus,
    fulfillmentChannel: o.FulfillmentChannel,
    salesChannel: o.SalesChannel,
    shipServiceLevel: o.ShipServiceLevel,
    orderTotal: o.OrderTotal ? { currencyCode: o.OrderTotal.CurrencyCode, amount: o.OrderTotal.Amount } : undefined,
    numberOfItemsShipped: o.NumberOfItemsShipped,
    numberOfItemsUnshipped: o.NumberOfItemsUnshipped,
    paymentMethod: o.PaymentMethod,
    marketplaceId: o.MarketplaceId,
    buyerEmail: o.BuyerEmail,
    buyerName: o.BuyerName,
    shipmentServiceLevelCategory: o.ShipmentServiceLevelCategory,
    orderType: o.OrderType,
    earliestShipDate: o.EarliestShipDate,
    latestShipDate: o.LatestShipDate,
    earliestDeliveryDate: o.EarliestDeliveryDate,
    latestDeliveryDate: o.LatestDeliveryDate,
    isBusinessOrder: o.IsBusinessOrder,
    isPrime: o.IsPrime,
    isPremiumOrder: o.IsPremiumOrder,
    isGlobalExpressEnabled: o.IsGlobalExpressEnabled,
    isSoldByAB: o.IsSoldByAB,
    isISPU: o.IsISPU,
  };
}
