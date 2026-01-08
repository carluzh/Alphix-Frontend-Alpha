'use client';

/**
 * RangeAndAmountsStep - Step 2 of Add Liquidity Wizard (Uniswap-aligned)
 * Combines range selection + deposit amounts on a single screen
 *
 * - For Rehypo mode: Range section is minimal (full range preset)
 * - For Concentrated mode: Full range selection with presets
 * - Always shows deposit amounts section
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { ArrowDownUp, Info, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAccount, useBalance } from 'wagmi';
import { useAnimation } from 'framer-motion';

import { useAddLiquidityContext } from '../AddLiquidityContext';
import { useCreatePositionTxContext } from '../CreatePositionTxContext';
import { Container } from '../shared/Container';
import { RangePreset } from '../types';
import { getPoolById, getTokenDefinitions, getToken, TokenSymbol } from '@/lib/pools-config';
import { useNetwork } from '@/lib/network-context';
import { getDecimalsForDenomination } from '@/lib/denomination-utils';
import { usePercentageInput } from '@/hooks/usePercentageInput';
import { useTokenUSDPrice } from '@/hooks/useTokenUSDPrice';
import { TokenInputCard, TokenInputStyles } from '@/components/liquidity/TokenInputCard';
import { formatCalculatedAmount } from '@/components/liquidity/liquidity-form-utils';
import { calculateTicksFromPercentage } from '@/lib/liquidity/utils/calculations';
import { nearestUsableTick } from '@uniswap/v3-sdk';

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
    display: '–50% — +100%',
    description: 'Good for volatile pairs',
  },
  {
    id: 'one_sided_lower',
    title: 'One-sided lower',
    display: '–50%',
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
          {strategy.display}
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
  percentFromCurrent: string; // e.g., "-50%" or "+100%"
  value: string;
  onChange: (value: string) => void;
  onIncrement: () => void;
  onDecrement: () => void;
  disabled?: boolean;
  error?: boolean;
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
  error,
  position,
}: RangeInputProps) {
  return (
    <div className={cn(
      'flex flex-row justify-between flex-1 px-4 py-4',
      position === 'left' ? 'border-r border-sidebar-border' : '',
      error && 'bg-red-500/5',
      disabled && 'opacity-50'
    )}>
      {/* Left side: Label, Price, Percent from current */}
      <div className="flex flex-col gap-1 flex-1 overflow-hidden">
        <span className="text-sm font-medium text-muted-foreground">
          {label} price
        </span>
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            'bg-transparent border-none text-xl md:text-xl font-semibold p-0 h-auto focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0',
            error ? 'text-red-400' : 'text-white'
          )}
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

// Zap mode toggle (compact)
interface ZapModeToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

