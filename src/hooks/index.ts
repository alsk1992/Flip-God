/**
 * Hooks System - Event lifecycle hooks with priority-based execution
 *
 * Features:
 * - Register hooks for events (message, tool, session, gateway, error)
 * - Hook priorities (higher runs first)
 * - Sequential execution for modifying hooks
 * - Hook handlers can return { cancel: true } to stop processing
 * - Typed hook events and contexts
 */

import { createLogger } from '../utils/logger';
import type { IncomingMessage, OutgoingMessage, Session } from '../types';

const logger = createLogger('hooks');

// =============================================================================
// HOOK EVENT TYPES
// =============================================================================

export type HookEvent =
  // Message lifecycle
  | 'message:before'       // Before processing incoming message (can modify/cancel)
  | 'message:after'        // After processing incoming message
  // Tool lifecycle
  | 'tool:before'          // Before tool execution (can modify/block)
  | 'tool:after'           // After tool execution
  // Session lifecycle
  | 'session:start'        // Session created
  | 'session:end'          // Session ended
  | 'session:reset'        // Session was reset
  // Gateway lifecycle
  | 'gateway:start'        // Gateway started
  | 'gateway:stop'         // Gateway stopping
  // Error
  | 'error';               // Error occurred

// =============================================================================
// HOOK CONTEXT TYPES
// =============================================================================

export interface HookContext {
  event: HookEvent;
  message?: IncomingMessage;
  response?: OutgoingMessage;
  session?: Session;
  error?: Error;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: unknown;
  /** Set to true by a hook handler to stop further processing */
  cancelled?: boolean;
  /** Reason for cancellation */
  cancelledReason?: string;
  /** Custom data passed between hooks in the same emit chain */
  data: Record<string, unknown>;
}

export interface HookResult {
  /** Set to true to cancel/stop further processing */
  cancel?: boolean;
  /** Reason for cancellation */
  reason?: string;
  /** Modified message content (for message:before) */
  modifiedText?: string;
  /** Modified tool params (for tool:before) */
  modifiedParams?: Record<string, unknown>;
  /** Whether to block tool execution (for tool:before) */
  blocked?: boolean;
}

// =============================================================================
// HOOK TYPES
// =============================================================================

export type HookHandler = (ctx: HookContext) => Promise<HookResult | void> | HookResult | void;

export interface RegisteredHook {
  id: string;
  name: string;
  event: HookEvent;
  priority: number;
  handler: HookHandler;
  enabled: boolean;
}

// =============================================================================
// EXECUTION MODES BY EVENT
// =============================================================================

/** Events that run sequentially (can modify context) vs parallel (fire-and-forget) */
const SEQUENTIAL_EVENTS = new Set<HookEvent>([
  'message:before' as const,
  'tool:before' as const,
]);

// =============================================================================
// HOOK MANAGER
// =============================================================================

export class HookManager {
  private hooks = new Map<string, RegisteredHook>();
  private idCounter = 0;

  constructor() {
    logger.info('Hook manager initialized');
  }

  /**
   * Register a hook for an event
   */
  register(
    event: HookEvent,
    name: string,
    priority: number,
    handler: HookHandler,
  ): string {
    const id = `hook_${++this.idCounter}`;

    const hook: RegisteredHook = {
      id,
      name,
      event,
      priority,
      handler,
      enabled: true,
    };

    this.hooks.set(id, hook);
    logger.debug({ id, event, name, priority }, 'Hook registered');
    return id;
  }

  /**
   * Unregister a hook by event + name
   */
  unregister(event: HookEvent, name: string): boolean {
    const entries = Array.from(this.hooks.entries());
    for (const [id, hook] of entries) {
      if (hook.event === event && hook.name === name) {
        this.hooks.delete(id);
        logger.debug({ id, event, name }, 'Hook unregistered');
        return true;
      }
    }
    return false;
  }

  /**
   * Unregister a hook by ID
   */
  unregisterById(id: string): boolean {
    const existed = this.hooks.delete(id);
    if (existed) {
      logger.debug({ id }, 'Hook unregistered by ID');
    }
    return existed;
  }

  /**
   * Enable or disable a hook by ID
   */
  setEnabled(id: string, enabled: boolean): boolean {
    const hook = this.hooks.get(id);
    if (!hook) return false;
    hook.enabled = enabled;
    logger.debug({ id, enabled }, 'Hook enabled state changed');
    return true;
  }

  /**
   * Emit an event, running all matching hooks in priority order.
   * Returns the (potentially modified) context.
   *
   * For sequential events (message:before, tool:before):
   *   - Hooks run one at a time in priority order (highest first)
   *   - A hook returning { cancel: true } stops further hooks and marks ctx.cancelled
   *
   * For parallel events (everything else):
   *   - All hooks run concurrently (errors are logged, not thrown)
   */
  async emit(event: HookEvent, ctx: Partial<HookContext> = {}): Promise<HookContext> {
    const fullCtx: HookContext = {
      event,
      data: {},
      ...ctx,
    };

    const matching = this.getMatchingHooks(event);

    if (matching.length === 0) {
      return fullCtx;
    }

    const isSequential = SEQUENTIAL_EVENTS.has(event);

    if (isSequential) {
      for (const hook of matching) {
        if (fullCtx.cancelled) break;
        try {
          const result = await hook.handler(fullCtx);
          if (result) {
            if (result.cancel) {
              fullCtx.cancelled = true;
              fullCtx.cancelledReason = result.reason ?? hook.name;
              logger.debug({ hookId: hook.id, hookName: hook.name, event }, 'Hook cancelled processing');
              break;
            }
            if (result.modifiedText !== undefined && fullCtx.message) {
              fullCtx.message = { ...fullCtx.message, text: result.modifiedText };
            }
            if (result.modifiedParams !== undefined) {
              fullCtx.toolParams = result.modifiedParams;
            }
            if (result.blocked && event === 'tool:before') {
              fullCtx.cancelled = true;
              fullCtx.cancelledReason = result.reason ?? `Blocked by ${hook.name}`;
              break;
            }
          }
        } catch (error) {
          logger.error({ hookId: hook.id, hookName: hook.name, event, error }, 'Hook error');
        }
      }
    } else {
      // Parallel execution - fire and forget, log errors
      await Promise.all(
        matching.map(async (hook) => {
          try {
            await hook.handler(fullCtx);
          } catch (error) {
            logger.error({ hookId: hook.id, hookName: hook.name, event, error }, 'Hook error');
          }
        }),
      );
    }

    return fullCtx;
  }

  /**
   * List all registered hooks
   */
  list(): RegisteredHook[] {
    return Array.from(this.hooks.values());
  }

  /**
   * List hooks for a specific event
   */
  listForEvent(event: HookEvent): RegisteredHook[] {
    return this.getMatchingHooks(event);
  }

  /**
   * Get a hook by ID
   */
  get(id: string): RegisteredHook | undefined {
    return this.hooks.get(id);
  }

  /**
   * Clear all hooks
   */
  clear(): void {
    this.hooks.clear();
    logger.info('All hooks cleared');
  }

  /**
   * Get matching hooks for an event, sorted by priority (highest first)
   */
  private getMatchingHooks(event: HookEvent): RegisteredHook[] {
    return Array.from(this.hooks.values())
      .filter((h) => h.event === event && h.enabled)
      .sort((a, b) => b.priority - a.priority);
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

export const hooks = new HookManager();
