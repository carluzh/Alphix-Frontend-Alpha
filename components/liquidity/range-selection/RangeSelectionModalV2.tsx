"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { TokenSymbol, getToken, getChainId } from "@/lib/pools-config";
import { InteractiveRangeChart } from "../InteractiveRangeChart";
import { ArrowLeftRight, CircleHelp } from "lucide-react";
import { IconPlus, IconMinus, IconChartBarAxisX, IconPen2 } from "nucleo-micro-bold-essential";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { calculatePositionApr, formatApr, type PoolMetrics } from "@/lib/apr";
import { getPoolById } from "@/lib/pools-config";
import { getOptimalBaseToken } from "@/lib/denomination-utils";
import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';
import { useIsMobile } from '@/hooks/use-mobile';
import { convertTickToPrice } from '@/lib/denomination-utils';
import { isFullRangePosition } from '@/lib/liquidity';
import { calculateTicksFromPercentage } from '@/lib/liquidity/utils/calculations';

// Inline convertPriceToValidTick - TODO: Replace with Uniswap SDK when integration done
function convertPriceToValidTick(params: {
  priceString: string;
  isMaxPrice: boolean;
  baseToken: string;
  token0Symbol: string;
  tickSpacing: number;
  minTick: number;
  maxTick: number;
  currentPrice: string;
  currentPoolTick: number;
}): number | null {
  const { priceString, isMaxPrice, baseToken, token0Symbol, tickSpacing, minTick, maxTick, currentPrice, currentPoolTick } = params;
  const price = parseFloat(priceString);
  if (isNaN(price) || price <= 0) return null;
  const currentPriceNum = parseFloat(currentPrice);
  if (isNaN(currentPriceNum) || currentPriceNum <= 0) return null;
  const shouldInvert = baseToken === token0Symbol;
  const priceInToken1PerToken0 = shouldInvert ? 1 / price : price;
  const priceRatio = priceInToken1PerToken0 / currentPriceNum;
  const tickDelta = Math.round(Math.log(priceRatio) / Math.log(1.0001));
  let rawTick = currentPoolTick + tickDelta;
  rawTick = isMaxPrice
    ? Math.ceil(rawTick / tickSpacing) * tickSpacing
    : Math.floor(rawTick / tickSpacing) * tickSpacing;
  return Math.max(minTick, Math.min(maxTick, rawTick));
}

// Consolidated constants for range presets
const PRESET_PERCENTAGES: Record<string, number> = {
  "±15%": 15, "±8%": 8, "±3%": 3, "±1%": 1, "±0.5%": 0.5, "±0.1%": 0.1
};

const RANGE_TYPES_STANDARD: readonly string[] = ["Full Range", "±15%", "±3%", "Custom"];
const RANGE_TYPES_STABLE: readonly string[] = ["Full Range", "±3%", "±0.5%", "Custom"];

const RANGE_LABELS: Record<string, string> = {
  "Full Range": "Full Range",
  "±15%": "Wide",
  "±3%": "Narrow",  // overridden for stable pools
  "±0.5%": "Narrow",
  "Custom": "Custom"
};

interface RangeSelectionModalV2Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (tickLower: string, tickUpper: string, selectedPreset?: string | null, denomination?: TokenSymbol) => void;
  initialTickLower: string;
  initialTickUpper: string;
  initialActivePreset?: string | null;
  selectedPoolId?: string;
  chainId?: number;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  currentPrice: string | null;
  currentPoolTick: number | null;
  currentPoolSqrtPriceX96: string | null;
  minPriceDisplay: string;
  maxPriceDisplay: string;
  baseTokenSymbol: TokenSymbol;
  sdkMinTick: number;
  sdkMaxTick: number;
  defaultTickSpacing: number;
  xDomain: [number, number];
  onXDomainChange?: (newDomain: [number, number]) => void;
  poolToken0?: any;
  poolToken1?: any;
  presetOptions: string[];
  isInverted?: boolean;
  initialFocusField?: 'min' | 'max' | null;
  poolMetricsData?: { poolId: string; metrics: any; poolLiquidity: string } | null;
  poolType?: string;
}

const abbreviateDecimal = (value: string, maxDecimals: number = 10): string => {
  if (!value || value === "" || value === "0") return value;
  
  const parts = value.split('.');
  if (parts.length === 1) return value;
  
  const [whole, decimal] = parts;
  if (decimal.length <= maxDecimals) return value;
  
  return `${whole}.${decimal.substring(0, maxDecimals)}...`;
};

