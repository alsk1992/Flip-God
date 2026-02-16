/**
 * BI Export Module - BI tool integration and data export
 *
 * Exports tool definitions and a handler function for wiring into the agent.
 */

import type { Database } from '../db/index.js';
import {
  exportForBI,
  getDataSchema,
  exportDashboardData,
} from './bi-export.js';
import type { BITableName, BIExportFormat } from './bi-types.js';

// =============================================================================
// Re-exports
// =============================================================================

export {
  exportForBI,
  getDataSchema,
  exportDashboardData,
} from './bi-export.js';

export type {
  OrderFlat,
  InventoryFlat,
  PricingFlat,
  PerformanceFlat,
  BITableName,
  BIExportFormat,
  BIExportOptions,
  DashboardData,
  TableSchema,
  ColumnSchema,
} from './bi-types.js';

// =============================================================================
// Tool Definitions
// =============================================================================

export const biTools = [
  {
    name: 'export_for_bi',
    description: 'Export data in BI-tool-friendly format (Tableau, Power BI, Looker)',
    input_schema: {
      type: 'object' as const,
      properties: {
        table: {
          type: 'string' as const,
          enum: ['orders_flat', 'inventory_flat', 'pricing_flat', 'performance_flat', 'all'],
          description: 'Which table to export',
        },
        format: {
          type: 'string' as const,
          enum: ['csv', 'jsonl'],
          description: 'Output format (default: csv)',
        },
        start_date: { type: 'string' as const, description: 'Start date (YYYY-MM-DD)' },
        end_date: { type: 'string' as const, description: 'End date (YYYY-MM-DD)' },
      },
      required: ['table'] as const,
    },
  },
  {
    name: 'data_schema',
    description: 'Get schema documentation for BI export tables',
    input_schema: {
      type: 'object' as const,
      properties: {
        table: {
          type: 'string' as const,
          enum: ['orders_flat', 'inventory_flat', 'pricing_flat', 'performance_flat'],
          description: 'Specific table to get schema for (or omit for all)',
        },
      },
    },
  },
  {
    name: 'dashboard_data',
    description: 'Get pre-aggregated dashboard data as JSON',
    input_schema: {
      type: 'object' as const,
      properties: {
        period: {
          type: 'string' as const,
          enum: ['7d', '30d', '90d', 'ytd'],
          description: 'Time period (default: 30d)',
        },
        metrics: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Specific metrics to include',
        },
      },
    },
  },
];

// =============================================================================
// Tool Handler
// =============================================================================

export interface BIToolInput {
  table?: string;
  format?: string;
  start_date?: string;
  end_date?: string;
  period?: string;
  metrics?: string[];
}

/**
 * Handle BI export tool calls.
 */
export function handleBITool(
  db: Database,
  toolName: string,
  input: BIToolInput,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'export_for_bi': {
        const validTables: BITableName[] = [
          'orders_flat', 'inventory_flat', 'pricing_flat', 'performance_flat', 'all',
        ];
        const table = (input.table ?? 'all') as BITableName;
        if (!validTables.includes(table)) {
          return {
            success: false,
            error: `Invalid table. Must be one of: ${validTables.join(', ')}`,
          };
        }

        const validFormats: BIExportFormat[] = ['csv', 'jsonl'];
        const format = (input.format ?? 'csv') as BIExportFormat;
        if (!validFormats.includes(format)) {
          return {
            success: false,
            error: `Invalid format. Must be one of: ${validFormats.join(', ')}`,
          };
        }

        const exportData = exportForBI(db, {
          table,
          format,
          startDate: input.start_date,
          endDate: input.end_date,
        });

        // Count rows in each table
        const tableSummary: Record<string, number> = {};
        for (const [name, content] of Object.entries(exportData)) {
          if (!content) {
            tableSummary[name] = 0;
          } else if (format === 'jsonl') {
            tableSummary[name] = content.split('\n').filter(Boolean).length;
          } else {
            tableSummary[name] = Math.max(0, content.split('\n').length - 1);
          }
        }

        return {
          success: true,
          data: {
            tables: exportData,
            format,
            rowCounts: tableSummary,
            dateRange: { start: input.start_date, end: input.end_date },
          },
        };
      }

      case 'data_schema': {
        const schema = getDataSchema(input.table);
        return {
          success: true,
          data: Array.isArray(schema) ? { tables: schema } : { table: schema },
        };
      }

      case 'dashboard_data': {
        const validPeriods = ['7d', '30d', '90d', 'ytd'];
        const period = input.period ?? '30d';
        if (!validPeriods.includes(period)) {
          return {
            success: false,
            error: `Invalid period. Must be one of: ${validPeriods.join(', ')}`,
          };
        }

        const dashboard = exportDashboardData(db, {
          period: period as '7d' | '30d' | '90d' | 'ytd',
          metrics: input.metrics,
        });

        return { success: true, data: dashboard };
      }

      default:
        return { success: false, error: `Unknown BI tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
