---
name: "credentials"
emoji: "🔑"
description: "Manage API credentials for e-commerce platforms"
category: "admin"
---

# Credentials

Set up and manage API credentials for Amazon, eBay, Walmart, and AliExpress.

## Commands

| Command | Description |
|---------|-------------|
| `setup amazon` | Configure Amazon PA-API credentials |
| `setup ebay` | Configure eBay API credentials |
| `setup walmart` | Configure Walmart API credentials |
| `setup aliexpress` | Configure AliExpress API credentials |
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

## Security

All credentials are encrypted with AES-256-GCM before storage.
Your API keys are never sent to AI models or logged.
