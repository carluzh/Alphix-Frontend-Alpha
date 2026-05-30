"use client";

import Image from "next/image";
import { cn, getTokenIcon, getTokenColor } from "@/lib/utils";
import type { NetworkMode } from "@/lib/network-mode";
import { formatNumber } from "./constants";

export function SectionContainer({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      "p-5 bg-container border border-sidebar-border rounded-lg flex flex-col gap-4",
      "w-full",
      className
    )}>
      {children}
    </div>
  );
}

export function StatusIndicator({ isInRange, isUnifiedYield }: { isInRange: boolean; isUnifiedYield?: boolean }) {
  // Unified Yield positions are always earning (managed by Hook)
  const label = isUnifiedYield ? "Earning" : (isInRange ? "In Range" : "Out of Range");
  const isPositive = isUnifiedYield || isInRange;

  return (
    <div className="flex items-center gap-1.5">
      <div className={cn(
        "w-2 h-2 rounded-full",
        isPositive ? "bg-green-500" : "bg-red-500"
      )} />
      <span className={cn(
        "text-sm",
        isPositive ? "text-green-500" : "text-red-500"
      )}>
        {label}
      </span>
    </div>
  );
}

export function UnifiedYieldBadge() {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border border-transparent hover:border-[#9896FF]/50 transition-colors"
      style={{ backgroundColor: "rgba(152, 150, 255, 0.10)", color: "#9896FF" }}
    >
      Unified Yield
    </span>
  );
}

export function DualBar({
  percent0,
  percent1,
  token0Symbol,
  token1Symbol,
  hoveredToken,
  onHover,
  networkMode,
}: {
  percent0: number;
  percent1: number;
  token0Symbol?: string;
  token1Symbol?: string;
  hoveredToken: 0 | 1 | null;
  onHover: (token: 0 | 1 | null) => void;
  networkMode: NetworkMode;
}) {
  const color0 = getTokenColor(token0Symbol, networkMode);
  const color1 = getTokenColor(token1Symbol, networkMode);

  return (
    <div className="flex h-2 w-full gap-1">
      <div
        className="h-full rounded-full transition-all duration-200 cursor-pointer"
        style={{
          width: `${percent0}%`,
          backgroundColor: color0,
          opacity: hoveredToken === 1 ? 0.3 : 1,
        }}
        onMouseEnter={() => onHover(0)}
        onMouseLeave={() => onHover(null)}
      />
      <div
        className="h-full rounded-full transition-all duration-200 cursor-pointer"
        style={{
          width: `${percent1}%`,
          backgroundColor: color1,
          opacity: hoveredToken === 0 ? 0.3 : 1,
        }}
        onMouseEnter={() => onHover(1)}
        onMouseLeave={() => onHover(null)}
      />
    </div>
  );
}

export function TokenRow({
  symbol,
  amount,
  isHovered,
  isMuted,
  onHover,
  networkMode,
}: {
  symbol: string;
  amount: string;
  isHovered: boolean;
  isMuted: boolean;
  onHover: (hovered: boolean) => void;
  networkMode: NetworkMode;
}) {
  const iconUrl = getTokenIcon(symbol, networkMode);

  return (
    <div
      className={cn(
        "flex items-center justify-between px-3 py-2.5 -mx-3 rounded-md transition-all cursor-pointer",
        isHovered ? "bg-muted/50" : "hover:bg-muted/40",
        isMuted && "opacity-40"
      )}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="flex items-center gap-2.5">
        <Image
          src={iconUrl}
          alt={symbol}
          width={24}
          height={24}
          className="rounded-full bg-background"
        />
        <span className="text-sm font-medium">{symbol}</span>
      </div>
      <span className="text-sm tabular-nums">
        {formatNumber(parseFloat(amount), { max: 6 })}
      </span>
    </div>
  );
}
