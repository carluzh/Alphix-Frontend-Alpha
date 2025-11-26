"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { ChevronDownIcon, CheckIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface TokenSelectorToken {
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  icon: string;
  balance?: string;
  value?: string;
  usdPrice?: number;
}

interface TokenSelectorProps {
  selectedToken: TokenSelectorToken;
  availableTokens: TokenSelectorToken[];
  onTokenSelect: (token: TokenSelectorToken) => void;
  disabled?: boolean;
  excludeToken?: TokenSelectorToken; // Token to exclude from dropdown (e.g., the other token in swap)
  className?: string;
}

export function TokenSelector({
  selectedToken,
  availableTokens,
  onTokenSelect,
  disabled = false,
  excludeToken,
  className
}: TokenSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Filter out the excluded token (typically the other token in the swap pair)
  const filteredTokens = excludeToken 
    ? availableTokens.filter(token => token.address !== excludeToken.address)
    : availableTokens;

  const handleTokenSelect = (token: TokenSelectorToken) => {
    onTokenSelect(token);
    setIsOpen(false);
  };

  const handleToggle = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  return (
    <div className={cn("relative", className)}>
      {/* Selected Token Button */}
      <Button
        variant="ghost"
        className={cn(
          "flex items-center gap-1.5 bg-muted/30 border-0 rounded-lg h-10 px-2 hover:bg-muted/50 transition-colors",
          {
            "cursor-not-allowed opacity-50": disabled,
            "bg-muted/50": isOpen
          }
        )}
        onClick={handleToggle}
        disabled={disabled}
      >
        <Image 
          src={selectedToken.icon} 
          alt={selectedToken.symbol} 
          width={20} 
          height={20} 
          className="rounded-full"
        />
        <span className="text-sm font-medium">{selectedToken.symbol}</span>
        <ChevronDownIcon 
          className={cn(
            "h-4 w-4 text-muted-foreground transition-transform duration-200",
            { "rotate-180": isOpen }
          )} 
        />
      </Button>

      {/* Dropdown Menu */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <div 
              className="fixed inset-0 z-40 cursor-pointer" 
              onClick={() => setIsOpen(false)}
            />
            
            {/* Dropdown Content */}
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="absolute top-full left-0 right-0 mt-2 bg-background border border-border rounded-lg shadow-lg z-50 py-2 max-h-48 overflow-y-auto"
            >
              {filteredTokens.map((token) => {
                const isSelected = token.address === selectedToken.address;
                
                return (
                  <button
                    key={token.address}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left",
                      {
                        "bg-muted/30": isSelected
                      }
                    )}
                    onClick={() => handleTokenSelect(token)}
                  >
                    <Image 
                      src={token.icon} 
                      alt={token.symbol} 
                      width={20} 
                      height={20} 
                      className="rounded-full"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{token.symbol}</span>
                        {isSelected && (
                          <CheckIcon className="h-4 w-4 text-primary" />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {token.name}
                      </div>
                    </div>
                  </button>
                );
              })}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
} 