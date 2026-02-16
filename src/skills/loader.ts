/**
 * Skill Loader - loads SKILL.md files from bundled directory
 */

import fs from 'fs';
import path from 'path';
import { Skill, SkillManagerConfig, SkillGates } from '../types';
import { createLogger } from '../utils/logger';
import { parseFrontmatter } from './frontmatter';

const log = createLogger('skills');

// ---------------------------------------------------------------------------
// Keyword map for message-based skill selection
// ---------------------------------------------------------------------------

const SKILL_KEYWORDS: Record<string, string[]> = {
  scanner: [
    'scan', 'search', 'find', 'compare', 'match', 'lookup', 'price',
    'amazon', 'ebay', 'walmart', 'aliexpress', 'product', 'upc', 'asin',
    'bestbuy', 'best buy', 'target', 'costco', 'homedepot', 'home depot',
    'poshmark', 'mercari', 'facebook', 'faire', 'bstock', 'b-stock',
    'bulq', 'liquidation',
  ],
  lister: [
    'list', 'listing', 'create listing', 'optimize', 'bulk list',
    'pause listing', 'resume listing', 'update price', 'seo',
  ],
  fulfiller: [
    'order', 'fulfill', 'fulfillment', 'purchase', 'track', 'tracking',
    'ship', 'shipping', 'return', 'dropship',
  ],
  analytics: [
    'profit', 'report', 'dashboard', 'margin', 'roi', 'analytics',
    'category analysis', 'competitor', 'fee', 'fees', 'revenue', 'sales',
  ],
  credentials: [
    'credentials', 'credential', 'setup', 'api key', 'configure',
    'authentication', 'auth', 'connect', 'login',
  ],
};

// ---------------------------------------------------------------------------
// Gate checking
// ---------------------------------------------------------------------------

/** Only allow alphanumeric, hyphen, underscore, and dot characters in binary names. */
const SAFE_BIN_RE = /^[a-zA-Z0-9._-]+$/;

function isSafeBinName(bin: string): boolean {
  return SAFE_BIN_RE.test(bin) && !bin.includes('..');
}

