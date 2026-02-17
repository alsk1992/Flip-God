/**
 * Gateway - Orchestrates all FlipAgent services
 *
 * Initializes: DB, credentials, sessions, agent, channels, hooks, cron, queue, HTTP server.
 * Also wires: monitoring (health, metrics, alerts), notification channels (Telegram, Discord).
 */

import { randomUUID } from 'crypto';
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
import { createJobQueue } from '../queue/job-queue';
import { createJobWorker } from '../queue/worker';
import { createRepricingEngine } from '../listing/repricer';
// setupShutdownHandlers handled in src/index.ts and cli/index.ts
import { scanForArbitrage } from '../arbitrage/scanner';
import { createOrderMonitor } from '../fulfillment/monitor';
import { createAmazonAdapter } from '../platforms/amazon/scraper';
import { createEbayAdapter } from '../platforms/ebay/scraper';
import { createWalmartAdapter } from '../platforms/walmart/scraper';
import { createAliExpressAdapter } from '../platforms/aliexpress/scraper';
import { createBestBuyAdapter } from '../platforms/bestbuy/scraper';
import { createTargetAdapter } from '../platforms/target/scraper';
import { createCostcoAdapter } from '../platforms/costco/scraper';
import { createHomeDepotAdapter } from '../platforms/homedepot/scraper';
import { createPoshmarkAdapter } from '../platforms/poshmark/scraper';
import { createMercariAdapter } from '../platforms/mercari/scraper';
import { createFacebookAdapter } from '../platforms/facebook/scraper';
import { createFaireAdapter } from '../platforms/faire/scraper';
import { createBStockAdapter } from '../platforms/bstock/scraper';
import { createBulqAdapter } from '../platforms/bulq/scraper';
import { createLiquidationAdapter } from '../platforms/liquidation/scraper';

// Monitoring
import {
  healthChecker as monitoringHealthChecker,
  createMemoryHealthCheck,
  createDatabaseHealthCheck,
} from '../monitoring/health';
import {
  registry as metricsRegistry,
  startMetricsCollection,
  stopMetricsCollection,
} from '../monitoring/metrics';
import {
  alertManager as monitoringAlertManager,
} from '../monitoring/alerts';

// Notification channels
import { createNotificationChannelManager } from '../channels/notifications';

// Premium client
import { initPremiumClient } from '../premium';

import type { Config, IncomingMessage, OutgoingMessage, Platform, AmazonCredentials, EbayCredentials, WalmartCredentials, AliExpressCredentials } from '../types';
import type { Database } from '../db';
import type { PlatformAdapter } from '../platforms/index';

const logger = createLogger('gateway');

export interface Gateway {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export async function createGateway(config: Config): Promise<Gateway> {
  logger.info('Initializing FlipAgent gateway...');

  // 1. Initialize database
  const db = await createDatabase();
  await initDatabase(db);
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
          message: processedMessage,
          response: { platform: processedMessage.platform, chatId: processedMessage.chatId, text: response },
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

  // 6b. Initialize notification channel manager
  const notificationManager = createNotificationChannelManager({
    telegram: process.env.FLIPAGENT_NOTIFY_TELEGRAM_TOKEN && process.env.FLIPAGENT_NOTIFY_TELEGRAM_CHAT
      ? { botToken: process.env.FLIPAGENT_NOTIFY_TELEGRAM_TOKEN, chatId: process.env.FLIPAGENT_NOTIFY_TELEGRAM_CHAT }
      : undefined,
    discord: process.env.FLIPAGENT_NOTIFY_DISCORD_WEBHOOK
      ? { webhookUrl: process.env.FLIPAGENT_NOTIFY_DISCORD_WEBHOOK }
      : undefined,
  });
  logger.info({ channels: notificationManager.getChannelNames() }, 'Notification channel manager initialized');

  // 6c. Initialize monitoring system
  // Register database health check
  monitoringHealthChecker.registerCheck(
    'database',
    createDatabaseHealthCheck('database', async () => {
      try { db.query('SELECT 1'); return true; } catch { return false; }
    }),
    { cacheMs: 10000, critical: true },
  );
  // Register memory health check (already registered with default, but re-register with custom thresholds)
  monitoringHealthChecker.registerCheck('memory', createMemoryHealthCheck(80, 95), { cacheMs: 5000, critical: false });

  // Start Prometheus-compatible system metrics collection (every 15s)
  startMetricsCollection(15000);

