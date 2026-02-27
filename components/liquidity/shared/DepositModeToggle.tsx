/**
 * DepositModeToggle - Shared toggle for balanced vs zap deposit mode
 *
 * Used in:
 * - RangeAndAmountsStep (create position flow)
 * - IncreaseLiquidityForm (increase liquidity flow)
 *
 * Only shown for zap-eligible Unified Yield pools (USDS/USDC).
 */

'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type DepositMode = 'balanced' | 'zap';

export interface DepositModeToggleProps {
  /** Current deposit mode */
  depositMode: DepositMode;
  /** Callback when mode changes */
  onModeChange: (mode: DepositMode) => void;
  /** Optional class name */
  className?: string;
}

/**
 * Toggle button for switching between balanced (dual token) and zap (single token) deposit modes.
 *
 * Renders as a simple text link that toggles between the two modes.
 */
export function DepositModeToggle({
  depositMode,
  onModeChange,
  className,
}: DepositModeToggleProps) {
  if (depositMode === 'zap') {
    return (
      <button
        onClick={() => onModeChange('balanced')}
        className={cn(
          'text-sm text-muted-foreground underline hover:text-white transition-colors',
          className
        )}
      >
        Dual Deposit
      </button>
    );
  }

  return (
    <button
      onClick={() => onModeChange('zap')}
      className={cn(
        'text-sm text-muted-foreground underline hover:text-white transition-colors',
        className
      )}
    >
      Single Token
    </button>
  );
}
