/**
 * State Override Utilities for V4 Quoter / Simulator
 *
 * Rehypothecated pools deposit native ETH into a yield vault (Aave on Base),
 * so the Pool Manager singleton only holds a fraction of the actual balance.
 * During eth_call simulation, swaps that exceed the on-chain native balance
 * would revert with "insufficient pool balance" even though the on-chain
 * swap succeeds (the hook brings tokens back during execution).
 *
 * Solution: override the Pool Manager's native ETH balance during simulation.
 *
 * Currently only the ETH/USDC (Base) rehypothecated pool needs this.
 */

import { parseEther } from 'viem';
import { getPoolManagerAddress } from '@/lib/pools-config';

const POOL_MANAGER_ADDRESS = getPoolManagerAddress('base');

/** Native ETH balance override for Pool Manager simulation (10,000 ETH). */
const NATIVE_ETH_OVERRIDE_BALANCE = parseEther('10000');

/**
 * Generate combined state overrides for a swap simulation when the route
 * touches a rehypothecated native-ETH pool. Returns undefined when no
 * override applies.
 */
export function getSwapSimulationStateOverrides(
  routeTouchesRehypothecatedNativeEthPool: boolean
): Array<{ address: `0x${string}`; balance: bigint }> | undefined {
  if (!routeTouchesRehypothecatedNativeEthPool) return undefined;
  return [
    {
      address: POOL_MANAGER_ADDRESS as `0x${string}`,
      balance: NATIVE_ETH_OVERRIDE_BALANCE,
    },
  ];
}
