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
import { useRouter, useParams } from "next/navigation";
import { useAccount, useBalance } from "wagmi";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-is-mobile";
import type { ProcessedPosition } from "../../../pages/api/liquidity/get-positions";
import { TOKEN_DEFINITIONS, TokenSymbol } from "@/lib/pools-config";
import { formatUnits, type Hex } from "viem";
import { Bar, BarChart, Line, LineChart, CartesianGrid, XAxis, YAxis, ResponsiveContainer, ComposedChart, Area, ReferenceLine, ReferenceArea } from "recharts";
import { getPoolById, getPoolSubgraphId, getToken, getAllTokens } from "@/lib/pools-config";
import { useBlockRefetch, usePoolState, useAllPrices, useUncollectedFees } from "@/components/data/hooks";
import { getPoolFeeBps } from "@/lib/client-cache";
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
import { getPositionManagerAddress } from '@/lib/pools-config';
import { position_manager_abi } from '@/lib/abis/PositionManager_abi';
import { getFromCache, setToCache, getFromCacheWithTtl, getUserPositionsCacheKey, getPoolStatsCacheKey, getPoolDynamicFeeCacheKey, getPoolChartDataCacheKey, loadUserPositionIds, derivePositionsFromIds, invalidateCacheEntry, waitForSubgraphBlock } from "../../../lib/client-cache";
import type { Pool } from "../../../types";
import { AddLiquidityForm } from "../../../components/liquidity/AddLiquidityForm";
import {
  Dialog as AddDialog,
  DialogContent as AddDialogContent,
} from "@/components/ui/dialog";
import React from "react";
import { useBurnLiquidity, type BurnPositionData } from "@/components/liquidity/useBurnLiquidity";
import { useIncreaseLiquidity, type IncreasePositionData } from "@/components/liquidity/useIncreaseLiquidity";
import { useDecreaseLiquidity, type DecreasePositionData } from "@/components/liquidity/useDecreaseLiquidity";
import { prefetchService } from "@/lib/prefetch-service";
import { publicClient } from "@/lib/viemClient";


import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ChevronDownIcon } from "lucide-react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { motion, AnimatePresence } from "framer-motion";
import { PositionSkeleton } from '@/components/liquidity/PositionSkeleton';


// Define the structure of the chart data points from the API
interface ChartDataPoint {
  date: string; // YYYY-MM-DD
  volumeUSD: number;
  tvlUSD: number;
  volumeTvlRatio: number;
  emaRatio: number;
  dynamicFee: number; // Fee percentage (e.g., 0.31 for 0.31%)
}

// SDK constants
const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;
const DEFAULT_TICK_SPACING = 60;

// Format token amounts for display
const formatTokenDisplayAmount = (amount: string) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num === 0) return "0.00";
  if (num > 0 && num < 0.0001) return "< 0.0001";
  return num.toFixed(4);
};

// Get token icon for display
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
        const displayDecimals = baseTokenForPriceDisplay === token0Symbol 
          ? (TOKEN_DEFINITIONS[token0Symbol as TokenSymbol]?.displayDecimals ?? 4)
          : (TOKEN_DEFINITIONS[token1Symbol as TokenSymbol]?.displayDecimals ?? 4);
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
    const displayDecimals = (TOKEN_DEFINITIONS[baseTokenForPriceDisplay as TokenSymbol]?.displayDecimals ?? 4);
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

