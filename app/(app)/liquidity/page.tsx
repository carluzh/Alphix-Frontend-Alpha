"use client";

import { formatUSD as formatUSDShared } from "@/lib/format";
import { useState, useMemo, useCallback } from "react";
import { Table, Cell, HeaderCell, ClickableHeaderRow, HeaderArrow, HeaderSortText } from "@/components/table-v2";
import Image from "next/image";
import Link from "next/link";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { motion, useReducedMotion } from "framer-motion";

import * as React from "react";
import { ColumnDef, RowData, Row } from "@tanstack/react-table";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePrefetchOnHover } from "@/hooks/usePrefetchOnHover";
import { MobileLiquidityList } from "@/components/MobileLiquidityList";
import { getMultiChainEnabledPools, getToken, getPoolSubgraphId, resolveTokenIcon, type NetworkMode } from "@/lib/pools-config";
import { CHAIN_REGISTRY } from "@/lib/chain-registry";
import { Pool } from "@/types";
import { prefetchService } from "@/lib/prefetch-service";
import { APRBadge } from "@/components/liquidity/APRBadge";
import { useWSPools } from "@/lib/websocket";
import { TokenSearchBar } from "@/components/liquidity/TokenSearchBar";
import { ProtocolStatsHero } from "./components/ProtocolStatsHero";
import { useProtocolStats } from "./hooks/useProtocolStats";

/**
 * PoolRowPrefetchWrapper - Wraps pool table rows with hover prefetch and stagger animation
 * Prefetches pool detail page data when user hovers over a pool row
 */
function PoolRowPrefetchWrapper({
  poolId,
  children,
  index = 0,
}: {
  poolId: string;
  children: React.ReactNode;
  index?: number;
}) {
  const { onMouseEnter, onMouseLeave } = usePrefetchOnHover({
    prefetchRoute: `/liquidity/${poolId}`,
    prefetchData: () => prefetchService.prefetchPoolDetailData(poolId),
    delay: 150,
  });
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return (
      <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      onHoverStart={onMouseEnter}
      onHoverEnd={onMouseLeave}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: 0.1 + index * 0.03,
        duration: 0.3,
        ease: [0.25, 0.1, 0.25, 1],
      }}
    >
      {children}
    </motion.div>
  );
}

const generatePoolsFromConfig = (): Pool[] => {
  const enabledPools = getMultiChainEnabledPools();

  return enabledPools.map(poolConfig => {
    const token0 = getToken(poolConfig.currency0.symbol, poolConfig.networkMode);
    const token1 = getToken(poolConfig.currency1.symbol, poolConfig.networkMode);

    if (!token0 || !token1) {
      console.warn(`Missing token configuration for pool ${poolConfig.id}`);
      return null;
    }

    return {
      id: poolConfig.id,
      tokens: [
        { symbol: token0.symbol, icon: resolveTokenIcon(token0.symbol) },
        { symbol: token1.symbol, icon: resolveTokenIcon(token1.symbol) }
      ],
      pair: `${token0.symbol} / ${token1.symbol}`,
      volume24h: "Loading...",
      fees24h: "Loading...",
      liquidity: "Loading...",
      apr: "Loading...",
      highlighted: poolConfig.featured,
      type: poolConfig.type,
      networkMode: poolConfig.networkMode,
    } as Pool;
  }).filter(Boolean) as Pool[];
};

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

