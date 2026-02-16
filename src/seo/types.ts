/**
 * Keyword / SEO Research Types
 */

export interface KeywordAnalysis {
  query: string;
  platform: string;
  keywords: KeywordEntry[];
  suggestions: string[];
  totalProducts: number;
  avgTitleLength: number;
  topBrands: string[];
}

export interface KeywordEntry {
  keyword: string;
  frequency: number;
  /** Heuristic score: 0-100 based on frequency, length, specificity */
  score: number;
  /** Whether it appears in top-performing listings */
  inTopListings: boolean;
}

export interface SeoSuggestion {
  type: 'title' | 'description' | 'keywords' | 'category';
  current: string;
  suggested: string;
  reason: string;
  impact: 'high' | 'medium' | 'low';
}

export interface SearchTerms {
  primary: string[];
  secondary: string[];
  longTail: string[];
  /** Amazon backend search terms (max 250 bytes) */
  backendTerms?: string;
}

export interface SeoScore {
  overall: number;
  titleScore: number;
  descriptionScore: number;
  keywordDensity: number;
  readability: number;
  issues: SeoIssue[];
  suggestions: SeoSuggestion[];
}

export interface SeoIssue {
  severity: 'error' | 'warning' | 'info';
  field: string;
  message: string;
}

export interface PlatformSeoRules {
  maxTitleLength: number;
  maxDescriptionLength: number;
  maxBulletPoints: number;
  maxSearchTermBytes: number;
  titleSeparator: string;
  avoidWords: string[];
  preferredFormat: string;
}