// Fees cell with hooks (precise uncollected fees)
function FeesCell({ positionId, sym0, sym1, price0, price1 }: { positionId: string; sym0: string; sym1: string; price0: number; price1: number }) {
  const { data: fees, isLoading } = useUncollectedFees(positionId, 60_000);

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
  

  
  const { address: accountAddress, isConnected, chainId } = useAccount();
  const { writeContract } = useWriteContract();
  const [collectHash, setCollectHash] = useState<`0x${string}` | undefined>(undefined);
  const { isLoading: isCollectConfirming, isSuccess: isCollectConfirmed } = useWaitForTransactionReceipt({ hash: collectHash });
  // Guard to prevent duplicate toasts and unintended modal closes across re-renders
  const pendingActionRef = useRef<null | { type: 'increase' | 'decrease' | 'withdraw' | 'burn' | 'collect' | 'compound' }>(null);
  const lastRevalidationRef = useRef<number>(0);
  const lastPositionRefreshRef = useRef<number>(0);
  const handledCollectHashRef = useRef<string | null>(null);
  
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
      const displayDecimals = TOKEN_DEFINITIONS[tokenSymbolForDecimals]?.displayDecimals ?? 4;
      return numericBalance.toFixed(displayDecimals);
    }
  };

  // Display balance calculations
  const displayToken0Balance = isLoadingToken0Balance 
    ? "Loading..." 
    : (token0BalanceData ? getFormattedDisplayBalance(parseFloat(token0BalanceData.formatted), 'aUSDC' as TokenSymbol) : "~");
  
  const displayToken1Balance = isLoadingToken1Balance 
    ? "Loading..." 
    : (token1BalanceData ? getFormattedDisplayBalance(parseFloat(token1BalanceData.formatted), 'aUSDT' as TokenSymbol) : "~");

  const leftColumnRef = useRef<HTMLDivElement>(null); // Ref for the entire left column
  const topBarRef = useRef<HTMLDivElement>(null); // Ref for top bar overflow detection
  const tokenInfoRef = useRef<HTMLDivElement>(null); // Ref to measure token info width

  // State for the pool's detailed data (including fetched stats)
  const [currentPoolData, setCurrentPoolData] = useState<PoolDetailData | null>(null);
  const [apiChartData, setApiChartData] = useState<ChartDataPoint[]>([]);
  const [isLoadingChartData, setIsLoadingChartData] = useState(false);
  const [currentPoolTick, setCurrentPoolTick] = useState<number | null>(null);
  const [currentPrice, setCurrentPrice] = useState<string | null>(null);

  const basePoolInfo = getPoolConfiguration(poolId);
  const apiPoolIdToUse = basePoolInfo?.subgraphId || '';
  const { data: poolStateData } = usePoolState(String(apiPoolIdToUse));
  const { data: poolState } = poolStateData || {};

  useEffect(() => {
    if (poolState?.currentPrice && typeof poolState?.currentPoolTick === 'number') {
      setCurrentPrice(String(poolState.currentPrice));
      setCurrentPoolTick(Number(poolState.currentPoolTick));
    }
  }, [poolState]);
  useBlockRefetch({ poolIds: apiPoolIdToUse ? [apiPoolIdToUse] : [] });

  const { data: allPrices } = useAllPrices();
  const isLoadingPrices = !allPrices;
  const getUsdPriceForSymbol = useCallback((symbolRaw?: string): number => {
    const symbol = (symbolRaw || '').toUpperCase();
    if (!symbol) return 0;
    if (['USDC', 'AUSDC', 'USDT', 'AUSDT', 'MUSDT', 'YUSD'].includes(symbol)) return allPrices?.USDC ?? 1;
    if (['ETH', 'AETH'].includes(symbol)) return allPrices?.ETH ?? 0;
    if (['BTC', 'ABTC'].includes(symbol)) return allPrices?.BTC ?? 0;
    return 0;
  }, [allPrices]);

  // Unified batch pool stats loader (same as pools list): tvlUSD + volume24hUSD
  const loadPoolStatsFromSubgraph = useCallback(async (apiPoolIdToUse: string, force?: boolean) => {
    try {
      // Use existing server batch endpoint (server-only SUBGRAPH_URL; 10m CDN TTL)
      const attempt = async () => {
        const resp = await fetch(`/api/liquidity/get-pools-batch${force ? `?bust=${Date.now()}` : ''}`);
        if (!resp.ok) return null;
        const data = await resp.json();
        if (!data?.success || !Array.isArray(data?.pools)) return null;
        const poolIdLc = String(apiPoolIdToUse || '').toLowerCase();
        const match = data.pools.find((p: any) => String(p.poolId || '').toLowerCase() === poolIdLc);
        if (!match) return null;
        return {
          tvlUSD: Number(match.tvlUSD) || 0,
          volume24hUSD: Number(match.volume24hUSD) || 0,
          tvlYesterdayUSD: Number(match.tvlYesterdayUSD) || 0,
          volumePrev24hUSD: Number(match.volumePrev24hUSD) || 0,
        } as Partial<Pool> & { tvlUSD: number; volume24hUSD: number };
      };

      let result = await attempt();
      if (result) return result;
      // brief retry to smooth transient misses
      await new Promise(r => setTimeout(r, 250));
      result = await attempt();
      return result;
    } catch (e) {
      console.error('[PoolDetail] Subgraph load failed:', e);
      return null;
    }
  }, []);

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

  // Uncollected fees for active modals (used for green "+ X" subtitle)
  const { data: feesForWithdraw } = useUncollectedFees(positionToBurn?.positionId || '', 60_000);
  const { data: feesForIncrease } = useUncollectedFees(positionToModify?.positionId || '', 60_000);

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
  const [increaseAmount0, setIncreaseAmount0] = useState<string>("");
  const [increaseAmount1, setIncreaseAmount1] = useState<string>("");
  const [increaseActiveInputSide, setIncreaseActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isIncreaseCalculating, setIsIncreaseCalculating] = useState(false);
  const [decreaseAmount0, setDecreaseAmount0] = useState<string>("");
  const [decreaseAmount1, setDecreaseAmount1] = useState<string>("");
  const [decreaseActiveInputSide, setDecreaseActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isDecreaseCalculating, setIsDecreaseCalculating] = useState(false);
  const [isFullBurn, setIsFullBurn] = useState(false);
  const [withdrawAmount0, setWithdrawAmount0] = useState<string>("");
  const [withdrawAmount1, setWithdrawAmount1] = useState<string>("");
  const [withdrawActiveInputSide, setWithdrawActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isFullWithdraw, setIsFullWithdraw] = useState(false);
  const [withdrawPercentage, setWithdrawPercentage] = useState<number>(0);
  const [increasePercentage, setIncreasePercentage] = useState<number>(0);


  const isMobile = useIsMobile();

  const withdrawProductiveSide = useMemo<null | 'amount0' | 'amount1'>(() => {
    if (!positionToBurn || positionToBurn.isInRange) return null;
    // Prefer actual balances to determine productive side when out of range
    const amt0 = Number.parseFloat(positionToBurn.token0?.amount || '0');
    const amt1 = Number.parseFloat(positionToBurn.token1?.amount || '0');
    if (amt0 > 0 && (!Number.isFinite(amt1) || amt1 <= 0)) return 'amount0';
    if (amt1 > 0 && (!Number.isFinite(amt0) || amt0 <= 0)) return 'amount1';
    // Fallback to tick-based inference if both sides are non-zero or unknown
    const tick = currentPoolTick;
    const below = tick !== null ? tick < positionToBurn.tickLower : positionToBurn.tickLower > 0;
    const above = tick !== null ? tick > positionToBurn.tickUpper : positionToBurn.tickUpper < 0;
    return below ? 'amount0' : above ? 'amount1' : null;
  }, [positionToBurn, currentPoolTick]);

  const [isIncreaseAmountValid, setIsIncreaseAmountValid] = useState(true);

  const [windowWidth, setWindowWidth] = useState<number>(1200);
  // Dynamic overflow detection states
  const [showFeesCard, setShowFeesCard] = useState(true);
  const [showVolumeCard, setShowVolumeCard] = useState(true);
  const [showTvlCard, setShowTvlCard] = useState(true);




  // State for position menu
  const [showPositionMenu, setShowPositionMenu] = useState<string | null>(null);
  const [positionMenuOpenUp, setPositionMenuOpenUp] = useState<boolean>(false);

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showPositionMenu && !(event.target as Element).closest('.position-menu-trigger')) {
          setShowPositionMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPositionMenu]);

  // Dynamic overflow detection for top bar to prevent AddLiquidityForm overflow
  useEffect(() => {
    const checkOverflow = () => {
      if (windowWidth < 1500) return; // Only check when AddLiquidityForm is visible
      
      // Use actual container measurements instead of assumptions
      const mainContainer = document.querySelector('.flex.flex-1.flex-col.p-3.sm\\:p-6.sm\\:px-10');
      if (!mainContainer) return;
      
      const containerRect = mainContainer.getBoundingClientRect();
      const availableWidth = containerRect.width;
      
      // Fixed widths
      const addLiqFormWidth = 450; // AddLiquidityForm width
      const columnGap = 24; // gap-6
      const safetyMargin = 60; // Extra safety margin
      
      // Available width for left column
      const maxLeftColumnWidth = availableWidth - addLiqFormWidth - columnGap - safetyMargin;
      
      // Calculate required width for top bar content (use a stable baseline to avoid feedback loops)
      const tokenInfoWidth = 300; // includes chevron + icons + labels headroom
      const apyWidth = 160; // APY card width
      const optionalCardWidth = 160; // Width for each optional card
      const cardGap = 12; // gap-3 between cards
      const topBarPadding = 32; // p-4 padding inside top bar
      
      // Start with minimal required width (token info + APY + padding)
      let requiredWidth = tokenInfoWidth + apyWidth + cardGap + topBarPadding;
      
      // Add width for visible optional cards
      const optionalCards = [
        { show: showTvlCard, name: 'TVL' },
        { show: showVolumeCard, name: 'Volume' },
        { show: showFeesCard, name: 'Fees' }
      ];
      
      const visibleOptionalCount = optionalCards.filter(card => card.show).length;
      requiredWidth += visibleOptionalCount * (optionalCardWidth + cardGap);
      
      // Determine if we need to hide cards or can show more
      const exceedsSpace = requiredWidth > maxLeftColumnWidth;
      const hasSpaceForMore = requiredWidth + optionalCardWidth + cardGap + 40 < maxLeftColumnWidth; // 40px buffer
      
      if (exceedsSpace) {
        // Hide cards in priority order: Fees → Volume → TVL
        if (showFeesCard) {
          setShowFeesCard(false);
        } else if (showVolumeCard) {
          setShowVolumeCard(false);
        } else if (showTvlCard) {
          setShowTvlCard(false);
        }
      } else if (hasSpaceForMore) {
        // Show cards back in reverse priority: TVL → Volume → Fees
        if (!showTvlCard) {
          setShowTvlCard(true);
        } else if (!showVolumeCard && showTvlCard) {
          setShowVolumeCard(true);
        } else if (!showFeesCard && showVolumeCard && showTvlCard) {
          setShowFeesCard(true);
        }
      }
    };

    // Debounce the check to avoid rapid firing
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(checkOverflow);
    }, 150);
    
    return () => clearTimeout(timeoutId);
  }, [windowWidth, currentPoolData, showFeesCard, showVolumeCard, showTvlCard]);

  // Initialize card visibility based on screen size (fallback for non-1500px+ screens)
  useEffect(() => {
    if (windowWidth < 1500) {
      // For screens without AddLiquidityForm, use simple breakpoints
      if (windowWidth >= 1200) {
        setShowFeesCard(true);
        setShowVolumeCard(true);
        setShowTvlCard(true);
      } else if (windowWidth >= 1000) {
        setShowFeesCard(false);
        setShowVolumeCard(true);
        setShowTvlCard(true);
      } else if (windowWidth >= 800) {
        setShowFeesCard(false);
        setShowVolumeCard(false);
        setShowTvlCard(true);
      } else {
        setShowFeesCard(false);
        setShowVolumeCard(false);
        setShowTvlCard(false);
      }
    } else {
      // For screens with AddLiquidityForm, start with all visible and let overflow detection handle it
      setShowFeesCard(true);
      setShowVolumeCard(true);
      setShowTvlCard(true);
    }
  }, [windowWidth]);



  const processChartDataForScreenSize = useCallback((data: ChartDataPoint[]) => {
    if (!data?.length) return [];
    const sortedData = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    let daysBack = windowWidth < 1500 ? 14 : windowWidth < 1700 ? 21 : 28;
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
    return filledData;
  }, [windowWidth]);



  // Memoized callback functions to prevent infinite re-renders
  const positionsWriteLockRef = useRef<number>(0);

  const refetchPositionsOnly = useCallback(async () => {
    try {
      if (Date.now() < positionsWriteLockRef.current) return;
      if (!poolId || !isConnected || !accountAddress) return;
      const basePoolInfo = getPoolConfiguration(poolId);
      if (!basePoolInfo) return;
      const ids = await loadUserPositionIds(accountAddress);
      const data = await derivePositionsFromIds(accountAddress, ids);
      if (!Array.isArray(data)) return;
      const subgraphId = (basePoolInfo.subgraphId || '').toLowerCase();
      const [poolToken0Raw, poolToken1Raw] = basePoolInfo.pair.split(' / ');
      const poolToken0 = poolToken0Raw?.trim().toUpperCase();
      const poolToken1 = poolToken1Raw?.trim().toUpperCase();
      const filtered = data.filter((pos: any) => {
        const poolMatch = subgraphId && String(pos.poolId || '').toLowerCase() === subgraphId;
        return poolMatch;
      });
      setUserPositions(filtered);
    } catch (e) {
      console.warn('Refetch positions failed', e);
    }
  }, [poolId, isConnected, accountAddress]);

  // Subscribe once to centralized positions refresh events
  // useEffect(() => {
  //   if (!isConnected || !accountAddress) return;
  //   const unsubscribe = prefetchService.addPositionsListener(accountAddress, () => {
  //     refetchPositionsOnly();
  //   });
  //   return unsubscribe;
  // }, [isConnected, accountAddress, refetchPositionsOnly]); // Temporarily disabled to prevent infinite loops
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
  const isCompoundInProgressRef = useRef(false);

  // Silent backoff refresh for positions - only updates when new positions are detected
  const silentBackoffRefreshPositions = useCallback(async (removeSkeletonsWhenFound = false) => {
    try {
      if (!poolId || !isConnected || !accountAddress) return;
      
      // Prevent rapid silent position refreshes (cooldown: 5 seconds)
      const now = Date.now();
      if (now - lastPositionRefreshRef.current < 5000) {
        console.log('Skipping silent position refresh due to cooldown');
        return;
      }
      lastPositionRefreshRef.current = now;
      
      const baseInfo = getPoolConfiguration(poolId);
      const subId = (baseInfo?.subgraphId || '').toLowerCase();
      if (!subId) return;

      const delays = [0, 2000, 5000, 10000, 15000];
      const fingerprint = (arr: ProcessedPosition[]) => {
        try {
          return JSON.stringify(arr.map(p => ({ id: p.positionId, a0: p.token0.amount, a1: p.token1.amount, l: (p as any)?.liquidity, lo: p.tickLower, up: p.tickUpper })));
        } catch { return ''; }
      };
      const baseline = userPositions || [];
      const baselineFp = fingerprint(baseline);
      const baselineCount = baseline.length;

      // DO NOT show loading state - this is silent
      for (let i = 0; i < delays.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, delays[i]));
        try {
          const res = await fetch(`/api/liquidity/get-positions?ownerAddress=${accountAddress}&bust=${Date.now()}`);
          if (!res.ok) continue;
          const data = await res.json();
          if (!Array.isArray(data)) continue;
          // Update cache for the owner
          try { setToCache(getUserPositionsCacheKey(accountAddress), data); } catch {}
          const filtered = data.filter((pos: any) => String(pos?.poolId || '').toLowerCase() === subId);
          const nextFp = fingerprint(filtered);
          const newCount = filtered.length;
          
          // Check for new position IDs (more reliable than count comparison)
          const baselineIds = new Set(baseline.map(p => p.positionId));
          const newPositions = filtered.filter(p => !baselineIds.has(p.positionId));
          const hasNewPositions = newPositions.length > 0;
          
          // Only update if we detected new positions (or significant changes after some retries)
          if (nextFp !== baselineFp && (hasNewPositions || i >= 2)) {
            if (removeSkeletonsWhenFound && hasNewPositions) {
              // Just update positions - skeleton removal will be handled by useEffect watching userPositions
              setUserPositions(filtered);
            } else {
              setUserPositions(filtered);
            }
            break;
          }
        } catch {}
      }
      
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
        console.log('Skipping position refresh due to cooldown');
        return;
      }
      lastPositionRefreshRef.current = now;
      
      const baseInfo = getPoolConfiguration(poolId);
      const subId = (baseInfo?.subgraphId || '').toLowerCase();
      if (!subId) return;

      const delays = [0, 2000, 5000, 10000];
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
      for (let i = 0; i < delays.length; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, delays[i]));
        try {
          const res = await fetch(`/api/liquidity/get-positions?ownerAddress=${accountAddress}&bust=${Date.now()}`);
          if (!res.ok) continue;
          const data = await res.json();
          if (!Array.isArray(data)) continue;
          // Update cache for the owner
          try { setToCache(getUserPositionsCacheKey(accountAddress), data); } catch {}
          const filtered = data.filter((pos: any) => String(pos?.poolId || '').toLowerCase() === subId);
          const nextFp = fingerprint(filtered);
          if (nextFp !== baselineFp) {
            setUserPositions(filtered);
            break;
          }
        } catch {}
      }
    } finally {
      setIsLoadingPositions(false);
    }
  }, [poolId, isConnected, accountAddress, userPositions]);

  // Note: useEffect moved after hook initialization



  // Fetch user positions for this pool and pool stats
  const fetchPageData = useCallback(async (force?: boolean, skipPositions?: boolean, keepLoading?: boolean) => {
    if (!poolId) return;

    // Start loading chart data
    setIsLoadingChartData(true);
    // If a recent swap was recorded for this pool, force a refresh once and clear the hint
    try {
      const hintKey = `recentSwap:${String(poolId).toLowerCase()}`;
      const hint = localStorage.getItem(hintKey);
      if (hint) {
        force = true;
        localStorage.removeItem(hintKey);
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

        // Minimal retry helper to avoid showing the chart until data is truly available
        const fetchJsonWithRetry = async <T = any>(url: string, validate?: (json: any) => boolean, attempts = 4, delayMs = 700): Promise<T> => {
          let last: any = null;
          for (let i = 0; i < attempts; i++) {
            const res = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } as any } as any);
            if (res.ok) {
              const json = await res.json();
              last = json;
              if (!validate || validate(json)) return json as T;
            }
            if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
          }
          // If validation fails after retries, throw to keep loading state
          throw new Error(`Validation failed for ${url}`);
        };

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

        const bust = force ? `&bust=${Date.now()}` : '';
        const [feeJson, tvlJson, volJson] = await Promise.all([
          fetchJsonWithRetry(`/api/liquidity/get-historical-dynamic-fees?poolId=${encodeURIComponent(subgraphIdForHist)}&days=${targetDays}${bust}`,
            (j) => validateChartData(j, 'fees')
          ),
          fetchJsonWithRetry(`/api/liquidity/chart-tvl?poolId=${encodeURIComponent(poolId)}&days=${targetDays}${bust}`,
            (j) => validateChartData(j, 'tvl')
          ),
          fetchJsonWithRetry(`/api/liquidity/chart-volume?poolId=${encodeURIComponent(poolId)}&days=${targetDays}${bust}`,
            (j) => validateChartData(j, 'volume')
          ),
        ]);
        // No ad-hoc quick retries; handled by fetchJsonWithRetry

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
            curRatio = scaleRatio(e?.currentTargetRatio);
            curEma = scaleRatio(e?.oldTargetRatio);
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

        // Enforce today's data append from header stats before unsetting loading
        // todayKeyLocal already computed above
        // Get current stats from batch API to ensure today's point is present
        let tvlFromHeader = 0;
        try {
          const resp = await fetch('/api/liquidity/get-pools-batch');
          if (resp.ok) {
            const data = await resp.json();
            const poolIdLc = String(subgraphIdForHist || '').toLowerCase();
            const match = Array.isArray(data?.pools) ? data.pools.find((p: any) => String(p.poolId || '').toLowerCase() === poolIdLc) : null;
            if (match) {
              tvlFromHeader = Number(match.tvlUSD) || 0;
            }
          }
        } catch {}
        let finalMerged = merged;
        const hasToday = finalMerged.some(d => d.date === todayKeyLocal);
        const overlayToday = feeByDate.get(todayKeyLocal);
        if (hasToday) {
          // Update existing today point with current TVL and overlay (keep existing volume)
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
        } else {
          // Add today point if missing; overlay from latest fee event
          finalMerged = [...finalMerged, { 
            date: todayKeyLocal, 
            volumeUSD: 0,
            tvlUSD: Number.isFinite(tvlFromHeader) && tvlFromHeader > 0 ? tvlFromHeader : 0, 
            volumeTvlRatio: overlayToday?.ratio ?? 0, 
            emaRatio: overlayToday?.ema ?? 0, 
            dynamicFee: overlayToday?.feePct ?? 0, 
          }];
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
        toast.error('Could not load pool chart data.', { description: error?.message || String(error) });
        // End loading unless caller wants to keep spinner (e.g., backoff window)
        if (!keepLoading) setIsLoadingChartData(false);
      }
    })();

    const basePoolInfo = getPoolConfiguration(poolId);
    if (!basePoolInfo) {
      toast.error("Pool configuration not found for this ID.");
      router.push('/liquidity');
      return;
    }

    // Use the subgraph ID from the pool configuration for API calls
    const apiPoolIdToUse = basePoolInfo.subgraphId; 

    // Pool state now handled by usePoolState hook at component level

    // 1. Fetch Pool Stats from server; server caches for 10m-1h and dedupes
    let poolStats: Partial<Pool> | null = null;
    try {
      const resp = await fetch(`/api/liquidity/get-pools-batch${force ? `?bust=${Date.now()}` : ''}`);
      if (resp.ok) {
        const data = await resp.json();
        const poolIdLc = String(apiPoolIdToUse || '').toLowerCase();
        const match = Array.isArray(data?.pools) ? data.pools.find((p: any) => String(p.poolId || '').toLowerCase() === poolIdLc) : null;
        if (match) {
          poolStats = {
            tvlUSD: Number(match.tvlUSD) || 0,
            volume24hUSD: Number(match.volume24hUSD) || 0,
            tvlYesterdayUSD: Number(match.tvlYesterdayUSD) || 0,
            volumePrev24hUSD: Number(match.volumePrev24hUSD) || 0,
          } as any;
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
    const calculatedApr = (tvlNow > 0 && fees24hUSD > 0) ? (((fees24hUSD * 365) / tvlNow) * 100).toFixed(2) + '%' : 'N/A';

    const combinedPoolData = {
        ...basePoolInfo,
        ...(poolStats || {}),
        apr: calculatedApr,
        dynamicFeeBps: dynamicFeeBps,
        tickSpacing: getPoolById(poolId)?.tickSpacing || DEFAULT_TICK_SPACING,
        volume24h: isFinite(vol24) ? formatUSD(vol24) : basePoolInfo.volume24h,
        fees24h: isFinite(fees24hUSD) ? formatUSD(fees24hUSD) : basePoolInfo.fees24h,
        liquidity: isFinite(tvlNow) ? formatUSD(tvlNow) : basePoolInfo.liquidity,
        highlighted: false,
    } as PoolDetailData;

    setCurrentPoolData(combinedPoolData);
    if (!skipPositions && isConnected && accountAddress) {
      setIsLoadingPositions(true);
      let allUserPositions: any[] = [];
      try {
        const ids = await loadUserPositionIds(accountAddress);
        allUserPositions = await derivePositionsFromIds(accountAddress, ids);
      } catch (error) {
        console.error("Failed to derive user positions:", error);
        allUserPositions = [];
      }

      if (allUserPositions && allUserPositions.length > 0) {
        const subgraphId = (basePoolInfo.subgraphId || '').toLowerCase();
        const filteredPositions = allUserPositions.filter(pos => String(pos.poolId || '').toLowerCase() === subgraphId);
        setUserPositions(filteredPositions);
      } else {
        setUserPositions([]);
      }
      setIsLoadingPositions(false);
    } else if (!skipPositions && (!isConnected || !accountAddress)) {
      setUserPositions([]);
      setIsLoadingPositions(false);
    }
  }, [poolId, isConnected, accountAddress, router]);

  // Enhanced refresh function that adds skeleton immediately and does silent background refresh
  const refreshAfterLiquidityAddedWithSkeleton = useCallback(async (token0Symbol?: string, token1Symbol?: string) => {
    // 1. Immediately add skeleton if we have token info
    if (token0Symbol && token1Symbol) {
      const skeletonId = `skeleton-${Date.now()}`;
      const createdAt = Date.now();
      const baselineIds = userPositions.map(p => p.positionId);
      
      setPendingNewPositions(prev => {
        const newSkeletons = [...prev, {
          id: skeletonId,
          token0Symbol,
          token1Symbol,
          createdAt,
          baselineIds
        }];
        return newSkeletons;
      });
    }

    // 2. Start silent background refresh
    await silentRefreshAfterLiquidityAdded(token0Symbol, token1Symbol);
  }, [userPositions, pendingNewPositions]);

  // Targeted refresh after add: wait for subgraph head, then derive and swap skeletons for real cards
  const silentRefreshAfterLiquidityAdded = useCallback(async (token0Symbol?: string, token1Symbol?: string) => {
    if (!poolId || !isConnected || !accountAddress) return;

    const basePoolInfo = getPoolConfiguration(poolId);
    if (!basePoolInfo) return;
    const subId = (basePoolInfo.subgraphId || '').toLowerCase();

    try {
      setIsLoadingChartData(true);

      const targetBlock = Number(await publicClient.getBlockNumber());
      await waitForSubgraphBlock(targetBlock, { timeoutMs: 15000, minWaitMs: 800, maxIntervalMs: 1000 });

      try { fetch('/api/internal/revalidate-pools', { method: 'POST' } as any); } catch {}
      try {
        fetch('/api/internal/revalidate-chart', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ poolId, subgraphId: subId })
        } as any);
      } catch {}

      // Load ids then derive full positions
      const ids = await loadUserPositionIds(accountAddress);
      const allDerived = await derivePositionsFromIds(accountAddress, ids);
      const filtered = allDerived.filter((pos: any) => String(pos.poolId || '').toLowerCase() === subId);

      setUserPositions(filtered);
      // Remove skeletons only once we have derived positions ready
      setPendingNewPositions([]);

      // NEW: Actively refetch chart + header stats after revalidation (skip positions)
      await fetchPageData(true, /* skipPositions */ true, /* keepLoading */ false);
    } catch (error) {
      // Silent failure - error logged in waitForSubgraphBlock if needed
    } finally {
              setIsLoadingChartData(false);
    }
  }, [poolId, isConnected, accountAddress]);

  // Callback definitions (moved here after fetchPageData and backoffRefreshPositions are defined)
  const onLiquidityIncreasedCallback = useCallback(() => {
    if (pendingActionRef.current?.type !== 'increase') return; // ignore if not current action
    
    // Prevent rapid revalidations (cooldown: 30 seconds)
    const now = Date.now();
    if (now - lastRevalidationRef.current < 30000) {
      console.log('Skipping revalidation due to cooldown (increase)');
      return;
    }
    lastRevalidationRef.current = now;
    
    toast.success("Position Increased", { icon: <BadgeCheck className="h-4 w-4 text-green-500" /> });
    setShowIncreaseModal(false);
    pendingActionRef.current = null;
    // Centralized: wait for subgraph head to reach the mined block, then single refetch
    try {
      (async () => {
        try {
          const targetBlock = Number(await publicClient.getBlockNumber());
          await waitForSubgraphBlock(targetBlock, { timeoutMs: 15000, minWaitMs: 800, maxIntervalMs: 1000 });
          // Invalidate server caches for shared data, then server will rebuild after subgraph sync
          try { fetch('/api/internal/revalidate-pools', { method: 'POST' } as any); } catch {}
          try {
            const base = getPoolConfiguration(poolId);
            const subId = (base?.subgraphId || '').toLowerCase();
            fetch('/api/internal/revalidate-chart', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ poolId, subgraphId: subId })
            } as any);
          } catch {}
          await fetchPageData(true, /* skipPositions */ false, /* keepLoading */ false);
        } catch {}
      })();
    } catch {}
  }, [poolId, fetchPageData]);

  const onLiquidityDecreasedCallback = useCallback(() => {
    // Compound path handled elsewhere; suppress page toast
    if (isCompoundInProgressRef.current) {
      isCompoundInProgressRef.current = false;
      return;
    }
    // Only react to an explicit decrease/withdraw action in progress
    if (pendingActionRef.current?.type !== 'decrease' && pendingActionRef.current?.type !== 'withdraw') return;
    
    // Prevent rapid revalidations (cooldown: 30 seconds)
    const now = Date.now();
    if (now - lastRevalidationRef.current < 30000) {
      console.log('Skipping revalidation due to cooldown');
      return;
    }
    lastRevalidationRef.current = now;
    
    const closing = isFullBurn || isFullWithdraw;
    toast.success(closing ? "Position Closed" : "Position Decreased", { icon: <BadgeCheck className="h-4 w-4 text-green-500" /> });
    setShowBurnConfirmDialog(false);
    setPositionToBurn(null);
    pendingActionRef.current = null;
    // Ensure TVL/Volume reflects the removal: single invalidate + wait-for-head + refetch
    try {
      setIsLoadingChartData(true);
      (async () => {
        try {
          const targetBlock = Number(await publicClient.getBlockNumber());
          await waitForSubgraphBlock(targetBlock, { timeoutMs: 15000, minWaitMs: 800, maxIntervalMs: 1000 });
          try { fetch('/api/internal/revalidate-pools', { method: 'POST' } as any); } catch {}
          try {
            const base = getPoolConfiguration(poolId);
            const subId = (base?.subgraphId || '').toLowerCase();
            fetch('/api/internal/revalidate-chart', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ poolId, subgraphId: subId })
            } as any);
          } catch {}
          await fetchPageData(true, /* skipPositions */ true, /* keepLoading */ false);
        } finally {
                setIsLoadingChartData(false);
        }
      })();
      // positions backoff can remain lightweight
      // try { backoffRefreshPositions(); } catch {} // Temporarily disabled to prevent infinite loops
    } catch {}
  }, [isFullBurn, isFullWithdraw, poolId, fetchPageData, backoffRefreshPositions]);

  // Initialize the liquidity modification hooks (moved here after callback definitions)
  const { burnLiquidity, isLoading: isBurningLiquidity } = useBurnLiquidity({
    onLiquidityBurned: onLiquidityBurnedCallback
  });

  const { increaseLiquidity, isLoading: isIncreasingLiquidity } = useIncreaseLiquidity({
    onLiquidityIncreased: onLiquidityIncreasedCallback,
  });

  const pendingCompoundRef = useRef<null | { position: ProcessedPosition; raw0: string; raw1: string }>(null);

  const { decreaseLiquidity, compoundFees, isLoading: isDecreasingLiquidity } = useDecreaseLiquidity({
    onLiquidityDecreased: onLiquidityDecreasedCallback,
    onFeesCollected: () => {
      const pending = pendingCompoundRef.current;
      if (pending && pending.position && pending.raw0 && pending.raw1) {
        try {
          const pos = pending.position;
          const token0Def = TOKEN_DEFINITIONS[pos.token0.symbol as TokenSymbol];
          const token1Def = TOKEN_DEFINITIONS[pos.token1.symbol as TokenSymbol];
          // Strictly round down by reducing 1 wei if non-zero to avoid any rounding up edge cases
          const raw0 = BigInt(pending.raw0);
          const raw1 = BigInt(pending.raw1);
          const raw0Floored = raw0 > 0n ? raw0 - 1n : 0n;
          const raw1Floored = raw1 > 0n ? raw1 - 1n : 0n;
          const amt0Str = token0Def ? formatUnits(raw0Floored, token0Def.decimals) : '0';
          const amt1Str = token1Def ? formatUnits(raw1Floored, token1Def.decimals) : '0';

          const incData: IncreasePositionData = {
            tokenId: pos.positionId,
            token0Symbol: pos.token0.symbol as TokenSymbol,
            token1Symbol: pos.token1.symbol as TokenSymbol,
            additionalAmount0: amt0Str,
            additionalAmount1: amt1Str,
            poolId: pos.poolId,
            tickLower: pos.tickLower,
            tickUpper: pos.tickUpper,
          };

          pendingCompoundRef.current = null;
          increaseLiquidity(incData);
          // Only show once per compound flow
          if (pendingActionRef.current?.type !== 'compound') {
            pendingActionRef.current = { type: 'compound' };
          }
          toast.success("Compounding Fees", { icon: <BadgeCheck className="h-4 w-4 text-green-500" /> });
        } catch (e) {
          console.error('Compound follow-up failed:', e);
          pendingCompoundRef.current = null;
          toast.error("Failed to compound after collection", { icon: <OctagonX className="h-4 w-4 text-red-500" /> });
        }
      } else {
        if (pendingActionRef.current?.type === 'collect') {
          toast.success("Fees Collected", { icon: <BadgeCheck className="h-4 w-4 text-green-500" /> });
          pendingActionRef.current = null;
        }
      }
    },
  });

  // Handle confirmation lifecycle for SDK-based collect (claim fees / compound)
  useEffect(() => {
    if (!isCollectConfirmed || !collectHash) return;
    // de-dupe by tx hash so we don't double-handle on re-render
    if (handledCollectHashRef.current === collectHash) return;
    handledCollectHashRef.current = collectHash;
    const pending = pendingCompoundRef.current;
    if (pending && pending.position && pending.raw0 && pending.raw1) {
      try {
        const pos = pending.position;
        const token0Def = TOKEN_DEFINITIONS[pos.token0.symbol as TokenSymbol];
        const token1Def = TOKEN_DEFINITIONS[pos.token1.symbol as TokenSymbol];
        const raw0 = BigInt(pending.raw0);
        const raw1 = BigInt(pending.raw1);
        const raw0Floored = raw0 > 0n ? raw0 - 1n : 0n;
        const raw1Floored = raw1 > 0n ? raw1 - 1n : 0n;
        const amt0Str = token0Def ? formatUnits(raw0Floored, token0Def.decimals) : '0';
        const amt1Str = token1Def ? formatUnits(raw1Floored, token1Def.decimals) : '0';
        const incData: IncreasePositionData = {
          tokenId: pos.positionId,
          token0Symbol: pos.token0.symbol as TokenSymbol,
          token1Symbol: pos.token1.symbol as TokenSymbol,
          additionalAmount0: amt0Str,
          additionalAmount1: amt1Str,
          poolId: pos.poolId,
          tickLower: pos.tickLower,
          tickUpper: pos.tickUpper,
        };
        pendingCompoundRef.current = null;
        increaseLiquidity(incData);
        if (!isCompoundInProgressRef.current) {
          toast.success('Compounding Fees', { icon: <BadgeCheck className="h-4 w-4 text-green-500" /> });
        }
      } catch (e) {
        console.error('Compound follow-up failed (SDK path):', e);
        pendingCompoundRef.current = null;
        toast.error('Failed to compound after collection', { icon: <OctagonX className="h-4 w-4 text-red-500" /> });

      }
    } else {
      if (pendingActionRef.current?.type === 'collect') {
        toast.success('Fees Collected', { icon: <BadgeCheck className="h-4 w-4 text-green-500" /> });
      }
    }

    setCollectHash(undefined);
  }, [isCollectConfirmed, collectHash, increaseLiquidity]);

  // Watch for new positions actually appearing compared to baseline captured at skeleton creation
  useEffect(() => {
    if (pendingNewPositions.length === 0) return;

    // Build a set of current IDs for fast lookup
    const currentIds = new Set(userPositions.map(p => p.positionId));

    // Determine if any skeleton has its corresponding new ID(s) materialized beyond its baseline
    const shouldRemove = pendingNewPositions.some(skel => {
      if (!skel.baselineIds || skel.baselineIds.length === 0) {
        return userPositions.length > 0;
      }
      
      // New IDs are those present now but not in baseline
      const newIdsNow = userPositions
        .map(p => p.positionId)
        .filter(id => !skel.baselineIds!.includes(id));
      
      if (newIdsNow.length === 0) return false;
      // Optional: require minimal SDK fields to be present on at least one new position
      const hasSdkData = userPositions.some(p => newIdsNow.includes(p.positionId) &&
        p.token0?.amount !== undefined && p.token1?.amount !== undefined &&
        p.tickLower !== undefined && p.tickUpper !== undefined);
      return hasSdkData || newIdsNow.length > 0;
    });

    if (shouldRemove) {
      // Defer one paint to ensure the DOM has committed the new cards
      requestAnimationFrame(() => {
            setPendingNewPositions([]);
      });
    }
  }, [userPositions, pendingNewPositions]);

  useEffect(() => {
    fetchPageData();
  }, [poolId, isConnected, accountAddress]); // Depend on stable values instead of fetchPageData function

  // Calculate total liquidity value
  const totalLiquidity = userPositions.reduce((sum, pos) => sum + calculatePositionUsd(pos), 0);

  // Handle withdraw position
  const handleBurnPosition = (position: ProcessedPosition) => {
    if (!position.positionId || !position.token0.symbol || !position.token1.symbol) {
      toast.error("Cannot withdraw position: Missing critical position data (ID or token symbols).");
      return;
    }
    setPositionToBurn(position);
    // Reset withdraw state
    setWithdrawAmount0("");
    setWithdrawAmount1("");
    setWithdrawActiveInputSide(null);
    setIsFullWithdraw(false);
    setWithdrawPercentage(0);
    pendingActionRef.current = { type: 'burn' };
    setShowBurnConfirmDialog(true);
  };

  const confirmBurnPosition = () => {
    if (positionToBurn && positionToBurn.positionId && positionToBurn.token0.symbol && positionToBurn.token1.symbol) {
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
      
      const token0Symbol = getTokenSymbolByAddress(positionToBurn.token0.address);
      const token1Symbol = getTokenSymbolByAddress(positionToBurn.token1.address);
      
      if (!token0Symbol || !token1Symbol) {
        toast.error("Token definitions not found for position tokens. Addresses: " + 
          `${positionToBurn.token0.address}, ${positionToBurn.token1.address}`);
        return;
      }

      const burnData: BurnPositionData = {
        tokenId: positionToBurn.positionId,
        token0Symbol: token0Symbol,
        token1Symbol: token1Symbol,
        poolId: positionToBurn.poolId,
        tickLower: positionToBurn.tickLower,
        tickUpper: positionToBurn.tickUpper,
      };
      burnLiquidity(burnData);
    }
    // Modal will close automatically when transaction completes via onLiquidityBurnedCallback
  };

  // Handle increase position
  const handleIncreasePosition = (position: ProcessedPosition) => {
    if (!position.positionId || !position.token0.symbol || !position.token1.symbol) {
      toast.error("Cannot increase position: Missing critical position data (ID or token symbols).");
      return;
    }
    setPositionToModify(position);
    // Reset increase state
    setIncreaseAmount0("");
    setIncreaseAmount1("");
    // Enforce single-sided on open for out-of-range positions
    if (!position.isInRange) {
      // Use live pool tick if available; otherwise infer from ticks
      const tick = currentPoolTick;
      const below = tick !== null ? tick < position.tickLower : position.tickLower > 0;
      const above = tick !== null ? tick > position.tickUpper : position.tickUpper < 0;
      if (below) {
        // Only token0 is productive
        setIncreaseActiveInputSide('amount0');
        setIncreaseAmount1('0');
      } else if (above) {
        // Only token1 is productive
        setIncreaseActiveInputSide('amount1');
        setIncreaseAmount0('0');
      } else {
        setIncreaseActiveInputSide(null);
      }
    } else {
      setIncreaseActiveInputSide(null);
    }
    setIncreasePercentage(0);
    setIsIncreaseAmountValid(true);
    setShowIncreaseModal(true);
  };

  // Handle decrease position
  const handleDecreasePosition = (position: ProcessedPosition) => {
    if (!position.positionId || !position.token0.symbol || !position.token1.symbol) {
      toast.error("Cannot decrease position: Missing critical position data (ID or token symbols).");
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

  // Calculate corresponding amount for increase
  const calculateIncreaseAmount = useCallback(
    debounce(async (inputAmount: string, inputSide: 'amount0' | 'amount1') => {
      const version = ++increaseCalcVersionRef.current;
      if (!positionToModify || !inputAmount || parseFloat(inputAmount) <= 0) {
        if (inputSide === 'amount0') setIncreaseAmount1("");
        else setIncreaseAmount0("");
        return;
      }

      setIsIncreaseCalculating(true);
      try {
        // For out-of-range positions, use single-token approach immediately
        if (!positionToModify.isInRange) {
          console.log("Position is out of range, using single-token approach");
          if (inputSide === 'amount0') {
            setIncreaseAmount1("0");
          } else {
            setIncreaseAmount0("0");
          }
          setIsIncreaseCalculating(false);
          return;
        }

        // In-range: compute counterpart amount via API for good UX
        const calcResponse = await fetch('/api/liquidity/calculate-liquidity-parameters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token0Symbol: positionToModify.token0.symbol,
            token1Symbol: positionToModify.token1.symbol,
            inputAmount: inputAmount,
            inputTokenSymbol: inputSide === 'amount0' ? positionToModify.token0.symbol : positionToModify.token1.symbol,
            userTickLower: positionToModify.tickLower,
            userTickUpper: positionToModify.tickUpper,
            chainId: chainId,
          }),
        });

        if (!calcResponse.ok) {
          const errorData = await calcResponse.json();
          throw new Error(errorData.message || 'Failed to calculate parameters.');
        }

        const result = await calcResponse.json();
        if (version !== increaseCalcVersionRef.current) return; // stale response, drop

        if (inputSide === 'amount0') {
          const amount1InWei = result.amount1;
          const token1Decimals = TOKEN_DEFINITIONS[positionToModify.token1.symbol as TokenSymbol]?.decimals || 18;
          const formattedAmount1 = formatUnits(BigInt(amount1InWei), token1Decimals);
          setIncreaseAmount1(formatTokenDisplayAmount(formattedAmount1));
        } else {
          const amount0InWei = result.amount0;
          const token0Decimals = TOKEN_DEFINITIONS[positionToModify.token0.symbol as TokenSymbol]?.decimals || 18;
          const formattedAmount0 = formatUnits(BigInt(amount0InWei), token0Decimals);
          setIncreaseAmount0(formatTokenDisplayAmount(formattedAmount0));
        }
      } catch (error: any) {
        console.error("Error calculating increase amount:", error);
        toast.error("Calculation Error", { description: error.message || "Could not calculate corresponding amount." });
        if (inputSide === 'amount0') setIncreaseAmount1("");
        else setIncreaseAmount0("");
      } finally {
        setIsIncreaseCalculating(false);
      }
    }, 500),
    [positionToModify, chainId]
  );

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
          console.log("Position is out of range, using single-token withdrawal approach");
          
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
        toast.error("Calculation Error", { description: error.message || "Could not calculate corresponding amount." });
        if (inputSide === 'amount0') setDecreaseAmount1("");
        else setDecreaseAmount0("");
      } finally {
        setIsDecreaseCalculating(false);
      }
    }, 500),
    [positionToModify, chainId, decreaseAmount0, decreaseAmount1]
  );

  // Calculate corresponding amount for withdraw
  const calculateWithdrawAmount = useCallback(
    debounce(async (inputAmount: string, inputSide: 'amount0' | 'amount1') => {
      const version = ++withdrawCalcVersionRef.current;
      if (!positionToBurn || !inputAmount || parseFloat(inputAmount) <= 0) {
        if (inputSide === 'amount0') setWithdrawAmount1("");
        else setWithdrawAmount0("");
        return;
      }

      try {
        // For out-of-range positions, allow single-token withdrawal
        if (!positionToBurn.isInRange) {
          console.log("Position is out of range, using single-token withdrawal approach");
          
          const maxAmount0 = parseFloat(positionToBurn.token0.amount);
          const maxAmount1 = parseFloat(positionToBurn.token1.amount);
          const inputAmountNum = parseFloat(inputAmount);
          
          // For out-of-range positions, enforce single-sided and do not auto-fill the other token
          if (inputSide === 'amount0') {
            setWithdrawAmount1("0");
            setIsFullWithdraw(inputAmountNum >= maxAmount0 * 0.99);
          } else {
            setWithdrawAmount0("0");
            setIsFullWithdraw(inputAmountNum >= maxAmount1 * 0.99);
          }
          
          return;
        }

        // In-range: prefill counterpart amount for UX
        const calcResponse = await fetch('/api/liquidity/calculate-liquidity-parameters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token0Symbol: positionToBurn.token0.symbol,
            token1Symbol: positionToBurn.token1.symbol,
            inputAmount: inputAmount,
            inputTokenSymbol: inputSide === 'amount0' ? positionToBurn.token0.symbol : positionToBurn.token1.symbol,
            userTickLower: positionToBurn.tickLower,
            userTickUpper: positionToBurn.tickUpper,
            chainId: chainId,
          }),
        });

        if (!calcResponse.ok) {
          const errorData = await calcResponse.json();
          throw new Error(errorData.message || 'Failed to calculate parameters.');
        }

        const result = await calcResponse.json();
        if (version !== withdrawCalcVersionRef.current) return; // stale response, drop

        if (inputSide === 'amount0') {
          const amount1InWei = result.amount1;
          const token1Decimals = TOKEN_DEFINITIONS[positionToBurn.token1.symbol as TokenSymbol]?.decimals || 18;
          const formattedAmount1 = formatUnits(BigInt(amount1InWei), token1Decimals);
          setWithdrawAmount1(formatTokenDisplayAmount(formattedAmount1));
        } else {
          const amount0InWei = result.amount0;
          const token0Decimals = TOKEN_DEFINITIONS[positionToBurn.token0.symbol as TokenSymbol]?.decimals || 18;
          const formattedAmount0 = formatUnits(BigInt(amount0InWei), token0Decimals);
          setWithdrawAmount0(formatTokenDisplayAmount(formattedAmount0));
        }

        // Check if this is effectively a full withdraw
        const maxAmount0 = parseFloat(positionToBurn.token0.amount);
        const maxAmount1 = parseFloat(positionToBurn.token1.amount);
        const inputAmount0 = inputSide === 'amount0' ? parseFloat(inputAmount) : parseFloat(withdrawAmount0);
        const inputAmount1 = inputSide === 'amount1' ? parseFloat(inputAmount) : parseFloat(withdrawAmount1);
        
        const isNearFullWithdraw = (inputAmount0 >= maxAmount0 * 0.99) || (inputAmount1 >= maxAmount1 * 0.99);
        setIsFullWithdraw(isNearFullWithdraw);
      } catch (error: any) {
        console.error("Error calculating withdraw amount:", error);
        toast.error("Calculation Error", { description: error.message || "Could not calculate corresponding amount." });
        if (inputSide === 'amount0') setWithdrawAmount1("");
        else setWithdrawAmount0("");
      }
    }, 500),
    [positionToBurn, chainId, withdrawAmount0, withdrawAmount1]
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

  // Handle max button clicks for withdraw
  const handleMaxWithdraw = (tokenSide: 'amount0' | 'amount1') => {
    if (!positionToBurn) return;
    
    if (tokenSide === 'amount0') {
      setWithdrawAmount0(positionToBurn.token0.amount);
      setWithdrawAmount1(positionToBurn.token1.amount);
    } else {
      setWithdrawAmount1(positionToBurn.token1.amount);
      setWithdrawAmount0(positionToBurn.token0.amount);
    }
    setWithdrawActiveInputSide(tokenSide);
    setIsFullWithdraw(true);
    // Update slider to 100% when using max
    setWithdrawPercentage(100);
  };

  // Handle use full balance
  const handleUseFullBalance = (balanceString: string, tokenSymbolForDecimals: TokenSymbol, isToken0: boolean) => { 
    try {
      const numericBalance = parseFloat(balanceString);
      if (isNaN(numericBalance) || numericBalance <= 0) return;

      const formattedBalance = numericBalance.toFixed(TOKEN_DEFINITIONS[tokenSymbolForDecimals]?.decimals || 18);

      if (isToken0) {
        setIncreaseAmount0(formattedBalance);
        setIncreaseActiveInputSide('amount0');
        // Trigger calculation for the other side
        calculateIncreaseAmount(formattedBalance, 'amount0');
      } else { 
        setIncreaseAmount1(formattedBalance);
        setIncreaseActiveInputSide('amount1');
        // Trigger calculation for the other side
        calculateIncreaseAmount(formattedBalance, 'amount1');
      }
      // Update slider to 100% when using full balance
      setIncreasePercentage(100);
    } catch (error) {
      // Handle error
    }
  };

  // Helper function to snap to sticky stops
  const snapToStickyStops = (value: number): number => {
    const stickyStops = [25, 50, 75, 100];
    const snapZone = 3; // 3% snap zone around each stop
    
    for (const stop of stickyStops) {
      if (Math.abs(value - stop) <= snapZone) {
        return stop;
      }
    }
    return value;
  };

  // Clean slider handlers
  const handleWithdrawPercentageChange = (newPercentage: number) => {
    const snappedPercentage = snapToStickyStops(newPercentage);
    setWithdrawPercentage(snappedPercentage);
    
    if (positionToBurn) {
      const amount0 = parseFloat(positionToBurn.token0.amount);
      const amount1 = parseFloat(positionToBurn.token1.amount);
      const percentage = snappedPercentage / 100; // percentage of max

      // Special-case: 100% must map to exact full position amounts (no rounding)
      if (snappedPercentage === 100) {
        setIsFullWithdraw(true);
        if (!positionToBurn.isInRange) {
          // Single-sided UX when out of range
          if (withdrawProductiveSide === 'amount0') {
            setWithdrawAmount0(positionToBurn.token0.amount);
            setWithdrawAmount1('0');
            setWithdrawActiveInputSide('amount0');
          } else if (withdrawProductiveSide === 'amount1') {
            setWithdrawAmount1(positionToBurn.token1.amount);
            setWithdrawAmount0('0');
            setWithdrawActiveInputSide('amount1');
          } else {
            // Fallback if unknown: preserve current side behavior
            setWithdrawAmount0(positionToBurn.token0.amount);
            setWithdrawAmount1(positionToBurn.token1.amount);
            setWithdrawActiveInputSide('amount0');
          }
          return;
        }
        if (amount0 > 0 && amount1 > 0) {
          setWithdrawAmount0(positionToBurn.token0.amount);
          setWithdrawAmount1(positionToBurn.token1.amount);
          setWithdrawActiveInputSide('amount0');
        } else if (amount0 > 0) {
          setWithdrawAmount0(positionToBurn.token0.amount);
          setWithdrawAmount1('0');
          setWithdrawActiveInputSide('amount0');
        } else if (amount1 > 0) {
          setWithdrawAmount1(positionToBurn.token1.amount);
          setWithdrawAmount0('0');
          setWithdrawActiveInputSide('amount1');
        } else {
          setWithdrawAmount0('');
          setWithdrawAmount1('');
        }
        return;
      }

      setIsFullWithdraw(snappedPercentage >= 99);

      if (amount0 > 0 && amount1 > 0) {
        const displayDecimals0 = TOKEN_DEFINITIONS[positionToBurn.token0.symbol as TokenSymbol]?.displayDecimals ?? 4;
        const calculatedAmount0 = (amount0 * percentage).toFixed(displayDecimals0);
        setWithdrawAmount0(calculatedAmount0);
        setWithdrawActiveInputSide('amount0');
        if (parseFloat(calculatedAmount0) > 0) {
          calculateWithdrawAmount(calculatedAmount0, 'amount0');
        } else {
          setWithdrawAmount1('');
        }
      } else if (amount1 > 0) {
        const displayDecimals1 = TOKEN_DEFINITIONS[positionToBurn.token1.symbol as TokenSymbol]?.displayDecimals ?? 4;
        const calculatedAmount1 = (amount1 * percentage).toFixed(displayDecimals1);
        setWithdrawAmount1(calculatedAmount1);
        setWithdrawActiveInputSide('amount1');
        setWithdrawAmount0('0');
        if (parseFloat(calculatedAmount1) > 0) {
          calculateWithdrawAmount(calculatedAmount1, 'amount1');
        } else {
          setWithdrawAmount0('');
        }
      } else if (amount0 > 0) {
        const displayDecimals0 = TOKEN_DEFINITIONS[positionToBurn.token0.symbol as TokenSymbol]?.displayDecimals ?? 4;
        const calculatedAmount0 = (amount0 * percentage).toFixed(displayDecimals0);
        setWithdrawAmount0(calculatedAmount0);
        setWithdrawActiveInputSide('amount0');
        setWithdrawAmount1('0');
        if (parseFloat(calculatedAmount0) > 0) {
          calculateWithdrawAmount(calculatedAmount0, 'amount0');
        } else {
          setWithdrawAmount1('');
        }
      } else {
        setWithdrawAmount0('');
        setWithdrawAmount1('');
      }
    }
  };

  const handleWithdrawAmountChange = (newAmount: string, tokenSide: 'amount0' | 'amount1') => {
    if (tokenSide === 'amount0') {
      setWithdrawAmount0(newAmount);
    } else {
      setWithdrawAmount1(newAmount);
    }
    
    if (positionToBurn && newAmount) {
      const maxAmount = tokenSide === 'amount0' 
        ? parseFloat(positionToBurn.token0.amount)
        : parseFloat(positionToBurn.token1.amount);
      
      const currentAmount = parseFloat(newAmount);
      if (maxAmount > 0 && !isNaN(currentAmount)) {
        const percentage = Math.min(100, Math.max(0, (currentAmount / maxAmount) * 100));
        setWithdrawPercentage(Math.round(percentage));
        setIsFullWithdraw(percentage >= 99);
      }
    }
  };

  const handleIncreasePercentageChange = (newPercentage: number) => {
    const snappedPercentage = snapToStickyStops(newPercentage);
    setIncreasePercentage(snappedPercentage);
    
    const balance0 = parseFloat(token0BalanceData?.formatted || "0");
    const balance1 = parseFloat(token1BalanceData?.formatted || "0");
    const percentage = snappedPercentage / 100;

    // Special-case: 100% must map to exact full wallet balance on the anchor side
    if (snappedPercentage === 100) {
      if (balance0 > 0 && balance1 > 0) {
        const full0 = token0BalanceData?.formatted || '0';
        setIncreaseAmount0(full0);
        setIncreaseActiveInputSide('amount0');
        if (parseFloat(full0) > 0) {
          calculateIncreaseAmount(full0, 'amount0');
        } else {
          setIncreaseAmount1('');
        }
      } else if (balance1 > 0) {
        const full1 = token1BalanceData?.formatted || '0';
        setIncreaseAmount1(full1);
        setIncreaseActiveInputSide('amount1');
        setIncreaseAmount0('0');
        if (parseFloat(full1) > 0) {
          calculateIncreaseAmount(full1, 'amount1');
        } else {
          setIncreaseAmount0('');
        }
      } else if (balance0 > 0) {
        const full0 = token0BalanceData?.formatted || '0';
        setIncreaseAmount0(full0);
        setIncreaseActiveInputSide('amount0');
        setIncreaseAmount1('0');
        if (parseFloat(full0) > 0) {
          calculateIncreaseAmount(full0, 'amount0');
        } else {
          setIncreaseAmount1('');
        }
      } else {
        setIncreaseAmount0('');
        setIncreaseAmount1('');
      }
      return;
    }

    if (balance0 > 0 && balance1 > 0) {
      const displayDecimals0 = TOKEN_DEFINITIONS[positionToModify?.token0.symbol as TokenSymbol]?.displayDecimals ?? 4;
      const calculatedAmount0 = (balance0 * percentage).toFixed(displayDecimals0);
      setIncreaseAmount0(calculatedAmount0);
      setIncreaseActiveInputSide('amount0');
      if (parseFloat(calculatedAmount0) > 0) {
        calculateIncreaseAmount(calculatedAmount0, 'amount0');
      } else {
        setIncreaseAmount1("");
      }
    } else if (balance1 > 0) {
      const displayDecimals1 = TOKEN_DEFINITIONS[positionToModify?.token1.symbol as TokenSymbol]?.displayDecimals ?? 4;
      const calculatedAmount1 = (balance1 * percentage).toFixed(displayDecimals1);
      setIncreaseAmount1(calculatedAmount1);
      setIncreaseActiveInputSide('amount1');
      setIncreaseAmount0('0');
      if (parseFloat(calculatedAmount1) > 0) {
        calculateIncreaseAmount(calculatedAmount1, 'amount1');
      } else {
        setIncreaseAmount0('');
      }
    } else if (balance0 > 0) {
      const displayDecimals0 = TOKEN_DEFINITIONS[positionToModify?.token0.symbol as TokenSymbol]?.displayDecimals ?? 4;
      const calculatedAmount0 = (balance0 * percentage).toFixed(displayDecimals0);
      setIncreaseAmount0(calculatedAmount0);
      setIncreaseActiveInputSide('amount0');
      setIncreaseAmount1('0');
      if (parseFloat(calculatedAmount0) > 0) {
        calculateIncreaseAmount(calculatedAmount0, 'amount0');
      } else {
        setIncreaseAmount1('');
      }
    } else {
      setIncreaseAmount0('');
      setIncreaseAmount1('');
    }
  };

  const handleIncreaseAmountChange = (newAmount: string, tokenSide: 'amount0' | 'amount1') => {
    if (tokenSide === 'amount0') {
      setIncreaseAmount0(newAmount);
      setIncreaseActiveInputSide('amount0');
    } else {
      setIncreaseAmount1(newAmount);
      setIncreaseActiveInputSide('amount1');
    }
    
    // Out-of-range: prohibit input on the non-active token
    if (positionToModify && !positionToModify.isInRange) {
      if (tokenSide === 'amount0') {
        setIncreaseAmount1('0');
      } else {
        setIncreaseAmount0('0');
      }
    }

    if (newAmount) {
      const maxAmount = tokenSide === 'amount0' 
        ? parseFloat(token0BalanceData?.formatted || "0")
        : parseFloat(token1BalanceData?.formatted || "0");
      
      const currentAmount = parseFloat(newAmount);
      if (maxAmount > 0 && !isNaN(currentAmount)) {
        const percentage = Math.min(100, Math.max(0, (currentAmount / maxAmount) * 100));
        setIncreasePercentage(Math.round(percentage));
        setIsIncreaseAmountValid(currentAmount <= maxAmount);
      } else {
        setIsIncreaseAmountValid(true);
      }
    } else {
      setIsIncreaseAmountValid(true);
    }
  };

  // Handle increase transaction
  const handleConfirmIncrease = () => {
    if (!positionToModify || (!increaseAmount0 && !increaseAmount1)) {
      toast.error("Please enter at least one amount to add");
      return;
    }
    
    // For out-of-range positions, ensure at least one amount is greater than 0
    if (!positionToModify.isInRange) {
      const amount0Num = parseFloat(increaseAmount0 || "0");
      const amount1Num = parseFloat(increaseAmount1 || "0");
      if (amount0Num <= 0 && amount1Num <= 0) {
        toast.error("Please enter a valid amount to add");
        return;
      }
      // Enforce only one side (single-sided) when out-of-range
      if (amount0Num > 0 && amount1Num > 0) {
        if (increaseActiveInputSide === 'amount0') setIncreaseAmount1('0');
        else setIncreaseAmount0('0');
      }
    }

    const increaseData: IncreasePositionData = {
      tokenId: positionToModify.positionId,
      token0Symbol: positionToModify.token0.symbol as TokenSymbol,
      token1Symbol: positionToModify.token1.symbol as TokenSymbol,
      additionalAmount0: increaseAmount0 || "0",
      additionalAmount1: increaseAmount1 || "0",
      poolId: positionToModify.poolId,
      tickLower: positionToModify.tickLower,
      tickUpper: positionToModify.tickUpper,
    };

    pendingActionRef.current = { type: 'increase' };
    increaseLiquidity(increaseData);
    // Keep modal open until success/failure callback closes it
  };

  // Handle decrease transaction
  const handleConfirmDecrease = () => {
    if (!positionToModify || (!decreaseAmount0 && !decreaseAmount1)) {
      toast.error("Please enter at least one amount to remove");
      return;
    }
    
    // For out-of-range positions, ensure at least one amount is greater than 0
    if (!positionToModify.isInRange) {
      const amount0Num = parseFloat(decreaseAmount0 || "0");
      const amount1Num = parseFloat(decreaseAmount1 || "0");
      if (amount0Num <= 0 && amount1Num <= 0) {
        toast.error("Please enter a valid amount to remove");
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
      toast.error("Token definitions not found for position tokens. Addresses: " + 
        `${positionToModify.token0.address}, ${positionToModify.token1.address}`);
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

  // Handle withdraw transaction
  const handleConfirmWithdraw = () => {
    if (!positionToBurn || (!withdrawAmount0 && !withdrawAmount1)) {
      toast.error("Please enter at least one amount to withdraw");
      return;
    }
    // Prevent over-withdraw relative to position balances
    const max0 = parseFloat(positionToBurn.token0.amount || '0');
    const max1 = parseFloat(positionToBurn.token1.amount || '0');
    const in0 = parseFloat(withdrawAmount0 || '0');
    const in1 = parseFloat(withdrawAmount1 || '0');
    if ((in0 > max0 + 1e-12) || (in1 > max1 + 1e-12)) {
      toast.error("Invalid Withdraw Amount", { description: "Amount exceeds position balance." });
      return;
    }
    
    // For out-of-range positions, ensure at least one amount is greater than 0
    if (!positionToBurn.isInRange) {
      const amount0Num = parseFloat(withdrawAmount0 || "0");
      const amount1Num = parseFloat(withdrawAmount1 || "0");
      if (amount0Num <= 0 && amount1Num <= 0) {
        toast.error("Please enter a valid amount to withdraw");
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
    
    const token0Symbol = getTokenSymbolByAddress(positionToBurn.token0.address);
    const token1Symbol = getTokenSymbolByAddress(positionToBurn.token1.address);
    
    if (!token0Symbol || !token1Symbol) {
      toast.error("Token definitions not found for position tokens. Addresses: " + 
        `${positionToBurn.token0.address}, ${positionToBurn.token1.address}`);
      return;
    }

    // Compute effective percentage and full-burn intent from current inputs (authoritative)
    const amt0 = parseFloat(withdrawAmount0 || '0');
    const amt1 = parseFloat(withdrawAmount1 || '0');
    const max0Eff = parseFloat(positionToBurn.token0.amount || '0');
    const max1Eff = parseFloat(positionToBurn.token1.amount || '0');
    const pct0 = max0Eff > 0 ? amt0 / max0Eff : 0;
    const pct1 = max1Eff > 0 ? amt1 / max1Eff : 0;
    const effectivePct = Math.max(pct0, pct1) * 100;
    const nearFull0 = max0Eff > 0 ? pct0 >= 0.99 : true;
    const nearFull1 = max1Eff > 0 ? pct1 >= 0.99 : true;
    const isBurnAllEffective = positionToBurn.isInRange ? (nearFull0 && nearFull1) : (pct0 >= 0.99 || pct1 >= 0.99);

    const withdrawData: DecreasePositionData = {
      tokenId: positionToBurn.positionId,
      token0Symbol: token0Symbol,
      token1Symbol: token1Symbol,
      decreaseAmount0: withdrawAmount0 || "0",
      decreaseAmount1: withdrawAmount1 || "0",
      isFullBurn: isBurnAllEffective,
      poolId: positionToBurn.poolId,
      tickLower: positionToBurn.tickLower,
      tickUpper: positionToBurn.tickUpper,
      enteredSide: withdrawActiveInputSide === 'amount0' ? 'token0' : withdrawActiveInputSide === 'amount1' ? 'token1' : undefined,
    };

    // In-range: use percentage flow (SDK), OOR: amounts mode
    pendingActionRef.current = { type: 'withdraw' };
    if (positionToBurn.isInRange) {
      const pctRounded = isBurnAllEffective ? 100 : Math.max(0, Math.min(100, Math.round(effectivePct)));
      decreaseLiquidity(withdrawData, pctRounded);
    } else {
      decreaseLiquidity(withdrawData, 0);
    }
    // Modal will close automatically when transaction completes via onLiquidityDecreasedCallback
  };

  // Early return for loading state AFTER all hooks have been called
  if (!poolId || !currentPoolData) return (
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
        <div className="flex flex-1 flex-col p-3 sm:p-6 sm:px-10 max-w-full overflow-hidden">

          
          {/* Main content area with two columns (row layout only at >=1500px) */}
          <div className="flex flex-col min-[1500px]:flex-row gap-6 min-w-0 max-w-full overflow-hidden">
            {/* Left Column: Header + Graph (flexible, takes remaining space) */}
            <div ref={leftColumnRef} className="flex-1 min-w-0 flex flex-col space-y-3">
          {/* Header: Token info container + Stats in dotted container */}
          <div className="mt-3 sm:mt-0">
            {windowWidth < 768 ? (
              <div className="space-y-3 overflow-x-hidden mb-6">
                {/* Identification above for mobile */}
                <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 cursor-pointer"
                     onClick={() => router.push('/liquidity')}
                     role="button"
                     tabIndex={0}
                     onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push('/liquidity'); } }}>
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
                              <span className="px-1.5 py-0.5 text-xs font-normal rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-muted-foreground" style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
                                {getPoolById(poolId)?.type || (currentPoolData as any)?.type}
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {(() => {
                                if (currentPoolData.dynamicFeeBps === undefined) return "Loading...";
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
                </div>
                {/* Dotted container grid 2x2 */}
                <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-4 mb-4 w-full">
                  <div className="grid grid-cols-2 gap-3">
                    {/* Volume */}
                    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
                      <div className="flex items-center justify-between px-4 h-9">
                        <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">VOLUME (24H)</h2>
                      </div>
                      <div className="px-4 py-1"><div className="text-lg font-medium truncate">{currentPoolData.volume24h}</div></div>
                    </div>
                    {/* Fees */}
                    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
                      <div className="flex items-center justify-between px-4 h-9">
                        <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">FEES (24H)</h2>
                      </div>
                      <div className="px-4 py-1"><div className="text-lg font-medium truncate">{currentPoolData.fees24h}</div></div>
                    </div>
                    {/* TVL */}
                    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
                      <div className="flex items-center justify-between px-4 h-9">
                        <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">TVL</h2>
                      </div>
                      <div className="px-4 py-1"><div className="text-lg font-medium truncate">{currentPoolData.liquidity}</div></div>
                    </div>
                    {/* APY */}
                    <div className="rounded-lg bg-muted/30 border border-sidebar-border/60">
                      <div className="flex items-center justify-between px-4 h-9">
                        <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">APY</h2>
                      </div>
                      <div className="px-4 py-1"><div className="text-lg font-medium truncate">{currentPoolData.apr}</div></div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
                  <div ref={topBarRef} className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-4 mb-3 w-full overflow-hidden">
                    <div className="flex items-stretch gap-3 min-w-0 overflow-hidden">
                      {/* Token info container inside dotted container - flexible, shrinkable */}
                      <div ref={tokenInfoRef} className="min-w-0 basis-0 flex-1 overflow-hidden rounded-lg bg-muted/30 border border-sidebar-border/60 hover:border-white/30 transition-colors cursor-pointer"
                       onClick={() => router.push('/liquidity')}
                       role="button"
                       tabIndex={0}
                       onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); router.push('/liquidity'); } }}>
                        <div className="px-4 py-3 flex items-center w-full min-w-0">
                          <div className="flex items-center gap-1 min-w-0 flex-1">
                            <ChevronLeft className="h-4 w-4 text-muted-foreground mr-1 flex-shrink-0" />
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
                                <div className="flex items-center gap-3 min-w-0">
                              {(getPoolById(poolId)?.type || currentPoolData?.type) && (
                                    <span className="px-1.5 py-0.5 text-xs font-normal rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-muted-foreground flex-shrink-0" style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}>
                                  {getPoolById(poolId)?.type || (currentPoolData as any)?.type}
                                </span>
                              )}
                                  <span className="text-xs text-muted-foreground flex-shrink-0">
                                {(() => {
                                  if (currentPoolData.dynamicFeeBps === undefined) return "Loading...";
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
                  </div>

                  {/* Vertical divider */}
                      <div className="w-0 border-l border-dashed border-sidebar-border/60 self-stretch mx-1 flex-shrink-0" />

                  {/* Volume */}
                  {showVolumeCard && (
                        <div
                          className="w-[160px] flex-shrink-0 rounded-lg bg-muted/30 border border-sidebar-border/60 hover:border-white/30 transition-colors cursor-pointer"
                          onClick={() => setActiveChart('volume')}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveChart('volume'); } }}
                        >
                          <div className="flex items-center justify-between px-3 h-9">
                            <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">VOLUME (24H)</h2>
                          </div>
                          <div className="px-3 py-1">
                            <div className="text-lg font-medium truncate">{currentPoolData.volume24h}</div>
                          </div>
                        </div>
                  )}

                  {/* Fees */}
                  {showFeesCard && (
                        <div className="w-[160px] flex-shrink-0 rounded-lg bg-muted/30 border border-sidebar-border/60">
                          <div className="flex items-center justify-between px-3 h-9">
                        <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">FEES (24H)</h2>
                      </div>
                          <div className="px-3 py-1">
                        <div className="text-lg font-medium truncate">{currentPoolData.fees24h}</div>
                      </div>
                    </div>
                  )}

                  {/* TVL */}
                  {showTvlCard && (
                        <div
                          className="w-[160px] flex-shrink-0 rounded-lg bg-muted/30 border border-sidebar-border/60 hover:border-white/30 transition-colors cursor-pointer"
                          onClick={() => setActiveChart('tvl')}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveChart('tvl'); } }}
                        >
                          <div className="flex items-center justify-between px-3 h-9">
                            <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">TVL</h2>
                          </div>
                          <div className="px-3 py-1">
                            <div className="text-lg font-medium truncate">{currentPoolData.liquidity}</div>
                          </div>
                        </div>
                  )}

                      {/* APY (always) - fixed width */}
                      <div className="w-[160px] flex-shrink-0 rounded-lg bg-muted/30 border border-sidebar-border/60">
                        <div className="flex items-center justify-between px-3 h-9">
                      <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">APY</h2>
                    </div>
                        <div className="px-3 py-1">
                      <div className="text-lg font-medium truncate">{currentPoolData.apr}</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          
              {/* Pool Overview Section */}
              <div className="flex-1 min-h-0">
                <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 transition-colors flex flex-col h-full min-h-[300px] sm:min-h-[350px] sm:max-h-none">
                  <div className="flex items-center justify-between px-4 py-2 border-b border-sidebar-border/60">
                    <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">POOL ACTIVITY</h2>
                    {windowWidth < 1500 ? (
                      // Dropdown for smaller screens
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
                    ) : (
                      // Buttons for larger screens - mimic category tabs styling
                      <div className="flex items-center gap-2">
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
                    )}
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
                      ) : apiChartData.length > 0 ? (
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
                                        <div className="grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-sidebar-border bg-[#0f0f0f] px-2.5 py-1.5 text-xs shadow-xl">
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
                                    className="!bg-[#0f0f0f] !text-card-foreground border border-sidebar-border shadow-lg rounded-lg"
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
                                        <div className="grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-sidebar-border bg-[#0f0f0f] px-2.5 py-1.5 text-xs shadow-xl">
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
                                    className="!bg-[#0f0f0f] !text-card-foreground border border-sidebar-border shadow-lg rounded-lg"
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
                        <div className="flex justify-center items-center h-full text-muted-foreground">
                          No chart data available for this pool.
                        </div>
                      )}
                    </ChartContainer>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Add Liquidity Form (fixed width at >=1500px) */}
            <div className="w-full min-[1500px]:w-[450px] min-[1500px]:flex-shrink-0 min-[1500px]:min-w-[450px]">


              {poolId && currentPoolData && windowWidth >= 1500 && (
                <div className="w-full rounded-lg bg-muted/30 border border-sidebar-border/60 transition-colors overflow-hidden relative">
                  {/* Container header to match novel layout */}
                  <div className="flex items-center justify-between px-4 py-2 border-b border-sidebar-border/60">
                    <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">ADD LIQUIDITY</h2>
                  </div>
                  {/* Content */}
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
          <div className="space-y-3 lg:space-y-4 mt-6 mb-3 lg:mt-6 lg:mb-0"> {/* Mobile: top margin double bottom; desktop unchanged */}
            {/* Static title - always visible */}
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium">Your Positions</h3>
              {windowWidth < 1500 && (
                <a
                  onClick={(e) => {
                    e.stopPropagation();
                    setAddLiquidityOpen(true);
                  }}
                  className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30"
                  style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                >
                  <PlusIcon className="h-4 w-4 relative z-0" />
                  <span className="relative z-0 whitespace-nowrap">Add Liquidity</span>
                </a>
              )}
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
                  {/* Then render existing positions */}
                  {userPositions.map((position) => {
                    const estimatedCurrentTick = position.isInRange 
                      ? Math.floor((position.tickLower + position.tickUpper) / 2)
                      : (position.tickLower > 0 
                          ? position.tickLower - (10 * (currentPoolData?.tickSpacing || DEFAULT_TICK_SPACING))
                          : position.tickUpper + (10 * (currentPoolData?.tickSpacing || DEFAULT_TICK_SPACING)));



                    return (
                                                    <Card
                            key={position.positionId}
                            className="bg-muted/30 border border-sidebar-border/60 transition-all duration-300 group"
                          >
                            <CardContent className="p-3 sm:p-4 group">
                            {/* Grid layout on non-mobile; stacked on mobile */}
                              <div
                                className="grid sm:items-center"
                                style={{
                                  gridTemplateColumns: 'min-content max-content max-content max-content 1fr 5.5rem',
                                  columnGap: '1.25rem', // slightly increased equal gaps between columns
                                }}
                              >
                              {/* Column 1: Token Icons - Very narrow */}
                              <div className="flex items-center min-w-0 flex-none gap-0">
                                <TokenStack position={position} currentPoolData={currentPoolData} getToken={getToken} />
                              </div>

                              {/* Column 2: Liquidity - hide amounts on mobile to prevent width growth */}
                              <div className="flex flex-col min-w-0 items-start truncate pr-2">
                                <div className="hidden sm:flex flex-col text-xs text-muted-foreground whitespace-nowrap">
                                  <span className="truncate leading-tight">
                                    {formatTokenDisplayAmount(position.token0.amount)} {position.token0.symbol}
                                  </span>
                                  <span className="truncate leading-tight">
                                    {formatTokenDisplayAmount(position.token1.amount)} {position.token1.symbol}
                                  </span>
                                </div>
                              </div>

                              {/* Column 3: Position Value - left-bound, size-to-content */}
                              <div className="flex items-start pr-2">
                                <div className="flex flex-col gap-1 items-start">
                                  <div className="text-xs text-muted-foreground">Position Value</div>
                                  <div className="flex items-center gap-2 truncate">
                                    {isLoadingPrices ? (
                                      <span className="inline-block h-3 w-12 rounded bg-muted/40 animate-pulse align-middle" />
                                    ) : (
                                      <div className="text-xs font-medium truncate">
                                        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
                                          Number.isFinite(calculatePositionUsd(position)) ? calculatePositionUsd(position) : 0
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Column 4: Fees - left-bound, size-to-content */}
                              <div className="flex items-start pr-2">
                                <div className="flex flex-col gap-1 items-start">
                                  <div className="flex items-center gap-1">
                                    <div className="text-xs text-muted-foreground">Fees</div>
                                    <TooltipProvider delayDuration={0}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Info className="h-3 w-3 text-muted-foreground/50 hover:text-muted-foreground" />
                                        </TooltipTrigger>
                                        <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs max-w-48">
                                          <p>Claimable Fees</p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </div>
                                  <div className="flex items-center gap-2 text-xs">
                                    <FeesCell
                                      positionId={position.positionId}
                                      sym0={position.token0.symbol || 'T0'}
                                      sym1={position.token1.symbol || 'T1'}
                                      price0={getUsdPriceForSymbol(position.token0.symbol)}
                                      price1={getUsdPriceForSymbol(position.token1.symbol)}
                                      // refreshKey removed; fees now on TTL + explicit invalidation
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Column 5: Flexible spacer to push Withdraw; absorbs surplus width */}
                              <div />

                              {/* Column 6: Actions - Static Withdraw button */}
                              <div className="hidden sm:flex items-center justify-end gap-2 w-[5.5rem] flex-none">
                                <a
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleBurnPosition(position);
                                  }}
                                  className="flex h-7 cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-2 text-xs font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30"
                                  style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: '200%', backgroundPosition: 'center' }}
                                >
                                  {isBurningLiquidity && positionToBurn?.positionId === position.positionId ? (
                                    <RefreshCwIcon className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <span>Withdraw</span>
                                  )}
                                </a>
                              </div>
                            </div>
                            </CardContent>

                            {/* Footer with actions and range info */}
                            <CardFooter className="flex items-center justify-between py-1.5 px-3 bg-muted/10 border-t border-sidebar-border/30 group/subbar">
                              {/* Left side: Min price - Max price */}
                              <div className="flex items-center text-xs text-muted-foreground gap-3">
                                <TooltipProvider delayDuration={0}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="font-mono tabular-nums flex items-center gap-1.5 cursor-default">
                                        <ChevronsLeftRight className="h-3 w-3 text-muted-foreground" aria-hidden />
                                        {(() => {
                                          const baseTokenForPriceDisplay = determineBaseTokenForPriceDisplay(
                                            position.token0.symbol || '',
                                            position.token1.symbol || ''
                                          );
                                          const minPrice = convertTickToPrice(
                                            position.tickLower,
                                            currentPoolTick,
                                            currentPrice,
                                            baseTokenForPriceDisplay,
                                            position.token0.symbol || '',
                                            position.token1.symbol || ''
                                          );
                                          const maxPrice = convertTickToPrice(
                                            position.tickUpper,
                                            currentPoolTick,
                                            currentPrice,
                                            baseTokenForPriceDisplay,
                                            position.token0.symbol || '',
                                            position.token1.symbol || ''
                                          );
                                          return `${minPrice} - ${maxPrice}`;
                                        })()}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                                      <div className="font-medium text-foreground">Liquidity Range</div>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                <div className="w-px h-3 bg-border"></div>
                                <TooltipProvider delayDuration={0}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="font-mono tabular-nums flex items-center gap-1.5 cursor-default">
                                        <Clock3 className="h-2.5 w-2.5 text-muted-foreground" aria-hidden />
                                        {(() => {
                                          // Prefer immutable mint time (blockTimestamp) if available to avoid reset on modifications
                                          // Normalize potential ms timestamps to seconds to avoid negative ages
                                          const rawMintTs = Number(position.blockTimestamp || 0);
                                          const mintTs = rawMintTs > 1e12 ? Math.floor(rawMintTs / 1000) : rawMintTs;
                                          const nowSec = Math.floor(Date.now() / 1000);
                                          const ageSeconds = mintTs > 0 ? Math.max(0, nowSec - mintTs) : Number(position.ageSeconds || 0);
                                          if (ageSeconds < 60) return '<1m';
                                          if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m`;
                                          if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)}h`;

                                          const days = Math.floor(ageSeconds / 86400);
                                          const hours = Math.floor((ageSeconds % 86400) / 3600);

                                          if (ageSeconds < 2592000) { // Less than 30 days
                                            return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
                                          }

                                          const months = Math.floor(ageSeconds / 2592000);
                                          const remainingDays = Math.floor((ageSeconds % 2592000) / 86400);

                                          if (ageSeconds < 31536000) { // Less than 1 year
                                            return remainingDays > 0 ? `${months}mo ${remainingDays}d` : `${months}mo`;
                                          }

                                          const years = Math.floor(ageSeconds / 31536000);
                                          const remainingMonths = Math.floor((ageSeconds % 31536000) / 2592000);
                                          const remainingDaysForYears = Math.floor((ageSeconds % 2592000) / 86400);

                                          if (remainingMonths > 0 && remainingDaysForYears > 0) {
                                            return `${years}y ${remainingMonths}mo ${remainingDaysForYears}d`;
                                          } else if (remainingMonths > 0) {
                                            return `${years}y ${remainingMonths}mo`;
                                          } else {
                                            return `${years}y`;
                                          }
                                        })()}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                      <div className="font-medium text-foreground">Position Age</div>
                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </div>

                              {/* Right side: Range badge and Submenu button */}
                              <div className="flex items-center gap-1.5">
                                {/* Range Badge */}
                                {(() => {
                                    const isFullRange = position.tickLower === SDK_MIN_TICK && position.tickUpper === SDK_MAX_TICK;
                                    const statusText = isFullRange ? 'Full Range' : position.isInRange ? 'In Range' : 'Out of Range';
                                    const statusColor = position.isInRange || isFullRange ? 'bg-green-500/20 text-green-500' : 'bg-red-500/20 text-red-500';

                                    return (
                                      <div className={`flex items-center justify-center h-4 rounded-md px-1.5 text-[10px] leading-none ${statusColor}`}>
                                        {statusText}
                                      </div>
                                    );
                                  })()}

                                {/* Submenu Button (smaller) */}
                                <div className="relative position-menu-trigger">
                                  <Button
                                    variant="ghost"
                                    className="h-5 w-5 p-0 text-muted-foreground/70 group-hover/subbar:text-white leading-none flex items-center justify-center"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      // Toggle menu
                                      const next = showPositionMenu === position.positionId ? null : position.positionId;
                                      setShowPositionMenu(next);
                                      if (next) {
                                        // Compute whether to open upwards
                                        const trigger = (e.currentTarget as HTMLElement);
                                        const rect = trigger.getBoundingClientRect();
                                        const approxMenuHeight = 128; // ~3 items + padding
                                        const wouldOverflow = rect.bottom + approxMenuHeight > window.innerHeight - 8; // 8px margin
                                        setPositionMenuOpenUp(wouldOverflow);
                                      }
                                    }}
                                  >
                                    <span className="sr-only">Open menu</span>
                                    <EllipsisVertical className="h-3 w-3 block" />
                                  </Button>
                                  <AnimatePresence>
                                    {showPositionMenu === position.positionId && (
                                      <motion.div
                                        initial={{ opacity: 0, y: positionMenuOpenUp ? 6 : -6, scale: 0.98 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: positionMenuOpenUp ? 6 : -6, scale: 0.98 }}
                                        transition={{ type: 'spring', stiffness: 420, damping: 26, mass: 0.6 }}
                                        className="absolute z-20 right-0 w-max min-w-[140px] rounded-md border border-sidebar-border bg-[var(--modal-background)] shadow-md overflow-hidden"
                                        style={{
                                          marginTop: positionMenuOpenUp ? undefined : 4,
                                          bottom: positionMenuOpenUp ? '100%' : undefined,
                                          marginBottom: positionMenuOpenUp ? 4 : undefined,
                                          transformOrigin: positionMenuOpenUp ? 'bottom right' : 'top right',
                                          willChange: 'transform, opacity',
                                        }}
                                      >
                                        <div className="p-1 grid gap-1">
                                          <button
                                            type="button"
                                            className="px-2 py-1 text-xs rounded text-left transition-colors text-muted-foreground hover:bg-muted/30"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleIncreasePosition(position);
                                              setShowPositionMenu(null);
                                            }}
                                          >
                                            Add Liquidity
                                          </button>
                                          <button
                                            type="button"
                                            className="px-2 py-1 text-xs rounded text-left transition-colors text-muted-foreground hover:bg-muted/30"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setShowPositionMenu(null);
                                              (async () => {
                                                try {
                                                  // Build and submit collect calldata via v4 SDK
                                                  const idRaw = String(position.positionId || '');
                                                  const tokenIdStr = idRaw.includes('-') ? (idRaw.split('-').pop() as string) : idRaw;
                                                  let tokenId: bigint;
                                                  try {
                                                    tokenId = BigInt(tokenIdStr);
                                                  } catch {
                                                    toast.error('Invalid tokenId');
                                                    return;
                                                  }
                                                  const { buildCollectFeesCall } = await import('@/lib/liquidity-utils');
                                                  const { calldata, value } = await buildCollectFeesCall({ tokenId, userAddress: accountAddress as `0x${string}` });
                                                  pendingActionRef.current = { type: 'collect' };
                                                  writeContract({
                                                    address: getPositionManagerAddress() as `0x${string}`,
                                                    abi: position_manager_abi as any,
                                                    functionName: 'multicall',
                                                    args: [[calldata]],
                                                    value,
                                                    chainId,
                                                  } as any, {
                                                    onSuccess: (hash) => setCollectHash(hash as `0x${string}`),
                                                  } as any);
                                                } catch (err: any) {
                                                  console.error('Collect via SDK failed:', err);
                                                  toast.error('Collect failed', { description: err?.message });
                                                }
                                              })();
                                            }}
                                          >
                                            Claim Fees
                                          </button>
                                          <button
                                            type="button"
                                            className="px-2 py-1 text-xs rounded text-left transition-colors text-muted-foreground hover:bg-muted/30"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setShowPositionMenu(null);
                                              // New single-tx compound: fetch fees, then call compoundFees (modifyLiquidities)
                                              (async () => {
                                                try {
                                                  const resp = await fetch('/api/liquidity/get-uncollected-fees', {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    body: JSON.stringify({ positionId: position.positionId }),
                                                  });
                                                  const json = await resp.json();
                                                  if (!resp.ok || !json?.success) {
                                                    throw new Error(json?.error || 'Failed to fetch fees');
                                                  }
                                                  if (!position.isInRange) { 
                                                    toast.error('Cannot Compound Out of Range Position', { icon: <OctagonX className="h-4 w-4 text-red-500" /> });
                                                    return; 
                                                  }
                                                  let raw0: string = json.amount0 || '0';
                                                  let raw1: string = json.amount1 || '0';
                                                  // Strictly floor by 1 wei to avoid rounding edge cases
                                                  try { const b0 = BigInt(raw0); raw0 = (b0 > 0n ? b0 - 1n : 0n).toString(); } catch {}
                                                  try { const b1 = BigInt(raw1); raw1 = (b1 > 0n ? b1 - 1n : 0n).toString(); } catch {}
                                                  if (raw0 === '0' && raw1 === '0') { toast.info('No fees to compound'); return; }
                                                  isCompoundInProgressRef.current = true;
                                                  await compoundFees({
                                                    tokenId: position.positionId,
                                                    token0Symbol: position.token0.symbol as TokenSymbol,
                                                    token1Symbol: position.token1.symbol as TokenSymbol,
                                                    poolId: position.poolId,
                                                    tickLower: position.tickLower,
                                                    tickUpper: position.tickUpper,
                                                  }, raw0, raw1);
                                                  // Success toast will show after on-chain confirmation from the hook
                                                } catch (err: any) {
                                                  console.error('Compound (single-tx) failed:', err);
                                                  toast.error('Compound failed', { description: err?.message });
                                                  isCompoundInProgressRef.current = false;
                                                }
                                              })();
                                            }}
                                          >
                                            Compound Fees
                                          </button>
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              </div>
                            </CardFooter>
                          </Card>
                        );
                  })}
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

      {/* Withdraw Position Dialog */}
      <Dialog open={showBurnConfirmDialog} onOpenChange={(open) => {
        // Only allow closing if not currently processing transaction
        if (!isBurningLiquidity && !isDecreasingLiquidity) {
          setShowBurnConfirmDialog(open);
        }
      }}>
        <DialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-lg border border-border shadow-lg [&>button]:hidden" style={{ backgroundColor: 'var(--modal-background)' }}>
          <DialogHeader>
            <DialogTitle className="sr-only">Withdraw Position</DialogTitle>
          </DialogHeader>
          {positionToBurn && (
            <div className="space-y-4">
              {/* Current Position - moved out of striped container */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Current Position</span>
                {!positionToBurn.isInRange && (
                  <div className="flex items-center justify-center h-5 rounded-md px-2 text-xs leading-none bg-red-500/20 text-red-500">
                    Out of Range
                  </div>
                )}
              </div>
              <div className="p-3 border border-dashed rounded-md bg-muted/10 space-y-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Image 
                      src={getTokenIcon(positionToBurn.token0.symbol)} 
                      alt={positionToBurn.token0.symbol} 
                      width={20} 
                      height={20} 
                      className="rounded-full"
                    />
                    <span className="text-sm font-medium">{positionToBurn.token0.symbol}</span>
                  </div>
                  <span className="text-sm font-medium">
                    {formatTokenDisplayAmount(positionToBurn.token0.amount)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Image 
                      src={getTokenIcon(positionToBurn.token1.symbol)} 
                      alt={positionToBurn.token1.symbol} 
                      width={20} 
                      height={20} 
                      className="rounded-full"
                    />
                    <span className="text-sm font-medium">{positionToBurn.token1.symbol}</span>
                  </div>
                  <span className="text-sm font-medium">
                    {formatTokenDisplayAmount(positionToBurn.token1.amount)}
                  </span>
                </div>
              </div>

              {/* Percentage Slider */}
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={withdrawPercentage}
                    onChange={(e) => handleWithdrawPercentageChange(parseInt(e.target.value))}
                    className="flex-1 h-2 rounded-lg appearance-none cursor-pointer slider focus:outline-none focus:ring-0 focus:ring-offset-0"
                    style={{
                      background: withdrawPercentage > 0 
                        ? `linear-gradient(to right, #f45502 0%, #f45502 ${withdrawPercentage}%, rgb(41 41 41 / 0.3) ${withdrawPercentage}%, rgb(41 41 41 / 0.3) 100%)`
                        : 'rgb(41 41 41 / 0.3)'
                    }}
                  />
                  <span className="text-sm text-muted-foreground min-w-[3rem] text-right">
                    {withdrawPercentage}%
                  </span>
                </div>
              </div>

              {/* Withdraw Amounts */}
              <div className="space-y-3">
                {positionToBurn.isInRange ? (
                  <>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label htmlFor="withdraw-amount0" className="text-sm font-medium">
                          Withdraw
                        </Label>
                        <Button 
                          variant="ghost" 
                          className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" 
                          onClick={() => {
                            if (withdrawProductiveSide === 'amount1') return;
                            handleMaxWithdraw('amount0');
                          }}
                          disabled={isBurningLiquidity || withdrawProductiveSide === 'amount1'}
                        >  
                          Balance: {formatTokenDisplayAmount(positionToBurn.token0.amount)}
                        </Button>
                      </div>
                      <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                            <Image 
                              src={getTokenIcon(positionToBurn.token0.symbol)} 
                              alt={positionToBurn.token0.symbol} 
                              width={20} 
                              height={20} 
                              className="rounded-full"
                            />
                            <span className="text-sm font-medium">{positionToBurn.token0.symbol}</span>
                          </div>
                          <div className="flex-1">
                            <Input
                              id="withdraw-amount0"
                              placeholder="0.0"
                              value={withdrawAmount0}
                              autoComplete="off"
                              autoCorrect="off"
                              spellCheck={false}
                              inputMode="decimal"
                              enterKeyHint="done"
                              onChange={(e) => {
                                const newValue = sanitizeDecimalInput(e.target.value);
                                handleWithdrawAmountChange(newValue, 'amount0');
                                setWithdrawActiveInputSide('amount0');
                                if (newValue && parseFloat(newValue) > 0) {
                                  calculateWithdrawAmount(newValue, 'amount0');
                                } else {
                                  setWithdrawAmount1("");
                                  setIsFullWithdraw(false);
                                }
                              }}
                              disabled={(withdrawProductiveSide === 'amount1') || isBurningLiquidity}
                              className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                            />
                            {positionToBurn && feesForWithdraw?.amount0 && (() => {
                              try {
                                const d0 = TOKEN_DEFINITIONS[positionToBurn.token0.symbol as TokenSymbol]?.decimals ?? 18;
                                const displayDecimals0 = TOKEN_DEFINITIONS[positionToBurn.token0.symbol as TokenSymbol]?.displayDecimals ?? 4;
                                const n0 = parseFloat(formatUnits(BigInt(feesForWithdraw.amount0), d0));
                                if (!Number.isFinite(n0) || n0 <= 0) return null;
                                const s0 = n0 > 0 && n0 < 0.001 ? '< 0.001' : n0.toFixed(displayDecimals0);
                                return (
                                  <TooltipProvider delayDuration={0}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="text-right text-xs text-muted-foreground">{`+ ${s0}`}</div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                                        Fees are claimed automatically
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                );
                              } catch {
                                return null;
                              }
                            })()}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-center items-center my-2">
                      <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
                        <PlusIcon className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label htmlFor="withdraw-amount1" className="text-sm font-medium">
                          Withdraw
                        </Label>
                        <Button 
                          variant="ghost" 
                          className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" 
                          onClick={() => {
                            if (withdrawProductiveSide === 'amount0') return;
                            handleMaxWithdraw('amount1');
                          }}
                          disabled={isBurningLiquidity || withdrawProductiveSide === 'amount0'}
                        >  
                          Balance: {formatTokenDisplayAmount(positionToBurn.token1.amount)}
                        </Button>
                      </div>
                      <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                            <Image 
                              src={getTokenIcon(positionToBurn.token1.symbol)} 
                              alt={positionToBurn.token1.symbol} 
                              width={20} 
                              height={20} 
                              className="rounded-full"
                            />
                            <span className="text-sm font-medium">{positionToBurn.token1.symbol}</span>
                          </div>
                          <div className="flex-1">
                            <Input
                              id="withdraw-amount1"
                              placeholder="0.0"
                              value={withdrawAmount1}
                              autoComplete="off"
                              autoCorrect="off"
                              spellCheck={false}
                              inputMode="decimal"
                              enterKeyHint="done"
                              onChange={(e) => {
                                const newValue = sanitizeDecimalInput(e.target.value);
                                handleWithdrawAmountChange(newValue, 'amount1');
                                setWithdrawActiveInputSide('amount1');
                                if (newValue && parseFloat(newValue) > 0) {
                                  calculateWithdrawAmount(newValue, 'amount1');
                                } else {
                                  setWithdrawAmount0("");
                                  setIsFullWithdraw(false);
                                }
                              }}
                              disabled={(withdrawProductiveSide === 'amount0') || isBurningLiquidity}
                              className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                            />
                            {positionToBurn && feesForWithdraw?.amount1 && (() => {
                              try {
                                const d1 = TOKEN_DEFINITIONS[positionToBurn.token1.symbol as TokenSymbol]?.decimals ?? 18;
                                const displayDecimals1 = TOKEN_DEFINITIONS[positionToBurn.token1.symbol as TokenSymbol]?.displayDecimals ?? 4;
                                const n1 = parseFloat(formatUnits(BigInt(feesForWithdraw.amount1), d1));
                                if (!Number.isFinite(n1) || n1 <= 0) return null;
                                const s1 = n1 > 0 && n1 < 0.001 ? '< 0.001' : n1.toFixed(displayDecimals1);
                                return (
                                  <TooltipProvider delayDuration={0}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <div className="text-right text-xs text-muted-foreground">{`+ ${s1}`}</div>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                                        Fees are claimed automatically
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                );
                              } catch {
                                return null;
                              }
                            })()}
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    {withdrawProductiveSide === 'amount0' ? (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label htmlFor="withdraw-amount0" className="text-sm font-medium">
                            Withdraw
                          </Label>
                          <Button 
                            variant="ghost" 
                            className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" 
                            onClick={() => handleMaxWithdraw('amount0')}
                            disabled={isBurningLiquidity}
                          >  
                            Balance: {formatTokenDisplayAmount(positionToBurn.token0.amount)}
                          </Button>
                        </div>
                        <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                              <Image 
                                src={getTokenIcon(positionToBurn.token0.symbol)} 
                                alt={positionToBurn.token0.symbol} 
                                width={20} 
                                height={20} 
                                className="rounded-full"
                              />
                              <span className="text-sm font-medium">{positionToBurn.token0.symbol}</span>
                            </div>
                            <div className="flex-1">
                              <Input
                                id="withdraw-amount0"
                                placeholder="0.0"
                                value={withdrawAmount0}
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                                inputMode="decimal"
                                enterKeyHint="done"
                                onChange={(e) => {
                                  const newValue = sanitizeDecimalInput(e.target.value);
                                  handleWithdrawAmountChange(newValue, 'amount0');
                                  setWithdrawActiveInputSide('amount0');
                                  if (newValue && parseFloat(newValue) > 0) {
                                    calculateWithdrawAmount(newValue, 'amount0');
                                  } else {
                                    setIsFullWithdraw(false);
                                  }
                                }}
                                disabled={isBurningLiquidity}
                                className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                              />
                              {positionToBurn && feesForWithdraw?.amount0 && (() => {
                                try {
                                  const d0 = TOKEN_DEFINITIONS[positionToBurn.token0.symbol as TokenSymbol]?.decimals ?? 18;
                                  const displayDecimals0 = TOKEN_DEFINITIONS[positionToBurn.token0.symbol as TokenSymbol]?.displayDecimals ?? 4;
                                  const n0 = parseFloat(formatUnits(BigInt(feesForWithdraw.amount0), d0));
                                  if (!Number.isFinite(n0) || n0 <= 0) return null;
                                  const s0 = n0 > 0 && n0 < 0.001 ? '< 0.001' : n0.toFixed(displayDecimals0);
                                  return (
                                    <TooltipProvider delayDuration={0}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div className="text-right text-xs text-muted-foreground">{`+ ${s0}`}</div>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                                          Fees are claimed automatically
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  );
                                } catch {
                                  return null;
                                }
                              })()}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : withdrawProductiveSide === 'amount1' ? (
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <Label htmlFor="withdraw-amount1" className="text-sm font-medium">
                            Withdraw
                          </Label>
                          <Button 
                            variant="ghost" 
                            className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" 
                            onClick={() => handleMaxWithdraw('amount1')}
                            disabled={isBurningLiquidity}
                          >  
                            Balance: {formatTokenDisplayAmount(positionToBurn.token1.amount)}
                          </Button>
                        </div>
                        <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                              <Image 
                                src={getTokenIcon(positionToBurn.token1.symbol)} 
                                alt={positionToBurn.token1.symbol} 
                                width={20} 
                                height={20} 
                                className="rounded-full"
                              />
                              <span className="text-sm font-medium">{positionToBurn.token1.symbol}</span>
                            </div>
                            <div className="flex-1">
                              <Input
                                id="withdraw-amount1"
                                placeholder="0.0"
                                value={withdrawAmount1}
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                                inputMode="decimal"
                                enterKeyHint="done"
                                onChange={(e) => {
                                  const newValue = sanitizeDecimalInput(e.target.value);
                                  handleWithdrawAmountChange(newValue, 'amount1');
                                  setWithdrawActiveInputSide('amount1');
                                  if (newValue && parseFloat(newValue) > 0) {
                                    calculateWithdrawAmount(newValue, 'amount1');
                                  } else {
                                    setIsFullWithdraw(false);
                                  }
                                }}
                                disabled={isBurningLiquidity}
                                className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                              />
                              {positionToBurn && feesForWithdraw?.amount1 && (() => {
                                try {
                                  const d1 = TOKEN_DEFINITIONS[positionToBurn.token1.symbol as TokenSymbol]?.decimals ?? 18;
                                  const displayDecimals1 = TOKEN_DEFINITIONS[positionToBurn.token1.symbol as TokenSymbol]?.displayDecimals ?? 4;
                                  const n1 = parseFloat(formatUnits(BigInt(feesForWithdraw.amount1), d1));
                                  if (!Number.isFinite(n1) || n1 <= 0) return null;
                                  const s1 = n1 > 0 && n1 < 0.001 ? '< 0.001' : n1.toFixed(displayDecimals1);
                                  return (
                                    <TooltipProvider delayDuration={0}>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <div className="text-right text-xs text-muted-foreground">{`+ ${s1}`}</div>
                                        </TooltipTrigger>
                                        <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                                          Fees are claimed automatically
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  );
                                } catch {
                                  return null;
                                }
                              })()}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Fallback: if unknown productive side, show both */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <Label htmlFor="withdraw-amount0" className="text-sm font-medium">
                              Withdraw
                            </Label>
                            <Button 
                              variant="ghost" 
                              className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" 
                              onClick={() => handleMaxWithdraw('amount0')}
                              disabled={isBurningLiquidity}
                            >  
                              Balance: {formatTokenDisplayAmount(positionToBurn.token0.amount)}
                            </Button>
                          </div>
                          <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                                <Image 
                                  src={getTokenIcon(positionToBurn.token0.symbol)} 
                                  alt={positionToBurn.token0.symbol} 
                                  width={20} 
                                  height={20} 
                                  className="rounded-full"
                                />
                                <span className="text-sm font-medium">{positionToBurn.token0.symbol}</span>
                              </div>
                              <div className="flex-1">
                                <Input
                                  id="withdraw-amount0"
                                  placeholder="0.0"
                                  value={withdrawAmount0}
                                  autoComplete="off"
                                  autoCorrect="off"
                                  spellCheck={false}
                                  inputMode="decimal"
                                  enterKeyHint="done"
                                  onChange={(e) => {
                                    const newValue = sanitizeDecimalInput(e.target.value);
                                    handleWithdrawAmountChange(newValue, 'amount0');
                                    setWithdrawActiveInputSide('amount0');
                                    if (newValue && parseFloat(newValue) > 0) {
                                      calculateWithdrawAmount(newValue, 'amount0');
                                    } else {
                                      setIsFullWithdraw(false);
                                    }
                                  }}
                                  disabled={isBurningLiquidity}
                                  className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <Label htmlFor="withdraw-amount1" className="text-sm font-medium">
                              Withdraw
                            </Label>
                            <Button 
                              variant="ghost" 
                              className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" 
                              onClick={() => handleMaxWithdraw('amount1')}
                              disabled={isBurningLiquidity}
                            >  
                              Balance: {formatTokenDisplayAmount(positionToBurn.token1.amount)}
                            </Button>
                          </div>
                          <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
                            <div className="flex items-center gap-2">
                              <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                                <Image 
                                  src={getTokenIcon(positionToBurn.token1.symbol)} 
                                  alt={positionToBurn.token1.symbol} 
                                  width={20} 
                                  height={20} 
                                  className="rounded-full"
                                />
                                <span className="text-sm font-medium">{positionToBurn.token1.symbol}</span>
                              </div>
                              <div className="flex-1">
                                <Input
                                  id="withdraw-amount1"
                                  placeholder="0.0"
                                  value={withdrawAmount1}
                                  autoComplete="off"
                                  autoCorrect="off"
                                  spellCheck={false}
                                  inputMode="decimal"
                                  enterKeyHint="done"
                                  onChange={(e) => {
                                    const newValue = sanitizeDecimalInput(e.target.value);
                                    handleWithdrawAmountChange(newValue, 'amount1');
                                    setWithdrawActiveInputSide('amount1');
                                    if (newValue && parseFloat(newValue) > 0) {
                                      calculateWithdrawAmount(newValue, 'amount1');
                                    } else {
                                      setIsFullWithdraw(false);
                                    }
                                  }}
                                  disabled={isBurningLiquidity}
                                  className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>

            </div>
          )}
          <DialogFooter className="grid grid-cols-2 gap-3">
            <Button 
              variant="outline"
              className="relative border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 text-white/75 disabled:opacity-50"
              onClick={() => {
                setShowBurnConfirmDialog(false);
              }}
              disabled={isBurningLiquidity || isDecreasingLiquidity}
              style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
            >
              Cancel
            </Button>
            <Button 
              className="text-sidebar-primary border border-sidebar-primary bg-[#3d271b] hover:bg-[#3d271b]/90"
              onClick={handleConfirmWithdraw}
              disabled={
                isBurningLiquidity || isDecreasingLiquidity ||
                // disallow over-withdraw
                (parseFloat(withdrawAmount0 || '0') > parseFloat(positionToBurn?.token0.amount || '0')) ||
                (parseFloat(withdrawAmount1 || '0') > parseFloat(positionToBurn?.token1.amount || '0')) ||
                (positionToBurn?.isInRange ? 
                  (!withdrawAmount0 || !withdrawAmount1 || parseFloat(withdrawAmount0) <= 0 || parseFloat(withdrawAmount1) <= 0) :
                  ((!withdrawAmount0 || parseFloat(withdrawAmount0) <= 0) && (!withdrawAmount1 || parseFloat(withdrawAmount1) <= 0))
                )
              }
            >
              <span className={(isBurningLiquidity || isDecreasingLiquidity) ? "animate-pulse" : ""}>
                {(() => {
                  // Show Withdraw All only if both sides are >= 99% of position amounts (in-range)
                  if (positionToBurn?.isInRange) {
                    const max0 = parseFloat(positionToBurn.token0.amount || '0');
                    const max1 = parseFloat(positionToBurn.token1.amount || '0');
                    const in0 = parseFloat(withdrawAmount0 || '0');
                    const in1 = parseFloat(withdrawAmount1 || '0');
                    const near0 = max0 > 0 ? in0 >= max0 * 0.99 : in0 === 0;
                    const near1 = max1 > 0 ? in1 >= max1 * 0.99 : in1 === 0;
                    return (near0 && near1) ? 'Withdraw All' : 'Withdraw';
                  }
                  // Out of range: only when the single productive side is near 100%
                  return 'Withdraw';
                })()}
              </span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Increase Position Modal */}
      <Dialog open={showIncreaseModal} onOpenChange={setShowIncreaseModal}>
        <DialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-lg border border-border shadow-lg [&>button]:hidden" style={{ backgroundColor: 'var(--modal-background)' }}>
          <DialogHeader>
            <DialogTitle className="sr-only">Add Liquidity</DialogTitle>
          </DialogHeader>
          {positionToModify && (
            <div className="space-y-4">
              {/* Current Position - moved out of striped container */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Current Position</span>
                {!positionToModify.isInRange && (
                  <div className="flex items-center justify-center h-5 rounded-md px-2 text-xs leading-none bg-red-500/20 text-red-500">
                    Out of Range
                  </div>
                )}
              </div>
              <div className="p-3 border border-dashed rounded-md bg-muted/10 space-y-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Image 
                      src={getTokenIcon(positionToModify.token0.symbol)} 
                      alt={positionToModify.token0.symbol} 
                      width={20} 
                      height={20} 
                      className="rounded-full"
                    />
                    <span className="text-sm font-medium">{positionToModify.token0.symbol}</span>
                  </div>
                  <span className="text-sm font-medium">
                    {formatTokenDisplayAmount(positionToModify.token0.amount)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Image 
                      src={getTokenIcon(positionToModify.token1.symbol)} 
                      alt={positionToModify.token1.symbol} 
                      width={20} 
                      height={20} 
                      className="rounded-full"
                    />
                    <span className="text-sm font-medium">{positionToModify.token1.symbol}</span>
                  </div>
                  <span className="text-sm font-medium">
                    {formatTokenDisplayAmount(positionToModify.token1.amount)}
                  </span>
                </div>
              </div>

              {/* Percentage Slider */}
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={increasePercentage}
                    onChange={(e) => handleIncreasePercentageChange(parseInt(e.target.value))}
                    className="flex-1 h-2 rounded-lg appearance-none cursor-pointer slider focus:outline-none focus:ring-0 focus:ring-offset-0"
                    style={{
                      background: increasePercentage > 0 
                        ? `linear-gradient(to right, #f45502 0%, #f45502 ${increasePercentage}%, rgb(41 41 41 / 0.3) ${increasePercentage}%, rgb(41 41 41 / 0.3) 100%)`
                        : 'rgb(41 41 41 / 0.3)'
                    }}
                  />
                  <span className="text-sm text-muted-foreground min-w-[3rem] text-right">
                    {increasePercentage}%
                  </span>
                </div>
              </div>

              {/* Additional Amounts */}
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="increase-amount0" className="text-sm font-medium">
                      Add
                    </Label>
                    <Button 
                      variant="ghost" 
                      className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" 
                      onClick={() => {
                        if (positionToModify && !positionToModify.isInRange && increaseActiveInputSide === 'amount1') return;
                        handleUseFullBalance(modalToken0BalanceData?.formatted || "0", token0Symbol, true);
                      }}
                      disabled={isIncreasingLiquidity || isIncreaseCalculating}
                    >  
                      Balance: {displayModalToken0Balance} {positionToModify.token0.symbol}
                    </Button>
                  </div>
                  <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                        <Image 
                          src={getTokenIcon(positionToModify.token0.symbol)} 
                          alt={positionToModify.token0.symbol} 
                          width={20} 
                          height={20} 
                          className="rounded-full"
                        />
                        <span className="text-sm font-medium">{positionToModify.token0.symbol}</span>
                      </div>
                      <div className="flex-1">
                        <Input
                          id="increase-amount0"
                          placeholder="0.0"
                          value={increaseAmount0}
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                          inputMode="decimal"
                          enterKeyHint="done"
                          onChange={(e) => {
                            const newValue = sanitizeDecimalInput(e.target.value);
                            handleIncreaseAmountChange(newValue, 'amount0');
                            if (newValue && parseFloat(newValue) > 0) {
                              calculateIncreaseAmount(newValue, 'amount0');
                            } else {
                              setIncreaseAmount1("");
                            }
                          }}
                          disabled={(positionToModify && !positionToModify.isInRange && increaseActiveInputSide === 'amount1') || (isIncreaseCalculating && increaseActiveInputSide === 'amount1')}
                          className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                        />
                        {/* Uncollected fee subtitle for token0 (Increase) */}
                        {positionToModify && feesForIncrease?.amount0 && (() => {
                          try {
                            const d0 = TOKEN_DEFINITIONS[positionToModify.token0.symbol as TokenSymbol]?.decimals ?? 18;
                            const displayDecimals0 = TOKEN_DEFINITIONS[positionToModify.token0.symbol as TokenSymbol]?.displayDecimals ?? 4;
                            const n0 = parseFloat(formatUnits(BigInt(feesForIncrease.amount0), d0));
                            if (!Number.isFinite(n0) || n0 <= 0) return null;
                            const s0 = n0 > 0 && n0 < 0.001 ? '< 0.001' : n0.toFixed(displayDecimals0);
                            return (
                              <TooltipProvider delayDuration={0}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="text-right text-xs text-muted-foreground">{`+ ${s0}`}</div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                                    Fees are compounded automatically
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            );
                          } catch {
                            return null;
                          }
                        })()}
                      </div>
                    </div>
                  </div>
                  {/* removed calculating hint for cleaner UX */}
                </div>

                {/* Plus Icon */}
                <div className="flex justify-center items-center my-2">
                  <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
                    <PlusIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="increase-amount1" className="text-sm font-medium">
                      Add
                    </Label>
                    <Button 
                      variant="ghost" 
                      className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent" 
                      onClick={() => {
                        if (positionToModify && !positionToModify.isInRange && increaseActiveInputSide === 'amount0') return;
                        handleUseFullBalance(modalToken1BalanceData?.formatted || "0", token1Symbol, false);
                      }}
                      disabled={isIncreasingLiquidity || isIncreaseCalculating}
                    >  
                      Balance: {displayModalToken1Balance} {positionToModify.token1.symbol}
                    </Button>
                  </div>
                  <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                        <Image 
                          src={getTokenIcon(positionToModify.token1.symbol)} 
                          alt={positionToModify.token1.symbol} 
                          width={20} 
                          height={20} 
                          className="rounded-full"
                        />
                        <span className="text-sm font-medium">{positionToModify.token1.symbol}</span>
                      </div>
                      <div className="flex-1">
                        <Input
                          id="increase-amount1"
                          placeholder="0.0"
                          value={increaseAmount1}
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                          inputMode="decimal"
                          enterKeyHint="done"
                          onChange={(e) => {
                            const newValue = sanitizeDecimalInput(e.target.value);
                            handleIncreaseAmountChange(newValue, 'amount1');
                            if (newValue && parseFloat(newValue) > 0) {
                              calculateIncreaseAmount(newValue, 'amount1');
                            } else {
                              setIncreaseAmount0("");
                            }
                          }}
                          disabled={(positionToModify && !positionToModify.isInRange && increaseActiveInputSide === 'amount0') || (isIncreaseCalculating && increaseActiveInputSide === 'amount0')}
                          className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                        />
                        {/* Uncollected fee subtitle for token1 (Increase) */}
                        {positionToModify && feesForIncrease?.amount1 && (() => {
                          try {
                            const d1 = TOKEN_DEFINITIONS[positionToModify.token1.symbol as TokenSymbol]?.decimals ?? 18;
                            const displayDecimals1 = TOKEN_DEFINITIONS[positionToModify.token1.symbol as TokenSymbol]?.displayDecimals ?? 4;
                            const n1 = parseFloat(formatUnits(BigInt(feesForIncrease.amount1), d1));
                            if (!Number.isFinite(n1) || n1 <= 0) return null;
                            const s1 = n1 > 0 && n1 < 0.001 ? '< 0.001' : n1.toFixed(displayDecimals1);
                            return (
                              <TooltipProvider delayDuration={0}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <div className="text-right text-xs text-muted-foreground">{`+ ${s1}`}</div>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                                    Fees are compounded automatically
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            );
                          } catch {
                            return null;
                          }
                        })()}
                      </div>
                    </div>
                  </div>
                  {/* removed calculating hint for cleaner UX */}
                </div>
              </div>
            </div>
          )}
          <DialogFooter className="grid grid-cols-2 gap-3">
            <Button 
              variant="outline"
              className="relative border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 text-white/75 disabled:opacity-50"
              onClick={() => {
                setShowIncreaseModal(false);
                setIsIncreaseAmountValid(true);
              }}
              disabled={isIncreasingLiquidity}
              style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
            >
              Cancel
            </Button>
            <Button 
              className={isIncreasingLiquidity || isIncreaseCalculating
                ? "relative border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75"
                : "text-sidebar-primary border border-sidebar-primary bg-[#3d271b] hover:bg-[#3d271b]/90"
              }
              onClick={handleConfirmIncrease}
              disabled={
                isIncreasingLiquidity ||
                isIncreaseCalculating ||
                !isIncreaseAmountValid ||
                (positionToModify?.isInRange ? 
                  // For in-range positions, require both amounts
                  (!increaseAmount0 || !increaseAmount1 || parseFloat(increaseAmount0) <= 0 || parseFloat(increaseAmount1) <= 0) :
                  // For out-of-range positions, require at least one amount
                  ((!increaseAmount0 || parseFloat(increaseAmount0) <= 0) && (!increaseAmount1 || parseFloat(increaseAmount1) <= 0))
                )
              }
              style={(isIncreasingLiquidity || isIncreaseCalculating) 
                ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } 
                : undefined
              }
            >
              {isIncreasingLiquidity ? (
                <>
                  <RefreshCwIcon className="mr-2 h-4 w-4 animate-spin" />
                  <span className="animate-pulse">
                    Adding...
                  </span>
                </>
              ) : (
                "Add Liquidity"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Liquidity Modal (cloned structure using AddLiquidityForm) */}
      <AddDialog open={addLiquidityOpen} onOpenChange={setAddLiquidityOpen}>
        <AddDialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-lg border border-sidebar-border bg-[var(--modal-background)] p-0 overflow-hidden">
          {/* Top bar with title + X aligned inside the bar */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-sidebar-border/60">
            <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">ADD LIQUIDITY</h2>
            <button
              aria-label="Close"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md hover:bg-muted/30"
              onClick={() => setAddLiquidityOpen(false)}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div className="p-3 sm:p-4">
            <AddLiquidityFormMemo
              selectedPoolId={poolId}
              poolApr={currentPoolData?.apr}
              onLiquidityAdded={(token0Symbol?: string, token1Symbol?: string) => {
                setAddLiquidityOpen(false);
                refreshAfterLiquidityAddedWithSkeleton(token0Symbol, token1Symbol);
              }}
              sdkMinTick={SDK_MIN_TICK}
              sdkMaxTick={SDK_MAX_TICK}
              defaultTickSpacing={getPoolById(poolId)?.tickSpacing || DEFAULT_TICK_SPACING}
              activeTab={'deposit'}
            />
          </div>
        </AddDialogContent>
      </AddDialog>

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

    </AppLayout>
  );
}