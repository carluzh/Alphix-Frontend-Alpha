"use client";

import { AppLayout } from "@/components/app-layout";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { PlusIcon, RefreshCwIcon, Check, BadgeCheck, OctagonX, Clock3, ChevronsLeftRight, EllipsisVertical, Info, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { useAccount, useBalance } from "wagmi";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ProcessedPosition } from "../../../pages/api/liquidity/get-positions";
import { TOKEN_DEFINITIONS, TokenSymbol } from "@/lib/pools-config";
import { Tooltip as UITooltip, TooltipContent as UITooltipContent, TooltipProvider as UITooltipProvider, TooltipTrigger as UITooltipTrigger } from "@/components/ui/tooltip";
import { motion, AnimatePresence } from "framer-motion";
import { formatUnits, type Hex } from "viem";
import { Bar, BarChart, Line, LineChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer, ComposedChart, Area, ReferenceLine, ReferenceArea } from "recharts";
import { getPoolById, getPoolSubgraphId, getToken, getAllTokens } from "@/lib/pools-config";
import { usePoolState, useAllPrices, useUncollectedFeesBatch } from "@/components/data/hooks";
import { getPoolFeeBps } from "@/lib/client-cache";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { useQueryClient } from '@tanstack/react-query';
import { getPositionManagerAddress } from '@/lib/pools-config';
import { position_manager_abi } from '@/lib/abis/PositionManager_abi';
import { getFromCache, setToCache, getFromCacheWithTtl, getUserPositionsCacheKey, getPoolStatsCacheKey, getPoolDynamicFeeCacheKey, getPoolChartDataCacheKey, loadUserPositionIds, derivePositionsFromIds, invalidateCacheEntry, waitForSubgraphBlock, setIndexingBarrier, invalidateUserPositionIdsCache, refreshFeesAfterTransaction } from "../../../lib/client-cache";

import type { Pool } from "../../../types";
import { AddLiquidityForm } from "../../../components/liquidity/AddLiquidityForm";
import { AddLiquidityModal } from "../../../components/liquidity/AddLiquidityModal";
import { WithdrawLiquidityModal } from "../../../components/liquidity/WithdrawLiquidityModal";
import React from "react";
import { useIncreaseLiquidity, type IncreasePositionData } from "@/components/liquidity/useIncreaseLiquidity";
import { useDecreaseLiquidity, type DecreasePositionData } from "@/components/liquidity/useDecreaseLiquidity";
import { prefetchService } from "@/lib/prefetch-service";
import { publicClient } from "@/lib/viemClient";


import { ChevronDownIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PositionSkeleton } from '@/components/liquidity/PositionSkeleton';
import { PositionCardCompact } from '@/components/liquidity/PositionCardCompact';
import { PositionDetailsModal } from '@/components/liquidity/PositionDetailsModal';


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

