"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, RefreshCw as RefreshCwIcon, BadgeCheck, OctagonX, Info, ArrowUpRight, CornerRightUp, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { TokenStack } from "./TokenStack";
import { formatUnits, parseUnits as viemParseUnits, erc20Abi } from "viem";
import { TOKEN_DEFINITIONS, TokenSymbol, getToken, NATIVE_TOKEN_ADDRESS } from "@/lib/pools-config";
import { cn, sanitizeDecimalInput } from "@/lib/utils";
import { formatUSD } from "@/lib/format";
import Image from "next/image";
import { PositionChartV2 } from "./PositionChartV2";
import { getOptimalBaseToken } from "@/lib/denomination-utils";
import { AddLiquidityFormPanel } from "./AddLiquidityFormPanel";
import { RemoveLiquidityFormPanel } from "./RemoveLiquidityFormPanel";
import { CollectFeesFormPanel } from "./CollectFeesFormPanel";
import { useAccount, useSignTypedData, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { readContract } from '@wagmi/core';
import { config } from '@/lib/wagmiConfig';
import { useIncreaseLiquidity, type IncreasePositionData } from "./useIncreaseLiquidity";
import { providePreSignedIncreaseBatchPermit } from './useIncreaseLiquidity';
import { useDecreaseLiquidity, type DecreasePositionData } from "./useDecreaseLiquidity";
import { preparePermit2BatchForNewPosition } from '@/lib/liquidity-utils';
import { useCheckIncreaseLiquidityApprovals } from "./useCheckIncreaseLiquidityApprovals";
import { useEthersSigner } from "@/hooks/useEthersSigner";
import { toast } from "sonner";
import { motion, useAnimation } from "framer-motion";
import { getTokenSymbolByAddress } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateAfterTx } from "@/lib/invalidation";

// Define modal view types
type ModalView = 'default' | 'add-liquidity' | 'remove-liquidity' | 'collect-fees';

// Status indicator component
function StatusIndicatorCircle({ className }: { className?: string }) {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className={className}>
      <circle cx="4" cy="4" r="4" fill="currentColor" fillOpacity="0.4" />
      <circle cx="4" cy="4" r="2" fill="currentColor" />
    </svg>
  );
}

type ProcessedPosition = {
  positionId: string;
  owner: string;
  poolId: string;
  token0: {
    address: string;
    symbol: string;
    amount: string;
    usdValue?: number;
  };
  token1: {
    address: string;
    symbol: string;
    amount: string;
    usdValue?: number;
  };
  tickLower: number;
  tickUpper: number;
  isInRange: boolean;
  ageSeconds: number;
  blockTimestamp: number;
  liquidityRaw?: string;
};

