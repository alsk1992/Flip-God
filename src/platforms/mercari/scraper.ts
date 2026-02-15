/**
 * Mercari JP Product Search — Real API adapter
 *
 * Uses Mercari Japan's v2 API with DPoP JWT authentication (ECDSA P-256 / ES256).
 * Based on: github.com/take-kun/mercapi + github.com/HonmaMeikodesu/generate-mercari-jwt
 *
 * Endpoints:
 *   POST https://api.mercari.jp/v2/entities:search
 *   GET  https://api.mercari.jp/items/get?id=...
 */

import { createLogger } from '../../utils/logger';
import type { PlatformAdapter, ProductSearchResult, SearchOptions } from '../index';
import * as crypto from 'crypto';

const logger = createLogger('mercari');

const API_BASE = 'https://api.mercari.jp';
const SEARCH_URL = `${API_BASE}/v2/entities:search`;
const ITEM_URL = `${API_BASE}/items/get`;

// --- DPoP JWT generation (ECDSA P-256 / ES256) ---

interface ECKeyPair {
  privateKey: crypto.KeyObject;
  publicJwk: { kty: string; crv: string; x: string; y: string };
}

function generateECKeyPair(): ECKeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    privateKey,
    publicJwk: { kty: jwk.kty!, crv: jwk.crv!, x: jwk.x!, y: jwk.y! },
  };
}

