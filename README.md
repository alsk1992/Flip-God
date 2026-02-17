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
  <a href="./docs">Docs</a>
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

## Tools (185)

Every tool is callable by the AI agent via natural language. Just describe what you want.

### Platform Scanning — 15 tools

Scan 15+ e-commerce platforms in one command.

| Tool | What It Does |
|------|--------------|
| `scan_amazon` | Search Amazon products by keyword |
| `scan_ebay` | Search eBay listings and auctions |
| `scan_walmart` | Search Walmart product catalog |
| `scan_aliexpress` | Search AliExpress suppliers and products |
| `scan_bestbuy` | Search Best Buy electronics and deals |
| `scan_target` | Search Target inventory and pricing |
| `scan_costco` | Search Costco bulk/wholesale products |
| `scan_homedepot` | Search Home Depot tools and materials |
| `scan_poshmark` | Search Poshmark secondhand fashion |
| `scan_mercari` | Search Mercari Japan marketplace |
| `scan_facebook` | Search Facebook Marketplace local deals |
| `scan_faire` | Search Faire wholesale marketplace |
| `scan_bstock` | Search B-Stock liquidation auctions |
| `scan_bulq` | Search BULQ bulk liquidation lots |
| `scan_liquidation` | Search Liquidation.com wholesale pallets |

---

### Amazon — 25 tools

Full Amazon seller stack: PA-API 5.0 (research) + SP-API (selling).

<details>
<summary><strong>SP-API — Selling Partner (23 tools)</strong></summary>

| Tool | What It Does |
|------|--------------|
| `amazon_sp_search_catalog` | Search Amazon product catalog |
| `amazon_sp_get_catalog_item` | Get product info by ASIN |
| `amazon_sp_get_pricing` | Competitive pricing and buy box data |
| `amazon_sp_item_offers` | All offers competing on an ASIN |
| `amazon_sp_estimate_fees` | Calculate FBA/FBM seller fees |
| `amazon_sp_batch_fees` | Estimate fees for multiple ASINs |
| `amazon_sp_listing_restrictions` | Check gating and IP restrictions |
| `amazon_sp_create_listing` | Create or update product listings |
| `amazon_sp_delete_listing` | Remove listings |
| `amazon_sp_get_orders` | Retrieve seller orders |
| `amazon_sp_get_order_details` | Order line items and details |
| `amazon_sp_get_order_items` | Extract order item specifics |
| `amazon_sp_get_fba_inventory` | Check FBA stock levels |
| `amazon_sp_financial_events` | Reconcile sales, refunds, fees |
| `amazon_sp_order_metrics` | Aggregated order statistics |
| `amazon_sp_fulfillment_preview` | Preview Multi-Channel Fulfillment options |
| `amazon_sp_create_mcf_order` | Ship FBA inventory to non-Amazon buyers |
| `amazon_sp_confirm_shipment` | Confirm seller-fulfilled shipments |
| `amazon_sp_buy_shipping` | Purchase shipping labels |
| `amazon_sp_get_shipping_tracking` | Get shipment tracking |
| `amazon_sp_create_report` | Request inventory/orders/returns reports |
| `amazon_sp_get_report` | Poll and download report results |
| `amazon_sp_data_kiosk_query` | Run advanced analytics queries |

</details>

<details>
<summary><strong>PA-API — Product Advertising (2 tools)</strong></summary>

| Tool | What It Does |
|------|--------------|
| `browse_amazon_categories` | Browse category hierarchy by node IDs |
| `get_product_variations` | Get size/color variations for ASINs |

</details>

---

### eBay — 42 tools

Full eBay seller stack: Browse, Inventory, Fulfillment, Account, Finances, Marketing, Compliance.

<details>
<summary><strong>Core APIs (32 tools)</strong></summary>

