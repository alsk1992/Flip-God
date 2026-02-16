/**
 * Notifications Module - Alert tools and handlers
 *
 * Exports tool definitions for the agent system and handler functions
 * for alert management.
 */

import type { Database } from '../db/index';
import type { AlertType } from './types';
import {
  createAlertRule,
  getAlerts,
  getAlertRules,
  getAlertRule,
  setAlertRuleEnabled,
  deleteAlertRule,
  checkPriceAlerts,
  markRead,
  markAllRead,
} from './alert-engine';
import { deliverAlert } from './delivery';

export { createAlertRule, getAlerts, getAlertRules, markRead, markAllRead } from './alert-engine';
export { deliverAlert, formatAlertMessage, formatAlertEmail } from './delivery';
export type { Alert, AlertRule, AlertType, AlertDeliveryChannel, AlertCheckResult } from './types';

// Email delivery
export { sendEmail, sendAlertEmail, sendTestEmail } from './email';
export type { EmailConfig, EmailParams, EmailResult } from './email';
export { renderAlertEmail, renderDailyDigestEmail, renderOrderNotificationEmail } from './email-templates';
export { emailTools, handleEmailTool } from './email-index';

// Alert routing
export { createRoutingRule, getRoutingRules, routeAlert, batchAlerts } from './routing';
export type { RoutingRule, RoutingChannel, RoutingResult } from './routing';
export { routingTools, handleRoutingTool } from './routing-index';

// Discord & Slack
export { sendDiscordWebhook, sendAlertToDiscord, formatAlertEmbed } from './discord';
export { sendSlackWebhook, sendAlertToSlack, formatAlertBlocks } from './slack';

// Stock checker
export { checkStockLevels, clearStockStateCache } from './stock-checker';

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const alertTools = [
  {
    name: 'create_alert_rule',
    description: 'Create a price/stock alert rule for monitoring',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string' as const,
          enum: ['price_drop', 'price_increase', 'stock_low', 'stock_out', 'back_in_stock', 'new_opportunity'],
          description: 'Type of alert to create',
        },
        platform: { type: 'string' as const, description: 'Platform to monitor (or "all")' },
        category: { type: 'string' as const, description: 'Product category filter' },
        threshold_pct: { type: 'number' as const, description: 'Percentage threshold (e.g., 10 for 10% drop)' },
        threshold_abs: { type: 'number' as const, description: 'Absolute dollar threshold' },
        webhook_url: { type: 'string' as const, description: 'Webhook URL for notifications' },
      },
      required: ['type'] as const,
    },
  },
  {
    name: 'list_alerts',
    description: 'View triggered alerts and notifications',
    input_schema: {
      type: 'object' as const,
      properties: {
        unread_only: { type: 'boolean' as const, description: 'Only show unread alerts (default: true)' },
        type: { type: 'string' as const, description: 'Filter by alert type' },
        limit: { type: 'number' as const, description: 'Maximum number of alerts to return (default: 20)' },
      },
    },
  },
  {
    name: 'check_alerts_now',
    description: 'Run alert checks immediately (normally runs on schedule)',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'manage_alert_rules',
    description: 'List, enable, disable, or delete alert rules',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string' as const,
          enum: ['list', 'enable', 'disable', 'delete'],
          description: 'Action to perform on alert rules',
        },
        rule_id: { type: 'string' as const, description: 'Rule ID (required for enable/disable/delete)' },
      },
      required: ['action'] as const,
    },
  },
];

// =============================================================================
// TOOL HANDLER
// =============================================================================

/**
 * Handle alert tool invocations.
 *
 * @param toolName - The name of the tool being called
 * @param input - The tool input parameters
 * @param db - Database instance
 * @param userId - The user ID making the request
 */
