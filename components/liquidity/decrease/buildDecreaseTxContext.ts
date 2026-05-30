/**
 * buildDecreaseTxContext — pure (hook-free) tx-context builders extracted from
 * DecreaseLiquidityTxContext.fetchAndBuildContext.
 *
 * Each function takes fully-resolved deps as params and returns plain data; it
 * performs NO React state mutation, NO ensureChain, NO reportError — those stay
 * in the provider. Co-located in the decrease feature folder, symmetric with
 * `../increase/buildIncreaseTxContext.ts`.
 *
 * Behavior is preserved verbatim from the original branch bodies:
 * - `needsApproval: false` is hardcoded (decrease never approves / permits).
 * - The UY branch defaults a missing sqrtPriceX96 to 0n (skips slippage at the
 *   tx-context layer) exactly as before — do NOT borrow the live hook's 500 bps.
 * - The V4 branch returns the `receive` data alongside the context so the
 *   provider can call setReceive BEFORE setTxContext on success; on a thrown
 *   error the provider never updates receive.
 */

import { parseUnits, type Address } from "viem";
import { buildLiquidityTxContext, type MintTxApiResponse } from "@/lib/liquidity/transaction";
import { LiquidityTransactionType, type ValidatedLiquidityTxContext, type TokenCfg } from "@/lib/liquidity/types";
import { buildUnifiedYieldWithdrawTx, calculateSharesFromPercentage } from "@/lib/liquidity/unified-yield/buildUnifiedYieldWithdrawTx";

export interface BuildUnifiedYieldDecreaseParams {
  hookAddress: Address;
  shareBalance: string;
  userAddress: Address;
  poolId: string;
  chainId: number;
  /** Already snapped in the provider (rawPct >= 99 ? 100 : clamp(round(rawPct))). */
  decreasePercentage: number;
  sqrtPriceX96?: string | null;
  token0Config: TokenCfg;
  token1Config: TokenCfg;
  withdrawAmount0: string;
  withdrawAmount1: string;
}

export function buildUnifiedYieldDecreaseTxContext(p: BuildUnifiedYieldDecreaseParams): ValidatedLiquidityTxContext {
  const shareBalanceBigInt = parseUnits(p.shareBalance, 18);
  const sharesToWithdraw = calculateSharesFromPercentage(shareBalanceBigInt, p.decreasePercentage);
  const sqrtPriceX96 = p.sqrtPriceX96 ? BigInt(p.sqrtPriceX96) : 0n;
  const txResult = buildUnifiedYieldWithdrawTx({
    hookAddress: p.hookAddress,
    shares: sharesToWithdraw,
    userAddress: p.userAddress,
    poolId: p.poolId,
    chainId: p.chainId,
    expectedSqrtPriceX96: sqrtPriceX96,
    maxPriceSlippage: 500,
  });

  const rawAmount0 = parseUnits(p.withdrawAmount0 || "0", p.token0Config.decimals).toString();
  const rawAmount1 = parseUnits(p.withdrawAmount1 || "0", p.token1Config.decimals).toString();

  const context = buildLiquidityTxContext({
    type: LiquidityTransactionType.Decrease,
    apiResponse: {
      needsApproval: false,
      create: {
        to: txResult.to,
        data: txResult.calldata,
        value: txResult.value?.toString() || "0",
        gasLimit: txResult.gasLimit?.toString(),
      },
    } as MintTxApiResponse,
    token0: { address: p.token0Config.address as Address, symbol: p.token0Config.symbol, decimals: p.token0Config.decimals, chainId: p.chainId },
    token1: { address: p.token1Config.address as Address, symbol: p.token1Config.symbol, decimals: p.token1Config.decimals, chainId: p.chainId },
    amount0: rawAmount0,
    amount1: rawAmount1,
    chainId: p.chainId,
    isUnifiedYield: true,
    hookAddress: p.hookAddress,
    poolId: p.poolId,
    sharesToWithdraw,
  });

  return context as ValidatedLiquidityTxContext;
}

export interface DecreaseReceiveData {
  percent: number;
  amount0: string;
  amount1: string;
}

export interface BuildV4DecreaseParams {
  userAddress: Address;
  positionId: string;
  chainId: number;
  /** Already snapped in the provider. */
  decreasePercentage: number;
  token0Config: TokenCfg;
  token1Config: TokenCfg;
}

export interface BuildV4DecreaseResult {
  context: ValidatedLiquidityTxContext;
  receive: DecreaseReceiveData;
}

export async function buildV4DecreaseTxContext(p: BuildV4DecreaseParams): Promise<BuildV4DecreaseResult> {
  const compositeId = p.positionId.toString();
  const saltHex = compositeId.split("-").at(-1);
  let tokenId = compositeId;
  if (saltHex && saltHex !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
    try { tokenId = BigInt(saltHex).toString(); } catch {}
  }

  const response = await fetch("/api/liquidity/prepare-decrease-tx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userAddress: p.userAddress,
      tokenId,
      decreasePercentage: p.decreasePercentage,
      chainId: p.chainId,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Failed to prepare transaction");
  }
  if (!data.details?.token0?.amount || !data.details?.token1?.amount) {
    throw new Error("Uniswap LP API response missing token amounts");
  }

  const receive: DecreaseReceiveData = {
    percent: p.decreasePercentage,
    amount0: data.details.token0.amount,
    amount1: data.details.token1.amount,
  };

  const context = buildLiquidityTxContext({
    type: LiquidityTransactionType.Decrease,
    apiResponse: { needsApproval: false, create: data.create } as MintTxApiResponse,
    token0: { address: p.token0Config.address as Address, symbol: p.token0Config.symbol, decimals: p.token0Config.decimals, chainId: p.chainId },
    token1: { address: p.token1Config.address as Address, symbol: p.token1Config.symbol, decimals: p.token1Config.decimals, chainId: p.chainId },
    amount0: data.details.token0.amount,
    amount1: data.details.token1.amount,
    chainId: p.chainId,
  });

  return { context: context as ValidatedLiquidityTxContext, receive };
}
