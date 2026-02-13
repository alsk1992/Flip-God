/**
 * Auto-Purchaser - Buys products from source platform to fulfill orders
 *
 * Supports:
 * - AliExpress: Automated via dropshipping API
 * - Amazon/Walmart: Flagged for manual purchase (no buy API)
 */

import { createLogger } from '../utils/logger';
import type { Database } from '../db';
import type { Platform, AliExpressCredentials } from '../types';
import { callAliExpressApi, type AliExpressAuthConfig } from '../platforms/aliexpress/auth';
import type { AliExpressPlaceOrderResponse } from '../platforms/aliexpress/types';

const logger = createLogger('purchaser');

export interface PurchaseResult {
  success: boolean;
  buyOrderId?: string;
  buyPrice?: number;
  error?: string;
  manualRequired?: boolean;
}

export async function autoPurchase(
  orderId: string,
  db: Database,
  credentials?: { aliexpress?: AliExpressCredentials },
): Promise<PurchaseResult> {
  const order = db.getOrder(orderId);
  if (!order) {
    return { success: false, error: `Order ${orderId} not found` };
  }

  if (order.status !== 'pending') {
    return { success: false, error: `Order ${orderId} is not in pending status (current: ${order.status})` };
  }

  const buyPlatform = order.buyPlatform;

  switch (buyPlatform) {
    case 'aliexpress': {
      if (!credentials?.aliexpress) {
        return { success: false, error: 'AliExpress credentials not configured', manualRequired: true };
      }

      if (!credentials.aliexpress.accessToken) {
        return {
          success: false,
          error: 'AliExpress access token required for order placement. Visit AliExpress developer portal to authorize.',
          manualRequired: true,
        };
      }

      const authConfig: AliExpressAuthConfig = {
        appKey: credentials.aliexpress.appKey,
        appSecret: credentials.aliexpress.appSecret,
        accessToken: credentials.aliexpress.accessToken,
      };

      // Look up the product to buy
      const listing = db.query<{
        product_id: string;
        source_price: number;
      }>(
        'SELECT product_id, source_price FROM listings WHERE id = ?',
        [order.listingId],
      );

      if (listing.length === 0) {
        return { success: false, error: `Listing ${order.listingId} not found` };
      }

      // Get the platform product ID from prices table
      const priceRecord = db.query<{ platform_id: string; price: number }>(
        'SELECT platform_id, price FROM prices WHERE product_id = ? AND platform = ? ORDER BY fetched_at DESC LIMIT 1',
        [listing[0].product_id, 'aliexpress'],
      );

      if (priceRecord.length === 0 || !priceRecord[0].platform_id) {
        return { success: false, error: 'AliExpress product ID not found in price history', manualRequired: true };
      }

      if (!order.buyerAddress?.trim()) {
        return {
          success: false,
          error: 'Buyer shipping address is missing. Cannot place AliExpress order without a delivery address.',
          manualRequired: true,
        };
      }

      try {
        const response = await callAliExpressApi<AliExpressPlaceOrderResponse>(
          'aliexpress.trade.buy.placeorder',
          {
            product_id: priceRecord[0].platform_id,
            product_count: 1,
            logistics_address: order.buyerAddress,
          },
          authConfig,
        );

        if (response.result?.is_success) {
          const buyOrderId = response.result.order_list?.[0]?.order_id;
          const buyPrice = priceRecord[0].price;

          db.updateOrderStatus(orderId, 'purchased', {
            buyOrderId: buyOrderId ? String(buyOrderId) : undefined,
            buyPrice,
          });

          logger.info({ orderId, buyOrderId, buyPrice }, 'Auto-purchase completed');
          return {
            success: true,
            buyOrderId: buyOrderId ? String(buyOrderId) : undefined,
            buyPrice,
          };
        } else {
          const errorMsg = response.result?.error_msg ?? 'Unknown AliExpress order error';
          logger.error({ orderId, error: errorMsg }, 'AliExpress auto-purchase failed');
          return { success: false, error: errorMsg };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ orderId, error: msg }, 'AliExpress auto-purchase error');
        return { success: false, error: msg };
      }
    }

    case 'amazon':
    case 'walmart': {
      // No automated buy API for these platforms
      return {
        success: false,
        manualRequired: true,
        error: `${buyPlatform} does not support automated purchasing. Please purchase manually and update the order with the buy order ID.`,
      };
    }

    default: {
      return {
        success: false,
        error: `Unsupported buy platform: ${buyPlatform}`,
      };
    }
  }
}
