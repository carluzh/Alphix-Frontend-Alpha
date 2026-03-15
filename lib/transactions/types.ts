/**
 * Transaction Step Types & Interfaces
 * Adapted from: interface/packages/uniswap/src/features/transactions/steps/types.ts
 *
 * Simplified for Alphix liquidity flows - removed Uniswap internal dependencies
 */

// Re-export StepStatus for convenience
export { StepStatus } from './step-status'

// ============================================================================
// Transaction Step Type Enum
// ============================================================================

/**
 * Transaction step types - identifies the type of step for rendering
 * Kept from Uniswap's original enum, filtered to liquidity-relevant types
 */
export enum TransactionStepType {
  // Token approvals
  TokenApprovalTransaction = 'TokenApproval',
  TokenRevocationTransaction = 'TokenRevocation',

  // Permit2
  Permit2Signature = 'Permit2Signature',
  Permit2Transaction = 'Permit2Transaction',

  // Liquidity operations (from Uniswap)
  IncreasePositionTransaction = 'IncreasePositionTransaction',
  IncreasePositionTransactionAsync = 'IncreasePositionTransactionAsync',
  DecreasePositionTransaction = 'DecreasePositionTransaction',
  CollectFeesTransactionStep = 'CollectFeesTransaction',

  // Alphix-specific
  CreatePositionTransaction = 'CreatePositionTransaction',

  // Swap operations (for Zap flow)
  SwapTransaction = 'SwapTransaction',

  // Faucet
  FaucetMintTransaction = 'FaucetMintTransaction',
}

// ============================================================================
// Step Interfaces
// ============================================================================

/**
 * Base transaction step interface
 */
export interface TransactionStepBase {
  type: TransactionStepType
}

/**
 * Token approval step - ERC20 approval before Permit2
 */
export interface TokenApprovalStep extends TransactionStepBase {
  type: TransactionStepType.TokenApprovalTransaction
  tokenSymbol: string
  tokenIcon?: string
  tokenAddress: string
  chainId?: number
}

/**
 * Permit2 signature step - gasless signature for batch operations
 */
export interface Permit2SignatureStep extends TransactionStepBase {
  type: TransactionStepType.Permit2Signature
}

/**
 * Liquidity position step - create, increase, decrease, or collect fees
 */
export interface LiquidityPositionStep extends TransactionStepBase {
  type:
    | TransactionStepType.CreatePositionTransaction
    | TransactionStepType.IncreasePositionTransaction
    | TransactionStepType.DecreasePositionTransaction
    | TransactionStepType.CollectFeesTransactionStep
  token0Symbol?: string
  token1Symbol?: string
  token0Icon?: string
  token1Icon?: string
}

/**
 * Faucet mint step (deprecated - testnet removed)
 */
export interface FaucetMintStep extends TransactionStepBase {
  type: TransactionStepType.FaucetMintTransaction
  tokenSymbol: string
  tokenAddress: string
  tokenIcon?: string
  amount: string
}

/**
 * Swap step - for Zap flow (PSM or pool swap)
 */
export interface SwapStep extends TransactionStepBase {
  type: TransactionStepType.SwapTransaction
  inputTokenSymbol: string
  outputTokenSymbol: string
  inputTokenIcon?: string
  outputTokenIcon?: string
  /** Route type: 'psm' for 1:1 PSM swap, 'pool' for AMM swap, 'kyberswap' for aggregator */
  routeType: 'psm' | 'pool' | 'kyberswap'
}

/**
 * Union of all step types
 */
export type TransactionStep =
  | TokenApprovalStep
  | Permit2SignatureStep
  | LiquidityPositionStep
  | FaucetMintStep
  | SwapStep

/**
 * Current step state - tracks which step is active and if user accepted
 */
export interface CurrentStepState {
  step: TransactionStep
  accepted: boolean // true when user action submitted, waiting for confirmation
}

// ============================================================================
// Factory Functions for Creating Steps
// ============================================================================

/**
 * Create a token approval step
 */
export function createTokenApprovalStep(
  tokenSymbol: string,
  tokenAddress: string,
  tokenIcon?: string,
  chainId?: number
): TokenApprovalStep {
  return {
    type: TransactionStepType.TokenApprovalTransaction,
    tokenSymbol,
    tokenAddress,
    tokenIcon,
    chainId,
  }
}

/**
 * Create a Permit2 signature step
 */
export function createPermit2SignatureStep(): Permit2SignatureStep {
  return {
    type: TransactionStepType.Permit2Signature,
  }
}

