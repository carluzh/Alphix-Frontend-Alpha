'use client';

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useAccount, useSendTransaction, useSwitchChain } from 'wagmi';
import { chainIdForMode, type NetworkMode } from '@/lib/network-mode';
import { getRpcUrlForNetwork } from '@/lib/viemClient';
import { reportError } from '@/lib/observability';

const VendoredKyberWidget = dynamic(
  () => import('@/lib/kyber-widget/components/Widget'),
  { ssr: false },
);

function SwapBackgroundDecoration() {
  const lines = [
    'M0,700 C300,740 600,880 900,960 S1500,880 1800,560 S2300,300 2400,300',
    'M0,810 C300,850 600,980 900,1020 S1500,940 1800,650 S2300,410 2400,410',
    'M0,920 C300,960 600,1070 900,1080 S1500,1000 1800,730 S2300,520 2400,520',
    'M0,1030 C300,1070 600,1160 900,1140 S1500,1050 1800,800 S2300,630 2400,630',
    'M0,1140 C300,1180 600,1250 900,1200 S1500,1100 1800,870 S2300,740 2400,740',
    'M0,1250 C300,1290 600,1330 900,1260 S1500,1150 1800,930 S2300,850 2400,850',
  ];
  return (
    <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
      <style>{`@keyframes swap-dash-flow { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 100; } }`}</style>
      <svg viewBox="0 0 2400 1200" preserveAspectRatio="none" className="w-full h-full" fill="none">
        {lines.map((d, i) => {
          const dur = [25, 30, 35, 28, 33, 38][i];
          const dir = i % 2 === 1 ? 'reverse' : 'normal';
          return (
            <path
              key={i}
              d={d}
              stroke="rgba(255,255,255,0.10)"
              strokeWidth="1"
              strokeDasharray="8 6"
              style={{ animation: `swap-dash-flow ${dur}s linear infinite ${dir}` }}
            />
          );
        })}
      </svg>
    </div>
  );
}

// Checksum case required — the widget's NATIVE check uses strict equality.
const NATIVE_TOKEN_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
const USDC_BY_CHAIN: Record<number, string> = {
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
};

export default function Page() {
  const [mode, setMode] = useState<NetworkMode>('base');
  const chainId = chainIdForMode(mode);
  const { address, chainId: walletChainId } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();

  // Tracks a user-initiated in-widget chain switch. While the wallet is being
  // asked to switch (or in the rare case where the wallet declines), we suppress
  // the wallet→mode sync effect below so it doesn't immediately revert the user's
  // selection before walletChainId catches up.
  const pendingChainSwitchRef = useRef<number | null>(null);

  const onSetChain = useCallback((nextChainId: number) => {
    // 1) Optimistically reflect the user's choice in the widget so the UI updates
    //    immediately (token list, balances RPC, etc.).
    if (nextChainId === 8453) setMode('base');
    else if (nextChainId === 42161) setMode('arbitrum');
    else return;

    // 2) Drive the wallet to the same chain so it stays in sync. This also makes
    //    the wallet→mode sync effect a no-op (walletChainId === required → match).
    pendingChainSwitchRef.current = nextChainId;
    (async () => {
      try {
        await switchChainAsync({ chainId: nextChainId });
      } catch (e) {
        // User rejected or wallet refused. Leave widget on the requested chain so
        // the user can retry from the wallet manually; the sync effect will fix
        // things up once walletChainId actually changes.
        // The helper auto-drops 4001 declines, so only genuine wallet failures
        // are reported; existing UI behavior (silent recovery) is unchanged.
        reportError(e, {
          domain: 'swap',
          action: 'switchChain',
          component: 'swap/page',
          chainId: nextChainId,
          extras: { targetChain: nextChainId },
        });
      } finally {
        // Always clear so the sync effect resumes (e.g., wallet-driven switches).
        pendingChainSwitchRef.current = null;
      }
    })();
  }, [switchChainAsync]);

  // Sync local `mode` with the wallet's chainId so the Widget always uses the
  // RPC + token addresses for the chain the wallet is actually on. Without this,
  // navigating to /swap while the wallet is on Arbitrum keeps mode='base' and
  // useTokenBalances queries the wrong RPC, surfacing a phantom "Insufficient
  // balance" error (the original Step-14 chain-flip bug this effect was added for).
  //
  // IMPORTANT: When the user explicitly initiates a chain switch through the
  // widget's chain switcher, `onSetChain` flips `mode` optimistically before
  // walletChainId catches up. Without the ref guard, this effect would revert
  // mode back to match the stale walletChainId on the very next render. The
  // pendingChainSwitchRef.current check below skips the sync until the wallet
  // either confirms or rejects the switch.
  useEffect(() => {
    if (pendingChainSwitchRef.current !== null) return;
    if (walletChainId === 8453 && mode !== 'base') setMode('base');
    else if (walletChainId === 42161 && mode !== 'arbitrum') setMode('arbitrum');
  }, [walletChainId, mode]);

  const onSubmitTx = useMemo(
    () => async (txData: { from: string; to: string; value: string; data: string; gasLimit: string }) => {
      const hash = await sendTransactionAsync({
        to: txData.to as `0x${string}`,
        data: txData.data as `0x${string}`,
        value: BigInt(txData.value || '0x0'),
        gas: BigInt(txData.gasLimit),
        chainId,
      });
      return hash;
    },
    [sendTransactionAsync, chainId],
  );

  return (
    <div className="flex flex-1 flex-col relative overflow-hidden">
      <SwapBackgroundDecoration />
      <div className="flex flex-1 p-3 sm:p-6 relative z-10 gap-6 max-w-6xl mx-auto w-full items-start">
        <div className="flex-1 flex justify-center">
          <VendoredKyberWidget
            client="alphix"
            chainId={chainId}
            connectedAccount={{ address, chainId: walletChainId ?? chainId }}
            onSubmitTx={onSubmitTx}
            rpcUrl={getRpcUrlForNetwork(mode)}
            title="Swap"
            width={500}
            defaultTokenIn={NATIVE_TOKEN_ADDRESS}
            defaultTokenOut={USDC_BY_CHAIN[chainId]}
            onSetChain={onSetChain}
          />
        </div>
      </div>
    </div>
  );
}