export function RangeSelectionModalV2(props: RangeSelectionModalV2Props) {
  const {
    isOpen, onClose, onConfirm, initialTickLower, initialTickUpper, initialActivePreset,
    selectedPoolId, chainId, token0Symbol, token1Symbol,
    currentPrice, currentPoolTick, currentPoolSqrtPriceX96,
    minPriceDisplay, maxPriceDisplay, baseTokenSymbol,
    sdkMinTick, sdkMaxTick, defaultTickSpacing,
    xDomain, poolToken0, poolToken1, presetOptions,
    initialFocusField = null,
    poolMetricsData = null,
    poolType
  } = props;

  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const minPriceInputRef = useRef<HTMLInputElement>(null);
  const maxPriceInputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);

  // Mobile sheet drag refs and state (similar to TokenSelector)
  const sheetDragStartYRef = useRef<number | null>(null);
  const sheetTranslateYRef = useRef(0);
  const sheetRafRef = useRef<number | null>(null);
  const sheetContentRef = useRef<HTMLDivElement | null>(null);
  const sheetInitialFocusRef = useRef<HTMLDivElement | null>(null);
  const [isSheetDragging, setIsSheetDragging] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Reset sheet drag state when closed
  useEffect(() => {
    if (!isOpen) {
      setIsSheetDragging(false);
      sheetDragStartYRef.current = null;
      sheetTranslateYRef.current = 0;
      if (sheetRafRef.current != null) cancelAnimationFrame(sheetRafRef.current);
      sheetRafRef.current = null;
      if (sheetContentRef.current) sheetContentRef.current.style.transform = "translate3d(0, 0, 0)";
    }
  }, [isOpen]);

  // Sheet drag handlers
  const scheduleSheetTransform = () => {
    if (sheetRafRef.current != null) return;
    sheetRafRef.current = requestAnimationFrame(() => {
      sheetRafRef.current = null;
      const el = sheetContentRef.current;
      if (!el) return;
      const y = sheetTranslateYRef.current;
      el.style.transform = y ? `translate3d(0, ${y}px, 0)` : "translate3d(0, 0, 0)";
    });
  };

  const onSheetHandleTouchStart = (e: React.TouchEvent) => {
    sheetDragStartYRef.current = e.touches[0]?.clientY ?? null;
    setIsSheetDragging(true);
  };

  const onSheetHandleTouchMove = (e: React.TouchEvent) => {
    const startY = sheetDragStartYRef.current;
    if (startY == null) return;

    const currentY = e.touches[0]?.clientY ?? startY;
    const dy = currentY - startY;
    if (dy <= 0) return;

    sheetTranslateYRef.current = Math.min(dy, 220);
    scheduleSheetTransform();
  };

  const onSheetHandleTouchEnd = () => {
    const shouldClose = sheetTranslateYRef.current > 90;
    sheetDragStartYRef.current = null;
    setIsSheetDragging(false);
    sheetTranslateYRef.current = 0;
    scheduleSheetTransform();
    if (shouldClose) onClose();
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const swallowNextClick = () => {
    const handler = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('click', handler, { capture: true, once: true } as any);
    document.addEventListener('mouseup', handler, { capture: true, once: true } as any);
    document.addEventListener('pointerup', handler, { capture: true, once: true } as any);
    document.addEventListener('touchend', handler, { capture: true, once: true } as any);
  };

  const [localTickLower, setLocalTickLower] = useState(initialTickLower);
  const [localTickUpper, setLocalTickUpper] = useState(initialTickUpper);
  const [localXDomain, setLocalXDomain] = useState<[number, number]>(xDomain);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  
  const [minPriceFullPrecision, setMinPriceFullPrecision] = useState(minPriceDisplay);
  const [maxPriceFullPrecision, setMaxPriceFullPrecision] = useState(maxPriceDisplay);
  
  const [minPriceInput, setMinPriceInput] = useState(abbreviateDecimal(minPriceDisplay));
  const [maxPriceInput, setMaxPriceInput] = useState(abbreviateDecimal(maxPriceDisplay));
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [isDraggingChart, setIsDraggingChart] = useState(false);

  const [isMinPriceFocused, setIsMinPriceFocused] = useState(false);
  const [isMaxPriceFocused, setIsMaxPriceFocused] = useState(false);
  const [mobileViewMode, setMobileViewMode] = useState<'chart' | 'inputs'>('chart');

  const initialDenomination = useMemo(() => {
    const currentPriceNum = currentPrice ? parseFloat(currentPrice) : undefined;
    return getOptimalBaseToken(token0Symbol, token1Symbol, currentPriceNum);
  }, [token0Symbol, token1Symbol, currentPrice]);

  const [denominationBase, setDenominationBase] = useState<TokenSymbol>(initialDenomination);

  const [aprValues, setAprValues] = useState<Record<string, string>>({});

  const shouldInvert = denominationBase === token0Symbol;

  const denominationToken = getToken(denominationBase);
  const quoteTokenSymbol = denominationBase === token0Symbol ? token1Symbol : token0Symbol;

  const isUSDDenom = ['aUSDT', 'aUSDC', 'USDT', 'USDC', 'aDAI', 'DAI'].includes(denominationBase);
  const isStablePool = poolType?.toLowerCase() === 'stable';
  const poolPriceDecimals = isUSDDenom ? (isStablePool ? 5 : 2) : 6;

  const pricePerText = `${denominationBase} per ${quoteTokenSymbol}`;

  const displayCurrentPrice = useMemo(() => {
    if (!currentPrice) return null;
    const numeric = parseFloat(currentPrice);
    if (!isFinite(numeric)) return currentPrice;
    const price = shouldInvert ? (1 / numeric) : numeric;
    return price.toFixed(poolPriceDecimals);
  }, [currentPrice, shouldInvert, poolPriceDecimals]);

  // Use denomination-utils for tick -> price conversion
  const calculatePriceFromTick = (tick: number): string => {
    if (!currentPrice || currentPoolTick === null || isNaN(tick)) return "0";

    const result = convertTickToPrice(
      tick,
      currentPoolTick,
      currentPrice,
      denominationBase,
      token0Symbol,
      token1Symbol
    );

    if (!result) return "0";

    const decimals = denominationToken?.decimals ?? 18;
    const numericResult = parseFloat(result);
    return isFinite(numericResult) ? numericResult.toFixed(decimals) : "0";
  };

  // Use lib/liquidity utility for price -> tick conversion
  const localConvertPriceToTick = (priceStr: string, isMinPrice: boolean): number | null => {
    if (!currentPrice || currentPoolTick === null) return null;

    return convertPriceToValidTick({
      priceString: priceStr,
      isMaxPrice: !isMinPrice,
      baseToken: denominationBase,
      token0Symbol,
      tickSpacing: defaultTickSpacing,
      minTick: sdkMinTick,
      maxTick: sdkMaxTick,
      currentPrice,
      currentPoolTick,
    });
  };

  const detectedPreset = useMemo(() => {
    // Use centralized full-range detection
    if (isFullRangePosition(defaultTickSpacing, parseInt(localTickLower), parseInt(localTickUpper))) {
      return "Full Range";
    }

    if (!currentPoolTick) return null;

    // Check all percentage presets (use decimal form for tick calculation)
    for (const [preset, pct] of Object.entries(PRESET_PERCENTAGES)) {
      const percentage = pct / 100;
      const tickDelta = Math.round(Math.log(1 + percentage) / Math.log(1.0001));
      const expectedLower = Math.floor((currentPoolTick - tickDelta) / defaultTickSpacing) * defaultTickSpacing;
      const expectedUpper = Math.ceil((currentPoolTick + tickDelta) / defaultTickSpacing) * defaultTickSpacing;
      const clampedLower = Math.max(sdkMinTick, expectedLower);
      const clampedUpper = Math.min(sdkMaxTick, expectedUpper);

      if (localTickLower === clampedLower.toString() && localTickUpper === clampedUpper.toString()) {
        return preset;
      }
    }

    return null;
  }, [localTickLower, localTickUpper, currentPoolTick, sdkMinTick, sdkMaxTick, defaultTickSpacing]);

  const activePreset = selectedPreset !== undefined ? selectedPreset : detectedPreset;

  const wasOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    if (isOpen && !wasOpen) {
      setLocalTickLower(initialTickLower);
      setLocalTickUpper(initialTickUpper);
      setLocalXDomain(xDomain);
      setSelectedPreset(initialActivePreset !== undefined ? initialActivePreset : null);
      const optimalDenom = getOptimalBaseToken(token0Symbol, token1Symbol, currentPrice ? parseFloat(currentPrice) : undefined);
      setDenominationBase(baseTokenSymbol || optimalDenom);
      
      const minPrice = shouldInvert
        ? calculatePriceFromTick(parseInt(initialTickUpper))
        : calculatePriceFromTick(parseInt(initialTickLower));
      const maxPrice = shouldInvert
        ? calculatePriceFromTick(parseInt(initialTickLower))
        : calculatePriceFromTick(parseInt(initialTickUpper));
      
      setMinPriceFullPrecision(minPrice);
      setMaxPriceFullPrecision(maxPrice);
      setMinPriceInput(abbreviateDecimal(minPrice));
      setMaxPriceInput(abbreviateDecimal(maxPrice));
    }
    wasOpenRef.current = isOpen;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- calculatePriceFromTick is intentionally excluded (unstable ref, deps captured via currentPrice/shouldInvert)
  }, [isOpen, initialTickLower, initialTickUpper, initialActivePreset, xDomain, token0Symbol, token1Symbol, currentPrice, baseTokenSymbol, shouldInvert]);

  useEffect(() => {
    if (isOpen && initialFocusField) {
      const timeoutId = setTimeout(() => {
        if (initialFocusField === 'min' && minPriceInputRef.current) {
          minPriceInputRef.current.focus();
          minPriceInputRef.current.select();
        } else if (initialFocusField === 'max' && maxPriceInputRef.current) {
          maxPriceInputRef.current.focus();
          maxPriceInputRef.current.select();
        }
      }, 100);
      
      return () => clearTimeout(timeoutId);
    }
  }, [isOpen, initialFocusField]);

  useEffect(() => {
    if (!isOpen) return;
    const handleGlobalPointerDown = (e: Event) => {
      const node = containerRef.current;
      if (!node) return;
      const target = e.target as Node | null;
      if (target && !node.contains(target)) {
        e.preventDefault();
        e.stopPropagation();
        swallowNextClick();
        onClose();
      }
    };
    document.addEventListener('pointerdown', handleGlobalPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handleGlobalPointerDown, true);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;

    const minPrice = shouldInvert
      ? calculatePriceFromTick(parseInt(localTickUpper))
      : calculatePriceFromTick(parseInt(localTickLower));
    const maxPrice = shouldInvert
      ? calculatePriceFromTick(parseInt(localTickLower))
      : calculatePriceFromTick(parseInt(localTickUpper));

    setMinPriceFullPrecision(minPrice);
    setMaxPriceFullPrecision(maxPrice);

    // Update inputs if not focused, OR if dragging chart (override focus to show live values)
    if (!isMinPriceFocused || isDraggingChart) {
      setMinPriceInput(abbreviateDecimal(minPrice));
    }
    if (!isMaxPriceFocused || isDraggingChart) {
      setMaxPriceInput(abbreviateDecimal(maxPrice));
    }
  }, [localTickLower, localTickUpper, denominationBase, shouldInvert, isMinPriceFocused, isMaxPriceFocused, isDraggingChart, isOpen]);

  useEffect(() => {
    const poolMetrics = poolMetricsData?.metrics;
    const poolLiquidity = poolMetricsData?.poolLiquidity;

    if (!isOpen || !poolMetrics || !poolLiquidity || currentPoolTick === null || !currentPoolSqrtPriceX96 || !poolToken0 || !poolToken1 || !selectedPoolId) {
      return;
    }

    const calculateAPYs = async () => {
      try {
        const poolConfig = getPoolById(selectedPoolId);
        if (!poolConfig) return;

        const effectiveChainId = chainId || getChainId();
        const token0 = new Token(
          effectiveChainId,
          poolToken0.address as `0x${string}`,
          poolToken0.decimals,
          poolToken0.symbol
        );
        const token1 = new Token(
          effectiveChainId,
          poolToken1.address as `0x${string}`,
          poolToken1.decimals,
          poolToken1.symbol
        );

        const pool = new V4Pool(
          token0,
          token1,
          poolConfig.fee,
          poolConfig.tickSpacing,
          poolConfig.hooks,
          JSBI.BigInt(currentPoolSqrtPriceX96),
          JSBI.BigInt(poolLiquidity),
          currentPoolTick
        );

        const actualTickSpacing = poolConfig.tickSpacing;
        const isStable = presetOptions.includes("±0.5%");
        const rangeTypes = isStable ? RANGE_TYPES_STABLE : RANGE_TYPES_STANDARD;

        const metrics: PoolMetrics = {
          totalFeesToken0: poolMetrics.totalFeesToken0,
          avgTVLToken0: poolMetrics.avgTVLToken0,
          days: poolMetrics.days
        };

        const newAprValues: Record<string, string> = {};

        for (const rangeType of rangeTypes) {
          if (rangeType === "Custom") continue;

          let tickLower, tickUpper;

          if (rangeType === "Full Range") {
            const alignedMinTick = Math.ceil(sdkMinTick / actualTickSpacing) * actualTickSpacing;
            const alignedMaxTick = Math.floor(sdkMaxTick / actualTickSpacing) * actualTickSpacing;
            tickLower = alignedMinTick;
            tickUpper = alignedMaxTick;
          } else {
            const pct = PRESET_PERCENTAGES[rangeType];
            if (pct && currentPoolTick !== null) {
              const pctDecimal = pct / 100;
              const tickDelta = Math.round(Math.log(1 + pctDecimal) / Math.log(1.0001));
              const expectedLower = Math.floor((currentPoolTick - tickDelta) / actualTickSpacing) * actualTickSpacing;
              const expectedUpper = Math.ceil((currentPoolTick + tickDelta) / actualTickSpacing) * actualTickSpacing;
              tickLower = Math.max(sdkMinTick, expectedLower);
              tickUpper = Math.min(sdkMaxTick, expectedUpper);
            } else {
              continue;
            }
          }

          const apr = await calculatePositionApr(pool, tickLower, tickUpper, metrics, 100);
          newAprValues[rangeType] = formatApr(apr);
        }

        const customTickLower = parseInt(localTickLower);
        const customTickUpper = parseInt(localTickUpper);
        if (!isNaN(customTickLower) && !isNaN(customTickUpper) && customTickLower < customTickUpper) {
          const customAPR = await calculatePositionApr(pool, customTickLower, customTickUpper, metrics, 100);
          newAprValues["Custom"] = formatApr(customAPR);
        }

        setAprValues(newAprValues);
      } catch (error) {
        console.error('[RangeSelectionModalV2] APR calculation error:', error);
      }
    };

    calculateAPYs();
  }, [isOpen, poolMetricsData, currentPoolTick, currentPoolSqrtPriceX96, poolToken0, poolToken1, selectedPoolId, chainId, presetOptions, sdkMinTick, sdkMaxTick, localTickLower, localTickUpper]);

  const handlePresetClick = (preset: string) => {
    setSelectedPreset(preset);
    if (preset === "Full Range") {
      setLocalTickLower(sdkMinTick.toString());
      setLocalTickUpper(sdkMaxTick.toString());
      return;
    }
    if (currentPoolTick === null) return;

    const pct = PRESET_PERCENTAGES[preset];
    if (!pct) return;

    const [rawLower, rawUpper] = calculateTicksFromPercentage(pct, pct, currentPoolTick, defaultTickSpacing);
    const lower = Math.max(sdkMinTick, rawLower);
    const upper = Math.min(sdkMaxTick, rawUpper);
    setLocalTickLower(lower.toString());
    setLocalTickUpper(upper.toString());
  };

  const adjustTick = (isMin: boolean, increment: boolean) => {
    const lower = parseInt(localTickLower);
    const upper = parseInt(localTickUpper);

    if (isMin) {
      const newTick = shouldInvert
        ? (increment ? Math.max(lower + defaultTickSpacing, upper - defaultTickSpacing) : Math.min(sdkMaxTick, upper + defaultTickSpacing))
        : (increment ? Math.min(upper - defaultTickSpacing, lower + defaultTickSpacing) : Math.max(sdkMinTick, lower - defaultTickSpacing));
      shouldInvert ? setLocalTickUpper(newTick.toString()) : setLocalTickLower(newTick.toString());
    } else {
      const newTick = shouldInvert
        ? (increment ? Math.max(sdkMinTick, lower - defaultTickSpacing) : Math.min(upper - defaultTickSpacing, lower + defaultTickSpacing))
        : (increment ? Math.min(sdkMaxTick, upper + defaultTickSpacing) : Math.max(lower + defaultTickSpacing, upper - defaultTickSpacing));
      if (!shouldInvert || newTick < upper) {
        shouldInvert ? setLocalTickLower(newTick.toString()) : setLocalTickUpper(newTick.toString());
      }
    }
    
    setSelectedPreset(null);
  };

  // Don't render portal until mounted (SSR safety)
  if (!mounted) return null;

  // Shared inner content for both mobile and desktop
  const innerContent = (
    <div className="rounded-lg bg-muted/10 border-0 transition-colors flex flex-col flex-1 min-h-0">
          {/* Header - Alphix Style (no X button on mobile, use drag handle) */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-sidebar-border/60 flex-shrink-0">
            <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">SET PRICE RANGE</h2>
            {!isMobile && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-6 w-6 -mr-1 text-muted-foreground hover:text-foreground"
              >
                <span className="text-lg">×</span>
              </Button>
            )}
          </div>

          {/* Content */}
          <div
            className={`overflow-y-auto overscroll-contain touch-pan-y px-4 pt-4 flex-1 min-h-0 ${isMobile ? 'space-y-3' : 'space-y-4'}`}
            style={{ WebkitOverflowScrolling: 'touch' as any }}
          >
            {/* Pool Price + Help Link */}
            {currentPrice && (
              <div className="flex gap-3">
                <div className={`rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-4 ${isMobile ? 'flex-1' : ''}`} style={isMobile ? undefined : { width: '50%' }}>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-muted-foreground">Pool Price</span>
                      <div
                        className="flex gap-1.5 items-center cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => setDenominationBase(denominationBase === token0Symbol ? token1Symbol : token0Symbol)}
                      >
                        {denominationToken?.icon && (
                          <Image src={denominationToken.icon} alt={denominationBase} width={14} height={14} className="rounded-full" />
                        )}
                        <span className="text-xs font-semibold">{denominationBase}</span>
                        <ArrowLeftRight className="h-3 w-3" />
                      </div>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-semibold" style={{ fontSize: '16px' }}>{displayCurrentPrice}</span>
                      <span className="text-xs text-muted-foreground">{pricePerText}</span>
                    </div>
                  </div>
                </div>

                {!isMobile && (
                  <div className="flex-1 flex items-start justify-end pt-1">
                    <a
                      href="https://alphix.gitbook.io/docs/quick-start/liquidity#adding--managing-liquidity"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer hover:underline"
                    >
                      <CircleHelp className="h-3.5 w-3.5" />
                      <span>Help</span>
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Range Types */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-muted-foreground">Range Types</span>
              <div className={`grid gap-2 ${isMobile ? 'grid-cols-2' : 'grid-cols-4'}`}>
                {(() => {
                  const isStable = presetOptions.includes("±0.5%");
                  const rangeTypes = isStable ? RANGE_TYPES_STABLE : RANGE_TYPES_STANDARD;

                  return rangeTypes.map((rangeType) => {
                    // ±3% is "Wide" for stable pools (since ±0.5% is the narrow), "Narrow" for standard
                    const label = rangeType === "±3%" && isStable ? "Wide" : (RANGE_LABELS[rangeType] || rangeType);

                    // Custom is active when no preset matches the displayed range types
                    const isActive = rangeType === "Custom"
                      ? !rangeTypes.slice(0, -1).includes(activePreset || "")
                      : activePreset === rangeType;

                  // Get APR for this range type from precomputed values
                  let aprDisplay = "";
                  // Only show APR for Custom if it's the active preset
                  const shouldShowAPR = rangeType !== "Custom" || (rangeType === "Custom" && isActive);

                  if (shouldShowAPR) {
                    // Show "..." while waiting for parent metrics or calculating
                    if (!poolMetricsData || !aprValues[rangeType]) {
                      aprDisplay = "...";
                    } else {
                      aprDisplay = aprValues[rangeType];
                    }
                  }

                  return (
                    <div
                      key={rangeType}
                      onClick={() => rangeType !== "Custom" && handlePresetClick(rangeType)}
                      className={`relative ${isMobile ? 'h-10 px-3' : 'h-12 px-4'} flex items-center justify-between rounded-md border transition-all duration-200 overflow-hidden ${
                        rangeType === "Custom"
                          ? `cursor-default ${isActive ? 'text-sidebar-primary border-sidebar-primary bg-button-primary' : 'border-sidebar-border/50 bg-muted/20 text-muted-foreground'}`
                          : `cursor-pointer ${isActive ? 'text-sidebar-primary border-sidebar-primary bg-button-primary' : 'border-sidebar-border bg-button hover:bg-accent hover:brightness-110 hover:border-white/30 text-white'}`
                      }`}
                      style={!isActive && rangeType !== "Custom" ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                    >
                      <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium relative z-10`}>{label}</span>
                      <span className="text-xs text-muted-foreground relative z-10">{aprDisplay}</span>
                    </div>
                  );
                });
              })()}
              </div>
            </div>

            {/* Interactive Chart */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-muted-foreground">Range Preview</span>
                {isMobile && (
                  <div className="flex items-center gap-1 rounded-full border border-sidebar-border/60 bg-muted/20 p-0.5">
                    <button
                      onClick={() => setMobileViewMode('chart')}
                      className={`flex items-center justify-center rounded-full transition-all ${
                        mobileViewMode === 'chart'
                          ? 'bg-muted/40 text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      style={{ padding: '4px 8px' }}
                    >
                      <IconChartBarAxisX className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setMobileViewMode('inputs')}
                      className={`flex items-center justify-center rounded-full transition-all ${
                        mobileViewMode === 'inputs'
                          ? 'bg-muted/40 text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      style={{ padding: '4px 8px' }}
                    >
                      <IconPen2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <div className={`rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 pt-4 px-4 pb-2 ${isMobile && mobileViewMode === 'inputs' ? 'hidden' : ''}`}>
                <div style={{ height: isMobile ? '140px' : '180px' }} className="relative">
                  {isChartLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-muted/10 rounded">
                      <Image
                        src="/LogoIconWhite.svg"
                        alt="Loading"
                        width={32}
                        height={32}
                        className="animate-pulse opacity-75"
                      />
                    </div>
                  )}
                  <InteractiveRangeChart
                    selectedPoolId={selectedPoolId}
                    chainId={chainId}
                    token0Symbol={token0Symbol}
                    token1Symbol={token1Symbol}
                    currentPoolTick={currentPoolTick}
                    currentPrice={currentPrice}
                    currentPoolSqrtPriceX96={currentPoolSqrtPriceX96}
                    tickLower={localTickLower}
                    tickUpper={localTickUpper}
                    xDomain={localXDomain}
                    onRangeChange={(newLower, newUpper) => { setLocalTickLower(newLower); setLocalTickUpper(newUpper); setSelectedPreset(null); }}
                    onXDomainChange={(newDomain) => setLocalXDomain(newDomain)}
                    sdkMinTick={sdkMinTick}
                    sdkMaxTick={sdkMaxTick}
                    defaultTickSpacing={defaultTickSpacing}
                    poolToken0={poolToken0}
                    poolToken1={poolToken1}
                    readOnly={false}
                    forceDenominationBase={denominationBase}
                    onLoadingChange={setIsChartLoading}
                    onDragStateChange={(dragState) => setIsDraggingChart(dragState !== null)}
                  />
                </div>
              </div>
            </div>

            {/* Compact Price Display - shown in chart mode on mobile */}
            {isMobile && mobileViewMode === 'chart' && (
              <div className="grid grid-cols-2 gap-2">
                <div
                  className="rounded-lg border border-sidebar-border bg-muted/30 p-3 cursor-pointer active:bg-muted/50 transition-colors"
                  onClick={() => setMobileViewMode('inputs')}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">Min Price</span>
                  </div>
                  <div className="font-semibold text-sm truncate">{abbreviateDecimal(minPriceFullPrecision, 6)}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{pricePerText}</div>
                </div>
                <div
                  className="rounded-lg border border-sidebar-border bg-muted/30 p-3 cursor-pointer active:bg-muted/50 transition-colors"
                  onClick={() => setMobileViewMode('inputs')}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">Max Price</span>
                  </div>
                  <div className="font-semibold text-sm truncate">{abbreviateDecimal(maxPriceFullPrecision, 6)}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{pricePerText}</div>
                </div>
              </div>
            )}

            {/* Price Inputs - Two Cards Side by Side (stacked on mobile) */}
            <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'} ${isMobile && mobileViewMode === 'chart' ? 'hidden' : ''}`}>
              {/* Min Price Card */}
              <div className={`rounded-lg border border-sidebar-border bg-muted/30 ${isMobile ? 'p-3' : 'p-4'}`}>
                <div className={isMobile ? 'space-y-1' : 'space-y-3'}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-muted-foreground">Min Price</span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => adjustTick(true, false)}
                        className={`${isMobile ? 'h-6 w-6' : 'h-7 w-7'} rounded-md transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed`}
                        style={{ backgroundColor: 'rgba(64, 64, 64, 0.4)' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(113, 113, 122, 0.4)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(64, 64, 64, 0.4)'}
                        disabled={parseInt(localTickLower) <= sdkMinTick}
                      >
                        <IconMinus className={isMobile ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
                      </button>
                      <button
                        onClick={() => adjustTick(true, true)}
                        className={`${isMobile ? 'h-6 w-6' : 'h-7 w-7'} rounded-md transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed`}
                        style={{ backgroundColor: 'rgba(64, 64, 64, 0.4)' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(113, 113, 122, 0.4)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(64, 64, 64, 0.4)'}
                        disabled={parseInt(localTickLower) >= parseInt(localTickUpper) - defaultTickSpacing}
                      >
                        <IconPlus className={isMobile ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
                      </button>
                    </div>
                  </div>
                  <Input
                    ref={minPriceInputRef}
                    type="text"
                    inputMode="decimal"
                    value={minPriceInput}
                    onChange={(e) => {
                      const value = e.target.value.replace(',', '.');
                      setMinPriceInput(value);
                      setMinPriceFullPrecision(value);
                    }}
                    onFocus={() => {
                      setIsMinPriceFocused(true);
                      // Show full precision on focus
                      if (minPriceFullPrecision && minPriceInput.includes('...')) {
                        setMinPriceInput(minPriceFullPrecision);
                      }
                    }}
                    onBlur={() => {
                      setIsMinPriceFocused(false);
                      // Convert typed price to tick and update state
                      const newTick = localConvertPriceToTick(minPriceFullPrecision, !shouldInvert);
                      if (newTick !== null) {
                        const targetTick = shouldInvert ? localTickLower : localTickUpper;
                        const isValid = shouldInvert
                          ? newTick > parseInt(targetTick)
                          : newTick < parseInt(targetTick);
                        if (isValid) {
                          if (shouldInvert) {
                            setLocalTickUpper(newTick.toString());
                          } else {
                            setLocalTickLower(newTick.toString());
                          }
                          setSelectedPreset(null);
                          const snappedPrice = calculatePriceFromTick(newTick);
                          setMinPriceFullPrecision(snappedPrice);
                          setMinPriceInput(abbreviateDecimal(snappedPrice));
                          return;
                        }
                      }
                      // If conversion failed or invalid, revert to current tick's price
                      const currentTick = shouldInvert ? parseInt(localTickUpper) : parseInt(localTickLower);
                      const revertedPrice = calculatePriceFromTick(currentTick);
                      setMinPriceFullPrecision(revertedPrice);
                      setMinPriceInput(abbreviateDecimal(revertedPrice));
                    }}
                    className="font-semibold border-0 bg-transparent px-0 py-2 focus-visible:ring-0 focus-visible:ring-offset-0 cursor-text min-h-[44px] touch-manipulation"
                    style={{ fontSize: isMobile ? '16px' : '18px' }}
                    placeholder="0"
                    autoComplete="off"
                  />
                  <div className="text-xs text-muted-foreground">{pricePerText}</div>
                </div>
              </div>

              {/* Max Price Card */}
              <div className={`rounded-lg border border-sidebar-border bg-muted/30 ${isMobile ? 'p-3' : 'p-4'}`}>
                <div className={isMobile ? 'space-y-1' : 'space-y-3'}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-muted-foreground">Max Price</span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => adjustTick(false, false)}
                        className={`${isMobile ? 'h-6 w-6' : 'h-7 w-7'} rounded-md transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed`}
                        style={{ backgroundColor: 'rgba(64, 64, 64, 0.4)' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(113, 113, 122, 0.4)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(64, 64, 64, 0.4)'}
                        disabled={parseInt(localTickUpper) <= parseInt(localTickLower) + defaultTickSpacing}
                      >
                        <IconMinus className={isMobile ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
                      </button>
                      <button
                        onClick={() => adjustTick(false, true)}
                        className={`${isMobile ? 'h-6 w-6' : 'h-7 w-7'} rounded-md transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed`}
                        style={{ backgroundColor: 'rgba(64, 64, 64, 0.4)' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(113, 113, 122, 0.4)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(64, 64, 64, 0.4)'}
                        disabled={parseInt(localTickUpper) >= sdkMaxTick}
                      >
                        <IconPlus className={isMobile ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
                      </button>
                    </div>
                  </div>
                  <Input
                    ref={maxPriceInputRef}
                    type="text"
                    inputMode="decimal"
                    value={maxPriceInput}
                    onChange={(e) => {
                      const value = e.target.value.replace(',', '.');
                      setMaxPriceInput(value);
                      setMaxPriceFullPrecision(value);
                    }}
                    onFocus={() => {
                      setIsMaxPriceFocused(true);
                      // Show full precision on focus
                      if (maxPriceFullPrecision && maxPriceInput.includes('...')) {
                        setMaxPriceInput(maxPriceFullPrecision);
                      }
                    }}
                    onBlur={() => {
                      setIsMaxPriceFocused(false);
                      // Convert typed price to tick and update state
                      const newTick = localConvertPriceToTick(maxPriceFullPrecision, shouldInvert);
                      if (newTick !== null) {
                        const targetTick = shouldInvert ? localTickUpper : localTickLower;
                        const isValid = shouldInvert
                          ? newTick < parseInt(targetTick)
                          : newTick > parseInt(targetTick);
                        if (isValid) {
                          if (shouldInvert) {
                            setLocalTickLower(newTick.toString());
                          } else {
                            setLocalTickUpper(newTick.toString());
                          }
                          setSelectedPreset(null);
                          const snappedPrice = calculatePriceFromTick(newTick);
                          setMaxPriceFullPrecision(snappedPrice);
                          setMaxPriceInput(abbreviateDecimal(snappedPrice));
                          return;
                        }
                      }
                      // If conversion failed or invalid, revert to current tick's price
                      const currentTick = shouldInvert ? parseInt(localTickLower) : parseInt(localTickUpper);
                      const revertedPrice = calculatePriceFromTick(currentTick);
                      setMaxPriceFullPrecision(revertedPrice);
                      setMaxPriceInput(abbreviateDecimal(revertedPrice));
                    }}
                    className="font-semibold border-0 bg-transparent px-0 py-2 focus-visible:ring-0 focus-visible:ring-offset-0 cursor-text min-h-[44px] touch-manipulation"
                    style={{ fontSize: isMobile ? '16px' : '18px' }}
                    placeholder="0"
                    autoComplete="off"
                  />
                  <div className="text-xs text-muted-foreground">{pricePerText}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 px-4 pb-4 mt-3">
            <Button
              variant="ghost"
              onClick={onClose}
              className="relative flex h-10 flex-1 cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:bg-accent hover:brightness-110 hover:border-white/30 text-white"
              style={{ backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                onConfirm(localTickLower, localTickUpper, activePreset, denominationBase);
                onClose();
              }}
              className="relative flex h-10 flex-1 cursor-pointer items-center justify-center rounded-md border border-sidebar-primary bg-button-primary hover:bg-button-primary/90 px-3 text-sm font-medium transition-all duration-200 text-sidebar-primary"
            >
              Confirm
            </Button>
          </div>
    </div>
  );

  // Mobile: Bottom Sheet with drag-to-dismiss
  if (isMobile) {
    return (
      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="bottom"
          ref={sheetContentRef}
          tabIndex={-1}
          className="rounded-t-2xl border-t border-primary p-0 flex flex-col bg-popover [&>button]:hidden"
          style={{
            height: 'min(95dvh, 95vh)',
            maxHeight: 'min(95dvh, 95vh)',
            paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            transition: isSheetDragging ? "none" : "transform 160ms ease-out",
          }}
          onPointerDownOutside={() => onClose()}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            sheetInitialFocusRef.current?.focus?.();
          }}
        >
          <div className="flex flex-col flex-1 min-h-0">
            <div ref={sheetInitialFocusRef} tabIndex={-1} aria-hidden className="h-0 w-0 overflow-hidden" />
            {/* Drag handle */}
            <div
              className="flex items-center justify-center h-10 -mb-1 touch-none flex-shrink-0"
              onTouchStart={onSheetHandleTouchStart}
              onTouchMove={onSheetHandleTouchMove}
              onTouchEnd={onSheetHandleTouchEnd}
            >
              <div className="h-1.5 w-12 rounded-full bg-muted-foreground/30" />
            </div>
            {innerContent}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: Portal modal with AnimatePresence
  const desktopModalContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[9999] flex justify-center backdrop-blur-md cursor-default items-center"
          style={{
            pointerEvents: 'auto',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              e.stopPropagation();
              swallowNextClick();
              onClose();
            }
          }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="relative rounded-lg border border-solid shadow-2xl flex flex-col cursor-default min-h-0 overflow-hidden"
            style={{
              width: '900px',
              maxWidth: '95vw',
              maxHeight: 'min(95dvh, 95vh)',
              backgroundColor: 'var(--modal-background)',
            }}
            role="dialog"
            aria-modal="true"
            ref={containerRef}
            onClick={(e) => e.stopPropagation()}
          >
            {innerContent}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return createPortal(desktopModalContent, document.body);
}
