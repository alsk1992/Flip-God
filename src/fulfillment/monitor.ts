/**
 * Order Monitor - Watches for incoming orders to fulfill
 *
 * Polls eBay Fulfillment API for new unfulfilled orders and creates
 * local order records for processing. When FBA inventory is available
 * for a pending order, attempts auto-fulfillment via MCF.
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger';
import type { Database } from '../db';
import type { EbayCredentials, AmazonCredentials, Platform } from '../types';
import { createEbayOrdersApi } from '../platforms/ebay/orders';
import { createFbaMcfApi } from './fba';

const logger = createLogger('order-monitor');

/** How often to poll for new unfulfilled orders (5 minutes). */
const ORDER_POLL_INTERVAL_MS = 5 * 60 * 1000;

export interface OrderMonitor {
  start(): void;
  stop(): void;
  checkOrders(): Promise<number>;
}

/** Create an order monitor that polls selling platforms for new unfulfilled orders. */
export function createOrderMonitor(
  db: Database,
  credentials?: { ebay?: EbayCredentials; amazon?: AmazonCredentials },
): OrderMonitor {
  let interval: NodeJS.Timeout | null = null;

  return {
    start() {
      logger.info('Order monitor started');
      interval = setInterval(() => {
        this.checkOrders().catch(err => logger.error({ err }, 'Order check failed'));
      }, ORDER_POLL_INTERVAL_MS);
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

            const parsedSellPrice = ebayOrder.pricingSummary?.total
              ? parseFloat(ebayOrder.pricingSummary.total.value)
              : 0;
            const sellPrice = Number.isFinite(parsedSellPrice) ? parsedSellPrice : 0;

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

      // Attempt FBA MCF auto-fulfillment for pending orders sourced from Amazon
      if (credentials?.amazon?.spRefreshToken && pendingOrders.length > 0) {
        const amazonPending = db.query<{
          id: string;
          buyer_address: string;
          listing_id: string;
        }>(
          "SELECT id, buyer_address, listing_id FROM orders WHERE status = 'pending' AND buy_platform = 'amazon'",
        );

        for (const order of amazonPending) {
          if (!order.buyer_address?.trim()) continue;

          // Check if the product has FBA inventory via warehouse_inventory table
          const listing = db.query<{ product_id: string }>(
            'SELECT product_id FROM listings WHERE id = ?',
            [order.listing_id],
          );
          if (listing.length === 0) continue;

          // Look for the SKU in FBA-type warehouses
          const fbaStock = db.query<{ sku: string; quantity: number; reserved: number }>(
            `SELECT wi.sku, wi.quantity, wi.reserved
             FROM warehouse_inventory wi
             JOIN warehouses w ON w.id = wi.warehouse_id
             WHERE w.type = 'fba' AND wi.product_id = ? AND (wi.quantity - wi.reserved) > 0
             LIMIT 1`,
            [listing[0].product_id],
          );

          if (fbaStock.length === 0) continue;

          try {
            const mcfApi = createFbaMcfApi({
              clientId: credentials.amazon.spClientId!,
              clientSecret: credentials.amazon.spClientSecret!,
              refreshToken: credentials.amazon.spRefreshToken,
            });

            // Parse buyer address (format: "Name, Address, City, State ZIP, Country")
            const parts = order.buyer_address.split(',').map(s => s.trim());
            const mcfOrderId = `MCF-${order.id}`;
            await mcfApi.createFulfillmentOrder({
              sellerFulfillmentOrderId: mcfOrderId,
              displayableOrderId: order.id,
              displayableOrderDate: new Date().toISOString(),
              displayableOrderComment: 'Auto-fulfilled via FBA MCF',
              shippingSpeedCategory: 'Standard',
              destinationAddress: {
                name: parts[0] ?? '',
                addressLine1: parts[1] ?? '',
                city: parts[2] ?? '',
                stateOrRegion: parts[3]?.replace(/\s+\d+$/, '') ?? '',
                postalCode: parts[3]?.match(/\d+$/)?.[0] ?? '',
                countryCode: parts[4] ?? 'US',
              },
              items: [{
                sellerSku: fbaStock[0].sku,
                sellerFulfillmentOrderItemId: `${mcfOrderId}-item-1`,
                quantity: 1,
              }],
            });

            // Reserve inventory
            db.run(
              'UPDATE warehouse_inventory SET reserved = reserved + 1, updated_at = ? WHERE sku = ? AND warehouse_id IN (SELECT id FROM warehouses WHERE type = ?)',
              [Date.now(), fbaStock[0].sku, 'fba'],
            );

            db.run(
              'UPDATE orders SET status = ?, buy_order_id = ? WHERE id = ?',
              ['purchased', mcfOrderId, order.id],
            );

            logger.info({ orderId: order.id, mcfOrderId, sku: fbaStock[0].sku }, 'Auto-fulfilled via FBA MCF');
          } catch (err) {
            logger.warn(
              { orderId: order.id, error: err instanceof Error ? err.message : String(err) },
              'FBA MCF auto-fulfillment failed — order remains pending',
            );
          }
        }
      }

      logger.info({ newOrders: newOrderCount, pending: pendingOrders.length }, 'Order check complete');
      return pendingOrders.length;
    },
  };
}
