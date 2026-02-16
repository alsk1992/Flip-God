/**
 * Notification Channel Manager
 *
 * Provides unified notification dispatch to Telegram and Discord
 * for alerts, order notifications, and opportunity alerts.
 * Separate from the chat adapters -- these are push-only channels.
 */

import { createLogger } from '../utils/logger';
import type { Alert, AlertLevel } from '../monitoring/alerts';
import type { Order, Opportunity } from '../types';

const logger = createLogger('notifications');

// =============================================================================
// TYPES
// =============================================================================

export interface TelegramNotificationConfig {
  botToken: string;
  chatId: string;
}

export interface DiscordNotificationConfig {
  webhookUrl: string;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
}

export interface NotificationChannel {
  readonly name: string;
  sendMessage(text: string): Promise<void>;
  sendAlert(alert: Alert): Promise<void>;
  sendOrderNotification(order: Order): Promise<void>;
  sendOpportunityAlert(opp: Opportunity): Promise<void>;
}

export interface ChannelManagerConfig {
  telegram?: TelegramNotificationConfig;
  discord?: DiscordNotificationConfig;
}

export interface NotificationChannelManager {
  /** Broadcast a plain text message to all configured channels */
  broadcast(text: string, channelNames?: string[]): Promise<void>;
  /** Broadcast an alert to all configured channels */
  broadcastAlert(alert: Alert): Promise<void>;
  /** Broadcast an order notification to all configured channels */
  broadcastOrder(order: Order): Promise<void>;
  /** Broadcast an opportunity alert to all configured channels */
  broadcastOpportunity(opp: Opportunity): Promise<void>;
  /** Get list of configured channel names */
  getChannelNames(): string[];
}

// =============================================================================
// TELEGRAM NOTIFICATION CHANNEL
// =============================================================================

const TELEGRAM_API_BASE = 'https://api.telegram.org';

export function createTelegramChannel(config: TelegramNotificationConfig): NotificationChannel {
  const { botToken, chatId } = config;

  async function sendTelegram(text: string, parseMode: 'Markdown' | 'HTML' = 'Markdown'): Promise<void> {
    const url = `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`;

    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        logger.error({ status: res.status, body: errText }, 'Telegram notification send failed');
      }
    } catch (err) {
      logger.error({ err }, 'Telegram notification request failed');
    }
  }

  async function sendWithButtons(text: string, buttons: Array<{ text: string; url: string }>): Promise<void> {
    const url = `${TELEGRAM_API_BASE}/bot${botToken}/sendMessage`;

    const inlineKeyboard = buttons.map((btn) => [{ text: btn.text, url: btn.url }]);

    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: inlineKeyboard,
      },
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        logger.error({ status: res.status, body: errText }, 'Telegram notification with buttons failed');
      }
    } catch (err) {
      logger.error({ err }, 'Telegram notification request failed');
    }
  }

  function alertLevelEmoji(level: AlertLevel): string {
    switch (level) {
      case 'critical': return '!!! CRITICAL';
      case 'warning': return '!! WARNING';
      case 'info': return 'INFO';
    }
  }

  return {
    name: 'telegram',

    async sendMessage(text: string): Promise<void> {
      await sendTelegram(text);
    },

    async sendAlert(alert: Alert): Promise<void> {
      const lines = [
        `*${alertLevelEmoji(alert.level)}*: ${escapeMarkdown(alert.name)}`,
        '',
        escapeMarkdown(alert.message),
      ];

      if (alert.value !== undefined) {
        lines.push(`*Value:* ${alert.value}`);
      }
      if (alert.threshold !== undefined) {
        lines.push(`*Threshold:* ${alert.threshold}`);
      }
      if (alert.source) {
        lines.push(`*Source:* ${escapeMarkdown(alert.source)}`);
      }

      lines.push(`_${new Date(alert.timestamp).toISOString()}_`);

      await sendTelegram(lines.join('\n'));
    },

    async sendOrderNotification(order: Order): Promise<void> {
      const statusEmoji =
        order.status === 'delivered' ? 'Delivered' :
        order.status === 'shipped' ? 'Shipped' :
        order.status === 'purchased' ? 'Purchased' :
        order.status === 'returned' ? 'Returned' :
        'Pending';

      const lines = [
        `*Order Update*: ${statusEmoji}`,
        '',
        `*Order ID:* \`${order.id}\``,
        `*Sell:* ${order.sellPlatform} @ $${order.sellPrice.toFixed(2)}`,
        `*Buy:* ${order.buyPlatform}${order.buyPrice ? ` @ $${order.buyPrice.toFixed(2)}` : ''}`,
      ];

      if (order.profit !== undefined && order.profit !== null) {
        lines.push(`*Profit:* $${order.profit.toFixed(2)}`);
      }
      if (order.trackingNumber) {
        lines.push(`*Tracking:* \`${order.trackingNumber}\``);
      }

      const buttons: Array<{ text: string; url: string }> = [];
      if (order.sellOrderId) {
        buttons.push({ text: 'View Order', url: `https://www.${order.sellPlatform}.com/orders/${order.sellOrderId}` });
      }

      if (buttons.length > 0) {
        await sendWithButtons(lines.join('\n'), buttons);
      } else {
        await sendTelegram(lines.join('\n'));
      }
    },

    async sendOpportunityAlert(opp: Opportunity): Promise<void> {
      const lines = [
        `*Opportunity Found*`,
        '',
        `*Product:* ${escapeMarkdown(opp.productId)}`,
        `*Buy:* ${opp.buyPlatform} @ $${opp.buyPrice.toFixed(2)}`,
        `*Sell:* ${opp.sellPlatform} @ $${opp.sellPrice.toFixed(2)}`,
        `*Margin:* ${opp.marginPct.toFixed(1)}%`,
        `*Est. Profit:* $${opp.estimatedProfit.toFixed(2)}`,
        `*Score:* ${opp.score.toFixed(0)}`,
      ];

      const buttons = [
        { text: 'View Details', url: `https://flipagent.io/opportunities/${opp.id}` },
        { text: 'Skip', url: `https://flipagent.io/opportunities/${opp.id}/skip` },
      ];

      await sendWithButtons(lines.join('\n'), buttons);
    },
  };
}

