/**
 * Zap Step Generation
 *
 * Generates the ordered transaction steps for a zap deposit operation.
 * Steps are:
 * 1. Approve input token for swap (to PSM or Permit2)
 * 2. Execute swap (PSM or Pool)
 * 3. Approve tokens to Hook (if needed)
 * 4. Deposit to Hook
 */

import { type Address, encodeFunctionData, getAddress, maxUint256 } from 'viem';
import type { ZapCalculationResult, ZapApprovalStatus, ZapToken } from '../types';
import { PSM_CONFIG, PERMIT2_ADDRESS, USDS_USDC_POOL_CONFIG, type ZapPoolConfig } from '../constants';
import { buildPSMSwapCalldata } from '../routing/psmQuoter';
import { calculateMinOutput } from '../calculation';
import { getKyberswapRouterAddress } from '@/lib/aggregators/kyberswap';
import { isNativeToken } from '@/lib/aggregators/types';
import { modeForChainId } from '@/lib/network-mode';
import type {
  TransactionStep,
  UnifiedYieldApprovalStep,
  ZapSwapApprovalStep,
  ZapPSMSwapStep,
  ZapPoolSwapStep,
  ZapDynamicDepositStep,
} from '../../types';
import { TransactionStepType } from '../../types';

// =============================================================================
// TYPES
// =============================================================================

export interface GenerateZapStepsParams {
  /** Zap calculation result */
  calculation: ZapCalculationResult;
  /** Current approval status */
  approvals: ZapApprovalStatus;
  /** Hook contract address */
  hookAddress: Address;
  /** User's wallet address */
  userAddress: Address;
  /** Shares to mint from deposit preview */
  sharesToMint: bigint;
  /** Slippage tolerance (percentage) */
  slippageTolerance: number;
  /** Token symbols for display */
  token0Symbol: string;
  token1Symbol: string;
  /** Pool ID */
  poolId: string;
  /** Input token explicitly provided (avoids guessing from amounts) */
  inputToken: ZapToken;
  /** Token addresses for deposit */
  token0Address: Address;
  token1Address: Address;
  /** Estimated token amounts after swap (for deposit) */
  token0Amount: bigint;
  token1Amount: bigint;
  /** Approval mode: 'exact' for exact amounts, 'infinite' for max approval */
  approvalMode?: 'exact' | 'infinite';
  /** Initial token0 balance before Zap (for dust calculation) */
  initialBalance0?: bigint;
  /** Initial token1 balance before Zap (for dust calculation) */
  initialBalance1?: bigint;
  /** Total input amount in USD (for dust percentage calculation) */
  inputAmountUSD?: number;
  /** Pool configuration (for dynamic token handling) */
  poolConfig?: ZapPoolConfig;
  /** Token0 price in USD (for non-stablecoin dust calculation) */
  token0Price?: number;
  /** Token1 price in USD (for non-stablecoin dust calculation) */
  token1Price?: number;
  /** Target chain ID for the pool (used by swap steps) */
  targetChainId?: number;
}

export interface GenerateZapStepsResult {
  /** Ordered steps to execute */
  steps: TransactionStep[];
  /** Number of swap-related steps */
  swapStepCount: number;
  /** Number of deposit-related steps */
  depositStepCount: number;
  /** Total number of steps */
  totalStepCount: number;
}

// =============================================================================
// ERC20 ABI (minimal for approvals)
// =============================================================================

const ERC20_APPROVE_ABI = [
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
] as const;

// =============================================================================
// STEP GENERATION
// =============================================================================

/**
 * Generate ordered transaction steps for zap deposit.
 *
 * @param params - Generation parameters
 * @returns Ordered steps and metadata
 */
