import { useState, useCallback, useEffect, useRef } from 'react';
import React from 'react';
import { OctagonX } from 'lucide-react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { toast } from 'sonner';
import { V4PositionPlanner, V4PositionManager, Pool as V4Pool, Position as V4Position } from '@uniswap/v4-sdk';
import { TickMath } from '@uniswap/v3-sdk';
import { Token, Percent } from '@uniswap/sdk-core';
import { V4_POSITION_MANAGER_ADDRESS, EMPTY_BYTES, V4_POSITION_MANAGER_ABI } from '@/lib/swap-constants';
import { getToken, TokenSymbol, getTokenSymbolByAddress } from '@/lib/pools-config';
import { baseSepolia } from '@/lib/wagmiConfig';
import { getAddress, type Hex, BaseError, parseUnits, encodeAbiParameters, keccak256 } from 'viem';
import { getPositionDetails, getPoolState } from '@/lib/liquidity-utils';
import { prefetchService } from '@/lib/prefetch-service';
import { invalidateActivityCache, invalidateUserPositionsCache, invalidateUserPositionIdsCache } from '@/lib/client-cache';
import { publicClient } from '@/lib/viemClient';

// Helper function to safely parse amounts without precision loss
const safeParseUnits = (amount: string, decimals: number): bigint => {
  const cleaned = (amount || '').toString().replace(/,/g, '').trim();
  if (!cleaned || cleaned === '.' || cleaned === '< 0.0001') return 0n;
  return parseUnits(cleaned, decimals);
};
import JSBI from 'jsbi';

interface UseDecreaseLiquidityProps {
  onLiquidityDecreased: (info?: { txHash?: `0x${string}`; blockNumber?: bigint }) => void;
  onFeesCollected?: () => void;
}

export interface DecreasePositionData {
  tokenId: string | number;
  token0Symbol: TokenSymbol;
  token1Symbol: TokenSymbol;
  decreaseAmount0: string; // Amount to remove
  decreaseAmount1: string; // Amount to remove
  isFullBurn: boolean; // Whether this is a full position burn
  // Position parameters needed to query the NFT token ID
  poolId: string;
  tickLower: number;
  tickUpper: number;
  salt?: string;
  // When true, perform a collect-only operation (decrease liquidity by 0) to claim fees
  collectOnly?: boolean;
  // Optional: current position token balances for proportional in-range decreases
  positionToken0Amount?: string;
  positionToken1Amount?: string;
  // Which side the user actually edited in the UI: 'token0' or 'token1'
  enteredSide?: 'token0' | 'token1';
}

type DecreaseOptions = { slippageBps?: number; deadlineSeconds?: number };

