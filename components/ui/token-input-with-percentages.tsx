"use client";

import React from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import Image from "next/image";

interface TokenInputWithPercentagesProps {
  tokenSymbol: string;
  tokenIcon: string;
  amount: string;
  balance: string;
  usdValue: string;
  decimals: number;
  placeholder?: string;
  disabled?: boolean;
  isFocused?: boolean;
  isConnected: boolean;
  showPercentages?: boolean; // Control whether to show percentage buttons
  onAmountChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onUseBalance?: () => void;
  className?: string;
  inputClassName?: string;
  label?: string;
}

export function TokenInputWithPercentages({
  tokenSymbol,
  tokenIcon,
  amount,
  balance,
  usdValue,
  decimals,
  placeholder = "0.0",
  disabled = false,
  isFocused = false,
  isConnected,
  showPercentages = true,
  onAmountChange,
  onFocus,
  onBlur,
  onUseBalance,
  className,
  inputClassName,
  label = "Amount",
}: TokenInputWithPercentagesProps) {
  const hasBalance = isConnected && parseFloat(balance) > 0;

  const handlePercentageClick = (percentage: number) => {
    const numericBalance = parseFloat(balance);
    if (isNaN(numericBalance) || numericBalance <= 0) return;

    const amount = (numericBalance * percentage) / 100;
    const formattedAmount = amount.toFixed(decimals);
    onAmountChange(formattedAmount);
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between mb-2">
        <Label className="text-sm font-medium">{label}</Label>
        {onUseBalance && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              className="h-auto p-0 text-xs text-muted-foreground hover:bg-transparent"
              onClick={onUseBalance}
              disabled={disabled}
            >
              Balance: {balance} {tokenSymbol}
            </Button>
          </div>
        )}
      </div>

      <div
        className={cn(
          "group rounded-lg bg-muted/30 p-4",
          { "outline outline-1 outline-muted": isFocused }
        )}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2">
            <Image
              src={tokenIcon}
              alt={tokenSymbol}
              width={20}
              height={20}
              className="rounded-full"
            />
            <span className="text-sm font-medium">{tokenSymbol}</span>
          </div>

          <div className="flex-1">
            <Input
              placeholder={placeholder}
              value={amount}
              onChange={(e) => {
                let newValue = e.target.value.replace(',', '.');
                newValue = newValue.replace(/[^0-9.]/g, '').replace(/(\..*?)\./g, '$1');
                onAmountChange(newValue);
              }}
              onFocus={onFocus}
              onBlur={onBlur}
              type="text"
              pattern="[0-9]*\.?[0-9]*"
              inputMode="decimal"
              autoComplete="off"
              disabled={disabled}
              className={cn(
                "border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto",
                inputClassName
              )}
            />

            {/* USD Value and Percentage Buttons */}
            <div className="relative text-right text-xs min-h-5">
              {/* USD Value - hide on hover when percentages are shown */}
              <div
                className={cn("text-muted-foreground transition-opacity duration-100", {
                  "group-hover:opacity-0": showPercentages && hasBalance,
                })}
              >
                {usdValue}
              </div>

              {/* Percentage buttons - show on hover */}
              {showPercentages && hasBalance && (
                <div className="absolute right-0 top-0 flex gap-1 opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-100">
                  {[25, 50, 75, 100].map((percentage, index) => (
                    <motion.div
                      key={percentage}
                      className="opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:translate-y-0"
                      style={{
                        transitionDelay: `${index * 40}ms`,
                        transitionDuration: "200ms",
                        transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
                      }}
                    >
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-5 px-2 text-[10px] font-medium rounded-md border-sidebar-border bg-muted/20 hover:bg-muted/40 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePercentageClick(percentage);
                        }}
                      >
                        {percentage === 100 ? "MAX" : `${percentage}%`}
                      </Button>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
