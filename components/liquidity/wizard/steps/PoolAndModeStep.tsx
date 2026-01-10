'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
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

const YIELD_SOURCE = {
  name: 'Aave',
  textLogo: '/aave/Logo-light.png',
  bgPurple: '/aave/purple-rings.png',
};

function PoolCard({ pool, selected, onSelect, apr, aprLoading }: {
  pool: PoolConfig;
  selected: boolean;
  onSelect: () => void;
  apr?: number;
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
        breakdown={{ poolApr: apr }}
        token0Symbol={pool.currency0.symbol}
        token1Symbol={pool.currency1.symbol}
        isLoading={aprLoading}
      />
    </button>
  );
}

function RehypoModeCard({ selected, onSelect, extraApr }: { selected: boolean; onSelect: () => void; extraApr?: number }) {
  return (
    <div className="group relative">
      <div
        className={cn(
          'absolute -inset-[1px] rounded-lg pointer-events-none animate-gradient-flow transition-opacity',
          selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'
        )}
        style={{
          background: 'linear-gradient(45deg, #AAA8FF, #BDBBFF 25%, #9896FF 50%, #BDBBFF 75%, #AAA8FF 100%)',
          backgroundSize: '300% 100%',
        }}
      />
      <button
        onClick={onSelect}
        className={cn(
          'relative flex flex-row rounded-lg transition-all w-full text-left overflow-hidden bg-[#141414] p-3 border',
          selected ? 'border-transparent' : 'border-sidebar-border/60'
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
                    they&apos;re automatically deposited into Aave to earn additional lending yield.
                  </p>
                  <div className="border-t border-sidebar-border pt-2 mt-1 flex flex-col gap-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Vault Standard</span>
                      <span className="text-foreground font-mono">ERC-4626</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Lending Protocol</span>
                      <span className="text-foreground">Aave V3</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Range Strategy</span>
                      <span className="text-foreground">Managed</span>
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
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg w-fit" style={{ backgroundColor: '#9896FF' }}>
            <span className="text-xs font-medium" style={{ color: '#E2E0FF' }}>Powered by</span>
            <Image src={YIELD_SOURCE.textLogo} alt={YIELD_SOURCE.name} width={44} height={12} />
          </div>
        </div>

        {extraApr !== undefined && (
          <div className="relative z-10 flex items-center justify-center w-[25%] min-w-[140px] rounded-lg overflow-hidden" style={{ background: '#1e1a2e' }}>
            <div className="absolute inset-0" style={{ backgroundImage: `url(${YIELD_SOURCE.bgPurple})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
            <AnimatedAprValue value={extraApr} />
          </div>
        )}
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

function LPModeSection({ mode, onSelectMode, extraAaveApr }: { mode: LPMode; onSelectMode: (mode: LPMode) => void; extraAaveApr?: number }) {
  const [isCtaHovered, setIsCtaHovered] = useState(false);

  return (
    <div className="flex flex-col gap-4 pt-4 border-t border-sidebar-border/40">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-white">Choose LP Strategy</h2>
        <div className="flex flex-row items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground">Select how you want to provide liquidity</p>
          <a
            href="https://docs.alphix.io/rehypothecation"
            target="_blank"
            rel="noopener noreferrer"
            className={cn("bg-muted/20 border border-sidebar-border/40 rounded-lg px-3 py-1.5 cursor-pointer shrink-0 transition-all duration-150", isCtaHovered && "bg-muted/30")}
            onMouseEnter={() => setIsCtaHovered(true)}
            onMouseLeave={() => setIsCtaHovered(false)}
          >
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Learn about Rehypothecation</span>
              <ChevronRight className={cn("w-3 h-3 text-muted-foreground transition-transform duration-100", isCtaHovered && "translate-x-0.5")} />
            </div>
          </a>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <RehypoModeCard selected={mode === 'rehypo'} onSelect={() => onSelectMode('rehypo')} extraApr={extraAaveApr} />
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

  const extraAaveApr = selectedPool ? 2.5 : undefined;

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
            <LPModeSection mode={state.mode} onSelectMode={setMode} extraAaveApr={extraAaveApr} />
            <Button
              onClick={goNext}
              disabled={!canGoForward}
              className={cn(
                "w-full h-11",
                !canGoForward
                  ? "relative border border-sidebar-border bg-button text-sm font-medium transition-all duration-200 overflow-hidden !opacity-100 text-white/75"
                  : "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
              )}
              style={!canGoForward ? { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
            >
              Continue
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </Container>
  );
}
