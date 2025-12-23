/**
 * Error Handling Utilities
 *
 * Consolidated error extraction and classification for liquidity operations.
 */

import { BaseError } from 'viem';

/**
 * Extract a user-friendly error message from various error types.
 *
 * @param error - Error object (can be Viem BaseError, standard Error, or unknown)
 * @returns User-friendly error message string
 */
export function extractErrorMessage(error: unknown): string {
  if (!error) return 'Unknown error';

  // Handle Viem BaseError
  if (error instanceof BaseError) {
    // Try to get the short message first
    if (error.shortMessage) {
      return error.shortMessage;
    }
    // Fall back to details or message
    if (error.details) {
      return error.details;
    }
    return error.message;
  }

  // Handle standard Error
  if (error instanceof Error) {
    // Check for nested cause
    if ('cause' in error && error.cause) {
      const causeMessage = extractErrorMessage(error.cause);
      if (causeMessage !== 'Unknown error') {
        return causeMessage;
      }
    }
    return error.message;
  }

  // Handle error-like objects
  if (typeof error === 'object' && error !== null) {
    const errorObj = error as Record<string, unknown>;

    // Try common error properties
    if (typeof errorObj.shortMessage === 'string') {
      return errorObj.shortMessage;
    }
    if (typeof errorObj.message === 'string') {
      return errorObj.message;
    }
    if (typeof errorObj.reason === 'string') {
      return errorObj.reason;
    }

    // Try to stringify
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown error';
    }
  }

  // Handle string errors
  if (typeof error === 'string') {
    return error;
  }

  return 'Unknown error';
}

/**
 * Check if error is a user rejection (wallet cancel).
 *
 * @param error - Error to check
 * @returns true if user rejected the transaction
 */
export function isUserRejectionError(error: unknown): boolean {
  const message = extractErrorMessage(error).toLowerCase();

  return (
    message.includes('user rejected') ||
    message.includes('user denied') ||
    message.includes('user cancelled') ||
    message.includes('user canceled') ||
    message.includes('rejected by user') ||
    message.includes('denied by user') ||
    // MetaMask specific
    message.includes('metamask tx signature: user denied') ||
    // Error code 4001 (user rejection in EIP-1193)
    (typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: number }).code === 4001)
  );
}

/**
 * Check if error is a network/RPC error.
 *
 * @param error - Error to check
 * @returns true if error is network-related
 */
export function isNetworkError(error: unknown): boolean {
  const message = extractErrorMessage(error).toLowerCase();

  return (
    message.includes('network') ||
    message.includes('rpc') ||
    message.includes('timeout') ||
    message.includes('fetch') ||
    message.includes('connection') ||
    message.includes('socket') ||
    message.includes('enotfound') ||
    message.includes('econnrefused')
  );
}

/**
 * Check if error is an insufficient funds error.
 *
 * @param error - Error to check
 * @returns true if user has insufficient funds
 */
export function isInsufficientFundsError(error: unknown): boolean {
  const message = extractErrorMessage(error).toLowerCase();

  return (
    message.includes('insufficient funds') ||
    message.includes('insufficient balance') ||
    message.includes('exceeds balance') ||
    message.includes('not enough')
  );
}

/**
 * Check if error is a slippage/price change error.
 *
 * @param error - Error to check
 * @returns true if transaction failed due to price movement
 */
export function isSlippageError(error: unknown): boolean {
  const message = extractErrorMessage(error).toLowerCase();

  return (
    message.includes('slippage') ||
    message.includes('price changed') ||
    message.includes('price moved') ||
    message.includes('too little received') ||
    message.includes('too much requested') ||
    message.includes('price impact')
  );
}

/**
 * Categorize error into a type for UI handling.
 */
export type ErrorCategory =
  | 'user_rejection'
  | 'network'
  | 'insufficient_funds'
  | 'slippage'
  | 'contract'
  | 'unknown';

/**
 * Get the category of an error for UI handling.
 *
 * @param error - Error to categorize
 * @returns Error category
 */
export function categorizeError(error: unknown): ErrorCategory {
  if (isUserRejectionError(error)) return 'user_rejection';
  if (isNetworkError(error)) return 'network';
  if (isInsufficientFundsError(error)) return 'insufficient_funds';
  if (isSlippageError(error)) return 'slippage';

  const message = extractErrorMessage(error).toLowerCase();
  if (
    message.includes('revert') ||
    message.includes('execution reverted') ||
    message.includes('call exception')
  ) {
    return 'contract';
  }

  return 'unknown';
}

/**
 * Get a user-friendly message for an error category.
 *
 * @param category - Error category
 * @returns User-friendly message
 */
export function getErrorCategoryMessage(category: ErrorCategory): string {
  switch (category) {
    case 'user_rejection':
      return 'Transaction was rejected in your wallet';
    case 'network':
      return 'Network error. Please check your connection and try again';
    case 'insufficient_funds':
      return 'Insufficient funds for this transaction';
    case 'slippage':
      return 'Price changed during transaction. Try increasing slippage tolerance';
    case 'contract':
      return 'Transaction would fail on-chain. Please check your inputs';
    case 'unknown':
    default:
      return 'An unexpected error occurred';
  }
}
