/**
 * Messaging Types - Buyer/seller communication types
 */

// =============================================================================
// MESSAGE TYPES
// =============================================================================

export type MessageDirection = 'inbound' | 'outbound';

export interface Message {
  id: string;
  userId: string;
  platform: string | null;
  orderId: string | null;
  direction: MessageDirection;
  sender: string | null;
  recipient: string | null;
  subject: string | null;
  body: string;
  read: boolean;
  createdAt: number;
}

// =============================================================================
// TEMPLATE TYPES
// =============================================================================

export interface MessageTemplate {
  id: string;
  userId: string;
  name: string;
  subject: string | null;
  body: string;
  variables: string[];
  createdAt: number;
}

// =============================================================================
// AUTO-RESPONDER TYPES
// =============================================================================

export interface AutoResponderRule {
  id: string;
  userId: string;
  keywords: string[];
  templateId: string | null;
  templateName: string | null;
  delayMinutes: number;
  enabled: boolean;
  createdAt: number;
}

// =============================================================================
// QUERY OPTIONS
// =============================================================================

export interface ListMessagesOptions {
  platform?: string;
  unreadOnly?: boolean;
  orderId?: string;
  direction?: MessageDirection;
  limit?: number;
  offset?: number;
}
