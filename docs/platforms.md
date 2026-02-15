# Platform Setup

## Amazon

### Product Advertising API (PA-API 5.0)
Used for searching and looking up products. Free tier available.

1. Sign up at [Amazon Associates](https://affiliate-program.amazon.com/)
2. Go to **Tools** → **Product Advertising API**
3. Get your **Access Key**, **Secret Key**, and **Partner Tag**

```
AMAZON_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE
AMAZON_SECRET_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AMAZON_PARTNER_TAG=yourtag-20
```

### Selling-Partner API (SP-API)
Used for creating listings on Amazon. Requires professional seller account.

```
AMAZON_SP_CLIENT_ID=amzn1.application-oa2-client.xxx
AMAZON_SP_CLIENT_SECRET=xxx
AMAZON_SP_REFRESH_TOKEN=xxx
AMAZON_SP_MARKETPLACE_ID=ATVPDKIKX0DER
```

---

## eBay

### Browse API (searching)
1. Go to [eBay Developer Program](https://developer.ebay.com/)
2. Create an application (Production keys)
3. Get **App ID (Client ID)** and **Cert ID (Client Secret)**

### Inventory + Fulfillment API (selling)
Same credentials, but requires OAuth user consent for selling operations.

```
EBAY_CLIENT_ID=YourApp-PRD-xxx
EBAY_CLIENT_SECRET=PRD-xxx
EBAY_REFRESH_TOKEN=v^1.1#i^1#p^3#r^1...
```

FlipAgent handles OAuth token refresh automatically.

---

## Walmart

### Affiliate API (searching only)
1. Apply at [Walmart Affiliate Program](https://affiliates.walmart.com/)
2. Get your **API Key**

```
WALMART_CLIENT_ID=your-api-key
WALMART_CLIENT_SECRET=your-secret
```

### Seller API (listing — requires marketplace seller account)
Requires separate [Walmart Marketplace](https://marketplace.walmart.com/) seller onboarding.

---

## AliExpress

### Affiliate/Dropshipping API
1. Register at [AliExpress Open Platform](https://portals.aliexpress.com/)
2. Create an app and get **App Key** + **App Secret**

```
ALIEXPRESS_APP_KEY=12345678
ALIEXPRESS_APP_SECRET=abc123def456
```

For dropship ordering, you also need an **access token** (OAuth flow handled by FlipAgent).

---

## Keepa (Optional)

Price history and sales rank tracking for Amazon products.

1. Sign up at [Keepa](https://keepa.com/)
2. Get API key from account settings

```
KEEPA_API_KEY=xxx
```

---

## EasyPost (Optional)

Shipping rate comparison across USPS, UPS, FedEx.

1. Sign up at [EasyPost](https://www.easypost.com/)
2. Get your API key

```
EASYPOST_API_KEY=EZAKxxx
```

---

## Setting Credentials via Chat

You can also configure credentials through the FlipAgent chat:

```
"Setup my eBay credentials"
"Add Amazon PA-API keys"
"Configure AliExpress dropshipping"
```

Credentials are stored AES-256 encrypted in the local database and never sent to the AI model.
