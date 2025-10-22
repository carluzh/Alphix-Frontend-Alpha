"use client";

import React, { useState, useEffect, useCallback } from "react";
import { PlusIcon, BadgeCheck, OctagonX, RefreshCw as RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Image from "next/image";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { TOKEN_DEFINITIONS, TokenSymbol } from "@/lib/pools-config";
import { useDecreaseLiquidity, type DecreasePositionData } from "./useDecreaseLiquidity";
import { motion, useAnimation } from "framer-motion";
import type { ProcessedPosition } from "../../pages/api/liquidity/get-positions";
import { useAllPrices } from "@/components/data/hooks";
import { sanitizeDecimalInput, cn } from "@/lib/utils";
import { calculatePercentageFromString } from "@/hooks/usePercentageInput";
import {
  getTokenIcon,
  formatTokenDisplayAmount,
  formatCalculatedAmount,
  getUSDPriceForSymbol,
  calculateCorrespondingAmount,
  PERCENTAGE_OPTIONS
} from './liquidity-form-utils';

interface RemoveLiquidityFormPanelProps {
  position: ProcessedPosition;
  feesForWithdraw?: { amount0: string; amount1: string; } | null;
  onSuccess: () => void;
  onAmountsChange?: (amount0: number, amount1: number) => void;
  hideContinueButton?: boolean;
}

export function RemoveLiquidityFormPanel({
  position,
  feesForWithdraw,
  onSuccess,
  onAmountsChange,
  hideContinueButton = false
}: RemoveLiquidityFormPanelProps) {
  const { address: accountAddress } = useAccount();
  const { data: allPrices } = useAllPrices();

  const [withdrawAmount0, setWithdrawAmount0] = useState<string>("");
  const [withdrawAmount1, setWithdrawAmount1] = useState<string>("");
  const [withdrawActiveInputSide, setWithdrawActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isFullWithdraw, setIsFullWithdraw] = useState(false);
  const [showTransactionOverview, setShowTransactionOverview] = useState(false);
  const [showSuccessView, setShowSuccessView] = useState(false);

  const wiggleControls0 = useAnimation();
  const wiggleControls1 = useAnimation();

  const { decreaseLiquidity, isLoading: isDecreasingLiquidity, isSuccess: isDecreaseSuccess, hash: decreaseTxHash } = useDecreaseLiquidity({
    onLiquidityDecreased: (info) => {
      // Only set success view - don't call onSuccess() yet
      // onSuccess() will be called when user clicks "Done" button in success view
      setShowSuccessView(true);
    }
  });

  // Notify parent of amount changes for preview
  useEffect(() => {
    if (onAmountsChange) {
      const amt0 = parseFloat(withdrawAmount0 || "0");
      const amt1 = parseFloat(withdrawAmount1 || "0");
      onAmountsChange(amt0, amt1);
    }
  }, [withdrawAmount0, withdrawAmount1, onAmountsChange]);

  const calculateWithdrawAmount = useCallback((inputAmount: string, inputSide: 'amount0' | 'amount1') => {
    if (!inputAmount || parseFloat(inputAmount) <= 0) {
      if (inputSide === 'amount0') setWithdrawAmount1("");
      else setWithdrawAmount0("");
      setIsFullWithdraw(false);
      return;
    }

    const correspondingAmount = calculateCorrespondingAmount(inputAmount, inputSide, position);

    if (inputSide === 'amount0') {
      setWithdrawAmount1(correspondingAmount);
      // Check if this is a full withdraw (within 0.1% tolerance)
      const percentage = (parseFloat(inputAmount) / parseFloat(position.token0.amount)) * 100;
      setIsFullWithdraw(percentage >= 99.9);
    } else {
      setWithdrawAmount0(correspondingAmount);
      const percentage = (parseFloat(inputAmount) / parseFloat(position.token1.amount)) * 100;
      setIsFullWithdraw(percentage >= 99.9);
    }
  }, [position]);

  const handleWithdrawAmountChangeWithWiggle = (e: React.ChangeEvent<HTMLInputElement>, side: 'amount0' | 'amount1') => {
    const sanitized = sanitizeDecimalInput(e.target.value);
    if (side === 'amount0') {
      setWithdrawAmount0(sanitized);
    } else {
      setWithdrawAmount1(sanitized);
    }
  };

  const handleMaxWithdraw = (side: 'amount0' | 'amount1') => {
    if (side === 'amount0') {
      setWithdrawAmount0(position.token0.amount);
      setWithdrawAmount1(position.token1.amount);
    } else {
      setWithdrawAmount1(position.token1.amount);
      setWithdrawAmount0(position.token0.amount);
    }
    setIsFullWithdraw(true);
  };

  const handleContinue = () => {
    setShowTransactionOverview(true);
  };

  const handleExecuteTransaction = async () => {
    const posAmount0 = parseFloat(position.token0.amount);
    const withdrawAmt0 = parseFloat(withdrawAmount0 || "0");
    const percentage = posAmount0 > 0 ? (withdrawAmt0 / posAmount0) * 100 : 100;

    const data: DecreasePositionData = {
      tokenId: position.positionId,
      token0Symbol: position.token0.symbol as TokenSymbol,
      token1Symbol: position.token1.symbol as TokenSymbol,
      decreaseAmount0: withdrawAmount0 || '0',
      decreaseAmount1: withdrawAmount1 || '0',
      isFullBurn: isFullWithdraw,
      poolId: position.poolId,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
    };

    try {
      decreaseLiquidity(data, percentage);
    } catch (e) {
      console.error('[RemoveLiquidityFormPanel] decreaseLiquidity call threw', e);
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
          <h3 className="text-lg font-semibold">Liquidity Removed!</h3>
          <p className="text-sm text-muted-foreground">
            Your position has been successfully decreased
          </p>
        </div>
        {decreaseTxHash && (
          <a
            href={`https://ftmscan.com/tx/${decreaseTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            View on Explorer
          </a>
        )}
        <Button
          className="w-full text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"
          onClick={() => {
            // Call onSuccess to close modal and trigger parent refresh
            onSuccess();
          }}
        >
          Done
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
            {/* Withdrawal Transaction */}
            <div className="flex items-center justify-between">
              <span>Withdrawal Transaction</span>
              <span>
                {isDecreasingLiquidity ? (
                  <RefreshCwIcon className="h-4 w-4 animate-spin" />
                ) : (
                  <span className={`text-xs font-mono ${isDecreaseSuccess ? 'text-green-500' : 'text-muted-foreground'}`}>
                    {isDecreaseSuccess ? '1/1' : '0/1'}
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
            disabled={isDecreasingLiquidity}
            style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            Back
          </Button>

          <Button
            className="text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"
            onClick={handleExecuteTransaction}
            disabled={isDecreasingLiquidity}
          >
            <span className={isDecreasingLiquidity ? "animate-pulse" : ""}>
              {isDecreasingLiquidity ? "Processing..." : "Remove Liquidity"}
            </span>
          </Button>
        </div>
      </div>
    );
  }

  // Input view
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold">Remove Liquidity</h3>

      {position.isInRange ? (
        <>
          {/* Token 0 Input */}
          <div>
            <motion.div
              className="group rounded-lg bg-muted/30 border border-sidebar-border/60 p-4 space-y-3"
              animate={wiggleControls0}
            >
              <div className="flex items-center justify-between">
                <Label htmlFor="withdraw-amount0" className="text-sm font-medium">Withdraw</Label>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer"
                  onClick={() => handleMaxWithdraw('amount0')}
                >
                  Balance: {formatTokenDisplayAmount(position.token0.amount, position.token0.symbol as TokenSymbol)} {position.token0.symbol}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                  <Image src={getTokenIcon(position.token0.symbol)} alt={position.token0.symbol} width={20} height={20} className="rounded-full" />
                  <span className="text-sm font-medium">{position.token0.symbol}</span>
                </div>
                <div className="flex-1">
                  <Input
                    id="withdraw-amount0"
                    placeholder="0.0"
                    value={withdrawAmount0}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode="decimal"
                    enterKeyHint="done"
                    onChange={(e) => {
                      handleWithdrawAmountChangeWithWiggle(e, 'amount0');
                      setWithdrawActiveInputSide('amount0');
                      const newAmount = sanitizeDecimalInput(e.target.value);
                      if (newAmount && parseFloat(newAmount) > 0) {
                        calculateWithdrawAmount(newAmount, 'amount0');
                      }
                    }}
                    className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                  />
                  <div className="relative text-right text-xs min-h-5">
                    <div className={cn("text-muted-foreground transition-opacity duration-100", {
                      "group-hover:opacity-0": parseFloat(position.token0.amount) > 0
                    })}>
                      {formatCalculatedAmount(parseFloat(withdrawAmount0 || "0") * getUSDPriceForSymbol(position.token0.symbol, allPrices))}
                    </div>
                    {parseFloat(position.token0.amount) > 0 && (
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
                                const token0Decimals = TOKEN_DEFINITIONS[position.token0.symbol as TokenSymbol]?.decimals || 18;
                                const amount = calculatePercentageFromString(position.token0.amount, percentage, token0Decimals);
                                const syntheticEvent = {
                                  target: { value: amount }
                                } as React.ChangeEvent<HTMLInputElement>;
                                handleWithdrawAmountChangeWithWiggle(syntheticEvent, 'amount0');
                                setWithdrawActiveInputSide('amount0');
                                if (amount && parseFloat(amount) > 0) {
                                  calculateWithdrawAmount(amount, 'amount0');
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
                <Label htmlFor="withdraw-amount1" className="text-sm font-medium">Withdraw</Label>
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer"
                  onClick={() => handleMaxWithdraw('amount1')}
                >
                  Balance: {formatTokenDisplayAmount(position.token1.amount, position.token1.symbol as TokenSymbol)} {position.token1.symbol}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
                  <Image src={getTokenIcon(position.token1.symbol)} alt={position.token1.symbol} width={20} height={20} className="rounded-full" />
                  <span className="text-sm font-medium">{position.token1.symbol}</span>
                </div>
                <div className="flex-1">
                  <Input
                    id="withdraw-amount1"
                    placeholder="0.0"
                    value={withdrawAmount1}
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode="decimal"
                    enterKeyHint="done"
                    onChange={(e) => {
                      handleWithdrawAmountChangeWithWiggle(e, 'amount1');
                      setWithdrawActiveInputSide('amount1');
                      const newAmount = sanitizeDecimalInput(e.target.value);
                      if (newAmount && parseFloat(newAmount) > 0) {
                        calculateWithdrawAmount(newAmount, 'amount1');
                      }
                    }}
                    className="border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto"
                  />
                  <div className="relative text-right text-xs min-h-5">
                    <div className={cn("text-muted-foreground transition-opacity duration-100", {
                      "group-hover:opacity-0": parseFloat(position.token1.amount) > 0
                    })}>
                      {formatCalculatedAmount(parseFloat(withdrawAmount1 || "0") * getUSDPriceForSymbol(position.token1.symbol, allPrices))}
                    </div>
                    {parseFloat(position.token1.amount) > 0 && (
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
                                const token1Decimals = TOKEN_DEFINITIONS[position.token1.symbol as TokenSymbol]?.decimals || 18;
                                const amount = calculatePercentageFromString(position.token1.amount, percentage, token1Decimals);
                                const syntheticEvent = {
                                  target: { value: amount }
                                } as React.ChangeEvent<HTMLInputElement>;
                                handleWithdrawAmountChangeWithWiggle(syntheticEvent, 'amount1');
                                setWithdrawActiveInputSide('amount1');
                                if (amount && parseFloat(amount) > 0) {
                                  calculateWithdrawAmount(amount, 'amount1');
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
        </>
      ) : (
        <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
          <p className="text-sm text-yellow-500">
            Position is out of range. Withdraw all liquidity to close position.
          </p>
        </div>
      )}

      <Button
        id={hideContinueButton ? "formpanel-hidden-continue" : undefined}
        onClick={handleContinue}
        disabled={!withdrawAmount0 || !withdrawAmount1 || parseFloat(withdrawAmount0) <= 0 || parseFloat(withdrawAmount1) <= 0}
        className={cn(
          (!withdrawAmount0 || !withdrawAmount1 || parseFloat(withdrawAmount0) <= 0 || parseFloat(withdrawAmount1) <= 0) ?
            "w-full relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75" :
            "w-full text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90",
          hideContinueButton && "hidden"
        )}
        style={(!withdrawAmount0 || !withdrawAmount1 || parseFloat(withdrawAmount0) <= 0 || parseFloat(withdrawAmount1) <= 0) ?
          { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } :
          undefined
        }
      >
        Continue
      </Button>
    </div>
  );
}
