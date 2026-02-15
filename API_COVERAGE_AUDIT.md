# FlipAgent API Coverage Audit — Master Reference

**Date**: Feb 15, 2026
**Platforms**: 15 total (6 official API, 7 internal/reverse-engineered, 3 HTML scraping)
**Current Coverage**: 20 official API methods + 11 reverse-engineered adapters + 3 HTML scrapers

---

## Coverage Summary

| Platform | Type | API Methods Available | Implemented | Coverage |
|----------|------|:-:|:-:|:-:|
| **Amazon PA-API** | Official | 4 | 2 | 50% |
| **Amazon SP-API** | Official | ~200+ | 0 | 0% |
| **eBay** | Official | ~250+ | 12 | ~5% |
| **Walmart Affiliate** | Official | 10 | 2 | 20% |
| **Walmart Marketplace** | Official | ~123 | 0 | 0% |
| **AliExpress** | Official | ~42 | 4 | ~10% |
| **Best Buy** | Official | ~8 | 2 | 25% |
| **Faire** | Official | ~15 | 2 | ~13% |
| **Target** | Internal | 3 | 2 | 67% |
| **Home Depot** | Internal | 1 (GraphQL) | 1 | 100% |
| **Mercari JP** | Internal | 4 | 2 | 50% |
| **Facebook Marketplace** | Internal | 2 (doc_ids) | 2 | 100% |
| **Poshmark** | Internal | 3 | 2 | 67% |
| **Costco** | Internal | 2 | 2 | 100% |
| **B-Stock** | Scraping | N/A | search+detail | -- |
| **BULQ** | Scraping | N/A | search+detail | -- |
| **Liquidation.com** | Scraping | N/A | search+detail | -- |
| **Keepa** | Official | ~5 | 3 | 60% |
| **EasyPost** | Official | ~10 | 3 | 30% |
| **TOTAL** | | **~615+ official** | **~41 methods** | |

---

## AMAZON (2 of ~204 methods)

### PA-API 5.0 (2 of 4)

| Method | Implemented | Priority | Notes |
|--------|:-:|:-:|-------|
| `SearchItems` | YES | -- | In scraper.ts. Missing: Brand filter, SearchRefinements, VariationSummary, CustomerReviews resources |
| `GetItems` | YES | -- | In scraper.ts. Missing: Condition, Features, ProductInfo, Promotions, TradeInInfo resources |
| `GetVariations` | **NO** | **HIGH** | Get all variations (size/color) of a product. Crucial for finding cheapest variant. |
| `GetBrowseNodes` | **NO** | **HIGH** | Get category tree. Needed for structured category-based scanning. |

### SP-API — CRITICAL for Selling on Amazon (0 of ~200)

#### Tier 1 — Must Implement for Arbitrage

| API Section | Key Methods | Count | Why Critical |
|-------------|------------|:-:|------|
| **Listings Restrictions** | `getListingsRestrictions` | 1 | MUST verify you can sell an item BEFORE buying it |
| **Product Pricing** | `getPricing`, `getCompetitivePricing`, `getItemOffers`, `getItemOffersBatch`, `getFeaturedOfferExpectedPriceBatch`, `getCompetitiveSummary` | 6 | Know competitor prices + exact Buy Box price |
| **Product Fees** | `getMyFeesEstimateForASIN`, `getMyFeesEstimateForSKU`, `getMyFeesEstimates` | 3 | Calculate exact Amazon fees for margin accuracy |
| **Catalog Items** | `searchCatalogItems`, `getCatalogItem` | 2 | Look up products by UPC/EAN for cross-platform matching |
| **Listings Items** | `putListingsItem`, `patchListingsItem`, `getListingsItem`, `deleteListingsItem`, `searchListingsItems` | 5 | Create/manage Amazon listings |
| **Orders** | `getOrders`, `getOrder`, `getOrderItems`, `getOrderAddress`, `confirmShipment` | 5 | Process incoming orders |
| **Notifications** | `createSubscription`, `createDestination` (for `ANY_OFFER_CHANGED`, `PRICING_HEALTH`) | 2 | Real-time price change alerts |
| **FBA Inventory** | `getInventorySummaries` | 1 | Monitor stock levels |
| **Fulfillment Outbound** (MCF) | `getFulfillmentPreview`, `createFulfillmentOrder`, `getFulfillmentOrder`, `cancelFulfillmentOrder`, `getPackageTrackingDetails` | 5 | Fulfill eBay/Walmart orders from FBA! |

