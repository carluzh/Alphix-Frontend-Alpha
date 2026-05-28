/**
 * Zap Execution Module
 *
 * Step generation and handlers for zap deposits.
 */

export {
  generateZapSteps,
  type GenerateZapStepsParams,
  type GenerateZapStepsResult,
} from './generateZapSteps';

export {
  handleZapSwapApprovalStep,
  handleZapPoolSwapStep,
  handleZapDynamicDepositStep,
} from './handlers';
