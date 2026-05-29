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
  const code = (hint?.originalException as { code?: number } | undefined)?.code;
  if (code === 4001) return null;
  return event;
}
