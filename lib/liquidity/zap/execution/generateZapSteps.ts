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
import { PSM_CONFIG, PERMIT2_ADDRESS, USDS_USDC_POOL_CONFIG } from '../constants';
import { buildPSMSwapCalldata } from '../routing/psmQuoter';
import { calculateMinOutput } from '../calculation';
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
  } = params;

  const steps: TransactionStep[] = [];
  let swapStepCount = 0;
  let depositStepCount = 0;

  // =========================================================================
  // STEP 1: Approve input token for swap (if needed)
  // =========================================================================

  if (!approvals.inputTokenApprovedForSwap && calculation.swapAmount > 0n) {
    const swapApprovalStep = createSwapApprovalStep(
      inputToken,
      calculation.swapAmount,
      calculation.route.type === 'psm',
      approvalMode
    );
    steps.push(swapApprovalStep);
    swapStepCount++;
  }

  // =========================================================================
  // STEP 2: Execute swap (if swap amount > 0)
  // =========================================================================

  if (calculation.swapAmount > 0n) {
    if (calculation.route.type === 'psm') {
      const psmSwapStep = createPSMSwapStep(
        inputToken,
        calculation.swapAmount,
        calculation.swapOutputAmount,
        userAddress
      );
      steps.push(psmSwapStep);
    } else {
      const poolSwapStep = createPoolSwapStep(
        inputToken,
        calculation.swapAmount,
        calculation.swapOutputAmount,
        slippageTolerance,
        userAddress
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
  const needsToken0Approval = token0Amount > 0n && currentToken0Allowance < token0Amount;
  const needsToken1Approval = token1Amount > 0n && currentToken1Allowance < token1Amount;

  if (needsToken0Approval) {
    const token0ApprovalStep = createHookApprovalStep(
      getAddress(USDS_USDC_POOL_CONFIG.token0.address),
      token0Symbol,
      hookAddress,
      token0Amount, // Use actual deposit amount
      approvalMode
    );
    steps.push(token0ApprovalStep);
    depositStepCount++;
  }

  if (needsToken1Approval) {
    const token1ApprovalStep = createHookApprovalStep(
      getAddress(USDS_USDC_POOL_CONFIG.token1.address),
      token1Symbol,
      hookAddress,
      token1Amount, // Use actual deposit amount
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
    token0Amount, // Expected deposit amount for token0
    token1Amount, // Expected deposit amount for token1
    initialBalance0,
    initialBalance1,
    inputAmountUSD,
    totalInputAmount // Total input amount for accurate dust calculation
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
  console.log(`[generateZapSteps] Swap: ${calculation.swapAmount.toString()} ${inputToken} → ${calculation.swapOutputAmount.toString()} ${inputToken === 'USDC' ? 'USDS' : 'USDC'}`);
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
  usePSM: boolean,
  approvalMode: 'exact' | 'infinite' = 'exact'
): ZapSwapApprovalStep {
  const tokenAddress = inputToken === 'USDS'
    ? getAddress(USDS_USDC_POOL_CONFIG.token0.address)
    : getAddress(USDS_USDC_POOL_CONFIG.token1.address);

  // Spender is PSM for PSM swaps, Permit2 for pool swaps
  const spender = usePSM ? getAddress(PSM_CONFIG.address) : PERMIT2_ADDRESS;

  // Use exact amount or infinite based on user preference
  // For exact mode, add minimal buffer (+1 wei) - sufficient for ERC20 approvals
  const approvalAmount = approvalMode === 'infinite'
    ? maxUint256
    : amount + 1n;

  // Build approval calldata
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
  recipient: Address
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
  };
}

/**
 * Create pool swap step.
 *
 * Note: This creates a placeholder - actual calldata would be built
 * by the swap API with proper routing.
 */
function createPoolSwapStep(
  inputToken: ZapToken,
  inputAmount: bigint,
  expectedOutputAmount: bigint,
  slippageTolerance: number,
  recipient: Address
): ZapPoolSwapStep {
  const outputToken: ZapToken = inputToken === 'USDS' ? 'USDC' : 'USDS';
  const minOutputAmount = calculateMinOutput(expectedOutputAmount, slippageTolerance);

  // Deadline 20 minutes from now
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

  // Placeholder - actual calldata built at execution time via API
  return {
    type: TransactionStepType.ZapPoolSwap,
    inputToken,
    inputTokenAddress: inputToken === 'USDS'
      ? getAddress(USDS_USDC_POOL_CONFIG.token0.address)
      : getAddress(USDS_USDC_POOL_CONFIG.token1.address),
    outputToken,
    outputTokenAddress: outputToken === 'USDS'
      ? getAddress(USDS_USDC_POOL_CONFIG.token0.address)
      : getAddress(USDS_USDC_POOL_CONFIG.token1.address),
    inputAmount,
    minOutputAmount,
    deadline,
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
  // For exact mode, add minimal buffer (+1 wei) - sufficient for ERC20 approvals
  const approvalAmount = approvalMode === 'infinite'
    ? maxUint256
    : amount + 1n;

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
  inputToken: 'USDS' | 'USDC',
  expectedDepositAmount0: bigint,
  expectedDepositAmount1: bigint,
  initialBalance0?: bigint,
  initialBalance1?: bigint,
  inputAmountUSD?: number,
  inputAmount?: bigint
): ZapDynamicDepositStep {
  return {
    type: TransactionStepType.ZapDynamicDeposit,
    hookAddress,
    poolId,
    token0Address,
    token1Address,
    token0Symbol,
    token1Symbol,
    token0Decimals: USDS_USDC_POOL_CONFIG.token0.decimals,
    token1Decimals: USDS_USDC_POOL_CONFIG.token1.decimals,
    fallbackSharesEstimate,
    inputToken,
    expectedDepositAmount0,
    expectedDepositAmount1,
    initialBalance0,
    initialBalance1,
    inputAmountUSD,
    inputAmount,
  };
}

