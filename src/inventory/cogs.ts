/**
 * COGS Module - Cost of Goods Sold tracking with FIFO/LIFO/Weighted Average
 */

import type { Database } from '../db/index.js';

interface CogsRecord {
  id: number;
  unit_cost: number;
  quantity: number;
  shipping_cost: number;
  import_duty: number;
  other_costs: number;
  purchase_date: string | null;
  created_at: string;
}

function totalCostPerUnit(r: CogsRecord): number {
  const extras = (r.shipping_cost ?? 0) + (r.import_duty ?? 0) + (r.other_costs ?? 0);
  return r.unit_cost + extras / Math.max(r.quantity, 1);
}

function calcFifo(records: CogsRecord[]): number {
  if (records.length === 0) return 0;
  const sorted = [...records].sort((a, b) =>
    new Date(a.purchase_date ?? a.created_at).getTime() - new Date(b.purchase_date ?? b.created_at).getTime(),
  );
  return totalCostPerUnit(sorted[0]);
}

function calcLifo(records: CogsRecord[]): number {
  if (records.length === 0) return 0;
  const sorted = [...records].sort((a, b) =>
    new Date(b.purchase_date ?? b.created_at).getTime() - new Date(a.purchase_date ?? a.created_at).getTime(),
  );
  return totalCostPerUnit(sorted[0]);
}

function calcWeighted(records: CogsRecord[]): number {
  if (records.length === 0) return 0;
  let totalCost = 0, totalQty = 0;
  for (const r of records) {
    totalCost += totalCostPerUnit(r) * r.quantity;
    totalQty += r.quantity;
  }
  return totalQty > 0 ? Math.round((totalCost / totalQty) * 100) / 100 : 0;
}

export const cogsTools = [
  {
    name: 'record_cogs',
    description: 'Record purchase cost for a product (unit cost, shipping, duty, etc.)',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const, description: 'Product ID' },
        unit_cost: { type: 'number' as const, description: 'Cost per unit' },
        quantity: { type: 'number' as const, description: 'Units purchased' },
        supplier: { type: 'string' as const, description: 'Supplier name' },
        purchase_date: { type: 'string' as const, description: 'Date (YYYY-MM-DD)' },
        shipping_cost: { type: 'number' as const, description: 'Shipping cost' },
        import_duty: { type: 'number' as const, description: 'Import duty' },
        other_costs: { type: 'number' as const, description: 'Other costs' },
      },
      required: ['product_id', 'unit_cost', 'quantity'],
    },
  },
  {
    name: 'get_cogs',
    description: 'Get COGS for a product using FIFO, LIFO, or weighted average',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const },
        method: { type: 'string' as const, enum: ['fifo', 'lifo', 'weighted'] },
      },
      required: ['product_id'],
    },
  },
  {
    name: 'update_cogs',
    description: 'Update an existing COGS record',
    input_schema: {
      type: 'object' as const,
      properties: {
        record_id: { type: 'number' as const },
        unit_cost: { type: 'number' as const },
        quantity: { type: 'number' as const },
        supplier: { type: 'string' as const },
        shipping_cost: { type: 'number' as const },
        import_duty: { type: 'number' as const },
        other_costs: { type: 'number' as const },
      },
      required: ['record_id'],
    },
  },
  {
    name: 'cogs_report',
    description: 'Generate COGS report for a date range grouped by product or supplier',
    input_schema: {
      type: 'object' as const,
      properties: {
        start_date: { type: 'string' as const },
        end_date: { type: 'string' as const },
        group_by: { type: 'string' as const, enum: ['product', 'supplier'] },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'margin_with_cogs',
    description: 'Calculate true margin including all COGS components and platform fees',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const },
        selling_price: { type: 'number' as const },
        platform: { type: 'string' as const },
        platform_fees_pct: { type: 'number' as const },
      },
      required: ['product_id', 'selling_price'],
    },
  },
];

function fetchRecords(db: Database, productId: string): CogsRecord[] {
  const rows = db.query<Record<string, unknown>>(
    `SELECT id, unit_cost, quantity, shipping_cost, import_duty, other_costs, purchase_date, created_at
     FROM cogs_records WHERE product_id = ?`,
    [productId],
  );
  return rows.map((r) => ({
    id: r.id as number,
    unit_cost: r.unit_cost as number,
    quantity: r.quantity as number,
    shipping_cost: (r.shipping_cost as number) ?? 0,
    import_duty: (r.import_duty as number) ?? 0,
    other_costs: (r.other_costs as number) ?? 0,
    purchase_date: r.purchase_date as string | null,
    created_at: r.created_at as string,
  }));
}

