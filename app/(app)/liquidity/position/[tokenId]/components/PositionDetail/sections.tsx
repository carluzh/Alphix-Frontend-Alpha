"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { CurrencyAmount, Currency } from "@uniswap/sdk-core";
import { Button } from "@/components/ui/button";
import { getTokenIcon } from "@/lib/utils";
import { getDecimalsForDenomination } from "@/lib/denomination-utils";
import type { PoolConfig } from "@/lib/pools-config";
import type { LPType } from "../../hooks";
import type { NetworkMode } from "@/lib/network-mode";
import { formatNumber } from "./constants";
import { SectionContainer, StatusIndicator, UnifiedYieldBadge, DualBar, TokenRow } from "./primitives";

export function PositionHeader({
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
  networkMode: NetworkMode;
  fromPage: "overview" | "pool" | null;
}) {
  const token0Icon = getTokenIcon(poolConfig.currency0.symbol, networkMode);
  const token1Icon = getTokenIcon(poolConfig.currency1.symbol, networkMode);
  const poolName = `${poolConfig.currency0.symbol} / ${poolConfig.currency1.symbol}`;

  // Determine breadcrumb based on origin
  const breadcrumbLink = fromPage === "pool"
    ? `/liquidity/${poolConfig.slug}`
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
              href={`/liquidity/${poolConfig.slug}`}
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

export function PriceRangeSection({
  minPrice,
  maxPrice,
  tokenASymbol,
  tokenBSymbol,
  isFullRange,
  currentPriceNumeric,
  priceInverted,
  poolType,
  poolOutsideRange,
}: {
  minPrice: string;
  maxPrice: string;
  tokenASymbol: string;
  tokenBSymbol: string;
  isFullRange: boolean;
  currentPriceNumeric: number | null;
  priceInverted: boolean;
  poolType?: string;
  poolOutsideRange?: boolean;
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
    if (poolOutsideRange || currentPriceNumeric === null) return "-";
    const displayPrice = priceInverted ? 1 / currentPriceNumeric : currentPriceNumeric;
    if (!isFinite(displayPrice) || displayPrice <= 0) return "-";
    // tokenASymbol is the denomination/quote token (e.g., "USDC" in "USDC per ETH")
    const displayDecimals = getDecimalsForDenomination(tokenASymbol, poolType);
    return displayPrice.toLocaleString("en-US", {
      minimumFractionDigits: displayDecimals,
      maximumFractionDigits: displayDecimals,
    });
  }, [currentPriceNumeric, priceInverted, tokenASymbol, poolType, poolOutsideRange]);

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

export function PositionValueSection({
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
  networkMode: NetworkMode;
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

export function EarningsSection({
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
  networkMode: NetworkMode;
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
