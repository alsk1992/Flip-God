/**
 * Messaging Module - Tool definitions and handlers for buyer communication
 *
 * Exports tool definitions for the agent system and handler functions
 * for message management, templates, and auto-responder.
 */

import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import {
  listMessages,
  sendMessage,
  markMessageRead,
  markAllMessagesRead,
  getUnreadCount,
} from './inbox.js';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  deleteTemplate,
  renderTemplate,
  extractVariables,
} from './templates.js';
import {
  setupAutoResponder,
  getAutoResponderRules,
  deleteAutoResponderRule,
} from './auto-responder.js';

export {
  listMessages,
  sendMessage,
  getMessage,
  markMessageRead,
  markAllMessagesRead,
  getUnreadCount,
  createMessage,
} from './inbox.js';
export {
  listTemplates,
  getTemplate,
  createTemplate,
  deleteTemplate,
  renderTemplate,
  extractVariables,
  getBuiltInTemplates,
} from './templates.js';
export {
  setupAutoResponder,
  getAutoResponderRules,
  processAutoResponses,
} from './auto-responder.js';
export type {
  Message,
  MessageTemplate,
  AutoResponderRule,
  ListMessagesOptions,
  MessageDirection,
} from './types.js';

const logger = createLogger('messaging');

// =============================================================================
// TOOL DEFINITIONS
// =============================================================================

export const messagingTools = [
  {
    name: 'list_messages',
    description: 'View buyer/seller messages across platforms',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string' as const, description: 'Filter by platform' },
        unread_only: { type: 'boolean' as const, description: 'Only show unread messages (default: false)' },
        order_id: { type: 'string' as const, description: 'Filter by order ID' },
        limit: { type: 'number' as const, description: 'Maximum messages to return (default: 20)' },
      },
    },
  },
  {
    name: 'send_message',
    description: 'Send a message to a buyer',
    input_schema: {
      type: 'object' as const,
      properties: {
        order_id: { type: 'string' as const, description: 'Order ID for context' },
        platform: { type: 'string' as const, description: 'Platform to send on' },
        subject: { type: 'string' as const, description: 'Message subject' },
        body: { type: 'string' as const, description: 'Message body text' },
        template: { type: 'string' as const, description: 'Use a message template instead of body' },
        template_variables: { type: 'object' as const, description: 'Variables for template substitution' },
        recipient: { type: 'string' as const, description: 'Recipient identifier' },
      },
      required: ['order_id', 'body'] as const,
    },
  },
  {
    name: 'manage_templates',
    description: 'List, create, or delete message templates',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string' as const,
          enum: ['list', 'create', 'delete', 'preview'],
          description: 'Action to perform',
        },
        name: { type: 'string' as const, description: 'Template name (for create)' },
        subject: { type: 'string' as const, description: 'Template subject (for create)' },
        body: { type: 'string' as const, description: 'Template body (for create)' },
        template_id: { type: 'string' as const, description: 'Template ID (for delete/preview)' },
        variables: { type: 'object' as const, description: 'Preview variables (for preview)' },
      },
      required: ['action'] as const,
    },
  },
  {
    name: 'setup_auto_responder',
    description: 'Configure automatic message responses based on keywords',
    input_schema: {
      type: 'object' as const,
      properties: {
        enabled: { type: 'boolean' as const, description: 'Enable or disable auto-responder' },
        rules: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              keywords: { type: 'array' as const, items: { type: 'string' as const }, description: 'Keywords to match in messages' },
              template: { type: 'string' as const, description: 'Template name to use for response' },
              delay_minutes: { type: 'number' as const, description: 'Delay before auto-response (default: 5)' },
            },
          },
          description: 'Auto-responder rules',
        },
      },
    },
  },
];

// =============================================================================
// TOOL HANDLER
// =============================================================================

