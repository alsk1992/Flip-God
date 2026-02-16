/**
 * International Tax Types - VAT, GST, Import Duties
 */

export interface VatRate {
  country: string;
  countryCode: string;
  standardRate: number;
  reducedRate: number;
  superReducedRate: number | null;
  parkingRate: number | null;
}

export interface VatCalculation {
  country: string;
  countryCode: string;
  netAmount: number;
  vatRate: number;
  vatAmount: number;
  grossAmount: number;
  rateType: 'standard' | 'reduced' | 'super_reduced' | 'parking';
  reverseCharge: boolean;
  ossApplicable: boolean;
}

export interface VatReportEntry {
  countryCode: string;
  country: string;
  totalSales: number;
  totalVat: number;
  orderCount: number;
  vatRate: number;
}

export interface VatReport {
  startDate: string;
  endDate: string;
  sellerCountry: string;
  entries: VatReportEntry[];
  totalSales: number;
  totalVat: number;
  totalOrders: number;
  ossThreshold: number;
  ossExceeded: boolean;
  generatedAt: string;
}

export interface GstRate {
  country: string;
  countryCode: string;
  gstRate: number;
  hstRates?: Record<string, number>;
  pstRates?: Record<string, number>;
}

export interface GstCalculation {
  country: string;
  countryCode: string;
  province?: string;
  netAmount: number;
  gstRate: number;
  gstAmount: number;
  pstRate: number;
  pstAmount: number;
  hstRate: number;
  hstAmount: number;
  totalTax: number;
  grossAmount: number;
  lowValueThreshold: number;
  thresholdExceeded: boolean;
}

export interface ImportDutyEstimate {
  hsCode: string;
  hsDescription: string;
  originCountry: string;
  destinationCountry: string;
  declaredValue: number;
  currency: string;
  dutyRate: number;
  dutyAmount: number;
  vatOrGstRate: number;
  vatOrGstAmount: number;
  totalImportCost: number;
  totalLandedCost: number;
  deMinimisFree: boolean;
  deMinimisThreshold: number;
  notes: string[];
}

export interface HsCodeInfo {
  code: string;
  description: string;
  chapter: string;
  defaultDutyRate: number;
}
