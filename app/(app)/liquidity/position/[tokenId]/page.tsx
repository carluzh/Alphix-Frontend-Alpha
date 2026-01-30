"use client";

import { useMemo } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { PositionDetail } from "./components/PositionDetail/PositionDetail";
import { usePositionPageData } from "./hooks";

/**
 * Normalize tokenId from URL format to decimal string
 * Accepts: short hex (d0e35), full hex (0x...000d0e35), decimal (852533),
 * or Unified Yield format (uy-{hookAddress}-{userAddress})
 */
function normalizeTokenId(rawTokenId: string): string {
  if (!rawTokenId) return "";
  const trimmed = rawTokenId.trim();
  // Unified Yield position IDs start with "uy-" - pass through as-is
  if (trimmed.startsWith("uy-")) return trimmed;
  // Decimal format
  if (/^\d+$/.test(trimmed)) return trimmed;
  // Hex format - convert to decimal
  try {
    const hex = trimmed.startsWith("0x") ? trimmed : "0x" + trimmed;
    return BigInt(hex).toString();
  } catch {
    return trimmed;
  }
}

/**
 * Position Detail Page - thin entry point that extracts tokenId and delegates to content.
 * Key prop on PositionDetailContent forces remount on position change, ensuring fresh state.
 */
export default function PositionDetailPage() {
  const params = useParams<{ tokenId: string }>();
  const searchParams = useSearchParams();
  const rawTokenId = params?.tokenId || "";
  const tokenId = useMemo(() => normalizeTokenId(rawTokenId), [rawTokenId]);

  // Track navigation origin for breadcrumb display
  const fromPage = useMemo(() => {
    const from = searchParams?.get("from");
    if (from === "pool") return "pool" as const;
    if (from === "overview") return "overview" as const;
    return null;
  }, [searchParams]);

  return <PositionDetailContent key={tokenId} tokenId={tokenId} fromPage={fromPage} />;
}

function PositionDetailContent({ tokenId, fromPage }: { tokenId: string; fromPage: "pool" | "overview" | null }) {
  const {
    // Position data
    position,
    positionInfo,
    unifiedYieldPosition,
    isLoading,
    error,
    // Pool data
    poolConfig,
    poolState,
    // Token amounts
    currency0Amount,
    currency1Amount,
    // USD values
    fiatValue0,
    fiatValue1,
    totalPositionValue,
    // Fees
    fee0Amount,
    fee1Amount,
    fiatFeeValue0,
    fiatFeeValue1,
    totalFeesValue,
    // Price info
    currentPrice,
    currentPriceNumeric,
    priceInverted,
    setPriceInverted,
    // Range display
    minPrice,
    maxPrice,
    tokenASymbol,
    tokenBSymbol,
    isFullRange,
    isInRange,
    // APR data
    poolApr,
    aaveApr,
    totalApr,
    // LP Type
    lpType,
    // Chart
    chartDuration,
    setChartDuration,
    chartData,
    isLoadingChart,
    // Denomination
    effectiveDenominationBase,
    handleDenominationToggle,
    // Ownership
    isOwner,
    // Actions
    refetch,
  } = usePositionPageData(tokenId);

  return (
    <PositionDetail
      tokenId={tokenId}
      position={position}
      positionInfo={positionInfo}
      unifiedYieldPosition={unifiedYieldPosition}
      isLoading={isLoading}
      error={error}
      poolConfig={poolConfig}
      poolState={poolState}
      currency0Amount={currency0Amount}
      currency1Amount={currency1Amount}
      fiatValue0={fiatValue0}
      fiatValue1={fiatValue1}
      totalPositionValue={totalPositionValue}
      fee0Amount={fee0Amount}
      fee1Amount={fee1Amount}
      fiatFeeValue0={fiatFeeValue0}
      fiatFeeValue1={fiatFeeValue1}
      totalFeesValue={totalFeesValue}
      currentPrice={currentPrice}
      currentPriceNumeric={currentPriceNumeric}
      priceInverted={priceInverted}
      setPriceInverted={setPriceInverted}
      minPrice={minPrice}
      maxPrice={maxPrice}
      tokenASymbol={tokenASymbol}
      tokenBSymbol={tokenBSymbol}
      isFullRange={isFullRange}
      isInRange={isInRange}
      poolApr={poolApr}
      aaveApr={aaveApr}
      totalApr={totalApr}
      lpType={lpType}
      chartDuration={chartDuration}
      setChartDuration={setChartDuration}
      chartData={chartData}
      isLoadingChart={isLoadingChart}
      effectiveDenominationBase={effectiveDenominationBase}
      handleDenominationToggle={handleDenominationToggle}
      isOwner={isOwner}
      refetch={refetch}
      fromPage={fromPage}
    />
  );
}
