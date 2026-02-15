/**
 * Wholesale Module Types
 */

export interface WholesaleItem {
  sku: string;
  upc?: string;
  ean?: string;
  asin?: string;
  title: string;
  brand?: string;
  category?: string;
  wholesalePrice: number;
  msrp?: number;
  moq?: number; // minimum order quantity
  casePackQty?: number;
  weight?: number;
  supplier?: string;
}

export interface WholesaleMatch {
  item: WholesaleItem;
  amazonMatch?: {
    asin: string;
    title: string;
    price: number;
    bsr?: number;
    category?: string;
    estimatedMonthlySales?: number;
    fbaFees?: number;
    referralFee?: number;
  };
  profitAnalysis?: {
    salePrice: number;
    costPerUnit: number;
    totalFees: number;
    netProfit: number;
    roi: number;
    marginPct: number;
  };
  matchConfidence: number; // 0-1
  matchMethod: 'upc' | 'ean' | 'asin' | 'title_brand' | 'none';
}

export interface WholesaleAnalysisResult {
  totalItems: number;
  matchedItems: number;
  profitableItems: number;
  topOpportunities: WholesaleMatch[];
  averageROI: number;
  averageMargin: number;
  processingTimeMs: number;
}

export interface ColumnMapping {
  sku?: string;
  upc?: string;
  ean?: string;
  asin?: string;
  title?: string;
  brand?: string;
  category?: string;
  price?: string;
  msrp?: string;
  moq?: string;
  casePackQty?: string;
  weight?: string;
}
