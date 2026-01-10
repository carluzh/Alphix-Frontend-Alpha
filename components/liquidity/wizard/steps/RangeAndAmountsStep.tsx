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
import Image from 'next/image';
import { ChevronLeft } from 'lucide-react';
import { IconCircleInfo, IconTriangleWarningFilled } from 'nucleo-micro-bold-essential';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAccount, useBalance } from 'wagmi';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';

import { useAddLiquidityContext } from '../AddLiquidityContext';
import { useCreatePositionTxContext } from '../CreatePositionTxContext';
import { Container } from '../shared/Container';
import { RangePreset } from '../types';
import { getPoolById, getTokenDefinitions, getToken, TokenSymbol } from '@/lib/pools-config';
import { useNetwork } from '@/lib/network-context';
import { getDecimalsForDenomination } from '@/lib/denomination-utils';
import { usePercentageInput } from '@/hooks/usePercentageInput';
import { useTokenUSDPrice } from '@/hooks/useTokenUSDPrice';
import { useRangeHopCallbacks } from '@/hooks/useRangeHopCallbacks';
import { TokenInputCard, TokenInputStyles } from '@/components/liquidity/TokenInputCard';
import { formatCalculatedAmount } from '@/components/liquidity/liquidity-form-utils';
import { calculateTicksFromPercentage, getFieldsDisabled, PositionField, isInvalidRange } from '@/lib/liquidity/utils/calculations';
import { nearestUsableTick } from '@uniswap/v3-sdk';
import { D3LiquidityRangeChart, LiquidityRangeActionButtons, LiquidityChartSkeleton, CHART_DIMENSIONS, type D3LiquidityRangeChartHandle } from '@/components/liquidity/d3-chart';
import { HistoryDuration, usePoolPriceChartData } from '@/lib/chart';
import { useLiquidityChartData } from '@/hooks/useLiquidityChartData';
import { getPoolSubgraphId } from '@/lib/pools-config';

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
    title: 'Stable',
    display: '± 3 ticks',
    description: 'Good for stablecoins or low volatility pairs',
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

// Animation config for Deposit/Zap tab content switching (matches PointsTabsSection)
const SLIDE_DISTANCE = 20;
const SPRING_CONFIG = {
  type: "spring" as const,
  damping: 75,
  stiffness: 1000,
  mass: 1.4,
};

// Track previous value for animation direction
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

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

// Token selector pill for price denomination (Uniswap pattern)
interface TokenSelectorPillProps {
  token0Symbol: string;
  token1Symbol: string;
  selectedToken: string;
  onSelectToken: (token: string) => void;
}

