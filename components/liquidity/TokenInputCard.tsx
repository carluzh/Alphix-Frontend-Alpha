"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Image from "next/image";
import { IconCaretExpandY } from "nucleo-micro-bold-essential";
import { motion, useAnimation, type AnimationControls } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, sanitizeDecimalInput } from "@/lib/utils";
import { getToken } from "@/lib/pools-config";
import { PERCENTAGE_OPTIONS } from './liquidity-form-utils';

// CSS for gradient border effect - inject once per component tree
const INPUT_GRADIENT_STYLES = `
@keyframes inputGradientFlow {
  from { background-position: 0% 0%; }
  to { background-position: 300% 0%; }
}
.input-gradient-hover {
  position: relative;
  border-radius: 8px;
}
.input-gradient-hover::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: 9px;
  background: linear-gradient(
    45deg,
    #f94706,
    #ff7919 25%,
    #f94706 50%,
    #ff7919 75%,
    #f94706 100%
  );
  background-size: 300% 100%;
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
  z-index: 0;
  animation: inputGradientFlow 10s linear infinite;
}
.input-gradient-hover:hover::before,
.input-gradient-hover:focus-within::before {
  opacity: 1;
}
`;

interface TokenInputCardProps {
  /** Unique ID for the input element */
  id: string;
  /** Token symbol (e.g., "aETH", "aUSDC") */
  tokenSymbol: string;
  /** Current input value */
  value: string;
  /** Input change handler */
  onChange: (value: string) => void;
  /** Label text (e.g., "Add", "Withdraw") */
  label: string;
  /** Balance or max available amount */
  maxAmount: string;
  /** Formatted balance display (optional, defaults to maxAmount) */
  balanceDisplay?: string;
  /** USD price for the token */
  usdPrice?: number;
  /** Format calculated USD amount */
  formatUsdAmount?: (amount: number) => React.ReactNode;
  /** Handle percentage button click - returns calculated value */
  onPercentageClick?: (percentage: number) => string | void;
  /** Called when input triggers dependent amount calculation */
  onCalculateDependentAmount?: (value: string) => void;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Whether the value is being calculated (Uniswap pattern - shows loading animation) */
  isLoading?: boolean;
  /** Whether amount exceeds balance (triggers wiggle) */
  isOverBalance?: boolean;
  /** External animation controls (optional - creates internal if not provided) */
  animationControls?: AnimationControls;
  /** Optional className override */
  className?: string;
  /** Callback when token selector is clicked (for switching tokens in Zap mode) */
  onTokenClick?: () => void;
}

/**
 * Reusable token input card component
 * Used for Add/Remove liquidity forms
 * Features: gradient hover effect, wiggle animation, percentage buttons
 */
