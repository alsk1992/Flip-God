/**
 * Walmart Marketplace API - Extended Methods
 *
 * Adds repricer strategies, unpublished items, listing quality scores,
 * catalog search, and pricing insights beyond what seller.ts covers.
 *
 * Auth: OAuth2 Bearer token via ./auth.ts
 * Base: https://marketplace.walmartapis.com/v3/
 */

import { createLogger } from '../../utils/logger';
import { randomUUID } from 'crypto';
import { getWalmartMarketplaceToken } from './auth';
import type { WalmartCredentials } from '../../types';

const logger = createLogger('walmart-marketplace-extended');

const API_BASE = 'https://marketplace.walmartapis.com/v3';

// ---- Types ----

export interface WalmartRepricerStrategy {
  strategyId?: string;
  name: string;
  type: 'BUY_BOX_ELIGIBLE' | 'COMPETITIVE_PRICING';
  enabled: boolean;
  repriceOptions: Record<string, unknown>;
}

export interface WalmartUnpublishedItem {
  sku?: string;
  productName?: string;
  lifecycleStatus?: string;
  publishedStatus?: string;
}

export interface WalmartListingQualityScoreItem {
  sku?: string;
  productName?: string;
  score?: number;
  postPurchaseScore?: number;
  contentScore?: number;
  offerScore?: number;
  ratingReviewsScore?: number;
  issues?: Array<{ issueType: string; issueDescription: string }>;
}

export interface WalmartCatalogSearchResult {
  itemId?: string;
  upc?: string;
  gtin?: string;
  productName?: string;
  brand?: string;
  category?: string;
}

export interface WalmartPricingInsight {
  sku: string;
  currentPrice?: number;
  competitorPrice?: number;
  buyBoxPrice?: number;
  recommendation?: string;
}

// ---- API Interface ----

export interface WalmartMarketplaceExtendedApi {
  // Repricer
  createRepricerStrategy(strategy: WalmartRepricerStrategy): Promise<WalmartRepricerStrategy>;
  getRepricerStrategies(): Promise<WalmartRepricerStrategy[]>;
  assignItemsToStrategy(strategyId: string, skus: string[]): Promise<boolean>;

  // Items
  getUnpublishedItems(params?: { limit?: number; offset?: number }): Promise<{ items: WalmartUnpublishedItem[]; totalItems?: number }>;

  // Insights
  getListingQualityScore(params?: { limit?: number; offset?: number }): Promise<{ items: WalmartListingQualityScoreItem[]; totalItems?: number }>;

  // Catalog
  catalogSearch(query: string): Promise<WalmartCatalogSearchResult[]>;

  // Pricing
  getPricingInsights(skus: string[]): Promise<WalmartPricingInsight[]>;
}

// ---- Factory ----

export function createWalmartMarketplaceExtendedApi(credentials: WalmartCredentials): WalmartMarketplaceExtendedApi {
  function getAuthConfig() {
    return {
      clientId: credentials.sellerClientId ?? credentials.clientId,
      clientSecret: credentials.sellerClientSecret ?? credentials.clientSecret,
    };
  }

  async function marketplaceFetch<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
    const accessToken = await getWalmartMarketplaceToken(getAuthConfig());
    const url = `${API_BASE}${path}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
      'WM_SVC.NAME': 'Walmart Marketplace',
      'WM_QOS.CORRELATION_ID': randomUUID(),
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
      logger.error({ status: response.status, path, error: errorText }, 'Walmart Marketplace Extended API request failed');
      throw new Error(`Walmart Marketplace API (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  return {
    // ---- Repricer ----

    async createRepricerStrategy(strategy: WalmartRepricerStrategy): Promise<WalmartRepricerStrategy> {
      return marketplaceFetch<WalmartRepricerStrategy>('/repricer/strategy', {
        method: 'POST',
        body: strategy,
      });
    },

    async getRepricerStrategies(): Promise<WalmartRepricerStrategy[]> {
      try {
        const data = await marketplaceFetch<{ strategies?: WalmartRepricerStrategy[] }>('/repricer/strategy');
        return data.strategies ?? [];
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Get repricer strategies failed');
        return [];
      }
    },

    async assignItemsToStrategy(strategyId: string, skus: string[]): Promise<boolean> {
      try {
        await marketplaceFetch(
          `/repricer/strategy/${encodeURIComponent(strategyId)}/items`,
          {
            method: 'POST',
            body: { items: skus.map(sku => ({ sku })) },
          },
        );
        logger.info({ strategyId, skuCount: skus.length }, 'Items assigned to repricer strategy');
        return true;
      } catch (err) {
        logger.error({ strategyId, error: err instanceof Error ? err.message : String(err) }, 'Assign items to strategy failed');
        return false;
      }
    },

    // ---- Unpublished Items ----

    async getUnpublishedItems(params?): Promise<{ items: WalmartUnpublishedItem[]; totalItems?: number }> {
      const query = new URLSearchParams({
        lifecycleStatus: 'RETIRED',
        limit: String(params?.limit ?? 20),
        offset: String(params?.offset ?? 0),
      });

      try {
        const data = await marketplaceFetch<{
          ItemResponse?: Array<{
            items?: { item?: WalmartUnpublishedItem[] };
            totalItems?: number;
          }>;
        }>(`/items?${query.toString()}`);

        const resp = data.ItemResponse?.[0];
        return {
          items: resp?.items?.item ?? [],
          totalItems: resp?.totalItems,
        };
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Get unpublished items failed');
        return { items: [] };
      }
    },

    // ---- Listing Quality Score ----

    async getListingQualityScore(params?): Promise<{ items: WalmartListingQualityScoreItem[]; totalItems?: number }> {
      const query = new URLSearchParams({
        limit: String(params?.limit ?? 20),
        offset: String(params?.offset ?? 0),
      });

      try {
        const data = await marketplaceFetch<{
          payload?: WalmartListingQualityScoreItem[];
          totalItems?: number;
        }>(`/insights/items/listingQuality/score?${query.toString()}`);

        return {
          items: data.payload ?? [],
          totalItems: data.totalItems,
        };
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Get listing quality score failed');
        return { items: [] };
      }
    },

    // ---- Catalog Search ----

    async catalogSearch(query: string): Promise<WalmartCatalogSearchResult[]> {
      const params = new URLSearchParams({
        query,
        limit: '20',
      });

      try {
        const data = await marketplaceFetch<{
          items?: WalmartCatalogSearchResult[];
        }>(`/items/walmart/search?${params.toString()}`);
        return data.items ?? [];
      } catch (err) {
        logger.error({ query, error: err instanceof Error ? err.message : String(err) }, 'Catalog search failed');
        return [];
      }
    },

    // ---- Pricing Insights ----

    async getPricingInsights(skus: string[]): Promise<WalmartPricingInsight[]> {
      if (skus.length === 0) return [];

      try {
        const data = await marketplaceFetch<{
          items?: WalmartPricingInsight[];
        }>('/pricing/insights', {
          method: 'POST',
          body: { items: skus.map(sku => ({ sku })) },
        });
        return data.items ?? [];
      } catch (err) {
        logger.error({ skuCount: skus.length, error: err instanceof Error ? err.message : String(err) }, 'Get pricing insights failed');
        return [];
      }
    },
  };
}
