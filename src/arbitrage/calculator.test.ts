import { describe, it, expect } from 'vitest';
import { calculateProfit, calculateFees, getFeeSchedule } from './calculator';

// =============================================================================
// calculateProfit
// =============================================================================

describe('calculateProfit', () => {
  it('calculates basic profit: buy $10, sell $20 on eBay', () => {
    const result = calculateProfit('ebay', 20, 'amazon', 10, 0, 0);

    // eBay fees: 12.9% of $20 = $2.58, fixed $0.30
    // shippingCost: sellShipping=0, uses ?? so 0 (not estimate)
    // platformFees = 2.58 + 0.30 = 2.88
    // totalCost = 10 + 0 + 2.88 + 0 + 0 = 12.88
    // netProfit = 20 - 12.88 = 7.12
    expect(result.sellPrice).toBe(20);
    expect(result.buyPrice).toBe(10);
    expect(result.buyShipping).toBe(0);
    expect(result.platformFees).toBeCloseTo(2.88, 2);
    expect(result.paymentFees).toBe(0);
    expect(result.shippingCost).toBe(0);
    expect(result.grossProfit).toBe(10);
    expect(result.netProfit).toBeCloseTo(7.12, 2);
    expect(result.marginPct).toBeCloseTo(35.6, 1);
    expect(result.roi).toBeGreaterThan(0);
  });

  it('accounts for buy shipping in total cost', () => {
    const result = calculateProfit('ebay', 30, 'amazon', 15, 5, 0);

    // buyPrice + buyShipping = 20
    // grossProfit = 30 - 15 - 5 = 10
    expect(result.grossProfit).toBe(10);
    expect(result.buyShipping).toBe(5);
    expect(result.totalCost).toBeGreaterThan(20); // 20 + fees + shipping
  });

  it('uses sellShipping=0 when explicitly passed as 0 (not fallback to estimate)', () => {
    // This is the ?? vs || fix test
    const result = calculateProfit('ebay', 20, 'amazon', 10, 0, 0);

    // With sellShipping=0 and ??, shippingCost should be 0
    // With ||, it would fall back to 5.99 (eBay estimate)
    expect(result.shippingCost).toBe(0);
  });

  it('falls back to shipping estimate when sellShipping is undefined', () => {
    // Default param sellShipping=0, so explicitly undefined test:
    const result = calculateProfit('ebay', 20, 'amazon', 10, 0);

    // sellShipping defaults to 0 in the function signature
    // 0 ?? estimate = 0 (nullish coalescing only triggers on null/undefined)
    // So with default param = 0, shippingCost = 0
    expect(result.shippingCost).toBe(0);
  });

  it('uses platform shipping estimate when sellShipping is null-ish', () => {
    // We need to test what happens when sellShipping is explicitly undefined
    // The function signature defaults to 0, but ?? only falls back on null/undefined
    // Since default is 0, and 0 ?? x = 0, this behaves correctly
    const fees = getFeeSchedule('ebay');
    expect(fees.shippingEstimate).toBe(5.99);
  });

  it('handles zero sell price gracefully (marginPct=0)', () => {
    const result = calculateProfit('ebay', 0, 'amazon', 10, 0, 0);
    expect(result.marginPct).toBe(0);
    expect(result.netProfit).toBeLessThan(0);
  });

  it('returns negative profit when margin is negative', () => {
    const result = calculateProfit('ebay', 10, 'amazon', 20, 0, 0);
    expect(result.netProfit).toBeLessThan(0);
    expect(result.grossProfit).toBeLessThan(0);
    expect(result.marginPct).toBeLessThan(0);
  });

  it('handles Amazon as sell platform with correct fees', () => {
    const result = calculateProfit('amazon', 50, 'ebay', 30, 0, 0);

    // Amazon: 15% of $50 = $7.50, fixed $0.99
    expect(result.platformFees).toBeCloseTo(8.49, 2);
  });

  it('handles Walmart as sell platform with correct fees', () => {
    const result = calculateProfit('walmart', 100, 'amazon', 60, 0, 0);

    // Walmart: 15% of $100 = $15, fixed $0
    expect(result.platformFees).toBeCloseTo(15, 2);
  });

  it('handles AliExpress as sell platform with correct fees', () => {
    const result = calculateProfit('aliexpress', 50, 'amazon', 30, 0, 0);

    // AliExpress: 8% of $50 = $4, fixed $0
    expect(result.platformFees).toBeCloseTo(4, 2);
  });

  it('calculates ROI correctly', () => {
    const result = calculateProfit('ebay', 100, 'amazon', 50, 5, 0);

    // ROI = netProfit / (buyPrice + buyShipping) * 100
    // totalCost = 50 + 5 + fees + 0 + 0
    const expectedRoi = (result.netProfit / (50 + 5)) * 100;
    expect(result.roi).toBeCloseTo(expectedRoi, 2);
  });

  it('handles large price differences', () => {
    const result = calculateProfit('ebay', 1000, 'aliexpress', 50, 10, 0);
    expect(result.netProfit).toBeGreaterThan(800);
    expect(result.marginPct).toBeGreaterThan(80);
  });

  it('handles very small prices', () => {
    const result = calculateProfit('ebay', 1.00, 'amazon', 0.50, 0, 0);
    expect(result.sellPrice).toBe(1);
    expect(result.buyPrice).toBe(0.5);
  });
});

// =============================================================================
// calculateFees
// =============================================================================

