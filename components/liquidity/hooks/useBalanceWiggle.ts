/**
 * useBalanceWiggle Hook
 *
 * Provides wiggle animation control for balance-related UI feedback.
 * Uses Framer Motion's useAnimation hook internally.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAnimation } from 'framer-motion';

export interface UseBalanceWiggleResult {
  /** Animation controls for Framer Motion */
  controls: ReturnType<typeof useAnimation>;
  /** Trigger a wiggle animation */
  triggerWiggle: () => void;
  /** Current wiggle count (increments on each trigger) */
  wiggleCount: number;
  /** Reset the wiggle state */
  reset: () => void;
}

/**
 * Wiggle animation keyframes
 */
const WIGGLE_ANIMATION = {
  x: [0, -3, 3, -3, 3, -2, 2, 0],
  transition: {
    duration: 0.4,
    ease: 'easeInOut' as const,
  },
};

/**
 * Hook to manage wiggle animations for balance feedback.
 *
 * Usage:
 * ```tsx
 * const { controls, triggerWiggle } = useBalanceWiggle();
 *
 * // Trigger on insufficient balance
 * useEffect(() => {
 *   if (isInsufficientBalance) triggerWiggle();
 * }, [isInsufficientBalance]);
 *
 * // Apply to motion component
 * <motion.div animate={controls}>...</motion.div>
 * ```
 */
export function useBalanceWiggle(): UseBalanceWiggleResult {
  const controls = useAnimation();
  const [wiggleCount, setWiggleCount] = useState(0);

  // Run animation when count changes
  useEffect(() => {
    if (wiggleCount > 0) {
      controls.start(WIGGLE_ANIMATION);
    }
  }, [wiggleCount, controls]);

  const triggerWiggle = useCallback(() => {
    setWiggleCount((prev) => prev + 1);
  }, []);

  const reset = useCallback(() => {
    setWiggleCount(0);
    controls.stop();
    controls.set({ x: 0 });
  }, [controls]);

  return {
    controls,
    triggerWiggle,
    wiggleCount,
    reset,
  };
}

/**
 * Hook for approval wiggle animation (slightly different timing).
 */
export function useApprovalWiggle(): UseBalanceWiggleResult {
  const controls = useAnimation();
  const [wiggleCount, setWiggleCount] = useState(0);

  useEffect(() => {
    if (wiggleCount > 0) {
      controls.start({
        x: [0, -2, 2, -2, 2, -1, 1, 0],
        transition: {
          duration: 0.3,
          ease: 'easeInOut' as const,
        },
      });
    }
  }, [wiggleCount, controls]);

  const triggerWiggle = useCallback(() => {
    setWiggleCount((prev) => prev + 1);
  }, []);

  const reset = useCallback(() => {
    setWiggleCount(0);
    controls.stop();
    controls.set({ x: 0 });
  }, [controls]);

  return {
    controls,
    triggerWiggle,
    wiggleCount,
    reset,
  };
}
