/**
 * API key generation and hashing utilities
 */
import crypto from 'crypto';

const KEY_PREFIX = 'fg_live_';
const KEY_BYTES = 24; // 48 hex chars

/** Generate a new API key with prefix */
export function generateApiKey(): { fullKey: string; prefix: string; hash: string } {
  const randomPart = crypto.randomBytes(KEY_BYTES).toString('hex');
  const fullKey = `${KEY_PREFIX}${randomPart}`;
  const prefix = `${KEY_PREFIX}${randomPart.slice(0, 8)}`;
  const hash = hashApiKey(fullKey);
  return { fullKey, prefix, hash };
}

/** SHA-256 hash of an API key for storage */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}
