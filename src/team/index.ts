/**
 * Team Module - Multi-user team management with RBAC and audit logging
 *
 * Exports tool definitions and a handler function for wiring into the agent.
 */

import type { Database } from '../db/index.js';
import {
  createTeam,
  inviteTeamMember,
  acceptInvite,
  removeTeamMember,
  updateMemberRole,
  getTeamMembers,
  getPendingInvites,
  checkPermission,
  getTeam,
  getUserTeams,
} from './roles.js';
import { logAction, getAuditLog } from './audit-log.js';
import type { TeamRole, AuditAction } from './types.js';

// =============================================================================
// Re-exports
// =============================================================================

export {
  createTeam,
  inviteTeamMember,
  acceptInvite,
  removeTeamMember,
  updateMemberRole,
  getTeamMembers,
  getPendingInvites,
  checkPermission,
  getTeam,
  getUserTeams,
} from './roles.js';

export { logAction, getAuditLog, countAuditLog } from './audit-log.js';

export type {
  TeamRole,
  TeamAction,
  Team,
  TeamMember,
  TeamInvite,
  InviteStatus,
  AuditAction,
  AuditLogEntry,
  AuditLogQueryOptions,
  LogActionParams,
} from './types.js';

// =============================================================================
// Tool Definitions
// =============================================================================

export const teamTools = [
  {
    name: 'create_team',
    description: 'Create a team workspace for collaboration',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' as const, description: 'Team name' },
      },
      required: ['name'] as const,
    },
  },
  {
    name: 'invite_member',
    description: 'Invite a user to your team',
    input_schema: {
      type: 'object' as const,
      properties: {
        email: { type: 'string' as const, description: 'Email address to invite' },
        role: {
          type: 'string' as const,
          enum: ['admin', 'manager', 'viewer'],
          description: 'Role to assign',
        },
      },
      required: ['email', 'role'] as const,
    },
  },
  {
    name: 'manage_team',
    description: 'List members, update roles, or remove members',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string' as const,
          enum: ['list_members', 'update_role', 'remove_member', 'list_invites'],
          description: 'Management action to perform',
        },
        user_id: { type: 'string' as const, description: 'Target user ID (for update_role / remove_member)' },
        role: {
          type: 'string' as const,
          enum: ['admin', 'manager', 'viewer'],
          description: 'New role (for update_role)',
        },
      },
      required: ['action'] as const,
    },
  },
  {
    name: 'audit_log',
    description: 'View team activity audit log',
    input_schema: {
      type: 'object' as const,
      properties: {
        days: { type: 'number' as const, description: 'Number of days to look back (default: 7)' },
        user_id: { type: 'string' as const, description: 'Filter by user' },
        action: { type: 'string' as const, description: 'Filter by action type' },
        limit: { type: 'number' as const, description: 'Max entries to return (default: 50)' },
      },
    },
  },
];

// =============================================================================
// Tool Handler
// =============================================================================

export interface TeamToolInput {
  // create_team
  name?: string;
  // invite_member
  email?: string;
  role?: string;
  // manage_team
  action?: string;
  user_id?: string;
  // audit_log
  days?: number;
  limit?: number;
}

/**
 * Handle team tool calls.
 *
 * @param db - Database instance
 * @param toolName - Name of the tool being called
 * @param input - Tool input parameters
 * @param context - Session context (userId, teamId)
 */
