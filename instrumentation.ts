export async function register() {
  // This is only run on the server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Register Sentry on the server
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    // Register Sentry on the edge runtime
    await import('./sentry.edge.config');
  }
}

export async function onRequestError(err: any, request: any, context: any) {
  // This is only run on the server side
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    // Register Sentry on the edge runtime
    await import('./sentry.edge.config');
  }
}


