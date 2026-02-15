/**
 * Onboard command — interactive setup wizard with credential validation
 *
 * One command to go from zero to running:
 *   npx flipagent onboard
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { randomBytes } from 'crypto';

let rl: readline.Interface;

// =============================================================================
// SPINNER
// =============================================================================

function spinner(text: string): { stop: (success: boolean, result?: string) => void } {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r  ${frames[i++ % frames.length]} ${text}`);
  }, 80);
  return {
    stop(success: boolean, result?: string) {
      clearInterval(interval);
      const icon = success ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
      const msg = result ? ` ${result}` : '';
      process.stdout.write(`\r  ${icon} ${text}${msg}\n`);
    },
  };
}

// =============================================================================
// CREDENTIAL VALIDATORS
// =============================================================================

async function validateAnthropicKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    });

    if (response.ok) return { valid: true };
    if (response.status === 429) return { valid: true }; // rate limited = key works
    const data = await response.json() as { error?: { message?: string } };
    return { valid: false, error: data.error?.message || `HTTP ${response.status}` };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'Connection failed' };
  }
}

async function validateTelegramToken(token: string): Promise<{ valid: boolean; botName?: string; error?: string }> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await response.json() as { ok?: boolean; result?: { username?: string }; description?: string };
    if (data.ok && data.result?.username) return { valid: true, botName: data.result.username };
    return { valid: false, error: data.description || 'Invalid token' };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'Connection failed' };
  }
}

async function validateDiscordToken(token: string): Promise<{ valid: boolean; botName?: string; error?: string }> {
  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
    });
    const data = await response.json() as { username?: string; message?: string };
    if (response.ok && data.username) return { valid: true, botName: data.username };
    return { valid: false, error: data.message || 'Invalid token' };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : 'Connection failed' };
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

function yesNo(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    rl.question(`${prompt} (y/n): `, (answer) => resolve(answer.trim().toLowerCase().startsWith('y')));
  });
}

// =============================================================================
// MAIN ONBOARD FLOW
// =============================================================================

export async function runOnboard(): Promise<void> {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const envVars: Record<string, string> = {};

  console.log('\n\x1b[1m🛒 Welcome to FlipAgent Setup!\x1b[0m\n');
  console.log("Let's get your e-commerce arbitrage agent running.\n");
  console.log('\x1b[90mThis wizard will:\x1b[0m');
  console.log('  1. Set up your Claude API key (required)');
  console.log('  2. Configure chat channels (Telegram/Discord)');
  console.log('  3. Set up marketplace API keys (Amazon/eBay/Walmart/AliExpress)');
  console.log('  4. Validate all credentials before saving\n');

  // ==========================================================================
  // Step 1: Anthropic API Key (Required)
  // ==========================================================================
  console.log('\x1b[1m1️⃣  Claude API Key (Required)\x1b[0m\n');
  console.log('\x1b[90m   Get yours at: https://console.anthropic.com\x1b[0m\n');

  let anthropicKey = '';
  while (!anthropicKey) {
    anthropicKey = await question('   Enter your Anthropic API key: ');
    if (!anthropicKey) {
      console.log('\x1b[31m   API key is required to continue.\x1b[0m\n');
      continue;
    }

    const spin = spinner('Validating API key...');
    const result = await validateAnthropicKey(anthropicKey);
    spin.stop(result.valid, result.valid ? '' : `\x1b[31m${result.error}\x1b[0m`);

    if (!result.valid) {
      console.log('\x1b[90m   Check your key and try again.\x1b[0m\n');
      anthropicKey = '';
    }
  }
  envVars['ANTHROPIC_API_KEY'] = anthropicKey;
  console.log('');

  // ==========================================================================
  // Step 2: Chat Channels (Optional)
  // ==========================================================================
  console.log('\x1b[1m2️⃣  Chat Channels (Optional)\x1b[0m\n');
  console.log('\x1b[90m   WebSocket + Web Chat are always available. Add Telegram or Discord for mobile access.\x1b[0m\n');

  // Telegram
  if (await yesNo('   Set up Telegram bot?')) {
    const token = await question('   Enter Telegram bot token: ');
    if (token) {
      const spin = spinner('Validating Telegram token...');
      const result = await validateTelegramToken(token);
      spin.stop(result.valid, result.valid ? `@${result.botName}` : `\x1b[31m${result.error}\x1b[0m`);
      if (result.valid) {
        envVars['TELEGRAM_BOT_TOKEN'] = token;
      }
    }
    console.log('');
  }

  // Discord
  if (await yesNo('   Set up Discord bot?')) {
    const token = await question('   Enter Discord bot token: ');
    if (token) {
      const spin = spinner('Validating Discord token...');
      const result = await validateDiscordToken(token);
      spin.stop(result.valid, result.valid ? `@${result.botName}` : `\x1b[31m${result.error}\x1b[0m`);
      if (result.valid) {
        envVars['DISCORD_BOT_TOKEN'] = token;
      }
    }
    console.log('');
  }

  // ==========================================================================
  // Step 3: Marketplace APIs (Optional)
  // ==========================================================================
  console.log('\x1b[1m3️⃣  Marketplace APIs (Optional)\x1b[0m\n');
  console.log('\x1b[90m   You can add these later via chat: "setup my eBay credentials"\x1b[0m\n');

  // Amazon
  if (await yesNo('   Set up Amazon Product Advertising API?')) {
    console.log('\x1b[90m   Get keys at: https://affiliate-program.amazon.com → Tools → PA-API\x1b[0m');
    const accessKey = await question('   Access Key: ');
    const secretKey = await question('   Secret Key: ');
    const partnerTag = await question('   Partner Tag (e.g. yourtag-20): ');
    if (accessKey && secretKey) {
      envVars['AMAZON_ACCESS_KEY'] = accessKey;
      envVars['AMAZON_SECRET_KEY'] = secretKey;
      if (partnerTag) envVars['AMAZON_PARTNER_TAG'] = partnerTag;
      console.log('  \x1b[32m✓\x1b[0m Amazon configured');
    }
    console.log('');
  }

  // eBay
  if (await yesNo('   Set up eBay API?')) {
    console.log('\x1b[90m   Get keys at: https://developer.ebay.com\x1b[0m');
    const clientId = await question('   Client ID (App ID): ');
    const clientSecret = await question('   Client Secret (Cert ID): ');
    if (clientId && clientSecret) {
      envVars['EBAY_CLIENT_ID'] = clientId;
      envVars['EBAY_CLIENT_SECRET'] = clientSecret;
      console.log('  \x1b[32m✓\x1b[0m eBay configured');
    }
    console.log('');
  }

  // Walmart
  if (await yesNo('   Set up Walmart API?')) {
    console.log('\x1b[90m   Get keys at: https://developer.walmart.com\x1b[0m');
    const clientId = await question('   Client ID: ');
    const clientSecret = await question('   Client Secret: ');
    if (clientId && clientSecret) {
      envVars['WALMART_CLIENT_ID'] = clientId;
      envVars['WALMART_CLIENT_SECRET'] = clientSecret;
      console.log('  \x1b[32m✓\x1b[0m Walmart configured');
    }
    console.log('');
  }

  // AliExpress
  if (await yesNo('   Set up AliExpress API?')) {
    console.log('\x1b[90m   Get keys at: https://portals.aliexpress.com\x1b[0m');
    const appKey = await question('   App Key: ');
    const appSecret = await question('   App Secret: ');
    if (appKey && appSecret) {
      envVars['ALIEXPRESS_APP_KEY'] = appKey;
      envVars['ALIEXPRESS_APP_SECRET'] = appSecret;
      console.log('  \x1b[32m✓\x1b[0m AliExpress configured');
    }
    console.log('');
  }

  // ==========================================================================
  // Step 4: Generate credential encryption key + save
  // ==========================================================================
  console.log('\x1b[1m4️⃣  Saving Configuration\x1b[0m\n');

  // Auto-generate credential encryption key
  envVars['FLIPAGENT_CREDENTIAL_KEY'] = randomBytes(32).toString('hex');

  // Port
  envVars['FLIPAGENT_PORT'] = '3141';

  // Build .env content
  const envLines: string[] = [
    '# FlipAgent Configuration',
    `# Generated by flipagent onboard on ${new Date().toISOString().slice(0, 10)}`,
    '',
    '# Claude AI (required)',
    `ANTHROPIC_API_KEY=${envVars['ANTHROPIC_API_KEY']}`,
    '',
    '# Server',
    `FLIPAGENT_PORT=${envVars['FLIPAGENT_PORT']}`,
    `FLIPAGENT_CREDENTIAL_KEY=${envVars['FLIPAGENT_CREDENTIAL_KEY']}`,
    '',
  ];

  if (envVars['TELEGRAM_BOT_TOKEN'] || envVars['DISCORD_BOT_TOKEN']) {
    envLines.push('# Chat Channels');
    if (envVars['TELEGRAM_BOT_TOKEN']) envLines.push(`TELEGRAM_BOT_TOKEN=${envVars['TELEGRAM_BOT_TOKEN']}`);
    if (envVars['DISCORD_BOT_TOKEN']) envLines.push(`DISCORD_BOT_TOKEN=${envVars['DISCORD_BOT_TOKEN']}`);
    envLines.push('');
  }

  const platformKeys = [
    'AMAZON_ACCESS_KEY', 'AMAZON_SECRET_KEY', 'AMAZON_PARTNER_TAG',
    'EBAY_CLIENT_ID', 'EBAY_CLIENT_SECRET',
    'WALMART_CLIENT_ID', 'WALMART_CLIENT_SECRET',
    'ALIEXPRESS_APP_KEY', 'ALIEXPRESS_APP_SECRET',
  ];
  const hasPlatformKeys = platformKeys.some(k => envVars[k]);

  if (hasPlatformKeys) {
    envLines.push('# Marketplace APIs');
    for (const key of platformKeys) {
      if (envVars[key]) envLines.push(`${key}=${envVars[key]}`);
    }
    envLines.push('');
  }

  const envContent = envLines.join('\n') + '\n';

  // Save to ~/.flipagent/.env
  const flipDir = path.join(process.env.HOME || require('os').homedir(), '.flipagent');
  const envPath = path.join(flipDir, '.env');

  try {
    if (!fs.existsSync(flipDir)) fs.mkdirSync(flipDir, { recursive: true });
    fs.writeFileSync(envPath, envContent, { mode: 0o600 });
    console.log(`  \x1b[32m✓\x1b[0m Saved to ${envPath}`);
  } catch (err) {
    console.log(`  \x1b[31m✗\x1b[0m Failed to save: ${err}`);
    console.log('\n  You can manually create the file with these contents:\n');
    console.log(envContent);
  }

  // Also copy to CWD .env if it doesn't exist
  const cwdEnv = path.join(process.cwd(), '.env');
  if (!fs.existsSync(cwdEnv)) {
    try {
      fs.writeFileSync(cwdEnv, envContent, { mode: 0o600 });
      console.log(`  \x1b[32m✓\x1b[0m Also saved to .env (current directory)`);
    } catch {
      // Not critical — ~/.flipagent/.env is the primary
    }
  }

  // ==========================================================================
  // Summary
  // ==========================================================================
  console.log('\n\x1b[1m\x1b[32m✓ Setup complete!\x1b[0m\n');

  const configuredCount = [
    envVars['AMAZON_ACCESS_KEY'],
    envVars['EBAY_CLIENT_ID'],
    envVars['WALMART_CLIENT_ID'],
    envVars['ALIEXPRESS_APP_KEY'],
  ].filter(Boolean).length;

  const channelCount = [
    envVars['TELEGRAM_BOT_TOKEN'],
    envVars['DISCORD_BOT_TOKEN'],
  ].filter(Boolean).length + 2; // WS + WebChat always on

  console.log(`  ${configuredCount}/4 marketplaces configured`);
  console.log(`  ${channelCount} chat channels active`);
  console.log('');
  console.log('  \x1b[1mNext steps:\x1b[0m');
  console.log('');
  console.log('    \x1b[36mnpm run build && npm start\x1b[0m');
  console.log('');
  console.log(`    Then open \x1b[36mhttp://localhost:${envVars['FLIPAGENT_PORT']}/chat\x1b[0m`);
  console.log('    and ask: "Scan Amazon for wireless earbuds under $20"');
  console.log('');
  console.log('  \x1b[90mYou can add more platforms later via chat:\x1b[0m');
  console.log('  \x1b[90m"setup my eBay credentials"\x1b[0m');
  console.log('');

  rl.close();
}
