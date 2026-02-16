/**
 * Team & Multi-User Management Types
 */

// =============================================================================
// ROLES & PERMISSIONS
// =============================================================================

export type TeamRole = 'owner' | 'admin' | 'manager' | 'viewer';

export type TeamAction =
  | 'view_dashboard'
  | 'manage_listings'
  | 'manage_orders'
  | 'manage_credentials'
  | 'manage_team'
  | 'manage_billing'
  | 'export_data';

// =============================================================================
// ENTITIES
// =============================================================================

export interface Team {
  id: string;
  ownerId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface TeamMember {
  id: string;
  teamId: string;
  userId: string;
  role: TeamRole;
  joinedAt: number;
  updatedAt: number;
}

export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'cancelled';

export interface TeamInvite {
  id: string;
  teamId: string;
  email: string;
  role: TeamRole;
  invitedBy: string;
  status: InviteStatus;
  createdAt: number;
  expiresAt: number | null;
  acceptedAt: number | null;
}

// =============================================================================
// AUDIT LOG
// =============================================================================

export type AuditAction =
  | 'listing_created'
  | 'listing_updated'
  | 'listing_deleted'
  | 'order_fulfilled'
  | 'price_changed'
  | 'credential_updated'
  | 'member_added'
  | 'member_removed'
  | 'member_role_changed'
  | 'settings_changed'
  | 'team_created'
  | 'invite_sent'
  | 'invite_accepted';

export interface AuditLogEntry {
  id: string;
  teamId: string;
  userId: string;
  action: AuditAction;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: number;
}

export interface AuditLogQueryOptions {
  userId?: string;
  action?: AuditAction;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

export interface LogActionParams {
  teamId: string;
  userId: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}