export async function handleMessagingTool(
  toolName: string,
  input: Record<string, unknown>,
  db: Database,
  userId: string,
): Promise<unknown> {
  switch (toolName) {
    case 'list_messages': {
      const platform = (input.platform as string) ?? undefined;
      const unreadOnly = input.unread_only === true;
      const orderId = (input.order_id as string) ?? undefined;
      const limit = Math.max(1, Math.min(Number(input.limit) || 20, 100));

      const messages = listMessages(db, userId, { platform, unreadOnly, orderId, limit });
      const unread = getUnreadCount(db, userId);

      return {
        messages: messages.map((m) => ({
          id: m.id,
          platform: m.platform,
          orderId: m.orderId,
          direction: m.direction,
          sender: m.sender,
          recipient: m.recipient,
          subject: m.subject,
          body: m.body.length > 200 ? m.body.slice(0, 200) + '...' : m.body,
          read: m.read,
          createdAt: new Date(m.createdAt).toISOString(),
        })),
        count: messages.length,
        totalUnread: unread,
      };
    }

    case 'send_message': {
      const orderId = (input.order_id as string) ?? undefined;
      const platform = (input.platform as string) ?? undefined;
      const recipient = (input.recipient as string) ?? undefined;
      let subject = (input.subject as string) ?? undefined;
      let body = input.body as string;
      const templateName = (input.template as string) ?? undefined;
      const templateVars = (input.template_variables as Record<string, string>) ?? {};

      // If template is specified, render it
      if (templateName) {
        const template = getTemplate(db, userId, templateName);
        if (!template) {
          return { error: `Template "${templateName}" not found` };
        }
        const rendered = renderTemplate(template.body, templateVars, template.subject);
        body = rendered.body;
        subject = rendered.subject ?? subject;
      }

      if (!body) {
        return { error: 'Message body is required (either directly or via template)' };
      }

      const message = await sendMessage(db, {
        userId,
        platform,
        orderId,
        recipient,
        subject,
        body,
      });

      return {
        success: true,
        message: {
          id: message.id,
          orderId: message.orderId,
          platform: message.platform,
          direction: message.direction,
          subject: message.subject,
          bodyPreview: body.length > 100 ? body.slice(0, 100) + '...' : body,
        },
        note: 'Message stored locally. Platform-specific delivery requires API integration.',
      };
    }

    case 'manage_templates': {
      const action = input.action as string;

      switch (action) {
        case 'list': {
          const templates = listTemplates(db, userId);
          return {
            templates: templates.map((t) => ({
              id: t.id,
              name: t.name,
              subject: t.subject,
              variables: t.variables,
              isBuiltIn: t.id.startsWith('builtin_'),
              createdAt: t.createdAt > 0 ? new Date(t.createdAt).toISOString() : 'built-in',
            })),
            count: templates.length,
          };
        }

        case 'create': {
          const name = input.name as string;
          const tSubject = (input.subject as string) ?? null;
          const tBody = input.body as string;

          if (!name) return { error: 'Template name is required' };
          if (!tBody) return { error: 'Template body is required' };

          const variables = extractVariables(tBody);
          const template = createTemplate(db, {
            userId,
            name,
            subject: tSubject,
            body: tBody,
            variables,
          });

          return {
            success: true,
            template: {
              id: template.id,
              name: template.name,
              subject: template.subject,
              variables: template.variables,
            },
            message: `Template "${name}" created with ${variables.length} variable(s)`,
          };
        }

        case 'delete': {
          const templateId = input.template_id as string;
          if (!templateId) return { error: 'template_id is required' };

          if (templateId.startsWith('builtin_')) {
            return { error: 'Cannot delete built-in templates' };
          }

          const deleted = deleteTemplate(db, templateId);
          return deleted
            ? { success: true, message: `Template ${templateId} deleted` }
            : { error: `Template ${templateId} not found or is built-in` };
        }

        case 'preview': {
          const templateIdOrName = (input.template_id as string) ?? (input.name as string);
          if (!templateIdOrName) return { error: 'template_id or name is required for preview' };

          const template = getTemplate(db, userId, templateIdOrName);
          if (!template) return { error: `Template "${templateIdOrName}" not found` };

          const vars = (input.variables as Record<string, string>) ?? {};
          const rendered = renderTemplate(template.body, vars, template.subject);

          return {
            template: template.name,
            subject: rendered.subject,
            body: rendered.body,
            unresolvedVariables: extractVariables(rendered.body),
          };
        }

        default:
          return { error: `Unknown action: ${action}` };
      }
    }

    case 'setup_auto_responder': {
      const enabled = input.enabled !== false;
      const rules = (input.rules as Array<{ keywords: string[]; template: string; delay_minutes?: number }>) ?? [];

      if (!enabled && rules.length === 0) {
        // Just disable
        setupAutoResponder(db, userId, false, []);
        return { success: true, message: 'Auto-responder disabled' };
      }

      const createdRules = setupAutoResponder(db, userId, enabled, rules);

      // Also list existing rules
      const allRules = getAutoResponderRules(db, userId);

      return {
        success: true,
        enabled,
        newRules: createdRules.length,
        totalRules: allRules.length,
        rules: allRules.map((r) => ({
          id: r.id,
          keywords: r.keywords,
          templateName: r.templateName,
          delayMinutes: r.delayMinutes,
          enabled: r.enabled,
        })),
      };
    }

    default:
      return { error: `Unknown messaging tool: ${toolName}` };
  }
}
