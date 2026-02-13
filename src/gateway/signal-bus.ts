/**
 * Signal Bus -- Typed event hub with error isolation.
 *
 * A generic EventEmitter-based event bus that safely distributes events
 * to all registered consumers. A single listener throwing never takes
 * down the others.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../utils/logger';

const logger = createLogger('signal-bus');

// =============================================================================
// TYPES
// =============================================================================

/** Generic event payload */
export interface BusEvent {
  type: string;
  timestamp: number;
  source?: string;
  data?: unknown;
}

/** Signal bus interface */
export interface SignalBus extends EventEmitter {
  /** Subscribe to a named event with error isolation */
  onEvent(event: string, handler: (payload: BusEvent) => void): void;

  /** Emit a typed event to all listeners (error-isolated) */
  emitEvent(event: string, payload: Omit<BusEvent, 'type' | 'timestamp'>): boolean;

  /** Get list of active event names */
  activeEvents(): string[];

  /** Remove all listeners and clean up */
  destroy(): void;
}

// =============================================================================
// FACTORY
// =============================================================================

export function createSignalBus(): SignalBus {
  const bus = new EventEmitter() as SignalBus;
  bus.setMaxListeners(50); // plenty of room for all consumers

  // Override emit so ALL events get error isolation.
  // One listener throwing never kills the rest.
  const originalEmit = bus.emit.bind(bus);
  bus.emit = (event: string | symbol, ...args: unknown[]): boolean => {
    if (typeof event !== 'string') return originalEmit(event, ...args);
    // Snapshot the raw listeners array so removals during iteration are safe.
    // rawListeners() returns once-wrappers as objects with a `.listener` prop.
    const listeners = bus.rawListeners(event).slice();
    for (const raw of listeners) {
      try {
        // Detect .once() wrappers: Node stores them with a `listener` property
        // holding the original handler. We must remove the wrapper *before*
        // invoking so that .once() semantics are honoured (fire-and-forget).
        const fn = raw as ((...a: unknown[]) => void) & { listener?: (...a: unknown[]) => void };
        if (typeof fn.listener === 'function') {
          bus.removeListener(event, fn as (...a: unknown[]) => void);
          fn.listener(...args);
        } else {
          fn(...args);
        }
      } catch (error) {
        logger.error({ error, event }, 'Signal bus listener error -- isolated');
      }
    }
    return listeners.length > 0;
  };

  bus.onEvent = (event: string, handler: (payload: BusEvent) => void) => {
    bus.on(event, handler);
  };

  bus.emitEvent = (event: string, payload: Omit<BusEvent, 'type' | 'timestamp'>): boolean => {
    const fullPayload: BusEvent = {
      type: event,
      timestamp: Date.now(),
      ...payload,
    };
    return bus.emit(event, fullPayload);
  };

  bus.activeEvents = (): string[] => {
    return bus.eventNames().filter((e): e is string => typeof e === 'string');
  };

  bus.destroy = () => {
    bus.removeAllListeners();
    logger.info('Signal bus destroyed');
  };

  return bus;
}
