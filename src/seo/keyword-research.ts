/**
 * Keyword/SEO Research - Analyze keywords, generate SEO titles, score listings
 *
 * Uses local product data + heuristic scoring to provide keyword research
 * without requiring external API calls. Derives keyword frequency and
 * competition density from existing listings in the database.
 *
 * Platform-specific rules:
 * - eBay: 80-char title, keyword stuffing works, item specifics matter
 * - Amazon: 200-char title, structured "Brand - Product - Feature", backend search terms
 * - Walmart: 75-char title, clean formatting, avoid special characters
 */

import { createLogger } from '../utils/logger';
import type { Database } from '../db/index';
import type {
  KeywordAnalysis,
  KeywordEntry,
  SeoSuggestion,
  SearchTerms,
  SeoScore,
  SeoIssue,
  PlatformSeoRules,
} from './types';

const logger = createLogger('seo');

// ---------------------------------------------------------------------------
// Platform-specific SEO rules
// ---------------------------------------------------------------------------

const PLATFORM_RULES: Record<string, PlatformSeoRules> = {
  ebay: {
    maxTitleLength: 80,
    maxDescriptionLength: 4000,
    maxBulletPoints: 0, // eBay uses item specifics, not bullets
    maxSearchTermBytes: 0, // No backend search terms
    titleSeparator: ' ',
    avoidWords: ['free shipping', 'l@@k', 'wow', 'amazing deal', 'must see', 'best price'],
    preferredFormat: 'keyword-rich, front-load important terms',
  },
  amazon: {
    maxTitleLength: 200,
    maxDescriptionLength: 2000,
    maxBulletPoints: 5,
    maxSearchTermBytes: 250,
    titleSeparator: ' - ',
    avoidWords: ['best', 'top rated', 'sale', 'cheap', 'free shipping', 'promotion'],
    preferredFormat: 'Brand - Product Name - Key Feature - Size/Color/Qty',
  },
  walmart: {
    maxTitleLength: 75,
    maxDescriptionLength: 4000,
    maxBulletPoints: 10,
    maxSearchTermBytes: 0,
    titleSeparator: ', ',
    avoidWords: ['best', 'top', 'cheap', '#1', 'amazing', 'incredible'],
    preferredFormat: 'Brand + Product Type + Key Attribute + Size/Count',
  },
};

// ---------------------------------------------------------------------------
// Stop words (shared with listing/creator.ts but defined here for independence)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'this', 'that', 'are', 'was',
  'be', 'has', 'had', 'have', 'not', 'no', 'do', 'does', 'did', 'will',
  'can', 'may', 'so', 'if', 'as', 'up', 'out', 'its', 'our', 'your',
  'their', 'we', 'you', 'he', 'she', 'they', 'my', 'me', 'us', 'him',
  'her', 'who', 'which', 'what', 'when', 'where', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'some', 'any', 'such', 'than',
  'too', 'very', 'just', 'about', 'also', 'then', 'into', 'over', 'only',
  'new', 'used', 'set', 'pack',
]);

const ALWAYS_UPPER = new Set([
  'usb', 'led', 'lcd', 'hd', 'uhd', 'hdmi', 'wifi', 'nfc', 'gps', 'rgb',
  'ac', 'dc', 'uk', 'us', 'eu', 'diy', 'pc', 'tv', 'dvd', 'cd', 'io',
  'xl', 'xxl', 'xs', 'sm', 'md', 'lg', 'oz', 'lb', 'kg', 'ml', 'mm',
  'cm', 'ft', 'qt', 'aaa', 'aa', 'am', 'fm', 'ip', 'hdr',
]);

// ---------------------------------------------------------------------------
// Keyword extraction
// ---------------------------------------------------------------------------

/**
 * Extract meaningful keywords from text, removing stop words and deduplicating.
 */
function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const word of words) {
    if (!seen.has(word)) {
      seen.add(word);
      unique.push(word);
    }
  }

  return unique;
}

/**
 * Extract 2-word and 3-word phrases (n-grams) from text.
 */
function extractPhrases(text: string, maxN: number = 3): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const phrases: string[] = [];

  for (let n = 2; n <= maxN; n++) {
    for (let i = 0; i <= words.length - n; i++) {
      const phrase = words.slice(i, i + n).join(' ');
      // Skip if all words are stop words
      const meaningful = words.slice(i, i + n).filter((w) => !STOP_WORDS.has(w));
      if (meaningful.length >= Math.ceil(n / 2)) {
        phrases.push(phrase);
      }
    }
  }

  return phrases;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Analyze keywords for a given query by looking at existing product data in the database.
 * Scores keywords by frequency across listings and specificity.
 */
