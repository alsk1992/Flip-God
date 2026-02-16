/**
 * Advanced Rule Engine Enhancements
 *
 * Adds expression-based pricing, time-conditional rules, and cross-platform
 * reactive pricing on top of the existing rule engine.
 *
 * Key features:
 * - Safe math expression parser (recursive descent, NO eval())
 * - Time-of-day / day-of-week conditional pricing
 * - Cross-platform reactive rules
 */

import { createLogger } from '../utils/logger.js';
import { generateId } from '../utils/id.js';
import type { Database } from '../db/index.js';

const logger = createLogger('advanced-rules');

// =============================================================================
// EXPRESSION PARSER — Recursive Descent (Safe, no eval)
// =============================================================================

/** Token types for the expression lexer */
type TokenType = 'NUMBER' | 'IDENT' | 'OP' | 'LPAREN' | 'RPAREN' | 'COMMA' | 'PERCENT' | 'EOF';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

/**
 * Tokenize a math expression string.
 */
function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = expr.length;

  while (i < len) {
    const ch = expr[i];

    // Whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Numbers (including decimals)
    if ((ch >= '0' && ch <= '9') || (ch === '.' && i + 1 < len && expr[i + 1] >= '0' && expr[i + 1] <= '9')) {
      let num = '';
      const start = i;
      let hasDot = false;
      while (i < len && ((expr[i] >= '0' && expr[i] <= '9') || (expr[i] === '.' && !hasDot))) {
        if (expr[i] === '.') hasDot = true;
        num += expr[i];
        i++;
      }
      tokens.push({ type: 'NUMBER', value: num, pos: start });
      continue;
    }

    // Identifiers (variable names and function names)
    if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_') {
      let ident = '';
      const start = i;
      while (i < len && ((expr[i] >= 'a' && expr[i] <= 'z') || (expr[i] >= 'A' && expr[i] <= 'Z') || (expr[i] >= '0' && expr[i] <= '9') || expr[i] === '_')) {
        ident += expr[i];
        i++;
      }
      tokens.push({ type: 'IDENT', value: ident, pos: start });
      continue;
    }

    // Operators
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'OP', value: ch, pos: i });
      i++;
      continue;
    }

    // Parentheses
    if (ch === '(') {
      tokens.push({ type: 'LPAREN', value: '(', pos: i });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'RPAREN', value: ')', pos: i });
      i++;
      continue;
    }

    // Comma
    if (ch === ',') {
      tokens.push({ type: 'COMMA', value: ',', pos: i });
      i++;
      continue;
    }

    // Percent sign
    if (ch === '%') {
      tokens.push({ type: 'PERCENT', value: '%', pos: i });
      i++;
      continue;
    }

    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }

  tokens.push({ type: 'EOF', value: '', pos: len });
  return tokens;
}

/**
 * Recursive descent parser for math expressions.
 *
 * Grammar:
 *   expr     = term (('+' | '-') term)*
 *   term     = unary (('*' | '/') unary)*
 *   unary    = ('-')? primary
 *   primary  = NUMBER ('%')?
 *            | IDENT '(' arglist ')'   -- function call
 *            | IDENT ('%')?            -- variable, optionally as percentage
 *            | '(' expr ')'
 *   arglist  = expr (',' expr)*
 */
class ExprParser {
  private tokens: Token[];
  private pos: number;
  private variables: Record<string, number>;
  private contextValue: number | null; // The value that '%' operates on (e.g., 'cost')

