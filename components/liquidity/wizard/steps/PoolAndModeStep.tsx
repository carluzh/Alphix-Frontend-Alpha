'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { IconCircleInfo } from 'nucleo-micro-bold-essential';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAddLiquidityContext } from '../AddLiquidityContext';
import { Container } from '../shared/Container';
import { LPMode } from '../types';
import { getEnabledPools, getPoolById, getPoolSubgraphId, type PoolConfig } from '@/lib/pools-config';
import { useNetwork } from '@/lib/network-context';
import { TokenStack } from '@/components/liquidity/TokenStack';
import { APRBadge } from '@/components/liquidity/APRBadge';
import { useAccount } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { fetchAaveRates, getLendingAprForPair } from '@/lib/aave-rates';
import { OverviewConnectWalletBanner } from '@/app/(app)/overview/components/ConnectWalletBanner/ConnectWalletBanner';

// Animation config using framer-motion's easeOut
const FADE_TRANSITION = { duration: 0.2, ease: 'easeOut' };

// Animated APR counter using framer-motion
function AnimatedAprValue({ value }: { value: number }) {
  return (
    <motion.span
      className="relative z-10 text-white text-2xl font-bold"
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
    >
      +{value.toFixed(1)}%
    </motion.span>
  );
}

const AAVE_CONFIG = {
  name: 'Aave',
  textLogo: '/aave/Logo-light.png',
  bgPurple: '/aave/purple-rings.png',
  bgColor: '#1e1a2e',
  pillBg: '#9896FF',
  pillText: '#E2E0FF',
};

const SPARK_CONFIG = {
  name: 'Spark',
  logo: '/spark/Spark-Logomark-RGB.svg',
  gradient: 'linear-gradient(135deg, #FA43BD 0%, #FFCD4D 100%)',
  pillBg: 'linear-gradient(135deg, #FA43BD 0%, #FFCD4D 100%)',
  pillText: '#FFFFFF',
};

function PoolCard({ pool, selected, onSelect, apr, lendingApr, aprLoading }: {
  pool: PoolConfig;
  selected: boolean;
  onSelect: () => void;
  apr?: number;
  lendingApr?: number;
  aprLoading?: boolean;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex flex-row items-center gap-3 py-3 px-3 rounded-lg transition-colors w-full text-left',
        selected ? 'bg-muted/50' : 'hover:bg-muted/30'
      )}
    >
      <TokenStack position={{ token0: { symbol: pool.currency0.symbol }, token1: { symbol: pool.currency1.symbol } }} />
      <span className="flex-1 text-sm font-medium">
        {pool.currency0.symbol} / {pool.currency1.symbol}
      </span>
      <APRBadge
        breakdown={{ poolApr: apr, lendingApr }}
        token0Symbol={pool.currency0.symbol}
        token1Symbol={pool.currency1.symbol}
        isLoading={aprLoading}
      />
    </button>
  );
}

// Spark decorative SVG pattern (rotated 90deg left, centered, scaled up)
function SparkPattern() {
  return (
    <svg
      className="absolute inset-0 w-full h-full opacity-30"
      viewBox="-100 100 550 400"
      preserveAspectRatio="xMidYMid slice"
      style={{ transform: 'rotate(-90deg) scale(1.4)' }}
    >
      <path
        d="M593.095 300.902L231.194 172.579C190.342 158.094 145.753 158.094 104.901 172.579L-257 300.902M369.4 304.132L218.526 188.579C188.743 165.769 147.364 165.769 117.581 188.579L-33.293 304.132M354.765 375.253L219.979 207.607C193.31 174.436 142.801 174.436 116.132 207.607L-18.6543 375.253M354.766 485.147L214.311 221.752C194.576 184.741 141.528 184.741 121.792 221.752L-18.6621 485.147M345.064 601.849L199.624 226.891C188.446 198.072 147.669 198.072 136.491 226.891L-8.94922 601.849"
        stroke="white"
        strokeWidth="6"
        fill="none"
      />
    </svg>
  );
}

