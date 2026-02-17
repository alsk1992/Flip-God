/**
 * FlipGod — AI-Powered E-Commerce Arbitrage Agent
 *
 * Entry point - starts the gateway and all services
 */

import { config as dotenvConfig } from 'dotenv';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Load .env from ~/.flipagent/.env first, then CWD fallback
dotenvConfig({ path: join(homedir(), '.flipagent', '.env') });
dotenvConfig();

import { createGateway } from './gateway/index';
import { loadConfig } from './utils/config';
import { logger } from './utils/logger';
import { installHttpClient, configureHttpClient } from './utils/http';

// Startup progress indicator (same pattern as Clodds)
interface StartupStep {
  name: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  detail?: string;
}

const startupSteps: StartupStep[] = [];
let spinnerInterval: NodeJS.Timeout | null = null;
const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
let spinnerFrame = 0;

function addStep(name: string): number {
  return startupSteps.push({ name, status: 'pending' }) - 1;
}

function updateStep(idx: number, status: StartupStep['status'], detail?: string): void {
  if (startupSteps[idx]) {
    startupSteps[idx].status = status;
    if (detail) startupSteps[idx].detail = detail;
  }
  renderProgress();
}

function renderProgress(): void {
  if (!process.stdout.isTTY) return;
  const linesToClear = startupSteps.length + 2;
  process.stdout.write(`\x1b[${linesToClear}A\x1b[0J`);
  console.log('\n\x1b[35m\x1b[1m[FG]\x1b[0m \x1b[1mStarting FlipGod...\x1b[0m\n');
  for (const step of startupSteps) {
    let icon: string, color: string;
    switch (step.status) {
      case 'done': icon = '✓'; color = '\x1b[32m'; break;
      case 'failed': icon = '✗'; color = '\x1b[31m'; break;
      case 'running': icon = spinnerFrames[spinnerFrame % spinnerFrames.length]; color = '\x1b[36m'; break;
      default: icon = '○'; color = '\x1b[90m';
    }
    const detail = step.detail ? ` \x1b[90m(${step.detail})\x1b[0m` : '';
    console.log(`  ${color}${icon}\x1b[0m ${step.name}${detail}`);
  }
}

function startSpinner(): void {
  if (!process.stdout.isTTY) return;
  spinnerInterval = setInterval(() => {
    spinnerFrame = (spinnerFrame + 1) % spinnerFrames.length;
    renderProgress();
  }, 80);
}

function stopSpinner(): void {
  if (spinnerInterval) { clearInterval(spinnerInterval); spinnerInterval = null; }
}

function validateStartupRequirements(): void {
  const errors: string[] = [];
  if (!process.env.ANTHROPIC_API_KEY) {
    errors.push('ANTHROPIC_API_KEY is not set. Add it to your .env file.');
  }
  // Auto-generate credential encryption key
  if (!process.env.FLIPAGENT_CREDENTIAL_KEY) {
    const generated = randomBytes(32).toString('hex');
    process.env.FLIPAGENT_CREDENTIAL_KEY = generated;
    const flipDir = join(homedir(), '.flipagent');
    const envPath = join(flipDir, '.env');
    try {
      if (!existsSync(flipDir)) mkdirSync(flipDir, { recursive: true });
      if (existsSync(envPath)) {
        const existing = readFileSync(envPath, 'utf-8');
        if (!existing.includes('FLIPAGENT_CREDENTIAL_KEY=')) {
          appendFileSync(envPath, `\nFLIPAGENT_CREDENTIAL_KEY=${generated}\n`);
        }
      } else {
        writeFileSync(envPath, `FLIPAGENT_CREDENTIAL_KEY=${generated}\n`, { mode: 0o600 });
      }
      logger.info('Auto-generated FLIPAGENT_CREDENTIAL_KEY and saved to ~/.flipagent/.env');
      logger.warn('Back up FLIPAGENT_CREDENTIAL_KEY — losing it makes stored credentials unrecoverable');
    } catch (err) {
      logger.warn({ err }, 'Could not persist FLIPAGENT_CREDENTIAL_KEY — stored credentials will be lost on restart');
    }
  }
  if (errors.length > 0) {
    for (const error of errors) logger.error(error);
    process.exit(1);
  }
}