| Tool | What It Does |
|------|--------------|
| `ebay_get_policies` | Retrieve fulfillment/payment/return policies |
| `ebay_create_policy` | Create new seller policies |
| `ebay_get_inventory` | List all inventory items |
| `ebay_get_inventory_item` | Get single item by SKU |
| `ebay_bulk_create_inventory` | Batch create inventory items |
| `ebay_get_offers_for_sku` | Get all offers for an inventory SKU |
| `ebay_bulk_update` | Bulk update prices and quantities |
| `ebay_create_inventory_location` | Set up warehouse locations |
| `ebay_get_inventory_locations` | List all warehouse locations |
| `ebay_category_suggest` | Get category recommendations |
| `ebay_item_aspects` | Get required category fields |
| `ebay_item_conditions` | Allowed condition types per category |
| `ebay_batch_get_items` | Get multiple items (up to 20) |
| `ebay_legacy_item` | Look up by legacy item ID |
| `ebay_sold_items` | Search recently sold comps |
| `ebay_search_by_image` | Visual similarity search |
| `ebay_send_offer` | Send buyer offers |
| `ebay_issue_refund` | Process refunds |
| `ebay_get_transactions` | Sales and refund history |
| `ebay_get_payouts` | Payout history |
| `ebay_funds_summary` | Check seller balance |
| `ebay_transaction_summary` | Aggregate P&L data |
| `ebay_payout_detail` | Specific payout details |
| `ebay_traffic_report` | Views, CTR, conversion analytics |
| `ebay_seller_metrics` | Defect rate and performance |
| `ebay_create_campaign` | Create Promoted Listings campaigns |
| `ebay_get_campaigns` | List active campaigns |
| `ebay_promote_listings` | Add items to promotions |
| `ebay_listing_violations` | Check compliance issues |
| `ebay_violations_summary` | Count violations by type |
| `ebay_suppress_violation` | Acknowledge violations |
| `ebay_marketplace_return_policies` | Category return options |

</details>

<details>
<summary><strong>Extended APIs (10 tools)</strong></summary>

| Tool | What It Does |
|------|--------------|
| `ebay_search_catalog` | Search product catalog by GTIN/UPC |
| `ebay_get_catalog_product` | Get catalog product by ePID |
| `ebay_shipping_quote` | Get carrier rates for a package |
| `ebay_create_shipment` | Purchase shipping labels |
| `ebay_download_label` | Download label PDFs |
| `ebay_create_feed_task` | Bulk upload via feeds |
| `ebay_get_feed_task` | Check feed task status |
| `ebay_create_notification` | Set up webhooks |
| `ebay_subscribe_notification` | Subscribe to event topics |
| `ebay_get_notification_topics` | List available topics |

</details>

---

### Walmart — 26 tools

Marketplace seller operations + affiliate research.

<details>
<summary><strong>Marketplace Seller (18 tools)</strong></summary>

| Tool | What It Does |
|------|--------------|
| `walmart_get_seller_items` | List all seller catalog items |
| `walmart_create_item` | Create new listings |
| `walmart_update_item` | Update existing listings |
| `walmart_retire_item` | Delist items |
| `walmart_update_price` | Change prices |
| `walmart_update_inventory` | Change stock levels |
| `walmart_bulk_update_prices` | Batch price updates |
| `walmart_bulk_update_inventory` | Batch inventory updates |
| `walmart_get_inventory` | Check current stock |
| `walmart_get_orders` | Retrieve orders |
| `walmart_acknowledge_order` | Acknowledge receipt |
| `walmart_cancel_order` | Cancel order lines |
| `walmart_ship_order` | Mark shipped with tracking |
| `walmart_refund_order` | Process refunds |
| `walmart_get_returns` | List return requests |
| `walmart_get_return` | Get return details |
| `walmart_feed_status` | Check feed submission status |
| `walmart_listing_quality` | Get listing quality scores |

</details>

<details>
<summary><strong>Affiliate + Research (8 tools)</strong></summary>

| Tool | What It Does |
|------|--------------|
| `walmart_upc_lookup` | Look up products by UPC |
| `walmart_trending` | Find trending products |
| `walmart_taxonomy` | Browse category tree |
| `walmart_reviews` | Get product reviews |
| `walmart_nearby_stores` | Find nearby Walmart stores |
| `walmart_recommendations` | Get similar product suggestions |
| `walmart_catalog_search` | Search catalog |
| `walmart_repricer` | Create repricing rules |

</details>

---

### AliExpress — 9 tools

Dropshipping sourcing and fulfillment.

| Tool | What It Does |
|------|--------------|
| `aliexpress_image_search` | Reverse image search for suppliers |
| `aliexpress_ds_feed` | Get dropshipping recommendations |
| `aliexpress_ds_product_detail` | Get variants, pricing, and shipping |
| `aliexpress_ds_tracking` | Track dropship orders |
| `aliexpress_query_freight` | Check shipping options and costs |
| `aliexpress_affiliate_orders` | Get affiliate commissions |
| `aliexpress_generate_affiliate_link` | Create tracking links |
| `aliexpress_create_dispute` | Open disputes |
| `aliexpress_dispute_detail` | Check dispute status |

