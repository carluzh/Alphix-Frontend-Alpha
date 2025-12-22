"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { PlusIcon, RefreshCwIcon, Check, BadgeCheck, OctagonX, ChevronLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useAccount, useBalance } from "wagmi";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import { getTokenDefinitions, TokenSymbol } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { Tooltip as UITooltip, TooltipContent as UITooltipContent, TooltipProvider as UITooltipProvider, TooltipTrigger as UITooltipTrigger } from "@/components/ui/tooltip";
import { motion, AnimatePresence } from "framer-motion";
import { Bar, BarChart, Line, LineChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer } from "recharts";
import { getPoolById, getToken } from "@/lib/pools-config";
import { getExplorerTxUrl } from "@/lib/wagmiConfig";
import { cn } from "@/lib/utils";
import { usePoolState, useAllPrices, useUncollectedFeesBatch } from "@/components/data/hooks";
import { SafeStorage } from "@/lib/safe-storage";
import { RetryUtility } from "@/lib/retry-utility";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useQueryClient } from '@tanstack/react-query';
import { getPositionManagerAddress } from '@/lib/pools-config';
import { position_manager_abi } from '@/lib/abis/PositionManager_abi';
import { loadUserPositionIds, derivePositionsFromIds, getCachedPositionTimestamps, removePositionIdFromCache } from "@/lib/client-cache";
import { invalidateAfterTx } from "@/lib/invalidation";

import type { Pool } from "@/types";
import { AddLiquidityForm } from "@/components/liquidity/AddLiquidityForm";
import React from "react";
import { useIncreaseLiquidity } from "@/components/liquidity/useIncreaseLiquidity";
import { useDecreaseLiquidity, type DecreasePositionData } from "@/components/liquidity/useDecreaseLiquidity";


import { ChevronDownIcon } from "lucide-react";

import { PositionCardCompact } from '@/components/liquidity/PositionCardCompact';
import { PositionSkeleton } from '@/components/liquidity/PositionSkeleton';

const AddLiquidityModal = dynamic(
  () => import("@/components/liquidity/AddLiquidityModal").then(m => m.AddLiquidityModal),
  { ssr: false }
);
const WithdrawLiquidityModal = dynamic(
  () => import("@/components/liquidity/WithdrawLiquidityModal").then(m => m.WithdrawLiquidityModal),
  { ssr: false }
);
const PositionDetailsModal = dynamic(
  () => import("@/components/liquidity/PositionDetailsModal").then(m => m.PositionDetailsModal),
  { ssr: false }
);


interface ChartDataPoint {
  date: string;
  volumeUSD: number;
  tvlUSD: number;
  volumeTvlRatio: number;
  emaRatio: number;
  dynamicFee: number;
}

const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;
const DEFAULT_TICK_SPACING = 60;

const formatTokenDisplayAmount = (amount: string) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num === 0) return "0";
  if (num > 0 && num < 0.000001) return "< 0.000001";
  return num.toFixed(6);
};

// Format USD value (centralized)
import { formatUSD as formatUSDShared } from "@/lib/format";
const formatUSD = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value < 1_000_000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return formatUSDShared(value);
};





const chartConfig = {
  views: { label: "Daily Values" },
  volume: { label: "Volume", color: "#404040" },
  tvl: { label: "TVL", color: "#404040" },
  volumeUSD: { label: "Volume", color: "#404040" },
  tvlUSD: { label: "TVL", color: "#404040" },
  volumeTvlRatio: { label: "Activity", color: "hsl(var(--chart-3))" },
  emaRatio: { label: "Target", color: "hsl(var(--chart-2))" },
  dynamicFee: { label: "Dynamic Fee (%)", color: "#e85102" },
} satisfies ChartConfig;

// Get pool configuration from pools.json instead of hardcoded data
const getPoolConfiguration = (poolId: string) => {
  const poolConfig = getPoolById(poolId);
  if (!poolConfig) return null;

  const token0 = getToken(poolConfig.currency0.symbol);
  const token1 = getToken(poolConfig.currency1.symbol);
  
  if (!token0 || !token1) return null;

  return {
    id: poolConfig.id,
    subgraphId: poolConfig.subgraphId,
    tokens: [
      { symbol: token0.symbol, icon: token0.icon, address: token0.address },
      { symbol: token1.symbol, icon: token1.icon, address: token1.address }
    ],
    pair: `${token0.symbol} / ${token1.symbol}`,
    // Static/fallback values - these will be replaced by fetched/cached data
    volume24h: "Loading...",
    volume7d: "Loading...",
    fees24h: "Loading...",
    fees7d: "Loading...",
    liquidity: "Loading...",
    apr: "Loading..."
  };
};

interface PoolDetailData extends Pool {
  tickSpacing?: number;
}

