'use client';

/**
 * RangeAndAmountsStep - Step 2 of Add Liquidity Wizard (Uniswap-aligned)
 * Combines range selection + deposit amounts on a single screen
 *
 * - For Rehypo mode: Range section is minimal (full range preset)
 * - For Concentrated mode: Full range selection with presets
 * - Always shows deposit amounts section
 */

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ChevronLeft } from 'lucide-react';
import { IconCircleInfo, IconTriangleWarningFilled } from 'nucleo-micro-bold-essential';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAccount, useBalance } from 'wagmi';
import { useAnimation } from 'framer-motion';

import { useAddLiquidityContext } from '../AddLiquidityContext';
import { useCreatePositionTxContext } from '../CreatePositionTxContext';
import { Container } from '../shared/Container';
import { RangePreset } from '../types';
import { getPoolById, getTokenDefinitions, TokenSymbol } from '@/lib/pools-config';
import { useNetwork } from '@/lib/network-context';
import { getDecimalsForDenomination } from '@/lib/denomination-utils';
import { usePercentageInput } from '@/hooks/usePercentageInput';
import { useTokenUSDPrice } from '@/hooks/useTokenUSDPrice';
import { useRangeHopCallbacks } from '@/hooks/useRangeHopCallbacks';
import { TokenInputCard, TokenInputStyles } from '@/components/liquidity/TokenInputCard';
import { DenominationToggle } from '@/components/liquidity/DenominationToggle';
import { formatCalculatedAmount } from '@/components/liquidity/liquidity-form-utils';
import { calculateTicksFromPercentage, getFieldsDisabled, PositionField, isInvalidRange } from '@/lib/liquidity/utils/calculations';
import { DEFAULT_TICK_SPACING } from '@/lib/liquidity/utils/validation/feeTiers';
import {
  nearestUsableTick,
  tickToPriceNumber,
  priceToTickSimple,
  priceNumberToTick,
  tickToPriceSmart,
} from '@/lib/liquidity/utils/tick-price';
import { D3LiquidityRangeChart, LiquidityRangeActionButtons, LiquidityChartSkeleton, CHART_DIMENSIONS, type D3LiquidityRangeChartHandle } from '@/components/liquidity/d3-chart';
import { HistoryDuration, usePoolPriceChartData } from '@/lib/chart';
import { useLiquidityChartData } from '@/hooks/useLiquidityChartData';
import { getPoolSubgraphId } from '@/lib/pools-config';
import { usePriceOrdering, useGetRangeDisplay } from '@/lib/uniswap/liquidity';

// Price Strategy configurations (aligned with Uniswap's DefaultPriceStrategies)
interface PriceStrategyConfig {
  id: RangePreset;
  title: string;
  display: string;
  description: string;
}

const PRICE_STRATEGIES: PriceStrategyConfig[] = [
  {
    id: 'stable',
    title: 'Narrow',
    display: '± ~0.03%',
    description: 'Tight range for stablecoins or pegged pairs',
  },
  {
    id: 'wide',
    title: 'Wide',
    display: '50% / +100%',
    description: 'Good for volatile pairs',
  },
  {
    id: 'one_sided_lower',
    title: 'One-sided lower',
    display: '50%',
    description: 'Supply liquidity if price goes down',
  },
  {
    id: 'one_sided_upper',
    title: 'One-sided upper',
    display: '+100%',
    description: 'Supply liquidity if price goes up',
  },
];

// Price Strategy button (Uniswap's DefaultPriceStrategyComponent style)
interface PriceStrategyButtonProps {
  strategy: PriceStrategyConfig;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

function PriceStrategyButton({ strategy, selected, onSelect, disabled }: PriceStrategyButtonProps) {
  const renderDisplay = () => {
    if (strategy.id === 'one_sided_lower') {
      return <>−{strategy.display}</>;
    }
    if (strategy.id === 'wide') {
      return <>−50% <span className="text-muted-foreground/50">/</span> +100%</>;
    }
    return strategy.display;
  };

  // Uses Disconnect button hover colors (bg-accent, border-white/30)
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'flex flex-col justify-between p-4 rounded-lg border border-sidebar-border bg-muted/30 transition-colors text-left min-h-[120px]',
        selected && 'bg-accent border-white/30',
        !selected && 'hover:bg-accent/50 hover:border-white/15',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
    >
      {/* Title and display value */}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted-foreground">
          {strategy.title}
        </span>
        <span className="text-base font-semibold text-white">
          {renderDisplay()}
        </span>
      </div>
      {/* Description */}
      <span className="text-xs text-muted-foreground/70 leading-tight mt-2">
        {strategy.description}
      </span>
    </button>
  );
}

// Current price display with token selector (Uniswap pattern)
interface CurrentPriceProps {
  price?: string;
  token0Symbol: string;
  token1Symbol: string;
  inverted: boolean;
  onSelectToken: (token: string) => void;
}

function CurrentPriceDisplay({
  price,
  token0Symbol,
  token1Symbol,
  inverted,
  onSelectToken,
}: CurrentPriceProps) {
  const baseToken = inverted ? token1Symbol : token0Symbol;
  const quoteToken = inverted ? token0Symbol : token1Symbol;
  const selectedToken = inverted ? token1Symbol : token0Symbol;

  return (
    <div className="flex flex-row items-center justify-between py-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted-foreground">Current price</span>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-semibold text-white">
            {price || '—'}
          </span>
          <span className="text-sm text-muted-foreground">
            {quoteToken} per {baseToken}
          </span>
        </div>
      </div>
      <DenominationToggle
        token0Symbol={token0Symbol}
        token1Symbol={token1Symbol}
        activeBase={selectedToken}
        onToggle={onSelectToken}
      />
    </div>
  );
}

// Min/Max price input (Uniswap RangeAmountInput style)
interface RangeInputProps {
  label: 'Min' | 'Max';
  percentFromCurrent: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onIncrement: () => void;
  onDecrement: () => void;
  disabled?: boolean;
  position: 'left' | 'right';
}