async function main() {
  installHttpClient();
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'Unhandled rejection'));
  process.on('uncaughtException', (error) => { logger.error({ error }, 'Uncaught exception'); process.exit(1); });

  const isTTY = process.stdout.isTTY;

  if (isTTY) {
    const idxValidate = addStep('Validating configuration');
    const idxConfig = addStep('Loading config');
    const idxDatabase = addStep('Connecting to database');
    const idxChannels = addStep('Connecting channels');
    const idxGateway = addStep('Starting HTTP gateway');

    console.log(`
\x1b[35m\x1b[1m  ███████╗██╗     ██╗██████╗  ██████╗  ██████╗ ██████╗
  ██╔════╝██║     ██║██╔══██╗██╔════╝ ██╔═══██╗██╔══██╗
  █████╗  ██║     ██║██████╔╝██║  ███╗██║   ██║██║  ██║
  ██╔══╝  ██║     ██║██╔═══╝ ██║   ██║██║   ██║██║  ██║
  ██║     ███████╗██║██║     ╚██████╔╝╚██████╔╝██████╔╝
  ╚═╝     ╚══════╝╚═╝╚═╝      ╚═════╝  ╚═════╝ ╚═════╝\x1b[0m
\x1b[90m  AI-powered e-commerce arbitrage · 185 tools · 18 platforms\x1b[0m
`);
    for (const step of startupSteps) console.log(`  \x1b[90m○\x1b[0m ${step.name}`);
    startSpinner();

    updateStep(idxValidate, 'running');
    try { validateStartupRequirements(); updateStep(idxValidate, 'done'); }
    catch (e) { updateStep(idxValidate, 'failed'); stopSpinner(); throw e; }

    updateStep(idxConfig, 'running');
    let config;
    try { config = await loadConfig(); configureHttpClient(config.http); updateStep(idxConfig, 'done', `port ${config.gateway.port}`); }
    catch (e) { updateStep(idxConfig, 'failed'); stopSpinner(); throw e; }

    updateStep(idxDatabase, 'running');
    updateStep(idxChannels, 'running');
    updateStep(idxGateway, 'running');

    let gateway;
    try {
      gateway = await createGateway(config);
      updateStep(idxDatabase, 'done');
      updateStep(idxChannels, 'done');
    } catch (e) {
      updateStep(idxDatabase, 'failed');
      stopSpinner();
      throw e;
    }

    try { await gateway.start(); updateStep(idxGateway, 'done', `http://localhost:${config.gateway.port}`); }
    catch (e) { updateStep(idxGateway, 'failed'); stopSpinner(); throw e; }

    stopSpinner();
    renderProgress();

    console.log('\n\x1b[35m\x1b[1m[FG]\x1b[0m \x1b[32m\x1b[1mFlipGod is live.\x1b[0m');
    console.log(`\n  WebChat:  \x1b[36mhttp://localhost:${config.gateway.port}/chat\x1b[0m`);
    console.log(`  Health:   \x1b[36mhttp://localhost:${config.gateway.port}/health\x1b[0m`);
    console.log('\n  Press Ctrl+C to stop\n');

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      stopSpinner();
      console.log('\n\x1b[33mShutting down...\x1b[0m');
      try {
        await Promise.race([
          gateway.stop(),
          new Promise<void>((resolve) => setTimeout(() => { logger.warn('Shutdown timeout'); resolve(); }, 15000)),
        ]);
      } catch (e) { logger.error({ err: e }, 'Shutdown error'); }
      console.log('\x1b[32mGoodbye!\x1b[0m\n');
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } else {
    logger.info('[FG] Starting FlipGod...');
    validateStartupRequirements();
    const config = await loadConfig();
    configureHttpClient(config.http);
    const gateway = await createGateway(config);
    await gateway.start();
    logger.info('[FG] FlipGod is live — 185 tools, 18 platforms');

    let shuttingDown = false;
    const shutdown = async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info('Shutting down...');
      try { await Promise.race([gateway.stop(), new Promise<void>(r => setTimeout(r, 15000))]); }
      catch (e) { logger.error({ err: e }, 'Shutdown error'); }
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }
}

main().catch((err) => { stopSpinner(); logger.error({ err }, 'Fatal error'); process.exit(1); });