#### Tier 2 — High Value

| API Section | Key Methods | Count |
|-------------|------------|:-:|
| **Reports** | `createReport`, `getReport`, `getReportDocument` (inventory, sales, settlement) | 3+ |
| **Feeds** | `createFeed`, `createFeedDocument`, `getFeed` (bulk listing/pricing) | 3+ |
| **Finances** | `listFinancialEventsByOrderId`, `listFinancialEvents` | 2+ |
| **Product Type Definitions** | `searchDefinitionsProductTypes`, `getDefinitionsProductType` | 2 |
| **Tokens** | `createRestrictedDataToken` (PII access) | 1 |
| **Sales** | `getOrderMetrics` | 1 |
| **Shipping v2** | `getRates`, `purchaseShipment`, `getTracking` | 3+ |
| **Data Kiosk** | `createQuery`, `getDocument` (bulk GraphQL analytics) | 2+ |
| **Solicitations** | `createProductReviewAndSellerFeedbackSolicitation` | 1 |

#### Tier 3 — Lower Priority

FBA Inbound (30+ methods), Easy Ship, A+ Content, Messaging, Services, Vehicles, AWD, Vendor APIs, etc.

---

## EBAY (12 of ~250 methods)

### Currently Implemented

| # | Endpoint | File |
|---|---------|------|
| 1 | `GET /buy/browse/v1/item_summary/search` | scraper.ts |
| 2 | `GET /buy/browse/v1/item/{item_id}` | scraper.ts |
| 3 | `PUT /sell/inventory/v1/inventory_item/{sku}` | seller.ts |
| 4 | `DELETE /sell/inventory/v1/inventory_item/{sku}` | seller.ts |
| 5 | `POST /sell/inventory/v1/offer` | seller.ts |
| 6 | `GET /sell/inventory/v1/offer/{offerId}` | seller.ts |
| 7 | `PUT /sell/inventory/v1/offer/{offerId}` | seller.ts |
| 8 | `POST /sell/inventory/v1/offer/{offerId}/publish` | seller.ts |
| 9 | `POST /sell/inventory/v1/offer/{offerId}/withdraw` | seller.ts |
| 10 | `GET /sell/fulfillment/v1/order` | orders.ts |
| 11 | `GET /sell/fulfillment/v1/order/{orderId}` | orders.ts |
| 12 | `POST /sell/fulfillment/v1/order/{orderId}/shipping_fulfillment` | orders.ts |

### Tier 1 — Critical Missing (implement first)

| API | Method | Why |
|-----|--------|-----|
| **Account** | `getFulfillmentPolicies`, `getPaymentPolicies`, `getReturnPolicies` | Cannot create listings without policy IDs |
| **Account** | `createFulfillmentPolicy`, `createPaymentPolicy`, `createReturnPolicy` | Programmatic policy setup |
| **Account** | `getPrivileges` | Check selling privileges |
| **Inventory** | `getInventoryItems`, `getInventoryItem` | Cannot check what you have listed |
| **Inventory** | `bulkUpdatePriceQuantity` | Repricing 25 items at once |
| **Inventory** | `bulkCreateOrReplaceInventoryItem` | Bulk listing creation |
| **Inventory** | `getOffers` | List offers for a SKU |
| **Inventory** | `createInventoryLocation` | Required before publishing offers |
| **Fulfillment** | `issueRefund` | Handle returns/cancellations |
| **Fulfillment** | `getPaymentDispute*` (4 methods) | Dispute management (mandatory) |
| **Finances** | `getTransactions`, `getTransactionSummary`, `getPayouts` | Actual P&L tracking |
| **Compliance** | `getListingViolations` | Detect violations before suspension |
| **Negotiation** | `findEligibleItems`, `sendOfferToInterestedBuyers` | Sell to watchers |
| **Logistics** | `createShippingQuote`, `createFromShippingQuote`, `downloadLabelFile` | Buy shipping labels |
| **Taxonomy** | `getCategorySuggestions`, `getItemAspectsForCategory`, `getDefaultCategoryTreeId` | Auto-categorize products |
| **Catalog** | `search` | Match products to eBay catalog |
| **Browse** | `getItems` (batch) | Bulk price checking |
| **Marketplace Insights** | `search` | Sold items history for pricing |
| **Analytics** | `getTrafficReport` | Listing performance |
| **Buy Feed** | `getItemSnapshotFeed` | Hourly price monitoring at scale |

