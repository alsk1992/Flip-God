/**
 * Commands Module - Slash command handling for FlipAgent
 *
 * Re-exports the command registry and default commands.
 * Supports:
 * - Native commands (/scan, /compare, /list, /orders, /track, /profit, /help, /settings, /credentials)
 * - Per-command enable/disable
 * - Per-channel command overrides
 * - Platform-level registration (e.g., Telegram setMyCommands)
 */

export {
  createCommandRegistry,
  createDefaultCommands,
  COMMAND_CATEGORIES,
} from './registry';

export type {
  CommandRegistry,
  CommandContext,
  CommandDefinition,
  CommandInfo,
  CommandListEntry,
} from './registry';
