/**
 * Barcode/UPC Scanning - Tool definitions and handler
 *
 * Exports tool definitions array and handler function for integration
 * into the agent tool system.
 */

import { createLogger } from '../utils/logger';
import type { Database } from '../db/index';
import { lookupUPC, batchLookupUPC, validateBarcode } from './barcode-lookup';

const logger = createLogger('scanning');

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const scanningTools = [
  {
    name: 'scan_barcode',
    description: 'Look up product info by UPC/EAN barcode',
    input_schema: {
      type: 'object' as const,
      properties: {
        barcode: {
          type: 'string' as const,
          description: 'UPC or EAN barcode number',
        },
        scan_prices: {
          type: 'boolean' as const,
          default: true,
          description: 'Also scan prices across platforms',
        },
      },
      required: ['barcode'],
    },
  },
  {
    name: 'batch_barcode_lookup',
    description: 'Look up multiple barcodes at once',
    input_schema: {
      type: 'object' as const,
      properties: {
        barcodes: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'List of UPC/EAN barcodes',
        },
      },
      required: ['barcodes'],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleScanningTool(
  name: string,
  input: Record<string, unknown>,
  db: Database,
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'scan_barcode': {
      const barcode = input.barcode as string;
      if (!barcode || barcode.trim().length === 0) {
        return { error: 'barcode is required' };
      }

      const cleaned = barcode.replace(/[\s-]/g, '');
      const format = validateBarcode(cleaned);

      if (!format) {
        return {
          error: `Invalid barcode format: "${barcode}". Expected 8-digit (UPC-E), 12-digit (UPC-A), or 13-digit (EAN-13) number.`,
        };
      }

      const scanPrices = (input.scan_prices as boolean) ?? true;

      logger.info({ barcode: cleaned, format, scanPrices }, 'Scanning barcode');

      try {
        const result = await lookupUPC(cleaned, db, { scanPrices });

        if (!result.found) {
          return {
            success: true,
            found: false,
            barcode: cleaned,
            format: result.format,
            message: `No product found for barcode ${cleaned}. It may not be in the UPCitemdb database.`,
          };
        }

        return {
          success: true,
          found: true,
          barcode: result.barcode,
          format: result.format,
          title: result.title,
          brand: result.brand,
          category: result.category,
          description: result.description,
          images: result.images,
          stores: result.stores?.map((s) => ({
            name: s.name,
            price: s.price,
            currency: s.currency,
            url: s.url,
          })),
          cachedAt: result.cachedAt?.toISOString(),
          scanPricesQueued: scanPrices,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ barcode: cleaned, error: msg }, 'Barcode scan failed');
        return { success: false, error: msg };
      }
    }

    case 'batch_barcode_lookup': {
      const barcodes = input.barcodes as string[];
      if (!barcodes || !Array.isArray(barcodes) || barcodes.length === 0) {
        return { error: 'barcodes array is required and must not be empty' };
      }

      if (barcodes.length > 50) {
        return { error: 'Maximum 50 barcodes per batch request' };
      }

      // Validate all barcodes first
      const invalid: string[] = [];
      const valid: string[] = [];

      for (const bc of barcodes) {
        const cleaned = String(bc).replace(/[\s-]/g, '');
        if (validateBarcode(cleaned)) {
          valid.push(cleaned);
        } else {
          invalid.push(bc);
        }
      }

      if (valid.length === 0) {
        return {
          error: 'No valid barcodes in the batch',
          invalidBarcodes: invalid,
        };
      }

      logger.info({ total: barcodes.length, valid: valid.length, invalid: invalid.length }, 'Batch barcode lookup');

      try {
        const results = await batchLookupUPC(valid, db);

        const found = results.filter((r) => r.found);
        const notFound = results.filter((r) => !r.found);

        return {
          success: true,
          total: valid.length,
          found: found.length,
          notFound: notFound.length,
          invalidBarcodes: invalid.length > 0 ? invalid : undefined,
          results: results.map((r) => ({
            barcode: r.barcode,
            format: r.format,
            found: r.found,
            title: r.title,
            brand: r.brand,
            category: r.category,
            stores: r.stores?.length ?? 0,
          })),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ error: msg }, 'Batch barcode lookup failed');
        return { success: false, error: msg };
      }
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// Re-export core functions for direct usage
export { lookupUPC, batchLookupUPC, validateBarcode } from './barcode-lookup';
export type {
  BarcodeResult,
  BarcodeStore,
  BarcodeLookupOptions,
} from './types';
