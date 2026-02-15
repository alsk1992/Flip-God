/**
 * Faire Extended API Methods
 *
 * Paginated product listing, wholesale order management, shipment tracking,
 * brand profile, and inventory level queries.
 *
 * Uses Faire External API v2.
 * Docs: https://www.faire.com/external-api/v2
 * Auth: X-FAIRE-ACCESS-TOKEN header
 */

import { createLogger } from '../../utils/logger';

const logger = createLogger('faire-extended');

const API_BASE = 'https://www.faire.com/external-api/v2';

// ---- Types ----

export interface FaireProduct {
  id: string;
  name: string;
  brand_token?: string;
  brand_name?: string;
  short_description?: string;
  description?: string;
  wholesale_price_cents?: number;
  retail_price_cents?: number;
  active?: boolean;
  images?: Array<{ url?: string; width?: number; height?: number }>;
  taxonomy_type?: { name?: string };
  variants?: FaireVariant[];
  unit_multiplier?: number;
  minimum_order_quantity?: number;
  created_at?: string;
  updated_at?: string;
}

export interface FaireVariant {
  id: string;
  name?: string;
  retail_price_cents?: number;
  wholesale_price_cents?: number;
  available_quantity?: number;
  active?: boolean;
  sku?: string;
  option_values?: Array<{ name?: string; value?: string }>;
}

export interface FaireOrder {
  id: string;
  display_id?: string;
  state?: string;
  ship_after?: string;
  ship_by?: string;
  created_at?: string;
  updated_at?: string;
  address?: {
    name?: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
    company_name?: string;
  };
  items?: FaireOrderItem[];
  payout_costs?: {
    payout_fee_cents?: number;
    commission_cents?: number;
    payout_total_cents?: number;
  };
}

export interface FaireOrderItem {
  id: string;
  product_id?: string;
  variant_id?: string;
  quantity?: number;
  price_cents?: number;
  product_name?: string;
  variant_name?: string;
  sku?: string;
  state?: string;
}

export interface FaireShipmentUpdate {
  tracking_number: string;
  carrier: string;
}

export interface FaireBrand {
  token?: string;
  name?: string;
  created_at?: string;
  minimum_order_amount_cents?: number;
  first_order_minimum_amount_cents?: number;
  reorder_minimum_amount_cents?: number;
  active?: boolean;
  description?: string;
  website?: string;
  address?: {
    city?: string;
    state?: string;
    country?: string;
  };
}

export interface FaireInventoryLevel {
  product_id: string;
  variant_id?: string;
  sku?: string;
  current_quantity?: number;
  discontinued?: boolean;
  updated_at?: string;
}

export interface FairePaginatedResponse<T> {
  page: number;
  has_more: boolean;
  items: T[];
}

// ---- API Interface ----

export interface FaireExtendedApi {
  getProductsPaginated(params?: {
    page?: number;
    pageSize?: number;
  }): Promise<FairePaginatedResponse<FaireProduct>>;

  getOrders(params?: {
    page?: number;
    pageSize?: number;
  }): Promise<FairePaginatedResponse<FaireOrder>>;

  getOrder(orderId: string): Promise<FaireOrder | null>;

  shipOrderItem(orderId: string, itemId: string, tracking: FaireShipmentUpdate): Promise<boolean>;

  getBrand(): Promise<FaireBrand | null>;

  getInventoryLevels(productId?: string): Promise<FaireInventoryLevel[]>;
}

// ---- Factory ----

