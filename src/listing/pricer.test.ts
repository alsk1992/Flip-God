import { describe, it, expect } from 'vitest';
import { recommendPrice } from './pricer';

describe('recommendPrice', () => {
  it('recommends a price above minimum viable price', () => {
    const rec = recommendPrice('amazon', 10, 2, 'ebay', 25);

    // totalCost = 10 + 2 = 12
    // minViablePrice = 12 / (1 - 0.25) = 12 / 0.75 = 16
    expect(rec.recommendedPrice).toBeGreaterThanOrEqual(rec.minPrice);
    expect(rec.minPrice).toBeCloseTo(16, 0);
  });

  it('factors in competitor prices (recommends slightly below average)', () => {
    const rec = recommendPrice(
      'amazon', 10, 0, 'ebay', 25,
      [50, 60, 70], // competitors average = 60
    );

    // recommended = max(minViable, avgCompetitor * 0.95) = max(13.33, 57)
    expect(rec.recommendedPrice).toBeCloseTo(57, 0);
  });

  it('never recommends below minimum viable price', () => {
    const rec = recommendPrice(
      'amazon', 40, 5, 'ebay', 30,
      [30, 35], // competitors low
    );

    // totalCost = 45
    // minViablePrice = 45 / (1 - 0.30) = 45 / 0.70 = 64.28
    // avgCompetitor = 32.5, * 0.95 = 30.875
    // recommended = max(64.28, 30.875) = 64.28
    expect(rec.recommendedPrice).toBeGreaterThanOrEqual(rec.minPrice);
  });

  it('handles targetMarginPct >= 100 (division by zero guard)', () => {
    // If targetMarginPct >= 100, it would cause division by zero
    // Code clamps to 99
    const rec = recommendPrice('amazon', 10, 0, 'ebay', 100);

    // clampedMargin = 99
    // minViablePrice = 10 / (1 - 0.99) = 10 / 0.01 = 1000
    expect(rec.minPrice).toBeCloseTo(1000, 0);
    expect(rec.recommendedPrice).toBeGreaterThan(0);
  });

  it('handles targetMarginPct of exactly 100 without throwing', () => {
    // Should not throw -- clamps to 99
    expect(() => {
      recommendPrice('amazon', 10, 0, 'ebay', 100);
    }).not.toThrow();
  });

  it('handles targetMarginPct > 100 without throwing', () => {
    expect(() => {
      recommendPrice('amazon', 10, 0, 'ebay', 150);
    }).not.toThrow();
  });

  it('uses 1.2x minViablePrice when no competitors', () => {
    const rec = recommendPrice('amazon', 10, 0, 'ebay', 25);

    // No competitors: avgCompetitor = minViablePrice * 1.2
    // minViablePrice = 10 / 0.75 = 13.33
    // avgCompetitor = 13.33 * 1.2 = 16
    // recommended = max(13.33, 16 * 0.95) = max(13.33, 15.2) = 15.2
    expect(rec.recommendedPrice).toBeGreaterThan(rec.minPrice * 0.9);
  });

  it('returns maxPrice = avgCompetitor * 1.1', () => {
    const rec = recommendPrice(
      'amazon', 10, 0, 'ebay', 25,
      [50, 50],
    );

    // avgCompetitor = 50
    // maxPrice = 50 * 1.1 = 55
    expect(rec.maxPrice).toBeCloseTo(55, 0);
  });

  it('rounds prices to 2 decimal places', () => {
    const rec = recommendPrice('amazon', 11.11, 2.22, 'ebay', 25);

    const decimals = (n: number) => {
      const s = n.toString();
      const dot = s.indexOf('.');
      return dot === -1 ? 0 : s.length - dot - 1;
    };

    expect(decimals(rec.recommendedPrice)).toBeLessThanOrEqual(2);
    expect(decimals(rec.minPrice)).toBeLessThanOrEqual(2);
    expect(decimals(rec.maxPrice)).toBeLessThanOrEqual(2);
  });

  it('includes margin percentage in result', () => {
    const rec = recommendPrice('amazon', 10, 0, 'ebay', 25);
    expect(typeof rec.margin).toBe('number');
  });

  it('returns competitor prices in result', () => {
    const competitors = [40, 50, 60];
    const rec = recommendPrice('amazon', 10, 0, 'ebay', 25, competitors);
    expect(rec.competitorPrices).toEqual(competitors);
  });

  it('handles zero buy price', () => {
    const rec = recommendPrice('amazon', 0, 0, 'ebay', 25);
    // totalCost = 0, minViable = 0 / 0.75 = 0
    expect(rec.minPrice).toBe(0);
    expect(rec.recommendedPrice).toBe(0);
  });

  it('handles default targetMarginPct (25%)', () => {
    const rec = recommendPrice('amazon', 10, 0, 'ebay');
    // Default 25%, totalCost = 10
    // minViable = 10 / 0.75 = 13.33
    expect(rec.minPrice).toBeCloseTo(13.33, 1);
  });
});
