/**
 * EasyPost API — Shipping labels, rate comparison, tracking
 *
 * Base URL: https://api.easypost.com/v2
 * Auth: HTTP Basic Auth (api_key as username, empty password)
 * Free tier: 3,000 free labels
 *
 * Key resources:
 * - Shipments — create, rate, buy labels
 * - Trackers — universal tracking for any carrier
 * - Addresses — validation
 * - Rates — compare carrier rates
 */

import { createLogger } from '../../utils/logger';

const logger = createLogger('easypost');

const EASYPOST_BASE = 'https://api.easypost.com/v2';

export interface EasyPostConfig {
  apiKey: string;
}

export interface EasyPostAddress {
  id?: string;
  name?: string;
  company?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
  verifications?: {
    delivery?: { success: boolean; errors?: Array<{ message: string }> };
    zip4?: { success: boolean };
  };
}

export interface EasyPostParcel {
  id?: string;
  length: number;
  width: number;
  height: number;
  weight: number; // ounces
  predefined_package?: string;
}

export interface EasyPostRate {
  id: string;
  carrier: string;
  service: string;
  rate: string;
  currency: string;
  deliveryDays?: number;
  deliveryDate?: string;
  deliveryDateGuaranteed?: boolean;
  estDeliveryDays?: number;
  shipmentId?: string;
}

