import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://7f3aaefeeb345947a6a199963656c216@o4510478966980608.ingest.de.sentry.io/4510478986903632",
  tracesSampleRate: 0,
  enableLogs: true,
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["error"] }),
    Sentry.browserTracingIntegration({ instrumentPageLoad: false, instrumentNavigation: false }),
  ],
  beforeSend(event) {
    const errorValue = event.exception?.values?.[0]?.value || '';
    if (errorValue.includes('Failed to fetch')) return null;
    if (errorValue.includes('User rejected')) return null;
    if (errorValue.includes('EPIPE')) return null;
    if (errorValue.includes('broken pipe')) return null;
    return event;
  },
  environment: process.env.NODE_ENV,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
