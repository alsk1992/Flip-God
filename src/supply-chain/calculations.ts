/**
 * Supply Chain Calculations
 *
 * Real mathematical formulas for reorder points, EOQ, safety stock,
 * and supplier scoring.
 */

import type {
  ReorderPointInput,
  ReorderPointResult,
  Supplier,
  SupplierScorecard,
  SupplyChainAnalysis,
  SupplyChainBottleneck,
  AlternativeSupplier,
} from './types.js';

// ---------------------------------------------------------------------------
// Z-scores for common service levels
// ---------------------------------------------------------------------------

const Z_SCORES: Record<number, number> = {
  0.80: 0.842,
  0.85: 1.036,
  0.90: 1.282,
  0.91: 1.341,
  0.92: 1.405,
  0.93: 1.476,
  0.94: 1.555,
  0.95: 1.645,
  0.96: 1.751,
  0.97: 1.881,
  0.98: 2.054,
  0.99: 2.326,
  0.995: 2.576,
  0.999: 3.090,
};

/**
 * Get Z-score for a given service level. Interpolates between known values.
 */
function getZScore(serviceLevel: number): number {
  if (serviceLevel <= 0 || serviceLevel >= 1) {
    throw new Error('Service level must be between 0 and 1 exclusive');
  }

  const rounded = Math.round(serviceLevel * 1000) / 1000;
  if (Z_SCORES[rounded] != null) {
    return Z_SCORES[rounded];
  }

  // Linear interpolation between closest known values
  const keys = Object.keys(Z_SCORES).map(Number).sort((a, b) => a - b);
  let lower = keys[0];
  let upper = keys[keys.length - 1];

  for (const k of keys) {
    if (k <= rounded) lower = k;
    if (k >= rounded) {
      upper = k;
      break;
    }
  }

  if (lower === upper) return Z_SCORES[lower];

  const ratio = (rounded - lower) / (upper - lower);
  return Z_SCORES[lower] + ratio * (Z_SCORES[upper] - Z_SCORES[lower]);
}

// ---------------------------------------------------------------------------
// Reorder Point Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate reorder point, safety stock, and EOQ.
 *
 * Safety Stock = Z * sqrt(LT * sigma_d^2 + d^2 * sigma_LT^2)
 * Reorder Point = (avg daily demand * lead time) + safety stock
 * EOQ = sqrt(2 * D * S / H)  (Wilson formula)
 */
