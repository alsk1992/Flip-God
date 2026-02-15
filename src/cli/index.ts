#!/usr/bin/env node
/**
 * FlipAgent CLI
 *
 * Commands:
 * - flipagent onboard    — Interactive setup wizard
 * - flipagent start       — Start the gateway
 * - flipagent status      — Show status and paired users
 * - flipagent endpoints   — Show webhook endpoints
 */

// Silence pino during onboard/setup so log spam doesn't pollute the wizard
if (process.argv.includes('onboard') || process.argv.includes('setup')) {
  process.env.LOG_LEVEL = 'silent';
}

import { config as dotenvConfig } from 'dotenv';
import { homedir } from 'os';
import { join } from 'path';

// Load .env from ~/.flipagent/.env first (where onboard writes), then CWD fallback
dotenvConfig({ path: join(homedir(), '.flipagent', '.env') });
dotenvConfig();

import { Command } from 'commander';
import { createGateway } from '../gateway/index';
import { loadConfig } from '../utils/config';
import { logger } from '../utils/logger';
import { installHttpClient, configureHttpClient } from '../utils/http';

const program = new Command();
installHttpClient();

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught exception');
  process.exit(1);
});

program
  .name('flipagent')
  .description('AI-powered e-commerce arbitrage agent')
  .version('0.1.0');

// ============================================================================
// onboard — Interactive setup wizard
// ============================================================================
program
  .command('onboard')
  .alias('setup')
  .description('Interactive setup wizard — validates credentials and saves config')
  .action(async () => {
    const { runOnboard } = await import('./onboard');
    await runOnboard();
  });

// ============================================================================
// start — Start the gateway
// ============================================================================
program
  .command('start')
  .description('Start the FlipAgent gateway')
  .option('-p, --port <port>', 'Override gateway port')
  .action(async (options: { port?: string }) => {
    if (options.port) process.env.FLIPAGENT_PORT = options.port;

    logger.info('Starting FlipAgent...');
    const config = await loadConfig();
    configureHttpClient(config.http);
    const gateway = await createGateway(config);
    await gateway.start();

    logger.info({ port: config.gateway.port }, 'FlipAgent is running!');

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info('Shutting down...');
      try {
        await Promise.race([
          gateway.stop(),
          new Promise<void>((resolve) => setTimeout(() => { logger.warn('Shutdown timeout'); resolve(); }, 15000)),
        ]);
      } catch (e) { logger.error({ err: e }, 'Shutdown error'); }
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

// ============================================================================
// status — Show status
// ============================================================================
program
  .command('status')
  .description('Show FlipAgent status and configuration')
  .action(async () => {
    const config = await loadConfig();
    const port = config.gateway?.port ?? 3141;

    console.log('\n\x1b[1mFlipAgent Status\x1b[0m\n');

    // Check API key
    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    console.log(`  Anthropic API: ${hasKey ? '\x1b[32m✓ configured\x1b[0m' : '\x1b[31m✗ not set\x1b[0m'}`);

    // Check platform credentials
    const platforms = [
      { name: 'Amazon', keys: ['AMAZON_ACCESS_KEY'] },
      { name: 'eBay', keys: ['EBAY_CLIENT_ID'] },
      { name: 'Walmart', keys: ['WALMART_CLIENT_ID'] },
      { name: 'AliExpress', keys: ['ALIEXPRESS_APP_KEY'] },
      { name: 'Keepa', keys: ['KEEPA_API_KEY'] },
      { name: 'EasyPost', keys: ['EASYPOST_API_KEY'] },
    ];

    console.log('\n  Platforms:');
    for (const p of platforms) {
      const configured = p.keys.some(k => !!process.env[k]);
      console.log(`    ${configured ? '\x1b[32m✓' : '\x1b[90m○'}\x1b[0m ${p.name}`);
    }

    // Check channels
    const channels = [
      { name: 'Telegram', key: 'TELEGRAM_BOT_TOKEN' },
      { name: 'Discord', key: 'DISCORD_BOT_TOKEN' },
    ];

    console.log('\n  Channels:');
    for (const c of channels) {
      const configured = !!process.env[c.key];
      console.log(`    ${configured ? '\x1b[32m✓' : '\x1b[90m○'}\x1b[0m ${c.name}`);
    }
    console.log(`    \x1b[32m✓\x1b[0m WebSocket (always on)`);
    console.log(`    \x1b[32m✓\x1b[0m Web Chat (always on)`);

    console.log(`\n  Gateway: http://localhost:${port}`);
    console.log(`  Health:  http://localhost:${port}/health\n`);

    // Try to ping if running
    try {
      const resp = await fetch(`http://localhost:${port}/health`);
      if (resp.ok) {
        const data = await resp.json() as { uptime?: number };
        const uptime = data.uptime ? `${Math.round(data.uptime)}s` : 'unknown';
        console.log(`  \x1b[32mServer is running\x1b[0m (uptime: ${uptime})\n`);
      } else {
        console.log('  \x1b[33mServer returned non-OK status\x1b[0m\n');
      }
    } catch {
      console.log('  \x1b[90mServer is not running\x1b[0m\n');
    }
  });

// ============================================================================
// endpoints — Show webhook/API endpoints
// ============================================================================
program
  .command('endpoints')
  .description('Show API and webhook endpoints')
  .option('--host <host>', 'Public hostname', process.env.FLIPAGENT_PUBLIC_HOST || 'localhost')
  .option('--scheme <scheme>', 'URL scheme', process.env.FLIPAGENT_PUBLIC_SCHEME || 'http')
  .option('--port <port>', 'Override port')
  .action(async (options: { host: string; scheme: string; port?: string }) => {
    const config = await loadConfig();
    const port = options.port ? parseInt(options.port, 10) : (config.gateway?.port ?? 3141);
    const portSuffix = [80, 443].includes(port) ? '' : `:${port}`;
    const baseUrl = `${options.scheme}://${options.host}${portSuffix}`;

    console.log('\n\x1b[1mFlipAgent Endpoints\x1b[0m\n');
    console.log(`  Base URL: ${baseUrl}\n`);
    console.log('  API:');
    console.log(`    Health:     GET  ${baseUrl}/health`);
    console.log(`    Chat:       POST ${baseUrl}/api/chat`);
    console.log(`    WebSocket:  WS   ${baseUrl.replace('http', 'ws')}/ws`);
    console.log(`    Web Chat:        ${baseUrl}/chat`);
    console.log('');
  });

program.parse();
