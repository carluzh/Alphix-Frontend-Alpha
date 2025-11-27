/**
 * User settings hooks with localStorage persistence
 * Manages: slippage, deadline, and token approval mode
 *
 * IMPORTANT: Uses same slippage storage keys as useSlippage.ts for compatibility
 */

import { useState, useEffect, useCallback } from 'react';
import {
  SLIPPAGE_STORAGE_KEY,
  SLIPPAGE_AUTO_FLAG_KEY,
} from '@/lib/slippage-constants';

// Additional storage keys for deadline and approval mode
const DEADLINE_STORAGE_KEY = 'alphix:user-deadline';
const APPROVAL_MODE_STORAGE_KEY = 'alphix:user-approval-mode';

// Default values
const DEFAULT_SLIPPAGE = 0.5; // 0.5%
const DEFAULT_DEADLINE = 30; // 30 minutes
const DEFAULT_APPROVAL_MODE: ApprovalMode = 'exact';

// Types
export type ApprovalMode = 'exact' | 'infinite';

export interface UserSettings {
  // Slippage tolerance as percentage (e.g., 0.5 = 0.5%)
  slippage: number;
  // Custom slippage input (empty string means using preset)
  customSlippage: string;
  // Whether slippage is in auto mode
  isAutoSlippage: boolean;
  // Transaction deadline in minutes
  deadline: number;
  // Token approval mode
  approvalMode: ApprovalMode;
}

const DEFAULT_SETTINGS: UserSettings = {
  slippage: DEFAULT_SLIPPAGE,
  customSlippage: '',
  isAutoSlippage: true,
  deadline: DEFAULT_DEADLINE,
  approvalMode: DEFAULT_APPROVAL_MODE,
};

/**
 * Hook for managing all user settings with localStorage persistence
 * Uses same storage keys as useSlippage.ts for slippage compatibility
 */
export function useUserSettings() {
  const [settings, setSettingsState] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from localStorage on mount - use individual keys for compatibility
  useEffect(() => {
    try {
      // Load slippage (compatible with useSlippage.ts)
      const savedSlippage = localStorage.getItem(SLIPPAGE_STORAGE_KEY);
      const savedIsAuto = localStorage.getItem(SLIPPAGE_AUTO_FLAG_KEY);
      // Load deadline and approval mode
      const savedDeadline = localStorage.getItem(DEADLINE_STORAGE_KEY);
      const savedApprovalMode = localStorage.getItem(APPROVAL_MODE_STORAGE_KEY);

      setSettingsState({
        slippage: savedSlippage ? parseFloat(savedSlippage) : DEFAULT_SLIPPAGE,
        customSlippage: '',
        isAutoSlippage: savedIsAuto !== 'false', // Default to true
        deadline: savedDeadline ? parseInt(savedDeadline, 10) : DEFAULT_DEADLINE,
        approvalMode: savedApprovalMode === 'infinite' ? 'infinite' : DEFAULT_APPROVAL_MODE,
      });
    } catch (error) {
      console.error('[useUserSettings] Error loading from localStorage:', error);
    }
    setIsLoaded(true);
  }, []);

  // Update individual settings and save to localStorage
  const setSlippage = useCallback((value: number, customValue?: string) => {
    setSettingsState(prev => ({
      ...prev,
      slippage: value,
      customSlippage: customValue ?? '',
      isAutoSlippage: false, // Switching to manual when user sets slippage
    }));
    // Save to localStorage (compatible with useSlippage.ts)
    try {
      localStorage.setItem(SLIPPAGE_STORAGE_KEY, value.toString());
      localStorage.setItem(SLIPPAGE_AUTO_FLAG_KEY, 'false');
    } catch (error) {
      console.error('[useUserSettings] Error saving slippage:', error);
    }
  }, []);

  const setDeadline = useCallback((value: number) => {
    const clamped = Math.max(1, Math.min(60, value)); // Clamp between 1-60 minutes
    setSettingsState(prev => ({
      ...prev,
      deadline: clamped,
    }));
    try {
      localStorage.setItem(DEADLINE_STORAGE_KEY, clamped.toString());
    } catch (error) {
      console.error('[useUserSettings] Error saving deadline:', error);
    }
  }, []);

  const setApprovalMode = useCallback((mode: ApprovalMode) => {
    setSettingsState(prev => ({
      ...prev,
      approvalMode: mode,
    }));
    try {
      localStorage.setItem(APPROVAL_MODE_STORAGE_KEY, mode);
    } catch (error) {
      console.error('[useUserSettings] Error saving approval mode:', error);
    }
  }, []);

  // Get deadline in seconds (for transaction building)
  const getDeadlineSeconds = useCallback(() => {
    return settings.deadline * 60;
  }, [settings.deadline]);

  // Get slippage in basis points (for transaction building)
  const getSlippageBps = useCallback(() => {
    return Math.round(settings.slippage * 100);
  }, [settings.slippage]);

  return {
    settings,
    isLoaded,
    setSlippage,
    setDeadline,
    setApprovalMode,
    getDeadlineSeconds,
    getSlippageBps,
  };
}

/**
 * Get settings from localStorage (for use outside React components)
 * Returns default values if not set
 */
export function getStoredUserSettings(): UserSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_SETTINGS;
  }

  try {
    const savedSlippage = localStorage.getItem(SLIPPAGE_STORAGE_KEY);
    const savedIsAuto = localStorage.getItem(SLIPPAGE_AUTO_FLAG_KEY);
    const savedDeadline = localStorage.getItem(DEADLINE_STORAGE_KEY);
    const savedApprovalMode = localStorage.getItem(APPROVAL_MODE_STORAGE_KEY);

    return {
      slippage: savedSlippage ? parseFloat(savedSlippage) : DEFAULT_SLIPPAGE,
      customSlippage: '',
      isAutoSlippage: savedIsAuto !== 'false',
      deadline: savedDeadline ? parseInt(savedDeadline, 10) : DEFAULT_DEADLINE,
      approvalMode: savedApprovalMode === 'infinite' ? 'infinite' : DEFAULT_APPROVAL_MODE,
    };
  } catch {
    // Ignore errors
  }

  return DEFAULT_SETTINGS;
}

/**
 * Get transaction deadline in seconds
 */
export function getStoredDeadlineSeconds(): number {
  const settings = getStoredUserSettings();
  return settings.deadline * 60;
}

/**
 * Get slippage in basis points
 */
export function getStoredSlippageBps(): number {
  const settings = getStoredUserSettings();
  return Math.round(settings.slippage * 100);
}

/**
 * Check if infinite approval mode is enabled
 */
export function isInfiniteApprovalEnabled(): boolean {
  const settings = getStoredUserSettings();
  return settings.approvalMode === 'infinite';
}
