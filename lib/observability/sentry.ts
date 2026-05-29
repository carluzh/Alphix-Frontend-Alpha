/**
 * Consolidated Sentry observability helper.
 *
 * SINGLE SOURCE OF TRUTH for error reporting, on-chain revert decoding, request
 * lifecycle breadcrumbs, and global wallet user context across the entire app
 * (Uniswap LP API routes, Kyberswap swap widget, signature flows, points/backend
 * fetches, unified-yield, global handlers).
 *
 * DESIGN INVARIANTS (so call sites never have to remember them):
 *   1. User rejections (wallet cancel / EIP-1193 code 4001) are dropped internally
 *      via isUserRejectionError() — call sites never special-case 4001 again.
 *   2. errorCategory (from categorizeError()) is ALWAYS attached as a tag — call
 *      sites never compute it.
 *   3. The tag taxonomy is a typed object param: the compiler enforces the standard
 *      keys (domain/action) and rejects ad-hoc key drift.
 *   4. extractErrorMessage() is reused for the thrown/returned message; nothing is
 *      re-implemented. (See lib/liquidity/utils/validation/errorHandling.ts.)
 *
 * IMPORT-SAFETY: this module only imports `@sentry/nextjs` (isomorphic), the pure
 * error utils, and viem (isomorphic). It imports NO wagmi / fetch / browser-only
 * globals, so it is safe from BOTH server (pages/api, instrumentation) and client
 * (lib/kyber-widget, app/*). `setWalletUser`/`clearWalletUser` no-op gracefully if
 * called server-side.
 *
 * AUDITED-PATH RULE (Kyberswap): in Kyber widget files, these helpers are ADDITIVE
 * ONLY — call addReportBreadcrumb before/around audited stages, and reportError /
 * reportFailedTx / reportMessage strictly inside an existing catch (or after a
 * failure is detected). They are pure observers: they never touch calldata, the
 * route/build body, gas math, or the submission call.
 */

import type { Hex } from 'viem';
import * as Sentry from '@sentry/nextjs';
import type { SeverityLevel } from '@sentry/nextjs';

import type { NetworkMode } from '@/lib/network-mode';
import {
  extractRevertReason,
  type RevertInfo,
} from '@/lib/liquidity/utils/extractRevertReason';
import {
  extractErrorMessage,
  categorizeError,
  isUserRejectionError,
  type ErrorCategory,
} from '@/lib/liquidity/utils/validation/errorHandling';

// =============================================================================
// ALREADY-REPORTED MARKER
// =============================================================================

/**
 * Symbol key used to tag an error object as "already reported to Sentry" by a
 * deliberate, rich call site (a handler/step). This lets an UPSTREAM catch-all
 * (e.g. useStepExecutor's generic step-failure catch) skip a second
 * reportError() for the SAME failure, eliminating duplicate events with diverging
 * fingerprints. Using Symbol.for keeps the key stable across module instances.
 */
const REPORTED = Symbol.for('alphix.observability.reported');

/**
 * Mark an error as already reported so upstream catch-alls do not double-report it.
 *
 * Sets a NON-enumerable, configurable property keyed by REPORTED to `true` on the
 * error object. Guarded for non-object/null inputs and wrapped in try/catch so a
 * frozen/sealed error never throws here. Returns the SAME value (same type) so it
 * can be used inline:  `throw markReported(new Error('…'))`  or  `markReported(e); throw e;`.
 */
export function markReported<T>(error: T): T {
  if (typeof error === 'object' && error !== null) {
    try {
      Object.defineProperty(error, REPORTED, {
        value: true,
        enumerable: false,
        configurable: true,
        writable: true,
      });
    } catch {
      // Frozen/sealed object — best-effort only; never throw from the marker.
    }
  }
  return error;
}

/**
 * Returns true iff `error` is a non-null object carrying the already-reported
 * marker (set by markReported). Used by upstream catch-alls to gate reporting.
 */
export function wasReported(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as Record<symbol, unknown>)[REPORTED] === true
  );
}

