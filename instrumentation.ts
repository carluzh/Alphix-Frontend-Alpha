import * as Sentry from '@sentry/nextjs';

const DSN =
  'https://7f3aaefeeb345947a6a199963656c216@o4510478966980608.ingest.de.sentry.io/4510478986903632';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    Sentry.init({
      dsn: DSN,
      tracesSampleRate: 0,
      environment: process.env.NODE_ENV,
      beforeSend(event) {
        const v = event.exception?.values?.[0]?.value || '';
        if (v.includes('EPIPE') || v.includes('broken pipe')) return null;
        return event;
      },
    });
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init({
      dsn: DSN,
      tracesSampleRate: 0,
      environment: process.env.NODE_ENV,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
