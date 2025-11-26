"use client";

import { AppLayout } from "@/components/app-layout";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ArrowRightLeftIcon, PlusIcon, MinusIcon, ArrowLeftIcon, RefreshCwIcon, ChevronLeftIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";
import { useRouter, useParams } from "next/navigation";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import type { ProcessedPosition } from "../../../pages/api/liquidity/get-positions";
import { TOKEN_DEFINITIONS, TokenSymbol, SDK_MIN_TICK, SDK_MAX_TICK, DEFAULT_TICK_SPACING } from "@/lib/pools-config";
import { formatUSD } from "@/lib/format";
import { formatUnits as viemFormatUnits, type Hex } from "viem";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { getPoolById, getPoolSubgraphId, getToken } from "@/lib/pools-config";
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
import { useBurnLiquidity, type BurnPositionData } from "@/components/liquidity/useBurnLiquidity";
import { useIncreaseLiquidity, type IncreasePositionData } from "@/components/liquidity/useIncreaseLiquidity";
import { useDecreaseLiquidity, type DecreasePositionData } from "@/components/liquidity/useDecreaseLiquidity";

// Import TanStack Table components
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  RowData
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

// Define the structure of the chart data points from the API
interface ChartDataPoint {
  date: string; // YYYY-MM-DD
  volumeUSD: number;
  tvlUSD: number;
  // apr?: number; // Optional, if your API provides it
}

const TICK_BARS_COUNT = 31;
const TICKS_PER_BAR = 10 * DEFAULT_TICK_SPACING;

// Format token amounts for display
const formatTokenDisplayAmount = (amount: string) => {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  if (num === 0) return "0.00";
  if (num < 0.0001) return "< 0.0001";
  return num.toFixed(4);
};

// Mock function to calculate USD value (in a real app, you'd use actual price feeds)
const calculateTotalValueUSD = (position: ProcessedPosition) => {
  // This is a placeholder. In a real app, you would:
  // 1. Get current token prices from an API or state
  // 2. Multiply each token amount by its price
  // 3. Sum them up
  
  // For this demo, let's use mock prices
  const mockPrices: Record<string, number> = {
    YUSDC: 1.0,
    BTCRL: 61000.0,
    mUSDT: 1.0,
    aETH: 2400.0,
    ETH: 2400.0,
    // Add other token prices as needed
  };
  
  const token0Value = parseFloat(position.token0.amount) * 
    (mockPrices[position.token0.symbol] || 1.0);
  const token1Value = parseFloat(position.token1.amount) * 
    (mockPrices[position.token1.symbol] || 1.0);
  
  return token0Value + token1Value;
};

// TickRangeVisualization Component
const TickRangeVisualization = ({ 
  tickLower, 
  tickUpper, 
  currentTick,
  tickSpacing
}: { 
  tickLower: number; 
  tickUpper: number; 
  currentTick: number;
  tickSpacing: number;
}) => {
  // Adaptive TICKS_PER_BAR based on tick spacing and position range
  const positionRange = tickUpper - tickLower;
  let TICKS_PER_BAR: number;
  
  if (tickSpacing === 1) {
    // For very fine tick spacing, use a larger multiplier to make visualization meaningful
    TICKS_PER_BAR = Math.max(50, positionRange / 10);
  } else {
    // For larger tick spacing, use the original logic
    TICKS_PER_BAR = 10 * tickSpacing;
  }

  // Calculate center of the visualization
  const centerBarIndex = Math.floor(TICK_BARS_COUNT / 2);
  
  // For positions, center around the middle of the position range rather than current tick
  const positionCenter = Math.floor((tickLower + tickUpper) / 2);
  const centerBarStartTick = Math.floor(positionCenter / TICKS_PER_BAR) * TICKS_PER_BAR;
  
  // Generate bars centered around the position
  const bars = Array.from({ length: TICK_BARS_COUNT }, (_, i) => {
    const offset = i - centerBarIndex;
    const barStartTick = centerBarStartTick + (offset * TICKS_PER_BAR);
    const barEndTick = barStartTick + TICKS_PER_BAR;
    
    // Check various conditions
    const containsCurrentTick = currentTick >= barStartTick && currentTick < barEndTick;
    const containsPosition = 
      (barStartTick <= tickUpper && barEndTick > tickLower) || 
      (tickLower <= barStartTick && tickUpper >= barEndTick) ||
      (tickLower <= barStartTick && tickUpper >= barStartTick) ||
      (tickLower <= barEndTick && tickUpper >= barEndTick);
    
    return { containsCurrentTick, containsPosition };
  });

  return (
    <div className="w-full flex justify-center my-1">
      <div className="flex space-x-[1px]">
        {bars.map((bar, i) => {
          let bgColor = "bg-muted/30";
          if (bar.containsCurrentTick) {
            bgColor = "bg-white";
          } else if (bar.containsPosition) {
            bgColor = "bg-orange-500/80";
          }
          
          return (
            <div 
              key={i}
              className={`h-4 w-[2px] rounded-full ${bgColor}`}
            />
          );
        })}
      </div>
    </div>
  );
};