export function useDecreaseLiquidity({ onLiquidityDecreased, onFeesCollected }: UseDecreaseLiquidityProps) {
  const { address: accountAddress, chainId } = useAccount();
  const { data: hash, writeContract, isPending: isDecreaseSendPending, error: decreaseSendError, reset: resetWriteContract } = useWriteContract();
  const { isLoading: isDecreaseConfirming, isSuccess: isDecreaseConfirmed, error: decreaseConfirmError, status: waitForTxStatus } = useWaitForTransactionReceipt({ hash });

  // (debug logging removed)

  const [isDecreasing, setIsDecreasing] = useState(false);
  const lastWasCollectOnly = useRef(false);
  const isCompoundRef = useRef(false);

  // Helper function to get the NFT token ID from position parameters
  const getTokenIdFromPosition = useCallback(async (positionData: DecreasePositionData): Promise<bigint> => {
    const raw = positionData.tokenId.toString();
    // If it's a pure number string (or number), use directly
    if (!raw.includes('-')) {
      try {
        const direct = BigInt(raw);
        if (direct > 0n) return direct;
      } catch {}
    }
    // If it's a composite id with hyphens, take the last segment; if hex-like use as hex, else as decimal
    const parts = raw.split('-');
    const last = parts[parts.length - 1];
    try {
      if (last.startsWith('0x') || last.startsWith('0X')) {
        const tokenId = BigInt(last);
        if (tokenId > 0n) return tokenId;
      } else {
        const tokenId = BigInt(last);
        if (tokenId > 0n) return tokenId;
      }
    } catch (e) {
      console.warn('Failed to parse token ID from', raw, 'last segment', last);
    }
    throw new Error('Unable to determine NFT token ID from position data.');
  }, []);

  const decreaseLiquidity = useCallback(async (positionData: DecreasePositionData, decreasePercentage: number, opts?: DecreaseOptions) => {
    if (!accountAddress || !chainId) {
      toast.error("Wallet not connected. Please connect your wallet and try again.");
      return;
    }
    if (!V4_POSITION_MANAGER_ADDRESS) {
      toast.error("Configuration Error: Position Manager address not set.");
      return;
    }

    setIsDecreasing(true);
    const actionName = positionData.isFullBurn ? "burn" : (positionData.collectOnly ? "collect" : "decrease");
    lastWasCollectOnly.current = !!positionData.collectOnly;

    try {
      // Only use percentage path if user did NOT specify explicit token amounts
      const userSpecifiedAmounts = (
        (positionData.decreaseAmount0 && parseFloat(positionData.decreaseAmount0) > 0) ||
        (positionData.decreaseAmount1 && parseFloat(positionData.decreaseAmount1) > 0)
      );
      const isPercentage = (decreasePercentage > 0 && decreasePercentage <= 100) && !userSpecifiedAmounts;
      
      const token0Def = getToken(positionData.token0Symbol);
      const token1Def = getToken(positionData.token1Symbol);

      if (!token0Def || !token1Def) {
        throw new Error("Token definitions not found for one or both tokens in the position.");
      }
      if (!token0Def.address || !token1Def.address) {
        throw new Error("Token addresses are missing in definitions.");
      }

      // Revert to original chainId usage, rely on wagmi's type for Token constructor
      const sdkToken0 = new Token(chainId, getAddress(token0Def.address), token0Def.decimals, token0Def.symbol); 
      const sdkToken1 = new Token(chainId, getAddress(token1Def.address), token1Def.decimals, token1Def.symbol); 
      const [sortedSdkToken0, sortedSdkToken1] = sdkToken0.sortsBefore(sdkToken1)
        ? [sdkToken0, sdkToken1]
        : [sdkToken1, sdkToken0];

      const planner = new V4PositionPlanner();
      
      // Get the actual NFT token ID with timeout
      const nftTokenId = await Promise.race([
        getTokenIdFromPosition(positionData),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Failed to resolve token ID. Please try again.')), 10000)
        )
      ]);
      
      const tokenIdJSBI = JSBI.BigInt(nftTokenId.toString());

      // Preferred v4 SDK path: percentage-based removeCallParameters
      // Case A: explicit percentage with no explicit token amounts → use percentage directly
      if (isPercentage && !userSpecifiedAmounts) {
        try {
          // 1) Load on-chain position details and resolve poolKey token metadata by ADDRESS (not UI order)
          const details = await getPositionDetails(nftTokenId);
          const symC0 = getTokenSymbolByAddress(getAddress(details.poolKey.currency0));
          const symC1 = getTokenSymbolByAddress(getAddress(details.poolKey.currency1));
          if (!symC0 || !symC1) throw new Error('Token definitions not found for pool currencies');
          const defC0 = getToken(symC0);
          const defC1 = getToken(symC1);
          if (!defC0 || !defC1) throw new Error('Token configs missing for pool currencies');
          const t0 = new Token(chainId, getAddress(details.poolKey.currency0), defC0.decimals, defC0.symbol);
          const t1 = new Token(chainId, getAddress(details.poolKey.currency1), defC1.decimals, defC1.symbol);

          // 2) Build PoolKey and compute poolId to fetch state
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

          // 3) Build Pool and Position
          // Build Pool and Position strictly per guide semantics
          const pool = new V4Pool(
            t0, t1,
            Number(details.poolKey.fee),
            Number(details.poolKey.tickSpacing),
            getAddress(details.poolKey.hooks),
            JSBI.BigInt(state.sqrtPriceX96.toString()),
            JSBI.BigInt(state.liquidity.toString()),
            state.tick,
          );
          const position = new V4Position({
            pool,
            tickLower: Number(details.tickLower),
            tickUpper: Number(details.tickUpper),
            liquidity: JSBI.BigInt(details.liquidity.toString()),
          });

          // 4) Options: use percentage and burn flag; include slippage/deadline
          // Derive an accurate percentage from desired amounts at current price (ceil to avoid under-delivery)
          const desired0Raw = safeParseUnits(positionData.decreaseAmount0 || '0', token0Def.decimals);
          const desired1Raw = safeParseUnits(positionData.decreaseAmount1 || '0', token1Def.decimals);
          // Build sqrt ratios for full-withdraw math
          const sqrtP = JSBI.BigInt(state.sqrtPriceX96.toString());
          const sqrtA = TickMath.getSqrtRatioAtTick(details.tickLower);
          const sqrtB = TickMath.getSqrtRatioAtTick(details.tickUpper);
          const L = JSBI.BigInt(details.liquidity.toString());
          let amount0Full = JSBI.BigInt(0);
          let amount1Full = JSBI.BigInt(0);
          const Q96 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96));
          if (JSBI.lessThanOrEqual(sqrtP, sqrtA)) {
            // amount0 = (L * (sqrtB - sqrtA) * Q96) / (sqrtA * sqrtB)
            const num = JSBI.multiply(JSBI.multiply(L, JSBI.subtract(sqrtB, sqrtA)), Q96);
            const den = JSBI.multiply(sqrtA, sqrtB);
            amount0Full = JSBI.divide(num, den);
          } else if (JSBI.greaterThanOrEqual(sqrtP, sqrtB)) {
            // amount1 = (L * (sqrtB - sqrtA)) / Q96
            amount1Full = JSBI.divide(JSBI.multiply(L, JSBI.subtract(sqrtB, sqrtA)), Q96);
          } else {
            // amount0 = (L * (sqrtB - sqrtP) * Q96) / (sqrtP * sqrtB)
            const num0 = JSBI.multiply(JSBI.multiply(L, JSBI.subtract(sqrtB, sqrtP)), Q96);
            const den0 = JSBI.multiply(sqrtP, sqrtB);
            amount0Full = JSBI.divide(num0, den0);
            // amount1 = (L * (sqrtP - sqrtA)) / Q96
            amount1Full = JSBI.divide(JSBI.multiply(L, JSBI.subtract(sqrtP, sqrtA)), Q96);
          }
          const SCALE = JSBI.BigInt(10_000);
          const uiT0Addr = getAddress(token0Def.address);
          const poolC0Addr = getAddress(details.poolKey.currency0);
          const desiredPool0Raw = uiT0Addr === poolC0Addr ? desired0Raw : desired1Raw;
          const desiredPool1Raw = uiT0Addr === poolC0Addr ? desired1Raw : desired0Raw;
          const ceilRatioToBps = (desiredRaw: bigint, fullJSBI: JSBI) => {
            if (desiredRaw <= 0n || JSBI.equal(fullJSBI, JSBI.BigInt(0))) return JSBI.BigInt(0);
            const mul = JSBI.multiply(JSBI.BigInt(desiredRaw.toString()), SCALE);
            const ceil = JSBI.add(mul, JSBI.subtract(fullJSBI, JSBI.BigInt(1)));
            return JSBI.divide(ceil, fullJSBI);
          };
          let pctBpsJSBI: JSBI;
          if (isPercentage && !userSpecifiedAmounts) {
            // honor explicit percentage (0..100 => 0..10000 bps)
            const bps = Math.max(1, Math.min(10000, Math.floor(decreasePercentage * 100)));
            pctBpsJSBI = JSBI.BigInt(bps.toString());
          } else {
            // derive from desired token amounts
            if (positionData.enteredSide === 'token0') {
              pctBpsJSBI = ceilRatioToBps(desiredPool0Raw, amount0Full);
            } else if (positionData.enteredSide === 'token1') {
              pctBpsJSBI = ceilRatioToBps(desiredPool1Raw, amount1Full);
            } else {
              const r0 = ceilRatioToBps(desiredPool0Raw, amount0Full);
              const r1 = ceilRatioToBps(desiredPool1Raw, amount1Full);
              pctBpsJSBI = JSBI.greaterThan(r0, r1) ? r0 : r1;
            }
          }
          // Compute percentage to remove: if user entered side exists, use that ratio; else use max ratio
          const pctBps = Math.max(1, Math.min(10000, Number(pctBpsJSBI.toString()) || 1));
          const liquidityPercentage = new Percent(pctBps, 10_000);
          // Use guide default slippage (e.g., 0.5%) for safety
          const slippagePct = new Percent(Math.max(0, Math.min(10_000, opts?.slippageBps ?? 50)), 10_000);
          const deadline = (opts?.deadlineSeconds && opts.deadlineSeconds > 0)
            ? Math.floor(Date.now() / 1000) + opts.deadlineSeconds
            : Math.floor(Date.now() / 1000) + 20 * 60; // 20 minutes default
          const removeOptions = {
            slippageTolerance: slippagePct,
            deadline: String(deadline),
            hookData: '0x' as Hex,
            tokenId: nftTokenId.toString(),
            liquidityPercentage,
            burnToken: pctBps === 10000 && !!positionData.isFullBurn,
          } as const;

          // (debug logging removed)

          const { calldata, value } = V4PositionManager.removeCallParameters(position, removeOptions) as { calldata: Hex; value: string | number | bigint };

          resetWriteContract();
          writeContract({
            address: V4_POSITION_MANAGER_ADDRESS as Hex,
            abi: V4_POSITION_MANAGER_ABI,
            functionName: 'multicall',
            args: [[calldata] as Hex[]],
            value: BigInt(value || 0),
            chainId,
          } as any);
          return; // Done via removeCallParameters path
        } catch (e) {
          console.warn('removeCallParameters path failed, falling back to planner path:', e);
        }
      }

      // Case B REMOVED: for explicit amounts we use planner path below to honor min-outs on entered side.

      if (positionData.isFullBurn) {
        // Fallback full burn via planner
        const amount0MinJSBI = JSBI.BigInt(0);
        const amount1MinJSBI = JSBI.BigInt(0);
        planner.addBurn(tokenIdJSBI, amount0MinJSBI, amount1MinJSBI, EMPTY_BYTES || '0x');
      } else {
        // Partial decrease: compute liquidity to remove using on-chain math for exact amounts (in-range),
        // fallback to server calc if needed
        let liquidityJSBI: JSBI;

        if (positionData.collectOnly) {
          liquidityJSBI = JSBI.BigInt(0);
        } else {
          // In-range: compute required liquidity from desired token amounts using current pool state; OOR: server calc
          try {
            const details = await getPositionDetails(nftTokenId);
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

            const inRange = state.tick >= details.tickLower && state.tick <= details.tickUpper;

            if (inRange) {
              // Build sqrt ratios and totals
              const sqrtP = JSBI.BigInt(state.sqrtPriceX96.toString());
              const sqrtA = TickMath.getSqrtRatioAtTick(details.tickLower);
              const sqrtB = TickMath.getSqrtRatioAtTick(details.tickUpper);
              const L = JSBI.BigInt(details.liquidity.toString());

              // Full withdraw amounts at current P
              let amount0Full = JSBI.BigInt(0);
              let amount1Full = JSBI.BigInt(0);
              const Q96 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96));
              if (JSBI.lessThanOrEqual(sqrtP, sqrtA)) {
                // amount0 = (L * (sqrtB - sqrtA) * Q96) / (sqrtA * sqrtB)
                const n = JSBI.multiply(JSBI.multiply(L, JSBI.subtract(sqrtB, sqrtA)), Q96);
                const d = JSBI.multiply(sqrtA, sqrtB);
                amount0Full = JSBI.divide(n, d);
              } else if (JSBI.greaterThanOrEqual(sqrtP, sqrtB)) {
                // amount1 = (L * (sqrtB - sqrtA)) / Q96
                amount1Full = JSBI.divide(JSBI.multiply(L, JSBI.subtract(sqrtB, sqrtA)), Q96);
              } else {
                // amount0 = (L * (sqrtB - sqrtP) * Q96) / (sqrtP * sqrtB)
                const n0 = JSBI.multiply(JSBI.multiply(L, JSBI.subtract(sqrtB, sqrtP)), Q96);
                const d0 = JSBI.multiply(sqrtP, sqrtB);
                amount0Full = JSBI.divide(n0, d0);
                // amount1 = (L * (sqrtP - sqrtA)) / Q96
                amount1Full = JSBI.divide(JSBI.multiply(L, JSBI.subtract(sqrtP, sqrtA)), Q96);
              }

              // Map desired to pool sides
              const userDesired0Raw = safeParseUnits(positionData.decreaseAmount0 || '0', token0Def.decimals);
              const userDesired1Raw = safeParseUnits(positionData.decreaseAmount1 || '0', token1Def.decimals);
              const poolC0 = getAddress(details.poolKey.currency0);
              const uiT0Addr = getAddress(token0Def.address);
              const desiredPool0Raw = uiT0Addr === poolC0 ? userDesired0Raw : userDesired1Raw;
              const desiredPool1Raw = uiT0Addr === poolC0 ? userDesired1Raw : userDesired0Raw;

              // ratio selection: drive strictly from the user-entered side to avoid overshooting the other side
              const SCALE = JSBI.BigInt(1_000_000_000);
              const zero = JSBI.BigInt(0);
              let r0 = zero, r1 = zero;
              if (!JSBI.equal(amount0Full, zero) && desiredPool0Raw > 0n) {
                r0 = JSBI.divide(JSBI.multiply(JSBI.BigInt(desiredPool0Raw.toString()), SCALE), amount0Full);
              }
              if (!JSBI.equal(amount1Full, zero) && desiredPool1Raw > 0n) {
                r1 = JSBI.divide(JSBI.multiply(JSBI.BigInt(desiredPool1Raw.toString()), SCALE), amount1Full);
              }
              let ratio = r0; // default to token0 side
              const uiT0AddrLocal = getAddress(token0Def.address);
              const enteredIsPool0 = positionData.enteredSide === 'token0' ? (uiT0AddrLocal === poolC0) : (uiT0AddrLocal !== poolC0);
              if (positionData.enteredSide === 'token1') {
                ratio = r1;
              } else if (positionData.enteredSide === 'token0') {
                ratio = r0;
              } else {
                // if no entered side, fall back to max to satisfy both
                ratio = JSBI.greaterThan(r0, r1) ? r0 : r1;
              }
              const num = JSBI.multiply(L, ratio);
              // Use floor here to avoid overshooting the entered-side amount
              liquidityJSBI = JSBI.divide(num, SCALE);

              if (JSBI.equal(liquidityJSBI, zero) && (desiredPool0Raw > 0n || desiredPool1Raw > 0n)) {
                liquidityJSBI = JSBI.BigInt(1);
              }
            } else {
              // OOR: use stable server calc
              const inputSide = (positionData.decreaseAmount0 && parseFloat(positionData.decreaseAmount0) > 0)
                ? { amount: positionData.decreaseAmount0, symbol: positionData.token0Symbol }
                : (positionData.decreaseAmount1 && parseFloat(positionData.decreaseAmount1) > 0)
                  ? { amount: positionData.decreaseAmount1, symbol: positionData.token1Symbol }
                  : null;
              if (!inputSide) throw new Error('No non-zero decrease amount specified');
              const calcResponse = await fetch('/api/liquidity/calculate-liquidity-parameters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  token0Symbol: positionData.token0Symbol,
                  token1Symbol: positionData.token1Symbol,
                  inputAmount: inputSide.amount,
                  inputTokenSymbol: inputSide.symbol,
                  userTickLower: positionData.tickLower,
                  userTickUpper: positionData.tickUpper,
                  chainId: chainId,
                }),
              });
              if (!calcResponse.ok) throw new Error(await calcResponse.text());
              const result = await calcResponse.json();
              liquidityJSBI = JSBI.BigInt(result.liquidity);
            }
          } catch (e2) {
            console.error('Amounts-mode decrease calc failed; conservative fallback:', e2);
            const amount0Raw = safeParseUnits(positionData.decreaseAmount0 || '0', token0Def.decimals);
            const amount1Raw = safeParseUnits(positionData.decreaseAmount1 || '0', token1Def.decimals);
            const maxAmountRaw = amount0Raw > amount1Raw ? amount0Raw : amount1Raw;
            const estimated = JSBI.divide(JSBI.BigInt(maxAmountRaw.toString()), JSBI.BigInt(10));
            liquidityJSBI = JSBI.greaterThan(estimated, JSBI.BigInt(1)) ? estimated : JSBI.BigInt(1);
          }
        }

        // Enforce requested amounts via minimums (1-wei tolerance).
        // Detect OOR to avoid mins on non-productive side; in-range: enforce only the user-entered side to avoid over-constraints.
        let outOfRangeBelow = false;
        let outOfRangeAbove = false;
        let inRange = false;
        try {
          const details = await getPositionDetails(nftTokenId);
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
          outOfRangeBelow = state.tick < details.tickLower;
          outOfRangeAbove = state.tick > details.tickUpper;
          inRange = !outOfRangeBelow && !outOfRangeAbove;
        } catch {}

        // Map user-entered desired amounts to poolKey token sides
        const userDesired0Raw = safeParseUnits(positionData.decreaseAmount0 || '0', token0Def.decimals);
        const userDesired1Raw = safeParseUnits(positionData.decreaseAmount1 || '0', token1Def.decimals);
        const { poolKey } = await getPositionDetails(nftTokenId);
        const poolC0 = getAddress(poolKey.currency0);
        const poolC1 = getAddress(poolKey.currency1);
        const uiT0Addr = getAddress(token0Def.address);
        const desiredPool0Raw = uiT0Addr === poolC0 ? userDesired0Raw : userDesired1Raw;
        // BUGFIX: compare against poolC0 for mapping; if UI token0 is poolC0 then pool1 is UI token1, else UI token0 maps to pool1
        const desiredPool1Raw = uiT0Addr === poolC0 ? userDesired1Raw : userDesired0Raw;

        // Choose min-outs strictly from the side the user actually provided (>0). If both provided, prefer entered side only.
        let minPool0Raw: bigint = 0n;
        let minPool1Raw: bigint = 0n;
        // Tolerance helper: subtract max(0.01% of desired, 3 wei) to avoid MinimumAmountInsufficient from rounding
        const applyTolerance = (desired: bigint): bigint => {
          if (desired <= 0n) return 0n;
          const pct01bp = desired / 10000n; // 0.01%
          const cushion = pct01bp > 3n ? pct01bp : 3n;
          return desired > cushion ? desired - cushion : 0n;
        };
        if (outOfRangeBelow) {
          // OOR below: only pool0 productive
          minPool0Raw = applyTolerance(desiredPool0Raw);
          minPool1Raw = 0n;
        } else if (outOfRangeAbove) {
          // OOR above: only pool1 productive
          minPool0Raw = 0n;
          minPool1Raw = applyTolerance(desiredPool1Raw);
        } else {
          // In-range: enforce only the user-entered side if provided
          if (positionData.enteredSide === 'token0') {
            const enteredDesired = uiT0Addr === poolC0 ? desiredPool0Raw : desiredPool1Raw;
            if (enteredDesired > 0n) {
              if (uiT0Addr === poolC0) {
                minPool0Raw = applyTolerance(enteredDesired);
                minPool1Raw = 0n;
              } else {
                minPool1Raw = applyTolerance(enteredDesired);
                minPool0Raw = 0n;
              }
            }
          } else if (positionData.enteredSide === 'token1') {
            const enteredDesired = uiT0Addr === poolC0 ? desiredPool1Raw : desiredPool0Raw;
            if (enteredDesired > 0n) {
              if (uiT0Addr === poolC0) {
                minPool1Raw = applyTolerance(enteredDesired);
                minPool0Raw = 0n;
              } else {
                minPool0Raw = applyTolerance(enteredDesired);
                minPool1Raw = 0n;
              }
            }
          } else {
            // No entered side: keep mins at 0 to avoid accidental underflows
            minPool0Raw = 0n;
            minPool1Raw = 0n;
          }
        }

        // Map pool token mins to sorted order used by planner
        const sorted0IsPool0 = getAddress(sortedSdkToken0.address) === poolC0;
        const amountMinSorted0 = JSBI.BigInt((sorted0IsPool0 ? minPool0Raw : minPool1Raw).toString());
        const amountMinSorted1 = JSBI.BigInt((sorted0IsPool0 ? minPool1Raw : minPool0Raw).toString());
        planner.addDecrease(tokenIdJSBI, liquidityJSBI, amountMinSorted0, amountMinSorted1, EMPTY_BYTES || '0x');
      }
      
      // Check if we're dealing with native ETH
      const hasNativeETH = token0Def.address === "0x0000000000000000000000000000000000000000" || 
                          token1Def.address === "0x0000000000000000000000000000000000000000";
      
      // Take the tokens back to the user's wallet in sorted order
      planner.addTakePair(sortedSdkToken0.wrapped, sortedSdkToken1.wrapped, accountAddress);
      
      // For native ETH positions, we need to add a SWEEP to collect any native ETH
      if (hasNativeETH && getAddress(sortedSdkToken0.address) === '0x0000000000000000000000000000000000000000') {
        planner.addSweep(sortedSdkToken0.wrapped, accountAddress);
      } else if (hasNativeETH && getAddress(sortedSdkToken1.address) === '0x0000000000000000000000000000000000000000') {
        planner.addSweep(sortedSdkToken1.wrapped, accountAddress);
      }

      resetWriteContract(); 
      
      // Calculate deadline (60 seconds from now)
      const deadline = Math.floor(Date.now() / 1000) + 60;
      
      // Encode actions and params into single bytes for modifyLiquidities
      const unlockData = planner.finalize();
      
      // (debug logging removed)
      
      writeContract({
        address: V4_POSITION_MANAGER_ADDRESS as Hex,
        abi: V4_POSITION_MANAGER_ABI,
        functionName: 'modifyLiquidities',
        args: [unlockData as Hex, deadline],
        chainId: chainId,
      });
    } catch (error: any) {
      console.error(`Error preparing ${actionName} transaction:`, error);
      const errorMessage = error.message || `Could not prepare the ${actionName} transaction.`;
      toast.error(`${actionName.charAt(0).toUpperCase() + actionName.slice(1)} Preparation Failed`, { 
        description: errorMessage 
      });
      setIsDecreasing(false);
    }
  }, [accountAddress, chainId, writeContract, resetWriteContract, getTokenIdFromPosition]);

  useEffect(() => {
    if (decreaseSendError) {
      const message = decreaseSendError instanceof BaseError ? decreaseSendError.shortMessage : decreaseSendError.message;
      toast.error("Withdraw Failed", { description: message });
      setIsDecreasing(false);
    }
  }, [decreaseSendError]);

  useEffect(() => {
    if (!hash) return;

    if (isDecreaseConfirmed) {
      (async () => {
        let blockNumber: bigint | undefined = undefined;
        try {
          const receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` });
          blockNumber = receipt?.blockNumber;
        } catch {}
        if (isCompoundRef.current) {
          toast.success("Compound Success", {
            id: hash,
            description: "Fees added back to your position.",
            action: baseSepolia?.blockExplorers?.default?.url 
              ? { label: "View Tx", onClick: () => window.open(`${baseSepolia.blockExplorers.default.url}/tx/${hash}`, '_blank') }
              : undefined,
          });
          onLiquidityDecreased({ txHash: hash as `0x${string}`, blockNumber } as any);
          try { if (accountAddress) prefetchService.requestPositionsRefresh({ owner: accountAddress, reason: 'compound' }); } catch {}
          isCompoundRef.current = false;
        } else {
          if (lastWasCollectOnly.current && onFeesCollected) {
            onFeesCollected();
          } else {
            onLiquidityDecreased({ txHash: hash as `0x${string}`, blockNumber } as any);
          }
        }
      })();
      try { if (accountAddress) prefetchService.requestPositionsRefresh({ owner: accountAddress, reason: lastWasCollectOnly.current ? 'collect' : 'decrease' }); } catch {}
      try { if (accountAddress) invalidateActivityCache(accountAddress); } catch {}
      // CRITICAL: Invalidate global batch cache after liquidity decrease
      try {
        fetch('/api/internal/revalidate-pools', { method: 'POST' }).catch(() => {});
      } catch {}
      try { if (accountAddress) { invalidateUserPositionsCache(accountAddress); invalidateUserPositionIdsCache(accountAddress); } } catch {}
      // Removed hook-level revalidate to avoid duplicates; page handles revalidation after subgraph sync
      setIsDecreasing(false);
    } else if (decreaseConfirmError) {
       const message = decreaseConfirmError instanceof BaseError ? decreaseConfirmError.shortMessage : decreaseConfirmError.message;
      toast.error("Withdraw Failed", {
        id: hash,
        description: message,
        action: baseSepolia?.blockExplorers?.default?.url 
          ? { label: "View Tx", onClick: () => window.open(`${baseSepolia.blockExplorers.default.url}/tx/${hash}`, '_blank') }
          : undefined,
      });
      setIsDecreasing(false);
      isCompoundRef.current = false;
    }
  }, [isDecreaseConfirming, isDecreaseConfirmed, decreaseConfirmError, hash, onLiquidityDecreased, onFeesCollected, accountAddress]);

  return {
    decreaseLiquidity,
    // Claim fees only: decrease 0 liquidity, take pair, optional sweep
    claimFees: useCallback(async (tokenIdLike: string | number) => {
      if (!accountAddress || !chainId) {
        toast.error("Wallet not connected. Please connect your wallet and try again.");
        return;
      }
      if (!V4_POSITION_MANAGER_ADDRESS) {
        toast.error("Configuration Error: Position Manager address not set.");
        return;
      }

      setIsDecreasing(true);
      lastWasCollectOnly.current = true;
      isCompoundRef.current = false;

      try {
        const nftTokenId = await getTokenIdFromPosition({
          tokenId: tokenIdLike,
          token0Symbol: 'aUSDC' as any, // unused
          token1Symbol: 'aUSDT' as any, // unused
          decreaseAmount0: '0',
          decreaseAmount1: '0',
          isFullBurn: false,
          poolId: '' as any,
          tickLower: 0 as any,
          tickUpper: 0 as any,
        });

        const details = await getPositionDetails(nftTokenId);
        const token0Sym = getTokenSymbolByAddress(getAddress(details.poolKey.currency0));
        const token1Sym = getTokenSymbolByAddress(getAddress(details.poolKey.currency1));
        if (!token0Sym || !token1Sym) throw new Error('Token symbols not found');
        const token0Def = getToken(token0Sym);
        const token1Def = getToken(token1Sym);
        if (!token0Def || !token1Def) throw new Error('Token definitions missing');

        const sdkToken0 = new Token(chainId, getAddress(token0Def.address), token0Def.decimals, token0Def.symbol);
        const sdkToken1 = new Token(chainId, getAddress(token1Def.address), token1Def.decimals, token1Def.symbol);
        const [sortedSdkToken0, sortedSdkToken1] = sdkToken0.sortsBefore(sdkToken1)
          ? [sdkToken0, sdkToken1]
          : [sdkToken1, sdkToken0];

        const planner = new V4PositionPlanner();
        const tokenIdJSBI = JSBI.BigInt(nftTokenId.toString());
        const zero = JSBI.BigInt(0);
        // Collect-only decrease
        planner.addDecrease(tokenIdJSBI, zero, zero, zero, EMPTY_BYTES || '0x');
        // Take tokens back to wallet
        planner.addTakePair(sortedSdkToken0.wrapped, sortedSdkToken1.wrapped, accountAddress);
        // Sweep if any native present after take
        const hasNativeETH = getAddress(details.poolKey.currency0) === '0x0000000000000000000000000000000000000000'
          || getAddress(details.poolKey.currency1) === '0x0000000000000000000000000000000000000000';
        if (hasNativeETH && getAddress(sortedSdkToken0.address) === '0x0000000000000000000000000000000000000000') {
          planner.addSweep(sortedSdkToken0.wrapped, accountAddress);
        } else if (hasNativeETH && getAddress(sortedSdkToken1.address) === '0x0000000000000000000000000000000000000000') {
          planner.addSweep(sortedSdkToken1.wrapped, accountAddress);
        }

        resetWriteContract();
        const deadline = Math.floor(Date.now() / 1000) + 600;
        const unlockData = planner.finalize();
        writeContract({
          address: V4_POSITION_MANAGER_ADDRESS as Hex,
          abi: V4_POSITION_MANAGER_ABI,
          functionName: 'modifyLiquidities',
          args: [unlockData as Hex, deadline],
          chainId: chainId,
        });
      } catch (e: any) {
        toast.error('Claim Fees Preparation Failed', { description: e?.message || 'Could not prepare claim-fees transaction.' });
        setIsDecreasing(false);
      }
    }, [accountAddress, chainId, writeContract, resetWriteContract, getTokenIdFromPosition]),
    // One-shot compound: collect fees then add as liquidity in a single modifyLiquidities call
    compoundFees: useCallback(async (position: {
      tokenId: string | number;
      token0Symbol: TokenSymbol;
      token1Symbol: TokenSymbol;
      poolId: string;
      tickLower: number;
      tickUpper: number;
    }, raw0: string, raw1: string) => {
      if (!accountAddress || !chainId) {
        toast.error("Wallet not connected. Please connect your wallet and try again.");
        return;
      }
      if (!V4_POSITION_MANAGER_ADDRESS) {
        toast.error("Configuration Error: Position Manager address not set.");
        return;
      }

      setIsDecreasing(true);
      lastWasCollectOnly.current = false;
      isCompoundRef.current = true;

      try {
        const token0Def = getToken(position.token0Symbol);
        const token1Def = getToken(position.token1Symbol);
        if (!token0Def || !token1Def || !token0Def.address || !token1Def.address) {
          throw new Error("Token definitions missing");
        }

        const sdkToken0 = new Token(chainId, getAddress(token0Def.address), token0Def.decimals, token0Def.symbol);
        const sdkToken1 = new Token(chainId, getAddress(token1Def.address), token1Def.decimals, token1Def.symbol);
        const [sortedSdkToken0, sortedSdkToken1] = sdkToken0.sortsBefore(sdkToken1)
          ? [sdkToken0, sdkToken1]
          : [sdkToken1, sdkToken0];

        const planner = new V4PositionPlanner();

        // Resolve NFT tokenId (from composite id salt)
        const nftTokenId = await Promise.race([
          getTokenIdFromPosition(position as any),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Failed to resolve token ID. Please try again.')), 10000))
        ]);
        const tokenIdJSBI = JSBI.BigInt(nftTokenId.toString());

        // Step 1: collect fees via zero-liquidity decrease (keep balances internal; don't take to EOA yet)
        const zero = JSBI.BigInt(0);
        planner.addDecrease(tokenIdJSBI, zero, zero, zero, EMPTY_BYTES || '0x');
        const hasNativeETH = token0Def.address === "0x0000000000000000000000000000000000000000" || 
                             token1Def.address === "0x0000000000000000000000000000000000000000";

        // Step 3: compute liquidity using both sides and pick the better (maximize added liquidity without swaps)
        const amt0 = BigInt(raw0 || '0');
        const amt1 = BigInt(raw1 || '0');

        const token0Decimals = token0Def!.decimals;
        const token1Decimals = token1Def!.decimals;
        async function planFromSide(side: 'token0' | 'token1') {
          const sideSymbol = side === 'token0' ? position.token0Symbol : position.token1Symbol;
          const sideDecimals = side === 'token0' ? token0Decimals : token1Decimals;
          const sideRaw = side === 'token0' ? raw0 : raw1;
          if (!sideRaw || BigInt(sideRaw) === 0n) {
            return { liquidity: JSBI.BigInt(0), req0: 0n, req1: 0n, max0: JSBI.BigInt(0), max1: JSBI.BigInt(0) };
          }
          let liq = JSBI.BigInt(0);
          let req0: bigint = 0n;
          let req1: bigint = 0n;
          try {
            const human = formatRawToHuman(sideRaw, sideDecimals);
            const resp = await fetch('/api/liquidity/calculate-liquidity-parameters', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                token0Symbol: position.token0Symbol,
                token1Symbol: position.token1Symbol,
                inputAmount: human,
                inputTokenSymbol: sideSymbol,
                userTickLower: position.tickLower,
                userTickUpper: position.tickUpper,
                chainId: chainId,
              }),
            });
            if (!resp.ok) throw new Error(await resp.text());
            const r = await resp.json();
            liq = JSBI.BigInt(r.liquidity);
            req0 = BigInt(r.amount0);
            req1 = BigInt(r.amount1);
          } catch {
            // conservative fallback
            const maxRaw = side === 'token0' ? amt0 : amt1;
            const estimated = JSBI.divide(JSBI.BigInt(maxRaw.toString()), JSBI.BigInt(10));
            liq = JSBI.greaterThan(estimated, JSBI.BigInt(1)) ? estimated : JSBI.BigInt(1);
            // approximate proportional requirements assuming other side small; keep reqs at collected
            req0 = amt0; req1 = amt1;
          }
          // Feasibility: Require that the API-required amounts are fully covered by collected amounts.
          // If not, treat as zero-liquidity plan to avoid requesting unavailable tokens.
          const feasible = req0 <= amt0 && req1 <= amt1;
          if (!feasible) {
            return { liquidity: JSBI.BigInt(0), req0: 0n, req1: 0n, max0: JSBI.BigInt(0), max1: JSBI.BigInt(0) };
          }
          // clamp to collected to avoid EOA pull
          const collectedSorted0Raw = sdkToken0.address === sortedSdkToken0.address ? amt0 : amt1;
          const collectedSorted1Raw = sdkToken0.address === sortedSdkToken0.address ? amt1 : amt0;
          const reqSorted0Raw = sdkToken0.address === sortedSdkToken0.address ? req0 : req1;
          const reqSorted1Raw = sdkToken0.address === sortedSdkToken0.address ? req1 : req0;
          const out0 = reqSorted0Raw <= collectedSorted0Raw ? reqSorted0Raw : collectedSorted0Raw;
          const out1 = reqSorted1Raw <= collectedSorted1Raw ? reqSorted1Raw : collectedSorted1Raw;
          return { liquidity: liq, req0, req1, max0: JSBI.BigInt(out0.toString()), max1: JSBI.BigInt(out1.toString()) };
        }

        const [plan0, plan1] = await Promise.all([planFromSide('token0'), planFromSide('token1')]);
        const pickPlan = JSBI.greaterThan(plan0.liquidity, plan1.liquidity) ? plan0 : plan1;
        if (!JSBI.greaterThan(pickPlan.liquidity, JSBI.BigInt(0)) || (JSBI.equal(pickPlan.max0, JSBI.BigInt(0)) && JSBI.equal(pickPlan.max1, JSBI.BigInt(0)))) {
          toast.error('Cannot Compound Single Sided Fees', { icon: React.createElement(OctagonX, { className: 'h-4 w-4 text-red-500' }) });
          setIsDecreasing(false);
          isCompoundRef.current = false;
          return;
        }

        // Step 4: increase using collected tokens (best plan). Since we kept balances internal, no Permit2 settle is needed.
        planner.addIncrease(tokenIdJSBI, pickPlan.liquidity, pickPlan.max0, pickPlan.max1, EMPTY_BYTES || '0x');

        // Step 5: take any leftover internal balances back to the user (and sweep if native)
        planner.addTakePair(sortedSdkToken0.wrapped, sortedSdkToken1.wrapped, accountAddress);
        if (hasNativeETH && getAddress(sortedSdkToken0.address) === '0x0000000000000000000000000000000000000000') {
          planner.addSweep(sortedSdkToken0.wrapped, accountAddress);
        } else if (hasNativeETH && getAddress(sortedSdkToken1.address) === '0x0000000000000000000000000000000000000000') {
          planner.addSweep(sortedSdkToken1.wrapped, accountAddress);
        }

        // Finalize and submit
        resetWriteContract();
        const deadline = Math.floor(Date.now() / 1000) + 600;
        const unlockData = planner.finalize();
        // No Permit2 settlement from EOA, keep value at 0
        let txValue = 0n;

        writeContract({
          address: V4_POSITION_MANAGER_ADDRESS as Hex,
          abi: V4_POSITION_MANAGER_ABI,
          functionName: 'modifyLiquidities',
          args: [unlockData as Hex, deadline],
          value: txValue,
          chainId: chainId,
        });
      } catch (error: any) {
        console.error('Error preparing compound transaction:', error);
        toast.error('Compound Preparation Failed', { description: error?.message || 'Could not prepare the compound transaction.' });
        setIsDecreasing(false);
        isCompoundRef.current = false;
      }
    }, [accountAddress, chainId, writeContract, resetWriteContract, getTokenIdFromPosition]),
    isLoading: isDecreasing || isDecreaseSendPending || isDecreaseConfirming,
    isSuccess: isDecreaseConfirmed,
    error: decreaseSendError || decreaseConfirmError,
    hash,
  };
} 

// Local util to format raw wei to human-readable string
function formatRawToHuman(raw: string, decimals: number): string {
  try {
    const big = BigInt(raw || '0');
    if (big === 0n) return '0';
    // Simple decimal conversion without importing formatUnits here to avoid extra deps
    const s = big.toString().padStart(decimals + 1, '0');
    const i = s.slice(0, -decimals);
    const f = s.slice(-decimals).replace(/0+$/, '');
    return f ? `${i}.${f}` : i;
  } catch {
    return '0';
  }
}