/**
 * eBay Account API - Business policies and inventory locations
 *
 * Manages seller business policies (fulfillment, payment, return) and
 * inventory locations required for listing creation.
 *
 * Includes `ensurePolicies()` helper that checks/creates default policies
 * and caches the IDs for use in offer creation.
 */

import { createLogger } from '../../utils/logger';
import type { EbayCredentials } from '../../types';
import { getAccessToken, API_BASE } from './auth';

const logger = createLogger('ebay-account');

export interface FulfillmentPolicy {
  fulfillmentPolicyId: string;
  name: string;
  marketplaceId: string;
  handlingTime: { value: number; unit: string };
  shippingOptions: Array<{
    optionType: string;
    costType: string;
    shippingServices: Array<{
      shippingServiceCode: string;
      shippingCost?: { value: string; currency: string };
      freeShipping?: boolean;
    }>;
  }>;
}

export interface PaymentPolicy {
  paymentPolicyId: string;
  name: string;
  marketplaceId: string;
  paymentMethods: Array<{ paymentMethodType: string }>;
}

export interface ReturnPolicy {
  returnPolicyId: string;
  name: string;
  marketplaceId: string;
  returnsAccepted: boolean;
  returnPeriod?: { value: number; unit: string };
  refundMethod?: string;
  returnShippingCostPayer?: string;
}

export interface SellerPrivileges {
  sellingLimit?: { amount: { value: string; currency: string }; quantity: number };
  status?: string[];
}

export interface InventoryLocation {
  merchantLocationKey: string;
  name?: string;
  locationTypes?: string[];
  address: {
    addressLine1?: string;
    city?: string;
    stateOrProvince?: string;
    postalCode?: string;
    country: string;
  };
  merchantLocationStatus?: string;
}

export interface EbayAccountApi {
  getFulfillmentPolicies(marketplaceId?: string): Promise<FulfillmentPolicy[]>;
  getPaymentPolicies(marketplaceId?: string): Promise<PaymentPolicy[]>;
  getReturnPolicies(marketplaceId?: string): Promise<ReturnPolicy[]>;
  getAllPolicies(marketplaceId?: string): Promise<{
    fulfillment: FulfillmentPolicy[];
    payment: PaymentPolicy[];
    return: ReturnPolicy[];
  }>;
  getPrivileges(): Promise<SellerPrivileges | null>;
  createFulfillmentPolicy(params: {
    name: string;
    marketplaceId: string;
    handlingTimeDays: number;
    shippingServiceCode: string;
    freeShipping?: boolean;
    shippingCost?: number;
  }): Promise<string>;
  createPaymentPolicy(params: {
    name: string;
    marketplaceId: string;
  }): Promise<string>;
  createReturnPolicy(params: {
    name: string;
    marketplaceId: string;
    returnsAccepted: boolean;
    returnDays?: number;
    returnShippingCostPayer?: 'BUYER' | 'SELLER';
  }): Promise<string>;
  createInventoryLocation(params: {
    merchantLocationKey: string;
    name: string;
    address: InventoryLocation['address'];
  }): Promise<void>;
  getInventoryLocations(): Promise<InventoryLocation[]>;
}

