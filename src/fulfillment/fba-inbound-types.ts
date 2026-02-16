/**
 * FBA Inbound Shipment Types
 *
 * Type definitions for creating and managing inbound shipments
 * to Amazon FBA warehouses via SP-API.
 */

// ---------------------------------------------------------------------------
// Enums / Unions
// ---------------------------------------------------------------------------

export type InboundShipmentStatus =
  | 'planning'
  | 'ready'
  | 'shipped'
  | 'receiving'
  | 'received'
  | 'cancelled';

export type PrepType =
  | 'none'
  | 'labeling'
  | 'polybagging'
  | 'bubble_wrap'
  | 'taping'
  | 'black_shrink_wrap'
  | 'suffocation_sticker';

export type ItemCondition =
  | 'new'
  | 'refurbished'
  | 'used_like_new'
  | 'used_good';

export type Carrier =
  | 'ups'
  | 'fedex'
  | 'usps'
  | 'amazon_partnered';

// ---------------------------------------------------------------------------
// Core Types
// ---------------------------------------------------------------------------

export interface InboundItem {
  id?: string;
  shipmentId?: string;
  sku: string;
  fnsku?: string;
  asin?: string;
  quantity: number;
  prepType?: PrepType;
  condition?: ItemCondition;
  createdAt?: Date;
}

export interface InboundPlan {
  planId: string;
  items: InboundItem[];
  shipFromAddress: ShipFromAddress;
  packingOptions?: PackingOption[];
  destinationFc?: string;
  totalUnits: number;
  boxCount: number;
  estimatedWeightLbs: number;
  estimatedShippingCost: number;
  status: InboundShipmentStatus;
  createdAt: Date;
}

export interface InboundShipment {
  id: string;
  userId: string;
  planId: string;
  status: InboundShipmentStatus;
  destinationFc: string;
  itemCount: number;
  totalUnits: number;
  boxCount: number;
  weightLbs: number;
  trackingNumber?: string;
  carrier?: Carrier;
  createdAt: Date;
  shippedAt?: Date;
  receivedAt?: Date;
}

export interface ShipFromAddress {
  name?: string;
  addressLine1?: string;
  city?: string;
  stateOrRegion?: string;
  postalCode: string;
  countryCode: string;
}

export interface PackingOption {
  packingOptionId: string;
  packingGroups: Array<{
    packingGroupId: string;
    items: Array<{
      sku: string;
      quantity: number;
    }>;
  }>;
}

export interface BoxLabel {
  shipmentId: string;
  boxNumber: number;
  fnsku: string;
  sku: string;
  quantity: number;
  destinationFc: string;
  labelData: string;
}

export interface InboundFeeEstimate {
  items: Array<{
    asin?: string;
    sku?: string;
    quantity: number;
    prepFee: number;
    labelingFee: number;
    inboundShippingFee: number;
    totalFee: number;
  }>;
  totalPrepFees: number;
  totalLabelingFees: number;
  totalShippingFees: number;
  grandTotal: number;
}

export interface PlanInboundParams {
  items: Array<{
    sku: string;
    asin?: string;
    quantity: number;
    condition?: ItemCondition;
  }>;
  shipFromZip?: string;
  shipFromCountry?: string;
}

export interface CreateShipmentParams {
  planId: string;
  packingOption?: string;
  carrier?: Carrier;
}

export interface EstimateFeeParams {
  items: Array<{
    asin?: string;
    quantity: number;
    weightOz?: number;
    isOversize?: boolean;
  }>;
  shipFromZip?: string;
}
