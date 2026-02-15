/**
 * IP/Brand Restriction Types
 */

export interface RestrictionCheckResult {
  productId: string;
  asin?: string;
  brand?: string;
  category?: string;
  
  // IP (Intellectual Property) risk
  ipRisk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  ipComplaints: number;
  ipDetails?: string;
  
  // Brand gating status
  isGated: boolean;
  gatingType?: 'brand_gated' | 'category_gated' | 'approval_required';
  ungatingDifficulty?: 'easy' | 'medium' | 'hard' | 'impossible';
  
  // Hazmat classification
  isHazmat: boolean;
  hazmatClass?: string;
  hazmatFee?: number;
  
  // Restrictions
  restrictions: string[];
  
  // Overall recommendation
  recommendation: 'safe' | 'caution' | 'avoid' | 'blocked';
  reasons: string[];
}

export interface BrandRecord {
  brand: string;
  ipComplaintCount: number;
  isGated: boolean;
  gatingDifficulty?: 'easy' | 'medium' | 'hard' | 'impossible';
  lastUpdated: Date;
  notes?: string;
}

export interface CategoryRestriction {
  category: string;
  isRestricted: boolean;
  requiresApproval: boolean;
  requiresInvoice: boolean;
  notes?: string;
}

export interface HazmatKeyword {
  keyword: string;
  hazmatClass: string;
  additionalFee: number;
}
