/**
 * Shared logic for swap execution hooks.
 *
 * Shared types, helpers, body construction, and transaction tracking
 * for swap execution hooks. This module is the single source of truth.
 */

import { getAddress, type Address, type Hex } from "viem"
import { invalidateAfterTx } from "@/lib/apollo/mutations"
import { getKyberswapRouterAddress } from "@/lib/aggregators/kyberswap"
import { safeParseUnits } from "@/lib/liquidity/utils/parsing/amountParsing"
import { PERMIT2_ADDRESS } from "@/lib/swap/swap-constants"
import { TransactionType, TradeType, type ExactInputSwapTransactionInfo, type ExactOutputSwapTransactionInfo } from "@/lib/transactions"
import { classifySwapError } from "@/lib/swap/error-classification"
import type { AggregatorSource } from "@/lib/aggregators/types"
import type { Token } from "@/components/swap/swap-interface"

// =============================================================================
// TYPES
// =============================================================================

export type TouchedPool = { slug: string; poolId?: string }

export type ExistingPermit = {
  amount: string
  expiration: number
  nonce: number
}

export type PermitData = {
  domain: { name: string; version?: string; chainId: number; verifyingContract: `0x${string}` }
  types: Record<string, Array<{ name: string; type: string }>>
  message: {
    details: { token: `0x${string}`; amount: string; expiration: number; nonce: number }
    spender: `0x${string}`
    sigDeadline: string
  }
  primaryType: "PermitSingle"
}

export type PreparePermitResponse =
  | { ok: true; message: string; needsPermit: false; isApproved?: boolean }
  | { ok: true; message: string; needsPermit: false; isApproved?: boolean; existingPermit: ExistingPermit }
  | { ok: true; message: string; needsPermit: true; isApproved?: boolean; permitData: PermitData }

// =============================================================================
// HELPERS
// =============================================================================

// Re-export for consumers (e.g. useSwapFlow.ts)
export { safeParseUnits }

export const invalidateSwapCache = async (
  accountAddress: string,
  chainId: number,
  touchedPools: TouchedPool[] | undefined,
  swapVolumeUSD: number,
) => {
  if (!touchedPools?.length) return
  const volumePerPool = swapVolumeUSD / touchedPools.length
  for (const pool of touchedPools) {
    invalidateAfterTx({
      owner: accountAddress,
      chainId,
      poolId: pool.poolId,
      optimisticUpdates: {
        volumeDelta: volumePerPool,
      },
    })
  }
}

// =============================================================================
// SWAP BODY BUILDER
// =============================================================================

interface SwapBodyParams {
  source: AggregatorSource
  accountAddress: string
  fromToken: Token
  toToken: Token
  swapType: "ExactIn" | "ExactOut"
  amountDecimalsStr: string
  limitAmountDecimalsStr: string
  chainId: number
  dynamicSwapFee: number | null
  currentSlippage: number
  // Kyberswap-specific
  kyberswapRouterAddress?: string
  // Alphix ERC20: permit fields
  permitSignature?: string
  permitDetails?: PreparePermitResponse | null
}

/**
 * Build the request body for /api/swap/build-tx.
 * Handles all 3 cases: Kyberswap, native ETH, Alphix ERC20 with permit.
 */
export function buildSwapRequestBody(params: SwapBodyParams): Record<string, unknown> {
  const {
    source, accountAddress, fromToken, toToken,
    swapType, amountDecimalsStr, limitAmountDecimalsStr,
    chainId, dynamicSwapFee, currentSlippage,
    kyberswapRouterAddress, permitSignature, permitDetails,
  } = params

  const commonFields = {
    userAddress: accountAddress,
    fromTokenSymbol: fromToken.symbol,
    toTokenSymbol: toToken.symbol,
    swapType,
    amountDecimalsStr,
    limitAmountDecimalsStr,
    chainId,
    dynamicSwapFee,
  }

  if (source === "kyberswap") {
    const routerAddress = kyberswapRouterAddress || getKyberswapRouterAddress()
    return {
      ...commonFields,
      permitSignature: "0x",
      permitTokenAddress: fromToken.address,
      permitAmount: "0",
      permitNonce: 0,
      permitExpiration: 0,
      permitSigDeadline: "0",
      fromTokenAddress: fromToken.address,
      toTokenAddress: toToken.address,
      fromTokenDecimals: fromToken.decimals,
      toTokenDecimals: toToken.decimals,
      slippageBps: Math.round(currentSlippage * 100),
      source: "kyberswap",
      kyberswapData: { routerAddress },
    }
  }

  if (fromToken.symbol === "ETH") {
    return {
      ...commonFields,
      permitSignature: "0x",
      permitTokenAddress: fromToken.address,
      permitAmount: "0",
      permitNonce: 0,
      permitExpiration: 0,
      permitSigDeadline: "0",
      source: "alphix",
    }
  }

  // Alphix ERC20 with permit
  if (!permitDetails) throw new Error("Permit details missing")

  let permitNonce: number
  let permitExpiration: number
  let permitSigDeadline: string
  let permitAmount: string

  if (permitDetails.needsPermit === true) {
    permitNonce = permitDetails.permitData.message.details.nonce
    permitExpiration = permitDetails.permitData.message.details.expiration
    permitSigDeadline = permitDetails.permitData.message.sigDeadline
    permitAmount = permitDetails.permitData.message.details.amount
  } else if ("existingPermit" in permitDetails && permitDetails.existingPermit) {
    permitNonce = permitDetails.existingPermit.nonce
    permitExpiration = permitDetails.existingPermit.expiration
    permitSigDeadline = String(permitExpiration)
    permitAmount = permitDetails.existingPermit.amount
  } else {
    throw new Error("Invalid permit data structure - fresh signature required")
  }

  return {
    ...commonFields,
    permitSignature: permitSignature || "0x",
    permitTokenAddress: fromToken.address,
    permitAmount,
    permitNonce,
    permitExpiration,
    permitSigDeadline,
    source: "alphix",
  }
}

