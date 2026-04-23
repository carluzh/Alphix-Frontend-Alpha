/**
 * Maps executor step types (lib-level) to UI step types (component-level)
 * for the ProgressIndicator component.
 *
 * Extracted from ReviewExecuteModal to keep the modal focused on orchestration.
 */

import type { TransactionStep } from '@/lib/liquidity/types';
import {
  type TransactionStep as UITransactionStep,
  TransactionStepType as UIStepType,
} from '@/lib/transactions';

interface PoolInfo {
  currency0: { symbol: string; address: string };
  currency1: { symbol: string; address: string };
}

export function mapExecutorStepsToUI(
  executorSteps: TransactionStep[],
  pool: PoolInfo | null,
  token0Icon?: string,
  token1Icon?: string
): UITransactionStep[] {
  if (!pool) return [];

  return executorSteps.map((step): UITransactionStep => {
    switch (step.type) {
      case 'TokenApproval':
      case 'TokenRevocation': {
        const tokenSymbol = (step as any).token?.symbol || pool.currency0.symbol;
        const tokenAddress = (step as any).token?.address || pool.currency0.address;
        const isToken0 = tokenAddress.toLowerCase() === pool.currency0.address.toLowerCase();
        return {
          type: UIStepType.TokenApprovalTransaction,
          tokenSymbol,
          tokenAddress,
          tokenIcon: isToken0 ? token0Icon : token1Icon,
        };
      }

      // Unified Yield approval - direct ERC20 to Hook
      case 'UnifiedYieldApproval': {
        const uyStep = step as any;
        const isToken0 = uyStep.tokenSymbol === pool.currency0.symbol;
        return {
          type: UIStepType.TokenApprovalTransaction,
          tokenSymbol: uyStep.tokenSymbol || pool.currency0.symbol,
          tokenAddress: uyStep.tokenAddress || '',
          tokenIcon: isToken0 ? token0Icon : token1Icon,
        };
      }

      case 'Permit2Signature':
        return { type: UIStepType.Permit2Signature };

      case 'IncreasePositionTransaction':
      case 'IncreasePositionTransactionAsync':
      case 'IncreasePositionTransactionBatchedAsync':
      case 'UnifiedYieldDeposit': // UY deposit maps to create position UI
        return {
          type: UIStepType.CreatePositionTransaction,
          token0Symbol: pool.currency0.symbol,
          token1Symbol: pool.currency1.symbol,
          token0Icon,
          token1Icon,
        };

      case 'DecreasePositionTransaction':
        return {
          type: UIStepType.DecreasePositionTransaction,
          token0Symbol: pool.currency0.symbol,
          token1Symbol: pool.currency1.symbol,
          token0Icon,
          token1Icon,
        };

      case 'CollectFeesTransaction':
        return {
          type: UIStepType.CollectFeesTransactionStep,
          token0Symbol: pool.currency0.symbol,
          token1Symbol: pool.currency1.symbol,
          token0Icon,
          token1Icon,
        };

      // Zap (single-token deposit) steps
      case 'ZapSwapApproval': {
        const zapStep = step as any;
        const isToken0 = zapStep.inputToken === 'USDS' || zapStep.tokenSymbol === pool.currency0.symbol;
        return {
          type: UIStepType.TokenApprovalTransaction,
          tokenSymbol: zapStep.tokenSymbol || (isToken0 ? pool.currency0.symbol : pool.currency1.symbol),
          tokenAddress: zapStep.tokenAddress || '',
          tokenIcon: isToken0 ? token0Icon : token1Icon,
        };
      }

      case 'ZapPSMSwap': {
        const zapStep = step as any;
        const isToken0Input = zapStep.direction === 'USDS_TO_USDC';
        return {
          type: UIStepType.SwapTransaction,
          inputTokenSymbol: isToken0Input ? pool.currency0.symbol : pool.currency1.symbol,
          outputTokenSymbol: isToken0Input ? pool.currency1.symbol : pool.currency0.symbol,
          inputTokenIcon: isToken0Input ? token0Icon : token1Icon,
          outputTokenIcon: isToken0Input ? token1Icon : token0Icon,
          routeType: 'psm' as const,
        };
      }

      case 'ZapPoolSwap': {
        const zapStep = step as any;
        const isToken0Input = zapStep.inputToken === 'USDS';
        return {
          type: UIStepType.SwapTransaction,
          inputTokenSymbol: isToken0Input ? pool.currency0.symbol : pool.currency1.symbol,
          outputTokenSymbol: isToken0Input ? pool.currency1.symbol : pool.currency0.symbol,
          inputTokenIcon: isToken0Input ? token0Icon : token1Icon,
          outputTokenIcon: isToken0Input ? token1Icon : token0Icon,
          routeType: 'pool' as const,
        };
      }

      case 'ZapDynamicDeposit': {
        // Dynamic deposit step - shows as a deposit/create position step
        return {
          type: UIStepType.CreatePositionTransaction,
          token0Symbol: pool.currency0.symbol,
          token1Symbol: pool.currency1.symbol,
          token0Icon,
          token1Icon,
        };
      }

      default:
        return {
          type: UIStepType.CreatePositionTransaction,
          token0Symbol: pool.currency0.symbol,
          token1Symbol: pool.currency1.symbol,
          token0Icon,
          token1Icon,
        };
    }
  });
}
