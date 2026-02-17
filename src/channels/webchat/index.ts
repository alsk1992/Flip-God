/**
 * WebSocket-based WebChat channel for FlipGod
 *
 * Provides real-time bidirectional messaging via WebSocket.
 * Simplified from Clodds -- single channel, no streaming drafts.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { createLogger } from '../../utils/logger';
import type { IncomingMessage, OutgoingMessage } from '../../types';

const logger = createLogger('webchat');

// =============================================================================
// Types
// =============================================================================

export interface WebChatConfig {
  enabled: boolean;
  authToken?: string;
}

export interface WebChatCallbacks {
  onMessage: (message: IncomingMessage) => Promise<void>;
}

export interface WebChatChannel {
  start(wss: WebSocketServer): void;
  stop(): void;
  sendMessage(msg: OutgoingMessage): Promise<string | null>;
  isConnected?: (message?: OutgoingMessage) => boolean;
  getConnectedUsers(): string[];
  getConnectionHandler(): ((ws: WebSocket, req: import('http').IncomingMessage) => void) | null;
}

interface ChatSession {
  id: string;
  ws: WebSocket;
  userId: string;
  authenticated: boolean;
  lastActivity: number;
}

// =============================================================================
// Constants
// =============================================================================

const HEARTBEAT_INTERVAL_MS = 30_000;
const STALE_TIMEOUT_MS = 90_000;
const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB

// =============================================================================
// Protocol message types (server -> client)
// =============================================================================

interface ConnectedMessage {
  type: 'connected';
  sessionId: string;
  message: string;
}

interface AuthenticatedMessage {
  type: 'authenticated';
  userId: string;
}

interface AuthErrorMessage {
  type: 'auth_error';
  message: string;
}

interface OutboundChatMessage {
  type: 'message';
  id: string;
  text: string;
  timestamp: string;
}

interface ErrorMessage {
  type: 'error';
  message: string;
}

interface PongMessage {
  type: 'pong';
}

type ServerMessage =
  | ConnectedMessage
  | AuthenticatedMessage
  | AuthErrorMessage
  | OutboundChatMessage
  | ErrorMessage
  | PongMessage;

// =============================================================================
// Protocol message types (client -> server)
// =============================================================================

interface AuthRequest {
  type: 'auth';
  token?: string;
  userId?: string;
}

interface ChatRequest {
  type: 'message';
  text: string;
  attachments?: Array<{
    type: 'image' | 'file' | 'audio' | 'video';
    url?: string;
    mimeType?: string;
    filename?: string;
  }>;
}

interface PingRequest {
  type: 'ping';
}

type ClientMessage = AuthRequest | ChatRequest | PingRequest;

// =============================================================================
// Factory
// =============================================================================

export function createWebChatChannel(
  config: WebChatConfig,
  callbacks: WebChatCallbacks,
): WebChatChannel {
  const chatSessions = new Map<string, ChatSession>();
  const userSockets = new Map<string, Set<string>>();
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let wss: WebSocketServer | null = null;
  let connectionHandler: ((ws: WebSocket, req: import('http').IncomingMessage) => void) | null = null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      logger.error({ err }, 'Failed to send WebSocket message');
    }
  }

  function addUserSocket(userId: string, sessionId: string): void {
    let set = userSockets.get(userId);
    if (!set) {
      set = new Set();
      userSockets.set(userId, set);
    }
    set.add(sessionId);
  }

  function removeUserSocket(userId: string, sessionId: string): void {
    const set = userSockets.get(userId);
    if (!set) return;
    set.delete(sessionId);
    if (set.size === 0) {
      userSockets.delete(userId);
    }
  }

  function cleanupSession(sessionId: string): void {
    const session = chatSessions.get(sessionId);
    if (!session) return;

    removeUserSocket(session.userId, sessionId);
    chatSessions.delete(sessionId);

    logger.debug({ sessionId, userId: session.userId }, 'Session cleaned up');
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  function handleAuth(session: ChatSession, msg: AuthRequest): void {
    // If auth token is configured, validate it
    if (config.authToken) {
      if (!msg.token || msg.token !== config.authToken) {
        send(session.ws, {
          type: 'auth_error',
          message: 'Invalid authentication token',
        });
        logger.warn({ sessionId: session.id }, 'Auth failed: invalid token');
        return;
      }
    }

    // Set userId from the auth message, or keep the auto-generated one
    if (msg.userId) {
      // Remove old userId mapping
      removeUserSocket(session.userId, session.id);
      session.userId = msg.userId;
    }

    session.authenticated = true;
    addUserSocket(session.userId, session.id);

    send(session.ws, {
      type: 'authenticated',
      userId: session.userId,
    });

    logger.info(
      { sessionId: session.id, userId: session.userId },
      'Client authenticated',
    );
  }

  // ---------------------------------------------------------------------------
  // Message handling
  // ---------------------------------------------------------------------------

  function handleChatMessage(session: ChatSession, msg: ChatRequest): void {
    if (!session.authenticated) {
      send(session.ws, {
        type: 'error',
        message: 'Not authenticated. Send { type: "auth" } first.',
      });
      return;
    }

    const text = typeof msg.text === 'string' ? msg.text.trim() : '';
    if (!text) {
      send(session.ws, {
        type: 'error',
        message: 'Empty message text',
      });
      return;
    }

    session.lastActivity = Date.now();

    // Normalize to IncomingMessage
    const incoming: IncomingMessage = {
      id: randomUUID(),
      platform: 'webchat',
      chatId: session.userId, // In webchat, chatId = userId (DM)
      chatType: 'dm',
      userId: session.userId,
      text,
      timestamp: new Date(),
      attachments: msg.attachments?.map((a) => ({
        type: a.type,
        url: a.url,
        mimeType: a.mimeType,
        filename: a.filename,
      })),
    };

    // Dispatch to callback (async, don't block the WebSocket)
    callbacks.onMessage(incoming).catch((err) => {
      logger.error(
        { err, sessionId: session.id },
        'Error handling webchat message',
      );
      send(session.ws, {
        type: 'error',
        message: 'Internal error processing message',
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Connection handler
  // ---------------------------------------------------------------------------

  function handleConnection(ws: WebSocket, _req: import('http').IncomingMessage): void {
    const sessionId = randomUUID();
    const userId = `webchat_${sessionId.slice(0, 8)}`;

    const session: ChatSession = {
      id: sessionId,
      ws,
      userId,
      authenticated: !config.authToken, // Auto-auth if no token configured
      lastActivity: Date.now(),
    };

    // Handle connection replacement (same sessionId -- shouldn't happen with UUIDs,
    // but guard against it)
    const existing = chatSessions.get(sessionId);
    if (existing) {
      logger.warn({ sessionId }, 'Replacing existing connection');
      try {
        existing.ws.close(1000, 'Replaced by new connection');
      } catch {
        // ignore close errors
      }
      cleanupSession(sessionId);
    }

    chatSessions.set(sessionId, session);

    if (session.authenticated) {
      addUserSocket(session.userId, sessionId);
    }

    logger.info(
      { sessionId, userId, authenticated: session.authenticated },
      'WebChat client connected',
    );

    // Send connected message
    send(ws, {
      type: 'connected',
      sessionId,
      message: '[FG] Connected — 185 tools, 18 platforms',
    });

    // Message handler
    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      let raw: string;
      try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
        if (buf.length > MAX_MESSAGE_SIZE) {
          send(ws, {
            type: 'error',
            message: `Message too large (max ${MAX_MESSAGE_SIZE} bytes)`,
          });
          return;
        }
        raw = buf.toString('utf-8');
      } catch {
        send(ws, { type: 'error', message: 'Invalid message encoding' });
        return;
      }

      let parsed: ClientMessage;
      try {
        parsed = JSON.parse(raw) as ClientMessage;
      } catch {
        send(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      if (!parsed || typeof parsed !== 'object' || !parsed.type) {
        send(ws, { type: 'error', message: 'Missing message type' });
        return;
      }

      session.lastActivity = Date.now();

      switch (parsed.type) {
        case 'auth':
          handleAuth(session, parsed as AuthRequest);
          break;
        case 'message':
          handleChatMessage(session, parsed as ChatRequest);
          break;
        case 'ping':
          send(ws, { type: 'pong' });
          break;
        default:
          send(ws, {
            type: 'error',
            message: `Unknown message type: ${(parsed as { type: string }).type}`,
          });
      }
    });

    // Close handler
    ws.on('close', (code: number, reason: Buffer) => {
      logger.info(
        { sessionId, code, reason: reason.toString('utf-8') },
        'WebChat client disconnected',
      );
      cleanupSession(sessionId);
    });

    // Error handler
    ws.on('error', (err: Error) => {
      logger.error({ err, sessionId }, 'WebSocket error');
      cleanupSession(sessionId);
    });
  }

  // ---------------------------------------------------------------------------
  // Heartbeat
  // ---------------------------------------------------------------------------

  function startHeartbeat(): void {
    if (heartbeatInterval) return;

    heartbeatInterval = setInterval(() => {
      const now = Date.now();

      for (const [sessionId, session] of chatSessions) {
        // Close stale connections
        if (now - session.lastActivity > STALE_TIMEOUT_MS) {
          logger.info({ sessionId }, 'Closing stale WebChat connection');
          try {
            session.ws.close(1000, 'Connection timed out');
          } catch {
            // ignore
          }
          cleanupSession(sessionId);
          continue;
        }

        // Send ping to active connections
        if (session.ws.readyState === WebSocket.OPEN) {
          try {
            session.ws.ping();
          } catch {
            // ignore
          }
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat(): void {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  connectionHandler = handleConnection;

  return {
    start(webSocketServer: WebSocketServer): void {
      wss = webSocketServer;
      wss.on('connection', handleConnection);
      startHeartbeat();
      logger.info('WebChat channel started');
    },

    stop(): void {
      stopHeartbeat();

      // Close all sessions
      for (const [sessionId, session] of chatSessions) {
        try {
          session.ws.close(1000, 'Server shutting down');
        } catch {
          // ignore
        }
        cleanupSession(sessionId);
      }

      chatSessions.clear();
      userSockets.clear();

      if (wss) {
        wss.removeListener('connection', handleConnection);
        wss = null;
      }

      logger.info('WebChat channel stopped');
    },

    async sendMessage(msg: OutgoingMessage): Promise<string | null> {
      const targetUserId = msg.chatId;
      const sessionIds = userSockets.get(targetUserId);

      if (!sessionIds || sessionIds.size === 0) {
        logger.debug(
          { chatId: targetUserId },
          'No connected sessions for user',
        );
        return null;
      }

      const messageId = randomUUID();
      const outbound: OutboundChatMessage = {
        type: 'message',
        id: messageId,
        text: msg.text,
        timestamp: new Date().toISOString(),
      };

      let sent = false;
      for (const sessionId of sessionIds) {
        const session = chatSessions.get(sessionId);
        if (session && session.ws.readyState === WebSocket.OPEN) {
          send(session.ws, outbound);
          sent = true;
        }
      }

      return sent ? messageId : null;
    },

    isConnected(message?: OutgoingMessage): boolean {
      if (!message) {
        return chatSessions.size > 0;
      }
      const sessionIds = userSockets.get(message.chatId);
      if (!sessionIds || sessionIds.size === 0) return false;
      for (const sessionId of sessionIds) {
        const session = chatSessions.get(sessionId);
        if (session && session.ws.readyState === WebSocket.OPEN) {
          return true;
        }
      }
      return false;
    },

    getConnectedUsers(): string[] {
      return Array.from(userSockets.keys());
    },

    getConnectionHandler(): ((ws: WebSocket, req: import('http').IncomingMessage) => void) | null {
      return connectionHandler;
    },
  };
}
