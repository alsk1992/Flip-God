/**
 * Export Formats - CSV, Excel XML, and formatting helpers
 *
 * Pure TypeScript, no external dependencies.
 */

import type { CSVOptions, ExcelSheet } from './types.js';

// =============================================================================
// CSV GENERATION
// =============================================================================

/**
 * Generate a CSV string from headers and rows.
 */
export function generateCSV(
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>,
  options: CSVOptions = {},
): string {
  const delimiter = options.delimiter ?? ',';
  const quoteChar = options.quoteChar ?? '"';
  const includeHeader = options.includeHeader ?? true;

  function escapeField(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) {
      return '';
    }

    const str = String(value);

    // Quote if contains delimiter, quote char, or newline
    if (
      str.includes(delimiter) ||
      str.includes(quoteChar) ||
      str.includes('\n') ||
      str.includes('\r')
    ) {
      const escaped = str.replace(
        new RegExp(quoteChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
        quoteChar + quoteChar,
      );
      return `${quoteChar}${escaped}${quoteChar}`;
    }

    return str;
  }

  const lines: string[] = [];

  if (includeHeader) {
    lines.push(headers.map(escapeField).join(delimiter));
  }

  for (const row of rows) {
    lines.push(row.map(escapeField).join(delimiter));
  }

  return lines.join('\n');
}

// =============================================================================
// EXCEL XML (SpreadsheetML)
// =============================================================================

/**
 * Generate a simple SpreadsheetML XML string that Excel can open.
 * Supports multiple sheets with basic cell formatting.
 */
export function generateExcelXML(sheets: ExcelSheet[]): string {
  function escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function cellType(value: string | number | null): string {
    if (value === null || value === undefined) return 'String';
    if (typeof value === 'number' && Number.isFinite(value)) return 'Number';
    return 'String';
  }

  function cellValue(value: string | number | null): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' && !Number.isFinite(value)) return '';
    return escapeXml(String(value));
  }

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<?mso-application progid="Excel.Sheet"?>\n';
  xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n';
  xml += '  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n';

  // Styles
  xml += '  <Styles>\n';
  xml += '    <Style ss:ID="Default" ss:Name="Normal"/>\n';
  xml += '    <Style ss:ID="Header">\n';
  xml += '      <Font ss:Bold="1"/>\n';
  xml += '    </Style>\n';
  xml += '    <Style ss:ID="Currency">\n';
  xml += '      <NumberFormat ss:Format="$#,##0.00"/>\n';
  xml += '    </Style>\n';
  xml += '  </Styles>\n';

  for (const sheet of sheets) {
    const safeName = escapeXml(sheet.name.substring(0, 31));
    xml += `  <Worksheet ss:Name="${safeName}">\n`;
    xml += '    <Table>\n';

    // Header row
    xml += '      <Row>\n';
    for (const header of sheet.headers) {
      xml += `        <Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(header)}</Data></Cell>\n`;
    }
    xml += '      </Row>\n';

    // Data rows
    for (const row of sheet.rows) {
      xml += '      <Row>\n';
      for (const cell of row) {
        const type = cellType(cell);
        const val = cellValue(cell);
        xml += `        <Cell><Data ss:Type="${type}">${val}</Data></Cell>\n`;
      }
      xml += '      </Row>\n';
    }

    xml += '    </Table>\n';
    xml += '  </Worksheet>\n';
  }

  xml += '</Workbook>\n';
  return xml;
}

// =============================================================================
// FORMATTING HELPERS
// =============================================================================

/**
 * Format a number as currency (USD).
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return '$0.00';
  }
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

/**
 * Format a date for different locales / formats.
 */
export function formatDate(
  date: Date | number | string,
  format: 'iso' | 'us' | 'eu' | 'short' = 'iso',
): string {
  let d: Date;

  if (date instanceof Date) {
    d = date;
  } else if (typeof date === 'number') {
    d = new Date(date);
  } else {
    d = new Date(date);
  }

  if (isNaN(d.getTime())) {
    return '';
  }

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');

  switch (format) {
    case 'iso':
      return `${year}-${month}-${day}`;
    case 'us':
      return `${month}/${day}/${year}`;
    case 'eu':
      return `${day}/${month}/${year}`;
    case 'short':
      return `${month}/${day}/${String(year).slice(-2)}`;
    default:
      return `${year}-${month}-${day}`;
  }
}

/**
 * Round a number to 2 decimal places safely.
 */
export function round2(n: number | null | undefined): number {
  if (n === null || n === undefined || !Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
