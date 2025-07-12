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
    const fetchAllPoolStatsBatch = async () => {
      console.log("[LiquidityPage] Starting batch fetch for all pools...");
      
      try {
        // Check if we have cached data for all pools first
        const poolsWithCache = poolsData.map(pool => {
          const apiPoolId = getPoolSubgraphId(pool.id) || pool.id;
          const statsCacheKey = getPoolStatsCacheKey(apiPoolId);
          const cachedStats = getFromCache<Partial<Pool>>(statsCacheKey);
          
          return {
            pool,
            apiPoolId,
            cachedStats,
            needsFetch: !cachedStats || !cachedStats.apr || cachedStats.volume24hUSD === undefined || cachedStats.tvlUSD === undefined
          };
        });

        const poolsNeedingFetch = poolsWithCache.filter(p => p.needsFetch);
        
        if (poolsNeedingFetch.length === 0) {
          console.log("[LiquidityPage] All pools have cached data, using cache");
          const updatedPools = poolsWithCache.map(p => ({ ...p.pool, ...p.cachedStats }));
          setPoolsData(updatedPools);
          return;
        }

        console.log(`[LiquidityPage] Need to fetch ${poolsNeedingFetch.length}/${poolsData.length} pools`);

        // Use the batch API for better performance
        const response = await fetch('/api/liquidity/get-pools-batch');
        
        if (!response.ok) {
          throw new Error(`Batch API failed: ${response.status}`);
        }

        const batchData = await response.json();
        
        if (!batchData.success) {
          throw new Error(`Batch API error: ${batchData.message}`);
        }

        console.log(`[LiquidityPage] Batch API returned data for ${batchData.pools.length} pools`);

        // Process batch data and update pools
        const updatedPools = poolsData.map(pool => {
          const apiPoolId = getPoolSubgraphId(pool.id) || pool.id;
          const batchPoolData = batchData.pools.find((p: any) => p.poolId.toLowerCase() === apiPoolId.toLowerCase());
          
          if (batchPoolData) {
            // Calculate APR using actual dynamic fees from subgraph
            let calculatedApr = "Loading...";
            
            if (typeof batchPoolData.fees24hUSD === 'number' && batchPoolData.tvlUSD > 0) {
              // Use actual fees calculated from dynamic subgraph data
              const yearlyFees = batchPoolData.fees24hUSD * 365;
              const apr = (yearlyFees / batchPoolData.tvlUSD) * 100;
              calculatedApr = apr.toFixed(2) + '%';
            } else {
              calculatedApr = "N/A";
            }

            const updatedStats = {
              volume24hUSD: batchPoolData.volume24hUSD,
              fees24hUSD: batchPoolData.fees24hUSD, // Now available in enhanced batch API
              volume7dUSD: batchPoolData.volume7dUSD, // Now available in enhanced batch API
              fees7dUSD: batchPoolData.fees7dUSD, // Now available in enhanced batch API
              tvlUSD: batchPoolData.tvlUSD,
              volume48hUSD: batchPoolData.volume48hUSD,
              volumeChangeDirection: batchPoolData.volumeChangeDirection,
              tvlYesterdayUSD: 0, // Not available in simplified batch
              tvlChangeDirection: 'neutral' as const, // Not available in simplified batch
              apr: calculatedApr,
            };

            // Cache the results
            const statsCacheKey = getPoolStatsCacheKey(apiPoolId);
            setToCache(statsCacheKey, updatedStats);
            console.log(`[Cache SET] Cached batch stats for pool: ${pool.pair}`);

            return { ...pool, ...updatedStats };
          } else {
            // Use cached data if available, otherwise return pool with loading states
            const statsCacheKey = getPoolStatsCacheKey(apiPoolId);
            const cachedStats = getFromCache<Partial<Pool>>(statsCacheKey);
            
            if (cachedStats) {
              return { ...pool, ...cachedStats };
            } else {
              return {
                ...pool,
                volume24hUSD: undefined,
                fees24hUSD: undefined,
                volume7dUSD: undefined,
                fees7dUSD: undefined,
                tvlUSD: undefined,
                volume48hUSD: undefined,
                volumeChangeDirection: 'loading' as const,
                tvlYesterdayUSD: 0,
                tvlChangeDirection: 'loading' as const,
                apr: "Loading...",
              };
            }
          }
        });

        console.log("[LiquidityPage] Updated pools with batch data:", updatedPools);
        setPoolsData(updatedPools);

      } catch (error) {
        console.error("[LiquidityPage] Error in batch fetch:", error);
        
        // Fallback to cached data for all pools
        const fallbackPools = poolsData.map(pool => {
          const apiPoolId = getPoolSubgraphId(pool.id) || pool.id;
          const statsCacheKey = getPoolStatsCacheKey(apiPoolId);
          const cachedStats = getFromCache<Partial<Pool>>(statsCacheKey);
          
          if (cachedStats) {
            return { ...pool, ...cachedStats };
          } else {
            return {
              ...pool,
              volume24hUSD: undefined,
              fees24hUSD: undefined,
              volume7dUSD: undefined,
              fees7dUSD: undefined,
              tvlUSD: undefined,
              volume48hUSD: undefined,
              volumeChangeDirection: 'neutral' as const,
              tvlYesterdayUSD: 0,
              tvlChangeDirection: 'neutral' as const,
              apr: "N/A",
            };
          }
        });
        
        setPoolsData(fallbackPools);
      }
    };

    if (poolsData.length > 0) {
      fetchAllPoolStatsBatch(); // Initial fetch
    }

    // Set up interval for periodic updates
    const intervalId = setInterval(() => {
      console.log("[LiquidityPage] Interval: Refreshing pool stats with batch API...");
      fetchAllPoolStatsBatch();
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