/**
 * Transaction Execution Primitives
 *
 * Pure async functions for common transaction operations.
 * No React state — take hook references as parameters.
 * Used by all flow definitions via the step orchestrator.
 *
 * @see TRANSACTION_STEPPER_PLAN.md — Layer 1
 */

import type { Address, Hex, PublicClient } from 'viem';
import { maxUint256, encodeFunctionData, erc20Abi } from 'viem';
import { getStoredUserSettings } from '@/hooks/useUserSettings';

// =============================================================================
// SHARED TYPES
// =============================================================================

/** Minimal send-transaction function signature (raw calldata path) */
export type SendTransactionFn = (args: {
  to: Address;
  data: Hex;
  value?: bigint;
  gasLimit?: bigint;
}) => Promise<Hex>;

/** Minimal wait-for-receipt function signature */
export type WaitForReceiptFn = (args: {
  hash: Hex;
}) => Promise<{ status: 'success' | 'reverted' }>;

/** Minimal sign-typed-data function signature */
export type SignTypedDataFn = (args: {
  domain: Record<string, unknown>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}) => Promise<Hex>;

/** Transaction tracking info passed to Redux addTransaction */
export interface TransactionTrackingInfo {
  hash: Hex;
  chainId: number;
  from: Address;
  to: Address;
}

/** Optional transaction tracker (Redux addTransaction) */
export type AddTransactionFn = (
  tx: TransactionTrackingInfo,
  info: Record<string, unknown>,
) => void;

// =============================================================================
// APPROVAL PRIMITIVE
// =============================================================================

export interface ExecuteApprovalParams {
  /** Token contract address */
  token: Address;
  /** Address to approve (Permit2, Hook, KyberRouter, etc.) */
  spender: Address;
  /** Amount to approve (used for exact mode; ignored for infinite) */
  amount: bigint;
  /** Force infinite approval regardless of user settings */
  forceInfinite?: boolean;
  /** Send transaction function (from wagmi hooks) */
  sendTransaction: SendTransactionFn;
  /** Wait for receipt function */
  waitForReceipt: WaitForReceiptFn;
}

/**
 * Execute an ERC20 approval transaction.
 *
 * Respects user's approval mode setting (exact vs infinite).
 * Pure async — no React state, no UI side effects.
 *
 * @returns Transaction hash
 * @throws On reverted transaction or send failure
 */
export async function executeApproval(params: ExecuteApprovalParams): Promise<Hex> {
  const { token, spender, amount, forceInfinite, sendTransaction, waitForReceipt } = params;

  // Determine approval amount from user settings
  const userSettings = getStoredUserSettings();
  let approvalAmount: bigint;
  if (forceInfinite || userSettings.approvalMode === 'infinite') {
    approvalAmount = maxUint256;
  } else {
    // Exact mode: add 1 wei buffer, cap at maxUint256
    const buffered = amount + 1n;
    approvalAmount = buffered > maxUint256 ? maxUint256 : buffered;
  }

  // Encode approve(address,uint256) calldata
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, approvalAmount],
  });

  // Send and wait
  const hash = await sendTransaction({ to: token, data, value: 0n });
  const receipt = await waitForReceipt({ hash });

  if (receipt.status === 'reverted') {
    throw new Error(`Approval transaction reverted (${token} → ${spender})`);
  }

  return hash;
}

// =============================================================================
// PERMIT SIGNATURE PRIMITIVE
// =============================================================================

export interface ExecutePermitSignParams {
  /** EIP-712 domain */
  domain: Record<string, unknown>;
  /** EIP-712 types */
  types: Record<string, Array<{ name: string; type: string }>>;
  /** EIP-712 message (the permit data) */
  message: Record<string, unknown>;
  /** Primary type — if not provided, inferred from types keys */
  primaryType?: string;
  /** Sign typed data function (from wagmi hooks) */
  signTypedDataAsync: SignTypedDataFn;
}

