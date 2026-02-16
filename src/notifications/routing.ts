/**
 * Alert Routing - Route alerts to specific notification channels
 *
 * Supports routing alert types to: email, webhook, discord, slack, console.
 * Rules are stored in the database and matched against incoming alerts.
 */

import { createLogger } from '../utils/logger.js';
import { generateId } from '../utils/id.js';
import type { Database } from '../db/index.js';
import type { Alert, AlertDeliveryChannel } from './types.js';
import { deliverAlert } from './delivery.js';
import { sendAlertEmail } from './email.js';
import type { EmailConfig } from './email.js';
import { sendAlertToDiscord } from './discord.js';
import { sendAlertToSlack } from './slack.js';

const logger = createLogger('alert-routing');

// =============================================================================
// TYPES
// =============================================================================

export type RoutingChannel = 'email' | 'webhook' | 'discord' | 'slack' | 'console';

export interface RoutingRule {
  id: string;
  userId: string;
  alertType: string;
  channel: RoutingChannel;
  config: Record<string, unknown>;
  priority: number;
  enabled: boolean;
  createdAt: number;
}

export interface RoutingResult {
  channel: RoutingChannel;
  ruleId: string;
  success: boolean;
  error?: string;
}

// =============================================================================
// CRUD
// =============================================================================

/**
 * Create a new alert routing rule.
 */
export function createRoutingRule(
  db: Database,
  rule: Omit<RoutingRule, 'id' | 'createdAt'>,
): RoutingRule {
  const fullRule: RoutingRule = {
    id: generateId('route'),
    createdAt: Date.now(),
    ...rule,
  };

  db.run(
    `INSERT INTO alert_routing_rules (id, user_id, alert_type, channel, config, priority, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fullRule.id,
      fullRule.userId,
      fullRule.alertType,
      fullRule.channel,
      JSON.stringify(fullRule.config),
      fullRule.priority,
      fullRule.enabled ? 1 : 0,
      fullRule.createdAt,
    ],
  );

  logger.info({ ruleId: fullRule.id, channel: fullRule.channel, alertType: fullRule.alertType }, 'Routing rule created');
  return fullRule;
}

/**
 * Get all routing rules for a user.
 */
export function getRoutingRules(db: Database, userId: string, enabledOnly = false): RoutingRule[] {
  const sql = enabledOnly
    ? 'SELECT * FROM alert_routing_rules WHERE user_id = ? AND enabled = 1 ORDER BY priority DESC, created_at DESC'
    : 'SELECT * FROM alert_routing_rules WHERE user_id = ? ORDER BY priority DESC, created_at DESC';

  const rows = db.query<Record<string, unknown>>(sql, [userId]);
  return rows.map(parseRoutingRuleRow);
}

/**
 * Get a single routing rule by ID.
 */
export function getRoutingRule(db: Database, ruleId: string): RoutingRule | undefined {
  const rows = db.query<Record<string, unknown>>(
    'SELECT * FROM alert_routing_rules WHERE id = ?',
    [ruleId],
  );
  if (rows.length === 0) return undefined;
  return parseRoutingRuleRow(rows[0]);
}

/**
 * Update a routing rule.
 */
export function updateRoutingRule(
  db: Database,
  ruleId: string,
  updates: Partial<Pick<RoutingRule, 'alertType' | 'channel' | 'config' | 'priority' | 'enabled'>>,
): void {
  const setClauses: string[] = [];
  const params: unknown[] = [];

  if (updates.alertType !== undefined) {
    setClauses.push('alert_type = ?');
    params.push(updates.alertType);
  }
  if (updates.channel !== undefined) {
    setClauses.push('channel = ?');
    params.push(updates.channel);
  }
  if (updates.config !== undefined) {
    setClauses.push('config = ?');
    params.push(JSON.stringify(updates.config));
  }
  if (updates.priority !== undefined) {
    setClauses.push('priority = ?');
    params.push(updates.priority);
  }
  if (updates.enabled !== undefined) {
    setClauses.push('enabled = ?');
    params.push(updates.enabled ? 1 : 0);
  }

  if (setClauses.length === 0) return;

  params.push(ruleId);
  db.run(
    `UPDATE alert_routing_rules SET ${setClauses.join(', ')} WHERE id = ?`,
    params,
  );
}

/**
 * Delete a routing rule.
 */
export function deleteRoutingRule(db: Database, ruleId: string): void {
  db.run('DELETE FROM alert_routing_rules WHERE id = ?', [ruleId]);
}

// =============================================================================
// ROUTING ENGINE
// =============================================================================

/**
 * Find matching routing rules for an alert and deliver to all matched channels.
 */
export async function routeAlert(
  db: Database,
  alert: Alert,
): Promise<RoutingResult[]> {
  const results: RoutingResult[] = [];

  // Get all enabled rules for this user
  const rules = getRoutingRules(db, alert.userId, true);

  // Filter rules matching this alert type
  const matchingRules = rules.filter((rule) => {
    return rule.alertType === 'all' || rule.alertType === alert.type;
  });

  if (matchingRules.length === 0) {
    logger.debug({ alertId: alert.id, type: alert.type }, 'No routing rules matched');
    return results;
  }

  for (const rule of matchingRules) {
    try {
      const result = await deliverToChannel(rule, alert, db);
      results.push({
        channel: rule.channel,
        ruleId: rule.id,
        success: result.success,
        error: result.error,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({
        channel: rule.channel,
        ruleId: rule.id,
        success: false,
        error: errorMsg,
      });
      logger.error({ ruleId: rule.id, err }, 'Routing delivery error');
    }
  }

  return results;
}

/**
 * Deliver an alert to a specific channel based on routing rule configuration.
 */
async function deliverToChannel(
  rule: RoutingRule,
  alert: Alert,
  db: Database,
): Promise<{ success: boolean; error?: string }> {
  switch (rule.channel) {
    case 'console': {
      const deliveryResults = await deliverAlert(alert, [{ channel: 'console' }]);
      const result = deliveryResults[0];
      return { success: result?.success ?? false, error: result?.error };
    }

    case 'webhook': {
      const webhookUrl = rule.config.webhook_url as string;
      if (!webhookUrl) {
        return { success: false, error: 'No webhook_url in routing config' };
      }
      const deliveryResults = await deliverAlert(alert, [{ channel: 'webhook', webhookUrl }]);
      const result = deliveryResults[0];
      return { success: result?.success ?? false, error: result?.error };
    }

    case 'email': {
      const emailTo = rule.config.email as string;
      if (!emailTo) {
        return { success: false, error: 'No email address in routing config' };
      }

      // Get email provider config from credentials
      const credRows = db.query<Record<string, unknown>>(
        "SELECT encrypted_data FROM trading_credentials WHERE user_id = ? AND platform = 'email'",
        [rule.userId],
      );
      if (credRows.length === 0) {
        return { success: false, error: 'Email not configured. Use setup_email first.' };
      }

      try {
        const emailConfig = JSON.parse(credRows[0].encrypted_data as string) as EmailConfig;
        const result = await sendAlertEmail(emailConfig, alert, emailTo);
        return { success: result.success, error: result.error };
      } catch (err) {
        return { success: false, error: `Failed to parse email config: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case 'discord': {
      const webhookUrl = rule.config.webhook_url as string;
      if (!webhookUrl) {
        return { success: false, error: 'No webhook_url in routing config for Discord' };
      }
      const result = await sendAlertToDiscord(webhookUrl, alert);
      return { success: result.success, error: result.error };
    }

    case 'slack': {
      const webhookUrl = rule.config.webhook_url as string;
      if (!webhookUrl) {
        return { success: false, error: 'No webhook_url in routing config for Slack' };
      }
      const result = await sendAlertToSlack(webhookUrl, alert);
      return { success: result.success, error: result.error };
    }

    default:
      return { success: false, error: `Unknown routing channel: ${rule.channel}` };
  }
}

