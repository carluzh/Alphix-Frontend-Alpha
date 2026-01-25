/**
 * Unified Yield Hook ABI (AlphixHook with ReHypothecation)
 *
 * Based on IReHypothecation.sol from the Feat/rehypo-hook branch.
 * The Hook contract implements:
 * - IReHypothecation (extends IERC20) - Rehypothecation liquidity operations
 * - IAlphix - Dynamic fee management
 *
 * Key Architecture:
 * - Hook IS the ERC20 share token (mints/burns shares to users)
 * - Users specify SHARES to add/remove, not token amounts directly
 * - Preview functions convert between amounts and shares
 * - Native ETH sent as msg.value, Hook handles wrapping internally
 *
 * Flow for Deposit:
 * 1. User enters amount0 or amount1
 * 2. Call previewAddFromAmount0(amount0) → (amount1, shares)
 * 3. Approve both tokens to Hook
 * 4. Call addReHypothecatedLiquidity(shares) with msg.value if native ETH
 *
 * Flow for Withdraw:
 * 1. User has shares from balanceOf(user)
 * 2. Call previewRemoveReHypothecatedLiquidity(shares) → (amount0, amount1)
 * 3. Call removeReHypothecatedLiquidity(shares)
 */

export const UNIFIED_YIELD_HOOK_ABI = [
  // ═══════════════════════════════════════════════════════════════════════════
  // REHYPOTHECATION - LIQUIDITY OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add rehypothecated liquidity
   *
   * Deposits assets into yield sources and mints shares to sender.
   * Pool must be active. Native ETH should be sent as msg.value.
   *
   * @param shares - Number of shares to mint
   * @returns delta - BalanceDelta (packed int256: int128 amount0, int128 amount1)
   */
  {
    name: 'addReHypothecatedLiquidity',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: 'delta', type: 'int256' }],
  },

  /**
   * Remove rehypothecated liquidity
   *
   * Burns shares and withdraws assets from yield sources to sender.
   * Pool must be active.
   *
   * @param shares - Number of shares to burn
   * @returns delta - BalanceDelta (packed int256: int128 amount0, int128 amount1)
   */
  {
    name: 'removeReHypothecatedLiquidity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [{ name: 'delta', type: 'int256' }],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // REHYPOTHECATION - PREVIEW FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Preview amounts required to add a given number of shares
   *
   * For users who want to specify shares and see required token amounts.
   * Rounds up (protocol-favorable for deposits).
   *
   * @param shares - Number of shares to mint
   * @returns amount0 - Required amount of currency0
   * @returns amount1 - Required amount of currency1
   */
  {
    name: 'previewAddReHypothecatedLiquidity',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },

  /**
   * Preview amounts received for removing a given number of shares
   *
   * For users who want to specify shares and see token amounts they'll receive.
   * Rounds down (protocol-favorable for withdrawals).
   *
   * @param shares - Number of shares to burn
   * @returns amount0 - Amount of currency0 to receive
   * @returns amount1 - Amount of currency1 to receive
   */
  {
    name: 'previewRemoveReHypothecatedLiquidity',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },

  /**
   * Preview deposit by specifying amount0
   *
   * For users who want to specify amount0 and see the required amount1 and shares.
   * Guarantees that calling addReHypothecatedLiquidity(shares) will require
   * at most amount0 and amount1.
   *
   * @param amount0 - The amount of currency0 the user wants to deposit
   * @returns amount1 - The required amount of currency1 for proportional deposit
   * @returns shares - The shares that will be minted
   */
  {
    name: 'previewAddFromAmount0',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'amount0', type: 'uint256' }],
    outputs: [
      { name: 'amount1', type: 'uint256' },
      { name: 'shares', type: 'uint256' },
    ],
  },

  /**
   * Preview deposit by specifying amount1
   *
   * For users who want to specify amount1 and see the required amount0 and shares.
   * Guarantees that calling addReHypothecatedLiquidity(shares) will require
   * at most amount0 and amount1.
   *
   * @param amount1 - The amount of currency1 the user wants to deposit
   * @returns amount0 - The required amount of currency0 for proportional deposit
   * @returns shares - The shares that will be minted
   */
  {
    name: 'previewAddFromAmount1',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'amount1', type: 'uint256' }],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'shares', type: 'uint256' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // REHYPOTHECATION - YIELD SOURCE GETTERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the yield source for a currency
   *
   * @param currency - Currency address (use address(0) for native ETH)
   * @returns yieldSource - Address of the yield source (e.g., Aave wrapper)
   */
  {
    name: 'getCurrencyYieldSource',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'currency', type: 'address' }],
    outputs: [{ name: 'yieldSource', type: 'address' }],
  },

  /**
   * Get the amount of assets in the yield source for a currency
   *
   * Returns the Hook's share of assets in the yield source, not total vault assets.
   *
   * @param currency - Currency address
   * @returns amount - Amount of assets in yield source from this Hook
   */
  {
    name: 'getAmountInYieldSource',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'currency', type: 'address' }],
    outputs: [{ name: 'amount', type: 'uint256' }],
  },

  /**
   * Get the rehypothecation configuration
   *
   * @returns config - Struct with tickLower and tickUpper defining the LP range
   */
  {
    name: 'getReHypothecationConfig',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'tickLower', type: 'int24' },
          { name: 'tickUpper', type: 'int24' },
        ],
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ALPHIX HOOK - POOL GETTERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the pool key this Hook is associated with
   */
  {
    name: 'getPoolKey',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
    ],
  },

  /**
   * Get the pool ID (hash of pool key)
   */
  {
    name: 'getPoolId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },

  /**
   * Get the current dynamic fee
   */
  {
    name: 'getFee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'fee', type: 'uint24' }],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ERC20 - STANDARD FUNCTIONS (Hook IS the share token)
  // ═══════════════════════════════════════════════════════════════════════════

  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },

  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },

  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },

  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },

  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },

  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },

  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },

  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },

  {
    name: 'transferFrom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    name: 'YieldSourceUpdated',
    type: 'event',
    inputs: [
      { name: 'currency', type: 'address', indexed: true },
      { name: 'oldYieldSource', type: 'address', indexed: false },
      { name: 'newYieldSource', type: 'address', indexed: false },
    ],
  },

  {
    name: 'ReHypothecatedLiquidityAdded',
    type: 'event',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'shares', type: 'uint256', indexed: false },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
    ],
  },

  {
    name: 'ReHypothecatedLiquidityRemoved',
    type: 'event',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'shares', type: 'uint256', indexed: false },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
    ],
  },

  {
    name: 'Transfer',
    type: 'event',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },

  {
    name: 'Approval',
    type: 'event',
    inputs: [
      { name: 'owner', type: 'address', indexed: true },
      { name: 'spender', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const;

export type UnifiedYieldHookABI = typeof UNIFIED_YIELD_HOOK_ABI;

// ═══════════════════════════════════════════════════════════════════════════
// HELPER TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ReHypothecation config returned by getReHypothecationConfig()
 */
export interface ReHypothecationConfig {
  tickLower: number;
  tickUpper: number;
}

/**
 * Pool key returned by getPoolKey()
 */
export interface PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

/**
 * Decode BalanceDelta (packed int256) to individual amounts
 *
 * BalanceDelta is int256 where:
 * - Upper 128 bits = amount0Delta (int128)
 * - Lower 128 bits = amount1Delta (int128)
 *
 * @param delta - Packed BalanceDelta from contract
 * @returns Tuple of [amount0, amount1] as bigint
 */
export function decodeBalanceDelta(delta: bigint): [bigint, bigint] {
  // amount0 is in upper 128 bits
  const amount0 = delta >> 128n;
  // amount1 is in lower 128 bits (masked to handle sign extension)
  const amount1 = delta & ((1n << 128n) - 1n);

  // Convert to signed if needed (handle negative values)
  const signedAmount0 = amount0 >= 1n << 127n ? amount0 - (1n << 128n) : amount0;
  const signedAmount1 = amount1 >= 1n << 127n ? amount1 - (1n << 128n) : amount1;

  return [signedAmount0, signedAmount1];
}