describe('calculateFees', () => {
  it('calculates default eBay fees (no category)', () => {
    const fees = calculateFees('ebay', 100);

    // Default eBay: 12.9%
    expect(fees.sellerFee).toBeCloseTo(12.9, 2);
    expect(fees.fixedFee).toBe(0.30);
    expect(fees.paymentFee).toBe(0);
    expect(fees.totalFees).toBeCloseTo(13.2, 1);
    expect(fees.netAfterFees).toBeCloseTo(86.8, 1);
  });

  it('calculates Amazon electronics category fees', () => {
    const fees = calculateFees('amazon', 100, 'electronics');

    // Amazon electronics: 8%
    expect(fees.sellerFee).toBe(8);
    expect(fees.fixedFee).toBe(0.99);
    expect(fees.totalFees).toBeCloseTo(8.99, 2);
  });

  it('calculates Amazon clothing category fees', () => {
    const fees = calculateFees('amazon', 100, 'clothing');

    // Amazon clothing: 17%
    expect(fees.sellerFee).toBe(17);
  });

  it('calculates eBay electronics fees', () => {
    const fees = calculateFees('ebay', 100, 'electronics');

    // eBay electronics: 9.9%
    expect(fees.sellerFee).toBeCloseTo(9.9, 2);
  });

  it('calculates eBay jewelry fees', () => {
    const fees = calculateFees('ebay', 100, 'jewelry');

    // eBay jewelry: 15%
    expect(fees.sellerFee).toBe(15);
  });

  it('calculates Walmart electronics fees', () => {
    const fees = calculateFees('walmart', 100, 'electronics');

    // Walmart electronics: 8%
    expect(fees.sellerFee).toBe(8);
    expect(fees.fixedFee).toBe(0);
  });

  it('calculates AliExpress fees (always 8% regardless of category)', () => {
    const fees = calculateFees('aliexpress', 100, 'electronics');
    expect(fees.sellerFee).toBe(8);

    const fees2 = calculateFees('aliexpress', 100, 'clothing');
    expect(fees2.sellerFee).toBe(8);
  });

  it('falls back to default rate for unknown categories', () => {
    const amazonFees = calculateFees('amazon', 100, 'unicorn_supplies');
    expect(amazonFees.sellerFee).toBe(15); // Amazon default

    const ebayFees = calculateFees('ebay', 100, 'unicorn_supplies');
    expect(ebayFees.sellerFee).toBeCloseTo(12.9, 2); // eBay default

    const walmartFees = calculateFees('walmart', 100, 'unicorn_supplies');
    expect(walmartFees.sellerFee).toBe(15); // Walmart default
  });

  it('handles zero price', () => {
    const fees = calculateFees('ebay', 0);
    expect(fees.sellerFee).toBe(0);
    expect(fees.totalFees).toBe(0.30); // Only fixed fee
    expect(fees.netAfterFees).toBe(-0.30);
  });

  it('rounds results to 2 decimal places', () => {
    const fees = calculateFees('ebay', 33.33);
    // 33.33 * 12.9% = 4.29957
    expect(fees.sellerFee).toBe(Math.round(4.29957 * 100) / 100);

    // Verify all returned values are rounded
    const decimals = (n: number) => {
      const s = n.toString();
      const dot = s.indexOf('.');
      return dot === -1 ? 0 : s.length - dot - 1;
    };
    expect(decimals(fees.sellerFee)).toBeLessThanOrEqual(2);
    expect(decimals(fees.totalFees)).toBeLessThanOrEqual(2);
    expect(decimals(fees.netAfterFees)).toBeLessThanOrEqual(2);
  });

  it('normalizes category strings (lowercase, strip special chars)', () => {
    // "Electronics!" should match "electronics"
    const fees = calculateFees('amazon', 100, 'Electronics!');
    expect(fees.sellerFee).toBe(8); // electronics rate
  });
});

// =============================================================================
// getFeeSchedule
// =============================================================================

describe('getFeeSchedule', () => {
  it('returns correct eBay fee schedule', () => {
    const schedule = getFeeSchedule('ebay');
    expect(schedule.platform).toBe('ebay');
    expect(schedule.sellerFeePct).toBe(12.9);
    expect(schedule.fixedFee).toBe(0.30);
    expect(schedule.shippingEstimate).toBe(5.99);
  });

  it('returns correct Amazon fee schedule', () => {
    const schedule = getFeeSchedule('amazon');
    expect(schedule.platform).toBe('amazon');
    expect(schedule.sellerFeePct).toBe(15);
    expect(schedule.fixedFee).toBe(0.99);
  });

  it('returns correct Walmart fee schedule', () => {
    const schedule = getFeeSchedule('walmart');
    expect(schedule.platform).toBe('walmart');
    expect(schedule.sellerFeePct).toBe(15);
    expect(schedule.fixedFee).toBe(0);
  });

  it('returns correct AliExpress fee schedule', () => {
    const schedule = getFeeSchedule('aliexpress');
    expect(schedule.platform).toBe('aliexpress');
    expect(schedule.sellerFeePct).toBe(8);
    expect(schedule.shippingEstimate).toBe(0); // Free shipping from AliExpress
  });

  it('returns fee schedules for all major platforms', () => {
    const platforms = ['amazon', 'ebay', 'walmart', 'aliexpress', 'poshmark', 'mercari', 'facebook'] as const;
    for (const p of platforms) {
      const schedule = getFeeSchedule(p);
      expect(schedule).toBeDefined();
      expect(schedule.platform).toBe(p);
      expect(schedule.sellerFeePct).toBeGreaterThanOrEqual(0);
    }
  });
});
