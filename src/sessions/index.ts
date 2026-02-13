/**
 * Session Manager for FlipAgent
 *
 * Manages conversation sessions with:
 * - Configurable scopes (main, per-peer, per-channel-peer)
 * - Idle reset after configurable minutes
 * - Manual reset via /new or /reset
 * - Conversation history with extractive compaction (no LLM call)
 */

import type {
  Session,
  SessionContext,
  IncomingMessage,
  ConversationMessage,
  Config,
} from '../types';
import type { Database } from '../db';
import { createLogger } from '../utils/logger';

const logger = createLogger('sessions');

// =============================================================================
// Types
// =============================================================================

export type DmScope = 'main' | 'per-peer' | 'per-channel-peer';

export interface SessionConfig {
  dmScope: DmScope;
  reset: {
    mode: 'daily' | 'idle' | 'both' | 'manual';
    atHour: number;
    idleMinutes: number;
  };
  resetTriggers: string[];
  cleanup: {
    enabled: boolean;
    maxAgeDays: number;
    idleDays: number;
  };
}

export interface SessionManager {
  getOrCreateSession: (message: IncomingMessage) => Promise<Session>;
  getSession: (key: string) => Session | undefined;
  getSessionById: (id: string) => Session | undefined;
  updateSession: (session: Session) => void;
  deleteSession: (key: string) => void;
  addToHistory: (
    session: Session,
    role: 'user' | 'assistant',
    content: string,
  ) => void;
  getHistory: (session: Session) => ConversationMessage[];
  clearHistory: (session: Session) => void;
  reset: (sessionId: string) => void;
  saveCheckpoint: (session: Session, summary?: string) => void;
  restoreCheckpoint: (session: Session) => boolean;
  checkScheduledResets: () => void;
  getConfig: () => SessionConfig;
  dispose: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const MAX_LLM_CONTEXT = 20;
const KEEP_RECENT = 10;
const IDLE_CHECK_INTERVAL_MS = 60_000;
const CLEANUP_INTERVAL_MS = 3_600_000;
const AGENT_ID = 'agent';

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_SESSION_CONFIG: SessionConfig = {
  dmScope: 'per-channel-peer',
  reset: {
    mode: 'manual',
    atHour: 4,
    idleMinutes: 60,
  },
  resetTriggers: ['/new', '/reset'],
  cleanup: {
    enabled: true,
    maxAgeDays: 30,
    idleDays: 14,
  },
};

// =============================================================================
// Helpers
// =============================================================================

/**
 * Generate a session key based on scope.
 *
 * - main: one session per agent (all DMs share)
 * - per-peer: one session per userId
 * - per-channel-peer: one session per chatId + userId combo
 */
function generateSessionKey(
  message: IncomingMessage,
  scope: DmScope,
  agentId: string,
): string {
  const platform = message.platform;
  const chatType = message.chatType;

  switch (scope) {
    case 'main':
      return `${agentId}:main:${platform}:${chatType}`;
    case 'per-peer':
      return `${agentId}:peer:${platform}:${chatType}:${message.userId}`;
    case 'per-channel-peer':
    default:
      return `${agentId}:channel:${platform}:${chatType}:${message.chatId}:${message.userId}`;
  }
}

/**
 * Extract the first meaningful sentence from a string.
 * Returns up to the first period, question mark, exclamation mark, or newline,
 * trimmed to a reasonable length.
 */
function extractFirstSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';

  // Match up to the first sentence-ending punctuation or newline
  const match = trimmed.match(/^[^\n]*?[.!?](?:\s|$)/);
  if (match) {
    const sentence = match[0].trim();
    if (sentence.length > 10) return sentence;
  }

  // Fallback: first line, capped at 120 chars
  const firstLine = trimmed.split('\n')[0] ?? '';
  if (firstLine.length <= 120) return firstLine;
  return firstLine.slice(0, 117) + '...';
}

/**
 * Compact messages into a short extractive summary.
 * No LLM call -- just extracts first meaningful sentence from each message.
 */
function compactMessages(messages: ConversationMessage[]): string {
  const lines: string[] = [];

  for (const msg of messages) {
    const prefix = msg.role === 'user' ? 'User' : 'Assistant';
    const sentence = extractFirstSentence(msg.content);
    if (sentence) {
      lines.push(`${prefix}: ${sentence}`);
    }
  }

  return lines.join('\n');
}

