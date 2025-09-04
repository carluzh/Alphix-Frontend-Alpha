import React, { useState, useCallback, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSignTypedData } from 'wagmi';
import { toast } from 'sonner';
import { V4PositionPlanner, V4PositionManager, Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';
import { TickMath } from '@uniswap/v3-sdk';
import { Token, Ether, CurrencyAmount, Percent } from '@uniswap/sdk-core';
import { V4_POSITION_MANAGER_ADDRESS, EMPTY_BYTES, V4_POSITION_MANAGER_ABI, PERMIT2_ADDRESS, Permit2Abi_allowance } from '@/lib/swap-constants';
import { getToken, TokenSymbol, getTokenSymbolByAddress } from '@/lib/pools-config';
import { baseSepolia } from '@/lib/wagmiConfig';
import { getAddress, type Hex, BaseError, parseUnits, encodeAbiParameters, keccak256 } from 'viem';
import { getPositionDetails, getPoolState, preparePermit2BatchForPosition } from '@/lib/liquidity-utils';
import { publicClient } from '@/lib/viemClient';
import { prefetchService } from '@/lib/prefetch-service';
import { invalidateActivityCache, invalidateUserPositionsCache, invalidateUserPositionIdsCache } from '@/lib/client-cache';
import { OctagonX } from 'lucide-react';

// Helper function to safely parse amounts without precision loss
const safeParseUnits = (amount: string, decimals: number): bigint => {
  const cleaned = (amount || '').toString().replace(/,/g, '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '< 0.0001') return 0n;
  return parseUnits(cleaned, decimals);
};
import JSBI from 'jsbi';

interface UseIncreaseLiquidityProps {
  onLiquidityIncreased: (info?: { txHash?: `0x${string}`; blockNumber?: bigint }) => void;
}

export interface IncreasePositionData {
  tokenId: string | number;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  additionalAmount0: string; // New amount to add
  additionalAmount1: string; // New amount to add
  // Position parameters needed to query the NFT token ID
  poolId: string;
  tickLower: number;
  tickUpper: number;
  salt?: string;
}

type IncreaseOptions = { slippageBps?: number; deadlineSeconds?: number };

export function useIncreaseLiquidity({ onLiquidityIncreased }: UseIncreaseLiquidityProps) {
  const { address: accountAddress, chainId } = useAccount();
  const { data: hash, writeContract, isPending: isIncreaseSendPending, error: increaseSendError, reset: resetWriteContract } = useWriteContract();
  const { isLoading: isIncreaseConfirming, isSuccess: isIncreaseConfirmed, error: increaseConfirmError, status: waitForTxStatus } = useWaitForTransactionReceipt({ hash });
  const { signTypedDataAsync } = useSignTypedData();

  // Log minimal useAccount details for debugging
  useEffect(() => {
    console.log("useAccount:", { accountAddress, chainId });
  }, [accountAddress, chainId]);

  const [isIncreasing, setIsIncreasing] = useState(false);

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
      toast.error("Wallet not connected. Please connect your wallet and try again.");
      return;
    }
    if (!V4_POSITION_MANAGER_ADDRESS) {
      toast.error("Configuration Error: Position Manager address not set.");
      return;
    }

    setIsIncreasing(true);

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
      const details = await getPositionDetails(nftTokenId);
      // Build currencies strictly in poolKey order to avoid side mixups
      const symC0 = getTokenSymbolByAddress(getAddress(details.poolKey.currency0));
      const symC1 = getTokenSymbolByAddress(getAddress(details.poolKey.currency1));
      if (!symC0 || !symC1) throw new Error('Token symbols not found for pool currencies');
      const defC0 = getToken(symC0)!;
      const defC1 = getToken(symC1)!;
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
      const state = await getPoolState(poolId);

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

      let amount0RawUser = safeParseUnits(positionData.additionalAmount0 || '0', token0Def.decimals);
      let amount1RawUser = safeParseUnits(positionData.additionalAmount1 || '0', token1Def.decimals);
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
        toast.error('Please enter a valid amount to add');
        setIsIncreasing(false);
        return;
      }
      // Map user-entered amounts to poolKey order
      let amountC0Raw = positionData.token0Symbol === symC0 ? amount0RawUser : amount1RawUser;
      let amountC1Raw = positionData.token1Symbol === symC1 ? amount1RawUser : amount0RawUser;

      // Ensure the non-active side cannot be the binding constraint in-range by bumping it to the required minimum
      try {
        const sqrtA = TickMath.getSqrtRatioAtTick(details.tickLower);
        const sqrtB = TickMath.getSqrtRatioAtTick(details.tickUpper);
        const sqrtP = JSBI.BigInt(state.sqrtPriceX96.toString());

        const ZERO = JSBI.BigInt(0);
        const mul = (a: JSBI, b: JSBI) => JSBI.multiply(a, b);
        const add = (a: JSBI, b: JSBI) => JSBI.add(a, b);
        const sub = (a: JSBI, b: JSBI) => JSBI.subtract(a, b);
        const div = (a: JSBI, b: JSBI) => JSBI.divide(a, b);
        const ceilDiv = (a: JSBI, b: JSBI) => div(add(a, sub(b, JSBI.BigInt(1))), b);

        const inRange = JSBI.greaterThan(sqrtP, sqrtA) && JSBI.lessThan(sqrtP, sqrtB);
        if (inRange) {
          // L_from0 = amt0 * (sqrtP*sqrtB)/(sqrtB - sqrtP)
          const amt0JSBI = JSBI.BigInt(amountC0Raw.toString());
          const amt1JSBI = JSBI.BigInt(amountC1Raw.toString());
          const num0 = mul(amt0JSBI, mul(sqrtP, sqrtB));
          const den0 = sub(sqrtB, sqrtP);
          const L0 = den0 === ZERO ? ZERO : div(num0, den0);
          // L_from1 = amt1 / (sqrtP - sqrtA)
          const den1 = sub(sqrtP, sqrtA);
          const L1 = den1 === ZERO ? ZERO : div(amt1JSBI, den1);

          // If token1 is binding (L1 < L0) while user provided token0, bump amt1 to required
          if (JSBI.greaterThan(L0, L1) && amountC0Raw > 0n) {
            // required1 = ceil(L0 * (sqrtP - sqrtA))
            const req1 = ceilDiv(mul(L0, den1), JSBI.BigInt(1));
            const req1Big = BigInt(JSBI.toNumber(req1));
            if (req1Big > amountC1Raw) {
              amountC1Raw = req1Big;
            }
          }
          // If token0 is binding while user provided token1, bump amt0 to required
          if (JSBI.greaterThan(L1, L0) && amountC1Raw > 0n) {
            // required0 = ceil(L1 * (sqrtB - sqrtP) / (sqrtP*sqrtB))
            const num = mul(L1, sub(sqrtB, sqrtP));
            const den = mul(sqrtP, sqrtB);
            const req0 = ceilDiv(num, den);
            const req0Big = BigInt(JSBI.toNumber(req0));
            if (req0Big > amountC0Raw) {
              amountC0Raw = req0Big;
            }
          }
        }
      } catch {}
      const amt0 = CurrencyAmount.fromRawAmount(currency0, amountC0Raw.toString());
      const amt1 = CurrencyAmount.fromRawAmount(currency1, amountC1Raw.toString());

      const position = V4Position.fromAmounts({
        pool,
        tickLower: details.tickLower,
        tickUpper: details.tickUpper,
        amount0: amt0.quotient,
        amount1: amt1.quotient,
        useFullPrecision: true,
      });

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
      try {
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
          const prepared = await preparePermit2BatchForPosition(nftTokenId, accountAddress as `0x${string}`, chainId, deadline);
          if (prepared?.message?.details && prepared.message.details.length > 0) {
            const signature = await signTypedDataAsync({
              domain: prepared.domain as any,
              types: prepared.types as any,
              primaryType: prepared.primaryType,
              message: prepared.message as any,
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
      const addOptions: any = {
        slippageTolerance: slippage,
        deadline: String(deadline),
        hookData: '0x',
        tokenId: nftTokenId.toString(),
        ...addOptionsBatch,
        ...(isNativeC0 ? { useNative: Ether.onChain(chainId) } : {}),
      };

      const { calldata, value } = V4PositionManager.addCallParameters(position, addOptions) as { calldata: Hex; value: string | number | bigint };

      resetWriteContract();
      writeContract({
        address: V4_POSITION_MANAGER_ADDRESS as Hex,
        abi: V4_POSITION_MANAGER_ABI,
        functionName: 'multicall',
        args: [[calldata] as Hex[]],
        value: BigInt(value || 0),
        chainId,
      } as any);

      // No intermediate toasts

    } catch (error: any) {
      console.error("Error preparing increase transaction:", error);
      const msg = (error?.message || '').toString();
      if ((error as any)?.__zero || msg.includes('ZERO_LIQUIDITY')) {
        toast.error("Try a larger Amount", { icon: React.createElement(OctagonX, { className: 'h-4 w-4 text-red-500' }) });
      } else {
        toast.error("Increase Failed", { description: msg || "Could not prepare the transaction." });
      }
      setIsIncreasing(false);
    }
  }, [accountAddress, chainId, writeContract, resetWriteContract, getTokenIdFromPosition]);

  useEffect(() => {
    if (increaseSendError) {
      const message = increaseSendError instanceof BaseError ? increaseSendError.shortMessage : increaseSendError.message;
      toast.error("Increase Failed", { description: message });
      setIsIncreasing(false);
    }
  }, [increaseSendError]);

  useEffect(() => {
    if (!hash) return;

    if (isIncreaseConfirmed) {
      // Delegate the sole success toast to page-level logic
      (async () => {
        let blockNumber: bigint | undefined = undefined;
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` });
          blockNumber = receipt?.blockNumber;
        } catch {}
        onLiquidityIncreased({ txHash: hash as `0x${string}`, blockNumber });
      })();
      try { if (accountAddress) prefetchService.requestPositionsRefresh({ owner: accountAddress, reason: 'increase' }); } catch {}
      try { if (accountAddress) invalidateActivityCache(accountAddress); } catch {}
      // CRITICAL: Invalidate global batch cache after liquidity increase
      try {
        fetch('/api/internal/revalidate-pools', { method: 'POST' }).catch(() => {});
      } catch {}
      try { if (accountAddress) { invalidateUserPositionsCache(accountAddress); invalidateUserPositionIdsCache(accountAddress); } } catch {}
      // Removed hook-level revalidate to avoid duplicates; page handles revalidation after subgraph sync
      setIsIncreasing(false);
    } else if (increaseConfirmError) {
      const message = increaseConfirmError instanceof BaseError ? increaseConfirmError.shortMessage : increaseConfirmError.message;
      toast.error("Increase Failed", {
        id: hash,
        description: message,
        action: baseSepolia?.blockExplorers?.default?.url 
          ? { label: "View Tx", onClick: () => window.open(`${baseSepolia.blockExplorers.default.url}/tx/${hash}`, '_blank') }
          : undefined,
      });
      setIsIncreasing(false);
    }
  }, [isIncreaseConfirmed, increaseConfirmError, hash, onLiquidityIncreased, accountAddress]);

  return {
    increaseLiquidity,
    isLoading: isIncreasing || isIncreaseSendPending || isIncreaseConfirming,
    isSuccess: isIncreaseConfirmed,
    error: increaseSendError || increaseConfirmError,
    hash,
  };
} 