### Tier 2 — High Value

| Category | Key Methods |
|----------|------------|
| Fulfillment | `getShippingFulfillments` |
| Finances | `getPayout`, `getSellerFundsSummary` |
| Inventory | `bulkCreateOffer`, `bulkPublishOffer`, inventory item groups |
| Marketing | `createCampaign`, Promoted Listings |
| Metadata | `getItemConditionPolicies` |
| Browse | `getItemByLegacyId`, `getItemsByItemGroup` |
| Sell Feed | `createTask`, `uploadFile`, `getResultFile` (bulk ops) |
| Notification | subscriptions for order/listing changes |

### Missing OAuth Scopes Needed

```
sell.finances
sell.analytics.readonly
sell.marketing
commerce.notification.subscription
buy.marketplace.insights
commerce.identity.readonly
```

---

## WALMART (2 of ~133 methods)

### Affiliate API (2 of 10)

| Method | Implemented | Priority |
|--------|:-:|:-:|
| Search | YES (partial — no facets/sort/pagination) | -- |
| Item Lookup by ID | YES | -- |
| **UPC Lookup** | **NO** | **HIGH** |
| **Bulk Lookup (20 items)** | **NO** | **HIGH** |
| **Paginated Items (clearance/rollback)** | **NO** | **HIGH** |
| Taxonomy | NO | MEDIUM |
| Trending | NO | MEDIUM |
| Reviews | NO | LOW |
| Store Locator | NO | LOW |
| Recommendations | NO | LOW |

### Marketplace API (0 of ~123) — ENTIRE SELLER API MISSING

#### Critical (must-have)

| API | Key Methods | Count |
|-----|-----------|:-:|
| **Auth** | `POST /v3/token` | 1 |
| **Orders** | getOrders, getReleasedOrders, getOrder, acknowledge, ship, cancel, refund | 7 |
| **Inventory** | getInventory, updateInventory, bulkUpdate | 3 |

#### High Priority

| API | Key Methods | Count |
|-----|-----------|:-:|
| **Items** | getAllItems, getItem, bulkUpload, retire, maintenance, catalogSearch | 6+ |
| **Prices** | updatePrice, bulkPriceUpdate, pricingInsights | 3 |
| **Repricer** | create/update strategy, assignItems | 3+ |
| **Returns** | getReturns, getReturnOrder, issueRefund | 3 |
| **Feeds** | getAllFeedStatuses, getFeedItemStatus | 2 |
| **Insights** | listingQualityScore, unpublishedItems | 2 |

---

## ALIEXPRESS (4 of ~42 methods)

### Currently Implemented

| Method | File |
|--------|------|
| `aliexpress.affiliate.product.query` | scraper.ts |
| `aliexpress.affiliate.productdetail.get` | scraper.ts |
| `aliexpress.trade.buy.placeorder` | purchaser.ts |
| `aliexpress.logistics.ds.trackinginfo.query` | tracker.ts |

### High Priority Missing (13 methods)

