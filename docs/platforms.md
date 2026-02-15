# Platform Reference — All 15 Platforms

**Last updated**: Feb 15, 2026

---

## Tier 1 — Official APIs (credentials required)

### Amazon — PA-API 5.0
- **Endpoint**: `POST https://webservices.amazon.com/paapi5/searchitems`
- **Auth**: AWS Signature V4 (HMAC-SHA256) — access key + secret key + partner tag
- **Methods**: `SearchItems` (keyword search), `GetItems` (ASIN lookup)
- **Rate limit**: 1 req/sec (burst to 10)
- **Setup**: [Amazon Associates](https://affiliate-program.amazon.com/) → Tools → Product Advertising API
```
AMAZON_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
AMAZON_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AMAZON_PARTNER_TAG=yourtag-20
```

### eBay — Browse API + Inventory/Fulfillment
- **Endpoint**: `GET https://api.ebay.com/buy/browse/v1/item_summary/search`
- **Auth**: OAuth 2.0 Client Credentials → Bearer token (auto-refreshed)
- **Methods**: Search, GetItem, CreateInventoryItem, CreateOffer, PublishOffer, GetOrders, ShipOrder
- **Setup**: [eBay Developer Program](https://developer.ebay.com/)
```
EBAY_CLIENT_ID=YourApp-PRD-xxx
EBAY_CLIENT_SECRET=PRD-xxx
EBAY_REFRESH_TOKEN=v^1.1#i^1#p^3#r^1...
```

### Walmart — Affiliate API
- **Endpoint**: `GET https://developer.api.walmart.com/api-proxy/service/affil/product/v2/search`
- **Auth**: API key in headers (`WM_SEC.ACCESS_TOKEN`, `WM_CONSUMER.ID`)
- **Methods**: Search, Item Lookup by ID, UPC Lookup
- **Rate limit**: 5 req/sec
- **Setup**: [Walmart Affiliate Program](https://affiliates.walmart.com/)
```
WALMART_CLIENT_ID=your-api-key
WALMART_CLIENT_SECRET=your-secret
```

### AliExpress — Affiliate/Dropshipping API
- **Endpoint**: `POST https://api-sg.aliexpress.com/sync`
- **Auth**: HMAC-SHA256 signed requests (app key + app secret)
- **Methods**: `affiliate.product.query` (search), `affiliate.productdetail.get` (detail), `trade.buy.placeorder` (dropship order), `logistics.ds.trackinginfo.query` (tracking)
- **Setup**: [AliExpress Open Platform](https://portals.aliexpress.com/)
```
ALIEXPRESS_APP_KEY=12345678
ALIEXPRESS_APP_SECRET=abc123def456
```

### Best Buy — Products API
- **Endpoint**: `GET https://api.bestbuy.com/v1/products`
- **Auth**: API key as URL parameter
- **Methods**: Product search (keyword, price, category filters), Product lookup by SKU
- **Data**: SKU, price, sale status, shipping, availability, UPC, ratings, reviews
- **Setup**: [Best Buy Developer](https://developer.bestbuy.com/)
```
BESTBUY_API_KEY=xxx
```

### Faire — External API v2
- **Endpoint**: `GET https://www.faire.com/external-api/v2/products`
- **Auth**: `X-FAIRE-ACCESS-TOKEN` header
- **Methods**: List products, Get product by ID (wholesale + retail prices, variants, inventory)
- **Data**: Wholesale price (cents), retail price (cents), variants, images, brand, taxonomy
- **Setup**: Email `integrations.support@faire.com` for access token
```
FAIRE_ACCESS_TOKEN=xxx
```

---

## Tier 2 — Internal APIs (no credentials, reverse-engineered)

### Target — Redsky API
- **Endpoint**: `GET https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v1`
- **Auth**: Public API key `ff457966e64d5e877fdbad070f276d18ecec4a01`
- **Methods**: Product search (keyword, price range), Product detail by TCIN
- **Data**: TCIN, price, stock status, images, brand, ratings, reviews
- **Source**: Confirmed real — Target's frontend uses this directly

### Home Depot — GraphQL Federation Gateway
- **Endpoint**: `POST https://apionline.homedepot.com/federation-gateway/graphql?opname=searchModel`
- **Auth**: None — requires specific headers (`x-experience-name`, `x-hd-dc`, `Origin`, `Referer`)
- **Methods**: `searchModel` GraphQL query (keyword search with store filter)
- **Data**: itemId, price, original price, images, brand, ratings, reviews, canonicalUrl
- **Source**: Confirmed real — Home Depot's frontend uses this

### Mercari JP — v2 API with DPoP JWT
- **Endpoint**: `POST https://api.mercari.jp/v2/entities:search`
- **Auth**: DPoP JWT (ECDSA P-256 / ES256) — auto-generated per request, no credentials needed
- **Methods**: Search (keyword, price range, categories, conditions, brands), Get item by ID, Get seller profile
- **Data**: Price (JPY), status, thumbnails, brand, category, seller, likes, condition
- **Source**: Based on `take-kun/mercapi` (63 stars) + `HonmaMeikodesu/generate-mercari-jwt` (TypeScript)
- **Note**: Targets mercari.jp (Japan), not mercari.com (US has no API)

### Facebook Marketplace — Internal GraphQL
- **Endpoint**: `POST https://www.facebook.com/api/graphql/`
- **Auth**: None — public GraphQL, no login required
- **Methods**:
  - Location lookup: `doc_id=5585904654783609` (city/zip → lat/lng)
  - Listing search: `doc_id=7111939778879383` (keyword + location + price + radius)
- **Data**: Listing ID, title, price, image, seller name, pending status
- **Source**: Based on `kyleronayne/marketplace-api` (50 stars, active Feb 2026)
- **Note**: `doc_id` values may change if Facebook updates their frontend

### Poshmark — vm-rest Internal API + __NEXT_DATA__
- **Endpoint**: `GET https://poshmark.com/vm-rest/posts/{itemId}`
- **Auth**: Cookie-based (optional — public items work without auth)
- **Methods**:
  - Get item: `GET /vm-rest/posts/{itemId}` (JSON response)
  - Search: `GET /vm-rest/posts?query=...` (may require cookies) + `__NEXT_DATA__` fallback from search page HTML
  - User closet: `GET /vm-rest/users/{userId}/posts` (paginated)
- **Data**: Price, original price, brand, size, condition, NWT flag, seller, images
- **Source**: Based on `michaelbutler/phposh` (PHP SDK) + `joshdk/posh` (Go client)
- **Note**: $7.97 flat rate shipping on all Poshmark orders

### Costco — CatalogSearch + AjaxGetContractPrice
- **Endpoint**: `GET https://www.costco.com/CatalogSearch` + `GET https://www.costco.com/AjaxGetContractPrice`
- **Auth**: Location cookies (`invCheckPostalCode`, `invCheckCity`) + browser-like headers
- **Methods**: Keyword search (CatalogSearch), Price lookup by product ID (AjaxGetContractPrice)
- **Data**: Product name, price, stock, brand, category, ratings
- **Source**: Based on `aransaseelan/CostcoPriceTracker` (active Dec 2025)
- **Caveat**: Akamai bot protection — may return 403. Adapter handles this gracefully.

---

## Tier 3 — HTML Scraping (no API exists)

### B-Stock — Liquidation Auctions
- **Approach**: Fetch `https://bstock.com/search?q=...` → extract JSON-LD / `__NEXT_DATA__` / HTML regex
- **Auth**: None
- **Data**: Auction ID, title, current bid, retail value, category, marketplace (Amazon/Walmart/Target), images
- **Note**: Enterprise API exists but requires B-Stock partnership agreement. HTML scraping is the only public option.

### BULQ — Fixed-Price Liquidation Lots
- **Approach**: Fetch `https://www.bulq.com/search?q=...` → extract JSON-LD / `__NEXT_DATA__` / HTML regex
- **Auth**: None
- **Data**: Lot ID, title, price, retail value, category, condition, item count, source retailer
- **Note**: Zero open-source scrapers exist on GitHub. Built from scratch.

### Liquidation.com — Surplus Auctions
- **Approach**: Fetch `https://www.liquidation.com/auction/search?flag=new&query=...` → extract JSON-LD / `__NEXT_DATA__` / HTML regex
- **Auth**: Cloudflare protection headers (Sec-Ch-Ua, Sec-Fetch-*)
- **Data**: Auction ID, title, current bid, retail value, category, condition, seller
- **Caveat**: Cloudflare protected — may return 403. Falls back gracefully.

---

## Tier 4 — Optional Add-ons

### Keepa — Amazon Price History
- **Endpoint**: `GET https://api.keepa.com/product`
- **Auth**: API key parameter
- **Methods**: Product history, Deal finder, Best sellers
```
KEEPA_API_KEY=xxx
```

### EasyPost — Shipping Rate Comparison
- **Endpoint**: `POST https://api.easypost.com/v2/shipments`
- **Auth**: API key (Basic auth)
- **Methods**: Rate comparison (USPS, UPS, FedEx), Label purchase, Tracking
```
EASYPOST_API_KEY=EZAKxxx
```

---

## Setting Credentials via Chat

```
"Setup my eBay credentials"
"Add Amazon PA-API keys"
"Configure AliExpress dropshipping"
"Set Best Buy API key"
"Add Faire access token"
```

Credentials are stored AES-256 encrypted in the local database and never sent to the AI model.

---

## Platform Capability Matrix

| Platform | Search | Get Item | Check Stock | Create Listing | Orders | Price History |
|----------|:------:|:--------:|:-----------:|:--------------:|:------:|:------------:|
| Amazon | yes | yes | yes | SP-API | SP-API | via Keepa |
| eBay | yes | yes | yes | yes | yes | -- |
| Walmart | yes | yes | yes | Marketplace | Marketplace | -- |
| AliExpress | yes | yes | yes | -- | yes (dropship) | -- |
| Best Buy | yes | yes | yes | -- | -- | -- |
| Faire | yes | yes | yes | -- | -- | -- |
| Target | yes | yes | yes | -- | -- | -- |
| Home Depot | yes | yes | yes | -- | -- | -- |
| Mercari JP | yes | yes | yes | -- | -- | -- |
| Facebook | yes | -- | -- | -- | -- | -- |
| Poshmark | yes | yes | yes | -- | -- | -- |
| Costco | yes | yes | yes | -- | -- | -- |
| B-Stock | yes | yes | -- | -- | -- | -- |
| BULQ | yes | yes | -- | -- | -- | -- |
| Liquidation | yes | yes | -- | -- | -- | -- |