/**
 * Create a fresh session context.
 */
function createSessionContext(): SessionContext {
  return {
    messageCount: 0,
    preferences: {},
    conversationHistory: [],
    contextSummary: undefined,
    checkpoint: undefined,
    checkpointRestoredAt: undefined,
  };
}

/**
 * Create a new session object.
 */
function createNewSession(
  key: string,
  message: IncomingMessage,
): Session {
  const now = new Date();
  const ctx = createSessionContext();
  return {
    id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    key,
    userId: message.userId,
    platform: message.platform,
    chatId: message.chatId,
    chatType: message.chatType,
    context: ctx,
    history: ctx.conversationHistory,
    lastActivity: now,
    createdAt: now,
    updatedAt: now,
  };
}

// =============================================================================
// Factory
// =============================================================================

export function createSessionManager(
  db: Database,
  configInput?: Config['session'],
): SessionManager {
  // Merge user config with defaults
  const config: SessionConfig = {
    dmScope: (configInput?.dmScope as DmScope) ?? DEFAULT_SESSION_CONFIG.dmScope,
    reset: {
      mode: (configInput?.reset?.mode as SessionConfig['reset']['mode']) ??
        DEFAULT_SESSION_CONFIG.reset.mode,
      atHour: configInput?.reset?.atHour ?? DEFAULT_SESSION_CONFIG.reset.atHour,
      idleMinutes:
        configInput?.reset?.idleMinutes ??
        DEFAULT_SESSION_CONFIG.reset.idleMinutes,
    },
    resetTriggers:
      configInput?.resetTriggers ?? DEFAULT_SESSION_CONFIG.resetTriggers,
    cleanup: {
      enabled: configInput?.cleanup?.enabled ?? DEFAULT_SESSION_CONFIG.cleanup.enabled,
      maxAgeDays:
        configInput?.cleanup?.maxAgeDays ??
        DEFAULT_SESSION_CONFIG.cleanup.maxAgeDays,
      idleDays:
        configInput?.cleanup?.idleDays ??
        DEFAULT_SESSION_CONFIG.cleanup.idleDays,
    },
  };

  // In-memory session store
  const sessions = new Map<string, Session>();

  // Index by session ID for fast lookups
  const sessionsById = new Map<string, Session>();

  // Prevent concurrent duplicate session creation
  const pendingCreates = new Map<string, Promise<Session>>();

  // Intervals
  let idleCheckInterval: ReturnType<typeof setInterval> | null = null;
  let cleanupInterval: ReturnType<typeof setInterval> | null = null;

  // ---------------------------------------------------------------------------
  // Persistence helpers (delegate to db module's typed methods)
  // ---------------------------------------------------------------------------

  function persistNewSession(session: Session): void {
    try {
      db.createSession(session);
    } catch (err) {
      logger.error({ err, sessionId: session.id }, 'Failed to create session in DB');
    }
  }

  function persistUpdatedSession(session: Session): void {
    try {
      db.updateSession(session);
    } catch (err) {
      logger.error({ err, sessionId: session.id }, 'Failed to update session in DB');
    }
  }

  function loadSessionFromDb(key: string): Session | undefined {
    try {
      const session = db.getSession(key);
      if (!session) return undefined;

      // Restore Date objects in conversation history (they come back as strings from JSON)
      for (const msg of session.history) {
        if (typeof msg.timestamp === 'string') {
          msg.timestamp = new Date(msg.timestamp);
        }
      }
      for (const msg of session.context.conversationHistory) {
        if (typeof msg.timestamp === 'string') {
          msg.timestamp = new Date(msg.timestamp);
        }
      }

      return session;
    } catch (err) {
      logger.error({ err, key }, 'Failed to load session from DB');
      return undefined;
    }
  }

  function deleteSessionFromDb(key: string): void {
    try {
      db.deleteSession(key);
    } catch (err) {
      logger.error({ err, key }, 'Failed to delete session from DB');
    }
  }

  // ---------------------------------------------------------------------------
  // Core session methods
  // ---------------------------------------------------------------------------

  async function getOrCreateSession(
    message: IncomingMessage,
  ): Promise<Session> {
    const key = generateSessionKey(message, config.dmScope, AGENT_ID);

    // Check in-memory first
    const existing = sessions.get(key);
    if (existing) {
      existing.lastActivity = new Date();
      existing.updatedAt = new Date();
      return existing;
    }

    // Check for pending creation (prevents duplicate concurrent creates)
    const pending = pendingCreates.get(key);
    if (pending) {
      return pending;
    }

    // Wrap creation in a promise to prevent races
    const createPromise = (async () => {
      try {
        // Try loading from DB
        const fromDb = loadSessionFromDb(key);
        if (fromDb) {
          fromDb.lastActivity = new Date();
          fromDb.updatedAt = new Date();
          sessions.set(key, fromDb);
          sessionsById.set(fromDb.id, fromDb);
          logger.info(
            { key, sessionId: fromDb.id },
            'Session restored from DB',
          );
          return fromDb;
        }

        // Create new session
        const session = createNewSession(key, message);
        sessions.set(key, session);
        sessionsById.set(session.id, session);
        persistNewSession(session);
        logger.info(
          { key, sessionId: session.id },
          'New session created',
        );
        return session;
      } finally {
        pendingCreates.delete(key);
      }
    })();

    pendingCreates.set(key, createPromise);
    return createPromise;
  }

  function getSession(key: string): Session | undefined {
    return sessions.get(key);
  }

  function getSessionById(id: string): Session | undefined {
    return sessionsById.get(id);
  }

  function updateSession(session: Session): void {
    session.updatedAt = new Date();
    sessions.set(session.key, session);
    sessionsById.set(session.id, session);
    persistUpdatedSession(session);
  }

  function deleteSession(key: string): void {
    const session = sessions.get(key);
    if (session) {
      sessionsById.delete(session.id);
    }
    sessions.delete(key);
    deleteSessionFromDb(key);
    logger.info({ key }, 'Session deleted');
  }

  // ---------------------------------------------------------------------------
  // History management
  // ---------------------------------------------------------------------------

  function addToHistory(
    session: Session,
    role: 'user' | 'assistant',
    content: string,
  ): void {
    const message: ConversationMessage = {
      role,
      content,
      timestamp: new Date(),
    };

    // Append to full history (session.history and session.context.conversationHistory
    // may be the same array reference from the DB, but we write to both to be safe)
    session.history.push(message);

    // If history and conversationHistory are different arrays, sync them
    if (session.context.conversationHistory !== session.history) {
      session.context.conversationHistory.push(message);
    }

    // Increment message count
    session.context.messageCount++;

    // Compact if over threshold
    if (session.context.conversationHistory.length > MAX_LLM_CONTEXT) {
      const allContext = session.context.conversationHistory;
      const overflow = allContext.length - KEEP_RECENT;

      // Extract summary from the messages being removed
      const toSummarize = allContext.slice(0, overflow);
      const summary = compactMessages(toSummarize);

      // Append summary to existing contextSummary
      if (session.context.contextSummary) {
        session.context.contextSummary =
          session.context.contextSummary + '\n' + summary;
      } else {
        session.context.contextSummary = summary;
      }

      // Keep only the most recent messages
      session.context.conversationHistory = allContext.slice(overflow);

      logger.debug(
        {
          sessionId: session.id,
          removed: overflow,
          kept: session.context.conversationHistory.length,
        },
        'Conversation history compacted',
      );
    }

    // Update timestamps
    session.lastActivity = new Date();
    session.updatedAt = new Date();

    // Persist
    persistUpdatedSession(session);
  }

  function getHistory(session: Session): ConversationMessage[] {
    return session.context.conversationHistory;
  }

  function clearHistory(session: Session): void {
    session.history = [];
    session.context.conversationHistory = [];
    session.context.contextSummary = undefined;
    session.context.messageCount = 0;
    session.updatedAt = new Date();
    persistUpdatedSession(session);
    logger.info({ sessionId: session.id }, 'Session history cleared');
  }

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  function resetSession(sessionId: string): void {
    const session = sessionsById.get(sessionId);
    if (!session) {
      logger.warn({ sessionId }, 'Cannot reset: session not found');
      return;
    }

    const ctx = createSessionContext();
    session.history = ctx.conversationHistory;
    session.context = ctx;
    session.updatedAt = new Date();
    persistUpdatedSession(session);
    logger.info({ sessionId }, 'Session reset');
  }

  // ---------------------------------------------------------------------------
  // Checkpoints
  // ---------------------------------------------------------------------------

  function saveCheckpoint(session: Session, summary?: string): void {
    session.context.checkpoint = {
      history: [...session.context.conversationHistory],
      savedAt: new Date(),
      summary,
    };
    session.updatedAt = new Date();
    persistUpdatedSession(session);
    logger.info({ sessionId: session.id }, 'Checkpoint saved');
  }

  function restoreCheckpoint(session: Session): boolean {
    const checkpoint = session.context.checkpoint;
    if (!checkpoint) {
      logger.warn({ sessionId: session.id }, 'No checkpoint to restore');
      return false;
    }

    session.context.conversationHistory = [...checkpoint.history];
    session.context.contextSummary = checkpoint.summary;
    session.context.checkpointRestoredAt = new Date();
    session.updatedAt = new Date();
    persistUpdatedSession(session);
    logger.info({ sessionId: session.id }, 'Checkpoint restored');
    return true;
  }

  // ---------------------------------------------------------------------------
  // Scheduled resets
  // ---------------------------------------------------------------------------

  function checkScheduledResets(): void {
    const now = new Date();

    for (const [key, session] of sessions) {
      const mode = config.reset.mode;

      // Idle reset
      if (mode === 'idle' || mode === 'both') {
        const idleMs = config.reset.idleMinutes * 60_000;
        const elapsed = now.getTime() - session.lastActivity.getTime();
        if (elapsed >= idleMs) {
          logger.info(
            { key, sessionId: session.id, idleMinutes: Math.round(elapsed / 60_000) },
            'Session idle reset triggered',
          );
          resetSession(session.id);
        }
      }

      // Daily reset
      if (mode === 'daily' || mode === 'both') {
        const lastReset = session.createdAt;
        const daysSinceReset =
          (now.getTime() - lastReset.getTime()) / (24 * 3_600_000);
        if (daysSinceReset >= 1 && now.getHours() === config.reset.atHour) {
          logger.info(
            { key, sessionId: session.id },
            'Session daily reset triggered',
          );
          resetSession(session.id);
          session.createdAt = new Date(); // Prevent re-triggering this hour
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup (removes stale sessions entirely)
  // ---------------------------------------------------------------------------

  function runCleanup(): void {
    if (!config.cleanup.enabled) return;

    const now = Date.now();
    const maxAgeMs = config.cleanup.maxAgeDays * 24 * 3_600_000;
    const idleMs = config.cleanup.idleDays * 24 * 3_600_000;
    let cleaned = 0;

    for (const [key, session] of sessions) {
      const age = now - session.createdAt.getTime();
      const idle = now - session.lastActivity.getTime();

      if (age >= maxAgeMs || idle >= idleMs) {
        sessionsById.delete(session.id);
        sessions.delete(key);
        deleteSessionFromDb(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned }, 'Stale sessions cleaned up');
    }
  }

  // ---------------------------------------------------------------------------
  // Start intervals
  // ---------------------------------------------------------------------------

  if (config.reset.mode === 'idle' || config.reset.mode === 'both') {
    idleCheckInterval = setInterval(checkScheduledResets, IDLE_CHECK_INTERVAL_MS);
  }

  if (config.cleanup.enabled) {
    cleanupInterval = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  }

  // ---------------------------------------------------------------------------
  // Dispose
  // ---------------------------------------------------------------------------

  function dispose(): void {
    if (idleCheckInterval) {
      clearInterval(idleCheckInterval);
      idleCheckInterval = null;
    }
    if (cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }

    // Persist all sessions before shutdown
    for (const session of sessions.values()) {
      persistUpdatedSession(session);
    }

    sessions.clear();
    sessionsById.clear();
    pendingCreates.clear();
    logger.info('Session manager disposed');
  }

  // ---------------------------------------------------------------------------
  // Return public interface
  // ---------------------------------------------------------------------------

  return {
    getOrCreateSession,
    getSession,
    getSessionById,
    updateSession,
    deleteSession,
    addToHistory,
    getHistory,
    clearHistory,
    reset: resetSession,
    saveCheckpoint,
    restoreCheckpoint,
    checkScheduledResets,
    getConfig: () => config,
    dispose,
  };
}