| # | Method | Why Critical |
|---|--------|------|
| 1 | `aliexpress.system.oauth.token` | Cannot use DS/Trade APIs without OAuth. Tokens expire! |
| 2 | `aliexpress.system.oauth.token` (refresh) | Token refresh — without it, all auth'd ops break |
| 3 | `aliexpress.affiliate.link.generate` | Generate affiliate tracking links |
| 4 | `aliexpress.affiliate.category.get` | Category tree for structured discovery |
| 5 | `aliexpress.affiliate.hotproduct.download` | Bulk trending product discovery |
| 6 | `aliexpress.affiliate.hotproduct.query` | Search trending/hot products |
| 7 | `aliexpress.ds.product.get` | Richer product data: all SKU variants, inventory |
| 8 | `aliexpress.ds.member.orderdata.submit` | Proper DS order placement with shipping selection |
| 9 | `aliexpress.ds.order.get` | Check order status after purchase |
| 10 | `aliexpress.ds.order.tracking.get` | Order-level tracking |
| 11 | `aliexpress.ds.freight.query` | Exact shipping costs (currently hardcoded to $0!) |
| 12 | `aliexpress.trade.order.get` | Verify order details after placement |
| 13 | `aliexpress.logistics.buyer.freight.get` | Alternative shipping cost estimation |

### Medium Priority (7 methods)

| Method | Use |
|--------|-----|
| `aliexpress.affiliate.order.list` | Track affiliate commissions |
| `aliexpress.affiliate.order.listbyindex` | Paginated affiliate orders |
| `aliexpress.ds.recommend.feed.get` | Curated product feeds |
| `aliexpress.ds.category.get` | DS-specific categories |
| `aliexpress.ds.image.search` | Reverse image search for cheaper suppliers |
| `aliexpress.trade.redefining.findorderlistquery` | Bulk order listing |
| Dispute APIs (3 methods) | Handle disputes |

### Architecture Gaps

1. **No OAuth Flow** — auth.ts can sign requests but cannot obtain/refresh tokens
2. **Shipping hardcoded to $0** — scraper.ts:31, makes profit calculations wrong
3. **No order status polling** — purchaser places orders but can't check them afterward
4. **No category structure** — relies entirely on keyword search

---

## BEST BUY (2 of ~8 methods)

### Currently Implemented

| Method | File |
|--------|------|
| Product Search (`GET /v1/products(keyword=...)`) | scraper.ts |
| Product Lookup by SKU (`GET /v1/products/{sku}.json`) | scraper.ts |

### Missing Methods

| Method | Priority | Purpose |
|--------|:-:|---------|
| `GET /v1/products(categoryPath.id=...)` | MEDIUM | Browse by category |
| `GET /v1/products(salePrice<={n})` | MEDIUM | Price range filtering |
| `GET /v1/products(onSale=true)` | HIGH | Find clearance/sale items for arbitrage |
| `GET /v1/categories` | LOW | Category tree discovery |
| `GET /v1/stores` | LOW | Store availability/pickup |
| Open Box endpoint | MEDIUM | Open box deals at reduced prices |

### Notes
- Simple API key auth (URL parameter)
- No selling API — read-only sourcing platform
- Rate limits not documented but generous

---

## FAIRE (2 of ~15 methods)

### Currently Implemented

| Method | File |
|--------|------|
| List Products (`GET /external-api/v2/products`) | scraper.ts |
| Get Product by ID (`GET /external-api/v2/products/{id}`) | scraper.ts |

### Missing Methods

| Method | Priority | Purpose |
|--------|:-:|---------|
| `GET /external-api/v2/products?page=N` | HIGH | Pagination (currently first page only) |
| `GET /external-api/v2/orders` | HIGH | Pull wholesale orders |
| `GET /external-api/v2/orders/{id}` | HIGH | Order details |
| `PATCH /external-api/v2/orders/{id}/items/{id}/ship` | MEDIUM | Mark items shipped |
| `GET /external-api/v2/brand` | MEDIUM | Brand profile info |
| `GET /external-api/v2/brand/inventory-levels` | HIGH | Check wholesale stock levels |
| `PATCH /external-api/v2/products/{id}` | LOW | Update product info |

