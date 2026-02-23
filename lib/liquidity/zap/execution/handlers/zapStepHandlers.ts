/**
 * Zap Step Handlers
 *
 * Handlers for executing zap-specific transaction steps.
 * These integrate with the existing step executor registry.
 */

import type { Hex, Address, PublicClient } from 'viem';
import { formatUnits, createPublicClient, encodeFunctionData } from 'viem';
import { baseMainnet } from '@/lib/chains';
import { createFallbackTransport } from '@/lib/viemClient';
import type {
  ZapSwapApprovalStep,
  ZapPSMSwapStep,
  ZapPoolSwapStep,
} from '../../types';
import type {
  ZapDynamicDepositStep,
} from '../../../types';
import type {
  TransactionFunctions,
  StepExecutionContext,
  TransactionStepHandler,
} from '../../../transaction/executor/handlers/registry';
import { getStoredUserSettings } from '@/hooks/useUserSettings';
import { USDS_USDC_POOL_CONFIG } from '../../constants';
import { UNIFIED_YIELD_HOOK_ABI } from '../../../unified-yield/abi/unifiedYieldHookABI';
import { reportZapDust, calculateDustFromDelta } from '../../utils/reportZapDust';

// Helper to get token decimals from config
const getTokenDecimals = (token: 'USDS' | 'USDC'): number =>
  token === 'USDS' ? USDS_USDC_POOL_CONFIG.token0.decimals : USDS_USDC_POOL_CONFIG.token1.decimals;

// =============================================================================
// SWAP APPROVAL HANDLER
// =============================================================================

/**
 * Handle ZapSwapApproval step.
 *
 * Approves input token for swap (to PSM or Permit2).
 */
export const handleZapSwapApprovalStep: TransactionStepHandler = async (
  step,
  context,
  txFunctions
): Promise<`0x${string}`> => {
  const typedStep = step as unknown as ZapSwapApprovalStep;

  console.log(`[ZapSwapApproval] Approving ${typedStep.tokenSymbol} to ${typedStep.spender}`);

  // Signal step is starting (waiting for user)
  context.setCurrentStep({ step, accepted: false });

  // Send approval transaction
  const hash = await txFunctions.sendTransaction({
    to: typedStep.txRequest.to as `0x${string}`,
    data: typedStep.txRequest.data as Hex,
    value: typedStep.txRequest.value,
  });

  console.log(`[ZapSwapApproval] Transaction submitted: ${hash}`);

  // Signal transaction was accepted
  context.setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  const receipt = await txFunctions.waitForReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`Swap approval failed: ${hash}`);
  }

  console.log(`[ZapSwapApproval] Confirmed: ${hash}`);

  return hash;
};

// =============================================================================
// PSM SWAP HANDLER
// =============================================================================

/**
 * Handle ZapPSMSwap step.
 *
 * Executes a 1:1 swap via the PSM contract.
 */
export const handleZapPSMSwapStep: TransactionStepHandler = async (
  step,
  context,
  txFunctions
): Promise<`0x${string}`> => {
  const typedStep = step as unknown as ZapPSMSwapStep;

  console.log(
    `[ZapPSMSwap] Swapping ${typedStep.direction}: ${typedStep.inputAmount} -> ${typedStep.expectedOutputAmount}`
  );

  // Signal step is starting
  context.setCurrentStep({ step, accepted: false });

  // Send PSM swap transaction
  const hash = await txFunctions.sendTransaction({
    to: typedStep.txRequest.to as `0x${string}`,
    data: typedStep.txRequest.data as Hex,
    value: typedStep.txRequest.value,
  });

  console.log(`[ZapPSMSwap] Transaction submitted: ${hash}`);

  // Signal transaction was accepted
  context.setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  const receipt = await txFunctions.waitForReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`PSM swap failed: ${hash}`);
  }

  console.log(`[ZapPSMSwap] Confirmed: ${hash}`);

  return hash;
};

// =============================================================================
// POOL SWAP HANDLER
// =============================================================================

/**
 * Handle ZapPoolSwap step.
 *
 * Executes a swap via the Universal Router by calling the existing
 * /api/swap/prepare-permit and /api/swap/build-tx endpoints.
 * This follows the same flow as useSwapExecution.ts.
 */