// Helper function to convert tick to price using the same logic as AddLiquidityForm.tsx
const convertTickToPrice = (tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string, tokenDefinitions: Record<string, { address: string; decimals: number; symbol: string }>): string => {
  // Preferred: relative to live current price when available
  if (currentPoolTick !== null && currentPrice) {
    const currentPriceNum = parseFloat(currentPrice);
    if (isFinite(currentPriceNum) && currentPriceNum > 0) {
      const priceDelta = Math.pow(1.0001, tick - currentPoolTick);
      const priceAtTick = (baseTokenForPriceDisplay === token0Symbol)
        ? 1 / (currentPriceNum * priceDelta)
        : currentPriceNum * priceDelta;
      if (isFinite(priceAtTick)) {
        if (priceAtTick < 1e-11 && priceAtTick > 0) return "0";
        if (priceAtTick > 1e30) return "∞";
        const displayDecimals = 6;
        return priceAtTick.toFixed(displayDecimals);
      }
    }
  }

  // Fallback: derive absolute price from tick + decimals (v4 orientation)
  try {
    const cfg0 = tokenDefinitions[token0Symbol as TokenSymbol];
    const cfg1 = tokenDefinitions[token1Symbol as TokenSymbol];
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
};

const AddLiquidityFormMemo = React.memo(AddLiquidityForm);

export default function PoolDetailPage() {
  const router = useRouter();
  const params = useParams<{ poolId: string }>();
  const poolId = params?.poolId || '';
  const queryClient = useQueryClient();
  const [userPositions, setUserPositions] = useState<ProcessedPosition[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(true);
  const [isDerivingNewPosition, setIsDerivingNewPosition] = useState(false);
  const [activeChart, setActiveChart] = useState<keyof Pick<typeof chartConfig, 'volume' | 'tvl' | 'volumeTvlRatio' | 'emaRatio' | 'dynamicFee'>>("volumeTvlRatio");
  const [isDynamicFeeModalOpen, setIsDynamicFeeModalOpen] = useState(false);
  const [hoveredFee, setHoveredFee] = useState<number | null>(null);

  // Pool activity height management - capture initial height on mount only
  const poolActivityRef = useRef<HTMLDivElement>(null);
  const [poolActivityHeight, setPoolActivityHeight] = useState<number | null>(null);

  // Sheet drag-to-close refs and state for Add Liquidity drawer
  const sheetDragStartYRef = useRef<number | null>(null);
  const sheetTranslateYRef = useRef(0);
  const sheetRafRef = useRef<number | null>(null);
  const sheetContentRef = useRef<HTMLDivElement | null>(null);
  const [isSheetDragging, setIsSheetDragging] = useState(false);

  const scheduleSheetTransform = useCallback(() => {
    if (sheetRafRef.current != null) return;
    sheetRafRef.current = requestAnimationFrame(() => {
      sheetRafRef.current = null;
      const el = sheetContentRef.current;
      if (!el) return;
      const y = sheetTranslateYRef.current;
      el.style.transform = y ? `translate3d(0, ${y}px, 0)` : "translate3d(0, 0, 0)";
    });
  }, []);

  const onSheetHandleTouchStart = useCallback((e: React.TouchEvent) => {
    sheetDragStartYRef.current = e.touches[0]?.clientY ?? null;
    setIsSheetDragging(true);
  }, []);

  const onSheetHandleTouchMove = useCallback((e: React.TouchEvent) => {
    const startY = sheetDragStartYRef.current;
    if (startY == null) return;
    const currentY = e.touches[0]?.clientY ?? startY;
    const dy = currentY - startY;
    if (dy <= 0) return;
    sheetTranslateYRef.current = Math.min(dy, 220);
    scheduleSheetTransform();
  }, [scheduleSheetTransform]);

  const onSheetHandleTouchEnd = useCallback(() => {
    const shouldClose = sheetTranslateYRef.current > 90;
    sheetDragStartYRef.current = null;
    setIsSheetDragging(false);
    sheetTranslateYRef.current = 0;
    scheduleSheetTransform();
    if (shouldClose) setAddLiquidityFormOpen(false);
  }, [scheduleSheetTransform]);

  const { address: accountAddress, isConnected, chainId } = useAccount();
  const { networkMode } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);

  // Create a wrapper for convertTickToPrice that binds tokenDefinitions
  const boundConvertTickToPrice = useMemo(() =>
    (tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string) =>
      convertTickToPrice(tick, currentPoolTick, currentPrice, baseTokenForPriceDisplay, token0Symbol, token1Symbol, tokenDefinitions),
    [tokenDefinitions]
  );

  const { writeContract } = useWriteContract();
  const [collectHash, setCollectHash] = useState<`0x${string}` | undefined>(undefined);
  const [lastCollectPositionId, setLastCollectPositionId] = useState<string | null>(null);
  const { isSuccess: isCollectConfirmed } = useWaitForTransactionReceipt({ hash: collectHash });
  
  // Handle collect success
  useEffect(() => {
    if (isCollectConfirmed && collectHash && lastCollectPositionId) {
      toast.success("Fees Collected", {
        icon: <BadgeCheck className="h-4 w-4 text-green-500" />,
        action: {
          label: "View Transaction",
          onClick: () => window.open(getExplorerTxUrl(collectHash), '_blank')
        }
      });

      // Fees are auto-invalidated via invalidateAfterTx (no manual refresh needed)

      // Clear loading state
      setUserPositions(prev => prev.map(p =>
        p.positionId === lastCollectPositionId
          ? { ...p, isOptimisticallyUpdating: undefined }
          : p
      ));
    }
  }, [isCollectConfirmed, collectHash, lastCollectPositionId, queryClient]);
  // Guard to prevent duplicate toasts and unintended modal closes across re-renders
  const pendingActionRef = useRef<null | { type: 'increase' | 'decrease' | 'withdraw' | 'burn' | 'collect' | 'compound' }>(null);

  // Get base pool info first (synchronous, no loading needed)
  const basePoolInfo = getPoolConfiguration(poolId);

  // State for the pool's detailed data (initialized with base config for immediate render)
  const [currentPoolData, setCurrentPoolData] = useState<PoolDetailData | null>(() => {
    if (!basePoolInfo) return null;
    const poolConfig = getPoolById(poolId);
    return {
      ...basePoolInfo,
      highlighted: false,
      tickSpacing: poolConfig?.tickSpacing || DEFAULT_TICK_SPACING,
      dynamicFeeBps: undefined, // Will be loaded
    } as PoolDetailData;
  });

  const [apiChartData, setApiChartData] = useState<ChartDataPoint[]>([]);
  const [isLoadingChartData, setIsLoadingChartData] = useState(false);
  const [currentPoolTick, setCurrentPoolTick] = useState<number | null>(null);
  const [currentPrice, setCurrentPrice] = useState<string | null>(null);
  const apiPoolIdToUse = basePoolInfo?.subgraphId || '';
  const { data: poolState } = usePoolState(String(apiPoolIdToUse));

  useEffect(() => {
    if (poolState?.currentPrice && typeof poolState?.currentPoolTick === 'number') {
      setCurrentPrice(String(poolState.currentPrice));
      setCurrentPoolTick(Number(poolState.currentPoolTick));
    }
  }, [poolState]);

  const { data: allPrices } = useAllPrices();
  const isLoadingPrices = !allPrices;
  // Normalize prices that may come as numbers or objects with a `usd` field
  const extractUsd = (value: unknown, fallback: number): number => {
    if (typeof value === 'number') return value;
    if (value && typeof (value as any).usd === 'number') return (value as any).usd as number;
    return fallback;
  };

  const getUsdPriceForSymbol = useCallback((symbolRaw?: string): number => {
    const symbol = (symbolRaw || '').toUpperCase();
    if (!symbol) return 0;
    if (['USDC', 'AUSDC', 'USDT', 'AUSDT', 'MUSDT', 'YUSD', 'DAI', 'ADAI'].includes(symbol)) return extractUsd(allPrices?.USDC as any, 1);
    if (['ETH', 'AETH'].includes(symbol)) return extractUsd(allPrices?.ETH as any, 0);
    if (['BTC', 'ABTC'].includes(symbol)) return extractUsd(allPrices?.BTC as any, 0);
    return 0;
  }, [allPrices]);

  const calculatePositionUsd = useCallback((position: ProcessedPosition): number => {
    if (!position) return 0;
    const amt0 = parseFloat(position.token0.amount || '0');
    const amt1 = parseFloat(position.token1.amount || '0');
    const p0 = getUsdPriceForSymbol(position.token0.symbol);
    const p1 = getUsdPriceForSymbol(position.token1.symbol);
    return (amt0 * p0) + (amt1 * p1);
  }, [getUsdPriceForSymbol]);



  // Modal states
  const [showBurnConfirmDialog, setShowBurnConfirmDialog] = useState(false);
  const [positionToBurn, setPositionToBurn] = useState<ProcessedPosition | null>(null);
  const [showIncreaseModal, setShowIncreaseModal] = useState(false);
  const [showDecreaseModal, setShowDecreaseModal] = useState(false);
  const [positionToModify, setPositionToModify] = useState<ProcessedPosition | null>(null);
  const [addLiquidityOpen, setAddLiquidityOpen] = useState(false);
  const [addLiquidityFormOpen, setAddLiquidityFormOpen] = useState(false);

  // State for range info from the AddLiquidityForm (mirrors form's visual state)
  const [formRangeInfo, setFormRangeInfo] = useState<{
    preset: string | null;
    label: string;
    estimatedApy: string;
    hasUserInteracted: boolean;
    isCalculating: boolean;
  } | null>(null);

  // Collect all position IDs that need fee data (table positions + modal positions)
  const allPositionIds = React.useMemo(() => {
    const ids = new Set<string>();
    // Add positions from the table
    userPositions.forEach(pos => ids.add(pos.positionId));
    // Add modal positions (may be duplicates but Set handles that)
    if (positionToBurn?.positionId) ids.add(positionToBurn.positionId);
    if (positionToModify?.positionId) ids.add(positionToModify.positionId);

    const result = Array.from(ids).filter(Boolean);
    return result;
  }, [userPositions, positionToBurn?.positionId, positionToModify?.positionId]);

  // Batch fetch all uncollected fees (replaces 3 individual calls)
  const { data: batchFeesData } = useUncollectedFeesBatch(allPositionIds, 60_000);
  
  // State for optimistically cleared fees
  const [optimisticallyClearedFees, setOptimisticallyClearedFees] = useState<Set<string>>(new Set());

  // Extract individual fee data from batch result
  const getFeesForPosition = React.useCallback((positionId: string) => {
    if (!batchFeesData || !positionId) return null;
    
    // If this position has been optimistically cleared, return zero fees
    if (optimisticallyClearedFees.has(positionId)) {
      return {
        positionId,
        amount0: '0',
        amount1: '0',
        totalValueUSD: 0
      };
    }
    
    return batchFeesData.find(fee => fee.positionId === positionId) || null;
  }, [batchFeesData, optimisticallyClearedFees]);

  // Extract fees for specific use cases
  const feesForWithdraw = getFeesForPosition(positionToBurn?.positionId || '');
  const feesForIncrease = getFeesForPosition(positionToModify?.positionId || '');


  // Modal input states
  const [decreaseAmount0, setDecreaseAmount0] = useState<string>("");
  const [decreaseAmount1, setDecreaseAmount1] = useState<string>("");
  const [decreaseActiveInputSide, setDecreaseActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isDecreaseCalculating, setIsDecreaseCalculating] = useState(false);
  const [isFullBurn, setIsFullBurn] = useState(false);


  const isMobile = useIsMobile();

  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );




  // State for position details modal
  const [selectedPositionForDetails, setSelectedPositionForDetails] = useState<ProcessedPosition | null>(null);
  const [isPositionDetailsModalOpen, setIsPositionDetailsModalOpen] = useState(false);

  const refreshThrottleRef = useRef(0);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    if (typeof window !== 'undefined') {
      setWindowWidth(window.innerWidth);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

  // Capture pool activity initial height on mount only
  useEffect(() => {
    if (poolActivityRef.current && poolActivityHeight === null) {
      // Wait for layout to settle
      const timer = setTimeout(() => {
        if (poolActivityRef.current) {
          const height = poolActivityRef.current.offsetHeight;
          if (height > 0) {
            setPoolActivityHeight(height);
          }
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [poolActivityHeight]);

  const processChartDataForScreenSize = useCallback((data: ChartDataPoint[]) => {
    if (!data?.length) return [];
    const sortedData = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let daysBack = windowWidth < 1500 ? 30 : windowWidth < 1700 ? 45 : 60;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    const recentData = sortedData.filter(item => new Date(item.date) >= cutoffDate);
    if (!recentData.length) return sortedData;
    const filledData: ChartDataPoint[] = [];
    const startDate = new Date(recentData[0].date);
    const endDate = new Date(recentData[recentData.length - 1].date);
    let currentDate = new Date(startDate);
    let lastTvl = 0;
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const existingData = recentData.find(item => item.date === dateStr);
      if (existingData) {
        filledData.push(existingData);
        lastTvl = existingData.tvlUSD;
      } else {
        let dynamicFeeValue = 0;
        if (lastTvl > 0) {
          const lastDataPoint = filledData[filledData.length - 1];
          if (lastDataPoint?.dynamicFee > 0) dynamicFeeValue = lastDataPoint.dynamicFee;
        }
        filledData.push({ date: dateStr, volumeUSD: 0, tvlUSD: lastTvl, volumeTvlRatio: 0, emaRatio: 0, dynamicFee: dynamicFeeValue });
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Pad at the beginning if we don't have enough days to reach daysBack
    if (filledData.length > 0) {
      const dataSpanDays = filledData.length;
      if (dataSpanDays < daysBack) {
        const daysToAdd = daysBack - dataSpanDays;
        const oldestDate = new Date(filledData[0].date);
        const emptyDays: ChartDataPoint[] = [];
        
        for (let i = 1; i <= daysToAdd; i++) {
          const emptyDate = new Date(oldestDate);
          emptyDate.setDate(emptyDate.getDate() - i);
          emptyDays.unshift({
            date: emptyDate.toISOString().split('T')[0],
            volumeUSD: 0,
            tvlUSD: 0,
            volumeTvlRatio: 0,
            emaRatio: 0,
            dynamicFee: 0,
          });
        }
        
        return [...emptyDays, ...filledData];
      }
    }
    
    return filledData;
  }, [windowWidth]);



  // Fetch user positions for this pool and pool stats
  const fetchPageData = useCallback(async (force?: boolean, skipPositions?: boolean, keepLoading?: boolean) => {
    if (!poolId) return;
    const poolInfo = getPoolConfiguration(poolId);
    if (!poolInfo) return;

    // PARALLELIZED DATA LOADING: Positions + Chart + Pool Stats all run concurrently
    // Set loading states immediately
    if (!skipPositions && isConnected && accountAddress) {
      setIsLoadingPositions(true);
    } else if (!skipPositions) {
      setUserPositions([]);
      setIsLoadingPositions(false);
    }

    if (apiChartData.length === 0) {
      setIsLoadingChartData(true);
    }

    // Check for recent swap hint (force refresh if needed)
    let forceRefresh = force;
    try {
      const hintKey = `recentSwap:${String(poolId).toLowerCase()}`;
      const hint = SafeStorage.get(hintKey);
      if (hint) {
        forceRefresh = true;
        SafeStorage.remove(hintKey);
      }
    } catch {}

    // PARALLEL EXECUTION: Run positions, chart, and pool stats loading simultaneously
    ;(async () => {
      try {
        const basePoolInfoTmp = getPoolConfiguration(poolId);
        const subgraphIdForHist = basePoolInfoTmp?.subgraphId || '';
        if (!subgraphIdForHist) throw new Error('Missing subgraph id for pool');
        const targetDays = 60;

        const todayKeyLocal = new Date().toISOString().split('T')[0];

        // PARALLEL DATA FETCH: All 3 data sources load simultaneously
        const [chartResult, poolStatsResult, positionsResult] = await Promise.all([
          // 1. Chart data (TVL, Volume, Fees, Dynamic Fee Events)
          RetryUtility.fetchJson(
            `/api/liquidity/pool-chart-data?poolId=${encodeURIComponent(poolId)}&days=${targetDays}`,
            {
              attempts: 4,
              baseDelay: 700,
              validate: (j) => j?.success && Array.isArray(j?.data) && j.data.length > 0,
              throwOnFailure: true
            }
          ),

          // 2. Pool stats (from batch API)
          (async () => {
            try {
              const resp = await fetch(`/api/liquidity/get-pools-batch?network=${networkMode}`);

              if (resp.ok) {
                const data = await resp.json();
                const poolIdLc = String(subgraphIdForHist || '').toLowerCase();
                const match = Array.isArray(data?.pools) ? data.pools.find((p: any) => String(p.poolId || '').toLowerCase() === poolIdLc) : null;

                if (match) {
                  return {
                    tvlUSD: Number(match.tvlUSD) || 0,
                    volume24hUSD: Number(match.volume24hUSD) || 0,
                    fees24hUSD: Number(match.fees24hUSD) || 0,
                    apr: Number(match.apr) || 0,
                    dynamicFeeBps: typeof match.dynamicFeeBps === 'number' ? match.dynamicFeeBps : null,
                  };
                }
              }
              return null;
            } catch (error) {
              console.error('Error loading pool stats:', error);
              return null;
            }
          })(),

          // 3. User positions (if connected)
          (async () => {
            if (!skipPositions && isConnected && accountAddress && chainId) {
              try {
                const ids = await loadUserPositionIds(accountAddress);
                const timestamps = getCachedPositionTimestamps(accountAddress);
                const allUserPositions = await derivePositionsFromIds(accountAddress, ids, chainId, timestamps);
                const subgraphId = (poolInfo.subgraphId || '').toLowerCase();
                return allUserPositions.filter(pos => String(pos.poolId || '').toLowerCase() === subgraphId);
              } catch (error) {
                console.error("Failed to load user positions:", error);
                return [];
              }
            }
            return [];
          })()
        ]);

        // Process positions result
        if (!skipPositions) {
          setUserPositions(positionsResult || []);
          setIsLoadingPositions(false);
        }

        // Process chart data
        const chartData = chartResult.data!;
        const dayData = Array.isArray(chartData.data) ? chartData.data : [];
        const feeEvents = Array.isArray(chartData.feeEvents) ? chartData.feeEvents : [];

        // Build date-indexed maps for quick lookup
        const dataByDate = new Map<string, { tvlUSD: number; volumeUSD: number }>();
        for (const d of dayData) {
          dataByDate.set(d.date, { tvlUSD: d.tvlUSD || 0, volumeUSD: d.volumeUSD || 0 });
        }

        // Map fee events to per-day overlays
        const feeByDate = new Map<string, { ratio: number; ema: number; feePct: number }>();
        const evAsc = [...feeEvents].sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));

        const scaleRatio = (val: any): number => {
          const n = typeof val === 'string' ? Number(val) : (typeof val === 'number' ? val : 0);
          if (!Number.isFinite(n)) return 0;
          if (Math.abs(n) >= 1e12) return n / 1e18;
          if (Math.abs(n) >= 1e6) return n / 1e6;
          if (Math.abs(n) >= 1e4) return n / 1e4;
          return n;
        };

        // Get all dates (from data + today)
        const allDates = Array.from(new Set([
          ...dayData.map(d => d.date),
          todayKeyLocal
        ])).sort((a, b) => a.localeCompare(b));

        // Process fee events for each date
        let ei = 0, curFeePct = 0, curRatio = 0, curEma = 0;
        for (const dateStr of allDates) {
          const endTs = Math.floor(new Date(`${dateStr}T23:59:59Z`).getTime() / 1000);
          while (ei < evAsc.length && Number(evAsc[ei]?.timestamp || 0) <= endTs) {
            const e = evAsc[ei];
            const bps = Number(e?.newFeeBps ?? 0);
            // newFeeBps value needs to be divided by 10000 to get percentage
            curFeePct = Number.isFinite(bps) ? (bps / 10000) : curFeePct;
            curRatio = scaleRatio(e?.currentRatio);    // Vol/TVL activity (volatile)
            curEma = scaleRatio(e?.newTargetRatio);    // EMA target (smooth)
            ei++;
          }
          feeByDate.set(dateStr, { ratio: curRatio, ema: curEma, feePct: curFeePct });
        }

        // Build final merged chart data
        const merged: ChartDataPoint[] = allDates.map((dateStr) => {
          const dayInfo = dataByDate.get(dateStr);
          const feeInfo = feeByDate.get(dateStr);

          return {
            date: dateStr,
            volumeUSD: dayInfo?.volumeUSD || 0,
            tvlUSD: dayInfo?.tvlUSD || 0,
            volumeTvlRatio: feeInfo?.ratio ?? 0,
            emaRatio: feeInfo?.ema ?? 0,
            dynamicFee: feeInfo?.feePct ?? 0,
          } as ChartDataPoint;
        });

        // Update today's TVL with pool stats if available
        const tvlFromPoolStats = poolStatsResult?.tvlUSD || 0;
        const finalMerged = merged.map(d =>
          d.date === todayKeyLocal && Number.isFinite(tvlFromPoolStats) && tvlFromPoolStats > 0
            ? { ...d, tvlUSD: tvlFromPoolStats }
            : d
        );

        setApiChartData(finalMerged);

        // Process pool stats and update pool data
        if (poolStatsResult) {
          const vol24h = poolStatsResult.volume24hUSD || 0;
          const fees24h = poolStatsResult.fees24hUSD || 0;
          const tvlNow = poolStatsResult.tvlUSD || 0;
          const dynamicFeeBps = poolStatsResult.dynamicFeeBps ?? null;

          // Format APR helper function
          const formatAPR = (aprValue: number) => {
            if (!isFinite(aprValue)) return '0.00%';
            if (aprValue < 1000) return `${aprValue.toFixed(2)}%`;
            return `${(aprValue / 1000).toFixed(2)}K%`;
          };

          const calculatedApr = typeof poolStatsResult.apr === 'number' && poolStatsResult.apr > 0
            ? formatAPR(poolStatsResult.apr)
            : '0.00%';

          const combinedPoolData = {
            ...poolInfo,
            ...poolStatsResult,
            apr: calculatedApr,
            dynamicFeeBps: dynamicFeeBps,
            tickSpacing: getPoolById(poolId)?.tickSpacing || DEFAULT_TICK_SPACING,
            volume24h: isFinite(vol24h) ? formatUSD(vol24h) : poolInfo.volume24h,
            fees24h: isFinite(fees24h) ? formatUSD(fees24h) : poolInfo.fees24h,
            liquidity: isFinite(tvlNow) ? formatUSD(tvlNow) : poolInfo.liquidity,
            highlighted: false,
          };

          setCurrentPoolData(combinedPoolData);
        }

        if (!keepLoading) setIsLoadingChartData(false);
      } catch (error: any) {
        console.error('Failed to fetch chart data:', error);
        const errorMessage = error?.message || String(error);
        toast.error('Chart Data Failed', {
          icon: <OctagonX className="h-4 w-4 text-red-500" />,
          description: errorMessage,
          action: {
            label: "Copy Error",
            onClick: () => navigator.clipboard.writeText(errorMessage)
          }
        });
        if (!keepLoading) setIsLoadingChartData(false);
      }
    })();
  }, [poolId, isConnected, accountAddress, router]);

  const refreshAfterLiquidityAddedWithSkeleton = useCallback(async (token0Symbol?: string, token1Symbol?: string, txInfo?: { txHash?: `0x${string}`; blockNumber?: bigint; tvlDelta?: number; volumeDelta?: number }) => {
    const now = Date.now();
    const timeSinceLastCall = now - refreshThrottleRef.current;
    if (refreshThrottleRef.current && timeSinceLastCall < 2000) return;
    refreshThrottleRef.current = now;

    // Optimistic UI updates for TVL and volume
    if (txInfo?.tvlDelta && currentPoolData?.liquidity) {
      const currentTvl = parseFloat(String(currentPoolData.liquidity).replace(/[$,]/g, ''));
      if (Number.isFinite(currentTvl)) {
        const optimisticTvl = Math.max(0, currentTvl + txInfo.tvlDelta);
        setCurrentPoolData(prev => prev ? { ...prev, liquidity: formatUSD(optimisticTvl) } : prev);
      }
    }
    if (txInfo?.volumeDelta && currentPoolData?.volume24h) {
      const currentVol = parseFloat(String(currentPoolData.volume24h).replace(/[$,]/g, ''));
      if (Number.isFinite(currentVol)) {
        const optimisticVol = Math.max(0, currentVol + txInfo.volumeDelta);
        setCurrentPoolData(prev => prev ? { ...prev, volume24h: formatUSD(optimisticVol) } : prev);
      }
    }

    if (accountAddress && poolId && chainId) {
      setIsDerivingNewPosition(true);
      try {
        const ids = await loadUserPositionIds(accountAddress);
        const timestamps = getCachedPositionTimestamps(accountAddress);
        const allDerived = await derivePositionsFromIds(accountAddress, ids, chainId, timestamps);
        const subId = (getPoolConfiguration(poolId)?.subgraphId || '').toLowerCase();
        const filtered = allDerived.filter((pos: any) => String(pos.poolId || '').toLowerCase() === subId);

        setUserPositions(prev => {
          const existingIds = new Set(prev.map(p => p.positionId));
          const newPositions = filtered.filter(p => !existingIds.has(p.positionId));
          const updated = prev.map(p => {
            const fresh = filtered.find(f => f.positionId === p.positionId);
            return fresh ? { ...fresh, isOptimisticallyUpdating: undefined } : p;
          });
          return [...newPositions, ...updated];
        });

        invalidateAfterTx(queryClient, {
          owner: accountAddress,
          chainId,
          poolId,
          reason: 'liquidity-added',
          awaitSubgraphSync: false,
          optimisticUpdates: { tvlDelta: txInfo?.tvlDelta, volumeDelta: txInfo?.volumeDelta },
        }).catch(() => {});

        silentRefreshTVL().catch(() => {});
      } catch (error) {
        console.error('[refreshAfterLiquidityAdded] Failed:', error);
      } finally {
        setIsDerivingNewPosition(false);
      }
    }
  }, [accountAddress, poolId, chainId, queryClient, currentPoolData]);

  const silentRefreshTVL = useCallback(async () => {
    if (!poolId) return;
    const poolInfo = getPoolConfiguration(poolId);
    if (!poolInfo?.subgraphId) return;
    try {
      const resp = await fetch(`/api/liquidity/get-pools-batch?network=${networkMode}&v=${Date.now()}`);
      if (resp.ok) {
        const data = await resp.json();
        const poolIdLc = String(poolInfo.subgraphId).toLowerCase();
        const match = Array.isArray(data?.pools) ? data.pools.find((p: any) => String(p.poolId || '').toLowerCase() === poolIdLc) : null;
        if (match) {
          const tvlUSD = Number(match.tvlUSD) || 0;
          if (Number.isFinite(tvlUSD)) {
            setCurrentPoolData(prev => prev ? { ...prev, liquidity: formatUSD(tvlUSD) } : prev);
            const todayKey = new Date().toISOString().split('T')[0];
            setApiChartData(prev => {
              if (!prev || prev.length === 0) return prev;
              const todayIndex = prev.findIndex(d => d.date === todayKey);
              if (todayIndex !== -1 && Math.abs(prev[todayIndex].tvlUSD - tvlUSD) > 0.01) {
                const updated = [...prev];
                updated[todayIndex] = { ...updated[todayIndex], tvlUSD };
                return updated;
              }
              return prev;
            });
          }
        }
      }
    } catch (error) { console.error('[silentRefreshTVL] Failed:', error); }
  }, [poolId, networkMode]);

  const refreshAfterMutation = useCallback(async (info?: { txHash?: `0x${string}`; blockNumber?: bigint; tvlDelta?: number }) => {
    if (!poolId || !isConnected || !accountAddress || !chainId) return;

    await invalidateAfterTx(queryClient, {
      owner: accountAddress,
      chainId,
      poolId,
      reason: 'liquidity-withdrawn',
      awaitSubgraphSync: true,
      blockNumber: info?.blockNumber,
      reloadPositions: true,
      refreshPoolData: silentRefreshTVL, // Changed to silent refresh
      onPositionsReloaded: (allDerived) => {
        const subId = (getPoolConfiguration(poolId)?.subgraphId || '').toLowerCase();
        const filtered = allDerived.filter((pos: any) => String(pos.poolId || '').toLowerCase() === subId);
        // Merge positions: update existing, add new, remove burned
        setUserPositions(prev => {
          const freshIds = new Set(filtered.map(p => p.positionId));
          const existingIds = new Set(prev.map(p => p.positionId));

          // Update existing positions that still exist (removes burned positions)
          const updated = prev
            .filter(p => freshIds.has(p.positionId)) // Remove burned positions
            .map(p => {
              const fresh = filtered.find(f => f.positionId === p.positionId);
              return fresh ? { ...fresh, isOptimisticallyUpdating: undefined } : p;
            });

          // Add new positions
          const newPositions = filtered.filter(p => !existingIds.has(p.positionId));

          // Put new positions at the beginning so they appear at the top
          return [...newPositions, ...updated];
        });
      },
      clearOptimisticStates: () => {
        setUserPositions(prev => prev.map(p => ({ ...p, isOptimisticallyUpdating: undefined })));
        setOptimisticallyClearedFees(new Set());
      }
    });
  }, [poolId, isConnected, accountAddress, silentRefreshTVL, queryClient]);

  // Refresh for position increases
  const refreshAfterIncrease = useCallback(async (info?: { txHash?: `0x${string}`; blockNumber?: bigint }) => {
    if (!poolId || !isConnected || !accountAddress || !chainId) return;

    await invalidateAfterTx(queryClient, {
      owner: accountAddress,
      chainId,
      poolId,
      reason: 'liquidity-added',
      awaitSubgraphSync: true,
      blockNumber: info?.blockNumber,
      reloadPositions: true,
      refreshPoolData: async () => {
        await fetchPageData(true, false);
      },
      onPositionsReloaded: (allDerived) => {
        const subId = poolId.toLowerCase();
        const filtered = allDerived.filter((pos: any) => {
          const posPoolId = String(pos.poolId || '').toLowerCase();
          return posPoolId === subId;
        });
        if (filtered.length > 0) {
          setUserPositions(filtered);
        }
      },
      clearOptimisticStates: () => {
        setUserPositions(prev => prev.map(p => ({ ...p, isOptimisticallyUpdating: undefined })));
        setOptimisticallyClearedFees(new Set());
      }
    });
  }, [poolId, isConnected, accountAddress, fetchPageData, queryClient]);

  const handledIncreaseHashRef = useRef<string | null>(null);
  const onLiquidityIncreasedCallback = useCallback((info?: { txHash?: `0x${string}`; blockNumber?: bigint, increaseAmounts?: { amount0: string; amount1: string } }) => {
    // Require valid hash to proceed and prevent duplicates
    if (!info?.txHash) {
      return;
    }
    if (handledIncreaseHashRef.current === info.txHash) {
      return;
    }
    handledIncreaseHashRef.current = info.txHash;

    if (pendingActionRef.current?.type !== 'increase') {
      return;
    }

    // IMMEDIATE OPTIMISTIC UPDATES (happen with toast) - positions only, not TVL
    if (positionToModify) {
      if (info?.increaseAmounts) {
        // If we have the exact amounts, update optimistically with real values
        const currentAmount0 = parseFloat(positionToModify.token0.amount || '0');
        const currentAmount1 = parseFloat(positionToModify.token1.amount || '0');
        const addedAmount0 = parseFloat(info.increaseAmounts.amount0 || '0');
        const addedAmount1 = parseFloat(info.increaseAmounts.amount1 || '0');
        
        setUserPositions(prev => prev.map(p => 
          p.positionId === positionToModify.positionId 
            ? { 
                ...p, 
                token0: { ...p.token0, amount: (currentAmount0 + addedAmount0).toString() },
                token1: { ...p.token1, amount: (currentAmount1 + addedAmount1).toString() },
                isOptimisticallyUpdating: true,
                // Optimistically clear fees after increase (they get compounded)
                fees: {
                  amount0: '0',
                  amount1: '0',
                  totalValueUSD: 0
                }
              } 
            : p
        ));
      } else {
        // Fallback to just showing loading state and clear fees optimistically
        setUserPositions(prev => prev.map(p => 
          p.positionId === positionToModify.positionId 
            ? { 
                ...p, 
                isOptimisticallyUpdating: true,
                // Optimistically clear fees after increase
                fees: {
                  amount0: '0',
                  amount1: '0',
                  totalValueUSD: 0
                }
              } 
            : p
        ));
      }
      
      // Also add to optimistically cleared fees set
      setOptimisticallyClearedFees(prev => new Set(prev).add(positionToModify.positionId));
    }

    // Show toast immediately but let Success View handle modal closure
    // Toast is shown by useIncreaseLiquidity hook already - don't duplicate
    // IMMEDIATE refetch for increases - fees are critical and must be fresh
    refreshAfterIncrease(info);
    pendingActionRef.current = null; // Moved here to ensure it's cleared AFTER refresh logic
  }, [refreshAfterIncrease, positionToModify]);

  const handledDecreaseHashRef = useRef<string | null>(null);
  const onLiquidityDecreasedCallback = useCallback((info?: { txHash?: `0x${string}`; blockNumber?: bigint; isFullBurn?: boolean }) => {
    // Require a valid tx hash and dedupe by hash to support rapid successive burns
    if (!info?.txHash) {
      return;
    }
    if (handledDecreaseHashRef.current === info.txHash) {
      return;
    }
    handledDecreaseHashRef.current = info.txHash;

    // Support both old modal (positionToBurn) and new modal (selectedPositionForDetails)
    const targetPosition = positionToBurn || selectedPositionForDetails;

    // Skip if this isn't a withdraw/decrease action and we don't have a position to update
    const isPendingAction = pendingActionRef.current?.type === 'decrease' || pendingActionRef.current?.type === 'withdraw';
    if (!isPendingAction && !targetPosition) {
      return;
    }

    const closing = info?.isFullBurn ?? isFullBurn;

    // IMMEDIATE OPTIMISTIC UPDATES (happen with toast)
    if (targetPosition) {
      if (closing) {
        // Full burn: remove from UI and cache
        setUserPositions(prev => prev.filter(p => p.positionId !== targetPosition.positionId));
        if (accountAddress) removePositionIdFromCache(accountAddress, targetPosition.positionId);
      } else {
        // Partial withdrawal: show loading state
        setUserPositions(prev => prev.map(p =>
          p.positionId === targetPosition.positionId
            ? {
                ...p,
                isOptimisticallyUpdating: true,
                fees: {
                  amount0: '0',
                  amount1: '0',
                  totalValueUSD: 0
                }
              }
            : p
        ));

        setOptimisticallyClearedFees(prev => new Set(prev).add(targetPosition.positionId));
      }
    }

    pendingActionRef.current = null;

    refreshAfterMutation(info);
  }, [isFullBurn, refreshAfterMutation, positionToBurn, selectedPositionForDetails, calculatePositionUsd, currentPoolData]);

  // Initialize the liquidity modification hooks (moved here after callback definitions)
  const { increaseLiquidity, isLoading: isIncreasingLiquidity, isSuccess: isIncreaseSuccess, hash: increaseTxHash, reset: resetIncreaseLiquidity } = useIncreaseLiquidity({
    onLiquidityIncreased: onLiquidityIncreasedCallback,
  });


  const { decreaseLiquidity, isLoading: isDecreasingLiquidity, isSuccess: isDecreaseSuccess, hash: decreaseTxHash, reset: resetDecreaseLiquidity } = useDecreaseLiquidity({
    onLiquidityDecreased: onLiquidityDecreasedCallback,
    onFeesCollected: (info) => {
      toast.success("Fees Collected", {
        icon: <BadgeCheck className="h-4 w-4 text-green-500" />,
        description: 'Fees successfully collected',
        action: info?.txHash ? {
          label: "View Transaction",
          onClick: () => window.open(getExplorerTxUrl(info.txHash!), '_blank')
        } : undefined
      });
    },
  });

  useEffect(() => {
    if (showBurnConfirmDialog) {
      resetDecreaseLiquidity();
    }
  }, [showBurnConfirmDialog, resetDecreaseLiquidity]);

  useEffect(() => {
    if (showIncreaseModal) {
      resetIncreaseLiquidity();
    }
  }, [showIncreaseModal, resetIncreaseLiquidity]);

  // Optimized: Single call per pool load (chart data only - positions handled separately)
  useEffect(() => {
    // Only fetch if we have poolId and no chart data yet
    if (poolId && apiChartData.length === 0) {
      fetchPageData(false, true); // skipPositions=true - positions loaded in separate effect
    }
  }, [poolId]); // Only depend on poolId to avoid excessive calls

  // Separate effect for position loading - triggers when wallet connects
  // This fixes the issue where positions don't load on page reload (wallet not ready yet)
  useEffect(() => {
    if (!poolId || !isConnected || !accountAddress || !chainId) {
      if (!isConnected) {
        setUserPositions([]);
        setIsLoadingPositions(false);
      }
      return;
    }

    const poolInfo = getPoolConfiguration(poolId);
    if (!poolInfo) return;

    const subgraphId = (poolInfo.subgraphId || '').toLowerCase();

    (async () => {
      setIsLoadingPositions(true);
      try {
        const ids = await loadUserPositionIds(accountAddress, {
          onRefreshed: async (freshIds) => {
            // Background refresh completed - update if positions changed
            const timestamps = getCachedPositionTimestamps(accountAddress);
            const allPositions = await derivePositionsFromIds(accountAddress, freshIds, chainId, timestamps);
            const filtered = allPositions.filter(pos => String(pos.poolId || '').toLowerCase() === subgraphId);
            setUserPositions(filtered);
          }
        });
        const timestamps = getCachedPositionTimestamps(accountAddress);
        const allPositions = await derivePositionsFromIds(accountAddress, ids, chainId, timestamps);
        const filtered = allPositions.filter(pos => String(pos.poolId || '').toLowerCase() === subgraphId);
        setUserPositions(filtered);
      } catch (error) {
        console.error('[Pool Detail] Failed to load positions:', error);
        setUserPositions([]);
      } finally {
        setIsLoadingPositions(false);
      }
    })();
  }, [poolId, isConnected, accountAddress, chainId]);

  // Syncs the chart's latest TVL with the header's TVL in real-time
  useEffect(() => {
    if (!currentPoolData?.liquidity || apiChartData.length === 0) return;

    // Extract numeric TVL from the formatted string (e.g., "$1,234.56")
    const latestTvl = parseFloat(String(currentPoolData.liquidity).replace(/[$,]/g, ''));

    if (!Number.isFinite(latestTvl)) return;

    const todayKeyLocal = new Date().toISOString().split('T')[0];

    setApiChartData(prevChartData => {
      if (!prevChartData || prevChartData.length === 0) return prevChartData;

      const todayIndex = prevChartData.findIndex(d => d.date === todayKeyLocal);

      if (todayIndex !== -1) {
        const currentChartTvl = prevChartData[todayIndex].tvlUSD;
        
        // Only update if the TVL value is different to prevent infinite loops
        if (Math.abs(currentChartTvl - latestTvl) > 0.01) { // Epsilon for float comparison
          const newChartData = [...prevChartData];
          newChartData[todayIndex] = {
            ...newChartData[todayIndex],
            tvlUSD: latestTvl,
          };
          return newChartData;
        }
      }
      return prevChartData;
    });
  }, [currentPoolData]);

  // Helper function for debounced calculations (simplified version)
  const debounce = (func: Function, waitFor: number) => {
    let timeout: ReturnType<typeof setTimeout>;
    return (...args: any[]) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), waitFor);
    };
  };

  // Sanitize numeric decimal inputs to avoid letters or multiple dots
  const sanitizeDecimalInput = (input: string) => {
    if (!input) return '';
    const cleaned = input.replace(/[^0-9.]/g, '');
    const firstDot = cleaned.indexOf('.');
    if (firstDot === -1) return cleaned;
    // keep first dot, remove subsequent dots
    const head = cleaned.slice(0, firstDot + 1);
    const tail = cleaned.slice(firstDot + 1).replace(/\./g, '');
    return head + tail;
  };


  // Calculate corresponding amount for decrease
  const calculateDecreaseAmount = useCallback(
    debounce(async (inputAmount: string, inputSide: 'amount0' | 'amount1') => {
      if (!positionToModify || !inputAmount || parseFloat(inputAmount) <= 0) {
        if (inputSide === 'amount0') setDecreaseAmount1("");
        else setDecreaseAmount0("");
        return;
      }

      setIsDecreaseCalculating(true);
      try {
        // For out-of-range positions, allow single-token withdrawal
        if (!positionToModify.isInRange) {
          const maxAmount0 = parseFloat(positionToModify.token0.amount);
          const maxAmount1 = parseFloat(positionToModify.token1.amount);
          const inputAmountNum = parseFloat(inputAmount);
          
          // For out-of-range positions, allow withdrawing just the token the user inputs
          if (inputSide === 'amount0') {
            setDecreaseAmount1("0");
            // Check if this is effectively a full burn (withdrawing most/all of token0)
            const isNearFullBurn = inputAmountNum >= maxAmount0 * 0.99;
            if (isNearFullBurn) {
              // If withdrawing almost all of token0, also withdraw all of token1
              setDecreaseAmount1(formatTokenDisplayAmount(maxAmount1.toString()));
            }
            setIsFullBurn(isNearFullBurn);
          } else {
            setDecreaseAmount0("0");
            // Check if this is effectively a full burn (withdrawing most/all of token1)
            const isNearFullBurn = inputAmountNum >= maxAmount1 * 0.99;
            if (isNearFullBurn) {
              // If withdrawing almost all of token1, also withdraw all of token0
              setDecreaseAmount0(formatTokenDisplayAmount(maxAmount0.toString()));
            }
            setIsFullBurn(isNearFullBurn);
          }
          
          setIsDecreaseCalculating(false);
          return;
        }

        // In-range: skip server calc; percentage-based remove will be applied at submit.

        // Check if this is effectively a full burn
        const maxAmount0 = parseFloat(positionToModify.token0.amount);
        const maxAmount1 = parseFloat(positionToModify.token1.amount);
        const inputAmount0 = inputSide === 'amount0' ? parseFloat(inputAmount) : parseFloat(decreaseAmount0);
        const inputAmount1 = inputSide === 'amount1' ? parseFloat(inputAmount) : parseFloat(decreaseAmount1);
        
        const isNearFullBurn = (inputAmount0 >= maxAmount0 * 0.99) || (inputAmount1 >= maxAmount1 * 0.99);
        setIsFullBurn(isNearFullBurn);
      } catch (error: any) {
        console.error("Error calculating decrease amount:", error);
        const errorMessage = error.message || "Could not calculate corresponding amount.";
        toast.error("Calculation Error", { 
          icon: <OctagonX className="h-4 w-4 text-red-500" />, 
          description: errorMessage,
          action: {
            label: "Copy Error",
            onClick: () => navigator.clipboard.writeText(errorMessage)
          }
        });
        if (inputSide === 'amount0') setDecreaseAmount1("");
        else setDecreaseAmount0("");
      } finally {
        setIsDecreaseCalculating(false);
      }
    }, 500),
    [positionToModify, chainId, decreaseAmount0, decreaseAmount1]
  );


  // Handle max button clicks for decrease
  const handleMaxDecrease = (tokenSide: 'amount0' | 'amount1') => {
    if (!positionToModify) return;
    
    if (tokenSide === 'amount0') {
      setDecreaseAmount0(positionToModify.token0.amount);
      setDecreaseAmount1(positionToModify.token1.amount);
    } else {
      setDecreaseAmount1(positionToModify.token1.amount);
      setDecreaseAmount0(positionToModify.token0.amount);
    }
    setDecreaseActiveInputSide(tokenSide);
    setIsFullBurn(true);
  };








  // Handle decrease transaction
  const handleConfirmDecrease = () => {
    if (!positionToModify || (!decreaseAmount0 && !decreaseAmount1)) {
      toast.error("Invalid Amount", { 
        icon: <OctagonX className="h-4 w-4 text-red-500" />, 
        description: "Please enter an amount to remove.",
        duration: 4000
      });
      return;
    }
    
    // For out-of-range positions, ensure at least one amount is greater than 0
    if (!positionToModify.isInRange) {
      const amount0Num = parseFloat(decreaseAmount0 || "0");
      const amount1Num = parseFloat(decreaseAmount1 || "0");
      if (amount0Num <= 0 && amount1Num <= 0) {
        toast.error("Invalid Amount", { 
          icon: <OctagonX className="h-4 w-4 text-red-500" />, 
          description: "Please enter an amount to remove.",
          duration: 4000
        });
        return;
      }
    }

    // Map position token addresses to correct token symbols from our configuration
    const getTokenSymbolByAddress = (address: string): TokenSymbol | null => {
      const normalizedAddress = address.toLowerCase();
      for (const [symbol, tokenConfig] of Object.entries(tokenDefinitions)) {
        if (tokenConfig.address.toLowerCase() === normalizedAddress) {
          return symbol as TokenSymbol;
        }
      }
      return null;
    };
    
    const token0Symbol = getTokenSymbolByAddress(positionToModify.token0.address);
    const token1Symbol = getTokenSymbolByAddress(positionToModify.token1.address);
    
    if (!token0Symbol || !token1Symbol) {
      toast.error("Configuration Error", { 
        icon: <OctagonX className="h-4 w-4 text-red-500" />, 
        description: "Token configuration is invalid.",
        action: {
          label: "Open Ticket",
          onClick: () => window.open('https://discord.com/invite/NTXRarFbTr', '_blank')
        }
      });
      return;
    }

    const decreaseData: DecreasePositionData = {
      tokenId: positionToModify.positionId,
      token0Symbol: token0Symbol,
      token1Symbol: token1Symbol,
      decreaseAmount0: decreaseAmount0 || "0",
      decreaseAmount1: decreaseAmount1 || "0",
      isFullBurn: isFullBurn,
      poolId: positionToModify.poolId,
      tickLower: positionToModify.tickLower,
      tickUpper: positionToModify.tickUpper,
    };

    // Use amounts mode (percent=0) for precise removal in all cases
    pendingActionRef.current = { type: 'decrease' };
    decreaseLiquidity(decreaseData, 0);
    setShowDecreaseModal(false);
  };


  // Early return only if pool config doesn't exist (invalid poolId)
  if (!currentPoolData) return (
    <div className="flex flex-1 justify-center items-center p-6">
      <Image
        src="/LogoIconWhite.svg"
        alt="Loading..."
        width={48}
        height={48}
        className="animate-pulse opacity-75"
      />
    </div>
  );

  

  return (
    <>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col p-3 sm:p-6 max-w-full overflow-hidden">

          
          {/* Main content area with two columns (row layout only at >=1500px) */}
          <div className="flex flex-col min-[1400px]:flex-row gap-6 min-w-0 max-w-full overflow-hidden">
            {/* Left Column: Header + Graph (flexible, takes remaining space) */}
            <div className="flex-1 min-w-0 flex flex-col space-y-3">
          {/* Header: Token info container + Stats in dotted container */}
          <div>
            {/* Mobile layout < 768px */}
            <div className="min-[900px]:hidden space-y-3 overflow-x-hidden mb-2">
                {/* Identification above for mobile */}
                <Link
                  href="/liquidity"
                  className="rounded-lg bg-muted/30 border border-sidebar-border/60 cursor-pointer block transition-[background-color,border-color,transform] duration-150 active:scale-[0.99] active:bg-muted/40 active:border-white/30"
                >
                  <div className="px-4 py-3 flex items-center w-full">
                    <div className="flex items-center gap-1 min-w-0">
                      <ChevronLeft className="h-4 w-4 text-muted-foreground mr-1 flex-shrink-0" />
                      <div className="relative w-16 h-8 mr-0.5">
                        <div className="absolute top-0 left-0 w-8 h-8 rounded-full overflow-hidden bg-background z-10">
                          <Image src={currentPoolData.tokens[0].icon} alt={currentPoolData.tokens[0].symbol} width={32} height={32} className="w-full h-full object-cover" />
                        </div>
                        <div className="absolute top-0 left-5 w-8 h-8">
                          <div className="absolute inset-0 rounded-full overflow-hidden bg-background z-30">
                            <Image src={currentPoolData.tokens[1].icon} alt={currentPoolData.tokens[1].symbol} width={32} height={32} className="w-full h-full object-cover" />
                          </div>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col min-w-0">
                          <span className="font-medium mb-0.5 truncate">{currentPoolData.pair}</span>
                          <div className="flex items-center gap-3">
                            {(getPoolById(poolId)?.type || currentPoolData?.type) && (
                              <span className="px-1.5 py-0.5 text-xs font-normal rounded-md border border-sidebar-border bg-button text-muted-foreground" style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
                                {getPoolById(poolId)?.type || (currentPoolData as any)?.type}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {(() => {
                                if (currentPoolData.dynamicFeeBps === undefined) return <span className="inline-block h-3 w-12 bg-muted/60 rounded animate-pulse" />;
                                const pct = (currentPoolData.dynamicFeeBps as number) / 100;
                                const formatted = pct < 0.1 ? pct.toFixed(3) : pct.toFixed(2);
                                return `${formatted}%`;
                              })()}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Link>
                {/* Dotted container grid 2x2 */}
                <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-2 md:p-4 mb-2 w-full">
                  <div className="grid grid-cols-2 gap-1.5 md:gap-3">
                    {/* Volume */}
                    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
                      <div className="px-3 md:px-4 h-7 md:h-9 flex items-center">
                        <h2 className="text-[10px] md:text-xs tracking-wider text-muted-foreground font-mono font-bold whitespace-nowrap">VOLUME (24H)</h2>
                      </div>
                      <div className="px-3 md:px-4 py-1">
                        <div className="h-6 md:h-7 flex items-center text-base md:text-lg font-medium">
                          {currentPoolData.volume24h === "Loading..." ? (
                            <span className="inline-block h-5 w-16 md:h-6 md:w-20 bg-muted/60 rounded animate-pulse" />
                          ) : (
                            currentPoolData.volume24h
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Fees */}
                    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
                      <div className="px-3 md:px-4 h-7 md:h-9 flex items-center">
                        <h2 className="text-[10px] md:text-xs tracking-wider text-muted-foreground font-mono font-bold whitespace-nowrap">FEES (24H)</h2>
                      </div>
                      <div className="px-3 md:px-4 py-1">
                        <div className="h-6 md:h-7 flex items-center text-base md:text-lg font-medium">
                          {currentPoolData.fees24h === "Loading..." ? (
                            <span className="inline-block h-5 w-16 md:h-6 md:w-20 bg-muted/60 rounded animate-pulse" />
                          ) : (
                            currentPoolData.fees24h
                          )}
                        </div>
                      </div>
                    </div>
                    {/* TVL */}
                    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
                      <div className="px-3 md:px-4 h-7 md:h-9 flex items-center">
                        <h2 className="text-[10px] md:text-xs tracking-wider text-muted-foreground font-mono font-bold whitespace-nowrap">TVL</h2>
                      </div>
                      <div className="px-3 md:px-4 py-1">
                        <div className="h-6 md:h-7 flex items-center text-base md:text-lg font-medium">
                          {currentPoolData.liquidity === "Loading..." ? (
                            <span className="inline-block h-5 w-16 md:h-6 md:w-20 bg-muted/60 rounded animate-pulse" />
                          ) : (
                            currentPoolData.liquidity
                          )}
                        </div>
                      </div>
                    </div>
                    {/* APY with Dynamic Range Badge */}
                    <UITooltipProvider delayDuration={0}>
                      <UITooltip>
                        <UITooltipTrigger asChild>
                          <div className={`rounded-lg bg-muted/30 cursor-default ${
                            formRangeInfo?.hasUserInteracted && formRangeInfo.estimatedApy !== "0.00" && formRangeInfo.estimatedApy !== "—"
                              ? 'border border-sidebar-primary'
                              : 'border border-sidebar-border/60'
                          }`}>
                            <div className="px-3 md:px-4 h-7 md:h-9 flex items-center justify-between">
                              <h2 className="text-[10px] md:text-xs tracking-wider text-muted-foreground font-mono font-bold whitespace-nowrap">APY</h2>
                              {formRangeInfo?.hasUserInteracted && formRangeInfo.estimatedApy !== "0.00" && formRangeInfo.estimatedApy !== "—" && formRangeInfo.label !== "Select Range" && (
                                <span className="inline-flex items-center px-1 py-0.5 rounded text-[8px] md:text-[10px] font-medium bg-sidebar-primary/20 text-sidebar-primary border border-sidebar-primary/40">
                                  {formRangeInfo.label}
                                </span>
                              )}
                            </div>
                            <div className="px-3 md:px-4 py-1">
                              <div className="h-6 md:h-7 flex items-center text-base md:text-lg font-medium">
                                {currentPoolData.apr === "Loading..." ? (
                                  <span className="inline-block h-5 w-16 md:h-6 md:w-20 bg-muted/60 rounded animate-pulse" />
                                ) : formRangeInfo?.isCalculating ? (
                                  <span className="inline-block h-5 w-16 md:h-6 md:w-20 bg-muted/60 rounded animate-pulse" />
                                ) : formRangeInfo?.hasUserInteracted && formRangeInfo.estimatedApy !== "0.00" && formRangeInfo.estimatedApy !== "—" ? (
                                  `${formRangeInfo.estimatedApy}%`
                                ) : (
                                  currentPoolData.apr
                                )}
                              </div>
                            </div>
                          </div>
                        </UITooltipTrigger>
                        <UITooltipContent side="bottom" sideOffset={6} className="px-2 py-1 text-xs max-w-[240px]">
                          <div className="font-medium text-foreground">
                            Average over last 7 days
                          </div>
                        </UITooltipContent>
                      </UITooltip>
                    </UITooltipProvider>
                  </div>
                </div>
              </div>
            {/* Desktop layout >= 900px - zoom down below 1700px viewport */}
            <div className="hidden min-[900px]:block min-[1700px]:[zoom:1] max-[1699px]:[zoom:0.92]">
                  <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-4 mb-3 w-full">
                    <div className="flex items-stretch gap-3">
                      {/* Back arrow square */}
                      <Link
                        href="/liquidity"
                        className="flex-shrink-0 rounded-lg bg-muted/30 border border-sidebar-border/60 hover:border-white/30 transition-colors cursor-pointer flex items-center justify-center"
                        style={{ width: '74px', height: '74px', minWidth: '74px', minHeight: '74px' }}
                      >
                        <ChevronLeft className="h-5 w-5 text-muted-foreground" />
                      </Link>

                      {/* Token info container - FIXED width below 2075px, flexible above */}
                      <div className="w-[280px] min-w-[280px] flex-shrink-0 min-[2075px]:flex-1 overflow-hidden rounded-lg bg-muted/30 border border-sidebar-border/60">
                        <div className="px-4 py-3 flex items-center w-full min-w-0">
                          <div className="flex items-center gap-1 min-w-0 flex-1">
                            <div className="relative w-16 h-8 mr-0.5 flex-shrink-0">
                          <div className="absolute top-0 left-0 w-8 h-8 rounded-full overflow-hidden bg-background z-10">
                            <Image src={currentPoolData.tokens[0].icon} alt={currentPoolData.tokens[0].symbol} width={32} height={32} className="w-full h-full object-cover" />
                          </div>
                          <div className="absolute top-0 left-5 w-8 h-8">
                            <div className="absolute inset-0 rounded-full overflow-hidden bg-background z-30">
                              <Image src={currentPoolData.tokens[1].icon} alt={currentPoolData.tokens[1].symbol} width={32} height={32} className="w-full h-full object-cover" />
                            </div>
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-col min-w-0">
                            <span className="font-medium mb-0.5 truncate">{currentPoolData.pair}</span>
                                <div className="flex items-center gap-2 min-w-0">
                              {(getPoolById(poolId)?.type || currentPoolData?.type) && (
                                <UITooltipProvider delayDuration={0}>
                                  <UITooltip>
                                    <UITooltipTrigger asChild>
                                      <span className="px-1.5 py-0.5 text-xs font-normal rounded-md border border-sidebar-border bg-button text-muted-foreground flex-shrink-0 cursor-default" style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
                                        {getPoolById(poolId)?.type || (currentPoolData as any)?.type}
                                      </span>
                                    </UITooltipTrigger>
                                    <UITooltipContent side="bottom" sideOffset={6} className="px-2 py-1 text-xs">
                                      <div className="font-medium text-foreground">Pool Type</div>
                                    </UITooltipContent>
                                  </UITooltip>
                                </UITooltipProvider>
                              )}

                              {/* Divider */}
                              <div className="h-3 w-px bg-border flex-shrink-0" />

                              {/* Dynamic Fee indicator with percentage */}
                              <UITooltipProvider delayDuration={0}>
                                <UITooltip>
                                  <UITooltipTrigger asChild>
                                    <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => setIsDynamicFeeModalOpen(true)}>
                                      <div
                                        className="flex-shrink-0 rounded-md bg-sidebar-primary/10 border border-sidebar-border flex items-center justify-center hover:bg-sidebar-primary/20 transition-colors"
                                        style={{ width: '20px', height: '20px', minWidth: '20px', minHeight: '20px' }}
                                      >
                                        <Image src="/Dynamic Fee.svg" alt="Dynamic Fee" width={12} height={12} />
                                      </div>
                                      <span className="text-xs text-muted-foreground flex-shrink-0">
                                        {(() => {
                                          if (currentPoolData.dynamicFeeBps === undefined) return <span className="inline-block h-3 w-12 bg-muted/60 rounded animate-pulse" />;
                                          const pct = (currentPoolData.dynamicFeeBps as number) / 100;
                                          const formatted = pct < 0.1 ? pct.toFixed(3) : pct.toFixed(2);
                                          return `${formatted}%`;
                                        })()}
                                      </span>
                                    </div>
                                  </UITooltipTrigger>
                                  <UITooltipContent side="bottom" sideOffset={6} className="px-2 py-1 text-xs">
                                    <div className="font-medium text-foreground">Dynamic Fee</div>
                                  </UITooltipContent>
                                </UITooltip>
                              </UITooltipProvider>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Vertical divider */}
                      <div className="w-0 border-l border-dashed border-sidebar-border/60 self-stretch mx-1 flex-shrink-0" />

                  {/* Volume - Show at: 1100-1399px (no form) OR >= 1550px (form + wide screen) */}
                  <div
                    className="flex-1 min-w-[100px] max-w-[200px] rounded-lg bg-muted/30 border border-sidebar-border/60 hover:border-white/30 transition-colors cursor-pointer hidden min-[1100px]:max-[1399px]:flex min-[1550px]:flex flex-col"
                    onClick={() => setActiveChart('volume')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveChart('volume'); } }}
                  >
                    <div className="flex items-center justify-between px-3 h-9">
                      <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">VOLUME (24H)</h2>
                    </div>
                    <div className="px-3 py-1">
                      <div className="text-lg font-medium truncate">
                        {currentPoolData.volume24h === "Loading..." ? (
                          <span className="inline-block h-5 w-20 bg-muted/60 rounded animate-pulse" />
                        ) : (
                          currentPoolData.volume24h
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Fees - Show at: 1300-1399px (no form) OR >= 1850px (form + wide screen) */}
                  <div className="flex-1 min-w-[100px] max-w-[200px] rounded-lg bg-muted/30 border border-sidebar-border/60 hidden min-[1300px]:max-[1399px]:flex min-[1850px]:flex flex-col">
                    <div className="flex items-center justify-between px-3 h-9">
                      <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">FEES (24H)</h2>
                    </div>
                    <div className="px-3 py-1">
                      <div className="text-lg font-medium truncate">
                        {currentPoolData.fees24h === "Loading..." ? (
                          <span className="inline-block h-5 w-20 bg-muted/60 rounded animate-pulse" />
                        ) : (
                          currentPoolData.fees24h
                        )}
                      </div>
                    </div>
                  </div>

                  {/* TVL - Show at: >= 900px (always visible on desktop) */}
                  <div
                    className="flex-1 min-w-[100px] max-w-[200px] rounded-lg bg-muted/30 border border-sidebar-border/60 hover:border-white/30 transition-colors cursor-pointer flex flex-col"
                    onClick={() => setActiveChart('tvl')}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveChart('tvl'); } }}
                  >
                    <div className="flex items-center justify-between px-3 h-9">
                      <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">TVL</h2>
                    </div>
                    <div className="px-3 py-1">
                      <div className="text-lg font-medium truncate">
                        {currentPoolData.liquidity === "Loading..." ? (
                          <span className="inline-block h-5 w-20 bg-muted/60 rounded animate-pulse" />
                        ) : (
                          currentPoolData.liquidity
                        )}
                      </div>
                    </div>
                  </div>

                      {/* APY (always) - fixed width with Dynamic Range Badge */}
                      <UITooltipProvider delayDuration={0}>
                        <UITooltip>
                          <UITooltipTrigger asChild>
                            <div className={`flex-1 min-w-[100px] max-w-[200px] rounded-lg bg-muted/30 cursor-default flex flex-col ${
                              formRangeInfo?.hasUserInteracted && formRangeInfo.estimatedApy !== "0.00" && formRangeInfo.estimatedApy !== "—"
                                ? 'border-2 border-sidebar-primary'
                                : 'border border-sidebar-border/60'
                            }`}>
                              <div className="flex items-center justify-between px-3 h-9">
                                <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">APY</h2>
                                {formRangeInfo?.hasUserInteracted && formRangeInfo.estimatedApy !== "0.00" && formRangeInfo.estimatedApy !== "—" && formRangeInfo.label !== "Select Range" && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-sidebar-primary/20 text-sidebar-primary border border-sidebar-primary/40">
                                    {formRangeInfo.label}
                                  </span>
                                )}
                              </div>
                              <div className="px-3 py-1">
                                <div className="text-lg font-medium truncate">
                                  {currentPoolData.apr === "Loading..." ? (
                                    <span className="inline-block h-5 w-20 bg-muted/60 rounded animate-pulse" />
                                  ) : formRangeInfo?.isCalculating ? (
                                    <span className="inline-block h-5 w-20 bg-muted/60 rounded animate-pulse" />
                                  ) : formRangeInfo?.hasUserInteracted && formRangeInfo.estimatedApy !== "0.00" && formRangeInfo.estimatedApy !== "—" ? (
                                    `${formRangeInfo.estimatedApy}%`
                                  ) : (
                                    currentPoolData.apr
                                  )}
                                </div>
                              </div>
                            </div>
                          </UITooltipTrigger>
                          <UITooltipContent side="bottom" sideOffset={6} className="px-2 py-1 text-xs max-w-[240px]">
                            <div className="font-medium text-foreground">
                              Average over last 7 days
                            </div>
                          </UITooltipContent>
                        </UITooltip>
                      </UITooltipProvider>
                </div>
              </div>
            </div>
          </div>
          
              {/* Pool Overview Section */}
              <div className="flex-1 min-h-0">
                <div
                  ref={poolActivityRef}
                  className="rounded-lg bg-muted/30 border border-sidebar-border/60 transition-colors flex flex-col min-h-[300px] sm:min-h-[350px]"
                  style={poolActivityHeight ? { height: `${poolActivityHeight}px` } : { height: '100%' }}
                >
                  <div className="flex items-center justify-between px-4 py-2 border-b border-sidebar-border/60">
                    <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">POOL ACTIVITY</h2>
                    {/* Dropdown for smaller screens < 1400px */}
                    <div className="min-[1400px]:hidden">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            className="flex items-center gap-2 px-2.5 py-1 text-xs font-medium rounded-md bg-transparent text-muted-foreground hover:bg-muted/30 border border-border"
                          >
                            {activeChart === 'volumeTvlRatio' && 'Dynamic Fee'}
                            {activeChart === 'volume' && 'Volume'}
                            {activeChart === 'tvl' && 'TVL'}
                            <ChevronDownIcon className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent 
                          align="end" 
                          className="w-40 rounded-lg border border-sidebar-border p-1"
                          sideOffset={8}
                          style={{ backgroundColor: '#0f0f0f' }}
                        >
                          <DropdownMenuItem
                            onClick={() => setActiveChart('volumeTvlRatio')}
                            className={`flex items-center justify-between cursor-pointer rounded-md text-xs ${activeChart === 'volumeTvlRatio' ? 'bg-muted text-foreground' : ''}`}
                          >
                            <span>Dynamic Fee</span>
                            {activeChart === 'volumeTvlRatio' && <Check className="h-3.5 w-3.5" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setActiveChart('volume')}
                            className={`flex items-center justify-between cursor-pointer rounded-md text-xs ${activeChart === 'volume' ? 'bg-muted text-foreground' : ''}`}
                          >
                            <span>Volume</span>
                            {activeChart === 'volume' && <Check className="h-3.5 w-3.5" />}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => setActiveChart('tvl')}
                            className={`flex items-center justify-between cursor-pointer rounded-md text-xs ${activeChart === 'tvl' ? 'bg-muted text-foreground' : ''}`}
                          >
                            <span>TVL</span>
                            {activeChart === 'tvl' && <Check className="h-3.5 w-3.5" />}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    {/* Buttons for larger screens >= 1500px - ghost tab styling */}
                    <div className="hidden min-[1500px]:flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50",
                            activeChart === 'volumeTvlRatio' && "bg-muted/50 text-foreground"
                          )}
                          onClick={() => setActiveChart('volumeTvlRatio')}
                        >
                          Dynamic Fee
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50",
                            activeChart === 'volume' && "bg-muted/50 text-foreground"
                          )}
                          onClick={() => setActiveChart('volume')}
                        >
                          Volume
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn(
                            "h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50",
                            activeChart === 'tvl' && "bg-muted/50 text-foreground"
                          )}
                          onClick={() => setActiveChart('tvl')}
                        >
                          TVL
                        </Button>
                      </div>
                  </div>
                  <div className="p-0 flex-1 min-h-0">
                    <ChartContainer
                      config={chartConfig}
                      className="aspect-auto w-full h-full relative"
                    >
                      {isLoadingChartData ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 z-20 rounded-lg">
                          <Image 
                            src="/LogoIconWhite.svg" 
                            alt="Loading..." 
                            width={32}
                            height={32}
                            className="animate-pulse opacity-75"
                          />
                        </div>
                      ) : apiChartData.length >= 1 ? (
                        // Mobile-only chart (no Y-axis)
                        isMobile ? (
                          activeChart === 'volumeTvlRatio' ? (
                            // Mobile LineChart for dynamic fee view (invisible Y-axes with calculated domains)
                            (() => {
                              // Calculate the actual min/max values from the data
                              const ratios = apiChartData.flatMap(d => [d.volumeTvlRatio, d.emaRatio]).filter(v => typeof v === 'number');
                              const fees = apiChartData.map(d => d.dynamicFee).filter(v => typeof v === 'number');
                              
                              const ratioMin = Math.min(...ratios);
                              const ratioMax = Math.max(...ratios);
                              const feeMin = Math.min(...fees);
                              const feeMax = Math.max(...fees);
                              
                              // Calculate domains with -10% to +10% padding
                              const ratioRange = ratioMax - ratioMin;
                              const feeRange = feeMax - feeMin;
                              
                              const ratioDomain = [
                                ratioMin - (ratioRange * 0.1),
                                ratioMax + (ratioRange * 0.1)
                              ];
                              
                              const feeDomain = [
                                Math.max(0, feeMin - (feeRange * 0.1)),
                                feeMax + (feeRange * 0.1)
                              ];
                              
                              return (
                                <LineChart
                                  data={processChartDataForScreenSize(apiChartData)}
                                  margin={{ top: 8, right: 14, left: 14, bottom: 8 }}
                                >
                                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                                  <XAxis
                                    dataKey="date"
                                    tickLine={false}
                                    axisLine={false}
                                    tickMargin={6}
                                    padding={{ left: 8, right: 8 }}
                                    tickFormatter={(value) => {
                                      const date = new Date(value);
                                      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                                    }}
                                    tick={{ fontSize: '0.7rem' }}
                                  />
                                  <YAxis
                                    yAxisId="left"
                                    domain={ratioDomain}
                                    hide
                                  />
                                  <YAxis
                                    yAxisId="right"
                                    orientation="right"
                                    domain={feeDomain}
                                    hide
                                  />
                                  <ChartTooltip
                                    cursor={true}
                                    content={({ active, payload, label }) => {
                                      if (!active || !payload || !payload.length) return null;
                                      
                                      // Get the data point from the first payload item
                                      const dataPoint = payload[0]?.payload;
                                      if (!dataPoint) return null;

                                      return (
                                        <div className="grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-sidebar-border bg-main px-2.5 py-1.5 text-xs shadow-xl">
                                          <div className="font-medium">
                                            {new Date(dataPoint.date).toLocaleDateString("en-US", {
                                              month: "long",
                                              day: "numeric"
                                            })}
                                          </div>
                                          <div className="grid gap-1.5">
                                            {/* Activity with line indicator */}
                                            <div className="flex w-full flex-wrap items-stretch gap-2">
                                              <div
                                                className="shrink-0 rounded-[2px] w-[2px] h-4"
                                                style={{
                                                  backgroundColor: 'hsl(var(--chart-3))',
                                                }}
                                              />
                                              <div className="flex flex-1 justify-between leading-none items-center">
                                                <span className="text-muted-foreground">Activity</span>
                                                <span className="font-mono font-medium tabular-nums text-foreground">
                                                  {typeof dataPoint.volumeTvlRatio === 'number' ? dataPoint.volumeTvlRatio.toFixed(3) : 'N/A'}
                                                </span>
                                              </div>
                                            </div>

                                            {/* Target with line indicator */}
                                            <div className="flex w-full flex-wrap items-stretch gap-2">
                                              <div
                                                className="shrink-0 rounded-[2px] w-[2px] h-4"
                                                style={{
                                                  backgroundImage:
                                                    'repeating-linear-gradient(to bottom, hsl(var(--chart-2)) 0 2px, transparent 2px 4px)',
                                                }}
                                              />
                                              <div className="flex flex-1 justify-between leading-none items-center">
                                                <span className="text-muted-foreground">Target</span>
                                                <span className="font-mono font-medium tabular-nums text-foreground">
                                                  {typeof dataPoint.emaRatio === 'number' ? dataPoint.emaRatio.toFixed(3) : 'N/A'}
                                                </span>
                                              </div>
                                            </div>

                                            {/* Dashed separator */}
                                            <div className="border-t border-dashed border-border my-1"></div>

                                            {/* Dynamic Fee with rounded line indicator */}
                                            <div className="flex w-full flex-wrap items-stretch gap-2">
                                              <div
                                                className="shrink-0 rounded-[2px] w-[2px] h-4"
                                                style={{
                                                  backgroundColor: '#e85102',
                                                }}
                                              />
                                              <div className="flex flex-1 justify-between leading-none items-center">
                                                <span className="text-muted-foreground">Fee</span>
                                                <span className="font-mono font-medium tabular-nums text-foreground">
                                                  {typeof dataPoint.dynamicFee === 'number' ? `${dataPoint.dynamicFee < 0.1 ? dataPoint.dynamicFee.toFixed(3) : dataPoint.dynamicFee.toFixed(2)}%` : 'N/A'}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    }}
                                  />
                                  <Line
                                    yAxisId="left"
                                    type="monotone"
                                    dataKey="volumeTvlRatio"
                                    strokeWidth={2}
                                    dot={false}
                                    stroke={chartConfig.volumeTvlRatio.color}
                                    name={chartConfig.volumeTvlRatio.label}
                                    isAnimationActive={false}
                                  />
                                  <Line
                                    yAxisId="left"
                                    type="monotone"
                                    dataKey="emaRatio"
                                    strokeWidth={2}
                                    dot={false}
                                    stroke={chartConfig.emaRatio.color}
                                    name={chartConfig.emaRatio.label}
                                    strokeDasharray="5 5"
                                    isAnimationActive={false}
                                  />
                                  <Line
                                    yAxisId="right"
                                    type="stepAfter"
                                    dataKey="dynamicFee"
                                    strokeWidth={2}
                                    dot={false}
                                    stroke={chartConfig.dynamicFee.color}
                                    name={chartConfig.dynamicFee.label}
                                    isAnimationActive={false}
                                  />
                                </LineChart>
                              );
                            })()
                          ) : (
                            // Mobile BarChart for volume and TVL views (no Y-axis)
                            <BarChart
                              key={`bar-${activeChart}`}
                              accessibilityLayer
                              data={processChartDataForScreenSize(apiChartData)}
                              margin={{
                                left: 16,
                                right: 20,
                                top: 20, 
                                bottom: 3
                              }}
                            >
                              <CartesianGrid vertical={false} />
                              <XAxis
                                dataKey="date"
                                tickLine={false}
                                axisLine={false}
                                tickMargin={8}
                                 padding={{ left: 16, right: 20 }}
                                minTickGap={32}
                                tickFormatter={(value) => {
                                  const date = new Date(value);
                                  return date.toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                  });
                                }}
                              />
                              <ChartTooltip
                                cursor={false}
                                content={
                                  <ChartTooltipContent 
                                    indicator="line"
                                    className="!bg-main !text-card-foreground border border-sidebar-border shadow-lg rounded-lg"
                                    formatter={(value, name, item, index, payload) => {
                                      const itemConfig = chartConfig[name as keyof typeof chartConfig];
                                      const indicatorColor = item?.color || (itemConfig && 'color' in itemConfig ? itemConfig.color : '#404040');
                                      
                                      return (
                                        <div className="flex gap-2">
                                          <div
                                            className="shrink-0 rounded-[2px] border-[--color-border] bg-[--color-bg] w-1"
                                            style={{
                                              "--color-bg": indicatorColor,
                                              "--color-border": indicatorColor,
                                            } as React.CSSProperties}
                                          />
                                          <div className="grid gap-1 flex-1">
                                            {index === 0 && (
                                              <div className="font-medium">
                                                {new Date(item.payload?.date).toLocaleDateString("en-US", {
                                                  month: "long",
                                                  day: "numeric"
                                                })}
                                              </div>
                                            )}
                                            <div className="flex justify-between leading-none items-center gap-4">
                                              <span className="text-muted-foreground">
                                                {itemConfig?.label || name}
                                              </span>
                                              <span className="font-mono font-medium tabular-nums text-foreground">
                                                ${typeof value === 'number' ? Math.round(value).toLocaleString('en-US') : value}
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    }}
                                    labelFormatter={(value) => {
                                      return new Date(value).toLocaleDateString("en-US", {
                                        month: "short",
                                        day: "numeric"
                                      });
                                    }}
                                  />
                                }
                              />
                              <Bar
                                dataKey={activeChart === 'volume' ? 'volumeUSD' : 'tvlUSD'}
                                fill={
                                  (chartConfig[(activeChart === 'volume' ? 'volumeUSD' : 'tvlUSD') as keyof typeof chartConfig] as any)?.color
                                  || (chartConfig[activeChart as keyof typeof chartConfig] as any)?.color
                                  || `var(--color-${activeChart})`
                                }
                                barSize={12}
                              />
                            </BarChart>
                          )
                        ) : (
                          // Desktop chart (original implementation)
                          activeChart === 'volumeTvlRatio' ? (
                            // LineChart for dynamic fee view (desktop) with uniform margins and padded domains
                            (() => {
                              const processed = processChartDataForScreenSize(apiChartData);
                              const ratios = processed
                                .flatMap(d => [d.volumeTvlRatio, d.emaRatio])
                                .filter(v => typeof v === 'number' && isFinite(v));
                              const fees = processed
                                .map(d => d.dynamicFee)
                                .filter(v => typeof v === 'number' && isFinite(v));

                              const ratioMin = ratios.length ? Math.min(...ratios) : 0;
                              const ratioMax = ratios.length ? Math.max(...ratios) : 1;
                              const feeMin = fees.length ? Math.min(...fees) : 0;
                              const feeMax = fees.length ? Math.max(...fees) : 1;

                              const ratioRange = ratioMax - ratioMin || 1;
                              const feeRange = feeMax - feeMin || 1;

                              const paddingFactor = 0.1; // 10% padding top/bottom to avoid flush edges
                              const ratioDomain: [number, number] = [
                                Math.max(0, ratioMin - ratioRange * paddingFactor),
                                ratioMax + ratioRange * paddingFactor,
                              ];
                              const feeDomain: [number, number] = [
                                Math.max(0, feeMin - feeRange * paddingFactor),
                                feeMax + feeRange * paddingFactor,
                              ];

                              // Generate evenly spaced ticks for left Y axis to ensure grid lines at each label
                              const leftTickCount = 6;
                              const leftTicks = Array.from({ length: leftTickCount }, (_, i) => {
                                const t = i / (leftTickCount - 1);
                                return ratioDomain[0] + t * (ratioDomain[1] - ratioDomain[0]);
                              });

                              // Dynamically estimate a shared axis width so labels never overlap the lines
                              const estimateWidth = (label: string, basePadding: number, charWidth: number) => {
                                return basePadding + Math.max(0, label.length) * charWidth;
                              };
                              const leftLabelA = (ratioDomain[0]).toFixed(2);
                              const leftLabelB = (ratioDomain[1]).toFixed(2);
                              const rightLabelA = `${feeDomain[0] < 0.1 ? feeDomain[0].toFixed(3) : feeDomain[0].toFixed(2)}%`;
                              const rightLabelB = `${feeDomain[1] < 0.1 ? feeDomain[1].toFixed(3) : feeDomain[1].toFixed(2)}%`;
                              const maxChars = Math.max(
                                leftLabelA.length,
                                leftLabelB.length,
                                rightLabelA.length,
                                rightLabelB.length,
                              );
                              const axisWidth = Math.max(32, estimateWidth(''.padStart(maxChars, '0'), 12, 7));

                              return (
                                <LineChart
                                  data={processed}
                                  margin={{ top: 24, right: 28, bottom: 24, left: 16 }}
                                >
                                  <CartesianGrid horizontal vertical={false} strokeDasharray="3 3" />
                                  <XAxis
                                    dataKey="date"
                                    tickLine={false}
                                    axisLine={false}
                                    height={18}
                                    tickMargin={2}
                                     padding={{ left: 16, right: 16 }}
                                    tickFormatter={(value) => {
                                      const date = new Date(value);
                                      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                                    }}
                                    tick={{ fontSize: '0.75rem', dy: 6 }}
                                  />
                                  <YAxis
                                    yAxisId="left"
                                    tickLine={false}
                                    axisLine={false}
                                    tickMargin={0}
                                    width={32}
                                    tickCount={leftTickCount}
                                    ticks={leftTicks}
                                    tickFormatter={(value) => value.toFixed(2)}
                                    domain={ratioDomain}
                                    stroke="hsl(var(--muted-foreground))"
                                    tick={{ fontSize: '0.75rem' }}
                                  />
                                  <YAxis
                                    yAxisId="right"
                                    orientation="right"
                                    tickLine={false}
                                    axisLine={false}
                                    tickMargin={0}
                                    width={axisWidth}
                                    tickFormatter={(value) => `${value < 0.1 ? value.toFixed(3) : value.toFixed(2)}%`}
                                    domain={feeDomain}
                                    stroke="hsl(var(--muted-foreground))"
                                    tick={{ fontSize: '0.75rem', textAnchor: 'start' }}
                                  />
                                  <ChartTooltip
                                    cursor={true}
                                    content={({ active, payload }) => {
                                      if (!active || !payload || !payload.length) return null;
                                      const dataPoint = payload[0]?.payload;
                                      if (!dataPoint) return null;

                                      return (
                                        <div className="grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-sidebar-border bg-main px-2.5 py-1.5 text-xs shadow-xl">
                                          <div className="font-medium">
                                            {new Date(dataPoint.date).toLocaleDateString("en-US", {
                                              month: "long",
                                              day: "numeric",
                                            })}
                                          </div>
                                          <div className="grid gap-1.5">
                                            <div className="flex w-full flex-wrap items-stretch gap-2">
                                              <div
                                                className="shrink-0 rounded-[2px] w-[2px] h-4"
                                                style={{ backgroundColor: 'hsl(var(--chart-3))' }}
                                              />
                                              <div className="flex flex-1 justify-between leading-none items-center">
                                                <span className="text-muted-foreground">Activity</span>
                                                <span className="font-mono font-medium tabular-nums text-foreground">
                                                  {typeof dataPoint.volumeTvlRatio === 'number' ? dataPoint.volumeTvlRatio.toFixed(3) : 'N/A'}
                                                </span>
                                              </div>
                                            </div>
                                            <div className="flex w-full flex-wrap items-stretch gap-2">
                                              <div
                                                className="shrink-0 rounded-[2px] w-[2px] h-4"
                                                style={{
                                                  backgroundImage:
                                                    'repeating-linear-gradient(to bottom, hsl(var(--chart-2)) 0 2px, transparent 2px 4px)',
                                                }}
                                              />
                                              <div className="flex flex-1 justify-between leading-none items-center">
                                                <span className="text-muted-foreground">Target</span>
                                                <span className="font-mono font-medium tabular-nums text-foreground">
                                                  {typeof dataPoint.emaRatio === 'number' ? dataPoint.emaRatio.toFixed(3) : 'N/A'}
                                                </span>
                                              </div>
                                            </div>
                                            <div className="border-t border-dashed border-border my-1"></div>
                                            <div className="flex w-full flex-wrap items-stretch gap-2">
                                              <div
                                                className="shrink-0 rounded-[2px] w-[2px] h-4"
                                                style={{ backgroundColor: '#e85102' }}
                                              />
                                              <div className="flex flex-1 justify-between leading-none items-center">
                                                <span className="text-muted-foreground">Fee</span>
                                                <span className="font-mono font-medium tabular-nums text-foreground">
                                                  {typeof dataPoint.dynamicFee === 'number' ? `${dataPoint.dynamicFee < 0.1 ? dataPoint.dynamicFee.toFixed(3) : dataPoint.dynamicFee.toFixed(2)}%` : 'N/A'}
                                                </span>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    }}
                                  />
                                  <Line
                                    yAxisId="left"
                                    type="monotone"
                                    dataKey="volumeTvlRatio"
                                    strokeWidth={2}
                                    dot={false}
                                    stroke={chartConfig.volumeTvlRatio.color}
                                    name={chartConfig.volumeTvlRatio.label}
                                    isAnimationActive={false}
                                  />
                                  <Line
                                    yAxisId="left"
                                    type="monotone"
                                    dataKey="emaRatio"
                                    strokeWidth={2}
                                    dot={false}
                                    stroke={chartConfig.emaRatio.color}
                                    name={chartConfig.emaRatio.label}
                                    strokeDasharray="5 5"
                                    isAnimationActive={false}
                                  />
                                  <Line
                                    yAxisId="right"
                                    type="stepAfter"
                                    dataKey="dynamicFee"
                                    strokeWidth={2}
                                    dot={false}
                                    stroke={chartConfig.dynamicFee.color}
                                    name={chartConfig.dynamicFee.label}
                                    isAnimationActive={false}
                                  />
                                </LineChart>
                              );
                            })()
                          ) : (
                            // BarChart for volume and TVL views
                            <BarChart
                              key={`desk-bar-${activeChart}`}
                              accessibilityLayer
                              data={processChartDataForScreenSize(apiChartData)}
                              margin={{
                                left: 25,
                                right: 25,
                                top: 20, 
                                bottom: 10
                              }}
                            >
                              <CartesianGrid vertical={false} />
                              <XAxis
                                dataKey="date"
                                tickLine={false}
                                axisLine={false}
                                tickMargin={8}
                                padding={{ left: 16, right: 16 }}
                                minTickGap={32}
                                tickFormatter={(value) => {
                                  const date = new Date(value);
                                  return date.toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                  });
                                }}
                              />
                              <YAxis
                                tickLine={false}
                                axisLine={false}
                                tickMargin={8}
                                tickFormatter={(value: number) => {
                                  if (typeof value === 'number' && value >= 10000) {
                                    return `$${Math.round(value).toLocaleString('en-US')}`;
                                  }
                                  return formatUSD(value as number);
                                }}
                              />
                              <ChartTooltip
                                cursor={false}
                                content={
                                  <ChartTooltipContent 
                                    indicator="line"
                                    className="!bg-main !text-card-foreground border border-sidebar-border shadow-lg rounded-lg"
                                    formatter={(value, name, item, index, payload) => {
                                      const itemConfig = chartConfig[name as keyof typeof chartConfig];
                                      const indicatorColor = item?.color || (itemConfig && 'color' in itemConfig ? itemConfig.color : '#404040');
                                      
                                      return (
                                        <div className="flex gap-2">
                                          <div
                                            className="shrink-0 rounded-[2px] border-[--color-border] bg-[--color-bg] w-1"
                                            style={{
                                              "--color-bg": indicatorColor,
                                              "--color-border": indicatorColor,
                                            } as React.CSSProperties}
                                          />
                                          <div className="grid gap-1 flex-1">
                                            {index === 0 && (
                                              <div className="font-medium">
                                                {new Date(item.payload?.date).toLocaleDateString("en-US", {
                                                  month: "long",
                                                  day: "numeric"
                                                })}
                                              </div>
                                            )}
                                            <div className="flex justify-between leading-none items-center gap-4">
                                              <span className="text-muted-foreground">
                                                {itemConfig?.label || name}
                                              </span>
                                              <span className="font-mono font-medium tabular-nums text-foreground">
                                                ${typeof value === 'number' ? Math.round(value).toLocaleString('en-US') : value}
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    }}
                                    labelFormatter={(value) => {
                                      return new Date(value).toLocaleDateString("en-US", {
                                        month: "short",
                                        day: "numeric"
                                      });
                                    }}
                                  />
                                }
                              />
                              <Bar
                                dataKey={activeChart === 'volume' ? 'volumeUSD' : 'tvlUSD'}
                                fill={
                                  (chartConfig[(activeChart === 'volume' ? 'volumeUSD' : 'tvlUSD') as keyof typeof chartConfig] as any)?.color
                                  || (chartConfig[activeChart as keyof typeof chartConfig] as any)?.color
                                  || `var(--color-${activeChart})`
                                }
                                barSize={14}
                              />
                            </BarChart>
                          )
                        )
                      ) : (
                        <div className="flex justify-center items-center h-full">
                          <div className="text-xs font-mono text-muted-foreground/50 animate-pulse">
                            Pool Initializing ({apiChartData?.length || 0}/1 updates)
                          </div>
                        </div>
                      )}
                    </ChartContainer>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Add Liquidity Form (fixed width at >=1400px, hidden below) */}
            {/* Key trick: Fixed width prevents layout shift from form content loading */}
            {/* Zoom matches the pool stats bar - 92% below 1700px */}
            <div className="hidden min-[1400px]:block w-[450px] flex-shrink-0 min-[1700px]:[zoom:1] max-[1699px]:[zoom:0.92]">
              {poolId && currentPoolData && (
                <div className="w-full rounded-lg bg-muted/30 border border-sidebar-border/60 transition-colors relative">
                  {/* Container header to match novel layout */}
                  <div className="flex items-center justify-between px-4 py-2 border-b border-sidebar-border/60">
                    <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">ADD LIQUIDITY</h2>
                  </div>
                  {/* Content - contained within fixed width parent */}
                  <div className="p-3 sm:p-4">
                    <AddLiquidityFormMemo
                      selectedPoolId={poolId}
                      onLiquidityAdded={(token0Symbol?: string, token1Symbol?: string, txInfo?) => {
                        refreshAfterLiquidityAddedWithSkeleton(token0Symbol, token1Symbol, txInfo);
                      }}
                      sdkMinTick={SDK_MIN_TICK}
                      sdkMaxTick={SDK_MAX_TICK}
                      defaultTickSpacing={getPoolById(poolId)?.tickSpacing || DEFAULT_TICK_SPACING}
                      activeTab={'deposit'}
                      onRangeChange={setFormRangeInfo}
                      poolState={poolState ? {
                        currentPrice: String(poolState.currentPrice),
                        currentPoolTick: Number(poolState.currentPoolTick),
                        sqrtPriceX96: String(poolState.sqrtPriceX96 || ''),
                        liquidity: String(poolState.liquidity || ''),
                      } : undefined}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Your Positions Section (Full width below the columns) */}
          <div className="space-y-3 lg:space-y-4 mt-3 lg:mt-6"> {/* Consistent spacing */}
            {/* Static title - always visible */}
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium">Your Positions</h3>
              {/* Add Liquidity button - only show below 1400px AND when there are positions (on mobile, large button shows when no positions) */}
              {(userPositions.length > 0 || isDerivingNewPosition || !isMobile) && (
                <a
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddLiquidityFormOpen(true);
                  }}
                  className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-sidebar-border bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 min-[1400px]:hidden"
                  style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                >
                  <PlusIcon className="h-4 w-4 relative z-0" />
                  <span className="relative z-0 whitespace-nowrap">Add Liquidity</span>
                </a>
              )}
            </div>

            {isLoadingPositions ? (
              <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 h-20 animate-pulse" />
            ) : userPositions.length > 0 || isDerivingNewPosition ? (
              <div>
                <div className="grid gap-3 lg:gap-4 min-[1360px]:grid-cols-2 min-[1360px]:gap-4 responsive-grid">
                  {isDerivingNewPosition && <PositionSkeleton key="deriving-skeleton" />}
                  {(() => {
                    const aprNum = parseFloat(currentPoolData?.apr?.replace(/[~%]/g, '') || '');
                    const poolAPY = isFinite(aprNum) ? aprNum : null;

                    return userPositions.map((position) => {
                      const feeData = getFeesForPosition(position.positionId);
                      const positionWithFees = {
                        ...position,
                        unclaimedRaw0: feeData?.amount0,
                        unclaimedRaw1: feeData?.amount1,
                      };

                    return (
                      <PositionCardCompact
                        key={position.positionId}
                        position={positionWithFees as any}
                        valueUSD={calculatePositionUsd(position)}
                        getUsdPriceForSymbol={getUsdPriceForSymbol}
                        convertTickToPrice={boundConvertTickToPrice}
                        poolType={getPoolById(poolId)?.type}
                        onClick={() => {
                          setUserPositions(prev => prev.map(p =>
                            p.positionId === position.positionId
                              ? { ...p, isOptimisticallyUpdating: true }
                              : p
                          ));
                          setSelectedPositionForDetails(positionWithFees as any);
                          setIsPositionDetailsModalOpen(true);
                        }}
                        poolContext={{
                          currentPrice,
                          currentPoolTick,
                          poolAPY,
                          isLoadingPrices,
                          isLoadingPoolStates: !currentPoolData
                        }}
                        fees={{
                          raw0: batchFeesData?.find(f => f.positionId === position.positionId)?.amount0 ?? null,
                          raw1: batchFeesData?.find(f => f.positionId === position.positionId)?.amount1 ?? null
                        }}
                      />
                    );
                    });
                  })()}
                </div>
              </div>
            ) : (
              /* Dashed outline container - with Add Liquidity button on mobile, text on desktop */
              <div className="border border-dashed rounded-lg bg-muted/10 p-8 flex items-center justify-center">
                {isMobile ? (
                  <a
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddLiquidityFormOpen(true);
                    }}
                    className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-sidebar-border bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30"
                    style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                  >
                    <PlusIcon className="h-4 w-4 relative z-0" />
                    <span className="relative z-0 whitespace-nowrap">Add Liquidity</span>
                  </a>
                ) : (
                  <div className="text-sm font-medium text-white/75">
                    No Positions
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Withdraw Position Modal */}
      <WithdrawLiquidityModal
        isOpen={showBurnConfirmDialog}
        onOpenChange={(open) => {
        // Only allow closing if not currently processing transaction
        if (!isDecreasingLiquidity) {
          setShowBurnConfirmDialog(open);
          // Reset position when modal is actually closed
          if (!open) {
            setPositionToBurn(null);
          }
        }
        }}
        position={positionToBurn}
        feesForWithdraw={feesForWithdraw}
        onLiquidityWithdrawn={() => {
          // Handle successful withdrawal - don't reset position immediately to allow success view to show
          // Don't reset pendingActionRef here - let onLiquidityDecreasedCallback handle it after refresh
          // Don't call setPositionToBurn(null) here - let the modal handle its own closing
        }}
        // Connect to parent's refetching flow
        decreaseLiquidity={decreaseLiquidity}
        isWorking={isDecreasingLiquidity}
        isDecreaseSuccess={isDecreaseSuccess}
        decreaseTxHash={decreaseTxHash}
      />

      {/* Add Liquidity Modal - for position card submenu */}
      <AddLiquidityModal
        isOpen={addLiquidityOpen || showIncreaseModal}
        onOpenChange={(open) => {
          if (showIncreaseModal) {
            setShowIncreaseModal(open);
          } else {
            setAddLiquidityOpen(open);
          }
        }}
        selectedPoolId={poolId}
        sdkMinTick={SDK_MIN_TICK}
        sdkMaxTick={SDK_MAX_TICK}
        defaultTickSpacing={getPoolById(poolId)?.tickSpacing || DEFAULT_TICK_SPACING}
        positionToModify={showIncreaseModal ? positionToModify : null}
        feesForIncrease={showIncreaseModal ? feesForIncrease : null}
        increaseLiquidity={showIncreaseModal ? (data) => {
          pendingActionRef.current = { type: 'increase' };
          increaseLiquidity(data);
        } : undefined}
        isIncreasingLiquidity={showIncreaseModal ? isIncreasingLiquidity : undefined}
        isIncreaseSuccess={showIncreaseModal ? isIncreaseSuccess : undefined}
        increaseTxHash={showIncreaseModal ? increaseTxHash : undefined}
        onLiquidityAdded={(token0Symbol?: string, token1Symbol?: string, txInfo?) => {
          if (showIncreaseModal) {
            // For increase operations, do nothing here - let the transaction callback handle everything
            // This prevents premature toasts and modal closure
          } else {
            setAddLiquidityOpen(false);
            refreshAfterLiquidityAddedWithSkeleton(token0Symbol, token1Symbol, txInfo);
          }
        }}
      />

      {/* Add Liquidity Form Modal - for top button */}
      {(() => {
        const formElement = addLiquidityFormOpen && (
          <AddLiquidityFormMemo
            selectedPoolId={poolId}
            onLiquidityAdded={(token0Symbol?: string, token1Symbol?: string, txInfo?) => {
              setAddLiquidityFormOpen(false);
              refreshAfterLiquidityAddedWithSkeleton(token0Symbol, token1Symbol, txInfo);
            }}
            sdkMinTick={SDK_MIN_TICK}
            sdkMaxTick={SDK_MAX_TICK}
            defaultTickSpacing={getPoolById(poolId)?.tickSpacing || DEFAULT_TICK_SPACING}
            activeTab="deposit"
            onRangeChange={setFormRangeInfo}
            poolState={poolState ? {
              currentPrice: String(poolState.currentPrice),
              currentPoolTick: Number(poolState.currentPoolTick),
              sqrtPriceX96: String(poolState.sqrtPriceX96 || ''),
              liquidity: String(poolState.liquidity || ''),
            } : undefined}
          />
        );
        return isMobile ? (
          <Sheet open={addLiquidityFormOpen} onOpenChange={setAddLiquidityFormOpen}>
            <SheetContent
              side="bottom"
              ref={sheetContentRef}
              className="rounded-t-2xl border-t border-primary p-0 flex flex-col bg-popover [&>button]:hidden"
              style={{
                height: 'min(95dvh, 95vh)',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                transition: isSheetDragging ? "none" : "transform 160ms ease-out",
              }}
              onPointerDownOutside={() => setAddLiquidityFormOpen(false)}
            >
              {/* X close button */}
              <button
                onClick={() => setAddLiquidityFormOpen(false)}
                className="absolute top-3 right-3 z-10 p-1.5 rounded-full bg-muted/50 hover:bg-muted transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
              {/* Drag handle */}
              <div
                className="flex items-center justify-center h-10 touch-none flex-shrink-0"
                onTouchStart={onSheetHandleTouchStart}
                onTouchMove={onSheetHandleTouchMove}
                onTouchEnd={onSheetHandleTouchEnd}
              >
                <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
              </div>
              <SheetHeader className="px-4 pb-2 flex-shrink-0">
                <SheetTitle>Add Liquidity</SheetTitle>
                <SheetDescription>Add liquidity to the {currentPoolData?.pair} pool</SheetDescription>
              </SheetHeader>
              <div className="flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{formElement}</div>
            </SheetContent>
          </Sheet>
        ) : (
          <Dialog open={addLiquidityFormOpen} onOpenChange={setAddLiquidityFormOpen}>
            <DialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-2xl max-h-[90vh] overflow-y-auto" style={{ backgroundColor: 'var(--modal-background)' }}>
              <DialogHeader>
                <DialogTitle>Add Liquidity</DialogTitle>
                <DialogDescription>Add liquidity to the {currentPoolData?.pair} pool</DialogDescription>
              </DialogHeader>
              <div className="pt-4">{formElement}</div>
            </DialogContent>
          </Dialog>
        );
      })()}

      {/* Decrease Position Modal */}
      <Dialog open={showDecreaseModal} onOpenChange={setShowDecreaseModal}>
        <DialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-md">
          <DialogHeader>
            <DialogTitle>Decrease Liquidity Position</DialogTitle>
            <DialogDescription>
              Remove liquidity from your existing position.
            </DialogDescription>
          </DialogHeader>
          {positionToModify && (
            <div className="space-y-4">
              <div className="text-sm p-3 border rounded-md bg-muted/30">
                <p><strong>Current Position:</strong></p>
                <div className="flex justify-between items-center">
                  <span>{positionToModify.token0.symbol}: {formatTokenDisplayAmount(positionToModify.token0.amount)}</span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="text-xs text-blue-600 h-6"
                    onClick={() => handleMaxDecrease('amount0')}
                    disabled={isDecreaseCalculating || isDecreasingLiquidity}
                  >
                    Max
                  </Button>
                </div>
                <div className="flex justify-between items-center">
                  <span>{positionToModify.token1.symbol}: {formatTokenDisplayAmount(positionToModify.token1.amount)}</span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="text-xs text-blue-600 h-6"
                    onClick={() => handleMaxDecrease('amount1')}
                    disabled={isDecreaseCalculating || isDecreasingLiquidity}
                  >
                    Max
                  </Button>
                </div>
                {!positionToModify.isInRange && (
                  <p className="text-orange-600 text-xs mt-2">
                    ⚠️ Out of range: You can remove one token at a time, or use Max for full withdrawal
                  </p>
                )}
              </div>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="decrease-amount0">Remove {positionToModify.token0.symbol}</Label>
                  <Input
                    id="decrease-amount0"
                    type="text"
                    pattern="[0-9]*\.?[0-9]*"
                    inputMode="decimal"
                    placeholder="0.0"
                    className="mt-1"
                    max={positionToModify.token0.amount}
                    value={decreaseAmount0}
                    onChange={(e) => {
                      const newValue = sanitizeDecimalInput(e.target.value);
                      const maxAmount = parseFloat(positionToModify.token0.amount);
                      if (parseFloat(newValue) > maxAmount) {
                        setDecreaseAmount0(maxAmount.toString());
                        return;
                      }
                      setDecreaseAmount0(newValue);
                      setDecreaseActiveInputSide('amount0');
                      if (newValue && parseFloat(newValue) > 0) {
                        calculateDecreaseAmount(newValue, 'amount0');
                      } else {
                        setDecreaseAmount1("");
                        setIsFullBurn(false);
                      }
                    }}
                    disabled={isDecreaseCalculating && decreaseActiveInputSide === 'amount1'}
                  />
                  {/* removed calculating hint for cleaner UX */}
                </div>
                <div>
                  <Label htmlFor="decrease-amount1">Remove {positionToModify.token1.symbol}</Label>
                  <Input
                    id="decrease-amount1"
                    type="text"
                    pattern="[0-9]*\.?[0-9]*"
                    inputMode="decimal"
                    placeholder="0.0"
                    className="mt-1"
                    max={positionToModify.token1.amount}
                    value={decreaseAmount1}
                    onChange={(e) => {
                      const newValue = sanitizeDecimalInput(e.target.value);
                      const maxAmount = parseFloat(positionToModify.token1.amount);
                      if (parseFloat(newValue) > maxAmount) {
                        setDecreaseAmount1(maxAmount.toString());
                        return;
                      }
                      setDecreaseAmount1(newValue);
                      setDecreaseActiveInputSide('amount1');
                      if (newValue && parseFloat(newValue) > 0) {
                        calculateDecreaseAmount(newValue, 'amount1');
                      } else {
                        setDecreaseAmount0("");
                        setIsFullBurn(false);
                      }
                    }}
                    disabled={isDecreaseCalculating && decreaseActiveInputSide === 'amount0'}
                  />
                  {/* removed calculating hint for cleaner UX */}
                </div>
              </div>
              {isFullBurn && (
                <div className="text-center text-sm text-orange-600 bg-orange-50 p-2 rounded">
                  This will burn the entire position
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowDecreaseModal(false)}
              disabled={isDecreasingLiquidity}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleConfirmDecrease}
              variant={isFullBurn ? "destructive" : "default"}
              disabled={
                isDecreasingLiquidity ||
                isDecreaseCalculating ||
                (positionToModify?.isInRange ? 
                  (!decreaseAmount0 || !decreaseAmount1 || parseFloat(decreaseAmount0) <= 0 || parseFloat(decreaseAmount1) <= 0) :
                  ((!decreaseAmount0 || parseFloat(decreaseAmount0) <= 0) && (!decreaseAmount1 || parseFloat(decreaseAmount1) <= 0))
                )
              }
            >
              {isDecreasingLiquidity ? (
                <>
                  <RefreshCwIcon className="mr-2 h-4 w-4 animate-spin" />
                  {isFullBurn ? "Burning..." : "Withdrawing..."}
                </>
              ) : (
                isFullBurn ? "Burn Position" : "Withdraw"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dynamic Fee Modal */}
      <AnimatePresence>
        {isDynamicFeeModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md"
            onClick={() => setIsDynamicFeeModalOpen(false)}
          >
            {/* Modal content */}
          <motion.div
            initial={{ y: '8%', opacity: 0 }}
            animate={{ y: '0%', opacity: 1 }}
            exit={{ y: '8%', opacity: 0 }}
              transition={{
                duration: 0.4,
                ease: [0.34, 1.3, 0.64, 1]
              }}
              className="relative rounded-lg border border-sidebar-border shadow-2xl overflow-hidden"
              style={{
                width: '500px',
                maxWidth: '90vw',
                backgroundColor: 'var(--modal-background)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 transition-colors flex flex-col h-full">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-sidebar-border/60">
                  <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">PRODUCT</h2>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsDynamicFeeModalOpen(false)}
                    className="h-6 w-6 -mr-1 text-muted-foreground hover:text-foreground"
                  >
                    <span className="text-lg">×</span>
                  </Button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4">
                  {/* Dynamic Fee Title */}
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 rounded-md bg-sidebar-primary/10 border border-sidebar-border flex items-center justify-center" style={{ width: '32px', height: '32px' }}>
                      <Image src="/Dynamic Fee.svg" alt="Dynamic Fee" width={18} height={18} />
                    </div>
                    <h3 className="text-base font-semibold">Dynamic Fee</h3>
                  </div>

                  {/* Current Fee Section with Chart */}
                  <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-4">
                    {apiChartData.slice(-30).length >= 7 ? (
                      <div className="flex gap-4 items-end">
                        {/* Left side - Current Fee */}
                        <div className="flex-shrink-0 min-w-[100px]">
                          <h3 className="text-xs font-bold text-muted-foreground mb-1">Current Fee</h3>
                          <p
                            className="text-2xl font-semibold transition-colors"
                            style={{ color: hoveredFee !== null ? 'var(--sidebar-primary)' : undefined }}
                          >
                            {hoveredFee !== null
                              ? `${hoveredFee.toFixed(3)}%`
                              : currentPoolData?.dynamicFeeBps !== undefined
                                ? `${((currentPoolData.dynamicFeeBps as number) / 100).toFixed(3)}%`
                                : <span className="inline-block h-7 w-16 bg-muted/60 rounded animate-pulse" />}
                          </p>
                        </div>

                        {/* Right side - Chart */}
                        <div className="flex-1 min-w-0">
                          <ResponsiveContainer width="100%" height={60}>
                            <LineChart
                              data={apiChartData.slice(-30)}
                              margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                              onMouseLeave={() => setHoveredFee(null)}
                            >
                              <XAxis dataKey="date" hide={true} />
                              <YAxis hide={true} domain={['auto', 'auto']} />
                              <ChartTooltip
                                content={({ active, payload }) => {
                                  if (active && payload && payload[0]) {
                                    const fee = payload[0].payload.dynamicFee;
                                    if (typeof fee === 'number') {
                                      setHoveredFee(fee);
                                    }
                                  } else {
                                    setHoveredFee(null);
                                  }
                                  return null;
                                }}
                                cursor={{ stroke: '#505050', strokeWidth: 1, strokeDasharray: '3 3' }}
                              />
                              <Line
                                type="stepAfter"
                                dataKey="dynamicFee"
                                stroke={hoveredFee !== null ? 'var(--sidebar-primary)' : 'hsl(var(--chart-1))'}
                                strokeWidth={1.5}
                                dot={false}
                                activeDot={false}
                                isAnimationActive={false}
                              />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    ) : (
                      <div className="w-full h-[60px] flex items-center justify-center">
                        <div className="text-xs font-mono text-muted-foreground/50 animate-pulse">
                          Pool Initializing ({apiChartData.slice(-30).length}/7 updates)
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Product Information */}
                  <div>
                    <h3 className="text-sm font-medium mb-2">Product Information</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Dynamic fees automatically adjust based on market volatility and available liquidity.
                      This helps optimize returns for liquidity providers while maintaining competituive pricing for traders.
                    </p>
                  </div>

                  {/* Learn More Button */}
                  <div
                    className="relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:bg-accent hover:brightness-110 hover:border-white/30 text-white"
                    style={{ backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                    onClick={() => window.open('https://alphix.gitbook.io/docs/products/dynamic-fee', '_blank')}
                  >
                    Learn More
                  </div>
                </div>
              </div>
              </motion.div>
            </motion.div>
        )}
      </AnimatePresence>

      {/* Position Details Modal */}
      {selectedPositionForDetails && (
        <PositionDetailsModal
          isOpen={isPositionDetailsModalOpen}
          onClose={() => {
            setIsPositionDetailsModalOpen(false);
            setSelectedPositionForDetails(null);
            setUserPositions(prev => prev.map(p => ({ ...p, isOptimisticallyUpdating: undefined })));
          }}
          position={selectedPositionForDetails}
          valueUSD={calculatePositionUsd(selectedPositionForDetails)}
          prefetchedRaw0={getFeesForPosition(selectedPositionForDetails.positionId)?.amount0}
          prefetchedRaw1={getFeesForPosition(selectedPositionForDetails.positionId)?.amount1}
          formatTokenDisplayAmount={formatTokenDisplayAmount}
          getUsdPriceForSymbol={getUsdPriceForSymbol}
          onRefreshPosition={async () => {
            await fetchPageData(true, false);
          }}
          onLiquidityDecreased={onLiquidityDecreasedCallback}
          onAfterLiquidityAdded={(tvlDelta, info) => {
            // Immediate optimistic TVL update
            if (currentPoolData?.liquidity) {
              const currentTvl = parseFloat(String(currentPoolData.liquidity).replace(/[$,]/g, ''));
              if (Number.isFinite(currentTvl)) {
                const optimisticTvl = Math.max(0, currentTvl + tvlDelta);
                setCurrentPoolData(prev => prev ? { ...prev, liquidity: formatUSD(optimisticTvl) } : prev);
              }
            }
            // Silent background refresh for actual data
            silentRefreshTVL();
          }}
          onAfterLiquidityRemoved={(tvlDelta, info) => {
            // Immediate optimistic TVL update (tvlDelta is already negative)
            if (currentPoolData?.liquidity) {
              const currentTvl = parseFloat(String(currentPoolData.liquidity).replace(/[$,]/g, ''));
              if (Number.isFinite(currentTvl)) {
                const optimisticTvl = Math.max(0, currentTvl + tvlDelta);
                setCurrentPoolData(prev => prev ? { ...prev, liquidity: formatUSD(optimisticTvl) } : prev);
              }
            }
            // Don't call silentRefreshTVL here - let refreshAfterMutation handle it post-sync
          }}
          currentPrice={currentPrice}
          currentPoolTick={currentPoolTick}
          convertTickToPrice={boundConvertTickToPrice}
          selectedPoolId={selectedPositionForDetails.poolId}
          chainId={chainId}
        />
      )}
    </>
  )
}