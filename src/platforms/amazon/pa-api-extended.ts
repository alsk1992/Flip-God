/**
 * Amazon PA-API 5.0 Extended Operations
 *
 * Additional PA-API endpoints beyond SearchItems / GetItems:
 * - GetVariations: Fetch all variations (size, color, etc.) of a product
 * - GetBrowseNodes: Fetch category tree nodes by browse node IDs
 *
 * Uses the same AWS Signature V4 signing as the main scraper.
 */

import { createLogger } from '../../utils/logger';
import type { AmazonCredentials } from '../../types';
import type { PaApiItem, PaApiError } from './types';
import { signRequest, MARKETPLACE_HOSTS, type AmazonSigningConfig } from './auth';

const logger = createLogger('amazon-pa-api-extended');

const MARKETPLACE_DOMAINS: Record<string, string> = {
  US: 'www.amazon.com', UK: 'www.amazon.co.uk', DE: 'www.amazon.de',
  FR: 'www.amazon.fr', IT: 'www.amazon.it', ES: 'www.amazon.es',
  JP: 'www.amazon.co.jp', CA: 'www.amazon.ca', AU: 'www.amazon.com.au',
  IN: 'www.amazon.in', MX: 'www.amazon.com.mx', BR: 'www.amazon.com.br',
};

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface VariationSummary {
  pageCount?: number;
  variationCount?: number;
  price?: {
    highestPrice?: { Amount?: number; Currency?: string; DisplayAmount?: string };
    lowestPrice?: { Amount?: number; Currency?: string; DisplayAmount?: string };
  };
  variationDimensions?: string[];
}

export interface PaApiGetVariationsResponse {
  VariationsResult?: {
    Items?: PaApiItem[];
    VariationSummary?: VariationSummary;
  };
  Errors?: PaApiError[];
}

export interface BrowseNode {
  Id?: string;
  DisplayName?: string;
  ContextFreeName?: string;
  IsRoot?: boolean;
  Ancestor?: BrowseNode;
  Children?: BrowseNode[];
}

export interface PaApiGetBrowseNodesResponse {
  BrowseNodesResult?: {
    BrowseNodes?: BrowseNode[];
  };
  Errors?: PaApiError[];
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface AmazonPaApiExtended {
  /**
   * Get all variations (sizes, colors, etc.) for a given ASIN.
   */
  getVariations(asin: string): Promise<{
    items: PaApiItem[];
    variationSummary: VariationSummary | null;
  }>;

  /**
   * Get browse node details (ancestors + children) for one or more node IDs.
   */
  getBrowseNodes(browseNodeIds: string[]): Promise<BrowseNode[]>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const VARIATION_RESOURCES = [
  'Images.Primary.Large',
  'ItemInfo.Title',
  'Offers.Listings.Price',
  'VariationSummary.Price',
  'VariationSummary.VariationDimension',
];

const BROWSE_NODE_RESOURCES = [
  'BrowseNodes.Ancestor',
  'BrowseNodes.Children',
];

export function createAmazonPaApiExtended(credentials: AmazonCredentials): AmazonPaApiExtended {
  const marketplace = MARKETPLACE_HOSTS[credentials.marketplace ?? 'US']
    ?? MARKETPLACE_HOSTS.US;

  const signingConfig: AmazonSigningConfig = {
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    partnerTag: credentials.partnerTag,
    host: marketplace.host,
    region: marketplace.region,
  };

  const marketplaceDomain = MARKETPLACE_DOMAINS[credentials.marketplace ?? 'US'] ?? 'www.amazon.com';

  return {
    async getVariations(asin: string) {
      logger.info({ asin }, 'Fetching product variations via PA-API');

      const payload = JSON.stringify({
        ASIN: asin,
        Resources: VARIATION_RESOURCES,
        PartnerTag: credentials.partnerTag,
        PartnerType: 'Associates',
        Marketplace: marketplaceDomain,
      });

      const headers = signRequest('GetVariations', payload, signingConfig);

      const response = await fetch(
        `https://${marketplace.host}/paapi5/getvariations`,
        { method: 'POST', headers, body: payload },
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { status: response.status, asin, error: errorText },
          'PA-API GetVariations failed',
        );
        throw new Error(`Amazon PA-API GetVariations failed (${response.status})`);
      }

      const data = await response.json() as PaApiGetVariationsResponse;

      if (data.Errors?.length) {
        logger.error({ errors: data.Errors }, 'PA-API GetVariations returned errors');
        throw new Error(`Amazon PA-API GetVariations error: ${data.Errors[0].Message}`);
      }

      return {
        items: data.VariationsResult?.Items ?? [],
        variationSummary: data.VariationsResult?.VariationSummary ?? null,
      };
    },

    async getBrowseNodes(browseNodeIds: string[]) {
      if (browseNodeIds.length === 0) {
        logger.warn('getBrowseNodes called with empty array');
        return [];
      }

      logger.info({ count: browseNodeIds.length }, 'Fetching browse nodes via PA-API');

      const payload = JSON.stringify({
        BrowseNodeIds: browseNodeIds,
        Resources: BROWSE_NODE_RESOURCES,
        PartnerTag: credentials.partnerTag,
        PartnerType: 'Associates',
        Marketplace: marketplaceDomain,
      });

      const headers = signRequest('GetBrowseNodes', payload, signingConfig);

      const response = await fetch(
        `https://${marketplace.host}/paapi5/getbrowsenodes`,
        { method: 'POST', headers, body: payload },
      );

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(
          { status: response.status, error: errorText },
          'PA-API GetBrowseNodes failed',
        );
        throw new Error(`Amazon PA-API GetBrowseNodes failed (${response.status})`);
      }

      const data = await response.json() as PaApiGetBrowseNodesResponse;

      if (data.Errors?.length) {
        logger.error({ errors: data.Errors }, 'PA-API GetBrowseNodes returned errors');
        throw new Error(`Amazon PA-API GetBrowseNodes error: ${data.Errors[0].Message}`);
      }

      return data.BrowseNodesResult?.BrowseNodes ?? [];
    },
  };
}
