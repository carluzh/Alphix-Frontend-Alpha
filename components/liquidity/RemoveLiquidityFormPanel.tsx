"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { PlusIcon, BadgeCheck, RefreshCw as RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccount } from "wagmi";
import { getTokenDefinitions, TokenSymbol } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { getExplorerTxUrl } from "@/lib/wagmiConfig";
import { useDecreaseLiquidity, type DecreasePositionData } from "@/lib/liquidity/hooks";
import { useAnimation } from "framer-motion";
import type { ProcessedPosition } from "../../pages/api/liquidity/get-positions";
import { cn, debounce, getTokenSymbolByAddress } from "@/lib/utils";
import { calculatePercentageFromString } from "@/hooks/usePercentageInput";
import { formatUnits } from "viem";
import {
  formatTokenDisplayAmount,
  formatCalculatedAmount,
} from './liquidity-form-utils';
import { useTokenUSDPrice } from "@/hooks/useTokenUSDPrice";
import { TokenInputCard, TokenInputStyles } from './TokenInputCard';

interface RemoveLiquidityFormPanelProps {
  position: ProcessedPosition;
  feesForWithdraw?: { amount0: string; amount1: string; } | null;
  onSuccess: () => void;
  onAmountsChange?: (amount0: number, amount1: number) => void;
  hideContinueButton?: boolean;
  externalIsSuccess?: boolean;
  externalTxHash?: string;
  onLiquidityDecreased?: (info?: { txHash?: `0x${string}`; blockNumber?: bigint; isFullBurn?: boolean }) => void;
}

