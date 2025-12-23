/**
 * Unified Liquidity Types - Uniswap-style step-based architecture
 *
 * This module mirrors Uniswap's transaction step system from:
 * - interface/packages/uniswap/src/features/transactions/steps/types.ts
 * - interface/packages/uniswap/src/features/transactions/liquidity/types.ts
 */

import type { Address, Hex } from 'viem';
import type { TokenSymbol } from '@/lib/pools-config';

// =============================================================================
// TRANSACTION STEP TYPE ENUM - Matches Uniswap's TransactionStepType
// =============================================================================

export enum TransactionStepType {
  TokenApprovalTransaction = 'TokenApproval',
  TokenRevocationTransaction = 'TokenRevocation',
  Permit2Signature = 'Permit2Signature',
  Permit2Transaction = 'Permit2Transaction',
  IncreasePositionTransaction = 'IncreasePositionTransaction',
  IncreasePositionTransactionAsync = 'IncreasePositionTransactionAsync',
  IncreasePositionTransactionBatched = 'IncreasePositionTransactionBatched',
  DecreasePositionTransaction = 'DecreasePositionTransaction',
  CollectFeesTransactionStep = 'CollectFeesTransaction',
}

// =============================================================================
// LIQUIDITY TRANSACTION TYPE ENUM - Matches Uniswap's LiquidityTransactionType
// =============================================================================

export enum LiquidityTransactionType {
  Create = 'create',
  Increase = 'increase',
  Decrease = 'decrease',
  Collect = 'collect',
}

// =============================================================================
// BASE TRANSACTION FIELDS - Matches Uniswap's OnChainTransactionFields
// =============================================================================

export interface ValidatedTransactionRequest {
  to: Address;
  data: Hex;
  value?: bigint;
  gasLimit?: bigint;
  chainId?: number;
}

export interface OnChainTransactionFields {
  txRequest: ValidatedTransactionRequest;
}

export interface OnChainTransactionFieldsBatched {
  batchedTxRequests: ValidatedTransactionRequest[];
}

// =============================================================================
// SIGNATURE STEP FIELDS - Matches Uniswap's SignTypedDataStepFields
// =============================================================================

export interface SignTypedDataStepFields {
  domain: {
    name: string;
    chainId: number;
    verifyingContract: Address;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  values: Record<string, unknown>;
}

// =============================================================================
// TOKEN INFO - Simplified token representation for steps
// =============================================================================

export interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
}

// =============================================================================
// STEP INTERFACES - Matches Uniswap's step definitions
// =============================================================================

/**
 * Token Approval Step - Matches interface/packages/uniswap/.../steps/approve.ts
 */
export interface TokenApprovalTransactionStep extends OnChainTransactionFields {
  type: TransactionStepType.TokenApprovalTransaction;
  token: TokenInfo;
  spender: Address;
  amount: string;
  pair?: [TokenSymbol, TokenSymbol];
}

/**
 * Token Revocation Step - Matches interface/packages/uniswap/.../steps/revoke.ts
 */
export interface TokenRevocationTransactionStep extends OnChainTransactionFields {
  type: TransactionStepType.TokenRevocationTransaction;
  token: TokenInfo;
  spender: Address;
}

/**
 * Permit2 Signature Step - Matches interface/packages/uniswap/.../steps/permit2Signature.ts
 */
export interface Permit2SignatureStep extends SignTypedDataStepFields {
  type: TransactionStepType.Permit2Signature;
  token: TokenInfo;
}

/**
 * Permit2 Transaction Step - Matches interface/packages/uniswap/.../steps/permit2Transaction.ts
 */
export interface Permit2TransactionStep extends OnChainTransactionFields {
  type: TransactionStepType.Permit2Transaction;
  token: TokenInfo;
  pair?: [TokenSymbol, TokenSymbol];
}

/**
 * Increase Position Step - Matches interface/packages/uniswap/.../liquidity/steps/increasePosition.ts
 */
export interface IncreasePositionTransactionStep extends OnChainTransactionFields {
  type: TransactionStepType.IncreasePositionTransaction;
  sqrtRatioX96: string | undefined;
}

/**
 * Increase Position Async Step - For permit flows where tx is built after signature
 */
export interface IncreasePositionTransactionStepAsync {
  type: TransactionStepType.IncreasePositionTransactionAsync;
  getTxRequest(signature: string): Promise<{
    txRequest: ValidatedTransactionRequest | undefined;
    sqrtRatioX96: string | undefined;
  }>;
}

