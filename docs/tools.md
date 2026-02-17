# Tool Reference

FlipGod exposes 185 tools to the AI agent. Below is a quick reference of the main categories. For the full list with descriptions, see the [README](../README.md#tools-185).

## Scanning & Search (15 tools)

| Tool | Description |
|------|-------------|
| `scan_amazon` | Search Amazon products by keyword |
| `scan_ebay` | Search eBay listings |
| `scan_walmart` | Search Walmart products |
| `scan_aliexpress` | Search AliExpress products |
| `scan_bestbuy` | Search Best Buy electronics |
| `scan_target` | Search Target inventory |
| `scan_costco` | Search Costco bulk products |
| `scan_homedepot` | Search Home Depot products |
| `scan_poshmark` | Search Poshmark fashion |
| `scan_mercari` | Search Mercari Japan marketplace |
| `scan_facebook` | Search Facebook Marketplace |
| `scan_faire` | Search Faire wholesale |
| `scan_bstock` | Search B-Stock liquidation |
| `scan_bulq` | Search BULQ bulk liquidation |
| `scan_liquidation` | Search Liquidation.com pallets |

## Amazon (25 tools)

SP-API seller operations + PA-API product research. Includes catalog search, pricing, fees, FBA inventory, orders, reports, shipping, Multi-Channel Fulfillment, and analytics queries.

## eBay (42 tools)

Browse, Inventory, Fulfillment, Account, Finances, Marketing, Compliance. Includes listings, bulk operations, shipping labels, refunds, traffic analytics, Promoted Listings campaigns, feed uploads, and webhooks.

## Walmart (26 tools)

Marketplace seller operations (listings, orders, returns, repricing) + Affiliate research (UPC lookup, trending, taxonomy, reviews, store finder).

## AliExpress (9 tools)

Dropshipping sourcing and fulfillment. Image search, product detail, freight queries, tracking, disputes, and affiliate links.

## Arbitrage & Intelligence (9 tools)

| Tool | Description |
|------|-------------|
| `compare_prices` | Compare prices across all platforms |
| `find_arbitrage` | Find cross-platform price arbitrage |
| `match_products` | Match same product across platforms |
| `competitor_watch` | Monitor competitor pricing |
| `get_price_history` | Historical price trends |
| `keepa_price_history` | Amazon price history via Keepa |
| `keepa_deals` | Amazon price drops and deals |
| `keepa_bestsellers` | Bestselling ASINs by category |
| `keepa_track_product` | Set price drop alerts |

## Listing Management (9 tools)

| Tool | Description |
|------|-------------|
| `create_ebay_listing` | Create optimized eBay listing |
| `create_amazon_listing` | Create Amazon product offer |
| `optimize_listing` | AI-optimize title/description |
| `update_listing_price` | Change listing price |
| `bulk_list` | Batch create listings |
| `pause_listing` | Temporarily hide a listing |
| `resume_listing` | Restore paused listing |
| `delete_listing` | Remove listing |
| `fba_create_fulfillment` | Create MCF fulfillment order |

## Inventory & Warehouse (8 tools)

| Tool | Description |
|------|-------------|
| `warehouse_list` | List all warehouses |
| `warehouse_create` | Create new warehouse |
| `warehouse_inventory` | Check warehouse stock |
| `warehouse_update_stock` | Update stock quantities |
| `warehouse_transfer` | Move stock between warehouses |
| `inventory_sync` | Sync levels across platforms |
| `batch_reprice` | Batch price updates |
| `fba_check_inventory` | Check FBA stock levels |

## Fulfillment & Shipping (11 tools)

| Tool | Description |
|------|-------------|
| `check_orders` | View order status |
| `auto_purchase` | Auto-buy from source (dropship) |
| `track_shipment` | Get tracking info |
| `track_package` | Universal package tracking |
| `update_tracking` | Push tracking to buyer |
| `handle_return` | Process returns |
| `get_shipping_cost` | Quote shipping costs |
| `get_shipping_rates` | Compare carrier rates |
| `buy_shipping_label` | Purchase shipping labels |
| `verify_address` | Validate shipping addresses |
| `fba_check_fulfillment` | Check MCF status |

## Analytics & Reporting (6 tools)

| Tool | Description |
|------|-------------|
| `daily_report` | Daily activity summary |
| `profit_dashboard` | P&L by period |
| `calculate_profit` | Per-order profit |
| `category_analysis` | Category profitability |
| `top_opportunities` | Rank best opportunities |
| `fee_calculator` | Platform fee estimates |

## Credentials & Setup (11 tools)

| Tool | Description |
|------|-------------|
| `setup_amazon_credentials` | Configure Amazon PA-API |
| `setup_amazon_sp_credentials` | Configure Amazon SP-API |
| `setup_ebay_credentials` | Configure eBay OAuth |
| `setup_walmart_credentials` | Configure Walmart API |
| `setup_walmart_seller_credentials` | Configure Walmart Seller |
| `setup_aliexpress_credentials` | Configure AliExpress |
| `setup_aliexpress_oauth` | Complete AliExpress OAuth |
| `setup_keepa_credentials` | Configure Keepa API |
| `setup_easypost_credentials` | Configure EasyPost API |
| `list_credentials` | View configured platforms |
| `delete_credentials` | Remove credentials |

## Skills (5 bundled)

Skills are higher-level workflows composed of multiple tools:

| Skill | Description |
|-------|-------------|
| `/scanner` | Full arbitrage scan workflow |
| `/lister` | End-to-end listing creation |
| `/fulfiller` | Order fulfillment pipeline |
| `/analytics` | Generate comprehensive reports |
| `/credentials` | Guided credential setup |
