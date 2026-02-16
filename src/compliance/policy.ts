/**
 * Marketplace Policy Compliance Checking Module
 */

const BANNED_KEYWORDS: Record<string, Array<{ keyword: string; reason: string; severity: 'error' | 'warning' }>> = {
  amazon: [
    { keyword: 'msrp', reason: 'Cannot reference MSRP on Amazon', severity: 'error' },
    { keyword: 'retail price', reason: 'Price references not allowed in listings', severity: 'error' },
    { keyword: 'on sale', reason: 'Sale claims not allowed in title/description', severity: 'warning' },
    { keyword: 'free shipping', reason: 'Shipping claims should use Amazon settings', severity: 'warning' },
    { keyword: 'best seller', reason: 'Unverified claim', severity: 'warning' },
    { keyword: '#1', reason: 'Ranking claims require substantiation', severity: 'warning' },
    { keyword: 'fda approved', reason: 'FDA claims require verification', severity: 'error' },
    { keyword: 'cure', reason: 'Medical claims not allowed', severity: 'error' },
    { keyword: 'weight loss', reason: 'Health claims require substantiation', severity: 'warning' },
    { keyword: 'guaranteed', reason: 'Guarantee claims need specifics', severity: 'warning' },
  ],
  ebay: [
    { keyword: '100% authentic', reason: 'Authenticity claims need eBay Authenticity Guarantee', severity: 'warning' },
    { keyword: 'keyword', reason: 'Keyword spam detected', severity: 'error' },
    { keyword: 'look!!', reason: 'Excessive punctuation/caps is keyword spam', severity: 'warning' },
    { keyword: 'wow!!', reason: 'Excessive punctuation/caps', severity: 'warning' },
    { keyword: 'l@@k', reason: 'Keyword spam characters', severity: 'error' },
    { keyword: 'fda approved', reason: 'FDA claims require verification', severity: 'error' },
  ],
  walmart: [
    { keyword: 'compared to', reason: 'Comparative claims need evidence', severity: 'warning' },
    { keyword: 'better than', reason: 'Comparative claims need evidence', severity: 'warning' },
    { keyword: 'best price', reason: 'Price claims not verifiable', severity: 'warning' },
    { keyword: 'fda approved', reason: 'FDA claims require verification', severity: 'error' },
  ],
};

const RESTRICTED_PRODUCT_KEYWORDS = [
  { keyword: 'firearm', reason: 'Weapons prohibited', severity: 'error' as const },
  { keyword: 'ammunition', reason: 'Weapons prohibited', severity: 'error' as const },
  { keyword: 'switchblade', reason: 'Weapons prohibited', severity: 'error' as const },
  { keyword: 'brass knuckles', reason: 'Weapons prohibited', severity: 'error' as const },
  { keyword: 'drug paraphernalia', reason: 'Drug items prohibited', severity: 'error' as const },
  { keyword: 'recalled', reason: 'Recalled products cannot be sold', severity: 'error' as const },
  { keyword: 'counterfeit', reason: 'Counterfeit items prohibited', severity: 'error' as const },
  { keyword: 'replica', reason: 'Replicas of branded goods prohibited', severity: 'warning' as const },
  { keyword: 'knockoff', reason: 'Counterfeit items prohibited', severity: 'error' as const },
  { keyword: 'ivory', reason: 'Wildlife products prohibited', severity: 'error' as const },
  { keyword: 'human remains', reason: 'Prohibited item', severity: 'error' as const },
  { keyword: 'pesticide', reason: 'Requires EPA registration', severity: 'warning' as const },
  { keyword: 'flammable', reason: 'Hazmat shipping restrictions', severity: 'warning' as const },
  { keyword: 'lithium battery', reason: 'Hazmat shipping restrictions', severity: 'warning' as const },
  { keyword: 'aerosol', reason: 'Hazmat shipping restrictions', severity: 'warning' as const },
];

const PLATFORM_TITLE_LIMITS: Record<string, number> = {
  amazon: 200, ebay: 80, walmart: 75,
};

const PLATFORM_IMAGE_REQUIREMENTS: Record<string, { min_images: number; min_dimension: number; white_background: boolean }> = {
  amazon: { min_images: 1, min_dimension: 1000, white_background: true },
  ebay: { min_images: 1, min_dimension: 500, white_background: false },
  walmart: { min_images: 1, min_dimension: 600, white_background: true },
};

export const complianceTools = [
  {
    name: 'check_listing_compliance',
    description: 'Check a listing for marketplace policy violations',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const },
        description: { type: 'string' as const },
        category: { type: 'string' as const },
        platform: { type: 'string' as const, enum: ['amazon', 'ebay', 'walmart'] },
        price: { type: 'number' as const },
        images_count: { type: 'number' as const },
      },
      required: ['title', 'platform'],
    },
  },
  {
    name: 'check_product_restrictions',
    description: 'Check if a product is restricted or prohibited on marketplaces',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string' as const },
        category: { type: 'string' as const },
        description: { type: 'string' as const },
      },
      required: ['title'],
    },
  },
  {
    name: 'validate_images',
    description: 'Validate product images meet platform requirements',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: { type: 'string' as const },
        image_count: { type: 'number' as const },
        has_white_background: { type: 'boolean' as const },
        min_dimension: { type: 'number' as const },
      },
      required: ['platform', 'image_count'],
    },
  },
  {
    name: 'banned_keywords_check',
    description: 'Check text against platform-specific banned keyword lists',
    input_schema: {
      type: 'object' as const,
      properties: {
        text: { type: 'string' as const },
        platform: { type: 'string' as const, enum: ['amazon', 'ebay', 'walmart'] },
      },
      required: ['text', 'platform'],
    },
  },
];

