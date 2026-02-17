/**
 * Slack Webhook Delivery - Send block kit formatted messages to Slack
 */

import { createLogger } from '../utils/logger.js';
import type { Alert } from './types.js';

const logger = createLogger('slack-delivery');

// =============================================================================
// TYPES
// =============================================================================

export interface SlackBlock {
  type: string;
  text?: { type: string; text: string; emoji?: boolean };
  fields?: Array<{ type: string; text: string }>;
  elements?: Array<{ type: string; text: string }>;
}

export interface SlackWebhookPayload {
  text?: string;
  blocks?: SlackBlock[];
  username?: string;
  icon_emoji?: string;
}

export interface SlackResult {
  success: boolean;
  error?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

function alertEmoji(type: string): string {
  switch (type) {
    case 'price_drop': return ':chart_with_downwards_trend:';
    case 'price_increase': return ':chart_with_upwards_trend:';
    case 'stock_low': return ':warning:';
    case 'stock_out': return ':x:';
    case 'back_in_stock': return ':white_check_mark:';
    case 'new_opportunity': return ':star:';
    default: return ':bell:';
  }
}

function alertTypeLabel(type: string): string {
  switch (type) {
    case 'price_drop': return 'Price Drop';
    case 'price_increase': return 'Price Increase';
    case 'stock_low': return 'Low Stock';
    case 'stock_out': return 'Out of Stock';
    case 'back_in_stock': return 'Back in Stock';
    case 'new_opportunity': return 'New Opportunity';
    default: return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Format an alert as Slack block kit blocks.
 */
export function formatAlertBlocks(alert: Alert): SlackBlock[] {
  const blocks: SlackBlock[] = [];

  // Header
  blocks.push({
    type: 'header',
    text: {
      type: 'plain_text',
      text: `${alertEmoji(alert.type)} ${alertTypeLabel(alert.type)}`,
      emoji: true,
    },
  });

  // Main message
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: alert.message,
    },
  });

  // Detail fields
  const fields: Array<{ type: string; text: string }> = [];

  if (alert.platform) {
    fields.push({ type: 'mrkdwn', text: `*Platform:*\n${alert.platform}` });
  }
  if (alert.productId) {
    fields.push({ type: 'mrkdwn', text: `*Product:*\n${alert.productId}` });
  }
  if (alert.oldValue != null && Number.isFinite(alert.oldValue)) {
    fields.push({ type: 'mrkdwn', text: `*Previous:*\n$${alert.oldValue.toFixed(2)}` });
  }
  if (alert.newValue != null && Number.isFinite(alert.newValue)) {
    fields.push({ type: 'mrkdwn', text: `*Current:*\n$${alert.newValue.toFixed(2)}` });
  }
  if (alert.threshold != null && Number.isFinite(alert.threshold)) {
    fields.push({ type: 'mrkdwn', text: `*Threshold:*\n${alert.threshold}` });
  }

  if (fields.length > 0) {
    blocks.push({
      type: 'section',
      fields,
    });
  }

  // Divider
  blocks.push({ type: 'divider' });

  // Context / footer
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `FlipGod | ${alert.id} | ${new Date(alert.createdAt).toISOString()}`,
      },
    ],
  });

  return blocks;
}

/**
 * Send a Slack webhook message with block kit formatting.
 */
export async function sendSlackWebhook(
  webhookUrl: string,
  blocks: SlackBlock[],
  fallbackText?: string,
): Promise<SlackResult> {
  if (!webhookUrl) {
    return { success: false, error: 'Webhook URL is required' };
  }

  const payload: SlackWebhookPayload = {
    text: fallbackText ?? 'FlipGod Alert',
    blocks,
    username: 'FlipGod',
    icon_emoji: ':package:',
  };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.warn({ status: response.status }, 'Slack webhook failed');
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText.slice(0, 300)}`,
      };
    }

    logger.debug('Slack webhook delivered');
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'Slack webhook error');
    return { success: false, error: errorMsg };
  }
}

/**
 * Send an alert to Slack via webhook.
 */
export async function sendAlertToSlack(
  webhookUrl: string,
  alert: Alert,
): Promise<SlackResult> {
  const blocks = formatAlertBlocks(alert);
  return sendSlackWebhook(webhookUrl, blocks, alert.message);
}
