/**
 * Oversell Detection Types
 */

export type OversellSeverity = 'critical' | 'warning' | 'info';
export type ReductionStrategy = 'proportional' | 'lowest_margin_first' | 'newest_first';

export interface OversellRisk {
  productId: string;
  productTitle: string;
  severity: OversellSeverity;
  totalStock: number;
  totalListed: number;
  totalReserved: number;
  availableStock: number;
  overlistAmount: number;
  platforms: OversellPlatformDetail[];
  message: string;
}

export interface OversellPlatformDetail {
  platform: string;
  listedQty: number;
  listingIds: string[];
  marginPct: number | null;
  createdAt: number | null;
}

export interface OversellReport {
  generatedAt: number;
  totalProducts: number;
  atRiskCount: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  risks: OversellRisk[];
  summary: string;
}

export interface ReductionPlan {
  productId: string;
  strategy: ReductionStrategy;
  dryRun: boolean;
  currentOverlist: number;
  reductions: ReductionAction[];
  totalReduced: number;
  remainingOverlist: number;
}

export interface ReductionAction {
  listingId: string;
  platform: string;
  currentQty: number;
  newQty: number;
  reducedBy: number;
  reason: string;
  applied: boolean;
}

export interface OversellMonitorConfig {
  checkIntervalMs: number;
  autoReduceThreshold: OversellSeverity;
  notifyOnDetection: boolean;
  reductionStrategy: ReductionStrategy;
}
