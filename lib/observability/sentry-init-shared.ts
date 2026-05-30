/**
 * Shared Sentry init noise filters.
 *
 * SINGLE SOURCE OF TRUTH for the init-time event filtering applied identically in
 * BOTH instrumentation-client.ts (browser) and instrumentation.ts (node + edge).
 * This is the ONLY raw `@sentry/nextjs` import allowed outside instrumentation*.ts
 * and lib/observability/sentry.ts — it exists solely so the two init entrypoints
 * don't drift on what counts as noise.
 *
 * ISOMORPHIC: imports only Sentry types (erased at runtime) and references no
 * browser/node-only globals, so it is safe to import from any runtime.
 */

import type { ErrorEvent, EventHint } from '@sentry/nextjs';

/**
 * Substring patterns dropped at init via the top-level `ignoreErrors` option.
 *
 * In sentry core 10.39.0 `ignoreErrors` substring-matches against the event
 * message, the last exception value, AND the `Type: value` concatenation — so
 * this is a drop-in replacement for the prior hand-rolled
 * `event.exception?.values?.[0]?.value.includes(...)` checks.
 *
 * Keep this list in lock-step across client + server inits.
 */
export const IGNORE_ERRORS = [
  'Failed to fetch',
  'User rejected',
  'EPIPE',
  'broken pipe',
  'disconnected port object',
  // CLIENT-ABORT NOISE (system-only, not actionable):
  // - 'Unexpected end of form' is thrown by Next's app-page runtime body parser
  //   when a multipart/Server-Action request body is truncated mid-upload (the
  //   client navigated away / aborted). Culprit is '/', no in-app frames.
  // - 'ECONNRESET' / 'aborted' arise when the client socket closes mid-request
  //   (node:_http_server abortIncoming). 'aborted' is also handled structurally in
  //   dropClientAbort below to avoid matching unrelated "...aborted" messages.
  'Unexpected end of form',
  'ECONNRESET',
  // WebGL2 unavailable: @paper-design/shaders-react throws this from an async
  // useEffect (uncatchable by an error boundary). Shader call sites now gate on
  // WebGL2 support (lib/webgl) so this should not fire; kept as a backstop for any
  // residual async rejection. Purely decorative — never an actionable error.
  'Paper Shaders: WebGL is not supported',
] as const;

/**
 * The ONE filter that needs structured (non-string) data: drop EIP-1193 user
 * rejections by their numeric `code` (4001), even when the message string never
 * matches the `ignoreErrors` patterns.
 *
 * Defense-in-depth: the observability helper already skips user rejections at the
 * funnel, but global/unhandled paths can bypass the helper. Wired as `beforeSend`
 * on every runtime.
 */
export function dropEip1193Rejection(
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null {
  if (isWalletRejection(event, hint)) return null;
  if (isClientAbort(event)) return null;
  return event;
}

/**
 * EIP-1193 + JSON-RPC provider error codes that are non-actionable wallet/
 * connector noise when they surface as UNHANDLED promise rejections (no app
 * frames, nothing fixable at a call site): 4001 user-reject, 4100 unauthorized,
 * 4200 unsupported method, 4900/4901 disconnected, -32002 request-pending, and
 * the -32000..-32099 JSON-RPC provider range.
 */
function isEip1193NoiseCode(code: number): boolean {
  return (
    code === 4001 || code === 4100 || code === 4200 ||
    code === 4900 || code === 4901 || code === -32002 ||
    (code <= -32000 && code >= -32099)
  );
}

/**
 * True iff this event is an unhandled promise rejection of a wallet/RPC error
 * OBJECT (viem/wagmi/EIP-1193 style `{code,message,stack}`) that escaped every
 * try/catch and was captured by Sentry's onunhandledrejection global handler.
 * These come from wagmi/Reown-AppKit connector internals (eager reconnect,
 * getProvider/isAuthorized/switchChain, WalletConnect relay) whose promises
 * reject inside the library's own async tasks the app cannot wrap. Matched
 * structurally so it never drops a legitimate thrown Error.
 */
function isWalletRejection(event: ErrorEvent, hint: EventHint): boolean {
  const orig = hint?.originalException as { code?: unknown } | undefined;
  const code = typeof orig?.code === 'number' ? orig.code : undefined;
  if (code !== undefined && isEip1193NoiseCode(code)) return true;
  // Sentry serialises non-Error rejections as "Object captured as promise
  // rejection with keys: ...". Drop those ONLY when they arrived via the
  // unhandled-rejection mechanism and the raw value is a plain (non-Error) object
  // carrying a numeric `code` (the EIP-1193 shape) — never a real Error.
  const ex = event.exception?.values?.[0];
  const viaUnhandled = ex?.mechanism?.type === 'onunhandledrejection';
  const isPlainObjReject =
    typeof ex?.value === 'string' &&
    ex.value.startsWith('Object captured as promise rejection') &&
    orig != null && !(orig instanceof Error) && code !== undefined;
  return Boolean(viaUnhandled && isPlainObjReject);
}

/**
 * True iff the event is a CLIENT-ABORTED request surfaced as a server "Error:
 * aborted" — the client socket closed mid-request (node HTTP server
 * `abortIncoming` / `socketOnClose`). This is non-actionable noise: there is no
 * app bug, the caller simply went away before the response.
 *
 * Matched structurally (exact value 'aborted' + a node:_http_server / node:net
 * abort frame) rather than via the broad `ignoreErrors` substring 'aborted',
 * which would also drop legitimate messages that merely contain the word.
 */
function isClientAbort(event: ErrorEvent): boolean {
  const ex = event.exception?.values?.[0];
  if (!ex || ex.value !== 'aborted') return false;
  const frames = ex.stacktrace?.frames ?? [];
  return frames.some((f) => {
    const m = `${f.module ?? ''} ${f.filename ?? ''} ${f.function ?? ''}`;
    return (
      m.includes('_http_server') ||
      m.includes('abortIncoming') ||
      m.includes('socketOnClose')
    );
  });
}
