# Getting Started

## Prerequisites

- **Node.js 22+** (required)
- **Anthropic API key** (for Claude AI agent)
- Platform API keys (optional — add as needed)

## Installation

```bash
git clone https://github.com/alsk1992/Flip-God.git
cd Flip-God
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

On startup you'll see the FlipGod banner:

```
  ███████╗██╗     ██╗██████╗  ██████╗  ██████╗ ██████╗
  ██╔════╝██║     ██║██╔══██╗██╔════╝ ██╔═══██╗██╔══██╗
  █████╗  ██║     ██║██████╔╝██║  ███╗██║   ██║██║  ██║
  ██╔══╝  ██║     ██║██╔═══╝ ██║   ██║██║   ██║██║  ██║
  ██║     ███████╗██║██║     ╚██████╔╝╚██████╔╝██████╔╝
  ╚═╝     ╚══════╝╚═╝╚═╝      ╚═════╝  ╚═════╝ ╚═════╝
  AI-powered e-commerce arbitrage · 185 tools · 18 platforms

  [FG] FlipGod is live.
```

The server starts on port 3141 by default (configurable via `FLIPAGENT_PORT`).

## Verify It Works

```bash
curl http://localhost:3141/health
# → {"status":"healthy","uptime":...}
```

## Talk to FlipGod

Connect via any supported channel:

- **WebSocket**: `ws://localhost:3141/ws` — connect message: `[FG] Connected — 185 tools, 18 platforms`
- **Telegram**: Set `TELEGRAM_BOT_TOKEN` in .env — `/start` shows `[FG] Welcome to FlipGod`
- **Discord**: Set `DISCORD_BOT_TOKEN` in .env

Then just ask:

```
"scan amazon for wireless earbuds under $20"
"compare prices for AirPods across all platforms"
"find arbitrage in electronics"
"create an eBay listing for this product"
```

All responses from scans and analyses are prefixed with `[FG]`:

```
[FG] Found 12 opportunities across 4 platforms

| # | Product | Source | Buy | Sell | Margin |
|---|---------|--------|-----|------|--------|
| 1 | Sony WH-1000XM5 | Amazon | $248.00 | $329.99 | 33% |
...

[FG] Done — 47 products scanned, 12 opportunities found
```

## The `[FG]` Callsign

FlipGod uses `[FG]` as its callsign across every touchpoint:

| Where | Example |
|-------|---------|
| Scan results | `[FG] Found 12 opportunities across 4 platforms` |
| Workflow status | `[FG] Done — 3 listings created` |
| Startup logs | `[FG] FlipGod is live` |
| WebSocket connect | `[FG] Connected — 185 tools, 18 platforms` |
| Telegram welcome | `[FG] Welcome to FlipGod` |
| Dashboard header | `[FG] FlipGod Dashboard` |
| CLI status | `[FG] FlipGod Status` |
| Email alerts | `FlipGod Alert: Price Drop on Sony WH-1000XM5` |
| Discord embeds | Footer: `FlipGod | alert-id` |

## Premium Features

FlipGod has a free tier and a premium tier. Premium is unlocked by holding the FlipGod token on Solana — no subscriptions, no fees.

1. Register via the billing API:
   ```bash
   curl -X POST https://billing-api-production-28ad.up.railway.app/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email": "you@example.com", "password": "your_password"}'
   ```
2. Login to get a JWT:
   ```bash
   curl -X POST https://billing-api-production-28ad.up.railway.app/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email": "you@example.com", "password": "your_password"}'
   ```
3. Create an API key (save the key — it's shown only once):
   ```bash
   curl -X POST https://billing-api-production-28ad.up.railway.app/keys \
     -H "Authorization: Bearer YOUR_JWT_TOKEN"
   ```
4. Link your Solana wallet to verify token holdings
5. Add to your `.env`:
   ```
   FLIPGOD_API_KEY=fg_live_your_key_here
   ```

Premium unlocks: full 6-signal demand scoring, AI listing optimization, auto-scout pipeline, smart repricing, fulfillment automation, and the restriction checker.

Without `FLIPGOD_API_KEY`, the agent runs in free tier (basic scanning, 3-platform compare, manual repricing).

## Next Steps

- [Architecture Overview](./architecture.md)
- [Platform Setup](./platforms.md)
- [Tool Reference](./tools.md)
