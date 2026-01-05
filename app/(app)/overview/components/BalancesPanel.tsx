"use client";

import React from "react";
import Image from "next/image";
import { toast } from "sonner";
import { IconCircleXmarkFilled } from "nucleo-micro-bold-essential";
import { baseSepolia } from "@/lib/wagmiConfig";
import { getToken } from "@/lib/pools-config";
import { formatNumber } from "@/lib/format";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { BalancesListSkeleton } from "./skeletons";

/**
 * Token balance interface
 */
export interface TokenBalance {
  symbol: string;
  balance: number;
  usdValue: number;
  color: string;
}

function formatUSD(num: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Faucet button props
 */
interface FaucetButtonProps {
  faucetLastClaimTs: number;
  faucetLastCalledOnchain: bigint | undefined;
  isConnected: boolean;
  currentChainId: number | undefined;
  walletBalancesLength: number;
  isLoadingWalletBalances: boolean;
  isFaucetBusy: boolean;
  isFaucetConfirming: boolean;
  accountAddress: `0x${string}` | undefined;
  setIsFaucetBusy: (busy: boolean) => void;
  setFaucetHash: (hash: `0x${string}`) => void;
  writeContract: any;
  faucetAbi: any;
  refetchFaucetOnchain?: () => void;
}

/**
 * Faucet button component for testnet token claims
 */
export const FaucetButton = ({
  faucetLastClaimTs,
  faucetLastCalledOnchain,
  isConnected,
  currentChainId,
  walletBalancesLength,
  isLoadingWalletBalances,
  isFaucetBusy,
  isFaucetConfirming,
  accountAddress,
  setIsFaucetBusy,
  setFaucetHash,
  writeContract,
  faucetAbi,
  refetchFaucetOnchain,
}: FaucetButtonProps) => {
  const last = faucetLastClaimTs < 0 ? -1 : Number(faucetLastClaimTs || 0);
  const now = Math.floor(Date.now() / 1000);
  const onchainLast = faucetLastCalledOnchain ? Number(faucetLastCalledOnchain) : null;
  const effectiveLast = onchainLast && onchainLast > 0 ? onchainLast : (last >= 0 ? last : -1);
  const canClaim = isConnected && currentChainId === baseSepolia.id && effectiveLast >= 0 && (effectiveLast === 0 || now - effectiveLast >= 24 * 60 * 60);
  const isPortfolioEmpty = walletBalancesLength === 0 && !isLoadingWalletBalances;

  if (isPortfolioEmpty) return null;

  const handleClick = async () => {
    if (!canClaim) {
      toast.error('Can only claim once per day', { icon: <IconCircleXmarkFilled className="h-4 w-4 text-red-500" /> });
      return;
    }
    try {
      setIsFaucetBusy(true);
      const res = await fetch('/api/misc/faucet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAddress: accountAddress, chainId: baseSepolia.id })
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = (data?.errorDetails || data?.message || '').toLowerCase();
        if (msg.includes('once per day')) {
          toast.error('Can only claim once per day', { icon: <IconCircleXmarkFilled className="h-4 w-4 text-red-500" /> });
        } else {
          toast.error(data?.errorDetails || data?.message || 'API Error', { icon: <IconCircleXmarkFilled className="h-4 w-4 text-red-500" /> });
        }
        setIsFaucetBusy(false);
        return;
      }
      toast.info('Sending faucet transaction to wallet...');
      writeContract({
        address: data.to as `0x${string}`,
        abi: faucetAbi,
        functionName: 'faucet',
        args: [],
        chainId: data.chainId,
      }, {
        onSuccess: (hash: `0x${string}`) => {
          setFaucetHash(hash);
          if (refetchFaucetOnchain) {
            setTimeout(() => { try { refetchFaucetOnchain(); } catch {} }, 1000);
          }
        }
      });
    } catch (e: any) {
      toast.error(`Error during faucet action: ${e?.message || 'Unknown error'}`, { icon: <IconCircleXmarkFilled className="h-4 w-4 text-red-500" /> });
      setIsFaucetBusy(false);
    }
  };

  const disabled = Boolean(isFaucetBusy || isFaucetConfirming);
  const className = canClaim
    ? `px-2 py-1 text-xs rounded-md border border-sidebar-primary bg-button-primary text-sidebar-primary transition-colors ${disabled ? 'opacity-70 cursor-not-allowed' : 'hover-button-primary'}`
    : `px-2 py-1 text-xs rounded-md border border-sidebar-border bg-button text-muted-foreground transition-colors ${disabled || last < 0 ? 'opacity-70 cursor-not-allowed' : 'hover:bg-muted/60'}`;
  const style = canClaim ? undefined : { backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } as React.CSSProperties;

  return (
    <button type="button" onClick={handleClick} className={className} style={style} disabled={disabled || last < 0}>
      {disabled ? 'Processing…' : (last < 0 ? '—' : 'Claim Faucet')}
    </button>
  );
};

/**
 * Balances list props
 */
interface BalancesListProps {
  walletBalances: TokenBalance[];
  isLoadingWalletBalances: boolean;
  isConnected: boolean;
  balancesSortDir: 'asc' | 'desc';
  setBalancesSortDir: (fn: (d: 'asc' | 'desc') => 'asc' | 'desc') => void;
  renderSortIcon: (state: 'asc' | 'desc' | null) => React.ReactNode;
  showSkeleton?: boolean;
  variant?: 'card' | 'inline';
}

/**
 * Balances list component - shows token balances
 */
export const BalancesList = ({
  walletBalances,
  isLoadingWalletBalances,
  isConnected,
  balancesSortDir,
  setBalancesSortDir,
  renderSortIcon,
  showSkeleton = false,
  variant = 'card',
}: BalancesListProps) => {
  const isEmpty = walletBalances.length === 0 && !isLoadingWalletBalances;
  const wrapperClass = variant === 'card'
    ? `${isEmpty ? "" : "rounded-lg bg-muted/30 border border-sidebar-border/60"} ${isLoadingWalletBalances ? 'animate-pulse' : ''}`
    : `rounded-lg bg-muted/30 border border-sidebar-border/60 ${showSkeleton ? 'animate-skeleton-pulse' : ''}`;

  if (showSkeleton) {
    return (
      <div className={wrapperClass}>
        <BalancesListSkeleton />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="border border-dashed rounded-lg bg-muted/10 p-8 w-full flex items-center justify-center">
        <div className="w-48">
          <ConnectWalletButton />
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="border border-dashed rounded-lg bg-muted/10 p-8 w-full flex items-center justify-center">
        <div className="text-sm text-white/75">No Balances</div>
      </div>
    );
  }

  const sorted = [...walletBalances].sort((a, b) =>
    balancesSortDir === 'asc' ? a.usdValue - b.usdValue : b.usdValue - a.usdValue
  );

  return (
    <div className={wrapperClass}>
      <div className={isEmpty ? "hidden" : "flex items-center justify-between pl-6 pr-6 py-3 border-b border-sidebar-border/60 text-xs text-muted-foreground"}>
        <span className="tracking-wider font-mono font-bold">TOKEN</span>
        <button type="button" className="group inline-flex items-center" onClick={() => setBalancesSortDir((d) => d === 'desc' ? 'asc' : 'desc')}>
          <span className="uppercase tracking-wider font-mono font-bold group-hover:text-foreground">VALUE</span>
          {renderSortIcon(balancesSortDir)}
        </button>
      </div>
      <div className="p-0">
        {isLoadingWalletBalances ? (
          <BalancesListSkeleton />
        ) : (
          <div className="flex flex-col divide-y divide-sidebar-border/60">
            {sorted.map((tb) => {
              const tokenInfo = getToken(tb.symbol) as any;
              const iconSrc = tokenInfo?.icon || '/placeholder.svg';
              return (
                <div key={tb.symbol} className="flex items-center justify-between h-[64px] pl-6 pr-6 group">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full overflow-hidden bg-background flex-shrink-0">
                      <Image src={iconSrc} alt={tb.symbol} width={24} height={24} className="w-full h-full object-cover" />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium truncate max-w-[140px]">{tb.symbol}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end whitespace-nowrap pl-2 gap-1">
                    <span className="text-sm text-foreground font-medium leading-none">{formatUSD(tb.usdValue)}</span>
                    <span className="text-xs text-muted-foreground" style={{ marginTop: 2 }}>
                      {formatNumber(tb.balance, { min: 6, max: 6 })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Balances panel props
 */
export interface BalancesPanelProps {
  walletBalances: TokenBalance[];
  isLoadingWalletBalances: boolean;
  isConnected: boolean;
  balancesSortDir: 'asc' | 'desc';
  setBalancesSortDir: (fn: (d: 'asc' | 'desc') => 'asc' | 'desc') => void;
  renderSortIcon: (state: 'asc' | 'desc' | null) => React.ReactNode;
  showSkeleton?: boolean;
  faucetLastClaimTs: number;
  faucetLastCalledOnchain: bigint | undefined;
  currentChainId: number | undefined;
  isFaucetBusy: boolean;
  isFaucetConfirming: boolean;
  accountAddress: `0x${string}` | undefined;
  setIsFaucetBusy: (busy: boolean) => void;
  setFaucetHash: (hash: `0x${string}`) => void;
  writeContract: any;
  faucetAbi: any;
  refetchFaucetOnchain?: () => void;
  width?: string | number;
}

/**
 * Balances panel - full panel with faucet button and balances list
 */
export const BalancesPanel = (props: BalancesPanelProps) => {
  const { width, showSkeleton, ...rest } = props;

  return (
    <aside className="lg:flex-none" style={{ width: width || '100%' }}>
      <div className="mb-2 flex items-center gap-2 justify-between">
        <button
          type="button"
          className="px-2 py-1 text-xs rounded-md border border-sidebar-border bg-button text-foreground brightness-110"
          style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
        >
          Balances
        </button>
        <FaucetButton
          faucetLastClaimTs={rest.faucetLastClaimTs}
          faucetLastCalledOnchain={rest.faucetLastCalledOnchain}
          isConnected={rest.isConnected}
          currentChainId={rest.currentChainId}
          walletBalancesLength={rest.walletBalances.length}
          isLoadingWalletBalances={rest.isLoadingWalletBalances}
          isFaucetBusy={rest.isFaucetBusy}
          isFaucetConfirming={rest.isFaucetConfirming}
          accountAddress={rest.accountAddress}
          setIsFaucetBusy={rest.setIsFaucetBusy}
          setFaucetHash={rest.setFaucetHash}
          writeContract={rest.writeContract}
          faucetAbi={rest.faucetAbi}
          refetchFaucetOnchain={rest.refetchFaucetOnchain}
        />
      </div>
      <BalancesList
        walletBalances={rest.walletBalances}
        isLoadingWalletBalances={rest.isLoadingWalletBalances}
        isConnected={rest.isConnected}
        balancesSortDir={rest.balancesSortDir}
        setBalancesSortDir={rest.setBalancesSortDir}
        renderSortIcon={rest.renderSortIcon}
        showSkeleton={showSkeleton}
      />
    </aside>
  );
};

export default BalancesPanel;
