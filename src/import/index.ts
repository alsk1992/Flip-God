/**
 * CSV/Spreadsheet Bulk Import - Tool definitions and handler
 *
 * Exports tool definitions array and handler function for integration
 * into the agent tool system.
 */

import { createLogger } from '../utils/logger';
import type { Database } from '../db/index';
import { parseCsv } from './csv-parser';
import { bulkImportProducts, exportProductsCsv } from './bulk-importer';
import type { Delimiter } from './types';

const logger = createLogger('import');

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const csvImportTools = [
  {
    name: 'import_csv',
    description: 'Import products from CSV/spreadsheet data',
    input_schema: {
      type: 'object' as const,
      properties: {
        csv_data: { type: 'string' as const, description: 'Raw CSV content' },
        delimiter: {
          type: 'string' as const,
          enum: ['auto', 'comma', 'tab', 'pipe'],
          default: 'auto',
          description: 'CSV delimiter (auto-detected by default)',
        },
        has_header: {
          type: 'boolean' as const,
          default: true,
          description: 'Whether the first row is a header',
        },
        dry_run: {
          type: 'boolean' as const,
          default: false,
          description: 'Validate only without writing to database',
        },
        scan_prices: {
          type: 'boolean' as const,
          default: false,
          description: 'Trigger price scan after import',
        },
      },
      required: ['csv_data'],
    },
  },
  {
    name: 'export_products_csv',
    description: 'Export products from database to CSV format',
    input_schema: {
      type: 'object' as const,
      properties: {
        filter: {
          type: 'string' as const,
          description: 'Category or search filter',
        },
        columns: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Columns to include in export',
        },
        format: {
          type: 'string' as const,
          enum: ['csv', 'tsv'],
          default: 'csv',
          description: 'Output format',
        },
      },
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleCsvImportTool(
  name: string,
  input: Record<string, unknown>,
  db: Database,
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'import_csv': {
      const csvData = input.csv_data as string;
      if (!csvData || csvData.trim().length === 0) {
        return { error: 'csv_data is required and cannot be empty' };
      }

      const delimiter = (input.delimiter as Delimiter) ?? 'auto';
      const hasHeader = (input.has_header as boolean) ?? true;
      const dryRun = (input.dry_run as boolean) ?? false;
      const scanPrices = (input.scan_prices as boolean) ?? false;

      logger.info({ delimiter, hasHeader, dryRun, scanPrices }, 'Processing CSV import');

      // Step 1: Parse CSV
      const parseResult = parseCsv(csvData, { delimiter, hasHeader });

      if (parseResult.valid.length === 0 && parseResult.errors.length > 0) {
        return {
          success: false,
          message: 'No valid rows found in CSV',
          stats: parseResult.stats,
          errors: parseResult.errors.slice(0, 20), // Limit error output
        };
      }

      // Step 2: Import into DB
      const importResult = await bulkImportProducts(db, parseResult.valid, {
        dryRun,
        scanPrices,
      });

      return {
        success: true,
        dryRun,
        message: dryRun
          ? `Dry run complete. Would import ${importResult.imported} new and update ${importResult.updated} existing products.`
          : `Imported ${importResult.imported} new products and updated ${importResult.updated} existing products.`,
        parseStats: parseResult.stats,
        importResult: {
          imported: importResult.imported,
          updated: importResult.updated,
          skipped: importResult.skipped,
          errorCount: importResult.errors.length,
          productIds: importResult.productIds.slice(0, 50), // Limit output
        },
        errors: [
          ...parseResult.errors.slice(0, 10),
          ...importResult.errors.slice(0, 10),
        ],
        scanPricesQueued: scanPrices && !dryRun ? importResult.productIds.length : 0,
      };
    }

    case 'export_products_csv': {
      const filter = input.filter as string | undefined;
      const columns = input.columns as string[] | undefined;
      const format = (input.format as 'csv' | 'tsv') ?? 'csv';

      logger.info({ filter, columns, format }, 'Exporting products to CSV');

      try {
        const csvOutput = exportProductsCsv(db, { filter, columns, format });
        const rowCount = csvOutput.split('\n').length - 1; // Subtract header

        return {
          success: true,
          format,
          rowCount: Math.max(0, rowCount),
          csv_data: csvOutput,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ error: msg }, 'CSV export failed');
        return { success: false, error: msg };
      }
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// Re-export core functions for direct usage
export { parseCsv } from './csv-parser';
export { bulkImportProducts, exportProductsCsv } from './bulk-importer';
export type {
  ProductImportRow,
  ImportError,
  ImportStats,
  ImportOptions,
  ImportResult,
  Delimiter,
  ColumnMapping,
} from './types';
