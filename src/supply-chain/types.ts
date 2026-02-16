/**
 * Supply Chain Module Types
 */

export interface Supplier {
  id: string;
  name: string;
  country: string;
  leadTimeDays: number;
  moq: number;
  pricePerUnit: number;
  reliabilityScore: number;
  onTimeDeliveryRate: number;
  defectRate: number;
  communicationScore: number;
  certifications: string[];
  lastOrderDate?: string;
  totalOrders: number;
  createdAt: string;
}

export interface SupplierScorecard {
  supplierId: string;
  supplierName: string;
  overallScore: number;
  onTimeDeliveryRate: number;
  defectRate: number;
  costTrend: 'decreasing' | 'stable' | 'increasing';
  costTrendPct: number;
  avgLeadTimeDays: number;
  leadTimeVarianceDays: number;
  totalOrders: number;
  totalUnits: number;
  issueCount: number;
  recommendation: 'preferred' | 'acceptable' | 'review' | 'replace';
}

export interface SupplyChainAnalysis {
  productId: string;
  productName: string;
  currentSupplier: Supplier | null;
  leadTimeDays: number;
  avgCostPerUnit: number;
  totalCost: number;
  reliabilityScore: number;
  bottlenecks: SupplyChainBottleneck[];
  recommendations: string[];
}

export interface SupplyChainBottleneck {
  type: 'lead_time' | 'cost' | 'reliability' | 'moq' | 'capacity';
  severity: 'low' | 'medium' | 'high';
  description: string;
}

export interface AlternativeSupplier {
  supplier: Supplier;
  comparisonToCurrentCostPct: number;
  comparisonToCurrentLeadTimeDays: number;
  moqDifference: number;
  overallFitScore: number;
  pros: string[];
  cons: string[];
}

export interface ReorderPointInput {
  productId: string;
  avgDailyDemand: number;
  demandStdDev: number;
  leadTimeDays: number;
  leadTimeStdDev: number;
  serviceLevel: number;
  currentStock: number;
  unitCost: number;
  holdingCostPct?: number;
  orderCost?: number;
}

export interface ReorderPointResult {
  reorderPoint: number;
  safetyStock: number;
  economicOrderQuantity: number;
  avgDailyDemand: number;
  leadTimeDays: number;
  serviceLevel: number;
  daysOfStockRemaining: number;
  needsReorder: boolean;
  estimatedAnnualHoldingCost: number;
  estimatedAnnualOrderCost: number;
  estimatedTotalAnnualCost: number;
}
