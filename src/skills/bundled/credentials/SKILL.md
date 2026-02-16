---
name: "credentials"
emoji: "🔑"
description: "Manage API credentials for e-commerce platforms"
category: "admin"
---

# Credentials

Set up and manage API credentials for all supported platforms.

## Commands

| Command | Description |
|---------|-------------|
| `setup amazon` | Configure Amazon PA-API credentials |
| `setup ebay` | Configure eBay API credentials |
| `setup walmart` | Configure Walmart API credentials |
| `setup aliexpress` | Configure AliExpress API credentials |
| `setup bestbuy` | Configure Best Buy API credentials |
| `setup faire` | Configure Faire API credentials |
| `setup keepa` | Configure Keepa API credentials |
| `setup easypost` | Configure EasyPost shipping credentials |
| `list credentials` | Show configured platforms |
| `delete credentials <platform>` | Remove credentials |

## Setup Guides

### Amazon
Requires: PA-API 5.0 access key, secret key, and partner tag.
Get them at: https://affiliate-program.amazon.com/

### eBay
Requires: Client ID, Client Secret, and OAuth refresh token.
Get them at: https://developer.ebay.com/

### Walmart
Requires: Client ID and Client Secret.
Get them at: https://developer.walmart.com/

### AliExpress
Requires: App Key and App Secret.
Get them at: https://portals.aliexpress.com/

### Best Buy
Requires: API Key.
Get one at: https://developer.bestbuy.com/

### Faire
Requires: API Key.
Get one at: https://www.faire.com/brand-portal

### Keepa
Requires: API Key for Amazon price history tracking.
Get one at: https://keepa.com/#!api

### EasyPost
Requires: API Key for shipping rate comparison and label generation.
Get one at: https://www.easypost.com/

## Security

All credentials are encrypted with AES-256-GCM before storage.
Your API keys are never sent to AI models or logged.