  // Create application-specific metrics
  const toolExecutionCount = metricsRegistry.createCounter({
    name: 'tool_executions_total',
    help: 'Total tool executions',
    labels: ['tool', 'status'],
  });
  const toolExecutionDuration = metricsRegistry.createHistogram({
    name: 'tool_execution_duration_ms',
    help: 'Tool execution duration in milliseconds',
    labels: ['tool'],
    buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  });
  const activeSessionsGauge = metricsRegistry.createGauge({
    name: 'active_sessions',
    help: 'Number of active sessions',
  });
  const opportunityDiscoveryRate = metricsRegistry.createCounter({
    name: 'opportunities_discovered_total',
    help: 'Total opportunities discovered',
    labels: ['buy_platform', 'sell_platform'],
  });

  logger.info('Monitoring system initialized');

  // 6c2. Initialize premium client (billing API)
  const premiumClient = initPremiumClient();
  if (premiumClient) {
    logger.info('Premium client initialized');
  }

  // 6d. Initialize job queue for bulk operations
  const jobQueueDeps = { db, queue: null as unknown as import('../queue/job-queue').JobQueue };
  const jobWorker = createJobWorker(jobQueueDeps);
  const jobQueue = createJobQueue(db, jobWorker);
  jobQueueDeps.queue = jobQueue;
  logger.info('Job queue initialized');

  // 6e. Initialize advanced repricing engine
  const repricingEngine = createRepricingEngine(db, {
    getListing: (listingId: string) => {
      const rows = db.query<Record<string, unknown>>(
        'SELECT * FROM listings WHERE id = ?',
        [listingId],
      );
      if (rows.length === 0) return undefined;
      const row = rows[0];
      return {
        id: row.id as string,
        opportunityId: (row.opportunity_id as string) ?? undefined,
        productId: row.product_id as string,
        platform: row.platform as Platform,
        platformListingId: (row.platform_listing_id as string) ?? undefined,
        title: (row.title as string) ?? undefined,
        price: row.price as number,
        sourcePlatform: row.source_platform as Platform,
        sourcePrice: row.source_price as number,
        status: (row.status as 'active' | 'paused' | 'sold' | 'expired') ?? 'active',
        createdAt: new Date(row.created_at as number),
        updatedAt: new Date(row.updated_at as number),
      };
    },
    getCompetitors: () => {
      // Default: no competitors (real implementation would scan platform adapters)
      return [];
    },
    onPriceChange: (result) => {
      logger.info(
        { listingId: result.listingId, oldPrice: result.oldPrice, newPrice: result.newPrice, reason: result.reason },
        'Repricing engine applied price change',
      );
    },
  });
  logger.info('Repricing engine initialized');

  // Helper: build platform adapters from stored credentials for a system user
  function buildAdapters(): Map<Platform, PlatformAdapter> {
    const adapters = new Map<Platform, PlatformAdapter>();
    const systemUser = 'system';

    const amz = credentials.getCredentials<AmazonCredentials>(systemUser, 'amazon');
    adapters.set('amazon', createAmazonAdapter(amz ?? undefined));

    const ebay = credentials.getCredentials<EbayCredentials>(systemUser, 'ebay');
    adapters.set('ebay', createEbayAdapter(ebay ?? undefined));

    const wmt = credentials.getCredentials<WalmartCredentials>(systemUser, 'walmart');
    adapters.set('walmart', createWalmartAdapter(wmt ?? undefined));

    const ali = credentials.getCredentials<AliExpressCredentials>(systemUser, 'aliexpress');
    adapters.set('aliexpress', createAliExpressAdapter(ali ?? undefined));

    // Scraper-only platforms (no credentials required)
    adapters.set('bestbuy', createBestBuyAdapter());
    adapters.set('target', createTargetAdapter());
    adapters.set('costco', createCostcoAdapter());
    adapters.set('homedepot', createHomeDepotAdapter());
    adapters.set('poshmark', createPoshmarkAdapter());
    adapters.set('mercari', createMercariAdapter());
    adapters.set('facebook', createFacebookAdapter());
    adapters.set('faire', createFaireAdapter());
    adapters.set('bstock', createBStockAdapter());
    adapters.set('bulq', createBulqAdapter());
    adapters.set('liquidation', createLiquidationAdapter());

    return adapters;
  }

  // Create order monitor for the checkOrders cron
  const ebayCreds = credentials.getCredentials<EbayCredentials>('system', 'ebay');
  const orderMonitor = createOrderMonitor(db, ebayCreds ? { ebay: ebayCreds } : undefined, premiumClient);

