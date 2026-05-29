import { ReactNode, StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import styled, { ThemeProvider } from 'styled-components'
import { ArrowDownIcon, ArrowLeftRight } from 'lucide-react'
import { IconGear } from 'nucleo-micro-bold-essential'
import { SwapRoutePreview } from '@/components/swap/SwapRoutePreview'
import { defaultTheme, Theme } from '../../theme'
import SettingIcon from '../../assets/setting.svg'
import WalletIcon from '../../assets/wallet.svg'
import DropdownIcon from '../../assets/dropdown.svg'
import SwitchIcon from '../../assets/switch.svg'
import SwapIcon from '../../assets/swap.svg'
import BackIcon from '../../assets/back1.svg'
import KyberSwapLogo from '../../assets/kyberswap.svg'
import AlertIcon from '../../assets/alert.svg'
import Expand from '../../assets/expand.svg'
import unknownTokenImg from '../../assets/unknown-token.svg?url'

// Alphix host-app helpers — used for the CTA button (matches the reference UI).
import { cn } from '@/lib/utils'
import { Button as AlphixButton } from '@/components/ui/button'
import { getAppKit } from '@/components/AppKitProvider'

import useTheme from '../../hooks/useTheme'

import {
  AccountBalance,
  BalanceRow,
  Input,
  InputRow,
  InputWrapper,
  MaxHalfBtn,
  MiddleRow,
  SelectTokenBtn,
  SettingBtn,
  SwitchBtn,
  Title,
  Wrapper,
  Button,
  Dots,
  Rate,
  MiddleLeft,
  Detail,
  DetailTitle,
  Divider,
  DetailRow,
  DetailLabel,
  DetailRight,
  ModalHeader,
  ModalTitle,
  ViewRouteTitle,
  // New Alphix-style panel primitives
  GradientHoverWrap,
  InputPanel,
  PanelTopRow,
  PanelLabel,
  BalanceButton,
  PanelBottomRow,
  TokenZone,
  InputZone,
  UsdSlot,
  UsdText,
  DotGridOverlay,
  PercentageCluster,
  PctBtn,
  // Arrow cutout (Uniswap-style swap-direction button) + token-icon chain badge
  ArrowCutoutContainer,
  ArrowCutoutRing,
  ArrowLoadingWrapper,
  ArrowLoadingInner,
  TokenIconWrap,
  ChainBadge,
  // Outer stacker — hosts the swap Wrapper + SwapRoutePreview as siblings.
  Outer,
  // Round-hover icon button for the rate-row gear + direction-toggle.
  IconCircleBtn,
} from './styled'

import { AGGREGATOR_PATH, NATIVE_TOKEN, NATIVE_TOKEN_ADDRESS, SUPPORTED_NETWORKS, TokenInfo, ZIndex } from '../../constants'
import { getAllTokens as getPoolTokens } from '@/lib/pools-config'
import { AlphixReviewModal } from '../AlphixReviewModal'
import type { StepExecutorFn, StepExecutionContext, StepResult } from '@/lib/transactions'

function resolveTokenInfo(addr: string, chainId: number, tokens: TokenInfo[]): TokenInfo | undefined {
  if (!addr) return undefined
  const lower = addr.toLowerCase()
  if (lower === NATIVE_TOKEN_ADDRESS.toLowerCase()) return NATIVE_TOKEN[chainId]
  const fromKyber = tokens.find(t => t.address.toLowerCase() === lower)
  if (fromKyber) return fromKyber
  const mode = chainId === 42161 ? 'arbitrum' : 'base'
  const poolTokens = getPoolTokens(mode)
  for (const tc of Object.values(poolTokens)) {
    if (tc.address.toLowerCase() === lower) {
      return {
        name: tc.name,
        symbol: tc.symbol,
        address: tc.address,
        decimals: tc.decimals,
        chainId,
        logoURI: tc.icon,
      }
    }
  }
  return undefined
}
import SelectCurrency from '../SelectCurrency'
import { Web3Provider, useActiveWeb3, useRpcTarget } from '../../hooks/useWeb3Provider'
import useSwap from '../../hooks/useSwap'
import useTokenBalances from '../../hooks/useTokenBalances'
import useApproval, { APPROVAL_STATE } from '../../hooks/useApproval'
import Settings from '../Settings'
import { TokenListProvider, useTokens } from '../../hooks/useTokens'
import RefreshBtn from '../RefreshBtn'
import DexesSetting from '../DexesSetting'
import ImportModal from '../ImportModal'
import InfoHelper from '../InfoHelper'
import TradeRouting from '../TradeRouting'
import Slippage from '../Slippage'
import { calculateGasMargin, estimateGas, formatUnits } from '../../utils/crypto'
import Select from '../Select'

export const DialogWrapper = styled.div`
  position: absolute;
  inset: 0;
  z-index: ${ZIndex.DIALOG};
  display: none;
  align-items: stretch;
  justify-content: stretch;
  &.open { display: flex; }
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
    z-index: -1;
  }
`

export const ModalContent = styled.div`
  background: ${({ theme }) => theme.primary};
  border-radius: ${({ theme }) => theme.borderRadius};
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 1rem;
  gap: 1rem;
`
const Row = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
`

const ContentWrapper = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow-y: scroll;

  ::-webkit-scrollbar {
    display: none;
  }
`

const SelectTokenText = styled.span`
  font-size: 16px;
  width: max-content;
`

const REFRESH_PERIOD_S = 15
const REFRESH_TICK_MS = 100
const REFRESH_R = 6
const REFRESH_CIRCUMFERENCE = 2 * Math.PI * REFRESH_R

interface RefreshSpinnerProps {
  loading: boolean
  onRefresh: () => void
  color: string
}

function RefreshSpinner({ loading, onRefresh, color }: RefreshSpinnerProps) {
  const [remainingMs, setRemainingMs] = useState(REFRESH_PERIOD_S * 1000)
  const [waitingForRefresh, setWaitingForRefresh] = useState(false)
  // Skip the CSS transition for one frame so the ring snaps to full instantly.
  const [snapReset, setSnapReset] = useState(false)
  const onRefreshRef = useRef(onRefresh)
  useEffect(() => { onRefreshRef.current = onRefresh }, [onRefresh])
  const prevLoadingRef = useRef(loading)

  useEffect(() => {
    if (loading || waitingForRefresh) return
    const iv = setInterval(() => {
      setRemainingMs(prev => {
        const next = prev - REFRESH_TICK_MS
        if (next <= 0) {
          onRefreshRef.current()
          setWaitingForRefresh(true)
          return 0
        }
        return next
      })
    }, REFRESH_TICK_MS)
    return () => clearInterval(iv)
  }, [loading, waitingForRefresh])

  // Snap back to full on the true→false edge of `loading` (new quote arrived).
  useEffect(() => {
    const wasLoading = prevLoadingRef.current
    prevLoadingRef.current = loading
    if (waitingForRefresh && wasLoading && !loading) {
      setSnapReset(true)
      setRemainingMs(REFRESH_PERIOD_S * 1000)
      setWaitingForRefresh(false)
    }
  }, [loading, waitingForRefresh])

  useEffect(() => {
    if (!snapReset) return
    const raf = requestAnimationFrame(() => setSnapReset(false))
    return () => cancelAnimationFrame(raf)
  }, [snapReset])

  const progress = Math.max(0, Math.min(1, remainingMs / (REFRESH_PERIOD_S * 1000)))
  const dashOffset = REFRESH_CIRCUMFERENCE * (1 - progress)

  return (
    <button
      type="button"
      onClick={() => {
        onRefresh()
        setSnapReset(true)
        setRemainingMs(REFRESH_PERIOD_S * 1000)
        setWaitingForRefresh(false)
      }}
      disabled={loading}
      style={{
        width: 16,
        height: 16,
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        color,
        opacity: loading ? 0.6 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="8" cy="8" r={REFRESH_R} fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="2" />
        <circle
          cx="8"
          cy="8"
          r={REFRESH_R}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={REFRESH_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          style={{ transition: snapReset ? 'none' : `stroke-dashoffset ${REFRESH_TICK_MS}ms linear` }}
        />
      </svg>
    </button>
  )
}

const PoweredBy = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: ${({ theme }) => theme.subText};
  font-size: 12px;
  margin-top: 1rem;
`

const Footer = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;

  a {
    color: ${({ theme }) => theme.subText};
    font-size: 12px;
    margin-top: 1rem;
    text-decoration: none;

    :hover {
      color: ${({ theme }) => theme.text};
    }
  }
`

enum ModalType {
  SETTING = 'setting',
  CURRENCY_IN = 'currency_in',
  CURRENCY_OUT = 'currency_out',
  REVIEW = 'review',
  DEXES_SETTING = 'dexes_setting',
  IMPORT_TOKEN = 'import_token',
  TRADE_ROUTE = 'trade_route',
}

export interface TxData {
  from: string
  to: string
  value: string
  data: string
  gasLimit: string
}

interface FeeSetting {
  chargeFeeBy: 'currency_in' | 'currency_out'
  feeReceiver: string
  // BPS: 10_000
  // 10 means 0.1%
  feeAmount: number
  isInBps: boolean
}

export interface WidgetProps {
  client: string
  enableRoute?: boolean
  tokenList?: TokenInfo[]
  theme?: Theme
  defaultTokenIn?: string
  defaultTokenOut?: string
  defaultSlippage?: number
  defaultDeadline?: number
  defaultAmountIn?: string
  feeSetting?: FeeSetting
  onSubmitTx: (data: TxData) => Promise<string>
  enableDexes?: string
  title?: string | ReactNode
  onSourceTokenChange?: (token: TokenInfo) => void
  onAmountInChange?: (amount: string) => void
  onDestinationTokenChange?: (token: TokenInfo) => void
  onError?: (e: any) => void
  showRate?: boolean
  showDetail?: boolean
  width?: number

  rpcUrl?: string
  chainId: number
  connectedAccount: {
    address?: string
    chainId: number
  }
  onSwitchChain?: () => void
  onSetChain?: (chainId: number) => void
}

const Widget = ({
  defaultTokenIn,
  defaultTokenOut,
  defaultSlippage,
  defaultDeadline,
  defaultAmountIn,
  feeSetting,
  client,
  enableRoute,
  enableDexes,
  title,
  onSourceTokenChange,
  onAmountInChange,
  onDestinationTokenChange,
  onError,
  showRate,
  showDetail,
  width,
  onSwitchChain,
  onSetChain,
}: {
  defaultTokenIn?: string
  defaultTokenOut?: string
  defaultAmountIn?: string
  feeSetting?: FeeSetting
  client: string
  enableRoute: boolean
  enableDexes?: string
  title?: string | ReactNode
  defaultSlippage?: number
  defaultDeadline?: number
  onSourceTokenChange?: (token: any) => void
  onAmountInChange?: (value: string) => void
  onDestinationTokenChange?: (token: any) => void
  onError?: (e: any) => void
  showRate?: boolean
  showDetail?: boolean
  width?: number
  onSwitchChain?: () => void
  onSetChain?: (chainId: number) => void
}) => {
  const { chainId, connectedAccount } = useActiveWeb3()
  const wrongNetwork = chainId !== connectedAccount.chainId

  const chainBadge =
    chainId === 8453
      ? { src: '/chains/base.svg', alt: 'Base' }
      : chainId === 42161
      ? { src: '/chains/arbitrum.svg', alt: 'Arbitrum' }
      : null

  const [showModal, setShowModal] = useState<ModalType | null>(null)
  const [approvalType, setApprovalType] = useState<'infinite' | 'exact'>('infinite')
  const isUnsupported = !SUPPORTED_NETWORKS.includes(chainId.toString())

  const tokens = useTokens()
  const {
    loading,
    error,
    tokenIn,
    tokenOut,
    setTokenIn,
    setTokenOut,
    inputAmout,
    setInputAmount,
    trade: routeTrade,
    slippage,
    setSlippage,
    getRate,
    deadline,
    setDeadline,
    allDexes,
    excludedDexes,
    setExcludedDexes,
    setTrade,
    isWrap,
    isUnwrap,
  } = useSwap({
    defaultTokenIn,
    defaultTokenOut,
    defaultAmountIn,
    defaultSlippage,
    defaultDeadline,
    feeSetting,
    enableDexes,
    client,
  })

  const trade = isUnsupported ? null : routeTrade

  const [inverseRate, setInverseRate] = useState(false)

  const selectedTokenAddresses = Array.from(new Set([
    tokenIn,
    tokenOut,
    ...tokens.map(item => item.address),
  ]))
  const { balances, refetch } = useTokenBalances(selectedTokenAddresses)

  const tokenInInfo = resolveTokenInfo(tokenIn, chainId, tokens)
  const tokenOutInfo = resolveTokenInfo(tokenOut, chainId, tokens)

  const amountOut =
    isWrap || isUnwrap
      ? inputAmout
      : trade?.routeSummary?.amountOut && tokenOutInfo
      ? formatUnits(trade.routeSummary.amountOut, tokenOutInfo.decimals).toString()
      : ''

  let minAmountOut = ''

  if (amountOut) {
    minAmountOut =
      isWrap || isUnwrap
        ? parseFloat((+amountOut).toPrecision(8)).toString()
        : (Number(amountOut) * (1 - slippage / 10_000)).toPrecision(8).toString()
  }

  const tokenInBalance = balances[tokenIn] || 0n
  const tokenOutBalance = balances[tokenOut] || 0n

  const tokenInWithUnit = formatUnits(tokenInBalance.toString(), tokenInInfo?.decimals || 18)
  const tokenOutWithUnit = formatUnits(tokenOutBalance.toString(), tokenOutInfo?.decimals || 18)

  const rate =
    isWrap || isUnwrap
      ? 1
      : trade?.routeSummary?.amountIn &&
        trade?.routeSummary?.amountOut &&
        tokenInInfo &&
        tokenOutInfo &&
        parseFloat(formatUnits(trade.routeSummary.amountOut, tokenOutInfo.decimals)) / parseFloat(inputAmout)

  const formattedTokenInBalance = parseFloat(parseFloat(tokenInWithUnit).toPrecision(10))

  const formattedTokenOutBalance = parseFloat(parseFloat(tokenOutWithUnit).toPrecision(10))

  const theme = useTheme()

  const priceImpact = !trade?.routeSummary.amountOutUsd
    ? -1
    : ((+trade.routeSummary.amountInUsd - +trade.routeSummary.amountOutUsd) * 100) / +trade.routeSummary.amountInUsd

  const modalTitle = (() => {
    switch (showModal) {
      case ModalType.SETTING:
        return 'Settings'
      case ModalType.CURRENCY_IN:
        return 'Select Token'
      case ModalType.CURRENCY_OUT:
        return 'Select Token'
      case ModalType.DEXES_SETTING:
        return 'Liquidity Sources'
      case ModalType.IMPORT_TOKEN:
        return 'Import Token'
      case ModalType.TRADE_ROUTE:
        return 'Your Trade Route'

      default:
        return null
    }
  })()

  const [tokenToImport, setTokenToImport] = useState<TokenInfo | null>(null)
  const [importType, setImportType] = useState<'in' | 'out'>('in')

  const modalContent = (() => {
    switch (showModal) {
      case ModalType.SETTING:
        return (
          <Settings
            slippage={slippage}
            setSlippage={setSlippage}
            deadline={deadline}
            setDeadline={setDeadline}
            allDexes={allDexes}
            excludedDexes={excludedDexes}
            onShowSource={() => setShowModal(ModalType.DEXES_SETTING)}
            approvalType={approvalType}
            setApprovalType={setApprovalType}
            onClose={() => setShowModal(null)}
          />
        )
      case ModalType.TRADE_ROUTE:
        if (enableRoute) return <TradeRouting trade={trade} currencyIn={tokenInInfo} currencyOut={tokenOutInfo} />
        return null
      case ModalType.CURRENCY_IN:
        return (
          <SelectCurrency
            selectedToken={tokenIn}
            onChange={token => {
              if (token.address === tokenOut) setTokenOut(tokenIn)
              setTokenIn(token.address)
              setShowModal(null)
              onSourceTokenChange?.(token)
            }}
            onImport={(token: TokenInfo) => {
              setTokenToImport(token)
              setShowModal(ModalType.IMPORT_TOKEN)
              setImportType('in')
            }}
            onClose={() => setShowModal(null)}
            onChainSwitch={onSetChain}
          />
        )
      case ModalType.CURRENCY_OUT:
        return (
          <SelectCurrency
            selectedToken={tokenOut}
            onChange={token => {
              if (token.address === tokenIn) setTokenIn(tokenOut)
              setTokenOut(token.address)
              setShowModal(null)
              onDestinationTokenChange?.(token)
            }}
            onImport={(token: TokenInfo) => {
              setTokenToImport(token)
              setShowModal(ModalType.IMPORT_TOKEN)
              setImportType('out')
            }}
            onClose={() => setShowModal(null)}
            onChainSwitch={onSetChain}
          />
        )
      case ModalType.DEXES_SETTING:
        return <DexesSetting allDexes={allDexes} excludedDexes={excludedDexes} setExcludedDexes={setExcludedDexes} />

      case ModalType.IMPORT_TOKEN:
        if (tokenToImport)
          return (
            <ImportModal
              token={tokenToImport}
              onImport={() => {
                if (importType === 'in') {
                  setTokenIn(tokenToImport.address)
                  setShowModal(null)
                } else {
                  setTokenOut(tokenToImport.address)
                  setShowModal(null)
                }
              }}
            />
          )
        return null
      default:
        return null
    }
  })()

  const {
    loading: checkingAllowance,
    approve,
    approvalState,
    pendingTx: approvalPendingTx,
  } = useApproval(trade?.routeSummary?.amountIn || '0', tokenIn, trade?.routerAddress || '')

  // ─── Audited approve executor (Promise-bridge) ────────────────────────────
  // Wraps Kyber's void-returning `approve(amount)` in a Promise that polls
  // `approvalState` until APPROVED, mirroring Kyber's own state machine. This
  // lets `SwapExecuteModal`'s stepper drive the approval through Kyber's
  // audited calldata / gas / submit pipeline (use-approval.ts:70–117) instead
  // of constructing a fresh wagmi `sendTransaction` call.
  //
  // Amount semantics:
  //   - 'exact'   → BigInt(trade.routeSummary.amountIn) (raw wei from Kyber)
  //   - 'infinite'→ undefined, which Kyber pads to 0xffff…ffff (MaxUint256)
  // (see use-approval.ts:77 — the audited default when amount is omitted).
  const approveWithWait = useCallback<StepExecutorFn>(
    async (_step, context: StepExecutionContext): Promise<StepResult> => {
      const amountToApprove =
        approvalType === 'exact'
          ? BigInt(trade?.routeSummary?.amountIn || '0')
          : undefined

      // Trigger Kyber's audited approve (no await — it's void; the hook's
      // internal effects flip `approvalState` PENDING → APPROVED/NOT_APPROVED).
      approve(amountToApprove)

      return new Promise<StepResult>((resolve, reject) => {
        let attempts = 0
        const MAX_ATTEMPTS = 150 * 8 // ~20 min budget at 1s poll
        const interval = setInterval(() => {
          if (context.isCancelled?.()) {
            clearInterval(interval)
            reject(new Error('Approval cancelled'))
            return
          }

          if (approvalState === APPROVAL_STATE.APPROVED) {
            clearInterval(interval)
            resolve({ txHash: approvalPendingTx || '' })
            return
          }

          // After a brief grace period (≥5 polls) treat a return-to-
          // NOT_APPROVED as a user rejection or failed tx.
          if (approvalState === APPROVAL_STATE.NOT_APPROVED && attempts > 5) {
            clearInterval(interval)
            reject(new Error('Approval rejected or failed'))
            return
          }

          attempts++
          if (attempts >= MAX_ATTEMPTS) {
            clearInterval(interval)
            reject(new Error('Approval timed out'))
          }
        }, 1000)
      })
    },
    [approve, approvalState, approvalType, trade?.routeSummary?.amountIn, approvalPendingTx],
  )
  // Suppress unused warning if the upstream flag isn't read in JSX.
  void checkingAllowance

  // Submission closure for the new review modal — mirrors the build + estimate +
  // onSubmitTx flow from Confirmation/index.tsx so the backend chain is unchanged.
  const { onSubmitTx } = useActiveWeb3()
  const rpcTarget = useRpcTarget()
  const [submitting, setSubmitting] = useState(false)
  const buildAndSubmit = useCallback(
    async (args: {
      trade: typeof trade extends infer T ? NonNullable<T> : never
      slippage: number
      deadlineMinutes: number
      tokenInAddress: string
      client: string
    }): Promise<string> => {
      const t = args.trade as NonNullable<typeof trade>
      if (!t) throw new Error('No trade')
      setSubmitting(true)
      try {
        const date = new Date()
        date.setMinutes(date.getMinutes() + (args.deadlineMinutes || 20))

        const buildRes = await fetch(
          `https://aggregator-api.kyberswap.com/${AGGREGATOR_PATH[chainId]}/api/v1/route/build`,
          {
            method: 'POST',
            headers: { 'x-client-id': args.client },
            body: JSON.stringify({
              routeSummary: t.routeSummary,
              deadline: Math.floor(date.getTime() / 1000),
              slippageTolerance: args.slippage,
              sender: connectedAccount.address,
              recipient: connectedAccount.address,
              source: args.client,
            }),
          },
        ).then(r => r.json())

        if (!buildRes.data) {
          throw new Error('Build route failed: ' + JSON.stringify(buildRes.details))
        }

        const estimateGasOption = {
          from: connectedAccount.address || '',
          to: t.routerAddress,
          value:
            '0x' +
            BigInt(args.tokenInAddress === NATIVE_TOKEN_ADDRESS ? t.routeSummary.amountIn : 0).toString(16),
          data: buildRes.data.data as string,
        }

        const gasEstimated = await estimateGas(rpcTarget, estimateGasOption)

        const hash = await onSubmitTx({
          ...estimateGasOption,
          gasLimit: calculateGasMargin(gasEstimated || 0n),
        })

        return hash || ''
      } finally {
        setSubmitting(false)
      }
    },
    [chainId, connectedAccount.address, rpcTarget, onSubmitTx],
  )

  return (
    <>
    <Outer width={width}>
    <Wrapper
      width={width}
      $selectorOpen={showModal === ModalType.CURRENCY_IN || showModal === ModalType.CURRENCY_OUT}
    >
      <DialogWrapper className={showModal ? 'open' : 'close'}>
        <ModalContent>
          {showModal !== ModalType.REVIEW &&
            showModal !== ModalType.CURRENCY_IN &&
            showModal !== ModalType.CURRENCY_OUT &&
            showModal !== ModalType.SETTING && (
              <ModalHeader>
                <ModalTitle
                  onClick={() =>
                    showModal === ModalType.DEXES_SETTING ? setShowModal(ModalType.SETTING) : setShowModal(null)
                  }
                  role="button"
                >
                  <BackIcon style={{ color: theme.subText }} />
                  {modalTitle}
                </ModalTitle>
              </ModalHeader>
            )}
          <ContentWrapper>{modalContent}</ContentWrapper>
        </ModalContent>
      </DialogWrapper>

      <GradientHoverWrap>
      <InputPanel
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const isLeft = e.clientX - rect.left < rect.width * 0.5
          e.currentTarget.classList.toggle('ks-hover-left', isLeft)
          // Only toggle the right-half class when pct buttons would actually
          // appear — otherwise the USD line fades for no reason on unconnected.
          const showPct = !!connectedAccount.address && +tokenInWithUnit > 0
          e.currentTarget.classList.toggle('ks-hover-right', !isLeft && showPct)
        }}
        onMouseLeave={e => {
          e.currentTarget.classList.remove('ks-hover-left', 'ks-hover-right')
        }}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const isLeft = e.clientX - rect.left < rect.width * 0.5
          if (isLeft && !isUnsupported) setShowModal(ModalType.CURRENCY_IN)
        }}
      >
        <DotGridOverlay />

        <PanelTopRow>
          <PanelLabel>Sell</PanelLabel>
          <BalanceButton
            onClick={e => {
              e.stopPropagation()
              if (tokenInWithUnit) setInputAmount(tokenInWithUnit)
            }}
            disabled={!connectedAccount.address}
          >
            {formattedTokenInBalance} {tokenInInfo?.symbol ?? ''}
          </BalanceButton>
        </PanelTopRow>

        <PanelBottomRow>
          <TokenZone>
            {tokenInInfo ? (
              <>
                <TokenIconWrap>
                  <img
                    width="28"
                    height="28"
                    alt="tokenIn"
                    src={tokenInInfo?.logoURI}
                    onError={({ currentTarget }) => {
                      currentTarget.onerror = null
                      currentTarget.src = unknownTokenImg
                    }}
                  />
                  {chainBadge && <ChainBadge src={chainBadge.src} alt={chainBadge.alt} />}
                </TokenIconWrap>
                <span>{tokenInInfo?.symbol}</span>
              </>
            ) : (
              <SelectTokenText>Select Token</SelectTokenText>
            )}
          </TokenZone>

          <InputZone onClick={e => e.stopPropagation()}>
            <Input
              value={inputAmout}
              onChange={e => {
                const value = e.target.value.replace(/,/g, '.')
                const inputRegex = RegExp(`^\\d*(?:\\\\[.])?\\d*$`)
                if (value === '' || inputRegex.test(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))) {
                  setInputAmount(value)
                }
                onAmountInChange?.(value)
              }}
              inputMode="decimal"
              autoComplete="off"
              autoCorrect="off"
              type="text"
              pattern="^[0-9]*[.,]?[0-9]*$"
              placeholder="0"
              minLength={1}
              maxLength={79}
              spellCheck="false"
            />
            <UsdSlot>
              <UsdText>
                {trade?.routeSummary?.amountInUsd
                  ? `~${(+trade.routeSummary.amountInUsd).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`
                  : '$0.00'}
              </UsdText>
              {!!connectedAccount.address && +tokenInWithUnit > 0 && (
                <PercentageCluster onClick={e => e.stopPropagation()}>
                  {[25, 50, 75, 100].map((pct, i) => (
                    <PctBtn
                      key={pct}
                      style={{ transitionDelay: `${i * 40}ms` }}
                      onClick={() => {
                        if (!tokenInWithUnit) return
                        if (pct === 100) setInputAmount(tokenInWithUnit)
                        else setInputAmount(((+tokenInWithUnit * pct) / 100).toString())
                      }}
                    >
                      {pct === 100 ? 'MAX' : `${pct}%`}
                    </PctBtn>
                  ))}
                </PercentageCluster>
              )}
            </UsdSlot>
          </InputZone>
        </PanelBottomRow>
      </InputPanel>
      </GradientHoverWrap>

      <ArrowCutoutContainer>
        <ArrowCutoutRing>
          <ArrowLoadingWrapper
            className={loading ? 'loading' : ''}
            onClick={
              loading
                ? undefined
                : () => {
                    setTrade(null)
                    setTokenIn(tokenOut)
                    setTokenOut(tokenIn)
                  }
            }
          >
            <ArrowLoadingInner>
              <ArrowDownIcon style={{ width: 16, height: 16 }} />
            </ArrowLoadingInner>
          </ArrowLoadingWrapper>
        </ArrowCutoutRing>
      </ArrowCutoutContainer>

      <GradientHoverWrap>
      <InputPanel
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const isLeft = e.clientX - rect.left < rect.width * 0.5
          e.currentTarget.classList.toggle('ks-hover-left', isLeft)
        }}
        onMouseLeave={e => {
          e.currentTarget.classList.remove('ks-hover-left')
        }}
        onClick={e => {
          const rect = e.currentTarget.getBoundingClientRect()
          const isLeft = e.clientX - rect.left < rect.width * 0.5
          if (isLeft && !isUnsupported) setShowModal(ModalType.CURRENCY_OUT)
        }}
      >
        <DotGridOverlay />

        <PanelTopRow>
          <PanelLabel>Buy</PanelLabel>
          <BalanceButton disabled>
            {formattedTokenOutBalance} {tokenOutInfo?.symbol ?? ''}
          </BalanceButton>
        </PanelTopRow>

        <PanelBottomRow>
          <TokenZone>
            {tokenOutInfo ? (
              <>
                <TokenIconWrap>
                  <img
                    width="28"
                    height="28"
                    alt="tokenOut"
                    src={tokenOutInfo?.logoURI}
                    onError={({ currentTarget }) => {
                      currentTarget.onerror = null
                      currentTarget.src = unknownTokenImg
                    }}
                  />
                  {chainBadge && <ChainBadge src={chainBadge.src} alt={chainBadge.alt} />}
                </TokenIconWrap>
                <span>{tokenOutInfo?.symbol}</span>
              </>
            ) : (
              <SelectTokenText>Select Token</SelectTokenText>
            )}
          </TokenZone>

          <InputZone onClick={e => e.stopPropagation()}>
            <Input disabled value={amountOut ? (isWrap || isUnwrap ? +amountOut : (+amountOut).toPrecision(8)) : ''} placeholder="0" />
            <UsdSlot>
              <UsdText>
                {trade?.routeSummary?.amountOutUsd
                  ? `~${(+trade.routeSummary.amountOutUsd).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`
                  : '$0.00'}
              </UsdText>
            </UsdSlot>
          </InputZone>
        </PanelBottomRow>
      </InputPanel>
      </GradientHoverWrap>

      {showRate && (
        <MiddleLeft style={{ marginTop: '0.75rem', gap: '0.375rem', fontSize: '12px' }}>
          <RefreshSpinner loading={loading} onRefresh={() => getRate()} color={theme.accent} />
          <Rate style={{ fontSize: '12px' }}>
            {(() => {
              if (!rate || !tokenInInfo || !tokenOutInfo) return '-'
              return !inverseRate
                ? `1 ${tokenInInfo.symbol} = ${+rate.toPrecision(10)} ${tokenOutInfo.symbol}`
                : `1 ${tokenOutInfo.symbol} = ${+(1 / rate).toPrecision(10)} ${tokenInInfo.symbol}`
            })()}
          </Rate>
          {!!rate && (
            <IconCircleBtn type="button" onClick={() => setInverseRate(prev => !prev)}>
              <ArrowLeftRight size={14} />
            </IconCircleBtn>
          )}
          <IconCircleBtn
            type="button"
            onClick={() => setShowModal(ModalType.SETTING)}
            style={{ marginLeft: 'auto' }}
          >
            <IconGear width={14} height={14} />
          </IconCircleBtn>
        </MiddleLeft>
      )}

      {showRate && (
        <div className="py-0.5" style={{ marginTop: '0.5rem' }}>
          <div className="border-t border-dashed border-muted-foreground/20" />
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem' }}>
        <Slippage slippage={slippage} setSlippage={setSlippage} />
      </div>

      <div
        className="flex items-center justify-between"
        style={{ fontSize: '12px', color: theme.subText, marginTop: '0.375rem' }}
      >
        <span>Minimum Received</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {minAmountOut && tokenOutInfo ? `${minAmountOut} ${tokenOutInfo.symbol}` : '-'}
        </span>
      </div>

      {(() => {
        const isConnected = !!connectedAccount.address

        const fromAmountNum = parseFloat(inputAmout || '0')
        const fromBalanceNum = parseFloat(tokenInWithUnit || '0')
        const insufficient =
          fromAmountNum > 0 && (isNaN(fromBalanceNum) || fromBalanceNum < fromAmountNum * 0.999999)

        const busy = loading || isUnsupported || !!error
        const isDisabled = busy || insufficient || fromAmountNum <= 0

        const text: ReactNode = isUnsupported
          ? 'Unsupported network'
          : fromAmountNum <= 0
          ? 'Swap'
          : loading
          ? <Dots>Calculate best route</Dots>
          : error
          ? String(error)
          : wrongNetwork
          ? (onSwitchChain ? 'Switch Network' : 'Wrong Network')
          : isWrap
          ? 'Wrap'
          : isUnwrap
          ? 'Unwrap'
          : insufficient
          ? 'Insufficient Balance'
          : 'Swap'

        const handleClick = async () => {
          if (wrongNetwork && onSwitchChain) {
            onSwitchChain()
            return
          }
          setShowModal(ModalType.REVIEW)
        }

        return (
          <div className="mt-4 h-10">
            {isConnected ? (
              <AlphixButton
                className={cn(
                  'w-full',
                  isDisabled
                    ? 'relative border border-primary bg-button px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 !opacity-100 text-white/75'
                    : 'text-sidebar-primary border border-sidebar-primary bg-button-primary hover-button-primary',
                  isDisabled ? (loading ? 'cursor-wait' : 'cursor-default') : null,
                )}
                onClick={handleClick}
                disabled={isDisabled}
                aria-busy={loading}
                style={
                  isDisabled
                    ? {
                        backgroundImage: 'url(/patterns/button-wide.svg)',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }
                    : undefined
                }
              >
                {text}
              </AlphixButton>
            ) : (
              <button
                type="button"
                onClick={() => getAppKit()?.open()}
                className="flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 hover:bg-accent hover:brightness-110 hover:border-white/30 text-white"
                style={{
                  backgroundImage: 'url(/patterns/button-wide.svg)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                Connect Wallet
              </button>
            )}
          </div>
        )
      })()}
    </Wrapper>

      {tokenInInfo && tokenOutInfo && (
        <SwapRoutePreview
          source="kyberswap"
          fromToken={{
            address: tokenIn as `0x${string}`,
            symbol: tokenInInfo.symbol,
            name: tokenInInfo.name,
            decimals: tokenInInfo.decimals,
            icon: tokenInInfo.logoURI,
          } as any}
          toToken={{
            address: tokenOut as `0x${string}`,
            symbol: tokenOutInfo.symbol,
            name: tokenOutInfo.name,
            decimals: tokenOutInfo.decimals,
            icon: tokenOutInfo.logoURI,
          } as any}
          kyberswapRouteSummary={trade?.routeSummary as any}
          tokenMetadata={undefined}
          isLoading={loading}
          compact={false}
          networkMode={chainId === 8453 ? 'base' : chainId === 42161 ? 'arbitrum' : undefined}
        />
      )}
    </Outer>

    {tokenInInfo && tokenOutInfo && (
      <AlphixReviewModal
        isOpen={showModal === ModalType.REVIEW}
        onClose={() => {
          setShowModal(null)
          refetch()
        }}
        tokenInInfo={tokenInInfo}
        tokenOutInfo={tokenOutInfo}
        amountIn={inputAmout}
        amountOut={amountOut}
        trade={trade}
        routeSummary={trade?.routeSummary}
        routerAddress={trade?.routerAddress}
        slippageBps={slippage}
        fromTokenUsdPrice={
          trade?.routeSummary?.amountInUsd && parseFloat(inputAmout || '0') > 0
            ? +trade.routeSummary.amountInUsd / parseFloat(inputAmout)
            : 0
        }
        toTokenUsdPrice={
          trade?.routeSummary?.amountOutUsd && parseFloat(amountOut || '0') > 0
            ? +trade.routeSummary.amountOutUsd / parseFloat(amountOut)
            : 0
        }
        needsApproval={approvalState === APPROVAL_STATE.NOT_APPROVED}
        approve={() => approve()}
        approvalState={approvalState}
        isWrap={isWrap}
        isUnwrap={isUnwrap}
        buildAndSubmit={buildAndSubmit}
        building={loading}
        submitting={submitting}
        targetChainId={chainId}
        refetchFromTokenBalance={async () => refetch()}
        refetchToTokenBalance={async () => refetch()}
        customApproveExecutor={approveWithWait}
      />
    )}
    </>
  )
}

export default function SwapWidget({
  rpcUrl,
  tokenList,
  theme,
  defaultTokenIn,
  defaultTokenOut,
  defaultAmountIn,
  defaultSlippage,
  defaultDeadline,
  feeSetting,
  client,
  onSubmitTx,
  enableRoute = true,
  enableDexes,
  title,
  onSourceTokenChange,
  onAmountInChange,
  onDestinationTokenChange,
  onError,
  showRate = true,
  showDetail = true,
  width,
  chainId,
  connectedAccount,
  onSwitchChain,
  onSetChain,
}: WidgetProps) {
  return (
    <StrictMode>
      <ThemeProvider theme={theme || defaultTheme}>
        <Web3Provider chainId={chainId} connectedAccount={connectedAccount} rpcUrl={rpcUrl} onSubmitTx={onSubmitTx}>
          <TokenListProvider tokenList={tokenList}>
            <Widget
              defaultTokenIn={defaultTokenIn}
              defaultAmountIn={defaultAmountIn}
              defaultTokenOut={defaultTokenOut}
              defaultSlippage={defaultSlippage}
              defaultDeadline={defaultDeadline}
              feeSetting={feeSetting}
              client={client}
              onSourceTokenChange={onSourceTokenChange}
              onAmountInChange={onAmountInChange}
              onDestinationTokenChange={onDestinationTokenChange}
              onError={onError}
              enableRoute={enableRoute}
              enableDexes={enableDexes}
              title={title}
              showRate={showRate}
              showDetail={showDetail}
              width={width}
              onSwitchChain={onSwitchChain}
              onSetChain={onSetChain}
            />
          </TokenListProvider>
        </Web3Provider>
      </ThemeProvider>
    </StrictMode>
  )
}
