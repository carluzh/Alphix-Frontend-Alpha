"use client";

import { memo, useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ChevronRight, Plus, Minus } from "lucide-react";
import { PointsIcon } from "@/components/PointsIcons";
import { DenominationToggle } from "@/components/liquidity/DenominationToggle";
import { LendingSourceIcons } from "@/components/liquidity/APRBreakdownTooltip";
import { CurrencyAmount, Price, Currency } from "@uniswap/sdk-core";
import { Position as V4Position } from "@uniswap/v4-sdk";
import { Button } from "@/components/ui/button";
import { cn, getTokenIcon, getTokenColor } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatNumber } from "@/lib/format";
import { getDecimalsForDenomination } from "@/lib/denomination-utils";
import type { PoolConfig } from "@/lib/pools-config";
import type { LPType, ChartDuration, PositionInfo, PoolStateData } from "../../hooks";
import dynamic from "next/dynamic";
import { usePositionFeeChartData, useUnifiedYieldChartData, type ChartPeriod } from "../../hooks";
import type { TimePeriod } from "../PriceChartSection";

// Chart skeleton for dynamic import loading - matches chart height (380px) to prevent CLS
const CHART_HEIGHT_PX = 380;
const PRICE_SCALE_WIDTH = 70;
const TIME_SCALE_HEIGHT = 26;

function ChartLoadingSkeleton() {
  const dotPattern = `radial-gradient(circle, #333333 1px, transparent 1px)`;
  return (
    <div className="flex flex-col gap-4">
      <div className="relative" style={{ height: CHART_HEIGHT_PX }}>
        <div
          className="absolute pointer-events-none"
          style={{
            top: 0,
            left: 0,
            right: PRICE_SCALE_WIDTH,
            bottom: TIME_SCALE_HEIGHT,
            backgroundImage: dotPattern,
            backgroundSize: "24px 24px",
          }}
        />
        <div className="flex flex-row absolute w-full gap-2 items-start z-10">
          <div className="flex flex-col gap-1 p-3 pointer-events-none bg-background rounded-xl">
            <div className="h-9 w-24 bg-muted/20 animate-pulse rounded" />
            <div className="h-4 w-32 bg-muted/10 animate-pulse rounded" />
          </div>
        </div>
      </div>
      {/* Time period selector skeleton */}
      <div className="flex flex-row items-center gap-1 opacity-50">
        {["1W", "1M", "1Y", "ALL"].map((opt) => (
          <div key={opt} className="h-7 px-2.5 text-xs rounded-md bg-muted/20 text-muted-foreground">
            {opt}
          </div>
        ))}
      </div>
    </div>
  );
}

const PriceChartSection = dynamic(
  () => import("../PriceChartSection").then(mod => mod.PriceChartSection),
  { ssr: false, loading: () => <ChartLoadingSkeleton /> }
);
const YieldChartSection = dynamic(
  () => import("../YieldChartSection").then(mod => mod.YieldChartSection),
  { ssr: false, loading: () => <ChartLoadingSkeleton /> }
);
import type { ProcessedPosition } from "@/pages/api/liquidity/get-positions";
import { IncreaseLiquidityModal } from "@/components/liquidity/increase/IncreaseLiquidityModal";
import { DecreaseLiquidityModal } from "@/components/liquidity/decrease/DecreaseLiquidityModal";
import { CollectFeesModal } from "@/components/liquidity/collect/CollectFeesModal";
import {
  adaptUnifiedYieldToProcessedPosition,
  type UnifiedYieldPosition,
} from "@/lib/liquidity/unified-yield";
import { useNetwork } from "@/lib/network-context";
import { usePriceDeviation, requiresDeviationAcknowledgment } from "@/hooks/usePriceDeviation";
import { PriceDeviationCallout } from "@/components/ui/PriceDeviationCallout";
import { HighRiskConfirmModal, createPriceDeviationWarning } from "@/components/ui/HighRiskConfirmModal";

// ============================================================================
// Types
// ============================================================================

export interface PositionDetailProps {
  tokenId: string;
  // Position data
  position: V4Position | null;
  positionInfo: PositionInfo | null;
  unifiedYieldPosition: UnifiedYieldPosition | null;
  isLoading: boolean;
  error: Error | null;
  // Pool data
  poolConfig: PoolConfig | null;
  poolState: PoolStateData | null;
  // Token amounts
  currency0Amount: CurrencyAmount<Currency> | null;
  currency1Amount: CurrencyAmount<Currency> | null;
  // USD values
  fiatValue0: number | null;
  fiatValue1: number | null;
  totalPositionValue: number | null;
  // Fees
  fee0Amount: CurrencyAmount<Currency> | null;
  fee1Amount: CurrencyAmount<Currency> | null;
  fiatFeeValue0: number | null;
  fiatFeeValue1: number | null;
  totalFeesValue: number | null;
  // Price info
  currentPrice: Price<Currency, Currency> | null;
  currentPriceNumeric: number | null;
  priceInverted: boolean;
  setPriceInverted: (inverted: boolean) => void;
  // Range display
  minPrice: string;
  maxPrice: string;
  tokenASymbol?: string;
  tokenBSymbol?: string;
  isFullRange?: boolean;
  isInRange: boolean;
  // APR data
  poolApr: number | null;
  aaveApr: number | null;
  totalApr: number | null;
  // LP Type
  lpType: LPType;
  // Chart
  chartDuration: ChartDuration;
  setChartDuration: (duration: ChartDuration) => void;
  chartData: { time: number; value: number }[];
  isLoadingChart: boolean;
  // Denomination
  effectiveDenominationBase: boolean;
  handleDenominationToggle: () => void;
  // Ownership
  isOwner: boolean;
  // Actions
  refetch: () => void;
  // Navigation origin (for breadcrumb)
  fromPage: "overview" | "pool" | null;
}