export function RemoveLiquidityFormPanel({
  position,
  feesForWithdraw,
  onSuccess,
  onAmountsChange,
  hideContinueButton = false,
  externalIsSuccess = false,
  externalTxHash,
  onLiquidityDecreased: onLiquidityDecreasedProp
}: RemoveLiquidityFormPanelProps) {
  const { address: accountAddress } = useAccount();
  const { chainId, networkMode } = useNetwork();
  // Always use network context chainId for queries (not wallet chainId)
  const tokenDefinitions = React.useMemo(() => getTokenDefinitions(networkMode), [networkMode]);

  // USD prices using mid-price quotes (replaces deprecated useAllPrices)
  const { price: token0USDPrice } = useTokenUSDPrice(position.token0.symbol as TokenSymbol);
  const { price: token1USDPrice } = useTokenUSDPrice(position.token1.symbol as TokenSymbol);

  const [withdrawAmount0, setWithdrawAmount0] = useState<string>("");
  const [withdrawAmount1, setWithdrawAmount1] = useState<string>("");
  const [withdrawActiveInputSide, setWithdrawActiveInputSide] = useState<'amount0' | 'amount1' | null>(null);
  const [isFullWithdraw, setIsFullWithdraw] = useState(false);
  const [showTransactionOverview, setShowTransactionOverview] = useState(false);
  const [showSuccessView, setShowSuccessView] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [canWithdrawToken0, setCanWithdrawToken0] = useState(true);
  const [canWithdrawToken1, setCanWithdrawToken1] = useState(true);

  const wiggleControls0 = useAnimation();
  const wiggleControls1 = useAnimation();
  const [isAmount0OverBalance, setIsAmount0OverBalance] = useState(false);
  const [isAmount1OverBalance, setIsAmount1OverBalance] = useState(false);

  // Calculate which side is productive for out-of-range positions
  const withdrawProductiveSide = React.useMemo(() => {
    if (!position || position.isInRange) return null;

    const amt0 = parseFloat(position.token0?.amount || '0');
    const amt1 = parseFloat(position.token1?.amount || '0');

    if (amt0 > 0 && amt1 <= 0) return 'amount0';
    if (amt1 > 0 && amt0 <= 0) return 'amount1';
    return null; // Both sides have amounts
  }, [position]);

  // Set which tokens can be withdrawn based on position range
  useEffect(() => {
    if (!position) return;

    if (position.isInRange) {
      // In range: both tokens can be withdrawn
      setCanWithdrawToken0(true);
      setCanWithdrawToken1(true);
    } else {
      // Out of range: only tokens with actual amounts
      const amt0 = parseFloat(position.token0?.amount || '0');
      const amt1 = parseFloat(position.token1?.amount || '0');
      setCanWithdrawToken0(amt0 > 0);
      setCanWithdrawToken1(amt1 > 0);
    }
  }, [position]);

  const { decreaseLiquidity, isLoading: isDecreasingLiquidity, isSuccess: isDecreaseSuccess, hash: decreaseTxHash } = useDecreaseLiquidity({
    onLiquidityDecreased: (info) => {
      // Only set success view - don't call onSuccess() yet
      // onSuccess() will be called when user clicks "Done" button in success view
      setShowSuccessView(true);

      // Forward to parent callback for optimistic updates
      if (onLiquidityDecreasedProp) {
        onLiquidityDecreasedProp(info);
      }
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

  // Versioning for calculation debounce
  const withdrawCalcVersionRef = useRef(0);

  // Format calculated input values (non-USD) with max 9 decimals
  const formatCalculatedInput = useCallback((value: string): string => {
    if (!value) return value;

    const [integerPart, decimalPart] = value.split('.');

    if (!decimalPart || decimalPart.length <= 9) {
      return value;
    }

    // Truncate to 9 decimals (no ellipsis for input fields)
    return `${integerPart}.${decimalPart.substring(0, 9)}`;
  }, []);

  const calculateWithdrawAmount = useCallback(
    debounce(async (inputAmount: string, inputSide: 'amount0' | 'amount1') => {
      const version = ++withdrawCalcVersionRef.current;

      if (!position || !inputAmount || parseFloat(inputAmount) <= 0) {
        if (inputSide === 'amount0') setWithdrawAmount1("");
        else setWithdrawAmount0("");
        return;
      }

      setIsCalculating(true);

      try {
        // For out-of-range positions, use single-token approach
        if (!position.isInRange) {
          if (inputSide === 'amount0') {
            setWithdrawAmount1("0");
          } else {
            setWithdrawAmount0("0");
          }
          setIsCalculating(false);
          return;
        }

        // For in-range positions, use proper liquidity calculation API
        const token0Symbol = getTokenSymbolByAddress(position.token0.address, networkMode);
        const token1Symbol = getTokenSymbolByAddress(position.token1.address, networkMode);

        if (!token0Symbol || !token1Symbol) {
          // Fallback to simple ratio if token mapping fails
          const amount0Total = parseFloat(position.token0.amount);
          const amount1Total = parseFloat(position.token1.amount);
          const inputAmountNum = parseFloat(inputAmount);

          if (inputSide === 'amount0') {
            const ratio = inputAmountNum / amount0Total;
            const calculatedAmount1 = amount1Total * ratio;
            if (version === withdrawCalcVersionRef.current) {
              setWithdrawAmount1(calculatedAmount1.toString());
            }
          } else {
            const ratio = inputAmountNum / amount1Total;
            const calculatedAmount0 = amount0Total * ratio;
            if (version === withdrawCalcVersionRef.current) {
              setWithdrawAmount0(calculatedAmount0.toString());
            }
          }
          return;
        }

        const { calculateLiquidityParameters } = await import('@/lib/liquidity-math');
        const result = await calculateLiquidityParameters({
          token0Symbol,
          token1Symbol,
          inputAmount,
          inputTokenSymbol: inputSide === 'amount0' ? token0Symbol : token1Symbol,
          userTickLower: position.tickLower,
          userTickUpper: position.tickUpper,
          chainId,
        });

        if (version === withdrawCalcVersionRef.current) {
          if (inputSide === 'amount0') {
            // Convert from raw units to display units for token1 - keep full precision
            const token1Symbol = getTokenSymbolByAddress(position.token1.address, networkMode);
            const token1Decimals = token1Symbol ? tokenDefinitions[token1Symbol]?.decimals || 18 : 18;
            const amount1Display = formatUnits(BigInt(result.amount1 || '0'), token1Decimals);
            setWithdrawAmount1(formatCalculatedInput(amount1Display));
          } else {
            // Convert from raw units to display units for token0 - keep full precision
            const token0Symbol = getTokenSymbolByAddress(position.token0.address, networkMode);
            const token0Decimals = token0Symbol ? tokenDefinitions[token0Symbol]?.decimals || 18 : 18;
            const amount0Display = formatUnits(BigInt(result.amount0 || '0'), token0Decimals);
            setWithdrawAmount0(formatCalculatedInput(amount0Display));
          }
        }
      } catch (error) {
        console.error("Error calculating withdraw amount:", error);

        // Fallback to simple ratio calculation on API error
        try {
          const amount0Total = parseFloat(position.token0.amount);
          const amount1Total = parseFloat(position.token1.amount);
          const inputAmountNum = parseFloat(inputAmount);

          if (version === withdrawCalcVersionRef.current) {
            if (inputSide === 'amount0') {
              const ratio = inputAmountNum / amount0Total;
              const calculatedAmount1 = amount1Total * ratio;
              setWithdrawAmount1(calculatedAmount1.toString());
            } else {
              const ratio = inputAmountNum / amount1Total;
              const calculatedAmount0 = amount0Total * ratio;
              setWithdrawAmount0(calculatedAmount0.toString());
            }
          }
        } catch (fallbackError) {
          console.error("Fallback calculation also failed:", fallbackError);
        }
      } finally {
        if (version === withdrawCalcVersionRef.current) {
          setIsCalculating(false);
        }
      }
    }, 300),
    [position, formatCalculatedInput]
  );

  // Check if withdrawal amounts exceed position balance
  useEffect(() => {
    const amount0 = parseFloat(withdrawAmount0 || "0");
    const positionBalance0 = parseFloat(position?.token0?.amount || "0");
    setIsAmount0OverBalance(amount0 > positionBalance0 && amount0 > 0);
  }, [withdrawAmount0, position]);

  useEffect(() => {
    const amount1 = parseFloat(withdrawAmount1 || "0");
    const positionBalance1 = parseFloat(position?.token1?.amount || "0");
    setIsAmount1OverBalance(amount1 > positionBalance1 && amount1 > 0);
  }, [withdrawAmount1, position]);

  const handleMaxWithdraw = (side: 'amount0' | 'amount1') => {
    if (side === 'amount0') {
      setWithdrawAmount0(position.token0.amount);
      setWithdrawActiveInputSide('amount0');
      // Always trigger calculation to ensure quote fetching
      calculateWithdrawAmount(position.token0.amount, 'amount0');
    } else {
      setWithdrawAmount1(position.token1.amount);
      setWithdrawActiveInputSide('amount1');
      // Always trigger calculation to ensure quote fetching
      calculateWithdrawAmount(position.token1.amount, 'amount1');
    }
    setIsFullWithdraw(true);
  };

  const handleContinue = () => {
    setShowTransactionOverview(true);
  };

  const handleExecuteTransaction = async () => {
    const amt0 = parseFloat(withdrawAmount0 || '0');
    const amt1 = parseFloat(withdrawAmount1 || '0');
    const max0Eff = parseFloat(position.token0.amount || '0');
    const max1Eff = parseFloat(position.token1.amount || '0');
    const pct0 = max0Eff > 0 ? amt0 / max0Eff : 0;
    const pct1 = max1Eff > 0 ? amt1 / max1Eff : 0;
    const effectivePct = Math.max(pct0, pct1) * 100;
    const isExactly100 = (max0Eff > 0 ? Math.abs(pct0 - 1.0) < 0.0001 : true) && (max1Eff > 0 ? Math.abs(pct1 - 1.0) < 0.0001 : true);

    const data: DecreasePositionData = {
      tokenId: position.positionId,
      token0Symbol: position.token0.symbol as TokenSymbol,
      token1Symbol: position.token1.symbol as TokenSymbol,
      decreaseAmount0: withdrawAmount0 || '0',
      decreaseAmount1: withdrawAmount1 || '0',
      isFullBurn: isExactly100,
      poolId: position.poolId,
      tickLower: position.tickLower,
      tickUpper: position.tickUpper,
      enteredSide: withdrawActiveInputSide === 'amount0' ? 'token0' : withdrawActiveInputSide === 'amount1' ? 'token1' : undefined,
    };

    try {
      if (position.isInRange) {
        const pctRounded = isExactly100 ? 100 : Math.max(0, Math.min(100, Math.round(effectivePct)));
        decreaseLiquidity(data, pctRounded);
      } else {
        decreaseLiquidity(data, 0);
      }
    } catch (e) {}
  };

  // Success view - use external success state if provided, otherwise use internal state
  if (showSuccessView || externalIsSuccess) {
    return (
      <div className="flex flex-col items-center justify-center space-y-6">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10">
          <BadgeCheck className="w-8 h-8 text-green-500" />
        </div>
        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold">Liquidity Removed!</h3>
          <p className="text-sm text-muted-foreground">
            {(() => {
              const formatAmount = (amount: string) => {
                const num = parseFloat(amount || "0");
                if (num === 0) return "0";
                if (num < 0.000001) return "< 0.000001";
                return num.toFixed(6).replace(/\.?0+$/, '');
              };

              return `${formatAmount(withdrawAmount0)} ${position.token0.symbol} and ${formatAmount(withdrawAmount1)} ${position.token1.symbol}`;
            })()}
          </p>
        </div>
        {(externalTxHash || decreaseTxHash) && (
          <a
            href={getExplorerTxUrl(externalTxHash || decreaseTxHash || '')}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            View on Explorer
          </a>
        )}
        {!hideContinueButton && (
          <Button
            className="w-full text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90"
            onClick={() => {
              // Call onSuccess to trigger parent refresh and reset modal view
              onSuccess();
            }}
          >
            Done
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

  // Handler for percentage clicks with position amount
  const handleToken0Percentage = useCallback((percentage: number) => {
    const token0Decimals = tokenDefinitions[position.token0.symbol as TokenSymbol]?.decimals || 18;
    const amount = calculatePercentageFromString(position.token0.amount, percentage, token0Decimals);
    setWithdrawActiveInputSide('amount0');
    if (percentage === 100) {
      setIsFullWithdraw(true);
    }
    return amount;
  }, [position.token0.amount, position.token0.symbol, tokenDefinitions]);

  const handleToken1Percentage = useCallback((percentage: number) => {
    const token1Decimals = tokenDefinitions[position.token1.symbol as TokenSymbol]?.decimals || 18;
    const amount = calculatePercentageFromString(position.token1.amount, percentage, token1Decimals);
    setWithdrawActiveInputSide('amount1');
    if (percentage === 100) {
      setIsFullWithdraw(true);
    }
    return amount;
  }, [position.token1.amount, position.token1.symbol, tokenDefinitions]);

  // Handler for token0 input changes
  const handleToken0Change = useCallback((value: string) => {
    setWithdrawAmount0(value);
    setWithdrawActiveInputSide('amount0');

    // Check if this is a full withdraw
    if (value && parseFloat(value) > 0) {
      const maxAmount = parseFloat(position.token0.amount);
      const percentage = Math.min(100, (parseFloat(value) / maxAmount) * 100);
      setIsFullWithdraw(percentage >= 99);
    }
  }, [position.token0.amount]);

  // Handler for token1 input changes
  const handleToken1Change = useCallback((value: string) => {
    setWithdrawAmount1(value);
    setWithdrawActiveInputSide('amount1');

    // Check if this is a full withdraw
    if (value && parseFloat(value) > 0) {
      const maxAmount = parseFloat(position.token1.amount);
      const percentage = Math.min(100, (parseFloat(value) / maxAmount) * 100);
      setIsFullWithdraw(percentage >= 99);
    }
  }, [position.token1.amount]);

  // Input view
  return (
    <div className="space-y-4">
      <TokenInputStyles />
      <h3 className="text-base font-semibold">Remove Liquidity</h3>

      {position.isInRange ? (
        <>
          {/* Token 0 Input - In Range */}
          <TokenInputCard
            id="withdraw-amount0"
            tokenSymbol={position.token0.symbol}
            value={withdrawAmount0}
            onChange={handleToken0Change}
            label="Withdraw"
            maxAmount={position.token0.amount}
            balanceDisplay={formatTokenDisplayAmount(position.token0.amount, position.token0.symbol as TokenSymbol)}
            usdPrice={token0USDPrice || 0}
            formatUsdAmount={formatCalculatedAmount}
            isOverBalance={isAmount0OverBalance}
            animationControls={wiggleControls0}
            onPercentageClick={handleToken0Percentage}
            onCalculateDependentAmount={(value) => {
              if (parseFloat(value) > 0) {
                calculateWithdrawAmount(value, 'amount0');
              } else {
                setWithdrawAmount1("");
                setIsFullWithdraw(false);
              }
            }}
          />

          <div className="flex justify-center items-center">
            <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted/20">
              <PlusIcon className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          {/* Token 1 Input - In Range */}
          <TokenInputCard
            id="withdraw-amount1"
            tokenSymbol={position.token1.symbol}
            value={withdrawAmount1}
            onChange={handleToken1Change}
            label="Withdraw"
            maxAmount={position.token1.amount}
            balanceDisplay={formatTokenDisplayAmount(position.token1.amount, position.token1.symbol as TokenSymbol)}
            usdPrice={token1USDPrice || 0}
            formatUsdAmount={formatCalculatedAmount}
            isOverBalance={isAmount1OverBalance}
            animationControls={wiggleControls1}
            onPercentageClick={handleToken1Percentage}
            onCalculateDependentAmount={(value) => {
              if (parseFloat(value) > 0) {
                calculateWithdrawAmount(value, 'amount1');
              } else {
                setWithdrawAmount0("");
                setIsFullWithdraw(false);
              }
            }}
          />
        </>
      ) : (
        <>
          {/* Out-of-range: Single-sided inputs based on available liquidity */}
          {canWithdrawToken0 && parseFloat(position.token0.amount) > 0 && (
            <TokenInputCard
              id="withdraw-amount0-oor"
              tokenSymbol={position.token0.symbol}
              value={withdrawAmount0}
              onChange={handleToken0Change}
              label={`Withdraw ${position.token0.symbol}`}
              maxAmount={position.token0.amount}
              balanceDisplay={formatTokenDisplayAmount(position.token0.amount, position.token0.symbol as TokenSymbol)}
              usdPrice={token0USDPrice || 0}
              formatUsdAmount={formatCalculatedAmount}
              isOverBalance={isAmount0OverBalance}
              animationControls={wiggleControls0}
              onPercentageClick={handleToken0Percentage}
            />
          )}

          {canWithdrawToken1 && parseFloat(position.token1.amount) > 0 && (
            <TokenInputCard
              id="withdraw-amount1-oor"
              tokenSymbol={position.token1.symbol}
              value={withdrawAmount1}
              onChange={handleToken1Change}
              label={`Withdraw ${position.token1.symbol}`}
              maxAmount={position.token1.amount}
              balanceDisplay={formatTokenDisplayAmount(position.token1.amount, position.token1.symbol as TokenSymbol)}
              usdPrice={token1USDPrice || 0}
              formatUsdAmount={formatCalculatedAmount}
              isOverBalance={isAmount1OverBalance}
              animationControls={wiggleControls1}
              onPercentageClick={handleToken1Percentage}
            />
          )}
        </>
      )}

      <Button
        id={hideContinueButton ? "formpanel-hidden-continue" : undefined}
        onClick={handleContinue}
        disabled={
          isCalculating ||
          ((!withdrawAmount0 || parseFloat(withdrawAmount0) <= 0) &&
           (!withdrawAmount1 || parseFloat(withdrawAmount1) <= 0)) ||
          isAmount0OverBalance ||
          isAmount1OverBalance
        }
        className={cn(
          "w-full",
          (isCalculating ||
            ((!withdrawAmount0 || parseFloat(withdrawAmount0) <= 0) &&
             (!withdrawAmount1 || parseFloat(withdrawAmount1) <= 0)) ||
            isAmount0OverBalance || isAmount1OverBalance) ?
            "relative border border-sidebar-border bg-button px-3 text-sm font-medium hover:brightness-110 hover:border-white/30 text-white/75" :
            "text-sidebar-primary border border-sidebar-primary bg-button-primary hover:bg-button-primary/90",
          hideContinueButton && "hidden"
        )}
        style={(isCalculating ||
          ((!withdrawAmount0 || parseFloat(withdrawAmount0) <= 0) &&
           (!withdrawAmount1 || parseFloat(withdrawAmount1) <= 0)) ||
          isAmount0OverBalance || isAmount1OverBalance) ?
          { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } :
          undefined
        }
      >
        {isCalculating ? "Calculating..." : "Continue"}
      </Button>
    </div>
  );
}
