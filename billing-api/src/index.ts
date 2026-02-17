/**
 * Entry point — starts the FlipGod billing API server
 */
import dotenv from 'dotenv';
dotenv.config();

import { createLogger } from './utils/logger';
import { loadConfig } from './config';
import { createDb } from './db';
import { runMigrations } from './db/migrations';
import { createJwtService } from './auth/jwt';
import { createAuthService } from './auth';
import { createUsageService } from './billing/usage';
import { createSolanaTokenGate } from './billing/solana';
import { createServer } from './server';

const logger = createLogger('main');

async function main() {
  logger.info('Starting FlipGod billing API...');

  // 1. Load config
  const config = loadConfig();
  logger.info({ port: config.port, env: config.nodeEnv }, 'Config loaded');

  // 2. Connect to database
  const db = createDb(config.databaseUrl);
  logger.info('Database connected');

  // 3. Run migrations
  await runMigrations(db);

  // 4. Initialize services
  const jwtService = createJwtService(config.jwtSecret, config.jwtRefreshSecret);
  const authService = createAuthService(db, jwtService);
  const usageService = createUsageService(db);

  // 4b. Initialize Solana token gate (if token mint is configured)
  let tokenGate;
  if (config.solanaTokenMint) {
    tokenGate = createSolanaTokenGate(
      db,
      config.solanaTokenMint,
      config.solanaRpcUrl,
      config.solanaMinBalance,
      config.solanaTokenDecimals,
    );
    logger.info({ mint: config.solanaTokenMint, minBalance: config.solanaMinBalance }, 'Solana token gate enabled');
  } else {
    logger.info('Solana token gate disabled (no SOLANA_TOKEN_MINT configured)');
  }

  // 5. Create and start server
  const server = createServer({
    config,
    db,
    authService,
    jwtService,
    usageService,
    tokenGate,
  });

  await server.start();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down...');
    await server.stop();
    await db.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err: err instanceof Error ? err.message : String(err) }, 'Fatal startup error');
  process.exit(1);
});
