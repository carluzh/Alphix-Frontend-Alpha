"use client";

import { memo, useState, useCallback, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { cn, shortenAddress } from "@/lib/utils";
import { IconClone2, IconCheck } from "nucleo-micro-bold-essential";
import { PointsIcon } from "@/components/PointsIcons/PointsIcon";
import type { PoolConfig } from "../../hooks";

// Yield source branding
const YIELD_SOURCE = {
  name: "Aave",
  textLogo: "/aave/Logo-light.png",
};

/** Shorten any hex string (for pool IDs, hashes that aren't valid addresses) */
const shortenHex = (hex: string, chars = 4): string => {
  if (!hex) return "";
  return `${hex.slice(0, chars + 2)}...${hex.slice(-chars)}`;
};

/**
 * Copyable text row with hover-to-reveal copy icon
 * Icon takes 0 width normally, expands on hover (like Overview MiniTokensTable arrow)
 * Styled to match YieldBreakdownSection rows
 */
function CopyableRow({
  label,
  value,
  displayValue,
}: {
  label: string;
  value: string;
  displayValue?: string;
}) {
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (isCopied) {
      const timer = setTimeout(() => setIsCopied(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [isCopied]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setIsCopied(true);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [value]);

  return (
    <div
      className="group flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer"
      onClick={handleCopy}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center">
        <span className="text-xs font-mono text-foreground group-hover:opacity-80 transition-opacity">
          {displayValue || shortenAddress(value)}
        </span>
        {/* Copy icon - 0 width normally, expands on hover */}
        <div className="relative w-0 group-hover:w-3.5 h-3.5 ml-0 group-hover:ml-1.5 overflow-hidden transition-all duration-200">
          <IconClone2
            width={14}
            height={14}
            className={cn(
              "absolute inset-0 text-muted-foreground transition-all duration-200",
              isCopied ? "opacity-0 translate-y-1" : "opacity-100 translate-y-0"
            )}
          />
          <IconCheck
            width={14}
            height={14}
            className={cn(
              "absolute inset-0 text-green-500 transition-all duration-200",
              isCopied ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
            )}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * LP Mode Card - Unified Yield (Featured)
 * Button-like appearance with animated gradient border
 */
function UnifiedYieldCard({
  poolId,
  extraApr,
}: {
  poolId: string;
  extraApr?: number;
}) {
  return (
    <div className="group relative">
      {/* Animated gradient border - always visible like selected state */}
      <div
        className="absolute -inset-[1px] rounded-lg pointer-events-none animate-gradient-flow"
        style={{
          background:
            "linear-gradient(45deg, #AAA8FF, #BDBBFF 25%, #9896FF 50%, #BDBBFF 75%, #AAA8FF 100%)",
          backgroundSize: "300% 100%",
        }}
      />
      <Link
        href={`/liquidity/add?pool=${poolId}&mode=rehypo&from=pool`}
        className="relative flex items-center justify-between rounded-lg transition-all w-full bg-[#141414] hover:bg-[#1a1a1a] px-4 py-3 border border-transparent"
      >
        <div className="flex items-center gap-3">
          {/* Aave logo */}
          <div
            className="flex items-center justify-center w-8 h-8 rounded-md"
            style={{ backgroundColor: "rgba(152, 150, 255, 0.15)" }}
          >
            <Image
              src={YIELD_SOURCE.textLogo}
              alt={YIELD_SOURCE.name}
              width={20}
              height={20}
              className="object-contain"
            />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">
              Add with Unified Yield
            </span>
            <span className="text-xs text-muted-foreground">
              Earn extra yield on idle liquidity
            </span>
          </div>
        </div>

        {/* APR Badge + Arrow */}
        <div className="flex items-center gap-2">
          {extraApr !== undefined && (
            <span
              className="px-2 py-0.5 rounded text-xs font-semibold"
              style={{ backgroundColor: "rgba(152, 150, 255, 0.2)", color: "#9896FF" }}
            >
              +{extraApr.toFixed(1)}%
            </span>
          )}
          <svg
            className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </Link>
    </div>
  );
}

/**
 * LP Mode Card - Custom Range (Secondary, muted)
 */
function CustomRangeCard({ poolId }: { poolId: string }) {
  return (
    <Link
      href={`/liquidity/add?pool=${poolId}&mode=concentrated&from=pool`}
      className="group flex items-center justify-between rounded-lg border transition-all w-full bg-[#141414] hover:bg-[#1a1a1a] py-3 px-4 border-sidebar-border/40 hover:border-sidebar-border/60"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
          Add with Custom Range
        </span>
        <span className="text-xs text-muted-foreground/60">
          Set your own price range
        </span>
      </div>
      <svg
        className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

/**
 * Yield Breakdown Section
 * Shows breakdown of where yield comes from - table style with hover rows
 */
function YieldBreakdownSection({
  poolApr,
  aaveApr,
  pointsMultiplier,
}: {
  poolApr?: number;
  aaveApr?: number;
  pointsMultiplier?: number;
}) {
  const totalApr = (poolApr ?? 0) + (aaveApr ?? 0);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-sidebar-border/60 p-4 pb-2">
      <h4 className="text-sm font-semibold text-foreground">Yield Breakdown</h4>
      <div className="flex flex-col -mx-2">
        <div className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/40 transition-colors">
          <span className="text-xs text-muted-foreground">Swap APR</span>
          <span className="text-xs font-mono text-foreground">
            {poolApr !== undefined ? `${poolApr.toFixed(2)}%` : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/40 transition-colors">
          <span className="text-xs text-muted-foreground">Unified Yield</span>
          <span className="text-xs font-mono text-foreground">
            {aaveApr !== undefined ? `${aaveApr.toFixed(2)}%` : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/40 transition-colors">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <PointsIcon className="w-3.5 h-3.5 text-muted-foreground" />
            Points APR
          </span>
          <span className="text-xs font-mono text-foreground">
            {pointsMultiplier !== undefined ? `${pointsMultiplier.toFixed(1)}x` : "—"}
          </span>
        </div>
        <div className="border-t border-sidebar-border/40 mx-2 my-1" />
        <div className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/40 transition-colors">
          <span className="text-xs font-medium text-foreground">Total APR</span>
          <span className="text-xs font-mono font-medium text-foreground">
            ~{totalApr.toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Contracts Section
 * Shows copyable contract addresses - matches Yield Breakdown styling
 */
function ContractsSection({ poolConfig }: { poolConfig: PoolConfig }) {
  const token0 = poolConfig.tokens[0];
  const token1 = poolConfig.tokens[1];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-sidebar-border/60 p-4 pb-2">
      <h4 className="text-sm font-semibold text-foreground">Contracts</h4>
      <div className="flex flex-col -mx-2">
        {poolConfig.subgraphId && (
          <CopyableRow
            label="Pool ID"
            value={poolConfig.subgraphId}
            displayValue={shortenHex(poolConfig.subgraphId)}
          />
        )}
        {token0 && (
          <CopyableRow label={token0.symbol} value={token0.address} />
        )}
        {token1 && (
          <CopyableRow label={token1.symbol} value={token1.address} />
        )}
        {poolConfig.hooks && (
          <CopyableRow label="ERC-4626 Vault" value={poolConfig.hooks} />
        )}
      </div>
    </div>
  );
}

interface PoolDetailSidebarProps {
  poolConfig: PoolConfig;
  poolApr?: number;
  aaveApr?: number;
  pointsMultiplier?: number;
}

/**
 * PoolDetailSidebar
 *
 * Right column for pool detail page containing:
 * 1. Add Liquidity options (Unified Yield + Custom Range)
 * 2. Pool Details (Yield breakdown + Contracts)
 */
export const PoolDetailSidebar = memo(function PoolDetailSidebar({
  poolConfig,
  poolApr,
  aaveApr = 2.5, // TODO: Fetch from API
  pointsMultiplier = 2.0, // TODO: Fetch from API
}: PoolDetailSidebarProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Add Liquidity Section */}
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-foreground">
          Add Liquidity
        </h3>
        <div className="flex flex-col gap-2">
          <UnifiedYieldCard poolId={poolConfig.id} extraApr={aaveApr} />
          <CustomRangeCard poolId={poolConfig.id} />
        </div>
      </div>

      {/* Pool Details Section */}
      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-foreground">
          Pool Details
        </h3>
        <div className="flex flex-col gap-3">
          <YieldBreakdownSection poolApr={poolApr} aaveApr={aaveApr} pointsMultiplier={pointsMultiplier} />
          <ContractsSection poolConfig={poolConfig} />
        </div>
      </div>
    </div>
  );
});

export default PoolDetailSidebar;