export function handleCogsTool(
  db: Database,
  toolName: string,
  input: Record<string, unknown>,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'record_cogs': {
        const pid = input.product_id as string;
        const cost = input.unit_cost as number;
        const qty = input.quantity as number;
        if (!pid) return { success: false, error: 'product_id required' };
        if (!Number.isFinite(cost)) return { success: false, error: 'unit_cost must be a number' };
        if (!Number.isFinite(qty) || qty <= 0) return { success: false, error: 'quantity must be positive' };

        db.run(
          `INSERT INTO cogs_records (product_id, unit_cost, quantity, supplier, purchase_date, shipping_cost, import_duty, other_costs)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [pid, cost, qty, (input.supplier as string) ?? null, (input.purchase_date as string) ?? null,
           (input.shipping_cost as number) ?? 0, (input.import_duty as number) ?? 0, (input.other_costs as number) ?? 0],
        );
        const rows = db.query<Record<string, unknown>>('SELECT last_insert_rowid() as id');
        return { success: true, data: { record_id: rows[0]?.id, product_id: pid, unit_cost: cost, quantity: qty } };
      }

      case 'get_cogs': {
        const pid = input.product_id as string;
        const method = (input.method as string) ?? 'weighted';
        if (!pid) return { success: false, error: 'product_id required' };
        const records = fetchRecords(db, pid);
        if (records.length === 0) return { success: false, error: `No COGS records for ${pid}` };

        const cogs = method === 'fifo' ? calcFifo(records) : method === 'lifo' ? calcLifo(records) : calcWeighted(records);
        const totalQty = records.reduce((s, r) => s + r.quantity, 0);
        return { success: true, data: { product_id: pid, method, cogs_per_unit: cogs, total_quantity: totalQty, records: records.length } };
      }

      case 'update_cogs': {
        const id = input.record_id as number;
        if (!Number.isFinite(id)) return { success: false, error: 'record_id required' };
        const updates: string[] = [];
        const params: unknown[] = [];
        for (const [k, v] of Object.entries(input)) {
          if (k === 'record_id' || v == null) continue;
          updates.push(`${k} = ?`);
          params.push(v);
        }
        if (updates.length === 0) return { success: false, error: 'No fields to update' };
        params.push(id);
        db.run(`UPDATE cogs_records SET ${updates.join(', ')} WHERE id = ?`, params);
        return { success: true, data: { record_id: id, updated: updates.length } };
      }

      case 'cogs_report': {
        const start = input.start_date as string;
        const end = input.end_date as string;
        if (!start || !end) return { success: false, error: 'start_date and end_date required' };
        const groupCol = (input.group_by as string) === 'supplier' ? 'supplier' : 'product_id';
        const rows = db.query<Record<string, unknown>>(
          `SELECT ${groupCol} as group_key, COUNT(*) as records, SUM(quantity) as total_qty,
                  SUM(unit_cost * quantity + shipping_cost + import_duty + other_costs) as total_cost
           FROM cogs_records WHERE created_at >= ? AND created_at <= ? GROUP BY ${groupCol} ORDER BY total_cost DESC`,
          [start, end],
        );
        const total = rows.reduce((s, r) => s + ((r.total_cost as number) ?? 0), 0);
        return { success: true, data: { start_date: start, end_date: end, groups: rows, grand_total: Math.round(total * 100) / 100 } };
      }

      case 'margin_with_cogs': {
        const pid = input.product_id as string;
        const price = input.selling_price as number;
        if (!pid || !Number.isFinite(price)) return { success: false, error: 'product_id and selling_price required' };
        const records = fetchRecords(db, pid);
        if (records.length === 0) return { success: false, error: `No COGS records for ${pid}` };
        const cogs = calcWeighted(records);
        const feesPct = (input.platform_fees_pct as number) ?? 0;
        const fees = Math.round(price * (feesPct / 100) * 100) / 100;
        const shipping = 5.0;
        const totalCosts = Math.round((cogs + fees + shipping) * 100) / 100;
        const profit = Math.round((price - totalCosts) * 100) / 100;
        const margin = price > 0 ? Math.round((profit / price) * 10000) / 100 : 0;
        return { success: true, data: { product_id: pid, selling_price: price, cogs_per_unit: cogs, platform_fees: fees, shipping, total_costs: totalCosts, profit, margin_pct: margin } };
      }

      default:
        return { success: false, error: `Unknown COGS tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
