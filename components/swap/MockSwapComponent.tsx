"use client";

import React, { useState, useCallback, useEffect } from 'react';
import { useAccount, useWriteContract, useSignTypedData } from 'wagmi';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { getAllTokens, TokenSymbol, getToken } from '@/lib/pools-config';
import { getQuote, needsApproval, executeSwap } from '@/lib/swap';
import type { Address, Hex } from 'viem';
import { getAddress } from 'viem';

const UNIVERSAL_ROUTER_ADDRESS = '0x492E6456D9528771018DeB9E87ef7750EF184104';
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const;

export function MockSwapComponent({ className }: { className?: string }) {
  const { address: userAddress, isConnected } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();

  const [fromTokenSymbol, setFromTokenSymbol] = useState<TokenSymbol>('aUSDC');
  const [toTokenSymbol, setToTokenSymbol] = useState<TokenSymbol>('aUSDT');
  const [amount, setAmount] = useState<string>('1');
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [currentMarketPrice, setCurrentMarketPrice] = useState<string>('');
  const [isSwapping, setIsSwapping] = useState(false);
  const [logOutput, setLogOutput] = useState<string>('');

  const log = useCallback((message: string) => {
    setLogOutput(prev => `${new Date().toLocaleTimeString()}: ${message}\n${prev}`);
  }, []);

  // Auto-fetch current market price for limit price auto-population
  useEffect(() => {
    const fetchCurrentPrice = async () => {
      if (!amount || parseFloat(amount) <= 0) return;
      
      try {
        const quote = await getQuote(fromTokenSymbol, toTokenSymbol, amount);
        const rate = (parseFloat(quote.toAmount) / parseFloat(amount)).toFixed(6);
        setCurrentMarketPrice(rate);
        
        // Auto-populate limit price if it's currently empty
        if (!limitPrice) {
          setLimitPrice(rate);
        }
      } catch (error) {
        console.error('Failed to fetch current price:', error);
        setCurrentMarketPrice('');
      }
    };

    fetchCurrentPrice();
  }, [fromTokenSymbol, toTokenSymbol, amount, limitPrice]);

  const availableTokens = Object.keys(getAllTokens()) as TokenSymbol[];

  const handleSwap = async () => {
    if (!userAddress) {
      log("Please connect your wallet.");
      return;
    }

    setIsSwapping(true);
    try {
      const limitPriceNum = parseFloat(limitPrice);
      const hasLimitPrice = limitPrice && !isNaN(limitPriceNum) && limitPriceNum > 0;
      
      if (hasLimitPrice) {
        log(`🔄 Starting limit order: ${amount} ${fromTokenSymbol} → ${toTokenSymbol} (limit price: ${limitPrice})`);
        log(`🎯 Will swap until price reaches ${limitPrice}, then return remaining tokens`);
      } else {
        log(`🔄 Starting market swap: ${amount} ${fromTokenSymbol} → ${toTokenSymbol} (no price limit)`);
      }

      // Step 1: Get current quote for reference
      log("Step 1: Getting current market quote...");
      const quote = await getQuote(fromTokenSymbol, toTokenSymbol, amount);
      log(`📊 Current market rate: ${quote.toAmount} ${toTokenSymbol} for ${amount} ${fromTokenSymbol}`);

      // Step 2: Check approval
      log("Step 2: Checking token approval...");
      const approvalNeeded = await needsApproval(userAddress, fromTokenSymbol, amount);
      
      if (approvalNeeded) {
        log(`🔧 Approving ${fromTokenSymbol}...`);
        const fromToken = getToken(fromTokenSymbol);
        if (!fromToken) throw new Error(`Token not found: ${fromTokenSymbol}`);
        
        const MaxUint256 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
        const txHash = await writeContractAsync({
          address: getAddress(fromToken.address),
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [getAddress(UNIVERSAL_ROUTER_ADDRESS), MaxUint256]
        });
        log(`✅ Approval sent: ${txHash}`);
        log("⏳ Waiting for approval confirmation...");
        // Note: In production, you'd wait for confirmation here
      } else {
        log(`✅ ${fromTokenSymbol} already approved`);
      }

      // Step 3: Handle permit signatures
      log("Step 3: Checking permit requirements...");
      const response = await fetch('/api/swap/prepare-permit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userAddress: userAddress,
          tokenAddress: getToken(fromTokenSymbol)?.address,
          chainId: 84532,
          checkExisting: true,
        }),
      });
      
      const permitData = await response.json();
      if (!response.ok) throw new Error(permitData.message || 'Failed to fetch permit data');
      
      let signature: Hex | undefined = undefined;
      const MaxUint160 = BigInt('0xffffffffffffffffffffffffffffffffffffffff');
      const needsSignature = !permitData.hasValidPermit || 
                            BigInt(permitData.currentPermitInfo.amount) < MaxUint160;

      if (needsSignature) {
        log("📝 Signing permit...");
        const fromToken = getToken(fromTokenSymbol);
        if (!fromToken) throw new Error(`Token not found: ${fromTokenSymbol}`);
        
        signature = await signTypedDataAsync({
          domain: permitData.domain,
          types: permitData.types,
          primaryType: 'PermitSingle',
          message: {
            details: {
              token: fromToken.address as Address,
              amount: MaxUint160,
              expiration: permitData.permitExpiration,
              nonce: permitData.nonce,
            },
            spender: permitData.spender,
            sigDeadline: BigInt(permitData.sigDeadline),
          },
        });
        log(`✅ Permit signed`);
      } else {
        log("✅ No permit signature needed");
      }

      // Step 4: Execute swap with price limit
      log("Step 4: Executing swap with price limit...");
      const result = await executeSwapWithPriceLimit(
        userAddress, 
        fromTokenSymbol, 
        toTokenSymbol, 
        amount,
        permitData, 
        signature,
        hasLimitPrice ? limitPrice : undefined
      );
      
      if (result.status === 'success') {
        log(`🎉 Swap successful! TxHash: ${result.txHash}`);
        if (hasLimitPrice) {
          log(`🎯 Limit order executed with price protection`);
        } else {
          log(`📈 Market swap completed`);
        }
      } else {
        log(`❌ Swap failed: ${result.error || 'Unknown error'}`);
      }

    } catch (error: any) {
      log(`❌ Error: ${error.message}`);
    } finally {
      setIsSwapping(false);
    }
  };

  // Enhanced executeSwap function with price limit support
  const executeSwapWithPriceLimit = async (
    userAddress: Address,
    fromTokenSymbol: TokenSymbol,
    toTokenSymbol: TokenSymbol,
    amount: string,
    permitData: any,
    permitSignature?: Hex,
    limitPrice?: string
  ): Promise<{ status: string; txHash: `0x${string}`; error?: string }> => {
    const fromToken = getToken(fromTokenSymbol);
    const toToken = getToken(toTokenSymbol);
    if (!fromToken || !toToken) {
      throw new Error("Invalid token symbols provided.");
    }

    // Build transaction with price limit
    const MaxUint160 = BigInt('0xffffffffffffffffffffffffffffffffffffffff');
    const effectiveTimestamp = BigInt(Math.floor(Date.now() / 1000));
    const effectiveFallbackSigDeadline = effectiveTimestamp + BigInt(30 * 60);

    const bodyForSwapTx = {
      userAddress,
      fromTokenSymbol: fromToken.symbol,
      toTokenSymbol: toToken.symbol,
      swapType: 'ExactIn',
      amountDecimalsStr: amount,
      limitAmountDecimalsStr: "0", // Will be handled by price limit logic
      limitPrice: limitPrice, // Pass the limit price
      permitSignature: permitSignature || "0x", 
      permitTokenAddress: fromToken.address,
      permitAmount: MaxUint160.toString(),
      permitNonce: permitData.nonce,
      permitExpiration: permitData.permitExpiration,
      permitSigDeadline: permitData.sigDeadline ? permitData.sigDeadline.toString() : effectiveFallbackSigDeadline.toString(),
      chainId: 84532,
    };

    const buildTxResponse = await fetch('/api/swap/build-tx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyForSwapTx),
    });
    
    const buildTxData = await buildTxResponse.json();
    if (!buildTxData.ok) {
      const errorInfo = buildTxData.message || 'Failed to build transaction';
      const cause = buildTxData.errorDetails || buildTxData.error;
      throw new Error(errorInfo, { cause: cause });
    }

    // Execute the transaction
    const txHash = await writeContractAsync({
      address: getAddress(buildTxData.to),
      abi: [
        {
          name: 'execute',
          type: 'function',
          stateMutability: 'payable',
          inputs: [
            { name: 'commands', type: 'bytes' },
            { name: 'inputs', type: 'bytes[]' },
            { name: 'deadline', type: 'uint256' }
          ],
          outputs: []
        }
      ],
      functionName: 'execute',
      args: [buildTxData.commands as Hex, buildTxData.inputs as Hex[], BigInt(buildTxData.deadline)],
      value: BigInt(buildTxData.value),
    });

    return { status: 'success', txHash };
  };


  return (
    <div className={cn("w-full max-w-md bg-card rounded-xl border p-6 shadow-lg", className)}>
      <h2 className="text-lg font-semibold mb-4">V4 Price Limit Swap</h2>
      {!isConnected && (
        <div className="text-red-500 font-bold mb-4">Please connect your wallet to swap.</div>
      )}
      
      <div className="space-y-4">
        {/* Token Selection */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>From</Label>
            <Select value={fromTokenSymbol} onValueChange={(v) => setFromTokenSymbol(v as TokenSymbol)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {availableTokens.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>To</Label>
            <Select value={toTokenSymbol} onValueChange={(v) => setToTokenSymbol(v as TokenSymbol)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {availableTokens.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Amount and Limit Price */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Amount</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0" />
          </div>
          <div>
            <Label>
              Limit Price (optional)
              {currentMarketPrice && (
                <span className="text-xs text-muted-foreground ml-1">
                  (current: {currentMarketPrice})
                </span>
              )}
            </Label>
            <div className="flex gap-2">
              <Input 
                value={limitPrice} 
                onChange={(e) => setLimitPrice(e.target.value)} 
                placeholder={currentMarketPrice || "e.g. 0.99"} 
                className="flex-1"
              />
              {currentMarketPrice && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => setLimitPrice(currentMarketPrice)}
                  className="px-2 text-xs"
                >
                  Current
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Swap Button */}
        <Button 
          onClick={handleSwap} 
          disabled={!isConnected || isSwapping} 
          className="w-full"
          size="lg"
        >
          {isSwapping ? "Swapping..." : "Swap"}
        </Button>

        {/* Logs */}
        <div>
          <Label>Transaction Log</Label>
          <Textarea 
            value={logOutput} 
            readOnly 
            className="h-32 font-mono text-xs bg-muted/50" 
            placeholder="Transaction details will appear here..."
          />
        </div>
      </div>
    </div>
  );
} 