/**
 * Premium feature routes — server-side logic for paid features
 *
 * POST /premium/score — Opportunity scoring algorithm
 * POST /premium/optimize — AI listing optimization
 */
import { Router, Request, Response } from 'express';
import type { UsageService } from '../billing/usage';

export function createPremiumRoutes(usageService: UsageService): Router {
  const router = Router();

  // POST /premium/score — Full 6-signal opportunity scoring
  router.post('/score', async (req: Request, res: Response) => {
    const plan = (req as unknown as Record<string, unknown>).userPlan as string;
    if (plan !== 'premium') {
      res.status(403).json({ error: 'Premium plan required for full scoring' });
      return;
    }

    const { opportunity } = req.body as {
      opportunity?: {
        buyPrice: number;
        sellPrice: number;
        buyShipping: number;
        category?: string;
        brand?: string;
        salesRank?: number;
      };
    };

    if (!opportunity || typeof opportunity.buyPrice !== 'number' || typeof opportunity.sellPrice !== 'number') {
      res.status(400).json({ error: 'Valid opportunity object required with buyPrice and sellPrice' });
      return;
    }

    const { buyPrice, sellPrice, buyShipping = 0, category, salesRank } = opportunity;
    const totalCost = buyPrice + buyShipping;
    const grossProfit = sellPrice - totalCost;
    const marginPct = totalCost > 0 ? (grossProfit / sellPrice) * 100 : 0;

    // 6-signal scoring: margin, absolute profit, sales velocity, category demand, brand premium, risk
    const signals = {
      margin: Math.min(marginPct / 50, 1) * 25,           // 0-25 pts
      absoluteProfit: Math.min(grossProfit / 50, 1) * 20,   // 0-20 pts
      salesVelocity: salesRank ? Math.max(0, 1 - salesRank / 100000) * 20 : 10, // 0-20 pts
      categoryDemand: getCategoryScore(category) * 15,      // 0-15 pts
      riskAdjustment: getRiskScore(marginPct, totalCost) * 10, // 0-10 pts
      pricePoint: getPricePointScore(sellPrice) * 10,       // 0-10 pts
    };

    const totalScore = Object.values(signals).reduce((a, b) => a + b, 0);

    res.json({
      score: Math.round(totalScore * 10) / 10,
      maxScore: 100,
      grade: totalScore >= 80 ? 'A' : totalScore >= 60 ? 'B' : totalScore >= 40 ? 'C' : 'D',
      signals,
      recommendation: totalScore >= 60 ? 'buy' : totalScore >= 40 ? 'watchlist' : 'pass',
    });
  });

  // POST /premium/optimize — AI listing optimization
  router.post('/optimize', async (req: Request, res: Response) => {
    const plan = (req as unknown as Record<string, unknown>).userPlan as string;
    if (plan !== 'premium') {
      res.status(403).json({ error: 'Premium plan required for listing optimization' });
      return;
    }

    const { title, description, category, price } = req.body as {
      title?: string;
      description?: string;
      category?: string;
      price?: number;
    };

    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    // Server-side optimization logic (deterministic, no external API call)
    const optimized = {
      title: optimizeTitle(title, category),
      keywords: extractKeywords(title, description),
      suggestedPrice: price ? suggestPrice(price) : undefined,
      tips: generateListingTips(title, description, category),
    };

    res.json(optimized);
  });

  // POST /usage/report — Log completed sale GMV (API key auth, analytics only)
  router.post('/usage/report', async (req: Request, res: Response) => {
    const userId = (req as unknown as Record<string, unknown>).userId as string;
    const apiKeyHash = (req as unknown as Record<string, unknown>).apiKeyHash as string | undefined;

    const { gmvCents, idempotencyKey, metadata } = req.body as {
      gmvCents?: number;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    };

    if (typeof gmvCents !== 'number' || gmvCents <= 0) {
      res.status(400).json({ error: 'gmvCents must be a positive number' });
      return;
    }
    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      res.status(400).json({ error: 'idempotencyKey is required' });
      return;
    }

    try {
      const result = await usageService.reportSale({
        userId,
        apiKeyHash,
        gmvCents,
        idempotencyKey,
        metadata,
      });
      res.json({ recorded: result.recorded });
    } catch (err) {
      res.status(500).json({ error: 'Failed to record usage' });
    }
  });

  return router;
}

// --- Helper functions for scoring ---

function getCategoryScore(category?: string): number {
  if (!category) return 0.5;
  const highDemand = ['electronics', 'toys', 'home', 'beauty', 'health', 'sports'];
  const medDemand = ['clothing', 'automotive', 'office', 'garden', 'pet'];
  const lower = category.toLowerCase();
  if (highDemand.some((c) => lower.includes(c))) return 0.9;
  if (medDemand.some((c) => lower.includes(c))) return 0.6;
  return 0.4;
}

function getRiskScore(marginPct: number, totalCost: number): number {
  let score = 0.5;
  if (marginPct > 30) score += 0.2;
  if (totalCost < 50) score += 0.2; // Lower capital risk
  if (marginPct > 15 && totalCost < 100) score += 0.1;
  return Math.min(score, 1);
}

function getPricePointScore(sellPrice: number): number {
  // Sweet spot: $15-$75 for fastest turnover
  if (sellPrice >= 15 && sellPrice <= 75) return 1;
  if (sellPrice >= 10 && sellPrice <= 100) return 0.7;
  if (sellPrice >= 5 && sellPrice <= 200) return 0.4;
  return 0.2;
}

function optimizeTitle(title: string, category?: string): string {
  // Remove excessive caps, add category keywords
  let optimized = title
    .replace(/\b([A-Z]{4,})\b/g, (match) => match.charAt(0) + match.slice(1).toLowerCase())
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Ensure title doesn't exceed 80 chars (eBay guideline)
  if (optimized.length > 80) {
    optimized = optimized.slice(0, 77) + '...';
  }

  return optimized;
}

function extractKeywords(title: string, description?: string): string[] {
  const text = `${title} ${description ?? ''}`.toLowerCase();
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'it', 'this', 'that', 'new', 'free']);
  const words = text.match(/\b\w{3,}\b/g) ?? [];
  const unique = [...new Set(words.filter((w) => !stopWords.has(w)))];
  return unique.slice(0, 20);
}

function suggestPrice(price: number): { competitive: number; premium: number; clearance: number } {
  return {
    competitive: Math.round(price * 0.95 * 100) / 100,
    premium: Math.round(price * 1.1 * 100) / 100,
    clearance: Math.round(price * 0.85 * 100) / 100,
  };
}

function generateListingTips(title: string, description?: string, category?: string): string[] {
  const tips: string[] = [];
  if (title.length < 30) tips.push('Title is short — add more descriptive keywords for better search visibility');
  if (title.length > 80) tips.push('Title exceeds 80 characters — consider shortening for eBay compliance');
  if (!description) tips.push('Add a detailed description to improve buyer confidence');
  if (description && description.length < 100) tips.push('Description is brief — add condition details, dimensions, and included accessories');
  if (!category) tips.push('Specify a category to improve search placement');
  if (title === title.toUpperCase()) tips.push('Avoid ALL CAPS in titles — it reduces click-through rate');
  return tips;
}
