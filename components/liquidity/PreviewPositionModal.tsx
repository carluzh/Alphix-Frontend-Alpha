"use client";

import React, { useEffect, useState, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { PositionCardCompact } from "./PositionCardCompact";
import { getTokenDefinitions, TokenSymbol, getToken, getPoolById } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { parseSubgraphPosition, type SubgraphPosition } from "@/lib/uniswap/liquidity";
import { formatUnits } from "viem";
import { formatTokenDisplayAmount } from "@/lib/utils";
import Image from "next/image";
import { MoveRight } from "lucide-react";
import { useAccount } from "wagmi";
import { Token } from '@uniswap/sdk-core';
import { Pool as V4PoolSDK } from "@uniswap/v4-sdk";
import JSBI from "jsbi";
import { getAddress } from "viem";
import { V4_POOL_FEE, V4_POOL_TICK_SPACING, V4_POOL_HOOKS } from "@/lib/swap-constants";
import { calculatePositionApr, type PoolMetrics } from "@/lib/apr";
import { Percent } from '@uniswap/sdk-core';

// Helper function to get token icon
const getTokenIcon = (symbol?: string) => {
  if (!symbol) return "/placeholder-logo.svg";
  const tokenConfig = getToken(symbol);
  return tokenConfig?.icon || "/placeholder-logo.svg";
};

interface PreviewPositionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  calculatedData: any;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  tickLower: string;
  tickUpper: string;
  amount0: string;
  amount1: string;
  currentPrice: string | null;
  currentPoolTick: number | null;
  currentPoolSqrtPriceX96?: string | null;
  selectedPoolId?: string;
  getUsdPriceForSymbol: (symbol?: string) => number;
  isZapMode?: boolean;
  zapInputToken?: 'token0' | 'token1';
  zapInputAmount?: string;
  zapOutputAmount?: string;
  zapQuote?: {
    expectedToken0Amount?: string;
    expectedToken1Amount?: string;
    priceImpact?: string;
  } | null;
  currentSlippage?: number;
}

