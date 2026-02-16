/**
 * Barcode / UPC Scanning Types
 */

export interface BarcodeResult {
  barcode: string;
  format: 'UPC-A' | 'EAN-13' | 'unknown';
  found: boolean;
  title?: string;
  brand?: string;
  category?: string;
  description?: string;
  images?: string[];
  stores?: BarcodeStore[];
  cachedAt?: Date;
}

export interface BarcodeStore {
  name: string;
  price?: number;
  currency?: string;
  url?: string;
  lastUpdated?: string;
}

export interface BarcodeLookupOptions {
  /** Check local DB cache first (default: true) */
  useCache?: boolean;
  /** Also scan prices across platforms after lookup */
  scanPrices?: boolean;
}

export interface UpcApiResponse {
  code: string;
  total: number;
  offset: number;
  items?: UpcApiItem[];
}

export interface UpcApiItem {
  ean: string;
  title: string;
  description?: string;
  upc?: string;
  brand?: string;
  model?: string;
  color?: string;
  size?: string;
  dimension?: string;
  weight?: string;
  category?: string;
  currency?: string;
  lowest_recorded_price?: number;
  highest_recorded_price?: number;
  images?: string[];
  offers?: UpcApiOffer[];
}

export interface UpcApiOffer {
  merchant: string;
  domain: string;
  title: string;
  currency: string;
  list_price: string;
  price: number;
  shipping?: string;
  condition?: string;
  availability?: string;
  link: string;
  updated_t: number;
}