export function createEbayAccountApi(credentials: EbayCredentials): EbayAccountApi {
  const env = credentials.environment ?? 'production';
  const baseUrl = API_BASE[env];
  const defaultMarketplace = credentials.marketplace ?? 'EBAY_US';

  async function getToken(): Promise<string> {
    return getAccessToken({
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      refreshToken: credentials.refreshToken,
      environment: env,
    });
  }

  async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
    const token = await getToken();
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorText = (await response.text().catch(() => '')).slice(0, 200);
      throw new Error(`eBay Account API (${response.status}): ${errorText}`);
    }

    if (response.status === 204) return {} as T;
    return response.json() as Promise<T>;
  }

  return {
    async getFulfillmentPolicies(marketplaceId = defaultMarketplace): Promise<FulfillmentPolicy[]> {
      const data = await fetchJson<{ fulfillmentPolicies?: FulfillmentPolicy[] }>(
        `${baseUrl}/sell/account/v1/fulfillment_policy?marketplace_id=${marketplaceId}`,
      );
      return data.fulfillmentPolicies ?? [];
    },

    async getPaymentPolicies(marketplaceId = defaultMarketplace): Promise<PaymentPolicy[]> {
      const data = await fetchJson<{ paymentPolicies?: PaymentPolicy[] }>(
        `${baseUrl}/sell/account/v1/payment_policy?marketplace_id=${marketplaceId}`,
      );
      return data.paymentPolicies ?? [];
    },

    async getReturnPolicies(marketplaceId = defaultMarketplace): Promise<ReturnPolicy[]> {
      const data = await fetchJson<{ returnPolicies?: ReturnPolicy[] }>(
        `${baseUrl}/sell/account/v1/return_policy?marketplace_id=${marketplaceId}`,
      );
      return data.returnPolicies ?? [];
    },

    async getAllPolicies(marketplaceId = defaultMarketplace) {
      const [fulfillment, payment, returnPolicies] = await Promise.all([
        this.getFulfillmentPolicies(marketplaceId),
        this.getPaymentPolicies(marketplaceId),
        this.getReturnPolicies(marketplaceId),
      ]);
      return { fulfillment, payment, return: returnPolicies };
    },

    async getPrivileges(): Promise<SellerPrivileges | null> {
      try {
        const data = await fetchJson<{
          sellingLimit?: { amount: { value: string; currency: string }; quantity: number };
          status?: string[];
        }>(`${baseUrl}/sell/account/v1/privilege`);

        return {
          sellingLimit: data.sellingLimit,
          status: data.status,
        };
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to get seller privileges');
        return null;
      }
    },

    async createFulfillmentPolicy(params): Promise<string> {
      const body = {
        name: params.name,
        marketplaceId: params.marketplaceId,
        handlingTime: { value: params.handlingTimeDays, unit: 'DAY' },
        shippingOptions: [{
          optionType: 'DOMESTIC',
          costType: 'FLAT_RATE',
          shippingServices: [{
            shippingServiceCode: params.shippingServiceCode,
            freeShipping: params.freeShipping ?? false,
            shippingCost: params.freeShipping ? undefined : {
              value: (params.shippingCost ?? 0).toFixed(2),
              currency: 'USD',
            },
          }],
        }],
      };

      const data = await fetchJson<{ fulfillmentPolicyId: string }>(
        `${baseUrl}/sell/account/v1/fulfillment_policy`,
        { method: 'POST', body: JSON.stringify(body) },
      );

      logger.info({ policyId: data.fulfillmentPolicyId, name: params.name }, 'Fulfillment policy created');
      return data.fulfillmentPolicyId;
    },

    async createPaymentPolicy(params): Promise<string> {
      const body = {
        name: params.name,
        marketplaceId: params.marketplaceId,
        paymentMethods: [{ paymentMethodType: 'WALLET' }],
      };

      const data = await fetchJson<{ paymentPolicyId: string }>(
        `${baseUrl}/sell/account/v1/payment_policy`,
        { method: 'POST', body: JSON.stringify(body) },
      );

      logger.info({ policyId: data.paymentPolicyId, name: params.name }, 'Payment policy created');
      return data.paymentPolicyId;
    },

    async createReturnPolicy(params): Promise<string> {
      const body: Record<string, unknown> = {
        name: params.name,
        marketplaceId: params.marketplaceId,
        returnsAccepted: params.returnsAccepted,
      };

      if (params.returnsAccepted) {
        body.returnPeriod = { value: params.returnDays ?? 30, unit: 'DAY' };
        body.refundMethod = 'MONEY_BACK';
        body.returnShippingCostPayer = params.returnShippingCostPayer ?? 'BUYER';
      }

      const data = await fetchJson<{ returnPolicyId: string }>(
        `${baseUrl}/sell/account/v1/return_policy`,
        { method: 'POST', body: JSON.stringify(body) },
      );

      logger.info({ policyId: data.returnPolicyId, name: params.name }, 'Return policy created');
      return data.returnPolicyId;
    },

    async createInventoryLocation(params): Promise<void> {
      const token = await getToken();
      const body = {
        name: params.name,
        location: {
          address: params.address,
        },
        locationTypes: ['WAREHOUSE'],
        merchantLocationStatus: 'ENABLED',
      };

      const response = await fetch(
        `${baseUrl}/sell/inventory/v1/location/${encodeURIComponent(params.merchantLocationKey)}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30_000),
        },
      );

      if (!response.ok && response.status !== 204) {
        const errorText = (await response.text().catch(() => '')).slice(0, 200);
        throw new Error(`eBay create inventory location failed (${response.status}): ${errorText}`);
      }

      logger.info({ key: params.merchantLocationKey }, 'Inventory location created');
    },

    async getInventoryLocations(): Promise<InventoryLocation[]> {
      const data = await fetchJson<{ locations?: InventoryLocation[] }>(
        `${baseUrl}/sell/inventory/v1/location`,
      );
      return data.locations ?? [];
    },
  };
}

// =============================================================================
// POLICY IDS — returned by ensurePolicies()
// =============================================================================

export interface PolicyIds {
  fulfillmentPolicyId: string;
  paymentPolicyId: string;
  returnPolicyId: string;
}

// Cache: key = clientId:marketplace, value = PolicyIds
const policyCache = new Map<string, PolicyIds>();

/**
 * Ensure eBay business policies exist for listing creation.
 *
 * 1. Checks cache first (avoids repeated API calls).
 * 2. Calls getAllPolicies() to see if policies already exist.
 * 3. If any policy type is missing, creates a sensible default.
 * 4. Returns the policy IDs ready for use in offer creation.
 *
 * Default policies created:
 * - Fulfillment: "FlipAgent Standard Shipping" — 1 business day handling,
 *   USPS Priority Mail, free shipping
 * - Payment: "FlipAgent Payment" — eBay Managed Payments (WALLET)
 * - Return: "FlipAgent Returns" — 30-day returns accepted, buyer pays return shipping
 */
export async function ensurePolicies(credentials: EbayCredentials): Promise<PolicyIds> {
  const marketplace = credentials.marketplace ?? 'EBAY_US';
  const cacheKey = `${credentials.clientId}:${marketplace}`;

  const cached = policyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const accountApi = createEbayAccountApi(credentials);
  const existing = await accountApi.getAllPolicies(marketplace);

  logger.info(
    {
      fulfillmentCount: existing.fulfillment.length,
      paymentCount: existing.payment.length,
      returnCount: existing.return.length,
    },
    'Checked existing eBay policies',
  );

  let fulfillmentPolicyId: string;
  let paymentPolicyId: string;
  let returnPolicyId: string;

  // Use existing policy or create a default
  if (existing.fulfillment.length > 0) {
    fulfillmentPolicyId = existing.fulfillment[0].fulfillmentPolicyId;
    logger.info({ policyId: fulfillmentPolicyId }, 'Using existing fulfillment policy');
  } else {
    fulfillmentPolicyId = await accountApi.createFulfillmentPolicy({
      name: 'FlipAgent Standard Shipping',
      marketplaceId: marketplace,
      handlingTimeDays: 1,
      shippingServiceCode: 'USPSPriority',
      freeShipping: true,
    });
    logger.info({ policyId: fulfillmentPolicyId }, 'Created default fulfillment policy');
  }

  if (existing.payment.length > 0) {
    paymentPolicyId = existing.payment[0].paymentPolicyId;
    logger.info({ policyId: paymentPolicyId }, 'Using existing payment policy');
  } else {
    paymentPolicyId = await accountApi.createPaymentPolicy({
      name: 'FlipAgent Payment',
      marketplaceId: marketplace,
    });
    logger.info({ policyId: paymentPolicyId }, 'Created default payment policy');
  }

  if (existing.return.length > 0) {
    returnPolicyId = existing.return[0].returnPolicyId;
    logger.info({ policyId: returnPolicyId }, 'Using existing return policy');
  } else {
    returnPolicyId = await accountApi.createReturnPolicy({
      name: 'FlipAgent Returns',
      marketplaceId: marketplace,
      returnsAccepted: true,
      returnDays: 30,
      returnShippingCostPayer: 'BUYER',
    });
    logger.info({ policyId: returnPolicyId }, 'Created default return policy');
  }

  const policyIds: PolicyIds = {
    fulfillmentPolicyId,
    paymentPolicyId,
    returnPolicyId,
  };

  policyCache.set(cacheKey, policyIds);
  return policyIds;
}

/**
 * Clear cached policy IDs. Useful for testing or when policies are deleted externally.
 */
export function clearPolicyCache(): void {
  policyCache.clear();
}
