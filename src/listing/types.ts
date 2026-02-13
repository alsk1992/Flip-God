export interface ListingDraft {
  title: string;
  description: string;
  price: number;
  category: string;
  imageUrls: string[];
  condition: 'new' | 'used' | 'refurbished';
  quantity: number;
  shippingPrice?: number;
}

export interface ListingResult {
  success: boolean;
  listingId?: string;
  url?: string;
  error?: string;
}

export interface PricingRecommendation {
  recommendedPrice: number;
  minPrice: number;
  maxPrice: number;
  competitorPrices: number[];
  margin: number;
}
