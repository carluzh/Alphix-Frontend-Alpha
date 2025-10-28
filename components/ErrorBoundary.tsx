'use client';

import React from 'react';
import { logger } from '@/lib/logger';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error?: Error; resetError: () => void }>;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({ errorInfo });

    // Log error with context
    logger.error('React Error Boundary caught an error', error, {
      componentStack: errorInfo.componentStack,
      errorBoundary: true,
    });
  }

  resetError = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render() {
    if (this.state.hasError) {
      const FallbackComponent = this.props.fallback || DefaultErrorFallback;
      return <FallbackComponent error={this.state.error} resetError={this.resetError} />;
    }

    return this.props.children;
  }
}

function DefaultErrorFallback({ error, resetError }: { error?: Error; resetError: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="max-w-md w-full p-6 bg-card rounded-lg shadow-lg border">
        <div className="text-center">
          <h2 className="text-xl font-semibold text-destructive mb-4">
            Something went wrong
          </h2>
          <p className="text-muted-foreground mb-6">
            We encountered an unexpected error. Our team has been notified and is working to fix this issue.
          </p>
          {process.env.NODE_ENV === 'development' && error && (
            <details className="mb-6 text-left">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                Error Details (Development Only)
              </summary>
              <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                {error.message}
                {error.stack && `\n\n${error.stack}`}
              </pre>
            </details>
          )}
          <button
            onClick={resetError}
            className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
}

// Hook for manual error reporting
export function useErrorReporting() {
  const reportError = React.useCallback((error: Error, context?: Record<string, any>) => {
    logger.error('Manual error report', error, context);
  }, []);

  const reportMessage = React.useCallback((message: string, level: 'info' | 'warning' | 'error' = 'error', context?: Record<string, any>) => {
    switch (level) {
      case 'info':
        logger.info(message, context);
        break;
      case 'warning':
        logger.warn(message, context);
        break;
      case 'error':
        logger.error(message, undefined, context);
        break;
    }
  }, []);

  return { reportError, reportMessage };
}

export default ErrorBoundary;