// =============================================================================
// CANONICAL TAG TAXONOMY
// =============================================================================

/**
 * Top-level failure family. The PRIMARY Sentry filter dimension. This closed
 * union replaces the historic 'component' / 'error_source' / 'source' drift.
 * Add a new member here (not at call sites) when a new subsystem appears.
 */
export type ReportDomain =
  | 'swap' // Kyberswap aggregator + swap submission
  | 'liquidity' // Uniswap LP API (mint/increase/decrease/collect) + position txs
  | 'unified-yield' // UnifiedYield deposit/withdraw/preview
  | 'points' // points + referral + leaderboard fetches
  | 'wallet' // global wallet errors / unhandled rejections / chain switch
  | 'approval' // ERC-20 / Permit2 approval txs
  | 'signature' // signTypedData / signMessage (permit2, ToS, referral)
  | 'backend' // backend-client / upstash-points / price / chart fetches
  | 'render'; // React render error boundary (global-error)

/**
 * Severity passthrough so call sites do not import from @sentry/nextjs directly.
 */
export type ReportLevel = SeverityLevel;

/**
 * The ONE context shape. `domain` + `action` are the only required fields; every
 * other field is optional with a safe default. The common case is a one-liner.
 */
export interface ReportContext {
  /** Required. Top-level subsystem — the primary Sentry filter. */
  domain: ReportDomain;
  /**
   * Required. Specific operation within the domain. Conventionally verb/endpoint-ish:
   * 'mint' | 'increase' | 'decrease' | 'collect' | 'checkApproval' | 'getRate' |
   * 'routeBuild' | 'estimateGas' | 'submitTx' | 'switchChain' | 'permit2Sign' |
   * 'tosSign' | 'referralSign' | 'deposit' | 'withdraw' | 'preview' |
   * 'fetchUserPoints' | 'fetchPoolHistory' | etc. (domain,action) is the primary
   * fingerprint pair.
   */
  action: string;
  /** Optional code-site name (file/hook/handler) for drill-down, e.g. 'positionHandler'. */
  component?: string;
  /** Optional 'base' | 'arbitrum' — chain-agnostic incident split. */
  networkMode?: NetworkMode | null;
  /** Optional numeric chain id (8453 | 42161). Redundant-but-queryable with networkMode. */
  chainId?: number | null;
  /** Override severity. Defaults to 'error'. */
  level?: ReportLevel;
  /** Override grouping. Defaults to [domain, action, errorCategory]. */
  fingerprint?: string[];
  /** Free-form additional tags (string values). Never collide with the standard keys. */
  tags?: Record<string, string | number | boolean | null | undefined>;
  /** Structured extras — input params, ids, status, etc. Long strings are truncated. */
  extras?: Record<string, unknown>;
  /** Optional single structured breadcrumb attached to this event. */
  breadcrumb?: {
    category?: string;
    level?: ReportLevel;
    message: string;
    data?: Record<string, unknown>;
  };
  /**
   * Escape hatch: capture even if this is a user rejection. Default false — user
   * rejections (4001) are dropped. Only set true for the rare forced-report path.
   */
  allowUserRejection?: boolean;
}

/** Context for reportFailedTx — extends ReportContext with on-chain tx coordinates. */
export interface ReportTxContext extends ReportContext {
  /** Hash of the reverted tx, if known. */
  txHash?: string;
  /** Target contract — enables the eth_call revert-replay probe. */
  to?: Hex;
  /** Calldata — enables the eth_call revert-replay probe. */
  data?: Hex;
  /** Value sent — passed to the probe. */
  value?: bigint;
  /** Sender — used as `account` in the eth_call probe. */
  from?: Hex;
}

/** Context for a standalone lifecycle/API breadcrumb (no exception involved). */
export interface BreadcrumbContext {
  domain: ReportDomain;
  action: string;
  level?: ReportLevel;
  message?: string;
  data?: Record<string, unknown>;
}

// =============================================================================
// INTERNALS
// =============================================================================

