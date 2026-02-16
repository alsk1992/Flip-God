/**
 * Keyword/SEO Research - Tool definitions and handler
 *
 * Exports tool definitions array and handler function for integration
 * into the agent tool system.
 */

import { createLogger } from '../utils/logger';
import type { Database } from '../db/index';
import {
  analyzeKeywords,
  generateSeoTitle,
  suggestSearchTerms,
  analyzeListingSeo,
} from './keyword-research';

const logger = createLogger('seo');

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const seoTools = [
  {
    name: 'keyword_research',
    description: 'Research keywords for product listings and SEO optimization',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string' as const,
          description: 'Product name or category to research',
        },
        platform: {
          type: 'string' as const,
          enum: ['ebay', 'amazon', 'walmart'],
          description: 'Target platform for keyword optimization',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'optimize_title_seo',
    description: 'Generate SEO-optimized listing title',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: {
          type: 'string' as const,
          description: 'Product ID to look up from database',
        },
        platform: {
          type: 'string' as const,
          enum: ['ebay', 'amazon', 'walmart'],
          description: 'Target platform',
        },
        current_title: {
          type: 'string' as const,
          description: 'Current listing title to optimize',
        },
      },
      required: ['current_title'],
    },
  },
  {
    name: 'analyze_listing_seo',
    description: 'Score and analyze SEO quality of an existing listing',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string' as const,
          description: 'Listing title to analyze',
        },
        description: {
          type: 'string' as const,
          description: 'Listing description',
        },
        platform: {
          type: 'string' as const,
          enum: ['ebay', 'amazon', 'walmart'],
          description: 'Platform to score against',
        },
        category: {
          type: 'string' as const,
          description: 'Product category for context',
        },
      },
      required: ['title'],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleSeoTool(
  name: string,
  input: Record<string, unknown>,
  db: Database,
): Promise<Record<string, unknown>> {
  switch (name) {
    case 'keyword_research': {
      const query = input.query as string;
      if (!query || query.trim().length === 0) {
        return { error: 'query is required' };
      }

      const platform = (input.platform as string) ?? 'ebay';

      logger.info({ query, platform }, 'Running keyword research');

      try {
        const analysis = analyzeKeywords(query, db, platform);

        return {
          success: true,
          query: analysis.query,
          platform: analysis.platform,
          totalProductsAnalyzed: analysis.totalProducts,
          avgTitleLength: analysis.avgTitleLength,
          topBrands: analysis.topBrands,
          topKeywords: analysis.keywords.slice(0, 20).map((k) => ({
            keyword: k.keyword,
            frequency: k.frequency,
            score: k.score,
            inTopListings: k.inTopListings,
          })),
          suggestedPhrases: analysis.suggestions,
          tip:
            analysis.totalProducts === 0
              ? 'No existing products match this query. Import some products first for better keyword analysis.'
              : `Analyzed ${analysis.totalProducts} products. Top keywords are scored by frequency and relevance.`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ query, error: msg }, 'Keyword research failed');
        return { success: false, error: msg };
      }
    }

    case 'optimize_title_seo': {
      const currentTitle = input.current_title as string;
      if (!currentTitle || currentTitle.trim().length === 0) {
        return { error: 'current_title is required' };
      }

      const platform = (input.platform as string) ?? 'ebay';
      const productId = input.product_id as string | undefined;

      // Look up product for brand/category context
      let brand: string | undefined;
      let category: string | undefined;

      if (productId) {
        try {
          const product = db.getProduct(productId);
          if (product) {
            brand = product.brand;
            category = product.category;
          }
        } catch {
          // Product lookup failed, proceed without context
        }
      }

      logger.info({ platform, titleLength: currentTitle.length }, 'Optimizing title SEO');

      try {
        const optimizedTitle = generateSeoTitle(currentTitle, platform, {
          brand,
          category,
          productId,
        });

        // Also generate search terms for Amazon
        const searchTerms =
          platform === 'amazon'
            ? suggestSearchTerms(optimizedTitle, undefined, db, category)
            : undefined;

        // Score both titles for comparison
        const originalScore = analyzeListingSeo(currentTitle, undefined, platform, category);
        const optimizedScore = analyzeListingSeo(optimizedTitle, undefined, platform, category);

        return {
          success: true,
          platform,
          original: {
            title: currentTitle,
            length: currentTitle.length,
            score: originalScore.titleScore,
          },
          optimized: {
            title: optimizedTitle,
            length: optimizedTitle.length,
            score: optimizedScore.titleScore,
          },
          improvement: optimizedScore.titleScore - originalScore.titleScore,
          searchTerms: searchTerms
            ? {
                primary: searchTerms.primary,
                secondary: searchTerms.secondary,
                backendTerms: searchTerms.backendTerms,
              }
            : undefined,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ error: msg }, 'Title optimization failed');
        return { success: false, error: msg };
      }
    }

    case 'analyze_listing_seo': {
      const title = input.title as string;
      if (!title || title.trim().length === 0) {
        return { error: 'title is required' };
      }

      const description = input.description as string | undefined;
      const platform = (input.platform as string) ?? 'ebay';
      const category = input.category as string | undefined;

      logger.info({ platform, titleLength: title.length }, 'Analyzing listing SEO');

      try {
        const score = analyzeListingSeo(title, description, platform, category);

        return {
          success: true,
          platform,
          scores: {
            overall: score.overall,
            title: score.titleScore,
            description: score.descriptionScore,
            keywordDensity: score.keywordDensity,
            readability: score.readability,
          },
          grade:
            score.overall >= 80
              ? 'A'
              : score.overall >= 60
                ? 'B'
                : score.overall >= 40
                  ? 'C'
                  : score.overall >= 20
                    ? 'D'
                    : 'F',
          issues: score.issues.map((i) => ({
            severity: i.severity,
            field: i.field,
            message: i.message,
          })),
          suggestions: score.suggestions.map((s) => ({
            type: s.type,
            suggested: s.suggested,
            reason: s.reason,
            impact: s.impact,
          })),
          errorCount: score.issues.filter((i) => i.severity === 'error').length,
          warningCount: score.issues.filter((i) => i.severity === 'warning').length,
          infoCount: score.issues.filter((i) => i.severity === 'info').length,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ error: msg }, 'SEO analysis failed');
        return { success: false, error: msg };
      }
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// Re-export core functions for direct usage
export {
  analyzeKeywords,
  generateSeoTitle,
  suggestSearchTerms,
  analyzeListingSeo,
} from './keyword-research';
export type {
  KeywordAnalysis,
  KeywordEntry,
  SeoSuggestion,
  SearchTerms,
  SeoScore,
  SeoIssue,
  PlatformSeoRules,
} from './types';
