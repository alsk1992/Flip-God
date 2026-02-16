/**
 * Shared Repricing Rule Packs
 *
 * Export and import repricing strategies as shareable JSON packs.
 * Enables users to share their best repricing configurations.
 */

import { randomUUID } from 'crypto';
import type { Database } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import type { RepricingRule, RulePack, RulePackInput } from './types.js';

const logger = createLogger('shared-rules');

// =============================================================================
// EXPORT
// =============================================================================

/**
 * Export repricing rules as a shareable JSON pack.
 */
export function exportRulePack(
  db: Database,
  ruleIds: string[],
  meta: { name: string; description?: string; author?: string },
): RulePack {
  if (!ruleIds || ruleIds.length === 0) {
    throw new Error('At least one rule ID is required');
  }
  if (!meta.name?.trim()) {
    throw new Error('Pack name is required');
  }

  // Fetch rules from repricing_rules table
  const placeholders = ruleIds.map(() => '?').join(',');
  const rows = db.query<Record<string, unknown>>(
    `SELECT id, listing_id, strategy, params, min_price, max_price
     FROM repricing_rules
     WHERE id IN (${placeholders})`,
    ruleIds,
  );

  if (rows.length === 0) {
    throw new Error('No matching repricing rules found');
  }

  const rules: RepricingRule[] = rows.map((row) => {
    let params: Record<string, unknown> = {};
    try {
      if (typeof row.params === 'string') {
        params = JSON.parse(row.params);
      }
    } catch {
      // ignore
    }

    return {
      id: String(row.id ?? ''),
      listingId: String(row.listing_id ?? ''),
      strategy: String(row.strategy ?? ''),
      params,
      minPrice: Number(row.min_price) || 0,
      maxPrice: Number(row.max_price) || 0,
    };
  });

  const id = randomUUID();
  const now = Date.now();

  const pack: RulePack = {
    id,
    name: meta.name.trim(),
    description: meta.description?.trim() ?? null,
    version: '1.0.0',
    author: meta.author?.trim() ?? null,
    rules,
    createdAt: now,
  };

  // Also persist to shared_rule_packs for listing later
  db.run(
    `INSERT INTO shared_rule_packs (id, name, description, version, author, rules, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      pack.id,
      pack.name,
      pack.description,
      pack.version,
      pack.author,
      JSON.stringify(pack.rules),
      pack.createdAt,
    ],
  );

  logger.info(
    { packId: id, name: meta.name, ruleCount: rules.length },
    'Rule pack exported',
  );

  return pack;
}

// =============================================================================
// IMPORT
// =============================================================================

/**
 * Import a shared rule pack, creating new repricing rules.
 */
export function importRulePack(
  db: Database,
  packData: string | RulePackInput,
  userId: string,
): { imported: number; skipped: number; errors: string[] } {
  let pack: RulePackInput;

  if (typeof packData === 'string') {
    try {
      pack = JSON.parse(packData);
    } catch {
      throw new Error('Invalid JSON in rule pack data');
    }
  } else {
    pack = packData;
  }

  if (!pack.rules || !Array.isArray(pack.rules)) {
    throw new Error('Rule pack must contain a rules array');
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const rule of pack.rules) {
    try {
      if (!rule.strategy || !rule.listingId) {
        skipped++;
        continue;
      }

      const minPrice = Number(rule.minPrice);
      const maxPrice = Number(rule.maxPrice);

      if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) {
        errors.push(`Rule ${rule.id ?? 'unknown'}: invalid min/max price`);
        skipped++;
        continue;
      }

      if (minPrice < 0 || maxPrice < minPrice) {
        errors.push(`Rule ${rule.id ?? 'unknown'}: invalid price range (${minPrice}-${maxPrice})`);
        skipped++;
        continue;
      }

      const newId = randomUUID();
      const now = Date.now();

      db.run(
        `INSERT INTO repricing_rules (id, listing_id, strategy, params, min_price, max_price, enabled, last_run, run_interval_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId,
          rule.listingId,
          rule.strategy,
          JSON.stringify(rule.params ?? {}),
          minPrice,
          maxPrice,
          1,
          null,
          3600000,
          now,
        ],
      );

      imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Rule ${rule.id ?? 'unknown'}: ${msg}`);
      skipped++;
    }
  }

  logger.info(
    { packName: pack.name, imported, skipped, errorCount: errors.length },
    'Rule pack imported',
  );

  return { imported, skipped, errors };
}

// =============================================================================
// LIST
// =============================================================================

/**
 * List available shared rule packs.
 */
export function listSharedRulePacks(
  db: Database,
): RulePack[] {
  const rows = db.query<Record<string, unknown>>(
    'SELECT id, name, description, version, author, rules, created_at FROM shared_rule_packs ORDER BY created_at DESC',
  );

  return rows.map((row) => {
    let rules: RepricingRule[] = [];
    try {
      if (typeof row.rules === 'string') {
        rules = JSON.parse(row.rules);
      }
    } catch {
      // ignore
    }

    return {
      id: String(row.id ?? ''),
      name: String(row.name ?? ''),
      description: row.description !== null && row.description !== undefined ? String(row.description) : null,
      version: String(row.version ?? '1.0.0'),
      author: row.author !== null && row.author !== undefined ? String(row.author) : null,
      rules,
      createdAt: Number(row.created_at) || 0,
    };
  });
}

/**
 * Get a single rule pack by ID.
 */
export function getRulePack(
  db: Database,
  packId: string,
): RulePack | null {
  if (!packId) return null;

  const rows = db.query<Record<string, unknown>>(
    'SELECT id, name, description, version, author, rules, created_at FROM shared_rule_packs WHERE id = ?',
    [packId],
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  let rules: RepricingRule[] = [];
  try {
    if (typeof row.rules === 'string') {
      rules = JSON.parse(row.rules);
    }
  } catch {
    // ignore
  }

  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    description: row.description !== null && row.description !== undefined ? String(row.description) : null,
    version: String(row.version ?? '1.0.0'),
    author: row.author !== null && row.author !== undefined ? String(row.author) : null,
    rules,
    createdAt: Number(row.created_at) || 0,
  };
}
