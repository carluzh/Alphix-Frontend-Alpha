"use client";

import { memo } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { PoolConfig } from "../../hooks";

interface PoolDetailHeaderProps {
  poolConfig: PoolConfig | null;
  loading?: boolean;
}

/**
 * Pool detail page header with breadcrumb navigation, pool title, and token logos.
 * Adapted from Uniswap's PoolDetailsHeader pattern.
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
        <div className="flex items-center gap-3 mt-2">
          <div className="w-8 h-8 rounded-full bg-muted/60 animate-pulse" />
          <div className="h-7 w-48 bg-muted/60 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb Navigation - no back arrow, clicking Pools navigates */}
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

      {/* Pool Title with Logos - more spacing from breadcrumb */}
      <div className="flex items-center gap-4 mt-1">
        {/* Double Token Logo */}
        <div className="relative w-14 h-8 flex-shrink-0">
          <div className="absolute top-0 left-0 w-8 h-8 rounded-full overflow-hidden bg-background border border-sidebar-border z-10">
            {token0?.icon && (
              <Image
                src={token0.icon}
                alt={token0.symbol}
                width={32}
                height={32}
                className="w-full h-full object-cover"
              />
            )}
          </div>
          <div className="absolute top-0 left-5 w-8 h-8 rounded-full overflow-hidden bg-background border border-sidebar-border z-20">
            {token1?.icon && (
              <Image
                src={token1.icon}
                alt={token1.symbol}
                width={32}
                height={32}
                className="w-full h-full object-cover"
              />
            )}
          </div>
        </div>

        {/* Pool Name and Badges */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-xl font-semibold" style={{ fontFamily: 'Inter, sans-serif' }}>
            {token0?.symbol} / {token1?.symbol}
          </h1>

          {/* Pool Type Badge */}
          {poolConfig.type && (
            <span className="px-2 py-0.5 text-xs font-medium rounded border border-sidebar-border/50 bg-muted/30 text-muted-foreground">
              {poolConfig.type}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
