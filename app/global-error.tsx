"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { type: 'react_render_error' }
    });
  }, [error]);

  return (
    <html>
      <body>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: 'system-ui, sans-serif',
          background: '#0a0a0a',
          color: '#fff'
        }}>
          <h2 style={{ marginBottom: '1rem' }}>Something went wrong</h2>
          <button
            onClick={() => reset()}
            style={{
              padding: '0.75rem 1.5rem',
              background: '#333',
              color: '#fff',
              border: '1px solid #555',
              borderRadius: '0.5rem',
              cursor: 'pointer'
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
