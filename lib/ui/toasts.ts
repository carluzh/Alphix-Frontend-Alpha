/**
 * Toast Utilities
 *
 * Centralized toast notification helpers for consistent UI feedback.
 * Uses Sonner toast library.
 */

import { toast } from 'sonner';
import { createElement } from 'react';
import { Loader2 } from 'lucide-react';
import { IconBadgeCheck2, IconCircleInfo, IconCircleXmarkFilled } from 'nucleo-micro-bold-essential';

// =============================================================================
// TYPES
// =============================================================================

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  description?: string;
  action?: ToastAction;
  duration?: number;
}

export type LiquidityAction =
  | 'approve'
  | 'sign_permit'
  | 'deposit'
  | 'withdraw'
  | 'collect_fees'
  | 'swap'
  | 'increase'
  | 'decrease';

// =============================================================================
// BASE TOAST FUNCTIONS
// =============================================================================

/**
 * Show an info toast with consistent styling.
 */
export function showInfoToast(title: string, options?: ToastOptions): void {
  toast(title, {
    icon: createElement(IconCircleInfo, { className: 'h-4 w-4' }),
    description: options?.description,
    action: options?.action,
    duration: options?.duration,
  });
}

/**
 * Show an error toast with consistent styling.
 */
export function showErrorToast(title: string, options?: ToastOptions): void {
  toast.error(title, {
    icon: createElement(IconCircleXmarkFilled, { className: 'h-4 w-4 text-red-500' }),
    description: options?.description,
    action: options?.action,
    duration: options?.duration ?? 5000,
  });
}

/**
 * Show a success toast with consistent styling.
 */
export function showSuccessToast(title: string, options?: ToastOptions): void {
  toast.success(title, {
    icon: createElement(IconBadgeCheck2, { className: 'h-4 w-4 text-green-500' }),
    description: options?.description,
    action: options?.action,
    duration: options?.duration ?? 4000,
  });
}

/**
 * Show a loading toast with consistent styling.
 * Returns toast ID for dismissal.
 */
export function showLoadingToast(title: string, options?: ToastOptions): string | number {
  return toast.loading(title, {
    icon: createElement(Loader2, { className: 'h-4 w-4 animate-spin' }),
    description: options?.description,
    duration: options?.duration ?? Infinity,
  });
}

/**
 * Dismiss a specific toast by ID.
 */
export function dismissToast(toastId: string | number): void {
  toast.dismiss(toastId);
}

// =============================================================================
// LIQUIDITY-SPECIFIC TOASTS
// =============================================================================

/**
 * Show a "confirm in wallet" toast for liquidity actions.
 */
export function showWalletConfirmToast(action: LiquidityAction): void {
  const messages: Record<LiquidityAction, string> = {
    approve: 'Confirm Approval in Wallet',
    sign_permit: 'Sign Permit in Wallet',
    deposit: 'Confirm Deposit in Wallet',
    withdraw: 'Confirm Withdrawal in Wallet',
    collect_fees: 'Confirm Fee Collection in Wallet',
    swap: 'Confirm Swap in Wallet',
    increase: 'Confirm Add Liquidity in Wallet',
    decrease: 'Confirm Remove Liquidity in Wallet',
  };

  showInfoToast(messages[action]);
}

/**
 * Show a success toast for completed transactions.
 */
export function showTransactionSuccessToast(
  action: LiquidityAction,
  txHash?: string,
  explorerUrl?: string
): void {
  const messages: Record<LiquidityAction, string> = {
    approve: 'Approval Confirmed',
    sign_permit: 'Permit Signed',
    deposit: 'Liquidity Added',
    withdraw: 'Liquidity Removed',
    collect_fees: 'Fees Collected',
    swap: 'Swap Complete',
    increase: 'Position Increased',
    decrease: 'Position Decreased',
  };

  const options: ToastOptions = {};

  if (txHash && explorerUrl) {
    options.action = {
      label: 'View Transaction',
      onClick: () => window.open(explorerUrl, '_blank'),
    };
  }

  showSuccessToast(messages[action], options);
}

/**
 * Show an error toast for failed transactions.
 */
export function showTransactionErrorToast(
  action: LiquidityAction,
  error?: string,
  isUserRejection: boolean = false
): void {
  if (isUserRejection) {
    showErrorToast('Transaction Rejected', {
      description: 'The request was rejected in your wallet',
    });
    return;
  }

  const messages: Record<LiquidityAction, string> = {
    approve: 'Approval Failed',
    sign_permit: 'Permit Signing Failed',
    deposit: 'Deposit Failed',
    withdraw: 'Withdrawal Failed',
    collect_fees: 'Fee Collection Failed',
    swap: 'Swap Failed',
    increase: 'Add Liquidity Failed',
    decrease: 'Remove Liquidity Failed',
  };

  showErrorToast(messages[action], {
    description: error,
    action: error
      ? {
          label: 'Copy Error',
          onClick: () => navigator.clipboard.writeText(error),
        }
      : undefined,
  });
}

/**
 * Show a toast for token approval with amount info.
 */
export function showApprovalSuccessToast(
  tokenSymbol: string,
  isInfinite: boolean,
  amount?: string
): void {
  showSuccessToast(`${tokenSymbol} Approved`, {
    description: isInfinite
      ? `Approved infinite ${tokenSymbol} for liquidity`
      : `Approved ${amount || ''} ${tokenSymbol} for this transaction`,
  });
}

/**
 * Show a toast for calculation errors.
 */
export function showCalculationErrorToast(details?: string): void {
  showErrorToast('Calculation Error', {
    description: details || 'Failed to calculate amounts',
  });
}

/**
 * Show a toast for invalid range errors.
 */
export function showInvalidRangeToast(): void {
  showInfoToast('Invalid Range', {
    description: 'Please select a valid price range',
  });
}

/**
 * Show a toast for insufficient balance.
 */
export function showInsufficientBalanceToast(tokenSymbol?: string): void {
  showErrorToast('Insufficient Balance', {
    description: tokenSymbol
      ? `Not enough ${tokenSymbol} for this transaction`
      : 'Not enough tokens for this transaction',
  });
}