export function generateZapSteps(params: GenerateZapStepsParams): GenerateZapStepsResult {
  const {
    calculation,
    approvals,
    hookAddress,
    userAddress,
    sharesToMint,
    slippageTolerance,
    token0Symbol,
    token1Symbol,
    poolId,
    inputToken,
    token0Address,
    token1Address,
    token0Amount,
    token1Amount,
    approvalMode = 'exact', // Default to exact for safety
    initialBalance0,
    initialBalance1,
    inputAmountUSD,
    poolConfig,
    token0Price,
    token1Price,
    targetChainId,
  } = params;

  const config = poolConfig ?? USDS_USDC_POOL_CONFIG;
  const isInputToken0 = inputToken === config.token0.symbol;
  const inputTokenAddress = isInputToken0 ? config.token0.address : config.token1.address;
  const isInputNative = isNativeToken(inputTokenAddress);

  const steps: TransactionStep[] = [];
  let swapStepCount = 0;
  let depositStepCount = 0;

  // =========================================================================
  // STEP 1: Approve input token for swap (if needed)
  // Skip for native tokens (ETH) - no ERC20 approval needed
  // =========================================================================

  if (!isInputNative && !approvals.inputTokenApprovedForSwap && calculation.swapAmount > 0n) {
    const swapApprovalStep = createSwapApprovalStep(
      inputToken,
      calculation.swapAmount,
      calculation.route.type,
      approvalMode,
      poolConfig,
      targetChainId
    );
    steps.push(swapApprovalStep);
    swapStepCount++;
  }

  // =========================================================================
  // STEP 2: Execute swap (if swap amount > 0)
  // =========================================================================

  if (calculation.swapAmount > 0n) {
    if (calculation.route.type === 'psm') {
      // Calculate the approved swap amount (matches approval step logic)
      const psmApprovalBuffer = calculation.swapAmount / 10n;
      const approvedPsmAmount = approvalMode === 'infinite'
        ? calculation.swapAmount * 2n // effectively unlimited
        : calculation.swapAmount + (psmApprovalBuffer > 1n ? psmApprovalBuffer : 1n);

      const psmSwapStep = createPSMSwapStep(
        inputToken,
        calculation.swapAmount,
        calculation.swapOutputAmount,
        userAddress,
        hookAddress,
        calculation.swapAmount + calculation.remainingInputAmount,
        approvedPsmAmount
      );
      steps.push(psmSwapStep);
    } else {
      // Pool swap or Kyberswap - same step type with swapSource field
      const swapSource = calculation.route.type === 'kyberswap' ? 'kyberswap' : 'pool';
      const poolSwapStep = createPoolSwapStep(
        inputToken,
        calculation.swapAmount,
        calculation.swapOutputAmount,
        slippageTolerance,
        userAddress,
        swapSource,
        poolConfig,
        targetChainId
      );
      steps.push(poolSwapStep);
    }
    swapStepCount++;
  }

  // =========================================================================
  // STEP 3: Approve tokens to Hook (if needed)
  // IMPORTANT: Compare current allowance against ACTUAL deposit amounts,
  // not the pre-computed booleans which used estimated amounts.
  // The booleans (token0ApprovedForHook) were computed at preview time
  // against estimated amounts, but actual amounts may differ.
  // =========================================================================

  // Get current allowances (raw values, not pre-computed booleans)
  const currentToken0Allowance = approvals.allowances?.token0ForHook ?? 0n;
  const currentToken1Allowance = approvals.allowances?.token1ForHook ?? 0n;

  // Need approval if current allowance < actual amount we're depositing
  // Skip for native tokens (ETH uses msg.value, not ERC20 approve)
  const isToken0Native = isNativeToken(config.token0.address);
  const isToken1Native = isNativeToken(config.token1.address);
  const needsToken0Approval = !isToken0Native && token0Amount > 0n && currentToken0Allowance < token0Amount;
  const needsToken1Approval = !isToken1Native && token1Amount > 0n && currentToken1Allowance < token1Amount;

  if (needsToken0Approval) {
    const token0ApprovalStep = createHookApprovalStep(
      getAddress(config.token0.address),
      token0Symbol,
      hookAddress,
      token0Amount,
      approvalMode
    );
    steps.push(token0ApprovalStep);
    depositStepCount++;
  }

  if (needsToken1Approval) {
    const token1ApprovalStep = createHookApprovalStep(
      getAddress(config.token1.address),
      token1Symbol,
      hookAddress,
      token1Amount,
      approvalMode
    );
    steps.push(token1ApprovalStep);
    depositStepCount++;
  }

  // =========================================================================
  // STEP 4: Deposit to Hook (Dynamic - rebuilds at execution time)
  // =========================================================================

  // Calculate total input amount (swapAmount + remainingInputAmount)
  const totalInputAmount = calculation.swapAmount + calculation.remainingInputAmount;

  // Use dynamic deposit step that queries actual balances at execution time
  // This fixes the "insufficient balance" error when swap output differs from preview
  // Pass expected deposit amounts to cap the actual deposit (prevents over-spending allowance)
  const depositStep = createZapDynamicDepositStep(
    hookAddress,
    poolId,
    token0Symbol,
    token1Symbol,
    token0Address,
    token1Address,
    sharesToMint,
    inputToken,
    token0Amount,
    token1Amount,
    initialBalance0,
    initialBalance1,
    inputAmountUSD,
    totalInputAmount,
    isToken0Native,
    token0Price,
    token1Price,
    poolConfig
  );
  steps.push(depositStep);
  depositStepCount++;

  // Calculate approval amounts for logging
  const swapApprovalAmount = approvalMode === 'infinite' ? 'INFINITE' : `${calculation.swapAmount + 1n}`;
  const token0ApprovalAmount = approvalMode === 'infinite' ? 'INFINITE' : `${token0Amount + 1n}`;
  const token1ApprovalAmount = approvalMode === 'infinite' ? 'INFINITE' : `${token1Amount + 1n}`;

  // Comprehensive summary log for flow verification
  console.log(`[generateZapSteps] === ZAP FLOW SUMMARY ===`);
  console.log(`[generateZapSteps] Input: ${totalInputAmount.toString()} ${inputToken} (~$${inputAmountUSD?.toFixed(2) ?? '?'} USD)`);
  console.log(`[generateZapSteps] Route: ${calculation.route.type.toUpperCase()}`);
  const outputToken = isInputToken0 ? config.token1.symbol : config.token0.symbol;
  console.log(`[generateZapSteps] Swap: ${calculation.swapAmount.toString()} ${inputToken} → ${calculation.swapOutputAmount.toString()} ${outputToken}`);
  console.log(`[generateZapSteps] Keep: ${calculation.remainingInputAmount.toString()} ${inputToken} (for deposit)`);
  console.log(`[generateZapSteps] Deposit amounts: token0=${token0Amount.toString()}, token1=${token1Amount.toString()}`);
  console.log(`[generateZapSteps] Expected shares: ${sharesToMint.toString()}`);
  console.log(`[generateZapSteps] --- APPROVALS ---`);
  console.log(`[generateZapSteps] Swap approval needed: ${!approvals.inputTokenApprovedForSwap} ${!approvals.inputTokenApprovedForSwap ? `(amount: ${swapApprovalAmount})` : ''}`);
  console.log(`[generateZapSteps] Hook token0 approval needed: ${needsToken0Approval} ${needsToken0Approval ? `(amount: ${token0ApprovalAmount}, current: ${currentToken0Allowance.toString()})` : `(current: ${currentToken0Allowance.toString()})`}`);
  console.log(`[generateZapSteps] Hook token1 approval needed: ${needsToken1Approval} ${needsToken1Approval ? `(amount: ${token1ApprovalAmount}, current: ${currentToken1Allowance.toString()})` : `(current: ${currentToken1Allowance.toString()})`}`);
  console.log(`[generateZapSteps] Steps: ${steps.length} total (${swapStepCount} swap-related, ${depositStepCount} deposit-related)`);
  console.log(`[generateZapSteps] ========================`);

  return {
    steps,
    swapStepCount,
    depositStepCount,
    totalStepCount: steps.length,
  };
}

