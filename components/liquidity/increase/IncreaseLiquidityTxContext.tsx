"use client";

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, type PropsWithChildren } from "react";
import { useAccount, useBalance, useSignTypedData } from "wagmi";
import { readContracts, writeContract } from "@wagmi/core";
import { erc20Abi, parseUnits } from "viem";
import { config } from "@/lib/wagmiConfig";
import { getTokenDefinitions, type TokenSymbol } from "@/lib/pools-config";
import { useNetwork } from "@/lib/network-context";
import { useIncreaseLiquidity, useDerivedIncreaseInfo, type IncreasePositionData, providePreSignedIncreaseBatchPermit } from "@/lib/liquidity/hooks";
import { preparePermit2BatchForNewPosition } from "@/lib/liquidity-utils";
import { useTokenUSDPrice } from "@/hooks/useTokenUSDPrice";
import { usePercentageInput } from "@/hooks/usePercentageInput";
import { useIncreaseLiquidityContext } from "./IncreaseLiquidityContext";
import { PERMIT2_ADDRESS, MAX_UINT256 } from "../liquidity-form-utils";

export type IncreaseTxStep = "input" | "approve" | "permit" | "deposit";

interface TokenApprovalInfo { symbol: TokenSymbol; address: `0x${string}`; needsApproval: boolean; }

interface IncreaseLiquidityTxContextType {
  txStep: IncreaseTxStep;
  setTxStep: (step: IncreaseTxStep) => void;
  isWorking: boolean;
  error: string | null;
  neededApprovals: TokenApprovalInfo[];
  completedApprovals: number;
  currentApprovalToken: TokenSymbol | null;
  permitSigned: boolean;
  signedBatchPermit: { owner: `0x${string}`; permitBatch: any; signature: string } | null;
  isSuccess: boolean;
  txHash: `0x${string}` | null;
  gasFeeUSD: string | null;
  token0Balance: string;
  token1Balance: string;
  token0USDPrice: number;
  token1USDPrice: number;
  isCalculating: boolean;
  dependentAmount: string | null;
  dependentField: "amount0" | "amount1" | null;
  prepareTransaction: () => Promise<void>;
  executeApproval: () => Promise<void>;
  executePermit: () => Promise<void>;
  executeDeposit: () => Promise<void>;
  handlePercentage0: (percentage: number) => string | void;
  handlePercentage1: (percentage: number) => string | void;
  calculateDependentAmount: (value: string, field: "amount0" | "amount1") => void;
  refetchBalances: () => void;
}

const IncreaseLiquidityTxContext = createContext<IncreaseLiquidityTxContextType | null>(null);

