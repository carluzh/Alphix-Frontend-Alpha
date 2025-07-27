"use client";

import { AppLayout } from "@/components/app-layout";
import { useState, useEffect, useMemo } from "react";
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
import { getEnabledPools, getToken, getPoolSubgraphId } from "../../lib/pools-config";
import { getFromCache, setToCache, getUserPositionsCacheKey, getPoolStatsCacheKey } from "../../lib/client-cache";
import { Pool } from "../../types";
import { AddLiquidityModal } from "@liquidity/AddLiquidityModal";
import { useRouter } from "next/navigation";
import { ChevronUpIcon, ChevronDownIcon, ChevronsUpDownIcon } from "lucide-react";

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
  interface ColumnMeta<TData extends RowData, TValue> {
    hidePriority?: number;
  }
}

const formatUSD = (value: number) => {
  if (value < 0.01) return "< $0.01";
  if (value < 1000) return `$${value.toFixed(2)}`;
  return `$${(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
};

const formatAPR = (aprValue: number) => {
  if (aprValue < 100) {
    return aprValue.toFixed(2) + '%';
  } else if (aprValue < 1000) {
    return Math.round(aprValue) + '%';
  } else {
    return (aprValue / 1000).toFixed(1) + 'K%';
  }
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
  const [addLiquidityOpen, setAddLiquidityOpen] = useState(false);
  const [selectedPoolApr, setSelectedPoolApr] = useState<string | undefined>(undefined);
  const router = useRouter();

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
      const cacheKey = getUserPositionsCacheKey(accountAddress);
      const cachedPositions = getFromCache<ProcessedPosition[]>(cacheKey);

      if (cachedPositions) {
        console.log("[Cache HIT] Using cached user positions for", accountAddress);
        setUserPositions(cachedPositions);
        return;
      }

      console.log("[Cache MISS] Fetching user positions from API for", accountAddress);
      fetch(`/api/liquidity/get-positions?ownerAddress=${accountAddress}`)
        .then(res => {
          if (!res.ok) { throw new Error(`Failed to fetch positions: ${res.statusText}`); }
          return res.json();
        })
        .then((data: ProcessedPosition[] | { message: string }) => {
          if (Array.isArray(data)) {
            setUserPositions(data);
            setToCache(cacheKey, data);
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
        });
    } else {
      setUserPositions([]);
    }
  }, [isConnected, accountAddress]);

  useEffect(() => {
    const fetchAllPoolStatsBatch = async () => {
      console.log("[LiquidityPage] Starting batch fetch for all pools...");
      
      try {
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

        const response = await fetch('/api/liquidity/get-pools-batch');
        
        if (!response.ok) {
          throw new Error(`Batch API failed: ${response.status}`);
        }

        const batchData = await response.json();
        
        if (!batchData.success) {
          throw new Error(`Batch API error: ${batchData.message}`);
        }

        console.log(`[LiquidityPage] Batch API returned data for ${batchData.pools.length} pools`);

        const updatedPools = poolsData.map(pool => {
          const apiPoolId = getPoolSubgraphId(pool.id) || pool.id;
          const batchPoolData = batchData.pools.find((p: any) => p.poolId.toLowerCase() === apiPoolId.toLowerCase());
          
          if (batchPoolData) {
            let calculatedApr = "Loading...";
            
            if (typeof batchPoolData.fees24hUSD === 'number' && batchPoolData.tvlUSD > 0) {
              const yearlyFees = batchPoolData.fees24hUSD * 365;
              const apr = (yearlyFees / batchPoolData.tvlUSD) * 100;
              calculatedApr = apr.toFixed(2) + '%';
            } else {
              calculatedApr = "N/A";
            }

            const updatedStats = {
              volume24hUSD: batchPoolData.volume24hUSD,
              fees24hUSD: batchPoolData.fees24hUSD,
              volume7dUSD: batchPoolData.volume7dUSD,
              fees7dUSD: batchPoolData.fees7dUSD,
              tvlUSD: batchPoolData.tvlUSD,
              volume48hUSD: batchPoolData.volume48hUSD,
              volumeChangeDirection: batchPoolData.volumeChangeDirection,
              tvlYesterdayUSD: 0,
              tvlChangeDirection: 'neutral' as const,
              apr: calculatedApr,
            };

            const statsCacheKey = getPoolStatsCacheKey(apiPoolId);
            setToCache(statsCacheKey, updatedStats);
            console.log(`[Cache SET] Cached batch stats for pool: ${pool.pair}`);

            return { ...pool, ...updatedStats };
          } else {
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
      fetchAllPoolStatsBatch();
    }

    const intervalId = setInterval(() => {
      console.log("[LiquidityPage] Interval: Refreshing pool stats with batch API...");
      fetchAllPoolStatsBatch();
    }, 60000);

    return () => {
      clearInterval(intervalId);
    };
  }, []);

  const poolsWithPositionCounts = useMemo(() => {
    return poolsData.map(pool => {
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
  }, [poolsData, userPositions]);

  const columns: ColumnDef<Pool>[] = useMemo(() => [
    {
      accessorKey: "pair",
      header: "Pool",
      size: 300, // 3/7 of total width (will be converted to percentage)
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
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-[#141414] z-20"></div>
              </div>
            </div>
            <div className="flex flex-col">
              <span className="font-medium">{pool.pair}</span>
              {pool.positionsCount !== undefined && pool.positionsCount > 0 ? (
                <div className="text-xs text-muted-foreground">
                  {pool.positionsCount} {pool.positionsCount === 1 ? 'position' : 'positions'}
                </div>
              ) : null}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "volume24h",
      header: () => <div>Volume (24h)</div>,
      size: 100, // 1/7 of total width
      cell: ({ row }) => (
        <div className="flex items-center justify-start gap-1">
          {typeof row.original.volume24hUSD === 'number' ? (
            <>
              <span className="mr-2">{formatUSD(row.original.volume24hUSD)}</span>
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
      header: () => <div>Fees (24h)</div>,
      size: 100, // 1/7 of total width
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
          onClick={() => column.toggleSorting()}
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
      size: 100, // 1/7 of total width
      sortingFn: (rowA, rowB) => {
        const a = rowA.original.tvlUSD || 0;
        const b = rowB.original.tvlUSD || 0;
        return a - b;
      },
      cell: ({ row }) => (
         <div className="flex items-center justify-start gap-1">
          {typeof row.original.tvlUSD === 'number' ? (
            <>
              <span className="mr-2">{formatUSD(row.original.tvlUSD)}</span>
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
          onClick={() => column.toggleSorting()}
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
      size: 80, // 1/14 of total width (half of other metric columns)
      sortingFn: (rowA, rowB) => {
        const a = rowA.original.apr ? parseFloat(rowA.original.apr.replace('%', '')) : 0;
        const b = rowB.original.apr ? parseFloat(rowB.original.apr.replace('%', '')) : 0;
        return a - b;
      },
      cell: ({ row }) => {
        const isAprCalculated = row.original.apr !== undefined && row.original.apr !== "Loading..." && row.original.apr !== "N/A";
        const formattedAPR = isAprCalculated ? formatAPR(parseFloat(row.original.apr.replace('%', ''))) : undefined;
        return (
          <div className="flex items-center justify-end">
            {isAprCalculated ? (
              <div className="flex items-center justify-center h-6 rounded-md bg-green-500/20 text-green-500 overflow-hidden" style={{ width: '72px' }}>
                {formattedAPR}
              </div>
            ) : (
              <div className="inline-block h-4 w-16 bg-muted/60 rounded animate-pulse"></div>
            )}
          </div>
        );
      },
      meta: {
        hidePriority: 4,
      },
    },
  ], []);

  const visibleColumns = useMemo(() => {
    if (isMobile) {
      return columns;
    }

    let hideLevel = 0;
    if (windowWidth < 900) {
      hideLevel = 3;
    } else if (windowWidth < 1100) {
      hideLevel = 2;
    } else if (windowWidth < 1300) {
      hideLevel = 1;
    }
    
    // Filter columns based on hidePriority - proportional distribution happens automatically
    const filteredColumns = columns.filter(
      (column) => column.meta?.hidePriority === undefined || column.meta.hidePriority > hideLevel
    );

    // Adjust Yield column size based on screen size
    return filteredColumns.map((col) => {
      if ('accessorKey' in col && col.accessorKey === 'apr') {
        return { ...col, size: windowWidth >= 1800 ? 40 : 80 };
      }
      if ('accessorKey' in col && col.accessorKey === 'pair') {
        return { ...col, size: windowWidth >= 2200 ? 400 : 300 };
      }
      return col;
    });
  }, [isMobile, windowWidth, columns]);

  const table = useReactTable({
    data: poolsWithPositionCounts,
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

  const handleAddLiquidity = (e: React.MouseEvent, poolId: string) => {
    e.stopPropagation();
    setSelectedPoolId(poolId); 
    const pool = poolsWithPositionCounts.find(p => p.id === poolId);
    setSelectedPoolApr(pool?.apr);
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
                <Table className="w-full" style={{ tableLayout: 'fixed' }}>
                  <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id} className="hover:bg-transparent">
                        {headerGroup.headers.map((header, index) => (
                          <TableHead 
                            key={header.id}
                            className={`px-2 relative ${index === 0 ? 'pl-6' : ''} ${index === headerGroup.headers.length - 1 ? 'pr-6' : ''}`}
                            style={{ width: `${header.getSize()}px` }}
                          >
                            {header.isPlaceholder
                              ? null
                              : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext()
                                )}
                            <div
                              onMouseDown={header.getResizeHandler()}
                              onTouchStart={header.getResizeHandler()}
                              className={`absolute right-0 top-0 h-full w-1 bg-border cursor-col-resize select-none touch-none ${
                                header.column.getIsResizing() ? 'bg-primary opacity-100' : 'opacity-0 hover:opacity-100'
                              }`}
                            />
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
                            row.original.highlighted ? 'bg-accent/10 hover:bg-accent/30' : 'hover:bg-muted/30'
                          }`}
                        >
                          {row.getVisibleCells().map((cell, index) => (
                            <TableCell 
                              key={cell.id}
                              onClick={() => handlePoolClick(row.original.id)}
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
      <AddLiquidityModal
        isOpen={addLiquidityOpen}
        onOpenChange={setAddLiquidityOpen}
        selectedPoolId={selectedPoolId}
        poolApr={selectedPoolApr}
        onLiquidityAdded={() => {
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