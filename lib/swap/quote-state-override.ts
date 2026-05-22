/**
 * State Override Utilities for V4 Quoter / Simulator
 *
 * Rehypothecated pools deposit liquidity into yield vaults, so the Pool
 * Manager singleton only holds a fraction of the actual balance. During
 * eth_call simulation, swaps that exceed the on-chain balance fail.
 *
 * Affected pool: ETH/USDC (Base) — ETH rehypothecated to Aave vault.
 *
 * Solution: Override Pool Manager's native ETH balance during simulation.
 *
 * (USDS support was removed when the USDS/USDC pool was sunset; the
 * token is no longer in the chain config so any lookup would crash on
 * module load.)
 */

import { parseEther } from 'viem';
import { getPoolManagerAddress } from '@/lib/pools-config';

const POOL_MANAGER_ADDRESS = getPoolManagerAddress('base');

/** Native token address (zero address) */
const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

/** Native ETH balance override for Pool Manager simulation (10,000 ETH). */
const NATIVE_ETH_OVERRIDE_BALANCE = parseEther('10000');

/**
 * Generate Pool Manager native ETH balance override for viem's simulateContract.
 */
export function getPoolManagerEthBalanceOverrideViem(): Array<{
  address: `0x${string}`;
  balance: bigint;
}> {
  return [
    {
      address: POOL_MANAGER_ADDRESS as `0x${string}`,
      balance: NATIVE_ETH_OVERRIDE_BALANCE,
    },
  ];
}

function isNativeTokenAddress(address: string): boolean {
  return address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
}

/**
 * Generate combined state overrides for a swap simulation when the swap
 * touches a rehypothecated native-ETH pool. Returns undefined when no
 * override applies.
 */
export function getSwapSimulationStateOverrides(
  inputTokenAddress: string,
  outputTokenAddress: string,
  poolHooks?: string
): any[] | undefined {
  // Only rehypothecated pools have non-zero hooks
  if (!poolHooks || poolHooks === NATIVE_TOKEN_ADDRESS) return undefined;
  if (!isNativeTokenAddress(inputTokenAddress) && !isNativeTokenAddress(outputTokenAddress)) {
    return undefined;
  }
  return getPoolManagerEthBalanceOverrideViem();
}
