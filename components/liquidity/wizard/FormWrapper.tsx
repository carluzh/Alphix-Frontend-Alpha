'use client';

/**
 * FormWrapper - Main layout component for Add Liquidity Wizard
 * Converted from Uniswap's FormWrapper to Tailwind
 * Handles layout, breadcrumb, and progress indicator placement
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

import { useAddLiquidityContext } from './AddLiquidityContext';
import { WizardProgressSidebar, WizardProgressHeader } from './shared/WizardProgress';
import { Container, AnimatedContainer } from './shared/Container';
import { WizardStep } from './types';

const WIDTH = {
  positionCard: 720,
  sidebar: 360,
};

interface FormWrapperProps {
  title?: string;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Main form wrapper that provides layout structure
 */
export function FormWrapper({
  title = 'New Position',
  toolbar,
  children,
}: FormWrapperProps) {
  const { state, navigationSource } = useAddLiquidityContext();

  // Build breadcrumb based on navigation source
  const breadcrumb = useMemo(() => {
    const hasPoolSelected = state.token0Symbol && state.token1Symbol && state.poolId;
    const poolPairLabel = hasPoolSelected ? `${state.token0Symbol}/${state.token1Symbol}` : null;

    // Determine root link and label based on navigation source
    switch (navigationSource) {
      case 'overview':
        return (
          <>
            <Link
              href="/overview"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Overview
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />
            <span className="text-foreground">New Position</span>
          </>
        );

      case 'pool':
        // Coming from a specific pool page - show TOKEN/TOKEN > New Position
        if (hasPoolSelected) {
          return (
            <>
              <Link
                href={`/liquidity/${state.poolId}`}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {poolPairLabel}
              </Link>
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />
              <span className="text-foreground">New Position</span>
            </>
          );
        }
        // Fallthrough to default if pool not selected yet
        break;

      case 'pools':
      default:
        // Coming from pools list or direct navigation - show Pools > New Position
        return (
          <>
            <Link
              href="/liquidity"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Pools
            </Link>
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />
            <span className="text-foreground">New Position</span>
          </>
        );
    }

    // Fallback
    return (
      <>
        <Link
          href="/liquidity"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          Pools
        </Link>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />
        <span className="text-foreground">New Position</span>
      </>
    );
  }, [navigationSource, state.token0Symbol, state.token1Symbol, state.poolId]);

  return (
    <div
      className="w-full px-10 xl:px-6 sm:px-2 mt-6 mx-auto"
      style={{ maxWidth: WIDTH.positionCard + WIDTH.sidebar + 80 }}
    >
      {/* Breadcrumb navigation */}
      <nav className="flex items-center gap-1.5 mb-4 text-sm" aria-label="Breadcrumb">
        {breadcrumb}
      </nav>

      {/* Header with title and toolbar */}
      <div className="flex flex-row xl:flex-col items-center xl:items-stretch gap-5 w-full justify-between mr-auto mb-6 xl:mb-4">
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
        {toolbar}
      </div>

      {/* Mobile progress header */}
      <WizardProgressHeader />

      {/* Main content area with sidebar */}
      <div className="flex flex-row gap-5 justify-center w-full">
        {/* Desktop sidebar progress */}
        <WizardProgressSidebar />

        {/* Form content */}
        <div
          className="flex flex-col gap-6 flex-1 mb-7 xl:max-w-full"
          style={{ maxWidth: WIDTH.positionCard }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Step container with animations
 * Wraps each step content with proper enter/exit animations
 */
interface StepContainerProps {
  step: WizardStep;
  children: React.ReactNode;
  className?: string;
}

export function StepContainer({ step, children, className }: StepContainerProps) {
  const { currentStep } = useAddLiquidityContext();
  const isVisible = currentStep === step;

  return (
    <AnimatePresence mode="wait">
      {isVisible && (
        <motion.div
          key={step}
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -10, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={className}
        >
          <Container>{children}</Container>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Multi-step container that shows steps based on current progress
 * Similar to Uniswap's FormStepsWrapper
 */
interface FormStepsWrapperProps {
  children: React.ReactNode;
}

export function FormStepsWrapper({ children }: FormStepsWrapperProps) {
  const { currentStep } = useAddLiquidityContext();

  return (
    <div className="flex flex-col gap-6">
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -10, opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/**
 * Collapsed step indicator shown after completing a step
 * Like Uniswap's EditStep showing selected tokens
 */
interface CollapsedStepProps {
  title: string;
  summary: string;
  onEdit?: () => void;
  icon?: React.ReactNode;
}

export function CollapsedStep({ title, summary, onEdit, icon }: CollapsedStepProps) {
  return (
    <div className="flex flex-row items-center justify-between p-4 rounded-xl bg-sidebar-accent/50 border border-sidebar-border">
      <div className="flex flex-row items-center gap-3">
        {icon && (
          <div className="w-10 h-10 rounded-full bg-sidebar-accent flex items-center justify-center">
            {icon}
          </div>
        )}
        <div className="flex flex-col">
          <span className="text-xs text-sidebar-foreground/60">{title}</span>
          <span className="text-sm font-medium text-white">{summary}</span>
        </div>
      </div>
      {onEdit && (
        <button
          onClick={onEdit}
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          Edit
        </button>
      )}
    </div>
  );
}