export interface EasyPostShipment {
  id: string;
  mode: string;
  status: string;
  fromAddress: EasyPostAddress;
  toAddress: EasyPostAddress;
  parcel: EasyPostParcel;
  rates: EasyPostRate[];
  selectedRate?: EasyPostRate;
  postageLabel?: {
    id: string;
    labelUrl: string;
    labelPdfUrl?: string;
    labelZplUrl?: string;
    labelDate: string;
    labelResolution: number;
    labelSize: string;
    labelType: string;
    labelFileType: string;
  };
  trackingCode?: string;
  tracker?: EasyPostTracker;
  refundStatus?: string;
  insurance?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EasyPostTrackingDetail {
  message: string;
  description?: string;
  status: string;
  statusDetail?: string;
  datetime: string;
  source: string;
  trackingLocation?: {
    city?: string;
    state?: string;
    country?: string;
    zip?: string;
  };
}

export interface EasyPostTracker {
  id: string;
  mode: string;
  trackingCode: string;
  status: string;
  statusDetail?: string;
  signedBy?: string;
  weight?: number;
  estDeliveryDate?: string;
  shipmentId?: string;
  carrier: string;
  trackingDetails: EasyPostTrackingDetail[];
  publicUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EasyPostInsurance {
  id: string;
  mode: string;
  amount: string;
  carrier: string;
  trackingCode: string;
  status: string;
  toAddress?: EasyPostAddress;
  fromAddress?: EasyPostAddress;
  createdAt: string;
  updatedAt: string;
}

export interface EasyPostBatch {
  id: string;
  mode: string;
  state: string;
  numShipments: number;
  shipments: Array<{ id: string }>;
  labelUrl?: string;
  scanFormUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EasyPostScanForm {
  id: string;
  mode: string;
  status: string;
  formUrl?: string;
  formFileType?: string;
  trackingCodes: string[];
  batchId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EasyPostApi {
  /** Create a shipment to get rates */
  createShipment(params: {
    fromAddress: Omit<EasyPostAddress, 'id'>;
    toAddress: Omit<EasyPostAddress, 'id'>;
    parcel: Omit<EasyPostParcel, 'id'>;
  }): Promise<EasyPostShipment>;

  /** Buy the cheapest rate for a shipment */
  buyShipment(shipmentId: string, rateId: string): Promise<EasyPostShipment>;

  /** Get rates for a shipment without buying */
  getRates(shipmentId: string): Promise<EasyPostRate[]>;

  /** Get the cheapest rate from available rates */
  getCheapestRate(rates: EasyPostRate[], carriers?: string[]): EasyPostRate | null;

  /** Create a tracker for any tracking number */
  createTracker(trackingCode: string, carrier?: string): Promise<EasyPostTracker>;

  /** Get tracker status */
  getTracker(trackerId: string): Promise<EasyPostTracker | null>;

  /** Verify an address */
  verifyAddress(address: Omit<EasyPostAddress, 'id'>): Promise<EasyPostAddress>;


  /** Validate an address using create_and_verify */
  validateAddress(address: {
    street1: string;
    street2?: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  }): Promise<{
    verified: boolean;
    address?: EasyPostAddress;
    errors?: string[];
  }>;
  /** Refund a shipment */
  refundShipment(shipmentId: string): Promise<{ refundStatus: string }>;

  /** Create shipping insurance */
  createInsurance(params: {
    amount: string;
    carrier: string;
    trackingCode: string;
    toAddress: object;
    fromAddress: object;
  }): Promise<EasyPostInsurance>;

  /** Create a batch of shipments */
  createBatch(shipmentIds: string[]): Promise<EasyPostBatch>;

  /** Buy labels for all shipments in a batch */
  buyBatch(batchId: string): Promise<EasyPostBatch>;

  /** Get batch status */
  getBatch(batchId: string): Promise<EasyPostBatch>;

  /** Create a SCAN form for shipments */
  createScanForm(shipmentIds: string[]): Promise<EasyPostScanForm>;

  /** Get a SCAN form */
  getScanForm(scanFormId: string): Promise<EasyPostScanForm>;
}

export function createEasyPostApi(config: EasyPostConfig): EasyPostApi {
  const authHeader = 'Basic ' + Buffer.from(`${config.apiKey}:`).toString('base64');

  async function epFetch<T>(path: string, options?: {
    method?: string;
    body?: unknown;
  }): Promise<T> {
    const url = `${EASYPOST_BASE}${path}`;

    const fetchOptions: RequestInit = {
      method: options?.method ?? 'GET',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
    };

    if (options?.body) {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ status: response.status, path, error: errorText }, 'EasyPost API request failed');
      throw new Error(`EasyPost (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  function mapAddress(a: Record<string, unknown>): EasyPostAddress {
    return {
      id: a.id as string | undefined,
      name: a.name as string | undefined,
      company: a.company as string | undefined,
      street1: (a.street1 as string) ?? '',
      street2: a.street2 as string | undefined,
      city: (a.city as string) ?? '',
      state: (a.state as string) ?? '',
      zip: (a.zip as string) ?? '',
      country: (a.country as string) ?? '',
      phone: a.phone as string | undefined,
      email: a.email as string | undefined,
      verifications: a.verifications as EasyPostAddress['verifications'],
    };
  }

  function mapRate(r: Record<string, unknown>): EasyPostRate {
    return {
      id: r.id as string,
      carrier: r.carrier as string,
      service: r.service as string,
      rate: r.rate as string,
      currency: (r.currency as string) ?? 'USD',
      deliveryDays: r.delivery_days as number | undefined,
      deliveryDate: r.delivery_date as string | undefined,
      deliveryDateGuaranteed: r.delivery_date_guaranteed as boolean | undefined,
      estDeliveryDays: r.est_delivery_days as number | undefined,
    };
  }

  function mapPostageLabel(pl: any): EasyPostShipment['postageLabel'] {
    if (!pl) return undefined;
    return {
      id: pl.id,
      labelUrl: pl.label_url,
      labelPdfUrl: pl.label_pdf_url,
      labelZplUrl: pl.label_zpl_url,
      labelDate: pl.label_date,
      labelResolution: pl.label_resolution,
      labelSize: pl.label_size,
      labelType: pl.label_type,
      labelFileType: pl.label_file_type,
    };
  }

  function mapTracker(t: any): EasyPostTracker | undefined {
    if (!t) return undefined;
    return {
      id: t.id,
      mode: t.mode ?? 'test',
      trackingCode: t.tracking_code ?? '',
      status: t.status ?? 'unknown',
      statusDetail: t.status_detail,
      signedBy: t.signed_by,
      weight: t.weight,
      estDeliveryDate: t.est_delivery_date,
      shipmentId: t.shipment_id,
      carrier: t.carrier ?? 'unknown',
      trackingDetails: ((t.tracking_details ?? []) as Array<Record<string, unknown>>).map(d => ({
        message: (d.message as string) ?? '',
        description: d.description as string | undefined,
        status: (d.status as string) ?? 'unknown',
        statusDetail: d.status_detail as string | undefined,
        datetime: (d.datetime as string) ?? '',
        source: (d.source as string) ?? '',
        trackingLocation: d.tracking_location as EasyPostTrackingDetail['trackingLocation'],
      })),
      publicUrl: t.public_url,
      createdAt: t.created_at ?? '',
      updatedAt: t.updated_at ?? '',
    };
  }

  function mapShipment(s: Record<string, unknown>): EasyPostShipment {
    return {
      id: s.id as string,
      mode: (s.mode as string) ?? 'test',
      status: (s.status as string) ?? 'unknown',
      fromAddress: mapAddress((s.from_address ?? {}) as Record<string, unknown>),
      toAddress: mapAddress((s.to_address ?? {}) as Record<string, unknown>),
      parcel: (s.parcel ?? {}) as EasyPostParcel,
      rates: ((s.rates ?? []) as Record<string, unknown>[]).map(mapRate),
      selectedRate: s.selected_rate ? mapRate(s.selected_rate as Record<string, unknown>) : undefined,
      postageLabel: mapPostageLabel(s.postage_label),
      trackingCode: s.tracking_code as string | undefined,
      tracker: mapTracker(s.tracker),
      refundStatus: s.refund_status as string | undefined,
      insurance: s.insurance as string | undefined,
      createdAt: (s.created_at as string) ?? '',
      updatedAt: (s.updated_at as string) ?? '',
    };
  }

  return {
    async createShipment(params) {
      const data = await epFetch<Record<string, unknown>>('/shipments', {
        method: 'POST',
        body: {
          shipment: {
            from_address: params.fromAddress,
            to_address: params.toAddress,
            parcel: params.parcel,
          },
        },
      });
      return mapShipment(data);
    },

    async buyShipment(shipmentId, rateId) {
      const data = await epFetch<Record<string, unknown>>(`/shipments/${shipmentId}/buy`, {
        method: 'POST',
        body: { rate: { id: rateId } },
      });
      return mapShipment(data);
    },

    async getRates(shipmentId) {
      const data = await epFetch<{ rates?: Record<string, unknown>[] }>(`/shipments/${shipmentId}/rates`);
      return (data.rates ?? []).map(mapRate);
    },

    getCheapestRate(rates, carriers?) {
      let filtered = rates;
      if (carriers?.length) {
        filtered = rates.filter(r => carriers.includes(r.carrier));
      }
      if (filtered.length === 0) return null;
      return filtered.reduce((cheapest, r) => {
        const currentPrice = parseFloat(r.rate);
        const cheapestPrice = parseFloat(cheapest.rate);
        return currentPrice < cheapestPrice ? r : cheapest;
      });
    },

    async createTracker(trackingCode, carrier?) {
      const body: Record<string, unknown> = { tracker: { tracking_code: trackingCode } };
      if (carrier) {
        (body.tracker as Record<string, unknown>).carrier = carrier;
      }

      const data = await epFetch<Record<string, unknown>>('/trackers', {
        method: 'POST',
        body,
      });

      return {
        id: data.id as string,
        mode: (data.mode as string) ?? 'test',
        trackingCode: (data.tracking_code as string) ?? trackingCode,
        status: (data.status as string) ?? 'unknown',
        statusDetail: data.status_detail as string | undefined,
        signedBy: data.signed_by as string | undefined,
        weight: data.weight as number | undefined,
        estDeliveryDate: data.est_delivery_date as string | undefined,
        shipmentId: data.shipment_id as string | undefined,
        carrier: (data.carrier as string) ?? carrier ?? 'unknown',
        trackingDetails: ((data.tracking_details ?? []) as Array<Record<string, unknown>>).map(d => ({
          message: (d.message as string) ?? '',
          description: d.description as string | undefined,
          status: (d.status as string) ?? 'unknown',
          statusDetail: d.status_detail as string | undefined,
          datetime: (d.datetime as string) ?? '',
          source: (d.source as string) ?? '',
          trackingLocation: d.tracking_location as EasyPostTrackingDetail['trackingLocation'],
        })),
        publicUrl: data.public_url as string | undefined,
        createdAt: (data.created_at as string) ?? '',
        updatedAt: (data.updated_at as string) ?? '',
      };
    },

    async getTracker(trackerId) {
      try {
        const data = await epFetch<Record<string, unknown>>(`/trackers/${trackerId}`);
        return {
          id: data.id as string,
          mode: (data.mode as string) ?? 'test',
          trackingCode: (data.tracking_code as string) ?? '',
          status: (data.status as string) ?? 'unknown',
          statusDetail: data.status_detail as string | undefined,
          signedBy: data.signed_by as string | undefined,
          weight: data.weight as number | undefined,
          estDeliveryDate: data.est_delivery_date as string | undefined,
          shipmentId: data.shipment_id as string | undefined,
          carrier: (data.carrier as string) ?? 'unknown',
          trackingDetails: ((data.tracking_details ?? []) as Array<Record<string, unknown>>).map(d => ({
            message: (d.message as string) ?? '',
            description: d.description as string | undefined,
            status: (d.status as string) ?? 'unknown',
            statusDetail: d.status_detail as string | undefined,
            datetime: (d.datetime as string) ?? '',
            source: (d.source as string) ?? '',
            trackingLocation: d.tracking_location as EasyPostTrackingDetail['trackingLocation'],
          })),
          publicUrl: data.public_url as string | undefined,
          createdAt: (data.created_at as string) ?? '',
          updatedAt: (data.updated_at as string) ?? '',
        };
      } catch {
        return null;
      }
    },

    async verifyAddress(address) {
      const data = await epFetch<Record<string, unknown>>('/addresses', {
        method: 'POST',
        body: {
          address: {
            ...address,
            verify: ['delivery'],
          },
        },
      });
      return mapAddress(data);
    },

    async validateAddress(address) {
      try {
        const data = await epFetch<Record<string, unknown>>('/addresses/create_and_verify', {
          method: 'POST',
          body: {
            address: {
              street1: address.street1,
              street2: address.street2,
              city: address.city,
              state: address.state,
              zip: address.zip,
              country: address.country,
              verify: ['delivery'],
            },
          },
        });

        const mapped = mapAddress(data);
        const deliveryVerification = mapped.verifications?.delivery;
        const verified = deliveryVerification?.success ?? false;
        const errors = deliveryVerification?.errors?.map((e) => e.message) ?? [];

        return {
          verified,
          address: mapped,
          errors: errors.length > 0 ? errors : undefined,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ error: message }, 'Address validation failed');
        return {
          verified: false,
          errors: [message],
        };
      }
    },

    async refundShipment(shipmentId) {
      const data = await epFetch<Record<string, unknown>>(`/shipments/${shipmentId}/refund`, {
        method: 'POST',
      });
      return { refundStatus: (data.refund_status as string) ?? 'unknown' };
    },

    async createInsurance(params) {
      const data = await epFetch<Record<string, unknown>>('/insurances', {
        method: 'POST',
        body: { insurance: { amount: params.amount, carrier: params.carrier, tracking_code: params.trackingCode, to_address: params.toAddress, from_address: params.fromAddress } },
      });
      return {
        id: data.id as string,
        mode: (data.mode as string) ?? 'test',
        amount: (data.amount as string) ?? params.amount,
        carrier: (data.carrier as string) ?? params.carrier,
        trackingCode: (data.tracking_code as string) ?? params.trackingCode,
        status: (data.status as string) ?? 'unknown',
        toAddress: data.to_address ? mapAddress(data.to_address as Record<string, unknown>) : undefined,
        fromAddress: data.from_address ? mapAddress(data.from_address as Record<string, unknown>) : undefined,
        createdAt: (data.created_at as string) ?? '',
        updatedAt: (data.updated_at as string) ?? '',
      };
    },

    async createBatch(shipmentIds) {
      const data = await epFetch<Record<string, unknown>>('/batches', {
        method: 'POST',
        body: {
          batch: {
            shipments: shipmentIds.map(id => ({ id })),
          },
        },
      });
      return {
        id: data.id as string,
        mode: (data.mode as string) ?? 'test',
        state: (data.state as string) ?? 'unknown',
        numShipments: (data.num_shipments as number) ?? shipmentIds.length,
        shipments: ((data.shipments ?? []) as Array<Record<string, unknown>>).map(s => ({ id: s.id as string })),
        labelUrl: data.label_url as string | undefined,
        scanFormUrl: data.scan_form_url as string | undefined,
        createdAt: (data.created_at as string) ?? '',
        updatedAt: (data.updated_at as string) ?? '',
      };
    },

    async buyBatch(batchId) {
      const data = await epFetch<Record<string, unknown>>(`/batches/${batchId}/buy`, {
        method: 'POST',
      });
      return {
        id: data.id as string,
        mode: (data.mode as string) ?? 'test',
        state: (data.state as string) ?? 'unknown',
        numShipments: (data.num_shipments as number) ?? 0,
        shipments: ((data.shipments ?? []) as Array<Record<string, unknown>>).map(s => ({ id: s.id as string })),
        labelUrl: data.label_url as string | undefined,
        scanFormUrl: data.scan_form_url as string | undefined,
        createdAt: (data.created_at as string) ?? '',
        updatedAt: (data.updated_at as string) ?? '',
      };
    },

    async getBatch(batchId) {
      const data = await epFetch<Record<string, unknown>>(`/batches/${batchId}`);
      return {
        id: data.id as string,
        mode: (data.mode as string) ?? 'test',
        state: (data.state as string) ?? 'unknown',
        numShipments: (data.num_shipments as number) ?? 0,
        shipments: ((data.shipments ?? []) as Array<Record<string, unknown>>).map(s => ({ id: s.id as string })),
        labelUrl: data.label_url as string | undefined,
        scanFormUrl: data.scan_form_url as string | undefined,
        createdAt: (data.created_at as string) ?? '',
        updatedAt: (data.updated_at as string) ?? '',
      };
    },

    async createScanForm(shipmentIds) {
      const data = await epFetch<Record<string, unknown>>('/scan_forms', {
        method: 'POST',
        body: {
          scan_form: {
            shipments: shipmentIds.map(id => ({ id })),
          },
        },
      });
      return {
        id: data.id as string,
        mode: (data.mode as string) ?? 'test',
        status: (data.status as string) ?? 'unknown',
        formUrl: data.form_url as string | undefined,
        formFileType: data.form_file_type as string | undefined,
        trackingCodes: ((data.tracking_codes ?? []) as string[]),
        batchId: data.batch_id as string | undefined,
        createdAt: (data.created_at as string) ?? '',
        updatedAt: (data.updated_at as string) ?? '',
      };
    },

    async getScanForm(scanFormId) {
      const data = await epFetch<Record<string, unknown>>(`/scan_forms/${scanFormId}`);
      return {
        id: data.id as string,
        mode: (data.mode as string) ?? 'test',
        status: (data.status as string) ?? 'unknown',
        formUrl: data.form_url as string | undefined,
        formFileType: data.form_file_type as string | undefined,
        trackingCodes: ((data.tracking_codes ?? []) as string[]),
        batchId: data.batch_id as string | undefined,
        createdAt: (data.created_at as string) ?? '',
        updatedAt: (data.updated_at as string) ?? '',
      };
    },
  };
}
