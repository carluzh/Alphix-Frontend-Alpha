'use client';

import { useCallback, useMemo } from 'react';
import { ArrowDown } from 'lucide-react';
import { toast } from 'sonner';
import { encodeFunctionData, erc20Abi, maxUint256 } from 'viem';
import { getConnectorClient, sendTransaction, waitForTransactionReceipt } from '@wagmi/core';
import { config as wagmiConfig } from '@/lib/wagmiConfig';

import { getExplorerTxUrl } from '@/lib/wagmiConfig';
import { modeForChainId } from '@/lib/network-mode';
import { TokenImage } from '@/components/ui/token-image';
import { TransactionModal } from '@/components/transactions/TransactionModal';
import { SwapRoutePreview } from './SwapRoutePreview';
import { TransactionStepType, type TransactionStep, type StepGenerationResult, type StepExecutorFn } from '@/lib/transactions';
import {
  APPROVAL_STATE,
  NATIVE_TOKEN_ADDRESS,
  formatTokenAmountDisplay,
  type Trade as KyberTrade,
} from '@/lib/aggregators/kyber-fork';
import type { Token } from './types';

const KYBER_CLIENT = 'alphix';
const DEFAULT_DEADLINE_MIN = 20;
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const toEngineAddress = (addr: string) =>
  addr.toLowerCase() === ZERO_ADDR ? NATIVE_TOKEN_ADDRESS : addr;

interface BuildSwapArgs {
  trade: KyberTrade;
  slippage: number;
  deadlineMinutes: number;
  tokenInAddress: string;
  client: string;
}

interface SwapExecuteModalProps {
  isOpen: boolean;
  onClose: () => void;
  fromToken: Token;
  toToken: Token;
  fromAmount: string;
  toAmount: string;
  currentSlippage: number;
  fromTokenUsdPrice: number;
  refetchFromTokenBalance?: () => Promise<unknown>;
  refetchToTokenBalance?: () => Promise<unknown>;

  // Engine state from kyber-fork hooks (parent calls them)
  trade: KyberTrade | null;
  tradeState: 'idle' | 'loading' | 'no_route' | 'error' | 'ready';
  routeSummary?: KyberTrade['routeSummary'];
  routerAddress?: string;
  needsApproval: boolean;
  approve: () => void;
  approvalState: APPROVAL_STATE;
  buildAndSubmit: (args: BuildSwapArgs) => Promise<string>;
  building: boolean;
  submitting: boolean;
  source?: 'kyberswap';

  targetChainId?: number;
  ensureChain?: (chainId: number) => Promise<boolean>;

  /**
   * Optional override for the kyber-approve step executor.
   * When provided, this executor replaces the default hardcoded MaxUint256
   * approval logic — allowing callers (e.g. the Kyber widget) to route the
   * approval through their own audited code path while still using this
   * modal's stepper UI.
   */
  customApproveExecutor?: StepExecutorFn;
}

// Internal step shape — we only use this within this modal.
type KyberStep =
  | { type: 'kyber-approve'; tokenSymbol: string; tokenIcon?: string; tokenAddress: string; spender: string; chainId: number }
  | { type: 'kyber-swap'; inputTokenSymbol: string; outputTokenSymbol: string; inputTokenIcon?: string; outputTokenIcon?: string };

