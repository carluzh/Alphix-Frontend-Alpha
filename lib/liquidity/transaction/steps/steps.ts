/**
 * Step Factory Functions & Flow Ordering
 *
 * COPIED FROM UNISWAP - DO NOT MODIFY WITHOUT UPDATING FROM SOURCE
 * Source files:
 * - interface/packages/uniswap/src/features/transactions/steps/approve.ts
 * - interface/packages/uniswap/src/features/transactions/steps/revoke.ts
 * - interface/packages/uniswap/src/features/transactions/steps/permit2Signature.ts
 * - interface/packages/uniswap/src/features/transactions/steps/permit2Transaction.ts
 * - interface/packages/uniswap/src/features/transactions/liquidity/steps/*.ts
 * - interface/packages/uniswap/src/utils/approvals.ts
 */

import type { Currency, CurrencyAmount, Token } from '@uniswap/sdk-core';
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
  type CreateLPPositionRequestArgs,
  type IncreaseLPPositionRequestArgs,
} from '../../types';

// =============================================================================
// APPROVAL UTILITIES - COPIED FROM interface/packages/uniswap/src/utils/approvals.ts
// =============================================================================

type ERC20ApprovalTransactionParts = {
  /** The amount approved for spend */
  amount: bigint;
  /** The address approved for spend */
  spender: string;
};

export function parseERC20ApproveCalldata(data: string): ERC20ApprovalTransactionParts {
  const amount = BigInt(`0x${data.slice(-64)}`); // length of a uint256
  const spender = `0x${data.slice(-104, -64)}`; // length of an address
  return { amount, spender };
}

// =============================================================================
// TOKEN APPROVAL STEP - COPIED FROM interface/packages/uniswap/src/features/transactions/steps/approve.ts
// =============================================================================

/**
 * Creates an approval transaction step - COPIED FROM UNISWAP
 * @param txRequest - The transaction request (optional, returns undefined if not provided)
 * @param amountIn - The currency amount being approved
 * @param pair - Optional pair of currencies for display
 */
export function createApprovalTransactionStep({
  txRequest,
  amountIn,
  pair,
}: {
  txRequest?: ValidatedTransactionRequest;
  amountIn?: CurrencyAmount<Currency>;
  pair?: [Currency, Currency];
}): TokenApprovalTransactionStep | undefined {
  if (!txRequest?.data || !amountIn) {
    return undefined;
  }

  const type = TransactionStepType.TokenApprovalTransaction;
  const token = amountIn.currency.wrapped;
  const { spender } = parseERC20ApproveCalldata(txRequest.data.toString());
  const amount = amountIn.quotient.toString();

  return { type, txRequest, token, spender, amount, pair };
}


// =============================================================================
// TOKEN REVOCATION STEP - COPIED FROM interface/packages/uniswap/src/features/transactions/steps/revoke.ts
// =============================================================================

/**
 * Creates a revocation transaction step - COPIED FROM UNISWAP
 * @param txRequest - The transaction request (optional, returns undefined if not provided)
 * @param token - The token being revoked
 */
export function createRevocationTransactionStep(
  txRequest: ValidatedTransactionRequest | undefined,
  token: Token
): TokenRevocationTransactionStep | undefined {
  if (!txRequest?.data) {
    return undefined;
  }

  const type = TransactionStepType.TokenRevocationTransaction;
  const { spender, amount } = parseERC20ApproveCalldata(txRequest.data.toString());

  if (amount !== BigInt(0)) {
    return undefined;
  }

  return { type, txRequest, token, spender, amount: '0' };
}

// =============================================================================
// PERMIT2 SIGNATURE STEP - COPIED FROM interface/packages/uniswap/src/features/transactions/steps/permit2Signature.ts
// =============================================================================

/**
 * ValidatedPermit type - matches Uniswap's permit structure
 */