export function PreviewPositionModal({
  isOpen,
  onClose,
  onConfirm,
  calculatedData,
  token0Symbol,
  token1Symbol,
  tickLower,
  tickUpper,
  amount0,
  amount1,
  currentPrice,
  currentPoolTick,
  currentPoolSqrtPriceX96,
  selectedPoolId,
  getUsdPriceForSymbol,
  isZapMode = false,
  zapInputToken = 'token0',
  zapInputAmount,
  zapOutputAmount,
  zapQuote,
  currentSlippage = 0.5,
}: PreviewPositionModalProps) {
  const [mounted, setMounted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { chainId } = useAccount();
  const { networkMode, chainId: targetChainId } = useNetwork();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const poolType = selectedPoolId ? getPoolById(selectedPoolId, networkMode)?.type : undefined;

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
  
  // State for APR calculation
  const [calculatedAPR, setCalculatedAPR] = useState<Percent | null>(null);
  const [cachedPoolMetrics, setCachedPoolMetrics] = useState<{ poolId: string; metrics: any; poolLiquidity: string } | null>(null);
  
  // Derived pool tokens
  const { poolToken0, poolToken1 } = useMemo(() => {
    if (!token0Symbol || !token1Symbol || !chainId) return { poolToken0: null, poolToken1: null };
    const currentToken0Def = tokenDefinitions[token0Symbol];
    const currentToken1Def = tokenDefinitions[token1Symbol];
    if (!currentToken0Def || !currentToken1Def) return { poolToken0: null, poolToken1: null };

    const sdkBaseToken0 = new Token(chainId, getAddress(currentToken0Def.address), currentToken0Def.decimals, currentToken0Def.symbol);
    const sdkBaseToken1 = new Token(chainId, getAddress(currentToken1Def.address), currentToken1Def.decimals, currentToken1Def.symbol);

    const [pt0, pt1] = sdkBaseToken0.sortsBefore(sdkBaseToken1)
      ? [sdkBaseToken0, sdkBaseToken1]
      : [sdkBaseToken1, sdkBaseToken0];
    return { poolToken0: pt0, poolToken1: pt1 };
  }, [token0Symbol, token1Symbol, chainId]);
  
  // Fetch pool metrics and state ONCE per pool (cached)
  useEffect(() => {
    const fetchPoolData = async () => {
      if (!selectedPoolId) return;

      // Check if already cached for this pool
      if (cachedPoolMetrics?.poolId === selectedPoolId) return;

      try {
        const [metricsResponse, stateResponse] = await Promise.all([
          fetch('/api/liquidity/pool-metrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ poolId: selectedPoolId, days: 7 })
          }),
          fetch(`/api/liquidity/get-pool-state?poolId=${encodeURIComponent(selectedPoolId)}`)
        ]);

        if (metricsResponse.ok) {
          const data = await metricsResponse.json();
          let poolLiquidity = "0";

          if (stateResponse.ok) {
            const stateData = await stateResponse.json();
            poolLiquidity = stateData.liquidity || "0";
          }

          setCachedPoolMetrics({
            poolId: selectedPoolId,
            metrics: data.metrics,
            poolLiquidity
          });
        }
      } catch (error) {
        // Silently fail - APY will show as unavailable
      }
    };

    fetchPoolData();
  }, [selectedPoolId, cachedPoolMetrics]);
  
  // Calculate APR using same logic as AddLiquidityForm
  useEffect(() => {
    const calculateApr = async () => {
      if (!selectedPoolId || !tickLower || !tickUpper || !currentPoolSqrtPriceX96 || currentPoolTick === null) {
        setCalculatedAPR(null);
        return;
      }

      const lowerTick = parseInt(tickLower);
      const upperTick = parseInt(tickUpper);

      if (isNaN(lowerTick) || isNaN(upperTick) || lowerTick >= upperTick) {
        setCalculatedAPR(null);
        return;
      }

      const amount0Num = parseFloat(amount0 || '0');
      const amount1Num = parseFloat(amount1 || '0');
      if (amount0Num <= 0 && amount1Num <= 0) {
        setCalculatedAPR(null);
        return;
      }

      if (!cachedPoolMetrics || cachedPoolMetrics.poolId !== selectedPoolId) {
        return;
      }

      if (!cachedPoolMetrics.metrics || cachedPoolMetrics.metrics.days === 0) {
        setCalculatedAPR(null);
        return;
      }

      try {
        const poolConfig = getPoolById(selectedPoolId);
        if (!poolConfig) {
          setCalculatedAPR(null);
          return;
        }

        const token0Def = tokenDefinitions[token0Symbol];
        const token1Def = tokenDefinitions[token1Symbol];

        if (!token0Def || !token1Def) {
          setCalculatedAPR(null);
          return;
        }

        const sdkToken0 = poolToken0 || new Token(targetChainId, getAddress(token0Def.address), token0Def.decimals, token0Symbol, token0Symbol);
        const sdkToken1 = poolToken1 || new Token(targetChainId, getAddress(token1Def.address), token1Def.decimals, token1Symbol, token1Symbol);

        const sdkPool = new V4PoolSDK(
          sdkToken0,
          sdkToken1,
          V4_POOL_FEE,
          V4_POOL_TICK_SPACING,
          V4_POOL_HOOKS,
          JSBI.BigInt(currentPoolSqrtPriceX96),
          JSBI.BigInt(cachedPoolMetrics.poolLiquidity),
          currentPoolTick
        );

        const userLiquidity = calculatedData?.liquidity;

        const apr = await calculatePositionApr(
          sdkPool,
          lowerTick,
          upperTick,
          cachedPoolMetrics.metrics as PoolMetrics,
          100,
          { amount0, amount1, liquidity: userLiquidity }
        );

        setCalculatedAPR(apr);
      } catch (error) {
        setCalculatedAPR(null);
      }
    };

    const timer = setTimeout(() => calculateApr(), 100);
    return () => clearTimeout(timer);
  }, [selectedPoolId, tickLower, tickUpper, currentPoolSqrtPriceX96, currentPoolTick, token0Symbol, token1Symbol, amount0, amount1, calculatedData, cachedPoolMetrics, poolToken0, poolToken1, targetChainId, tokenDefinitions]);

  // Ensure we're mounted before rendering portal (SSR safety)
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  if (!mounted || !calculatedData) return null;

  // Get token definitions
  const token0Def = tokenDefinitions[token0Symbol];
  const token1Def = tokenDefinitions[token1Symbol];

  // Format amounts with proper decimals
  const formatAmount = (rawAmount: string | bigint, decimals: number): string => {
    if (!rawAmount) return "0";
    const amount = typeof rawAmount === 'string' ? rawAmount : rawAmount.toString();
    const formatted = formatUnits(BigInt(amount), decimals);
    return formatTokenDisplayAmount(formatted);
  };

  // For zap mode, prioritize zap quote amounts if available (more accurate)
  // For regular mode, use calculatedData
  let amount0ToUse: string | bigint | undefined;
  let amount1ToUse: string | bigint | undefined;
  
  if (isZapMode && zapQuote?.expectedToken0Amount && zapQuote?.expectedToken1Amount) {
    // Zap mode with quote: Use the expected amounts from zap quote (most accurate)
    // Note: zapQuote amounts from prepare-zap-mint-tx are raw bigint strings (wei)
    // while calculate-zap-amounts returns formatted strings - we handle both
    const zapAmount0 = zapQuote.expectedToken0Amount;
    const zapAmount1 = zapQuote.expectedToken1Amount;
    
    // Check if amounts are already formatted (have decimal point) or raw (bigint string)
    const isFormatted0 = zapAmount0.includes('.');
    const isFormatted1 = zapAmount1.includes('.');
    
    if (isFormatted0 && isFormatted1) {
      // Already formatted, use directly (from calculate-zap-amounts)
      amount0ToUse = zapAmount0;
      amount1ToUse = zapAmount1;
    } else {
      // Raw bigint strings, use formatAmount (from prepare-zap-mint-tx)
      amount0ToUse = zapAmount0;
      amount1ToUse = zapAmount1;
    }
  } else {
    // Regular mode or zap mode without quote: use calculatedData
    amount0ToUse = calculatedData.amount0;
    amount1ToUse = calculatedData.amount1;
  }

  // Parse the calculated amounts with proper decimals
  // If amounts are already formatted strings, just use them; otherwise format from wei
  const formattedAmount0 = amount0ToUse 
    ? (typeof amount0ToUse === 'string' && amount0ToUse.includes('.'))
      ? formatTokenDisplayAmount(amount0ToUse)
      : formatAmount(amount0ToUse, token0Def?.decimals || 18)
    : "0";
  const formattedAmount1 = amount1ToUse 
    ? (typeof amount1ToUse === 'string' && amount1ToUse.includes('.'))
      ? formatTokenDisplayAmount(amount1ToUse)
      : formatAmount(amount1ToUse, token1Def?.decimals || 18)
    : "0";

  // Create a preview position object and convert to PositionInfo
  const isInRange = currentPoolTick !== null &&
    currentPoolTick >= parseInt(tickLower) &&
    currentPoolTick <= parseInt(tickUpper);

  const subgraphPos: SubgraphPosition = {
    positionId: "preview",
    owner: "0x0000000000000000000000000000000000000000",
    poolId: `${token0Symbol}/${token1Symbol}`,
    token0: {
      address: token0Def?.address || "",
      symbol: token0Symbol,
      amount: formattedAmount0,
    },
    token1: {
      address: token1Def?.address || "",
      symbol: token1Symbol,
      amount: formattedAmount1,
    },
    tickLower: parseInt(tickLower),
    tickUpper: parseInt(tickUpper),
    liquidity: "0",
    isInRange,
    blockTimestamp: Math.floor(Date.now() / 1000),
    lastTimestamp: Math.floor(Date.now() / 1000),
  };

  const previewPositionInfo = parseSubgraphPosition(subgraphPos, {
    chainId: chainId ?? 8453,
    token0Decimals: token0Def?.decimals ?? 18,
    token1Decimals: token1Def?.decimals ?? 18,
  });

  // Calculate total value USD
  const valueUSD = parseFloat(formattedAmount0) * getUsdPriceForSymbol(token0Symbol) +
    parseFloat(formattedAmount1) * getUsdPriceForSymbol(token1Symbol);

  // Get the correct input token symbol for zap mode
  const inputTokenSymbol = zapInputToken === 'token0' ? token0Symbol : token1Symbol;
  const inputTokenDef = zapInputToken === 'token0' ? token0Def : token1Def;

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-md cursor-default"
          style={{
            pointerEvents: 'auto',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)'
          }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="relative rounded-lg border border-solid shadow-2xl flex flex-col cursor-default"
            style={{
              width: '600px',
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
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-sidebar-border/60 flex-shrink-0">
                <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">PREVIEW POSITION</h2>
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
              <div className="p-4 space-y-4 flex-1 overflow-y-auto">
                {/* Zap Information - Now at the top */}
                {isZapMode && (
                  <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-4">
                    <div className="flex gap-4">
                      {/* Input segment - 1/3 width */}
                      <div className="flex-[1] min-w-0 flex flex-col">
                        <span className="text-xs text-muted-foreground mb-2 block">Input Amount</span>
                        <div className="bg-muted/30 rounded-lg border border-sidebar-border p-2 flex items-center gap-2">
                          <Image src={getTokenIcon(inputTokenSymbol)} alt={inputTokenSymbol} width={24} height={24} className="rounded-full flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{formatTokenDisplayAmount(zapInputAmount || "0")}</div>
                            <div className="text-xs text-muted-foreground">{inputTokenSymbol}</div>
                          </div>
                        </div>
                      </div>

                      {/* Arrow - aligned with amount segment boxes */}
                      <div className="flex-shrink-0 flex items-end pb-4">
                        <MoveRight className="w-5 h-5" style={{ color: 'rgba(163, 163, 163, 1)' }} />
                      </div>

                      {/* Position Amounts - 2/3 width */}
                      <div className="flex-[2] min-w-0 flex flex-col">
                        <span className="text-xs text-muted-foreground mb-2 block">Position Amounts</span>
                        <div className="flex gap-2">
                          {/* Token 0 */}
                          <div className="flex-1 bg-muted/30 rounded-lg p-2 flex items-center gap-2 min-w-0">
                            <Image src={getTokenIcon(token0Symbol)} alt={token0Symbol} width={24} height={24} className="rounded-full flex-shrink-0" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{formattedAmount0}</div>
                              <div className="text-xs text-muted-foreground">{token0Symbol}</div>
                            </div>
                          </div>
                          {/* Token 1 */}
                          <div className="flex-1 bg-muted/30 rounded-lg p-2 flex items-center gap-2 min-w-0">
                            <Image src={getTokenIcon(token1Symbol)} alt={token1Symbol} width={24} height={24} className="rounded-full flex-shrink-0" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{formattedAmount1}</div>
                              <div className="text-xs text-muted-foreground">{token1Symbol}</div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Position Preview Card - Now below swap */}
                {previewPositionInfo && (
                  <PositionCardCompact
                    position={previewPositionInfo}
                    valueUSD={valueUSD}
                    onClick={() => {}}
                    getUsdPriceForSymbol={getUsdPriceForSymbol}
                    poolType={poolType}
                    poolContext={{
                      currentPrice,
                      currentPoolTick,
                      poolAPR: calculatedAPR ? parseFloat(calculatedAPR.toFixed(2)) : null,
                      isLoadingPrices: false,
                      isLoadingPoolStates: false,
                    }}
                    showMenuButton={false}
                    disableHover={true}
                  />
                )}
              </div>

              {/* Footer Button */}
              <div className="px-4 pb-4">
                <Button
                  onClick={onClose}
                  className="relative flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-sidebar-primary bg-button-primary hover-button-primary px-3 text-sm font-medium transition-all duration-200 text-sidebar-primary"
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

  // Render modal at document body level to escape layout constraints
  return createPortal(modalContent, document.body);
}