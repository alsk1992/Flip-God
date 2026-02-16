/**
 * Message Templates - Reusable templates for buyer communication
 *
 * Built-in templates for common scenarios + user-defined custom templates.
 * Variable substitution: {{variable_name}} replaced with provided values.
 */

import { createLogger } from '../utils/logger.js';
import { generateId } from '../utils/id.js';
import type { Database } from '../db/index.js';
import type { MessageTemplate } from './types.js';

const logger = createLogger('message-templates');

// =============================================================================
// BUILT-IN TEMPLATES
// =============================================================================

const BUILT_IN_TEMPLATES: Array<Omit<MessageTemplate, 'id' | 'userId' | 'createdAt'>> = [
  {
    name: 'shipping_notification',
    subject: 'Your order {{order_id}} has shipped!',
    body: `Hi {{buyer_name}},

Great news! Your order {{order_id}} has been shipped.

Tracking Number: {{tracking_number}}
Carrier: {{carrier}}
Estimated Delivery: {{estimated_delivery}}

You can track your package using the tracking number above.

Thank you for your purchase!

Best regards,
{{seller_name}}`,
    variables: ['buyer_name', 'order_id', 'tracking_number', 'carrier', 'estimated_delivery', 'seller_name'],
  },
  {
    name: 'feedback_request',
    subject: 'How was your purchase? Order {{order_id}}',
    body: `Hi {{buyer_name}},

I hope you're enjoying your recent purchase (Order {{order_id}}).

If you have a moment, I'd really appreciate it if you could leave a review. Your feedback helps other buyers and helps me improve my service.

If there are any issues with your order, please don't hesitate to reach out - I'm happy to help resolve any concerns.

Thank you for your business!

Best regards,
{{seller_name}}`,
    variables: ['buyer_name', 'order_id', 'seller_name'],
  },
  {
    name: 'order_confirmation',
    subject: 'Order confirmed - {{order_id}}',
    body: `Hi {{buyer_name}},

Thank you for your order! Here are the details:

Order ID: {{order_id}}
Item: {{product_title}}
Price: {{price}}

I'll process your order shortly and provide tracking information once it ships.

If you have any questions, feel free to reach out.

Best regards,
{{seller_name}}`,
    variables: ['buyer_name', 'order_id', 'product_title', 'price', 'seller_name'],
  },
  {
    name: 'return_instructions',
    subject: 'Return instructions for order {{order_id}}',
    body: `Hi {{buyer_name}},

I'm sorry to hear you'd like to return your item from order {{order_id}}.

Here are the return instructions:

1. Please pack the item securely in its original packaging if possible.
2. Ship the item to:
   {{return_address}}
3. Please use a trackable shipping method.
4. Once I receive and inspect the item, I'll process your refund within {{refund_days}} business days.

Return Reason: {{return_reason}}

If you have any questions about the return process, please let me know.

Best regards,
{{seller_name}}`,
    variables: ['buyer_name', 'order_id', 'return_address', 'refund_days', 'return_reason', 'seller_name'],
  },
  {
    name: 'out_of_stock_apology',
    subject: 'Important update about your order {{order_id}}',
    body: `Hi {{buyer_name}},

I apologize for the inconvenience, but the item you ordered (Order {{order_id}}) is currently out of stock.

I have a few options for you:
1. I can issue a full refund immediately.
2. I can hold your order and ship it when the item becomes available (estimated {{restock_date}}).
3. I can suggest a similar alternative product.

Please let me know which option you'd prefer, and I'll take care of it right away.

Again, I sincerely apologize for the inconvenience.

Best regards,
{{seller_name}}`,
    variables: ['buyer_name', 'order_id', 'restock_date', 'seller_name'],
  },
];

// =============================================================================
// TEMPLATE CRUD
// =============================================================================

/**
 * Get all built-in template definitions (not stored in DB).
 */
export function getBuiltInTemplates(): Array<Omit<MessageTemplate, 'id' | 'userId' | 'createdAt'>> {
  return [...BUILT_IN_TEMPLATES];
}

/**
 * List all templates (built-in + user-created).
 */
