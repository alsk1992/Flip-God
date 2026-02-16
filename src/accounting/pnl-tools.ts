/**
 * P&L Tools - Tool definitions and handler for AI agent integration
 *
 * Provides tool definitions for profit/loss reporting operations and a
 * handler function that dispatches tool calls to the pnl-report module.
 */

import type { Database } from '../db/index.js';
import {
  generatePLReport,
  generateSKUProfitability,
  generateTaxSummary,
  generateMonthlyTrend,
  generateCashFlowSummary,
  exportPLToCSV,
  exportSKUProfitToCSV,
  exportToQuickBooksCSV,
} from './pnl-report.js';
import type { PLReport, SKUProfitability } from './pnl-report.js';

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const pnlTools = [
  {
    name: 'pnl_report',
    description:
      'Generate a Profit & Loss report for a date range. Shows revenue, COGS, gross profit, expenses (fees, shipping, returns), net profit, and breakdowns by platform, category, and top products.',
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: {
          type: 'string' as const,
          description:
            'Start date (ISO 8601, e.g. "2026-01-01"). Defaults to 30 days ago.',
        },
        end_date: {
          type: 'string' as const,
          description:
            'End date (ISO 8601, e.g. "2026-01-31"). Defaults to now.',
        },
      },
    },
  },
  {
    name: 'pnl_monthly_trend',
    description:
      'Show monthly P&L trend for the last N months. Returns revenue, COGS, net profit, margin, and order count per month — useful for spotting trends.',
    input_schema: {
      type: 'object' as const,
      properties: {
        months: {
          type: 'number' as const,
          description: 'Number of months to look back (default: 12, max: 120)',
        },
      },
    },
  },
  {
    name: 'sku_profitability',
    description:
      'Per-SKU profit breakdown showing revenue, COGS, platform fees, shipping, gross profit, margin %, and ROI for each product in the date range.',
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: {
          type: 'string' as const,
          description: 'Start date (ISO 8601). Defaults to 30 days ago.',
        },
        end_date: {
          type: 'string' as const,
          description: 'End date (ISO 8601). Defaults to now.',
        },
        limit: {
          type: 'number' as const,
          description: 'Max number of SKUs to return (default: 100)',
        },
      },
    },
  },
  {
    name: 'tax_summary',
    description:
      'Generate an annual tax summary with quarterly estimates. Shows revenue, COGS, expenses, taxable income, and estimated tax per quarter.',
    input_schema: {
      type: 'object' as const,
      properties: {
        year: {
          type: 'number' as const,
          description: 'Tax year (e.g. 2026). Defaults to current year.',
        },
        tax_rate: {
          type: 'number' as const,
          description:
            'Estimated tax rate as decimal (e.g. 0.25 for 25%). Default: 0.25.',
        },
      },
    },
  },
  {
    name: 'cash_flow',
    description:
      'Cash flow summary for a date range. Shows cash inflows (sales revenue) and outflows (inventory purchases, fees, shipping, refunds) with net cash flow.',
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: {
          type: 'string' as const,
          description: 'Start date (ISO 8601). Defaults to 30 days ago.',
        },
        end_date: {
          type: 'string' as const,
          description: 'End date (ISO 8601). Defaults to now.',
        },
      },
    },
  },
  {
    name: 'export_pnl_csv',
    description:
      'Export a P&L report as CSV suitable for importing into Excel or QuickBooks. Returns the CSV string.',
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: {
          type: 'string' as const,
          description: 'Start date (ISO 8601). Defaults to 30 days ago.',
        },
        end_date: {
          type: 'string' as const,
          description: 'End date (ISO 8601). Defaults to now.',
        },
      },
    },
  },
  {
    name: 'export_sku_csv',
    description:
      'Export per-SKU profitability as CSV with columns for revenue, COGS, fees, shipping, profit, margin, and ROI.',
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: {
          type: 'string' as const,
          description: 'Start date (ISO 8601). Defaults to 30 days ago.',
        },
        end_date: {
          type: 'string' as const,
          description: 'End date (ISO 8601). Defaults to now.',
        },
        limit: {
          type: 'number' as const,
          description: 'Max number of SKUs (default: 100)',
        },
      },
    },
  },
  {
    name: 'export_quickbooks',
    description:
      'Export transactions in QuickBooks-compatible journal entry CSV format. Maps sales to Income:Sales, COGS to COGS:Inventory, fees to Expense:Platform Fees, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: {
          type: 'string' as const,
          description: 'Start date (ISO 8601). Defaults to 30 days ago.',
        },
        end_date: {
          type: 'string' as const,
          description: 'End date (ISO 8601). Defaults to now.',
        },
      },
    },
  },
];

// =============================================================================
// HANDLER
// =============================================================================

/**
 * Dispatch a P&L tool call to the appropriate function.
 */