// =============================================================================
// DISCORD NOTIFICATION CHANNEL
// =============================================================================

export function createDiscordChannel(config: DiscordNotificationConfig): NotificationChannel {
  const { webhookUrl } = config;

  async function sendDiscord(body: Record<string, unknown>): Promise<void> {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errText = await res.text();
        logger.error({ status: res.status, body: errText }, 'Discord webhook send failed');
      }
    } catch (err) {
      logger.error({ err }, 'Discord webhook request failed');
    }
  }

  async function sendEmbed(embed: DiscordEmbed): Promise<void> {
    await sendDiscord({ embeds: [embed] });
  }

  function alertLevelColor(level: AlertLevel): number {
    switch (level) {
      case 'info': return 0x3498db;      // Blue
      case 'warning': return 0xf39c12;   // Orange
      case 'critical': return 0xe74c3c;  // Red
    }
  }

  function alertLevelLabel(level: AlertLevel): string {
    switch (level) {
      case 'critical': return 'CRITICAL';
      case 'warning': return 'WARNING';
      case 'info': return 'INFO';
    }
  }

  return {
    name: 'discord',

    async sendMessage(text: string): Promise<void> {
      await sendDiscord({ content: text });
    },

    async sendAlert(alert: Alert): Promise<void> {
      const fields: DiscordEmbed['fields'] = [];

      if (alert.value !== undefined) {
        fields!.push({ name: 'Value', value: String(alert.value), inline: true });
      }
      if (alert.threshold !== undefined) {
        fields!.push({ name: 'Threshold', value: String(alert.threshold), inline: true });
      }
      if (alert.source) {
        fields!.push({ name: 'Source', value: alert.source, inline: true });
      }
      if (alert.tags?.length) {
        fields!.push({ name: 'Tags', value: alert.tags.join(', '), inline: true });
      }

      await sendEmbed({
        title: `${alertLevelLabel(alert.level)}: ${alert.name}`,
        description: alert.message,
        color: alertLevelColor(alert.level),
        fields,
        timestamp: new Date(alert.timestamp).toISOString(),
        footer: { text: `Alert ID: ${alert.id}` },
      });
    },

    async sendOrderNotification(order: Order): Promise<void> {
      const statusColors: Record<string, number> = {
        pending: 0x95a5a6,    // Gray
        purchased: 0x3498db,  // Blue
        shipped: 0xf39c12,    // Orange
        delivered: 0x2ecc71,  // Green
        returned: 0xe74c3c,   // Red
      };

      const fields: DiscordEmbed['fields'] = [
        { name: 'Status', value: order.status.toUpperCase(), inline: true },
        { name: 'Sell Platform', value: `${order.sellPlatform} @ $${order.sellPrice.toFixed(2)}`, inline: true },
        { name: 'Buy Platform', value: `${order.buyPlatform}${order.buyPrice ? ` @ $${order.buyPrice.toFixed(2)}` : ''}`, inline: true },
      ];

      if (order.profit !== undefined && order.profit !== null) {
        fields.push({ name: 'Profit', value: `$${order.profit.toFixed(2)}`, inline: true });
      }
      if (order.trackingNumber) {
        fields.push({ name: 'Tracking', value: order.trackingNumber, inline: true });
      }

      await sendEmbed({
        title: `Order Update: ${order.id}`,
        color: statusColors[order.status] ?? 0x95a5a6,
        fields,
        timestamp: new Date().toISOString(),
      });
    },

    async sendOpportunityAlert(opp: Opportunity): Promise<void> {
      await sendEmbed({
        title: 'Opportunity Found',
        description: `Product: ${opp.productId}`,
        color: 0x2ecc71, // Green
        fields: [
          { name: 'Buy', value: `${opp.buyPlatform} @ $${opp.buyPrice.toFixed(2)}`, inline: true },
          { name: 'Sell', value: `${opp.sellPlatform} @ $${opp.sellPrice.toFixed(2)}`, inline: true },
          { name: 'Margin', value: `${opp.marginPct.toFixed(1)}%`, inline: true },
          { name: 'Est. Profit', value: `$${opp.estimatedProfit.toFixed(2)}`, inline: true },
          { name: 'Score', value: `${opp.score.toFixed(0)}`, inline: true },
        ],
        timestamp: new Date().toISOString(),
        footer: { text: `Opportunity ID: ${opp.id}` },
      });
    },
  };
}

