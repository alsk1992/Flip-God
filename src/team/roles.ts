/**
 * Team & Multi-User Management - Role-based access control
 *
 * Provides team creation, member management, invitations, and
 * permission checking with four distinct roles:
 *   owner   - full access, can manage team
 *   admin   - full access except team deletion
 *   manager - listings, orders, analytics — no credential changes
 *   viewer  - read-only dashboards and reports
 */

import { randomUUID } from 'crypto';
import type { Database } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import type {
  TeamRole,
  TeamAction,
  Team,
  TeamMember,
  TeamInvite,
  InviteStatus,
} from './types.js';

const logger = createLogger('team-roles');

// =============================================================================
// PERMISSION MATRIX
// =============================================================================

const ROLE_PERMISSIONS: Record<TeamRole, Set<TeamAction>> = {
  owner: new Set([
    'view_dashboard',
    'manage_listings',
    'manage_orders',
    'manage_credentials',
    'manage_team',
    'manage_billing',
    'export_data',
  ]),
  admin: new Set([
    'view_dashboard',
    'manage_listings',
    'manage_orders',
    'manage_credentials',
    'manage_team',
    'manage_billing',
    'export_data',
  ]),
  manager: new Set([
    'view_dashboard',
    'manage_listings',
    'manage_orders',
    'export_data',
  ]),
  viewer: new Set([
    'view_dashboard',
  ]),
};

/** 7-day default invite expiry */
const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// =============================================================================
// TEAM OPERATIONS
// =============================================================================

/**
 * Create a new team/workspace. The creating user becomes the owner.
 */
export function createTeam(
  db: Database,
  ownerId: string,
  name: string,
): Team {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error('Team name cannot be empty');
  }
  if (!ownerId) {
    throw new Error('Owner ID is required');
  }

  const id = randomUUID();
  const now = Date.now();

  db.run(
    'INSERT INTO teams (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, ownerId, trimmedName, now, now],
  );

  // Owner is automatically a member
  const memberId = randomUUID();
  db.run(
    'INSERT INTO team_members (id, team_id, user_id, role, joined_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [memberId, id, ownerId, 'owner', now, now],
  );

  logger.info({ teamId: id, ownerId, name: trimmedName }, 'Team created');

  return {
    id,
    ownerId,
    name: trimmedName,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Invite a user to join a team by email. Creates a pending invitation.
 */
export function inviteTeamMember(
  db: Database,
  teamId: string,
  email: string,
  role: TeamRole,
): TeamInvite {
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail) {
    throw new Error('Email is required');
  }
  if (!teamId) {
    throw new Error('Team ID is required');
  }
  if (role === 'owner') {
    throw new Error('Cannot invite someone as owner');
  }

  // Check team exists
  const teams = db.query<{ id: string }>(
    'SELECT id FROM teams WHERE id = ?',
    [teamId],
  );
  if (teams.length === 0) {
    throw new Error('Team not found');
  }

  // Check for existing pending invite to same email on same team
  const existing = db.query<{ id: string }>(
    "SELECT id FROM team_invites WHERE team_id = ? AND email = ? AND status = 'pending'",
    [teamId, trimmedEmail],
  );
  if (existing.length > 0) {
    throw new Error('An invite for this email is already pending');
  }

  const id = randomUUID();
  const now = Date.now();
  const expiresAt = now + INVITE_EXPIRY_MS;

  db.run(
    'INSERT INTO team_invites (id, team_id, email, role, invited_by, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, teamId, trimmedEmail, role, '', 'pending', now, expiresAt],
  );

  logger.info({ inviteId: id, teamId, email: trimmedEmail, role }, 'Team invite created');

  return {
    id,
    teamId,
    email: trimmedEmail,
    role,
    invitedBy: '',
    status: 'pending',
    createdAt: now,
    expiresAt,
    acceptedAt: null,
  };
}

/**
 * Accept a pending team invitation.
 */
export function acceptInvite(
  db: Database,
  inviteId: string,
  userId: string,
): TeamMember {
  if (!inviteId || !userId) {
    throw new Error('Invite ID and user ID are required');
  }

  const invites = db.query<{
    id: string;
    team_id: string;
    email: string;
    role: string;
    status: string;
    expires_at: number | null;
  }>(
    'SELECT id, team_id, email, role, status, expires_at FROM team_invites WHERE id = ?',
    [inviteId],
  );

  if (invites.length === 0) {
    throw new Error('Invite not found');
  }

  const invite = invites[0];

  if (invite.status !== 'pending') {
    throw new Error(`Invite is ${invite.status}, not pending`);
  }

  if (invite.expires_at !== null && invite.expires_at < Date.now()) {
    db.run("UPDATE team_invites SET status = 'expired' WHERE id = ?", [inviteId]);
    throw new Error('Invite has expired');
  }

  // Check not already a member
  const existingMember = db.query<{ id: string }>(
    'SELECT id FROM team_members WHERE team_id = ? AND user_id = ?',
    [invite.team_id, userId],
  );
  if (existingMember.length > 0) {
    throw new Error('User is already a member of this team');
  }

  const now = Date.now();
  const memberId = randomUUID();
  const role = invite.role as TeamRole;

  // Mark invite as accepted
  db.run(
    "UPDATE team_invites SET status = 'accepted', accepted_at = ? WHERE id = ?",
    [now, inviteId],
  );

  // Add as team member
  db.run(
    'INSERT INTO team_members (id, team_id, user_id, role, joined_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [memberId, invite.team_id, userId, role, now, now],
  );

  logger.info({ inviteId, teamId: invite.team_id, userId, role }, 'Invite accepted');

  return {
    id: memberId,
    teamId: invite.team_id,
    userId,
    role,
    joinedAt: now,
    updatedAt: now,
  };
}