// ============================================================================
// Sub-Components
// ============================================================================

function SectionContainer({ children, className }: { children: React.ReactNode; className?: string }) {
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

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-3 sm:p-6 w-full max-w-[1200px] mx-auto animate-pulse">
      <div className="h-8 w-48 bg-muted/40 rounded" />
      <div className="flex flex-col xl:flex-row gap-10">
        <div className="flex-1 flex flex-col gap-6 w-full">
          <div className="h-12 bg-muted/40 rounded" />
          <div className="h-[380px] bg-muted/20 rounded-lg" />
          <div className="h-24 bg-muted/40 rounded-lg" />
        </div>
        <div className="flex flex-col gap-5 w-full xl:w-[380px]">
          <div className="h-48 bg-muted/40 rounded-lg" />
          <div className="h-48 bg-muted/40 rounded-lg" />
          <div className="h-36 bg-muted/40 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

function StatusIndicator({ isInRange, isUnifiedYield }: { isInRange: boolean; isUnifiedYield?: boolean }) {
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

function UnifiedYieldBadge() {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border border-transparent hover:border-[#9896FF]/50 transition-colors"
      style={{ backgroundColor: "rgba(152, 150, 255, 0.10)", color: "#9896FF" }}
    >
      Unified Yield
    </span>
  );
}

function DualBar({
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
  networkMode: "mainnet" | "testnet";
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

function TokenRow({
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
  networkMode: "mainnet" | "testnet";
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


// ============================================================================
// Section Components
// ============================================================================

function PositionHeader({
  poolConfig,
  lpType,
  isInRange,
  isOwner,
  hasFees,
  onAddLiquidity,
  onRemoveLiquidity,
  onCollectFees,
  networkMode,
  fromPage,
}: {
  poolConfig: PoolConfig;
  lpType: LPType;
  isInRange: boolean;
  isOwner: boolean;
  hasFees: boolean;
  onAddLiquidity: () => void;
  onRemoveLiquidity: () => void;
  onCollectFees: () => void;
  networkMode: "mainnet" | "testnet";
  fromPage: "overview" | "pool" | null;
}) {
  const token0Icon = getTokenIcon(poolConfig.currency0.symbol, networkMode);
  const token1Icon = getTokenIcon(poolConfig.currency1.symbol, networkMode);
  const poolName = `${poolConfig.currency0.symbol} / ${poolConfig.currency1.symbol}`;

  // Determine breadcrumb based on origin
  const breadcrumbLink = fromPage === "pool"
    ? `/liquidity/${poolConfig.id}`
    : "/overview";
  const breadcrumbLabel = fromPage === "pool" ? poolName : "Overview";

  return (
    <div className="flex flex-col gap-4">
      {/* Breadcrumb Navigation */}
      <nav className="flex items-center gap-1.5 text-sm" aria-label="breadcrumb">
        <Link
          href={breadcrumbLink}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          {breadcrumbLabel}
        </Link>
        <ChevronRight className="h-3 w-3 text-muted-foreground" />
        <span className="text-foreground font-medium">
          {fromPage === "pool" ? "Position" : poolName}
        </span>
      </nav>

      {/* Title Row with Actions - spans full width */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-1">
        {/* Left side - title */}
        <div className="flex items-center gap-4">
          {/* Double Token Logo - 44px like PoolDetail header */}
          <div className="relative w-[68px] h-11 flex-shrink-0">
            <div className="absolute top-0 left-0 w-11 h-11 rounded-full overflow-hidden bg-background border border-sidebar-border z-10">
              <Image
                src={token0Icon}
                alt={poolConfig.currency0.symbol}
                width={44}
                height={44}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="absolute top-0 left-6 w-11 h-11 rounded-full overflow-hidden bg-background border border-sidebar-border z-20">
              <Image
                src={token1Icon}
                alt={poolConfig.currency1.symbol}
                width={44}
                height={44}
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          {/* Token Pair Name and Badge - Stacked vertically like PoolDetail */}
          <div className="flex flex-col gap-1">
            <Link
              href={`/liquidity/${poolConfig.id}`}
              className="text-xl font-semibold hover:text-muted-foreground transition-colors"
              style={{ fontFamily: 'Inter, sans-serif' }}
            >
              {poolConfig.currency0.symbol} / {poolConfig.currency1.symbol}
            </Link>
            <div className="flex items-center gap-2">
              <StatusIndicator isInRange={isInRange} isUnifiedYield={lpType === "rehypo"} />
              {lpType === "rehypo" && <UnifiedYieldBadge />}
            </div>
          </div>
        </div>

        {/* Right side - Action Buttons */}
        {isOwner && (
          <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
            {/* Add Liquidity - Pattern style */}
            <button
              onClick={onAddLiquidity}
              className="group relative rounded-md border border-sidebar-border bg-button h-9 px-4 text-sm font-medium text-foreground hover:bg-accent hover:brightness-110 hover:border-white/30 transition-all overflow-hidden"
            >
              <span
                className="absolute inset-0 transition-opacity duration-200 group-hover:opacity-0"
                style={{ backgroundImage: 'url(/patterns/button-default.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
              />
              <span className="relative z-10">Add liquidity</span>
            </button>
            {/* Remove Liquidity - Same pattern style */}
            <button
              onClick={onRemoveLiquidity}
              className="group relative rounded-md border border-sidebar-border bg-button h-9 px-4 text-sm font-medium text-foreground hover:bg-accent hover:brightness-110 hover:border-white/30 transition-all overflow-hidden"
            >
              <span
                className="absolute inset-0 transition-opacity duration-200 group-hover:opacity-0"
                style={{ backgroundImage: 'url(/patterns/button-default.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
              />
              <span className="relative z-10">Remove liquidity</span>
            </button>
            {/* Collect Fees - Only visible if there are fees */}
            {hasFees && (
              <Button
                onClick={onCollectFees}
                size="sm"
                className="h-9 px-4 font-medium bg-button-primary border border-sidebar-primary text-sidebar-primary hover-button-primary"
              >
                Collect fees
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Thresholds for detecting full range edge cases
const MIN_PRICE_THRESHOLD = 1e-20;
const MAX_PRICE_THRESHOLD = 1e30;

function PriceRangeSection({
  minPrice,
  maxPrice,
  tokenASymbol,
  tokenBSymbol,
  isFullRange,
  currentPriceNumeric,
  priceInverted,
  poolType,
}: {
  minPrice: string;
  maxPrice: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  isFullRange: boolean;
  currentPriceNumeric: number | null;
  priceInverted: boolean;
  poolType?: string;
}) {
  const priceLabel = `${tokenASymbol} per ${tokenBSymbol}`;

  // Parse numeric values to detect edge cases (fallback when isFullRange detection fails)
  const minNum = parseFloat(minPrice);
  const maxNum = parseFloat(maxPrice);
  const isMinExtreme = minNum < MIN_PRICE_THRESHOLD || !isFinite(minNum);
  const isMaxExtreme = maxNum > MAX_PRICE_THRESHOLD || !isFinite(maxNum);

  // Display values with edge case handling
  const displayMin = isFullRange || isMinExtreme ? "0" : minPrice;
  const displayMax = isFullRange || isMaxExtreme ? "∞" : maxPrice;

  // Format current price using the same approach as Step 2 (Add Liquidity wizard)
  const formattedCurrentPrice = useMemo(() => {
    if (currentPriceNumeric === null) return "—";
    const displayPrice = priceInverted ? 1 / currentPriceNumeric : currentPriceNumeric;
    if (!isFinite(displayPrice) || displayPrice <= 0) return "—";
    // tokenASymbol is the denomination/quote token (e.g., "USDC" in "USDC per ETH")
    const displayDecimals = getDecimalsForDenomination(tokenASymbol, poolType);
    return displayPrice.toLocaleString("en-US", {
      minimumFractionDigits: displayDecimals,
      maximumFractionDigits: displayDecimals,
    });
  }, [currentPriceNumeric, priceInverted, tokenASymbol, poolType]);

  return (
    <div className="flex flex-col gap-4 p-4 bg-container border border-sidebar-border rounded-lg">
      <div className="grid grid-cols-3 gap-2 sm:gap-4">
        <div className="text-center min-w-0">
          <div className="text-xs text-muted-foreground mb-1">Min Price</div>
          <div className="font-semibold text-sm truncate">{displayMin}</div>
          <div className="text-xs text-muted-foreground truncate">{priceLabel}</div>
        </div>
        <div className="text-center min-w-0">
          <div className="text-xs text-muted-foreground mb-1">Current Price</div>
          <div className="font-semibold text-sm truncate">{formattedCurrentPrice}</div>
          <div className="text-xs text-muted-foreground truncate">{priceLabel}</div>
        </div>
        <div className="text-center min-w-0">
          <div className="text-xs text-muted-foreground mb-1">Max Price</div>
          <div className="font-semibold text-sm truncate">{displayMax}</div>
          <div className="text-xs text-muted-foreground truncate">{priceLabel}</div>
        </div>
      </div>
    </div>
  );
}

function PositionValueSection({
  currency0Amount,
  currency1Amount,
  fiatValue0,
  fiatValue1,
  totalPositionValue,
  token0Symbol,
  token1Symbol,
  networkMode,
}: {
  currency0Amount: CurrencyAmount<Currency> | null;
  currency1Amount: CurrencyAmount<Currency> | null;
  fiatValue0: number | null;
  fiatValue1: number | null;
  totalPositionValue: number | null;
  token0Symbol: string;
  token1Symbol: string;
  networkMode: "mainnet" | "testnet";
}) {
  const [hoveredToken, setHoveredToken] = useState<0 | 1 | null>(null);

  const percent0 = useMemo(() => {
    if (fiatValue0 === null || fiatValue1 === null || totalPositionValue === null || totalPositionValue === 0) return 50;
    return (fiatValue0 / totalPositionValue) * 100;
  }, [fiatValue0, fiatValue1, totalPositionValue]);

  const percent1 = 100 - percent0;

  // Display value: show hovered token's value or total
  const displayValue = useMemo(() => {
    if (hoveredToken === 0 && fiatValue0 !== null) return fiatValue0;
    if (hoveredToken === 1 && fiatValue1 !== null) return fiatValue1;
    return totalPositionValue;
  }, [hoveredToken, fiatValue0, fiatValue1, totalPositionValue]);

  return (
    <SectionContainer>
      <div className="flex flex-col gap-2">
        <span className="text-sm text-muted-foreground">Position Value</span>
        <span className="text-3xl font-semibold tabular-nums transition-all">
          {displayValue !== null ? `$${formatNumber(displayValue, { max: 2 })}` : "-"}
        </span>
      </div>

      {totalPositionValue !== null && totalPositionValue > 0 && (
        <>
          <DualBar
            percent0={percent0}
            percent1={percent1}
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
            hoveredToken={hoveredToken}
            onHover={setHoveredToken}
            networkMode={networkMode}
          />

          <div className="flex flex-col gap-0.5 -mb-3">
            {currency0Amount && (
              <TokenRow
                symbol={token0Symbol}
                amount={currency0Amount.toExact()}
                isHovered={hoveredToken === 0}
                isMuted={hoveredToken === 1}
                onHover={(h) => setHoveredToken(h ? 0 : null)}
                networkMode={networkMode}
              />
            )}
            {currency1Amount && (
              <TokenRow
                symbol={token1Symbol}
                amount={currency1Amount.toExact()}
                isHovered={hoveredToken === 1}
                isMuted={hoveredToken === 0}
                onHover={(h) => setHoveredToken(h ? 1 : null)}
                networkMode={networkMode}
              />
            )}
          </div>
        </>
      )}
    </SectionContainer>
  );
}

function EarningsSection({
  fee0Amount,
  fee1Amount,
  fiatFeeValue0,
  fiatFeeValue1,
  totalFeesValue,
  token0Symbol,
  token1Symbol,
  networkMode,
}: {
  fee0Amount: CurrencyAmount<Currency> | null;
  fee1Amount: CurrencyAmount<Currency> | null;
  fiatFeeValue0: number | null;
  fiatFeeValue1: number | null;
  totalFeesValue: number | null;
  token0Symbol: string;
  token1Symbol: string;
  networkMode: "mainnet" | "testnet";
}) {
  const [hoveredToken, setHoveredToken] = useState<0 | 1 | null>(null);

  const percent0 = useMemo(() => {
    if (fiatFeeValue0 === null || fiatFeeValue1 === null || totalFeesValue === null || totalFeesValue === 0) return 50;
    return (fiatFeeValue0 / totalFeesValue) * 100;
  }, [fiatFeeValue0, fiatFeeValue1, totalFeesValue]);

  const percent1 = 100 - percent0;

  // Display value: show hovered token's value or total
  const displayValue = useMemo(() => {
    if (hoveredToken === 0 && fiatFeeValue0 !== null) return fiatFeeValue0;
    if (hoveredToken === 1 && fiatFeeValue1 !== null) return fiatFeeValue1;
    return totalFeesValue;
  }, [hoveredToken, fiatFeeValue0, fiatFeeValue1, totalFeesValue]);

  return (
    <SectionContainer>
      <div className="flex flex-col gap-2">
        <span className="text-sm text-muted-foreground">Uncollected Fees</span>
        <span className="text-3xl font-semibold tabular-nums transition-all">
          {displayValue !== null ? `$${formatNumber(displayValue, { max: 2 })}` : "-"}
        </span>
      </div>

      {totalFeesValue !== null && totalFeesValue > 0 && (
        <>
          <DualBar
            percent0={percent0}
            percent1={percent1}
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
            hoveredToken={hoveredToken}
            onHover={setHoveredToken}
            networkMode={networkMode}
          />

          <div className="flex flex-col gap-0.5 -mb-3">
            {fee0Amount && (
              <TokenRow
                symbol={token0Symbol}
                amount={fee0Amount.toExact()}
                isHovered={hoveredToken === 0}
                isMuted={hoveredToken === 1}
                onHover={(h) => setHoveredToken(h ? 0 : null)}
                networkMode={networkMode}
              />
            )}
            {fee1Amount && (
              <TokenRow
                symbol={token1Symbol}
                amount={fee1Amount.toExact()}
                isHovered={hoveredToken === 1}
                isMuted={hoveredToken === 0}
                onHover={(h) => setHoveredToken(h ? 1 : null)}
                networkMode={networkMode}
              />
            )}
          </div>
        </>
      )}
    </SectionContainer>
  );
}

/**
 * Yield info callout content
 */
const YIELD_INFO: Record<string, { title: string; description: React.ReactNode }> = {
  swap: {
    title: "Swap APR",
    description: "Earned from trading fees when swaps occur through your position's price range. The APR varies based on trading volume and your position's concentration.",
  },
  lending: {
    title: "Lending APY",
    description: "Additional yield earned by lending idle liquidity. When your liquidity isn't being used for swaps, it generates lending interest automatically.",
  },
  points: {
    title: "Points",
    description: (
      <>
        This position earns points continuously while providing liquidity. Points are distributed every Thursday at 02:00 UTC.{" "}
        <Link href="/points" className="underline hover:text-foreground transition-colors">
          Visit the Points page
        </Link>{" "}
        for more details.
      </>
    ),
  },
};

/**
 * Yield Breakdown Section
 * Matches pool page style - table with hover rows
 * Clickable rows show info callout
 */
function APRSection({
  poolApr,
  aaveApr,
  totalApr,
  lpType,
  pointsEarned = 220,
  yieldSources = ['aave'],
}: {
  poolApr: number | null;
  aaveApr: number | null;
  totalApr: number | null;
  lpType: LPType;
  pointsEarned?: number;
  yieldSources?: Array<'aave' | 'spark'>;
}) {
  const [selectedInfo, setSelectedInfo] = useState<"swap" | "lending" | "points" | null>(null);
  const isRehypo = lpType === "rehypo";

  const handleRowClick = (row: "swap" | "lending" | "points") => {
    setSelectedInfo(selectedInfo === row ? null : row);
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-sidebar-border/60 p-4 pb-2">
      <h4 className="text-sm font-semibold text-foreground">Yield Breakdown</h4>
      <div className="flex flex-col -mx-2">
        {/* Swap APR - Clickable */}
        <div
          className={cn(
            "flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer",
            selectedInfo === "swap" && "bg-muted/40"
          )}
          onClick={() => handleRowClick("swap")}
        >
          <span className="text-xs text-muted-foreground">Swap APR</span>
          <span className="text-xs font-mono text-foreground">
            {poolApr !== null ? `${formatNumber(poolApr, { max: 2 })}%` : "-"}
          </span>
        </div>

        {/* Lending APY - Only shown for rehypo positions */}
        {isRehypo && (
          <div
            className={cn(
              "flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer",
              selectedInfo === "lending" && "bg-muted/40"
            )}
            onClick={() => handleRowClick("lending")}
          >
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LendingSourceIcons sources={yieldSources} />
              Lending APY
            </span>
            <span className="text-xs font-mono text-foreground">
              {aaveApr !== null ? `${formatNumber(aaveApr, { max: 2 })}%` : "-"}
            </span>
          </div>
        )}

        {/* Points - + left muted, Icon+Points right white */}
        <div
          className={cn(
            "flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/40 transition-colors cursor-pointer",
            selectedInfo === "points" && "bg-muted/40"
          )}
          onClick={() => handleRowClick("points")}
        >
          <span className="text-xs text-muted-foreground">+</span>
          <span className="flex items-center gap-1.5">
            <PointsIcon className="w-3.5 h-3.5 text-foreground" />
            <span className="text-xs font-mono text-foreground">Points</span>
          </span>
        </div>

        {/* Divider */}
        <div className="border-t border-sidebar-border/40 mx-2 my-1" />

        {/* Total label: "Unified Yield" for rehypo, "Total APR" for v4 */}
        <div className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/40 transition-colors">
          <span className="text-xs font-medium text-foreground">
            {isRehypo ? "Unified Yield" : "Total APR"}
          </span>
          <span className="text-xs font-mono font-medium text-foreground">
            {totalApr !== null ? `~${formatNumber(totalApr, { max: 2 })}%` : "-"}
          </span>
        </div>
      </div>

      {/* Info Callout - appears when a row is clicked */}
      {selectedInfo && (
        <div className="flex items-start gap-2 p-3 mt-1 rounded-lg bg-muted/30 border border-sidebar-border/40">
          <svg
            className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium text-foreground">
              {YIELD_INFO[selectedInfo].title}
            </span>
            <span className="text-xs text-muted-foreground leading-relaxed">
              {YIELD_INFO[selectedInfo].description}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export const PositionDetail = memo(function PositionDetail({
  tokenId,
  position,
  positionInfo,
  unifiedYieldPosition,
  isLoading,
  error,
  poolConfig,
  poolState,
  currency0Amount,
  currency1Amount,
  fiatValue0,
  fiatValue1,
  totalPositionValue,
  fee0Amount,
  fee1Amount,
  fiatFeeValue0,
  fiatFeeValue1,
  totalFeesValue,
  currentPrice,
  currentPriceNumeric,
  priceInverted,
  setPriceInverted,
  minPrice,
  maxPrice,
  tokenASymbol,
  tokenBSymbol,
  isFullRange,
  isInRange,
  poolApr,
  aaveApr,
  totalApr,
  lpType,
  chartDuration,
  setChartDuration,
  chartData,
  isLoadingChart,
  effectiveDenominationBase,
  handleDenominationToggle,
  isOwner,
  refetch,
  fromPage,
}: PositionDetailProps) {
  const isMobile = useIsMobile();
  const router = useRouter();
  const { networkMode } = useNetwork();

  // Window width for responsive chart
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== "undefined" ? window.innerWidth : 1200
  );

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    if (typeof window !== "undefined") {
      setWindowWidth(window.innerWidth);
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }
  }, []);

  // Detect if this is a Unified Yield position (derived from lpType prop)
  const isUnifiedYield = lpType === "rehypo";

  // Modal state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isRemoveModalOpen, setIsRemoveModalOpen] = useState(false);
  const [isCollectModalOpen, setIsCollectModalOpen] = useState(false);
  const [showPriceDeviationModal, setShowPriceDeviationModal] = useState(false);
  // Default to Yield chart for Unified Yield positions, Price chart for V4
  const [chartTab, setChartTab] = useState<"price" | "yield">(isUnifiedYield ? "yield" : "price");
  const [feeChartPeriod, setFeeChartPeriod] = useState<ChartPeriod>("1W");

  // Price deviation check - compare pool price vs market price
  const poolPriceValue = useMemo(() => {
    if (currentPriceNumeric === null) return null;
    const displayPrice = priceInverted ? 1 / currentPriceNumeric : currentPriceNumeric;
    return isFinite(displayPrice) ? displayPrice.toString() : null;
  }, [currentPriceNumeric, priceInverted]);

  const priceDeviation = usePriceDeviation({
    token0Symbol: poolConfig?.currency0?.symbol,
    token1Symbol: poolConfig?.currency1?.symbol,
    poolPrice: poolPriceValue,
    priceInverted,
  });

  // Fee chart data for V4 positions - pass current uncollected fees for "live now" point
  const {
    data: feeChartData,
    isLoading: isLoadingFeeChart,
    refetch: refetchFeeChart,
  } = usePositionFeeChartData({
    positionId: tokenId,
    period: feeChartPeriod,
    currentFeesUsd: totalFeesValue ?? undefined,
    enabled: chartTab === "yield" && !!tokenId && !isUnifiedYield,
    token0Symbol: poolConfig?.currency0?.symbol,
    token1Symbol: poolConfig?.currency1?.symbol,
    isRehypo: false, // V4 positions only
  });

  // Unified Yield chart data - shows Swap APR + per-token yield source APRs
  const {
    data: uyChartData,
    currency0Protocol: uyC0Protocol,
    currency1Protocol: uyC1Protocol,
    isLoading: isLoadingUyChart,
    refetch: refetchUyChart,
  } = useUnifiedYieldChartData({
    poolId: poolConfig?.subgraphId,
    period: feeChartPeriod,
    yieldSources: poolConfig?.yieldSources,
    token0Symbol: poolConfig?.currency0?.symbol,
    token1Symbol: poolConfig?.currency1?.symbol,
    currentSwapApr: poolApr,
    enabled: chartTab === "yield" && !!poolConfig?.subgraphId && isUnifiedYield,
  });

  // Transform UY chart data to format expected by YieldChartSection
  // Calculate weighted totalApr based on position's token value ratios
  const transformedUyChartData = useMemo(() => {
    if (!uyChartData) return [];

    // Calculate token weights from current position USD values
    const totalValue = (fiatValue0 ?? 0) + (fiatValue1 ?? 0);
    const token0Weight = totalValue > 0 ? (fiatValue0 ?? 0) / totalValue : 0.5;
    const token1Weight = totalValue > 0 ? (fiatValue1 ?? 0) / totalValue : 0.5;

    return uyChartData.map((point) => {
      // Per-token yield is already separated in the data model
      const weightedYield = (token0Weight * (point.currency0Apy ?? 0)) + (token1Weight * (point.currency1Apy ?? 0));
      const weightedTotalApr = point.swapApr + weightedYield;

      return {
        timestamp: point.timestamp,
        apr: point.swapApr,
        currency0Apy: point.currency0Apy,
        currency1Apy: point.currency1Apy,
        feesUsd: 0, // UY positions don't show individual fees
        accumulatedFeesUsd: 0,
        totalApr: weightedTotalApr,
      };
    });
  }, [uyChartData, fiatValue0, fiatValue1]);

  // Compute yield source labels and colors for chart legend
  const { c0YieldLabel, c1YieldLabel, c0YieldColor, c1YieldColor } = useMemo(() => {
    const token0Sym = poolConfig?.currency0?.symbol ?? "";
    const token1Sym = poolConfig?.currency1?.symbol ?? "";
    const protocolName = (p?: 'aave' | 'spark') => p === 'spark' ? 'Spark' : 'Aave';

    const c0Label = uyC0Protocol ? `${protocolName(uyC0Protocol)} ${token0Sym}` : `Yield ${token0Sym}`;
    const c1Label = uyC1Protocol ? `${protocolName(uyC1Protocol)} ${token1Sym}` : `Yield ${token1Sym}`;

    // Colors: protocol-specific, with a lighter shade when both tokens use the same protocol
    const bothAave = uyC0Protocol === 'aave' && uyC1Protocol === 'aave';
    const c0Color = uyC0Protocol === 'spark' ? "#F5AC37" : "#9896FF";
    const c1Color = uyC1Protocol === 'spark' ? "#F5AC37" : (bothAave ? "#C4C2FF" : "#9896FF");

    return { c0YieldLabel: c0Label, c1YieldLabel: c1Label, c0YieldColor: c0Color, c1YieldColor: c1Color };
  }, [poolConfig?.currency0?.symbol, poolConfig?.currency1?.symbol, uyC0Protocol, uyC1Protocol]);

  // Select the appropriate chart data based on position type
  const yieldChartData = isUnifiedYield ? transformedUyChartData : (feeChartData ?? []);
  const isLoadingYieldChart = isUnifiedYield ? isLoadingUyChart : isLoadingFeeChart;
  const refetchYieldChart = isUnifiedYield ? refetchUyChart : refetchFeeChart;

  // Convert position data to ProcessedPosition format for modals
  // Uses the shared adapter for Unified Yield positions
  const processedPosition: ProcessedPosition | null = useMemo(() => {
    if (!poolConfig) return null;

    // For Unified Yield positions, use the shared adapter
    if (isUnifiedYield && unifiedYieldPosition) {
      return adaptUnifiedYieldToProcessedPosition(unifiedYieldPosition, networkMode);
    }

    // For V4 positions, need positionInfo
    if (!position || !positionInfo) return null;

    return {
      type: 'v4' as const,
      positionId: tokenId,
      owner: positionInfo.owner,
      poolId: poolConfig.id,
      token0: {
        address: poolConfig.currency0.address,
        symbol: poolConfig.currency0.symbol,
        amount: currency0Amount?.toExact() || "0",
        rawAmount: currency0Amount?.quotient.toString() || "0",
      },
      token1: {
        address: poolConfig.currency1.address,
        symbol: poolConfig.currency1.symbol,
        amount: currency1Amount?.toExact() || "0",
        rawAmount: currency1Amount?.quotient.toString() || "0",
      },
      tickLower: positionInfo.tickLower,
      tickUpper: positionInfo.tickUpper,
      liquidityRaw: positionInfo.liquidity.toString(),
      ageSeconds: 0, // Not critical for modals
      blockTimestamp: 0,
      lastTimestamp: 0,
      isInRange,
      token0UncollectedFees: fee0Amount?.toExact() || "0",
      token1UncollectedFees: fee1Amount?.toExact() || "0",
    };
  }, [position, poolConfig, positionInfo, tokenId, currency0Amount, currency1Amount, isInRange, fee0Amount, fee1Amount, isUnifiedYield, unifiedYieldPosition, networkMode]);

  // Modal handlers
  const handleOpenAddModal = useCallback(() => {
    // Check if high price deviation requires acknowledgment first
    if (requiresDeviationAcknowledgment(priceDeviation.severity)) {
      setShowPriceDeviationModal(true);
    } else {
      setIsAddModalOpen(true);
    }
  }, [priceDeviation.severity]);
  const handleCloseAddModal = useCallback(() => setIsAddModalOpen(false), []);
  const handleOpenRemoveModal = useCallback(() => setIsRemoveModalOpen(true), []);
  const handleCloseRemoveModal = useCallback(() => setIsRemoveModalOpen(false), []);
  const handleOpenCollectModal = useCallback(() => setIsCollectModalOpen(true), []);
  const handleCloseCollectModal = useCallback(() => setIsCollectModalOpen(false), []);

  // Price deviation confirmation handler - opens the add modal after acknowledgment
  const handlePriceDeviationConfirm = useCallback(() => {
    setShowPriceDeviationModal(false);
    setIsAddModalOpen(true);
  }, []);

  // Handle modal success - refetch position data
  const handleModalSuccess = useCallback(() => {
    refetch();
    refetchYieldChart();
  }, [refetch, refetchYieldChart]);

  // Handle decrease modal success - navigate to overview on full burn
  const handleDecreaseSuccess = useCallback((options?: { isFullBurn?: boolean }) => {
    if (options?.isFullBurn) {
      router.push('/overview');
    } else {
      refetch();
      refetchYieldChart();
    }
  }, [router, refetch, refetchYieldChart]);

  // Loading state
  if (isLoading) {
    return <LoadingSkeleton />;
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <p className="text-muted-foreground">Failed to load position</p>
        <Button variant="outline" onClick={() => refetch()}>
          Try Again
        </Button>
      </div>
    );
  }

  // Not found state
  // For Unified Yield: position is null but poolConfig should exist
  // For V4: both position and poolConfig should exist
  const hasValidData = isUnifiedYield
    ? (poolConfig !== null && currency0Amount !== null)
    : (position !== null && poolConfig !== null);

  if (!hasValidData) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <h2 className="text-2xl font-semibold">Position not found</h2>
        <p className="text-muted-foreground text-center max-w-md">
          This position may have been closed or doesn't exist.
        </p>
        <Button onClick={() => router.push("/overview")}>
          Back to Positions
        </Button>
      </div>
    );
  }

  // poolConfig is guaranteed non-null after the hasValidData guard above
  const token0Symbol = poolConfig!.currency0.symbol;
  const token1Symbol = poolConfig!.currency1.symbol;

  // For Unified Yield positions, fees auto-compound so no manual collection needed
  const hasFees = !isUnifiedYield && totalFeesValue !== null && totalFeesValue > 0;

  return (
    <div className="flex flex-col gap-6 p-3 sm:p-6 overflow-x-hidden w-full max-w-[1200px] mx-auto pb-20 sm:pb-6">
      {/* Header with Action Buttons */}
      <PositionHeader
        poolConfig={poolConfig!}
        lpType={lpType}
        isInRange={isInRange}
        isOwner={isOwner}
        hasFees={hasFees}
        onAddLiquidity={handleOpenAddModal}
        onRemoveLiquidity={handleOpenRemoveModal}
        onCollectFees={handleOpenCollectModal}
        networkMode={networkMode}
        fromPage={fromPage}
      />

      {/* Right Column content - Mobile only: appears above chart when stacked */}
      <div className="flex flex-col gap-4 xl:hidden">
        {/* Uncollected Fees - Show first when > 0 */}
        {hasFees && (
          <EarningsSection
            fee0Amount={fee0Amount}
            fee1Amount={fee1Amount}
            fiatFeeValue0={fiatFeeValue0}
            fiatFeeValue1={fiatFeeValue1}
            totalFeesValue={totalFeesValue}
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
            networkMode={networkMode}
          />
        )}

        {/* Position Value */}
        <PositionValueSection
          currency0Amount={currency0Amount}
          currency1Amount={currency1Amount}
          fiatValue0={fiatValue0}
          fiatValue1={fiatValue1}
          totalPositionValue={totalPositionValue}
          token0Symbol={token0Symbol}
          token1Symbol={token1Symbol}
          networkMode={networkMode}
        />

        {/* Price Deviation Warning */}
        {priceDeviation.severity !== 'none' && poolConfig && (
          <PriceDeviationCallout
            deviation={priceDeviation}
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
            variant="card"
          />
        )}

        {/* APR */}
        <APRSection
          poolApr={poolApr}
          aaveApr={aaveApr}
          totalApr={totalApr}
          lpType={lpType}
          yieldSources={poolConfig?.yieldSources}
        />
      </div>

      {/* Two-column layout - matches PoolDetail pattern */}
      <div className="flex flex-col xl:flex-row gap-10">
        {/* Left Column: Chart & Price Range */}
        <div className="flex-1 flex flex-col gap-6 min-w-0 w-full overflow-hidden">
          {/* Chart Tabs + Denomination Toggle */}
          <div className="flex flex-row items-center justify-between gap-2 min-w-0">
            <div className="flex flex-row items-center gap-1">
              <button
                onClick={() => setChartTab("price")}
                className={cn(
                  "h-7 px-2.5 text-xs rounded-md transition-colors duration-150 cursor-pointer select-none",
                  chartTab === "price"
                    ? "bg-muted/50 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                Price
              </button>
              <button
                onClick={() => setChartTab("yield")}
                className={cn(
                  "h-7 px-2.5 text-xs rounded-md transition-colors duration-150 cursor-pointer select-none",
                  chartTab === "yield"
                    ? "bg-muted/50 text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                Yield
              </button>
            </div>

            {/* Denomination Toggle */}
            <DenominationToggle
              token0Symbol={token0Symbol}
              token1Symbol={token1Symbol}
              activeBase={priceInverted ? token1Symbol : token0Symbol}
              onToggle={(symbol) => {
                const shouldInvert = symbol === token1Symbol;
                if (shouldInvert !== priceInverted) {
                  setPriceInverted(shouldInvert);
                }
              }}
            />
          </div>

          {/* Price Chart - no background container */}
          {chartTab === "price" ? (
            <PriceChartSection
              chartData={chartData}
              isLoading={isLoadingChart}
              windowWidth={windowWidth}
              currentPrice={currentPriceNumeric ?? undefined}
              minRangePrice={!isFullRange && minPrice ? parseFloat(minPrice) : undefined}
              maxRangePrice={!isFullRange && maxPrice ? parseFloat(maxPrice) : undefined}
              priceInverted={priceInverted}
              token0Symbol={token0Symbol}
              token1Symbol={token1Symbol}
              timePeriod={chartDuration as TimePeriod}
              onTimePeriodChange={(period) => setChartDuration(period as ChartDuration)}
            />
          ) : (
            <YieldChartSection
              chartData={yieldChartData}
              isLoading={isLoadingYieldChart}
              windowWidth={windowWidth}
              currentFees={isUnifiedYield ? undefined : (totalFeesValue ?? undefined)}
              timePeriod={feeChartPeriod}
              onTimePeriodChange={(period) => setFeeChartPeriod(period)}
              isUnifiedYield={isUnifiedYield}
              currency0YieldLabel={c0YieldLabel}
              currency1YieldLabel={c1YieldLabel}
              currency0YieldColor={c0YieldColor}
              currency1YieldColor={c1YieldColor}
            />
          )}

          {/* Price Range */}
          <PriceRangeSection
            minPrice={minPrice}
            maxPrice={maxPrice}
            tokenASymbol={tokenASymbol ?? ''}
            tokenBSymbol={tokenBSymbol ?? ''}
            isFullRange={isFullRange ?? false}
            currentPriceNumeric={currentPriceNumeric}
            priceInverted={priceInverted}
            poolType={poolConfig?.type}
          />
        </div>

        {/* Right Column: Position Info - Desktop only (xl+) - 380px matches Overview/PoolDetail */}
        <div className="hidden xl:flex flex-col gap-4 w-full xl:w-[380px] flex-shrink-0">
          {/* Uncollected Fees - Show first when > 0 */}
          {hasFees && (
            <EarningsSection
              fee0Amount={fee0Amount}
              fee1Amount={fee1Amount}
              fiatFeeValue0={fiatFeeValue0}
              fiatFeeValue1={fiatFeeValue1}
              totalFeesValue={totalFeesValue}
              token0Symbol={token0Symbol}
              token1Symbol={token1Symbol}
              networkMode={networkMode}
            />
          )}

          {/* Position Value */}
          <PositionValueSection
            currency0Amount={currency0Amount}
            currency1Amount={currency1Amount}
            fiatValue0={fiatValue0}
            fiatValue1={fiatValue1}
            totalPositionValue={totalPositionValue}
            token0Symbol={token0Symbol}
            token1Symbol={token1Symbol}
            networkMode={networkMode}
          />

          {/* Price Deviation Warning */}
          {priceDeviation.severity !== 'none' && poolConfig && (
            <PriceDeviationCallout
              deviation={priceDeviation}
              token0Symbol={token0Symbol}
              token1Symbol={token1Symbol}
              variant="card"
            />
          )}

          {/* APR */}
          <APRSection
            poolApr={poolApr}
            aaveApr={aaveApr}
            totalApr={totalApr}
            lpType={lpType}
            yieldSources={poolConfig?.yieldSources}
          />
        </div>
      </div>

      {/* Mobile Fixed Action Buttons - Only show Collect fees if there are fees */}
      {isMobile && isOwner && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur-sm border-t border-sidebar-border z-40 sm:hidden">
          <div className="flex gap-2">
            {hasFees && (
              <Button onClick={handleOpenCollectModal} className="flex-1 h-12 font-semibold bg-button-primary border border-sidebar-primary text-sidebar-primary hover-button-primary">
                Collect fees
              </Button>
            )}
            <Button onClick={handleOpenAddModal} variant="outline" className={cn("h-12 px-4 font-medium border-sidebar-border", !hasFees && "flex-1")}>
              <Plus className="h-4 w-4" />
              {!hasFees && <span className="ml-2">Add</span>}
            </Button>
            <Button onClick={handleOpenRemoveModal} variant="outline" className={cn("h-12 px-4 font-medium border-sidebar-border", !hasFees && "flex-1")}>
              <Minus className="h-4 w-4" />
              {!hasFees && <span className="ml-2">Remove</span>}
            </Button>
          </div>
        </div>
      )}

      {/* Modals */}
      {processedPosition && (
        <>
          <IncreaseLiquidityModal
            position={processedPosition}
            isOpen={isAddModalOpen}
            onClose={handleCloseAddModal}
            onSuccess={handleModalSuccess}
          />
          <DecreaseLiquidityModal
            position={processedPosition}
            isOpen={isRemoveModalOpen}
            onClose={handleCloseRemoveModal}
            onSuccess={handleDecreaseSuccess}
          />
          <CollectFeesModal
            position={processedPosition}
            isOpen={isCollectModalOpen}
            onClose={handleCloseCollectModal}
            onSuccess={handleModalSuccess}
          />
        </>
      )}

      {/* Price Deviation Confirmation Modal */}
      {poolConfig && priceDeviation.absoluteDeviation !== null && (
        <HighRiskConfirmModal
          isOpen={showPriceDeviationModal}
          onClose={() => setShowPriceDeviationModal(false)}
          onConfirm={handlePriceDeviationConfirm}
          warnings={[createPriceDeviationWarning({
            poolPrice: priceDeviation.poolPrice,
            marketPrice: priceDeviation.marketPrice,
            deviationPercent: priceDeviation.absoluteDeviation,
            direction: priceDeviation.direction ?? 'below',
            token0Symbol: poolConfig.currency0.symbol,
            token1Symbol: poolConfig.currency1.symbol,
          })]}
          confirmText="Proceed with Add Liquidity"
        />
      )}
    </div>
  );
});

export default PositionDetail;
