/**
 * State Override Utilities for V4 Quoter
 *
 * Rehypothecated pools (Unified Yield) deposit liquidity into yield vaults,
 * so the Pool Manager singleton only holds a fraction of the actual balance.
 * During eth_call simulation, swaps that exceed the on-chain balance fail.
 *
 * Affected pools:
 * - USDS/USDC: USDS rehypothecated to Sky vault (~375 USDS on-chain)
 * - ETH/USDC: ETH rehypothecated to Aave vault (limited on-chain ETH)
 *
 * Solution: Override Pool Manager's token balances during eth_call simulation
 */

import { keccak256, encodeAbiParameters, parseAbiParameters, toHex, pad, parseEther, type Hex } from 'viem';

// =============================================================================
// CONSTANTS
// =============================================================================

/** USDS token address on Base mainnet */
const USDS_ADDRESS = '0x820C137fa70C8691f0e44Dc420a5e53c168921Dc';

/**
 * Uniswap V4 Pool Manager singleton address on Base mainnet
 * This contract holds all pool liquidity and is the bottleneck for USDS quotes
 */
const POOL_MANAGER_ADDRESS = '0x498581ff718922c3f8e6a244956af099b2652b2b';

/**
 * USDS balance mapping storage slot
 *
 * USDS on Base stores balances at mapping slot 2 (verified via eth_getStorageAt).
 * For ERC20 tokens, balance[address] is stored at: keccak256(abi.encode(address, slot))
 *
 * Note: Most ERC20 tokens use slot 0 or 1, but USDS uses slot 2.
 *
 * Verified by checking Pool Manager's balance:
 * - balanceOf(PoolManager) = ~375 USDS (limiting quote size)
 * - This value found at slot 2 mapping key
 */
const USDS_BALANCE_MAPPING_SLOT = 2n;

/**
 * USDS balance override for simulation (1,000,000 USDS)
 * Allows quotes up to 1M USDS for arbitrage and large swap simulations
 */
const OVERRIDE_BALANCE = 1_000_000n * 10n ** 18n; // 1,000,000 USDS (in wei, 18 decimals)

// =============================================================================
// STORAGE SLOT CALCULATION
// =============================================================================

/**
 * Calculate the storage slot for a balance in an ERC20 balanceOf mapping
 *
 * For standard Solidity mappings: mapping(address => uint256) balances
 * The storage slot is: keccak256(abi.encode(address, mappingSlot))
 *
 * @param holderAddress - The address whose balance we want to find/override
 * @param mappingSlot - The storage slot of the balances mapping (varies by token, USDS uses slot 2)
 * @returns The storage slot as a hex string
 */
export function calculateBalanceSlot(
  holderAddress: string,
  mappingSlot: bigint = USDS_BALANCE_MAPPING_SLOT
): Hex {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('address, uint256'),
      [holderAddress as `0x${string}`, mappingSlot]
    )
  );
}

/**
 * Get the storage slot for Pool Manager's USDS balance
 */
export function getPoolManagerUsdsBalanceSlot(): Hex {
  return calculateBalanceSlot(POOL_MANAGER_ADDRESS, USDS_BALANCE_MAPPING_SLOT);
}

// =============================================================================
// STATE OVERRIDE GENERATION
// =============================================================================

/**
 * Internal helper to compute the common override data
 * Reduces duplication across format-specific functions
 */
function getOverrideData(): { slot: Hex; value: Hex; address: string } {
  return {
    slot: getPoolManagerUsdsBalanceSlot(),
    value: pad(toHex(OVERRIDE_BALANCE), { size: 32 }),
    address: USDS_ADDRESS,
  };
}

/**
 * Generate state overrides in the format expected by ethers.js provider.send()
 * Used by get-quote.ts for V4Quoter eth_call
 *
 * @returns State override object formatted for ethers.js eth_call
 */
export function getUsdsQuoteStateOverridesEthers(): Record<string, { stateDiff: Record<string, string> }> {
  const { slot, value, address } = getOverrideData();
  return {
    [address.toLowerCase()]: {
      stateDiff: { [slot]: value },
    },
  };
}

/**
 * Generate state overrides in the array format expected by viem's simulateContract
 * Used by build-tx.ts for transaction simulation
 *
 * Viem expects StateOverride as an array of objects with address property,
 * and stateDiff as an array of { slot, value } objects.
 *
 * @returns State override array for use with viem simulateContract
 */