/**
 * Remove a member from a team. Owners cannot be removed.
 */
export function removeTeamMember(
  db: Database,
  teamId: string,
  userId: string,
): void {
  if (!teamId || !userId) {
    throw new Error('Team ID and user ID are required');
  }

  // Don't allow removing the owner
  const members = db.query<{ role: string }>(
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
    [teamId, userId],
  );

  if (members.length === 0) {
    throw new Error('User is not a member of this team');
  }

  if (members[0].role === 'owner') {
    throw new Error('Cannot remove the team owner');
  }

  db.run(
    'DELETE FROM team_members WHERE team_id = ? AND user_id = ?',
    [teamId, userId],
  );

  logger.info({ teamId, userId }, 'Team member removed');
}

/**
 * Update a team member's role. Cannot change the owner's role.
 */
export function updateMemberRole(
  db: Database,
  teamId: string,
  userId: string,
  role: TeamRole,
): void {
  if (!teamId || !userId) {
    throw new Error('Team ID and user ID are required');
  }
  if (role === 'owner') {
    throw new Error('Cannot assign owner role — transfer ownership instead');
  }

  const members = db.query<{ role: string }>(
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
    [teamId, userId],
  );

  if (members.length === 0) {
    throw new Error('User is not a member of this team');
  }

  if (members[0].role === 'owner') {
    throw new Error('Cannot change the owner\'s role');
  }

  const now = Date.now();
  db.run(
    'UPDATE team_members SET role = ?, updated_at = ? WHERE team_id = ? AND user_id = ?',
    [role, now, teamId, userId],
  );

  logger.info({ teamId, userId, role }, 'Team member role updated');
}

/**
 * List all members of a team.
 */
export function getTeamMembers(
  db: Database,
  teamId: string,
): TeamMember[] {
  if (!teamId) {
    return [];
  }

  const rows = db.query<{
    id: string;
    team_id: string;
    user_id: string;
    role: string;
    joined_at: number;
    updated_at: number;
  }>(
    'SELECT id, team_id, user_id, role, joined_at, updated_at FROM team_members WHERE team_id = ? ORDER BY joined_at ASC',
    [teamId],
  );

  return rows.map((row) => ({
    id: row.id,
    teamId: row.team_id,
    userId: row.user_id,
    role: row.role as TeamRole,
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
  }));
}

/**
 * Get pending invites for a team.
 */
export function getPendingInvites(
  db: Database,
  teamId: string,
): TeamInvite[] {
  if (!teamId) {
    return [];
  }

  const rows = db.query<{
    id: string;
    team_id: string;
    email: string;
    role: string;
    invited_by: string;
    status: string;
    created_at: number;
    expires_at: number | null;
    accepted_at: number | null;
  }>(
    "SELECT id, team_id, email, role, invited_by, status, created_at, expires_at, accepted_at FROM team_invites WHERE team_id = ? AND status = 'pending' ORDER BY created_at DESC",
    [teamId],
  );

  return rows.map((row) => ({
    id: row.id,
    teamId: row.team_id,
    email: row.email,
    role: row.role as TeamRole,
    invitedBy: row.invited_by,
    status: row.status as InviteStatus,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
  }));
}

/**
 * Check whether a user has permission to perform a specific action within a team.
 */
export function checkPermission(
  db: Database,
  userId: string,
  teamId: string,
  action: TeamAction,
): boolean {
  if (!userId || !teamId || !action) {
    return false;
  }

  const members = db.query<{ role: string }>(
    'SELECT role FROM team_members WHERE team_id = ? AND user_id = ?',
    [teamId, userId],
  );

  if (members.length === 0) {
    return false;
  }

  const role = members[0].role as TeamRole;
  const allowedActions = ROLE_PERMISSIONS[role];

  return allowedActions ? allowedActions.has(action) : false;
}

/**
 * Get a team by ID.
 */
export function getTeam(
  db: Database,
  teamId: string,
): Team | null {
  if (!teamId) {
    return null;
  }

  const rows = db.query<{
    id: string;
    owner_id: string;
    name: string;
    created_at: number;
    updated_at: number;
  }>(
    'SELECT id, owner_id, name, created_at, updated_at FROM teams WHERE id = ?',
    [teamId],
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0];
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * List all teams a user belongs to.
 */
export function getUserTeams(
  db: Database,
  userId: string,
): Array<Team & { role: TeamRole }> {
  if (!userId) {
    return [];
  }

  const rows = db.query<{
    id: string;
    owner_id: string;
    name: string;
    created_at: number;
    updated_at: number;
    role: string;
  }>(
    `SELECT t.id, t.owner_id, t.name, t.created_at, t.updated_at, tm.role
     FROM teams t
     JOIN team_members tm ON t.id = tm.team_id
     WHERE tm.user_id = ?
     ORDER BY t.name ASC`,
    [userId],
  );

  return rows.map((row) => ({
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    role: row.role as TeamRole,
  }));
}
