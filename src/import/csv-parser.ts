/**
 * CSV Parser - Parse CSV/TSV/pipe-delimited files and map columns to product fields
 *
 * Handles:
 * - Auto-detection of delimiter (comma, tab, pipe)
 * - UTF-8 BOM stripping
 * - Windows (\r\n) and Unix (\n) line endings
 * - Flexible column name mapping ("Product Name" -> title, "UPC Code" -> upc)
 * - Quoted fields with embedded delimiters/newlines
 * - Row validation (required fields, numeric checks, UPC format)
 */

import { createLogger } from '../utils/logger';
import type {
  ProductImportRow,
  ImportError,
  ImportStats,
  Delimiter,
  ColumnMapping,
} from './types';

const logger = createLogger('csv-parser');

// ---------------------------------------------------------------------------
// Column name aliases -> canonical field
// ---------------------------------------------------------------------------

const COLUMN_ALIASES: Record<string, keyof ProductImportRow> = {
  // title
  'title': 'title',
  'name': 'title',
  'product': 'title',
  'product name': 'title',
  'product_name': 'title',
  'product title': 'title',
  'product_title': 'title',
  'item': 'title',
  'item name': 'title',
  'item_name': 'title',
  'listing title': 'title',
  'listing_title': 'title',

  // upc
  'upc': 'upc',
  'upc code': 'upc',
  'upc_code': 'upc',
  'barcode': 'upc',
  'ean': 'upc',
  'ean code': 'upc',
  'ean_code': 'upc',
  'gtin': 'upc',

  // asin
  'asin': 'asin',
  'amazon asin': 'asin',
  'amazon_asin': 'asin',

  // sku
  'sku': 'sku',
  'product sku': 'sku',
  'product_sku': 'sku',
  'item sku': 'sku',
  'item_sku': 'sku',
  'seller sku': 'sku',
  'seller_sku': 'sku',

  // price
  'price': 'price',
  'cost': 'price',
  'unit price': 'price',
  'unit_price': 'price',
  'sale price': 'price',
  'sale_price': 'price',
  'list price': 'price',
  'list_price': 'price',
  'retail price': 'price',
  'retail_price': 'price',
  'msrp': 'price',

  // quantity
  'quantity': 'quantity',
  'qty': 'quantity',
  'stock': 'quantity',
  'inventory': 'quantity',
  'count': 'quantity',
  'available': 'quantity',
  'units': 'quantity',

  // category
  'category': 'category',
  'product category': 'category',
  'product_category': 'category',
  'type': 'category',
  'product type': 'category',
  'product_type': 'category',
  'department': 'category',

  // condition
  'condition': 'condition',
  'item condition': 'condition',
  'item_condition': 'condition',
  'product condition': 'condition',
  'product_condition': 'condition',

  // description
  'description': 'description',
  'product description': 'description',
  'product_description': 'description',
  'desc': 'description',
  'details': 'description',
  'notes': 'description',

  // brand
  'brand': 'brand',
  'manufacturer': 'brand',
  'brand name': 'brand',
  'brand_name': 'brand',
  'make': 'brand',
  'vendor': 'brand',

  // imageUrl
  'image': 'imageUrl',
  'image url': 'imageUrl',
  'image_url': 'imageUrl',
  'imageurl': 'imageUrl',
  'photo': 'imageUrl',
  'photo url': 'imageUrl',
  'photo_url': 'imageUrl',
  'picture': 'imageUrl',
  'thumbnail': 'imageUrl',
};

// ---------------------------------------------------------------------------
// Delimiter detection
// ---------------------------------------------------------------------------

const DELIMITER_MAP: Record<string, string> = {
  comma: ',',
  tab: '\t',
  pipe: '|',
};

/**
 * Auto-detect delimiter by counting occurrences in the first few lines.
 * Prefers comma > tab > pipe if counts are equal.
 */
function detectDelimiter(text: string): string {
  // Take up to 10 lines for sampling
  const sampleLines = text.split(/\r?\n/).slice(0, 10).filter(Boolean);
  if (sampleLines.length === 0) return ',';

  const candidates = [',', '\t', '|'];
  let bestDelimiter = ',';
  let bestScore = -1;

  for (const delim of candidates) {
    // Count how many times each delimiter appears per line, and check consistency
    const counts = sampleLines.map((line) => {
      let count = 0;
      let inQuotes = false;
      for (const ch of line) {
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === delim && !inQuotes) {
          count++;
        }
      }
      return count;
    });

    // All lines should have the same count (consistency check)
    const uniqueCounts = new Set(counts);
    const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length;

    // Score: higher average count + bonus for consistency
    const consistencyBonus = uniqueCounts.size === 1 ? 10 : 0;
    const score = avgCount + consistencyBonus;

    if (score > bestScore && avgCount > 0) {
      bestScore = score;
      bestDelimiter = delim;
    }
  }

  return bestDelimiter;
}

