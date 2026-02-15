# Getting Started

## Prerequisites

- **Node.js 22+** (required)
- **Anthropic API key** (for Claude AI agent)
- Platform API keys (optional — add as needed)

## Installation

```bash
git clone https://github.com/alsk1992/flipagent.git
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

## Next Steps

- [Architecture Overview](./architecture.md)
- [Platform Setup](./platforms.md)
- [Tool Reference](./tools.md)
