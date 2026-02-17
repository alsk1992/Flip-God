/**
 * Configuration — loads and validates environment variables
 */

import { z } from 'zod';

const configSchema = z.object({
  port: z.coerce.number().default(18791),
  nodeEnv: z.enum(['development', 'production', 'test']).default('production'),
  databaseUrl: z.string().min(1),
  jwtSecret: z.string().min(32),
  jwtRefreshSecret: z.string().min(32),
  corsOrigins: z.string().default(''),
  logLevel: z.string().default('info'),
  // Solana token gate
  solanaTokenMint: z.string().default(''),       // SPL token mint address
  solanaRpcUrl: z.string().default('https://api.mainnet-beta.solana.com'),
  solanaMinBalance: z.coerce.number().default(1), // Minimum tokens to hold for premium
  solanaTokenDecimals: z.coerce.number().default(9),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(): AppConfig {
  return configSchema.parse({
    port: process.env.PORT,
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
    corsOrigins: process.env.CORS_ORIGINS,
    logLevel: process.env.LOG_LEVEL,
    solanaTokenMint: process.env.SOLANA_TOKEN_MINT,
    solanaRpcUrl: process.env.SOLANA_RPC_URL,
    solanaMinBalance: process.env.SOLANA_MIN_BALANCE,
    solanaTokenDecimals: process.env.SOLANA_TOKEN_DECIMALS,
  });
}