function TokenSelectorPill({ token0Symbol, token1Symbol, selectedToken, onSelectToken }: TokenSelectorPillProps) {
  const token0Icon = getToken(token0Symbol)?.icon || '/placeholder-logo.svg';
  const token1Icon = getToken(token1Symbol)?.icon || '/placeholder-logo.svg';

  return (
    <div className="flex flex-row rounded-full border border-sidebar-border bg-surface p-1">
      <button
        onClick={() => onSelectToken(token0Symbol)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all',
          selectedToken === token0Symbol
            ? 'bg-sidebar-accent text-white'
            : 'bg-transparent text-muted-foreground hover:text-white'
        )}
      >
        <Image
          src={token0Icon}
          alt={token0Symbol}
          width={18}
          height={18}
          className="rounded-full"
        />
        {token0Symbol}
      </button>
      <button
        onClick={() => onSelectToken(token1Symbol)}
        className={cn(
          'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all',
          selectedToken === token1Symbol
            ? 'bg-sidebar-accent text-white'
            : 'bg-transparent text-muted-foreground hover:text-white'
        )}
      >
        <Image
          src={token1Icon}
          alt={token1Symbol}
          width={18}
          height={18}
          className="rounded-full"
        />
        {token1Symbol}
      </button>
    </div>
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
      <TokenSelectorPill
        token0Symbol={token0Symbol}
        token1Symbol={token1Symbol}
        selectedToken={selectedToken}
        onSelectToken={onSelectToken}
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
    setZapMode,
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

  // Track zap mode for animation direction (Deposit = index 0, Zap = index 1)
  const previousZapMode = usePrevious(state.isZapMode);
  const zapAnimationDirection = useMemo(() => {
    if (previousZapMode === undefined) return 'fade' as const;
    if (state.isZapMode && !previousZapMode) return 'forward' as const; // Deposit -> Zap
    if (!state.isZapMode && previousZapMode) return 'backward' as const; // Zap -> Deposit
    return 'fade' as const;
  }, [state.isZapMode, previousZapMode]);

  // Animation offsets based on direction
  const zapEnterOffset = zapAnimationDirection === 'forward' ? SLIDE_DISTANCE : zapAnimationDirection === 'backward' ? -SLIDE_DISTANCE : 0;
  const zapExitOffset = zapAnimationDirection === 'forward' ? -SLIDE_DISTANCE : zapAnimationDirection === 'backward' ? SLIDE_DISTANCE : 0;

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
  const { [PositionField.TOKEN0]: deposit0Disabled, [PositionField.TOKEN1]: deposit1Disabled } = useMemo(() => {
    return getFieldsDisabled({
      pool: sdkPool,
      ticks: [state.tickLower ?? undefined, state.tickUpper ?? undefined],
    });
  }, [sdkPool, state.tickLower, state.tickUpper]);

  // Animation controls
  const wiggleControls0 = useAnimation();
  const wiggleControls1 = useAnimation();

  // Pool and token data - now uses context (Uniswap pattern)
  const poolConfig = state.poolId ? getPoolById(state.poolId) : null;
  const isStablePool = poolConfig?.type === 'Stable';
  const isRehypoMode = state.mode === 'rehypo';
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);

  const token0Symbol = poolConfig?.currency0.symbol as TokenSymbol | undefined;
  const token1Symbol = poolConfig?.currency1.symbol as TokenSymbol | undefined;
  const token0Def = token0Symbol ? tokenDefinitions[token0Symbol] : null;
  const token1Def = token1Symbol ? tokenDefinitions[token1Symbol] : null;

  // Current price from context (real on-chain data via usePoolState)
  const currentPriceRaw = poolStateData?.currentPrice || '1.00';
  const currentTick = poolStateData?.currentPoolTick;

  const subgraphPoolId = state.poolId ? (getPoolSubgraphId(state.poolId) || state.poolId) : undefined;

  // Fetch pre-transformed data for chart (handles inversion)
  const { liquidityData, isLoading: isLiquidityLoading } = useLiquidityChartData({
    poolId: state.poolId ?? undefined,
    priceInverted,
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

  const priceData = useMemo(() => {
    return priceChartEntries.map(e => ({ time: e.time, value: e.value }));
  }, [priceChartEntries]);

  const chartCurrentPrice = useMemo(() => {
    const priceNum = parseFloat(currentPriceRaw);
    if (!isFinite(priceNum) || priceNum <= 0) return 1;
    return priceInverted ? (1 / priceNum) : priceNum;
  }, [currentPriceRaw, priceInverted]);

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

  // Helper: Convert tick to price (price = 1.0001^tick)
  const tickToPrice = useCallback((tick: number): number => {
    return Math.pow(1.0001, tick);
  }, []);

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

    const tickSpacingVal = poolConfig?.tickSpacing || 10;
    const poolCurrentTick = currentTick ?? 0;
    const tickToPrice = (tick: number) => Math.pow(1.0001, tick);
    const tickFromPrice = (price: number) => Math.round(Math.log(price) / Math.log(1.0001));

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

    // Convert ticks to prices
    const priceLower = tickToPrice(tickLower);
    const priceUpper = tickToPrice(tickUpper);

    // Set display prices (inverted if needed)
    if (priceInverted) {
      setMinPrice(formatPriceForDisplay(1 / priceUpper, true));
      setMaxPrice(formatPriceForDisplay(1 / priceLower, true));
    } else {
      setMinPrice(formatPriceForDisplay(priceLower, false));
      setMaxPrice(formatPriceForDisplay(priceUpper, false));
    }

    setRange(tickLower, tickUpper);
  }, [setRangePreset, setRange, currentTick, priceInverted, formatPriceForDisplay, poolConfig?.tickSpacing]);

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
  const tickSpacing = poolConfig?.tickSpacing || 10;

  // isSorted determines if we need to swap increment/decrement for inverted display
  // When not sorted (inverted), left input controls upper tick, right input controls lower tick
  const isSorted = !priceInverted;

  // Get the 4 tick navigation functions from hook
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

  // Handle amount changes - sync to context for real calculation via TxContext
  const handleAmount0Change = useCallback((value: string) => {
    setAmount0(value);
    setInputSide('token0');
    // Sync to context immediately so TxContext can calculate
    setAmounts(value, state.isZapMode ? '' : amount1);
  }, [setInputSide, setAmounts, state.isZapMode, amount1]);

  const handleAmount1Change = useCallback((value: string) => {
    setAmount1(value);
    setInputSide('token1');
    // Sync to context immediately so TxContext can calculate
    setAmounts(state.isZapMode ? '' : amount0, value);
  }, [setInputSide, setAmounts, state.isZapMode, amount0]);

  // Sync dependent amount from TxContext to local state when calculated
  useEffect(() => {
    // Skip sync in zap mode (no dependent amount needed)
    if (state.isZapMode) return;
    if (!txDependentAmount || !dependentField) return;

    // Only update the dependent field (not the one user is typing in)
    if (dependentField === 'amount1' && state.inputSide === 'token0') {
      setAmount1(txDependentAmount);
    } else if (dependentField === 'amount0' && state.inputSide === 'token1') {
      setAmount0(txDependentAmount);
    }
  }, [txDependentAmount, dependentField, state.inputSide, state.isZapMode]);

  // Handle zap mode toggle
  const handleZapModeToggle = useCallback((enabled: boolean) => {
    setZapMode(enabled);
    if (enabled) {
      if (state.inputSide === 'token0') {
        setAmount1('');
      } else {
        setAmount0('');
      }
    }
  }, [setZapMode, state.inputSide]);

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

  // Initialize with stable strategy when data loads
  useEffect(() => {
    if (!minPrice && !maxPrice && liquidityData.length > 0) {
      handleSelectStrategy('stable');
    }
  }, [liquidityData.length]);

  // Re-apply strategy when inversion changes
  const prevPriceInverted = useRef(priceInverted);
  useEffect(() => {
    if (prevPriceInverted.current !== priceInverted && liquidityData.length > 0) {
      handleSelectStrategy(selectedPreset as RangePreset);
      prevPriceInverted.current = priceInverted;
    }
  }, [priceInverted, liquidityData, selectedPreset, handleSelectStrategy]);

  // Validation
  const isValidRange = useMemo(() => {
    if (selectedPreset === 'full') return true;
    if (minPrice === '0' || maxPrice === '∞') return true;
    const min = parseFloat(minPrice);
    const max = parseFloat(maxPrice);
    return !isNaN(min) && !isNaN(max) && min < max && min >= 0;
  }, [selectedPreset, minPrice, maxPrice]);

  const hasValidAmount = useMemo(() => {
    if (state.isZapMode) {
      return (amount0 && parseFloat(amount0) > 0) || (amount1 && parseFloat(amount1) > 0);
    }
    return (amount0 && parseFloat(amount0) > 0) && (amount1 && parseFloat(amount1) > 0);
  }, [amount0, amount1, state.isZapMode]);

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
        <div className={cn(
          "border border-sidebar-border rounded-lg overflow-hidden",
          isRehypoMode && "opacity-60 pointer-events-none"
        )}>
          {liquidityData.length > 0 ? (
            <>
            <D3LiquidityRangeChart
              ref={chartRef}
              liquidityData={liquidityData}
              priceData={priceData}
              currentPrice={chartCurrentPrice}
              currentTick={currentTick ?? undefined}
              minPrice={isRehypoMode
                ? (poolConfig.rehypoRange?.isFullRange ? undefined : parseFloat(poolConfig.rehypoRange?.min || '0'))
                : (minPrice !== '' && minPrice !== '0' ? parseFloat(minPrice) : undefined)
              }
              maxPrice={isRehypoMode
                ? (poolConfig.rehypoRange?.isFullRange ? undefined : parseFloat(poolConfig.rehypoRange?.max || '0'))
                : (maxPrice !== '' && maxPrice !== '∞' ? parseFloat(maxPrice) : undefined)
              }
              isFullRange={isRehypoMode ? (poolConfig.rehypoRange?.isFullRange ?? true) : selectedPreset === 'full'}
              duration={chartDuration}
              onRangeChange={isRehypoMode ? () => {} : (newMinPrice, newMaxPrice) => {
              // Update display prices
              setMinPrice(formatPriceForDisplay(newMinPrice, priceInverted));
              setMaxPrice(formatPriceForDisplay(newMaxPrice, priceInverted));
              setRangePreset('custom');

              // Convert prices to ticks and update context
              // When inverted, prices are in inverted form (e.g., USDC/ETH instead of ETH/USDC)
              // We need canonical prices (token1/token0) for tick calculation
              // Canonical price = 1.0001^tick => tick = log(price) / log(1.0001)
              const tickFromPrice = (price: number) => Math.round(Math.log(price) / Math.log(1.0001));

              // When inverted: lower display price = higher canonical price, so swap min/max
              // Also convert inverted prices back to canonical: canonical = 1/inverted
              let canonicalMinPrice: number;
              let canonicalMaxPrice: number;

              if (priceInverted) {
                // Inverted: newMinPrice is the lower inverted price (higher canonical)
                // newMaxPrice is the higher inverted price (lower canonical)
                canonicalMinPrice = 1 / newMaxPrice; // Lower canonical = 1/higher inverted
                canonicalMaxPrice = 1 / newMinPrice; // Higher canonical = 1/lower inverted
              } else {
                canonicalMinPrice = newMinPrice;
                canonicalMaxPrice = newMaxPrice;
              }

              const tickLower = tickFromPrice(canonicalMinPrice);
              const tickUpper = tickFromPrice(canonicalMaxPrice);

              // Align to tick spacing
              const tickSpacingVal = poolConfig?.tickSpacing || 10;
              const alignedTickLower = Math.round(tickLower / tickSpacingVal) * tickSpacingVal;
              const alignedTickUpper = Math.round(tickUpper / tickSpacingVal) * tickSpacingVal;

              setRange(alignedTickLower, alignedTickUpper);
            }}
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
              value={isRehypoMode ? (poolConfig.rehypoRange?.min || '0') : minPrice}
              onChange={handleMinPriceChange}
              onIncrement={incrementMinPrice}
              onDecrement={decrementMinPrice}
              disabled={isRehypoMode || selectedPreset === 'full'}
              position="left"
            />
            <RangeInput
              label="Max"
              percentFromCurrent={isRehypoMode ? '—' : maxPricePercent}
              value={isRehypoMode ? (poolConfig.rehypoRange?.max || '∞') : maxPrice}
              onChange={handleMaxPriceChange}
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

        {/* Deposit Mode Tabs */}
        <div className="flex flex-row gap-4 border-b border-sidebar-border">
          <button
            onClick={() => handleZapModeToggle(false)}
            className={cn(
              "relative pb-3 text-sm font-medium transition-colors",
              !state.isZapMode
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Deposit
            <span className={cn(
              "absolute bottom-0 left-0 right-0 h-0.5 rounded-full transition-all duration-200",
              !state.isZapMode ? "bg-foreground opacity-100" : "bg-transparent opacity-0"
            )} />
          </button>
          <button
            onClick={() => handleZapModeToggle(true)}
            className={cn(
              "relative pb-3 text-sm font-medium transition-colors",
              state.isZapMode
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Zap
            <span className={cn(
              "absolute bottom-0 left-0 right-0 h-0.5 rounded-full transition-all duration-200",
              state.isZapMode ? "bg-foreground opacity-100" : "bg-transparent opacity-0"
            )} />
          </button>
        </div>

        {/* Token inputs with animated content switching */}
        {/* Padding compensates for gradient border's -1px inset, negative margin restores layout */}
        <div className="relative overflow-hidden -mx-px px-px -my-px py-px">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={state.isZapMode ? 'zap' : 'deposit'}
              initial={{ x: zapEnterOffset, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: zapExitOffset, opacity: 0 }}
              transition={SPRING_CONFIG}
              className="flex flex-col gap-3"
            >
              {state.isZapMode ? (
                /* Zap mode - single token input with switchable token */
                <TokenInputCard
                  id="wizard-amount-zap"
                  tokenSymbol={state.inputSide === 'token0' ? poolConfig.currency0.symbol : poolConfig.currency1.symbol}
                  value={state.inputSide === 'token0' ? amount0 : amount1}
                  onChange={state.inputSide === 'token0' ? handleAmount0Change : handleAmount1Change}
                  label="Add"
                  maxAmount={(state.inputSide === 'token0' ? token0BalanceData?.formatted : token1BalanceData?.formatted) || "0"}
                  usdPrice={(state.inputSide === 'token0' ? token0USDPrice : token1USDPrice) || 0}
                  formatUsdAmount={formatCalculatedAmount}
                  isOverBalance={state.inputSide === 'token0' ? isAmount0OverBalance : isAmount1OverBalance}
                  isLoading={amount0Loading}
                  animationControls={wiggleControls0}
                  onPercentageClick={(percentage) => state.inputSide === 'token0' ? handleToken0Percentage(percentage) : handleToken1Percentage(percentage)}
                  onTokenClick={() => setInputSide(state.inputSide === 'token0' ? 'token1' : 'token0')}
                />
              ) : (
                /* Standard deposit mode - two token inputs */
                <>
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
                </>
              )}
            </motion.div>
          </AnimatePresence>
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
        style={!canReview ? { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        Review
      </Button>
    </Container>
  );
}
