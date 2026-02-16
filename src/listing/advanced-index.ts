/**
 * Advanced Listing Optimization Module
 *
 * AI-powered listing optimization tools: bullet point generation,
 * A+ Content structure, title keyword optimization, SEO descriptions,
 * quality scoring, and improvement suggestions.
 */

import { createLogger } from '../utils/logger.js';
import type { Database } from '../db/index.js';
import type {
  BulletPoint,
  BulletPointResult,
  APlusContent,
  APlusModule,
  TitleOptimization,
  ProductDescription,
  ListingQualityScore,
  ListingImprovement,
  ImprovementReport,
} from './advanced-types.js';

const logger = createLogger('advanced-listing');

// =============================================================================
// Platform Constraints
// =============================================================================

const PLATFORM_LIMITS: Record<string, {
  maxTitleChars: number;
  maxBullets: number;
  maxBulletChars: number;
  maxDescriptionChars: number;
}> = {
  amazon: { maxTitleChars: 200, maxBullets: 5, maxBulletChars: 500, maxDescriptionChars: 2000 },
  ebay: { maxTitleChars: 80, maxBullets: 0, maxBulletChars: 0, maxDescriptionChars: 500000 },
  etsy: { maxTitleChars: 140, maxBullets: 0, maxBulletChars: 0, maxDescriptionChars: 100000 },
  shopify: { maxTitleChars: 255, maxBullets: 10, maxBulletChars: 1000, maxDescriptionChars: 100000 },
  walmart: { maxTitleChars: 75, maxBullets: 5, maxBulletChars: 500, maxDescriptionChars: 4000 },
};

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'shall', 'can', 'this', 'that',
  'these', 'those', 'it', 'its', 'not', 'no', 'nor', 'so', 'if',
  'than', 'too', 'very', 'just', 'about', 'also', 'into', 'over',
  'such', 'up', 'out', 'only', 'own', 'same', 'other', 'new',
]);

// =============================================================================
// Bullet Point Generation
// =============================================================================

export function generateBulletPoints(input: {
  description: string;
  keywords?: string[];
  platform?: string;
  maxBullets?: number;
}): BulletPointResult {
  const platform = input.platform?.toLowerCase() ?? 'amazon';
  const limits = PLATFORM_LIMITS[platform] ?? PLATFORM_LIMITS.amazon;
  const maxBullets = input.maxBullets ?? (limits.maxBullets || 5);

  if (!input.description || input.description.trim().length === 0) {
    throw new Error('description is required and cannot be empty');
  }

  const sentences = input.description
    .replace(/\n+/g, '. ')
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);

  const descKeywords = extractKeywords(input.description);
  const targetKeywords = input.keywords ?? descKeywords.slice(0, 10);

  const scoredSentences = sentences.map((sentence) => {
    let keywordHits = 0;
    for (const kw of targetKeywords) {
      if (sentence.toLowerCase().includes(kw.toLowerCase())) {
        keywordHits++;
      }
    }
    const benefitWords = ['feature', 'benefit', 'perfect', 'ideal', 'designed', 'made',
      'includes', 'provides', 'ensures', 'durable', 'premium', 'quality',
      'compatible', 'fits', 'works', 'easy', 'lightweight', 'portable'];
    const benefitScore = benefitWords.filter((w) => sentence.toLowerCase().includes(w)).length;
    return { sentence, score: keywordHits * 3 + benefitScore * 2 + (sentence.length > 20 ? 1 : 0) };
  });

  scoredSentences.sort((a, b) => b.score - a.score);

  const bulletPoints: BulletPoint[] = [];
  const usedSentences = new Set<string>();

  for (const item of scoredSentences) {
    if (bulletPoints.length >= maxBullets) break;
    if (usedSentences.has(item.sentence)) continue;
    usedSentences.add(item.sentence);

    let text = item.sentence;
    if (text.length > limits.maxBulletChars && limits.maxBulletChars > 0) {
      text = text.substring(0, limits.maxBulletChars - 3) + '...';
    }

    const bulletKeywords = targetKeywords.filter((kw) =>
      text.toLowerCase().includes(kw.toLowerCase())
    );

    bulletPoints.push({
      text: formatBullet(text),
      keywords: bulletKeywords,
      charCount: text.length,
    });
  }

  if (bulletPoints.length < maxBullets && sentences.length > bulletPoints.length) {
    for (const sentence of sentences) {
      if (bulletPoints.length >= maxBullets) break;
      if (usedSentences.has(sentence)) continue;
      usedSentences.add(sentence);
      const text = sentence.length > (limits.maxBulletChars || 500)
        ? sentence.substring(0, (limits.maxBulletChars || 500) - 3) + '...'
        : sentence;
      bulletPoints.push({ text: formatBullet(text), keywords: [], charCount: text.length });
    }
  }

  return { bulletPoints, totalKeywords: targetKeywords, platform, maxBullets };
}