function RangeInput({
  label,
  percentFromCurrent,
  value,
  onChange,
  onBlur,
  onIncrement,
  onDecrement,
  disabled,
  position,
}: RangeInputProps) {
  return (
    <div className={cn(
      'flex flex-row justify-between flex-1 px-4 py-4',
      position === 'left' ? 'border-r border-sidebar-border' : '',
      disabled && 'opacity-50'
    )}>
      <div className="flex flex-col gap-1 flex-1 overflow-hidden">
        <span className="text-sm font-medium text-muted-foreground">
          {label} price
        </span>
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          disabled={disabled}
          className="bg-transparent border-none text-xl md:text-xl font-semibold p-0 h-auto text-white focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
          placeholder="0"
        />
        <span className="text-sm text-muted-foreground mt-1">
          {percentFromCurrent}
        </span>
      </div>
      {/* Right side: +/- buttons */}
      <div className="flex flex-col gap-2 justify-center">
        <button
          onClick={onIncrement}
          disabled={disabled}
          className="w-8 h-8 rounded-lg bg-sidebar-accent hover:bg-sidebar-accent/80 flex items-center justify-center text-base font-medium text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
        >
          +
        </button>
        <button
          onClick={onDecrement}
          disabled={disabled}
          className="w-8 h-8 rounded-lg bg-sidebar-accent hover:bg-sidebar-accent/80 flex items-center justify-center text-base font-medium text-muted-foreground hover:text-white transition-colors disabled:opacity-50"
        >
          −
        </button>
      </div>
    </div>
  );
}

