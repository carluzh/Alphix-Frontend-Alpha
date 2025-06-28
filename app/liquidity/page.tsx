"use client";

import { AppLayout } from "@/components/app-layout";
import { useState, useEffect, useMemo, useCallback } from "react";
import { ArrowRightLeftIcon, PlusIcon, MinusIcon, ArrowLeftIcon, MoreHorizontal, ArrowUpDown, ExternalLinkIcon, RefreshCwIcon, Settings2Icon, XIcon, TrendingUpIcon, ChevronUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogDescription, 
  DialogFooter,
  DialogTrigger,
  DialogClose
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TabsList, TabsTrigger, Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import Image from "next/image";
import * as React from "react";
import { 
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  RowData
} from "@tanstack/react-table";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { MobileLiquidityList } from "@/components/MobileLiquidityList";
import { MobilePoolDetails } from "@/components/MobilePoolDetails";
import type { ProcessedPosition } from "../../pages/api/liquidity/get-positions";
import { 
    useAccount, 
    useWriteContract, 
    useSendTransaction, 
    useWaitForTransactionReceipt,
    useBalance
} from "wagmi";
import { toast } from "sonner";
import Link from "next/link";
import { getAllPools, getEnabledPools, getToken, getPoolSubgraphId, TokenSymbol, TOKEN_DEFINITIONS } from "../../lib/pools-config";
import { baseSepolia } from "../../lib/wagmiConfig";
import { ethers } from "ethers";
import { ERC20_ABI } from "../../lib/abis/erc20";
import { type Hex, formatUnits as viemFormatUnits, parseUnits, type Abi } from "viem";
import { position_manager_abi } from "../../lib/abis/PositionManager_abi";
import { getFromCache, setToCache, getUserPositionsCacheKey, getPoolStatsCacheKey, getPoolDynamicFeeCacheKey } from "../../lib/client-cache"; // Import cache functions
import { TickRangeControl } from "@/components/TickRangeControl";
import { Pool } from "../../types"; // Import Pool interface from types
import { AddLiquidityModal } from "@liquidity/AddLiquidityModal";
import { useRouter } from "next/navigation";
// import { DEFAULT_TICK_SPACING } from "@/components/TickRangeControl"; // Assuming DEFAULT_TICK_SPACING is exported or accessible

const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;
const DEFAULT_TICK_SPACING = 60; // Define it locally
const TICK_BARS_COUNT = 31; // More bars for finer visualization
const TICKS_PER_BAR = 10 * DEFAULT_TICK_SPACING; // Each bar represents 10× tickspacing

// Generate pools from pools.json configuration
const generatePoolsFromConfig = (): Pool[] => {
  const enabledPools = getEnabledPools();
  
  return enabledPools.map(poolConfig => {
    const token0 = getToken(poolConfig.currency0.symbol);
    const token1 = getToken(poolConfig.currency1.symbol);
    
    if (!token0 || !token1) {
      console.warn(`Missing token configuration for pool ${poolConfig.id}`);
      return null;
    }
    
    return {
      id: poolConfig.id,
    tokens: [
        { symbol: token0.symbol, icon: token0.icon },
        { symbol: token1.symbol, icon: token1.icon }
    ],
      pair: `${token0.symbol} / ${token1.symbol}`,
    volume24h: "Loading...",
    volume7d: "Loading...",
    fees24h: "Loading...",
    fees7d: "Loading...",
    liquidity: "Loading...",
    apr: "Loading...",
      highlighted: poolConfig.featured,
    volumeChangeDirection: 'loading',
    tvlChangeDirection: 'loading',
    } as Pool;
  }).filter(Boolean) as Pool[];
};

const dynamicPools = generatePoolsFromConfig();

declare module '@tanstack/react-table' {
  interface TableMeta<TData extends RowData> {
    explorerBaseUrl?: string;
  }
}

const chartData = Array.from({ length: 60 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - i);
  return {
    date: date.toISOString().split('T')[0],
    volume: Math.floor(Math.random() * 200000) + 100000,
    tvl: Math.floor(Math.random() * 100000) + 1000000,
  };
}).reverse();

