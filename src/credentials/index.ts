/**
 * Credentials Manager - Per-User Trading Credentials
 *
 * AES-256-GCM encryption with scrypt key derivation.
 * Credentials are stored encrypted in the database per user/platform.
 * The encryption key is read lazily from FLIPAGENT_CREDENTIAL_KEY so
 * it can be auto-generated at startup without import-order issues.
 */

import * as crypto from 'crypto';
import type { Platform, CredentialPlatform } from '../types';
import type { Database } from '../db/index';
import { createLogger } from '../utils/logger';

const logger = createLogger('credentials');

// ---------------------------------------------------------------------------
// Encryption primitives
// ---------------------------------------------------------------------------

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const VERSION_PREFIX = 'v2';

/** Read the encryption key lazily at call time (not at import time). */
function getEncryptionKey(): string | undefined {
  return process.env.FLIPAGENT_CREDENTIAL_KEY;
}

function requireEncryptionKey(): string {
  const key = getEncryptionKey();
  if (!key || key.trim().length === 0) {
    throw new Error(
      'FLIPAGENT_CREDENTIAL_KEY is required for credential encryption. ' +
        'Set it as an environment variable (min 16 chars recommended).',
    );
  }
  return key;
}

/**
 * Encrypt a plaintext string.
 * Returns `v2:<salt_hex>:<iv_hex>:<authTag_hex>:<ciphertext_hex>`.
 */
export function encrypt(data: string): string {
  const encKey = requireEncryptionKey();
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(encKey, salt, 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return [
    VERSION_PREFIX,
    salt.toString('hex'),
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted,
  ].join(':');
}

/**
 * Decrypt a string produced by `encrypt()`.
 * Expects the `v2:salt:iv:authTag:ciphertext` format.
 */
export function decrypt(encryptedData: string): string {
  const encKey = requireEncryptionKey();
  const parts = encryptedData.split(':');

  if (parts[0] !== VERSION_PREFIX || parts.length < 5) {
    throw new Error('Invalid encrypted credential payload (unsupported format)');
  }

  const [, saltHex, ivHex, authTagHex, ciphertext] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const key = crypto.scryptSync(encKey, salt, 32);
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ---------------------------------------------------------------------------
// CredentialsManager interface
// ---------------------------------------------------------------------------

export interface CredentialsManager {
  /** Store (or overwrite) credentials for a user/platform. */
  setCredentials(userId: string, platform: CredentialPlatform, credentials: unknown): void;

  /** Get decrypted credentials for a user/platform, or null. */
  getCredentials<T = unknown>(userId: string, platform: CredentialPlatform): T | null;

  /** Check whether credentials exist and are enabled. */
  hasCredentials(userId: string, platform: CredentialPlatform): boolean;

  /** Delete credentials for a user/platform. */
  deleteCredentials(userId: string, platform: CredentialPlatform): void;

  /** List all platforms for which the user has enabled credentials. */
  listUserPlatforms(userId: string): CredentialPlatform[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createCredentialsManager(db: Database): CredentialsManager {
  const hasKey = Boolean(getEncryptionKey()?.trim());
  if (!hasKey) {
    logger.warn(
      'FLIPAGENT_CREDENTIAL_KEY is not set. Credential operations will fail until it is provided.',
    );
  }

  return {
    setCredentials(userId: string, platform: CredentialPlatform, credentials: unknown): void {
      const encryptedData = encrypt(JSON.stringify(credentials));
      const now = new Date();

      const existing = db.getTradingCredentials(userId, platform as Platform);
      if (existing) {
        db.updateTradingCredentials({
          ...existing,
          mode: 'api_key',
          encryptedData,
          enabled: true,
          failedAttempts: 0,
          cooldownUntil: undefined,
          updatedAt: now,
        });
      } else {
        db.createTradingCredentials({
          userId,
          platform: platform as Platform,
          mode: 'api_key',
          encryptedData,
          enabled: true,
          failedAttempts: 0,
          createdAt: now,
          updatedAt: now,
        });
      }

      logger.info({ userId, platform }, 'Stored credentials');
    },

    getCredentials<T = unknown>(userId: string, platform: CredentialPlatform): T | null {
      const creds = db.getTradingCredentials(userId, platform as Platform);
      if (!creds || !creds.enabled) return null;

      // Check cooldown
      if (creds.cooldownUntil && new Date() < creds.cooldownUntil) {
        logger.warn({ userId, platform }, 'Credentials in cooldown');
        return null;
      }

      try {
        const decrypted = decrypt(creds.encryptedData);
        return JSON.parse(decrypted) as T;
      } catch (err) {
        logger.error({ userId, platform, err }, 'Failed to decrypt credentials');
        return null;
      }
    },

    hasCredentials(userId: string, platform: CredentialPlatform): boolean {
      const creds = db.getTradingCredentials(userId, platform as Platform);
      return creds !== null && creds.enabled;
    },

    deleteCredentials(userId: string, platform: CredentialPlatform): void {
      db.deleteTradingCredentials(userId, platform as Platform);
      logger.info({ userId, platform }, 'Deleted credentials');
    },

    listUserPlatforms(userId: string): CredentialPlatform[] {
      const rows = db.query<{ platform: string }>(
        'SELECT platform FROM trading_credentials WHERE user_id = ? AND enabled = 1',
        [userId],
      );
      return rows.map((r) => r.platform as CredentialPlatform);
    },
  };
}
