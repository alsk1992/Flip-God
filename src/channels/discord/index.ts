/**
 * Discord Channel Adapter
 *
 * Uses raw Discord REST API + Gateway WebSocket (no discord.js dependency).
 * Implements the ChannelAdapter interface from base-adapter.ts.
 *
 * Features:
 * - Gateway WebSocket connection with heartbeat, identify, resume
 * - Message chunking for >2000 char messages
 * - Slash command registration (/scan, /compare, /orders, /help)
 * - Guild (server) filtering via allowedGuildIds
 * - Edit and delete message support
 * - Automatic reconnection with resume
 */

import { randomUUID } from 'crypto';
import { WebSocket } from 'ws';
import { createLogger } from '../../utils/logger';
import {
  BaseAdapter,
  chunkMessage,
  type IncomingMessage,
  type SendMessageOptions,
} from '../base-adapter';

const logger = createLogger('discord');

// =============================================================================
// TYPES
// =============================================================================

export interface DiscordConfig {
  token: string;
  allowedGuildIds?: string[];
  applicationId?: string;
}

// Gateway opcodes
const enum GatewayOpcode {
  Dispatch = 0,
  Heartbeat = 1,
  Identify = 2,
  PresenceUpdate = 3,
  Resume = 6,
  Reconnect = 7,
  InvalidSession = 9,
  Hello = 10,
  HeartbeatAck = 11,
}

// Gateway intents (bitfield)
const INTENTS = {
  GUILDS: 1 << 0,
  GUILD_MESSAGES: 1 << 9,
  GUILD_MESSAGE_REACTIONS: 1 << 10,
  DIRECT_MESSAGES: 1 << 12,
  MESSAGE_CONTENT: 1 << 15,
};

interface GatewayPayload {
  op: number;
  d: unknown;
  s?: number | null;
  t?: string | null;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  author: {
    id: string;
    username: string;
    discriminator: string;
    bot?: boolean;
    global_name?: string;
  };
  content: string;
  timestamp: string;
  message_reference?: {
    message_id?: string;
    channel_id?: string;
    guild_id?: string;
  };
  type: number;
}

interface DiscordInteraction {
  id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id: string;
  member?: {
    user: {
      id: string;
      username: string;
      global_name?: string;
    };
  };
  user?: {
    id: string;
    username: string;
    global_name?: string;
  };
  data?: {
    name: string;
    options?: Array<{
      name: string;
      type: number;
      value: string | number | boolean;
    }>;
  };
}

interface GatewayBotResponse {
  url: string;
  shards: number;
  session_start_limit: {
    total: number;
    remaining: number;
    reset_after: number;
  };
}

// =============================================================================
// CONSTANTS
// =============================================================================

const DISCORD_API_BASE = 'https://discord.com/api/v10';
const MAX_MESSAGE_LENGTH = 2000;
const RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_ATTEMPTS = 10;

// Slash commands to register
const SLASH_COMMANDS = [
  {
    name: 'scan',
    description: 'Scan for products across platforms',
    options: [
      {
        name: 'query',
        description: 'Product search query',
        type: 3, // STRING
        required: true,
      },
      {
        name: 'platform',
        description: 'Platform to scan',
        type: 3, // STRING
        choices: [
          { name: 'Amazon', value: 'amazon' },
          { name: 'eBay', value: 'ebay' },
          { name: 'Walmart', value: 'walmart' },
          { name: 'AliExpress', value: 'aliexpress' },
        ],
      },
    ],
  },
  {
    name: 'compare',
    description: 'Compare prices across all platforms',
    options: [
      {
        name: 'query',
        description: 'Product to compare',
        type: 3, // STRING
        required: true,
      },
    ],
  },
  {
    name: 'orders',
    description: 'Check current order statuses',
    options: [
      {
        name: 'status',
        description: 'Filter by status',
        type: 3, // STRING
        choices: [
          { name: 'Pending', value: 'pending' },
          { name: 'Shipped', value: 'shipped' },
          { name: 'Delivered', value: 'delivered' },
        ],
      },
    ],
  },
  {
    name: 'help',
    description: 'Show FlipGod help and available commands',
  },
];

// =============================================================================
// DISCORD ADAPTER
// =============================================================================