export function SwapExecuteModal({
  isOpen,
  onClose,
  fromToken,
  toToken,
  fromAmount,
  toAmount,
  currentSlippage,
  refetchFromTokenBalance,
  refetchToTokenBalance,
  trade,
  tradeState,
  routeSummary,
  routerAddress,
  needsApproval,
  buildAndSubmit,
  targetChainId,
  ensureChain,
  customApproveExecutor,
}: SwapExecuteModalProps) {
  const displayFromAmount = formatTokenAmountDisplay(fromAmount, fromToken);
  const displayToAmount = formatTokenAmountDisplay(toAmount, toToken);
  const fromUsd = parseFloat(fromAmount || '0') * (fromToken.usdPrice || 0);
  const toUsd = parseFloat(toAmount || '0') * (toToken.usdPrice || 0);
  const fmtUsd = (v: number) =>
    v < 0.01 ? '<$0.01' : `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const rate = useMemo(() => {
    const fromNum = parseFloat(fromAmount || '0');
    const toNum = parseFloat(toAmount || '0');
    if (fromNum <= 0 || toNum <= 0) return null;
    const r = toNum / fromNum;
    return r >= 0.01 ? r.toFixed(r >= 100 ? 2 : 4) : r.toPrecision(4);
  }, [fromAmount, toAmount]);

  const minReceived = useMemo(() => {
    const toNum = parseFloat(toAmount || '0');
    if (toNum <= 0) return null;
    const m = toNum * (1 - currentSlippage / 100);
    const display = m >= 0.01
      ? m.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })
      : m.toPrecision(4);
    const usd = m * (toToken.usdPrice || 0);
    return { display, usd };
  }, [toAmount, currentSlippage, toToken.usdPrice]);

  // ─── Step generation ─────────────────────────────────────────────────────
  const generateSteps = useCallback(async (): Promise<StepGenerationResult> => {
    if (!trade || !routerAddress || !targetChainId) return { steps: [] };
    const steps: KyberStep[] = [];
    if (needsApproval) {
      steps.push({
        type: 'kyber-approve',
        tokenSymbol: fromToken.symbol,
        tokenIcon: fromToken.icon,
        tokenAddress: toEngineAddress(fromToken.address),
        spender: routerAddress,
        chainId: targetChainId,
      });
    }
    steps.push({
      type: 'kyber-swap',
      inputTokenSymbol: fromToken.symbol,
      outputTokenSymbol: toToken.symbol,
      inputTokenIcon: fromToken.icon,
      outputTokenIcon: toToken.icon,
    });
    return { steps };
  }, [trade, routerAddress, targetChainId, needsApproval, fromToken, toToken]);

  // ─── Map to UI steps for ProgressIndicator ───────────────────────────────
  const mapStepsToUI = useCallback((steps: unknown[]): TransactionStep[] => {
    return (steps as KyberStep[]).map(s => {
      if (s.type === 'kyber-approve') {
        return {
          type: TransactionStepType.TokenApprovalTransaction,
          tokenSymbol: s.tokenSymbol,
          tokenIcon: s.tokenIcon,
          tokenAddress: s.tokenAddress,
          chainId: s.chainId,
        };
      }
      return {
        type: TransactionStepType.SwapTransaction,
        inputTokenSymbol: s.inputTokenSymbol,
        outputTokenSymbol: s.outputTokenSymbol,
        inputTokenIcon: s.inputTokenIcon,
        outputTokenIcon: s.outputTokenIcon,
        routeType: 'kyberswap',
      };
    });
  }, []);

  // ─── Executors ───────────────────────────────────────────────────────────
  const executors = useMemo<Record<string, StepExecutorFn>>(
    () => ({
      'kyber-approve':
        customApproveExecutor ??
        (async step => {
          const s = step as Extract<KyberStep, { type: 'kyber-approve' }>;
          // Build standard ERC20 approve calldata (max uint256).
          const data = encodeFunctionData({
            abi: erc20Abi,
            functionName: 'approve',
            args: [s.spender as `0x${string}`, maxUint256],
          });
          // sendTransaction returns the hash; await receipt before moving to swap step.
          await getConnectorClient(wagmiConfig); // ensures wallet client is hydrated
          const hash = await sendTransaction(wagmiConfig, {
            to: s.tokenAddress as `0x${string}`,
            data,
            value: 0n,
            chainId: s.chainId,
          });
          const receipt = await waitForTransactionReceipt(wagmiConfig, { hash });
          if (receipt.status === 'reverted') throw new Error('Approval reverted');
          return { txHash: hash };
        }),
      'kyber-swap': async () => {
        if (!trade) throw new Error('No quote');
        const hash = await buildAndSubmit({
          trade,
          slippage: Math.round(currentSlippage * 100),
          deadlineMinutes: DEFAULT_DEADLINE_MIN,
          tokenInAddress: toEngineAddress(fromToken.address),
          client: KYBER_CLIENT,
        });
        if (targetChainId) {
          await waitForTransactionReceipt(wagmiConfig, { hash: hash as `0x${string}`, chainId: targetChainId });
        }
        return { txHash: hash };
      },
    }),
    [trade, buildAndSubmit, currentSlippage, fromToken.address, targetChainId, customApproveExecutor],
  );

  const onBeforeExecute = async (): Promise<boolean> => {
    if (tradeState !== 'ready' || !trade) return false;
    if (targetChainId && ensureChain) {
      const ok = await ensureChain(targetChainId);
      if (!ok) return false;
    }
    return true;
  };

  const handleSuccess = (results: Map<number, { txHash?: string }>) => {
    let hash: string | undefined;
    for (const [, r] of results) if (r.txHash) hash = r.txHash;
    const desc = `Swapped ${displayFromAmount} ${fromToken.symbol} to ${displayToAmount} ${toToken.symbol}`;
    const mode = targetChainId ? modeForChainId(targetChainId) ?? undefined : undefined;
    toast.success('Swap successful', {
      id: hash ? `swap-success-${hash}` : undefined,
      description: desc,
      duration: 4000,
      action: hash
        ? { label: 'View transaction', onClick: () => window.open(getExplorerTxUrl(hash!, mode), '_blank') }
        : undefined,
    });
    refetchFromTokenBalance?.();
    refetchToTokenBalance?.();
  };

  return (
    <TransactionModal
      open={isOpen}
      onClose={onClose}
      title="Swap"
      confirmText={needsApproval ? `Approve ${fromToken.symbol}` : 'Confirm Swap'}
      confirmDisabled={tradeState !== 'ready' || !trade}
      generateSteps={generateSteps}
      executors={executors}
      mapStepsToUI={mapStepsToUI}
      onBeforeExecute={onBeforeExecute}
      onSuccess={handleSuccess}
    >
      <div className="flex flex-col gap-4">
        {/* From row */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-xl font-semibold text-white">
              {displayFromAmount} {fromToken.symbol}
            </span>
            {fromUsd > 0 && <span className="text-sm text-muted-foreground">{fmtUsd(fromUsd)}</span>}
          </div>
          {fromToken.icon ? (
            <TokenImage src={fromToken.icon} alt={fromToken.symbol} size={36} />
          ) : (
            <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-bold text-white">
              {fromToken.symbol.charAt(0)}
            </div>
          )}
        </div>

        <div className="flex justify-start -my-2">
          <ArrowDown className="h-4 w-4 text-muted-foreground" />
        </div>

        {/* To row */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-xl font-semibold text-white">
              {displayToAmount} {toToken.symbol}
            </span>
            {toUsd > 0 && <span className="text-sm text-muted-foreground">{fmtUsd(toUsd)}</span>}
          </div>
          {toToken.icon ? (
            <TokenImage src={toToken.icon} alt={toToken.symbol} size={36} />
          ) : (
            <div className="w-9 h-9 rounded-full bg-sidebar-accent flex items-center justify-center text-sm font-bold text-white">
              {toToken.symbol.charAt(0)}
            </div>
          )}
        </div>

        <div className="border-t border-muted-foreground/20" />

        {/* Route */}
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Route</span>
            <span className="flex items-center gap-1.5">
              <svg width={12} height={12} viewBox="0 0 47 67" fill="#31CB9E" xmlns="http://www.w3.org/2000/svg">
                <path d="m20 33.51 25 14.32a1.32 1.32 0 0 0 2-1.14v-26.38a1.31 1.31 0 0 0 -2-1.13z" />
                <path d="m44.47 12.84-17.09-12.57a1.36 1.36 0 0 0 -2.14.73l-6.24 28 25.32-14a1.26 1.26 0 0 0 .15-2.15" />
                <path d="m27.36 66.74 17.11-12.57a1.28 1.28 0 0 0 -.14-2.17l-25.33-14 6.24 28a1.35 1.35 0 0 0 2.12.77" />
                <path d="m13.5 33 6.5-30.41a1.29 1.29 0 0 0 -2-1.31l-16.65 12.77a3.45 3.45 0 0 0 -1.35 2.75v32.4a3.45 3.45 0 0 0 1.35 2.8l16.57 12.72a1.29 1.29 0 0 0 2-1.31z" />
              </svg>
              <span className="text-muted-foreground text-xs">via Kyberswap</span>
            </span>
          </div>
          {routeSummary && (
            <SwapRoutePreview
              source="kyberswap"
              fromToken={fromToken}
              toToken={toToken}
              routeInfo={null}
              kyberswapRouteSummary={routeSummary as any}
              tokenMetadata={undefined}
              compact
            />
          )}
        </div>

        {/* Details */}
        <div className="flex flex-col gap-2 py-2 px-3 rounded-lg bg-muted/30">
          {rate && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Price</span>
              <span className="text-white">
                1 {fromToken.symbol} = {rate} {toToken.symbol}
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Slippage</span>
            <span className="text-white">{currentSlippage}%</span>
          </div>
          {minReceived && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Min. received</span>
              <span>
                <span className="text-muted-foreground">
                  {minReceived.display} {toToken.symbol}
                </span>
                {minReceived.usd > 0 && <span className="text-white ml-1">(~{fmtUsd(minReceived.usd)})</span>}
              </span>
            </div>
          )}
          {trade?.routeSummary.gasUsd && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Network fee</span>
              <span className="text-white">~${parseFloat(trade.routeSummary.gasUsd).toFixed(2)}</span>
            </div>
          )}
        </div>
      </div>
    </TransactionModal>
  );
}
