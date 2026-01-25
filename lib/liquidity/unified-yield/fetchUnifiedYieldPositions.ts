/**
 * Unified Yield Position Fetching
 *
 * Fetches user's Unified Yield (ReHypothecation) positions by querying Hook contracts directly.
 * The Hook IS the ERC20 share token - users hold Hook shares.
 *
 * For each pool with Unified Yield enabled:
 * 1. Query Hook.balanceOf(user) for share balance
 * 2. Query Hook.previewRemoveReHypothecatedLiquidity(shares) for underlying token amounts
 * 3. Build UnifiedYieldPosition with all data
 *
 * Architecture:
 * - Hook extends IERC20 (balanceOf, totalSupply, etc.)
 * - previewRemoveReHypothecatedLiquidity returns (amount0, amount1) - rounds down
 * - No separate vault address - Hook IS the share token
 */

import { formatUnits, type Address, type PublicClient } from 'viem';
import type { UnifiedYieldPosition } from './types';
import { createUnifiedYieldPositionId } from './types';
import type { NetworkMode } from '@/lib/pools-config';
import { getEnabledPools, getToken, type PoolConfig } from '@/lib/pools-config';
import { isUnifiedYieldPool } from '@/lib/liquidity/utils/pool-type-guards';
import { UNIFIED_YIELD_HOOK_ABI } from './abi/unifiedYieldHookABI';

/**
 * Configuration for Unified Yield position fetching
 */
export interface FetchUnifiedYieldPositionsConfig {
  /** User's wallet address */
  userAddress: Address;

  /** Chain ID */
  chainId: number;

  /** Network mode (mainnet/testnet) */
  networkMode: NetworkMode;

  /** Viem public client for RPC calls */
  client: PublicClient;
}

/**
 * Fetch all Unified Yield positions for a user
 *
 * Queries all pools with hooks enabled and returns positions where
 * the user has a non-zero share balance.
 *
 * @param config - Fetch configuration
 * @returns Array of Unified Yield positions
 */
export async function fetchUnifiedYieldPositions(
  config: FetchUnifiedYieldPositionsConfig
): Promise<UnifiedYieldPosition[]> {
  const { userAddress, networkMode, client } = config;

  // Get all enabled Unified Yield pools
  const pools = getEnabledPools(networkMode);
  const unifiedYieldPools = pools.filter(isUnifiedYieldPool);

  if (unifiedYieldPools.length === 0) {
    return [];
  }

  // Fetch positions for each pool in parallel
  const positionPromises = unifiedYieldPools.map(async (pool) => {
    try {
      const position = await fetchPoolUnifiedYieldPosition(
        pool,
        userAddress,
        client,
        networkMode
      );
      return position;
    } catch (error) {
      console.warn(
        `Failed to fetch Unified Yield position for pool ${pool.id}:`,
        error
      );
      return null;
    }
  });

  const results = await Promise.all(positionPromises);

  // Filter out null results (no position or errors)
  return results.filter((result): result is UnifiedYieldPosition => result !== null);
}

/**
 * Fetch Unified Yield position for a specific pool
 *
 * The Hook IS the ERC-4626 vault:
 * - Hook.balanceOf(user) returns share balance
 * - Hook.previewRedeem(shares) returns (amount0, amount1)
 *
 * @param pool - Pool configuration
 * @param userAddress - User's wallet address
 * @param client - Viem public client
 * @param networkMode - Network mode
 * @returns Unified Yield position or null if user has no position
 */
