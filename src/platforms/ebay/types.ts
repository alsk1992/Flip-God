/**
 * eBay API response types (Browse API + Inventory API + Fulfillment API)
 */

export interface EbayItem {
  itemId: string;
  title: string;
  price: number;
  shippingCost: number;
  condition: string;
  seller: string;
  url: string;
  imageUrl?: string;
  category?: string;
  upc?: string;
}

// Browse API search response
export interface EbaySearchResponse {
  href?: string;
  total: number;
  limit: number;
  offset: number;
  itemSummaries?: EbayItemSummary[];
  warnings?: EbayApiError[];
}

export interface EbayItemSummary {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  image?: { imageUrl: string };
  thumbnailImages?: Array<{ imageUrl: string }>;
  shippingOptions?: Array<{
    shippingCostType?: string;
    shippingCost?: { value: string; currency: string };
  }>;
  condition?: string;
  conditionId?: string;
  seller?: { username: string; feedbackPercentage: string; feedbackScore: number };
  itemWebUrl?: string;
  itemLocation?: { city?: string; stateOrProvince?: string; country?: string };
  categories?: Array<{ categoryId: string; categoryName: string }>;
  epid?: string;
  itemGroupType?: string;
  buyingOptions?: string[];
}

// Browse API get item response
export interface EbayItemDetail {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  description?: string;
  image?: { imageUrl: string };
  additionalImages?: Array<{ imageUrl: string }>;
  condition?: string;
  conditionDescription?: string;
  seller?: { username: string; feedbackPercentage: string; feedbackScore: number };
  itemWebUrl?: string;
  categoryPath?: string;
  brand?: string;
  mpn?: string;
  gtin?: string;
  upc?: string[];
  estimatedAvailabilities?: Array<{
    estimatedAvailabilityStatus?: string;
    estimatedSoldQuantity?: number;
    estimatedAvailableQuantity?: number;
  }>;
  shippingOptions?: Array<{
    shippingServiceCode?: string;
    type?: string;
    shippingCost?: { value: string; currency: string };
    minEstimatedDeliveryDate?: string;
    maxEstimatedDeliveryDate?: string;
  }>;
}

// Inventory API types
export interface EbayInventoryItem {
  sku: string;
  locale?: string;
  product: {
    title: string;
    description?: string;
    imageUrls?: string[];
    aspects?: Record<string, string[]>;
    brand?: string;
    mpn?: string;
    upc?: string[];
  };
  condition?: 'NEW' | 'LIKE_NEW' | 'VERY_GOOD' | 'GOOD' | 'ACCEPTABLE' | 'FOR_PARTS_OR_NOT_WORKING';
  availability: {
    shipToLocationAvailability: {
      quantity: number;
    };
  };
}

export interface EbayOffer {
  offerId?: string;
  sku: string;
  marketplaceId: 'EBAY_US' | 'EBAY_GB' | 'EBAY_DE' | 'EBAY_AU';
  format: 'FIXED_PRICE';
  listingDescription?: string;
  pricingSummary: {
    price: { value: string; currency: string };
  };
  quantityLimitPerBuyer?: number;
  listingPolicies: {
    fulfillmentPolicyId: string;
    paymentPolicyId: string;
    returnPolicyId: string;
  };
  categoryId: string;
  merchantLocationKey?: string;
}

export interface EbayPublishResponse {
  listingId: string;
  warnings?: EbayApiError[];
}

// Fulfillment API types
export interface EbayOrdersResponse {
  href?: string;
  total: number;
  limit: number;
  offset: number;
  orders?: EbayOrder[];
}

export interface EbayOrder {
  orderId: string;
  creationDate: string;
  orderFulfillmentStatus: 'NOT_STARTED' | 'IN_PROGRESS' | 'FULFILLED';
  orderPaymentStatus: 'FULLY_REFUNDED' | 'PAID' | 'PARTIALLY_REFUNDED';
  buyer?: { username: string };
  pricingSummary?: {
    total?: { value: string; currency: string };
    deliveryCost?: { value: string; currency: string };
  };
  lineItems: Array<{
    lineItemId: string;
    title: string;
    quantity: number;
    lineItemCost?: { value: string; currency: string };
    sku?: string;
  }>;
  fulfillmentStartInstructions?: Array<{
    shippingStep?: {
      shipTo?: {
        fullName?: string;
        contactAddress?: {
          addressLine1?: string;
          addressLine2?: string;
          city?: string;
          stateOrProvince?: string;
          postalCode?: string;
          countryCode?: string;
        };
      };
    };
  }>;
}

export interface EbayShippingFulfillment {
  lineItems: Array<{ lineItemId: string; quantity: number }>;
  shippedDate: string;
  shippingCarrierCode: string;
  trackingNumber: string;
}

export interface EbayApiError {
  errorId?: number;
  domain?: string;
  category?: string;
  message?: string;
  longMessage?: string;
}
