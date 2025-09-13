import * as Sentry from '@sentry/nextjs';

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

interface LogContext {
  [key: string]: any;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  context?: LogContext;
  timestamp: string;
  userId?: string;
  sessionId?: string;
}

class Logger {
  private isDevelopment = process.env.NODE_ENV === 'development';
  private isSentryEnabled = !!process.env.NEXT_PUBLIC_SENTRY_DSN;

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${contextStr}`;
  }

  private logToConsole(level: LogLevel, message: string, context?: LogContext) {
    const formattedMessage = this.formatMessage(level, message, context);

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(formattedMessage);
        break;
      case LogLevel.INFO:
        console.info(formattedMessage);
        break;
      case LogLevel.WARN:
        console.warn(formattedMessage);
        break;
      case LogLevel.ERROR:
        console.error(formattedMessage);
        break;
    }
  }

  private logToSentry(level: LogLevel, message: string, context?: LogContext, error?: Error) {
    if (!this.isSentryEnabled) return;

    const logEntry: LogEntry = {
      level,
      message,
      context,
      timestamp: new Date().toISOString(),
    };

    // Add user context if available
    if (typeof window !== 'undefined') {
      // In browser, we might have user context
      Sentry.setContext('log_entry', logEntry);
    }

    switch (level) {
      case LogLevel.DEBUG:
        // Debug logs are typically not sent to Sentry
        break;
      case LogLevel.INFO:
        Sentry.captureMessage(message, {
          level: 'info',
          contexts: { log_entry: logEntry },
        });
        break;
      case LogLevel.WARN:
        Sentry.captureMessage(message, {
          level: 'warning',
          contexts: { log_entry: logEntry },
        });
        break;
      case LogLevel.ERROR:
        if (error) {
          Sentry.captureException(error, {
            contexts: { log_entry: logEntry },
          });
        } else {
          Sentry.captureMessage(message, {
            level: 'error',
            contexts: { log_entry: logEntry },
          });
        }
        break;
    }
  }

  debug(message: string, context?: LogContext) {
    this.logToConsole(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: LogContext) {
    this.logToConsole(LogLevel.INFO, message, context);
    this.logToSentry(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: LogContext) {
    this.logToConsole(LogLevel.WARN, message, context);
    this.logToSentry(LogLevel.WARN, message, context);
  }

  error(message: string, error?: Error, context?: LogContext) {
    this.logToConsole(LogLevel.ERROR, message, { ...context, error: error?.message });
    this.logToSentry(LogLevel.ERROR, message, context, error);
  }

  // Specialized logging methods for common use cases
  apiCall(endpoint: string, method: string, duration?: number, context?: LogContext) {
    this.info(`API Call: ${method} ${endpoint}`, {
      ...context,
      endpoint,
      method,
      duration,
      type: 'api_call',
    });
  }

  userAction(action: string, userId?: string, context?: LogContext) {
    this.info(`User Action: ${action}`, {
      ...context,
      action,
      userId,
      type: 'user_action',
    });
  }

  performance(metric: string, value: number, context?: LogContext) {
    this.info(`Performance: ${metric} = ${value}`, {
      ...context,
      metric,
      value,
      type: 'performance',
    });
  }

  transaction(txHash: string, type: string, context?: LogContext) {
    this.info(`Transaction: ${type}`, {
      ...context,
      txHash,
      transactionType: type,
      type: 'transaction',
    });
  }
}

// Export singleton instance
export const logger = new Logger();

// Export for convenience
export default logger;


