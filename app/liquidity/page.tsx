"use client";

import { AppLayout } from "@/components/app-layout";
import { formatUSD as formatUSDShared } from "@/lib/format";
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Image from "next/image";

import * as React from "react";
import { 
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
  RowData,
  ColumnSizingState
} from "@tanstack/react-table";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { MobileLiquidityList } from "@/components/MobileLiquidityList";
import type { ProcessedPosition } from "../../pages/api/liquidity/get-positions";
import { 
    useAccount, 
} from "wagmi";
import { toast } from "sonner";
import { getEnabledPools, getToken, getPoolSubgraphId, getPoolById } from "../../lib/pools-config";
import { getFromCache, getFromCacheWithTtl, setToCache, getUserPositionsCacheKey, getPoolStatsCacheKey, loadUserPositionIds, derivePositionsFromIds, getPoolFeeBps } from "../../lib/client-cache";
import { getCachedBatchData, setCachedBatchData, clearBatchDataCache } from "../../lib/cache-version";
import { Pool } from "../../types";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronUpIcon, ChevronDownIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { TOKEN_DEFINITIONS, type TokenSymbol } from "@/lib/pools-config";
import { useIncreaseLiquidity, type IncreasePositionData } from "@/components/liquidity/useIncreaseLiquidity";
import { useDecreaseLiquidity, type DecreasePositionData } from "@/components/liquidity/useDecreaseLiquidity";
import { toast as sonnerToast } from "sonner";
import { publicClient } from "@/lib/viemClient";
import { waitForSubgraphBlock } from "../../lib/client-cache";


const SDK_MIN_TICK = -887272;
const SDK_MAX_TICK = 887272;
const DEFAULT_TICK_SPACING = 60;

const generatePoolsFromConfig = (): Pool[] => {
  const enabledPools = getEnabledPools();
  
  return enabledPools.map(poolConfig => {
    const token0 = getToken(poolConfig.currency0.symbol);
    const token1 = getToken(poolConfig.currency1.symbol);
    
    if (!token0 || !token1) {
      console.warn(`Missing token configuration for pool ${poolConfig.id}`);
      return null;
    }
    
    // Debugging: Log the poolConfig to see if 'type' is present
    console.log(`[generatePoolsFromConfig] Processing pool: ${poolConfig.id}, Type: ${poolConfig.type}`);

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
      type: poolConfig.type, // Include the type from poolConfig
    } as Pool;
  }).filter(Boolean) as Pool[];
};

const dynamicPools = generatePoolsFromConfig();

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    hidePriority?: number;
  }
}

