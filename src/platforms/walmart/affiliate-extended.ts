/**
 * Walmart Affiliate API - Extended Methods
 *
 * Adds reviews, stores, and recommendations endpoints
 * not covered by the base extended.ts module.
 *
 * Auth: apiKey header (same as scraper/extended).
 * Base: https://developer.api.walmart.com/api-proxy/service/affil/product/v2/
 */

import { createLogger } from '../../utils/logger';
import type { WalmartCredentials } from '../../types';
import type { WalmartApiItem } from './types';

const logger = createLogger('walmart-affiliate-extended');

const API_BASE = 'https://developer.api.walmart.com';

// ---- Types ----

export interface WalmartReview {
  title?: string;
  reviewer?: string;
  reviewText?: string;
  overallRating?: { label?: string; rating: number; range?: string };
  submissionTime?: string;
  positiveVotes?: number;
  negativeVotes?: number;
}

export interface WalmartReviewsResponse {
  itemId: string;
  name?: string;
  salePrice?: number;
  upc?: string;
  categoryPath?: string;
  brandName?: string;
  productTrackingUrl?: string;
  productUrl?: string;
  customerRating?: string;
  numReviews?: number;
  reviews?: WalmartReview[];
  nextPage?: string;
}

export interface WalmartStore {
  no: number;
  name?: string;
  streetAddress?: string;
  city?: string;
  stateProvCode?: string;
  zip?: string;
  country?: string;
  phoneNumber?: string;
  coordinates?: { lat: number; lon: number };
  storeType?: string;
  distance?: number;
}

export interface WalmartStoresResponse {
  stores?: WalmartStore[];
}

// ---- API Interface ----

export interface WalmartAffiliateExtendedApi {
  getReviews(itemId: string): Promise<WalmartReviewsResponse | null>;
  getStores(params?: { zip?: string; lat?: number; lon?: number }): Promise<WalmartStore[]>;
  getRecommendations(itemId: string): Promise<WalmartApiItem[]>;
}

// ---- Factory ----

export function createWalmartAffiliateExtendedApi(credentials: WalmartCredentials): WalmartAffiliateExtendedApi {
  const headers: Record<string, string> = {
    'apiKey': credentials.clientId,
    'Accept': 'application/json',
  };

  async function fetchAffiliate<T>(path: string): Promise<T> {
    const url = `${API_BASE}${path}`;

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });

    if (!response.ok) {
      const errorText = (await response.text().catch(() => '')).slice(0, 200);
      logger.error({ status: response.status, path }, 'Walmart Affiliate API request failed');
      throw new Error(`Walmart Affiliate API (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  return {
    async getReviews(itemId: string): Promise<WalmartReviewsResponse | null> {
      try {
        return await fetchAffiliate<WalmartReviewsResponse>(
          `/api-proxy/service/affil/product/v2/reviews/${encodeURIComponent(itemId)}`,
        );
      } catch (err) {
        logger.error({ itemId, error: err instanceof Error ? err.message : String(err) }, 'Get reviews failed');
        return null;
      }
    },

    async getStores(params?): Promise<WalmartStore[]> {
      const query = new URLSearchParams();
      if (params?.zip) query.set('zip', params.zip);
      if (params?.lat != null) query.set('lat', String(params.lat));
      if (params?.lon != null) query.set('lon', String(params.lon));

      const qs = query.toString();
      if (!qs) {
        logger.warn('getStores called without zip, lat, or lon');
        return [];
      }

      try {
        const data = await fetchAffiliate<WalmartStoresResponse>(
          `/api-proxy/service/affil/product/v2/stores?${qs}`,
        );
        return data.stores ?? [];
      } catch (err) {
        logger.error({ params, error: err instanceof Error ? err.message : String(err) }, 'Get stores failed');
        return [];
      }
    },

    async getRecommendations(itemId: string): Promise<WalmartApiItem[]> {
      try {
        const data = await fetchAffiliate<{ items?: WalmartApiItem[] }>(
          `/api-proxy/service/affil/product/v2/nbp?itemId=${encodeURIComponent(itemId)}`,
        );
        return data.items ?? [];
      } catch (err) {
        logger.error({ itemId, error: err instanceof Error ? err.message : String(err) }, 'Get recommendations failed');
        return [];
      }
    },
  };
}