export function getUsdsQuoteStateOverridesViem(): Array<{
  address: `0x${string}`;
  stateDiff: Array<{ slot: Hex; value: Hex }>;
}> {
  const { slot, value, address } = getOverrideData();
  return [
    {
      address: address as `0x${string}`,
      stateDiff: [{ slot, value }],
    },
  ];
}

// =============================================================================
// NATIVE ETH BALANCE OVERRIDE
// =============================================================================

/** Native token address (zero address) */
const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Native ETH balance override for Pool Manager simulation (10,000 ETH)
 * Allows simulation of swaps where ETH output comes from rehypothecated liquidity
 */
const NATIVE_ETH_OVERRIDE_BALANCE = parseEther('10000'); // 10,000 ETH

/**
 * Generate Pool Manager native ETH balance override for viem's simulateContract.
 * Used when the swap outputs native ETH from a rehypothecated pool.
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

/**
 * Generate Pool Manager native ETH balance override for ethers.js eth_call.
 * Used by get-quote.ts for V4Quoter.
 */
export function getPoolManagerEthBalanceOverrideEthers(): Record<string, { balance: string }> {
  return {
    [POOL_MANAGER_ADDRESS.toLowerCase()]: {
      balance: `0x${NATIVE_ETH_OVERRIDE_BALANCE.toString(16)}`,
    },
  };
}

// =============================================================================
// QUOTE HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a token address is USDS (requires state override for quotes/simulation)
 *
 * State overrides are needed when USDS is the input token because Pool Manager
 * only holds ~375 USDS on-chain (rest is rehypothecated to Sky vault).
 *
 * @param fromTokenAddress - The input token address
 * @returns True if USDS is the input token
 */
export function needsUsdsStateOverride(fromTokenAddress: string): boolean {
  return fromTokenAddress.toLowerCase() === USDS_ADDRESS.toLowerCase();
}

/**
 * Check if a token address is native ETH
 */
function isNativeTokenAddress(address: string): boolean {
  return address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
}

/**
 * Check if the swap involves a rehypothecated pool that needs simulation state overrides.
 * Returns true if either the input or output is from a rehypothecated pool.
 *
 * @param inputTokenAddress - Input token address
 * @param outputTokenAddress - Output token address
 * @param poolHooks - The pool's hooks address (non-zero = hooked/potentially rehypothecated)
 */
export function needsRehypothecatedOverride(
  inputTokenAddress: string,
  outputTokenAddress: string,
  poolHooks?: string
): boolean {
  // Only rehypothecated pools have non-zero hooks
  if (!poolHooks || poolHooks === NATIVE_TOKEN_ADDRESS) return false;
  // Check if either token is rehypothecated (USDS or native ETH)
  return needsUsdsStateOverride(inputTokenAddress) ||
    needsUsdsStateOverride(outputTokenAddress) ||
    isNativeTokenAddress(inputTokenAddress) ||
    isNativeTokenAddress(outputTokenAddress);
}

/**
 * Generate combined state overrides for a swap simulation.
 * Handles both USDS ERC20 balance overrides and native ETH balance overrides.
 *
 * @param inputTokenAddress - Input token address
 * @param outputTokenAddress - Output token address
 * @param poolHooks - The pool's hooks address
 * @returns State override array for viem simulateContract, or undefined if no overrides needed
 */
export function getSwapSimulationStateOverrides(
  inputTokenAddress: string,
  outputTokenAddress: string,
  poolHooks?: string
): any[] | undefined {
  if (!needsRehypothecatedOverride(inputTokenAddress, outputTokenAddress, poolHooks)) {
    return undefined;
  }

  const overrides: any[] = [];

  // Add USDS ERC20 balance override if USDS is involved
  if (needsUsdsStateOverride(inputTokenAddress) || needsUsdsStateOverride(outputTokenAddress)) {
    overrides.push(...getUsdsQuoteStateOverridesViem());
  }

  // Add native ETH balance override if native ETH is involved
  if (isNativeTokenAddress(inputTokenAddress) || isNativeTokenAddress(outputTokenAddress)) {
    overrides.push(...getPoolManagerEthBalanceOverrideViem());
  }

  return overrides.length > 0 ? overrides : undefined;
}

// =============================================================================
// EXPORTS FOR EXTERNAL USE
// =============================================================================

export const QUOTE_STATE_OVERRIDE_CONFIG = {
  USDS_ADDRESS,
  POOL_MANAGER_ADDRESS,
  USDS_BALANCE_MAPPING_SLOT,
  OVERRIDE_BALANCE,
};