export function handlePnlTool(
  toolName: string,
  input: Record<string, unknown>,
  db: Database,
): unknown {
  switch (toolName) {
    // ----- pnl_report -----
    case 'pnl_report': {
      const startDate = input.start_date as string | undefined;
      const endDate = input.end_date as string | undefined;

      try {
        const report = generatePLReport(db, startDate, endDate);
        return {
          success: true,
          period: report.periodLabel,
          revenue: report.revenue.total,
          revenueBreakdown: report.revenue.breakdown,
          costOfGoods: report.costOfGoods.total,
          cogsBreakdown: report.costOfGoods.breakdown,
          grossProfit: report.grossProfit,
          grossMarginPct: report.grossMarginPct,
          expenses: report.expenses.total,
          expensesBreakdown: report.expenses.breakdown,
          netProfit: report.netProfit,
          netMarginPct: report.netMarginPct,
          summary: report.summary,
        };
      } catch (err) {
        return {
          error: `Failed to generate P&L report: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // ----- pnl_monthly_trend -----
    case 'pnl_monthly_trend': {
      const months = Math.max(1, Math.min(Number(input.months) || 12, 120));

      try {
        const trend = generateMonthlyTrend(db, months);
        return {
          success: true,
          months: trend.length,
          trend,
        };
      } catch (err) {
        return {
          error: `Failed to generate monthly trend: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // ----- sku_profitability -----
    case 'sku_profitability': {
      const startDate = input.start_date as string | undefined;
      const endDate = input.end_date as string | undefined;
      const limit = Math.max(1, Math.min(Number(input.limit) || 100, 10000));

      try {
        const skus = generateSKUProfitability(db, startDate, endDate, limit);
        return {
          success: true,
          count: skus.length,
          skus: skus.map((s) => ({
            sku: s.sku,
            productName: s.productName,
            unitsSold: s.unitsSold,
            revenue: s.revenue,
            cogs: s.cogs,
            platformFees: s.platformFees,
            shippingCost: s.shippingCost,
            otherCosts: s.otherCosts,
            grossProfit: s.grossProfit,
            grossMarginPct: s.grossMarginPct,
            roi: s.roi,
          })),
        };
      } catch (err) {
        return {
          error: `Failed to generate SKU profitability: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // ----- tax_summary -----
    case 'tax_summary': {
      const year = input.year != null ? Number(input.year) : undefined;
      const taxRate = input.tax_rate != null ? Number(input.tax_rate) : 0.25;

      if (year != null && (!Number.isFinite(year) || year < 2000 || year > 2100)) {
        return { error: 'year must be a valid year between 2000 and 2100' };
      }
      if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 1) {
        return { error: 'tax_rate must be between 0 and 1 (e.g. 0.25 for 25%)' };
      }

      try {
        const quarters = generateTaxSummary(db, year, taxRate);
        const annual = {
          totalRevenue: quarters.reduce((sum, q) => sum + q.totalRevenue, 0),
          totalCOGS: quarters.reduce((sum, q) => sum + q.totalCOGS, 0),
          totalExpenses: quarters.reduce((sum, q) => sum + q.totalExpenses, 0),
          totalTaxableIncome: quarters.reduce((sum, q) => sum + q.taxableIncome, 0),
          totalEstimatedTax: quarters.reduce((sum, q) => sum + q.estimatedTax, 0),
        };

        return {
          success: true,
          year: year ?? new Date().getFullYear(),
          taxRate,
          quarters,
          annual,
        };
      } catch (err) {
        return {
          error: `Failed to generate tax summary: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // ----- cash_flow -----
    case 'cash_flow': {
      const startDate = input.start_date as string | undefined;
      const endDate = input.end_date as string | undefined;

      try {
        const cf = generateCashFlowSummary(db, startDate, endDate);
        return {
          success: true,
          period: cf.periodLabel,
          inflows: cf.inflows,
          outflows: cf.outflows,
          netCashFlow: cf.netCashFlow,
        };
      } catch (err) {
        return {
          error: `Failed to generate cash flow: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // ----- export_pnl_csv -----
    case 'export_pnl_csv': {
      const startDate = input.start_date as string | undefined;
      const endDate = input.end_date as string | undefined;

      try {
        const report = generatePLReport(db, startDate, endDate);
        const csv = exportPLToCSV(report);
        return {
          success: true,
          period: report.periodLabel,
          format: 'csv',
          rowCount: csv.split('\n').length,
          csv,
        };
      } catch (err) {
        return {
          error: `Failed to export P&L CSV: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // ----- export_sku_csv -----
    case 'export_sku_csv': {
      const startDate = input.start_date as string | undefined;
      const endDate = input.end_date as string | undefined;
      const limit = Math.max(1, Math.min(Number(input.limit) || 100, 10000));

      try {
        const skus = generateSKUProfitability(db, startDate, endDate, limit);
        const csv = exportSKUProfitToCSV(skus);
        return {
          success: true,
          skuCount: skus.length,
          format: 'csv',
          csv,
        };
      } catch (err) {
        return {
          error: `Failed to export SKU CSV: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // ----- export_quickbooks -----
    case 'export_quickbooks': {
      const startDate = input.start_date as string | undefined;
      const endDate = input.end_date as string | undefined;

      try {
        const csv = exportToQuickBooksCSV(db, startDate, endDate);
        return {
          success: true,
          format: 'quickbooks_journal_csv',
          rowCount: csv.split('\n').length,
          csv,
        };
      } catch (err) {
        return {
          error: `Failed to export QuickBooks CSV: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    default:
      return { error: `Unknown P&L tool: ${toolName}` };
  }
}
