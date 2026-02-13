/**
 * SKILL.md Frontmatter Parser
 */

import YAML from 'yaml';

export interface SkillGates {
  bins?: string[];
  anyBins?: string[];
  envs?: string[];
  os?: string[];
  config?: string[];
}

export interface SkillFrontmatter {
  name?: string;
  emoji?: string;
  description?: string;
  category?: string;
  homepage?: string;
  gates?: SkillGates;
  userInvocable?: boolean;
  modelInvocable?: boolean;
  commandDispatch?: string;
  commandTool?: string;
  commandArgMode?: string;
}

export function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }
  try {
    const frontmatter = YAML.parse(match[1]) as SkillFrontmatter;
    return { frontmatter: frontmatter || {}, body: match[2] };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

export function mergeGates(a?: SkillGates, b?: SkillGates): SkillGates {
  if (!a && !b) return {};
  if (!a) return { ...b };
  if (!b) return { ...a };
  return {
    bins: [...(a.bins || []), ...(b.bins || [])],
    anyBins: [...(a.anyBins || []), ...(b.anyBins || [])],
    envs: [...(a.envs || []), ...(b.envs || [])],
    os: a.os || b.os,
    config: [...(a.config || []), ...(b.config || [])],
  };
}

export function resolveMetadata(_fm: SkillFrontmatter): null {
  return null; // No OpenClaw metadata for FlipAgent
}
