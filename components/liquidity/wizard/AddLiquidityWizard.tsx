'use client';

/**
 * AddLiquidityWizard - Main orchestrator component
 * Updated for 2-step flow + review modal (Uniswap-aligned)
 *
 * Entry points:
 * - /liquidity/add - Full wizard flow (Step 1: Pool + Mode)
 * - /liquidity/add?pool=<poolId> - Skip to Step 2 (from pool page)
 */

import { Suspense, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import { AddLiquidityProvider, type WizardEntryConfig } from './AddLiquidityContext';
import { CreatePositionTxContextProvider } from './CreatePositionTxContext';
import { FormWrapper } from './FormWrapper';
import { WizardStep } from './types';

// Step components (new merged steps)
import { PoolAndModeStep } from './steps/PoolAndModeStep';
import { RangeAndAmountsStep } from './steps/RangeAndAmountsStep';
import { ReviewExecuteModal } from './ReviewExecuteModal';
import { useAddLiquidityContext } from './AddLiquidityContext';

// Loading fallback
function WizardLoading() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-sidebar-primary" />
        <span className="text-muted-foreground">Loading wizard...</span>
      </div>
    </div>
  );
}

// Subtle step transition animation
const STEP_TRANSITION = { duration: 0.2, ease: 'easeOut' };

// Step renderer based on current step with animations
function WizardStepRenderer() {
  const { currentStep } = useAddLiquidityContext();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={currentStep}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={STEP_TRANSITION}
      >
        {currentStep === WizardStep.POOL_AND_MODE && <PoolAndModeStep />}
        {currentStep === WizardStep.RANGE_AND_AMOUNTS && <RangeAndAmountsStep />}
        {currentStep !== WizardStep.POOL_AND_MODE && currentStep !== WizardStep.RANGE_AND_AMOUNTS && <PoolAndModeStep />}
      </motion.div>
    </AnimatePresence>
  );
}

// Toolbar component with settings
function WizardToolbar() {
  // TODO: Add settings dropdown for slippage, deadline, etc.
  return (
    <div className="flex items-center gap-2">
      {/* Settings button would go here */}
    </div>
  );
}

// Inner wizard content (needs context)
function WizardContent() {
  const { currentStep } = useAddLiquidityContext();

  // Determine title based on step
  const title = useMemo(() => {
    switch (currentStep) {
      case WizardStep.POOL_AND_MODE:
        return 'Add Liquidity';
      case WizardStep.RANGE_AND_AMOUNTS:
        return 'Set Range & Deposit';
      default:
        return 'Add Liquidity';
    }
  }, [currentStep]);

  return (
    <>
      <FormWrapper
        title={title}
        toolbar={<WizardToolbar />}
      >
        <WizardStepRenderer />
      </FormWrapper>

      {/* Review + Execute Modal */}
      <ReviewExecuteModal />
    </>
  );
}

// Main wizard component
export interface AddLiquidityWizardProps {
  entryConfig?: WizardEntryConfig;
}

export function AddLiquidityWizard({ entryConfig }: AddLiquidityWizardProps) {
  return (
    <Suspense fallback={<WizardLoading />}>
      <AddLiquidityProvider entryConfig={entryConfig}>
        <CreatePositionTxContextProvider>
          <WizardContent />
        </CreatePositionTxContextProvider>
      </AddLiquidityProvider>
    </Suspense>
  );
}

// Export new step components
export {
  PoolAndModeStep,
  RangeAndAmountsStep,
  ReviewExecuteModal,
};
