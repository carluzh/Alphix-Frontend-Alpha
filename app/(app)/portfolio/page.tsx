"use client";

import React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { formatUnits as viemFormatUnits } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { useUserPositions, useAllPrices, useUncollectedFeesBatch } from "@/components/data/hooks";
import { ChevronUpIcon, ChevronDownIcon, ChevronsUpDownIcon, X, Folder, Rows3, Filter as FilterIcon } from "lucide-react";
import { cn } from '@/lib/utils';
import { getAllPools, getToken, getTokenDefinitions, type TokenSymbol } from "@/lib/pools-config";
import { calculateRealizedApr } from '@/lib/apr';
import { Percent } from '@uniswap/sdk-core';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNetwork } from "@/lib/network-context";
import { TickMath } from '@uniswap/v3-sdk';
import {
  PortfolioChart,
  PositionsSection,
  StatsRow,
  ActionGrid,
  ActivePositionsSkeleton,
  BalancesPanel,
  SkeletonLine,
  TokenPairLogoSkeleton,
  PortfolioHeaderSkeleton,
  PortfolioTabs,
  OverviewTab,
  TokensTab,
  ActivityTab,
} from "./components";
import type { PortfolioTabId, ActivityItem } from "./components";
import {
  PortfolioFilterContext,
  useLoadPhases,
  usePortfolio,
  useWalletBalances,
  usePortfolioModals,
  useFaucet,
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
  const { data: pricesData } = useAllPrices();

  const {
    portfolioData,
    activePositions,
    aprByPoolId,
    readiness,
    isLoadingPoolStates,
    setActivePositions,
  } = usePortfolio(networkMode, positionsRefresh, userPositionsData, pricesData, isLoadingUserPositions);

  const { showSkeletonFor } = useLoadPhases(readiness);

  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const netApyRef = useRef<HTMLDivElement>(null);
  const [isMobileVisOpen, setIsMobileVisOpen] = useState<boolean>(false);
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

  // Faucet hook (testnet only)
  const {
    writeContract,
    faucetAbi,
    setFaucetHash,
    isFaucetConfirming,
    faucetLastClaimTs,
    isFaucetBusy,
    setIsFaucetBusy,
    faucetLastCalledOnchain,
    refetchFaucetOnchain,
  } = useFaucet({
    userAddress: accountAddress,
    userIsConnected: isConnected,
    currentChainId: chainId,
  });

  // Tab state for Uniswap-style navigation
  const [activeTab, setActiveTab] = useState<PortfolioTabId>("overview");

  // Activity data state (fetched from API)
  const [activityData, setActivityData] = useState<ActivityItem[]>([]);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);

  // Fetch activity when tab changes to activity or overview (both need activity data)
  useEffect(() => {
    if ((activeTab === "activity" || activeTab === "overview") && accountAddress && activityData.length === 0) {
      setIsLoadingActivity(true);
      fetch(`/api/portfolio/activity?address=${accountAddress}&limit=20&network=${networkMode}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.activities) {
            setActivityData(data.activities);
          }
        })
        .catch(console.error)
        .finally(() => setIsLoadingActivity(false));
    }
  }, [activeTab, accountAddress, activityData.length, networkMode]);

  // Selector state for switching between sections (legacy - keeping for balances integration)
  const [selectedSection, setSelectedSection] = useState<string>('Active Positions');
  const isMobile = viewportWidth <= 768;
  const isIntegrateBalances = isTestnet && viewportWidth < 1400 && !isMobile;
  const showBalancesPanel = isTestnet;
  useEffect(() => {
    if (!isIntegrateBalances && selectedSection === 'Balances') {
      setSelectedSection('Active Positions');
    }
  }, [isIntegrateBalances, selectedSection]);

  // Wallet balances hook (extracted for cleaner code)
  const { walletBalances, isLoadingWalletBalances } = useWalletBalances({
    isConnected,
    accountAddress,
    publicClient,
    networkMode,
    tokenDefinitions,
    setPositionsRefresh,
  });

  // Enhanced refetching function for single position
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
      } else {
        setActivePositions(prev => prev.map(p =>
          p.positionId === positionId ? { ...p, isOptimisticallyUpdating: undefined } : p
        ));
      }
    } catch {
      setActivePositions(prev => prev.map(p =>
        p.positionId === positionId ? { ...p, isOptimisticallyUpdating: undefined } : p
      ));
    }
  }, [accountAddress, chainId, setActivePositions]);

  // Portfolio modals hook - handles all modal state and callbacks
  const {
    showIncreaseModal,
    showWithdrawModal,
    positionToModify,
    positionToWithdraw,
    selectedPosition,
    isPositionModalOpen,
    closeIncreaseModal,
    closeWithdrawModal,
    openPositionModal,
    closePositionModal,
    setPositionToWithdraw,
    onIncreaseSuccess,
    onDecreaseSuccess,
    handleModalFeesCollected,
    onLiquidityDecreasedCallback,
    refreshAfterMutation,
    pendingActionRef,
  } = usePortfolioModals({
    accountAddress,
    activePositions,
    setActivePositions,
    setPositionsRefresh,
    refreshSinglePosition,
  });

  // Fee fetching for all positions
  const allPositionIds = React.useMemo(() => {
    const ids = new Set<string>();
    if (userPositionsData) {
      userPositionsData.forEach(pos => ids.add(pos.positionId));
    }
    if (positionToModify?.positionId) ids.add(positionToModify.positionId);
    if (positionToWithdraw?.positionId) ids.add(positionToWithdraw.positionId);
    return Array.from(ids).filter(Boolean);
  }, [userPositionsData, positionToModify?.positionId, positionToWithdraw?.positionId]);

  const { data: batchFeesData } = useUncollectedFeesBatch(allPositionIds, 60_000);

  // Helpers
  const formatTokenDisplayAmount = (amount: string) => {
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    if (num === 0) return "0";
    if (num > 0 && num < 0.000001) return "< 0.000001";
    return num.toFixed(6);
  };

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

  // Reset mobile vis state when screen size changes
  useLayoutEffect(() => {
    if (!isHiddenVis) {
      setIsMobileVisOpen(false);
    }
  }, [isHiddenVis]);

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
        {/* Uniswap-style tabs at top */}
        <div className="mb-4">
          <PortfolioTabs
            activeTab={activeTab}
            onTabChange={setActiveTab}
            positionCount={activePositions.length}
            tokenCount={walletBalances.length}
            activityCount={activityData.length}
          />
        </div>

        {/* Tab Content */}
        <div className="mt-4">
          {/* Overview Tab */}
          {activeTab === "overview" && (
            <OverviewTab
              walletBalances={walletBalances}
              activePositions={activePositions}
              priceMap={portfolioData.priceMap}
              onNavigateToTab={setActiveTab}
              isLoading={showSkeletonFor.table}
              activities={activityData}
              totalValue={portfolioData.totalValue}
            />
          )}

          {/* Tokens Tab */}
          {activeTab === "tokens" && (
            <TokensTab
              walletBalances={walletBalances}
              isLoading={isLoadingWalletBalances}
              sortDir={balancesSortDir}
              onSortChange={setBalancesSortDir}
            />
          )}

          {/* Activity Tab */}
          {activeTab === "activity" && (
            <ActivityTab
              activities={activityData}
              isLoading={isLoadingActivity}
              accountAddress={accountAddress}
            />
          )}

        </div>

        {/* Testnet Faucet Panel - shown as side panel on desktop */}
        {showBalancesPanel && !isMobile && (
          <div className="mt-6">
            <BalancesPanel
              width="100%"
              walletBalances={walletBalances}
              isLoadingWalletBalances={isLoadingWalletBalances}
              isConnected={isConnected}
              balancesSortDir={balancesSortDir}
              setBalancesSortDir={setBalancesSortDir}
              renderSortIcon={renderSortIcon}
              faucetLastClaimTs={faucetLastClaimTs}
              faucetLastCalledOnchain={faucetLastCalledOnchain}
              currentChainId={chainId}
              isFaucetBusy={isFaucetBusy}
              isFaucetConfirming={isFaucetConfirming}
              accountAddress={accountAddress}
              setIsFaucetBusy={setIsFaucetBusy}
              setFaucetHash={setFaucetHash}
              writeContract={writeContract}
              faucetAbi={faucetAbi}
              refetchFaucetOnchain={refetchFaucetOnchain}
            />
          </div>
        )}
      </div>
        {/* Increase Liquidity Modal */}
        {positionToModify && (
          <IncreaseLiquidityModal
            isOpen={showIncreaseModal}
            onClose={closeIncreaseModal}
            position={positionToModify}
            onSuccess={onIncreaseSuccess}
          />
        )}

        {/* Withdraw Modal */}
        {positionToWithdraw && (
          <DecreaseLiquidityModal
            isOpen={showWithdrawModal}
            onClose={closeWithdrawModal}
            position={positionToWithdraw}
            onSuccess={onDecreaseSuccess}
          />
        )}

      {selectedPosition && (
        <PositionDetailsModal
          isOpen={isPositionModalOpen}
          onClose={closePositionModal}
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
                poolId: poolConfig.id,
                tvlDelta,
              }).catch(console.error);
            }
          }}
          onAfterLiquidityRemoved={(tvlDelta, info) => {
            // Trigger global cache invalidation for this pool with optimistic updates
            const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === selectedPosition.poolId?.toLowerCase());
            if (poolConfig?.id) {
              refreshAfterMutation({
                txHash: info.txHash,
                poolId: poolConfig.id,
                tvlDelta,
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