'use client';

/**
 * FormWrapper - Main layout component for Add Liquidity Wizard
 * Converted from Uniswap's FormWrapper to Tailwind
 * Handles layout, breadcrumb, and progress indicator placement
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { useAddLiquidityContext } from './AddLiquidityContext';
import { WizardProgressSidebar, WizardProgressHeader } from './shared/WizardProgress';

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
      className="w-full px-10 lg:px-6 sm:px-2 mt-6 mx-auto"
      style={{ maxWidth: WIDTH.positionCard + WIDTH.sidebar + 80 }}
    >
      {/* Breadcrumb navigation */}
      <nav className="flex items-center gap-1.5 mb-4 text-sm" aria-label="Breadcrumb">
        {breadcrumb}
      </nav>

      {/* Header with title and toolbar */}
      <div className="flex flex-row lg:flex-col items-center lg:items-stretch gap-5 w-full justify-between mr-auto mb-6 lg:mb-4">
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
        {toolbar}
      </div>

      {/* Mobile/tablet progress header (screens < 1024px) */}
      <WizardProgressHeader />

      {/* Main content area with sidebar - Uniswap pattern: flex row with align-start for sticky */}
      <div className="flex flex-row gap-5 justify-between items-start w-full">
        {/* Desktop sidebar progress (screens >= 1024px) - sticky when scrolling */}
        <WizardProgressSidebar />

        {/* Form content */}
        <div
          className="flex flex-col gap-6 flex-1 mb-7 lg:max-w-full"
          style={{ maxWidth: WIDTH.positionCard }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

