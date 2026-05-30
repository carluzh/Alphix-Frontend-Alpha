/**
 * buildIncreaseTxContext — pure tx-context builders.
 *
 * Each function takes fully-resolved deps as params and returns a ValidatedLiquidityTxContext.
 * Behavior-preservation invariants:
 * - The ERC20_TO_PERMIT2 branch forwards the FULL normalized permit (domain+types+values) as
 *   `increasePositionRequestArgs.permitBatchData` — the backend's denormalizeV4BatchPermit reads `types`.
 * - The two permit sub-branches differ and are kept separate (not factored together).
 * - `inputSide` is computed in the provider and passed in; the builder never re-derives it.
 *   It is load-bearing for MAX token1 deposits.
 * - `syncAmountsFromApi` stays provider-owned and is invoked here at the same position
 *   (after 200 + amounts-present, before approval-type branching).
 */

import { type Address } from "viem";
import { buildLiquidityTxContext, type MintTxApiResponse } from "@/lib/liquidity/transaction";
import {
  LiquidityTransactionType,
  type ValidatedLiquidityTxContext,
  type ValidatedTransactionRequest,
  type SignTypedDataStepFields,
  type TokenCfg,
} from "@/lib/liquidity/types";
import { buildApprovalCalldata } from "@/lib/liquidity/hooks/approval";
import { toApproveRequest } from "@/lib/liquidity/utils/toApproveRequest";
import { buildUnifiedYieldDepositTx, buildDepositParamsFromPreview } from "@/lib/liquidity/unified-yield/buildUnifiedYieldDepositTx";
import type { DepositPreviewResult, UnifiedYieldApprovalStatus } from "@/lib/liquidity/unified-yield/types";

export interface BuildUnifiedYieldIncreaseParams {
  accountAddress: Address;
  chainId: number;
  token0Config: TokenCfg;
  token1Config: TokenCfg;
  hookAddress: Address;
  poolId: string;
  /** Caller-guaranteed non-null preview with shares !== 0n. */
  preview: DepositPreviewResult;
  sqrtPriceX96?: string | null;
  refetchApprovals: (overrideAmounts?: { amount0Wei: bigint; amount1Wei: bigint }) => Promise<UnifiedYieldApprovalStatus | null>;
}

export async function buildUnifiedYieldIncreaseContext(p: BuildUnifiedYieldIncreaseParams): Promise<ValidatedLiquidityTxContext> {
  const { preview, hookAddress, token0Config, token1Config, accountAddress, chainId } = p;

  const approvalCheck = await p.refetchApprovals({ amount0Wei: preview.amount0, amount1Wei: preview.amount1 });

  let approveToken0Request: ValidatedTransactionRequest | undefined;
  let approveToken1Request: ValidatedTransactionRequest | undefined;

  if (approvalCheck?.token0NeedsApproval) {
    approveToken0Request = {
      to: token0Config.address as Address,
      data: buildApprovalCalldata(hookAddress, preview.amount0),
      value: 0n,
      chainId,
    };
  }
  if (approvalCheck?.token1NeedsApproval) {
    approveToken1Request = {
      to: token1Config.address as Address,
      data: buildApprovalCalldata(hookAddress, preview.amount1),
      value: 0n,
      chainId,
    };
  }

  const sqrtPriceX96 = p.sqrtPriceX96 ? BigInt(p.sqrtPriceX96) : undefined;
  const depositParams = buildDepositParamsFromPreview(
    preview,
    hookAddress,
    token0Config.address as Address,
    token1Config.address as Address,
    accountAddress,
    p.poolId,
    chainId,
    sqrtPriceX96,
    500,
  );

  const depositTx = buildUnifiedYieldDepositTx(depositParams);

  const context = buildLiquidityTxContext({
    type: LiquidityTransactionType.Increase,
    apiResponse: {
      needsApproval: false,
      create: {
        to: depositTx.to,
        data: depositTx.calldata,
        value: depositTx.value?.toString() || "0",
        gasLimit: depositTx.gasLimit?.toString(),
        chainId,
      },
    } as MintTxApiResponse,
    token0: { address: token0Config.address as Address, symbol: token0Config.symbol, decimals: token0Config.decimals, chainId },
    token1: { address: token1Config.address as Address, symbol: token1Config.symbol, decimals: token1Config.decimals, chainId },
    amount0: preview.amount0.toString(),
    amount1: preview.amount1.toString(),
    chainId,
    approveToken0Request,
    approveToken1Request,
    isUnifiedYield: true,
    hookAddress,
    poolId: p.poolId,
    sharesToMint: preview.shares,
  });

  return context as ValidatedLiquidityTxContext;
}

export interface BuildV4IncreaseParams {
  accountAddress: Address;
  chainId: number;
  token0Config: TokenCfg;
  token1Config: TokenCfg;
  tokenId: string;
  /** Already defaulted to "0" by the provider. */
  amount0: string;
  amount1: string;
  /** Computed in the provider from exactField; load-bearing for MAX token1 deposits. */
  inputSide: "token0" | "token1";
  /** Provider-owned side-effect (writes setDerivedInfo) — invoked verbatim here. */
  syncAmountsFromApi: (apiDetails: { token0: { amount: string }; token1: { amount: string } }) => void;
}

