/**
 * Migration 016 - Tax rates seed data
 *
 * Creates tax_rates table and seeds it with US state sales tax rates.
 * Rates are STATE-level only; local/county rates vary.
 */

import type { Database } from './index';

/** US state sales tax rates as of 2025. State-level rates only. */
const US_STATE_TAX_RATES: Array<[string, string, number, boolean]> = [
  // [state_code, state_name, rate_pct, has_local_tax]
  ['AL', 'Alabama', 4.00, true],
  ['AK', 'Alaska', 0.00, true],       // No state tax, but localities can levy
  ['AZ', 'Arizona', 5.60, true],
  ['AR', 'Arkansas', 6.50, true],
  ['CA', 'California', 7.25, true],
  ['CO', 'Colorado', 2.90, true],
  ['CT', 'Connecticut', 6.35, false],
  ['DE', 'Delaware', 0.00, false],     // No sales tax
  ['FL', 'Florida', 6.00, true],
  ['GA', 'Georgia', 4.00, true],
  ['HI', 'Hawaii', 4.00, true],
  ['ID', 'Idaho', 6.00, true],
  ['IL', 'Illinois', 6.25, true],
  ['IN', 'Indiana', 7.00, false],
  ['IA', 'Iowa', 6.00, true],
  ['KS', 'Kansas', 6.50, true],
  ['KY', 'Kentucky', 6.00, false],
  ['LA', 'Louisiana', 4.45, true],
  ['ME', 'Maine', 5.50, false],
  ['MD', 'Maryland', 6.00, false],
  ['MA', 'Massachusetts', 6.25, false],
  ['MI', 'Michigan', 6.00, false],
  ['MN', 'Minnesota', 6.875, true],
  ['MS', 'Mississippi', 7.00, false],
  ['MO', 'Missouri', 4.225, true],
  ['MT', 'Montana', 0.00, false],     // No sales tax
  ['NE', 'Nebraska', 5.50, true],
  ['NV', 'Nevada', 6.85, true],
  ['NH', 'New Hampshire', 0.00, false], // No sales tax
  ['NJ', 'New Jersey', 6.625, false],
  ['NM', 'New Mexico', 4.875, true],
  ['NY', 'New York', 4.00, true],
  ['NC', 'North Carolina', 4.75, true],
  ['ND', 'North Dakota', 5.00, true],
  ['OH', 'Ohio', 5.75, true],
  ['OK', 'Oklahoma', 4.50, true],
  ['OR', 'Oregon', 0.00, false],       // No sales tax
  ['PA', 'Pennsylvania', 6.00, true],
  ['RI', 'Rhode Island', 7.00, false],
  ['SC', 'South Carolina', 6.00, true],
  ['SD', 'South Dakota', 4.20, true],
  ['TN', 'Tennessee', 7.00, true],
  ['TX', 'Texas', 6.25, true],
  ['UT', 'Utah', 6.10, true],
  ['VT', 'Vermont', 6.00, true],
  ['VA', 'Virginia', 5.30, true],
  ['WA', 'Washington', 6.50, true],
  ['WV', 'West Virginia', 6.00, true],
  ['WI', 'Wisconsin', 5.00, true],
  ['WY', 'Wyoming', 4.00, true],
  ['DC', 'District of Columbia', 6.00, false],
];

/** Programmatic UP migration: create table + seed data. */
export function MIGRATION_016_UP(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS tax_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      state_code TEXT NOT NULL UNIQUE,
      state_name TEXT NOT NULL,
      rate_pct REAL NOT NULL,
      has_local_tax INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_tax_rates_state ON tax_rates(state_code)');

  // Seed all US state tax rates
  for (const [stateCode, stateName, rate, hasLocal] of US_STATE_TAX_RATES) {
    db.run(
      `INSERT OR IGNORE INTO tax_rates (state_code, state_name, rate_pct, has_local_tax, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [stateCode, stateName, rate, hasLocal ? 1 : 0, Date.now()],
    );
  }
}

export const MIGRATION_016_DOWN = `
  DROP TABLE IF EXISTS tax_rates;
`;
