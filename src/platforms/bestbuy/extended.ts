/**
 * Best Buy Extended API Methods
 *
 * On-sale items, open-box deals, categories, store lookup,
 * and in-store product availability.
 *
 * Uses Best Buy Products API v1 (requires API key from developer.bestbuy.com).
 */

import { createLogger } from '../../utils/logger';

const logger = createLogger('bestbuy-extended');

const API_BASE = 'https://api.bestbuy.com/v1';

// ---- Types ----

export interface BestBuyProductResult {
  sku: number;
  name: string;
  salePrice: number;
  regularPrice: number;
  onSale: boolean;
  percentSavings?: string;
  freeShipping: boolean;
  shippingCost?: number;
  inStoreAvailability: boolean;
  onlineAvailability: boolean;
  url: string;
  image?: string;
  largeFrontImage?: string;
  upc?: string;
  manufacturer?: string;
  categoryPath?: Array<{ id: string; name: string }>;
  customerReviewAverage?: number;
  customerReviewCount?: number;
  condition?: string;
  openBoxPrice?: number;
}

export interface BestBuyCategory {
  id: string;
  name: string;
  url?: string;
  active?: boolean;
  path?: Array<{ id: string; name: string }>;
  subCategories?: BestBuyCategory[];
}

export interface BestBuyStore {
  storeId: number;
  storeType?: string;
  name: string;
  address: string;
  address2?: string;
  city: string;
  region: string;
  fullPostalCode?: string;
  country: string;
  phone?: string;
  lat: number;
  lng: number;
  hours?: string;
  distance?: number;
}

export interface BestBuyStoreAvailability {
  sku: number;
  storeId: number;
  storeName?: string;
  inStoreAvailability: boolean;
  inStoreAvailabilityText?: string;
  inStoreAvailabilityUpdateDate?: string;
}

export interface BestBuyPaginatedResponse<T> {
  from: number;
  to: number;
  currentPage: number;
  totalPages: number;
  total: number;
  items: T[];
}

// ---- API Interface ----

export interface BestBuyExtendedApi {
  getOnSaleItems(params?: {
    categoryId?: string;
    minSalePrice?: number;
    maxSalePrice?: number;
    pageSize?: number;
    page?: number;
  }): Promise<BestBuyPaginatedResponse<BestBuyProductResult>>;

  getOpenBoxItems(params?: {
    categoryId?: string;
    pageSize?: number;
    page?: number;
  }): Promise<BestBuyPaginatedResponse<BestBuyProductResult>>;

  getCategories(parentId?: string): Promise<BestBuyCategory[]>;

  getStores(params?: {
    lat?: number;
    lng?: number;
    radius?: number;
    storeType?: string;
    pageSize?: number;
  }): Promise<BestBuyStore[]>;

  getProductAvailability(sku: string, storeIds?: number[]): Promise<BestBuyStoreAvailability[]>;
}

// ---- Shared fields ----

const PRODUCT_SHOW_FIELDS = [
  'sku', 'name', 'salePrice', 'regularPrice', 'onSale', 'percentSavings',
  'freeShipping', 'shippingCost', 'inStoreAvailability', 'onlineAvailability',
  'url', 'image', 'largeFrontImage', 'upc', 'manufacturer', 'categoryPath',
  'customerReviewAverage', 'customerReviewCount', 'condition',
].join(',');

// ---- Factory ----

