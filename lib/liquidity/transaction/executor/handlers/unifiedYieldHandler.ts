/**
 * Unified Yield Transaction Handler
 *
 * Handles Unified Yield transaction steps:
 * - Approval: Direct ERC20 approval to Hook (no Permit2)
 * - Deposit: Add liquidity to Hook for shares
 * - Withdraw: Remove liquidity by burning shares
 *
 * Unlike V4 which uses Permit2 + PositionManager, Unified Yield uses
 * direct ERC20 approvals to the Hook contract which IS the vault.
 */

import type { Hex } from 'viem';
import { createPublicClient } from 'viem';
import { reportFailedTx, markReported } from '@/lib/observability';
import { baseMainnet } from '@/lib/chains';
import { createFallbackTransport } from '@/lib/viemClient';
import type {
  UnifiedYieldApprovalStep,
  UnifiedYieldDepositStep,
  UnifiedYieldWithdrawStep,
} from '../../../types';
import { ERC20_ABI } from '@/lib/abis/erc20';

// =============================================================================
// TYPES
// =============================================================================

export interface HandleUnifiedYieldApprovalParams {
  address: `0x${string}`;
  step: UnifiedYieldApprovalStep;
  setCurrentStep: (params: { step: UnifiedYieldApprovalStep; accepted: boolean }) => void;
  /** Chain id used to surface revert reasons via a post-revert eth_call. Optional. */
  chainId?: number;
}

export interface HandleUnifiedYieldDepositParams {
  address: `0x${string}`;
  step: UnifiedYieldDepositStep;
  setCurrentStep: (params: { step: UnifiedYieldDepositStep; accepted: boolean }) => void;
  /** Chain id used to surface revert reasons via a post-revert eth_call. Optional. */
  chainId?: number;
}

export interface HandleUnifiedYieldWithdrawParams {
  address: `0x${string}`;
  step: UnifiedYieldWithdrawStep;
  setCurrentStep: (params: { step: UnifiedYieldWithdrawStep; accepted: boolean }) => void;
  /** Chain id used to surface revert reasons via a post-revert eth_call. Optional. */
  chainId?: number;
}

// =============================================================================
// UNIFIED YIELD APPROVAL HANDLER
// =============================================================================

/**
 * Handles Unified Yield approval step (direct ERC20 approval to Hook)
 *
 * Unlike V4's Permit2 flow, this is a simple ERC20 approve() call
 * directly to the Hook contract.
 *
 * @param params - Handler parameters
 * @param sendTransaction - Wagmi sendTransaction function
 * @param waitForReceipt - Wagmi waitForTransactionReceipt function
 * @returns Transaction hash on success
 */
