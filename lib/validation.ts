import { z } from 'zod';

// ===== INPUT VALIDATION SCHEMAS (Uniswap pattern) =====

// Common input validators
export const AddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');
export const PoolIdSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid pool ID (must be 32-byte hex)');
export const ChainIdSchema = z.coerce.number().int().positive();
export const AmountSchema = z.string().regex(/^\d+$/, 'Amount must be numeric string');

// Pool state request input
export const GetPoolStateInputSchema = z.object({
  poolId: z.string().min(1, 'poolId is required'),
});

// Pool metrics request input
export const GetPoolMetricsInputSchema = z.object({
  poolId: z.string().min(1, 'poolId is required'),
  days: z.coerce.number().int().min(1).max(365).default(7),
});

// Price history request input
export const GetPriceHistoryInputSchema = z.object({
  poolId: z.string().min(1, 'poolId is required'),
  token0: z.string().min(1, 'token0 is required'),
  token1: z.string().min(1, 'token1 is required'),
  duration: z.enum(['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR']).default('WEEK'),
});

// Positions request input
export const GetPositionsInputSchema = z.object({
  owner: AddressSchema,
  chainId: ChainIdSchema.optional(),
});

// Ticks request input
export const GetTicksInputSchema = z.object({
  poolId: z.string().min(1, 'poolId is required'),
});

// Input validation helper - safeParse pattern (identical to Uniswap)
export function validateApiInput<T>(schema: z.ZodSchema<T>, data: unknown, apiName: string): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorMsg = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
    console.warn(`[Validation] ${apiName} input validation failed:`, errorMsg);
    return { success: false, error: errorMsg };
  }
  return { success: true, data: result.data };
}

// ===== RESPONSE VALIDATION SCHEMAS =====

// Pool State API Response Schema
export const PoolStateSchema = z.object({
  poolId: z.string(),
  sqrtPriceX96: z.string(),
  tick: z.number(),
  liquidity: z.string(),
  protocolFee: z.number(),
  lpFee: z.number(),
  currentPrice: z.string(),
  currentPoolTick: z.number(),
});

export type PoolState = z.infer<typeof PoolStateSchema>;

// Liquidity Depth API Response Schema
export const LiquidityDepthSchema = z.object({
  items: z.array(z.object({
    pool: z.string(),
    tickLower: z.number(),
    tickUpper: z.number(),
    liquidity: z.string(),
  })),
});

export type LiquidityDepth = z.infer<typeof LiquidityDepthSchema>;

// Pool Stats API Response Schema
export const PoolStatsSchema = z.object({
  success: z.boolean(),
  pools: z.array(z.object({
    poolId: z.string(),
    tvlUSD: z.number(),
    volume24hUSD: z.number(),
    fees24hUSD: z.number(),
    dynamicFeeBps: z.number(),
    apr: z.number(),
  })),
});

export type PoolStats = z.infer<typeof PoolStatsSchema>;

// Dynamic Fee API Response Schema
export const DynamicFeeSchema = z.object({
  dynamicFee: z.string(),
  dynamicFeeBps: z.number(),
  poolId: z.string(),
  poolName: z.string(),
  unit: z.string(),
  isEstimate: z.boolean(),
  note: z.string(),
});

export type DynamicFee = z.infer<typeof DynamicFeeSchema>;

// Portfolio Activity API Response Schema
export const PortfolioActivitySchema = z.object({
  success: z.boolean(),
  data: z.object({
    transactions: z.array(z.object({
      id: z.string(),
      type: z.string(),
      amount0: z.string(),
      amount1: z.string(),
      timestamp: z.number(),
    })),
  }),
});

export type PortfolioActivity = z.infer<typeof PortfolioActivitySchema>;

// Token Prices API Response Schema
export const TokenPricesSchema = z.record(z.string(), z.number());

export type TokenPrices = z.infer<typeof TokenPricesSchema>;

// Maintenance Status API Response Schema
export const MaintenanceStatusSchema = z.object({
  maintenance: z.boolean(),
});

export type MaintenanceStatus = z.infer<typeof MaintenanceStatusSchema>;

// Login API Response Schema
export const LoginResponseSchema = z.object({
  success: z.boolean(),
  token: z.string().optional(),
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;

// Logout API Response Schema
export const LogoutResponseSchema = z.object({
  success: z.boolean(),
});

export type LogoutResponse = z.infer<typeof LogoutResponseSchema>;

// Validation helper - safeParse pattern (identical to Uniswap)
export function validateApiResponse<T>(schema: z.ZodSchema<T>, data: unknown, fileName: string, functionName: string): T | undefined {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.warn(fileName, functionName, 'Validation failed', { issues: result.error.issues, data });
    return undefined;
  }
  return result.data;
}

// Strict validation (throws on failure) - for cases requiring guaranteed types
export function validateApiResponseStrict<T>(schema: z.ZodSchema<T>, data: unknown, apiName: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[Validation] ${apiName} response validation failed:`, result.error.issues);
    throw new Error(`Invalid ${apiName} response format: ${result.error.message}`);
  }
  return result.data;
}
