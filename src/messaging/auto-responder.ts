/**
 * Auto-Responder - Automatic keyword-based message replies
 *
 * Matches inbound messages against keyword rules and sends
 * template-based responses with configurable delay.
 */

import { createLogger } from '../utils/logger.js';
import { generateId } from '../utils/id.js';
import type { Database } from '../db/index.js';
import type { Message, AutoResponderRule } from './types.js';
import { getTemplate, renderTemplate } from './templates.js';
import { sendMessage } from './inbox.js';

const logger = createLogger('auto-responder');

// =============================================================================
// RULE CRUD
// =============================================================================

/**
 * Create a new auto-responder rule.
 */
export function createAutoResponderRule(
  db: Database,
  rule: Omit<AutoResponderRule, 'id' | 'createdAt'>,
): AutoResponderRule {
  const fullRule: AutoResponderRule = {
    id: generateId('arsp'),
    createdAt: Date.now(),
    ...rule,
  };

  db.run(
    `INSERT INTO auto_responder_rules (id, user_id, keywords, template_id, template_name, delay_minutes, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fullRule.id,
      fullRule.userId,
      JSON.stringify(fullRule.keywords),
      fullRule.templateId ?? null,
      fullRule.templateName ?? null,
      fullRule.delayMinutes,
      fullRule.enabled ? 1 : 0,
      fullRule.createdAt,
    ],
  );

  logger.info({ ruleId: fullRule.id, keywords: fullRule.keywords }, 'Auto-responder rule created');
  return fullRule;
}

/**
 * Get all auto-responder rules for a user.
 */
export function getAutoResponderRules(db: Database, userId: string, enabledOnly = false): AutoResponderRule[] {
  const sql = enabledOnly
    ? 'SELECT * FROM auto_responder_rules WHERE user_id = ? AND enabled = 1 ORDER BY created_at DESC'
    : 'SELECT * FROM auto_responder_rules WHERE user_id = ? ORDER BY created_at DESC';

  const rows = db.query<Record<string, unknown>>(sql, [userId]);
  return rows.map(parseAutoResponderRow);
}

/**
 * Delete an auto-responder rule.
 */
export function deleteAutoResponderRule(db: Database, ruleId: string): void {
  db.run('DELETE FROM auto_responder_rules WHERE id = ?', [ruleId]);
}

/**
 * Enable or disable an auto-responder rule.
 */
export function setAutoResponderEnabled(db: Database, ruleId: string, enabled: boolean): void {
  db.run('UPDATE auto_responder_rules SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, ruleId]);
}

// =============================================================================
// AUTO-RESPONSE ENGINE
// =============================================================================

/**
 * Check if a message matches any auto-responder rules and queue responses.
 *
 * Returns the list of triggered rules and their response messages.
 */
export async function processAutoResponses(
  db: Database,
  inboundMessage: Message,
): Promise<Array<{ ruleId: string; templateName: string; delayed: boolean }>> {
  const results: Array<{ ruleId: string; templateName: string; delayed: boolean }> = [];

  if (inboundMessage.direction !== 'inbound') {
    return results;
  }

  const rules = getAutoResponderRules(db, inboundMessage.userId, true);
  if (rules.length === 0) return results;

  const messageText = `${inboundMessage.subject ?? ''} ${inboundMessage.body}`.toLowerCase();

  for (const rule of rules) {
    const matched = rule.keywords.some((keyword) => {
      const lowerKeyword = keyword.toLowerCase().trim();
      return lowerKeyword.length > 0 && messageText.includes(lowerKeyword);
    });

    if (!matched) continue;

    // Find the template
    const templateIdOrName = rule.templateId ?? rule.templateName;
    if (!templateIdOrName) {
      logger.warn({ ruleId: rule.id }, 'Auto-responder rule has no template configured');
      continue;
    }

    const template = getTemplate(db, inboundMessage.userId, templateIdOrName);
    if (!template) {
      logger.warn({ ruleId: rule.id, templateIdOrName }, 'Auto-responder template not found');
      continue;
    }

    // Build variables from message context
    const variables: Record<string, string> = {
      buyer_name: inboundMessage.sender ?? 'Customer',
      order_id: inboundMessage.orderId ?? '',
      seller_name: 'Seller',
    };

    const { subject, body } = renderTemplate(template.body, variables, template.subject);

    if (rule.delayMinutes > 0) {
      // For delayed responses, we just log the intent.
      // A proper implementation would use a job queue with scheduled execution.
      logger.info(
        { ruleId: rule.id, delayMinutes: rule.delayMinutes, messageId: inboundMessage.id },
        'Auto-response delayed (would send after delay)',
      );
      results.push({ ruleId: rule.id, templateName: template.name, delayed: true });
    } else {
      // Send immediately
      try {
        await sendMessage(db, {
          userId: inboundMessage.userId,
          platform: inboundMessage.platform ?? undefined,
          orderId: inboundMessage.orderId ?? undefined,
          recipient: inboundMessage.sender ?? undefined,
          subject: subject ?? undefined,
          body,
        });

        logger.info(
          { ruleId: rule.id, templateName: template.name, messageId: inboundMessage.id },
          'Auto-response sent',
        );
        results.push({ ruleId: rule.id, templateName: template.name, delayed: false });
      } catch (err) {
        logger.error({ ruleId: rule.id, err }, 'Failed to send auto-response');
      }
    }
  }

  return results;
}

// =============================================================================
// SETUP
// =============================================================================

/**
 * Setup auto-responder with a set of rules (replaces all existing rules for the user).
 */
export function setupAutoResponder(
  db: Database,
  userId: string,
  enabled: boolean,
  rules: Array<{ keywords: string[]; template: string; delay_minutes?: number }>,
): AutoResponderRule[] {
  // If disabling, disable all existing rules
  if (!enabled) {
    db.run(
      'UPDATE auto_responder_rules SET enabled = 0 WHERE user_id = ?',
      [userId],
    );
    logger.info({ userId }, 'Auto-responder disabled');
    return getAutoResponderRules(db, userId);
  }

  // Create new rules
  const createdRules: AutoResponderRule[] = [];
  for (const ruleInput of rules) {
    if (!ruleInput.keywords || ruleInput.keywords.length === 0) continue;
    if (!ruleInput.template) continue;

    const rule = createAutoResponderRule(db, {
      userId,
      keywords: ruleInput.keywords,
      templateId: null,
      templateName: ruleInput.template,
      delayMinutes: Math.max(0, Number.isFinite(ruleInput.delay_minutes) ? (ruleInput.delay_minutes as number) : 5),
      enabled: true,
    });
    createdRules.push(rule);
  }

  return createdRules;
}

// =============================================================================
// ROW PARSER
// =============================================================================

function parseAutoResponderRow(row: Record<string, unknown>): AutoResponderRule {
  let keywords: string[] = [];
  try {
    const parsed = JSON.parse((row.keywords as string) ?? '[]');
    keywords = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    keywords = [];
  }

  return {
    id: row.id as string,
    userId: row.user_id as string,
    keywords,
    templateId: (row.template_id as string) ?? null,
    templateName: (row.template_name as string) ?? null,
    delayMinutes: (row.delay_minutes as number) ?? 5,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at as number,
  };
}