---

### Other Platforms — 8 tools

| Tool | What It Does |
|------|--------------|
| `bestbuy_on_sale` | Get sale items |
| `bestbuy_open_box` | Get open-box deals |
| `bestbuy_stores` | Find store locations |
| `bestbuy_product_availability` | Check in-store stock |
| `bestbuy_get_categories` | Browse categories |
| `target_store_availability` | Check Target in-store stock |
| `poshmark_closet` | Browse seller listings |
| `mercari_seller_profile` | Get seller info |

---

### Arbitrage & Intelligence — 9 tools

| Tool | What It Does |
|------|--------------|
| `compare_prices` | Side-by-side price comparison across platforms |
| `find_arbitrage` | Find margin opportunities automatically |
| `match_products` | Match same product across platforms |
| `competitor_watch` | Monitor competitor pricing changes |
| `get_price_history` | Historical price trend data |
| `keepa_price_history` | Amazon price history via Keepa |
| `keepa_deals` | Find Amazon price drops and deals |
| `keepa_bestsellers` | Get bestselling ASINs by category |
| `keepa_track_product` | Set up price drop alerts |

---

### Listing & Optimization — 9 tools

| Tool | What It Does |
|------|--------------|
| `create_ebay_listing` | Create optimized eBay listings |
| `create_amazon_listing` | Create Amazon product offers |
| `optimize_listing` | AI-optimize titles, descriptions, and keywords |
| `update_listing_price` | Change listing prices |
| `bulk_list` | Batch create listings across platforms |
| `pause_listing` | Temporarily hide listings |
| `resume_listing` | Restore paused listings |
| `delete_listing` | Remove listings |
| `fba_create_fulfillment` | Create Multi-Channel Fulfillment orders |

---

### Inventory & Warehouse — 8 tools

| Tool | What It Does |
|------|--------------|
| `warehouse_list` | List all warehouse locations |
| `warehouse_create` | Create new warehouse |
| `warehouse_inventory` | Check warehouse stock levels |
| `warehouse_update_stock` | Update stock quantities |
| `warehouse_transfer` | Move stock between locations |
| `inventory_sync` | Sync levels across all platforms |
| `batch_reprice` | Batch price updates |
| `fba_check_inventory` | Check FBA stock levels |

---

### Fulfillment & Shipping — 11 tools

| Tool | What It Does |
|------|--------------|
| `check_orders` | View order status across platforms |
| `auto_purchase` | Auto-buy from source (dropship) |
| `track_shipment` | Get tracking info |
| `track_package` | Universal package tracking |
| `update_tracking` | Push tracking to buyer |
| `handle_return` | Process returns |
| `get_shipping_cost` | Quote shipping costs |
| `get_shipping_rates` | Compare multi-carrier rates |
| `buy_shipping_label` | Purchase shipping labels |
| `verify_address` | Validate shipping addresses |
| `fba_check_fulfillment` | Check MCF fulfillment status |

---

### Analytics & Reporting — 6 tools

| Tool | What It Does |
|------|--------------|
| `daily_report` | Generate daily activity summary |
| `profit_dashboard` | P&L breakdown by period |
| `calculate_profit` | Calculate per-order profit |
| `category_analysis` | Analyze category profitability |
| `top_opportunities` | Rank best arbitrage opportunities |
| `fee_calculator` | Estimate platform fees and net margin |

---

### Credentials & Setup — 11 tools

| Tool | What It Does |
|------|--------------|
| `setup_amazon_credentials` | Configure Amazon PA-API keys |
| `setup_amazon_sp_credentials` | Configure Amazon SP-API keys |
| `setup_ebay_credentials` | Configure eBay OAuth |
| `setup_walmart_credentials` | Configure Walmart API keys |
| `setup_walmart_seller_credentials` | Configure Walmart Seller API |
| `setup_aliexpress_credentials` | Configure AliExpress keys |
| `setup_aliexpress_oauth` | Complete AliExpress OAuth flow |
| `setup_keepa_credentials` | Configure Keepa API |
| `setup_easypost_credentials` | Configure EasyPost API |
| `list_credentials` | View configured platforms |
| `delete_credentials` | Remove platform credentials |

