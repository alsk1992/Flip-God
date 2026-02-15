# Tool Reference

FlipAgent exposes 88 tools to the AI agent. Below are the main categories.

## Scanning & Search (12 tools)

| Tool | Description |
|------|-------------|
| `scan_amazon` | Search Amazon products by keyword |
| `scan_ebay` | Search eBay listings |
| `scan_walmart` | Search Walmart products |
| `scan_aliexpress` | Search AliExpress products |
| `compare_prices` | Compare prices across all platforms |
| `find_arbitrage` | Find cross-platform price arbitrage |
| `match_products` | Match same product across platforms |
| `get_product_details` | Get full product details by ID |
| `check_stock` | Check stock availability |
| `get_price_history` | Keepa price/rank history |
| `category_analysis` | Analyze category profitability |
| `competitor_watch` | Monitor competitor pricing |

## Listing Management (8 tools)

| Tool | Description |
|------|-------------|
| `create_ebay_listing` | Create a new eBay listing |
| `create_amazon_listing` | Create listing on existing ASIN |
| `update_listing_price` | Change listing price |
| `optimize_listing` | AI-optimize title/description |
| `bulk_list` | Create multiple listings at once |
| `get_active_listings` | View all active listings |
| `pause_listing` | Pause/deactivate a listing |
| `relist_item` | Relist an ended listing |

## Order & Fulfillment (8 tools)

| Tool | Description |
|------|-------------|
| `check_orders` | Check for new sales |
| `auto_purchase` | Auto-buy from source platform |
| `track_shipment` | Track package by tracking number |
| `update_tracking` | Push tracking to selling platform |
| `get_shipping_rates` | Compare shipping rates |
| `create_shipment` | Create shipping label |
| `handle_return` | Process a return/refund |
| `cancel_order` | Cancel an unfulfilled order |

## Analytics (8 tools)

| Tool | Description |
|------|-------------|
| `daily_report` | Daily sales/profit summary |
| `profit_dashboard` | P&L breakdown by product/platform |
| `fee_calculator` | Calculate platform fees |
| `roi_analysis` | ROI per product/opportunity |
| `sales_velocity` | Units sold per day/week |
| `trending_products` | Trending/hot-selling categories |
| `inventory_health` | Stock age and turnover metrics |
| `tax_summary` | Tax liability estimates |

## Credentials & Settings (6 tools)

| Tool | Description |
|------|-------------|
| `setup_credentials` | Store platform API keys |
| `check_credentials` | Verify which platforms are configured |
| `remove_credentials` | Delete stored credentials |
| `get_settings` | View agent settings |
| `update_settings` | Change agent behavior |
| `export_data` | Export data as CSV/JSON |

## Skills (5 bundled)

Skills are higher-level workflows composed of multiple tools:

| Skill | Description |
|-------|-------------|
| `/scanner` | Full arbitrage scan workflow |
| `/lister` | End-to-end listing creation |
| `/fulfiller` | Order fulfillment pipeline |
| `/analytics` | Generate comprehensive reports |
| `/credentials` | Guided credential setup |
