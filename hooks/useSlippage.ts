/**
 * Slippage tolerance hooks with persistence
 * Based on Uniswap's implementation
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  SlippageTolerance,
  SLIPPAGE_STORAGE_KEY,
  SLIPPAGE_AUTO_FLAG_KEY,
  DEFAULT_SWAP_SLIPPAGE,
  MAX_AUTO_SLIPPAGE_TOLERANCE,
  MAX_CUSTOM_SLIPPAGE_TOLERANCE,
} from '@/lib/slippage/slippage-constants';
import {
  validateUserSlippageTolerance,
  getSlippageWarningMessage,
  isSlippageCritical,
  shouldShowSlippageWarning,
} from '@/lib/slippage/slippage-validation';

/**
 * Hook for managing user slippage tolerance with persistence
 */
export function useUserSlippageTolerance() {
  // Track if using auto or custom slippage
  const [isAuto, setIsAuto] = useState<boolean>(true);

  // Custom slippage value (only used when isAuto is false)
  const [customSlippage, setCustomSlippage] = useState<number>(DEFAULT_SWAP_SLIPPAGE);

  // Auto-slippage value (calculated or fetched)
  const [autoSlippage, setAutoSlippage] = useState<number>(DEFAULT_SWAP_SLIPPAGE);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const savedIsAuto = localStorage.getItem(SLIPPAGE_AUTO_FLAG_KEY);
      const savedSlippage = localStorage.getItem(SLIPPAGE_STORAGE_KEY);

      if (savedIsAuto !== null) {
        setIsAuto(savedIsAuto === 'true');
      }

      if (savedSlippage !== null) {
        const parsed = parseFloat(savedSlippage);
        if (!isNaN(parsed)) {
          setCustomSlippage(parsed);
        }
      }
    } catch (error) {
      console.error('[useUserSlippageTolerance] Error loading from localStorage:', error);
    }
  }, []);

  // Save to localStorage when values change
  useEffect(() => {
    try {
      localStorage.setItem(SLIPPAGE_AUTO_FLAG_KEY, isAuto.toString());
      localStorage.setItem(SLIPPAGE_STORAGE_KEY, customSlippage.toString());
    } catch (error) {
      console.error('[useUserSlippageTolerance] Error saving to localStorage:', error);
    }
  }, [isAuto, customSlippage]);

  // Get the current effective slippage
  const currentSlippage = useMemo(() => {
    return isAuto ? autoSlippage : customSlippage;
  }, [isAuto, autoSlippage, customSlippage]);

  // Set custom slippage and switch to custom mode
  const setSlippage = useCallback((value: number) => {
    // Cap at max custom tolerance
    const capped = Math.min(value, MAX_CUSTOM_SLIPPAGE_TOLERANCE);
    setCustomSlippage(capped);
    setIsAuto(false);
  }, []);

  // Switch to auto mode
  const setAutoMode = useCallback(() => {
    setIsAuto(true);
  }, []);

  // Switch to custom mode with current value
  const setCustomMode = useCallback(() => {
    setIsAuto(false);
  }, []);

  // Update auto-slippage value (called when quote is received)
  const updateAutoSlippage = useCallback((value: number) => {
    // Cap at max auto tolerance (5.5% for swaps, but we'll cap at 5.0% to be safe)
    // For zap mode specifically, we want max 5.0% to respect user's max slippage limit
    const MAX_SLIPPAGE_SAFE = 5.0; // Hard cap at 5.0% for all auto slippage
    const capped = Math.min(value, MAX_SLIPPAGE_SAFE);
    setAutoSlippage(capped);
  }, []);

  return {
    currentSlippage,
    isAuto,
    customSlippage,
    autoSlippage,
    setSlippage,
    setAutoMode,
    setCustomMode,
    updateAutoSlippage,
  };
}

/**
 * Hook for slippage validation and warnings
 */
export function useSlippageValidation(slippage: number) {
  const validationResult = useMemo(() => {
    return validateUserSlippageTolerance(slippage);
  }, [slippage]);

  const warningMessage = useMemo(() => {
    return getSlippageWarningMessage(validationResult);
  }, [validationResult]);

  const isCritical = useMemo(() => {
    return isSlippageCritical(slippage);
  }, [slippage]);

  const showWarning = useMemo(() => {
    return shouldShowSlippageWarning(slippage);
  }, [slippage]);

  return {
    validationResult,
    warningMessage,
    isCritical,
    showWarning,
  };
}

/**
 * Hook for slippage input management
 */
export function useSlippageInput(
  currentSlippage: number,
  setSlippage: (value: number) => void
) {
  const [inputValue, setInputValue] = useState<string>('');
  const [isEditing, setIsEditing] = useState<boolean>(false);

  // Update input value when slippage changes externally (and not editing)
  useEffect(() => {
    if (!isEditing) {
      setInputValue(currentSlippage.toFixed(2));
    }
  }, [currentSlippage, isEditing]);

  const handleInputChange = useCallback((value: string) => {
    // Allow empty input
    if (value === '') {
      setInputValue('');
      return;
    }

    // Allow decimal point
    if (value === '.') {
      setInputValue('0.');
      return;
    }

    // Validate numeric input
    if (!/^\d*\.?\d*$/.test(value)) {
      return;
    }

    // Limit to 2 decimal places
    const parts = value.split('.');
    if (parts[1] && parts[1].length > 2) {
      return;
    }

    setInputValue(value);

    // Parse and validate
    const parsed = parseFloat(value);
    if (!isNaN(parsed)) {
      // Cap at max custom tolerance
      const capped = Math.min(parsed, MAX_CUSTOM_SLIPPAGE_TOLERANCE);
      setSlippage(capped);
    }
  }, [setSlippage]);

  const handleFocus = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleBlur = useCallback(() => {
    setIsEditing(false);

    // Ensure input shows formatted value
    const parsed = parseFloat(inputValue);
    if (!isNaN(parsed)) {
      setInputValue(parsed.toFixed(2));
    } else {
      // Reset to current slippage if invalid
      setInputValue(currentSlippage.toFixed(2));
    }
  }, [inputValue, currentSlippage]);

  const increment = useCallback(() => {
    const newValue = Math.min(currentSlippage + 0.1, MAX_CUSTOM_SLIPPAGE_TOLERANCE);
    setSlippage(newValue);
  }, [currentSlippage, setSlippage]);

  const decrement = useCallback(() => {
    const newValue = Math.max(currentSlippage - 0.1, 0.01);
    setSlippage(newValue);
  }, [currentSlippage, setSlippage]);

  return {
    inputValue,
    isEditing,
    handleInputChange,
    handleFocus,
    handleBlur,
    increment,
    decrement,
  };
}
