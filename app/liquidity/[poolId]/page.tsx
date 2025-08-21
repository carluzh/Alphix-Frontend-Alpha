"use client";

import { AppLayout } from "@/components/app-layout";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ArrowRightLeftIcon, PlusIcon, MinusIcon, ArrowLeftIcon, RefreshCwIcon, ChevronLeftIcon, Trash2Icon, Check, BadgeCheck, OctagonX, Clock3, ChevronsLeftRight, EllipsisVertical, Info } from "lucide-react";
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
import { TickRangePreview } from "@/components/TickRangePreview";
import { getPoolById, getPoolSubgraphId, getToken, getAllTokens } from "@/lib/pools-config";
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
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWriteContract, useWaitForTransactionReceipt, useSendTransaction } from "wagmi";
import { baseSepolia } from "../../../lib/wagmiConfig";
import { getFromCache, setToCache, getUserPositionsCacheKey, getPoolStatsCacheKey, getPoolDynamicFeeCacheKey } from "../../../lib/client-cache";
import type { Pool } from "../../../types";
import { AddLiquidityForm } from "../../../components/liquidity/AddLiquidityForm";
import React from "react";
import { useBurnLiquidity, type BurnPositionData } from "@/components/liquidity/useBurnLiquidity";
import { useIncreaseLiquidity, type IncreasePositionData } from "@/components/liquidity/useIncreaseLiquidity";
import { useDecreaseLiquidity, type DecreasePositionData } from "@/components/liquidity/useDecreaseLiquidity";


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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { EllipsisVerticalIcon, CopyIcon, ChevronDownIcon, ChevronsRight, ChevronsLeft } from "lucide-react";
import { shortenAddress } from "@/lib/utils";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { motion, AnimatePresence } from "framer-motion";
import TickRangePortfolio from "@/components/TickRangePortfolio";

// Define the structure of the chart data points from the API
interface ChartDataPoint {
  date: string; // YYYY-MM-DD
  volumeUSD: number;
  tvlUSD: number;
  volumeTvlRatio: number;
  emaRatio: number;
  dynamicFee: number; // Fee percentage (e.g., 0.31 for 0.31%)
}

// Reusing components from the main liquidity page
const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;
const TICK_BARS_COUNT = 31;
const DEFAULT_TICK_SPACING = 60;
const TICKS_PER_BAR = 10 * DEFAULT_TICK_SPACING;

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
  if (value < 0.01) return "$0";
  return formatUSDShared(value);
};

// (Replaced by runtime price-based calculator inside the component)