// Sample chart data for the pool - THIS WILL BE REPLACED BY API DATA
const chartConfig = {
  views: { label: "Daily Values" },
  volume: { label: "Volume", color: "hsl(var(--chart-1))" },
  tvl: { label: "TVL", color: "hsl(var(--chart-2))" },
  // apr: { label: "APR", color: "#e85102" }, // Removed APR from chart config for now
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
      { symbol: token0.symbol, icon: token0.icon },
      { symbol: token1.symbol, icon: token1.icon }
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

export default function PoolDetailPage() {
  const router = useRouter();
  const params = useParams<{ poolId: string }>();
  const poolId = params?.poolId;
  const [userPositions, setUserPositions] = useState<ProcessedPosition[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [activeChart, setActiveChart] = useState<keyof Pick<typeof chartConfig, 'volume' | 'tvl'>>("volume");
  const { address: accountAddress, isConnected, chainId } = useAccount();
  const [sorting, setSorting] = useState<SortingState>([]); // Added for table sorting
  const addLiquidityFormRef = useRef<HTMLDivElement>(null); // Ref for scrolling to form

  // State for the pool's detailed data (including fetched stats)
  const [currentPoolData, setCurrentPoolData] = useState<PoolDetailData | null>(null);
  // State for API-fetched chart data
  const [apiChartData, setApiChartData] = useState<ChartDataPoint[]>([]);
  const [isLoadingChartData, setIsLoadingChartData] = useState(false);

  // State for managing active tab (Deposit/Withdraw/Swap) - Lifted from AddLiquidityForm
  const [activeTab, setActiveTab] = useState<'deposit' | 'withdraw' | 'swap'>('deposit');

  // State for burn confirmation dialog
  const [showBurnConfirmDialog, setShowBurnConfirmDialog] = useState(false);
  const [positionToBurn, setPositionToBurn] = useState<ProcessedPosition | null>(null);

  // New state for increase/decrease modals
  const [showIncreaseModal, setShowIncreaseModal] = useState(false);
  const [showDecreaseModal, setShowDecreaseModal] = useState(false);
  const [positionToModify, setPositionToModify] = useState<ProcessedPosition | null>(null);

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
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Memoized callback functions to prevent infinite re-renders
  const onLiquidityBurnedCallback = useCallback(() => {
    toast.success("Position burn successful! Refreshing your positions...");
    setRefreshTrigger(prev => prev + 1); // Trigger refresh
  }, []);

  const onLiquidityIncreasedCallback = useCallback(() => {
    toast.success("Position increased successfully! Refreshing your positions...");
    setRefreshTrigger(prev => prev + 1); // Trigger refresh
  }, []);

  const onLiquidityDecreasedCallback = useCallback(() => {
    toast.success("Position modified successfully! Refreshing your positions...");
    setRefreshTrigger(prev => prev + 1); // Trigger refresh
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

  // Define columns for the User Positions table (can be defined early)
  const positionColumns: ColumnDef<ProcessedPosition>[] = useMemo(() => [
    {
      id: "pair",
      header: "Pair / Range",
      cell: ({ row }) => {
        const position = row.original;
        const getTokenIcon = (symbol?: string) => {
          if (!symbol) return "/placeholder-logo.svg";
          const tokenConfig = getToken(symbol);
          return tokenConfig?.icon || "/placeholder-logo.svg";
        };
        const estimatedCurrentTick = position.isInRange 
          ? Math.floor((position.tickLower + position.tickUpper) / 2)
          : (position.tickLower > 0 
              ? position.tickLower - (10 * (currentPoolData?.tickSpacing || DEFAULT_TICK_SPACING))
              : position.tickUpper + (10 * (currentPoolData?.tickSpacing || DEFAULT_TICK_SPACING)));

        return (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <div className="relative w-14 h-7">
                <div className="absolute top-0 left-0 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
                  <Image src={getTokenIcon(position.token0.symbol)} alt={position.token0.symbol || 'Token 0'} width={28} height={28} className="w-full h-full object-cover" />
                </div>
                <div className="absolute top-0 left-4 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
                  <Image src={getTokenIcon(position.token1.symbol)} alt={position.token1.symbol || 'Token 1'} width={28} height={28} className="w-full h-full object-cover" />
                </div>
              </div>
              <span className="font-medium text-sm">
                {position.token0.symbol || 'N/A'} / {position.token1.symbol || 'N/A'}
              </span>
            </div>
            <TickRangeVisualization
              tickLower={position.tickLower}
              tickUpper={position.tickUpper}
              currentTick={estimatedCurrentTick}
              tickSpacing={currentPoolData?.tickSpacing || DEFAULT_TICK_SPACING}
            />
          </div>
        );
      },
    },
    {
      accessorFn: (row) => row.token0.amount,
      id: "token0Amount",
      header: "Token 0 Amount",
      cell: ({ row }) => <div>{formatTokenDisplayAmount(row.original.token0.amount)} {row.original.token0.symbol}</div>,
    },
    {
      accessorFn: (row) => row.token1.amount,
      id: "token1Amount",
      header: "Token 1 Amount",
      cell: ({ row }) => <div>{formatTokenDisplayAmount(row.original.token1.amount)} {row.original.token1.symbol}</div>,
    },
    {
      id: "totalValueUSD",
      header: "Total Value (USD)",
      cell: ({ row }) => {
        const totalValueUSD = calculateTotalValueUSD(row.original);
        return <div>{formatUSD(totalValueUSD)}</div>;
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const position = row.original;
        return (
          <Badge variant={position.isInRange ? "default" : "secondary"} 
                 className={position.isInRange ? "bg-green-500/20 text-green-700 border-green-500/30" : "bg-orange-500/20 text-orange-700 border-orange-500/30"}>
            {position.isInRange ? "In Range" : "Out of Range"}
          </Badge>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const position = row.original;
        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="text-green-600 hover:text-green-700 hover:bg-green-500/10 p-1.5 h-auto"
              onClick={() => handleIncreasePosition(position)}
              disabled={isBurningLiquidity || isIncreasingLiquidity || isDecreasingLiquidity}
            >
              <PlusIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-orange-600 hover:text-orange-700 hover:bg-orange-500/10 p-1.5 h-auto"
              onClick={() => handleDecreasePosition(position)}
              disabled={isBurningLiquidity || isIncreasingLiquidity || isDecreasingLiquidity}
            >
              <MinusIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-red-500 hover:text-red-600 hover:bg-red-500/10 p-1.5 h-auto"
              onClick={() => handleBurnPosition(position)}
              disabled={isBurningLiquidity && positionToBurn?.positionId === position.positionId}
            >
              {isBurningLiquidity && positionToBurn?.positionId === position.positionId 
                ? <RefreshCwIcon className="h-4 w-4 animate-spin" /> 
                : <Trash2Icon className="h-4 w-4" />}
            </Button>
          </div>
        );
      },
    },
  ], [isBurningLiquidity, isIncreasingLiquidity, isDecreasingLiquidity, positionToBurn?.positionId, currentPoolData?.tickSpacing]);

  // Memoize table data and config to prevent unnecessary re-renders
  const memoizedPositions = useMemo(() => userPositions, [userPositions]);
  const memoizedColumns = useMemo(() => positionColumns, [positionColumns]);

  // Initialize the table instance (Hook call)
  const positionsTable = useReactTable({
    data: memoizedPositions,
    columns: memoizedColumns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    state: {
      sorting,
    },
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
            fees24hUSD: parseFloat(data24h.feesUSD),
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
            console.error("Error fetching positions on detail page:", (data as any).message);
            allUserPositions = [];
          }
        } catch (error) {
          console.error("Failed to fetch user positions on detail page:", error);
          allUserPositions = [];
        }
      }

      // Filter positions for the current pool
      if (allUserPositions && basePoolInfo) {
        const poolSubgraphId = getPoolSubgraphId(poolId); // Get the subgraph ID for the current pool
        const filteredPositions = allUserPositions.filter(pos => {
          // Compare the pool ID from the position with the subgraph ID of the current page's pool
          return pos.poolId.toLowerCase() === poolSubgraphId?.toLowerCase();
        });
        setUserPositions(filteredPositions);
        console.log(`Filtered ${filteredPositions.length} positions for pool ID ${poolSubgraphId} from ${allUserPositions.length} total cached/fetched positions.`);
      } else {
        setUserPositions([]);
      }
      setIsLoadingPositions(false);
    } else {
      setUserPositions([]);
    }
  }, [poolId, isConnected, accountAddress, refreshTrigger]); // Add useCallback dependencies

  useEffect(() => {
    fetchPageData();
  }, [fetchPageData]); // Re-fetch if fetchPageData changes

  // Calculate total liquidity value
  const totalLiquidity = userPositions.reduce((sum, pos) => {
    return sum + calculateTotalValueUSD(pos);
  }, 0);

  // Handle burn position
  const handleBurnPosition = (position: ProcessedPosition) => {
    if (!position.positionId || !position.token0.symbol || !position.token1.symbol) {
      toast.error("Cannot burn position: Missing critical position data (ID or token symbols).");
      return;
    }
    setPositionToBurn(position);
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
    setShowBurnConfirmDialog(false);
    setPositionToBurn(null);
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
          const formattedAmount1 = viemFormatUnits(BigInt(amount1InWei), token1Decimals);
          setIncreaseAmount1(formatTokenDisplayAmount(formattedAmount1));
        } else {
          // We input amount1, so set the calculated amount0
          const amount0InWei = result.amount0;
          const token0Decimals = TOKEN_DEFINITIONS[positionToModify.token0.symbol as TokenSymbol]?.decimals || 18;
          const formattedAmount0 = viemFormatUnits(BigInt(amount0InWei), token0Decimals);
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
          const formattedAmount1 = viemFormatUnits(BigInt(amount1InWei), token1Decimals);
          setDecreaseAmount1(formatTokenDisplayAmount(formattedAmount1));
        } else {
          // We input amount1, so set the calculated amount0
          const amount0InWei = result.amount0;
          const token0Decimals = TOKEN_DEFINITIONS[positionToModify.token0.symbol as TokenSymbol]?.decimals || 18;
          const formattedAmount0 = viemFormatUnits(BigInt(amount0InWei), token0Decimals);
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

  // Early return for loading state AFTER all hooks have been called
  if (!poolId || !currentPoolData) return (
    <AppLayout>
      <div className="flex flex-1 justify-center items-center p-6">
        <RefreshCwIcon className="mr-2 h-6 w-6 animate-spin" /> Loading pool data...
      </div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col p-6 px-10">
          {/* Back button and header */}
          <div className="mb-6">
            <Button 
              variant="ghost" 
              onClick={() => router.push('/liquidity')}
              className="mb-4 pl-2"
            >
              <ChevronLeftIcon className="mr-2 h-4 w-4" /> Back to Pools
            </Button>
            
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative w-14 h-7">
                  <div className="absolute top-0 left-0 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
                    <Image 
                      src={currentPoolData.tokens[0].icon} 
                      alt={currentPoolData.tokens[0].symbol} 
                      width={28} 
                      height={28} 
                      className="w-full h-full object-cover" 
                    />
                  </div>
                  <div className="absolute top-0 left-4 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
                    <Image 
                      src={currentPoolData.tokens[1].icon} 
                      alt={currentPoolData.tokens[1].symbol} 
                      width={28} 
                      height={28} 
                      className="w-full h-full object-cover" 
                    />
                  </div>
                </div>
                <div>
                  <h1 className="text-2xl font-bold">{currentPoolData.pair}</h1>
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
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Left Column: Stats and Graph (takes up 3/4 on larger screens) */}
            <div className="lg:w-3/4 space-y-6">
              {/* Pool stats */}
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>APR</CardDescription>
                    <CardTitle>{currentPoolData.apr}</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Total Liquidity</CardDescription>
                    <CardTitle>{currentPoolData.liquidity}</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Volume (24h)</CardDescription>
                    <CardTitle>{currentPoolData.volume24h}</CardTitle>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardDescription>Fees (24h)</CardDescription>
                    <CardTitle>{currentPoolData.fees24h}</CardTitle>
                  </CardHeader>
                </Card>
              </div>
              
              {/* Pool Overview Section (formerly Tab) */}
              <div className="space-y-4 mb-8">
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-center">
                      <CardTitle>Pool Activity</CardTitle>
                      <div className="flex space-x-3">
                        <Button 
                          variant={activeChart === 'volume' ? 'secondary' : 'ghost'} 
                          size="sm" 
                          onClick={() => setActiveChart('volume')}
                        >
                          Volume
                        </Button>
                        <Button 
                          variant={activeChart === 'tvl' ? 'secondary' : 'ghost'} 
                          size="sm" 
                          onClick={() => setActiveChart('tvl')}
                        >
                          TVL
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer
                      config={chartConfig}
                      className="aspect-auto h-[350px] w-full"
                    >
                      {isLoadingChartData ? (
                        <div className="flex justify-center items-center h-full">
                          <RefreshCwIcon className="mr-2 h-6 w-6 animate-spin" /> Loading chart...
                        </div>
                      ) : apiChartData.length > 0 ? (
                      <BarChart
                        accessibilityLayer
                        data={apiChartData} // Use API fetched data
                        margin={{
                          left: 25,
                          right: 25,
                          top: 20, 
                          bottom: 30
                        }}
                      >
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
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
                          cursor={false} // Added cursor={false} for better UX on BarChart
                          content={
                            <ChartTooltipContent
                              className="w-[150px]"
                              nameKey="views" // This might need adjustment if 'views' is not a direct key in your data
                              labelFormatter={(value) => {
                                return new Date(value).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                });
                              }}
                              // Formatter to display the correct data based on activeChart
                              formatter={(value, name, entry) => {
                                const dataKey = activeChart === 'volume' ? 'volumeUSD' : 'tvlUSD';
                                const label = chartConfig[activeChart]?.label || activeChart;
                                if (entry.payload && typeof entry.payload[dataKey] === 'number') {
                                  return [
                                    activeChart === 'volume' || activeChart === 'tvl' 
                                      ? formatUSD(entry.payload[dataKey]) 
                                      : entry.payload[dataKey].toLocaleString(), 
                                    label
                                  ];
                                }
                                return [value, name];
                              }}
                            />
                          }
                        />
                        <Bar dataKey={activeChart === 'volume' ? 'volumeUSD' : 'tvlUSD'} fill={chartConfig[activeChart]?.color || `var(--color-${activeChart})`} />
                      </BarChart>
                      ) : (
                        <div className="flex justify-center items-center h-full text-muted-foreground">
                          No chart data available for this pool.
                        </div>
                      )}
                    </ChartContainer>
                  </CardContent>
                </Card>
              </div>
            </div>

            {/* Right Column: Add Liquidity Form (takes up 1/4 on larger screens) */}
            <div className="w-[450px] h-[700px]" ref={addLiquidityFormRef}>
              {/* Tabs for Swap/Deposit/Withdraw - MOVED HERE */}
              <div className="flex border-b border-border mb-4 px-6 pt-6">
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
              </div>

              {poolId && currentPoolData && activeTab === 'deposit' && ( // Only render form if activeTab is 'deposit'
                <Card className="w-full shadow-none border-none"> {/* Adjusted Card styling */}
                  <CardContent className="pt-0"> {/* Adjusted padding */}
                    <AddLiquidityForm
                      selectedPoolId={poolId}
                      poolApr={currentPoolData?.apr}
                      onLiquidityAdded={() => {
                        fetchPageData();
                      }}
                      sdkMinTick={SDK_MIN_TICK}
                      sdkMaxTick={SDK_MAX_TICK}
                      defaultTickSpacing={DEFAULT_TICK_SPACING}
                      activeTab={activeTab} // Pass activeTab state down
                    />
                  </CardContent>
                </Card>
              )}
              
              {/* Placeholder content for Withdraw and Swap */}              
              {activeTab !== 'deposit' && (
                <div className="flex items-center justify-center h-full bg-muted/20 rounded-lg mx-6 mb-6">
                   <span className="text-muted-foreground capitalize">{activeTab} functionality coming soon</span>
                </div>
              )}
            </div>
          </div>
          
          {/* Your Positions Section (Full width below the columns) */}
          <div className="space-y-4 mt-8"> {/* Added mt-8 for spacing */}
            {isLoadingPositions ? (
              <div className="flex justify-center items-center h-48">
                <RefreshCwIcon className="mr-2 h-6 w-6 animate-spin" /> 
                <span>Loading your positions...</span>
              </div>
            ) : userPositions.length > 0 ? (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-medium">Your Liquidity Positions</h3>
                </div>
                <div className="text-sm mb-4">
                  Total Value: <span className="font-medium">{formatUSD(totalLiquidity)}</span>
                </div>
                {/* Replace PositionCard grid with Table */}
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      {positionsTable.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                          {headerGroup.headers.map((header) => (
                            <TableHead key={header.id}>
                              {header.isPlaceholder
                                ? null
                                : flexRender(
                                    header.column.columnDef.header,
                                    header.getContext()
                                  )}
                            </TableHead>
                          ))}
                        </TableRow>
                      ))}
                    </TableHeader>
                    <TableBody>
                      {positionsTable.getRowModel().rows?.length ? (
                        positionsTable.getRowModel().rows.map((row) => (
                          <TableRow key={row.id}>
                            {row.getVisibleCells().map((cell) => (
                              <TableCell key={cell.id}>
                                {flexRender(
                                  cell.column.columnDef.cell,
                                  cell.getContext()
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell
                            colSpan={positionColumns.length}
                            className="h-24 text-center"
                          >
                            No positions found for this pool.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
              <div className="border rounded-md p-8 text-center">
                <div className="text-muted-foreground mb-2">
                  {isConnected ? 
                    "You don't have any positions in this pool yet." : 
                    "Please connect your wallet to view your positions."
                  }
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Burn Confirmation Dialog */}
      <AlertDialog open={showBurnConfirmDialog} onOpenChange={setShowBurnConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Burn Liquidity Position</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently burn this liquidity position? This action will remove your
              liquidity and transfer the underlying tokens (and any accrued fees) to your wallet.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {positionToBurn && (
            <div className="text-sm my-4 p-3 border rounded-md bg-muted/30">
              <p><strong>Position ID:</strong> {positionToBurn.positionId}</p>
              <p><strong>Pair:</strong> {positionToBurn.token0.symbol} / {positionToBurn.token1.symbol}</p>
              <p><strong>Amount {positionToBurn.token0.symbol}:</strong> {formatTokenDisplayAmount(positionToBurn.token0.amount)}</p>
              <p><strong>Amount {positionToBurn.token1.symbol}:</strong> {formatTokenDisplayAmount(positionToBurn.token1.amount)}</p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPositionToBurn(null)} disabled={isBurningLiquidity}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmBurnPosition} 
              disabled={isBurningLiquidity}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isBurningLiquidity ? <RefreshCwIcon className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm Burn
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Increase Position Modal */}
      <Dialog open={showIncreaseModal} onOpenChange={setShowIncreaseModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Increase Liquidity Position</DialogTitle>
            <DialogDescription>
              Add more liquidity to your existing position.
            </DialogDescription>
          </DialogHeader>
          {positionToModify && (
            <div className="space-y-4">
              <div className="text-sm p-3 border rounded-md bg-muted/30">
                <p><strong>Current Position:</strong></p>
                <p>{positionToModify.token0.symbol}: {formatTokenDisplayAmount(positionToModify.token0.amount)}</p>
                <p>{positionToModify.token1.symbol}: {formatTokenDisplayAmount(positionToModify.token1.amount)}</p>
                {!positionToModify.isInRange && (
                  <p className="text-orange-600 text-xs mt-2">
                    ⚠️ Out of range: You can add only one token at a time
                  </p>
                )}
              </div>
              <div className="space-y-3">
                <div>
                  <Label htmlFor="increase-amount0">Additional {positionToModify.token0.symbol}</Label>
                  <Input
                    id="increase-amount0"
                    type="number"
                    placeholder="0.0"
                    className="mt-1"
                    value={increaseAmount0}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setIncreaseAmount0(newValue);
                      setIncreaseActiveInputSide('amount0');
                      if (newValue && parseFloat(newValue) > 0) {
                        calculateIncreaseAmount(newValue, 'amount0');
                      } else {
                        setIncreaseAmount1("");
                      }
                    }}
                    disabled={isIncreaseCalculating && increaseActiveInputSide === 'amount1'}
                  />
                  {isIncreaseCalculating && increaseActiveInputSide === 'amount0' && (
                    <div className="text-xs text-muted-foreground mt-1">Calculating...</div>
                  )}
                </div>
                <div>
                  <Label htmlFor="increase-amount1">Additional {positionToModify.token1.symbol}</Label>
                  <Input
                    id="increase-amount1"
                    type="number"
                    placeholder="0.0"
                    className="mt-1"
                    value={increaseAmount1}
                    onChange={(e) => {
                      const newValue = e.target.value;
                      setIncreaseAmount1(newValue);
                      setIncreaseActiveInputSide('amount1');
                      if (newValue && parseFloat(newValue) > 0) {
                        calculateIncreaseAmount(newValue, 'amount1');
                      } else {
                        setIncreaseAmount0("");
                      }
                    }}
                    disabled={isIncreaseCalculating && increaseActiveInputSide === 'amount0'}
                  />
                  {isIncreaseCalculating && increaseActiveInputSide === 'amount1' && (
                    <div className="text-xs text-muted-foreground mt-1">Calculating...</div>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowIncreaseModal(false)}
              disabled={isIncreasingLiquidity}
            >
              Cancel
            </Button>
            <Button 
              onClick={handleConfirmIncrease}
              disabled={
                isIncreasingLiquidity ||
                isIncreaseCalculating ||
                (positionToModify?.isInRange ? 
                  // For in-range positions, require both amounts
                  (!increaseAmount0 || !increaseAmount1 || parseFloat(increaseAmount0) <= 0 || parseFloat(increaseAmount1) <= 0) :
                  // For out-of-range positions, require at least one amount
                  ((!increaseAmount0 || parseFloat(increaseAmount0) <= 0) && (!increaseAmount1 || parseFloat(increaseAmount1) <= 0))
                )
              }
            >
              {isIncreasingLiquidity ? (
                <>
                  <RefreshCwIcon className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
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
        <DialogContent className="max-w-md">
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
                    type="number"
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
                    type="number"
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