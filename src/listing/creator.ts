/**
 * Listing Creator - Generates optimized listings for selling platforms
 *
 * Wired to eBay Inventory API for real listing creation.
 * Amazon listing is flagged as manual (requires SP-API seller approval).
 *
 * eBay flow:
 * 1. ensurePolicies() — check/create fulfillment, payment, return policies
 * 2. createInventoryItem() — product data + availability
 * 3. createOffer() — price, category, policies
 * 4. publishOffer() — go live on eBay
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../utils/logger';
import type { Platform, EbayCredentials, AmazonCredentials } from '../types';
import type { ListingDraft, ListingResult } from './types';
import { createEbaySellerApi } from '../platforms/ebay/seller';
import { ensurePolicies } from '../platforms/ebay/account';
import { createAmazonSpApi } from '../platforms/amazon/sp-api';

const logger = createLogger('listing-creator');

/** Create a product listing on the specified selling platform (eBay or Amazon). */
export async function createListing(
  platform: Platform,
  draft: ListingDraft,
  credentials?: { ebay?: EbayCredentials; amazon?: AmazonCredentials },
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

      try {
        // Step 1: Ensure seller policies exist (creates defaults if needed)
        const policyIds = await ensurePolicies(credentials.ebay);
        logger.info({ policyIds }, 'eBay policies ready');

        // Step 2-4: Create inventory item, offer, and publish
        const seller = createEbaySellerApi(credentials.ebay);
        const sku = `fa-${randomUUID().slice(0, 8)}`;

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
          fulfillmentPolicyId: policyIds.fulfillmentPolicyId,
          paymentPolicyId: policyIds.paymentPolicyId,
          returnPolicyId: policyIds.returnPolicyId,
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
      if (credentials?.amazon?.spRefreshToken && credentials.amazon.spClientId && credentials.amazon.spClientSecret) {
        const spApi = createAmazonSpApi({
          clientId: credentials.amazon.spClientId,
          clientSecret: credentials.amazon.spClientSecret,
          refreshToken: credentials.amazon.spRefreshToken,
        });
        const sku = `fa-${randomUUID().slice(0, 8)}`;

        const conditionMap: Record<string, string> = {
          new: 'new_new',
          refurbished: 'new_new', // Amazon refurbished requires separate approval
          used: 'used_good',
        };

        try {
          const result = await spApi.putListingsItem({
            sku,
            productType: draft.category || 'PRODUCT',
            attributes: {
              item_name: [{ value: draft.title, language_tag: 'en_US' }],
              purchasable_offer: [{
                our_price: [{ schedule: [{ value_with_tax: draft.price }] }],
                currency: 'USD',
              }],
              fulfillment_availability: [{ fulfillment_channel_code: 'DEFAULT', quantity: draft.quantity }],
              condition_type: [{ value: conditionMap[draft.condition] ?? 'new_new' }],
              main_product_image_locator: draft.imageUrls[0]
                ? [{ media_location: draft.imageUrls[0] }]
                : undefined,
            },
          });

          if (result.issues?.some(i => i.severity === 'ERROR')) {
            const errors = result.issues.filter(i => i.severity === 'ERROR').map(i => i.message).join('; ');
            logger.error({ sku, errors }, 'Amazon listing has errors');
            return { success: false, error: `Amazon listing issues: ${errors}` };
          }

          return {
            success: true,
            listingId: sku,
            url: `https://sellercentral.amazon.com/inventory?sku=${encodeURIComponent(sku)}`,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error({ error: msg }, 'Amazon SP-API listing creation failed');
          return { success: false, error: msg };
        }
      }

      // No SP-API credentials available — fall back to manual instructions
      return {
        success: false,
        error: 'Amazon listing creation requires SP-API credentials (spClientId, spClientSecret, spRefreshToken). Please configure them or create the listing manually on Seller Central.',
      };
    }

    default: {
      return {
        success: false,
        error: `Listing creation not supported for ${platform}. Only eBay and Amazon are supported for automated listing.`,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Listing Optimization
// ---------------------------------------------------------------------------

/** Stop words to remove from keyword extraction. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'this', 'that', 'are', 'was',
  'be', 'has', 'had', 'have', 'not', 'no', 'do', 'does', 'did', 'will',
  'can', 'may', 'so', 'if', 'as', 'up', 'out', 'its', 'our', 'your',
  'their', 'we', 'you', 'he', 'she', 'they', 'my', 'me', 'us', 'him',
  'her', 'who', 'which', 'what', 'when', 'where', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'some', 'any', 'such', 'than',
  'too', 'very', 'just', 'about', 'also', 'then', 'into', 'over', 'only',
]);

/** Words that should always stay uppercase. */
const ALWAYS_UPPER = new Set([
  'usb', 'led', 'lcd', 'hd', 'uhd', 'hdmi', 'wifi', 'nfc', 'gps', 'rgb',
  'ac', 'dc', 'uk', 'us', 'eu', 'diy', 'pc', 'tv', 'dvd', 'cd', 'io',
  'xl', 'xxl', 'xs', 'sm', 'md', 'lg', 'oz', 'lb', 'kg', 'ml', 'mm',
  'cm', 'ft', 'in', 'qt', 'aaa', 'aa', 'am', 'fm', 'ip', 'hdr',
]);

export interface OptimizeOptions {
  platform?: string;
  brand?: string;
  category?: string;
  features?: string[];
}

export interface OptimizedListing {
  title: string;
  description: string;
  bulletPoints: string[];
  searchTerms: string[];
  itemSpecifics?: Record<string, string>;
}

/**
 * Extract meaningful keywords from text.
 * Removes stop words, deduplicates, and returns keywords sorted by relevance
 * (longer words first, as they tend to be more specific).
 */
export function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));

  // Deduplicate while preserving order
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const word of words) {
    if (!seen.has(word)) {
      seen.add(word);
      unique.push(word);
    }
  }

  // Sort by length descending (more specific words first), then alphabetically
  return unique.sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/**
 * Generate an optimized product title.
 *
 * eBay: max 80 chars, keyword-rich, brand first if available.
 * Amazon: max 200 chars, structured as "Brand - Product Name - Key Features".
 */
export function generateOptimizedTitle(
  productName: string,
  options?: { category?: string; brand?: string; platform?: string },
): string {
  const platform = options?.platform ?? 'ebay';
  const maxLen = platform === 'amazon' ? 200 : 80;

  // Capitalize each word properly
  const capitalize = (text: string): string =>
    text
      .split(/\s+/)
      .filter(Boolean)
      .map(word => {
        const lower = word.toLowerCase();
        if (ALWAYS_UPPER.has(lower)) return lower.toUpperCase();
        if (STOP_WORDS.has(lower) && word !== text.split(/\s+/)[0]) return lower;
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');

  const parts: string[] = [];

  // Brand first (if available)
  if (options?.brand) {
    parts.push(options.brand.trim());
  }

  // Product name (cleaned up)
  const cleanName = productName
    .replace(/\s+/g, ' ')
    .trim();
  parts.push(cleanName);

  // Category hint at the end (if it adds value and fits)
  if (options?.category && !cleanName.toLowerCase().includes(options.category.toLowerCase())) {
    parts.push(options.category.trim());
  }

  let title = capitalize(parts.join(' - '));

  // Trim to max length at a word boundary
  if (title.length > maxLen) {
    title = title.slice(0, maxLen);
    const lastSpace = title.lastIndexOf(' ');
    if (lastSpace > maxLen * 0.6) {
      title = title.slice(0, lastSpace);
    }
  }

  return title.trim();
}

/**
 * Generate SEO-optimized bullet points from a description and feature list.
 * Each bullet focuses on a single benefit/feature and starts with a capital.
 * Amazon style: KEYWORD IN CAPS - then description.
 */
export function generateBulletPoints(
  description: string,
  features?: string[],
  options?: { platform?: string },
): string[] {
  const platform = options?.platform ?? 'ebay';
  const bullets: string[] = [];

  // Use explicit features first
  if (features?.length) {
    for (const feat of features) {
      const trimmed = feat.trim();
      if (!trimmed) continue;

      if (platform === 'amazon') {
        // Amazon style: extract first 2-3 words as caps header
        const words = trimmed.split(/\s+/);
        const headerLen = Math.min(3, Math.ceil(words.length / 3));
        const header = words.slice(0, headerLen).join(' ').toUpperCase();
        const rest = words.slice(headerLen).join(' ');
        bullets.push(rest ? `${header} - ${rest.charAt(0).toUpperCase()}${rest.slice(1)}` : header);
      } else {
        bullets.push(trimmed.charAt(0).toUpperCase() + trimmed.slice(1));
      }
    }
  }

  // Extract additional bullet points from description if we have fewer than 5
  if (bullets.length < 5 && description) {
    const sentences = description
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 10 && s.length < 200);

    for (const sentence of sentences) {
      if (bullets.length >= 5) break;
      // Skip if too similar to existing bullets
      const lower = sentence.toLowerCase();
      const isDupe = bullets.some(b => {
        const bLower = b.toLowerCase();
        return bLower.includes(lower) || lower.includes(bLower);
      });
      if (isDupe) continue;

      if (platform === 'amazon') {
        const words = sentence.split(/\s+/);
        const headerLen = Math.min(3, Math.ceil(words.length / 3));
        const header = words.slice(0, headerLen).join(' ').toUpperCase();
        const rest = words.slice(headerLen).join(' ');
        bullets.push(rest ? `${header} - ${rest.charAt(0).toUpperCase()}${rest.slice(1)}` : header);
      } else {
        bullets.push(sentence.charAt(0).toUpperCase() + sentence.slice(1));
      }
    }
  }

  return bullets;
}

/**
 * Generate search terms from a product name, description, and features.
 * Returns unique keywords not already in the title (Amazon backend search terms).
 */
function generateSearchTerms(
  title: string,
  description: string,
  features?: string[],
): string[] {
  const titleKeywords = new Set(
    title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean),
  );

  const allText = [description, ...(features ?? [])].join(' ');
  const keywords = extractKeywords(allText);

  // Filter out words already in the title
  return keywords
    .filter(kw => !titleKeywords.has(kw))
    .slice(0, 50); // Amazon allows up to 250 bytes, roughly 50 words
}

/**
 * Optimize a listing for a target platform.
 *
 * For eBay: generates optimized 80-char title, keyword-rich description,
 * item specifics suggestions.
 *
 * For Amazon: generates SEO-optimized title, bullet points with caps headers,
 * and backend search terms.
 *
 * No external API calls -- uses keyword extraction and formatting heuristics.
 */
export async function optimizeListing(
  title: string,
  description: string,
  options?: OptimizeOptions,
): Promise<OptimizedListing> {
  const platform = options?.platform ?? 'ebay';

  // Generate optimized title
  const optimizedTitle = generateOptimizedTitle(title, {
    brand: options?.brand,
    category: options?.category,
    platform,
  });

  // Generate bullet points
  const bulletPoints = generateBulletPoints(description, options?.features, { platform });

  // Build optimized description
  let optimizedDescription: string;
  if (platform === 'amazon') {
    // Amazon: structured description from bullet points + original
    const bulletSection = bulletPoints.length > 0
      ? bulletPoints.map(b => `* ${b}`).join('\n')
      : '';
    const descBody = description.trim() || 'Premium quality product with fast shipping and satisfaction guarantee.';
    optimizedDescription = bulletSection
      ? `${bulletSection}\n\n${descBody}`
      : descBody;
  } else {
    // eBay: clean and enhance description
    const descBody = description.trim();
    const sellingPoints = [
      'Fast shipping from US warehouse.',
      '100% satisfaction guaranteed.',
      'Top-rated seller. Buy with confidence.',
    ];
    if (descBody) {
      // Append selling points that aren't already present
      const lowerDesc = descBody.toLowerCase();
      const newPoints = sellingPoints.filter(sp =>
        !lowerDesc.includes(sp.toLowerCase().slice(0, 20)),
      );
      optimizedDescription = newPoints.length > 0
        ? `${descBody}\n\n${newPoints.join(' ')}`
        : descBody;
    } else {
      optimizedDescription = `${optimizedTitle}. ${sellingPoints.join(' ')}`;
    }
  }

  // Generate search terms (mainly useful for Amazon backend keywords)
  const searchTerms = generateSearchTerms(
    optimizedTitle,
    description,
    options?.features,
  );

  // Generate item specifics suggestions (eBay)
  const itemSpecifics: Record<string, string> = {};
  if (options?.brand) {
    itemSpecifics['Brand'] = options.brand;
  }
  if (options?.category) {
    itemSpecifics['Type'] = options.category;
  }

  return {
    title: optimizedTitle,
    description: optimizedDescription,
    bulletPoints,
    searchTerms,
    itemSpecifics: Object.keys(itemSpecifics).length > 0 ? itemSpecifics : undefined,
  };
}
