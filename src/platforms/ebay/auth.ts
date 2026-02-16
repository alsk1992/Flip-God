/**
 * eBay OAuth 2.0 - Token management
 *
 * Handles client_credentials and authorization_code grant types.
 * Caches access tokens and auto-refreshes before expiry.
 *
 * eBay access tokens expire in ~2 hours (7200s). We refresh 5 minutes
 * before expiry to avoid mid-request failures. If the refresh_token grant
 * fails, the cache entry is cleared so the next call re-authenticates.
 */

import { createLogger } from '../../utils/logger';

const logger = createLogger('ebay-auth');

/** Buffer before expiry at which we proactively refresh (5 minutes). */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export interface EbayAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken?: string;
  environment?: 'sandbox' | 'production';
}

interface CachedToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

const ENDPOINTS = {
  production: 'https://api.ebay.com/identity/v1/oauth2/token',
  sandbox: 'https://api.sandbox.ebay.com/identity/v1/oauth2/token',
};

export const API_BASE = {
  production: 'https://api.ebay.com',
  sandbox: 'https://api.sandbox.ebay.com',
};

const SELL_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.finances',
  'https://api.ebay.com/oauth/api_scope/sell.analytics.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.marketing',
  'https://api.ebay.com/oauth/api_scope/commerce.taxonomy.readonly',
].join(' ');

// Token cache: key = clientId:env, value = { accessToken, refreshToken, expiresAt }
// Capped to prevent unbounded growth if many credential sets are rotated.
const MAX_TOKEN_CACHE_SIZE = 50;
const tokenCache = new Map<string, CachedToken>();

/**
 * Refresh an eBay access token using a refresh_token grant.
 *
 * This is the low-level refresh call. Most callers should use `getAccessToken`
 * which handles caching and automatic refresh transparently.
 */
export async function refreshEbayToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  environment: 'sandbox' | 'production' = 'production',
): Promise<{ accessToken: string; expiresIn: number }> {
  const endpoint = ENDPOINTS[environment];
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: SELL_SCOPES,
  });

  logger.info({ env: environment }, 'Refreshing eBay access token via refresh_token grant');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth}`,
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, 'eBay refresh_token grant failed');
    throw new Error(`eBay token refresh failed (${response.status}): ${errorText}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  logger.info({ env: environment, expiresIn: data.expires_in }, 'eBay access token refreshed');

  return { accessToken: data.access_token, expiresIn: data.expires_in };
}

/**
 * Get a valid access token, refreshing if needed.
 *
 * Uses client_credentials grant for Browse API (read-only) access.
 * Uses refresh_token grant for Sell APIs (listing, fulfillment) if refreshToken provided.
 *
 * Tokens are refreshed 5 minutes before expiry. If the refresh fails and a
 * refreshToken is available, the cache entry is cleared and re-auth is attempted
 * once from scratch.
 */
export async function getAccessToken(config: EbayAuthConfig): Promise<string> {
  const env = config.environment ?? 'production';
  const cacheKey = `${config.clientId}:${env}`;

  // Check cache — return early if token is still valid with buffer
  const cached = tokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - EXPIRY_BUFFER_MS) {
    return cached.accessToken;
  }

  // If we have a cached refresh token or one from config, try refresh first
  const rtToUse = config.refreshToken ?? cached?.refreshToken;

  if (rtToUse) {
    try {
      const { accessToken, expiresIn } = await refreshEbayToken(
        config.clientId,
        config.clientSecret,
        rtToUse,
        env,
      );

      const token: CachedToken = {
        accessToken,
        refreshToken: rtToUse,
        expiresAt: Date.now() + expiresIn * 1000,
      };
      evictAndSet(cacheKey, token);
      return token.accessToken;
    } catch (err) {
      // Refresh failed — clear cache and fall through to full re-auth
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'eBay refresh_token grant failed, clearing cache and re-authenticating',
      );
      tokenCache.delete(cacheKey);
    }
  }

  // Full token request (client_credentials or refresh_token from config)
  const endpoint = ENDPOINTS[env];
  const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');

  const body = config.refreshToken
    ? new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: config.refreshToken,
        scope: SELL_SCOPES,
      })
    : new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope',
      });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth}`,
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, 'eBay OAuth token request failed');
    throw new Error(`eBay OAuth failed (${response.status}): ${errorText}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };

  const token: CachedToken = {
    accessToken: data.access_token,
    refreshToken: config.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  evictAndSet(cacheKey, token);
  logger.info({ env, expiresIn: data.expires_in }, 'eBay access token obtained');

  return token.accessToken;
}

/** Store token in cache, evicting the oldest entry if full. */
function evictAndSet(cacheKey: string, token: CachedToken): void {
  if (tokenCache.size >= MAX_TOKEN_CACHE_SIZE && !tokenCache.has(cacheKey)) {
    const firstKey = tokenCache.keys().next().value;
    if (firstKey) tokenCache.delete(firstKey);
  }
  tokenCache.set(cacheKey, token);
}

/**
 * Clear cached tokens (useful when credentials change).
 */
export function clearTokenCache(): void {
  tokenCache.clear();
}
