/**
 * CSV/Spreadsheet Bulk Import Types
 */

export interface ProductImportRow {
  /** Row number from the original CSV (1-based, header excluded) */
  rowNumber: number;
  title: string;
  upc?: string;
  asin?: string;
  sku?: string;
  price?: number;
  quantity?: number;
  category?: string;
  condition?: 'new' | 'used' | 'refurbished';
  description?: string;
  brand?: string;
  imageUrl?: string;
}

export interface ImportError {
  row: number;
  column: string;
  value: string;
  message: string;
}

export interface ImportStats {
  totalRows: number;
  validRows: number;
  errorRows: number;
  skippedRows: number;
  errors: ImportError[];
}

export interface ImportOptions {
  /** If true, validate only without writing to DB */
  dryRun?: boolean;
  /** Trigger price scans for imported products */
  scanPrices?: boolean;
  /** Batch size for DB upserts */
  batchSize?: number;
  /** Progress callback (0-100) */
  onProgress?: (pct: number) => void;
}

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
  productIds: string[];
}

export type Delimiter = 'auto' | 'comma' | 'tab' | 'pipe';

export interface ColumnMapping {
  /** Index in the CSV row (0-based) */
  index: number;
  /** Target field name */
  field: keyof ProductImportRow;
}
