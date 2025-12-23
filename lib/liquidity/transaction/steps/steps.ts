/**
 * Step Factory Functions & Flow Ordering
 *
 * Mirrors Uniswap's step creation and flow ordering from:
 * - interface/packages/uniswap/src/features/transactions/steps/*.ts
 * - interface/packages/uniswap/src/features/transactions/liquidity/steps/*.ts
 */

import type { Address, Hex } from 'viem';
import { maxUint256, getAddress } from 'viem';
import type { TokenSymbol } from '@/lib/pools-config';
import { getToken, getPositionManagerAddress } from '@/lib/pools-config';
import { PERMIT2_ADDRESS, PERMIT2_DOMAIN_NAME, PERMIT_EXPIRATION_DURATION_SECONDS } from '@/lib/swap-constants';
import type { NetworkMode } from '@/lib/network-mode';

import {
  TransactionStepType,
  LiquidityTransactionType,
  type TokenApprovalTransactionStep,
  type TokenRevocationTransactionStep,
  type Permit2SignatureStep,
  type Permit2TransactionStep,
  type IncreasePositionTransactionStep,
  type IncreasePositionTransactionStepAsync,
  type IncreasePositionTransactionStepBatched,
  type DecreasePositionTransactionStep,
  type CollectFeesTransactionStep,
  type IncreaseLiquiditySteps,
  type DecreaseLiquiditySteps,
  type CollectFeesSteps,
  type TransactionStep,
  type ValidatedTransactionRequest,
  type TokenInfo,
  type StepperStep,
  type LiquidityFlowState,
  type OnChainTransactionFields,
} from '../../types';

// =============================================================================
// TOKEN APPROVAL STEP - Matches Uniswap's createApprovalTransactionStep
// =============================================================================

export interface CreateApprovalStepParams {
  txRequest: ValidatedTransactionRequest;
  token: TokenInfo;
  spender: Address;
  amount: string;
  pair?: [TokenSymbol, TokenSymbol];
}

export function createApprovalTransactionStep({
  txRequest,
  token,
  spender,
  amount,
  pair,
}: CreateApprovalStepParams): TokenApprovalTransactionStep {
  return {
    type: TransactionStepType.TokenApprovalTransaction,
    txRequest,
    token,
    spender,
    amount,
    pair,
  };
}

/** @deprecated Use createApprovalTransactionStep instead */
export function createTokenApprovalStep(params: {
  tokenSymbol: TokenSymbol;
  networkMode: NetworkMode;
  requiredAmount: bigint;
  useInfinite: boolean;
}): TokenApprovalTransactionStep {
  const tokenConfig = getToken(params.tokenSymbol, params.networkMode);
  if (!tokenConfig) {
    throw new Error(`Token ${params.tokenSymbol} not found`);
  }

  const amount = params.useInfinite ? maxUint256 : params.requiredAmount + 1n;

  return {
    type: TransactionStepType.TokenApprovalTransaction,
    txRequest: {
      to: getAddress(tokenConfig.address) as Address,
      data: '0x' as Hex, // Will be filled by transaction builder
      value: 0n,
    },
    token: {
      address: getAddress(tokenConfig.address) as Address,
      symbol: tokenConfig.symbol,
      decimals: tokenConfig.decimals,
    },
    spender: PERMIT2_ADDRESS as Address,
    amount: amount.toString(),
  };
}

// =============================================================================
// TOKEN REVOCATION STEP - Matches Uniswap's createRevocationTransactionStep
// =============================================================================

export interface CreateRevocationStepParams {
  txRequest: ValidatedTransactionRequest;
  token: TokenInfo;
  spender: Address;
}

export function createRevocationTransactionStep(
  txRequest: ValidatedTransactionRequest | undefined,
  token: TokenInfo
): TokenRevocationTransactionStep | undefined {
  if (!txRequest) {
    return undefined;
  }

  return {
    type: TransactionStepType.TokenRevocationTransaction,
    txRequest,
    token,
    spender: PERMIT2_ADDRESS as Address,
  };
}

// =============================================================================
// PERMIT2 SIGNATURE STEP - Matches Uniswap's createPermit2SignatureStep
// =============================================================================

