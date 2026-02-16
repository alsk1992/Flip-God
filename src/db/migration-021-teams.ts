/**
 * Migration 021 - Teams, Team Members, Team Invites, Audit Log
 *
 * Creates tables for multi-user team management with role-based access
 * control and a comprehensive audit log for tracking all team activity.
 */

export const MIGRATION_021_UP = `
  -- Teams / workspaces
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
  );
  CREATE INDEX IF NOT EXISTS idx_teams_owner ON teams(owner_id);

  -- Team members with roles
  CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    joined_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    FOREIGN KEY (team_id) REFERENCES teams(id),
    UNIQUE(team_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id);
  CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
  CREATE INDEX IF NOT EXISTS idx_team_members_role ON team_members(role);

  -- Pending team invites
  CREATE TABLE IF NOT EXISTS team_invites (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    invited_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    expires_at INTEGER,
    accepted_at INTEGER,
    FOREIGN KEY (team_id) REFERENCES teams(id)
  );
  CREATE INDEX IF NOT EXISTS idx_team_invites_team ON team_invites(team_id);
  CREATE INDEX IF NOT EXISTS idx_team_invites_email ON team_invites(email);
  CREATE INDEX IF NOT EXISTS idx_team_invites_status ON team_invites(status);

  -- Audit log for team activity
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    details TEXT DEFAULT '{}',
    ip_address TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
    FOREIGN KEY (team_id) REFERENCES teams(id)
  );
  CREATE INDEX IF NOT EXISTS idx_audit_log_team ON audit_log(team_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
  CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
`;

export const MIGRATION_021_DOWN = `
  DROP TABLE IF EXISTS audit_log;
  DROP TABLE IF EXISTS team_invites;
  DROP TABLE IF EXISTS team_members;
  DROP TABLE IF EXISTS teams;
`;
