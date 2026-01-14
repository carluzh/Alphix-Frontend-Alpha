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
        <span className="text-xs font-mono text-muted-foreground group-hover:text-foreground transition-colors">
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
 * LP Mode Card V1 - Unified Yield (Minimalist Design)
 *
 * Premium, understated design with clean typography focus.
 * Features subtle borders, transparent backgrounds, and elegant hover states.
 * Uses text styling accent instead of Aave icon for differentiation.
 */
export function UnifiedYieldCardV1({
  poolId,
  aaveApr,
}: {
  poolId: string;
  aaveApr?: number;
}) {
  return (
    <Link
      href={`/liquidity/add?pool=${poolId}&mode=rehypo&from=pool`}
      className="group flex items-center justify-between rounded-lg border border-sidebar-border/40 hover:border-sidebar-border transition-all duration-200 w-full bg-transparent hover:bg-muted/20 px-4 py-3.5"
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground tracking-tight">
            Unified Yield
          </span>
          {aaveApr !== undefined && (
            <span className="text-xs font-medium text-sidebar-primary/90">
              +{aaveApr.toFixed(1)}%
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground/70 font-light">
          Earn extra yield on idle liquidity
        </span>
      </div>

      <svg
        className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all duration-200"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

/**
 * LP Mode Card V1 - Custom Range (Minimalist Design)
 *
 * Clean, understated design matching the minimalist aesthetic.
 * Secondary option with refined, subtle hover states.
 */
export function CustomRangeCardV1({ poolId }: { poolId: string }) {
  return (
    <Link
      href={`/liquidity/add?pool=${poolId}&mode=concentrated&from=pool`}
      className="group flex items-center justify-between rounded-lg border border-sidebar-border/25 hover:border-sidebar-border/50 transition-all duration-200 w-full bg-transparent hover:bg-muted/10 px-4 py-3.5"
    >
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors duration-200 tracking-tight">
          Custom Range
        </span>
        <span className="text-xs text-muted-foreground/50 font-light">
          Set your own price range
        </span>
      </div>

      <svg
        className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 group-hover:translate-x-0.5 transition-all duration-200"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

/**
 * LP Mode Card V2 - Unified Yield (Gradient/Vibrant Design)
 *
 * Premium option with purple gradient background and animated hover effects.
 * Uses gradient coloring instead of Aave icon to indicate premium status.
 * Features smooth gradient border transitions and subtle glow on hover.
 */
export function UnifiedYieldCardV2({
  poolId,
  aaveApr,
}: {
  poolId: string;
  aaveApr?: number;
}) {
  return (
    <Link
      href={`/liquidity/add?pool=${poolId}&mode=rehypo&from=pool`}
      className="group relative flex items-center justify-between rounded-lg transition-all duration-300 w-full px-4 py-3.5 overflow-hidden"
      style={{
        background: "linear-gradient(135deg, rgba(152, 150, 255, 0.15) 0%, rgba(152, 150, 255, 0.08) 50%, rgba(152, 150, 255, 0.12) 100%)",
      }}
    >
      {/* Static gradient border */}
      <div
        className="absolute inset-0 rounded-lg pointer-events-none transition-opacity duration-300 opacity-100 group-hover:opacity-0"
        style={{
          background: "linear-gradient(135deg, #9896FF 0%, #7B79E6 50%, #9896FF 100%)",
          padding: "1px",
          mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          maskComposite: "exclude",
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
        }}
      />

      {/* Animated gradient border on hover */}
      <div
        className="absolute inset-0 rounded-lg pointer-events-none transition-opacity duration-300 opacity-0 group-hover:opacity-100 animate-gradient-flow"
        style={{
          background: "linear-gradient(90deg, #9896FF, #BDBBFF, #9896FF, #7B79E6, #9896FF)",
          backgroundSize: "300% 100%",
          padding: "1.5px",
          mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          maskComposite: "exclude",
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
        }}
      />

      {/* Subtle glow effect on hover */}
      <div
        className="absolute inset-0 rounded-lg pointer-events-none transition-opacity duration-500 opacity-0 group-hover:opacity-100"
        style={{
          background: "radial-gradient(ellipse at center, rgba(152, 150, 255, 0.15) 0%, transparent 70%)",
        }}
      />

      {/* Inner background */}
      <div
        className="absolute inset-[1px] rounded-[7px] transition-all duration-300"
        style={{
          background: "linear-gradient(135deg, #1a1a24 0%, #141418 50%, #18181f 100%)",
        }}
      />

      {/* Content */}
      <div className="relative flex items-center gap-3">
        {/* Gradient icon placeholder - sparkle/star to indicate premium */}
        <div
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-transform duration-300 group-hover:scale-105"
          style={{
            background: "linear-gradient(135deg, rgba(152, 150, 255, 0.25) 0%, rgba(152, 150, 255, 0.1) 100%)",
            border: "1px solid rgba(152, 150, 255, 0.3)",
          }}
        >
          <svg
            className="w-5 h-5 transition-all duration-300 group-hover:scale-110"
            style={{ color: "#9896FF" }}
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <path d="M12 2L14.09 8.26L20.18 9.27L15.54 13.14L16.81 19.02L12 16.23L7.19 19.02L8.46 13.14L3.82 9.27L9.91 8.26L12 2Z" />
          </svg>
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-foreground transition-colors">
            Add with Unified Yield
          </span>
          <span className="text-xs text-muted-foreground">
            Earn extra yield on idle liquidity
          </span>
        </div>
      </div>

      {/* APR Badge + Arrow */}
      <div className="relative flex items-center gap-2.5">
        {aaveApr !== undefined && (
          <span
            className="px-2.5 py-1 rounded-md text-xs font-bold transition-all duration-300 group-hover:scale-105"
            style={{
              background: "linear-gradient(135deg, rgba(152, 150, 255, 0.25) 0%, rgba(152, 150, 255, 0.15) 100%)",
              color: "#BDBBFF",
              border: "1px solid rgba(152, 150, 255, 0.2)",
            }}
          >
            +{aaveApr.toFixed(1)}%
          </span>
        )}
        <svg
          className="w-4 h-4 text-[#9896FF] group-hover:text-[#BDBBFF] group-hover:translate-x-0.5 transition-all duration-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
}

/**
 * LP Mode Card V2 - Custom Range (Gradient/Neutral Design)
 *
 * Secondary option with subtle gray gradient and smooth hover transitions.
 * Features animated gradient border on hover for visual consistency with V2 Unified.
 */
export function CustomRangeCardV2({ poolId }: { poolId: string }) {
  return (
    <Link
      href={`/liquidity/add?pool=${poolId}&mode=concentrated&from=pool`}
      className="group relative flex items-center justify-between rounded-lg transition-all duration-300 w-full px-4 py-3.5 overflow-hidden"
      style={{
        background: "linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.01) 100%)",
      }}
    >
      {/* Static border */}
      <div
        className="absolute inset-0 rounded-lg pointer-events-none transition-opacity duration-300 opacity-100 group-hover:opacity-0"
        style={{
          background: "linear-gradient(135deg, #3a3a3a 0%, #2a2a2a 50%, #353535 100%)",
          padding: "1px",
          mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          maskComposite: "exclude",
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
        }}
      />

      {/* Animated gradient border on hover */}
      <div
        className="absolute inset-0 rounded-lg pointer-events-none transition-opacity duration-300 opacity-0 group-hover:opacity-100 animate-gradient-flow"
        style={{
          background: "linear-gradient(90deg, #4a4a4a, #5a5a5a, #4a4a4a, #3a3a3a, #4a4a4a)",
          backgroundSize: "300% 100%",
          padding: "1px",
          mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          maskComposite: "exclude",
          WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
          WebkitMaskComposite: "xor",
        }}
      />

      {/* Inner background */}
      <div
        className="absolute inset-[1px] rounded-[7px] transition-all duration-300 group-hover:bg-[#1c1c1c]"
        style={{
          background: "linear-gradient(135deg, #161616 0%, #141414 50%, #171717 100%)",
        }}
      />

      {/* Content */}
      <div className="relative flex items-center gap-3">
        {/* Gradient icon placeholder - sliders/range icon */}
        <div
          className="flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-300 group-hover:scale-105"
          style={{
            background: "linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.03) 100%)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          <svg
            className="w-5 h-5 text-muted-foreground group-hover:text-foreground transition-colors duration-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
          </svg>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors duration-300">
            Add with Custom Range
          </span>
          <span className="text-xs text-muted-foreground/60 group-hover:text-muted-foreground/80 transition-colors duration-300">
            Set your own price range
          </span>
        </div>
      </div>

      {/* Arrow */}
      <div className="relative">
        <svg
          className="w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all duration-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
}

/**
 * LP Mode Card - Unified Yield (Pattern Design)
 * Features animated gradient border like /add flow + pattern background
 */
function UnifiedYieldCard({
  poolId,
  aaveApr,
}: {
  poolId: string;
  aaveApr?: number;
}) {
  return (
    <div className="group relative">
      {/* Animated gradient border */}
      <div
        className="absolute -inset-[1px] rounded-lg pointer-events-none animate-gradient-flow"
        style={{
          background: 'linear-gradient(45deg, #AAA8FF, #BDBBFF 25%, #9896FF 50%, #BDBBFF 75%, #AAA8FF 100%)',
          backgroundSize: '300% 100%',
        }}
      />
      <Link
        href={`/liquidity/add?pool=${poolId}&mode=rehypo&from=pool`}
        className="relative flex items-center justify-between rounded-lg transition-all w-full bg-[#141414] hover:bg-[#1a1a1a] px-4 py-3 border border-transparent overflow-hidden"
      >
        {/* Pattern overlay - fades on hover */}
        <span
          className="absolute inset-0 transition-opacity duration-200 group-hover:opacity-0 pointer-events-none"
          style={{
            backgroundImage: 'url(/pattern.svg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: 0.6,
          }}
        />

        {/* Content */}
        <div className="relative z-10 flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">
            Unified Yield
          </span>
          <span className="text-xs text-muted-foreground">
            Earn extra yield on idle liquidity
          </span>
        </div>

        {/* APR Badge + Arrow */}
        <div className="relative z-10 flex items-center gap-2">
          {aaveApr !== undefined && (
            <span
              className="px-2.5 py-1 rounded-md text-xs font-semibold"
              style={{ backgroundColor: '#9896FF', color: '#E2E0FF' }}
            >
              +{aaveApr.toFixed(1)}%
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
 * LP Mode Card V3 - Custom Range (Pattern Design)
 * Features pattern.svg background with fade on hover
 * Standard styling without the purple glow
 */
export function CustomRangeCardV3({ poolId }: { poolId: string }) {
  return (
    <Link
      href={`/liquidity/add?pool=${poolId}&mode=concentrated&from=pool`}
      className="group relative flex items-center justify-between rounded-lg border border-sidebar-border/50 hover:border-white/30 hover:brightness-110 transition-all w-full bg-[#141414] hover:bg-[#1a1a1a] px-4 py-3 overflow-hidden"
    >
      {/* Pattern overlay - fades on hover */}
      <span
        className="absolute inset-0 transition-opacity duration-200 group-hover:opacity-0 pointer-events-none"
        style={{
          backgroundImage: 'url(/pattern.svg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.4,
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col gap-0.5">
        <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
          Add with Custom Range
        </span>
        <span className="text-xs text-muted-foreground/60">
          Set your own price range
        </span>
      </div>

      {/* Arrow */}
      <svg
        className="relative z-10 w-4 h-4 text-muted-foreground/50 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all"
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
 * LP Mode Card V3B - Unified Yield (Compact Pattern Design)
 *
 * COMPACT variation of V3 Pattern design:
 * - Single line layout with title and APR badge on same row
 * - Reduced height (py-2.5 instead of py-3)
 * - No subtitle for cleaner, button-like appearance
 * - Retains pattern background with fade on hover
 * - Purple glow/tint for premium feel
 * - Arrow on right side
 */
export function UnifiedYieldCardV3B({
  poolId,
  aaveApr,
}: {
  poolId: string;
  aaveApr?: number;
}) {
  return (
    <Link
      href={`/liquidity/add?pool=${poolId}&mode=rehypo&from=pool`}
      className="group relative flex items-center justify-between rounded-lg border border-[#9896FF]/40 hover:border-[#9896FF]/70 hover:brightness-110 transition-all w-full bg-[#141414] hover:bg-[#1a1a1a] px-3.5 py-2.5 overflow-hidden"
      style={{
        boxShadow: '0 0 16px rgba(152, 150, 255, 0.06), inset 0 0 16px rgba(152, 150, 255, 0.02)',
      }}
    >
      {/* Pattern overlay - fades on hover */}
      <span
        className="absolute inset-0 transition-opacity duration-200 group-hover:opacity-0 pointer-events-none"
        style={{
          backgroundImage: 'url(/pattern.svg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.5,
        }}
      />
      {/* Subtle purple gradient overlay for special feel */}
      <span
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(135deg, rgba(152, 150, 255, 0.04) 0%, transparent 50%, rgba(152, 150, 255, 0.02) 100%)',
        }}
      />

      {/* Content - Single line with title and APR inline */}
      <div className="relative z-10 flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          Add with Unified Yield
        </span>
        {aaveApr !== undefined && (
          <span
            className="px-1.5 py-0.5 rounded text-[11px] font-semibold leading-none"
            style={{ backgroundColor: 'rgba(152, 150, 255, 0.2)', color: '#9896FF' }}
          >
            +{aaveApr.toFixed(1)}%
          </span>
        )}
      </div>

      {/* Arrow */}
      <svg
        className="relative z-10 w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all"
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
 * LP Mode Card V3C - Unified Yield (BOLD Pattern Design)
 *
 * A bolder, more prominent version of V3 - designed to be the primary CTA.
 * Features:
 * - Stronger purple border (/60 opacity, /90 on hover)
 * - Larger, bolder text (text-base for title)
 * - More prominent APR badge with stronger background
 * - Brighter purple glow on hover
 * - More visible pattern background
 * - Larger, more prominent arrow
 */
export function UnifiedYieldCardV3C({
  poolId,
  aaveApr,
}: {
  poolId: string;
  aaveApr?: number;
}) {
  return (
    <Link
      href={`/liquidity/add?pool=${poolId}&mode=rehypo&from=pool`}
      className="group relative flex items-center justify-between rounded-xl border-2 border-[#9896FF]/60 hover:border-[#9896FF]/90 hover:brightness-110 transition-all duration-300 w-full bg-[#141414] hover:bg-[#1a1a1a] px-5 py-4 overflow-hidden"
      style={{
        boxShadow: '0 0 30px rgba(152, 150, 255, 0.15), inset 0 0 25px rgba(152, 150, 255, 0.05)',
      }}
    >
      {/* Pattern overlay - more visible, fades on hover */}
      <span
        className="absolute inset-0 transition-opacity duration-300 group-hover:opacity-20 pointer-events-none"
        style={{
          backgroundImage: 'url(/pattern.svg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.8,
        }}
      />
      {/* Stronger purple gradient overlay for premium feel */}
      <span
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'linear-gradient(135deg, rgba(152, 150, 255, 0.1) 0%, transparent 40%, rgba(152, 150, 255, 0.08) 100%)',
        }}
      />
      {/* Hover glow effect - brighter purple */}
      <span
        className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(152, 150, 255, 0.12) 0%, transparent 70%)',
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col gap-1">
        <span className="text-base font-semibold text-foreground tracking-tight">
          Add with Unified Yield
        </span>
        <span className="text-sm text-muted-foreground">
          Earn extra yield on idle liquidity
        </span>
      </div>

      {/* APR Badge + Arrow */}
      <div className="relative z-10 flex items-center gap-3">
        {aaveApr !== undefined && (
          <span
            className="px-3 py-1 rounded-md text-sm font-bold tracking-tight"
            style={{
              backgroundColor: 'rgba(152, 150, 255, 0.3)',
              color: '#B8B6FF',
              boxShadow: '0 0 12px rgba(152, 150, 255, 0.25)',
            }}
          >
            +{aaveApr.toFixed(1)}%
          </span>
        )}
        <svg
          className="w-5 h-5 text-[#9896FF]/70 group-hover:text-[#B8B6FF] group-hover:translate-x-1 transition-all duration-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
}

/**
 * LP Mode Card V4 - Unified Yield (Outline/Bordered Design)
 *
 * Strong border focus with minimal fill. Purple/violet border (#9896FF)
 * that glows subtly on hover. Clean, modern button aesthetic.
 * - Sparkle icon on the left
 * - APR badge shown inline
 * - Arrow on the right
 */
export function UnifiedYieldCardV4({
  poolId,
  aaveApr,
}: {
  poolId: string;
  aaveApr?: number;
}) {
  return (
    <Link
      href={`/liquidity/add?pool=${poolId}&mode=rehypo&from=pool`}
      className="group relative flex items-center justify-between rounded-lg transition-all duration-200 w-full py-3 px-4 bg-transparent hover:bg-[#9896FF]/[0.04]"
      style={{
        border: '1.5px solid #9896FF',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 0 16px 0 rgba(152, 150, 255, 0.3), 0 0 4px 0 rgba(152, 150, 255, 0.2)';
        e.currentTarget.style.borderColor = '#AAA8FF';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.borderColor = '#9896FF';
      }}
    >
      {/* Left: Icon + Text */}
      <div className="flex items-center gap-3">
        {/* Sparkle Icon */}
        <div
          className="flex items-center justify-center w-8 h-8 rounded-md transition-colors group-hover:bg-[#9896FF]/15"
          style={{ backgroundColor: 'rgba(152, 150, 255, 0.08)' }}
        >
          <svg
            className="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            style={{ color: '#9896FF' }}
          >
            {/* Main sparkle */}
            <path
              d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z"
              fill="currentColor"
            />
            {/* Small sparkle top-right */}
            <path
              d="M19 3L19.5 5L21.5 5.5L19.5 6L19 8L18.5 6L16.5 5.5L18.5 5L19 3Z"
              fill="currentColor"
              opacity="0.7"
            />
            {/* Small sparkle bottom-left */}
            <path
              d="M5 16L5.5 18L7.5 18.5L5.5 19L5 21L4.5 19L2.5 18.5L4.5 18L5 16Z"
              fill="currentColor"
              opacity="0.7"
            />
          </svg>
        </div>
        <span
          className="text-sm font-medium transition-colors group-hover:brightness-110"
          style={{ color: '#9896FF' }}
        >
          Add with Unified Yield
        </span>
      </div>

      {/* Right: APR Badge + Arrow */}
      <div className="flex items-center gap-2.5">
        {aaveApr !== undefined && (
          <span
            className="px-2 py-0.5 rounded text-xs font-semibold transition-colors"
            style={{
              backgroundColor: 'rgba(152, 150, 255, 0.12)',
              color: '#9896FF',
              border: '1px solid rgba(152, 150, 255, 0.25)',
            }}
          >
            +{aaveApr.toFixed(1)}% APR
          </span>
        )}
        <svg
          className="w-4 h-4 transition-all duration-200 group-hover:translate-x-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          style={{ color: '#9896FF' }}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
}

/**
 * LP Mode Card V4 - Custom Range (Outline/Bordered Design)
 *
 * Neutral border that brightens on hover. Clean, modern button aesthetic
 * with minimal fill.
 * - Plus icon on the left
 * - Arrow on the right
 */
export function CustomRangeCardV4({ poolId }: { poolId: string }) {
  return (
    <Link
      href={`/liquidity/add?pool=${poolId}&mode=concentrated&from=pool`}
      className="group relative flex items-center justify-between rounded-lg transition-all duration-200 w-full py-3 px-4 bg-transparent hover:bg-white/[0.02]"
      style={{
        border: '1.5px solid rgba(255, 255, 255, 0.12)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
      }}
    >
      {/* Left: Icon + Text */}
      <div className="flex items-center gap-3">
        {/* Plus Icon */}
        <div className="flex items-center justify-center w-8 h-8 rounded-md bg-white/[0.04] group-hover:bg-white/[0.08] transition-colors">
          <svg
            className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
          </svg>
        </div>
        <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
          Add with Custom Range
        </span>
      </div>

      {/* Right: Arrow */}
      <svg
        className="w-4 h-4 text-muted-foreground/40 group-hover:text-muted-foreground group-hover:translate-x-0.5 transition-all duration-200"
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
 * LP Mode Card V3D - Add Liquidity (Minimal Pattern Design)
 *
 * A minimal, understated variation of the V3 pattern design.
 * - Neutral styling (no purple glow/tint by default)
 * - Very subtle pattern background (low opacity)
 * - Simple border that turns purple on hover
 * - Clean "Add Liquidity" title with subtle APR badge
 * - Premium through restraint, not effects
 */
export function UnifiedYieldCardV3D({
  poolId,
  aaveApr,
}: {
  poolId: string;
  aaveApr?: number;
}) {
  return (
    <Link
      href={`/liquidity/add?pool=${poolId}&mode=rehypo&from=pool`}
      className="group relative flex items-center justify-between rounded-lg border border-sidebar-border hover:border-[#9896FF]/60 transition-all duration-200 w-full bg-[#141414] px-4 py-3 overflow-hidden"
    >
      {/* Pattern overlay - very subtle, fades on hover */}
      <span
        className="absolute inset-0 transition-opacity duration-200 group-hover:opacity-0 pointer-events-none"
        style={{
          backgroundImage: 'url(/pattern.svg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          opacity: 0.25,
        }}
      />

      {/* Content */}
      <div className="relative z-10 flex items-center gap-3">
        <span className="text-sm font-medium text-foreground">
          Add Liquidity
        </span>
        {aaveApr !== undefined && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium text-muted-foreground bg-white/[0.04]">
            +{aaveApr.toFixed(1)}%
          </span>
        )}
      </div>

      {/* Arrow */}
      <svg
        className="relative z-10 w-4 h-4 text-muted-foreground/40 group-hover:text-[#9896FF] group-hover:translate-x-0.5 transition-all duration-200"
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
            <span className="text-xs text-muted-foreground">+</span>
            <PointsIcon className="w-3.5 h-3.5 text-muted-foreground" />
            Points
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
 * Custom Range Callout - Matches Points callout style
 */
function CustomRangeCallout({ poolId }: { poolId: string }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <Link
      href={`/liquidity/add?pool=${poolId}&mode=concentrated&from=pool`}
      className={cn(
        "bg-muted/20 border border-sidebar-border/40 rounded-lg px-3 py-1.5",
        "transition-all duration-150",
        isHovered && "bg-muted/30"
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">
          Create position with custom range
        </span>
        <svg
          className={cn(
            "w-3 h-3 text-muted-foreground transition-transform duration-100",
            isHovered && "translate-x-0.5"
          )}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
}

/**
 * PoolDetailSidebar
 *
 * Right column for pool detail page containing Pool Details
 * (Yield breakdown + Contracts). Add Liquidity is now in the header.
 */
export const PoolDetailSidebar = memo(function PoolDetailSidebar({
  poolConfig,
  poolApr,
  aaveApr,
  pointsMultiplier,
}: PoolDetailSidebarProps) {
  return (
    <div className="flex flex-col gap-4">
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
