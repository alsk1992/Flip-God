/**
 * Facebook Marketplace adapter — GraphQL API
 *
 * Uses Facebook's internal GraphQL endpoint (reverse-engineered).
 * Based on: github.com/kyleronayne/marketplace-api (50 stars, active 2026)
 *
 * Search: POST https://www.facebook.com/api/graphql/  doc_id=7111939778879383
 * Location: POST https://www.facebook.com/api/graphql/  doc_id=5585904654783609
 *
 * No login required for search. Results include: id, title, price, image, seller, location.
 */

import { createLogger } from '../../utils/logger';
import type { PlatformAdapter, ProductSearchResult, SearchOptions } from '../index';

const logger = createLogger('facebook');

const GRAPHQL_URL = 'https://www.facebook.com/api/graphql/';
const LOCATION_DOC_ID = '5585904654783609';
const SEARCH_DOC_ID = '7111939778879383';

// Default to broad US location (center of US)
const DEFAULT_LAT = 39.8283;
const DEFAULT_LNG = -98.5795;
const DEFAULT_RADIUS_KM = 100; // ~60 miles

interface FBMarketplaceListing {
  id: string;
  marketplace_listing_title?: string;
  listing_price?: {
    amount?: string;
    currency?: string;
  };
  custom_title?: string;
  primary_listing_photo?: {
    image?: { uri?: string };
  };
  is_pending?: boolean;
  location?: {
    reverse_geocode?: {
      city_page?: { display_name?: string };
    };
  };
  marketplace_listing_seller?: {
    name?: string;
    __typename?: string;
  };
  pre_recorded_label?: {
    amount?: string;
    currency?: string;
  };
}

function parseListing(node: FBMarketplaceListing): ProductSearchResult {
  const priceStr = node.listing_price?.amount ?? node.pre_recorded_label?.amount ?? '0';
  const price = (parseFloat(priceStr) || 0) / 100;

  return {
    platformId: node.id,
    platform: 'amazon' as any,
    title: node.marketplace_listing_title ?? node.custom_title ?? '',
    price,
    shipping: 0, // FB Marketplace is mostly local pickup
    currency: node.listing_price?.currency ?? 'USD',
    inStock: !node.is_pending,
    seller: node.marketplace_listing_seller?.name,
    url: `https://www.facebook.com/marketplace/item/${node.id}/`,
    imageUrl: node.primary_listing_photo?.image?.uri,
  };
}

const COMMON_HEADERS: Record<string, string> = {
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Sec-Fetch-Site': 'same-origin',
  'Origin': 'https://www.facebook.com',
  'Referer': 'https://www.facebook.com/marketplace/',
};

interface LocationResult {
  name: string;
  latitude: number;
  longitude: number;
}

async function lookupLocation(query: string): Promise<LocationResult | null> {
  const variables = JSON.stringify({
    params: {
      caller: 'MARKETPLACE',
      page_category: ['CITY', 'SUBCITY', 'NEIGHBORHOOD', 'POSTAL_CODE'],
      query,
    },
  });

  const body = new URLSearchParams({
    doc_id: LOCATION_DOC_ID,
    variables,
  });

  try {
    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: COMMON_HEADERS,
      body: body.toString(),
    });
    if (!response.ok) return null;

    const data = await response.json() as any;
    const edges = data?.data?.city_street_search?.street_results?.edges;
    if (!edges?.length) return null;

    const loc = edges[0].node;
    return {
      name: loc?.single_line_address ?? loc?.subtitle_text ?? query,
      latitude: loc?.location?.latitude ?? DEFAULT_LAT,
      longitude: loc?.location?.longitude ?? DEFAULT_LNG,
    };
  } catch {
    return null;
  }
}

export interface FacebookSearchOptions extends SearchOptions {
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  locationQuery?: string;
}

export function createFacebookAdapter(options?: {
  latitude?: number;
  longitude?: number;
}): PlatformAdapter {
  const defaultLat = options?.latitude ?? DEFAULT_LAT;
  const defaultLng = options?.longitude ?? DEFAULT_LNG;

  return {
    platform: 'amazon' as any,

    async search(opts: SearchOptions): Promise<ProductSearchResult[]> {
      logger.info({ query: opts.query }, 'Searching Facebook Marketplace');

      const fbOpts = opts as FacebookSearchOptions;
      let lat = fbOpts.latitude ?? defaultLat;
      let lng = fbOpts.longitude ?? defaultLng;

      // Resolve location from query if provided
      if (fbOpts.locationQuery) {
        const loc = await lookupLocation(fbOpts.locationQuery);
        if (loc) {
          lat = loc.latitude;
          lng = loc.longitude;
        }
      }

      const radiusKm = fbOpts.radiusKm ?? DEFAULT_RADIUS_KM;
      const count = Math.min(opts.maxResults ?? 24, 50);

      // Price bounds — FB uses cents (integer cents * 100)
      const minPrice = opts.minPrice != null ? Math.round(opts.minPrice * 100) : 0;
      const maxPrice = opts.maxPrice != null ? Math.round(opts.maxPrice * 100) : 214748364700;

      const variables = JSON.stringify({
        count,
        params: {
          bqf: { callsite: 'COMMERCE_MKTPLACE_WWW', query: opts.query },
          browse_request_params: {
            commerce_enable_local_pickup: true,
            commerce_enable_shipping: true,
            commerce_search_and_rp_available: true,
            commerce_search_and_rp_condition: null,
            commerce_search_and_rp_ctime_days: null,
            filter_location_latitude: lat,
            filter_location_longitude: lng,
            filter_price_lower_bound: minPrice,
            filter_price_upper_bound: maxPrice,
            filter_radius_km: radiusKm,
          },
          custom_request_params: {
            surface: 'SEARCH',
            search_vertical: 'C2C',
          },
        },
      });

      const body = new URLSearchParams({
        doc_id: SEARCH_DOC_ID,
        variables,
      });

      try {
        const response = await fetch(GRAPHQL_URL, {
          method: 'POST',
          headers: COMMON_HEADERS,
          body: body.toString(),
        });

        if (!response.ok) {
          logger.error({ status: response.status }, 'Facebook Marketplace search failed');
          return [];
        }

        const data = await response.json() as any;
        const edges = data?.data?.marketplace_search?.feed_units?.edges ?? [];

        const results: ProductSearchResult[] = [];
        for (const edge of edges) {
          const node = edge?.node;
          if (!node || node.__typename !== 'MarketplaceFeedListingStoryObject') continue;
          const listing = node.listing;
          if (!listing) continue;
          results.push(parseListing(listing));
        }

        return results;
      } catch (err) {
        logger.error({ err }, 'Facebook Marketplace search error');
        return [];
      }
    },

    async getProduct(productId: string): Promise<ProductSearchResult | null> {
      logger.info({ productId }, 'Getting Facebook Marketplace listing');
      // FB GraphQL doesn't have a single-item lookup doc_id in the public repos.
      // Search by ID as workaround.
      try {
        const results = await this.search({ query: productId, maxResults: 5 });
        return results.find(r => r.platformId === productId) ?? results[0] ?? null;
      } catch (err) {
        logger.error({ productId, err }, 'Facebook product lookup error');
        return null;
      }
    },

    async checkStock(productId: string): Promise<{ inStock: boolean; quantity?: number }> {
      const product = await this.getProduct(productId);
      return { inStock: product?.inStock ?? false };
    },
  };
}
