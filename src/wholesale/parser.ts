/**
 * Wholesale Price List Parser
 *
 * Parses CSV/TSV distributor price lists into structured WholesaleItem arrays.
 * Auto-detects column mappings or accepts explicit mappings.
 */

import { createLogger } from '../utils/logger';
import type { WholesaleItem, ColumnMapping } from './types';

const logger = createLogger('wholesale-parser');

// Common column header aliases
const COLUMN_ALIASES: Record<keyof ColumnMapping, string[]> = {
  sku: ['sku', 'item_number', 'item_no', 'item#', 'itemno', 'product_id', 'productid', 'part_number', 'partno', 'model'],
  upc: ['upc', 'upc_code', 'upc-a', 'barcode', 'gtin', 'ean_upc'],
  ean: ['ean', 'ean_code', 'ean13', 'international_barcode'],
  asin: ['asin', 'amazon_asin', 'amz_asin'],
  title: ['title', 'name', 'product_name', 'product_title', 'description', 'item_name', 'item_description', 'product'],
  brand: ['brand', 'brand_name', 'manufacturer', 'mfg', 'vendor'],
  category: ['category', 'dept', 'department', 'product_type', 'class'],
  price: ['price', 'cost', 'wholesale_price', 'unit_cost', 'unit_price', 'your_cost', 'net_price', 'dealer_cost', 'wholesale'],
  msrp: ['msrp', 'retail', 'retail_price', 'list_price', 'suggested_retail', 'srp', 'map'],
  moq: ['moq', 'min_qty', 'minimum_order', 'min_order_qty', 'minimum'],
  casePackQty: ['case_pack', 'case_qty', 'pack_qty', 'units_per_case', 'case_pack_qty', 'inner_pack'],
  weight: ['weight', 'weight_lbs', 'item_weight', 'ship_weight', 'gross_weight'],
};

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function autoDetectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const normalized = headers.map(normalizeHeader);

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as Array<[keyof ColumnMapping, string[]]>) {
    for (let i = 0; i < normalized.length; i++) {
      if (aliases.includes(normalized[i])) {
        mapping[field] = headers[i];
        break;
      }
    }
  }

  return mapping;
}

function detectDelimiter(firstLine: string): string {
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const pipeCount = (firstLine.match(/\|/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;

  if (tabCount > commaCount && tabCount > pipeCount) return '\t';
  if (pipeCount > commaCount) return '|';
  if (semiCount > commaCount) return ';';
  return ',';
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parsePrice(value: string): number {
  if (!value) return 0;
  const cleaned = value.replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function parseInteger(value: string): number | undefined {
  if (!value) return undefined;
  const num = parseInt(value.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Parse a wholesale price list CSV/TSV string into structured items.
 */
export function parseWholesaleCSV(
  csvContent: string,
  explicitMapping?: ColumnMapping,
): { items: WholesaleItem[]; mapping: ColumnMapping; delimiter: string; errors: string[] } {
  const errors: string[] = [];
  const lines = csvContent.split(/\r?\n/).filter(l => l.trim().length > 0);

  if (lines.length < 2) {
    return { items: [], mapping: {}, delimiter: ',', errors: ['File has fewer than 2 lines'] };
  }

  const delimiter = detectDelimiter(lines[0]);
  const headers = parseCSVLine(lines[0], delimiter);
  const mapping = explicitMapping ?? autoDetectMapping(headers);

  logger.info({ headers: headers.length, rows: lines.length - 1, delimiter, mapping }, 'Parsing wholesale CSV');

  // Build column index map
  const colIndex: Partial<Record<keyof ColumnMapping, number>> = {};
  for (const [field, headerName] of Object.entries(mapping) as Array<[keyof ColumnMapping, string]>) {
    if (!headerName) continue;
    const idx = headers.findIndex(h => h === headerName || normalizeHeader(h) === normalizeHeader(headerName));
    if (idx >= 0) colIndex[field] = idx;
  }

  if (!colIndex.title && !colIndex.sku) {
    errors.push('Could not detect title or SKU column. Please provide explicit column mapping.');
    return { items: [], mapping, delimiter, errors };
  }

  if (!colIndex.price) {
    errors.push('Could not detect price column. Please provide explicit column mapping.');
    return { items: [], mapping, delimiter, errors };
  }

  const items: WholesaleItem[] = [];

  for (let i = 1; i < lines.length; i++) {
    try {
      const fields = parseCSVLine(lines[i], delimiter);

      const price = parsePrice(fields[colIndex.price!] ?? '');
      if (price <= 0) {
        errors.push(`Row ${i + 1}: Invalid or missing price`);
        continue;
      }

      const title = fields[colIndex.title ?? -1]?.trim() ?? '';
      const sku = fields[colIndex.sku ?? -1]?.trim() ?? `ROW-${i}`;

      if (!title && !sku) continue;

      items.push({
        sku,
        upc: fields[colIndex.upc ?? -1]?.trim().replace(/[^0-9]/g, '') || undefined,
        ean: fields[colIndex.ean ?? -1]?.trim().replace(/[^0-9]/g, '') || undefined,
        asin: fields[colIndex.asin ?? -1]?.trim().toUpperCase() || undefined,
        title: title || sku,
        brand: fields[colIndex.brand ?? -1]?.trim() || undefined,
        category: fields[colIndex.category ?? -1]?.trim() || undefined,
        wholesalePrice: price,
        msrp: colIndex.msrp != null ? parsePrice(fields[colIndex.msrp] ?? '') || undefined : undefined,
        moq: colIndex.moq != null ? parseInteger(fields[colIndex.moq] ?? '') : undefined,
        casePackQty: colIndex.casePackQty != null ? parseInteger(fields[colIndex.casePackQty] ?? '') : undefined,
        weight: colIndex.weight != null ? parseFloat(fields[colIndex.weight] ?? '') || undefined : undefined,
      });
    } catch (err) {
      errors.push(`Row ${i + 1}: Parse error — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  logger.info({ parsed: items.length, errors: errors.length }, 'Wholesale CSV parsed');
  return { items, mapping, delimiter, errors };
}

/**
 * Get auto-detected column mapping for a CSV file (without full parsing).
 */
export function detectColumnMapping(csvFirstLine: string): { mapping: ColumnMapping; delimiter: string } {
  const delimiter = detectDelimiter(csvFirstLine);
  const headers = parseCSVLine(csvFirstLine, delimiter);
  const mapping = autoDetectMapping(headers);
  return { mapping, delimiter };
}