export async function buildV4IncreaseContext(p: BuildV4IncreaseParams): Promise<ValidatedLiquidityTxContext> {
  const { accountAddress, chainId, token0Config, token1Config, tokenId, amount0, amount1, inputSide } = p;

  const response = await fetch("/api/liquidity/prepare-increase-tx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userAddress: accountAddress,
      tokenId,
      amount0,
      amount1,
      inputSide,
      chainId,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Failed to prepare transaction");
  }

  if (!data.details?.token0?.amount || !data.details?.token1?.amount) {
    throw new Error("Uniswap LP API response missing token amounts");
  }

  const increasePositionRequestArgs = {
    userAddress: accountAddress,
    tokenId,
    amount0,
    amount1,
    inputSide,
    chainId,
  };

  p.syncAmountsFromApi(data.details);

  if (data.needsApproval && data.approvalType === "ERC20_TO_PERMIT2") {
    const rawAmount0 = BigInt(data.details.token0.amount);
    const rawAmount1 = BigInt(data.details.token1.amount);

    const permitData = data.permitBatchData;
    const sigDetails = data.signatureDetails;
    let permit: SignTypedDataStepFields | undefined;

    if (permitData?.values && sigDetails?.domain) {
      permit = {
        domain: {
          name: sigDetails.domain.name,
          chainId: sigDetails.domain.chainId,
          verifyingContract: sigDetails.domain.verifyingContract as Address,
        },
        types: sigDetails.types,
        values: permitData.values || permitData,
      };
    }

    // Send the FULL normalized permit (domain, types, values) — backend's
    // `denormalizeV4BatchPermit` reads `types` to wrap fields, so a values-only
    // payload throws "Cannot convert undefined or null to object".
    const increasePositionRequestArgsWithPermit = permitData ? {
      ...increasePositionRequestArgs,
      permitBatchData: permitData,
    } : increasePositionRequestArgs;

    const context = buildLiquidityTxContext({
      type: LiquidityTransactionType.Increase,
      apiResponse: {
        needsApproval: !data.create,
        permitBatchData: permitData,
        signatureDetails: sigDetails,
        create: data.create,
      } as MintTxApiResponse,
      token0: { address: token0Config.address as Address, symbol: token0Config.symbol, decimals: token0Config.decimals, chainId },
      token1: { address: token1Config.address as Address, symbol: token1Config.symbol, decimals: token1Config.decimals, chainId },
      amount0: rawAmount0.toString(),
      amount1: rawAmount1.toString(),
      chainId,
      approveToken0Request: toApproveRequest(data.approveToken0Tx, chainId),
      approveToken1Request: toApproveRequest(data.approveToken1Tx, chainId),
      permit,
      increasePositionRequestArgs: increasePositionRequestArgsWithPermit,
    });

    return context as ValidatedLiquidityTxContext;
  }

  if (data.needsApproval && data.approvalType === "PERMIT2_BATCH_SIGNATURE") {
    const permitData = data.permitBatchData;
    const sigDetails = data.signatureDetails;

    const permit: SignTypedDataStepFields = {
      domain: {
        name: sigDetails.domain.name,
        chainId: sigDetails.domain.chainId,
        verifyingContract: sigDetails.domain.verifyingContract as Address,
      },
      types: sigDetails.types,
      values: permitData.values || permitData,
    };

    const rawAmount0 = BigInt(data.details.token0.amount);
    const rawAmount1 = BigInt(data.details.token1.amount);

    const increasePositionRequestArgsWithPermit = {
      ...increasePositionRequestArgs,
      permitBatchData: permitData,
    };

    const context = buildLiquidityTxContext({
      type: LiquidityTransactionType.Increase,
      apiResponse: {
        needsApproval: true,
        permitBatchData: permitData,
        signatureDetails: sigDetails,
      } as MintTxApiResponse,
      token0: { address: token0Config.address as Address, symbol: token0Config.symbol, decimals: token0Config.decimals, chainId },
      token1: { address: token1Config.address as Address, symbol: token1Config.symbol, decimals: token1Config.decimals, chainId },
      amount0: rawAmount0.toString(),
      amount1: rawAmount1.toString(),
      chainId,
      approveToken0Request: toApproveRequest(data.approveToken0Tx, chainId),
      approveToken1Request: toApproveRequest(data.approveToken1Tx, chainId),
      permit,
      increasePositionRequestArgs: increasePositionRequestArgsWithPermit,
    });

    return context as ValidatedLiquidityTxContext;
  }

  if (!data.needsApproval && data.create) {
    const context = buildLiquidityTxContext({
      type: LiquidityTransactionType.Increase,
      apiResponse: { needsApproval: false, create: data.create } as MintTxApiResponse,
      token0: { address: token0Config.address as Address, symbol: token0Config.symbol, decimals: token0Config.decimals, chainId },
      token1: { address: token1Config.address as Address, symbol: token1Config.symbol, decimals: token1Config.decimals, chainId },
      amount0: data.details.token0.amount,
      amount1: data.details.token1.amount,
      chainId,
      increasePositionRequestArgs,
    });

    return context as ValidatedLiquidityTxContext;
  }

  throw new Error("Unexpected API response");
}
