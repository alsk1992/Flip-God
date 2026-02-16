/**
 * Amazon Product Search - PA-API 5.0 adapter
 *
 * Uses Amazon's Product Advertising API v5 with AWS Signature V4 signing.
 * Requires: accessKeyId, secretAccessKey, partnerTag credentials.
 */

import { createLogger } from '../../utils/logger';
import type { Platform, AmazonCredentials } from '../../types';
import type { PlatformAdapter, ProductSearchResult, SearchOptions } from '../index';
import type { PaApiSearchResponse, PaApiGetItemsResponse, PaApiItem } from './types';
import { signRequest, MARKETPLACE_HOSTS, type AmazonSigningConfig } from './auth';

const logger = createLogger('amazon');

const MARKETPLACE_DOMAINS: Record<string, string> = {
  US: 'www.amazon.com', UK: 'www.amazon.co.uk', DE: 'www.amazon.de',
  FR: 'www.amazon.fr', IT: 'www.amazon.it', ES: 'www.amazon.es',
  JP: 'www.amazon.co.jp', CA: 'www.amazon.ca', AU: 'www.amazon.com.au',
  IN: 'www.amazon.in', MX: 'www.amazon.com.mx', BR: 'www.amazon.com.br',
};

/** Standard resources to request from PA-API */
const SEARCH_RESOURCES = [
  'ItemInfo.Title',
  'ItemInfo.ByLineInfo',
  'ItemInfo.Classifications',
  'ItemInfo.ExternalIds',
  'Offers.Listings.Price',
  'Offers.Listings.DeliveryInfo',
  'Offers.Listings.Availability',
  'Offers.Listings.MerchantInfo',
  'Offers.Summaries',
  'Images.Primary.Large',
  'BrowseNodeInfo.BrowseNodes',
];

function parseItem(item: PaApiItem): ProductSearchResult {
  const listing = item.Offers?.Listings?.[0];
  const price = listing?.Price?.Amount ?? 0;
  const isFreeShipping = listing?.DeliveryInfo?.IsFreeShippingEligible ?? false;
  const seller = listing?.MerchantInfo?.Name ?? 'Unknown';
  const availability = listing?.Availability?.Type ?? '';
  const inStock = availability !== 'OutOfStock';

  const upcList = item.ItemInfo?.ExternalIds?.UPCs?.DisplayValues;

  return {
    platformId: item.ASIN,
    platform: 'amazon',
    title: item.ItemInfo?.Title?.DisplayValue ?? `Amazon Product ${item.ASIN}`,
    price,
    shipping: isFreeShipping ? 0 : 5.99,
    currency: listing?.Price?.Currency ?? 'USD',
    inStock,
    seller,
    url: item.DetailPageURL ?? `https://amazon.com/dp/${item.ASIN}`,
    imageUrl: item.Images?.Primary?.Large?.URL,
    asin: item.ASIN,
    upc: upcList?.[0],
    brand: item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue,
    category: item.ItemInfo?.Classifications?.ProductGroup?.DisplayValue
      ?? item.BrowseNodeInfo?.BrowseNodes?.[0]?.DisplayName,
  };
}

export function createAmazonAdapter(credentials?: AmazonCredentials): PlatformAdapter {
  return {
    platform: 'amazon' as Platform,

    async search(options: SearchOptions): Promise<ProductSearchResult[]> {
      if (!credentials) {
        logger.warn('Amazon credentials not configured');
        return [];
      }

      logger.info({ query: options.query }, 'Searching Amazon via PA-API');

      const marketplace = MARKETPLACE_HOSTS[credentials.marketplace ?? 'US']
        ?? MARKETPLACE_HOSTS.US;

      const signingConfig: AmazonSigningConfig = {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        partnerTag: credentials.partnerTag,
        host: marketplace.host,
        region: marketplace.region,
      };

      const payload = JSON.stringify({
        Keywords: options.query,
        PartnerTag: credentials.partnerTag,
        PartnerType: 'Associates',
        Marketplace: MARKETPLACE_DOMAINS[credentials.marketplace ?? 'US'] ?? 'www.amazon.com',
        ItemCount: Math.min(options.maxResults ?? 10, 10),
        Resources: SEARCH_RESOURCES,
        ...(options.category ? { SearchIndex: options.category } : {}),
        ...(options.minPrice != null ? { MinPrice: Math.round(options.minPrice * 100) } : {}),
        ...(options.maxPrice != null ? { MaxPrice: Math.round(options.maxPrice * 100) } : {}),
      });

      const headers = signRequest('SearchItems', payload, signingConfig);

      const response = await fetch(`https://${marketplace.host}/paapi5/searchitems`, {
        method: 'POST',
        headers,
        body: payload,
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 200);
        logger.error({ status: response.status }, 'PA-API SearchItems failed');
        throw new Error(`Amazon PA-API SearchItems failed (${response.status})`);
      }

      const data = await response.json() as PaApiSearchResponse;

      if (data.Errors?.length) {
        logger.error({ errors: data.Errors }, 'PA-API returned errors');
        throw new Error(`Amazon PA-API error: ${data.Errors[0].Message}`);
      }

      const items = data.SearchResult?.Items ?? [];
      return items.map(parseItem);
    },

    async getProduct(productId: string): Promise<ProductSearchResult | null> {
      if (!credentials) {
        logger.warn('Amazon credentials not configured');
        return null;
      }

      logger.info({ productId }, 'Getting Amazon product via PA-API');

      const marketplace = MARKETPLACE_HOSTS[credentials.marketplace ?? 'US']
        ?? MARKETPLACE_HOSTS.US;

      const signingConfig: AmazonSigningConfig = {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        partnerTag: credentials.partnerTag,
        host: marketplace.host,
        region: marketplace.region,
      };

      const payload = JSON.stringify({
        ItemIds: [productId],
        PartnerTag: credentials.partnerTag,
        PartnerType: 'Associates',
        Resources: SEARCH_RESOURCES,
      });

      const headers = signRequest('GetItems', payload, signingConfig);

      const response = await fetch(`https://${marketplace.host}/paapi5/getitems`, {
        method: 'POST',
        headers,
        body: payload,
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 200);
        logger.error({ status: response.status }, 'PA-API GetItems failed');
        return null;
      }

      const data = await response.json() as PaApiGetItemsResponse;

      if (data.Errors?.length) {
        logger.error({ errors: data.Errors }, 'PA-API GetItems returned errors');
        return null;
      }

      const items = data.ItemsResult?.Items ?? [];
      return items.length > 0 ? parseItem(items[0]) : null;
    },

    async checkStock(productId: string): Promise<{ inStock: boolean; quantity?: number }> {
      const product = await this.getProduct(productId);
      if (!product) {
        return { inStock: false };
      }
      return { inStock: product.inStock };
    },
  };
}
