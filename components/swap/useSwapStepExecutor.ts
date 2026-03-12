/**
 * Swap Step Executor
 *
 * Thin wrapper around useStepExecutor (Layer 2) for swap transactions.
 * Handles step generation, swap-specific executors, and fresh quote refresh.
 *
 * @see lib/transactions/useStepExecutor.ts — generic orchestrator
 * @see TRANSACTION_STEPPER_PLAN.md — Layer 3 (flow definition)
 */

import { createElement, useCallback, useMemo, useRef, useState } from "react"
import { useAccount, usePublicClient, useSignTypedData, useWriteContract, useSendTransaction } from "wagmi"
import { getAddress, formatUnits, maxUint256, parseUnits, type Address, type Hex } from "viem"
import {
  type PreparePermitResponse,
  safeParseUnits,
  invalidateSwapCache,
  buildSwapRequestBody,
  fetchBuildTx,
  sendSwapTransaction,
  buildSwapTransactionInfo,
} from "@/lib/swap/swap-execution-common"
import { toast } from "sonner"
import { IconBadgeCheck2, IconCircleXmarkFilled, IconCircleInfo } from "nucleo-micro-bold-essential"
import * as Sentry from "@sentry/nextjs"

import { isInfiniteApprovalEnabled } from "@/hooks/useUserSettings"
import { PERMIT2_ADDRESS, Erc20AbiDefinition } from "@/lib/swap/swap-constants"
import { getExplorerTxUrl } from "@/lib/wagmiConfig"
import { modeForChainId } from "@/lib/network-mode"
import {
  useTransactionAdder,
  TransactionType,
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
import {
  useStepExecutor,
  type StepExecutorFn,
  type StepResult,
  type StepExecutionContext,
} from "@/lib/transactions/useStepExecutor"

import type { Token, SwapTxInfo } from "./swap-interface"
import type { ExecutionTradeParams } from "./useSwapTrade"
import type { AggregatorSource } from "@/lib/aggregators/types"
import type { KyberswapQuoteData } from "./useSwapQuote"
import { getKyberswapRouterAddress } from "@/lib/aggregators/kyberswap"
import { classifySwapError } from "@/lib/swap/error-classification"
import { BUILDER_CODE_SUFFIX } from "@/lib/builder-code"

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

export type SwapBuildPhase = "idle" | "building" | "confirming"

export interface UseSwapStepExecutorReturn {
  execute: () => Promise<void>
  state: SwapExecutorState
  reset: () => void
  /** Current step for ProgressIndicator */
  currentStep: CurrentStepState | undefined
  /** Phase of the swap step (building tx vs confirming in wallet) */
  buildPhase: SwapBuildPhase
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

  // Cross-step refs for permit data and signature
  const permitDataRef = useRef<PreparePermitResponse | null>(null)
  const signatureRef = useRef<Hex | null>(null)

  // Store the original steps for ProgressIndicator mapping
  const stepsRef = useRef<TransactionStep[]>([])

  // txInfo is swap-specific state not tracked by useStepExecutor
  const [txInfo, setTxInfo] = useState<SwapTxInfo | null>(null)

  // Build phase for UI feedback (building tx vs confirming in wallet)
  const [buildPhase, setBuildPhase] = useState<SwapBuildPhase>("idle")

  // =========================================================================
  // FETCH PERMIT DATA
  // =========================================================================

  const fetchPermitData = useCallback(async (): Promise<PreparePermitResponse> => {
    const parsedAmount = safeParseUnits(fromAmount, fromToken.decimals)
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
  // FETCH FRESH ALPHIX QUOTE
  // =========================================================================

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

      const freshFromAmount = swapType === "ExactOut" ? String(data.fromAmount ?? fromAmount) : fromAmount
      const freshToAmount = swapType === "ExactIn" ? String(data.toAmount ?? toAmount) : toAmount
      const freshDynamicFee = data.dynamicFeeBps ?? null

      let freshAmountDecimalsStr: string
      let freshLimitDecimalsStr: string

      if (swapType === "ExactIn") {
        freshAmountDecimalsStr = freshFromAmount
        const quotedOutBigInt = parseUnits(freshToAmount || "0", toToken.decimals)
        const minOutBigInt = (quotedOutBigInt * BigInt(Math.floor((100 - currentSlippage) * 100))) / 10000n
        freshLimitDecimalsStr = formatUnits(minOutBigInt, toToken.decimals)
      } else {
        freshAmountDecimalsStr = freshToAmount
        const quotedInBigInt = parseUnits(freshFromAmount || "0", fromToken.decimals)
        const maxInBigInt = (quotedInBigInt * BigInt(Math.floor((100 + currentSlippage) * 100))) / 10000n
        freshLimitDecimalsStr = formatUnits(maxInBigInt, fromToken.decimals)
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
      if (!trade) throw new Error("Trade params missing and fresh quote failed")
      return {
        swapType: trade.swapType,
        amountDecimalsStr: trade.amountDecimalsStr,
        limitAmountDecimalsStr: trade.limitAmountDecimalsStr,
        dynamicSwapFee: trade.dynamicSwapFee,
      }
    }
  }, [accountAddress, currentChainId, currentSlippage, fromAmount, fromToken, lastEditedSideRef, toAmount, toToken, trade])

  // =========================================================================
  // STEP GENERATION
  // =========================================================================

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
      const kyberRouter = getKyberswapRouterAddress() as Address
      const allowance = (await publicClient.readContract({
        address: fromToken.address,
        abi: Erc20AbiDefinition,
        functionName: "allowance",
        args: [accountAddress as Address, kyberRouter],
      })) as bigint

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
      const allowance = (await publicClient.readContract({
        address: fromToken.address,
        abi: Erc20AbiDefinition,
        functionName: "allowance",
        args: [accountAddress as Address, PERMIT2_ADDRESS as Address],
      })) as bigint

      const approvalIndex = steps.length
      steps.push(createTokenApprovalStep(fromToken.symbol, fromToken.address, fromToken.icon))
      if (allowance >= parsedAmount) {
        preCompleted.add(approvalIndex)
      }

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
  }, [publicClient, accountAddress, fromAmount, fromToken, toToken, source, fetchPermitData])

  // =========================================================================
  // STEP EXECUTOR FUNCTIONS (StepExecutorFn interface)
  // =========================================================================

  const executors = useMemo((): Record<string, StepExecutorFn> => {
    const approvalExecutor: StepExecutorFn = async (_step, _ctx): Promise<StepResult> => {
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

      const receipt = await publicClient!.waitForTransactionReceipt({ hash: approveTxHash as Hex })
      if (!receipt || receipt.status !== "success") throw new Error("Approval transaction failed on-chain")

      toast.success(`${fromToken.symbol} Approved`, {
        icon: createElement(IconBadgeCheck2, { className: "h-4 w-4 text-green-500" }),
        description: isInfinite
          ? `Approved infinite ${fromToken.symbol} for swapping`
          : `Approved ${fromAmount} ${fromToken.symbol} for this swap`,
        action: { label: "View Transaction", onClick: () => window.open(getExplorerTxUrl(approveTxHash), "_blank") },
      })

      // After approval in Alphix flow, re-fetch permit data
      if (source !== "kyberswap") {
        const freshPermitData = await fetchPermitData()
        permitDataRef.current = freshPermitData
      }

      return { txHash: approveTxHash }
    }

    const permitExecutor: StepExecutorFn = async (_step, _ctx): Promise<StepResult> => {
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

      return { signature: sig }
    }

    const swapExecutor: StepExecutorFn = async (_step, _ctx): Promise<StepResult> => {
      if (!trade) throw new Error("Trade params missing")
      if (!trade.amountDecimalsStr || !trade.limitAmountDecimalsStr) throw new Error("Missing trade amounts")

      let swapType: "ExactIn" | "ExactOut"
      let amountDecimalsStr: string
      let limitAmountDecimalsStr: string
      let fetchedDynamicFee: number | null

      if (source !== "kyberswap") {
        const freshTrade = await fetchFreshAlphixQuote()
        swapType = freshTrade.swapType
        amountDecimalsStr = freshTrade.amountDecimalsStr
        limitAmountDecimalsStr = freshTrade.limitAmountDecimalsStr
        fetchedDynamicFee = freshTrade.dynamicSwapFee
      } else {
        swapType = trade.swapType
        amountDecimalsStr = trade.amountDecimalsStr
        limitAmountDecimalsStr = trade.limitAmountDecimalsStr
        fetchedDynamicFee = trade.dynamicSwapFee
      }

      const bodyForSwapTx = buildSwapRequestBody({
        source,
        accountAddress: accountAddress!,
        fromToken,
        toToken,
        swapType,
        amountDecimalsStr,
        limitAmountDecimalsStr,
        chainId: currentChainId!,
        dynamicSwapFee: fetchedDynamicFee,
        currentSlippage,
        kyberswapRouterAddress: kyberswapData?.routerAddress,
        permitSignature: signatureRef.current || undefined,
        permitDetails: permitDataRef.current,
      })

      setBuildPhase("building")
      const { data: buildData } = await fetchBuildTx(bodyForSwapTx)

      setBuildPhase("confirming")
      const txHash = await sendSwapTransaction({
        source,
        buildData,
        sendRawTx,
        sendSwapTx,
        dataSuffix: BUILDER_CODE_SUFFIX as Hex,
      })

      // Track swap in Redux
      if (txHash && currentChainId) {
        const typeInfo = buildSwapTransactionInfo(swapType, fromToken, toToken, fromAmount, toAmount, currentChainId)
        addTransaction(
          { hash: txHash, chainId: currentChainId, from: accountAddress, to: buildData.to } as any,
          typeInfo
        )
      }

      const swapTxInfo: SwapTxInfo = {
        hash: txHash as string,
        fromAmount,
        fromSymbol: fromToken.symbol,
        toAmount,
        toSymbol: toToken.symbol,
        explorerUrl: getExplorerTxUrl(txHash as string),
        touchedPools: Array.isArray(buildData?.touchedPools) ? buildData.touchedPools : undefined,
      }

      // Store txInfo for the UI (swap-specific, not tracked by useStepExecutor)
      setTxInfo(swapTxInfo)

      const receipt = await publicClient!.waitForTransactionReceipt({ hash: txHash as Hex })
      if (!receipt || receipt.status !== "success") throw new Error("Swap transaction failed on-chain")

      const swapVolumeUSD = parseFloat(fromAmount) * (fromTokenUsdPrice || 0)
      await invalidateSwapCache(accountAddress!, currentChainId!, buildData.touchedPools, swapVolumeUSD)

      setBuildPhase("idle")

      setTimeout(async () => {
        await refetchFromTokenBalance?.()
        await refetchToTokenBalance?.()
      }, 1500)

      return { txHash: txHash as string }
    }

    return {
      [TransactionStepType.TokenApprovalTransaction]: approvalExecutor,
      [TransactionStepType.Permit2Signature]: permitExecutor,
      [TransactionStepType.SwapTransaction]: swapExecutor,
    }
  }, [
    accountAddress,
    addTransaction,
    currentChainId,
    currentSlippage,
    fetchFreshAlphixQuote,
    fetchPermitData,
    fromAmount,
    fromToken,
    fromTokenUsdPrice,
    kyberswapData,
    publicClient,
    refetchFromTokenBalance,
    refetchToTokenBalance,
    sendApprovalTx,
    sendRawTx,
    sendSwapTx,
    signTypedDataAsync,
    source,
    toAmount,
    toToken,
    trade,
  ])

  // =========================================================================
  // STEP EXECUTOR (Layer 2)
  // =========================================================================

  const onFailure = useCallback((error: Error, stepIndex: number, isRejection: boolean) => {
    const classified = classifySwapError(error)

    if (isRejection) {
      toast(classified.title, {
        icon: createElement(IconCircleInfo, { className: "h-4 w-4" }),
      })
    } else {
      Sentry.captureException(error, {
        tags: {
          component: "useSwapStepExecutor",
          stepIndex: String(stepIndex),
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
        },
      })

      toast.error(classified.title, {
        icon: createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
        description: classified.description,
        action: { label: "Copy Error", onClick: () => navigator.clipboard.writeText(error?.message || String(error)) },
      })
    }
  }, [currentChainId, fromAmount, fromToken, toAmount, toToken])

  const executor = useStepExecutor({
    executors,
    onFailure,
  })

  // =========================================================================
  // EXECUTE (wraps step generation + useStepExecutor.execute)
  // =========================================================================

  const execute = useCallback(async () => {
    if (!accountAddress || !publicClient) return

    if (tradeState && tradeState !== "ready") {
      toast.error("Swap Not Ready", {
        icon: createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
        description: "The quote is still loading. Please wait.",
      })
      return
    }
    if (!trade) return

    // Reset cross-step refs
    permitDataRef.current = null
    signatureRef.current = null
    setTxInfo(null)

    try {
      const result = await generateSteps()
      if (result.steps.length === 0) return

      // Store steps for UI mapping
      stepsRef.current = result.steps

      await executor.execute({ steps: result.steps, preCompleted: result.preCompleted })
    } catch (err: any) {
      console.error("[useSwapStepExecutor] Step generation error:", err)

      Sentry.captureException(err, {
        tags: { component: "useSwapStepExecutor", operation: "generateSteps" },
        extra: { fromToken: fromToken?.symbol, toToken: toToken?.symbol, fromAmount },
      })

      const classified = classifySwapError(err)
      if (classified.kind !== "rejected") {
        toast.error(classified.title, {
          icon: createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
          description: classified.description,
        })
      }
    }
  }, [accountAddress, executor, fromAmount, fromToken, generateSteps, publicClient, toToken, trade, tradeState])

  // =========================================================================
  // RESET
  // =========================================================================

  const reset = useCallback(() => {
    permitDataRef.current = null
    signatureRef.current = null
    stepsRef.current = []
    setTxInfo(null)
    setBuildPhase("idle")
    executor.reset()
  }, [executor])

  // =========================================================================
  // STATE MAPPING — map useStepExecutor state to SwapExecutorState
  // =========================================================================

  const mappedSteps: SwapStepState[] = useMemo(() => {
    return executor.state.steps.map((s, idx) => ({
      step: stepsRef.current[idx] ?? ({ type: 'unknown' } as any),
      status: s.status === 'loading' ? 'active' as const
        : s.status === 'completed' ? 'completed' as const
        : s.status === 'error' ? 'error' as const
        : 'pending' as const,
      error: s.error,
    }))
  }, [executor.state.steps])

  const mappedStatus: SwapExecutorStatus =
    executor.isExecuting ? 'executing'
    : executor.state.status === 'completed' ? 'completed'
    : executor.state.status === 'error' ? 'error'
    : 'idle'

  const state: SwapExecutorState = useMemo(() => ({
    steps: mappedSteps,
    currentStepIndex: executor.state.currentStepIndex,
    status: mappedStatus,
    error: executor.state.error ?? undefined,
    txInfo,
  }), [mappedSteps, executor.state.currentStepIndex, mappedStatus, executor.state.error, txInfo])

  // Derive currentStep for ProgressIndicator
  const currentStep: CurrentStepState | undefined = mappedSteps.length > 0 && executor.state.currentStepIndex < mappedSteps.length
    ? {
        step: mappedSteps[executor.state.currentStepIndex].step,
        accepted: mappedSteps[executor.state.currentStepIndex].status === "active",
      }
    : undefined

  return {
    execute,
    state,
    reset,
    currentStep,
    buildPhase,
  }
}
