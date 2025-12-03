"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { AppLayout } from "@/components/app-layout";
import Image from "next/image";
import { useMemo, useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { formatUSD as formatUSDShared, formatUSDHeader as formatUSDHeaderShared, formatNumber, formatPercent } from "@/lib/format";
import { publicClient } from "@/lib/viemClient";
import { getAllPools, getToken, getAllTokens, NATIVE_TOKEN_ADDRESS } from "@/lib/pools-config";
import { parseAbi, type Abi } from "viem";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useReadContract } from "wagmi";
import { baseSepolia, getExplorerTxUrl } from "@/lib/wagmiConfig";
import { useUserPositions, useAllPrices, useUncollectedFeesBatch } from "@/components/data/hooks";
import { prefetchService } from "@/lib/prefetch-service";
import { setIndexingBarrier, invalidateUserPositionIdsCache } from "@/lib/client-cache";
import { invalidateAfterTx } from "@/lib/invalidation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FAUCET_CONTRACT_ADDRESS, faucetContractAbi } from "@/pages/api/misc/faucet";
import poolsConfig from "@/config/pools.json";
import { ChevronUpIcon, ChevronDownIcon, ChevronsUpDownIcon, OctagonX, BadgeCheck, ArrowUpRight, ArrowDownRight, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PortfolioTickBar } from "@/components/portfolio/PortfolioTickBar";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { getTokenDefinitions, type TokenSymbol, getToken as getTokenCfg } from "@/lib/pools-config";
import { getOptimalBaseToken } from "@/lib/denomination-utils";
import { formatUnits as viemFormatUnits } from "viem";
import { useIncreaseLiquidity } from "@/components/liquidity/useIncreaseLiquidity";
import { useDecreaseLiquidity } from "@/components/liquidity/useDecreaseLiquidity";
import { AddLiquidityModal } from "@/components/liquidity/AddLiquidityModal";
import { WithdrawLiquidityModal } from "@/components/liquidity/WithdrawLiquidityModal";
import { PositionCardCompact } from "@/components/liquidity/PositionCardCompact";
import { PositionDetailsModal } from "@/components/liquidity/PositionDetailsModal";
import { PositionSkeleton } from "@/components/liquidity/PositionSkeleton";
import { batchGetTokenPrices } from '@/lib/price-service';
import { calculateClientAPY } from '@/lib/client-apy';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Folder, Rows3, Filter as FilterIcon, X as XIcon } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useNetwork } from "@/lib/network-context";

// Loading phases for skeleton system
type LoadPhases = { phase: 0 | 1 | 2 | 3; startedAt: number };
type Readiness = {
  core: boolean;            // positions, balances loaded
  prices: boolean;          // price map available
  apr: boolean;             // APR calculations done
};

// Multi-phase skeleton loading orchestration hook
function useLoadPhases(readiness: Readiness) {
  const [phases, setPhases] = useState<LoadPhases>({ phase: 0, startedAt: Date.now() });
  const [showSkeletonFor, setShowSkeletonFor] = useState({
    header: true,
    table: true,
    charts: true,
    actions: true,
  });

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - phases.startedAt;
    const minShowTime = 350; // minimum skeleton visibility time
    const initialDelay = 100; // initial delay to avoid flicker
    
    // Determine target phase based on readiness
    let targetPhase: 0 | 1 | 2 | 3 = 0;
    if (readiness.core && readiness.prices) {
      targetPhase = 2; // core data ready
    }
    if (readiness.core && readiness.prices && readiness.apr) {
      targetPhase = 3; // APR ready (everything ready)
    }
    if (readiness.core || readiness.prices) {
      targetPhase = Math.max(targetPhase, 1) as 0 | 1 | 2 | 3; // at least show layout
    }
    


    // Only advance phases, never regress
    if (targetPhase > phases.phase) {
      setPhases({ phase: targetPhase, startedAt: phases.startedAt });
    }

    // Control skeleton visibility with staggered timing for smooth transitions
    // Header skeleton stays until positions are loaded and APRs are available
    const headerReady = targetPhase >= 3;
    // Table skeleton stays until positions are fully loaded
    const tableReady = targetPhase >= 2;

    if (elapsed >= minShowTime) {
      setShowSkeletonFor({
        header: !headerReady,
        table: !tableReady,
        charts: targetPhase < 4,
        actions: false,
      });
    } else if (elapsed >= initialDelay) { // initial delay to avoid flicker
      setShowSkeletonFor({
        header: targetPhase < 2,
        table: targetPhase < 2,
        charts: targetPhase < 4,
        actions: targetPhase < 2,
      });
    }
    
    // Always clear all skeletons immediately when phase 4 is reached, regardless of timing
    if (targetPhase >= 4) {
      setShowSkeletonFor({
        header: false,
        table: false,
        charts: false,
        actions: false,
      });
    }
  }, [readiness, phases.phase, phases.startedAt]);

  return { phase: phases.phase, showSkeletonFor };
}

const SkeletonBlock = ({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`bg-muted/60 rounded ${className}`} {...props} />
);