// =============================================================================
// CHANNEL MANAGER
// =============================================================================

export function createNotificationChannelManager(config: ChannelManagerConfig): NotificationChannelManager {
  const channels: NotificationChannel[] = [];

  if (config.telegram) {
    channels.push(createTelegramChannel(config.telegram));
    logger.info('Telegram notification channel configured');
  }

  if (config.discord) {
    channels.push(createDiscordChannel(config.discord));
    logger.info('Discord notification channel configured');
  }

  if (channels.length === 0) {
    logger.info('No notification channels configured');
  }

  function getTargetChannels(channelNames?: string[]): NotificationChannel[] {
    if (!channelNames || channelNames.length === 0) {
      return channels;
    }
    return channels.filter((c) => channelNames.includes(c.name));
  }

  return {
    async broadcast(text: string, channelNames?: string[]): Promise<void> {
      const targets = getTargetChannels(channelNames);
      const results = await Promise.allSettled(targets.map((c) => c.sendMessage(text)));
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
          logger.error({ channel: targets[i].name, err: result.reason }, 'Failed to broadcast message');
        }
      }
    },

    async broadcastAlert(alert: Alert): Promise<void> {
      const results = await Promise.allSettled(channels.map((c) => c.sendAlert(alert)));
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
          logger.error({ channel: channels[i].name, err: result.reason }, 'Failed to broadcast alert');
        }
      }
    },

    async broadcastOrder(order: Order): Promise<void> {
      const results = await Promise.allSettled(channels.map((c) => c.sendOrderNotification(order)));
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
          logger.error({ channel: channels[i].name, err: result.reason }, 'Failed to broadcast order notification');
        }
      }
    },

    async broadcastOpportunity(opp: Opportunity): Promise<void> {
      const results = await Promise.allSettled(channels.map((c) => c.sendOpportunityAlert(opp)));
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'rejected') {
          logger.error({ channel: channels[i].name, err: result.reason }, 'Failed to broadcast opportunity alert');
        }
      }
    },

    getChannelNames(): string[] {
      return channels.map((c) => c.name);
    },
  };
}

// =============================================================================
// HELPERS
// =============================================================================

/** Escape Telegram Markdown v1 special characters */
function escapeMarkdown(text: string): string {
  return text.replace(/([_*`\[\]])/g, '\\$1');
}
