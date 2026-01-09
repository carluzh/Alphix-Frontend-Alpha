"use client";

/**
 * useWalletBalances - Fetches wallet token balances using batched RPC calls
 *
 * Refactored to use wagmi's useReadContracts for batched multicall.
 * This batches all ERC20 balanceOf calls into a single RPC request.
 *
 * @see interface/apps/web/src/lib/hooks/useCurrencyBalance.ts (Uniswap pattern)
 */

import { useMemo, useEffect, useState, useCallback } from "react";
import { formatUnits as viemFormatUnits, erc20Abi } from "viem";
import { useBalance, useReadContracts } from "wagmi";
import { getAllTokens, NATIVE_TOKEN_ADDRESS, type NetworkMode } from "@/lib/pools-config";
import { batchQuotePrices } from "@/lib/quote-prices";
import { MAINNET_CHAIN_ID, TESTNET_CHAIN_ID } from "@/lib/network-mode";

interface TokenBalance {
  symbol: string;
  balance: number;
  usdValue: number;
  color: string;
}

interface UseWalletBalancesConfig {
  isConnected: boolean;
  accountAddress?: `0x${string}`;
  // publicClient removed - we use wagmi hooks instead
  networkMode: NetworkMode;
  tokenDefinitions: Record<string, { decimals: number }>;
  setPositionsRefresh: (fn: (prev: number) => number) => void;
}

interface TokenInfo {
  symbol: string;
  address: `0x${string}` | undefined;
  decimals: number;
  isNative: boolean;
}

export function useWalletBalances({
  isConnected,
  accountAddress,
  networkMode,
  tokenDefinitions,
  setPositionsRefresh,
}: Omit<UseWalletBalancesConfig, 'publicClient'> & { publicClient?: unknown }) {
  const [walletBalances, setWalletBalances] = useState<TokenBalance[]>([]);
  const [priceMap, setPriceMap] = useState<Map<string, number>>(new Map());
  const [isFetchingPrices, setIsFetchingPrices] = useState(false);

  const chainId = networkMode === 'mainnet' ? MAINNET_CHAIN_ID : TESTNET_CHAIN_ID;

  // Parse token list into structured format
  const tokenList = useMemo((): TokenInfo[] => {
    const tokenMapOrArray = getAllTokens?.(networkMode) as any;
    const tokens = Array.isArray(tokenMapOrArray)
      ? tokenMapOrArray
      : Object.values(tokenMapOrArray || {});

    return tokens
      .filter((t: any) => t?.symbol)
      .map((t: any) => {
        const symbol = t.symbol as string;
        const addr = t.address as `0x${string}` | undefined;
        const isNative = !addr || addr.toLowerCase() === NATIVE_TOKEN_ADDRESS?.toLowerCase?.();
        const decimals = (tokenDefinitions as any)?.[symbol]?.decimals ?? 18;
        return { symbol, address: addr, decimals, isNative };
      });
  }, [networkMode, tokenDefinitions]);

  // Separate native token and ERC20 tokens
  const nativeToken = useMemo(() => tokenList.find(t => t.isNative), [tokenList]);
  const erc20Tokens = useMemo(() => tokenList.filter(t => !t.isNative && t.address), [tokenList]);

  // Fetch native token balance using wagmi's useBalance hook
  const { data: nativeBalance, isLoading: isLoadingNative } = useBalance({
    address: accountAddress,
    chainId,
    query: {
      enabled: isConnected && !!accountAddress && !!nativeToken,
    },
  });

  // Build contracts array for batched ERC20 balance reads
  // This is the key optimization - all balanceOf calls are batched into single multicall
  const erc20Contracts = useMemo(() => {
    if (!accountAddress || !isConnected) return [];

    return erc20Tokens.map((token) => ({
      address: token.address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [accountAddress] as const,
      chainId,
    }));
  }, [accountAddress, isConnected, erc20Tokens, chainId]);

  // Batch all ERC20 balance reads into single multicall request
  const { data: erc20Balances, isLoading: isLoadingErc20 } = useReadContracts({
    contracts: erc20Contracts,
    query: {
      enabled: isConnected && !!accountAddress && erc20Contracts.length > 0,
    },
  });

  // Combine balances into a map
  const balancesMap = useMemo(() => {
    const map = new Map<string, number>();

    // Add native balance
    if (nativeToken && nativeBalance) {
      const asFloat = parseFloat(viemFormatUnits(nativeBalance.value, nativeBalance.decimals));
      if (asFloat > 0.000001) {
        map.set(nativeToken.symbol, asFloat);
      }
    }

    // Add ERC20 balances
    if (erc20Balances) {
      erc20Tokens.forEach((token, index) => {
        const result = erc20Balances[index];
        if (result?.status === 'success' && result.result !== undefined) {
          const raw = BigInt(result.result as any);
          const asFloat = parseFloat(viemFormatUnits(raw, token.decimals));
          if (asFloat > 0.000001) {
            map.set(token.symbol, asFloat);
          }
        }
      });
    }

    return map;
  }, [nativeToken, nativeBalance, erc20Tokens, erc20Balances]);

  // Fetch prices when balances change
  useEffect(() => {
    const fetchPrices = async () => {
      const symbols = Array.from(balancesMap.keys());
      if (symbols.length === 0) {
        setPriceMap(new Map());
        return;
      }

      setIsFetchingPrices(true);
      try {
        const prices = await batchQuotePrices(symbols, chainId, networkMode);
        const newPriceMap = new Map<string, number>();
        symbols.forEach((symbol) => {
          if (prices[symbol] > 0) {
            newPriceMap.set(symbol, prices[symbol]);
          }
        });
        setPriceMap(newPriceMap);
      } catch (error) {
        console.error('[useWalletBalances] Error fetching prices:', error);
      } finally {
        setIsFetchingPrices(false);
      }
    };

    fetchPrices();
  }, [balancesMap, chainId, networkMode]);

  // Build final wallet balances array
  useEffect(() => {
    const symbols = Array.from(balancesMap.keys());

    const entries = symbols
      .map((symbol) => ({
        symbol,
        balance: balancesMap.get(symbol) || 0,
        usdValue: (balancesMap.get(symbol) || 0) * (priceMap.get(symbol) || 0),
        color: '',
      }))
      .sort((a, b) => b.usdValue - a.usdValue);

    const colors = ['hsl(0 0% 30%)', 'hsl(0 0% 40%)', 'hsl(0 0% 60%)', 'hsl(0 0% 80%)', 'hsl(0 0% 95%)'];
    entries.forEach((e, i) => { e.color = colors[i % colors.length]; });

    setWalletBalances(entries);
  }, [balancesMap, priceMap]);

  // Handle refresh events
  const handleRefresh = useCallback(() => {
    // With wagmi hooks, we don't need to manually refetch
    // The hooks will automatically refetch based on their configuration
    // But we still need to trigger positions refresh
    setPositionsRefresh(prev => prev + 1);
  }, [setPositionsRefresh]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !accountAddress) return;
      if (e.key === `walletBalancesRefreshAt_${accountAddress}`) {
        handleRefresh();
      }
    };

    window.addEventListener('walletBalancesRefresh', handleRefresh as EventListener);
    window.addEventListener('storage', onStorage);

    return () => {
      window.removeEventListener('walletBalancesRefresh', handleRefresh as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [accountAddress, handleRefresh]);

  const isLoadingWalletBalances = isLoadingNative || isLoadingErc20 || isFetchingPrices;

  return { walletBalances, isLoadingWalletBalances };
}
