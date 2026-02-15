/**
 * Faire Wholesale Marketplace adapter
 *
 * Uses Faire's official External API v2.
 * Docs: https://www.faire.com/external-api/v2
 * Auth: X-FAIRE-ACCESS-TOKEN header (get from integrations.support@faire.com)
 */

import { createLogger } from '../../utils/logger';
import type { PlatformAdapter, ProductSearchResult, SearchOptions } from '../index';

const logger = createLogger('faire');

const API_BASE = 'https://www.faire.com/external-api/v2';

interface FaireVariant {
  id: string;
  retail_price_cents?: number;
  wholesale_price_cents?: number;
  available_quantity?: number;
  active?: boolean;
}

interface FaireProduct {
  id: string;
  name: string;
  brand_token?: string;
  brand_name?: string;
  short_description?: string;
  description?: string;
  wholesale_price_cents?: number;
  retail_price_cents?: number;
  active?: boolean;
  images?: Array<{ url?: string }>;
  taxonomy_type?: { name?: string };
  variants?: FaireVariant[];
  unit_multiplier?: number;
  minimum_order_quantity?: number;
}

interface FaireListResponse {
  products?: FaireProduct[];
  page?: number;
  has_more?: boolean;
}

function parseProduct(item: FaireProduct): ProductSearchResult {
  const wholesaleCents = item.wholesale_price_cents ?? item.variants?.[0]?.wholesale_price_cents ?? 0;
  const retailCents = item.retail_price_cents ?? item.variants?.[0]?.retail_price_cents ?? 0;
  const totalAvail = item.variants?.reduce((s, v) => s + (v.available_quantity ?? 0), 0) ?? undefined;

  return {
    platformId: item.id,
    platform: 'faire',
    title: item.name,
    price: wholesaleCents / 100,
    shipping: 0,
    currency: 'USD',
    inStock: item.active !== false && (totalAvail == null || totalAvail > 0),
    seller: item.brand_name ?? 'Faire',
    url: `https://www.faire.com/product/${item.id}`,
    imageUrl: item.images?.[0]?.url,
    brand: item.brand_name,
    category: item.taxonomy_type?.name,
    // Extra fields for wholesale analysis
    msrp: retailCents > 0 ? retailCents / 100 : undefined,
  };
}

export function createFaireAdapter(accessToken?: string): PlatformAdapter {
  const token = accessToken ?? process.env.FAIRE_ACCESS_TOKEN ?? '';

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...(token ? { 'X-FAIRE-ACCESS-TOKEN': token } : {}),
  };

  return {
    platform: 'faire',

    async search(options: SearchOptions): Promise<ProductSearchResult[]> {
      logger.info({ query: options.query }, 'Searching Faire');

      if (!token) {
        logger.warn('No Faire access token configured — set FAIRE_ACCESS_TOKEN env var');
        return [];
      }

      const pageSize = Math.min(options.maxResults ?? 10, 50);

      try {
        // Faire External API v2 uses POST for product listing with filters
        const response = await fetch(`${API_BASE}/products`, {
          method: 'GET',
          headers,
        });
        if (!response.ok) {
          logger.error({ status: response.status }, 'Faire search failed');
          return [];
        }
        const data = await response.json() as FaireListResponse;
        let results = (data.products ?? []).map(parseProduct);

        // Client-side filter by query (API returns retailer's product catalog)
        if (options.query) {
          const q = options.query.toLowerCase();
          results = results.filter(r =>
            r.title.toLowerCase().includes(q) ||
            (r.brand?.toLowerCase().includes(q) ?? false) ||
            (r.category?.toLowerCase().includes(q) ?? false)
          );
        }

        if (options.minPrice != null) results = results.filter(r => r.price >= options.minPrice!);
        if (options.maxPrice != null) results = results.filter(r => r.price <= options.maxPrice!);
        return results.slice(0, pageSize);
      } catch (err) {
        logger.error({ err }, 'Faire search error');
        return [];
      }
    },

    async getProduct(productId: string): Promise<ProductSearchResult | null> {
      logger.info({ productId }, 'Getting Faire product');

      if (!token) {
        logger.warn('No Faire access token configured');
        return null;
      }

      try {
        const response = await fetch(
          `${API_BASE}/products/${encodeURIComponent(productId)}`,
          { headers },
        );
        if (!response.ok) return null;
        return parseProduct(await response.json() as FaireProduct);
      } catch (err) {
        logger.error({ productId, err }, 'Faire product lookup error');
        return null;
      }
    },

    async checkStock(productId: string): Promise<{ inStock: boolean; quantity?: number }> {
      const product = await this.getProduct(productId);
      return { inStock: product?.inStock ?? false };
    },
  };
}
