/**
 * Advanced Returns Management Module
 *
 * Extends the base returns system with fraud detection, automated decisions,
 * restocking fee calculation, return label generation, and detailed analytics.
 */

import type { Database } from '../db/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReturnLabel {
  labelId: string;
  trackingNumber: string;
  carrier: string;
  returnAddress: string;
  labelUrl: string;
  expiresAt: string;
  costCents: number;
}

export interface FraudSignal {
  type: 'serial_returner' | 'weight_mismatch' | 'late_claim' | 'high_value_pattern' | 'address_mismatch' | 'velocity';
  severity: 'low' | 'medium' | 'high';
  description: string;
  score: number; // 0-100 contribution to fraud score
}

export interface FraudAssessment {
  orderId: string;
  customerId: string;
  overallRiskScore: number; // 0-100
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  signals: FraudSignal[];
  recommendation: 'approve' | 'review' | 'deny';
  customerHistory: {
    totalOrders: number;
    totalReturns: number;
    returnRate: number;
    avgOrderValue: number;
    accountAgeDays: number;
  };
}

export interface RestockingFeeResult {
  feePercent: number;
  feeAmount: number;
  refundAmount: number;
  originalAmount: number;
  reason: string;
  condition: string;
  waived: boolean;
  waiverReason?: string;
}

export interface ReturnDecision {
  orderId: string;
  decision: 'approved' | 'denied' | 'manual_review';
  reason: string;
  restockingFee: number;
  refundAmount: number;
  returnLabelGenerated: boolean;
  policyRulesApplied: string[];
}

export interface ReturnAnalytics {
  period: string;
  totalReturns: number;
  returnRate: number;
  totalRefunded: number;
  avgRefundAmount: number;
  byProduct: Array<{ productId: string; productName: string; returnCount: number; returnRate: number }>;
  byCategory: Array<{ category: string; returnCount: number; returnRate: number }>;
  byReason: Array<{ reason: string; count: number; pct: number }>;
  fraudDetected: number;
  avgProcessingTimeDays: number;
}

// ---------------------------------------------------------------------------
// Fraud Detection Heuristics
// ---------------------------------------------------------------------------

