/**
 * Position APY Calculator (Simplified)
 *
 * Calculates APY based on fees earned since last liquidity modification.
 *
 * Approach:
 * 1. Find the last ModifyLiquidity event where amount (liquidity delta) ≠ 0
 * 2. Calculate duration = Now - Last Modification Time
 * 3. APY = (Current Uncollected Fees USD / Position Value USD) × (365 / Duration Days) × 100
 *
 * This naturally resets when user adds/removes liquidity, giving accurate "current rate".
 *
 * Fallback: If fee-based calculation fails (duration < 6h or no fees), falls back to
 * pool-wide APY: (volume24h * feeRate * 365 / TVL) * 100
 */

import { getSubgraphUrlForPool, getUniswapV4SubgraphUrl, isMainnetSubgraphMode } from './subgraph-url-helper';
import { getPoolSubgraphId, type NetworkMode } from './pools-config';

export interface PositionAPYResult {
  apy: number | null;
  formattedAPY: string;
  durationDays: number;
  lastModificationTimestamp: number | null;
}

interface ModifyLiquidityEvent {
  amount: string;
  timestamp: string;
}

/**
 * Calculate APY based on fees since last liquidity modification
 *
 * @param owner - Position owner address
 * @param tickLower - Position tick lower bound
 * @param tickUpper - Position tick upper bound
 * @param poolId - Pool ID for subgraph queries
 * @param uncollectedFeesUSD - Current uncollected fees in USD
 * @param positionValueUSD - Current position value in USD
 * @param positionCreationTimestamp - Position creation timestamp (fallback)
 * @param poolAPY - Pre-calculated pool APY to use as fallback (from get-pools-batch cache)
 * @param networkMode - Network mode for correct subgraph URL selection
 * @returns APY result with duration info
 */
// Mainnet query: uses poolId as String (Uniswap v4 subgraph structure)
const MODIFY_LIQUIDITY_QUERY_MAINNET = `
  query GetLastLiquidityModification($poolId: String!, $owner: Bytes!, $tickLower: BigInt!, $tickUpper: BigInt!) {
    modifyLiquidities(
      where: {
        poolId: $poolId
        origin: $owner
        tickLower: $tickLower
        tickUpper: $tickUpper
      }
      orderBy: timestamp
      orderDirection: desc
      first: 1
    ) {
      amount
      timestamp
    }
  }
`;

// Testnet query: uses pool as Bytes (our full subgraph structure)
const MODIFY_LIQUIDITY_QUERY_TESTNET = `
  query GetLastLiquidityModification($pool: Bytes!, $owner: Bytes!, $tickLower: BigInt!, $tickUpper: BigInt!) {
    modifyLiquidities(
      where: {
        pool: $pool
        origin: $owner
        tickLower: $tickLower
        tickUpper: $tickUpper
      }
      orderBy: timestamp
      orderDirection: desc
      first: 1
    ) {
      amount
      timestamp
    }
  }
`;

export async function calculatePositionAPY(
  owner: string,
  tickLower: number,
  tickUpper: number,
  poolId: string,
  uncollectedFeesUSD: number,
  positionValueUSD: number,
  positionCreationTimestamp: number,
  poolAPY?: number | null,
  networkMode?: NetworkMode
): Promise<PositionAPYResult> {
  try {
    const isMainnet = isMainnetSubgraphMode(networkMode);
    // For mainnet, ModifyLiquidity events are in the Uniswap v4 subgraph
    // For testnet, they're in our full Alphix subgraph
    const subgraphUrl = isMainnet
      ? getUniswapV4SubgraphUrl(networkMode)
      : getSubgraphUrlForPool(poolId, networkMode);
    const subgraphPoolId = getPoolSubgraphId(poolId) || poolId;

    // Select query based on network mode (different field types)
    const query = isMainnet ? MODIFY_LIQUIDITY_QUERY_MAINNET : MODIFY_LIQUIDITY_QUERY_TESTNET;

    // Build variables based on network (mainnet uses poolId, testnet uses pool)
    const variables = isMainnet
      ? {
          poolId: subgraphPoolId.toLowerCase(),
          owner: owner.toLowerCase(),
          tickLower: tickLower.toString(),
          tickUpper: tickUpper.toString(),
        }
      : {
          pool: subgraphPoolId.toLowerCase(),
          owner: owner.toLowerCase(),
          tickLower: tickLower.toString(),
          tickUpper: tickUpper.toString(),
        };

    const response = await fetch(subgraphUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Subgraph query failed: ${response.status}`);
    }

    const result = await response.json();

    if (result.errors) {
      console.error('[calculatePositionAPY] Subgraph errors:', result.errors);
      throw new Error('Subgraph query returned errors');
    }

    const events: ModifyLiquidityEvent[] = result.data?.modifyLiquidities || [];

    // Use last modification time, or fall back to position creation time
    const lastModificationTimestamp = events.length > 0
      ? parseInt(events[0].timestamp)
      : positionCreationTimestamp;

    // Calculate duration in days
    const nowTimestamp = Math.floor(Date.now() / 1000);
    const durationSeconds = nowTimestamp - lastModificationTimestamp;
    const durationDays = durationSeconds / 86400;

    // Calculate APY (fee-based)
    let apy = calculateAPY(uncollectedFeesUSD, positionValueUSD, durationDays);

    // If fee-based APY fails, use the pre-calculated pool APY
    if (apy === null && poolAPY !== undefined && poolAPY !== null) {
      console.log('[calculatePositionAPY] Fee-based APY unavailable, using pre-calculated pool APY:', poolAPY);
      apy = poolAPY;
    }

    return {
      apy,
      formattedAPY: formatAPY(apy),
      durationDays,
      lastModificationTimestamp,
    };
  } catch (error) {
    console.error('[calculatePositionAPY] Error:', error);
    // Fallback: use position creation time
    const nowTimestamp = Math.floor(Date.now() / 1000);
    const durationSeconds = nowTimestamp - positionCreationTimestamp;
    const durationDays = durationSeconds / 86400;
    let apy = calculateAPY(uncollectedFeesUSD, positionValueUSD, durationDays);

    // If fee-based APY still fails, use the pre-calculated pool APY
    if (apy === null && poolAPY !== undefined && poolAPY !== null) {
      console.log('[calculatePositionAPY] Using pre-calculated pool APY after error:', poolAPY);
      apy = poolAPY;
    }

    return {
      apy,
      formattedAPY: formatAPY(apy),
      durationDays,
      lastModificationTimestamp: positionCreationTimestamp,
    };
  }
}

/**
 * Calculate APY from fees and duration
 */
function calculateAPY(
  feesUSD: number,
  positionValueUSD: number,
  durationDays: number
): number | null {
  // Need at least 6 hours of data (0.25 days)
  if (durationDays < 0.25) {
    return null;
  }

  // Need non-zero position value
  if (positionValueUSD <= 0) {
    return null;
  }

  // Annualize the return
  const annualizedReturn = (feesUSD / positionValueUSD) * (365 / durationDays);
  const apy = annualizedReturn * 100;

  return Math.max(apy, 0);
}

/**
 * Format APY for display with appropriate precision
 */
function formatAPY(apy: number | null): string {
  if (apy === null || apy === undefined) {
    return '—';
  }

  if (apy === 0) {
    return '0%';
  }

  if (apy >= 1000) {
    return `${Math.round(apy)}%`;
  }
  if (apy >= 100) {
    return `${apy.toFixed(0)}%`;
  }
  if (apy >= 10) {
    return `${apy.toFixed(1)}%`;
  }
  return `${apy.toFixed(2)}%`;
}
