/**
 * Notification & Alert Types
 */

// =============================================================================
// ALERT TYPES
// =============================================================================

export type AlertType =
  | 'price_drop'
  | 'price_increase'
  | 'stock_low'
  | 'stock_out'
  | 'back_in_stock'
  | 'new_opportunity';

export interface Alert {
  id: string;
  userId: string;
  type: AlertType;
  productId: string | null;
  platform: string | null;
  oldValue: number | null;
  newValue: number | null;
  threshold: number | null;
  message: string;
  read: boolean;
  createdAt: number;
}

export interface AlertRule {
  id: string;
  userId: string;
  type: AlertType;
  platform: string | null;
  category: string | null;
  thresholdPct: number | null;
  thresholdAbs: number | null;
  enabled: boolean;
  createdAt: number;
}

export type AlertDeliveryChannel = 'webhook' | 'console' | 'email';

export interface AlertDeliveryConfig {
  channel: AlertDeliveryChannel;
  webhookUrl?: string;
  emailTo?: string;
}

export interface AlertCheckResult {
  rulesEvaluated: number;
  alertsTriggered: number;
  alerts: Alert[];
  errors: string[];
}
