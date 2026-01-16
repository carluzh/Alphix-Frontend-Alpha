/**
 * Transaction Step Types & Interfaces
 * Adapted from: interface/packages/uniswap/src/features/transactions/steps/types.ts
 *
 * Simplified for Alphix liquidity flows - removed Uniswap internal dependencies
 */

import { StepStatus } from './step-status'

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
 * Union of all step types
 */
export type TransactionStep =
  | TokenApprovalStep
  | Permit2SignatureStep
  | LiquidityPositionStep

// ============================================================================
// Component Props Interfaces
// ============================================================================

/**
 * Step row props interface - shared by all step components
 * Matches Uniswap's StepRowProps pattern from StepRowSkeleton.tsx
 */
export interface StepRowProps<T extends TransactionStep = TransactionStep> {
  step: T
  status: StepStatus
  currentStepIndex: number
  totalStepsCount: number
}

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

/**
 * Create a liquidity position step
 */
export function createLiquidityStep(
  stepType: LiquidityPositionStep['type'],
  token0Symbol?: string,
  token1Symbol?: string,
  token0Icon?: string,
  token1Icon?: string
): LiquidityPositionStep {
  return {
    type: stepType,
    token0Symbol,
    token1Symbol,
    token0Icon,
    token1Icon,
  }
}

// ============================================================================
// Step Builder for Add Liquidity Flow
// ============================================================================

export interface AddLiquidityStepsConfig {
  needsToken0Approval: boolean
  needsToken1Approval: boolean
  token0Symbol: string
  token1Symbol: string
  token0Address: string
  token1Address: string
  token0Icon?: string
  token1Icon?: string
}

/**
 * Build transaction steps for add liquidity flow
 * Following Uniswap's generateLPTransactionSteps pattern:
 * - Approvals first (if needed)
 * - Permit2 signature step (for async flows - signature happens before tx is built)
 * - Position creation step (receives signature, fetches tx, executes)
 */
export function buildAddLiquiditySteps(config: AddLiquidityStepsConfig): TransactionStep[] {
  const steps: TransactionStep[] = []

  // Token 0 approval if needed
  if (config.needsToken0Approval) {
    steps.push(
      createTokenApprovalStep(config.token0Symbol, config.token0Address, config.token0Icon)
    )
  }

  // Token 1 approval if needed
  if (config.needsToken1Approval) {
    steps.push(
      createTokenApprovalStep(config.token1Symbol, config.token1Address, config.token1Icon)
    )
  }

  // Permit2 signature step (Uniswap async flow pattern)
  steps.push(createPermit2SignatureStep())

  // Final execution step
  steps.push(
    createLiquidityStep(
      TransactionStepType.CreatePositionTransaction,
      config.token0Symbol,
      config.token1Symbol,
      config.token0Icon,
      config.token1Icon
    )
  )

  return steps
}

// ============================================================================
// Step Builder for Increase Liquidity Flow
// ============================================================================

export interface IncreaseLiquidityStepsConfig {
  neededApprovals: Array<{
    symbol: string
    address: string
    icon?: string
  }>
  token0Symbol: string
  token1Symbol: string
  token0Icon?: string
  token1Icon?: string
}

/**
 * Build transaction steps for increase liquidity flow
 * Following Uniswap's generateLPTransactionSteps pattern:
 * - Approvals first (if needed)
 * - Permit2 signature step (async flow)
 * - Increase position step
 */
export function buildIncreaseLiquiditySteps(config: IncreaseLiquidityStepsConfig): TransactionStep[] {
  const steps: TransactionStep[] = []

  // Add approval steps (only those that are needed)
  for (const approval of config.neededApprovals) {
    steps.push(createTokenApprovalStep(approval.symbol, approval.address, approval.icon))
  }

  // Permit2 signature step (Uniswap async flow pattern)
  steps.push(createPermit2SignatureStep())

  // Increase position
  steps.push(
    createLiquidityStep(
      TransactionStepType.IncreasePositionTransaction,
      config.token0Symbol,
      config.token1Symbol,
      config.token0Icon,
      config.token1Icon
    )
  )

  return steps
}

// ============================================================================
// Step Builder for Decrease Liquidity Flow
// ============================================================================

export interface DecreaseLiquidityStepsConfig {
  token0Symbol: string
  token1Symbol: string
  token0Icon?: string
  token1Icon?: string
  collectFees?: boolean
}

/**
 * Build transaction steps for decrease liquidity flow
 */
export function buildDecreaseLiquiditySteps(config: DecreaseLiquidityStepsConfig): TransactionStep[] {
  const steps: TransactionStep[] = []

  // Decrease position
  steps.push(
    createLiquidityStep(
      TransactionStepType.DecreasePositionTransaction,
      config.token0Symbol,
      config.token1Symbol,
      config.token0Icon,
      config.token1Icon
    )
  )

  // Optionally collect fees
  if (config.collectFees) {
    steps.push(
      createLiquidityStep(
        TransactionStepType.CollectFeesTransactionStep,
        config.token0Symbol,
        config.token1Symbol,
        config.token0Icon,
        config.token1Icon
      )
    )
  }

  return steps
}