// =============================================================================
// A+ Content Generation
// =============================================================================

export function generateAPlusContent(input: {
  asin: string;
  brandName: string;
  productTitle: string;
  description: string;
  features: string[];
  imageUrls?: string[];
}): APlusContent {
  if (!input.asin || !input.brandName) {
    throw new Error('asin and brand_name are required');
  }

  const modules: APlusModule[] = [];

  modules.push({
    type: 'hero_image',
    title: input.brandName,
    body: `Discover ${input.productTitle} - crafted with care by ${input.brandName}`,
    imageUrl: input.imageUrls?.[0],
  });

  const overview = input.description.length > 500
    ? input.description.substring(0, 497) + '...'
    : input.description;
  modules.push({ type: 'text_block', title: 'Product Overview', body: overview });

  if (input.features.length >= 2) {
    modules.push({
      type: 'four_image_text',
      title: 'Key Features',
      items: input.features.slice(0, 4).map((f, i) => ({ label: `Feature ${i + 1}`, value: f })),
    });
  }

  if (input.imageUrls && input.imageUrls.length > 1) {
    modules.push({
      type: 'image_text_overlay',
      title: 'Why Choose Us',
      body: `${input.brandName} products are designed with quality and customer satisfaction in mind. Every ${input.productTitle} undergoes rigorous quality control.`,
      imageUrl: input.imageUrls[1],
    });
  }

  if (input.features.length >= 4) {
    modules.push({
      type: 'comparison_table',
      title: 'Product Specifications',
      items: input.features.map((f) => {
        const parts = f.split(':');
        return { label: parts[0]?.trim() ?? f, value: parts[1]?.trim() ?? 'Yes' };
      }),
    });
  }

  const totalWords = modules.reduce((sum, m) => {
    const text = [m.title, m.body, ...(m.items ?? []).map((i) => `${i.label} ${i.value}`)].join(' ');
    return sum + text.split(/\s+/).length;
  }, 0);

  const estimatedLift = Math.min(10, Math.max(3, modules.length * 1.5));

  return {
    asin: input.asin,
    brandName: input.brandName,
    modules,
    estimatedConversionLift: round1(estimatedLift),
    wordCount: totalWords,
  };
}

// =============================================================================
// Title Keyword Optimization
// =============================================================================

