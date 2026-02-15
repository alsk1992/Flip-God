/**
 * Walmart Marketplace OAuth2 Token Management
 *
 * Handles client_credentials grant for the Marketplace API.
 * Caches tokens for their lifetime (typically 900 seconds)
 * with a 60-second safety margin before expiry.
 */

import { createLogger } from '../../utils/logger';
import { randomUUID } from 'crypto';

const logger = createLogger('walmart-auth');

const TOKEN_URL = 'https://marketplace.walmartapis.com/v3/token';

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

export interface WalmartMarketplaceAuthConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * Get a valid Marketplace access token, using cache when possible.
 * Token is refreshed 60 seconds before expiry to avoid edge-case failures.
 */
export async function getWalmartMarketplaceToken(config: WalmartMarketplaceAuthConfig): Promise<string> {
  const cacheKey = config.clientId;
  const cached = tokenCache.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.accessToken;
  }

  const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basicAuth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'WM_SVC.NAME': 'Walmart Marketplace',
      'WM_QOS.CORRELATION_ID': randomUUID(),
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, 'Walmart Marketplace OAuth token request failed');
    throw new Error(`Walmart Marketplace OAuth failed (${response.status}): ${errorText}`);
  }

  const data = await response.json() as { access_token: string; token_type: string; expires_in: number };
  const token: CachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  tokenCache.set(cacheKey, token);
  logger.info({ expiresIn: data.expires_in }, 'Walmart Marketplace access token obtained');

  return token.accessToken;
}

/**
 * Clear all cached tokens. Useful for testing or credential rotation.
 */
export function clearWalmartMarketplaceTokenCache(): void {
  tokenCache.clear();
}
