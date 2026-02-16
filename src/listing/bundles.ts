/**
 * Bundle/Kit Creation Module
 */

import type { Database } from '../db/index.js';

export const bundleTools = [
  {
    name: 'create_bundle',
    description: 'Create a product bundle from multiple SKUs',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const },
        component_skus: { type: 'array' as const, items: { type: 'string' as const } },
        component_quantities: { type: 'array' as const, items: { type: 'number' as const } },
        bundle_price: { type: 'number' as const },
        description: { type: 'string' as const },
      },
      required: ['name', 'component_skus'],
    },
  },
  {
    name: 'calculate_bundle_price',
    description: 'Calculate optimal bundle price from component prices',
    input_schema: {
      type: 'object' as const,
      properties: {
        component_skus: { type: 'array' as const, items: { type: 'string' as const } },
        discount_pct: { type: 'number' as const, description: 'Bundle discount % (default 15)' },
      },
      required: ['component_skus'],
    },
  },
  {
    name: 'bundle_inventory',
    description: 'Check available bundle quantity (limited by lowest component)',
    input_schema: {
      type: 'object' as const,
      properties: { bundle_id: { type: 'number' as const } },
      required: ['bundle_id'],
    },
  },
  {
    name: 'list_bundles',
    description: 'List all bundles with availability',
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'update_bundle',
    description: 'Update a bundle price or description',
    input_schema: {
      type: 'object' as const,
      properties: {
        bundle_id: { type: 'number' as const },
        name: { type: 'string' as const },
        bundle_price: { type: 'number' as const },
        description: { type: 'string' as const },
        status: { type: 'string' as const, enum: ['active', 'inactive'] },
      },
      required: ['bundle_id'],
    },
  },
  {
    name: 'dissolve_bundle',
    description: 'Remove a bundle definition (components remain as individual products)',
    input_schema: {
      type: 'object' as const,
      properties: { bundle_id: { type: 'number' as const } },
      required: ['bundle_id'],
    },
  },
];

export function handleBundleTool(
  db: Database,
  toolName: string,
  input: Record<string, unknown>,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'create_bundle': {
        const name = input.name as string;
        const skus = input.component_skus as string[];
        const qtys = (input.component_quantities as number[]) ?? skus.map(() => 1);
        if (!name || !skus?.length) return { success: false, error: 'name and component_skus required' };

        db.run(
          'INSERT INTO bundles (name, description, bundle_price, status) VALUES (?, ?, ?, ?)',
          [name, (input.description as string) ?? null, (input.bundle_price as number) ?? null, 'active'],
        );
        const rows = db.query<Record<string, unknown>>('SELECT last_insert_rowid() as id');
        const bundleId = rows[0]?.id as number;

        for (let i = 0; i < skus.length; i++) {
          db.run(
            'INSERT INTO bundle_components (bundle_id, product_id, quantity) VALUES (?, ?, ?)',
            [bundleId, skus[i], qtys[i] ?? 1],
          );
        }
        return { success: true, data: { bundle_id: bundleId, name, components: skus.length } };
      }

      case 'calculate_bundle_price': {
        const skus = input.component_skus as string[];
        const discount = (input.discount_pct as number) ?? 15;
        if (!skus?.length) return { success: false, error: 'component_skus required' };

        let total = 0;
        const components: Array<{ sku: string; price: number }> = [];
        for (const sku of skus) {
          const rows = db.query<Record<string, unknown>>(
            'SELECT price FROM prices WHERE product_id = ? ORDER BY fetched_at DESC LIMIT 1',
            [sku],
          );
          const price = (rows[0]?.price as number) ?? 0;
          total += price;
          components.push({ sku, price });
        }
        const bundlePrice = Math.round(total * (1 - discount / 100) * 100) / 100;
        return { success: true, data: { components, individual_total: total, discount_pct: discount, bundle_price: bundlePrice, savings: Math.round((total - bundlePrice) * 100) / 100 } };
      }

      case 'bundle_inventory': {
        const bundleId = input.bundle_id as number;
        if (!Number.isFinite(bundleId)) return { success: false, error: 'bundle_id required' };
        const comps = db.query<Record<string, unknown>>(
          'SELECT product_id, quantity FROM bundle_components WHERE bundle_id = ?',
          [bundleId],
        );
        if (comps.length === 0) return { success: false, error: 'Bundle not found or has no components' };

        let minAvailable = Infinity;
        const details: Array<{ sku: string; needed: number; available: number }> = [];
        for (const c of comps) {
          const sku = c.product_id as string;
          const needed = c.quantity as number;
          const inv = db.query<Record<string, unknown>>(
            'SELECT COALESCE(SUM(quantity - reserved), 0) as avail FROM warehouse_inventory WHERE sku = ?',
            [sku],
          );
          const avail = (inv[0]?.avail as number) ?? 0;
          const canMake = needed > 0 ? Math.floor(avail / needed) : 0;
          if (canMake < minAvailable) minAvailable = canMake;
          details.push({ sku, needed, available: avail });
        }
        return { success: true, data: { bundle_id: bundleId, max_available: minAvailable === Infinity ? 0 : minAvailable, components: details } };
      }

      case 'list_bundles': {
        const bundles = db.query<Record<string, unknown>>(
          'SELECT id, name, description, bundle_price, status, created_at FROM bundles WHERE status = ? ORDER BY created_at DESC',
          ['active'],
        );
        return { success: true, data: { bundles, count: bundles.length } };
      }

      case 'update_bundle': {
        const id = input.bundle_id as number;
        if (!Number.isFinite(id)) return { success: false, error: 'bundle_id required' };
        const updates: string[] = [];
        const params: unknown[] = [];
        if (input.name != null) { updates.push('name = ?'); params.push(input.name); }
        if (input.bundle_price != null) { updates.push('bundle_price = ?'); params.push(input.bundle_price); }
        if (input.description != null) { updates.push('description = ?'); params.push(input.description); }
        if (input.status != null) { updates.push('status = ?'); params.push(input.status); }
        if (updates.length === 0) return { success: false, error: 'No fields to update' };
        params.push(id);
        db.run(`UPDATE bundles SET ${updates.join(', ')} WHERE id = ?`, params);
        return { success: true, data: { bundle_id: id, updated: updates.length } };
      }

      case 'dissolve_bundle': {
        const id = input.bundle_id as number;
        if (!Number.isFinite(id)) return { success: false, error: 'bundle_id required' };
        db.run('DELETE FROM bundle_components WHERE bundle_id = ?', [id]);
        db.run('DELETE FROM bundles WHERE id = ?', [id]);
        return { success: true, data: { bundle_id: id, dissolved: true } };
      }

      default:
        return { success: false, error: `Unknown bundle tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