function detectFraudSignals(
  db: Database,
  orderId: string,
  customerId: string,
  orderValue: number,
  returnReason: string,
  daysSincePurchase: number,
  itemWeightOz?: number,
  returnedWeightOz?: number,
): FraudSignal[] {
  const signals: FraudSignal[] = [];

  // 1. Serial returner check
  const returnHistory = db.query<Record<string, unknown>>(
    `SELECT COUNT(*) as cnt FROM returns WHERE customer_id = ? AND created_at > datetime('now', '-90 days')`,
    [customerId],
  );
  const recentReturns = Number(returnHistory[0]?.cnt ?? 0);
  const orderHistory = db.query<Record<string, unknown>>(
    `SELECT COUNT(*) as cnt FROM orders WHERE customer_id = ?`,
    [customerId],
  );
  const totalOrders = Math.max(Number(orderHistory[0]?.cnt ?? 1), 1);
  const returnRate = recentReturns / totalOrders;

  if (returnRate > 0.5 && recentReturns >= 3) {
    signals.push({
      type: 'serial_returner',
      severity: 'high',
      description: `Customer has returned ${recentReturns} of ${totalOrders} orders (${(returnRate * 100).toFixed(0)}%) in last 90 days`,
      score: 40,
    });
  } else if (returnRate > 0.3 && recentReturns >= 2) {
    signals.push({
      type: 'serial_returner',
      severity: 'medium',
      description: `Customer return rate is ${(returnRate * 100).toFixed(0)}% (${recentReturns} returns in 90 days)`,
      score: 20,
    });
  }

  // 2. Weight mismatch
  if (itemWeightOz != null && returnedWeightOz != null && itemWeightOz > 0) {
    const weightDiffPct = Math.abs(returnedWeightOz - itemWeightOz) / itemWeightOz;
    if (weightDiffPct > 0.3) {
      signals.push({
        type: 'weight_mismatch',
        severity: 'high',
        description: `Returned package weight (${returnedWeightOz}oz) differs from expected (${itemWeightOz}oz) by ${(weightDiffPct * 100).toFixed(0)}%`,
        score: 35,
      });
    } else if (weightDiffPct > 0.15) {
      signals.push({
        type: 'weight_mismatch',
        severity: 'medium',
        description: `Returned weight differs by ${(weightDiffPct * 100).toFixed(0)}%`,
        score: 15,
      });
    }
  }

  // 3. Late claim
  if (daysSincePurchase > 60) {
    signals.push({
      type: 'late_claim',
      severity: 'high',
      description: `Return requested ${daysSincePurchase} days after purchase (>60 day window)`,
      score: 30,
    });
  } else if (daysSincePurchase > 30) {
    signals.push({
      type: 'late_claim',
      severity: 'medium',
      description: `Return requested ${daysSincePurchase} days after purchase`,
      score: 10,
    });
  }

  // 4. High value pattern (frequent high-value returns)
  if (orderValue > 100) {
    const highValueReturns = db.query<Record<string, unknown>>(
      `SELECT COUNT(*) as cnt FROM returns r JOIN orders o ON r.order_id = o.id WHERE r.customer_id = ? AND o.total_cents > 10000 AND r.created_at > datetime('now', '-180 days')`,
      [customerId],
    );
    const hvCount = Number(highValueReturns[0]?.cnt ?? 0);
    if (hvCount >= 3) {
      signals.push({
        type: 'high_value_pattern',
        severity: 'high',
        description: `${hvCount} high-value returns (>$100) in last 180 days`,
        score: 25,
      });
    }
  }

  // 5. Velocity check (multiple returns in short window)
  const recentWindow = db.query<Record<string, unknown>>(
    `SELECT COUNT(*) as cnt FROM returns WHERE customer_id = ? AND created_at > datetime('now', '-7 days')`,
    [customerId],
  );
  const weeklyReturns = Number(recentWindow[0]?.cnt ?? 0);
  if (weeklyReturns >= 3) {
    signals.push({
      type: 'velocity',
      severity: 'high',
      description: `${weeklyReturns} returns initiated in the last 7 days`,
      score: 30,
    });
  }

  return signals;
}

// ---------------------------------------------------------------------------
// Restocking Fee Rules
// ---------------------------------------------------------------------------

const RESTOCKING_FEE_RULES: Record<string, { feePercent: number; description: string }> = {
  like_new: { feePercent: 0, description: 'Item in original condition, no restocking fee' },
  opened: { feePercent: 15, description: 'Item opened but undamaged' },
  used: { feePercent: 25, description: 'Item shows signs of use' },
  damaged: { feePercent: 50, description: 'Item is damaged' },
  missing_parts: { feePercent: 30, description: 'Item missing accessories or parts' },
  defective: { feePercent: 0, description: 'Manufacturer defect, no restocking fee' },
};

const WAIVER_REASONS: Record<string, boolean> = {
  wrong_item_sent: true,
  defective: true,
  damaged_in_shipping: true,
  seller_error: true,
};

function calculateRestockingFee(
  originalAmountCents: number,
  condition: string,
  returnReason: string,
): RestockingFeeResult {
  const rule = RESTOCKING_FEE_RULES[condition] ?? RESTOCKING_FEE_RULES['used'];
  const waived = WAIVER_REASONS[returnReason] === true;

  const feePercent = waived ? 0 : rule.feePercent;
  const feeAmount = Math.round(originalAmountCents * feePercent / 100);
  const refundAmount = originalAmountCents - feeAmount;

  return {
    feePercent,
    feeAmount: feeAmount / 100,
    refundAmount: refundAmount / 100,
    originalAmount: originalAmountCents / 100,
    reason: rule.description,
    condition,
    waived,
    waiverReason: waived ? `Fee waived: ${returnReason.replace(/_/g, ' ')}` : undefined,
  };
}

