'use client';

/**
 * Shared sub-components for the ReviewExecuteModal.
 *
 * Extracted to keep ReviewExecuteModal focused on orchestration logic.
 * These are presentation-only components with no state management.
 */

import { useState } from 'react';
import { TokenImage } from '@/components/ui/token-image';
import { AlertCircle, RotateCw } from 'lucide-react';

// =============================================================================
// TokenInfoRow — Uniswap style: amount + symbol large, USD below, logo on right
// =============================================================================

export interface TokenInfoRowProps {
  symbol: string;
  icon?: string;
  amount: string;
  usdValue?: string;
}

export function TokenInfoRow({ symbol, icon, amount, usdValue }: TokenInfoRowProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col">
        <span className="text-xl font-semibold text-white">
          {amount || '0'} {symbol}
        </span>
        {usdValue && (
          <span className="text-sm text-muted-foreground">${usdValue}</span>
        )}
      </div>
      {icon ? (
        <TokenImage src={icon} alt={symbol} size={36} />
      ) : (
        <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-bold text-white">
          {symbol.charAt(0)}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// DoubleCurrencyLogo — Overlapping token pair icons
// =============================================================================

export function DoubleCurrencyLogo({
  icon0,
  icon1,
  symbol0,
  symbol1,
}: {
  icon0?: string;
  icon1?: string;
  symbol0: string;
  symbol1: string;
}) {
  return (
    <div className="flex items-center -space-x-2">
      {icon0 ? (
        <TokenImage src={icon0} alt={symbol0} size={36} />
      ) : (
        <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-bold text-white ">
          {symbol0.charAt(0)}
        </div>
      )}
      {icon1 ? (
        <TokenImage src={icon1} alt={symbol1} size={36} />
      ) : (
        <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-bold text-white ">
          {symbol1.charAt(0)}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// ErrorCallout — Error display with copy and retry
// =============================================================================

export function ErrorCallout({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!error) return null;

  // Truncate long errors for display (keep first 120 chars)
  const MAX_ERROR_LENGTH = 120;
  const displayError = error.length > MAX_ERROR_LENGTH
    ? error.slice(0, MAX_ERROR_LENGTH) + '...'
    : error;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(error);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy error:', err);
    }
  };

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 overflow-hidden">
      <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 overflow-hidden">
        <p className="text-sm text-red-400 break-words">
          {displayError}
        </p>
        <div className="flex gap-3 mt-2">
          <button
            onClick={handleCopy}
            className="text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
          >
            {copied ? (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy
              </>
            )}
          </button>
          <button
            onClick={onRetry}
            className="text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1"
          >
            <RotateCw className="w-3 h-3" />
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