// =============================================================================
// STEP CREATORS
// =============================================================================

/**
 * Create swap approval step.
 */
function createSwapApprovalStep(
  inputToken: ZapToken,
  amount: bigint,
  routeType: string,
  approvalMode: 'exact' | 'infinite' = 'exact',
  poolConfig?: ZapPoolConfig,
  targetChainId?: number
): ZapSwapApprovalStep {
  const config = poolConfig ?? USDS_USDC_POOL_CONFIG;
  const isInputToken0 = inputToken === config.token0.symbol;
  const tokenAddress = getAddress(isInputToken0 ? config.token0.address : config.token1.address);

  // Spender based on route type
  let spender: Address;
  if (routeType === 'psm') {
    spender = getAddress(PSM_CONFIG.address);
  } else if (routeType === 'kyberswap') {
    const networkMode = targetChainId ? modeForChainId(targetChainId) : undefined;
    spender = getAddress(getKyberswapRouterAddress(networkMode ?? undefined));
  } else {
    spender = PERMIT2_ADDRESS;
  }

  const usePSM = routeType === 'psm';
  const psmBuffer = amount / 10n;
  const approvalAmount = approvalMode === 'infinite'
    ? maxUint256
    : usePSM
      ? amount + (psmBuffer > 1n ? psmBuffer : 1n)
      : amount + 1n;

  const calldata = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: 'approve',
    args: [spender, approvalAmount],
  });

  return {
    type: TransactionStepType.ZapSwapApproval,
    tokenAddress,
    tokenSymbol: inputToken,
    spender,
    amount,
    txRequest: {
      to: tokenAddress,
      data: calldata,
      value: 0n,
    },
  };
}