export function analyzeKeywords(
  query: string,
  db: Database,
  platform: string = 'ebay',
): KeywordAnalysis {
  logger.info({ query, platform }, 'Analyzing keywords');

  // Search for related products in DB
  const products = db.query<Record<string, unknown>>(
    `SELECT title, brand, category FROM products
     WHERE title LIKE ? OR category LIKE ?
     ORDER BY updated_at DESC LIMIT 200`,
    [`%${query}%`, `%${query}%`],
  );

  // Also check listings for additional keyword data
  const listings = db.query<Record<string, unknown>>(
    `SELECT title FROM listings
     WHERE title LIKE ?
     ORDER BY created_at DESC LIMIT 200`,
    [`%${query}%`],
  );

  // Combine all titles for analysis
  const allTitles = [
    ...products.map((p) => p.title as string).filter(Boolean),
    ...listings.map((l) => l.title as string).filter(Boolean),
  ];

  // Count keyword frequency across all titles
  const keywordCounts = new Map<string, number>();
  const phraseCountsMap = new Map<string, number>();

  for (const title of allTitles) {
    const words = extractKeywords(title);
    for (const word of words) {
      keywordCounts.set(word, (keywordCounts.get(word) ?? 0) + 1);
    }

    const phrases = extractPhrases(title, 3);
    for (const phrase of phrases) {
      phraseCountsMap.set(phrase, (phraseCountsMap.get(phrase) ?? 0) + 1);
    }
  }

  // Also extract keywords from the query itself
  const queryKeywords = extractKeywords(query);
  for (const kw of queryKeywords) {
    if (!keywordCounts.has(kw)) {
      keywordCounts.set(kw, 0);
    }
  }

  // Score keywords
  const maxFreq = Math.max(1, ...keywordCounts.values());
  const keywords: KeywordEntry[] = [];

  for (const [keyword, frequency] of keywordCounts.entries()) {
    // Score based on: frequency (40%), word length/specificity (30%), relevance to query (30%)
    const freqScore = (frequency / maxFreq) * 40;
    const lengthScore = Math.min(keyword.length / 10, 1) * 30;
    const relevanceScore = queryKeywords.includes(keyword) ? 30 : 0;
    const score = Math.round(freqScore + lengthScore + relevanceScore);

    keywords.push({
      keyword,
      frequency,
      score: Math.min(100, score),
      inTopListings: frequency >= Math.ceil(maxFreq * 0.5),
    });
  }

  // Sort by score descending
  keywords.sort((a, b) => b.score - a.score);

  // Generate suggestions from high-frequency phrases
  const suggestions: string[] = [];
  const sortedPhrases = [...phraseCountsMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  for (const [phrase, count] of sortedPhrases) {
    if (count >= 2) {
      suggestions.push(phrase);
    }
  }

  // Compute average title length
  const avgTitleLength =
    allTitles.length > 0
      ? Math.round(allTitles.reduce((sum, t) => sum + t.length, 0) / allTitles.length)
      : 0;

  // Top brands
  const brandCounts = new Map<string, number>();
  for (const p of products) {
    const brand = p.brand as string | null;
    if (brand) {
      brandCounts.set(brand, (brandCounts.get(brand) ?? 0) + 1);
    }
  }
  const topBrands = [...brandCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([brand]) => brand);

  return {
    query,
    platform,
    keywords: keywords.slice(0, 50),
    suggestions,
    totalProducts: allTitles.length,
    avgTitleLength,
    topBrands,
  };
}

/**
 * Generate a platform-specific SEO-optimized title.
 */
export function generateSeoTitle(
  currentTitle: string,
  platform: string = 'ebay',
  options?: { brand?: string; category?: string; productId?: string },
): string {
  const rules = PLATFORM_RULES[platform] ?? PLATFORM_RULES.ebay;
  const maxLen = rules.maxTitleLength;

  // Extract meaningful keywords from the current title
  const keywords = extractKeywords(currentTitle);

  // Capitalize properly
  const capitalize = (word: string): string => {
    const lower = word.toLowerCase();
    if (ALWAYS_UPPER.has(lower)) return lower.toUpperCase();
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  };

  const parts: string[] = [];

  // Brand first (Amazon and Walmart best practice)
  if (options?.brand && (platform === 'amazon' || platform === 'walmart')) {
    parts.push(options.brand.trim());
  }

  // Main product name - capitalize each word
  const mainTitle = currentTitle
    .replace(/\s+/g, ' ')
    .trim()
    .split(/\s+/)
    .map(capitalize)
    .join(' ');

  parts.push(mainTitle);

  // Category hint at the end for eBay
  if (
    platform === 'ebay' &&
    options?.category &&
    !currentTitle.toLowerCase().includes(options.category.toLowerCase())
  ) {
    parts.push(options.category.trim());
  }

  let title = parts.join(rules.titleSeparator);

  // Check for platform-forbidden words
  const lowerTitle = title.toLowerCase();
  for (const avoid of rules.avoidWords) {
    if (lowerTitle.includes(avoid)) {
      title = title.replace(new RegExp(avoid, 'gi'), '').replace(/\s+/g, ' ').trim();
    }
  }

  // Trim to max length at word boundary
  if (title.length > maxLen) {
    title = title.slice(0, maxLen);
    const lastSpace = title.lastIndexOf(' ');
    if (lastSpace > maxLen * 0.6) {
      title = title.slice(0, lastSpace);
    }
  }

  return title.trim();
}

/**
 * Suggest backend search terms for Amazon listings.
 * Returns terms NOT already in the title (Amazon prohibits duplication).
 */
export function suggestSearchTerms(
  title: string,
  description?: string,
  db?: Database,
  category?: string,
): SearchTerms {
  const titleKeywords = new Set(
    title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean),
  );

  // Gather extra keywords from description
  const descKeywords = description ? extractKeywords(description) : [];

  // Gather keywords from similar products in DB
  let dbKeywords: string[] = [];
  if (db && category) {
    try {
      const similar = db.query<Record<string, unknown>>(
        'SELECT title FROM products WHERE category = ? LIMIT 50',
        [category],
      );
      const allText = similar.map((r) => r.title as string).filter(Boolean).join(' ');
      dbKeywords = extractKeywords(allText);
    } catch {
      // DB query failed, skip
    }
  }

  // Combine and deduplicate, excluding title words
  const allExtras = [...new Set([...descKeywords, ...dbKeywords])].filter(
    (kw) => !titleKeywords.has(kw),
  );

  // Classify into primary, secondary, and long-tail
  const primary = allExtras.filter((kw) => kw.length >= 4).slice(0, 15);
  const secondary = allExtras.filter((kw) => kw.length >= 3 && !primary.includes(kw)).slice(0, 15);

  // Generate long-tail phrases from description
  const longTailPhrases = description ? extractPhrases(description, 3) : [];
  const longTail = longTailPhrases
    .filter((phrase) => {
      const words = phrase.split(' ');
      return words.some((w) => !titleKeywords.has(w));
    })
    .slice(0, 10);

  // Amazon backend search terms (max 250 bytes)
  const allTerms = [...primary, ...secondary].join(' ');
  const backendTerms = allTerms.length <= 250 ? allTerms : allTerms.slice(0, 250).replace(/\s\S*$/, '');

  return {
    primary,
    secondary,
    longTail,
    backendTerms: backendTerms || undefined,
  };
}

