/**
 * Validation Utilities
 *
 * Fee tier, error handling, and validation utilities.
 */

export { DYNAMIC_FEE_AMOUNT, DEFAULT_TICK_SPACING, DYNAMIC_FEE_DATA } from './feeTiers';

export {
  extractErrorMessage,
  isUserRejectionError,
  isNetworkError,
  categorizeError,
  type ErrorCategory,
} from './errorHandling';
