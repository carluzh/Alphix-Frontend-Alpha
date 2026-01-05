"use client";

import { useState, useEffect } from "react";
import { parseAbi, type Abi } from "viem";
import { formatUnits as viemFormatUnits } from "viem";
import { getAllTokens, NATIVE_TOKEN_ADDRESS, type NetworkMode } from "@/lib/pools-config";
import { batchQuotePrices } from "@/lib/quote-prices";
import type { PublicClient } from "viem";

interface TokenBalance {
  symbol: string;
  balance: number;
  usdValue: number;
  color: string;
}

interface UseWalletBalancesConfig {
  isConnected: boolean;
  accountAddress?: `0x${string}`;
  publicClient: PublicClient | undefined;
  networkMode: NetworkMode;
  tokenDefinitions: Record<string, { decimals: number }>;
  setPositionsRefresh: (fn: (prev: number) => number) => void;
}

export function useWalletBalances({
  isConnected,
  accountAddress,
  publicClient,
  networkMode,
  tokenDefinitions,
  setPositionsRefresh,
}: UseWalletBalancesConfig) {
  const [walletBalances, setWalletBalances] = useState<TokenBalance[]>([]);
  const [isLoadingWalletBalances, setIsLoadingWalletBalances] = useState(false);

  useEffect(() => {
    const run = async () => {
      if (!isConnected || !accountAddress || !publicClient) {
        setWalletBalances([]);
        return;
      }
      setIsLoadingWalletBalances(true);
      try {
        const tokenMapOrArray = getAllTokens?.(networkMode) as any;
        const tokens = Array.isArray(tokenMapOrArray) ? tokenMapOrArray : Object.values(tokenMapOrArray || {});
        const balances: Record<string, number> = {};

        for (const t of tokens) {
          const symbol = t?.symbol as string | undefined;
          if (!symbol) continue;
          const addr = (t as any)?.address as `0x${string}` | undefined;
          try {
            let raw: bigint = 0n;
            if (!addr || addr.toLowerCase() === NATIVE_TOKEN_ADDRESS?.toLowerCase?.()) {
              raw = await publicClient.getBalance({ address: accountAddress });
            } else {
              const bal = await publicClient.readContract({
                address: addr,
                abi: parseAbi(['function balanceOf(address) view returns (uint256)']) as unknown as Abi,
                functionName: 'balanceOf',
                args: [accountAddress],
              });
              raw = BigInt(bal as any);
            }
            const dec = (tokenDefinitions as any)?.[symbol]?.decimals ?? 18;
            const asFloat = parseFloat(viemFormatUnits(raw, dec));
            balances[symbol] = asFloat;
          } catch {}
        }

        const symbols = Object.keys(balances);
        const priceMap = new Map<string, number>();
        try {
          const prices = await batchQuotePrices(symbols, 8453, networkMode);
          symbols.forEach((symbol) => {
            if (prices[symbol] > 0) priceMap.set(symbol, prices[symbol]);
          });
        } catch {}

        const entries = symbols
          .map((symbol) => ({
            symbol,
            balance: balances[symbol] || 0,
            usdValue: (balances[symbol] || 0) * (priceMap.get(symbol) || 0),
            color: '',
          }))
          // Keep tokens with balance > 0, even if price fetch failed (usdValue = 0)
          .filter((x) => x.balance > 0.000001)
          .sort((a, b) => b.usdValue - a.usdValue);

        const colors = ['hsl(0 0% 30%)', 'hsl(0 0% 40%)', 'hsl(0 0% 60%)', 'hsl(0 0% 80%)', 'hsl(0 0% 95%)'];
        entries.forEach((e, i) => { e.color = colors[i % colors.length]; });

        setWalletBalances(entries);
      } finally {
        setIsLoadingWalletBalances(false);
      }
    };
    run();

    const onRefresh = () => {
      run();
      setPositionsRefresh(prev => prev + 1);
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !accountAddress) return;
      if (e.key === `walletBalancesRefreshAt_${accountAddress}`) {
        run();
        setPositionsRefresh(prev => prev + 1);
      }
    };
    window.addEventListener('walletBalancesRefresh', onRefresh as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('walletBalancesRefresh', onRefresh as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [isConnected, accountAddress, publicClient, networkMode, tokenDefinitions, setPositionsRefresh]);

  return { walletBalances, isLoadingWalletBalances };
}
