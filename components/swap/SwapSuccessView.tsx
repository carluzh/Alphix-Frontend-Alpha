"use client";

import React from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import {
  ArrowRightIcon,
  CheckIcon,
  ExternalLinkIcon
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Token, SwapTxInfo } from './swap-interface'; // Assuming types are exported

interface SwapSuccessViewProps {
  displayFromToken: Token;
  displayToToken: Token;
  calculatedValues: {
    fromTokenAmount: string;
    fromTokenValue: string;
    toTokenAmount: string;
    toTokenValue: string;
    fees: Array<{ name: string; value: string; type: string }>;
    slippage: string;
  };
  swapTxInfo: SwapTxInfo | null;
  handleChangeButton: () => void;
  formatTokenAmountDisplay: (amount: string, token: Token) => string; // Updated to use Token objects
}

export function SwapSuccessView({ 
  displayFromToken,
  displayToToken,
  calculatedValues,
  swapTxInfo,
  handleChangeButton,
  formatTokenAmountDisplay
}: SwapSuccessViewProps) {
  return (
    <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <div className="mb-6 flex items-center justify-between bg-muted/10 rounded-lg p-4 hover:bg-muted/20 transition-colors">
        <Button variant="ghost" className="flex items-center gap-3 p-0 h-auto hover:bg-transparent" onClick={handleChangeButton}>
          <Image src={displayFromToken.icon} alt={displayFromToken.symbol} width={40} height={40} className="rounded-full"/>
          <div className="text-left flex flex-col">
            <div className="font-medium flex items-baseline">
              {(swapTxInfo?.fromAmount ? formatTokenAmountDisplay(swapTxInfo.fromAmount, displayFromToken) : "0") === "< 0.001" ? (
                  <span className="text-sm text-muted-foreground">{swapTxInfo?.fromAmount ? formatTokenAmountDisplay(swapTxInfo.fromAmount, displayFromToken) : "0"}</span>
              ) : (
                  <span>{swapTxInfo?.fromAmount ? formatTokenAmountDisplay(swapTxInfo.fromAmount, displayFromToken) : "0"}</span>
              )}
              <span className="ml-1 text-sm text-muted-foreground">{swapTxInfo?.fromSymbol || displayFromToken.symbol}</span>
            </div>
            <div className="text-xs text-muted-foreground">{calculatedValues.fromTokenValue}</div>
          </div>
        </Button>
        <ArrowRightIcon className="h-5 w-5 text-muted-foreground mx-2" />
        <Button variant="ghost" className="flex items-center gap-3 p-0 h-auto hover:bg-transparent" onClick={handleChangeButton}>
          <div className="text-right flex flex-col">
            <div className="font-medium flex items-baseline">
              {(swapTxInfo?.toAmount ? formatTokenAmountDisplay(swapTxInfo.toAmount, displayToToken) : "0") === "< 0.001" ? (
                <span className="text-sm text-muted-foreground">{swapTxInfo?.toAmount ? formatTokenAmountDisplay(swapTxInfo.toAmount, displayToToken) : "0"}</span>
              ) : (
                <span>{swapTxInfo?.toAmount ? formatTokenAmountDisplay(swapTxInfo.toAmount, displayToToken) : "0"}</span>
              )}
              <span className="ml-1 text-sm text-muted-foreground">{swapTxInfo?.toSymbol || displayToToken.symbol}</span>
            </div>
            <div className="text-xs text-muted-foreground">{calculatedValues.toTokenValue}</div>
          </div>
          <Image src={displayToToken.icon} alt={displayToToken.symbol} width={40} height={40} className="rounded-full"/>
        </Button>
      </div>
      <div className="my-8 flex flex-col items-center justify-center">
        <motion.div
          className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-900 dark:bg-white"
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          <CheckIcon className="h-8 w-8 text-slate-50 dark:text-black" />
        </motion.div>
        <div className="text-center">
          <h3 className="text-lg font-medium">Swapped</h3>
          <p className="text-muted-foreground mt-1">{swapTxInfo?.fromSymbol || displayFromToken.symbol} for {swapTxInfo?.toSymbol || displayToToken.symbol}</p>
        </div>
      </div>
      <div className="mb-6 flex items-center justify-center">
        <Button
          variant="link"
          className="text-primary dark:text-white hover:text-primary/80 dark:hover:text-white/80"
          onClick={() => window.open(swapTxInfo?.explorerUrl || `https://base-sepolia.blockscout.com/`, "_blank")}
        >
          View on Explorer
          <ExternalLinkIcon className="h-3 w-3 ml-1" />
        </Button>
      </div>
      <Button
        className="w-full bg-slate-900 text-slate-50 hover:bg-slate-900/80 
                           dark:bg-white dark:text-black dark:hover:bg-white/90"
        onClick={handleChangeButton} // Changed from handleSwapAgain to handleChangeButton as per prop name
      >
        Swap again
      </Button>
    </motion.div>
  );
} 