export function createBestBuyExtendedApi(apiKey?: string): BestBuyExtendedApi {
  const key = apiKey ?? process.env.BESTBUY_API_KEY ?? '';

  async function bbFetch<T>(url: string): Promise<T> {
    if (!key) {
      throw new Error('Best Buy API key not configured - set BESTBUY_API_KEY env var');
    }
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, error: errorText }, 'Best Buy API request failed');
      throw new Error(`Best Buy API (${response.status}): ${errorText}`);
    }
    return response.json() as Promise<T>;
  }

  function parsePaginatedResponse(data: Record<string, unknown>): BestBuyPaginatedResponse<BestBuyProductResult> {
    return {
      from: (data.from as number) ?? 1,
      to: (data.to as number) ?? 0,
      currentPage: (data.currentPage as number) ?? 1,
      totalPages: (data.totalPages as number) ?? 0,
      total: (data.total as number) ?? 0,
      items: (data.products as BestBuyProductResult[]) ?? [],
    };
  }
  return {
    async getOnSaleItems(params?): Promise<BestBuyPaginatedResponse<BestBuyProductResult>> {
      const filters = ['onSale=true'];
      if (params?.categoryId) filters.push(`categoryPath.id=${encodeURIComponent(params.categoryId)}`);
      if (params?.minSalePrice != null) filters.push(`salePrice>=${params.minSalePrice}`);
      if (params?.maxSalePrice != null) filters.push(`salePrice<=${params.maxSalePrice}`);
      const filterStr = '(' + filters.join('&') + ')';
      const pageSize = Math.min(params?.pageSize ?? 25, 100);
      const page = params?.page ?? 1;
      const url = `${API_BASE}/products${filterStr}?apiKey=${key}&format=json&pageSize=${pageSize}&page=${page}&show=${PRODUCT_SHOW_FIELDS}`;
      try {
        const data = await bbFetch<Record<string, unknown>>(url);
        const result = parsePaginatedResponse(data);
        logger.info({ total: result.total, page, pageSize }, 'Fetched on-sale items');
        return result;
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Get on-sale items failed');
        return { from: 0, to: 0, currentPage: 1, totalPages: 0, total: 0, items: [] };
      }
    },

    async getOpenBoxItems(params?): Promise<BestBuyPaginatedResponse<BestBuyProductResult>> {
      const filters = ['openBox=true'];
      if (params?.categoryId) filters.push(`categoryPath.id=${encodeURIComponent(params.categoryId)}`);
      const filterStr = '(' + filters.join('&') + ')';
      const pageSize = Math.min(params?.pageSize ?? 25, 100);
      const page = params?.page ?? 1;
      const url = `${API_BASE}/products${filterStr}?apiKey=${key}&format=json&pageSize=${pageSize}&page=${page}&show=${PRODUCT_SHOW_FIELDS}`;
      try {
        const data = await bbFetch<Record<string, unknown>>(url);
        const result = parsePaginatedResponse(data);
        logger.info({ total: result.total, page, pageSize }, 'Fetched open-box items');
        return result;
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Get open-box items failed');
        return { from: 0, to: 0, currentPage: 1, totalPages: 0, total: 0, items: [] };
      }
    },

    async getCategories(parentId?: string): Promise<BestBuyCategory[]> {
      let url;
      if (parentId) {
        url = `${API_BASE}/categories(id=${encodeURIComponent(parentId)})?apiKey=${key}&format=json&show=id,name,url,active,path,subCategories`;
      } else {
        url = `${API_BASE}/categories?apiKey=${key}&format=json&show=id,name,url,active,path,subCategories&pageSize=100`;
      }
      try {
        const data = await bbFetch<Record<string, unknown>>(url);
        const categories = (data.categories as BestBuyCategory[]) ?? [];
        logger.info({ count: categories.length, parentId: parentId ?? 'root' }, 'Fetched categories');
        return categories;
      } catch (err) {
        logger.error({ parentId, error: err instanceof Error ? err.message : String(err) }, 'Get categories failed');
        return [];
      }
    },

    async getStores(params?): Promise<BestBuyStore[]> {
      let areaFilter = '';
      if (params?.lat != null && params?.lng != null) {
        const radius = params?.radius ?? 25;
        areaFilter = `&area(${params.lat},${params.lng},${radius})`;
      }
      const pageSize = Math.min(params?.pageSize ?? 25, 100);
      let storeTypeFilter = '';
      if (params?.storeType) {
        storeTypeFilter = `(storeType="${encodeURIComponent(params.storeType)}")`;
      }
      const showFields = 'storeId,storeType,name,address,address2,city,region,fullPostalCode,country,phone,lat,lng,hours,distance';
      const url = `${API_BASE}/stores${storeTypeFilter}?apiKey=${key}&format=json&pageSize=${pageSize}${areaFilter}&show=${showFields}`;
      try {
        const data = await bbFetch<Record<string, unknown>>(url);
        const stores = (data.stores as BestBuyStore[]) ?? [];
        logger.info({ count: stores.length }, 'Fetched stores');
        return stores;
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Get stores failed');
        return [];
      }
    },

    async getProductAvailability(sku: string, storeIds?: number[]): Promise<BestBuyStoreAvailability[]> {
      const showFields = 'sku,storeId,storeName,inStoreAvailability,inStoreAvailabilityText,inStoreAvailabilityUpdateDate';
      let url;
      if (storeIds && storeIds.length > 0) {
        const storeFilter = storeIds.map(id => `storeId=${id}`).join('|');
        url = `${API_BASE}/products/${encodeURIComponent(sku)}/stores.json?apiKey=${key}&show=${showFields}&${storeFilter}`;
      } else {
        url = `${API_BASE}/products/${encodeURIComponent(sku)}/stores.json?apiKey=${key}&show=${showFields}`;
      }
      try {
        const data = await bbFetch<Record<string, unknown>>(url);
        const availability = (data.stores as BestBuyStoreAvailability[]) ?? [];
        logger.info({ sku, storeCount: availability.length }, 'Fetched product availability');
        return availability;
      } catch (err) {
        logger.error({ sku, error: err instanceof Error ? err.message : String(err) }, 'Get product availability failed');
        return [];
      }
    },
  };
}
