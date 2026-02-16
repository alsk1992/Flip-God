/**
 * eBay Logistics API — Shipping quotes and label purchases
 *
 * Get shipping quotes, purchase labels, download label files,
 * and manage shipments through eBay's logistics service.
 */

import { createLogger } from '../../utils/logger';
import type { EbayCredentials } from '../../types';
import { getAccessToken, API_BASE } from './auth';

const logger = createLogger('ebay-logistics');

export interface Dimensions {
  height: number;
  length: number;
  width: number;
  unit: 'INCH' | 'CENTIMETER';
}

export interface Weight {
  value: number;
  unit: 'POUND' | 'KILOGRAM' | 'OUNCE' | 'GRAM';
}

export interface ShippingAddress {
  postalCode: string;
  country: string;
  city?: string;
  stateOrProvince?: string;
  addressLine1?: string;
}

export interface ShippingQuoteRequest {
  orders: Array<{ orderId: string }>;
  packageSpecification: {
    dimensions: Dimensions;
    weight: Weight;
  };
  shipFrom: ShippingAddress;
  shipTo: ShippingAddress;
}

export interface ShippingRate {
  rateId: string;
  shippingCarrierCode: string;
  shippingServiceCode: string;
  shippingCost: { value: string; currency: string };
  additionalOptions?: Array<{
    additionalCost: { value: string; currency: string };
    optionType: string;
  }>;
  pickupSlots?: Array<{
    pickupSlotId: string;
    pickupSlotStartTime: string;
    pickupSlotEndTime: string;
  }>;
  minEstimatedDeliveryDate?: string;
  maxEstimatedDeliveryDate?: string;
}

export interface ShippingQuote {
  shippingQuoteId: string;
  creationDate?: string;
  expirationDate?: string;
  orders: Array<{ orderId: string }>;
  rates?: ShippingRate[];
}

export interface CreateFromShippingQuoteParams {
  shippingQuoteId: string;
  rateId: string;
}

export interface Shipment {
  shipmentId: string;
  shippingQuoteId?: string;
  orderId?: string;
  shipFrom?: ShippingAddress;
  shipTo?: ShippingAddress;
  shippingCarrierCode?: string;
  shippingServiceCode?: string;
  shipmentTrackingNumber?: string;
  shippingCost?: { value: string; currency: string };
  creationDate?: string;
  cancellable?: boolean;
}

export interface EbayLogisticsApi {
  createShippingQuote(params: ShippingQuoteRequest): Promise<ShippingQuote>;
  getShippingQuote(shippingQuoteId: string): Promise<ShippingQuote>;
  createFromShippingQuote(params: CreateFromShippingQuoteParams): Promise<Shipment>;
  getShipment(shipmentId: string): Promise<Shipment>;
  downloadLabelFile(shipmentId: string): Promise<string>;
  cancelShipment(shipmentId: string): Promise<void>;
}

export function createEbayLogisticsApi(credentials: EbayCredentials): EbayLogisticsApi {
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
    async createShippingQuote(params: ShippingQuoteRequest): Promise<ShippingQuote> {
      const token = await getToken();
      const response = await fetch(
        `${baseUrl}/sell/logistics/v1_beta/shipping_quote`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 200);
        logger.error({ status: response.status }, 'Failed to create shipping quote');
        throw new Error(`eBay create shipping quote failed (${response.status}): ${errorText}`);
      }
      const data = await response.json() as ShippingQuote;
      logger.info({ shippingQuoteId: data.shippingQuoteId, rateCount: data.rates?.length ?? 0 }, 'Shipping quote created');
      return data;
    },

    async getShippingQuote(shippingQuoteId: string): Promise<ShippingQuote> {
      const token = await getToken();
      const response = await fetch(
        `${baseUrl}/sell/logistics/v1_beta/shipping_quote/${encodeURIComponent(shippingQuoteId)}`,
        { headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
      );
      if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 200);
        logger.error({ status: response.status, shippingQuoteId }, 'Failed to get shipping quote');
        throw new Error(`eBay get shipping quote failed (${response.status}): ${errorText}`);
      }
      return await response.json() as ShippingQuote;
    },

    async createFromShippingQuote(params: CreateFromShippingQuoteParams): Promise<Shipment> {
      const token = await getToken();
      const response = await fetch(
        `${baseUrl}/sell/logistics/v1_beta/shipment/create_from_shipping_quote`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(params),
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 200);
        logger.error({ status: response.status }, 'Failed to create shipment from quote');
        throw new Error(`eBay create shipment from quote failed (${response.status}): ${errorText}`);
      }
      const data = await response.json() as Shipment;
      logger.info({ shipmentId: data.shipmentId, tracking: data.shipmentTrackingNumber }, 'Shipment created from quote');
      return data;
    },

    async getShipment(shipmentId: string): Promise<Shipment> {
      const token = await getToken();
      const response = await fetch(
        `${baseUrl}/sell/logistics/v1_beta/shipment/${encodeURIComponent(shipmentId)}`,
        { headers: { 'Authorization': `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) },
      );
      if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 200);
        logger.error({ status: response.status, shipmentId }, 'Failed to get shipment');
        throw new Error(`eBay get shipment failed (${response.status}): ${errorText}`);
      }
      return await response.json() as Shipment;
    },

    async downloadLabelFile(shipmentId: string): Promise<string> {
      const token = await getToken();
      const response = await fetch(
        `${baseUrl}/sell/logistics/v1_beta/shipment/${encodeURIComponent(shipmentId)}/download_label_file`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/pdf',
          },
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) {
        const errorText = (await response.text().catch(() => '')).slice(0, 200);
        logger.error({ status: response.status, shipmentId }, 'Failed to download label file');
        throw new Error(`eBay download label file failed (${response.status}): ${errorText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      logger.info({ shipmentId, sizeBytes: arrayBuffer.byteLength }, 'Label file downloaded');
      return base64;
    },

    async cancelShipment(shipmentId: string): Promise<void> {
      const token = await getToken();
      const response = await fetch(
        `${baseUrl}/sell/logistics/v1_beta/shipment/${encodeURIComponent(shipmentId)}/cancel`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok && response.status !== 204) {
        const errorText = (await response.text().catch(() => '')).slice(0, 200);
        logger.error({ status: response.status, shipmentId }, 'Failed to cancel shipment');
        throw new Error(`eBay cancel shipment failed (${response.status}): ${errorText}`);
      }
      logger.info({ shipmentId }, 'Shipment cancelled');
    },
  };
}
