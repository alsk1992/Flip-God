/**
 * eBay Notification API — Event subscriptions and webhooks
 *
 * Endpoints:
 * - POST /commerce/notification/v1/destination — create webhook destination
 * - GET /commerce/notification/v1/destination — list destinations
 * - POST /commerce/notification/v1/subscription — create topic subscription
 * - GET /commerce/notification/v1/subscription — list subscriptions
 * - GET /commerce/notification/v1/topic — list available topics
 */

import { createLogger } from '../../utils/logger';
import type { EbayCredentials } from '../../types';
import { getAccessToken, API_BASE } from './auth';

const logger = createLogger('ebay-notification');

export interface EbayDestination {
  destinationId: string;
  name: string;
  status?: string;
  deliveryConfig: {
    endpoint: string;
    verificationToken?: string;
  };
}

export interface EbaySubscription {
  subscriptionId: string;
  topicId: string;
  destinationId: string;
  status: string;
  creationDate?: string;
}

export interface EbayTopic {
  topicId: string;
  description?: string;
  status?: string;
  context?: string;
  scope?: string;
}

export interface EbayCreateDestinationParams {
  name: string;
  deliveryConfig: {
    endpoint: string;
    verificationToken: string;
  };
}

export interface EbayCreateSubscriptionParams {
  topicId: string;
  destinationId: string;
  status: 'ENABLED';
}

export interface EbayNotificationApi {
  createDestination(params: EbayCreateDestinationParams): Promise<string | null>;
  getDestinations(): Promise<EbayDestination[]>;
  createSubscription(params: EbayCreateSubscriptionParams): Promise<string | null>;
  getSubscriptions(): Promise<EbaySubscription[]>;
  getTopics(): Promise<EbayTopic[]>;
}

export function createEbayNotificationApi(credentials: EbayCredentials): EbayNotificationApi {
  const env = credentials.environment ?? 'production';
  const baseUrl = API_BASE[env];

  async function getToken(): Promise<string> {
    return getAccessToken({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      environment: env,
    });
  }

  return {
    async createDestination(params) {
      try {
        const token = await getToken();
        const response = await fetch(
          `${baseUrl}/commerce/notification/v1/destination`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(params),
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'Failed to create destination');
          return null;
        }

        const location = response.headers.get('location') ?? '';
        const destinationId = location.split('/').pop() ?? '';
        logger.info({ destinationId, name: params.name }, 'Notification destination created');
        return destinationId || null;
      } catch (err) {
        logger.error({ err }, 'Error in createDestination');
        return null;
      }
    },

    async getDestinations() {
      try {
        const token = await getToken();
        const response = await fetch(
          `${baseUrl}/commerce/notification/v1/destination`,
          { headers: { 'Authorization': `Bearer ${token}` } },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'Failed to get destinations');
          return [];
        }

        const data = await response.json() as { destinations?: EbayDestination[] };
        return data.destinations ?? [];
      } catch (err) {
        logger.error({ err }, 'Error in getDestinations');
        return [];
      }
    },

    async createSubscription(params) {
      try {
        const token = await getToken();
        const response = await fetch(
          `${baseUrl}/commerce/notification/v1/subscription`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(params),
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'Failed to create subscription');
          return null;
        }

        const location = response.headers.get('location') ?? '';
        const subscriptionId = location.split('/').pop() ?? '';
        logger.info({ subscriptionId, topicId: params.topicId }, 'Notification subscription created');
        return subscriptionId || null;
      } catch (err) {
        logger.error({ err }, 'Error in createSubscription');
        return null;
      }
    },

    async getSubscriptions() {
      try {
        const token = await getToken();
        const response = await fetch(
          `${baseUrl}/commerce/notification/v1/subscription`,
          { headers: { 'Authorization': `Bearer ${token}` } },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'Failed to get subscriptions');
          return [];
        }

        const data = await response.json() as { subscriptions?: EbaySubscription[] };
        return data.subscriptions ?? [];
      } catch (err) {
        logger.error({ err }, 'Error in getSubscriptions');
        return [];
      }
    },

    async getTopics() {
      try {
        const token = await getToken();
        const response = await fetch(
          `${baseUrl}/commerce/notification/v1/topic`,
          { headers: { 'Authorization': `Bearer ${token}` } },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'Failed to get topics');
          return [];
        }

        const data = await response.json() as { topics?: EbayTopic[] };
        return data.topics ?? [];
      } catch (err) {
        logger.error({ err }, 'Error in getTopics');
        return [];
      }
    },
  };
}