function ZapModeToggle({ enabled, onToggle }: ZapModeToggleProps) {
  return (
    <div className="flex flex-row items-center justify-between p-4 rounded-lg bg-surface border border-sidebar-border/60">
      <div className="flex flex-col gap-1">
        <span className="text-base font-medium text-white">Single Token Mode</span>
        <span className="text-sm text-muted-foreground">Provide with one token</span>
      </div>
      <Switch checked={enabled} onCheckedChange={onToggle} />
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

  // Local state
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [priceInverted, setPriceInverted] = useState(false);
  const [amount0, setAmount0] = useState(state.amount0 || '');
  const [amount1, setAmount1] = useState(state.amount1 || '');
  const [isAmount0OverBalance, setIsAmount0OverBalance] = useState(false);
  const [isAmount1OverBalance, setIsAmount1OverBalance] = useState(false);

  // Use isCalculating from TxContext
  const isCalculating = txIsCalculating;

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

  // Handle price strategy selection (Uniswap-aligned with REAL tick math)
  const handleSelectStrategy = useCallback((strategy: RangePreset) => {
    setRangePreset(strategy);

    // Get current tick and tick spacing from pool data
    const poolCurrentTick = currentTick ?? 0;
    const tickSpacing = poolConfig?.tickSpacing ?? 10;

    let tickLower: number;
    let tickUpper: number;

    switch (strategy) {
      case 'stable':
        // ± 3 ticks (aligned to tick spacing using Uniswap SDK)
        // For stable pools, use exactly 3 tick spacings in each direction
        tickLower = nearestUsableTick(poolCurrentTick - 3 * tickSpacing, tickSpacing);
        tickUpper = nearestUsableTick(poolCurrentTick + 3 * tickSpacing, tickSpacing);
        break;

      case 'wide':
        // –50% — +100% (using calculateTicksFromPercentage for proper alignment)
        [tickLower, tickUpper] = calculateTicksFromPercentage(50, 100, poolCurrentTick, tickSpacing);
        break;

      case 'one_sided_lower':
        // –50% to just below current tick
        // Lower bound: 50% below current price
        // Upper bound: one tick spacing below current tick (using SDK)
        [tickLower] = calculateTicksFromPercentage(50, 0, poolCurrentTick, tickSpacing);
        tickUpper = nearestUsableTick(poolCurrentTick - tickSpacing, tickSpacing);
        break;

      case 'one_sided_upper':
        // Just above current tick to +100%
        // Lower bound: one tick spacing above current tick (using SDK)
        // Upper bound: 100% above current price
        tickLower = nearestUsableTick(poolCurrentTick + tickSpacing, tickSpacing);
        [, tickUpper] = calculateTicksFromPercentage(0, 100, poolCurrentTick, tickSpacing);
        break;

      case 'full':
        setMinPrice('0');
        setMaxPrice('∞');
        setRange(null, null);
        return;

      case 'custom':
        // Keep current values
        return;

      default:
        return;
    }

    // Ensure tickLower < tickUpper
    if (tickLower >= tickUpper) {
      tickUpper = tickLower + tickSpacing;
    }

    // Convert ticks to canonical prices (token1/token0)
    const priceLower = tickToPrice(tickLower);
    const priceUpper = tickToPrice(tickUpper);

    // Set display values (accounting for price inversion)
    // When inverted: low display = 1/upper, high display = 1/lower
    // When not inverted: low display = lower, high display = upper
    if (priceInverted) {
      setMinPrice(formatPriceForDisplay(1 / priceUpper, true));
      setMaxPrice(formatPriceForDisplay(1 / priceLower, true));
    } else {
      setMinPrice(formatPriceForDisplay(priceLower, false));
      setMaxPrice(formatPriceForDisplay(priceUpper, false));
    }

    // Set the actual tick range in context for transaction
    setRange(tickLower, tickUpper);
  }, [setRangePreset, setRange, currentTick, poolConfig?.tickSpacing, priceInverted, tickToPrice, formatPriceForDisplay]);

  // Handle token selection for price denomination (Uniswap pattern)
  const handleSelectToken = useCallback((token: string) => {
    const shouldInvert = token === token1Symbol;
    if (shouldInvert === priceInverted) return; // No change needed

    // Swap and invert the prices
    setPriceInverted(shouldInvert);
    const temp = minPrice;
    setMinPrice(maxPrice === '∞' ? '0' : (1 / parseFloat(maxPrice)).toFixed(6));
    setMaxPrice(temp === '0' ? '∞' : (1 / parseFloat(temp)).toFixed(6));
  }, [minPrice, maxPrice, token1Symbol, priceInverted]);

  // Handle manual price input
  const handleMinPriceChange = useCallback((value: string) => {
    setMinPrice(value);
    setRangePreset('custom');
  }, [setRangePreset]);

  const handleMaxPriceChange = useCallback((value: string) => {
    setMaxPrice(value);
    setRangePreset('custom');
  }, [setRangePreset]);

  // Increment/decrement handlers
  const step = isStablePool ? 0.001 : 0.01;

  const incrementMinPrice = useCallback(() => {
    const current = parseFloat(minPrice) || 0;
    setMinPrice((current + step).toFixed(4));
    setRangePreset('custom');
  }, [minPrice, step, setRangePreset]);

  const decrementMinPrice = useCallback(() => {
    const current = parseFloat(minPrice) || 0;
    setMinPrice(Math.max(0, current - step).toFixed(4));
    setRangePreset('custom');
  }, [minPrice, step, setRangePreset]);

  const incrementMaxPrice = useCallback(() => {
    if (maxPrice === '∞') return;
    const current = parseFloat(maxPrice) || 0;
    setMaxPrice((current + step).toFixed(4));
    setRangePreset('custom');
  }, [maxPrice, step, setRangePreset]);

  const decrementMaxPrice = useCallback(() => {
    if (maxPrice === '∞') {
      setMaxPrice('1000000');
      return;
    }
    const current = parseFloat(maxPrice) || 0;
    setMaxPrice(Math.max(0, current - step).toFixed(4));
    setRangePreset('custom');
  }, [maxPrice, step, setRangePreset]);

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

  // Initialize range on mount - default to Wide strategy (Uniswap's most common)
  useEffect(() => {
    if (!minPrice && !maxPrice) {
      handleSelectStrategy('wide');
    }
  }, []);

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
  const canReview = isValidRange && hasValidAmount && !hasInsufficientBalance && !isCalculating;

  if (!poolConfig) {
    return null;
  }

  return (
    <Container>
      <TokenInputStyles />

      {/* Section 1: Range Selection (collapsed for rehypo mode) */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-white">
            {isRehypoMode ? 'Position Range' : 'Set Price Range'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {isRehypoMode
              ? 'Rehypothecation uses full range for optimal yield'
              : `Define your price range for ${poolConfig.currency0.symbol}/${poolConfig.currency1.symbol}`}
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

        {/* Range controls (only for concentrated mode) */}
        {!isRehypoMode && (
          <>
            {/* Price Strategies (Uniswap-aligned) */}
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

            {/* Min/Max Price Inputs (Uniswap RangeAmountInput style with StatsTiles outline) */}
            <div className="border border-sidebar-border rounded-xl overflow-hidden">
              <div className="flex flex-row">
                <RangeInput
                  label="Min"
                  percentFromCurrent={minPricePercent}
                  value={minPrice}
                  onChange={handleMinPriceChange}
                  onIncrement={incrementMinPrice}
                  onDecrement={decrementMinPrice}
                  disabled={selectedPreset === 'full'}
                  error={!isValidRange && selectedPreset !== 'full'}
                  position="left"
                />
                <RangeInput
                  label="Max"
                  percentFromCurrent={maxPricePercent}
                  value={maxPrice}
                  onChange={handleMaxPriceChange}
                  onIncrement={incrementMaxPrice}
                  onDecrement={decrementMaxPrice}
                  disabled={selectedPreset === 'full'}
                  error={!isValidRange && selectedPreset !== 'full'}
                  position="right"
                />
              </div>
            </div>

            {/* Invalid range warning */}
            {!isValidRange && selectedPreset !== 'full' && (
              <div className="flex flex-row items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
                <span className="text-sm text-red-500">Min price must be less than max price</span>
              </div>
            )}
          </>
        )}

        {/* Range info for rehypo mode */}
        {isRehypoMode && (
          <div className="flex flex-row items-center gap-3 p-4 rounded-lg bg-sidebar-primary/10 border border-sidebar-primary/30">
            <Info className="w-5 h-5 text-sidebar-primary shrink-0" />
            <span className="text-base text-muted-foreground">
              Full range position for maximum Aave lending yield
            </span>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="border-t border-sidebar-border/40 my-2" />

      {/* Section 2: Deposit Amounts */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-white">Deposit Amounts</h2>
          <p className="text-sm text-muted-foreground">
            Enter how much {poolConfig.currency0.symbol} and {poolConfig.currency1.symbol} to deposit
          </p>
        </div>

        {/* Zap mode toggle */}
        <ZapModeToggle
          enabled={state.isZapMode}
          onToggle={handleZapModeToggle}
        />

        {/* Token inputs */}
        <div className="flex flex-col gap-3">
          <TokenInputCard
            id="wizard-amount0"
            tokenSymbol={poolConfig.currency0.symbol}
            value={amount0}
            onChange={handleAmount0Change}
            label={state.isZapMode ? 'Input Token' : 'Add'}
            maxAmount={token0BalanceData?.formatted || "0"}
            usdPrice={token0USDPrice || 0}
            formatUsdAmount={formatCalculatedAmount}
            isOverBalance={isAmount0OverBalance}
            animationControls={wiggleControls0}
            onPercentageClick={(percentage) => handleToken0Percentage(percentage)}
            disabled={state.isZapMode && state.inputSide === 'token1'}
          />

          {/* Plus indicator */}
          {!state.isZapMode && (
            <div className="flex justify-center items-center py-1">
              <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-surface border border-sidebar-border/60">
                <span className="text-muted-foreground text-base">+</span>
              </div>
            </div>
          )}

          {/* Token 1 Input */}
          {!state.isZapMode && (
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
              animationControls={wiggleControls1}
              onPercentageClick={(percentage) => handleToken1Percentage(percentage)}
            />
          )}

          {/* Zap mode: Single token selection */}
          {state.isZapMode && (
            <div className="flex flex-row gap-3">
              <button
                onClick={() => setInputSide('token0')}
                className={cn(
                  'flex-1 p-3 rounded-lg border transition-colors text-center text-base font-medium',
                  state.inputSide === 'token0'
                    ? 'border-sidebar-primary bg-sidebar-primary/10 text-white'
                    : 'border-sidebar-border bg-surface text-muted-foreground'
                )}
              >
                Use {poolConfig.currency0.symbol}
              </button>
              <button
                onClick={() => setInputSide('token1')}
                className={cn(
                  'flex-1 p-3 rounded-lg border transition-colors text-center text-base font-medium',
                  state.inputSide === 'token1'
                    ? 'border-sidebar-primary bg-sidebar-primary/10 text-white'
                    : 'border-sidebar-border bg-surface text-muted-foreground'
                )}
              >
                Use {poolConfig.currency1.symbol}
              </button>
            </div>
          )}
        </div>

        {/* Insufficient balance warning */}
        {hasInsufficientBalance && (
          <div className="flex flex-row items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
            <span className="text-sm text-red-500">Insufficient balance for this deposit</span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex flex-row gap-4 pt-4">
        <Button
          variant="outline"
          onClick={goBack}
          className="flex-shrink-0 h-11 px-6"
        >
          Back
        </Button>
        <Button
          onClick={handleReview}
          disabled={!canReview}
          className="flex-1 h-11 bg-button-primary border border-sidebar-primary text-sidebar-primary hover:bg-button-primary/90 text-base font-medium"
        >
          {isCalculating ? (
            <>
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
              Calculating...
            </>
          ) : (
            'Review'
          )}
        </Button>
      </div>
    </Container>
  );
}