interface PositionDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  position: ProcessedPosition;
  valueUSD: number;
  prefetchedRaw0?: string | null;
  prefetchedRaw1?: string | null;
  formatTokenDisplayAmount: (amount: string) => string;
  getUsdPriceForSymbol: (symbol?: string) => number;
  onRefreshPosition: () => void;
  currentPrice?: string | null;
  currentPoolTick?: number | null;
  convertTickToPrice?: (tick: number, currentPoolTick: number | null, currentPrice: string | null, baseTokenForPriceDisplay: string, token0Symbol: string, token1Symbol: string) => string;
  apr?: number | null;
  isLoadingAPR?: boolean;
  feeTier?: number | null;
  selectedPoolId?: string;
  chainId?: number;
  currentPoolSqrtPriceX96?: string | null;
  sdkMinTick?: number;
  sdkMaxTick?: number;
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
  prefetchedRaw0,
  prefetchedRaw1,
  formatTokenDisplayAmount,
  getUsdPriceForSymbol,
  onRefreshPosition,
  feeTier,
  selectedPoolId,
  chainId,
  currentPrice,
  currentPoolTick,
  currentPoolSqrtPriceX96,
  sdkMinTick = -887272,
  sdkMaxTick = 887272,
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
}: PositionDetailsModalProps) {
  const [mounted, setMounted] = useState(false);
  const [chartKey, setChartKey] = useState(0);
  const [currentView, setCurrentView] = useState<ModalView>('default');

  // Preview state for showing impact of actions
  const [previewAddAmount0, setPreviewAddAmount0] = useState<number>(0);
  const [previewAddAmount1, setPreviewAddAmount1] = useState<number>(0);
  const [previewRemoveAmount0, setPreviewRemoveAmount0] = useState<number>(0);
  const [previewRemoveAmount1, setPreviewRemoveAmount1] = useState<number>(0);
  const [previewCollectFee0, setPreviewCollectFee0] = useState<number>(0);
  const [previewCollectFee1, setPreviewCollectFee1] = useState<number>(0);

  // Interim confirmation views (like the standalone modals)
  const [showInterimConfirmation, setShowInterimConfirmation] = useState(false);
  const [showTransactionOverview, setShowTransactionOverview] = useState(false);

  // Add Liquidity transaction state
  const [increaseAmount0, setIncreaseAmount0] = useState<string>("");
  const [increaseAmount1, setIncreaseAmount1] = useState<string>("");
  const [increaseStep, setIncreaseStep] = useState<'input' | 'approve' | 'permit' | 'deposit'>('input');
  const [increasePreparedTxData, setIncreasePreparedTxData] = useState<any>(null);
  const [increaseNeedsERC20Approvals, setIncreaseNeedsERC20Approvals] = useState<TokenSymbol[]>([]);
  const [increaseIsWorking, setIncreaseIsWorking] = useState(false);
  const [increaseBatchPermitSigned, setIncreaseBatchPermitSigned] = useState(false);
  const [signedBatchPermit, setSignedBatchPermit] = useState<null | { owner: `0x${string}`; permitBatch: any; signature: string }>(null);
  const [increaseCompletedERC20ApprovalsCount, setIncreaseCompletedERC20ApprovalsCount] = useState(0);
  const [increaseInvolvedTokensCount, setIncreaseInvolvedTokensCount] = useState(0);
  const [increaseAlreadyApprovedCount, setIncreaseAlreadyApprovedCount] = useState(0);
  const [approvalWiggleCount, setApprovalWiggleCount] = useState(0);

  // Hooks for transaction
  const { address: accountAddress, chainId: walletChainId } = useAccount();
  const queryClient = useQueryClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { data: incApproveHash, writeContractAsync: approveERC20Async, reset: resetIncreaseApprove } = useWriteContract();
  const { isLoading: isIncreaseApproving, isSuccess: isIncreaseApproved } = useWaitForTransactionReceipt({ hash: incApproveHash });
  const approvalWiggleControls = useAnimation();

  // Get ethers signer for permit signing (matching AddLiquidityForm)
  const signer = useEthersSigner();

  // State for permit signature (matching AddLiquidityForm)
  const [currentTransactionStep, setCurrentTransactionStep] = useState<'idle' | 'approving_token0' | 'approving_token1' | 'signing_permit' | 'depositing'>('idle');
  const [permitSignature, setPermitSignature] = useState<string>();

  // Check approvals for increase liquidity (matching AddLiquidityForm pattern)
  const {
    data: increaseApprovalData,
    isLoading: isCheckingIncreaseApprovals,
    refetch: refetchIncreaseApprovals,
  } = useCheckIncreaseLiquidityApprovals(
    accountAddress && walletChainId && position?.positionId
      ? {
          userAddress: accountAddress,
          tokenId: BigInt(position.positionId),
          token0Symbol: position.token0.symbol as TokenSymbol,
          token1Symbol: position.token1.symbol as TokenSymbol,
          amount0: increaseAmount0,
          amount1: increaseAmount1,
          fee0: prefetchedRaw0 || undefined,
          fee1: prefetchedRaw1 || undefined,
          chainId: walletChainId,
        }
      : undefined,
    {
      enabled: Boolean(accountAddress && walletChainId && position?.positionId && (parseFloat(increaseAmount0 || '0') > 0 || parseFloat(increaseAmount1 || '0') > 0)),
      staleTime: 5000,
    }
  );

  const {
    increaseLiquidity,
    isLoading: isIncreasingLiquidity,
    isSuccess: isIncreaseSuccess,
    hash: increaseTxHash,
    reset: resetIncrease
  } = useIncreaseLiquidity({
    onLiquidityIncreased: () => setShowInterimConfirmation(false),
  });

  const [withdrawAmount0, setWithdrawAmount0] = useState<string>("");
  const [withdrawAmount1, setWithdrawAmount1] = useState<string>("");
  const [withdrawActiveInputSide, setWithdrawActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isWithdrawCalculating, setIsWithdrawCalculating] = useState(false);
  const [txStarted, setTxStarted] = useState(false);
  const [wasDecreasingLiquidity, setWasDecreasingLiquidity] = useState(false);
  const [currentSessionTxHash, setCurrentSessionTxHash] = useState<string | null>(null);

  // useDecreaseLiquidity hook - mirrors useIncreaseLiquidity pattern
  const {
    decreaseLiquidity,
    isLoading: isDecreasingLiquidity,
    isSuccess: isDecreaseSuccess,
    hash: decreaseTxHash,
    reset: resetDecrease
  } = useDecreaseLiquidity({
    onLiquidityDecreased: () => setShowInterimConfirmation(false),
  });

  // Check what ERC20 approvals are needed
  const checkIncreaseApprovals = useCallback(async (): Promise<TokenSymbol[]> => {
    if (!accountAddress || !walletChainId) return [];

    const needsApproval: TokenSymbol[] = [];
    const tokens = [
      { symbol: position.token0.symbol as TokenSymbol, amount: increaseAmount0 },
      { symbol: position.token1.symbol as TokenSymbol, amount: increaseAmount1 }
    ];

    for (const token of tokens) {
      if (!token.amount || parseFloat(token.amount) <= 0) continue;

      const tokenDef = TOKEN_DEFINITIONS[token.symbol];
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
  }, [accountAddress, walletChainId, position, increaseAmount0, increaseAmount1]);

  // Prepare increase transaction
  const handlePrepareIncrease = useCallback(async () => {
    setIncreaseIsWorking(true);
    try {
      const needsApprovals = await checkIncreaseApprovals();

      // Calculate total tokens with amounts
      const tokens = [
        { symbol: position.token0.symbol, amount: increaseAmount0 },
        { symbol: position.token1.symbol, amount: increaseAmount1 }
      ];
      const tokensWithAmounts = tokens.filter(t => t.amount && parseFloat(t.amount) > 0);
      const alreadyApproved = tokensWithAmounts.length - needsApprovals.length;

      setIncreaseNeedsERC20Approvals(needsApprovals);
      setIncreaseInvolvedTokensCount(tokensWithAmounts.length);
      setIncreaseAlreadyApprovedCount(alreadyApproved);

      if (needsApprovals.length > 0) {
        setIncreaseStep('approve');
        setIncreasePreparedTxData({
          needsApproval: true,
          approvalType: 'ERC20_TO_PERMIT2',
          approvalTokenSymbol: needsApprovals[0],
          approvalTokenAddress: TOKEN_DEFINITIONS[needsApprovals[0]]?.address,
          approvalAmount: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
          approveToAddress: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
        });
      } else {
        setIncreaseStep('permit');
        setIncreasePreparedTxData({ needsApproval: false });
      }
    } catch (error: any) {
      toast.error("Preparation Error", { description: error.message || "Failed to prepare transaction", icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }) });
    } finally {
      setIncreaseIsWorking(false);
    }
  }, [checkIncreaseApprovals, position.token0.symbol, position.token1.symbol, increaseAmount0, increaseAmount1]);

  // Handle ERC20 approvals
  const handleIncreaseApprove = useCallback(async () => {
    if (!increasePreparedTxData?.needsApproval || increasePreparedTxData.approvalType !== 'ERC20_TO_PERMIT2') return;

    setIncreaseIsWorking(true);

    try {
      const tokenAddress = increasePreparedTxData.approvalTokenAddress as `0x${string}` | undefined;
      if (!tokenAddress) throw new Error('Missing token address for approval');

      toast("Confirm in Wallet", { icon: React.createElement(Info, { className: "h-4 w-4" }) });

      await approveERC20Async({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: ["0x000000000022D473030F116dDEE9F6B43aC78BA3" as `0x${string}`, BigInt(increasePreparedTxData.approvalAmount || '0')],
      });
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to approve token.";
      toast.error("Approval Error", {
        icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
        description: errorMessage,
      });
      setIncreaseIsWorking(false);
      resetIncreaseApprove();
    }
  }, [increasePreparedTxData, approveERC20Async, resetIncreaseApprove]);

  // Handle permit signature
  const handleIncreasePermit = useCallback(async () => {
    if (!position || !accountAddress || !walletChainId) return;
    if (increaseBatchPermitSigned || increaseStep !== 'permit') return;

    setIncreaseIsWorking(true);
    try {
      const compositeId = position.positionId?.toString?.() || '';
      let tokenIdHex = compositeId.includes('-') ? compositeId.split('-').pop() || '' : compositeId;
      if (!tokenIdHex) throw new Error('Unable to derive position tokenId');

      if (!tokenIdHex.startsWith('0x')) tokenIdHex = `0x${tokenIdHex}`;
      const nftTokenId = BigInt(tokenIdHex);

      const deadline = Math.floor(Date.now() / 1000) + (20 * 60);
      const prepared = await preparePermit2BatchForNewPosition(
        position.token0.symbol,
        position.token1.symbol,
        accountAddress as `0x${string}`,
        walletChainId,
        deadline
      );

      if (!prepared?.message?.details || prepared.message.details.length === 0) {
        setIncreaseBatchPermitSigned(true);
        setIncreaseStep('deposit');
        setIncreaseIsWorking(false);
        return;
      }

      toast("Sign in Wallet", { icon: React.createElement(Info, { className: "h-4 w-4" }) });

      const signature = await signTypedDataAsync({
        domain: prepared.domain as any,
        types: prepared.types as any,
        primaryType: prepared.primaryType,
        message: prepared.message as any,
      });

      const payload = { owner: accountAddress as `0x${string}`, permitBatch: prepared.message, signature };
      // Only store permit if it has details
      if (prepared.message.details.length > 0) {
        providePreSignedIncreaseBatchPermit(position.positionId, payload);
        setSignedBatchPermit(payload);
      } else {
        setSignedBatchPermit(null);
      }

      toast.success("Batch Signature Complete", {
        icon: React.createElement(BadgeCheck, { className: "h-4 w-4 text-green-500" }),
      });

      setIncreaseBatchPermitSigned(true);
      setIncreaseStep('deposit');
    } catch (error: any) {
      const description = (error?.message || '').includes('User rejected') ? 'Permit signature was rejected.' : (error?.message || 'Failed to sign permit');
      toast.error('Permit Error', {
        icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
        description
      });
    } finally {
      setIncreaseIsWorking(false);
    }
  }, [position, accountAddress, walletChainId, signTypedDataAsync, increaseBatchPermitSigned, increaseStep, increaseAmount0, increaseAmount1]);

  // Handle ERC20 approval to Permit2 (matching AddLiquidityForm) - V2
  const handleIncreaseApproveV2 = useCallback(async (tokenSymbol: TokenSymbol) => {
    const tokenConfig = TOKEN_DEFINITIONS[tokenSymbol];
    if (!tokenConfig) throw new Error(`Token ${tokenSymbol} not found`);

    toast('Confirm in Wallet', {
      icon: React.createElement(Info, { className: 'h-4 w-4' })
    });

    await approveERC20Async({
      address: tokenConfig.address as `0x${string}`,
      abi: erc20Abi,
      functionName: 'approve',
      args: ["0x000000000022D473030F116dDEE9F6B43aC78BA3" as `0x${string}`, BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935")],
    });

    // Wait for confirmation
    // The useEffect monitoring isIncreaseApproved will handle the next steps
  }, [approveERC20Async]);

  // Sign the batch permit using ethers signer (EXACT copy from AddLiquidityForm)
  const signPermitV2 = useCallback(async () => {
    if (!increaseApprovalData?.permitBatchData || !increaseApprovalData?.signatureDetails) {
      return;
    }

    if (!signer) {
      toast.error("Wallet not connected", {
        icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
      });
      return;
    }

    try {
      toast('Sign in Wallet', {
        icon: React.createElement(Info, { className: 'h-4 w-4' })
      });

      // Use 'values' from permitBatchData for signing (the actual permit data)
      const valuesToSign = increaseApprovalData.permitBatchData.values || increaseApprovalData.permitBatchData;

      const signature = await (signer as any)._signTypedData(
        increaseApprovalData.signatureDetails.domain,
        increaseApprovalData.signatureDetails.types,
        valuesToSign
      );

      setPermitSignature(signature);

      // Show success toast
      const currentTime = Math.floor(Date.now() / 1000);
      const sigDeadline = valuesToSign?.sigDeadline || valuesToSign?.details?.[0]?.expiration || 0;
      const durationSeconds = Number(sigDeadline) - currentTime;

      let durationFormatted = "";
      if (durationSeconds >= 86400) {
        const days = Math.ceil(durationSeconds / 86400);
        durationFormatted = `${days} day${days > 1 ? 's' : ''}`;
      } else if (durationSeconds >= 3600) {
        const hours = Math.ceil(durationSeconds / 3600);
        durationFormatted = `${hours} hour${hours > 1 ? 's' : ''}`;
      } else {
        const minutes = Math.ceil(durationSeconds / 60);
        durationFormatted = `${minutes} minute${minutes > 1 ? 's' : ''}`;
      }

      toast.success('Batch Signature Complete', {
        icon: React.createElement(BadgeCheck, { className: 'h-4 w-4 text-green-500' }),
        description: `Batch permit signed successfully for ${durationFormatted}`
      });
    } catch (error: any) {
      const isUserRejection =
        error.message?.toLowerCase().includes('user rejected') ||
        error.message?.toLowerCase().includes('user denied') ||
        error.code === 4001;

      if (!isUserRejection) {
        toast.error("Signature Error", {
          icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
          description: error.message
        });
      }
      throw error;
    }
  }, [increaseApprovalData, signer]);

  // Handle final transaction execution (matching AddLiquidityForm pattern)
  const handleIncreaseTransactionV2 = async () => {
    if (!position) return;

    // Wait for approval data to load
    if (!increaseApprovalData || isCheckingIncreaseApprovals) {
      return;
    }

    // Determine next step based on current state and approval data
    if (currentTransactionStep === 'idle') {
      // Check what's needed
      if (increaseApprovalData.needsToken0ERC20Approval) {
        setCurrentTransactionStep('approving_token0');
        await handleIncreaseApproveV2(position.token0.symbol as TokenSymbol);
        setCurrentTransactionStep('idle');
        await refetchIncreaseApprovals();
        return;
      }
      if (increaseApprovalData.needsToken1ERC20Approval) {
        setCurrentTransactionStep('approving_token1');
        await handleIncreaseApproveV2(position.token1.symbol as TokenSymbol);
        setCurrentTransactionStep('idle');
        await refetchIncreaseApprovals();
        return;
      }

      // After ERC20 approvals, check if permit signature is needed
      // The hook auto-fetches permit data, but if it's still loading, wait for it
      if (!permitSignature) {
        // Wait a moment for the useEffect to populate permit data
        await new Promise(resolve => setTimeout(resolve, 100));
        await refetchIncreaseApprovals(); // Force a refresh to get latest approval state
      }

      // Now check if permit signature is needed (using permitBatchData as indicator)
      if (increaseApprovalData.permitBatchData && !permitSignature) {
        setCurrentTransactionStep('signing_permit');
        try {
          await signPermitV2();
          setCurrentTransactionStep('idle');
        } catch (error) {
          setCurrentTransactionStep('idle');
          return;
        }
        return;
      }

      // All approvals/permits done, execute deposit
      setCurrentTransactionStep('depositing');
      const data: IncreasePositionData = {
        tokenId: position.positionId,
        token0Symbol: position.token0.symbol as TokenSymbol,
        token1Symbol: position.token1.symbol as TokenSymbol,
        additionalAmount0: increaseAmount0 || '0',
        additionalAmount1: increaseAmount1 || '0',
        poolId: position.poolId,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        feesForIncrease: { amount0: prefetchedRaw0 || '0', amount1: prefetchedRaw1 || '0' },
      };

      try {
        // Pass the permit signature if we have one
        const opts = permitSignature && increaseApprovalData.permitBatchData ? {
          batchPermit: {
            owner: accountAddress as `0x${string}`,
            permitBatch: increaseApprovalData.permitBatchData.values || increaseApprovalData.permitBatchData,
            signature: permitSignature,
          }
        } : undefined;

        increaseLiquidity(data, opts);
      } catch (e) {
        console.error('[increase] transaction error:', e);
      }
      setCurrentTransactionStep('idle');
    }
  };

  // Get button text based on current step (matching AddLiquidityForm pattern)
  const getIncreaseButtonText = () => {
    if (!position) return 'Preparing...';

    if (currentTransactionStep === 'approving_token0') return `Approving ${position.token0.symbol}...`;
    if (currentTransactionStep === 'approving_token1') return `Approving ${position.token1.symbol}...`;
    if (currentTransactionStep === 'signing_permit') return 'Signing...';
    if (currentTransactionStep === 'depositing' || isIncreasingLiquidity) return 'Depositing...';

    if (!increaseApprovalData) return 'Preparing...';

    if (increaseApprovalData.needsToken0ERC20Approval) return `Approve ${position.token0.symbol}`;
    if (increaseApprovalData.needsToken1ERC20Approval) return `Approve ${position.token1.symbol}`;
    if (increaseApprovalData.permitBatchData && !permitSignature) return 'Sign Permit';

    return 'Add Liquidity';
  };

  // OLD handler - keep for backwards compatibility
  const handleExecuteTransaction = async () => {
    if (!position) return;

    if (increaseStep === 'input') {
      await handlePrepareIncrease();
    } else if (increaseStep === 'approve') {
      await handleIncreaseApprove();
    } else if (increaseStep === 'permit') {
      await handleIncreasePermit();
    } else if (increaseStep === 'deposit') {
      const data: IncreasePositionData = {
        tokenId: position.positionId,
        token0Symbol: position.token0.symbol as TokenSymbol,
        token1Symbol: position.token1.symbol as TokenSymbol,
        additionalAmount0: increaseAmount0 || '0',
        additionalAmount1: increaseAmount1 || '0',
        poolId: position.poolId,
        tickLower: position.tickLower,
        tickUpper: position.tickUpper,
        feesForIncrease: { amount0: prefetchedRaw0 || '0', amount1: prefetchedRaw1 || '0' },
      };

      try {
        // @ts-ignore
        increaseLiquidity(data, signedBatchPermit ? { batchPermit: signedBatchPermit } : undefined);
      } catch (e) {
      }
    }
  };

  // Monitor approval confirmations and update step
  useEffect(() => {
    if (!isIncreaseApproved || !increasePreparedTxData) return;

    const recheckAllowances = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 1000));

        const stillNeedsApprovals: TokenSymbol[] = [];
        const tokens = [
          { symbol: position.token0.symbol as TokenSymbol, amount: increaseAmount0 },
          { symbol: position.token1.symbol as TokenSymbol, amount: increaseAmount1 }
        ];

        for (const token of tokens) {
          if (!token.amount || parseFloat(token.amount) <= 0) continue;

          const tokenDef = TOKEN_DEFINITIONS[token.symbol];
          if (!tokenDef || !accountAddress) continue;

          try {
            const allowance = await readContract(config, {
              address: tokenDef.address as `0x${string}`,
              abi: erc20Abi,
              functionName: 'allowance',
              args: [accountAddress, "0x000000000022D473030F116dDEE9F6B43aC78BA3" as `0x${string}`],
              blockTag: 'latest'
            });

            const requiredAmount = viemParseUnits(token.amount, tokenDef.decimals);

            if (allowance < requiredAmount) {
              stillNeedsApprovals.push(token.symbol);
            }
          } catch (error) {
            stillNeedsApprovals.push(token.symbol);
          }
        }

        if (stillNeedsApprovals.length > 0) {
          if (stillNeedsApprovals.includes(increasePreparedTxData.approvalTokenSymbol as TokenSymbol)) {
            setApprovalWiggleCount(prev => prev + 1);
            toast.error("Insufficient Approval", { icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }) });
          } else {
            toast.success(`${increasePreparedTxData.approvalTokenSymbol} Approved`, { icon: React.createElement(BadgeCheck, { className: "h-4 w-4 text-green-500" }) });
          }

          setIncreaseNeedsERC20Approvals(stillNeedsApprovals);
          const nextTokenSymbol = stillNeedsApprovals[0];
          const nextTokenDef = TOKEN_DEFINITIONS[nextTokenSymbol];
          const nextTokenAmount = nextTokenSymbol === position.token0.symbol ? increaseAmount0 : increaseAmount1;
          const exactAmountNeeded = viemParseUnits(nextTokenAmount || '0', nextTokenDef.decimals);
          const buffer = BigInt(Math.pow(10, Math.max(0, nextTokenDef.decimals - 6)));
          const roundedUpAmount = exactAmountNeeded + buffer;

          setIncreasePreparedTxData({
            needsApproval: true,
            approvalType: 'ERC20_TO_PERMIT2',
            approvalTokenSymbol: nextTokenSymbol,
            approvalTokenAddress: nextTokenDef.address,
            approvalAmount: roundedUpAmount.toString(),
            approveToAddress: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
          });
          setIncreaseStep('approve');
        } else {
          toast.success(`${increasePreparedTxData.approvalTokenSymbol} Approved`, { icon: React.createElement(BadgeCheck, { className: "h-4 w-4 text-green-500" }) });
          setIncreaseNeedsERC20Approvals([]);
          setIncreasePreparedTxData({ needsApproval: false });
          setIncreaseStep('permit');
        }

        setIncreaseIsWorking(false);
        setIncreaseCompletedERC20ApprovalsCount(prev => prev + 1);
        resetIncreaseApprove();
      } catch (error) {
        toast.error("Approval Check Failed", { icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }) });
        setIncreaseIsWorking(false);
        resetIncreaseApprove();
      }
    };

    recheckAllowances();
  }, [isIncreaseApproved, increasePreparedTxData, accountAddress, position, increaseAmount0, increaseAmount1, resetIncreaseApprove]);

  // Auto-prepare transaction when showing transaction overview
  useEffect(() => {
    if (showTransactionOverview && currentView === 'add-liquidity') {
      if (increaseStep === 'input') {
        handlePrepareIncrease();
      }
    }
  }, [showTransactionOverview, currentView, increaseStep, handlePrepareIncrease]);

  // Remove Liquidity handler functions
  const handleConfirmWithdraw = useCallback(() => {
    if (!position || (!withdrawAmount0 && !withdrawAmount1)) {
      toast.error("Invalid Amount", {
        icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
        description: "Please enter an amount to withdraw.",
        duration: 4000
      });
      return;
    }

    // Check if amounts exceed position balance
    const max0 = parseFloat(position.token0.amount || '0');
    const max1 = parseFloat(position.token1.amount || '0');
    const in0 = parseFloat(withdrawAmount0 || '0');
    const in1 = parseFloat(withdrawAmount1 || '0');

    if ((in0 > max0 + 1e-12) || (in1 > max1 + 1e-12)) {
      toast.error("Insufficient Balance", {
        icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
        description: "Withdrawal amount exceeds position balance.",
        duration: 4000
      });
      return;
    }

    // For out-of-range positions, ensure at least one amount is greater than 0
    if (!position.isInRange) {
      const amount0Num = parseFloat(withdrawAmount0 || "0");
      const amount1Num = parseFloat(withdrawAmount1 || "0");
      if (amount0Num <= 0 && amount1Num <= 0) {
        toast.error("Invalid Amount", {
          icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
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
    const token0Symbol = getTokenSymbolByAddress(position.token0.address);
    const token1Symbol = getTokenSymbolByAddress(position.token1.address);

    if (!token0Symbol || !token1Symbol) {
      toast.error("Configuration Error", {
        icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
        description: "Token configuration is invalid.",
        action: {
          label: "Open Ticket",
          onClick: () => window.open('https://discord.gg/alphix', '_blank')
        }
      });
      return;
    }

    const amt0 = parseFloat(withdrawAmount0 || '0');
    const amt1 = parseFloat(withdrawAmount1 || '0');
    const max0Eff = parseFloat(position.token0.amount || '0');
    const max1Eff = parseFloat(position.token1.amount || '0');
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
      tokenId: position.positionId,
      token0Symbol: token0Symbol,
      token1Symbol: token1Symbol,
      decreaseAmount0: formatAmount(withdrawAmount0),
      decreaseAmount1: formatAmount(withdrawAmount1),
      isFullBurn: isExactly100,
      poolId: position.poolId,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      enteredSide: withdrawActiveInputSide === 'amount0' ? 'token0' : withdrawActiveInputSide === 'amount1' ? 'token1' : undefined,
    };

    toast("Confirm Withdraw", { icon: React.createElement(Info, { className: "h-4 w-4" }) });

    if (position.isInRange) {
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
    const max0 = parseFloat(position.token0.amount || '0');
    const max1 = parseFloat(position.token1.amount || '0');
    const pct0 = max0 > 0 ? amt0 / max0 : 0;
    const pct1 = max1 > 0 ? amt1 / max1 : 0;
    return (max0 > 0 ? Math.abs(pct0 - 1.0) < 0.0001 : true) && (max1 > 0 ? Math.abs(pct1 - 1.0) < 0.0001 : true);
  }, [withdrawAmount0, withdrawAmount1, position.token0.amount, position.token1.amount]);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    setChartKey(prev => prev + 1);
    if (isOpen) {
      setCurrentView('default');
      setPreviewAddAmount0(0);
      setPreviewAddAmount1(0);
      setPreviewRemoveAmount0(0);
      setPreviewRemoveAmount1(0);
      setPreviewCollectFee0(0);
      setPreviewCollectFee1(0);
      setShowInterimConfirmation(false);
    }
  }, [isOpen, position.positionId]);

  // Handlers for switching views
  const handleAddLiquidityClick = () => {
    setCurrentView('add-liquidity');
    // Reset preview states when switching views
    setPreviewAddAmount0(0);
    setPreviewAddAmount1(0);
    setPreviewRemoveAmount0(0);
    setPreviewRemoveAmount1(0);
    setPreviewCollectFee0(0);
    setPreviewCollectFee1(0);
    setShowInterimConfirmation(false);
    // Reset transaction states (old)
    setIncreaseStep('input');
    setIncreaseBatchPermitSigned(false);
    setSignedBatchPermit(null);
    // Reset V2 transaction states
    setCurrentTransactionStep('idle');
    setPermitSignature(undefined);
  };

  const handleRemoveLiquidityClick = () => {
    setCurrentView('remove-liquidity');
    // Reset preview states when switching views
    setPreviewAddAmount0(0);
    setPreviewAddAmount1(0);
    setPreviewRemoveAmount0(0);
    setPreviewRemoveAmount1(0);
    setPreviewCollectFee0(0);
    setPreviewCollectFee1(0);
    setShowInterimConfirmation(false);
  };

  const handleCollectFeesClick = () => {
    setCurrentView('collect-fees');
    // Reset preview states when switching views
    setPreviewAddAmount0(0);
    setPreviewAddAmount1(0);
    setPreviewRemoveAmount0(0);
    setPreviewRemoveAmount1(0);
    setPreviewCollectFee0(0);
    setPreviewCollectFee1(0);
    setShowInterimConfirmation(false);
  };

  const handleBackToDefault = () => {
    setCurrentView('default');
    // Reset preview states
    setPreviewAddAmount0(0);
    setPreviewAddAmount1(0);
    setPreviewRemoveAmount0(0);
    setPreviewRemoveAmount1(0);
    setPreviewCollectFee0(0);
    setPreviewCollectFee1(0);
    setShowInterimConfirmation(false);
  };

  // Handlers for form panel callbacks
  const handleAddLiquiditySuccess = useCallback(async () => {
    // Invalidate all caches (React Query + client-side) for this position
    if (accountAddress && selectedPoolId) {
      await invalidateAfterTx(queryClient, {
        owner: accountAddress,
        poolId: selectedPoolId,
        positionIds: [position.positionId],
        reason: 'liquidity-added'
      });
    }

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
  }, [onRefreshPosition, queryClient, accountAddress, selectedPoolId, position.positionId, resetIncrease]);

  const handleRemoveLiquiditySuccess = useCallback(async () => {
    // Invalidate all caches (React Query + client-side) for this position
    if (accountAddress && selectedPoolId) {
      await invalidateAfterTx(queryClient, {
        owner: accountAddress,
        poolId: selectedPoolId,
        positionIds: [position.positionId],
        reason: 'liquidity-removed'
      });
    }

    // Reset transaction state to clear success flags
    resetDecrease();

    setCurrentView('default');
    setWithdrawAmount0("");
    setWithdrawAmount1("");
    setPreviewRemoveAmount0(0);
    setPreviewRemoveAmount1(0);

    // Trigger position refresh with backoff
    onRefreshPosition();
  }, [onRefreshPosition, queryClient, accountAddress, selectedPoolId, position.positionId, resetDecrease]);

  const handleCollectFeesSuccess = useCallback(async () => {
    // Invalidate all caches (React Query + client-side) for this position
    // This is critical for clearing stale fee data
    if (accountAddress && selectedPoolId) {
      await invalidateAfterTx(queryClient, {
        owner: accountAddress,
        poolId: selectedPoolId,
        positionIds: [position.positionId],
        reason: 'fees-collected'
      });
    }

    setCurrentView('default');
    setShowInterimConfirmation(false);
    setPreviewCollectFee0(0);
    setPreviewCollectFee1(0);

    // Trigger position refresh with backoff
    onRefreshPosition();
  }, [onRefreshPosition, queryClient, accountAddress, selectedPoolId, position.positionId]);

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

      const d0 = TOKEN_DEFINITIONS?.[position.token0.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals ?? 18;
      const d1 = TOKEN_DEFINITIONS?.[position.token1.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals ?? 18;

      const fee0 = parseFloat(formatUnits(BigInt(raw0), d0));
      const fee1 = parseFloat(formatUnits(BigInt(raw1), d1));

      const price0 = getUsdPriceForSymbol(position.token0.symbol);
      const price1 = getUsdPriceForSymbol(position.token1.symbol);

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
  }, [prefetchedRaw0, prefetchedRaw1, position, getUsdPriceForSymbol]);

  // Calculate individual token USD values
  const token0USD = parseFloat(position.token0.amount) * getUsdPriceForSymbol(position.token0.symbol);
  const token1USD = parseFloat(position.token1.amount) * getUsdPriceForSymbol(position.token1.symbol);

  const fee0USD = feeAmount0 * getUsdPriceForSymbol(position.token0.symbol);
  const fee1USD = feeAmount1 * getUsdPriceForSymbol(position.token1.symbol);

  // Calculate denomination if not provided by parent
  const calculatedDenominationBase = useMemo(() => {
    if (denominationBase) return denominationBase;
    const priceNum = currentPrice ? parseFloat(currentPrice) : undefined;
    return getOptimalBaseToken(position.token0.symbol, position.token1.symbol, priceNum);
  }, [denominationBase, currentPrice, position.token0.symbol, position.token1.symbol]);

  const { calculatedMinPrice, calculatedMaxPrice, calculatedCurrentPrice } = useMemo(() => {
    if (initialMinPrice && initialMaxPrice && initialCurrentPrice !== undefined) {
      return {
        calculatedMinPrice: initialMinPrice,
        calculatedMaxPrice: initialMaxPrice,
        calculatedCurrentPrice: initialCurrentPrice
      };
    }

    const shouldInvert = calculatedDenominationBase === position.token0.symbol;

    let minPoolPrice: number;
    let maxPoolPrice: number;

    if (currentPrice && currentPoolTick !== null && currentPoolTick !== undefined) {
      const currentPriceNum = parseFloat(currentPrice);
      if (isFinite(currentPriceNum)) {
        minPoolPrice = currentPriceNum * Math.pow(1.0001, position.tickLower - currentPoolTick);
        maxPoolPrice = currentPriceNum * Math.pow(1.0001, position.tickUpper - currentPoolTick);
      } else {
        minPoolPrice = Math.pow(1.0001, position.tickLower);
        maxPoolPrice = Math.pow(1.0001, position.tickUpper);
      }
    } else {
      minPoolPrice = Math.pow(1.0001, position.tickLower);
      maxPoolPrice = Math.pow(1.0001, position.tickUpper);
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
  }, [initialMinPrice, initialMaxPrice, initialCurrentPrice, calculatedDenominationBase, position, currentPrice, currentPoolTick]);

  // Use calculated or inherited values
  const minPriceActual = calculatedMinPrice;
  const maxPriceActual = calculatedMaxPrice;
  const currentPriceActual = calculatedCurrentPrice;

  // Check if full range
  const SDK_MIN_TICK = -887272;
  const SDK_MAX_TICK = 887272;
  const isFullRange = Math.abs(position.tickLower - SDK_MIN_TICK) < 1000 &&
                      Math.abs(position.tickUpper - SDK_MAX_TICK) < 1000;

  const statusText = isFullRange ? 'Full Range' : position.isInRange ? 'In Range' : 'Out of Range';
  const statusColor = isFullRange ? 'text-green-500' : position.isInRange ? 'text-green-500' : 'text-red-500';

  // Get token logos
  const getTokenLogo = (symbol: string) => {
    const token = getToken(symbol);
    return token?.icon || '/placeholder-logo.svg';
  };

  // Get token colors for bars
  const token0Color = getTokenColor(position.token0.symbol);
  const token1Color = getTokenColor(position.token1.symbol);

  // Calculate percentage bars for position (with preview adjustments)
  const positionBars = useMemo(() => {
    // Calculate preview-adjusted amounts
    const price0 = getUsdPriceForSymbol(position.token0.symbol);
    const price1 = getUsdPriceForSymbol(position.token1.symbol);

    const previewAdjustment0 = (previewAddAmount0 - previewRemoveAmount0) * price0;
    const previewAdjustment1 = (previewAddAmount1 - previewRemoveAmount1) * price1;

    const adjustedToken0USD = token0USD + previewAdjustment0;
    const adjustedToken1USD = token1USD + previewAdjustment1;

    const total = adjustedToken0USD + adjustedToken1USD;
    if (total === 0) return null;

    const token0Percent = (adjustedToken0USD / total) * 100;
    const token1Percent = (adjustedToken1USD / total) * 100;

    return { token0Percent, token1Percent };
  }, [token0USD, token1USD, previewAddAmount0, previewAddAmount1, previewRemoveAmount0, previewRemoveAmount1, position, getUsdPriceForSymbol]);

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
  const isCollectingFees = currentView === 'collect-fees';

  const hasZeroToken0 = parseFloat(position.token0.amount) === 0;
  const hasZeroToken1 = parseFloat(position.token1.amount) === 0;

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

  return createPortal(
    <div
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
        // Only close if clicking directly on backdrop (not bubbling from child)
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="relative rounded-lg border border-solid shadow-2xl flex flex-col cursor-default"
        style={{
          width: '1000px',
          maxWidth: '95vw',
          maxHeight: '95vh',
          backgroundColor: 'var(--modal-background)',
          borderColor: 'var(--border-primary)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-lg bg-muted/10 border-0 transition-colors flex flex-col flex-1 min-h-0">
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
          <div className="overflow-y-auto px-4 pt-4 pb-4 space-y-4 flex-1 min-h-0">
            {/* Top Bar - Token Info with Status and Fee Tier */}
            <div className="flex items-center justify-between gap-4">
              <div
                className={cn(
                  "flex items-center gap-3",
                  showViewPoolButton && onViewPool && "cursor-pointer hover:opacity-80 transition-opacity"
                )}
                onClick={() => {
                  if (showViewPoolButton && onViewPool) {
                    onViewPool();
                    onClose();
                  }
                }}
              >
                <TokenStack position={position as any} />
                <div className="flex flex-col gap-1">
                  <h3 className="text-base font-semibold flex items-center gap-1.5">
                    {position.token0.symbol} / {position.token1.symbol}
                    {showViewPoolButton && onViewPool && (
                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </h3>
                  <div className="flex items-center gap-2">
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

              {/* Action Buttons - Always visible */}
              <div className="flex items-center gap-2">
                <Button
                  onClick={handleAddLiquidityClick}
                  variant="outline"
                  className={cn(
                    "h-10 px-4 text-sm bg-button border-sidebar-border hover:brightness-110",
                    currentView === 'add-liquidity' && "ring-2 ring-sidebar-primary"
                  )}
                  style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: '200%', backgroundPosition: 'center' }}
                >
                  Add Liquidity
                </Button>
                <Button
                  onClick={handleRemoveLiquidityClick}
                  variant="outline"
                  className={cn(
                    "h-10 px-4 text-sm bg-button border-sidebar-border hover:brightness-110",
                    currentView === 'remove-liquidity' && "ring-2 ring-sidebar-primary"
                  )}
                  style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: '200%', backgroundPosition: 'center' }}
                >
                  Remove Liquidity
                </Button>
                <div className="h-8 w-px bg-border flex-shrink-0" />
                <Button
                  onClick={handleCollectFeesClick}
                  disabled={hasZeroFees}
                  variant="outline"
                  className={cn(
                    "h-10 px-4 text-sm bg-button border-sidebar-border hover:brightness-110 disabled:opacity-50",
                    currentView === 'collect-fees' && "ring-2 ring-sidebar-primary"
                  )}
                  style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: '200%', backgroundPosition: 'center' }}
                >
                  Collect Fees
                </Button>
              </div>
            </div>

            {/* Charts Section - Only show in default view */}
            {currentView === 'default' && (
              <div className="rounded-lg border border-dashed border-sidebar-border/60 bg-muted/10 p-2">
                <div style={{ height: '220px' }} className="relative">
                  {selectedPoolId ? (
                    <PositionChartV2
                      token0={position.token0.symbol}
                      token1={position.token1.symbol}
                      denominationBase={calculatedDenominationBase}
                      currentPrice={currentPriceActual ?? undefined}
                      currentPoolTick={currentPoolTick ?? undefined}
                      minPrice={minPriceActual}
                      maxPrice={maxPriceActual}
                      isInRange={position.isInRange}
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
                <div className="bg-container-secondary border border-sidebar-border rounded-lg p-5">
                <div className="flex flex-col gap-5">
                  {/* Label + Total USD */}
                  <div className="flex flex-col gap-2 relative">
                    {/* APY floating in top-right */}
                    {mounted && (
                      <div className="absolute top-0 right-0 border border-dashed border-sidebar-border/60 rounded-lg p-2 flex items-center gap-1 group/apy cursor-help">
                        <div className="flex flex-col items-start gap-0">
                          {prefetchedIsLoadingAPY ? (
                            <div className="h-4 w-10 bg-muted/60 rounded animate-pulse" />
                          ) : (
                            <div className="text-sm font-normal leading-none">
                              {prefetchedFormattedAPY || '—'}
                            </div>
                          )}
                        </div>

                        {/* Tooltip */}
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-popover border border-sidebar-border rounded-md shadow-lg opacity-0 group-hover/apy:opacity-100 pointer-events-none transition-opacity duration-200 w-48 text-xs text-popover-foreground z-[100]">
                          {prefetchedIsAPYFallback ? (
                            <p><span className="font-bold">APY:</span> Pool-wide estimate. Actual APY calculated from position fees.</p>
                          ) : (
                            <p><span className="font-bold">APY:</span> Calculated from your position's accumulated fees.</p>
                          )}
                          {/* Tooltip arrow */}
                          <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-sidebar-border"></div>
                        </div>
                      </div>
                    )}

                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Position</div>
                    <div className="text-xl font-semibold">
                      {new Intl.NumberFormat('en-US', {
                        style: 'currency',
                        currency: 'USD',
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      }).format(
                        (previewAddAmount0 > 0 || previewAddAmount1 > 0)
                          ? (() => {
                              const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), TOKEN_DEFINITIONS[position.token0.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                              const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), TOKEN_DEFINITIONS[position.token1.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                              return (Number.isFinite(valueUSD) ? valueUSD : 0) +
                                ((previewAddAmount0 + fee0Amount) * getUsdPriceForSymbol(position.token0.symbol)) +
                                ((previewAddAmount1 + fee1Amount) * getUsdPriceForSymbol(position.token1.symbol));
                            })()
                          : (previewRemoveAmount0 > 0 || previewRemoveAmount1 > 0)
                          ? (Number.isFinite(valueUSD) ? valueUSD : 0) -
                            (previewRemoveAmount0 * getUsdPriceForSymbol(position.token0.symbol)) -
                            (previewRemoveAmount1 * getUsdPriceForSymbol(position.token1.symbol))
                          : (Number.isFinite(valueUSD) ? valueUSD : 0)
                      )}
                    </div>
                  </div>

                  {/* Stacked Bars */}
                  {positionBars && (
                    <div className="flex flex-col gap-2">
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
                              src={getTokenLogo(position.token0.symbol)}
                              alt={position.token0.symbol}
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
                              src={getTokenLogo(position.token1.symbol)}
                              alt={position.token1.symbol}
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
                  <div className="flex flex-col gap-4">
                    {/* Token 0 Row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative w-6 h-6 rounded-full overflow-hidden">
                          <Image
                            src={getTokenLogo(position.token0.symbol)}
                            alt={position.token0.symbol}
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
                                  const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), TOKEN_DEFINITIONS[position.token0.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                                  return token0USD + ((previewAddAmount0 + fee0Amount) * getUsdPriceForSymbol(position.token0.symbol));
                                })()
                              : previewRemoveAmount0 > 0
                              ? token0USD - (previewRemoveAmount0 * getUsdPriceForSymbol(position.token0.symbol))
                              : token0USD
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {previewAddAmount0 > 0 ? (
                          <>
                            <span>{formatTokenDisplayAmount(position.token0.amount)}</span>
                            <span className="text-green-500">+</span>
                            <span className="text-green-500 font-medium">
                              {(() => {
                                const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), TOKEN_DEFINITIONS[position.token0.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                                const total = previewAddAmount0 + fee0Amount;
                                return total > 0 && total < 0.0001 ? '< 0.0001' : total.toFixed(4);
                              })()}
                            </span>
                            <span>{position.token0.symbol}</span>
                          </>
                        ) : previewRemoveAmount0 > 0 ? (
                          <>
                            <span>{formatTokenDisplayAmount(position.token0.amount)}</span>
                            <span className="text-red-500">-</span>
                            <span className="text-red-500 font-medium">
                              {previewRemoveAmount0 > 0 && previewRemoveAmount0 < 0.0001 ? '< 0.0001' : previewRemoveAmount0.toFixed(4)}
                            </span>
                            <span>{position.token0.symbol}</span>
                          </>
                        ) : (
                          <span>{formatTokenDisplayAmount(position.token0.amount)} {position.token0.symbol}</span>
                        )}
                      </div>
                    </div>

                    {/* Token 1 Row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="relative w-6 h-6 rounded-full overflow-hidden">
                          <Image
                            src={getTokenLogo(position.token1.symbol)}
                            alt={position.token1.symbol}
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
                                  const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), TOKEN_DEFINITIONS[position.token1.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                                  return token1USD + ((previewAddAmount1 + fee1Amount) * getUsdPriceForSymbol(position.token1.symbol));
                                })()
                              : previewRemoveAmount1 > 0
                              ? token1USD - (previewRemoveAmount1 * getUsdPriceForSymbol(position.token1.symbol))
                              : token1USD
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {previewAddAmount1 > 0 ? (
                          <>
                            <span>{formatTokenDisplayAmount(position.token1.amount)}</span>
                            <span className="text-green-500">+</span>
                            <span className="text-green-500 font-medium">
                              {(() => {
                                const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), TOKEN_DEFINITIONS[position.token1.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                                const total = previewAddAmount1 + fee1Amount;
                                return total > 0 && total < 0.0001 ? '< 0.0001' : total.toFixed(4);
                              })()}
                            </span>
                            <span>{position.token1.symbol}</span>
                          </>
                        ) : previewRemoveAmount1 > 0 ? (
                          <>
                            <span>{formatTokenDisplayAmount(position.token1.amount)}</span>
                            <span className="text-red-500">-</span>
                            <span className="text-red-500 font-medium">
                              {previewRemoveAmount1 > 0 && previewRemoveAmount1 < 0.0001 ? '< 0.0001' : previewRemoveAmount1.toFixed(4)}
                            </span>
                            <span>{position.token1.symbol}</span>
                          </>
                        ) : (
                          <span>{formatTokenDisplayAmount(position.token1.amount)} {position.token1.symbol}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                </div>

                {/* Fees Earned Section */}
                <div className="bg-container-secondary border border-dashed border-sidebar-border rounded-lg p-5 relative">
                <div className="flex flex-col gap-5">
                  {/* Badge - Top Right */}
                  {isAddingLiquidity && !hasZeroFees && (
                    <div className="absolute top-5 right-5 group">
                      <div className="flex items-center justify-center w-6 h-6 rounded bg-green-500/20 text-green-500">
                        <CornerRightUp className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </div>
                      <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                        Fees are compounded
                      </div>
                    </div>
                  )}
                  {isRemovingLiquidity && !hasZeroFees && (
                    <div className="absolute top-5 right-5 group">
                      <div className="flex items-center justify-center w-6 h-6 rounded bg-red-500/20 text-red-500">
                        <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </div>
                      <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                        Fees are withdrawn
                      </div>
                    </div>
                  )}
                  {isCollectingFees && !hasZeroFees && (
                    <div className="absolute top-5 right-5 group">
                      <div className="flex items-center justify-center w-6 h-6 rounded bg-red-500/20 text-red-500">
                        <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </div>
                      <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                        Fees are withdrawn
                      </div>
                    </div>
                  )}

                  {/* Label + Total Fees */}
                  <div className="flex flex-col gap-2">
                    <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Fees Earned</div>
                    <div className={cn("text-xl font-semibold",
                      isAddingLiquidity && !hasZeroFees && "text-green-500",
                      (isRemovingLiquidity || isCollectingFees) && !hasZeroFees && "text-red-500"
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
                    <div className="flex flex-col gap-2">
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
                              src={getTokenLogo(position.token0.symbol)}
                              alt={position.token0.symbol}
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
                              src={getTokenLogo(position.token1.symbol)}
                              alt={position.token1.symbol}
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
                              src={getTokenLogo(position.token0.symbol)}
                              alt={position.token0.symbol}
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
                        <div className="flex items-center gap-2">
                          <div className="text-xs text-muted-foreground">
                            {displayFeeAmount0} {position.token0.symbol}
                          </div>
                          {isAddingLiquidity && !position.isInRange && hasZeroToken0 && feeAmount0 > 0 && (
                            <div className="relative group">
                              <div className="flex items-center justify-center w-4 h-4 rounded bg-red-500/20 text-red-500">
                                <Minus className="h-2.5 w-2.5" strokeWidth={2} />
                              </div>
                              <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                                Fee is withdrawn
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Fee 1 Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="relative w-6 h-6 rounded-full overflow-hidden">
                            <Image
                              src={getTokenLogo(position.token1.symbol)}
                              alt={position.token1.symbol}
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
                        <div className="flex items-center gap-2">
                          <div className="text-xs text-muted-foreground">
                            {displayFeeAmount1} {position.token1.symbol}
                          </div>
                          {isAddingLiquidity && !position.isInRange && hasZeroToken1 && feeAmount1 > 0 && (
                            <div className="relative group">
                              <div className="flex items-center justify-center w-4 h-4 rounded bg-red-500/20 text-red-500">
                                <Minus className="h-2.5 w-2.5" strokeWidth={2} />
                              </div>
                              <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                                Fee is withdrawn
                              </div>
                            </div>
                          )}
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
                <div className="flex flex-col gap-4">
                  {/* Position Section */}
                  <div className="bg-container-secondary border border-sidebar-border rounded-lg p-5">
                  <div className="flex flex-col gap-5">
                    {/* Label + Total USD */}
                    <div className="flex flex-col gap-2">
                      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Position</div>
                      <div className="text-xl font-semibold">
                        {new Intl.NumberFormat('en-US', {
                          style: 'currency',
                          currency: 'USD',
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        }).format(
                          (previewAddAmount0 > 0 || previewAddAmount1 > 0)
                            ? (() => {
                                const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), TOKEN_DEFINITIONS[position.token0.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                                const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), TOKEN_DEFINITIONS[position.token1.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                                return (Number.isFinite(valueUSD) ? valueUSD : 0) +
                                  ((previewAddAmount0 + fee0Amount) * getUsdPriceForSymbol(position.token0.symbol)) +
                                  ((previewAddAmount1 + fee1Amount) * getUsdPriceForSymbol(position.token1.symbol));
                              })()
                            : (previewRemoveAmount0 > 0 || previewRemoveAmount1 > 0)
                            ? (Number.isFinite(valueUSD) ? valueUSD : 0) -
                              (previewRemoveAmount0 * getUsdPriceForSymbol(position.token0.symbol)) -
                              (previewRemoveAmount1 * getUsdPriceForSymbol(position.token1.symbol))
                            : (Number.isFinite(valueUSD) ? valueUSD : 0)
                        )}
                      </div>
                    </div>

                    {/* Stacked Bars */}
                    {positionBars && (
                      <div className="flex flex-col gap-2">
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
                                src={getTokenLogo(position.token0.symbol)}
                                alt={position.token0.symbol}
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
                                src={getTokenLogo(position.token1.symbol)}
                                alt={position.token1.symbol}
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
                    <div className="flex flex-col gap-4">
                      {/* Token 0 Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="relative w-6 h-6 rounded-full overflow-hidden">
                            <Image
                              src={getTokenLogo(position.token0.symbol)}
                              alt={position.token0.symbol}
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
                                    const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), TOKEN_DEFINITIONS[position.token0.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                                    return token0USD + ((previewAddAmount0 + fee0Amount) * getUsdPriceForSymbol(position.token0.symbol));
                                  })()
                                : previewRemoveAmount0 > 0
                                ? token0USD - (previewRemoveAmount0 * getUsdPriceForSymbol(position.token0.symbol))
                                : token0USD
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {previewAddAmount0 > 0 ? (
                            <>
                              <span>{formatTokenDisplayAmount(position.token0.amount)}</span>
                              <span className="text-green-500">+</span>
                              <span className="text-green-500 font-medium">
                                {(() => {
                                  const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), TOKEN_DEFINITIONS[position.token0.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                                  const total = previewAddAmount0 + fee0Amount;
                                  return total > 0 && total < 0.0001 ? '< 0.0001' : total.toFixed(4);
                                })()}
                              </span>
                              <span>{position.token0.symbol}</span>
                            </>
                          ) : previewRemoveAmount0 > 0 ? (
                            <>
                              <span>{formatTokenDisplayAmount(position.token0.amount)}</span>
                              <span className="text-red-500">-</span>
                              <span className="text-red-500 font-medium">
                                {previewRemoveAmount0 > 0 && previewRemoveAmount0 < 0.0001 ? '< 0.0001' : previewRemoveAmount0.toFixed(4)}
                              </span>
                              <span>{position.token0.symbol}</span>
                            </>
                          ) : (
                            <span>{formatTokenDisplayAmount(position.token0.amount)} {position.token0.symbol}</span>
                          )}
                        </div>
                      </div>

                      {/* Token 1 Row */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="relative w-6 h-6 rounded-full overflow-hidden">
                            <Image
                              src={getTokenLogo(position.token1.symbol)}
                              alt={position.token1.symbol}
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
                                    const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), TOKEN_DEFINITIONS[position.token1.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                                    return token1USD + ((previewAddAmount1 + fee1Amount) * getUsdPriceForSymbol(position.token1.symbol));
                                  })()
                                : previewRemoveAmount1 > 0
                                ? token1USD - (previewRemoveAmount1 * getUsdPriceForSymbol(position.token1.symbol))
                                : token1USD
                            )}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {previewAddAmount1 > 0 ? (
                            <>
                              <span>{formatTokenDisplayAmount(position.token1.amount)}</span>
                              <span className="text-green-500">+</span>
                              <span className="text-green-500 font-medium">
                                {(() => {
                                  const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), TOKEN_DEFINITIONS[position.token1.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                                  const total = previewAddAmount1 + fee1Amount;
                                  return total > 0 && total < 0.0001 ? '< 0.0001' : total.toFixed(4);
                                })()}
                              </span>
                              <span>{position.token1.symbol}</span>
                            </>
                          ) : previewRemoveAmount1 > 0 ? (
                            <>
                              <span>{formatTokenDisplayAmount(position.token1.amount)}</span>
                              <span className="text-red-500">-</span>
                              <span className="text-red-500 font-medium">
                                {previewRemoveAmount1 > 0 && previewRemoveAmount1 < 0.0001 ? '< 0.0001' : previewRemoveAmount1.toFixed(4)}
                              </span>
                              <span>{position.token1.symbol}</span>
                            </>
                          ) : (
                            <span>{formatTokenDisplayAmount(position.token1.amount)} {position.token1.symbol}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  </div>

                  {/* Fees Earned Section */}
                  <div className="bg-container-secondary border border-dashed border-sidebar-border rounded-lg p-5 relative">
                  <div className="flex flex-col gap-5">
                    {/* Badge - Top Right */}
                    {isAddingLiquidity && !hasZeroFees && (
                      <div className="absolute top-5 right-5 group">
                        <div className="flex items-center justify-center w-6 h-6 rounded bg-green-500/20 text-green-500">
                          <CornerRightUp className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </div>
                        <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                          Fees are compounded
                        </div>
                      </div>
                    )}
                    {isRemovingLiquidity && !hasZeroFees && (
                      <div className="absolute top-5 right-5 group">
                        <div className="flex items-center justify-center w-6 h-6 rounded bg-red-500/20 text-red-500">
                          <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </div>
                        <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                          Fees are withdrawn
                        </div>
                      </div>
                    )}
                    {isCollectingFees && !hasZeroFees && (
                      <div className="absolute top-5 right-5 group">
                        <div className="flex items-center justify-center w-6 h-6 rounded bg-red-500/20 text-red-500">
                          <Minus className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </div>
                        <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                          Fees are withdrawn
                        </div>
                      </div>
                    )}

                    {/* Label + Total Fees */}
                    <div className="flex flex-col gap-2">
                      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Fees Earned</div>
                      <div className={cn("text-xl font-semibold",
                        isAddingLiquidity && !hasZeroFees && "text-green-500",
                        (isRemovingLiquidity || isCollectingFees) && !hasZeroFees && "text-red-500"
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
                      <div className="flex flex-col gap-2">
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
                                src={getTokenLogo(position.token0.symbol)}
                                alt={position.token0.symbol}
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
                                src={getTokenLogo(position.token1.symbol)}
                                alt={position.token1.symbol}
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
                                src={getTokenLogo(position.token0.symbol)}
                                alt={position.token0.symbol}
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
                          <div className="flex items-center gap-2">
                            <div className="text-xs text-muted-foreground">
                              {displayFeeAmount0} {position.token0.symbol}
                            </div>
                            {isAddingLiquidity && !position.isInRange && hasZeroToken0 && feeAmount0 > 0 && (
                              <div className="relative group">
                                <div className="flex items-center justify-center w-4 h-4 rounded bg-red-500/20 text-red-500">
                                  <Minus className="h-2.5 w-2.5" strokeWidth={2} />
                                </div>
                                <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                                  Fee is withdrawn
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Fee 1 Row */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="relative w-6 h-6 rounded-full overflow-hidden">
                              <Image
                                src={getTokenLogo(position.token1.symbol)}
                                alt={position.token1.symbol}
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
                          <div className="flex items-center gap-2">
                            <div className="text-xs text-muted-foreground">
                              {displayFeeAmount1} {position.token1.symbol}
                            </div>
                            {isAddingLiquidity && !position.isInRange && hasZeroToken1 && feeAmount1 > 0 && (
                              <div className="relative group">
                                <div className="flex items-center justify-center w-4 h-4 rounded bg-red-500/20 text-red-500">
                                  <Minus className="h-2.5 w-2.5" strokeWidth={2} />
                                </div>
                                <div className="absolute bottom-full right-0 mb-2 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100 w-max px-2 py-1 text-xs bg-container border border-sidebar-border rounded shadow-lg z-10 pointer-events-none">
                                  Fee is withdrawn
                                </div>
                              </div>
                            )}
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
              <div className="bg-container-secondary border border-sidebar-border rounded-lg p-5 self-start">
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
                                  icon: React.createElement(OctagonX, { className: "h-4 w-4 text-red-500" }),
                                  description: 'Please enter at least one amount to add.'
                                });
                                return;
                              }

                              setShowInterimConfirmation(true);
                            }}
                            disabled={parseFloat(increaseAmount0 || "0") <= 0 && parseFloat(increaseAmount1 || "0") <= 0}
                            className={cn(
                              "w-full mt-4",
                              (parseFloat(increaseAmount0 || "0") <= 0 && parseFloat(increaseAmount1 || "0") <= 0) ?
                                "relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75" :
                                "text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"
                            )}
                            style={(parseFloat(increaseAmount0 || "0") <= 0 && parseFloat(increaseAmount1 || "0") <= 0) ?
                              { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } :
                              undefined
                            }
                          >
                          Continue
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
                            disabled={isDecreasingLiquidity || (!withdrawAmount0 && !withdrawAmount1) || (parseFloat(withdrawAmount0 || '0') <= 0 && parseFloat(withdrawAmount1 || '0') <= 0)}
                            className={cn(
                              "w-full mt-4",
                              (parseFloat(withdrawAmount0 || "0") <= 0 && parseFloat(withdrawAmount1 || "0") <= 0) ?
                                "relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75" :
                                "text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"
                            )}
                            style={(parseFloat(withdrawAmount0 || "0") <= 0 && parseFloat(withdrawAmount1 || "0") <= 0) ?
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


                    {currentView === 'collect-fees' && (
                      <CollectFeesFormPanel
                        position={position as any}
                        prefetchedRaw0={prefetchedRaw0}
                        prefetchedRaw1={prefetchedRaw1}
                        onSuccess={handleCollectFeesSuccess}
                        getUsdPriceForSymbol={getUsdPriceForSymbol}
                      />
                    )}
                  </div>

                  {showInterimConfirmation && (
                    <>
                      {/* Interim Confirmation View - "You Will Add/Remove/Collect" */}
                      <div className="space-y-4">
                        {/* Header with back arrow */}
                        <div className="flex items-center gap-2">
                          <ChevronLeft
                            className="h-4 w-4 text-muted-foreground cursor-pointer hover:text-white transition-colors"
                            onClick={() => setShowInterimConfirmation(false)}
                          />
                          <span className="text-sm font-medium">
                            {currentView === 'add-liquidity' && 'You Will Add'}
                            {currentView === 'remove-liquidity' && 'You Will Receive'}
                            {currentView === 'collect-fees' && 'You Will Collect'}
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
                                      // For add liquidity, include fees since they're added to position
                                      // For remove liquidity, show only user input (fees are separate)
                                      let displayAmount = baseAmount;
                                      if (currentView === 'add-liquidity') {
                                        const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), TOKEN_DEFINITIONS[position.token0.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                                        displayAmount = baseAmount + fee0Amount;
                                      }
                                      const prefix = currentView === 'add-liquidity' ? '+' : '';
                                      return `${prefix}${formatTokenDisplayAmount(displayAmount.toString())}`;
                                    })()}
                                  </div>
                                  <span className="text-sm text-muted-foreground">{position.token0.symbol}</span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {(() => {
                                    const baseAmount = previewAddAmount0 || previewRemoveAmount0 || 0;
                                    let displayAmount = baseAmount;
                                    if (currentView === 'add-liquidity') {
                                      const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), TOKEN_DEFINITIONS[position.token0.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                                      displayAmount = baseAmount + fee0Amount;
                                    }
                                    return formatUSD(displayAmount * getUsdPriceForSymbol(position.token0.symbol));
                                  })()}
                                </div>
                              </div>
                              <Image
                                src={getTokenLogo(position.token0.symbol)}
                                alt={position.token0.symbol}
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
                                      // For add liquidity, include fees since they're added to position
                                      // For remove liquidity, show only user input (fees are separate)
                                      let displayAmount = baseAmount;
                                      if (currentView === 'add-liquidity') {
                                        const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), TOKEN_DEFINITIONS[position.token1.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                                        displayAmount = baseAmount + fee1Amount;
                                      }
                                      const prefix = currentView === 'add-liquidity' ? '+' : '';
                                      return `${prefix}${formatTokenDisplayAmount(displayAmount.toString())}`;
                                    })()}
                                  </div>
                                  <span className="text-sm text-muted-foreground">{position.token1.symbol}</span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {(() => {
                                    const baseAmount = previewAddAmount1 || previewRemoveAmount1 || 0;
                                    let displayAmount = baseAmount;
                                    if (currentView === 'add-liquidity') {
                                      const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), TOKEN_DEFINITIONS[position.token1.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                                      displayAmount = baseAmount + fee1Amount;
                                    }
                                    return formatUSD(displayAmount * getUsdPriceForSymbol(position.token1.symbol));
                                  })()}
                                </div>
                              </div>
                              <Image
                                src={getTokenLogo(position.token1.symbol)}
                                alt={position.token1.symbol}
                                width={40}
                                height={40}
                                className="rounded-full"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Includes uncollected fees section - Only show for Add/Remove when fees exist */}
                        {(currentView === 'add-liquidity' || currentView === 'remove-liquidity') && (() => {
                          const fee0Amount = parseFloat(formatUnits(BigInt(prefetchedRaw0 || '0'), TOKEN_DEFINITIONS[position.token0.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));
                          const fee1Amount = parseFloat(formatUnits(BigInt(prefetchedRaw1 || '0'), TOKEN_DEFINITIONS[position.token1.symbol as keyof typeof TOKEN_DEFINITIONS]?.decimals || 18));

                          if (fee0Amount <= 0 && fee1Amount <= 0) return null;

                          return (
                            <div className="p-3 border border-dashed rounded-md bg-muted/10 space-y-2">
                              <div className="text-xs font-medium text-muted-foreground mb-2">Includes uncollected fees:</div>

                              <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                  <Image src={getTokenLogo(position.token0.symbol)} alt={position.token0.symbol} width={16} height={16} className="rounded-full" />
                                  <span className="text-xs text-muted-foreground">{position.token0.symbol} Fees</span>
                                </div>
                                <div className="text-right">
                                  <div className="text-xs font-medium">
                                    {fee0Amount === 0 ? '0' : fee0Amount > 0 && fee0Amount < 0.0001 ? '< 0.0001' : fee0Amount.toFixed(6).replace(/\.?0+$/, '')}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatUSD(fee0Amount * getUsdPriceForSymbol(position.token0.symbol))}
                                  </div>
                                </div>
                              </div>

                              <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                  <Image src={getTokenLogo(position.token1.symbol)} alt={position.token1.symbol} width={16} height={16} className="rounded-full" />
                                  <span className="text-xs text-muted-foreground">{position.token1.symbol} Fees</span>
                                </div>
                                <div className="text-right">
                                  <div className="text-xs font-medium">
                                    {fee1Amount === 0 ? '0' : fee1Amount > 0 && fee1Amount < 0.0001 ? '< 0.0001' : fee1Amount.toFixed(6).replace(/\.?0+$/, '')}
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatUSD(fee1Amount * getUsdPriceForSymbol(position.token1.symbol))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Additional context info OR Transaction Steps (conditional) */}
                        {currentView === 'remove-liquidity' || !showTransactionOverview ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Current Price:</span>
                              <span className="text-xs text-muted-foreground">
                                {(() => {
                                  const price0 = getUsdPriceForSymbol(position.token0.symbol);
                                  const price1 = getUsdPriceForSymbol(position.token1.symbol);
                                  if (price0 === 0 || price1 === 0) return "N/A";
                                  const ratio = price0 / price1;
                                  const decimals = ratio < 0.1 ? 3 : 2;
                                  return `1 ${position.token0.symbol} = ${ratio.toFixed(decimals)} ${position.token1.symbol}`;
                                })()}
                              </span>
                            </div>
                          </div>
                        ) : showTransactionOverview && currentView === 'add-liquidity' ? (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Token Approvals</span>
                              <span>
                                {(currentTransactionStep === 'approving_token0' || currentTransactionStep === 'approving_token1') ? (
                                  <RefreshCwIcon className="h-4 w-4 animate-spin" />
                                ) : (
                                  <motion.span
                                    animate={approvalWiggleControls}
                                    className={cn("text-xs font-mono",
                                      !increaseApprovalData?.needsToken0ERC20Approval && !increaseApprovalData?.needsToken1ERC20Approval
                                        ? 'text-green-500'
                                        : approvalWiggleCount > 0
                                        ? 'text-red-500'
                                        : 'text-muted-foreground'
                                    )}
                                  >
                                    {isCheckingIncreaseApprovals ? (
                                      'Checking...'
                                    ) : !increaseApprovalData ? (
                                      '-'
                                    ) : (() => {
                                      // Calculate total approvals needed based on whether tokens are native
                                      const token0IsNative = TOKEN_DEFINITIONS[position.token0.symbol as TokenSymbol]?.address === NATIVE_TOKEN_ADDRESS;
                                      const token1IsNative = TOKEN_DEFINITIONS[position.token1.symbol as TokenSymbol]?.address === NATIVE_TOKEN_ADDRESS;
                                      const maxNeeded = (token0IsNative ? 0 : 1) + (token1IsNative ? 0 : 1);

                                      const totalNeeded = [increaseApprovalData.needsToken0ERC20Approval, increaseApprovalData.needsToken1ERC20Approval].filter(Boolean).length;
                                      const completed = maxNeeded - totalNeeded;
                                      return `${completed}/${maxNeeded}`;
                                    })()}
                                  </motion.span>
                                )}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Permit Signature</span>
                              <span>
                                {currentTransactionStep === 'signing_permit' ? (
                                  <RefreshCwIcon className="h-4 w-4 animate-spin" />
                                ) : isCheckingIncreaseApprovals ? (
                                  <span className="text-xs font-mono text-muted-foreground">Checking...</span>
                                ) : (increaseApprovalData?.needsToken0Permit || increaseApprovalData?.needsToken1Permit) ? (
                                  permitSignature ? (
                                    <span className="text-xs font-mono text-green-500">1/1</span>
                                  ) : (
                                    <span className="text-xs font-mono">0/1</span>
                                  )
                                ) : (
                                  <span className="text-xs font-mono text-green-500">✓</span>
                                )}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>Deposit Transaction</span>
                              <span>
                                {(increaseStep === 'deposit' && isIncreasingLiquidity) ? (
                                  <RefreshCwIcon className="h-4 w-4 animate-spin" />
                                ) : (
                                  <span className={cn("text-xs font-mono", isIncreaseSuccess ? 'text-green-500' : 'text-muted-foreground')}>
                                    {isIncreaseSuccess ? '1/1' : '0/1'}
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>
                        ) : null}

                        {/* Back/Confirm buttons */}
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
                              currentView === 'add-liquidity' ? (increaseIsWorking || isIncreasingLiquidity) :
                              currentView === 'remove-liquidity' ? isDecreasingLiquidity :
                              false
                            }
                            style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                          >
                            Back
                          </Button>

                          <Button
                            id="modal-interim-confirm-button"
                            className="text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"
                            onClick={() => {
                              if (currentView === 'remove-liquidity') {
                                // Remove Liquidity: Execute directly without transaction overview
                                handleExecuteWithdrawTransaction();
                              } else if (currentView === 'add-liquidity') {
                                // Add Liquidity: Use transaction overview flow
                                if (showTransactionOverview) {
                                  handleIncreaseTransactionV2();
                                } else {
                                  setShowTransactionOverview(true);
                                }
                              }
                            }}
                            disabled={
                              currentView === 'add-liquidity' ? (currentTransactionStep !== 'idle' || isIncreasingLiquidity || isCheckingIncreaseApprovals) :
                              currentView === 'remove-liquidity' ? (isDecreasingLiquidity || isWithdrawCalculating) :
                              false
                            }
                          >
                            <span className={
                              currentView === 'add-liquidity' ? ((currentTransactionStep !== 'idle' || isIncreasingLiquidity) ? "animate-pulse" : "") :
                              currentView === 'remove-liquidity' ? (isDecreasingLiquidity ? "animate-pulse" : "") :
                              ""
                            }>
                              {currentView === 'add-liquidity' ? (
                                showTransactionOverview ? getIncreaseButtonText() : "Confirm"
                              ) : currentView === 'remove-liquidity' ? (
                                isDecreasingLiquidity ? "Processing..." : (isWithdrawBurn ? "Burn Position" : "Withdraw")
                              ) : "Confirm"}
                            </span>
                          </Button>
                        </div>
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
  );
}
