/**
 * Swap Step Executor - Step-based swap execution hook
 *
 * Follows the same pattern as useLiquidityStepExecutor:
 * 1. Generate steps based on source (Alphix vs Kyberswap) and token type
 * 2. Execute each step sequentially (approval → permit → swap)
 * 3. Track state for ProgressIndicator rendering
 *
 * Replaces the old useSwapExecution handleSwap/handleConfirmSwap flow with
 * a single execute() call that runs through all steps automatically.
 */

import { createElement, useCallback, useRef, useState } from "react"
import { useAccount, usePublicClient, useSignTypedData, useWriteContract, useSendTransaction } from "wagmi"
import { getAddress, formatUnits, maxUint256, parseUnits, type Address, type Hex } from "viem"
import { toast } from "sonner"
import { IconBadgeCheck2, IconCircleXmarkFilled, IconCircleInfo } from "nucleo-micro-bold-essential"
import * as Sentry from "@sentry/nextjs"

import { invalidateAfterTx } from "@/lib/invalidation"
import { isInfiniteApprovalEnabled } from "@/hooks/useUserSettings"
import { PERMIT2_ADDRESS, UniversalRouterAbi, Erc20AbiDefinition } from "@/lib/swap/swap-constants"
import { getExplorerTxUrl } from "@/lib/wagmiConfig"
import { modeForChainId } from "@/lib/network-mode"
import {
  useTransactionAdder,
  TransactionType,
  TradeType,
  type ExactInputSwapTransactionInfo,
  type ExactOutputSwapTransactionInfo,
  type ApproveTransactionInfo,
} from "@/lib/transactions"
import {
  type TransactionStep,
  type CurrentStepState,
  TransactionStepType,
  createTokenApprovalStep,
  createPermit2SignatureStep,
  type SwapStep as SwapStepType,
} from "@/lib/transactions/types"

import type { Token, SwapTxInfo } from "./swap-interface"
import type { ExecutionTradeParams } from "./useSwapTrade"
import type { AggregatorSource } from "@/lib/aggregators/types"
import type { KyberswapQuoteData } from "./useSwapQuote"
import { getKyberswapRouterAddress } from "@/lib/aggregators/kyberswap"
import { BUILDER_CODE_SUFFIX } from "@/lib/builder-code"

// =============================================================================
// HELPERS (copied from useSwapExecution - shared logic)
// =============================================================================

const safeParseUnits = (amount: string, decimals: number): bigint => {
  if (!amount || amount === "0" || amount === "0.0") return 0n
  const numericAmount = parseFloat(amount)
  if (isNaN(numericAmount)) throw new Error("Invalid number format")
  if (amount.toLowerCase().includes("e")) {
    const fullDecimalString = numericAmount.toFixed(decimals)
    const trimmedString = fullDecimalString.replace(/\.?0+$/, "")
    const finalString = trimmedString === "." ? "0" : trimmedString
    return parseUnits(finalString, decimals)
  }
  return parseUnits(amount, decimals)
}

type TouchedPool = { poolId: string; subgraphId?: string }

const invalidateSwapCache = async (
  queryClient: any,
  accountAddress: string,
  chainId: number,
  touchedPools: TouchedPool[] | undefined,
  swapVolumeUSD: number,
  blockNumber: bigint
) => {
  if (!touchedPools?.length) return
  const volumePerPool = swapVolumeUSD / touchedPools.length
  for (const pool of touchedPools) {
    invalidateAfterTx(null, {
      owner: accountAddress,
      chainId,
      poolId: pool.poolId,
      optimisticUpdates: {
        volumeDelta: volumePerPool,
      },
    })
  }
}

type PreparePermitResponse =
  | { ok: true; message: string; needsPermit: false; isApproved?: boolean }
  | { ok: true; message: string; needsPermit: false; isApproved?: boolean; existingPermit: { amount: string; expiration: number; nonce: number } }
  | { ok: true; message: string; needsPermit: true; isApproved?: boolean; permitData: {
      domain: { name: string; version?: string; chainId: number; verifyingContract: `0x${string}` }
      types: Record<string, Array<{ name: string; type: string }>>
      message: {
        details: { token: `0x${string}`; amount: string; expiration: number; nonce: number }
        spender: `0x${string}`
        sigDeadline: string
      }
      primaryType: "PermitSingle"
    }}

// =============================================================================
// TYPES
// =============================================================================

export type SwapExecutorStatus = "idle" | "executing" | "completed" | "error"

export interface SwapStepState {
  step: TransactionStep
  status: "pending" | "active" | "completed" | "error"
  error?: string
}

export interface SwapExecutorState {
  steps: SwapStepState[]
  currentStepIndex: number
  status: SwapExecutorStatus
  error?: string
  txInfo: SwapTxInfo | null
}

