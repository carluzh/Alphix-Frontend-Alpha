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
 */

import { getSubgraphUrlForPool } from './subgraph-url-helper';
import { getPoolSubgraphId } from './pools-config';

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
 * @returns APY result with duration info
 */
export async function calculatePositionAPY(
  owner: string,
  tickLower: number,
  tickUpper: number,
  poolId: string,
  uncollectedFeesUSD: number,
  positionValueUSD: number,
  positionCreationTimestamp: number
): Promise<PositionAPYResult> {
  try {
    // Get the appropriate subgraph URL for this pool
    const subgraphUrl = getSubgraphUrlForPool(poolId);
    const subgraphPoolId = getPoolSubgraphId(poolId) || poolId;

    // Query for the LAST ModifyLiquidity event (including fee collections with amount = 0)
    // This ensures APY resets when user collects fees, since uncollected fees reset at that point
    const query = `
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

    const variables = {
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

    // Calculate APY
    const apy = calculateAPY(uncollectedFeesUSD, positionValueUSD, durationDays);

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
    const apy = calculateAPY(uncollectedFeesUSD, positionValueUSD, durationDays);

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
  // Need at least 1 day of data
  if (durationDays < 1) {
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
