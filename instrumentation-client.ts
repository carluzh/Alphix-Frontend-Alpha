import * as Sentry from "@sentry/nextjs";
import { IGNORE_ERRORS, dropEip1193Rejection } from "@/lib/observability/sentry-init-shared";

Sentry.init({
  dsn: "https://7f3aaefeeb345947a6a199963656c216@o4510478966980608.ingest.de.sentry.io/4510478986903632",
  // Never report from the e2e harness build: it forks mainnet locally and drives
  // synthetic flows, so its events (hydration on localhost, client aborts, mock-
  // wallet RPC errors) are pure test noise that must not pollute production Sentry.
  enabled: process.env.NEXT_PUBLIC_E2E !== 'true',
  // Correlate every event to a deployed build + git commit for source-map matching.
  // NEXT_PUBLIC_APP_VERSION / NEXT_PUBLIC_GIT_COMMIT are wired in next.config.mjs env.
  release: process.env.NEXT_PUBLIC_APP_VERSION,
  dist: process.env.NEXT_PUBLIC_GIT_COMMIT,
  enableLogs: true,
  // Top-level noise filter: substring-matches the message + last exception value
  // (a drop-in for the previous beforeSend includes() checks). beforeSend handles
  // the one structured case (EIP-1193 code 4001).
  ignoreErrors: [...IGNORE_ERRORS],
  beforeSend: dropEip1193Rejection,
  // Error-only Session Replay: never sample plain sessions (0), capture a replay
  // only when an error is reported (1.0). replayIntegration() is the BUNDLED build
  // (not lazyLoadIntegration) — the CDN variant is fetched from a Sentry domain that
  // the same adblockers tunnelRoute exists to work around would block. Default text
  // masking stays ON.
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["error"] }),
    Sentry.replayIntegration(),
  ],
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
  environment: process.env.NODE_ENV,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
