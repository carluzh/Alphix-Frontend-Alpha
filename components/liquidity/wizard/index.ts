/**
 * Add Liquidity Wizard - Barrel Exports
 * Updated for 2-step flow + review modal
 *
 * Usage:
 * import { AddLiquidityWizard } from '@/components/liquidity/wizard';
 */

// Main component
export { AddLiquidityWizard, type AddLiquidityWizardProps } from './AddLiquidityWizard';

// Context and hooks
export {
  AddLiquidityProvider,
  useAddLiquidityContext,
  type WizardEntryConfig,
  type PriceRangeState,
  type DepositState,
} from './AddLiquidityContext';

// Types
export {
  WizardStep,
  type WizardState,
  type LPMode,
  type RangePreset,
  type WizardNavigationConfig,
  type PoolOption,
  type TransactionStatus,
  type TransactionStep,
  WIZARD_STEPS,
  DEFAULT_WIZARD_STATE,
} from './types';

// Step components (2-step flow)
export { PoolAndModeStep } from './steps/PoolAndModeStep';
export { RangeAndAmountsStep } from './steps/RangeAndAmountsStep';
export { ReviewExecuteModal } from './ReviewExecuteModal';

// Shared components
export { Container, AnimatedContainer } from './shared/Container';
export { WizardProgressSidebar, WizardProgressHeader, WizardProgressDots } from './shared/WizardProgress';
export { WizardNavigation, ContinueButton } from './shared/WizardNavigation';
export { FormWrapper, StepContainer, CollapsedStep } from './FormWrapper';
