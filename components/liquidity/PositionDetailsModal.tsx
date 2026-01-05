"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, CornerRightUp } from "lucide-react";
import { IconBadgeCheck2, IconMinus, IconCircleXmarkFilled, IconCircleInfo } from "nucleo-micro-bold-essential";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TokenStack } from "./TokenStack";
import { formatUnits, parseUnits as viemParseUnits, erc20Abi } from "viem";
import { getTokenDefinitions, TokenSymbol, getToken, NATIVE_TOKEN_ADDRESS } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { cn } from "@/lib/utils";
import { formatUSD } from "@/lib/format";
import Image from "next/image";
import { PositionChartV2 } from "./PositionChartV2";
import { getOptimalBaseToken } from "@/lib/denomination-utils";
import { calculateRealizedApr, formatApr } from "@/lib/apr";
import { Percent, Token } from '@uniswap/sdk-core';
import { PositionStatus } from '@uniswap/client-data-api/dist/data/v1/poolTypes_pb';
import { AddLiquidityFormPanel } from "./AddLiquidityFormPanel";
import { RemoveLiquidityFormPanel } from "./RemoveLiquidityFormPanel";
import { TransactionFlowPanel } from "./TransactionFlowPanel";
import { ClaimFeeModal } from "./ClaimFeeModal";
import { PositionValueSection } from "./PositionValueSection";
import { FeesEarnedSection } from "./FeesEarnedSection";
import { useAccount, useSignTypedData, useWriteContract, useWaitForTransactionReceipt, useBalance } from "wagmi";
import { useChainMismatch } from "@/hooks/useChainMismatch";
import { readContract } from '@wagmi/core';
import { config } from '@/lib/wagmiConfig';
import { useIncreaseLiquidity, type IncreasePositionData, providePreSignedIncreaseBatchPermit, useDecreaseLiquidity, type DecreasePositionData } from "@/lib/liquidity/hooks";
import { preparePermit2BatchForNewPosition } from '@/lib/liquidity-utils';
import { useCheckIncreaseApprovals, isFullRangePosition } from "@/lib/liquidity";
import { useEthersSigner } from "@/hooks/useEthersSigner";
import { isInfiniteApprovalEnabled } from "@/hooks/useUserSettings";
import { toast } from "sonner";
import { motion, useAnimation } from "framer-motion";
import { getTokenSymbolByAddress } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { type PositionInfo } from "@/lib/uniswap/liquidity";
import { useUSDCPriceRaw } from "@/lib/uniswap/hooks/useUSDCPrice";

// Define modal view types
type ModalView = 'default' | 'add-liquidity' | 'remove-liquidity';

// Status indicator component
function StatusIndicatorCircle({ className }: { className?: string }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={className}>
      <circle cx="4" cy="4" r="4" fill="currentColor" fillOpacity="0.4" />
      <circle cx="4" cy="4" r="2" fill="currentColor" />
    </svg>
  );
}

/**
 * Helper to extract token data from PositionInfo
 * Mirrors Uniswap's approach in parseFromRest.ts
 */
function getTokenDataFromPosition(position: PositionInfo) {
  const currency0 = position.currency0Amount.currency;
  const currency1 = position.currency1Amount.currency;

  const token0Symbol = currency0.symbol ?? 'TOKEN0';
  const token1Symbol = currency1.symbol ?? 'TOKEN1';
  const token0Decimals = currency0.decimals;
  const token1Decimals = currency1.decimals;
  const token0Address = currency0.isNative ? '0x0000000000000000000000000000000000000000' : (currency0 as Token).address;
  const token1Address = currency1.isNative ? '0x0000000000000000000000000000000000000000' : (currency1 as Token).address;
  const token0Amount = position.currency0Amount.toExact();
  const token1Amount = position.currency1Amount.toExact();

  return {
    token0Symbol,
    token1Symbol,
    token0Decimals,
    token1Decimals,
    token0Address,
    token1Address,
    token0Amount,
    token1Amount,
  };
}

interface PositionDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: PositionInfo;
  valueUSD: number;
  formatTokenDisplayAmount: (amount: string) => string;
  /** @deprecated Use internal useUSDCPriceRaw hook instead */
  getUsdPriceForSymbol?: (symbol?: string) => number;
  onRefreshPosition: () => void;
  currentPrice?: string | null;
  currentPoolTick?: number | null;
  apr?: number | null;
  isLoadingAPR?: boolean;
  feeTier?: number | null;
  selectedPoolId?: string;
  chainId?: number;
  currentPoolSqrtPriceX96?: string | null;
  defaultTickSpacing?: number;
  poolToken0?: any;
  poolToken1?: any;
  denominationBase?: string;
  initialMinPrice?: string;
  initialMaxPrice?: string;
  initialCurrentPrice?: string | null;
  prefetchedFormattedAPY?: string;
  prefetchedIsAPYFallback?: boolean;
  prefetchedIsLoadingAPY?: boolean;
  showViewPoolButton?: boolean;
  onViewPool?: () => void;
  onLiquidityDecreased?: (info?: { txHash?: `0x${string}`; blockNumber?: bigint; isFullBurn?: boolean }) => void;
  onAfterLiquidityAdded?: (tvlDelta: number, info: { txHash: `0x${string}`; blockNumber: bigint }) => void;
  onAfterLiquidityRemoved?: (tvlDelta: number, info: { txHash: `0x${string}`; blockNumber: bigint }) => void;
  onFeesCollected?: (positionId: string) => void;
  /** Position timestamps for APR calculation */
  blockTimestamp?: number;
  lastTimestamp?: number;
}

// Helper to extract average color from token icon (fallback to hardcoded colors)
const getTokenColor = (symbol: string): string => {
  // Fallback color mapping based on common tokens
  const colorMap: Record<string, string> = {
    'aETH': '#627EEA',
    'ETH': '#627EEA',
    'aUSDC': '#2775CA',
    'USDC': '#2775CA',
    'aUSDT': '#26A17B',
    'USDT': '#26A17B',
    'aDAI': '#F5AC37',
    'DAI': '#F5AC37',
    'WETH': '#627EEA',
  };
  return colorMap[symbol] || '#9CA3AF'; // Default gray
};