// ---------------------------------------------------------------------------
// CSV line parser (handles quoted fields)
// ---------------------------------------------------------------------------

/**
 * Parse a single CSV line into fields, respecting quoted values.
 * Handles embedded delimiters, newlines within quotes, and escaped quotes ("").
 */
function parseFields(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ""
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
        i++;
        continue;
      }
      current += ch;
      i++;
    } else {
      if (ch === '"' && current.length === 0) {
        inQuotes = true;
        i++;
        continue;
      }
      if (ch === delimiter) {
        fields.push(current.trim());
        current = '';
        i++;
        continue;
      }
      current += ch;
      i++;
    }
  }

  fields.push(current.trim());
  return fields;
}

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

function buildColumnMappings(headers: string[]): ColumnMapping[] {
  const mappings: ColumnMapping[] = [];
  const usedFields = new Set<string>();

  for (let i = 0; i < headers.length; i++) {
    const raw = headers[i].trim();
    const normalized = raw.toLowerCase().replace(/[^a-z0-9\s_]/g, '').trim();

    const field = COLUMN_ALIASES[normalized];
    if (field && !usedFields.has(field)) {
      mappings.push({ index: i, field });
      usedFields.add(field);
    }
  }

  return mappings;
}

// ---------------------------------------------------------------------------
// Row validation
// ---------------------------------------------------------------------------

const VALID_CONDITIONS = new Set(['new', 'used', 'refurbished']);

function normalizeCondition(value: string): 'new' | 'used' | 'refurbished' | undefined {
  const lower = value.toLowerCase().trim();
  if (lower === 'new' || lower === 'brand new') return 'new';
  if (lower === 'used' || lower === 'pre-owned' || lower === 'preowned') return 'used';
  if (
    lower === 'refurbished' ||
    lower === 'renewed' ||
    lower === 'refurb' ||
    lower === 'certified refurbished'
  ) {
    return 'refurbished';
  }
  if (VALID_CONDITIONS.has(lower)) return lower as 'new' | 'used' | 'refurbished';
  return undefined;
}

/**
 * Validate a UPC/EAN barcode format.
 * - UPC-A: 12 digits
 * - EAN-13: 13 digits
 * - Also accepts 8-digit UPC-E
 */
function isValidBarcode(code: string): boolean {
  const cleaned = code.replace(/[\s-]/g, '');
  return /^\d{8}$/.test(cleaned) || /^\d{12}$/.test(cleaned) || /^\d{13}$/.test(cleaned);
}