### Notes
- Official API with `X-FAIRE-ACCESS-TOKEN` header
- Access token obtained via email to `integrations.support@faire.com`
- Prices in cents (wholesale + retail), need division by 100
- Wholesale vs retail price diff is the margin indicator

---

## TARGET — Redsky Internal API (2 of 3)

### Currently Implemented

| Method | File |
|--------|------|
| Product Search (`GET /redsky_aggregations/v1/web/plp_search_v1`) | scraper.ts |
| Product Detail by TCIN (`GET /redsky_aggregations/v1/web/pdp_client_v1`) | scraper.ts |

### Missing Methods

| Method | Priority | Purpose |
|--------|:-:|---------|
| Store Availability | HIGH | Check in-store pickup availability |

### Notes
- Public API key: `ff457966e64d5e877fdbad070f276d18ecec4a01`
- Returns TCIN, price, brand, ratings, images, stock status
- No selling API — read-only sourcing
- Stable internal API used by Target's own frontend

---

## HOME DEPOT — GraphQL Federation Gateway (1 of 1)

### Currently Implemented

| Method | File |
|--------|------|
| `searchModel` GraphQL query | scraper.ts |

### Notes
- `POST https://apionline.homedepot.com/federation-gateway/graphql?opname=searchModel`
- Requires headers: `x-experience-name: general-merchandise`, `x-hd-dc: origin`
- Returns: itemId, price, original price, images, brand, ratings, canonicalUrl
- No auth required — just proper headers + Origin/Referer
- Full coverage — only search is available via public GraphQL

---

## MERCARI JP — v2 API with DPoP JWT (2 of 4)

### Currently Implemented

| Method | File |
|--------|------|
| Search (`POST /v2/entities:search`) | scraper.ts |
| Get Item (`GET /items/get?id=...`) | scraper.ts |

### Missing Methods

| Method | Priority | Purpose |
|--------|:-:|---------|
| Get Seller Profile | MEDIUM | Seller reputation/history |
| Get Item Comments/Likes | LOW | Demand estimation |

### Auth Details
- **DPoP JWT (ECDSA P-256 / ES256)** — no credentials needed
- Auto-generates ECDSA key pair per adapter instance
- Each request gets fresh JWT with `iat`, `jti`, `htu` (URL), `htm` (method), `uuid`
- Based on `take-kun/mercapi` (63 stars) + `HonmaMeikodesu/generate-mercari-jwt`
- Targets **mercari.jp** (Japan) — prices in JPY

---

## FACEBOOK MARKETPLACE — Internal GraphQL (2 of 2)

### Currently Implemented

| Method | File |
|--------|------|
| Location Lookup (`doc_id=5585904654783609`) | scraper.ts |
| Listing Search (`doc_id=7111939778879383`) | scraper.ts |

### Notes
- `POST https://www.facebook.com/api/graphql/` with `application/x-www-form-urlencoded`
- No login required — public GraphQL
- Search supports: keyword, lat/lng, price range, radius (in km)
- Price bounds sent in cents (×100)
- Returns: listing ID, title, price, image, seller name, pending status
- Based on `kyleronayne/marketplace-api` (50 stars, active Feb 2026)
- **Caveat**: `doc_id` values may change if Facebook updates frontend
- Full coverage — only search + location available via public API

---

## POSHMARK — vm-rest Internal API (2 of 3)

### Currently Implemented

| Method | File |
|--------|------|
| Get Item (`GET /vm-rest/posts/{itemId}`) | scraper.ts |
| Search (`GET /vm-rest/posts?query=...` + `__NEXT_DATA__` fallback) | scraper.ts |

### Missing Methods

| Method | Priority | Purpose |
|--------|:-:|---------|
| User Closet (`GET /vm-rest/users/{userId}/posts`) | MEDIUM | Browse seller's full inventory |

