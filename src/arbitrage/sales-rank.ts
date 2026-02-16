/**
 * Sales Rank Estimator - Convert BSR to estimated monthly sales
 *
 * Uses empirically-derived curves per Amazon category. Based on public
 * research from Jungle Scout / Helium10 published datasets.
 */

// Category-specific BSR-to-monthly-sales curves
// Format: [maxBSR, estimatedMonthlySales]
// Derived from published seller research (approximate)
const CATEGORY_CURVES: Record<string, Array<[number, number]>> = {
  'toys_and_games': [
    [1, 30000], [5, 18000], [10, 12000], [50, 5000], [100, 3000],
    [500, 1200], [1000, 700], [5000, 200], [10000, 100], [50000, 30],
    [100000, 10], [500000, 2], [1000000, 1],
  ],
  'electronics': [
    [1, 25000], [5, 15000], [10, 10000], [50, 4500], [100, 2800],
    [500, 1000], [1000, 550], [5000, 150], [10000, 80], [50000, 20],
    [100000, 8], [500000, 1],
  ],
  'home_and_kitchen': [
    [1, 35000], [5, 20000], [10, 14000], [50, 6000], [100, 3500],
    [500, 1500], [1000, 800], [5000, 250], [10000, 120], [50000, 35],
    [100000, 12], [500000, 3], [1000000, 1],
  ],
  'clothing': [
    [1, 20000], [5, 12000], [10, 8000], [50, 3500], [100, 2000],
    [500, 800], [1000, 450], [5000, 120], [10000, 60], [50000, 15],
    [100000, 5], [500000, 1],
  ],
  'sports_and_outdoors': [
    [1, 28000], [5, 16000], [10, 11000], [50, 5000], [100, 3000],
    [500, 1100], [1000, 600], [5000, 180], [10000, 90], [50000, 25],
    [100000, 9], [500000, 2],
  ],
  'beauty': [
    [1, 30000], [5, 18000], [10, 12000], [50, 5500], [100, 3200],
    [500, 1300], [1000, 700], [5000, 210], [10000, 110], [50000, 30],
    [100000, 10], [500000, 2],
  ],
  'books': [
    [1, 40000], [5, 25000], [10, 18000], [50, 8000], [100, 5000],
    [500, 2000], [1000, 1100], [5000, 350], [10000, 180], [50000, 50],
    [100000, 18], [500000, 4], [1000000, 1],
  ],
  // Default curve used when category is unknown
  'default': [
    [1, 25000], [5, 15000], [10, 10000], [50, 4500], [100, 2700],
    [500, 1100], [1000, 600], [5000, 180], [10000, 90], [50000, 25],
    [100000, 9], [500000, 2], [1000000, 1],
  ],
};

// Normalize category string to curve key
function normalizeCategoryKey(category?: string): string {
  if (!category) return 'default';
  const lower = category.toLowerCase()
    .replace(/&/g, '_and_')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  // Try exact match
  if (CATEGORY_CURVES[lower]) return lower;

  // Try partial match
  for (const key of Object.keys(CATEGORY_CURVES)) {
    if (lower.includes(key) || key.includes(lower)) return key;
  }

  return 'default';
}

// Interpolate between curve points using log-linear interpolation
function interpolateSales(bsr: number, curve: Array<[number, number]>): number {
  if (bsr <= 0) return 0;

  // Below first point
  if (bsr <= curve[0][0]) return curve[0][1];

  // Above last point
  const last = curve[curve.length - 1];
  if (bsr >= last[0]) return Math.max(0, last[1]);

  // Find surrounding points and interpolate in log space
  for (let i = 0; i < curve.length - 1; i++) {
    const [bsr1, sales1] = curve[i];
    const [bsr2, sales2] = curve[i + 1];
    if (bsr >= bsr1 && bsr <= bsr2) {
      const logBsr = Math.log(bsr);
      const logBsr1 = Math.log(bsr1);
      const logBsr2 = Math.log(bsr2);
      const logSales1 = Math.log(sales1);
      const logSales2 = Math.log(sales2);
      const t = (logBsr - logBsr1) / (logBsr2 - logBsr1);
      return Math.round(Math.exp(logSales1 + t * (logSales2 - logSales1)));
    }
  }

  return 0;
}

export interface SalesEstimate {
  bsr: number;
  category: string;
  estimatedMonthlySales: number;
  estimatedDailySales: number;
  salesVelocity: 'very_high' | 'high' | 'medium' | 'low' | 'very_low';
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Estimate monthly sales from BSR and category.
 */
export function estimateSalesFromBSR(bsr: number, category?: string): SalesEstimate {
  const catKey = normalizeCategoryKey(category);
  const curve = CATEGORY_CURVES[catKey] ?? CATEGORY_CURVES['default'];
  const monthlySales = interpolateSales(bsr, curve);
  const dailySales = Math.round((monthlySales / 30) * 100) / 100;

  let salesVelocity: SalesEstimate['salesVelocity'];
  if (monthlySales >= 1000) salesVelocity = 'very_high';
  else if (monthlySales >= 300) salesVelocity = 'high';
  else if (monthlySales >= 100) salesVelocity = 'medium';
  else if (monthlySales >= 30) salesVelocity = 'low';
  else salesVelocity = 'very_low';

  const confidence: SalesEstimate['confidence'] = catKey === 'default' ? 'low' : bsr <= 100000 ? 'high' : 'medium';

  return {
    bsr,
    category: catKey,
    estimatedMonthlySales: monthlySales,
    estimatedDailySales: dailySales,
    salesVelocity,
    confidence,
  };
}

/**
 * Analyze BSR trend from historical data points.
 * Returns whether the product is accelerating, stable, or declining.
 */
export function analyzeBSRTrend(
  bsrHistory: Array<{ bsr: number; date: Date }>,
): { trend: 'accelerating' | 'stable' | 'declining'; avgBSR: number; currentBSR: number; changePercent: number } {
  if (bsrHistory.length < 2) {
    const current = bsrHistory[0]?.bsr ?? 0;
    return { trend: 'stable', avgBSR: current, currentBSR: current, changePercent: 0 };
  }

  const sorted = [...bsrHistory].sort((a, b) => a.date.getTime() - b.date.getTime());
  const current = sorted[sorted.length - 1].bsr;
  const oldest = sorted[0].bsr;
  const avgBSR = Math.round(sorted.reduce((s, p) => s + p.bsr, 0) / sorted.length);
  const changePercent = oldest > 0 ? Math.round(((current - oldest) / oldest) * 100) : 0;

  // Lower BSR = more sales, so negative change = accelerating
  let trend: 'accelerating' | 'stable' | 'declining';
  if (changePercent < -15) trend = 'accelerating';
  else if (changePercent > 15) trend = 'declining';
  else trend = 'stable';

  return { trend, avgBSR, currentBSR: current, changePercent };
}

/**
 * Get available category keys for BSR estimation.
 */
export function getAvailableCategories(): string[] {
  return Object.keys(CATEGORY_CURVES).filter(k => k !== 'default');
}
