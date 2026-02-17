/**
 * Onboarding Wizard - Interactive setup for FlipGod
 *
 * Features:
 * - Step-by-step configuration
 * - API key setup (Anthropic, eBay, Amazon, Walmart)
 * - Channel configuration
 */

import * as readline from 'readline';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createLogger } from '../utils/logger';

const logger = createLogger('wizard');

export interface WizardStep {
  id: string;
  title: string;
  description: string;
  run: (ctx: WizardContext) => Promise<void>;
  skip?: (ctx: WizardContext) => boolean;
}

export interface WizardContext {
  config: Record<string, unknown>;
  answers: Record<string, string>;
  rl: readline.Interface;
}

/** Prompt user for input */
async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

/** Prompt for yes/no */
async function confirm(rl: readline.Interface, question: string): Promise<boolean> {
  const answer = await prompt(rl, `${question} (y/n): `);
  return answer.toLowerCase().startsWith('y');
}

/** Default wizard steps */
const DEFAULT_STEPS: WizardStep[] = [
  {
    id: 'welcome',
    title: 'Welcome',
    description: 'Welcome to FlipGod setup',
    async run(ctx) {
      logger.info('Welcome to FlipGod - Your AI Retail Arbitrage Assistant');
      logger.info('This wizard will help you set up FlipGod.');
    },
  },
  {
    id: 'anthropic',
    title: 'Anthropic API Key',
    description: 'Configure Claude API access',
    async run(ctx) {
      logger.info('Anthropic API Key - Get your API key from: https://console.anthropic.com/');

      const key = await prompt(ctx.rl, 'Enter your Anthropic API key (sk-ant-...): ');
      if (key && key.startsWith('sk-ant-')) {
        ctx.config.ANTHROPIC_API_KEY = key;
        logger.info('API key saved');
      } else {
        logger.warn('Invalid or no key provided, skipping');
      }
    },
  },
  {
    id: 'ebay',
    title: 'eBay Credentials',
    description: 'Configure eBay API access',
    async run(ctx) {
      logger.info('eBay API Setup');

      if (!await confirm(ctx.rl, 'Do you want to set up eBay?')) {
        return;
      }

      logger.info('Get your credentials from https://developer.ebay.com/');
      const clientId = await prompt(ctx.rl, 'eBay Client ID: ');
      const clientSecret = await prompt(ctx.rl, 'eBay Client Secret: ');
      const refreshToken = await prompt(ctx.rl, 'eBay Refresh Token: ');

      if (clientId && clientSecret && refreshToken) {
        ctx.config.EBAY_CLIENT_ID = clientId;
        ctx.config.EBAY_CLIENT_SECRET = clientSecret;
        ctx.config.EBAY_REFRESH_TOKEN = refreshToken;
        logger.info('eBay configured');
      }
    },
  },
  {
    id: 'amazon',
    title: 'Amazon Credentials',
    description: 'Configure Amazon Product Advertising API',
    async run(ctx) {
      logger.info('Amazon API Setup');

      if (!await confirm(ctx.rl, 'Do you want to set up Amazon?')) {
        return;
      }

      logger.info('Get your credentials from https://affiliate-program.amazon.com/');
      const accessKeyId = await prompt(ctx.rl, 'Amazon Access Key ID: ');
      const secretAccessKey = await prompt(ctx.rl, 'Amazon Secret Access Key: ');
      const partnerTag = await prompt(ctx.rl, 'Amazon Partner Tag: ');

      if (accessKeyId && secretAccessKey && partnerTag) {
        ctx.config.AMAZON_ACCESS_KEY_ID = accessKeyId;
        ctx.config.AMAZON_SECRET_ACCESS_KEY = secretAccessKey;
        ctx.config.AMAZON_PARTNER_TAG = partnerTag;
        logger.info('Amazon configured');
      }
    },
  },
  {
    id: 'walmart',
    title: 'Walmart Credentials',
    description: 'Configure Walmart API access',
    async run(ctx) {
      logger.info('Walmart API Setup');

      if (!await confirm(ctx.rl, 'Do you want to set up Walmart?')) {
        return;
      }

      logger.info('Get your credentials from https://developer.walmart.com/');
      const clientId = await prompt(ctx.rl, 'Walmart Client ID: ');
      const clientSecret = await prompt(ctx.rl, 'Walmart Client Secret: ');

      if (clientId && clientSecret) {
        ctx.config.WALMART_CLIENT_ID = clientId;
        ctx.config.WALMART_CLIENT_SECRET = clientSecret;
        logger.info('Walmart configured');
      }
    },
  },
  {
    id: 'telegram',
    title: 'Telegram Bot',
    description: 'Configure Telegram channel',
    async run(ctx) {
      logger.info('Telegram Bot Setup');

      if (!await confirm(ctx.rl, 'Do you want to set up Telegram?')) {
        return;
      }

      logger.info('Get a bot token from @BotFather on Telegram');
      const token = await prompt(ctx.rl, 'Enter your Telegram bot token: ');
      if (token) {
        ctx.config.TELEGRAM_BOT_TOKEN = token;
        logger.info('Telegram configured');
      }
    },
  },
  {
    id: 'finish',
    title: 'Finish',
    description: 'Save configuration',
    async run(ctx) {
      logger.info('Saving configuration...');

      const configDir = join(homedir(), '.flipagent');
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      // Write .env file
      const envPath = join(process.cwd(), '.env');
      const envContent = Object.entries(ctx.config)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
      writeFileSync(envPath, envContent);

      logger.info('Configuration saved to .env');
      logger.info('Setup complete! Run `npm start` to launch FlipGod.');
    },
  },
];

export interface OnboardingWizard {
  run(): Promise<void>;
  addStep(step: WizardStep, afterId?: string): void;
}

export function createOnboardingWizard(steps: WizardStep[] = DEFAULT_STEPS): OnboardingWizard {
  const allSteps = [...steps];

  return {
    async run() {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const ctx: WizardContext = {
        config: {},
        answers: {},
        rl,
      };

      try {
        for (const step of allSteps) {
          if (step.skip?.(ctx)) {
            logger.debug({ stepId: step.id }, 'Skipping step');
            continue;
          }

          await step.run(ctx);
        }
      } finally {
        rl.close();
      }
    },

    addStep(step, afterId) {
      if (afterId) {
        const idx = allSteps.findIndex((s) => s.id === afterId);
        if (idx >= 0) {
          allSteps.splice(idx + 1, 0, step);
          return;
        }
      }
      allSteps.push(step);
    },
  };
}
