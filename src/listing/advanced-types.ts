/**
 * Advanced Listing Optimization Types
 */

export interface BulletPoint {
  text: string;
  keywords: string[];
  charCount: number;
}

export interface BulletPointResult {
  bulletPoints: BulletPoint[];
  totalKeywords: string[];
  platform: string;
  maxBullets: number;
}

export interface APlusModule {
  type: 'hero_image' | 'text_block' | 'comparison_table' | 'image_text_overlay' | 'four_image_text' | 'standard_image_text';
  title?: string;
  body?: string;
  imageUrl?: string;
  items?: Array<{ label: string; value: string }>;
}

export interface APlusContent {
  asin: string;
  brandName: string;
  modules: APlusModule[];
  estimatedConversionLift: number;
  wordCount: number;
}

export interface TitleOptimization {
  originalTitle: string;
  optimizedTitle: string;
  charCount: number;
  maxChars: number;
  keywordsIncluded: string[];
  keywordsMissing: string[];
  score: number;
  suggestions: string[];
}

export interface ProductDescription {
  title: string;
  description: string;
  htmlDescription: string;
  wordCount: number;
  readabilityScore: number;
  seoKeywords: string[];
  platform: string;
}

export interface ListingQualityScore {
  overall: number;
  breakdown: {
    title: { score: number; maxScore: number; issues: string[] };
    images: { score: number; maxScore: number; issues: string[] };
    description: { score: number; maxScore: number; issues: string[] };
    keywords: { score: number; maxScore: number; issues: string[] };
    price: { score: number; maxScore: number; issues: string[] };
    bulletPoints: { score: number; maxScore: number; issues: string[] };
  };
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  competitivePosition: string;
}

export interface ListingImprovement {
  category: string;
  priority: 'high' | 'medium' | 'low';
  currentState: string;
  suggestion: string;
  expectedImpact: string;
  effort: 'minimal' | 'moderate' | 'significant';
}

export interface ImprovementReport {
  listingId: string;
  improvements: ListingImprovement[];
  estimatedSalesLift: number;
  estimatedConversionLift: number;
  topPriority: string;
}
