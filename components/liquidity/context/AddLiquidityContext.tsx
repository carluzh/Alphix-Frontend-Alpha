/**
 * AddLiquidityContext
 *
 * Centralized state management for liquidity addition operations.
 * Follows Uniswap's CreateLiquidityContextProvider pattern.
 */

import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { useAccount, useBalance } from 'wagmi';
import { useNetwork } from '@/lib/network-context';
import {
  getPoolById,
  getToken,
  getTokenDefinitions,
  TokenSymbol,
  NetworkMode,
} from '@/lib/pools-config';
import { getOptimalBaseToken } from '@/lib/denomination-utils';
import { useMintState, useMintActionHandlers } from '@/lib/liquidity/state';
import { PositionField } from '@/lib/liquidity/types';
import { useUserSlippageTolerance } from '@/hooks/useSlippage';
import { useTokenUSDPrice } from '@/hooks/useTokenUSDPrice';
import { useAddLiquidityCalculation, CalculatedLiquidityData } from '../hooks/useAddLiquidityCalculation';
import { useRangeDisplay } from '../hooks/useRangeDisplay';
import { usePositionAPY, CachedPoolMetrics } from '../hooks/usePositionAPY';
import { useZapQuote, ZapQuoteData } from '../hooks/useZapQuote';
import { useBalanceWiggle } from '../hooks/useBalanceWiggle';
import { getAddableTokens, calculateTicksFromPercentage } from '@/lib/liquidity/utils/calculations';
import { showInfoToast } from '@/lib/ui/toasts';

// =============================================================================
// DEFAULT STATES (following Uniswap pattern)
// =============================================================================

export const DEFAULT_RANGE_STATE = {
  tickLower: '',
  tickUpper: '',
  activePreset: null as string | null,
  initialDefaultApplied: false,
};

export const DEFAULT_DEPOSIT_STATE = {
  amount0: '',
  amount1: '',
  amount0FullPrecision: '',
  amount1FullPrecision: '',
  activeInputSide: null as 'amount0' | 'amount1' | null,
};

export const DEFAULT_ZAP_STATE = {
  isZapMode: false,
  zapInputToken: 'token0' as 'token0' | 'token1',
};

// =============================================================================
// CONTEXT TYPES
// =============================================================================

interface PoolState {
  currentPoolTick: number | null;
  currentPrice: string | null;
  currentPoolSqrtPriceX96: string | null;
  poolLiquidity: string | undefined;
  isPoolStateLoading: boolean;
}

interface RangeState {
  tickLower: string;
  tickUpper: string;
  activePreset: string | null;
  initialDefaultApplied: boolean;
}

interface DepositState {
  amount0: string;
  amount1: string;
  amount0FullPrecision: string;
  amount1FullPrecision: string;
  activeInputSide: 'amount0' | 'amount1' | null;
}

interface ZapState {
  isZapMode: boolean;
  zapInputToken: 'token0' | 'token1';
}

interface UIState {
  showingTransactionSteps: boolean;
  showRangeModal: boolean;
  modalInitialFocusField: 'min' | 'max' | null;
  isAmount0Focused: boolean;
  isAmount1Focused: boolean;
  hasUserInteracted: boolean;
  xDomain: [number, number];
}

export interface AddLiquidityContextType {
  // Token info
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  isStablePool: boolean;
  presetOptions: string[];
  baseTokenForPriceDisplay: TokenSymbol;

  // Pool state
  poolState: PoolState;

  // Range state
  rangeState: RangeState;
  canAddToken0: boolean;
  canAddToken1: boolean;
  hasRangeSelected: boolean;

  // Deposit state
  depositState: DepositState;
  isInsufficientBalance: boolean;

  // Zap state
  zapState: ZapState;
  zapQuote: ZapQuoteData | null;
  priceImpact: number | null;
  isPreparingZap: boolean;
  priceImpactWarning: { severity: 'high' | 'medium'; message: string } | null;

  // UI state
  uiState: UIState;

  // Calculation data
  calculatedData: CalculatedLiquidityData | null;
  isCalculating: boolean;
  calculationError: string | null;

  // APY data
  estimatedApy: string;
  isCalculatingApy: boolean;
  cachedPoolMetrics: CachedPoolMetrics | null;