// =============================================================================
// BUILD-TX FETCH
// =============================================================================

export interface BuildTxResult {
  data: Record<string, any>
}

/**
 * Call /api/swap/build-tx and handle errors with Kyberswap-specific extraction.
 */
export async function fetchBuildTx(body: Record<string, unknown>): Promise<BuildTxResult> {
  const response = await fetch("/api/swap/build-tx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await response.json()
  if (!response.ok) {
    const kyberErr = data.kyberswapError
    const rawMessage = kyberErr
      ? `${data.message} (${kyberErr.kind})`
      : data.message || "Failed to build transaction"
    // Classify into a user-friendly message; fall back to a generic one
    const userMessage = classifySwapError(rawMessage) || rawMessage
    throw new Error(userMessage, { cause: data.errorDetails || kyberErr?.kind || data.error })
  }
  return { data }
}

// =============================================================================
// TRANSACTION SENDING
// =============================================================================

interface SendSwapParams {
  source: AggregatorSource
  buildData: Record<string, any>
  sendRawTx: (args: any) => Promise<string>
  sendSwapTx: (args: any) => Promise<string>
  dataSuffix: Hex
}

/**
 * Send the swap transaction via the appropriate method (raw tx for Kyberswap, contract call for Alphix).
 */
export async function sendSwapTransaction(params: SendSwapParams): Promise<string> {
  const { source, buildData, sendRawTx, sendSwapTx, dataSuffix } = params
  let txHash: string | undefined

  if (source === "kyberswap" && buildData.data) {
    txHash = await sendRawTx({
      to: getAddress(buildData.to) as Address,
      data: buildData.data as Hex,
      value: BigInt(buildData.value),
      ...(buildData.gasLimit ? { gas: BigInt(buildData.gasLimit) } : {}),
      dataSuffix,
    })
  } else {
    txHash = await sendSwapTx({
      address: getAddress(buildData.to),
      abi: (await import("@/lib/swap/swap-constants")).UniversalRouterAbi,
      functionName: "execute",
      args: [buildData.commands as Hex, buildData.inputs as Hex[], BigInt(buildData.deadline)],
      value: BigInt(buildData.value),
      dataSuffix,
    } as any)
  }

  if (!txHash) throw new Error("Failed to send swap transaction (no hash received)")
  return txHash
}

// =============================================================================
// TRANSACTION TRACKING
// =============================================================================

/**
 * Build the Redux transaction info for tracking a swap.
 */
export function buildSwapTransactionInfo(
  swapType: "ExactIn" | "ExactOut",
  fromToken: Token,
  toToken: Token,
  fromAmount: string,
  toAmount: string,
  chainId: number,
): ExactInputSwapTransactionInfo | ExactOutputSwapTransactionInfo {
  if (swapType === "ExactIn") {
    return {
      type: TransactionType.Swap,
      tradeType: TradeType.EXACT_INPUT,
      inputCurrencyId: `${chainId}-${fromToken.address}`,
      outputCurrencyId: `${chainId}-${toToken.address}`,
      inputCurrencyAmountRaw: safeParseUnits(fromAmount, fromToken.decimals).toString(),
      expectedOutputCurrencyAmountRaw: safeParseUnits(toAmount, toToken.decimals).toString(),
      minimumOutputCurrencyAmountRaw: safeParseUnits(toAmount, toToken.decimals).toString(),
    } as ExactInputSwapTransactionInfo
  }

  return {
    type: TransactionType.Swap,
    tradeType: TradeType.EXACT_OUTPUT,
    inputCurrencyId: `${chainId}-${fromToken.address}`,
    outputCurrencyId: `${chainId}-${toToken.address}`,
    outputCurrencyAmountRaw: safeParseUnits(toAmount, toToken.decimals).toString(),
    expectedInputCurrencyAmountRaw: safeParseUnits(fromAmount, fromToken.decimals).toString(),
    maximumInputCurrencyAmountRaw: safeParseUnits(fromAmount, fromToken.decimals).toString(),
  } as ExactOutputSwapTransactionInfo
}