/** Cap on string-extra length to prevent Sentry event-size bloat / truncation. */
const MAX_EXTRA_STRING_LEN = 500;

/** Truncate long string values inside an extras bag (additive, non-destructive). */
function sanitizeExtras(extras?: Record<string, unknown>): Record<string, unknown> {
  if (!extras) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extras)) {
    if (typeof v === 'string' && v.length > MAX_EXTRA_STRING_LEN) {
      out[k] = `${v.slice(0, MAX_EXTRA_STRING_LEN)}…[truncated ${v.length} chars]`;
    } else if (typeof v === 'bigint') {
      out[k] = v.toString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Build the standard tag set. Undefined/null optionals are omitted (never empty-string). */
function buildStandardTags(
  ctx: ReportContext,
  errorCategory: ErrorCategory,
): Record<string, string> {
  const tags: Record<string, string> = {
    domain: ctx.domain,
    action: ctx.action,
    errorCategory,
  };
  if (ctx.component) tags.component = ctx.component;
  if (ctx.networkMode) tags.networkMode = ctx.networkMode;
  if (ctx.chainId != null) tags.chainId = String(ctx.chainId);
  if (ctx.tags) {
    for (const [k, v] of Object.entries(ctx.tags)) {
      if (v != null && v !== '') tags[k] = String(v);
    }
  }
  return tags;
}

// =============================================================================
// CORE: reportError — the workhorse (~90% of sites)
// =============================================================================

/**
 * Report a caught error to Sentry with the standard taxonomy.
 *
 * - Drops user rejections internally (unless ctx.allowUserRejection === true).
 * - Always attaches errorCategory (categorizeError).
 * - Default fingerprint = [domain, action, errorCategory].
 *
 * @returns the Sentry eventId, or null if the error was skipped (user rejection).
 *
 * Usage:
 *   import { reportError } from '@/lib/observability/sentry';
 *   reportError(err, { domain: 'liquidity', action: 'mint', component: 'prepare-mint-tx',
 *     chainId, extras: { userAddress, poolId } });
 */
export function reportError(error: unknown, ctx: ReportContext): string | null {
  if (!ctx.allowUserRejection && isUserRejectionError(error)) {
    return null;
  }

  const errorCategory = categorizeError(error);
  const level = ctx.level ?? 'error';
  const fingerprint = ctx.fingerprint ?? [ctx.domain, ctx.action, errorCategory];
  const tags = buildStandardTags(ctx, errorCategory);
  const extra = {
    ...sanitizeExtras(ctx.extras),
    errorMessage: extractErrorMessage(error),
  };

  // BREADCRUMB ISOLATION: a per-event breadcrumb cannot be passed through the
  // capture-context second param (ScopeContext has no `breadcrumbs`). When a
  // breadcrumb is attached we RETAIN withScope so the breadcrumb is scoped to this
  // one event and does NOT leak onto later events; otherwise use the flat form.
  if (ctx.breadcrumb) {
    let eventId: string | null = null;
    Sentry.withScope((scope) => {
      scope.addBreadcrumb({
        category: ctx.breadcrumb!.category ?? `${ctx.domain}.${ctx.action}`,
        level: ctx.breadcrumb!.level ?? 'error',
        message: ctx.breadcrumb!.message,
        data: ctx.breadcrumb!.data,
      });
      eventId = Sentry.captureException(error, { level, fingerprint, tags, extra });
    });
    return eventId;
  }

  return Sentry.captureException(error, { level, fingerprint, tags, extra });
}

// =============================================================================
// reportMessage — soft / non-exception failures
// =============================================================================

/**
 * Report a soft, expected-but-trackable failure that is NOT an exception
 * (e.g. Kyber 'Insufficient liquidity', LP-API indexing-delay, backend validation
 * rejection). Uses captureMessage. Default level 'warning'.
 *
 * @returns the Sentry eventId.
 *
 * Usage:
 *   import { reportMessage } from '@/lib/observability/sentry';
 *   reportMessage('Insufficient liquidity for swap',
 *     { domain: 'swap', action: 'getRate', level: 'warning', extras: { tokenIn, tokenOut } });
 */
export function reportMessage(message: string, ctx: ReportContext): string | null {
  // Soft failures are never "user rejections" — no skip check needed.
  const level = ctx.level ?? 'warning';
  const fingerprint = ctx.fingerprint ?? [ctx.domain, ctx.action, 'soft'];
  // No real error object → categorize as 'unknown' for the tag, callers may override via ctx.tags.
  const tags = buildStandardTags(ctx, 'unknown');
  const extra = sanitizeExtras(ctx.extras);

  // BREADCRUMB ISOLATION: retain withScope only when a breadcrumb is attached so it
  // stays scoped to this single event (see reportError); otherwise use the flat form.
  if (ctx.breadcrumb) {
    let eventId: string | null = null;
    Sentry.withScope((scope) => {
      scope.addBreadcrumb({
        category: ctx.breadcrumb!.category ?? `${ctx.domain}.${ctx.action}`,
        level: ctx.breadcrumb!.level ?? level,
        message: ctx.breadcrumb!.message,
        data: ctx.breadcrumb!.data,
      });
      eventId = Sentry.captureMessage(message, { level, fingerprint, tags, extra });
    });
    return eventId;
  }

  return Sentry.captureMessage(message, { level, fingerprint, tags, extra });
}

// =============================================================================
// reportFailedTx — rich on-chain revert reporter (mirrors positionHandler)
// =============================================================================

/**
 * Report an on-chain transaction revert with decoded revert reason.
 *
 * Mirrors the gold-standard positionHandler pattern: withScope -> setLevel ->
 * setFingerprint([domain, action, 'reverted', revertReason]) -> setTags
 * (incl. revertReason) -> addBreadcrumb -> setExtras (decoded reason) ->
 * captureException. When `to`+`data`+`from` are supplied, it best-effort replays
 * the failed call via eth_call to decode the revert into BaseError.shortMessage
 * (names like 'PriceLimitReached', 'TickSlippage', 'PermitSignatureExpired').
 *
 * Pass `error: null` for the receipt.status==='reverted' case where there is no
 * thrown object — a synthetic Error is created from the decoded reason.
 *
 * The probe is read-only and swallows its own errors; it never throws and never
 * mutates state. For Kyber callers, invoke ONLY after txStatus==='failed' is
 * detected (additive, catch-block-only); omit to/data/from there (audited path
 * owns the tx), passing just txHash + chainId.
 *
 * @returns the Sentry eventId, or null if skipped as a user rejection.
 *
 * Usage:
 *   import { reportFailedTx } from '@/lib/observability/sentry';
 *   await reportFailedTx(err, { domain: 'approval', action: step.type, txHash: hash,
 *     to, data, value, from: address, chainId });
 */
export async function reportFailedTx(
  error: unknown | null,
  ctx: ReportTxContext,
): Promise<string | null> {
  if (error != null && !ctx.allowUserRejection && isUserRejectionError(error)) {
    return null;
  }

  // Best-effort revert decode (read-only eth_call replay). Only runs when we have
  // the coordinates; otherwise we report with revertReason 'unknown'.
  let revert: RevertInfo = {};
  if (ctx.to && ctx.data && ctx.from) {
    revert = await extractRevertReason({
      to: ctx.to,
      data: ctx.data,
      value: ctx.value,
      from: ctx.from,
      chainId: ctx.chainId ?? undefined,
    });
  }

  const revertReason = revert.shortMessage ?? 'unknown';
  const errorCategory = error != null ? categorizeError(error) : 'contract';

  const level = ctx.level ?? 'error';
  const fingerprint = ctx.fingerprint ?? [ctx.domain, ctx.action, 'reverted', revertReason];
  const tags = {
    ...buildStandardTags(ctx, errorCategory),
    revertReason,
  };
  const extra = {
    ...sanitizeExtras(ctx.extras),
    txHash: ctx.txHash ?? null,
    txRequestTo: ctx.to ?? null,
    txRequestDataLength: ctx.data?.length ?? null,
    txRequestValue: ctx.value?.toString() ?? null,
    revertShortMessage: revert.shortMessage ?? null,
    revertDetails: revert.details ?? null,
    revertRawMessage: revert.rawMessage ?? null,
    revertProbeError: revert.probeError ?? null,
    ...(error != null ? { errorMessage: extractErrorMessage(error) } : {}),
  };

  // reportFailedTx ALWAYS attaches a revert breadcrumb, so it RETAINS withScope to
  // keep that breadcrumb isolated to this one event (it must not leak onto later
  // events). Tags/level/fingerprint/extras still flow through the flat capture
  // second-param form; only the breadcrumb needs the scope.
  let eventId: string | null = null;
  Sentry.withScope((scope) => {
    scope.addBreadcrumb({
      category: ctx.breadcrumb?.category ?? `${ctx.domain}.revert`,
      level: ctx.breadcrumb?.level ?? 'error',
      message: ctx.breadcrumb?.message ?? `${ctx.action} transaction reverted`,
      data: {
        txHash: ctx.txHash ?? null,
        to: ctx.to ?? null,
        chainId: ctx.chainId ?? null,
        revertShortMessage: revert.shortMessage ?? null,
        revertDetails: revert.details ?? null,
        revertRawMessage: revert.rawMessage ?? null,
        ...ctx.breadcrumb?.data,
      },
    });

    // For the synthetic-error case (error === null) keep constructing the synthetic
    // Error from the decoded reason; otherwise pass the raw error (auto-coerced).
    const captured =
      error != null
        ? error
        : new Error(
            `${ctx.action} transaction reverted${
              revert.shortMessage ? `: ${revert.shortMessage}` : ''
            }`,
          );
    eventId = Sentry.captureException(captured, { level, fingerprint, tags, extra });
  });

  return eventId;
}

// =============================================================================
// addReportBreadcrumb — lifecycle / API request trail (additive, non-exception)
// =============================================================================

/**
 * Add a non-exception breadcrumb following the standard `${domain}.${action}`
 * category convention. The ONLY function permitted inside Kyber audited code
 * (before route/build, gas-estimate warnings, polling stages), plus successful
 * signature/permit trails and Uniswap requestId correlation on both success and
 * error paths. No-op-safe; never throws.
 *
 * Usage:
 *   import { addReportBreadcrumb } from '@/lib/observability/sentry';
 *   addReportBreadcrumb({ domain: 'swap', action: 'routeBuild',
 *     message: 'building route', data: { tokenIn, tokenOut, amountIn } });
 */
export function addReportBreadcrumb(ctx: BreadcrumbContext): void {
  Sentry.addBreadcrumb({
    category: `${ctx.domain}.${ctx.action}`,
    level: ctx.level ?? 'info',
    message: ctx.message ?? ctx.action,
    data: ctx.data,
  });
}

// =============================================================================
// Global wallet user context (lifecycle — wired once, never at error sites)
// =============================================================================

/**
 * Set global Sentry user context to the connected wallet so EVERY event carries
 * the actor. Call from a wallet-connection effect (AppProviders) on connect /
 * chain change. Safe to call server-side (no-ops where window is undefined since
 * Sentry's browser user context is a client concern, but the call itself is inert).
 *
 * Usage:
 *   import { setWalletUser } from '@/lib/observability/sentry';
 *   setWalletUser(address, chainId, networkMode);
 */
export function setWalletUser(
  address?: string | null,
  chainId?: number | null,
  networkMode?: NetworkMode | null,
): void {
  if (!address) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: address.toLowerCase() });
  Sentry.setContext('wallet', {
    address: address.toLowerCase(),
    chainId: chainId ?? null,
    networkMode: networkMode ?? null,
  });
}

/**
 * Clear global Sentry user context on wallet disconnect.
 *
 * Usage:
 *   import { clearWalletUser } from '@/lib/observability/sentry';
 *   clearWalletUser();
 */
export function clearWalletUser(): void {
  Sentry.setUser(null);
  Sentry.setContext('wallet', null);
}