export function listTemplates(db: Database, userId: string): MessageTemplate[] {
  const builtIn: MessageTemplate[] = BUILT_IN_TEMPLATES.map((t, i) => ({
    id: `builtin_${i}`,
    userId: 'system',
    createdAt: 0,
    ...t,
  }));

  const customRows = db.query<Record<string, unknown>>(
    'SELECT * FROM message_templates WHERE user_id = ? ORDER BY created_at DESC',
    [userId],
  );
  const custom = customRows.map(parseTemplateRow);

  return [...custom, ...builtIn];
}

/**
 * Get a single template by ID or name.
 */
export function getTemplate(db: Database, userId: string, idOrName: string): MessageTemplate | undefined {
  // Check built-in first
  const builtInIdx = BUILT_IN_TEMPLATES.findIndex((t) => t.name === idOrName);
  if (builtInIdx >= 0) {
    const t = BUILT_IN_TEMPLATES[builtInIdx];
    return {
      id: `builtin_${builtInIdx}`,
      userId: 'system',
      createdAt: 0,
      ...t,
    };
  }

  // Check by ID
  const byId = db.query<Record<string, unknown>>(
    'SELECT * FROM message_templates WHERE id = ?',
    [idOrName],
  );
  if (byId.length > 0) return parseTemplateRow(byId[0]);

  // Check by name
  const byName = db.query<Record<string, unknown>>(
    'SELECT * FROM message_templates WHERE user_id = ? AND name = ? LIMIT 1',
    [userId, idOrName],
  );
  if (byName.length > 0) return parseTemplateRow(byName[0]);

  return undefined;
}

/**
 * Create a custom message template.
 */
export function createTemplate(
  db: Database,
  template: Omit<MessageTemplate, 'id' | 'createdAt'>,
): MessageTemplate {
  const fullTemplate: MessageTemplate = {
    id: generateId('tmpl'),
    createdAt: Date.now(),
    ...template,
  };

  db.run(
    `INSERT INTO message_templates (id, user_id, name, subject, body, variables, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      fullTemplate.id,
      fullTemplate.userId,
      fullTemplate.name,
      fullTemplate.subject ?? null,
      fullTemplate.body,
      JSON.stringify(fullTemplate.variables),
      fullTemplate.createdAt,
    ],
  );

  logger.info({ templateId: fullTemplate.id, name: fullTemplate.name }, 'Template created');
  return fullTemplate;
}

/**
 * Delete a custom template.
 */
export function deleteTemplate(db: Database, templateId: string): boolean {
  // Don't allow deleting built-in templates
  if (templateId.startsWith('builtin_')) {
    return false;
  }
  db.run('DELETE FROM message_templates WHERE id = ?', [templateId]);
  return true;
}

// =============================================================================
// TEMPLATE RENDERING
// =============================================================================

/**
 * Render a template by substituting {{variable}} placeholders with values.
 */
export function renderTemplate(
  templateBody: string,
  variables: Record<string, string>,
  templateSubject?: string | null,
): { subject: string | null; body: string } {
  let body = templateBody;
  let subject = templateSubject ?? null;

  for (const [key, value] of Object.entries(variables)) {
    const safeValue = String(value);
    const pattern = new RegExp(`\\{\\{\\s*${escapeRegex(key)}\\s*\\}\\}`, 'g');
    body = body.replace(pattern, safeValue);
    if (subject) {
      subject = subject.replace(pattern, safeValue);
    }
  }

  // Remove any remaining unresolved variables (replace with empty string)
  const unresolvedPattern = /\{\{\s*\w+\s*\}\}/g;
  body = body.replace(unresolvedPattern, '');
  if (subject) {
    subject = subject.replace(unresolvedPattern, '');
  }

  return { subject, body };
}

/**
 * Extract variable names from a template body.
 */
export function extractVariables(templateBody: string): string[] {
  const matches = templateBody.match(/\{\{\s*(\w+)\s*\}\}/g);
  if (!matches) return [];

  const vars = new Set<string>();
  for (const match of matches) {
    const varName = match.replace(/\{\{\s*/, '').replace(/\s*\}\}/, '');
    vars.add(varName);
  }
  return Array.from(vars);
}

// =============================================================================
// HELPERS
// =============================================================================

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseTemplateRow(row: Record<string, unknown>): MessageTemplate {
  let variables: string[] = [];
  try {
    const parsed = JSON.parse((row.variables as string) ?? '[]');
    variables = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    variables = [];
  }

  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    subject: (row.subject as string) ?? null,
    body: row.body as string,
    variables,
    createdAt: row.created_at as number,
  };
}
