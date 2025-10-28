"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { PlusIcon, BadgeCheck, OctagonX, Info as InfoIcon, RefreshCw as RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";
import { useAccount, useBalance, useSignTypedData } from "wagmi";
import { toast } from "sonner";
import { usePercentageInput } from "@/hooks/usePercentageInput";
import { TOKEN_DEFINITIONS, TokenSymbol } from "@/lib/pools-config";
import { useIncreaseLiquidity, type IncreasePositionData, providePreSignedIncreaseBatchPermit } from "./useIncreaseLiquidity";
import { motion, useAnimation } from "framer-motion";
import type { ProcessedPosition } from "../../pages/api/liquidity/get-positions";
import { useAllPrices } from "@/components/data/hooks";
import { sanitizeDecimalInput, cn, getTokenSymbolByAddress } from "@/lib/utils";
import { preparePermit2BatchForNewPosition } from '@/lib/liquidity-utils';
import { formatUnits } from "viem";
import {
  getTokenIcon, formatCalculatedAmount, getUSDPriceForSymbol,
  calculateCorrespondingAmount, PERMIT2_ADDRESS, MAX_UINT256, PERCENTAGE_OPTIONS
} from './liquidity-form-utils';

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
  const { address: accountAddress, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { data: allPrices } = useAllPrices();

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
  const [isCalculating, setIsCalculating] = useState(false);
  const [canAddToken0, setCanAddToken0] = useState(true);
  const [canAddToken1, setCanAddToken1] = useState(true);

  const wiggleControls0 = useAnimation();
  const wiggleControls1 = useAnimation();
  const calcVersionRef = useRef(0);

  // Balance data
  const { data: token0BalanceData } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[position.token0.symbol as TokenSymbol]?.address === "0x0000000000000000000000000000000000000000"
      ? undefined
      : TOKEN_DEFINITIONS[position.token0.symbol as TokenSymbol]?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId },
  });

  const { data: token1BalanceData } = useBalance({
    address: accountAddress,
    token: TOKEN_DEFINITIONS[position.token1.symbol as TokenSymbol]?.address === "0x0000000000000000000000000000000000000000"
      ? undefined
      : TOKEN_DEFINITIONS[position.token1.symbol as TokenSymbol]?.address as `0x${string}` | undefined,
    chainId,
    query: { enabled: !!accountAddress && !!chainId },
  });

  const handleToken0Percentage = usePercentageInput(
    token0BalanceData,
    { decimals: TOKEN_DEFINITIONS[position.token0.symbol as TokenSymbol]?.decimals || 18, symbol: position.token0.symbol as TokenSymbol },
    setIncreaseAmount0
  );

  const handleToken1Percentage = usePercentageInput(
    token1BalanceData,
    { decimals: TOKEN_DEFINITIONS[position.token1.symbol as TokenSymbol]?.decimals || 18, symbol: position.token1.symbol as TokenSymbol },
    setIncreaseAmount1
  );

  const { increaseLiquidity, isLoading: isIncreasingLiquidity, isSuccess: isIncreaseSuccess, hash: increaseTxHash } = useIncreaseLiquidity({
    onLiquidityIncreased: (info) => {
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

  useEffect(() => {
    if (!position.isInRange && currentPoolTick !== null && currentPoolTick !== undefined) {
      const deposit0Disabled = currentPoolTick >= position.tickUpper;
      const deposit1Disabled = currentPoolTick <= position.tickLower;
      setCanAddToken0(!deposit0Disabled);
      setCanAddToken1(!deposit1Disabled);
    } else {
      setCanAddToken0(true);
      setCanAddToken1(true);
    }
  }, [position, currentPoolTick]);

  // Notify parent of amount changes for preview
  useEffect(() => {
    if (onAmountsChange) {
      const amt0 = parseFloat(increaseAmount0 || "0");
      const amt1 = parseFloat(increaseAmount1 || "0");
      onAmountsChange(amt0, amt1);
    }
  }, [increaseAmount0, increaseAmount1, onAmountsChange]);

  const calculateIncreaseAmount = useCallback(async (inputAmount: string, inputSide: 'amount0' | 'amount1') => {
    const version = ++calcVersionRef.current;
    if (!position || !inputAmount || parseFloat(inputAmount) <= 0) {
      setIncreaseAmount0(inputSide === 'amount1' ? increaseAmount0 : "");
      setIncreaseAmount1(inputSide === 'amount0' ? increaseAmount1 : "");
      return;
    }

    setIsCalculating(true);
    try {
      const isOOR = currentPoolTick !== null && currentPoolTick !== undefined &&
                    (currentPoolTick < position.tickLower || currentPoolTick > position.tickUpper);
      if (isOOR) {
        inputSide === 'amount0' ? setIncreaseAmount1("0") : setIncreaseAmount0("0");
        setIsCalculating(false);
        return;
      }

      const token0Symbol = getTokenSymbolByAddress(position.token0.address);
      const token1Symbol = getTokenSymbolByAddress(position.token1.address);

      if (!token0Symbol || !token1Symbol) {
        const amount = calculateCorrespondingAmount(inputAmount, inputSide, position);
        inputSide === 'amount0' ? setIncreaseAmount1(amount) : setIncreaseAmount0(amount);
        setIsCalculating(false);
        return;
      }

      const { calculateLiquidityParameters } = await import('@/lib/liquidity-math');
      const result = await calculateLiquidityParameters({
        token0Symbol, token1Symbol, inputAmount,
        inputTokenSymbol: inputSide === 'amount0' ? token0Symbol : token1Symbol,
        userTickLower: position.tickLower,
        userTickUpper: position.tickUpper,
        chainId: chainId || 8453,
      });

      if (version === calcVersionRef.current) {
        const decimals = TOKEN_DEFINITIONS[inputSide === 'amount0' ? token1Symbol : token0Symbol]?.decimals || 18;
        const amount = formatUnits(BigInt(result[inputSide === 'amount0' ? 'amount1' : 'amount0'] || '0'), decimals);
        inputSide === 'amount0' ? setIncreaseAmount1(amount) : setIncreaseAmount0(amount);
      }
    } catch (e) {
      const fallback = calculateCorrespondingAmount(inputAmount, inputSide, position);
      if (version === calcVersionRef.current) {
        inputSide === 'amount0' ? setIncreaseAmount1(fallback) : setIncreaseAmount0(fallback);
      }
    } finally {
      if (version === calcVersionRef.current) setIsCalculating(false);
    }
  }, [position, chainId, increaseAmount0, increaseAmount1]);

  const handleIncreaseAmountChangeWithWiggle = (e: React.ChangeEvent<HTMLInputElement>, side: 'amount0' | 'amount1') => {
    const sanitized = sanitizeDecimalInput(e.target.value);
    if (side === 'amount0') {
      setIncreaseAmount0(sanitized);
    } else {
      setIncreaseAmount1(sanitized);
    }
  };

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

        const tokenDef = TOKEN_DEFINITIONS[token.symbol];
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
          approvalTokenAddress: TOKEN_DEFINITIONS[needsApproval[0]]?.address,
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
          approvalTokenAddress: TOKEN_DEFINITIONS[nextToken]?.address,
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
                  {formatCalculatedAmount(parseFloat(increaseAmount0 || "0") * getUSDPriceForSymbol(position.token0.symbol, allPrices))}
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
                  {formatCalculatedAmount(parseFloat(increaseAmount1 || "0") * getUSDPriceForSymbol(position.token1.symbol, allPrices))}
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
              href={`https://sepolia.basescan.org/tx/${externalTxHash || increaseTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:underline"
            >
              View on Explorer
            </a>
          )}
        </div>
        <Button
          className="w-full text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"
          onClick={() => onSuccess()}
        >
          Continue
        </Button>
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
      <h3 className="text-base font-semibold">Add Liquidity</h3>

      {/* Token 0 Input */}
      <div>
        <motion.div
          className="group rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 space-y-3"
          animate={wiggleControls0}
        >
          <div className="flex items-center justify-between">
            <Label htmlFor="increase-amount0" className="text-sm font-medium">Add</Label>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
              onClick={() => handleToken0Percentage(100)}
              disabled={!canAddToken0}
            >
{token0BalanceData?.formatted || "0"} {position.token0.symbol}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
              <Image src={getTokenIcon(position.token0.symbol)} alt={position.token0.symbol} width={20} height={20} className="rounded-full" />
              <span className="text-sm font-medium">{position.token0.symbol}</span>
            </div>
            <div className="flex-1">
              <Input
                id="increase-amount0"
                placeholder="0.0"
                value={increaseAmount0}
                disabled={!canAddToken0}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="decimal"
                enterKeyHint="done"
                onChange={(e) => {
                  handleIncreaseAmountChangeWithWiggle(e, 'amount0');
                  const newAmount = sanitizeDecimalInput(e.target.value);
                  if (newAmount && parseFloat(newAmount) > 0) {
                    calculateIncreaseAmount(newAmount, 'amount0');
                  }
                }}
                className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
              />
              <div className="relative text-right text-xs min-h-5">
                <div className={cn("text-muted-foreground transition-opacity duration-100", {
                  "group-hover:opacity-0": token0BalanceData && parseFloat(token0BalanceData.formatted || "0") > 0 && canAddToken0
                })}>
                  {formatCalculatedAmount(parseFloat(increaseAmount0 || "0") * getUSDPriceForSymbol(position.token0.symbol, allPrices))}
                </div>
                {token0BalanceData && parseFloat(token0BalanceData.formatted || "0") > 0 && canAddToken0 && (
                  <div className="absolute right-0 top-[3px] flex gap-1 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100">
                    {PERCENTAGE_OPTIONS.map((percentage, index) => (
                      <motion.div
                        key={percentage}
                        className="opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0"
                        style={{
                          transitionDelay: `${index * 40}ms`,
                          transitionDuration: '200ms',
                          transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-5 px-2 text-[10px] font-medium rounded-md border-sidebar-border bg-muted/20 hover:bg-muted/40 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Get the calculated value from the percentage handler
                            const calculatedValue = handleToken0Percentage(percentage);
                            // Trigger API calculation with the new value
                            if (calculatedValue && parseFloat(calculatedValue) > 0) {
                              calculateIncreaseAmount(calculatedValue, 'amount0');
                            }
                          }}
                        >
                          {percentage === 100 ? 'MAX' : `${percentage}%`}
                        </Button>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="flex justify-center items-center">
        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
          <PlusIcon className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {/* Token 1 Input */}
      <div>
        <motion.div
          className="group rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 space-y-3"
          animate={wiggleControls1}
        >
          <div className="flex items-center justify-between">
            <Label htmlFor="increase-amount1" className="text-sm font-medium">Add</Label>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
              onClick={() => handleToken1Percentage(100)}
              disabled={!canAddToken1}
            >
{token1BalanceData?.formatted || "0"} {position.token1.symbol}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
              <Image src={getTokenIcon(position.token1.symbol)} alt={position.token1.symbol} width={20} height={20} className="rounded-full" />
              <span className="text-sm font-medium">{position.token1.symbol}</span>
            </div>
            <div className="flex-1">
              <Input
                id="increase-amount1"
                placeholder="0.0"
                value={increaseAmount1}
                disabled={!canAddToken1}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="decimal"
                enterKeyHint="done"
                onChange={(e) => {
                  handleIncreaseAmountChangeWithWiggle(e, 'amount1');
                  const newAmount = sanitizeDecimalInput(e.target.value);
                  if (newAmount && parseFloat(newAmount) > 0) {
                    calculateIncreaseAmount(newAmount, 'amount1');
                  }
                }}
                className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
              />
              <div className="relative text-right text-xs min-h-5">
                <div className={cn("text-muted-foreground transition-opacity duration-100", {
                  "group-hover:opacity-0": token1BalanceData && parseFloat(token1BalanceData.formatted || "0") > 0 && canAddToken1
                })}>
                  {formatCalculatedAmount(parseFloat(increaseAmount1 || "0") * getUSDPriceForSymbol(position.token1.symbol, allPrices))}
                </div>
                {token1BalanceData && parseFloat(token1BalanceData.formatted || "0") > 0 && canAddToken1 && (
                  <div className="absolute right-0 top-[3px] flex gap-1 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100">
                    {PERCENTAGE_OPTIONS.map((percentage, index) => (
                      <motion.div
                        key={percentage}
                        className="opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0"
                        style={{
                          transitionDelay: `${index * 40}ms`,
                          transitionDuration: '200ms',
                          transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)'
                        }}
                      >
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-5 px-2 text-[10px] font-medium rounded-md border-sidebar-border bg-muted/20 hover:bg-muted/40 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            // Get the calculated value from the percentage handler
                            const calculatedValue = handleToken1Percentage(percentage);
                            // Trigger API calculation with the new value
                            if (calculatedValue && parseFloat(calculatedValue) > 0) {
                              calculateIncreaseAmount(calculatedValue, 'amount1');
                            }
                          }}
                        >
                          {percentage === 100 ? 'MAX' : `${percentage}%`}
                        </Button>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <Button
        id={hideContinueButton ? "formpanel-hidden-continue" : undefined}
        onClick={handleContinue}
        disabled={parseFloat(increaseAmount0 || "0") <= 0 && parseFloat(increaseAmount1 || "0") <= 0}
        className={cn(
          (parseFloat(increaseAmount0 || "0") <= 0 && parseFloat(increaseAmount1 || "0") <= 0) ?
            "w-full relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75" :
            "w-full text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90",
          hideContinueButton && "hidden"
        )}
        style={(parseFloat(increaseAmount0 || "0") <= 0 && parseFloat(increaseAmount1 || "0") <= 0) ?
          { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } :
          undefined
        }
      >
        Continue
      </Button>
    </div>
  );
}
