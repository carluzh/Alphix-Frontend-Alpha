/**
 * Swap Flow Definition
 *
 * Provides generateSteps + executors + mapStepsToUI for TransactionModal.
 * Handles Alphix pool swaps and Kyberswap aggregator swaps.
 *
 * @see ../EXECUTION_REFACTOR_BRIEF.md — Layer 3
 */

import { useCallback, useMemo, useRef, useState } from "react"
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
  TransactionStepType,
  createTokenApprovalStep,
  createPermit2SignatureStep,
  type SwapStep as SwapStepType,
} from "@/lib/transactions/types"
import type { StepGenerationResult, StepExecutorFn, StepResult } from "@/lib/transactions/useStepExecutor"

import type { Token, SwapTxInfo } from "@/components/swap/swap-interface"
import type { ExecutionTradeParams } from "@/components/swap/useSwapTrade"
import type { AggregatorSource } from "@/lib/aggregators/types"
import type { KyberswapQuoteData } from "@/components/swap/useSwapQuote"
import { getKyberswapRouterAddress } from "@/lib/aggregators/kyberswap"
import { BUILDER_CODE_SUFFIX } from "@/lib/builder-code"

// =============================================================================
// TYPES
// =============================================================================

export type SwapBuildPhase = "idle" | "building" | "confirming"

export interface UseSwapFlowArgs {
  fromToken: Token
  toToken: Token
  fromAmount: string
  toAmount: string
  lastEditedSideRef: React.MutableRefObject<"from" | "to">
  trade?: ExecutionTradeParams
  currentSlippage: number
  fromTokenUsdPrice: number
  refetchFromTokenBalance?: () => Promise<any>
  refetchToTokenBalance?: () => Promise<any>
  source?: AggregatorSource
  kyberswapData?: KyberswapQuoteData | null
  /** Target chain ID derived from token selection — use this instead of wallet chainId
   *  to avoid stale closures after ensureChain switches the wallet. */
  targetChainId?: number
}

export interface UseSwapFlowReturn {
  generateSteps: () => Promise<StepGenerationResult>
  executors: Record<string, StepExecutorFn>
  mapStepsToUI: (steps: unknown[]) => TransactionStep[]
  /** Phase of the swap step (building tx vs confirming in wallet) */
  buildPhase: SwapBuildPhase
  /** Swap tx info populated after successful swap (for success toast) */
  txInfo: SwapTxInfo | null
}

// =============================================================================
// HOOK
// =============================================================================

export function useSwapFlow({
  fromToken,
  toToken,
  fromAmount,
  toAmount,
  lastEditedSideRef,
  trade,
  currentSlippage,
  fromTokenUsdPrice,
  refetchFromTokenBalance,
  refetchToTokenBalance,
  source = "alphix",
  kyberswapData,
  targetChainId,
}: UseSwapFlowArgs): UseSwapFlowReturn {
  const { address: accountAddress, chainId: walletChainId } = useAccount()
  // Prefer targetChainId (from token selection) over wallet chainId — wallet state
  // can be stale immediately after ensureChain switches the wallet.
  const currentChainId = targetChainId ?? walletChainId
  const publicClient = usePublicClient({ chainId: currentChainId })

  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync: sendApprovalTx } = useWriteContract()
  const { writeContractAsync: sendSwapTx } = useWriteContract()
  const { sendTransactionAsync: sendRawTx } = useSendTransaction()

  const addTransaction = useTransactionAdder()

  // Cross-step refs for permit data and signature
  const permitDataRef = useRef<PreparePermitResponse | null>(null)
  const signatureRef = useRef<Hex | null>(null)

  // Swap-specific state
  const [buildPhase, setBuildPhase] = useState<SwapBuildPhase>("idle")
  const [txInfo, setTxInfo] = useState<SwapTxInfo | null>(null)

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
      console.warn("[useSwapFlow] Fresh Alphix quote failed, using original trade params:", error?.message)
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

  const generateSteps = useCallback(async (): Promise<StepGenerationResult> => {
    if (!publicClient || !accountAddress) return { steps: [] }

    // Reset cross-step refs
    permitDataRef.current = null
    signatureRef.current = null
    setTxInfo(null)
    setBuildPhase("idle")

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
  // EXECUTORS
  // =========================================================================

  const executors = useMemo((): Record<string, StepExecutorFn> => {
    const approvalExecutor: StepExecutorFn = async (_step, _ctx): Promise<StepResult> => {
      const parsedAmount = safeParseUnits(fromAmount, fromToken.decimals)
      const isInfinite = isInfiniteApprovalEnabled()
      const approvalAmount = isInfinite ? maxUint256 : parsedAmount + 1n

      const approvalSpender = source === "kyberswap"
        ? (getKyberswapRouterAddress() as Address)
        : PERMIT2_ADDRESS

      toast.info("Confirm in wallet")

      const approveTxHash = await sendApprovalTx({
        address: fromToken.address,
        abi: Erc20AbiDefinition,
        functionName: "approve",
        args: [approvalSpender, approvalAmount],
      })
      if (!approveTxHash) throw new Error("Failed to send approval transaction")

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

      toast.success(`${fromToken.symbol} approved`, {
        description: isInfinite
          ? `Approved infinite ${fromToken.symbol} for swapping`
          : `Approved ${fromAmount} ${fromToken.symbol} for this swap`,
        action: { label: "View transaction", onClick: () => window.open(getExplorerTxUrl(approveTxHash, currentChainId ? modeForChainId(currentChainId) ?? undefined : undefined), "_blank") },
      })

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

      toast.info("Sign in wallet")

      const sig = await signTypedDataAsync({
        domain: permitData.permitData.domain,
        types: permitData.permitData.types,
        primaryType: "PermitSingle",
        message: messageToSign,
      })
      if (!sig) throw new Error("Signature process did not return a valid signature.")

      signatureRef.current = sig

      toast.success("Signature complete", {
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

      if (txHash && currentChainId) {
        const typeInfo = buildSwapTransactionInfo(swapType, fromToken, toToken, fromAmount, toAmount, currentChainId)
        addTransaction(
          { hash: txHash, chainId: currentChainId, from: accountAddress, to: buildData.to } as any,
          typeInfo
        )
      }

      setTxInfo({
        hash: txHash as string,
        fromAmount,
        fromSymbol: fromToken.symbol,
        toAmount,
        toSymbol: toToken.symbol,
        explorerUrl: getExplorerTxUrl(txHash as string, currentChainId ? modeForChainId(currentChainId) ?? undefined : undefined),
        touchedPools: Array.isArray(buildData?.touchedPools) ? buildData.touchedPools : undefined,
      })

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
  // MAP STEPS TO UI
  // =========================================================================

  const mapStepsToUI = useCallback((steps: unknown[]): TransactionStep[] => {
    return (steps as TransactionStep[]).map((s) => s)
  }, [])

  return { generateSteps, executors, mapStepsToUI, buildPhase, txInfo }
}
