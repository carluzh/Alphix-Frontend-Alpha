"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { parseAbi } from "viem";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract, usePublicClient } from "wagmi";
import { baseSepolia, getExplorerTxUrl } from "@/lib/wagmiConfig";
import { useUserPositions, useAllPrices, useUncollectedFeesBatch } from "@/components/data/hooks";
import { prefetchService } from "@/lib/prefetch-service";
import { invalidateAfterTx, apolloClient } from "@/lib/apollo";
import { toast } from "sonner";
import { FAUCET_CONTRACT_ADDRESS, faucetContractAbi } from "@/pages/api/misc/faucet";
import poolsConfig from "@/config/pools.json";
import { ChevronUpIcon, ChevronDownIcon, ChevronsUpDownIcon, BadgeCheck, X, Folder, Rows3, Filter as FilterIcon } from "lucide-react";
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getAllPools, getToken, getTokenDefinitions, type TokenSymbol } from "@/lib/pools-config";
import { formatUnits as viemFormatUnits } from "viem";
import { useIncreaseLiquidity, useDecreaseLiquidity } from "@/lib/liquidity/hooks";
import { calculateRealizedApr } from '@/lib/apr';
import { Percent } from '@uniswap/sdk-core';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNetwork } from "@/lib/network-context";
import { TickMath } from '@uniswap/v3-sdk';
import {
  PortfolioChart,
  PortfolioHeader,
  PositionsSection,
  StatsRow,
  ActionGrid,
  RecentActivity,
  PortfolioHeaderSkeleton,
  ActivePositionsSkeleton,
  BalancesPanel,
  BalancesList,
  SkeletonLine,
  TokenPairLogoSkeleton,
} from "./components";
import {
  PortfolioFilterContext,
  useLoadPhases,
  usePortfolio,
  useWalletBalances,
  usePortfolioModals,
} from "./hooks";
import { derivePositionsFromIds, getCachedPositionTimestamps } from '@/lib/client-cache';

const IncreaseLiquidityModal = dynamic(
  () => import("@/components/liquidity/increase").then(m => m.IncreaseLiquidityModal),
  { ssr: false }
);
const DecreaseLiquidityModal = dynamic(
  () => import("@/components/liquidity/decrease").then(m => m.DecreaseLiquidityModal),
  { ssr: false }
);
const PositionDetailsModal = dynamic(
  () => import("@/components/liquidity/PositionDetailsModal").then(m => m.PositionDetailsModal),
  { ssr: false }
);

function formatUSD(num: number) {
  return formatUSDShared(num);
}

function formatUSDHeader(num: number) {
  return formatUSDHeaderShared(num);
}