export function IncreaseLiquidityTxContextProvider({ children }: PropsWithChildren) {
  const { address: accountAddress } = useAccount();
  const { chainId, networkMode } = useNetwork();
  const { signTypedDataAsync } = useSignTypedData();
  const tokenDefinitions = useMemo(() => getTokenDefinitions(networkMode), [networkMode]);
  const { increaseLiquidityState, derivedIncreaseLiquidityInfo, setDerivedInfo, setAmount0, setAmount1 } = useIncreaseLiquidityContext();
  const { position } = increaseLiquidityState;

  const [txStep, setTxStep] = useState<IncreaseTxStep>("input");
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [neededApprovals, setNeededApprovals] = useState<TokenApprovalInfo[]>([]);
  const [completedApprovals, setCompletedApprovals] = useState(0);
  const [currentApprovalToken, setCurrentApprovalToken] = useState<TokenSymbol | null>(null);
  const [permitSigned, setPermitSigned] = useState(false);
  const [signedBatchPermit, setSignedBatchPermit] = useState<{ owner: `0x${string}`; permitBatch: any; signature: string } | null>(null);

  const { price: token0USDPrice } = useTokenUSDPrice(position.token0.symbol as TokenSymbol);
  const { price: token1USDPrice } = useTokenUSDPrice(position.token1.symbol as TokenSymbol);

  const { data: token0BalanceData, refetch: refetchToken0Balance } = useBalance({ address: accountAddress, token: tokenDefinitions[position.token0.symbol as TokenSymbol]?.address === "0x0000000000000000000000000000000000000000" ? undefined : tokenDefinitions[position.token0.symbol as TokenSymbol]?.address as `0x${string}`, chainId, query: { enabled: !!accountAddress && !!chainId } });
  const { data: token1BalanceData, refetch: refetchToken1Balance } = useBalance({ address: accountAddress, token: tokenDefinitions[position.token1.symbol as TokenSymbol]?.address === "0x0000000000000000000000000000000000000000" ? undefined : tokenDefinitions[position.token1.symbol as TokenSymbol]?.address as `0x${string}`, chainId, query: { enabled: !!accountAddress && !!chainId } });

  const token0Balance = token0BalanceData?.formatted || "0";
  const token1Balance = token1BalanceData?.formatted || "0";

  useEffect(() => {
    setDerivedInfo((prev) => ({ ...prev, currencyBalances: { TOKEN0: token0Balance, TOKEN1: token1Balance }, currencyAmountsUSDValue: { TOKEN0: parseFloat(prev.formattedAmounts?.TOKEN0 || "0") * (token0USDPrice || 0), TOKEN1: parseFloat(prev.formattedAmounts?.TOKEN1 || "0") * (token1USDPrice || 0) } }));
  }, [token0Balance, token1Balance, token0USDPrice, token1USDPrice, setDerivedInfo]);

  const handlePercentage0 = usePercentageInput(token0BalanceData, { decimals: tokenDefinitions[position.token0.symbol as TokenSymbol]?.decimals || 18, symbol: position.token0.symbol as TokenSymbol }, setAmount0);
  const handlePercentage1 = usePercentageInput(token1BalanceData, { decimals: tokenDefinitions[position.token1.symbol as TokenSymbol]?.decimals || 18, symbol: position.token1.symbol as TokenSymbol }, setAmount1);

  const { calculateDependentAmount, isCalculating, dependentAmount, dependentField } = useDerivedIncreaseInfo({ position, chainId, currentPoolTick: null, networkMode });

  useEffect(() => {
    if (!dependentField || !dependentAmount) return;
    if (dependentField === "amount1") setDerivedInfo((prev) => ({ ...prev, formattedAmounts: { ...prev.formattedAmounts, TOKEN1: dependentAmount } }));
    else if (dependentField === "amount0") setDerivedInfo((prev) => ({ ...prev, formattedAmounts: { ...prev.formattedAmounts, TOKEN0: dependentAmount } }));
  }, [dependentField, dependentAmount, setDerivedInfo]);

  const { increaseLiquidity, isLoading: isIncreasingLiquidity, isSuccess, hash: txHash } = useIncreaseLiquidity({ onLiquidityIncreased: () => { refetchToken0Balance(); refetchToken1Balance(); } });

  const prepareTransaction = useCallback(async () => {
    if (!accountAddress || !chainId) return;
    setIsWorking(true); setError(null);
    try {
      const { TOKEN0: amount0, TOKEN1: amount1 } = derivedIncreaseLiquidityInfo.formattedAmounts || {};
      const tokens = [{ symbol: position.token0.symbol as TokenSymbol, amount: amount0 }, { symbol: position.token1.symbol as TokenSymbol, amount: amount1 }];

      // Filter to tokens that need checking
      const tokensToCheck = tokens.filter(token => {
        if (!token.amount || parseFloat(token.amount) <= 0) return false;
        const tokenDef = tokenDefinitions[token.symbol];
        return tokenDef && tokenDef.address !== "0x0000000000000000000000000000000000000000";
      });

      let needsApproval: TokenApprovalInfo[] = [];

      if (tokensToCheck.length > 0) {
        // Build contracts array for batched read
        const contracts = tokensToCheck.map(token => ({
          address: tokenDefinitions[token.symbol].address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'allowance' as const,
          args: [accountAddress, PERMIT2_ADDRESS] as const,
        }));

        try {
          // Batch all allowance checks into single multicall
          const results = await readContracts(config, { contracts });

          tokensToCheck.forEach((token, index) => {
            const result = results[index];
            if (result.status === 'success') {
              const allowance = result.result as bigint;
              const requiredAmount = parseUnits(token.amount!, tokenDefinitions[token.symbol].decimals);
              if (allowance < requiredAmount) {
                needsApproval.push({ symbol: token.symbol, address: tokenDefinitions[token.symbol].address as `0x${string}`, needsApproval: true });
              }
            }
          });
        } catch {
          // If batch fails, conservatively assume all need approval
          needsApproval = tokensToCheck.map(t => ({ symbol: t.symbol, address: tokenDefinitions[t.symbol].address as `0x${string}`, needsApproval: true }));
        }
      }

      setNeededApprovals(needsApproval);
      if (needsApproval.length > 0) { setCurrentApprovalToken(needsApproval[0].symbol); setTxStep("approve"); }
      else setTxStep("permit");
    } catch (err: any) { setError(err.message || "Failed to prepare transaction"); }
    finally { setIsWorking(false); }
  }, [accountAddress, chainId, position, derivedIncreaseLiquidityInfo.formattedAmounts, tokenDefinitions]);

  const executeApproval = useCallback(async () => {
    if (!currentApprovalToken) return;
    setIsWorking(true); setError(null);
    try {
      const tokenDef = tokenDefinitions[currentApprovalToken];
      if (!tokenDef) throw new Error("Token not found");
      await writeContract(config, { address: tokenDef.address as `0x${string}`, abi: erc20Abi, functionName: "approve", args: [PERMIT2_ADDRESS, BigInt(MAX_UINT256)] });
      setCompletedApprovals((prev) => prev + 1);
      const currentIndex = neededApprovals.findIndex((a) => a.symbol === currentApprovalToken);
      if (currentIndex < neededApprovals.length - 1) setCurrentApprovalToken(neededApprovals[currentIndex + 1].symbol);
      else { setTxStep("permit"); setCurrentApprovalToken(null); }
    } catch (err: any) { setError(err.shortMessage || err.message || "Failed to approve token"); }
    finally { setIsWorking(false); }
  }, [currentApprovalToken, neededApprovals, tokenDefinitions]);

  const executePermit = useCallback(async () => {
    if (!accountAddress || !chainId) return;
    setIsWorking(true); setError(null);
    try {
      const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
      const prepared = await preparePermit2BatchForNewPosition(position.token0.symbol as TokenSymbol, position.token1.symbol as TokenSymbol, accountAddress as `0x${string}`, chainId, deadline);
      if (!prepared?.message?.details || prepared.message.details.length === 0) { setPermitSigned(true); setTxStep("deposit"); return; }
      const signature = await signTypedDataAsync({ domain: prepared.domain as any, types: prepared.types as any, primaryType: prepared.primaryType, message: prepared.message as any });
      const payload = { owner: accountAddress as `0x${string}`, permitBatch: prepared.message, signature };
      providePreSignedIncreaseBatchPermit(position.positionId, payload);
      setSignedBatchPermit(payload);
      setPermitSigned(true); setTxStep("deposit");
    } catch (err: any) { setError(err?.message?.includes("User rejected") ? "Permit signature was rejected" : err?.message || "Failed to sign permit"); }
    finally { setIsWorking(false); }
  }, [accountAddress, chainId, position, signTypedDataAsync]);

  const executeDeposit = useCallback(async () => {
    const { TOKEN0: amount0, TOKEN1: amount1 } = derivedIncreaseLiquidityInfo.formattedAmounts || {};
    const data: IncreasePositionData = { tokenId: position.positionId, token0Symbol: position.token0.symbol as TokenSymbol, token1Symbol: position.token1.symbol as TokenSymbol, additionalAmount0: amount0 || "0", additionalAmount1: amount1 || "0", poolId: position.poolId, tickLower: position.tickLower, tickUpper: position.tickUpper };
    try { increaseLiquidity(data, signedBatchPermit ? { batchPermit: signedBatchPermit } : undefined); } catch {}
  }, [position, derivedIncreaseLiquidityInfo.formattedAmounts, signedBatchPermit, increaseLiquidity]);

  const refetchBalances = useCallback(() => { refetchToken0Balance(); refetchToken1Balance(); }, [refetchToken0Balance, refetchToken1Balance]);

  const value = useMemo(() => ({ txStep, setTxStep, isWorking: isWorking || isIncreasingLiquidity, error, neededApprovals, completedApprovals, currentApprovalToken, permitSigned, signedBatchPermit, isSuccess, txHash: txHash ?? null, gasFeeUSD: null, token0Balance, token1Balance, token0USDPrice: token0USDPrice || 0, token1USDPrice: token1USDPrice || 0, isCalculating, dependentAmount, dependentField, prepareTransaction, executeApproval, executePermit, executeDeposit, handlePercentage0, handlePercentage1, calculateDependentAmount, refetchBalances }), [txStep, isWorking, isIncreasingLiquidity, error, neededApprovals, completedApprovals, currentApprovalToken, permitSigned, signedBatchPermit, isSuccess, txHash, token0Balance, token1Balance, token0USDPrice, token1USDPrice, isCalculating, dependentAmount, dependentField, prepareTransaction, executeApproval, executePermit, executeDeposit, handlePercentage0, handlePercentage1, calculateDependentAmount, refetchBalances]);

  return <IncreaseLiquidityTxContext.Provider value={value}>{children}</IncreaseLiquidityTxContext.Provider>;
}

export function useIncreaseLiquidityTxContext(): IncreaseLiquidityTxContextType {
  const context = useContext(IncreaseLiquidityTxContext);
  if (!context) throw new Error("useIncreaseLiquidityTxContext must be used within IncreaseLiquidityTxContextProvider");
  return context;
}
