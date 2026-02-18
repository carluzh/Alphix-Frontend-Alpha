/**
 * Zap Step Handlers
 *
 * Handlers for executing zap-specific transaction steps.
 * These integrate with the existing step executor registry.
 */

import type { Hex, Address, PublicClient } from 'viem';
import { formatUnits, createPublicClient, http, encodeFunctionData } from 'viem';
import { base } from 'viem/chains';
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

  // Signal step is starting (waiting for user)
  context.setCurrentStep({ step, accepted: false });

  // Send approval transaction
  const hash = await txFunctions.sendTransaction({
    to: typedStep.txRequest.to as `0x${string}`,
    data: typedStep.txRequest.data as Hex,
    value: typedStep.txRequest.value,
  });

  // Signal transaction was accepted
  context.setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  const receipt = await txFunctions.waitForReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`Swap approval failed: ${hash}`);
  }

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

  // Signal step is starting
  context.setCurrentStep({ step, accepted: false });

  // Send PSM swap transaction
  const hash = await txFunctions.sendTransaction({
    to: typedStep.txRequest.to as `0x${string}`,
    data: typedStep.txRequest.data as Hex,
    value: typedStep.txRequest.value,
  });

  // Signal transaction was accepted
  context.setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  const receipt = await txFunctions.waitForReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`PSM swap failed: ${hash}`);
  }

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
  const inputDecimals = getTokenDecimals(typedStep.inputToken);
  const outputDecimals = getTokenDecimals(typedStep.outputToken);
  const chainId = context.chainId || 8453; // Default to Base mainnet

  // Get user's approval mode setting (exact or infinite)
  const userSettings = getStoredUserSettings();

  // Step 1: Call prepare-permit to check if we need a Permit2 signature
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

  // Signal transaction was accepted
  context.setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  const receipt = await txFunctions.waitForReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`Pool swap failed: ${hash}`);
  }

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

  // Create a public client for RPC calls
  const publicClient = createPublicClient({
    chain: base,
    transport: http(),
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

  // Cap balances to expected amounts to avoid over-spending allowance
  // User may have existing balance beyond what's approved for this zap
  // Ensure BigInt for arithmetic (values may come from JSON as strings)
  const bal0 = BigInt(balance0);
  const bal1 = BigInt(balance1);
  const exp0 = BigInt(typedStep.expectedDepositAmount0);
  const exp1 = BigInt(typedStep.expectedDepositAmount1);
  const cappedBalance0 = bal0 < exp0 ? bal0 : exp0;
  const cappedBalance1 = bal1 < exp1 ? bal1 : exp1;

  // Try both deposit directions and pick the one with less dust
  // This helps when the pool ratio shifted between preview and execution
  //
  // Option A: Constrain by token0 (USDS) - may leave token1 (USDC) dust
  // Option B: Constrain by token1 (USDC) - may leave token0 (USDS) dust

  // Get previews for both directions
  const [previewFrom0, previewFrom1] = await Promise.all([
    publicClient.readContract({
      address: typedStep.hookAddress,
      abi: UNIFIED_YIELD_HOOK_ABI,
      functionName: 'previewAddFromAmount0',
      args: [cappedBalance0],
    }) as Promise<[bigint, bigint]>,
    publicClient.readContract({
      address: typedStep.hookAddress,
      abi: UNIFIED_YIELD_HOOK_ABI,
      functionName: 'previewAddFromAmount1',
      args: [cappedBalance1],
    }) as Promise<[bigint, bigint]>,
  ]);

  // Ensure BigInt for arithmetic (contract calls may return various types)
  const requiredToken1ForToken0 = BigInt(previewFrom0[0]);
  const sharesFromToken0 = BigInt(previewFrom0[1]);
  const requiredToken0ForToken1 = BigInt(previewFrom1[0]);
  const sharesFromToken1 = BigInt(previewFrom1[1]);

  // Determine which option is viable and has less dust
  // Option A: Use all of token0, need requiredToken1ForToken0 of token1
  const canDoOptionA = requiredToken1ForToken0 <= cappedBalance1;
  const dustAToken1 = canDoOptionA ? cappedBalance1 - requiredToken1ForToken0 : 0n;
  // Convert token1 dust (6 decimals) to token0 equivalent (18 decimals) for comparison
  const dustANormalized = dustAToken1 * (10n ** 12n);

  // Option B: Use all of token1, need requiredToken0ForToken1 of token0
  const canDoOptionB = requiredToken0ForToken1 <= cappedBalance0;
  const dustBToken0 = canDoOptionB ? cappedBalance0 - requiredToken0ForToken1 : 0n;
  // token0 dust is already in 18 decimals
  const dustBNormalized = dustBToken0;

  let shares: bigint;
  let amount0: bigint;
  let amount1: bigint;

  // Pick the option with less dust (prefer viable options)
  if (canDoOptionA && canDoOptionB) {
    // Both viable, pick the one with less normalized dust
    if (dustANormalized <= dustBNormalized) {
      amount0 = cappedBalance0;
      amount1 = requiredToken1ForToken0;
      shares = sharesFromToken0;
    } else {
      amount0 = requiredToken0ForToken1;
      amount1 = cappedBalance1;
      shares = sharesFromToken1;
    }
  } else if (canDoOptionA) {
    amount0 = cappedBalance0;
    amount1 = requiredToken1ForToken0;
    shares = sharesFromToken0;
  } else if (canDoOptionB) {
    amount0 = requiredToken0ForToken1;
    amount1 = cappedBalance1;
    shares = sharesFromToken1;
  } else {
    // Neither option is fully viable - use partial amounts
    console.warn(`[ZapDynamicDeposit] Neither option fully viable, using partial amounts`);
    const token0Ratio = (cappedBalance0 * 1000n) / (requiredToken0ForToken1 > 0n ? requiredToken0ForToken1 : 1n);
    const token1Ratio = (cappedBalance1 * 1000n) / (requiredToken1ForToken0 > 0n ? requiredToken1ForToken0 : 1n);

    if (token0Ratio <= token1Ratio) {
      amount0 = cappedBalance0;
      amount1 = requiredToken1ForToken0 <= cappedBalance1 ? requiredToken1ForToken0 : cappedBalance1;
      shares = sharesFromToken0;
    } else {
      amount0 = requiredToken0ForToken1 <= cappedBalance0 ? requiredToken0ForToken1 : cappedBalance0;
      amount1 = cappedBalance1;
      shares = sharesFromToken1;
    }
  }

  // Apply shares haircut (0.0001%) to account for yield accrual
  const sharesReduction = shares / 1000000n;
  const adjustedShares = shares - (sharesReduction > 0n ? sharesReduction : 1n);

  // Build deposit calldata
  const depositCalldata = encodeFunctionData({
    abi: UNIFIED_YIELD_HOOK_ABI,
    functionName: 'addReHypothecatedLiquidity',
    args: [adjustedShares, 0n, 0], // Skip slippage check (0n sqrtPrice, 0 maxSlippage)
  });

  console.log(`[ZapDynamicDeposit] Sending deposit tx to ${typedStep.hookAddress}`);
  console.log(`[ZapDynamicDeposit] Shares to mint: ${adjustedShares.toString()}`);
  console.log(`[ZapDynamicDeposit] Deposit amounts: ${formatUnits(amount0, typedStep.token0Decimals)} ${typedStep.token0Symbol} + ${formatUnits(amount1, typedStep.token1Decimals)} ${typedStep.token1Symbol}`);

  // Signal step is starting
  context.setCurrentStep({ step, accepted: false });

  // Send deposit transaction
  const hash = await txFunctions.sendTransaction({
    to: typedStep.hookAddress,
    data: depositCalldata,
    value: 0n,
  });

  console.log(`[ZapDynamicDeposit] Deposit tx sent: ${hash}`);

  // Signal transaction was accepted
  context.setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  const receipt = await txFunctions.waitForReceipt({ hash });

  console.log(`[ZapDynamicDeposit] Deposit tx confirmed: status=${receipt.status}`);

  if (receipt.status !== 'success') {
    throw new Error(`Dynamic deposit failed: ${hash}`);
  }

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

      // Debug: log balance values to trace dust calculation
      console.log(`[ZapDynamicDeposit] DEBUG - Balance tracking:`);
      console.log(`[ZapDynamicDeposit]   Initial: ${formatUnits(typedStep.initialBalance0, typedStep.token0Decimals)} ${typedStep.token0Symbol} + ${formatUnits(typedStep.initialBalance1, typedStep.token1Decimals)} ${typedStep.token1Symbol}`);
      console.log(`[ZapDynamicDeposit]   Final: ${formatUnits(finalBalance0, typedStep.token0Decimals)} ${typedStep.token0Symbol} + ${formatUnits(finalBalance1, typedStep.token1Decimals)} ${typedStep.token1Symbol}`);
      console.log(`[ZapDynamicDeposit]   Input amount: ${typedStep.inputAmount?.toString() ?? 'undefined'} ${typedStep.inputToken}`);

      // Calculate dust as delta from initial balances
      // Pass inputToken and inputAmount for accurate dust calculation
      const { dust0, dust1 } = calculateDustFromDelta(
        typedStep.initialBalance0,
        typedStep.initialBalance1,
        finalBalance0,
        finalBalance1,
        typedStep.inputToken,
        typedStep.inputAmount
      );

      // Calculate dust percentages for summary
      const inputUSD = typedStep.inputAmountUSD ?? 0;
      const dust0USD = Number(formatUnits(dust0, typedStep.token0Decimals));
      const dust1USD = Number(formatUnits(dust1, typedStep.token1Decimals));
      const totalDustUSD = dust0USD + dust1USD;
      const dustPercent = inputUSD > 0 ? ((totalDustUSD / inputUSD) * 100).toFixed(4) : '0';

      // Calculate approval usage
      const approved0 = typedStep.expectedDepositAmount0 + 1n; // We approved amount + 1 wei
      const approved1 = typedStep.expectedDepositAmount1 + 1n;
      const leftoverApproval0 = approved0 > amount0 ? approved0 - amount0 : 0n;
      const leftoverApproval1 = approved1 > amount1 ? approved1 - amount1 : 0n;

      console.log(`[ZapDynamicDeposit] === ZAP EXECUTION COMPLETE ===`);
      console.log(`[ZapDynamicDeposit] Input: ~$${inputUSD.toFixed(2)} USD`);
      console.log(`[ZapDynamicDeposit] --- DEPOSIT ---`);
      console.log(`[ZapDynamicDeposit] Deposited: ${formatUnits(amount0, typedStep.token0Decimals)} ${typedStep.token0Symbol} + ${formatUnits(amount1, typedStep.token1Decimals)} ${typedStep.token1Symbol}`);
      console.log(`[ZapDynamicDeposit] --- APPROVALS ---`);
      console.log(`[ZapDynamicDeposit] Approved: ${formatUnits(approved0, typedStep.token0Decimals)} ${typedStep.token0Symbol} + ${formatUnits(approved1, typedStep.token1Decimals)} ${typedStep.token1Symbol}`);
      console.log(`[ZapDynamicDeposit] Leftover approval: ${formatUnits(leftoverApproval0, typedStep.token0Decimals)} ${typedStep.token0Symbol} + ${formatUnits(leftoverApproval1, typedStep.token1Decimals)} ${typedStep.token1Symbol}`);
      console.log(`[ZapDynamicDeposit] --- DUST ---`);
      console.log(`[ZapDynamicDeposit] Dust: ${formatUnits(dust0, typedStep.token0Decimals)} ${typedStep.token0Symbol} + ${formatUnits(dust1, typedStep.token1Decimals)} ${typedStep.token1Symbol}`);
      console.log(`[ZapDynamicDeposit] Dust %: ${dustPercent}% of input`);
      console.log(`[ZapDynamicDeposit] Status: ${totalDustUSD < 0.01 ? '✓ OPTIMAL' : totalDustUSD < 1 ? '~ ACCEPTABLE' : '⚠ HIGH DUST'}`);
      console.log(`[ZapDynamicDeposit] ==============================`);

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
