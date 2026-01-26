/**
 * Liquidity Transaction Context Builder
 *
 * Transforms Alphix API responses into Uniswap-compatible LiquidityTxAndGasInfo context.
 * This context is then passed to generateLPTransactionSteps to create the transaction flow.
 */

import { CurrencyAmount, Token, Ether, type Currency } from '@uniswap/sdk-core';
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

  // ERC20 approval data (for ERC20_TO_PERMIT2 type or when erc20ApprovalNeeded is true)
  approvalTokenAddress?: string;
  approvalTokenSymbol?: string;
  approveToAddress?: string;
  approvalAmount?: string;
  // Flag indicating ERC20 approval to Permit2 is needed (included with PERMIT2_BATCH_SIGNATURE)
  erc20ApprovalNeeded?: boolean;

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
    gasLimit?: string;
  };
  transaction?: {
    to: string;
    data: string;
    value: string;
    gasLimit?: string;
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
  // Request args for async step (needed to call API with signature after permit)
  // Uniswap pattern: permitBatchData is embedded here so it's sent with signature
  createPositionRequestArgs?: {
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
    permitBatchData?: MintTxApiResponse['permitBatchData'];
  };
  // Request args for increase position async step
  // Note: Uses amount0/amount1 format for prepare-increase-tx.ts
  increasePositionRequestArgs?: {
    userAddress: string;
    tokenId: string;
    amount0: string;
    amount1: string;
    chainId: number;
    slippageBps?: number;
    deadlineMinutes?: number;
  };
  // Unified Yield specific fields
  isUnifiedYield?: boolean;
  hookAddress?: Address;
  poolId?: string;
  sharesToWithdraw?: bigint; // For decrease/withdraw
  sharesToMint?: bigint; // For increase/create (deposit)
}

// =============================================================================
// CONTEXT BUILDERS
// =============================================================================

const NATIVE_TOKEN_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Creates an SDK Currency (Token or Ether) from config
 */
function createCurrency(config: TokenConfig): Currency {
  // Native ETH uses Ether class, not Token
  if (config.address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()) {
    return Ether.onChain(config.chainId);
  }
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
  const currency0 = createCurrency(token0);
  const currency1 = createCurrency(token1);

  return {
    type,
    currency0Amount: CurrencyAmount.fromRawAmount(currency0, amount0 || '0'),
    currency1Amount: CurrencyAmount.fromRawAmount(currency1, amount1 || '0'),
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

  // Safely parse bigint values - handle potential decimal strings
  const safeBigInt = (val: string | undefined, fieldName: string): bigint | undefined => {
    if (!val) return undefined;
    try {
      // Handle decimal strings by truncating (these should be integers)
      const cleanVal = val.includes('.') ? val.split('.')[0] : val;
      return BigInt(cleanVal);
    } catch (e) {
      console.warn(`[buildTxRequest] Invalid ${fieldName} value:`, val);
      return undefined;
    }
  };

  return {
    to: txData.to as Address,
    data: txData.data as Hex,
    value: safeBigInt(txData.value, 'value'),
    gasLimit: safeBigInt(txData.gasLimit, 'gasLimit'),
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
 *
 * For Unified Yield positions, includes UY-specific fields for step generation.
 */
export function buildCreatePositionContext(
  params: BuildLiquidityContextParams,
): CreatePositionTxAndGasInfo {
  const {
    apiResponse,
    token0,
    token1,
    amount0,
    amount1,
    chainId,
    approveToken0Request,
    approveToken1Request,
    permit,
    createPositionRequestArgs,
    // Unified Yield fields
    isUnifiedYield,
    hookAddress,
    poolId,
    sharesToMint,
  } = params;

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
    // Pass request args for async step - needed to call API with signature after permit
    createPositionRequestArgs,
    sqrtRatioX96: apiResponse.sqrtRatioX96,
    // Unified Yield specific fields
    isUnifiedYield,
    hookAddress,
    poolId,
    sharesToMint,
  };
}

/**
 * Builds Increase Position context
 *
 * For Unified Yield positions, includes UY-specific fields for step generation.
 */
export function buildIncreasePositionContext(
  params: BuildLiquidityContextParams,
): IncreasePositionTxAndGasInfo {
  const {
    apiResponse,
    token0,
    token1,
    amount0,
    amount1,
    chainId,
    approveToken0Request,
    approveToken1Request,
    permit,
    increasePositionRequestArgs,
    // Unified Yield fields
    isUnifiedYield,
    hookAddress,
    poolId,
    sharesToMint,
  } = params;

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
    increasePositionRequestArgs,
    sqrtRatioX96: apiResponse.sqrtRatioX96,
    // Unified Yield specific fields
    isUnifiedYield,
    hookAddress,
    poolId,
    sharesToMint,
  };
}

/**
 * Builds Decrease Position context
 *
 * For Unified Yield positions, includes UY-specific fields for step generation.
 */
export function buildDecreasePositionContext(
  params: BuildLiquidityContextParams,
): DecreasePositionTxAndGasInfo {
  const {
    apiResponse,
    token0,
    token1,
    amount0,
    amount1,
    chainId,
    approveToken0Request,
    approveToken1Request,
    // Unified Yield fields
    isUnifiedYield,
    hookAddress,
    poolId,
    sharesToWithdraw,
  } = params;

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
    // Unified Yield specific fields
    isUnifiedYield,
    hookAddress,
    poolId,
    sharesToWithdraw,
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
