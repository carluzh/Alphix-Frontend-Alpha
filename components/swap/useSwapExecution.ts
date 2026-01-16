import * as Sentry from "@sentry/nextjs"
import { createElement, useCallback, useMemo, useState } from "react"
import { useAccount, usePublicClient, useSignTypedData, useWriteContract } from "wagmi"
import { getAddress, formatUnits, maxUint256, parseUnits, type Address, type Hex } from "viem"
import { toast } from "sonner"
import { IconBadgeCheck2, IconCircleXmarkFilled, IconCircleInfo } from "nucleo-micro-bold-essential"

import { invalidateAfterTx } from "@/lib/invalidation"
import { isInfiniteApprovalEnabled } from "@/hooks/useUserSettings"
import { PERMIT2_ADDRESS, UniversalRouterAbi, Erc20AbiDefinition } from "@/lib/swap/swap-constants"
import { getExplorerTxUrl, activeChainId } from "@/lib/wagmiConfig"
import { useTransactionAdder, TransactionType, TradeType, type ExactInputSwapTransactionInfo, type ExactOutputSwapTransactionInfo, type ApproveTransactionInfo } from "@/lib/transactions"

import type { Token, SwapTxInfo } from "./swap-interface"
import type { ExecutionTradeParams } from "./useSwapTrade"

declare global {
  interface Window {
    swapBuildData?: any
  }
}

export type SwapState = "input" | "review" | "swapping" | "success" | "error"

export type SwapError = {
  kind: "rejected" | "backend" | "revert" | "unknown"
  title: string
  description: string
  timestamp: number
} | null
export type SwapProgressState =
  | "init"
  | "checking_allowance"
  | "needs_approval"
  | "approving"
  | "waiting_approval"
  | "approval_complete"
  | "needs_signature"
  | "signing_permit"
  | "signature_complete"
  | "building_tx"
  | "executing_swap"
  | "waiting_confirmation"
  | "complete"
  | "error"
  | "ready_to_swap"

type TouchedPool = { poolId: string; subgraphId?: string }

type ExistingPermit = {
  amount: string
  expiration: number
  nonce: number
}

type PermitData = {
  domain: { name: string; version?: string; chainId: number; verifyingContract: `0x${string}` }
  types: Record<string, Array<{ name: string; type: string }>>
  message: {
    details: { token: `0x${string}`; amount: string; expiration: number; nonce: number }
    spender: `0x${string}`
    sigDeadline: string
  }
  primaryType: "PermitSingle"
}

type PreparePermitResponse =
  | { ok: true; message: string; needsPermit: false; isApproved?: boolean }
  | { ok: true; message: string; needsPermit: false; isApproved?: boolean; existingPermit: ExistingPermit }
  | { ok: true; message: string; needsPermit: true; isApproved?: boolean; permitData: PermitData }

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

const permitMessageKey = (permit: PreparePermitResponse | null | undefined): string | null => {
  if (!permit || permit.needsPermit !== true) return null
  const msg = permit.permitData?.message
  const domain = permit.permitData?.domain
  if (!msg || !domain) return null
  const d = msg.details || {}
  return `${domain.chainId}|${domain.verifyingContract}|${d.token}|${msg.spender}|${d.amount}|${d.expiration}|${d.nonce}|${msg.sigDeadline}`
}

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

type UseSwapExecutionArgs = {
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
}

