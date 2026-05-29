/**
 * Observability barrel.
 *
 * Single import surface for app-wide Sentry instrumentation. Prefer importing from
 * '@/lib/observability' so every layer (server route, LP client, swap widget,
 * signature handler, points hook, global handler) funnels through one path.
 */

export {
  reportError,
  reportMessage,
  reportFailedTx,
  addReportBreadcrumb,
  setWalletUser,
  clearWalletUser,
  markReported,
  wasReported,
  type ReportDomain,
  type ReportLevel,
  type ReportContext,
  type ReportTxContext,
  type BreadcrumbContext,
} from './sentry';
