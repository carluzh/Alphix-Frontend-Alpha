import * as Sentry from '@sentry/nextjs';
import React, { useState, useCallback, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSignTypedData, usePublicClient } from 'wagmi';
import { toast } from 'sonner';
import { V4PositionManager, Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';
import { Token, Ether, CurrencyAmount, Percent } from '@uniswap/sdk-core';
import { V4_POSITION_MANAGER_ADDRESS, V4_POSITION_MANAGER_ABI, PERMIT2_ADDRESS, Permit2Abi_allowance } from '@/lib/swap/swap-constants';
import { getToken, TokenSymbol, getTokenSymbolByAddress } from '@/lib/pools-config';
import { useNetwork } from '@/lib/network-context';
import { getExplorerTxUrl } from '@/lib/wagmiConfig';
import { getAddress, type Hex, BaseError, encodeAbiParameters, keccak256 } from 'viem';
import { getPositionDetails, getPoolState, preparePermit2BatchForPosition } from '@/lib/liquidity/liquidity-utils';
import { invalidateAfterTx } from '@/lib/invalidation';
import { IconBadgeCheck2, IconCircleXmarkFilled, IconCircleInfo } from 'nucleo-micro-bold-essential';
import JSBI from 'jsbi';
import { safeParseUnits } from '@/lib/liquidity/utils/parsing/amountParsing';

// Re-export transaction builder and types for external use
export { buildIncreaseLiquidityTx, parseTokenIdFromPosition } from '@/lib/liquidity';
export type { IncreasePositionData } from '@/lib/liquidity';

import type { IncreasePositionData } from '@/lib/liquidity';

// In-memory store to provide pre-signed batch permits from UI flows (e.g., Modal "Sign" step)
type BatchPermitPayload = { owner: `0x${string}`; permitBatch: any; signature: string };
const preSignedIncreaseBatchPermitByTokenId = new Map<string, BatchPermitPayload>();

export function providePreSignedIncreaseBatchPermit(tokenId: string | number | bigint, payload: BatchPermitPayload) {
  const key = typeof tokenId === 'bigint' ? tokenId.toString() : tokenId.toString();
  preSignedIncreaseBatchPermitByTokenId.set(key, payload);
}

interface UseIncreaseLiquidityProps {
  onLiquidityIncreased: (info?: { txHash?: `0x${string}`; blockNumber?: bigint; increaseAmounts?: { amount0: string; amount1: string } | null }) => void;
}

type IncreaseOptions = { 
  slippageBps?: number; 
  deadlineSeconds?: number;
  batchPermit?: {
    owner: `0x${string}`;
    permitBatch: any;
    signature: string;
  };
};

export function useIncreaseLiquidity({ onLiquidityIncreased }: UseIncreaseLiquidityProps) {
  const { address: accountAddress, chainId } = useAccount();
  const { networkMode } = useNetwork();

  const publicClient = usePublicClient();

  const { data: hash, writeContract, isPending: isIncreaseSendPending, error: increaseSendError, reset: resetWriteContract } = useWriteContract();
  const { isLoading: isIncreaseConfirming, isSuccess: isIncreaseConfirmed, error: increaseConfirmError, status: waitForTxStatus } = useWaitForTransactionReceipt({ hash });
  const { signTypedDataAsync } = useSignTypedData();
  
  // Store the increase amounts for the callback
  const increaseAmountsRef = React.useRef<{ amount0: string; amount1: string } | null>(null);

  // Log minimal useAccount details for debugging
  useEffect(() => {
    console.log("useAccount:", { accountAddress, chainId });
  }, [accountAddress, chainId]);

  const [isIncreasing, setIsIncreasing] = useState(false);
  // Ensure we only invoke onLiquidityIncreased once per tx hash
  const handledIncreaseHashRef = React.useRef<string | null>(null);
  const currentPositionIdRef = React.useRef<string | null>(null);
  const currentPositionDataRef = React.useRef<IncreasePositionData | null>(null);

  // Helper function to get the NFT token ID from position parameters
  const getTokenIdFromPosition = useCallback(async (positionData: IncreasePositionData): Promise<bigint> => {
    // For now, we'll use a simple approach: parse the salt from the composite ID
    // In a production app, you should query the Position Manager contract
    const compositeId = positionData.tokenId.toString();
    const parts = compositeId.split('-');
    
    // The last part should be the salt/token ID
    const saltHex = parts[parts.length - 1];
    
    if (saltHex && saltHex !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
      try {
        // Convert hex to BigInt
        const tokenId = BigInt(saltHex);
        if (tokenId > 0n) {
          return tokenId;
        }
      } catch (e) {
        console.warn('Failed to parse token ID from salt:', saltHex);
      }
    }
    
    // Fallback: try to extract token ID from the composite ID
    // This is a temporary solution - in production you should query the contract
    throw new Error('Unable to determine NFT token ID from position data. Please contact support.');
  }, []);

  const increaseLiquidity = useCallback(async (positionData: IncreasePositionData, opts?: IncreaseOptions) => {
    if (!accountAddress || !chainId) {
      toast.error("Wallet Not Connected", { icon: React.createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }), description: "Please connect your wallet and try again.", action: { label: "Open Ticket", onClick: () => window.open('https://discord.com/invite/NTXRarFbTr', '_blank') } });
      return;
    }
    if (!V4_POSITION_MANAGER_ADDRESS) {
      toast.error("Configuration Error", { icon: React.createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }), description: "Position Manager address not set.", action: { label: "Open Ticket", onClick: () => window.open('https://discord.com/invite/NTXRarFbTr', '_blank') } });
      return;
    }
    
    // Store position data for optimistic updates
    currentPositionIdRef.current = positionData.tokenId.toString();
    currentPositionDataRef.current = positionData;

    // IMPORTANT: In Uniswap V4, fee revenue is automatically credited to a position when increasing liquidity
    // We should NOT manually add fees to the amounts - the V4 SDK handles this automatically
    // See: https://docs.uniswap.org/contracts/v4/quickstart/manage-liquidity/increase-liquidity
    const finalAdditionalAmount0 = positionData.additionalAmount0 || '0';
    const finalAdditionalAmount1 = positionData.additionalAmount1 || '0';

    // Store the user input amounts for the callback (fees will be auto-compounded by v4)
    increaseAmountsRef.current = {
      amount0: finalAdditionalAmount0,
      amount1: finalAdditionalAmount1
    };

    setIsIncreasing(true);
    // Allow next tx hash to be handled
    handledIncreaseHashRef.current = null;

    try {
      const token0Def = getToken(positionData.token0Symbol);
      const token1Def = getToken(positionData.token1Symbol);

      if (!token0Def || !token1Def) {
        throw new Error("Token definitions not found for one or both tokens in the position.");
      }
      if (!token0Def.address || !token1Def.address) {
        throw new Error("Token addresses are missing in definitions.");
      }

      // (planner path vars removed; using v4 addCallParameters path)

      // Preferred v4 SDK path: addCallParameters with batchPermit/useNative
      const nftTokenId = await getTokenIdFromPosition(positionData);

      // Fetch on-chain position details and pool state
      const details = await getPositionDetails(nftTokenId, chainId);
      // Build currencies strictly in poolKey order to avoid side mixups
      const symC0 = getTokenSymbolByAddress(getAddress(details.poolKey.currency0), networkMode);
      const symC1 = getTokenSymbolByAddress(getAddress(details.poolKey.currency1), networkMode);
      if (!symC0 || !symC1) throw new Error('Token symbols not found for pool currencies');
      const defC0 = getToken(symC0, networkMode)!;
      const defC1 = getToken(symC1, networkMode)!;
      const isNativeC0 = getAddress(details.poolKey.currency0) === '0x0000000000000000000000000000000000000000';
      const currency0 = isNativeC0 ? Ether.onChain(chainId) : new Token(chainId, getAddress(defC0.address), defC0.decimals, defC0.symbol);
      const currency1 = new Token(chainId, getAddress(defC1.address), defC1.decimals, defC1.symbol);

      const keyTuple = [{
        currency0: getAddress(details.poolKey.currency0),
        currency1: getAddress(details.poolKey.currency1),
        fee: Number(details.poolKey.fee),
        tickSpacing: Number(details.poolKey.tickSpacing),
        hooks: getAddress(details.poolKey.hooks),
      }];
      const encoded = encodeAbiParameters([
        { type: 'tuple', components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ]}
      ], keyTuple as any);
      const poolId = keccak256(encoded) as Hex;
      const state = await getPoolState(poolId, chainId);

      const pool = new V4Pool(
        currency0 as any,
        currency1,
        details.poolKey.fee,
        details.poolKey.tickSpacing,
        details.poolKey.hooks,
        JSBI.BigInt(state.sqrtPriceX96.toString()),
        JSBI.BigInt(state.liquidity.toString()),
        state.tick,
      );

      let amount0RawUser = safeParseUnits(finalAdditionalAmount0, token0Def.decimals);
      let amount1RawUser = safeParseUnits(finalAdditionalAmount1, token1Def.decimals);
      const outOfRangeBelow = state.tick < details.tickLower;
      const outOfRangeAbove = state.tick > details.tickUpper;
      if (outOfRangeBelow) {
        // below range -> only token0 contributes
        amount1RawUser = 0n;
      } else if (outOfRangeAbove) {
        // above range -> only token1 contributes
        amount0RawUser = 0n;
      }
      if (amount0RawUser === 0n && amount1RawUser === 0n) {
        toast.error('Invalid Amount', { icon: React.createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }), description: 'Please enter a valid amount to add.' });
        setIsIncreasing(false);
        return;
      }
      // Map user-entered amounts to poolKey order
      let amountC0Raw: bigint, amountC1Raw: bigint;
      if (positionData.token0Symbol === symC0 && positionData.token1Symbol === symC1) {
        // Same order: token0->currency0, token1->currency1
        amountC0Raw = amount0RawUser;
        amountC1Raw = amount1RawUser;
      } else if (positionData.token0Symbol === symC1 && positionData.token1Symbol === symC0) {
        // Swapped order: token0->currency1, token1->currency0
        amountC0Raw = amount1RawUser;
        amountC1Raw = amount0RawUser;
      } else {
        throw new Error(`Token mapping error: position has ${positionData.token0Symbol}/${positionData.token1Symbol} but pool has ${symC0}/${symC1}`);
      }

      // Use Uniswap's approach: let V4Position SDK calculate the dependent amount
      // This avoids overflow issues with manual liquidity calculations
      let position: V4Position;

      // Determine which amount the user provided (non-zero) and calculate the dependent amount
      const userProvidedAmount0 = amountC0Raw > 0n;
      const userProvidedAmount1 = amountC1Raw > 0n;

      if (userProvidedAmount0 && !userProvidedAmount1) {
        // User provided amount0, calculate amount1
        const amt0 = CurrencyAmount.fromRawAmount(currency0, amountC0Raw.toString());
        position = V4Position.fromAmount0({
          pool,
          tickLower: details.tickLower,
          tickUpper: details.tickUpper,
          amount0: amt0.quotient,
          useFullPrecision: true,
        });
      } else if (userProvidedAmount1 && !userProvidedAmount0) {
        // User provided amount1, calculate amount0
        const amt1 = CurrencyAmount.fromRawAmount(currency1, amountC1Raw.toString());
        position = V4Position.fromAmount1({
          pool,
          tickLower: details.tickLower,
          tickUpper: details.tickUpper,
          amount1: amt1.quotient,
        });
      } else {
        // User provided both amounts, use fromAmounts
        const amt0 = CurrencyAmount.fromRawAmount(currency0, amountC0Raw.toString());
        const amt1 = CurrencyAmount.fromRawAmount(currency1, amountC1Raw.toString());
        position = V4Position.fromAmounts({
          pool,
          tickLower: details.tickLower,
          tickUpper: details.tickUpper,
          amount0: amt0.quotient,
          amount1: amt1.quotient,
          useFullPrecision: true,
        });
      }

      // Guard ZERO_LIQUIDITY early for nicer UX
      if (JSBI.equal(position.liquidity, JSBI.BigInt(0))) {
        const err: any = new Error('ZERO_LIQUIDITY');
        err.__zero = true;
        throw err;
      }

      // Enforce exact adds: zero slippage
      const slippage = new Percent(0);
      const deadline = (opts?.deadlineSeconds && opts.deadlineSeconds > 0)
        ? Math.floor(Date.now() / 1000) + opts.deadlineSeconds
        : Math.floor(Date.now() / 1000) + 20 * 60;

      // Check existing Permit2 allowances; only sign batch if needed (poolKey order)
      let addOptionsBatch: any = {};
      // First preference: a globally provided pre-signed permit from UI layer by tokenId
      const preSignedKey = positionData.tokenId?.toString?.() ?? '';
      const preSignedFromStore = preSignedKey ? preSignedIncreaseBatchPermitByTokenId.get(preSignedKey) : undefined;
      if (preSignedFromStore) {
        addOptionsBatch = { batchPermit: preSignedFromStore };
        console.log('[increase] Using pre-signed batch permit from store', {
          owner: preSignedFromStore.owner,
          detailsCount: preSignedFromStore.permitBatch?.details?.length ?? 0,
        });
      } else if (opts?.batchPermit) {
        // Use pre-signed batch permit provided by caller (Modal's Sign step)
        addOptionsBatch = { batchPermit: opts.batchPermit };
        console.log('[increase] Using pre-signed batch permit from opts', {
          owner: opts.batchPermit.owner,
          detailsCount: opts.batchPermit.permitBatch?.details?.length ?? 0,
        });
      } else {
        try {
          if (!publicClient) throw new Error('Public client not available');
          const now = Math.floor(Date.now() / 1000);
          let needPermit = false;
          // token0 ERC20 check
          if (!isNativeC0 && amountC0Raw > 0n) {
            const [amt, exp] = (await publicClient.readContract({
              address: PERMIT2_ADDRESS,
              abi: Permit2Abi_allowance,
              functionName: 'allowance',
              args: [accountAddress as `0x${string}`, getAddress(defC0.address), V4_POSITION_MANAGER_ADDRESS as `0x${string}`],
            }) as readonly [bigint, bigint, bigint]).slice(0,2) as unknown as [bigint, bigint];
            if (!(amt >= amountC0Raw && Number(exp) > now)) needPermit = true;
          }
          // token1 ERC20 check
          if (amountC1Raw > 0n) {
            const [amt, exp] = (await publicClient.readContract({
              address: PERMIT2_ADDRESS,
              abi: Permit2Abi_allowance,
              functionName: 'allowance',
              args: [accountAddress as `0x${string}`, getAddress(defC1.address), V4_POSITION_MANAGER_ADDRESS as `0x${string}`],
            }) as readonly [bigint, bigint, bigint]).slice(0,2) as unknown as [bigint, bigint];
            if (!(amt >= amountC1Raw && Number(exp) > now)) needPermit = true;
          }
          if (needPermit) {
            const prepared = await preparePermit2BatchForPosition(nftTokenId, accountAddress as `0x${string}`, chainId, deadline, amountC0Raw, amountC1Raw);
            if (prepared?.message?.details && prepared.message.details.length > 0) {
              // Inform user about batch signature request
              toast("Sign in Wallet", {
                icon: React.createElement(IconCircleInfo, { className: "h-4 w-4" })
              });

              const signature = await signTypedDataAsync({
                domain: prepared.domain as any,
                types: prepared.types as any,
                primaryType: prepared.primaryType,
                message: prepared.message as any,
              });
              
              // Show batch signature success
              const currentTime = Math.floor(Date.now() / 1000);
              const sigDeadline = prepared.message?.sigDeadline || deadline;
              const durationSeconds = Number(sigDeadline) - currentTime;
              let durationFormatted = "";
              if (durationSeconds >= 31536000) {
                  const years = Math.ceil(durationSeconds / 31536000);
                  durationFormatted = `${years} year${years > 1 ? 's' : ''}`;
              } else if (durationSeconds >= 2592000) {
                  const months = Math.ceil(durationSeconds / 2592000);
                  durationFormatted = `${months} month${months > 1 ? 's' : ''}`;
              } else if (durationSeconds >= 604800) {
                  const weeks = Math.ceil(durationSeconds / 604800);
                  durationFormatted = `${weeks} week${weeks > 1 ? 's' : ''}`;
              } else if (durationSeconds >= 86400) {
                  const days = Math.ceil(durationSeconds / 86400);
                  durationFormatted = `${days} day${days > 1 ? 's' : ''}`;
              } else if (durationSeconds >= 3600) {
                  const hours = Math.ceil(durationSeconds / 3600);
                  durationFormatted = `${hours} hour${hours > 1 ? 's' : ''}`;
              } else {
                  const minutes = Math.ceil(durationSeconds / 60);
                  durationFormatted = `${minutes} minute${minutes > 1 ? 's' : ''}`;
              }

              toast.success("Batch Signature Complete", {
                icon: React.createElement(IconBadgeCheck2, { className: "h-4 w-4 text-green-500" }),
                description: `Batch permit signed successfully for ${durationFormatted}`
              });

              addOptionsBatch = {
                batchPermit: {
                  owner: accountAddress,
                  permitBatch: prepared.message,
                  signature,
                },
              };
            }
          }
        } catch (e) {
          // continue without batch permit
        }
      }
      const addOptions: any = {
        slippageTolerance: slippage,
        deadline: String(deadline),
        hookData: '0x',
        tokenId: nftTokenId.toString(),
        ...addOptionsBatch,
        ...(isNativeC0 ? { useNative: Ether.onChain(chainId) } : {}),
      };

      const { calldata, value } = V4PositionManager.addCallParameters(position, addOptions) as { calldata: Hex; value: string | number | bigint };

      // Toast removed - TransactionFlowPanel already shows "Confirm Transaction"
      resetWriteContract();
      writeContract({
        address: V4_POSITION_MANAGER_ADDRESS as Hex,
        abi: V4_POSITION_MANAGER_ABI,
        functionName: 'multicall',
        args: [[calldata] as Hex[]],
        value: BigInt(value || 0),
        chainId,
      } as any);

    } catch (error: any) {
      console.error("Error preparing increase transaction:", error);
      const msg = (error?.message || '').toString();
      const isUserRejection =
        msg?.toLowerCase().includes('user rejected') ||
        msg?.toLowerCase().includes('user denied') ||
        error.code === 4001;

      if (!isUserRejection) {
        Sentry.captureException(error, {
          tags: { operation: 'liquidity_increase' },
          extra: {
            step: 'prepare_transaction',
            tokenId: positionData.tokenId,
            token0Symbol: positionData.token0Symbol,
            token1Symbol: positionData.token1Symbol,
          }
        });
      }

      if ((error as any)?.__zero || msg.includes('ZERO_LIQUIDITY')) {
        toast.error("Try a larger Amount", { icon: React.createElement(IconCircleXmarkFilled, { className: 'h-4 w-4 text-red-500' }), action: { label: "Open Ticket", onClick: () => window.open('https://discord.com/invite/NTXRarFbTr', '_blank') } });
      } else {
        toast.error("Increase Failed", { icon: React.createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }), description: msg || "Could not prepare the transaction.", action: { label: "Copy Error", onClick: () => navigator.clipboard.writeText(msg || '') } });
      }
      setIsIncreasing(false);
    }
  }, [accountAddress, chainId, writeContract, resetWriteContract, getTokenIdFromPosition]);

  useEffect(() => {
    if (increaseSendError) {
      const message = increaseSendError instanceof BaseError ? increaseSendError.shortMessage : increaseSendError.message;
      const isUserRejection =
        message?.toLowerCase().includes('user rejected') ||
        message?.toLowerCase().includes('user denied');

      if (!isUserRejection) {
        Sentry.captureException(increaseSendError, {
          tags: { operation: 'liquidity_increase' },
          extra: { step: 'transaction_send', message }
        });
      }

      toast.error("Increase Failed", { icon: React.createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }), description: message, action: { label: "Copy Error", onClick: () => navigator.clipboard.writeText(message || '') } });
      setIsIncreasing(false);
    }
  }, [increaseSendError]);

  useEffect(() => {
    if (!hash) return;

    if (isIncreaseConfirmed && handledIncreaseHashRef.current !== hash) {
      handledIncreaseHashRef.current = hash;
      
      // Show liquidity increased success toast with transaction link
      toast.success("Liquidity Increased", {
        icon: React.createElement(IconBadgeCheck2, { className: "h-4 w-4 text-green-500" }),
        description: `Liquidity added to existing position successfully`,
        action: hash ? {
          label: "View Transaction",
          onClick: () => window.open(getExplorerTxUrl(hash), '_blank')
        } : undefined
      });
      
      (async () => {
        let blockNumber: bigint | undefined = undefined;
        if (publicClient) {
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              const receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` });
              if (receipt) { blockNumber = receipt.blockNumber; break; }
            } catch {
              if (attempt < 4) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
            }
          }
        }
        onLiquidityIncreased({
          txHash: hash as `0x${string}`,
          blockNumber,
          increaseAmounts: increaseAmountsRef.current
        });
      })();

      if (accountAddress && currentPositionDataRef.current && hash) {
        (async () => {
          const posData = currentPositionDataRef.current!;
          const amt0 = parseFloat(increaseAmountsRef.current?.amount0 || '0');
          const amt1 = parseFloat(increaseAmountsRef.current?.amount1 || '0');
          let tvlDelta = 0;
          if (amt0 || amt1) {
            const { getTokenPrice } = await import('@/lib/swap/quote-prices');
            const [p0, p1] = await Promise.all([getTokenPrice(posData.token0Symbol), getTokenPrice(posData.token1Symbol)]);
            tvlDelta = (p0 ? amt0 * p0 : 0) + (p1 ? amt1 * p1 : 0);
          }
          let receipt: { blockNumber: bigint } | null = null;
          if (publicClient) {
            for (let attempt = 0; attempt < 5; attempt++) {
              try {
                receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` });
                if (receipt) break;
              } catch {
                if (attempt < 4) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
              }
            }
          }
          const { getPoolSubgraphId } = await import('@/lib/pools-config');
          await invalidateAfterTx(null, {
            owner: accountAddress,
            chainId: chainId!,
            poolId: getPoolSubgraphId(`${posData.token0Symbol}/${posData.token1Symbol}`) || undefined,
            positionIds: currentPositionIdRef.current ? [currentPositionIdRef.current] : undefined,
            optimisticUpdates: tvlDelta > 0 ? {
              tvlDelta,
              positionUpdates: currentPositionIdRef.current ? [{
                positionId: currentPositionIdRef.current,
                liquidity0Delta: amt0,
                liquidity1Delta: amt1
              }] : undefined
            } : undefined
          });
        })().catch(() => {});
      }
      setIsIncreasing(false);
    } else if (increaseConfirmError) {
      const message = increaseConfirmError instanceof BaseError ? increaseConfirmError.shortMessage : increaseConfirmError.message;
      toast.error("Increase Failed", { 
        id: hash,
        icon: React.createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
        description: message,
        action: { label: "Copy Error", onClick: () => navigator.clipboard.writeText(message || '') }
      });
      try { console.error('[increase] confirm error', increaseConfirmError); } catch {}
      setIsIncreasing(false);
    }
  }, [isIncreaseConfirmed, increaseConfirmError, hash, onLiquidityIncreased, accountAddress]);

  return {
    increaseLiquidity,
    isLoading: isIncreasing || isIncreaseSendPending || isIncreaseConfirming,
    isSuccess: isIncreaseConfirmed,
    error: increaseSendError || increaseConfirmError,
    hash,
    reset: resetWriteContract,
  };
} 