const formatUSD = (value: number) => {
  if (!isFinite(value)) return "$0.00";
  if (value >= 1_000_000) return formatUSDShared(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatAPR = (aprValue: number) => {
  if (!isFinite(aprValue)) return '—';
  if (aprValue < 1000) return `${aprValue.toFixed(2)}%`;
  // large APRs: compact to K with two decimals
  return `${(aprValue / 1000).toFixed(2)}K%`;
};

export default function LiquidityPage() {
  const [userPositions, setUserPositions] = useState<ProcessedPosition[]>([]);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [poolsData, setPoolsData] = useState<Pool[]>(dynamicPools);
  const isMobile = useIsMobile();
  const { address: accountAddress, isConnected } = useAccount();
  const [selectedPoolId, setSelectedPoolId] = useState<string>("");
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );
  const router = useRouter();
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  // Removed expanded row behavior
  const [poolDataByPoolId, setPoolDataByPoolId] = useState<Record<string, any>>({});
  const [priceMap, setPriceMap] = useState<Record<string, number>>({});
  const [isLoadingPoolStates, setIsLoadingPoolStates] = useState(true);

  const fetchAllPoolStatsBatch = useCallback(async () => {
      try {
        // Honor explicit invalidation flag and drop any client-side cache
        try {
          if (localStorage.getItem('cache:pools-batch:invalidated') === 'true') {
            localStorage.removeItem('cache:pools-batch:invalidated');
            clearBatchDataCache();
          }
        } catch {}

        // Always use the versioned server cache like poolId page
        console.log('[LiquidityPage] Fetching versioned batch...');
        const versionResponse = await fetch('/api/cache-version', { cache: 'no-store' as any } as any);
        const versionData = await versionResponse.json();
        // If we have a server-bumped version stored locally from a previous mutation, prefer it
        try {
          const hinted = localStorage.getItem('pools-cache-version');
          if (hinted && /^\d+$/.test(hinted)) {
            versionData.cacheUrl = `/api/liquidity/get-pools-batch?v=${hinted}`;
            console.log('[LiquidityPage] Using hinted version', hinted);
          }
        } catch {}
        const response = await fetch(versionData.cacheUrl, { cache: 'no-store' as any } as any);
        console.log('[LiquidityPage] Batch URL', versionData.cacheUrl, 'status', response.status);
        if (!response.ok) throw new Error(`Batch API failed: ${response.status}`);
        const batchData = await response.json();
        if (!batchData.success) throw new Error(`Batch API error: ${batchData.message}`);

        // Optional warm client cache for next visit; clear version hint to avoid forced bypass
        try {
          setCachedBatchData(batchData);
          localStorage.removeItem('pools-cache-version');
        } catch {}

        const updatedPools = await Promise.all(dynamicPools.map(async (pool) => {
          const apiPoolId = getPoolSubgraphId(pool.id) || pool.id;
          const batchPoolData = batchData.pools.find((p: any) => p.poolId.toLowerCase() === apiPoolId.toLowerCase());
          if (batchPoolData) {
            const tvlUSD = typeof batchPoolData.tvlUSD === 'number' ? batchPoolData.tvlUSD : undefined;
            const tvlYesterdayUSD = typeof batchPoolData.tvlYesterdayUSD === 'number' ? batchPoolData.tvlYesterdayUSD : undefined;
            const volume24hUSD = typeof batchPoolData.volume24hUSD === 'number' ? batchPoolData.volume24hUSD : undefined;
            const volumePrev24hUSD = typeof batchPoolData.volumePrev24hUSD === 'number' ? batchPoolData.volumePrev24hUSD : undefined;
            let fees24hUSD: number | undefined = undefined;
            let aprStr: string = 'N/A';
            
            if (typeof volume24hUSD === 'number') {
              try {
                const bps = await getPoolFeeBps(apiPoolId);
                const feeRate = Math.max(0, bps) / 10_000;
                fees24hUSD = volume24hUSD * feeRate;
              } catch {}
            }
            if (typeof fees24hUSD === 'number' && typeof tvlUSD === 'number' && tvlUSD > 0) {
              const apr = (fees24hUSD * 365 / tvlUSD) * 100;
              aprStr = `${apr.toFixed(2)}%`;
            }
            return { 
              ...pool, 
              tvlUSD, 
              tvlYesterdayUSD, 
              volume24hUSD, 
              volumePrev24hUSD, 
              fees24hUSD, 
              apr: aprStr,
              volumeChangeDirection: (volume24hUSD !== undefined && volumePrev24hUSD !== undefined) ? 
                (volume24hUSD > volumePrev24hUSD ? 'up' : volume24hUSD < volumePrev24hUSD ? 'down' : 'neutral') : 'loading',
              tvlChangeDirection: (tvlUSD !== undefined && tvlYesterdayUSD !== undefined) ? 
                (tvlUSD > tvlYesterdayUSD ? 'up' : tvlUSD < tvlYesterdayUSD ? 'down' : 'neutral') : 'loading',
            };
          }
          return pool;
        }));

        setPoolsData(updatedPools as Pool[]);
        console.log('[LiquidityPage] Batch fetch successful. Pools:', updatedPools.length);

      } catch (error) {
        console.error("[LiquidityPage] Batch fetch failed:", error);
        toast.error("Could not load pool data", { description: "Failed to fetch data from the server." });
      }
    }, [dynamicPools]);

  useEffect(() => {
    fetchAllPoolStatsBatch();
  }, [fetchAllPoolStatsBatch]);

  // No periodic listeners: rely on version hints and one-shot refresh

  const determineBaseTokenForPriceDisplay = useCallback((token0: string, token1: string): string => {
    if (!token0 || !token1) return token0;
    const quotePriority: Record<string, number> = {
      'aUSDC': 10, 'aUSDT': 9, 'USDC': 8, 'USDT': 7, 'aETH': 6, 'ETH': 5, 'YUSD': 4, 'mUSDT': 3,
    };
    const token0Priority = quotePriority[token0] || 0;
    const token1Priority = quotePriority[token1] || 0;
    return token1Priority > token0Priority ? token1 : token0;
  }, []);

  const convertTickToPrice = useCallback((tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string): string => {
    if (tick === SDK_MAX_TICK) return '∞';
    if (tick === SDK_MIN_TICK) return '0.00';
    if (currentPoolTick === null || !currentPrice) return 'N/A';
    const currentPriceNum = parseFloat(currentPrice);
    if (isNaN(currentPriceNum) || currentPriceNum <= 0) return 'N/A';
    let priceAtTick: number;
    const priceDelta = Math.pow(1.0001, tick - currentPoolTick);
    if (baseTokenForPriceDisplay === token0Symbol) {
      priceAtTick = 1 / (currentPriceNum * priceDelta);
    } else {
      priceAtTick = currentPriceNum * priceDelta;
    }
    if (!isFinite(priceAtTick) || isNaN(priceAtTick)) return 'N/A';
    if (priceAtTick < 1e-11 && priceAtTick > 0) return '0';
    if (priceAtTick > 1e30) return '∞';
    const displayDecimals = (baseTokenForPriceDisplay === token0Symbol
      ? (TOKEN_DEFINITIONS[token0Symbol as TokenSymbol]?.displayDecimals ?? 4)
      : (TOKEN_DEFINITIONS[token1Symbol as TokenSymbol]?.displayDecimals ?? 4));
    return priceAtTick.toFixed(displayDecimals);
  }, []);

  const formatTokenDisplayAmount = (amount: string) => {
    const num = parseFloat(amount);
    if (isNaN(num)) return amount;
    if (num === 0) return "0.00";
    if (num > 0 && num < 0.0001) return "< 0.0001";
    return num.toFixed(4);
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

  const { increaseLiquidity } = useIncreaseLiquidity({
    onLiquidityIncreased: () => {
      sonnerToast.success("Liquidity Increased");
      // Consider a targeted position refresh here
    },
  });

  const { decreaseLiquidity, claimFees } = useDecreaseLiquidity({
    onLiquidityDecreased: () => {
      sonnerToast.success("Liquidity Decreased");
      // Consider a targeted position refresh here
    },
    onFeesCollected: () => {
      sonnerToast.success("Fees Collected");
      // Consider a targeted position refresh here
    },
  });

  const categories = useMemo(() => {
    const types = Array.from(new Set((poolsData || []).map(p => p.type).filter(Boolean))) as string[];
    return ['All', ...types];
  }, [poolsData]);

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

  useEffect(() => {
    if (isConnected && accountAddress) {
      (async () => {
        try {
          const ids = await loadUserPositionIds(accountAddress);
          const positions = await derivePositionsFromIds(accountAddress, ids);
          setUserPositions(positions as any);
        } catch (error) {
          console.error("Failed to load derived positions:", error);
          setUserPositions([]);
        }
      })();
    } else {
      setUserPositions([]);
    }
  }, [isConnected, accountAddress]);

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const response = await fetch('/api/prices/get-token-prices');
        if (response.ok) {
          const data = await response.json();
          const prices: Record<string, number> = {};
          if (data.ETH) prices['ETH'] = data.ETH;
          if (data.aETH) prices['aETH'] = data.aETH;
          if (data.BTC) prices['BTC'] = data.BTC;
          if (data.aBTC) prices['aBTC'] = data.aBTC;
          prices['USDC'] = prices['aUSDC'] = prices['USDT'] = prices['aUSDT'] = 1.0;
          setPriceMap(prices);
        }
      } catch (error) {
        console.error("Failed to fetch token prices for liquidity page:", error);
      }
    };
    fetchPrices();
  }, []);

  const poolsWithPositionCounts = useMemo(() => {
    return poolsData.map(pool => {
      const apiPoolId = (getPoolSubgraphId(pool.id) || pool.id).toLowerCase();
      const count = userPositions.filter((pos) => String(pos?.poolId || '').toLowerCase() === apiPoolId).length;
      return { ...pool, positionsCount: count };
    });
  }, [poolsData, userPositions]);

  // Removed expanded row pool-state prefetch; keep placeholder states for helpers

  const filteredPools = useMemo(() => {
    if (selectedCategory === 'All') return poolsWithPositionCounts;
    return poolsWithPositionCounts.filter(p => (p.type || '') === selectedCategory);
  }, [poolsWithPositionCounts, selectedCategory]);

  const columns: ColumnDef<Pool>[] = useMemo(() => [
    {
      accessorKey: "pair",
      header: "Pool",
      size: 240, // Compact size for first column
      cell: ({ row }) => {
        const pool = row.original;
        return (
          <div className="flex items-center gap-2">
            <div className="relative w-14 h-7">
              <div className="absolute top-0 left-0 w-7 h-7 rounded-full overflow-hidden bg-background z-10">
                <Image
                  src={pool.tokens[0].icon}
                  alt={pool.tokens[0].symbol}
                  width={28}
                  height={28}
                  className="w-full h-full object-cover"
                />
              </div>
              {/* New relative container for second icon and cut-out */}
              <div className="absolute top-0 left-4 w-7 h-7">
                <div className="absolute inset-0 rounded-full overflow-hidden bg-background z-30">
                  <Image
                    src={pool.tokens[1].icon}
                    alt={pool.tokens[1].symbol}
                    width={28}
                    height={28}
                    className="w-full h-full object-cover"
                  />
                </div>
                {/* Background circle for cut-out effect in table */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-[#111111] z-20"></div>
              </div>
            </div>
            <div className="flex flex-col">
              <span className="font-medium mb-1">{pool.pair}</span>
              <div className="flex items-center gap-3">
                {pool.type && (
                  <span
                    className="px-1.5 py-0.5 text-xs font-normal rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-muted-foreground"
                    style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                  >
                    {pool.type}
                  </span>
                )}
                {pool.positionsCount !== undefined && pool.positionsCount > 0 && (
                  <>
                    {/* <div className="h-3 w-0.5 bg-border/50 mx-1" /> */}
                    <div className="text-xs text-muted-foreground">
                      {pool.positionsCount} {pool.positionsCount === 1 ? 'position' : 'positions'}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "volume24h",
      header: ({ column }) => (
        <div
          className="flex items-center justify-start gap-1 cursor-pointer group"
          onClick={() => {
            const state = column.getIsSorted();
            if (!state) column.toggleSorting(false); // asc
            else if (state === "asc") column.toggleSorting(true); // desc
            else setSorting([]); // default (clear)
          }}
        >
          Volume (24h)
          {column.getIsSorted() === "asc" ? (
            <ChevronUpIcon className="ml-1 h-4 w-4 text-foreground group-hover:text-foreground" />
          ) : column.getIsSorted() === "desc" ? (
            <ChevronDownIcon className="ml-1 h-4 w-4 text-foreground group-hover:text-foreground" />
          ) : (
            <ChevronsUpDownIcon className="ml-1 h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          )}
        </div>
      ),
      size: 140, // Compact size for volume column
      sortingFn: (rowA, rowB) => {
        const a = typeof rowA.original.volume24hUSD === 'number' ? rowA.original.volume24hUSD : 0;
        const b = typeof rowB.original.volume24hUSD === 'number' ? rowB.original.volume24hUSD : 0;
        return a - b;
      },
      sortDescFirst: true,
      cell: ({ row }) => (
        <div className="flex items-center justify-start gap-1">
          {typeof row.original.volume24hUSD === 'number' ? (
            <>
              <span className="mr-1">{formatUSD(row.original.volume24hUSD)}</span>
              {row.original.volumeChangeDirection === 'up' && (
                <ArrowUpRight className="h-3 w-3 text-green-500" />
              )}
              {row.original.volumeChangeDirection === 'down' && (
                <ArrowDownRight className="h-3 w-3 text-red-500" />
              )}
              {row.original.volumeChangeDirection === 'loading' && (
                <div className="inline-block h-3 w-3 bg-muted/60 rounded-full animate-pulse"></div>
              )}
            </>
          ) : (
            <div className="inline-block h-4 w-16 bg-muted/60 rounded animate-pulse"></div>
          )}
        </div>
      ),
      meta: {
        hidePriority: 3,
      },
    },
    {
      accessorKey: "fees24h",
      header: ({ column }) => (
        <div
          className="flex items-center justify-start gap-1 cursor-pointer group"
          onClick={() => {
            const state = column.getIsSorted();
            if (!state) column.toggleSorting(false); // asc
            else if (state === "asc") column.toggleSorting(true); // desc
            else setSorting([]); // default (clear)
          }}
        >
          Fees (24h)
          {column.getIsSorted() === "asc" ? (
            <ChevronUpIcon className="ml-1 h-4 w-4 text-foreground group-hover:text-foreground" />
          ) : column.getIsSorted() === "desc" ? (
            <ChevronDownIcon className="ml-1 h-4 w-4 text-foreground group-hover:text-foreground" />
          ) : (
            <ChevronsUpDownIcon className="ml-1 h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          )}
        </div>
      ),
      size: 120, // Compact size for fees column
      sortingFn: (rowA, rowB) => {
        const a = typeof rowA.original.fees24hUSD === 'number' ? rowA.original.fees24hUSD : 0;
        const b = typeof rowB.original.fees24hUSD === 'number' ? rowB.original.fees24hUSD : 0;
        return a - b;
      },
      sortDescFirst: true,
      cell: ({ row }) => (
         <div className="flex items-center justify-start">
          {typeof row.original.fees24hUSD === 'number' ? (
            formatUSD(row.original.fees24hUSD)
          ) : (
            <div className="inline-block h-4 w-12 bg-muted/60 rounded animate-pulse"></div>
          )}
        </div>
      ),
      meta: {
        hidePriority: 1,
      },
    },
    {
      accessorKey: "liquidity",
      header: ({ column }) => (
        <div 
          className="flex items-center justify-start gap-1 cursor-pointer group"
          onClick={() => {
            const state = column.getIsSorted();
            if (!state) column.toggleSorting(false); // asc
            else if (state === "asc") column.toggleSorting(true); // desc
            else setSorting([]); // default (clear)
          }}
        >
          Liquidity
          {column.getIsSorted() === "asc" ? (
            <ChevronUpIcon className="ml-1 h-4 w-4 text-foreground group-hover:text-foreground" />
          ) : column.getIsSorted() === "desc" ? (
            <ChevronDownIcon className="ml-1 h-4 w-4 text-foreground group-hover:text-foreground" />
          ) : (
            <ChevronsUpDownIcon className="ml-1 h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          )}
        </div>
      ),
      size: 140, // Compact size for liquidity column
      sortingFn: (rowA, rowB) => {
        const a = rowA.original.tvlUSD || 0;
        const b = rowB.original.tvlUSD || 0;
        return a - b;
      },
      sortDescFirst: true,
      cell: ({ row }) => (
         <div className="flex items-center justify-start gap-1">
          {typeof row.original.tvlUSD === 'number' ? (
            <>
              <span className="mr-1">{formatUSD(row.original.tvlUSD)}</span>
              {(row.original.tvlChangeDirection === 'up' || row.original.tvlChangeDirection === 'neutral') && (
                <ArrowUpRight className="h-3 w-3 text-green-500" />
              )}
              {row.original.tvlChangeDirection === 'down' && (
                <ArrowDownRight className="h-3 w-3 text-red-500" />
              )}
               {row.original.tvlChangeDirection === 'loading' && (
                 <div className="inline-block h-3 w-3 bg-muted/60 rounded-full animate-pulse"></div>
              )}
            </>
          ) : (
            <div className="inline-block h-4 w-20 bg-muted/60 rounded animate-pulse"></div>
          )}
        </div>
      ),
      meta: {
        hidePriority: 2,
      },
    },
    {
      accessorKey: "apr",
      header: ({ column }) => (
        <div 
          className="flex items-center justify-end cursor-pointer group"
          onClick={() => {
            const state = column.getIsSorted();
            if (!state) column.toggleSorting(false); // asc
            else if (state === "asc") column.toggleSorting(true); // desc
            else setSorting([]); // default (clear)
          }}
        >
          Yield
          {column.getIsSorted() === "asc" ? (
            <ChevronUpIcon className="ml-1 h-4 w-4 text-foreground group-hover:text-foreground" />
          ) : column.getIsSorted() === "desc" ? (
            <ChevronDownIcon className="ml-1 h-4 w-4 text-foreground group-hover:text-foreground" />
          ) : (
            <ChevronsUpDownIcon className="ml-1 h-4 w-4 text-muted-foreground group-hover:text-foreground" />
          )}
        </div>
      ),
      size: 200, // Larger size for yield column to push it right
      sortingFn: (rowA, rowB) => {
        const a = rowA.original.apr ? parseFloat(rowA.original.apr.replace('%', '')) : 0;
        const b = rowB.original.apr ? parseFloat(rowB.original.apr.replace('%', '')) : 0;
        return a - b;
      },
      sortDescFirst: true,
      cell: ({ row }) => {
        const isAprCalculated = row.original.apr !== undefined && row.original.apr !== "Loading..." && row.original.apr !== "N/A";
        const formattedAPR = isAprCalculated ? formatAPR(parseFloat(row.original.apr.replace('%', ''))) : undefined;
        
        return (
          <div className="relative flex items-center justify-end w-full h-full">
            {/* APR Badge / Loading Skeleton */}
            {isAprCalculated ? (
              <div className="flex items-center justify-center h-6 px-2.5 rounded-md bg-green-500/20 text-green-500 text-[12px] font-semibold overflow-hidden transition-opacity duration-200 group-hover:opacity-0">
                {formattedAPR}
              </div>
            ) : (
              <div className="inline-block h-4 w-16 bg-muted/60 rounded animate-pulse"></div>
            )}
            
            {/* Add Liquidity Button (on row hover) */}
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleAddLiquidity(e, row.original.id);
              }}
              className="absolute right-0 top-1/2 -translate-y-1/2 flex h-10 cursor-pointer items-center justify-end gap-2 rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto hover:brightness-110 hover:border-white/30"
              style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
            >
              <PlusIcon className="h-4 w-4 relative z-0" />
              <span className="relative z-0 whitespace-nowrap">Add Liquidity</span>
            </button>
          </div>
        );
      },
      meta: {
        hidePriority: 4,
      },
    },
  ], [setSorting]);

  const visibleColumns = useMemo(() => {
    if (isMobile) {
      return columns;
    }

    let hideLevel = 0;
    if (windowWidth < 1400) {
      hideLevel = 1;
    }
    
    // Filter columns based on hidePriority - proportional distribution happens automatically
    const filteredColumns = columns.filter(
      (column) => column.meta?.hidePriority === undefined || column.meta.hidePriority > hideLevel
    );

    // Adjust column sizes based on screen size - identical spacing for first 4, spacious last column
    return filteredColumns.map((col) => {
      if ('accessorKey' in col && col.accessorKey === 'pair') {
        // Pool column: same size as others for uniform spacing
        return { ...col, size: windowWidth >= 2000 ? 200 : windowWidth >= 1600 ? 300 : windowWidth >= 1200 ? 250 : 250 };
      }
      if ('accessorKey' in col && col.accessorKey === 'volume24h') {
        // Volume column: same size as others
        return { ...col, size: windowWidth >= 2000 ? 150 : windowWidth >= 1600 ? 180 : windowWidth >= 1200 ? 160 : 160 };
      }
      if ('accessorKey' in col && col.accessorKey === 'fees24h') {
        // Fees column: same size as others
        return { ...col, size: windowWidth >= 2000 ? 150 : windowWidth >= 1600 ? 180 : windowWidth >= 1200 ? 160 : 160 };
      }
      if ('accessorKey' in col && col.accessorKey === 'liquidity') {
        // Liquidity column: same size as others
        return { ...col, size: windowWidth >= 2000 ? 180 : windowWidth >= 1600 ? 180 : windowWidth >= 1200 ? 160 : 140 };
      }
      if ('accessorKey' in col && col.accessorKey === 'apr') {
        // Yield column: takes remaining space to push right
        return { ...col, size: windowWidth >= 2000 ? 400 : windowWidth >= 1600 ? 400 : windowWidth >= 1200 ? 320 : 260 };
      }
      return col;
    });
  }, [isMobile, windowWidth, columns]);

  const table = useReactTable({
    data: filteredPools,
    columns: visibleColumns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    onColumnSizingChange: setColumnSizing,
    enableColumnResizing: true,
    enableSorting: true,
    columnResizeMode: 'onChange',
    state: {
      sorting,
      columnSizing,
    },
  });

  // Derive current visible column sizes to align the top category header exactly with the table columns
  const columnSizes = React.useMemo(() => {
    const pairCol = table.getColumn('pair' as any);
    const volCol = table.getColumn('volume24h' as any);
    const feesCol = table.getColumn('fees24h' as any);
    const liqCol = table.getColumn('liquidity' as any);
    const aprCol = table.getColumn('apr' as any);
    return {
      pair: pairCol ? pairCol.getSize() : (windowWidth >= 2000 ? 300 : windowWidth >= 1600 ? 300 : windowWidth >= 1200 ? 250 : 140),
      volume24h: volCol ? volCol.getSize() : (windowWidth >= 2000 ? 180 : windowWidth >= 1600 ? 180 : windowWidth >= 1200 ? 160 : 140),
      fees24h: feesCol ? feesCol.getSize() : (windowWidth >= 2000 ? 180 : windowWidth >= 1600 ? 180 : windowWidth >= 1200 ? 160 : 140),
      liquidity: liqCol ? liqCol.getSize() : (windowWidth >= 2000 ? 180 : windowWidth >= 1600 ? 180 : windowWidth >= 1200 ? 160 : 140),
      apr: aprCol ? aprCol.getSize() : (windowWidth >= 2000 ? 400 : windowWidth >= 1600 ? 400 : windowWidth >= 1200 ? 320 : 260),
    };
  }, [table, columnSizing, windowWidth, visibleColumns]);

  const poolAggregates = React.useMemo(() => {
    let totalTVL = 0;
    let totalVol24h = 0;
    let totalFees24h = 0;
    let totalVolPrev24h = 0;
    let totalTVLYesterday = 0;
    let totalFeesPrev24h = 0;
    let counted = 0;
    for (const p of poolsData || []) {
      const tvl = (p as any).tvlUSD;
      const vol = (p as any).volume24hUSD;
      const fees = (p as any).fees24hUSD;
      const volPrev24 = (p as any).volumePrev24hUSD;
      const tvlYesterday = (p as any).tvlYesterdayUSD;
      // Prefer precise previous 24h fees if present; fallback to rough 7d/7 approximation
      const feesPrev24Exact = (p as any).feesPrev24hUSD;
      const fees7d = (p as any).fees7dUSD;
      const feesPrev24 = (typeof feesPrev24Exact === 'number' && isFinite(feesPrev24Exact))
        ? feesPrev24Exact
        : (typeof fees7d === 'number' && isFinite(fees7d))
          ? Math.max(0, fees7d / 7)
          : 0;
      if (typeof tvl === 'number' && isFinite(tvl)) totalTVL += tvl;
      if (typeof vol === 'number' && isFinite(vol)) totalVol24h += vol;
      if (typeof fees === 'number' && isFinite(fees)) totalFees24h += fees;
      if (typeof volPrev24 === 'number' && isFinite(volPrev24)) totalVolPrev24h += volPrev24;
      if (typeof tvlYesterday === 'number' && isFinite(tvlYesterday)) totalTVLYesterday += tvlYesterday;
      totalFeesPrev24h += feesPrev24;
      if (typeof tvl === 'number' || typeof vol === 'number' || typeof fees === 'number') counted++;
    }
    const isLoading = counted === 0;
    const pct = (cur: number, prev: number) => {
      if (!isFinite(cur) || !isFinite(prev) || prev <= 0) return 0;
      return ((cur - prev) / prev) * 100;
    };
    const tvlDeltaPct = pct(totalTVL, totalTVLYesterday);
    const volDeltaPct = pct(totalVol24h, totalVolPrev24h);
    const feesDeltaPct = pct(totalFees24h, totalFeesPrev24h);
    return { totalTVL, totalVol24h, totalFees24h, tvlDeltaPct, volDeltaPct, feesDeltaPct, isLoading };
  }, [poolsData]);

  const handleAddLiquidity = (e: React.MouseEvent, poolId: string) => {
    e.stopPropagation();
    router.push(`/liquidity/${poolId}`);
  };

  // handlePoolClick removed - using Link components for navigation

  const handleSortCycle = (columnId: string) => {
    const col = table.getColumn(columnId as any);
    if (!col) return;
    const state = col.getIsSorted();
    if (!state) col.toggleSorting(false); // asc
    else if (state === 'asc') col.toggleSorting(true); // desc
    else setSorting([]); // default
  };

  const renderSortIcon = (state: false | 'asc' | 'desc') => {
    if (state === 'asc') return <ChevronUpIcon className="ml-1 h-4 w-4" />;
    if (state === 'desc') return <ChevronDownIcon className="ml-1 h-4 w-4" />;
    return <ChevronsUpDownIcon className="ml-1 h-4 w-4 text-muted-foreground" />;
  };

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col p-6 px-10">
          {/* Removed duplicate header + summary container */}

            <div className="mb-2">
              <div className="flex items-stretch justify-between gap-4">
                <div className="flex flex-col">
                  <h2 className="text-xl font-semibold">Liquidity Pools</h2>
                  <p className="text-sm text-muted-foreground">Explore and manage your liquidity positions.</p>
                  <div className="mt-4">
                    <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-2 md:p-4">
                      <div className="flex items-stretch gap-1.5 md:gap-3">
                        <div className="w-[165px] md:w-[260px] rounded-lg bg-muted/30 border border-sidebar-border/60">
                          <div className="flex items-center justify-between px-3 md:px-4 h-7 md:h-9">
                            <h2 className="mt-0.5 text-[10px] md:text-xs tracking-wider text-muted-foreground font-mono font-bold">TVL</h2>
                            <div className="flex items-center gap-1">
                              {poolAggregates.isLoading ? (
                                <span className="inline-block h-2.5 w-7 md:h-3 md:w-8 bg-muted/60 rounded animate-pulse" />
                              ) : (() => {
                                const deltaPct = poolAggregates.tvlDeltaPct || 0;
                                const isPos = deltaPct >= 0;
                                return (
                                  <>
                                    {isPos ? <ArrowUpRight className="h-2.5 w-2.5 md:h-3 md:w-3 text-green-500" /> : <ArrowDownRight className="h-2.5 w-2.5 md:h-3 md:w-3 text-red-500" />}
                                    <span className={`${isPos ? 'text-green-500' : 'text-red-500'} text-[10px] md:text-[11px] font-medium`}>{Math.abs(deltaPct).toFixed(2)}%</span>
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                          <div className="px-3 md:px-4 py-1">
                            <div className="text-base md:text-lg font-medium">
                              {poolAggregates.isLoading ? <span className="inline-block h-5 w-16 md:h-6 md:w-20 bg-muted/60 rounded animate-pulse" /> : formatUSD(poolAggregates.totalTVL)}
                            </div>
                          </div>
                        </div>
                        <div className="w-[165px] md:w-[260px] rounded-lg bg-muted/30 border border-sidebar-border/60">
                          <div className="flex items-center justify-between px-3 md:px-4 h-7 md:h-9">
                            <h2 className="mt-0.5 text-[10px] md:text-xs tracking-wider text-muted-foreground font-mono font-bold">VOLUME (24H)</h2>
                            <div className="flex items-center gap-1">
                              {poolAggregates.isLoading ? (
                                <span className="inline-block h-2.5 w-7 md:h-3 md:w-8 bg-muted/60 rounded animate-pulse" />
                              ) : (() => {
                                const deltaPct = poolAggregates.volDeltaPct || 0;
                                const isPos = deltaPct >= 0;
                                return (
                                  <>
                                    {isPos ? <ArrowUpRight className="h-2.5 w-2.5 md:h-3 md:w-3 text-green-500" /> : <ArrowDownRight className="h-2.5 w-2.5 md:h-3 md:w-3 text-red-500" />}
                                    <span className={`${isPos ? 'text-green-500' : 'text-red-500'} text-[10px] md:text-[11px] font-medium`}>{Math.abs(deltaPct).toFixed(2)}%</span>
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                          <div className="px-3 md:px-4 py-1">
                            <div className="text-base md:text-lg font-medium">
                              {poolAggregates.isLoading ? <span className="inline-block h-5 w-20 md:h-6 md:w-24 bg-muted/60 rounded animate-pulse" /> : formatUSD(poolAggregates.totalVol24h)}
                            </div>
                          </div>
                        </div>
                        {windowWidth >= 1400 && (
                          <div className="w-[165px] md:w-[260px] rounded-lg bg-muted/30 border border-sidebar-border/60">
                            <div className="flex items-center justify-between px-3 md:px-4 h-7 md:h-9">
                              <h2 className="mt-0.5 text-[10px] md:text-xs tracking-wider text-muted-foreground font-mono font-bold">FEES (24H)</h2>
                              <div className="flex items-center gap-1">
                                {poolAggregates.isLoading ? (
                                  <span className="inline-block h-2.5 w-7 md:h-3 md:w-8 bg-muted/60 rounded animate-pulse" />
                                ) : (() => {
                                  const deltaPct = poolAggregates.feesDeltaPct || 0;
                                  const isPos = deltaPct >= 0;
                                  return (
                                    <>
                                      {isPos ? <ArrowUpRight className="h-2.5 w-2.5 md:h-3 md:w-3 text-green-500" /> : <ArrowDownRight className="h-2.5 w-2.5 md:h-3 md:w-3 text-red-500" />}
                                      <span className={`${isPos ? 'text-green-500' : 'text-red-500'} text-[10px] md:text-[11px] font-medium`}>{Math.abs(deltaPct).toFixed(2)}%</span>
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                            <div className="px-3 md:px-4 py-1">
                              <div className="text-base md:text-lg font-medium">
                                {poolAggregates.isLoading ? <span className="inline-block h-5 w-16 md:h-6 md:w-20 bg-muted/60 rounded animate-pulse" /> : formatUSD(poolAggregates.totalFees24h)}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="hidden md:flex items-end">
                  <div className="flex items-center gap-2 flex-wrap">
                    {categories.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-2 py-1 text-xs rounded-md transition-all duration-200 cursor-pointer ${
                          selectedCategory === cat
                            ? 'border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] text-foreground brightness-110'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                        style={selectedCategory === cat ? { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {isMobile ? (
              <MobileLiquidityList 
                pools={filteredPools}
                onSelectPool={(poolId) => router.push(`/liquidity/${poolId}`)}
              />
            ) : (
              <div className="overflow-x-auto isolate">
                <Table className="w-full bg-muted/30 border border-sidebar-border/60 overflow-hidden" style={{ tableLayout: 'fixed' }}>
                  <TableHeader>
                    {/* New category header row inside the table for perfect alignment */}
                    <TableRow className="hover:bg-transparent">
                      {table.getVisibleLeafColumns().map((col, index, arr) => (
                        <TableHead
                          key={`cat-${col.id}`}
                          className={`px-2 relative text-xs text-muted-foreground ${index === 0 ? 'pl-6' : ''} ${index === arr.length - 1 ? 'pr-6' : ''}`}
                          style={{ width: `${col.getSize()}px` }}
                        >
                          {col.id === 'pair' ? (
                            <span className="tracking-wider font-mono font-bold">POOLS</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSortCycle(col.id)}
                              className={`flex w-full items-center ${col.id === 'apr' ? 'justify-end text-right' : 'justify-start text-left'} cursor-pointer select-none`}
                            >
                              <span>
                                {col.id === 'volume24h' && 'Volume (24h)'}
                                {col.id === 'fees24h' && 'Fees (24h)'}
                                {col.id === 'liquidity' && 'Liquidity'}
                                {col.id === 'apr' && 'Yield'}
                              </span>
                              {renderSortIcon(table.getColumn(col.id as any)?.getIsSorted?.() as any)}
                            </button>
                          )}
                          {/* no resizer in category row */}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {table.getRowModel().rows?.length ? (
                      table.getRowModel().rows.map((row) => {
                        const pool = row.original;
                        const isExpanded = false;

                        return (
                          <React.Fragment key={row.id}>
                            <Link href={`/liquidity/${pool.id}`} className="contents">
                              <TableRow className="group cursor-pointer transition-colors hover:bg-muted/30">
                                {row.getVisibleCells().map((cell, index) => (
                                  <TableCell 
                                    key={cell.id}
                                    className={`relative py-4 px-2 ${index === 0 ? 'pl-6' : ''} ${index === row.getVisibleCells().length - 1 ? 'pr-6' : ''}`}
                                    style={{ width: `${cell.column.getSize()}px` }}
                                  >
                                    {flexRender(
                                      cell.column.columnDef.cell,
                                      cell.getContext()
                                    )}
                                  </TableCell>
                                ))}
                              </TableRow>
                            </Link>
                            {/* Expanded positions removed */}
                          </React.Fragment>
                        );
                      })
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
      </AppLayout>
    );
  } 