export function optimizeTitleKeywords(input: {
  currentTitle: string;
  keywords: string[];
  platform?: string;
  brandName?: string;
}): TitleOptimization {
  const platform = input.platform?.toLowerCase() ?? 'amazon';
  const limits = PLATFORM_LIMITS[platform] ?? PLATFORM_LIMITS.amazon;
  const maxChars = limits.maxTitleChars;

  if (!input.currentTitle) {
    throw new Error('current_title is required');
  }

  const currentTitleLower = input.currentTitle.toLowerCase();
  const keywordsIncluded: string[] = [];
  const keywordsMissing: string[] = [];

  for (const kw of input.keywords) {
    if (currentTitleLower.includes(kw.toLowerCase())) {
      keywordsIncluded.push(kw);
    } else {
      keywordsMissing.push(kw);
    }
  }

  let optimized = input.currentTitle;
  const suggestions: string[] = [];

  if (input.brandName && !currentTitleLower.startsWith(input.brandName.toLowerCase())) {
    suggestions.push(`Consider starting title with brand name "${input.brandName}" for brand recognition`);
  }

  for (const kw of keywordsMissing) {
    const testTitle = `${optimized} ${kw}`;
    if (testTitle.length <= maxChars) {
      optimized = testTitle;
      keywordsIncluded.push(kw);
    }
  }

  if (optimized.length > maxChars) {
    optimized = optimized.substring(0, maxChars - 3).trim() + '...';
    suggestions.push(`Title truncated to ${maxChars} chars (${platform} limit)`);
  }

  const words = optimized.split(/\s+/);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const word of words) {
    const lower = word.toLowerCase();
    if (seen.has(lower) && !STOP_WORDS.has(lower)) {
      suggestions.push(`Removed duplicate word: "${word}"`);
      continue;
    }
    seen.add(lower);
    deduped.push(word);
  }
  optimized = deduped.join(' ');

  let score = 50;
  if (optimized.length >= maxChars * 0.7) score += 10;
  if (optimized.length <= maxChars) score += 10;
  score += Math.min(20, keywordsIncluded.length * 4);
  if (input.brandName && optimized.toLowerCase().includes(input.brandName.toLowerCase())) score += 10;
  if (optimized.toUpperCase() === optimized) { score -= 15; suggestions.push('Avoid ALL CAPS in title'); }
  if (/[!@#$%^&*()]/.test(optimized)) { score -= 5; suggestions.push('Remove special characters from title'); }
  if (optimized.length < 30) { score -= 10; suggestions.push('Title is too short - add more descriptive keywords'); }
  score = Math.max(0, Math.min(100, score));

  const missingAfterOptimize = input.keywords.filter(
    (kw) => !optimized.toLowerCase().includes(kw.toLowerCase())
  );

  return {
    originalTitle: input.currentTitle,
    optimizedTitle: optimized,
    charCount: optimized.length,
    maxChars,
    keywordsIncluded,
    keywordsMissing: missingAfterOptimize,
    score,
    suggestions,
  };
}

// =============================================================================
// Product Description Generation
// =============================================================================

export function generateProductDescription(input: {
  title: string;
  features: string[];
  keywords?: string[];
  platform?: string;
  tone?: 'professional' | 'casual' | 'luxury' | 'technical';
}): ProductDescription {
  const platform = input.platform?.toLowerCase() ?? 'amazon';
  const tone = input.tone ?? 'professional';
  const keywords = input.keywords ?? extractKeywords(input.features.join(' '));

  if (!input.title) throw new Error('title is required');
  if (!input.features.length) throw new Error('At least one feature is required');

  const paragraphs: string[] = [];
  paragraphs.push(buildOpener(input.title, keywords.slice(0, 3), tone));
  for (const feature of input.features.slice(0, 6)) {
    paragraphs.push(expandFeature(feature, tone));
  }
  paragraphs.push(buildCloser(input.title, tone));

  const description = paragraphs.join('\n\n');
  const htmlDescription = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
  const wordCount = description.split(/\s+/).length;
  const readabilityScore = calculateReadability(description);

  return { title: input.title, description, htmlDescription, wordCount, readabilityScore, seoKeywords: keywords.slice(0, 15), platform };
}

// =============================================================================
// Listing Quality Analysis
// =============================================================================

export function analyzeListingQuality(db: Database, input: {
  listingId?: string;
  title: string;
  description: string;
  imageCount: number;
  bulletPoints?: string[];
  price: number;
  keywords?: string[];
  platform?: string;
}): ListingQualityScore {
  const platform = input.platform?.toLowerCase() ?? 'amazon';
  const limits = PLATFORM_LIMITS[platform] ?? PLATFORM_LIMITS.amazon;

  const titleResult = scoreTitle(input.title, limits, input.keywords);
  const imageResult = scoreImages(input.imageCount, platform);
  const descResult = scoreDescription(input.description, limits);
  const keywordResult = scoreKeywords(input.title, input.description, input.keywords ?? []);
  const priceResult = scorePrice(db, input.price);
  const bulletResult = scoreBulletPoints(input.bulletPoints ?? [], limits);

  const overall = titleResult.score + imageResult.score + descResult.score +
    keywordResult.score + priceResult.score + bulletResult.score;

  let grade: ListingQualityScore['grade'];
  if (overall >= 85) grade = 'A';
  else if (overall >= 70) grade = 'B';
  else if (overall >= 55) grade = 'C';
  else if (overall >= 40) grade = 'D';
  else grade = 'F';

  let competitivePosition: string;
  if (overall >= 85) competitivePosition = 'Top 10% - Excellent listing quality';
  else if (overall >= 70) competitivePosition = 'Top 30% - Good listing with room to improve';
  else if (overall >= 55) competitivePosition = 'Average - Several areas need attention';
  else competitivePosition = 'Below average - Significant optimization needed';

  return {
    overall,
    breakdown: { title: titleResult, images: imageResult, description: descResult, keywords: keywordResult, price: priceResult, bulletPoints: bulletResult },
    grade,
    competitivePosition,
  };
}

// =============================================================================
// Listing Improvement Suggestions
// =============================================================================

export function suggestListingImprovements(db: Database, input: {
  listingId: string;
  title: string;
  description: string;
  imageCount: number;
  bulletPoints?: string[];
  price: number;
  keywords?: string[];
  platform?: string;
}): ImprovementReport {
  const quality = analyzeListingQuality(db, input);
  const improvements: ListingImprovement[] = [];

  const sections: Array<{
    category: string;
    breakdown: { score: number; maxScore: number; issues: string[] };
    context: string;
    impact: string;
    effort: 'minimal' | 'moderate' | 'significant';
  }> = [
    { category: 'Title', breakdown: quality.breakdown.title, context: `Title: "${input.title}"`, impact: 'Title optimization can improve CTR by 10-30%', effort: 'minimal' },
    { category: 'Images', breakdown: quality.breakdown.images, context: `${input.imageCount} images`, impact: 'Quality images improve conversion by 20-40%', effort: 'significant' },
    { category: 'Description', breakdown: quality.breakdown.description, context: `${input.description.length} chars`, impact: 'Better descriptions improve SEO and confidence', effort: 'moderate' },
    { category: 'Keywords', breakdown: quality.breakdown.keywords, context: `${input.keywords?.length ?? 0} keywords`, impact: 'Keyword optimization improves visibility 15-50%', effort: 'minimal' },
    { category: 'Bullet Points', breakdown: quality.breakdown.bulletPoints, context: `${input.bulletPoints?.length ?? 0} bullets`, impact: 'Bullets improve scannability and conversion', effort: 'moderate' },
    { category: 'Pricing', breakdown: quality.breakdown.price, context: `$${input.price}`, impact: 'Pricing affects buy box win rate', effort: 'minimal' },
  ];

  for (const section of sections) {
    for (const issue of section.breakdown.issues) {
      const ratio = section.breakdown.score / section.breakdown.maxScore;
      improvements.push({
        category: section.category,
        priority: ratio < 0.4 ? 'high' : ratio < 0.7 ? 'medium' : 'low',
        currentState: section.context,
        suggestion: issue,
        expectedImpact: section.impact,
        effort: section.effort,
      });
    }
  }

  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  improvements.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const qualityGap = 100 - quality.overall;
  return {
    listingId: input.listingId,
    improvements,
    estimatedSalesLift: round1(qualityGap * 0.3),
    estimatedConversionLift: round1(qualityGap * 0.2),
    topPriority: improvements[0]?.suggestion ?? 'No improvements needed',
  };
}

// =============================================================================
// Tool Definitions
// =============================================================================

export const advancedListingTools = [
  {
    name: 'generate_bullet_points',
    description: 'Generate optimized bullet points from a product description. Extracts key features and benefits, incorporates target keywords, and formats for the specified marketplace.',
    input_schema: {
      type: 'object' as const,
      properties: {
        description: { type: 'string' as const, description: 'Full product description text' },
        keywords: { type: 'array' as const, items: { type: 'string' as const }, description: 'Target keywords to incorporate' },
        platform: { type: 'string' as const, enum: ['amazon', 'ebay', 'etsy', 'shopify', 'walmart'], description: 'Target marketplace (default: amazon)' },
        max_bullets: { type: 'number' as const, description: 'Maximum number of bullet points' },
      },
      required: ['description'] as const,
    },
  },
  {
    name: 'generate_a_plus_content',
    description: 'Generate Amazon A+ Content / Enhanced Brand Content module structure with hero images, text blocks, comparison tables, and lifestyle modules.',
    input_schema: {
      type: 'object' as const,
      properties: {
        asin: { type: 'string' as const, description: 'Amazon ASIN' },
        brand_name: { type: 'string' as const, description: 'Brand name' },
        product_title: { type: 'string' as const, description: 'Product title' },
        description: { type: 'string' as const, description: 'Product description' },
        features: { type: 'array' as const, items: { type: 'string' as const }, description: 'Product features/specs' },
        image_urls: { type: 'array' as const, items: { type: 'string' as const }, description: 'Product image URLs' },
      },
      required: ['asin', 'brand_name', 'product_title', 'description', 'features'] as const,
    },
  },
  {
    name: 'optimize_title_keywords',
    description: 'Optimize listing title with keyword research data. Front-loads high-value keywords, removes duplicates, and ensures platform character limits.',
    input_schema: {
      type: 'object' as const,
      properties: {
        current_title: { type: 'string' as const, description: 'Current listing title' },
        keywords: { type: 'array' as const, items: { type: 'string' as const }, description: 'Target keywords (ordered by priority)' },
        platform: { type: 'string' as const, enum: ['amazon', 'ebay', 'etsy', 'shopify', 'walmart'], description: 'Target marketplace (default: amazon)' },
        brand_name: { type: 'string' as const, description: 'Brand name to include' },
      },
      required: ['current_title', 'keywords'] as const,
    },
  },
  {
    name: 'generate_product_description',
    description: 'Generate SEO-optimized product description from features and keywords. Outputs plain text and HTML with readability scoring.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const, description: 'Product title' },
        features: { type: 'array' as const, items: { type: 'string' as const }, description: 'Product features to expand' },
        keywords: { type: 'array' as const, items: { type: 'string' as const }, description: 'SEO keywords' },
        platform: { type: 'string' as const, enum: ['amazon', 'ebay', 'etsy', 'shopify', 'walmart'], description: 'Target marketplace' },
        tone: { type: 'string' as const, enum: ['professional', 'casual', 'luxury', 'technical'], description: 'Writing tone (default: professional)' },
      },
      required: ['title', 'features'] as const,
    },
  },
  {
    name: 'analyze_listing_quality',
    description: 'Score listing quality across 6 dimensions: title, images, description, keywords, price, and bullet points. Returns A-F grade and competitive position.',
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_id: { type: 'string' as const, description: 'Listing ID (optional)' },
        title: { type: 'string' as const, description: 'Listing title' },
        description: { type: 'string' as const, description: 'Listing description' },
        image_count: { type: 'number' as const, description: 'Number of product images' },
        bullet_points: { type: 'array' as const, items: { type: 'string' as const }, description: 'Bullet point texts' },
        price: { type: 'number' as const, description: 'Listing price' },
        keywords: { type: 'array' as const, items: { type: 'string' as const }, description: 'Target keywords' },
        platform: { type: 'string' as const, enum: ['amazon', 'ebay', 'etsy', 'shopify', 'walmart'], description: 'Marketplace' },
      },
      required: ['title', 'description', 'image_count', 'price'] as const,
    },
  },
  {
    name: 'suggest_listing_improvements',
    description: 'AI-powered listing improvement suggestions with priority ranking, expected impact, and effort estimates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        listing_id: { type: 'string' as const, description: 'Listing ID' },
        title: { type: 'string' as const, description: 'Listing title' },
        description: { type: 'string' as const, description: 'Listing description' },
        image_count: { type: 'number' as const, description: 'Number of images' },
        bullet_points: { type: 'array' as const, items: { type: 'string' as const }, description: 'Bullet point texts' },
        price: { type: 'number' as const, description: 'Listing price' },
        keywords: { type: 'array' as const, items: { type: 'string' as const }, description: 'Target keywords' },
        platform: { type: 'string' as const, enum: ['amazon', 'ebay', 'etsy', 'shopify', 'walmart'], description: 'Marketplace' },
      },
      required: ['listing_id', 'title', 'description', 'image_count', 'price'] as const,
    },
  },
] as const;