### Notes
- Primary API: `/vm-rest/posts` endpoints return JSON
- Fallback: Extract `__NEXT_DATA__` from search HTML page
- Cookie-based auth optional (public items work without)
- Fixed $7.97 flat rate shipping on all Poshmark orders
- Based on `michaelbutler/phposh` (PHP SDK) + `joshdk/posh` (Go client)
- Parses: price, original_price, brand, size, condition, NWT flag, seller, images

---

## COSTCO — CatalogSearch + AjaxGetContractPrice (2 of 2)

### Currently Implemented

| Method | File |
|--------|------|
| Search (`GET /CatalogSearch?keyword=...&responseFormat=json`) | scraper.ts |
| Price Lookup (`GET /AjaxGetContractPrice?productId=...`) | scraper.ts |

### Notes
- Requires browser-like headers (Sec-Ch-Ua, Sec-Fetch-*) to avoid Akamai blocks
- Location cookies: `invCheckPostalCode`, `invCheckCity`, `C_LOC`
- Configurable postal code/city (defaults to 90210)
- Returns: product name, price, sale price, stock status, brand, ratings
- Based on `aransaseelan/CostcoPriceTracker` (active Dec 2025)
- **Caveat**: Akamai bot protection may return 403 — handled gracefully
- Full coverage — these are the only two public endpoints

---

## B-STOCK — HTML Scraping (search + detail)

### Currently Implemented

| Method | File |
|--------|------|
| Search (`GET /search?q=...`) | scraper.ts |
| Auction Detail (`GET /auction/{id}`) | scraper.ts |

### Extraction Strategy (3-tier)
1. **JSON-LD** (`<script type="application/ld+json">`) — schema.org Product/ItemList
2. **`__NEXT_DATA__`** (`<script id="__NEXT_DATA__">`) — server-rendered props
3. **HTML regex fallback** — `data-auction-id` attributes + `href="/auction/..."` patterns

### Notes
- Enterprise API exists but requires B-Stock partnership agreement
- HTML scraping is the only public option
- Returns: auction ID, title, current bid, retail value, category, marketplace source
- No rate limit issues observed

---

## BULQ — HTML Scraping (search + detail)

### Currently Implemented

| Method | File |
|--------|------|
| Search (`GET /search?q=...`) | scraper.ts |
| Lot Detail (`GET /lot/{id}`) | scraper.ts |

### Extraction Strategy (3-tier)
1. **JSON-LD** — same as B-Stock
2. **`__NEXT_DATA__`** — lot data from Next.js props
3. **HTML regex fallback** — `href="/lot/..."` patterns

### Notes
- Zero open-source scrapers exist on GitHub — built from scratch
- Fixed-price lots (not auctions)
- Returns: lot ID, title, price, retail value, category, condition, item count, source retailer
- Shipping varies but often included in lot price

---

## LIQUIDATION.COM — HTML Scraping (search + detail)

### Currently Implemented

| Method | File |
|--------|------|
| Search (`GET /auction/search?flag=new&query=...`) | scraper.ts |
| Auction Detail (`GET /auction/{id}`) | scraper.ts |

### Extraction Strategy (3-tier + JSON fallback)
1. **Direct JSON** — if `content-type: application/json`, parse directly
2. **JSON-LD** — same as B-Stock/BULQ
3. **`__NEXT_DATA__`** — server-rendered auction data
4. **HTML regex fallback** — `data-auction-id` + `data-lot-id` attributes

### Notes
- Cloudflare protection — may return 403
- Uses Cloudflare-appropriate headers (Sec-Ch-Ua, Sec-Fetch-Dest: document)
- Returns: auction ID, title, current bid, retail value, category, condition, seller, item count
- Zero open-source scrapers exist on GitHub — built from scratch

---

## KEEPA — Amazon Price History (3 of ~5)

### Currently Implemented

| Method | File |
|--------|------|
| Product history (`GET /product?key=...&asin=...`) | keepa.ts |
| Deal finder (`GET /deal?key=...`) | keepa.ts |
| Best sellers (`GET /bestsellers?key=...`) | keepa.ts |

### Missing Methods

