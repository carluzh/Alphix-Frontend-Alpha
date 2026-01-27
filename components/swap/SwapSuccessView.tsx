"use client";

import React from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import {
  ChevronRightIcon,
  CircleCheck
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Token, SwapTxInfo } from './swap-interface';
import { getExplorerUrl } from '@/lib/wagmiConfig';
import type { SwapTradeModel } from "./useSwapTrade";

interface SwapSuccessViewProps {
  displayFromToken: Token;
  displayToToken: Token;
  trade: SwapTradeModel;
  swapTxInfo: SwapTxInfo | null;
  handleChangeButton: () => void;
  formatTokenAmountDisplay: (amount: string, token: Token) => string;
}

export function SwapSuccessView({
  displayFromToken,
  displayToToken,
  trade,
  swapTxInfo,
  handleChangeButton,
  formatTokenAmountDisplay
}: SwapSuccessViewProps) {
  // Cache invalidation is handled by useSwapExecution via invalidateAfterTx
  return (
    <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <div 
        className="mb-6 flex items-center justify-between rounded-lg border border-primary p-4 hover:bg-muted/30 transition-colors cursor-pointer" 
        onClick={handleChangeButton}
      >
        <div className="flex items-center gap-3">
          <Image src={displayFromToken.icon} alt={displayFromToken.symbol} width={32} height={32} className="rounded-full"/>
          <div className="text-left flex flex-col">
            <div className="font-medium flex items-baseline">
              {(() => {
                const formattedAmount = swapTxInfo?.fromAmount ? formatTokenAmountDisplay(swapTxInfo.fromAmount, displayFromToken) : "0";
                return formattedAmount.startsWith("< ") ? (
                  <span className="text-xs text-muted-foreground">{formattedAmount}</span>
                ) : (
                  <span className="text-sm">{formattedAmount}</span>
                );
              })()}
              <span className="ml-1 text-xs text-muted-foreground">{swapTxInfo?.fromSymbol || displayFromToken.symbol}</span>
            </div>
            <div className="text-xs text-muted-foreground">{trade.calculatedValues.fromTokenValue}</div>
          </div>
        </div>
        <ChevronRightIcon className="h-4 w-4 text-muted-foreground mx-2" />
        <div className="flex items-center gap-3">
          <div className="text-right flex flex-col">
            <div className="font-medium flex items-baseline">
              {(() => {
                const formattedAmount = swapTxInfo?.toAmount ? formatTokenAmountDisplay(swapTxInfo.toAmount, displayToToken) : "0";
                return formattedAmount.startsWith("< ") ? (
                  <span className="text-xs text-muted-foreground">{formattedAmount}</span>
                ) : (
                  <span className="text-sm">{formattedAmount}</span>
                );
              })()}
              <span className="ml-1 text-xs text-muted-foreground">{swapTxInfo?.toSymbol || displayToToken.symbol}</span>
            </div>
            <div className="text-xs text-muted-foreground">{trade.calculatedValues.toTokenValue}</div>
          </div>
          <Image src={displayToToken.icon} alt={displayToToken.symbol} width={32} height={32} className="rounded-full"/>
        </div>
      </div>
      <div className="my-8 flex flex-col items-center justify-center">
        <motion.div
          className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-button border border-primary overflow-hidden"
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          style={{
            backgroundImage: 'url(/patterns/button-wide.svg)',
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          }}
        >
          <CircleCheck className="h-8 w-8 text-sidebar-primary" />
        </motion.div>
        <div className="text-center">
          <h3 className="text-lg font-medium">Swapped</h3>
          <p className="text-muted-foreground mt-1">{swapTxInfo?.fromSymbol || displayFromToken.symbol} for {swapTxInfo?.toSymbol || displayToToken.symbol}</p>
        </div>
      </div>
      <div className="mb-2 flex items-center justify-center">
        <Button
          variant="link"
          className="text-xs font-normal text-muted-foreground hover:text-muted-foreground/80"
          onClick={() => window.open(swapTxInfo?.explorerUrl || getExplorerUrl(), "_blank")}
        >
          View on Explorer
        </Button>
      </div>
      <Button
        variant="outline"
        className="w-full relative border border-primary bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 text-white/75"
        onClick={handleChangeButton}
        style={{ backgroundImage: 'url(/patterns/button-wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
      >
        Swap again
      </Button>
    </motion.div>
  );
} 