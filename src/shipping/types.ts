/**
 * Shipping Rate Types
 */

// =============================================================================
// CARRIERS & SERVICES
// =============================================================================

export type Carrier = 'usps' | 'ups' | 'fedex' | 'amazon';

export interface CarrierService {
  carrier: Carrier;
  service: string;
  displayName: string;
  maxWeightOz: number;
  domestic: boolean;
}

// =============================================================================
// RATE PARAMS & RESULTS
// =============================================================================

export interface ShippingRateParams {
  originZip?: string;
  destZip?: string;
  weightOz: number;
  lengthIn?: number;
  widthIn?: number;
  heightIn?: number;
  carrier?: Carrier | 'any';
}

export interface ShippingRate {
  carrier: Carrier;
  service: string;
  rateCents: number;
  estimatedDays: number | null;
  source: 'cache' | 'estimate';
  expiresAt: number | null;
}

export interface CachedShippingRate {
  id: string;
  originZip: string;
  destZip: string;
  weightOz: number;
  dimensions: string | null;
  carrier: string;
  service: string;
  rateCents: number;
  fetchedAt: number;
  expiresAt: number;
}