const chartConfig = {
  views: { label: "Daily Values" },
  volume: { label: "Volume", color: "#404040" },
  tvl: { label: "TVL", color: "#404040" },
  volumeUSD: { label: "Volume", color: "#404040" },
  tvlUSD: { label: "TVL", color: "#404040" },
  volumeTvlRatio: { label: "Vol/TVL Ratio", color: "hsl(var(--chart-3))" },
  emaRatio: { label: "EMA (Vol/TVL)", color: "hsl(var(--chart-2))" },
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

interface PoolDetailData extends Pool { // Extend the main Pool type
  // Add any specific fields needed for this page that are not in the global Pool type
  // For now, the global Pool type should cover what we fetch (volume, fees, tvl USD values)
  tickSpacing?: number; // Add tickSpacing property
}

// Helper function to convert tick to price using the same logic as AddLiquidityForm.tsx
const convertTickToPrice = (tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string): string => {
  if (!currentPrice || currentPoolTick === null) {
    return "N/A";
  }

  const currentPriceNum = parseFloat(currentPrice);
  if (isNaN(currentPriceNum) || currentPriceNum <= 0) {
    return "N/A";
  }

  let priceAtTick: number;

  if (baseTokenForPriceDisplay === token0Symbol) {
    // Show prices denominated in token0 - need to invert
    const priceDelta = Math.pow(1.0001, tick - currentPoolTick);
    priceAtTick = 1 / (currentPriceNum * priceDelta);
  } else {
    // Show prices denominated in token1 - direct calculation
    const priceDelta = Math.pow(1.0001, tick - currentPoolTick);
    priceAtTick = currentPriceNum * priceDelta;
  }

  // Format the price
  if (!isFinite(priceAtTick) || isNaN(priceAtTick)) {
    return "N/A";
  }

  if (priceAtTick >= 0 && priceAtTick < 1e-11) {
    return "0";
  } else if (!isFinite(priceAtTick) || priceAtTick > 1e30) {
    return "∞";
  } else {
    const displayDecimals = baseTokenForPriceDisplay === token0Symbol ? 
      (TOKEN_DEFINITIONS[token0Symbol as TokenSymbol]?.displayDecimals ?? 4) : 
      (TOKEN_DEFINITIONS[token1Symbol as TokenSymbol]?.displayDecimals ?? 4);
    return priceAtTick.toFixed(displayDecimals);
  }
};

// Memoized AddLiquidityForm to prevent unnecessary re-renders
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
    { symbol: position.token0.symbol || 'Token 0', icon: getTokenIcon(position.token0) },
    { symbol: position.token1.symbol || 'Token 1', icon: getTokenIcon(position.token1) },
  ];

  const baseWidth = iconSize + step;

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
  const { address: accountAddress } = useAccount();
  const [raw0, setRaw0] = React.useState<string | null>(null);
  const [raw1, setRaw1] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [lastError, setLastError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        setLoading(true);
        setLastError(null);
        const resp = await fetch('/api/liquidity/get-uncollected-fees', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ positionId }),
        });
        const json = await resp.json();
        console.log('[FeesCell]', positionId, { ok: resp.ok, success: json?.success, error: json?.error, debug: json?.debug });
        if (!cancelled && json?.success) {
          // Store raw on-chain amounts for precise USD conversion client-side
          setRaw0(json.amount0 ?? null);
          setRaw1(json.amount1 ?? null);
        }
        if (!json?.success && !cancelled) {
          setLastError(String(json?.error || 'unknown'));
        }
      } catch (e: any) {
        console.log('[FeesCell:error]', positionId, e?.message || e);
        if (!cancelled) setLastError(String(e?.message || 'request failed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [positionId]);

  const fmtUsd = (n: number) => {
    if (!Number.isFinite(n) || n <= 0) return '$0';
    if (n < 0.01) return '< $0.01';
    return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
  };

  if (loading) return (
    <span className="inline-block h-3 w-12 rounded bg-muted/40 animate-pulse align-middle" />
  );
  if (raw0 === null || raw1 === null) return <span className="text-muted-foreground" title={lastError ? `Fees unavailable: ${lastError}` : undefined}>N/A</span>;

  // Convert using decimals from pools config
  const d0 = TOKEN_DEFINITIONS?.[sym0 as keyof typeof TOKEN_DEFINITIONS]?.decimals ?? 18;
  const d1 = TOKEN_DEFINITIONS?.[sym1 as keyof typeof TOKEN_DEFINITIONS]?.decimals ?? 18;
  let amt0 = 0;
  let amt1 = 0;
  try { amt0 = parseFloat(formatUnits(BigInt(raw0), d0)); } catch {}
  try { amt1 = parseFloat(formatUnits(BigInt(raw1), d1)); } catch {}
  const usd = (amt0 * (price0 || 0)) + (amt1 * (price1 || 0));
  return <span className="whitespace-nowrap">{fmtUsd(usd)}</span>;
}

export default function PoolDetailPage() {
  const router = useRouter();
  const params = useParams<{ poolId: string }>();
  const poolId = params?.poolId;
  const [userPositions, setUserPositions] = useState<ProcessedPosition[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [activeChart, setActiveChart] = useState<keyof Pick<typeof chartConfig, 'volume' | 'tvl' | 'volumeTvlRatio' | 'emaRatio' | 'dynamicFee'>>("volumeTvlRatio");
  

  
  const { address: accountAddress, isConnected, chainId } = useAccount();
  
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

  const addLiquidityFormRef = useRef<HTMLDivElement>(null); // Ref for scrolling to form
  const leftColumnRef = useRef<HTMLDivElement>(null); // Ref for the entire left column

  // State for the pool's detailed data (including fetched stats)
  const [currentPoolData, setCurrentPoolData] = useState<PoolDetailData | null>(null);
  // State for popover visibility
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  // State for API-fetched chart data
  const [apiChartData, setApiChartData] = useState<ChartDataPoint[]>([]);
  const [isLoadingChartData, setIsLoadingChartData] = useState(false);
  // State for pool state data (currentPoolTick and currentPrice)
  const [currentPoolTick, setCurrentPoolTick] = useState<number | null>(null);
  const [currentPrice, setCurrentPrice] = useState<string | null>(null);
  // Token prices for USD valuation
  const [tokenPrices, setTokenPrices] = useState<{ BTC: number; ETH: number; USDC: number }>({ BTC: 0, ETH: 0, USDC: 1 });
  const [isLoadingPrices, setIsLoadingPrices] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadPrices = async () => {
      try {
        setIsLoadingPrices(true);
        const res = await fetch('/api/prices/get-token-prices');
        if (!res.ok) throw new Error(`Failed to fetch prices: ${res.statusText}`);
        const data = await res.json();
        if (!cancelled) {
          const next = {
            BTC: typeof data.BTC === 'number' ? data.BTC : 0,
            ETH: typeof data.ETH === 'number' ? data.ETH : 0,
            USDC: typeof data.USDC === 'number' ? data.USDC : 1,
          };
          setTokenPrices(next);
        }
      } catch (e) {
        console.error('Failed to load token prices', e);
      } finally {
        if (!cancelled) setIsLoadingPrices(false);
      }
    };
    loadPrices();
    // Refresh occasionally (5 min) to avoid stale values
    const id = setInterval(loadPrices, 300000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const getUsdPriceForSymbol = useCallback((symbolRaw?: string): number => {
    const symbol = (symbolRaw || '').toUpperCase();
    if (!symbol) return 0;
    // Map wrapped/aliased symbols to base tickers we price
    if (symbol === 'USDC' || symbol === 'AUSDC' || symbol === 'USDT' || symbol === 'AUSDT' || symbol === 'MUSDT' || symbol === 'YUSD') return tokenPrices.USDC || 1;
    if (symbol === 'ETH' || symbol === 'AETH') return tokenPrices.ETH || 0;
    if (symbol === 'BTC' || symbol === 'ABTC') return tokenPrices.BTC || 0;
    return 0; // Unknown
  }, [tokenPrices]);

  const calculatePositionUsd = useCallback((position: ProcessedPosition): number => {
    if (!position) return 0;
    const amt0 = parseFloat(position.token0.amount || '0');
    const amt1 = parseFloat(position.token1.amount || '0');
    const p0 = getUsdPriceForSymbol(position.token0.symbol);
    const p1 = getUsdPriceForSymbol(position.token1.symbol);
    const v0 = Number.isFinite(amt0) && Number.isFinite(p0) ? amt0 * p0 : 0;
    const v1 = Number.isFinite(amt1) && Number.isFinite(p1) ? amt1 * p1 : 0;
    return v0 + v1;
  }, [getUsdPriceForSymbol]);

  // State for managing active tab (Deposit/Withdraw/Swap) - Lifted from AddLiquidityForm
  // const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw' | 'swap'>('deposit');

  // State for burn confirmation dialog
  const [showBurnConfirmDialog, setShowBurnConfirmDialog] = useState(false);
  const [positionToBurn, setPositionToBurn] = useState<ProcessedPosition | null>(null);

  // New state for increase/decrease modals
  const [showIncreaseModal, setShowIncreaseModal] = useState(false);
  const [showDecreaseModal, setShowDecreaseModal] = useState(false);
  const [positionToModify, setPositionToModify] = useState<ProcessedPosition | null>(null);

  // Token symbols for the current pool (defined after positionToModify)
  const token0Symbol = positionToModify?.token0.symbol as TokenSymbol || 'aUSDC';
  const token1Symbol = positionToModify?.token1.symbol as TokenSymbol || 'aUSDT';

  // State for increase modal inputs
  const [increaseAmount0, setIncreaseAmount0] = useState<string>("");
  const [increaseAmount1, setIncreaseAmount1] = useState<string>("");
  const [increaseActiveInputSide, setIncreaseActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isIncreaseCalculating, setIsIncreaseCalculating] = useState(false);

  // State for decrease modal inputs
  const [decreaseAmount0, setDecreaseAmount0] = useState<string>("");
  const [decreaseAmount1, setDecreaseAmount1] = useState<string>("");
  const [decreaseActiveInputSide, setDecreaseActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isDecreaseCalculating, setIsDecreaseCalculating] = useState(false);
  const [isFullBurn, setIsFullBurn] = useState(false);

  // State for withdraw modal inputs
  const [withdrawAmount0, setWithdrawAmount0] = useState<string>("");
  const [withdrawAmount1, setWithdrawAmount1] = useState<string>("");
  const [withdrawActiveInputSide, setWithdrawActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isFullWithdraw, setIsFullWithdraw] = useState(false);
  const [withdrawPercentage, setWithdrawPercentage] = useState<number>(0);
  const [increasePercentage, setIncreasePercentage] = useState<number>(0);

  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const isMobile = useIsMobile();

  // New state variables to track if amounts exceed balance/position
  const [isIncreaseAmountValid, setIsIncreaseAmountValid] = useState(true);

  const [windowWidth, setWindowWidth] = useState<number>(1200);
  const [toggleMetric, setToggleMetric] = useState<'liquidity' | 'volume' | 'fees'>('liquidity');

  // State for height alignment between modal and chart
  const [formContainerRect, setFormContainerRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);

  // State for position menu
  const [showPositionMenu, setShowPositionMenu] = useState<string | null>(null);
  const [positionMenuOpenUp, setPositionMenuOpenUp] = useState<boolean>(false);

  // Track window width for responsive chart
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    // Set initial width
    if (typeof window !== 'undefined') {
      setWindowWidth(window.innerWidth);
      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }
  }, []);

  // Click outside handler for position menu
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showPositionMenu) {
        const target = event.target as Element;
        if (!target.closest('.position-menu-trigger')) {
          setShowPositionMenu(null);
        }
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showPositionMenu]);

  // Function to cycle through toggle metrics
  const cycleToggleMetric = useCallback(() => {
    setToggleMetric(prev => {
      switch (prev) {
        case 'liquidity':
          return 'volume';
        case 'volume':
          return 'fees';
        case 'fees':
          return 'liquidity';
        default:
          return 'liquidity';
      }
    });
  }, []);

  // Fill missing dates and limit data based on screen size
  const processChartDataForScreenSize = useCallback((data: ChartDataPoint[]) => {
    if (!data || data.length === 0) return [];
    
    const sortedData = [...data].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    
    // Determine how many days back based on screen size
    let daysBack = 28; // Default for largest screens
    if (windowWidth < 1500) {
      daysBack = 14; // Mobile and tablet - same as when Volume and Fees containers are hidden
    } else if (windowWidth < 1700) {
      daysBack = 21; // Large screens get 21
    }
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
    
    // Filter data to only include recent dates
    const recentData = sortedData.filter(item => new Date(item.date) >= cutoffDate);
    
    if (recentData.length === 0) return sortedData; // Fallback to all data
    
    // Fill missing dates in the recent data
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
        // Fill missing date: Volume = 0, TVL = previous day's value
        // For dynamic fee, use the previous day's value or calculate based on TVL
        let dynamicFeeValue = 0;
        if (lastTvl > 0) {
          // Use the last known dynamic fee or calculate a reasonable default
          const lastDataPoint = filledData[filledData.length - 1];
          if (lastDataPoint && lastDataPoint.dynamicFee > 0) {
            dynamicFeeValue = lastDataPoint.dynamicFee;
          }
        }
        
        filledData.push({
          date: dateStr,
          volumeUSD: 0,
          tvlUSD: lastTvl,
          volumeTvlRatio: 0,
          emaRatio: 0,
          dynamicFee: dynamicFeeValue
        });
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return filledData;
  }, [windowWidth]);

  // Height measurement effect
  useEffect(() => {
    if (!leftColumnRef.current) {
      return;
    }

    const measureAndReportContainerRect = () => {
      if (leftColumnRef.current) {
        const rect = leftColumnRef.current.getBoundingClientRect();
        setFormContainerRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      }
    };

    // Initial measurement with a small delay to ensure DOM is ready
    setTimeout(measureAndReportContainerRect, 100);

    // Setup ResizeObserver for dynamic changes
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        measureAndReportContainerRect();
      });

      resizeObserver.observe(leftColumnRef.current);

      return () => {
        if (resizeObserver) {
          resizeObserver.disconnect();
        }
      };
    } else {
      // Fallback for browsers without ResizeObserver
      const handleResize = () => {
        measureAndReportContainerRect();
      };

      window.addEventListener('resize', handleResize);
      
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }
  }, [currentPoolData, apiChartData]); // Run when data is loaded

  // Memoized callback functions to prevent infinite re-renders
  const onLiquidityBurnedCallback = useCallback(() => {
    toast.success("Position burn successful! Refreshing your positions...");
    setRefreshTrigger(prev => prev + 1); // Trigger refresh
    setShowBurnConfirmDialog(false); // Close modal after successful transaction
    setPositionToBurn(null);
  }, []);

  const onLiquidityIncreasedCallback = useCallback(() => {
    toast.success("Position increased successfully! Refreshing your positions...");
    setRefreshTrigger(prev => prev + 1); // Trigger refresh
  }, []);

  const onLiquidityDecreasedCallback = useCallback(() => {
    toast.success("Position modified successfully! Refreshing your positions...");
    setRefreshTrigger(prev => prev + 1); // Trigger refresh
    setShowBurnConfirmDialog(false); // Close modal after successful transaction
    setPositionToBurn(null);
  }, []);

  // Initialize the liquidity modification hooks
  const { burnLiquidity, isLoading: isBurningLiquidity } = useBurnLiquidity({
    onLiquidityBurned: onLiquidityBurnedCallback
  });

  const { increaseLiquidity, isLoading: isIncreasingLiquidity } = useIncreaseLiquidity({
    onLiquidityIncreased: onLiquidityIncreasedCallback,
  });

  const { decreaseLiquidity, isLoading: isDecreasingLiquidity } = useDecreaseLiquidity({
    onLiquidityDecreased: onLiquidityDecreasedCallback,
  });



  // Fetch user positions for this pool and pool stats
  const fetchPageData = useCallback(async () => {
    if (!poolId) return;

    // Start loading chart data
    setIsLoadingChartData(true);
    // Fetch chart data from the new API route
    fetch(`/api/liquidity/chart-data/${poolId}`)
      .then(res => {
        if (!res.ok) {
          throw new Error(`Failed to fetch chart data: ${res.statusText}`);
        }
        return res.json();
      })
      .then(data => {
        // Check if the response has a data property that is an array
        if (data && Array.isArray(data.data)) { 
          setApiChartData(data.data);
        } else if (Array.isArray(data)) { // Fallback if API returns array directly
          setApiChartData(data)
        }else {
          console.error("Chart API response is not in the expected format:", data);
          setApiChartData([]); // Set to empty array on error or bad format
        }
      })
      .catch(error => {
        console.error("Failed to fetch chart data from API:", error);
        toast.error("Could not load pool chart data.", { description: error.message });
        setApiChartData([]); // Set to empty array on error
      })
      .finally(() => {
        setIsLoadingChartData(false);
      });

    const basePoolInfo = getPoolConfiguration(poolId);
    if (!basePoolInfo) {
      toast.error("Pool configuration not found for this ID.");
      router.push('/liquidity');
      return;
    }

    // Use the subgraph ID from the pool configuration for API calls
    const apiPoolIdToUse = basePoolInfo.subgraphId; 

    // Fetch pool state data (currentPoolTick and currentPrice)
    try {
      const poolStateResponse = await fetch('/api/liquidity/get-pool-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token0Symbol: basePoolInfo.tokens[0].symbol,
          token1Symbol: basePoolInfo.tokens[1].symbol,
          chainId: baseSepolia.id,
        }),
      });
      
      if (poolStateResponse.ok) {
        const poolState = await poolStateResponse.json();
        if (poolState.currentPrice && typeof poolState.currentPoolTick === 'number') {
          setCurrentPrice(poolState.currentPrice);
          setCurrentPoolTick(poolState.currentPoolTick);
        }
      }
    } catch (error) {
      console.error("Failed to fetch pool state:", error);
    }

    // 1. Fetch/Cache Pool Stats (Volume, Fees, TVL)
    let poolStats: Partial<Pool> | null = getFromCache(getPoolStatsCacheKey(apiPoolIdToUse));
    if (poolStats) {
      console.log(`[Cache HIT] Using cached stats for pool detail: ${apiPoolIdToUse}`);
    } else {
      console.log(`[Cache MISS] Fetching stats from API for pool detail: ${apiPoolIdToUse}`);
      try {
        const [res24h, res7d, resTvl] = await Promise.all([
          fetch(`/api/liquidity/get-rolling-volume-fees?poolId=${apiPoolIdToUse}&days=1`),
          fetch(`/api/liquidity/get-rolling-volume-fees?poolId=${apiPoolIdToUse}&days=7`),
          fetch(`/api/liquidity/get-pool-tvl?poolId=${apiPoolIdToUse}`)
        ]);

        if (!res24h.ok || !res7d.ok || !resTvl.ok) {
          console.error(`Failed to fetch all stats for pool detail ${apiPoolIdToUse}.`);
          // Handle partial failures if necessary, or just mark as error
        } else {
          const data24h = await res24h.json();
          const data7d = await res7d.json();
          const dataTvl = await resTvl.json();
          poolStats = {
            volume24hUSD: parseFloat(data24h.volumeUSD),
            fees24hUSD: parseFloat(data7d.feesUSD),
            volume7dUSD: parseFloat(data7d.volumeUSD),
            fees7dUSD: parseFloat(data7d.feesUSD),
            tvlUSD: parseFloat(dataTvl.tvlUSD),
            // APR might need its own source or calculation
          };
          setToCache(getPoolStatsCacheKey(apiPoolIdToUse), poolStats);
          console.log(`[Cache SET] Cached stats for pool detail: ${apiPoolIdToUse}`);
        }
      } catch (error) {
        console.error(`Error fetching stats for pool detail ${apiPoolIdToUse}:`, error);
        // poolStats remains null or previous cached value if any part fails
      }
    }

    // 2. Fetch/Cache Dynamic Fee for APR Calculation
    let dynamicFeeBps: number | null = null;
    const [token0SymbolStr, token1SymbolStr] = basePoolInfo.pair.split(' / ');
    const fromTokenSymbolForFee = TOKEN_DEFINITIONS[token0SymbolStr?.trim() as TokenSymbol]?.symbol;
    const toTokenSymbolForFee = TOKEN_DEFINITIONS[token1SymbolStr?.trim() as TokenSymbol]?.symbol;

    if (fromTokenSymbolForFee && toTokenSymbolForFee && baseSepolia.id) {
      const feeCacheKey = getPoolDynamicFeeCacheKey(fromTokenSymbolForFee, toTokenSymbolForFee, baseSepolia.id);
      const cachedFee = getFromCache<{ dynamicFee: string }>(feeCacheKey);

      if (cachedFee) {
        console.log(`[Cache HIT] Using cached dynamic fee for APR calc (${basePoolInfo.pair}):`, cachedFee.dynamicFee);
        dynamicFeeBps = Number(cachedFee.dynamicFee);
      } else {
        console.log(`[Cache MISS] Fetching dynamic fee from API for APR calc (${basePoolInfo.pair})`);
        try {
          const feeResponse = await fetch('/api/swap/get-dynamic-fee', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fromTokenSymbol: fromTokenSymbolForFee,
              toTokenSymbol: toTokenSymbolForFee,
              chainId: baseSepolia.id,
            }),
          });
          if (feeResponse.ok) {
            const feeData = await feeResponse.json();
            dynamicFeeBps = Number(feeData.dynamicFee);
            if (!isNaN(dynamicFeeBps)) {
               setToCache(feeCacheKey, { dynamicFee: feeData.dynamicFee });
               console.log(`[Cache SET] Cached dynamic fee for APR calc (${basePoolInfo.pair}):`, feeData.dynamicFee);
            } else {
              dynamicFeeBps = null; // Invalid fee from API
            }
          } else {
            console.error(`Failed to fetch dynamic fee for APR calc (${basePoolInfo.pair}):`, await feeResponse.text());
          }
        } catch (feeError) {
           console.error(`Error fetching dynamic fee for APR calc (${basePoolInfo.pair}):`, feeError);
        }
      }
    }

    // 3. Calculate APR if data is available
    let calculatedApr = basePoolInfo.apr; // Start with fallback/loading
    if (poolStats?.volume24hUSD !== undefined && dynamicFeeBps !== null && poolStats?.tvlUSD !== undefined && poolStats.tvlUSD > 0) {
       const feeRate = dynamicFeeBps / 10000 / 100;
       const dailyFees = poolStats.volume24hUSD * feeRate;
       const yearlyFees = dailyFees * 365;
       const apr = (yearlyFees / poolStats.tvlUSD) * 100;
       calculatedApr = apr.toFixed(2) + '%';
       console.log(`Calculated APR for ${basePoolInfo.pair}: ${calculatedApr} (Vol24h: ${poolStats.volume24hUSD}, FeeBPS: ${dynamicFeeBps}, TVL: ${poolStats.tvlUSD})`);
    } else {
      console.warn(`Could not calculate APR for ${basePoolInfo.pair} due to missing data. Vol: ${poolStats?.volume24hUSD}, Fee: ${dynamicFeeBps}, TVL: ${poolStats?.tvlUSD}`);
      calculatedApr = "N/A"; // Set to N/A if calculation not possible
    }

    // Combine all fetched/calculated data, ensuring display strings use fetched numeric data
    const combinedPoolData = {
        ...basePoolInfo,
        ...(poolStats || {}),
        apr: calculatedApr,
        dynamicFeeBps: dynamicFeeBps,
        tickSpacing: getPoolById(poolId)?.tickSpacing || DEFAULT_TICK_SPACING,
        // Ensure display strings use fetched numeric data if available
        volume24h: poolStats?.volume24hUSD !== undefined ? formatUSD(poolStats.volume24hUSD) : basePoolInfo.volume24h,
        volume7d: poolStats?.volume7dUSD !== undefined ? formatUSD(poolStats.volume7dUSD) : basePoolInfo.volume7d,
        fees24h: poolStats?.fees24hUSD !== undefined ? formatUSD(poolStats.fees24hUSD) : basePoolInfo.fees24h,
        fees7d: poolStats?.fees7dUSD !== undefined ? formatUSD(poolStats.fees7dUSD) : basePoolInfo.fees7d,
        liquidity: poolStats?.tvlUSD !== undefined ? formatUSD(poolStats.tvlUSD) : basePoolInfo.liquidity,
        // Ensure other fields from Pool type are satisfied if not in basePoolInfo or poolStats
        highlighted: false, // Example, set appropriately
    } as PoolDetailData;

    setCurrentPoolData(combinedPoolData);

    // 4. Fetch/Cache User Positions
    if (isConnected && accountAddress) {
      setIsLoadingPositions(true);
      const userPositionsCacheKey = getUserPositionsCacheKey(accountAddress);
      let allUserPositions = getFromCache<ProcessedPosition[]>(userPositionsCacheKey);

      if (allUserPositions) {
        console.log("[Cache HIT] Using cached user positions for filtering on detail page.");
      } else {
        console.log("[Cache MISS] Fetching all user positions for detail page.");
        try {
          const res = await fetch(`/api/liquidity/get-positions?ownerAddress=${accountAddress}`);
          if (!res.ok) throw new Error(`Failed to fetch positions: ${res.statusText}`);
          const data = await res.json();
          if (Array.isArray(data)) {
            allUserPositions = data;
            setToCache(userPositionsCacheKey, allUserPositions);
            console.log("[Cache SET] Cached all user positions on detail page.");
          } else {
            console.error("Invalid positions data format:", data);
            allUserPositions = [];
          }
        } catch (error) {
          console.error("Failed to fetch user positions:", error);
          allUserPositions = [];
        }
      }

      // Filter positions for this specific pool
      if (allUserPositions && allUserPositions.length > 0) {
        const [poolToken0Raw, poolToken1Raw] = basePoolInfo.pair.split(' / ');
        const poolToken0 = poolToken0Raw?.trim().toUpperCase();
        const poolToken1 = poolToken1Raw?.trim().toUpperCase();
        
        const filteredPositions = allUserPositions.filter(pos => {
          const posToken0 = pos.token0.symbol?.trim().toUpperCase();
          const posToken1 = pos.token1.symbol?.trim().toUpperCase();
          return (posToken0 === poolToken0 && posToken1 === poolToken1) ||
                 (posToken0 === poolToken1 && posToken1 === poolToken0);
        });
        
        setUserPositions(filteredPositions);
        console.log(`[Pool Detail] Filtered ${filteredPositions.length} positions for pool ${basePoolInfo.pair} from ${allUserPositions.length} total positions.`);
      } else {
        setUserPositions([]);
        console.log(`[Pool Detail] No positions found for pool ${basePoolInfo.pair}.`);
      }
      setIsLoadingPositions(false);
    } else {
      setUserPositions([]);
      setIsLoadingPositions(false);
    }
  }, [poolId, isConnected, accountAddress, router]);

  // Targeted refresh function for when liquidity is added - only updates positions and pool stats, not chart data
  const refreshAfterLiquidityAdded = useCallback(async () => {
    if (!poolId) return;

    const basePoolInfo = getPoolConfiguration(poolId);
    if (!basePoolInfo) return;

    const apiPoolIdToUse = basePoolInfo.subgraphId;

    // Only refresh pool stats and user positions, not chart data
    try {
      // Refresh pool stats
      const [res24h, res7d, resTvl] = await Promise.all([
        fetch(`/api/liquidity/get-rolling-volume-fees?poolId=${apiPoolIdToUse}&days=1`),
        fetch(`/api/liquidity/get-rolling-volume-fees?poolId=${apiPoolIdToUse}&days=7`),
        fetch(`/api/liquidity/get-pool-tvl?poolId=${apiPoolIdToUse}`)
      ]);

      if (res24h.ok && res7d.ok && resTvl.ok) {
        const data24h = await res24h.json();
        const data7d = await res7d.json();
        const dataTvl = await resTvl.json();
        const poolStats = {
          volume24hUSD: parseFloat(data24h.volumeUSD),
          fees24hUSD: parseFloat(data7d.feesUSD),
          volume7dUSD: parseFloat(data7d.volumeUSD),
          fees7dUSD: parseFloat(data7d.feesUSD),
          tvlUSD: parseFloat(dataTvl.tvlUSD),
        };
        setToCache(getPoolStatsCacheKey(apiPoolIdToUse), poolStats);

        // Update current pool data with new stats
        setCurrentPoolData(prev => {
          if (!prev) return prev;
          return {
            ...prev,
            ...poolStats,
            volume24h: formatUSD(poolStats.volume24hUSD),
            volume7d: formatUSD(poolStats.volume7dUSD),
            fees24h: formatUSD(poolStats.fees24hUSD),
            fees7d: formatUSD(poolStats.fees7dUSD),
            liquidity: formatUSD(poolStats.tvlUSD),
          };
        });
      }
    } catch (error) {
      console.error("Failed to refresh pool stats after liquidity added:", error);
    }

    // Refresh user positions
    if (isConnected && accountAddress) {
      setIsLoadingPositions(true);
      try {
        const res = await fetch(`/api/liquidity/get-positions?ownerAddress=${accountAddress}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            // Update cache
            const userPositionsCacheKey = getUserPositionsCacheKey(accountAddress);
            setToCache(userPositionsCacheKey, data);

            // Filter positions for this specific pool
            const [poolToken0Raw, poolToken1Raw] = basePoolInfo.pair.split(' / ');
            const poolToken0 = poolToken0Raw?.trim().toUpperCase();
            const poolToken1 = poolToken1Raw?.trim().toUpperCase();
            
            const filteredPositions = data.filter((pos: ProcessedPosition) => {
              const posToken0 = pos.token0.symbol?.trim().toUpperCase();
              const posToken1 = pos.token1.symbol?.trim().toUpperCase();
              return (posToken0 === poolToken0 && posToken1 === poolToken1) ||
                     (posToken0 === poolToken1 && posToken1 === poolToken0);
            });
            
            setUserPositions(filteredPositions);
          }
        }
      } catch (error) {
        console.error("Failed to refresh user positions after liquidity added:", error);
      } finally {
        setIsLoadingPositions(false);
      }
    }
  }, [poolId, isConnected, accountAddress]);

  useEffect(() => {
    fetchPageData();
  }, [fetchPageData]); // Re-fetch if fetchPageData changes

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
    setIncreaseActiveInputSide(null);
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

  // Calculate corresponding amount for increase
  const calculateIncreaseAmount = useCallback(
    debounce(async (inputAmount: string, inputSide: 'amount0' | 'amount1') => {
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

        // For in-range positions, use the API for proper calculations
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
          throw new Error(errorData.message || "Failed to calculate parameters.");
        }

        const result = await calcResponse.json();

        if (inputSide === 'amount0') {
          // We input amount0, so set the calculated amount1
          const amount1InWei = result.amount1;
          const token1Decimals = TOKEN_DEFINITIONS[positionToModify.token1.symbol as TokenSymbol]?.decimals || 18;
          const formattedAmount1 = formatUnits(BigInt(amount1InWei), token1Decimals);
          setIncreaseAmount1(formatTokenDisplayAmount(formattedAmount1));
        } else {
          // We input amount1, so set the calculated amount0
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

        // For in-range positions, use the API for proper calculations
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
          throw new Error(`Token definitions not found for position tokens: ${positionToModify.token0.address}, ${positionToModify.token1.address}`);
        }
        
        const calcResponse = await fetch('/api/liquidity/calculate-liquidity-parameters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token0Symbol: token0Symbol,
            token1Symbol: token1Symbol,
            inputAmount: inputAmount,
            inputTokenSymbol: inputSide === 'amount0' ? token0Symbol : token1Symbol,
            userTickLower: positionToModify.tickLower,
            userTickUpper: positionToModify.tickUpper,
            chainId: chainId,
          }),
        });

        if (!calcResponse.ok) {
          const errorData = await calcResponse.json();
          throw new Error(errorData.message || "Failed to calculate parameters.");
        }

        const result = await calcResponse.json();

        if (inputSide === 'amount0') {
          // We input amount0, so set the calculated amount1
          const amount1InWei = result.amount1;
          const token1Decimals = TOKEN_DEFINITIONS[positionToModify.token1.symbol as TokenSymbol]?.decimals || 18;
          const formattedAmount1 = formatUnits(BigInt(amount1InWei), token1Decimals);
          setDecreaseAmount1(formatTokenDisplayAmount(formattedAmount1));
        } else {
          // We input amount1, so set the calculated amount0
          const amount0InWei = result.amount0;
          const token0Decimals = TOKEN_DEFINITIONS[positionToModify.token0.symbol as TokenSymbol]?.decimals || 18;
          const formattedAmount0 = formatUnits(BigInt(amount0InWei), token0Decimals);
          setDecreaseAmount0(formatTokenDisplayAmount(formattedAmount0));
        }

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
          
          // For out-of-range positions, allow withdrawing just the token the user inputs
          if (inputSide === 'amount0') {
            setWithdrawAmount1("0");
            // Check if this is effectively a full withdraw (withdrawing most/all of token0)
            const isNearFullWithdraw = inputAmountNum >= maxAmount0 * 0.99;
            if (isNearFullWithdraw) {
              // If withdrawing almost all of token0, also withdraw all of token1
              setWithdrawAmount1(formatTokenDisplayAmount(maxAmount1.toString()));
            }
            setIsFullWithdraw(isNearFullWithdraw);
          } else {
            setWithdrawAmount0("0");
            // Check if this is effectively a full withdraw (withdrawing most/all of token1)
            const isNearFullWithdraw = inputAmountNum >= maxAmount1 * 0.99;
            if (isNearFullWithdraw) {
              // If withdrawing almost all of token1, also withdraw all of token0
              setWithdrawAmount0(formatTokenDisplayAmount(maxAmount0.toString()));
            }
            setIsFullWithdraw(isNearFullWithdraw);
          }
          
          return;
        }

        // For in-range positions, use the API for proper calculations
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
          throw new Error(`Token definitions not found for position tokens: ${positionToBurn.token0.address}, ${positionToBurn.token1.address}`);
        }
        
        const calcResponse = await fetch('/api/liquidity/calculate-liquidity-parameters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token0Symbol: token0Symbol,
            token1Symbol: token1Symbol,
            inputAmount: inputAmount,
            inputTokenSymbol: inputSide === 'amount0' ? token0Symbol : token1Symbol,
            userTickLower: positionToBurn.tickLower,
            userTickUpper: positionToBurn.tickUpper,
            chainId: chainId,
          }),
        });

        if (!calcResponse.ok) {
          const errorData = await calcResponse.json();
          throw new Error(errorData.message || "Failed to calculate parameters.");
        }

        const result = await calcResponse.json();

        if (inputSide === 'amount0') {
          // We input amount0, so set the calculated amount1
          const amount1InWei = result.amount1;
          const token1Decimals = TOKEN_DEFINITIONS[positionToBurn.token1.symbol as TokenSymbol]?.decimals || 18;
          const formattedAmount1 = formatUnits(BigInt(amount1InWei), token1Decimals);
          setWithdrawAmount1(formatTokenDisplayAmount(formattedAmount1));
        } else {
          // We input amount1, so set the calculated amount0
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

    increaseLiquidity(increaseData);
    setShowIncreaseModal(false);
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

    decreaseLiquidity(decreaseData, 0); // 0 percentage means use specific amounts from decreaseData
    setShowDecreaseModal(false);
  };

  // Handle withdraw transaction
  const handleConfirmWithdraw = () => {
    if (!positionToBurn || (!withdrawAmount0 && !withdrawAmount1)) {
      toast.error("Please enter at least one amount to withdraw");
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

    const withdrawData: DecreasePositionData = {
      tokenId: positionToBurn.positionId,
      token0Symbol: token0Symbol,
      token1Symbol: token1Symbol,
      decreaseAmount0: withdrawAmount0 || "0",
      decreaseAmount1: withdrawAmount1 || "0",
      isFullBurn: isFullWithdraw,
      poolId: positionToBurn.poolId,
      tickLower: positionToBurn.tickLower,
      tickUpper: positionToBurn.tickUpper,
    };

    decreaseLiquidity(withdrawData, 0); // 0 percentage means use specific amounts from withdrawData
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
        <div className="flex flex-1 flex-col p-3 sm:p-6 sm:px-10">
          {/* Back button and header */}
          <div className="mt-3 mb-6 sm:mt-0">
            {/* Desktop back button */}
            <Button 
              variant="ghost" 
              onClick={() => router.push('/liquidity')}
              className="mb-4 pl-2 hidden sm:flex"
            >
              <ChevronLeftIcon className="mr-2 h-4 w-4" /> Back to Pools
            </Button>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center group sm:mb-0 mb-0">
                {/* Mobile back button - positioned to the left of logo icons */}
                <Button 
                  variant="ghost" 
                  onClick={() => router.push('/liquidity')}
                  className="mr-3 sm:hidden p-2 h-8 w-8"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </Button>
                
                <div className="relative w-20 h-10">
                  <div className="absolute top-0 left-0 w-10 h-10 rounded-full overflow-hidden bg-background z-10">
                    <Image 
                      src={currentPoolData.tokens[0].icon} 
                      alt={currentPoolData.tokens[0].symbol} 
                      width={40} 
                      height={40} 
                      className="w-full h-full object-cover" 
                    />
                  </div>
                  <div className="absolute top-0 left-6 w-10 h-10 rounded-full overflow-hidden bg-background z-30">
                    <Image 
                      src={currentPoolData.tokens[1].icon} 
                      alt={currentPoolData.tokens[1].symbol} 
                      width={40} 
                      height={40} 
                      className="w-full h-full object-cover" 
                    />
                  </div>
                  {/* New background circle for cut-out effect */}
                  <div className="absolute top-[-2px] left-[22px] w-11 h-11 rounded-full bg-[#0f0f0f] z-20"></div>
                </div>
                <div>
                  <div className="flex items-center">
                    <h1 className="text-xl font-bold">{currentPoolData.pair}</h1>
                    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`ml-2 h-6 w-6 transition-opacity ${isPopoverOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                        >
                          <EllipsisVerticalIcon className="h-4 w-4" />
                          <span className="sr-only">Token Details</span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-48 p-2" align="start" side="right" style={{ transform: 'translateY(-8px)' }}>
                        <div className="grid gap-1">
                          <div className="flex justify-between items-center">
                            <span className="text-sm">{currentPoolData.tokens[0].symbol}</span>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground font-mono break-all">{currentPoolData.tokens[0].address ? shortenAddress(currentPoolData.tokens[0].address) : 'N/A'}</span>
                              {currentPoolData.tokens[0].address && (
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-4 w-4 text-muted-foreground hover:bg-muted/30"
                                  onClick={() => {
                                    navigator.clipboard.writeText(currentPoolData.tokens[0].address!);
                                    toast.success("Address copied to clipboard!");
                                  }}
                                >
                                  <CopyIcon style={{ width: '10px', height: '10px' }} />
                                  <span className="sr-only">Copy address</span>
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm">{currentPoolData.tokens[1].symbol}</span>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground font-mono break-all">{currentPoolData.tokens[1].address ? shortenAddress(currentPoolData.tokens[1].address) : 'N/A'}</span>
                              {currentPoolData.tokens[1].address && (
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="h-4 w-4 text-muted-foreground hover:bg-muted/30"
                                  onClick={() => {
                                    navigator.clipboard.writeText(currentPoolData.tokens[1].address!);
                                    toast.success("Address copied to clipboard!");
                                  }}
                                >
                                  <CopyIcon style={{ width: '10px', height: '10px' }} />
                                  <span className="sr-only">Copy address</span>
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {currentPoolData.dynamicFeeBps !== undefined 
                      ? `Fee: ${(currentPoolData.dynamicFeeBps / 10000).toFixed(2)}%` // Assumes 4000 means 0.40% (rate * 1,000,000)
                      : "Fee: Loading..."}
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Main content area with two columns */}
          <div className="flex flex-col lg:flex-row gap-3 lg:gap-6 min-w-0">
            {/* Left Column: Stats and Graph (grows to fill remaining space) */}
            <div ref={leftColumnRef} className="flex-1 flex flex-col space-y-3 lg:space-y-6 min-w-0">
              {/* Pool stats - Mobile: columns, Desktop: grid */}
              <div className="flex flex-col sm:grid sm:grid-cols-2 xl:grid-cols-2 min-[1500px]:grid-cols-4 gap-3 sm:gap-6 flex-shrink-0 lg:max-w-none">
                {/* APY and Total Liquidity in columns on mobile */}
                <div className="flex gap-3 sm:hidden w-full">
                  {/* APY */}
                  <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 flex-1 min-w-0">
                    <div className="flex items-center justify-between px-4 h-9">
                      <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">APY</h2>
                    </div>
                    <div className="px-4 py-1">
                      <div className="text-lg font-medium truncate">{currentPoolData.apr}</div>
                    </div>
                  </div>
                  {/* Toggle card (TVL/Volume/Fees) */}
                  <div
                    className="rounded-lg bg-muted/30 border border-sidebar-border/60 flex-1 min-w-0 cursor-pointer group"
                    onClick={cycleToggleMetric}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        cycleToggleMetric();
                      }
                    }}
                  >
                    <div className="flex items-center justify-between px-4 h-9">
                      <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold truncate">
                        {toggleMetric === 'liquidity' && 'TVL'}
                        {toggleMetric === 'volume' && 'VOLUME (24H)'}
                        {toggleMetric === 'fees' && 'FEES (24H)'}
                      </h2>
                      <button
                        className="ml-2 p-1 rounded transition-colors hover:bg-muted/50 group-hover:bg-muted/50"
                        aria-label="Cycle metric"
                      >
                        <ArrowRightLeftIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="px-4 py-1">
                      <div className="text-lg font-medium truncate">
                        {toggleMetric === 'liquidity' && currentPoolData.liquidity}
                        {toggleMetric === 'volume' && currentPoolData.volume24h}
                        {toggleMetric === 'fees' && currentPoolData.fees24h}
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Desktop APY */}
                <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 hidden md:block">
                  <div className="flex items-center justify-between px-4 py-2">
                    <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">APY</h2>
                  </div>
                  <div className="px-4 py-1">
                    <div className="text-lg font-medium">{currentPoolData.apr}</div>
                  </div>
                </div>
                
                {/* Desktop TVL */}
                <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 hidden md:block">
                  <div className="flex items-center justify-between px-4 py-2">
                    <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">
                      {windowWidth < 1500
                        ? (toggleMetric === 'liquidity' ? 'TVL' : toggleMetric === 'volume' ? 'VOLUME (24H)' : 'FEES (24H)')
                        : 'TVL'}
                    </h2>
                    {windowWidth < 1500 && (
                      <button
                        onClick={cycleToggleMetric}
                        className="ml-2 p-1 hover:bg-muted/50 rounded transition-colors"
                        aria-label="Cycle metric"
                      >
                        <ArrowRightLeftIcon className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="px-4 py-1">
                    <div className="text-lg font-medium">
                      {windowWidth < 1500 ? (
                        <>
                          {toggleMetric === 'liquidity' && currentPoolData.liquidity}
                          {toggleMetric === 'volume' && currentPoolData.volume24h}
                          {toggleMetric === 'fees' && currentPoolData.fees24h}
                        </>
                      ) : (
                        currentPoolData.liquidity
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 hidden min-[1500px]:block">
                  <div className="flex items-center justify-between px-4 py-2">
                    <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">VOLUME (24H)</h2>
                  </div>
                  <div className="px-4 py-1">
                    <div className="text-lg font-medium">{currentPoolData.volume24h}</div>
                  </div>
                </div>
                <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 hidden min-[1500px]:block">
                  <div className="flex items-center justify-between px-4 py-2">
                    <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">FEES (24H)</h2>
                  </div>
                  <div className="px-4 py-1">
                    <div className="text-lg font-medium">{currentPoolData.fees24h}</div>
                  </div>
                </div>
              </div>
              
              {/* Pool Overview Section (formerly Tab) */}
              <div className="flex-1 min-h-0 lg:max-w-none">
                <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 transition-colors flex flex-col h-full min-h-[300px] sm:min-h-[350px] max-h-[420px] sm:max-h-none">
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
                                  margin={{
                                    top: 5,
                                    right: 20,
                                    left: 16,
                                    bottom: 5,
                                  }}
                                >
                                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                                  <XAxis
                                    dataKey="date"
                                    tickLine={false}
                                    axisLine={false}
                                    tickMargin={10}
                                    padding={{ left: 16, right: 20 }}
                                    tickFormatter={(value) => {
                                      const date = new Date(value);
                                      return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                                    }}
                                    tick={{ fontSize: '0.75rem' }}
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
                                            {/* Vol/TVL Ratio with line indicator */}
                                            <div className="flex w-full flex-wrap items-stretch gap-2">
                                              <div
                                                className="shrink-0 rounded-[2px] w-[2px] h-4"
                                                style={{
                                                  backgroundColor: 'hsl(var(--chart-3))',
                                                }}
                                              />
                                              <div className="flex flex-1 justify-between leading-none items-center">
                                                <span className="text-muted-foreground">Vol/TVL</span>
                                                <span className="font-mono font-medium tabular-nums text-foreground">
                                                  {typeof dataPoint.volumeTvlRatio === 'number' ? dataPoint.volumeTvlRatio.toFixed(3) : 'N/A'}
                                                </span>
                                              </div>
                                            </div>

                                            {/* EMA with line indicator */}
                                            <div className="flex w-full flex-wrap items-stretch gap-2">
                                              <div
                                                className="shrink-0 rounded-[2px] w-[2px] h-4"
                                                style={{
                                                  backgroundImage:
                                                    'repeating-linear-gradient(to bottom, hsl(var(--chart-2)) 0 2px, transparent 2px 4px)',
                                                }}
                                              />
                                              <div className="flex flex-1 justify-between leading-none items-center">
                                                <span className="text-muted-foreground">EMA</span>
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
                              <Bar dataKey={activeChart === 'volume' ? 'volumeUSD' : 'tvlUSD'} fill={chartConfig[activeChart]?.color || `var(--color-${activeChart})`} />
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
                                  margin={{ top: 24, right: 16, bottom: 24, left: 16 }}
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
                                                <span className="text-muted-foreground">Vol/TVL</span>
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
                                                <span className="text-muted-foreground">EMA</span>
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
                                tickFormatter={(value) => formatUSD(value)}
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
                              <Bar dataKey={activeChart === 'volume' ? 'volumeUSD' : 'tvlUSD'} fill={chartConfig[activeChart]?.color || `var(--color-${activeChart})`} />
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

            {/* Right Column: Add Liquidity Form (fixed width on desktop, full width on mobile) */}
            <div className="w-full lg:w-[450px] flex-shrink-0 min-w-0" ref={addLiquidityFormRef}>
              {/* Tabs for Swap/Deposit/Withdraw - REMOVED */}
              {/* <div className="flex border-b border-border mb-4 px-6 pt-6">
                <button
                  className={`py-2 px-4 text-sm font-medium ${activeTab === 'deposit' 
                    ? 'text-foreground border-b-2 border-primary' 
                    : 'text-muted-foreground hover:text-foreground/80'}`}
                  onClick={() => setActiveTab('deposit')}
                >
                  Deposit
                </button>
                <button
                  className={`py-2 px-4 text-sm font-medium ${activeTab === 'withdraw' 
                    ? 'text-foreground border-b-2 border-primary' 
                    : 'text-muted-foreground hover:text-foreground/80'}`}
                  onClick={() => {
                    setActiveTab('withdraw');
                    toast.info("Withdraw functionality coming soon");
                  }}
                >
                  Withdraw
                </button>
                <button
                  className={`py-2 px-4 text-sm font-medium ${activeTab === 'swap' 
                    ? 'text-foreground border-b-2 border-primary' 
                    : 'text-muted-foreground hover:text-foreground/80'}`}
                  onClick={() => {
                    setActiveTab('swap');
                    toast.info("Swap functionality coming soon");
                  }}
                >
                  Swap
                </button>
              </div> */}

              {poolId && currentPoolData && ( // Always render form (removed activeTab condition)
                <div ref={addLiquidityFormRef} className="w-full rounded-lg bg-muted/30 border border-sidebar-border/60 transition-colors overflow-hidden relative">
                  {/* Container header to match novel layout */}
                  <div className="flex items-center justify-between px-4 py-2 border-b border-sidebar-border/60">
                    <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">ADD LIQUIDITY</h2>
                  </div>
                  {/* Content */}
                  <div className="p-3 sm:p-4">
                    <AddLiquidityFormMemo
                      selectedPoolId={poolId}
                      poolApr={currentPoolData?.apr}
                      onLiquidityAdded={() => {
                        refreshAfterLiquidityAdded();
                      }}
                      sdkMinTick={SDK_MIN_TICK}
                      sdkMaxTick={SDK_MAX_TICK}
                      defaultTickSpacing={getPoolById(poolId)?.tickSpacing || DEFAULT_TICK_SPACING}
                      activeTab={'deposit'} // Always pass 'deposit'
                    />
                  </div>
                  {/* Right vertical divider to align with novel layout sections */}
                  <div className="hidden lg:block absolute top-0 right-0 bottom-0 w-0.5 bg-white/5" />
                </div>
              )}
              
              {/* Placeholder content for Withdraw and Swap - REMOVED */}              
              {/* {activeTab !== 'deposit' && (
                <div className="flex items-center justify-center h-full bg-muted/20 rounded-lg mx-6 mb-6">
                   <span className="text-muted-foreground capitalize">{activeTab} functionality coming soon</span>
                </div>
              )} */}
            </div>
          </div>
          
          {/* Your Positions Section (Full width below the columns) */}
          <div className="space-y-3 lg:space-y-4 mt-6 mb-3 lg:mt-6 lg:mb-0"> {/* Mobile: top margin double bottom; desktop unchanged */}
            {/* Static title - always visible */}
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium">Your Positions</h3>
            </div>
            
            {isLoadingPositions ? (
              /* Simple pulsing skeleton container */
              <div className="rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 h-20 animate-pulse">
              </div>
            ) : userPositions.length > 0 ? (
              <div>
                {/* Replace Table with individual position segments */}
                <div className="grid gap-3 lg:gap-4 xl:grid-cols-2 xl:gap-4 2xl:grid-cols-2 2xl:gap-4 responsive-grid">
                  {userPositions.map((position) => {
                    const estimatedCurrentTick = position.isInRange 
                      ? Math.floor((position.tickLower + position.tickUpper) / 2)
                      : (position.tickLower > 0 
                          ? position.tickLower - (10 * (currentPoolData?.tickSpacing || DEFAULT_TICK_SPACING))
                          : position.tickUpper + (10 * (currentPoolData?.tickSpacing || DEFAULT_TICK_SPACING)));

                                            return (
                          <Card 
                            key={position.positionId}
                            className="bg-muted/30 border border-sidebar-border/60 transition-colors group"
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

                              {/* Column 2: Liquidity - Compact, stacked, allow more width */}
                              <div className="flex flex-col min-w-0 items-start truncate pr-2">
                                <div className="flex flex-col text-xs text-muted-foreground whitespace-nowrap">
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
                                      <div className="text-xs font-medium truncate">${calculatePositionUsd(position).toFixed(2)}</div>
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
                                          const ageSeconds = position.ageSeconds;
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
                                      <div className="font-medium text-foreground">Time Created</div>
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
                                      <HoverCard>
                                        <HoverCardTrigger asChild>
                                            <div className={`flex items-center justify-center h-4 rounded-md px-1.5 text-[10px] leading-none ${statusColor} cursor-default`}>
                                              {statusText}
                                            </div>
                                        </HoverCardTrigger>
                                        <HoverCardContent
                                          side="top"
                                          align="center"
                                          sideOffset={8}
                                          className="w-48 p-2 border border-sidebar-border bg-[#0f0f0f] text-xs shadow-lg rounded-lg"
                                        >
                                          <div className="grid gap-1">
                                            <div className="flex items-center justify-between">
                                              <span className="text-muted-foreground">Min. Price</span>
                                              <span className="font-mono tabular-nums">
                                                {(() => {
                                                  const baseTokenForPriceDisplay = determineBaseTokenForPriceDisplay(
                                                    position.token0.symbol || '',
                                                    position.token1.symbol || ''
                                                  );
                                                  return convertTickToPrice(
                                                    position.tickLower,
                                                    currentPoolTick,
                                                    currentPrice,
                                                    baseTokenForPriceDisplay,
                                                    position.token0.symbol || '',
                                                    position.token1.symbol || ''
                                                  );
                                                })()}
                                              </span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                              <span className="text-muted-foreground">Max. Price</span>
                                              <span className="font-mono tabular-nums">
                                                {(() => {
                                                  const baseTokenForPriceDisplay = determineBaseTokenForPriceDisplay(
                                                    position.token0.symbol || '',
                                                    position.token1.symbol || ''
                                                  );
                                                  return convertTickToPrice(
                                                    position.tickUpper,
                                                    currentPoolTick,
                                                    currentPrice,
                                                    baseTokenForPriceDisplay,
                                                    position.token0.symbol || '',
                                                    position.token1.symbol || ''
                                                  );
                                                })()}
                                              </span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                              <span className="text-muted-foreground">Current</span>
                                              <span className="font-mono tabular-nums">
                                                {(() => {
                                                  if (!currentPrice) return 'N/A';
                                                  const currentNum = parseFloat(currentPrice);
                                                  if (!Number.isFinite(currentNum) || currentNum <= 0) return 'N/A';
                                                  const inverse = 1 / currentNum;
                                                  const flip = inverse > currentNum;
                                                  const displaySymbol = flip ? (position.token0.symbol || '') : (position.token1.symbol || '');
                                                  const decimals = TOKEN_DEFINITIONS[displaySymbol as TokenSymbol]?.displayDecimals ?? 4;
                                                  const value = flip ? inverse : currentNum;
                                                  if (!Number.isFinite(value)) return '∞';
                                                  if (value >= 0 && value < 1e-11) return '0';
                                                  return value.toFixed(decimals);
                                                })()}
                                              </span>
                                            </div>
                                          </div>
                                        </HoverCardContent>
                                      </HoverCard>
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
                                              // TODO: Implement Claim Fees
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
                                              // TODO: Implement Compound Fees
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
                          onChange={(e) => {
                            const newValue = e.target.value;
                            const maxAmount = parseFloat(positionToBurn.token0.amount);
                            if (parseFloat(newValue) > maxAmount) {
                              handleWithdrawAmountChange(maxAmount.toString(), 'amount0');
                              return;
                            }
                            handleWithdrawAmountChange(newValue, 'amount0');
                            setWithdrawActiveInputSide('amount0');
                            if (newValue && parseFloat(newValue) > 0) {
                              calculateWithdrawAmount(newValue, 'amount0');
                            } else {
                              setWithdrawAmount1("");
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

                {/* Plus Icon */}
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
                          onChange={(e) => {
                            const newValue = e.target.value;
                            const maxAmount = parseFloat(positionToBurn.token1.amount);
                            if (parseFloat(newValue) > maxAmount) {
                              handleWithdrawAmountChange(maxAmount.toString(), 'amount1');
                              return;
                            }
                            handleWithdrawAmountChange(newValue, 'amount1');
                            setWithdrawActiveInputSide('amount1');
                            if (newValue && parseFloat(newValue) > 0) {
                              calculateWithdrawAmount(newValue, 'amount1');
                            } else {
                              setWithdrawAmount0("");
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
                (positionToBurn?.isInRange ? 
                  // For in-range positions, require both amounts
                  (!withdrawAmount0 || !withdrawAmount1 || parseFloat(withdrawAmount0) <= 0 || parseFloat(withdrawAmount1) <= 0) :
                  // For out-of-range positions, require at least one amount
                  ((!withdrawAmount0 || parseFloat(withdrawAmount0) <= 0) && (!withdrawAmount1 || parseFloat(withdrawAmount1) <= 0))
                )
              }
            >
              <span className={(isBurningLiquidity || isDecreasingLiquidity) ? "animate-pulse" : ""}>
                {isFullWithdraw ? "Withdraw All" : "Withdraw"}
              </span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Increase Position Modal */}
      <Dialog open={showIncreaseModal} onOpenChange={setShowIncreaseModal}>
        <DialogContent className="w-[calc(100%-2rem)] sm:w-full max-w-lg border border-border shadow-lg [&>button]:hidden" style={{ backgroundColor: 'var(--modal-background)' }}>
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
                      onClick={() => handleUseFullBalance(token0BalanceData?.formatted || "0", 'aUSDC' as TokenSymbol, true)}
                      disabled={isIncreasingLiquidity || isIncreaseCalculating}
                    >  
                      Balance: {displayToken0Balance} {positionToModify.token0.symbol}
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
                          onChange={(e) => {
                            const newValue = e.target.value;
                            handleIncreaseAmountChange(newValue, 'amount0');
                            if (newValue && parseFloat(newValue) > 0) {
                              calculateIncreaseAmount(newValue, 'amount0');
                            } else {
                              setIncreaseAmount1("");
                            }
                          }}
                          disabled={isIncreaseCalculating && increaseActiveInputSide === 'amount1'}
                          className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                        />
                      </div>
                    </div>
                  </div>
                  {isIncreaseCalculating && increaseActiveInputSide === 'amount0' && (
                    <div className="text-xs text-muted-foreground mt-1">Calculating...</div>
                  )}
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
                      onClick={() => handleUseFullBalance(token1BalanceData?.formatted || "0", 'aUSDT' as TokenSymbol, false)}
                      disabled={isIncreasingLiquidity || isIncreaseCalculating}
                    >  
                      Balance: {displayToken1Balance} {positionToModify.token1.symbol}
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
                          onChange={(e) => {
                            const newValue = e.target.value;
                            handleIncreaseAmountChange(newValue, 'amount1');
                            if (newValue && parseFloat(newValue) > 0) {
                              calculateIncreaseAmount(newValue, 'amount1');
                            } else {
                              setIncreaseAmount0("");
                            }
                          }}
                          disabled={isIncreaseCalculating && increaseActiveInputSide === 'amount0'}
                          className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                        />
                      </div>
                    </div>
                  </div>
                  {isIncreaseCalculating && increaseActiveInputSide === 'amount1' && (
                    <div className="text-xs text-muted-foreground mt-1">Calculating...</div>
                  )}
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
                      const newValue = e.target.value;
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
                  {isDecreaseCalculating && decreaseActiveInputSide === 'amount0' && (
                    <div className="text-xs text-muted-foreground mt-1">Calculating...</div>
                  )}
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
                      const newValue = e.target.value;
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
                  {isDecreaseCalculating && decreaseActiveInputSide === 'amount1' && (
                    <div className="text-xs text-muted-foreground mt-1">Calculating...</div>
                  )}
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
                  // For in-range positions, require both amounts
                  (!decreaseAmount0 || !decreaseAmount1 || parseFloat(decreaseAmount0) <= 0 || parseFloat(decreaseAmount1) <= 0) :
                  // For out-of-range positions, require at least one amount
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