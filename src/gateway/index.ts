/**
 * Gateway - Orchestrates all FlipAgent services
 */

import { createLogger } from '../utils/logger';
import { createServer } from './server';
import { createDatabase, initDatabase } from '../db';
import { createSessionManager } from '../sessions';
import { createAgentManager } from '../agents';
import { createChannelManager } from '../channels';
import { createCredentialsManager } from '../credentials';
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

  // 5. Create channel manager
  const channelManager = await createChannelManager(config.channels, {
    onMessage: async (message: IncomingMessage) => {
      const session = await sessionManager.getOrCreateSession(message);
      const response = await agentManager.handleMessage(message, session);
      if (response) {
        await channelManager.send({
          platform: message.platform,
          chatId: message.chatId,
          text: response,
        });
      }
    },
  });
  logger.info('Channel manager initialized');

  // 6. Create HTTP + WebSocket server
  const httpServer = createServer(
    {
      port: config.gateway.port,
      authToken: process.env.FLIPAGENT_TOKEN,
    },
    {
      onChatConnection: channelManager.getChatConnectionHandler() || undefined,
      db,
    },
  );

  // 7. Attach WebSocket to channel manager
  channelManager.attachWebSocket(httpServer.wss);

  let started = false;

  return {
    async start() {
      if (started) return;
      await httpServer.start();
      await channelManager.start();
      started = true;
      logger.info({ port: config.gateway.port }, 'FlipAgent gateway started');
    },

    async stop() {
      if (!started) return;
      logger.info('Shutting down FlipAgent gateway...');
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
