/**
 * Walmart Marketplace OAuth2 Token Management
 *
 * Handles client_credentials grant for the Marketplace API.
 * Caches tokens for their lifetime (typically 900 seconds / ~15 minutes)
 * with a 30-second safety margin before expiry.
 *
 * Walmart uses client_credentials (no refresh_token), so "refresh" means
 * requesting a new token from scratch. The short TTL makes the 30-second
 * buffer important to avoid mid-request expiry.
 */

import { createLogger } from '../../utils/logger';
import { randomUUID } from 'crypto';

const logger = createLogger('walmart-auth');

const TOKEN_URL = 'https://marketplace.walmartapis.com/v3/token';

/**
 * Buffer before expiry at which we proactively re-request (30 seconds).
 * Walmart tokens are only ~900s, so 30s is proportionally generous while
 * still maximizing cache hit rate.
 */
const EXPIRY_BUFFER_MS = 30 * 1000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// Capped to prevent unbounded growth if many credential sets are rotated.
const MAX_TOKEN_CACHE_SIZE = 50;
const tokenCache = new Map<string, CachedToken>();

export interface WalmartMarketplaceAuthConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * Request a fresh Walmart Marketplace access token.
 *
 * Walmart uses client_credentials grant only (no refresh_token). This is
 * called both for initial auth and when the cached token is near expiry.
 */
async function requestWalmartToken(
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  logger.info('Requesting Walmart Marketplace access token');

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
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const errorText = (await response.text().catch(() => '')).slice(0, 200);
    logger.error({ status: response.status }, 'Walmart Marketplace OAuth token request failed');
    throw new Error(`Walmart Marketplace OAuth failed (${response.status}): ${errorText}`);
  }

  const data = await response.json() as { access_token: string; token_type: string; expires_in: number };
  logger.info({ expiresIn: data.expires_in }, 'Walmart Marketplace access token obtained');
  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/**
 * Get a valid Marketplace access token, using cache when possible.
 * Token is re-requested 30 seconds before expiry to avoid edge-case failures.
 */
export async function getWalmartMarketplaceToken(config: WalmartMarketplaceAuthConfig): Promise<string> {
  const cacheKey = config.clientId;
  const cached = tokenCache.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt - EXPIRY_BUFFER_MS) {
    return cached.accessToken;
  }

  const { accessToken, expiresIn } = await requestWalmartToken(
    config.clientId,
    config.clientSecret,
  );

  const token: CachedToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  // Evict oldest entry if cache is full
  if (tokenCache.size >= MAX_TOKEN_CACHE_SIZE && !tokenCache.has(cacheKey)) {
    const firstKey = tokenCache.keys().next().value;
    if (firstKey) tokenCache.delete(firstKey);
  }
  tokenCache.set(cacheKey, token);

  return token.accessToken;
}

/**
 * Clear all cached tokens. Useful for testing or credential rotation.
 */
export function clearWalmartMarketplaceTokenCache(): void {
  tokenCache.clear();
}