async function fetchPoolUnifiedYieldPosition(
  pool: PoolConfig,
  userAddress: Address,
  client: PublicClient,
  networkMode: NetworkMode
): Promise<UnifiedYieldPosition | null> {
  const hookAddress = pool.hooks as Address;

  if (!hookAddress) {
    return null;
  }

  // Query share balance directly from Hook (Hook IS ERC-4626)
  let shareBalance: bigint;

  try {
    const balanceResult = await client.readContract({
      address: hookAddress,
      abi: UNIFIED_YIELD_HOOK_ABI,
      functionName: 'balanceOf',
      args: [userAddress],
    });
    shareBalance = balanceResult as bigint;
  } catch (error) {
    console.warn(
      `Failed to get share balance from Hook for pool ${pool.id}:`,
      error
    );
    return null;
  }

  // Skip if user has no shares
  if (shareBalance <= 0n) {
    return null;
  }

  // Get underlying amounts from Hook.previewRemoveReHypothecatedLiquidity
  // Returns [amount0, amount1] - rounds down (protocol-favorable for withdrawals)
  let token0AmountRaw: bigint;
  let token1AmountRaw: bigint;

  try {
    const redeemResult = await client.readContract({
      address: hookAddress,
      abi: UNIFIED_YIELD_HOOK_ABI,
      functionName: 'previewRemoveReHypothecatedLiquidity',
      args: [shareBalance],
    });

    // previewRemoveReHypothecatedLiquidity returns tuple (amount0, amount1)
    const [amount0, amount1] = redeemResult as [bigint, bigint];
    token0AmountRaw = amount0;
    token1AmountRaw = amount1;
  } catch (error) {
    console.warn(
      `Failed to preview remove liquidity for pool ${pool.id}:`,
      error
    );
    // Fallback: set amounts to 0 if preview fails
    token0AmountRaw = 0n;
    token1AmountRaw = 0n;
  }

  // Get token configs for decimals and symbols
  const token0Config = getToken(pool.currency0.symbol as any, networkMode);
  const token1Config = getToken(pool.currency1.symbol as any, networkMode);

  const token0Decimals = token0Config?.decimals ?? 18;
  const token1Decimals = token1Config?.decimals ?? 18;
  const shareDecimals = 18; // Standard ERC-4626 share decimals

  const positionId = createUnifiedYieldPositionId(hookAddress, userAddress);

  return {
    type: 'unified-yield',
    id: positionId,
    positionId, // Alias for compatibility with V4ProcessedPosition
    hookAddress,
    shareBalance,
    shareBalanceFormatted: formatUnits(shareBalance, shareDecimals),
    token0Amount: formatUnits(token0AmountRaw, token0Decimals),
    token1Amount: formatUnits(token1AmountRaw, token1Decimals),
    token0AmountRaw,
    token1AmountRaw,
    // Use subgraphId (bytes32 hash) for consistency with V4 positions
    // The frontend filters positions by matching poolId against subgraphId
    poolId: pool.subgraphId,
    token0Symbol: pool.currency0.symbol,
    token1Symbol: pool.currency1.symbol,
    token0Address: pool.currency0.address as Address,
    token1Address: pool.currency1.address as Address,
    token0Decimals,
    token1Decimals,
    shareDecimals,
    isUnifiedYield: true,
    isFullRange: true,
    status: 'IN_RANGE',
  };
}

/**
 * Fetch a single Unified Yield position by Hook address
 *
 * Useful for position detail pages or after transactions
 *
 * @param hookAddress - Hook contract address
 * @param userAddress - User's wallet address
 * @param client - Viem public client
 * @param networkMode - Network mode
 * @returns Unified Yield position or null
 */
export async function fetchSingleUnifiedYieldPosition(
  hookAddress: Address,
  userAddress: Address,
  client: PublicClient,
  networkMode: NetworkMode
): Promise<UnifiedYieldPosition | null> {
  // Find the pool config for this hook
  const pools = getEnabledPools(networkMode);
  const pool = pools.find((p) => p.hooks?.toLowerCase() === hookAddress.toLowerCase());

  if (!pool) {
    console.warn(`No pool config found for hook ${hookAddress}`);
    return null;
  }

  return fetchPoolUnifiedYieldPosition(pool, userAddress, client, networkMode);
}
