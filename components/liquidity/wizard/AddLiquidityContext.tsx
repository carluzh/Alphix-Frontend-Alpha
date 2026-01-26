'use client';

/**
 * AddLiquidityContext - Centralized state management for Add Liquidity Wizard
 *
 * Follows Uniswap's CreateLiquidityContextProvider pattern:
 * - Context holds user inputs (poolId, mode, amounts)
 * - Derived data (pool, currencies, price) computed via hooks
 * - Pool state fetched automatically when poolId changes
 */

import { createContext, useContext, useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Pool as V4Pool } from '@uniswap/v4-sdk';
import { Price, Currency } from '@uniswap/sdk-core';

import {
  WizardStep,
  WizardState,
  LPMode,
  RangePreset,
  DEFAULT_WIZARD_STATE,
  WIZARD_STEPS,
} from './types';
import { usePoolState } from '@/lib/apollo/hooks/usePoolState';
import { getPoolById } from '@/lib/pools-config';
import { useDerivedPositionInfo } from '@/lib/liquidity/hooks/position/useDerivedPositionInfo';
import type { CreatePositionInfo } from '@/lib/liquidity/types';

// Types adapted from Uniswap's structure
export interface PriceRangeState {
  priceInverted: boolean;
  fullRange: boolean;
  minPrice: string;
  maxPrice: string;
  initialPrice: string;
}

export interface DepositState {
  exactField: 'token0' | 'token1';
  exactAmounts: {
    token0?: string;
    token1?: string;
  };
}

export const DEFAULT_PRICE_RANGE_STATE: PriceRangeState = {
  priceInverted: false,
  fullRange: true,
  minPrice: '',
  maxPrice: '',
  initialPrice: '',
};

export const DEFAULT_DEPOSIT_STATE: DepositState = {
  exactField: 'token0',
  exactAmounts: {},
};

// Navigation source for dynamic breadcrumbs
export type NavigationSource = 'pools' | 'pool' | 'overview';

// Entry point configuration for skipping steps
export interface WizardEntryConfig {
  poolId?: string;
  token0Symbol?: string;
  token1Symbol?: string;
  mode?: LPMode;
  skipToStep?: WizardStep;
  from?: NavigationSource;
}

// Context value interface - mirrors Uniswap's CreateLiquidityContextType
interface AddLiquidityContextType {
  // Current state
  state: WizardState;
  priceRangeState: PriceRangeState;
  depositState: DepositState;

  // Derived position info (from useDerivedPositionInfo - Uniswap pattern)
  derivedPositionInfo: CreatePositionInfo;

  // Pool data shortcuts (derived from derivedPositionInfo)
  poolId: string | null;
  pool: V4Pool | undefined;
  poolLoading: boolean;
  ticks: [number | null, number | null];

  // Pool state data (from usePoolState)
  poolStateData: {
    currentPrice: string | null;
    currentPoolTick: number | null;
    sqrtPriceX96: string | null;
    liquidity: string | null;
  } | null;

  // Refetch function (Uniswap pattern)
  refetchPoolData: () => void;

  // Entry configuration
  entryConfig: WizardEntryConfig | null;

  // Navigation source for breadcrumbs
  navigationSource: NavigationSource | null;

  // Step navigation
  currentStep: WizardStep;
  setStep: (step: WizardStep) => void;
  goNext: () => void;
  goBack: () => void;
  canGoBack: boolean;
  canGoForward: boolean;

  // Modal controls
  openReviewModal: () => void;
  closeReviewModal: () => void;

  // State setters
  setState: Dispatch<SetStateAction<WizardState>>;
  setPriceRangeState: Dispatch<SetStateAction<PriceRangeState>>;
  setDepositState: Dispatch<SetStateAction<DepositState>>;

  // Convenience setters
  setTokens: (token0: string | null, token1: string | null) => void;
  setPoolId: (poolId: string | null) => void;
  setMode: (mode: LPMode) => void;
  setRange: (tickLower: number | null, tickUpper: number | null) => void;
  setRangePreset: (preset: RangePreset) => void;
  setAmounts: (amount0: string, amount1: string) => void;
  setInputSide: (side: 'token0' | 'token1') => void;

  // Reset functions
  reset: () => void;
  resetPriceRange: () => void;
  resetDeposit: () => void;

  // URL sync
  syncToUrl: () => void;
}

const AddLiquidityContext = createContext<AddLiquidityContextType | undefined>(undefined);

interface AddLiquidityProviderProps {
  children: React.ReactNode;
  entryConfig?: WizardEntryConfig;
}

