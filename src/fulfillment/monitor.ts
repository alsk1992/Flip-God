/**
 * Order Monitor - Watches for incoming orders to fulfill
 *
 * Polls eBay Fulfillment API for new unfulfilled orders and creates
 * local order records for processing.
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger';
import type { Database } from '../db';
import type { EbayCredentials, Platform } from '../types';
import { createEbayOrdersApi } from '../platforms/ebay/orders';

const logger = createLogger('order-monitor');

export interface OrderMonitor {
  start(): void;
  stop(): void;
  checkOrders(): Promise<number>;
}

export function createOrderMonitor(
  db: Database,
  credentials?: { ebay?: EbayCredentials },
): OrderMonitor {
  let interval: NodeJS.Timeout | null = null;

  return {
    start() {
      logger.info('Order monitor started');
      // Check every 5 minutes
      interval = setInterval(() => {
        this.checkOrders().catch(err => logger.error({ err }, 'Order check failed'));
      }, 5 * 60 * 1000);
    },

    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      logger.info('Order monitor stopped');
    },

    async checkOrders(): Promise<number> {
      let newOrderCount = 0;

      // Poll eBay for unfulfilled orders
      if (credentials?.ebay?.refreshToken) {
        try {
          const ordersApi = createEbayOrdersApi(credentials.ebay);
          const ebayOrders = await ordersApi.getUnfulfilledOrders();

          for (const ebayOrder of ebayOrders) {
            // Check if we already have this order
            const existing = db.query<{ id: string }>(
              'SELECT id FROM orders WHERE sell_order_id = ? AND sell_platform = ?',
              [ebayOrder.orderId, 'ebay'],
            );

            if (existing.length > 0) continue;

            // Find matching listing by SKU
            const sku = ebayOrder.lineItems[0]?.sku;
            const escapedSku = sku ? sku.replace(/[%_]/g, '\\$&') : undefined;
            const listing = sku ? db.query<{
              id: string;
              product_id: string;
              source_platform: string;
              source_price: number;
            }>(
              "SELECT id, product_id, source_platform, source_price FROM listings WHERE platform_listing_id = ? OR id LIKE ? ESCAPE '\\'",
              [sku, `%${escapedSku}%`],
            ) : [];

            const sellPrice = ebayOrder.pricingSummary?.total
              ? parseFloat(ebayOrder.pricingSummary.total.value)
              : 0;

            // Get shipping address
            const shipTo = ebayOrder.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
            const address = shipTo?.contactAddress;
            const buyerAddress = address
              ? `${shipTo.fullName ?? ''}, ${address.addressLine1 ?? ''}, ${address.city ?? ''}, ${address.stateOrProvince ?? ''} ${address.postalCode ?? ''}, ${address.countryCode ?? ''}`
              : '';

            const sourcePlatform = listing[0]?.source_platform as Platform | undefined;
            if (!sourcePlatform) {
              logger.warn(
                { ebayOrderId: ebayOrder.orderId, sku },
                'Unknown buy platform — no matching listing found. Skipping auto-order creation; requires manual review.',
              );
              continue;
            }

            const orderId = randomUUID().slice(0, 12);
            db.addOrder({
              id: orderId,
              listingId: listing[0]?.id ?? 'unknown',
              sellPlatform: 'ebay' as Platform,
              sellOrderId: ebayOrder.orderId,
              sellPrice,
              buyPlatform: sourcePlatform,
              status: 'pending',
              buyerAddress,
              orderedAt: new Date(ebayOrder.creationDate),
            });

            newOrderCount++;
            logger.info({ orderId, ebayOrderId: ebayOrder.orderId, sellPrice }, 'New order detected');
          }
        } catch (err) {
          logger.error({ err }, 'Failed to check eBay orders');
        }
      }

      // Also check locally tracked pending orders
      const pendingOrders = db.query<{ id: string }>(
        'SELECT id FROM orders WHERE status = ?',
        ['pending'],
      );

      logger.info({ newOrders: newOrderCount, pending: pendingOrders.length }, 'Order check complete');
      return pendingOrders.length;
    },
  };
}