  // 7. Create cron scheduler with built-in jobs
  const cron = new CronScheduler();
  registerBuiltInJobs(cron, {
    scanPrices: async () => {
      logger.info('Cron: scan_prices tick');
      try {
        const adapters = buildAdapters();
        const opps = await scanForArbitrage(adapters, { minMarginPct: 15, maxResults: 50 }, premiumClient);
        for (const opp of opps) {
          const fullOpp = {
            id: randomUUID().slice(0, 12),
            productId: opp.productId,
            buyPlatform: opp.buyPlatform,
            buyPrice: opp.buyPrice,
            buyShipping: opp.buyShipping,
            sellPlatform: opp.sellPlatform,
            sellPrice: opp.sellPrice,
            estimatedFees: opp.estimatedFees,
            estimatedProfit: opp.estimatedProfit,
            marginPct: opp.marginPct,
            score: opp.score,
            status: 'active' as const,
            foundAt: new Date(),
          };
          db.addOpportunity(fullOpp);

          // Track opportunity discovery metric
          opportunityDiscoveryRate.inc({ buy_platform: opp.buyPlatform, sell_platform: opp.sellPlatform });

          // Send notification for high-margin opportunities (>25%)
          if (opp.marginPct >= 25) {
            notificationManager.broadcastOpportunity(fullOpp).catch((err) => {
              logger.error({ err }, 'Failed to notify about high-margin opportunity');
            });
          }
        }
        logger.info({ found: opps.length }, 'Cron: scan_prices complete');
      } catch (err) {
        logger.error({ err }, 'Cron: scan_prices failed');
      }
    },
    checkOrders: async () => {
      logger.info('Cron: check_orders tick');
      try {
        const count = await orderMonitor.checkOrders();
        if (count > 0) {
          logger.info({ newOrders: count }, 'Cron: check_orders found new orders');

          // Notify about new orders
          const pendingOrders = db.query<{ id: string }>('SELECT id FROM orders WHERE status = \'pending\' ORDER BY ordered_at DESC LIMIT ?', [count]);
          for (const row of pendingOrders) {
            const order = db.getOrder(row.id);
            if (order) {
              notificationManager.broadcastOrder(order).catch((err) => {
                logger.error({ err, orderId: order.id }, 'Failed to send order notification');
              });
            }
          }
        }
      } catch (err) {
        logger.error({ err }, 'Cron: check_orders failed');
      }
    },
    repriceCheck: async () => {
      logger.info('Cron: reprice_check tick');
      try {
        const listings = db.getActiveListings();
        if (listings.length === 0) return;
        const adapters = buildAdapters();
        let repriced = 0;
        for (const listing of listings) {
          const adapter = adapters.get(listing.platform);
          if (!adapter) continue;
          try {
            const results = await adapter.search({ query: listing.title ?? listing.productId, maxResults: 5 });
            const competitorPrices = results
              .filter(r => r.price > 0)
              .map(r => r.price);
            if (competitorPrices.length > 0) {
              const avgPrice = competitorPrices.reduce((a, b) => a + b, 0) / competitorPrices.length;
              // Flag listings where our price is >20% above average
              if (listing.price > avgPrice * 1.2) {
                logger.warn({
                  listingId: listing.id,
                  ourPrice: listing.price,
                  avgCompetitor: Math.round(avgPrice * 100) / 100,
                }, 'Listing may be overpriced');
                repriced++;
              }
            }
          } catch (err) {
            logger.debug({ listingId: listing.id, err }, 'Reprice check failed for listing');
          }
        }
        logger.info({ checked: listings.length, flagged: repriced }, 'Cron: reprice_check complete');
      } catch (err) {
        logger.error({ err }, 'Cron: reprice_check failed');
      }
    },
    inventorySync: async () => {
      logger.info('Cron: inventory_sync tick');
      try {
        // Check active listings against source platform stock
        const listings = db.getActiveListings();
        const adapters = buildAdapters();
        let synced = 0;
        for (const listing of listings) {
          if (!listing.productId) continue;
          const sourceAdapter = adapters.get(listing.sourcePlatform);
          if (!sourceAdapter) continue;
          try {
            const product = await sourceAdapter.getProduct(listing.productId);
            if (product && !product.inStock) {
              db.updateListingStatus(listing.id, 'paused');
              logger.warn({ listingId: listing.id, productId: listing.productId }, 'Source OOS — listing paused');
              synced++;
            }
          } catch {
            // Source lookup failed — skip silently
          }
        }
        logger.info({ checked: listings.length, paused: synced }, 'Cron: inventory_sync complete');
      } catch (err) {
        logger.error({ err }, 'Cron: inventory_sync failed');
      }
    },
    sessionCleanup: async () => {
      logger.info('Cron: session_cleanup tick');
      // Session manager handles its own cleanup via dispose intervals,
      // but we also clean expired sessions from the DB
      try {
        const cutoffMs = 30 * 24 * 60 * 60 * 1000; // 30 days
        const cutoffEpoch = Date.now() - cutoffMs;
        db.run('DELETE FROM sessions WHERE updated_at < ?', [cutoffEpoch]);
        logger.info('Cron: session_cleanup complete');
      } catch (err) {
        logger.error({ err }, 'Cron: session_cleanup failed');
      }
    },
    dbBackup: async () => { db.save(); },
  });
  // Register repricing engine cron job (hourly by default)
  cron.addJob({
    id: 'repricing_engine',
    name: 'Advanced Repricing Engine',
    schedule: { type: 'interval', intervalMs: 60 * 60 * 1000 }, // hourly
    handler: async () => {
      logger.info('Cron: repricing_engine tick');
      try {
        const results = await repricingEngine.runAll();
        const adjusted = results.filter(r => r.applied).length;
        logger.info({ totalRules: results.length, adjusted }, 'Cron: repricing_engine complete');
      } catch (err) {
        logger.error({ err }, 'Cron: repricing_engine failed');
      }
    },
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
      monitoring: {
        metricsRegistry,
        healthChecker: monitoringHealthChecker,
        alertManager: monitoringAlertManager,
      },
      jobQueue,
      repricingEngine,
    },
  );