  // Range display
  rangeLabels: { left: string; right: string } | null;
  formattedCurrentPrice: string | null;
  minPriceInputString: string;
  maxPriceInputString: string;

  // Slippage
  currentSlippage: number;
  isAutoSlippage: boolean;
  autoSlippageValue: number;
  zapSlippageToleranceBps: number;

  // Balance data
  token0BalanceData: { formatted?: string; value?: bigint } | undefined;
  token1BalanceData: { formatted?: string; value?: bigint } | undefined;
  isLoadingToken0Balance: boolean;
  isLoadingToken1Balance: boolean;

  // Wiggle controls
  balanceWiggleControls0: ReturnType<typeof useBalanceWiggle>['controls'];
  balanceWiggleControls1: ReturnType<typeof useBalanceWiggle>['controls'];

  // USD prices
  getUSDPriceForSymbol: (symbol?: string) => number;

  // Setters - Range
  setTickLower: (value: string) => void;
  setTickUpper: (value: string) => void;
  setActivePreset: (preset: string | null) => void;
  setInitialDefaultApplied: (value: boolean) => void;
  setBaseTokenForPriceDisplay: (token: TokenSymbol) => void;

  // Setters - Deposit
  setAmount0: (value: string) => void;
  setAmount1: (value: string) => void;
  setAmount0FullPrecision: (value: string) => void;
  setAmount1FullPrecision: (value: string) => void;
  setActiveInputSide: (side: 'amount0' | 'amount1' | null) => void;

  // Setters - Zap
  setIsZapMode: (value: boolean) => void;
  setZapInputToken: (token: 'token0' | 'token1') => void;

  // Setters - UI
  setShowingTransactionSteps: (value: boolean) => void;
  setShowRangeModal: (value: boolean) => void;
  setModalInitialFocusField: (field: 'min' | 'max' | null) => void;
  setIsAmount0Focused: (value: boolean) => void;
  setIsAmount1Focused: (value: boolean) => void;
  setHasUserInteracted: (value: boolean) => void;
  setXDomain: (domain: [number, number]) => void;

  // Setters - Pool
  setCurrentPoolTick: (tick: number | null) => void;
  setCurrentPrice: (price: string | null) => void;
  setCurrentPoolSqrtPriceX96: (value: string | null) => void;
  setIsPoolStateLoading: (value: boolean) => void;

  // Setters - Slippage
  setSlippage: (value: number) => void;
  setAutoMode: () => void;
  setCustomMode: () => void;

  // Actions
  triggerCalculation: ReturnType<typeof useAddLiquidityCalculation>['calculate'];
  resetCalculation: () => void;
  resetAmounts: () => void;
  resetZapState: () => void;
  resetChartViewbox: (newTickLower: number, newTickUpper: number, leftMarginFrac?: number, rightMarginFrac?: number) => void;
  fetchZapQuote: ReturnType<typeof useZapQuote>['fetchZapQuote'];
  triggerWiggle0: () => void;
  triggerWiggle1: () => void;
  refetchToken0Balance: () => void;
  refetchToken1Balance: () => void;

  // Helper functions
  getPresetDisplayLabel: (preset: string | null, isStable: boolean) => string;

  // SDK bounds
  sdkMinTick: number;
  sdkMaxTick: number;
  defaultTickSpacing: number;
}

const AddLiquidityContext = createContext<AddLiquidityContextType | undefined>(undefined);

// =============================================================================
// PROVIDER PROPS
// =============================================================================

export interface AddLiquidityProviderProps {
  children: React.ReactNode;
  selectedPoolId?: string;
  sdkMinTick: number;
  sdkMaxTick: number;
  defaultTickSpacing: number;
  poolState?: {
    currentPrice: string;
    currentPoolTick: number;
    sqrtPriceX96: string;
    liquidity?: string;
  };
  initialTickLower?: number;
  initialTickUpper?: number;
  initialToken0Amount?: string;
}

// =============================================================================
// PROVIDER COMPONENT
// =============================================================================