export function TokenInputCard({
  id,
  tokenSymbol,
  value,
  onChange,
  label,
  maxAmount,
  balanceDisplay,
  usdPrice = 0,
  formatUsdAmount,
  onPercentageClick,
  onCalculateDependentAmount,
  disabled = false,
  isLoading = false,
  isOverBalance = false,
  animationControls: externalControls,
  className,
  onTokenClick,
}: TokenInputCardProps) {
  // Internal animation controls if not provided externally
  const internalControls = useAnimation();
  const wiggleControls = externalControls || internalControls;

  // Track wiggle count for triggering animation
  const [wiggleCount, setWiggleCount] = useState(0);
  const [wasOverBalance, setWasOverBalance] = useState(false);

  // Get token icon
  const tokenIcon = getToken(tokenSymbol)?.icon || '/placeholder-logo.svg';

  // Has balance for showing percentage buttons
  const hasBalance = parseFloat(maxAmount) > 0;

  // Calculate USD value
  const usdValue = useMemo(() => {
    const amount = parseFloat(value || "0");
    return amount * usdPrice;
  }, [value, usdPrice]);

  // Format USD for display
  const formattedUsd = useMemo((): React.ReactNode => {
    if (formatUsdAmount) {
      return formatUsdAmount(usdValue);
    }
    if (!Number.isFinite(usdValue) || usdValue === 0) return "$0.00";
    if (usdValue < 0.01) return "< $0.01";
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(usdValue);
  }, [usdValue, formatUsdAmount]);

  // Trigger wiggle when going over balance
  useEffect(() => {
    if (isOverBalance && !wasOverBalance) {
      setWiggleCount(c => c + 1);
    }
    setWasOverBalance(isOverBalance);
  }, [isOverBalance, wasOverBalance]);

  // Run wiggle animation
  useEffect(() => {
    if (wiggleCount > 0) {
      wiggleControls.start({
        x: [0, -3, 3, -2, 2, 0],
        transition: { duration: 0.22, ease: 'easeOut' },
      }).catch(() => {});
    }
  }, [wiggleCount, wiggleControls]);

  // Handle input change with sanitization
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizeDecimalInput(e.target.value);
    onChange(sanitized);

    // Trigger dependent amount calculation
    if (onCalculateDependentAmount && sanitized && parseFloat(sanitized) > 0) {
      onCalculateDependentAmount(sanitized);
    }
  }, [onChange, onCalculateDependentAmount]);

  // Handle max/balance click
  const handleMaxClick = useCallback(() => {
    onChange(maxAmount);
    if (onCalculateDependentAmount && parseFloat(maxAmount) > 0) {
      onCalculateDependentAmount(maxAmount);
    }
  }, [maxAmount, onChange, onCalculateDependentAmount]);

  // Handle percentage button click
  const handlePercentage = useCallback((percentage: number) => {
    if (onPercentageClick) {
      const result = onPercentageClick(percentage);
      if (typeof result === 'string' && result) {
        onChange(result);
        if (onCalculateDependentAmount && parseFloat(result) > 0) {
          onCalculateDependentAmount(result);
        }
      }
    }
  }, [onPercentageClick, onChange, onCalculateDependentAmount]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: INPUT_GRADIENT_STYLES }} />
      <div className={cn("input-gradient-hover", className)}>
        <motion.div
          className="relative z-[1] group rounded-lg bg-surface border border-sidebar-border/60 p-4 space-y-3"
          animate={wiggleControls}
        >
          {/* Label + Balance Row */}
          <div className="flex items-center justify-between">
            <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-white transition-colors cursor-pointer"
              onClick={handleMaxClick}
              disabled={disabled}
            >
              {balanceDisplay || maxAmount} {tokenSymbol}
            </button>
          </div>

          {/* Token Selector + Input Row */}
          <div className="flex items-center gap-2">
            {onTokenClick ? (
              <button
                type="button"
                onClick={onTokenClick}
                className="flex items-center gap-1.5 bg-[var(--token-selector-background)] border border-sidebar-border/60 rounded-lg h-11 px-3 transition-colors hover:bg-sidebar-accent hover:border-sidebar-border group/token"
              >
                <Image
                  src={tokenIcon}
                  alt={tokenSymbol}
                  width={20}
                  height={20}
                  className="rounded-full"
                />
                <span className="text-sm font-medium">{tokenSymbol}</span>
                <IconCaretExpandY className="w-3.5 h-3.5 text-muted-foreground group-hover/token:text-white transition-colors" />
              </button>
            ) : (
              <div className="flex items-center gap-1.5 bg-[var(--token-selector-background)] border border-sidebar-border/60 rounded-lg h-11 px-3">
                <Image
                  src={tokenIcon}
                  alt={tokenSymbol}
                  width={20}
                  height={20}
                  className="rounded-full"
                />
                <span className="text-sm font-medium">{tokenSymbol}</span>
              </div>
            )}
            <div className="flex-1">
              <Input
                id={id}
                placeholder="0.0"
                value={value}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="decimal"
                enterKeyHint="done"
                onChange={handleInputChange}
                disabled={disabled || isLoading}
                className={cn(
                  "border-0 bg-transparent text-right text-xl md:text-xl font-medium shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 p-0 h-auto",
                  isLoading && "animate-pulse opacity-50"
                )}
              />

              {/* USD Value + Percentage Buttons */}
              <div className="relative text-right text-xs min-h-5">
                <div className={cn("text-muted-foreground transition-opacity duration-100", {
                  "group-hover:opacity-0": hasBalance && onPercentageClick
                })}>
                  {formattedUsd}
                </div>

                {/* Percentage Buttons - show on hover */}
                {hasBalance && onPercentageClick && (
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
                            handlePercentage(percentage);
                          }}
                          disabled={disabled}
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
  );
}

/**
 * Styles component - use once at top level to inject gradient CSS
 */
export function TokenInputStyles() {
  return <style dangerouslySetInnerHTML={{ __html: INPUT_GRADIENT_STYLES }} />;
}
