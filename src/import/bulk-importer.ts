/**
 * Bulk Importer - Upsert parsed CSV rows into the product database
 *
 * Supports dry-run mode, progress tracking, and optional price scan triggers.
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger';
import type { Database } from '../db/index';
import type { Product } from '../types';
import type { ProductImportRow, ImportOptions, ImportResult, ImportError } from './types';

const logger = createLogger('bulk-importer');

/**
 * Import parsed product rows into the database.
 *
 * @param db - Database instance
 * @param rows - Validated product rows from csv-parser
 * @param options - Import options (dry run, batch size, progress callback)
 * @returns Import result with counts and product IDs
 */
export async function bulkImportProducts(
  db: Database,
  rows: ProductImportRow[],
  options: ImportOptions = {},
): Promise<ImportResult> {
  const {
    dryRun = false,
    batchSize = 50,
    onProgress,
  } = options;

  logger.info(
    { rowCount: rows.length, dryRun, batchSize },
    'Starting bulk import',
  );

  const result: ImportResult = {
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    productIds: [],
  };

  if (rows.length === 0) {
    onProgress?.(100);
    return result;
  }

  const totalBatches = Math.ceil(rows.length / batchSize);

  for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
    const start = batchIdx * batchSize;
    const end = Math.min(start + batchSize, rows.length);
    const batch = rows.slice(start, end);

    for (const row of batch) {
      try {
        // Check if product already exists by UPC or ASIN
        let existingProduct: Product | undefined;

        if (row.upc) {
          existingProduct = db.findProductByUPC(row.upc);
        }
        if (!existingProduct && row.asin) {
          existingProduct = db.findProductByASIN(row.asin);
        }

        if (dryRun) {
          // In dry-run mode, just count what would happen
          if (existingProduct) {
            result.updated++;
            result.productIds.push(existingProduct.id);
          } else {
            result.imported++;
            result.productIds.push(`dry-run-${row.rowNumber}`);
          }
          continue;
        }

        const now = new Date();
        const product: Product = {
          id: existingProduct?.id ?? randomUUID(),
          title: row.title,
          upc: row.upc ?? existingProduct?.upc,
          asin: row.asin ?? existingProduct?.asin,
          brand: row.brand ?? existingProduct?.brand,
          category: row.category ?? existingProduct?.category,
          imageUrl: row.imageUrl ?? existingProduct?.imageUrl,
          createdAt: existingProduct?.createdAt ?? now,
          updatedAt: now,
        };

        db.upsertProduct(product);
        result.productIds.push(product.id);

        if (existingProduct) {
          result.updated++;
        } else {
          result.imported++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ row: row.rowNumber, error: msg }, 'Failed to import row');
        result.errors.push({
          row: row.rowNumber,
          column: 'general',
          value: row.title,
          message: `Import failed: ${msg}`,
        });
        result.skipped++;
      }
    }

    // Report progress
    const pct = Math.round(((batchIdx + 1) / totalBatches) * 100);
    onProgress?.(pct);
  }

  logger.info(
    {
      imported: result.imported,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors.length,
      dryRun,
    },
    'Bulk import complete',
  );

  return result;
}

/**
 * Export products from the database as CSV-formatted string.
 *
 * @param db - Database instance
 * @param options - Export options (filter, columns, format)
 * @returns CSV string
 */
export function exportProductsCsv(
  db: Database,
  options: {
    filter?: string;
    columns?: string[];
    format?: 'csv' | 'tsv';
  } = {},
): string {
  const { filter, format = 'csv' } = options;
  const delimiter = format === 'tsv' ? '\t' : ',';

  // Default columns if not specified
  const defaultColumns = ['id', 'title', 'upc', 'asin', 'brand', 'category', 'created_at', 'updated_at'];
  const columns = options.columns ?? defaultColumns;

  // Build query
  let sql = 'SELECT * FROM products';
  const params: string[] = [];

  if (filter && filter.trim().length > 0) {
    sql += ' WHERE category LIKE ? OR title LIKE ?';
    const likeParam = `%${filter}%`;
    params.push(likeParam, likeParam);
  }

  sql += ' ORDER BY updated_at DESC';

  const rows = db.query<Record<string, unknown>>(sql, params);

  if (rows.length === 0) {
    return columns.join(delimiter);
  }

  // Build CSV
  const lines: string[] = [];

  // Header
  lines.push(columns.map((col) => escapeField(col, delimiter)).join(delimiter));

  // Data rows
  for (const row of rows) {
    const values = columns.map((col) => {
      const value = row[col];
      if (value === null || value === undefined) return '';
      return escapeField(String(value), delimiter);
    });
    lines.push(values.join(delimiter));
  }

  return lines.join('\n');
}

/**
 * Escape a CSV field value. Wraps in quotes if it contains the delimiter,
 * quotes, or newlines.
 */
function escapeField(value: string, delimiter: string): string {
  if (
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r')
  ) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