class DiscordAdapter extends BaseAdapter {
  private token: string;
  private applicationId: string;
  private allowedGuildIds: Set<string> | null;
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatAcked: boolean = true;
  private sequenceNumber: number | null = null;
  private sessionId: string | null = null;
  private resumeGatewayUrl: string | null = null;
  private reconnectAttempts: number = 0;
  private botUserId: string | null = null;

  constructor(config: DiscordConfig) {
    super('discord');
    this.token = config.token;
    this.applicationId = config.applicationId ?? '';
    this.allowedGuildIds = config.allowedGuildIds
      ? new Set(config.allowedGuildIds)
      : null;
  }

  // ---- BaseAdapter abstract implementations ----

  protected async doStart(): Promise<void> {
    // Get gateway URL
    const gatewayInfo = await this.apiRequest<GatewayBotResponse>('GET', '/gateway/bot');
    if (!gatewayInfo) {
      throw new Error('Failed to get Discord gateway URL');
    }

    logger.info(
      { url: gatewayInfo.url, remaining: gatewayInfo.session_start_limit.remaining },
      'Discord gateway info',
    );

    // Connect to gateway
    await this.connectGateway(gatewayInfo.url);

    // Register slash commands if applicationId is set
    if (this.applicationId) {
      await this.registerSlashCommands();
    }
  }

