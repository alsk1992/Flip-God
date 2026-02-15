/**
 * Wholesale Module - CSV upload, product matching, and profitability analysis
 */

export { parseWholesaleCSV, detectColumnMapping } from './parser';
export { matchWholesaleItems } from './matcher';
export { analyzeWholesaleMatches } from './analyzer';
export type {
  WholesaleItem,
  WholesaleMatch,
  WholesaleAnalysisResult,
  ColumnMapping,
} from './types';
