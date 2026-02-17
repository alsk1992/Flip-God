/**
 * HTTP client to billing API at compute.flip-god.com
 */
import http from 'http';
import https from 'https';
import { createLogger } from '../utils/logger';
import { ValidationCache } from './cache';

const logger = createLogger('premium-client');

export interface ValidationResult {
  valid: boolean;
  plan: string;
  userId?: string;
}

export interface ScoreResult {
  score: number;
  maxScore: number;
  grade: string;
  recommendation: string;
  signals: Record<string, number>;
}

export interface OptimizeResult {
  title: string;
  keywords: string[];
  suggestedPrice?: { competitive: number; premium: number; clearance: number };
  tips: string[];
}

export interface PremiumClient {
  validate(): Promise<ValidationResult>;
  isPremium(): Promise<boolean>;
  reportSale(gmvCents: number, idempotencyKey: string, metadata?: Record<string, unknown>): Promise<{ recorded: boolean }>;
  scoreOpportunity(opportunity: {
    buyPrice: number;
    sellPrice: number;
    buyShipping: number;
    category?: string;
    brand?: string;
    salesRank?: number;
  }): Promise<ScoreResult>;
  optimizeListing(params: {
    title: string;
    description?: string;
    category?: string;
    price?: number;
  }): Promise<OptimizeResult>;
}

export function createPremiumClient(apiKey: string, baseUrl = 'https://compute.flip-god.com'): PremiumClient {
  const validationCache = new ValidationCache<ValidationResult>(60_000);

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = new URL(path, baseUrl);
    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;

    const payload = body ? JSON.stringify(body) : undefined;

    return new Promise((resolve, reject) => {
      const req = lib.request(
        url,
        {
          method,
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
          },
          timeout: 10_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf-8');
            try {
              const data = JSON.parse(raw);
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(data.error ?? `HTTP ${res.statusCode}`));
              } else {
                resolve(data as T);
              }
            } catch {
              reject(new Error(`Invalid JSON response: ${raw.slice(0, 200)}`));
            }
          });
        },
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (payload) req.write(payload);
      req.end();
    });
  }

  return {
    async validate(): Promise<ValidationResult> {
      const cached = validationCache.get('validation');
      if (cached) return cached;

      try {
        const result = await request<ValidationResult>('POST', '/validate');
        validationCache.set('validation', result);
        return result;
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Validation request failed — assuming free tier');
        return { valid: false, plan: 'free' };
      }
    },

    async isPremium(): Promise<boolean> {
      const result = await this.validate();
      return result.valid && result.plan === 'premium';
    },

    async reportSale(gmvCents, idempotencyKey, metadata) {
      try {
        return await request<{ recorded: boolean }>('POST', '/premium/report', {
          gmvCents,
          idempotencyKey,
          metadata,
        });
      } catch (err) {
        logger.error({ err: err instanceof Error ? err.message : String(err) }, 'Failed to report sale');
        return { recorded: false };
      }
    },

    async scoreOpportunity(opportunity) {
      return request<ScoreResult>('POST', '/premium/score', { opportunity });
    },

    async optimizeListing(params) {
      return request<OptimizeResult>('POST', '/premium/optimize', params);
    },
  };
}