export function handleComplianceTool(
  _db: unknown,
  toolName: string,
  input: Record<string, unknown>,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'check_listing_compliance': {
        const title = input.title as string;
        const description = (input.description as string) ?? '';
        const platform = (input.platform as string) ?? 'amazon';
        const price = input.price as number | undefined;
        const imageCount = input.images_count as number | undefined;
        if (!title) return { success: false, error: 'title required' };

        const violations: Array<{ severity: string; rule: string; detail: string }> = [];
        const warnings: Array<{ severity: string; rule: string; detail: string }> = [];
        const combined = `${title} ${description}`.toLowerCase();

        // Title length check
        const maxLen = PLATFORM_TITLE_LIMITS[platform] ?? 200;
        if (title.length > maxLen) {
          violations.push({ severity: 'error', rule: 'title_length', detail: `Title exceeds ${maxLen} char limit (${title.length})` });
        }

        // Banned keywords
        const keywords = BANNED_KEYWORDS[platform] ?? [];
        for (const kw of keywords) {
          if (combined.includes(kw.keyword.toLowerCase())) {
            const entry = { severity: kw.severity, rule: 'banned_keyword', detail: `"${kw.keyword}": ${kw.reason}` };
            if (kw.severity === 'error') violations.push(entry);
            else warnings.push(entry);
          }
        }

        // ALL CAPS check
        if (title === title.toUpperCase() && title.length > 5) {
          warnings.push({ severity: 'warning', rule: 'all_caps', detail: 'Title is all caps - against most platform policies' });
        }

        // Price check (potential price gouging)
        if (price != null && price > 999) {
          warnings.push({ severity: 'warning', rule: 'high_price', detail: 'High price may trigger review' });
        }

        // Image check
        const imgReq = PLATFORM_IMAGE_REQUIREMENTS[platform];
        if (imgReq && imageCount != null && imageCount < imgReq.min_images) {
          violations.push({ severity: 'error', rule: 'insufficient_images', detail: `Need at least ${imgReq.min_images} image(s)` });
        }

        const score = Math.max(0, 100 - violations.length * 25 - warnings.length * 5);
        return { success: true, data: { platform, score, violations, warnings, pass: violations.length === 0 } };
      }

      case 'check_product_restrictions': {
        const title = input.title as string;
        const desc = (input.description as string) ?? '';
        if (!title) return { success: false, error: 'title required' };
        const combined = `${title} ${desc}`.toLowerCase();

        const matches: Array<{ keyword: string; reason: string; severity: string }> = [];
        for (const r of RESTRICTED_PRODUCT_KEYWORDS) {
          if (combined.includes(r.keyword.toLowerCase())) {
            matches.push({ keyword: r.keyword, reason: r.reason, severity: r.severity });
          }
        }

        const hasErrors = matches.some((m) => m.severity === 'error');
        return {
          success: true,
          data: {
            restricted: hasErrors,
            matches,
            recommendation: hasErrors ? 'DO NOT LIST - product is restricted/prohibited' : matches.length > 0 ? 'CAUTION - review restrictions before listing' : 'CLEAR - no restrictions detected',
          },
        };
      }

      case 'validate_images': {
        const platform = (input.platform as string) ?? 'amazon';
        const count = input.image_count as number;
        const hasWhiteBg = (input.has_white_background as boolean) ?? false;
        const minDim = (input.min_dimension as number) ?? 0;

        const req = PLATFORM_IMAGE_REQUIREMENTS[platform] ?? PLATFORM_IMAGE_REQUIREMENTS.amazon;
        const issues: string[] = [];

        if (count < req.min_images) issues.push(`Need at least ${req.min_images} image(s), have ${count}`);
        if (req.white_background && !hasWhiteBg) issues.push('Main image requires white background');
        if (minDim > 0 && minDim < req.min_dimension) issues.push(`Images must be at least ${req.min_dimension}px, have ${minDim}px`);

        return { success: true, data: { platform, pass: issues.length === 0, issues, requirements: req } };
      }

      case 'banned_keywords_check': {
        const text = input.text as string;
        const platform = (input.platform as string) ?? 'amazon';
        if (!text) return { success: false, error: 'text required' };
        const lower = text.toLowerCase();

        const keywords = BANNED_KEYWORDS[platform] ?? [];
        const matches = keywords.filter((kw) => lower.includes(kw.keyword.toLowerCase()));
        return { success: true, data: { platform, text_length: text.length, matches, clean: matches.length === 0 } };
      }

      default:
        return { success: false, error: `Unknown compliance tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
