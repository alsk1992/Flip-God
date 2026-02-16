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

// ============================================================================
// credentials — Backup, import, and rotate credential encryption keys
// ============================================================================
const credentialsCmd = program
  .command('credentials')
  .description('Manage encrypted trading credentials');

credentialsCmd
  .command('export')
  .description('Export encrypted credentials to a backup file')
  .action(async () => {
    const { createDatabase, initDatabase } = await import('../db');
    const { homedir } = await import('os');
    const { join } = await import('path');
    const { existsSync, mkdirSync, writeFileSync } = await import('fs');

    const db = await createDatabase();
    await initDatabase(db);

    const rows = db.query<{
      user_id: string;
      platform: string;
      mode: string;
      encrypted_data: string;
      enabled: number;
    }>('SELECT user_id, platform, mode, encrypted_data, enabled FROM trading_credentials');

    if (rows.length === 0) {
      console.log('\n  No credentials found to export.\n');
      db.close();
      return;
    }

    const stateDir = join(homedir(), '.flipagent');
    if (!existsSync(stateDir)) {
      mkdirSync(stateDir, { recursive: true });
    }

    const dateStr = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const backupPath = join(stateDir, `credentials-backup-${dateStr}.json`);

    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      count: rows.length,
      credentials: rows.map((r) => ({
        userId: r.user_id,
        platform: r.platform,
        mode: r.mode,
        encryptedData: r.encrypted_data,
        enabled: Boolean(r.enabled),
      })),
    };

    writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8');

    console.log(`\n  Exported ${rows.length} credential(s) to:`);
    console.log(`  ${backupPath}\n`);
    console.log('  \x1b[33mWARNING:\x1b[0m This file contains encrypted credentials.');
    console.log('  The data can only be decrypted with the same FLIPAGENT_CREDENTIAL_KEY');
    console.log('  that was used to encrypt them. Keep both the backup file and the key safe.\n');

    db.close();
  });

credentialsCmd
  .command('import')
  .argument('<file>', 'Path to the credentials backup JSON file')
  .description('Import credentials from a backup file')
  .action(async (file: string) => {
    const { createDatabase, initDatabase } = await import('../db');
    const { readFileSync, existsSync } = await import('fs');
    const { resolve } = await import('path');

    const filePath = resolve(file);
    if (!existsSync(filePath)) {
      console.error(`\n  \x1b[31mError:\x1b[0m File not found: ${filePath}\n`);
      process.exit(1);
    }

    let backup: {
      version?: number;
      credentials?: Array<{
        userId: string;
        platform: string;
        mode: string;
        encryptedData: string;
        enabled: boolean;
      }>;
    };

    try {
      const raw = readFileSync(filePath, 'utf-8');
      backup = JSON.parse(raw);
    } catch (err) {
      console.error(`\n  \x1b[31mError:\x1b[0m Failed to parse backup file: ${(err as Error).message}\n`);
      process.exit(1);
    }

    if (!backup.credentials || !Array.isArray(backup.credentials)) {
      console.error('\n  \x1b[31mError:\x1b[0m Invalid backup file format (missing credentials array).\n');
      process.exit(1);
    }

    const db = await createDatabase();
    await initDatabase(db);

    let imported = 0;
    let skipped = 0;

    for (const cred of backup.credentials) {
      if (!cred.userId || !cred.platform || !cred.encryptedData) {
        skipped++;
        continue;
      }

      // Check if credentials already exist for this user+platform
      const existing = db.query<{ user_id: string }>(
        'SELECT user_id FROM trading_credentials WHERE user_id = ? AND platform = ?',
        [cred.userId, cred.platform],
      );

      const now = Date.now();

      if (existing.length > 0) {
        db.run(
          'UPDATE trading_credentials SET mode = ?, encrypted_data = ?, enabled = ?, updated_at = ? WHERE user_id = ? AND platform = ?',
          [cred.mode, cred.encryptedData, cred.enabled ? 1 : 0, now, cred.userId, cred.platform],
        );
      } else {
        db.run(
          'INSERT INTO trading_credentials (user_id, platform, mode, encrypted_data, enabled, failed_attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
          [cred.userId, cred.platform, cred.mode, cred.encryptedData, cred.enabled ? 1 : 0, now, now],
        );
      }
      imported++;
    }

    console.log(`\n  Imported ${imported} credential(s) from ${filePath}`);
    if (skipped > 0) {
      console.log(`  Skipped ${skipped} invalid entrie(s)`);
    }
    console.log('');

    db.close();
  });

credentialsCmd
  .command('rotate-key')
  .description('Re-encrypt all credentials with a new encryption key')
  .action(async () => {
    const { createDatabase, initDatabase } = await import('../db');
    const { decrypt, encrypt } = await import('../credentials');
    const { randomBytes } = await import('crypto');

    const oldKey = process.env.FLIPAGENT_CREDENTIAL_KEY;
    if (!oldKey || oldKey.trim().length === 0) {
      console.error('\n  \x1b[31mError:\x1b[0m FLIPAGENT_CREDENTIAL_KEY must be set to rotate keys.\n');
      console.error('  The current key is needed to decrypt existing credentials.\n');
      process.exit(1);
    }

    const db = await createDatabase();
    await initDatabase(db);

    const rows = db.query<{
      user_id: string;
      platform: string;
      encrypted_data: string;
    }>('SELECT user_id, platform, encrypted_data FROM trading_credentials');

    if (rows.length === 0) {
      console.log('\n  No credentials found to rotate.\n');
      db.close();
      return;
    }

    // Decrypt all credentials with the old key first
    const decryptedEntries: Array<{ userId: string; platform: string; plaintext: string }> = [];

    for (const row of rows) {
      try {
        const plaintext = decrypt(row.encrypted_data);
        decryptedEntries.push({ userId: row.user_id, platform: row.platform, plaintext });
      } catch (err) {
        console.error(`\n  \x1b[31mError:\x1b[0m Failed to decrypt credentials for ${row.user_id}/${row.platform}: ${(err as Error).message}`);
        console.error('  Aborting rotation. No credentials were modified.\n');
        db.close();
        process.exit(1);
      }
    }

    // Generate new key
    const newKey = randomBytes(32).toString('hex');

    // Set the new key in the environment so encrypt() picks it up
    process.env.FLIPAGENT_CREDENTIAL_KEY = newKey;

    // Re-encrypt all credentials with the new key
    let rotated = 0;
    for (const entry of decryptedEntries) {
      const newEncrypted = encrypt(entry.plaintext);
      db.run(
        'UPDATE trading_credentials SET encrypted_data = ?, updated_at = ? WHERE user_id = ? AND platform = ?',
        [newEncrypted, Date.now(), entry.userId, entry.platform],
      );
      rotated++;
    }

    console.log(`\n  Rotated encryption key for ${rotated} credential(s).\n`);
    console.log('  \x1b[33mIMPORTANT:\x1b[0m Update your FLIPAGENT_CREDENTIAL_KEY environment variable to:\n');
    console.log(`  \x1b[1m${newKey}\x1b[0m\n`);
    console.log('  Save this in your ~/.flipagent/.env file:');
    console.log(`  FLIPAGENT_CREDENTIAL_KEY=${newKey}\n`);
    console.log('  \x1b[31mWARNING:\x1b[0m If you lose this key, all stored credentials will be unrecoverable.\n');

    db.close();
  });

program.parse();
