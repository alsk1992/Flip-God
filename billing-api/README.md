# FlipGod Billing API

API key management, usage tracking, and Solana token-gated premium access for FlipGod agents.

**Live**: https://billing-api-production-28ad.up.railway.app

## Stack

- Express.js + TypeScript
- PostgreSQL (Railway)
- JWT auth (argon2id password hashing)
- Solana SPL token verification via raw JSON RPC

## Endpoints

### Public
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Get JWT tokens |
| POST | `/auth/refresh` | Refresh JWT |

### JWT-authenticated
| Method | Path | Description |
|--------|------|-------------|
| POST | `/keys` | Create API key |
| GET | `/keys` | List API keys |
| DELETE | `/keys/:id` | Revoke key |
| POST | `/keys/:id/rotate` | Rotate key |
| GET | `/billing/usage` | Usage stats |
| GET | `/wallet` | Wallet status |
| POST | `/wallet/link` | Link Solana wallet |
| POST | `/wallet/unlink` | Unlink wallet |
| POST | `/wallet/refresh` | Refresh token balance |
| GET | `/wallet/message` | Get signing message |

### API key-authenticated (called by self-hosted agents)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/validate` | Validate key, return plan |
| POST | `/premium/score` | 6-signal opportunity scoring |
| POST | `/premium/optimize` | AI listing optimization |
| POST | `/usage/report` | Log completed sale GMV |

## Premium Model

No Stripe, no subscriptions. Hold the FlipGod SPL token on Solana to unlock premium.

- Free tier: basic scanning, 3-platform compare
- Token holder: all features, 6-signal scoring, AI optimization, auto-scout, smart repricing

Token balance checked via Solana `getTokenAccountsByOwner` RPC, cached for 3 hours.

## Deploy

Deployed on Railway via `railway up` from the `billing-api/` directory.

```bash
cd billing-api
railway up --detach
```

## Env Vars

See `.env.example` for all configuration options.
