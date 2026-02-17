/**
 * Auth service — register, login, JWT token management
 */
import { z } from 'zod';
import { createLogger } from '../utils/logger';
import { hashPassword, verifyPassword } from './password';
import type { JwtService, TokenPair } from './jwt';
import type { Db } from '../db';

const logger = createLogger('auth');

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  displayName: z.string().max(100).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export interface AuthService {
  register(input: unknown): Promise<{ user: { id: string; email: string }; tokens: TokenPair }>;
  login(input: unknown): Promise<{ user: { id: string; email: string }; tokens: TokenPair }>;
  refresh(refreshToken: string): Promise<TokenPair>;
}

export function createAuthService(db: Db, jwtService: JwtService): AuthService {
  return {
    async register(input: unknown) {
      const data = registerSchema.parse(input);

      // Check for existing user
      const existing = await db.queryOne<{ id: string }>(
        'SELECT id FROM billing_users WHERE email = $1',
        [data.email.toLowerCase()],
      );
      if (existing) {
        throw Object.assign(new Error('Email already registered'), { status: 409 });
      }

      const passwordHash = await hashPassword(data.password);
      const user = await db.queryOne<{ id: string; email: string }>(
        `INSERT INTO billing_users (email, password_hash, display_name)
         VALUES ($1, $2, $3)
         RETURNING id, email`,
        [data.email.toLowerCase(), passwordHash, data.displayName ?? null],
      );

      if (!user) throw new Error('Failed to create user');

      logger.info({ userId: user.id, email: user.email }, 'User registered');

      const tokens = jwtService.signTokenPair({ userId: user.id, email: user.email });
      return { user: { id: user.id, email: user.email }, tokens };
    },

    async login(input: unknown) {
      const data = loginSchema.parse(input);

      const user = await db.queryOne<{ id: string; email: string; password_hash: string; status: string }>(
        'SELECT id, email, password_hash, status FROM billing_users WHERE email = $1',
        [data.email.toLowerCase()],
      );

      if (!user) {
        throw Object.assign(new Error('Invalid email or password'), { status: 401 });
      }

      if (user.status !== 'active') {
        throw Object.assign(new Error('Account suspended'), { status: 403 });
      }

      const valid = await verifyPassword(user.password_hash, data.password);
      if (!valid) {
        throw Object.assign(new Error('Invalid email or password'), { status: 401 });
      }

      logger.info({ userId: user.id }, 'User logged in');

      const tokens = jwtService.signTokenPair({ userId: user.id, email: user.email });
      return { user: { id: user.id, email: user.email }, tokens };
    },

    async refresh(refreshToken: string) {
      const payload = jwtService.verifyRefreshToken(refreshToken);

      // Verify user still exists and is active
      const user = await db.queryOne<{ id: string; email: string; status: string }>(
        'SELECT id, email, status FROM billing_users WHERE id = $1',
        [payload.userId],
      );

      if (!user || user.status !== 'active') {
        throw Object.assign(new Error('Invalid refresh token'), { status: 401 });
      }

      return jwtService.signTokenPair({ userId: user.id, email: user.email });
    },
  };
}