// Animated "Powered by" pill that cycles between Aave and Spark
function AnimatedPoweredBy() {
  const [showAave, setShowAave] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setShowAave(prev => !prev);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative h-7 overflow-hidden" style={{ minWidth: 145 }}>
      {/* Aave pill */}
      <motion.div
        animate={{ y: showAave ? 0 : -28 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        className="absolute inset-0 flex items-center"
      >
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
          style={{ backgroundColor: AAVE_CONFIG.pillBg }}
        >
          <span className="text-xs font-medium" style={{ color: AAVE_CONFIG.pillText }}>Powered by</span>
          <Image src={AAVE_CONFIG.textLogo} alt="Aave" width={44} height={12} />
        </div>
      </motion.div>
      {/* Spark pill */}
      <motion.div
        animate={{ y: showAave ? 28 : 0 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        className="absolute inset-0 flex items-center"
      >
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
          style={{ background: SPARK_CONFIG.gradient }}
        >
          <span className="text-xs font-medium text-white">Powered by</span>
          <Image src="/spark/Spark-Logo-Horizontal-Dark_Background-RGB.svg" alt="Spark" width={52} height={14} style={{ filter: 'brightness(0) saturate(100%) invert(100%)' }} />
        </div>
      </motion.div>
    </div>
  );
}

function RehypoModeCard({ selected, onSelect, extraApr, yieldSources }: { selected: boolean; onSelect: () => void; extraApr?: number; yieldSources?: Array<'aave' | 'spark'> }) {
  const hasSpark = yieldSources?.includes('spark');
  const hasAave = yieldSources?.includes('aave') ?? true; // Default to Aave if not specified
  const hasBoth = hasAave && hasSpark;

  // Border gradient - always Aave purple (loops seamlessly)
  const borderGradient = hasSpark && !hasAave
    ? 'linear-gradient(90deg, #FA43BD 0%, #FFCD4D 50%, #FA43BD 100%)'
    : 'linear-gradient(90deg, #AAA8FF 0%, #9896FF 50%, #AAA8FF 100%)';

  return (
    <div className="group relative">
      <div
        className={cn(
          'absolute -inset-[1px] rounded-lg pointer-events-none animate-gradient-flow transition-opacity duration-200',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'
        )}
        style={{
          background: borderGradient,
          backgroundSize: '200% 100%',
        }}
      />
      <button
        onClick={onSelect}
        className={cn(
          'relative flex flex-row rounded-lg transition-all w-full text-left overflow-hidden bg-[#141414] p-3 border',
          selected ? 'border-transparent' : 'border-sidebar-border/60 group-hover:border-transparent'
        )}
      >
        <div className="absolute right-4 top-4 z-20">
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-white/60 hover:text-white" onClick={(e) => e.stopPropagation()}>
                  <IconCircleInfo className="w-4 h-4" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="end" className="w-72 p-3">
                <div className="flex flex-col gap-2">
                  <h4 className="font-semibold text-sm text-foreground">How it works</h4>
                  <p className="text-xs text-muted-foreground">
                    Your liquidity is deployed with an optimized price range. When funds are idle,
                    they&apos;re automatically rehypothecated to earn additional lending yield.
                  </p>
                  <div className="border-t border-sidebar-border pt-2 mt-1 flex flex-col gap-1.5">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-muted-foreground">Lending Protocol</span>
                      <div className="flex items-center gap-1.5">
                        {hasAave && <Image src="/aave/Logomark-light.png" alt="Aave" width={16} height={16} />}
                        {hasSpark && <Image src="/spark/Spark-Logomark-RGB.svg" alt="Spark" width={16} height={16} />}
                      </div>
                    </div>
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="relative z-10 flex flex-col gap-3 px-4 py-3 flex-1">
          <div className="flex flex-col gap-1">
            <h3 className="text-base font-semibold text-foreground">Unified Yield</h3>
            <p className="text-sm text-muted-foreground">Earn additional yield on top of swap fees by lending out idle liquidity</p>
          </div>
          {/* Powered by section */}
          {hasBoth ? (
            <AnimatedPoweredBy />
          ) : hasAave ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg w-fit" style={{ backgroundColor: AAVE_CONFIG.pillBg }}>
              <span className="text-xs font-medium" style={{ color: AAVE_CONFIG.pillText }}>Powered by</span>
              <Image src={AAVE_CONFIG.textLogo} alt="Aave" width={44} height={12} />
            </div>
          ) : hasSpark ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg w-fit" style={{ background: SPARK_CONFIG.gradient }}>
              <span className="text-xs font-medium text-white">Powered by</span>
              <Image src="/spark/Spark-Logo-Horizontal-Dark_Background-RGB.svg" alt="Spark" width={52} height={14} />
            </div>
          ) : null}
        </div>

        {/* APR visualization section */}
        <div className="relative z-10 flex w-[25%] min-w-[140px] rounded-lg overflow-hidden">
          {hasBoth ? (
            // Both sources: left Aave purple rings, right Spark gradient with SVG
            <>
              <div
                className="flex-1"
                style={{
                  backgroundImage: `url(${AAVE_CONFIG.bgPurple})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              />
              <div
                className="relative flex-1 overflow-hidden"
                style={{ background: 'linear-gradient(135deg, #FA43BD 0%, #FFCD4D 100%)' }}
              >
                <SparkPattern />
              </div>
              {/* Centered +X% overlay */}
              <div className="absolute inset-0 flex items-center justify-center">
                {extraApr !== undefined ? (
                  <AnimatedAprValue value={extraApr} />
                ) : (
                  <div className="flex items-center gap-1">
                    <span className="text-white text-2xl font-bold">+</span>
                    <div className="h-7 w-14 bg-white/20 rounded animate-pulse" />
                    <span className="text-white text-2xl font-bold">%</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            // Single source: Aave purple rings or Spark gradient
            <div
              className="relative flex items-center justify-center flex-1"
              style={hasSpark
                ? { background: SPARK_CONFIG.gradient }
                : { backgroundColor: AAVE_CONFIG.bgColor }
              }
            >
              {hasAave && (
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: `url(${AAVE_CONFIG.bgPurple})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />
              )}
              {extraApr !== undefined ? (
                <AnimatedAprValue value={extraApr} />
              ) : (
                <div className="relative z-10 flex items-center gap-1">
                  <span className="text-white text-2xl font-bold">+</span>
                  <div className="h-7 w-14 bg-white/20 rounded animate-pulse" />
                  <span className="text-white text-2xl font-bold">%</span>
                </div>
              )}
            </div>
          )}
        </div>
      </button>
    </div>
  );
}

function CustomRangeModeCard({ selected, onSelect }: { selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex flex-col gap-0.5 rounded-lg border transition-all w-full text-left bg-[#141414] py-4 pl-7 pr-4',
        selected ? 'border-white/40' : 'border-sidebar-border/60 hover:border-sidebar-border'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">Custom Range</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-sidebar-accent text-muted-foreground uppercase tracking-wider">Advanced</span>
      </div>
      <p className="text-sm text-muted-foreground">Set your own price range. You will not earn additional yield.</p>
    </button>
  );
}

function LPModeSection({ mode, onSelectMode, extraAaveApr, yieldSources }: { mode: LPMode; onSelectMode: (mode: LPMode) => void; extraAaveApr?: number; yieldSources?: Array<'aave' | 'spark'> }) {
  return (
    <div className="flex flex-col gap-4 pt-4 border-t border-sidebar-border/40">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-white">Choose LP Strategy</h2>
        <p className="text-sm text-muted-foreground">Select how you want to provide liquidity</p>
      </div>
      <div className="flex flex-col gap-3">
        <RehypoModeCard selected={mode === 'rehypo'} onSelect={() => onSelectMode('rehypo')} extraApr={extraAaveApr} yieldSources={yieldSources} />
        <CustomRangeModeCard selected={mode === 'concentrated'} onSelect={() => onSelectMode('concentrated')} />
      </div>
    </div>
  );
}

export function PoolAndModeStep() {
  const { state, setPoolId, setTokens, setMode, goNext, canGoForward, poolLoading } = useAddLiquidityContext();
  const { networkMode } = useNetwork();
  const { isConnected } = useAccount();
  const [poolAprs, setPoolAprs] = useState<Record<string, number>>({});
  const [aprsLoading, setAprsLoading] = useState(true);

  const pools = useMemo(() => getEnabledPools(), []);
  const selectedPool = state.poolId ? getPoolById(state.poolId) : null;

  useEffect(() => {
    const fetchAprs = async () => {
      setAprsLoading(true);
      try {
        const response = await fetch(`/api/liquidity/get-pools-batch?network=${networkMode}`);
        if (!response.ok) throw new Error(`API failed: ${response.status}`);
        const batchData = await response.json();
        if (!batchData.success) throw new Error(`API error: ${batchData.message}`);

        const aprs: Record<string, number> = {};
        pools.forEach(pool => {
          const apiPoolId = getPoolSubgraphId(pool.id) || pool.id;
          const batchPoolData = batchData.pools.find((p: any) => p.poolId.toLowerCase() === apiPoolId.toLowerCase());
          if (batchPoolData && typeof batchPoolData.apr === 'number') {
            aprs[pool.id] = batchPoolData.apr;
          }
        });
        setPoolAprs(aprs);
      } catch (error) {
        console.error('Failed to fetch APRs:', error);
      } finally {
        setAprsLoading(false);
      }
    };
    fetchAprs();
  }, [pools, networkMode]);

  const handleSelectPool = useCallback((pool: PoolConfig) => {
    setPoolId(pool.id);
    setTokens(pool.currency0.symbol, pool.currency1.symbol);
  }, [setPoolId, setTokens]);

  // Fetch Aave rates for Unified Yield display
  const { data: aaveRatesData } = useQuery({
    queryKey: ['aaveRates'],
    queryFn: fetchAaveRates,
    staleTime: 5 * 60_000, // 5 minutes
  });

  // Calculate lending APR for all pools using shared utility
  const poolAaveAprs = useMemo(() => {
    const aprs: Record<string, number> = {};
    pools.forEach(pool => {
      const apr = getLendingAprForPair(aaveRatesData, pool.currency0.symbol, pool.currency1.symbol);
      if (apr !== null) aprs[pool.id] = apr;
    });
    return aprs;
  }, [pools, aaveRatesData]);

  // Get Aave APR for the selected pool (for the strategy section)
  const extraAaveApr = selectedPool ? poolAaveAprs[selectedPool.id] : undefined;

  return (
    <Container>
      {/* Connect wallet banner - show when not connected */}
      {!isConnected && (
        <OverviewConnectWalletBanner />
      )}

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-white">Select Pool</h2>
          <p className="text-sm text-muted-foreground">Choose which pool to provide liquidity for</p>
        </div>
        <div className="flex flex-col gap-2">
          {pools.map(pool => (
            <PoolCard
              key={pool.id}
              pool={pool}
              selected={state.poolId === pool.id}
              onSelect={() => handleSelectPool(pool)}
              apr={poolAprs[pool.id]}
              lendingApr={poolAaveAprs[pool.id]}
              aprLoading={aprsLoading}
            />
          ))}
        </div>
        {pools.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <IconCircleInfo className="w-8 h-8 text-muted-foreground mb-3" />
            <p className="text-muted-foreground">No pools available</p>
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {state.poolId && (
          <motion.div
            key={`lp-strategy-${state.poolId}`}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={FADE_TRANSITION}
            className="flex flex-col gap-4"
          >
            <LPModeSection mode={state.mode} onSelectMode={setMode} extraAaveApr={extraAaveApr} yieldSources={selectedPool?.yieldSources} />
            <Button
              onClick={goNext}
              disabled={!canGoForward}
              className={cn(
                "w-full h-11",
                !canGoForward
                  ? "relative border border-sidebar-border bg-button text-sm font-medium transition-all duration-200 overflow-hidden !opacity-100 text-white/75"
                  : "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
              )}
              style={!canGoForward ? { backgroundImage: 'url(/patterns/button-wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
            >
              Continue
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </Container>
  );
}
