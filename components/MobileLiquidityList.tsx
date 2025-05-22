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
  if (value < 0.01 && value > 0) return "< $0.01"; // Handle very small positive values
  if (value === 0) return "$0.00";
  if (Math.abs(value) < 0.01) return "< $0.01"; // For small negative values if they ever occur
  if (Math.abs(value) < 1000) return `$${value.toFixed(2)}`;
  return `$${(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export function MobileLiquidityList({ pools, onSelectPool }: MobileLiquidityListProps) {
  if (!pools || pools.length === 0) {
    return <div className="p-4 text-center text-muted-foreground">No pools available.</div>;
  }

  return (
    <div className="space-y-4 p-4">
      <div className="mb-4 px-4">
        <h2 className="text-xl font-semibold">Liquidity Pools</h2>
        <p className="text-sm text-muted-foreground">
          Explore and manage your liquidity positions.
        </p>
      </div>
      {pools.map((pool) => (
        <Card 
          key={pool.id} 
          onClick={() => onSelectPool(pool.id)} 
          className="cursor-pointer hover:bg-muted/10 transition-colors bg-card/80 border-border/70"
        >
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
            <div className="flex items-center gap-2">
              <div className="relative w-12 h-6"> {/* Slightly smaller icons for mobile list view */}
                <div className="absolute top-0 left-0 w-6 h-6 rounded-full overflow-hidden bg-background border border-border/50">
                  <Image 
                    src={pool.tokens[0].icon} 
                    alt={pool.tokens[0].symbol} 
                    width={24} 
                    height={24} 
                    className="w-full h-full object-cover" 
                  />
                </div>
                <div className="absolute top-0 left-3 w-6 h-6 rounded-full overflow-hidden bg-background border border-border/50">
                  <Image 
                    src={pool.tokens[1].icon} 
                    alt={pool.tokens[1].symbol} 
                    width={24} 
                    height={24} 
                    className="w-full h-full object-cover" 
                  />
                </div>
              </div>
              <CardTitle className="text-base font-semibold">{pool.pair}</CardTitle>
            </div>
            <Badge className="bg-[#e85102]/20 text-[#e85102] rounded-md hover:bg-[#e85102]/20">
              {pool.apr}
            </Badge>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-2">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="text-muted-foreground">Volume (24h)</div>
              <div className="text-right font-medium">
                {typeof pool.volume24hUSD === 'number' 
                  ? formatUSD(pool.volume24hUSD) 
                  : pool.volume24h}
              </div>
              
              <div className="text-muted-foreground">Liquidity</div>
              <div className="text-right font-medium">
                {typeof pool.tvlUSD === 'number' 
                  ? formatUSD(pool.tvlUSD) 
                  : pool.liquidity}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
} 