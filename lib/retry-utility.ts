/**
 * Centralized retry utility for financial infrastructure
 * Handles different backoff strategies and validation patterns consistently
 */

export interface RetryConfig<T = any> {
  attempts: number;
  backoffStrategy: 'fixed' | 'exponential' | 'custom';
  baseDelay?: number; // Optional when using custom delays
  maxDelay?: number;
  validate?: (result: T) => boolean;
  onRetry?: (attempt: number, error: any) => void;
  shouldRetry?: (attempt: number, error: any) => boolean;
  throwOnFailure?: boolean;
  customDelays?: number[];
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  attempts: number;
  error?: any;
}

export class RetryUtility {
  /**
   * Execute an operation with retry logic
   */
  static async execute<T>(
    operation: () => Promise<T>,
    config: RetryConfig<T>
  ): Promise<RetryResult<T>> {

    let lastError: any;
    let lastResult: T | undefined;

    for (let attempt = 0; attempt < config.attempts; attempt++) {
      try {
        const result = await operation();

        // Store result for potential return
        lastResult = result;

        // Validate result if validator provided
        if (config.validate && !config.validate(result)) {
          throw new Error('Validation failed');
        }

        return { success: true, data: result, attempts: attempt + 1 };

      } catch (error) {
        lastError = error;

        // Check if we should retry
        if (config.shouldRetry && !config.shouldRetry(attempt, error)) {
          break;
        }

        // Don't delay on last attempt
        if (attempt < config.attempts - 1) {
          const delay = this.calculateDelay(config, attempt);
          config.onRetry?.(attempt, error);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All attempts failed
    if (config.throwOnFailure) {
      throw lastError;
    }

    return {
      success: false,
      ...(lastResult !== undefined ? { data: lastResult } : {}),
      attempts: config.attempts,
      error: lastError
    } as RetryResult<T>;
  }

  /**
   * Calculate delay based on backoff strategy
   */
  private static calculateDelay(config: RetryConfig, attempt: number): number {
    switch (config.backoffStrategy) {
      case 'fixed':
        return config.baseDelay ?? 1000;

      case 'exponential':
        const base = config.baseDelay ?? 1000;
        const delay = base * Math.pow(2, attempt);
        return config.maxDelay ? Math.min(delay, config.maxDelay) : delay;

      case 'custom':
        return config.customDelays?.[attempt] ?? config.baseDelay ?? 1000;

      default:
        return config.baseDelay ?? 1000;
    }
  }

  /**
   * Convenience method for HTTP requests with JSON parsing
   */
  static async fetchJson<T = any>(
    url: string,
    config: Omit<RetryConfig<T>, 'backoffStrategy'> & {
      backoffStrategy?: RetryConfig<T>['backoffStrategy']
    }
  ): Promise<RetryResult<T>> {
    return this.execute(
      async () => {
        const response = await fetch(url, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache' }
        } as any);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response.json();
      },
      {
        backoffStrategy: 'fixed',
        ...config
      }
    );
  }
}