// =============================================================================
// Handler
// =============================================================================

export function handleAdvancedListingTool(
  db: Database,
  toolName: string,
  input: Record<string, unknown>,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'generate_bullet_points': {
        const description = input.description as string;
        if (!description || typeof description !== 'string') return { success: false, error: 'description is required' };
        return { success: true, data: generateBulletPoints({ description, keywords: input.keywords as string[] | undefined, platform: input.platform as string | undefined, maxBullets: input.max_bullets as number | undefined }) };
      }
      case 'generate_a_plus_content': {
        const asin = input.asin as string;
        const brandName = input.brand_name as string;
        const productTitle = input.product_title as string;
        const description = input.description as string;
        const features = input.features as string[];
        if (!asin || !brandName || !productTitle || !description) return { success: false, error: 'asin, brand_name, product_title, and description are required' };
        if (!Array.isArray(features) || features.length === 0) return { success: false, error: 'features must be a non-empty array' };
        return { success: true, data: generateAPlusContent({ asin, brandName, productTitle, description, features, imageUrls: input.image_urls as string[] | undefined }) };
      }
      case 'optimize_title_keywords': {
        const currentTitle = input.current_title as string;
        const keywords = input.keywords as string[];
        if (!currentTitle) return { success: false, error: 'current_title is required' };
        if (!Array.isArray(keywords) || keywords.length === 0) return { success: false, error: 'keywords must be a non-empty array' };
        return { success: true, data: optimizeTitleKeywords({ currentTitle, keywords, platform: input.platform as string | undefined, brandName: input.brand_name as string | undefined }) };
      }
      case 'generate_product_description': {
        const title = input.title as string;
        const features = input.features as string[];
        if (!title) return { success: false, error: 'title is required' };
        if (!Array.isArray(features) || features.length === 0) return { success: false, error: 'features must be a non-empty array' };
        return { success: true, data: generateProductDescription({ title, features, keywords: input.keywords as string[] | undefined, platform: input.platform as string | undefined, tone: input.tone as 'professional' | 'casual' | 'luxury' | 'technical' | undefined }) };
      }
      case 'analyze_listing_quality': {
        const title = input.title as string;
        const description = input.description as string;
        const imageCount = input.image_count as number;
        const price = input.price as number;
        if (!title || !description) return { success: false, error: 'title and description are required' };
        if (typeof imageCount !== 'number' || !Number.isFinite(imageCount)) return { success: false, error: 'image_count must be a finite number' };
        if (typeof price !== 'number' || !Number.isFinite(price)) return { success: false, error: 'price must be a finite number' };
        return { success: true, data: analyzeListingQuality(db, { listingId: input.listing_id as string | undefined, title, description, imageCount, bulletPoints: input.bullet_points as string[] | undefined, price, keywords: input.keywords as string[] | undefined, platform: input.platform as string | undefined }) };
      }
      case 'suggest_listing_improvements': {
        const listingId = input.listing_id as string;
        const title = input.title as string;
        const description = input.description as string;
        const imageCount = input.image_count as number;
        const price = input.price as number;
        if (!listingId || !title || !description) return { success: false, error: 'listing_id, title, and description are required' };
        if (typeof imageCount !== 'number' || !Number.isFinite(imageCount)) return { success: false, error: 'image_count must be a finite number' };
        if (typeof price !== 'number' || !Number.isFinite(price)) return { success: false, error: 'price must be a finite number' };
        return { success: true, data: suggestListingImprovements(db, { listingId, title, description, imageCount, bulletPoints: input.bullet_points as string[] | undefined, price, keywords: input.keywords as string[] | undefined, platform: input.platform as string | undefined }) };
      }
      default:
        return { success: false, error: `Unknown advanced listing tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// =============================================================================
// Internal Helpers
// =============================================================================

function extractKeywords(text: string): string[] {
  const words = text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const freq = new Map<string, number>();
  for (const word of words) freq.set(word, (freq.get(word) ?? 0) + 1);
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([word]) => word).slice(0, 20);
}

function formatBullet(text: string): string {
  const words = text.split(/\s+/);
  if (words.length >= 4) {
    const leadCount = Math.min(4, Math.ceil(words.length * 0.2));
    const lead = words.slice(0, leadCount).join(' ').toUpperCase();
    const rest = words.slice(leadCount).join(' ');
    return `${lead} - ${rest}`;
  }
  return text;
}

function buildOpener(title: string, keywords: string[], tone: string): string {
  const kwText = keywords.slice(0, 2).join(' and ');
  switch (tone) {
    case 'luxury': return `Introducing the ${title} - an exquisite addition to your collection. Crafted with premium ${kwText}, this exceptional piece redefines quality and elegance.`;
    case 'casual': return `Check out the ${title}! Looking for quality ${kwText}? You have come to the right place.`;
    case 'technical': return `The ${title} features advanced ${kwText} technology, engineered for optimal performance and reliability.`;
    default: return `Discover the ${title} - designed to deliver outstanding ${kwText}. Whether a first-time buyer or seasoned professional, this product exceeds expectations.`;
  }
}

function expandFeature(feature: string, tone: string): string {
  const cleaned = feature.replace(/^[-*]\s*/, '').trim();
  switch (tone) {
    case 'luxury': return `Experience ${cleaned.toLowerCase()} - meticulously crafted to the highest standards of excellence.`;
    case 'casual': return `You will love the ${cleaned.toLowerCase()} - it makes a real difference in everyday use!`;
    case 'technical': return `Technical highlight: ${cleaned}. This ensures consistent performance under demanding conditions.`;
    default: return `${cleaned} - this feature provides tangible benefits, ensuring you get the most value from your purchase.`;
  }
}

function buildCloser(title: string, tone: string): string {
  switch (tone) {
    case 'luxury': return `The ${title} represents the pinnacle of design and craftsmanship. Order today and discover the difference that true luxury makes.`;
    case 'casual': return `Ready to try the ${title}? Order now and see why customers love it!`;
    case 'technical': return `For detailed specifications regarding the ${title}, refer to the technical documentation.`;
    default: return `Order the ${title} today with confidence. Backed by our quality guarantee, we are committed to your complete satisfaction.`;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function calculateReadability(text: string): number {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const syllables = words.reduce((sum, w) => sum + estimateSyllables(w), 0);
  if (sentences.length === 0 || words.length === 0) return 50;
  const score = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function estimateSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length <= 3) return 1;
  const count = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g)?.length ?? 1;
  return Math.max(1, count);
}

function scoreTitle(title: string, limits: { maxTitleChars: number }, keywords?: string[]): { score: number; maxScore: number; issues: string[] } {
  let score = 0;
  const maxScore = 25;
  const issues: string[] = [];

  if (title.length >= 40 && title.length <= limits.maxTitleChars) { score += 8; }
  else if (title.length < 40) { score += 3; issues.push(`Title is short (${title.length} chars). Aim for 40-${limits.maxTitleChars} chars.`); }
  else { score += 4; issues.push(`Title exceeds ${limits.maxTitleChars} char limit (${title.length} chars).`); }

  if (keywords && keywords.length > 0) {
    const titleLower = title.toLowerCase();
    const covered = keywords.filter((kw) => titleLower.includes(kw.toLowerCase())).length;
    score += Math.round((covered / keywords.length) * 10);
    if (covered / keywords.length < 0.5) issues.push(`Only ${covered}/${keywords.length} target keywords in title.`);
  } else { score += 5; }

  if (title === title.toUpperCase() && title.length > 5) { issues.push('Title is ALL CAPS. Use Title Case.'); } else { score += 3; }
  if (/[!@#$%^&*(){}[\]|\\]/.test(title)) { issues.push('Special characters may hurt search.'); } else { score += 2; }
  if (/\b(free shipping|buy now|limited time|sale)\b/i.test(title)) { issues.push('Promotional language violates policies.'); } else { score += 2; }

  return { score: Math.min(score, maxScore), maxScore, issues };
}

function scoreImages(imageCount: number, platform: string): { score: number; maxScore: number; issues: string[] } {
  const maxScore = 20;
  const issues: string[] = [];
  const idealCount = platform === 'amazon' ? 7 : 5;

  if (imageCount === 0) { issues.push('No images! Add at least 3-5 photos.'); return { score: 0, maxScore, issues }; }
  let score: number;
  if (imageCount >= idealCount) { score = 20; }
  else if (imageCount >= 3) { score = 10 + (imageCount - 3) * 2; issues.push(`${imageCount} images. Aim for ${idealCount}+.`); }
  else { score = imageCount * 4; issues.push(`Only ${imageCount} image(s). ${idealCount}+ see 30-40% higher conversion.`); }

  return { score: Math.min(score, maxScore), maxScore, issues };
}

function scoreDescription(description: string, _limits: { maxDescriptionChars: number }): { score: number; maxScore: number; issues: string[] } {
  let score = 0;
  const maxScore = 20;
  const issues: string[] = [];
  const wordCount = description.split(/\s+/).filter((w) => w.length > 0).length;

  if (wordCount < 50) { score += 3; issues.push(`Description very short (${wordCount} words). Aim for 150-300.`); }
  else if (wordCount < 150) { score += 8; issues.push(`Description adequate (${wordCount} words) but could be more detailed.`); }
  else if (wordCount <= 500) { score += 12; }
  else { score += 10; issues.push('Description very long. Consider being more concise.'); }

  if (/<[a-z][\s\S]*>/i.test(description)) { score += 3; } else { score += 1; if (description.length > 200) issues.push('Consider HTML formatting for readability.'); }

  const benefitWords = ['feature', 'benefit', 'quality', 'premium', 'durable', 'guarantee', 'warranty'];
  if (benefitWords.some((w) => description.toLowerCase().includes(w))) { score += 3; } else { issues.push('Add feature-benefit language.'); }

  const ctaWords = ['order', 'buy', 'add to cart', 'shop', 'get yours'];
  if (ctaWords.some((w) => description.toLowerCase().includes(w))) { score += 2; } else { issues.push('Add a call-to-action.'); }

  return { score: Math.min(score, maxScore), maxScore, issues };
}

function scoreKeywords(title: string, description: string, keywords: string[]): { score: number; maxScore: number; issues: string[] } {
  let score = 0;
  const maxScore = 15;
  const issues: string[] = [];
  if (keywords.length === 0) { return { score: 5, maxScore, issues: ['No target keywords specified.'] }; }

  const combinedText = `${title} ${description}`.toLowerCase();
  const inTitle = keywords.filter((kw) => title.toLowerCase().includes(kw.toLowerCase()));
  score += Math.round((inTitle.length / keywords.length) * 8);
  const inDesc = keywords.filter((kw) => description.toLowerCase().includes(kw.toLowerCase()));
  score += Math.round((inDesc.length / keywords.length) * 5);

  const totalWords = combinedText.split(/\s+/).length;
  const occurrences = keywords.reduce((sum, kw) => {
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    return sum + (combinedText.match(regex)?.length ?? 0);
  }, 0);
  const density = totalWords > 0 ? occurrences / totalWords : 0;
  if (density > 0.05) { issues.push('Keyword density too high (stuffing).'); score -= 2; }
  else if (density < 0.01) { issues.push('Keyword density very low.'); }
  else { score += 2; }

  const missing = keywords.filter((kw) => !combinedText.includes(kw.toLowerCase()));
  if (missing.length > 0) issues.push(`Missing keywords: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ' (+' + (missing.length - 5) + ' more)' : ''}`);

  return { score: Math.max(0, Math.min(score, maxScore)), maxScore, issues };
}

function scorePrice(db: Database, price: number): { score: number; maxScore: number; issues: string[] } {
  let score = 5;
  const maxScore = 10;
  const issues: string[] = [];
  if (price <= 0) { return { score: 0, maxScore, issues: ['Price must be greater than zero.'] }; }

  const cents = Math.round((price % 1) * 100);
  if (cents === 99 || cents === 95 || cents === 97) { score += 3; }
  else if (cents === 0) { score += 1; issues.push('Consider psychological pricing ($X.99).'); }
  else { score += 2; }

  try {
    const rows = db.query<{ avg_price: number; count: number }>(
      "SELECT AVG(price) as avg_price, COUNT(*) as count FROM listings WHERE status = 'active' AND price > 0"
    );
    if (rows.length > 0 && rows[0].count > 2) {
      const ratio = price / rows[0].avg_price;
      if (ratio > 2.0) issues.push(`Price ($${price}) significantly above average ($${round1(rows[0].avg_price)}).`);
      else if (ratio < 0.3) issues.push(`Price ($${price}) well below average ($${round1(rows[0].avg_price)}).`);
      else score += 2;
    }
  } catch { /* DB not available */ }

  return { score: Math.min(score, maxScore), maxScore, issues };
}

function scoreBulletPoints(bullets: string[], limits: { maxBullets: number }): { score: number; maxScore: number; issues: string[] } {
  const maxScore = 10;
  const issues: string[] = [];
  const idealCount = limits.maxBullets || 5;
  if (idealCount === 0) return { score: maxScore, maxScore, issues };
  if (bullets.length === 0) { issues.push(`No bullet points. Add ${idealCount}.`); return { score: 0, maxScore, issues }; }

  let score = 0;
  if (bullets.length >= idealCount) { score += 4; } else { score += Math.round((bullets.length / idealCount) * 4); issues.push(`Only ${bullets.length}/${idealCount} bullet points.`); }

  const avgLen = bullets.reduce((s, b) => s + b.length, 0) / bullets.length;
  if (avgLen < 30) { score += 1; issues.push('Bullets too short.'); }
  else if (avgLen > 400) { score += 2; issues.push('Bullets too long.'); }
  else { score += 3; }

  if (bullets.some((b) => /^[A-Z]{3,}/.test(b))) { score += 2; } else { score += 1; issues.push('Start bullets with CAPITALIZED key phrase.'); }

  const unique = new Set(bullets.map((b) => b.toLowerCase().trim()));
  if (unique.size < bullets.length) { issues.push('Duplicate bullets found.'); score -= 1; }

  return { score: Math.max(0, Math.min(score, maxScore)), maxScore, issues };
}

function round1(n: number): number { return Math.round(n * 10) / 10; }

export type {
  BulletPoint, BulletPointResult, APlusContent, APlusModule, TitleOptimization,
  ProductDescription, ListingQualityScore, ListingImprovement, ImprovementReport,
} from './advanced-types.js';
