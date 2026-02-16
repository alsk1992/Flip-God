/**
 * Alert Routing Tools - Tool definitions and handler for per-channel alert routing
 */

import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import {
  createRoutingRule,
  getRoutingRules,
  getRoutingRule,
  deleteRoutingRule,
} from './routing.js';
import type { RoutingChannel } from './routing.js';

const logger = createLogger('routing-tools');

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const routingTools = [
  {
    name: 'create_alert_route',
    description: 'Route specific alert types to notification channels (email, Discord, Slack, webhook)',
    input_schema: {
      type: 'object' as const,
      properties: {
        alert_type: {
          type: 'string' as const,
          enum: ['price_drop', 'price_increase', 'stock_low', 'stock_out', 'back_in_stock', 'new_opportunity', 'order_received', 'all'],
          description: 'Type of alert to route',
        },
        channel: {
          type: 'string' as const,
          enum: ['email', 'webhook', 'discord', 'slack', 'console'],
          description: 'Notification channel to route to',
        },
        config: {
          type: 'object' as const,
          description: 'Channel config (webhook_url for webhook/discord/slack, email for email)',
        },
        priority: {
          type: 'number' as const,
          description: 'Priority (higher = evaluated first, default: 0)',
        },
      },
      required: ['alert_type', 'channel', 'config'] as const,
    },
  },
  {
    name: 'list_alert_routes',
    description: 'List configured alert routing rules',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'delete_alert_route',
    description: 'Delete an alert routing rule',
    input_schema: {
      type: 'object' as const,
      properties: {
        route_id: { type: 'string' as const, description: 'Routing rule ID to delete' },
      },
      required: ['route_id'] as const,
    },
  },
];

// =============================================================================
// TOOL HANDLER
// =============================================================================

const VALID_CHANNELS: RoutingChannel[] = ['email', 'webhook', 'discord', 'slack', 'console'];
const VALID_ALERT_TYPES = ['price_drop', 'price_increase', 'stock_low', 'stock_out', 'back_in_stock', 'new_opportunity', 'order_received', 'all'];

export async function handleRoutingTool(
  toolName: string,
  input: Record<string, unknown>,
  db: Database,
  userId: string,
): Promise<unknown> {
  switch (toolName) {
    case 'create_alert_route': {
      const alertType = input.alert_type as string;
      const channel = input.channel as RoutingChannel;
      const config = (input.config as Record<string, unknown>) ?? {};
      const priority = Number(input.priority ?? 0);

      if (!alertType || !VALID_ALERT_TYPES.includes(alertType)) {
        return { error: `Invalid alert_type. Must be one of: ${VALID_ALERT_TYPES.join(', ')}` };
      }
      if (!channel || !VALID_CHANNELS.includes(channel)) {
        return { error: `Invalid channel. Must be one of: ${VALID_CHANNELS.join(', ')}` };
      }
      if (!Number.isFinite(priority)) {
        return { error: 'priority must be a valid number' };
      }

      // Validate channel-specific config
      if ((channel === 'webhook' || channel === 'discord' || channel === 'slack') && !config.webhook_url) {
        return { error: `webhook_url is required in config for ${channel} channel` };
      }
      if (channel === 'email' && !config.email) {
        return { error: 'email address is required in config for email channel' };
      }

      const rule = createRoutingRule(db, {
        userId,
        alertType,
        channel,
        config,
        priority,
        enabled: true,
      });

      return {
        success: true,
        rule: {
          id: rule.id,
          alertType: rule.alertType,
          channel: rule.channel,
          config: rule.config,
          priority: rule.priority,
          enabled: rule.enabled,
        },
        message: `Alert route created: ${alertType} -> ${channel}`,
      };
    }

    case 'list_alert_routes': {
      const rules = getRoutingRules(db, userId);
      return {
        rules: rules.map((r) => ({
          id: r.id,
          alertType: r.alertType,
          channel: r.channel,
          config: r.config,
          priority: r.priority,
          enabled: r.enabled,
          createdAt: new Date(r.createdAt).toISOString(),
        })),
        count: rules.length,
      };
    }

    case 'delete_alert_route': {
      const routeId = input.route_id as string;
      if (!routeId) {
        return { error: 'route_id is required' };
      }

      const existing = getRoutingRule(db, routeId);
      if (!existing) {
        return { error: `Routing rule ${routeId} not found` };
      }
      if (existing.userId !== userId) {
        return { error: 'Cannot delete routing rule owned by another user' };
      }

      deleteRoutingRule(db, routeId);
      logger.info({ routeId }, 'Routing rule deleted');
      return { success: true, message: `Routing rule ${routeId} deleted` };
    }

    default:
      return { error: `Unknown routing tool: ${toolName}` };
  }
}
