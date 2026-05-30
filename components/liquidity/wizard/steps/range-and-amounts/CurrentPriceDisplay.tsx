'use client';

import { DenominationToggle } from '@/components/liquidity/DenominationToggle';

// Current price display with token selector (Uniswap pattern)
interface CurrentPriceProps {
  price?: string;
  token0Symbol: string;
  token1Symbol: string;
  inverted: boolean;
  onSelectToken: (token: string) => void;
  networkMode?: import('@/lib/network-mode').NetworkMode;
  outOfRange?: boolean;
}

export function CurrentPriceDisplay({
  price,
  token0Symbol,
  token1Symbol,
  inverted,
  onSelectToken,
  networkMode,
  outOfRange,
}: CurrentPriceProps) {
  const baseToken = inverted ? token1Symbol : token0Symbol;
  const quoteToken = inverted ? token0Symbol : token1Symbol;
  const selectedToken = inverted ? token1Symbol : token0Symbol;

  return (
    <div className="flex flex-col gap-1.5 py-4">
      {/* Top row: Label + toggle (on mobile: toggle next to label; on desktop: toggle on right) */}
      <div className="flex flex-row items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">Current price</span>
        <DenominationToggle
          token0Symbol={token0Symbol}
          token1Symbol={token1Symbol}
          activeBase={selectedToken}
          onToggle={onSelectToken}
          networkMode={networkMode}
        />
      </div>
      {/* Price value and denomination text */}
      {/* When the pool is out of the UY preset range, the on-chain price math overflows
          into scientific notation (e+40). Suppress the broken number and show a hyphen
          instead - the PoolOutOfRangeCallout below already conveys the state. */}
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-xl font-semibold text-white">
          {outOfRange ? '-' : (price || '—')}
        </span>
        <span className="text-sm text-muted-foreground">
          {quoteToken} per {baseToken}
        </span>
      </div>
    </div>
  );
}
