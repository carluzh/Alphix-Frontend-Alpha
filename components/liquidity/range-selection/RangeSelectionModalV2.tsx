"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TokenSymbol, getToken, getChainId } from "@/lib/pools-config";
import { InteractiveRangeChart } from "../InteractiveRangeChart";
import { PlusIcon, MinusIcon, ArrowLeftRight, CircleHelp, ChartBarBig, SquarePen } from "lucide-react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { calculatePositionAPY, formatAPY, type PoolMetrics } from "@/lib/apy-calculator";
import { getPoolById } from "@/lib/pools-config";
import { getOptimalBaseToken } from "@/lib/denomination-utils";
import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';
import { useIsMobile } from '@/hooks/use-mobile';

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
    xDomain, onXDomainChange, poolToken0, poolToken1, presetOptions,
    isInverted = false,
    initialFocusField = null,
    poolMetricsData = null
  } = props;

  const isMobile = useIsMobile();
  const containerRef = useRef<HTMLDivElement>(null);
  const suppressNextClick = useRef(false);
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
  const [isDragging, setIsDragging] = useState(false);

  const [isMinPriceFocused, setIsMinPriceFocused] = useState(false);
  const [isMaxPriceFocused, setIsMaxPriceFocused] = useState(false);
  const [mobileViewMode, setMobileViewMode] = useState<'chart' | 'inputs'>('chart');

  const initialDenomination = useMemo(() => {
    const currentPriceNum = currentPrice ? parseFloat(currentPrice) : undefined;
    return getOptimalBaseToken(token0Symbol, token1Symbol, currentPriceNum);
  }, [token0Symbol, token1Symbol, currentPrice]);

  const [denominationBase, setDenominationBase] = useState<TokenSymbol>(initialDenomination);

  const [apyValues, setApyValues] = useState<Record<string, number>>({});

  const shouldInvert = denominationBase === token0Symbol;

  const denominationToken = getToken(denominationBase);
  const quoteTokenSymbol = denominationBase === token0Symbol ? token1Symbol : token0Symbol;

  const isUSDDenom = ['aUSDT', 'aUSDC', 'USDT', 'USDC', 'aDAI', 'DAI'].includes(denominationBase);
  const poolPriceDecimals = isUSDDenom ? 2 : 6;

  const pricePerText = `${denominationBase} per ${quoteTokenSymbol}`;

  const displayCurrentPrice = useMemo(() => {
    if (!currentPrice) return null;
    const numeric = parseFloat(currentPrice);
    if (!isFinite(numeric)) return currentPrice;
    const price = shouldInvert ? (1 / numeric) : numeric;
    return price.toFixed(poolPriceDecimals);
  }, [currentPrice, shouldInvert, poolPriceDecimals]);

  const calculatePriceFromTick = (tick: number): string => {
    if (!currentPrice || currentPoolTick === null || isNaN(tick)) return "0";
    const currentPriceNum = parseFloat(currentPrice);
    const priceDelta = Math.pow(1.0001, tick - currentPoolTick);

    let price = shouldInvert 
      ? 1 / (currentPriceNum * priceDelta)
      : currentPriceNum * priceDelta;

    if (!isFinite(price) || isNaN(price)) return "0";

    const decimals = denominationToken?.decimals ?? 18;
    return price.toFixed(decimals);
  };

  const detectedPreset = useMemo(() => {
    const alignedMinTick = Math.ceil(sdkMinTick / defaultTickSpacing) * defaultTickSpacing;
    const alignedMaxTick = Math.floor(sdkMaxTick / defaultTickSpacing) * defaultTickSpacing;

    if (localTickLower === alignedMinTick.toString() && localTickUpper === alignedMaxTick.toString()) {
      return "Full Range";
    }

    if (!currentPoolTick) return null;

    const percentageMap: Record<string, number> = {
      "±15%": 0.15, "±8%": 0.08, "±3%": 0.03,
    };

    for (const [preset, percentage] of Object.entries(percentageMap)) {
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

  useEffect(() => {
    if (isOpen) {
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
  }, [isOpen, initialTickLower, initialTickUpper, initialActivePreset, xDomain, token1Symbol]);

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

    if (!isMinPriceFocused) {
      setMinPriceInput(abbreviateDecimal(minPrice));
    }
    if (!isMaxPriceFocused) {
      setMaxPriceInput(abbreviateDecimal(maxPrice));
    }
  }, [localTickLower, localTickUpper, denominationBase, shouldInvert, isMinPriceFocused, isMaxPriceFocused, isOpen]);

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
        const rangeTypes = isStable
          ? ["Full Range", "±3%", "±0.5%", "Custom"]
          : ["Full Range", "±15%", "±3%", "Custom"];

        const metrics: PoolMetrics = {
          totalFeesToken0: poolMetrics.totalFeesToken0,
          avgTVLToken0: poolMetrics.avgTVLToken0,
          days: poolMetrics.days
        };

        const newApyValues: Record<string, number> = {};

        for (const rangeType of rangeTypes) {
          if (rangeType === "Custom") continue;

          let tickLower, tickUpper;

          if (rangeType === "Full Range") {
            const alignedMinTick = Math.ceil(sdkMinTick / actualTickSpacing) * actualTickSpacing;
            const alignedMaxTick = Math.floor(sdkMaxTick / actualTickSpacing) * actualTickSpacing;
            tickLower = alignedMinTick;
            tickUpper = alignedMaxTick;
          } else {
            const percentages: Record<string, number> = {
              "±15%": 0.15,
              "±3%": 0.03,
              "±0.5%": 0.005
            };
            const pct = percentages[rangeType];
            if (pct && currentPoolTick !== null) {
              const tickDelta = Math.round(Math.log(1 + pct) / Math.log(1.0001));
              const expectedLower = Math.floor((currentPoolTick - tickDelta) / actualTickSpacing) * actualTickSpacing;
              const expectedUpper = Math.ceil((currentPoolTick + tickDelta) / actualTickSpacing) * actualTickSpacing;
              tickLower = Math.max(sdkMinTick, expectedLower);
              tickUpper = Math.min(sdkMaxTick, expectedUpper);
            } else {
              continue;
            }
          }

          const apy = await calculatePositionAPY(pool, tickLower, tickUpper, metrics, 100);
          newApyValues[rangeType] = apy;
        }

        const customTickLower = parseInt(localTickLower);
        const customTickUpper = parseInt(localTickUpper);
        if (!isNaN(customTickLower) && !isNaN(customTickUpper) && customTickLower < customTickUpper) {
          const customAPY = await calculatePositionAPY(pool, customTickLower, customTickUpper, metrics, 100);
          newApyValues["Custom"] = customAPY;
        }

        setApyValues(newApyValues);
      } catch (error) {
        console.error('[RangeSelectionModalV2] APY calculation error:', error);
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
    
    const percentages: Record<string, number> = {
      "±15%": 0.15, "±8%": 0.08, "±3%": 0.03, "±1%": 0.01, "±0.5%": 0.005, "±0.1%": 0.001
    };
    const pct = percentages[preset];
    if (!pct) return;
    
    const delta = Math.round(Math.log(1 + pct) / Math.log(1.0001));
    const lower = Math.max(sdkMinTick, Math.floor((currentPoolTick - delta) / defaultTickSpacing) * defaultTickSpacing);
    const upper = Math.min(sdkMaxTick, Math.ceil((currentPoolTick + delta) / defaultTickSpacing) * defaultTickSpacing);
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
    
    // Clear preset when manually adjusting, same as dragging
    setSelectedPreset(null);
  };

  const handleReset = () => {
    if (currentPoolTick === null) return;
    const delta = Math.round(Math.log(1.15) / Math.log(1.0001));
    setLocalTickLower(Math.max(sdkMinTick, Math.floor((currentPoolTick - delta) / defaultTickSpacing) * defaultTickSpacing).toString());
    setLocalTickUpper(Math.min(sdkMaxTick, Math.ceil((currentPoolTick + delta) / defaultTickSpacing) * defaultTickSpacing).toString());
  };

  // Don't render portal until mounted (SSR safety)
  if (!mounted) return null;

  // Shared inner content for both mobile and desktop
  const innerContent = (
    <div className="rounded-lg bg-muted/10 border-0 transition-colors flex flex-col flex-1 min-h-0">
          {/* Header - Alphix Style */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-sidebar-border/60 flex-shrink-0">
            <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">SET PRICE RANGE</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-6 w-6 -mr-1 text-muted-foreground hover:text-foreground"
            >
              <span className="text-lg">×</span>
            </Button>
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
                  // Determine which range types to show based on presetOptions
                  const isStable = presetOptions.includes("±0.5%");
                  const rangeTypes = isStable
                    ? ["Full Range", "±3%", "±0.5%", "Custom"]
                    : ["Full Range", "±15%", "±3%", "Custom"];

                  return rangeTypes.map((rangeType) => {
                    const labels: Record<string, string> = {
                      "Full Range": "Full Range",
                      "±15%": "Wide",
                      "±3%": isStable ? "Wide" : "Narrow",
                      "±0.5%": "Narrow",
                      "Custom": "Custom"
                    };

                    // Custom is active when no preset matches the displayed range types
                    const isActive = rangeType === "Custom"
                      ? !rangeTypes.slice(0, -1).includes(activePreset || "")
                      : activePreset === rangeType;

                  // Get APY for this range type from precomputed values
                  let apyDisplay = "";
                  // Only show APY for Custom if it's the active preset
                  const shouldShowAPY = rangeType !== "Custom" || (rangeType === "Custom" && isActive);

                  if (shouldShowAPY) {
                    // Show "..." while waiting for parent metrics or calculating
                    if (!poolMetricsData || apyValues[rangeType] === undefined) {
                      apyDisplay = "...";
                    } else {
                      apyDisplay = formatAPY(apyValues[rangeType]);
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
                      <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-medium relative z-10`}>{labels[rangeType] || rangeType}</span>
                      <span className="text-xs text-muted-foreground relative z-10">{apyDisplay}</span>
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
                      <ChartBarBig className="h-3.5 w-3.5" />
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
                      <SquarePen className="h-3.5 w-3.5" />
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
                    onLoadingChange={(loading) => setIsChartLoading(loading)}
                    onDragStateChange={(state) => setIsDragging(state !== null)}
                  />
                </div>
              </div>
            </div>

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
                        <MinusIcon className={isMobile ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
                      </button>
                      <button
                        onClick={() => adjustTick(true, true)}
                        className={`${isMobile ? 'h-6 w-6' : 'h-7 w-7'} rounded-md transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed`}
                        style={{ backgroundColor: 'rgba(64, 64, 64, 0.4)' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(113, 113, 122, 0.4)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(64, 64, 64, 0.4)'}
                        disabled={parseInt(localTickLower) >= parseInt(localTickUpper) - defaultTickSpacing}
                      >
                        <PlusIcon className={isMobile ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
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
                      // Re-abbreviate on blur
                      setMinPriceInput(abbreviateDecimal(minPriceFullPrecision));
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
                        <MinusIcon className={isMobile ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
                      </button>
                      <button
                        onClick={() => adjustTick(false, true)}
                        className={`${isMobile ? 'h-6 w-6' : 'h-7 w-7'} rounded-md transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed`}
                        style={{ backgroundColor: 'rgba(64, 64, 64, 0.4)' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(113, 113, 122, 0.4)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(64, 64, 64, 0.4)'}
                        disabled={parseInt(localTickUpper) >= sdkMaxTick}
                      >
                        <PlusIcon className={isMobile ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
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
                      // Re-abbreviate on blur
                      setMaxPriceInput(abbreviateDecimal(maxPriceFullPrecision));
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
