/**
 * Accounting Export Module - QuickBooks, Xero, P&L, Balance Sheet
 *
 * Exports tool definitions and a handler function for wiring into the agent.
 */

import type { Database } from '../db/index.js';
import {
  exportToQuickBooksCSV,
  exportToXeroCSV,
  exportToGenericCSV,
  exportProfitLossStatement,
  exportBalanceSheet,
} from './accounting.js';
import { generateExcelXML } from './formats.js';

// =============================================================================
// Re-exports
// =============================================================================

export {
  exportToQuickBooksCSV,
  exportToXeroCSV,
  exportToGenericCSV,
  exportProfitLossStatement,
  exportBalanceSheet,
} from './accounting.js';

export {
  generateCSV,
  generateExcelXML,
  formatCurrency,
  formatDate,
  round2,
} from './formats.js';

export type {
  DateRangeOptions,
  QuickBooksExportOptions,
  XeroExportOptions,
  GenericExportOptions,
  ProfitLossOptions,
  BalanceSheetOptions,
  ProfitLossStatement,
  BalanceSheet,
  CSVOptions,
  ExcelSheet,
} from './types.js';

// =============================================================================
// Tool Definitions
// =============================================================================

export const exportTools = [
  {
    name: 'export_quickbooks',
    description: 'Export transactions in QuickBooks-compatible CSV format',
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: { type: 'string' as const, description: 'Start date (YYYY-MM-DD)' },
        end_date: { type: 'string' as const, description: 'End date (YYYY-MM-DD)' },
        type: {
          type: 'string' as const,
          enum: ['invoices', 'expenses', 'both'],
          description: 'Export type (default: both)',
        },
      },
    },
  },
  {
    name: 'export_xero',
    description: 'Export transactions in Xero-compatible CSV format',
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: { type: 'string' as const, description: 'Start date (YYYY-MM-DD)' },
        end_date: { type: 'string' as const, description: 'End date (YYYY-MM-DD)' },
      },
    },
  },
  {
    name: 'profit_loss_statement',
    description: 'Generate formatted Profit & Loss statement',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string' as const,
          enum: ['monthly', 'quarterly', 'yearly'],
          description: 'Reporting period (default: monthly)',
        },
        year: { type: 'number' as const, description: 'Year for the report' },
        quarter: {
          type: 'number' as const,
          enum: [1, 2, 3, 4],
          description: 'Quarter (for quarterly period)',
        },
      },
    },
  },
  {
    name: 'balance_sheet',
    description: 'Generate simplified balance sheet',
    input_schema: {
      type: 'object' as const,
      properties: {
        as_of_date: {
          type: 'string' as const,
          description: 'Date for balance sheet (YYYY-MM-DD, default: today)',
        },
      },
    },
  },
  {
    name: 'export_transactions',
    description: 'Export all transactions as generic CSV or Excel XML',
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: { type: 'string' as const, description: 'Start date (YYYY-MM-DD)' },
        end_date: { type: 'string' as const, description: 'End date (YYYY-MM-DD)' },
        platform: { type: 'string' as const, description: 'Filter by platform' },
        format: {
          type: 'string' as const,
          enum: ['csv', 'excel_xml'],
          description: 'Output format (default: csv)',
        },
      },
    },
  },
];

// =============================================================================
// Tool Handler
// =============================================================================

export interface ExportToolInput {
  start_date?: string;
  end_date?: string;
  type?: string;
  period?: string;
  year?: number;
  quarter?: number;
  as_of_date?: string;
  platform?: string;
  format?: string;
}

/**
 * Handle accounting export tool calls.
 */
export function handleExportTool(
  db: Database,
  toolName: string,
  input: ExportToolInput,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'export_quickbooks': {
        const validTypes = ['invoices', 'expenses', 'both'];
        const exportType = input.type ?? 'both';
        if (!validTypes.includes(exportType)) {
          return { success: false, error: `Invalid type. Must be one of: ${validTypes.join(', ')}` };
        }

        const result = exportToQuickBooksCSV(db, {
          startDate: input.start_date,
          endDate: input.end_date,
          type: exportType as 'invoices' | 'expenses' | 'both',
        });

        return {
          success: true,
          data: {
            ...result,
            format: 'QuickBooks CSV',
            dateRange: { start: input.start_date, end: input.end_date },
          },
        };
      }

      case 'export_xero': {
        const csv = exportToXeroCSV(db, {
          startDate: input.start_date,
          endDate: input.end_date,
        });

        return {
          success: true,
          data: {
            csv,
            format: 'Xero CSV',
            dateRange: { start: input.start_date, end: input.end_date },
          },
        };
      }

      case 'profit_loss_statement': {
        const validPeriods = ['monthly', 'quarterly', 'yearly'];
        const period = input.period ?? 'monthly';
        if (!validPeriods.includes(period)) {
          return { success: false, error: `Invalid period. Must be one of: ${validPeriods.join(', ')}` };
        }

        if (period === 'quarterly' && input.quarter !== undefined) {
          const q = input.quarter;
          if (!Number.isFinite(q) || q < 1 || q > 4) {
            return { success: false, error: 'Quarter must be 1, 2, 3, or 4' };
          }
        }

        const statement = exportProfitLossStatement(db, {
          period: period as 'monthly' | 'quarterly' | 'yearly',
          year: input.year,
          quarter: input.quarter as 1 | 2 | 3 | 4 | undefined,
        });

        return { success: true, data: statement };
      }

      case 'balance_sheet': {
        const sheet = exportBalanceSheet(db, {
          asOfDate: input.as_of_date,
        });

        return { success: true, data: sheet };
      }

      case 'export_transactions': {
        const fmt = input.format ?? 'csv';

        if (fmt === 'excel_xml') {
          // Generate CSV first, then convert to Excel XML
          const csvData = exportToGenericCSV(db, {
            startDate: input.start_date,
            endDate: input.end_date,
            platform: input.platform,
          });

          // Parse CSV back to generate Excel XML
          const lines = csvData.split('\n');
          const headers = lines[0]?.split(',') ?? [];
          const rows = lines.slice(1).map((line) =>
            line.split(',').map((cell) => {
              const trimmed = cell.trim().replace(/^"|"$/g, '');
              const num = Number(trimmed);
              return Number.isFinite(num) && trimmed !== '' ? num : trimmed;
            }),
          );

          const xml = generateExcelXML([{
            name: 'Transactions',
            headers,
            rows: rows as Array<Array<string | number | null>>,
          }]);

          return {
            success: true,
            data: {
              content: xml,
              format: 'Excel XML (SpreadsheetML)',
              rows: rows.length,
            },
          };
        }

        const csv = exportToGenericCSV(db, {
          startDate: input.start_date,
          endDate: input.end_date,
          platform: input.platform,
        });

        return {
          success: true,
          data: {
            csv,
            format: 'CSV',
            rows: csv.split('\n').length - 1, // minus header
          },
        };
      }

      default:
        return { success: false, error: `Unknown export tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