export default function LiquidityPage() {
  // Pool config (static: tokens, icons, pair names) — includes all chains
  const poolConfigs = useMemo(() => generatePoolsFromConfig(), []);

  // Pool metrics from WebSocket (real-time: TVL, volume, fees, APR)
  // Pattern: Initial REST from api.alphix.fi → WebSocket updates
  const { pools: wsPoolsData, poolsMap: wsPoolsMap, isLoading: isLoadingPools } = useWSPools();

  // Protocol-level aggregate stats for the hero section
  const protocolStats = useProtocolStats({ pools: wsPoolsData, isLoading: isLoadingPools });

  // Merge pool config with WebSocket metrics
  const poolsData = useMemo(() => {
    return poolConfigs.map(poolConfig => {
      const subgraphId = (getPoolSubgraphId(poolConfig.id, poolConfig.networkMode) || poolConfig.id).toLowerCase();
      const wsPool = wsPoolsMap.get(subgraphId);

      if (wsPool) {
        // Format APY string
        const aprValue = wsPool.apy24h;
        const aprStr = Number.isFinite(aprValue) && aprValue > 0
          ? (aprValue < 1000 ? `${aprValue.toFixed(2)}%` : `${(aprValue / 1000).toFixed(2)}K%`)
          : '0.00%';

        return {
          ...poolConfig,
          tvlUSD: wsPool.tvlUsd,
          volume24hUSD: wsPool.volume24hUsd,
          fees24hUSD: wsPool.totalFees24hUsd ?? wsPool.fees24hUsd,
          apr: aprStr,
          swapApy: wsPool.swapApy,
          lendingApy: wsPool.lendingApy,
        };
      }
      return poolConfig;
    });
  }, [poolConfigs, wsPoolsMap]);

  const isMobile = useIsMobile();

  // Track window width for responsive column hiding
  // Below 1170px: hide Fees, Below 940px: also hide Volume
  const [tableWidth, setTableWidth] = React.useState<number>(typeof window !== 'undefined' ? window.innerWidth : 1200);
  React.useEffect(() => {
    const handleResize = () => setTableWidth(window.innerWidth);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // All chains shown — constant set for filteredPools compatibility
  const activeChains = useMemo(() => new Set<NetworkMode>(['base', 'arbitrum']), []);

  // Pool type filter
  type PoolTypeFilter = 'all' | 'Stable' | 'Volatile';
  const [activePoolType, setActivePoolType] = useState<PoolTypeFilter>('all');

  // Sorting state
  type SortField = 'tvl' | 'volume24h' | 'fees24h' | 'apr';
  const [sortMethod, setSortMethod] = useState<SortField>('tvl');
  const [sortAscending, setSortAscending] = useState(false);

  const handleSort = useCallback((field: SortField) => {
    if (sortMethod === field) {
      setSortAscending(prev => !prev);
    } else {
      setSortMethod(field);
      setSortAscending(false);
    }
  }, [sortMethod]);

  // Sortable header component
  const SortableHeader = ({ field, label, justify = 'flex-end' }: { field: SortField; label: string; justify?: 'flex-start' | 'flex-end' }) => {
    const isActive = sortMethod === field;
    return (
      <HeaderCell justifyContent={justify}>
        <ClickableHeaderRow className="group gap-1 w-full" style={{ justifyContent: justify }} onClick={() => handleSort(field)}>
          <HeaderSortText active={isActive}>{label}</HeaderSortText>
          {isActive && <HeaderArrow orderDirection={sortAscending ? 'asc' : 'desc'} />}
        </ClickableHeaderRow>
      </HeaderCell>
    );
  };


  // Token search state
  const [tokenSearch, setTokenSearch] = useState("");
  const handleTokenSearchChange = useCallback((value: string) => {
    setTokenSearch(value);
  }, []);

  const poolsWithPositionCounts = poolsData;

  const filteredPools = useMemo(() => {
    let poolsWithLinks = poolsWithPositionCounts
      .filter(pool => activeChains.has(pool.networkMode ?? 'base'))
      .filter(pool => activePoolType === 'all' || pool.type === activePoolType)
      .filter(pool => {
        if (!tokenSearch.trim()) return true;
        const search = tokenSearch.toLowerCase().trim();
        const tokens = pool.tokens || [];
        return tokens.some((t: any) => t.symbol?.toLowerCase().includes(search));
      })
      .map(pool => ({
        ...pool,
        link: `/liquidity/${pool.id}?chain=${CHAIN_REGISTRY[pool.networkMode ?? 'base'].backendNetwork}`,
      }));

    const getSortValue = (pool: any): number => {
      switch (sortMethod) {
        case 'tvl': return pool.tvlUSD || 0;
        case 'volume24h': return pool.volume24hUSD || 0;
        case 'fees24h': return pool.fees24hUSD || 0;
        case 'apr': {
          // Use backend totalApy directly (swap + lending, already computed)
          const aprStr = pool.apr || '0';
          const isK = aprStr.includes('K%');
          const parsed = parseFloat(aprStr.replace(/[~%K]/g, '')) || 0;
          return isK ? parsed * 1000 : parsed;
        }
        default: return 0;
      }
    };

    return [...poolsWithLinks].sort((a, b) => {
      const aVal = getSortValue(a);
      const bVal = getSortValue(b);
      return sortAscending ? aVal - bVal : bVal - aVal;
    });
  }, [poolsWithPositionCounts, sortMethod, sortAscending, activeChains, activePoolType, tokenSearch]);


  const columns: ColumnDef<Pool & { link: string }>[] = useMemo(() => {
    const allColumns: ColumnDef<Pool & { link: string }>[] = [
      {
        id: "pair",
        accessorKey: "pair",
        header: () => (
          <HeaderCell justifyContent="flex-start">
            <span className="text-muted-foreground text-sm">Pool</span>
          </HeaderCell>
        ),
        size: 280,
        cell: ({ row }) => {
          const pool = row?.original;
          if (!pool) {
            return (
              <Cell loading justifyContent="flex-start" />
            );
          }
          return (
            <Cell justifyContent="flex-start">
              <div className="flex items-center gap-3">
                <div className="relative w-14 h-7 flex-shrink-0">
                  <div className="absolute top-0 left-0 w-7 h-7 rounded-full overflow-hidden bg-background border border-sidebar-border z-10">
                    <Image
                      src={pool.tokens[0].icon}
                      alt={pool.tokens[0].symbol}
                      width={28}
                      height={28}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="absolute top-0 left-5 w-7 h-7 rounded-full overflow-hidden bg-background border border-sidebar-border z-20">
                    <Image
                      src={pool.tokens[1].icon}
                      alt={pool.tokens[1].symbol}
                      width={28}
                      height={28}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-sm truncate">{pool.pair}</span>
                  {pool.type && (
                    <span className="px-1.5 py-0.5 text-[10px] font-normal rounded border border-sidebar-border/50 bg-muted/30 text-muted-foreground flex-shrink-0">
                      {pool.type}
                    </span>
                  )}
                </div>
              </div>
            </Cell>
          );
        },
      },
      {
        id: "tvl",
        accessorKey: "tvlUSD",
        header: () => <SortableHeader field="tvl" label="TVL" />,
        size: 140,
        cell: ({ row }) => {
          const isLoading = !row?.original || typeof row.original.tvlUSD !== 'number';
          return (
            <Cell loading={isLoading} justifyContent="flex-end">
              <span className="text-sm">{formatUSD(row?.original?.tvlUSD || 0)}</span>
            </Cell>
          );
        },
      },
      {
        id: "volume24h",
        accessorKey: "volume24hUSD",
        header: () => <SortableHeader field="volume24h" label="Volume (24h)" />,
        size: 150,
        cell: ({ row }) => {
          const isLoading = !row?.original || typeof row.original.volume24hUSD !== 'number';
          return (
            <Cell loading={isLoading} justifyContent="flex-end">
              <span className="text-sm">{formatUSD(row?.original?.volume24hUSD || 0)}</span>
            </Cell>
          );
        },
      },
      {
        id: "fees24h",
        accessorKey: "fees24hUSD",
        header: () => <SortableHeader field="fees24h" label="Fees (24h)" />,
        size: 130,
        cell: ({ row }) => {
          const isLoading = !row?.original || typeof row.original.fees24hUSD !== 'number';
          return (
            <Cell loading={isLoading} justifyContent="flex-end">
              <span className="text-sm">{formatUSD(row?.original?.fees24hUSD || 0)}</span>
            </Cell>
          );
        },
      },
      {
        id: "apr",
        accessorKey: "apr",
        header: () => <SortableHeader field="apr" label="APY" />,
        size: 120,
        cell: ({ row }) => {
          const pool = row?.original;
          if (!pool) {
            return <Cell loading justifyContent="flex-end" />;
          }
          const isAprCalculated = pool.apr !== undefined && pool.apr !== "Loading..." && pool.apr !== "N/A";
          const tokens = pool.tokens || [];

          return (
            <Cell justifyContent="flex-end">
              <APRBadge
                breakdown={{ poolApy: (pool as any).swapApy, lendingApy: (pool as any).lendingApy }}
                token0Symbol={tokens[0]?.symbol}
                token1Symbol={tokens[1]?.symbol}
                isLoading={!isAprCalculated}
              />
            </Cell>
          );
        },
      },
    ];

    // Responsive column filtering
    // Below 1170px: hide Fees, Below 940px: also hide Volume
    return allColumns.filter(col => {
      if (col.id === 'fees24h' && tableWidth < 1170) return false;
      if (col.id === 'volume24h' && tableWidth < 940) return false;
      return true;
    });
  }, [sortMethod, sortAscending, tableWidth]);

  // Split filtered pools by chain for separate table sections
  const { basePools, arbitrumPools } = useMemo(() => {
    const base: typeof filteredPools = [];
    const arb: typeof filteredPools = [];
    for (const pool of filteredPools) {
      if ((pool.networkMode ?? 'base') === 'arbitrum') {
        arb.push(pool);
      } else {
        base.push(pool);
      }
    }
    return { basePools: base, arbitrumPools: arb };
  }, [filteredPools]);

  // Prefetch wrapper for pool rows - prefetches data on hover with stagger animation
  const poolRowWrapper = useCallback(
    (row: Row<Pool & { link: string }>, content: React.ReactNode) => {
      const poolId = row.original?.id;
      if (!poolId) return content;

      return (
        <PoolRowPrefetchWrapper poolId={poolId} index={row.index}>
          {content}
        </PoolRowPrefetchWrapper>
      );
    },
    []
  );

  return (
    <div className="flex flex-col gap-4 p-3 sm:p-6 overflow-x-hidden w-full max-w-[1200px] mx-auto">
      {/* Protocol Stats Hero */}
      <ProtocolStatsHero stats={protocolStats} />

      {/* Toolbar: All Pools label (left) + Search + New Position (right) */}
      <div className="hidden sm:flex items-center justify-between mt-6">
        {/* Pool type filter */}
        <div className="flex items-center gap-1">
          {([
            { id: 'all' as PoolTypeFilter, label: 'All Pools' },
            { id: 'Stable' as PoolTypeFilter, label: 'Stable' },
            { id: 'Volatile' as PoolTypeFilter, label: 'Volatile' },
          ]).map((opt) => (
            <button
              key={opt.id}
              onClick={() => setActivePoolType(opt.id)}
              className={cn(
                "h-9 px-4 text-sm font-medium rounded-lg transition-colors",
                activePoolType === opt.id
                  ? "text-foreground bg-muted/30 border border-sidebar-border"
                  : "text-muted-foreground hover:text-foreground",
                "focus:outline-none"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Search + New Position */}
        <div className="flex items-center gap-3">
          <TokenSearchBar
            value={tokenSearch}
            onValueChange={handleTokenSearchChange}
            placeholder="Search tokens..."
            multiChain
          />
          <Button
            asChild
            className="h-10 px-4 gap-2 bg-button-primary hover-button-primary text-sidebar-primary font-semibold rounded-md transition-all active:scale-[0.98]"
          >
            <Link href="/liquidity/add?from=pools">
              <Plus className="h-4 w-4" strokeWidth={2.5} />
              New position
            </Link>
          </Button>
        </div>
      </div>

      <hr className="border-sidebar-border my-0 hidden sm:block" />

      {/* Pool Tables */}
      {isMobile ? (
        <div className="flex flex-col gap-5 mt-4">
          {activeChains.has('base') && basePools.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 px-1">
                <img src="/chains/base.svg" alt="Base" className="w-[18px] h-[18px] rounded-[5px]" />
                <span className="text-xs font-medium text-muted-foreground">Base</span>
              </div>
              <MobileLiquidityList pools={basePools} />
            </div>
          )}
          {activeChains.has('arbitrum') && arbitrumPools.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 px-1">
                <img src="/chains/arbitrum.svg" alt="Arbitrum" className="w-[18px] h-[18px] rounded-[5px]" />
                <span className="text-xs font-medium text-muted-foreground">Arbitrum</span>
              </div>
              <MobileLiquidityList pools={arbitrumPools} />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {activeChains.has('base') && basePools.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 px-1">
                <img src="/chains/base.svg" alt="Base" className="w-4 h-4 rounded-full" />
                <span className="text-sm font-medium text-foreground/70">Base</span>
              </div>
              <Table
                columns={columns}
                data={basePools}
                loading={isLoadingPools}
                maxWidth={1200}
                loadingRowsCount={4}
                rowWrapper={poolRowWrapper}
              />
            </div>
          )}

          {activeChains.has('arbitrum') && arbitrumPools.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 px-1">
                <img src="/chains/arbitrum.svg" alt="Arbitrum" className="w-4 h-4 rounded-full" />
                <span className="text-sm font-medium text-foreground/70">Arbitrum</span>
              </div>
              <Table
                columns={columns}
                data={arbitrumPools}
                loading={isLoadingPools}
                maxWidth={1200}
                loadingRowsCount={2}
                rowWrapper={poolRowWrapper}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
} 