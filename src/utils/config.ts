/**
 * Configuration loading and management for FlipGod
 *
 * Loads config from ~/.flipagent/.env and ~/.flipagent/flipagent.json
 */

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { config as dotenvConfig } from 'dotenv';
import type { Config, Platform } from '../types';
import { ALL_PLATFORMS } from '../types';
import { createLogger } from './logger';

const logger = createLogger('config');

// Load .env file from ~/.flipagent/.env first, then CWD fallback
dotenvConfig({ path: join(homedir(), '.flipagent', '.env') });
dotenvConfig(); // CWD fallback (won't override existing vars)

function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('~')) {
    return resolve(trimmed.replace(/^~(?=$|[\\/])/, homedir()));
  }
  return resolve(trimmed);
}

export function resolveStateDir(env = process.env): string {
  const override = env.FLIPAGENT_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  return join(homedir(), '.flipagent');
}

function resolveConfigPath(env = process.env): string {
  const override = env.FLIPAGENT_CONFIG_PATH?.trim();
  if (override) return resolveUserPath(override);
  return join(resolveStateDir(env), 'flipagent.json');
}

const CONFIG_DIR = resolveStateDir();
const CONFIG_FILE = resolveConfigPath();

const DEFAULT_CONFIG: Config = {
  gateway: {
    port: 18790,
    auth: {},
  },
  agents: {
    defaults: {
      model: { primary: 'anthropic/claude-sonnet-4-5-20250929' },
    },
  },
  session: {
    cleanup: {
      enabled: true,
      maxAgeDays: 30,
      idleDays: 14,
    },
  },
  channels: {
    webchat: {
      enabled: true,
    },
  },
  http: {
    enabled: true,
    defaultRateLimit: { maxRequests: 60, windowMs: 60_000 },
    perHost: {},
    retry: {
      enabled: true,
      maxAttempts: 3,
      minDelay: 500,
      maxDelay: 30_000,
      jitter: 0.1,
      backoffMultiplier: 2,
      methods: ['GET', 'HEAD', 'OPTIONS'],
    },
  },
  arbitrage: {
    enabled: false,
    scanIntervalMs: 5 * 60 * 1000,
    minMarginPct: 15,
    maxResults: 50,
    platforms: [...ALL_PLATFORMS] as Platform[],
  },
};

/**
 * Substitute environment variables in config values.
 * Supports ${VAR_NAME} syntax.
 */
function substituteEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, varName: string) => {
      return process.env[varName] ?? '';
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(substituteEnvVars);
  }
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVars(value);
    }
    return result;
  }
  return obj;
}

/**
 * Deep merge two objects. Protects against prototype pollution.
 */
function deepMerge<T>(target: T, source: Partial<T>): T {
  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const result = { ...target };
  for (const key in source) {
    if (DANGEROUS_KEYS.has(key)) continue;
    const sourceValue = source[key];
    const targetValue = (target as Record<string, unknown>)[key];

    if (
      sourceValue &&
      typeof sourceValue === 'object' &&
      !Array.isArray(sourceValue) &&
      targetValue &&
      typeof targetValue === 'object' &&
      !Array.isArray(targetValue)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>
      );
    } else if (sourceValue !== undefined) {
      (result as Record<string, unknown>)[key] = sourceValue;
    }
  }
  return result;
}

/**
 * Load configuration from file and environment
 */
export async function loadConfig(customPath?: string): Promise<Config> {
  let fileConfig: Partial<Config> = {};

  const configPath = customPath ?? CONFIG_FILE;
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(content) as Partial<Config>;
    } catch (err) {
      logger.error({ configPath, error: err }, 'Failed to parse config file');
    }
  }

  // Merge with defaults
  const merged = deepMerge(DEFAULT_CONFIG, fileConfig);

  // Substitute environment variables
  const config = substituteEnvVars(merged) as Config;

  return config;
}

export { CONFIG_DIR, CONFIG_FILE };
