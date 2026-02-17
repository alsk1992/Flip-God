/**
 * Password hashing with Node.js built-in scrypt (zero native dependencies)
 */
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';

const SALT_LENGTH = 32;
const KEY_LENGTH = 64;
const SCRYPT_COST = 16384; // N
const BLOCK_SIZE = 8;      // r
const PARALLELISM = 1;     // p

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: SCRYPT_COST, r: BLOCK_SIZE, p: PARALLELISM }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptAsync(password, salt);
  return `scrypt:${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const parts = hash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const storedKey = Buffer.from(parts[2], 'hex');
  const derivedKey = await scryptAsync(password, salt);
  return timingSafeEqual(storedKey, derivedKey);
}