export interface ValidatedPermit {
  domain: {
    name: string;
    chainId: number;
    verifyingContract: Address;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  values: Record<string, unknown>;
}

/**
 * Creates a Permit2 signature step - COPIED FROM UNISWAP
 * @param permitData - The permit typed data
 * @param token - The currency for this permit
 */
export function createPermit2SignatureStep(
  permitData: ValidatedPermit,
  token: Currency
): Permit2SignatureStep {
  return { type: TransactionStepType.Permit2Signature, token, ...permitData };
}

// =============================================================================
// PERMIT2 TRANSACTION STEP - COPIED FROM interface/packages/uniswap/src/features/transactions/steps/permit2Transaction.ts
// =============================================================================

/**
 * Creates a Permit2 transaction step - COPIED FROM UNISWAP
 * @param txRequest - The transaction request (optional, returns undefined if not provided)
 * @param amountIn - The currency amount
 * @param pair - Optional pair of currencies for display
 */
export function createPermit2TransactionStep({
  txRequest,
  amountIn,
  pair,
}: {
  txRequest?: ValidatedTransactionRequest;
  amountIn?: CurrencyAmount<Currency>;
  pair?: [Currency, Currency];
}): Permit2TransactionStep | undefined {
  if (!txRequest?.data || !amountIn) {
    return undefined;
  }

  const type = TransactionStepType.Permit2Transaction;
  const token = amountIn.currency.wrapped;
  const { spender } = parseERC20ApproveCalldata(txRequest.data.toString());
  const amount = amountIn.quotient.toString();

  return { type, txRequest, token, spender, amount, pair };
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

/**
 * Creates an async step for increasing an existing LP position.
 * MATCHES UNISWAP PATTERN - Takes request args and internally calls API with signature.
 *
 * @param increasePositionRequestArgs - The request args for the API call
 */
export function createIncreasePositionAsyncStep(
  increasePositionRequestArgs: IncreaseLPPositionRequestArgs | undefined,
): IncreasePositionTransactionStepAsync {
  return {
    type: TransactionStepType.IncreasePositionTransactionAsync,
    getTxRequest: async (
      signature: string,
    ): Promise<{ txRequest: ValidatedTransactionRequest | undefined; sqrtRatioX96: string | undefined }> => {
      if (!increasePositionRequestArgs) {
        return { txRequest: undefined, sqrtRatioX96: undefined };
      }

      try {
        // Call Alphix API with signature to get the transaction
        // Note: prepare-increase-tx expects tokenId, amount0, amount1 (not inputAmount/inputTokenSymbol)
        const response = await fetch('/api/liquidity/prepare-increase-tx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...increasePositionRequestArgs,
            permitSignature: signature,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || 'Failed to prepare increase position transaction');
        }

        const data = await response.json();

        // Validate and transform the response
        const txData = data.create || data.transaction;
        if (!txData) {
          return { txRequest: undefined, sqrtRatioX96: data.sqrtRatioX96 };
        }

        // Safely parse bigint values - handle potential decimal strings
        const safeBigInt = (val: string | undefined): bigint | undefined => {
          if (!val) return undefined;
          try {
            const cleanVal = val.includes('.') ? val.split('.')[0] : val;
            return BigInt(cleanVal);
          } catch {
            return undefined;
          }
        };

        const txRequest: ValidatedTransactionRequest = {
          to: txData.to as Address,
          data: txData.data as Hex,
          value: safeBigInt(txData.value),
          gasLimit: safeBigInt(txData.gasLimit),
          chainId: txData.chainId || increasePositionRequestArgs.chainId,
        };

        return { txRequest, sqrtRatioX96: data.sqrtRatioX96 };
      } catch (e) {
        console.error('createIncreasePositionAsyncStep error:', e);
        throw e;
      }
    },
  };
}

/**
 * Creates an async step for creating a new LP position.
 * MATCHES UNISWAP PATTERN - Takes request args and internally calls API with signature.
 *
 * @param createPositionRequestArgs - The request args for the API call
 */
export function createCreatePositionAsyncStep(
  createPositionRequestArgs: CreateLPPositionRequestArgs | undefined,
): IncreasePositionTransactionStepAsync {
  return {
    type: TransactionStepType.IncreasePositionTransactionAsync,
    getTxRequest: async (
      signature: string,
    ): Promise<{ txRequest: ValidatedTransactionRequest | undefined; sqrtRatioX96: string | undefined }> => {
      if (!createPositionRequestArgs) {
        return { txRequest: undefined, sqrtRatioX96: undefined };
      }

      try {
        // Call Alphix API with signature to get the transaction
        const response = await fetch('/api/liquidity/prepare-mint-tx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...createPositionRequestArgs,
            permitSignature: signature,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || 'Failed to prepare create position transaction');
        }

        const data = await response.json();

        // Validate and transform the response
        const txData = data.create || data.transaction;
        if (!txData) {
          return { txRequest: undefined, sqrtRatioX96: data.sqrtRatioX96 };
        }

        // Safely parse bigint values - handle potential decimal strings
        const safeBigInt = (val: string | undefined): bigint | undefined => {
          if (!val) return undefined;
          try {
            const cleanVal = val.includes('.') ? val.split('.')[0] : val;
            return BigInt(cleanVal);
          } catch {
            return undefined;
          }
        };

        const txRequest: ValidatedTransactionRequest = {
          to: txData.to as Address,
          data: txData.data as Hex,
          value: safeBigInt(txData.value),
          gasLimit: safeBigInt(txData.gasLimit),
          chainId: txData.chainId || createPositionRequestArgs.chainId,
        };

        return { txRequest, sqrtRatioX96: data.sqrtRatioX96 };
      } catch (e) {
        console.error('createCreatePositionAsyncStep error:', e);
        throw e;
      }
    },
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

