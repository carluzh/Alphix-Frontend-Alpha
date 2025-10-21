"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { PlusIcon, BadgeCheck, OctagonX, Info as InfoIcon, RefreshCw as RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import Image from "next/image";
import { useAccount, useBalance, useSignTypedData, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";
import { usePercentageInput } from "@/hooks/usePercentageInput";
import { TOKEN_DEFINITIONS, TokenSymbol, getToken } from "@/lib/pools-config";
import { useIncreaseLiquidity, type IncreasePositionData } from "./useIncreaseLiquidity";
import { motion, useAnimation } from "framer-motion";
import { parseUnits as viemParseUnits } from "viem";
import type { ProcessedPosition } from "../../pages/api/liquidity/get-positions";
import { useAllPrices } from "@/components/data/hooks";
import { formatUSD } from "@/lib/format";
import { sanitizeDecimalInput, cn } from "@/lib/utils";
import { preparePermit2BatchForNewPosition } from '@/lib/liquidity-utils';
import { providePreSignedIncreaseBatchPermit } from './useIncreaseLiquidity';

interface AddLiquidityFormPanelProps {
  position: ProcessedPosition;
  feesForIncrease?: { amount0: string; amount1: string; } | null;
  onSuccess: () => void;
  onAmountsChange?: (amount0: number, amount1: number) => void;
  hideContinueButton?: boolean;
}

const getTokenIcon = (symbol?: string) => {
  if (!symbol) return "/placeholder-logo.svg";
  const tokenConfig = getToken(symbol);
  return tokenConfig?.icon || "/placeholder-logo.svg";
};

const formatCalculatedAmount = (value: number): React.ReactNode => {
  if (!Number.isFinite(value) || value <= 0) return formatUSD(0);

  const formatted = formatUSD(value);

  const match = formatted.match(/\$([0-9,]+\.?[0-9]*)/);
  if (!match) return formatted;

  const [, numericPart] = match;
  const [integerPart, decimalPart] = numericPart.split('.');

  if (!decimalPart || decimalPart.length <= 9) {
    return formatted;
  }

  const truncatedDecimal = decimalPart.substring(0, 9);
  const truncatedFormatted = `$${integerPart}.${truncatedDecimal}`;

  return (
    <span>
      {truncatedFormatted}
      <span className="text-muted-foreground">...</span>
    </span>
  );
};

export function AddLiquidityFormPanel({
  position,
  feesForIncrease,
  onSuccess,
  onAmountsChange,
  hideContinueButton = false
}: AddLiquidityFormPanelProps) {
  const { address: accountAddress, chainId } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { data: incApproveHash, writeContractAsync: approveERC20Async, reset: resetIncreaseApprove } = useWriteContract();
  const { isLoading: isIncreaseApproving, isSuccess: isIncreaseApproved } = useWaitForTransactionReceipt({ hash: incApproveHash });
  const { data: allPrices } = useAllPrices();

  const [increaseAmount0, setIncreaseAmount0] = useState<string>("");
  const [increaseAmount1, setIncreaseAmount1] = useState<string>("");
  const [increaseActiveInputSide, setIncreaseActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
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

  const wiggleControls0 = useAnimation();
  const wiggleControls1 = useAnimation();

  const getUSDPriceForSymbol = useCallback((symbol?: string): number => {
    if (!symbol) return 0;
    const s = symbol.toUpperCase();
    if (s.includes('BTC')) return allPrices?.BTC?.usd ?? 0;
    if (s.includes('ETH')) return allPrices?.ETH?.usd ?? 0;
    if (s.includes('USDC')) return allPrices?.USDC?.usd ?? 1;
    if (s.includes('USDT')) return allPrices?.USDT?.usd ?? 1;
    return 0;
  }, [allPrices]);

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
      setShowSuccessView(true);
      onSuccess();
    }
  });

  // Notify parent of amount changes for preview
  useEffect(() => {
    if (onAmountsChange) {
      const amt0 = parseFloat(increaseAmount0 || "0");
      const amt1 = parseFloat(increaseAmount1 || "0");
      onAmountsChange(amt0, amt1);
    }
  }, [increaseAmount0, increaseAmount1, onAmountsChange]);

  const calculateIncreaseAmount = useCallback((inputAmount: string, inputSide: 'amount0' | 'amount1') => {
    // Simplified - in real version, calculate based on position ratio
    // For now, just mirror the input
    if (inputSide === 'amount0') {
      setIncreaseAmount1(inputAmount);
    } else {
      setIncreaseAmount0(inputAmount);
    }
  }, []);

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
    // Simplified prepare logic - check allowances
    setIncreaseStep('permit');
  };

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
    if (increaseStep === 'permit') {
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
        console.error('[AddLiquidityFormPanel] increaseLiquidity call threw', e);
      }
    }
  };

  // Success view
  if (showSuccessView) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-6">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10">
          <BadgeCheck className="w-8 h-8 text-green-500" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold">Liquidity Added!</h3>
          <p className="text-sm text-muted-foreground">
            Your position has been successfully increased
          </p>
        </div>
        {increaseTxHash && (
          <a
            href={`https://ftmscan.com/tx/${increaseTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            View on Explorer
          </a>
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
                  <span className={`text-xs font-mono ${increaseCompletedERC20ApprovalsCount === increaseInvolvedTokensCount && increaseInvolvedTokensCount > 0 ? 'text-green-500' : 'text-muted-foreground'}`}>
                    {`${increaseCompletedERC20ApprovalsCount}/${increaseInvolvedTokensCount > 0 ? increaseInvolvedTokensCount : '-'}`}
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
            disabled={increaseIsWorking || isIncreasingLiquidity}
          >
            <span className={increaseIsWorking || isIncreasingLiquidity ? "animate-pulse" : ""}>
              {increaseIsWorking || isIncreasingLiquidity ? "Processing..." : increaseStep === 'permit' ? "Sign Permit" : "Add Liquidity"}
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
              className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer"
              onClick={() => handleToken0Percentage(100)}
            >
              Balance: {token0BalanceData?.formatted || "0"} {position.token0.symbol}
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
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="decimal"
                enterKeyHint="done"
                onChange={(e) => {
                  handleIncreaseAmountChangeWithWiggle(e, 'amount0');
                  setIncreaseActiveInputSide('amount0');
                  const newAmount = sanitizeDecimalInput(e.target.value);
                  if (newAmount && parseFloat(newAmount) > 0) {
                    calculateIncreaseAmount(newAmount, 'amount0');
                  }
                }}
                className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
              />
              <div className="relative text-right text-xs min-h-5">
                <div className={cn("text-muted-foreground transition-opacity duration-100", {
                  "group-hover:opacity-0": token0BalanceData && parseFloat(token0BalanceData.formatted || "0") > 0
                })}>
                  {formatCalculatedAmount(parseFloat(increaseAmount0 || "0") * getUSDPriceForSymbol(position.token0.symbol))}
                </div>
                {token0BalanceData && parseFloat(token0BalanceData.formatted || "0") > 0 && (
                  <div className="absolute right-0 top-[3px] flex gap-1 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100">
                    {[25, 50, 75, 100].map((percentage, index) => (
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
                            handleToken0Percentage(percentage);
                            setIncreaseActiveInputSide('amount0');
                            setTimeout(() => {
                              if (increaseAmount0 && parseFloat(increaseAmount0) > 0) {
                                calculateIncreaseAmount(increaseAmount0, 'amount0');
                              }
                            }, 0);
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
              className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer"
              onClick={() => handleToken1Percentage(100)}
            >
              Balance: {token1BalanceData?.formatted || "0"} {position.token1.symbol}
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
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="decimal"
                enterKeyHint="done"
                onChange={(e) => {
                  handleIncreaseAmountChangeWithWiggle(e, 'amount1');
                  setIncreaseActiveInputSide('amount1');
                  const newAmount = sanitizeDecimalInput(e.target.value);
                  if (newAmount && parseFloat(newAmount) > 0) {
                    calculateIncreaseAmount(newAmount, 'amount1');
                  }
                }}
                className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
              />
              <div className="relative text-right text-xs min-h-5">
                <div className={cn("text-muted-foreground transition-opacity duration-100", {
                  "group-hover:opacity-0": token1BalanceData && parseFloat(token1BalanceData.formatted || "0") > 0
                })}>
                  {formatCalculatedAmount(parseFloat(increaseAmount1 || "0") * getUSDPriceForSymbol(position.token1.symbol))}
                </div>
                {token1BalanceData && parseFloat(token1BalanceData.formatted || "0") > 0 && (
                  <div className="absolute right-0 top-[3px] flex gap-1 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100">
                    {[25, 50, 75, 100].map((percentage, index) => (
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
                            handleToken1Percentage(percentage);
                            setIncreaseActiveInputSide('amount1');
                            setTimeout(() => {
                              if (increaseAmount1 && parseFloat(increaseAmount1) > 0) {
                                calculateIncreaseAmount(increaseAmount1, 'amount1');
                              }
                            }, 0);
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
