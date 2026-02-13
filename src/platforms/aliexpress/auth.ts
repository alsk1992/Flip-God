/**
 * AliExpress API - Request signing (HMAC-SHA256)
 *
 * Signs requests for the AliExpress Affiliate/Dropshipping API.
 * All API calls are signed HTTP POST to the gateway endpoint.
 */

import * as crypto from 'crypto';
import { createLogger } from '../../utils/logger';

const logger = createLogger('aliexpress-auth');

export interface AliExpressAuthConfig {
  appKey: string;
  appSecret: string;
  accessToken?: string;
}

const API_GATEWAY = 'https://api-sg.aliexpress.com/sync';

/**
 * Generate HMAC-SHA256 signature for AliExpress API request.
 *
 * Algorithm:
 * 1. Sort all params alphabetically by key
 * 2. Concatenate as key1value1key2value2...
 * 3. HMAC-SHA256 with appSecret, uppercase hex result
 */
function signParams(params: Record<string, string>, appSecret: string): string {
  const sorted = Object.keys(params).sort();
  const concatenated = sorted.map(k => `${k}${params[k]}`).join('');
  return crypto
    .createHmac('sha256', appSecret)
    .update(concatenated, 'utf8')
    .digest('hex')
    .toUpperCase();
}

/**
 * Build a signed API request URL and body for AliExpress.
 *
 * @param method - API method name (e.g. "aliexpress.affiliate.product.query")
 * @param businessParams - method-specific parameters
 * @param config - App key + secret
 * @returns { url, body } ready for fetch POST
 */
export function buildSignedRequest(
  method: string,
  businessParams: Record<string, unknown>,
  config: AliExpressAuthConfig,
): { url: string; body: string; headers: Record<string, string> } {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const systemParams: Record<string, string> = {
    app_key: config.appKey,
    method,
    sign_method: 'sha256',
    timestamp,
    v: '2.0',
    format: 'json',
  };

  if (config.accessToken) {
    systemParams.session = config.accessToken;
  }

  // Flatten business params to strings
  const allParams: Record<string, string> = { ...systemParams };
  for (const [key, value] of Object.entries(businessParams)) {
    if (value !== undefined && value !== null) {
      allParams[key] = typeof value === 'string' ? value : JSON.stringify(value);
    }
  }

  allParams.sign = signParams(allParams, config.appSecret);

  const body = new URLSearchParams(allParams).toString();

  return {
    url: API_GATEWAY,
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
  };
}

/**
 * Execute a signed AliExpress API call.
 */
export async function callAliExpressApi<T = unknown>(
  method: string,
  businessParams: Record<string, unknown>,
  config: AliExpressAuthConfig,
): Promise<T> {
  const { url, body, headers } = buildSignedRequest(method, businessParams, config);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error({ status: response.status, method, error: errorText }, 'AliExpress API request failed');
    throw new Error(`AliExpress API failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  // AliExpress wraps responses in a method-specific key
  // e.g. "aliexpress_affiliate_product_query_response"
  const responseKey = method.replace(/\./g, '_') + '_response';
  const result = (data as Record<string, unknown>)[responseKey] ?? data;

  // Check for API-level errors
  const apiResult = result as Record<string, unknown>;
  if (apiResult.error_response) {
    const err = apiResult.error_response as Record<string, unknown>;
    throw new Error(`AliExpress API error: ${err.msg ?? err.sub_msg ?? JSON.stringify(err)}`);
  }

  return result as T;
}
