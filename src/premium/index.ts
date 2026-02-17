/**
 * Premium module — client for FlipGod billing API
 *
 * Provides premium feature gating, usage reporting, and server-side scoring.
 * Gracefully degrades to free tier when no API key is configured.
 */
import { createPremiumClient, type PremiumClient } from './client';
import { createLogger } from '../utils/logger';

const logger = createLogger('premium');

export type { PremiumClient, ValidationResult, ScoreResult, OptimizeResult } from './client';

/** Create premium client if API key is configured, otherwise return null */
export function initPremiumClient(): PremiumClient | null {
  const apiKey = process.env.FLIPGOD_API_KEY;

  if (!apiKey) {
    logger.info('No FLIPGOD_API_KEY configured — running in free tier');
    return null;
  }

  if (!apiKey.startsWith('fg_live_')) {
    logger.warn('FLIPGOD_API_KEY does not start with fg_live_ — may be invalid');
  }

  const baseUrl = process.env.FLIPGOD_API_URL ?? 'https://compute.flip-god.com';
  const client = createPremiumClient(apiKey, baseUrl);

  logger.info('Premium client initialized');

  // Validate on startup (fire and forget)
  client.validate().then((result) => {
    if (result.valid) {
      logger.info({ plan: result.plan }, 'API key validated — premium features available');
    } else {
      logger.warn('API key validation failed — running in free tier');
    }
  }).catch(() => {
    logger.warn('Could not reach billing API — running in free tier');
  });

  return client;
}