export default function PortfolioPage() {
  const router = useRouter();
  const { isTestnet, networkMode, chainId: targetChainId } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const [positionsRefresh, setPositionsRefresh] = useState(0);
  const { address: accountAddress, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient();

  // Centralized hooks for positions (Category 2: user-action invalidated)
  const { data: userPositionsData, loading: isLoadingUserPositions, isFetching: isPositionsFetching } = useUserPositions(accountAddress || '');
  const isPositionsStale = isPositionsFetching && !isLoadingUserPositions; // Pulsing during refetch

  // Centralized hook for prices (Category 1: infrequent)
  const { data: pricesData, loading: isLoadingPrices } = useAllPrices();

  const {
    portfolioData,
    activePositions,
    aprByPoolId,
    isLoadingPositions,
    readiness,
    isLoadingPoolStates,
    setActivePositions,
    setIsLoadingPositions,
    setAprByPoolId,
  } = usePortfolio(networkMode, positionsRefresh, userPositionsData, pricesData, isLoadingUserPositions);

  const isLoading = !readiness.core;
  const { phase, showSkeletonFor } = useLoadPhases(readiness);

  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const netApyRef = useRef<HTMLDivElement>(null);
  const [isMobileVisOpen, setIsMobileVisOpen] = useState<boolean>(false);
  const [collapseMaxHeight, setCollapseMaxHeight] = useState<number>(0);
  const [isMobileVisReady, setIsMobileVisReady] = useState<boolean>(false);
  const blockVisContainerRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(1440);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Derive responsive flags from viewportWidth so they update on resize
  const isHiddenVis = viewportWidth <= 1000;
  const isVerySmallScreen = viewportWidth < 695;
  const isNarrowScreen = viewportWidth < 400;
  const poolConfigBySubgraphId = useMemo(() => {
    try {
      const map = new Map<string, any>();
      (poolsConfig?.pools || []).forEach((p: any) => map.set(String(p.subgraphId || '').toLowerCase(), p));
      return map;
    } catch {
      return new Map<string, any>();
    }
  }, []);

  const convertTickToPrice = useCallback((tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string): string => {
    if (tick === TickMath.MAX_TICK) return '∞';
    if (tick === TickMath.MIN_TICK) return '0.00';

    // Preferred: relative to current price when available
    if (currentPoolTick !== null && currentPrice) {
      const currentPriceNum = parseFloat(currentPrice);
      if (isFinite(currentPriceNum) && currentPriceNum > 0) {
        const priceDelta = Math.pow(1.0001, tick - currentPoolTick);
        const priceAtTick = (baseTokenForPriceDisplay === token0Symbol)
          ? 1 / (currentPriceNum * priceDelta)
          : currentPriceNum * priceDelta;
        if (isFinite(priceAtTick)) {
          if (priceAtTick < 1e-11 && priceAtTick > 0) return '0';
          if (priceAtTick > 1e30) return '∞';
          const displayDecimals = 6;
          return priceAtTick.toFixed(displayDecimals);
        }
      }
    }

    // Fallback: absolute price from tick (no current price required)
    try {
      const cfg0 = tokenDefinitions[token0Symbol as TokenSymbol];
      const cfg1 = tokenDefinitions[token1Symbol as TokenSymbol];
      // Fallback-safe token data
      const addr0 = (cfg0?.address || `0x${token0Symbol}`).toLowerCase();
      const addr1 = (cfg1?.address || `0x${token1Symbol}`).toLowerCase();
      const dec0 = cfg0?.decimals ?? 18;
      const dec1 = cfg1?.decimals ?? 18;
      const sorted0IsToken0 = addr0 < addr1;
      const sorted0Decimals = sorted0IsToken0 ? dec0 : dec1;
      const sorted1Decimals = sorted0IsToken0 ? dec1 : dec0;
      // price(sorted1 per sorted0) at tick
      const exp = sorted0Decimals - sorted1Decimals;
      const price01 = Math.pow(1.0001, tick) * Math.pow(10, exp);
      const baseIsToken0 = baseTokenForPriceDisplay === token0Symbol;
      // If base is sorted0, invert; else direct
      const baseMatchesSorted0 = baseIsToken0 === sorted0IsToken0;
      const displayVal = baseMatchesSorted0 ? (price01 === 0 ? Infinity : 1 / price01) : price01;
      if (!isFinite(displayVal) || isNaN(displayVal)) return 'N/A';
      if (displayVal < 1e-11 && displayVal > 0) return '0';
      if (displayVal > 1e30) return '∞';
      const displayDecimals = 6;
      return displayVal.toFixed(displayDecimals);
    } catch {
      return 'N/A';
    }
  }, []);

  // Dynamic layout helpers
  const getColumnGapPx = useCallback((vw: number) => {
    // Mobile: match pool page spacing (~mt-6 = 24px)
    if (vw <= 768) return 24;
    // Desktop/tablet: prior behavior
    if (vw >= 1280) return 16; // gap-4 baseline
    if (vw >= 1100) return 14;
    return 12; // small gap as window shrinks
  }, []);

  // Aliases for faucet logic (uses accountAddress, isConnected, chainId from above)
  const userAddress = accountAddress;
  const userIsConnected = isConnected;
  const currentChainId = chainId;
  const { writeContract } = useWriteContract();
  const faucetAbi = parseAbi(['function faucet() external']);
  const [faucetHash, setFaucetHash] = useState<`0x${string}` | undefined>(undefined);
  const { isLoading: isFaucetConfirming, isSuccess: isFaucetConfirmed } = useWaitForTransactionReceipt({ hash: faucetHash });
  // -1 means unknown (prevents showing active state before cache check like sidebar)
  const [faucetLastClaimTs, setFaucetLastClaimTs] = useState<number>(-1);
  const [isFaucetBusy, setIsFaucetBusy] = useState<boolean>(false);
  const { data: faucetLastCalledOnchain, refetch: refetchFaucetOnchain } = useReadContract({
    address: FAUCET_CONTRACT_ADDRESS,
    abi: faucetContractAbi,
    functionName: 'lastCalled',
    args: [userAddress!],
    chainId: baseSepolia.id,
    query: {
      enabled: userIsConnected && currentChainId === baseSepolia.id && !!userAddress,
    },
  });

  // When confirmed, mirror sidebar behavior: update local cache and button state immediately
  useEffect(() => {
    if (!isFaucetConfirmed || !userAddress) return;
    try {
      const now = Math.floor(Date.now() / 1000);
      localStorage.setItem(`faucetLastClaimTimestamp_${userAddress}`, String(now));
      // Signal sidebar listeners to update unread badge
      localStorage.setItem(`faucetClaimLastSeenAt_${userAddress}`, String(now));
      setFaucetLastClaimTs(now);
      setIsFaucetBusy(false);
      // Success toast for faucet claim
      toast.success('Faucet Claimed', {
        icon: <BadgeCheck className="h-4 w-4 text-sidebar-primary" />,
        className: 'faucet-claimed'
      });
      // Also trigger wallet balances refetch after a brief delay to allow chain state to settle
      setTimeout(() => {
        try {
          localStorage.setItem(`walletBalancesRefreshAt_${userAddress}`, String(Date.now()));
          window.dispatchEvent(new Event('walletBalancesRefresh'));
        } catch {}
      }, 2000);
    } catch {}
  }, [isFaucetConfirmed, userAddress]);

  // Sync cached faucet last-claim timestamp like sidebar does
  useEffect(() => {
    if (!userAddress) {
      setFaucetLastClaimTs(-1);
      return;
    }
    // Prefer onchain if available
    if (faucetLastCalledOnchain !== undefined && faucetLastCalledOnchain !== null) {
      const n = Number(faucetLastCalledOnchain);
      if (Number.isFinite(n) && n > 0) {
        setFaucetLastClaimTs(n);
      }
    }
    try {
      const cached = localStorage.getItem(`faucetLastClaimTimestamp_${userAddress}`);
      setFaucetLastClaimTs(cached ? Number(cached) : 0);
    } catch {
      setFaucetLastClaimTs(0);
    }
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key === `faucetLastClaimTimestamp_${userAddress}`) {
        const next = Number(localStorage.getItem(`faucetLastClaimTimestamp_${userAddress}`) || '0');
        setFaucetLastClaimTs(Number.isFinite(next) ? next : 0);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [userAddress, faucetLastCalledOnchain]);

  // NEW: selector state for switching between sections
  const [selectedSection, setSelectedSection] = useState<string>('Active Positions');
  const isMobile = viewportWidth <= 768;
  const isIntegrateBalances = isTestnet && viewportWidth < 1400 && !isMobile;
  const showBalancesPanel = isTestnet;
  useEffect(() => {
    if (!isIntegrateBalances && selectedSection === 'Balances') {
      setSelectedSection('Active Positions');
    }
  }, [isIntegrateBalances, selectedSection]);

  // Fee fetching for modals
  const allPositionIds = React.useMemo(() => {
    const ids = new Set<string>();
    // Add positions from the table
    if (userPositionsData) {
      userPositionsData.forEach(pos => ids.add(pos.positionId));
    }
    // Add modal positions
    if (positionToModify?.positionId) ids.add(positionToModify.positionId);
    if (positionToWithdraw?.positionId) ids.add(positionToWithdraw.positionId);
    return Array.from(ids).filter(Boolean);
  }, [userPositionsData, positionToModify?.positionId, positionToWithdraw?.positionId]);

  const { data: batchFeesData } = useUncollectedFeesBatch(allPositionIds, 60_000);

  const lastDecreaseWasFullRef = useRef<boolean>(false);
  const lastTxBlockRef = useRef<bigint | null>(null);

  // Wallet balances hook (extracted for cleaner code)
  const { walletBalances, isLoadingWalletBalances } = useWalletBalances({
    isConnected,
    accountAddress,
    publicClient,
    networkMode,
    tokenDefinitions,
    setPositionsRefresh,
  });

  // Helpers
  const formatTokenDisplayAmount = (amount: string) => {
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    if (num === 0) return "0";
    if (num > 0 && num < 0.000001) return "< 0.000001";
    return num.toFixed(6);
  };

  // Enhanced refetching functions (based on pool page logic)
  const refreshSinglePosition = useCallback(async (positionId: string) => {
    if (!accountAddress || !chainId) return;
    try {
      const timestamps = getCachedPositionTimestamps(accountAddress);
      const updatedPositions = await derivePositionsFromIds(accountAddress, [positionId], chainId, timestamps);
      const updatedPosition = updatedPositions[0];

      if (updatedPosition) {
        setActivePositions(prev => {
          const preservedAgeSeconds = updatedPosition.ageSeconds && updatedPosition.ageSeconds > 0
            ? updatedPosition.ageSeconds
            : prev.find(p => p.positionId === positionId)?.ageSeconds;
          return prev.map(p =>
            p.positionId === positionId
              ? { ...updatedPosition, isOptimisticallyUpdating: undefined, ageSeconds: preservedAgeSeconds || updatedPosition.ageSeconds }
              : p
          );
        });
        setSelectedPosition(prev => prev?.positionId === positionId ? updatedPosition : prev);
      } else {
        setActivePositions(prev => prev.map(p =>
          p.positionId === positionId ? { ...p, isOptimisticallyUpdating: undefined } : p
        ));
      }
    } catch (error) {
      setActivePositions(prev => prev.map(p =>
        p.positionId === positionId ? { ...p, isOptimisticallyUpdating: undefined } : p
      ));
    }
  }, [accountAddress, chainId]);

  const refreshAfterMutation = useCallback(async (info?: { txHash?: `0x${string}`; blockNumber?: bigint; poolId?: string; tvlDelta?: number; volumeDelta?: number }) => {
    if (!accountAddress || !chainId) return;

    try {
      await invalidateAfterTx(null, {
        owner: accountAddress,
        chainId,
        poolId: info?.poolId, // Can be undefined for portfolio-wide operations
        reason: 'liquidity-withdrawn',
        awaitSubgraphSync: true,
        blockNumber: info?.blockNumber,
        reloadPositions: true,
        // Pass optimistic updates for pool cache invalidation
        optimisticUpdates: (info?.tvlDelta !== undefined || info?.volumeDelta !== undefined) ? {
          tvlDelta: info.tvlDelta,
          volumeDelta: info.volumeDelta,
        } : undefined,
        onPositionsReloaded: () => {
          // Inline position refresh logic to avoid circular dependency
          try {
            if (accountAddress) prefetchService.notifyPositionsRefresh(accountAddress, 'manual_refresh');
          } catch {}
          setPositionsRefresh((k) => k + 1);
        },
        clearOptimisticStates: () => {
          setActivePositions(prev => prev.map(p => ({ ...p, isOptimisticallyUpdating: undefined })));
        }
      });
    } catch (error) {
      console.error('[Portfolio refreshAfterMutation] failed:', error);
      setActivePositions(prev => prev.map(p => ({ ...p, isOptimisticallyUpdating: undefined })));
    }
  }, [accountAddress]);

  // After-confirmation refresh using the same centralized prefetch hook as pool page
  const bumpPositionsRefresh = useCallback(() => { // Refresh positions after add/withdraw
    try {
      if (accountAddress) prefetchService.notifyPositionsRefresh(accountAddress, 'manual_refresh');
    } catch {}
    setPositionsRefresh((k) => k + 1);
  }, [accountAddress]);

  useEffect(() => {
    // subscribe to centralized refresh events like pool page
    if (!accountAddress) return;
    const unsubscribe = prefetchService.addPositionsListener(accountAddress, () => {
      setPositionsRefresh((k) => k + 1);
    });
    return unsubscribe;
  }, [accountAddress]);

  // Enhanced liquidity hooks with optimistic updates and proper error handling
  const onLiquidityIncreasedCallback = useCallback(async (info?: { txHash?: `0x${string}`; blockNumber?: bigint, increaseAmounts?: { amount0: string; amount1: string }, positionId?: string }) => {
    if (!info?.txHash) return;
    if (handledIncreaseHashRef.current === info.txHash) return;
    handledIncreaseHashRef.current = info.txHash;
    if (pendingActionRef.current?.type !== 'increase') return;
    const now = Date.now();
    if (now - lastRevalidationRef.current < 15000) return;
    lastRevalidationRef.current = now;

    // IMMEDIATE OPTIMISTIC UPDATES (happen with toast)
    const targetPositionId = info?.positionId || positionToModify?.positionId;
    if (targetPositionId && info?.increaseAmounts) {
      // If we have the exact amounts, update optimistically with real values
      setActivePositions(prev => prev.map(p => {
        if (p.positionId === targetPositionId) {
          const currentAmount0 = parseFloat(p.token0.amount || '0');
          const currentAmount1 = parseFloat(p.token1.amount || '0');
          const addedAmount0 = parseFloat(info.increaseAmounts!.amount0 || '0');
          const addedAmount1 = parseFloat(info.increaseAmounts!.amount1 || '0');
          
          return { 
            ...p, 
            token0: { ...p.token0, amount: (currentAmount0 + addedAmount0).toString() },
            token1: { ...p.token1, amount: (currentAmount1 + addedAmount1).toString() },
            isOptimisticallyUpdating: true 
          };
        }
        return p;
      }));
    } else if (targetPositionId) {
      // Fallback to just showing loading state
      setActivePositions(prev => prev.map(p => 
        p.positionId === targetPositionId 
          ? { ...p, isOptimisticallyUpdating: true } 
          : p
      ));
      
      // Safety timeout to clear loading state if refresh fails
      setTimeout(() => {
        setActivePositions(prev => prev.map(p => 
          p.positionId === targetPositionId 
            ? { ...p, isOptimisticallyUpdating: undefined } 
            : p
        ));
      }, 30000); // 30 second timeout
    }

    // Set pool info for stats refresh
    if (positionToModify?.poolId) {
      const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === positionToModify.poolId.toLowerCase());
      if (poolConfig) {
        modifiedPositionPoolInfoRef.current = { poolId: poolConfig.id, subgraphId: positionToModify.poolId };
      }
    }

    setShowIncreaseModal(false);
    pendingActionRef.current = null;
    
    // Background refetch to get updated position data and invalidate global TVL cache
    if (targetPositionId) {
      refreshSinglePosition(targetPositionId).catch(console.error);
    } else {
      bumpPositionsRefresh();
    }

    // Invalidate global pool stats cache for the affected pool
    if (modifiedPositionPoolInfoRef.current) {
      const { poolId } = modifiedPositionPoolInfoRef.current;
      refreshAfterMutation({ txHash: info.txHash, blockNumber: info.blockNumber, poolId }).catch(console.error);
      modifiedPositionPoolInfoRef.current = null;
    }
  }, [refreshSinglePosition, refreshAfterMutation, bumpPositionsRefresh, positionToModify]);

  const onLiquidityDecreasedCallback = useCallback(async (info?: { txHash?: `0x${string}`; blockNumber?: bigint; isFullBurn?: boolean }) => {
    if (!info?.txHash) return;
    if (handledDecreaseHashRef.current === info.txHash) return;
    handledDecreaseHashRef.current = info.txHash;
    if (pendingActionRef.current?.type !== 'decrease' && pendingActionRef.current?.type !== 'withdraw') return;

    const closing = info?.isFullBurn ?? !!lastDecreaseWasFullRef.current;
    const targetPositionId = positionToWithdraw?.positionId;
    
    // IMMEDIATE OPTIMISTIC UPDATES (happen with toast)
    if (targetPositionId) {
      if (closing) {
        // For full burns: immediately remove position from UI and track for flash prevention
        markPositionAsRemoved(targetPositionId);
        setActivePositions(prev => prev.filter(p => p.positionId !== targetPositionId));
      } else {
        // For partial withdrawals: show loading state on the position
        setActivePositions(prev => prev.map(p => 
          p.positionId === targetPositionId 
            ? { ...p, isOptimisticallyUpdating: true } 
            : p
        ));
        
        // Safety timeout to clear loading state if refresh fails
        setTimeout(() => {
          setActivePositions(prev => prev.map(p => 
            p.positionId === targetPositionId 
              ? { ...p, isOptimisticallyUpdating: undefined } 
              : p
          ));
        }, 30000); // 30 second timeout
      }
    }

    // Set pool info for stats refresh
    if (positionToWithdraw?.poolId) {
      const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === positionToWithdraw.poolId.toLowerCase());
      if (poolConfig) {
        modifiedPositionPoolInfoRef.current = { poolId: poolConfig.id, subgraphId: positionToWithdraw.poolId };
      }
    }
    
    // Success notification is handled by useDecreaseLiquidity hook
    setShowWithdrawModal(false);
    setPositionToWithdraw(null);
    pendingActionRef.current = null;

    // Background refetch to correct any optimistic errors and invalidate global TVL cache (guard with 15s cooldown)
    const now = Date.now();
    if (now - lastRevalidationRef.current >= 15000) {
      lastRevalidationRef.current = now;

      // Get poolId for global cache invalidation
      const poolIdForInvalidation = modifiedPositionPoolInfoRef.current?.poolId;

      if (targetPositionId) {
        if (closing) {
          bumpPositionsRefresh();
        } else {
          refreshSinglePosition(targetPositionId).catch(console.error);
        }
      } else {
        refreshAfterMutation({ ...info, poolId: poolIdForInvalidation }).catch(console.error);
      }

      // Invalidate global pool stats cache for the affected pool
      if (poolIdForInvalidation) {
        refreshAfterMutation({ txHash: info?.txHash, blockNumber: info?.blockNumber, poolId: poolIdForInvalidation }).catch(console.error);
      }

      modifiedPositionPoolInfoRef.current = null;
    }
  }, [refreshAfterMutation, refreshSinglePosition, bumpPositionsRefresh, positionToWithdraw]);

  // Enhanced liquidity hooks with proper callbacks
  const { increaseLiquidity, isLoading: isIncreasingLiquidity, isSuccess: isIncreaseSuccess, hash: increaseTxHash } = useIncreaseLiquidity({ 
    onLiquidityIncreased: onLiquidityIncreasedCallback 
  });
  
  const onFeesCollected = useCallback(async (info?: { txHash?: `0x${string}`; blockNumber?: bigint }) => {
    toast.success('Fees Collected', {
      icon: <BadgeCheck className="h-4 w-4 text-green-500" />,
      description: 'Fees successfully collected',
      action: info?.txHash ? {
        label: "View Transaction",
        onClick: () => window.open(getExplorerTxUrl(info.txHash!), '_blank')
      } : undefined
    });
    if (lastTxBlockRef.current) {
      await waitForSubgraphBlock(Number(lastTxBlockRef.current));
      lastTxBlockRef.current = null;
    }
    // Invalidate fees cache so UI shows fees as zero (Apollo cache)
    apolloClient.cache.evict({ fieldName: 'uncollectedFees' });
    apolloClient.cache.gc();
  }, []);

  const handleModalFeesCollected = useCallback((positionId: string) => {
    // Evict the specific position's fees from Apollo cache
    apolloClient.cache.evict({
      id: apolloClient.cache.identify({ __typename: 'FeeItem', positionId }),
    });
    apolloClient.cache.evict({ fieldName: 'uncollectedFees' });
    apolloClient.cache.gc();
  }, []);
  
  const { decreaseLiquidity, claimFees, isLoading: isDecreasingLiquidity, isSuccess: isDecreaseSuccess, hash: decreaseTxHash } = useDecreaseLiquidity({ 
    onLiquidityDecreased: onLiquidityDecreasedCallback, 
    onFeesCollected 
  });

  // Clear optimistic loading state when hook finishes (success or error)
  useEffect(() => {
    if (!isDecreasingLiquidity && pendingActionRef.current?.type === 'collect') {
      setActivePositions(prev => prev.map(p => ({ ...p, isOptimisticallyUpdating: undefined })));
      pendingActionRef.current = null;
    }
  }, [isDecreasingLiquidity]);

  // Token filter state controlled by clicking portfolio composition segments
  const [activeTokenFilter, setActiveTokenFilter] = useState<string | null>(null);
  const [isStickyHover, setIsStickyHover] = useState<boolean>(false);
  
  // Rest cycling state for complex click behavior
  const [restCycleIndex, setRestCycleIndex] = useState<number>(0);
  const [isRestCycling, setIsRestCycling] = useState<boolean>(false);
  
  // Handle Rest cycling click behavior
  const handleRestClick = useCallback((segment: any, segmentIndex?: number) => {
    const restTokens = segment.restTokens || [];
    if (restTokens.length === 0) return;
    
    if (!isRestCycling) {
      // Start cycling, show first token
      setIsRestCycling(true);
      setRestCycleIndex(0);
      setActiveTokenFilter(restTokens[0].label);
      setIsStickyHover(true);
      // Set hover to the Rest segment if index is provided
      if (typeof segmentIndex === 'number') {
        setHoveredSegment(segmentIndex);
      }
    } else {
      // Continue cycling through rest tokens
      const nextIndex = restCycleIndex + 1;
      if (nextIndex >= restTokens.length) {
        // Cycle back to OTHERS after showing all assets
        setIsRestCycling(false);
        setRestCycleIndex(0);
        setActiveTokenFilter(null);
        setIsStickyHover(false);
      } else {
        // Continue to next token
        setRestCycleIndex(nextIndex);
        setActiveTokenFilter(restTokens[nextIndex].label);
      }
    }
  }, [isRestCycling, restCycleIndex]);
  
  // Reset rest cycling when token filter changes externally
  useEffect(() => {
    // Only reset cycling when the user explicitly clears any token filter
    if (!activeTokenFilter) {
      setIsRestCycling(false);
      setRestCycleIndex(0);
    }
  }, [activeTokenFilter]);

  const [hoveredTokenLabel, setHoveredTokenLabel] = useState<string | null>(null);
  const [positionStatusFilter, setPositionStatusFilter] = useState<'all' | 'in-range' | 'out-of-range'>('all');
  const [viewMode, setViewMode] = useState<'folder' | 'list'>('folder');

  const [expandedPools, setExpandedPools] = useState<Record<string, boolean>>({});
  const [balancesSortDir, setBalancesSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedPosition, setSelectedPosition] = useState<any | null>(null);
  const [isPositionModalOpen, setIsPositionModalOpen] = useState(false);

  // Sync selectedPosition with activePositions when positions change
  useEffect(() => {
    if (!selectedPosition || activePositions.length === 0) return;
    const updatedPosition = activePositions.find(p => p.positionId === selectedPosition.positionId);
    if (!updatedPosition) return;

    const hasChanged =
      updatedPosition.token0?.amount !== selectedPosition.token0?.amount ||
      updatedPosition.token1?.amount !== selectedPosition.token1?.amount ||
      updatedPosition.liquidityRaw !== selectedPosition.liquidityRaw;

    if (hasChanged) setSelectedPosition(updatedPosition);
  }, [activePositions, selectedPosition]);

  // Auto-expand pools with <= 2 positions by default
  useEffect(() => {
    // Count positions per pool
    const poolCounts = new Map<string, number>();
    activePositions.forEach(p => {
      const poolKey = String(p?.poolId || '').toLowerCase();
      poolCounts.set(poolKey, (poolCounts.get(poolKey) || 0) + 1);
    });

    setExpandedPools(prev => {
      const newExpanded = { ...prev };
      poolCounts.forEach((count, poolKey) => {
        if (!(poolKey in prev)) {
          newExpanded[poolKey] = count < 3;
        }
      });
      return newExpanded;
    });
  }, [activePositions]);

  const renderSortIcon = (state: 'asc' | 'desc' | null) => {
    if (state === 'asc') return <ChevronUpIcon className="ml-1 h-4 w-4 text-muted-foreground group-hover:text-foreground" />;
    if (state === 'desc') return <ChevronDownIcon className="ml-1 h-4 w-4 text-muted-foreground group-hover:text-foreground" />;
    return <ChevronsUpDownIcon className="ml-1 h-4 w-4 text-muted-foreground group-hover:text-foreground" />;
  };

  const filteredPositions = useMemo(() => {
    if (!activeTokenFilter) return activePositions;
    const token = activeTokenFilter.toUpperCase();
    
    // Handle "OTHERS" filter - show positions with tokens not in top 3
    if (token === 'OTHERS') {
      const total = portfolioData.totalValue;
      const topThreeTokens = portfolioData.tokenBalances
        .map(tb => ({
          symbol: tb.symbol,
          pct: total > 0 ? (tb.usdValue / total) * 100 : 0,
        }))
        .filter(item => item.pct >= 1)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 3)
        .map(tb => tb.symbol.toUpperCase());
      
      return activePositions.filter(p => {
        const token0Upper = p?.token0?.symbol?.toUpperCase?.();
        const token1Upper = p?.token1?.symbol?.toUpperCase?.();
        return (token0Upper && !topThreeTokens.includes(token0Upper)) ||
               (token1Upper && !topThreeTokens.includes(token1Upper));
      });
    }
    
    // Handle specific token filter
    return activePositions.filter(p => (
      (p?.token0?.symbol?.toUpperCase?.() === token) ||
      (p?.token1?.symbol?.toUpperCase?.() === token)
    ));
  }, [activePositions, activeTokenFilter, portfolioData.tokenBalances, portfolioData.totalValue]);

  const statusAndSortFilteredPositions = useMemo(() => {
    let positions = filteredPositions;

    if (positionStatusFilter !== 'all') {
      positions = positions.filter(p => {
        const isInRange = p?.isInRange === true;
        return positionStatusFilter === 'in-range' ? isInRange : !isInRange;
      });
    }

    // Sort by value (default)
    const getValueKey = (p: any) => {
      const sym0 = p?.token0?.symbol as string | undefined;
      const sym1 = p?.token1?.symbol as string | undefined;
      const amt0 = Number.parseFloat(p?.token0?.amount || '0');
      const amt1 = Number.parseFloat(p?.token1?.amount || '0');
      const px0 = (sym0 && portfolioData.priceMap[sym0]) || 0;
      const px1 = (sym1 && portfolioData.priceMap[sym1]) || 0;
      return (isFinite(amt0) ? amt0 : 0) * px0 + (isFinite(amt1) ? amt1 : 0) * px1;
    };

    return [...positions].sort((a, b) => getValueKey(b) - getValueKey(a));
  }, [filteredPositions, positionStatusFilter, portfolioData.priceMap]);

  const getUsdPriceForSymbol = useCallback((symbolRaw?: string): number => {
    if (!symbolRaw) return 0;
    // Match FeesCell's price lookup logic including stable coin fallback
    const stable = (s: string) => s.includes('USDC') || s.includes('USDT');
    const symbolU = symbolRaw.toUpperCase();
    const price = portfolioData.priceMap[symbolRaw] ?? portfolioData.priceMap[symbolU];
    return price || (stable(symbolU) ? 1 : 0);
  }, [portfolioData.priceMap]);

  const togglePoolExpanded = (poolId: string) => {
    setExpandedPools(prev => ({ ...prev, [poolId]: !prev[poolId] }));
  };

  // Enhanced menu actions with pending action tracking
  const openAddLiquidity = useCallback((pos: any, onModalClose?: () => void) => {
    setPositionToModify(pos);
    pendingActionRef.current = { type: 'increase' };
    setShowIncreaseModal(true);
    // Close the menu if callback provided
    if (onModalClose) onModalClose();
  }, []);
  
  const openWithdraw = useCallback((pos: any, onModalClose?: () => void) => {
    setPositionToWithdraw(pos);
    pendingActionRef.current = { type: 'withdraw' };
    setShowWithdrawModal(true);
    // Close the menu if callback provided
    if (onModalClose) onModalClose();
  }, []);

  // Portfolio composition - group into Rest if there are more than 4 assets
  const composition = useMemo(() => {
    const total = portfolioData.totalValue;
    const allItems = portfolioData.tokenBalances
      .map(token => ({
        label: token.symbol,
        pct: total > 0 ? (token.usdValue / total) * 100 : 0,
        color: token.color,
      }))
      .sort((a, b) => b.pct - a.pct);

    if (allItems.length > 4) {
      const topThree = allItems.slice(0, 3);
      const rest = allItems.slice(3);
      const restPct = rest.reduce((sum, item) => sum + item.pct, 0);
      return [
        ...topThree,
        { label: 'Rest', pct: restPct, color: 'hsl(0 0% 70%)', restTokens: rest } as any,
      ];
    }
    if (allItems.length === 0) {
      return [{ label: 'All', pct: 100, color: 'hsl(0 0% 30%)' }];
    }
    return allItems;
  }, [portfolioData.tokenBalances, portfolioData.totalValue]);
  const isPlaceholderComposition = composition.length === 1 && composition[0]?.label === 'All' && Math.round((composition[0]?.pct || 0)) === 100;
  // Keep collapse height in sync when opened and when layout/data change
  useLayoutEffect(() => {
    if (!isHiddenVis) {
      setIsMobileVisOpen(false);
      setCollapseMaxHeight(0);
      return;
    }
    const measure = () => {
      if (blockVisContainerRef.current) {
        setCollapseMaxHeight(blockVisContainerRef.current.scrollHeight);
      }
    };
    if (isMobileVisOpen) {
      // Reset ready state when opening
      setIsMobileVisReady(false);
      
      // measure now and shortly after mount/layout settles
      measure();
      const id = setTimeout(measure, 60);
      
      // Delay rendering the visualization until container is stable
      const readyId = setTimeout(() => {
        setIsMobileVisReady(true);
      }, 150);
      
      window.addEventListener('resize', measure);
      return () => {
        clearTimeout(id);
        clearTimeout(readyId);
        window.removeEventListener('resize', measure);
      };
    } else {
      setIsMobileVisReady(false);
    }
  }, [isHiddenVis, isMobileVisOpen, composition.length]);

  // Calculate proportional value with persistent selection via token filter
  const selectedSegmentIndex = activeTokenFilter
    ? (() => {
        // If Rest is being cycled, always point to the Rest segment
        if (isRestCycling) {
          const restIdx = composition.findIndex(c => c.label === 'Rest');
          return restIdx >= 0 ? restIdx : null;
        }
        
        const idx = composition.findIndex(c => c.label?.toUpperCase?.() === activeTokenFilter.toUpperCase());
        return idx >= 0 ? idx : null;
      })()
    : null;

  const effectiveSegmentIndex = (() => {
    // If Rest is cycling, always lock to the Rest segment regardless of hover
    if (isRestCycling) {
      const restIdx = composition.findIndex(c => c.label === 'Rest');
      return restIdx >= 0 ? restIdx : null;
    }
    // Normal hover logic
    return (isStickyHover && hoveredSegment !== null)
      ? hoveredSegment
      : (activeTokenFilter ? selectedSegmentIndex : (hoveredSegment !== null ? hoveredSegment : null));
  })();

  // Get current filter (active or hover preview) - synchronized with effectiveSegmentIndex
  const currentFilter = (() => {
    if (activeTokenFilter) return activeTokenFilter;
    if (effectiveSegmentIndex !== null && composition[effectiveSegmentIndex]) {
      const segment = composition[effectiveSegmentIndex];
      return segment.label === 'Rest' ? 'Rest' : segment.label;
    }
    return null;
  })();

  // Group positions by pool with sorting support
  const groupedByPool = useMemo(() => {
    const positionsToUse = statusAndSortFilteredPositions;

    if (viewMode === 'list') {
      return positionsToUse.map(p => ({ poolId: p.poolId, items: [p], totalUSD: 0 }));
    }

    const map = new Map<string, any[]>();
    for (const p of positionsToUse) {
      const key = String(p?.poolId || '').toLowerCase();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    const groups = Array.from(map.entries()).map(([poolId, items]) => {
      const totalUSD = items.reduce((sum, p) => {
        const sym0 = p?.token0?.symbol as string | undefined;
        const sym1 = p?.token1?.symbol as string | undefined;
        const amt0 = parseFloat(p?.token0?.amount || '0');
        const amt1 = parseFloat(p?.token1?.amount || '0');
        const price0 = (sym0 && portfolioData.priceMap[sym0]) || 0;
        const price1 = (sym1 && portfolioData.priceMap[sym1]) || 0;
        return sum + amt0 * price0 + amt1 * price1;
      }, 0);
      return { poolId, items, totalUSD };
    });
    // Sort groups by total value desc by default; if previewing sort (hover) or explicit sort exists, honor it
    const effectiveSort = ((typeof activeTokenFilter === 'string' && activeTokenFilter) || (currentFilter && currentFilter !== 'Rest'))
      ? { column: 'token' as const, direction: 'desc' as const }
      : { column: null, direction: null };

    // Handle Rest segment: filter to show only groups with tokens NOT in top 3
    if (currentFilter === 'Rest') {
      const total = portfolioData.totalValue;
      const topThreeTokens = portfolioData.tokenBalances
        .map(tb => ({
          symbol: tb.symbol,
          pct: total > 0 ? (tb.usdValue / total) * 100 : 0,
        }))
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 3)
        .map(item => item.symbol.toUpperCase());

      const restGroups = groups.filter(g =>
        g.items.some(p => {
          const sym0 = p?.token0?.symbol?.toUpperCase();
          const sym1 = p?.token1?.symbol?.toUpperCase();
          return (sym0 && !topThreeTokens.includes(sym0)) || (sym1 && !topThreeTokens.includes(sym1));
        })
      );

      // Sort rest groups by value
      return restGroups.sort((a, b) => b.totalUSD - a.totalUSD);
    }

    // Token-hover preview: if hovering, hide groups without token; if not hovering but filtered, also gate groups
    if (effectiveSort.column === 'token' && effectiveSort.direction) {
      const token = (currentFilter && currentFilter !== 'Rest') ? String(currentFilter).toUpperCase()
        : ((typeof activeTokenFilter === 'string' && activeTokenFilter) ? String(activeTokenFilter).toUpperCase() : null);
      if (token) {
        groups.sort((a, b) => {
          const aHas = a.items.some((p) => p?.token0?.symbol?.toUpperCase?.() === token || p?.token1?.symbol?.toUpperCase?.() === token);
          const bHas = b.items.some((p) => p?.token0?.symbol?.toUpperCase?.() === token || p?.token1?.symbol?.toUpperCase?.() === token);
          if (aHas !== bHas) return aHas ? -1 : 1;
          // fallback by value desc
          return b.totalUSD - a.totalUSD;
        });
        return groups.filter((g) => g.items.some((p) => p?.token0?.symbol?.toUpperCase?.() === token || p?.token1?.symbol?.toUpperCase?.() === token));
      }
    }
    // Default: sort groups by total value descending
    groups.sort((a, b) => b.totalUSD - a.totalUSD);
    return groups;
  }, [statusAndSortFilteredPositions, viewMode, portfolioData.priceMap, activeTokenFilter, currentFilter]);

  const hasFolders = useMemo(() => {
    const map = new Map<string, number>();
    statusAndSortFilteredPositions.forEach(p => {
      const key = String(p?.poolId || '').toLowerCase();
      map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.values()).some(count => count > 2);
  }, [statusAndSortFilteredPositions]);

  // Filtered position count for metrics display
  const filteredPositionCount = useMemo(() => {
    if (!currentFilter) return activePositions.length;

    const token = String(currentFilter).toUpperCase();
    if (token === 'OTHERS' || token === 'Rest') {
      const total = portfolioData.totalValue;
      const topThreeTokens = portfolioData.tokenBalances
        .map(tb => ({
          symbol: tb.symbol,
          pct: total > 0 ? (tb.usdValue / total) * 100 : 0,
        }))
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 3)
        .map(item => item.symbol.toUpperCase());

      return activePositions.filter(p => {
        const sym0 = p?.token0?.symbol?.toUpperCase();
        const sym1 = p?.token1?.symbol?.toUpperCase();
        return (sym0 && !topThreeTokens.includes(sym0)) || (sym1 && !topThreeTokens.includes(sym1));
      }).length;
    }

    return activePositions.filter(p => {
      const sym0 = p?.token0?.symbol?.toUpperCase();
      const sym1 = p?.token1?.symbol?.toUpperCase();
      return sym0 === token || sym1 === token;
    }).length;
  }, [currentFilter, activePositions, portfolioData.tokenBalances, portfolioData.totalValue, composition, effectiveSegmentIndex]);

  // Filtered total fees for metrics display

  // Clicked + Hover combined logic for header USD
  const displayValue = (() => {
    const clicked = (activeTokenFilter && activeTokenFilter !== 'Rest') ? activeTokenFilter.toUpperCase() : null;
    const hovered = (hoveredTokenLabel && hoveredTokenLabel !== 'Rest') ? hoveredTokenLabel.toUpperCase() : null;
    if (!clicked && !hovered) {
      return effectiveSegmentIndex !== null && composition[effectiveSegmentIndex]
        ? (portfolioData.totalValue * composition[effectiveSegmentIndex].pct) / 100
        : portfolioData.totalValue;
    }
    // Sum USD over positions matching (clicked) AND if hovered present, also positions matching hovered
    const matches = (p: any, token: string | null) => {
      if (!token) return true;
      const s0 = p?.token0?.symbol?.toUpperCase?.();
      const s1 = p?.token1?.symbol?.toUpperCase?.();
      return s0 === token || s1 === token;
    };
    let sum = 0;
    for (const p of activePositions) {
      if (!matches(p, clicked)) continue;
      if (hovered && !matches(p, hovered)) continue;
      const s0 = p?.token0?.symbol as string | undefined;
      const s1 = p?.token1?.symbol as string | undefined;
      const a0 = parseFloat(p?.token0?.amount || '0');
      const a1 = parseFloat(p?.token1?.amount || '0');
      const px0 = (s0 && portfolioData.priceMap[s0.toUpperCase()]) || (s0 && portfolioData.priceMap[s0]) || 0;
      const px1 = (s1 && portfolioData.priceMap[s1.toUpperCase()]) || (s1 && portfolioData.priceMap[s1]) || 0;
      sum += (isFinite(a0) ? a0 : 0) * px0 + (isFinite(a1) ? a1 : 0) * px1;
    }
    return sum;
  })();

  // Effective token label for hover/selection
  const effectiveTokenLabel = (() => {
    if (effectiveSegmentIndex === null || !composition[effectiveSegmentIndex]) return null;
    
    const segment = composition[effectiveSegmentIndex];
    
    // If Rest is being cycled, always show the current cycled token
    if (segment.label === 'Rest' && isRestCycling) {
      const restTokens = (segment as any)?.restTokens || [];
      return restTokens[restCycleIndex]?.label || 'Rest';
    }
    
    return segment.label;
  })();

  // Calculate effective PnL (24h) based on hover/filter
  const pnl24hPct = (() => {
    if (!effectiveTokenLabel) return portfolioData.pnl24hPct || 0;
    
    if (effectiveTokenLabel === 'Rest') {
      // For Rest, calculate weighted average of all rest tokens
      const segment = composition[effectiveSegmentIndex!];
      const restTokens = (segment as any)?.restTokens || [];
      let weightedPnl = 0;
      let totalWeight = 0;
      
      restTokens.forEach((token: any) => {
        const pnl = portfolioData.priceChange24hPctMap[token.label] ?? 0;
        weightedPnl += pnl * token.pct;
        totalWeight += token.pct;
      });
      
      return totalWeight > 0 ? weightedPnl / totalWeight : 0;
    }
    
    return portfolioData.priceChange24hPctMap[effectiveTokenLabel] ?? 0;
  })();

  const effectiveAprPct = (() => {
    if (!batchFeesData || !Array.isArray(batchFeesData)) return null;
    const clicked = (activeTokenFilter && activeTokenFilter !== 'Rest') ? activeTokenFilter.toUpperCase() : null;
    const hovered = (currentFilter && currentFilter !== 'Rest') ? currentFilter.toUpperCase() : null;

    let candidates = activePositions as any[];
    if (clicked || hovered) {
      candidates = candidates.filter((p) => {
        const s0u = p?.token0?.symbol?.toUpperCase?.();
        const s1u = p?.token1?.symbol?.toUpperCase?.();
        if (clicked && !(s0u === clicked || s1u === clicked)) return false;
        if (hovered && !(s0u === hovered || s1u === hovered)) return false;
        return true;
      });
    } else if (effectiveTokenLabel === 'Rest' && effectiveSegmentIndex !== null && composition[effectiveSegmentIndex]) {
      const segment = composition[effectiveSegmentIndex];
      const restTokens = (segment as any)?.restTokens || [];
      const restTokenSymbols = restTokens.map((t: any) => String(t.label || '').toUpperCase());
      candidates = candidates.filter((p) => {
        const s0 = p?.token0?.symbol?.toUpperCase?.();
        const s1 = p?.token1?.symbol?.toUpperCase?.();
        return (s0 && restTokenSymbols.includes(s0)) || (s1 && restTokenSymbols.includes(s1));
      });
    }

    let weighted = 0;
    let totalUsd = 0;
    for (const p of candidates) {
      const sym0 = p?.token0?.symbol as string | undefined;
      const sym1 = p?.token1?.symbol as string | undefined;
      const amt0 = parseFloat(p?.token0?.amount || '0');
      const amt1 = parseFloat(p?.token1?.amount || '0');
      const px0 = (sym0 && portfolioData.priceMap[sym0.toUpperCase()]) || (sym0 && portfolioData.priceMap[sym0]) || 0;
      const px1 = (sym1 && portfolioData.priceMap[sym1.toUpperCase()]) || (sym1 && portfolioData.priceMap[sym1]) || 0;
      const positionUsd = (isFinite(amt0) ? amt0 : 0) * px0 + (isFinite(amt1) ? amt1 : 0) * px1;
      if (positionUsd <= 0) continue;

      const feeData = batchFeesData.find(f => f.positionId === p.positionId);
      let feesUSD = 0;
      if (feeData) {
        const raw0 = feeData.amount0 || '0';
        const raw1 = feeData.amount1 || '0';
        const d0 = (sym0 ? tokenDefinitions?.[sym0 as string]?.decimals : undefined) ?? 18;
        const d1 = (sym1 ? tokenDefinitions?.[sym1 as string]?.decimals : undefined) ?? 18;
        try {
          const fee0 = parseFloat(viemFormatUnits(BigInt(raw0), d0));
          const fee1 = parseFloat(viemFormatUnits(BigInt(raw1), d1));
          feesUSD = (isFinite(fee0) ? fee0 : 0) * px0 + (isFinite(fee1) ? fee1 : 0) * px1;
        } catch {}
      }

      const poolKey = String(p?.poolId || '').toLowerCase();
      const aprStr = aprByPoolId[poolKey];
      const poolApr = typeof aprStr === 'string' && aprStr.endsWith('%') ? parseFloat(aprStr.replace('%', '')) : null;
      const lastTs = p.lastTimestamp || p.blockTimestamp || 0;
      const nowTs = Math.floor(Date.now() / 1000);
      const durationDays = (nowTs - lastTs) / 86400;
      const fallbackAprPercent = poolApr !== null && isFinite(poolApr) ? new Percent(Math.round(poolApr * 100), 10000) : null;
      const { apr } = calculateRealizedApr(feesUSD, positionUsd, durationDays, fallbackAprPercent);
      const positionApy = apr ? parseFloat(apr.toFixed(2)) : 0;

      weighted += positionUsd * positionApy;
      totalUsd += positionUsd;
    }
    if (totalUsd <= 0) return null;
    return weighted / totalUsd;
  })();

  const totalFeesUSD = (() => {
    if (!batchFeesData || !Array.isArray(batchFeesData)) return 0;
    let sum = 0;
    for (const p of activePositions) {
      const feeData = batchFeesData.find(f => f.positionId === p.positionId);
      if (!feeData) continue;
      const raw0 = feeData.amount0 || '0';
      const raw1 = feeData.amount1 || '0';
      const sym0 = p?.token0?.symbol as string | undefined;
      const sym1 = p?.token1?.symbol as string | undefined;
      const d0 = (sym0 ? tokenDefinitions?.[sym0 as string]?.decimals : undefined) ?? 18;
      const d1 = (sym1 ? tokenDefinitions?.[sym1 as string]?.decimals : undefined) ?? 18;
      try {
        const fee0 = parseFloat(viemFormatUnits(BigInt(raw0), d0));
        const fee1 = parseFloat(viemFormatUnits(BigInt(raw1), d1));
        const px0 = (sym0 && portfolioData.priceMap[sym0.toUpperCase()]) || (sym0 && portfolioData.priceMap[sym0]) || 0;
        const px1 = (sym1 && portfolioData.priceMap[sym1.toUpperCase()]) || (sym1 && portfolioData.priceMap[sym1]) || 0;
        sum += (isFinite(fee0) ? fee0 : 0) * px0 + (isFinite(fee1) ? fee1 : 0) * px1;
      } catch {}
    }
    return sum;
  })();

  const isPositive = pnl24hPct >= 0;
  const forceHideLabels = (!isConnected || activePositions.length === 0) && portfolioData.tokenBalances.length === 0;

  // Show skeleton during loading, empty state only after data is loaded
  if (showSkeletonFor.header || showSkeletonFor.table) {
    return (
      <>
        <div className="flex flex-1 flex-col p-3 sm:p-6 overflow-x-hidden">
          <PortfolioHeaderSkeleton viewportWidth={viewportWidth} />

          <div className="mt-6">
            <div className="flex-1 min-w-0">
              {isMobile ? (
                <div className="flex flex-col gap-3">
                  {[...Array(3)].map((_, idx) => (
                    <div key={idx} className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <TokenPairLogoSkeleton size={24} />
                        <div className="flex-1 space-y-2 min-w-0">
                          <SkeletonLine className="h-4 w-24 sm:w-32" />
                          <SkeletonLine className="h-3 w-32 sm:w-40" />
                        </div>
                        <div className="text-right space-y-1">
                          <SkeletonLine className="h-4 w-16" />
                          <SkeletonLine className="h-3 w-12" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <ActivePositionsSkeleton />
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <PortfolioFilterContext.Provider value={{ activeTokenFilter, setActiveTokenFilter, isStickyHover, setIsStickyHover, hoverTokenLabel: effectiveTokenLabel }}>
      <>
      <div className="flex flex-1 flex-col p-3 sm:p-6 overflow-x-hidden max-w-full w-full">
        {/* Portfolio header */}
        <PortfolioHeader
          displayValue={displayValue}
          pnl24hPct={pnl24hPct}
          isPlaceholderComposition={isPlaceholderComposition}
          filteredPositionCount={filteredPositionCount}
          effectiveAprPct={effectiveAprPct}
          totalFeesUSD={totalFeesUSD}
          composition={composition}
          hoveredSegment={hoveredSegment}
          setHoveredSegment={setHoveredSegment}
          forceHideLabels={forceHideLabels}
          handleRestClick={handleRestClick}
          setIsRestCycling={setIsRestCycling}
          isRestCycling={isRestCycling}
          restCycleIndex={restCycleIndex}
          activeTokenFilter={activeTokenFilter}
          setActiveTokenFilter={setActiveTokenFilter}
          setHoveredTokenLabel={setHoveredTokenLabel}
          containerRef={containerRef}
          netApyRef={netApyRef}
          viewportWidth={viewportWidth}
          isVerySmallScreen={isVerySmallScreen}
          isNarrowScreen={isNarrowScreen}
          showSkeleton={showSkeletonFor.header}
        />

        {/* NEW: Portfolio Overview Section - Chart, Stats, Actions */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Portfolio Chart - spans 2 columns on desktop */}
          <div className="lg:col-span-2">
            <PortfolioChart currentValue={displayValue} />
          </div>

          {/* Right sidebar: Stats + Actions */}
          <div className="flex flex-col gap-4">
            <StatsRow />
            <ActionGrid layout="2x2" />
          </div>
        </div>

        {/* NEW: Portfolio sections with selector + right Balances aside */}
        <div className="mt-6 flex flex-col lg:flex-row" style={{ gap: `${getColumnGapPx(viewportWidth)}px` }}>
          {/* Mobile: Show Balances first (only on testnet) */}
          {showBalancesPanel && isMobile && !isIntegrateBalances && (
            <BalancesPanel
              width={viewportWidth >= 1024 ? '450px' : '100%'}
              walletBalances={walletBalances}
              isLoadingWalletBalances={isLoadingWalletBalances}
              isConnected={isConnected}
              balancesSortDir={balancesSortDir}
              setBalancesSortDir={setBalancesSortDir}
              renderSortIcon={renderSortIcon}
              showSkeleton={showSkeletonFor.table}
              faucetLastClaimTs={faucetLastClaimTs}
              faucetLastCalledOnchain={faucetLastCalledOnchain}
              currentChainId={currentChainId}
              isFaucetBusy={isFaucetBusy}
              isFaucetConfirming={isFaucetConfirming}
              accountAddress={accountAddress}
              setIsFaucetBusy={setIsFaucetBusy}
              setFaucetHash={setFaucetHash}
              writeContract={writeContract}
              faucetAbi={faucetAbi}
              refetchFaucetOnchain={refetchFaucetOnchain}
            />
          )}

          <div className="flex-1 min-w-0">
          {/* Your Positions title */}
          <div className="flex items-center gap-2 mb-4 justify-between">
            <h3 className={`text-lg font-medium ${isPositionsStale ? 'cache-stale' : ''}`}>Your Positions</h3>
            {/* Right: token filter badge area + Faucet (only show faucet when Balances tab active in integrated mode) */}
            <div className="ml-auto flex items-center gap-2">
              {selectedSection === 'Active Positions' && activePositions.length > 0 && (
                <>
                  {hasFolders && (
                    <div className="h-8 rounded-md border border-sidebar-border bg-container flex items-center p-0.5 gap-0.5">
                      <button
                        onClick={() => {
                          setViewMode('folder');
                        }}
                        className={cn(
                          "h-full px-2 rounded flex items-center justify-center transition-all",
                          viewMode === 'folder' ? "bg-button text-foreground" : "bg-transparent text-muted-foreground hover:text-foreground"
                        )}
                        style={viewMode === 'folder' ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                      >
                        <Folder className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setViewMode('list');
                          setExpandedPools({});
                        }}
                        className={cn(
                          "h-full px-2 rounded flex items-center justify-center transition-all",
                          viewMode === 'list' ? "bg-button text-foreground" : "bg-transparent text-muted-foreground hover:text-foreground"
                        )}
                        style={viewMode === 'list' ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                      >
                        <Rows3 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button className="h-8 px-3 rounded-md border border-sidebar-border bg-container hover:bg-surface text-muted-foreground hover:text-foreground flex items-center gap-2 text-xs transition-colors">
                        <FilterIcon className="h-3.5 w-3.5" />
                        <span>Filter</span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-0 bg-container border-sidebar-border" align="end">
                      <div className="p-4 space-y-4">
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">Status</label>
                          <div className="space-y-1">
                            {[
                              { value: 'all', label: 'All Positions' },
                              { value: 'in-range', label: 'In Range' },
                              { value: 'out-of-range', label: 'Out of Range' }
                            ].map(option => (
                              <button
                                key={option.value}
                                onClick={() => setPositionStatusFilter(option.value as any)}
                                className={cn(
                                  "w-full text-left px-2 py-1.5 rounded text-xs transition-colors",
                                  positionStatusFilter === option.value
                                    ? "bg-surface text-foreground font-medium"
                                    : "text-muted-foreground hover:text-foreground hover:bg-surface/50"
                                )}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* TODO: Sort By - to be implemented */}
                        {/* <Separator className="bg-sidebar-border" />
                        <div className="space-y-2">
                          <label className="text-xs font-medium text-muted-foreground">Sort By</label>
                          <div className="space-y-1">
                            {[
                              { value: 'value', label: 'Position Size' },
                              { value: 'fees', label: 'Fees' },
                              { value: 'apr', label: 'APR' }
                            ].map(option => (
                              <button
                                key={option.value}
                                onClick={() => {}}
                                className="w-full text-left px-2 py-1.5 rounded text-xs transition-colors text-muted-foreground hover:text-foreground hover:bg-surface/50"
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div> */}
                      </div>
                    </PopoverContent>
                  </Popover>
                </>
              )}
              {activeTokenFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveTokenFilter(null);
                    setIsStickyHover(false);
                    setIsRestCycling(false);
                  }}
                  className="group flex items-center gap-1 px-2 py-1 rounded-md border border-sidebar-border/60 bg-muted/40 text-xs text-muted-foreground hover:bg-muted/50 relative"
                >
                  {isRestCycling && (
                    <div 
                      className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md"
                      style={{ backgroundColor: 'hsl(var(--sidebar-primary))' }}
                    />
                  )}
                  <X className="h-3 w-3 text-muted-foreground transition-colors group-hover:text-foreground" />
                  <span className="uppercase tracking-wider text-muted-foreground font-mono font-bold text-xs">{activeTokenFilter}</span>
                </button>
              )}
              
              {/* Filter removed */}
            </div>
          </div>
          <div>
            <div>
              {/* Active Positions */}
              {selectedSection === 'Active Positions' && (
                <PositionsSection
                  groupedByPool={groupedByPool}
                  activePositions={activePositions}
                  portfolioData={portfolioData}
                  aprByPoolId={aprByPoolId}
                  batchFeesData={batchFeesData}
                  tokenDefinitions={tokenDefinitions}
                  expandedPools={expandedPools}
                  togglePoolExpanded={togglePoolExpanded}
                  isConnected={isConnected}
                  showSkeleton={showSkeletonFor.table}
                  isPositionsStale={isPositionsStale}
                  isNarrowScreen={isNarrowScreen}
                  viewMode={viewMode}
                  readiness={readiness}
                  isLoadingPoolStates={isLoadingPoolStates}
                  getUsdPriceForSymbol={getUsdPriceForSymbol}
                  convertTickToPrice={convertTickToPrice}
                  onPositionClick={(position) => {
                    setSelectedPosition(position);
                    setIsPositionModalOpen(true);
                  }}
                  onVisitPool={(position) => {
                    const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === position.poolId.toLowerCase());
                    if (poolConfig) {
                      window.open(`/liquidity/${poolConfig.id}`, '_blank');
                    }
                  }}
                />
              )}

              {/* Balances as a tab when integrated (desktop/tablet only) */}
              {isIntegrateBalances && selectedSection === 'Balances' && (
                <BalancesList
                  walletBalances={walletBalances}
                  isLoadingWalletBalances={isLoadingWalletBalances}
                  isConnected={isConnected}
                  balancesSortDir={balancesSortDir}
                  setBalancesSortDir={setBalancesSortDir}
                  renderSortIcon={renderSortIcon}
                  variant="card"
                />
              )}

            </div>
          </div>
          </div>
          {/* Right-side: Balances (desktop only, testnet only) */}
          {showBalancesPanel && !isIntegrateBalances && !isMobile && (
            <BalancesPanel
              width={viewportWidth >= 1024 ? '450px' : '100%'}
              walletBalances={walletBalances}
              isLoadingWalletBalances={isLoadingWalletBalances}
              isConnected={isConnected}
              balancesSortDir={balancesSortDir}
              setBalancesSortDir={setBalancesSortDir}
              renderSortIcon={renderSortIcon}
              faucetLastClaimTs={faucetLastClaimTs}
              faucetLastCalledOnchain={faucetLastCalledOnchain}
              currentChainId={currentChainId}
              isFaucetBusy={isFaucetBusy}
              isFaucetConfirming={isFaucetConfirming}
              accountAddress={accountAddress}
              setIsFaucetBusy={setIsFaucetBusy}
              setFaucetHash={setFaucetHash}
              writeContract={writeContract}
              faucetAbi={faucetAbi}
              refetchFaucetOnchain={refetchFaucetOnchain}
            />
          )}
        </div>

        {/* Recent Activity Section */}
        <div className="mt-6">
          <RecentActivity maxItems={5} />
        </div>
        {/* no third state below 1100px */}
      </div>
        {/* Increase Liquidity Modal */}
        {positionToModify && (
          <IncreaseLiquidityModal
            isOpen={showIncreaseModal}
            onClose={() => {
              setShowIncreaseModal(false);
              setPositionToModify(null);
            }}
            position={positionToModify}
            onSuccess={() => {
              const poolSubgraphId = positionToModify?.poolId;
              if (poolSubgraphId) {
                const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === poolSubgraphId.toLowerCase());
                if (poolConfig) {
                  modifiedPositionPoolInfoRef.current = { poolId: poolConfig.id, subgraphId: poolSubgraphId };
                }
              }
              publicClient?.getBlockNumber().then(block => lastTxBlockRef.current = block);
              pendingActionRef.current = { type: 'increase' };
            }}
          />
        )}

        {/* Withdraw Modal */}
        {positionToWithdraw && (
          <DecreaseLiquidityModal
            isOpen={showWithdrawModal}
            onClose={() => {
              setShowWithdrawModal(false);
              setPositionToWithdraw(null);
            }}
            position={positionToWithdraw}
            onSuccess={() => {
              const poolSubgraphId = positionToWithdraw?.poolId;
              if (poolSubgraphId) {
                const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === poolSubgraphId.toLowerCase());
                if (poolConfig) {
                  modifiedPositionPoolInfoRef.current = { poolId: poolConfig.id, subgraphId: poolSubgraphId };
                }
              }
              publicClient?.getBlockNumber().then(block => lastTxBlockRef.current = block);
              pendingActionRef.current = { type: 'decrease' };
            }}
          />
        )}

      {selectedPosition && (
        <PositionDetailsModal
          isOpen={isPositionModalOpen}
          onClose={() => {
            setIsPositionModalOpen(false);
            setSelectedPosition(null);
          }}
          position={selectedPosition}
          valueUSD={(() => {
            const sym0 = selectedPosition.token0?.symbol;
            const sym1 = selectedPosition.token1?.symbol;
            const price0 = getUsdPriceForSymbol(sym0);
            const price1 = getUsdPriceForSymbol(sym1);
            const amt0 = parseFloat(selectedPosition.token0?.amount || '0');
            const amt1 = parseFloat(selectedPosition.token1?.amount || '0');
            return amt0 * price0 + amt1 * price1;
          })()}
          prefetchedRaw0={batchFeesData?.find(f => f.positionId === selectedPosition.positionId)?.amount0 ?? null}
          prefetchedRaw1={batchFeesData?.find(f => f.positionId === selectedPosition.positionId)?.amount1 ?? null}
          formatTokenDisplayAmount={formatTokenDisplayAmount}
          getUsdPriceForSymbol={getUsdPriceForSymbol}
          onRefreshPosition={() => refreshSinglePosition(selectedPosition.positionId)}
          onLiquidityDecreased={(info) => {
            // Set positionToWithdraw and pendingActionRef so the callback knows which position to remove
            setPositionToWithdraw(selectedPosition);
            pendingActionRef.current = { type: 'withdraw' };
            onLiquidityDecreasedCallback(info);
          }}
          onAfterLiquidityAdded={(tvlDelta, info) => {
            // Trigger global cache invalidation for this pool with optimistic updates
            const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === selectedPosition.poolId?.toLowerCase());
            if (poolConfig?.id) {
              refreshAfterMutation({
                txHash: info.txHash,
                blockNumber: info.blockNumber,
                poolId: poolConfig.id,
                tvlDelta, // Pass TVL delta for pool cache invalidation
              }).catch(console.error);
            }
          }}
          onAfterLiquidityRemoved={(tvlDelta, info) => {
            // Trigger global cache invalidation for this pool with optimistic updates
            const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === selectedPosition.poolId?.toLowerCase());
            if (poolConfig?.id) {
              refreshAfterMutation({
                txHash: info.txHash,
                blockNumber: info.blockNumber,
                poolId: poolConfig.id,
                tvlDelta, // Pass TVL delta (negative for removal) for pool cache invalidation
              }).catch(console.error);
            }
          }}
          currentPrice={null}
          currentPoolTick={null}
          convertTickToPrice={convertTickToPrice}
          selectedPoolId={(() => {
            const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === selectedPosition.poolId?.toLowerCase());
            return poolConfig?.id;
          })()}
          chainId={targetChainId}
          currentPoolSqrtPriceX96={null}
          poolToken0={(() => {
            const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === selectedPosition.poolId?.toLowerCase());
            return poolConfig ? getToken(poolConfig.currency0.symbol) : undefined;
          })()}
          poolToken1={(() => {
            const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === selectedPosition.poolId?.toLowerCase());
            return poolConfig ? getToken(poolConfig.currency1.symbol) : undefined;
          })()}
          showViewPoolButton={true}
          onFeesCollected={handleModalFeesCollected}
          onViewPool={() => {
            const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === selectedPosition.poolId?.toLowerCase());
            if (poolConfig) {
              router.push(`/liquidity/${poolConfig.id}`);
            }
          }}
        />
      )}

      </>
    </PortfolioFilterContext.Provider>
  );
}