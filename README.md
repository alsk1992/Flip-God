# FlipAgent

AI-powered e-commerce arbitrage agent. Scans Amazon, eBay, Walmart, and AliExpress for price gaps, auto-creates listings, and handles order fulfillment — all through natural language chat.

## Features

- **Cross-Platform Scanning** — Search and compare prices across 4 major platforms in real-time
- **Arbitrage Detection** — Automatically find profitable buy-low/sell-high opportunities
- **Automated Listing** — Create optimized listings on eBay and Amazon from chat
- **Order Fulfillment** — Monitor sales, auto-purchase from source, push tracking
- **AI Agent** — 88 tools powered by Claude. Just describe what you want in plain English
- **Multi-Channel** — Chat via Telegram, Discord, WebSocket, or REST API
- **Price History** — Keepa integration for Amazon price/rank tracking
- **Shipping Rates** — EasyPost integration for USPS/UPS/FedEx rate comparison

## Quick Start

```bash
npm install
cp examples/.env.example .env
# Add your ANTHROPIC_API_KEY to .env
npm run build
npm start
```

```bash
curl http://localhost:3141/health
```

## Usage

Connect via WebSocket (`ws://localhost:3141/ws`) or Telegram/Discord and chat:

```
"Scan Amazon for wireless earbuds under $20"
"Compare AirPods prices across all platforms"
"Find arbitrage opportunities in electronics"
"Create an eBay listing for ASIN B09V3KXJPB"
"Check my orders"
"Track shipment 1Z999AA10123456784"
```

## Documentation

- [Getting Started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Platform Setup](docs/platforms.md)
- [Tool Reference](docs/tools.md)

## Tech Stack

- **Runtime**: Node.js 22+
- **AI**: Anthropic Claude (tool-calling agent)
- **Database**: SQLite via sql.js (WASM, zero native deps)
- **Server**: Express + WebSocket
- **Platforms**: Amazon PA-API/SP-API, eBay Browse/Inventory, Walmart Affiliate, AliExpress Affiliate

## License

MIT
