/**
 * IP/Brand Restriction Module
 */

export { checkRestrictions, quickCheck } from './checker';
export { lookupBrand, lookupCategory, checkHazmat, getAllGatedBrands, getAllRestrictedCategories } from './database';
export type { RestrictionCheckResult, BrandRecord, CategoryRestriction, HazmatKeyword } from './types';