function checkGates(gates: SkillGates | undefined, configKeys?: Record<string, unknown>): boolean {
  if (!gates) return true;

  // Check required binaries (all must exist)
  if (gates.bins && gates.bins.length > 0) {
    for (const bin of gates.bins) {
      if (!isSafeBinName(bin)) {
        log.debug({ bin }, 'Gate failed: invalid binary name');
        return false;
      }
      try {
        const { execSync } = require('child_process');
        execSync(`which ${bin}`, { stdio: 'ignore' });
      } catch {
        log.debug({ bin }, 'Gate failed: binary not found');
        return false;
      }
    }
  }

  // Check any-of binaries (at least one must exist)
  if (gates.anyBins && gates.anyBins.length > 0) {
    let found = false;
    for (const bin of gates.anyBins) {
      if (!isSafeBinName(bin)) {
        continue;
      }
      try {
        const { execSync } = require('child_process');
        execSync(`which ${bin}`, { stdio: 'ignore' });
        found = true;
        break;
      } catch {
        // continue
      }
    }
    if (!found) {
      log.debug({ anyBins: gates.anyBins }, 'Gate failed: no matching binary found');
      return false;
    }
  }

  // Check required environment variables
  if (gates.envs && gates.envs.length > 0) {
    for (const env of gates.envs) {
      if (!process.env[env]) {
        log.debug({ env }, 'Gate failed: env var not set');
        return false;
      }
    }
  }

  // Check OS
  if (gates.os && gates.os.length > 0) {
    const currentOs = process.platform;
    const osMap: Record<string, string> = {
      macos: 'darwin',
      mac: 'darwin',
      darwin: 'darwin',
      linux: 'linux',
      windows: 'win32',
      win32: 'win32',
    };
    const allowed = gates.os.map((o) => osMap[o.toLowerCase()] || o.toLowerCase());
    if (!allowed.includes(currentOs)) {
      log.debug({ os: currentOs, allowed }, 'Gate failed: OS mismatch');
      return false;
    }
  }

  // Check config keys
  if (gates.config && gates.config.length > 0 && configKeys) {
    for (const key of gates.config) {
      const parts = key.split('.');
      let val: unknown = configKeys;
      for (const part of parts) {
        if (val && typeof val === 'object' && part in (val as Record<string, unknown>)) {
          val = (val as Record<string, unknown>)[part];
        } else {
          val = undefined;
          break;
        }
      }
      if (val === undefined || val === null || val === false) {
        log.debug({ key }, 'Gate failed: config key not set');
        return false;
      }
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Load a single skill from a SKILL.md path
// ---------------------------------------------------------------------------

export function loadSkill(skillPath: string, configKeys?: Record<string, unknown>): Skill | null {
  try {
    if (!fs.existsSync(skillPath)) {
      log.debug({ skillPath }, 'SKILL.md not found');
      return null;
    }

    const raw = fs.readFileSync(skillPath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(raw);

    const skillDir = path.dirname(skillPath);
    const name = frontmatter.name || path.basename(skillDir);

    // Build gates from frontmatter
    const gates: SkillGates | undefined = frontmatter.gates;

    // Check gates
    if (!checkGates(gates, configKeys)) {
      log.debug({ name }, 'Skill disabled by gate check');
      return null;
    }

    const skill: Skill = {
      name,
      description: frontmatter.description || '',
      path: skillPath,
      content: body.trim(),
      enabled: true,
      emoji: frontmatter.emoji,
      homepage: frontmatter.homepage,
      os: gates?.os,
      userInvocable: frontmatter.userInvocable !== false,
      modelInvocable: frontmatter.modelInvocable !== false,
      baseDir: skillDir,
      commandDispatch: frontmatter.commandDispatch,
      commandTool: frontmatter.commandTool,
      commandArgMode: frontmatter.commandArgMode,
    };

    return skill;
  } catch (err) {
    log.error({ err, skillPath }, 'Failed to load skill');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Load all skills from a directory
// ---------------------------------------------------------------------------

export interface LoadSkillsOpts {
  allowList?: string[];
  configKeys?: Record<string, unknown>;
}

export function loadSkillsFromDir(dir: string, opts?: LoadSkillsOpts): Skill[] {
  const skills: Skill[] = [];

  if (!fs.existsSync(dir)) {
    log.debug({ dir }, 'Skills directory not found');
    return skills;
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // If allowList is set, skip skills not in it
      if (opts?.allowList && !opts.allowList.includes(entry.name)) {
        continue;
      }

      const skillPath = path.join(dir, entry.name, 'SKILL.md');
      const skill = loadSkill(skillPath, opts?.configKeys);
      if (skill) {
        skills.push(skill);
      }
    }
  } catch (err) {
    log.error({ err, dir }, 'Failed to read skills directory');
  }

  return skills;
}

// ---------------------------------------------------------------------------
// SkillManager
// ---------------------------------------------------------------------------

export interface SkillManager {
  skills: Map<string, Skill>;
  getSkill: (name: string) => Skill | undefined;
  getEnabledSkills: () => Skill[];
  getSkillContext: () => string;
  getSkillContextForMessage: (message: string) => string;
  reload: () => void;
  stopWatching: () => void;
}

export function createSkillManager(config?: SkillManagerConfig): SkillManager {
  const skills = new Map<string, Skill>();

  function loadAll(): void {
    skills.clear();

    // Load bundled skills
    const bundledDir = path.join(__dirname, 'bundled');
    const bundled = loadSkillsFromDir(bundledDir, {
      allowList: config?.allowBundled,
      configKeys: config?.configKeys,
    });

    for (const skill of bundled) {
      skills.set(skill.name, skill);
      log.info({ name: skill.name, emoji: skill.emoji }, 'Loaded skill');
    }

    // Load extra dirs if provided
    if (config?.extraDirs) {
      for (const dir of config.extraDirs) {
        const extra = loadSkillsFromDir(dir, {
          configKeys: config?.configKeys,
        });
        for (const skill of extra) {
          skills.set(skill.name, skill);
          log.info({ name: skill.name, source: dir }, 'Loaded extra skill');
        }
      }
    }

    log.info({ count: skills.size }, 'Skills loaded');
  }

  // Initial load
  loadAll();

  function getSkill(name: string): Skill | undefined {
    return skills.get(name);
  }

  function getEnabledSkills(): Skill[] {
    return Array.from(skills.values()).filter((s) => s.enabled);
  }

  function getSkillContext(): string {
    const enabled = getEnabledSkills();
    if (enabled.length === 0) return '';

    const sections: string[] = [];
    for (const skill of enabled) {
      const header = `## ${skill.emoji || ''} ${skill.name}${skill.description ? ` - ${skill.description}` : ''}`;
      sections.push(`${header}\n\n${skill.content}`);
    }

    return sections.join('\n\n---\n\n');
  }

  function getSkillContextForMessage(message: string): string {
    const lower = message.toLowerCase();
    const matched = new Set<string>();

    // Check each skill's keywords
    for (const [skillName, keywords] of Object.entries(SKILL_KEYWORDS)) {
      for (const keyword of keywords) {
        if (lower.includes(keyword)) {
          matched.add(skillName);
          break;
        }
      }
    }

    // If no keywords matched, return all enabled skills (fallback)
    if (matched.size === 0) {
      return getSkillContext();
    }

    // Build context from matched skills only
    const sections: string[] = [];
    for (const name of matched) {
      const skill = skills.get(name);
      if (skill && skill.enabled) {
        const header = `## ${skill.emoji || ''} ${skill.name}${skill.description ? ` - ${skill.description}` : ''}`;
        sections.push(`${header}\n\n${skill.content}`);
      }
    }

    return sections.join('\n\n---\n\n');
  }

  function reload(): void {
    loadAll();
  }

  function stopWatching(): void {
    // No file watching in this simplified version
  }

  return {
    skills,
    getSkill,
    getEnabledSkills,
    getSkillContext,
    getSkillContextForMessage,
    reload,
    stopWatching,
  };
}