export interface UseSwapStepExecutorArgs {
  queryClient: any
  fromToken: Token
  toToken: Token
  fromAmount: string
  toAmount: string
  lastEditedSideRef: React.MutableRefObject<"from" | "to">
  trade?: ExecutionTradeParams
  tradeState?: "idle" | "loading" | "no_route" | "error" | "ready"
  currentSlippage: number
  fromTokenUsdPrice: number
  refetchFromTokenBalance?: () => Promise<any>
  refetchToTokenBalance?: () => Promise<any>
  source?: AggregatorSource
  kyberswapData?: KyberswapQuoteData | null
}

export interface UseSwapStepExecutorReturn {
  execute: () => Promise<void>
  state: SwapExecutorState
  reset: () => void
  /** Current step for ProgressIndicator */
  currentStep: CurrentStepState | undefined
}

// =============================================================================
// INITIAL STATE
// =============================================================================

const INITIAL_STATE: SwapExecutorState = {
  steps: [],
  currentStepIndex: 0,
  status: "idle",
  error: undefined,
  txInfo: null,
}

// =============================================================================
// ERROR CLASSIFICATION (copied from useSwapExecution)
// =============================================================================

function isUserRejected(err: any): boolean {
  const name = err?.name || err?.cause?.name
  if (name === "UserRejectedRequestError") return true
  const code = err?.code || err?.cause?.code
  if (code === 4001 || code === 5750 || code === "ACTION_REJECTED") return true
  const msg = String(err?.shortMessage || err?.message || err?.cause?.message || "")
  return (
    (/request/i.test(msg) && /reject/i.test(msg)) ||
    /declined/i.test(msg) ||
    /cancell?ed by user/i.test(msg) ||
    /user cancell?ed/i.test(msg) ||
    /user denied/i.test(msg) ||
    /user rejected/i.test(msg) ||
    /closed modal/i.test(msg) ||
    /connection rejected/i.test(msg) ||
    /transaction cancelled/i.test(msg) ||
    /denied transaction signature/i.test(msg)
  )
}

function classifySwapError(err: any) {
  if (isUserRejected(err)) {
    return { kind: "rejected" as const, title: "Cancelled", description: "You cancelled the request in your wallet." }
  }
  const msg = String(err?.shortMessage || err?.message || err?.cause?.message || "")
  const msgLc = msg.toLowerCase()
  if (msgLc.includes("permit nonce") || msgLc.includes("nonce changed") || msgLc.includes("nonce stale")) {
    return { kind: "backend" as const, title: "Permit Expired", description: msg || "Your permit was already used. Please sign again." }
  }
  if (msgLc.includes("signature invalid") || msgLc.includes("invalid signature") || msgLc.includes("signature expired")) {
    return { kind: "backend" as const, title: "Signature Invalid", description: msg || "Your signature is invalid or expired. Please sign again." }
  }
  if (msgLc.includes("timed out") || msgLc.includes("timeout") || msgLc.includes("aborted")) {
    return { kind: "backend" as const, title: "Request Timed Out", description: "The route request timed out. Please try again." }
  }
  if (msgLc.includes("failed to fetch permit data") || msgLc.includes("failed to build transaction") || msgLc.includes("backend")) {
    return { kind: "backend" as const, title: "Backend Error", description: msg || "Something went wrong on our end." }
  }
  if (msgLc.includes("revert") || msgLc.includes("executionfailed") || msgLc.includes("call revert exception")) {
    return { kind: "revert" as const, title: "Transaction Reverted", description: msg || "The transaction reverted on-chain." }
  }
  return { kind: "unknown" as const, title: "Transaction Error", description: msg || "The transaction failed." }
}

// =============================================================================
// HOOK
// =============================================================================