export function AddLiquidityProvider({ children, entryConfig }: AddLiquidityProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Parse navigation source from URL or entry config
  const navigationSource = useMemo((): NavigationSource | null => {
    const urlFrom = searchParams?.get('from') as NavigationSource | null;
    return urlFrom || entryConfig?.from || null;
  }, [searchParams, entryConfig]);

  // Initialize state from URL or entry config
  const initialState = useMemo((): WizardState => {
    const urlStep = searchParams?.get('step');
    const urlPool = searchParams?.get('pool');
    const urlMode = searchParams?.get('mode') as LPMode | null;
    const urlT0 = searchParams?.get('t0');
    const urlT1 = searchParams?.get('t1');

    // Determine starting step based on entry config
    // Always start at step 1 (POOL_AND_MODE) to allow strategy selection
    // Pool will be pre-selected if coming from pool page
    let startStep = WizardStep.POOL_AND_MODE;
    if (entryConfig?.skipToStep !== undefined) {
      startStep = entryConfig.skipToStep;
    } else if (urlStep) {
      startStep = parseInt(urlStep, 10) as WizardStep;
    }
    // Note: We no longer skip to step 2 when poolId is set - users should always
    // be able to choose their LP strategy (rehypo vs concentrated)

    return {
      ...DEFAULT_WIZARD_STATE,
      currentStep: startStep,
      poolId: urlPool || entryConfig?.poolId || null,
      token0Symbol: urlT0 || entryConfig?.token0Symbol || null,
      token1Symbol: urlT1 || entryConfig?.token1Symbol || null,
      mode: urlMode || entryConfig?.mode || 'rehypo',
    };
  }, [searchParams, entryConfig]);

  // State
  const [state, setState] = useState<WizardState>(initialState);
  const [priceRangeState, setPriceRangeState] = useState<PriceRangeState>(DEFAULT_PRICE_RANGE_STATE);
  const [depositState, setDepositState] = useState<DepositState>(DEFAULT_DEPOSIT_STATE);

  // Derived values
  const currentStep = state.currentStep;
  const poolId = state.poolId;
  const ticks: [number | null, number | null] = [state.tickLower, state.tickUpper];

  // Get pool config to find subgraphId (Uniswap pattern: derive from selection)
  const poolConfig = useMemo(() => {
    if (!poolId) return null;
    return getPoolById(poolId);
  }, [poolId]);

  const subgraphId = poolConfig?.subgraphId || '';

  // Fetch pool state when pool is selected (Uniswap pattern: useDerivedPositionInfo internally fetches)
  const { data: poolStateRaw, loading: poolStateLoading, refetch: refetchPoolState } = usePoolState(subgraphId);

  // Transform pool state to match our interface
  const poolStateData = useMemo(() => {
    if (!poolStateRaw) return null;
    return {
      currentPrice: poolStateRaw.currentPrice ? String(poolStateRaw.currentPrice) : null,
      currentPoolTick: typeof poolStateRaw.currentPoolTick === 'number' ? poolStateRaw.currentPoolTick : null,
      sqrtPriceX96: poolStateRaw.sqrtPriceX96 ? String(poolStateRaw.sqrtPriceX96) : null,
      liquidity: poolStateRaw.liquidity ? String(poolStateRaw.liquidity) : null,
    };
  }, [poolStateRaw]);

  // Derive position info using Uniswap's pattern
  const derivedPositionInfo = useDerivedPositionInfo({
    poolId: poolId || undefined,
    poolState: poolStateData ? {
      sqrtPriceX96: poolStateData.sqrtPriceX96 || '0',
      currentTick: poolStateData.currentPoolTick || 0,
      liquidity: poolStateData.liquidity || '0',
    } : undefined,
  });

  // Extract shortcuts from derived info (convenience for components)
  const pool = derivedPositionInfo.pool;
  const poolLoading = poolStateLoading || !!derivedPositionInfo.poolOrPairLoading;

  // Refetch function (Uniswap pattern)
  const refetchPoolData = useCallback(async () => {
    await refetchPoolState();
  }, [refetchPoolState]);

  // Determine if back/forward navigation is possible
  const canGoBack = useMemo(() => {
    // Can't go back from first step
    if (currentStep === WizardStep.POOL_AND_MODE) return false;
    // Can always go back from step 2 to change strategy
    return true;
  }, [currentStep]);

  // Uniswap pattern: continueButtonEnabled = creatingPoolOrPair || poolOrPair
  // For Alphix (predefined pools), we require pool data to be loaded
  const canGoForward = useMemo(() => {
    switch (currentStep) {
      case WizardStep.POOL_AND_MODE:
        // Require: pool selected, mode selected, pool state loaded
        return !!state.poolId && !!state.mode && !!poolStateData && !poolLoading;
      case WizardStep.RANGE_AND_AMOUNTS:
        // Can't go forward from step 2 - use review modal instead
        return false;
      default:
        return false;
    }
  }, [currentStep, state.poolId, state.mode, poolStateData, poolLoading]);

  // Step navigation
  const setStep = useCallback((step: WizardStep) => {
    setState(prev => ({ ...prev, currentStep: step }));
  }, []);

  const goNext = useCallback(() => {
    const nextStep = currentStep + 1;
    if (nextStep <= WizardStep.RANGE_AND_AMOUNTS) {
      setStep(nextStep as WizardStep);
    }
  }, [currentStep, setStep]);

  const goBack = useCallback(() => {
    const prevStep = currentStep - 1;
    if (prevStep >= WizardStep.POOL_AND_MODE) {
      setStep(prevStep as WizardStep);
    }
  }, [currentStep, setStep]);

  // Modal controls
  const openReviewModal = useCallback(() => {
    setState(prev => ({ ...prev, isReviewModalOpen: true }));
  }, []);

  const closeReviewModal = useCallback(() => {
    setState(prev => ({ ...prev, isReviewModalOpen: false }));
  }, []);

  // Convenience setters
  const setTokens = useCallback((token0: string | null, token1: string | null) => {
    setState(prev => ({
      ...prev,
      token0Symbol: token0,
      token1Symbol: token1,
    }));
  }, []);

  const setPoolIdFn = useCallback((newPoolId: string | null) => {
    setState(prev => ({ ...prev, poolId: newPoolId }));
  }, []);

  const setMode = useCallback((mode: LPMode) => {
    setState(prev => ({
      ...prev,
      mode,
      // Reset range when switching modes
      tickLower: mode === 'rehypo' ? null : prev.tickLower,
      tickUpper: mode === 'rehypo' ? null : prev.tickUpper,
      isFullRange: mode === 'rehypo',
      rangePreset: mode === 'rehypo' ? 'full' : prev.rangePreset,
    }));
  }, []);

  const setRange = useCallback((tickLower: number | null, tickUpper: number | null) => {
    setState(prev => ({
      ...prev,
      tickLower,
      tickUpper,
      isFullRange: tickLower === null && tickUpper === null,
      // Note: rangePreset is NOT set here - it's managed separately by setRangePreset
      // This allows strategies to set both the range AND the preset without conflict
    }));
  }, []);

  const setRangePreset = useCallback((preset: RangePreset) => {
    setState(prev => ({
      ...prev,
      rangePreset: preset,
      isFullRange: preset === 'full',
    }));
  }, []);

  const setAmounts = useCallback((amount0: string, amount1: string) => {
    setState(prev => ({ ...prev, amount0, amount1 }));
  }, []);

  const setInputSide = useCallback((side: 'token0' | 'token1') => {
    setState(prev => ({ ...prev, inputSide: side }));
  }, []);

  // Reset functions
  const reset = useCallback(() => {
    setState(DEFAULT_WIZARD_STATE);
    setPriceRangeState(DEFAULT_PRICE_RANGE_STATE);
    setDepositState(DEFAULT_DEPOSIT_STATE);
  }, []);

  const resetPriceRange = useCallback(() => {
    setPriceRangeState(DEFAULT_PRICE_RANGE_STATE);
    setState(prev => ({
      ...prev,
      tickLower: null,
      tickUpper: null,
      isFullRange: true,
      rangePreset: 'full',
    }));
  }, []);

  const resetDeposit = useCallback(() => {
    setDepositState(DEFAULT_DEPOSIT_STATE);
    setState(prev => ({
      ...prev,
      amount0: '',
      amount1: '',
    }));
  }, []);

  // URL sync
  const syncToUrl = useCallback(() => {
    const params = new URLSearchParams();

    params.set('step', state.currentStep.toString());
    if (state.poolId) params.set('pool', state.poolId);
    if (state.mode) params.set('mode', state.mode);
    if (state.token0Symbol) params.set('t0', state.token0Symbol);
    if (state.token1Symbol) params.set('t1', state.token1Symbol);
    if (state.tickLower !== null) params.set('tl', state.tickLower.toString());
    if (state.tickUpper !== null) params.set('tu', state.tickUpper.toString());
    if (state.amount0) params.set('a0', state.amount0);
    if (state.amount1) params.set('a1', state.amount1);

    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [router, pathname, state]);

  // Sync to URL on state changes
  useEffect(() => {
    syncToUrl();
  }, [state.currentStep]); // Only sync on step changes

  const value: AddLiquidityContextType = {
    // Current state
    state,
    priceRangeState,
    depositState,

    // Derived position info (Uniswap pattern)
    derivedPositionInfo,

    // Pool data shortcuts
    poolId,
    pool,
    poolLoading,
    ticks,

    // Pool state data (current price, tick, etc.)
    poolStateData,

    // Refetch function (Uniswap pattern)
    refetchPoolData,

    // Entry configuration
    entryConfig: entryConfig || null,

    // Navigation source for breadcrumbs
    navigationSource,

    // Step navigation
    currentStep,
    setStep,
    goNext,
    goBack,
    canGoBack,
    canGoForward,

    // Modal controls
    openReviewModal,
    closeReviewModal,

    // State setters
    setState,
    setPriceRangeState,
    setDepositState,

    // Convenience setters
    setTokens,
    setPoolId: setPoolIdFn,
    setMode,
    setRange,
    setRangePreset,
    setAmounts,
    setInputSide,

    // Reset functions
    reset,
    resetPriceRange,
    resetDeposit,

    // URL sync
    syncToUrl,
  };

  return (
    <AddLiquidityContext.Provider value={value}>
      {children}
    </AddLiquidityContext.Provider>
  );
}

export function useAddLiquidityContext(): AddLiquidityContextType {
  const context = useContext(AddLiquidityContext);
  if (!context) {
    throw new Error('useAddLiquidityContext must be used within an AddLiquidityProvider');
  }
  return context;
}

// Re-export for compatibility with Uniswap patterns
export { useAddLiquidityContext as useCreateLiquidityContext };
