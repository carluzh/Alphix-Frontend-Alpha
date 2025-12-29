/**
 * Liquidity Transaction Context Builder
 *
 * Transforms Alphix API responses into Uniswap-compatible LiquidityTxAndGasInfo context.
 * This context is then passed to generateLPTransactionSteps to create the transaction flow.
 */

import { CurrencyAmount, Token, type Currency } from '@uniswap/sdk-core';
import type { Address, Hex } from 'viem';
import type {
  LiquidityTxAndGasInfo,
  ValidatedLiquidityTxContext,
  CreatePositionTxAndGasInfo,
  IncreasePositionTxAndGasInfo,
  DecreasePositionTxAndGasInfo,
  CollectFeesTxAndGasInfo,
  LiquidityAction,
  ValidatedTransactionRequest,
  SignTypedDataStepFields,
} from '../../types';
import { LiquidityTransactionType } from '../../types';

// =============================================================================
// TYPES - API Response Types from Alphix API
// =============================================================================

export interface MintTxApiResponse {
  needsApproval: boolean;
  approvalType?: 'ERC20_TO_PERMIT2' | 'PERMIT2_BATCH_SIGNATURE';

  // ERC20 approval data
  approvalTokenAddress?: string;
  approvalTokenSymbol?: string;
  approveToAddress?: string;
  approvalAmount?: string;

  // Permit batch data
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
  signatureDetails?: {
    domain: {
      name: string;
      chainId: number;
      verifyingContract: string;
    };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
  };

  // Transaction data (when needsApproval is false)
  create?: {
    to: string;
    from?: string;
    data: string;
    value: string;
    chainId: number;
  };
  transaction?: {
    to: string;
    data: string;
    value: string;
  };
  sqrtRatioX96?: string;
  currentTick?: number;
  poolLiquidity?: string;
  dependentAmount?: string;
  deadline?: string;
  details?: {
    token0: { address: string; symbol: string; amount: string };
    token1: { address: string; symbol: string; amount: string };
    liquidity: string;
    finalTickLower: number;
    finalTickUpper: number;
  };
}

export interface TokenConfig {
  address: Address;
  symbol: string;
  decimals: number;
  chainId: number;
}

export interface BuildLiquidityContextParams {
  type: LiquidityTransactionType;
  apiResponse: MintTxApiResponse;
  token0: TokenConfig;
  token1: TokenConfig;
  amount0: string;
  amount1: string;
  chainId: number;
  // Optional approval tx requests (built from approval check responses)
  approveToken0Request?: ValidatedTransactionRequest;
  approveToken1Request?: ValidatedTransactionRequest;
  // Optional permit data (built from permit batch signature flow)
  permit?: SignTypedDataStepFields;
  permitSignature?: string;
}

// =============================================================================
// CONTEXT BUILDERS
// =============================================================================

/**
 * Creates an SDK Token from config
 */
function createToken(config: TokenConfig): Token {
  return new Token(
    config.chainId,
    config.address,
    config.decimals,
    config.symbol,
  );
}

/**
 * Builds a LiquidityAction from parameters
 */
function buildLiquidityAction(
  type: LiquidityTransactionType,
  token0: TokenConfig,
  token1: TokenConfig,
  amount0: string,
  amount1: string,
): LiquidityAction {
  const sdkToken0 = createToken(token0);
  const sdkToken1 = createToken(token1);

  return {
    type,
    currency0Amount: CurrencyAmount.fromRawAmount(sdkToken0 as Currency, amount0 || '0'),
    currency1Amount: CurrencyAmount.fromRawAmount(sdkToken1 as Currency, amount1 || '0'),
    liquidityToken: undefined, // For V4, no liquidity token (NFT-based)
  };
}

/**
 * Builds a ValidatedTransactionRequest from API response
 */
function buildTxRequest(
  apiResponse: MintTxApiResponse,
  chainId: number,
): ValidatedTransactionRequest | undefined {
  const txData = apiResponse.create || apiResponse.transaction;
  if (!txData || apiResponse.needsApproval) {
    return undefined;
  }

  return {
    to: txData.to as Address,
    data: txData.data as Hex,
    value: txData.value ? BigInt(txData.value) : undefined,
    chainId,
  };
}

/**
 * Builds permit data from API response
 */
function buildPermitData(apiResponse: MintTxApiResponse): SignTypedDataStepFields | undefined {
  const permitBatch = apiResponse.permitBatchData;
  const sigDetails = apiResponse.signatureDetails;

  if (!permitBatch?.values || !sigDetails?.domain) {
    return undefined;
  }

  return {
    domain: {
      name: sigDetails.domain.name,
      chainId: sigDetails.domain.chainId,
      verifyingContract: sigDetails.domain.verifyingContract as Address,
    },
    types: sigDetails.types,
    values: permitBatch.values,
  };
}

/**
 * Builds Create Position context
 */