export async function handleAlertTool(
  toolName: string,
  input: Record<string, unknown>,
  db: Database,
  userId: string,
): Promise<unknown> {
  switch (toolName) {
    case 'create_alert_rule': {
      const type = input.type as AlertType;
      const platform = (input.platform as string) ?? null;
      const category = (input.category as string) ?? null;
      const thresholdPct = input.threshold_pct != null ? Number(input.threshold_pct) : null;
      const thresholdAbs = input.threshold_abs != null ? Number(input.threshold_abs) : null;

      // Validate numeric thresholds
      if (thresholdPct != null && !Number.isFinite(thresholdPct)) {
        return { error: 'threshold_pct must be a valid number' };
      }
      if (thresholdAbs != null && !Number.isFinite(thresholdAbs)) {
        return { error: 'threshold_abs must be a valid number' };
      }

      const rule = createAlertRule(db, {
        userId,
        type,
        platform,
        category,
        thresholdPct,
        thresholdAbs,
      });

      return {
        success: true,
        rule: {
          id: rule.id,
          type: rule.type,
          platform: rule.platform,
          category: rule.category,
          thresholdPct: rule.thresholdPct,
          thresholdAbs: rule.thresholdAbs,
          enabled: rule.enabled,
        },
        message: `Alert rule created: ${rule.type}${rule.platform ? ` on ${rule.platform}` : ''}`,
      };
    }

    case 'list_alerts': {
      const unreadOnly = input.unread_only !== false; // default true
      const type = input.type as AlertType | undefined;
      const limit = Math.max(1, Math.min(Number(input.limit) || 20, 100));

      const alerts = getAlerts(db, userId, { unreadOnly, type, limit });

      return {
        alerts: alerts.map((a) => ({
          id: a.id,
          type: a.type,
          message: a.message,
          platform: a.platform,
          productId: a.productId,
          oldValue: a.oldValue,
          newValue: a.newValue,
          read: a.read,
          createdAt: new Date(a.createdAt).toISOString(),
        })),
        count: alerts.length,
        unreadOnly,
      };
    }

    case 'check_alerts_now': {
      const result = checkPriceAlerts(db);

      // Deliver any new alerts to console by default
      for (const alert of result.alerts) {
        try {
          await deliverAlert(alert, [{ channel: 'console' }]);
        } catch {
          // delivery errors are non-fatal
        }
      }

      return {
        rulesEvaluated: result.rulesEvaluated,
        alertsTriggered: result.alertsTriggered,
        alerts: result.alerts.map((a) => ({
          id: a.id,
          type: a.type,
          message: a.message,
        })),
        errors: result.errors,
      };
    }

    case 'manage_alert_rules': {
      const action = input.action as string;
      const ruleId = input.rule_id as string | undefined;

      switch (action) {
        case 'list': {
          const rules = getAlertRules(db, userId);
          return {
            rules: rules.map((r) => ({
              id: r.id,
              type: r.type,
              platform: r.platform,
              category: r.category,
              thresholdPct: r.thresholdPct,
              thresholdAbs: r.thresholdAbs,
              enabled: r.enabled,
              createdAt: new Date(r.createdAt).toISOString(),
            })),
            count: rules.length,
          };
        }

        case 'enable': {
          if (!ruleId) return { error: 'rule_id is required for enable action' };
          const rule = getAlertRule(db, ruleId);
          if (!rule) return { error: `Rule ${ruleId} not found` };
          setAlertRuleEnabled(db, ruleId, true);
          return { success: true, message: `Rule ${ruleId} enabled` };
        }

        case 'disable': {
          if (!ruleId) return { error: 'rule_id is required for disable action' };
          const rule = getAlertRule(db, ruleId);
          if (!rule) return { error: `Rule ${ruleId} not found` };
          setAlertRuleEnabled(db, ruleId, false);
          return { success: true, message: `Rule ${ruleId} disabled` };
        }

        case 'delete': {
          if (!ruleId) return { error: 'rule_id is required for delete action' };
          const rule = getAlertRule(db, ruleId);
          if (!rule) return { error: `Rule ${ruleId} not found` };
          deleteAlertRule(db, ruleId);
          return { success: true, message: `Rule ${ruleId} deleted` };
        }

        default:
          return { error: `Unknown action: ${action}` };
      }
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}