export function RangeAndAmountsStep() {
  const {
    state,
    setRangePreset,
    setRange,
    setAmounts,
    setInputSide,
    openReviewModal,
    goBack,
    // NEW: Get pool data from context (Uniswap pattern)
    poolStateData,
    derivedPositionInfo,
    pool: sdkPool, // V4Pool SDK instance
  } = useAddLiquidityContext();

  const { address: accountAddress } = useAccount();
  const { chainId, networkMode } = useNetwork();

  // Get calculation data from TxContext (real liquidity math)
  const {
    dependentAmount: txDependentAmount,
    dependentField,
    isCalculating: txIsCalculating,
    inputError,
  } = useCreatePositionTxContext();

  // Chart ref for imperative actions (Uniswap pattern)
  const chartRef = useRef<D3LiquidityRangeChartHandle>(null);

  // Local state
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [priceInverted, setPriceInverted] = useState(false);
  const [amount0, setAmount0] = useState(state.amount0 || '');
  const [amount1, setAmount1] = useState(state.amount1 || '');
  const [isAmount0OverBalance, setIsAmount0OverBalance] = useState(false);
  const [isAmount1OverBalance, setIsAmount1OverBalance] = useState(false);
  const [chartDuration, setChartDuration] = useState<HistoryDuration>(HistoryDuration.MONTH);

  // Use isCalculating from TxContext
  const isCalculating = txIsCalculating;

  // Invalid range check (Uniswap pattern)
  const invalidRange = isInvalidRange(state.tickLower ?? undefined, state.tickUpper ?? undefined);

  // Loading states (Uniswap Deposit.tsx pattern)
  // requestLoading: true when calculation is in progress and we have amounts
  const requestLoading = Boolean(
    isCalculating &&
    !invalidRange &&
    (parseFloat(state.amount0 || '0') > 0 || parseFloat(state.amount1 || '0') > 0)
  );

  // Opposite field shows loading when user is typing in the other field
  // amount0Loading = requestLoading && inputSide === 'token1'
  // amount1Loading = requestLoading && inputSide === 'token0'
  const amount0Loading = requestLoading && state.inputSide === 'token1';
  const amount1Loading = requestLoading && state.inputSide === 'token0';

  // Disabled fields based on price range (Uniswap priceRangeInfo.ts pattern)
  // At range extremes, one token deposit may be disabled
  // NOTE: For Unified Yield (rehypo mode), both deposits are always enabled - the Hook handles allocation
  const { [PositionField.TOKEN0]: deposit0DisabledRaw, [PositionField.TOKEN1]: deposit1DisabledRaw } = useMemo(() => {
    return getFieldsDisabled({
      pool: sdkPool,
      ticks: [state.tickLower ?? undefined, state.tickUpper ?? undefined],
    });
  }, [sdkPool, state.tickLower, state.tickUpper]);

  // Pool and token data - now uses context (Uniswap pattern)
  const poolConfig = state.poolId ? getPoolById(state.poolId) : null;
  const isStablePool = poolConfig?.type === 'Stable';
  const isRehypoMode = state.mode === 'rehypo';

  // For Unified Yield, never disable deposit fields - users always provide both tokens
  const deposit0Disabled = isRehypoMode ? false : deposit0DisabledRaw;
  const deposit1Disabled = isRehypoMode ? false : deposit1DisabledRaw;

  // Animation controls
  const wiggleControls0 = useAnimation();
  const wiggleControls1 = useAnimation();

  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);

  const token0Symbol = poolConfig?.currency0.symbol as TokenSymbol | undefined;
  const token1Symbol = poolConfig?.currency1.symbol as TokenSymbol | undefined;
  const token0Def = token0Symbol ? tokenDefinitions[token0Symbol] : null;
  const token1Def = token1Symbol ? tokenDefinitions[token1Symbol] : null;

  // Current price from context (real on-chain data via usePoolState)
  const currentPriceRaw = poolStateData?.currentPrice || '1.00';
  const currentTick = poolStateData?.currentPoolTick;

  // For Unified Yield: Convert tick range from config to prices
  // rehypoRange stores tick values (e.g., min: "-276326", max: "-276324"), NOT prices
  const rehypoTickLower = poolConfig?.rehypoRange?.min ? parseInt(poolConfig.rehypoRange.min, 10) : null;
  const rehypoTickUpper = poolConfig?.rehypoRange?.max ? parseInt(poolConfig.rehypoRange.max, 10) : null;

  // Use the same hooks as ReviewExecuteModal for proper tick-to-price conversion
  // These hooks properly handle token decimal differences
  const FALLBACK_TOKEN0_ADDRESS = '0x0000000000000000000000000000000000000001';
  const FALLBACK_TOKEN1_ADDRESS = '0x0000000000000000000000000000000000000002';

  const rehypoPriceOrdering = usePriceOrdering({
    chainId,
    token0: {
      address: poolConfig?.currency0.address || FALLBACK_TOKEN0_ADDRESS,
      symbol: poolConfig?.currency0.symbol || 'TOKEN0',
      decimals: token0Def?.decimals ?? 18,
    },
    token1: {
      address: poolConfig?.currency1.address || FALLBACK_TOKEN1_ADDRESS,
      symbol: poolConfig?.currency1.symbol || 'TOKEN1',
      decimals: token1Def?.decimals ?? 18,
    },
    tickLower: rehypoTickLower ?? 0,
    tickUpper: rehypoTickUpper ?? 0,
  });

  const { minPrice: rehypoMinPriceFormatted, maxPrice: rehypoMaxPriceFormatted, isFullRange: rehypoIsFullRange } = useGetRangeDisplay({
    priceOrdering: rehypoPriceOrdering,
    pricesInverted: priceInverted,
    tickSpacing: poolConfig?.tickSpacing,
    tickLower: rehypoTickLower ?? 0,
    tickUpper: rehypoTickUpper ?? 0,
  });

  // Parse the formatted strings to numbers for chart usage
  const rehypoPriceRange = useMemo(() => {
    if (!isRehypoMode || rehypoTickLower === null || rehypoTickUpper === null) {
      return { minPrice: undefined, maxPrice: undefined, minPriceFormatted: undefined, maxPriceFormatted: undefined };
    }

    const minPriceNum = rehypoMinPriceFormatted && rehypoMinPriceFormatted !== '-' && rehypoMinPriceFormatted !== '∞'
      ? parseFloat(rehypoMinPriceFormatted.replace(/,/g, ''))
      : undefined;
    const maxPriceNum = rehypoMaxPriceFormatted && rehypoMaxPriceFormatted !== '-' && rehypoMaxPriceFormatted !== '∞'
      ? parseFloat(rehypoMaxPriceFormatted.replace(/,/g, ''))
      : undefined;

    return {
      minPrice: minPriceNum,
      maxPrice: maxPriceNum,
      minPriceFormatted: rehypoMinPriceFormatted,
      maxPriceFormatted: rehypoMaxPriceFormatted,
    };
  }, [isRehypoMode, rehypoTickLower, rehypoTickUpper, rehypoMinPriceFormatted, rehypoMaxPriceFormatted]);

  const subgraphPoolId = state.poolId ? (getPoolSubgraphId(state.poolId) || state.poolId) : undefined;

  // Fetch pre-transformed data for chart (handles inversion)
  // Pass SDK tokens for proper decimal handling in tick-to-price conversion
  const { liquidityData, isLoading: isLiquidityLoading } = useLiquidityChartData({
    poolId: state.poolId ?? undefined,
    priceInverted,
    token0: sdkPool?.token0,
    token1: sdkPool?.token1,
  });

  const { entries: priceChartEntries, loading: isPriceLoading } = usePoolPriceChartData({
    variables: {
      poolId: subgraphPoolId,
      token0: token0Symbol,
      token1: token1Symbol,
      duration: chartDuration,
    },
    priceInverted,
  });

  const chartCurrentPrice = useMemo(() => {
    const priceNum = parseFloat(currentPriceRaw);
    if (!isFinite(priceNum) || priceNum <= 0) return 1;
    return priceInverted ? (1 / priceNum) : priceNum;
  }, [currentPriceRaw, priceInverted]);

  // Price data for chart - includes fallback current price point when no historical data
  const priceData = useMemo(() => {
    const historicalData = priceChartEntries.map(e => ({ time: e.time, value: e.value }));

    // If we have historical data, use it
    if (historicalData.length > 0) {
      return historicalData;
    }

    // Fallback: create a single point with current price so chart can orient itself
    // This ensures the price line renderer has at least one point to work with
    if (chartCurrentPrice > 0) {
      const now = Math.floor(Date.now() / 1000);
      return [{ time: now, value: chartCurrentPrice }];
    }

    return [];
  }, [priceChartEntries, chartCurrentPrice]);

  // Format current price with proper decimals and inversion (Uniswap pattern)
  const formattedCurrentPrice = useMemo(() => {
    const priceNum = parseFloat(currentPriceRaw);
    if (!isFinite(priceNum) || priceNum <= 0) return '—';

    // Uniswap standard: currentPrice is token1/token0
    // When inverted, we want token0/token1 (1/price)
    const displayPrice = priceInverted ? (1 / priceNum) : priceNum;

    // Get appropriate decimals based on the denomination token
    const denomToken = priceInverted ? token0Symbol : token1Symbol;
    const displayDecimals = getDecimalsForDenomination(denomToken || '', poolConfig?.type);

    // Format with locale-aware number formatting
    return displayPrice.toLocaleString('en-US', {
      minimumFractionDigits: Math.min(2, displayDecimals),
      maximumFractionDigits: displayDecimals,
    });
  }, [currentPriceRaw, priceInverted, token0Symbol, token1Symbol, poolConfig?.type]);

  // Selected preset
  const selectedPreset = state.rangePreset || 'full';

  // Price denomination string (Uniswap pattern: "USDC per ETH")
  const priceDenomination = useMemo(() => {
    if (!token0Symbol || !token1Symbol) return '';
    // When inverted: show "token0 per token1" (e.g., "ETH per USDC")
    // When not inverted: show "token1 per token0" (e.g., "USDC per ETH")
    return priceInverted
      ? `${token0Symbol} per ${token1Symbol}`
      : `${token1Symbol} per ${token0Symbol}`;
  }, [token0Symbol, token1Symbol, priceInverted]);

  // Calculate percentage difference from current price (Uniswap pattern)
  const minPricePercent = useMemo(() => {
    if (minPrice === '0' || minPrice === '') return '-100.00%';
    const currentPriceNum = parseFloat(currentPriceRaw);
    const minPriceNum = parseFloat(minPrice);
    if (!isFinite(currentPriceNum) || !isFinite(minPriceNum) || currentPriceNum <= 0) return '—';

    // Calculate display price based on inversion
    const displayCurrentPrice = priceInverted ? (1 / currentPriceNum) : currentPriceNum;
    const percentDiff = ((minPriceNum - displayCurrentPrice) / displayCurrentPrice) * 100;

    if (!isFinite(percentDiff)) return '—';
    const sign = percentDiff >= 0 ? '+' : '';
    return `${sign}${percentDiff.toFixed(2)}%`;
  }, [minPrice, currentPriceRaw, priceInverted]);

  const maxPricePercent = useMemo(() => {
    if (maxPrice === '∞') return '∞';
    if (maxPrice === '' || maxPrice === '0') return '—';
    const currentPriceNum = parseFloat(currentPriceRaw);
    const maxPriceNum = parseFloat(maxPrice);
    if (!isFinite(currentPriceNum) || !isFinite(maxPriceNum) || currentPriceNum <= 0) return '—';

    // Calculate display price based on inversion
    const displayCurrentPrice = priceInverted ? (1 / currentPriceNum) : currentPriceNum;
    const percentDiff = ((maxPriceNum - displayCurrentPrice) / displayCurrentPrice) * 100;

    if (!isFinite(percentDiff)) return '—';
    const sign = percentDiff >= 0 ? '+' : '';
    return `${sign}${percentDiff.toFixed(2)}%`;
  }, [maxPrice, currentPriceRaw, priceInverted]);

  // Get balances
  const { data: token0BalanceData } = useBalance({
    address: accountAddress,
    token: token0Def?.address === "0x0000000000000000000000000000000000000000"
      ? undefined
      : token0Def?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!token0Def },
  });

  const { data: token1BalanceData } = useBalance({
    address: accountAddress,
    token: token1Def?.address === "0x0000000000000000000000000000000000000000"
      ? undefined
      : token1Def?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!token1Def },
  });

  // USD prices
  const { price: token0USDPrice } = useTokenUSDPrice(token0Symbol || null);
  const { price: token1USDPrice } = useTokenUSDPrice(token1Symbol || null);

  // Percentage input handlers
  const handleToken0Percentage = usePercentageInput(
    token0BalanceData,
    { decimals: token0Def?.decimals || 18, symbol: token0Symbol || '' },
    setAmount0
  );

  const handleToken1Percentage = usePercentageInput(
    token1BalanceData,
    { decimals: token1Def?.decimals || 18, symbol: token1Symbol || '' },
    setAmount1
  );

  // Helper: Convert tick to price using SDK (handles token decimals properly)
  // Uses consolidated tick-price utilities
  const tickToPrice = useCallback((tick: number): number | undefined => {
    // Use SDK-based conversion for proper decimal handling
    return tickToPriceNumber(tick, sdkPool?.token0, sdkPool?.token1);
  }, [sdkPool]);

  // Helper: Convert price to tick using SDK (handles token decimals properly)
  // This is the inverse of tickToPrice and must use the same decimal handling
  const priceToTick = useCallback((price: number): number | undefined => {
    // Use SDK-based conversion for proper decimal handling
    // This ensures round-trip consistency: tick -> price -> tick
    return priceNumberToTick(price, sdkPool?.token0, sdkPool?.token1);
  }, [sdkPool]);

  // Helper: Format price for display based on pool type and inversion
  const formatPriceForDisplay = useCallback((price: number, inverted: boolean = false): string => {
    // When inverted, the denomination token changes
    const denomToken = inverted ? token0Symbol : token1Symbol;
    const decimals = getDecimalsForDenomination(denomToken || '', poolConfig?.type);
    return price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: decimals,
      useGrouping: false,
    });
  }, [token0Symbol, token1Symbol, poolConfig?.type]);

  // Stable no-op callback for disabled chart (rehypo mode)
  const noopRangeChange = useCallback(() => {}, []);

  // Chart range change handler - must be memoized to prevent chart reinitialization
  // Uses SDK-based price-to-tick conversion for proper decimal handling
  const handleChartRangeChange = useCallback((newMinPrice: number, newMaxPrice: number) => {
    setRangePreset('custom');

    // Convert prices to ticks and update context
    // When inverted, prices are in inverted form (e.g., USDC/ETH instead of ETH/USDC)
    // We need canonical prices (token1/token0) for tick calculation
    let canonicalMinPrice: number;
    let canonicalMaxPrice: number;

    if (priceInverted) {
      canonicalMinPrice = 1 / newMaxPrice;
      canonicalMaxPrice = 1 / newMinPrice;
    } else {
      canonicalMinPrice = newMinPrice;
      canonicalMaxPrice = newMaxPrice;
    }

    // Convert prices to ticks using SDK (handles token decimals properly)
    // Falls back to simple calculation if SDK tokens not available
    let tickLower = priceToTick(canonicalMinPrice);
    let tickUpper = priceToTick(canonicalMaxPrice);

    if (tickLower === undefined || tickUpper === undefined) {
      // Fallback: use simple conversion
      tickLower = priceToTickSimple(canonicalMinPrice);
      tickUpper = priceToTickSimple(canonicalMaxPrice);
    }

    // Align to tick spacing using nearestUsableTick for proper alignment
    const tickSpacingVal = poolConfig?.tickSpacing || DEFAULT_TICK_SPACING;
    const alignedTickLower = nearestUsableTick(tickLower, tickSpacingVal);
    const alignedTickUpper = nearestUsableTick(tickUpper, tickSpacingVal);

    // Convert aligned ticks back to canonical prices
    const alignedPriceLower = tickToPrice(alignedTickLower);
    const alignedPriceUpper = tickToPrice(alignedTickUpper);

    // Guard: if pool not available yet, just set ticks without updating display prices
    if (alignedPriceLower === undefined || alignedPriceUpper === undefined) {
      setRange(alignedTickLower, alignedTickUpper);
      return;
    }

    // Update display with aligned prices (inverted if needed)
    if (priceInverted) {
      setMinPrice(formatPriceForDisplay(1 / alignedPriceUpper, true));
      setMaxPrice(formatPriceForDisplay(1 / alignedPriceLower, true));
    } else {
      setMinPrice(formatPriceForDisplay(alignedPriceLower, false));
      setMaxPrice(formatPriceForDisplay(alignedPriceUpper, false));
    }

    setRange(alignedTickLower, alignedTickUpper);
  }, [priceInverted, poolConfig?.tickSpacing, priceToTick, tickToPrice, formatPriceForDisplay, setRangePreset, setRange]);

  // Price strategy selection
  const handleSelectStrategy = useCallback((strategy: RangePreset) => {
    setRangePreset(strategy);

    if (strategy === 'full') {
      setMinPrice('0');
      setMaxPrice('∞');
      setRange(null, null);
      return;
    }

    if (strategy === 'custom') return;

    const tickSpacingVal = poolConfig?.tickSpacing || DEFAULT_TICK_SPACING;
    const poolCurrentTick = currentTick ?? 0;

    let tickLower: number;
    let tickUpper: number;

    switch (strategy) {
      case 'stable':
        // ±3 tick spacings from current tick
        tickLower = nearestUsableTick(poolCurrentTick - 3 * tickSpacingVal, tickSpacingVal);
        tickUpper = nearestUsableTick(poolCurrentTick + 3 * tickSpacingVal, tickSpacingVal);
        break;
      case 'wide':
        // -50% to +100%
        [tickLower, tickUpper] = calculateTicksFromPercentage(50, 100, poolCurrentTick, tickSpacingVal);
        break;
      case 'one_sided_lower':
        // -50% to one tick below current
        [tickLower] = calculateTicksFromPercentage(50, 0, poolCurrentTick, tickSpacingVal);
        tickUpper = nearestUsableTick(poolCurrentTick - tickSpacingVal, tickSpacingVal);
        break;
      case 'one_sided_upper':
        // One tick above current to +100%
        tickLower = nearestUsableTick(poolCurrentTick + tickSpacingVal, tickSpacingVal);
        [, tickUpper] = calculateTicksFromPercentage(0, 100, poolCurrentTick, tickSpacingVal);
        break;
      default:
        return;
    }

    // Ensure tickLower < tickUpper
    if (tickLower >= tickUpper) {
      tickUpper = tickLower + tickSpacingVal;
    }

    // Convert ticks to prices (Uniswap pattern: early return if pool not ready)
    const priceLower = tickToPrice(tickLower);
    const priceUpper = tickToPrice(tickUpper);

    // Guard: if pool not available yet, just set ticks without updating display prices
    if (priceLower === undefined || priceUpper === undefined) {
      setRange(tickLower, tickUpper);
      return;
    }

    // Set display prices (inverted if needed)
    if (priceInverted) {
      setMinPrice(formatPriceForDisplay(1 / priceUpper, true));
      setMaxPrice(formatPriceForDisplay(1 / priceLower, true));
    } else {
      setMinPrice(formatPriceForDisplay(priceLower, false));
      setMaxPrice(formatPriceForDisplay(priceUpper, false));
    }

    setRange(tickLower, tickUpper);
  }, [setRangePreset, setRange, currentTick, priceInverted, formatPriceForDisplay, poolConfig?.tickSpacing, tickToPrice]);

  // Token selection for price denomination - resets to Stable on switch
  const handleSelectToken = useCallback((token: string) => {
    const shouldInvert = token === token1Symbol;
    if (shouldInvert === priceInverted) return;

    setPriceInverted(shouldInvert);
    setRangePreset('stable');
  }, [token1Symbol, priceInverted, setRangePreset]);

  // Handle manual price input
  const handleMinPriceChange = useCallback((value: string) => {
    setMinPrice(value);
    setRangePreset('custom');
  }, [setRangePreset]);

  const handleMaxPriceChange = useCallback((value: string) => {
    setMaxPrice(value);
    setRangePreset('custom');
  }, [setRangePreset]);

  // Tick-based increment/decrement (Uniswap pattern)
  // @see interface/apps/web/src/state/mint/v3/hooks.tsx useRangeHopCallbacks
  const tickSpacing = poolConfig?.tickSpacing || DEFAULT_TICK_SPACING;

  // isSorted determines if we need to swap increment/decrement for inverted display
  // When not sorted (inverted), left input controls upper tick, right input controls lower tick
  const isSorted = !priceInverted;

  // Get the 4 tick navigation functions from hook
  // Pass SDK pool tokens for proper decimal handling in tick-to-price conversion
  const {
    getDecrementLower,
    getIncrementLower,
    getDecrementUpper,
    getIncrementUpper,
  } = useRangeHopCallbacks({
    tickLower: state.tickLower,
    tickUpper: state.tickUpper,
    tickSpacing,
    poolCurrentTick: currentTick ?? undefined,
    token0: sdkPool?.token0,
    token1: sdkPool?.token1,
  });

  // Helper: Convert canonical price to display price (inverts if needed)
  // useRangeHopCallbacks returns canonical prices (from tick), but when inverted we need to display 1/price
  const toDisplayPrice = useCallback((canonicalPrice: string): string => {
    if (!priceInverted) return canonicalPrice;
    const price = parseFloat(canonicalPrice);
    if (!isFinite(price) || price === 0) return canonicalPrice;
    return formatPriceForDisplay(1 / price, true);
  }, [priceInverted, formatPriceForDisplay]);

  // Left input (min price) handlers - swap based on isSorted (Uniswap RangeSelector pattern)
  // When inverted (isSorted=false): min input controls tickUpper, prices need inversion
  const incrementMinPrice = useCallback(() => {
    const canonicalPrice = isSorted ? getIncrementLower() : getDecrementUpper();
    if (canonicalPrice) {
      setMinPrice(toDisplayPrice(canonicalPrice));
      setRangePreset('custom');
      // Update tick in context
      const newTick = isSorted
        ? (state.tickLower ?? 0) + tickSpacing
        : (state.tickUpper ?? 0) - tickSpacing;
      if (isSorted) {
        setRange(newTick, state.tickUpper);
      } else {
        setRange(state.tickLower, newTick);
      }
    }
  }, [isSorted, getIncrementLower, getDecrementUpper, setRangePreset, state.tickLower, state.tickUpper, tickSpacing, setRange, toDisplayPrice]);

  const decrementMinPrice = useCallback(() => {
    const canonicalPrice = isSorted ? getDecrementLower() : getIncrementUpper();
    if (canonicalPrice) {
      setMinPrice(toDisplayPrice(canonicalPrice));
      setRangePreset('custom');
      // Update tick in context
      const newTick = isSorted
        ? (state.tickLower ?? 0) - tickSpacing
        : (state.tickUpper ?? 0) + tickSpacing;
      if (isSorted) {
        setRange(newTick, state.tickUpper);
      } else {
        setRange(state.tickLower, newTick);
      }
    }
  }, [isSorted, getDecrementLower, getIncrementUpper, setRangePreset, state.tickLower, state.tickUpper, tickSpacing, setRange, toDisplayPrice]);

  // Right input (max price) handlers - swap based on isSorted
  // When inverted (isSorted=false): max input controls tickLower, prices need inversion
  const incrementMaxPrice = useCallback(() => {
    if (maxPrice === '∞') return;
    const canonicalPrice = isSorted ? getIncrementUpper() : getDecrementLower();
    if (canonicalPrice) {
      setMaxPrice(toDisplayPrice(canonicalPrice));
      setRangePreset('custom');
      // Update tick in context
      const newTick = isSorted
        ? (state.tickUpper ?? 0) + tickSpacing
        : (state.tickLower ?? 0) - tickSpacing;
      if (isSorted) {
        setRange(state.tickLower, newTick);
      } else {
        setRange(newTick, state.tickUpper);
      }
    }
  }, [maxPrice, isSorted, getIncrementUpper, getDecrementLower, setRangePreset, state.tickLower, state.tickUpper, tickSpacing, setRange, toDisplayPrice]);

  const decrementMaxPrice = useCallback(() => {
    if (maxPrice === '∞') {
      // Convert from infinity to a finite high price
      const highPrice = parseFloat(currentPriceRaw) * 10;
      setMaxPrice(formatPriceForDisplay(priceInverted ? 1 / highPrice : highPrice, priceInverted));
      setRangePreset('custom');
      return;
    }
    const canonicalPrice = isSorted ? getDecrementUpper() : getIncrementLower();
    if (canonicalPrice) {
      setMaxPrice(toDisplayPrice(canonicalPrice));
      setRangePreset('custom');
      // Update tick in context
      const newTick = isSorted
        ? (state.tickUpper ?? 0) - tickSpacing
        : (state.tickLower ?? 0) + tickSpacing;
      if (isSorted) {
        setRange(state.tickLower, newTick);
      } else {
        setRange(newTick, state.tickUpper);
      }
    }
  }, [maxPrice, isSorted, getDecrementUpper, getIncrementLower, currentPriceRaw, formatPriceForDisplay, priceInverted, setRangePreset, state.tickLower, state.tickUpper, tickSpacing, setRange, toDisplayPrice]);

  // Blur handlers - snap typed price to nearest valid tick (Uniswap pattern)
  // Converts price → tick → nearest usable tick → price, then updates display and context
  // IMPORTANT: Uses SDK-based conversions for proper decimal handling (priceToTick + tickToPrice)
  const handleMinPriceBlur = useCallback(() => {
    if (minPrice === '' || minPrice === '0') return;

    const typedPrice = parseFloat(minPrice);
    if (!isFinite(typedPrice) || typedPrice <= 0) return;

    // Convert display price to canonical price (undo inversion if needed)
    // Canonical price is always token1/token0 (quote/base)
    const canonicalPrice = priceInverted ? (1 / typedPrice) : typedPrice;

    // Convert price to tick using SDK (handles token decimals properly)
    // Falls back to simple calculation if SDK tokens not available
    let rawTick = priceToTick(canonicalPrice);
    if (rawTick === undefined) {
      // Fallback: use simple conversion (may cause display discrepancies with different decimals)
      rawTick = priceToTickSimple(canonicalPrice);
    }

    // Snap to nearest usable tick
    const alignedTick = nearestUsableTick(rawTick, tickSpacing);

    // Convert aligned tick back to price using SDK for display
    const alignedPrice = tickToPrice(alignedTick);
    if (alignedPrice === undefined) return;

    // Update display (inverted if needed)
    const displayPrice = priceInverted ? (1 / alignedPrice) : alignedPrice;
    setMinPrice(formatPriceForDisplay(displayPrice, priceInverted));

    // Update context tick
    // When inverted, min price input controls tickUpper; otherwise tickLower
    if (priceInverted) {
      setRange(state.tickLower, alignedTick);
    } else {
      setRange(alignedTick, state.tickUpper);
    }
  }, [minPrice, priceInverted, tickSpacing, priceToTick, tickToPrice, formatPriceForDisplay, setRange, state.tickLower, state.tickUpper]);

  const handleMaxPriceBlur = useCallback(() => {
    if (maxPrice === '' || maxPrice === '∞') return;

    const typedPrice = parseFloat(maxPrice);
    if (!isFinite(typedPrice) || typedPrice <= 0) return;

    // Convert display price to canonical price (undo inversion if needed)
    // Canonical price is always token1/token0 (quote/base)
    const canonicalPrice = priceInverted ? (1 / typedPrice) : typedPrice;

    // Convert price to tick using SDK (handles token decimals properly)
    // Falls back to simple calculation if SDK tokens not available
    let rawTick = priceToTick(canonicalPrice);
    if (rawTick === undefined) {
      // Fallback: use simple conversion (may cause display discrepancies with different decimals)
      rawTick = priceToTickSimple(canonicalPrice);
    }

    // Snap to nearest usable tick
    const alignedTick = nearestUsableTick(rawTick, tickSpacing);

    // Convert aligned tick back to price using SDK for display
    const alignedPrice = tickToPrice(alignedTick);
    if (alignedPrice === undefined) return;

    // Update display (inverted if needed)
    const displayPrice = priceInverted ? (1 / alignedPrice) : alignedPrice;
    setMaxPrice(formatPriceForDisplay(displayPrice, priceInverted));

    // Update context tick
    // When inverted, max price input controls tickLower; otherwise tickUpper
    if (priceInverted) {
      setRange(alignedTick, state.tickUpper);
    } else {
      setRange(state.tickLower, alignedTick);
    }
  }, [maxPrice, priceInverted, tickSpacing, priceToTick, tickToPrice, formatPriceForDisplay, setRange, state.tickLower, state.tickUpper]);

  // Handle amount changes - sync to context for real calculation via TxContext
  const handleAmount0Change = useCallback((value: string) => {
    setAmount0(value);
    setInputSide('token0');
    // Sync to context immediately so TxContext can calculate
    setAmounts(value, amount1);
  }, [setInputSide, setAmounts, amount1]);

  const handleAmount1Change = useCallback((value: string) => {
    setAmount1(value);
    setInputSide('token1');
    // Sync to context immediately so TxContext can calculate
    setAmounts(amount0, value);
  }, [setInputSide, setAmounts, amount0]);

  // Sync dependent amount from TxContext to local state when calculated
  useEffect(() => {
    if (!txDependentAmount || !dependentField) return;

    // Only update the dependent field (not the one user is typing in)
    if (dependentField === 'amount1' && state.inputSide === 'token0') {
      setAmount1(txDependentAmount);
    } else if (dependentField === 'amount0' && state.inputSide === 'token1') {
      setAmount0(txDependentAmount);
    }
  }, [txDependentAmount, dependentField, state.inputSide]);

  // Handle review button click
  const handleReview = useCallback(() => {
    setAmounts(amount0, amount1);
    openReviewModal();
  }, [amount0, amount1, setAmounts, openReviewModal]);

  // Track over-balance state
  useEffect(() => {
    const amt0 = parseFloat(amount0 || "0");
    const balance0 = parseFloat(token0BalanceData?.formatted || "0");
    setIsAmount0OverBalance(amt0 > balance0 && amt0 > 0);
  }, [amount0, token0BalanceData]);

  useEffect(() => {
    const amt1 = parseFloat(amount1 || "0");
    const balance1 = parseFloat(token1BalanceData?.formatted || "0");
    setIsAmount1OverBalance(amt1 > balance1 && amt1 > 0);
  }, [amount1, token1BalanceData]);

  // Initialize range for Unified Yield (separate effect to avoid loops)
  const rehypoRangeSet = useRef(false);
  useEffect(() => {
    if (isRehypoMode && rehypoTickLower !== null && rehypoTickUpper !== null && !rehypoRangeSet.current) {
      rehypoRangeSet.current = true;
      setRange(rehypoTickLower, rehypoTickUpper);
    }
    // Reset ref when mode changes away from rehypo
    if (!isRehypoMode) {
      rehypoRangeSet.current = false;
    }
  }, [isRehypoMode, rehypoTickLower, rehypoTickUpper, setRange]);

  // Initialize with stable strategy for Custom Range mode
  // Runs when: not rehypo mode, no range set yet, and either liquidity data loaded or loading completed (testnet may have no data)
  const rangeInitialized = useRef(false);
  useEffect(() => {
    if (!isRehypoMode && !minPrice && !maxPrice && !rangeInitialized.current && sdkPool) {
      // Wait for liquidity data if loading, otherwise initialize immediately (testnet fallback)
      if (liquidityData.length > 0 || !isLiquidityLoading) {
        rangeInitialized.current = true;
        handleSelectStrategy('stable');
      }
    }
    // Reset ref when switching to rehypo mode
    if (isRehypoMode) {
      rangeInitialized.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liquidityData.length, isLiquidityLoading, sdkPool, isRehypoMode]); // Run when data loads OR loading finishes

  // Re-apply strategy when inversion changes (for Custom Range mode only)
  const prevPriceInverted = useRef(priceInverted);
  useEffect(() => {
    // Only re-apply for Custom Range mode when inversion changes
    if (!isRehypoMode && prevPriceInverted.current !== priceInverted && sdkPool) {
      handleSelectStrategy(selectedPreset as RangePreset);
      prevPriceInverted.current = priceInverted;
    }
  }, [priceInverted, sdkPool, selectedPreset, handleSelectStrategy, isRehypoMode]);

  // Validation
  const isValidRange = useMemo(() => {
    // Unified Yield: Range is always valid (pre-configured from pool config)
    if (isRehypoMode) return rehypoTickLower !== null && rehypoTickUpper !== null;
    if (selectedPreset === 'full') return true;
    if (minPrice === '0' || maxPrice === '∞') return true;
    const min = parseFloat(minPrice);
    const max = parseFloat(maxPrice);
    return !isNaN(min) && !isNaN(max) && min < max && min >= 0;
  }, [isRehypoMode, rehypoTickLower, rehypoTickUpper, selectedPreset, minPrice, maxPrice]);

  const hasValidAmount = useMemo(() => {
    const amt0Valid = !deposit0Disabled && amount0 && parseFloat(amount0) > 0;
    const amt1Valid = !deposit1Disabled && amount1 && parseFloat(amount1) > 0;
    // Need at least one valid amount, and if a field is enabled it must have a value
    if (deposit0Disabled) return amt1Valid;
    if (deposit1Disabled) return amt0Valid;
    return amt0Valid && amt1Valid;
  }, [amount0, amount1, deposit0Disabled, deposit1Disabled]);

  const hasInsufficientBalance = isAmount0OverBalance || isAmount1OverBalance;
  const canReview = isValidRange && hasValidAmount && !hasInsufficientBalance && !isCalculating && !inputError;

  if (!poolConfig) {
    return null;
  }

  return (
    <Container>
      <TokenInputStyles />

      {/* Back button */}
      <button
        onClick={goBack}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-md px-2 py-1 -ml-2 w-fit transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Back
      </button>

      {/* Section 1: Range Selection (collapsed for rehypo mode) */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-white">Position Range</h2>
          <p className="text-sm text-muted-foreground">
            Set the price range for your {poolConfig.currency0.symbol}/{poolConfig.currency1.symbol} position
          </p>
        </div>

        {/* Current Price with Token Selector */}
        <CurrentPriceDisplay
          price={formattedCurrentPrice}
          token0Symbol={poolConfig.currency0.symbol}
          token1Symbol={poolConfig.currency1.symbol}
          inverted={priceInverted}
          onSelectToken={handleSelectToken}
        />

        {/* Unified Yield info - show immediately after current price for visibility */}
        {isRehypoMode && (
          <div className="flex flex-row items-center gap-3 p-3 rounded-lg bg-white/5 border border-transparent hover:border-muted-foreground/30 transition-colors">
            <IconCircleInfo className="w-5 h-5 text-muted-foreground shrink-0" />
            <span className="text-sm text-muted-foreground">
              {poolConfig.rehypoRange?.isFullRange
                ? 'Full range position for maximum Aave lending yield'
                : 'Unified Yield uses an optimized range to offer lending yield'}
            </span>
          </div>
        )}

        {/* D3 Interactive Range Chart - show chart OR skeleton (Uniswap pattern) */}
        {/* Show skeleton only while actively loading; once done, show chart (even without data on testnet) */}
        <div className={cn(
          "border border-sidebar-border rounded-lg overflow-hidden",
          isRehypoMode && "opacity-60 pointer-events-none"
        )}>
          {(!isLiquidityLoading || isRehypoMode || liquidityData.length > 0) ? (
            <>
            <D3LiquidityRangeChart
              ref={chartRef}
              liquidityData={liquidityData}
              priceData={priceData}
              currentPrice={chartCurrentPrice}
              currentTick={currentTick ?? undefined}
              minPrice={isRehypoMode
                ? (poolConfig.rehypoRange?.isFullRange || rehypoIsFullRange ? undefined : rehypoPriceRange.minPrice)
                : (minPrice !== '' && minPrice !== '0' ? parseFloat(minPrice) : undefined)
              }
              maxPrice={isRehypoMode
                ? (poolConfig.rehypoRange?.isFullRange || rehypoIsFullRange ? undefined : rehypoPriceRange.maxPrice)
                : (maxPrice !== '' && maxPrice !== '∞' ? parseFloat(maxPrice) : undefined)
              }
              isFullRange={isRehypoMode ? (poolConfig.rehypoRange?.isFullRange ?? rehypoIsFullRange ?? true) : selectedPreset === 'full'}
              duration={chartDuration}
              onRangeChange={isRehypoMode ? noopRangeChange : handleChartRangeChange}
            />
            {/* Action buttons below chart */}
            {!isRehypoMode && (
              <LiquidityRangeActionButtons
                selectedDuration={chartDuration}
                onDurationChange={setChartDuration}
                onZoomIn={() => chartRef.current?.zoomIn()}
                onZoomOut={() => chartRef.current?.zoomOut()}
                onCenterRange={() => chartRef.current?.centerRange()}
                onReset={() => chartRef.current?.reset()}
                isFullRange={selectedPreset === 'full'}
              />
            )}
          </>
          ) : (
            <LiquidityChartSkeleton height={CHART_DIMENSIONS.CHART_HEIGHT + CHART_DIMENSIONS.TIMESCALE_HEIGHT} />
          )}
        </div>

        {/* Min/Max Price Inputs - show in both modes, disabled in Rehypo */}
        <div className={cn(
          "border border-sidebar-border rounded-lg overflow-hidden",
          isRehypoMode && "opacity-60"
        )}>
          <div className="flex flex-row">
            <RangeInput
              label="Min"
              percentFromCurrent={isRehypoMode ? '—' : minPricePercent}
              value={isRehypoMode
                ? (rehypoPriceRange.minPriceFormatted || '—')
                : minPrice}
              onChange={handleMinPriceChange}
              onBlur={handleMinPriceBlur}
              onIncrement={incrementMinPrice}
              onDecrement={decrementMinPrice}
              disabled={isRehypoMode || selectedPreset === 'full'}
              position="left"
            />
            <RangeInput
              label="Max"
              percentFromCurrent={isRehypoMode ? '—' : maxPricePercent}
              value={isRehypoMode
                ? (rehypoPriceRange.maxPriceFormatted || '—')
                : maxPrice}
              onChange={handleMaxPriceChange}
              onBlur={handleMaxPriceBlur}
              onIncrement={incrementMaxPrice}
              onDecrement={decrementMaxPrice}
              disabled={isRehypoMode || selectedPreset === 'full'}
              position="right"
            />
          </div>
        </div>

        {/* Concentrated mode only: Invalid range warning & Price strategies */}
        {!isRehypoMode && (
          <>
            {/* Invalid range warning */}
            {!isValidRange && selectedPreset !== 'full' && (
              <div className="flex flex-row items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-transparent hover:border-red-500/30 transition-colors">
                <IconTriangleWarningFilled className="w-5 h-5 text-red-500 shrink-0" />
                <span className="text-sm text-red-500">Invalid range selected</span>
              </div>
            )}

            {/* Price Strategies (below inputs - Uniswap-aligned) */}
            <div className="flex flex-col gap-4">
              <span className="text-sm font-medium text-muted-foreground">
                Price strategies
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {PRICE_STRATEGIES.map(strategy => (
                  <PriceStrategyButton
                    key={strategy.id}
                    strategy={strategy}
                    selected={selectedPreset === strategy.id}
                    onSelect={() => handleSelectStrategy(strategy.id)}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-sidebar-border/40 my-2" />

      {/* Section 2: Deposit Amounts */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-white">Deposit Amounts</h2>
          <p className="text-sm text-muted-foreground">
            Enter how much liquidity to provide
          </p>
        </div>

        {/* Token inputs */}
        <div className="flex flex-col gap-3">
          <TokenInputCard
            id="wizard-amount0"
            tokenSymbol={poolConfig.currency0.symbol}
            value={amount0}
            onChange={handleAmount0Change}
            label="Add"
            maxAmount={token0BalanceData?.formatted || "0"}
            usdPrice={token0USDPrice || 0}
            formatUsdAmount={formatCalculatedAmount}
            isOverBalance={isAmount0OverBalance}
            isLoading={amount0Loading}
            animationControls={wiggleControls0}
            onPercentageClick={(percentage) => handleToken0Percentage(percentage)}
            disabled={deposit0Disabled}
          />

          {/* Token 1 Input */}
          {!deposit1Disabled && (
            <TokenInputCard
              id="wizard-amount1"
              tokenSymbol={poolConfig.currency1.symbol}
              value={amount1}
              onChange={handleAmount1Change}
              label="Add"
              maxAmount={token1BalanceData?.formatted || "0"}
              usdPrice={token1USDPrice || 0}
              formatUsdAmount={formatCalculatedAmount}
              isOverBalance={isAmount1OverBalance}
              isLoading={amount1Loading}
              animationControls={wiggleControls1}
              onPercentageClick={(percentage) => handleToken1Percentage(percentage)}
              disabled={deposit1Disabled}
            />
          )}
        </div>

        {/* Insufficient balance warning */}
        {hasInsufficientBalance && (
          <div className="flex flex-row items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-transparent hover:border-red-500/30 transition-colors">
            <IconTriangleWarningFilled className="w-5 h-5 text-red-500 shrink-0" />
            <span className="text-sm text-red-500">Insufficient balance for this deposit</span>
          </div>
        )}
      </div>

      {/* Review button */}
      <Button
        onClick={handleReview}
        disabled={!canReview}
        className={cn(
          "w-full h-11",
          !canReview
            ? "relative border border-sidebar-border bg-button text-sm font-medium transition-all duration-200 overflow-hidden !opacity-100 text-white/75"
            : "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
        )}
        style={!canReview ? { backgroundImage: 'url(/patterns/button-wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        Review
      </Button>
    </Container>
  );
}
