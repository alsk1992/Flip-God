<p align="center">
  <img src="https://www.flip-god.com/logo.png" alt="FlipGod Logo" width="280">
</p>

<p align="center">
  <strong>AI-powered e-commerce arbitrage agent</strong>
  <br>
  <sub>Find, list, reprice, and fulfill — automatically</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen" alt="Node.js">
  <img src="https://img.shields.io/badge/typescript-5.3-blue" alt="TypeScript">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-yellow" alt="MIT License"></a>
  <img src="https://img.shields.io/badge/tools-435%2B-purple" alt="435+ Tools">
  <img src="https://img.shields.io/badge/platforms-15%2B-orange" alt="15+ Platforms">
  <img src="https://img.shields.io/badge/premium-token%20gated-blueviolet" alt="Token Gated">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#everything-it-does">Features</a> •
  <a href="#platforms-15">Platforms</a> •
  <a href="#premium-access">Premium</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#configuration">Config</a> •
  <a href="https://www.flip-god.com/docs">Docs</a>
</p>

---

**FlipGod** is a self-hosted AI agent that finds arbitrage opportunities across Amazon, eBay, Walmart, AliExpress and 15+ e-commerce platforms. It automatically scans for underpriced products, creates optimized listings, reprices competitively, and fulfills orders end-to-end. Built with TypeScript, powered by Claude, with 435+ tools.

Hold the FlipGod token on Solana for premium access — no subscriptions, no fees.

---

## Quick Start

```bash
git clone https://github.com/alsk1992/Flip-God.git
cd Flip-God
npm install
npm run build
npm start
```

The server starts on `http://localhost:3141`. Connect via WebSocket, Telegram, or Discord and chat:

```
"scan amazon for wireless earbuds under $20"
"compare prices for AirPods across all platforms"
"find arbitrage opportunities in electronics"
"create an eBay listing for this product"
```

<details>
<summary><strong>Channels</strong></summary>

- **WebSocket**: `ws://localhost:3141/ws`
- **Telegram**: Set `TELEGRAM_BOT_TOKEN` in .env
- **Discord**: Set `DISCORD_BOT_TOKEN` in .env

</details>

---

## Everything It Does

### At a Glance

| Category | What's Included |
|----------|-----------------|
| **Platforms** | 15+ integrations — Amazon PA-API + SP-API, eBay Browse + Inventory + Fulfillment, Walmart Affiliate + Marketplace, AliExpress Affiliate + Dropship, Target, Best Buy, Faire, Keepa, EasyPost, Ship24 |
| **Arbitrage** | Cross-platform price scanning, margin calculation, opportunity scoring, side-by-side comparison, auto-scout pipeline |
| **Listing** | AI-generated titles, descriptions, and keywords optimized for eBay and Amazon search algorithms |
| **Repricing** | Smart repricing daemon — algorithmic competitor tracking with real-time price adjustments to win the buy box |
| **Fulfillment** | 12-state order pipeline — sale detection → sourcing → purchasing → receiving → labeling → shipping → tracking push |
| **Inventory** | Multi-channel sync with buffer stock management, oversell protection, and cross-platform quantity sync |
| **Intelligence** | 6-signal demand scoring (velocity, stability, competitors, sentiment, search interest, margin), price history tracking, drop/spike detection |
| **Restrictions** | IP-restricted, gated, hazmat, and counterfeit-risk detection before you commit |
| **Accounting** | Per-SKU P&L, tax summaries, monthly trends, CSV/QuickBooks export, fee calculator |
| **Suppliers** | Supplier CRM with performance scoring, lead time tracking, and reorder alerts |
| **Returns** | Automated return handling, refund tracking, and restocking workflows |
| **Alerts** | Notifications for price drops, stock changes, new opportunities, and order updates |
| **Bulk Ops** | Mass edit listings, prices, and inventory across all platforms in a single command |
| **AI Engine** | Claude (Anthropic API) with 435+ tools across 95+ modules, dynamic tool loading |
| **Database** | SQLite (sql.js WASM) — zero external DB dependencies, 30 migrations |
| **Premium** | Solana SPL token gate — hold token = all features unlocked, zero fees |

---

### Source & Scan

- **Cross-platform arbitrage detection** — margin calculation, opportunity scoring, and side-by-side comparison across all connected platforms
- **Auto-scout pipeline** — configurable scouts that continuously scan and queue profitable products based on your criteria
- **Price intelligence** — historical price tracking, drop/spike detection, trend analysis, and automated buy/sell signals
- **Demand scoring** — 6-signal model incorporating velocity, stability, competitor count, review sentiment, search interest, and margin potential
- **Restriction checker** — detects IP-restricted, gated, hazmat, and counterfeit-risk products before you commit
- **Wholesale CSV import** — bulk analyze supplier spreadsheets with margin calculation per SKU

