/**
 * Listing Creator - Generates optimized listings for selling platforms
 *
 * Wired to eBay Inventory API for real listing creation.
 * Amazon listing is flagged as manual (requires SP-API seller approval).
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger';
import type { Platform, EbayCredentials } from '../types';
import type { ListingDraft, ListingResult } from './types';
import { createEbaySellerApi } from '../platforms/ebay/seller';

const logger = createLogger('listing-creator');

export async function createListing(
  platform: Platform,
  draft: ListingDraft,
  credentials?: { ebay?: EbayCredentials },
): Promise<ListingResult> {
  logger.info({ platform, title: draft.title, price: draft.price }, 'Creating listing');

  switch (platform) {
    case 'ebay': {
      if (!credentials?.ebay) {
        return { success: false, error: 'eBay credentials not configured. Use setup_ebay_credentials first.' };
      }

      if (!credentials.ebay.refreshToken) {
        return { success: false, error: 'eBay refresh token required for listing creation. Provide refreshToken in credentials.' };
      }

      const seller = createEbaySellerApi(credentials.ebay);
      const sku = `fa-${randomUUID().slice(0, 8)}`;

      try {
        const result = await seller.createAndPublishListing({
          sku,
          title: draft.title.slice(0, 80), // eBay 80-char title limit
          description: draft.description,
          price: draft.price,
          quantity: draft.quantity,
          imageUrls: draft.imageUrls,
          categoryId: draft.category,
          condition: draft.condition === 'new' ? 'NEW'
            : draft.condition === 'refurbished' ? 'LIKE_NEW'
            : 'GOOD',
          // These policy IDs must be configured by the seller in their eBay account
          fulfillmentPolicyId: process.env.EBAY_FULFILLMENT_POLICY_ID ?? '',
          paymentPolicyId: process.env.EBAY_PAYMENT_POLICY_ID ?? '',
          returnPolicyId: process.env.EBAY_RETURN_POLICY_ID ?? '',
        });

        return {
          success: true,
          listingId: result.listingId,
          url: `https://ebay.com/itm/${result.listingId}`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ error: msg }, 'eBay listing creation failed');
        return { success: false, error: msg };
      }
    }

    case 'amazon': {
      // Amazon SP-API listing requires separate seller account approval
      // For MVP, return instructions for manual listing
      return {
        success: false,
        error: 'Amazon listing creation requires SP-API seller approval. Please create the listing manually on Seller Central.',
      };
    }

    default: {
      return {
        success: false,
        error: `Listing creation not supported for ${platform}. Only eBay is supported for automated listing.`,
      };
    }
  }
}

export async function optimizeListing(
  title: string,
  description: string,
): Promise<{ title: string; description: string }> {
  // Basic optimization: capitalize important words, add key selling points
  const optimizedTitle = title
    .split(' ')
    .map(word => word.length > 3 ? word.charAt(0).toUpperCase() + word.slice(1) : word)
    .join(' ')
    .slice(0, 80);

  const optimizedDescription = description || `High-quality product. Fast shipping. Satisfaction guaranteed.`;

  return {
    title: optimizedTitle,
    description: optimizedDescription,
  };
}
