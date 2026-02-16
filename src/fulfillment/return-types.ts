/**
 * Return/Refund Types
 *
 * Type definitions for the returns and refund automation system.
 */

// ---------------------------------------------------------------------------
// Enums / Unions
// ---------------------------------------------------------------------------

export type ReturnStatus =
  | 'pending'
  | 'received'
  | 'inspected'
  | 'restocked'
  | 'disposed'
  | 'refunded';

export type ReturnCondition =
  | 'like_new'
  | 'good'
  | 'damaged'
  | 'defective';

export type ReturnReason =
  | 'not_as_described'
  | 'damaged_in_shipping'
  | 'wrong_item'
  | 'changed_mind'
  | 'defective'
  | 'other';

// ---------------------------------------------------------------------------
// Core Types
// ---------------------------------------------------------------------------

export interface ReturnRequest {
  id: string;
  orderId: string;
  userId: string;
  platform: string;
  reason: string;
  category: ReturnReason;
  condition?: ReturnCondition;
  status: ReturnStatus;
  refundAmount?: number;
  restocked: boolean;
  notes?: string;
  createdAt: Date;
  resolvedAt?: Date;
}

export interface CreateReturnParams {
  orderId: string;
  userId?: string;
  platform?: string;
  reason: string;
  notes?: string;
}

export interface InspectReturnParams {
  returnId: string;
  condition: ReturnCondition;
  restock?: boolean;
  notes?: string;
}

export interface ProcessRefundParams {
  returnId: string;
  amount?: number;
  reason?: string;
}

export interface ReturnMetricsOptions {
  days?: number;
  platform?: string;
  category?: string;
}

export interface ReturnMetrics {
  totalReturns: number;
  returnRate: number;
  avgRefundAmount: number;
  totalRefunded: number;
  byCategory: Array<{
    category: ReturnReason;
    count: number;
    pct: number;
  }>;
  byCondition: Array<{
    condition: ReturnCondition;
    count: number;
    pct: number;
  }>;
  byStatus: Array<{
    status: ReturnStatus;
    count: number;
  }>;
  restockRate: number;
}
