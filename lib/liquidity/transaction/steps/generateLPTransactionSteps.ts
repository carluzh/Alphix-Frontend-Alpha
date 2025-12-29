/**
 * Generate LP Transaction Steps
 *
 * COPIED FROM UNISWAP - DO NOT MODIFY WITHOUT UPDATING FROM SOURCE
 * Source: interface/packages/uniswap/src/features/transactions/liquidity/steps/generateLPTransactionSteps.ts
 *
 * This function generates the ordered transaction steps for liquidity operations
 * (create, increase, decrease, collect fees).
 */

import { CurrencyAmount, Token } from '@uniswap/sdk-core';

import {
  TransactionStepType,
  LiquidityTransactionType,
  type LiquidityTxAndGasInfo,
  type TransactionStep,
  isValidLiquidityTxContext,
} from '../../types';

import {
  createApprovalTransactionStep,
  createRevocationTransactionStep,
  createPermit2SignatureStep,
  createPermit2TransactionStep,
  createIncreasePositionStep,
  createIncreasePositionAsyncStep,
  createCreatePositionAsyncStep,
  createIncreasePositionStepBatched,
  createDecreasePositionStep,
  createCollectFeesStep,
  orderIncreaseLiquiditySteps,
  orderDecreaseLiquiditySteps,
  orderCollectFeesSteps,
  type IncreaseLiquidityFlow,
} from './steps';

import type { OnChainTransactionFields, IncreaseLiquiditySteps } from '../../types';

/**
 * Generates the ordered transaction steps for a liquidity operation.
 *
 * COPIED FROM UNISWAP - Logic matches interface/packages/uniswap/.../generateLPTransactionSteps.ts
 *
 * @param txContext - The validated liquidity transaction context
 * @returns An ordered array of transaction steps to execute
 */
export function generateLPTransactionSteps(txContext: LiquidityTxAndGasInfo): TransactionStep[] {
  const isValidLP = isValidLiquidityTxContext(txContext);

  if (isValidLP) {
    // Handle collect fees - simplest case, just the collect step
    if (txContext.type === LiquidityTransactionType.Collect) {
      return orderCollectFeesSteps({
        collectFees: createCollectFeesStep(txContext.txRequest),
      });
    }

    const {
      action,
      approveToken0Request,
      approveToken1Request,
      approvePositionTokenRequest,
      token0PermitTransaction,
      token1PermitTransaction,
    } = txContext;

    // Create revocation steps for each token
    const revokeToken0 = createRevocationTransactionStep(
      txContext.revokeToken0Request,
      action.currency0Amount.currency.wrapped as Token,
    );
    const revokeToken1 = createRevocationTransactionStep(
      txContext.revokeToken1Request,
      action.currency1Amount.currency.wrapped as Token,
    );

    // Create approval steps for each token
    const approvalToken0 = createApprovalTransactionStep({
      txRequest: approveToken0Request,
      amountIn: action.currency0Amount as unknown as CurrencyAmount<any>,
    });
    const approvalToken1 = createApprovalTransactionStep({
      txRequest: approveToken1Request,
      amountIn: action.currency1Amount as unknown as CurrencyAmount<any>,
    });
    const approvalPositionToken = createApprovalTransactionStep({
      txRequest: approvePositionTokenRequest,
      amountIn: action.liquidityToken
        ? CurrencyAmount.fromRawAmount(action.liquidityToken as Token, 1)
        : undefined,
      pair: [action.currency0Amount.currency, action.currency1Amount.currency] as [any, any],
    });

    // Create permit transaction steps
    const token0PermitTransactionStep = createPermit2TransactionStep({
      txRequest: token0PermitTransaction,
      amountIn: action.currency0Amount as unknown as CurrencyAmount<any>,
      pair: [action.currency0Amount.currency, action.currency1Amount.currency] as [any, any],
    });

    const token1PermitTransactionStep = createPermit2TransactionStep({
      txRequest: token1PermitTransaction,
      amountIn: action.currency1Amount as unknown as CurrencyAmount<any>,
      pair: [action.currency0Amount.currency, action.currency1Amount.currency] as [any, any],
    });

    switch (txContext.type) {
      case 'decrease':
        return orderDecreaseLiquiditySteps({
          approvalPositionToken,
          decreasePosition: createDecreasePositionStep(txContext.txRequest, txContext.sqrtRatioX96),
        });

      case 'create':
      case 'increase':
        if (txContext.unsigned) {
          // Unsigned flow uses permit signature - MATCHES UNISWAP PATTERN
          // The async step will call the API with the signature to get the transaction
          return orderIncreaseLiquiditySteps({
            revokeToken0,
            revokeToken1,
            approvalToken0,
            approvalToken1,
            approvalPositionToken,
            permit: createPermit2SignatureStep(
              txContext.permit,
              action.currency0Amount.currency,
            ),
            token0PermitTransaction: undefined,
            token1PermitTransaction: undefined,
            increasePosition:
              txContext.type === 'increase'
                ? createIncreasePositionAsyncStep(txContext.increasePositionRequestArgs)
                : createCreatePositionAsyncStep(txContext.createPositionRequestArgs),
          });
        } else {
          // Signed flow uses permit transactions
          const steps = orderIncreaseLiquiditySteps({
            revokeToken0,
            revokeToken1,
            approvalToken0,
            approvalToken1,
            approvalPositionToken,
            permit: undefined,
            token0PermitTransaction: token0PermitTransactionStep,
            token1PermitTransaction: token1PermitTransactionStep,
            increasePosition: createIncreasePositionStep(txContext.txRequest, txContext.sqrtRatioX96),
          });

          // If batching is supported, combine all transactions into one batched step
          if (txContext.canBatchTransactions) {
            const txRequests = steps
              .filter((step): step is IncreaseLiquiditySteps & OnChainTransactionFields => 'txRequest' in step)
              .map((step) => step.txRequest);
            return [createIncreasePositionStepBatched(txRequests, txContext.sqrtRatioX96)];
          }

          return steps;
        }
    }
  }

  return [];
}
