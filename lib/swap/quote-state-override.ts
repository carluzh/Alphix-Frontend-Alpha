/**
 * State Override Utilities for V4 Quoter
 *
 * The USDS/USDC pool uses rehypothecated liquidity where USDS is deposited into
 * a Sky vault. During quotes, the V4 Pool Manager singleton only holds ~375 USDS
 * (the amount not currently rehypothecated), limiting quote sizes.
 *
 * Background:
 * - The Pool Manager singleton holds actual token balances for all V4 pools
 * - USDS liquidity is mostly rehypothecated to the Sky vault for yield
 * - Pool Manager only has ~375 USDS available
 * - During eth_call simulation, swaps above this limit fail
 *
 * Solution: Override Pool Manager's USDS balance during eth_call simulation
 */

import { keccak256, encodeAbiParameters, parseAbiParameters, toHex, pad, type Hex } from 'viem';

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

// =============================================================================
// EXPORTS FOR EXTERNAL USE
// =============================================================================

export const QUOTE_STATE_OVERRIDE_CONFIG = {
  USDS_ADDRESS,
  POOL_MANAGER_ADDRESS,
  USDS_BALANCE_MAPPING_SLOT,
  OVERRIDE_BALANCE,
};
