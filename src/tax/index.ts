/**
 * Tax Module - Sales tax, income reporting, nexus checks, 1099 prep
 *
 * Exports tool definitions and a handler function for wiring into the agent.
 */

import type { Database } from '../db/index.js';
import {
  calculateSalesTax,
  calculateTaxLiability,
  nexusCheck,
  getSalesTaxRate,
  getAllTaxRates,
} from './calculator.js';
import {
  generateSalesTaxReport,
  generateIncomeReport,
  generate1099Report,
  generateExpenseReport,
} from './reports.js';
import type { ExpenseCategory } from './types.js';

// =============================================================================
// Tool Definitions
// =============================================================================

export const taxTools = [
  {
    name: 'sales_tax_report',
    description: 'Generate sales tax report by state',
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: { type: 'string' as const, description: 'Start date (YYYY-MM-DD)' },
        end_date: { type: 'string' as const, description: 'End date (YYYY-MM-DD)' },
        year: { type: 'number' as const, description: 'Tax year (alternative to date range)' },
      },
    },
  },
  {
    name: 'income_report',
    description: 'Generate profit/loss income report for tax filing',
    input_schema: {
      type: 'object' as const,
      properties: {
        year: { type: 'number' as const, description: 'Tax year' },
        quarter: {
          type: 'number' as const,
          enum: [1, 2, 3, 4],
          description: 'Specific quarter',
        },
        include_monthly: { type: 'boolean' as const, default: true },
      },
      required: ['year'],
    },
  },
  {
    name: 'nexus_check',
    description: 'Check economic nexus status across US states',
    input_schema: {
      type: 'object' as const,
      properties: {
        year: { type: 'number' as const },
      },
    },
  },
  {
    name: 'expense_report',
    description: 'Generate categorized expense report',
    input_schema: {
      type: 'object' as const,
      properties: {
        year: { type: 'number' as const },
        category: {
          type: 'string' as const,
          enum: ['shipping', 'platform_fees', 'advertising', 'supplies', 'software', 'all'],
          default: 'all',
        },
      },
      required: ['year'],
    },
  },
  {
    name: '1099_prep',
    description: 'Prepare 1099-K data for tax filing (gross payments by platform)',
    input_schema: {
      type: 'object' as const,
      properties: {
        year: { type: 'number' as const },
      },
      required: ['year'],
    },
  },
] as const;

// =============================================================================
// Tool Handler
// =============================================================================

export interface TaxToolInput {
  start_date?: string;
  end_date?: string;
  year?: number;
  quarter?: number;
  include_monthly?: boolean;
  category?: string;
}

/**
 * Handle tax tool calls.
 *
 * @param db - Database instance
 * @param toolName - Name of the tool being called
 * @param input - Tool input parameters
 * @returns Tool result object
 */
export function handleTaxTool(
  db: Database,
  toolName: string,
  input: TaxToolInput,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'sales_tax_report': {
        const report = generateSalesTaxReport(db, {
          startDate: input.start_date,
          endDate: input.end_date,
          year: input.year,
        });
        return { success: true, data: report };
      }

      case 'income_report': {
        if (!input.year || !Number.isFinite(input.year)) {
          return { success: false, error: 'year is required and must be a valid number' };
        }

        const quarter = input.quarter;
        if (quarter !== undefined && (quarter < 1 || quarter > 4 || !Number.isFinite(quarter))) {
          return { success: false, error: 'quarter must be 1, 2, 3, or 4' };
        }

        const report = generateIncomeReport(db, {
          year: input.year,
          quarter,
          includeMonthly: input.include_monthly ?? true,
        });
        return { success: true, data: report };
      }

      case 'nexus_check': {
        const results = nexusCheck(db, {
          year: input.year,
        });
        return { success: true, data: results };
      }

      case 'expense_report': {
        if (!input.year || !Number.isFinite(input.year)) {
          return { success: false, error: 'year is required and must be a valid number' };
        }

        const validCategories = [
          'shipping', 'platform_fees', 'advertising', 'supplies', 'software', 'other', 'all',
        ];
        const category = input.category ?? 'all';
        if (!validCategories.includes(category)) {
          return { success: false, error: `Invalid category. Must be one of: ${validCategories.join(', ')}` };
        }

        const report = generateExpenseReport(db, {
          year: input.year,
          category: category as ExpenseCategory | 'all',
        });
        return { success: true, data: report };
      }

      case '1099_prep': {
        if (!input.year || !Number.isFinite(input.year)) {
          return { success: false, error: 'year is required and must be a valid number' };
        }

        const report = generate1099Report(db, input.year);
        return { success: true, data: report };
      }

      default:
        return { success: false, error: `Unknown tax tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// Re-export core functions for direct usage
export {
  calculateSalesTax,
  calculateTaxLiability,
  nexusCheck,
  getSalesTaxRate,
  getAllTaxRates,
  extractStateFromAddress,
} from './calculator.js';

export {
  generateSalesTaxReport,
  generateIncomeReport,
  generate1099Report,
  generateExpenseReport,
} from './reports.js';

export type {
  SalesTaxRate,
  TaxLiability,
  NexusStatus,
  IncomeReport,
  MonthlyBreakdown,
  SalesTaxReport,
  StateTaxSummary,
  ExpenseReport,
  ExpenseCategory,
  ExpenseEntry,
  Report1099,
  Platform1099,
  TaxReportOptions,
} from './types.js';