| Method | Priority | Purpose |
|--------|:-:|---------|
| `GET /product/finder` | HIGH | Advanced product search with price drop filters |
| `GET /category` | LOW | Category tree for structured queries |

### Notes
- API key auth (URL parameter)
- Returns historical price arrays (Amazon, 3rd party, used, etc.)
- Deal finder is powerful for arbitrage: finds price drops, lightning deals
- 1 token per product lookup, 50 tokens per deal query

---

## EASYPOST — Shipping Rate Comparison (3 of ~10)

### Currently Implemented

| Method | File |
|--------|------|
| Create Shipment + Get Rates (`POST /v2/shipments`) | shipping.ts |
| Buy Label (`POST /v2/shipments/{id}/buy`) | shipping.ts |
| Track (`GET /v2/trackers/{id}`) | shipping.ts |

### Missing Methods

| Method | Priority | Purpose |
|--------|:-:|---------|
| `POST /v2/trackers` | MEDIUM | Create tracker from tracking number |
| `POST /v2/insurance` | LOW | Insure shipments |
| `POST /v2/batches` | MEDIUM | Batch label purchase (bulk shipping) |
| `GET /v2/addresses/verify` | HIGH | Address validation before shipping |
| `POST /v2/refunds` | MEDIUM | Refund unused labels |
| `POST /v2/scan_forms` | LOW | USPS SCAN forms for drop-off |

### Notes
- Basic auth with API key
- Supports USPS, UPS, FedEx, DHL rate comparison in one call
- Returns cheapest rate across all carriers
- Labels returned as base64-encoded PDF/PNG

---

## FLIPAGENT INTERNAL AUDIT

### Tool Handlers — 34 total

| Status | Count | Tools |
|--------|:-:|-------|
| **Real (API calls)** | 13 | scan_amazon/ebay/walmart/aliexpress, compare_prices, match_products, get_product_details, check_stock, create_ebay_listing, update_listing_price, auto_purchase, track_shipment, update_tracking |
| **Real (DB-powered)** | 12 | find_arbitrage, top_opportunities, get_price_history, check_orders, daily_report, profit_dashboard, category_analysis, competitor_watch, calculate_profit, fee_calculator, list_credentials, tool_search |
| **DB-only (no platform action)** | 4 | pause_listing, resume_listing, delete_listing, handle_return |
| **Stub/Manual** | 2 | create_amazon_listing, optimize_listing |
| **Credential mgmt** | 3 | setup_*_credentials (real), delete_credentials (real) |

### DB-Only Tools That Need Platform Wiring

| Tool | Current | Needed |
|------|---------|--------|
| `pause_listing` | DB status only | eBay: withdrawOffer |
| `resume_listing` | DB status only | eBay: publishOffer |
| `delete_listing` | DB status only | eBay: withdrawOffer + deleteInventoryItem |
| `handle_return` | DB status only | eBay: issueRefund via Fulfillment API |

### Missing Tools (should be added)

| Tool | Platform | Purpose |
|------|----------|---------|
| `get_categories` | All | Browse category trees |
| `upc_lookup` | Amazon/Walmart | Cross-platform product matching |
| `check_restrictions` | Amazon | Verify item can be sold (gated brands) |
| `get_fees_estimate` | Amazon | Exact Amazon fee calculation |
| `get_competitor_pricing` | Amazon | Buy Box price analysis |
| `get_trending` | Walmart/AliExpress | Trending product discovery |
| `get_shipping_rates` | eBay/Amazon | Calculate shipping costs |
| `buy_shipping_label` | eBay | Purchase discounted shipping labels |
| `get_financial_summary` | eBay | Real P&L from Finances API |
| `get_listing_violations` | eBay | Detect compliance issues |
| `send_offer_to_watchers` | eBay | Negotiation API for direct sales |
| `bulk_reprice` | eBay/Walmart | Mass price updates |
| `refresh_token` | AliExpress | OAuth token refresh |
| `get_order_status` | AliExpress | Check AliExpress order after placement |
| `image_search` | AliExpress | Find products by image |

---

## IMPLEMENTATION PRIORITY ORDER

