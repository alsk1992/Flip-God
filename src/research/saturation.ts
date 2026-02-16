/**
 * Market Saturation Analysis Module
 */

import type { Database } from '../db/index.js';

export const saturationTools = [
  {
    name: 'saturation_index',
    description: 'Calculate market saturation index for a category (0-100, higher = more saturated)',
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
    name: 'seller_density',
    description: 'Analyze seller density in a category',
    input_schema: {
      type: 'object' as const,
      properties: { category: { type: 'string' as const } },
      required: ['category'],
    },
  },
  {
    name: 'price_race_detector',
    description: 'Detect price race-to-bottom in a category or set of products',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: { type: 'string' as const },
        product_ids: { type: 'array' as const, items: { type: 'string' as const } },
      },
    },
  },
  {
    name: 'opportunity_gaps',
    description: 'Find underserved niches with low competition and high demand',
    input_schema: {
      type: 'object' as const,
      properties: {
        parent_category: { type: 'string' as const },
        min_opportunities: { type: 'number' as const },
      },
      required: ['parent_category'],
    },
  },
];

export function handleSaturationTool(
  db: Database,
  toolName: string,
  input: Record<string, unknown>,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'saturation_index': {
        const category = input.category as string;
        if (!category) return { success: false, error: 'category required' };

        const products = db.query<Record<string, unknown>>(
          'SELECT COUNT(*) as count FROM products WHERE category = ?', [category],
        );
        const listings = db.query<Record<string, unknown>>(
          `SELECT COUNT(*) as count FROM listings WHERE status = 'active' AND product_id IN (SELECT id FROM products WHERE category = ?)`,
          [category],
        );
        const sellers = db.query<Record<string, unknown>>(
          `SELECT COUNT(DISTINCT seller) as count FROM prices WHERE product_id IN (SELECT id FROM products WHERE category = ?)`,
          [category],
        );
        const priceSpread = db.query<Record<string, unknown>>(
          `SELECT MIN(price) as min_price, MAX(price) as max_price, AVG(price) as avg_price
           FROM prices WHERE product_id IN (SELECT id FROM products WHERE category = ?)`,
          [category],
        );

        const productCount = (products[0]?.count as number) ?? 0;
        const listingCount = (listings[0]?.count as number) ?? 0;
        const sellerCount = (sellers[0]?.count as number) ?? 0;
        const minPrice = (priceSpread[0]?.min_price as number) ?? 0;
        const maxPrice = (priceSpread[0]?.max_price as number) ?? 0;
        const avgPrice = (priceSpread[0]?.avg_price as number) ?? 0;

        const listingsPerSeller = sellerCount > 0 ? listingCount / sellerCount : 0;
        const priceCompression = maxPrice > 0 ? Math.round(((maxPrice - minPrice) / maxPrice) * 100) : 0;

        // Saturation index: higher = more saturated
        let index = 0;
        index += Math.min(sellerCount * 2, 30); // Seller count (max 30)
        index += Math.min(productCount, 20); // Product count (max 20)
        index += Math.max(0, 30 - priceCompression); // Low spread = saturated (max 30)
        index += listingsPerSeller > 5 ? 20 : listingsPerSeller > 2 ? 10 : 0;
        index = Math.min(index, 100);

        const level = index >= 75 ? 'oversaturated' : index >= 50 ? 'high' : index >= 25 ? 'medium' : 'low';

        return {
          success: true,
          data: {
            category, saturation_index: index, saturation_level: level,
            metrics: { product_count: productCount, listing_count: listingCount, seller_count: sellerCount,
              listings_per_seller: Math.round(listingsPerSeller * 100) / 100, price_compression_pct: priceCompression,
              min_price: Math.round(minPrice * 100) / 100, max_price: Math.round(maxPrice * 100) / 100, avg_price: Math.round(avgPrice * 100) / 100 },
          },
        };
      }

      case 'seller_density': {
        const category = input.category as string;
        if (!category) return { success: false, error: 'category required' };

        const sellers = db.query<Record<string, unknown>>(
          `SELECT seller, COUNT(*) as listing_count, AVG(price) as avg_price
           FROM prices WHERE product_id IN (SELECT id FROM products WHERE category = ?) AND seller IS NOT NULL
           GROUP BY seller ORDER BY listing_count DESC LIMIT 20`,
          [category],
        );
        const totalSellers = db.query<Record<string, unknown>>(
          `SELECT COUNT(DISTINCT seller) as count FROM prices WHERE product_id IN (SELECT id FROM products WHERE category = ?)`,
          [category],
        );
        const totalListings = db.query<Record<string, unknown>>(
          `SELECT COUNT(*) as count FROM prices WHERE product_id IN (SELECT id FROM products WHERE category = ?)`,
          [category],
        );

        const tSellers = (totalSellers[0]?.count as number) ?? 0;
        const tListings = (totalListings[0]?.count as number) ?? 0;
        const topSellerShare = sellers.length > 0 ? Math.round(((sellers[0]?.listing_count as number) ?? 0) / Math.max(tListings, 1) * 10000) / 100 : 0;

        return {
          success: true,
          data: {
            category, total_sellers: tSellers, total_listings: tListings,
            avg_listings_per_seller: tSellers > 0 ? Math.round(tListings / tSellers * 100) / 100 : 0,
            top_seller_market_share_pct: topSellerShare, top_sellers: sellers,
          },
        };
      }

      case 'price_race_detector': {
        const category = input.category as string;
        const productIds = input.product_ids as string[] | undefined;

        let whereClause: string;
        let params: unknown[];
        if (productIds?.length) {
          const ph = productIds.map(() => '?').join(',');
          whereClause = `product_id IN (${ph})`;
          params = [...productIds];
        } else if (category) {
          whereClause = `product_id IN (SELECT id FROM products WHERE category = ?)`;
          params = [category];
        } else {
          return { success: false, error: 'category or product_ids required' };
        }

        // Compare recent prices vs older prices
        const recent = db.query<Record<string, unknown>>(
          `SELECT product_id, AVG(price) as avg_price FROM prices
           WHERE ${whereClause} AND fetched_at > (strftime('%s','now') * 1000 - 604800000)
           GROUP BY product_id`,
          params,
        );
        const older = db.query<Record<string, unknown>>(
          `SELECT product_id, AVG(price) as avg_price FROM prices
           WHERE ${whereClause} AND fetched_at <= (strftime('%s','now') * 1000 - 604800000) AND fetched_at > (strftime('%s','now') * 1000 - 2592000000)
           GROUP BY product_id`,
          params,
        );

        const olderMap = new Map(older.map((r) => [r.product_id as string, r.avg_price as number]));
        const declining: Array<{ product_id: string; recent_avg: number; older_avg: number; decline_pct: number }> = [];

        for (const r of recent) {
          const pid = r.product_id as string;
          const recentAvg = r.avg_price as number;
          const olderAvg = olderMap.get(pid);
          if (olderAvg != null && olderAvg > 0) {
            const decline = Math.round(((olderAvg - recentAvg) / olderAvg) * 10000) / 100;
            if (decline > 5) {
              declining.push({ product_id: pid, recent_avg: Math.round(recentAvg * 100) / 100, older_avg: Math.round(olderAvg * 100) / 100, decline_pct: decline });
            }
          }
        }

        declining.sort((a, b) => b.decline_pct - a.decline_pct);
        return {
          success: true,
          data: {
            products_analyzed: recent.length,
            declining_products: declining.length,
            races_detected: declining,
            severity: declining.length > recent.length * 0.5 ? 'high' : declining.length > 0 ? 'moderate' : 'none',
          },
        };
      }

      case 'opportunity_gaps': {
        const parent = input.parent_category as string;
        if (!parent) return { success: false, error: 'parent_category required' };
        const minOpps = (input.min_opportunities as number) ?? 1;

        const categories = db.query<Record<string, unknown>>(
          `SELECT p.category, COUNT(DISTINCT p.id) as product_count,
                  COUNT(DISTINCT o.id) as opp_count, AVG(o.margin_pct) as avg_margin
           FROM products p LEFT JOIN opportunities o ON p.id = o.product_id AND o.status = 'active'
           WHERE p.category LIKE ? GROUP BY p.category HAVING opp_count >= ?
           ORDER BY avg_margin DESC`,
          [`${parent}%`, minOpps],
        );

        const gaps = categories.map((c) => ({
          category: c.category,
          product_count: c.product_count,
          opportunity_count: c.opp_count,
          avg_margin: Math.round(((c.avg_margin as number) ?? 0) * 100) / 100,
          gap_score: Math.round(((c.avg_margin as number) ?? 0) * 2 - ((c.product_count as number) ?? 0) * 0.5),
        })).sort((a, b) => b.gap_score - a.gap_score);

        return { success: true, data: { parent_category: parent, gaps, count: gaps.length } };
      }

      default:
        return { success: false, error: `Unknown saturation tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