export async function handleUnifiedYieldApprovalStep(
  params: HandleUnifiedYieldApprovalParams,
  sendTransaction: (args: {
    to: `0x${string}`;
    data: Hex;
    value?: bigint;
  }) => Promise<`0x${string}`>,
  waitForReceipt: (args: { hash: `0x${string}` }) => Promise<{ status: 'success' | 'reverted' }>,
): Promise<`0x${string}`> {
  const { step, setCurrentStep, address, chainId } = params;

  // Trigger UI prompting user to accept
  setCurrentStep({ step, accepted: false });

  try {
    // Submit approval transaction
    const hash = await sendTransaction({
      to: step.txRequest.to,
      data: step.txRequest.data,
      value: step.txRequest.value,
    });

    // Trigger waiting UI after user accepts
    setCurrentStep({ step, accepted: true });

    // Wait for confirmation
    const receipt = await waitForReceipt({ hash });

    if (receipt.status === 'reverted') {
      throw new Error(`${step.type} transaction reverted`);
    }

    return hash;
  } catch (error) {
    // Capture approval failures with FULL context. This is critical for debugging
    // intermittent approval issues. User rejections are dropped inside reportFailedTx.
    const errorObj = error instanceof Error ? error : new Error(String(error));

    // Log to console for immediate visibility during debugging
    console.error('[UnifiedYieldApprovalHandler] Approval transaction failed:', {
      userAddress: address,
      tokenSymbol: step.tokenSymbol,
      hookAddress: step.hookAddress,
      txRequestData: step.txRequest.data,
      error: errorObj.message,
    });

    // Fetch diagnostic data to understand WHY this specific user is failing
    let diagnosticData: Record<string, unknown> = {};
    try {
      const publicClient = createPublicClient({
        chain: baseMainnet,
        transport: createFallbackTransport(baseMainnet),
      });

      // Check current allowance - might reveal existing approval issues
      const currentAllowance = await publicClient.readContract({
        address: step.tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, step.hookAddress as `0x${string}`],
      });

      // Check user's token balance
      const tokenBalance = await publicClient.readContract({
        address: step.tokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      });

      // Check user's ETH balance for gas
      const ethBalance = await publicClient.getBalance({ address });

      // Try to simulate the approval call to get detailed error
      let simulationError: string | undefined;
      try {
        await publicClient.simulateContract({
          address: step.tokenAddress as `0x${string}`,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [step.hookAddress as `0x${string}`, step.amount],
          account: address,
        });
      } catch (simErr: any) {
        simulationError = simErr?.message || String(simErr);
      }

      diagnosticData = {
        currentAllowance: currentAllowance?.toString(),
        tokenBalance: tokenBalance?.toString(),
        ethBalance: ethBalance?.toString(),
        simulationError,
        // Is the requested amount less than current allowance?
        alreadyApproved: currentAllowance ? BigInt(currentAllowance as bigint) >= step.amount : false,
        // Does user have enough tokens?
        hasSufficientBalance: tokenBalance ? BigInt(tokenBalance as bigint) >= step.amount : false,
      };
    } catch (diagErr) {
      diagnosticData = { diagnosticFetchError: String(diagErr) };
    }

    // Route through the consolidated reporter so this ALSO gets revert decode (via
    // the read-only eth_call replay) on top of the rich diagnostics. Pass the
    // original error so categorizeError + user-rejection drop apply; supply tx
    // coordinates for the decode. Pass calldata SELECTOR only (not full calldata)
    // to avoid event bloat.
    await reportFailedTx(error, {
      domain: 'unified-yield',
      action: 'approve',
      component: 'UnifiedYieldApprovalHandler',
      fingerprint: ['unified-yield-approval-failure', step.tokenSymbol],
      tags: { tokenSymbol: step.tokenSymbol, stepType: step.type },
      to: step.txRequest.to,
      data: step.txRequest.data,
      value: step.txRequest.value,
      from: address,
      chainId,
      extras: {
        userAddress: address,
        ...diagnosticData,
        tokenAddress: step.tokenAddress,
        tokenSymbol: step.tokenSymbol,
        hookAddress: step.hookAddress,
        approvalAmount: step.amount.toString(),
        txRequestTo: step.txRequest.to,
        txRequestDataLength: step.txRequest.data?.length,
        txRequestValue: step.txRequest.value?.toString(),
        errorCause: (error as any)?.cause?.message || (error as any)?.cause,
        errorShortMessage: (error as any)?.shortMessage,
        errorDetails: (error as any)?.details,
        // Selector only — avoid full-calldata event bloat.
        calldataSelector: step.txRequest.data?.slice(0, 10),
      },
    });

    // Re-throw to let the executor handle it. Marked already-reported so the
    // upstream useStepExecutor catch does not report this SAME failure again.
    markReported(error);
    throw error;
  }
}

// =============================================================================
// UNIFIED YIELD DEPOSIT HANDLER
// =============================================================================

