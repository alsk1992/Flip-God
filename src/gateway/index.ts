/**
 * Gateway - Orchestrates all FlipAgent services
 *
 * Initializes: DB, credentials, sessions, agent, channels, hooks, cron, queue, HTTP server.
 */

import { createLogger } from '../utils/logger';
import { createServer } from './server';
import { createDatabase, initDatabase } from '../db';
import { createSessionManager } from '../sessions';
import { createAgentManager } from '../agents';
import { createChannelManager } from '../channels';
import { createCredentialsManager } from '../credentials';
import { hooks } from '../hooks';
import { CronScheduler, registerBuiltInJobs } from '../cron';
import { MessageQueue } from '../queue';
import { setupShutdownHandlers } from '../utils/production';
import type { Config, IncomingMessage, OutgoingMessage } from '../types';
import type { Database } from '../db';

const logger = createLogger('gateway');

export interface Gateway {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createGateway(config: Config): Promise<Gateway> {
  logger.info('Initializing FlipAgent gateway...');

  // 1. Initialize database
  const db = await createDatabase();
  initDatabase(db);
  logger.info('Database initialized');

  // 2. Create credentials manager
  const credentials = createCredentialsManager(db);

  // 3. Create session manager
  const sessionManager = createSessionManager(db, config.session);
  logger.info('Session manager initialized');

  // 4. Create agent manager
  const agentManager = createAgentManager({
    config,
    db,
    sessionManager,
    credentials,
  });
  logger.info('Agent manager initialized');

  // 5. Create message queue
  const queue = new MessageQueue({
    mode: 'debounce',
    debounceMs: 1500,
    maxBatchSize: 5,
  });

  // 6. Create channel manager
  const channelManager = await createChannelManager(config.channels, {
    onMessage: async (message: IncomingMessage) => {
      // Emit message:before hook (can cancel or modify)
      const hookCtx = await hooks.emit('message:before', { message });
      if (hookCtx.cancelled) return;
      const processedMessage = hookCtx.message?.text
        ? { ...message, text: hookCtx.message.text as string }
        : message;

      const session = await sessionManager.getOrCreateSession(processedMessage);
      const response = await agentManager.handleMessage(processedMessage, session);
      if (response) {
        await channelManager.send({
          platform: processedMessage.platform,
          chatId: processedMessage.chatId,
          text: response,
        });

        // Emit message:after hook
        await hooks.emit('message:after', {
          message: { text: processedMessage.text } as any,
          response: { text: response } as any,
        });
      }
    },
  });
  queue.setHandler(async (messages) => {
    // Process batched messages — use the last one's metadata, concatenate text
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    const combined: IncomingMessage = {
      ...last,
      text: messages.map(m => m.text).join('\n\n'),
    };
    const session = await sessionManager.getOrCreateSession(combined);
    const response = await agentManager.handleMessage(combined, session);
    if (response) {
      await channelManager.send({
        platform: combined.platform,
        chatId: combined.chatId,
        text: response,
      });
    }
  });
  logger.info('Channel manager initialized');

  // 7. Create cron scheduler with built-in jobs
  const cron = new CronScheduler();
  registerBuiltInJobs(cron, {
    scanPrices: async () => { logger.info('Cron: scan_prices tick'); },
    checkOrders: async () => { logger.info('Cron: check_orders tick'); },
    repriceCheck: async () => { logger.info('Cron: reprice_check tick'); },
    inventorySync: async () => { logger.info('Cron: inventory_sync tick'); },
    sessionCleanup: async () => { /* session cleanup runs on its own interval */ },
    dbBackup: async () => { db.save(); },
  });
  logger.info('Cron scheduler initialized');

  // 8. Create HTTP + WebSocket server
  const httpServer = createServer(
    {
      port: config.gateway.port,
      authToken: process.env.FLIPAGENT_TOKEN,
      cors: { origins: true },
      rateLimitPerMinute: parseInt(process.env.FLIPAGENT_IP_RATE_LIMIT ?? '100', 10) || 100,
      hstsEnabled: process.env.FLIPAGENT_HSTS_ENABLED === 'true',
      forceHttps: process.env.FLIPAGENT_FORCE_HTTPS === 'true',
    },
    {
      onChatConnection: channelManager.getChatConnectionHandler() || undefined,
      db,
    },
  );

  // 9. Attach WebSocket to channel manager
  channelManager.attachWebSocket(httpServer.wss);

  let started = false;

  return {
    async start() {
      if (started) return;
      await httpServer.start();
      await channelManager.start();
      cron.start();

      // Emit gateway:start hook
      await hooks.emit('gateway:start');

      started = true;
      logger.info({ port: config.gateway.port }, 'FlipAgent gateway started');
    },

    async stop() {
      if (!started) return;
      logger.info('Shutting down FlipAgent gateway...');

      // Emit gateway:stop hook
      await hooks.emit('gateway:stop');

      cron.stop();
      queue.dispose();
      await channelManager.stop();
      await httpServer.stop();
      db.close();
      sessionManager.dispose();
      agentManager.dispose();
      started = false;
      logger.info('FlipAgent gateway stopped');
    },
  };
}
