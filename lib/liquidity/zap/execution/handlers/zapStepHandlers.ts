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
import { USDS_USDC_POOL_CONFIG, getZapPoolConfigByHook, getZapPoolConfigByTokens } from '../../constants';
import { UNIFIED_YIELD_HOOK_ABI } from '../../../unified-yield/abi/unifiedYieldHookABI';
import { reportZapDust } from '../../utils/reportZapDust';
import { buildPSMSwapCalldata } from '../../routing/psmQuoter';
import type { ZapToken } from '../../types';
import { isNativeToken } from '@/lib/aggregators/types';
import { getKyberswapRouterAddress } from '@/lib/aggregators/kyberswap';

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
 *
 * When hookAddress and totalInputAmount are provided, the handler recalculates
 * the optimal swap amount at execution time using the pool's CURRENT ratio.
 * This compensates for pool ratio drift between preview and execution
 * (e.g., other users' trades during wallet confirmation).
 */
export const handleZapPSMSwapStep: TransactionStepHandler = async (
  step,
  context,
  txFunctions
): Promise<`0x${string}`> => {
  const typedStep = step as unknown as ZapPSMSwapStep;

  // Determine the actual swap amount (recalculate if possible, fallback to preview)
  let actualSwapAmount = typedStep.inputAmount;
  let swapCalldata = typedStep.txRequest.data as Hex;

  if (typedStep.hookAddress && typedStep.totalInputAmount && typedStep.inputToken) {
    try {
      const publicClient = createPublicClient({
        chain: baseMainnet,
        transport: createFallbackTransport(baseMainnet),
      });

      // Query the Hook's CURRENT ratio to calculate fresh optimal swap amount
      const inputToken = typedStep.inputToken;
      const totalInput = typedStep.totalInputAmount;
      const hookAddress = typedStep.hookAddress;

      // Use a reasonable probe amount to get the current ratio
      // (same approach as the analytical formula in calculateOptimalSwapAmount)
      let freshSwapAmount: bigint;

      if (inputToken === 'USDS') {
        // Probe: for totalInput/2 USDS, how much USDC is needed?
        const probeAmount = totalInput / 2n;
        const [requiredUSDC] = await publicClient.readContract({
          address: hookAddress,
          abi: UNIFIED_YIELD_HOOK_ABI,
          functionName: 'previewAddFromAmount0',
          args: [probeAmount],
        }) as [bigint, bigint];
        // Required USDC for probeAmount USDS → need this much from swap
        // Remaining after swap = totalInput - S, needs (totalInput - S) * ratio USDC
        // Swap output = S (PSM 1:1 adjusted for decimals, S USDS → S/10^12 USDC)
        // Balance: S / 10^12 = (totalInput - S) * (requiredUSDC / probeAmount / 10^12)
        // Simplify: S = (totalInput - S) * requiredUSDC / probeAmount
        // S * probeAmount = totalInput * requiredUSDC - S * requiredUSDC
        // S * (probeAmount + requiredUSDC) = totalInput * requiredUSDC
        // But requiredUSDC is in 6 decimals, probeAmount in 18... need to normalize
        const requiredNorm = requiredUSDC * (10n ** 12n); // normalize to 18 dec
        freshSwapAmount = (totalInput * requiredNorm) / (probeAmount + requiredNorm);
      } else {
        // USDC input: probe totalInput/2 USDC, how much USDS is needed?
        const probeAmount = totalInput / 2n;
        const [requiredUSDS] = await publicClient.readContract({
          address: hookAddress,
          abi: UNIFIED_YIELD_HOOK_ABI,
          functionName: 'previewAddFromAmount1',
          args: [probeAmount],
        }) as [bigint, bigint];
        // Required USDS for probeAmount USDC
        // Swap: S USDC → S * 10^12 USDS (PSM 1:1)
        // Balance: S * 10^12 = (totalInput - S) * (requiredUSDS / probeAmount * 10^12)
        // Simplify: S = (totalInput - S) * requiredUSDS / probeAmount
        // S * probeAmount = totalInput * requiredUSDS - S * requiredUSDS
        // S * (probeAmount + requiredUSDS) = totalInput * requiredUSDS
        // But requiredUSDS is in 18 decimals, probeAmount in 6... normalize
        const requiredNorm = requiredUSDS / (10n ** 12n); // normalize to 6 dec
        freshSwapAmount = (totalInput * requiredNorm) / (probeAmount + requiredNorm);
      }

      // Apply minimal reduction (1 bps) for rounding
      freshSwapAmount = freshSwapAmount - (freshSwapAmount / 10000n);

      // Cap to approved amount
      const maxAllowed = typedStep.approvedSwapAmount ?? typedStep.inputAmount;
      if (freshSwapAmount > maxAllowed) {
        freshSwapAmount = maxAllowed;
      }

      // Floor at 0
      if (freshSwapAmount < 0n) freshSwapAmount = 0n;

      const delta = freshSwapAmount > actualSwapAmount
        ? freshSwapAmount - actualSwapAmount
        : actualSwapAmount - freshSwapAmount;
      const deltaPercent = Number(delta * 10000n / actualSwapAmount) / 100;

      console.log(`[ZapPSMSwap] Just-in-time recalculation:`, {
        originalSwap: actualSwapAmount.toString(),
        freshSwap: freshSwapAmount.toString(),
        delta: `${deltaPercent.toFixed(2)}%`,
        direction: freshSwapAmount > actualSwapAmount ? 'UP' : 'DOWN',
      });

      // Use the fresh amount and rebuild calldata
      actualSwapAmount = freshSwapAmount;
      swapCalldata = buildPSMSwapCalldata(
        inputToken,
        freshSwapAmount,
        // PSM output is 1:1 with decimal adjustment, apply 0.1% slippage
        inputToken === 'USDS'
          ? (freshSwapAmount / (10n ** 12n)) * 999n / 1000n
          : (freshSwapAmount * (10n ** 12n)) * 999n / 1000n,
        context.address
      );
    } catch (recalcError) {
      // If recalculation fails, proceed with original amount
      console.warn('[ZapPSMSwap] Just-in-time recalculation failed, using original:', recalcError);
    }
  }

  // Signal step is starting
  context.setCurrentStep({ step, accepted: false });

  // Send PSM swap transaction (with potentially recalculated calldata)
  const hash = await txFunctions.sendTransaction({
    to: typedStep.txRequest.to as `0x${string}`,
    data: swapCalldata,
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
  const chainId = context.chainId || 8453; // Default to Base mainnet

  // Resolve pool config from token addresses to get correct decimals
  const poolConfig = getZapPoolConfigByTokens(
    typedStep.inputTokenAddress as Address,
    typedStep.outputTokenAddress as Address
  );
  const inputIsToken0 = poolConfig
    ? typedStep.inputToken === poolConfig.token0.symbol
    : typedStep.inputToken !== 'USDC'; // USDC is always token1
  const inputDecimals = poolConfig
    ? (inputIsToken0 ? poolConfig.token0.decimals : poolConfig.token1.decimals)
    : (typedStep.inputToken === 'USDC' ? 6 : 18);
  const outputDecimals = poolConfig
    ? (inputIsToken0 ? poolConfig.token1.decimals : poolConfig.token0.decimals)
    : (typedStep.outputToken === 'USDC' ? 6 : 18);

  // Detect swap source from step data
  const swapSource = typedStep.swapSource ?? 'pool';
  const isInputNative = isNativeToken(typedStep.inputTokenAddress);

  // Get user's approval mode setting (exact or infinite)
  const userSettings = getStoredUserSettings();

  // Step 1: Call prepare-permit to check if we need a Permit2 signature
  // (skipped for native tokens and Kyberswap - they don't use Permit2)
  let permitSignature = '0x';
  let permitData = {
    permitTokenAddress: typedStep.inputTokenAddress,
    permitAmount: '0',
    permitNonce: 0,
    permitExpiration: 0,
    permitSigDeadline: '0',
  };

  if (!isInputNative && swapSource !== 'kyberswap') {
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
        approvalMode: userSettings.approvalMode,
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

    if (permitResult.needsPermit) {
      if (!context.signTypedData) {
        throw new Error('signTypedData not available in context - cannot sign Permit2 permit');
      }

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

      permitData = {
        permitTokenAddress: permitResult.permitData.message.details.token,
        permitAmount: permitResult.permitData.message.details.amount,
        permitNonce: permitResult.permitData.message.details.nonce,
        permitExpiration: permitResult.permitData.message.details.expiration,
        permitSigDeadline: permitResult.permitData.message.sigDeadline,
      };
    }
  }

  // Step 2: Build swap transaction using existing API
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
      // Pass source and router address for Kyberswap routing
      ...(swapSource === 'kyberswap' ? {
        source: 'kyberswap',
        kyberswapData: { routerAddress: getKyberswapRouterAddress() },
      } : {}),
    }),
  });

  if (!buildTxResponse.ok) {
    const errorData = await buildTxResponse.json().catch(() => ({}));
    throw new Error(`Failed to build ${swapSource} swap tx: ${errorData.message || buildTxResponse.statusText}`);
  }

  const txData = await buildTxResponse.json();
  if (!txData.ok) {
    throw new Error(`${swapSource} swap build failed: ${txData.message}`);
  }

  // Signal step is starting (user will confirm tx)
  context.setCurrentStep({ step, accepted: false });

  let hash: `0x${string}`;

  // Step 3: Send the swap transaction
  // Kyberswap returns direct tx data (no commands/inputs), pool uses Universal Router
  if (txData.commands === null || txData.commands === undefined) {
    // Direct tx (Kyberswap or native ETH swap) - send as-is
    hash = await txFunctions.sendTransaction({
      to: txData.to as `0x${string}`,
      data: txData.data as Hex,
      value: BigInt(txData.value || '0'),
    });
  } else {
    // Universal Router - encode execute call
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

    hash = await txFunctions.sendTransaction({
      to: txData.to as `0x${string}`,
      data: executeCalldata,
      value: BigInt(txData.value || '0'),
    });
  }

  // Signal transaction was accepted
  context.setCurrentStep({ step, accepted: true });

  // Wait for confirmation
  const receipt = await txFunctions.waitForReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error(`${swapSource} swap failed: ${hash}`);
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
    chain: baseMainnet,
    transport: createFallbackTransport(baseMainnet),
  });

  // Detect if token0 is native ETH
  const token0IsNative = typedStep.isToken0Native ?? isNativeToken(typedStep.token0Address);
  const token1IsNative = isNativeToken(typedStep.token1Address);

  // Query actual token balances (native ETH uses getBalance, ERC20 uses balanceOf)
  const [balance0, balance1] = await Promise.all([
    token0IsNative
      ? publicClient.getBalance({ address: context.address })
      : publicClient.readContract({
          address: typedStep.token0Address,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [context.address],
        }) as Promise<bigint>,
    token1IsNative
      ? publicClient.getBalance({ address: context.address })
      : publicClient.readContract({
          address: typedStep.token1Address,
          abi: ERC20_BALANCE_ABI,
          functionName: 'balanceOf',
          args: [context.address],
        }) as Promise<bigint>,
  ]);

  // Calculate amounts available for deposit from this zap only
  // Uses balance-delta approach: compares current balance to initial balance
  // to isolate what came from the zap (remaining input + swap output),
  // excluding any pre-existing balance the user had before.
  const bal0 = BigInt(balance0);
  const bal1 = BigInt(balance1);
  const exp0 = BigInt(typedStep.expectedDepositAmount0);
  const exp1 = BigInt(typedStep.expectedDepositAmount1);

  let cappedBalance0: bigint;
  let cappedBalance1: bigint;

  if (
    typedStep.initialBalance0 !== undefined &&
    typedStep.initialBalance1 !== undefined &&
    typedStep.inputAmount !== undefined &&
    typedStep.inputToken
  ) {
    const init0 = BigInt(typedStep.initialBalance0);
    const init1 = BigInt(typedStep.initialBalance1);
    const inputAmt = BigInt(typedStep.inputAmount);

    // Determine if input is token0 or token1
    const poolCfg = getZapPoolConfigByHook(typedStep.hookAddress);
    const isInputToken0 = poolCfg
      ? typedStep.inputToken === poolCfg.token0.symbol
      : typedStep.inputToken === 'USDS';

    if (isInputToken0) {
      // Input is token0: after swap, bal0 < init0 (spent on swap).
      // Remaining = inputAmt - (init0 - bal0). Add inputAmt first to avoid BigInt underflow.
      const adjusted0 = bal0 + inputAmt;
      cappedBalance0 = adjusted0 >= init0 ? adjusted0 - init0 : exp0;
      // Token1 is output: swapOutput = balance - initialBalance
      // For native output tokens, gas costs make balance delta unreliable — use expected amount
      cappedBalance1 = token1IsNative ? exp1 : (bal1 > init1 ? bal1 - init1 : 0n);
    } else {
      // Token0 is output: swapOutput = balance - initialBalance
      // For native output tokens, gas costs make balance delta unreliable — use expected amount
      cappedBalance0 = token0IsNative ? exp0 : (bal0 > init0 ? bal0 - init0 : 0n);
      // Input is token1: after swap, bal1 < init1 (spent on swap).
      const adjusted1 = bal1 + inputAmt;
      cappedBalance1 = adjusted1 >= init1 ? adjusted1 - init1 : exp1;
    }

    // Safety floor
    if (cappedBalance0 < 0n) cappedBalance0 = 0n;
    if (cappedBalance1 < 0n) cappedBalance1 = 0n;

    // Cap to approval ceiling (expected + 3% buffer) to avoid exceeding allowance
    const maxApproval0 = exp0 + exp0 / 33n;
    const maxApproval1 = exp1 + exp1 / 33n;
    if (cappedBalance0 > maxApproval0) cappedBalance0 = maxApproval0;
    if (cappedBalance1 > maxApproval1) cappedBalance1 = maxApproval1;
  } else {
    // Fallback: cap to expected amounts (legacy behavior)
    cappedBalance0 = bal0 < exp0 ? bal0 : exp0;
    cappedBalance1 = bal1 < exp1 ? bal1 : exp1;
  }

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
  // Normalize dust for comparison using token decimals
  const decimalDiff = typedStep.token0Decimals - typedStep.token1Decimals;
  const dustANormalized = decimalDiff > 0
    ? dustAToken1 * (10n ** BigInt(decimalDiff))
    : dustAToken1 / (10n ** BigInt(-decimalDiff));

  // Option B: Use all of token1, need requiredToken0ForToken1 of token0
  const canDoOptionB = requiredToken0ForToken1 <= cappedBalance0;
  const dustBToken0 = canDoOptionB ? cappedBalance0 - requiredToken0ForToken1 : 0n;
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

  if (shares <= 0n) {
    throw new Error('Zap deposit failed: calculated shares is zero (amount too small or balance unavailable)');
  }

  // Apply shares haircut (0.0001%) to account for yield accrual.
  // For tiny shares (< 1M), skip haircut — yield accrual is negligible
  // and subtracting 1 from small shares causes underflow or zero-mint reverts.
  const sharesReduction = shares / 1000000n;
  const adjustedShares = sharesReduction > 0n ? shares - sharesReduction : shares;

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

  // Send deposit transaction (with msg.value for native ETH)
  const depositValue = token0IsNative ? amount0 : (token1IsNative ? amount1 : 0n);
  const hash = await txFunctions.sendTransaction({
    to: typedStep.hookAddress,
    data: depositCalldata,
    value: depositValue,
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
  // Use pre-tx known values (available - deposited) instead of post-tx balance
  // deltas. Balance deltas are unreliable for native tokens because gas costs
  // make the final balance lower than initial, hiding actual dust.
  const dust0 = cappedBalance0 > amount0 ? cappedBalance0 - amount0 : 0n;
  const dust1 = cappedBalance1 > amount1 ? cappedBalance1 - amount1 : 0n;

  const inputUSD = typedStep.inputAmountUSD ?? 0;
  const p0 = typedStep.token0Price ?? 1;
  const p1 = typedStep.token1Price ?? 1;
  const dust0USD = Number(formatUnits(dust0, typedStep.token0Decimals)) * p0;
  const dust1USD = Number(formatUnits(dust1, typedStep.token1Decimals)) * p1;
  const totalDustUSD = dust0USD + dust1USD;
  const dustPercent = inputUSD > 0 ? ((totalDustUSD / inputUSD) * 100).toFixed(4) : '0';

  console.log(`[ZapDynamicDeposit] === ZAP EXECUTION COMPLETE ===`);
  console.log(`[ZapDynamicDeposit] Deposited: ${formatUnits(amount0, typedStep.token0Decimals)} ${typedStep.token0Symbol} + ${formatUnits(amount1, typedStep.token1Decimals)} ${typedStep.token1Symbol}`);
  console.log(`[ZapDynamicDeposit] Dust: ${formatUnits(dust0, typedStep.token0Decimals)} ${typedStep.token0Symbol} + ${formatUnits(dust1, typedStep.token1Decimals)} ${typedStep.token1Symbol}`);
  console.log(`[ZapDynamicDeposit] Dust %: ${dustPercent}% of input`);
  console.log(`[ZapDynamicDeposit] ==============================`);

  reportZapDust({
    token0Dust: dust0,
    token1Dust: dust1,
    token0Symbol: typedStep.token0Symbol,
    token1Symbol: typedStep.token1Symbol,
    token0Decimals: typedStep.token0Decimals,
    token1Decimals: typedStep.token1Decimals,
    inputAmountUSD: typedStep.inputAmountUSD ?? 0,
    inputToken: typedStep.inputToken,
    token0Price: typedStep.token0Price,
    token1Price: typedStep.token1Price,
  });

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
