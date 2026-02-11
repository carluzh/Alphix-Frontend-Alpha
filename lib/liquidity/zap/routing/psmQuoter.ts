/**
 * PSM3 Quoter
 *
 * Utilities for interacting with Spark PSM3 (Peg Stability Module 3)
 * on Base mainnet.
 *
 * PSM3 provides 1:1 swaps between USDS and USDC with zero fees.
 */

import { type PublicClient, type Address, encodeFunctionData, getAddress } from 'viem';
import { PSM3_ABI } from '../abi/psmABI';
import { PSM_CONFIG, USDS_TO_USDC_DIVISOR, USDC_TO_USDS_MULTIPLIER } from '../constants';
import type { ZapToken } from '../types';

// =============================================================================
// TYPES
// =============================================================================

export interface PSMQuoteResult {
  /** Output amount (in wei of output token) */
  outputAmount: bigint;
  /** Fee amount (always 0 for PSM3) */
  feeAmount: bigint;
  /** Effective rate (output/input in normalized terms, always ~1.0) */
  effectiveRate: number;
  /** Whether PSM is available for this swap */
  isAvailable: boolean;
}

// =============================================================================
// PSM QUOTE
// =============================================================================

/**
 * Get a quote for a PSM3 swap.
 *
 * PSM3 swaps are 1:1 in USD terms with zero fees.
 * We can calculate locally since PSM3 always returns 1:1 adjusted for decimals.
 *
 * @param inputToken - Token to swap from
 * @param inputAmount - Amount to swap (in wei)
 * @param publicClient - Optional Viem public client for on-chain preview
 * @returns Quote result
 */
export async function getPSMQuote(
  inputToken: ZapToken,
  inputAmount: bigint,
  publicClient?: PublicClient
): Promise<PSMQuoteResult> {
  if (inputAmount <= 0n) {
    return {
      outputAmount: 0n,
      feeAmount: 0n,
      effectiveRate: 1.0,
      isAvailable: true,
    };
  }

  // If we have a public client, use the on-chain preview for accuracy
  if (publicClient) {
    try {
      const outputAmount = await previewPSMSwap(inputToken, inputAmount, publicClient);

      // Calculate effective rate (should be ~1.0)
      const inputNormalized =
        inputToken === 'USDS' ? Number(inputAmount) / 1e18 : Number(inputAmount) / 1e6;
      const outputNormalized =
        inputToken === 'USDS' ? Number(outputAmount) / 1e6 : Number(outputAmount) / 1e18;
      const effectiveRate = inputNormalized > 0 ? outputNormalized / inputNormalized : 1.0;

      return {
        outputAmount,
        feeAmount: 0n,
        effectiveRate,
        isAvailable: true,
      };
    } catch (error) {
      console.warn('[PSM3] Preview failed, using local calculation:', error);
      // Fall through to local calculation
    }
  }

  // Local calculation: 1:1 swap adjusted for decimals
  let outputAmount: bigint;

  if (inputToken === 'USDS') {
    // USDS (18 decimals) -> USDC (6 decimals): divide by 10^12
    outputAmount = inputAmount / USDS_TO_USDC_DIVISOR;
  } else {
    // USDC (6 decimals) -> USDS (18 decimals): multiply by 10^12
    outputAmount = inputAmount * USDC_TO_USDS_MULTIPLIER;
  }

  // Calculate effective rate (in normalized terms)
  const inputNormalized =
    inputToken === 'USDS' ? Number(inputAmount) / 1e18 : Number(inputAmount) / 1e6;
  const outputNormalized =
    inputToken === 'USDS' ? Number(outputAmount) / 1e6 : Number(outputAmount) / 1e18;
  const effectiveRate = inputNormalized > 0 ? outputNormalized / inputNormalized : 1.0;

  return {
    outputAmount,
    feeAmount: 0n,
    effectiveRate,
    isAvailable: true,
  };
}

/**
 * Preview a PSM3 swap using on-chain function.
 *
 * @param inputToken - Token to swap from
 * @param inputAmount - Amount to swap (in wei)
 * @param publicClient - Viem public client
 * @returns Expected output amount
 */
export async function previewPSMSwap(
  inputToken: ZapToken,
  inputAmount: bigint,
  publicClient: PublicClient
): Promise<bigint> {
  const assetIn =
    inputToken === 'USDS'
      ? getAddress(PSM_CONFIG.usdsAddress)
      : getAddress(PSM_CONFIG.usdcAddress);
  const assetOut =
    inputToken === 'USDS'
      ? getAddress(PSM_CONFIG.usdcAddress)
      : getAddress(PSM_CONFIG.usdsAddress);

  const result = await publicClient.readContract({
    address: getAddress(PSM_CONFIG.address),
    abi: PSM3_ABI,
    functionName: 'previewSwapExactIn',
    args: [assetIn, assetOut, inputAmount],
  });

  return result as bigint;
}

// =============================================================================
// PSM TRANSACTION BUILDING
// =============================================================================

/**
 * Build PSM3 swap transaction calldata.
 *
 * Uses swapExactIn(assetIn, assetOut, amountIn, minAmountOut, receiver, referralCode)
 *
 * @param inputToken - Token to swap from
 * @param inputAmount - Amount to swap (in wei of input token)
 * @param minOutputAmount - Minimum output amount (slippage protection)
 * @param recipient - Address to receive output
 * @returns Transaction calldata
 */
export function buildPSMSwapCalldata(
  inputToken: ZapToken,
  inputAmount: bigint,
  minOutputAmount: bigint,
  recipient: Address
): `0x${string}` {
  const assetIn =
    inputToken === 'USDS'
      ? getAddress(PSM_CONFIG.usdsAddress)
      : getAddress(PSM_CONFIG.usdcAddress);
  const assetOut =
    inputToken === 'USDS'
      ? getAddress(PSM_CONFIG.usdcAddress)
      : getAddress(PSM_CONFIG.usdsAddress);

  return encodeFunctionData({
    abi: PSM3_ABI,
    functionName: 'swapExactIn',
    args: [
      assetIn,
      assetOut,
      inputAmount,
      minOutputAmount,
      recipient,
      BigInt(PSM_CONFIG.referralCode),
    ],
  });
}

/**
 * Get the token that needs to be approved for PSM3 swap.
 *
 * @param inputToken - Token being swapped
 * @returns Address of token to approve and spender (PSM3 contract)
 */
export function getPSMApprovalInfo(inputToken: ZapToken): {
  tokenToApprove: Address;
  spender: Address;
} {
  return {
    tokenToApprove:
      inputToken === 'USDS'
        ? getAddress(PSM_CONFIG.usdsAddress)
        : getAddress(PSM_CONFIG.usdcAddress),
    spender: getAddress(PSM_CONFIG.address),
  };
}

/**
 * Calculate minimum output amount with slippage.
 *
 * For PSM3, this is mainly for safety - actual swap is 1:1.
 *
 * @param expectedOutput - Expected output from quote
 * @param slippageBps - Slippage tolerance in basis points (e.g., 50 = 0.5%)
 * @returns Minimum acceptable output
 */
export function calculateMinOutputWithSlippage(
  expectedOutput: bigint,
  slippageBps: number = 10 // Default 0.1% for stablecoins
): bigint {
  const slippageMultiplier = 10000n - BigInt(slippageBps);
  return (expectedOutput * slippageMultiplier) / 10000n;
}