/**
 * Increase Position Batched Step - For ERC-5792 atomic batch execution
 */
export interface IncreasePositionTransactionStepBatched extends OnChainTransactionFieldsBatched {
  type: TransactionStepType.IncreasePositionTransactionBatched;
  sqrtRatioX96: string | undefined;
}

/**
 * Decrease Position Step - Matches interface/packages/uniswap/.../liquidity/steps/decreasePosition.ts
 */
export interface DecreasePositionTransactionStep extends OnChainTransactionFields {
  type: TransactionStepType.DecreasePositionTransaction;
  sqrtRatioX96?: string;
}

/**
 * Collect Fees Step - Matches interface/packages/uniswap/.../liquidity/steps/collectFees.ts
 */
export interface CollectFeesTransactionStep extends OnChainTransactionFields {
  type: TransactionStepType.CollectFeesTransactionStep;
}

// =============================================================================
// COMPOSITE STEP TYPES - Matches Uniswap's union types
// =============================================================================

export type IncreaseLiquiditySteps =
  | TokenApprovalTransactionStep
  | TokenRevocationTransactionStep
  | Permit2SignatureStep
  | Permit2TransactionStep
  | IncreasePositionTransactionStep
  | IncreasePositionTransactionStepAsync
  | IncreasePositionTransactionStepBatched;

export type DecreaseLiquiditySteps =
  | TokenApprovalTransactionStep
  | DecreasePositionTransactionStep;

export type CollectFeesSteps = CollectFeesTransactionStep;

export type TransactionStep =
  | IncreaseLiquiditySteps
  | DecreaseLiquiditySteps
  | CollectFeesSteps;

// =============================================================================
// LIQUIDITY ACTION - Matches Uniswap's LiquidityAction
// =============================================================================

export interface CurrencyAmount {
  currency: TokenInfo;
  quotient: string;
}

export interface LiquidityAction {
  type: LiquidityTransactionType;
  currency0Amount: CurrencyAmount;
  currency1Amount: CurrencyAmount;
  liquidityToken?: TokenInfo;
}

// =============================================================================
// LIQUIDITY TX AND GAS INFO - Matches Uniswap's LiquidityTxAndGasInfo
// =============================================================================

interface BaseLiquidityTxAndGasInfo {
  canBatchTransactions: boolean;
  action: LiquidityAction;
  approveToken0Request: ValidatedTransactionRequest | undefined;
  approveToken1Request: ValidatedTransactionRequest | undefined;
  approvePositionTokenRequest: ValidatedTransactionRequest | undefined;
  permit: SignTypedDataStepFields | undefined;
  token0PermitTransaction: ValidatedTransactionRequest | undefined;
  token1PermitTransaction: ValidatedTransactionRequest | undefined;
  revokeToken0Request: ValidatedTransactionRequest | undefined;
  revokeToken1Request: ValidatedTransactionRequest | undefined;
  txRequest: ValidatedTransactionRequest | undefined;
}

export interface IncreasePositionTxAndGasInfo extends BaseLiquidityTxAndGasInfo {
  type: LiquidityTransactionType.Increase;
  unsigned: boolean;
  increasePositionRequestArgs: unknown | undefined;
  sqrtRatioX96: string | undefined;
}

export interface CreatePositionTxAndGasInfo extends BaseLiquidityTxAndGasInfo {
  type: LiquidityTransactionType.Create;
  unsigned: boolean;
  createPositionRequestArgs: unknown | undefined;
  sqrtRatioX96: string | undefined;
}

export interface DecreasePositionTxAndGasInfo extends BaseLiquidityTxAndGasInfo {
  type: LiquidityTransactionType.Decrease;
  sqrtRatioX96: string | undefined;
}

export interface CollectFeesTxAndGasInfo {
  type: LiquidityTransactionType.Collect;
  action: LiquidityAction;
  txRequest: ValidatedTransactionRequest | undefined;
}

export type LiquidityTxAndGasInfo =
  | IncreasePositionTxAndGasInfo
  | CreatePositionTxAndGasInfo
  | DecreasePositionTxAndGasInfo
  | CollectFeesTxAndGasInfo;

// =============================================================================
// VALIDATED LIQUIDITY TX CONTEXT - Matches Uniswap's ValidatedLiquidityTxContext
// =============================================================================

