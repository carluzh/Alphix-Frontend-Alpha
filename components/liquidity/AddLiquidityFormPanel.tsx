"use client";

import React, { useState, useEffect, useCallback } from "react";
import { PlusIcon, BadgeCheck, OctagonX, Info as InfoIcon, RefreshCw as RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import { useAccount, useBalance, useSignTypedData } from "wagmi";
import { toast } from "sonner";
import { usePercentageInput } from "@/hooks/usePercentageInput";
import { getTokenDefinitions, TokenSymbol } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { useIncreaseLiquidity, type IncreasePositionData, providePreSignedIncreaseBatchPermit } from "@/lib/liquidity/hooks";
import { useAnimation } from "framer-motion";
import type { ProcessedPosition } from "../../pages/api/liquidity/get-positions";
import { cn } from "@/lib/utils";
import { preparePermit2BatchForNewPosition } from '@/lib/liquidity-utils';
import {
  getTokenIcon, formatCalculatedAmount,
  PERMIT2_ADDRESS, MAX_UINT256
} from './liquidity-form-utils';
import { getExplorerTxUrl } from '@/lib/wagmiConfig';
import { useDerivedIncreaseInfo } from "@/lib/liquidity/hooks";
import { useTokenUSDPrice } from "@/hooks/useTokenUSDPrice";
import { TokenInputCard, TokenInputStyles } from './TokenInputCard';

interface AddLiquidityFormPanelProps {
  position: ProcessedPosition;
  feesForIncrease?: { amount0: string; amount1: string; } | null;
  onSuccess: () => void;
  onAmountsChange?: (amount0: number, amount1: number) => void;
  hideContinueButton?: boolean;
  externalIsSuccess?: boolean;
  externalTxHash?: string;
  currentPoolTick?: number | null;
}

export function AddLiquidityFormPanel({
  position,
  feesForIncrease,
  onSuccess,
  onAmountsChange,
  hideContinueButton = false,
  externalIsSuccess,
  externalTxHash,
  currentPoolTick
}: AddLiquidityFormPanelProps) {
  const { address: accountAddress } = useAccount();
  const { chainId, networkMode } = useNetwork();
  // Always use network context chainId for queries (not wallet chainId)
  const tokenDefinitions = React.useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const { signTypedDataAsync } = useSignTypedData();

  // USD prices using mid-price quotes (replaces deprecated useAllPrices)
  const { price: token0USDPrice } = useTokenUSDPrice(position.token0.symbol as TokenSymbol);
  const { price: token1USDPrice } = useTokenUSDPrice(position.token1.symbol as TokenSymbol);

  const [increaseAmount0, setIncreaseAmount0] = useState<string>("");
  const [increaseAmount1, setIncreaseAmount1] = useState<string>("");
  const [increaseStep, setIncreaseStep] = useState<'input' | 'approve' | 'permit' | 'deposit'>('input');
  const [increasePreparedTxData, setIncreasePreparedTxData] = useState<any>(null);
  const [increaseNeedsERC20Approvals, setIncreaseNeedsERC20Approvals] = useState<TokenSymbol[]>([]);
  const [increaseIsWorking, setIncreaseIsWorking] = useState(false);
  const [increaseBatchPermitSigned, setIncreaseBatchPermitSigned] = useState(false);
  const [signedBatchPermit, setSignedBatchPermit] = useState<null | { owner: `0x${string}`; permitBatch: any; signature: string }>(null);
  const [showTransactionOverview, setShowTransactionOverview] = useState(false);
  const [showSuccessView, setShowSuccessView] = useState(false);
  const [increaseCompletedERC20ApprovalsCount, setIncreaseCompletedERC20ApprovalsCount] = useState(0);
  const [increaseInvolvedTokensCount, setIncreaseInvolvedTokensCount] = useState(0);
  const [increaseAlreadyApprovedCount, setIncreaseAlreadyApprovedCount] = useState(0);

  // Use shared hook for dependent amount calculation (Uniswap pattern)
  const {
    calculateDependentAmount,
    isCalculating,
    isOutOfRange,
    dependentAmount,
    dependentField,
  } = useDerivedIncreaseInfo({
    position,
    chainId,
    currentPoolTick,
    networkMode,
  });

  // Sync dependent amount from calculation hook to UI state
  useEffect(() => {
    if (!dependentField || !dependentAmount) return;
    if (dependentField === 'amount1') {
      setIncreaseAmount1(dependentAmount);
    } else if (dependentField === 'amount0') {
      setIncreaseAmount0(dependentAmount);
    }
  }, [dependentField, dependentAmount]);

  const wiggleControls0 = useAnimation();
  const wiggleControls1 = useAnimation();
  const [isAmount0OverBalance, setIsAmount0OverBalance] = useState(false);
  const [isAmount1OverBalance, setIsAmount1OverBalance] = useState(false);

  // Balance data
  const { data: token0BalanceData, refetch: refetchToken0Balance } = useBalance({
    address: accountAddress,
    token: tokenDefinitions[position.token0.symbol as TokenSymbol]?.address === "0x0000000000000000000000000000000000000000"
      ? undefined
      : tokenDefinitions[position.token0.symbol as TokenSymbol]?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId },
  });

  const { data: token1BalanceData, refetch: refetchToken1Balance } = useBalance({
    address: accountAddress,
    token: tokenDefinitions[position.token1.symbol as TokenSymbol]?.address === "0x0000000000000000000000000000000000000000"
      ? undefined
      : tokenDefinitions[position.token1.symbol as TokenSymbol]?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId },
  });

  // Listen for wallet balance refresh events (e.g., after fee collection)
  useEffect(() => {
    const handleBalanceRefresh = () => {
      refetchToken0Balance();
      refetchToken1Balance();
    };
    window.addEventListener('walletBalancesRefresh', handleBalanceRefresh);
    return () => window.removeEventListener('walletBalancesRefresh', handleBalanceRefresh);
  }, [refetchToken0Balance, refetchToken1Balance]);

  const handleToken0Percentage = usePercentageInput(
    token0BalanceData,
    { decimals: tokenDefinitions[position.token0.symbol as TokenSymbol]?.decimals || 18, symbol: position.token0.symbol as TokenSymbol },
    setIncreaseAmount0
  );

  const handleToken1Percentage = usePercentageInput(
    token1BalanceData,
    { decimals: tokenDefinitions[position.token1.symbol as TokenSymbol]?.decimals || 18, symbol: position.token1.symbol as TokenSymbol },
    setIncreaseAmount1
  );

  const { increaseLiquidity, isLoading: isIncreasingLiquidity, isSuccess: isIncreaseSuccess, hash: increaseTxHash } = useIncreaseLiquidity({
    onLiquidityIncreased: (info) => {
      // Refetch balances after successful transaction
      refetchToken0Balance();
      refetchToken1Balance();
      // Only set success view - don't call onSuccess() yet
      // onSuccess() will be called when user clicks "Done" button in success view
      setShowSuccessView(true);
    }
  });

  useEffect(() => {
    if (externalIsSuccess || isIncreaseSuccess) {
      setShowTransactionOverview(false);
      setShowSuccessView(true);
    }
  }, [isIncreaseSuccess, externalIsSuccess]);

  // Determine which side is productive for OOR positions
  let addProductiveSide: null | 'amount0' | 'amount1' = null;
  try {
    if (position && !position.isInRange) {
      // Prefer actual balances to determine productive side when out of range
      const amt0 = Number.parseFloat(position.token0?.amount || '0');
      const amt1 = Number.parseFloat(position.token1?.amount || '0');
      if (amt0 > 0 && (!Number.isFinite(amt1) || amt1 <= 0)) addProductiveSide = 'amount0';
      else if (amt1 > 0 && (!Number.isFinite(amt0) || amt0 <= 0)) addProductiveSide = 'amount1';
      // If both sides have amounts, return null to show both
    }
  } catch (error) {
    console.error("Error calculating productive side:", error);
  }

  // Notify parent of amount changes for preview
  useEffect(() => {
    if (onAmountsChange) {
      const amt0 = parseFloat(increaseAmount0 || "0");
      const amt1 = parseFloat(increaseAmount1 || "0");
      onAmountsChange(amt0, amt1);
    }
  }, [increaseAmount0, increaseAmount1, onAmountsChange]);

  // Track over-balance state for wiggle animation
  useEffect(() => {
    const amount0 = parseFloat(increaseAmount0 || "0");
    const balance0 = parseFloat(token0BalanceData?.formatted || "0");
    setIsAmount0OverBalance(amount0 > balance0 && amount0 > 0);
  }, [increaseAmount0, token0BalanceData]);

  useEffect(() => {
    const amount1 = parseFloat(increaseAmount1 || "0");
    const balance1 = parseFloat(token1BalanceData?.formatted || "0");
    setIsAmount1OverBalance(amount1 > balance1 && amount1 > 0);
  }, [increaseAmount1, token1BalanceData]);

  const handleContinue = () => {
    setShowTransactionOverview(true);
    handlePrepareIncrease();
  };

  const handlePrepareIncrease = async () => {
    if (!accountAddress || !chainId) return;

    setIncreaseIsWorking(true);
    try {
      // Check what ERC20 approvals are needed
      const needsApproval: TokenSymbol[] = [];
      const tokens = [
        { symbol: position.token0.symbol as TokenSymbol, amount: increaseAmount0 },
        { symbol: position.token1.symbol as TokenSymbol, amount: increaseAmount1 }
      ];

      for (const token of tokens) {
        if (!token.amount || parseFloat(token.amount) <= 0) continue;

        const tokenDef = tokenDefinitions[token.symbol];
        if (!tokenDef || tokenDef.address === "0x0000000000000000000000000000000000000000") continue;

        try {
          // Check ERC20 allowance to Permit2
          const { readContract } = await import('@wagmi/core');
          const { erc20Abi } = await import('viem');
          const { config } = await import('@/lib/wagmiConfig');

          const allowance = await readContract(config, {
            address: tokenDef.address as `0x${string}`,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [accountAddress, PERMIT2_ADDRESS]
          });

          const { parseUnits } = await import('viem');
          const requiredAmount = parseUnits(token.amount, tokenDef.decimals);
          if (allowance < requiredAmount) {
            needsApproval.push(token.symbol);
          }
        } catch (error) {
          // Skip token if allowance check fails
        }
      }

      const tokensWithAmounts = tokens.filter(t => t.amount && parseFloat(t.amount) > 0);
      const alreadyApproved = tokensWithAmounts.length - needsApproval.length;

      setIncreaseNeedsERC20Approvals(needsApproval);
      setIncreaseInvolvedTokensCount(tokensWithAmounts.length);
      setIncreaseAlreadyApprovedCount(alreadyApproved);

      if (needsApproval.length > 0) {
        setIncreaseStep('approve');
        setIncreasePreparedTxData({
          needsApproval: true,
          approvalType: 'ERC20_TO_PERMIT2',
          approvalTokenSymbol: needsApproval[0],
          approvalTokenAddress: tokenDefinitions[needsApproval[0]]?.address,
          approvalAmount: MAX_UINT256,
          approveToAddress: PERMIT2_ADDRESS,
        });
      } else {
        setIncreaseStep('permit');
        setIncreasePreparedTxData({ needsApproval: false });
      }
    } catch (error: any) {
      toast.error("Preparation Error", { description: error.message || "Failed to prepare transaction", icon: <OctagonX className="h-4 w-4 text-red-500" /> });
    } finally {
      setIncreaseIsWorking(false);
    }
  };

  const handleIncreaseApprove = useCallback(async () => {
    if (!increasePreparedTxData?.needsApproval || increasePreparedTxData.approvalType !== 'ERC20_TO_PERMIT2') return;

    setIncreaseIsWorking(true);

    try {
      const tokenAddress = increasePreparedTxData.approvalTokenAddress as `0x${string}` | undefined;
      if (!tokenAddress) throw new Error('Missing token address for approval');

      toast("Confirm in Wallet", {
        icon: <InfoIcon className="h-4 w-4" />
      });

      const { writeContract } = await import('@wagmi/core');
      const { erc20Abi } = await import('viem');
      const { config } = await import('@/lib/wagmiConfig');

      await writeContract(config, {
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'approve',
        args: [PERMIT2_ADDRESS as `0x${string}`, BigInt(increasePreparedTxData.approvalAmount || '0')],
      });

      toast.success(`${increasePreparedTxData.approvalTokenSymbol} Approved`, {
        icon: <BadgeCheck className="h-4 w-4 text-green-500" />
      });

      setIncreaseCompletedERC20ApprovalsCount(prev => prev + 1);

      // Check if more approvals needed
      const currentIndex = increaseNeedsERC20Approvals.indexOf(increasePreparedTxData.approvalTokenSymbol as TokenSymbol);
      if (currentIndex < increaseNeedsERC20Approvals.length - 1) {
        // More approvals needed
        const nextToken = increaseNeedsERC20Approvals[currentIndex + 1];
        setIncreasePreparedTxData({
          needsApproval: true,
          approvalType: 'ERC20_TO_PERMIT2',
          approvalTokenSymbol: nextToken,
          approvalTokenAddress: tokenDefinitions[nextToken]?.address,
          approvalAmount: MAX_UINT256,
          approveToAddress: PERMIT2_ADDRESS,
        });
      } else {
        // All approvals complete, move to permit step
        setIncreaseStep('permit');
      }

      setIncreaseIsWorking(false);
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to approve token.";
      toast.error("Approval Error", {
        icon: <OctagonX className="h-4 w-4 text-red-500" />,
        description: errorMessage,
        action: {
          label: "Copy Error",
          onClick: () => navigator.clipboard.writeText(errorMessage)
        }
      });
      setIncreaseIsWorking(false);
    }
  }, [increasePreparedTxData, increaseNeedsERC20Approvals]);

  const handleIncreasePermit = useCallback(async () => {
    if (!accountAddress || !chainId) return;
    setIncreaseIsWorking(true);
    try {
      const compositeId = position.positionId?.toString?.() || '';
      let tokenIdHex = compositeId.includes('-') ? compositeId.split('-').pop() || '' : compositeId;
      if (!tokenIdHex.startsWith('0x')) tokenIdHex = `0x${tokenIdHex}`;

      const deadline = Math.floor(Date.now() / 1000) + (20 * 60);
      const prepared = await preparePermit2BatchForNewPosition(
        position.token0.symbol as TokenSymbol,
        position.token1.symbol as TokenSymbol,
        accountAddress as `0x${string}`,
        chainId,
        deadline
      );

      if (!prepared?.message?.details || prepared.message.details.length === 0) {
        setIncreaseBatchPermitSigned(true);
        setIncreaseStep('deposit');
        setIncreaseIsWorking(false);
        return;
      }

      toast("Sign in Wallet", {
        icon: <InfoIcon className="h-4 w-4" />
      });

      const signature = await signTypedDataAsync({
        domain: prepared.domain as any,
        types: prepared.types as any,
        primaryType: prepared.primaryType,
        message: prepared.message as any,
      });

      const payload = { owner: accountAddress as `0x${string}`, permitBatch: prepared.message, signature };
      providePreSignedIncreaseBatchPermit(position.positionId, payload);
      setSignedBatchPermit(payload);

      toast.success("Batch Signature Complete", {
        icon: <BadgeCheck className="h-4 w-4 text-green-500" />,
      });

      setIncreaseBatchPermitSigned(true);
      setIncreaseStep('deposit');
    } catch (error: any) {
      const description = (error?.message || '').includes('User rejected') ? 'Permit signature was rejected.' : (error?.message || 'Failed to sign permit');
      toast.error('Permit Error', {
        icon: <OctagonX className="h-4 w-4 text-red-500" />,
        description
      });
    } finally {
      setIncreaseIsWorking(false);
    }
  }, [position, accountAddress, chainId, signTypedDataAsync]);

  const handleExecuteTransaction = async () => {
    if (increaseStep === 'approve') {
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
        feesForIncrease: feesForIncrease,
      };

      try {
        // @ts-ignore opts supported by hook
        increaseLiquidity(data, signedBatchPermit ? { batchPermit: signedBatchPermit } : undefined);
      } catch (e) {
        // Error already handled by hook
      }
    }
  };

  if (showSuccessView) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-primary p-4 bg-muted/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image src={getTokenIcon(position.token0.symbol)} alt="" width={32} height={32} className="rounded-full" />
              <div>
                <div className="font-medium">
                  <span className="text-sm">{(parseFloat(increaseAmount0 || "0") || 0).toFixed(6)}</span>
                  <span className="ml-1 text-xs text-muted-foreground">{position.token0.symbol}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatCalculatedAmount(parseFloat(increaseAmount0 || "0") * (token0USDPrice || 0))}
                </div>
              </div>
            </div>
            <PlusIcon className="h-4 w-4 text-muted-foreground" />
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="font-medium">
                  <span className="text-sm">{(parseFloat(increaseAmount1 || "0") || 0).toFixed(6)}</span>
                  <span className="ml-1 text-xs text-muted-foreground">{position.token1.symbol}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatCalculatedAmount(parseFloat(increaseAmount1 || "0") * (token1USDPrice || 0))}
                </div>
              </div>
              <Image src={getTokenIcon(position.token1.symbol)} alt="" width={32} height={32} className="rounded-full" />
            </div>
          </div>
        </div>
        <div className="my-6 text-center">
          <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
            <BadgeCheck className="h-6 w-6 text-green-500" />
          </div>
          <h3 className="text-lg font-medium">Liquidity Added!</h3>
          {(externalTxHash || increaseTxHash) && (
            <a
              href={getExplorerTxUrl(externalTxHash || increaseTxHash || '')}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:underline"
            >
              View on Explorer
            </a>
          )}
        </div>
        {!hideContinueButton && (
          <Button
            className="w-full text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"
            onClick={() => onSuccess()}
          >
            Continue
          </Button>
        )}
      </div>
    );
  }

  // Transaction overview
  if (showTransactionOverview) {
    return (
      <div className="space-y-4">
        <h3 className="text-base font-semibold">Confirm Transaction</h3>

        {/* Transaction Steps Box */}
        <div className="p-3 border border-dashed rounded-md bg-muted/10">
          <p className="text-sm font-medium mb-2 text-foreground/80">Transaction Steps</p>
          <div className="space-y-1.5 text-xs text-muted-foreground">
            {/* Token Approvals */}
            <div className="flex items-center justify-between">
              <span>Token Approvals</span>
              <span>
                {(increaseStep === 'approve' && increaseIsWorking) ? (
                  <RefreshCwIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <span className={`text-xs font-mono ${increaseInvolvedTokensCount > 0 && (increaseAlreadyApprovedCount + increaseCompletedERC20ApprovalsCount) === increaseInvolvedTokensCount ? 'text-green-500' : 'text-muted-foreground'}`}>
                    {`${increaseAlreadyApprovedCount + increaseCompletedERC20ApprovalsCount}/${increaseInvolvedTokensCount}`}
                  </span>
                )}
              </span>
            </div>

            {/* Permit Signature */}
            <div className="flex items-center justify-between">
              <span>Permit Signature</span>
              <span>
                {(increaseStep === 'permit' && increaseIsWorking) ? (
                  <RefreshCwIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <span className={`text-xs font-mono ${increaseBatchPermitSigned ? 'text-green-500' : 'text-muted-foreground'}`}>
                    {increaseBatchPermitSigned ? '1/1' : '0/1'}
                  </span>
                )}
              </span>
            </div>

            {/* Deposit Transaction */}
            <div className="flex items-center justify-between">
              <span>Deposit Transaction</span>
              <span>
                {(increaseStep === 'deposit' && isIncreasingLiquidity) ? (
                  <RefreshCwIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <span className={`text-xs font-mono ${isIncreaseSuccess ? 'text-green-500' : 'text-muted-foreground'}`}>
                    {isIncreaseSuccess ? '1/1' : '0/1'}
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            className="relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75 disabled:opacity-50"
            onClick={() => {
              setShowTransactionOverview(false);
            }}
            disabled={increaseIsWorking || isIncreasingLiquidity}
            style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            Back
          </Button>

          <Button
            className="text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"
            onClick={handleExecuteTransaction}
            disabled={increaseIsWorking || isIncreasingLiquidity || isIncreaseSuccess}
          >
            <span className={increaseIsWorking || isIncreasingLiquidity ? "animate-pulse" : ""}>
              {increaseIsWorking || isIncreasingLiquidity
                ? "Processing..."
                : increaseStep === 'approve'
                  ? `Approve ${increasePreparedTxData?.approvalTokenSymbol || 'Token'}`
                  : increaseStep === 'permit'
                    ? "Sign Permit"
                    : "Add Liquidity"}
            </span>
          </Button>
        </div>
      </div>
    );
  }

  // Input view
  return (
    <div className="space-y-4">
      <TokenInputStyles />
      <h3 className="text-base font-semibold">Add Liquidity</h3>

      {/* Token 0 Input */}
      {(!addProductiveSide || addProductiveSide === 'amount0') && parseFloat(position.token0.amount) >= 0 && (
        <TokenInputCard
          id="increase-amount0"
          tokenSymbol={position.token0.symbol}
          value={increaseAmount0}
          onChange={setIncreaseAmount0}
          label="Add"
          maxAmount={token0BalanceData?.formatted || "0"}
          usdPrice={token0USDPrice || 0}
          formatUsdAmount={formatCalculatedAmount}
          isOverBalance={isAmount0OverBalance}
          animationControls={wiggleControls0}
          onPercentageClick={(percentage) => handleToken0Percentage(percentage)}
          onCalculateDependentAmount={(value) => calculateDependentAmount(value, 'amount0')}
        />
      )}

      {!addProductiveSide && (
        <div className="flex justify-center items-center">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
            <PlusIcon className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Token 1 Input */}
      {(!addProductiveSide || addProductiveSide === 'amount1') && parseFloat(position.token1.amount) >= 0 && (
        <TokenInputCard
          id="increase-amount1"
          tokenSymbol={position.token1.symbol}
          value={increaseAmount1}
          onChange={setIncreaseAmount1}
          label="Add"
          maxAmount={token1BalanceData?.formatted || "0"}
          usdPrice={token1USDPrice || 0}
          formatUsdAmount={formatCalculatedAmount}
          isOverBalance={isAmount1OverBalance}
          animationControls={wiggleControls1}
          onPercentageClick={(percentage) => handleToken1Percentage(percentage)}
          onCalculateDependentAmount={(value) => calculateDependentAmount(value, 'amount1')}
        />
      )}

      <Button
        id={hideContinueButton ? "formpanel-hidden-continue" : undefined}
        onClick={handleContinue}
        disabled={(parseFloat(increaseAmount0 || "0") <= 0 && parseFloat(increaseAmount1 || "0") <= 0) || isAmount0OverBalance || isAmount1OverBalance || isCalculating}
        className={cn(
          "w-full",
          (parseFloat(increaseAmount0 || "0") <= 0 && parseFloat(increaseAmount1 || "0") <= 0) || isAmount0OverBalance || isAmount1OverBalance || isCalculating ?
            "relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75" :
            "text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90",
          hideContinueButton && "hidden"
        )}
        style={(parseFloat(increaseAmount0 || "0") <= 0 && parseFloat(increaseAmount1 || "0") <= 0) || isAmount0OverBalance || isAmount1OverBalance || isCalculating ?
          { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } :
          undefined
        }
      >
        <span className={isCalculating ? "animate-pulse" : ""}>
          {isCalculating ? "Calculating..." : isAmount0OverBalance || isAmount1OverBalance ? "Insufficient Balance" : "Continue"}
        </span>
      </Button>
    </div>
  );
}
