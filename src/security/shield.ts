// =============================================================================
// SECURITY SHIELD — Facade
// =============================================================================
// Unified entry point wrapping code-scanner and sanitizer.
// Named "shield" to avoid collision with existing src/security/index.ts
// (auth/access module).

import type {
  CodeScanResult,
  SanitizeResult,
  SecurityShieldConfig,
  SecurityStats,
} from './types';

import { scanCode } from './code-scanner';
import { sanitizeInput } from './sanitizer';

// -- Interface ----------------------------------------------------------------

export interface SecurityShield {
  scanCode(code: string): CodeScanResult;
  sanitize(input: string): SanitizeResult;
  getStats(): SecurityStats;
}

// -- Implementation -----------------------------------------------------------

export function createSecurityShield(_config?: SecurityShieldConfig): SecurityShield {
  const stats: SecurityStats = {
    codeScans: 0,
    sanitizations: 0,
    threatsBlocked: 0,
  };

  return {
    scanCode(code: string): CodeScanResult {
      stats.codeScans++;
      const result = scanCode(code);
      if (result.level === 'high' || result.level === 'critical') stats.threatsBlocked++;
      return result;
    },

    sanitize(input: string): SanitizeResult {
      stats.sanitizations++;
      const result = sanitizeInput(input);
      if (result.threats.length > 0) stats.threatsBlocked++;
      return result;
    },

    getStats(): SecurityStats {
      return { ...stats };
    },
  };
}

// -- Singleton ----------------------------------------------------------------

let _instance: SecurityShield | null = null;

export function initSecurityShield(config?: SecurityShieldConfig): SecurityShield {
  _instance = createSecurityShield(config);
  return _instance;
}

export function getSecurityShield(): SecurityShield {
  if (!_instance) _instance = createSecurityShield();
  return _instance;
}
