/**
 * Unified message formatting and normalization.
 *
 * Normalizes incoming/outgoing messages and applies platform-specific
 * markdown formatting for dispatch.
 */

import { formatForPlatform, strip } from '../markdown';
import type { IncomingMessage, MessageAttachment, OutgoingMessage } from '../types';

function normalizeAttachments(
  attachments?: MessageAttachment[]
): MessageAttachment[] | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  const cleaned = attachments.filter((attachment) => Boolean(attachment));
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Normalize an incoming message: trim text, clean attachments.
 */
export function normalizeIncomingMessage(message: IncomingMessage): IncomingMessage {
  const text = typeof message.text === 'string' ? message.text.trim() : '';
  const attachments = normalizeAttachments(message.attachments);

  return {
    ...message,
    text,
    attachments,
  };
}

/**
 * Normalize an outgoing message: ensure text is a string, clean attachments.
 */
export function normalizeOutgoingMessage(message: OutgoingMessage): OutgoingMessage {
  const text = typeof message.text === 'string' ? message.text : '';
  const attachments = normalizeAttachments(message.attachments);

  return {
    ...message,
    text,
    attachments,
  };
}

/**
 * Format an outgoing message with platform-specific markdown.
 *
 * Applies the correct markdown converter based on the target platform:
 * - telegram: MarkdownV2
 * - slack: mrkdwn
 * - whatsapp: WhatsApp formatting
 * - discord: Standard markdown (pass-through)
 * - webchat/plain: Strip all markdown
 */
export function formatOutgoingMessage(message: OutgoingMessage): OutgoingMessage {
  const normalized = normalizeOutgoingMessage(message);
  const platform = normalized.platform;

  let text = normalized.text;

  switch (platform) {
    case 'telegram':
      text = formatForPlatform(text, 'telegram');
      return { ...normalized, text };
    case 'slack':
      text = formatForPlatform(text, 'slack');
      return { ...normalized, text };
    case 'whatsapp':
      text = formatForPlatform(text, 'whatsapp');
      return { ...normalized, text };
    case 'discord':
      text = formatForPlatform(text, 'discord');
      return { ...normalized, text };
    case 'webchat':
      text = strip(text);
      return { ...normalized, text };
    case 'plain':
      text = strip(text);
      return { ...normalized, text };
    default:
      return normalized;
  }
}