---

### Utility — 7 tools

| Tool | What It Does |
|------|--------------|
| `tool_search` | Search available tools by intent |
| `get_product_details` | Get full product info by ID |
| `check_stock` | Check product availability |
| `get_aliexpress_categories` | Browse AliExpress category tree |
| `get_hot_products` | Find trending products |
| `get_ds_order_status` | Check dropship order status |
| `match_products` | Cross-platform product matching |

---

## Features

### Source & Scan

- **Cross-platform arbitrage** — margin calculation, scoring, and comparison across all 15+ platforms
- **Auto-scout pipeline** — configurable scouts that continuously scan and queue profitable products
- **Price intelligence** — historical tracking, drop/spike detection, trend analysis, buy/sell signals
- **6-signal demand scoring** — velocity, stability, competitor count, sentiment, search interest, margin
- **Restriction checker** — IP-restricted, gated, hazmat, and counterfeit-risk detection
- **Wholesale CSV import** — bulk analyze supplier spreadsheets with per-SKU margin calculation

### Automate

- **Smart repricing** — algorithmic competitor tracking with real-time buy box adjustments
- **12-state fulfillment** — sale detection → sourcing → purchasing → receiving → labeling → shipping → tracking
- **Inventory sync** — buffer stock, oversell protection, cross-platform quantity sync
- **Alert engine** — price drops, stock changes, new opportunities, order updates
- **Bulk operations** — mass edit listings, prices, and inventory in one command
- **Returns processing** — automated return handling, refund tracking, restocking

### Sell & Track

- **AI listing creator** — optimized titles, descriptions, and keywords for eBay and Amazon SEO
- **P&L accounting** — per-SKU profitability, tax summaries, trends, CSV/QuickBooks export
- **Supplier CRM** — performance scoring, lead time tracking, reorder alerts
- **Fee calculator** — platform fees, shipping costs, net margin per product
- **Tax compliance** — multi-state calculations and exemption handling

---

## Platforms (15+)

| Platform | APIs | Tools | Capabilities |
|----------|------|:-----:|--------------|
| **Amazon** | PA-API 5.0 + SP-API | 25 | Search, catalog, pricing, fees, FBA, orders, reports, shipping, MCF |
| **eBay** | Browse + Inventory + Fulfillment + Account + Finances + Marketing | 42 | Search, listings, orders, returns, analytics, promotions, shipping, compliance |
| **Walmart** | Affiliate + Marketplace | 26 | Search, listings, orders, returns, repricing, inventory, UPC lookup |
| **AliExpress** | Affiliate + Dropship | 9 | Image search, sourcing, variants, tracking, disputes, shipping |
| **Target** | Redsky API | 2 | Product search, pricing, store availability |
| **Best Buy** | Products API | 5 | Search, deals, open-box, store availability, categories |
| **Faire** | Wholesale API | 1 | Wholesale sourcing and supplier discovery |
| **Keepa** | Price History API | 4 | Historical pricing, sales rank tracking, deals, alerts |
| **EasyPost** | Shipping API | 3 | Multi-carrier rates, label generation, tracking |
| **Ship24** | Tracking API | 1 | Universal shipment tracking |
| **Costco** | Web API | 1 | Bulk/wholesale sourcing |
| **Home Depot** | Web API | 1 | Home improvement products |
| **Poshmark** | Web API | 1 | Secondhand fashion |
| **Mercari** | Web API | 1 | Japanese marketplace |
| **Facebook** | Marketplace API | 1 | Local deals |
| **B-Stock** | Web API | 1 | Liquidation auctions |
| **BULQ** | Web API | 1 | Bulk liquidation lots |
| **Liquidation.com** | Web API | 1 | Wholesale pallets |

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

1. Register via the billing API: `POST https://billing-api-production-28ad.up.railway.app/auth/register`
2. Login to get a JWT: `POST /auth/login`
3. Create an API key: `POST /keys` (returns full key once — save it)
4. Link your Solana wallet: `POST /wallet/link`
5. Add `FLIPGOD_API_KEY=fg_live_...` to your `.env`

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
  <a href="./docs">Documentation</a> •
  <a href="https://github.com/alsk1992/Flip-God">GitHub</a>
</p>
