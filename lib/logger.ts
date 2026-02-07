interface LogContext {
  [key: string]: unknown;
}

const isDev = process.env.NODE_ENV === 'development';

/**
 * Centralized logger that gates output based on environment.
 * - In development: all logs are output
 * - In production: only errors are logged (and captured by Sentry)
 */
class Logger {
  private formatMessage(level: string, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${contextStr}`;
  }

  /** Debug-level logging - only in development */
  debug(message: string, context?: LogContext) {
    if (isDev) {
      console.log(this.formatMessage('debug', message, context));
    }
  }

  /** Info-level logging - only in development */
  info(message: string, context?: LogContext) {
    if (isDev) {
      console.info(this.formatMessage('info', message, context));
    }
  }

  /** Warning-level logging - only in development */
  warn(message: string, context?: LogContext) {
    if (isDev) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  /**
   * Error-level logging - always logs (production errors captured by Sentry)
   * Use for actual errors that need investigation.
   */
  error(message: string, error?: Error | unknown, context?: LogContext) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(this.formatMessage('error', message, { ...context, error: errorMessage }));
  }
}

export const logger = new Logger();
export default logger;
