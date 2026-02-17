# Architecture

## Overview

FlipAgent is a modular AI agent that orchestrates e-commerce arbitrage across Amazon, eBay, Walmart, and AliExpress. It uses Claude as the reasoning engine, with 88 tools for searching, listing, fulfilling, and analyzing.

```
User's machine (self-hosted)              Railway (billing-api)
┌─────────────────────────────────────┐   ┌─────────────────────────┐
│              Gateway                │   │  POST /validate         │
│  (orchestrates services, HTTP/WS)   │   │  POST /premium/score    │
├────────────┬──────────┬─────────────┤   │  POST /premium/optimize │
│  Channels  │  Agent   │  Cron/Queue │   │  POST /usage/report     │
│ (TG/DC/WS) │ (Claude) │  (jobs)     │   │  GET  /wallet           │
├────────────┴──────────┴─────────────┤   ├─────────────────────────┤
│           Tool Registry             │──▶│  Solana Token Gate       │
│         (435+ tools, 5 skills)      │   │  (SPL balance → premium) │
├──────┬──────┬──────┬──────┬─────────┤   ├─────────────────────────┤
│Amazon│ eBay │Walmt │AliEx │ Keepa/  │   │  Postgres (Railway)     │
│PA+SP │Browse│Affil │Affil │EasyPost │   └─────────────────────────┘
├──────┴──────┴──────┴──────┴─────────┤
│ Arbitrage │ Listing │ Fulfillment   │
│ Scanner   │ Creator │ Monitor       │
├───────────┤         ├───────────────┤
│ Premium   │         │      DB       │
│ Client    │─────────│    sql.js     │
└───────────┴─────────┴───────────────┘
```

## Directory Structure

```
src/
├── gateway/          # Main orchestrator + HTTP server
│   ├── index.ts      # createGateway() — wires everything
│   └── server.ts     # Express + WebSocket server
├── agents/           # Claude AI agent + tool dispatch
│   └── index.ts      # 435+ tool handlers
├── platforms/        # Platform API adapters
│   ├── amazon/       # PA-API 5.0 + SP-API
│   ├── ebay/         # Browse + Inventory + Fulfillment
│   ├── walmart/      # Affiliate + Seller
│   ├── aliexpress/   # Affiliate + Dropship
│   ├── keepa/        # Price history tracking
│   └── easypost/     # Shipping rate comparison
├── premium/          # Premium client (talks to billing API)
│   ├── client.ts     # HTTP client to billing-api on Railway
│   ├── cache.ts      # 60s validation cache
│   └── index.ts      # initPremiumClient() factory
├── arbitrage/        # Cross-platform price scanner
├── listing/          # Listing creation + optimization
├── fulfillment/      # Order monitoring + auto-purchase
├── channels/         # Telegram, Discord, WebSocket, Web Chat
├── sessions/         # User session management
├── credentials/      # Encrypted credential storage
├── memory/           # Persistent user memory + context
├── cron/             # Scheduled jobs
├── queue/            # Message batching + debounce
├── hooks/            # Event hooks (before/after message, etc.)
├── skills/           # Bundled skill definitions (SKILL.md)
├── mcp/              # Model Context Protocol server
├── db/               # SQLite (sql.js WASM) database
├── infra/            # Retry, circuit breaker, rate limiter
├── utils/            # Logger, HTTP client, sanitization
└── types.ts          # Shared type definitions

billing-api/            # Separate service deployed on Railway
├── src/
│   ├── auth/           # JWT auth + API key middleware
│   ├── billing/        # Usage tracking + Solana token gate
│   ├── api/            # Express routes
│   ├── db/             # Postgres + migrations
│   └── utils/          # Logger, crypto helpers
└── package.json

site/                   # Frontend (Vercel)
├── src/
│   ├── pages/          # Login, Signup, Dashboard, Billing
│   ├── components/     # AuthProvider, ProtectedRoute
│   ├── hooks/          # useAuth
│   └── lib/            # API client
└── package.json
```

## Data Flow

1. **Message arrives** via Telegram, Discord, or WebSocket
2. **Channel manager** normalizes it to `IncomingMessage`
3. **Hook system** runs `message:before` (can modify/cancel)
4. **Session manager** retrieves or creates user session
5. **Agent manager** sends message + tools to Claude
6. Claude picks tools → **tool handlers** execute platform API calls
7. Results flow back through Claude → final response text
8. **Channel manager** sends response to the originating channel
9. **Hook system** runs `message:after`

## Key Design Decisions

- **sql.js (WASM SQLite)** — Zero native dependencies. Works everywhere Node runs. No `better-sqlite3` build issues.
- **CommonJS** — Maximum compatibility with npm ecosystem. No ESM import headaches.
- **No SDK dependencies for platforms** — All API calls use plain `fetch()` with HMAC/OAuth signing built in. Reduces dependency surface.
- **Tool registry pattern** — Tools are registered declaratively with JSON schema. Agent manager auto-discovers them. Adding a tool = adding one handler function.
- **Credential encryption** — Platform API keys stored AES-256 encrypted in SQLite. Never logged, never sent to Claude.
- **Token-gated premium** — No Stripe, no subscriptions. Hold the FlipGod SPL token on Solana to unlock premium. Billing API checks token balance via raw Solana JSON RPC (3-hour cache). Revenue comes from token demand, not platform fees.
- **Separate billing service** — Billing API runs on Railway (always-on) with its own Postgres. The self-hosted agent calls it for validation/scoring. Graceful degradation: no API key = free tier.

## Cron Jobs

| Job | Schedule | What It Does |
|-----|----------|--------------|
| `scan_prices` | Every 15 min | Runs cross-platform arbitrage scan, stores opportunities |
| `check_orders` | Every 5 min | Polls eBay for new sales, creates fulfillment tasks |
| `reprice_check` | Every 30 min | Compares active listings against competitor prices |
| `inventory_sync` | Every 1 hour | Checks source platform stock, pauses OOS listings |
| `session_cleanup` | Daily | Removes sessions older than 30 days |
| `db_backup` | Every 6 hours | Saves SQLite WAL to disk |
