/**
 * Arbitrage Alert System - Push notifications for profitable opportunities
 *
 * Monitors scan results and sends alerts via configured channels
 * when opportunities meet user-defined criteria.
 */

import { createLogger } from '../utils/logger';
import type { Opportunity, Platform } from '../types';

const logger = createLogger('alerts');

// =============================================================================
// TYPES
// =============================================================================

export interface AlertRule {
  id: string;
  userId: string;
  name: string;
  enabled: boolean;
  conditions: AlertConditions;
  channels: AlertChannel[];
  cooldownMinutes: number;
  createdAt: Date;
}

export interface AlertConditions {
  minMarginPct?: number;
  maxBuyPrice?: number;
  minProfit?: number;
  platforms?: Platform[];
  categories?: string[];
  keywords?: string[];
  excludeKeywords?: string[];
  minScore?: number;
}

export interface AlertChannel {
  type: 'telegram' | 'discord' | 'webhook' | 'email';
  target: string;
}

export interface AlertEvent {
  ruleId: string;
  opportunity: Opportunity;
  matchedAt: Date;
}

// =============================================================================
// ALERT MANAGER
// =============================================================================

export interface AlertManager {
  addRule(rule: AlertRule): void;
  removeRule(ruleId: string): void;
  getRules(userId: string): AlertRule[];
  evaluate(opportunities: Opportunity[]): AlertEvent[];
  formatAlert(event: AlertEvent): string;
}

export function createAlertManager(): AlertManager {
  const rules = new Map<string, AlertRule>();
  const lastAlerted = new Map<string, number>();

  function matchesConditions(opp: Opportunity, cond: AlertConditions): boolean {
    if (cond.minMarginPct != null && opp.marginPct < cond.minMarginPct) return false;
    if (cond.maxBuyPrice != null && opp.buyPrice > cond.maxBuyPrice) return false;
    if (cond.minProfit != null && opp.estimatedProfit < cond.minProfit) return false;
    if (cond.minScore != null && opp.score < cond.minScore) return false;
    if (cond.platforms && cond.platforms.length > 0) {
      if (!cond.platforms.includes(opp.buyPlatform) && !cond.platforms.includes(opp.sellPlatform)) return false;
    }
    return true;
  }

  function isInCooldown(ruleId: string, oppId: string, cooldownMinutes: number): boolean {
    const key = `${ruleId}:${oppId}`;
    const last = lastAlerted.get(key);
    if (!last) return false;
    return Date.now() - last < cooldownMinutes * 60 * 1000;
  }

  return {
    addRule(rule: AlertRule) {
      rules.set(rule.id, rule);
      logger.info({ ruleId: rule.id, name: rule.name }, 'Alert rule added');
    },

    removeRule(ruleId: string) {
      rules.delete(ruleId);
      logger.info({ ruleId }, 'Alert rule removed');
    },

    getRules(userId: string): AlertRule[] {
      return [...rules.values()].filter(r => r.userId === userId);
    },

    evaluate(opportunities: Opportunity[]): AlertEvent[] {
      const events: AlertEvent[] = [];

      for (const rule of rules.values()) {
        if (!rule.enabled) continue;
        for (const opp of opportunities) {
          if (!matchesConditions(opp, rule.conditions)) continue;
          if (isInCooldown(rule.id, opp.id, rule.cooldownMinutes)) continue;

          lastAlerted.set(`${rule.id}:${opp.id}`, Date.now());
          events.push({ ruleId: rule.id, opportunity: opp, matchedAt: new Date() });
        }
      }

      // Prune old cooldown entries (keep last 10000)
      if (lastAlerted.size > 10000) {
        const entries = [...lastAlerted.entries()].sort((a, b) => b[1] - a[1]);
        lastAlerted.clear();
        for (const [k, v] of entries.slice(0, 5000)) {
          lastAlerted.set(k, v);
        }
      }

      if (events.length > 0) {
        logger.info({ count: events.length }, 'Alert events generated');
      }
      return events;
    },

    formatAlert(event: AlertEvent): string {
      const opp = event.opportunity;
      const rule = rules.get(event.ruleId);
      const header = rule ? `Arbitrage Alert \u2014 ${rule.name}` : 'Arbitrage Alert';
      const lines = [
        `*${header}*`,
        '',
        `Product: ${opp.productId}`,
        `Buy: $${opp.buyPrice.toFixed(2)} on ${opp.buyPlatform}`,
        `Sell: $${opp.sellPrice.toFixed(2)} on ${opp.sellPlatform}`,
        `Profit: $${opp.estimatedProfit.toFixed(2)} (${opp.marginPct.toFixed(1)}% margin)`,
        `Score: ${opp.score}/100`,
      ];
      return lines.join('\n');
    },
  };
}