/**
 * Score and analyze the SEO quality of a listing.
 */
export function analyzeListingSeo(
  title: string,
  description?: string,
  platform: string = 'ebay',
  category?: string,
): SeoScore {
  const rules = PLATFORM_RULES[platform] ?? PLATFORM_RULES.ebay;
  const issues: SeoIssue[] = [];
  const suggestions: SeoSuggestion[] = [];

  // ---------------------------------------------------------------------------
  // Title scoring
  // ---------------------------------------------------------------------------
  let titleScore = 100;

  // Length check
  if (title.length === 0) {
    titleScore = 0;
    issues.push({ severity: 'error', field: 'title', message: 'Title is empty' });
  } else if (title.length > rules.maxTitleLength) {
    titleScore -= 20;
    issues.push({
      severity: 'error',
      field: 'title',
      message: `Title exceeds ${rules.maxTitleLength} character limit (${title.length} chars)`,
    });
    suggestions.push({
      type: 'title',
      current: title,
      suggested: title.slice(0, rules.maxTitleLength),
      reason: `${platform} titles must be under ${rules.maxTitleLength} characters`,
      impact: 'high',
    });
  } else if (title.length < 30) {
    titleScore -= 15;
    issues.push({
      severity: 'warning',
      field: 'title',
      message: 'Title is too short. Longer titles with more keywords typically rank better.',
    });
  }

  // Under-utilization of title space
  if (title.length > 0 && title.length < rules.maxTitleLength * 0.5) {
    titleScore -= 10;
    issues.push({
      severity: 'info',
      field: 'title',
      message: `Title uses only ${Math.round((title.length / rules.maxTitleLength) * 100)}% of available space. Add more keywords.`,
    });
  }

  // All caps check
  if (title === title.toUpperCase() && title.length > 10) {
    titleScore -= 15;
    issues.push({
      severity: 'warning',
      field: 'title',
      message: 'Title is all uppercase. Use proper capitalization for better readability.',
    });
  }

  // Forbidden words check
  const lowerTitle = title.toLowerCase();
  for (const avoid of rules.avoidWords) {
    if (lowerTitle.includes(avoid)) {
      titleScore -= 10;
      issues.push({
        severity: 'warning',
        field: 'title',
        message: `Title contains "${avoid}" which is discouraged on ${platform}`,
      });
    }
  }

  // Keyword variety
  const titleKeywords = extractKeywords(title);
  if (titleKeywords.length < 3 && title.length > 20) {
    titleScore -= 10;
    issues.push({
      severity: 'info',
      field: 'title',
      message: 'Title has few unique keywords. Consider adding more product-specific terms.',
    });
  }

  titleScore = Math.max(0, Math.min(100, titleScore));

  // ---------------------------------------------------------------------------
  // Description scoring
  // ---------------------------------------------------------------------------
  let descriptionScore = 100;

  if (!description || description.trim().length === 0) {
    descriptionScore = 0;
    issues.push({
      severity: 'error',
      field: 'description',
      message: 'No description provided. Descriptions significantly improve search ranking.',
    });
  } else {
    if (description.length < 50) {
      descriptionScore -= 30;
      issues.push({
        severity: 'warning',
        field: 'description',
        message: 'Description is very short. Aim for at least 150-300 characters.',
      });
    } else if (description.length < 150) {
      descriptionScore -= 15;
      issues.push({
        severity: 'info',
        field: 'description',
        message: 'Description could be longer. More detailed descriptions rank better.',
      });
    }

    if (description.length > rules.maxDescriptionLength) {
      descriptionScore -= 10;
      issues.push({
        severity: 'warning',
        field: 'description',
        message: `Description exceeds ${rules.maxDescriptionLength} character limit`,
      });
    }
  }

  descriptionScore = Math.max(0, Math.min(100, descriptionScore));

  // ---------------------------------------------------------------------------
  // Keyword density
  // ---------------------------------------------------------------------------
  const allText = `${title} ${description ?? ''}`.toLowerCase();
  const allWords = allText.split(/\s+/).filter((w) => w.length > 1);
  const meaningfulWords = allWords.filter((w) => !STOP_WORDS.has(w));
  const keywordDensity =
    allWords.length > 0 ? Math.round((meaningfulWords.length / allWords.length) * 100) : 0;

  if (keywordDensity > 80) {
    issues.push({
      severity: 'warning',
      field: 'keywords',
      message: 'Keyword density is very high. May appear spammy to search algorithms.',
    });
  } else if (keywordDensity < 30) {
    issues.push({
      severity: 'info',
      field: 'keywords',
      message: 'Keyword density is low. Consider incorporating more product-relevant terms.',
    });
  }

  // ---------------------------------------------------------------------------
  // Readability
  // ---------------------------------------------------------------------------
  let readability = 100;

  // Check for excessive special characters
  const specialCharCount = (title.match(/[!@#$%^&*(){}|\\<>]/g) ?? []).length;
  if (specialCharCount > 3) {
    readability -= 20;
    issues.push({
      severity: 'warning',
      field: 'title',
      message: 'Too many special characters in title. Keep it clean and readable.',
    });
  }

  // Sentence structure in description
  if (description) {
    const sentences = description.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    const avgSentenceLength =
      sentences.length > 0
        ? sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0) / sentences.length
        : 0;

    if (avgSentenceLength > 30) {
      readability -= 15;
      issues.push({
        severity: 'info',
        field: 'description',
        message: 'Sentences are very long. Shorter sentences improve readability.',
      });
    }
  }

  readability = Math.max(0, Math.min(100, readability));

  // ---------------------------------------------------------------------------
  // Overall score
  // ---------------------------------------------------------------------------
  const overall = Math.round(
    titleScore * 0.4 + descriptionScore * 0.3 + keywordDensity * 0.15 + readability * 0.15,
  );

  return {
    overall: Math.min(100, overall),
    titleScore,
    descriptionScore,
    keywordDensity,
    readability,
    issues,
    suggestions,
  };
}
