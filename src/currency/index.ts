/**
 * Currency Module - Multi-currency support, conversion, landed cost, and pricing
 *
 * Exports tool definitions and a handler function for wiring into the agent.
 */

import type { Database } from '../db/index.js';

// =============================================================================
// Static Exchange Rates (USD base)
// =============================================================================

const EXCHANGE_RATES: Record<string, number> = {
  USD: 1.0,
  GBP: 0.79,
  EUR: 0.92,
  CAD: 1.36,
  AUD: 1.53,
  JPY: 149.5,
  CNY: 7.24,
  MXN: 17.15,
  INR: 83.12,
  BRL: 4.97,
};

const SUPPORTED_CURRENCIES = Object.keys(EXCHANGE_RATES);

/**
 * Convert an amount from one currency to another via USD cross-rate.
 */
function convertAmount(amount: number, from: string, to: string): number {
  const fromRate = EXCHANGE_RATES[from.toUpperCase()];
  const toRate = EXCHANGE_RATES[to.toUpperCase()];
  if (fromRate == null || toRate == null) {
    throw new Error(
      'Unsupported currency. Supported: ' + SUPPORTED_CURRENCIES.join(', '),
    );
  }
  const usdAmount = amount / fromRate;
  return Math.round(usdAmount * toRate * 100) / 100;
}

/**
 * Estimate import duty rate by destination country.
 */
function estimateDutyRate(destinationCountry: string, _hsCode?: string): number {
  const dutyRates: Record<string, number> = {
    US: 0.05,
    GB: 0.04,
    EU: 0.045,
    CA: 0.06,
    AU: 0.05,
    JP: 0.03,
    CN: 0.08,
    MX: 0.07,
    IN: 0.10,
    BR: 0.12,
  };
  return dutyRates[destinationCountry.toUpperCase()] ?? 0.05;
}

/**
 * Estimate international shipping cost per kg by destination.
 */
function estimateShippingCost(destinationCountry: string, weightKg: number): number {
  const baseCostPerKg: Record<string, number> = {
    US: 8.0,
    GB: 12.0,
    EU: 11.0,
    CA: 9.0,
    AU: 15.0,
    JP: 14.0,
    CN: 10.0,
    MX: 9.5,
    IN: 13.0,
    BR: 16.0,
  };
  const rate = baseCostPerKg[destinationCountry.toUpperCase()] ?? 12.0;
  return Math.max(5.0, Math.round(rate * weightKg * 100) / 100);
}

/**
 * Apply psychological rounding for a currency (.99 endings, etc.).
 */
function applyRounding(price: number, currency: string): number {
  const cur = currency.toUpperCase();
  if (cur === 'JPY' || cur === 'INR') {
    return Math.round(price / 10) * 10 - 1;
  }
  return Math.floor(price) + 0.99;
}

// =============================================================================
// Tool Definitions
// =============================================================================

export const currencyTools = [
  {
    name: 'convert_currency',
    description: 'Convert between currencies using exchange rates',
    input_schema: {
      type: 'object' as const,
      properties: {
        amount: { type: 'number' as const, description: 'Amount to convert' },
        from_currency: {
          type: 'string' as const,
          description: 'Source currency code (e.g. USD, GBP, EUR)',
        },
        to_currency: {
          type: 'string' as const,
          description: 'Target currency code',
        },
      },
      required: ['amount', 'from_currency', 'to_currency'],
    },
  },
  {
    name: 'set_currency_preference',
    description: "Set user's preferred display currency",
    input_schema: {
      type: 'object' as const,
      properties: {
        currency_code: {
          type: 'string' as const,
          description: 'Preferred currency code (e.g. USD, GBP, EUR)',
        },
      },
      required: ['currency_code'],
    },
  },
  {
    name: 'get_exchange_rates',
    description: 'Get all current exchange rates relative to USD',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'calculate_landed_cost',
    description:
      'Calculate total landed cost including conversion, duty, and shipping for international sourcing',
    input_schema: {
      type: 'object' as const,
      properties: {
        product_cost: {
          type: 'number' as const,
          description: 'Product cost in source currency',
        },
        currency: {
          type: 'string' as const,
          description: 'Source currency code',
        },
        destination_country: {
          type: 'string' as const,
          description: 'Two-letter destination country code (e.g. US, GB, AU)',
        },
        weight_kg: {
          type: 'number' as const,
          description: 'Product weight in kilograms',
        },
        hs_code: {
          type: 'string' as const,
          description: 'Harmonized System code for duty estimation (optional)',
        },
      },
      required: ['product_cost', 'currency', 'destination_country', 'weight_kg'],
    },
  },
  {
    name: 'multi_currency_pricing',
    description:
      'Calculate optimal prices in multiple currencies for a product',
    input_schema: {
      type: 'object' as const,
      properties: {
        base_price_usd: {
          type: 'number' as const,
          description: 'Base price in USD',
        },
        target_currencies: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description: 'Array of target currency codes',
        },
      },
      required: ['base_price_usd', 'target_currencies'],
    },
  },
];

