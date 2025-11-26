"use client";

import { useState, useMemo } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { ColumnDef, flexRender, getCoreRowModel, getSortedRowModel, SortingState, useReactTable } from "@tanstack/react-table";
import { AppLayout } from "@/components/app-layout";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { MobileLiquidityList } from "@/components/MobileLiquidityList";
import { getPoolsForDisplay } from "@/lib/pools-config";
import { formatUSD } from "@/lib/format";
import { usePoolsBatch, usePoolsAprBatch, useUserPositions } from "@/components/data/hooks";
import type { Pool } from "@/types";

const basePools = getPoolsForDisplay();

// Reusable component for pool token pair icons
function PoolTokenIcons({ tokens }: { tokens: Pool['tokens'] }) {
  return (
    <div className="relative w-14 h-7">
      <div className="absolute top-0 left-0 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
        <Image src={tokens[0].icon} alt={tokens[0].symbol} width={28} height={28} className="w-full h-full object-cover" />
      </div>
      <div className="absolute top-0 left-4 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
        <Image src={tokens[1].icon} alt={tokens[1].symbol} width={28} height={28} className="w-full h-full object-cover" />
      </div>
    </div>
  );
}

// Helper to check if APR is loaded (not a placeholder)
const isAprLoaded = (apr: string) => apr && !apr.includes("Loading");

export default function LiquidityPage() {
  const [sorting, setSorting] = useState<SortingState>([]);
  const isMobile = useIsMobile();
  const router = useRouter();
  const { address } = useAccount();

  const poolIds = useMemo(() => basePools.map(p => p.id), []);
  const { data: batchData } = usePoolsBatch(poolIds);
  const { data: aprData } = usePoolsAprBatch(poolIds);
  const { data: positions = [], isLoading: loadingPositions } = useUserPositions(address);

  // Merge all data sources into enriched pools
  const pools: Pool[] = useMemo(() => {
    const batchMap = new Map(batchData?.map(p => [p.poolId.toLowerCase(), p]));
    const aprMap = new Map(aprData?.map(p => [p.poolId.toLowerCase(), p]));

    return basePools.map(pool => {
      const batch = batchMap.get(pool.id.toLowerCase());
      const apr = aprMap.get(pool.id.toLowerCase());
      const [t0, t1] = pool.pair.split(' / ').map(s => s.trim().toUpperCase());

      const positionCount = positions.filter(pos => {
        const p0 = pos.token0.symbol?.toUpperCase();
        const p1 = pos.token1.symbol?.toUpperCase();
        return (p0 === t0 && p1 === t1) || (p0 === t1 && p1 === t0);
      }).length;

      return {
        ...pool,
        tvlUSD: batch?.tvlUSD,
        volume24hUSD: batch?.volume24hUSD,
        fees24hUSD: batch?.fees24hUSD,
        apr: apr?.apr7d ? `${apr.apr7d.toFixed(2)}%` : pool.apr,
        positionsCount: positionCount,
      };
    });
  }, [batchData, aprData, positions]);

  const columns: ColumnDef<Pool>[] = useMemo(() => [
    {
      accessorKey: "pair",
      header: "Pool",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <PoolTokenIcons tokens={row.original.tokens} />
          <div className="flex flex-col">
            <span className="font-medium">{row.original.pair}</span>
            <div className="text-xs h-4 text-muted-foreground">
              {loadingPositions ? <Skeleton className="h-3 w-16" />
                : row.original.positionsCount ? `${row.original.positionsCount} position${row.original.positionsCount > 1 ? 's' : ''}`
                : null}
            </div>
          </div>
        </div>
      ),
    },
    {
      accessorKey: "volume24hUSD",
      header: () => <div className="text-right hidden lg:block">Volume (24h)</div>,
      cell: ({ row }) => (
        <div className="text-right hidden lg:block">
          {row.original.volume24hUSD !== undefined ? formatUSD(row.original.volume24hUSD) : <Skeleton className="inline-block h-4 w-16" />}
        </div>
      ),
    },
    {
      accessorKey: "fees24hUSD",
      header: () => <div className="text-right hidden xl:block">Fees (24h)</div>,
      cell: ({ row }) => (
        <div className="text-right hidden xl:block">
          {row.original.fees24hUSD !== undefined ? formatUSD(row.original.fees24hUSD) : <Skeleton className="inline-block h-4 w-12" />}
        </div>
      ),
    },
    {
      accessorKey: "tvlUSD",
      header: () => <div className="text-right">Liquidity</div>,
      cell: ({ row }) => (
        <div className="text-right">
          {row.original.tvlUSD !== undefined ? formatUSD(row.original.tvlUSD) : <Skeleton className="inline-block h-4 w-20" />}
        </div>
      ),
    },
    {
      accessorKey: "apr",
      header: () => <div className="text-right">Yield</div>,
      cell: ({ row }) => (
        <div className="text-right flex justify-end">
          {isAprLoaded(row.original.apr) ? (
            <div className="w-16 h-6 rounded-md bg-green-500/20 text-green-500 flex items-center justify-center">
              {row.original.apr}
            </div>
          ) : (
            <Skeleton className="h-4 w-16" />
          )}
        </div>
      ),
    },
  ], [loadingPositions]);

  const table = useReactTable({
    data: pools,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  const onPoolClick = (poolId: string) => router.push(`/liquidity/${poolId}`);

  if (isMobile) {
    return (
      <AppLayout>
        <MobileLiquidityList pools={pools} onSelectPool={onPoolClick} />
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col p-6 px-10">
        <div className="mb-6 mt-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold">Liquidity Pools</h2>
            <p className="text-sm text-muted-foreground">Explore and manage your liquidity positions.</p>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map(hg => (
                  <TableRow key={hg.id}>
                    {hg.headers.map(h => (
                      <TableHead key={h.id} className={h.column.id !== 'pair' ? 'text-right' : ''}>
                        {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map(row => (
                    <TableRow
                      key={row.id}
                      onClick={() => onPoolClick(row.original.id)}
                      className={`cursor-pointer transition-colors ${row.original.highlighted ? 'bg-accent/10 hover:bg-accent/15' : 'hover:bg-muted/10'}`}
                    >
                      {row.getVisibleCells().map(cell => (
                        <TableCell key={cell.id} className={cell.column.id !== 'pair' ? 'text-right' : ''}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-24 text-center">No pools available.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