function base64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf;
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function generateDPoP(url: string, method: string, keyPair: ECKeyPair): string {
  const header = {
    typ: 'dpop+jwt',
    alg: 'ES256',
    jwk: keyPair.publicJwk,
  };

  const payload = {
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    htu: url,
    htm: method,
    uuid: crypto.randomUUID(),
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const sign = crypto.createSign('SHA256');
  sign.update(signingInput);
  const derSig = sign.sign(keyPair.privateKey);

  // Convert DER to raw R||S (64 bytes) for ES256
  const rawSig = derToRaw(derSig);
  const encodedSig = base64url(rawSig);

  return `${signingInput}.${encodedSig}`;
}

/** Convert DER-encoded ECDSA signature to raw 64-byte R||S */
function derToRaw(der: Buffer): Buffer {
  const raw = Buffer.alloc(64);
  let offset = 2; // skip 0x30 + length
  // R
  const rLen = der[offset + 1]!;
  offset += 2;
  const rStart = rLen > 32 ? offset + (rLen - 32) : offset;
  const rDest = rLen < 32 ? 32 - rLen : 0;
  der.copy(raw, rDest, rStart, rStart + Math.min(rLen, 32));
  offset += rLen;
  // S
  const sLen = der[offset + 1]!;
  offset += 2;
  const sStart = sLen > 32 ? offset + (sLen - 32) : offset;
  const sDest = sLen < 32 ? 64 - sLen : 32;
  der.copy(raw, sDest, sStart, sStart + Math.min(sLen, 32));
  return raw;
}

// --- Mercari types ---

interface MercariSearchItem {
  id: string;
  name: string;
  price: number; // JPY
  status: string; // ITEM_STATUS_ON_SALE, ITEM_STATUS_SOLD_OUT, etc.
  thumbnails?: string[];
  itemBrand?: { id: string; name: string };
  itemCategory?: { id: string; name: string };
  sellerId?: string;
  sellerName?: string;
  shippingPayer?: { id: number; name: string };
  itemCondition?: { id: number; name: string };
  numLikes?: number;
  numComments?: number;
  created?: number; // unix timestamp
}

interface MercariItemDetail {
  id: string;
  name: string;
  price: number;
  status: string;
  description?: string;
  thumbnails?: string[];
  photos?: string[];
  seller?: { id: string; name: string; photo_thumbnail_url?: string; ratings?: { good?: number; normal?: number; bad?: number } };
  item_brand?: { id: string; name: string };
  item_category?: { id: string; name: string };
  item_condition?: { id: number; name: string };
  shipping_payer?: { id: number; name: string };
  num_likes?: number;
  num_comments?: number;
  created?: number;
}

function parseSearchItem(item: MercariSearchItem): ProductSearchResult {
  return {
    platformId: item.id,
    platform: 'mercari',
    title: item.name,
    price: item.price, // JPY — no division
    shipping: 0, // Most Mercari JP items include shipping
    currency: 'JPY',
    inStock: item.status === 'ITEM_STATUS_ON_SALE',
    seller: item.sellerName ?? item.sellerId,
    url: `https://jp.mercari.com/item/${item.id}`,
    imageUrl: item.thumbnails?.[0],
    brand: item.itemBrand?.name,
    category: item.itemCategory?.name,
  };
}

function parseItemDetail(item: MercariItemDetail): ProductSearchResult {
  return {
    platformId: item.id,
    platform: 'mercari',
    title: item.name,
    price: item.price,
    shipping: 0,
    currency: 'JPY',
    inStock: item.status === 'ITEM_STATUS_ON_SALE',
    seller: item.seller?.name ?? item.seller?.id,
    url: `https://jp.mercari.com/item/${item.id}`,
    imageUrl: item.photos?.[0] ?? item.thumbnails?.[0],
    brand: item.item_brand?.name,
    category: item.item_category?.name,
    rating: (() => {
      const good = item.seller?.ratings?.good ?? 0;
      const normal = item.seller?.ratings?.normal ?? 0;
      const bad = item.seller?.ratings?.bad ?? 0;
      const total = good + normal + bad;
      return total > 0 ? (good * 5 + normal * 3 + bad * 1) / total : undefined;
    })(),
    reviewCount: item.seller?.ratings
      ? (item.seller.ratings.good ?? 0) + (item.seller.ratings.normal ?? 0) + (item.seller.ratings.bad ?? 0)
      : undefined,
  };
}

// --- Adapter ---

export function createMercariAdapter(): PlatformAdapter & { getSellerProfile(userId: string): Promise<SellerProfileResult | null> } {
  const keyPair = generateECKeyPair();

  const baseHeaders: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'X-Platform': 'web',
  };

  return {
    platform: 'mercari',

    async search(options: SearchOptions): Promise<ProductSearchResult[]> {
      logger.info({ query: options.query }, 'Searching Mercari JP');

      const pageSize = Math.min(options.maxResults ?? 30, 120);

      const body = {
        userId: '',
        pageSize,
        pageToken: '',
        searchSessionId: crypto.randomUUID(),
        indexRouting: 'INDEX_ROUTING_UNSPECIFIED',
        searchCondition: {
          keyword: options.query,
          sort: 'SORT_SCORE',
          order: 'ORDER_DESC',
          status: ['STATUS_ON_SALE'],
          sizeId: [],
          categoryId: [],
          brandId: [],
          priceMin: options.minPrice != null ? Math.round(options.minPrice) : 0,
          priceMax: options.maxPrice != null ? Math.round(options.maxPrice) : 0,
          itemConditionId: [],
          shippingPayerId: [],
          shippingMethod: [],
          colorId: [],
          excludeKeyword: '',
        },
        serviceFrom: 'suruga',
      };

      const dpop = generateDPoP(SEARCH_URL, 'POST', keyPair);

      try {
        const response = await fetch(SEARCH_URL, {
          method: 'POST',
          headers: { ...baseHeaders, DPoP: dpop },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          logger.error({ status: response.status }, 'Mercari search failed');
          return [];
        }

        const data = await response.json() as { items?: MercariSearchItem[] };
        return (data.items ?? []).map(parseSearchItem);
      } catch (err) {
        logger.error({ err }, 'Mercari search error');
        return [];
      }
    },

    async getProduct(productId: string): Promise<ProductSearchResult | null> {
      logger.info({ productId }, 'Getting Mercari JP item');

      const url = `${ITEM_URL}?id=${encodeURIComponent(productId)}`;
      const dpop = generateDPoP(url, 'GET', keyPair);

      try {
        const response = await fetch(url, {
          headers: { ...baseHeaders, DPoP: dpop },
        });
        if (!response.ok) return null;
        const data = await response.json() as { data?: MercariItemDetail; result?: string };
        if (!data.data) return null;
        return parseItemDetail(data.data);
      } catch (err) {
        logger.error({ productId, err }, 'Mercari item lookup error');
        return null;
      }
    },

    async checkStock(productId: string): Promise<{ inStock: boolean; quantity?: number }> {
      const product = await this.getProduct(productId);
      return { inStock: product?.inStock ?? false, quantity: product?.inStock ? 1 : 0 };
    },

    async getSellerProfile(userId: string): Promise<SellerProfileResult | null> {
      logger.info({ userId }, 'Getting Mercari seller profile');
      const keyPair = generateECKeyPair();
      const url = `${API_BASE}/v2/users/get?user_id=${encodeURIComponent(userId)}`;
      const dpop = generateDPoP(url, 'GET', keyPair);
      try {
        const response = await fetch(url, {
          headers: { ...baseHeaders, DPoP: dpop },
        });
        if (!response.ok) return null;
        const data = await response.json() as {
          data?: {
            id?: string;
            name?: string;
            photo_url?: string;
            ratings_count?: number;
            rating_score?: number;
            num_sell_items?: number;
            num_listings?: number;
            introduction?: string;
            created?: number;
          };
        };
        if (!data.data) return null;
        const u = data.data;
        return {
          userId: u.id ?? userId,
          name: u.name ?? '',
          photoUrl: u.photo_url,
          ratingsCount: u.ratings_count ?? 0,
          ratingScore: u.rating_score ?? 0,
          itemsListed: u.num_listings ?? 0,
          itemsSold: u.num_sell_items ?? 0,
          introduction: u.introduction,
          memberSince: u.created ? new Date(u.created * 1000).toISOString() : undefined,
        };
      } catch (err) {
        logger.error({ userId, err }, 'Mercari seller profile error');
        return null;
      }
    },
  };
}

export interface SellerProfileResult {
  userId: string;
  name: string;
  photoUrl?: string;
  ratingsCount: number;
  ratingScore: number;
  itemsListed: number;
  itemsSold: number;
  introduction?: string;
  memberSince?: string;
}