/**
 * Handles Unified Yield deposit step
 *
 * Calls Hook.addReHypothecatedLiquidity() to deposit tokens and receive shares.
 *
 * @param params - Handler parameters
 * @param sendTransaction - Wagmi sendTransaction function
 * @param waitForReceipt - Wagmi waitForTransactionReceipt function
 * @returns Transaction hash on success
 */
export async function handleUnifiedYieldDepositStep(
  params: HandleUnifiedYieldDepositParams,
  sendTransaction: (args: {
    to: `0x${string}`;
    data: Hex;
    value?: bigint;
    gasLimit?: bigint;
  }) => Promise<`0x${string}`>,
  waitForReceipt: (args: { hash: `0x${string}` }) => Promise<{ status: 'success' | 'reverted' }>,
): Promise<`0x${string}`> {
  const { step, setCurrentStep, address, chainId } = params;

  // Trigger UI prompting user to accept
  setCurrentStep({ step, accepted: false });

  // Submit deposit transaction
  const hash = await sendTransaction({
    to: step.txRequest.to,
    data: step.txRequest.data,
    value: step.txRequest.value,
    gasLimit: step.txRequest.gasLimit,
  });

  // Trigger waiting UI after user accepts
  setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  const receipt = await waitForReceipt({ hash });

  if (receipt.status === 'reverted') {
    // Decode the revert reason via a read-only eth_call replay. Previously this
    // site had no diagnostics.
    await reportFailedTx(null, {
      domain: 'unified-yield',
      action: 'deposit',
      component: 'unifiedYieldHandler',
      txHash: hash,
      to: step.txRequest.to,
      data: step.txRequest.data,
      value: step.txRequest.value,
      from: address,
      chainId,
      extras: { stepType: step.type, userAddress: address, hookAddress: step.hookAddress, poolId: step.poolId },
    });
    throw markReported(new Error(`${step.type} transaction reverted`));
  }

  return hash;
}

// =============================================================================
// UNIFIED YIELD WITHDRAW HANDLER
// =============================================================================

/**
 * Handles Unified Yield withdraw step
 *
 * Calls Hook.removeReHypothecatedLiquidity() to burn shares and receive tokens.
 * No approval needed - user owns the shares directly.
 *
 * @param params - Handler parameters
 * @param sendTransaction - Wagmi sendTransaction function
 * @param waitForReceipt - Wagmi waitForTransactionReceipt function
 * @returns Transaction hash on success
 */
export async function handleUnifiedYieldWithdrawStep(
  params: HandleUnifiedYieldWithdrawParams,
  sendTransaction: (args: {
    to: `0x${string}`;
    data: Hex;
    value?: bigint;
    gasLimit?: bigint;
  }) => Promise<`0x${string}`>,
  waitForReceipt: (args: { hash: `0x${string}` }) => Promise<{ status: 'success' | 'reverted' }>,
): Promise<`0x${string}`> {
  const { step, setCurrentStep, address, chainId } = params;

  // Trigger UI prompting user to accept
  setCurrentStep({ step, accepted: false });

  // Submit withdraw transaction
  const hash = await sendTransaction({
    to: step.txRequest.to,
    data: step.txRequest.data,
    value: step.txRequest.value,
    gasLimit: step.txRequest.gasLimit,
  });

  // Trigger waiting UI after user accepts
  setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  const receipt = await waitForReceipt({ hash });

  if (receipt.status === 'reverted') {
    // Decode the revert reason via a read-only eth_call replay. Previously this
    // site had no diagnostics.
    await reportFailedTx(null, {
      domain: 'unified-yield',
      action: 'withdraw',
      component: 'unifiedYieldHandler',
      txHash: hash,
      to: step.txRequest.to,
      data: step.txRequest.data,
      value: step.txRequest.value,
      from: address,
      chainId,
      extras: { stepType: step.type, userAddress: address, hookAddress: step.hookAddress, poolId: step.poolId },
    });
    throw markReported(new Error(`${step.type} transaction reverted`));
  }

  return hash;
}
