/**
 * Unified Liquidity Types - Uniswap-style step-based architecture
 *
 * COPIED FROM UNISWAP - DO NOT MODIFY WITHOUT UPDATING FROM SOURCE
 * Source files:
 * - interface/packages/uniswap/src/features/transactions/steps/types.ts
 * - interface/packages/uniswap/src/features/transactions/liquidity/types.ts
 * - interface/packages/uniswap/src/features/transactions/steps/approve.ts
 * - interface/packages/uniswap/src/features/transactions/steps/permit2Signature.ts
 */

import type { Currency, CurrencyAmount, Token } from '@uniswap/sdk-core';
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
  Migrate = 'migrate',
  Collect = 'collect',
}

// =============================================================================
// ALPHIX API REQUEST TYPES - Used for async step creation (similar to TradingApi)
// =============================================================================

/**
 * Request args for creating a new LP position via Alphix API.
 * These are stored in the context and used when calling the API with a signature.
 */
export interface CreateLPPositionRequestArgs {
  userAddress: string;
  token0Symbol: string;
  token1Symbol: string;
  inputAmount: string;
  inputTokenSymbol: string;
  userTickLower: number;
  userTickUpper: number;
  chainId: number;
  slippageBps?: number;
  deadlineMinutes?: number;
  permitBatchData?: {
    domain?: {
      name: string;
      chainId: number;
      verifyingContract: string;
    };
    types?: Record<string, Array<{ name: string; type: string }>>;
    values?: {
      details: Array<{
        token: string;
        amount: string;
        expiration: string;
        nonce: string;
      }>;
      spender: string;
      sigDeadline: string;
    };
  };
}

/**
 * Request args for increasing an existing LP position via Alphix API.
 * Note: This uses amount0/amount1 instead of inputAmount/inputTokenSymbol
 * because prepare-increase-tx.ts expects explicit amounts for both tokens.
 */
export interface IncreaseLPPositionRequestArgs {
  userAddress: string;
  tokenId: string;
  amount0: string;
  amount1: string;
  chainId: number;
  slippageBps?: number;
  deadlineMinutes?: number;
  permitBatchData?: {
    domain?: {
      name: string;
      chainId: number;
      verifyingContract: string;
    };
    types?: Record<string, Array<{ name: string; type: string }>>;
    values?: {
      details: Array<{
        token: string;
        amount: string;
        expiration: string;
        nonce: string;
      }>;
      spender: string;
      sigDeadline: string;
    };
  };
}

/**
 * Response type for Alphix API transaction preparation
 */
export interface LPPositionTransactionResponse {
  create?: {
    to: string;
    from?: string;
    data: string;
    value: string;
    chainId: number;
  };
  sqrtRatioX96?: string;
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
 * Token Approval Step - COPIED FROM interface/packages/uniswap/src/features/transactions/steps/approve.ts
 */
export interface TokenApprovalTransactionStep extends OnChainTransactionFields {
  type: TransactionStepType.TokenApprovalTransaction;
  token: Token;
  spender: string;
  pair?: [Currency, Currency];
  // TODO(WEB-5083): this is used to distinguish a revoke from an approve. It can likely be replaced by a boolean because for LP stuff the amount isn't straight forward.
  amount: string;
}

/**
 * Token Revocation Step - COPIED FROM interface/packages/uniswap/src/features/transactions/steps/revoke.ts
 */
export interface TokenRevocationTransactionStep extends Omit<TokenApprovalTransactionStep, 'type'> {
  type: TransactionStepType.TokenRevocationTransaction;
  amount: '0';
}

/**
 * Permit2 Signature Step - COPIED FROM interface/packages/uniswap/src/features/transactions/steps/permit2Signature.ts
 */
export interface Permit2SignatureStep extends SignTypedDataStepFields {
  type: TransactionStepType.Permit2Signature;
  token: Currency; // Check if this needs to handle multiple tokens for LPing
}

/**
 * Permit2 Transaction Step - COPIED FROM interface/packages/uniswap/src/features/transactions/steps/permit2Transaction.ts
 */
export interface Permit2TransactionStep extends OnChainTransactionFields {
  type: TransactionStepType.Permit2Transaction;
  token: Token;
  spender: string;
  pair?: [Currency, Currency];
  amount: string;
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
// COPIED FROM interface/packages/uniswap/src/features/transactions/liquidity/types.ts
// =============================================================================

export interface LiquidityAction {
  type: LiquidityTransactionType;
  currency0Amount: CurrencyAmount<Currency>;
  currency1Amount: CurrencyAmount<Currency>;
  liquidityToken?: Token;
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
  increasePositionRequestArgs: IncreaseLPPositionRequestArgs | undefined;
  sqrtRatioX96: string | undefined;
}

export interface CreatePositionTxAndGasInfo extends BaseLiquidityTxAndGasInfo {
  type: LiquidityTransactionType.Create;
  unsigned: boolean;
  createPositionRequestArgs: CreateLPPositionRequestArgs | undefined;
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