/**
 * Execute a Permit2 (or any EIP-712) signature.
 *
 * Works for both PermitSingle (swaps) and PermitBatch (liquidity).
 * Pure async — no React state, no UI side effects.
 *
 * @returns Hex signature
 * @throws On user rejection or signing failure
 */
export async function executePermitSign(params: ExecutePermitSignParams): Promise<Hex> {
  const { domain, types, message, signTypedDataAsync } = params;

  // Infer primaryType from types if not provided
  const primaryType = params.primaryType
    ?? Object.keys(types).find((key) => key !== 'EIP712Domain')
    ?? 'PermitBatch';

  const signature = await signTypedDataAsync({
    domain,
    types,
    primaryType,
    message,
  });

  return signature;
}

// =============================================================================
// TRANSACTION PRIMITIVE
// =============================================================================

export interface SendAndConfirmParams {
  /** Transaction request — pre-built calldata */
  to: Address;
  data: Hex;
  value?: bigint;
  gasLimit?: bigint;
  /** Send transaction function */
  sendTransaction: SendTransactionFn;
  /** Wait for receipt function */
  waitForReceipt: WaitForReceiptFn;
}

/**
 * Send a transaction and wait for on-chain confirmation.
 *
 * Generic primitive for any transaction with pre-built calldata.
 * Used by position operations, zap steps, UY deposit/withdraw, etc.
 *
 * @returns Transaction hash
 * @throws On reverted transaction or send failure
 */
export async function sendAndConfirmTransaction(params: SendAndConfirmParams): Promise<Hex> {
  const { to, data, value, gasLimit, sendTransaction, waitForReceipt } = params;

  const hash = await sendTransaction({ to, data, value, gasLimit });
  const receipt = await waitForReceipt({ hash });

  if (receipt.status === 'reverted') {
    throw new Error(`Transaction reverted (to: ${to})`);
  }

  return hash;
}

// =============================================================================
// ALLOWANCE CHECK PRIMITIVE
// =============================================================================

export interface CheckAllowanceParams {
  /** Token contract address */
  token: Address;
  /** Owner address */
  owner: Address;
  /** Spender address */
  spender: Address;
  /** Required amount */
  requiredAmount: bigint;
  /** Public client for read calls */
  publicClient: PublicClient;
}

/**
 * Check if an ERC20 allowance is sufficient.
 *
 * @returns true if current allowance >= requiredAmount
 */
export async function checkAllowanceSufficient(params: CheckAllowanceParams): Promise<boolean> {
  const { token, owner, spender, requiredAmount, publicClient } = params;

  const allowance = await publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, spender],
  }) as bigint;

  return allowance >= requiredAmount;
}

// =============================================================================
// FETCH PERMIT DATA PRIMITIVE
// =============================================================================

export interface FetchPermitDataParams {
  /** User wallet address */
  userAddress: string;
  /** Token to permit */
  tokenAddress: Address;
  /** Token symbol (for logging) */
  tokenSymbol: string;
  /** Amount to permit */
  amount: bigint;
  /** Chain ID */
  chainId: number;
  /** Approval mode */
  approvalMode: 'exact' | 'infinite';
}

export interface PermitDataResponse {
  /** Whether a new permit signature is needed */
  needsPermit: boolean;
  /** Permit data for signing (if needsPermit is true) */
  permitData?: {
    domain: Record<string, unknown>;
    types: Record<string, Array<{ name: string; type: string }>>;
    message: Record<string, unknown>;
  };
}

/**
 * Fetch permit data from the backend API.
 *
 * Calls /api/swap/prepare-permit to check if a Permit2 signature
 * is needed and get the signing data if so.
 *
 * @returns Permit data response with needsPermit flag
 * @throws On network/API errors
 */
export async function fetchPermitData(params: FetchPermitDataParams): Promise<PermitDataResponse> {
  const { userAddress, tokenAddress, tokenSymbol, amount, chainId, approvalMode } = params;

  const response = await fetch('/api/swap/prepare-permit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userAddress,
      tokenAddress,
      tokenSymbol,
      amount: amount.toString(),
      chainId,
      approvalMode,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch permit data: ${response.status}`);
  }

  return response.json();
}
