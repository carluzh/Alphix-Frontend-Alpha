/**
 * Spark PSM3 (Peg Stability Module 3) ABI
 *
 * PSM3 provides 1:1 swaps between stablecoins (USDS <-> USDC) with zero fees.
 *
 * Contract: 0x1601843c5E9bC251A3272907010AFa41Fa18347E (Base mainnet)
 *
 * Key function:
 * - swapExactIn(assetIn, assetOut, amountIn, minAmountOut, receiver, referralCode)
 *
 * Note: Unlike MakerDAO's PSM, Spark PSM3 has no tin/tout fees - swaps are 1:1.
 */

export const PSM3_ABI = [
  // =========================================================================
  // SWAP FUNCTION
  // =========================================================================

  /**
   * Swap exact input amount for output.
   *
   * Executes a 1:1 swap between stablecoins (USDS <-> USDC).
   *
   * @param assetIn - Address of token to swap from
   * @param assetOut - Address of token to swap to
   * @param amountIn - Exact amount of input token (in its native decimals)
   * @param minAmountOut - Minimum output amount (slippage protection)
   * @param receiver - Address to receive output tokens
   * @param referralCode - Referral tracking code (use 0 if none)
   * @returns amountOut - Actual amount of output tokens received
   */
  {
    name: 'swapExactIn',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assetIn', type: 'address', internalType: 'address' },
      { name: 'assetOut', type: 'address', internalType: 'address' },
      { name: 'amountIn', type: 'uint256', internalType: 'uint256' },
      { name: 'minAmountOut', type: 'uint256', internalType: 'uint256' },
      { name: 'receiver', type: 'address', internalType: 'address' },
      { name: 'referralCode', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256', internalType: 'uint256' }],
  },

  /**
   * Swap for exact output amount.
   *
   * @param assetIn - Address of token to swap from
   * @param assetOut - Address of token to swap to
   * @param amountOut - Exact amount of output token desired
   * @param maxAmountIn - Maximum input amount (slippage protection)
   * @param receiver - Address to receive output tokens
   * @param referralCode - Referral tracking code (use 0 if none)
   * @returns amountIn - Actual amount of input tokens spent
   */
  {
    name: 'swapExactOut',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'assetIn', type: 'address', internalType: 'address' },
      { name: 'assetOut', type: 'address', internalType: 'address' },
      { name: 'amountOut', type: 'uint256', internalType: 'uint256' },
      { name: 'maxAmountIn', type: 'uint256', internalType: 'uint256' },
      { name: 'receiver', type: 'address', internalType: 'address' },
      { name: 'referralCode', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [{ name: 'amountIn', type: 'uint256', internalType: 'uint256' }],
  },

  // =========================================================================
  // VIEW FUNCTIONS
  // =========================================================================

  /**
   * Preview swap output for exact input.
   *
   * @param assetIn - Address of token to swap from
   * @param assetOut - Address of token to swap to
   * @param amountIn - Amount of input token
   * @returns amountOut - Expected output amount
   */
  {
    name: 'previewSwapExactIn',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'assetIn', type: 'address', internalType: 'address' },
      { name: 'assetOut', type: 'address', internalType: 'address' },
      { name: 'amountIn', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256', internalType: 'uint256' }],
  },

  /**
   * Preview swap input for exact output.
   *
   * @param assetIn - Address of token to swap from
   * @param assetOut - Address of token to swap to
   * @param amountOut - Desired output amount
   * @returns amountIn - Required input amount
   */
  {
    name: 'previewSwapExactOut',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'assetIn', type: 'address', internalType: 'address' },
      { name: 'assetOut', type: 'address', internalType: 'address' },
      { name: 'amountOut', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [{ name: 'amountIn', type: 'uint256', internalType: 'uint256' }],
  },
] as const;

/**
 * Typed ABI for viem
 */
export type PSM3Abi = typeof PSM3_ABI;

// Legacy export for backwards compatibility
export const PSM_ABI = PSM3_ABI;
