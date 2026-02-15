/**
 * Trend Detection - Identify trending products and categories
 */

import { createLogger } from '../utils/logger';
import type { Platform } from '../types';

const logger = createLogger('trends');

export interface TrendSignal {
  keyword: string;
  score: number;
  direction: 'rising' | 'stable' | 'falling';
  category?: string;
  platforms: Platform[];
  detectedAt: Date;
}

export interface TrendAnalysis {
  signals: TrendSignal[];
  topCategories: Array<{ category: string; signalCount: number; avgScore: number }>;
  summary: string;
}

export interface PriceMovement {
  productId: string;
  platform: Platform;
  oldPrice: number;
  newPrice: number;
  changePct: number;
  detectedAt: Date;
}

export interface TrendDetector {
  analyzePriceMovements(movements: PriceMovement[]): TrendSignal[];
  detectSeasonalTrends(month: number): TrendSignal[];
  generateAnalysis(signals: TrendSignal[]): TrendAnalysis;
}

const seasonalTrends: Record<number, string[]> = {
  1: ['fitness equipment', 'organization', 'tax software'],
  2: ['valentines gifts', 'chocolate', 'jewelry'],
  3: ['spring cleaning', 'gardening', 'allergy medicine'],
  4: ['outdoor furniture', 'grills', 'easter'],
  5: ['mothers day', 'outdoor toys', 'sunscreen'],
  6: ['fathers day', 'outdoor gear', 'travel accessories'],
  7: ['back to school', 'school supplies', 'dorm essentials'],
  8: ['back to school', 'laptops', 'backpacks'],
  9: ['fall decor', 'halloween costumes', 'football gear'],
  10: ['halloween', 'costumes', 'candy', 'fall clothing'],
  11: ['black friday', 'holiday gifts', 'christmas decor'],
  12: ['christmas gifts', 'toys', 'gift cards', 'winter clothing'],
};

export function createTrendDetector(): TrendDetector {
  return {
    analyzePriceMovements(movements: PriceMovement[]): TrendSignal[] {
      const drops = movements.filter(m => m.changePct < -10);
      const spikes = movements.filter(m => m.changePct > 10);
      const signals: TrendSignal[] = [];

      if (drops.length > 0) {
        const avgDrop = drops.reduce((s, d) => s + d.changePct, 0) / drops.length;
        signals.push({
          keyword: 'price_drops',
          score: Math.min(Math.abs(avgDrop) * 2, 100),
          direction: 'falling',
          platforms: [...new Set(drops.map(d => d.platform))],
          detectedAt: new Date(),
        });
      }

      if (spikes.length > 0) {
        const avgSpike = spikes.reduce((s, d) => s + d.changePct, 0) / spikes.length;
        signals.push({
          keyword: 'price_spikes',
          score: Math.min(avgSpike * 2, 100),
          direction: 'rising',
          platforms: [...new Set(spikes.map(s => s.platform))],
          detectedAt: new Date(),
        });
      }

      return signals;
    },

    detectSeasonalTrends(month: number): TrendSignal[] {
      const categories = seasonalTrends[month] ?? [];
      return categories.map((category, i) => ({
        keyword: category,
        score: 80 - i * 10,
        direction: 'rising' as const,
        category,
        platforms: ['amazon', 'ebay', 'walmart'] as Platform[],
        detectedAt: new Date(),
      }));
    },

    generateAnalysis(signals: TrendSignal[]): TrendAnalysis {
      const categoryMap = new Map<string, TrendSignal[]>();
      for (const sig of signals) {
        const cat = sig.category ?? 'uncategorized';
        const existing = categoryMap.get(cat) ?? [];
        existing.push(sig);
        categoryMap.set(cat, existing);
      }

      const topCategories = [...categoryMap.entries()]
        .map(([category, sigs]) => ({
          category,
          signalCount: sigs.length,
          avgScore: sigs.reduce((s, sig) => s + sig.score, 0) / sigs.length,
        }))
        .sort((a, b) => b.avgScore - a.avgScore)
        .slice(0, 10);

      const rising = signals.filter(s => s.direction === 'rising').length;
      const falling = signals.filter(s => s.direction === 'falling').length;

      const summary = [
        `Found ${signals.length} trend signals.`,
        rising > 0 ? `${rising} rising (sell opportunities).` : '',
        falling > 0 ? `${falling} falling (buy opportunities).` : '',
        topCategories[0] ? `Top: ${topCategories[0].category} (score ${topCategories[0].avgScore.toFixed(0)}).` : '',
      ].filter(Boolean).join(' ');

      return { signals, topCategories, summary };
    },
  };
}
