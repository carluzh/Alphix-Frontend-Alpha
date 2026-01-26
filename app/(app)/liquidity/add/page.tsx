'use client';

/**
 * Add Liquidity Page - Full wizard flow
 * Route: /liquidity/add
 *
 * URL Parameters:
 * - pool: Pool ID to pre-select (skips token selection)
 * - mode: LP mode ('rehypo' or 'concentrated')
 * - step: Current step number
 */

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';

import { AddLiquidityWizard, type WizardEntryConfig, WizardStep } from '@/components/liquidity/wizard';
import { getPoolById } from '@/lib/pools-config';

// Loading fallback
function PageLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
        <span className="text-sidebar-foreground/60">Loading...</span>
      </div>
    </div>
  );
}

// Inner component to access search params
function AddLiquidityPageContent() {
  const searchParams = useSearchParams();

  // Parse URL parameters for entry configuration
  const poolId = searchParams?.get('pool') || undefined;
  const mode = searchParams?.get('mode') as 'rehypo' | 'concentrated' | undefined;
  const stepParam = searchParams?.get('step');

  // Build entry config based on URL params
  const entryConfig: WizardEntryConfig | undefined = (() => {
    // If a pool is specified, get its tokens
    // Note: We do NOT skip to step 2 - users should always see the strategy selection
    // to choose between Unified Yield and Custom Range
    if (poolId) {
      const pool = getPoolById(poolId);
      if (pool) {
        return {
          poolId,
          token0Symbol: pool.currency0.symbol,
          token1Symbol: pool.currency1.symbol,
          mode: mode || 'rehypo',
          // Pool is pre-selected but user still sees step 1 to choose LP strategy
        };
      }
    }

    // If mode is specified but no pool
    if (mode) {
      return {
        mode,
      };
    }

    // Default: start from beginning
    return undefined;
  })();

  return <AddLiquidityWizard entryConfig={entryConfig} />;
}

export default function AddLiquidityPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <AddLiquidityPageContent />
    </Suspense>
  );
}
