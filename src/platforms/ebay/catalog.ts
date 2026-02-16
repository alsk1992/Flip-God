/**
 * eBay Catalog API — Product catalog search and retrieval
 *
 * Endpoints:
 * - GET /commerce/catalog/v1_beta/product_summary/search — search product catalog
 * - GET /commerce/catalog/v1_beta/product/{epid} — get product by ePID
 */

import { createLogger } from '../../utils/logger';
import type { EbayCredentials } from '../../types';
import { getAccessToken, API_BASE } from './auth';

const logger = createLogger('ebay-catalog');

export interface EbayCatalogProduct {
  epid: string;
  title: string;
  image?: { imageUrl: string };
  aspects?: Record<string, string[]>;
  brand?: string;
  mpn?: string;
  gtin?: string[];
  upc?: string[];
  ean?: string[];
  isbn?: string[];
  description?: string;
  additionalImages?: Array<{ imageUrl: string }>;
  productWebUrl?: string;
}

export interface EbayCatalogProductSummary {
  epid: string;
  title: string;
  image?: { imageUrl: string };
  aspects?: Record<string, string[]>;
  productWebUrl?: string;
}

export interface EbayCatalogSearchParams {
  limit?: number;
  offset?: number;
  categoryId?: string;
  fieldgroups?: string;
}

export interface EbayCatalogApi {
  searchCatalog(query: string, params?: EbayCatalogSearchParams): Promise<EbayCatalogProductSummary[]>;
  getCatalogProduct(epid: string): Promise<EbayCatalogProduct | null>;
}

export function createEbayCatalogApi(credentials: EbayCredentials): EbayCatalogApi {
  const env = credentials.environment ?? 'production';
  const baseUrl = API_BASE[env];

  async function getToken(): Promise<string> {
    return getAccessToken({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      environment: env,
    });
  }

  return {
    async searchCatalog(query, params?) {
      try {
        const token = await getToken();
        const qp = new URLSearchParams();
        qp.set('q', query);
        qp.set('limit', String(params?.limit ?? 20));
        if (params?.offset) qp.set('offset', String(params.offset));
        if (params?.categoryId) qp.set('category_id', params.categoryId);
        if (params?.fieldgroups) qp.set('fieldgroups', params.fieldgroups);

        const response = await fetch(
          `${baseUrl}/commerce/catalog/v1_beta/product_summary/search?${qp.toString()}`,
          { headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
        );

        if (!response.ok) {
          const errorText = (await response.text().catch(() => '')).slice(0, 200);
          logger.error({ status: response.status, query }, 'Failed to search catalog');
          return [];
        }

        const data = await response.json() as { productSummaries?: EbayCatalogProductSummary[] };
        return data.productSummaries ?? [];
      } catch (err) {
        logger.error({ err, query }, 'Error in searchCatalog');
        return [];
      }
    },

    async getCatalogProduct(epid) {
      try {
        const token = await getToken();
        const response = await fetch(
          `${baseUrl}/commerce/catalog/v1_beta/product/${encodeURIComponent(epid)}`,
          { headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
        );

        if (!response.ok) {
          const errorText = (await response.text().catch(() => '')).slice(0, 200);
          logger.error({ status: response.status, epid }, 'Failed to get catalog product');
          return null;
        }

        return await response.json() as EbayCatalogProduct;
      } catch (err) {
        logger.error({ err, epid }, 'Error in getCatalogProduct');
        return null;
      }
    },
  };
}
