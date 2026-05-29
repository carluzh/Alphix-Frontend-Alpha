import * as Sentry from '@sentry/nextjs';
import { IGNORE_ERRORS, dropEip1193Rejection } from '@/lib/observability/sentry-init-shared';

const DSN =
  'https://7f3aaefeeb345947a6a199963656c216@o4510478966980608.ingest.de.sentry.io/4510478986903632';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: DSN,
      release: process.env.NEXT_PUBLIC_APP_VERSION,
      dist: process.env.NEXT_PUBLIC_GIT_COMMIT,
      environment: process.env.NODE_ENV,
      // enableLogs is required for consoleLoggingIntegration to forward console.error.
      enableLogs: true,
      integrations: [Sentry.consoleLoggingIntegration({ levels: ['error'] })],
      // Same noise filters as the browser init (instrumentation-client.ts):
      // top-level substring patterns + the EIP-1193 code-4001 structured backstop.
      ignoreErrors: [...IGNORE_ERRORS],
      beforeSend: dropEip1193Rejection,
    });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn: DSN,
      release: process.env.NEXT_PUBLIC_APP_VERSION,
      dist: process.env.NEXT_PUBLIC_GIT_COMMIT,
      environment: process.env.NODE_ENV,
      enableLogs: true,
      integrations: [Sentry.consoleLoggingIntegration({ levels: ['error'] })],
      ignoreErrors: [...IGNORE_ERRORS],
      beforeSend: dropEip1193Rejection,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
