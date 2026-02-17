# Getting Started

## Prerequisites

- **Node.js 22+** (required)
- **Anthropic API key** (for Claude AI agent)
- Platform API keys (optional — add as needed)

## Installation

```bash
git clone https://github.com/alsk1992/Flip-God.git
cd flipagent
npm install
```

## Configuration

Copy the example env file and fill in your keys:

```bash
cp examples/.env.example .env
```

Required:
```
ANTHROPIC_API_KEY=sk-ant-...
```

Optional platform credentials (add later via chat):
```
AMAZON_ACCESS_KEY=...
AMAZON_SECRET_KEY=...
AMAZON_PARTNER_TAG=...

EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...

WALMART_CLIENT_ID=...
WALMART_CLIENT_SECRET=...

ALIEXPRESS_APP_KEY=...
ALIEXPRESS_APP_SECRET=...
```

## Build & Run

```bash
npm run build
npm start
```

The server starts on port 3141 by default (configurable via `FLIPAGENT_PORT`).

## Verify It Works

```bash
curl http://localhost:3141/health
# → {"status":"healthy","uptime":...}
```

## Talk to FlipAgent

Connect via any supported channel:

- **WebSocket**: `ws://localhost:3141/ws`
- **Telegram**: Set `TELEGRAM_BOT_TOKEN` in .env
- **Discord**: Set `DISCORD_BOT_TOKEN` in .env

Then just ask:

```
"Scan Amazon for wireless earbuds under $20"
"Compare prices for AirPods across all platforms"
"Find arbitrage opportunities in electronics"
"Create an eBay listing for this product"
```

## Premium Features

FlipGod has a free tier and a premium tier. Premium is unlocked by holding the FlipGod token on Solana -- no subscriptions, no fees.

1. Sign up at [flip-god.com](https://flip-god.com)
2. Create an API key on the Dashboard page
3. Link your Solana wallet to verify token holdings
4. Add to your `.env`:
   ```
   FLIPGOD_API_KEY=fg_live_your_key_here
   ```

Premium unlocks: full 6-signal demand scoring, AI listing optimization, auto-scout pipeline, smart repricing, fulfillment automation, and the restriction checker.

Without `FLIPGOD_API_KEY`, the agent runs in free tier (basic scanning, 3-platform compare, manual repricing).

## Next Steps

- [Architecture Overview](./architecture.md)
- [Platform Setup](./platforms.md)
- [Tool Reference](./tools.md)
