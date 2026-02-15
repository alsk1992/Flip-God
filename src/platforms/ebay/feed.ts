/**
 * eBay Feed API — Bulk operations (Sell Feed + Buy Feed)
 *
 * Endpoints:
 * - POST /sell/feed/v1/inventory_task — create inventory task
 * - GET /sell/feed/v1/inventory_task/{taskId} — get task status
 * - POST /sell/feed/v1/task/{taskId}/upload_file — upload file for task
 * - GET /sell/feed/v1/task/{taskId}/download_result_file — download result
 * - GET /buy/feed/v1_beta/item_snapshot — get item snapshot feed
 */

import { createLogger } from '../../utils/logger';
import type { EbayCredentials } from '../../types';
import { getAccessToken, API_BASE } from './auth';

const logger = createLogger('ebay-feed');

export interface EbayInventoryTaskParams {
  feedType: string;
  schemaVersion: string;
}

export interface EbayInventoryTask {
  taskId: string;
  status?: string;
  feedType?: string;
  creationDate?: string;
  completionDate?: string;
  uploadSummary?: { successCount?: number; failureCount?: number };
}

export interface EbayItemSnapshotParams {
  categoryId?: string;
  date?: string;
}

export interface EbayFeedApi {
  createInventoryTask(params: EbayInventoryTaskParams): Promise<string | null>;
  getInventoryTask(taskId: string): Promise<EbayInventoryTask | null>;
  uploadFile(taskId: string, data: Buffer): Promise<boolean>;
  getResultFile(taskId: string): Promise<Buffer | null>;
  getItemSnapshotFeed(params?: EbayItemSnapshotParams): Promise<Buffer | null>;
}

export function createEbayFeedApi(credentials: EbayCredentials): EbayFeedApi {
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
    async createInventoryTask(params) {
      try {
        const token = await getToken();
        const response = await fetch(
          `${baseUrl}/sell/feed/v1/inventory_task`,
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
          logger.error({ status: response.status, error: errorText }, 'Failed to create inventory task');
          return null;
        }

        // Task ID returned via Location header
        const location = response.headers.get('location') ?? '';
        const taskId = location.split('/').pop() ?? '';
        logger.info({ taskId, feedType: params.feedType }, 'Inventory task created');
        return taskId || null;
      } catch (err) {
        logger.error({ err }, 'Error in createInventoryTask');
        return null;
      }
    },

    async getInventoryTask(taskId) {
      try {
        const token = await getToken();
        const response = await fetch(
          `${baseUrl}/sell/feed/v1/inventory_task/${encodeURIComponent(taskId)}`,
          { headers: { 'Authorization': `Bearer ${token}` } },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, taskId, error: errorText }, 'Failed to get inventory task');
          return null;
        }

        return await response.json() as EbayInventoryTask;
      } catch (err) {
        logger.error({ err, taskId }, 'Error in getInventoryTask');
        return null;
      }
    },

    async uploadFile(taskId, data) {
      try {
        const token = await getToken();

        // Build multipart/form-data manually
        const boundary = `----EbayFeedBoundary${Date.now()}`;
        const bodyParts = [
          `--${boundary}\r\n`,
          'Content-Disposition: form-data; name="file"; filename="upload.csv"\r\n',
          'Content-Type: application/octet-stream\r\n\r\n',
        ];

        const header = Buffer.from(bodyParts.join(''));
        const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
        const body = Buffer.concat([header, data, footer]);

        const response = await fetch(
          `${baseUrl}/sell/feed/v1/task/${encodeURIComponent(taskId)}/upload_file`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': `multipart/form-data; boundary=${boundary}`,
              'Content-Length': String(body.length),
            },
            body,
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, taskId, error: errorText }, 'Failed to upload file');
          return false;
        }

        logger.info({ taskId, size: data.length }, 'File uploaded for task');
        return true;
      } catch (err) {
        logger.error({ err, taskId }, 'Error in uploadFile');
        return false;
      }
    },

    async getResultFile(taskId) {
      try {
        const token = await getToken();
        const response = await fetch(
          `${baseUrl}/sell/feed/v1/task/${encodeURIComponent(taskId)}/download_result_file`,
          { headers: { 'Authorization': `Bearer ${token}` } },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, taskId, error: errorText }, 'Failed to download result file');
          return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } catch (err) {
        logger.error({ err, taskId }, 'Error in getResultFile');
        return null;
      }
    },

    async getItemSnapshotFeed(params?) {
      try {
        const token = await getToken();
        const qp = new URLSearchParams();
        qp.set('feed_scope', 'NEWLY_LISTED');
        if (params?.categoryId) qp.set('category_id', params.categoryId);
        if (params?.date) qp.set('date', params.date);

        const response = await fetch(
          `${baseUrl}/buy/feed/v1_beta/item_snapshot?${qp.toString()}`,
          { headers: { 'Authorization': `Bearer ${token}` } },
        );

        if (!response.ok) {
          const errorText = await response.text();
          logger.error({ status: response.status, error: errorText }, 'Failed to get item snapshot feed');
          return null;
        }

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
      } catch (err) {
        logger.error({ err }, 'Error in getItemSnapshotFeed');
        return null;
      }
    },
  };
}
