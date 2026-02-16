/**
 * Social Commerce Module Types
 */

export type SocialPlatform = 'instagram' | 'tiktok' | 'facebook' | 'pinterest';

export interface SocialListing {
  id: string;
  productId: string;
  platform: SocialPlatform;
  title: string;
  description: string;
  price: number;
  images: string[];
  tags: string[];
  status: 'draft' | 'active' | 'paused' | 'sold_out';
  externalId?: string;
  url?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SocialInventorySync {
  platform: SocialPlatform;
  productId: string;
  localQuantity: number;
  remoteQuantity: number;
  synced: boolean;
  lastSyncAt: string;
}

export interface SocialAnalyticsData {
  platform: SocialPlatform;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  ctr: number;
  conversionRate: number;
  avgOrderValue: number;
  topProducts: Array<{
    productId: string;
    productName: string;
    views: number;
    sales: number;
    revenue: number;
  }>;
}

export interface ScheduledPost {
  id: string;
  platform: SocialPlatform;
  productId: string;
  content: string;
  mediaUrls: string[];
  scheduledAt: string;
  status: 'scheduled' | 'published' | 'failed' | 'cancelled';
  postUrl?: string;
  createdAt: string;
}
