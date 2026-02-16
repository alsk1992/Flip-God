import { describe, it, expect, vi } from 'vitest';
import { scanForArbitrage } from './scanner';
import type { Platform } from '../types';
import type { PlatformAdapter, ProductSearchResult } from '../platforms/index';

// =============================================================================
// Helpers
// =============================================================================

function createMockAdapter(
  platform: Platform,
  results: ProductSearchResult[],
): PlatformAdapter {
  return {
    platform,
    search: vi.fn().mockResolvedValue(results),
    getProduct: vi.fn().mockResolvedValue(null),
    checkStock: vi.fn().mockResolvedValue({ inStock: true }),
  };
}

function makeProduct(
  platform: Platform,
  price: number,
  shipping: number = 0,
  title: string = 'Test Product',
): ProductSearchResult {
  return {
    platformId: `${platform}-${price}`,
    platform,
    title,
    price,
    shipping,
    currency: 'USD',
    inStock: true,
    url: `https://${platform}.com/product`,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('scanForArbitrage', () => {
  it('finds opportunities when there is a price difference across platforms', async () => {
    const adapters = new Map<Platform, PlatformAdapter>();
    adapters.set(
      'amazon',
      createMockAdapter('amazon', [makeProduct('amazon', 10, 0)]),
    );
    adapters.set(
      'ebay',
      createMockAdapter('ebay', [makeProduct('ebay', 30, 0)]),
    );

    const results = await scanForArbitrage(adapters, {
      query: 'test',
      minMarginPct: 10,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].buyPlatform).toBe('amazon');
    expect(results[0].sellPlatform).toBe('ebay');
    expect(results[0].buyPrice).toBe(10);
    expect(results[0].sellPrice).toBe(30);
    expect(results[0].estimatedProfit).toBeGreaterThan(0);
    expect(results[0].marginPct).toBeGreaterThan(10);
  });

  it('returns empty when prices are equal', async () => {
    const adapters = new Map<Platform, PlatformAdapter>();
    adapters.set(
      'amazon',
      createMockAdapter('amazon', [makeProduct('amazon', 20, 0)]),
    );
    adapters.set(
      'ebay',
      createMockAdapter('ebay', [makeProduct('ebay', 20, 0)]),
    );

    const results = await scanForArbitrage(adapters, {
      query: 'test',
      minMarginPct: 10,
    });

    // Equal prices means fees eat into any margin, so no opportunities
    expect(results.length).toBe(0);
  });

  it('filters out opportunities below minimum margin', async () => {
    const adapters = new Map<Platform, PlatformAdapter>();
    // Small price diff -- after fees, margin will be low
    adapters.set(
      'amazon',
      createMockAdapter('amazon', [makeProduct('amazon', 18, 0)]),
    );
    adapters.set(
      'ebay',
      createMockAdapter('ebay', [makeProduct('ebay', 20, 0)]),
    );

    const results = await scanForArbitrage(adapters, {
      query: 'test',
      minMarginPct: 50, // Very high minimum
    });

    expect(results.length).toBe(0);
  });

  it('respects maxResults limit', async () => {
    const amazonProducts = Array.from({ length: 5 }, (_, i) =>
      makeProduct('amazon', 10 + i, 0, `Product ${i}`),
    );
    const ebayProducts = Array.from({ length: 5 }, (_, i) =>
      makeProduct('ebay', 40 + i, 0, `Product ${i}`),
    );

    const adapters = new Map<Platform, PlatformAdapter>();
    adapters.set('amazon', createMockAdapter('amazon', amazonProducts));
    adapters.set('ebay', createMockAdapter('ebay', ebayProducts));

    const results = await scanForArbitrage(adapters, {
      query: 'test',
      minMarginPct: 5,
      maxResults: 3,
    });

    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('does not compare products on the same platform', async () => {
    const adapters = new Map<Platform, PlatformAdapter>();
    adapters.set(
      'amazon',
      createMockAdapter('amazon', [
        makeProduct('amazon', 10, 0, 'Cheap'),
        makeProduct('amazon', 50, 0, 'Expensive'),
      ]),
    );

    const results = await scanForArbitrage(adapters, {
      query: 'test',
      minMarginPct: 5,
    });

    // Same platform products should not generate opportunities
    expect(results.length).toBe(0);
  });

  it('handles adapter search failures gracefully', async () => {
    const failingAdapter: PlatformAdapter = {
      platform: 'amazon',
      search: vi.fn().mockRejectedValue(new Error('API error')),
      getProduct: vi.fn().mockResolvedValue(null),
      checkStock: vi.fn().mockResolvedValue({ inStock: true }),
    };

    const adapters = new Map<Platform, PlatformAdapter>();
    adapters.set('amazon', failingAdapter);
    adapters.set(
      'ebay',
      createMockAdapter('ebay', [makeProduct('ebay', 30, 0)]),
    );

    // Should not throw
    const results = await scanForArbitrage(adapters, { query: 'test' });
    expect(Array.isArray(results)).toBe(true);
  });

  it('handles empty adapters map', async () => {
    const adapters = new Map<Platform, PlatformAdapter>();
    const results = await scanForArbitrage(adapters, { query: 'test' });
    expect(results).toEqual([]);
  });

  it('correctly identifies buy and sell sides (cheaper = buy)', async () => {
    const adapters = new Map<Platform, PlatformAdapter>();
    adapters.set(
      'ebay',
      createMockAdapter('ebay', [makeProduct('ebay', 50, 0)]),
    );
    adapters.set(
      'walmart',
      createMockAdapter('walmart', [makeProduct('walmart', 10, 0)]),
    );

    const results = await scanForArbitrage(adapters, {
      query: 'test',
      minMarginPct: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    // Walmart is cheaper, so it should be the buy side
    expect(results[0].buyPlatform).toBe('walmart');
    expect(results[0].sellPlatform).toBe('ebay');
  });

  it('includes shipping in total price comparison', async () => {
    const adapters = new Map<Platform, PlatformAdapter>();
    // Amazon: $15 price + $10 shipping = $25 total
    adapters.set(
      'amazon',
      createMockAdapter('amazon', [makeProduct('amazon', 15, 10)]),
    );
    // eBay: $20 price + $0 shipping = $20 total
    adapters.set(
      'ebay',
      createMockAdapter('ebay', [makeProduct('ebay', 20, 0)]),
    );

    const results = await scanForArbitrage(adapters, {
      query: 'test',
      minMarginPct: 0, // Allow any margin
    });

    // eBay ($20) is cheaper than Amazon total ($25), so eBay is buy side
    if (results.length > 0) {
      expect(results[0].buyPlatform).toBe('ebay');
      expect(results[0].sellPlatform).toBe('amazon');
    }
  });

  it('sorts results by score (descending)', async () => {
    const adapters = new Map<Platform, PlatformAdapter>();
    adapters.set(
      'amazon',
      createMockAdapter('amazon', [
        makeProduct('amazon', 5, 0, 'Big Gap'),
        makeProduct('amazon', 15, 0, 'Small Gap'),
      ]),
    );
    adapters.set(
      'ebay',
      createMockAdapter('ebay', [makeProduct('ebay', 50, 0, 'eBay Item')]),
    );

    const results = await scanForArbitrage(adapters, {
      query: 'test',
      minMarginPct: 5,
    });

    if (results.length > 1) {
      // Should be sorted by score descending
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    }
  });

  it('only scans specified platforms when provided', async () => {
    const amazonAdapter = createMockAdapter('amazon', [makeProduct('amazon', 10, 0)]);
    const ebayAdapter = createMockAdapter('ebay', [makeProduct('ebay', 30, 0)]);
    const walmartAdapter = createMockAdapter('walmart', [makeProduct('walmart', 20, 0)]);

    const adapters = new Map<Platform, PlatformAdapter>();
    adapters.set('amazon', amazonAdapter);
    adapters.set('ebay', ebayAdapter);
    adapters.set('walmart', walmartAdapter);

    await scanForArbitrage(adapters, {
      query: 'test',
      platforms: ['amazon', 'ebay'], // Only these two
    });

    expect(amazonAdapter.search).toHaveBeenCalled();
    expect(ebayAdapter.search).toHaveBeenCalled();
    expect(walmartAdapter.search).not.toHaveBeenCalled();
  });
});