// =============================================================================
// BATCH / DIGEST
// =============================================================================

/**
 * Aggregate undelivered alerts for a user into a batch for digest delivery.
 */
export function batchAlerts(
  db: Database,
  userId: string,
  _channel: RoutingChannel,
): Alert[] {
  // Get unread alerts for this user (these are "undelivered" for digest purposes)
  const rows = db.query<Record<string, unknown>>(
    `SELECT id, user_id, type, product_id, platform, old_value, new_value, threshold, message, read, created_at
     FROM alerts
     WHERE user_id = ? AND read = 0
     ORDER BY created_at DESC
     LIMIT 200`,
    [userId],
  );

  return rows.map((row) => ({
    id: row.id as string,
    userId: row.user_id as string,
    type: row.type as Alert['type'],
    productId: (row.product_id as string) ?? null,
    platform: (row.platform as string) ?? null,
    oldValue: row.old_value != null ? (row.old_value as number) : null,
    newValue: row.new_value != null ? (row.new_value as number) : null,
    threshold: row.threshold != null ? (row.threshold as number) : null,
    message: row.message as string,
    read: Boolean(row.read),
    createdAt: row.created_at as number,
  }));
}

// =============================================================================
// ROW PARSER
// =============================================================================

function parseRoutingRuleRow(row: Record<string, unknown>): RoutingRule {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse((row.config as string) ?? '{}') as Record<string, unknown>;
  } catch {
    config = {};
  }

  return {
    id: row.id as string,
    userId: row.user_id as string,
    alertType: row.alert_type as string,
    channel: row.channel as RoutingChannel,
    config,
    priority: (row.priority as number) ?? 0,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at as number,
  };
}