const chartConfig = {
  views: { label: "Daily Values" },
  volume: { label: "Volume", color: "hsl(var(--chart-1))" },
  tvl: { label: "TVL", color: "hsl(var(--chart-2))" },
} satisfies ChartConfig;

// Format USD value
const formatUSD = (value: number) => {
  if (value < 0.01) return "< $0.01";
  if (value < 1000) return `$${value.toFixed(2)}`;
  return `$${(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

export default function LiquidityPage() {
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [userPositions, setUserPositions] = useState<ProcessedPosition[]>([]); // Added state for all user positions
  const [activeChart, setActiveChart] = React.useState<keyof typeof chartConfig>("volume");
  const [sorting, setSorting] = React.useState<SortingState>([]);

  const [poolsData, setPoolsData] = useState<Pool[]>(dynamicPools); // State for dynamic pool data
  const isMobile = useIsMobile();
  const { address: accountAddress, isConnected, chain } = useAccount();
  const [selectedPoolId, setSelectedPoolId] = useState<string>("");
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );
  const [addLiquidityOpen, setAddLiquidityOpen] = useState(false);
  const [selectedPoolApr, setSelectedPoolApr] = useState<string | undefined>(undefined);
  const router = useRouter();

  // Add resize listener
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
      };
    }
  }, []);

  // Fetch all user positions
  useEffect(() => {
    if (isConnected && accountAddress) {
      const cacheKey = getUserPositionsCacheKey(accountAddress);
      const cachedPositions = getFromCache<ProcessedPosition[]>(cacheKey);

      if (cachedPositions) {
        console.log("[Cache HIT] Using cached user positions for", accountAddress);
        setUserPositions(cachedPositions);
        setIsLoadingPositions(false);
        return;
      }

      console.log("[Cache MISS] Fetching user positions from API for", accountAddress);
      setIsLoadingPositions(true);
      fetch(`/api/liquidity/get-positions?ownerAddress=${accountAddress}`)
        .then(res => {
          if (!res.ok) { throw new Error(`Failed to fetch positions: ${res.statusText}`); }
          return res.json();
        })
        .then((data: ProcessedPosition[] | { message: string }) => {
          if (Array.isArray(data)) {
            setUserPositions(data);
            setToCache(cacheKey, data); // Cache the fetched positions
            console.log("[Cache SET] Cached user positions for", accountAddress);
          } else {
            console.error("Error fetching positions on main page:", data.message);
            toast.error("Could not load your positions for counts", { description: data.message });
            setUserPositions([]);
          }
        })
        .catch(error => {
          console.error("Failed to fetch user positions for counts:", error);
          toast.error("Failed to load your positions for counts.", { description: error.message });
          setUserPositions([]);
        })
        .finally(() => {
          setIsLoadingPositions(false);
        });
    } else {
      setUserPositions([]); // Clear positions if not connected
    }
  }, [isConnected, accountAddress]);

  // useEffect to fetch rolling volume and fees for each pool
  useEffect(() => {
    const fetchPoolStats = async (pool: Pool): Promise<Partial<Pool>> => {
      const apiPoolId = getPoolSubgraphId(pool.id) || pool.id;
      const statsCacheKey = getPoolStatsCacheKey(apiPoolId);
      let cachedStats = getFromCache<Partial<Pool>>(statsCacheKey);

      // If we have cached stats, we might still need to fetch/recalculate APR if it's not there or uses a separate fee cache
      // For simplicity, if basic stats are cached, we'll try to use them and then fetch fee separately if needed for APR.

      if (cachedStats && cachedStats.apr && cachedStats.volume24hUSD !== undefined && cachedStats.tvlUSD !== undefined) {
        console.log(`[Cache HIT] Using fully cached stats (incl. APR) for pool: ${pool.pair}, API ID: ${apiPoolId}`);
        return cachedStats; 
      }
      
      console.log(`[Cache MISS or APR missing] Fetching/Recomputing stats for pool: ${pool.pair}, using API ID: ${apiPoolId}`);

      let volume24hUSD: number | undefined = cachedStats?.volume24hUSD;
      let fees24hUSD: number | undefined = cachedStats?.fees24hUSD; // Assuming fees are part of this cache if available
      let volume7dUSD: number | undefined = cachedStats?.volume7dUSD;
      let fees7dUSD: number | undefined = cachedStats?.fees7dUSD;
      let tvlUSD: number | undefined = cachedStats?.tvlUSD;
      let calculatedApr = cachedStats?.apr || "Loading...";
      let volume48hUSD: number | undefined = cachedStats?.volume48hUSD; // Added for 48h volume
      let volumeChangeDirection: 'up' | 'down' | 'neutral' | 'loading' = cachedStats?.volumeChangeDirection || 'loading'; // Added for volume change
      let tvlYesterdayUSD: number = cachedStats?.tvlYesterdayUSD ?? 0; // Added for TVL from yesterday, initialized to 0
      let tvlChangeDirection: 'up' | 'down' | 'neutral' | 'loading' = cachedStats?.tvlChangeDirection || 'loading'; // Added for TVL change

      try {
        // Fetch data only if we don't have all the required data cached or if a direction is still loading
        if (volume24hUSD === undefined || tvlUSD === undefined || fees24hUSD === undefined || volume48hUSD === undefined || tvlYesterdayUSD === undefined || volumeChangeDirection === 'loading' || tvlChangeDirection === 'loading') { // Added checks for loading states
          console.log(`Fetching core stats (vol/tvl/fees), 48h volume, and chart data for ${apiPoolId}`);
          const [res24h, res7d, resTvl, res48h, resChartData] = await Promise.all([
            fetch(`/api/liquidity/get-rolling-volume-fees?poolId=${apiPoolId}&days=1`),
            fetch(`/api/liquidity/get-rolling-volume-fees?poolId=${apiPoolId}&days=7`),
            fetch(`/api/liquidity/get-pool-tvl?poolId=${apiPoolId}`),
            fetch(`/api/liquidity/get-rolling-volume-fees?poolId=${apiPoolId}&days=2`), // Fetch 48h volume
            fetch(`/api/liquidity/chart-data/${apiPoolId}?numDays=2`), // Fetch last 2 days of chart data for TVL comparison
          ]);

          if (!res24h.ok || !res7d.ok || !resTvl.ok || !res48h.ok || !resChartData.ok) { // Added resChartData.ok
            console.error(`Failed to fetch some core stats, 48h volume, or chart data for ${apiPoolId}.`);
            // On fetch failure, set change directions to neutral
            volumeChangeDirection = 'neutral';
            tvlChangeDirection = 'neutral';
            // Don't return here, allow partial updates if some data was cached
          } else {
            const data24h = await res24h.json();
            const data7d = await res7d.json();
            const dataTvl = await resTvl.json();
            const data48h = await res48h.json(); // Process 48h data
            const chartData = await resChartData.json(); // Process chart data

            console.log(`[LiquidityPage] Raw TVL data for ${apiPoolId}:`, dataTvl);
            console.log(`[LiquidityPage] Raw chart data for ${apiPoolId}:`, chartData);

            volume24hUSD = parseFloat(data24h.volumeUSD);
            fees24hUSD = parseFloat(data24h.feesUSD);
            volume7dUSD = parseFloat(data7d.volumeUSD);
            fees7dUSD = parseFloat(data7d.feesUSD);
            tvlUSD = parseFloat(dataTvl.tvlUSD);
            volume48hUSD = parseFloat(data48h.volumeUSD); // Store 48h volume

            // Calculate volume change direction if both 24h and 48h volumes are available and valid
            if (volume24hUSD !== undefined && volume48hUSD !== undefined && !isNaN(volume24hUSD) && !isNaN(volume48hUSD)) { // Added isNaN checks
                const volumePrevious24h = volume48hUSD - volume24hUSD; // Volume from 24h to 48h ago
                if (volume24hUSD > volumePrevious24h) {
                    volumeChangeDirection = 'up';
                } else if (volume24hUSD < volumePrevious24h) {
                    volumeChangeDirection = 'down';
                } else {
                    volumeChangeDirection = 'neutral';
                }
            } else {
                 volumeChangeDirection = 'neutral'; // Cannot determine change
            }

            // Calculate TVL change direction if current TVL and yesterday's TVL are available and valid
            if (tvlUSD !== undefined && chartData && chartData.length >= 2 && !isNaN(tvlUSD)) { // Added isNaN check for tvlUSD
                // Find yesterday's data more robustly
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                const yesterdayDateString = yesterday.toISOString().split('T')[0];

                const yesterdayData = chartData.find((d: { date: string, tvlUSD: number }) => d.date === yesterdayDateString && typeof d.tvlUSD === 'number');

                if (yesterdayData && typeof yesterdayData.tvlUSD === 'number') {
                    // Now that we found yesterdayData with valid tvlUSD, assign it
                    tvlYesterdayUSD = yesterdayData.tvlUSD;
                    // Perform comparison using the guaranteed number type
                    if (tvlUSD > tvlYesterdayUSD) {
                        tvlChangeDirection = 'up';
                    } else if (tvlUSD < tvlYesterdayUSD) {
                        tvlChangeDirection = 'down';
                    } else {
                        tvlChangeDirection = 'neutral';
                    }
                } else {
                    // If yesterday's data isn't found, or its tvlUSD is invalid
                    tvlChangeDirection = 'neutral'; // Assume neutral if no reliable historical data for comparison
                }
            } else if (tvlUSD !== undefined && !isNaN(tvlUSD)) { // If we have current TVL but not enough historical data (less than 2 days)
                tvlChangeDirection = 'neutral'; // Assume neutral if not enough data
            } else {
                // If current TVL is not available or is invalid
                tvlChangeDirection = 'neutral'; // Cannot determine change without current TVL
            }
          }
        }

        // Fetch dynamic fee for APR calculation
        const [token0SymbolStr, token1SymbolStr] = pool.pair.split(' / ');
        const fromTokenSymbolForFee = TOKEN_DEFINITIONS[token0SymbolStr?.trim() as TokenSymbol]?.symbol;
        const toTokenSymbolForFee = TOKEN_DEFINITIONS[token1SymbolStr?.trim() as TokenSymbol]?.symbol;

        let dynamicFeeBps: number | null = null;
        if (fromTokenSymbolForFee && toTokenSymbolForFee && baseSepolia.id) {
          const feeCacheKey = getPoolDynamicFeeCacheKey(fromTokenSymbolForFee, toTokenSymbolForFee, baseSepolia.id);
          const cachedFee = getFromCache<{ dynamicFee: string }>(feeCacheKey);

          if (cachedFee) {
            console.log(`[Cache HIT] Using cached dynamic fee for APR calc (${pool.pair}):`, cachedFee.dynamicFee);
            dynamicFeeBps = Number(cachedFee.dynamicFee);
          } else {
            console.log(`[Cache MISS] Fetching dynamic fee from API for APR calc (${pool.pair})`);
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
                 console.log(`[Cache SET] Cached dynamic fee for APR calc (${pool.pair}):`, feeData.dynamicFee);
              } else {
                dynamicFeeBps = null; // Invalid fee from API
              }
            } else {
              console.error(`Failed to fetch dynamic fee for APR calc (${pool.pair}):`, await feeResponse.text());
            }
          }
        }

        // Calculate APR if all parts are available
        if (volume24hUSD !== undefined && dynamicFeeBps !== null && tvlUSD !== undefined && tvlUSD > 0) {
          const feeRate = dynamicFeeBps / 10000 / 100;
          const dailyFees = volume24hUSD * feeRate;
          const yearlyFees = dailyFees * 365;
          const apr = (yearlyFees / tvlUSD) * 100;
          calculatedApr = apr.toFixed(2) + '%';
          console.log(`Calculated APR for ${pool.pair}: ${calculatedApr} (Vol24h: ${volume24hUSD}, FeeBPS: ${dynamicFeeBps}, TVL: ${tvlUSD})`);
        } else {
          console.warn(`Could not calculate APR for ${pool.pair} due to missing data. Vol: ${volume24hUSD}, Fee: ${dynamicFeeBps}, TVL: ${tvlUSD}`);
          calculatedApr = "N/A"; // Set to N/A if calculation not possible
        }
        
        const completeFetchedStats: Partial<Pool> = {
          volume24hUSD,
          fees24hUSD,
          volume7dUSD,
          fees7dUSD,
          tvlUSD,
          apr: calculatedApr,
          volume48hUSD, // Include 48h volume in cached stats
          volumeChangeDirection, // Include volume change direction
          tvlYesterdayUSD, // Include yesterday's TVL in cached stats
          tvlChangeDirection, // Include TVL change direction
        };
        // Cache the combined stats including the newly calculated APR and volume change
        setToCache(statsCacheKey, completeFetchedStats);
        console.log(`[Cache SET] Cached combined stats for pool: ${pool.pair}, API ID: ${apiPoolId}`);
        return completeFetchedStats;

      } catch (error: any) { // Catch any errors during the fetch or processing
        console.error(`Error fetching or processing stats for ${pool.pair}:`, error);
        // Keep existing cached data if available, otherwise set to undefined/neutral
        const errorStats: Partial<Pool> = {
            volume24hUSD: cachedStats?.volume24hUSD,
            fees24hUSD: cachedStats?.fees24hUSD,
            volume7dUSD: cachedStats?.volume7dUSD,
            fees7dUSD: cachedStats?.fees7dUSD,
            tvlUSD: cachedStats?.tvlUSD,
            apr: cachedStats?.apr || "N/A", // Keep cached APR or set to N/A
            volume48hUSD: cachedStats?.volume48hUSD,
            volumeChangeDirection: cachedStats?.volumeChangeDirection || 'neutral',
            tvlYesterdayUSD: cachedStats?.tvlYesterdayUSD,
            tvlChangeDirection: cachedStats?.tvlChangeDirection || 'neutral'
        };
         return errorStats; // Return the partial stats with neutral/cached values on error
      }
    };

    const updateAllPoolStats = async () => {
      console.log("Starting to fetch/update stats for all pools...");
      const updatedPoolsPromises = poolsData.map(pool => 
        fetchPoolStats(pool).then(stats => ({ ...pool, ...stats }))
      );
      const updatedPools = await Promise.all(updatedPoolsPromises);
      console.log("Fetched stats, updating poolsData state:", updatedPools);
      setPoolsData(updatedPools);
    };

    if (poolsData.length > 0) { // Only run if there are pools to update
        updateAllPoolStats(); // Initial fetch
    }

    // Set up interval for periodic updates
    const intervalId = setInterval(() => {
      console.log("[LiquidityPage] Interval: Refreshing pool stats...");
      updateAllPoolStats();
    }, 60000); // Refresh every 60 seconds

    // Cleanup interval on component unmount
    return () => {
      clearInterval(intervalId);
    };
  }, []); // Run once on component mount to set up initial fetch and interval

  // Calculate pools with their position counts
  const poolsWithPositionCounts = useMemo(() => {
    return poolsData.map(pool => { // Use poolsData state here
      const [poolToken0Raw, poolToken1Raw] = pool.pair.split(' / ');
      const poolToken0 = poolToken0Raw?.trim().toUpperCase();
      const poolToken1 = poolToken1Raw?.trim().toUpperCase();
      
      const count = userPositions.filter(pos => {
        const posToken0 = pos.token0.symbol?.trim().toUpperCase();
        const posToken1 = pos.token1.symbol?.trim().toUpperCase();
        return (posToken0 === poolToken0 && posToken1 === poolToken1) ||
               (posToken0 === poolToken1 && posToken1 === poolToken0);
      }).length;
      
      return { ...pool, positionsCount: count };
    });
  }, [poolsData, userPositions]); // Depend on poolsData and userPositions

  // Calculate totals for stats
  const totals = React.useMemo(() => ({
    volume: chartData.reduce((acc, curr) => acc + curr.volume, 0),
    tvl: chartData.reduce((acc, curr) => acc + curr.tvl, 0),
  }), []);

  // Define the columns for the table
  const columns: ColumnDef<Pool>[] = [
    {
      accessorKey: "pair",
      header: "Pool",
      cell: ({ row }) => {
        const pool = row.original;
        return (
          <div className="flex items-center gap-2">
            <div className="relative w-14 h-7">
              <div className="absolute top-0 left-0 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
                <Image
                  src={pool.tokens[0].icon}
                  alt={pool.tokens[0].symbol}
                  width={28}
                  height={28}
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="absolute top-0 left-4 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
                <Image
                  src={pool.tokens[1].icon}
                  alt={pool.tokens[1].symbol}
                  width={28}
                  height={28}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
            <div className="flex flex-col">
              <span className="font-medium">{pool.pair}</span>
              <div className="text-xs h-4 text-muted-foreground flex items-center">
                {isLoadingPositions ? (
                  <div className="h-3 w-16 bg-muted/60 rounded loading-skeleton"></div>
                ) : pool.positionsCount !== undefined && pool.positionsCount > 0 ? (
                    <span>
                      {pool.positionsCount} {pool.positionsCount === 1 ? 'position' : 'positions'}
                    </span>
                  ) : (
                    <span className="invisible">0 positions</span>
                  )
                }
              </div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "volume24h",
      header: () => <div className="text-right w-full">Volume (24h)</div>,
      cell: ({ row }) => (
        <div className="text-right flex items-center justify-end gap-1">
          {typeof row.original.volume24hUSD === 'number' ? (
            <>
              {formatUSD(row.original.volume24hUSD)}
              {/* Conditionally render arrow based on volumeChangeDirection */}
              {row.original.volumeChangeDirection === 'up' && (
                <Image
                  src="/arrow_up.svg"
                  alt="Volume Increase Icon"
                  width={8}
                  height={8}
                  className="text-green-500"
                />
              )}
              {row.original.volumeChangeDirection === 'down' && (
                <Image
                  src="/arrow_down.svg"
                  alt="Volume Decrease Icon"
                  width={8}
                  height={8}
                  className="text-red-500"
                />
              )}
              {/* Neutral or loading state can render nothing or a placeholder */}
               {row.original.volumeChangeDirection === 'loading' && (
                 <div className="inline-block h-3 w-3 bg-muted/60 rounded-full loading-skeleton"></div> // Optional loading indicator
              )}
            </>
          ) : (
            <div className="inline-block h-4 w-16 bg-muted/60 rounded loading-skeleton"></div>
          )}
        </div>
      ),
      meta: {
        hideOnMobile: true,
        hidePriority: 3,
      }
    },
    {
      accessorKey: "volume7d",
      header: () => <div className="text-right w-full">Volume (7d)</div>,
      cell: ({ row }) => (
        <div className="text-right flex items-center justify-end">
          {typeof row.original.volume7dUSD === 'number' ? (
            formatUSD(row.original.volume7dUSD)
          ) : (
            <div className="inline-block h-4 w-16 bg-muted/60 rounded loading-skeleton"></div>
          )}
        </div>
      ),
      meta: {
        hideOnMobile: true,
        hidePriority: 2,
      }
    },
    {
      accessorKey: "fees24h",
      header: () => <div className="text-right w-full">Fees (24h)</div>,
      cell: ({ row }) => (
         <div className="text-right flex items-center justify-end">
          {typeof row.original.fees24hUSD === 'number' ? (
            formatUSD(row.original.fees24hUSD)
          ) : (
            <div className="inline-block h-4 w-12 bg-muted/60 rounded loading-skeleton"></div>
          )}
        </div>
      ),
      meta: {
        hideOnMobile: true,
        hidePriority: 2,
      }
    },
    {
      accessorKey: "fees7d",
      header: () => <div className="text-right w-full">Fees (7d)</div>,
      cell: ({ row }) => (
        <div className="text-right flex items-center justify-end">
          {typeof row.original.fees7dUSD === 'number' ? (
            formatUSD(row.original.fees7dUSD)
          ) : (
            <div className="inline-block h-4 w-12 bg-muted/60 rounded loading-skeleton"></div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "liquidity",
      header: () => <div className="text-right w-full">Liquidity</div>,
      cell: ({ row }) => (
         <div className="text-right flex items-center justify-end gap-1">
          {typeof row.original.tvlUSD === 'number' ? (
            <>
              {formatUSD(row.original.tvlUSD)}
              {/* Conditionally render arrow based on tvlChangeDirection */}
              {(row.original.tvlChangeDirection === 'up' || row.original.tvlChangeDirection === 'neutral') && (
                <Image
                  src="/arrow_up.svg"
                  alt="Liquidity Increase Icon"
                  width={8}
                  height={8}
                  className="text-green-500"
                />
              )}
              {row.original.tvlChangeDirection === 'down' && (
                <Image
                  src="/arrow_down.svg"
                  alt="Liquidity Decrease Icon"
                  width={8}
                  height={8}
                  className="text-red-500"
                />
              )}
               {/* Loading state */}
               {row.original.tvlChangeDirection === 'loading' && (
                 <div className="inline-block h-3 w-3 bg-muted/60 rounded-full loading-skeleton"></div> // Optional loading indicator
              )}
            </>
          ) : (
            <div className="inline-block h-4 w-20 bg-muted/60 rounded loading-skeleton"></div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "apr",
      header: () => <div className="text-right w-full flex items-center justify-end">Yield</div>,
      cell: ({ row }) => {
        const isAprCalculated = row.original.apr !== undefined && row.original.apr !== "Loading..." && row.original.apr !== "N/A";
        const formattedAPR = isAprCalculated ? parseFloat(row.original.apr.replace('%', '')).toFixed(2) + '%' : undefined;

        // COMMENTED OUT: Hover Add Liquidity button functionality - preserved for future use
        // const initialWidthClass = 'w-16';
        // const initialHeightClass = 'h-6';

        return (
          <div className="text-right flex items-center justify-end">
            {isAprCalculated ? (
              <div className="flex items-center justify-center w-16 h-6 rounded-md bg-green-500/20 text-green-500">
                {formattedAPR}
              </div>
            ) : (
              <div className="inline-block h-4 w-16 bg-muted/60 rounded loading-skeleton"></div>
            )}
          </div>

          // COMMENTED OUT: Hover Add Liquidity functionality - preserved for future use
          // <div 
          //   onClick={(e) => handleAddLiquidity(e, row.original.id)}
          //   className={`relative flex items-center ${initialWidthClass} ${initialHeightClass} rounded-md ${isAprCalculated ? 'bg-green-500/20 text-green-500' : 'bg-muted/60'} overflow-hidden ml-auto
          //               group-hover:w-32 group-hover:h-8
          //               group-hover:bg-transparent group-hover:text-foreground group-hover:border group-hover:border-border
          //               group-hover:hover:bg-accent group-hover:hover:text-accent-foreground
          //               transition-all duration-300 ease-in-out cursor-pointer`}
          // >
          //   {isAprCalculated ? (
          //     <>
          //        <span className="absolute inset-0 flex items-center justify-center opacity-100 group-hover:opacity-0 transition-opacity duration-300 ease-in-out">
          //         {formattedAPR}
          //       </span>
          //       <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-in-out px-2 whitespace-nowrap">
          //           <PlusIcon className="w-4 h-4 mr-2" />
          //           Add Liquidity
          //       </div>
          //     </>
          //   ) : (
          //    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 ease-in-out px-2 whitespace-nowrap">
          //        <PlusIcon className="w-4 h-4 mr-2" />
          //        Add Liquidity
          //    </div>
          //   )}
          // </div>
        );
      },
    },
  ];

  // Filter columns based on screen size and priority
  const visibleColumns = useMemo(() => {
    if (isMobile) {
       return columns;
    }
    
    if (windowWidth < 900) { 
       return columns.filter(column => (column.meta as any)?.hidePriority === undefined || 
                                       (column.meta as any)?.hidePriority > 3);
    } else if (windowWidth < 1100) { 
       return columns.filter(column => (column.meta as any)?.hidePriority === undefined || 
                                       (column.meta as any)?.hidePriority > 2);
    } else if (windowWidth < 1280) { 
       return columns.filter(column => (column.meta as any)?.hidePriority === undefined || 
                                       (column.meta as any)?.hidePriority > 1);
    }
    
    return columns;
  }, [columns, isMobile, windowWidth]);
  
  // Initialize the table with filtered columns
  const table = useReactTable({
    data: poolsWithPositionCounts,
    columns: visibleColumns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    state: {
      sorting,
    },
  });

  const handleAddLiquidity = (e: React.MouseEvent, poolId: string) => {
    e.stopPropagation(); // Prevent row click if APR cell itself is handling it
    setSelectedPoolId(poolId); 
    const pool = poolsWithPositionCounts.find(p => p.id === poolId);
    setSelectedPoolApr(pool?.apr); // Store the APR for the selected pool
    setAddLiquidityOpen(true);
  };

  const handlePoolClick = (poolId: string) => {
    router.push(`/liquidity/${poolId}`);
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col p-6 px-10">
          <div className="mb-6 mt-6">
            {!isMobile && (
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-xl font-semibold">Liquidity Pools</h2>
                  <p className="text-sm text-muted-foreground">
                    Explore and manage your liquidity positions.
                  </p>
                </div>
              </div>
            )}
            
            {isMobile ? (
              <MobileLiquidityList 
                pools={poolsWithPositionCounts}
                onSelectPool={handlePoolClick}
              />
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <TableHead 
                            key={header.id} 
                            className={`${header.column.id !== 'pair' ? 'text-right' : ''}`}>
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
                    {table.getRowModel().rows?.length ? (
                      table.getRowModel().rows.map((row) => (
                        <TableRow
                          key={row.id}
                          className={`group cursor-pointer transition-colors ${
                            row.original.highlighted ? 'bg-accent/10 hover:bg-accent/15' : 'hover:bg-muted/10'
                          }`}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <TableCell 
                              key={cell.id} 
                              onClick={() => handlePoolClick(row.original.id)}
                              className={`${cell.column.id !== 'pair' ? 'text-right' : ''} relative`}
                            >
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
                          colSpan={columns.length}
                          className="h-24 text-center"
                        >
                          No pools available.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </div>
      {/* Add Liquidity Modal */}
      <AddLiquidityModal
        isOpen={addLiquidityOpen}
        onOpenChange={setAddLiquidityOpen}
        selectedPoolId={selectedPoolId}
        poolApr={selectedPoolApr}
        onLiquidityAdded={() => {
          // Fetch all user positions again after adding liquidity
          if (isConnected && accountAddress) {
            fetch(`/api/liquidity/get-positions?ownerAddress=${accountAddress}`)
              .then(res => res.json())
              .then((data: ProcessedPosition[] | { message: string }) => {
                if (Array.isArray(data)) {
                  setUserPositions(data);
                }
              })
              .catch(error => {
                console.error("Failed to refresh positions:", error);
              });
          }
        }}
        sdkMinTick={SDK_MIN_TICK}
        sdkMaxTick={SDK_MAX_TICK}
        defaultTickSpacing={DEFAULT_TICK_SPACING}
      />
    </AppLayout>
  );
} 