export function calculateReorderPoint(input: ReorderPointInput): ReorderPointResult {
  const {
    avgDailyDemand,
    demandStdDev,
    leadTimeDays,
    leadTimeStdDev,
    serviceLevel,
    currentStock,
    unitCost,
    holdingCostPct = 0.25,
    orderCost = 50,
  } = input;

  const z = getZScore(serviceLevel);

  // Safety stock (accounts for variability in both demand and lead time)
  const demandVariance = leadTimeDays * (demandStdDev ** 2);
  const leadTimeVariance = (avgDailyDemand ** 2) * (leadTimeStdDev ** 2);
  const safetyStock = Math.ceil(z * Math.sqrt(demandVariance + leadTimeVariance));

  // Reorder point
  const reorderPoint = Math.ceil(avgDailyDemand * leadTimeDays + safetyStock);

  // Economic Order Quantity (EOQ) - Wilson formula
  const annualDemand = avgDailyDemand * 365;
  const holdingCostPerUnit = unitCost * holdingCostPct;
  const eoq = holdingCostPerUnit > 0
    ? Math.ceil(Math.sqrt((2 * annualDemand * orderCost) / holdingCostPerUnit))
    : Math.ceil(avgDailyDemand * 30);

  const daysOfStockRemaining = avgDailyDemand > 0
    ? Math.floor(currentStock / avgDailyDemand)
    : Infinity;

  const estimatedAnnualHoldingCost = (eoq / 2 + safetyStock) * holdingCostPerUnit;
  const estimatedAnnualOrderCost = annualDemand > 0
    ? (annualDemand / eoq) * orderCost
    : 0;

  return {
    reorderPoint,
    safetyStock,
    economicOrderQuantity: eoq,
    avgDailyDemand,
    leadTimeDays,
    serviceLevel,
    daysOfStockRemaining,
    needsReorder: currentStock <= reorderPoint,
    estimatedAnnualHoldingCost: Math.round(estimatedAnnualHoldingCost * 100) / 100,
    estimatedAnnualOrderCost: Math.round(estimatedAnnualOrderCost * 100) / 100,
    estimatedTotalAnnualCost: Math.round((estimatedAnnualHoldingCost + estimatedAnnualOrderCost) * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Supplier Scorecard
// ---------------------------------------------------------------------------

export function generateSupplierScorecard(
  supplier: Supplier,
  orderHistory: Array<{
    orderedAt: string;
    deliveredAt?: string;
    expectedDeliveryAt: string;
    unitCount: number;
    pricePerUnit: number;
    defectCount: number;
    issues?: string[];
  }>,
): SupplierScorecard {
  const totalOrders = orderHistory.length;
  const totalUnits = orderHistory.reduce((sum, o) => sum + o.unitCount, 0);

  let onTimeCount = 0;
  const leadTimes: number[] = [];
  for (const order of orderHistory) {
    if (order.deliveredAt) {
      const delivered = new Date(order.deliveredAt).getTime();
      const expected = new Date(order.expectedDeliveryAt).getTime();
      const ordered = new Date(order.orderedAt).getTime();
      if (delivered <= expected) onTimeCount++;
      const ltDays = (delivered - ordered) / (1000 * 60 * 60 * 24);
      leadTimes.push(ltDays);
    }
  }
  const deliveredOrders = orderHistory.filter(o => o.deliveredAt).length;
  const onTimeDeliveryRate = deliveredOrders > 0 ? onTimeCount / deliveredOrders : 0;

  const avgLeadTimeDays = leadTimes.length > 0
    ? leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length
    : supplier.leadTimeDays;
  const leadTimeVarianceDays = leadTimes.length > 1
    ? Math.sqrt(leadTimes.reduce((sum, lt) => sum + (lt - avgLeadTimeDays) ** 2, 0) / (leadTimes.length - 1))
    : 0;

  const totalDefects = orderHistory.reduce((sum, o) => sum + o.defectCount, 0);
  const defectRate = totalUnits > 0 ? totalDefects / totalUnits : 0;

  // Cost trend
  const sorted = [...orderHistory].sort(
    (a, b) => new Date(a.orderedAt).getTime() - new Date(b.orderedAt).getTime(),
  );
  const midpoint = Math.floor(sorted.length / 2);
  const firstHalf = sorted.slice(0, Math.max(midpoint, 1));
  const secondHalf = sorted.slice(Math.max(midpoint, 1));
  const avgCostFirst = firstHalf.reduce((s, o) => s + o.pricePerUnit, 0) / firstHalf.length;
  const avgCostSecond = secondHalf.length > 0
    ? secondHalf.reduce((s, o) => s + o.pricePerUnit, 0) / secondHalf.length
    : avgCostFirst;
  const costTrendPct = avgCostFirst > 0
    ? ((avgCostSecond - avgCostFirst) / avgCostFirst) * 100
    : 0;
  const costTrend: 'decreasing' | 'stable' | 'increasing' =
    costTrendPct < -2 ? 'decreasing' : costTrendPct > 2 ? 'increasing' : 'stable';

  const issueCount = orderHistory.reduce((sum, o) => sum + (o.issues?.length ?? 0), 0);

  // Weighted overall score
  const deliveryScore = onTimeDeliveryRate * 100;
  const qualityScore = (1 - defectRate) * 100;
  const costScore = costTrend === 'decreasing' ? 90 : costTrend === 'stable' ? 70 : 40;
  const consistencyScore = leadTimeVarianceDays <= 1 ? 95
    : leadTimeVarianceDays <= 3 ? 75
    : leadTimeVarianceDays <= 7 ? 50 : 25;

  const overallScore = Math.round(
    deliveryScore * 0.35 + qualityScore * 0.30 + costScore * 0.15 + consistencyScore * 0.20,
  );

  const recommendation: 'preferred' | 'acceptable' | 'review' | 'replace' =
    overallScore >= 85 ? 'preferred'
    : overallScore >= 70 ? 'acceptable'
    : overallScore >= 50 ? 'review' : 'replace';

  return {
    supplierId: supplier.id,
    supplierName: supplier.name,
    overallScore,
    onTimeDeliveryRate: Math.round(onTimeDeliveryRate * 10000) / 10000,
    defectRate: Math.round(defectRate * 10000) / 10000,
    costTrend,
    costTrendPct: Math.round(costTrendPct * 100) / 100,
    avgLeadTimeDays: Math.round(avgLeadTimeDays * 10) / 10,
    leadTimeVarianceDays: Math.round(leadTimeVarianceDays * 10) / 10,
    totalOrders,
    totalUnits,
    issueCount,
    recommendation,
  };
}

// ---------------------------------------------------------------------------
// Supply Chain Analysis
// ---------------------------------------------------------------------------

export function analyzeSupplyChain(
  productId: string,
  productName: string,
  supplier: Supplier | null,
  avgMonthlyCost: number,
  avgMonthlyUnits: number,
): SupplyChainAnalysis {
  const bottlenecks: SupplyChainBottleneck[] = [];
  const recommendations: string[] = [];

  if (supplier) {
    if (supplier.leadTimeDays > 30) {
      bottlenecks.push({
        type: 'lead_time',
        severity: 'high',
        description: `Lead time of ${supplier.leadTimeDays} days is very long. Consider domestic alternatives.`,
      });
      recommendations.push('Source from a domestic supplier to reduce lead time below 14 days.');
    } else if (supplier.leadTimeDays > 14) {
      bottlenecks.push({
        type: 'lead_time',
        severity: 'medium',
        description: `Lead time of ${supplier.leadTimeDays} days could be improved.`,
      });
      recommendations.push('Negotiate expedited shipping or find closer fulfillment centers.');
    }

    if (supplier.reliabilityScore < 60) {
      bottlenecks.push({
        type: 'reliability',
        severity: 'high',
        description: `Supplier reliability score (${supplier.reliabilityScore}/100) is below acceptable threshold.`,
      });
      recommendations.push('Immediately begin sourcing alternative suppliers. Current supplier is high-risk.');
    } else if (supplier.reliabilityScore < 80) {
      bottlenecks.push({
        type: 'reliability',
        severity: 'medium',
        description: `Supplier reliability score (${supplier.reliabilityScore}/100) has room for improvement.`,
      });
      recommendations.push('Schedule quarterly business reviews with supplier to address reliability concerns.');
    }

    if (avgMonthlyUnits > 0 && supplier.moq > avgMonthlyUnits * 3) {
      bottlenecks.push({
        type: 'moq',
        severity: 'medium',
        description: `MOQ of ${supplier.moq} units represents ${Math.round(supplier.moq / avgMonthlyUnits)} months of inventory.`,
      });
      recommendations.push('Negotiate lower MOQ or find supplier with smaller minimum orders.');
    }

    if (supplier.pricePerUnit > 0 && avgMonthlyCost > 0 && avgMonthlyUnits > 0) {
      const costPerUnit = avgMonthlyCost / avgMonthlyUnits;
      if (costPerUnit > supplier.pricePerUnit * 1.3) {
        bottlenecks.push({
          type: 'cost',
          severity: 'medium',
          description: 'Total landed cost is 30%+ above supplier base price. Shipping/duties may be too high.',
        });
        recommendations.push('Review shipping method and customs classification to reduce landed cost.');
      }
    }
  } else {
    bottlenecks.push({
      type: 'reliability',
      severity: 'high',
      description: 'No primary supplier assigned to this product.',
    });
    recommendations.push('Identify and vet at least 2 potential suppliers for this product.');
  }

  if (recommendations.length === 0) {
    recommendations.push('Supply chain is operating within acceptable parameters. Continue monitoring.');
  }

  return {
    productId,
    productName,
    currentSupplier: supplier,
    leadTimeDays: supplier?.leadTimeDays ?? 0,
    avgCostPerUnit: avgMonthlyUnits > 0 ? Math.round((avgMonthlyCost / avgMonthlyUnits) * 100) / 100 : 0,
    totalCost: Math.round(avgMonthlyCost * 100) / 100,
    reliabilityScore: supplier?.reliabilityScore ?? 0,
    bottlenecks,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// Alternative Supplier Comparison
// ---------------------------------------------------------------------------

export function compareAlternativeSuppliers(
  currentSupplier: Supplier | null,
  alternatives: Supplier[],
  maxResults: number = 5,
): AlternativeSupplier[] {
  const currentPrice = currentSupplier?.pricePerUnit ?? 0;
  const currentLeadTime = currentSupplier?.leadTimeDays ?? 0;
  const currentMoq = currentSupplier?.moq ?? 0;

  const scored = alternatives.map((supplier) => {
    const costDiffPct = currentPrice > 0
      ? ((supplier.pricePerUnit - currentPrice) / currentPrice) * 100 : 0;
    const leadTimeDiff = supplier.leadTimeDays - currentLeadTime;
    const moqDiff = supplier.moq - currentMoq;

    const pros: string[] = [];
    const cons: string[] = [];

    if (costDiffPct < -5) pros.push(`${Math.abs(Math.round(costDiffPct))}% cheaper per unit`);
    else if (costDiffPct > 5) cons.push(`${Math.round(costDiffPct)}% more expensive per unit`);

    if (leadTimeDiff < -3) pros.push(`${Math.abs(leadTimeDiff)} days faster delivery`);
    else if (leadTimeDiff > 3) cons.push(`${leadTimeDiff} days slower delivery`);

    if (supplier.reliabilityScore >= 90) pros.push('Excellent reliability score');
    else if (supplier.reliabilityScore < 60) cons.push('Low reliability score');

    if (moqDiff < 0) pros.push(`Lower MOQ (${supplier.moq} vs ${currentMoq})`);
    else if (moqDiff > 0) cons.push(`Higher MOQ (${supplier.moq} vs ${currentMoq})`);

    if (supplier.certifications.length > 0) pros.push(`Certified: ${supplier.certifications.join(', ')}`);
    if (supplier.defectRate < 0.01) pros.push('Very low defect rate (<1%)');
    else if (supplier.defectRate > 0.05) cons.push(`High defect rate (${Math.round(supplier.defectRate * 100)}%)`);
    if (supplier.onTimeDeliveryRate >= 0.95) pros.push('95%+ on-time delivery');
    else if (supplier.onTimeDeliveryRate < 0.80) cons.push('Low on-time delivery rate');

    let fitScore = 50;
    fitScore += Math.max(-20, Math.min(20, -costDiffPct * 2));
    fitScore += Math.max(-15, Math.min(15, -leadTimeDiff * 3));
    fitScore += (supplier.reliabilityScore - 70) * 0.3;
    fitScore += (supplier.onTimeDeliveryRate - 0.85) * 50;
    fitScore -= supplier.defectRate * 200;
    fitScore = Math.max(0, Math.min(100, Math.round(fitScore)));

    return {
      supplier,
      comparisonToCurrentCostPct: Math.round(costDiffPct * 100) / 100,
      comparisonToCurrentLeadTimeDays: leadTimeDiff,
      moqDifference: moqDiff,
      overallFitScore: fitScore,
      pros,
      cons,
    } as AlternativeSupplier;
  });

  scored.sort((a, b) => b.overallFitScore - a.overallFitScore);
  return scored.slice(0, maxResults);
}
