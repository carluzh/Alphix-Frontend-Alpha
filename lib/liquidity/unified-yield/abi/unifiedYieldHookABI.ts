/**
 * Unified Yield Hook ABI
 *
 * The Hook contract acts as an ERC-4626 compliant vault for LP positions.
 * Users deposit tokens and receive Hook shares representing their position.
 * The Hook internally manages deposits into underlying token vaults that
 * earn rehypothecation yield (Aave) + swap fees (JIT liquidity).
 *
 * Architecture:
 * - One Hook per pool (ETH/USDC has its own Hook, USDC/USDT has its own)
 * - Hook mints shares to users (ERC-4626 compliant)
 * - Hook deposits into shared underlying vaults (e.g., USDC vault shared across pools)
 * - Native ETH is wrapped by Hook internally (send ETH as msg.value)
 * - No slippage protection at contract level
 * - Partial withdrawals supported (any share amount)
 *
 * NOTE: This is a PLACEHOLDER ABI. Update when actual contract is deployed.
 */

export const UNIFIED_YIELD_HOOK_ABI = [
  // ═══════════════════════════════════════════════════════════════════════════
  // DEPOSIT / WITHDRAW
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Deposit both tokens into the Hook, receive shares
   *
   * For native ETH: send ETH as msg.value, Hook wraps internally
   * No slippage protection - basic deposit
   *
   * @param token0 - First token address (use address(0) or WETH for native ETH)
   * @param token1 - Second token address
   * @param amount0 - Amount of token0 to deposit
   * @param amount1 - Amount of token1 to deposit
   * @param recipient - Address to receive shares
   * @returns shares - Number of Hook shares minted
   */
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },

  /**
   * Withdraw by burning shares, receive underlying tokens
   *
   * Supports partial withdrawals (any share amount)
   * Returns both tokens proportional to share ownership
   *
   * @param shares - Number of shares to burn
   * @param recipient - Address to receive tokens
   * @returns amount0 - Amount of token0 returned
   * @returns amount1 - Amount of token1 returned
   */
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'shares', type: 'uint256' },
      { name: 'recipient', type: 'address' },
    ],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ERC-4626 VIEW FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get share balance for an account
   */
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },

  /**
   * Get total supply of shares
   */
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'supply', type: 'uint256' }],
  },

  /**
   * Preview how many tokens would be received for burning shares
   *
   * Returns both token amounts proportional to pool composition
   *
   * @param shares - Number of shares to preview
   * @returns amount0 - Amount of token0 that would be received
   * @returns amount1 - Amount of token1 that would be received
   */
  {
    name: 'previewRedeem',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'shares', type: 'uint256' }],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },

  /**
   * Preview how many shares would be minted for given deposit amounts
   *
   * @param amount0 - Amount of token0 to deposit
   * @param amount1 - Amount of token1 to deposit
   * @returns shares - Number of shares that would be minted
   */
  {
    name: 'previewDeposit',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    outputs: [{ name: 'shares', type: 'uint256' }],
  },

  /**
   * Get total assets held by the Hook (in terms of a single reference token)
   * Used for share price calculations
   */
  {
    name: 'totalAssets',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'assets', type: 'uint256' }],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ERC-20 STANDARD (for share token)
  // ═══════════════════════════════════════════════════════════════════════════

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
  // HOOK-SPECIFIC VIEW FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get the underlying vault address for token0
   */
  {
    name: 'getVault0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'vault', type: 'address' }],
  },

  /**
   * Get the underlying vault address for token1
   */
  {
    name: 'getVault1',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'vault', type: 'address' }],
  },

  /**
   * Get the pool key this Hook is associated with
   */
  {
    name: 'poolKey',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'currency0', type: 'address' },
      { name: 'currency1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickSpacing', type: 'int24' },
      { name: 'hooks', type: 'address' },
    ],
  },

  /**
   * Get token0 address
   */
  {
    name: 'token0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },

  /**
   * Get token1 address
   */
  {
    name: 'token1',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    name: 'Deposit',
    type: 'event',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount0', type: 'uint256', indexed: false },
      { name: 'amount1', type: 'uint256', indexed: false },
      { name: 'shares', type: 'uint256', indexed: false },
    ],
  },

  {
    name: 'Withdraw',
    type: 'event',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
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
