/**
 * Team Audit Log - Records who did what within a team
 *
 * Every significant action is logged with the acting user, the target
 * resource, a JSON details blob, and the client IP (when available).
 */

import { randomUUID } from 'crypto';
import type { Database } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import type {
  AuditLogEntry,
  AuditLogQueryOptions,
  LogActionParams,
} from './types.js';

const logger = createLogger('audit-log');

// =============================================================================
// WRITE
// =============================================================================

/**
 * Record an auditable action.
 */
export function logAction(
  db: Database,
  params: LogActionParams,
): AuditLogEntry {
  if (!params.teamId || !params.userId || !params.action) {
    throw new Error('teamId, userId, and action are required');
  }

  const id = randomUUID();
  const now = Date.now();
  const details = params.details ?? {};

  // Sanitise details: strip prototype-pollution keys
  const safeDetails: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
      safeDetails[k] = v;
    }
  }

  db.run(
    `INSERT INTO audit_log (id, team_id, user_id, action, resource_type, resource_id, details, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.teamId,
      params.userId,
      params.action,
      params.resourceType ?? null,
      params.resourceId ?? null,
      JSON.stringify(safeDetails),
      params.ipAddress ?? null,
      now,
    ],
  );

  logger.debug(
    { id, teamId: params.teamId, userId: params.userId, action: params.action },
    'Audit log entry created',
  );

  return {
    id,
    teamId: params.teamId,
    userId: params.userId,
    action: params.action,
    resourceType: params.resourceType ?? null,
    resourceId: params.resourceId ?? null,
    details: safeDetails,
    ipAddress: params.ipAddress ?? null,
    createdAt: now,
  };
}

// =============================================================================
// READ
// =============================================================================

/**
 * Query the audit log with optional filters.
 */
export function getAuditLog(
  db: Database,
  teamId: string,
  options: AuditLogQueryOptions = {},
): AuditLogEntry[] {
  if (!teamId) {
    return [];
  }

  const conditions: string[] = ['team_id = ?'];
  const params: Array<string | number> = [teamId];

  if (options.userId) {
    conditions.push('user_id = ?');
    params.push(options.userId);
  }

  if (options.action) {
    conditions.push('action = ?');
    params.push(options.action);
  }

  if (options.startDate) {
    const startMs = new Date(options.startDate).getTime();
    if (Number.isFinite(startMs)) {
      conditions.push('created_at >= ?');
      params.push(startMs);
    }
  }

  if (options.endDate) {
    const endMs = new Date(options.endDate).getTime();
    if (Number.isFinite(endMs)) {
      conditions.push('created_at <= ?');
      params.push(endMs);
    }
  }

  const limit = Math.max(1, Math.min(options.limit ?? 50, 1000));
  const offset = Math.max(0, options.offset ?? 0);

  const sql = `
    SELECT id, team_id, user_id, action, resource_type, resource_id, details, ip_address, created_at
    FROM audit_log
    WHERE ${conditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `;

  params.push(limit, offset);

  const rows = db.query<{
    id: string;
    team_id: string;
    user_id: string;
    action: string;
    resource_type: string | null;
    resource_id: string | null;
    details: string;
    ip_address: string | null;
    created_at: number;
  }>(sql, params);

  return rows.map((row) => {
    let details: Record<string, unknown> = {};
    try {
      details = JSON.parse(row.details ?? '{}');
    } catch {
      // ignore malformed JSON
    }

    return {
      id: row.id,
      teamId: row.team_id,
      userId: row.user_id,
      action: row.action as AuditLogEntry['action'],
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      details,
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    };
  });
}

/**
 * Count audit log entries matching filters (useful for pagination).
 */
export function countAuditLog(
  db: Database,
  teamId: string,
  options: AuditLogQueryOptions = {},
): number {
  if (!teamId) {
    return 0;
  }

  const conditions: string[] = ['team_id = ?'];
  const params: Array<string | number> = [teamId];

  if (options.userId) {
    conditions.push('user_id = ?');
    params.push(options.userId);
  }

  if (options.action) {
    conditions.push('action = ?');
    params.push(options.action);
  }

  if (options.startDate) {
    const startMs = new Date(options.startDate).getTime();
    if (Number.isFinite(startMs)) {
      conditions.push('created_at >= ?');
      params.push(startMs);
    }
  }

  if (options.endDate) {
    const endMs = new Date(options.endDate).getTime();
    if (Number.isFinite(endMs)) {
      conditions.push('created_at <= ?');
      params.push(endMs);
    }
  }

  const sql = `SELECT COUNT(*) as cnt FROM audit_log WHERE ${conditions.join(' AND ')}`;
  const rows = db.query<{ cnt: number }>(sql, params);
  return rows[0]?.cnt ?? 0;
}