export function AddLiquidityProvider({
  children,
  selectedPoolId,
  sdkMinTick,
  sdkMaxTick,
  defaultTickSpacing,
  poolState: externalPoolState,
  initialTickLower,
  initialTickUpper,
  initialToken0Amount,
}: AddLiquidityProviderProps) {
  // Network and account
  const { address: accountAddress, chainId, isConnected } = useAccount();
  const { networkMode, chainId: targetChainId } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);

  // Get initial tokens from pool config
  const getInitialTokens = useCallback(() => {
    if (selectedPoolId) {
      const poolConfig = getPoolById(selectedPoolId);
      if (poolConfig) {
        return {
          token0: poolConfig.currency0.symbol as TokenSymbol,
          token1: poolConfig.currency1.symbol as TokenSymbol,
        };
      }
    }
    return { token0: 'aUSDC' as TokenSymbol, token1: 'aUSDT' as TokenSymbol };
  }, [selectedPoolId]);

  const initialTokens = getInitialTokens();

  // Token state
  const [token0Symbol, setToken0Symbol] = useState<TokenSymbol>(initialTokens.token0);
  const [token1Symbol, setToken1Symbol] = useState<TokenSymbol>(initialTokens.token1);

  // Pool type detection
  const isStablePool = useMemo(() => {
    if (!selectedPoolId) return false;
    const poolCfg = getPoolById(selectedPoolId);
    return (poolCfg?.type || '').toLowerCase() === 'stable';
  }, [selectedPoolId]);

  const presetOptions = useMemo(() => {
    return isStablePool
      ? ['±1%', '±0.5%', '±0.1%', 'Full Range']
      : ['Full Range', '±15%', '±8%', '±3%'];
  }, [isStablePool]);

  // Zustand store for range state
  const mintState = useMintState();
  const {
    onLeftRangeInput,
    onRightRangeInput,
    onSetFullRange,
    onSetFullPrecision,
    onResetMintState,
  } = useMintActionHandlers();

  // Range state derived from store
  const tickLower = mintState.leftRangeTypedValue;
  const tickUpper = mintState.rightRangeTypedValue;
  const setTickLower = onLeftRangeInput;
  const setTickUpper = onRightRangeInput;

  // Full precision amounts from store
  const amount0FullPrecision = mintState.fullPrecisionValue0;
  const amount1FullPrecision = mintState.fullPrecisionValue1;
  const setAmount0FullPrecision = useCallback(
    (value: string) => onSetFullPrecision(PositionField.TOKEN0, value),
    [onSetFullPrecision]
  );
  const setAmount1FullPrecision = useCallback(
    (value: string) => onSetFullPrecision(PositionField.TOKEN1, value),
    [onSetFullPrecision]
  );

  // Deposit state
  const [amount0, setAmount0] = useState('');
  const [amount1, setAmount1] = useState('');
  const [activeInputSide, setActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);

  // Pool state
  const [currentPoolTick, setCurrentPoolTick] = useState<number | null>(null);
  const [currentPrice, setCurrentPrice] = useState<string | null>(null);
  const [currentPoolSqrtPriceX96, setCurrentPoolSqrtPriceX96] = useState<string | null>(null);
  const [isPoolStateLoading, setIsPoolStateLoading] = useState(false);

  // Range UI state
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [initialDefaultApplied, setInitialDefaultApplied] = useState(false);
  const [baseTokenForPriceDisplay, setBaseTokenForPriceDisplay] = useState<TokenSymbol>(() =>
    getOptimalBaseToken(initialTokens.token0, initialTokens.token1)
  );
  const [canAddToken0, setCanAddToken0] = useState(true);
  const [canAddToken1, setCanAddToken1] = useState(true);

  // Zap state
  const [isZapMode, setIsZapMode] = useState(false);
  const [zapInputToken, setZapInputToken] = useState<'token0' | 'token1'>('token0');

  // UI state
  const [showingTransactionSteps, setShowingTransactionSteps] = useState(false);
  const [showRangeModal, setShowRangeModal] = useState(false);
  const [modalInitialFocusField, setModalInitialFocusField] = useState<'min' | 'max' | null>(null);
  const [isAmount0Focused, setIsAmount0Focused] = useState(false);
  const [isAmount1Focused, setIsAmount1Focused] = useState(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);
  const [xDomain, setXDomain] = useState<[number, number]>([-120000, 120000]);
  const [isInsufficientBalance, setIsInsufficientBalance] = useState(false);

  // Slippage hook
  const {
    currentSlippage,
    isAuto: isAutoSlippage,
    autoSlippage: autoSlippageValue,
    setSlippage,
    setAutoMode,
    setCustomMode,
    updateAutoSlippage,
  } = useUserSlippageTolerance();

  const zapSlippageToleranceBps = useMemo(() => {
    return Math.round(currentSlippage * 100);
  }, [currentSlippage]);

  // Balance hooks
  const {
    data: token0BalanceData,
    isLoading: isLoadingToken0Balance,
    refetch: refetchToken0Balance,
  } = useBalance({
    address: accountAddress,
    token:
      tokenDefinitions[token0Symbol]?.address === '0x0000000000000000000000000000000000000000'
        ? undefined
        : (tokenDefinitions[token0Symbol]?.address as `0x${string}` | undefined),
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!tokenDefinitions[token0Symbol] },
  });

  const {
    data: token1BalanceData,
    isLoading: isLoadingToken1Balance,
    refetch: refetchToken1Balance,
  } = useBalance({
    address: accountAddress,
    token:
      tokenDefinitions[token1Symbol]?.address === '0x0000000000000000000000000000000000000000'
        ? undefined
        : (tokenDefinitions[token1Symbol]?.address as `0x${string}` | undefined),
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!tokenDefinitions[token1Symbol] },
  });

  // USD price hooks
  const token0USDPrice = useTokenUSDPrice(token0Symbol);
  const token1USDPrice = useTokenUSDPrice(token1Symbol);

  const getUSDPriceForSymbol = useCallback(
    (symbol?: string): number => {
      if (!symbol) return 0;
      if (symbol === token0Symbol) return token0USDPrice.price ?? 0;
      if (symbol === token1Symbol) return token1USDPrice.price ?? 0;
      return 0;
    },
    [token0Symbol, token1Symbol, token0USDPrice.price, token1USDPrice.price]
  );

  // Wiggle animations
  const { controls: balanceWiggleControls0, triggerWiggle: triggerWiggle0 } = useBalanceWiggle();
  const { controls: balanceWiggleControls1, triggerWiggle: triggerWiggle1 } = useBalanceWiggle();

  // Calculation hook
  const {
    calculate: triggerCalculation,
    calculatedData,
    isCalculating,
    error: calculationError,
    dependentAmount,
    dependentAmountFullPrecision,
    dependentField,
    reset: resetCalculation,
  } = useAddLiquidityCalculation({
    token0Symbol,
    token1Symbol,
    chainId,
  });

  // Zap quote hook
  const {
    zapQuote,
    priceImpact,
    isPreparingZap,
    fetchZapQuote,
    resetZapState,
    setPriceImpact,
    setZapQuote,
  } = useZapQuote({
    token0Symbol,
    token1Symbol,
    chainId,
    zapSlippageToleranceBps,
    updateAutoSlippage,
  });

  // Price impact warning
  const PRICE_IMPACT_MEDIUM = 3;
  const PRICE_IMPACT_HIGH = 5;

  const priceImpactWarning = useMemo(() => {
    if (!isZapMode) return null;
    const currentPriceImpact =
      priceImpact !== null
        ? priceImpact
        : zapQuote?.priceImpact
          ? parseFloat(zapQuote.priceImpact)
          : null;
    if (currentPriceImpact === null || isNaN(currentPriceImpact)) return null;
    if (currentPriceImpact >= PRICE_IMPACT_HIGH) {
      return {
        severity: 'high' as const,
        message: `Very high price impact: ${currentPriceImpact.toFixed(2)}%`,
      };
    }
    if (currentPriceImpact >= PRICE_IMPACT_MEDIUM) {
      return {
        severity: 'medium' as const,
        message: `High price impact: ${currentPriceImpact.toFixed(2)}%`,
      };
    }
    return null;
  }, [priceImpact, zapQuote?.priceImpact, isZapMode]);

  // APY hook
  const { estimatedApy, isCalculatingApy, cachedPoolMetrics } = usePositionAPY({
    selectedPoolId,
    tickLower,
    tickUpper,
    currentPoolTick,
    currentPoolSqrtPriceX96,
    token0Symbol,
    token1Symbol,
    amount0,
    amount1,
    calculatedData,
    poolLiquidity: externalPoolState?.liquidity,
    chainId: targetChainId,
    networkMode,
  });

  // Range display hook
  const { rangeLabels, formattedCurrentPrice, minPriceInputString, maxPriceInputString } =
    useRangeDisplay({
      tickLower,
      tickUpper,
      currentPoolTick,
      currentPrice,
      baseTokenForPriceDisplay,
      token0Symbol,
      token1Symbol,
      sdkMinTick,
      sdkMaxTick,
      selectedPoolId,
      activePreset,
      initialDefaultApplied,
      calculatedData,
    });

  // Helper functions
  const getPresetDisplayLabel = useCallback((preset: string | null, isStable: boolean): string => {
    if (!preset) return 'Select Range';
    if (preset === 'Full Range') return 'Full Range';
    if (isStable) {
      if (preset === '±3%' || preset === '±1%') return 'Wide';
      if (preset === '±0.5%' || preset === '±0.1%') return 'Narrow';
    } else {
      if (preset === '±15%') return 'Wide';
      if (preset === '±8%') return 'Wide';
      if (preset === '±3%') return 'Narrow';
    }
    return 'Custom';
  }, []);

  const resetAmounts = useCallback(() => {
    setAmount0('');
    setAmount1('');
    onSetFullPrecision(PositionField.TOKEN0, '');
    onSetFullPrecision(PositionField.TOKEN1, '');
  }, [onSetFullPrecision]);

  const resetChartViewbox = useCallback(
    (
      newTickLower: number,
      newTickUpper: number,
      leftMarginFrac: number = 0.05,
      rightMarginFrac: number = 0.05
    ) => {
      if (newTickLower === newTickUpper) return;
      const rangeWidth = newTickUpper - newTickLower;
      const leftMarginTicks = Math.round(rangeWidth * Math.max(0, leftMarginFrac));
      const rightMarginTicks = Math.round(rangeWidth * Math.max(0, rightMarginFrac));
      const newMinTick = newTickLower - leftMarginTicks;
      const newMaxTick = newTickUpper + rightMarginTicks;
      setXDomain([newMinTick, newMaxTick]);
    },
    []
  );

  // Derived state
  const hasRangeSelected =
    (activePreset !== null || initialDefaultApplied) && tickLower !== '' && tickUpper !== '';

  // =============================================================================
  // EFFECTS
  // =============================================================================

  // Sync dependent amount from calculation hook
  useEffect(() => {
    if (!dependentField || !dependentAmount) return;
    if (dependentField === 'amount1') {
      setAmount1(dependentAmount);
      setAmount1FullPrecision(dependentAmountFullPrecision);
    } else if (dependentField === 'amount0') {
      setAmount0(dependentAmount);
      setAmount0FullPrecision(dependentAmountFullPrecision);
    }
  }, [dependentField, dependentAmount, dependentAmountFullPrecision, setAmount0FullPrecision, setAmount1FullPrecision]);

  // Sync pool state from calculation results
  useEffect(() => {
    if (!calculatedData) return;
    if (typeof calculatedData.currentPoolTick === 'number') {
      setCurrentPoolTick(calculatedData.currentPoolTick);
    }
    if (calculatedData.currentPrice) {
      setCurrentPrice(calculatedData.currentPrice);
    }
  }, [calculatedData]);

  // Apply external pool state
  useEffect(() => {
    if (externalPoolState?.currentPrice && typeof externalPoolState?.currentPoolTick === 'number') {
      setIsPoolStateLoading(false);
      setCurrentPrice(externalPoolState.currentPrice);
      setCurrentPoolTick(externalPoolState.currentPoolTick);
      setCurrentPoolSqrtPriceX96(externalPoolState.sqrtPriceX96?.toString() || null);

      const price = parseFloat(externalPoolState.currentPrice);
      if (!isNaN(price)) {
        const percentageRange = isStablePool ? 0.05 : 0.2;
        const tickRange = Math.round(Math.log(1 + percentageRange) / Math.log(1.0001));
        setXDomain([
          externalPoolState.currentPoolTick - tickRange,
          externalPoolState.currentPoolTick + tickRange,
        ]);
      }
    }
  }, [externalPoolState, isStablePool]);

  // Setup tokens based on selectedPoolId
  useEffect(() => {
    if (selectedPoolId) {
      const poolConfig = getPoolById(selectedPoolId);
      if (poolConfig) {
        const token0Config = getToken(poolConfig.currency0.symbol);
        const token1Config = getToken(poolConfig.currency1.symbol);

        if (token0Config && token1Config) {
          const t0 = token0Config.symbol as TokenSymbol;
          const t1 = token1Config.symbol as TokenSymbol;

          setToken0Symbol(t0);
          setToken1Symbol(t1);
          resetAmounts();
          resetZapState();
          setTickLower(sdkMinTick.toString());
          setTickUpper(sdkMaxTick.toString());
          setCurrentPoolTick(null);
          resetCalculation();
          setActiveInputSide(null);
          setCurrentPrice(null);
          setInitialDefaultApplied(false);
          setActivePreset(null);
          setBaseTokenForPriceDisplay(t0);
          setHasUserInteracted(false);
        }
      }
    }
  }, [selectedPoolId, sdkMinTick, sdkMaxTick, resetAmounts, resetZapState, resetCalculation]);

  // Apply initial parameters from position copying
  useEffect(() => {
    if (initialTickLower !== undefined && initialTickUpper !== undefined) {
      setTickLower(initialTickLower.toString());
      setTickUpper(initialTickUpper.toString());
      setActivePreset(null);
      setInitialDefaultApplied(true);
    }
    if (initialToken0Amount !== undefined) {
      setAmount0(initialToken0Amount);
      setActiveInputSide('amount0');
    }
  }, [initialTickLower, initialTickUpper, initialToken0Amount]);

  // OOR detection
  useEffect(() => {
    const tl = parseInt(tickLower);
    const tu = parseInt(tickUpper);
    if (currentPoolTick === null || isNaN(tl) || isNaN(tu)) {
      setCanAddToken0(true);
      setCanAddToken1(true);
      return;
    }
    const { canAddToken0: canAdd0, canAddToken1: canAdd1 } = getAddableTokens(currentPoolTick, tl, tu);
    setCanAddToken0(canAdd0);
    setCanAddToken1(canAdd1);
    if (!canAdd0 && parseFloat(amount0 || '0') > 0) {
      setAmount0('');
      setAmount0FullPrecision('');
    }
    if (!canAdd1 && parseFloat(amount1 || '0') > 0) {
      setAmount1('');
      setAmount1FullPrecision('');
    }
  }, [tickLower, tickUpper, currentPoolTick, amount0, amount1, setAmount0FullPrecision, setAmount1FullPrecision]);

  // Keep denomination aligned with optimal base
  useEffect(() => {
    const priceNum = currentPrice ? parseFloat(currentPrice) : undefined;
    const desiredBase = getOptimalBaseToken(token0Symbol, token1Symbol, priceNum);
    if (desiredBase && desiredBase !== baseTokenForPriceDisplay) {
      setBaseTokenForPriceDisplay(desiredBase);
    }
  }, [token0Symbol, token1Symbol, currentPrice, baseTokenForPriceDisplay]);

  // =============================================================================
  // CONTEXT VALUE
  // =============================================================================

  const value: AddLiquidityContextType = useMemo(
    () => ({
      // Token info
      token0Symbol,
      token1Symbol,
      isStablePool,
      presetOptions,
      baseTokenForPriceDisplay,

      // Pool state
      poolState: {
        currentPoolTick,
        currentPrice,
        currentPoolSqrtPriceX96,
        poolLiquidity: externalPoolState?.liquidity,
        isPoolStateLoading,
      },

      // Range state
      rangeState: {
        tickLower,
        tickUpper,
        activePreset,
        initialDefaultApplied,
      },
      canAddToken0,
      canAddToken1,
      hasRangeSelected,

      // Deposit state
      depositState: {
        amount0,
        amount1,
        amount0FullPrecision,
        amount1FullPrecision,
        activeInputSide,
      },
      isInsufficientBalance,

      // Zap state
      zapState: {
        isZapMode,
        zapInputToken,
      },
      zapQuote,
      priceImpact,
      isPreparingZap,
      priceImpactWarning,

      // UI state
      uiState: {
        showingTransactionSteps,
        showRangeModal,
        modalInitialFocusField,
        isAmount0Focused,
        isAmount1Focused,
        hasUserInteracted,
        xDomain,
      },

      // Calculation data
      calculatedData,
      isCalculating,
      calculationError,

      // APY data
      estimatedApy,
      isCalculatingApy,
      cachedPoolMetrics,

      // Range display
      rangeLabels,
      formattedCurrentPrice,
      minPriceInputString,
      maxPriceInputString,

      // Slippage
      currentSlippage,
      isAutoSlippage,
      autoSlippageValue,
      zapSlippageToleranceBps,

      // Balance data
      token0BalanceData,
      token1BalanceData,
      isLoadingToken0Balance,
      isLoadingToken1Balance,

      // Wiggle controls
      balanceWiggleControls0,
      balanceWiggleControls1,

      // USD prices
      getUSDPriceForSymbol,

      // Setters - Range
      setTickLower,
      setTickUpper,
      setActivePreset,
      setInitialDefaultApplied,
      setBaseTokenForPriceDisplay,

      // Setters - Deposit
      setAmount0,
      setAmount1,
      setAmount0FullPrecision,
      setAmount1FullPrecision,
      setActiveInputSide,

      // Setters - Zap
      setIsZapMode,
      setZapInputToken,

      // Setters - UI
      setShowingTransactionSteps,
      setShowRangeModal,
      setModalInitialFocusField,
      setIsAmount0Focused,
      setIsAmount1Focused,
      setHasUserInteracted,
      setXDomain,

      // Setters - Pool
      setCurrentPoolTick,
      setCurrentPrice,
      setCurrentPoolSqrtPriceX96,
      setIsPoolStateLoading,

      // Setters - Slippage
      setSlippage,
      setAutoMode,
      setCustomMode,

      // Actions
      triggerCalculation,
      resetCalculation,
      resetAmounts,
      resetZapState,
      resetChartViewbox,
      fetchZapQuote,
      triggerWiggle0,
      triggerWiggle1,
      refetchToken0Balance,
      refetchToken1Balance,

      // Helper functions
      getPresetDisplayLabel,

      // SDK bounds
      sdkMinTick,
      sdkMaxTick,
      defaultTickSpacing,
    }),
    [
      token0Symbol,
      token1Symbol,
      isStablePool,
      presetOptions,
      baseTokenForPriceDisplay,
      currentPoolTick,
      currentPrice,
      currentPoolSqrtPriceX96,
      externalPoolState?.liquidity,
      isPoolStateLoading,
      tickLower,
      tickUpper,
      activePreset,
      initialDefaultApplied,
      canAddToken0,
      canAddToken1,
      hasRangeSelected,
      amount0,
      amount1,
      amount0FullPrecision,
      amount1FullPrecision,
      activeInputSide,
      isInsufficientBalance,
      isZapMode,
      zapInputToken,
      zapQuote,
      priceImpact,
      isPreparingZap,
      priceImpactWarning,
      showingTransactionSteps,
      showRangeModal,
      modalInitialFocusField,
      isAmount0Focused,
      isAmount1Focused,
      hasUserInteracted,
      xDomain,
      calculatedData,
      isCalculating,
      calculationError,
      estimatedApy,
      isCalculatingApy,
      cachedPoolMetrics,
      rangeLabels,
      formattedCurrentPrice,
      minPriceInputString,
      maxPriceInputString,
      currentSlippage,
      isAutoSlippage,
      autoSlippageValue,
      zapSlippageToleranceBps,
      token0BalanceData,
      token1BalanceData,
      isLoadingToken0Balance,
      isLoadingToken1Balance,
      balanceWiggleControls0,
      balanceWiggleControls1,
      getUSDPriceForSymbol,
      setTickLower,
      setTickUpper,
      setAmount0FullPrecision,
      setAmount1FullPrecision,
      setSlippage,
      setAutoMode,
      setCustomMode,
      triggerCalculation,
      resetCalculation,
      resetAmounts,
      resetZapState,
      resetChartViewbox,
      fetchZapQuote,
      triggerWiggle0,
      triggerWiggle1,
      refetchToken0Balance,
      refetchToken1Balance,
      getPresetDisplayLabel,
      sdkMinTick,
      sdkMaxTick,
      defaultTickSpacing,
    ]
  );

  return <AddLiquidityContext.Provider value={value}>{children}</AddLiquidityContext.Provider>;
}

// =============================================================================
// CONSUMER HOOK
// =============================================================================

export function useAddLiquidityContext(): AddLiquidityContextType {
  const context = useContext(AddLiquidityContext);
  if (!context) {
    throw new Error('useAddLiquidityContext must be used within an AddLiquidityProvider');
  }
  return context;
}
