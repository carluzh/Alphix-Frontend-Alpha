import { z } from 'zod';

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

// Swap Quote API Response Schema
export const SwapQuoteSchema = z.object({
  quote: z.object({
    amountIn: z.string(),
    amountOut: z.string(),
    path: z.array(z.string()),
    fees: z.array(z.number()),
  }),
});

export type SwapQuote = z.infer<typeof SwapQuoteSchema>;

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

// Validation helper function
export function validateApiResponse<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  apiName: string
): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(`[Validation] ${apiName} response validation failed:`, error.issues);
      throw new Error(`Invalid ${apiName} response format: ${error.message}`);
    }
    throw error;
  }
}