const getTokenIcon = (symbol?: string) => {
  if (!symbol) return "/placeholder-logo.svg";
  
  const tokenConfig = getToken(symbol as TokenSymbol);
  if (tokenConfig?.icon) {
    return tokenConfig.icon;
  }
  
  return "/placeholder-logo.svg";
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
const convertTickToPrice = (tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string): string => {
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
    const cfg0 = TOKEN_DEFINITIONS[token0Symbol as TokenSymbol];
    const cfg1 = TOKEN_DEFINITIONS[token1Symbol as TokenSymbol];
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

  // Helper function to determine base token for price display (same logic as AddLiquidityForm.tsx)
  const determineBaseTokenForPriceDisplay = (token0: string, token1: string): string => {
    if (!token0 || !token1) return token0;

    // Priority order for quote tokens (these should be the base for price display)
    const quotePriority: Record<string, number> = {
      'aUSDC': 10,
      'aUSDT': 9,
      'USDC': 8,
      'USDT': 7,
      'aETH': 6,
      'ETH': 5,
      'YUSD': 4,
      'mUSDT': 3,
    };

    const token0Priority = quotePriority[token0] || 0;
    const token1Priority = quotePriority[token1] || 0;

    // Return the token with higher priority (better quote currency)
    // If priorities are equal, default to token0
    return token1Priority > token0Priority ? token1 : token0;
  };

// Token stack component with independent hover state
function TokenStack({ position, currentPoolData, getToken }: { position: ProcessedPosition, currentPoolData: any, getToken: any }) {
  // Early return if position is undefined
  if (!position) {
    return <div className="w-8 h-8 bg-muted rounded-full" />;
  }

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const getTokenIcon = (positionToken: { symbol?: string; address?: string }) => {
    if (!positionToken?.symbol && !positionToken?.address) return "/placeholder-logo.svg";

    // First try to match with currentPoolData.tokens (same as title icons)
    if (currentPoolData?.tokens) {
      // Try to match by symbol
      if (positionToken.symbol) {
        const matchedToken = currentPoolData.tokens.find(token =>
          token.symbol?.toLowerCase() === positionToken.symbol?.toLowerCase()
        );
        if (matchedToken?.icon) {
          return matchedToken.icon;
        }
      }

      // Try to match by address
      if (positionToken.address) {
        const matchedToken = currentPoolData.tokens.find(token =>
          token.address?.toLowerCase() === positionToken.address?.toLowerCase()
        );
        if (matchedToken?.icon) {
          return matchedToken.icon;
        }
      }
    }

    // Fallback to the original getToken method
    if (positionToken.symbol) {
      const tokenConfig = getToken(positionToken.symbol);
      if (tokenConfig?.icon) {
        return tokenConfig.icon;
      }
    }

    return "/placeholder-logo.svg";
  };

  // Match SwapInputView defaults exactly, but 20% bigger
  const iconSize = 24;
  const overlap = 0.3 * iconSize;
  const step = iconSize - overlap;
  const hoverMargin = 0; // Disable lateral movement on hover
  const tokens = [
    { symbol: position.token0?.symbol || 'Token 0', icon: getTokenIcon(position.token0) },
    { symbol: position.token1?.symbol || 'Token 1', icon: getTokenIcon(position.token1) },
  ].filter(token => token.symbol && token.symbol !== 'Token 0' && token.symbol !== 'Token 1');

  const baseWidth = iconSize + step;

  // Ensure we have tokens before proceeding
  if (tokens.length === 0) {
    return <div className="w-8 h-8 bg-muted rounded-full" />;
  }

  // Compute boundary gaps (between token i and i+1)
  const gaps: number[] = Array(Math.max(0, tokens.length - 1)).fill(0);

  // Hover margins: symmetrical (left and right) except at edges
  // No horizontal gap changes on hover (only scale on hover)

  // Prefix sums to get per-token x offsets
  const offsets: number[] = new Array(tokens.length).fill(0);
  for (let i = 1; i < tokens.length; i++) {
    offsets[i] = offsets[i - 1] + (gaps[i - 1] || 0);
  }

  const totalExtraWidth = gaps.reduce((a, b) => a + b, 0);
  const animatedWidth = baseWidth + totalExtraWidth;

  return (
    <motion.div
      initial={false}
      className="relative flex-shrink-0"
      style={{ height: iconSize }}
      animate={{ width: animatedWidth }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
    >
      {tokens.map((token, index) => {
        const leftPos = index * step;
        const xOffset = offsets[index];

        return (
          <motion.div
            initial={false}
            key={token.symbol}
            className="absolute top-0"
            style={{
              zIndex: index + 1,
              left: `${leftPos}px`
            }}
            animate={{ x: xOffset }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            onHoverStart={() => setHoveredIndex(index)}
            onHoverEnd={() => setHoveredIndex(null)}
          >
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <motion.div
                    className="relative cursor-pointer"
                    whileHover={{ scale: 1.08 }}
                    style={{
                      padding: `${iconSize * 0.1}px`,
                      margin: `-${iconSize * 0.1}px`
                    }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  >
                    <Image
                      src={token.icon}
                      alt={token.symbol}
                      width={iconSize}
                      height={iconSize}
                      className="rounded-full bg-background"
                    />
                  </motion.div>
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                  {token.symbol}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </motion.div>
        );
      })}
    </motion.div>
  );
}

// Fees cell with batch data (precise uncollected fees)
function FeesCell({
  positionId,
  sym0,
  sym1,
  price0,
  price1,
  batchFeesData
}: {
  positionId: string;
  sym0: string;
  sym1: string;
  price0: number;
  price1: number;
  batchFeesData?: any[];
}) {
  // Find fees for this position from batch data
  const fees = React.useMemo(() => {
    if (!batchFeesData || !positionId) return null;
    return batchFeesData.find(fee => fee.positionId === positionId) || null;
  }, [batchFeesData, positionId]);

  const isLoading = !batchFeesData;

  const fmtUsd = (n: number) => {
    if (!Number.isFinite(n) || n <= 0) return '$0';
    if (n < 0.01) return '< $0.01';
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  };

  const formatTokenAmount = (amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return '0';
    if (amount < 0.001) return '< 0.001';
    return amount.toLocaleString('en-US', { maximumFractionDigits: 6, minimumFractionDigits: 0 });
  };

  if (isLoading) return (
    <span className="inline-block h-3 w-12 rounded bg-muted/40 animate-pulse align-middle" />
  );
  if (!fees) return <span className="text-muted-foreground">—</span>;

  const d0 = TOKEN_DEFINITIONS?.[sym0 as keyof typeof TOKEN_DEFINITIONS]?.decimals ?? 18;
  const d1 = TOKEN_DEFINITIONS?.[sym1 as keyof typeof TOKEN_DEFINITIONS]?.decimals ?? 18;
  let amt0 = 0;
  let amt1 = 0;
  try { amt0 = parseFloat(formatUnits(BigInt(fees.amount0), d0)); } catch {}
  try { amt1 = parseFloat(formatUnits(BigInt(fees.amount1), d1)); } catch {}
  const usd = (amt0 * (price0 || 0)) + (amt1 * (price1 || 0));
  // Match portfolio PositionCard's FeesCell: show values down to $0.01, otherwise show "< $0.01"
  if (!Number.isFinite(usd)) {
    return <span className="whitespace-nowrap text-muted-foreground">—</span>;
  }
  
  if (amt0 <= 0 && amt1 <= 0) {
    return <span className="whitespace-nowrap text-muted-foreground">{fmtUsd(usd)}</span>;
  }

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="whitespace-nowrap cursor-default hover:text-foreground transition-colors">
            {fmtUsd(usd)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" align="center" sideOffset={8} className="px-2 py-1 text-xs w-48">
          <div className="grid gap-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{sym0}</span>
              <span className="font-mono tabular-nums">
                {formatTokenAmount(amt0)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{sym1}</span>
              <span className="font-mono tabular-nums">
                {formatTokenAmount(amt1)}
              </span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function PoolDetailPage() {
  const router = useRouter();
  const params = useParams<{ poolId: string }>();
  const poolId = params?.poolId || '';
  const queryClient = useQueryClient();
  const [userPositions, setUserPositions] = useState<ProcessedPosition[]>([]);
  const [pendingNewPositions, setPendingNewPositions] = useState<Array<{
    id: string, 
    token0Symbol: string, 
    token1Symbol: string, 
    createdAt: number,
    baselineIds?: string[]
  }>>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [activeChart, setActiveChart] = useState<keyof Pick<typeof chartConfig, 'volume' | 'tvl' | 'volumeTvlRatio' | 'emaRatio' | 'dynamicFee'>>("volumeTvlRatio");
  const [isDynamicFeeModalOpen, setIsDynamicFeeModalOpen] = useState(false);
  const [hoveredFee, setHoveredFee] = useState<number | null>(null);


  const { address: accountAddress, isConnected, chainId } = useAccount();
  const { writeContract } = useWriteContract();
  const [collectHash, setCollectHash] = useState<`0x${string}` | undefined>(undefined);
  const [lastCollectPositionId, setLastCollectPositionId] = useState<string | null>(null);
  const { isLoading: isCollectConfirming, isSuccess: isCollectConfirmed } = useWaitForTransactionReceipt({ hash: collectHash });
  
  // Handle collect success
  useEffect(() => {
    if (isCollectConfirmed && collectHash && lastCollectPositionId) {
      toast.success("Fees Collected", {
        icon: <BadgeCheck className="h-4 w-4 text-green-500" />,
        action: {
          label: "View Transaction",
          onClick: () => window.open(`https://sepolia.basescan.org/tx/${collectHash}`, '_blank')
        }
      });

      // Refresh fee data for the collected position
      refreshFeesAfterTransaction(lastCollectPositionId, queryClient);

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
  const lastRevalidationRef = useRef<number>(0);
  const lastPositionRefreshRef = useRef<number>(0);
  const handledCollectHashRef = useRef<string | null>(null);
  // Tombstone store to prevent reappearance of fully withdrawn positions during subgraph lag
  const tombstonedPositionIdsRef = useRef<Record<string, number>>({});
  const TOMBSTONE_TTL_MS = 60_000; // 60s

  const addPositionTombstone = useCallback((positionId: string) => {
    if (!positionId) return;
    tombstonedPositionIdsRef.current[positionId] = Date.now();
  }, []);

  const isPositionTombstoned = useCallback((positionId: string) => {
    const ts = tombstonedPositionIdsRef.current[positionId];
    if (!ts) return false;
    if (Date.now() - ts > TOMBSTONE_TTL_MS) {
      delete tombstonedPositionIdsRef.current[positionId];
      return false;
    }
    return true;
  }, []);

  const refreshTombstonesFromFetched = useCallback((positions: ProcessedPosition[]) => {
    try {
      const present = new Set((positions || []).map(p => p.positionId));
      for (const id of Object.keys(tombstonedPositionIdsRef.current)) {
        if (!present.has(id)) delete tombstonedPositionIdsRef.current[id];
      }
    } catch {}
  }, []);

  const applyTombstones = useCallback((positions: ProcessedPosition[]) => {
    return (positions || []).filter(p => !isPositionTombstoned(p.positionId));
  }, [isPositionTombstoned]);
  
  // Balance hooks for tokens
  const { data: token0BalanceData, isLoading: isLoadingToken0Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS['aUSDC']?.address === "0x0000000000000000000000000000000000000000" 
      ? undefined 
      : TOKEN_DEFINITIONS['aUSDC']?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS['aUSDC'] },
  });

  const { data: token1BalanceData, isLoading: isLoadingToken1Balance } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS['aUSDT']?.address === "0x0000000000000000000000000000000000000000" 
      ? undefined 
      : TOKEN_DEFINITIONS['aUSDT']?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!TOKEN_DEFINITIONS['aUSDT'] },
  });

  // Helper function to get formatted display balance
  const getFormattedDisplayBalance = (numericBalance: number | undefined, tokenSymbolForDecimals: TokenSymbol): string => {
    if (numericBalance === undefined || isNaN(numericBalance)) {
      numericBalance = 0;
    }
    if (numericBalance === 0) {
      return "0.000";
    } else if (numericBalance > 0 && numericBalance < 0.001) {
      return "< 0.001";
    } else {
      const displayDecimals = 6;
      return numericBalance.toFixed(displayDecimals);
    }
  };


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

  // Determine if denomination should be flipped (same logic as InteractiveRangeChart)
  const shouldFlipDenomination = useMemo(() => {
    if (!currentPrice) return false;
    const currentPriceNum = parseFloat(currentPrice);
    if (!isFinite(currentPriceNum) || currentPriceNum <= 0) return false;
    const inversePrice = 1 / currentPriceNum;
    return inversePrice > currentPriceNum;
  }, [currentPrice]);


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


  // Token symbols for the current pool (defined after positionToModify)
  const token0Symbol = positionToModify?.token0.symbol as TokenSymbol || 'aUSDC';
  const token1Symbol = positionToModify?.token1.symbol as TokenSymbol || 'aUSDT';

  // Dynamic balances for the modal tokens (handles native vs ERC20)
  const modalToken0IsNative = !!positionToModify?.token0.address && positionToModify.token0.address.toLowerCase() === '0x0000000000000000000000000000000000000000';
  const modalToken1IsNative = !!positionToModify?.token1.address && positionToModify.token1.address.toLowerCase() === '0x0000000000000000000000000000000000000000';

  const { data: modalToken0BalanceData } = useBalance({
    address: accountAddress,
    token: modalToken0IsNative ? undefined : (positionToModify?.token0.address as `0x${string}` | undefined),
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!positionToModify?.token0.address },
  });
  const { data: modalToken1BalanceData } = useBalance({
    address: accountAddress,
    token: modalToken1IsNative ? undefined : (positionToModify?.token1.address as `0x${string}` | undefined),
    chainId,
    query: { enabled: !!accountAddress && !!chainId && !!positionToModify?.token1.address },
  });

  const displayModalToken0Balance = modalToken0BalanceData ? getFormattedDisplayBalance(parseFloat(modalToken0BalanceData.formatted), token0Symbol) : "~";
  const displayModalToken1Balance = modalToken1BalanceData ? getFormattedDisplayBalance(parseFloat(modalToken1BalanceData.formatted), token1Symbol) : "~";

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

  // Store denomination data per position ID
  const [denominationDataByPositionId, setDenominationDataByPositionId] = useState<Record<string, {
    denominationBase: string;
    minPrice: string;
    maxPrice: string;
    displayedCurrentPrice: string | null;
    feesUSD: number;
    formattedAPY: string;
    isAPYFallback: boolean;
    isLoadingAPY: boolean;
  }>>({});

  // Debounce versioning to avoid stale API results applying to current inputs
  const increaseCalcVersionRef = React.useRef(0);
  const withdrawCalcVersionRef = React.useRef(0);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    if (typeof window !== 'undefined') {
      setWindowWidth(window.innerWidth);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }
  }, []);

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



  // Memoized callback functions to prevent infinite re-renders
  const positionsWriteLockRef = useRef<number>(0);

  const refetchPositionsOnly = useCallback(async () => {
    try {
      if (Date.now() < positionsWriteLockRef.current) return null;
      if (!poolId || !isConnected || !accountAddress) return null;
      const basePoolInfo = getPoolConfiguration(poolId);
      if (!basePoolInfo) return null;
      const ids = await loadUserPositionIds(accountAddress);
      const data = await derivePositionsFromIds(accountAddress, ids);
      if (!Array.isArray(data)) return null;
      const subgraphId = (basePoolInfo.subgraphId || '').toLowerCase();
      const [poolToken0Raw, poolToken1Raw] = basePoolInfo.pair.split(' / ');
      const poolToken0 = poolToken0Raw?.trim().toUpperCase();
      const poolToken1 = poolToken1Raw?.trim().toUpperCase();
      const filtered = data.filter((pos: any) => {
        const poolMatch = subgraphId && String(pos.poolId || '').toLowerCase() === subgraphId;
        return poolMatch;
      });
      refreshTombstonesFromFetched(filtered as any);
      const updatedPositions = applyTombstones(filtered as any);
      setUserPositions(updatedPositions);
      return updatedPositions;
    } catch (e) {
      console.warn('Refetch positions failed', e);
      return null;
    }
  }, [poolId, isConnected, accountAddress]);

  // Backoff refresh for a single position after transaction
  const backoffRefreshSinglePosition = useCallback(async (positionId: string) => {
    try {
      if (!poolId || !isConnected || !accountAddress) return;

      // Prevent rapid position refreshes (cooldown: 5 seconds)
      const now = Date.now();
      if (now - lastPositionRefreshRef.current < 5000) {
        return;
      }
      lastPositionRefreshRef.current = now;

      const baseInfo = getPoolConfiguration(poolId);
      const subId = (baseInfo?.subgraphId || '').toLowerCase();
      if (!subId) return;

      // Fingerprint function to detect actual changes
      const fingerprint = (pos: ProcessedPosition) => {
        try {
          return JSON.stringify({
            id: pos.positionId,
            a0: pos.token0.amount,
            a1: pos.token1.amount,
            l: (pos as any)?.liquidity || (pos as any)?.liquidityRaw,
            lo: pos.tickLower,
            up: pos.tickUpper
          });
        } catch { return ''; }
      };

      const baseline = userPositions.find(p => p.positionId === positionId);
      const baselineFp = baseline ? fingerprint(baseline) : '';

      // Set optimistic updating flag
      setUserPositions(prev => prev.map(p =>
        p.positionId === positionId
          ? { ...p, isOptimisticallyUpdating: true }
          : p
      ));

      // Retry with backoff: 0ms, 2s, 5s, 10s, 15s
      const result = await RetryUtility.execute(
        async () => {
          if (!accountAddress) throw new Error('Missing account');

          // Use gated loader to avoid stale cache writes
          const ids = await loadUserPositionIds(accountAddress);
          const data = await derivePositionsFromIds(accountAddress, ids);
          const filtered = data.filter((pos: any) =>
            String(pos?.poolId || '').toLowerCase() === subId
          );

          const updated = filtered.find(p => p.positionId === positionId);
          if (!updated) throw new Error('Position not found');

          const nextFp = fingerprint(updated);

          // Only update if data actually changed
          if (nextFp !== baselineFp) {
            refreshTombstonesFromFetched(filtered as any);
            const updatedPositions = applyTombstones(filtered as any);
            setUserPositions(updatedPositions);

            // Update the modal's selected position if it's open
            setSelectedPositionForDetails(prev =>
              prev?.positionId === positionId ? updated : prev
            );

            return updated; // Success
          }

          throw new Error('No changes detected yet');
        },
        {
          attempts: 5,
          backoffStrategy: 'custom',
          baseDelay: 1000,
          customDelays: [0, 2000, 5000, 10000, 15000],
          shouldRetry: (attempt, error) => {
            return !error.message.includes('Invalid response format');
          },
          throwOnFailure: false // Silent failure is ok
        }
      );

      // After all attempts, remove optimistic updating flag
      setUserPositions(prev => prev.map(p =>
        p.positionId === positionId
          ? { ...p, isOptimisticallyUpdating: undefined }
          : p
      ));

    } catch (error) {
      console.warn('Backoff refresh failed for position:', positionId, error);
      // Always clear optimistic flag
      setUserPositions(prev => prev.map(p =>
        p.positionId === positionId
          ? { ...p, isOptimisticallyUpdating: undefined }
          : p
      ));
    }
  }, [poolId, isConnected, accountAddress, userPositions]);

  const onLiquidityBurnedCallback = useCallback(() => {
    if (pendingActionRef.current?.type !== 'burn') return; // ignore stale callback
    toast.success("Position Closed", { icon: <BadgeCheck className="h-4 w-4 text-green-500" /> });
    setShowBurnConfirmDialog(false);
    setPositionToBurn(null);
    pendingActionRef.current = null;
    try { if (accountAddress) loadUserPositionIds(accountAddress).then((ids)=>derivePositionsFromIds(accountAddress, ids)); } catch {}
  }, [accountAddress]);



  // Note: Hook initializations moved after callback definitions

  // Track compound intent so we can suppress page-level success toast

  // Silent backoff refresh for positions - only updates when new positions are detected
  const silentBackoffRefreshPositions = useCallback(async (removeSkeletonsWhenFound = false) => {
    try {
      if (!poolId || !isConnected || !accountAddress) return;
      
      // Prevent rapid silent position refreshes (cooldown: 5 seconds)
      const now = Date.now();
      if (now - lastPositionRefreshRef.current < 5000) {
        return;
      }
      lastPositionRefreshRef.current = now;
      
      const baseInfo = getPoolConfiguration(poolId);
      const subId = (baseInfo?.subgraphId || '').toLowerCase();
      if (!subId) return;

      const fingerprint = (arr: ProcessedPosition[]) => {
        try {
          return JSON.stringify(arr.map(p => ({ id: p.positionId, a0: p.token0.amount, a1: p.token1.amount, l: (p as any)?.liquidity, lo: p.tickLower, up: p.tickUpper })));
        } catch { return ''; }
      };
      const baseline = userPositions || [];
      const baselineFp = fingerprint(baseline);
      const baselineIds = new Set(baseline.map(p => p.positionId));

      // DO NOT show loading state - this is silent
      await RetryUtility.execute(
        async () => {
          if (!accountAddress) throw new Error('Missing account');
          // Use gated loader to avoid stale cache writes
          const ids = await loadUserPositionIds(accountAddress);
          const data = await derivePositionsFromIds(accountAddress, ids);
          const filtered = data.filter((pos: any) => String(pos?.poolId || '').toLowerCase() === subId);
          const nextFp = fingerprint(filtered);

          // Check for new position IDs (more reliable than count comparison)
          const newPositions = filtered.filter(p => !baselineIds.has(p.positionId));
          const hasNewPositions = newPositions.length > 0;

          // Only update if we detected new positions (or significant changes after some retries)
          if (nextFp !== baselineFp && hasNewPositions) {
            if (removeSkeletonsWhenFound && hasNewPositions) {
              refreshTombstonesFromFetched(filtered as any);
              setUserPositions(applyTombstones(filtered as any));
            } else {
              refreshTombstonesFromFetched(filtered as any);
              setUserPositions(applyTombstones(filtered as any));
            }
            return filtered; // Success
          }

          throw new Error('No new positions detected');
        },
        {
          attempts: 5,
          backoffStrategy: 'custom',
          baseDelay: 1000, // Not used with custom delays, but required by interface
          customDelays: [0, 2000, 5000, 10000, 15000],
          shouldRetry: (attempt, error) => {
            // Continue retrying unless we have a fundamental error
            return !error.message.includes('Invalid response format');
          },
          throwOnFailure: false // Silent failure is ok
        }
      );
      
      // After trying all delays, remove skeletons anyway to prevent infinite loading
      if (removeSkeletonsWhenFound) {
        setTimeout(() => setPendingNewPositions([]), 1000);
      }
    } catch (error) {
      console.warn('Silent position refresh failed:', error);
    }
  }, [poolId, isConnected, accountAddress, userPositions]);

  // Backoff refresh for positions after liquidity actions (independent of chart backoff)
  const backoffRefreshPositions = useCallback(async () => {
    try {
      if (!poolId || !isConnected || !accountAddress) return;
      
      // Prevent rapid position refreshes (cooldown: 10 seconds)
      const now = Date.now();
      if (now - lastPositionRefreshRef.current < 10000) {
        return;
      }
      lastPositionRefreshRef.current = now;
      
      const baseInfo = getPoolConfiguration(poolId);
      const subId = (baseInfo?.subgraphId || '').toLowerCase();
      if (!subId) return;

      const fingerprint = (arr: ProcessedPosition[]) => {
        try {
          return JSON.stringify(arr.map(p => ({ id: p.positionId, a0: p.token0.amount, a1: p.token1.amount, l: (p as any)?.liquidity, lo: p.tickLower, up: p.tickUpper })));
        } catch { return ''; }
      };
      const baseline = userPositions || [];
      const baselineFp = fingerprint(baseline);

      setIsLoadingPositions(true);
      // prevent immediate refetch overwrite for ~1.5s after an authoritative update
      positionsWriteLockRef.current = Date.now() + 1500;

      const result = await RetryUtility.execute(
        async () => {
          if (!accountAddress) throw new Error('Missing account');
          // Use gated loader to avoid stale cache writes
          const ids = await loadUserPositionIds(accountAddress);
          const data = await derivePositionsFromIds(accountAddress, ids);
          const filtered = data.filter((pos: any) => String(pos?.poolId || '').toLowerCase() === subId);
          const nextFp = fingerprint(filtered);
          if (nextFp !== baselineFp) {
            setUserPositions(filtered);
            return filtered; // Success
          }
          throw new Error('No position changes detected');
        },
        {
          attempts: 4,
          backoffStrategy: 'custom',
          baseDelay: 1000, // Not used with custom delays, but required by interface
          customDelays: [0, 2000, 5000, 10000],
          shouldRetry: (attempt, error) => {
            // Continue retrying unless we have a fundamental error
            return !error.message.includes('Invalid response format');
          },
          throwOnFailure: false // Don't throw, just finish
        }
      );

      // Handle successful result
      if (result.success && result.data) {
        setUserPositions(result.data);
      }
    } finally {
      setIsLoadingPositions(false);
    }
  }, [poolId, isConnected, accountAddress, userPositions]);

  // Note: useEffect moved after hook initialization



  // Fetch user positions for this pool and pool stats
  const fetchPageData = useCallback(async (force?: boolean, skipPositions?: boolean, keepLoading?: boolean) => {
    if (!poolId) return;
    const poolInfo = getPoolConfiguration(poolId);
    if (!poolInfo) return;

    if (!skipPositions && isConnected && accountAddress) {
      setIsLoadingPositions(true);
      (async () => {
        let allUserPositions: any[] = [];
        try {
          const ids = await loadUserPositionIds(accountAddress);
          allUserPositions = await derivePositionsFromIds(accountAddress, ids);
        } catch (error) {
          console.error("Failed to derive user positions:", error);
          allUserPositions = [];
        }
        if (allUserPositions && allUserPositions.length > 0 && poolInfo) {
          const subgraphId = (poolInfo.subgraphId || '').toLowerCase();
          const filteredPositions = allUserPositions.filter(pos => String(pos.poolId || '').toLowerCase() === subgraphId);
          setUserPositions(filteredPositions);
        } else {
          setUserPositions([]);
        }
        setIsLoadingPositions(false);
      })();
    } else if (!skipPositions && (!isConnected || !accountAddress)) {
      setUserPositions([]);
      setIsLoadingPositions(false);
    }

    // Only show loading on initial load (when no chart data exists)
    if (apiChartData.length === 0) {
      setIsLoadingChartData(true);
    }

    // Declare variables that will be used throughout the function
    let tvlFromHeader = 0;
    // If a recent swap was recorded for this pool, force a refresh once and clear the hint
    try {
      const hintKey = `recentSwap:${String(poolId).toLowerCase()}`;
      const hint = SafeStorage.get(hintKey);
      if (hint) {
        force = true;
        SafeStorage.remove(hintKey);
      }
    } catch {}
    // Load daily series for volume & TVL (excluding today), and fee/targets; then merge
    ;(async () => {
      try {
        const basePoolInfoTmp = getPoolConfiguration(poolId);
        const subgraphIdForHist = basePoolInfoTmp?.subgraphId || '';
        if (!subgraphIdForHist) throw new Error('Missing subgraph id for pool');
        const targetDays = 60;

        const todayKey = new Date().toISOString().split('T')[0];

        // Centralized retry utility for chart data fetching

        // Enhanced validation for chart data to ensure completeness and validity
        const validateChartData = (json: any, dataType: 'tvl' | 'volume' | 'fees'): boolean => {
          if (!json) return false;

          if (dataType === 'fees') {
            return Array.isArray(json) && json.length > 0;
          }

          const data = json?.data;
          if (!Array.isArray(data) || data.length === 0) return false;

          // For historical data (tvl, volume), we don't require today's data as it's added client-side
          // But we do require at least some recent data points
          if (dataType === 'tvl' || dataType === 'volume') {
            const today = new Date();
            const todayKey = today.toISOString().split('T')[0];

            // Calculate yesterday properly (avoid timezone issues)
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayKey = yesterday.toISOString().split('T')[0];

            // Check if we have data for yesterday or today (indicating recent data)
            const hasRecentData = data.some(item => {
              const itemDate = String(item?.date || '');
              return itemDate === yesterdayKey || itemDate === todayKey;
            });

            // For TVL data, ensure we have reasonable values (not all zeros)
            if (dataType === 'tvl') {
              const nonZeroValues = data.filter(item => Number(item?.tvlUSD || 0) > 0);
              // Relax validation: accept if we have any non-zero historical TVL OR a recent data point
              return nonZeroValues.length > 0 || hasRecentData;
            }

            // For volume data, accept if we have recent data or at least a small history
            return hasRecentData || data.length >= 7;
          }

          return true;
        };

        // Use version-based cache busting for chart data
        let chartVersionParam = '';
        if (force) {
          try {
            const chartVersion = SafeStorage.get('chart-cache-version');
            chartVersionParam = chartVersion ? `&v=${chartVersion}` : `&bust=${Date.now()}`;
          } catch {
            chartVersionParam = `&bust=${Date.now()}`;
          }
        }

        // Fetch chart data with centralized retry utility
        const feeResult = await RetryUtility.fetchJson(
          `/api/liquidity/get-historical-dynamic-fees?poolId=${encodeURIComponent(subgraphIdForHist)}&days=${targetDays}${chartVersionParam}`,
          {
            attempts: 4,
            baseDelay: 700,
            validate: (j) => validateChartData(j, 'fees'),
            throwOnFailure: true
          }
        );

        const tvlResult = await RetryUtility.fetchJson(
          `/api/liquidity/chart-tvl?poolId=${encodeURIComponent(poolId)}&days=${targetDays}${chartVersionParam}`,
          {
            attempts: 4,
            baseDelay: 700,
            validate: (j) => validateChartData(j, 'tvl'),
            throwOnFailure: true
          }
        );

        const volResult = await RetryUtility.fetchJson(
          `/api/liquidity/chart-volume?poolId=${encodeURIComponent(poolId)}&days=${targetDays}${chartVersionParam}`,
          {
            attempts: 4,
            baseDelay: 700,
            validate: (j) => validateChartData(j, 'volume'),
            throwOnFailure: true
          }
        );

        const feeJson = feeResult.data!;
        const tvlJson = tvlResult.data!;
        const volJson = volResult.data!;
        // No ad-hoc quick retries; handled by RetryUtility

        // Base date set from separate series (both exclude today)
        const tvlArr: Array<{ date: string; tvlUSD?: number }> = Array.isArray(tvlJson?.data) ? tvlJson.data : [];
        const volArr: Array<{ date: string; volumeUSD?: number }> = Array.isArray(volJson?.data) ? volJson.data : [];
        const todayKeyLocal = new Date().toISOString().split('T')[0];
        const allDates = Array.from(new Set<string>([
          ...tvlArr.map(d => String(d?.date || '')),
          ...volArr.map(d => String(d?.date || '')),
        ])).filter(Boolean).sort((a, b) => a.localeCompare(b));

        const tvlByDate = new Map<string, number>();
        for (const d of tvlArr) tvlByDate.set(String(d.date), Number(d?.tvlUSD) || 0);
        const volByDate = new Map<string, number>();
        for (const d of volArr) volByDate.set(String(d.date), Number(d?.volumeUSD) || 0);

        // Map fee events to per-day overlays over the same date domain
        const feeByDate = new Map<string, { ratio: number; ema: number; feePct: number }>();
        const events: any[] = Array.isArray(feeJson) ? feeJson : [];
        const evAsc = [...events].sort((a, b) => Number(a?.timestamp || 0) - Number(b?.timestamp || 0));
        const scaleRatio = (val: any): number => {
          const n = typeof val === 'string' ? Number(val) : (typeof val === 'number' ? val : 0);
          if (!Number.isFinite(n)) return 0;
          if (Math.abs(n) >= 1e12) return n / 1e18;
          if (Math.abs(n) >= 1e6) return n / 1e6;
          if (Math.abs(n) >= 1e4) return n / 1e4;
          return n;
        };
        // Ensure we compute overlays for today as well
        const datesForOverlay = Array.from(new Set<string>([...allDates, todayKeyLocal])).sort((a,b) => a.localeCompare(b));
        let ei = 0, curFeePct = 0, curRatio = 0, curEma = 0;
        for (const dateStr of datesForOverlay) {
          const endTs = Math.floor(new Date(`${dateStr}T23:59:59Z`).getTime() / 1000);
          while (ei < evAsc.length && Number(evAsc[ei]?.timestamp || 0) <= endTs) {
            const e = evAsc[ei];
            const bps = Number(e?.newFeeBps ?? e?.newFeeRateBps ?? 0);
            curFeePct = Number.isFinite(bps) ? (bps / 10_000) : curFeePct;
            curRatio = scaleRatio(e?.currentRatio); // Normalized in API (Activity)
            curEma = scaleRatio(e?.newTargetRatio); // Target
            ei++;
          }
          feeByDate.set(dateStr, { ratio: curRatio, ema: curEma, feePct: curFeePct });
        }

        // Build merged series from separate endpoints (no today entry here)
        const merged: ChartDataPoint[] = allDates.map((k) => {
          const v = volByDate.get(k) || 0;
          const t = tvlByDate.get(k) || 0;
          const f = feeByDate.get(k);
          return {
            date: k,
            volumeUSD: v,
            tvlUSD: t,
            volumeTvlRatio: f?.ratio ?? 0,
            emaRatio: f?.ema ?? 0,
            dynamicFee: f?.feePct ?? 0,
          } as ChartDataPoint;
        });

        // Volume API now includes today's partial data, so merged already has today's volume
        let finalMerged = merged;

        // Update today's TVL with real-time data from header stats
        const hasToday = finalMerged.some(d => d.date === todayKeyLocal);
        const overlayToday = feeByDate.get(todayKeyLocal);
        if (hasToday) {
          // Update existing today point with current TVL and overlay
          finalMerged = finalMerged.map(d =>
            d.date === todayKeyLocal
              ? {
                  ...d,
                  tvlUSD: Number.isFinite(tvlFromHeader) && tvlFromHeader > 0 ? tvlFromHeader : d.tvlUSD,
                  volumeTvlRatio: overlayToday?.ratio ?? d.volumeTvlRatio ?? 0,
                  emaRatio: overlayToday?.ema ?? d.emaRatio ?? 0,
                  dynamicFee: overlayToday?.feePct ?? d.dynamicFee ?? 0,
                }
              : d
          );
        }

        setApiChartData(finalMerged);
        // Keep header TVL strictly in sync with the chart's latest point
        try {
          const latest = finalMerged.find(d => d.date === todayKeyLocal) || finalMerged[finalMerged.length - 1];
          const latestTvl = Number(latest?.tvlUSD || 0);
          if (Number.isFinite(latestTvl)) {
            setCurrentPoolData(prev => prev ? { ...prev, liquidity: formatUSD(latestTvl) } : prev);
          }
        } catch {}
        // Client no longer writes chart to local cache; rely on server cache for sharing across users
        // Chart data loaded successfully; end loading state unless we are in a controlled backoff
        if (!keepLoading) setIsLoadingChartData(false);
      } catch (error: any) {
        console.error('Failed to fetch daily chart series:', error);
        const errorMessage = error?.message || String(error);
        toast.error('Chart Data Failed', { 
          icon: <OctagonX className="h-4 w-4 text-red-500" />, 
          description: errorMessage,
          action: {
            label: "Copy Error",
            onClick: () => navigator.clipboard.writeText(errorMessage)
          }
        });
        // End loading unless caller wants to keep spinner (e.g., backoff window)
        if (!keepLoading) setIsLoadingChartData(false);
      }
    })();

    const poolInfoLocal = getPoolConfiguration(poolId);
    if (!poolInfoLocal) {
      toast.error("Pool Not Found", {
        icon: <OctagonX className="h-4 w-4 text-red-500" />,
        description: "Pool configuration not found for this ID.",
        action: {
          label: "Open Ticket",
          onClick: () => window.open('https://discord.gg/alphix', '_blank')
        }
      });
      router.push('/liquidity');
      return;
    }

    // Use the subgraph ID from the pool configuration for API calls
    const apiPoolIdToUse = poolInfoLocal.subgraphId; 

    // Pool state now handled by usePoolState hook at component level

    // 1. Get Pool Stats from shared cache or fetch fresh
    let poolStats: Partial<Pool> | null = null;
    try {
      let params = '';
      if (force) {
        // Try to use cache version first, fallback to bust
        try {
          const cacheVersion = SafeStorage.get('pools-cache-version');
          params = cacheVersion ? `?v=${cacheVersion}` : `?bust=${Date.now()}`;
        } catch {
          params = `?bust=${Date.now()}`;
        }
      }

      // Use versioned URL to avoid stale cache
      const versionResponse = await fetch('/api/cache-version', { cache: 'no-store' as any } as any);
      const versionData = await versionResponse.json();
      const resp = await fetch(versionData.cacheUrl);
      if (resp.ok) {
        const data = await resp.json();
        const poolIdLc = String(apiPoolIdToUse || '').toLowerCase();
        const match = Array.isArray(data?.pools) ? data.pools.find((p: any) => String(p.poolId || '').toLowerCase() === poolIdLc) : null;
        if (match) {
          const tvlUSD = Number(match.tvlUSD) || 0;
          poolStats = {
            tvlUSD,
            volume24hUSD: Number(match.volume24hUSD) || 0,
            tvlYesterdayUSD: Number(match.tvlYesterdayUSD) || 0,
            volumePrev24hUSD: Number(match.volumePrev24hUSD) || 0,
          } as any;
          // Also set tvlFromHeader to avoid the separate call above
          tvlFromHeader = tvlUSD;
        }
      }
    } catch (error) {
      console.error(`Error loading stats for pool ${apiPoolIdToUse}:`, error);
    }

    let dynamicFeeBps: number | null = null;
    try {
      dynamicFeeBps = await getPoolFeeBps(apiPoolIdToUse);
    } catch (e) {
      dynamicFeeBps = null;
    }

    const feeRate = (typeof dynamicFeeBps === 'number' && dynamicFeeBps >= 0) ? dynamicFeeBps / 10_000 : 0;
    const vol24 = Number(poolStats?.volume24hUSD || 0);
    const tvlNow = Number(poolStats?.tvlUSD || 0);
    const fees24hUSD = vol24 * feeRate;

    // Calculate APY directly: (Daily Fees * 365) / TVL * 100
    let calculatedApr = '0.00%';
    if (tvlNow > 0 && !isNaN(fees24hUSD) && isFinite(fees24hUSD)) {
      const annualFees = fees24hUSD * 365;
      const apy = (annualFees / tvlNow) * 100;
      
      // Format APY
      if (isNaN(apy) || !isFinite(apy)) {
        calculatedApr = '0.00%';
      } else if (apy >= 1000) {
        calculatedApr = `${Math.round(apy)}%`;
      } else if (apy >= 100) {
        calculatedApr = `${apy.toFixed(0)}%`;
      } else if (apy >= 10) {
        calculatedApr = `${apy.toFixed(1)}%`;
      } else if (apy > 0) {
        calculatedApr = `${apy.toFixed(2)}%`;
      } else {
        calculatedApr = '0.00%';
      }
    }

    const combinedPoolData = {
        ...poolInfo,
        ...(poolStats || {}),
        apr: calculatedApr,
        dynamicFeeBps: dynamicFeeBps,
        tickSpacing: getPoolById(poolId)?.tickSpacing || DEFAULT_TICK_SPACING,
        volume24h: isFinite(vol24) ? formatUSD(vol24) : poolInfo.volume24h,
        fees24h: isFinite(fees24hUSD) ? formatUSD(fees24hUSD) : poolInfo.fees24h,
        liquidity: isFinite(tvlNow) ? formatUSD(tvlNow) : poolInfo.liquidity,
        highlighted: false,
    } as PoolDetailData;

    // Set pool data immediately
    setCurrentPoolData(combinedPoolData);
  }, [poolId, isConnected, accountAddress, router]);

  // Simple refresh function that adds skeleton and starts aggressive position polling
  const refreshAfterLiquidityAddedWithSkeleton = useCallback(async (token0Symbol?: string, token1Symbol?: string) => {
    // Prevent duplicate calls within 2 seconds
    const now = Date.now();
    const timeSinceLastCall = now - (refreshAfterLiquidityAddedWithSkeleton as any).lastCallTime;
    if ((refreshAfterLiquidityAddedWithSkeleton as any).lastCallTime && timeSinceLastCall < 2000) {
      return;
    }
    (refreshAfterLiquidityAddedWithSkeleton as any).lastCallTime = now;

    // 1. Immediately add skeleton if we have token info
    if (token0Symbol && token1Symbol) {
      const skeletonId = `skeleton-${Date.now()}`;
      const createdAt = Date.now();
      // Capture current baseline at the time of skeleton creation, not at callback creation
      const currentBaselineIds = userPositions.map(p => p.positionId);

      setPendingNewPositions(prev => {
        const newSkeletons = [...prev, {
          id: skeletonId,
          token0Symbol,
          token1Symbol,
          createdAt,
          baselineIds: currentBaselineIds
        }];
        return newSkeletons;
      });
    }

    // 2. Start aggressive position polling with retries and guaranteed invalidation
    aggressivePositionRefresh();
  }, [userPositions]);

  // Aggressive position refresh with guaranteed cache invalidation and retries
  const aggressivePositionRefresh = useCallback(async () => {
    if (!poolId || !isConnected || !accountAddress) return;

    const basePoolInfo = getPoolConfiguration(poolId);
    if (!basePoolInfo) return;
    const subId = (basePoolInfo.subgraphId || '').toLowerCase();
    const baselineCount = userPositions.length;

    try {
      // Immediate cache invalidation to prevent stale data
      invalidateUserPositionIdsCache(accountAddress);
      
      // Poll with retries until we get NEW positions
      let attempts = 0;
      const maxAttempts = 10;
      const pollInterval = 1500; // 1.5s between attempts
      
      const pollForNewPositions = async (): Promise<boolean> => {
        attempts++;

        try {
          // Force fresh cache invalidation each attempt
          invalidateUserPositionIdsCache(accountAddress);

          // Load fresh position IDs
          const ids = await loadUserPositionIds(accountAddress);

          // Derive position data
          const allDerived = await derivePositionsFromIds(accountAddress, ids);
          const filtered = allDerived.filter((pos: any) => String(pos.poolId || '').toLowerCase() === subId);

          // Success condition: we have MORE positions than baseline OR we have validated new position data
          const hasNewPosition = filtered.length > baselineCount;
          const hasValidatedNewPosition = filtered.some(p =>
            !userPositions.some(existing => existing.positionId === p.positionId) &&
            p.token0?.amount !== undefined &&
            p.token1?.amount !== undefined &&
            p.tickLower !== undefined &&
            p.tickUpper !== undefined
          );

          if (hasNewPosition || hasValidatedNewPosition) {
            setUserPositions(filtered);
            setPendingNewPositions([]);
            return true;
          }

          return false;
        } catch (error) {
          console.warn(`[AggressiveRefresh] Attempt ${attempts} failed:`, error);
          return false;
        }
      };
      
      // Initial attempt
      const success = await pollForNewPositions();
      if (success) return;
      
      // Retry polling if initial attempt failed
      for (let i = 1; i < maxAttempts; i++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        const success = await pollForNewPositions();
        if (success) return;
      }
      
      // Fallback: clear skeletons even if we didn't find new positions
      setPendingNewPositions([]);

    } catch (error) {
      console.error('[AggressiveRefresh] Complete failure:', error);
      setPendingNewPositions([]);
    }
  }, [poolId, isConnected, accountAddress, userPositions]);


  // Post-mutation window to treat zero-like responses as transient
  const lastMutationAtRef = useRef<number>(0);
  const baselineTvlBeforeMutationRef = useRef<number | null>(null);
  const lastGoodStatsRef = useRef<{ tvlUSD: number; volume24hUSD: number } | null>(null);
  const setPostMutationWindow = () => { lastMutationAtRef.current = Date.now(); };
  const isInPostMutationWindow = () => Date.now() - lastMutationAtRef.current < 60_000; // 60s window


  // Simple fetch wrapper - no more complex backoff logic
  const fetchWithBackoffIfNeeded = async (force?: boolean, skipPositions?: boolean) => {
    await fetchPageData(true, skipPositions);
  };

  const refreshAfterMutation = useCallback(async (info?: { txHash?: `0x${string}`; blockNumber?: bigint }) => {
    // This function orchestrates the entire post-transaction refresh sequence.
    if (!poolId || !isConnected || !accountAddress) {
      return;
    }

    try {
      const targetBlock = info?.blockNumber ?? await publicClient.getBlockNumber();

      const barrier = waitForSubgraphBlock(Number(targetBlock), { timeoutMs: 45000, minWaitMs: 3000, maxIntervalMs: 3000 });
      if (accountAddress) setIndexingBarrier(accountAddress, barrier);
      await barrier;

      // Additional delay to ensure subgraph has fully processed the transaction
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Trigger server revalidation
      try {
        const revalidateResp = await fetch('/api/internal/revalidate-pools', { method: 'POST' });
        const revalidateData = await revalidateResp.json();
        
        // Store cache version for subsequent fetches
        if (revalidateData.cacheVersion) {
          SafeStorage.set('pools-cache-version', revalidateData.cacheVersion.toString());
        }
        
        // Set hint for list page to refetch
        SafeStorage.set('cache:pools-batch:invalidated', 'true');
      } catch (error) {
        console.error('[refreshAfterMutation] Failed to revalidate server cache:', error);
      }

      // Refresh pool data (TVL, fees) - critical for withdrawals
      await fetchWithBackoffIfNeeded(true, false); // Force refresh, include positions

      // Canonical positions refresh: invalidate and fetch fresh ids
      if (accountAddress) {
        invalidateUserPositionIdsCache(accountAddress);
        const ids = await loadUserPositionIds(accountAddress);
        const allDerived = await derivePositionsFromIds(accountAddress, ids);
        const subId = (getPoolConfiguration(poolId)?.subgraphId || '').toLowerCase();
        const filtered = allDerived.filter((pos: any) => String(pos.poolId || '').toLowerCase() === subId);
        setUserPositions(filtered);
      }

      // Clear any optimistic loading states
      setUserPositions(prev => prev.map(p => ({ ...p, isOptimisticallyUpdating: undefined })));

      // Clear optimistically cleared fees since fresh data has been loaded
      setOptimisticallyClearedFees(new Set());

      // Notify other components/pages of position changes
      if (accountAddress) {
        prefetchService.notifyPositionsRefresh(accountAddress, 'liquidity-withdrawn');
      }
      
    } catch (error) {
      console.error('[refreshAfterMutation] failed:', error);
      
      // Clear optimistic states on error too
      setUserPositions(prev => prev.map(p => ({ ...p, isOptimisticallyUpdating: undefined })));
      setOptimisticallyClearedFees(new Set());
    } finally {
      // No chart loading state needed - chart data handled reactively
    }
  }, [poolId, isConnected, accountAddress, fetchWithBackoffIfNeeded]);

  // Refresh only a single position without affecting other positions
  const refreshSinglePosition = useCallback(async (positionId: string) => {
    if (!accountAddress) return;

    try {
      // Fetch updated data for just this position
      const updatedPositions = await derivePositionsFromIds(accountAddress, [positionId]);
      const updatedPosition = updatedPositions[0];
      
      if (updatedPosition) {
        // Update only this position in the array, keeping others untouched
        setUserPositions(prev => prev.map(p => 
          p.positionId === positionId 
            ? { ...updatedPosition, isOptimisticallyUpdating: undefined }
            : p
        ));
      } else {
        // If position not found, just clear loading state
        setUserPositions(prev => prev.map(p => 
          p.positionId === positionId
            ? { ...p, isOptimisticallyUpdating: undefined }
            : p
        ));
      }
    } catch (error) {
      console.error('[refreshSinglePosition] failed:', error);
      // Clear loading state on error
      setUserPositions(prev => prev.map(p => 
        p.positionId === positionId
          ? { ...p, isOptimisticallyUpdating: undefined }
          : p
      ));
    }
  }, [accountAddress]);

  // Refresh for position increases - similar to withdrawal with longer delays and fee clearing
  const refreshAfterIncrease = useCallback(async (info?: { txHash?: `0x${string}`; blockNumber?: bigint }) => {
    if (!poolId || !isConnected || !accountAddress) return;

    try {
      const targetBlock = info?.blockNumber ?? await publicClient.getBlockNumber();

      const barrier = waitForSubgraphBlock(Number(targetBlock), { timeoutMs: 45000, minWaitMs: 3000, maxIntervalMs: 3000 });
      if (accountAddress) setIndexingBarrier(accountAddress, barrier);
      await barrier;

      // Additional delay to ensure subgraph has fully processed the transaction
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Trigger server revalidation
      try {
        const revalidateResp = await fetch('/api/internal/revalidate-pools', { method: 'POST' });
        const revalidateData = await revalidateResp.json();
        
        if (revalidateData.cacheVersion) {
          SafeStorage.set('pools-cache-version', revalidateData.cacheVersion.toString());
        }
        SafeStorage.set('cache:pools-batch:invalidated', 'true');
      } catch (error) {
        console.error('[refreshAfterIncrease] Failed to revalidate server cache:', error);
      }

      await fetchWithBackoffIfNeeded(true, false); // Force refresh, include positions

      // Refresh user positions to get updated data including fees
      if (accountAddress) {
        invalidateUserPositionIdsCache(accountAddress);
        const refreshedIds = await loadUserPositionIds(accountAddress);
        if (refreshedIds && refreshedIds.length > 0) {
          const allDerived = await derivePositionsFromIds(accountAddress, refreshedIds);
          const subId = poolId.toLowerCase();
          const filtered = allDerived.filter((pos: any) => {
            const posPoolId = String(pos.poolId || '').toLowerCase();
            return posPoolId === subId;
          });
          if (filtered.length > 0) {
            setUserPositions(filtered);
          }
        }
      }

      // Clear any optimistic loading states
      setUserPositions(prev => prev.map(p => ({ ...p, isOptimisticallyUpdating: undefined })));

      // Clear optimistically cleared fees since fresh data has been loaded
      setOptimisticallyClearedFees(new Set());

      // Notify other components/pages of position changes
      if (accountAddress) {
        prefetchService.notifyPositionsRefresh(accountAddress, 'liquidity-added');
      }
      
    } catch (error) {
      console.error('[refreshAfterIncrease] failed:', error);
      
      // Clear optimistic states on error too
      setUserPositions(prev => prev.map(p => ({ ...p, isOptimisticallyUpdating: undefined })));
      setOptimisticallyClearedFees(new Set());
    } finally {
      // No chart loading state needed - chart data handled reactively
    }
  }, [poolId, isConnected, accountAddress, fetchWithBackoffIfNeeded]);

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

    if (pendingActionRef.current?.type !== 'decrease' && pendingActionRef.current?.type !== 'withdraw') {
      return;
    }

    const closing = info?.isFullBurn ?? isFullBurn; // Use info from transaction or fallback to old modal state
    
    // IMMEDIATE OPTIMISTIC UPDATES (happen with toast)
    if (positionToBurn) {
      if (closing) {
        // For full burns: immediately remove position from UI
        const positionValue = calculatePositionUsd(positionToBurn);
        setUserPositions(prev => prev.filter(p => p.positionId !== positionToBurn.positionId));
      } else {
        // For partial withdrawals: show loading state and clear fees optimistically
        setUserPositions(prev => prev.map(p => 
          p.positionId === positionToBurn.positionId 
            ? { 
                ...p, 
                isOptimisticallyUpdating: true,
                // Optimistically clear fees after withdrawal
                fees: {
                  amount0: '0',
                  amount1: '0',
                  totalValueUSD: 0
                }
              } 
            : p
        ));
        
        // Also add to optimistically cleared fees set
        setOptimisticallyClearedFees(prev => new Set(prev).add(positionToBurn.positionId));
      }
    }
    
    toast.success(closing ? "Position Closed" : "Liquidity Decreased", { 
      icon: <BadgeCheck className="h-4 w-4 text-green-500" />,
      description: closing ? `Position successfully closed` : `Liquidity successfully decreased`,
      action: {
        label: "View Transaction",
        onClick: () => window.open(`https://sepolia.basescan.org/tx/${info.txHash}`, '_blank')
      }
    });
    // Don't close or clear position here - let the modal's success view show
    pendingActionRef.current = null;

    // IMMEDIATE refetch for withdrawals - fees are critical and must be fresh
    refreshAfterMutation(info);
  }, [isFullBurn, refreshAfterMutation, positionToBurn, calculatePositionUsd, currentPoolData]);

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
          onClick: () => window.open(`https://sepolia.basescan.org/tx/${info.txHash}`, '_blank')
        } : undefined
      });
    },
  });

  // Reset transaction states when withdraw modal opens to prevent stale state
  useEffect(() => {
    if (showBurnConfirmDialog) {
      console.log('[DEBUG] Withdraw modal opened, resetting transaction states');
      resetDecreaseLiquidity();
    }
  }, [showBurnConfirmDialog, resetDecreaseLiquidity]);

  // Reset transaction states when increase modal opens to prevent stale state
  useEffect(() => {
    if (showIncreaseModal) {
      resetIncreaseLiquidity();
    }
  }, [showIncreaseModal, resetIncreaseLiquidity]);

  // Backup skeleton removal - only if aggressive refresh hasn't cleared them after 20 seconds
  useEffect(() => {
    if (pendingNewPositions.length === 0) return;

    // Find the oldest pending skeleton
    const oldestSkeleton = pendingNewPositions.reduce((oldest, current) =>
      current.createdAt < oldest.createdAt ? current : oldest
    );

    // If oldest skeleton is more than 20 seconds old, clear all skeletons as backup
    const age = Date.now() - oldestSkeleton.createdAt;
    if (age > 20000) { // 20 seconds
      console.warn('[SkeletonBackup] Clearing stale skeletons after 20s timeout');
      setPendingNewPositions([]);
    }
  }, [pendingNewPositions]);

  // Optimized: Single call per pool load
  useEffect(() => {
    // Only fetch if we have poolId and no chart data yet
    if (poolId && apiChartData.length === 0) {
      fetchPageData();
    }
  }, [poolId]); // Only depend on poolId to avoid excessive calls

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

  // Calculate total liquidity value
  const totalLiquidity = userPositions.reduce((sum, pos) => sum + calculatePositionUsd(pos), 0);

  // Handle withdraw position
  const handleBurnPosition = (position: ProcessedPosition) => {
    if (!position.positionId || !position.token0.symbol || !position.token1.symbol) {
      toast.error("Invalid Position", { 
        icon: <OctagonX className="h-4 w-4 text-red-500" />, 
        description: "Missing critical position data (ID or token symbols).",
        action: {
          label: "Open Ticket",
          onClick: () => window.open('https://discord.gg/alphix', '_blank')
        }
      });
      return;
    }
    setPositionToBurn(position);
    pendingActionRef.current = { type: 'withdraw' };
    setShowBurnConfirmDialog(true);
  };


  // Handle increase position
  const handleIncreasePosition = (position: ProcessedPosition, onModalClose?: () => void) => {
    if (!position.positionId || !position.token0.symbol || !position.token1.symbol) {
      toast.error("Invalid Position", { 
        icon: <OctagonX className="h-4 w-4 text-red-500" />, 
        description: "Missing critical position data (ID or token symbols).",
        action: {
          label: "Open Ticket",
          onClick: () => window.open('https://discord.gg/alphix', '_blank')
        }
      });
      return;
    }
    setPositionToModify(position);
    setShowIncreaseModal(true);
  };

  // Handle decrease position
  const handleDecreasePosition = (position: ProcessedPosition) => {
    if (!position.positionId || !position.token0.symbol || !position.token1.symbol) {
      toast.error("Invalid Position", { 
        icon: <OctagonX className="h-4 w-4 text-red-500" />, 
        description: "Missing critical position data (ID or token symbols).",
        action: {
          label: "Open Ticket",
          onClick: () => window.open('https://discord.gg/alphix', '_blank')
        }
      });
      return;
    }
    setPositionToModify(position);
    // Reset decrease state
    setDecreaseAmount0("");
    setDecreaseAmount1("");
    setDecreaseActiveInputSide(null);
    setIsFullBurn(false);
    setShowDecreaseModal(true);
  };

  // PositionCard helper functions
  const formatAgeShort = (seconds: number | undefined): string => {
    if (!seconds || seconds < 60) return '<1m';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);

    if (seconds < 2592000) { // Less than 30 days
      return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }

    const months = Math.floor(seconds / 2592000);
    const remainingDays = Math.floor((seconds % 2592000) / 86400);

    if (seconds < 31536000) { // Less than 1 year
      return remainingDays > 0 ? `${months}mo ${remainingDays}d` : `${months}mo`;
    }

    const years = Math.floor(seconds / 31536000);
    const remainingMonths = Math.floor((seconds % 31536000) / 2592000);
    const remainingDaysForYears = Math.floor((seconds % 2592000) / 86400);

    if (remainingMonths > 0 && remainingDaysForYears > 0) {
      return `${years}y ${remainingMonths}mo ${remainingDaysForYears}d`;
    } else if (remainingMonths > 0) {
      return `${years}y ${remainingMonths}mo`;
    } else {
      return `${years}y`;
    }
  };

  const poolDataByPoolId = React.useMemo(() => {
    if (!currentPoolData) return {};
    return { [poolId]: currentPoolData };
  }, [currentPoolData, poolId]);

  const claimFees = React.useCallback(async (positionId: string) => {
    try {
      // Build and submit collect calldata via v4 SDK
      const idRaw = String(positionId || '');
      const tokenIdStr = idRaw.includes('-') ? (idRaw.split('-').pop() as string) : idRaw;
      let tokenId: bigint;
      try {
        tokenId = BigInt(tokenIdStr);
      } catch {
        toast.error('Invalid Token ID', {
          icon: <OctagonX className="h-4 w-4 text-red-500" />,
          description: 'The position token ID is invalid.',
          action: {
            label: "Open Ticket",
            onClick: () => window.open('https://discord.gg/alphix', '_blank')
          }
        });
        return;
      }
      const { buildCollectFeesCall } = await import('@/lib/liquidity-utils');
      const { calldata, value } = await buildCollectFeesCall({ tokenId, userAddress: accountAddress as `0x${string}` });
      pendingActionRef.current = { type: 'collect' };
      setLastCollectPositionId(positionId);

      // Set loading state
      setUserPositions(prev => prev.map(p =>
        p.positionId === positionId
          ? { ...p, isOptimisticallyUpdating: true }
          : p
      ));

      writeContract({
        address: getPositionManagerAddress() as `0x${string}`,
        abi: position_manager_abi as any,
        functionName: 'multicall',
        args: [[calldata]],
        value,
        chainId,
      } as any, {
        onSuccess: (hash) => setCollectHash(hash as `0x${string}`),
        onError: (error: any) => {
          // Extract user-friendly error message (use shortMessage if available, or extract first line)
          let errorMessage = 'Transaction rejected';
          if (error?.shortMessage) {
            errorMessage = error.shortMessage;
          } else if (error?.message) {
            // Extract just the first meaningful line before "Request Arguments:" or "Details:"
            const match = error.message.match(/^([^\.]+\.)(?:\s|Request|Details|Contract|Docs)/);
            errorMessage = match ? match[1].trim() : error.message.split('\n')[0];
          }

          toast.error('Collect Failed', {
            icon: <OctagonX className="h-4 w-4 text-red-500" />,
            description: errorMessage,
            action: {
              label: "Copy Error",
              onClick: () => navigator.clipboard.writeText(error?.message || errorMessage)
            }
          });

          // Clear loading state on error
          setUserPositions(prev => prev.map(p =>
            p.positionId === positionId
              ? { ...p, isOptimisticallyUpdating: undefined }
              : p
          ));
        }
      } as any);
    } catch (err: any) {
      const errorMessage = err?.message || 'Failed to collect fees';
      toast.error('Collect Failed', {
        icon: <OctagonX className="h-4 w-4 text-red-500" />,
        description: errorMessage,
        action: {
          label: "Copy Error",
          onClick: () => navigator.clipboard.writeText(errorMessage)
        }
      });

      // Clear loading state on error
      setUserPositions(prev => prev.map(p =>
        p.positionId === positionId
          ? { ...p, isOptimisticallyUpdating: undefined }
          : p
      ));
    }
  }, [accountAddress, chainId, writeContract, toast]);

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
      for (const [symbol, tokenConfig] of Object.entries(TOKEN_DEFINITIONS)) {
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
          onClick: () => window.open('https://discord.gg/alphix', '_blank')
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
    <AppLayout>
      <div className="flex flex-1 justify-center items-center p-6">
        <Image
          src="/LogoIconWhite.svg"
          alt="Loading..."
          width={48}
          height={48}
          className="animate-pulse opacity-75"
        />
      </div>
    </AppLayout>
  );

  

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col p-3 sm:p-6 max-w-full overflow-hidden">

          
          {/* Main content area with two columns (row layout only at >=1500px) */}
          <div className="flex flex-col min-[1500px]:flex-row gap-6 min-w-0 max-w-full overflow-hidden">
            {/* Left Column: Header + Graph (flexible, takes remaining space) */}
            <div className="flex-1 min-w-0 flex flex-col space-y-3">
          {/* Header: Token info container + Stats in dotted container */}
          <div className="mt-3 sm:mt-0">
            {/* Mobile layout < 768px */}
            <div className="md:hidden space-y-3 overflow-x-hidden mb-2">
                {/* Identification above for mobile */}
                <Link href="/liquidity" className="rounded-lg bg-muted/30 border border-sidebar-border/60 cursor-pointer block">
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
                <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-4 mb-2 w-full">
                  <div className="grid grid-cols-2 gap-3">
                    {/* Volume */}
                    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
                      <div className="flex items-center justify-between px-4 h-9">
                        <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">VOLUME (24H)</h2>
                      </div>
                      <div className="px-4 py-1">
                        <div className="text-lg font-medium truncate">
                          {currentPoolData.volume24h === "Loading..." ? (
                            <span className="inline-block h-5 w-20 bg-muted/60 rounded animate-pulse" />
                          ) : (
                            currentPoolData.volume24h
                          )}
                        </div>
                      </div>
                    </div>
                    {/* Fees */}
                    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
                      <div className="flex items-center justify-between px-4 h-9">
                        <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">FEES (24H)</h2>
                      </div>
                      <div className="px-4 py-1">
                        <div className="text-lg font-medium truncate">
                          {currentPoolData.fees24h === "Loading..." ? (
                            <span className="inline-block h-5 w-20 bg-muted/60 rounded animate-pulse" />
                          ) : (
                            currentPoolData.fees24h
                          )}
                        </div>
                      </div>
                    </div>
                    {/* TVL */}
                    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
                      <div className="flex items-center justify-between px-4 h-9">
                        <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">TVL</h2>
                      </div>
                      <div className="px-4 py-1">
                        <div className="text-lg font-medium truncate">
                          {currentPoolData.liquidity === "Loading..." ? (
                            <span className="inline-block h-5 w-20 bg-muted/60 rounded animate-pulse" />
                          ) : (
                            currentPoolData.liquidity
                          )}
                        </div>
                      </div>
                    </div>
                    {/* APY */}
                    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
                      <div className="flex items-center justify-between px-4 h-9">
                        <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">APY</h2>
                      </div>
                      <div className="px-4 py-1">
                        <div className="text-lg font-medium truncate">
                          {currentPoolData.apr === "Loading..." ? (
                            <span className="inline-block h-5 w-20 bg-muted/60 rounded animate-pulse" />
                          ) : (
                            currentPoolData.apr
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            {/* Desktop layout >= 768px */}
            <div className="hidden md:block">
                  <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-4 mb-3 w-full">
                    <div className="flex items-stretch gap-3 min-w-0">
                      {/* Back arrow square */}
                      <Link
                        href="/liquidity"
                        className="flex-shrink-0 rounded-lg bg-muted/30 border border-sidebar-border/60 hover:border-white/30 transition-colors cursor-pointer flex items-center justify-center"
                        style={{ width: '74px', height: '74px', minWidth: '74px', minHeight: '74px' }}
                      >
                        <ChevronLeft className="h-5 w-5 text-muted-foreground" />
                      </Link>

                      {/* Token info container inside dotted container */}
                      <div className="min-w-0 basis-0 flex-1 overflow-hidden rounded-lg bg-muted/30 border border-sidebar-border/60">
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

                  {/* Volume - Show at: >= 1100px when no AddLiqForm, >= 1700px when AddLiqForm visible */}
                  <div
                    className="w-[160px] flex-shrink-0 rounded-lg bg-muted/30 border border-sidebar-border/60 hover:border-white/30 transition-colors cursor-pointer hidden min-[1100px]:max-[1499px]:block min-[1700px]:block"
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

                  {/* Fees - Show only on very large screens >= 2000px */}
                  <div className="w-[160px] flex-shrink-0 rounded-lg bg-muted/30 border border-sidebar-border/60 hidden min-[2000px]:block">
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

                  {/* TVL - Show at: >= 768px when no AddLiqForm, >= 1500px when AddLiqForm visible */}
                  <div
                    className="w-[160px] flex-shrink-0 rounded-lg bg-muted/30 border border-sidebar-border/60 hover:border-white/30 transition-colors cursor-pointer hidden sm:max-[1499px]:block min-[1500px]:block"
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

                      {/* APY (always) - fixed width */}
                      <div className="w-[160px] flex-shrink-0 rounded-lg bg-muted/30 border border-sidebar-border/60">
                        <div className="flex items-center justify-between px-3 h-9">
                      <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">APY</h2>
                    </div>
                        <div className="px-3 py-1">
                      <div className="text-lg font-medium truncate">
                        {currentPoolData.apr === "Loading..." ? (
                          <span className="inline-block h-5 w-20 bg-muted/60 rounded animate-pulse" />
                        ) : (
                          currentPoolData.apr
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
              {/* Pool Overview Section */}
              <div className="flex-1 min-h-0">
                <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 transition-colors flex flex-col h-full min-h-[300px] sm:min-h-[350px]">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-sidebar-border/60">
                    <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">POOL ACTIVITY</h2>
                    {/* Dropdown for smaller screens < 1500px */}
                    <div className="min-[1500px]:hidden">
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
                    {/* Buttons for larger screens >= 1500px - mimic category tabs styling */}
                    <div className="hidden min-[1500px]:flex items-center gap-2">
                        <button 
                          className={`px-2 py-1 text-xs rounded-md transition-colors ${
                            activeChart === 'volumeTvlRatio' 
                              ? 'bg-muted text-foreground' 
                              : 'bg-transparent text-muted-foreground hover:bg-muted/30'
                          }`}
                          onClick={() => setActiveChart('volumeTvlRatio')}
                        >
                          Dynamic Fee
                        </button>
                        <div className="w-px h-4 bg-border mx-1" />
                        <button 
                          className={`px-2 py-1 text-xs rounded-md transition-colors ${
                            activeChart === 'volume' 
                              ? 'bg-muted text-foreground' 
                              : 'bg-transparent text-muted-foreground hover:bg-muted/30'
                          }`}
                          onClick={() => setActiveChart('volume')}
                        >
                          Volume
                        </button>
                        <button 
                          className={`px-2 py-1 text-xs rounded-md transition-colors ${
                            activeChart === 'tvl' 
                              ? 'bg-muted text-foreground' 
                              : 'bg-transparent text-muted-foreground hover:bg-muted/30'
                          }`}
                          onClick={() => setActiveChart('tvl')}
                        >
                          TVL
                        </button>
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
                                feeMin - (feeRange * 0.1),
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
                                                  {typeof dataPoint.dynamicFee === 'number' ? `${dataPoint.dynamicFee.toFixed(2)}%` : 'N/A'}
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
                                feeMin - feeRange * paddingFactor,
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
                              const rightLabelA = `${feeDomain[0].toFixed(2)}%`;
                              const rightLabelB = `${feeDomain[1].toFixed(2)}%`;
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
                                    tickFormatter={(value) => `${value.toFixed(2)}%`}
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
                                                  {typeof dataPoint.dynamicFee === 'number' ? `${dataPoint.dynamicFee.toFixed(2)}%` : 'N/A'}
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

            {/* Right Column: Add Liquidity Form (fixed width at >=1500px, hidden below) */}
            {/* Key trick: Fixed width prevents layout shift from form content loading */}
            <div className="hidden min-[1500px]:block w-[450px] flex-shrink-0">
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
                      poolApr={currentPoolData?.apr}
                      onLiquidityAdded={(token0Symbol?: string, token1Symbol?: string) => {
                        refreshAfterLiquidityAddedWithSkeleton(token0Symbol, token1Symbol);
                      }}
                      sdkMinTick={SDK_MIN_TICK}
                      sdkMaxTick={SDK_MAX_TICK}
                      defaultTickSpacing={getPoolById(poolId)?.tickSpacing || DEFAULT_TICK_SPACING}
                      activeTab={'deposit'} // Always pass 'deposit'
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* Your Positions Section (Full width below the columns) */}
          <div className="space-y-3 lg:space-y-4 mt-2 mb-3 lg:mt-6 lg:mb-0"> {/* Mobile: top margin double bottom; desktop unchanged */}
            {/* Static title - always visible */}
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium">Your Positions</h3>
              {/* Add Liquidity button - only show below 1500px */}
              <a
                onClick={(e) => {
                  e.stopPropagation();
                  setAddLiquidityFormOpen(true);
                }}
                className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-sidebar-border bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 min-[1500px]:hidden"
                style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
              >
                <PlusIcon className="h-4 w-4 relative z-0" />
                <span className="relative z-0 whitespace-nowrap">Add Liquidity</span>
              </a>
            </div>
            
            {isLoadingPositions ? (
              /* Simple pulsing skeleton container */
              <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 h-20 animate-pulse">
              </div>
            ) : (userPositions.length > 0 || pendingNewPositions.length > 0) ? (
              <div>
                {/* Replace Table with individual position segments */}
                <div className="grid gap-3 lg:gap-4 min-[1360px]:grid-cols-2 min-[1360px]:gap-4 responsive-grid">
                  {/* Render pending position skeletons first */}
                  {pendingNewPositions.map((pendingPos) => (
                    <PositionSkeleton
                      key={pendingPos.id}
                      token0Symbol={pendingPos.token0Symbol}
                      token1Symbol={pendingPos.token1Symbol}
                    />
                  ))}
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
                        convertTickToPrice={convertTickToPrice}
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
                          raw0: feeData?.amount0 ?? null,
                          raw1: feeData?.amount1 ?? null
                        }}
                        onDenominationData={(data) => {
                          setDenominationDataByPositionId(prev => ({
                            ...prev,
                            [position.positionId]: data
                          }));
                        }}
                      />
                    );
                    });
                  })()}
                </div>
              </div>
            ) : (
              /* Dashed outline container with centered text */
              <div className="border border-dashed rounded-lg bg-muted/10 p-8 flex items-center justify-center">
                <div className="text-sm font-medium text-white/75">
                  No Positions
                </div>
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
        poolApr={currentPoolData?.apr}
        positionToModify={showIncreaseModal ? positionToModify : null}
        feesForIncrease={showIncreaseModal ? feesForIncrease : null}
        increaseLiquidity={showIncreaseModal ? (data) => {
          pendingActionRef.current = { type: 'increase' };
          increaseLiquidity(data);
        } : undefined}
        isIncreasingLiquidity={showIncreaseModal ? isIncreasingLiquidity : undefined}
        isIncreaseSuccess={showIncreaseModal ? isIncreaseSuccess : undefined}
        increaseTxHash={showIncreaseModal ? increaseTxHash : undefined}
        onLiquidityAdded={(token0Symbol?: string, token1Symbol?: string) => {
          if (showIncreaseModal) {
            // For increase operations, do nothing here - let the transaction callback handle everything
            // This prevents premature toasts and modal closure
          } else {
            setAddLiquidityOpen(false);
            refreshAfterLiquidityAddedWithSkeleton(token0Symbol, token1Symbol);
          }
        }}
      />

      {/* Add Liquidity Form Modal - for top button */}
      <Dialog open={addLiquidityFormOpen} onOpenChange={setAddLiquidityFormOpen}>
        <DialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-2xl max-h-[90vh] overflow-y-auto" style={{ backgroundColor: 'var(--modal-background)' }}>
          <DialogHeader>
            <DialogTitle>Add Liquidity</DialogTitle>
            <DialogDescription>
              Add liquidity to the {currentPoolData?.pair} pool
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <AddLiquidityFormMemo
              selectedPoolId={poolId}
              poolApr={currentPoolData?.apr}
              onLiquidityAdded={(token0Symbol?: string, token1Symbol?: string) => {
                setAddLiquidityFormOpen(false);
                refreshAfterLiquidityAddedWithSkeleton(token0Symbol, token1Symbol);
              }}
              sdkMinTick={SDK_MIN_TICK}
              sdkMaxTick={SDK_MAX_TICK}
              defaultTickSpacing={getPoolById(poolId)?.tickSpacing || DEFAULT_TICK_SPACING}
              activeTab="deposit"
            />
          </div>
        </DialogContent>
      </Dialog>

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
            // Use backoff refresh for proper retry logic with cache invalidation
            await backoffRefreshSinglePosition(selectedPositionForDetails.positionId);
          }}
          currentPrice={currentPrice}
          currentPoolTick={currentPoolTick}
          convertTickToPrice={convertTickToPrice}
          selectedPoolId={selectedPositionForDetails.poolId}
          chainId={chainId}
          denominationBase={denominationDataByPositionId[selectedPositionForDetails.positionId]?.denominationBase}
          initialMinPrice={denominationDataByPositionId[selectedPositionForDetails.positionId]?.minPrice}
          initialMaxPrice={denominationDataByPositionId[selectedPositionForDetails.positionId]?.maxPrice}
          initialCurrentPrice={denominationDataByPositionId[selectedPositionForDetails.positionId]?.displayedCurrentPrice}
          prefetchedFormattedAPY={denominationDataByPositionId[selectedPositionForDetails.positionId]?.formattedAPY}
          prefetchedIsAPYFallback={denominationDataByPositionId[selectedPositionForDetails.positionId]?.isAPYFallback}
          prefetchedIsLoadingAPY={denominationDataByPositionId[selectedPositionForDetails.positionId]?.isLoadingAPY}
        />
      )}

    </AppLayout>
  );
}