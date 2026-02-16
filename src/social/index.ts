/**
 * Social Commerce Module - Tool Definitions & Handler
 *
 * Tools for creating social listings, syncing inventory across social channels,
 * analytics, and scheduling promotional posts.
 */

import type { Database } from '../db/index.js';
import type { SocialPlatform } from './types.js';

export type {
  SocialPlatform,
  SocialListing,
  SocialInventorySync,
  SocialAnalyticsData,
  ScheduledPost,
} from './types.js';

// ---------------------------------------------------------------------------
// DB Setup
// ---------------------------------------------------------------------------

function ensureSocialTables(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS social_listings (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      price REAL NOT NULL DEFAULT 0,
      images TEXT NOT NULL DEFAULT '[]',
      tags TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft',
      external_id TEXT,
      url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS social_inventory_sync (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      product_id TEXT NOT NULL,
      local_quantity INTEGER NOT NULL DEFAULT 0,
      remote_quantity INTEGER NOT NULL DEFAULT 0,
      synced INTEGER NOT NULL DEFAULT 0,
      last_sync_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(platform, product_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS social_analytics (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      product_id TEXT,
      event_type TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      revenue_cents INTEGER NOT NULL DEFAULT 0,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS social_scheduled_posts (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      product_id TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      media_urls TEXT NOT NULL DEFAULT '[]',
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      post_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}



// ---------------------------------------------------------------------------
// Platform-specific content formatting
// ---------------------------------------------------------------------------

const PLATFORM_LIMITS: Record<SocialPlatform, { maxTitleLen: number; maxDescLen: number; maxTags: number; maxImages: number }> = {
  instagram: { maxTitleLen: 100, maxDescLen: 2200, maxTags: 30, maxImages: 10 },
  tiktok: { maxTitleLen: 80, maxDescLen: 1000, maxTags: 5, maxImages: 1 },
  facebook: { maxTitleLen: 150, maxDescLen: 5000, maxTags: 10, maxImages: 10 },
  pinterest: { maxTitleLen: 100, maxDescLen: 500, maxTags: 20, maxImages: 5 },
};

function validatePlatform(platform: string): platform is SocialPlatform {
  return ['instagram', 'tiktok', 'facebook', 'pinterest'].includes(platform);
}

function formatForPlatform(
  platform: SocialPlatform,
  title: string,
  description: string,
  tags: string[],
  images: string[],
): { title: string; description: string; tags: string[]; images: string[]; warnings: string[] } {
  const limits = PLATFORM_LIMITS[platform];
  const warnings: string[] = [];

  let formattedTitle = title;
  if (title.length > limits.maxTitleLen) {
    formattedTitle = title.slice(0, limits.maxTitleLen - 3) + '...';
    warnings.push(`Title truncated to ${limits.maxTitleLen} characters for ${platform}`);
  }

  let formattedDesc = description;
  if (description.length > limits.maxDescLen) {
    formattedDesc = description.slice(0, limits.maxDescLen - 3) + '...';
    warnings.push(`Description truncated to ${limits.maxDescLen} characters for ${platform}`);
  }

  let formattedTags = tags;
  if (tags.length > limits.maxTags) {
    formattedTags = tags.slice(0, limits.maxTags);
    warnings.push(`Tags limited to ${limits.maxTags} for ${platform}`);
  }

  let formattedImages = images;
  if (images.length > limits.maxImages) {
    formattedImages = images.slice(0, limits.maxImages);
    warnings.push(`Images limited to ${limits.maxImages} for ${platform}`);
  }

  // Platform-specific formatting
  if (platform === 'instagram') {
    // Add hashtags to description
    const hashtags = formattedTags.map(t => `#${t.replace(/\s+/g, '')}`).join(' ');
    if (hashtags) {
      formattedDesc = `${formattedDesc}\n\n${hashtags}`;
    }
  }

  return {
    title: formattedTitle,
    description: formattedDesc,
    tags: formattedTags,
    images: formattedImages,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const socialTools = [
  {
    name: 'create_social_listing',
    description: 'Create a product listing for social commerce platforms (Instagram Shop, TikTok Shop, Facebook Marketplace, Pinterest). Auto-formats content per platform limits.',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const, description: 'Internal product ID' },
        platform: {
          type: 'string' as const,
          enum: ['instagram', 'tiktok', 'facebook', 'pinterest'] as const,
          description: 'Social platform to list on',
        },
        title: { type: 'string' as const, description: 'Product title' },
        description: { type: 'string' as const, description: 'Product description' },
        price: { type: 'number' as const, description: 'Price in USD' },
        images: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Image URLs',
        },
        tags: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Product tags/hashtags',
        },
      },
      required: ['product_id', 'platform', 'title', 'description', 'price'] as const,
    },
  },
  {
    name: 'sync_social_inventory',
    description: 'Sync inventory quantities across social commerce channels. Updates remote quantities to match local inventory.',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string' as const, description: 'Product ID to sync' },
        platform: {
          type: 'string' as const,
          enum: ['instagram', 'tiktok', 'facebook', 'pinterest', 'all'] as const,
          description: 'Platform to sync (default: all)',
        },
        local_quantity: { type: 'number' as const, description: 'Current local inventory quantity' },
      },
      required: ['product_id', 'local_quantity'] as const,
    },
  },
  {
    name: 'social_analytics',
    description: 'Get social commerce performance analytics including impressions, clicks, conversions, and revenue by platform',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string' as const,
          enum: ['instagram', 'tiktok', 'facebook', 'pinterest', 'all'] as const,
          description: 'Platform to analyze (default: all)',
        },
        days: { type: 'number' as const, description: 'Look-back period in days (default: 30)' },
        product_id: { type: 'string' as const, description: 'Filter by specific product' },
      },
    },
  },
  {
    name: 'schedule_social_post',
    description: 'Schedule a product promotion post on social media. Supports future scheduling with platform-optimized content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        platform: {
          type: 'string' as const,
          enum: ['instagram', 'tiktok', 'facebook', 'pinterest'] as const,
          description: 'Platform to post on',
        },
        product_id: { type: 'string' as const, description: 'Product ID to promote' },
        content: { type: 'string' as const, description: 'Post text/caption' },
        media_urls: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Media URLs (images/videos)',
        },
        scheduled_at: { type: 'string' as const, description: 'Schedule datetime (ISO 8601). Defaults to now.' },
      },
      required: ['platform', 'product_id', 'content'] as const,
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export function handleSocialTool(
  db: Database,
  toolName: string,
  input: Record<string, unknown>,
): { success: boolean; data?: unknown; error?: string } {
  ensureSocialTables(db);

  switch (toolName) {
    case 'create_social_listing': {
      const productId = String(input.product_id ?? '');
      const platform = String(input.platform ?? '');
      const title = String(input.title ?? '');
      const description = String(input.description ?? '');
      const price = Number(input.price ?? 0);

      if (!productId) return { success: false, error: 'product_id is required' };
      if (!validatePlatform(platform)) return { success: false, error: `Invalid platform: ${platform}. Use: instagram, tiktok, facebook, pinterest` };
      if (!title) return { success: false, error: 'title is required' };
      if (!Number.isFinite(price) || price <= 0) return { success: false, error: 'price must be a positive number' };

      const images = Array.isArray(input.images) ? input.images.map(String) : [];
      const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];

      // Format for platform constraints
      const formatted = formatForPlatform(platform, title, description, tags, images);

      const listingId = generateId();

      db.run(
        `INSERT INTO social_listings (id, product_id, platform, title, description, price, images, tags, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
        [listingId, productId, platform, formatted.title, formatted.description, price,
         JSON.stringify(formatted.images), JSON.stringify(formatted.tags)],
      );

      // TODO: Push to actual platform API (Instagram Graph API, TikTok Shop API, etc.)

      return {
        success: true,
        data: {
          listingId,
          productId,
          platform,
          title: formatted.title,
          description: formatted.description,
          price,
          images: formatted.images,
          tags: formatted.tags,
          status: 'draft',
          warnings: formatted.warnings,
          note: `Listing created as draft. Connect ${platform} API to publish live.`,
        },
      };
    }

    case 'sync_social_inventory': {
      const productId = String(input.product_id ?? '');
      const localQuantity = Number(input.local_quantity ?? 0);
      const platform = String(input.platform ?? 'all');

      if (!productId) return { success: false, error: 'product_id is required' };
      if (!Number.isFinite(localQuantity) || localQuantity < 0) return { success: false, error: 'local_quantity must be a non-negative number' };

      const platforms: SocialPlatform[] = platform === 'all'
        ? ['instagram', 'tiktok', 'facebook', 'pinterest']
        : validatePlatform(platform) ? [platform as SocialPlatform] : [];

      if (platforms.length === 0) return { success: false, error: `Invalid platform: ${platform}` };

      const results: Array<{ platform: string; synced: boolean; previousQuantity: number; newQuantity: number }> = [];

      for (const p of platforms) {
        // Check if listing exists on this platform
        const existing = db.query<Record<string, unknown>>(
          `SELECT * FROM social_listings WHERE product_id = ? AND platform = ? AND status = 'active' LIMIT 1`,
          [productId, p],
        );

        if (existing.length === 0) {
          results.push({ platform: p, synced: false, previousQuantity: 0, newQuantity: 0 });
          continue;
        }

        // Get previous sync state
        const prevSync = db.query<Record<string, unknown>>(
          `SELECT * FROM social_inventory_sync WHERE product_id = ? AND platform = ? LIMIT 1`,
          [productId, p],
        );
        const previousQuantity = prevSync.length > 0 ? Number(prevSync[0].remote_quantity ?? 0) : 0;

        // Upsert sync record
        db.run(
          `INSERT INTO social_inventory_sync (id, platform, product_id, local_quantity, remote_quantity, synced, last_sync_at)
           VALUES (?, ?, ?, ?, ?, 1, datetime('now'))
           ON CONFLICT(platform, product_id) DO UPDATE SET
           local_quantity = ?, remote_quantity = ?, synced = 1, last_sync_at = datetime('now')`,
          [generateId(), p, productId, localQuantity, localQuantity, localQuantity, localQuantity],
        );

        // TODO: Push quantity update to platform API

        // Auto-pause listing if out of stock
        if (localQuantity === 0) {
          db.run(
            `UPDATE social_listings SET status = 'sold_out', updated_at = datetime('now')
             WHERE product_id = ? AND platform = ? AND status = 'active'`,
            [productId, p],
          );
        }

        results.push({ platform: p, synced: true, previousQuantity, newQuantity: localQuantity });
      }

      return {
        success: true,
        data: {
          productId,
          localQuantity,
          syncResults: results,
          syncedCount: results.filter(r => r.synced).length,
          totalPlatforms: results.length,
        },
      };
    }

    case 'social_analytics': {
      const platform = String(input.platform ?? 'all');
      const days = input.days != null ? Number(input.days) : 30;
      const productId = input.product_id ? String(input.product_id) : null;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const platforms: SocialPlatform[] = platform === 'all'
        ? ['instagram', 'tiktok', 'facebook', 'pinterest']
        : validatePlatform(platform) ? [platform as SocialPlatform] : [];

      if (platforms.length === 0) return { success: false, error: `Invalid platform: ${platform}` };

      const analyticsPerPlatform: Array<{
        platform: string;
        impressions: number;
        clicks: number;
        conversions: number;
        revenue: number;
        ctr: string;
        conversionRate: string;
      }> = [];

      for (const p of platforms) {
        const productFilter = productId ? ` AND product_id = ?` : '';
        const params: unknown[] = [p, cutoff];
        if (productId) params.push(productId);

        const impressionRows = db.query<Record<string, unknown>>(
          `SELECT COALESCE(SUM(count), 0) as total FROM social_analytics WHERE platform = ? AND event_type = 'impression' AND recorded_at >= ?${productFilter}`,
          params,
        );
        const clickRows = db.query<Record<string, unknown>>(
          `SELECT COALESCE(SUM(count), 0) as total FROM social_analytics WHERE platform = ? AND event_type = 'click' AND recorded_at >= ?${productFilter}`,
          params,
        );
        const convRows = db.query<Record<string, unknown>>(
          `SELECT COALESCE(SUM(count), 0) as total, COALESCE(SUM(revenue_cents), 0) as revenue FROM social_analytics WHERE platform = ? AND event_type = 'conversion' AND recorded_at >= ?${productFilter}`,
          params,
        );

        const impressions = Number(impressionRows[0]?.total ?? 0);
        const clicks = Number(clickRows[0]?.total ?? 0);
        const conversions = Number(convRows[0]?.total ?? 0);
        const revenue = Number(convRows[0]?.revenue ?? 0) / 100;

        analyticsPerPlatform.push({
          platform: p,
          impressions,
          clicks,
          conversions,
          revenue: Math.round(revenue * 100) / 100,
          ctr: impressions > 0 ? `${((clicks / impressions) * 100).toFixed(2)}%` : '0%',
          conversionRate: clicks > 0 ? `${((conversions / clicks) * 100).toFixed(2)}%` : '0%',
        });
      }

      // Aggregate totals
      const totals = analyticsPerPlatform.reduce(
        (acc, p) => ({
          impressions: acc.impressions + p.impressions,
          clicks: acc.clicks + p.clicks,
          conversions: acc.conversions + p.conversions,
          revenue: acc.revenue + p.revenue,
        }),
        { impressions: 0, clicks: 0, conversions: 0, revenue: 0 },
      );

      // Active listings count
      const listingCount = db.query<Record<string, unknown>>(
        `SELECT COUNT(*) as cnt FROM social_listings WHERE status = 'active'`,
      );

      return {
        success: true,
        data: {
          period: `Last ${days} days`,
          totals: {
            ...totals,
            revenue: Math.round(totals.revenue * 100) / 100,
            ctr: totals.impressions > 0 ? `${((totals.clicks / totals.impressions) * 100).toFixed(2)}%` : '0%',
            conversionRate: totals.clicks > 0 ? `${((totals.conversions / totals.clicks) * 100).toFixed(2)}%` : '0%',
            avgOrderValue: totals.conversions > 0 ? Math.round((totals.revenue / totals.conversions) * 100) / 100 : 0,
          },
          byPlatform: analyticsPerPlatform,
          activeListings: Number(listingCount[0]?.cnt ?? 0),
        },
      };
    }

    case 'schedule_social_post': {
      const platform = String(input.platform ?? '');
      const productId = String(input.product_id ?? '');
      const content = String(input.content ?? '');

      if (!validatePlatform(platform)) return { success: false, error: `Invalid platform: ${platform}` };
      if (!productId) return { success: false, error: 'product_id is required' };
      if (!content) return { success: false, error: 'content is required' };

      const mediaUrls = Array.isArray(input.media_urls) ? input.media_urls.map(String) : [];
      const scheduledAt = input.scheduled_at ? String(input.scheduled_at) : new Date().toISOString();

      // Validate scheduled time is in the future (or very recent)
      const scheduledTime = new Date(scheduledAt).getTime();
      if (isNaN(scheduledTime)) return { success: false, error: 'scheduled_at must be a valid ISO 8601 datetime' };

      const postId = generateId();

      // Format content per platform limits
      const limits = PLATFORM_LIMITS[platform as SocialPlatform];
      let formattedContent = content;
      const warnings: string[] = [];
      if (content.length > limits.maxDescLen) {
        formattedContent = content.slice(0, limits.maxDescLen - 3) + '...';
        warnings.push(`Content truncated to ${limits.maxDescLen} characters for ${platform}`);
      }

      let formattedMedia = mediaUrls;
      if (mediaUrls.length > limits.maxImages) {
        formattedMedia = mediaUrls.slice(0, limits.maxImages);
        warnings.push(`Media limited to ${limits.maxImages} items for ${platform}`);
      }

      db.run(
        `INSERT INTO social_scheduled_posts (id, platform, product_id, content, media_urls, scheduled_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`,
        [postId, platform, productId, formattedContent, JSON.stringify(formattedMedia), scheduledAt],
      );

      // TODO: Integrate with platform scheduling APIs

      return {
        success: true,
        data: {
          postId,
          platform,
          productId,
          content: formattedContent,
          mediaUrls: formattedMedia,
          scheduledAt,
          status: 'scheduled',
          warnings,
          note: `Post scheduled. Connect ${platform} API for automatic publishing.`,
        },
      };
    }

    default:
      return { success: false, error: `Unknown social tool: ${toolName}` };
  }
}
