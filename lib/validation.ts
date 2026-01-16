import { z } from 'zod';

// Input validation schema for get-pool-state API
export const GetPoolStateInputSchema = z.object({
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

// Response validation helper - safeParse pattern (identical to Uniswap)
export function validateApiResponse<T>(schema: z.ZodSchema<T>, data: unknown, fileName: string, functionName: string): T | undefined {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.warn(fileName, functionName, 'Validation failed', { issues: result.error.issues, data });
    return undefined;
  }
  return result.data;
}
