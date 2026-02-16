/**
 * Product Research Scoring - Composite scores for product opportunity evaluation
 */

import type { Database } from '../db/index.js';

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

interface ProductMetrics {
  bsr?: number;
  monthly_sales_est?: number;
  review_count?: number;
  review_rating?: number;
  competitor_count?: number;
  margin_pct?: number;
  price?: number;
  category?: string;
}

function scoreDemand(m: ProductMetrics): number {
  let score = 50;
  if (m.bsr != null) {
    if (m.bsr < 1000) score += 40;
    else if (m.bsr < 5000) score += 30;
    else if (m.bsr < 20000) score += 20;
    else if (m.bsr < 100000) score += 10;
    else score -= 10;
  }
  if (m.monthly_sales_est != null) {
    if (m.monthly_sales_est > 300) score += 10;
    else if (m.monthly_sales_est > 100) score += 5;
  }
  return clamp(score, 0, 100);
}

function scoreCompetition(m: ProductMetrics): number {
  let score = 50;
  if (m.competitor_count != null) {
    if (m.competitor_count < 5) score += 30;
    else if (m.competitor_count < 15) score += 15;
    else if (m.competitor_count < 50) score -= 5;
    else score -= 20;
  }
  if (m.review_count != null) {
    // High review count = hard to compete
    if (m.review_count > 1000) score -= 15;
    else if (m.review_count > 500) score -= 5;
    else if (m.review_count < 50) score += 10;
  }
  return clamp(score, 0, 100);
}

function scoreMargin(m: ProductMetrics): number {
  if (m.margin_pct == null) return 50;
  if (m.margin_pct >= 50) return 95;
  if (m.margin_pct >= 30) return 80;
  if (m.margin_pct >= 20) return 65;
  if (m.margin_pct >= 10) return 45;
  return 20;
}

function scoreTrend(_m: ProductMetrics): number {
  return 50; // Neutral without historical data
}

function scoreRisk(m: ProductMetrics): number {
  let score = 70; // Start optimistic
  if ((m.price ?? 0) > 100) score -= 10; // Higher price = more return risk
  if ((m.competitor_count ?? 0) > 100) score -= 15; // Race to bottom
  return clamp(score, 0, 100);
}

export const scoringTools = [
  {
    name: 'score_product',
    description: 'Calculate composite research score (0-100) for a product opportunity',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const },
        bsr: { type: 'number' as const },
        monthly_sales_est: { type: 'number' as const },
        review_count: { type: 'number' as const },
        review_rating: { type: 'number' as const },
        competitor_count: { type: 'number' as const },
        margin_pct: { type: 'number' as const },
        price: { type: 'number' as const },
        category: { type: 'string' as const },
      },
    },
  },
  {
    name: 'rank_opportunities',
    description: 'Rank multiple products by research score',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_ids: { type: 'array' as const, items: { type: 'string' as const } },
        min_margin: { type: 'number' as const },
        category: { type: 'string' as const },
        limit: { type: 'number' as const },
      },
    },
  },
  {
    name: 'niche_analysis',
    description: 'Analyze a product niche/category for opportunity assessment',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string' as const },
        keywords: { type: 'array' as const, items: { type: 'string' as const } },
      },
      required: ['category'],
    },
  },
  {
    name: 'compare_scored_products',
    description: 'Side-by-side comparison of products with scoring breakdown',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_ids: { type: 'array' as const, items: { type: 'string' as const } },
      },
      required: ['product_ids'],
    },
  },
];

function computeScore(m: ProductMetrics): { overall: number; demand: number; competition: number; margin: number; trend: number; risk: number } {
  const demand = scoreDemand(m);
  const competition = scoreCompetition(m);
  const margin = scoreMargin(m);
  const trend = scoreTrend(m);
  const risk = scoreRisk(m);
  const overall = Math.round(demand * 0.25 + competition * 0.20 + margin * 0.30 + trend * 0.10 + risk * 0.15);
  return { overall, demand, competition, margin, trend, risk };
}