// =============================================================================
// Tool Handler
// =============================================================================

export function handleCurrencyTool(
  db: Database,
  toolName: string,
  input: Record<string, unknown>,
): { success: boolean; data?: unknown; error?: string } {
  try {
    switch (toolName) {
      case 'convert_currency': {
        const amount = input.amount as number;
        const from = input.from_currency as string;
        const to = input.to_currency as string;
        if (!Number.isFinite(amount))
          return { success: false, error: 'amount must be a valid number' };
        if (!from || !to)
          return {
            success: false,
            error: 'from_currency and to_currency are required',
          };

        const converted = convertAmount(amount, from, to);
        const rate = converted / amount;

        return {
          success: true,
          data: {
            original_amount: amount,
            from_currency: from.toUpperCase(),
            converted_amount: converted,
            to_currency: to.toUpperCase(),
            exchange_rate: Math.round(rate * 10000) / 10000,
          },
        };
      }

      case 'set_currency_preference': {
        const code = (input.currency_code as string)?.toUpperCase();
        if (!code)
          return { success: false, error: 'currency_code is required' };
        if (!EXCHANGE_RATES[code]) {
          return {
            success: false,
            error: `Unsupported currency: ${code}. Supported: ${SUPPORTED_CURRENCIES.join(', ')}`,
          };
        }

        db.run(
          `INSERT INTO currency_preferences (user_id, currency_code, updated_at)
           VALUES ('default', ?, datetime('now'))
           ON CONFLICT(user_id) DO UPDATE SET currency_code = excluded.currency_code, updated_at = datetime('now')`,
          [code],
        );

        return {
          success: true,
          data: {
            currency_code: code,
            message: `Display currency set to ${code}`,
          },
        };
      }

      case 'get_exchange_rates': {
        const rates = Object.entries(EXCHANGE_RATES).map(
          ([currency, rate]) => ({
            currency,
            rate_vs_usd: rate,
            inverse: Math.round((1 / rate) * 10000) / 10000,
          }),
        );
        return { success: true, data: { base: 'USD', rates } };
      }

      case 'calculate_landed_cost': {
        const productCost = input.product_cost as number;
        const currency = input.currency as string;
        const destination = input.destination_country as string;
        const weightKg = input.weight_kg as number;
        const hsCode = input.hs_code as string | undefined;

        if (!Number.isFinite(productCost))
          return {
            success: false,
            error: 'product_cost must be a valid number',
          };
        if (!currency)
          return { success: false, error: 'currency is required' };
        if (!destination)
          return {
            success: false,
            error: 'destination_country is required',
          };
        if (!Number.isFinite(weightKg) || weightKg <= 0)
          return {
            success: false,
            error: 'weight_kg must be a positive number',
          };

        const costUsd = convertAmount(productCost, currency, 'USD');
        const dutyRate = estimateDutyRate(destination, hsCode);
        const dutyAmount = Math.round(costUsd * dutyRate * 100) / 100;
        const shippingCost = estimateShippingCost(destination, weightKg);
        const totalLandedCost =
          Math.round((costUsd + dutyAmount + shippingCost) * 100) / 100;

        return {
          success: true,
          data: {
            product_cost_original: productCost,
            source_currency: currency.toUpperCase(),
            product_cost_usd: costUsd,
            duty_rate: dutyRate,
            duty_amount_usd: dutyAmount,
            shipping_cost_usd: shippingCost,
            total_landed_cost_usd: totalLandedCost,
            destination_country: destination.toUpperCase(),
            weight_kg: weightKg,
            hs_code: hsCode ?? null,
          },
        };
      }

      case 'multi_currency_pricing': {
        const basePriceUsd = input.base_price_usd as number;
        const targetCurrencies = input.target_currencies as string[];

        if (!Number.isFinite(basePriceUsd))
          return {
            success: false,
            error: 'base_price_usd must be a valid number',
          };
        if (!Array.isArray(targetCurrencies) || targetCurrencies.length === 0) {
          return {
            success: false,
            error: 'target_currencies must be a non-empty array',
          };
        }

        const prices = targetCurrencies.map((cur) => {
          const code = cur.toUpperCase();
          if (!EXCHANGE_RATES[code]) {
            return { currency: code, error: 'Unsupported currency' };
          }
          const rawConverted = convertAmount(basePriceUsd, 'USD', code);
          const roundedPrice = applyRounding(rawConverted, code);
          return {
            currency: code,
            raw_converted: rawConverted,
            optimal_price: roundedPrice,
            exchange_rate: EXCHANGE_RATES[code],
          };
        });

        return {
          success: true,
          data: { base_price_usd: basePriceUsd, prices },
        };
      }

      default:
        return { success: false, error: `Unknown currency tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