export type ValidatedIncreasePositionTxAndGasInfo = Required<IncreasePositionTxAndGasInfo> &
  (
    | {
        unsigned: true;
        permit: SignTypedDataStepFields;
        txRequest: undefined;
      }
    | {
        unsigned: false;
        permit: undefined;
        txRequest: ValidatedTransactionRequest;
        sqrtRatioX96: string | undefined;
      }
  );

export type ValidatedCreatePositionTxAndGasInfo = Required<CreatePositionTxAndGasInfo> &
  (
    | {
        unsigned: true;
        permit: SignTypedDataStepFields;
        txRequest: undefined;
      }
    | {
        unsigned: false;
        permit: undefined;
        txRequest: ValidatedTransactionRequest;
        sqrtRatioX96: string | undefined;
      }
  );

export type ValidatedDecreasePositionTxAndGasInfo = Required<DecreasePositionTxAndGasInfo> & {
  txRequest: ValidatedTransactionRequest;
};

export type ValidatedCollectFeesTxAndGasInfo = CollectFeesTxAndGasInfo & {
  txRequest: ValidatedTransactionRequest;
};

export type ValidatedLiquidityTxContext =
  | ValidatedIncreasePositionTxAndGasInfo
  | ValidatedCreatePositionTxAndGasInfo
  | ValidatedDecreasePositionTxAndGasInfo
  | ValidatedCollectFeesTxAndGasInfo;

// =============================================================================
// VALIDATION FUNCTIONS - Matches Uniswap's validation pattern
// =============================================================================

export function isValidLiquidityTxContext(
  liquidityTxContext: LiquidityTxAndGasInfo | unknown
): liquidityTxContext is ValidatedLiquidityTxContext {
  return validateLiquidityTxContext(liquidityTxContext) !== undefined;
}

function validateLiquidityTxContext(
  liquidityTxContext: LiquidityTxAndGasInfo | unknown
): ValidatedLiquidityTxContext | undefined {
  if (!isLiquidityTx(liquidityTxContext)) {
    return undefined;
  }

  if (liquidityTxContext.type === LiquidityTransactionType.Collect) {
    if (liquidityTxContext.txRequest) {
      return { ...liquidityTxContext, txRequest: liquidityTxContext.txRequest };
    }
    return undefined;
  }

  const { action, txRequest, permit } = liquidityTxContext;
  const unsigned =
    (liquidityTxContext.type === 'increase' || liquidityTxContext.type === 'create') &&
    'unsigned' in liquidityTxContext &&
    liquidityTxContext.unsigned;

  if (unsigned) {
    if (!permit) {
      return undefined;
    }
    return { ...liquidityTxContext, action, unsigned, txRequest: undefined, permit } as ValidatedLiquidityTxContext;
  } else if (txRequest) {
    return { ...liquidityTxContext, action, unsigned: false, txRequest, permit: undefined } as ValidatedLiquidityTxContext;
  }

  return undefined;
}

function isLiquidityTx(liquidityTxContext: unknown): liquidityTxContext is LiquidityTxAndGasInfo {
  return typeof liquidityTxContext === 'object' && liquidityTxContext !== null && 'action' in liquidityTxContext;
}

// =============================================================================
// FLOW STATE - For UI progress tracking
// =============================================================================

export type FlowStatus = 'idle' | 'pending' | 'loading' | 'completed' | 'error';

export interface StepState {
  step: TransactionStep;
  status: FlowStatus;
  txHash?: Hex;
  signature?: string;
  error?: string;
}

export interface LiquidityFlowState {
  operationType: LiquidityTransactionType;
  steps: StepState[];
  currentStepIndex: number;
  isComplete: boolean;
  error?: string;
}

// =============================================================================
// APPROVAL STATUS - For approval check hooks
// =============================================================================

export interface TokenApprovalStatus {
  tokenSymbol: TokenSymbol;
  tokenAddress: Address;
  needsERC20Approval: boolean;
  needsPermit2Signature: boolean;
  currentAllowance: bigint;
  requiredAmount: bigint;
  permit2Allowance?: {
    amount: bigint;
    expiration: number;
    nonce: number;
  };
}

export interface ApprovalCheckResult {
  token0: TokenApprovalStatus | null;
  token1: TokenApprovalStatus | null;
  permitBatchData: Permit2SignatureStep | null;
  isLoading: boolean;
  error?: string;
}

// =============================================================================
// STEPPER UI TYPES - For rendering transaction progress
// =============================================================================

export interface StepperStep {
  id: string;
  label: string;
  status: 'pending' | 'loading' | 'completed' | 'error';
  count?: { completed: number; total: number };
}