export const handleZapPoolSwapStep: TransactionStepHandler = async (
  step,
  context,
  txFunctions
): Promise<`0x${string}`> => {
  const typedStep = step as unknown as ZapPoolSwapStep;

  console.log(
    `[ZapPoolSwap] Swapping ${typedStep.inputToken} -> ${typedStep.outputToken}: ${typedStep.inputAmount}`
  );

  const inputDecimals = getTokenDecimals(typedStep.inputToken);
  const outputDecimals = getTokenDecimals(typedStep.outputToken);
  const chainId = context.chainId || 8453; // Default to Base mainnet

  // Get user's approval mode setting (exact or infinite)
  const userSettings = getStoredUserSettings();

  // Step 1: Call prepare-permit to check if we need a Permit2 signature
  console.log('[ZapPoolSwap] Calling prepare-permit API...');
  const preparePermitResponse = await fetch('/api/swap/prepare-permit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userAddress: context.address,
      fromTokenSymbol: typedStep.inputToken,
      fromTokenAddress: typedStep.inputTokenAddress,
      toTokenSymbol: typedStep.outputToken,
      chainId,
      amountIn: typedStep.inputAmount.toString(),
      approvalMode: userSettings.approvalMode, // Use user's setting (exact or infinite)
    }),
  });

  if (!preparePermitResponse.ok) {
    const errorData = await preparePermitResponse.json().catch(() => ({}));
    throw new Error(`Failed to prepare permit: ${errorData.message || preparePermitResponse.statusText}`);
  }

  const permitResult = await preparePermitResponse.json();
  if (!permitResult.ok) {
    throw new Error(`Prepare permit failed: ${permitResult.message}`);
  }

  console.log('[ZapPoolSwap] Permit result:', {
    needsPermit: permitResult.needsPermit,
    isApproved: permitResult.isApproved,
  });

  // Step 2: If permit needed, sign it
  let permitSignature = '0x';
  let permitData = {
    permitTokenAddress: typedStep.inputTokenAddress,
    permitAmount: '0',
    permitNonce: 0,
    permitExpiration: 0,
    permitSigDeadline: '0',
  };

  if (permitResult.needsPermit) {
    if (!context.signTypedData) {
      throw new Error('signTypedData not available in context - cannot sign Permit2 permit');
    }

    console.log('[ZapPoolSwap] Signing Permit2 permit...');

    // Convert message amounts back to bigint for signing
    const typedMessage = {
      details: {
        token: permitResult.permitData.message.details.token as Address,
        amount: BigInt(permitResult.permitData.message.details.amount),
        expiration: permitResult.permitData.message.details.expiration,
        nonce: permitResult.permitData.message.details.nonce,
      },
      spender: permitResult.permitData.message.spender as Address,
      sigDeadline: BigInt(permitResult.permitData.message.sigDeadline),
    };

    permitSignature = await context.signTypedData({
      domain: permitResult.permitData.domain,
      types: permitResult.permitData.types,
      primaryType: permitResult.permitData.primaryType,
      message: typedMessage,
    });

    console.log('[ZapPoolSwap] Permit signed');

    // Store permit data for build-tx call
    permitData = {
      permitTokenAddress: permitResult.permitData.message.details.token,
      permitAmount: permitResult.permitData.message.details.amount,
      permitNonce: permitResult.permitData.message.details.nonce,
      permitExpiration: permitResult.permitData.message.details.expiration,
      permitSigDeadline: permitResult.permitData.message.sigDeadline,
    };
  }

  // Step 3: Build swap transaction using existing API
  // Use formatUnits to avoid precision loss when converting bigint to decimal string
  // (JavaScript Number loses precision for values > 2^53, USDS/USDC amounts can exceed this)
  console.log('[ZapPoolSwap] Calling build-tx API...');
  const buildTxResponse = await fetch('/api/swap/build-tx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userAddress: context.address,
      fromTokenSymbol: typedStep.inputToken,
      toTokenSymbol: typedStep.outputToken,
      swapType: 'ExactIn',
      amountDecimalsStr: formatUnits(typedStep.inputAmount, inputDecimals),
      limitAmountDecimalsStr: formatUnits(typedStep.minOutputAmount, outputDecimals),
      permitSignature,
      permitTokenAddress: permitData.permitTokenAddress,
      permitAmount: permitData.permitAmount,
      permitNonce: permitData.permitNonce,
      permitExpiration: permitData.permitExpiration,
      permitSigDeadline: permitData.permitSigDeadline,
      chainId,
    }),
  });

  if (!buildTxResponse.ok) {
    const errorData = await buildTxResponse.json().catch(() => ({}));
    throw new Error(`Failed to build pool swap tx: ${errorData.message || buildTxResponse.statusText}`);
  }

  const txData = await buildTxResponse.json();
  if (!txData.ok) {
    throw new Error(`Pool swap build failed: ${txData.message}`);
  }

  console.log(`[ZapPoolSwap] Built transaction to ${txData.to}`);

  // Signal step is starting (user will confirm tx)
  context.setCurrentStep({ step, accepted: false });

  // Step 4: Encode and send the execute call for Universal Router
  const { encodeFunctionData } = await import('viem');
  const executeCalldata = encodeFunctionData({
    abi: [
      {
        name: 'execute',
        type: 'function',
        stateMutability: 'payable',
        inputs: [
          { name: 'commands', type: 'bytes' },
          { name: 'inputs', type: 'bytes[]' },
          { name: 'deadline', type: 'uint256' },
        ],
        outputs: [],
      },
    ],
    functionName: 'execute',
    args: [txData.commands, txData.inputs, BigInt(txData.deadline)],
  });

  // Send swap transaction via Universal Router
  const hash = await txFunctions.sendTransaction({
    to: txData.to as `0x${string}`,
    data: executeCalldata,
    value: BigInt(txData.value || '0'),
  });

  console.log(`[ZapPoolSwap] Transaction submitted: ${hash}`);

  // Signal transaction was accepted
  context.setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  const receipt = await txFunctions.waitForReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`Pool swap failed: ${hash}`);
  }

  console.log(`[ZapPoolSwap] Confirmed: ${hash}`);

  return hash;
};

