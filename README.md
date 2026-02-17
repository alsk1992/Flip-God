# FlipGod

**AI-Powered E-Commerce Arbitrage Agent**

Website: [https://www.flip-god.com/](https://www.flip-god.com/)

---

FlipGod is a self-hosted AI agent that finds arbitrage opportunities across Amazon, eBay, Walmart, AliExpress and 15+ e-commerce platforms. It automatically scans for underpriced products, creates optimized listings, reprices competitively, and fulfills orders end-to-end. Built with TypeScript, powered by Claude, with 435+ tools. Hold the FlipGod token on Solana for premium access -- no subscriptions, no fees.

---

## Features

### Source & Scan

- **15+ platform integrations** -- Amazon PA-API + SP-API, eBay Browse + Inventory + Fulfillment, Walmart Affiliate + Marketplace, AliExpress Affiliate, Target, Best Buy, Faire, Keepa, EasyPost, Ship24
- **Cross-platform arbitrage detection** -- margin calculation, opportunity scoring, and side-by-side comparison across all connected platforms
- **Auto-scout pipeline** -- configurable scouts that continuously scan and queue profitable products based on your criteria
- **Price intelligence** -- historical price tracking, drop/spike detection, trend analysis, and automated buy/sell signals
- **Demand scoring** -- 6-signal model incorporating velocity, stability, competitor count, review sentiment, search interest, and margin potential
- **Restriction checker** -- detects IP-restricted, gated, hazmat, and counterfeit-risk products before you commit

### Automate

- **Smart repricing daemon** -- algorithmic competitor tracking with real-time price adjustments to win the buy box
- **Order-to-fulfillment chain** -- 12-state pipeline from sale detection through sourcing, purchasing, receiving, labeling, shipping, and tracking push
- **Multi-channel inventory sync** -- buffer stock management, oversell protection, and cross-platform quantity synchronization
- **Alert system** -- notifications for price drops, stock changes, new opportunities, and order updates
- **Bulk operations** -- mass edit listings, prices, and inventory across all connected platforms in a single command
- **Returns processing** -- automated return handling, refund tracking, and restocking workflows

### Sell & Track

- **Listing creator** -- AI-generated titles, descriptions, and keywords optimized for eBay and Amazon search algorithms
- **P&L accounting** -- per-SKU profitability, tax summaries, monthly trends, and export to CSV or QuickBooks
- **Supplier CRM** -- supplier management, performance scoring, lead time tracking, and reorder alerts
- **Web dashboard** -- real-time metrics, active listings, and pipeline status at `/dashboard`
- **Fee calculator** -- platform fees, shipping costs, and net margin calculation per product
- **Tax compliance** -- multi-state tax calculations and exemption handling

---

## Quick Start

```bash
git clone https://github.com/alsk1992/Flip-God.git
cd flip-god
npm install
npm run build
npm start
```

Then chat:

```
scan amazon for wireless earbuds under $20
```

---

## Configuration

Set credentials via environment variables or interactively through chat (e.g., `"setup amazon credentials"`).

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key for Claude |
| `FLIPGOD_API_KEY` | No | FlipGod API key for premium features (get one at flip-god.com) |
| `AMAZON_ACCESS_KEY` | No | Amazon PA-API access key |
| `AMAZON_SECRET_KEY` | No | Amazon PA-API secret key |
| `AMAZON_PARTNER_TAG` | No | Amazon Associates partner tag |
| `EBAY_CLIENT_ID` | No | eBay developer application client ID |
| `EBAY_CLIENT_SECRET` | No | eBay developer application client secret |
| `WALMART_API_KEY` | No | Walmart Affiliate API key |
| `ALIEXPRESS_APP_KEY` | No | AliExpress affiliate application key |
| `ALIEXPRESS_APP_SECRET` | No | AliExpress affiliate application secret |
| `EASYPOST_API_KEY` | No | EasyPost shipping API key |

Only `ANTHROPIC_API_KEY` is required to start. Platform credentials can be added incrementally as you connect each marketplace.

### Premium Access

FlipGod uses a token-gated model -- hold the FlipGod token on Solana to unlock all premium features with zero fees. No subscriptions required.

1. Create an account at [flip-god.com](https://flip-god.com)
2. Generate an API key on the Dashboard
3. Link your Solana wallet to verify token holdings
4. Add `FLIPGOD_API_KEY=fg_live_...` to your `.env`

Premium features (full 6-signal scoring, AI listing optimization, auto-scout pipeline, smart repricing, fulfillment automation, restriction checker) activate automatically when your linked wallet holds the token.

---

## Tech Stack

| Component | Technology |
|---|---|
| Language | TypeScript + Node.js |
| Database | SQLite (sql.js WASM) -- zero external DB dependencies |
| API Server | Express.js |
| AI Engine | Claude (Anthropic API) |
| Billing API | Railway (Postgres + Express) |
| Token Gate | Solana SPL token verification via RPC |
| Migrations | 30 database migrations |
| Tooling | 435+ tools across 95+ modules |

---

## Architecture

FlipGod is built around a conversational agent loop powered by Claude. The core architecture consists of:

- **Agent Loop** -- receives user messages, selects and executes tools, and returns structured results through an iterative reasoning cycle
- **Tool Registry** -- dynamic tool loading system that manages 435+ tools, loading only what is needed per request to minimize token usage
- **Platform Adapters** -- dedicated adapter modules for each e-commerce API (Amazon, eBay, Walmart, AliExpress, etc.), handling authentication, rate limiting, and response normalization
- **Automation Daemons** -- modular background processes for continuous operations including the scout (product scanning), repricer (competitive pricing), and fulfillment (order processing) pipelines
- **SQLite Persistence** -- all data (products, orders, prices, suppliers, analytics) stored in a local SQLite database via sql.js WASM, requiring no external database setup

---

## License

MIT

---

## Links

- **Website**: [https://www.flip-god.com/](https://www.flip-god.com/)
- **Documentation**: [https://www.flip-god.com/docs](https://www.flip-god.com/docs)
- **GitHub**: [https://github.com/alsk1992/Flip-God](https://github.com/alsk1992/Flip-God)