  protected async doStop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.close(1000, 'Bot shutting down');
      } catch {
        // ignore
      }
      this.ws = null;
    }

    this.sessionId = null;
    this.sequenceNumber = null;
  }

  protected async doSend(
    chatId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<string | null> {
    // Handle edit mode
    if (options?.edit && options.messageId) {
      const success = await this.doEdit(chatId, options.messageId, text);
      return success ? options.messageId : null;
    }

    // Chunk long messages
    const chunks = chunkMessage(text, MAX_MESSAGE_LENGTH);
    let lastMessageId: string | null = null;

    for (const chunk of chunks) {
      const body: Record<string, unknown> = {
        content: chunk,
      };

      if (options?.replyTo) {
        body.message_reference = { message_id: options.replyTo };
      }

      const result = await this.apiRequest<{ id: string }>(
        'POST',
        `/channels/${chatId}/messages`,
        body,
      );

      if (result) {
        lastMessageId = result.id;
      }
    }

    return lastMessageId;
  }

  protected isReady(): boolean {
    return this._started && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // ---- Edit and delete ----

  protected async doEdit(chatId: string, messageId: string, text: string): Promise<boolean> {
    const result = await this.apiRequest(
      'PATCH',
      `/channels/${chatId}/messages/${messageId}`,
      { content: text.slice(0, MAX_MESSAGE_LENGTH) },
    );
    return result !== null;
  }

  protected async doDelete(chatId: string, messageId: string): Promise<boolean> {
    const result = await this.apiRequest(
      'DELETE',
      `/channels/${chatId}/messages/${messageId}`,
    );
    return result !== null;
  }

  // ---- Gateway WebSocket ----

  private connectGateway(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const gatewayUrl = `${url}?v=10&encoding=json`;
      this.ws = new WebSocket(gatewayUrl);

      let resolved = false;

      this.ws.on('open', () => {
        logger.info('Discord gateway WebSocket connected');
      });

      this.ws.on('message', (data: Buffer) => {
        let payload: GatewayPayload;
        try {
          payload = JSON.parse(data.toString('utf-8')) as GatewayPayload;
        } catch {
          logger.warn('Failed to parse gateway payload');
          return;
        }

        this.handleGatewayPayload(payload);

        // Resolve once we get READY dispatch
        if (!resolved && payload.op === GatewayOpcode.Dispatch && payload.t === 'READY') {
          resolved = true;
          resolve();
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        logger.warn(
          { code, reason: reason.toString('utf-8') },
          'Discord gateway closed',
        );

        if (this.heartbeatTimer) {
          clearInterval(this.heartbeatTimer);
          this.heartbeatTimer = null;
        }

        if (!resolved) {
          resolved = true;
          reject(new Error(`Gateway closed during connect: ${code}`));
          return;
        }

        // Auto-reconnect
        if (this._started) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err: Error) => {
        logger.error({ err }, 'Discord gateway error');
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });
    });
  }

  private handleGatewayPayload(payload: GatewayPayload): void {
    // Update sequence number
    if (payload.s !== null && payload.s !== undefined) {
      this.sequenceNumber = payload.s;
    }

    switch (payload.op) {
      case GatewayOpcode.Hello:
        this.handleHello(payload.d as { heartbeat_interval: number });
        break;

      case GatewayOpcode.HeartbeatAck:
        this.heartbeatAcked = true;
        break;

      case GatewayOpcode.Heartbeat:
        // Server is requesting an immediate heartbeat
        this.sendHeartbeat();
        break;

      case GatewayOpcode.Reconnect:
        logger.info('Gateway requested reconnect');
        this.ws?.close(4000, 'Reconnect requested');
        break;

      case GatewayOpcode.InvalidSession:
        logger.warn('Invalid session, re-identifying');
        // d is a boolean indicating whether we can resume
        const canResume = payload.d as boolean;
        if (!canResume) {
          this.sessionId = null;
          this.sequenceNumber = null;
        }
        setTimeout(() => this.identify(), 1000 + Math.random() * 4000);
        break;

      case GatewayOpcode.Dispatch:
        this.handleDispatch(payload.t!, payload.d);
        break;
    }
  }

  private handleHello(data: { heartbeat_interval: number }): void {
    // Start heartbeat
    const interval = data.heartbeat_interval;
    logger.debug({ interval }, 'Starting heartbeat');

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatAcked = true;
    this.heartbeatTimer = setInterval(() => {
      if (!this.heartbeatAcked) {
        logger.warn('Heartbeat not acknowledged, reconnecting');
        this.ws?.close(4000, 'Heartbeat timeout');
        return;
      }
      this.heartbeatAcked = false;
      this.sendHeartbeat();
    }, interval);

    // Send initial heartbeat with jitter
    setTimeout(() => this.sendHeartbeat(), Math.floor(interval * Math.random()));

    // Identify or resume
    if (this.sessionId && this.sequenceNumber !== null) {
      this.resume();
    } else {
      this.identify();
    }
  }

  private sendHeartbeat(): void {
    this.sendGateway({
      op: GatewayOpcode.Heartbeat,
      d: this.sequenceNumber,
    });
  }

  private identify(): void {
    const intents =
      INTENTS.GUILDS |
      INTENTS.GUILD_MESSAGES |
      INTENTS.DIRECT_MESSAGES |
      INTENTS.MESSAGE_CONTENT;

    this.sendGateway({
      op: GatewayOpcode.Identify,
      d: {
        token: this.token,
        intents,
        properties: {
          os: process.platform,
          browser: 'flipagent',
          device: 'flipagent',
        },
      },
    });
  }

  private resume(): void {
    logger.info('Resuming gateway session');
    this.sendGateway({
      op: GatewayOpcode.Resume,
      d: {
        token: this.token,
        session_id: this.sessionId,
        seq: this.sequenceNumber,
      },
    });
  }

  private sendGateway(payload: { op: number; d: unknown; s?: number | null; t?: string | null }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (err) {
      logger.error({ err }, 'Failed to send gateway payload');
    }
  }

  private handleDispatch(eventName: string, data: unknown): void {
    switch (eventName) {
      case 'READY': {
        const ready = data as {
          session_id: string;
          resume_gateway_url: string;
          user: { id: string; username: string };
        };
        this.sessionId = ready.session_id;
        this.resumeGatewayUrl = ready.resume_gateway_url;
        this.botUserId = ready.user.id;
        this.reconnectAttempts = 0;
        logger.info(
          { sessionId: this.sessionId, username: ready.user.username },
          'Discord bot ready',
        );
        break;
      }

      case 'RESUMED':
        this.reconnectAttempts = 0;
        logger.info('Discord gateway resumed');
        break;

      case 'MESSAGE_CREATE':
        this.handleMessageCreate(data as DiscordMessage);
        break;

      case 'INTERACTION_CREATE':
        this.handleInteractionCreate(data as DiscordInteraction);
        break;
    }
  }

  private handleMessageCreate(msg: DiscordMessage): void {
    // Ignore bot messages (including our own)
    if (msg.author.bot) return;

    // Filter by allowed guild IDs
    if (msg.guild_id && this.allowedGuildIds && !this.allowedGuildIds.has(msg.guild_id)) {
      return;
    }

    // Skip messages that don't mention the bot or aren't DMs
    const isDM = !msg.guild_id;
    const mentionsBot = this.botUserId
      ? msg.content.includes(`<@${this.botUserId}>`) || msg.content.includes(`<@!${this.botUserId}>`)
      : false;

    if (!isDM && !mentionsBot) return;

    // Strip bot mention from content
    let text = msg.content;
    if (this.botUserId) {
      text = text
        .replace(new RegExp(`<@!?${this.botUserId}>`, 'g'), '')
        .trim();
    }

    if (!text) return;

    const incoming: IncomingMessage = {
      id: msg.id,
      platform: 'discord',
      chatId: msg.channel_id,
      chatType: isDM ? 'dm' : 'group',
      userId: msg.author.id,
      username: msg.author.username,
      displayName: msg.author.global_name ?? msg.author.username,
      text,
      replyToMessageId: msg.message_reference?.message_id,
      timestamp: new Date(msg.timestamp),
    };

    this.handleIncoming(incoming);
  }

  private async handleInteractionCreate(interaction: DiscordInteraction): Promise<void> {
    // Only handle application commands (type 2)
    if (interaction.type !== 2 || !interaction.data) return;

    const user = interaction.member?.user ?? interaction.user;
    if (!user) return;

    // Build text from slash command
    const commandName = interaction.data.name;
    const args = (interaction.data.options ?? [])
      .map((opt) => `${opt.name}:${opt.value}`)
      .join(' ');
    const text = `/${commandName}${args ? ' ' + args : ''}`;

    // ACK the interaction with deferred response
    await this.apiRequest('POST', `/interactions/${interaction.id}/${interaction.token}/callback`, {
      type: 5, // DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE
    });

    const incoming: IncomingMessage = {
      id: interaction.id,
      platform: 'discord',
      chatId: interaction.channel_id,
      chatType: interaction.guild_id ? 'group' : 'dm',
      userId: user.id,
      username: user.username,
      displayName: user.global_name ?? user.username,
      text,
      timestamp: new Date(),
    };

    this.handleIncoming(incoming);
  }

  // ---- Reconnection ----

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      logger.error('Max Discord reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1);

    logger.info(
      { attempt: this.reconnectAttempts, delay },
      'Scheduling Discord reconnect',
    );

    setTimeout(async () => {
      if (!this._started) return;

      try {
        const url = this.resumeGatewayUrl ?? `wss://gateway.discord.gg`;
        await this.connectGateway(url);
        logger.info('Discord reconnected');
      } catch (err) {
        logger.error({ err }, 'Discord reconnect failed');
        this.scheduleReconnect();
      }
    }, delay);
  }

  // ---- Slash command registration ----

  private async registerSlashCommands(): Promise<void> {
    if (!this.applicationId) {
      logger.warn('No applicationId set, skipping slash command registration');
      return;
    }

    try {
      await this.apiRequest(
        'PUT',
        `/applications/${this.applicationId}/commands`,
        SLASH_COMMANDS,
      );
      logger.info(
        { commands: SLASH_COMMANDS.map((c) => c.name) },
        'Slash commands registered',
      );
    } catch (err) {
      logger.error({ err }, 'Failed to register slash commands');
    }
  }

  // ---- REST API helper ----

  private async apiRequest<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    const url = `${DISCORD_API_BASE}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bot ${this.token}`,
    };

    const options: RequestInit = { method, headers };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    try {
      const res = await fetch(url, options);

      // Handle rate limiting
      if (res.status === 429) {
        const retryAfter = parseFloat(res.headers.get('retry-after') ?? '1');
        logger.warn({ retryAfter, path }, 'Discord rate limited');
        await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
        return this.apiRequest<T>(method, path, body);
      }

      // 204 No Content (e.g., delete operations)
      if (res.status === 204) {
        return {} as T;
      }

      if (!res.ok) {
        const text = await res.text();
        logger.error(
          { status: res.status, path, body: text },
          'Discord API error',
        );
        return null;
      }

      return (await res.json()) as T;
    } catch (err) {
      logger.error({ err, method, path }, 'Discord API request failed');
      return null;
    }
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a Discord channel adapter.
 *
 * @param config - Bot token, optional guild filter, and application ID for slash commands
 * @returns ChannelAdapter implementation for Discord
 */
export function createDiscordAdapter(config: DiscordConfig): DiscordAdapter {
  return new DiscordAdapter(config);
}
