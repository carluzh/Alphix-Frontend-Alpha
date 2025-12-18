"use client";

import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Pool } from "@/types"; // Import the centralized Pool type

interface MobileLiquidityListProps {
  pools: Pool[];
  onSelectPool: (poolId: string) => void;
}

// Helper function to format USD values, similar to the one in app/liquidity/page.tsx
const formatUSD = (value: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0.00";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const fmt = (v: number) => `${sign}$${v.toFixed(2)}`;

  if (abs >= 1_000_000_000) return `${fmt(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${fmt(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${fmt(abs / 1_000)}K`;
  return `${sign}$${abs.toFixed(2)}`;
};

export function MobileLiquidityList({ pools, onSelectPool }: MobileLiquidityListProps) {
  if (!pools || pools.length === 0) {
    return <div className="p-4 text-center text-muted-foreground">No pools available.</div>;
  }

  return (
    <div className="space-y-3">
      {pools.map((pool) => (
        <Card
          key={pool.id}
          onClick={() => onSelectPool(pool.id)}
          className="cursor-pointer bg-muted/30 border border-sidebar-border/60 hover:bg-muted/40 transition-colors"
        >
          <CardHeader className="space-y-0 flex flex-row items-center justify-between py-3 px-3">
            <div className="flex items-center">
              <div className="relative w-14 h-8">
                <div className="absolute top-0 left-0 w-8 h-8 rounded-full overflow-hidden bg-background border border-border/50">
                  <Image
                    src={pool.tokens[0].icon}
                    alt={pool.tokens[0].symbol}
                    width={32}
                    height={32}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="absolute top-0 left-3 w-8 h-8 rounded-full overflow-hidden bg-background border border-border/50">
                  <Image
                    src={pool.tokens[1].icon}
                    alt={pool.tokens[1].symbol}
                    width={32}
                    height={32}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
              <CardTitle className="text-sm font-semibold">{pool.pair}</CardTitle>
            </div>
            {pool.apr && pool.apr !== "Loading..." ? (
              <div className="bg-green-500/20 text-green-500 text-[11px] px-2 py-1 rounded-md font-medium">
                {pool.apr}
              </div>
            ) : (
              <div className="bg-muted/60 h-5 w-12 rounded-md animate-pulse"></div>
            )}
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-1.5">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <div className="text-muted-foreground">Volume (24h)</div>
              <div className="text-right text-foreground font-medium">
                {typeof pool.volume24hUSD === 'number' ? formatUSD(pool.volume24hUSD) : pool.volume24h === "Loading..." ? (
                  <div className="inline-block h-3 w-16 bg-muted/60 rounded animate-pulse"></div>
                ) : (
                  pool.volume24h
                )}
              </div>

              <div className="text-muted-foreground">TVL</div>
              <div className="text-right text-foreground font-medium">
                {typeof pool.tvlUSD === 'number' ? formatUSD(pool.tvlUSD) : pool.liquidity === "Loading..." ? (
                  <div className="inline-block h-3 w-16 bg-muted/60 rounded animate-pulse"></div>
                ) : (
                  pool.liquidity
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
} 