  // 9. Attach WebSocket to channel manager
  channelManager.attachWebSocket(httpServer.wss);

  // 10. Monitoring intervals
  let healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  let healthLogInterval: ReturnType<typeof setInterval> | null = null;
  let sessionMetricsInterval: ReturnType<typeof setInterval> | null = null;

  let started = false;

  return {
    async start() {
      if (started) return;
      await httpServer.start();
      await channelManager.start();
      cron.start();
      jobQueue.start();

      // --- Monitoring: Health checks every 60 seconds ---
      healthCheckInterval = setInterval(async () => {
        try {
          const result = await monitoringHealthChecker.checkHealth();

          // Feed health results into alert manager
          const liveness = await monitoringHealthChecker.checkLiveness();
          await monitoringAlertManager.checkMetric('process_memory_percent', liveness.memory.percent);

          // Fire alert if overall health is unhealthy
          if (result.status === 'unhealthy') {
            const unhealthyComponents = result.components
              .filter(c => c.status === 'unhealthy')
              .map(c => c.name);
            await monitoringAlertManager.fire({
              name: 'system_unhealthy',
              level: 'critical',
              message: `System is unhealthy. Failed components: ${unhealthyComponents.join(', ')}`,
              source: 'health_check',
              tags: ['system', 'health'],
              metadata: { components: result.summary },
            });

            // Also notify via channels
            notificationManager.broadcast(
              `[CRITICAL] System unhealthy - failed components: ${unhealthyComponents.join(', ')}`
            ).catch(() => { /* ignore notification errors during health alerts */ });
          }
        } catch (err) {
          logger.error({ err }, 'Health check cycle failed');
        }
      }, 60_000);
      if (healthCheckInterval.unref) healthCheckInterval.unref();

      // --- Monitoring: Health status summary log every 5 minutes ---
      healthLogInterval = setInterval(async () => {
        try {
          const result = await monitoringHealthChecker.checkHealth();
          const liveness = await monitoringHealthChecker.checkLiveness();
          logger.info({
            status: result.status,
            uptime: result.uptime,
            components: result.summary,
            memory: {
              heapPercent: Math.round(liveness.memory.percent * 100) / 100,
              rssMB: Math.round(liveness.memory.rss / 1024 / 1024),
            },
            eventLoopLatencyMs: liveness.eventLoop.latencyMs,
            alertStats: monitoringAlertManager.getStats(),
          }, 'Health status summary');
        } catch (err) {
          logger.error({ err }, 'Health status summary failed');
        }
      }, 5 * 60_000);
      if (healthLogInterval.unref) healthLogInterval.unref();

      // --- Monitoring: Track active sessions count every 30 seconds ---
      sessionMetricsInterval = setInterval(() => {
        try {
          const sessions = db.listSessions();
          activeSessionsGauge.set(sessions.length);
        } catch {
          // ignore
        }
      }, 30_000);
      if (sessionMetricsInterval.unref) sessionMetricsInterval.unref();

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

      // Stop monitoring intervals
      if (healthCheckInterval) { clearInterval(healthCheckInterval); healthCheckInterval = null; }
      if (healthLogInterval) { clearInterval(healthLogInterval); healthLogInterval = null; }
      if (sessionMetricsInterval) { clearInterval(sessionMetricsInterval); sessionMetricsInterval = null; }
      stopMetricsCollection();

      cron.stop();
      jobQueue.stop();
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
