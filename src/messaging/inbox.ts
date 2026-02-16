/**
 * Messaging Inbox - Manage buyer/seller messages across platforms
 *
 * Stores messages locally. Platform-specific message fetching can be added
 * via platform API integrations.
 */

import { createLogger } from '../utils/logger.js';
import { generateId } from '../utils/id.js';
import type { Database } from '../db/index.js';
import type { Message, ListMessagesOptions, MessageDirection } from './types.js';

const logger = createLogger('messaging-inbox');

// =============================================================================
// MESSAGE CRUD
// =============================================================================

/**
 * Store a new message in the local message store.
 */
export function createMessage(
  db: Database,
  message: Omit<Message, 'id' | 'createdAt' | 'read'>,
): Message {
  const fullMessage: Message = {
    id: generateId('msg'),
    read: false,
    createdAt: Date.now(),
    ...message,
  };

  db.run(
    `INSERT INTO messages (id, user_id, platform, order_id, direction, sender, recipient, subject, body, read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fullMessage.id,
      fullMessage.userId,
      fullMessage.platform ?? null,
      fullMessage.orderId ?? null,
      fullMessage.direction,
      fullMessage.sender ?? null,
      fullMessage.recipient ?? null,
      fullMessage.subject ?? null,
      fullMessage.body,
      fullMessage.read ? 1 : 0,
      fullMessage.createdAt,
    ],
  );

  logger.info({ messageId: fullMessage.id, direction: fullMessage.direction }, 'Message stored');
  return fullMessage;
}

/**
 * List messages with filtering options.
 */
export function listMessages(db: Database, userId: string, options: ListMessagesOptions = {}): Message[] {
  const {
    platform,
    unreadOnly = false,
    orderId,
    direction,
    limit = 20,
    offset = 0,
  } = options;

  const conditions: string[] = ['user_id = ?'];
  const params: unknown[] = [userId];

  if (platform) {
    conditions.push('platform = ?');
    params.push(platform);
  }
  if (unreadOnly) {
    conditions.push('read = 0');
  }
  if (orderId) {
    conditions.push('order_id = ?');
    params.push(orderId);
  }
  if (direction) {
    conditions.push('direction = ?');
    params.push(direction);
  }

  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 20, 200));
  const safeOffset = Math.max(0, Number.isFinite(offset) ? offset : 0);
  params.push(safeLimit, safeOffset);

  const rows = db.query<Record<string, unknown>>(
    `SELECT id, user_id, platform, order_id, direction, sender, recipient, subject, body, read, created_at
     FROM messages
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    params,
  );

  return rows.map(parseMessageRow);
}

/**
 * Get a single message by ID.
 */
export function getMessage(db: Database, messageId: string): Message | undefined {
  const rows = db.query<Record<string, unknown>>(
    'SELECT id, user_id, platform, order_id, direction, sender, recipient, subject, body, read, created_at FROM messages WHERE id = ?',
    [messageId],
  );
  if (rows.length === 0) return undefined;
  return parseMessageRow(rows[0]);
}

/**
 * Mark a message as read.
 */
export function markMessageRead(db: Database, messageId: string): void {
  db.run('UPDATE messages SET read = 1 WHERE id = ?', [messageId]);
}

/**
 * Mark all messages as read for a user.
 */
export function markAllMessagesRead(db: Database, userId: string): void {
  db.run('UPDATE messages SET read = 1 WHERE user_id = ? AND read = 0', [userId]);
}

/**
 * Get unread message count for a user.
 */
export function getUnreadCount(db: Database, userId: string): number {
  const rows = db.query<Record<string, unknown>>(
    'SELECT COUNT(*) as cnt FROM messages WHERE user_id = ? AND read = 0',
    [userId],
  );
  const count = rows[0]?.cnt as number;
  return Number.isFinite(count) ? count : 0;
}

// =============================================================================
// PLATFORM MESSAGE FETCHING (PLACEHOLDER)
// =============================================================================

/**
 * Fetch messages from a platform API.
 *
 * This is a placeholder that stores messages locally. Platform-specific
 * implementations (eBay member messages, etc.) require OAuth user tokens
 * and should be implemented per-platform.
 */
export async function fetchMessages(
  db: Database,
  platform: string,
  _credentials: Record<string, unknown>,
  userId: string,
): Promise<{ messages: Message[]; fetched: number }> {
  // Platform-specific fetching would go here.
  // For now, we just return what's already in the local store.
  logger.info({ platform, userId }, 'Message fetch requested (using local store)');

  const messages = listMessages(db, userId, { platform, limit: 50 });
  return { messages, fetched: 0 };
}

/**
 * Send a message to a buyer via platform API (placeholder).
 *
 * Currently stores the outbound message locally. Platform-specific
 * sending requires OAuth integration.
 */
export async function sendMessage(
  db: Database,
  params: {
    userId: string;
    platform?: string;
    orderId?: string;
    recipient?: string;
    subject?: string;
    body: string;
  },
): Promise<Message> {
  const message = createMessage(db, {
    userId: params.userId,
    platform: params.platform ?? null,
    orderId: params.orderId ?? null,
    direction: 'outbound' as MessageDirection,
    sender: params.userId,
    recipient: params.recipient ?? null,
    subject: params.subject ?? null,
    body: params.body,
  });

  logger.info(
    { messageId: message.id, orderId: params.orderId, platform: params.platform },
    'Outbound message stored',
  );

  return message;
}

// =============================================================================
// ROW PARSER
// =============================================================================

function parseMessageRow(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    platform: (row.platform as string) ?? null,
    orderId: (row.order_id as string) ?? null,
    direction: (row.direction as MessageDirection) ?? 'inbound',
    sender: (row.sender as string) ?? null,
    recipient: (row.recipient as string) ?? null,
    subject: (row.subject as string) ?? null,
    body: row.body as string,
    read: Boolean(row.read),
    createdAt: row.created_at as number,
  };
}
