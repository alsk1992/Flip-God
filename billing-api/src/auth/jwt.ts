/**
 * JWT sign/verify — 15min access tokens, 7d refresh tokens
 */
import jwt from 'jsonwebtoken';

export interface TokenPayload {
  userId: string;
  email: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export function createJwtService(secret: string, refreshSecret: string) {
  return {
    signAccessToken(payload: TokenPayload): string {
      return jwt.sign(payload, secret, { expiresIn: '15m' });
    },

    signRefreshToken(payload: TokenPayload): string {
      return jwt.sign(payload, refreshSecret, { expiresIn: '7d' });
    },

    signTokenPair(payload: TokenPayload): TokenPair {
      return {
        accessToken: this.signAccessToken(payload),
        refreshToken: this.signRefreshToken(payload),
      };
    },

    verifyAccessToken(token: string): TokenPayload {
      return jwt.verify(token, secret) as TokenPayload;
    },

    verifyRefreshToken(token: string): TokenPayload {
      return jwt.verify(token, refreshSecret) as TokenPayload;
    },
  };
}

export type JwtService = ReturnType<typeof createJwtService>;
