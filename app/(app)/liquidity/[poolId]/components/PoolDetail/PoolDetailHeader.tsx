"use client";

import { memo } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PoolConfig } from "../../hooks";

interface PoolDetailHeaderProps {
  poolConfig: PoolConfig | null;
  loading?: boolean;
}

/**
 * Pool detail page header with breadcrumb navigation, pool title, token logos,
 * and New Position button. Styled like Position header (larger icons, badge underneath).
 * @see interface/apps/web/src/components/Pools/PoolDetails/PoolDetailsHeader.tsx
 */
export const PoolDetailHeader = memo(function PoolDetailHeader({
  poolConfig,
  loading,
}: PoolDetailHeaderProps) {
  const token0 = poolConfig?.tokens?.[0];
  const token1 = poolConfig?.tokens?.[1];

  if (loading || !poolConfig) {
    return (
      <div className="flex flex-col gap-4">
        {/* Breadcrumb skeleton */}
        <div className="flex items-center gap-2">
          <div className="h-4 w-16 bg-muted/60 rounded animate-pulse" />
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
          <div className="h-4 w-24 bg-muted/60 rounded animate-pulse" />
        </div>
        {/* Title skeleton */}
        <div className="flex items-center gap-4 mt-2">
          <div className="w-11 h-11 rounded-full bg-muted/60 animate-pulse" />
          <div className="flex flex-col gap-2">
            <div className="h-7 w-48 bg-muted/60 rounded animate-pulse" />
            <div className="h-5 w-16 bg-muted/60 rounded animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb Navigation */}
      <nav className="flex items-center gap-1.5 text-sm" aria-label="breadcrumb">
        <Link
          href="/liquidity"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          Pools
        </Link>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <span className="text-foreground font-medium">
          {token0?.symbol} / {token1?.symbol}
        </span>
      </nav>

      {/* Pool Title Row: Logos + Name/Badge + New Position Button */}
      <div className="flex items-center justify-between gap-4 mt-1">
        <div className="flex items-center gap-4">
          {/* Double Token Logo - Larger (44px like Position header) */}
          <div className="relative w-[68px] h-11 flex-shrink-0">
            <div className="absolute top-0 left-0 w-11 h-11 rounded-full overflow-hidden bg-background border border-sidebar-border z-10">
              {token0?.icon && (
                <Image
                  src={token0.icon}
                  alt={token0.symbol}
                  width={44}
                  height={44}
                  className="w-full h-full object-cover"
                />
              )}
            </div>
            <div className="absolute top-0 left-6 w-11 h-11 rounded-full overflow-hidden bg-background border border-sidebar-border z-20">
              {token1?.icon && (
                <Image
                  src={token1.icon}
                  alt={token1.symbol}
                  width={44}
                  height={44}
                  className="w-full h-full object-cover"
                />
              )}
            </div>
          </div>

          {/* Pool Name and Badge - Stacked vertically (like Position header) */}
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold" style={{ fontFamily: 'Inter, sans-serif' }}>
              {token0?.symbol} / {token1?.symbol}
            </h1>

            {/* Pool Type Badge - Below title */}
            {poolConfig.type && (
              <span className="w-fit px-2 py-0.5 text-xs font-medium rounded border border-sidebar-border/50 bg-muted/30 text-muted-foreground">
                {poolConfig.type}
              </span>
            )}
          </div>
        </div>

        {/* New Position Button */}
        <Button
          asChild
          className="h-10 px-4 gap-2 bg-button-primary hover-button-primary text-sidebar-primary font-semibold rounded-md transition-all active:scale-[0.98]"
        >
          <Link href={`/liquidity/add?pool=${poolConfig.id}&from=pool`}>
            <Plus className="h-4 w-4" strokeWidth={2.5} />
            New position
          </Link>
        </Button>
      </div>
    </div>
  );
});