### Automate

- **Smart repricing daemon** — algorithmic competitor tracking with real-time price adjustments to win the buy box
- **Order-to-fulfillment chain** — 12-state pipeline from sale detection through sourcing, purchasing, receiving, labeling, shipping, and tracking push
- **Multi-channel inventory sync** — buffer stock management, oversell protection, and cross-platform quantity synchronization
- **Alert system** — notifications for price drops, stock changes, new opportunities, and order updates
- **Bulk operations** — mass edit listings, prices, and inventory across all connected platforms in a single command
- **Returns processing** — automated return handling, refund tracking, and restocking workflows

### Sell & Track

- **Listing creator** — AI-generated titles, descriptions, and keywords optimized for eBay and Amazon search algorithms
- **P&L accounting** — per-SKU profitability, tax summaries, monthly trends, and export to CSV or QuickBooks
- **Supplier CRM** — supplier management, performance scoring, lead time tracking, and reorder alerts
- **Web dashboard** — real-time metrics, active listings, and pipeline status at `/dashboard`
- **Fee calculator** — platform fees, shipping costs, and net margin calculation per product
- **Tax compliance** — multi-state tax calculations and exemption handling

---

## Platforms (15+)

| Platform | APIs | Capabilities |
|----------|------|--------------|
| **Amazon** | PA-API 5.0 + SP-API | Search, product data, sales rank, FBA fees, inventory, orders, reports |
| **eBay** | Browse + Inventory + Fulfillment + Account + Finances | Search, listings, orders, returns, seller analytics, taxonomy |
| **Walmart** | Affiliate + Marketplace | Product search, price comparison, seller integration |
| **AliExpress** | Affiliate + Dropship | Product sourcing, supplier data, shipping estimates, order tracking |
| **Target** | Redsky API | Product search, pricing, availability |
| **Best Buy** | Products API | Product data, pricing, store availability |
| **Faire** | Wholesale API | Wholesale sourcing, supplier discovery |
| **Keepa** | Price History | Historical pricing, sales rank tracking, drop alerts |
| **EasyPost** | Shipping | Multi-carrier rate comparison, label generation, tracking |
| **Ship24** | Tracking | Universal shipment tracking across carriers |

All platform adapters handle authentication, rate limiting, and response normalization. No SDK dependencies — all API calls use plain `fetch()` with HMAC/OAuth signing built in.

---

## Premium Access

FlipGod uses a **token-gated model** — hold the FlipGod SPL token on Solana to unlock all premium features. No subscriptions, no monthly fees.

| Feature | Free | Token Holder |
|---------|:----:|:------------:|
| Basic scanning | Yes | Yes |
| Cross-platform compare | 3 platforms | All 15+ |
| Auto-scout pipeline | — | Yes |
| Smart repricing | Manual | Automated |
| Fulfillment automation | Manual | Full auto |
| AI listing optimization | — | Yes |
| Demand scoring | Basic | Full 6-signal |
| Restriction checker | — | Yes |

**Setup:**