export function createFaireExtendedApi(accessToken?: string): FaireExtendedApi {
  const token = accessToken ?? process.env.FAIRE_ACCESS_TOKEN ?? '';

  function getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['X-FAIRE-ACCESS-TOKEN'] = token;
    }
    return headers;
  }

  function ensureToken(): void {
    if (!token) {
      throw new Error('Faire access token not configured - set FAIRE_ACCESS_TOKEN env var');
    }
  }

  async function faireFetch<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T> {
    ensureToken();
    const url = `${API_BASE}${path}`;
    const headers = getHeaders();
    const init: RequestInit = { method: options?.method ?? 'GET', headers };
    if (options?.body) {
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(url, init);
    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, path, error: errorText }, 'Faire API request failed');
      throw new Error(`Faire API (${response.status}): ${errorText}`);
    }
    return response.json() as Promise<T>;
  }

  return {
    async getProductsPaginated(params?): Promise<FairePaginatedResponse<FaireProduct>> {
      const query = new URLSearchParams();
      query.set('page', String(params?.page ?? 1));
      query.set('page_size', String(Math.min(params?.pageSize ?? 50, 50)));

      try {
        const data = await faireFetch<{
          products?: FaireProduct[];
          page?: number;
          has_more?: boolean;
        }>(`/products?${query.toString()}`);

        const result: FairePaginatedResponse<FaireProduct> = {
          page: data.page ?? (params?.page ?? 1),
          has_more: data.has_more ?? false,
          items: data.products ?? [],
        };
        logger.info({ page: result.page, count: result.items.length, hasMore: result.has_more }, 'Fetched products page');
        return result;
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Get products paginated failed');
        return { page: params?.page ?? 1, has_more: false, items: [] };
      }
    },

    async getOrders(params?): Promise<FairePaginatedResponse<FaireOrder>> {
      const query = new URLSearchParams();
      query.set('page', String(params?.page ?? 1));
      if (params?.pageSize) query.set('page_size', String(Math.min(params.pageSize, 50)));

      try {
        const data = await faireFetch<{
          orders?: FaireOrder[];
          page?: number;
          has_more?: boolean;
        }>(`/orders?${query.toString()}`);

        const result: FairePaginatedResponse<FaireOrder> = {
          page: data.page ?? (params?.page ?? 1),
          has_more: data.has_more ?? false,
          items: data.orders ?? [],
        };
        logger.info({ page: result.page, count: result.items.length, hasMore: result.has_more }, 'Fetched orders page');
        return result;
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Get orders failed');
        return { page: params?.page ?? 1, has_more: false, items: [] };
      }
    },

    async getOrder(orderId: string): Promise<FaireOrder | null> {
      try {
        const order = await faireFetch<FaireOrder>(`/orders/${encodeURIComponent(orderId)}`);
        logger.info({ orderId, state: order.state }, 'Fetched order detail');
        return order;
      } catch (err) {
        logger.error({ orderId, error: err instanceof Error ? err.message : String(err) }, 'Get order failed');
        return null;
      }
    },

    async shipOrderItem(orderId: string, itemId: string, tracking: FaireShipmentUpdate): Promise<boolean> {
      try {
        await faireFetch(
          `/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/ship`,
          {
            method: 'PATCH',
            body: {
              tracking_number: tracking.tracking_number,
              carrier: tracking.carrier,
            },
          },
        );
        logger.info({ orderId, itemId, carrier: tracking.carrier }, 'Order item shipped');
        return true;
      } catch (err) {
        logger.error({ orderId, itemId, error: err instanceof Error ? err.message : String(err) }, 'Ship order item failed');
        return false;
      }
    },

    async getBrand(): Promise<FaireBrand | null> {
      try {
        const brand = await faireFetch<FaireBrand>('/brand');
        logger.info({ name: brand.name }, 'Fetched brand profile');
        return brand;
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Get brand failed');
        return null;
      }
    },

    async getInventoryLevels(productId?: string): Promise<FaireInventoryLevel[]> {
      try {
        let path = '/brand/inventory-levels';
        if (productId) {
          path += `?product_id=${encodeURIComponent(productId)}`;
        }
        const data = await faireFetch<{
          inventory_levels?: FaireInventoryLevel[];
        }>(path);
        const levels = data.inventory_levels ?? [];
        logger.info({ count: levels.length, productId: productId ?? 'all' }, 'Fetched inventory levels');
        return levels;
      } catch (err) {
        logger.error({ productId, error: err instanceof Error ? err.message : String(err) }, 'Get inventory levels failed');
        return [];
      }
    },
  };
}