### Phase 3A — Fix Critical Gaps (existing platforms)
1. AliExpress OAuth token management (obtain + refresh)
2. AliExpress shipping cost queries (fix $0 hardcode)
3. AliExpress order status checking
4. eBay Account API (policy discovery for listing creation)
5. eBay Inventory Location (required for offers)
6. Wire pause/resume/delete listing to eBay API
7. Wire handle_return to eBay refund API

### Phase 3B — Amazon Seller (SP-API)
1. Auth (LWA OAuth2 flow)
2. Listings Restrictions API (can you sell this?)
3. Product Pricing API (Buy Box price)
4. Product Fees API (exact fee calculation)
5. Catalog Items API (UPC/EAN lookup)
6. Listings Items API (create/manage)
7. Orders API (incoming orders)
8. Fulfillment Outbound / MCF (fulfill from FBA)

### Phase 3C — Walmart Seller (Marketplace API)
1. Auth (OAuth2 token management)
2. Items API (list products)
3. Orders API (process orders)
4. Inventory API (stock management)
5. Prices API + Repricer (competitive pricing)

### Phase 3D — Advanced Features
1. eBay Finances API (real P&L)
2. eBay Logistics API (shipping labels)
3. eBay Negotiation API (sell to watchers)
4. eBay Compliance API (listing health)
5. Amazon Notifications (real-time price alerts)
6. Walmart Notifications (webhooks)
7. AliExpress image search + hot products
8. Cross-platform category mapping

---

## FILES THAT NEED CHANGES

| File | Changes Needed |
|------|---------------|
| `src/platforms/amazon/scraper.ts` | Add GetVariations, GetBrowseNodes, more SearchItems resources |
| `src/platforms/amazon/auth.ts` | Add LWA OAuth2 for SP-API |
| `src/platforms/amazon/types.ts` | Add SP-API response types |
| NEW `src/platforms/amazon/seller.ts` | SP-API: Listings, Pricing, Fees, Orders |
| NEW `src/platforms/amazon/fulfillment.ts` | SP-API: MCF outbound fulfillment |
| `src/platforms/ebay/auth.ts` | Add missing scopes |
| `src/platforms/ebay/seller.ts` | Add bulk ops, inventory items list, location mgmt |
| NEW `src/platforms/ebay/account.ts` | Account API: policies, privileges |
| NEW `src/platforms/ebay/finances.ts` | Finances API: transactions, payouts |
| NEW `src/platforms/ebay/logistics.ts` | Logistics API: shipping quotes, labels |
| NEW `src/platforms/ebay/taxonomy.ts` | Taxonomy API: categories, aspects |
| NEW `src/platforms/ebay/compliance.ts` | Compliance API: listing violations |
| NEW `src/platforms/ebay/negotiation.ts` | Negotiation API: send offers to watchers |
| `src/platforms/walmart/scraper.ts` | Add UPC lookup, bulk lookup, paginated items, trending |
| NEW `src/platforms/walmart/auth.ts` | Marketplace OAuth2 token management |
| NEW `src/platforms/walmart/seller.ts` | Marketplace: Items, Prices, Repricer |
| NEW `src/platforms/walmart/orders.ts` | Marketplace: Orders, Returns |
| NEW `src/platforms/walmart/inventory.ts` | Marketplace: Inventory management |
| `src/platforms/aliexpress/auth.ts` | Add OAuth token obtain + refresh |
| `src/platforms/aliexpress/scraper.ts` | Add hot products, categories, DS product details, image search |
| NEW `src/platforms/aliexpress/orders.ts` | DS order management + status checking |
| NEW `src/platforms/aliexpress/shipping.ts` | Freight/shipping cost queries |
| `src/agents/index.ts` | Add ~15 new tool handlers |
| `src/agents/tool-registry.ts` | Register ~15 new tools |
| `src/types.ts` | Add credential fields for SP-API, Walmart marketplace |
| `src/arbitrage/calculator.ts` | Use real fees from Amazon Product Fees API |