function validateRow(
  row: Partial<ProductImportRow>,
  rowNumber: number,
): ImportError[] {
  const errors: ImportError[] = [];

  // Title is required
  if (!row.title || row.title.trim().length === 0) {
    errors.push({
      row: rowNumber,
      column: 'title',
      value: row.title ?? '',
      message: 'Title is required and cannot be empty',
    });
  }

  // Price validation
  if (row.price !== undefined) {
    if (!Number.isFinite(row.price) || row.price < 0) {
      errors.push({
        row: rowNumber,
        column: 'price',
        value: String(row.price ?? ''),
        message: 'Price must be a non-negative number',
      });
    }
  }

  // Quantity validation
  if (row.quantity !== undefined) {
    if (!Number.isFinite(row.quantity) || row.quantity < 0 || !Number.isInteger(row.quantity)) {
      errors.push({
        row: rowNumber,
        column: 'quantity',
        value: String(row.quantity ?? ''),
        message: 'Quantity must be a non-negative integer',
      });
    }
  }

  // UPC format validation
  if (row.upc && row.upc.trim().length > 0 && !isValidBarcode(row.upc)) {
    errors.push({
      row: rowNumber,
      column: 'upc',
      value: row.upc,
      message: 'Invalid UPC/EAN format. Expected 8, 12, or 13 digit code',
    });
  }

  // Condition validation
  if (row.condition !== undefined && !VALID_CONDITIONS.has(row.condition)) {
    errors.push({
      row: rowNumber,
      column: 'condition',
      value: String(row.condition),
      message: 'Condition must be one of: new, used, refurbished',
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

export interface ParseResult {
  valid: ProductImportRow[];
  errors: ImportError[];
  stats: ImportStats;
}

export interface ParseOptions {
  delimiter?: Delimiter;
  hasHeader?: boolean;
}

/**
 * Parse CSV data into validated product import rows.
 *
 * @param csvData - Raw CSV string content
 * @param options - Parsing options (delimiter, header detection)
 * @returns Parsed rows, errors, and import statistics
 */
export function parseCsv(csvData: string, options: ParseOptions = {}): ParseResult {
  const { delimiter: delimiterOption = 'auto', hasHeader = true } = options;

  // Strip UTF-8 BOM
  let data = csvData;
  if (data.charCodeAt(0) === 0xfeff) {
    data = data.slice(1);
  }

  // Normalize line endings
  data = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Determine delimiter
  const delimiter =
    delimiterOption === 'auto'
      ? detectDelimiter(data)
      : DELIMITER_MAP[delimiterOption] ?? ',';

  logger.info({ delimiter: delimiter === '\t' ? 'tab' : delimiter, hasHeader }, 'Parsing CSV');

  // Split into lines
  const lines = data.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return {
      valid: [],
      errors: [],
      stats: { totalRows: 0, validRows: 0, errorRows: 0, skippedRows: 0, errors: [] },
    };
  }

  // Parse header
  let mappings: ColumnMapping[];
  let dataStartIndex: number;

  if (hasHeader) {
    const headerFields = parseFields(lines[0], delimiter);
    mappings = buildColumnMappings(headerFields);
    dataStartIndex = 1;

    if (mappings.length === 0) {
      logger.warn({ headers: headerFields }, 'No recognized columns found in header');
      return {
        valid: [],
        errors: [{
          row: 0,
          column: 'header',
          value: headerFields.join(', '),
          message: 'No recognized column names found. Expected columns like: title, upc, asin, price, quantity, category, condition',
        }],
        stats: { totalRows: 0, validRows: 0, errorRows: 0, skippedRows: 0, errors: [] },
      };
    }

    logger.info(
      { columns: mappings.map((m) => `${m.field}[${m.index}]`) },
      'Column mappings detected',
    );
  } else {
    // Without header, assume first columns map in order: title, upc, asin, sku, price, quantity, category, condition, description
    const defaultOrder: Array<keyof ProductImportRow> = [
      'title', 'upc', 'asin', 'sku', 'price', 'quantity', 'category', 'condition', 'description',
    ];
    const firstRowFields = parseFields(lines[0], delimiter);
    mappings = defaultOrder
      .slice(0, firstRowFields.length)
      .map((field, index) => ({ index, field }));
    dataStartIndex = 0;
  }

  // Parse data rows
  const valid: ProductImportRow[] = [];
  const allErrors: ImportError[] = [];
  let skippedRows = 0;

  for (let i = dataStartIndex; i < lines.length; i++) {
    const rowNumber = hasHeader ? i : i + 1;
    const fields = parseFields(lines[i], delimiter);

    // Skip completely empty rows
    if (fields.every((f) => f.length === 0)) {
      skippedRows++;
      continue;
    }

    // Map fields to row object
    const row: Partial<ProductImportRow> = { rowNumber };

    for (const mapping of mappings) {
      const rawValue = fields[mapping.index];
      if (rawValue === undefined || rawValue.length === 0) continue;

      switch (mapping.field) {
        case 'title':
        case 'upc':
        case 'asin':
        case 'sku':
        case 'category':
        case 'description':
        case 'brand':
        case 'imageUrl':
          (row as Record<string, unknown>)[mapping.field] = rawValue;
          break;

        case 'price': {
          // Strip currency symbols and commas
          const cleaned = rawValue.replace(/[$,\s]/g, '');
          const parsed = parseFloat(cleaned);
          if (Number.isFinite(parsed)) {
            row.price = parsed;
          } else {
            row.price = NaN; // Will be caught by validation
          }
          break;
        }

        case 'quantity': {
          const cleaned = rawValue.replace(/[,\s]/g, '');
          const parsed = parseInt(cleaned, 10);
          if (Number.isFinite(parsed)) {
            row.quantity = parsed;
          } else {
            row.quantity = NaN; // Will be caught by validation
          }
          break;
        }

        case 'condition': {
          const normalized = normalizeCondition(rawValue);
          if (normalized) {
            row.condition = normalized;
          }
          break;
        }

        default:
          break;
      }
    }

    // Validate
    const rowErrors = validateRow(row, rowNumber);

    if (rowErrors.length > 0) {
      allErrors.push(...rowErrors);
    } else {
      valid.push(row as ProductImportRow);
    }
  }

  const totalRows = lines.length - dataStartIndex;

  const stats: ImportStats = {
    totalRows,
    validRows: valid.length,
    errorRows: allErrors.length > 0 ? totalRows - valid.length - skippedRows : 0,
    skippedRows,
    errors: allErrors,
  };

  logger.info(
    { total: stats.totalRows, valid: stats.validRows, errors: stats.errorRows, skipped: stats.skippedRows },
    'CSV parsing complete',
  );

  return { valid, errors: allErrors, stats };
}
