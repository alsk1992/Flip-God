// =============================================================================
// SECURITY SHIELD — Shared Types
// =============================================================================
// Generic security types for code scanning, input sanitization, and the
// unified security shield facade. Crypto-specific types (chain, scam, tx)
// have been intentionally excluded.

/** Code scan detection categories */
export type CodeScanCategory =
  | 'shell_exec'
  | 'network_exfil'
  | 'wallet_drain'
  | 'prompt_injection'
  | 'obfuscation'
  | 'hidden_chars'
  | 'data_access'
  | 'crypto_theft'
  | 'privilege_escalation';

export interface CodeScanDetection {
  category: CodeScanCategory;
  pattern: string;
  description: string;
  weight: number;
  line?: number;
}

export type RiskLevel = 'clean' | 'low' | 'medium' | 'high' | 'critical';

export interface CodeScanResult {
  score: number;
  level: RiskLevel;
  detections: CodeScanDetection[];
  entropy?: number;
}

/** Input sanitizer types */
export interface SanitizeThreat {
  type: string;
  description: string;
  position: number;
}

export interface SanitizeResult {
  clean: string;
  threats: SanitizeThreat[];
  modified: boolean;
}

/** Security shield config (generic — no RPC / chain config) */
export interface SecurityShieldConfig {
  /** Enable verbose logging of scan results */
  verbose?: boolean;
}

export interface SecurityStats {
  codeScans: number;
  sanitizations: number;
  threatsBlocked: number;
}