export interface CreatePermit2SignatureStepParams {
  domain: {
    name: string;
    chainId: number;
    verifyingContract: Address;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  values: Record<string, unknown>;
  token: TokenInfo;
}

export function createPermit2SignatureStep(
  permitData: { domain: any; types: any; values: any },
  token: TokenInfo
): Permit2SignatureStep {
  return {
    type: TransactionStepType.Permit2Signature,
    domain: permitData.domain,
    types: permitData.types,
    values: permitData.values,
    token,
  };
}

/** @deprecated Use createPermit2SignatureStep with proper params */
export interface CreatePermit2StepParams {
  chainId: number;
  networkMode: NetworkMode;
  details: Array<{
    tokenAddress: Address;
    amount: bigint;
    nonce: number;
  }>;
  sigDeadlineSeconds?: number;
}

// =============================================================================
// PERMIT2 TRANSACTION STEP - Matches Uniswap's createPermit2TransactionStep
// =============================================================================

export interface CreatePermit2TransactionStepParams {
  txRequest: ValidatedTransactionRequest;
  token: TokenInfo;
  pair?: [TokenSymbol, TokenSymbol];
}

export function createPermit2TransactionStep({
  txRequest,
  token,
  pair,
}: CreatePermit2TransactionStepParams): Permit2TransactionStep | undefined {
  if (!txRequest) {
    return undefined;
  }

  return {
    type: TransactionStepType.Permit2Transaction,
    txRequest,
    token,
    pair,
  };
}

// =============================================================================
// INCREASE POSITION STEPS - Matches Uniswap's increasePosition.ts
// =============================================================================

export function createIncreasePositionStep(
  txRequest: ValidatedTransactionRequest,
  sqrtRatioX96: string | undefined
): IncreasePositionTransactionStep {
  return {
    type: TransactionStepType.IncreasePositionTransaction,
    txRequest,
    sqrtRatioX96,
  };
}

export function createIncreasePositionAsyncStep(
  getTxRequestFn: (signature: string) => Promise<{
    txRequest: ValidatedTransactionRequest | undefined;
    sqrtRatioX96: string | undefined;
  }>
): IncreasePositionTransactionStepAsync {
  return {
    type: TransactionStepType.IncreasePositionTransactionAsync,
    getTxRequest: getTxRequestFn,
  };
}

export function createIncreasePositionStepBatched(
  txRequests: ValidatedTransactionRequest[],
  sqrtRatioX96: string | undefined
): IncreasePositionTransactionStepBatched {
  return {
    type: TransactionStepType.IncreasePositionTransactionBatched,
    batchedTxRequests: txRequests,
    sqrtRatioX96,
  };
}

// =============================================================================
// DECREASE POSITION STEP - Matches Uniswap's decreasePosition.ts
// =============================================================================

export function createDecreasePositionStep(
  txRequest: ValidatedTransactionRequest,
  sqrtRatioX96?: string
): DecreasePositionTransactionStep {
  return {
    type: TransactionStepType.DecreasePositionTransaction,
    txRequest,
    sqrtRatioX96,
  };
}

// =============================================================================
// COLLECT FEES STEP - Matches Uniswap's collectFees.ts
// =============================================================================

export function createCollectFeesStep(
  txRequest: ValidatedTransactionRequest
): CollectFeesTransactionStep {
  return {
    type: TransactionStepType.CollectFeesTransactionStep,
    txRequest,
  };
}

// =============================================================================
// FLOW TYPES - Matches Uniswap's *LiquiditySteps.ts
// =============================================================================

/**
 * Increase Liquidity Flow - Matches interface/.../increaseLiquiditySteps.ts
 */
export type IncreaseLiquidityFlow =
  | {
      approvalToken0?: TokenApprovalTransactionStep;
      approvalToken1?: TokenApprovalTransactionStep;
      approvalPositionToken?: TokenApprovalTransactionStep;
      revokeToken0?: TokenRevocationTransactionStep;
      revokeToken1?: TokenRevocationTransactionStep;
      permit: Permit2SignatureStep;
      token0PermitTransaction: undefined;
      token1PermitTransaction: undefined;
      increasePosition: IncreasePositionTransactionStepAsync;
    }
  | {
      approvalToken0?: TokenApprovalTransactionStep;
      approvalToken1?: TokenApprovalTransactionStep;
      approvalPositionToken?: TokenApprovalTransactionStep;
      revokeToken0?: TokenRevocationTransactionStep;
      revokeToken1?: TokenRevocationTransactionStep;
      permit: undefined;
      token0PermitTransaction: Permit2TransactionStep | undefined;
      token1PermitTransaction: Permit2TransactionStep | undefined;
      increasePosition: IncreasePositionTransactionStep;
    };

/**
 * Decrease Liquidity Flow - Matches interface/.../decreaseLiquiditySteps.ts
 */
export type DecreaseLiquidityFlow = {
  approvalPositionToken?: TokenApprovalTransactionStep;
  decreasePosition: DecreasePositionTransactionStep;
};

/**
 * Collect Fees Flow - Matches interface/.../collectFeesSteps.ts
 */
export type CollectFeesFlow = {
  collectFees: CollectFeesTransactionStep;
};

// =============================================================================
// STEP ORDERING FUNCTIONS - Matches Uniswap's order*Steps functions
// =============================================================================

/**
 * Orders increase liquidity steps - Matches orderIncreaseLiquiditySteps
 */
export function orderIncreaseLiquiditySteps(flow: IncreaseLiquidityFlow): IncreaseLiquiditySteps[] {
  const steps: IncreaseLiquiditySteps[] = [];

  // Revocations first
  if (flow.revokeToken0) {
    steps.push(flow.revokeToken0);
  }
  if (flow.revokeToken1) {
    steps.push(flow.revokeToken1);
  }

  // Then approvals
  if (flow.approvalToken0) {
    steps.push(flow.approvalToken0);
  }
  if (flow.approvalToken1) {
    steps.push(flow.approvalToken1);
  }
  if (flow.approvalPositionToken) {
    steps.push(flow.approvalPositionToken);
  }

  // Then permit signature or permit transactions
  if (flow.permit) {
    steps.push(flow.permit);
  }
  if (flow.token0PermitTransaction) {
    steps.push(flow.token0PermitTransaction);
  }
  if (flow.token1PermitTransaction) {
    steps.push(flow.token1PermitTransaction);
  }

  // Finally the position transaction
  steps.push(flow.increasePosition);

  return steps;
}

/**
 * Orders decrease liquidity steps - Matches orderDecreaseLiquiditySteps
 */
export function orderDecreaseLiquiditySteps(flow: DecreaseLiquidityFlow): DecreaseLiquiditySteps[] {
  const steps: DecreaseLiquiditySteps[] = [];

  if (flow.approvalPositionToken) {
    steps.push(flow.approvalPositionToken);
  }

  steps.push(flow.decreasePosition);

  return steps;
}

/**
 * Orders collect fees steps - Matches orderCollectFeesSteps
 */
export function orderCollectFeesSteps(flow: CollectFeesFlow): CollectFeesSteps[] {
  return [flow.collectFees];
}

// =============================================================================
// STEPPER UI HELPERS
// =============================================================================

export function generateStepperSteps(flowState: LiquidityFlowState): StepperStep[] {
  const steps: StepperStep[] = [];

  // Group approval steps
  const approvalSteps = flowState.steps.filter(
    (s) => s.step.type === TransactionStepType.TokenApprovalTransaction
  );
  if (approvalSteps.length > 0) {
    const completed = approvalSteps.filter((s) => s.status === 'completed').length;
    const hasLoading = approvalSteps.some((s) => s.status === 'loading');
    const hasError = approvalSteps.some((s) => s.status === 'error');

    steps.push({
      id: 'approvals',
      label: 'Token Approvals',
      status: hasError
        ? 'error'
        : hasLoading
          ? 'loading'
          : completed === approvalSteps.length
            ? 'completed'
            : 'pending',
      count: { completed, total: approvalSteps.length },
    });
  }

  // Permit signature step
  const permitStep = flowState.steps.find(
    (s) => s.step.type === TransactionStepType.Permit2Signature
  );
  if (permitStep) {
    steps.push({
      id: 'permit',
      label: 'Permit Signature',
      status: permitStep.status === 'idle' ? 'pending' : permitStep.status,
    });
  }

  // Position transaction step
  const positionStep = flowState.steps.find(
    (s) =>
      s.step.type === TransactionStepType.IncreasePositionTransaction ||
      s.step.type === TransactionStepType.IncreasePositionTransactionAsync ||
      s.step.type === TransactionStepType.DecreasePositionTransaction ||
      s.step.type === TransactionStepType.CollectFeesTransactionStep
  );
  if (positionStep) {
    const label = getPositionStepLabel(flowState.operationType);
    steps.push({
      id: 'position',
      label,
      status: positionStep.status === 'idle' ? 'pending' : positionStep.status,
    });
  }

  return steps;
}

function getPositionStepLabel(operationType: LiquidityTransactionType): string {
  switch (operationType) {
    case LiquidityTransactionType.Create:
      return 'Create Position';
    case LiquidityTransactionType.Increase:
      return 'Add Liquidity';
    case LiquidityTransactionType.Decrease:
      return 'Remove Liquidity';
    case LiquidityTransactionType.Collect:
      return 'Collect Fees';
    default:
      return 'Execute Transaction';
  }
}

// =============================================================================
// FLOW STATE HELPERS
// =============================================================================

export function createInitialFlowState(operationType: LiquidityTransactionType): LiquidityFlowState {
  return {
    operationType,
    steps: [],
    currentStepIndex: 0,
    isComplete: false,
  };
}

export function getNextStep(flowState: LiquidityFlowState): number | null {
  const incompleteIndex = flowState.steps.findIndex(
    (s) => s.status !== 'completed' && s.status !== 'error'
  );
  return incompleteIndex === -1 ? null : incompleteIndex;
}

export function isFlowComplete(flowState: LiquidityFlowState): boolean {
  return flowState.steps.every((s) => s.status === 'completed');
}

export function hasFlowError(flowState: LiquidityFlowState): boolean {
  return flowState.steps.some((s) => s.status === 'error');
}

// =============================================================================
// DEPRECATED EXPORTS - For backward compatibility
// =============================================================================

/** @deprecated Use CreateApprovalStepParams instead */
export type CreateApprovalStepParamsLegacy = {
  tokenSymbol: TokenSymbol;
  networkMode: NetworkMode;
  requiredAmount: bigint;
  useInfinite: boolean;
};

/** @deprecated Use CreatePermit2SignatureStepParams instead */
export type CreatePermit2StepParamsLegacy = CreatePermit2StepParams;

/** @deprecated Use proper step creation functions */
export interface CreateSwapStepParams {
  inputToken: TokenSymbol;
  outputToken: TokenSymbol;
  inputAmount: string;
  minOutputAmount: string;
  permitSignature?: string;
  txRequest: {
    to: Address;
    data: Hex;
    value: bigint;
    deadline: bigint;
  };
}

/** @deprecated Swap execution is no longer a core step type */
export function createSwapExecutionStep(params: CreateSwapStepParams): any {
  return {
    type: 'SwapExecution',
    inputToken: params.inputToken,
    outputToken: params.outputToken,
    inputAmount: params.inputAmount,
    minOutputAmount: params.minOutputAmount,
    permitSignature: params.permitSignature,
    txRequest: params.txRequest,
  };
}

/** @deprecated Use proper step creation functions */
export interface CreatePositionTxStepParams {
  operationType: LiquidityTransactionType;
  permitSignature?: string;
  txRequest: {
    to: Address;
    data: Hex;
    value: bigint;
  };
}

/** @deprecated Use createIncreasePositionStep or createDecreasePositionStep */
export function createPositionTransactionStep(params: CreatePositionTxStepParams): any {
  const txRequest: ValidatedTransactionRequest = {
    to: params.txRequest.to,
    data: params.txRequest.data,
    value: params.txRequest.value,
  };

  if (params.operationType === LiquidityTransactionType.Increase || params.operationType === LiquidityTransactionType.Create) {
    return createIncreasePositionStep(txRequest, undefined);
  } else if (params.operationType === LiquidityTransactionType.Decrease) {
    return createDecreasePositionStep(txRequest, undefined);
  } else if (params.operationType === LiquidityTransactionType.Collect) {
    return createCollectFeesStep(txRequest);
  }

  return createIncreasePositionStep(txRequest, undefined);
}
