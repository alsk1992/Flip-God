/**
 * Amazon PA-API 5.0 - AWS Signature V4 request signing
 *
 * Signs HTTP requests using HMAC-SHA256 as required by Amazon's
 * Product Advertising API 5.0.
 */

import * as crypto from 'crypto';
import { createLogger } from '../../utils/logger';

const logger = createLogger('amazon-auth');

export interface AmazonSigningConfig {
  accessKeyId: string;
  secretAccessKey: string;
  partnerTag: string;
  /** Amazon marketplace host (default: webservices.amazon.com) */
  host?: string;
  /** AWS region (default: us-east-1) */
  region?: string;
}

interface SignedHeaders {
  [key: string]: string;
}

const SERVICE = 'ProductAdvertisingAPI';
const DEFAULT_HOST = 'webservices.amazon.com';
const DEFAULT_REGION = 'us-east-1';

function hmacSHA256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

/**
 * Build the AWS Signature V4 signing key from date + region + service.
 */
function getSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmacSHA256(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacSHA256(kDate, region);
  const kService = hmacSHA256(kRegion, service);
  return hmacSHA256(kService, 'aws4_request');
}

/**
 * Sign a PA-API request and return the full set of headers needed.
 *
 * @param operation - PA-API operation (e.g. "SearchItems", "GetItems")
 * @param payload - JSON-stringified request body
 * @param config - Amazon credentials
 */
export function signRequest(
  operation: string,
  payload: string,
  config: AmazonSigningConfig,
): SignedHeaders {
  const host = config.host ?? DEFAULT_HOST;
  const region = config.region ?? DEFAULT_REGION;
  const path = '/paapi5/' + operation.toLowerCase();
  const method = 'POST';

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const contentType = 'application/json; charset=UTF-8';
  const target = `com.amazon.paapi5.v1.ProductAdvertisingAPIv1.${operation}`;

  // Canonical headers (must be sorted by lowercase key)
  const canonicalHeaders = [
    `content-encoding:amz-1.0`,
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-date:${amzDate}`,
    `x-amz-target:${target}`,
  ].join('\n') + '\n';

  const signedHeadersList = 'content-encoding;content-type;host;x-amz-date;x-amz-target';

  const payloadHash = sha256(payload);

  const canonicalRequest = [
    method,
    path,
    '', // no query string for PA-API POST
    canonicalHeaders,
    signedHeadersList,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256(canonicalRequest),
  ].join('\n');

  const signingKey = getSigningKey(config.secretAccessKey, dateStamp, region, SERVICE);
  const signature = hmacSHA256(signingKey, stringToSign).toString('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;

  return {
    'content-encoding': 'amz-1.0',
    'content-type': contentType,
    'host': host,
    'x-amz-date': amzDate,
    'x-amz-target': target,
    'authorization': authorization,
  };
}

/**
 * Marketplace host mapping for different Amazon regions.
 */
export const MARKETPLACE_HOSTS: Record<string, { host: string; region: string }> = {
  US: { host: 'webservices.amazon.com', region: 'us-east-1' },
  UK: { host: 'webservices.amazon.co.uk', region: 'eu-west-1' },
  DE: { host: 'webservices.amazon.de', region: 'eu-west-1' },
  FR: { host: 'webservices.amazon.fr', region: 'eu-west-1' },
  JP: { host: 'webservices.amazon.co.jp', region: 'us-west-2' },
  CA: { host: 'webservices.amazon.ca', region: 'us-east-1' },
  AU: { host: 'webservices.amazon.com.au', region: 'us-west-2' },
  IN: { host: 'webservices.amazon.in', region: 'eu-west-1' },
  IT: { host: 'webservices.amazon.it', region: 'eu-west-1' },
  ES: { host: 'webservices.amazon.es', region: 'eu-west-1' },
  MX: { host: 'webservices.amazon.com.mx', region: 'us-east-1' },
  BR: { host: 'webservices.amazon.com.br', region: 'us-east-1' },
};
