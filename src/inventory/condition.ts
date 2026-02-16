/**
 * Product Condition Grading Module
 */

import type { Database } from '../db/index.js';

const GRADE_MULTIPLIERS: Record<string, number> = {
  'New': 1.0, 'Like New': 0.85, 'Very Good': 0.70, 'Good': 0.55, 'Acceptable': 0.35, 'For Parts': 0.15,
};

function computeGrade(cosmetic: number, functional: number, packaging: string, accessories: boolean): string {
  const avg = (cosmetic + functional) / 2;
  const pkgBonus = packaging === 'original' ? 0.5 : packaging === 'generic' ? 0 : -0.5;
  const accBonus = accessories ? 0.3 : -0.3;
  const score = avg + pkgBonus + accBonus;
  if (score >= 9.5) return 'New';
  if (score >= 8) return 'Like New';
  if (score >= 6.5) return 'Very Good';
  if (score >= 5) return 'Good';
  if (score >= 3) return 'Acceptable';
  return 'For Parts';
}

export const conditionTools = [
  {
    name: 'grade_condition',
    description: 'Grade a product condition (New/Like New/Very Good/Good/Acceptable/For Parts)',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const },
        cosmetic_score: { type: 'number' as const, description: '1-10 cosmetic condition' },
        functional_score: { type: 'number' as const, description: '1-10 functional condition' },
        packaging: { type: 'string' as const, enum: ['original', 'generic', 'none'] },
        accessories_complete: { type: 'boolean' as const },
        notes: { type: 'string' as const },
      },
      required: ['product_id', 'cosmetic_score', 'functional_score'],
    },
  },
  {
    name: 'condition_pricing',
    description: 'Get price adjustment based on product condition grade',
    input_schema: {
      type: 'object' as const,
      properties: {
        new_price: { type: 'number' as const, description: 'New condition price' },
        condition_grade: { type: 'string' as const, enum: ['New', 'Like New', 'Very Good', 'Good', 'Acceptable', 'For Parts'] },
      },
      required: ['new_price', 'condition_grade'],
    },
  },
  {
    name: 'condition_report',
    description: 'Get inventory breakdown by condition grade',
    input_schema: {
      type: 'object' as const,
      properties: { category: { type: 'string' as const, description: 'Filter by category' } },
    },
  },
  {
    name: 'refurbishment_estimate',
    description: 'Estimate cost to improve product condition to target grade',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const },
        target_grade: { type: 'string' as const, enum: ['New', 'Like New', 'Very Good', 'Good'] },
      },
      required: ['product_id', 'target_grade'],
    },
  },
];

export function handleConditionTool(
  db: Database,
  toolName: string,
  input: Record<string, unknown>,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'grade_condition': {
        const pid = input.product_id as string;
        const cosmetic = input.cosmetic_score as number;
        const functional = input.functional_score as number;
        if (!pid) return { success: false, error: 'product_id required' };
        if (!Number.isFinite(cosmetic) || cosmetic < 1 || cosmetic > 10) return { success: false, error: 'cosmetic_score must be 1-10' };
        if (!Number.isFinite(functional) || functional < 1 || functional > 10) return { success: false, error: 'functional_score must be 1-10' };

        const packaging = (input.packaging as string) ?? 'none';
        const accessories = (input.accessories_complete as boolean) ?? false;
        const grade = computeGrade(cosmetic, functional, packaging, accessories);

        db.run(
          `INSERT OR REPLACE INTO product_conditions (product_id, cosmetic_score, functional_score, packaging, accessories_complete, overall_grade, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [pid, cosmetic, functional, packaging, accessories ? 1 : 0, grade, (input.notes as string) ?? null],
        );
        return { success: true, data: { product_id: pid, grade, cosmetic_score: cosmetic, functional_score: functional, packaging, accessories_complete: accessories, multiplier: GRADE_MULTIPLIERS[grade] } };
      }

      case 'condition_pricing': {
        const price = input.new_price as number;
        const grade = input.condition_grade as string;
        if (!Number.isFinite(price)) return { success: false, error: 'new_price required' };
        const mult = GRADE_MULTIPLIERS[grade];
        if (mult == null) return { success: false, error: `Unknown grade: ${grade}` };
        const adjusted = Math.round(price * mult * 100) / 100;
        return { success: true, data: { new_price: price, condition_grade: grade, multiplier: mult, adjusted_price: adjusted, discount_pct: Math.round((1 - mult) * 100) } };
      }

      case 'condition_report': {
        const rows = db.query<Record<string, unknown>>(
          `SELECT overall_grade, COUNT(*) as count FROM product_conditions GROUP BY overall_grade ORDER BY count DESC`,
        );
        return { success: true, data: { breakdown: rows, total: rows.reduce((s, r) => s + ((r.count as number) ?? 0), 0) } };
      }

      case 'refurbishment_estimate': {
        const pid = input.product_id as string;
        const target = input.target_grade as string;
        if (!pid || !target) return { success: false, error: 'product_id and target_grade required' };
        const rows = db.query<Record<string, unknown>>(
          'SELECT overall_grade, cosmetic_score, functional_score FROM product_conditions WHERE product_id = ?',
          [pid],
        );
        if (rows.length === 0) return { success: false, error: `No condition record for ${pid}` };
        const current = rows[0];
        const grades = Object.keys(GRADE_MULTIPLIERS);
        const currentIdx = grades.indexOf(current.overall_grade as string);
        const targetIdx = grades.indexOf(target);
        if (targetIdx >= currentIdx) return { success: true, data: { message: 'Product already meets or exceeds target grade', estimated_cost: 0 } };
        const steps = currentIdx - targetIdx;
        const baseCost = steps * 8;
        const cosmetic = 10 - ((current.cosmetic_score as number) ?? 5);
        const functional = 10 - ((current.functional_score as number) ?? 5);
        const laborCost = Math.round((cosmetic * 2 + functional * 3) * 100) / 100;
        return { success: true, data: { product_id: pid, current_grade: current.overall_grade, target_grade: target, parts_estimate: baseCost, labor_estimate: laborCost, total_estimate: baseCost + laborCost } };
      }

      default:
        return { success: false, error: `Unknown condition tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