1. Create an account at [flip-god.com](https://flip-god.com)
2. Generate an API key on the Dashboard
3. Link your Solana wallet to verify token holdings
4. Add `FLIPGOD_API_KEY=fg_live_...` to your `.env`

Token balance checked via Solana `getTokenAccountsByOwner` RPC, cached for 3 hours. No API key = free tier with graceful degradation.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                     GATEWAY & CHANNELS                           │
│  HTTP • WebSocket • Telegram • Discord                          │
│  Auth • Rate Limiting • Session Management                       │
└─────────────────────────────┬────────────────────────────────────┘
                              │
┌─────────────────────────────┴────────────────────────────────────┐
│                      AI AGENT LAYER                              │
│  Claude (Anthropic API) • 435+ Tools • Dynamic Tool Loading     │
│  Memory • Context Management • Hook System                       │
└─────────────────────────────┬────────────────────────────────────┘
                              │
┌─────────────────────────────┴────────────────────────────────────┐
│                  AUTOMATION & INTELLIGENCE                        │
│  Auto-Scout • Smart Repricing • Fulfillment Pipeline            │
│  Arbitrage Scanner • Demand Scoring • Price Intelligence         │
│  Inventory Sync • Alert Engine • Bulk Operations                │
└─────────────────────────────┬────────────────────────────────────┘
                              │
    ┌────────────┬────────────┼────────────┬────────────┐
    ▼            ▼            ▼            ▼            ▼
┌──────────┐┌──────────┐┌──────────┐┌──────────┐┌──────────┐
│ Amazon   ││ eBay     ││ Walmart  ││ AliEx    ││ Others   │
│ PA-API   ││ Browse   ││ Affiliate││ Affiliate││ Target   │
│ SP-API   ││ Inventory││ Seller   ││ Dropship ││ BestBuy  │
│ FBA      ││ Fulfill  ││          ││ OAuth    ││ Faire    │
│          ││ Account  ││          ││          ││ Keepa    │
│          ││ Finances ││          ││          ││ EasyPost │
└──────────┘└──────────┘└──────────┘└──────────┘└──────────┘
                              │
              ┌───────────────┴───────────────┐
              │       DATA & BILLING          │
              ├───────────────────────────────┤
              │ SQLite: Products, orders,     │
              │   prices, suppliers, config   │
              │ Billing API: Railway Postgres │
              │ Token Gate: Solana SPL RPC    │
              └───────────────────────────────┘
```

**Key Design Decisions:**

- **sql.js (WASM SQLite)** — Zero native dependencies. Works everywhere Node runs.
- **No SDK dependencies** — All API calls use plain `fetch()` with HMAC/OAuth signing. Reduces dependency surface.
- **Tool registry pattern** — Tools registered declaratively with JSON schema. Agent auto-discovers them. Adding a tool = one handler function.
- **Credential encryption** — Platform API keys stored AES-256 encrypted in SQLite. Never logged, never sent to Claude.
- **Token-gated premium** — No Stripe, no subscriptions. Hold the FlipGod SPL token on Solana → premium. Revenue from token demand, not platform fees.
- **Separate billing service** — Billing API on Railway (always-on) with its own Postgres. Self-hosted agent calls it for validation/scoring. No API key = free tier.

---

## Cron Jobs

| Job | Schedule | What It Does |
|-----|----------|--------------|
| `scan_prices` | Every 15 min | Runs cross-platform arbitrage scan, stores opportunities |
| `check_orders` | Every 5 min | Polls eBay for new sales, creates fulfillment tasks |
| `reprice_check` | Every 30 min | Compares active listings against competitor prices |
| `inventory_sync` | Every 1 hour | Checks source platform stock, pauses OOS listings |
| `session_cleanup` | Daily | Removes sessions older than 30 days |
| `db_backup` | Every 6 hours | Saves SQLite WAL to disk |

---

## Configuration

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Premium (optional)
FLIPGOD_API_KEY=fg_live_...

# Platforms (add as needed)
AMAZON_ACCESS_KEY=...
AMAZON_SECRET_KEY=...
AMAZON_PARTNER_TAG=...
EBAY_CLIENT_ID=...
EBAY_CLIENT_SECRET=...
WALMART_API_KEY=...
ALIEXPRESS_APP_KEY=...
ALIEXPRESS_APP_SECRET=...
EASYPOST_API_KEY=...

# Channels (pick any)
TELEGRAM_BOT_TOKEN=...
DISCORD_BOT_TOKEN=...
```

Only `ANTHROPIC_API_KEY` is required to start. Platform credentials can be added incrementally as you connect each marketplace — or interactively through chat (e.g., `"setup amazon credentials"`).

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| Language | TypeScript + Node.js |
| AI Engine | Claude (Anthropic API) |
| Database | SQLite (sql.js WASM) — zero external DB dependencies |
| API Server | Express.js |
| Billing API | Railway (Postgres + Express) |
| Token Gate | Solana SPL token verification via RPC |
| Migrations | 30 database migrations |
| Tooling | 435+ tools across 95+ modules |

---

## Summary

| Category | Count |
|----------|------:|
| E-Commerce Platforms | **15+** |
| Tools | **435+** |
| Modules | **95+** |
| Database Migrations | **30** |
| Fulfillment States | **12** |
| Demand Signals | **6** |
| Cron Jobs | **6** |

---

## Development

```bash
npm run dev          # Hot reload
npm test             # Run tests
npm run typecheck    # Type check
npm run build        # Build
```

---

## License

MIT — see [LICENSE](./LICENSE)

---

<p align="center">
  <strong>FlipGod</strong> — AI-powered e-commerce arbitrage
  <br>
  <sub>Built with Claude by Anthropic</sub>
</p>

<p align="center">
  <a href="https://www.flip-god.com">Website</a> •
  <a href="https://www.flip-god.com/docs">Documentation</a> •
  <a href="https://github.com/alsk1992/Flip-God">GitHub</a>
</p>