  constructor(tokens: Token[], variables: Record<string, number>, contextValue: number | null = null) {
    this.tokens = tokens;
    this.pos = 0;
    this.variables = variables;
    this.contextValue = contextValue;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private eat(expectedType?: TokenType): Token {
    const token = this.tokens[this.pos];
    if (expectedType && token.type !== expectedType) {
      throw new Error(`Expected ${expectedType} but got ${token.type} ('${token.value}') at position ${token.pos}`);
    }
    this.pos++;
    return token;
  }

  parse(): number {
    const result = this.parseExpr();
    if (this.peek().type !== 'EOF') {
      throw new Error(`Unexpected token '${this.peek().value}' at position ${this.peek().pos}`);
    }
    if (!Number.isFinite(result)) {
      throw new Error('Expression evaluated to non-finite number');
    }
    return result;
  }

  private parseExpr(): number {
    let left = this.parseTerm();

    while (this.peek().type === 'OP' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.eat().value;
      const right = this.parseTerm();
      if (op === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  private parseTerm(): number {
    let left = this.parseUnary();

    while (this.peek().type === 'OP' && (this.peek().value === '*' || this.peek().value === '/')) {
      const op = this.eat().value;
      const right = this.parseUnary();
      if (op === '*') {
        left = left * right;
      } else {
        if (right === 0) {
          throw new Error('Division by zero');
        }
        left = left / right;
      }
    }

    return left;
  }

  private parseUnary(): number {
    if (this.peek().type === 'OP' && this.peek().value === '-') {
      this.eat();
      return -this.parsePrimary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const token = this.peek();

    // Number literal
    if (token.type === 'NUMBER') {
      this.eat();
      let value = parseFloat(token.value);
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid number: ${token.value}`);
      }

      // Check for percent sign after number
      if (this.peek().type === 'PERCENT') {
        this.eat();
        // N% means N/100 of context value, or just N/100 if no context
        if (this.contextValue !== null && Number.isFinite(this.contextValue)) {
          value = this.contextValue * (value / 100);
        } else {
          value = value / 100;
        }
      }

      return value;
    }

    // Identifier (variable or function call)
    if (token.type === 'IDENT') {
      this.eat();
      const name = token.value.toLowerCase();

      // Check if it's a function call
      if (this.peek().type === 'LPAREN') {
        return this.parseFunctionCall(name);
      }

      // Variable lookup
      // Check multiple case forms
      const varValue = this.variables[name]
        ?? this.variables[token.value]
        ?? undefined;

      if (varValue === undefined) {
        throw new Error(`Unknown variable: ${token.value}`);
      }

      if (!Number.isFinite(varValue)) {
        throw new Error(`Variable '${token.value}' has non-finite value`);
      }

      let result = varValue;

      // Check for percent sign after variable
      if (this.peek().type === 'PERCENT') {
        this.eat();
        // variable% — treat variable value as percentage of context
        if (this.contextValue !== null && Number.isFinite(this.contextValue)) {
          result = this.contextValue * (result / 100);
        } else {
          result = result / 100;
        }
      }

      return result;
    }

    // Parenthesized expression
    if (token.type === 'LPAREN') {
      this.eat();
      const value = this.parseExpr();
      this.eat('RPAREN');
      return value;
    }

    throw new Error(`Unexpected token '${token.value}' at position ${token.pos}`);
  }

  private parseFunctionCall(name: string): number {
    this.eat('LPAREN');

    const args: number[] = [];
    if (this.peek().type !== 'RPAREN') {
      args.push(this.parseExpr());
      while (this.peek().type === 'COMMA') {
        this.eat();
        args.push(this.parseExpr());
      }
    }

    this.eat('RPAREN');

    // Built-in functions
    switch (name) {
      case 'min': {
        if (args.length === 0) throw new Error('min() requires at least one argument');
        return Math.min(...args);
      }
      case 'max': {
        if (args.length === 0) throw new Error('max() requires at least one argument');
        return Math.max(...args);
      }
      case 'round': {
        if (args.length === 0) throw new Error('round() requires at least one argument');
        const decimals = args.length > 1 ? args[1] : 0;
        if (!Number.isFinite(decimals) || decimals < 0) {
          return Math.round(args[0]);
        }
        const factor = Math.pow(10, Math.floor(decimals));
        return Math.round(args[0] * factor) / factor;
      }
      case 'floor': {
        if (args.length === 0) throw new Error('floor() requires at least one argument');
        return Math.floor(args[0]);
      }
      case 'ceil': {
        if (args.length === 0) throw new Error('ceil() requires at least one argument');
        return Math.ceil(args[0]);
      }
      case 'abs': {
        if (args.length === 0) throw new Error('abs() requires at least one argument');
        return Math.abs(args[0]);
      }
      default:
        throw new Error(`Unknown function: ${name}`);
    }
  }
}

// =============================================================================
// PUBLIC: EXPRESSION EVALUATION
// =============================================================================

/**
 * Safely evaluate a math expression with variable substitution.
 *
 * Supports:
 *   - Arithmetic: +, -, *, /
 *   - Percentages: `cost + 25%` (25% of context value)
 *   - Functions: min(), max(), round(), floor(), ceil(), abs()
 *   - Variables: cost, competitor_min, competitor_avg, competitor_max,
 *     current_price, days_listed, sales_velocity
 *
 * @param expression - The math expression to evaluate
 * @param variables - Variable name -> value mapping
 * @param contextValue - Optional context value for % operator (defaults to 'cost' variable)
 * @returns The evaluated result
 */
export function evaluateExpression(
  expression: string,
  variables: Record<string, number>,
  contextValue?: number,
): number {
  if (!expression?.trim()) {
    throw new Error('Expression is empty');
  }

  // Normalize variable names to lowercase for lookup
  const normalizedVars: Record<string, number> = {};
  for (const [key, val] of Object.entries(variables)) {
    if (Number.isFinite(val)) {
      normalizedVars[key.toLowerCase()] = val;
    }
  }

  // Determine context value for % operator
  const ctx = contextValue ?? normalizedVars.cost ?? normalizedVars.current_price ?? null;

  const tokens = tokenize(expression);
  const parser = new ExprParser(tokens, normalizedVars, ctx);
  return parser.parse();
}

// =============================================================================
// TIME CONDITIONS
// =============================================================================

export interface TimeCondition {
  dayOfWeek?: number[];   // 0=Sun, 1=Mon, ..., 6=Sat
  hourRange?: [number, number]; // [startHour, endHour] (24h format)
  dateRange?: [string, string]; // ['YYYY-MM-DD', 'YYYY-MM-DD']
}

/**
 * Evaluate whether the current time matches a time condition.
 */
export function evaluateTimeCondition(condition: TimeCondition, now?: Date): boolean {
  const date = now ?? new Date();

  // Day of week check
  if (condition.dayOfWeek && Array.isArray(condition.dayOfWeek) && condition.dayOfWeek.length > 0) {
    const currentDay = date.getDay();
    if (!condition.dayOfWeek.includes(currentDay)) {
      return false;
    }
  }

  // Hour range check
  if (condition.hourRange && Array.isArray(condition.hourRange) && condition.hourRange.length === 2) {
    const [startHour, endHour] = condition.hourRange;
    const currentHour = date.getHours();

    if (Number.isFinite(startHour) && Number.isFinite(endHour)) {
      if (startHour <= endHour) {
        // Normal range (e.g., 9-17)
        if (currentHour < startHour || currentHour >= endHour) {
          return false;
        }
      } else {
        // Overnight range (e.g., 22-6)
        if (currentHour < startHour && currentHour >= endHour) {
          return false;
        }
      }
    }
  }

  // Date range check
  if (condition.dateRange && Array.isArray(condition.dateRange) && condition.dateRange.length === 2) {
    const [startStr, endStr] = condition.dateRange;
    const startDate = new Date(startStr);
    const endDate = new Date(endStr);

    if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
      // Compare dates only (ignore time)
      const todayStr = date.toISOString().split('T')[0];
      const today = new Date(todayStr);
      const start = new Date(startStr);
      const end = new Date(endStr);

      if (today < start || today > end) {
        return false;
      }
    }
  }

  return true;
}

// =============================================================================
// CROSS-PLATFORM RULES
// =============================================================================

export interface CrossPlatformRule {
  id: string;
  name: string;
  watchPlatform: string;
  adjustPlatform: string;
  trigger: 'price_drop' | 'price_increase' | 'undercut';
  adjustmentPct: number;
  minPrice: number;
  createdAt: number;
}

export interface CrossPlatformEvalResult {
  triggered: boolean;
  adjustPlatform: string;
  oldPrice: number | null;
  newPrice: number | null;
  reason: string;
}

/**
 * Evaluate a cross-platform rule against market data.
 *
 * @param rule - The cross-platform rule definition
 * @param listings - All active listings for the product
 * @param marketData - Price data from the watched platform
 */
export function evaluateCrossPlatformRule(
  rule: CrossPlatformRule,
  listings: Array<{ platform: string; price: number; product_id: string }>,
  marketData: { competitorPrices: Record<string, number[]> },
): CrossPlatformEvalResult {
  // Find the listing on the adjust platform
  const adjustListing = listings.find(
    (l) => l.platform.toLowerCase() === rule.adjustPlatform.toLowerCase(),
  );
  if (!adjustListing) {
    return {
      triggered: false,
      adjustPlatform: rule.adjustPlatform,
      oldPrice: null,
      newPrice: null,
      reason: `No active listing found on ${rule.adjustPlatform}`,
    };
  }

  // Get competitor prices on the watched platform
  const watchedPrices = marketData.competitorPrices[rule.watchPlatform.toLowerCase()] ?? [];
  const validPrices = watchedPrices.filter((p) => Number.isFinite(p) && p > 0);

  if (validPrices.length === 0) {
    return {
      triggered: false,
      adjustPlatform: rule.adjustPlatform,
      oldPrice: adjustListing.price,
      newPrice: null,
      reason: `No competitor prices available on ${rule.watchPlatform}`,
    };
  }

  const lowestWatched = Math.min(...validPrices);
  const currentPrice = adjustListing.price;
  let newPrice: number | null = null;
  let reason = '';
  let triggered = false;

  switch (rule.trigger) {
    case 'price_drop': {
      // If watched platform prices dropped below our price, reduce ours
      if (lowestWatched < currentPrice) {
        newPrice = Math.round(currentPrice * (1 - rule.adjustmentPct / 100) * 100) / 100;
        reason = `${rule.watchPlatform} lowest price ($${lowestWatched.toFixed(2)}) below our ${rule.adjustPlatform} price ($${currentPrice.toFixed(2)}): -${rule.adjustmentPct}%`;
        triggered = true;
      } else {
        reason = `${rule.watchPlatform} lowest ($${lowestWatched.toFixed(2)}) >= our price ($${currentPrice.toFixed(2)}), no action`;
      }
      break;
    }

    case 'price_increase': {
      // If watched platform prices rose above our price, increase ours
      if (lowestWatched > currentPrice) {
        newPrice = Math.round(currentPrice * (1 + rule.adjustmentPct / 100) * 100) / 100;
        reason = `${rule.watchPlatform} lowest price ($${lowestWatched.toFixed(2)}) above our ${rule.adjustPlatform} price ($${currentPrice.toFixed(2)}): +${rule.adjustmentPct}%`;
        triggered = true;
      } else {
        reason = `${rule.watchPlatform} lowest ($${lowestWatched.toFixed(2)}) <= our price ($${currentPrice.toFixed(2)}), no action`;
      }
      break;
    }

    case 'undercut': {
      // Always undercut the lowest watched platform price
      const undercutPrice = Math.round(lowestWatched * (1 - rule.adjustmentPct / 100) * 100) / 100;
      if (Math.abs(undercutPrice - currentPrice) > 0.005) {
        newPrice = undercutPrice;
        reason = `Undercut ${rule.watchPlatform} lowest ($${lowestWatched.toFixed(2)}) by ${rule.adjustmentPct}% on ${rule.adjustPlatform}`;
        triggered = true;
      } else {
        reason = `Already at undercut price ($${currentPrice.toFixed(2)})`;
      }
      break;
    }

    default:
      reason = `Unknown trigger type: ${rule.trigger}`;
  }

  // Enforce min price
  if (newPrice !== null && Number.isFinite(rule.minPrice) && newPrice < rule.minPrice) {
    newPrice = rule.minPrice;
    reason += ` (clamped to min $${rule.minPrice.toFixed(2)})`;
  }

  return {
    triggered,
    adjustPlatform: rule.adjustPlatform,
    oldPrice: currentPrice,
    newPrice,
    reason,
  };
}

// =============================================================================
// DATABASE CRUD
// =============================================================================

export interface CreateExpressionRuleInput {
  userId?: string;
  name: string;
  expression: string;
  platform?: string;
  minPrice?: number;
  maxPrice?: number;
}

export interface CreateTimeRuleInput {
  userId?: string;
  name: string;
  schedules: Array<{
    days?: number[];
    hours?: number[];
    priceAdjustmentPct: number;
  }>;
  platform?: string;
}

export interface CreateCrossPlatformRuleInput {
  userId?: string;
  name: string;
  watchPlatform: string;
  adjustPlatform: string;
  trigger: 'price_drop' | 'price_increase' | 'undercut';
  adjustmentPct: number;
  minPrice?: number;
}

/**
 * Create an expression-based repricing rule.
 */
export function createExpressionRule(db: Database, input: CreateExpressionRuleInput): { id: string; name: string; type: string } {
  // Validate expression by parsing it with dummy variables
  try {
    const dummyVars: Record<string, number> = {
      cost: 10,
      competitor_min: 9,
      competitor_avg: 12,
      competitor_max: 15,
      current_price: 11,
      days_listed: 5,
      sales_velocity: 2,
    };
    evaluateExpression(input.expression, dummyVars);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid expression: ${msg}`);
  }

  const id = generateId('rr');
  const now = Date.now();
  const params = {
    expression: input.expression,
    min_price: input.minPrice,
    max_price: input.maxPrice,
  };

  db.run(
    `INSERT INTO repricing_rules_v2 (id, user_id, name, type, platform, params, priority, enabled, created_at)
     VALUES (?, ?, ?, 'expression_based', ?, ?, 50, 1, ?)`,
    [id, input.userId ?? 'default', input.name, input.platform ?? 'all', JSON.stringify(params), now],
  );

  logger.info({ ruleId: id, name: input.name, expression: input.expression }, 'Expression rule created');
  return { id, name: input.name, type: 'expression_based' };
}

/**
 * Create a time-conditional repricing rule.
 */
export function createTimeRule(db: Database, input: CreateTimeRuleInput): { id: string; name: string; type: string } {
  if (!Array.isArray(input.schedules) || input.schedules.length === 0) {
    throw new Error('At least one schedule entry is required');
  }

  const id = generateId('rr');
  const now = Date.now();
  const params = { schedules: input.schedules };

  db.run(
    `INSERT INTO repricing_rules_v2 (id, user_id, name, type, platform, params, priority, enabled, created_at)
     VALUES (?, ?, ?, 'time_conditional', ?, ?, 50, 1, ?)`,
    [id, input.userId ?? 'default', input.name, input.platform ?? 'all', JSON.stringify(params), now],
  );

  logger.info({ ruleId: id, name: input.name, scheduleCount: input.schedules.length }, 'Time rule created');
  return { id, name: input.name, type: 'time_conditional' };
}

/**
 * Create a cross-platform reactive repricing rule.
 */
export function createCrossPlatformRule(db: Database, input: CreateCrossPlatformRuleInput): { id: string; name: string; type: string } {
  if (!input.watchPlatform) throw new Error('watch_platform is required');
  if (!input.adjustPlatform) throw new Error('adjust_platform is required');
  if (!Number.isFinite(input.adjustmentPct)) throw new Error('adjustment_pct must be a valid number');

  const id = generateId('rr');
  const now = Date.now();
  const params = {
    watch_platform: input.watchPlatform,
    adjust_platform: input.adjustPlatform,
    trigger: input.trigger,
    adjustment_pct: input.adjustmentPct,
    min_price: input.minPrice,
  };

  db.run(
    `INSERT INTO repricing_rules_v2 (id, user_id, name, type, platform, params, priority, enabled, created_at)
     VALUES (?, ?, ?, 'cross_platform', ?, ?, 50, 1, ?)`,
    [id, input.userId ?? 'default', input.name, input.adjustPlatform, JSON.stringify(params), now],
  );

  logger.info({ ruleId: id, name: input.name, watch: input.watchPlatform, adjust: input.adjustPlatform }, 'Cross-platform rule created');
  return { id, name: input.name, type: 'cross_platform' };
}