/**
 * Create PSM swap step.
 */
function createPSMSwapStep(
  inputToken: ZapToken,
  inputAmount: bigint,
  expectedOutputAmount: bigint,
  recipient: Address,
  hookAddress?: Address,
  totalInputAmount?: bigint,
  approvedSwapAmount?: bigint
): ZapPSMSwapStep {
  const direction = inputToken === 'USDS' ? 'USDS_TO_USDC' : 'USDC_TO_USDS';
  // For PSM3, apply minimal slippage (0.1%) since it's 1:1
  const minOutputAmount = (expectedOutputAmount * 999n) / 1000n;
  const calldata = buildPSMSwapCalldata(inputToken, inputAmount, minOutputAmount, recipient);

  return {
    type: TransactionStepType.ZapPSMSwap,
    direction,
    inputAmount,
    expectedOutputAmount,
    inputTokenAddress: inputToken === 'USDS'
      ? getAddress(USDS_USDC_POOL_CONFIG.token0.address)
      : getAddress(USDS_USDC_POOL_CONFIG.token1.address),
    outputTokenAddress: inputToken === 'USDS'
      ? getAddress(USDS_USDC_POOL_CONFIG.token1.address)
      : getAddress(USDS_USDC_POOL_CONFIG.token0.address),
    txRequest: {
      to: getAddress(PSM_CONFIG.address),
      data: calldata,
      value: 0n,
    },
    // Data for just-in-time recalculation at execution time
    hookAddress,
    totalInputAmount,
    inputToken,
    approvedSwapAmount,
  };
}

/**
 * Create pool swap step (also used for Kyberswap route).
 *
 * Note: This creates a placeholder - actual calldata is built
 * at execution time via the swap API.
 */