export function PositionDetailsModal({
  isOpen,
  onClose,
  position,
  valueUSD,
  formatTokenDisplayAmount,
  getUsdPriceForSymbol,
  onRefreshPosition,
  feeTier,
  selectedPoolId,
  chainId: propChainId, // Renamed to avoid conflict with network context chainId
  currentPrice,
  currentPoolTick,
  currentPoolSqrtPriceX96,
  defaultTickSpacing = 60,
  poolToken0,
  poolToken1,
  denominationBase,
  initialMinPrice,
  initialMaxPrice,
  initialCurrentPrice,
  prefetchedFormattedAPY,
  prefetchedIsAPYFallback,
  prefetchedIsLoadingAPY,
  showViewPoolButton,
  onViewPool,
  onLiquidityDecreased: onLiquidityDecreasedProp,
  onAfterLiquidityAdded,
  onAfterLiquidityRemoved,
  onFeesCollected,
  apr,
  blockTimestamp: propBlockTimestamp,
  lastTimestamp: propLastTimestamp,
}: PositionDetailsModalProps) {
  // Extract token data from PositionInfo using helper
  const {
    token0Symbol,
    token1Symbol,
    token0Decimals,
    token1Decimals,
    token0Address,
    token1Address,
    token0Amount,
    token1Amount,
  } = useMemo(() => getTokenDataFromPosition(position), [position]);

  // Get USD prices for tokens using Uniswap routing (fixes bug where tokens not in priceMap returned $0)
  const { price: token0PriceFromHook } = useUSDCPriceRaw(position.currency0Amount.currency);
  const { price: token1PriceFromHook } = useUSDCPriceRaw(position.currency1Amount.currency);

  // Internal pricing function that uses hook-based prices, falling back to prop if provided
  const getPrice = useCallback((symbol?: string): number => {
    if (!symbol) return 0;
    // First try hook-based pricing
    if (symbol === token0Symbol && token0PriceFromHook !== undefined) {
      return token0PriceFromHook;
    }
    if (symbol === token1Symbol && token1PriceFromHook !== undefined) {
      return token1PriceFromHook;
    }
    // Fallback to legacy prop if provided
    if (getUsdPriceForSymbol) {
      return getUsdPriceForSymbol(symbol);
    }
    return 0;
  }, [token0Symbol, token1Symbol, token0PriceFromHook, token1PriceFromHook, getUsdPriceForSymbol]);

  // Extract position ID and status from PositionInfo
  const positionId = position.tokenId;
  const isInRange = position.status === PositionStatus.IN_RANGE;
  const tickLower = position.tickLower!;
  const tickUpper = position.tickUpper!;
  const poolId = position.poolId;
  const liquidity = position.liquidity;

  // Extract fees from PositionInfo (SDK CurrencyAmount objects)
  const { prefetchedRaw0, prefetchedRaw1 } = useMemo(() => {
    const raw0 = position.token0UncollectedFees ?? '0';
    const raw1 = position.token1UncollectedFees ?? '0';
    return { prefetchedRaw0: raw0, prefetchedRaw1: raw1 };
  }, [position.token0UncollectedFees, position.token1UncollectedFees]);

  // TokenStack-compatible position object
  const tokenStackPosition = useMemo(
    () => ({ token0: { symbol: token0Symbol }, token1: { symbol: token1Symbol } }),
    [token0Symbol, token1Symbol]
  );

  const [mounted, setMounted] = useState(false);
  const [chartKey, setChartKey] = useState(0);
  const [currentView, setCurrentView] = useState<ModalView>('default');
  const isMobile = useIsMobile();

  // Preview state for showing impact of actions
  const [previewAddAmount0, setPreviewAddAmount0] = useState<number>(0);
  const [previewAddAmount1, setPreviewAddAmount1] = useState<number>(0);
  const [previewRemoveAmount0, setPreviewRemoveAmount0] = useState<number>(0);
  const [previewRemoveAmount1, setPreviewRemoveAmount1] = useState<number>(0);

  // Interim confirmation views (like the standalone modals)
  const [showInterimConfirmation, setShowInterimConfirmation] = useState(false);
  const [showTransactionOverview, setShowTransactionOverview] = useState(false);

  // ClaimFeeModal state
  const [showClaimFeeModal, setShowClaimFeeModal] = useState(false);

  // Add Liquidity transaction state
  const [increaseAmount0, setIncreaseAmount0] = useState<string>("");
  const [increaseAmount1, setIncreaseAmount1] = useState<string>("");
  const [increaseStep, setIncreaseStep] = useState<'input' | 'approve' | 'permit' | 'deposit'>('input');
  const [increaseBatchPermitSigned, setIncreaseBatchPermitSigned] = useState(false);

  const { address: accountAddress } = useAccount();
  const { chainId, networkMode } = useNetwork();
  // Always use network context chainId for queries (not wallet chainId)
  const { isMismatched: isChainMismatched } = useChainMismatch();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync: approveERC20Async } = useWriteContract();
  const approvalWiggleControls = useAnimation();
  const signer = useEthersSigner();

  // Get user balances for tokens
  const { data: token0Balance } = useBalance({
    address: accountAddress,
    token: tokenDefinitions[token0Symbol as TokenSymbol]?.address === "0x0000000000000000000000000000000000000000"
      ? undefined
      : tokenDefinitions[token0Symbol as TokenSymbol]?.address as `0x${string}` | undefined,
    chainId: chainId,
    query: { enabled: !!accountAddress && !!chainId && !!position },
  });

  const { data: token1Balance } = useBalance({
    address: accountAddress,
    token: tokenDefinitions[token1Symbol as TokenSymbol]?.address === "0x0000000000000000000000000000000000000000"
      ? undefined
      : tokenDefinitions[token1Symbol as TokenSymbol]?.address as `0x${string}` | undefined,
    chainId: chainId,
    query: { enabled: !!accountAddress && !!chainId && !!position },
  });

  const [currentTransactionStep, setCurrentTransactionStep] = useState<'idle' | 'collecting_fees' | 'approving_token0' | 'approving_token1' | 'signing_permit' | 'depositing'>('idle');

  // Check approvals for increase liquidity (matching AddLiquidityForm pattern)
  const {
    data: increaseApprovalData,
    isLoading: isCheckingIncreaseApprovals,
    refetch: refetchIncreaseApprovals,
  } = useCheckIncreaseApprovals(
    accountAddress && chainId && positionId
      ? {
          userAddress: accountAddress,
          tokenId: BigInt(positionId),
          token0Symbol: token0Symbol as TokenSymbol,
          token1Symbol: token1Symbol as TokenSymbol,
          amount0: increaseAmount0,
          amount1: increaseAmount1,
          fee0: prefetchedRaw0 || undefined,
          fee1: prefetchedRaw1 || undefined,
          chainId: chainId,
        }
      : undefined,
    {
      enabled: Boolean(accountAddress && chainId && positionId && (parseFloat(increaseAmount0 || '0') > 0 || parseFloat(increaseAmount1 || '0') > 0)),
      staleTime: 5000,
    }
  );

  const lastIncreaseTxInfoRef = React.useRef<{ txHash: `0x${string}`; blockNumber: bigint } | null>(null);
  const {
    increaseLiquidity,
    isLoading: isIncreasingLiquidity,
    isSuccess: isIncreaseSuccess,
    hash: increaseTxHash,
    reset: resetIncrease
  } = useIncreaseLiquidity({
    onLiquidityIncreased: (info) => {
      setShowInterimConfirmation(false);
      if (info?.txHash && info?.blockNumber) {
        lastIncreaseTxInfoRef.current = { txHash: info.txHash, blockNumber: info.blockNumber };
      }
    },
  });

  const [withdrawAmount0, setWithdrawAmount0] = useState<string>("");
  const [withdrawAmount1, setWithdrawAmount1] = useState<string>("");
  const [withdrawActiveInputSide, setWithdrawActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isWithdrawCalculating, setIsWithdrawCalculating] = useState(false);
  const [txStarted, setTxStarted] = useState(false);
  const [wasDecreasingLiquidity, setWasDecreasingLiquidity] = useState(false);
  const [currentSessionTxHash, setCurrentSessionTxHash] = useState<string | null>(null);

  // useDecreaseLiquidity hook - mirrors useIncreaseLiquidity pattern
  const lastDecreaseTxInfoRef = React.useRef<{ txHash: `0x${string}`; blockNumber: bigint; isFullBurn?: boolean } | null>(null);
  const {
    decreaseLiquidity,
    claimFees,
    isLoading: isDecreasingLiquidity,
    isSuccess: isDecreaseSuccess,
    hash: decreaseTxHash,
    reset: resetDecrease
  } = useDecreaseLiquidity({
    onLiquidityDecreased: (info) => {
      setShowInterimConfirmation(false);
      if (info?.txHash && info?.blockNumber) {
        lastDecreaseTxInfoRef.current = { txHash: info.txHash, blockNumber: info.blockNumber, isFullBurn: info.isFullBurn };
      }
      if (onLiquidityDecreasedProp) {
        onLiquidityDecreasedProp(info);
      } else {
        onRefreshPosition?.();
      }
    },
    onFeesCollected: () => {
      if (positionId) onFeesCollected?.(positionId);
      onRefreshPosition?.();
    },
  });

  // Check what ERC20 approvals are needed
  const checkIncreaseApprovals = useCallback(async (): Promise<TokenSymbol[]> => {
    if (!accountAddress || !chainId) return [];

    const needsApproval: TokenSymbol[] = [];
    const tokens = [
      { symbol: token0Symbol as TokenSymbol, amount: increaseAmount0 },
      { symbol: token1Symbol as TokenSymbol, amount: increaseAmount1 }
    ];

    for (const token of tokens) {
      if (!token.amount || parseFloat(token.amount) <= 0) continue;

      const tokenDef = tokenDefinitions[token.symbol];
      if (!tokenDef || tokenDef.address === "0x0000000000000000000000000000000000000000") continue;

      try {
        const allowance = await readContract(config, {
          address: tokenDef.address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [accountAddress, "0x000000000022D473030F116dDEE9F6B43aC78BA3"]
        });

        const requiredAmount = viemParseUnits(token.amount, tokenDef.decimals);
        if (allowance < requiredAmount) {
          needsApproval.push(token.symbol);
        }
      } catch (error) {
        // Skip token if allowance check fails
      }
    }

    return needsApproval;
  }, [accountAddress, chainId, position, increaseAmount0, increaseAmount1]);

  // Handle ERC20 approval to Permit2 (matching AddLiquidityForm)
  const handleIncreaseApproveV2 = useCallback(async (tokenSymbol: TokenSymbol) => {
    const tokenConfig = tokenDefinitions[tokenSymbol];
    if (!tokenConfig) throw new Error(`Token ${tokenSymbol} not found`);

    toast('Confirm in Wallet', {
      icon: React.createElement(IconCircleInfo, { className: 'h-4 w-4' })
    });

    const useInfinite = isInfiniteApprovalEnabled();
    let approvalAmount: bigint = BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935");

    if (!useInfinite) {
      const exactAmount = tokenSymbol === token0Symbol ? increaseAmount0 : increaseAmount1;
      if (exactAmount) {
        try {
          approvalAmount = viemParseUnits(exactAmount, tokenConfig.decimals) + 1n; // +1 wei buffer
        } catch {
          // Fall back to infinite on parse error
        }
      }
    }

    const hash = await approveERC20Async({
      address: tokenConfig.address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'approve',
      args: ["0x000000000022D473030F116dDEE9F6B43aC78BA3" as `0x${string}`, approvalAmount],
    });

    toast.success(`${tokenSymbol} Approved`, {
      icon: React.createElement(IconBadgeCheck2, { className: 'h-4 w-4 text-green-500' }),
      description: useInfinite ? `Approved infinite ${tokenSymbol} for liquidity` : `Approved exact ${tokenSymbol} for liquidity`,
    });
  }, [approveERC20Async, tokenDefinitions, token0Symbol, increaseAmount0, increaseAmount1]);

  const hasUncollectedFees = useCallback(() => {
    if (!position || isInRange) return false;
    const fee0 = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), tokenDefinitions[token0Symbol as string]?.decimals || 18));
    const fee1 = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), tokenDefinitions[token1Symbol as string]?.decimals || 18));
    return fee0 > 0 || fee1 > 0;
  }, [position, prefetchedRaw0, prefetchedRaw1]);

  // Old getNextStep and handleIncreaseTransactionV2 removed - now using TransactionFlowPanel

  // Wrapper for TransactionFlowPanel - permit signing handled by API
  const handleIncreaseDeposit = useCallback(async () => {
    if (!position) return;

    let finalAmount0 = increaseAmount0 || '0';
    let finalAmount1 = increaseAmount1 || '0';

    if (!isInRange && currentPoolTick !== null && currentPoolTick !== undefined) {
      if (currentPoolTick >= tickUpper) finalAmount0 = '0';
      else if (currentPoolTick <= tickLower) finalAmount1 = '0';
    }

    const data: IncreasePositionData = {
      tokenId: positionId || '0',
      token0Symbol: token0Symbol as TokenSymbol,
      token1Symbol: token1Symbol as TokenSymbol,
      additionalAmount0: finalAmount0,
      additionalAmount1: finalAmount1,
      poolId: poolId,
      tickLower: tickLower,
      tickUpper: tickUpper,
      feesForIncrease: { amount0: prefetchedRaw0 || '0', amount1: prefetchedRaw1 || '0' },
    };

    increaseLiquidity(data);
  }, [position, increaseAmount0, increaseAmount1, currentPoolTick, prefetchedRaw0, prefetchedRaw1, increaseLiquidity]);


  // Remove Liquidity handler functions
  const handleConfirmWithdraw = useCallback(() => {
    if (!position || (!withdrawAmount0 && !withdrawAmount1)) {
      toast.error("Invalid Amount", {
        icon: React.createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
        description: "Please enter an amount to withdraw.",
        duration: 4000
      });
      return;
    }

    // Balance check is handled by button disabled state, no need for toast

    // For out-of-range positions, ensure at least one amount is greater than 0
    if (!isInRange) {
      const amount0Num = parseFloat(withdrawAmount0 || "0");
      const amount1Num = parseFloat(withdrawAmount1 || "0");
      if (amount0Num <= 0 && amount1Num <= 0) {
        toast.error("Invalid Amount", {
          icon: React.createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
          description: "Please enter an amount to withdraw.",
          duration: 4000
        });
        return;
      }
    }

    // Show interim confirmation
    setShowInterimConfirmation(true);
  }, [position, withdrawAmount0, withdrawAmount1]);

  const handleFinalConfirmWithdraw = useCallback(() => {
    if (!position) return;

    // Show transaction overview
    setShowTransactionOverview(true);
  }, [position]);

  const handleExecuteWithdrawTransaction = useCallback(() => {
    if (!position) return;


    // Map position token addresses to correct token symbols
    const token0Symbol = getTokenSymbolByAddress(token0Address, networkMode);
    const token1Symbol = getTokenSymbolByAddress(token1Address, networkMode);

    if (!token0Symbol || !token1Symbol) {
      toast.error("Configuration Error", {
        icon: React.createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
        description: "Token configuration is invalid.",
        action: {
          label: "Open Ticket",
          onClick: () => window.open('https://discord.com/invite/NTXRarFbTr', '_blank')
        }
      });
      return;
    }

    const amt0 = parseFloat(withdrawAmount0 || '0');
    const amt1 = parseFloat(withdrawAmount1 || '0');
    const max0Eff = parseFloat(token0Amount || '0');
    const max1Eff = parseFloat(token1Amount || '0');
    const pct0 = max0Eff > 0 ? amt0 / max0Eff : 0;
    const pct1 = max1Eff > 0 ? amt1 / max1Eff : 0;
    const effectivePct = Math.max(pct0, pct1) * 100;
    const isExactly100 = (max0Eff > 0 ? Math.abs(pct0 - 1.0) < 0.0001 : true) && (max1Eff > 0 ? Math.abs(pct1 - 1.0) < 0.0001 : true);
    const formatAmount = (amt: string | number): string => {
      if (!amt) return '0';
      const num = typeof amt === 'string' ? parseFloat(amt) : amt;
      return (isNaN(num) || num === 0) ? '0' : num.toFixed(18).replace(/\.?0+$/, '');
    };

    const decreaseData: DecreasePositionData = {
      tokenId: positionId || '0',
      token0Symbol: token0Symbol,
      token1Symbol: token1Symbol,
      decreaseAmount0: formatAmount(withdrawAmount0),
      decreaseAmount1: formatAmount(withdrawAmount1),
      isFullBurn: isExactly100,
      poolId: poolId,
      tickLower: tickLower,
      tickUpper: tickUpper,
      enteredSide: withdrawActiveInputSide === 'amount0' ? 'token0' : withdrawActiveInputSide === 'amount1' ? 'token1' : undefined,
    };

    toast("Confirm Withdraw", { icon: React.createElement(IconCircleInfo, { className: "h-4 w-4" }) });

    if (isInRange) {
      const pctRounded = isExactly100 ? 100 : Math.max(0, Math.min(100, Math.round(effectivePct)));
      decreaseLiquidity(decreaseData, pctRounded);
    } else {
      decreaseLiquidity(decreaseData, 0);
    }

    setTxStarted(true);
  }, [position, withdrawAmount0, withdrawAmount1, withdrawActiveInputSide, decreaseLiquidity]);

  const feeTierDisplay = useMemo(() => {
    if (feeTier === null || feeTier === undefined) return null;
    const pct = feeTier / 100;
    const formatted = pct < 0.1 ? pct.toFixed(3) : pct.toFixed(2);
    return `${formatted}%`;
  }, [feeTier]);

  const isWithdrawBurn = useMemo(() => {
    const amt0 = parseFloat(withdrawAmount0 || '0');
    const amt1 = parseFloat(withdrawAmount1 || '0');
    const max0 = parseFloat(token0Amount || '0');
    const max1 = parseFloat(token1Amount || '0');
    const pct0 = max0 > 0 ? amt0 / max0 : 0;
    const pct1 = max1 > 0 ? amt1 / max1 : 0;
    return (max0 > 0 ? Math.abs(pct0 - 1.0) < 0.0001 : true) && (max1 > 0 ? Math.abs(pct1 - 1.0) < 0.0001 : true);
  }, [withdrawAmount0, withdrawAmount1, token0Amount, token1Amount]);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Lock body scroll when modal is open on mobile to prevent background scrolling
  useEffect(() => {
    if (!isOpen || !isMobile) return;

    const originalOverflow = document.body.style.overflow;
    const originalPosition = document.body.style.position;
    const originalWidth = document.body.style.width;
    const originalTop = document.body.style.top;
    const scrollY = window.scrollY;

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.top = `-${scrollY}px`;

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.position = originalPosition;
      document.body.style.width = originalWidth;
      document.body.style.top = originalTop;
      window.scrollTo(0, scrollY);
    };
  }, [isOpen, isMobile]);

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

  useEffect(() => {
    setChartKey(prev => prev + 1);
    if (isOpen) {
      setCurrentView('default');
      setPreviewAddAmount0(0);
      setPreviewAddAmount1(0);
      setPreviewRemoveAmount0(0);
      setPreviewRemoveAmount1(0);
      setShowInterimConfirmation(false);
    }
  }, [isOpen, positionId]);

  // Handlers for switching views
  const handleAddLiquidityClick = () => {
    setCurrentView('add-liquidity');
    setPreviewAddAmount0(0);
    setPreviewAddAmount1(0);
    setPreviewRemoveAmount0(0);
    setPreviewRemoveAmount1(0);
    setShowInterimConfirmation(false);
    setIncreaseStep('input');
    setIncreaseBatchPermitSigned(false);
    setCurrentTransactionStep('idle');
  };

  const handleRemoveLiquidityClick = () => {
    setCurrentView('remove-liquidity');
    setPreviewAddAmount0(0);
    setPreviewAddAmount1(0);
    setPreviewRemoveAmount0(0);
    setPreviewRemoveAmount1(0);
    setShowInterimConfirmation(false);
  };

  const handleCollectFeesClick = () => {
    if (hasZeroFees) return;
    setShowClaimFeeModal(true);
  };

  const handleBackToDefault = () => {
    setCurrentView('default');
    setPreviewAddAmount0(0);
    setPreviewAddAmount1(0);
    setPreviewRemoveAmount0(0);
    setPreviewRemoveAmount1(0);
    setShowInterimConfirmation(false);
  };

  // Handlers for form panel callbacks
  const handleAddLiquiditySuccess = useCallback(async () => {
    // Calculate TVL delta and notify parent for optimistic updates
    if (onAfterLiquidityAdded && lastIncreaseTxInfoRef.current) {
      const amt0 = parseFloat(increaseAmount0 || '0');
      const amt1 = parseFloat(increaseAmount1 || '0');
      const price0 = getPrice(token0Symbol);
      const price1 = getPrice(token1Symbol);
      const tvlDelta = (amt0 * price0) + (amt1 * price1);

      if (tvlDelta > 0) {
        onAfterLiquidityAdded(tvlDelta, lastIncreaseTxInfoRef.current);
      }
    }

    // Note: Cache invalidation handled by parent onAfterLiquidityAdded callback
    // to avoid double-invalidation

    // Reset transaction state to clear success flags
    resetIncrease();

    setCurrentView('default');
    setIncreaseAmount0("");
    setIncreaseAmount1("");
    setShowInterimConfirmation(false);
    setShowTransactionOverview(false);
    setPreviewAddAmount0(0);
    setPreviewAddAmount1(0);

    // Trigger position refresh with backoff
    onRefreshPosition();
  }, [onRefreshPosition, accountAddress, selectedPoolId, positionId, resetIncrease, onAfterLiquidityAdded, increaseAmount0, increaseAmount1, token0Symbol, token1Symbol, getPrice]);

  const handleRemoveLiquiditySuccess = useCallback(async () => {
    // Calculate TVL delta (negative) and notify parent for optimistic updates
    if (onAfterLiquidityRemoved && lastDecreaseTxInfoRef.current) {
      const amt0 = parseFloat(withdrawAmount0 || '0');
      const amt1 = parseFloat(withdrawAmount1 || '0');
      const price0 = getPrice(token0Symbol);
      const price1 = getPrice(token1Symbol);
      const tvlDelta = -Math.abs((amt0 * price0) + (amt1 * price1)); // Negative for removal

      if (tvlDelta < 0) {
        onAfterLiquidityRemoved(tvlDelta, lastDecreaseTxInfoRef.current);
      }
    }

    // Note: Cache invalidation handled by parent onAfterLiquidityRemoved callback
    // to avoid double-invalidation

    resetDecrease();

    // Check if position was fully closed (100% withdrawal)
    const wasFullyClosed = isWithdrawBurn;

    setCurrentView('default');
    setWithdrawAmount0("");
    setWithdrawAmount1("");
    setPreviewRemoveAmount0(0);
    setPreviewRemoveAmount1(0);

    onRefreshPosition();

    if (wasFullyClosed) {
      // Small delay to allow users to see the success state
      setTimeout(() => {
        onClose();
      }, 1500);
    }
  }, [onRefreshPosition, accountAddress, selectedPoolId, positionId, resetDecrease, isWithdrawBurn, onClose, onAfterLiquidityRemoved, withdrawAmount0, withdrawAmount1, token0Symbol, token1Symbol, getPrice]);

  // Handlers for preview updates
  const handleAddAmountsChange = useCallback((amount0: number, amount1: number) => {
    setPreviewAddAmount0(amount0);
    setPreviewAddAmount1(amount1);
  }, []);

  const handleRemoveAmountsChange = useCallback((amount0: number, amount1: number) => {
    setPreviewRemoveAmount0(amount0);
    setPreviewRemoveAmount1(amount1);
  }, []);

  // Calculate fees
  const { feeAmount0, feeAmount1, feesUSD, hasZeroFees } = useMemo(() => {
    if (prefetchedRaw0 === null || prefetchedRaw1 === null) {
      return { feeAmount0: 0, feeAmount1: 0, feesUSD: 0, hasZeroFees: false };
    }

    try {
      const raw0 = prefetchedRaw0 || '0';
      const raw1 = prefetchedRaw1 || '0';

      const d0 = tokenDefinitions?.[token0Symbol as string]?.decimals ?? 18;
      const d1 = tokenDefinitions?.[token1Symbol as string]?.decimals ?? 18;

      const fee0 = parseFloat(formatUnits(BigInt(raw0), d0));
      const fee1 = parseFloat(formatUnits(BigInt(raw1), d1));

      const price0 = getPrice(token0Symbol);
      const price1 = getPrice(token1Symbol);

      const usdFees = (fee0 * price0) + (fee1 * price1);
      const hasZero = BigInt(raw0) <= 0n && BigInt(raw1) <= 0n;

      return {
        feeAmount0: fee0,
        feeAmount1: fee1,
        feesUSD: usdFees,
        hasZeroFees: hasZero
      };
    } catch {
      return { feeAmount0: 0, feeAmount1: 0, feesUSD: 0, hasZeroFees: true };
    }
  }, [prefetchedRaw0, prefetchedRaw1, position, getPrice]);

  // Calculate individual token USD values
  const token0USD = parseFloat(token0Amount) * getPrice(token0Symbol);
  const token1USD = parseFloat(token1Amount) * getPrice(token1Symbol);

  const fee0USD = feeAmount0 * getPrice(token0Symbol);
  const fee1USD = feeAmount1 * getPrice(token1Symbol);

  const { computedFormattedAPR, computedIsAPRFallback, computedIsLoadingAPR } = useMemo(() => {
    if (prefetchedFormattedAPY !== undefined) {
      return {
        computedFormattedAPR: prefetchedFormattedAPY,
        computedIsAPRFallback: prefetchedIsAPYFallback ?? false,
        computedIsLoadingAPR: prefetchedIsLoadingAPY ?? false,
      };
    }
    if (valueUSD <= 0) {
      return { computedFormattedAPR: '–', computedIsAPRFallback: false, computedIsLoadingAPR: true };
    }
    if (!isInRange) {
      return { computedFormattedAPR: '0%', computedIsAPRFallback: false, computedIsLoadingAPR: false };
    }

    const nowTimestamp = Math.floor(Date.now() / 1000);
    const positionTimestamp = propLastTimestamp || propBlockTimestamp || nowTimestamp;
    const durationDays = (nowTimestamp - positionTimestamp) / 86400;

    const fallbackApr = apr !== null && apr !== undefined && isFinite(apr)
      ? new Percent(Math.round(apr * 100), 10000)
      : null;

    const result = calculateRealizedApr(feesUSD, valueUSD, durationDays, fallbackApr);
    return {
      computedFormattedAPR: formatApr(result.apr),
      computedIsAPRFallback: result.isFallback,
      computedIsLoadingAPR: false,
    };
  }, [prefetchedFormattedAPY, prefetchedIsAPYFallback, prefetchedIsLoadingAPY, feesUSD, valueUSD, propBlockTimestamp, propLastTimestamp, isInRange, apr]);

  // Calculate denomination if not provided by parent
  const calculatedDenominationBase = useMemo(() => {
    if (denominationBase) return denominationBase;
    const priceNum = currentPrice ? parseFloat(currentPrice) : undefined;
    return getOptimalBaseToken(token0Symbol, token1Symbol, priceNum);
  }, [denominationBase, currentPrice, token0Symbol, token1Symbol]);

  const { calculatedMinPrice, calculatedMaxPrice, calculatedCurrentPrice } = useMemo(() => {
    if (initialMinPrice && initialMaxPrice && initialCurrentPrice !== undefined) {
      return {
        calculatedMinPrice: initialMinPrice,
        calculatedMaxPrice: initialMaxPrice,
        calculatedCurrentPrice: initialCurrentPrice
      };
    }

    const shouldInvert = calculatedDenominationBase === token0Symbol;

    // Calculate prices from ticks (SDK-aligned approach)
    let minPoolPrice: number;
    let maxPoolPrice: number;

    if (currentPrice && currentPoolTick !== null && currentPoolTick !== undefined) {
      const currentPriceNum = parseFloat(currentPrice);
      if (isFinite(currentPriceNum)) {
        minPoolPrice = currentPriceNum * Math.pow(1.0001, tickLower - currentPoolTick);
        maxPoolPrice = currentPriceNum * Math.pow(1.0001, tickUpper - currentPoolTick);
      } else {
        minPoolPrice = Math.pow(1.0001, tickLower);
        maxPoolPrice = Math.pow(1.0001, tickUpper);
      }
    } else {
      minPoolPrice = Math.pow(1.0001, tickLower);
      maxPoolPrice = Math.pow(1.0001, tickUpper);
    }

    const minDisplay = shouldInvert ? (1 / maxPoolPrice) : minPoolPrice;
    const maxDisplay = shouldInvert ? (1 / minPoolPrice) : maxPoolPrice;

    let displayedCurrentPrice: string | null = null;
    if (currentPrice) {
      const priceNum = parseFloat(currentPrice);
      if (isFinite(priceNum)) {
        displayedCurrentPrice = (shouldInvert ? (1 / priceNum) : priceNum).toString();
      }
    }

    return {
      calculatedMinPrice: isFinite(minDisplay) ? minDisplay.toString() : '0',
      calculatedMaxPrice: isFinite(maxDisplay) ? maxDisplay.toString() : '∞',
      calculatedCurrentPrice: displayedCurrentPrice
    };
  }, [initialMinPrice, initialMaxPrice, initialCurrentPrice, calculatedDenominationBase, token0Symbol, tickLower, tickUpper, currentPrice, currentPoolTick]);

  // Use calculated or inherited values
  const minPriceActual = calculatedMinPrice;
  const maxPriceActual = calculatedMaxPrice;
  const currentPriceActual = calculatedCurrentPrice;

  // Check if full range (uses centralized detection mirroring Uniswap's useIsTickAtLimit)
  const isFullRange = isFullRangePosition(defaultTickSpacing, tickLower, tickUpper);

  const statusText = isFullRange ? 'Full Range' : isInRange ? 'In Range' : 'Out of Range';
  const statusColor = isFullRange ? 'text-green-500' : isInRange ? 'text-green-500' : 'text-red-500';

  // Get token logos
  const getTokenLogo = (symbol: string) => {
    const token = getToken(symbol);
    return token?.icon || '/placeholder-logo.svg';
  };

  // Get token colors for bars
  const token0Color = getTokenColor(token0Symbol);
  const token1Color = getTokenColor(token1Symbol);

  // Calculate percentage bars for position (with preview adjustments)
  const positionBars = useMemo(() => {
    // Calculate preview-adjusted amounts
    const price0 = getPrice(token0Symbol);
    const price1 = getPrice(token1Symbol);

    const previewAdjustment0 = (previewAddAmount0 - previewRemoveAmount0) * price0;
    const previewAdjustment1 = (previewAddAmount1 - previewRemoveAmount1) * price1;

    const adjustedToken0USD = token0USD + previewAdjustment0;
    const adjustedToken1USD = token1USD + previewAdjustment1;

    const total = adjustedToken0USD + adjustedToken1USD;
    if (total === 0) return null;

    const token0Percent = (adjustedToken0USD / total) * 100;
    const token1Percent = (adjustedToken1USD / total) * 100;

    return { token0Percent, token1Percent };
  }, [token0USD, token1USD, previewAddAmount0, previewAddAmount1, previewRemoveAmount0, previewRemoveAmount1, position, getPrice]);

  // Calculate percentage bars for fees
  const feesBars = useMemo(() => {
    const total = fee0USD + fee1USD;
    if (total === 0 || hasZeroFees) return null;

    const fee0Percent = (fee0USD / total) * 100;
    const fee1Percent = (fee1USD / total) * 100;

    return { fee0Percent, fee1Percent };
  }, [fee0USD, fee1USD, hasZeroFees]);

  const isAddingLiquidity = previewAddAmount0 > 0 || previewAddAmount1 > 0;
  const isRemovingLiquidity = previewRemoveAmount0 > 0 || previewRemoveAmount1 > 0;

  const hasZeroToken0 = parseFloat(token0Amount) === 0;
  const hasZeroToken1 = parseFloat(token1Amount) === 0;

  const displayFeesUSD = feesUSD;
  const displayFee0USD = fee0USD;
  const displayFee1USD = fee1USD;

  const displayFeeAmount0 = feeAmount0 === 0 ? '0' :
    feeAmount0 > 0 && feeAmount0 < 0.0001 ? "< 0.0001" :
    Math.abs(feeAmount0) < 0.000001 ? '0' :
    feeAmount0.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 0 });

  const displayFeeAmount1 = feeAmount1 === 0 ? '0' :
    feeAmount1 > 0 && feeAmount1 < 0.0001 ? "< 0.0001" :
    Math.abs(feeAmount1) < 0.000001 ? '0' :
    feeAmount1.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 0 });

  if (!mounted || !isOpen) {
    return null;
  }

  return [createPortal(
    <div
      key="position-details-modal"
      className={`fixed inset-0 z-[9999] flex backdrop-blur-md cursor-default ${isMobile ? 'items-end' : 'items-center justify-center'}`}
      style={{
        pointerEvents: 'auto',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        paddingTop: isMobile ? 'env(safe-area-inset-top, 0px)' : undefined,
        paddingBottom: isMobile ? 'env(safe-area-inset-bottom, 0px)' : undefined,
        overflow: 'hidden',
        overscrollBehavior: 'contain',
      }}
      onMouseDown={(e) => {
        // Only close if clicking directly on backdrop (not bubbling from child)
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      onTouchMove={(e) => {
        // Prevent touch scroll on backdrop from scrolling background
        if (e.target === e.currentTarget) {
          e.preventDefault();
        }
      }}
    >
      <div
        className={`relative rounded-lg border border-solid shadow-2xl flex flex-col cursor-default ${isMobile ? 'w-full rounded-b-none' : ''}`}
        style={{
          width: isMobile ? '100%' : '1000px',
          maxWidth: isMobile ? '100%' : '95vw',
          maxHeight: isMobile ? 'min(95dvh, 95vh)' : '95vh',
          backgroundColor: 'var(--modal-background)',
          borderColor: 'var(--border-primary)',
          borderRadius: isMobile ? '16px 16px 0 0' : undefined,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-lg bg-muted/10 border-0 transition-colors flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-sidebar-border/60 flex-shrink-0">
            <h2 className="mt-0.5 text-xs tracking-wider text-muted-foreground font-mono font-bold">POSITION INFORMATION</h2>
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
            className="overflow-y-auto overflow-x-hidden px-4 pt-4 pb-4 space-y-4 flex-1 min-h-0 overscroll-contain touch-pan-y"
            style={{ WebkitOverflowScrolling: 'touch' as any }}
          >
            {/* Pool Info */}
            <div className="overflow-hidden rounded-lg bg-muted/30 border border-sidebar-border/60">
              <div
                className={cn(
                  "px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center",
                  showViewPoolButton && onViewPool && "cursor-pointer hover:bg-muted/20 transition-colors"
                )}
                onClick={() => {
                  if (showViewPoolButton && onViewPool) {
                    onViewPool();
                    onClose();
                  }
                }}
              >
                {/* Row 1 (mobile): token images + pair + status */}
                <div className="flex items-center gap-3 min-w-0 w-full">
                  <TokenStack position={tokenStackPosition} />
                  <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <h3 className="text-base font-semibold truncate">
                      {token0Symbol} / {token1Symbol}
                    </h3>
                    <div className="flex items-center gap-2 flex-wrap">
                      {feeTierDisplay && (
                        <Badge
                          variant="secondary"
                          className="bg-muted/30 text-muted-foreground border border-sidebar-border/60 text-[11px] h-5 px-1.5"
                        >
                          {feeTierDisplay}
                        </Badge>
                      )}
                      <div className={cn("flex items-center gap-1.5", statusColor)}>
                        <StatusIndicatorCircle className={statusColor} />
                        <span className="text-[11px] font-medium">{statusText}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Row 2 (mobile): actions */}
                <div className="flex items-center justify-end gap-1 w-full flex-wrap md:flex-nowrap md:w-auto md:ml-auto md:mt-[25px]">
                  <Button
                    onClick={(e) => { e.stopPropagation(); handleAddLiquidityClick(); }}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 md:px-2.5 md:text-xs",
                      currentView === 'add-liquidity' && "bg-muted/50 text-foreground"
                    )}
                  >
                    Add Liquidity
                  </Button>
                  <Button
                    onClick={(e) => { e.stopPropagation(); handleRemoveLiquidityClick(); }}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 md:px-2.5 md:text-xs",
                      currentView === 'remove-liquidity' && "bg-muted/50 text-foreground"
                    )}
                  >
                    Remove Liquidity
                  </Button>
                  <Button
                    onClick={(e) => { e.stopPropagation(); handleCollectFeesClick(); }}
                    disabled={hasZeroFees || isDecreasingLiquidity}
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 disabled:opacity-40 md:px-2.5 md:text-xs",
                      isDecreasingLiquidity && currentView === 'default' && "animate-pulse"
                    )}
                  >
                    Collect Fees
                  </Button>
                </div>
              </div>
            </div>

            {/* Charts Section - Only show in default view */}
            {currentView === 'default' && (
              <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-2">
                <div style={{ height: '220px' }} className="relative">
                  {selectedPoolId ? (
                    <PositionChartV2
                      token0={token0Symbol}
                      token1={token1Symbol}
                      denominationBase={calculatedDenominationBase}
                      currentPrice={currentPriceActual ?? undefined}
                      currentPoolTick={currentPoolTick ?? undefined}
                      minPrice={minPriceActual}
                      maxPrice={maxPriceActual}
                      isInRange={isInRange}
                      isFullRange={isFullRange}
                      selectedPoolId={selectedPoolId}
                      chartKey={chartKey}
                    />
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center gap-2">
                      <Image
                        src="/LogoIconWhite.svg"
                        alt="Loading chart"
                        width={32}
                        height={32}
                        className="animate-pulse opacity-75"
                      />
                      <span className="text-xs text-muted-foreground">
                        Pool ID not provided
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Position and Fees Sections - Layout changes based on view */}
            {currentView === 'default' ? (
              /* Default view: side-by-side grid */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Position Section */}
                <div className="bg-container-secondary border border-sidebar-border rounded-lg p-4 md:p-5">
                <div className="flex flex-col gap-3 md:gap-5">
                  {/* Label + Total USD */}
                  <div className="flex flex-col gap-2 relative">
                    {/* APR - only show if there are actual fees earned */}
                    {mounted && !computedIsLoadingAPR && computedFormattedAPR && computedFormattedAPR !== '–' && computedFormattedAPR !== '0%' && feesUSD > 0 && (
                      <div className="absolute top-0 right-0 border border-dashed border-sidebar-border/60 rounded-lg p-2 flex items-center gap-1 group/apr cursor-help">
                        <div className="flex flex-col items-start gap-0">
                          <div className="text-sm font-normal leading-none">
                            {computedFormattedAPR}
                          </div>
                        </div>

                        {/* Tooltip */}
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-popover border border-sidebar-border rounded-md shadow-lg opacity-0 group-hover/apr:opacity-100 pointer-events-none transition-opacity duration-200 w-48 text-xs text-popover-foreground z-[100]">
                          {computedIsAPRFallback ? (
                            <p><span className="font-bold">APR:</span> Pool-wide estimate. Actual APR calculated from position fees.</p>
                          ) : (
                            <p><span className="font-bold">APR:</span> Calculated from your position's accumulated fees.</p>
                          )}
                          {/* Tooltip arrow */}
                          <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-sidebar-border"></div>
                        </div>
                      </div>
                    )}

                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Position</div>
                    <div className="text-lg md:text-xl font-semibold">
                      {new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      }).format(
                        (previewAddAmount0 > 0 || previewAddAmount1 > 0)
                          ? (() => {
                              const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), tokenDefinitions[token0Symbol as string]?.decimals || 18));
                              const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), tokenDefinitions[token1Symbol as string]?.decimals || 18));
                              return (Number.isFinite(valueUSD) ? valueUSD : 0) +
                                ((previewAddAmount0 + fee0Amount) * getPrice(token0Symbol)) +
                                ((previewAddAmount1 + fee1Amount) * getPrice(token1Symbol));
                            })()
                          : (previewRemoveAmount0 > 0 || previewRemoveAmount1 > 0)
                          ? (Number.isFinite(valueUSD) ? valueUSD : 0) -
                            (previewRemoveAmount0 * getPrice(token0Symbol)) -
                            (previewRemoveAmount1 * getPrice(token1Symbol))
                          : (Number.isFinite(valueUSD) ? valueUSD : 0)
                      )}
                    </div>
                  </div>

                  {/* Stacked Bars */}
                  {positionBars && (
                    <div className="hidden md:flex flex-col gap-2">
                      <div className="flex h-1 rounded-full overflow-hidden gap-0.5">
                        <div
                          className="h-full"
                          style={{
                            width: `${positionBars.token0Percent}%`,
                            backgroundColor: token0Color
                          }}
                        />
                        <div
                          className="h-full"
                          style={{
                            width: `${positionBars.token1Percent}%`,
                            backgroundColor: token1Color
                          }}
                        />
                      </div>
                      {/* Legend */}
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <div className="relative w-4 h-4 rounded-full overflow-hidden">
                            <Image
                              src={getTokenLogo(token0Symbol)}
                              alt={token0Symbol}
                              width={16}
                              height={16}
                            />
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {positionBars.token0Percent.toFixed(0)}%
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="relative w-4 h-4 rounded-full overflow-hidden">
                            <Image
                              src={getTokenLogo(token1Symbol)}
                              alt={token1Symbol}
                              width={16}
                              height={16}
                            />
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {positionBars.token1Percent.toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Token Amounts */}
                  <div className="flex flex-col gap-3 md:gap-4">
                    {/* Token 0 Row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative w-6 h-6 rounded-full overflow-hidden">
                          <Image
                            src={getTokenLogo(token0Symbol)}
                            alt={token0Symbol}
                            width={24}
                            height={24}
                          />
                        </div>
                        <span className="text-sm font-medium">
                          {new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: 'USD',
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          }).format(
                            previewAddAmount0 > 0
                              ? (() => {
                                  const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), tokenDefinitions[token0Symbol as string]?.decimals || 18));
                                  return token0USD + ((previewAddAmount0 + fee0Amount) * getPrice(token0Symbol));
                                })()
                              : previewRemoveAmount0 > 0
                              ? token0USD - (previewRemoveAmount0 * getPrice(token0Symbol))
                              : token0USD
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {previewAddAmount0 > 0 ? (
                          <>
                            <span>{formatTokenDisplayAmount(token0Amount)}</span>
                            <span className="text-green-500">+</span>
                            <span className="text-green-500 font-medium">
                              {(() => {
                                const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), tokenDefinitions[token0Symbol as string]?.decimals || 18));
                                const total = previewAddAmount0 + fee0Amount;
                                return total > 0 && total < 0.0001 ? '< 0.0001' : total.toFixed(4);
                              })()}
                            </span>
                            <span>{token0Symbol}</span>
                          </>
                        ) : previewRemoveAmount0 > 0 ? (
                          <>
                            <span>{formatTokenDisplayAmount(token0Amount)}</span>
                            <span className="text-red-500">-</span>
                            <span className="text-red-500 font-medium">
                              {previewRemoveAmount0 > 0 && previewRemoveAmount0 < 0.0001 ? '< 0.0001' : previewRemoveAmount0.toFixed(4)}
                            </span>
                            <span>{token0Symbol}</span>
                          </>
                        ) : (
                          <span>{formatTokenDisplayAmount(token0Amount)} {token0Symbol}</span>
                        )}
                      </div>
                    </div>

                    {/* Token 1 Row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative w-6 h-6 rounded-full overflow-hidden">
                          <Image
                            src={getTokenLogo(token1Symbol)}
                            alt={token1Symbol}
                            width={24}
                            height={24}
                          />
                        </div>
                        <span className="text-sm font-medium">
                          {new Intl.NumberFormat('en-US', {
                            style: 'currency',
                            currency: 'USD',
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          }).format(
                            previewAddAmount1 > 0
                              ? (() => {
                                  const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), tokenDefinitions[token1Symbol as string]?.decimals || 18));
                                  return token1USD + ((previewAddAmount1 + fee1Amount) * getPrice(token1Symbol));
                                })()
                              : previewRemoveAmount1 > 0
                              ? token1USD - (previewRemoveAmount1 * getPrice(token1Symbol))
                              : token1USD
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {previewAddAmount1 > 0 ? (
                          <>
                            <span>{formatTokenDisplayAmount(token1Amount)}</span>
                            <span className="text-green-500">+</span>
                            <span className="text-green-500 font-medium">
                              {(() => {
                                const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), tokenDefinitions[token1Symbol as string]?.decimals || 18));
                                const total = previewAddAmount1 + fee1Amount;
                                return total > 0 && total < 0.0001 ? '< 0.0001' : total.toFixed(4);
                              })()}
                            </span>
                            <span>{token1Symbol}</span>
                          </>
                        ) : previewRemoveAmount1 > 0 ? (
                          <>
                            <span>{formatTokenDisplayAmount(token1Amount)}</span>
                            <span className="text-red-500">-</span>
                            <span className="text-red-500 font-medium">
                              {previewRemoveAmount1 > 0 && previewRemoveAmount1 < 0.0001 ? '< 0.0001' : previewRemoveAmount1.toFixed(4)}
                            </span>
                            <span>{token1Symbol}</span>
                          </>
                        ) : (
                          <span>{formatTokenDisplayAmount(token1Amount)} {token1Symbol}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                </div>

                {/* Fees Earned Section */}
                <div className="bg-container-secondary border border-dashed border-sidebar-border rounded-lg p-4 md:p-5 relative">
                <div className="flex flex-col gap-3 md:gap-5">
                  {/* Badge - Top Right */}
                  {isAddingLiquidity && !hasZeroFees && (
                    <div className="absolute top-5 right-5 group">
                      {hasUncollectedFees() ? (
                        <>
                          <div className="flex items-center justify-center w-6 h-6 rounded bg-red-500/20 text-red-500">
                            <IconMinus className="h-3.5 w-3.5" />
                          </div>
                          <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                            Fees collected first
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex items-center justify-center w-6 h-6 rounded bg-green-500/20 text-green-500">
                            <CornerRightUp className="h-3.5 w-3.5" strokeWidth={2.5} />
                          </div>
                          <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                            Fees are compounded
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {isRemovingLiquidity && !hasZeroFees && (
                    <div className="absolute top-5 right-5 group">
                      <div className="flex items-center justify-center w-6 h-6 rounded bg-red-500/20 text-red-500">
                        <IconMinus className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </div>
                      <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                        Fees are withdrawn
                      </div>
                    </div>
                  )}

                  {/* Label + Total Fees */}
                  <div className="flex flex-col gap-2">
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Fees Earned</div>
                    <div className={cn("text-lg md:text-xl font-semibold",
                      isAddingLiquidity && !hasZeroFees && !hasUncollectedFees() && "text-green-500",
                      isAddingLiquidity && !hasZeroFees && hasUncollectedFees() && "text-red-500",
                      isRemovingLiquidity && !hasZeroFees && "text-red-500"
                    )}>
                      {new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      }).format(displayFeesUSD)}
                    </div>
                  </div>

                  {/* Stacked Bars for Fees */}
                  {feesBars && (
                    <div className="hidden md:flex flex-col gap-2">
                      <div className="flex h-1 rounded-full overflow-hidden gap-0.5">
                        <div
                          className="h-full"
                          style={{
                            width: `${feesBars.fee0Percent}%`,
                            backgroundColor: token0Color
                          }}
                        />
                        <div
                          className="h-full"
                          style={{
                            width: `${feesBars.fee1Percent}%`,
                            backgroundColor: token1Color
                          }}
                        />
                      </div>
                      {/* Legend */}
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <div className="relative w-4 h-4 rounded-full overflow-hidden">
                            <Image
                              src={getTokenLogo(token0Symbol)}
                              alt={token0Symbol}
                              width={16}
                              height={16}
                            />
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {feesBars.fee0Percent.toFixed(0)}%
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="relative w-4 h-4 rounded-full overflow-hidden">
                            <Image
                              src={getTokenLogo(token1Symbol)}
                              alt={token1Symbol}
                              width={16}
                              height={16}
                            />
                          </div>
                          <span className="text-[11px] text-muted-foreground">
                            {feesBars.fee1Percent.toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Fee Amounts */}
                  {!hasZeroFees ? (
                    <div className="flex flex-col gap-4">
                      {/* Fee 0 Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="relative w-6 h-6 rounded-full overflow-hidden">
                            <Image
                              src={getTokenLogo(token0Symbol)}
                              alt={token0Symbol}
                              width={24}
                              height={24}
                            />
                          </div>
                          <span className="text-sm font-medium">
                            {new Intl.NumberFormat('en-US', {
                              style: 'currency',
                              currency: 'USD',
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            }).format(displayFee0USD)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {displayFeeAmount0} {token0Symbol}
                        </div>
                      </div>

                      {/* Fee 1 Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="relative w-6 h-6 rounded-full overflow-hidden">
                            <Image
                              src={getTokenLogo(token1Symbol)}
                              alt={token1Symbol}
                              width={24}
                              height={24}
                            />
                          </div>
                          <span className="text-sm font-medium">
                            {new Intl.NumberFormat('en-US', {
                              style: 'currency',
                              currency: 'USD',
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            }).format(displayFee1USD)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {displayFeeAmount1} {token1Symbol}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      No fees earned yet
                    </div>
                  )}
                </div>
                </div>
              </div>
            ) : (
              /* Action views: stacked left + form right */
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Left Column - Position and Fees stacked */}
                <div className="hidden md:flex flex-col gap-4">
                  {/* Position Section */}
                  <div className="bg-container-secondary border border-sidebar-border rounded-lg p-4 md:p-5">
                  <div className="flex flex-col gap-3 md:gap-5">
                    {/* Label + Total USD */}
                    <div className="flex flex-col gap-2">
                      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Position</div>
                      <div className="text-lg md:text-xl font-semibold">
                        {new Intl.NumberFormat('en-US', {
                          style: 'currency',
                          currency: 'USD',
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        }).format(
                          (previewAddAmount0 > 0 || previewAddAmount1 > 0)
                            ? (() => {
                                const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), tokenDefinitions[token0Symbol as string]?.decimals || 18));
                                const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), tokenDefinitions[token1Symbol as string]?.decimals || 18));
                                return (Number.isFinite(valueUSD) ? valueUSD : 0) +
                                  ((previewAddAmount0 + fee0Amount) * getPrice(token0Symbol)) +
                                  ((previewAddAmount1 + fee1Amount) * getPrice(token1Symbol));
                              })()
                            : (previewRemoveAmount0 > 0 || previewRemoveAmount1 > 0)
                            ? (Number.isFinite(valueUSD) ? valueUSD : 0) -
                              (previewRemoveAmount0 * getPrice(token0Symbol)) -
                              (previewRemoveAmount1 * getPrice(token1Symbol))
                            : (Number.isFinite(valueUSD) ? valueUSD : 0)
                        )}
                      </div>
                    </div>

                    {/* Stacked Bars */}
                    {positionBars && (
                      <div className="hidden md:flex flex-col gap-2">
                        <div className="flex h-1 rounded-full overflow-hidden gap-0.5">
                          <div
                            className="h-full"
                            style={{
                              width: `${positionBars.token0Percent}%`,
                              backgroundColor: token0Color
                            }}
                          />
                          <div
                            className="h-full"
                            style={{
                              width: `${positionBars.token1Percent}%`,
                              backgroundColor: token1Color
                            }}
                          />
                        </div>
                        {/* Legend */}
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <div className="relative w-4 h-4 rounded-full overflow-hidden">
                              <Image
                                src={getTokenLogo(token0Symbol)}
                                alt={token0Symbol}
                                width={16}
                                height={16}
                              />
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              {positionBars.token0Percent.toFixed(0)}%
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="relative w-4 h-4 rounded-full overflow-hidden">
                              <Image
                                src={getTokenLogo(token1Symbol)}
                                alt={token1Symbol}
                                width={16}
                                height={16}
                              />
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              {positionBars.token1Percent.toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Token Amounts */}
                    <div className="flex flex-col gap-3 md:gap-4">
                      {/* Token 0 Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="relative w-6 h-6 rounded-full overflow-hidden">
                            <Image
                              src={getTokenLogo(token0Symbol)}
                              alt={token0Symbol}
                              width={24}
                              height={24}
                            />
                          </div>
                          <span className="text-sm font-medium">
                            {new Intl.NumberFormat('en-US', {
                              style: 'currency',
                              currency: 'USD',
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            }).format(
                              previewAddAmount0 > 0
                                ? (() => {
                                    const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), tokenDefinitions[token0Symbol as string]?.decimals || 18));
                                    return token0USD + ((previewAddAmount0 + fee0Amount) * getPrice(token0Symbol));
                                  })()
                                : previewRemoveAmount0 > 0
                                ? token0USD - (previewRemoveAmount0 * getPrice(token0Symbol))
                                : token0USD
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {previewAddAmount0 > 0 ? (
                            <>
                              <span>{formatTokenDisplayAmount(token0Amount)}</span>
                              <span className="text-green-500">+</span>
                              <span className="text-green-500 font-medium">
                                {(() => {
                                  const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), tokenDefinitions[token0Symbol as string]?.decimals || 18));
                                  const total = previewAddAmount0 + fee0Amount;
                                  return total > 0 && total < 0.0001 ? '< 0.0001' : total.toFixed(4);
                                })()}
                              </span>
                              <span>{token0Symbol}</span>
                            </>
                          ) : previewRemoveAmount0 > 0 ? (
                            <>
                              <span>{formatTokenDisplayAmount(token0Amount)}</span>
                              <span className="text-red-500">-</span>
                              <span className="text-red-500 font-medium">
                                {previewRemoveAmount0 > 0 && previewRemoveAmount0 < 0.0001 ? '< 0.0001' : previewRemoveAmount0.toFixed(4)}
                              </span>
                              <span>{token0Symbol}</span>
                            </>
                          ) : (
                            <span>{formatTokenDisplayAmount(token0Amount)} {token0Symbol}</span>
                          )}
                        </div>
                      </div>

                      {/* Token 1 Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="relative w-6 h-6 rounded-full overflow-hidden">
                            <Image
                              src={getTokenLogo(token1Symbol)}
                              alt={token1Symbol}
                              width={24}
                              height={24}
                            />
                          </div>
                          <span className="text-sm font-medium">
                            {new Intl.NumberFormat('en-US', {
                              style: 'currency',
                              currency: 'USD',
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            }).format(
                              previewAddAmount1 > 0
                                ? (() => {
                                    const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), tokenDefinitions[token1Symbol as string]?.decimals || 18));
                                    return token1USD + ((previewAddAmount1 + fee1Amount) * getPrice(token1Symbol));
                                  })()
                                : previewRemoveAmount1 > 0
                                ? token1USD - (previewRemoveAmount1 * getPrice(token1Symbol))
                                : token1USD
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {previewAddAmount1 > 0 ? (
                            <>
                              <span>{formatTokenDisplayAmount(token1Amount)}</span>
                              <span className="text-green-500">+</span>
                              <span className="text-green-500 font-medium">
                                {(() => {
                                  const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), tokenDefinitions[token1Symbol as string]?.decimals || 18));
                                  const total = previewAddAmount1 + fee1Amount;
                                  return total > 0 && total < 0.0001 ? '< 0.0001' : total.toFixed(4);
                                })()}
                              </span>
                              <span>{token1Symbol}</span>
                            </>
                          ) : previewRemoveAmount1 > 0 ? (
                            <>
                              <span>{formatTokenDisplayAmount(token1Amount)}</span>
                              <span className="text-red-500">-</span>
                              <span className="text-red-500 font-medium">
                                {previewRemoveAmount1 > 0 && previewRemoveAmount1 < 0.0001 ? '< 0.0001' : previewRemoveAmount1.toFixed(4)}
                              </span>
                              <span>{token1Symbol}</span>
                            </>
                          ) : (
                            <span>{formatTokenDisplayAmount(token1Amount)} {token1Symbol}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  </div>

                  {/* Fees Earned Section */}
                  <div className="bg-container-secondary border border-dashed border-sidebar-border rounded-lg p-4 md:p-5 relative">
                  <div className="flex flex-col gap-3 md:gap-5">
                    {/* Badge - Top Right */}
                    {isAddingLiquidity && !hasZeroFees && (
                      <div className="absolute top-5 right-5 group">
                        {hasUncollectedFees() ? (
                          <>
                            <div className="flex items-center justify-center w-6 h-6 rounded bg-red-500/20 text-red-500">
                              <IconMinus className="h-3.5 w-3.5" />
                            </div>
                            <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                              Fees collected first
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center justify-center w-6 h-6 rounded bg-green-500/20 text-green-500">
                              <CornerRightUp className="h-3.5 w-3.5" strokeWidth={2.5} />
                            </div>
                            <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                              Fees are compounded
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {isRemovingLiquidity && !hasZeroFees && (
                      <div className="absolute top-5 right-5 group">
                        <div className="flex items-center justify-center w-6 h-6 rounded bg-red-500/20 text-red-500">
                          <IconMinus className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </div>
                        <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                          Fees are withdrawn
                        </div>
                      </div>
                    )}

                    {/* Label + Total Fees */}
                    <div className="flex flex-col gap-2">
                      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Fees Earned</div>
                    <div className={cn("text-lg md:text-xl font-semibold",
                        isAddingLiquidity && !hasZeroFees && !hasUncollectedFees() && "text-green-500",
                        isAddingLiquidity && !hasZeroFees && hasUncollectedFees() && "text-red-500",
                        isRemovingLiquidity && !hasZeroFees && "text-red-500"
                      )}>
                        {new Intl.NumberFormat('en-US', {
                          style: 'currency',
                          currency: 'USD',
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        }).format(displayFeesUSD)}
                      </div>
                    </div>

                    {/* Stacked Bars for Fees */}
                    {feesBars && (
                      <div className="hidden md:flex flex-col gap-2">
                        <div className="flex h-1 rounded-full overflow-hidden gap-0.5">
                          <div
                            className="h-full"
                            style={{
                              width: `${feesBars.fee0Percent}%`,
                              backgroundColor: token0Color
                            }}
                          />
                          <div
                            className="h-full"
                            style={{
                              width: `${feesBars.fee1Percent}%`,
                              backgroundColor: token1Color
                            }}
                          />
                        </div>
                        {/* Legend */}
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1.5">
                            <div className="relative w-4 h-4 rounded-full overflow-hidden">
                              <Image
                                src={getTokenLogo(token0Symbol)}
                                alt={token0Symbol}
                                width={16}
                                height={16}
                              />
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              {feesBars.fee0Percent.toFixed(0)}%
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <div className="relative w-4 h-4 rounded-full overflow-hidden">
                              <Image
                                src={getTokenLogo(token1Symbol)}
                                alt={token1Symbol}
                                width={16}
                                height={16}
                              />
                            </div>
                            <span className="text-[11px] text-muted-foreground">
                              {feesBars.fee1Percent.toFixed(0)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Fee Amounts */}
                    {!hasZeroFees ? (
                      <div className="flex flex-col gap-4">
                        {/* Fee 0 Row */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="relative w-6 h-6 rounded-full overflow-hidden">
                              <Image
                                src={getTokenLogo(token0Symbol)}
                                alt={token0Symbol}
                                width={24}
                                height={24}
                              />
                            </div>
                            <span className="text-sm font-medium">
                              {new Intl.NumberFormat('en-US', {
                                style: 'currency',
                                currency: 'USD',
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                              }).format(displayFee0USD)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {displayFeeAmount0} {token0Symbol}
                          </div>
                        </div>

                        {/* Fee 1 Row */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="relative w-6 h-6 rounded-full overflow-hidden">
                              <Image
                                src={getTokenLogo(token1Symbol)}
                                alt={token1Symbol}
                                width={24}
                                height={24}
                              />
                            </div>
                            <span className="text-sm font-medium">
                              {new Intl.NumberFormat('en-US', {
                                style: 'currency',
                                currency: 'USD',
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                              }).format(displayFee1USD)}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {displayFeeAmount1} {token1Symbol}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        No fees earned yet
                      </div>
                    )}
                  </div>
                  </div>
                </div>

              {/* Form Panel - Right side in action views */}
              <div className="bg-container-secondary border border-sidebar-border rounded-lg p-4 md:p-5 self-start">
                  {/* Keep FormPanel mounted but hidden to preserve state */}
                  <div className={showInterimConfirmation ? "hidden" : ""}>
                    {/* Back Button */}
                    <button
                      onClick={handleBackToDefault}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-4"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Back
                    </button>

                    {/* Form Content Based on View */}
                    {currentView === 'add-liquidity' && (
                      <>
                        {/* Use FormPanel for UI but intercept amounts for our state */}
                        <AddLiquidityFormPanel
                          key="add-liquidity-form"
                          position={position as any}
                          feesForIncrease={{ amount0: prefetchedRaw0 || '0', amount1: prefetchedRaw1 || '0' }}
                          onSuccess={handleAddLiquiditySuccess}
                          currentPoolTick={currentPoolTick}
                          onAmountsChange={(amt0, amt1) => {
                            // Sync FormPanel amounts to our modal state
                            setIncreaseAmount0(amt0.toString());
                            setIncreaseAmount1(amt1.toString());
                            // Also update preview
                            handleAddAmountsChange(amt0, amt1);
                          }}
                          hideContinueButton={true}
                          externalIsSuccess={isIncreaseSuccess}
                          externalTxHash={increaseTxHash}
                        />

                        {/* Our custom Continue button - hide when transaction succeeds */}
                        {!isIncreaseSuccess && (
                          <Button
                            onClick={() => {
                              const amount0Num = parseFloat(increaseAmount0 || "0");
                              const amount1Num = parseFloat(increaseAmount1 || "0");

                              if (amount0Num <= 0 && amount1Num <= 0) {
                                toast.error('Missing Amount', {
                                  icon: React.createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
                                  description: 'Please enter at least one amount to add.'
                                });
                                return;
                              }

                              // Check for uncollected fees on OOR positions
                              if (hasUncollectedFees()) {
                                toast.error('Collect Fees', {
                                  icon: React.createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
                                  description: 'Please collect your fees before adding liquidity.'
                                });
                                return;
                              }

                              setShowInterimConfirmation(true);
                            }}
                            disabled={
                              (parseFloat(increaseAmount0 || "0") <= 0 && parseFloat(increaseAmount1 || "0") <= 0) ||
                              (parseFloat(increaseAmount0 || "0") > parseFloat(token0Balance?.formatted || "0") && parseFloat(increaseAmount0 || "0") > 0) ||
                              (parseFloat(increaseAmount1 || "0") > parseFloat(token1Balance?.formatted || "0") && parseFloat(increaseAmount1 || "0") > 0)
                            }
                            className={cn(
                              "w-full mt-4",
                              (parseFloat(increaseAmount0 || "0") <= 0 && parseFloat(increaseAmount1 || "0") <= 0) ||
                              (parseFloat(increaseAmount0 || "0") > parseFloat(token0Balance?.formatted || "0") && parseFloat(increaseAmount0 || "0") > 0) ||
                              (parseFloat(increaseAmount1 || "0") > parseFloat(token1Balance?.formatted || "0") && parseFloat(increaseAmount1 || "0") > 0) ?
                                "relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75" :
                                "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
                            )}
                            style={(parseFloat(increaseAmount0 || "0") <= 0 && parseFloat(increaseAmount1 || "0") <= 0) ||
                              (parseFloat(increaseAmount0 || "0") > parseFloat(token0Balance?.formatted || "0") && parseFloat(increaseAmount0 || "0") > 0) ||
                              (parseFloat(increaseAmount1 || "0") > parseFloat(token1Balance?.formatted || "0") && parseFloat(increaseAmount1 || "0") > 0) ?
                              { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } :
                              undefined
                            }
                          >
                            <span className={isIncreasingLiquidity ? "animate-pulse" : ""}>
                              Continue
                            </span>
                          </Button>
                        )}
                      </>
                    )}

                    {currentView === 'remove-liquidity' && (
                      <>
                        <RemoveLiquidityFormPanel
                          position={position as any}
                          feesForWithdraw={{ amount0: prefetchedRaw0 || '0', amount1: prefetchedRaw1 || '0' }}
                          onSuccess={handleRemoveLiquiditySuccess}
                          onLiquidityDecreased={onLiquidityDecreasedProp}
                          onAmountsChange={(amt0, amt1) => {
                            // Sync FormPanel amounts to our modal state for preview
                            setWithdrawAmount0(amt0.toString());
                            setWithdrawAmount1(amt1.toString());
                            // Update preview
                            handleRemoveAmountsChange(amt0, amt1);
                          }}
                          hideContinueButton={true}
                          externalIsSuccess={isDecreaseSuccess}
                          externalTxHash={decreaseTxHash}
                        />

                        {/* Modal's Continue button - hide when transaction succeeds */}
                        {!isDecreaseSuccess && (
                          <Button
                            onClick={handleConfirmWithdraw}
                            disabled={
                              isDecreasingLiquidity ||
                              (!withdrawAmount0 && !withdrawAmount1) ||
                              (parseFloat(withdrawAmount0 || '0') <= 0 && parseFloat(withdrawAmount1 || '0') <= 0) ||
                              (parseFloat(withdrawAmount0 || "0") > parseFloat(token0Amount || "0") && parseFloat(withdrawAmount0 || "0") > 0) ||
                              (parseFloat(withdrawAmount1 || "0") > parseFloat(token1Amount || "0") && parseFloat(withdrawAmount1 || "0") > 0)
                            }
                            className={cn(
                              "w-full mt-4",
                              (parseFloat(withdrawAmount0 || "0") <= 0 && parseFloat(withdrawAmount1 || "0") <= 0) ||
                              (parseFloat(withdrawAmount0 || "0") > parseFloat(token0Amount || "0") && parseFloat(withdrawAmount0 || "0") > 0) ||
                              (parseFloat(withdrawAmount1 || "0") > parseFloat(token1Amount || "0") && parseFloat(withdrawAmount1 || "0") > 0) ?
                                "relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75" :
                                "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
                            )}
                            style={(parseFloat(withdrawAmount0 || "0") <= 0 && parseFloat(withdrawAmount1 || "0") <= 0) ||
                              (parseFloat(withdrawAmount0 || "0") > parseFloat(token0Amount || "0") && parseFloat(withdrawAmount0 || "0") > 0) ||
                              (parseFloat(withdrawAmount1 || "0") > parseFloat(token1Amount || "0") && parseFloat(withdrawAmount1 || "0") > 0) ?
                              { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } :
                              undefined
                            }
                          >
                            <span className={isDecreasingLiquidity ? "animate-pulse" : ""}>
                              Continue
                            </span>
                          </Button>
                        )}
                      </>
                    )}


                  </div>

                  {showInterimConfirmation && (
                    <>
                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <ChevronLeft
                            className="h-4 w-4 text-muted-foreground cursor-pointer hover:text-white transition-colors"
                            onClick={() => setShowInterimConfirmation(false)}
                          />
                          <span className="text-sm font-medium">
                            {currentView === 'add-liquidity' && 'You Will Add'}
                            {currentView === 'remove-liquidity' && 'You Will Receive'}
                          </span>
                        </div>

                        {/* Main amounts section with large icons */}
                        <div className="rounded-lg bg-container p-4 border border-sidebar-border/60">
                          <div className="space-y-4">
                            {/* Token 0 */}
                            <div className="flex justify-between items-start">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <div className="text-xl font-medium">
                                    {(() => {
                                      const baseAmount = previewAddAmount0 || previewRemoveAmount0 || 0;
                                      const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), tokenDefinitions[token0Symbol as string]?.decimals || 18));
                                      const displayAmount = baseAmount + fee0Amount;
                                      return formatTokenDisplayAmount(displayAmount.toString());
                                    })()}
                                  </div>
                                  <span className="text-sm text-muted-foreground">{token0Symbol}</span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {(() => {
                                    const baseAmount = previewAddAmount0 || previewRemoveAmount0 || 0;
                                    const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), tokenDefinitions[token0Symbol as string]?.decimals || 18));
                                    const displayAmount = baseAmount + fee0Amount;
                                    return formatUSD(displayAmount * getPrice(token0Symbol));
                                  })()}
                                </div>
                              </div>
                              <Image
                                src={getTokenLogo(token0Symbol)}
                                alt={token0Symbol}
                                width={40}
                                height={40}
                                className="rounded-full"
                              />
                            </div>

                            {/* Token 1 */}
                            <div className="flex justify-between items-start">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <div className="text-xl font-medium">
                                    {(() => {
                                      const baseAmount = previewAddAmount1 || previewRemoveAmount1 || 0;
                                      const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), tokenDefinitions[token1Symbol as string]?.decimals || 18));
                                      const displayAmount = baseAmount + fee1Amount;
                                      return formatTokenDisplayAmount(displayAmount.toString());
                                    })()}
                                  </div>
                                  <span className="text-sm text-muted-foreground">{token1Symbol}</span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {(() => {
                                    const baseAmount = previewAddAmount1 || previewRemoveAmount1 || 0;
                                    const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), tokenDefinitions[token1Symbol as string]?.decimals || 18));
                                    const displayAmount = baseAmount + fee1Amount;
                                    return formatUSD(displayAmount * getPrice(token1Symbol));
                                  })()}
                                </div>
                              </div>
                              <Image
                                src={getTokenLogo(token1Symbol)}
                                alt={token1Symbol}
                                width={40}
                                height={40}
                                className="rounded-full"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Includes uncollected fees section - Only show for Add/Remove when fees exist */}
                        {(currentView === 'add-liquidity' || currentView === 'remove-liquidity') && (() => {
                          const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), tokenDefinitions[token0Symbol as string]?.decimals || 18));
                          const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), tokenDefinitions[token1Symbol as string]?.decimals || 18));

                          if (fee0Amount <= 0 && fee1Amount <= 0) return null;

                          return (
                            <div className="p-3 border border-dashed rounded-md bg-muted/10 space-y-2">
                              <div className="text-xs font-medium text-muted-foreground mb-2">Includes uncollected fees:</div>

                              <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                  <Image src={getTokenLogo(token0Symbol)} alt={token0Symbol} width={16} height={16} className="rounded-full" />
                                  <span className="text-xs text-muted-foreground">{token0Symbol} Fees</span>
                                </div>
                                <div className="text-right">
                                  <div className="text-xs font-medium">
                                    {fee0Amount === 0 ? '0' : fee0Amount > 0 && fee0Amount < 0.0001 ? '< 0.0001' : fee0Amount.toFixed(6).replace(/\.?0+$/, '')}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatUSD(fee0Amount * getPrice(token0Symbol))}
                                  </div>
                                </div>
                              </div>

                              <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                  <Image src={getTokenLogo(token1Symbol)} alt={token1Symbol} width={16} height={16} className="rounded-full" />
                                  <span className="text-xs text-muted-foreground">{token1Symbol} Fees</span>
                                </div>
                                <div className="text-right">
                                  <div className="text-xs font-medium">
                                    {fee1Amount === 0 ? '0' : fee1Amount > 0 && fee1Amount < 0.0001 ? '< 0.0001' : fee1Amount.toFixed(6).replace(/\.?0+$/, '')}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatUSD(fee1Amount * getPrice(token1Symbol))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Transaction Steps for Add Liquidity OR Current Price for other views */}
                        {showTransactionOverview && currentView === 'add-liquidity' ? (
                          <TransactionFlowPanel
                            isActive={showTransactionOverview}
                            approvalData={increaseApprovalData}
                            isCheckingApprovals={isCheckingIncreaseApprovals}
                            token0Symbol={token0Symbol as TokenSymbol}
                            token1Symbol={token1Symbol as TokenSymbol}
                            isDepositSuccess={isIncreaseSuccess}
                            onApproveToken={handleIncreaseApproveV2}
                            onExecute={handleIncreaseDeposit}
                            onRefetchApprovals={refetchIncreaseApprovals}
                            onBack={() => {
                              setShowTransactionOverview(false);
                              setTxStarted(false);
                            }}
                            onReset={() => {
                              resetIncrease();
                            }}
                            executeButtonLabel="Add Liquidity"
                            showBackButton={false}
                            autoProgressOnApproval={false}
                          />
                        ) : currentView === 'remove-liquidity' || !showTransactionOverview ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Current Price:</span>
                              <span className="text-xs text-muted-foreground">
                                {(() => {
                                  const price0 = getPrice(token0Symbol);
                                  const price1 = getPrice(token1Symbol);
                                  if (price0 === 0 || price1 === 0) return "N/A";
                                  const ratio = price0 / price1;
                                  const decimals = ratio < 0.1 ? 3 : 2;
                                  return `1 ${token0Symbol} = ${ratio.toFixed(decimals)} ${token1Symbol}`;
                                })()}
                              </span>
                            </div>
                          </div>
                        ) : null}

                        {/* Back/Confirm buttons - Only show when NOT using TransactionFlowPanel */}
                        {!(showTransactionOverview && currentView === 'add-liquidity') && (
                          <div className="grid grid-cols-2 gap-3 pt-2">
                            <Button
                              variant="outline"
                              className="relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75"
                              onClick={() => {
                                if (showTransactionOverview) {
                                  setShowTransactionOverview(false);
                                  setTxStarted(false);
                                } else {
                                  setShowInterimConfirmation(false);
                                }
                              }}
                              disabled={
                                currentView === 'add-liquidity' ? isIncreasingLiquidity :
                                currentView === 'remove-liquidity' ? isDecreasingLiquidity :
                                false
                              }
                              style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                            >
                              Back
                            </Button>

                            <Button
                              id="modal-interim-confirm-button"
                              className={
                                currentView === 'remove-liquidity' && isDecreasingLiquidity
                                  ? "relative border border-sidebar-border bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 !opacity-100 cursor-default text-white/75"
                                  : "text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary"
                              }
                              style={currentView === 'remove-liquidity' && isDecreasingLiquidity ? { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                              onClick={() => {
                                if (currentView === 'remove-liquidity') {
                                  // Remove Liquidity: Execute directly without transaction overview
                                  handleExecuteWithdrawTransaction();
                                } else if (currentView === 'add-liquidity') {
                                  // Add Liquidity: Show transaction overview
                                  setShowTransactionOverview(true);
                                }
                              }}
                              disabled={
                                currentView === 'add-liquidity' ? (isCheckingIncreaseApprovals) :
                                currentView === 'remove-liquidity' ? (isDecreasingLiquidity || isWithdrawCalculating) :
                                false
                              }
                            >
                              <span className={
                                currentView === 'remove-liquidity' ? (isDecreasingLiquidity ? "animate-pulse" : "") : ""
                              }>
                                {currentView === 'add-liquidity' ? "Confirm" :
                                 currentView === 'remove-liquidity' ? (isWithdrawBurn ? "Close Position" : "Withdraw") :
                                 "Confirm"}
                              </span>
                            </Button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  ),
  /* ClaimFeeModal - Separate portal for fee collection */
  <ClaimFeeModal
    key="claim-fee-modal"
    isOpen={showClaimFeeModal}
    onClose={() => setShowClaimFeeModal(false)}
    position={position}
    feeAmount0={feeAmount0}
    feeAmount1={feeAmount1}
    fee0USD={fee0USD}
    fee1USD={fee1USD}
    onFeesCollected={onFeesCollected}
    onRefreshPosition={onRefreshPosition}
  />
  ];
}
