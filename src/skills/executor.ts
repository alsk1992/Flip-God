/**
 * Skill Executor - Discovers and executes FlipAgent skills
 *
 * Reads SKILL.md files from the skills directory and exposes them
 * as executable commands for the MCP server and command registry.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { createLogger } from '../utils/logger';

const logger = createLogger('skills-executor');

// =============================================================================
// TYPES
// =============================================================================

interface SkillDefinition {
  name: string;
  description: string;
  directory: string;
}

interface SkillResult {
  handled: boolean;
  response?: string;
  error?: string;
}

// =============================================================================
// SKILL DISCOVERY
// =============================================================================

const SKILLS_DIR = join(__dirname, '..', 'skills');

let discoveredSkills: SkillDefinition[] | null = null;

function discoverSkills(): SkillDefinition[] {
  if (discoveredSkills) return discoveredSkills;

  discoveredSkills = [];

  if (!existsSync(SKILLS_DIR)) {
    logger.warn({ path: SKILLS_DIR }, 'Skills directory not found');
    return discoveredSkills;
  }

  try {
    const entries = readdirSync(SKILLS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = join(SKILLS_DIR, entry.name, 'SKILL.md');
      if (!existsSync(skillMdPath)) continue;

      try {
        const content = readFileSync(skillMdPath, 'utf-8');
        // Extract description from first paragraph after the title
        const lines = content.split('\n');
        const titleLine = lines.find(l => l.startsWith('# '));
        const descLine = lines.find(l => l.trim().length > 0 && !l.startsWith('#') && !l.startsWith('---'));

        discoveredSkills.push({
          name: entry.name,
          description: descLine?.trim() || titleLine?.replace(/^#\s*/, '') || entry.name,
          directory: join(SKILLS_DIR, entry.name),
        });
      } catch (err) {
        logger.warn({ skill: entry.name, err }, 'Failed to read SKILL.md');
      }
    }

    logger.info({ count: discoveredSkills.length }, 'Skills discovered');
  } catch (err) {
    logger.error({ err }, 'Failed to discover skills');
  }

  return discoveredSkills;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/** Get list of all available skill names */
export function getSkillManifest(): string[] {
  return discoverSkills().map(s => s.name);
}

/** Execute a skill command (e.g., "/scan-amazon search wireless earbuds") */
export async function executeSkillCommand(command: string): Promise<SkillResult> {
  const skills = discoverSkills();

  // Parse command: "/skill-name args..."
  const match = command.match(/^\/(\S+)\s*(.*)?$/);
  if (!match) {
    return { handled: false, error: 'Invalid command format. Use: /skill-name [args]' };
  }

  const [, skillName, args] = match;
  const skill = skills.find(s => s.name === skillName);

  if (!skill) {
    return { handled: false, error: `Unknown skill: ${skillName}` };
  }

  // For now, skills are documentation-only (SKILL.md files guide the AI agent).
  // The MCP server exposes them as tools so external clients know what FlipAgent can do.
  // Actual execution happens through the agent's tool-calling pipeline.
  return {
    handled: true,
    response: `Skill "${skill.name}" is available. ${skill.description}\n\nThis skill is executed through FlipAgent's AI agent pipeline. Provide your request and the agent will use the appropriate tools.`,
  };
}

/** Get skill details by name */
export function getSkillDetails(name: string): SkillDefinition | null {
  return discoverSkills().find(s => s.name === name) || null;
}
