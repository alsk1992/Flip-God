/**
 * Amazon SP-API Authentication — Login with Amazon (LWA) OAuth
 *
 * Handles access token management for SP-API.
 * For private (1P) seller apps, only needs LWA refresh_token + client_id/secret.
 * No IAM role needed for self-authorized apps.
 *
 * LWA access tokens expire in ~1 hour (3600s). We refresh 5 minutes before
 * expiry. If the refresh fails, the cache entry is cleared so subsequent calls
 * retry from scratch with the original refresh_token.
 */

import { createLogger } from '../../utils/logger';

const logger = createLogger('amazon-sp-auth');

/** Buffer before expiry at which we proactively refresh (5 minutes). */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export interface SpApiAuthConfig {
  /** LWA client ID */
  clientId: string;
  /** LWA client secret */
  clientSecret: string;
  /** LWA refresh token (from Seller Central app authorization) */
  refreshToken: string;
  /** SP-API endpoint (default: https://sellingpartnerapi-na.amazon.com) */
  endpoint?: string;
  /** Marketplace ID (default: ATVPDKIKX0DER for US) */
  marketplaceId?: string;
  /** Seller ID for SP-API calls. Falls back to 'me' (documented SP-API default). */
  sellerId?: string;
}

interface CachedToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

const LWA_TOKEN_URL = 'https://api.amazon.com/auth/o2/token';

// Capped to prevent unbounded growth if many credential sets are rotated.
const MAX_TOKEN_CACHE_SIZE = 50;
const tokenCache = new Map<string, CachedToken>();

export const SP_API_ENDPOINTS: Record<string, string> = {
  NA: 'https://sellingpartnerapi-na.amazon.com',
  EU: 'https://sellingpartnerapi-eu.amazon.com',
  FE: 'https://sellingpartnerapi-fe.amazon.com',
};

export const MARKETPLACE_IDS: Record<string, string> = {
  US: 'ATVPDKIKX0DER',
  CA: 'A2EUQ1WTGCTBG2',
  MX: 'A1AM78C64UM0Y8',
  UK: 'A1F83G8C2ARO7P',
  DE: 'A1PA6795UKMFR9',
  FR: 'A13V1IB3VIYZZH',
  IT: 'APJ6JRA9NG5V4',
  ES: 'A1RKKUPIHCS9HS',
  JP: 'A1VC38T7YXB528',
  AU: 'A39IBJ37TRP1C6',
  IN: 'A21TJRUUN4KGV',
};

/**
 * Refresh an SP-API access token using the LWA refresh_token grant.
 *
 * This is the low-level refresh call. Most callers should use `getSpApiToken`
 * which handles caching and automatic refresh transparently.
 */
export async function refreshSpApiToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<{ accessToken: string; expiresIn: number }> {
  logger.info('Refreshing SP-API access token via LWA refresh_token grant');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(LWA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, error: errorText }, 'LWA refresh_token grant failed');
    throw new Error(`LWA token refresh failed (${response.status}): ${errorText}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  logger.info({ expiresIn: data.expires_in }, 'SP-API access token refreshed');

  return { accessToken: data.access_token, expiresIn: data.expires_in };
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
 * Get a valid LWA access token, refreshing if needed.
 *
 * Checks the cache first — if the token is still valid (with a 5-minute
 * buffer before expiry), returns it. Otherwise refreshes using the
 * refresh_token. If the refresh fails, the cache is cleared and a fresh
 * request is attempted once.
 */
export async function getSpApiToken(config: SpApiAuthConfig): Promise<string> {
  const cacheKey = `${config.clientId}:sp`;
  const cached = tokenCache.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt - EXPIRY_BUFFER_MS) {
    return cached.accessToken;
  }

  // Use cached refresh token if available, otherwise fall back to config
  const rtToUse = cached?.refreshToken ?? config.refreshToken;

  try {
    const { accessToken, expiresIn } = await refreshSpApiToken(
      config.clientId,
      config.clientSecret,
      rtToUse,
    );

    const token: CachedToken = {
      accessToken,
      refreshToken: rtToUse,
      expiresAt: Date.now() + expiresIn * 1000,
    };
    evictAndSet(cacheKey, token);
    return token.accessToken;
  } catch (err) {
    // If we used a cached refresh token that differs from config, retry with config token
    if (rtToUse !== config.refreshToken) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        'SP-API refresh failed with cached token, retrying with original refresh_token',
      );
      tokenCache.delete(cacheKey);

      const { accessToken, expiresIn } = await refreshSpApiToken(
        config.clientId,
        config.clientSecret,
        config.refreshToken,
      );

      const token: CachedToken = {
        accessToken,
        refreshToken: config.refreshToken,
        expiresAt: Date.now() + expiresIn * 1000,
      };
      evictAndSet(cacheKey, token);
      return token.accessToken;
    }

    // No fallback available — clear cache and re-throw
    tokenCache.delete(cacheKey);
    throw err;
  }
}

export function clearSpApiTokenCache(): void {
  tokenCache.clear();
}
