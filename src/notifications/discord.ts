/**
 * Discord Webhook Delivery - Send rich embeds to Discord channels
 */

import { createLogger } from '../utils/logger.js';
import type { Alert } from './types.js';

const logger = createLogger('discord-delivery');

// =============================================================================
// TYPES
// =============================================================================

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

export interface DiscordWebhookPayload {
  content?: string;
  username?: string;
  avatar_url?: string;
  embeds?: DiscordEmbed[];
}

export interface DiscordResult {
  success: boolean;
  error?: string;
}

// =============================================================================
// COLORS (Discord uses decimal color values)
// =============================================================================

const DISCORD_COLORS = {
  success: 0x34a853,  // green
  warning: 0xf9ab00,  // yellow/amber
  danger: 0xea4335,   // red
  info: 0x4285f4,     // blue
  default: 0x5865f2,  // discord blurple
} as const;

function alertSeverityColor(type: string): number {
  switch (type) {
    case 'price_drop': return DISCORD_COLORS.success;
    case 'price_increase': return DISCORD_COLORS.warning;
    case 'stock_low': return DISCORD_COLORS.warning;
    case 'stock_out': return DISCORD_COLORS.danger;
    case 'back_in_stock': return DISCORD_COLORS.success;
    case 'new_opportunity': return DISCORD_COLORS.info;
    default: return DISCORD_COLORS.default;
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
 * Format an alert as a Discord embed.
 */
export function formatAlertEmbed(alert: Alert): DiscordEmbed {
  const fields: DiscordEmbed['fields'] = [];

  if (alert.platform) {
    fields.push({ name: 'Platform', value: alert.platform, inline: true });
  }
  if (alert.productId) {
    fields.push({ name: 'Product', value: alert.productId, inline: true });
  }
  if (alert.oldValue != null && Number.isFinite(alert.oldValue) && alert.newValue != null && Number.isFinite(alert.newValue)) {
    fields.push({
      name: 'Price Change',
      value: `$${alert.oldValue.toFixed(2)} -> $${alert.newValue.toFixed(2)}`,
      inline: true,
    });
  } else if (alert.newValue != null && Number.isFinite(alert.newValue)) {
    fields.push({ name: 'Value', value: `${alert.newValue}`, inline: true });
  }
  if (alert.threshold != null && Number.isFinite(alert.threshold)) {
    fields.push({ name: 'Threshold', value: `${alert.threshold}`, inline: true });
  }

  return {
    title: alertTypeLabel(alert.type),
    description: alert.message,
    color: alertSeverityColor(alert.type),
    fields: fields.length > 0 ? fields : undefined,
    footer: { text: `FlipGod | ${alert.id}` },
    timestamp: new Date(alert.createdAt).toISOString(),
  };
}

/**
 * Send a Discord webhook message with an embed.
 */
export async function sendDiscordWebhook(
  webhookUrl: string,
  embed: DiscordEmbed,
  username?: string,
): Promise<DiscordResult> {
  if (!webhookUrl) {
    return { success: false, error: 'Webhook URL is required' };
  }

  const payload: DiscordWebhookPayload = {
    username: username ?? 'FlipGod',
    embeds: [embed],
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
      logger.warn({ status: response.status, webhookUrl: webhookUrl.slice(0, 50) + '...' }, 'Discord webhook failed');
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText.slice(0, 300)}`,
      };
    }

    logger.debug('Discord webhook delivered');
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error({ err }, 'Discord webhook error');
    return { success: false, error: errorMsg };
  }
}

/**
 * Send an alert to Discord via webhook.
 */
export async function sendAlertToDiscord(
  webhookUrl: string,
  alert: Alert,
): Promise<DiscordResult> {
  const embed = formatAlertEmbed(alert);
  return sendDiscordWebhook(webhookUrl, embed);
}