export function useSwapStepExecutor({
  queryClient,
  fromToken,
  toToken,
  fromAmount,
  toAmount,
  lastEditedSideRef,
  trade,
  tradeState,
  currentSlippage,
  fromTokenUsdPrice,
  refetchFromTokenBalance,
  refetchToTokenBalance,
  source = "alphix",
  kyberswapData,
}: UseSwapStepExecutorArgs): UseSwapStepExecutorReturn {
  const { address: accountAddress, chainId: currentChainId } = useAccount()
  const publicClient = usePublicClient({ chainId: currentChainId })

  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync: sendApprovalTx } = useWriteContract()
  const { writeContractAsync: sendSwapTx } = useWriteContract()
  const { sendTransactionAsync: sendRawTx } = useSendTransaction()

  const addTransaction = useTransactionAdder()

  const [state, setState] = useState<SwapExecutorState>(INITIAL_STATE)
  const executionRef = useRef<{ cancelled: boolean }>({ cancelled: false })

  // Store permit data and signature between steps
  const permitDataRef = useRef<PreparePermitResponse | null>(null)
  const signatureRef = useRef<Hex | null>(null)

  const reset = useCallback(() => {
    executionRef.current.cancelled = true
    permitDataRef.current = null
    signatureRef.current = null
    setState(INITIAL_STATE)
  }, [])

  // =========================================================================
  // STEP GENERATION
  // =========================================================================

  /** Returns steps along with a set of indices that are already completed (pre-approved) */
  const generateSteps = useCallback(async (): Promise<{ steps: TransactionStep[]; preCompleted: Set<number> }> => {
    if (!publicClient || !accountAddress) return { steps: [], preCompleted: new Set() }

    const steps: TransactionStep[] = []
    const preCompleted = new Set<number>()
    const parsedAmount = safeParseUnits(fromAmount, fromToken.decimals)

    // Native ETH: no approval or permit needed
    if (fromToken.symbol === "ETH") {
      steps.push({
        type: TransactionStepType.SwapTransaction,
        inputTokenSymbol: fromToken.symbol,
        outputTokenSymbol: toToken.symbol,
        inputTokenIcon: fromToken.icon,
        outputTokenIcon: toToken.icon,
        routeType: source === "kyberswap" ? "kyberswap" : "pool",
      } as SwapStepType)
      return { steps, preCompleted }
    }

    if (source === "kyberswap") {
      // Kyberswap: check ERC20 approval to Kyberswap router (no Permit2)
      const kyberRouter = getKyberswapRouterAddress() as Address
      const allowance = (await publicClient.readContract({
        address: fromToken.address,
        abi: Erc20AbiDefinition,
        functionName: "allowance",
        args: [accountAddress as Address, kyberRouter],
      })) as bigint

      // Always include approval step; mark pre-completed if already approved
      const approvalIndex = steps.length
      steps.push(createTokenApprovalStep(fromToken.symbol, fromToken.address, fromToken.icon))
      if (allowance >= parsedAmount) {
        preCompleted.add(approvalIndex)
      }

      steps.push({
        type: TransactionStepType.SwapTransaction,
        inputTokenSymbol: fromToken.symbol,
        outputTokenSymbol: toToken.symbol,
        inputTokenIcon: fromToken.icon,
        outputTokenIcon: toToken.icon,
        routeType: "kyberswap",
      } as SwapStepType)
    } else {
      // Alphix: check ERC20 approval to Permit2
      const allowance = (await publicClient.readContract({
        address: fromToken.address,
        abi: Erc20AbiDefinition,
        functionName: "allowance",
        args: [accountAddress as Address, PERMIT2_ADDRESS as Address],
      })) as bigint

      // Always include approval step; mark pre-completed if already approved
      const approvalIndex = steps.length
      steps.push(createTokenApprovalStep(fromToken.symbol, fromToken.address, fromToken.icon))
      if (allowance >= parsedAmount) {
        preCompleted.add(approvalIndex)
      }

      // Fetch permit data to determine if signature is needed
      const permitData = await fetchPermitData()
      permitDataRef.current = permitData

      if (permitData.needsPermit === true) {
        steps.push(createPermit2SignatureStep())
      }

      steps.push({
        type: TransactionStepType.SwapTransaction,
        inputTokenSymbol: fromToken.symbol,
        outputTokenSymbol: toToken.symbol,
        inputTokenIcon: fromToken.icon,
        outputTokenIcon: toToken.icon,
        routeType: "pool",
      } as SwapStepType)
    }

    return { steps, preCompleted }
  }, [publicClient, accountAddress, fromAmount, fromToken, toToken, source])

  // =========================================================================
  // FETCH PERMIT DATA (reused from useSwapExecution)
  // =========================================================================

  const fetchPermitData = useCallback(async (): Promise<PreparePermitResponse> => {
    const parsedAmount = safeParseUnits(fromAmount, fromToken.decimals)
    // For ExactOut, the permit must cover the worst-case input (quoted amount + slippage)
    // so that SETTLE can pull enough tokens through Permit2 to handle price movement.
    const isExactOut = lastEditedSideRef.current === "to"
    let permitAmountIn = parsedAmount
    if (isExactOut) {
      permitAmountIn = (parsedAmount * BigInt(Math.floor((100 + currentSlippage) * 100))) / 10000n
    }

    const response = await fetch("/api/swap/prepare-permit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userAddress: accountAddress,
        fromTokenAddress: fromToken.address,
        fromTokenSymbol: fromToken.symbol,
        toTokenSymbol: toToken.symbol,
        chainId: currentChainId,
        amountIn: permitAmountIn.toString(),
        approvalMode: isInfiniteApprovalEnabled() ? "infinite" : "exact",
      }),
    })
    const data: unknown = await response.json()
    if (!response.ok) {
      const msg = (data && typeof data === "object" && "message" in data ? (data as any).message : null) as string | null
      throw new Error(msg || "Failed to fetch permit data")
    }
    if (!data || typeof data !== "object" || !("ok" in data) || (data as any).ok !== true) {
      const msg = (data && typeof data === "object" && "message" in data ? (data as any).message : null) as string | null
      throw new Error(msg || "Failed to fetch permit data")
    }
    return data as PreparePermitResponse
  }, [accountAddress, currentChainId, currentSlippage, fromAmount, fromToken.address, fromToken.decimals, fromToken.symbol, lastEditedSideRef, toToken.symbol])

  // =========================================================================
  // STEP EXECUTORS
  // =========================================================================

  const executeApproval = useCallback(async (): Promise<string> => {
    const parsedAmount = safeParseUnits(fromAmount, fromToken.decimals)
    const isInfinite = isInfiniteApprovalEnabled()
    const approvalAmount = isInfinite ? maxUint256 : parsedAmount + 1n

    const approvalSpender = source === "kyberswap"
      ? (getKyberswapRouterAddress() as Address)
      : PERMIT2_ADDRESS

    toast("Confirm in Wallet", { icon: createElement(IconCircleInfo, { className: "h-4 w-4" }) })

    const approveTxHash = await sendApprovalTx({
      address: fromToken.address,
      abi: Erc20AbiDefinition,
      functionName: "approve",
      args: [approvalSpender, approvalAmount],
    })
    if (!approveTxHash) throw new Error("Failed to send approval transaction")

    // Track in Redux
    if (currentChainId) {
      const approveInfo: ApproveTransactionInfo = {
        type: TransactionType.Approve,
        tokenAddress: fromToken.address,
        spender: approvalSpender,
      }
      addTransaction(
        { hash: approveTxHash, chainId: currentChainId, from: accountAddress, to: fromToken.address } as any,
        approveInfo
      )
    }

    // Wait for confirmation
    const receipt = await publicClient!.waitForTransactionReceipt({ hash: approveTxHash as Hex })
    if (!receipt || receipt.status !== "success") throw new Error("Approval transaction failed on-chain")

    toast.success(`${fromToken.symbol} Approved`, {
      icon: createElement(IconBadgeCheck2, { className: "h-4 w-4 text-green-500" }),
      description: isInfinite
        ? `Approved infinite ${fromToken.symbol} for swapping`
        : `Approved ${fromAmount} ${fromToken.symbol} for this swap`,
      action: { label: "View Transaction", onClick: () => window.open(getExplorerTxUrl(approveTxHash), "_blank") },
    })

    return approveTxHash
  }, [accountAddress, addTransaction, currentChainId, fromAmount, fromToken, publicClient, sendApprovalTx, source])

  const executePermitSignature = useCallback(async (): Promise<Hex> => {
    // If we don't have permit data from step generation, fetch it fresh
    if (!permitDataRef.current) {
      permitDataRef.current = await fetchPermitData()
    }

    const permitData = permitDataRef.current
    if (!permitData || permitData.needsPermit !== true) {
      throw new Error("Permit data is missing when signature is required")
    }

    const permitMessage = permitData.permitData.message
    const messageToSign = {
      details: {
        token: getAddress(fromToken.address),
        amount: BigInt(permitMessage.details.amount),
        expiration: permitMessage.details.expiration,
        nonce: permitMessage.details.nonce,
      },
      spender: getAddress(permitMessage.spender),
      sigDeadline: BigInt(permitMessage.sigDeadline),
    }

    toast("Sign in Wallet", { icon: createElement(IconCircleInfo, { className: "h-4 w-4" }) })

    const sig = await signTypedDataAsync({
      domain: permitData.permitData.domain,
      types: permitData.permitData.types,
      primaryType: "PermitSingle",
      message: messageToSign,
    })
    if (!sig) throw new Error("Signature process did not return a valid signature.")

    signatureRef.current = sig

    toast.success("Signature Complete", {
      icon: createElement(IconBadgeCheck2, { className: "h-4 w-4 text-green-500" }),
      description: `${fromToken.symbol} permit signed`,
    })

    return sig
  }, [fetchPermitData, fromToken.address, fromToken.symbol, signTypedDataAsync])

  // Fetch a fresh Kyberswap binding quote right before execution
  // This ensures the encodedSwapData has fresh deadlines and route data
  // Includes timeout (8s) and 1 retry on timeout to guard against "Route request timed out"
  const fetchFreshKyberswapQuote = useCallback(async (): Promise<KyberswapQuoteData> => {
    const FRESH_QUOTE_TIMEOUT_MS = 8000
    const MAX_RETRIES = 1
    let lastError: Error | null = null

    const amountStr = lastEditedSideRef.current === "to" ? toAmount : fromAmount
    const body = {
      fromTokenSymbol: fromToken.symbol,
      toTokenSymbol: toToken.symbol,
      amountDecimalsStr: amountStr,
      swapType: lastEditedSideRef.current === "to" ? "ExactOut" : "ExactIn",
      chainId: currentChainId,
      network: currentChainId ? modeForChainId(currentChainId) ?? 'base' : 'base',
      binding: true,
      userAddress: accountAddress,
      slippageBps: Math.round(currentSlippage * 100),
      fromTokenAddress: fromToken.address,
      toTokenAddress: toToken.address,
      fromTokenDecimals: fromToken.decimals,
      toTokenDecimals: toToken.decimals,
    }

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), FRESH_QUOTE_TIMEOUT_MS)

      try {
        const response = await fetch("/api/swap/get-quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          signal: controller.signal,
          body: JSON.stringify({ ...body, _t: Date.now() }),
        })
        clearTimeout(timeoutId)

        const data = await response.json()
        if (!response.ok || !data.success) {
          throw new Error(data.error || "Failed to refresh Kyberswap quote")
        }
        if (data.source !== "kyberswap" || !data.kyberswapData?.encodedSwapData) {
          throw new Error("Fresh quote did not return Kyberswap route")
        }
        return data.kyberswapData as KyberswapQuoteData
      } catch (error: any) {
        clearTimeout(timeoutId)
        if (error?.name === "AbortError") {
          lastError = new Error("Route request timed out")
          console.warn(`[fetchFreshKyberswapQuote] Attempt ${attempt + 1} timed out, ${attempt < MAX_RETRIES ? "retrying..." : "giving up"}`)
          continue // Retry on timeout
        }
        throw error // Non-timeout errors fail immediately
      }
    }

    throw lastError! // All retries exhausted
  }, [accountAddress, currentChainId, currentSlippage, fromAmount, fromToken, lastEditedSideRef, toAmount, toToken])

  // Fetch a fresh Alphix quote right before execution to ensure amounts and fees are current.
  // Returns updated trade params (swapType, amounts, dynamicFee). Falls back to original trade on failure.
  const fetchFreshAlphixQuote = useCallback(async (): Promise<{
    swapType: "ExactIn" | "ExactOut"
    amountDecimalsStr: string
    limitAmountDecimalsStr: string
    dynamicSwapFee: number | null
  }> => {
    const TIMEOUT_MS = 8000
    const amountStr = lastEditedSideRef.current === "to" ? toAmount : fromAmount
    const swapType = lastEditedSideRef.current === "to" ? "ExactOut" : "ExactIn"
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch("/api/swap/get-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          fromTokenSymbol: fromToken.symbol,
          toTokenSymbol: toToken.symbol,
          amountDecimalsStr: amountStr,
          swapType,
          chainId: currentChainId,
          network: currentChainId ? modeForChainId(currentChainId) ?? 'base' : 'base',
          binding: true,
          userAddress: accountAddress,
          slippageBps: Math.round(currentSlippage * 100),
          fromTokenAddress: fromToken.address,
          toTokenAddress: toToken.address,
          fromTokenDecimals: fromToken.decimals,
          toTokenDecimals: toToken.decimals,
          _t: Date.now(),
        }),
      })
      clearTimeout(timeoutId)

      const data = await response.json()
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Failed to refresh Alphix quote")
      }

      // Re-derive fresh amounts and limit from the updated quote
      const freshFromAmount = swapType === "ExactOut" ? String(data.fromAmount ?? fromAmount) : fromAmount
      const freshToAmount = swapType === "ExactIn" ? String(data.toAmount ?? toAmount) : toAmount
      const freshDynamicFee = data.dynamicFeeBps ?? null

      // Amounts must stay human-readable (build-tx.ts applies safeParseUnits)
      let freshAmountDecimalsStr: string
      let freshLimitDecimalsStr: string

      if (swapType === "ExactIn") {
        freshAmountDecimalsStr = freshFromAmount // human-readable, e.g. "1.5"
        const quotedOutBigInt = parseUnits(freshToAmount || "0", toToken.decimals)
        const minOutBigInt = (quotedOutBigInt * BigInt(Math.floor((100 - currentSlippage) * 100))) / 10000n
        freshLimitDecimalsStr = formatUnits(minOutBigInt, toToken.decimals) // human-readable
      } else {
        freshAmountDecimalsStr = freshToAmount // human-readable, e.g. "0.00075"
        const quotedInBigInt = parseUnits(freshFromAmount || "0", fromToken.decimals)
        const maxInBigInt = (quotedInBigInt * BigInt(Math.floor((100 + currentSlippage) * 100))) / 10000n
        freshLimitDecimalsStr = formatUnits(maxInBigInt, fromToken.decimals) // human-readable
      }

      return {
        swapType,
        amountDecimalsStr: freshAmountDecimalsStr,
        limitAmountDecimalsStr: freshLimitDecimalsStr,
        dynamicSwapFee: freshDynamicFee,
      }
    } catch (error: any) {
      clearTimeout(timeoutId)
      console.warn("[useSwapStepExecutor] Fresh Alphix quote failed, using original trade params:", error?.message)
      // Fall back to original trade params
      if (!trade) throw new Error("Trade params missing and fresh quote failed")
      return {
        swapType: trade.swapType,
        amountDecimalsStr: trade.amountDecimalsStr,
        limitAmountDecimalsStr: trade.limitAmountDecimalsStr,
        dynamicSwapFee: trade.dynamicSwapFee,
      }
    }
  }, [accountAddress, currentChainId, currentSlippage, fromAmount, fromToken, lastEditedSideRef, toAmount, toToken, trade])

  const executeSwapTransaction = useCallback(async (): Promise<SwapTxInfo> => {
    if (!trade) throw new Error("Trade params missing")
    if (!trade.amountDecimalsStr || !trade.limitAmountDecimalsStr) throw new Error("Missing trade amounts")

    // Refetch a fresh quote before building any transaction to avoid stale prices/fees
    let swapType: "ExactIn" | "ExactOut"
    let amountDecimalsStr: string
    let limitAmountDecimalsStr: string
    let fetchedDynamicFee: number | null

    if (source !== "kyberswap") {
      // Alphix: fetch fresh quote to get current prices and fees
      const freshTrade = await fetchFreshAlphixQuote()
      swapType = freshTrade.swapType
      amountDecimalsStr = freshTrade.amountDecimalsStr
      limitAmountDecimalsStr = freshTrade.limitAmountDecimalsStr
      fetchedDynamicFee = freshTrade.dynamicSwapFee
    } else {
      // Kyberswap: trade params from original (Kyberswap quote refresh happens below with encodedSwapData)
      swapType = trade.swapType
      amountDecimalsStr = trade.amountDecimalsStr
      limitAmountDecimalsStr = trade.limitAmountDecimalsStr
      fetchedDynamicFee = trade.dynamicSwapFee
    }

    let bodyForSwapTx: any

    if (source === "kyberswap") {
      // Server-side build-tx now handles fresh route + build + simulation.
      // We just need to send token info and amounts; the server fetches
      // fresh calldata from Kyberswap API right before building.
      const kyberRouterAddress = kyberswapData?.routerAddress || getKyberswapRouterAddress()

      bodyForSwapTx = {
        userAddress: accountAddress,
        fromTokenSymbol: fromToken.symbol,
        toTokenSymbol: toToken.symbol,
        swapType,
        amountDecimalsStr,
        limitAmountDecimalsStr,
        permitSignature: "0x",
        permitTokenAddress: fromToken.address,
        permitAmount: "0",
        permitNonce: 0,
        permitExpiration: 0,
        permitSigDeadline: "0",
        chainId: currentChainId,
        dynamicSwapFee: fetchedDynamicFee,
        fromTokenAddress: fromToken.address,
        toTokenAddress: toToken.address,
        fromTokenDecimals: fromToken.decimals,
        toTokenDecimals: toToken.decimals,
        slippageBps: Math.round(currentSlippage * 100),
        source: "kyberswap",
        kyberswapData: {
          routerAddress: kyberRouterAddress,
        },
      }
    } else if (fromToken.symbol === "ETH") {
      bodyForSwapTx = {
        userAddress: accountAddress,
        fromTokenSymbol: fromToken.symbol,
        toTokenSymbol: toToken.symbol,
        swapType,
        amountDecimalsStr,
        limitAmountDecimalsStr,
        permitSignature: "0x",
        permitTokenAddress: fromToken.address,
        permitAmount: "0",
        permitNonce: 0,
        permitExpiration: 0,
        permitSigDeadline: "0",
        chainId: currentChainId,
        dynamicSwapFee: fetchedDynamicFee,
        source: "alphix",
      }
    } else {
      // Alphix ERC20: use permit data + signature
      const permitDetails = permitDataRef.current
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
        throw new Error("Invalid permit data structure")
      }

      bodyForSwapTx = {
        userAddress: accountAddress,
        fromTokenSymbol: fromToken.symbol,
        toTokenSymbol: toToken.symbol,
        swapType,
        amountDecimalsStr,
        limitAmountDecimalsStr,
        permitSignature: signatureRef.current || "0x",
        permitTokenAddress: fromToken.address,
        permitAmount,
        permitNonce,
        permitExpiration,
        permitSigDeadline,
        chainId: currentChainId,
        dynamicSwapFee: fetchedDynamicFee,
        source: "alphix",
      }
    }

    // Build transaction
    const buildResp = await fetch("/api/swap/build-tx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyForSwapTx),
    })
    const buildData = await buildResp.json()
    if (!buildResp.ok) {
      const errorInfo = buildData.message || "Failed to build transaction"
      throw new Error(errorInfo, { cause: buildData.errorDetails || buildData.error })
    }

    // Send transaction
    toast("Confirm Swap", { icon: createElement(IconCircleInfo, { className: "h-4 w-4" }) })

    let txHash: string | undefined

    if (source === "kyberswap" && buildData.data) {
      txHash = await sendRawTx({
        to: getAddress(buildData.to) as Address,
        data: buildData.data as Hex,
        value: BigInt(buildData.value),
        dataSuffix: BUILDER_CODE_SUFFIX,
      })
    } else {
      txHash = await sendSwapTx({
        address: getAddress(buildData.to),
        abi: UniversalRouterAbi,
        functionName: "execute",
        args: [buildData.commands as Hex, buildData.inputs as Hex[], BigInt(buildData.deadline)],
        value: BigInt(buildData.value),
        dataSuffix: BUILDER_CODE_SUFFIX,
      } as any)
    }

    if (!txHash) throw new Error("Failed to send swap transaction (no hash received)")

    // Track swap in Redux
    if (txHash && currentChainId) {
      const isExactInput = swapType === "ExactIn"
      const typeInfo = isExactInput
        ? {
            type: TransactionType.Swap,
            tradeType: TradeType.EXACT_INPUT,
            inputCurrencyId: `${currentChainId}-${fromToken.address}`,
            outputCurrencyId: `${currentChainId}-${toToken.address}`,
            inputCurrencyAmountRaw: safeParseUnits(fromAmount, fromToken.decimals).toString(),
            expectedOutputCurrencyAmountRaw: safeParseUnits(toAmount, toToken.decimals).toString(),
            minimumOutputCurrencyAmountRaw: safeParseUnits(toAmount, toToken.decimals).toString(),
          } as ExactInputSwapTransactionInfo
        : {
            type: TransactionType.Swap,
            tradeType: TradeType.EXACT_OUTPUT,
            inputCurrencyId: `${currentChainId}-${fromToken.address}`,
            outputCurrencyId: `${currentChainId}-${toToken.address}`,
            outputCurrencyAmountRaw: safeParseUnits(toAmount, toToken.decimals).toString(),
            expectedInputCurrencyAmountRaw: safeParseUnits(fromAmount, fromToken.decimals).toString(),
            maximumInputCurrencyAmountRaw: safeParseUnits(fromAmount, fromToken.decimals).toString(),
          } as ExactOutputSwapTransactionInfo
      addTransaction(
        { hash: txHash, chainId: currentChainId, from: accountAddress, to: buildData.to } as any,
        typeInfo
      )
    }

    const txInfo: SwapTxInfo = {
      hash: txHash as string,
      fromAmount,
      fromSymbol: fromToken.symbol,
      toAmount,
      toSymbol: toToken.symbol,
      explorerUrl: getExplorerTxUrl(txHash as string),
      touchedPools: Array.isArray(buildData?.touchedPools) ? buildData.touchedPools : undefined,
    }

    // Wait for confirmation
    const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash as Hex })
    if (!receipt || receipt.status !== "success") throw new Error("Swap transaction failed on-chain")

    // Invalidate caches
    const swapVolumeUSD = parseFloat(fromAmount) * (fromTokenUsdPrice || 0)
    await invalidateSwapCache(queryClient, accountAddress!, currentChainId!, buildData.touchedPools, swapVolumeUSD, receipt.blockNumber)

    // Refetch balances after a short delay
    setTimeout(async () => {
      await refetchFromTokenBalance?.()
      await refetchToTokenBalance?.()
    }, 1500)

    return txInfo
  }, [
    accountAddress,
    addTransaction,
    currentChainId,
    currentSlippage,
    fetchFreshAlphixQuote,
    fromAmount,
    fromToken,
    fromTokenUsdPrice,
    kyberswapData,
    publicClient,
    queryClient,
    refetchFromTokenBalance,
    refetchToTokenBalance,
    sendRawTx,
    sendSwapTx,
    source,
    toAmount,
    toToken,
    trade,
  ])

  // =========================================================================
  // MAIN EXECUTE
  // =========================================================================

  const execute = useCallback(async () => {
    if (!accountAddress || !publicClient) return

    // Validate trade readiness
    if (tradeState && tradeState !== "ready") {
      toast.error("Swap Not Ready", {
        icon: createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
        description: "The quote is still loading. Please wait.",
      })
      return
    }
    if (!trade) return

    executionRef.current = { cancelled: false }
    permitDataRef.current = null
    signatureRef.current = null

    // Set initial executing state
    setState({ steps: [], currentStepIndex: 0, status: "executing", error: undefined, txInfo: null })

    try {
      // Generate steps (this also checks allowances and fetches permit data)
      const { steps, preCompleted } = await generateSteps()
      if (steps.length === 0) {
        setState(prev => ({ ...prev, status: "error", error: "No steps generated" }))
        return
      }

      // Initialize step states — pre-completed steps start as "completed"
      const stepStates: SwapStepState[] = steps.map((step, idx) => ({
        step,
        status: preCompleted.has(idx) ? ("completed" as const) : ("pending" as const),
      }))

      // Find the first non-pre-completed step to set as the current index
      const firstActiveIndex = steps.findIndex((_, idx) => !preCompleted.has(idx))
      const startIndex = firstActiveIndex >= 0 ? firstActiveIndex : 0
      setState({ steps: stepStates, currentStepIndex: startIndex, status: "executing", error: undefined, txInfo: null })

      // Execute each step sequentially (skip pre-completed)
      for (let i = 0; i < steps.length; i++) {
        if (executionRef.current.cancelled) {
          setState(prev => ({ ...prev, status: "idle" }))
          return
        }

        // Skip pre-completed steps
        if (preCompleted.has(i)) continue

        const step = steps[i]

        // Mark step as active
        setState(prev => {
          const newSteps = [...prev.steps]
          if (newSteps[i]) newSteps[i] = { ...newSteps[i], status: "active" }
          return { ...prev, steps: newSteps, currentStepIndex: i }
        })

        try {
          if (step.type === TransactionStepType.TokenApprovalTransaction) {
            await executeApproval()

            // After approval in Alphix flow, re-fetch permit data
            if (source !== "kyberswap") {
              const freshPermitData = await fetchPermitData()
              permitDataRef.current = freshPermitData
            }
          } else if (step.type === TransactionStepType.Permit2Signature) {
            await executePermitSignature()
          } else if (step.type === TransactionStepType.SwapTransaction) {
            const txInfo = await executeSwapTransaction()
            setState(prev => ({ ...prev, txInfo }))
          }

          // Mark step as completed
          setState(prev => {
            const newSteps = [...prev.steps]
            if (newSteps[i]) newSteps[i] = { ...newSteps[i], status: "completed" }
            return { ...prev, steps: newSteps }
          })
        } catch (err: any) {
          const classified = classifySwapError(err)

          if (classified.kind === "rejected") {
            // User rejected - return to idle cleanly
            toast(classified.title, {
              icon: createElement(IconCircleInfo, { className: "h-4 w-4" }),
              description: classified.description,
            })
            setState(prev => ({
              ...prev,
              status: "error",
              error: classified.description,
              steps: prev.steps.map((s, idx) =>
                idx === i ? { ...s, status: "error" as const, error: classified.description } : s
              ),
            }))
            return
          }

          // Non-rejection error
          Sentry.captureException(err, {
            tags: {
              component: "useSwapStepExecutor",
              stepType: step.type,
              stepIndex: String(i),
              errorKind: classified.kind,
            },
            extra: {
              fromTokenSymbol: fromToken?.symbol,
              fromTokenAddress: fromToken?.address,
              toTokenSymbol: toToken?.symbol,
              toTokenAddress: toToken?.address,
              fromAmount,
              toAmount,
              chainId: currentChainId,
              shortMessage: err?.shortMessage,
              cause: err?.cause?.message || err?.cause,
            },
          })

          toast.error(classified.title, {
            icon: createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
            description: classified.description,
            action: { label: "Copy Error", onClick: () => navigator.clipboard.writeText(err?.message || String(err)) },
          })

          setState(prev => ({
            ...prev,
            status: "error",
            error: classified.description,
            steps: prev.steps.map((s, idx) =>
              idx === i ? { ...s, status: "error" as const, error: classified.description } : s
            ),
          }))
          return
        }
      }

      // All steps completed
      setState(prev => ({ ...prev, status: "completed" }))
    } catch (err: any) {
      // Top-level error (e.g., step generation failed)
      console.error("[useSwapStepExecutor] Execution error:", err)

      Sentry.captureException(err, {
        tags: { component: "useSwapStepExecutor", operation: "execute" },
        extra: { fromToken: fromToken?.symbol, toToken: toToken?.symbol, fromAmount },
      })

      const classified = classifySwapError(err)
      if (classified.kind !== "rejected") {
        toast.error(classified.title, {
          icon: createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
          description: classified.description,
        })
      }

      setState(prev => ({ ...prev, status: "error", error: classified.description }))
    }
  }, [
    accountAddress,
    currentChainId,
    executeApproval,
    executePermitSignature,
    executeSwapTransaction,
    fetchPermitData,
    fromAmount,
    fromToken,
    generateSteps,
    publicClient,
    source,
    toAmount,
    toToken,
    trade,
    tradeState,
  ])

  // Derive currentStep for ProgressIndicator
  const currentStep: CurrentStepState | undefined = state.steps.length > 0 && state.currentStepIndex < state.steps.length
    ? {
        step: state.steps[state.currentStepIndex].step,
        accepted: state.steps[state.currentStepIndex].status === "active",
      }
    : undefined

  return {
    execute,
    state,
    reset,
    currentStep,
  }
}