export function handleScoringTool(
  db: Database,
  toolName: string,
  input: Record<string, unknown>,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'score_product': {
        const metrics: ProductMetrics = {
          bsr: input.bsr as number | undefined,
          monthly_sales_est: input.monthly_sales_est as number | undefined,
          review_count: input.review_count as number | undefined,
          review_rating: input.review_rating as number | undefined,
          competitor_count: input.competitor_count as number | undefined,
          margin_pct: input.margin_pct as number | undefined,
          price: input.price as number | undefined,
          category: input.category as string | undefined,
        };
        const scores = computeScore(metrics);
        const pid = input.product_id as string;

        if (pid) {
          db.run(
            `INSERT INTO product_scores (product_id, overall_score, demand_score, competition_score, margin_score, trend_score, risk_score)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [pid, scores.overall, scores.demand, scores.competition, scores.margin, scores.trend, scores.risk],
          );
        }

        const recommendation = scores.overall >= 75 ? 'Strong Buy' : scores.overall >= 60 ? 'Buy' : scores.overall >= 45 ? 'Hold/Monitor' : 'Avoid';
        return { success: true, data: { product_id: pid, scores, recommendation } };
      }

      case 'rank_opportunities': {
        const ids = input.product_ids as string[] | undefined;
        const limit = (input.limit as number) ?? 20;
        let rows: Array<Record<string, unknown>>;

        if (ids?.length) {
          const placeholders = ids.map(() => '?').join(',');
          rows = db.query<Record<string, unknown>>(
            `SELECT p.id, p.title, p.category, o.margin_pct, o.estimated_profit
             FROM products p LEFT JOIN opportunities o ON p.id = o.product_id
             WHERE p.id IN (${placeholders}) AND (o.status IS NULL OR o.status = 'active')
             LIMIT ?`,
            [...ids, limit],
          );
        } else {
          rows = db.query<Record<string, unknown>>(
            `SELECT p.id, p.title, p.category, o.margin_pct, o.estimated_profit
             FROM products p LEFT JOIN opportunities o ON p.id = o.product_id
             WHERE o.status = 'active' LIMIT ?`,
            [limit],
          );
        }

        const scored = rows.map((r) => {
          const m: ProductMetrics = { margin_pct: r.margin_pct as number | undefined, category: r.category as string | undefined };
          const scores = computeScore(m);
          return { product_id: r.id, title: r.title, category: r.category, margin_pct: r.margin_pct, scores };
        }).sort((a, b) => b.scores.overall - a.scores.overall);

        return { success: true, data: { ranked: scored, count: scored.length } };
      }

      case 'niche_analysis': {
        const category = input.category as string;
        if (!category) return { success: false, error: 'category required' };

        const products = db.query<Record<string, unknown>>(
          'SELECT COUNT(*) as count FROM products WHERE category = ?', [category],
        );
        const opps = db.query<Record<string, unknown>>(
          `SELECT AVG(margin_pct) as avg_margin, AVG(sell_price) as avg_price, COUNT(*) as opp_count
           FROM opportunities WHERE product_id IN (SELECT id FROM products WHERE category = ?)`,
          [category],
        );
        const productCount = (products[0]?.count as number) ?? 0;
        const avgMargin = (opps[0]?.avg_margin as number) ?? 0;
        const avgPrice = (opps[0]?.avg_price as number) ?? 0;
        const oppCount = (opps[0]?.opp_count as number) ?? 0;

        const nicheScore = clamp(Math.round(avgMargin * 1.5 + (oppCount > 10 ? 20 : oppCount * 2) - productCount * 0.1), 0, 100);
        const recommendation = nicheScore >= 70 ? 'enter' : nicheScore >= 40 ? 'monitor' : 'avoid';

        db.run(
          `INSERT INTO niche_analyses (category, keywords_json, saturation_index, niche_score, avg_price, seller_count, recommendation)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [category, JSON.stringify(input.keywords ?? []), productCount, nicheScore, avgPrice, productCount, recommendation],
        );

        return { success: true, data: { category, niche_score: nicheScore, avg_margin: Math.round(avgMargin * 100) / 100, avg_price: Math.round(avgPrice * 100) / 100, product_count: productCount, opportunity_count: oppCount, recommendation } };
      }

      case 'compare_scored_products': {
        const ids = input.product_ids as string[];
        if (!ids?.length) return { success: false, error: 'product_ids required' };

        const results = ids.map((id) => {
          const rows = db.query<Record<string, unknown>>(
            `SELECT p.id, p.title, p.category, o.margin_pct, o.buy_price, o.sell_price
             FROM products p LEFT JOIN opportunities o ON p.id = o.product_id
             WHERE p.id = ? LIMIT 1`,
            [id],
          );
          const r = rows[0];
          if (!r) return { product_id: id, error: 'Not found' };
          const m: ProductMetrics = { margin_pct: r.margin_pct as number | undefined };
          const scores = computeScore(m);
          return { product_id: id, title: r.title, category: r.category, margin_pct: r.margin_pct, buy_price: r.buy_price, sell_price: r.sell_price, scores };
        });

        return { success: true, data: { comparison: results } };
      }

      default:
        return { success: false, error: `Unknown scoring tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