export function handleTeamTool(
  db: Database,
  toolName: string,
  input: TeamToolInput,
  context: { userId: string; teamId?: string },
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'create_team': {
        const teamName = input.name?.trim();
        if (!teamName) {
          return { success: false, error: 'Team name is required' };
        }

        const team = createTeam(db, context.userId, teamName);

        logAction(db, {
          teamId: team.id,
          userId: context.userId,
          action: 'team_created',
          details: { name: teamName },
        });

        return {
          success: true,
          data: {
            id: team.id,
            name: team.name,
            ownerId: team.ownerId,
            createdAt: new Date(team.createdAt).toISOString(),
          },
        };
      }

      case 'invite_member': {
        const teamId = context.teamId;
        if (!teamId) {
          return { success: false, error: 'No active team context. Create or select a team first.' };
        }

        if (!checkPermission(db, context.userId, teamId, 'manage_team')) {
          return { success: false, error: 'You do not have permission to invite members' };
        }

        const email = input.email?.trim();
        if (!email) {
          return { success: false, error: 'Email is required' };
        }

        const validRoles: TeamRole[] = ['admin', 'manager', 'viewer'];
        const role = (input.role ?? 'viewer') as TeamRole;
        if (!validRoles.includes(role)) {
          return { success: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` };
        }

        const invite = inviteTeamMember(db, teamId, email, role);

        logAction(db, {
          teamId,
          userId: context.userId,
          action: 'invite_sent',
          resourceType: 'invite',
          resourceId: invite.id,
          details: { email, role },
        });

        return {
          success: true,
          data: {
            inviteId: invite.id,
            email: invite.email,
            role: invite.role,
            expiresAt: invite.expiresAt ? new Date(invite.expiresAt).toISOString() : null,
          },
        };
      }

      case 'manage_team': {
        const teamId = context.teamId;
        if (!teamId) {
          return { success: false, error: 'No active team context. Create or select a team first.' };
        }

        switch (input.action) {
          case 'list_members': {
            if (!checkPermission(db, context.userId, teamId, 'view_dashboard')) {
              return { success: false, error: 'You do not have permission to view team members' };
            }

            const members = getTeamMembers(db, teamId);
            return {
              success: true,
              data: {
                members: members.map((m) => ({
                  userId: m.userId,
                  role: m.role,
                  joinedAt: new Date(m.joinedAt).toISOString(),
                })),
                count: members.length,
              },
            };
          }

          case 'update_role': {
            if (!checkPermission(db, context.userId, teamId, 'manage_team')) {
              return { success: false, error: 'You do not have permission to update roles' };
            }

            const targetUserId = input.user_id;
            if (!targetUserId) {
              return { success: false, error: 'user_id is required for update_role' };
            }

            const validRoles: TeamRole[] = ['admin', 'manager', 'viewer'];
            const newRole = (input.role ?? '') as TeamRole;
            if (!validRoles.includes(newRole)) {
              return { success: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` };
            }

            updateMemberRole(db, teamId, targetUserId, newRole);

            logAction(db, {
              teamId,
              userId: context.userId,
              action: 'member_role_changed',
              resourceType: 'member',
              resourceId: targetUserId,
              details: { newRole },
            });

            return {
              success: true,
              data: { userId: targetUserId, newRole },
            };
          }

          case 'remove_member': {
            if (!checkPermission(db, context.userId, teamId, 'manage_team')) {
              return { success: false, error: 'You do not have permission to remove members' };
            }

            const removeUserId = input.user_id;
            if (!removeUserId) {
              return { success: false, error: 'user_id is required for remove_member' };
            }

            removeTeamMember(db, teamId, removeUserId);

            logAction(db, {
              teamId,
              userId: context.userId,
              action: 'member_removed',
              resourceType: 'member',
              resourceId: removeUserId,
            });

            return {
              success: true,
              data: { removedUserId: removeUserId },
            };
          }

          case 'list_invites': {
            if (!checkPermission(db, context.userId, teamId, 'manage_team')) {
              return { success: false, error: 'You do not have permission to view invites' };
            }

            const invites = getPendingInvites(db, teamId);
            return {
              success: true,
              data: {
                invites: invites.map((inv) => ({
                  id: inv.id,
                  email: inv.email,
                  role: inv.role,
                  createdAt: new Date(inv.createdAt).toISOString(),
                  expiresAt: inv.expiresAt ? new Date(inv.expiresAt).toISOString() : null,
                })),
                count: invites.length,
              },
            };
          }

          default:
            return { success: false, error: `Unknown manage_team action: ${input.action}` };
        }
      }

      case 'audit_log': {
        const teamId = context.teamId;
        if (!teamId) {
          return { success: false, error: 'No active team context. Create or select a team first.' };
        }

        if (!checkPermission(db, context.userId, teamId, 'view_dashboard')) {
          return { success: false, error: 'You do not have permission to view the audit log' };
        }

        const days = Math.max(1, Math.min(input.days ?? 7, 365));
        const limit = Math.max(1, Math.min(input.limit ?? 50, 500));
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

        const entries = getAuditLog(db, teamId, {
          userId: input.user_id,
          action: input.action as AuditAction | undefined,
          startDate,
          limit,
        });

        return {
          success: true,
          data: {
            entries: entries.map((e) => ({
              id: e.id,
              userId: e.userId,
              action: e.action,
              resourceType: e.resourceType,
              resourceId: e.resourceId,
              details: e.details,
              createdAt: new Date(e.createdAt).toISOString(),
            })),
            count: entries.length,
            daysQueried: days,
          },
        };
      }

      default:
        return { success: false, error: `Unknown team tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