export function useSwapExecution({
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
}: UseSwapExecutionArgs) {
  const publicClient = usePublicClient()
  const { address: accountAddress, isConnected, chainId: currentChainId } = useAccount()

  const { signTypedDataAsync } = useSignTypedData()
  const { writeContractAsync: sendSwapTx } = useWriteContract()
  const { writeContractAsync: sendApprovalTx } = useWriteContract()

  // Transaction tracking
  const addTransaction = useTransactionAdder()

  const [swapState, setSwapState] = useState<SwapState>("input")
  const [swapProgressState, setSwapProgressState] = useState<SwapProgressState>("init")
  const [isSwapping, setIsSwapping] = useState(false)
  const [completedSteps, setCompletedSteps] = useState<SwapProgressState[]>([])
  const [swapTxInfo, setSwapTxInfo] = useState<SwapTxInfo | null>(null)
  const [swapError, setSwapError] = useState<SwapError>(null)

  const [currentPermitDetailsForSign, setCurrentPermitDetailsForSign] = useState<PreparePermitResponse | null>(null)
  const [obtainedSignature, setObtainedSignature] = useState<Hex | null>(null)

  const syncPermitAndSignature = useCallback(
    (nextPermitData: PreparePermitResponse): Hex | null => {
      const prevKey = permitMessageKey(currentPermitDetailsForSign)
      const nextKey = permitMessageKey(nextPermitData)
      const signatureForThisAttempt = nextKey && prevKey !== nextKey ? null : obtainedSignature
      if (nextKey && prevKey !== nextKey) setObtainedSignature(null)
      setCurrentPermitDetailsForSign(nextPermitData)
      return signatureForThisAttempt
    },
    [currentPermitDetailsForSign, obtainedSignature]
  )

  const fetchPermitData = useCallback(async (): Promise<PreparePermitResponse> => {
    const parsedAmount = safeParseUnits(fromAmount, fromToken.decimals)
    const response = await fetch("/api/swap/prepare-permit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userAddress: accountAddress,
        fromTokenAddress: fromToken.address,
        fromTokenSymbol: fromToken.symbol,
        toTokenSymbol: toToken.symbol,
        chainId: currentChainId,
        amountIn: parsedAmount.toString(),
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
  }, [accountAddress, currentChainId, fromAmount, fromToken.address, fromToken.decimals, fromToken.symbol, toToken.symbol])

  const isUserRejected = useCallback((err: any) => {
    const name = err?.name || err?.cause?.name
    if (name === "UserRejectedRequestError") return true

    const code = err?.code || err?.cause?.code
    if (code === 4001 || code === 5750 || code === "ACTION_REJECTED") return true

    const msg = String(err?.shortMessage || err?.message || err?.cause?.message || "")

    return (
      // Rainbow: request + reject
      (/request/i.test(msg) && /reject/i.test(msg)) ||
      // Frame: declined
      /declined/i.test(msg) ||
      // SafePal: cancelled/canceled by user
      /cancell?ed by user/i.test(msg) ||
      // Trust: user cancelled/canceled
      /user cancell?ed/i.test(msg) ||
      // Coinbase: user denied
      /user denied/i.test(msg) ||
      // Fireblocks: user rejected
      /user rejected/i.test(msg) ||
      // Binance: closed modal
      /closed modal/i.test(msg) ||
      // Solflare connection: connection rejected
      /connection rejected/i.test(msg) ||
      // Solflare transaction: transaction cancelled
      /transaction cancelled/i.test(msg) ||
      // Generic fallbacks
      /denied transaction signature/i.test(msg)
    )
  }, [])

  const classifySwapError = useCallback(
    (err: any) => {
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

      // Heuristic: backend / API failures
      if (msgLc.includes("failed to fetch permit data") || msgLc.includes("failed to build transaction") || msgLc.includes("backend")) {
        return { kind: "backend" as const, title: "Backend Error", description: msg || "Something went wrong on our end." }
      }

      // Heuristic: on-chain revert / execution failure
      if (msgLc.includes("revert") || msgLc.includes("executionfailed") || msgLc.includes("call revert exception")) {
        return { kind: "revert" as const, title: "Transaction Reverted", description: msg || "The transaction reverted on-chain." }
      }

      return { kind: "unknown" as const, title: "Transaction Error", description: msg || "The transaction failed." }
    },
    [isUserRejected]
  )

  const ensureTradeReady = useCallback(() => {
    if (tradeState && tradeState !== "ready") return { ok: false as const, reason: tradeState }
    if (!trade) return { ok: false as const, reason: "missing_trade" as const }
    if (!trade.route) return { ok: false as const, reason: "missing_route" as const }
    if (trade.dynamicSwapFee === null) return { ok: false as const, reason: "missing_fee" as const }
    if (!trade.amountDecimalsStr || !trade.limitAmountDecimalsStr) return { ok: false as const, reason: "missing_amounts" as const }
    return { ok: true as const }
  }, [trade, tradeState])

  const resetForChange = useCallback(() => {
    window.swapBuildData = undefined
    setCompletedSteps([])
    setSwapState("input")
    setSwapProgressState("init")
    setIsSwapping(false)
    setObtainedSignature(null)
    setCurrentPermitDetailsForSign(null)
    setSwapError(null)
    // do NOT clear amounts/route here; caller owns those UX choices
  }, [])

  const resetForSwapAgain = useCallback(() => {
    window.swapBuildData = undefined
    setCompletedSteps([])
    setSwapTxInfo(null)
    setSwapState("input")
    setSwapProgressState("init")
    setIsSwapping(false)
    setObtainedSignature(null)
    setCurrentPermitDetailsForSign(null)
    setSwapError(null)
    // caller clears amounts/route
  }, [])

  const handleSwap = useCallback(async () => {
    const fromAmountNum = parseFloat(fromAmount || "0")
    if (!isConnected || currentChainId !== activeChainId || fromAmountNum <= 0 || !publicClient) return
    if (tradeState && tradeState !== "ready") return

    setSwapState("review")
    setCompletedSteps([])
    setIsSwapping(true)
    setSwapProgressState("checking_allowance")

    if (fromToken.symbol === "ETH") {
      setCompletedSteps(["approval_complete", "signature_complete"])
      setSwapProgressState("ready_to_swap")
      setIsSwapping(false)
      return
    }

    try {
      const parsedAmount = safeParseUnits(fromAmount, fromToken.decimals)
      const allowance = (await publicClient.readContract({
        address: fromToken.address,
        abi: Erc20AbiDefinition,
        functionName: "allowance",
        args: [accountAddress as Address, PERMIT2_ADDRESS as Address],
      })) as bigint

      if (allowance < parsedAmount) {
        setSwapProgressState("needs_approval")
        setIsSwapping(false)
        return
      }

      setCompletedSteps(["approval_complete"])
      const permitData = await fetchPermitData()
      const signatureForThisAttempt = syncPermitAndSignature(permitData)

      if (permitData.needsPermit === true && !signatureForThisAttempt) {
        setSwapProgressState("needs_signature")
      } else {
        setCompletedSteps(["approval_complete", "signature_complete"])
        setSwapProgressState("ready_to_swap")
      }
      setIsSwapping(false)
    } catch (error: any) {
      console.error("Error during initial swap checks:", error)
      Sentry.captureException(error, {
        tags: { operation: "swap_checks" },
        extra: { fromToken: fromToken?.symbol, toToken: toToken?.symbol, fromAmount },
      })
      setIsSwapping(false)
      setSwapProgressState("error")
      toast.error("Backend Error", {
        icon: createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
        description: "Something went wrong on our end. The team has been notified.",
      })
    }
  }, [
    accountAddress,
    currentChainId,
    fetchPermitData,
    fromAmount,
    fromToken.address,
    fromToken.decimals,
    fromToken.symbol,
    isConnected,
    publicClient,
    syncPermitAndSignature,
    tradeState,
    toToken.symbol,
  ])

  const handleConfirmSwap = useCallback(async () => {
    if (isSwapping || !publicClient) return
    setIsSwapping(true)
    const stateBeforeAction = swapProgressState

    try {
      const parsedAmount = safeParseUnits(fromAmount, fromToken.decimals)

      if (stateBeforeAction === "needs_approval") {
        setSwapProgressState("approving")
        toast("Confirm in Wallet", { icon: createElement(IconCircleInfo, { className: "h-4 w-4" }) })

        const isInfinite = isInfiniteApprovalEnabled()
        const approvalAmount = isInfinite ? maxUint256 : parsedAmount + 1n

        const approveTxHash = await sendApprovalTx({
          address: fromToken.address,
          abi: Erc20AbiDefinition,
          functionName: "approve",
          args: [PERMIT2_ADDRESS, approvalAmount],
        })
        if (!approveTxHash) throw new Error("Failed to send approval transaction")

        // Track approval transaction in Redux store
        if (approveTxHash && currentChainId) {
          const approveInfo: ApproveTransactionInfo = {
            type: TransactionType.Approve,
            tokenAddress: fromToken.address,
            spender: PERMIT2_ADDRESS,
          }
          addTransaction(
            { hash: approveTxHash, chainId: currentChainId, from: accountAddress, to: fromToken.address } as any,
            approveInfo
          )
        }

        setSwapProgressState("waiting_approval")
        const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTxHash as Hex })
        if (!approvalReceipt || approvalReceipt.status !== "success") throw new Error("Approval transaction failed on-chain")

        toast.success(`${fromToken.symbol} Approved`, {
          icon: createElement(IconBadgeCheck2, { className: "h-4 w-4 text-green-500" }),
          description: isInfinite ? `Approved infinite ${fromToken.symbol} for swapping` : `Approved ${fromAmount} ${fromToken.symbol} for this swap`,
          action: { label: "View Transaction", onClick: () => window.open(getExplorerTxUrl(approveTxHash), "_blank") },
        })

        setCompletedSteps((prev) => [...prev, "approval_complete"])
        const freshPermitData = await fetchPermitData()
        const signatureForThisAttempt = syncPermitAndSignature(freshPermitData)
        if (freshPermitData.needsPermit && !signatureForThisAttempt) {
          setSwapProgressState("needs_signature")
        } else {
          setSwapProgressState("ready_to_swap")
          setCompletedSteps((prev) => (prev.includes("signature_complete") ? prev : [...prev, "signature_complete"]))
        }
        setIsSwapping(false)
        return
      }

      if (stateBeforeAction === "needs_signature") {
        if (!currentPermitDetailsForSign) {
          const errorCode = "currentPermitDetailsForSign is null before signing"
          toast.error("Backend Error", {
            icon: createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
            description: "We encountered an internal issue. Please start over.",
            action: { label: "Copy Error", onClick: () => navigator.clipboard.writeText(errorCode) },
          })
          setIsSwapping(false)
          setSwapProgressState("error")
          return
        }

        const permitDataForSigning = currentPermitDetailsForSign
        if (permitDataForSigning.needsPermit !== true) {
          setCompletedSteps((prev) => (prev.includes("signature_complete") ? prev : [...prev, "signature_complete"]))
          setSwapProgressState("ready_to_swap")
          setIsSwapping(false)
          return
        }

        setSwapProgressState("signing_permit")
        if (!("permitData" in permitDataForSigning) || !permitDataForSigning.permitData)
          throw new Error("Permit data is missing when signature is required")

        const permitMessage = permitDataForSigning.permitData.message
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
        const signatureFromSigning = await signTypedDataAsync({
          domain: permitDataForSigning.permitData.domain,
          types: permitDataForSigning.permitData.types,
          primaryType: "PermitSingle",
          message: messageToSign,
        })
        if (!signatureFromSigning) throw new Error("Signature process did not return a valid signature.")
        setObtainedSignature(signatureFromSigning)

        toast.success("Signature Complete", {
          icon: createElement(IconBadgeCheck2, { className: "h-4 w-4 text-green-500" }),
          description: `${fromToken.symbol} permit signed`,
        })

        setCompletedSteps((prev) => [...prev, "signature_complete"])
        setSwapProgressState("ready_to_swap")
        setIsSwapping(false)
        return
      }

      if (stateBeforeAction !== "ready_to_swap") {
        setIsSwapping(false)
        return
      }

      // Native ETH swaps bypass permit logic
      if (fromToken.symbol === "ETH") {
        setSwapProgressState("building_tx")
      } else {
        const needsSig = currentPermitDetailsForSign?.needsPermit === true
        let effectiveSignature = obtainedSignature
        let signatureExpired = false
        if (needsSig && currentPermitDetailsForSign?.permitData?.message?.sigDeadline) {
          const now = Math.floor(Date.now() / 1000)
          const sigDeadlineNum = Number(currentPermitDetailsForSign.permitData.message.sigDeadline)
          if (Number.isFinite(sigDeadlineNum) && sigDeadlineNum <= now) {
            effectiveSignature = null
            signatureExpired = true
          }
        }
        if (effectiveSignature !== obtainedSignature) setObtainedSignature(null)
        if (!currentPermitDetailsForSign || (needsSig && !effectiveSignature)) {
          if (signatureExpired) {
            toast.error("Signature Expired", {
              icon: createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
              description: "Your signature expired. Please sign again to continue.",
            })
          } else {
            toast.error("Permit Error", {
              icon: createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
              description: "Unable to prepare permit. Please try again.",
            })
          }
          setIsSwapping(false)
          setSwapProgressState("error")
          return
        }
      }

      // Dynamic fee is fetched server-side for build-tx, but UI currently fetches it too.
      // Uniswap-style: only execute against a fully-formed, canonical trade.
      const tradeCheck = ensureTradeReady()
      if (!tradeCheck.ok) {
        toast.error("Swap Not Ready", {
          icon: createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
          description: "The quote/route is still loading. Please wait a moment and try again.",
        })
        setIsSwapping(false)
        return
      }

      const route = trade!.route!
      const fetchedDynamicFee = trade!.dynamicSwapFee!
      const swapType = trade!.swapType
      const amountDecimalsStr = trade!.amountDecimalsStr
      const limitAmountDecimalsStr = trade!.limitAmountDecimalsStr

      let bodyForSwapTx: any
      if (fromToken.symbol === "ETH") {
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
        }
      } else {
        const permitDetailsToUse = currentPermitDetailsForSign
        const signatureToUse = obtainedSignature
        if (!permitDetailsToUse) throw new Error("Permit details missing")

        let permitNonce: number
        let permitExpiration: number
        let permitSigDeadline: string
        let permitAmount: string

        if (permitDetailsToUse.needsPermit === true) {
          permitNonce = permitDetailsToUse.permitData.message.details.nonce
          permitExpiration = permitDetailsToUse.permitData.message.details.expiration
          permitSigDeadline = permitDetailsToUse.permitData.message.sigDeadline
          permitAmount = permitDetailsToUse.permitData.message.details.amount
        } else if ("existingPermit" in permitDetailsToUse && permitDetailsToUse.existingPermit) {
          permitNonce = permitDetailsToUse.existingPermit.nonce
          permitExpiration = permitDetailsToUse.existingPermit.expiration
          permitSigDeadline = String(permitExpiration)
          permitAmount = permitDetailsToUse.existingPermit.amount
        } else {
          throw new Error("Invalid permit data structure - fresh signature required")
        }

        bodyForSwapTx = {
          userAddress: accountAddress,
          fromTokenSymbol: fromToken.symbol,
          toTokenSymbol: toToken.symbol,
          swapType,
          amountDecimalsStr,
          limitAmountDecimalsStr,
          permitSignature: signatureToUse || "0x",
          permitTokenAddress: fromToken.address,
          permitAmount,
          permitNonce,
          permitExpiration,
          permitSigDeadline,
          chainId: currentChainId,
          dynamicSwapFee: fetchedDynamicFee,
        }
      }

      setSwapProgressState("building_tx")
      const buildTxApiResponse = await fetch("/api/swap/build-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyForSwapTx),
      })
      const buildTxApiData = await buildTxApiResponse.json()
      if (!buildTxApiResponse.ok) {
        const errorInfo = buildTxApiData.message || "Failed to build transaction"
        const cause = buildTxApiData.errorDetails || buildTxApiData.error
        throw new Error(errorInfo, { cause })
      }

      window.swapBuildData = buildTxApiData
      setSwapProgressState("executing_swap")
      toast("Confirm Swap", { icon: createElement(IconCircleInfo, { className: "h-4 w-4" }) })

      const txHash = await sendSwapTx({
        address: getAddress(buildTxApiData.to),
        abi: UniversalRouterAbi,
        functionName: "execute",
        args: [buildTxApiData.commands as Hex, buildTxApiData.inputs as Hex[], BigInt(buildTxApiData.deadline)],
        value: BigInt(buildTxApiData.value),
      })
      if (!txHash) throw new Error("Failed to send swap transaction (no hash received)")

      // Track swap transaction in Redux store for cache invalidation
      if (txHash && currentChainId) {
        const isExactInput = swapType === 'ExactIn'
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
          { hash: txHash, chainId: currentChainId, from: accountAddress, to: buildTxApiData.to } as any,
          typeInfo
        )
      }

      setSwapTxInfo({
        hash: txHash as string,
        fromAmount,
        fromSymbol: fromToken.symbol,
        toAmount,
        toSymbol: toToken.symbol,
        explorerUrl: getExplorerTxUrl(txHash as string),
        touchedPools: Array.isArray(buildTxApiData?.touchedPools) ? buildTxApiData.touchedPools : undefined,
      })

      setSwapProgressState("waiting_confirmation")
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash as Hex })
      if (!receipt || receipt.status !== "success") throw new Error("Swap transaction failed on-chain")

      setSwapProgressState("complete")
      setIsSwapping(false)

      const swapVolumeUSD = parseFloat(fromAmount) * (fromTokenUsdPrice || 0)
      await invalidateSwapCache(queryClient, accountAddress!, currentChainId!, buildTxApiData.touchedPools, swapVolumeUSD, receipt.blockNumber)

      setTimeout(async () => {
        await refetchFromTokenBalance?.()
        await refetchToTokenBalance?.()
      }, 1500)

      setSwapState("success")
    } catch (err: any) {
      console.error("[handleConfirmSwap] Error during action:", err)
      const classified = classifySwapError(err)
      if (classified.kind === "rejected") {
        setIsSwapping(false)
        setSwapProgressState(stateBeforeAction)
        toast(classified.title, {
          icon: createElement(IconCircleInfo, { className: "h-4 w-4" }),
          description: classified.description,
        })
        return
      }

      setIsSwapping(false)
      toast.error(classified.title, {
        icon: createElement(IconCircleXmarkFilled, { className: "h-4 w-4 text-red-500" }),
        description: classified.description,
        action: { label: "Copy Error", onClick: () => navigator.clipboard.writeText(err?.message || String(err)) },
      })
      setSwapError({ ...classified, timestamp: Date.now() })
      setSwapProgressState("error")
      window.swapBuildData = undefined
    }
  }, [
    accountAddress,
    currentChainId,
    currentPermitDetailsForSign,
    currentSlippage,
    trade,
    ensureTradeReady,
    fetchPermitData,
    fromAmount,
    fromToken.address,
    fromToken.decimals,
    fromToken.symbol,
    fromTokenUsdPrice,
    classifySwapError,
    isSwapping,
    lastEditedSideRef,
    obtainedSignature,
    publicClient,
    queryClient,
    refetchFromTokenBalance,
    refetchToTokenBalance,
    sendApprovalTx,
    sendSwapTx,
    signTypedDataAsync,
    swapProgressState,
    toAmount,
    toToken.address,
    toToken.decimals,
    toToken.symbol,
    addTransaction,
  ])

  const actions = useMemo(
    () => ({
      handleSwap,
      handleConfirmSwap,
      resetForChange,
      resetForSwapAgain,
      setSwapState,
      setSwapTxInfo,
      setSwapProgressState,
      setCompletedSteps,
    }),
    [handleConfirmSwap, handleSwap, resetForChange, resetForSwapAgain]
  )

  return {
    swapState,
    swapProgressState,
    isSwapping,
    completedSteps,
    swapTxInfo,
    swapError,
    actions,
  }
}