export function buildCreatePositionContext(
  params: BuildLiquidityContextParams,
): CreatePositionTxAndGasInfo {
  const { apiResponse, token0, token1, amount0, amount1, chainId, approveToken0Request, approveToken1Request, permit } = params;

  const action = buildLiquidityAction(LiquidityTransactionType.Create, token0, token1, amount0, amount1);
  const txRequest = buildTxRequest(apiResponse, chainId);
  const permitData = permit || buildPermitData(apiResponse);

  return {
    type: LiquidityTransactionType.Create,
    canBatchTransactions: false, // Can be enabled for wallets supporting ERC-5792
    action,
    approveToken0Request,
    approveToken1Request,
    approvePositionTokenRequest: undefined,
    permit: permitData,
    token0PermitTransaction: undefined,
    token1PermitTransaction: undefined,
    revokeToken0Request: undefined,
    revokeToken1Request: undefined,
    txRequest,
    unsigned: !!permitData && !txRequest,
    createPositionRequestArgs: undefined,
    sqrtRatioX96: apiResponse.sqrtRatioX96,
  };
}

/**
 * Builds Increase Position context
 */
export function buildIncreasePositionContext(
  params: BuildLiquidityContextParams,
): IncreasePositionTxAndGasInfo {
  const { apiResponse, token0, token1, amount0, amount1, chainId, approveToken0Request, approveToken1Request, permit } = params;

  const action = buildLiquidityAction(LiquidityTransactionType.Increase, token0, token1, amount0, amount1);
  const txRequest = buildTxRequest(apiResponse, chainId);
  const permitData = permit || buildPermitData(apiResponse);

  return {
    type: LiquidityTransactionType.Increase,
    canBatchTransactions: false,
    action,
    approveToken0Request,
    approveToken1Request,
    approvePositionTokenRequest: undefined,
    permit: permitData,
    token0PermitTransaction: undefined,
    token1PermitTransaction: undefined,
    revokeToken0Request: undefined,
    revokeToken1Request: undefined,
    txRequest,
    unsigned: !!permitData && !txRequest,
    increasePositionRequestArgs: undefined,
    sqrtRatioX96: apiResponse.sqrtRatioX96,
  };
}

/**
 * Builds Decrease Position context
 */
export function buildDecreasePositionContext(
  params: BuildLiquidityContextParams,
): DecreasePositionTxAndGasInfo {
  const { apiResponse, token0, token1, amount0, amount1, chainId, approveToken0Request, approveToken1Request } = params;

  const action = buildLiquidityAction(LiquidityTransactionType.Decrease, token0, token1, amount0, amount1);
  const txRequest = buildTxRequest(apiResponse, chainId);

  return {
    type: LiquidityTransactionType.Decrease,
    canBatchTransactions: false,
    action,
    approveToken0Request,
    approveToken1Request,
    approvePositionTokenRequest: undefined,
    permit: undefined, // Decrease doesn't need permit
    token0PermitTransaction: undefined,
    token1PermitTransaction: undefined,
    revokeToken0Request: undefined,
    revokeToken1Request: undefined,
    txRequest,
    sqrtRatioX96: apiResponse.sqrtRatioX96,
  };
}

/**
 * Builds Collect Fees context
 */
export function buildCollectFeesContext(
  params: BuildLiquidityContextParams,
): CollectFeesTxAndGasInfo {
  const { apiResponse, token0, token1, amount0, amount1, chainId } = params;

  const action = buildLiquidityAction(LiquidityTransactionType.Collect, token0, token1, amount0, amount1);
  const txRequest = buildTxRequest(apiResponse, chainId);

  return {
    type: LiquidityTransactionType.Collect,
    action,
    txRequest,
  };
}

/**
 * Main context builder - routes to appropriate builder based on type
 */
export function buildLiquidityTxContext(
  params: BuildLiquidityContextParams,
): LiquidityTxAndGasInfo {
  switch (params.type) {
    case LiquidityTransactionType.Create:
      return buildCreatePositionContext(params);
    case LiquidityTransactionType.Increase:
      return buildIncreasePositionContext(params);
    case LiquidityTransactionType.Decrease:
      return buildDecreasePositionContext(params);
    case LiquidityTransactionType.Collect:
      return buildCollectFeesContext(params);
    default:
      throw new Error(`Unknown liquidity transaction type: ${params.type}`);
  }
}

/**
 * Validates and returns a validated context, or undefined if invalid
 */
export function validateLiquidityContext(
  context: LiquidityTxAndGasInfo,
): ValidatedLiquidityTxContext | undefined {
  // For Collect, just needs txRequest
  if (context.type === LiquidityTransactionType.Collect) {
    if (context.txRequest) {
      return context as ValidatedLiquidityTxContext;
    }
    return undefined;
  }

  // For Create/Increase, needs either permit (unsigned) or txRequest (signed)
  if (context.type === LiquidityTransactionType.Create || context.type === LiquidityTransactionType.Increase) {
    const ctx = context as CreatePositionTxAndGasInfo | IncreasePositionTxAndGasInfo;
    if (ctx.unsigned && ctx.permit) {
      return ctx as ValidatedLiquidityTxContext;
    }
    if (!ctx.unsigned && ctx.txRequest) {
      return ctx as ValidatedLiquidityTxContext;
    }
    return undefined;
  }

  // For Decrease, needs txRequest
  if (context.type === LiquidityTransactionType.Decrease) {
    if (context.txRequest) {
      return context as ValidatedLiquidityTxContext;
    }
    return undefined;
  }

  return undefined;
}