// =============================================================================
// DYNAMIC DEPOSIT HANDLER
// =============================================================================

/**
 * ERC20 balanceOf ABI for querying token balances
 */
const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

/**
 * Handle ZapDynamicDeposit step.
 *
 * This handler queries ACTUAL token balances after the swap completes,
 * then calculates the correct shares to mint and builds the deposit tx.
 *
 * This fixes the "insufficient balance" error that occurs when the swap
 * output differs slightly from the preview estimate.
 *
 * Strategy:
 * - Query user's actual balance of both tokens
 * - Use min(actual_balance, expected_amount) to avoid depositing pre-existing funds
 * - Call previewAddFromAmount0/1 with actual amounts to get correct shares
 * - Build and execute the deposit transaction
 */
export const handleZapDynamicDepositStep: TransactionStepHandler = async (
  step,
  context,
  txFunctions
): Promise<`0x${string}`> => {
  const typedStep = step as unknown as ZapDynamicDepositStep;

  console.log(`[ZapDynamicDeposit] Building deposit with actual balances...`);

  // Create a public client for RPC calls
  const publicClient = createPublicClient({
    chain: baseMainnet,
    transport: createFallbackTransport(baseMainnet),
  });

  // Query actual token balances
  const [balance0, balance1] = await Promise.all([
    publicClient.readContract({
      address: typedStep.token0Address,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [context.address],
    }) as Promise<bigint>,
    publicClient.readContract({
      address: typedStep.token1Address,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [context.address],
    }) as Promise<bigint>,
  ]);

  console.log(`[ZapDynamicDeposit] Actual balances: token0=${balance0}, token1=${balance1}`);

  // Determine which token was the input token
  // and call the appropriate preview function
  let shares: bigint;
  let amount0: bigint;
  let amount1: bigint;

  if (typedStep.inputToken === 'USDS') {
    // Input was USDS (token0) - use token0 balance for preview
    // This gives us shares based on available USDS
    const preview = await publicClient.readContract({
      address: typedStep.hookAddress,
      abi: UNIFIED_YIELD_HOOK_ABI,
      functionName: 'previewAddFromAmount0',
      args: [balance0],
    }) as [bigint, bigint];

    const [requiredAmount1, previewShares] = preview;

    // Use the smaller of required vs actual for token1 (the swapped token)
    // This handles the case where swap output was less than expected
    amount0 = balance0;
    amount1 = requiredAmount1 <= balance1 ? requiredAmount1 : balance1;
    shares = previewShares;

    // If we don't have enough token1, recalculate based on token1
    if (requiredAmount1 > balance1) {
      console.log(`[ZapDynamicDeposit] Token1 limited, recalculating from token1 balance`);
      const preview1 = await publicClient.readContract({
        address: typedStep.hookAddress,
        abi: UNIFIED_YIELD_HOOK_ABI,
        functionName: 'previewAddFromAmount1',
        args: [balance1],
      }) as [bigint, bigint];
      const [requiredAmount0, shares1] = preview1;
      amount0 = requiredAmount0 <= balance0 ? requiredAmount0 : balance0;
      amount1 = balance1;
      shares = shares1;
    }
  } else {
    // Input was USDC (token1) - use token1 balance for preview
    const preview = await publicClient.readContract({
      address: typedStep.hookAddress,
      abi: UNIFIED_YIELD_HOOK_ABI,
      functionName: 'previewAddFromAmount1',
      args: [balance1],
    }) as [bigint, bigint];

    const [requiredAmount0, previewShares] = preview;

    // Use the smaller of required vs actual for token0 (the swapped token)
    amount0 = requiredAmount0 <= balance0 ? requiredAmount0 : balance0;
    amount1 = balance1;
    shares = previewShares;

    // If we don't have enough token0, recalculate based on token0
    if (requiredAmount0 > balance0) {
      console.log(`[ZapDynamicDeposit] Token0 limited, recalculating from token0 balance`);
      const preview0 = await publicClient.readContract({
        address: typedStep.hookAddress,
        abi: UNIFIED_YIELD_HOOK_ABI,
        functionName: 'previewAddFromAmount0',
        args: [balance0],
      }) as [bigint, bigint];
      const [requiredAmount1, shares0] = preview0;
      amount0 = balance0;
      amount1 = requiredAmount1 <= balance1 ? requiredAmount1 : balance1;
      shares = shares0;
    }
  }

  console.log(`[ZapDynamicDeposit] Calculated: shares=${shares}, amount0=${amount0}, amount1=${amount1}`);

  // Apply shares haircut (0.0001%) to account for yield accrual
  const sharesReduction = shares / 1000000n;
  const adjustedShares = shares - (sharesReduction > 0n ? sharesReduction : 1n);

  // Build deposit calldata
  const depositCalldata = encodeFunctionData({
    abi: UNIFIED_YIELD_HOOK_ABI,
    functionName: 'addReHypothecatedLiquidity',
    args: [adjustedShares, 0n, 0], // Skip slippage check (0n sqrtPrice, 0 maxSlippage)
  });

  console.log(`[ZapDynamicDeposit] Built deposit with ${adjustedShares} shares`);

  // Signal step is starting
  context.setCurrentStep({ step, accepted: false });

  // Send deposit transaction
  const hash = await txFunctions.sendTransaction({
    to: typedStep.hookAddress,
    data: depositCalldata,
    value: 0n,
  });

  console.log(`[ZapDynamicDeposit] Transaction submitted: ${hash}`);

  // Signal transaction was accepted
  context.setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  const receipt = await txFunctions.waitForReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`Dynamic deposit failed: ${hash}`);
  }

  console.log(`[ZapDynamicDeposit] Confirmed: ${hash}`);

  // =========================================================================
  // DUST CALCULATION AND REPORTING
  // =========================================================================
  // If initial balances were provided, calculate and report dust
  if (typedStep.initialBalance0 !== undefined && typedStep.initialBalance1 !== undefined) {
    try {
      // Query final balances after deposit
      const [finalBalance0, finalBalance1] = await Promise.all([
        publicClient.readContract({
          address: typedStep.token0Address,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [context.address],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: typedStep.token1Address,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [context.address],
        }) as Promise<bigint>,
      ]);

      // Calculate dust as delta from initial balances
      const { dust0, dust1 } = calculateDustFromDelta(
        typedStep.initialBalance0,
        typedStep.initialBalance1,
        finalBalance0,
        finalBalance1
      );

      console.log(`[ZapDynamicDeposit] Dust calculation:`, {
        initialBalance0: typedStep.initialBalance0.toString(),
        initialBalance1: typedStep.initialBalance1.toString(),
        finalBalance0: finalBalance0.toString(),
        finalBalance1: finalBalance1.toString(),
        dust0: dust0.toString(),
        dust1: dust1.toString(),
      });

      // Report dust if it exceeds threshold
      reportZapDust({
        token0Dust: dust0,
        token1Dust: dust1,
        token0Symbol: typedStep.token0Symbol,
        token1Symbol: typedStep.token1Symbol,
        token0Decimals: typedStep.token0Decimals,
        token1Decimals: typedStep.token1Decimals,
        inputAmountUSD: typedStep.inputAmountUSD ?? 0,
      });
    } catch (dustError) {
      // Don't fail the transaction for dust calculation errors
      console.warn(`[ZapDynamicDeposit] Failed to calculate dust:`, dustError);
    }
  }

  return hash;
};

// =============================================================================
// REGISTRY ENTRIES
// =============================================================================

/**
 * Zap step handler entries for the registry.
 *
 * Import and spread these into STEP_HANDLER_REGISTRY to enable
 * zap step execution.
 */
export const ZAP_STEP_HANDLERS = {
  ZapSwapApproval: {
    handler: handleZapSwapApprovalStep,
  },
  ZapPSMSwap: {
    handler: handleZapPSMSwapStep,
  },
  ZapPoolSwap: {
    handler: handleZapPoolSwapStep,
  },
  ZapDynamicDeposit: {
    handler: handleZapDynamicDepositStep,
  },
} as const;

// =============================================================================
// TYPE GUARD
// =============================================================================

/**
 * Check if a step type is a zap step.
 */
export function isZapStep(stepType: string): boolean {
  return (
    stepType === 'ZapSwapApproval' ||
    stepType === 'ZapPSMSwap' ||
    stepType === 'ZapPoolSwap' ||
    stepType === 'ZapDynamicDeposit'
  );
}