function createPoolSwapStep(
  inputToken: ZapToken,
  inputAmount: bigint,
  expectedOutputAmount: bigint,
  slippageTolerance: number,
  recipient: Address,
  swapSource: 'pool' | 'kyberswap' = 'pool',
  poolConfig?: ZapPoolConfig,
  targetChainId?: number
): ZapPoolSwapStep {
  const config = poolConfig ?? USDS_USDC_POOL_CONFIG;
  const isInputToken0 = inputToken === config.token0.symbol;
  const outputToken: ZapToken = isInputToken0 ? config.token1.symbol : config.token0.symbol;
  const minOutputAmount = calculateMinOutput(expectedOutputAmount, slippageTolerance);

  // Deadline 20 minutes from now
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

  return {
    type: TransactionStepType.ZapPoolSwap,
    inputToken,
    inputTokenAddress: getAddress(isInputToken0 ? config.token0.address : config.token1.address),
    outputToken,
    outputTokenAddress: getAddress(isInputToken0 ? config.token1.address : config.token0.address),
    inputAmount,
    minOutputAmount,
    deadline,
    swapSource,
    targetChainId,
    txRequest: {
      to: '0x0000000000000000000000000000000000000000' as Address, // Placeholder
      data: '0x' as `0x${string}`, // Placeholder
      value: 0n,
    },
  };
}

/**
 * Create Hook approval step (reuses existing Unified Yield pattern).
 */
function createHookApprovalStep(
  tokenAddress: Address,
  tokenSymbol: string,
  hookAddress: Address,
  amount: bigint,
  approvalMode: 'exact' | 'infinite' = 'exact'
): UnifiedYieldApprovalStep {
  // Use exact amount or infinite based on user preference
  // For exact mode, add ~3% buffer to accommodate post-swap balance variations
  // (the dynamic deposit handler may deposit slightly more than expected
  // if the swap was favorable, up to this buffer ceiling)
  const buffer = amount / 33n; // ~3%
  const approvalAmount = approvalMode === 'infinite'
    ? maxUint256
    : amount + (buffer > 1n ? buffer : 1n);

  const calldata = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: 'approve',
    args: [hookAddress, approvalAmount],
  });

  return {
    type: TransactionStepType.UnifiedYieldApprovalTransaction,
    tokenAddress,
    tokenSymbol,
    hookAddress,
    amount,
    txRequest: {
      to: tokenAddress,
      data: calldata,
      value: 0n,
    },
  };
}

/**
 * Create Zap Dynamic Deposit step.
 *
 * Unlike the old pre-built deposit step, this carries metadata that allows
 * the handler to query actual token balances at execution time and rebuild
 * the deposit transaction with correct shares.
 *
 * This fixes the "insufficient balance" error when swap output differs from preview.
 */
function createZapDynamicDepositStep(
  hookAddress: Address,
  poolId: string,
  token0Symbol: string,
  token1Symbol: string,
  token0Address: Address,
  token1Address: Address,
  fallbackSharesEstimate: bigint,
  inputToken: ZapToken,
  expectedDepositAmount0: bigint,
  expectedDepositAmount1: bigint,
  initialBalance0?: bigint,
  initialBalance1?: bigint,
  inputAmountUSD?: number,
  inputAmount?: bigint,
  isToken0Native?: boolean,
  token0Price?: number,
  token1Price?: number,
  poolConfig?: ZapPoolConfig
): ZapDynamicDepositStep {
  const config = poolConfig ?? USDS_USDC_POOL_CONFIG;

  return {
    type: TransactionStepType.ZapDynamicDeposit,
    hookAddress,
    poolId,
    token0Address,
    token1Address,
    token0Symbol,
    token1Symbol,
    token0Decimals: config.token0.decimals,
    token1Decimals: config.token1.decimals,
    fallbackSharesEstimate,
    inputToken,
    isToken0Native,
    token0Price,
    token1Price,
    expectedDepositAmount0,
    expectedDepositAmount1,
    initialBalance0,
    initialBalance1,
    inputAmountUSD,
    inputAmount,
  };
}