// ---------------------------------------------------------------------------
// DB Helpers
// ---------------------------------------------------------------------------



function ensureAdvancedReturnsTables(db: Database): void {
  // The base returns table should already exist from migration-013-returns
  // We add supplementary tables for advanced features
  db.run(`
    CREATE TABLE IF NOT EXISTS return_labels (
      id TEXT PRIMARY KEY,
      return_id TEXT NOT NULL,
      tracking_number TEXT NOT NULL,
      carrier TEXT NOT NULL DEFAULT 'USPS',
      return_address TEXT NOT NULL DEFAULT '',
      label_url TEXT NOT NULL DEFAULT '',
      cost_cents INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS return_fraud_assessments (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      risk_score INTEGER NOT NULL DEFAULT 0,
      risk_level TEXT NOT NULL DEFAULT 'low',
      signals TEXT NOT NULL DEFAULT '[]',
      recommendation TEXT NOT NULL DEFAULT 'approve',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS return_decisions (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      restocking_fee_cents INTEGER NOT NULL DEFAULT 0,
      refund_amount_cents INTEGER NOT NULL DEFAULT 0,
      rules_applied TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS shipping_rules (
      id TEXT PRIMARY KEY,
      rule_type TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      rule_config TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const advancedReturnTools = [
  {
    name: 'generate_return_label',
    description: 'Generate a prepaid return shipping label for a return request',
    input_schema: {
      type: 'object' as const,
      properties: {
        return_id: { type: 'string' as const, description: 'Return request ID' },
        carrier: { type: 'string' as const, enum: ['USPS', 'UPS', 'FedEx'] as const, description: 'Shipping carrier (default: USPS)' },
        return_address: { type: 'string' as const, description: 'Return-to address (uses default warehouse if omitted)' },
      },
      required: ['return_id'] as const,
    },
  },
  {
    name: 'detect_return_fraud',
    description: 'Detect potential return fraud patterns including serial returners, weight mismatches, late claims, and velocity anomalies',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: { type: 'string' as const, description: 'Order ID to assess' },
        customer_id: { type: 'string' as const, description: 'Customer ID' },
        order_value: { type: 'number' as const, description: 'Original order value in dollars' },
        return_reason: { type: 'string' as const, description: 'Stated return reason' },
        days_since_purchase: { type: 'number' as const, description: 'Days since purchase' },
        item_weight_oz: { type: 'number' as const, description: 'Expected item weight in ounces' },
        returned_weight_oz: { type: 'number' as const, description: 'Actual returned package weight in ounces' },
      },
      required: ['order_id', 'customer_id', 'order_value', 'return_reason', 'days_since_purchase'] as const,
    },
  },
  {
    name: 'calculate_restocking_fee',
    description: 'Calculate restocking fee based on item condition and return reason. Fees are waived for seller errors and defects.',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: { type: 'string' as const, description: 'Order ID' },
        original_amount: { type: 'number' as const, description: 'Original order amount in dollars' },
        condition: {
          type: 'string' as const,
          enum: ['like_new', 'opened', 'used', 'damaged', 'missing_parts', 'defective'] as const,
          description: 'Condition of the returned item',
        },
        return_reason: {
          type: 'string' as const,
          enum: ['changed_mind', 'wrong_item_sent', 'defective', 'damaged_in_shipping', 'not_as_described', 'seller_error', 'other'] as const,
          description: 'Reason for return',
        },
      },
      required: ['order_id', 'original_amount', 'condition', 'return_reason'] as const,
    },
  },
  {
    name: 'automate_return_decision',
    description: 'Auto-approve or deny a return based on policy rules including return window, fraud risk, and order value',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: { type: 'string' as const, description: 'Order ID' },
        customer_id: { type: 'string' as const, description: 'Customer ID' },
        order_value: { type: 'number' as const, description: 'Order value in dollars' },
        return_reason: { type: 'string' as const, description: 'Return reason' },
        days_since_purchase: { type: 'number' as const, description: 'Days since purchase' },
        item_condition: {
          type: 'string' as const,
          enum: ['like_new', 'opened', 'used', 'damaged', 'missing_parts', 'defective'] as const,
          description: 'Item condition',
        },
      },
      required: ['order_id', 'customer_id', 'order_value', 'return_reason', 'days_since_purchase', 'item_condition'] as const,
    },
  },
  {
    name: 'return_analytics',
    description: 'Get return rate analytics broken down by product, category, and reason over a time period',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: { type: 'number' as const, description: 'Look-back period in days (default: 30)' },
        platform: { type: 'string' as const, description: 'Filter by platform' },
        category: { type: 'string' as const, description: 'Filter by product category' },
      },
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function handleAdvancedReturnTool(
  db: Database,
  toolName: string,
  input: Record<string, unknown>,
): { success: boolean; data?: unknown; error?: string } {
  ensureAdvancedReturnsTables(db);

  switch (toolName) {
    case 'generate_return_label': {
      const returnId = String(input.return_id ?? '');
      if (!returnId) return { success: false, error: 'return_id is required' };

      const carrier = String(input.carrier ?? 'USPS');
      const returnAddress = String(input.return_address ?? '123 Warehouse Blvd, Fulfillment City, ST 00000');
      const labelId = generateId();
      const trackingNumber = `${carrier.toUpperCase()}${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      // Estimate label cost based on carrier
      const costCents = carrier === 'USPS' ? 495 : carrier === 'UPS' ? 895 : 995;

      // TODO: Integrate with actual carrier API (EasyPost, Shippo, etc.)
      const labelUrl = `https://labels.example.com/${labelId}.pdf`;

      db.run(
        `INSERT INTO return_labels (id, return_id, tracking_number, carrier, return_address, label_url, cost_cents, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [labelId, returnId, trackingNumber, carrier, returnAddress, labelUrl, costCents, expiresAt],
      );

      return {
        success: true,
        data: {
          labelId,
          returnId,
          trackingNumber,
          carrier,
          returnAddress,
          labelUrl,
          expiresAt,
          costDollars: (costCents / 100).toFixed(2),
        },
      };
    }

    case 'detect_return_fraud': {
      const orderId = String(input.order_id ?? '');
      const customerId = String(input.customer_id ?? '');
      const orderValue = Number(input.order_value ?? 0);
      const returnReason = String(input.return_reason ?? '');
      const daysSincePurchase = Number(input.days_since_purchase ?? 0);
      const itemWeightOz = input.item_weight_oz != null ? Number(input.item_weight_oz) : undefined;
      const returnedWeightOz = input.returned_weight_oz != null ? Number(input.returned_weight_oz) : undefined;

      if (!orderId || !customerId) return { success: false, error: 'order_id and customer_id are required' };

      const signals = detectFraudSignals(
        db, orderId, customerId, orderValue, returnReason,
        daysSincePurchase, itemWeightOz, returnedWeightOz,
      );

      const overallRiskScore = Math.min(100, signals.reduce((sum, s) => sum + s.score, 0));
      const riskLevel: 'low' | 'medium' | 'high' | 'critical' =
        overallRiskScore >= 70 ? 'critical'
        : overallRiskScore >= 50 ? 'high'
        : overallRiskScore >= 25 ? 'medium' : 'low';
      const recommendation: 'approve' | 'review' | 'deny' =
        riskLevel === 'critical' ? 'deny'
        : riskLevel === 'high' ? 'review' : 'approve';

      // Fetch customer history for context
      const orderCount = db.query<Record<string, unknown>>(`SELECT COUNT(*) as cnt FROM orders WHERE customer_id = ?`, [customerId]);
      const returnCount = db.query<Record<string, unknown>>(`SELECT COUNT(*) as cnt FROM returns WHERE customer_id = ?`, [customerId]);
      const totalOrders = Number(orderCount[0]?.cnt ?? 0);
      const totalReturns = Number(returnCount[0]?.cnt ?? 0);

      // Store assessment
      const assessmentId = generateId();
      db.run(
        `INSERT INTO return_fraud_assessments (id, order_id, customer_id, risk_score, risk_level, signals, recommendation)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [assessmentId, orderId, customerId, overallRiskScore, riskLevel, JSON.stringify(signals), recommendation],
      );

      return {
        success: true,
        data: {
          assessmentId,
          orderId,
          customerId,
          overallRiskScore,
          riskLevel,
          recommendation,
          signals,
          customerHistory: {
            totalOrders,
            totalReturns,
            returnRate: totalOrders > 0 ? Math.round((totalReturns / totalOrders) * 10000) / 100 : 0,
            accountAgeDays: daysSincePurchase, // approximation
          },
        },
      };
    }

    case 'calculate_restocking_fee': {
      const orderId = String(input.order_id ?? '');
      const originalAmount = Number(input.original_amount ?? 0);
      const condition = String(input.condition ?? 'used');
      const returnReason = String(input.return_reason ?? 'other');

      if (!orderId) return { success: false, error: 'order_id is required' };
      if (!Number.isFinite(originalAmount) || originalAmount <= 0) return { success: false, error: 'original_amount must be a positive number' };

      const result = calculateRestockingFee(
        Math.round(originalAmount * 100), condition, returnReason,
      );

      return { success: true, data: { orderId, ...result } };
    }

    case 'automate_return_decision': {
      const orderId = String(input.order_id ?? '');
      const customerId = String(input.customer_id ?? '');
      const orderValue = Number(input.order_value ?? 0);
      const returnReason = String(input.return_reason ?? '');
      const daysSincePurchase = Number(input.days_since_purchase ?? 0);
      const itemCondition = String(input.item_condition ?? 'used');

      if (!orderId || !customerId) return { success: false, error: 'order_id and customer_id are required' };

      const rulesApplied: string[] = [];
      let decision: 'approved' | 'denied' | 'manual_review' = 'approved';
      let reason = '';

      // Rule 1: Return window check
      const maxReturnDays = 30;
      if (daysSincePurchase > maxReturnDays) {
        // Exceptions for defective items
        if (returnReason === 'defective' && daysSincePurchase <= 90) {
          rulesApplied.push(`PASS: Defective item exception (within 90-day warranty)`);
        } else {
          decision = 'denied';
          reason = `Return window expired (${daysSincePurchase} days, max ${maxReturnDays})`;
          rulesApplied.push(`DENY: Outside ${maxReturnDays}-day return window`);
        }
      } else {
        rulesApplied.push(`PASS: Within ${maxReturnDays}-day return window`);
      }

      // Rule 2: Fraud check
      if (decision !== 'denied') {
        const signals = detectFraudSignals(db, orderId, customerId, orderValue, returnReason, daysSincePurchase);
        const riskScore = Math.min(100, signals.reduce((sum, s) => sum + s.score, 0));
        if (riskScore >= 70) {
          decision = 'denied';
          reason = `High fraud risk score (${riskScore}/100)`;
          rulesApplied.push(`DENY: Fraud risk score ${riskScore} >= 70 threshold`);
        } else if (riskScore >= 40) {
          decision = 'manual_review';
          reason = `Moderate fraud risk score (${riskScore}/100) requires manual review`;
          rulesApplied.push(`REVIEW: Fraud risk score ${riskScore} >= 40 threshold`);
        } else {
          rulesApplied.push(`PASS: Fraud risk score ${riskScore} is acceptable`);
        }
      }

      // Rule 3: Auto-approve seller errors
      if (decision !== 'denied' && ['wrong_item_sent', 'damaged_in_shipping', 'seller_error'].includes(returnReason)) {
        decision = 'approved';
        reason = `Auto-approved: Seller responsibility (${returnReason.replace(/_/g, ' ')})`;
        rulesApplied.push(`AUTO-APPROVE: Seller error/responsibility`);
      }

      // Rule 4: High-value manual review threshold
      if (decision === 'approved' && orderValue > 500) {
        decision = 'manual_review';
        reason = `High-value order ($${orderValue}) requires manual review`;
        rulesApplied.push(`REVIEW: Order value $${orderValue} exceeds $500 auto-approve threshold`);
      }

      // Calculate restocking fee
      const feeResult = calculateRestockingFee(Math.round(orderValue * 100), itemCondition, returnReason);
      const restockingFeeCents = Math.round(feeResult.feeAmount * 100);
      const refundAmountCents = Math.round(feeResult.refundAmount * 100);

      if (!reason && decision === 'approved') {
        reason = 'All policy rules passed. Return approved.';
      }

      // Persist decision
      const decisionId = generateId();
      db.run(
        `INSERT INTO return_decisions (id, order_id, decision, reason, restocking_fee_cents, refund_amount_cents, rules_applied)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [decisionId, orderId, decision, reason, restockingFeeCents, refundAmountCents, JSON.stringify(rulesApplied)],
      );

      return {
        success: true,
        data: {
          decisionId,
          orderId,
          decision,
          reason,
          restockingFee: feeResult.feeAmount,
          refundAmount: feeResult.refundAmount,
          returnLabelGenerated: decision === 'approved',
          policyRulesApplied: rulesApplied,
        },
      };
    }

    case 'return_analytics': {
      const days = input.days != null ? Number(input.days) : 30;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      // Total returns in period
      const totalRows = db.query<Record<string, unknown>>(
        `SELECT COUNT(*) as cnt FROM returns WHERE created_at >= ?`, [cutoff],
      );
      const totalReturns = Number(totalRows[0]?.cnt ?? 0);

      // Total orders for return rate
      const totalOrderRows = db.query<Record<string, unknown>>(
        `SELECT COUNT(*) as cnt FROM orders WHERE created_at >= ?`, [cutoff],
      );
      const totalOrders = Math.max(Number(totalOrderRows[0]?.cnt ?? 1), 1);
      const returnRate = Math.round((totalReturns / totalOrders) * 10000) / 100;

      // Refund totals
      const refundRows = db.query<Record<string, unknown>>(
        `SELECT COALESCE(SUM(refund_amount_cents), 0) as total, COALESCE(AVG(refund_amount_cents), 0) as avg_val FROM return_decisions WHERE created_at >= ?`,
        [cutoff],
      );
      const totalRefunded = Number(refundRows[0]?.total ?? 0) / 100;
      const avgRefundAmount = Number(refundRows[0]?.avg_val ?? 0) / 100;

      // By reason
      const reasonRows = db.query<Record<string, unknown>>(
        `SELECT reason, COUNT(*) as cnt FROM returns WHERE created_at >= ? GROUP BY reason ORDER BY cnt DESC`,
        [cutoff],
      );
      const byReason = reasonRows.map(r => ({
        reason: String(r.reason ?? 'unknown'),
        count: Number(r.cnt ?? 0),
        pct: totalReturns > 0 ? Math.round((Number(r.cnt ?? 0) / totalReturns) * 10000) / 100 : 0,
      }));

      // Fraud detected
      const fraudRows = db.query<Record<string, unknown>>(
        `SELECT COUNT(*) as cnt FROM return_fraud_assessments WHERE risk_level IN ('high', 'critical') AND created_at >= ?`,
        [cutoff],
      );
      const fraudDetected = Number(fraudRows[0]?.cnt ?? 0);

      return {
        success: true,
        data: {
          period: `Last ${days} days`,
          totalReturns,
          returnRate: `${returnRate}%`,
          totalRefunded: Math.round(totalRefunded * 100) / 100,
          avgRefundAmount: Math.round(avgRefundAmount * 100) / 100,
          byReason,
          fraudDetected,
          totalOrdersInPeriod: totalOrders,
        },
      };
    }

    default:
      return { success: false, error: `Unknown advanced return tool: ${toolName}` };
  }
}
