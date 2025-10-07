"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TokenSymbol, getToken, TOKEN_DEFINITIONS } from "@/lib/pools-config";
import { InteractiveRangeChart } from "../InteractiveRangeChart";
import { PlusIcon, MinusIcon, ArrowLeftRight, CircleHelp } from "lucide-react";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import { calculatePositionAPY, formatAPY, type PoolMetrics } from "@/lib/apy-calculator";
import { getPoolById } from "@/lib/pools-config";
import { Token } from '@uniswap/sdk-core';
import { Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';
import JSBI from 'jsbi';

interface RangeSelectionModalV2Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (tickLower: string, tickUpper: string, selectedPreset?: string | null, denomination?: TokenSymbol) => void;
  initialTickLower: string;
  initialTickUpper: string;
  initialActivePreset?: string | null; // Pass current preset from form
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
}

// Helper to abbreviate decimal numbers beyond 10 decimals
const abbreviateDecimal = (value: string, maxDecimals: number = 10): string => {
  if (!value || value === "" || value === "0") return value;
  
  const parts = value.split('.');
  if (parts.length === 1) return value; // No decimal
  
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
    initialFocusField = null
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const suppressNextClick = useRef(false);
  const minPriceInputRef = useRef<HTMLInputElement>(null);
  const maxPriceInputRef = useRef<HTMLInputElement>(null);

  const swallowNextClick = () => {
    const handler = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    // Use capture so we beat React handlers; once so it auto-cleans
    document.addEventListener('click', handler, { capture: true, once: true } as any);
    document.addEventListener('mouseup', handler, { capture: true, once: true } as any);
    document.addEventListener('pointerup', handler, { capture: true, once: true } as any);
    document.addEventListener('touchend', handler, { capture: true, once: true } as any);
  };

  const [localTickLower, setLocalTickLower] = useState(initialTickLower);
  const [localTickUpper, setLocalTickUpper] = useState(initialTickUpper);
  const [localXDomain, setLocalXDomain] = useState<[number, number]>(xDomain);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  
  // Full precision values for backend
  const [minPriceFullPrecision, setMinPriceFullPrecision] = useState(minPriceDisplay);
  const [maxPriceFullPrecision, setMaxPriceFullPrecision] = useState(maxPriceDisplay);
  
  // Display values (abbreviated)
  const [minPriceInput, setMinPriceInput] = useState(abbreviateDecimal(minPriceDisplay));
  const [maxPriceInput, setMaxPriceInput] = useState(abbreviateDecimal(maxPriceDisplay));
  const [isChartLoading, setIsChartLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  // Track which input is focused
  const [isMinPriceFocused, setIsMinPriceFocused] = useState(false);
  const [isMaxPriceFocused, setIsMaxPriceFocused] = useState(false);

  // Local denomination toggle - independent of parent, defaults to token1
  const [denominationBase, setDenominationBase] = useState<TokenSymbol>(token1Symbol);

  // Pool metrics for APY calculation
  const [poolMetrics, setPoolMetrics] = useState<any>(null);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState(false);

  // Calculate if we need to invert based on our local denomination choice
  const shouldInvert = denominationBase === token0Symbol;

  // Get token configs
  const denominationToken = getToken(denominationBase);
  const quoteTokenSymbol = denominationBase === token0Symbol ? token1Symbol : token0Symbol;

  // Display decimals for current price (capped at 4 or 2 for USD)
  const isUSDDenom = ['aUSDT', 'aUSDC', 'USDT', 'USDC', 'aDAI', 'DAI'].includes(denominationBase);
  const poolPriceDecimals = isUSDDenom ? 2 : (denominationToken?.displayDecimals ?? 4);

  // Price label text - denomination is the unit, quote is what we're pricing
  const pricePerText = `${denominationBase} per ${quoteTokenSymbol}`;

  // Transform currentPrice for display
  const displayCurrentPrice = useMemo(() => {
    if (!currentPrice) return null;
    const numeric = parseFloat(currentPrice);
    if (!isFinite(numeric)) return currentPrice;
    const price = shouldInvert ? (1 / numeric) : numeric;
    return price.toFixed(poolPriceDecimals);
  }, [currentPrice, shouldInvert, poolPriceDecimals]);

  // Calculate price from tick with full precision
  const calculatePriceFromTick = (tick: number): string => {
    if (!currentPrice || currentPoolTick === null || isNaN(tick)) return "0";
    const currentPriceNum = parseFloat(currentPrice);
    const priceDelta = Math.pow(1.0001, tick - currentPoolTick);

    let price = shouldInvert 
      ? 1 / (currentPriceNum * priceDelta)
      : currentPriceNum * priceDelta;

    if (!isFinite(price) || isNaN(price)) return "0";

    // Return full precision (use token decimals)
    const decimals = denominationToken?.decimals ?? 18;
    return price.toFixed(decimals);
  };

  // Detect which preset matches current ticks (if any)
  const detectedPreset = useMemo(() => {
    // Check Full Range - need to align to tickSpacing first
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

  // Use manually selected preset if explicitly set (including null for "Custom")
  // Only fall back to detection if user hasn't made a manual selection
  const activePreset = selectedPreset !== undefined ? selectedPreset : detectedPreset;

  // Initialize modal state when opened
  useEffect(() => {
    if (isOpen) {
      setLocalTickLower(initialTickLower);
      setLocalTickUpper(initialTickUpper);
      setLocalXDomain(xDomain);
      // Use the preset passed from the form (deterministic)
      setSelectedPreset(initialActivePreset !== undefined ? initialActivePreset : undefined);
      setDenominationBase(baseTokenSymbol);
      
      // Calculate and set full precision values
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

  // Auto-focus input field based on initialFocusField
  useEffect(() => {
    if (isOpen && initialFocusField) {
      // Small delay to ensure modal is fully rendered
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

  // Global outside-click close (capturing phase to beat internal stops)
  useEffect(() => {
    if (!isOpen) return;
    const handleGlobalPointerDown = (e: Event) => {
      const node = containerRef.current;
      if (!node) return;
      const target = e.target as Node | null;
      if (target && !node.contains(target)) {
        // Prevent underlying click handlers from firing (reopen bug)
        e.preventDefault();
        e.stopPropagation();
        swallowNextClick();
        onClose();
      }
    };
    document.addEventListener('mousedown', handleGlobalPointerDown, true);
    document.addEventListener('touchstart', handleGlobalPointerDown, true);
    return () => {
      document.removeEventListener('mousedown', handleGlobalPointerDown, true);
      document.removeEventListener('touchstart', handleGlobalPointerDown, true);
    };
  }, [isOpen, onClose]);

  // Fetch pool metrics when modal opens
  useEffect(() => {
    if (!isOpen || !selectedPoolId) return;

    const fetchMetrics = async () => {
      setIsLoadingMetrics(true);
      try {
        // Try to fetch 7 days, but fall back to 1 day if no data
        let response = await fetch('/api/liquidity/pool-metrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ poolId: selectedPoolId, days: 7 })
        });

        if (response.ok) {
          const data = await response.json();
          console.log('[RangeSelectionModalV2] Pool metrics response (7d):', data);

          // If we got valid data, use it
          if (data.metrics && data.metrics.days > 0) {
            setPoolMetrics(data.metrics);
          } else {
            // Try with 1 day of data for new pools
            console.log('[RangeSelectionModalV2] No 7-day data, trying 1 day...');
            response = await fetch('/api/liquidity/pool-metrics', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ poolId: selectedPoolId, days: 1 })
            });

            if (response.ok) {
              const data1d = await response.json();
              console.log('[RangeSelectionModalV2] Pool metrics response (1d):', data1d);
              if (data1d.metrics && data1d.metrics.days > 0) {
                setPoolMetrics(data1d.metrics);
              }
            }
          }
        } else {
          console.error('[RangeSelectionModalV2] Pool metrics request failed:', response.status, await response.text());
        }
      } catch (error) {
        console.error('Failed to fetch pool metrics:', error);
      } finally {
        setIsLoadingMetrics(false);
      }
    };

    fetchMetrics();
  }, [isOpen, selectedPoolId]);

  // Update price inputs when ticks or denomination changes
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
    
    // Only update display if not focused
    if (!isMinPriceFocused) {
      setMinPriceInput(abbreviateDecimal(minPrice));
    }
    if (!isMaxPriceFocused) {
      setMaxPriceInput(abbreviateDecimal(maxPrice));
    }
  }, [localTickLower, localTickUpper, denominationBase, shouldInvert, isMinPriceFocused, isMaxPriceFocused, isOpen]);

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

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-md cursor-default"
          style={{ pointerEvents: 'auto' }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              e.stopPropagation();
              swallowNextClick();
              onClose();
              return;
            }
            e.stopPropagation();
          }}
        >
          <motion.div
            initial={{ y: '8%', opacity: 0 }}
            animate={{ y: '0%', opacity: 1 }}
            exit={{ y: '8%', opacity: 0 }}
            transition={{ duration: 0.4, ease: [0.34, 1.3, 0.64, 1] }}
            className="relative rounded-lg border border-solid shadow-2xl flex flex-col cursor-default"
            style={{
              width: '900px',
              maxWidth: '95vw',
              maxHeight: '95vh',
              backgroundColor: 'var(--modal-background)',
            }}
            role="dialog"
            aria-modal="true"
            ref={containerRef}
            onClick={(e) => e.stopPropagation()}
          >
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
          <div className="overflow-y-auto px-4 pt-4 space-y-4 flex-1 min-h-0">
            {/* Pool Price + Help Link */}
            {currentPrice && (
              <div className="flex gap-3">
                <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-4" style={{ width: '50%' }}>
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
              </div>
            )}

            {/* Range Types */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-muted-foreground">Range Types</span>
              <div className="grid grid-cols-4 gap-2">
                {(() => {
                  // Determine which range types to show based on presetOptions
                  const isStable = presetOptions.includes("±1%");
                  const rangeTypes = isStable
                    ? ["Full Range", "±3%", "±1%", "Custom"]
                    : ["Full Range", "±15%", "±3%", "Custom"];

                  return rangeTypes.map((rangeType) => {
                    const labels: Record<string, string> = {
                      "Full Range": "Full Range",
                      "±15%": "Conservative",
                      "±3%": isStable ? "Conservative" : "Concentrated",
                      "±1%": "Concentrated",
                      "Custom": "Custom"
                    };

                    // Custom is active when no preset matches the displayed range types
                    const isActive = rangeType === "Custom"
                      ? !rangeTypes.slice(0, -1).includes(activePreset || "")
                      : activePreset === rangeType;

                  // Calculate APY for this range type
                  let apyDisplay = "";
                  // Only show APY for Custom if it's the active preset
                  const shouldCalculateAPY = rangeType !== "Custom" || (rangeType === "Custom" && isActive);

                  if (shouldCalculateAPY && poolMetrics && !isLoadingMetrics && currentPoolTick !== null && currentPoolSqrtPriceX96 && poolToken0 && poolToken1 && selectedPoolId) {
                    try {
                      // Get pool configuration
                      const poolConfig = getPoolById(selectedPoolId);
                      if (!poolConfig) {
                        apyDisplay = "—";
                      } else {
                        // Create SDK Token objects
                        const token0 = new Token(
                          chainId || 84532,
                          poolToken0.address as `0x${string}`,
                          poolToken0.decimals,
                          poolToken0.symbol
                        );
                        const token1 = new Token(
                          chainId || 84532,
                          poolToken1.address as `0x${string}`,
                          poolToken1.decimals,
                          poolToken1.symbol
                        );

                        // Create V4Pool with correct parameters from config
                        console.log('[RangeSelectionModalV2] Creating V4Pool with params:', {
                          poolId: poolConfig.id,
                          token0: token0.symbol,
                          token1: token1.symbol,
                          fee: poolConfig.fee,
                          tickSpacing: poolConfig.tickSpacing,
                          hooks: poolConfig.hooks,
                          currentPoolSqrtPriceX96,
                          currentPoolTick
                        });

                        const pool = new V4Pool(
                          token0,
                          token1,
                          poolConfig.fee,
                          poolConfig.tickSpacing,
                          poolConfig.hooks,
                          JSBI.BigInt(currentPoolSqrtPriceX96),
                          JSBI.BigInt('0'), // liquidity not needed for APY calc
                          currentPoolTick
                        );

                        console.log('[RangeSelectionModalV2] V4Pool created successfully:', {
                          poolTickSpacing: pool.tickSpacing,
                          poolTickCurrent: pool.tickCurrent
                        });

                        // Get ticks for this range type
                        // IMPORTANT: Use poolConfig.tickSpacing, not defaultTickSpacing
                        // defaultTickSpacing is for UI, but APY calc needs actual pool tickSpacing
                        const actualTickSpacing = poolConfig.tickSpacing;

                        let tickLower, tickUpper;
                        if (rangeType === "Full Range") {
                          // Align min/max ticks to actual pool spacing
                          const alignedMinTick = Math.ceil(sdkMinTick / actualTickSpacing) * actualTickSpacing;
                          const alignedMaxTick = Math.floor(sdkMaxTick / actualTickSpacing) * actualTickSpacing;
                          tickLower = alignedMinTick;
                          tickUpper = alignedMaxTick;
                        } else if (rangeType === "Custom") {
                          // Use current custom selection
                          tickLower = parseInt(localTickLower);
                          tickUpper = parseInt(localTickUpper);
                        } else {
                          // Calculate ticks for percentage-based ranges
                          const percentages: Record<string, number> = {
                            "±15%": 0.15,
                            "±3%": 0.03,
                            "±1%": 0.01
                          };
                          const pct = percentages[rangeType];
                          if (pct && currentPoolTick !== null) {
                            const tickDelta = Math.round(Math.log(1 + pct) / Math.log(1.0001));
                            const expectedLower = Math.floor((currentPoolTick - tickDelta) / actualTickSpacing) * actualTickSpacing;
                            const expectedUpper = Math.ceil((currentPoolTick + tickDelta) / actualTickSpacing) * actualTickSpacing;
                            tickLower = Math.max(sdkMinTick, expectedLower);
                            tickUpper = Math.min(sdkMaxTick, expectedUpper);
                          } else {
                            // Fallback to current selection
                            tickLower = parseInt(localTickLower);
                            tickUpper = parseInt(localTickUpper);
                          }
                        }

                        // Calculate APY
                        const metrics: PoolMetrics = {
                          totalFeesToken0: poolMetrics.totalFeesToken0,
                          avgTVLToken0: poolMetrics.avgTVLToken0,
                          days: poolMetrics.days
                        };

                        const apy = calculatePositionAPY(pool, tickLower, tickUpper, metrics);
                        apyDisplay = formatAPY(apy);
                      }
                    } catch (error) {
                      console.error('[RangeSelectionModalV2] APY calculation error:', error);
                      apyDisplay = "—";
                    }
                  } else if (isLoadingMetrics) {
                    apyDisplay = "...";
                  }

                  return (
                    <div
                      key={rangeType}
                      onClick={() => rangeType !== "Custom" && handlePresetClick(rangeType)}
                      className={`relative h-12 px-4 flex items-center justify-between rounded-md border transition-all duration-200 overflow-hidden ${
                        rangeType === "Custom"
                          ? `cursor-default ${isActive ? 'text-sidebar-primary border-sidebar-primary bg-[#3d271b]/50' : 'border-sidebar-border/50 bg-muted/20 text-muted-foreground'}`
                          : `cursor-pointer ${isActive ? 'text-sidebar-primary border-sidebar-primary bg-[#3d271b]' : 'border-sidebar-border bg-[var(--sidebar-connect-button-bg)] hover:bg-accent hover:brightness-110 hover:border-white/30 text-white'}`
                      }`}
                      style={!isActive && rangeType !== "Custom" ? { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                    >
                      <span className="text-sm font-medium relative z-10">{labels[rangeType] || rangeType}</span>
                      <span className="text-xs text-muted-foreground relative z-10">{apyDisplay}</span>
                    </div>
                  );
                });
              })()}
              </div>
            </div>

            {/* Interactive Chart */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-muted-foreground">Range Preview</span>
              <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 pt-4 px-4 pb-2">
                <div style={{ height: '180px' }} className="relative">
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
                    selectedPoolId={selectedPoolId} chainId={chainId} token0Symbol={token0Symbol} token1Symbol={token1Symbol}
                    currentPoolTick={currentPoolTick} currentPrice={currentPrice} currentPoolSqrtPriceX96={currentPoolSqrtPriceX96}
                    tickLower={localTickLower} tickUpper={localTickUpper} xDomain={localXDomain}
                    onRangeChange={(newLower, newUpper) => { setLocalTickLower(newLower); setLocalTickUpper(newUpper); setSelectedPreset(null); }}
                    onXDomainChange={(newDomain) => setLocalXDomain(newDomain)}
                    sdkMinTick={sdkMinTick} sdkMaxTick={sdkMaxTick} defaultTickSpacing={defaultTickSpacing}
                    poolToken0={poolToken0} poolToken1={poolToken1} readOnly={false}
                    forceDenominationBase={denominationBase}
                    onReset={handleReset}
                    onLoadingChange={(loading) => setIsChartLoading(loading)}
                    onDragStateChange={(state) => setIsDragging(state !== null)}
                  />
                </div>
              </div>
            </div>

            {/* Price Inputs - Two Cards Side by Side */}
            <div className="grid grid-cols-2 gap-3">
              {/* Min Price Card */}
              <div className="rounded-lg border border-sidebar-border bg-muted/30 p-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-muted-foreground">Min Price</span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => adjustTick(true, false)}
                        className="h-7 w-7 rounded-md transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: 'rgba(64, 64, 64, 0.4)' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(113, 113, 122, 0.4)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(64, 64, 64, 0.4)'}
                        disabled={parseInt(localTickLower) <= sdkMinTick}
                      >
                        <MinusIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => adjustTick(true, true)}
                        className="h-7 w-7 rounded-md transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: 'rgba(64, 64, 64, 0.4)' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(113, 113, 122, 0.4)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(64, 64, 64, 0.4)'}
                        disabled={parseInt(localTickLower) >= parseInt(localTickUpper) - defaultTickSpacing}
                      >
                        <PlusIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <Input
                    ref={minPriceInputRef}
                    type="text"
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
                    className="font-semibold h-auto border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                    style={{ fontSize: '18px' }}
                    placeholder="0"
                    autoComplete="off"
                  />
                  <div className="text-xs text-muted-foreground">{pricePerText}</div>
                </div>
              </div>

              {/* Max Price Card */}
              <div className="rounded-lg border border-sidebar-border bg-muted/30 p-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-muted-foreground">Max Price</span>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => adjustTick(false, false)}
                        className="h-7 w-7 rounded-md transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: 'rgba(64, 64, 64, 0.4)' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(113, 113, 122, 0.4)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(64, 64, 64, 0.4)'}
                        disabled={parseInt(localTickUpper) <= parseInt(localTickLower) + defaultTickSpacing}
                      >
                        <MinusIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => adjustTick(false, true)}
                        className="h-7 w-7 rounded-md transition-colors flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: 'rgba(64, 64, 64, 0.4)' }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(113, 113, 122, 0.4)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'rgba(64, 64, 64, 0.4)'}
                        disabled={parseInt(localTickUpper) >= sdkMaxTick}
                      >
                        <PlusIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <Input
                    ref={maxPriceInputRef}
                    type="text"
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
                    className="font-semibold h-auto border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                    style={{ fontSize: '18px' }}
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
              className="relative flex h-10 flex-1 cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:bg-accent hover:brightness-110 hover:border-white/30 text-white"
              style={{ backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                onConfirm(localTickLower, localTickUpper, activePreset, denominationBase);
                onClose();
              }}
              className="relative flex h-10 flex-1 cursor-pointer items-center justify-center rounded-md border border-sidebar-primary bg-[#3d271b] hover:bg-[#3d271b]/90 px-3 text-sm font-medium transition-all duration-200 text-sidebar-primary"
            >
              Confirm
            </Button>
          </div>
          </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
