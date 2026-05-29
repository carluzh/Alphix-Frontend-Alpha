'use client';

/**
 * AlphixReviewModal
 * -----------------
 * Thin adapter that bridges the vendored Kyber widget's internal shapes
 * (TokenInfo, BPS slippage, KyberTrade) to Alphix's host-app `SwapExecuteModal`
 * (which speaks `Token`, percent slippage, and a `buildAndSubmit` closure).
 *
 * Per the design plan (decision: "reuse-alphix-modal"):
 *   - We do NOT re-implement the modal shell, stepper, portal, backdrop, etc.
 *     `SwapExecuteModal` already renders inside `TransactionModal` (Radix
 *     Dialog -> DialogPortal to document.body, fixed z-50 backdrop blur),
 *     already lays out the From/To, Route (via SwapRoutePreview), Price,
 *     Slippage, Min Received, and Network Fee sections, and already drives
 *     a [kyber-approve?, kyber-swap] step sequence through ProgressIndicator.
 *   - This adapter only:
 *       1. Maps `TokenInfo` (Kyber widget) -> `Token` (Alphix modal).
 *       2. Maps slippage BPS (e.g. 50) -> percent (e.g. 0.5).
 *       3. Forwards the parent-owned `approve`, `approvalState`, and
 *          `buildAndSubmit` closures verbatim.
 *
 * Widget/index.tsx (owned by the wire-up agent) is responsible for:
 *   - constructing `buildAndSubmit` from POST /route/build + estimateGas +
 *     onSubmitTx (verbatim port of the body inside Confirmation/index.tsx)
 *   - removing the existing `<Confirmation />` mount in favour of this adapter
 */

import { SwapExecuteModal } from '@/components/swap/SwapExecuteModal';
import { APPROVAL_STATE, type Trade as KyberTrade } from '@/lib/aggregators/kyber-fork';
import type { TokenInfo } from '../constants';
import type { Token } from '@/components/swap/types';
import type { StepExecutorFn } from '@/lib/transactions';

interface BuildSwapArgs {
  trade: KyberTrade;
  /** Slippage tolerance in BPS — Kyber's /route/build expects raw BPS. */
  slippage: number;
  deadlineMinutes: number;
  tokenInAddress: string;
  client: string;
}

export interface AlphixReviewModalProps {
  // Visibility
  isOpen: boolean;
  onClose: () => void;

  // Token + amounts (from Widget closure)
  tokenInInfo: TokenInfo;
  tokenOutInfo: TokenInfo;
  amountIn: string;
  amountOut: string;

  // Trade + price context
  trade: KyberTrade | null;
  /** Pass-through to SwapRoutePreview inside SwapExecuteModal. */
  routeSummary?: KyberTrade['routeSummary'];
  routerAddress?: string;
  /** Slippage in BPS (Widget owns it in BPS, e.g. 50 = 0.5%). */
  slippageBps: number;
  fromTokenUsdPrice: number;
  toTokenUsdPrice: number;

  // Approval primitives (from useApproval in Widget closure)
  needsApproval: boolean;
  approve: () => void;
  approvalState: APPROVAL_STATE;

  // Wrap / unwrap hints — currently unused inside the modal because Kyber
  // routes wrap/unwrap through the normal swap flow, but they're part of
  // the prop contract so the Widget can suppress the Approve step if a
  // wrap is the only required action.
  isWrap?: boolean;
  isUnwrap?: boolean;

  // Submission — parent-supplied closure. The modal never calls Kyber's API
  // directly; it only invokes this when the swap step executes.
  buildAndSubmit: (args: BuildSwapArgs) => Promise<string>;
  building: boolean;
  submitting: boolean;

  // Chain + balance refresh
  targetChainId: number;
  ensureChain?: (chainId: number) => Promise<boolean>;
  refetchFromTokenBalance?: () => Promise<unknown>;
  refetchToTokenBalance?: () => Promise<unknown>;

  /**
   * Optional executor that overrides the default ERC20 approve step inside
   * `SwapExecuteModal`. The Widget builds this from Kyber's audited
   * `useErc20Approvals` hook so the approval path stays inside Kyber code.
   */
  customApproveExecutor?: StepExecutorFn;
}

/** Convert vendored Kyber `TokenInfo` to host-app `Token`. */
const toModalToken = (info: TokenInfo, usdPrice: number): Token => ({
  // Token expects `0x${string}` for address.
  address: info.address as `0x${string}`,
  symbol: info.symbol,
  name: info.name,
  decimals: info.decimals,
  icon: info.logoURI,
  usdPrice,
  // The Alphix Token shape carries display-only fields the modal doesn't
  // consume (balance/value); fill with empty strings to satisfy the type.
  balance: '',
  value: '',
  chainId: info.chainId,
});

export function AlphixReviewModal(props: AlphixReviewModalProps) {
  const {
    isOpen,
    onClose,
    tokenInInfo,
    tokenOutInfo,
    amountIn,
    amountOut,
    trade,
    routeSummary,
    routerAddress,
    slippageBps,
    fromTokenUsdPrice,
    toTokenUsdPrice,
    needsApproval,
    approve,
    approvalState,
    isWrap,
    isUnwrap,
    buildAndSubmit,
    building,
    submitting,
    targetChainId,
    ensureChain,
    refetchFromTokenBalance,
    refetchToTokenBalance,
    customApproveExecutor,
  } = props;

  const fromToken = toModalToken(tokenInInfo, fromTokenUsdPrice);
  const toToken = toModalToken(tokenOutInfo, toTokenUsdPrice);

  // SwapExecuteModal works in percent (0.5 means 0.5%); Widget stores BPS.
  const slippagePercent = slippageBps / 100;

  // SwapExecuteModal expects a discriminated tradeState. The Widget only
  // mounts this adapter once a non-null trade is in hand, so we report
  // "ready" whenever `trade` is present.
  const tradeState: 'idle' | 'loading' | 'no_route' | 'error' | 'ready' =
    trade ? 'ready' : 'loading';

  // Suppress unused-locals on flags that are part of the contract but not
  // consumed inside this adapter (wrap/unwrap are decided upstream).
  void isWrap;
  void isUnwrap;

  return (
    <SwapExecuteModal
      isOpen={isOpen}
      onClose={onClose}
      fromToken={fromToken}
      toToken={toToken}
      fromAmount={amountIn}
      toAmount={amountOut}
      currentSlippage={slippagePercent}
      fromTokenUsdPrice={fromTokenUsdPrice}
      refetchFromTokenBalance={refetchFromTokenBalance}
      refetchToTokenBalance={refetchToTokenBalance}
      trade={trade}
      tradeState={tradeState}
      routeSummary={routeSummary}
      routerAddress={routerAddress}
      needsApproval={needsApproval}
      approve={approve}
      approvalState={approvalState}
      buildAndSubmit={buildAndSubmit}
      building={building}
      submitting={submitting}
      source="kyberswap"
      targetChainId={targetChainId}
      ensureChain={ensureChain}
      customApproveExecutor={customApproveExecutor}
    />
  );
}

export default AlphixReviewModal;