const SkeletonLine = ({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={`bg-muted/60 rounded h-4 w-20 ${className}`} {...props} />
);

// Token pair logo skeleton (single circle, matching bar style)
const TokenPairLogoSkeleton = ({ size = 28, offset = 16, className = "" }: { size?: number; offset?: number; className?: string }) => {
  return (
    <div className={`rounded-full bg-muted/60 ${className}`} style={{ width: `${size}px`, height: `${size}px` }} />
  );
};

// New Portfolio Header Skeleton that matches the responsive 3/2/1 card layout
const PortfolioHeaderSkeleton = ({ viewportWidth = 1440 }: { viewportWidth?: number }) => {
  if (viewportWidth <= 1000) {
    // Mobile/Tablet collapsible header skeleton
    return (
      <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 animate-skeleton-pulse">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-3">
            <SkeletonLine className="h-3 w-24" />
            <SkeletonBlock className="h-10 w-40" />
            <SkeletonLine className="h-3 w-32" />
          </div>
          <div className="flex-none min-w-[140px] space-y-2">
            <div className="flex justify-between items-center pl-4"><SkeletonLine className="h-3 w-16" /><SkeletonLine className="h-3 w-8" /></div>
            <div className="flex justify-between items-center pl-4"><SkeletonLine className="h-3 w-12" /><SkeletonLine className="h-3 w-10" /></div>
            <div className="flex justify-between items-center pl-4"><SkeletonLine className="h-3 w-8" /><SkeletonLine className="h-3 w-12" /></div>
          </div>
          <div className="h-5 w-5 bg-muted/60 rounded-full" />
        </div>
      </div>
    );
  }

  const isThreeCard = viewportWidth > 1400;

  return (
    <div className="grid items-start gap-4" style={{ gridTemplateColumns: isThreeCard ? 'minmax(240px, max-content) minmax(240px, max-content) 1fr' : 'minmax(240px, max-content) 1fr' }}>
      <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 h-full flex flex-col justify-between animate-skeleton-pulse space-y-3">
        <SkeletonLine className="h-3 w-24" />
        <div>
          <SkeletonBlock className="h-10 w-40" />
          <SkeletonLine className="h-4 w-32 mt-2" />
        </div>
        <div />
      </div>
      {isThreeCard && (
        <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 py-1.5 px-4 h-full flex flex-col justify-center animate-skeleton-pulse">
          <div className="w-full divide-y divide-sidebar-border/40 space-y-2 py-2">
            <div className="flex justify-between items-center pt-1"><SkeletonLine className="h-3 w-16" /><SkeletonLine className="h-3 w-8" /></div>
            <div className="flex justify-between items-center pt-2"><SkeletonLine className="h-3 w-12" /><SkeletonLine className="h-3 w-10" /></div>
            <div className="flex justify-between items-center pt-2"><SkeletonLine className="h-3 w-8" /><SkeletonLine className="h-3 w-12" /></div>
          </div>
        </div>
      )}
      <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 h-full flex flex-col justify-between animate-skeleton-pulse space-y-3">
        <SkeletonLine className="h-3 w-32" />
        <div className="space-y-2">
           <SkeletonBlock className="h-2 w-full rounded-full" />
           <div className="flex justify-between">
             <SkeletonLine className="h-3 w-12" />
             <SkeletonLine className="h-3 w-10" />
             <SkeletonLine className="h-3 w-16" />
           </div>
        </div>
        <div />
      </div>
    </div>
  );
};

// Balances list skeleton (matches integrated balances list layout)
const BalancesListSkeleton = () => (
  <div className="flex flex-col divide-y divide-sidebar-border/60">
    {[...Array(6)].map((_, idx) => (
      <div key={idx} className="flex items-center justify-between h-[64px] pl-6 pr-6">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-full bg-muted/60 flex-shrink-0" />
          <div className="flex flex-col min-w-0 gap-1">
            <SkeletonLine className="h-3 w-16" />
            <SkeletonLine className="h-3 w-24 opacity-80" />
          </div>
        </div>
        <div className="flex flex-col items-end whitespace-nowrap pl-2 gap-1">
          <SkeletonLine className="h-4 w-20" />
          <SkeletonLine className="h-3 w-14 opacity-80" />
        </div>
      </div>
    ))}
  </div>
);

const ActivePositionsSkeleton = () => (
  <div className="flex flex-col gap-3 lg:gap-4">
      {[...Array(4)].map((_, idx) => (
        <PositionSkeleton key={idx} />
    ))}
  </div>
);

// Context for portfolio token filter, so inner components can toggle it
const PortfolioFilterContext = React.createContext<{
  activeTokenFilter: string | null;
  setActiveTokenFilter: React.Dispatch<React.SetStateAction<string | null>>;
  isStickyHover: boolean;
  setIsStickyHover: React.Dispatch<React.SetStateAction<boolean>>;
  hoverTokenLabel?: string | null;
}>({
  activeTokenFilter: null,
  setActiveTokenFilter: (() => {}) as React.Dispatch<React.SetStateAction<string | null>>,
  isStickyHover: false,
  setIsStickyHover: (() => {}) as React.Dispatch<React.SetStateAction<boolean>>,
  hoverTokenLabel: null,
});

interface TokenBalance {
  symbol: string;
  balance: number;
  usdValue: number;
  color: string;
}

interface PortfolioData {
  totalValue: number;
  tokenBalances: TokenBalance[];
  isLoading: boolean;
  error?: string;
  priceMap: Record<string, number>;
  pnl24hPct: number;
  priceChange24hPctMap: Record<string, number>;
}

import { loadUserPositionIds, derivePositionsFromIds, waitForSubgraphBlock, getCachedPositionTimestamps } from '@/lib/client-cache';

function formatUSD(num: number) {
  return formatUSDShared(num);
}

function formatUSDHeader(num: number) {
  return formatUSDHeaderShared(num);
}
function usePortfolioData(refreshKey: number = 0, userPositionsData?: any[], pricesData?: any): PortfolioData {
  const { address: accountAddress, isConnected, chainId: currentChainId } = useAccount();
  const [portfolioData, setPortfolioData] = useState<PortfolioData>({
    totalValue: 0,
    tokenBalances: [],
    isLoading: true,
    error: undefined,
    priceMap: {},
    pnl24hPct: 0,
    priceChange24hPctMap: {},
  });

  useEffect(() => {
    if (!isConnected || !accountAddress) {
      setPortfolioData({
        totalValue: 0,
        tokenBalances: [],
        isLoading: false,
        error: undefined,
        priceMap: {},
        pnl24hPct: 0,
        priceChange24hPctMap: {},
      });
      return;
    }

    const fetchPortfolioData = async (positionsData: any[], priceData: any) => {
      try {

        setPortfolioData(prev => ({ ...prev, isLoading: true, error: undefined }));

        // 1. Use passed hook data for user positions
        const positionsRaw = positionsData || [];
        // Filter to configured pools only
        let positions = Array.isArray(positionsRaw) ? positionsRaw : [];
        try {
          const pools = getAllPools();
          const allowedIds = new Set((pools || []).map((p: any) => String(p?.subgraphId || '').toLowerCase()));
          positions = positions.filter((pos: any) => {
            const pid = String(pos?.poolId || '').toLowerCase();
            return pid && allowedIds.has(pid);
          });
        } catch {}
        // 2. Aggregate token balances from positions
        const tokenBalanceMap = new Map<string, number>();
        if (Array.isArray(positions)) {
          positions.forEach((position: any) => {
            const t0 = position.token0?.symbol;
            const a0 = parseFloat(position.token0?.amount || '0');
            if (t0 && a0 > 0) tokenBalanceMap.set(t0, (tokenBalanceMap.get(t0) || 0) + a0);
            const t1 = position.token1?.symbol;
            const a1 = parseFloat(position.token1?.amount || '0');
            if (t1 && a1 > 0) tokenBalanceMap.set(t1, (tokenBalanceMap.get(t1) || 0) + a1);
          });
        }
        

        // 3. Resolve prices for all tokens (use price-service batch with quote API)
        const tokenSymbols = Array.from(tokenBalanceMap.keys());
        const priceMap = new Map<string, number>();
        try {
          const svc = await import('@/lib/price-service');
          const batch = await svc.batchGetTokenPrices(tokenSymbols);
          tokenSymbols.forEach(symbol => {
            const px = batch[symbol];
            if (typeof px === 'number') priceMap.set(symbol, px);
          });
        } catch (err) {
          // Fallback to existing hook-provided shape when price-service import fails
          const prices = priceData || {};
          tokenSymbols.forEach(symbol => {
            const mapped = String(symbol).toUpperCase();
            const px = prices[mapped];
            if (typeof px === 'number') priceMap.set(symbol, px);
          });
        }

        // 4. Create token balances with USD values and colors
        const tokenBalances: TokenBalance[] = Array.from(tokenBalanceMap.entries())
          .map(([symbol, balance]) => ({
            symbol,
            balance,
            usdValue: balance * (priceMap.get(symbol) || 0),
            color: '', // Will assign after sorting
          }))
          .filter(token => token.usdValue > 0.01) // Filter out dust
          .sort((a, b) => b.usdValue - a.usdValue); // Sort by value desc

        // Assign colors after sorting - using visible greyscale range from globals.css
        const colors = [
          "hsl(0 0% 30%)",   // Darker but visible
          "hsl(0 0% 40%)",   // --chart-2
          "hsl(0 0% 60%)",   // --chart-3
          "hsl(0 0% 80%)",   // --chart-4
          "hsl(0 0% 95%)",   // --chart-5 (lightest)
        ];
        tokenBalances.forEach((token, index) => {
          token.color = colors[index % colors.length];
        });

        const totalValue = tokenBalances.reduce((sum, token) => sum + token.usdValue, 0);

        // Compute portfolio 24h PnL % using per-token 24h change (note: 24h change not available from quote API)
        let deltaNowUSD = 0;
        if (totalValue > 0) {
          tokenBalances.forEach((tb) => {
            // Map any wrapped/suffixed symbol to base asset used by price-service
            const s = String(tb.symbol || '').toUpperCase();
            const base = s.includes('BTC') ? 'BTC' : s.includes('ETH') ? 'ETH' : s.includes('USDC') ? 'USDC' : s.includes('USDT') ? 'USDT' : tb.symbol;
            const coinData = priceData?.[base] || priceData?.[tb.symbol];
            const ch = coinData?.usd_24h_change; // percent if server includes
            if (typeof ch === 'number' && isFinite(ch)) {
              // exact delta using current value and inverse of (1 + ch/100)
              const pastUsd = tb.usdValue / (1 + ch / 100);
              const delta = tb.usdValue - pastUsd;
              deltaNowUSD += delta;
            }
          });
        }
        const pnl24hPct = totalValue > 0 ? (deltaNowUSD / totalValue) * 100 : 0;

        const priceChange24hPctMap: Record<string, number> = {};
        tokenSymbols.forEach(symbol => {
          const s = String(symbol || '').toUpperCase();
          const base = s.includes('BTC') ? 'BTC' : s.includes('ETH') ? 'ETH' : s.includes('USDC') ? 'USDC' : s.includes('USDT') ? 'USDT' : symbol;
          const coinData = priceData?.[base] || priceData?.[symbol];
          const ch = coinData?.usd_24h_change;
          if (typeof ch === 'number' && isFinite(ch)) {
            priceChange24hPctMap[symbol] = ch; // original key (e.g., aETH)
            priceChange24hPctMap[base] = ch;   // base key (ETH) for aggregated views
          }
        });

        setPortfolioData({
          totalValue,
          tokenBalances,
          isLoading: false,
          error: undefined,
          priceMap: Object.fromEntries(priceMap.entries()),
          pnl24hPct,
          priceChange24hPctMap,
        });

      } catch (error) {
        console.error('Failed to fetch portfolio data:', error);
        setPortfolioData({
          totalValue: 0,
          tokenBalances: [],
          isLoading: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          priceMap: {},
          pnl24hPct: 0,
          priceChange24hPctMap: {},
        });
      }
    };

    fetchPortfolioData(userPositionsData || [], pricesData || {});
  }, [isConnected, accountAddress, refreshKey, userPositionsData, pricesData]);

  return portfolioData;
}

function usePortfolio(refreshKey: number = 0, userPositionsData?: any[], pricesData?: any, isLoadingHookPositions?: boolean) {
  const { address: accountAddress, isConnected, chainId: currentChainId } = useAccount();

  // Use the portfolio data hook with passed parameters
  const portfolioData = usePortfolioData(refreshKey, userPositionsData, pricesData);

  // All other data states
  const [activePositions, setActivePositions] = useState<any[]>([]);
  const [aprByPoolId, setAprByPoolId] = useState<Record<string, string>>({});
  const [poolDataByPoolId, setPoolDataByPoolId] = useState<Record<string, any>>({});
  // All loading states
  const [isLoadingPositions, setIsLoadingPositions] = useState<boolean>(true);
  const [isLoadingPoolStates, setIsLoadingPoolStates] = useState<boolean>(true);
  
  // Process positions using centralized hooks
  useEffect(() => {
    setIsLoadingPositions(!!isLoadingHookPositions);

    if (!isConnected || !accountAddress) {
      setActivePositions([]);
      if (!isLoadingHookPositions) setIsLoadingPositions(false);
      return;
    }

    // Use hook data instead of manual fetch
    const positionsRaw = userPositionsData || [];
    let positions = Array.isArray(positionsRaw) ? positionsRaw : [];
    // Filter to configured pools only (use pools-config)
    try {
      const pools = getAllPools();
      const allowedIds = new Set((pools || []).map((p: any) => String(p?.subgraphId || '').toLowerCase()));
      positions = positions.filter((pos: any) => {
        const pid = String(pos?.poolId || '').toLowerCase();
        return pid && allowedIds.has(pid);
      });
    } catch {}
    setActivePositions(positions);
  }, [isConnected, accountAddress, userPositionsData, isLoadingHookPositions]);

  useEffect(() => {
    const fetchApr = async () => {
      try {
        const response = await fetch('/api/liquidity/get-pools-batch', { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (!data?.success || !Array.isArray(data.pools)) return;
        const map: Record<string, string> = {};
        for (const p of data.pools as any[]) {
          const apr = typeof p.apr7d === 'number' && isFinite(p.apr7d) && p.apr7d > 0 ? `${p.apr7d.toFixed(2)}%` : 'N/A';
          if (p.poolId) map[String(p.poolId).toLowerCase()] = apr;
        }
        setAprByPoolId(map);
      } catch {}
    };
    fetchApr();
  }, []);

  useEffect(() => {
    setIsLoadingPoolStates(false);
  }, [activePositions, isLoadingPositions]);

  const readiness: Readiness = useMemo(() => {
    const isPositionsLoaded = !isLoadingPositions;
    const isEmptyPortfolio = isPositionsLoaded && activePositions.length === 0;
    return {
      core: isPositionsLoaded && !isLoadingPoolStates,
      prices: isEmptyPortfolio || Object.keys(portfolioData.priceMap).length > 0,
      apr: isEmptyPortfolio || Object.keys(aprByPoolId).length > 0,
    };
  }, [portfolioData.priceMap, aprByPoolId, activePositions, isLoadingPositions, isLoadingPoolStates]);

  return {
    portfolioData,
    activePositions,
    aprByPoolId,
    poolDataByPoolId,
    readiness,
    isLoadingPositions,
    isLoadingPoolStates,
    setActivePositions,
    setIsLoadingPositions,
    setAprByPoolId,
  };
}

export default function PortfolioPage() {
  const router = useRouter();
  const { isTestnet, networkMode, chainId: targetChainId } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const [positionsRefresh, setPositionsRefresh] = useState(0);
  const { address: accountAddress, isConnected, chainId } = useAccount();
  const queryClient = useQueryClient();

  // Centralized hooks for positions (Category 2: user-action invalidated)
  const { data: userPositionsData, isLoading: isLoadingUserPositions, isFetching: isPositionsFetching } = useUserPositions(accountAddress || '');
  const isPositionsStale = isPositionsFetching && !isLoadingUserPositions; // Pulsing during refetch

  // Centralized hook for prices (Category 1: infrequent)
  const { data: pricesData, isLoading: isLoadingPrices } = useAllPrices();

  const {
    portfolioData,
    activePositions,
    aprByPoolId,
    poolDataByPoolId,
    isLoadingPositions,
    readiness,
    isLoadingPoolStates,
    setActivePositions,
    setIsLoadingPositions,
    setAprByPoolId,
  } = usePortfolio(positionsRefresh, userPositionsData, pricesData, isLoadingUserPositions);

  const modifiedPositionPoolInfoRef = useRef<{ poolId: string; subgraphId: string } | null>(null);
  const pendingActionRef = useRef<null | { type: 'increase' | 'decrease' | 'withdraw' | 'collect' }>(null);
  const lastRevalidationRef = useRef<number>(0);
  const handledIncreaseHashRef = useRef<string | null>(null);
  const handledDecreaseHashRef = useRef<string | null>(null);

  const isLoading = !readiness.core;
  const { phase, showSkeletonFor } = useLoadPhases(readiness);

  const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const netApyRef = useRef<HTMLDivElement>(null);
  const [inlineLeftOffset, setInlineLeftOffset] = useState<number>(0);
  const [inlineAvailableWidth, setInlineAvailableWidth] = useState<number>(0);
  const [isCompactVis, setIsCompactVis] = useState<boolean>(false);
  const [isHiddenVis, setIsHiddenVis] = useState<boolean>(false);
  const [isMobileVisOpen, setIsMobileVisOpen] = useState<boolean>(false);
  const [collapseMaxHeight, setCollapseMaxHeight] = useState<number>(0);
  const [isVerySmallScreen, setIsVerySmallScreen] = useState<boolean>(false);
  const [isMobileVisReady, setIsMobileVisReady] = useState<boolean>(false);
  const blockVisContainerRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState<number>(typeof window !== 'undefined' ? window.innerWidth : 1440);
  useLayoutEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    if (typeof window !== 'undefined') {
      onResize();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
  }, []);
  const poolConfigBySubgraphId = useMemo(() => {
    try {
      const map = new Map<string, any>();
      (poolsConfig?.pools || []).forEach((p: any) => map.set(String(p.subgraphId || '').toLowerCase(), p));
      return map;
    } catch {
      return new Map<string, any>();
    }
  }, []);

  // SDK tick bounds for full-range detection (match pool detail page)
  const SDK_MIN_TICK = -887272;
  const SDK_MAX_TICK = 887272;

  const determineBaseTokenForPriceDisplay = useCallback((token0: string, token1: string): string =>
    getOptimalBaseToken(token0, token1), []);

  const convertTickToPrice = useCallback((tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string): string => {
    if (tick === SDK_MAX_TICK) return '∞';
    if (tick === SDK_MIN_TICK) return '0.00';

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

  const getBalancesWidthPx = useCallback((vw: number) => {
    // Clamp balances panel between 320–520px, scale around ~28% of viewport
    const ideal = Math.round(vw * 0.28);
    return Math.max(320, Math.min(520, ideal));
  }, []);

  // Table-responsive flags and column widths
  const isStackThreshold = viewportWidth <= 1800; // stack amounts & remove dot
  const isIconOnlyRangeThreshold = viewportWidth <= 1500; // replace range chart with icons
  const colWidths = useMemo(() => {
    if (viewportWidth <= 1500) {
      // user's preferred narrow layout
      return { pool: 26, amounts: 22, apr: 14, range: 22, value: 10 };
    }
    if (viewportWidth <= 1800) {
      // start stacking amounts at 1800, keep columns similar to narrow to avoid crowding
      return { pool: 26, amounts: 22, apr: 14, range: 22, value: 10 };
    }
    return { pool: 22, amounts: 22, apr: 12, range: 17, value: 27 };
  }, [viewportWidth]);
  
  // NEW: local state for positions
  const { address: userAddress, isConnected: userIsConnected, chainId: currentChainId } = useAccount();
  const { writeContract } = useWriteContract();
  const faucetAbi = parseAbi(['function faucet() external']);
  const [faucetHash, setFaucetHash] = useState<`0x${string}` | undefined>(undefined);
  const { isLoading: isFaucetConfirming, isSuccess: isFaucetConfirmed } = useWaitForTransactionReceipt({ hash: faucetHash });
  // -1 means unknown (prevents showing active state before cache check like sidebar)
  const [faucetLastClaimTs, setFaucetLastClaimTs] = useState<number>(-1);
  const [isFaucetBusy, setIsFaucetBusy] = useState<boolean>(false);
  const { data: faucetLastCalledOnchain, isLoading: isLoadingFaucetOnchain, refetch: refetchFaucetOnchain } = useReadContract({
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
  const allowedPoolIds = useMemo(() => {
    try {
      return new Set((poolsConfig?.pools || []).map((p: any) => String(p.subgraphId || "").toLowerCase()));
    } catch {
      return new Set<string>();
    }
  }, []);
  const [positionsError, setPositionsError] = useState<string | undefined>(undefined);


  
  // NEW: selector state for switching between sections
  const [selectedSection, setSelectedSection] = useState<string>('Active Positions');
  const isMobile = viewportWidth <= 768;
  const isIntegrateBalances = isTestnet && viewportWidth < 1400 && !isMobile;
  const showBalancesPanel = isTestnet;
  const sectionsList = useMemo(() => {
    const base = ['Active Positions'];
    return isIntegrateBalances ? [...base, 'Balances'] : base;
  }, [isIntegrateBalances]);
  useEffect(() => {
    if (!isIntegrateBalances && selectedSection === 'Balances') {
      setSelectedSection('Active Positions');
    }
  }, [isIntegrateBalances, selectedSection]);

  // Modals: Add Liquidity / Withdraw (Decrease)
  const [showIncreaseModal, setShowIncreaseModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [positionToModify, setPositionToModify] = useState<any | null>(null);
  const [positionToWithdraw, setPositionToWithdraw] = useState<any | null>(null);

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

  // Extract individual fee data from batch result
  const getFeesForPosition = React.useCallback((positionId: string) => {
    if (!batchFeesData || !positionId) return null;
    return batchFeesData.find(fee => fee.positionId === positionId) || null;
  }, [batchFeesData]);

  // Extract fees for specific use cases
  const feesForIncrease = getFeesForPosition(positionToModify?.positionId || '');
  const feesForWithdraw = getFeesForPosition(positionToWithdraw?.positionId || '');
  // Withdraw state variables (kept for future use)
  const [withdrawAmount0, setWithdrawAmount0] = useState<string>("");
  const [withdrawAmount1, setWithdrawAmount1] = useState<string>("");
  const [withdrawPercentage, setWithdrawPercentage] = useState<number>(0);
  const [isFullWithdraw, setIsFullWithdraw] = useState(false);
  const lastDecreaseWasFullRef = useRef<boolean>(false);
  const lastTxBlockRef = useRef<bigint | null>(null);
  const [walletBalances, setWalletBalances] = useState<Array<{ symbol: string; balance: number; usdValue: number; color: string }>>([]);
  const [isLoadingWalletBalances, setIsLoadingWalletBalances] = useState<boolean>(false);


  // Helpers
  const formatTokenDisplayAmount = (amount: string) => {
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    if (num === 0) return "0";
    if (num > 0 && num < 0.000001) return "< 0.000001";
    return num.toFixed(6);
  };

  const getTokenIconSrc = (symbol?: string) => {
    if (!symbol) return '/placeholder-logo.svg';
    return getTokenCfg(symbol)?.icon || '/placeholder-logo.svg';
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
      await invalidateAfterTx(queryClient, {
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
  }, [accountAddress, queryClient]);

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
        // For full burns: immediately remove position from UI
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
    // Use targeted refresh instead of bumpPositionsRefresh to avoid folding
    // bumpPositionsRefresh();
  }, []);
  
  const { decreaseLiquidity, claimFees, isLoading: isDecreasingLiquidity, isSuccess: isDecreaseSuccess, hash: decreaseTxHash } = useDecreaseLiquidity({ 
    onLiquidityDecreased: onLiquidityDecreasedCallback, 
    onFeesCollected 
  });

  // Enhanced claimFees with optimistic updates
  const enhancedClaimFees = useCallback(async (positionId: string) => {
    pendingActionRef.current = { type: 'collect' };

    // Show optimistic loading state
    setActivePositions(prev => prev.map(p =>
      p.positionId === positionId
        ? { ...p, isOptimisticallyUpdating: true }
        : p
    ));

    await claimFees(positionId);
  }, [claimFees]);

  // Clear optimistic loading state when hook finishes (success or error)
  useEffect(() => {
    if (!isDecreasingLiquidity && pendingActionRef.current?.type === 'collect') {
      setActivePositions(prev => prev.map(p => ({ ...p, isOptimisticallyUpdating: undefined })));
      pendingActionRef.current = null;
    }
  }, [isDecreasingLiquidity]);

  const isCompoundInProgressRef = useRef(false);

  
  // Provided by top-level const above

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

  // Sorting state for Active Positions
  const [activeSort, setActiveSort] = useState<{ column: 'amounts' | 'value' | 'apr' | null; direction: 'asc' | 'desc' | null }>({ column: null, direction: null });
  const [hoveredTokenLabel, setHoveredTokenLabel] = useState<string | null>(null);
  const [positionStatusFilter, setPositionStatusFilter] = useState<'all' | 'in-range' | 'out-of-range'>('all');
  // const [positionSortBy, setPositionSortBy] = useState<'value' | 'fees' | 'apr'>('value');
  const [viewMode, setViewMode] = useState<'folder' | 'list'>('folder');




  const [expandedPools, setExpandedPools] = useState<Record<string, boolean>>({});
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [positionMenuOpenUp, setPositionMenuOpenUp] = useState(false);
  const [balancesSortDir, setBalancesSortDir] = useState<'asc' | 'desc'>('desc');
  const [openPositionMenuKey, setOpenPositionMenuKey] = useState<string | null>(null);
  const [selectedPosition, setSelectedPosition] = useState<any | null>(null);
  const [isPositionModalOpen, setIsPositionModalOpen] = useState(false);

  // Close the group-row action menu when clicking anywhere outside it
  useEffect(() => {
    if (!openMenuKey) return;
    const onDocPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      // Keep open if the click is on the trigger or inside the menu content
      if (target.closest('.position-menu-trigger') || target.closest('.position-menu-content')) return;
      setOpenMenuKey(null);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [openMenuKey]);

  useEffect(() => {
    if (!openPositionMenuKey) return;
    const onDocPointerDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.position-card-menu-trigger') || target.closest('.position-card-menu-content')) return;
      setOpenPositionMenuKey(null);
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [openPositionMenuKey]);

  // Wallet balances (for Balances UI only; excluded from global portfolio worth)
  const [walletPriceMap, setWalletPriceMap] = useState<Record<string, number>>({});
  const [walletPriceChange24hPctMap, setWalletPriceChange24hPctMap] = useState<Record<string, number>>({});

  useEffect(() => {
    const run = async () => {
      if (!isConnected || !accountAddress) {
        setWalletBalances([]);
        setWalletPriceMap({});
        setWalletPriceChange24hPctMap({});
        return;
      }
      setIsLoadingWalletBalances(true);
      try {
        // Collect configured tokens
        const tokenMapOrArray = getAllTokens?.() as any;
        const tokens = Array.isArray(tokenMapOrArray) ? tokenMapOrArray : Object.values(tokenMapOrArray || {});
        // Fetch raw balances
        const balances: Record<string, number> = {};
        for (const t of tokens) {
          const symbol = t?.symbol as string | undefined;
          if (!symbol) continue;
          const addr = (t as any)?.address as `0x${string}` | undefined;
          try {
            let raw: bigint = 0n;
            if (!addr || addr.toLowerCase() === NATIVE_TOKEN_ADDRESS?.toLowerCase?.()) {
              raw = await publicClient.getBalance({ address: accountAddress as `0x${string}` });
            } else {
              // balanceOf(address)
              const bal = await publicClient.readContract({
                address: addr,
                abi: parseAbi(['function balanceOf(address) view returns (uint256)']) as unknown as Abi,
                functionName: 'balanceOf',
                args: [accountAddress as `0x${string}`],
              });
              raw = BigInt(bal as any);
            }
            const dec = (tokenDefinitions as any)?.[symbol]?.decimals ?? 18;
            const asFloat = parseFloat(viemFormatUnits(raw, dec));
            balances[symbol] = asFloat;
          } catch {}
        }

        // Build price map via quote API (replaces CoinGecko)
        const symbols = Object.keys(balances);
        const priceMap = new Map<string, number>();
        let priceData: any = {};
        try {
          const prices = await batchGetTokenPrices(symbols);
          priceData = prices; // The batch result is the price map
          symbols.forEach((symbol) => {
            if (prices[symbol]) priceMap.set(symbol, prices[symbol]);
          });

          // Note: batchGetTokenPrices uses quote API and does not return 24h change data.
          // 24h change is not available from on-chain quotes.
        } catch (error) {
          console.warn('Failed to fetch prices from quote API:', error);
        }
        const priceChangeMap: Record<string, number> = {};
        // Note: 24h change data is not available from quote API
        symbols.forEach((symbol) => {
          const px = priceData[symbol];
          if (px) priceMap.set(symbol, px);
          else if (symbol.includes('USDC') || symbol.includes('USDT')) priceMap.set(symbol, 1.0);
          // priceChangeMap remains empty as 24h change is not available
        });

        // Construct balances array (filter out zeros), assign colors
        const entries = symbols
          .map((symbol) => ({
            symbol,
            balance: balances[symbol] || 0,
            usdValue: (balances[symbol] || 0) * (priceMap.get(symbol) || 0),
            color: '',
          }))
          .filter((x) => x.usdValue > 0.01)
          .sort((a, b) => b.usdValue - a.usdValue);
        const colors = [
          'hsl(0 0% 30%)',
          'hsl(0 0% 40%)',
          'hsl(0 0% 60%)',
          'hsl(0 0% 80%)',
          'hsl(0 0% 95%)',
        ];
        entries.forEach((e, i) => { e.color = colors[i % colors.length]; });

        setWalletBalances(entries);
        setWalletPriceMap(Object.fromEntries(priceMap.entries()));
        setWalletPriceChange24hPctMap(priceChangeMap);
      } finally {
        setIsLoadingWalletBalances(false);
      }
    };
    run();
    // Listen for global balance refresh triggers (from faucet claim)
    const onRefresh = () => {
      // Re-run balances fetch immediately
      run();
      // Also trigger portfolio data refresh
      setPositionsRefresh(prev => prev + 1);
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !accountAddress) return;
      if (e.key === `walletBalancesRefreshAt_${accountAddress}`) {
        run();
        setPositionsRefresh(prev => prev + 1);
      }
    };
    window.addEventListener('walletBalancesRefresh', onRefresh as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('walletBalancesRefresh', onRefresh as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [isConnected, accountAddress, currentChainId && false]);

  const navigateToPoolBySubgraphId = useCallback((poolSubgraphId?: string) => {
    if (!poolSubgraphId) return;
    try {
      const pools = getAllPools();
      const match = pools.find(p => String(p.subgraphId || '').toLowerCase() === String(poolSubgraphId).toLowerCase());
      const routeId = match?.id;
      if (routeId) router.push(`/liquidity/${routeId}`);
    } catch {}
  }, [router]);
  
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

  const handleActiveSortCycle = (columnId: 'amounts' | 'value' | 'apr') => {
    setActiveSort((prev) => {
      if (prev.column !== columnId) return { column: columnId, direction: 'asc' };
      if (prev.direction === 'asc') return { column: columnId, direction: 'desc' };
      return { column: null, direction: null };
    });
  };

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

  // Debounce helper
  const debounce = (func: Function, waitFor: number) => {
    let timeout: ReturnType<typeof setTimeout>;
    return (...args: any[]) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), waitFor);
    };
  };

  const formatAgeShort = (seconds: number | undefined) => {
    if (!seconds || !isFinite(seconds)) return '';
    const d = Math.floor(seconds / 86400);
    if (d >= 1) return `${d}d`;
    const h = Math.floor(seconds / 3600);
    if (h >= 1) return `${h}h`;
    const m = Math.floor(seconds / 60);
    return `${m}m`;
  };

  // Set initial responsive states before paint to avoid layout flicker
  useLayoutEffect(() => {
    const setInitialStates = () => {
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      setIsCompactVis(viewportWidth <= 1000);
      setIsHiddenVis(viewportWidth <= 1000);
      setIsVerySmallScreen(viewportWidth < 695);
    };
    
    setInitialStates();
  }, []);

  // Wide composition - always group into Rest if there are more than 4 assets overall (even if some are <1%)
  const wideComposition = useMemo(() => {
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
        {
          label: 'Rest',
          pct: restPct,
          color: 'hsl(0 0% 70%)',
          restTokens: rest,
        } as any,
      ];
    }
    // If 4 or fewer, show them; keep tiny ones but they may have hidden names
    if (allItems.length === 0) {
      return [{ label: 'All', pct: 100, color: 'hsl(0 0% 30%)' }];
    }
    return allItems;
  }, [portfolioData.tokenBalances, portfolioData.totalValue]);
  // Compact composition - aggregate items beyond first 3 into Rest if more than 4 total (same counting as wide)
  const compactComposition = useMemo(() => {
    const total = portfolioData.totalValue;
    const tokenItems = portfolioData.tokenBalances
      .map(token => ({
        label: token.symbol,
        pct: total > 0 ? (token.usdValue / total) * 100 : 0,
        color: token.color,
      }))
      .sort((a, b) => b.pct - a.pct); // Sort by percentage descending

    // If more than 4 items, aggregate items beyond first 3 into Rest
    if (tokenItems.length > 4) {
      const topThree = tokenItems.slice(0, 3);
      const rest = tokenItems.slice(3);
      const restPct = rest.reduce((sum, item) => sum + item.pct, 0);
      
      return [
        ...topThree,
        {
          label: 'Rest',
          pct: restPct,
          color: 'hsl(0 0% 70%)', // Distinct lighter color for rest, brighter than first segment (30%)
          restTokens: rest, // Store the aggregated tokens for later use
        }
      ];
    }
    
    if (tokenItems.length === 0) {
      return [{ label: 'All', pct: 100, color: 'hsl(0 0% 30%)' }];
    }
    return tokenItems;
  }, [portfolioData.tokenBalances, portfolioData.totalValue]);

  // Use appropriate composition based on view
  const composition = isCompactVis ? compactComposition : wideComposition;
  const isPlaceholderComposition = composition.length === 1 && composition[0]?.label === 'All' && Math.round((composition[0]?.pct || 0)) === 100;
  // Decide placement purely by measured available inline width
  useLayoutEffect(() => {
    const updateLayoutAndOffset = () => {
      if (!containerRef.current || !netApyRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const netApyRect = netApyRef.current.getBoundingClientRect();
      // Compute left offset so inline visualization starts closer to NET APY at smaller viewports
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      setIsCompactVis(viewportWidth <= 1000);
      setIsHiddenVis(viewportWidth <= 1000);
      setIsVerySmallScreen(viewportWidth < 695);
      // Aggressively shrink the LEFT margin at/below 1500px
      const desiredGapPx = viewportWidth <= 1500 ? -18 : 18;
      // Use padding-left to shift start while letting the bar fill the remaining width
      const leftOffset = Math.max(0, netApyRect.right - containerRect.left + desiredGapPx);
      setInlineLeftOffset(leftOffset);
      const available = Math.max(0, Math.round(containerRect.width - leftOffset));
      setInlineAvailableWidth(available);
    };
    
    // Run immediately and after a short delay to ensure DOM is ready
    updateLayoutAndOffset();
    const timeoutId = setTimeout(updateLayoutAndOffset, 50);
    
    window.addEventListener('resize', updateLayoutAndOffset);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('resize', updateLayoutAndOffset);
    };
  }, []);

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

  // Sorted active positions with hover preview support
  const sortedActivePositions = useMemo(() => {
    const base = filteredPositions;
    // Hover preview: if no committed sort, preview token-priority based on hovered segment
    const effectiveSort = ((typeof activeTokenFilter === 'string' && activeTokenFilter) || (currentFilter && currentFilter !== 'Rest'))
      ? { column: 'token' as const, direction: 'desc' as const }
      : (activeSort.column && activeSort.direction ? activeSort : { column: null, direction: null });
    if (!effectiveSort.column || !effectiveSort.direction) return base;

    const getAmountsKey = (p: any) => {
      const amt0 = Number.parseFloat(p?.token0?.amount || '0');
      const amt1 = Number.parseFloat(p?.token1?.amount || '0');
      return (isFinite(amt0) ? amt0 : 0) + (isFinite(amt1) ? amt1 : 0);
    };
    const getValueKey = (p: any) => {
      const sym0 = p?.token0?.symbol as string | undefined;
      const sym1 = p?.token1?.symbol as string | undefined;
      const amt0 = Number.parseFloat(p?.token0?.amount || '0');
      const amt1 = Number.parseFloat(p?.token1?.amount || '0');
      const px0 = (sym0 && portfolioData.priceMap[sym0]) || 0;
      const px1 = (sym1 && portfolioData.priceMap[sym1]) || 0;
      return (isFinite(amt0) ? amt0 : 0) * px0 + (isFinite(amt1) ? amt1 : 0) * px1;
    };
    const getAprKey = (p: any) => {
      const aprStr = aprByPoolId[String(p?.poolId || '').toLowerCase()] || '';
      const num = typeof aprStr === 'string' && aprStr.endsWith('%') ? parseFloat(aprStr.replace('%', '')) : 0;
      return isFinite(num) ? num : 0;
    };
    // Token-hover preview: strictly filter to hovered token, otherwise use committed filter normal flow
    if (currentFilter && currentFilter !== 'Rest') {
      const token = String(currentFilter).toUpperCase();
      const onlyHovered = base.filter((p) => (
        p?.token0?.symbol?.toUpperCase?.() === token || p?.token1?.symbol?.toUpperCase?.() === token
      ));
      return onlyHovered.sort((a, b) => getValueKey(b) - getValueKey(a));
    }
    // Handle Rest segment: show only positions with tokens NOT in top 3
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

      const restPositions = base.filter(p => {
        const sym0 = p?.token0?.symbol?.toUpperCase();
        const sym1 = p?.token1?.symbol?.toUpperCase();
        return (sym0 && !topThreeTokens.includes(sym0)) || (sym1 && !topThreeTokens.includes(sym1));
      });
      return restPositions.sort((a, b) => getValueKey(b) - getValueKey(a));
    }
    const keyFn = effectiveSort.column === 'amounts' ? getAmountsKey : effectiveSort.column === 'value' ? getValueKey : getAprKey;
    const sign = effectiveSort.direction === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      const ka = keyFn(a);
      const kb = keyFn(b);
      if (ka === kb) return 0;
      return ka < kb ? -1 * sign : 1 * sign;
    });
  }, [filteredPositions, activeSort, activeTokenFilter, currentFilter, portfolioData.priceMap, aprByPoolId]);

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
      : (activeSort.column && activeSort.direction ? activeSort : { column: null, direction: null });

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
    if (effectiveSort.column === 'value' && effectiveSort.direction) {
      const sign = effectiveSort.direction === 'asc' ? 1 : -1;
      groups.sort((a, b) => (a.totalUSD - b.totalUSD) * sign);
    } else {
      groups.sort((a, b) => b.totalUSD - a.totalUSD);
    }
    return groups;
  }, [statusAndSortFilteredPositions, viewMode, portfolioData.priceMap, activeSort, activeTokenFilter, currentFilter]);

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
      const { apy } = calculateClientAPY(feesUSD, positionUsd, lastTs, poolApr);
      const positionApy = apy ?? 0;

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
      <AppLayout>
        <div className="flex flex-1 flex-col p-3 sm:p-6 sm:px-10">
          <PortfolioHeaderSkeleton viewportWidth={viewportWidth} />
          
          <div className="mt-6 flex flex-col lg:flex-row" style={{ gap: `${getColumnGapPx(viewportWidth)}px` }}>
            <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 justify-between">
              {sectionsList.map((section) => (
                <button
                  key={section}
                  onClick={() => setSelectedSection(section)}
                  className={`px-2 py-1 text-xs rounded-md transition-all duration-200 cursor-pointer ${
                    selectedSection === section
                      ? 'border border-sidebar-border bg-button text-foreground brightness-110'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                  style={selectedSection === section ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                >
                  {section}
                </button>
              ))}
                                        <div className="ml-auto flex items-center gap-2">
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
            {isIntegrateBalances && selectedSection === 'Balances' ? (
              <div className={`rounded-lg bg-muted/30 border border-sidebar-border/60 ${showSkeletonFor.table ? 'animate-skeleton-pulse' : ''}`}>
                <div className="flex items-center justify-between pl-6 pr-6 py-3 border-b border-sidebar-border/60 text-xs text-muted-foreground">
                  <span className="tracking-wider font-mono font-bold">TOKEN</span>
                  <div className="group inline-flex items-center">
                    <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">VALUE</span>
                    {renderSortIcon(balancesSortDir)}
                  </div>
                </div>
                <div className="p-0">
                  <BalancesListSkeleton />
                </div>
              </div>
            ) : (
              isMobile ? (
                <div className="flex flex-col gap-3">
                  {[...Array(3)].map((_, idx) => (
                    <div key={idx} className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <TokenPairLogoSkeleton size={24} offset={14} />
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
              )
            )}
            </div>
            {showBalancesPanel && !isIntegrateBalances && (
              <aside className="lg:flex-none" style={{ width: viewportWidth >= 1024 ? '450px' : '100%' }}>
                <div className="mb-2 flex items-center gap-2 justify-between">
                  <button
                    type="button"
                    className="px-2 py-1 text-xs rounded-md border border-sidebar-border bg-button text-foreground brightness-110"
                    style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                  >
                    Balances
                  </button>
                </div>
                <div className={`rounded-lg bg-muted/30 border border-sidebar-border/60 ${showSkeletonFor.table ? 'animate-skeleton-pulse' : ''}`}>
                  <div className="flex items-center justify-between pl-6 pr-6 py-3 border-b border-sidebar-border/60 text-xs text-muted-foreground">
                    <span className="tracking-wider font-mono font-bold">TOKEN</span>
                    <div className="group inline-flex items-center">
                      <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">VALUE</span>
                      {renderSortIcon(balancesSortDir)}
                    </div>
                  </div>
                  <div className="p-0">
                    <BalancesListSkeleton />
                  </div>
                </div>
              </aside>
            )}
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <PortfolioFilterContext.Provider value={{ activeTokenFilter, setActiveTokenFilter, isStickyHover, setIsStickyHover, hoverTokenLabel: effectiveTokenLabel }}>
      <AppLayout>
      <div className="flex flex-1 flex-col p-3 sm:p-6 sm:px-10">
        {/* Portfolio header with skeleton gate */}
        {showSkeletonFor.header ? (
          <PortfolioHeaderSkeleton viewportWidth={viewportWidth} />
        ) : (
          <div>
            {viewportWidth > 1000 ? (
            <div
              ref={containerRef}
                className={`grid items-start relative`}
              style={{
                  gridTemplateColumns: viewportWidth > 1400
                    ? "minmax(240px, max-content) minmax(240px, max-content) 1fr"
                    : "minmax(240px, max-content) 1fr",
                gridTemplateRows: "auto auto",
                columnGap: "1rem",
              }}
            >
            {/* Container 1: CURRENT VALUE */}
            <div className="col-[1] row-[1/3] rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 h-full flex flex-col justify-between">
              <div>
                <h1 className="text-xs tracking-wider text-muted-foreground font-mono font-bold mb-3">CURRENT VALUE</h1>
                <div className={`${isVerySmallScreen ? 'text-2xl' : 'text-3xl sm:text-4xl'}`}>
                  {isPlaceholderComposition ? (
                    <span className="text-muted-foreground">-</span>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <span className="font-medium tracking-tight">{formatUSDHeader(displayValue)}</span>
                      {(() => {
                        const deltaUsd = (() => {
                          try {
                            const total = Number(displayValue) || 0;
                            if (!Number.isFinite(pnl24hPct) || !isFinite(total)) return 0;
                            return (total * pnl24hPct) / 100;
                          } catch { return 0; }
                        })();
                        const isPos = (pnl24hPct || 0) >= 0;
                        const absDelta = Math.abs(deltaUsd);
                        return (
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground font-medium">
                              {isPos ? '+' : '-'}{formatUSDShared(absDelta)}
                            </span>
                            <div className="flex items-center gap-1">
                              {isPos ? (
                                <ArrowUpRight className="h-3 w-3 text-green-500" />
                              ) : (
                                <ArrowDownRight className="h-3 w-3 text-red-500" />
                              )}
                              <TooltipProvider delayDuration={0}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className={`${isPos ? 'text-green-500' : 'text-red-500'} font-medium cursor-default`}>
                                      {formatPercent(Math.abs(pnl24hPct || 0), { min: 2, max: 2 })}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                                    24h Performance
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
              </div>
            </div>
                        );
                      })()}
            </div>
                  )}
            </div>
              </div>
            </div>

                {/* Container 2: Single card with dividers */}
                <div ref={netApyRef} className={`col-[2] row-[1/3] rounded-lg bg-muted/30 border border-sidebar-border/60 py-1.5 px-4 h-full flex flex-col justify-center ${viewportWidth <= 1400 ? 'hidden' : ''}`}>
                  <div className="w-full divide-y divide-sidebar-border/40">
                  <div className="flex justify-between items-center py-1.5">
                      <span className="text-[11px] tracking-wider text-muted-foreground font-mono font-bold uppercase">Positions</span>
                      <span className="text-[11px] font-medium">{filteredPositionCount}</span>
                  </div>
                  <div className="flex justify-between items-center py-1.5">
                      <span className="text-[11px] tracking-wider text-muted-foreground font-mono font-bold uppercase">Net APY</span>
                      <span className="text-[11px] font-medium">
              {isPlaceholderComposition ? (
                         '-'
              ) : (
                effectiveAprPct !== null ? (
                  effectiveAprPct > 999 ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-default">&gt;999%</span>
                        </TooltipTrigger>
                        <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">{formatPercent(effectiveAprPct, { min: 2, max: 2 })}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    formatPercent(effectiveAprPct, { min: 1, max: 1 })
                  )
                         ) : '—'
                       )}
                     </span>
            </div>
                    <div className="flex justify-between items-center py-1.5">
                      <span className="text-[11px] tracking-wider text-muted-foreground font-mono font-bold uppercase">Fees</span>
                      <span className="text-[11px] font-medium">{formatUSD(totalFeesUSD)}</span>
                </div>
            </div>
            </div>

                {/* Container 3: Percentage Split Viewer (spreads when middle is hidden) */}
                <div className={`${viewportWidth > 1400 ? 'col-[3]' : 'col-[2]'} row-[1/3] rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 h-full flex flex-col justify-between`}>
              <div>
                <h1 className="text-xs tracking-wider text-muted-foreground font-mono font-bold mb-3">ASSET ALLOCATION</h1>
                <div className="flex-1 flex items-center justify-start">
                  {(() => {
                    if (isPlaceholderComposition) {
                      const fallback = [{ label: 'All', pct: 100, color: composition?.[0]?.color || 'hsl(0 0% 30%)' }];
                      return (
                        <div className="w-full pr-0 pl-2">
                          <div className="relative">
                            <PortfolioTickBar
                              composition={fallback}
                              onHover={setHoveredSegment}
                              hoveredSegment={hoveredSegment}
                              containerRef={containerRef}
                              netApyRef={netApyRef}
                              handleRestClick={handleRestClick}
                              setIsRestCycling={setIsRestCycling}
                              isRestCycling={isRestCycling}
                              restCycleIndex={restCycleIndex}
                              forceHideLabels={true}
                              onApplySort={undefined}
                              onHoverToken={setHoveredTokenLabel}
                              activeTokenFilter={activeTokenFilter}
                              setActiveTokenFilter={setActiveTokenFilter}
                            />
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="w-full pr-0 pl-2">
                        <div className="relative">
                          <PortfolioTickBar
                            composition={composition}
                            onHover={setHoveredSegment}
                            hoveredSegment={hoveredSegment}
                            containerRef={containerRef}
                            netApyRef={netApyRef}
                            handleRestClick={handleRestClick}
                            setIsRestCycling={setIsRestCycling}
                            isRestCycling={isRestCycling}
                            restCycleIndex={restCycleIndex}
                            forceHideLabels={forceHideLabels}
                            onApplySort={undefined}
                            onHoverToken={setHoveredTokenLabel}
                            activeTokenFilter={activeTokenFilter}
                            setActiveTokenFilter={setActiveTokenFilter}
                          />
                        </div>
                      </div>
                    );
                  })()}
                      </div>
                    </div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
                <div className="flex items-center justify-between gap-4">
                  {/* Left: CURRENT VALUE */}
                  <div className="flex-1 min-w-0">
                    <h1 className="text-xs tracking-wider text-muted-foreground font-mono font-bold mb-3">CURRENT VALUE</h1>
                    <div className={`${isVerySmallScreen ? 'text-2xl' : 'text-3xl sm:text-4xl'}`}>
                      {isPlaceholderComposition ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <span className="font-medium tracking-tight">{formatUSDHeader(displayValue)}</span>
                          {(() => {
                            const deltaUsd = (() => {
                              try {
                                const total = Number(displayValue) || 0;
                                if (!Number.isFinite(pnl24hPct) || !isFinite(total)) return 0;
                                return (total * pnl24hPct) / 100;
                              } catch { return 0; }
                            })();
                            const isPos = (pnl24hPct || 0) >= 0;
                            const absDelta = Math.abs(deltaUsd);
                            return (
                              <div className="flex items-center gap-2 text-xs">
                                <span className="text-muted-foreground font-medium">
                                  {isPos ? '+' : '-'}{formatUSDShared(absDelta)}
                                </span>
                                <div className="flex items-center gap-1">
                                  {isPos ? (
                                    <ArrowUpRight className="h-3 w-3 text-green-500" />
                                  ) : (
                                    <ArrowDownRight className="h-3 w-3 text-red-500" />
                                  )}
                              <TooltipProvider delayDuration={0}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className={`${isPos ? 'text-green-500' : 'text-red-500'} font-medium cursor-default`}>
                                      {formatPercent(Math.abs(pnl24hPct || 0), { min: 2, max: 2 })}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                                    24h Performance
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                </div>
              </div>
                            );
                          })()}
            </div>
                      )}
                    </div>
                  </div>
                  {/* Right: metrics rows */}
                  <div className="flex-none min-w-[140px]">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center pl-4">
                        <span className="text-[11px] tracking-wider text-muted-foreground font-mono font-bold uppercase">Positions</span>
                        <span className="text-[11px] font-medium">{filteredPositionCount}</span>
                      </div>
                      <div className="flex justify-between items-center pl-4">
                        <span className="text-[11px] tracking-wider text-muted-foreground font-mono font-bold uppercase">Net APY</span>
                        <span className="text-[11px] font-medium">
                          {isPlaceholderComposition ? (
                            '-'
                          ) : (
                            effectiveAprPct !== null ? (
                              effectiveAprPct > 999 ? (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="cursor-default">&gt;999%</span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">{formatPercent(effectiveAprPct, { min: 2, max: 2 })}</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                formatPercent(effectiveAprPct, { min: 1, max: 1 })
                              )
                            ) : '—'
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between items-center pl-4">
                        <span className="text-[11px] tracking-wider text-muted-foreground font-mono font-bold uppercase">Fees</span>
                        <span className="text-[11px] font-medium">{formatUSD(totalFeesUSD)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
          )}
          </div>
        )}

        {/* NEW: Portfolio sections with selector + right Balances aside */}
        <div className="mt-6 flex flex-col lg:flex-row" style={{ gap: `${getColumnGapPx(viewportWidth)}px` }}>
          {/* Mobile: Show Balances first (only on testnet) */}
          {showBalancesPanel && isMobile && !isIntegrateBalances && (
            <aside className="lg:flex-none" style={{ width: viewportWidth >= 1024 ? '450px' : '100%' }}>
              <div className="mb-2 flex items-center gap-2 justify-between">
                <button
                  type="button"
                  className="px-2 py-1 text-xs rounded-md border border-sidebar-border bg-button text-foreground brightness-110"
                  style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                >
                  Balances
                </button>
                {/* Claim Faucet button aligned to the right, styled like selector (hidden when no balances) */}
                {(() => {
                  // Use synced cached last claim ts to mirror sidebar behavior
                  // -1 (unknown) should render a neutral disabled state (no active claim button)
                  const last = faucetLastClaimTs < 0 ? -1 : Number(faucetLastClaimTs || 0);
                  const now = Math.floor(Date.now() / 1000);
                  // If we have onchain timestamp, prefer it for gating
                  const onchainLast = faucetLastCalledOnchain ? Number(faucetLastCalledOnchain) : null;
                  const effectiveLast = onchainLast && onchainLast > 0 ? onchainLast : (last >= 0 ? last : -1);
                  const canClaim = isConnected && currentChainId === baseSepolia.id && effectiveLast >= 0 && (effectiveLast === 0 || now - effectiveLast >= 24 * 60 * 60);
                  const isPortfolioEmpty = (walletBalances.length || 0) === 0 && !isLoadingWalletBalances;
                  if (isPortfolioEmpty) return null;
                  const handleClick = async () => {
                    if (!canClaim) {
                      toast.error('Can only claim once per day', { icon: <OctagonX className="h-4 w-4 text-red-500" /> });
                      return;
                    }
                    try {
                      setIsFaucetBusy(true);
                      const res = await fetch('/api/misc/faucet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userAddress: accountAddress, chainId: baseSepolia.id }) });
                      const data = await res.json();
                      if (!res.ok) {
                        const msg = (data?.errorDetails || data?.message || '').toLowerCase();
                        if (msg.includes('once per day')) {
                          toast.error('Can only claim once per day', { icon: <OctagonX className="h-4 w-4 text-red-500" /> });
                        } else {
                          toast.error(data?.errorDetails || data?.message || 'API Error', { icon: <OctagonX className="h-4 w-4 text-red-500" /> });
                        }
                        setIsFaucetBusy(false);
                        return;
                      }
                      toast.info('Sending faucet transaction to wallet...');
                      // Prompt wallet just like sidebar
                      writeContract({
                        address: data.to as `0x${string}`,
                        abi: faucetAbi,
                        functionName: 'faucet',
                        args: [],
                      });
                    } catch (err: any) {
                      console.error('[Portfolio] Faucet error:', err);
                      toast.error(err?.message || 'Transaction failed', { icon: <OctagonX className="h-4 w-4 text-red-500" /> });
                      setIsFaucetBusy(false);
                    }
                  };
                  // Disable only when processing/confirming, like sidebar
                  const disabled = Boolean(isFaucetBusy || isFaucetConfirming);
                  const className = canClaim
                    ? `px-2 py-1 text-xs rounded-md border border-sidebar-primary bg-button-primary text-sidebar-primary transition-colors ${disabled ? 'opacity-70 cursor-not-allowed' : 'hover-button-primary'}`
                    : `px-2 py-1 text-xs rounded-md border border-sidebar-border bg-button text-muted-foreground transition-colors ${disabled || last < 0 ? 'opacity-70 cursor-not-allowed' : 'hover:bg-muted/60'}`;
                  const style = canClaim ? undefined : { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } as React.CSSProperties;
                  return (
                    <button type="button" onClick={handleClick} className={className} style={style} disabled={disabled || last < 0}>
                      {disabled ? 'Processing…' : (last < 0 ? '—' : 'Claim Faucet')}
                    </button>
                  );
                })()}
              </div>
              <div className={`rounded-lg bg-muted/30 border border-sidebar-border/60 ${showSkeletonFor.table ? 'animate-skeleton-pulse' : ''}`}>
                {showSkeletonFor.table ? (
                  <BalancesListSkeleton />
                ) : (!isConnected) ? (
                  <div className="border border-dashed rounded-lg bg-muted/10 p-8 w-full flex items-center justify-center">
                    <div className="w-48">
                      <ConnectWalletButton />
                    </div>
                  </div>
                ) : (walletBalances.length === 0 && !isLoadingWalletBalances) ? (
                  <div className="border border-dashed rounded-lg bg-muted/10 p-8 w-full flex items-center justify-center">
                    <div className="text-sm text-white/75">No Balances</div>
                  </div>
                ) : (
                  <div className="overflow-hidden">
                    <div className="flex items-center justify-between pl-6 pr-6 py-3 border-b border-sidebar-border/60 text-xs text-muted-foreground">
                      <span className="tracking-wider font-mono font-bold">TOKEN</span>
                      <button type="button" className="group inline-flex items-center" onClick={() => setBalancesSortDir((d) => d === 'desc' ? 'asc' : 'desc')}>
                        <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">VALUE</span>
                        {renderSortIcon(balancesSortDir)}
                      </button>
                    </div>
                    <div className="p-0">
                  <div className="flex flex-col divide-y divide-sidebar-border/60">
                    {(() => {
                      const sorted = [...walletBalances].sort((a, b) => balancesSortDir === 'asc' ? a.usdValue - b.usdValue : b.usdValue - a.usdValue);
                      return sorted;
                    })().map((tb) => {
                      const tokenInfo = getToken(tb.symbol) as any;
                      const iconSrc = tokenInfo?.icon || '/placeholder.svg';
                      const ch = walletPriceChange24hPctMap?.[tb.symbol] ?? 0;
                      const deltaUsd = (() => {
                        const c = tb.usdValue || 0;
                        const denom = 1 + (isFinite(ch) ? ch : 0) / 100;
                        if (denom === 0) return 0;
                        return c - c / denom;
                      })();
                      const isUp = deltaUsd >= 0;
                      const amountDisplayDecimals = 6;
                      return (
                        <div key={tb.symbol} className="flex items-center justify-between h-[64px] pl-6 pr-6 group">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-full overflow-hidden bg-background flex-shrink-0">
                              <Image src={iconSrc} alt={tb.symbol} width={24} height={24} className="w-full h-full object-cover" />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium truncate max-w-[140px]">{tb.symbol}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end whitespace-nowrap pl-2 gap-1">
                            {/* Top line: current USD (always visible) */}
                            <span className="text-sm text-foreground font-medium leading-none">{formatUSD(tb.usdValue)}</span>
                            <div className="flex items-center gap-2 leading-none" style={{ marginTop: 2 }}>
                              <span className="text-xs text-muted-foreground">
                                {formatNumber(tb.balance, { min: amountDisplayDecimals, max: amountDisplayDecimals })}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                    </div>
                  </div>
                )}
              </div>
            </aside>
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
                <div>
                  <div>
                    {showSkeletonFor.table ? (
                      <ActivePositionsSkeleton />
                    ) : (!isConnected) ? (
                      <div className="border border-dashed rounded-lg bg-muted/10 p-6 w-full flex items-center justify-center">
                        <div className="w-48">
                          <ConnectWalletButton />
                        </div>
                      </div>
                    ) : showSkeletonFor.table === false && activePositions.length === 0 ? (
                      <div className="border border-dashed rounded-lg bg-muted/10 p-6 w-full flex items-center justify-center">
                        <div className="text-sm text-white/75">No active positions.</div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 lg:gap-4" key={`view-${viewMode}`}>
                        {groupedByPool.map(({ poolId, items, totalUSD }, groupIndex) => {
                          const poolKey = String(poolId).toLowerCase();
                          const first = items[0];
                          const isSinglePosition = items.length === 1;
                          const isExpanded = !!expandedPools[poolKey];
                          const token0Icon = getToken(first?.token0?.symbol || '')?.icon || '/placeholder.svg';
                          const token1Icon = getToken(first?.token1?.symbol || '')?.icon || '/placeholder.svg';
                          const uniqueKey = viewMode === 'list' ? `list-${first?.positionId}` : `folder-${poolKey}`;
                          return (
                            <React.Fragment key={uniqueKey}>
                              {!isSinglePosition && (
                                <div
                                  className={`flex items-center justify-between px-4 py-3 rounded-lg border border-sidebar-border/60 bg-muted/30 hover:bg-muted/40 cursor-pointer`}
                                  onClick={() => togglePoolExpanded(poolKey)}
                                >
                                  <div className="flex items-center gap-3 min-w-0">
                                    <div className="relative" style={{ width: '3.5rem', height: '1.75rem' }}>
                                      <div className="absolute top-1/2 -translate-y-1/2 left-0 rounded-full overflow-hidden bg-background z-10" style={{ width: 28, height: 28 }}>
                                        <Image src={token0Icon} alt={first?.token0?.symbol || ''} width={28} height={28} className="w-full h-full object-cover" />
                                      </div>
                                      <div className="absolute top-1/2 -translate-y-1/2" style={{ left: '1rem', width: '1.75rem', height: '1.75rem' }}>
                                        <div className="absolute inset-0 rounded-full overflow-hidden bg-background z-30">
                                          <Image src={token1Icon} alt={first?.token1?.symbol || ''} width={28} height={28} className="w-full h-full object-cover" />
                                        </div>
                                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-main z-20" style={{ width: 32, height: 32 }}></div>
                                      </div>
                                    </div>
                                    <div className="truncate font-normal text-sm">{first?.token0?.symbol}/{first?.token1?.symbol}</div>
                                    <TooltipProvider delayDuration={0}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="ml-1 w-5 h-5 flex items-center justify-center text-[10px] rounded bg-button text-muted-foreground cursor-default">
                                            {items.length}
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">Position Count</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </div>
                                  <div className="flex items-center gap-3">
                                    <TooltipProvider delayDuration={0}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div className="text-xs text-muted-foreground whitespace-nowrap cursor-default">{formatUSD(totalUSD)}</div>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">Total Value</TooltipContent>
                                      </Tooltip>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div>
                                            {(() => {
                                              const aprStr = aprByPoolId[poolKey];
                                              const poolApr = typeof aprStr === 'string' && aprStr.endsWith('%') ? parseFloat(aprStr.replace('%', '')) : null;

                                              let weightedApy = 0;
                                              let groupTotalUsd = 0;
                                              for (const pos of items) {
                                                const s0 = pos?.token0?.symbol as string | undefined;
                                                const s1 = pos?.token1?.symbol as string | undefined;
                                                const a0 = parseFloat(pos?.token0?.amount || '0');
                                                const a1 = parseFloat(pos?.token1?.amount || '0');
                                                const p0 = (s0 && portfolioData.priceMap[s0.toUpperCase()]) || (s0 && portfolioData.priceMap[s0]) || 0;
                                                const p1 = (s1 && portfolioData.priceMap[s1.toUpperCase()]) || (s1 && portfolioData.priceMap[s1]) || 0;
                                                const posUsd = (isFinite(a0) ? a0 : 0) * p0 + (isFinite(a1) ? a1 : 0) * p1;
                                                if (posUsd <= 0) continue;

                                                const feeData = batchFeesData?.find(f => f.positionId === pos.positionId);
                                                let feesUSD = 0;
                                                if (feeData) {
                                                  const d0 = (s0 ? tokenDefinitions?.[s0 as string]?.decimals : undefined) ?? 18;
                                                  const d1 = (s1 ? tokenDefinitions?.[s1 as string]?.decimals : undefined) ?? 18;
                                                  try {
                                                    const f0 = parseFloat(viemFormatUnits(BigInt(feeData.amount0 || '0'), d0));
                                                    const f1 = parseFloat(viemFormatUnits(BigInt(feeData.amount1 || '0'), d1));
                                                    feesUSD = (isFinite(f0) ? f0 : 0) * p0 + (isFinite(f1) ? f1 : 0) * p1;
                                                  } catch {}
                                                }
                                                const lastTs = pos.lastTimestamp || pos.blockTimestamp || 0;
                                                const { apy } = calculateClientAPY(feesUSD, posUsd, lastTs, poolApr);
                                                weightedApy += posUsd * (apy ?? 0);
                                                groupTotalUsd += posUsd;
                                              }

                                              const groupApy = groupTotalUsd > 0 ? weightedApy / groupTotalUsd : null;
                                              const formatAprShort = (n: number): string => {
                                                if (!Number.isFinite(n)) return '—';
                                                if (n >= 1000) return `${(n / 1000).toFixed(1)}K%`;
                                                if (n > 99.99) return `${Math.round(n)}%`;
                                                if (n > 9.99) return `${n.toFixed(1)}%`;
                                                return `${n.toFixed(2)}%`;
                                              };
                                              return groupApy !== null && groupApy > 0 ? (
                                                <span className="h-5 px-2 flex items-center justify-center text-[10px] rounded bg-green-500/20 text-green-500 font-medium">{formatAprShort(groupApy)}</span>
                                              ) : (
                                                <span className="text-xs text-muted-foreground">—</span>
                                              );
                                            })()}
                                          </div>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">APY</TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
                                      <path d="m9 18 6-6-6-6" />
                                    </svg>
                                  </div>
                                </div>
                              )}
                              {(isSinglePosition || isExpanded) && (
                                <div className={cn("flex flex-col gap-3 lg:gap-4", !isSinglePosition && "pl-4 border-l border-dashed border-sidebar-border/60 ml-4")}>
                                  {items.map((position) => {
                                    const valueUSD = (() => {
                                      const sym0 = position?.token0?.symbol as string | undefined;
                                      const sym1 = position?.token1?.symbol as string | undefined;
                                      const amt0 = parseFloat(position?.token0?.amount || '0');
                                      const amt1 = parseFloat(position?.token1?.amount || '0');
                                      const price0 = (sym0 && portfolioData.priceMap[sym0]) || 0;
                                      const price1 = (sym1 && portfolioData.priceMap[sym1]) || 0;
                                      const a0 = isFinite(amt0) ? amt0 : 0;
                                      const a1 = isFinite(amt1) ? amt1 : 0;
                                      const p0 = isFinite(price0) ? price0 : 0;
                                      const p1 = isFinite(price1) ? price1 : 0;
                                      return a0 * p0 + a1 * p1;
                                    })();
                                    return (
                                      <PositionCardCompact
                                        key={position.positionId}
                                        position={position}
                                        valueUSD={valueUSD}
                                        onClick={() => {
                                          setSelectedPosition(position);
                                          setIsPositionModalOpen(true);
                                        }}
                                        getUsdPriceForSymbol={getUsdPriceForSymbol}
                                        convertTickToPrice={convertTickToPrice}
                                        poolContext={{
                                          currentPrice: poolDataByPoolId[poolKey]?.price ? String(poolDataByPoolId[poolKey].price) : null,
                                          currentPoolTick: typeof poolDataByPoolId[poolKey]?.tick === 'number' ? poolDataByPoolId[poolKey].tick : null,
                                          poolAPY: (() => {
                                            const aprStr = aprByPoolId[poolKey];
                                            if (!aprStr || aprStr === 'N/A' || aprStr === 'Loading...') return 0;
                                            const parsed = parseFloat(aprStr.replace('%', ''));
                                            return isFinite(parsed) ? parsed : 0;
                                          })(),
                                          isLoadingPrices: !readiness.prices,
                                          isLoadingPoolStates: isLoadingPoolStates,
                                        }}
                                        fees={{
                                          raw0: batchFeesData?.find(f => f.positionId === position.positionId)?.amount0 ?? null,
                                          raw1: batchFeesData?.find(f => f.positionId === position.positionId)?.amount1 ?? null
                                        }}
                                        className={isPositionsStale ? 'cache-stale' : undefined}
                                        showMenuButton={true}
                                        onVisitPool={() => {
                                          const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === position.poolId.toLowerCase());
                                          if (poolConfig) {
                                            window.open(`/liquidity/${poolConfig.id}`, '_blank');
                                          }
                                        }}
                                      />
                                    );
                                  })}
                                </div>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Balances as a tab when integrated (desktop/tablet only) */}
              {isIntegrateBalances && selectedSection === 'Balances' && (
                <div>
                  <div className={`${isIntegrateBalances && selectedSection === 'Balances' && (walletBalances.length || 0) === 0 && !isLoadingWalletBalances ? "" : "rounded-lg bg-muted/30 border border-sidebar-border/60"} ${isLoadingWalletBalances ? 'animate-pulse' : ''}`}>
                    <div className={(walletBalances.length || 0) === 0 && !isLoadingWalletBalances ? "hidden" : "flex items-center justify-between pl-6 pr-6 py-3 border-b border-sidebar-border/60 text-xs text-muted-foreground"}>
                      <span className="tracking-wider font-mono font-bold">TOKEN</span>
                      <button type="button" className="group inline-flex items-center" onClick={() => setBalancesSortDir((d) => d === 'desc' ? 'asc' : 'desc')}>
                        <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">VALUE</span>
                        {renderSortIcon(balancesSortDir)}
                      </button>
                    </div>
                    <div className="p-0">
                      {isLoadingWalletBalances ? (
                        <BalancesListSkeleton />
                      ) : (walletBalances.length || 0) === 0 ? (
                        <div className="border border-dashed rounded-lg bg-muted/10 p-8 w-full flex items-center justify-center">
                          <div className="text-sm text-white/75">{!isConnected ? 'No Wallet Connected' : 'No Balances'}</div>
                        </div>
                      ) : (
                        <div className="flex flex-col divide-y divide-sidebar-border/60">
                          {(() => {
                            const sorted = [...walletBalances].sort((a, b) => balancesSortDir === 'asc' ? a.usdValue - b.usdValue : b.usdValue - a.usdValue);
                            return sorted;
                          })().map((tb) => {
                            const tokenInfo = getToken(tb.symbol) as any;
                            const iconSrc = tokenInfo?.icon || '/placeholder.svg';
                            const ch = walletPriceChange24hPctMap?.[tb.symbol] ?? 0;
                            const deltaUsd = (() => {
                              const c = tb.usdValue || 0;
                              const denom = 1 + (isFinite(ch) ? ch : 0) / 100;
                              if (denom === 0) return 0;
                              return c - c / denom;
                            })();
                            const isUp = deltaUsd >= 0;
                            const amountDisplayDecimals = 6;
                            return (
                              <div key={tb.symbol} className="flex items-center justify-between h-[64px] pl-6 pr-6 group">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="w-6 h-6 rounded-full overflow-hidden bg-background flex-shrink-0">
                                    <Image src={iconSrc} alt={tb.symbol} width={24} height={24} className="w-full h-full object-cover" />
                                  </div>
                                  <div className="flex flex-col min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium truncate max-w-[140px]">{tb.symbol}</span>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex flex-col items-end whitespace-nowrap pl-2 gap-1">
                                  <span className="text-sm text-foreground font-medium leading-none">{formatUSD(tb.usdValue)}</span>
                                  <div className="flex items-center gap-2 leading-none" style={{ marginTop: 2 }}>
                                    <span className="text-xs text-muted-foreground">
                                      {formatNumber(tb.balance, { min: amountDisplayDecimals, max: amountDisplayDecimals })}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>
          </div>
          {/* Right-side: Balances (desktop only) */}
           {!isIntegrateBalances && !isMobile && (
             <aside className="lg:flex-none" style={{ width: viewportWidth >= 1024 ? '450px' : '100%' }}>
            <div className="mb-2 flex items-center gap-2 justify-between">
              <button
                type="button"
                className="px-2 py-1 text-xs rounded-md border border-sidebar-border bg-button text-foreground brightness-110"
                style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
              >
                Balances
              </button>
              {/* Claim Faucet button aligned to the right, styled like selector (hidden when no balances) */}
              {(() => {
                // Use synced cached last claim ts to mirror sidebar behavior
                // -1 (unknown) should render a neutral disabled state (no active claim button)
                const last = faucetLastClaimTs < 0 ? -1 : Number(faucetLastClaimTs || 0);
                const now = Math.floor(Date.now() / 1000);
                // If we have onchain timestamp, prefer it for gating
                const onchainLast = faucetLastCalledOnchain ? Number(faucetLastCalledOnchain) : null;
                const effectiveLast = onchainLast && onchainLast > 0 ? onchainLast : (last >= 0 ? last : -1);
                const canClaim = isConnected && currentChainId === baseSepolia.id && effectiveLast >= 0 && (effectiveLast === 0 || now - effectiveLast >= 24 * 60 * 60);
                const isPortfolioEmpty = (walletBalances.length || 0) === 0 && !isLoadingWalletBalances;
                if (isPortfolioEmpty) return null;
                const handleClick = async () => {
                  if (!canClaim) {
                    toast.error('Can only claim once per day', { icon: <OctagonX className="h-4 w-4 text-red-500" /> });
                    return;
                  }
                  try {
                    setIsFaucetBusy(true);
                    const res = await fetch('/api/misc/faucet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userAddress: accountAddress, chainId: baseSepolia.id }) });
                    const data = await res.json();
                    if (!res.ok) {
                      const msg = (data?.errorDetails || data?.message || '').toLowerCase();
                      if (msg.includes('once per day')) {
                        toast.error('Can only claim once per day', { icon: <OctagonX className="h-4 w-4 text-red-500" /> });
                      } else {
                        toast.error(data?.errorDetails || data?.message || 'API Error', { icon: <OctagonX className="h-4 w-4 text-red-500" /> });
                      }
                      setIsFaucetBusy(false);
                      return;
                    }
                    toast.info('Sending faucet transaction to wallet...');
                    // Prompt wallet just like sidebar
                    writeContract({
                      address: data.to as `0x${string}`,
                      abi: faucetAbi,
                      functionName: 'faucet',
                      args: [],
                      chainId: data.chainId,
                    }, {
                      onSuccess: (hash) => {
                        setFaucetHash(hash);
                        // Refresh onchain timestamp after sending
                        setTimeout(() => { try { refetchFaucetOnchain?.(); } catch {} }, 1000);
                      }
                    } as any);
                  } catch (e: any) {
                    toast.error(`Error during faucet action: ${e?.message || 'Unknown error'}`, { icon: <OctagonX className="h-4 w-4 text-red-500" /> });
                    setIsFaucetBusy(false);
                  }
                };
                // Disable only when processing/confirming, like sidebar
                const disabled = Boolean(isFaucetBusy || isFaucetConfirming);
                const className = canClaim
                  ? `px-2 py-1 text-xs rounded-md border border-sidebar-primary bg-button-primary text-sidebar-primary transition-colors ${disabled ? 'opacity-70 cursor-not-allowed' : 'hover-button-primary'}`
                  : `px-2 py-1 text-xs rounded-md border border-sidebar-border bg-button text-muted-foreground transition-colors ${disabled || last < 0 ? 'opacity-70 cursor-not-allowed' : 'hover:bg-muted/60'}`;
                const style = canClaim ? undefined : { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } as React.CSSProperties;
                return (
                  <button type="button" onClick={handleClick} className={className} style={style} disabled={disabled || last < 0}>
                    {disabled ? 'Processing…' : (last < 0 ? '—' : 'Claim Faucet')}
                  </button>
                );
              })()}
            </div>
            <div className={`${(walletBalances.length || 0) === 0 && !isLoadingWalletBalances ? "" : "rounded-lg bg-muted/30 border border-sidebar-border/60"} ${isLoadingWalletBalances ? 'animate-pulse' : ''}`}>
              <div className={(walletBalances.length || 0) === 0 && !isLoadingWalletBalances ? "hidden" : "flex items-center justify-between pl-6 pr-6 py-3 border-b border-sidebar-border/60 text-xs text-muted-foreground"}>
                <span className="tracking-wider font-mono font-bold">TOKEN</span>
                <button type="button" className="group inline-flex items-center" onClick={() => setBalancesSortDir((d) => d === 'desc' ? 'asc' : 'desc')}>
                  <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">VALUE</span>
                  {renderSortIcon(balancesSortDir)}
                </button>
              </div>
               <div className="p-0">
                 {isLoadingWalletBalances ? (
                   <BalancesListSkeleton />
                 ) : (walletBalances.length || 0) === 0 ? (
                   <div className="border border-dashed rounded-lg bg-muted/10 p-8 w-full flex items-center justify-center">
                     <div className="text-sm text-white/75">{!isConnected ? 'No Wallet Connected' : 'No Balances'}</div>
                   </div>
                 ) : (
                  <div className="flex flex-col divide-y divide-sidebar-border/60">
                    {(() => {
                      const sorted = [...walletBalances].sort((a, b) => balancesSortDir === 'asc' ? a.usdValue - b.usdValue : b.usdValue - a.usdValue);
                      return sorted;
                    })().map((tb) => {
                      const tokenInfo = getToken(tb.symbol) as any;
                      const iconSrc = tokenInfo?.icon || '/placeholder.svg';
                      const ch = walletPriceChange24hPctMap?.[tb.symbol] ?? 0;
                      const deltaUsd = (() => {
                        const c = tb.usdValue || 0;
                        const denom = 1 + (isFinite(ch) ? ch : 0) / 100;
                        if (denom === 0) return 0;
                        return c - c / denom;
                      })();
                      const isUp = deltaUsd >= 0;
                      const amountDisplayDecimals = 6;
                      return (
                        <div key={tb.symbol} className="flex items-center justify-between h-[64px] pl-6 pr-6 group">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-full overflow-hidden bg-background flex-shrink-0">
                              <Image src={iconSrc} alt={tb.symbol} width={24} height={24} className="w-full h-full object-cover" />
                            </div>
                            <div className="flex flex-col min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium truncate max-w-[140px]">{tb.symbol}</span>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col items-end whitespace-nowrap pl-2 gap-1">
                            {/* Top line: current USD (always visible) */}
                            <span className="text-sm text-foreground font-medium leading-none">{formatUSD(tb.usdValue)}</span>
                            <div className="flex items-center gap-2 leading-none" style={{ marginTop: 2 }}>
                              <span className="text-xs text-muted-foreground">
                                {formatNumber(tb.balance, { min: amountDisplayDecimals, max: amountDisplayDecimals })}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </aside>
          )}
        </div>
        {/* no third state below 1100px */}
      </div>
        {/* Add Liquidity Modal */}
        <AddLiquidityModal
          isOpen={showIncreaseModal}
          onOpenChange={setShowIncreaseModal}
          onLiquidityAdded={() => {
            const poolSubgraphId = positionToModify?.poolId;
            if (poolSubgraphId) {
                const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === poolSubgraphId.toLowerCase());
                if (poolConfig) {
                  modifiedPositionPoolInfoRef.current = { poolId: poolConfig.id, subgraphId: poolSubgraphId };
                }
            }
            publicClient.getBlockNumber().then(block => lastTxBlockRef.current = block);
          }}
          positionToModify={positionToModify}
          feesForIncrease={feesForIncrease}
          increaseLiquidity={positionToModify ? (data) => {
            pendingActionRef.current = { type: 'increase' };
            increaseLiquidity(data);
          } : undefined}
          isIncreasingLiquidity={isIncreasingLiquidity}
          isIncreaseSuccess={isIncreaseSuccess}
          increaseTxHash={increaseTxHash}
          sdkMinTick={-887272}
          sdkMaxTick={887272}
          defaultTickSpacing={60}
        />

        {/* Withdraw Modal */}
        <WithdrawLiquidityModal
          isOpen={showWithdrawModal}
          onOpenChange={setShowWithdrawModal}
          position={positionToWithdraw}
          feesForWithdraw={feesForWithdraw}
          decreaseLiquidity={decreaseLiquidity}
          isWorking={isDecreasingLiquidity}
          isDecreaseSuccess={isDecreaseSuccess}
          decreaseTxHash={decreaseTxHash}
          onLiquidityWithdrawn={() => {
            const poolSubgraphId = positionToWithdraw?.poolId;
            if (poolSubgraphId) {
                const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === poolSubgraphId.toLowerCase());
                if (poolConfig) {
                  modifiedPositionPoolInfoRef.current = { poolId: poolConfig.id, subgraphId: poolSubgraphId };
                }
            }
            publicClient.getBlockNumber().then(block => lastTxBlockRef.current = block);
          }}
        />

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
          prefetchedRaw0={null}
          prefetchedRaw1={null}
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
          currentPrice={poolDataByPoolId[selectedPosition.poolId?.toLowerCase()]?.price?.toString() || null}
          currentPoolTick={poolDataByPoolId[selectedPosition.poolId?.toLowerCase()]?.tick || null}
          selectedPoolId={(() => {
            const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === selectedPosition.poolId?.toLowerCase());
            return poolConfig?.id;
          })()}
          chainId={targetChainId}
          currentPoolSqrtPriceX96={poolDataByPoolId[selectedPosition.poolId?.toLowerCase()]?.sqrtPriceX96?.toString() || null}
          poolToken0={(() => {
            const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === selectedPosition.poolId?.toLowerCase());
            return poolConfig ? getToken(poolConfig.currency0.symbol) : undefined;
          })()}
          poolToken1={(() => {
            const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === selectedPosition.poolId?.toLowerCase());
            return poolConfig ? getToken(poolConfig.currency1.symbol) : undefined;
          })()}
          showViewPoolButton={true}
          onViewPool={() => {
            const poolConfig = getAllPools().find(p => p.subgraphId?.toLowerCase() === selectedPosition.poolId?.toLowerCase());
            if (poolConfig) {
              router.push(`/liquidity/${poolConfig.id}`);
            }
          }}
        />
      )}

      </AppLayout>
    </PortfolioFilterContext.Provider>
  );
}

interface CompactCompositionBarProps {
  composition: Array<{ label: string; pct: number; color: string }>;
  onHover: (segment: number | null) => void;
  hoveredSegment: number | null;
  handleRestClick: (segment: any, segmentIndex?: number) => void;
  setIsRestCycling: (value: boolean) => void;
  isRestCycling: boolean;
  restCycleIndex: number;
  initialWidth?: number; // width computed by parent for first paint
  forceHideLabels?: boolean;
  onApplySort?: () => void;
  onHoverToken?: (label: string | null) => void;
}
function CompactCompositionBar({ composition, onHover, hoveredSegment, handleRestClick, setIsRestCycling, isRestCycling, restCycleIndex, initialWidth, forceHideLabels, onApplySort, onHoverToken }: CompactCompositionBarProps) {
  //
  const SMALL_SEGMENT_THRESHOLD = 10; // tweakable (e.g., 5)
  const { activeTokenFilter, setActiveTokenFilter } = React.useContext(PortfolioFilterContext);
  const selectedIdx = activeTokenFilter
    ? (() => {
        const idx = composition.findIndex(c => c.label?.toUpperCase?.() === activeTokenFilter.toUpperCase());
        return idx >= 0 ? idx : null;
      })()
    : null;
  const hoverIdx = hoveredSegment;
  const hideAllInlineLabels = React.useMemo(() => {
    if (forceHideLabels) return true;
    return composition.length === 1 && (composition[0] as any)?.label === 'All' && Math.round((composition[0] as any)?.pct || 0) === 100;
  }, [composition, forceHideLabels]);
  const hoverColor = '#f45502';
  const selectedColor = hoverColor;
  
  // Check if Rest segment should be highlighted when cycling
  const isRestSegmentHighlighted = (segmentIdx: number) => {
    if (!isRestCycling) return false;
    const segment = composition[segmentIdx];
    return segment?.label === 'Rest';
  };
  const normalized = React.useMemo(() => {
    const totalPct = composition.reduce((a, b) => a + b.pct, 0) || 1;
    return composition.map((c) => ({ ...c, pct: (c.pct / totalPct) * 100 }));
  }, [composition]);

  // Refs and measured width must be declared before any memo that reads them
  const barContainerRef = React.useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = React.useState<number>(Math.max(0, Math.round(initialWidth ?? 300))); // seed from parent if provided

  // Force immediate render for compact view
  const [forceRender, setForceRender] = React.useState(false);
  React.useEffect(() => {
    setForceRender(true);
  }, []);

  // Compute pixel-perfect column widths that sum exactly to the container width.
  // This avoids cumulative percentage rounding drift.
  const segmentPixelWidths = React.useMemo(() => {
    const totalWidth = Math.max(0, Math.round(availableWidth));
    if (!isFinite(totalWidth) || totalWidth <= 0 || normalized.length === 0) return [] as number[];
    const raw = normalized.map(s => (s.pct / 100) * totalWidth);
    const floors = raw.map(x => Math.floor(x));
    let used = floors.reduce((a, b) => a + b, 0);
    let remainder = totalWidth - used;
    if (remainder > 0) {
      // Distribute remaining pixels to entries with largest fractional parts
      const fracIndices = raw
        .map((x, i) => ({ i, frac: x - Math.floor(x) }))
        .sort((a, b) => b.frac - a.frac)
        .map(o => o.i);
      for (let k = 0; k < remainder && k < fracIndices.length; k += 1) {
        floors[fracIndices[k]] += 1;
      }
      used = floors.reduce((a, b) => a + b, 0);
    }
    // As a final guard, if rounding anomalies occur, adjust last cell
    if (used !== totalWidth && floors.length > 0) {
      floors[floors.length - 1] += (totalWidth - used);
    }
    return floors;
  }, [normalized, availableWidth]);

  const gridTemplateColumns = React.useMemo(
    () => segmentPixelWidths.map((w) => `${w}px`).join(' '),
    [segmentPixelWidths]
  );

  const segmentLeftOffsets = React.useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (let i = 0; i < segmentPixelWidths.length; i += 1) {
      offsets.push(acc);
      acc += segmentPixelWidths[i];
    }
    return offsets;
  }, [segmentPixelWidths]);

  const DEBUG_TICKS = false;

  // Placeholder flag: single 100% segment labeled 'All', or explicitly forced by parent
  const hideAllLabels = React.useMemo(() => {
    if (forceHideLabels) return true;
    return composition.length === 1 && (composition[0] as any)?.label === 'All' && Math.round((composition[0] as any)?.pct || 0) === 100;
  }, [composition, forceHideLabels]);

  // duplicate removed

  const calculateAvailableWidth = React.useCallback(() => {
    const container = barContainerRef.current;
    if (!container) return;
    // Measure the immediate wrapper that has the left padding applied
    const wrapper = container.parentElement;
    if (!wrapper) return;
    const wrapperRect = wrapper.getBoundingClientRect();
    const computed = window.getComputedStyle(wrapper);
    const paddingLeft = parseFloat(computed.paddingLeft || '0') || 0;
    const paddingRight = parseFloat(computed.paddingRight || '0') || 0;
    const innerWidth = Math.max(0, Math.round(wrapperRect.width - paddingLeft - paddingRight));
    if (innerWidth > 0) setAvailableWidth(innerWidth);
  }, []);

  // Measure on mount and resize. Also react if parent supplies a different initialWidth later
  React.useEffect(() => {
    calculateAvailableWidth();
    const onResize = () => calculateAvailableWidth();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [calculateAvailableWidth]);

  React.useEffect(() => {
    if (typeof initialWidth === 'number' && initialWidth > 0) {
      setAvailableWidth(Math.max(0, Math.round(initialWidth)));
    }
  }, [initialWidth]);

  return (
    <TooltipProvider>
    <div ref={barContainerRef} className="relative flex-none box-border" style={{ width: `${availableWidth}px` }} onMouseLeave={() => (!hideAllLabels) && onHover(null)}>
      {/* Bar row */}
      <div className="h-2 w-full flex overflow-hidden rounded-full" style={{ gap: 0 }}>
        {normalized.map((s, i) => (
          <div
            key={`bar-${i}`}
            style={{ 
              width: `${segmentPixelWidths[i] || 0}px`, 
              backgroundColor: hideAllLabels ? s.color : (hoverIdx === i ? hoverColor : (selectedIdx === i ? selectedColor : (isRestSegmentHighlighted(i) ? selectedColor : s.color))), 
              opacity: 0.95 
            }}
            onMouseEnter={() => { if (!hideAllLabels) { onHover(i); try { onHoverToken?.((s as any)?.label === 'Rest' ? null : (s as any)?.label); } catch {} } }}
            onMouseLeave={() => { if (!hideAllLabels) { onHover(null); try { onHoverToken?.(null); } catch {} } }}
            onClick={() => {
              if (s.label === 'Rest') {
                handleRestClick(s, i);
              } else {
                setActiveTokenFilter((activeToken) => (activeToken?.toUpperCase?.() === s.label?.toUpperCase?.() ? null : s.label));
                setIsRestCycling(false);
                try { onApplySort?.(); } catch {}
              }
            }}
          />
        ))}
      </div>
      {/* Hover zones spanning bar + label area */}
      <div className="absolute left-0 top-[-8px] z-10" style={{ width: '100%', height: '40px' }}>
        {normalized.map((s, i) => {
          const pctRounded = Math.round(s.pct);
          const showTip = (() => {
            if (hideAllLabels) return false;
            if (s.pct < SMALL_SEGMENT_THRESHOLD) return true;
            // also show hover label if name would be hidden
            const segWidth = (segmentPixelWidths[i] || 0);
            const estChar = 7;
            const name = String(s.label || '');
            const estNameWidth = name.length * estChar;
            const estPctWidth = (`${pctRounded}%`).length * estChar;
            const minGap = 6;
            const required = estPctWidth + minGap + estNameWidth;
            return segWidth < required;
          })();
          const isRest = s.label === 'Rest';
          
          const content = hideAllLabels ? '' : isRest ? (
            <div className="space-y-1">
              {(s as any).restTokens?.map((token: any, idx: number) => (
                <div key={idx} className="flex justify-between items-center gap-2">
                  <span className="flex items-center gap-1 uppercase">
                    {/* primary marker for current highlighted token */}
                    {isRestCycling && (s as any).restTokens?.[restCycleIndex]?.label === token.label ? (
                      <span className="inline-block w-1 h-3 rounded-sm" style={{ backgroundColor: hoverColor }} />
                    ) : (
                      <span className="inline-block w-1 h-3 rounded-sm" style={{ backgroundColor: 'hsl(var(--muted-foreground))' }} />
                    )}
                    {token.label}
                  </span>
                  <span>{Math.round(token.pct)}%</span>
                </div>
              ))}
            </div>
          ) : `${pctRounded}% ${s.label}`;
          
          const zone = (
            <div
              key={`hover-zone-${i}`}
              className="absolute h-full"
              style={{ left: `${segmentLeftOffsets[i] || 0}px`, width: `${segmentPixelWidths[i] || 0}px`, cursor: 'pointer' }}
              onMouseEnter={() => { if (!hideAllLabels) { onHover(i); try { onHoverToken?.((s as any)?.label === 'Rest' ? null : (s as any)?.label); } catch {} } }}
              onMouseLeave={() => { if (!hideAllLabels) { onHover(null); try { onHoverToken?.(null); } catch {} } }}
              onClick={() => {
                if (s.label === 'Rest') {
                  handleRestClick(s, i);
                } else {
                  setActiveTokenFilter((activeToken) => (activeToken?.toUpperCase?.() === s.label?.toUpperCase?.() ? null : s.label));
                  setIsRestCycling(false);
                  try { onApplySort?.(); } catch {}
                }
              }}
            />
          );
          // Re-add popup only for cases where label isn't shown (small or hidden)
          return (showTip || (isRest && !hideAllLabels)) ? (
            <Tooltip key={`hover-zone-wrap-${i}`} open={hoverIdx === i}>
              <TooltipTrigger asChild>{zone}</TooltipTrigger>
              <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs" style={{ pointerEvents: 'none' }}>{content}</TooltipContent>
            </Tooltip>
          ) : zone;
        })}

        {DEBUG_TICKS && (
          <div className="pointer-events-none absolute inset-0 z-10">
            {segmentLeftOffsets.map((x, i) => (
              <div key={`guide-${i}`} className="absolute top-0 bottom-0" style={{ left: `${x}px`, width: 1, background: 'rgba(255,0,0,0.4)' }} />
            ))}
          </div>
        )}
      </div>
      {/* Labels row with overflow rules (inline bar) */}
      <div className="relative mt-0 text-xs" style={{ height: '14px', width: `${Math.max(0, Math.round(availableWidth))}px`, overflow: 'visible' }}>
        {(() => {
          let hideNamesFromIndex: number | null = null;
          // Disable cascade-right behavior; do not hide following percentages
          const hoveredNeedsCascade = false;
          const nodes: React.ReactNode[] = [];
          for (let i = 0; i < normalized.length; i += 1) {
            const s = normalized[i];
            const restToken = (s as any)?.restTokens?.[restCycleIndex];
            const isRestHighlighted = isRestSegmentHighlighted(i);
            const pctRounded = Math.round(isRestHighlighted && restToken ? restToken.pct : s.pct);
            const isHovered = hoverIdx === i;
            const isSelected = selectedIdx === i;
            // Available width inside this segment for text
            const segWidth = (segmentPixelWidths[i] || 0);
            const left = (segmentLeftOffsets[i] || 0);
            const leftPad = 0; // keep flush in inline
            const availableLabelWidth = Math.max(0, segWidth - leftPad);
            // Build REST-aware labels
            const isRest = (s as any).label === 'Rest';
            const isCycling = isRest && !!isRestCycling && isRestHighlighted;
            const restCount = ((s as any)?.restTokens?.length || 0) as number;
            const nameLabel = isRest ? (isCycling ? ((restToken as any)?.label || 'Assets') : 'Assets') : ((s as any).label as string);
            const percentText = hideAllLabels ? '' : (isRest ? (isCycling ? `${pctRounded}%` : `+${restCount}`) : `${pctRounded}%`);
            const estChar = 7; // px per char at this size
            const estNameWidth = (nameLabel?.length || 0) * estChar;
            const estPctWidth = (percentText?.length || 0) * estChar;
            const minGap = 6;
            // Decide if we can show name here
            const barSafetyEarly = 4; // hide a touch earlier to avoid visible overlap
            let showName = !hideAllLabels;
            const fits = availableLabelWidth >= estPctWidth + minGap + estNameWidth + barSafetyEarly;

            // NEW: determine if a tooltip will be shown for this segment
            const tooltipWillShow = s.pct < SMALL_SEGMENT_THRESHOLD || !fits;

            if (!fits && !isHovered) {
              // mark overflow start but still allow name on hover via overflow visible
              if (hideNamesFromIndex === null) hideNamesFromIndex = i;
              showName = false;
            }

            // If hovered and a tooltip is showing, hide the inline name
            if (isHovered && tooltipWillShow) {
              showName = false;
            }

            // No cascade-right; never hide following percentages
            const hideFollowingPct = false;
            // If hovered and the name cannot fit, hide the inline percent for subsequent segments and do NOT force show the name for the hovered segment
            // This preserves a clear single hover focus without crowding
            const nameLeftPadPx = isRest ? (estPctWidth + minGap) : 0;
            nodes.push(
              <div
                key={`lbl-${i}`}
                className="absolute cursor-pointer"
                style={{ 
                  left: `${left}px`, 
                  width: `${segWidth}px`, 
                  overflow: ((s as any).label === 'Rest' || isHovered) ? 'visible' : 'hidden', 
                  zIndex: ((s as any).label === 'Rest' || isHovered) ? 20 : undefined 
                }}
                onMouseEnter={() => onHover(i)}
                onMouseLeave={() => onHover(null)}
                onClick={() => {
                  if (s.label === 'Rest') {
                    handleRestClick(s, i);
                  } else {
                    setActiveTokenFilter((activeToken) => (activeToken?.toUpperCase?.() === (s as any).label?.toUpperCase?.() ? null : ((s as any).label as string)));
                    setIsRestCycling(false);
                  }
                }}
              >
                <div className="flex items-baseline gap-1" style={{ position: 'relative' }}>
                  {(() => {
                    // Always show percent/+N for REST, respect hideFollowingPct for others
                    const shouldShow = isRest || !hideFollowingPct;
                    if (!shouldShow) return null;
                    const color = isHovered ? hoverColor : ((isSelected || isRestHighlighted) ? selectedColor : s.color);
                    return (
                      <span 
                        className="font-medium"
                        style={{ 
                          color,
                          position: isRest ? 'absolute' : 'static',
                          left: isRest ? 0 : undefined,
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {percentText}
                      </span>
                    );
                  })()}
                  {showName && (
                    <span 
                      className="uppercase tracking-wider text-muted-foreground whitespace-nowrap" 
                      style={{ 
                        fontSize: 10,
                        maxWidth: isHovered ? undefined : `${Math.max(0, availableLabelWidth - estPctWidth - minGap)}px`,
                        overflow: isHovered ? 'visible' : 'hidden',
                        textOverflow: isHovered ? 'clip' : 'ellipsis',
                        textTransform: isRest && !isCycling ? 'none' : undefined,
                        color: 'hsl(var(--muted-foreground))',
                        paddingLeft: nameLeftPadPx
                      }}
                    >
                      {nameLabel}
                    </span>
                  )}
                </div>
              </div>
            );
          }
          return nodes;
        })()}
      </div>
    </div>
    </TooltipProvider>
  );
}

// Moved to components/portfolio/PortfolioTickBar
// Moved to components/portfolio/PortfolioTickBar